/* 界面渲染：HUD / 计时 / 表单 / 六分区记事本 / 公开发言流 / 复盘 */
(function (global) {
  const D = global.SKData;
  const RD = global.SKRoleDecl;                  // v6.6 阶段 2（D6/D8）：能力标签与职业余额表由声明层派生
const SKD = global.SKDerivation;               // 〔43〕阵营成员 ≠ 能力持有者：面板也必须按 role 判，否则给死囚显示四条用不了的技能
  const E = global.Engine;
  const el = id => document.getElementById(id);
  let tab = 'pub';
  let formState = { opt: null, targets: [], num: null, num2: null, text: '' };
  let rpNight = 0;                     // 复盘：0 = 全部
  let rpMode = 'raw';                  // 复盘视图：'raw' 原始流 | 'story' 叙事（〔批次 34〕默认原始）
  /* 倒计时提示音：只在最后 5 秒（与既有 danger 阈值一致）每秒响一次，
     故必须记录上一次已发声的整秒，避免每帧重复触发。 */
  let lastTickSec = -1;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const facCls = f => D.FACTION[f] ? D.FACTION[f].cls : '';
  const facName = f => D.FACTION[f] ? D.FACTION[f].name : '';
  /* v22 缺陷修复：D.ROLES 键防御性访问——k.role / excludes / claimedRole 来自 NLP 解析
     与历史数据，非法键（如旧别名 'doc'）此前会直接崩（审查：未保护字典访问） */
  const roleNameOf = k => (k && D.ROLES[k]) ? D.ROLES[k].name : (k || '—');

  /* 〔42〕他人状态的唯一可见性出口（2026-10-06）
     名单与玩家详情里凡是「别的玩家」的数据，一律取自 View.viewFor(g) 的 players（已 sanitize），
     不再直读 g.players。此前单机直读权威状态，导致濒死 / 感染标记（含真伪）/ 蛰伏沉默
     对所有人可见（3.3.12 / 4.5 / 4.10.4④ / 6.1.2）。己身状态与 DEV 专属分支仍读原始 g：
     本人私有数据与开发者视角本就可以看到真值。 */
  const othersOf = (g, V) => (V && V.players) ? V.players : g.players;

  /* ---------- HUD 与计时（v32：收敛行 + 防闪动——只在值变化时写 DOM；身份牌已移除，
     玩家身份经点击名单自己卡片查看，职业备注在卡片内标注） ---------- */
  const hudCache = {};
  function setHud(id, v) {
    if (hudCache[id] === v) return;
    hudCache[id] = v;
    const e = el(id);
    if (e) e.textContent = v;
  }
  function renderHud(g) {
    setHud('hud-cd', (g.countdown || 0).toFixed(1));
    setHud('hud-net', ((g.net10 || 0) / 10).toFixed(1));
    /* v34 C2：主倒计时环形进度（青绿→琥珀→红）+ 净破坏迷你条（满 9.0 即人类倒计时胜利失效） */
    const ring = el('cd-ring');
    /* 防御：uismoke 等无 DOM 沙盒的假元素 style 无 setProperty——跳过环形着色即可 */
    if (ring && ring.style && typeof ring.style.setProperty === 'function') {
      const cd = g.countdown || 0;
      ring.style.setProperty('--p', Math.max(0, Math.min(100, cd / 24 * 100)));
      ring.style.setProperty('--c', cd > 9.6 ? '#00E5B0' : cd > 4.8 ? '#FFB020' : '#FF4D6D');
    }
    const nf = el('hud-net-fill');
    if (nf) nf.style.width = Math.max(0, Math.min(100, ((g.net10 || 0) / 10) / 9 * 100)) + '%';
    /* 退出/暂停仅在单机对局开放（用户拍板） */
    const local = global.Game.mode === 'local';
    const bp = el('btn-pause'), be = el('btn-exit');
    if (bp) bp.style.display = local ? '' : 'none';
    if (be) be.style.display = local ? '' : 'none';
    const b = el('banner');
    if (g.banner) { b.classList.remove('hidden'); b.textContent = g.banner; }
    else b.classList.add('hidden');
  }

  function updateTimer() {
    const info = global.Game.timerInfo();
    const num = el('timer-num'), fill = el('timerbar-fill');
    const live = el('timer-live'), fl = el('form-left');
    const itl = el('input-timeline-fill');   // v33：输入区上方的决策窗口收缩进度线
    const waitTxt = (() => {
      if (!info || info.waiting == null || info.waiting <= 0) return '';
      const g = global.Game.g;
      return g && E.alive(g).length <= 3 ? ' · 决策中' : ` · 决策中 ${info.waiting} 人`;
    })();
    if (!info || !info.duration) {
      num.textContent = info && info.waiting ? '待他人' : '—';
      fill.style.width = '0%';
      if (itl) { itl.style.width = '0%'; itl.classList.remove('hot'); }
      const ft0 = el('f-text');
      if (ft0) ft0.classList.remove('danger');
      if (live) live.textContent = '';
      lastTickSec = -1;   // 窗口结束：复位，下一轮倒计时可重新提示
      return;
    }
    const s = Math.ceil(info.left);
    num.textContent = s + 's';
    /* 倒计时提示音（tick 素材此前从未接入）：进入最后 5 秒后每秒响一次 */
    if (info.duration >= 6 && s >= 0 && s <= 5 && s !== lastTickSec) {
      lastTickSec = s;
      if (global.SKAudio) global.SKAudio.sfx('tick');
    }
    if (live) live.textContent = `${s}s${waitTxt}`;
    if (fl) fl.textContent = s;
    if (live) live.style.color = s <= 5 ? '#ff5a7a' : 'var(--accent)';
    const pct = Math.max(0, Math.min(100, (info.left / info.duration) * 100));
    fill.style.width = pct + '%';
    fill.style.background = s <= 5 ? 'linear-gradient(90deg,#ff5a7a,#ff8a5a)' : 'linear-gradient(90deg,#00E5B0,#5ce6a8)';
    /* v33：≤30 秒时进度线由青转橙红并轻微脉冲 */
    if (itl) {
      itl.style.width = pct + '%';
      itl.classList.toggle('hot', s <= 30);
    }
    /* v34 C6：输入框边框联动倒计时危险态（≤10s，优先于聚焦态） */
    const ft = el('f-text');
    if (ft) ft.classList.toggle('danger', s <= 10);
  }

  /* ---------- 名单 ---------- */
  function knownLabel(g, viewer, p) {
    if (g.dev) return `${facName(p.faction)}·${p.roleName}`;          // 上帝视角：全员身份公开
    if (viewer && p.id === viewer.id) return `${facName(p.faction)}·${p.roleName}`;
    const k = viewer && viewer.known && viewer.known.get(p.id);
    /* B5：known 条目可能不含阵营字段（2.8.12④）——只渲染允许揭示的部分 */
    if (k && k.role) { const fn = facName(k.faction); return (fn ? fn + '·' : '') + roleNameOf(k.role); }
    /* 神探：已查验池内目标的身份标注常驻显示（4.7/显示方案 2.7） */
    if (viewer && viewer.checkPool) {
      const rec = Array.isArray(viewer.checkPool)
        ? viewer.checkPool.find(x => x.id === p.id)
        : (viewer.checkPool.get && viewer.checkPool.get(p.id));
      /* B5（4.7.3，待拍板 I9）：池内不标注阵营 */
      if (rec) return roleNameOf(rec.role) + '（查）';
    }
    if (k && k.faction) return facName(k.faction);
    /* B5：非 faction 路径的揭示（暴露/神探公告/会议背书）无阵营字段 */
    if (p.revealed) {
      const fn = facName(p.revealed.faction);
      return p.revealed.role ? (fn ? fn + '·' : '') + roleNameOf(p.revealed.role) : fn;
    }
    if (k && k.excludes) return k.excludes.length >= 2
      ? `非${roleNameOf(k.excludes[0])}/${roleNameOf(k.excludes[1])}`
      : `非${roleNameOf(k.excludes[0])}`;
    return '';
  }

  /* 〔S5 2026-10-25 退役〕renderRoster（左栏名单卡片）已删除：主区改由圆桌场景承担名单，
     席位点击走 UI.openPlayerPop（S3a 起）。原函数里的「发言中/已投票/被提名/已知身份」角标
     全部由 SKScene 的席位状态件承担（sk-lit / sk-sel / 出局叠加件），不再有第二份名单渲染。 */
  let popPid = null;   // 当前详情弹窗的玩家 id（openPlayerPop 与弹窗关闭共用）

  /* 玩家详情弹窗：开发者模式下展示完整信息（身份/技能/各 AI 视角威胁度/指控记录） */
  /* =============================================================
   * 〔R4〕账本：场景里的笔记本道具点开的**手写纸面**
   * -------------------------------------------------------------
   * 用户要求：「记账功能还在，但不再以方框形式表现」。
   * 故这里不用 .sec / .evt / .kv 那套表格皮，改成：
   *   · 一张纸（.ledger-paper），有横线、有装订孔
   *   · 每条记录是一行手写体（.ld-line），行首是手写标记 + 「第N夜」
   *   · 分组用小标题手写（.ld-h），不是色块标题
   * **数据口径逐字不变**：仍读 me.known / AI.suspDist / me.crewChecks / me.bulletLog 等，
   * 只换呈现方式。这是纯展示层改造，零规则改动。
   * ============================================================= */
  function ledgerLines(g) {
    const me = E.P(g, g.humanId);
    if (!me) return [];
    const AI = global.AI;
    const out = [];
    const facName2 = f => ({ human: '人类', alien: '异形', xeno: '外星人' }[f] || f);

    /* 硬源 / 弱记录 */
    const hard = [], weak = [];
    (me.known || new Map()).forEach((k, id) => {
      let txt = id + ' 号';
      if (k.role) txt += ' 是 ' + roleNameOf(k.role);
      if (k.faction) txt += '（' + facName2(k.faction) + '）';
      if (k.excludes && k.excludes.length) txt += ' 不是 ' + k.excludes.map(roleNameOf).join('/');
      (k && k.viaPrivate ? weak : hard).push(txt);
    });
    if (hard.length) { out.push({ h: '确证' }); hard.forEach(t => out.push({ m: '✓', t })); }
    if (weak.length) { out.push({ h: '听说（未证实）' }); weak.forEach(t => out.push({ m: '?', t: t + '　私聊' })); }

    /* 怀疑度：不再是条形图表格，而是一句手写排序。
       ⚠ AI.suspDist 返回的是 **Map<阵营键, 概率>**（不是 {best:[...]}）——
       首版按 {best:[role,p]} 取值，于是每条只剩编号、没有"更像谁"。
       这里按声明序取最大阵营项（与 AI 的 distMax 同口径）。 */
    if (AI && AI.suspDist) {
      const ranked = E.alive(g).filter(x => x.id !== me.id).map(x => {
        let d = null;
        try { d = AI.suspDist(g, me, x.id); } catch (e) { d = null; }
        if (!d || !d.size) return null;
        let topK = null, topV = -1;
        d.forEach((v, k) => { if (v > topV) { topV = v; topK = k; } });
        return { id: x.id, top: topK, p: topV };
      }).filter(Boolean).sort((a, b) => b.p - a.p).slice(0, 6);
      if (ranked.length) {
        out.push({ h: '我的怀疑顺序' });
        ranked.forEach((r, i) => out.push({
          m: (i + 1) + '.',
          t: r.id + ' 号' + (r.top ? '　更像 ' + facName2(r.top) + '（' + Math.round(r.p * 100) + '%）' : ''),
        }));
      }
    }

    /* 各角色私有资产：仍逐条列出，但用手写行 */
    if (me.crewChecks && me.crewChecks.size) {
      out.push({ h: '查验记录' });
      [...me.crewChecks.entries()].forEach(([id, v]) => out.push({
        m: '·',
        t: id + ' 号（查了 ' + v.n + ' 次）：' + ((v.results || []).map(r => roleNameOf(r.id) + '→' + (r.ans ? '是' : '否')).join('、') || '无有效作答'),
      }));
    }
    if (me.markEverSeen && me.markEverSeen.size) {
      out.push({ h: '标记记忆' });
      [...me.markEverSeen.entries()].forEach(([id, v]) => out.push({
        m: '·',
        t: id + ' 号：第 ' + v.night + ' 夜首见' + (v.goneNight != null ? '，第 ' + v.goneNight + ' 夜消失' + (v.noCure ? '（无人治疗——隐形清除）' : '') : '，仍在'),
      }));
    }
    if (me.dyingSeen && me.dyingSeen.ids) {
      out.push({ h: '最近濒死' });
      out.push({ m: '·', t: '第 ' + me.dyingSeen.night + ' 夜：' + (me.dyingSeen.ids.join('、') || '无') + ' 号' });
    }
    if (me.bulletLog && me.bulletLog.length) {
      out.push({ h: '子弹流水' });
      me.bulletLog.forEach(b => out.push({
        m: '·', t: '第 ' + b.night + ' 夜 ' + (b.delta > 0 ? '+' : '') + b.delta + '（' + b.src + '）· 现余 ' + me.bullets + ' 发',
      }));
    }
    if (!out.length) out.push({ m: '·', t: '还什么都没记下。' });
    return out;
  }

  function renderLedger() {
    const g = global.Game && global.Game.g;
    const ov = el('ledger-overlay');
    if (!ov) return;
    if (!g) { ov.classList.add('hidden'); return; }
    const me = E.P(g, g.humanId);
    const fac = me ? ({ human: '人类', alien: '异形', xeno: '外星人' }[me.faction] || me.faction) : '';
    const rows = ledgerLines(g).map(r =>
      r.h ? '<div class="ld-h">' + esc(r.h) + '</div>'
        : '<div class="ld-line"><i>' + esc(r.m) + '</i>' + esc(r.t) + '</div>').join('');
    ov.innerHTML =
      '<div class="ledger-paper">'
      + '<div class="ld-head"><b>我的账本</b><span>' + (me ? esc(me.roleName) + '（' + esc(fac) + '）' : '') + '</span>'
      + '<button class="ld-close" data-ld-close="1">合上</button></div>'
      + '<div class="ld-body">' + rows + '</div>'
      + '<div class="ld-foot">与 AI 的账本同一机制生成 —— 它靠这个投票/出刀，你靠这个盘人。</div>'
      + '</div>';
    ov.classList.remove('hidden');
  }

  function closeLedger() {
    const ov = el('ledger-overlay');
    if (ov) ov.classList.add('hidden');
  }

  function openLedger() {
    try { renderLedger(); } catch (e) { showFatal('账本打开失败：' + (e && e.message ? e.message : e)); }
  }

  function renderPlayerPop(g, V) {
    const pop = el('p-pop');
    if (!pop) return;
    if (popPid == null) { pop.classList.add('hidden'); return; }
    const me = E.P(g, g.humanId);
    const p = g.players.find(x => x.id === popPid);
    /* 〔42〕非 DEV 分支只读裁剪后的 pv（他人私有字段根本不在其中）；DEV 分支继续读原始 p，
       因为开发者视角本就可以看到真值 —— 两条取数路径显式分开，不互相污染。 */
    const pv = (V && V.players ? V.players.find(x => x.id === popPid) : null) || p;
    if (!p) { pop.classList.add('hidden'); popPid = null; return; }
    const god = !!g.dev;
    /* 联机载荷（dev.skills）与本地权威状态（g.players）双轨取数 */
    const rec = (typeof g.dev === 'object' && g.dev && g.dev.skills)
      ? (g.dev.skills.find(s => s.id === p.id) || p) : p;
    const knownPairs = rec.known
      ? (rec.known instanceof Map ? [...rec.known.entries()] : rec.known) : [];
    const heat = (g.threat && g.threat[p.id]) || 0;
    let html = `<div class="ov-head"><span class="sec">${p.id} 号 ${esc(p.name)}${me && p.id === me.id ? '（我）' : ''}${p.out ? ' · 已出局' : ''}</span>
      <button class="ov-close" id="btn-p-close" title="关闭">✕</button></div>`;
    /* 自动讯问：对 AI 席位可一键生成质询/指控句（填入输入框可改写后发送）——真人也可自行输入测试识别 */
    if (!p.out && !p.isHuman) {
      html += `<div class="sec">自动讯问（点击填入输入框，可改写后发送）</div>
        <div class="probe-row">
          <button class="act" data-probe="ask" data-pid="${p.id}">质询</button>
          <button class="act" data-probe="soft" data-pid="${p.id}">轻度指控</button>
          <button class="act" data-probe="med" data-pid="${p.id}">中度指控</button>
          <button class="act" data-probe="hard" data-pid="${p.id}">重度指控</button>
          <button class="act tiny" data-probe="ask" data-pid="${p.id}" title="再点换一句">↻ 换一句</button>
        </div>`;
    }
    /* v32（用户拍板）：职业备注——点击玩家卡片即可标注猜测职业（含全部职业与转职系），
       纯玩家个人笔记（不进 AI 账本、不影响任何机制），显示在名单卡的标签行。 */
    if (me && p.id !== me.id) {
      if (!me.noteMarks) me.noteMarks = {};
      const roles = Object.keys(D.ROLES);
      const cur = me.noteMarks[p.id] || '';
      html += `<div class="sec">职业备注（个人笔记，AI 不可见）</div>
        <select id="note-select" data-pid="${p.id}">
          <option value="">— 未标注 —</option>` +
          roles.map(r => `<option value="${r}" ${cur === r ? 'selected' : ''}>${esc(D.ROLES[r].name)}</option>`).join('') +
        `</select>`;
    }
    if (god) {
      html += `<div class="kv"><span>身份</span><span class="${facCls(p.faction)}">${facName(p.faction)} · ${esc(p.roleName)}${p.transferred ? '（原职业：普通船员）' : ''}</span></div>`;
      if (p.theta) html += `<div class="kv"><span>西塔档</span><span>θ${p.theta}${p.isHuman ? ' · 真人席位' : ' · AI'}</span></div>`;
      html += `<div class="kv"><span>状态</span><span>${p.out
        ? (p.outType === 'vote' ? '第' + p.outNight + ' 夜被驱逐' : '第' + p.outNight + ' 夜死于' + (D.CAUSE_NAME[p.cause] || '—'))
        : skillDesc(g, rec)}</span></div>`;
      if (rec.infection) html += `<div class="kv"><span>感染</span><span>${rec.infection.real === false ? '假标记（欺诈）' : '真感染 · 第 ' + rec.infection.deathNight + ' 夜致死'}</span></div>`;
      if (p.claimedRole) html += `<div class="kv"><span>曾声称</span><span>${esc(D.ROLES[p.claimedRole] ? D.ROLES[p.claimedRole].name : p.claimedRole)}</span></div>`;
      html += `<div class="kv"><span>威胁度共识（怀疑度）</span><span>${heat}</span></div>` +
        `<div class="kv"><span>危险度（行动视图）</span><span>${global.AI ? Math.round(global.AI.dangerOf(g, E.P(g, g.humanId) || g.players[0], p.id)) : '—'}</span></div>`;
      /* 各 AI 对该玩家的私有威胁度 */
      const dev = typeof g.dev === 'object' ? g.dev : null;
      let aiRows = '';
      if (dev && dev.agents) {
        for (const a of dev.agents) {
          const hit = (a.top || []).find(x => x.id === p.id);
          aiRows += `<div class="kv"><span>${a.id} 号（${esc(a.roleName || '')}·θ${a.theta}）</span><span>${hit ? hit.T : '—'}</span></div>`;
        }
      } else if (global.AI) {
        for (const a of g.players.filter(x => !x.isHuman && !x.out)) {
          aiRows += `<div class="kv"><span>${a.id} 号（${esc(a.roleName || '')}·θ${a.theta}）</span><span>${Math.round(global.AI.suspOf(g, a, p.id))}</span></div>`;
        }
      }
      if (aiRows) html += `<div class="sec">各 AI 私有怀疑度（对该玩家）</div>` + aiRows;
      if (p.accusers && p.accusers.length) html += `<div class="kv"><span>曾被指控</span><span>${p.accusers.join('、')} 号</span></div>`;
      if (god && knownPairs.length) {
        html += `<div class="sec">该玩家的已知信息（其记事本）</div>` + knownPairs.slice(0, 8).map(([id, kv]) => {
          const t2 = g.players.find(x => x.id === +id);
          const txt = kv.role ? `${facName(kv.faction)}·${D.ROLES[kv.role] ? D.ROLES[kv.role].name : ''}`
            : kv.faction ? facName(kv.faction)
            : kv.excludes ? kv.excludes.map(r => '非' + roleNameOf(r)).join('/')
            : kv.viaPrivate ? '（私聊所得）' : '—';
          return `<div class="kv"><span>${t2 ? t2.id + ' 号' : id}</span><span>${esc(txt)}</span></div>`;
        }).join('');
      }
    } else {
      /* 非开发者：只展示公开可知信息（数据源 = View.sanitize 后的 pv） */
      const k = knownLabel(g, me, pv);
      html += `<div class="kv"><span>身份</span><span>${k ? esc(k) : '未知'}</span></div>`;
      if (pv.out) html += `<div class="kv"><span>出局</span><span>${pv.outType === 'vote' ? '第' + pv.outNight + ' 夜被驱逐' : '第' + pv.outNight + ' 夜死于' + (D.CAUSE_NAME[pv.cause] || '—')}</span></div>`;
      if (pv.accusers && pv.accusers.length) html += `<div class="kv"><span>曾被指控</span><span>${pv.accusers.join('、')} 号</span></div>`;
      if (!g.dev) html += `<div class="empty">开启 DEV 后可查看完整私有信息（技能 / 各 AI 视角威胁度 / 记事本）。</div>`;
    }
    /* 〔R2〕右栏「阵营日记」已随表单式设计删除，但 selfPanel / campPanel 承载的
       **本人资产与阵营共享信息**是玩家真正需要的（死囚资产隔离、异形队内共享、
       技能余额）。这里把它们并入玩家详情弹窗的「我的状态」段 —— 数据源与口径
       逐字未变，只是入口从右栏页签换成「点自己席位」。
       注意：只对**自己**展开（别人看我的资产属私有信息，2.8.7）。 */
    if (me && p.id === me.id) {
      try {
        html += '<div class="sec">我的状态 · 技能与资产</div>' + selfPanel(g, me);
        const camp = campPanel(g, me);
        if (camp && camp.trim()) html += '<div class="sec">阵营共享</div>' + camp;
      } catch (e) {
        html += '<div class="empty">状态面板渲染失败：' + esc(e && e.message ? e.message : String(e)) + '</div>';
      }
    }
    pop.innerHTML = html;
    pop.classList.remove('hidden');
  }

  /* ---------- 舞台 ---------- */
  function lastStepLogs(g) {
    const out = [];
    for (let i = g.log.length - 1; i >= 0; i--) {
      if (g.log[i].step == null) break;
      if (visible(g, g.log[i])) out.unshift(g.log[i]);   // 队内信息（如欺诈标记）不对异形阵营外可见
    }
    return out;
  }

  /* 〔43〕主区 = f(阶段)：区域布局的唯一裁决点
     ------------------------------------------------------------
     〔R2 2026-10-25 现状〕发言流水（#chatlog）与右栏三页签已随表单式设计删除，
     布局键目前只驱动 **#region-dec 的显隐**（夜间无表单时也可能为空 → 面板自动隐藏）。
     四个键保留原语义，是为了「紧急会议在夜间相内仍按 talk 处理」这条规则判断不变形；
     tChat / tDec 两个标题字段已无消费点（标题随 #t-chat/#t-dec 一起退役），
     但**保留字段**以免将来恢复分栏时又要重算一遍语义。 */
  function stageLayout(g) {
    const phase = (g && g.phase) || 'day';
    const stream = !!(g && g.pending && g.pending.stream);
    const form = !!(g && g.pending && !g.pending.stream);
    if (stream) return { key: 'talk', chat: true, dec: true, tChat: '公开发言流水（本轮）', tDec: '本轮要点' };
    if (phase === 'night') return { key: 'night', chat: false, dec: true, tChat: '', tDec: '夜间流程 · 私聊 / 决策 / 公告' };
    if (form) return { key: 'day-form', chat: true, dec: true, tChat: '公开发言流水（当天）', tDec: '待你操作' };
    return { key: 'day', chat: true, dec: true, tChat: '公开发言流水（当天）', tDec: '决策 · 事件' };
  }

  /* 〔43〕夜间「今夜私聊」小结 —— 夜间主区收起发言区后，私聊必须在主区看得见，
     否则玩家在 0c 之后完全没有回看自己那几句私聊的地方（原先只能翻右栏「私人」页签，
     而私聊内容不公开（2.2），这里只放**我自己参与**的那一场。
     数据源两处，均为本人合法持有：
       · g.nightChats —— 步骤 0c 落的结构化副本，只取含我的配对组
       · p.inbox      —— 私聊回复与异形队内频道（队内消息本就只对队友可见，3.3④）
     绝不渲染别人的配对组：批次①只公告「谁和谁配对」，正文不公开（2.2）。 */
  function nightChatHtml(g) {
    const me = E.P(g, g.humanId);
    if (!me) return '';
    const lines = [];
    for (const c of (g.nightChats || [])) {
      if (c.a !== me.id && c.b !== me.id) continue;     // 只看我参与的那一场
      for (const ln of (c.lines || [])) lines.push({ who: c.a === me.id ? c.b : c.a, text: ln });
    }
    for (const e of (me.inbox || [])) {
      if (e.night !== g.night) continue;
      if (!/（私聊）：|（队内）：/.test(e.text)) continue;
      lines.push({ who: null, text: e.text });
    }
    if (!lines.length) return '';
    const body = lines.map(l =>
      `<div class="say"><span class="who">${l.who != null ? l.who + ' 号 ↔ 我' : '私聊'}</span>：${esc(l.text)}</div>`).join('');
    return `<div class="sec">今夜私聊（仅你参与的一场 · 正文不公开）</div>` + body;
  }

  /* 把布局写进 DOM：供 CSS 消费的 data-layout + 区域显隐。
     区域用 display:none 整体收起（不是 height:0）——空盒子仍然吃边距，且
     移动端手势/焦点可能落进不可见区域。

     〔S5 2026-10-25〕宿主改挂 `.seg-main`：旧 `#seg-stage` / `#region-chat` / `#t-chat`
     已随表单式三栏退役（发言流水改由场景气泡 + 右栏书记官档案承载）。此处只保留
     **仍在 DOM 里的**那两件：主区宿主（data-layout）与行动面板（#region-dec 显隐）。
     ⚠ 不要为了「让断言过」把退役节点加回来——那是回退，不是修复。
     data-layout 的消费方见 css/06-scene.css「相位档面板高度」（night/talk 两档）。 */
  function applyStageLayout(g) {
    const L = stageLayout(g);
    const seg = document.querySelector('#screen-game .seg-main');
    if (seg) seg.dataset.layout = L.key;
    const rd = el('region-dec');
    if (rd) rd.classList.toggle('hidden', !L.dec);
    syncDockPanel(g);
    return L;
  }

  /* 〔批 UI-3a · 2026-10-26〕行动面板的「何时浮出」
     -------------------------------------------------------------
     用户原话：「注意把绿色方框去掉，也就是下面的提示框，准备向场景交互靠近」。
     那个「绿色方框」就是 #region-dec 整块常驻：深色实心卡 + 青绿标题 + 每条公告左侧青绿条，
     实测占 228px（1600×900），把场景从 764px 压到 447px。

     现在的规则（三条，顺序即优先级）：
       ① 有待决策表单（#stage-actions 有内容）→ **强制展开**。这是玩家必须操作的东西，
          不能藏起来；且 css 里 .has-actions 优先于手动收起。
       ② 否则 → 只有当玩家点了底部「当夜记录」时才展开（.open）。
       ③ 纯公告不再常驻。公告的内容改由场景承载（批 UI-5 书记官记录）。

     ⚠ 只改"显示时机"，不改任何控件：表单的 id / name / onchange / 提交按钮一律不动
       （门禁 主区O / S4D 依赖）。 */
  function syncDockPanel(g) {
    const rd = el('region-dec'), acts = el('stage-actions'), body = el('stage-body');
    if (!rd || !acts) return;
    /* 「有操作」= 面板里除了 #timer-live（倒计时文本）与 #btn-submit（提交）之外，
       还有真正的输入控件（radio/checkbox/select/textarea/其他 button）。
       开局讨论窗口只有「结束讨论」一个按钮 + 倒计时，这不算"需要操作" ——
       否则面板会从第一秒就常驻，等于没改。
       ⚠ 这里用"是否含输入控件"而不是"是否非空"：后者把倒计时/提示也算进去，
         实测开局讨论就会被判成 has-actions（第一版就这样，面板照样常驻）。 */
    const hasActions = !!acts.querySelector(
      'input, select, textarea, button:not(#btn-submit)');
    rd.classList.toggle('has-actions', hasActions);
    /* 底部工具条上的公告计数：让玩家知道"有东西可看"而不必展开 */
    const cnt = el('rec-cnt');
    if (cnt) {
      const n = (body && body.querySelectorAll('.an').length) || 0;
      cnt.textContent = n ? n + ' 条' : '';
    }
    const btn = el('btn-rec');
    if (btn) {
      const on = rd.classList.contains('open') && !hasActions;
      btn.classList.toggle('on', on);
      btn.title = hasActions ? '有待处理的操作（面板已展开）'
        : (on ? '收起当夜记录' : '展开当夜记录');
    }
    /* 〔批 UI-6 · 2026-10-26〕面板展开时通知场景层**把座位圈上移**。
       面板已改成贴底抽屉（不再挤压场景），代价是会盖住房间下沿那一排 ——
       所以真正要做的让位交给场景层（SKScene.setPanelOpen → SEAT_LIFT），
       而不是再让面板缩水。这里只做"状态广播"，不碰任何控件。 */
    const open = hasActions || rd.classList.contains('open');
    if (global.SKScene && global.SKScene.setPanelOpen) global.SKScene.setPanelOpen(open);
  }

  /* 底部「当夜记录」按钮：手动展开 / 收起（一旦有表单，表单优先，按钮不生效） */
  function toggleDockPanel() {
    const rd = el('region-dec');
    if (!rd) return;
    if (rd.classList.contains('has-actions')) return;   /* 有表单时不许收起 */
    rd.classList.toggle('open');
    syncDockPanel(global.Game && global.Game.g);
  }

  /* 〔批 UI-5 · 2026-10-26〕点物件 → 展开行动面板。
     顶栏 HUD 删除后，场景道具成为唯一入口，点对了物件必须能立刻看到表单。
     与 toggleDockPanel 的区别：这里是**幂等展开**，不来回切（点物件不该把面板关掉）。 */
  function openDockPanel() {
    const rd = el('region-dec');
    if (!rd) return;
    rd.classList.add('open');
    syncDockPanel(global.Game && global.Game.g);
  }

  /* 〔批 UI-5〕对局设置覆盖层：原顶栏 7 个圆钮的宿主。
     打开/关闭只改 #settings-overlay 的 .hidden —— 圆钮本身与它们的 onclick 全部不动，
     所以音频 / 暂停 / 退出 / 规则 / DEV 的行为与改前逐字节一致。 */
  function toggleSettings(force) {
    const ov = el('settings-overlay');
    if (!ov) return;
    const show = force == null ? ov.classList.contains('hidden') : !!force;
    ov.classList.toggle('hidden', !show);
    const b = el('btn-settings-game');
    if (b) b.classList.toggle('on', show);
    if (show) {
      /* 暂停按钮的文案要跟当前状态一致（它由 renderHud 维护，这里补一次） */
      const bp = el('btn-pause');
      if (bp && global.Game) bp.textContent = global.Game.paused ? '▶' : '⏸';
    }
  }

  function renderStage(g) {
    const head = el('stage-head'), body = el('stage-body'), acts = el('stage-actions');
    const L = stageLayout(g);
    /* 〔43〕夜间把「今夜私聊」插在决策区最上方：夜间主区只有这一块，
       私聊小结是玩家此刻最可能想回看的东西，必须在第一步（而不是藏在右栏页签里）。 */
    const nightChat = L.key === 'night' ? nightChatHtml(g) : '';
    if (g.pending && g.pending.stream) {
      renderTalkForm(g, head, body, acts, nightChat);
      return;
    }
    if (g.pending) { renderForm(g, head, body, acts, nightChat); }
    else {
      const logs = lastStepLogs(g);
      const stepName = g.stepDone ? (E.STEP_NAME[g.stepDone] || g.stepDone) : '准备';
      head.innerHTML = `<h2>${esc(stepName)}</h2><span class="st">${g.phase === 'open' ? '开局' : `第 ${g.night} 夜`} · ${g.phase === 'night' ? '夜间' : g.phase === 'open' ? '讨论' : '白天'}</span>`;
      const me0 = E.P(g, g.humanId);
      const myPriv = me0 && me0.inbox
        ? me0.inbox.filter(e => e.night === g.night && e.step === g.stepDone) : [];
      body.innerHTML = announceHtml(g) + nightChat +
        logs.filter(e => !e.batch).map(e => `<div class="evt ${e.kind === 'good' ? 'good' : e.kind === 'bad' ? 'bad' : 'info'}">${esc(e.text)}</div>`).join('') +
        myPriv.map(e => `<div class="prv">私密：${esc(e.text)}</div>`).join('') ||
        '<div class="empty">本步无公开事件。</div>';
      const waiting = g.pendingCount || 0;
      const muteNote = g.step === 'M-speech'
        ? `<div class="evt info">验票官专属发言中（30 秒）：期间全场禁言，仅验票官可发言，发言自动进入发言记录。</div>` : '';
      acts.innerHTML = `${muteNote}<span class="hint">${global.Game.mode === 'net'
        ? (waiting ? `等待其他玩家决策（剩 ${waiting} 人）` : '点击「继续」立即推进')
        : '点击「继续」推进；需要你操作时会自动停下。'}</span>
        <label class="hint" style="flex:0 0 auto"><input type="checkbox" id="chk-fast" ${global.Game.fast ? 'checked' : ''}/> 快速模式</label>
        <button class="act" id="btn-next">继续</button>`;
      const bn = el('btn-next');
      if (bn) bn.onclick = () => global.Game.next();
      const cf = el('chk-fast');
      if (cf) cf.onchange = e => { global.Game.fast = e.target.checked; };
    }
    /* 〔S5〕renderChat 退役：公开发言以场景气泡呈现，全文归书记官档案（右栏） */
  }

  /* 〔S5 2026-10-25 退役〕renderChat（主区发言流水）与其配套的「只看某编号」过滤态
     一并删除：S5 起公开发言走场景气泡（SKScene.updateBubbles），全文归右栏书记官档案
     （renderSide 的 pub 页签），主区已无 #chatlog 节点。
     ⚠ 函数体保留在原处会让「已退役」变成一句注释——死代码仍会被 grep 到、
     仍会有人以为它在跑。真删，并把原职责写进交接记录。 */

  /* 实时讨论：输入框是常驻节点（#talkbar），AI 发言重渲染时不会清空你正在输入的文字 */
  /* ---------- 本步公告：推送到决策栏顶部，按批次着色（①~⑫） ---------- */
  const BATCH_CLS = {
    '①': 'b1', '②': 'b2', '③': 'b3', '④': 'b4', '⑤': 'b5', '⑥': 'b6',
    '⑦': 'b7', '⑧': 'b8', '⑨': 'b9', '⑩': 'b10', '⑪': 'b11', '⑫': 'b12',
  };
  function announceHtml(g) {
    const box = g.announceBox;
    if (!box || !box.items || !box.items.length) return '';
    const items = box.items.slice(-4).map(it =>
      `<div class="an ${BATCH_CLS[it.batch] || ''}"><span class="bt">${esc(it.batch || '')}</span>${esc(it.text)}</div>`).join('');
    return `<div class="annbox"><div class="sec">本步公告 · 第 ${box.night} 夜 ${esc(E.STEP_NAME[box.step] || box.step || '')}</div>${items}</div>`;
  }

  function renderTalkForm(g, head, body, acts, nightChat) {
    const f = g.pending;
    head.innerHTML = `<h2>${esc(f.title)}</h2><span class="st">实时讨论 · 剩余 <b id="form-left">${f.duration || 0}</b>s</span>`;
    body.innerHTML = announceHtml(g) + (nightChat || '') + `<p class="hint" style="margin:0 0 8px">${esc(f.desc || '')}</p>`;
    const askNote = g.pendingAsk
      ? `<div class="evt bad" style="margin:0 0 8px">⚠ <b>${g.pendingAsk.asker} 号正在质询你</b>——请在下方输入框正面回答（说明身份/昨晚行动可洗清嫌疑；含糊或拒绝会抬高你的威胁度）。</div>`
      : '';
    acts.innerHTML = `<b id="timer-live" class="live"></b>
      <span class="hint">${askNote}发言立即对全场可见；点名指控会立即抬高对方威胁度，影响 AI 投票。</span>
      <button class="act ghost" id="btn-submit">结束讨论</button>`;
    showTalkBar(g);
    el('btn-submit').onclick = () => { global.SKAudio.sfx('click'); global.Game.submit({}); };
  }

  function showTalkBar(g) {
    const bar = el('talkbar'), me = E.P(g, g.humanId);
    if (!bar) return;
    bar.classList.remove('hidden');
    /* v32：白天队内频道（异形专属）——讨论期间可密谈，仅队友可见，AI 队友真实入账 */
    const crow = el('f-camp-row');
    if (crow) crow.classList.toggle('hidden', !(me && me.faction === 'alien' && !me.out));
    /* 发言意图全部由解析器从 #f-text 文本识别（sendTalk 不读下拉）；
       #f-accuse / #f-ask 为可选增强节点——标记中不存在时（当前 index.html 即未包含）直接跳过，
       否则 null.value 崩溃会中断整个渲染链（公告 / 聊天记录 / 玩家列表全部丢失） */
    const sel = el('f-accuse'), q = el('f-ask');
    if (!sel && !q) return;
    const opts = targetList(g, 'aliveOthers', me).map(p => `<option value="${p.id}">${p.id} 号 ${esc(p.name)}</option>`).join('');
    if (sel) {
      const keepA = sel.value;
      sel.innerHTML = '<option value="">不指控</option>' + opts;
      if (keepA) sel.value = keepA;
    }
    if (q) {
      const keepQ = q.value;
      q.innerHTML = '<option value="">不质询</option>' + opts;
      if (keepQ) q.value = keepQ;
    }
  }
  function hideTalkBar() { const bar = el('talkbar'); if (bar) bar.classList.add('hidden'); }

  function targetList(g, kind, me) {
    const al = E.alive(g);
    if (kind === 'alive') return al;
    if (kind === 'aliveNotAlien') return al.filter(p => p.faction !== 'alien');
    return al.filter(p => p.id !== me.id);
  }

  function renderForm(g, head, body, acts, nightChat) {
    const f = g.pending, me = E.P(g, g.humanId);
    head.innerHTML = `<h2>${esc(f.title)}</h2><span class="st">等待你的决策 · 剩余 <b id="form-left">${f.duration || 0}</b>s</span>`;
    formState = { opt: null, targets: [], num: null, num2: null, text: '' };

    let html = announceHtml(g) + (nightChat || '') + `<p class="hint" style="margin:0 0 8px">${esc(f.desc || '')}</p>`;

    if (f.opts) {
      html += `<div class="opts" id="f-opts">` + f.opts.map((o, i) =>
        `<label class="opt ${o.disabled ? 'dis' : ''}" data-v="${o.v}">
           <input type="radio" name="fopt" value="${o.v}" ${o.disabled ? 'disabled' : ''} ${i === 0 && !o.disabled ? 'checked' : ''}/>
           <span><span class="t">${esc(o.label)}</span>${o.sub ? `<br/><span class="d">${esc(o.sub)}</span>` : ''}</span>
         </label>`).join('') + `</div>`;
      const first = f.opts.find(o => !o.disabled);
      if (first) formState.opt = first.v;
    }

    if (f.targets) {
      const max = f.targets.max || 1;
      const isAtk = ['shoot', 'alienAct', 'xenoKill'].indexOf(f.kind) >= 0;   // §3.2：濒死者仅可加不影响可选性的标注
      const exNote = f.kind === 'guard' ? '昨夜已保护，今夜不可重复'
                   : f.kind === 'invite' ? '不可连续两晚邀请同一人' : '';
      /* 〔R3〕目标选择改为「点角色头像」：不再是一列方框 + 名字，
         而是与场景席位同款的头像按钮（圆形头像 + 编号 + 已知身份小字）。
         底层仍是 <input type=radio/checkbox>（name 不变、onchange 不变），
         所以 formState / 提交协议 / 门禁断言全部不受影响。 */
      const mk = (list, name, id) => `<div class="opts grid3 tgt-avatars" id="${id}" style="${name === 'ftgtPool' ? 'display:none' : ''}">` +
        list.map(p => {
          const k = knownLabel(g, me, p);
          const dy = isAtk && p.dying ? `<span class="d warn">濒死·攻击无效</span>` : '';
          const img = 'assets/scene/characters/a-crew/seat-' + String(p.id).padStart(2, '0') + '.svg';
          return `<label class="opt tgt-avatar" data-v="${p.id}" title="${p.id} 号 ${esc(p.name)}${k ? ' · ' + esc(k) : ''}">
            <input type="${max > 1 ? 'checkbox' : 'radio'}" name="${name}" value="${p.id}"/>
            <span class="ta-face"><img src="${img}" alt="" draggable="false"/><b>${p.id}</b></span>
            <span class="ta-name">${esc(p.name)}</span>
            ${k ? `<span class="d">${esc(k)}</span>` : ''}${dy}
          </label>`;
        }).join('') + `</div>`;
      const mkDis = list => `<div class="opts grid3">` + list.map(p =>
        `<label class="opt dis"><input type="checkbox" disabled/>
         <span><span class="t">${p.id} 号 ${esc(p.name)}</span><br/><span class="d">${exNote}</span></span></label>`).join('') + `</div>`;
      const excl = (f.targets.exclude || []).map(id => g.players.find(p => p.id === id)).filter(p => p && !p.out);
      const all = targetList(g, f.targets.list, me).filter(p => (f.targets.exclude || []).indexOf(p.id) < 0);
      html += `<div class="sec">选择目标（最多 ${max} 名）</div>` + mk(all, 'ftgtAll', 'f-targets');
      if (excl.length && exNote) html += mkDis(excl);
      if (f.kind === 'guard' && !all.length)
        html += `<div class="evt info">今夜无可保护目标（昨夜目标不可重复）。</div>`;
      if (f.pool && f.pool.length) {
        const ids = f.pool.map(x => x.id);
        html += `<div id="f-pool-wrap" style="display:none"><div class="sec">已查验池（发布公告只能选池内仍存活者）</div>` +
                mk(all.filter(p => ids.indexOf(p.id) >= 0), 'ftgtPool', 'f-pool') + `</div>`;
      } else if (f.kind === 'detective') {
        /* v32 语言层修复（用户拍板「查验公告没有可选项」）：神探表单在已查验池为空时
           显式说明，而不是让玩家切到公告页签后看到一片空白。 */
        html += `<div id="f-pool-wrap" style="display:none"><div class="evt info">已查验池为空（或池内目标均已出局）：先查验，再公告。</div></div>`;
      }
    }

    /* ⚠ num / num2 的选项**可能为空**，此处曾直接取 `options[0].v` 而炸：
       `TypeError: Cannot read properties of undefined (reading 'v')` at ui.js:587。
       触发态已定位：船员步骤 2 的「首次查验池」为空（`steps.js:597` 的
       `firstPool.map(...)`）—— 池按 4.1.1③ 移除「全部持有者已出局」的职业，
       当所有基础人类职业都没有存活持有者时（多名船员已转职的残局）池即为空，
       而表单把「身份①」标为必答 ⇒ 玩家被要求填一个**没有选项的必答项**。
       uismoke 以 SK_SMOKE_RNG=117 + 对局种子 912 稳定复现。
       * 上面那半句（必答项无选项）是**引擎/规则面的问题，待产品裁定**；
         这里只做 UI 侧的防御 —— 一个渲染函数不该因为数据缺项而抛异常崩掉整局。
       修法：空 options 时显式说明「无可选项」并**不写 formState**，
             让提交走引擎自己的合法性判定，而不是在这里替它编一个默认值。 */
    const numSlot = (key, label) => {
      const slot = f[key];
      if (!slot) return '';
      const opts = Array.isArray(slot.options) ? slot.options : [];
      if (!opts.length) {
        return `<div class="sec">${esc(slot.label)}</div>`
          + `<div class="evt warn">本项当前无可选项（相关对象可能已全部出局）。`
          + `请改选其他行动，或向裁判询问。</div>`;
      }
      return `<div class="sec">${esc(slot.label)}</div>
        <select id="f-${key}">${opts.map(o => `<option value="${o.v}">${esc(o.label)}</option>`).join('')}</select>`;
    };
    if (f.num) html += numSlot('num');
    if (f.num2) html += numSlot('num2');
    if (f.num && Array.isArray(f.num.options) && f.num.options.length) formState.num = f.num.options[0].v;
    if (f.num2 && Array.isArray(f.num2.options) && f.num2.options.length) formState.num2 = f.num2.options[0].v;
    if (f.text) {
      html += `<div class="sec">${esc(f.text.label)}</div><textarea id="f-form-text" placeholder="输入你想说的话……"></textarea>`;
    }

    body.innerHTML = html;
    acts.innerHTML = `<b id="timer-live" class="live"></b>
      <span class="hint">提交后立即结算；全员提交即跳秒；超时视为放弃（投票 = 弃票）。${g.phase === 'night' ? '本夜结算顺序于提交完成后随机生成，与编号无关。' : ''}</span>
      ${f.skipLabel ? `<button class="act" id="btn-skip">${esc(f.skipLabel)}</button>` : ''}
      <button class="act primary" id="btn-submit">提交</button>`;

    const usePool = () => !!f.pool && formState.opt === 'announce';
    const activeBox = () => usePool() ? body.querySelector('#f-pool') : body.querySelector('#f-targets');

    body.querySelectorAll('#f-opts input').forEach(i => i.onchange = () => {
      formState.opt = i.value;
      body.querySelectorAll('#f-opts .opt').forEach(l => l.classList.toggle('sel', l.dataset.v === i.value));
      const tw = body.querySelector('#f-targets'), pw = body.querySelector('#f-pool-wrap');
      if (tw && pw) { tw.style.display = usePool() ? 'none' : ''; pw.style.display = usePool() ? '' : 'none'; }
      formState.targets = [];
    });
    const firstOpt = body.querySelector('#f-opts .opt:not(.dis)');
    if (firstOpt) firstOpt.classList.add('sel');

    body.querySelectorAll('#f-targets input, #f-pool input').forEach(i => i.onchange = () => {
      const box = activeBox(); if (!box) return;
      const sel = [...box.querySelectorAll('input:checked')].map(x => +x.value);
      if (sel.length > (f.targets.max || 1)) { i.checked = false; return; }
      formState.targets = sel;
      box.querySelectorAll('.opt').forEach(l => l.classList.toggle('sel', sel.indexOf(+l.dataset.v) >= 0));
      /* 〔S3a〕场景选中环联动（决策等待期 tick 不跑 render，须即时通知） */
      if (global.SKScene && global.SKScene.refresh) global.SKScene.refresh();
    });
    /* A13：身份选择为字符串键（'crew'…），数值档仍解析为数字 */
    if (f.num) el('f-num').onchange = e => { const v = e.target.value; formState.num = v !== '' && !isNaN(+v) ? +v : v; };
    if (f.num2) el('f-num2').onchange = e => { const v = e.target.value; formState.num2 = v !== '' && !isNaN(+v) ? +v : v; };
    if (f.text) el('f-form-text').oninput = e => { formState.text = e.target.value; };

    /* §2.9 紧急会议二次确认：发动即公开身份且当夜倒计时不减。
       用页内二次点击代替原生 confirm（内嵌/预览环境会拦截原生弹窗导致点不动） */
    let meetingArmed = false;
    const arm = msg => {
      const hint = acts.querySelector('.hint');
      if (hint) {
        hint.innerHTML = `<b style="color:var(--warn)">${esc(msg)}</b><br/>再次点击「${esc(f.skipLabel ? '提交' : '提交')}」即确认发动。`;
      }
      el('btn-submit').textContent = '确认发动';
      el('btn-submit').classList.add('primary');
    };
    el('btn-submit').onclick = () => {
      if (f.kind === 'meeting' && formState.opt === 'yes' && !meetingArmed) {
        meetingArmed = true;
        arm('确认发动紧急会议？将立即公开你的编号与身份（验票官），当夜倒计时不减，且此后不可再发动。');
        return;
      }
      global.SKAudio.sfx('submit'); global.Game.submit(Object.assign({}, formState));
    };
    const sk = el('btn-skip');
    if (sk) sk.onclick = () => { global.SKAudio.sfx('click'); global.Game.submit({ opt: null, targets: [], num: null, text: '' }); };
  }

  /* ---------- 记事本六分区 ---------- */
  /* v21 改动 #11：可见性判断收敛到 infer/visible.js（SKVisible.canSee）投递侧唯一实现 */
  function visible(g, e) {
    return global.SKVisible.canSee(E.P(g, g.humanId), e);
  }

  function selfPanel(g, p) {
    const rows = [];
    const kv = (a, b) => `<div class="kv"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
    /* T4（2026-10-04 文本审查）：4.10.6 生路有三项——救援额度 / 外星人夜晚免疫 / 死囚复生；
       旧文案「救援是唯一生路」对外星人直接误导（其濒死生路正是夜晚免疫）。 */
    if (p.dying) rows.push('<div class="evt bad">你已濒死：生路有三——步骤 8 获救援额度解救、外星人夜晚免疫自动拦截（6.4）、死囚复生（6.8.4）；均未发生则步骤 9 死亡结算，不会拖到第二天。</div>');
    if (p.infection) rows.push(kv('感染', p.infection.real == null ? '（带标记，真伪不可辨）' : p.infection.real === false ? '（假标记，仅你可见）' : `第 ${p.infection.deathNight} 夜致死`));
    if (p.antibodyNight != null && p.antibodyNight >= g.night) rows.push(kv('抗体', p.antibodyNight === g.night ? '生效中（仅今夜有效，可挡 1 次感染）' : '已持有，仅下夜有效'));
    if (p.silenceNight === g.night) rows.push(kv('沉默', '今夜主动技能被封锁（投票与私聊不受影响）'));
    if (p.shield) rows.push(kv('结茧护盾', `${p.shield} 层`));
    rows.push(kv('感染抑制', `${p.suppressLeft} / 2`));
    /* 〔v1preview1.0 6.9.2⑤〕逃亡积分：仅外星人本人可见（selfPanel 是自己看自己，
       不向他方通报、不进任何公告批次）。达标 10 分即取得逃亡资格（永久保留）。 */
    if (p.faction === 'xeno' && global.Engine && global.Engine.escapeScoreOf) {
      const s = global.Engine.escapeScoreOf(g, p);
      rows.push(kv('逃亡积分', `${s.sum.toFixed(1)} / 10` +
        (p.escapeQualified ? '（已取得逃亡资格）' : '') +
        `［击杀 ${s.lethal.toFixed(1)}·助攻 ${(s.dying + s.retro).toFixed(1)}·驱逐 ${s.expel.toFixed(1)}·沉默 ${s.silence.toFixed(1)}］`));
    }
    /* 〔43〕异形资产按 role 判：变形为异形的死囚确实克隆了异形能力（6.8.3⑧），
       而它的 faction 恒为 xeno —— 按 faction 判会让变形后的异形能力在面板上消失。 */
    if (p.role === 'alien') {
      rows.push(kv('刀数', p.alien.dir === 'kill' ? '出刀无冷却' : `${p.alien.kills} / 2`));
      rows.push(kv('进化方向', p.alien.dir ? { destroy: '破坏', infect: '感染', kill: '击杀' }[p.alien.dir] : '未进化'));
      rows.push(kv('累计破坏量', `${(p.alien.destroyTotal || 0).toFixed(1)} / 6.0`));
      rows.push(kv('额外出刀', `${p.alien.extraKill} 次`));
    }
    /* 〔43〕经典外星人资产按 role 判。此前按 faction 判 ⇒ 死囚面板上白列「夜晚免疫／双刀／
       破坏／感染治疗额度」四条它一条都用不了的技能，同时它真正持有的变形与复生却一条都不显示；
       变形后更荒唐——「双刀」与所变形身份的资产同时并排出现（异形除外：变形为异形时按
       6.8.3⑧ 克隆除社交与队内共享外的一切能力，故异形资产走上面的 role 分支）。 */
    if (SKD.isClassicXeno(p)) {
      rows.push(kv('夜晚免疫', `${p.nightImmune} / 2 次（仅免疫伤害；被感染濒死也会消耗一次）`));
      rows.push(kv('双刀', p.awakened ? '已觉醒（第 6 夜或存活≤6 达成，不可逆）' : '未觉醒（第 6 夜或存活≤6 触发）'));
      rows.push(kv('破坏', `${p.destroyLeft} / 1（+2.0~3.0 自选，次夜为停转夜）`));
      rows.push(kv('感染治疗额度', `${p.cureSelf} / 1（仅自用，感染消失即作废）`));
      const silenced = g.players.filter(x => !x.out && x.silenceNight != null && x.silenceNight > g.night);
      if (silenced.length) rows.push(`<div class="sec">已沉默名单</div>` + silenced.map(x =>
        `<div class="kv"><span>${x.id} 号</span><span>覆盖期：第 ${x.silenceNight} 夜（夜间主动技能封锁，投票/私聊不受影响）</span></div>`).join(''));
    }
    /* 〔43〕死囚自有的两项能力（6.8.2：能力仅变形＋复生＋作为阵营成员参与清场）此前无处显示。 */
    if (p.convict) {
      rows.push(kv('当前形态', p.morph
        ? `变形为「${roleNameOf(p.morph)}」${p.morphNight != null ? `（第 ${p.morphNight} 夜起，冷却至第 ${p.morphNight + 3} 夜）` : ''}`
        : '本体形态（死囚）'));
      rows.push(kv('复生额度', `${p.reviveLeft} / 2 次（步骤 8，可自救，不占行动权）`));
      rows.push(kv('镜像账本', p.mirror
        ? Object.keys(p.mirror).map(k => (k === 'convict' ? '本体' : roleNameOf(k))).join('、')
        : '—'));
    }
    if (RD.hasGrant(p.role, 'shoot')) {                                    // D6：能力标签（枪手族）
      /* 4.4.3：警长额外子弹两项——第 5 夜起 +1、全场存活≤6 +1，各自全局仅此 1 次、可叠加（至多 +2）。
         〔2026-10-05 规则方裁决〕采信正文口径「第 5 夜起」；此前实现的第 7 夜作废，引擎发放点已回改为
         engine.js 的 n===5。⚠ 与外星人「第 7 夜夜晚免疫」（6.4）夜次不同，两者勿混。 */
      rows.push(kv('子弹', `${p.bullets} 发（悬赏击杀回复、第 5 夜 +1、存活≤6 +1）`));
      if (p.bulletLog && p.bulletLog.length)
        rows.push(`<div class="sec">子弹流水</div>` + p.bulletLog.map(b =>
          `<div class="kv"><span>第 ${b.night === 0 ? '—' : b.night} 夜</span><span>${b.delta > 0 ? '+' : ''}${b.delta}（${esc(b.src)}）</span></div>`).join(''));
    }
    if (RD.hasGrant(p.role, 'repair')) {                                   // D6：能力标签（工程师系）
      const th = RD.repairExposeAtOf(p.role) || 0;                         // D6：阈值声明化
      const total = p.repairTotal || 0;
      rows.push(`<div class="sec">维修进度（累计含追加）</div>
        <div class="pbar"><div class="pfill ${p.repairExposed ? 'hot' : ''}" style="width:${clampN(total / th * 100, 0, 100)}%"></div></div>
        <div class="kv"><span>${p.repairExposed ? '已暴露（编号与职业已向全体公开）' : '距暴露还需 ' + Math.max(0, th - total).toFixed(1)}</span>
        <span>${total.toFixed(1)} / ${th.toFixed(1)}</span></div>`);
      if (RD.hasGrant(p.role, 'extraRepair')) rows.push(kv('追加维修', `${p.extraRepair} / 3 次（仅限本人基础维修当夜）`));
      /* T6（2026-10-04 文本审查 P0）：原此处渲染「第 1 夜全能免疫·生效中」——v6.6 已删除该
         被动免疫（改为工程师限定技「安全室」4.3.1），全仓无发放点，属幽灵 UI，整行删除。 */
    }
    if (p.role === 'bio') { rows.push(kv('治疗额度', `${p.healLeft}`)); rows.push(kv('自救额度', `${p.selfSaveLeft} / 1`)); }
    if (RD.hasGrant(p.role, 'save')) { rows.push(kv('救援额度', `${p.rescueLeft}`)); rows.push(kv('治疗额度', `${p.cureLeft}`)); }   // D6
    if (p.role === 'inspector') rows.push(kv('紧急会议', `${p.meetingLeft} / 1`));
    /* 神探：已查验池（编号/职业/查验当夜/存活/已发布，§2.7；阵营标注待拍板 I9，暂不显示） */
    if (p.role === 'detective' && p.checkPool) {
      const pool = Array.isArray(p.checkPool) ? p.checkPool
        : [...p.checkPool.values()].map(x => x);
      if (pool.length) {
        rows.push(`<div class="sec">已查验池</div>` + pool.map(rec => {
          const t = g.players.find(x => x.id === rec.id);
          return `<div class="kv"><span>${rec.id} 号</span><span>${rec.role ? esc(roleNameOf(rec.role)) : '—'} · 第${rec.night}夜查验` +
            ` · ${t && !t.out ? '存活' : '已出局'}${rec.published ? ' · 已发布' : ''}</span></div>`;
        }).join(''));
      }
    }
    /* 普通船员：查验记录（A13 验证式——提交身份与是/否答案，查验者×目标独立留存，4.1.1⑤） */
    if ((p.role === 'crew' || p.transferred) && p.crewChecks) {
      const entries = Array.isArray(p.crewChecks) ? p.crewChecks.map(x => [+x.id, x])
        : [...p.crewChecks.entries()].map(([id, v]) => [+id, v]);
      if (entries.length) {
        rows.push(`<div class="sec">查验记录（转职后保留，4.1.4）</div>` + entries.map(([id, v]) =>
          `<div class="kv"><span>${id} 号（查 ${v.n} 次）</span><span>${(v.results || []).map(r =>
            `${roleNameOf(r.id)}→${r.ans ? '是' : '否'}`).join('；') || '（无有效作答）'}</span></div>`).join(''));
      }
    }
    return rows.join('');
  }

  function campPanel(g, me) {
    let html = '';
    /* v32（用户拍板「不开 DEV 不得显示怀疑度」）：威胁度榜 = 怀疑度共识快照，只在 DEV 显示 */
    if (g.dev) {
      const rows = g.players.filter(p => !p.out)
        .map(p => ({ p, h: (g.threat && g.threat[p.id]) || 0, accusers: [...new Set(p.accusers || [])] }))
        .sort((a, b) => b.h - a.h || a.p.id - b.p.id);
      html += `<div class="sec">威胁度榜（DEV）</div>` + rows.map(r =>
        `<div class="kv"><span>${r.p.id} 号 ${esc(r.p.name)}</span>` +
        `<span><b class="${r.h >= 60 ? 'f-a' : ''}">威胁度 ${r.h}</b>${r.accusers.length ? ' · 被指控' : ''}</span>` +
        `${r.accusers.length ? ' · 被 ' + r.accusers.join('、') + ' 号指控' : ''}</span></div>`).join('');
      html += `<p class="tiny">威胁度来自公开发言中的点名指控（每次 +3；船员公开锁定非人类 +6）；` +
        `每 1 点威胁度相当于 2 点可疑度，直接进入所有 AI 的投票权重。指控后来被证实为人类者，自身威胁度 +3（反噬）。</p>`;
    }

    if (me.faction === 'alien') {
      /* v32：队内频道·白天密谈记录（ factionLog = 玩家与 AI 队友的白天密谈流） */
      const flog = g.factionLog || [];
      html += `<div class="sec">队内频道 · 白天密谈（仅队友可见，不留公开痕）</div>` +
        (flog.length ? flog.slice(-12).map(f =>
          `<div class="evt info">第 ${f.night} 夜 · ${f.from} 号（队内）：${esc(f.text)}</div>`).join('')
          : '<div class="empty">讨论窗口下方的「队内频道」输入行可密谈——AI 队友会真实入账（D 档）</div>');
      const mates = g.players.filter(x => x.faction === 'alien' && x.id !== me.id && !x.out);
      html += `<div class="sec">队友（队内共享）</div>` +
        (mates.length ? mates.map(x => `<div class="kv"><span>${x.id} 号 ${esc(x.name)}</span>
          <span>刀数 ${x.alien ? (x.alien.dir === 'kill' ? '无冷却' : x.alien.kills + '/2') : '—'} · 破坏 ${x.alien ? (x.alien.destroyTotal || 0).toFixed(1) : '—'}/6.0
          ${x.infection && x.infection.real === false ? ' · <span class="tag ok">假标记</span>' : ''}</span></div>`).join('')
          : '<div class="empty">已全部出局</div>');
      const votes = g.votes || g.voteSources || {};
      const mine = Object.keys(votes).filter(k => g.players[k - 1] && g.players[k - 1].faction === 'alien');
      html += `<div class="sec">本方票型</div>` + (mine.length
        ? mine.map(k => `<div class="kv"><span>${k} 号</span><span>${votes[k] == null ? '弃票' : '→ ' + votes[k] + ' 号'}</span></div>`).join('')
        : '<div class="empty">本轮尚无投票</div>');
    } else if (me.faction === 'xeno') {
      html += '<div class="empty">外星人为独立阵营，无队内共享。</div>';
    } else {
      html += '<div class="empty">人类无队内共享；独占信息见「状态」页与私人反馈。</div>';
    }
    /* 验票官：票源图 + 历史票源记录（2.9，用于识别抱团） */
    if (me.role === 'inspector') {
      const cur = g.votes || g.voteSources || {};
      html += `<div class="sec">本轮票源图</div>` + (Object.keys(cur).length
        ? Object.keys(cur).map(k => `<div class="kv"><span>${k} 号</span><span>${cur[k] == null ? '弃票' : '→ ' + cur[k] + ' 号'}</span></div>`).join('')
        : '<div class="empty">本轮尚无投票</div>');
      const hist = g.voteHistory || [];
      if (hist.length) {
        html += `<div class="sec">历史票源记录</div>`;
        for (const h of hist.slice(-4).reverse()) {
          const parts = Object.keys(h.src).filter(k => h.src[k] != null).map(k => `${k}→${h.src[k]}`);
          html += `<div class="kv"><span>第${h.night}夜·${esc(h.round)}</span><span>${esc(parts.join(' ') || '全部弃票')}</span></div>`;
        }
      }
    }
    return html;
  }

  /* ---------- 开发者视角：威胁度表 + 票型 + 身份/技能 + 私聊（原型专用，规则上属私有信息） ---------- */
  /* 单机模式 g.dev 是布尔，直接读权威状态；联机模式 g.dev 是视图载荷 */
  function devSrc(g) {
    if (typeof g.dev === 'object' && g.dev) return g.dev;
    const agents = g.players.filter(p => !p.isHuman && !p.out).map(a => ({
      id: a.id, faction: a.faction, role: a.role, roleName: a.roleName, theta: a.theta,
      top: Engine.alive(g).filter(t => t.id !== a.id)
        .map(t => ({ id: t.id, T: Math.round(global.AI ? global.AI.suspOf(g, a, t.id) : 0) }))
        .sort((x, y) => y.T - x.T),
    }));
    return {
      threat: g.threat || {}, votes: g.voteSources || {}, agents,
      skills: g.players, chats: g.privateChats || [], history: g.voteHistory || [],
      inboxes: g.players.map(p => ({
        id: p.id, name: p.name,
        items: (p.inbox || []).slice(-8).map(e => ({ night: e.night, step: e.step, text: e.text })),
      })).filter(x => x.items.length),
    };
  }
  function skillDesc(g, p) {
    const parts = [];
    if (p.dying) parts.push('<b class="f-a">濒死</b>');
    /* v22 缺陷修复：此处引用的 g 曾是未声明标识符——短路求值使其仅在玩家被沉默时
       才抛 ReferenceError（外星人觉醒双刀的中后期才出现，故「有时候」崩）。改为显式传参。 */
    if (p.silenceNight != null && g && p.silenceNight >= g.night) parts.push('沉默@' + p.silenceNight);
    if (p.infection) parts.push(p.infection.real === false ? '假标记' : p.infection.real ? `真感染(死@${p.infection.deathNight})` : '带标记');
    if (RD.hasGrant(p.role, 'shoot')) parts.push(`枪${p.bullets}${p.patrolUsed ? '·巡逻已用' : ''}`);      // D6
    if (RD.hasGrant(p.role, 'repair')) parts.push(`维修${(p.repairTotal || 0).toFixed(1)}/${RD.repairExposeAtOf(p.role) || 0}·追加${p.extraRepair}`);   // D6
    if (p.role === 'bio') parts.push(`治疗${p.healLeft}·自救${p.selfSaveLeft}`);
    if (RD.hasGrant(p.role, 'save')) parts.push(`救援${p.rescueLeft}·治疗${p.cureLeft}`);   // D6：能力标签（救援族）
    if (p.role === 'alien') parts.push(`刀${p.alien ? p.alien.kills : '—'}·护盾${p.shield || 0}·破坏${((p.alien && p.alien.destroyTotal) || 0).toFixed(1)}`);
    /* 〔43〕按 role 判：否则死囚的花名册行会对**所有人**显示「免疫0·双刀✗」这两条它并不持有的技能 */
    if (SKD.isClassicXeno(p)) parts.push(`免疫${p.nightImmune}·双刀${p.awakened ? '✓' : '✗'}`);
    if (p.convict) parts.push(p.morph ? `变形为${roleNameOf(p.morph)}` : '本体形态');
    if (p.role === 'inspector') parts.push(`会议${p.meetingLeft}`);
    if (p.antibodyNight != null && p.antibodyNight >= g.night) parts.push('抗体');
    if (p.brew) parts.push(`制药${p.brew.progress}/${(global.SKProcess && global.SKProcess.get('brew').nights) || 2}`);   // C11：进度上限由声明给出
    return parts.length ? parts.join(' · ') : '—';
  }
  function devPanel(g, me) {
    if (!g.dev) return `<div class="empty">开发者视角未开启。点击 HUD 的 <b>DEV</b> 按钮开启。</div>`;
    const d = devSrc(g);
    const th = d.threat || {};
    /* v31 批 0（文案口径修正）：此前写「群体威胁度共识（基准 28.6 + 公开指控增量）」——
       三个词错了两个：加的是【怀疑度增量】、28.6 是【人类敌对度先验】、且它是 DEV 快照口径
       （AI 决策禁读，见 perceive.updatePublicThreat）。现按实际口径改写。 */
    let html = '<div class="sec">怀疑度共识（先验 28.6 + 各 AI 私有增量均值）</div>';
    const people = d.skills || g.players;   // 联机载荷 / 单机权威状态
    html += people.filter(p => !p.out)
      .sort((a, b) => (th[b.id] || 0) - (th[a.id] || 0))
      .map(p => `<div class="kv"><span>${p.id} 号 ${esc(p.name)}${me && p.id === me.id ? '（我）' : ''}</span>
        <span><b class="${(th[p.id] || 0) >= 60 ? 'f-a' : ''}">${th[p.id] == null ? '—' : th[p.id]}</b></span></div>`).join('');

    html += '<div class="sec">全员身份 · 技能状态</div>';
    html += people.map(p => `<div class="kv"><span>${p.id} 号 ${esc(p.name)}${p.out ? '（出局）' : ''}</span>
      <span class="${facCls(p.faction)}">${esc(p.roleName || '—')}${p.out ? '' : ' · ' + skillDesc(g, p)}</span></div>`).join('');

    html += '<div class="sec">各 AI 私有威胁度表（θ=西塔档，Top 目标）</div>';
    for (const a of (d.agents || [])) {
      const top = (a.top || []).slice(0, 6).map(x => `${x.id}号:${x.T}`).join('　');
      html += `<div class="kv"><span>${a.id} 号 ${esc(a.roleName || '')}（${facName(a.faction)}·θ${a.theta}）</span><span>${esc(top || '—')}</span></div>`;
    }

    const votes = d.votes || {};
    html += '<div class="sec">当轮票型（投票者 → 被投者）</div>';
    const vs = Object.keys(votes);
    html += vs.length ? vs.map(v => `<div class="kv"><span>${v} 号</span><span>${votes[v] == null ? '（弃票）' : votes[v] + ' 号'}</span></div>`).join('')
                      : '<div class="empty">本局尚未进行投票</div>';
    const hist = d.history || g.voteHistory || [];
    html += '<div class="sec">历史票型</div>';
    html += hist.length ? hist.slice().reverse().map(r =>
      `<div class="kv"><span>第${r.night}夜 ${esc(r.round)}</span><span>${
        Object.keys(r.src).map(v => `${v}→${r.src[v] == null ? '弃' : r.src[v]}`).join('　')}</span></div>`).join('')
      : '<div class="empty">暂无</div>';

    const chats = d.chats || [];
    html += '<div class="sec">私聊记录（0c 正文，全局可见·仅开发者）</div>';
    html += chats.length ? chats.slice().reverse().map(c =>
      `<div class="say"><span class="who">第${c.night}夜 ${c.a}↔${c.b}</span><br/>${esc(c.ta || '（沉默）')}<br/>${esc(c.tb || '（沉默）')}</div>`).join('')
      : '<div class="empty">尚无私聊</div>';
    /* 上帝视角：全员私人反馈（inbox） */
    const inboxes = d.inboxes || [];
    if (inboxes.length) {
      html += '<div class="sec">全员私人反馈（inbox · 仅开发者）</div>';
      for (const pb of inboxes) {
        html += pb.items.slice().reverse().map(e =>
          `<div class="kv"><span>${pb.id} 号 · 第${e.night}夜 ${esc(E.STEP_NAME[e.step] || e.step || '')}</span><span class="prv" style="text-align:left">${esc(e.text)}</span></div>`).join('');
      }
    }
    /* v32（用户拍板）：账本并入 DEV——「我的账本」是开发者视角的一部分，不再单独暴露按钮。
       账本内容 = 玩家席位自己的推理资产（与 AI 同一份机制产生）。 */
    /* 〔R4〕账本已改为场景笔记本；DEV 里保留一个入口（点开同一个覆盖层） */
    html += `<div class="sec">我的账本</div><div class="hint">已移到场景里的笔记本（点桌面上的本子打开）</div>`;
    return html;
  }

  /* 〔R2 重设计〕renderSide（右栏三页签：书记官档案 / 我的日记 / 阵营日记）已整体删除。
     它是表单式设计的核心：公告按夜分组列表 + 发言流水 + 三页签切换。用户要求「把原来的设计
     全部删掉，不需要保留那些所谓的流水，还有那个公告」，故：
       · 公告 → 改在行动面板逐条浮现（renderStage 的 announceHtml，本来就在主区）；
       · 发言 → 场景气泡（SKScene.updateBubbles）是唯一载体；
       · 私人反馈 / 阵营信息 → 仍可从玩家详情弹窗（点席位）与 DEV 浮层查看，数据源未动。
     旧实现完整保留在 backup/form-ui-20261025/ui.js，需要时可取回。 */
  function renderSide() { /* 已退役：保留空实现，避免 render() 里的调用点需要条件分支 */ }

  /* ---------- 复盘 ---------- */
  function renderOver(g) {
    el('screen-game').classList.add('hidden');
    el('screen-over').classList.remove('hidden');
    el('replay-box').classList.add('hidden');
    const me = E.P(g, g.humanId) || {};
    const win = { human: '人类', alien: '异形', xeno: '外星人', draw: '平局' }[g.winner] || '—';
    const myWin = g.winner === me.faction;
    el('over-title').innerHTML = g.winner === 'draw' ? '平局'
      : `<span class="${facCls(g.winner)}">${win}阵营获胜</span>`;

    const end = global.Game.endData || {};
    const roster = end.roster || g.players.map(p => ({
      id: p.id, name: p.name, faction: p.faction, role: p.role, roleName: p.roleName,
      out: p.out, outNight: p.outNight, outType: p.outType, cause: p.cause,
    }));
    el('over-body').innerHTML =
      `<p>你是 <b>${me.id != null ? me.id + ' 号 ' : ''}${esc(me.name || '')}</b> · ` +
      `<b class="${facCls(me.faction)}">${esc(me.roleName || '—')}（${facName(me.faction)}）</b> —— ` +
      `${g.winner === 'draw' ? '全局判平。' : (myWin ? '你所在的阵营获胜。' : '你所在的阵营落败。')}</p>` +
      /* 〔v1preview1.0 6.9/1.2.5〕外星人逃亡＝次胜：不终结对局，对局继续后的结果不回溯改判 */
      (g.xenoSubWin ? `<p class="evt good">外星人已执行逃亡，取得【次胜】（对局继续进行至终局，其次胜不因后续结果改判）。</p>` : '') +
      `<p class="hint">共 ${g.night} 夜，倒计时剩余 ${(g.countdown || 0).toFixed(1)}，净破坏量 ${((g.net10 || 0) / 10).toFixed(1)}。</p>` +
      /* 〔R5〕终局名册：按阵营分组（不再是一张 15 行两列表格）。
         阵营归属是终局公开信息（上帝视角解锁），分组呈现比逐行罗列更符合复盘直觉。
         数据口径不变：仍读 end.roster / g.players 的 id/name/faction/roleName/out*。 */
      (function () {
        const order = ['human', 'alien', 'xeno'];
        const byFac = {};
        roster.forEach(x => { (byFac[x.faction] = byFac[x.faction] || []).push(x); });
        const facOrder = order.filter(f => byFac[f] && byFac[f].length)
          .concat(Object.keys(byFac).filter(f => order.indexOf(f) < 0));
        return '<div class="sec">终局名册 · 上帝视角已解锁</div>'
          + '<div class="over-roster">'
          + facOrder.map(f => {
            const list = byFac[f];
            return '<div class="or-group ' + facCls(f) + '">'
              + '<div class="or-head"><b>' + facName(f) + '</b><i>' + list.length + ' 人</i></div>'
              + '<div class="or-members">'
              + list.map(x => {
                const img = 'assets/scene/characters/a-crew/seat-' + String(x.id).padStart(2, '0') + '.svg';
                const outTxt = x.out
                  ? '第' + x.outNight + '夜' + (x.outType === 'vote' ? '被驱逐'
                    : x.outType === 'escape' ? '逃亡' : '死于' + (D.CAUSE_NAME[x.cause] || '—'))
                  : '存活';
                return '<span class="or-m' + (x.out ? ' out' : '') + '" title="' + esc(x.name) + ' · ' + esc(x.roleName) + ' · ' + outTxt + '">'
                  + '<img src="' + img + '" alt="" draggable="false"/>'
                  + '<b>' + x.id + '</b>'
                  + '<span class="or-n">' + esc(x.name) + '</span>'
                  + '<span class="or-r">' + esc(x.roleName) + '</span>'
                  + '<span class="or-s">' + outTxt + '</span>'
                  + '</span>';
              }).join('')
              + '</div></div>';
          }).join('')
          + '</div>';
      })();

    rpNight = 0;
    el('rp-nights').innerHTML = nights(g).map(n =>
      `<button class="act rp-n ${n === 0 ? 'sel' : ''}" data-n="${n}">${n === 0 ? '全部' : '第 ' + n + ' 夜'}</button>`).join('');
    el('rp-nights').querySelectorAll('.rp-n').forEach(b => b.onclick = () => {
      rpNight = +b.dataset.n;
      el('rp-nights').querySelectorAll('.rp-n').forEach(x => x.classList.toggle('sel', +x.dataset.n === rpNight));
      renderReplayBody(g);
    });
    /* 〔批次 34 · 叙事层 N2〕复盘盒加「原始／叙事」并排页签——**默认原始**，
       叙事是增量视图而非替代（可回退、不改原始数据）。叙事内容由 Narrator 生成：
       chronicle（系统编年史）＋ voice（AI 视角的个人讲法，含长期记忆与立场收尾）。

       ⚠ **联机态封锁（批次 34 决定，本批不实装）**——叙事页签当前只在单机局成立。
          联机局 `Game.g` 是 `View.hydrate(m.view)` 的视图而非真对局（main.js 的 'state' 分支），
          而视图的 `log` 经 `SKVisible.canSee` **按观察者过滤**（view.js build），于是：
            ① chronicle() 读到的是「该玩家能看到的编年」而非终局全知编年——**静默降级**，
               同一局在单机与联机会讲出两份不同的复盘，且不报错；
            ② `duelSinceNight` 不在视图载荷内，narrator 的决斗章节标注回落 `g.night`；
            ③ `mem`（AIMemory，内部为 Map）不过线（AI 跑在服务端），`voice()` 拿不到长期记忆，
               故联机局只有「全局编年」段、没有「你的视角」段。
          **解冻时须做**（勿在冻结期内顺手改）：给视图补一份不过 canSee 的编年源，或由 server
          在 'end' 载荷里直接下发 chronicle 结果；并裁定 `voice` 是限定单机、还是随载荷下发
          （后者要一并处理 AIMemory 的序列化口径）。本段为改动备注，不是待办承诺。 */
    const NR = global.Narrator;
    if (NR && typeof NR.chronicle === 'function') {
      const doc = NR.chronicle(g);
      if (doc) {
        const meId = me.id != null ? me.id : null;
        const memP = meId != null ? (E.P(g, meId) || {}).mem : null;
        let sysTxt = '', voiceTxt = '';
        try { sysTxt = NR.renderDoc(doc); } catch (e) { sysTxt = '（复盘文本生成失败：' + e.message + '）'; }
        if (meId != null) {
          try {
            voiceTxt = NR.voice(doc, {
              me: meId, mem: memP,
              aliveIds: g.players.filter(x => !x.out).map(x => x.id),
            });
          } catch (e) { voiceTxt = '（个人叙事生成失败：' + e.message + '）'; }
        }
        g._replayDoc = { sys: sysTxt, voice: voiceTxt, meId };
      }
    }
    el('rp-modes').innerHTML =
      `<button class="act rp-m sel" data-m="raw">原始</button>` +
      (g._replayDoc ? `<button class="act rp-m" data-m="story">叙事</button>` : '');
    el('rp-modes').querySelectorAll('.rp-m').forEach(b => b.onclick = () => {
      rpMode = b.dataset.m;
      el('rp-modes').querySelectorAll('.rp-m').forEach(x => x.classList.toggle('sel', x.dataset.m === rpMode));
      renderReplayBody(g);
    });
    renderReplayBody(g);
  }

  function nights(g) {
    const end = global.Game.endData || {};
    /* K3（B3）：对局进行中不得读 g.replay（本地模式在终局后仍可读，联机模式只读 end 载荷） */
    const list = (end.replay || (g && g.over ? g.replay : null) || []).map(e => e.night);
    return [0, ...[...new Set(list)].sort((a, b) => a - b)];
  }

  function renderReplayBody(g) {
    const end = global.Game.endData || {};
    /* 〔批次 34 · 叙事层 N2〕叙事页签：渲染 Narrator 的编年史与个人讲法。
       纪律：①纯读——不改 g.replay/g.log；②经 Taboo 出口校验（Narrator 内部已 assert）；
            ③逐字转义后插入（与原始流同一防注入口径）。夜次筛选对叙事页签不适用
            （叙事是整局的连贯叙述，切夜会破坏因果链）——故叙事页签忽略 rpNight。 */
    if (rpMode === 'story' && g._replayDoc) {
      const d = g._replayDoc;
      const parts = [];
      if (d.meId != null && d.voice) {
        parts.push('<div class="sec">你的视角</div>');
        parts.push('<div class="storyvoice">' + esc(d.voice).replace(/\n/g, '<br>') + '</div>');
      }
      if (d.sys) {
        parts.push('<div class="sec">全局编年</div>');
        parts.push('<div class="storysys">' + esc(d.sys).replace(/\n/g, '<br>') + '</div>');
      }
      el('rp-body').innerHTML = parts.join('') ||
        '<div class="hint">（本局无可生成的复盘叙事）</div>';
      return;
    }
    /* K3（B3）：同上——进行中回退为空数组，绝不在对局中暴露隐藏历史 */
    const rp = (end.replay || (g && g.over ? g.replay : null) || []).filter(e => !rpNight || e.night === rpNight);
    let html = '', cur = null;
    for (const e of rp) {
      const key = e.night + '/' + (e.step || '');
      if (key !== cur) {
        cur = key;
        html += `<div class="sec">第 ${e.night} 夜 · ${esc(E.STEP_NAME[e.step] || e.step || '流程')}</div>`;
      }
      if (e.scope === 'god') html += `<div class="god">▸ ${esc(e.text)}</div>`;
      else if (e.scope === 'priv') html += `<div class="prv">私密→${e.who}号：${esc(e.text)}</div>`;
      else html += `<div class="logline"><span class="b">${e.batch || ''}</span> ${esc(e.text)}</div>`;
    }
    el('rp-body').innerHTML = html || '<div class="empty">无记录</div>';
  }

  /* ---------- 房间 ---------- */
  function renderRoom(room) {
    el('screen-start').classList.add('hidden');
    el('screen-room').classList.remove('hidden');
    el('room-tag').textContent = room.id;
    el('seats').innerHTML = Array.from({ length: 15 }, (_, i) => {
      const s = room.seats.find(x => x.seat === i + 1);
      return `<div class="pl ${s ? '' : 'empty'}"><div class="top"><span class="no">${i + 1}</span>
        <span class="nm">${s ? esc(s.name) : '（AI 托管）'}</span></div>
        <span class="tags">${s ? (s.connected ? '<span class="tag ok">在线</span>' : '<span class="tag warn">断线·AI托管</span>') : ''}</span></div>`;
    }).join('');
    const me = global.Net.info();
    const isHost = me.seat === room.hostSeat;
    el('room-hint').textContent = isHost
      ? '你是房主，点击开始对局。'
      : `等待房主（${esc(room.host)}）开始…`;
    el('btn-launch').disabled = !isHost || room.started;
  }

  function render() {
    const g = global.Game.g;
    if (!g) return;
    /* v33：新手首局自动展开规则速览——本机第一次进对局触发一次，此后默认收起（localStorage 记忆） */
    try {
      if (!localStorage.getItem('sk_rules_seen')) {
        localStorage.setItem('sk_rules_seen', '1');
        openRules();
      }
    } catch (_) { /* 隐私模式等 localStorage 不可用时静默跳过 */ }
    if (g.over) { hideTalkBar(); const ov = el('dev-overlay'); if (ov) ov.classList.add('hidden'); renderOver(g); return; }
    /* 〔42〕本次渲染的可见性出口：所有「别的玩家」的数据一律经 View.viewFor 裁剪。
       联机时 Game.g 本身就是视图载荷（viewFor 幂等原样返回），单机时在这里现裁一次。
       裁剪失败不得静默退回明文 —— 那等于把漏口重新打开，故抛错由 showFatal 接住。 */
    let V = null;
    try { V = global.View.viewFor(g, g.humanId); }
    catch (e) { showFatal('视图裁剪失败：' + (e && e.message ? e.message : e)); return; }
    renderHud(g); renderPlayerPop(g, V);   /* 〔S5〕renderRoster 退役：场景即名单（席位点击=openPlayerPop） */
    applyStageLayout(g);            /* 〔43〕主区布局：必须在 renderStage 之前 —— 它决定哪块区域存在 */
    renderStage(g, V); renderSide(g, V);
    /* 〔S1〕圆桌场景（只读层）：数据走 V（View.viewFor 裁剪视图）；场景层异常不得阻塞对局渲染 */
    if (global.SKScene) { try { global.SKScene.render(g, V); } catch (_) { } }
    /* 开发者浮层：显隐由「上帝模式 && 浮层开关」双条件决定——✕ 关闭后重渲染不会再弹出 */
    const ov = el('dev-overlay');
    if (ov) {
      ov.classList.toggle('hidden', !g.dev || !devOvOpen);
      if (g.dev && devOvOpen) el('dev-body').innerHTML = devPanel(g, E.P(g, g.humanId));
    }
    /* 上帝模式开着但总览被收起时，显示可点击角标以重新展开 */
    const chip = el('dev-chip');
    if (chip) {
      chip.classList.toggle('hidden', !g.dev || devOvOpen);
      if (g.dev && !devOvOpen) chip.textContent = `DEV 已开启 · 展开总览`;
    }
    if (!(g.pending && g.pending.stream)) hideTalkBar();
    updateTimer();
  }

  /* v34 C4：@ 提及自动补全——输入 @（可带编号前缀）弹出存活玩家浮层，点击补全为「N 号 」 */
  function atCheck() {
    const t = el('f-text'), pop = el('at-pop');
    if (!t || !pop) return;
    const g = global.Game.g;
    const m = /@(\d{0,2})$/.exec(t.value || '');
    if (!m || !g || !(g.pending && g.pending.stream)) { pop.classList.add('hidden'); return; }
    const me = E.P(g, g.humanId);
    const q = m[1];
    const list = E.alive(g)
      .filter(p => p.id !== (me && me.id) && (!q || String(p.id).indexOf(q) === 0))
      .slice(0, 8);
    if (!list.length) { pop.classList.add('hidden'); return; }
    pop.innerHTML = list.map(p =>
      `<button class="at-item" data-pid="${p.id}">${p.id} 号 ${esc(p.name)}</button>`).join('');
    pop.classList.remove('hidden');
  }
  /* 发言识别预览 / 回显：「AI 听到了什么」——真人据此检查 AI 的识别能力 */
  function previewTalk() {
    const box = el('talk-preview'), t = el('f-text');
    if (!box || !t) return;
    const text = t.value.trim();
    if (!text || !global.NLP) { box.classList.add('hidden'); return; }
    const sig = global.NLP.parse(text);
    const sum = global.NLP.summarize(sig);
    box.classList.remove('hidden');
    box.innerHTML = sum
      ? `<span class="ok">AI 听到：</span>${esc(sum)}`
      : `<span class="warn">AI 没听出任何意图——试试带编号（如「5 号」）、黑话（金水/查杀/归票）或完整句式</span>`;
  }
  /* 点击玩家弹窗里的自动讯问句：填入输入框（可再改写），同步显示识别预览 */
  function fillProbe(pid, tier) {
    const g = global.Game.g;
    if (!g) return;
    if (!(g.pending && g.pending.stream)) { showToast('当前不在讨论窗口，发言无效'); return; }
    const t = el('f-text');
    if (!t || !global.Lang) return;
    t.value = global.Lang.probe(pid, tier || 'ask');
    previewTalk();
    t.focus();
  }
  function sendTalk() {
    const t = el('f-text');
    const text = t && t.value.trim() ? t.value : '';
    if (text) {
      global.Game.talk(text, null, null);   // 意图全部由解析器从语句本身识别——这也是对识别能力的检验
      if (t) t.value = '';
      const box = el('talk-preview');
      if (box) box.classList.add('hidden');
    }
  }
  /* v32：白天队内频道（异形专属）——玩家密谈即时投递队友 inbox + privateSay（D 档入账 AI 队友） */
  function sendCamp() {
    const g = global.Game.g;
    const t = el('f-camp');
    if (!g || !t) return;
    const text = t.value.trim();
    if (!text) return;
    const me = E.P(g, g.humanId);
    if (!me || me.faction !== 'alien' || me.out) return;
    const mates = g.players.filter(x => x.faction === 'alien' && x.id !== me.id && !x.out);
    for (const m of mates) {
      m.inbox.push({ night: g.night, step: g.step, text: `${me.id} 号（队内·白天）：${text}` });
      if (!m.isHuman && global.Bridge) global.Bridge.privateSay(g, m.id, me.id, text);
    }
    (g.factionLog = g.factionLog || []).push({ night: g.night, from: me.id, text });
    t.value = '';
    render(g);
  }

  /* DEV 视角切换（ui 层实现，本地直接改状态；联机由 Game.toggleDev 转发）
     g.dev = 上帝模式（名单揭示+威胁度，粘滞）；devOvOpen = 总览浮层显隐（独立控制，✕/Esc 仅关浮层）

     〔42〕ENABLE_DEV 全局开关：当前处于 preview 阶段，DEV 是必要的调试工具，故保留；
     但必须能被一处关掉而不动其他代码。约定 window.SK_ENABLE_DEV：
       · 未设置 ⇒ 默认开启（preview 现状不变）
       · 设为 0 / false / '0' ⇒ 关闭：#btn-dev 按钮直接移除（非 display:none，
         避免正式版 DOM 里还留着调试入口），且 toggleDevView / Game.toggleDev 变成空操作，
         即使有人手工改 g.dev 也没有任何 UI 会去渲染它。
     正式发布时在 index.html 加一行 <script>window.SK_ENABLE_DEV = 0;</script> 即可。 */
  function devEnabled() {
    const v = global.SK_ENABLE_DEV;
    return !(v === 0 || v === false || v === '0' || v === 'false');
  }
  let devOvOpen = false;
  function toggleDevView() {
    const g = global.Game.g;
    if (!g || !devEnabled()) return;
    /* DEV 是纯开关：开着时再点一次即整体关闭（上帝模式、总览、详情弹窗一并收起） */
    if (!g.dev) { g.dev = true; devOvOpen = true; }
    else { g.dev = false; devOvOpen = false; popPid = null; }
    if (global.Game.mode === 'net') global.Net.send({ t: 'dev', on: g.dev });
    const b = el('btn-dev');
    if (b) b.classList.toggle('on', g.dev);
    render(g);
  }

  /* 〔44〕首页「自选身份」面板（软偏好）
   * ------------------------------------------------------------------
   * 数据全部来自声明层，本文件不含任何角色字面量 —— 加角色只改 roleDecl（K1 纪律）。
   * 可选性 / 组位 / 席位 / 变体归属分别读 SKRoleDecl.selectable、GROUP_TABLE、
   * Setup.seatClaim；本文件只渲染与联动，不做任何规则判断。
   *
   * 为什么是「软偏好」而非硬指定：玩家点某角色 → createGame 尽量把该席位给他；
   * 若本局该席位掷出了另一个变体，Setup.rollSeatPicks 会把那一席钉死到玩家选的变体
   * （A/B 两侧都钉，见 seatClaim）。只有角色键根本不在席位表内（转职系 / 拼错）
   * 才回落，并由 g.roleNote 说明原因 —— 不得静默换人。
   *
   * 双向联动：选身份 → 阵营卡片跟随该身份的阵营；改阵营 → 若已选身份不属于该阵营，
   *   则清空并 toast 说明，不留互相矛盾的状态。
   */
  const RP_STATE = { role: null };

  /* 可选角色清单：按 阵营序 → 组位 seatOrder → 声明序 排列，
     使卡片顺序与开局公告（批次〇）的构成口径一致，而不是按字典序。 */
  function rpRoleList() {
    const FAC_ORDER = { human: 0, alien: 1, xeno: 2 };
    const order = g => (g && RD.GROUP_TABLE[g] && RD.GROUP_TABLE[g].seatOrder != null)
      ? RD.GROUP_TABLE[g].seatOrder : 99;
    const rows = [];
    for (const k of RD.keys()) {
      if (!RD.selectable(k)) continue;
      const d = RD.ROLE_DECL[k];
      const claim = global.Setup && global.Setup.seatClaim ? global.Setup.seatClaim(k) : null;
      rows.push({
        key: k, faction: d.faction,
        group: d.group,
        groupName: d.group && RD.GROUP_TABLE[d.group] ? RD.GROUP_TABLE[d.group].name : '',
        seats: d.seats || 0, desc: d.desc || '',
        /* 变体归属（1.1.1）：标出来是为了让玩家明白「选它 = 锁定那个席位」，
           而不是以为自己在配置一个额外的席位。 */
        variant: claim ? claim.variant : null,
      });
    }
    return rows.sort((a, b) => (FAC_ORDER[a.faction] - FAC_ORDER[b.faction])
      || (order(a.group) - order(b.group)));
  }

  function rpCardHtml(r) {
    const act = RP_STATE.role === r.key;
    /* 〔44〕解锁门槛接口：当前 ROLE_UNLOCK 全为 null，故无角色被置灰。
       将来设门槛后，这里按 unlockOf(r.key) 渲染 disabled + 进度文案即可，UI 结构不必改。 */
    const u = RD.unlockOf(r.key);
    const locked = !!(u && typeof u.wins === 'number' && u.wins > 0);
    const seatTag = r.variant
      ? `<span class="rp-tag rp-tag-v" title="1.1.1 同席位开局定其一；选中即锁定该席位">变体 ${esc(r.variant)}</span>`
      : `<span class="rp-tag" title="该席位恒定，不参与变体掷骰">常驻</span>`;
    const lockTag = locked ? `<span class="rp-tag rp-tag-lock">累计获胜 ${esc(u.wins)} 局解锁</span>` : '';
    return `<button type="button" class="rp-card f-${esc(r.faction)}${act ? ' active' : ''}${locked ? ' locked' : ''}"
        data-role="${esc(r.key)}" aria-pressed="${act ? 'true' : 'false'}"${locked ? ' disabled' : ''}>
      <span class="rp-bar"></span>
      <span class="rp-nm">${esc(roleNameOf(r.key))}${seatTag}${lockTag}</span>
      <span class="rp-gr">${esc(r.groupName || facName(r.faction))}${r.seats ? ' · ' + r.seats + ' 席' : ''}</span>
      <span class="rp-ds">${esc(r.desc)}</span>
    </button>`;
  }

  function renderRoleGrid() {
    const grid = el('role-grid');
    if (!grid) return;
    grid.innerHTML = rpRoleList().map(rpCardHtml).join('');
  }

  function rpSyncRow() {
    const chip = el('role-chip'), clear = el('role-clear'), note = el('role-note');
    if (!chip) return;
    const k = RP_STATE.role;
    chip.textContent = k ? `${roleNameOf(k)} · ${facName(RD.ROLE_DECL[k].faction)}` : '未选择';
    chip.classList.toggle('has-role', !!k);
    if (clear) clear.hidden = !k;
    /* 回落说明只在「本局真的没给到所选身份」时出现，不是常驻文案 */
    if (note) {
      const g = global.Game && global.Game.g;
      const fell = !!(g && g.roleNote && k && g.roleGot && g.roleGot !== k);
      note.hidden = !fell;
      if (fell) note.textContent = g.roleNote;
    }
  }

  /* 选中身份 → 阵营卡片跟随（身份是更强的信号）。找不到对应 radio 就不动（防御性）。 */
  function rpFollowFaction(roleKey) {
    const f = RD.ROLE_DECL[roleKey].faction;
    const inp = document.querySelector('input[name=fac][value=' + f + ']');
    if (inp) inp.checked = true;
    const scr = el('screen-start');
    if (scr) scr.dataset.fac = f;
    const cs = document.querySelector('.config-strip');
    if (cs) cs.dataset.fac = f;
    const fp = document.querySelector('#screen-start .fp.f-' + f);
    if (fp) fp.classList.add('active');
    document.querySelectorAll('#screen-start .fp').forEach(x => { if (x !== fp) x.classList.remove('active'); });
  }

  function rpPick(roleKey) {
    RP_STATE.role = roleKey || null;
    if (RP_STATE.role) rpFollowFaction(RP_STATE.role);
    rpSyncRow();
    renderRoleGrid();
    const m = el('role-overlay');
    if (m) m.classList.add('hidden');
  }

  /* =============================================================
   * 〔R5〕登船名册：开始页的 15 个席位（取代原来的「15 / 24」数字方框）
   * -------------------------------------------------------------
   * 为什么用席位头像而不是数字：
   *   用户要求主页「不要又成方框点击式的」。数字方块表达的是"参数"，
   *   而玩家真正关心的是"我要坐进这艘船的哪个位置"——用与对局页同源的席位头像，
   *   开始页与对局页就变成同一个世界的两个时刻，而不是两张不同的表单。
   * 数据：15 是结构常量（2.8.14 组位表），这里不读声明层也不读对局状态——
   *   开局前没有任何对局状态，画死 15 个席位是**正确**的（与 departure-ring 同口径）。
   * ============================================================= */
  function mountRosterBoard() {
    const box = el('rb-seats');
    if (!box) return;
    let html = '';
    for (let i = 1; i <= 15; i++) {
      const img = 'assets/scene/characters/a-crew/seat-' + String(i).padStart(2, '0') + '.svg';
      /* 阵营着色：与对局页 PALETTE 同序（人类蓝 / 异形红 / 外星人绿），只做视觉暗示 */
      const cls = i === 10 ? 'rb-xeno' : ([4, 8, 14].indexOf(i) >= 0 ? 'rb-alien' : 'rb-human');
      html += '<span class="rb-seat ' + cls + '" title="' + i + ' 号席位">'
        + '<img src="' + img + '" alt="" draggable="false" /><b>' + i + '</b></span>';
    }
    box.innerHTML = html;
  }

  function mountRolePicker() {
    renderRoleGrid();
    rpSyncRow();
    const grid = el('role-grid');
    if (grid) grid.onclick = e => {
      const b = e.target && e.target.closest ? e.target.closest('.rp-card') : null;
      if (b && b.dataset && b.dataset.role) rpPick(b.dataset.role);
    };
    if (el('role-chip')) el('role-chip').onclick = () => {
      renderRoleGrid();
      const m = el('role-overlay');
      if (m) m.classList.remove('hidden');
    };
    if (el('role-close')) el('role-close').onclick = () => { const m = el('role-overlay'); if (m) m.classList.add('hidden'); };
    if (el('role-none')) el('role-none').onclick = () => rpPick(null);
    if (el('role-clear')) el('role-clear').onclick = () => rpPick(null);
    if (el('role-overlay')) el('role-overlay').onclick = e => {
      if (e.target && e.target.id === 'role-overlay') el('role-overlay').classList.add('hidden');
    };
    /* Esc 关闭：与规则速览同款手势（首页弹层不该只能靠点 ✕） */
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { const m = el('role-overlay'); if (m) m.classList.add('hidden'); }
    });
  }

  /** 供 main.js 开局时读取：当前自选身份的角色键（未选 = null） */
  function preferredRole() { return RP_STATE.role; }

  /* 全局错误可见化：预览/内嵌环境里 JS 异常不再无声失败 */
  /* 轻提示（非致命）：自动讯问的填入确认 / 讨论窗口外点击提示等 */
  function showToast(msg) {
    let bar = document.getElementById('info-toast');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'info-toast';
      bar.style.cssText = 'position:fixed;left:12px;bottom:44px;z-index:99;max-width:60vw;' +
        'background:#12304a;color:#cfe8ff;border:1px solid #2c5f8a;border-radius:9px;padding:8px 12px;font-size:12px;';
      document.body.appendChild(bar);
    }
    bar.textContent = msg;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { bar.remove(); }, 6000);
  }
  function showFatal(msg) {
    let bar = document.getElementById('fatal-toast');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fatal-toast';
      bar.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99;max-width:60vw;' +
        'background:#4a1420;color:#ffd0da;border:1px solid #8a3244;border-radius:9px;padding:8px 12px;font-size:12px;';
      document.body.appendChild(bar);
    }
    bar.textContent = '⚠ ' + msg;
    clearTimeout(showFatal._t);
    showFatal._t = setTimeout(() => { bar.remove(); }, 8000);
  }

  function init() {
    /* 〔R2〕右栏三页签已随表单式设计删除（#nb-tabs 不再存在），页签绑定一并退役。 */
    /* 〔批次 41〕音乐与音效两个独立按钮：此前 orb 栏一个♪ 同时管两者，
       关掉音乐会连带把按键音也关掉。现在 ♫ 只管 BGM、 只管 sfx；
       开启态沿用 v32 的黄光边缘提示（与 DEV 按钮激活态同款）。 */
    const bindAudioToggle = (btnId, onToggle) => {
      const b = el(btnId);
      if (b) b.onclick = () => { const on = onToggle(); b.classList.toggle('on', !!on); b.style.opacity = ''; };
    };
    bindAudioToggle('btn-music', () => global.SKAudio.toggleMusic());
    bindAudioToggle('btn-sfx', () => global.SKAudio.toggleSfx());
    /* 开始页两个开关：文案自带状态；标签与状态均为定长，不引起布局变动 */
    const bindStartToggle = (btnId, label, onToggle) => {
      const b = el(btnId);
      if (b) b.onclick = () => { b.textContent = label + (onToggle() ? '开' : '关'); };
    };
    bindStartToggle('btn-music-start', '♫ 音乐：', () => global.SKAudio.toggleMusic());
    bindStartToggle('btn-sfx-start', '音效：', () => global.SKAudio.toggleSfx());
    /* 〔批次 38b〕BGM 播放速度条状滑杆：连续调节 0.5×~2×，即时生效并回显 ×N.NN。
       音乐未起（bgm 关）时只记档，ensure() 时套用——SKAudio.setRate 的语义。
       拖动过程（input）只改速度不出声（连发 tick 会变机关枪），松手（change）才响一声。 */
    const ts = el('tempo-slider'), tv = el('tempo-val');
    if (ts) {
      const applyTempo = () => {
        const r = global.SKAudio.setRate(ts.value);
        if (tv) tv.textContent = '×' + r.toFixed(2);
      };
      ts.oninput = applyTempo;
      ts.onchange = () => { applyTempo(); global.SKAudio.sfx('tick'); };
    }
    el('btn-send').onclick = sendTalk;
    el('f-text').onkeydown = e => { if (e && e.key === 'Enter') { e.preventDefault(); sendTalk(); } };
    /* v32：队内频道（异形白天密谈） */
    const bc = el('btn-camp'), fc = el('f-camp');
    if (bc) bc.onclick = sendCamp;
    if (fc) fc.onkeydown = e => { if (e && e.key === 'Enter') { e.preventDefault(); sendCamp(); } };
    el('f-text').oninput = () => { global.Game.markTyping && global.Game.markTyping(); previewTalk(); atCheck(); };   // 输入中 → 静默检测重置 + 识别预览 + @补全
    /* DEV 用文档级事件委托：不依赖单一绑定点，任何渲染/覆盖层都不会让按钮失效 */
    document.addEventListener('click', e => {
      const t = e.target && e.target.closest ? e.target.closest('#btn-dev') : null;
      if (t) {
        try { toggleDevView(); }
        catch (err) { showFatal('DEV 切换出错：' + (err && err.message ? err.message : err)); }
        return;
      }
      if (e.target && e.target.closest && e.target.closest('#btn-dev-close')) closeDevView();
      if (e.target && e.target.closest && e.target.closest('#dev-chip')) { devOvOpen = true; render(global.Game.g); return; }
      /* v32：开始页顶部两键——音效开关 / 规则速览（黑话术语表已删，〔批次 36〕） */
      if (e.target && e.target.closest && e.target.closest('#btn-rules')) { openRules(); return; }
      /* 〔R2〕右栏底部规则入口已随右栏删除；规则速览仍在顶栏 orb（#btn-rules）。 */
      /* 〔批 UI-8a〕#btn-rules-start 已从设置面板移除（重复入口 + 点不动），
       这里的分支同批删掉 —— 留着就是"绑到一个不存在的控件"的死代码。 */
      if (e.target && e.target.closest && e.target.closest('#btn-side-toggle')) { toggleSideDrawer(); return; }
      if (e.target && e.target.closest && e.target.closest('#btn-rules-close')) { closeRules(); return; }
      /* 〔批 UI-3a〕底部工具条「当夜记录」：手动展开 / 收起行动面板
         〔批 UI-5〕按钮搬到书记官记录板（#clerk 的 .clerk-ft），id 不变 */
      if (e.target && e.target.closest && e.target.closest('#btn-rec')) { toggleDockPanel(); return; }
      /* 〔批 UI-5〕对局设置：原顶栏圆钮的宿主（打开 / 关闭 / 点背景关） */
      if (e.target && e.target.closest && e.target.closest('#btn-settings-game')) { toggleSettings(); return; }
      if (e.target && e.target.closest && e.target.closest('#settings-close')) { toggleSettings(false); return; }
      if (e.target && e.target.closest && e.target.closest('#settings-overlay')) {
        /* 点覆盖层自身（不是里面的控件）= 关；点 .set-body 内的控件不关 */
        if (e.target === e.target.closest('#settings-overlay')) { toggleSettings(false); return; }
      }
      /* v32：单机暂停 / 退出（仅单机模式显示按钮）；〔批次 38b〕orb 只留图标，汉字说明在 title */
      if (e.target && e.target.closest && e.target.closest('#btn-pause')) {
        global.Game.togglePause();
        const b = e.target.closest('#btn-pause');
        if (b) b.textContent = global.Game.paused ? '▶' : '⏸';
        return;
      }
      if (e.target && e.target.closest && e.target.closest('#btn-exit')) { global.Game.exitLocal(); return; }
      /* 自动讯问按钮（玩家详情弹窗内） */
      const probeBtn = e.target && e.target.closest ? e.target.closest('[data-probe]') : null;
      if (probeBtn) {
        try { fillProbe(+probeBtn.dataset.pid, probeBtn.dataset.probe); }
        catch (err) { showFatal('讯问生成出错：' + (err && err.message ? err.message : err)); }
        return;
      }
      /* 〔S5〕发言流 ↔ 名单联动退役：主区已无 #chatlog（发言走场景气泡 + 书记官档案），
         对应的「只看某编号」过滤态与 .chat-filter-chip 一并删除。 */
      /* v34 C4：@ 自动补全项点击 → 补全为「N 号 」 */
      const ati = e.target && e.target.closest ? e.target.closest('.at-item') : null;
      if (ati) {
        const t = el('f-text');
        if (t) {
          t.value = t.value.replace(/@\d*$/, ati.dataset.pid + ' 号 ');
          previewTalk(); atCheck(); t.focus();
        }
        return;
      }
      /* 玩家名单卡片：点击任意玩家（含出局者）打开详情弹窗 */
      const card = e.target && e.target.closest ? e.target.closest('#roster .pl') : null;
      if (card) {
        const pid = +card.dataset.pid;
        popPid = popPid === pid ? null : pid;   // 再点同一张卡 = 收起
        render(global.Game.g);
        return;
      }
      if (e.target && e.target.closest && e.target.closest('#btn-p-close')) { popPid = null; render(global.Game.g); }
      if (e.target && e.target.closest && e.target.closest('[data-ld-close]')) { closeLedger(); return; }
    });
    document.addEventListener('keydown', e => {
      if (e && e.key === 'Escape') { closeRules(); closeDevView(); toggleSettings(false); popPid = null; render(global.Game.g); }
    });
    /* v32：职业备注 select（change 不经 click 委托，单独监听；个人笔记不进 AI 账本） */
    document.addEventListener('change', e => {
      const ns = e.target && e.target.closest ? e.target.closest('#note-select') : null;
      if (!ns) return;
      const g = global.Game.g;
      const me = g && E.P(g, g.humanId);
      if (!me) return;
      if (!me.noteMarks) me.noteMarks = {};
      const pid = +ns.dataset.pid;
      if (ns.value) me.noteMarks[pid] = ns.value; else delete me.noteMarks[pid];
      render(global.Game.g);
    });
    window.addEventListener('error', e => showFatal('脚本错误：' + (e.message || '未知')));
    syncSideToggle();   // 〔批次 41〕进入对局前先按当前视口决定是否显示抽屉按钮
    /* 〔42〕ENABLE_DEV 关闭时**移除** DEV 按钮节点（不是 display:none）——正式版 DOM 里
       不该留一个点不动的调试入口。若为 hidden 则既留了残骸，也让门禁断言难以判定「已移除」。 */
    if (!devEnabled()) {
      const bd = el('btn-dev');
      if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
      const chip = el('dev-chip');
      if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
    }
  }

  function closeDevView() {
    /* 仅收起总览浮层：上帝模式（名单揭示+威胁度）不回退；角标出现，点击可重新展开 */
    devOvOpen = false;
    const ov = el('dev-overlay');
    if (ov) ov.classList.add('hidden');
    if (global.Game.g) render(global.Game.g);
  }

  /* ---------- 侧栏抽屉（〔批次 41〕移动端横屏适配） ----------
     手机横屏下公告/私人/阵营 侧栏改为右侧抽屉（CSS 在 style.css 的 v35 段）：
     桌面三栏布局原样保留，抽屉按钮只在横屏矮屏时显示（init 里按视口切换）。 */
  const sideDrawerQuery = global.matchMedia ? global.matchMedia('(orientation:landscape) and (max-height:560px)') : null;
  function syncSideToggle() {
    const btn = el('btn-side-toggle');
    if (btn) btn.style.display = (sideDrawerQuery && sideDrawerQuery.matches) ? 'inline-flex' : 'none';
  }
  function toggleSideDrawer(force) {
    const side = document.querySelector('#screen-game .seg-side');
    if (!side) return;
    const want = force === undefined ? !side.classList.contains('open') : !!force;
    side.classList.toggle('open', want);
  }
  if (sideDrawerQuery) {
    /* 视口切换（转屏 / 折叠展开）时同步按钮可见性；竖屏返回时强制收回抽屉 */
    const onChange = () => { syncSideToggle(); toggleSideDrawer(false); };
    if (sideDrawerQuery.addEventListener) sideDrawerQuery.addEventListener('change', onChange);
    else if (sideDrawerQuery.addListener) sideDrawerQuery.addListener(onChange);   //旧版 WebView
  }

  /* 〔42〕扫码下载浮层已退役（游戏内不做分发下载）：原 openApkQr/closeApkQr 与其
     DOM 节点、assets/qr/space-kill-apk.png 一并移除。APK 对外分发改由 GitHub Releases
     承担（见 README），站内不再有下载入口，故也不需要任何打开/关闭逻辑。 */

  /* ---------- 规则速览（全屏覆盖页，v32：开始页顶部按钮打开） ----------
     〔批 SHIP-2 · 2026-10-27〕★ 渲染必须在这里，不能只靠调用方记得调。
     -------------------------------------------------------------
     旧写法只有 `classList.remove('hidden')`。能渲染的那条路是 arena.js 里
     `#btn-rules-home` 的 onclick（它自带 renderRules()），而**首局自动弹出**
     走的是 `render()` 里这一条 —— 于是浮层打开了、正文永远是 index.html 的占位句
     「正在载入规则数据…」。实测：首次进对局后 3 页签 / 0 张卡。
     现在打开 = 渲染，唯一入口；arena 那条 onclick 直接调本函数。 */
  function openRules() {
    const ov = el('rules-overlay');
    if (!ov) return;
    /* 渲染器住在 arena.js（SKUI 只做覆盖层开关）。没加载时不能静默留占位句：
       那正是本批要修的缺陷形态 —— 让它在屏幕上说出来，而不是"看起来在载入"。 */
    if (global.SKArena && global.SKArena.renderRules) {
      try { global.SKArena.renderRules(); } catch (e) {
        const body = el('rg-body');
        if (body) body.innerHTML = '<div class="hint">规则速览渲染失败：' + String(e && e.message ? e.message : e) + '</div>';
      }
    } else {
      const body = el('rg-body');
      if (body) body.innerHTML = '<div class="hint">规则速览渲染器未加载（js/arena.js）</div>';
    }
    ov.classList.remove('hidden');
    ov.scrollTop = 0;
  }
  function closeRules() {
    const ov = el('rules-overlay');
    if (ov) ov.classList.add('hidden');
  }

  /* ---------- 我的账本（v32 机制对等）：玩家席位自己的推理资产 ----------
     与 AI 完全同一份机制产生的数据：tEvents 证据台账 / suspDist 三阵营怀疑度 /
     dangerOf 危险度 / known 硬源 / 角色私有资产（查验池·二查·标记记忆·濒死名单·子弹流水）。
     v32（用户拍板）：账本并入 DEV 面板（不再单独暴露按钮/覆盖页）——ledgerHtml(g) 返回
     HTML 片段，由 devPanel 追加渲染。 */
  function ledgerHtml(g) {
    const me = E.P(g, g.humanId);
    if (!me) return '<div class="empty">无席位</div>';
    const AI = global.AI;
    const fac = { human: '人类', alien: '异形', xeno: '外星人' }[me.faction] || me.faction;
    let html = `<p class="hint" style="margin:0 0 10px">身份：<b>${esc(me.roleName)}</b>（${fac}）· ${me.out ? '已出局' : '存活中'}。
      这里的每一条都与 AI 的账本<b>同一机制</b>生成——AI 靠它投票/出刀，你靠它盘人。</p>`;
    /* ① 硬源（knownLockOf 判读）：官方揭示 / 公告 / 查验锁定 / 私聊弱记录 */
    const hard = [];
    const weak = [];
    (me.known || new Map()).forEach((k, id) => {
      const lock = AI && AI.knownFaction ? null : null;
      const viaPriv = k && k.viaPrivate;
      let txt = `${id} 号：`;
      if (k.role) txt += `${global.NLP && global.NLP.ROLE_NAME ? (global.NLP.ROLE_NAME[k.role] || k.role) : k.role}`;
      if (k.faction) txt += `（${({ human: '人类', alien: '异形', xeno: '外星人' })[k.faction] || k.faction}）`;
      if (k.excludes && k.excludes.length) txt += `已排除 ${k.excludes.map(r => (global.NLP && global.NLP.ROLE_NAME ? (global.NLP.ROLE_NAME[r] || r) : r)).join('、')}`;
      (viaPriv ? weak : hard).push(txt + (viaPriv ? '（私聊弱记录）' : ''));
    });
    html += `<div class="sec">硬源（官方确证，不衰减）</div>` +
      (hard.length ? hard.map(t => `<div class="evt good">${esc(t)}</div>`).join('') : '<div class="empty">暂无</div>') +
      (weak.length ? weak.map(t => `<div class="prv">${esc(t)}</div>`).join('') : '');
    /* ② 对每位存活者的怀疑度分布 / 危险度（与 AI 决策同源） */
    if (AI && AI.suspDist) {
      const rows = E.alive(g).filter(x => x.id !== me.id).map(x => {
        let d, dg;
        try { d = AI.suspDist(g, me, x.id); dg = AI.dangerOf ? AI.dangerOf(g, me, x.id) : null; }
        catch (err) { d = null; dg = null; }
        if (!d) return '';
        const pct = v => Math.round(v * 100);
        /* D2：分布按阵营声明序渲染（原为写死的 异/外/人 三元组与三个条形类名）。
           展示序 = FACTION[x].order 升序 → 异形(1) 外星人(2) 人类(3)，与原输出逐字一致。 */
        const ord = (AI.FACTION_KEYS || []).slice()
          .sort((a, b) => (D.FACTION[a].order || 0) - (D.FACTION[b].order || 0));
        const bar = '<span class="lg-bar">' + ord.map(k =>
          `<i style="width:${pct(AI.distGet(d, k))}%" class="${D.FACTION[k].barCls}"></i>`).join('') + '</span>';
        return `<div class="lg-row"><b>${x.id} 号 ${esc(x.name)}</b>${bar}` +
          `<span class="lg-num">` + ord.map(k =>
            `${D.FACTION[k].short} ${pct(AI.distGet(d, k))}%`).join(' · ') +
          (dg != null ? ` · 危险 ${Math.round(dg)}` : '') + `</span></div>`;
      }).join('');
      html += `<div class="sec">我的怀疑度分布（三阵营 · 与 AI 投影同源）</div>` +
        (rows || '<div class="empty">暂无</div>');
    }
    /* ③ 证据流水（tEvents，按夜倒序最近 30 条） */
    const flows = [];
    (me.tEvents || new Map()).forEach((evs, tid) => {
      (evs || []).forEach(e => flows.push({ tid, ...e }));
    });
    flows.sort((a, b) => (b.night - a.night) || (b.delta - a.delta));
    html += `<div class="sec">证据台账（最近 30 条 / 共 ${flows.length} 条）</div>` +
      (flows.length ? flows.slice(0, 30).map(e =>
        `<div class="lg-ev"><span class="who">第 ${e.night} 夜 · ${e.tid} 号</span>` +
        `<span class="lg-src">${esc(e.src || '(无源)')}</span>` +
        `<span class="lg-tier">${esc(e.tier || '')}</span>` +
        `<span class="lg-d ${e.delta < 0 ? 'neg' : 'pos'}">${e.delta > 0 ? '+' : ''}${e.delta}</span></div>`).join('')
        : '<div class="empty">暂无证据（随着对局推进，指控/公告/查验/通道证据都会入账）</div>');
    /* ④ 角色私有资产 */
    const assets = [];
    if (me.checkPool && me.checkPool.size) {
      /* B5（4.7.3，待拍板 I9）：池内不标注阵营 */
      assets.push('<div class="sec">神探·已查验池</div>' + [...me.checkPool.values()].map(v =>
        `<div class="evt info">${v.id} 号（第 ${v.night} 夜查验）：${v.roleName || (v.role ? roleNameOf(v.role) : '—')}${v.published ? ' · 已公告' : ''}</div>`).join(''));
    }
    if (me.crewChecks && me.crewChecks.size) {
      /* A13（4.1.1 验证式）：查验记录 = 提交身份与是/否答案（「否」统一口径） */
      assets.push('<div class="sec">船员·查验记录</div>' + [...me.crewChecks.entries()].map(([id, v]) =>
        `<div class="evt info">${+id} 号（查了 ${v.n} 次）：${(v.results || []).map(r =>
          `${roleNameOf(r.id)}→${r.ans ? '是' : '否'}`).join('；') || '（无有效作答）'}</div>`).join(''));
    }
    if ((me.markSeen && me.markSeen.size) || me.markEverSeen && me.markEverSeen.size) {
      assets.push('<div class="sec">医生·标记记忆</div>' + [...(me.markEverSeen || new Map()).entries()].map(([id, v]) =>
        `<div class="evt info">${+id} 号：第 ${v.night} 夜首见标记${v.goneNight != null ? `，第 ${v.goneNight} 夜消失${v.noCure ? '（当夜无人治疗——隐形清除！）' : ''}` : '，仍在'}</div>`).join(''));
    }
    if (me.dyingSeen && me.dyingSeen.ids) {
      assets.push(`<div class="sec">救援·最近濒死名单</div><div class="evt info">第 ${me.dyingSeen.night} 夜濒死：${me.dyingSeen.ids.join('、') || '（无）'} 号</div>`);
    }
    if (me.bulletLog && me.bulletLog.length) {
      assets.push('<div class="sec">警长/武装·子弹流水</div>' + me.bulletLog.map(b =>
        `<div class="evt info">第 ${b.night} 夜 ${b.delta > 0 ? '+' : ''}${b.delta}（${esc(b.src)}）· 现余 ${me.bullets} 发</div>`).join(''));
    }
    html += assets.join('');
    return html;
  }

  /* 〔S3a〕场景席位点击的入口：与名单卡片点击同行为（再点同一席位 = 收起弹窗）。
     独立成函数是因为 #roster 在场景化后按视口可能 display:none——场景需要一条
     不依赖 roster 可见性的等价路径（弹窗内的自动讯问按钮仍走 [data-probe] 委托）。 */
  function openPlayerPop(pid) {
    popPid = popPid === pid ? null : pid;
    render(global.Game.g);
  }

  global.UI = { render, init, updateTimer, renderRoom, renderReplayBody, stageLayout, applyStageLayout,
    mountRolePicker, preferredRole, rpPick, renderRoleGrid, openPlayerPop, mountRosterBoard,
    openLedger, closeLedger, ledgerLines, openDockPanel, toggleSettings,
    /* 〔批 SHIP-2〕规则速览的唯一入口（打开即渲染）。arena.js 的铭牌 onclick 复用它，
       避免"两份打开逻辑、一份忘了渲染"再次发生。 */
    openRules, closeRules };
})(typeof window !== 'undefined' ? window : globalThis);

