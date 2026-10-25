/* =============================================================
 * 返航录 · 主页「游戏预览页」交互层（批 H1）
 * -------------------------------------------------------------
 * 用户拍板：「把主页只占一小部分的方框给它打碎掉，主页就是游戏预览页」。
 *
 * 本文件只做**主页**的事，不碰对局内的任何渲染：
 *   ① 中间场景：调 SKScene.renderHomeScene() 画俯视圆桌 + 15 席
 *   ② 左右六铭牌：左三（身份图鉴/规则速览/对局回放）、右三（随机/指定阵营/联机）
 *   ③ 我这席名字牌：贴在座位上，点它 → 改身份 + 改名字
 *   ④ 设置面板：音乐 / 音效 / 速度 / 规则速览（原来散在顶栏的按钮收进来）
 *   ⑤ 状态 chip：随阵营切换更新文案
 *
 * 控件语义零变更（硬约束）：
 *   · 阵营仍写回隐藏的 input[name=fac] 并派发 change（ui.js 的联动照旧）
 *   · 自选身份仍走 #role-chip / #role-overlay / #role-grid（ui.js 的 mountRolePicker 管）
 *   · 名字只写 g.players[humanId].name **以及**本地偏好，不改引擎
 *   · 开始对局仍是 #btn-start（main.js 绑的原按钮）
 * ============================================================= */
