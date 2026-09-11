/* 界面渲染：HUD / 计时 / 表单 / 六分区记事本 / 公开发言流 / 复盘 */
(function (global) {
  const D = global.SKData;
  const E = global.Engine;
  const el = id => document.getElementById(id);
  let tab = 'pub';
  let formState = { opt: null, targets: [], num: null, text: '' };
  let rpNight = 0;                     // 复盘：0 = 全部
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
    if (k && k.role) return `${facName(k.faction)}·${roleNameOf(k.role)}`;
    /* 神探：已查验池内目标的身份标注常驻显示（4.7/显示方案 2.7） */
    if (viewer && viewer.checkPool) {
      const rec = Array.isArray(viewer.checkPool)
        ? viewer.checkPool.find(x => x.id === p.id)
        : (viewer.checkPool.get && viewer.checkPool.get(p.id));
      if (rec) return `${facName(rec.faction)}·${roleNameOf(rec.role)}（查）`;
    }
    if (k && k.faction) return facName(k.faction);
    if (p.revealed) return p.revealed.role ? `${facName(p.revealed.faction)}·${roleNameOf(p.revealed.role)}` : facName(p.revealed.faction);
    if (k && k.excludes) return k.excludes.length >= 2
      ? `非${roleNameOf(k.excludes[0])}/${roleNameOf(k.excludes[1])}`
      : `非${roleNameOf(k.excludes[0])}`;
    return '';
  }

  /* ---------- 玩家名单：全员常驻（出局者带 💀 标记），点击任意玩家框查看详情 ---------- */
  let popPid = null;   // 当前详情弹窗的玩家 id

  function renderRoster(g) {
    const me = E.P(g, g.humanId);
    /* v34 C3：决策态卡片状态数据——
       发言中 = 当天最新一条公开发言的编号；已投票 = 票源仅对验票官/异形/DEV 可见（规则内合法）；
       被提名 = 验票官指控目标；自己角标与出局纹理为纯样式叠加 */
    const canSeeVotes = (me && (me.role === 'inspector' || me.faction === 'alien')) || !!g.dev;
    const votes = canSeeVotes ? (g.votes || g.voteSources || {}) : null;
    const logArr = g.chatLog || [];
    const lastChat = logArr.length ? logArr[logArr.length - 1] : null;
    const talkingId = lastChat && lastChat.night === g.night ? lastChat.id : null;
    /* 存活在前、出局在后（各自按编号排序）；出局者不再移出名单 */
    const rows = g.players.slice().sort((a, b) =>
      (a.out ? 1 : 0) - (b.out ? 1 : 0) || a.id - b.id);
    el('roster').innerHTML = rows.map(p => {
      const tags = [];
      if (p.out) {
        tags.push(`<span class="tag hot">💀 ${p.outType === 'vote' ? '驱逐' : (D.CAUSE_NAME[p.cause] || '死亡')}</span>`);
      } else {
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
  function renderPlayerPop(g) {
    const pop = el('p-pop');
    if (!pop) return;
    if (popPid == null) { pop.classList.add('hidden'); return; }
    const me = E.P(g, g.humanId);
    const p = g.players.find(x => x.id === popPid);
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
      /* 非开发者：只展示公开可知信息 */
      const k = knownLabel(g, me, p);
      html += `<div class="kv"><span>身份</span><span>${k ? esc(k) : '未知'}</span></div>`;
      if (p.out) html += `<div class="kv"><span>出局</span><span>${p.outType === 'vote' ? '💀 第' + p.outNight + ' 夜被驱逐' : '💀 第' + p.outNight + ' 夜死于' + (D.CAUSE_NAME[p.cause] || '—')}</span></div>`;
      if (p.accusers && p.accusers.length) html += `<div class="kv"><span>曾被指控</span><span>${p.accusers.join('、')} 号</span></div>`;
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

  function renderStage(g) {
    const head = el('stage-head'), body = el('stage-body'), acts = el('stage-actions');
    if (g.pending && g.pending.stream) {
      renderTalkForm(g, head, body, acts);
      renderChat(g);
      return;
    }
    if (g.pending) { renderForm(g, head, body, acts); }
    else {
      const logs = lastStepLogs(g);
      const stepName = g.stepDone ? (E.STEP_NAME[g.stepDone] || g.stepDone) : '准备';
      head.innerHTML = `<h2>${esc(stepName)}</h2><span class="st">${g.phase === 'open' ? '开局' : `第 ${g.night} 夜`} · ${g.phase === 'night' ? '夜间' : g.phase === 'open' ? '讨论' : '白天'}</span>`;
      const me0 = E.P(g, g.humanId);
      const myPriv = me0 && me0.inbox
        ? me0.inbox.filter(e => e.night === g.night && e.step === g.stepDone) : [];
      body.innerHTML = announceHtml(g) +
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
    const streaming = !!(g.pending && g.pending.stream);
    box.classList.toggle('streaming', streaming);
    /* v33：新消息进入时只给最后一条加 200ms 淡入上移动画（整列表重渲染不闪烁） */
    const total = (g.chatLog || []).length;
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

  function renderTalkForm(g, head, body, acts) {
    const f = g.pending;
    head.innerHTML = `<h2>${esc(f.title)}</h2><span class="st">实时讨论 · 剩余 <b id="form-left">${f.duration || 0}</b>s</span>`;
    body.innerHTML = announceHtml(g) + `<p class="hint" style="margin:0 0 8px">${esc(f.desc || '')}</p>`;
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

  function renderForm(g, head, body, acts) {
    const f = g.pending, me = E.P(g, g.humanId);
    head.innerHTML = `<h2>${esc(f.title)}</h2><span class="st">等待你的决策 · 剩余 <b id="form-left">${f.duration || 0}</b>s</span>`;
    formState = { opt: null, targets: [], num: null, text: '' };

    let html = announceHtml(g) + `<p class="hint" style="margin:0 0 8px">${esc(f.desc || '')}</p>`;

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
    if (f.num) el('f-num').onchange = e => { formState.num = parseFloat(e.target.value); };
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
    if (p.dying) rows.push('<div class="evt bad">你已濒死：步骤 8 的救援是唯一生路，否则步骤 9 死亡结算，不会拖到第二天。</div>');
    if (p.infection) rows.push(kv('感染', p.infection.real == null ? '（带标记，真伪不可辨）' : p.infection.real === false ? '（假标记，仅你可见）' : `第 ${p.infection.deathNight} 夜致死`));
    if (p.antibodyNight != null && p.antibodyNight >= g.night) rows.push(kv('抗体', p.antibodyNight === g.night ? '生效中（仅今夜有效，可挡 1 次感染）' : '已持有，仅下夜有效'));
    if (p.silenceNight === g.night) rows.push(kv('沉默', '今夜主动技能被封锁（投票与私聊不受影响）'));
    if (p.shield) rows.push(kv('结茧护盾', `${p.shield} 层`));
    rows.push(kv('感染抑制', `${p.suppressLeft} / 3`));
    if (p.faction === 'alien') {
      rows.push(kv('刀数', p.alien.dir === 'kill' ? '出刀无冷却' : `${p.alien.kills} / 2`));
      rows.push(kv('进化方向', p.alien.dir ? { destroy: '破坏', infect: '感染', kill: '击杀' }[p.alien.dir] : '未进化'));
      rows.push(kv('累计破坏量', `${(p.alien.destroyTotal || 0).toFixed(1)} / 6.0`));
      rows.push(kv('额外出刀', `${p.alien.extraKill} 次`));
    }
    if (p.faction === 'xeno') {
      rows.push(kv('夜晚免疫', `${p.nightImmune} / 2 次（仅免疫伤害；被感染濒死也会消耗一次）`));
      rows.push(kv('双刀', p.awakened ? '已觉醒（第 6 夜或存活≤6 达成，不可逆）' : '未觉醒（第 6 夜或存活≤6 触发）'));
      rows.push(kv('破坏', `${p.destroyLeft} / 1（+3.0，次夜为停转夜）`));
      rows.push(kv('感染治疗额度', `${p.cureSelf} / 1（仅自用，感染消失即作废）`));
      const silenced = g.players.filter(x => !x.out && x.silenceNight != null && x.silenceNight > g.night);
      if (silenced.length) rows.push(`<div class="sec">已沉默名单</div>` + silenced.map(x =>
        `<div class="kv"><span>${x.id} 号</span><span>覆盖期：第 ${x.silenceNight} 夜（夜间主动技能封锁，投票/私聊不受影响）</span></div>`).join(''));
    }
    if (p.role === 'sheriff' || p.role === 'armed') {
      rows.push(kv('子弹', `${p.bullets} 发（悬赏击杀回复、第 5 夜 +1、存活≤6 +1）`));
      if (p.bulletLog && p.bulletLog.length)
        rows.push(`<div class="sec">子弹流水</div>` + p.bulletLog.map(b =>
          `<div class="kv"><span>第 ${b.night === 0 ? '—' : b.night} 夜</span><span>${b.delta > 0 ? '+' : ''}${b.delta}（${esc(b.src)}）</span></div>`).join(''));
    }
    if (p.role === 'engineer' || p.role === 'assistant') {
      const th = p.role === 'engineer' ? 4 : 3;
      const total = p.repairTotal || 0;
      rows.push(`<div class="sec">维修进度（累计含追加）</div>
        <div class="pbar"><div class="pfill ${p.repairExposed ? 'hot' : ''}" style="width:${clampN(total / th * 100, 0, 100)}%"></div></div>
        <div class="kv"><span>${p.repairExposed ? '已暴露（编号与职业已向全体公开）' : '距暴露还需 ' + Math.max(0, th - total).toFixed(1)}</span>
        <span>${total.toFixed(1)} / ${th.toFixed(1)}</span></div>`);
      if (p.role === 'engineer') rows.push(kv('追加维修', `${p.extraRepair} / 3 次（仅限本人基础维修当夜）`));
      if (g.night === 1) rows.push(kv('第 1 夜全能免疫', '生效中（伤害与感染全额抵挡）'));
    }
    if (p.role === 'bio') { rows.push(kv('治疗额度', `${p.healLeft}`)); rows.push(kv('自救额度', `${p.selfSaveLeft} / 1`)); }
    if (p.role === 'rescue' || p.role === 'tempdoc') { rows.push(kv('救援额度', `${p.rescueLeft}`)); rows.push(kv('治疗额度', `${p.cureLeft}`)); }
    if (p.role === 'inspector') rows.push(kv('紧急会议', `${p.meetingLeft} / 1`));
    /* 神探：已查验池（编号/阵营/职业/查验当夜/存活/已发布，§2.7） */
    if (p.role === 'detective' && p.checkPool) {
      const pool = Array.isArray(p.checkPool) ? p.checkPool
        : [...p.checkPool.values()].map(x => x);
      if (pool.length) {
        rows.push(`<div class="sec">已查验池</div>` + pool.map(rec => {
          const t = g.players.find(x => x.id === rec.id);
          return `<div class="kv"><span>${rec.id} 号</span><span>${esc(facName(rec.faction))} · ${rec.role ? esc(roleNameOf(rec.role)) : '—'} · 第${rec.night}夜查验` +
            ` · ${t && !t.out ? '存活' : '已出局'}${rec.published ? ' · 已发布' : ''}</span></div>`;
        }).join(''));
      }
    }
    /* 普通船员：查验记录（排除信息与锁定结论转职后保留，4.1/4.2） */
    if ((p.role === 'crew' || p.transferred) && p.crewChecks) {
      const entries = Array.isArray(p.crewChecks) ? p.crewChecks.map(x => [+x.id, x])
        : [...p.crewChecks.entries()].map(([id, v]) => [+id, v]);
      if (entries.length) {
        rows.push(`<div class="sec">查验记录（转职后保留）</div>` + entries.map(([id, v]) =>
          `<div class="kv"><span>${id} 号</span><span>${v.locked ? esc(facName(v.locked)) + '（已锁定）'
            : (v.excludes || []).map(x => '非' + roleNameOf(x)).join('、')}</span></div>`).join(''));
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
    if (p.role === 'sheriff' || p.role === 'armed') parts.push(`枪${p.bullets}${p.patrolUsed ? '·巡逻已用' : ''}`);
    if (p.role === 'engineer' || p.role === 'assistant') parts.push(`维修${(p.repairTotal || 0).toFixed(1)}/${p.role === 'engineer' ? 4 : 3}·追加${p.extraRepair}`);
    if (p.role === 'bio') parts.push(`治疗${p.healLeft}·自救${p.selfSaveLeft}`);
    if (p.role === 'rescue' || p.role === 'tempdoc') parts.push(`救援${p.rescueLeft}·治疗${p.cureLeft}`);
    if (p.faction === 'alien') parts.push(`刀${p.alien ? p.alien.kills : '—'}·护盾${p.shield || 0}·破坏${((p.alien && p.alien.destroyTotal) || 0).toFixed(1)}`);
    if (p.faction === 'xeno') parts.push(`免疫${p.nightImmune}·双刀${p.awakened ? '✓' : '✗'}`);
    if (p.role === 'inspector') parts.push(`会议${p.meetingLeft}`);
    if (p.antibodyNight != null && p.antibodyNight >= g.night) parts.push('抗体');
    if (p.brew) parts.push(`制药${p.brew.progress}/2`);
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

  function renderSide(g) {
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
    } else if (tab === 'out') {
      const rows = g.players.filter(p => p.out);
      /* 职业余额表（显示方案 1.3）：由公开揭示信息自动汇总 */
      const totals = { crew: 4, engineer: 1, sheriff: 1, bio: 1, rescue: 1, detective: 1, bodyguard: 1, inspector: 1, alien: 3, xeno: 1 };
      let balance = '<div class="sec">职业余额表（已揭示出局 / 总数）</div>';
      for (const r of ['crew', 'engineer', 'sheriff', 'bio', 'rescue', 'detective', 'bodyguard', 'inspector', 'alien', 'xeno']) {
        const outN = g.players.filter(p => p.out && (p.originRole || p.role) === r).length;
        const left = totals[r] - outN;
        balance += `<div class="kv"><span>${esc(D.ROLES[r].name)}${r === 'alien' ? '（异形）' : r === 'xeno' ? '（外星人）' : ''}</span>` +
                   `<span>已揭示出局 ${outN} / ${totals[r]} · 剩余身份 ${left >= 0 ? left : 0} 人（含未揭示）</span></div>`;
      }
      /* 死因统计（显示方案 1.3）：仅逐夜累计呈现，不给出任何推断结论 */
      const causes = ['gun', 'alien', 'xeno', 'infect'];
      let stat = '<div class="sec">死因统计（逐夜累计，仅供自行比对）</div>';
      for (const c of causes) {
        const list = g.players.filter(p => p.out && p.outType !== 'vote' && p.cause === c);
        stat += `<div class="kv"><span>${esc(D.CAUSE_NAME[c] || c)}</span><span>累计 ${list.length} 人${list.length ? '（' + list.map(p => p.id + ' 号·第' + p.outNight + '夜').join('、') + '）' : ''}</span></div>`;
      }
      box.innerHTML = (rows.length ? rows.map(p =>
        `<div class="kv"><span>${p.id} 号 ${esc(p.name)}</span>
         <span>${facName(p.faction)} · ${esc(p.roleName)}${p.transferred ? '（原职业：普通船员）' : ''} · ${p.outType === 'vote' ? '驱逐' : D.CAUSE_NAME[p.cause]} · 第${p.outNight}夜</span></div>`).join('')
        : '<div class="empty">暂无出局者</div>') + balance + stat;
    } else {
      const known = g.players.filter(p => p.id !== me.id && ((me.known && me.known.has(p.id)) || p.revealed))
        .map(p => {
          const k = (me.known && me.known.get(p.id)) || p.revealed;
          return `<div class="kv"><span>${p.id} 号 ${esc(p.name)}</span><span>${esc(facName(k.faction))}${k.role ? ' · ' + esc(roleNameOf(k.role)) : ''}</span></div>`;
        }).join('');
      /* §2.5 记一笔（医师手动誊抄）＋ §2.1 对账便签：均由玩家手动写入备注，UI 不代记 */
      const isDoc = ['bio', 'rescue', 'tempdoc'].indexOf(me.role) >= 0;
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
    renderReplayBody(g);
  }

  function nights(g) {
    const end = global.Game.endData || {};
    const list = (end.replay || g.replay || []).map(e => e.night);
    return [0, ...[...new Set(list)].sort((a, b) => a - b)];
  }

  function renderReplayBody(g) {
    const end = global.Game.endData || {};
    const rp = (end.replay || g.replay || []).filter(e => !rpNight || e.night === rpNight);
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
    renderHud(g); renderRoster(g); renderPlayerPop(g); renderStage(g); renderSide(g);
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
     g.dev = 上帝模式（名单揭示+威胁度，粘滞）；devOvOpen = 总览浮层显隐（独立控制，✕/Esc 仅关浮层） */
  let devOvOpen = false;
  function toggleDevView() {
    const g = global.Game.g;
    if (!g) return;
    /* DEV 是纯开关：开着时再点一次即整体关闭（上帝模式、总览、详情弹窗一并收起） */
    if (!g.dev) { g.dev = true; devOvOpen = true; }
    else { g.dev = false; devOvOpen = false; popPid = null; }
    if (global.Game.mode === 'net') global.Net.send({ t: 'dev', on: g.dev });
    const b = el('btn-dev');
    if (b) b.classList.toggle('on', g.dev);
    render(g);
  }

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
    el('btn-music').onclick = () => {
      const on = global.SKAudio.toggle();
      const mb = el('btn-music');
      /* v32（用户拍板）：音效按钮开启时黄光边缘提示（与 DEV 按钮激活态同款） */
      if (mb) { mb.classList.toggle('on', !!on); mb.style.opacity = ''; }
    };
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
      /* 黑话术语表（全屏覆盖页）：开 / ✕ 关 */
      if (e.target && e.target.closest && e.target.closest('#btn-slang')) { openSlang(); return; }
      if (e.target && e.target.closest && e.target.closest('#btn-slang-close')) { closeSlang(); return; }
      /* v32：开始页顶部三键——音效开关 / 规则速览 / 黑话术语表（独立覆盖页） */
      if (e.target && e.target.closest && e.target.closest('#btn-slang-start')) { openSlang(); return; }
      if (e.target && e.target.closest && e.target.closest('#btn-rules')) { openRules(); return; }
      if (e.target && e.target.closest && e.target.closest('#btn-rules-side')) { openRules(); return; }   // v33：右栏底部规则入口
      if (e.target && e.target.closest && e.target.closest('#btn-rules-start')) { openRules(); return; }
      if (e.target && e.target.closest && e.target.closest('#btn-rules-close')) { closeRules(); return; }
      if (e.target && e.target.closest && e.target.closest('#btn-bgm')) {
        const cb = el('bgm');
        if (cb) {
          cb.checked = !cb.checked;
          e.target.closest('#btn-bgm').textContent = cb.checked ? '♪ 音效：开' : '♪ 音效：关';
        }
        return;
      }
      /* v32：单机暂停 / 退出（仅单机模式显示按钮） */
      if (e.target && e.target.closest && e.target.closest('#btn-pause')) {
        global.Game.togglePause();
        const b = e.target.closest('#btn-pause');
        if (b) b.textContent = global.Game.paused ? '▶ 继续' : '⏸ 暂停';
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
      if (e && e.key === 'Escape') { closeSlang(); closeRules(); closeDevView(); popPid = null; render(global.Game.g); }
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
  }

  function closeDevView() {
    /* 仅收起总览浮层：上帝模式（名单揭示+威胁度）不回退；角标出现，点击可重新展开 */
    devOvOpen = false;
    const ov = el('dev-overlay');
    if (ov) ov.classList.add('hidden');
    if (global.Game.g) render(global.Game.g);
  }

  /* ---------- 黑话术语表（全屏覆盖页） ---------- */
  function openSlang() {
    const ov = el('slang-overlay');
    if (ov) { ov.classList.remove('hidden'); ov.scrollTop = 0; }
  }
  function closeSlang() {
    const ov = el('slang-overlay');
    if (ov) ov.classList.add('hidden');
  }
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
        const bar = `<span class="lg-bar"><i style="width:${pct(d.p_alien)}%" class="ba"></i><i style="width:${pct(d.p_king)}%" class="bk"></i><i style="width:${pct(d.p_human)}%" class="bh"></i></span>`;
        return `<div class="lg-row"><b>${x.id} 号 ${esc(x.name)}</b>${bar}` +
          `<span class="lg-num">异 ${pct(d.p_alien)}% · 外 ${pct(d.p_king)}% · 人 ${pct(d.p_human)}%` +
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
      assets.push('<div class="sec">神探·已查验池</div>' + [...me.checkPool.values()].map(v =>
        `<div class="evt ${v.faction === 'human' ? 'good' : 'bad'}">${v.id} 号（第 ${v.night} 夜查验）：${({ human: '人类', alien: '异形', xeno: '外星人' })[v.faction]}（${v.roleName || v.role}）${v.published ? ' · 已公告' : ''}</div>`).join(''));
    }
    if (me.crewChecks && me.crewChecks.size) {
      assets.push('<div class="sec">船员·二查记录</div>' + [...me.crewChecks.entries()].map(([id, v]) =>
        `<div class="evt ${v.locked ? (v.locked === 'human' ? 'good' : 'bad') : 'info'}">${+id} 号：${v.locked ? `已锁定 ${{ human: '人类', alien: '异形', xeno: '外星人' }[v.locked]}` : `已排除 ${v.excludes.map(r => (global.NLP && global.NLP.ROLE_NAME ? (global.NLP.ROLE_NAME[r] || r) : r)).join('、')}`}（查了 ${v.n} 次）</div>`).join(''));
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

  global.UI = { render, init, updateTimer, renderRoom, renderReplayBody };
})(typeof window !== 'undefined' ? window : globalThis);
