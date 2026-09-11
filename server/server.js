/* 联机服务器：Node 内置 http + 手写 WebSocket 帧协议（零依赖）。
   权威对局状态在服务器上运行（复用 js/ 引擎），按席位广播裁剪后的视图。 */
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- 加载引擎（与服务端共用同一份规则实现） ----------
   v21 改动 #12：补齐 lang/ 与 infer/ 六个结合层文件——联机模式下 global.Bridge /
   global.Tiers / global.SKVisible 等此前根本不存在。
   v33 修复（复审 O3）：v21 手写清单缺 infer/registry（moe.js 读 global.MoERegistry 即崩）、
   infer/channels.run、corpus/tactics·channels.data、ai 四件套与 engine 两件套——
   联机入口长期不可用。现废弃手写清单，改用 tools/load-order.cjs 唯一真源
   （profiles.ui = 完整对局栈 + UI 层，与浏览器 index.html 完全同口径）。 */
const base = path.join(__dirname, '..', 'js');
const { makeCtx, loadInto, profiles } = require(path.join(__dirname, '..', 'tools', 'load-order.cjs'));
const ctx = makeCtx();
/* 服务端 = 完整对局栈 + 视图构建器（view.js 纯函数无 DOM）；
   不加载 audio/ui/net/main——它们依赖 document，服务端沙盒没有 DOM。 */
loadInto(ctx, base, profiles.full.concat(['view']));
const { Setup, Engine, View } = ctx;

const PORT = process.env.PORT ? +process.env.PORT : 8766;

/* ---------- WebSocket 编解码 ---------- */
const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function accept(key) { return crypto.createHash('sha1').update(key + MAGIC).digest('base64'); }

function encodeFrame(str) {
  const p = Buffer.from(str, 'utf8');
  let h;
  if (p.length < 126) { h = Buffer.from([0x81, p.length]); }
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(p.length, 6); }
  return Buffer.concat([h, p]);
}

function decode(buf, cb) {
  let off = 0;
  while (off + 2 <= buf.length) {
    const fin = (buf[off] & 0x80) !== 0;
    const op = buf[off] & 0x0f;
    let len = buf[off + 1] & 0x7f;
    let mo = off + 2;
    if (len === 126) { if (off + 4 > buf.length) break; len = buf.readUInt16BE(off + 2); mo = off + 4; }
    else if (len === 127) { if (off + 10 > buf.length) break; len = Number(buf.readBigUInt64BE(off + 2)); mo = off + 10; }
    if (mo + 4 + len > buf.length) break;
    const mask = buf.slice(mo, mo + 4);
    const data = buf.slice(mo + 4, mo + 4 + len);
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    cb({ fin, op, data });
    off = mo + 4 + len;
  }
  return buf.slice(off);
}

/* ---------- 静态文件 ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const httpd = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(base, '..', p === '/index.html' ? 'index.html' : p);
  if (!fp.startsWith(path.join(base, '..'))) { res.writeHead(403); res.end(); return; }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(d);
  });
});

/* ---------- 房间 ---------- */
const rooms = new Map();
let roomSeq = 1;
const sockets = new Map();      // sock -> {room, seat, name}

function findFreeSeat(room) {
  for (let i = 1; i <= 15; i++) if (!room.seats.some(s => s.seat === i)) return i;
  return null;
}

function roomInfo(room) {
  return {
    t: 'room', id: room.id, host: room.host, hostSeat: 1,
    seats: room.seats.map(s => ({ seat: s.seat, name: s.name, connected: !!s.sock })),
    started: !!room.game,
  };
}

function broadcast(room, obj, except, seatFilter) {
  for (const s of room.seats) {
    if (!s.sock || s.sock === except) continue;
    /* v22 缺陷修复（结构性）：broadcast 是无差别广播——当前所有广播内容都是公开事实，
       但结构上任何将来加入的私有消息都会全席泄露。新增 seatFilter 参数：
       带私有信息的消息必须传过滤器（或用 sendToSeat 单发）。 */
    if (seatFilter && !seatFilter(s.seat)) continue;
    s.sock.send(obj);
  }
}