(function (global) {
  'use strict';
  const el = id => (global.document ? global.document.getElementById(id) : null);
  const qs = (sel, root) => (root || global.document).querySelector(sel);
  const qsa = (sel, root) => Array.prototype.slice.call((root || global.document).querySelectorAll(sel));

  /* 玩家自定义名字：本地偏好（只影响显示与我这席名，不改席位表随机） */
  const NAME_KEY = 'sk.myname';
  let myName = '';

  /* 阵营文案 */
  const FAC_TXT = {
    random: { chip: '单机 · 随机阵营', plate: '随机' },
    human: { chip: '单机 · 人类阵营', plate: '人类' },
    alien: { chip: '单机 · 异形阵营', plate: '异形' },
    xeno: { chip: '单机 · 外星人', plate: '外星人' },
  };

  function readFac() {
    const r = qs('input[name="fac"]:checked');
    return r ? r.value : 'random';
  }
  function setFac(v) {
    const r = qs('input[name="fac"][value="' + v + '"]');
    if (!r) return;
    r.checked = true;
    /* 派发 change：ui.js 的阵营联动（更新 data-fac / 清掉冲突身份）靠它 */
    r.dispatchEvent(new Event('change', { bubbles: true }));
    syncChip();
    syncPlates();
  }
  function syncChip() {
    const c = el('arena-chip');
    if (c) c.textContent = (FAC_TXT[readFac()] || FAC_TXT.random).chip;
  }
  function syncPlates() {
    const fac = readFac();
    const on = el('ch-random'), f = el('ch-faction');
    if (on) on.classList.toggle('on', fac === 'random');
    if (f) f.classList.toggle('on', fac !== 'random');
    /* 「指定阵营」铭牌的副标题跟着当前阵营走，玩家一眼看到选了什么 */
    const sub = f && f.querySelector('small');
    if (sub) sub.textContent = fac === 'random' ? '人类 / 异形 / 外星人' : (FAC_TXT[fac] || {}).plate || '';
  }

  /* ---------------- 中间场景 ---------------- */
  function renderStage() {
    const host = el('arena-stage');
    if (!host || !global.SKScene || !global.SKScene.renderHomeScene) return;
    try {
      global.SKScene.renderHomeScene(host, {
        myName: myName,
        onSeatClick: openSeatPanel,
      });
      positionTag();
    } catch (e) { /* 场景失败不影响开局 */ }
  }

  /* 名字牌跟着「我这席」的座位走 */
  function positionTag() {
    const tag = el('seat-tag'), host = el('arena-stage');
    if (!tag || !host) return;
    const seat = qs('[data-home-seat="me"]', host);
    if (!seat) { tag.classList.add('hidden'); return; }
    const sr = seat.getBoundingClientRect(), hr = host.getBoundingClientRect();
    tag.style.left = (sr.left - hr.left + sr.width / 2) + 'px';
    tag.style.top = (sr.top - hr.top - 30) + 'px';
    tag.style.transform = 'translate(-50%, -100%)';
    tag.classList.remove('hidden');
    const nm = el('seat-tag-name');
    if (nm) nm.textContent = myName || '玄武岩';
  }

  /* ---------------- 我这席：改身份 + 改名字 ---------------- */
  function openSeatPanel() {
    /* 身份：复用既有 #role-overlay（ui.js 的 mountRolePicker 已渲染好 #role-grid） */
    const ov = el('role-overlay');
    if (!ov) return;
    const inp = el('arena-myname');
    if (inp) { inp.value = myName; }
    ov.classList.remove('hidden');
  }

  function commitName(v) {
    const s = String(v || '').trim().slice(0, 8);
    myName = s;
    try { global.localStorage.setItem(NAME_KEY, s); } catch (_) {}
    /* 写回引擎里的真人席位（只在开局前有效；开局后改的是显示名，不改规则） */
    try {
      const g = global.Game && global.Game.g;
      if (g && g.players && g.humanId) {
        const me = g.players.find(p => p.id === g.humanId);
        if (me && s) me.name = s;
      }
    } catch (_) {}
    const nm = el('seat-tag-name');
    if (nm) nm.textContent = s || '玄武岩';
    renderStage();
  }

  /* ---------------- 指定阵营弹层 ---------------- */
  function buildFactionPicker() {
    const host = el('faction-pick-arena');
    if (!host) return;
    const items = [
      { v: 'random', n: '随机', d: '系统分配阵营' },
      { v: 'human', n: '人类', d: '修船 · 查验 · 撑到倒计时归零' },
      { v: 'alien', n: '异形', d: '潜伏 · 击杀 · 感染' },
      { v: 'xeno', n: '外星人', d: '独狼搅局 · 夜行免疫' },
    ];
    host.innerHTML = items.map(it =>
      '<button class="plate fpk' + (readFac() === it.v ? ' on' : '') + '" data-fac="' + it.v + '" type="button">'
      + '<span><b>' + it.n + '</b><small>' + it.d + '</small></span></button>').join('');
    qsa('.fpk', host).forEach(b => {
      b.onclick = () => {
        setFac(b.getAttribute('data-fac'));
        qsa('.fpk', host).forEach(x => x.classList.toggle('on', x === b));
        const ov = el('faction-overlay');
        if (ov) ov.classList.add('hidden');
      };
    });
  }

  /* ---------------- 身份图鉴 ---------------- */
  function buildCodex() {
    const host = el('codex-grid');
    if (!host || host.__built) return;
    const RD = global.SKRoleDecl;
    if (!RD || !RD.ROLE_DECL) return;
    const D = global.SKData || {};
    const roleName = k => (global.NLP && global.NLP.ROLE_NAME && global.NLP.ROLE_NAME[k]) || k;
    const facName = k => ({ human: '人类', alien: '异形', xeno: '外星人' }[k] || k);
    const rows = [];
    for (const k in RD.ROLE_DECL) {
      const d = RD.ROLE_DECL[k];
      if (!d || d.life === 'archived') continue;
      rows.push('<div class="cdx"><b>' + roleName(k) + '</b>'
        + '<em class="f-' + (d.faction || 'human') + '">' + facName(d.faction) + '</em>'
        + '<span>' + (d.desc || d.summary || d.note || '—') + '</span></div>');
    }
    host.innerHTML = rows.join('') || '<p class="tiny">身份表为空</p>';
    host.__built = true;
  }

  /* ---------------- 设置面板 ---------------- */
  function toggleSettings(force) {
    const p = el('settings-panel');
    if (!p) return;
    const show = force == null ? p.classList.contains('hidden') : force;
    p.classList.toggle('hidden', !show);
    const b = el('btn-settings');
    if (b) b.classList.toggle('on', show);
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    try { myName = (global.localStorage.getItem(NAME_KEY) || '').trim(); } catch (_) {}

    /* 右侧三铭牌 */
    const rnd = el('ch-random'), fac = el('ch-faction'), onl = el('ch-online');
    if (rnd) rnd.onclick = () => setFac('random');
    if (fac) fac.onclick = () => {
      buildFactionPicker();
      const ov = el('faction-overlay');
      if (ov) ov.classList.remove('hidden');
    };
    if (onl) onl.onclick = () => { /* 联机未上线：铭牌自带 dim，不响应 */ };

    /* 左侧三铭牌 */
    const codex = el('btn-codex'), rules = el('btn-rules-home'), replay = el('btn-replay-home');
    if (codex) codex.onclick = () => {
      buildCodex();
      const ov = el('codex-overlay');
      if (ov) ov.classList.remove('hidden');
    };
    if (rules) rules.onclick = () => {
      const ov = el('rules-overlay');
      if (ov) { ov.classList.remove('hidden'); ov.scrollTop = 0; }
    };
    if (replay) replay.onclick = () => {
      /* 对局回放：复用结算页既有的 #replay-box / renderReplayBody。
         ⚠ 红线 K3：**不得直接读 g.replay** —— 回放内容只能经 View.replayOf(g) 发放
         （2.6.3 终局后全体可看完整回放）。这里按该口径取一次。 */
      const game = global.Game && global.Game.g;
      let flow = null;
      try { flow = (game && global.View && global.View.replayOf) ? global.View.replayOf(game) : null; } catch (_) {}
      if (flow && ((flow.events && flow.events.length) || (flow.nights && flow.nights.length))) {
        try { global.UI.renderReplayBody(game); } catch (_) {}
        const box = el('replay-box');
        if (box) box.classList.remove('hidden');
      } else {
        flashNote('还没有可回放的对局 · 先打一局');
      }
    };

    /* 设置 */
    const setBtn = el('btn-settings');
    if (setBtn) setBtn.onclick = e => { e.stopPropagation(); toggleSettings(); };
    global.document.addEventListener('click', e => {
      const p = el('settings-panel');
      if (!p || p.classList.contains('hidden')) return;
      if (e.target.closest && (e.target.closest('#btn-settings') || e.target.closest('#settings-panel'))) return;
      toggleSettings(false);
    });
    const tempo = el('arena-tempo');
    if (tempo && global.SKAudio) {
      tempo.oninput = () => {
        const r = global.SKAudio.setRate(tempo.value);
        const t2 = el('tempo-slider'); if (t2) { t2.value = tempo.value; }
        const tv = el('tempo-val'); if (tv) tv.textContent = '×' + r.toFixed(2);
      };
      tempo.onchange = () => { if (global.SKAudio) global.SKAudio.sfx('tick'); };
    }

    /* 我这席名字牌 */
    const tag = el('seat-tag');
    if (tag) tag.onclick = openSeatPanel;

    /* 名字输入：改名即时生效 */
    const inp = el('arena-myname');
    if (inp) {
      inp.oninput = () => commitName(inp.value);
      inp.onchange = () => commitName(inp.value);
    }

    /* 弹层关闭 */
    const closeAll = (id, ovId) => {
      const b = el(id); if (b) b.onclick = () => { const o = el(ovId); if (o) o.classList.add('hidden'); };
      const o = el(ovId);
      if (o) o.onclick = e => { if (e.target === o) o.classList.add('hidden'); };
    };
    closeAll('role-close', 'role-overlay');
    closeAll('faction-close', 'faction-overlay');
    closeAll('codex-close', 'codex-overlay');

    /* 预览版铭牌：点开/收起全文 */
    const note = el('preview-note');
    if (note) note.onclick = () => note.classList.toggle('open');

    /* 阵营变化时同步 chip 与铭牌（ui.js 也会派发 change） */
    qsa('input[name="fac"]').forEach(r => r.addEventListener('change', () => {
      syncChip(); syncPlates();
    }));

    syncChip(); syncPlates();
    renderStage();
    global.addEventListener('resize', positionTag);
  }

  let noteTimer = null;
  function flashNote(txt) {
    const n = el('arena-stage');
    if (!n) return;
    let t = n.querySelector('.arena-flash');
    if (!t) { t = global.document.createElement('div'); t.className = 'arena-flash'; n.appendChild(t); }
    t.textContent = txt;
    t.classList.add('on');
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(() => t.classList.remove('on'), 1800);
  }

  global.SKArena = {
    init: init, setFac: setFac, syncChip: syncChip, renderStage: renderStage,
    positionTag: positionTag, openSeatPanel: openSeatPanel, commitName: commitName,
    get myName() { return myName; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
