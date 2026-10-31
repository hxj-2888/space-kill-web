/* =============================================================
 * SKReplay · 对局复盘 / 回放（返航录V3 · 2026-10-31）
 * -------------------------------------------------------------
 * 职责：   把一局的事件流（谁在哪做了什么）+ 0.5 秒位置帧渲染成
 *          可拖动、可播放的复盘页；支持导出/再导入 JSON 回放文件。
 * 不变量： · 只读回放数据与 SKMapData，不读写对局状态；
 *          · 不新增资源请求（无 fetch / 无外链），file:// 直接可用；
 *          · 依赖 js/ui/home.js 的整船 SVG（同一份地图轮廓），
 *            必须在 js/data/map.js、js/ui/home.js 之后加载。
 * 对外：   window.SKReplay = { open, close, save, isOpen, payload, count, seek }
 * ============================================================= */
(function (global) {
  'use strict';

  var M = global.SKMapData;
  var NIGHT_LEN = 120;   /* 与 js/game.js 的 NIGHT 一致，仅用于把剩余秒换算成夜里时间 */
  var FILTERS = [
    { id: 'all', label: '全部', kinds: null },
    { id: 'fight', label: '击杀/战斗', kinds: ['knife', 'shoot', 'kill', 'eject', 'detain', 'bot_hit', 'bot_down'] },
    { id: 'task', label: '任务/维修', kinds: ['task', 'fix', 'sabotage', 'revive'] },
    { id: 'move', label: '管道/移动', kinds: ['pipe', 'breaker', 'drag_start', 'drag_end'] },
    { id: 'meet', label: '会议/投票', kinds: ['meeting', 'report', 'vote', 'chat'] },
    { id: 'loot', label: '搜尸/资源', kinds: ['search', 'supply', 'qual'] }
  ];
  var KIND_ICON = {
    knife: '刀', shoot: '枪', kill: '死', eject: '逐', detain: '拘', bot_down: '机', bot_hit: '机',
    task: '任', fix: '修', sabotage: '破', revive: '救',
    pipe: '管', breaker: '电', drag_start: '拖', drag_end: '放',
    meeting: '会', report: '报', vote: '票', chat: '言',
    search: '搜', supply: '资', qual: '单',
    night_start: '夜', dawn: '晨', game_start: '始', game_end: '终'
  };
  var METHOD = { knife: '刀伤', shot: '枪伤', bled: '失血', vote: '驱逐', sabotage: '破坏' };

  var el = {};
  var data = null;
  var roster = [];
  var names = {};
  var dots = {};
  var gDots = null;
  var ring = null;
  var frames = [];
  var events = [];
  var cur = 0, endPt = 0;
  var playing = false, raf = 0, lastTs = 0;
  var filter = 'all';
  var activeEv = -1;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function nz(seat) { return seat == null ? '—' : (names[seat] || ('#' + seat)); }
  function roomName(rid) {
    if (!rid) return '走廊';
    var r = M.rooms.find(function (q) { return q.id === rid; });
    return r ? r.name : rid;
  }
  function fmt(sec) {
    sec = Math.max(0, sec);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function seatOf(v) { return v == null || v < 0 ? null : v; }

  /* ---------------- 文案 ---------------- */
  function describe(e) {
    var a = nz(e.actor), v = nz(e.victim), r = roomName(e.room);
    switch (e.kind) {
      case 'game_start': return '<b>对局开始</b> · 第 1 夜';
      case 'night_start': return '<b>第 ' + (e.night || 1) + ' 夜</b>开始';
      case 'dawn': return '<b>天亮</b> · 维修进度 ' + (e.prog == null ? '?' : e.prog) + '/45';
      case 'knife': return '<b>' + esc(a) + '</b> 在 <span class="rm">' + esc(r) + '</span> 出刀击倒 <span class="vd">' + esc(v) + '</span>';
      case 'shoot': return '<b>' + esc(a) + '</b> 在 <span class="rm">' + esc(r) + '</span> 开枪击倒 <span class="vd">' + esc(v) + '</span>';
      case 'kill':
        return '<span class="vd">' + esc(v) + '</span> 死亡（' + (METHOD[e.method] || e.method || '未知') + '）'
          + (e.actor != null ? ' · 凶手 <b>' + esc(a) + '</b>' : '')
          + ' · <span class="rm">' + esc(r) + '</span>';
      case 'task':
        return '<b>' + esc(a) + '</b> 在 <span class="rm">' + esc(r) + '</span> 完成「'
          + esc(e.label) + '」 <b>+' + (e.pts || 1) + '</b> 分'
          + (e.ghost ? '（幽灵）' : '') + (e.prog != null ? ' · 进度 ' + e.prog + '/45' : '');
      case 'fix':
        return '<b>' + esc(a) + '</b> 在 <span class="rm">' + esc(r) + '</span> 修好故障「' + esc(e.label) + '」';
      case 'sabotage':
        return '<b>' + esc(a) + '</b> 破坏 <span class="rm">' + esc(r) + '</span>「' + esc(e.label) + '」';
      case 'bot_hit':
        return '<b>' + esc(a) + '</b> 攻击' + (e.bot === 'secbot' ? '保安' : '医疗') + '机器人（'
          + (e.method === 'shot' ? '枪' : '刀') + '，剩余装甲 ' + (e.hp == null ? '?' : e.hp) + '）· <span class="rm">' + esc(r) + '</span>';
      case 'bot_down':
        return '<b>' + esc(a) + '</b> 摧毁了' + (e.bot === 'secbot' ? '保安' : '医疗') + '机器人 · <span class="rm">' + esc(r) + '</span>';
      case 'pipe':
        return '<b>' + esc(a) + '</b> 钻管道：<span class="rm">' + esc(roomName(e.from)) + '</span> → <span class="rm">' + esc(roomName(e.to)) + '</span>';
      case 'breaker':
        return '<b>' + esc(e.actor == null ? '某人' : a) + '</b> ' + (e.state === 2 ? '<b>拉闸断电</b>' : '合闸恢复照明') + ' · <span class="rm">' + esc(r) + '</span>';
      case 'drag_start':
        return '<b>' + esc(a) + '</b> 在 <span class="rm">' + esc(r) + '</span> 拖起 <span class="vd">' + esc(v) + '</span>' + (e.downed ? '（伤员）' : '（尸体）');
      case 'drag_end':
        return '<b>' + esc(a) + '</b> 在 <span class="rm">' + esc(r) + '</span> 放下 <span class="vd">' + esc(v) + '</span>';
      case 'search':
        var got = [];
        if (e.bullet) got.push('子弹×' + e.bullet);
        if (e.medkit) got.push('医疗包×' + e.medkit);
        if (e.qual) got.push('申请单×' + e.qual);
        return '<b>' + esc(a) + '</b> 在 <span class="rm">' + esc(r) + '</span> 搜 <span class="vd">' + esc(v) + '</span>'
          + (e.first ? ' · 首次取证' : '') + (got.length ? ' · 取走 ' + got.join('、') : ' · 没找到物资');
      case 'supply':
        return '<b>' + esc(a) + '</b> 在 <span class="rm">' + esc(r) + '</span> 用申请单换到 ' + (e.item === 'medkit' ? '医疗包' : '子弹');
      case 'qual':
        return '<b>' + esc(a) + '</b> 在 <span class="rm">' + esc(r) + '</span> 领取物资申请单（持有 ' + (e.n || 1) + '）';
      case 'revive':
        return (e.actor == null ? '医疗机器人' : '<b>' + esc(a) + '</b>') + ' 在 <span class="rm">' + esc(r)
          + '</span> 救起 <span class="vd">' + esc(v) + '</span>';
      case 'meeting':
        return '<b>' + (e.kind === 'day' ? '天亮会议' : e.kind === 'pre' ? '开局讨论' : '紧急会议') + '</b>'
          + (e.victim != null ? ' · 现场：<span class="rm">' + esc(r) + '</span> · <span class="vd">' + esc(v) + '</span>' : '');
      case 'report':
        return '<b>' + esc(e.actor == null ? '某人' : a) + '</b> 在 <span class="rm">' + esc(r) + '</span> 拉铃报案 <span class="vd">' + esc(v) + '</span>';
      case 'vote':
        return '<b>' + esc(a) + '</b> ' + (e.target < 0 ? '弃权' : '投给 <span class="vd">' + esc(v) + '</span>');
      case 'chat':
        return (e.sys ? '<span class="tm">系统</span> ' : '<b>' + esc(e.who || a) + '</b>：')
          + esc(e.text);
      case 'eject':
        return '<span class="vd">' + esc(v) + '</span> 被投票驱逐（' + (e.votes || 0) + ' 票）· 身份：'
          + (e.alien ? '异形' : '人类');
      case 'detain':
        return '保安机器人在 <span class="rm">' + esc(r) + '</span> 拘留 <span class="vd">' + esc(v) + '</span>';
      case 'game_end':
        return '<b>对局结束</b> · ' + (e.win ? '人类胜利' : '异形胜利') + ' · ' + esc(e.why || '')
          + (e.prog != null ? ' · 维修 ' + e.prog + '/45' : '');
      default: return '<b>' + esc(nz(e.actor)) + '</b> ' + esc(e.kind);
    }
  }

  /* ---------------- 地图与圆点 ---------------- */
  function buildMap() {
    var host = el.shipHost;
    var svg = (global.SKHome && SKHome.buildShip) ? SKHome.buildShip(host, 'rp-ship') : null;
    if (!svg) { host.innerHTML = '<div class="rp-empty">缺少 SKHome，无法绘制船体</div>'; return null; }
    var ns = 'http://www.w3.org/2000/svg';
    gDots = document.createElementNS(ns, 'g');
    gDots.setAttribute('id', 'rp-dots');
    svg.appendChild(gDots);
    dots = {};
    for (var i = 0; i < 15; i++) {
      var c = document.createElementNS(ns, 'circle');
      var isAlien = !!(roster[i] && roster[i].alien);
      c.setAttribute('class', 'rp-dot ' + (isAlien ? 'ali' : 'hum') + (i === 0 ? ' me' : ''));
      c.setAttribute('r', '0.55');
      c.setAttribute('data-seat', String(i));
      c.setAttribute('visibility', 'hidden');
      gDots.appendChild(c);
      dots[i] = c;
    }
    ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('id', 'rp-ring');
    ring.setAttribute('class', 'rp-hit');
    ring.setAttribute('r', '2.2');
    ring.setAttribute('visibility', 'hidden');
    gDots.appendChild(ring);
    return svg;
  }

  function frameAt(pt) {
    if (!frames.length) return null;
    var lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (frames[mid].pt <= pt) lo = mid; else hi = mid - 1;
    }
    return { a: frames[lo], b: frames[Math.min(frames.length - 1, lo + 1)] };
  }

  /* 位置帧插值：只对两帧都存在的席位做线性插值，其余取最近的一帧 */
  function paintFrame(pt) {
    var pair = frameAt(pt);
    if (!pair) { for (var k in dots) dots[k].setAttribute('visibility', 'hidden'); return; }
    var a = pair.a, b = pair.b;
    var frac = 0;
    if (a !== b && b.pt > a.pt) frac = Math.max(0, Math.min(1, (pt - a.pt) / (b.pt - a.pt)));
    var mapA = {}, mapB = {};
    a.p.forEach(function (q) { mapA[q[0]] = q; });
    b.p.forEach(function (q) { mapB[q[0]] = q; });
    for (var i = 0; i < 15; i++) {
      var c = dots[i];
      var pa = mapA[i], pb = mapB[i];
      if (!pa && !pb) { c.setAttribute('visibility', 'hidden'); continue; }
      var qa = pa || pb, qb = pb || pa;
      var x = qa[1] + (qb[1] - qa[1]) * (pa && pb ? frac : 0);
      var y = qa[2] + (qb[2] - qa[2]) * (pa && pb ? frac : 0);
      var f = (pa && frac < 0.5) ? pa[3] : qb[3];
      c.setAttribute('cx', x.toFixed(2));
      c.setAttribute('cy', y.toFixed(2));
      c.setAttribute('visibility', 'visible');
      c.classList.toggle('dead', !(f & 1));
      c.classList.toggle('down', !!(f & 2));
    }
  }

  function hlRoom(rid, x, y) {
    if (!el.shipHost) return;
    var rooms = el.shipHost.querySelectorAll('.room');
    for (var i = 0; i < rooms.length; i++) {
      rooms[i].classList.toggle('on', !!rid && rooms[i].getAttribute('data-room') === rid);
    }
    if (ring) {
      if (x == null || y == null) ring.setAttribute('visibility', 'hidden');
      else {
        ring.setAttribute('cx', x);
        ring.setAttribute('cy', y);
        ring.setAttribute('visibility', 'visible');
      }
    }
  }

  /* ---------------- 时间轴 ---------------- */
  function typeOf(ev) { return ev.kind; }
  function shownEvents() {
    var f = FILTERS.find(function (q) { return q.id === filter; });
    return events.map(function (e, i) { return { e: e, i: i }; }).filter(function (o) {
      if (!f || !f.kinds) return true;
      return f.kinds.indexOf(typeOf(o.e)) >= 0;
    });
  }

  function renderList() {
    var list = shownEvents();
    if (!list.length) {
      el.list.innerHTML = '<div class="rp-empty">这类事件本局没有发生</div>';
      return;
    }
    var html = '';
    for (var n = 0; n < list.length; n++) {
      var o = list[n], e = o.e;
      html += '<div class="rp-ev" data-i="' + o.i + '">'
        + '<span class="tm">第' + (e.night || 1) + '夜 ' + fmt(e.pt) + '</span>'
        + '<span class="ic">' + (KIND_ICON[e.kind] || '·') + '</span>'
        + '<span>' + describe(e) + '</span></div>';
    }
    el.list.innerHTML = html;
    var rows = el.list.querySelectorAll('.rp-ev');
    for (var r = 0; r < rows.length; r++) {
      rows[r].onclick = function () {
        var idx = +this.getAttribute('data-i');
        var e = events[idx];
        if (!e) return;
        pause();
        seek(e.pt, e.room, e.x, e.y);
        activeEv = idx;
        var on = el.list.querySelectorAll('.rp-ev.on');
        for (var q = 0; q < on.length; q++) on[q].classList.remove('on');
        this.classList.add('on');
      };
    }
  }

  function renderFilters() {
    el.filters.innerHTML = FILTERS.map(function (f) {
      return '<button data-f="' + f.id + '"' + (f.id === filter ? ' class="on"' : '') + '>' + f.label + '</button>';
    }).join('');
    var btns = el.filters.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].onclick = function () {
        filter = this.getAttribute('data-f');
        renderFilters();
        renderList();
      };
    }
  }

  function renderMeta() {
    var res = data.result || {};
    var aliveH = roster.filter(function (r) { return !r.alien && r.alive; }).length;
    var aliveA = roster.filter(function (r) { return r.alien && r.alive; }).length;
    var humans = roster.filter(function (r) { return !r.alien; }).map(function (r) {
      return '<span class="' + (r.alive ? 'hum' : '') + '" style="' + (r.alive ? '' : 'opacity:.45') + '">' + esc(r.name) + '</span>';
    }).join('、');
    var aliens = roster.filter(function (r) { return r.alien; }).map(function (r) {
      return '<span class="' + (r.alive ? 'ali' : '') + '" style="' + (r.alive ? '' : 'opacity:.45') + '">' + esc(r.name) + '</span>';
    }).join('、');
    el.meta.innerHTML =
      '<div><b>第 ' + (res.nights || 1) + ' 夜</b> · 维修 <b>' + (res.prog == null ? '?' : res.prog) + '/' + (res.winPts || 45) + '</b>'
      + ' · 存活 人类 <span class="hum">' + aliveH + '/11</span> · 异形 <span class="ali">' + aliveA + '/4</span></div>'
      + '<div>人类：' + humans + '</div>'
      + '<div>异形：' + aliens + '</div>';
  }

  /* ---------------- 播放 / 拖动 ---------------- */
  function updateTime() {
    el.time.textContent = fmt(cur) + ' / ' + fmt(endPt);
    var slider = el.seek;
    var v = Math.round(cur * 10);
    if (slider && +slider.value !== v) slider.value = v;
  }

  function seek(pt, rid, x, y) {
    cur = Math.max(0, Math.min(endPt, +pt || 0));
    paintFrame(cur);
    if (rid !== undefined || x !== undefined) hlRoom(rid || null, x, y);
    updateTime();
    var nearest = -1, bd = 1e9;
    for (var i = 0; i < events.length; i++) {
      var d = Math.abs(events[i].pt - cur);
      if (d < bd - 1e-6) { bd = d; nearest = i; }
    }
    if (nearest >= 0 && bd < 1e-6) {
      activeEv = nearest;
      var rows = el.list.querySelectorAll('.rp-ev');
      for (var r = 0; r < rows.length; r++) {
        rows[r].classList.toggle('on', +rows[r].getAttribute('data-i') === nearest);
      }
    }
  }

  function tick(ts) {
    if (!playing) return;
    var dt = Math.min(0.25, (ts - lastTs) / 1000 || 0);
    lastTs = ts;
    cur += dt;
    if (cur >= endPt) { cur = endPt; paintFrame(cur); updateTime(); pause(); return; }
    paintFrame(cur);
    updateTime();
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (!data || !endPt) return;
    if (cur >= endPt) cur = 0;
    playing = true;
    el.play.textContent = '暂停';
    lastTs = 0;
    raf = requestAnimationFrame(function (ts) { lastTs = ts; raf = requestAnimationFrame(tick); });
  }
  function pause() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (el.play) el.play.textContent = '播放';
  }

  /* ---------------- 导出 / 导入 ---------------- */
  function download(payload) {
    if (!payload) return false;
    var text = JSON.stringify(payload);
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var d = new Date();
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      a.href = url;
      a.download = '返航录回放-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
        + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return true;
    } catch (e) {
      return false;
    }
  }

  function valid(p) {
    return !!(p && p.v === 1 && Array.isArray(p.roster) && Array.isArray(p.events));
  }

  function open(payload) {
    if (!valid(payload)) return false;
    data = JSON.parse(JSON.stringify(payload));
    roster = data.roster.slice();
    names = {};
    roster.forEach(function (r) { names[r.i] = r.name; });
    events = data.events.slice().sort(function (a, b) { return (a.pt || 0) - (b.pt || 0); });
    frames = (data.frames || []).slice().sort(function (a, b) { return (a.pt || 0) - (b.pt || 0); });
    cur = 0; activeEv = -1; filter = 'all';
    endPt = frames.length ? frames[frames.length - 1].pt
      : (events.length ? events[events.length - 1].pt : 0);

    el.root.classList.remove('hide');
    el.title.textContent = data.result && data.result.win ? '人类胜利 · 对局复盘' : '异形胜利 · 对局复盘';
    el.sub.textContent = (data.result && data.result.why ? data.result.why + ' · ' : '')
      + '事件 ' + events.length + ' 条 · 位置帧 ' + frames.length + ' 个 · 回放时长 ' + fmt(endPt)
      + (data.savedAt ? ' · 保存于 ' + data.savedAt.slice(0, 16).replace('T', ' ') : '');
    buildMap();
    renderMeta();
    renderFilters();
    renderList();
    el.seek.max = String(Math.ceil(endPt * 10));
    seek(0, null, null, null);
    hlRoom(null, null, null);
    pause();
    return true;
  }

  function close() {
    pause();
    if (el.root) el.root.classList.add('hide');
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    el.root = $('replay');
    if (!el.root) return;
    el.title = $('rp-t'); el.sub = $('rp-sub'); el.meta = $('rp-meta');
    el.filters = $('rp-filters'); el.list = $('rp-list');
    el.shipHost = $('rp-ship-host');
    el.play = $('rp-play'); el.seek = $('rp-seek'); el.time = $('rp-time');
    el.saveBtn = $('rp-save'); el.closeBtn = $('rp-close');

    el.play.onclick = function () { playing ? pause() : play(); };
    el.seek.oninput = function () {
      pause();
      seek(+this.value / 10);
    };
    el.closeBtn.onclick = close;
    el.saveBtn.onclick = function () { download(data); };
    document.addEventListener('keydown', function (e) {
      if (!el.root || el.root.classList.contains('hide')) return;
      if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); }
    }, true);

    /* 开始页：载入本地回放文件 */
    var link = $('home-replay'), file = $('home-replay-file');
    if (link && file) {
      link.onclick = function () { file.value = ''; file.click(); };
      file.onchange = function () {
        var f = file.files && file.files[0];
        if (!f) return;
        var rd = new FileReader();
        rd.onload = function () {
          var p = null;
          try { p = JSON.parse(String(rd.result || '')); } catch (err) { p = null; }
          if (!valid(p)) {
            var note = $('home-note');
            if (note) {
              note.innerHTML = '<h4>无法读取回放</h4>这不是本作导出的回放文件（缺少 <code>v:1</code> / roster / events）。';
              note.classList.add('show');
            }
            return;
          }
          open(p);
        };
        rd.readAsText(f);
      };
    }
  }

  global.SKReplay = {
    open: open,
    close: close,
    save: function (payload) { return download(payload || data); },
    isOpen: function () { return !!(el.root && !el.root.classList.contains('hide')); },
    payload: function () { return data; },
    count: function () { return el.list ? el.list.querySelectorAll('.rp-ev').length : 0; },
    seek: seek
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})(typeof window !== 'undefined' ? window : globalThis);