/* 按席位单发：私有消息（个人反馈 / 队内 / 私聊）专用入口，禁止用 broadcast 发私有内容 */
function sendToSeat(room, seat, obj) {
  const s = room.seats.find(x => x.seat === seat);
  if (s && s.sock) s.sock.send(obj);
}

function sendView(room) {
  const g = room.game;
  let timer = null;
  if (g && !g.over) {
    const st = ctx.SKData.STEP_TIME[g.step] || {};
    timer = {
      step: g.step, name: Engine.STEP_NAME[g.step] || g.step,
      duration: g.pendings && Object.keys(g.pendings).length ? (st.duration || 0) : 0,
      left: g.pendings && Object.keys(g.pendings).length && room.deadline
        ? Math.max(0, Math.round((room.deadline - Date.now()) / 1000)) : 0,
      waiting: Object.keys(g.pendings || {}).length,
    };
  }
  for (const s of room.seats) {
    if (!s.sock || !g) continue;
    const v = View.build(g, s.seat);
    if (v) v.timer = timer;
    s.sock.send({ t: 'state', view: v });
  }
}

function startGame(room, seed) {
  const g = Setup.createGame((seed >>> 0) || (Date.now() % 100000000), 'random');
  g.humans = room.seats.map(s => s.seat);
  for (const s of room.seats) g.players[s.seat - 1].name = s.name;
  g.humanId = g.humans[0];
  room.game = g;
  room.deadline = 0; room.holdUntil = 0;
  Engine.begin(g);
  broadcast(room, { t: 'begin', seed: g.seed });
  console.log(`[room ${room.id}] 对局开始，真人席位：${g.humans.join(',')}`);
  sendView(room);
  stepPace(room);
}

function stepPace(room) {
  const g = room.game;
  if (!g || g.over) return;
  const waiting = Engine.pendingCount(g);
  if (waiting) {
    const st = ctx.SKData.STEP_TIME[g.step] || {};
    room.deadline = Date.now() + (st.duration || 15) * 1000;
    if (g.pending && g.pending.stream) room.streamStart = Date.now();
  } else {
    const st = ctx.SKData.STEP_TIME[g.stepDone] || {};
    room.holdUntil = Date.now() + (st.auto ? st.auto * 1000 : 500 + Math.random() * 700);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const g = room.game;
    if (!g) continue;
    if (g.over) {
      if (!room.endSent) {
        room.endSent = true;
        broadcast(room, {
          t: 'end',
          replay: g.replay,
          roster: g.players.map(p => ({
            id: p.id, name: p.name, faction: p.faction, role: p.role, roleName: p.roleName,
            out: p.out, outNight: p.outNight, outType: p.outType, cause: p.cause,
          })),
        });
        room.game = null;
        broadcast(room, roomInfo(room));
      }
      continue;
    }
    room.holdUntil = 0;

    if (Engine.pendingCount(g)) {
      const firstPid = Object.keys(g.pendings)[0];
      const first = g.pendings[firstPid];
      if (first && first.stream) {                       // 实时讨论：流式发言 + 到点收束
        const elapsed = now - (room.streamStart || now);
        const said = Engine.streamPump(g, elapsed);
        if (room.deadline && now >= room.deadline) {
          for (const pid of Object.keys(g.pendings)) Engine.setDecisionFor(g, +pid, {});
          Engine.finishIfReady(g);
          stepPace(room);
          sendView(room);
          continue;
        }
        sendView(room);          // 讨论期间持续推送，保证倒计时数字实时
        continue;
      }
      if (room.deadline && now >= room.deadline) {
        for (const pid of Object.keys(g.pendings)) {
          Engine.setDecisionFor(g, +pid, {});
          broadcast(room, { t: 'note', msg: `${pid} 号超时，视为放弃行动` });
        }
        Engine.finishIfReady(g);
        stepPace(room);
      }
      sendView(room);
      continue;
    }
    Engine.stepOnce(g);
    stepPace(room);
    sendView(room);
  }
}, 250);

