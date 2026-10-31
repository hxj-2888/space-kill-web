/* =============================================================
 * SKHome · 进入游戏前的主页（返航录V3 · 2026-10-30）
 * -------------------------------------------------------------
 * 职责：   把开始页做成"船体即主视觉"：用 SKMapData 生成整船 SVG，
 *          手电遮罩跟随指针，身份卡选中时锚亮对应舱室，并填真实统计。
 * 不变量： · 只读 SKMapData，不读写对局状态、不定义游戏状态；
 *          · 不含任何业务动作：选身份与开局由 js/main.js 通过
 *            [data-role] / #home-go 驱动（本文件只发 sk:role 事件）；
 *          · 不新增资源请求（无 fetch / 无外链），file:// 直接可用；
 *          · 必须在 js/data/map.js 之后加载。
 * 对外：   window.SKHome = { refresh() }
 * ============================================================= */
(function (global) {
  'use strict';

  var M = global.SKMapData;
  if (!M) return;

  /* 身份 → 船上的锚点舱室与说明。人类看任务舱；异形看管道口；旁观看会议室。 */
  var ANCHOR = {
    human: {
      rooms: ['ecosys', 'engine', 'power', 'med', 'armory', 'cam', 'warehouse', 'transit', 'fun'],
      what: 'point', acc: '#8FA6C0',
      note: '<h4>人类 · 你在这艘船上要做什么</h4>每人派发 <b>1 高难 + 3 普通</b>共 4 个任务点，' +
        '站桩维修（普通 10 秒 / 高难 15 秒 / 电路维修 18 秒）。' +
        '亮舱整间可见，暗舱只有 7 格手电锥 + <b>2.8 格</b>近身视野。' +
        '发现尸体按 <code>R</code> 拉铃开会，凭证据投票把人驱逐出舱。'
    },
    alien: {
      rooms: ['engine', 'cam', 'armory', 'warehouse', 'transit', 'med'],
      what: 'pipe', acc: '#E0574F',
      note: '<h4>异形 · 你和同类互不认识</h4>每夜一次出刀、一次破坏技，可以钻这 6 个管道口' +
        '（<b>引擎 / 监控 / 军械 / 仓库 / 食堂 / 医疗间</b>）瞬移。' +
        '同类之间没有队友名单——只有亲眼看见对方出刀 / 钻管道 / 破坏，才会认出他是队友。' +
        '近身视野 <b>3.11 格</b>。'
    },
    spect: {
      rooms: ['bridge'], what: 'none', acc: '#7FD3F0',
      note: '<h4>旁观者 · 第 16 人</h4>不占 15 席，全知无迷雾，9 格/秒的相机幽灵。' +
        '能看不能动：不发言、不投票、不做任何局内动作，只能快进讨论。'
    }
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------- 整船 SVG（与对局同一份地图数据） ---------------- */
  function shipSVG(id) {
    var out = ['<svg id="' + (id || 'home-ship') + '" viewBox="0 0 ' + M.bounds.w + ' ' + M.bounds.h +
      '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">'];
    M.corridors.forEach(function (c) {
      out.push('<polyline class="corr" points="' + c.pts.map(function (p) {
        return p[0].toFixed(1) + ',' + p[1].toFixed(1);
      }).join(' ') + '" stroke-width="' + M.scale.corridor_w + '"/>');
    });
    M.rooms.forEach(function (r) {
      out.push('<polygon class="room ' + (r.light === 'dark' ? 'dark' : 'lit') +
        '" data-room="' + r.id + '" points="' + r.poly.map(function (p) {
          return p[0].toFixed(1) + ',' + p[1].toFixed(1);
        }).join(' ') + '"/>');
    });
    M.cover.forEach(function (c) {
      out.push('<rect class="cover" data-room="' + c.room + '" x="' + c.x + '" y="' + c.y +
        '" width="' + c.w + '" height="' + c.h + '"/>');
    });
    M.points.forEach(function (p) {
      out.push('<circle class="pt ' + (p.kind === 'hard' ? 'hard' : 'norm') +
        '" data-room="' + p.room + '" cx="' + p.x + '" cy="' + p.y + '" r="0.42"/>');
    });
    M.pipes.forEach(function (q) {
      out.push('<circle class="pipe" data-room="' + q.room + '" cx="' + q.x + '" cy="' + q.y +
        '" r="0.85"/>');
    });
    M.rooms.forEach(function (r) {
      /* 与游戏内房名一致：label 再往下 1.2 格，避免名字压在房间顶边上 */
      out.push('<text class="rlabel" x="' + r.label[0] + '" y="' + (r.label[1] + 1.2) + '">' +
        esc(r.name) + '</text>');
    });
    out.push('</svg>');
    return out.join('');
  }

  function anchors() {
    var ship = document.getElementById('home-ship');
    if (!ship) return null;
    if (ship.__idx) return ship.__idx;
    var rooms = [].slice.call(ship.querySelectorAll('.room'));
    ship.__idx = {
      ship: ship,
      rooms: rooms,
      labels: [].slice.call(ship.querySelectorAll('.rlabel')),
      covers: [].slice.call(ship.querySelectorAll('.cover')),
      pts: [].slice.call(ship.querySelectorAll('.pt')),
      pipes: [].slice.call(ship.querySelectorAll('.pipe'))
    };
    return ship.__idx;
  }

  function highlight(role) {
    var idx = anchors();
    if (!idx) return;
    var a = ANCHOR[role] || ANCHOR.human;
    var set = {};
    a.rooms.forEach(function (id) { set[id] = 1; });
    idx.ship.classList.add('hl');
    idx.ship.style.setProperty('--acc', a.acc);
    var on = {};
    idx.rooms.forEach(function (el, i) {
      var hit = !!set[el.getAttribute('data-room')];
      el.classList.toggle('on', hit);
      if (hit) on[el.getAttribute('data-room')] = 1;
      if (idx.labels[i]) idx.labels[i].classList.toggle('on', hit);
    });
    idx.covers.forEach(function (el) {
      el.classList.toggle('on', !!on[el.getAttribute('data-room')]);
    });
    idx.pts.forEach(function (el) {
      el.classList.toggle('on', a.what === 'point' && !!on[el.getAttribute('data-room')]);
    });
    idx.pipes.forEach(function (el) {
      el.classList.toggle('on', a.what === 'pipe' && !!on[el.getAttribute('data-room')]);
    });
    var note = document.getElementById('home-note');
    if (note) {
      note.innerHTML = a.note;
      note.classList.add('show');
    }
  }

  /* ---------------- 真实统计 ---------------- */
  function fillStats() {
    var wrap = document.getElementById('home-stats');
    if (!wrap) return;
    var hard = M.points.filter(function (p) { return p.kind === 'hard'; }).length;
    var items = [
      [M.rooms.length, '舱室'],
      [M.cover.length, '硬掩体'],
      [M.points.length, '任务点'],
      [hard, '高难'],
      [M.pipes.length, '管道口'],
      [45, '分返航']
    ];
    wrap.innerHTML = items.map(function (it) {
      return '<span class="chip"><b>' + it[0] + '</b>' + it[1] + '</span>';
    }).join('');
  }

  /* ---------------- 手电遮罩 ---------------- */
  function bindTorch() {
    var scene = document.getElementById('home-scene');
    var torch = document.getElementById('home-torch');
    if (!scene || !torch) return;
    scene.addEventListener('mousemove', function (e) {
      var r = scene.getBoundingClientRect();
      torch.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      torch.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  }

  /* ---------------- 身份卡 / 说明浮层 ---------------- */
  function bindUI() {
    document.addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('[data-role]') : null;
      if (card) {
        highlight(card.getAttribute('data-role'));
        return;
      }
      var link = e.target.closest ? e.target.closest('[data-home-info]') : null;
      if (!link) return;
      var note = document.getElementById('home-note');
      if (!note) return;
      var kind = link.getAttribute('data-home-info');
      if (kind === 'rules') {
        note.innerHTML = '<h4>一局怎么玩</h4>昼夜循环：白天<b>会议</b>（发言 → 投票 → 驱逐）' +
          '→ 夜晚（各自行动）→ 天亮结算维修进度。故障 30 秒没人修好扣 5 分；' +
          '人类修满 <code>45</code> 分或清出全部异形即胜利。会议不限每晚一次，' +
          '但报告即开会时尸体会清场。';
      } else if (kind === 'ship') {
        note.innerHTML = '<h4>这块船体是真的</h4>舱室轮廓 / 掩体 / 任务点 / 管道口全部取自 ' +
          '<code>js/data/map.js</code> 的 <code>SKMapData</code>，与对局用的是同一份数据；' +
          '蓝图态只是主页的读法，进局后叠上 <code>base-lit.png</code> 烘焙图与迷雾。';
      }
      note.classList.add('show');
    });
    bindTorch();
  }

  function buildShip(host, id) {
    if (!host) return null;
    host.innerHTML = shipSVG(id);
    return host.querySelector('svg');
  }

  function boot() {
    var host = document.getElementById('home-ship-host');
    if (!host) return;
    buildShip(host, 'home-ship');
    fillStats();
    bindUI();
    highlight('human');
  }

  global.SKHome = {
    /* shipSVG / buildShip：给复盘页复用同一份地图绘制，避免复制房间轮廓 */
    shipSVG: shipSVG,
    buildShip: buildShip,
    refresh: function () {
      var host = document.getElementById('home-ship-host');
      if (host) host.innerHTML = '';
      boot();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
