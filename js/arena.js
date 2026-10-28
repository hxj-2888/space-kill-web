/* =============================================================
 * 新返航录 · 主页「游戏预览页」交互层（批 H1）
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
    /* 〔批 UI-1〕「指定角色」铭牌的副标题由 syncStepChips() 统一负责
       （它知道「选了哪个角色」，信息量比「哪个阵营」更准确）。
       这里只在**还没选角色**时给一个阵营级兜底，避免与 syncStepChips 互相覆盖。 */
    const cur = (global.UI && global.UI.preferredRole) ? global.UI.preferredRole() : null;
    if (f && !cur) {
      f.classList.toggle('on', fac !== 'random');
      const sub = f.querySelector('small');
      if (sub) sub.textContent = fac === 'random'
        ? '先阵营，再角色'
        : ((FAC_TXT[fac] || {}).plate || '') + ' · 待选角色';
    }
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
    /* 〔批 UI-5 · 2026-10-26〕★ 原点必须是**名字牌自己的 offsetParent**，
       而不是 arena-stage。实测（1600×900）：
         · arena-stage 是中间列（left/right 各 250px），内部 <svg> 按 meet 缩放后只占中间一条；
         · 而 .seat-tag 的 offsetParent 是 `.start-box`（07-start-scene.css:88 给
           `.start-box > *` 统一加了 position:relative），它的左上角在视口 (0,0) 附近；
         · 旧代码用 `sr.left - hr.left`（减去 arena-stage 原点）去写一个相对
           .start-box 的坐标 ⇒ 名字牌算到 x=-209，直接跑出视口左侧，用户看不到「我这席」。
       现在：按 offsetParent 的真实原点换算，并把牌压到座位正上方。 */
    const ob = (tag.offsetParent && tag.offsetParent.getBoundingClientRect)
      ? tag.offsetParent.getBoundingClientRect()
      : { left: 0, top: 0 };
    const sr = seat.getBoundingClientRect();
    tag.style.left = (sr.left - ob.left + sr.width / 2) + 'px';
    tag.style.top = (sr.top - ob.top - 8) + 'px';
    tag.style.transform = 'translate(-50%, -100%)';
    tag.classList.remove('hidden');
    const nm = el('seat-tag-name');
    if (nm) nm.textContent = myName || '玄武岩';
  }

  /* ---------------- 我这席：改名 + 只读看当前身份 ----------------
     〔批 UI-1〕用户要求「指定阵营改为指定角色」并「合并成一个入口」，
     故本面板**不再承载身份选择**（那是 #faction-overlay 第二级的事），
     只保留：改名 + 展示当前选定的身份 + 一个跳去「指定角色」的按钮。 */
  function openSeatPanel() {
    const ov = el('role-overlay');
    if (!ov) return;
    const inp = el('arena-myname');
    if (inp) { inp.value = myName; }
    renderMySeatInfo();
    ov.classList.remove('hidden');
  }

  /* 「我这席」里的只读身份卡 */
  function renderMySeatInfo() {
    const host = el('my-seat-info');
    if (!host) return;
    const RD = global.SKRoleDecl;
    const cur = (global.UI && global.UI.preferredRole) ? global.UI.preferredRole() : null;
    const fac = readFac();
    const facName = k => ({ random: '随机', human: '人类', alien: '异形', xeno: '外星人' }[k] || k);
    const lines = [];
    lines.push('当前名字：<b>' + esc(myName || '玄武岩') + '</b>');
    if (cur) {
      const d = (RD && RD.ROLE_DECL && RD.ROLE_DECL[cur]) || {};
      lines.push('已指定身份：<em>' + roleNameOf(cur) + '</em>（' + facName(d.faction) + '）');
      lines.push('<span class="tiny" style="color:#6f93b6">开局时你会坐进这个身份对应的席位；'
        + '若该席位本局掷出另一个变体，系统会锁定成你选的这个。</span>');
    } else {
      lines.push('已指定身份：<b>未选择</b>（由系统随机分配）');
      lines.push('<span class="tiny" style="color:#6f93b6">当前阵营偏好：' + facName(fac) + '</span>');
    }
    host.innerHTML = lines.join('<br/>');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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

  /* =============================================================
   * 指定角色（批 UI-1：由「指定阵营」升级为两级选择）
   * -------------------------------------------------------------
   * 用户原话：「指定阵营应当可以选择具体角色，指定阵营改为指定角色，
   *            点开后先选择阵营再选择阵营对应角色」。
   *
   * 两级：
   *   ① 阵营：随机 / 人类 / 异形 / 外星人
   *   ② 角色：该阵营里「可选」的身份 —— 由声明层派生，**不写死清单**
   *      （RD.selectable(k) 已排除「只能经转职获得」的三个职业）
   *
   * 与既有接口的关系（控件语义零变更）：
   *   · 选阵营仍写回隐藏的 input[name=fac] 并派发 change（ui.js 的联动照旧）
   *   · 选角色仍走 UI.rpPick(key) —— 它会自动把阵营跟着改成该角色所属阵营，
   *     并在开局时经 UI.preferredRole() 传给 Setup.rollSeatPicks
   *   · 「随机」= setFac('random') + UI.rpPick(null)，与接入前完全等价
   *
   * 为什么「异形」只有一张卡也要做第二级：用户明确要「先阵营再角色」，
   * 而且外星人阵营有「外星人 / 死囚外星人」两个（1.1.1 席位变体），
   * 保持两级结构一致，玩家不用记「哪个阵营只有一个」。
   * ============================================================= */
  const FAC_ORDER = ['random', 'human', 'alien', 'xeno'];
  const FAC_LABEL = {
    random: { n: '随机', d: '系统分配阵营与角色' },
    human: { n: '人类', d: '11 席 · 修船 / 查验 / 撑到倒计时归零' },
    alien: { n: '异形', d: '3 席 · 潜伏 / 击杀 / 感染' },
    xeno: { n: '外星人', d: '1 席 · 独狼搅局 · 夜行免疫' },
  };

  /* 当前两级状态（与 RP_STATE 不重复：RP_STATE 是「最终选定的角色」，
     这里只是「面板此刻停在哪个阵营」） */
  let facPicked = null;

  function roleNameOf(k) {
    return (global.NLP && global.NLP.ROLE_NAME && global.NLP.ROLE_NAME[k])
      || (global.SKData && global.SKData.ROLES && global.SKData.ROLES[k] && global.SKData.ROLES[k].name)
      || k;
  }

  /* 某阵营下可选的角色键（声明层派生；按组位顺序便于横向比较） */
  function rolesOfFac(fac) {
    const RD = global.SKRoleDecl;
    if (!RD || !RD.ROLE_DECL) return [];
    const out = [];
    for (const k of RD.keys()) {
      if (!RD.selectable(k)) continue;
      const d = RD.ROLE_DECL[k];
      if (!d || d.faction !== fac) continue;
      out.push(k);
    }
    return out;
  }

  /* ① 阵营网格 */
  function buildFactionPicker() {
    const host = el('faction-pick-arena');
    if (!host) return;
    host.innerHTML = FAC_ORDER.map(v => {
      const L = FAC_LABEL[v];
      return '<button class="plate fpk' + (facPicked === v ? ' on' : '') + '" data-fac="' + v + '" type="button">'
        + '<span><b>' + L.n + '</b><small>' + L.d + '</small></span></button>';
    }).join('');
    qsa('.fpk', host).forEach(b => {
      b.onclick = () => { pickFac(b.getAttribute('data-fac')); };
    });
  }

  /* ② 角色网格（只列该阵营可选项） */
  function buildRolePicker(fac) {
    const host = el('fac-roles');
    if (!host) return;
    if (!fac || fac === 'random') { host.innerHTML = ''; return; }
    const keys = rolesOfFac(fac);
    if (!keys.length) {
      host.innerHTML = '<div class="evt info">该阵营暂无可直接指定的角色。</div>';
      return;
    }
    const cur = (global.UI && global.UI.preferredRole) ? global.UI.preferredRole() : null;
    host.innerHTML = keys.map(k => {
      const d = (global.SKRoleDecl.ROLE_DECL || {})[k] || {};
      const on = cur === k;
      const claim = (global.Setup && global.Setup.seatClaim) ? global.Setup.seatClaim(k) : null;
      const variant = claim && claim.variant ? '<span class="rp-tag rp-tag-v">变体 ' + claim.variant + '</span>' : '';
      return '<button type="button" class="rp-card f-' + (d.faction || fac) + (on ? ' active' : '') + '"'
        + ' data-role="' + k + '" aria-pressed="' + (on ? 'true' : 'false') + '">'
        + '<span class="rp-bar"></span>'
        + '<span class="rp-nm">' + roleNameOf(k) + variant + '</span>'
        + '<span class="rp-ds">' + (d.desc || d.summary || d.note || '') + '</span>'
        + '</button>';
    }).join('');
    qsa('.rp-card', host).forEach(b => {
      b.onclick = () => {
        const k = b.getAttribute('data-role');
        if (global.UI && global.UI.rpPick) global.UI.rpPick(k);   /* 会连带把阵营改成该角色所属阵营 */
        syncStepChips();
        syncPlates();
        const ov = el('faction-overlay');
        if (ov) ov.classList.add('hidden');
        flashNote('已选身份：' + roleNameOf(k));
      };
    });
  }

  function pickFac(fac) {
    facPicked = fac;
    qsa('#faction-pick-arena .fpk').forEach(x =>
      x.classList.toggle('on', x.getAttribute('data-fac') === fac));
    if (fac === 'random') {
      setFac('random');
      if (global.UI && global.UI.rpPick) global.UI.rpPick(null);   /* 随机 = 连身份也交回系统 */
      buildRolePicker(null);
      syncStepChips();
      const ov = el('faction-overlay');
      if (ov) ov.classList.add('hidden');
      flashNote('已设为随机（阵营与角色都由系统分配）');
      return;
    }
    setFac(fac);
    buildRolePicker(fac);
    syncStepChips();
    const step2 = el('fac-step-2');
    if (step2) step2.classList.add('on');
  }

  /* 两级进度条上的文字 */
  function syncStepChips() {
    const fac = facPicked;
    const cur = (global.UI && global.UI.preferredRole) ? global.UI.preferredRole() : null;
    const v1 = el('fac-step-1-v'), v2 = el('fac-step-2-v');
    const s1 = el('fac-step-1'), s2 = el('fac-step-2');
    if (v1) v1.textContent = fac ? (FAC_LABEL[fac] || {}).n || fac : '未选';
    if (v2) v2.textContent = cur ? roleNameOf(cur) : (fac && fac !== 'random' ? '待选' : '先选阵营');
    if (s1) { s1.classList.toggle('on', !!fac && !cur); s1.classList.toggle('done', !!fac); }
    if (s2) { s2.classList.toggle('done', !!cur); s2.classList.toggle('on', !!fac && !cur); }
    /* 「指定角色」铭牌的副标题跟着走，玩家一眼看到选了什么 */
    const plate = el('ch-faction');
    const sub = plate && plate.querySelector('small');
    if (sub) {
      sub.textContent = cur ? roleNameOf(cur)
        : (fac && fac !== 'random' ? ((FAC_LABEL[fac] || {}).n || fac) + ' · 待选角色'
          : '先阵营，再角色');
    }
    if (plate) plate.classList.toggle('on', !!cur || (!!fac && fac !== 'random'));
  }


  /* =============================================================
   * 〔批 UI-8c · 2026-10-27〕对局回放存档浮层
   * -------------------------------------------------------------
   * 用户要求：主页点「对局回放」要能看到最近的对局；只有点「保存本局」才存；
   *          最多 3 局、满了覆盖最旧、可勾选删除一局或多局。
   *
   * 纪律：本函数**不读 g.replay**（K3）。它只读 SKReplayStore —— 而存档里的 replay
   *      当初也是结算页经 View.replayOf() 取到后写进去的。
   * ============================================================= */
  let rpSel = {};              /* 勾选中的存档 id */
  let rpOpenId = null;         /* 正在看哪一条 */

  function openReplayArchive() {
    const S = global.SKReplayStore;
    const ov = el('replay-overlay');
    if (!S || !ov) return;
    rpSel = {}; rpOpenId = null;
    renderReplayArchive();
    ov.classList.remove('hidden');
    ov.scrollTop = 0;
  }

  function closeReplayArchive() {
    const ov = el('replay-overlay');
    if (ov) ov.classList.add('hidden');
  }

  function fmtTime(t) {
    if (!t) return '—';
    const d = new Date(t);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
      + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderReplayArchive() {
    const S = global.SKReplayStore;
    const host = el('replay-archive-list');
    const body = el('replay-archive-body');
    const hint = el('replay-archive-hint');
    const delBtn = el('btn-replay-del');
    const clrBtn = el('btn-replay-clear');
    if (!S || !host) return;
    const arr = S.list();

    if (hint) hint.textContent = arr.length ? ('已存 ' + arr.length + ' / ' + S.MAX + ' 局') : '';
    if (clrBtn) clrBtn.disabled = !arr.length;
    if (delBtn) delBtn.disabled = !Object.keys(rpSel).length;

    if (!arr.length) {
      host.innerHTML = '<div class="hint">还没有保存过对局。打完一局后，在结算页点「保存本局」'
        + '（最多存 ' + S.MAX + ' 局，满了会自动覆盖最旧的一局）。</div>';
      if (body) body.innerHTML = '';
      return;
    }

    host.innerHTML = arr.map(function (r, i) {
      const sel = !!rpSel[r.id];
      const open = rpOpenId === r.id;
      const win = { human: '人类胜', alien: '异形胜', xeno: '外星人胜', draw: '平局' }[r.winner] || '—';
      const mine = (r.players || []).filter(function (p) { return p.id === r.humanId; })[0];
      return '<div class="rp-arc' + (open ? ' open' : '') + '" data-id="' + esc(r.id) + '">'
        + '<label class="rp-arc-c"><input type="checkbox" data-sel="' + esc(r.id) + '"'
        + (sel ? ' checked' : '') + '/></label>'
        + '<div class="rp-arc-main">'
        + '<b>' + esc(win) + '</b>'
        + '<span class="rp-arc-d">' + esc(fmtTime(r.savedAt))
        + ' · ' + (r.night != null ? r.night + ' 夜' : '—')
        + (mine ? ' · 你是 ' + mine.id + ' 号' : '') + '</span>'
        + '</div>'
        + '<button class="act tiny" data-open="' + esc(r.id) + '">' + (open ? '收起' : '查看') + '</button>'
        + '</div>';
    }).join('');

    host.querySelectorAll('[data-sel]').forEach(function (cb) {
      cb.onchange = function () {
        const id = cb.getAttribute('data-sel');
        if (cb.checked) rpSel[id] = 1; else delete rpSel[id];
        if (delBtn) delBtn.disabled = !Object.keys(rpSel).length;
      };
    });
    host.querySelectorAll('[data-open]').forEach(function (b) {
      b.onclick = function () {
        const id = b.getAttribute('data-open');
        rpOpenId = (rpOpenId === id) ? null : id;
        renderReplayArchive();
      };
    });

    /* 展开某一条：直接把存下来的 replay 流渲染成与结算页同款的列表 */
    if (body) {
      const rec = rpOpenId ? S.get(rpOpenId) : null;
      body.innerHTML = rec ? archiveBodyHtml(rec) : '';
    }
  }

  /* 存档里的回放流渲染：字段与结算页 renderReplayBody 一致（scope/text/batch/night/step） */
  function archiveBodyHtml(rec) {
    const E = global.SKEngine || global.Engine || null;
    const stepName = function (s) {
      try { return (global.SKEngine && global.SKEngine.STEP_NAME && global.SKEngine.STEP_NAME[s]) || s || '流程'; }
      catch (_) { return s || '流程'; }
    };
    let html = '', cur = null;
    (rec.replay || []).forEach(function (e) {
      const key = e.night + '/' + (e.step || '');
      if (key !== cur) {
        cur = key;
        html += '<div class="sec">第 ' + e.night + ' 夜 · ' + esc(stepName(e.step)) + '</div>';
      }
      if (e.scope === 'god') html += '<div class="god">▸ ' + esc(e.text) + '</div>';
      else if (e.scope === 'priv') html += '<div class="prv">私密→' + esc(e.who) + '号：' + esc(e.text) + '</div>';
      else html += '<div class="logline"><span class="b">' + esc(e.batch || '') + '</span> ' + esc(e.text) + '</div>';
    });
    return html || '<div class="empty">这一局没有回放记录</div>';
  }

  /* =============================================================
   * 〔批 UI-8c · 2026-10-27〕规则速览：三份子文件 → 玩家能看懂的三页
   * -------------------------------------------------------------
   * 用户要求：「游戏内直接就可以看到那三个 PDF，而且也不需要把 PDF 完完整整写出来，
   *          把它改写成玩家能看懂的形式即可」；「把 V6.6 的全部移除掉」。
   *
   * 数据源：js/data/rules.js（由 tools/gen-rules-data.py 从三份 v1preview1.0 PDF 抽取）。
   * 本文件**只做排版**，不改写任何判定文字（红线 5）。
   *
   * 三页：
   *   ① 职业速查 —— 每张卡六个字段（夜间行动/核心能力/额度/目标限制/可见性/封锁）+ 备注
   *   ② 术语表   —— 术语 / 含义 / 出处 三列
   *   ③ 判定流程 —— 逐页给节点与连线说明
   * ============================================================= */
  let rlTab = 'cards';

  /* 〔批 SHIP-2 · 2026-10-27〕★ 首局自动弹出的规则速览**永远停在「正在载入规则数据…」**
     -------------------------------------------------------------
     现象（真实首启复现）：第一次进对局时 `ui.js render()` 自动调用 `openRules()`，
     浮层打开、标题正确、正文却一直是 index.html 里那句占位文案，三个页签一个都没有；
     关掉再点主页「规则速览」铭牌就正常（3 页签 / 14 张卡）。
     根因：`openRules()` 只 `classList.remove('hidden')`，**从不调 renderRules()**。
       能渲染的那条路径是 arena.js 里 `#btn-rules-home` 的 onclick —— 它自己带了
       `renderRules()`。于是"打开规则"这一个动作有两份实现，一份渲染、一份不渲染，
       而自动弹出的那条走的是不渲染的那份。
     为什么门禁没报：`test-rules-data.cjs` 量的是 `js/data/rules.js` 的内容（8 条全绿），
       `check-docs` 量的是链接。**没有一条断言走"打开浮层"这条路** ——
       与红线 9「元素存在 ≠ 像素可见」同源：数据在、浮层在，屏幕上是空的。

     修法：把渲染收进 `openRules()`（唯一入口），并让 arena 那条 onclick 直接复用
     `SKUI.openRules()`，不再自己写一份。这样"打开规则"只剩一条路。 */
  function rulesData() { return global.SKRules || null; }

  function escR(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* 卡面字段的展示名（与 PDF 的列名一致，不改词） */
  const FIELD_ORDER = ['夜间行动', '核心能力', '额度与到账', '额度', '次数', '自救',
    '目标限制', '对象', '判定基准', '层序', '可见性', '封锁', '要点'];

  function renderRules() {
    const host = document.getElementById('rg-body');
    const D = rulesData();
    if (!host) return;
    if (!D) { host.innerHTML = '<div class="hint">规则数据未加载（js/data/rules.js）</div>'; return; }

    /* 页签 */
    const tabs = [
      { k: 'cards', n: '职业速查', c: (D.cards || []).length },
      { k: 'gloss', n: '术语表', c: (D.glossary || []).length },
      { k: 'flow', n: '判定流程', c: (D.flow || []).length },
    ];
    let html = '<div class="rg-tabs">' + tabs.map(function (t) {
      return '<button class="rg-tab' + (rlTab === t.k ? ' on' : '') + '" data-rg="' + t.k + '">'
        + escR(t.n) + '<i>' + t.c + '</i></button>';
    }).join('') + '</div>';

    if (rlTab === 'cards') html += renderCards(D);
    else if (rlTab === 'gloss') html += renderGlossary(D);
    else html += renderFlow(D);

    host.innerHTML = html;
    host.querySelectorAll('[data-rg]').forEach(function (b) {
      b.onclick = function () { rlTab = b.getAttribute('data-rg'); renderRules(); };
    });
    /* 职业卡点击展开/收起（默认只显示前三个字段，点击看全部） */
    host.querySelectorAll('[data-rc]').forEach(function (el) {
      el.onclick = function (e) {
        if (e.target.closest('[data-rc-notecopy]')) return;
        el.classList.toggle('open');
      };
    });
  }

  function renderCards(D) {
    if (!D.cards || !D.cards.length) return '<div class="hint">没有解析到职业卡</div>';
    const FAC = { human: '人类', alien: '异形', xeno: '外星人' };
    return '<div class="rg-cards">' + D.cards.map(function (c) {
      const keys = FIELD_ORDER.filter(function (k) { return c.fields && c.fields[k]; });
      return '<div class="rg-card f-' + escR(c.faction) + '" data-rc>'
        + '<div class="rgc-head"><b>' + escR(c.name) + '</b>'
        + '<em>' + escR(FAC[c.faction] || c.faction) + '</em>'
        + (c.seat ? '<span class="rgc-seat">' + escR(c.seat) + '</span>' : '')
        + '<i class="rgc-more">展开</i></div>'
        + '<div class="rgc-body">'
        + keys.map(function (k) {
          return '<div class="rgc-f"><b>' + escR(k) + '</b><p>' + escR(c.fields[k]) + '</p></div>';
        }).join('')
        + (c.notes && c.notes.length
          ? '<div class="rgc-notes">' + c.notes.map(function (n) {
              return '<p>' + escR(n) + '</p>';
            }).join('') + '</div>'
          : '')
        + '</div></div>';
    }).join('') + '</div>';
  }

  function renderGlossary(D) {
    if (!D.glossary || !D.glossary.length) return '<div class="hint">没有解析到术语</div>';
    return '<div class="rg-gloss">' + D.glossary.map(function (t) {
      return '<div class="rg-g"><b>' + escR(t.term) + '</b>'
        + '<p>' + escR(t.mean) + '</p>'
        + (t.ref ? '<i>' + escR(t.ref) + '</i>' : '')
        + '</div>';
    }).join('') + '</div>';
  }

  function renderFlow(D) {
    if (!D.flow || !D.flow.length) return '<div class="hint">没有解析到流程图</div>';
    return '<div class="rg-flow">' + D.flow.map(function (p) {
      return '<div class="rg-f"><div class="rgf-h">第 ' + p.page + ' 页 · ' + escR(p.title) + '</div>'
        + '<div class="rgf-b">' + p.lines.map(function (l) {
          return '<p>' + escR(l) + '</p>';
        }).join('') + '</div></div>';
    }).join('') + '</div>';
  }
  /* ---------------- 身份图鉴 ---------------- */
  function buildCodex() {
    const host = el('codex-grid');
    if (!host) return;
    const RD = global.SKRoleDecl;
    if (!RD || !RD.ROLE_DECL) return;
    const facName = k => ({ human: '人类', alien: '异形', xeno: '外星人' }[k] || k);
    /* 按阵营分组 + 组位顺序；只列非 archived 的（archived = 九关合规留痕，不是可用身份） */
    const groups = { human: [], alien: [], xeno: [] };
    for (const k of RD.keys()) {
      const d = RD.ROLE_DECL[k];
      if (!d || d.life === 'archived') continue;
      (groups[d.faction] || (groups[d.faction] = [])).push(k);
    }
    const order = g => (RD.GROUP_TABLE[g] && RD.GROUP_TABLE[g].seatOrder != null)
      ? RD.GROUP_TABLE[g].seatOrder : 99;
    const rows = [];
    let total = 0;
    for (const fac of FAC_ORDER.filter(f => f !== 'random')) {
      const ks = (groups[fac] || []).slice().sort((a, b) =>
        order((RD.ROLE_DECL[a] || {}).group) - order((RD.ROLE_DECL[b] || {}).group));
      if (!ks.length) continue;
      rows.push('<div class="cdx-head f-' + fac + '">' + facName(fac) + ' · ' + ks.length + ' 个</div>');
      for (const k of ks) {
        total++;
        const d = RD.ROLE_DECL[k];
        /* 转职系单列标注：它们只能经转职获得（4.2 / 4.1.2），不在席位表里 */
        const transferable = !RD.selectable(k);
        const seat = (global.Setup && global.Setup.seatClaim) ? global.Setup.seatClaim(k) : null;
        const tags = [];
        if (transferable) tags.push('<span class="rp-tag">转职获得</span>');
        if (seat && seat.variant) tags.push('<span class="rp-tag rp-tag-v">变体 ' + seat.variant + '</span>');
        rows.push('<div class="cdx" data-role="' + k + '"><b>' + roleNameOf(k) + tags.join('') + '</b>'
          + '<em class="f-' + (d.faction || 'human') + '">' + facName(d.faction) + '</em>'
          + '<span>' + (d.desc || d.summary || d.note || '—') + '</span></div>');
      }
    }
    host.innerHTML = rows.join('') || '<p class="tiny">身份表为空</p>';
    const sub = document.querySelector('#codex-overlay-title .rp-sub');
    if (sub) sub.textContent = total + ' 个身份 · 由声明层派生';
    /* 左侧铭牌上的数字跟着走（原先写死「17 种身份与技能」，与声明层 20 个键不符） */
    const cnt = document.getElementById('codex-count');
    if (cnt) cnt.textContent = total + ' 个身份';
    host.__built = true;   /* 保留标记，供既有代码判断「已构建」 */
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
    if (rnd) rnd.onclick = () => {
      if (global.UI && global.UI.rpPick) global.UI.rpPick(null);
      setFac('random');
      facPicked = 'random';
      syncStepChips();
      syncPlates();
      flashNote('已设为随机（阵营与角色都由系统分配）');
    };
    if (fac) fac.onclick = () => {
      /* 打开时按当前状态预置两级：选了角色就从它所属阵营展开，否则停在「未选」 */
      if (!facPicked) {
        const cur = (global.UI && global.UI.preferredRole) ? global.UI.preferredRole() : null;
        facPicked = cur ? ((global.SKRoleDecl.ROLE_DECL[cur] || {}).faction || null) : null;
      }
      buildFactionPicker();
      buildRolePicker(facPicked);
      syncStepChips();
      const ov = el('faction-overlay');
      if (ov) ov.classList.remove('hidden');
    };
    if (onl) onl.onclick = () => { /* 联机未上线：铭牌自带 dim，不响应 */ };

    /* 两级进度条可点：第 ① 步回到阵营列表，第 ② 步在已选阵营内重选角色 */
    const st1 = el('fac-step-1'), st2 = el('fac-step-2');
    if (st1) st1.onclick = () => {
      facPicked = null;
      buildFactionPicker();
      buildRolePicker(null);
      syncStepChips();
    };
    if (st2) st2.onclick = () => {
      if (!facPicked || facPicked === 'random') { flashNote('先选一个阵营'); return; }
      buildRolePicker(facPicked);
    };
    const facRandom = el('fac-random');
    if (facRandom) facRandom.onclick = () => pickFac('random');
    /* 「我这席」里的跳转按钮：关掉本面板，开指定角色 */
    const toFac = el('role-to-faction');
    if (toFac) toFac.onclick = () => {
      const r = el('role-overlay'); if (r) r.classList.add('hidden');
      if (fac) fac.onclick();
    };

    /* 左侧三铭牌 */
    const codex = el('btn-codex'), rules = el('btn-rules-home'), replay = el('btn-replay-home');
    if (codex) codex.onclick = () => {
      buildCodex();
      const ov = el('codex-overlay');
      if (ov) ov.classList.remove('hidden');
    };
    /* 〔批 UI-1 修〕#btn-rules-home 这个 id 此前**根本不存在**（HTML 里左侧铭牌是 #btn-rules），
       所以 rules.onclick 永远不绑 —— 主页「规则速览」铭牌点了没反应。
       现在 index.html 已把该铭牌统一为 #btn-rules-home（对局内的圆钮仍是 #btn-rules，
       由 ui.js 的文档委托处理），这里就真的能绑上了。
       兜底：若将来 id 又漂移，仍按铭牌位置查一次。 */
    if (rules) rules.onclick = () => {
      /* 〔批 SHIP-2〕打开规则只有一条路：SKUI.openRules()（它内部会调 renderRules）。
         这里不再自己 remove('hidden') + renderRules() —— 那正是"两份打开逻辑"的来源。 */
      if (global.UI && global.UI.openRules) { global.UI.openRules(); return; }
      const ov = el('rules-overlay');
      if (ov) { ov.classList.remove('hidden'); ov.scrollTop = 0; renderRules(); }
    };
    if (replay) replay.onclick = () => {
      /* 〔批 UI-8c · 2026-10-27〕主页「对局回放」改成**存档列表**。
         -------------------------------------------------------------
         用户的诉求是「查看最近的对局记录」。旧实现只认 `View.replayOf(g)`，
         而那个函数对进行中的对局恒返回 null（K3 红线），**而且本仓从来没有任何
         对局持久化** —— 于是这个铭牌除了"刚打完并在结算页"以外永远弹提示，
         形同虚设。

         现在两条路：
           ① 存档里有记录 → 打开存档浮层（可看 / 可勾选删除 / 可清空）
           ② 存档是空的 → 若当前恰好有一局刚结束，提示去结算页点「保存本局」
         仍然不读 `g.replay`：存档里的内容当初也是经 replayOf() 取到后存下的。 */
      openReplayArchive();
    };

    /* 〔批 UI-8c〕存档浮层的三个按钮 */
    const rc = el('btn-replay-close');
    if (rc) rc.onclick = closeReplayArchive;
    const rdel = el('btn-replay-del');
    if (rdel) rdel.onclick = () => {
      const S = global.SKReplayStore;
      const ids = Object.keys(rpSel);
      if (!S || !ids.length) return;
      S.remove(ids);
      rpSel = {}; rpOpenId = null;
      renderReplayArchive();
      flashNote('已删除 ' + ids.length + ' 局');
    };
    const rclr = el('btn-replay-clear');
    if (rclr) rclr.onclick = () => {
      const S = global.SKReplayStore;
      if (!S) return;
      if (!global.confirm || global.confirm('确定清空全部对局回放？')) {
        S.clear(); rpSel = {}; rpOpenId = null;
        renderReplayArchive();
        flashNote('已清空全部回放存档');
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
    /* 〔批 UI-6 · 2026-10-26〕名字牌的定位必须**跟着场景尺寸走**，不能只靠 init + resize。
       实测偶发红：移动端门禁 4 次里会有 1 次报「名字牌在视口外」——
       因为 positionTag() 用 getBoundingClientRect 量座位，而那一刻
       #arena-stage 的最终尺寸还没稳定（字体/CSS 生效晚于 init、或门禁刚切完 screen）。
       用 ResizeObserver 观察 stage：尺寸一变就重新定位，时序问题从根上消失。
       没有 ResizeObserver 的环境（老浏览器）静默跳过 —— 退回到原来的 init+resize 行为。 */
    try {
      if (typeof global.ResizeObserver === 'function') {
        const host = el('arena-stage');
        if (host) {
          const ro = new global.ResizeObserver(function () { positionTag(); });
          ro.observe(host);
          global.__skSeatTagRO = ro;
        }
      }
    } catch (_) { /* 观察失败不影响主页 */ }
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
    openReplayArchive: openReplayArchive,
    closeReplayArchive: closeReplayArchive,
    renderReplayArchive: renderReplayArchive,
    /* 〔批 SHIP-2〕规则速览的渲染器：SKUI.openRules() 打开浮层时调用它。
       渲染与"打开"必须由同一个入口驱动，否则首局自动弹出的那条路会漏掉渲染。 */
    renderRules: renderRules,
    init: init, setFac: setFac, syncChip: syncChip, renderStage: renderStage,
    positionTag: positionTag, openSeatPanel: openSeatPanel, commitName: commitName,
    get myName() { return myName; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