/* ---------- 连接处理 ---------- */
httpd.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               `Sec-WebSocket-Accept: ${accept(key)}\r\n\r\n`);
  socket.setNoDelay(true);

  const sock = {
    send: o => { try { socket.write(encodeFrame(typeof o === 'string' ? o : JSON.stringify(o))); } catch (_) {} },
    close: () => { try { socket.end(); } catch (_) {} },
  };
  let buf = Buffer.alloc(0);

  socket.on('data', d => {
    buf = Buffer.concat([buf, d]);
    buf = decode(buf, fr => {
      if (fr.op === 8) { detach(sock); socket.end(); return; }
      if (fr.op !== 1) return;
      let m = null;
      try { m = JSON.parse(fr.data.toString('utf8')); } catch (_) { return; }
      handle(sock, m);
    });
  });
  socket.on('close', () => detach(sock));
  socket.on('error', () => detach(sock));
});

function detach(sock) {
  const info = sockets.get(sock);
  if (!info) return;
  sockets.delete(sock);
  const room = rooms.get(info.roomId);
  if (!room) return;
  const seat = room.seats.find(s => s.seat === info.seat);
  if (seat) { seat.sock = null; seat.name = seat.name; }
  broadcast(room, roomInfo(room));
  console.log(`[room ${info.roomId}] ${info.name} 断线（席位保留，AI 托管）`);
}

function handle(sock, m) {
  const info = sockets.get(sock);
  switch (m.t) {
    case 'hello': {
      sock.send({ t: 'hello', ok: true });
      break;
    }
    case 'create': {
      const id = 'R' + (roomSeq++);
      const room = { id, host: m.name, hostSeat: 1, seats: [{ seat: 1, name: m.name || '房主', sock }], game: null };
      rooms.set(id, room);
      sockets.set(sock, { roomId: id, seat: 1, name: m.name });
      sock.send({ t: 'seat', seat: 1, host: true });
      sock.send(roomInfo(room));
      console.log(`[room ${id}] ${m.name} 创建房间`);
      break;
    }
    case 'join': {
      const room = rooms.get(m.room);
      if (!room) { sock.send({ t: 'err', msg: '房间不存在' }); break; }
      const seat = findFreeSeat(room);
      if (seat == null) { sock.send({ t: 'err', msg: '房间已满（15 人）' }); break; }
      room.seats.push({ seat, name: m.name || ('玩家' + seat), sock });
      sockets.set(sock, { roomId: room.id, seat, name: m.name });
      sock.send({ t: 'seat', seat, host: false });
      broadcast(room, roomInfo(room));
      console.log(`[room ${room.id}] ${m.name} 加入，席位 ${seat}`);
      break;
    }
    case 'start': {
      if (!info) break;
      const room = rooms.get(info.roomId);
      if (!room || info.seat !== room.hostSeat) { sock.send({ t: 'err', msg: '只有房主可以开始' }); break; }
      startGame(room, m.seed || 0);
      break;
    }
    case 'decision': {
      if (!info) break;
      const room = rooms.get(info.roomId);
      if (!room || !room.game) break;
      const g = room.game;
      if (Engine.setDecisionFor(g, info.seat, m.data || {})) {
        Engine.finishIfReady(g);
        stepPace(room);
        sendView(room);
      }
      break;
    }
    case 'talk': {
      if (!info) break;
      const room = rooms.get(info.roomId);
      const g = room && room.game;
      if (!g) break;
      if (Engine.talk(g, info.seat, m.text, m.accuse)) sendView(room);
      break;
    }
    case 'continue': {
      if (!info) break;
      const room = rooms.get(info.roomId);
      if (room) room.holdUntil = 0;
      break;
    }
    case 'again': {
      if (!info) break;
      const room = rooms.get(info.roomId);
      if (room && info.seat === room.hostSeat) { room.game = null; room.endSent = false; broadcast(room, roomInfo(room)); }
      break;
    }
    default: break;
  }
}

httpd.listen(PORT, () => console.log(`太空杀联机服务器已启动：ws://localhost:${PORT}  （静态页面 http://localhost:${PORT}/）`));
