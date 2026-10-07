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
    if (live) live.textContent = `⏱ ${s}s${waitTxt}`;
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

  /* ---------- 玩家名单：全员常驻（出局者带 💀 标记），点击任意玩家框查看详情 ---------- */
  let popPid = null;   // 当前详情弹窗的玩家 id

  function renderRoster(g, V) {
    const me = E.P(g, g.humanId);
    /* v34 C3：决策态卡片状态数据——
       发言中 = 当天最新一条公开发言的编号；已投票 = 票源仅对验票官/异形/DEV 可见（规则内合法）；
       被提名 = 验票官指控目标；自己角标与出局纹理为纯样式叠加 */
    /* 〔42〕票源可见性改由 View 裁决（V.votes 已在 sanitize 内按 inspector/alien/dev 门控），
       UI 不再自行判定 —— 避免「UI 一份判断、视图一份判断」两处口径漂移。 */
    const votes = (V && V.votes) || null;
    const logArr = g.chatLog || [];
    const lastChat = logArr.length ? logArr[logArr.length - 1] : null;
    const talkingId = lastChat && lastChat.night === g.night ? lastChat.id : null;
    /* 存活在前、出局在后（各自按编号排序）；出局者不再移出名单 */
    const rows = othersOf(g, V).slice().sort((a, b) =>
      (a.out ? 1 : 0) - (b.out ? 1 : 0) || a.id - b.id);
    el('roster').innerHTML = rows.map(p => {
      const tags = [];
      if (p.out) {
        tags.push(`<span class="tag hot">💀 ${p.outType === 'vote' ? '驱逐' : (D.CAUSE_NAME[p.cause] || '死亡')}</span>`);
      } else {
        /* 〔42〕濒死 / 感染标记（含真伪）/ 蛰伏沉默 三类标签此前直读 g.players，对全场可见。
           现在 p 来自 View.sanitize：这三个字段只有「本人 / 医生系 / 救援族 / 异形队友」才被下发，
           故「看不见」自动表现为标签不出现 —— 无需在此再写一遍权限判断（避免两处口径漂移）。
           医生看到的感染只有 {exists:true}（真伪不可辨，4.5），异形队友可见真伪（3.3④）。 */
        if (p.dying) tags.push('<span class="tag hot">濒死</span>');
        if (p.infection) tags.push(p.infection.real === false ? '<span class="tag ok">假标记</span>' : '<span class="tag warn">带标记</span>');
        if (p.repairExposed) tags.push('<span class="tag ok">维修暴露</span>');
        if (p.destroyedExposed) tags.push('<span class="tag hot">破坏暴露</span>');
        if (p.silenceNight === g.night) tags.push('<span class="tag warn">沉默</span>');
        /* v34：验票官指控改由「◎ 被提名」标签 + 橙色描边承担（见下方 nom 分支），此处不再重复 */
      }
      const heat = (g.threat && g.threat[p.id]) || 0;
      /* v31 批 0（文案口径修正）：g.threat 是【怀疑度共识】快照（先验 28.6 + 各 AI 私有增量均值）。
         v32（用户拍板「不开 DEV 不得显示怀疑度」）：怀疑度共识只在开发者视角显示——
         玩家默认 UI 一律不出现任何怀疑度/威胁度数值（它是 DEV 快照口径，AI 决策也禁读）。 */
      if (g.dev && !p.out && heat > 0) tags.push(`<span class="tag ${heat >= 60 ? 'hot' : 'warn'}">怀疑 ${heat}</span>`);
      const k = knownLabel(g, me, p);
      /* v32（用户拍板「去网上找素材」）：身份标识改用 emoji 图标，直接跟在名字后——
         异形 👾 · 外星人 👽 · 人类 🧑‍🚀（宇航员）。来源仍只限观察者自己的合法已知（knownLabel）。 */
      /* v34 H2/H4/H6：emoji 移出文本流（绝对定位右上角），仅留缩略文本用于 title 兜底 */
      const symText = k ? (k.indexOf('异形') >= 0 ? '异形'
        : k.indexOf('外星人') >= 0 ? '外星人'
          : k.indexOf('人类') >= 0 ? '人类' : '') : '';
      const sym = symText ? `<span class="fs" title="${symText}">${symText === '异形' ? '👾' : symText === '外星人' ? '👽' : '🧑‍🚀'}</span>` : '';
      /* 非阵营类的已知文本（排除信息「非XX」等）以小标签进 tags 行，不占独立行 */
      if (k && !sym) tags.push(`<span class="tag">${esc(k)}</span>`);
      /* v32（用户拍板）：玩家自己的职业备注（在玩家卡片内标注，纯个人笔记，AI 不读） */
      const note = me && me.noteMarks ? me.noteMarks[p.id] : null;
      if (note) tags.push(`<span class="tag">📌 ${esc(roleNameOf(note))}</span>`);
      /* v32（用户拍板）：卡片身份行（.did，高度恒定 12px 不膨胀），三分支——
         ① 自己：阵营 emoji + 阵营 · 职业（只有我能看到自己的卡上有，规则内合法）；
         ② 异形队友：阵营互认（state.js 创建时双向写入 known，规则 3.3④ 合法获知）——
            UI 按观察者阵营显式渲染（读真实 faction 仅限 me.faction==='alien' 时，
            信息上与 known 互认等价；人类/外星人观察者无此分支，无任何额外透视）；
         ③ DEV：上帝视角全员透视。 */
      const FEMOJI = { alien: '👾', xeno: '👽', human: '🧑‍🚀' };
      /* 身份行纯文字且名词只出现一次：阵营 == 职业名时只显示一个（如异形只写「异形」，不写「队友」） */
      const idLabel = p => {
        const f = facName(p.faction), r = p.roleName || roleNameOf(p.role);
        return f === r ? f : `${f}·${r}`;
      };
      let did = '';
      if (g.dev) did = esc(idLabel(p));
      else if (me && p.id === me.id) did = esc(idLabel(p));
      else if (me && me.faction === 'alien' && p.faction === 'alien') did = esc(facName(p.faction));
      /* v34 C3/C4：已投票（灰勾）/ 被提名（橙框+◎）/ 发言中（呼吸）/ 聊天联动高亮 */
      const voted = !p.out && votes && votes[p.id] != null;
      const nom = !p.out && g.accuseMark && g.accuseMark.target === p.id;
      if (voted) tags.push('<span class="tag voted">✓ 已投</span>');
      if (nom) tags.push('<span class="tag nom-t">◎ 被提名</span>');
      /* v34 H1/H2/H3/H6：两行结构——
         行①：28×28 编号徽章（定宽） + 昵称容器（弹性收缩、13px/500、省略号、title 兜底）
         行②：职业小字（.did，可截断） + 状态徽章（.tags，定宽不压缩文字）
         emoji 不再进昵称行，改由 CSS 绝对定位到卡片右上角 */
      return `<div class="pl ${me && p.id === me.id ? 'me' : ''} ${p.out ? 'out' : ''} ${popPid === p.id ? 'sel' : ''} ${nom ? 'nom' : ''} ${!p.out && p.id === talkingId ? 'talking' : ''} ${chatFilterPid === p.id ? 'hl' : ''} ${sym ? 'has-emo' : ''}" data-pid="${p.id}">
        <div class="top"><span class="no">${p.out ? '💀' : p.id}</span><span class="nm" title="${esc(p.name)}${symText ? ' ' + symText : ''}">${esc(p.name)}</span></div>
        <div class="idrow">${did ? `<span class="did">${did}</span>` : ''}<span class="tags">${tags.join('')}</span></div>
        ${sym}
      </div>`;
    }).join('');

    /* v32：出局记录容器已从名单列移除（出局信息在名单卡 💀 标签 + 右侧记录），容器缺省时跳过 */
    const deadBox = el('dead');
    if (deadBox) deadBox.innerHTML = g.players.filter(p => p.out).map(p =>
      `<div>${p.id} 号 ${esc(p.name)} · <b class="${facCls(p.faction)}">${facName(p.faction)}</b>（${esc(p.roleName)}）· ` +
      `${p.outType === 'vote' ? '被驱逐' : '死于' + (D.CAUSE_NAME[p.cause] || '—')} · 第 ${p.outNight} 夜</div>`
    ).join('') || '<div class="empty">暂无</div>';
  }

  /* 玩家详情弹窗：开发者模式下展示完整信息（身份/技能/各 AI 视角威胁度/指控记录） */
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
        ? (p.outType === 'vote' ? '💀 第' + p.outNight + ' 夜被驱逐' : '💀 第' + p.outNight + ' 夜死于' + (D.CAUSE_NAME[p.cause] || '—'))
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
      if (pv.out) html += `<div class="kv"><span>出局</span><span>${pv.outType === 'vote' ? '💀 第' + pv.outNight + ' 夜被驱逐' : '💀 第' + pv.outNight + ' 夜死于' + (D.CAUSE_NAME[pv.cause] || '—')}</span></div>`;
      if (pv.accusers && pv.accusers.length) html += `<div class="kv"><span>曾被指控</span><span>${pv.accusers.join('、')} 号</span></div>`;
      if (!g.dev) html += `<div class="empty">开启 DEV 后可查看完整私有信息（技能 / 各 AI 视角威胁度 / 记事本）。</div>`;
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
     改造前：#chatlog 与 #stage-body 是两个**常驻** DOM，各占一半高度，与当前阶段无关。
       夜里没有公开发言，发言区照样占着半屏（显示「暂无公开发言」），真正要看的
       私聊 / 决策 / 公告报告被挤在半屏里 —— 这是「主区留空」的根因。

     四个布局键（写入 #seg-stage[data-layout]，由 CSS v43 段消费）：
       talk     实时讨论窗口（D-open / D-talk / M-talk / M-speech）——公开发言即主流程，
                决策区压到副位。**不看 phase**：步骤 10 紧急会议虽在夜间相内，
                但它本质是讨论窗口，收起发言区等于让玩家看不见自己在讨论什么。
       day-form 白天待决策表单（D-vote 投票 / D-will 留言 / D-report 窃听报告）——
                发言区压到副位但**不隐藏**：投票时要对照刚才的发言。
       day      白天自动步骤 —— 发言区为主。
       night    夜间（不论是否有表单）—— **发言区整体收起**，主区只剩
                私聊 / 决策 / 公告报告。

     为什么夜间连表单也不留发言区：夜间没有任何公开发言（发言流水按 `t.night === g.night`
     过滤，夜里本就是空的），留着它等于一块永远写着「暂无公开发言」的死区。
     白天的发言全文改由右栏「发言」页签随时回看。 */
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

  /* 把布局写进 DOM：区域显隐 + 标题 + 供 CSS 消费的 data-layout。
     区域用 display:none 整体收起（不是 height:0）——空盒子仍然吃边距，且
     移动端手势/焦点可能落进不可见区域。 */
  function applyStageLayout(g) {
    const L = stageLayout(g);
    const seg = el('seg-stage');
    if (seg) seg.dataset.layout = L.key;
    const rc = el('region-chat'), rd = el('region-dec');
    if (rc) rc.classList.toggle('hidden', !L.chat);
    if (rd) rd.classList.toggle('hidden', !L.dec);
    const tc = el('t-chat'), td = el('t-dec');
    if (tc) tc.textContent = L.tChat;
    if (td) td.textContent = L.tDec;
    return L;
  }

  function renderStage(g) {
    const head = el('stage-head'), body = el('stage-body'), acts = el('stage-actions');
    const L = stageLayout(g);
    /* 〔43〕夜间把「今夜私聊」插在决策区最上方：夜间主区只有这一块，
       私聊小结是玩家此刻最可能想回看的东西，必须在第一步（而不是藏在右栏页签里）。 */
    const nightChat = L.key === 'night' ? nightChatHtml(g) : '';
    if (g.pending && g.pending.stream) {
      renderTalkForm(g, head, body, acts, nightChat);
      renderChat(g);
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
        <button class="act" id="btn-next">继续 ▶</button>`;
      const bn = el('btn-next');
      if (bn) bn.onclick = () => global.Game.next();
      const cf = el('chk-fast');
      if (cf) cf.onchange = e => { global.Game.fast = e.target.checked; };
    }
    renderChat(g);
  }

  /* v34 C4：发言流过滤态——点击发言中的编号 = 只看该玩家；点角标清除 */
  let chatFilterPid = null;

  function renderChat(g) {
    const box = el('chatlog');
    const total = (g.chatLog || []).length;
    /* 〔43〕区域被收起时不碰 DOM，但仍推进 _total —— 否则回到白天时会把
       「整夜累积的新发言」误判成一条新增，淡入动画与滚动定位都会跑偏。 */
    const rc = el('region-chat');
    if (rc && rc.classList.contains('hidden')) { renderChat._total = total; return; }
    const streaming = !!(g.pending && g.pending.stream);
    box.classList.toggle('streaming', streaming);
    /* v33：新消息进入时只给最后一条加 200ms 淡入上移动画（整列表重渲染不闪烁） */
    const grew = total > (renderChat._total || 0);
    renderChat._total = total;
    /* v32（用户拍板）：公开发言记录只显示【当天】——非当前昼夜循环的历史发言不进列表 */
    const today = (g.chatLog || []).filter(t => t.night === g.night);
    let rows = today.slice(streaming ? -40 : -14);
    let filtered = false;
    if (chatFilterPid != null) {
      const ever = today.some(t => t.id === chatFilterPid) || (g.chatLog || []).some(t => t.id === chatFilterPid);
      if (ever) { rows = today.filter(t => t.id === chatFilterPid); filtered = true; }
      else chatFilterPid = null;   // 该编号今天不存在（换夜/非法）→ 自动清除过滤
    }
    const me = E.P(g, g.humanId);
    box.innerHTML = (filtered ? `<button class="chat-filter-chip" data-cf="1">只看 ${chatFilterPid} 号 ✕</button>` : '') +
      (rows.length ? rows.map((t, i) => {
      /* 「原意」小字：NLP 对这句话的结构化理解（指控/声称/质询/汇报/意向），玩家可随时核对 */
      const note = t.sig ? (global.NLP ? global.NLP.summarize(t.sig) : '') : '';
      const mine = me && t.id === me.id;   // 己方消息右对齐 + 独立气泡色
      return `<div class="say${mine ? ' mine' : ''}${grew && !filtered && i === rows.length - 1 ? ' msg-in' : ''}" data-pid="${t.id}" title="点击只看该编号的发言">` +
        `<span class="ava">${t.id}</span>` +
        `<div class="say-main"><span class="who">${t.id} 号</span>${t.kind && t.kind !== '讨论' ? `<i class="kind">${esc(t.kind)}</i>` : ''}：${esc(t.text)}${note ? `<div class="sig-note">原意：${esc(note)}</div>` : ''}</div>` +
      `</div>`;
    }).join('') : `<div class="empty">${filtered ? '该编号今天暂无公开发言' : '暂无公开发言'}</div>`);
    box.scrollTop = box.scrollHeight;
  }

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
      <button class="act ghost" id="btn-submit">结束讨论 ▶</button>`;
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
      const mk = (list, name, id) => `<div class="opts grid3" id="${id}" style="${name === 'ftgtPool' ? 'display:none' : ''}">` +
        list.map(p => {
          const k = knownLabel(g, me, p);
          const dy = isAtk && p.dying ? `<br/><span class="d">已濒死，攻击将无效（伤害判 0、额度照扣）</span>` : '';
          return `<label class="opt" data-v="${p.id}">
            <input type="${max > 1 ? 'checkbox' : 'radio'}" name="${name}" value="${p.id}"/>
            <span><span class="t">${p.id} 号 ${esc(p.name)}</span>${k ? `<br/><span class="d">${esc(k)}</span>` : ''}${dy}</span>
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

    if (f.num) {
      html += `<div class="sec">${esc(f.num.label)}</div>
        <select id="f-num">${f.num.options.map(o => `<option value="${o.v}">${esc(o.label)}</option>`).join('')}</select>`;
      formState.num = f.num.options[0].v;
    }
    if (f.num2) {
      html += `<div class="sec">${esc(f.num2.label)}</div>
        <select id="f-num2">${f.num2.options.map(o => `<option value="${o.v}">${esc(o.label)}</option>`).join('')}</select>`;
      formState.num2 = f.num2.options[0].v;
    }
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
      el('btn-submit').textContent = '确认发动 ▶';
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
    rows.push(kv('感染抑制', `${p.suppressLeft} / 3`));
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
    html += `<div class="sec">我的账本（席位证据资产 · 与 AI 同一份机制）</div>` + ledgerHtml(g);
    return html;
  }

  function renderSide(g, V) {
    const me = E.P(g, g.humanId);
    const box = el('side-body');
    document.querySelectorAll('#nb-tabs .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (!me) { box.innerHTML = '<div class="empty">—</div>'; return; }

    if (tab === 'pub') {
      /* v32（用户拍板）：公告按夜数分组记录——同一夜的公告聚合显示，最新夜在最上 */
      const rows = g.log.filter(e => e.batch && visible(g, e));
      const byNight = new Map();
      for (const e of rows) {
        if (!byNight.has(e.night)) byNight.set(e.night, []);
        byNight.get(e.night).push(e);
      }
      /* v34 C5：夜晚事件按昼夜折叠收起（最新夜默认展开），右侧滚动区吸收增减 */
      box.innerHTML = byNight.size
        ? [...byNight.entries()].sort((a, b) => b[0] - a[0]).map(([night, items], idx) =>
          `<details class="night-fold"${idx === 0 ? ' open' : ''}><summary>第 ${night} 夜 · ${items.length} 条公告</summary>` +
          items.map(e => `<div class="logline"><span class="b">${e.batch}</span> ${esc(e.text)}</div>`).join('') +
          `</details>`).join('')
        : '<div class="empty">暂无公告</div>';
    } else if (tab === 'speak') {
      const rows = (g.chatLog || []).slice().reverse();
      box.innerHTML = rows.length ? rows.map(t =>
        `<div class="logline"><span class="n">第${t.night}夜·${esc(t.kind)}</span> <span class="b">${t.id} 号</span> ${esc(t.text)}</div>`
      ).join('') : '<div class="empty">暂无</div>';
    } else if (tab === 'priv') {
      box.innerHTML = me.inbox && me.inbox.length ? me.inbox.slice().reverse().map(e =>
        `<div class="logline"><span class="n">第${e.night}夜</span> ${esc(e.text)}</div>`
      ).join('') : '<div class="empty">暂无私人反馈</div>';
    } else if (tab === 'camp') {
      box.innerHTML = selfPanel(g, me) + campPanel(g, me);
    /* 出局记录：〔42〕改读 View.sanitize 后的 pv —— 出局者的身份本就经 ⑥死亡 / ⑩驱逐 公告公开
       （2.3.4 / 4.10.6，含真实阵营与呈现职业），故取 p.revealed 即是合法口径；
       原先直读 g.players 的 roleName/faction/transferred 里，transferred（转职史）
       与 originRole（原职业底册）依 2.8.7 / 2.8.12④ 一律不公开，已一并去掉。 */
    } else if (tab === 'out') {
      const src = othersOf(g, V);
      const rows = src.filter(p => p.out);
      /* 职业余额表（显示方案 1.3）：总数由声明层派生（人类席位来自 2.8.14 组位表，
         非人类名额来自各阵营角色的 seats）——取代此前写死的 totals 与角色键清单。
         D6/D8：加角色/改席位只改声明，本表自动跟上。 */
      const totals = RD.roleTotals();
      /* 〔42〕已揭示职业一律取 p.revealed.role（公告授权的那一份），不再用
         originRole||role —— 后者会把「转职前的底册」与「真身」一并带出来。 */
      const revealedRole = p => (p.revealed && p.revealed.role) || null;
      let balance = '<div class="sec">职业余额表（已揭示出局 / 总数）</div>';
      for (const r of RD.keys().filter(k => totals[k] > 0)) {
        const outN = src.filter(p => p.out && revealedRole(p) === r).length;
        const left = totals[r] - outN;
        const facTag = D.ROLES[r].faction !== 'human' ? `（${D.FACTION[D.ROLES[r].faction].name}）` : '';
        balance += `<div class="kv"><span>${esc(D.ROLES[r].name)}${facTag}</span>` +
                   `<span>已揭示出局 ${outN} / ${totals[r]} · 剩余身份 ${left >= 0 ? left : 0} 人（含未揭示）</span></div>`;
      }
      /* 死因统计（显示方案 1.3）：仅逐夜累计呈现，不给出任何推断结论 */
      const causes = ['gun', 'alien', 'xeno', 'infect'];
      let stat = '<div class="sec">死因统计（逐夜累计，仅供自行比对）</div>';
      for (const c of causes) {
        const list = src.filter(p => p.out && p.outType !== 'vote' && p.cause === c);
        stat += `<div class="kv"><span>${esc(D.CAUSE_NAME[c] || c)}</span><span>累计 ${list.length} 人${list.length ? '（' + list.map(p => p.id + ' 号·第' + p.outNight + '夜').join('、') + '）' : ''}</span></div>`;
      }
      box.innerHTML = (rows.length ? rows.map(p =>
        `<div class="kv"><span>${p.id} 号 ${esc(p.name)}</span>
         <span>${facName(p.faction)} · ${esc(p.roleName)} · ${p.outType === 'vote' ? '驱逐' : D.CAUSE_NAME[p.cause]} · 第${p.outNight}夜</span></div>`).join('')
        : '<div class="empty">暂无出局者</div>') + balance + stat;
    } else {
      const known = g.players.filter(p => p.id !== me.id && ((me.known && me.known.has(p.id)) || p.revealed))
        .map(p => {
          const k = (me.known && me.known.get(p.id)) || p.revealed;
          /* B5：known/揭示条目可能不含阵营字段（2.8.12④），缺阵营时只显示职业 */
          const parts = [facName(k.faction), k.role ? roleNameOf(k.role) : ''].filter(Boolean);
          return `<div class="kv"><span>${p.id} 号 ${esc(p.name)}</span><span>${esc(parts.join(' · '))}</span></div>`;
        }).join('');
      /* §2.5 记一笔（医师手动誊抄）＋ §2.1 对账便签：均由玩家手动写入备注，UI 不代记 */
      const isDoc = RD.hasGrant(me.role, 'treat');      // D6：能力标签取代手写角色清单
      const isCrew = me.role === 'crew' || me.transferred;
      const quick = isDoc || isCrew ? `<div class="row" style="margin:4px 0">
        ${isDoc ? '<button class="act" id="btn-jibi">记一笔（标记清单→备注）</button>' : ''}
        ${isCrew ? '<button class="act" id="btn-duizhang">＋对账便签</button>' : ''}</div>` : '';
      box.innerHTML = `<div class="sec">已确认身份</div>${known || '<div class="empty">暂无</div>'}
        ${quick}
        <div class="sec">自由备注（仅本人可见，出局后不保留）</div>
        <textarea id="notes" placeholder="你的推理笔记……">${esc(me.notes || '')}</textarea>`;
      const n = el('notes');
      if (n) n.onchange = e => { me.notes = e.target.value; };
      const jb = el('btn-jibi');
      if (jb) jb.onclick = () => {
        const marks = g.players.filter(x => !x.out && x.infection).map(x => x.id + ' 号');
        const snapshot = `\n[记一笔] 第 ${g.night} 夜标记清单：${marks.length ? marks.join('、') : '（无）'}`;
        me.notes = (me.notes || '') + snapshot;
        if (n) n.value = me.notes;
      };
      const dz = el('btn-duizhang');
      if (dz) dz.onclick = () => {
        me.notes = (me.notes || '') + `\n[对账] 第 ${g.night} 夜协助维修，N＝`;
        if (n) n.value = me.notes;
      };
    }
  }

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
      `<p class="hint">共 ${g.night} 夜，倒计时剩余 ${(g.countdown || 0).toFixed(1)}，净破坏量 ${((g.net10 || 0) / 10).toFixed(1)}。</p>` +
      `<div class="sec">全部身份（上帝视角已解锁）</div>` +
      roster.map(p => `<div class="kv"><span>${p.id} 号 ${esc(p.name)}</span>
        <span class="${facCls(p.faction)}">${facName(p.faction)} · ${esc(p.roleName)}${p.out ? '（第' + p.outNight + '夜' + (p.outType === 'vote' ? '被驱逐' : '死于' + (D.CAUSE_NAME[p.cause] || '—')) + '）' : ''}</span></div>`).join('');

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
    renderHud(g); renderRoster(g, V); renderPlayerPop(g, V);
    applyStageLayout(g);            /* 〔43〕主区布局：必须在 renderStage 之前 —— 它决定哪块区域存在 */
    renderStage(g, V); renderSide(g, V);
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
    chip.textContent = k ? `${roleNameOf(k)} · ${facName(RD.ROLE_DECL[k].faction)}` : '未选择 🎲';
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
    document.querySelectorAll('#nb-tabs .tab').forEach(t => t.onclick = () => { tab = t.dataset.tab; renderSide(global.Game.g); });
    /* 〔批次 41〕音乐与音效两个独立按钮：此前 orb 栏一个♪ 同时管两者，
       关掉音乐会连带把按键音也关掉。现在 ♫ 只管 BGM、🔔 只管 sfx；
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
    bindStartToggle('btn-sfx-start', '🔔 音效：', () => global.SKAudio.toggleSfx());
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
      if (e.target && e.target.closest && e.target.closest('#btn-rules-side')) { openRules(); return; }   // v33：右栏底部规则入口
      if (e.target && e.target.closest && e.target.closest('#btn-rules-start')) { openRules(); return; }
      if (e.target && e.target.closest && e.target.closest('#btn-side-toggle')) { toggleSideDrawer(); return; }
      if (e.target && e.target.closest && e.target.closest('#btn-rules-close')) { closeRules(); return; }
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
      /* v34 C4：发言流 ↔ 名单联动——点击发言 = 只看该编号（再点取消）；点角标清除 */
      const chip = e.target && e.target.closest ? e.target.closest('#chatlog .chat-filter-chip') : null;
      if (chip) { chatFilterPid = null; render(global.Game.g); return; }
      const sayEl = e.target && e.target.closest ? e.target.closest('#chatlog .say') : null;
      if (sayEl && sayEl.dataset.pid) {
        const pid = +sayEl.dataset.pid;
        chatFilterPid = chatFilterPid === pid ? null : pid;
        render(global.Game.g);
        return;
      }
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
    });
    document.addEventListener('keydown', e => {
      if (e && e.key === 'Escape') { closeRules(); closeDevView(); popPid = null; render(global.Game.g); }
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

  /* ---------- 规则速览（全屏覆盖页，v32：开始页顶部按钮打开） ---------- */
  function openRules() {
    const ov = el('rules-overlay');
    if (ov) { ov.classList.remove('hidden'); ov.scrollTop = 0; }
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

  global.UI = { render, init, updateTimer, renderRoom, renderReplayBody, stageLayout, applyStageLayout,
    mountRolePicker, preferredRole, rpPick, renderRoleGrid };
})(typeof window !== 'undefined' ? window : globalThis);

