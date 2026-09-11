/* 临时：联机端到端测试 —— 原始 socket 实现 WS 客户端（掩码帧），驱动一整局 */
const net = require('net');
const crypto = require('crypto');

const PORT = 8766;
const sock = net.connect(PORT, '127.0.0.1');
let buf = Buffer.alloc(0);
let handshaken = false;
const pending = [];
const counts = { state: 0, decisions: 0 };
let view = null, ended = null, errs = 0;

function maskFrame(str) {
  const p = Buffer.from(str, 'utf8');
  const mask = crypto.randomBytes(4);
  let h;
  if (p.length < 126) h = Buffer.from([0x81, 0x80 | p.length]);
  else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); }
  const masked = Buffer.from(p);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  return Buffer.concat([h, mask, masked]);
}
function send(o) { sock.write(maskFrame(JSON.stringify(o))); }
function decode(buf, cb) {
  let off = 0;
  while (off + 2 <= buf.length) {
    const len0 = buf[off + 1] & 0x7f;
    let len = len0, mo = off + 2;
    if (len0 === 126) { if (off + 4 > buf.length) break; len = buf.readUInt16BE(off + 2); mo = off + 4; }
    else if (len0 === 127) { if (off + 10 > buf.length) break; len = Number(buf.readBigUInt64BE(off + 2)); mo = off + 10; }
    if (mo + len > buf.length) break;
    cb(buf.slice(mo, mo + len).toString('utf8'));
    off = mo + len;
  }
  return buf.slice(off);
}

sock.on('connect', () => {
  const key = crypto.randomBytes(16).toString('base64');
  sock.write(`GET / HTTP/1.1\r\nHost: localhost:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
             `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
});
sock.on('data', d => {
  if (!handshaken) {
    const s = d.toString();
    const i = s.indexOf('\r\n\r\n');
    if (s.includes('101')) { handshaken = true; onOpen(); }
    if (i >= 0 && i + 4 < d.length) buf = Buffer.concat([buf, d.slice(i + 4)]);
    return;
  }
  buf = decode(Buffer.concat([buf, d]), txt => {
    let m = null; try { m = JSON.parse(txt); } catch (_) { return; }
    pending.push(m);
    pump();
  });
});
sock.on('error', e => { console.log('socket error', e.message); process.exit(1); });
sock.on('close', () => {
  console.log('连接被关闭。最后状态: step=', view && view.step, 'stepDone=', view && view.stepDone,
    'pending=', view && view.pending ? view.pending.kind : null, 'over=', view && view.over,
    'night=', view && view.night, 'states=', counts.state, 'decisions=', counts.decisions);
  process.exit(5);
});

function onOpen() {
  send({ t: 'hello', name: '测试员' });
  send({ t: 'create', name: '测试员' });
  setTimeout(() => send({ t: 'start', seed: 424242 }), 300);
  setTimeout(() => { console.log('超时未结束'); console.log(JSON.stringify(counts)); process.exit(2); }, 120000);
}

function answer(f) {
  const data = { opt: null, targets: [], num: null, text: '测试发言' };
  if (f.opts) { const ok = f.opts.filter(o => !o.disabled); if (ok.length) data.opt = ok[Math.floor(Math.random() * ok.length)].v; }
  if (f.targets) {
    let list = view.players.filter(p => !p.out && p.id !== view.humanId);
    if (f.targets.list === 'aliveNotAlien') list = list.filter(p => p.faction !== 'alien');
    list = list.filter(p => (f.targets.exclude || []).indexOf(p.id) < 0);
    for (let k = 0; k < Math.min(f.targets.max || 1, list.length); k++) data.targets.push(list[k].id);
  }
  if (f.num) data.num = f.num.options[0].v;
  return data;
}

let pumping = false;
function pump() {
  if (pumping) return;
  pumping = true;
  while (pending.length) {
    const m = pending.shift();
    if (m.t === 'state') {
      view = m.view; counts.state++;
      if (process.env.WSDEBUG) console.log('[state] night', view.night, 'step', view.step, 'pending', view.pending ? view.pending.kind : '-', 'timer', JSON.stringify(view.timer));
      if (view.over && ended) { finish(); return; }
      if (view.over && !ended) { ended = true; }
      if (view.pending && !ended) {
        counts.decisions++;
        send({ t: 'decision', data: answer(view.pending) });
        if (counts.decisions > 800) { console.log('决策次数超限'); process.exit(3); }
      }
    } else if (m.t === 'end') { ended = m; if (view && view.over) { finish(); return; } }
    else if (m.t === 'err') { console.log('服务器错误:', m.msg); process.exit(4); }
    else if (m.t === 'room') { console.log('房间:', m.id, '席位', m.seats.map(s => s.seat).join(',')); }
  }
  pumping = false;
}

function finish() {
  const roster = ended.roster || [];
  const tally = {};
  for (const p of roster) tally[p.faction] = (tally[p.faction] || 0) + 1;
  console.log('对局结束，胜者:', (ended.roster ? '见下' : view.winner));
  console.log('状态帧:', counts.state, '提交决策:', counts.decisions);
  console.log('阵营存活:', JSON.stringify(tally));
  console.log('复盘事件条数:', (ended.replay || []).length);
  console.log('联机端到端测试通过');
  process.exit(0);
}
