/* 规则引擎：夜间步骤机 + 白天流程 + 结算与胜负判定 */
(function (global) {
  const D = global.SKData;
  /* 声明层入口（角色声明表 / 推导层）。置于此处而非就近声明：doTransfer（武装识别）与
     openingRosterText（批次〇构成）等运行期消费点同样需要，早前把二者留在函数内
     造成作用域不可见（noBridge 剖面连跑即崩）。 */
  const RD = global.SKRoleDecl, ACT = global.SKDerivation;

  /* v6.6 2.1.1 夜间步骤总表对齐（A7，2026-10-03）：
     · 两个前置子阶段（不占编号行动位）：'P-id' 身份改变子步骤（死囚变形/外星人觉醒，位于
       白天投票驱逐之后、当夜步骤 0 之前）与 'P-clean' 昼末清理阶段（异形清洗 5.9）——
       依 2.1.5 时序：白天投票驱逐 → 额度被动到账（nextNight/grants）→ 身份改变 → 昼末清理 → 步骤 0；
     · 蛰伏归编号步位 0.1（'0.1' 查验 + '0.1s' 可选沉默——6.1.1 蛰伏两步，沉默窗口为
       实现子步位，同 0a/0b/0c 之拆分容忍）；0.7 行动预提交删除（破坏/结茧改于 4b 决策）；
       2b 巡逻并入步骤 2；新增 0.2 窃听、3.5 嗅探窗口（角色未实装前为占位步，req 恒空自动跳过）；
     · 步骤 1 = 乔装（7.3，未实装占位）；私聊可保留 0a/0b/0c 三段（A7 明文容忍）。
     v6.6 1.4.1（拍板 I1）：寂灭冻结明文列举制——冻结 0a/0b/0c、4a、11；4b 保留（结茧分支
     不冻，破坏分支由表单禁用）；0.1/0.2/0.6/3/3.5 未列即不冻（0.6 进化/转化保持可用）。
     v6.6 1.4.2/1.4.3（拍板 I2）：决斗仅取消白天流程（步骤 10 因存活≥5 门槛恒空转），
     夜间全序列照常、倒计时不冻；僵局计数已按该前提门控于 tiers[9]/extinction。
     〔裁决③ 2026-10-03〕P-clean 昼末清洗阶段自两阶段队列移除——进入寂灭/决斗时假标记与
     清洗窗口一并拔除（1.4.1 明文 + 5.9 引证扩及决斗，1.4.2 未另写）。
     〔歧义②裁决 2026-10-03〕额度被动到账先于身份改变子步骤（6.8.3④「稻草人先领、变形仅
     转移操作权」）——与 2.1.5 一致；6.8.3③「变形先于到账」之表述以 ④ 为准：变形夜可用当夜额度。
     本文件 grants() 于 nextNight 内调用、P-id 紧随其后，故顺序即为此。 */
  const NORMAL  = ['P-id','P-clean','0a','0b','0c','0.1','0.1s','0.2','0.5','0.55','0.6','1','2','3','3.5','4a','4b','5','6','7','8','9','10','11'];
  const EXTINCT = ['P-id','0.1','0.1s','0.2','0.5','0.55','0.6','1','2','3','3.5','4b','5','6','7','8','9'];
  const DUEL    = ['P-id','0a','0b','0c','0.1','0.1s','0.2','0.5','0.55','0.6','1','2','3','3.5','4a','4b','5','6','7','8','9','11'];

  /* 1.5.2 夜数上限与全局平局（2026-10-04 修订：999 → 99，并加判定节点守卫）
     正文 1.5.2：「判定节点与该夜实际结算到的最后一个步骤一致，凡至第 99 夜结束时仍无胜负即
     判平……常规阶段与人类尚有存活者的决斗时刻取步骤 11 结算完成；寂灭时刻（人类全灭，步骤
     11 冻结）取步骤 9 死亡结算完成。决斗时刻的僵局判定（1.4.3）优先于本条。」
     ⚠ 实现陷阱（C1）：g.night 在一夜【开始时】即已设定，而 checkWin 在步骤 9 与步骤 11
     各有一个调用点。若只写 `if (g.night >= 99) return 'draw'` 而不带节点守卫，第 99 夜的
     步骤 9 就会提前判平，令该夜步骤 10（紧急会议及驱逐）与步骤 11 不再执行——早于正文
     规定的节点。故夜数兜底必须显式带节点：
       · '9'    —— 寂灭时刻（EXTINCT 队列不含 '11'，步骤 9 即该夜最后节点）
       · '11'   —— 常规阶段与人类尚有存活者的决斗时刻
       · 'vote' —— 会议夜：步骤 11 被 g.skipCountdown 跳过，该夜最后节点是 M-vote
     〔裁决 2026-10-04〕寂灭与决斗叠加时以寂灭为准：人类既已全灭，倒计时胜利线已自动取消
     （1.4.4），冻结与否对胜负无影响；队列亦取 EXTINCT（见 updateQueue）。 */
  const NIGHT_CAP = 99;
  function nightCapDraw(g, node) {
    if (g.night < NIGHT_CAP) return false;
    if (g.extinction) return node === '9';
    return node === '11' || node === 'vote';
  }

  const STEP_NAME = {
    'P-id':'身份改变子步骤','P-clean':'昼末清理阶段',
    '0a':'私聊·发起邀请','0b':'私聊·处理邀请','0c':'私聊·正文',
    '0.1':'外星人蛰伏·查验','0.1s':'蛰伏·可选沉默','0.2':'窃听者窃听',
    '0.5':'感染抑制','0.55':'感染致死','0.6':'进化 / 转化 / 转职','1':'乔装','2':'查验 / 巡逻',
    '3':'保镖保护 / 安全室','3.5':'嗅探','4a':'维修','4b':'破坏 / 结茧',
    '5':'外星人击杀','6':'开枪','7':'异形行动','8':'医生','9':'死亡结算','10':'紧急会议','11':'倒计时结算',
    'M-talk':'会议讨论','M-vote':'会议投票','M-speech':'验票官专属发言','D-will':'遗言','D-talk':'自由讨论','D-vote':'投票',
    'D-open':'开局公开讨论','D-report':'窃听报告（条件性阶段）',
  };

  /* T19（2026-10-05 文本审查第二遍）：未实装机制的占位步——req 恒空、每夜命中
     「无决策者，整步跳过」日志，向玩家泄漏未实装机制名。占位步静默跳过。
     〔批次 29 修订〕「变体步位」在 A6 实装后已不是占位，但**同一口径继续适用**：
     0.2 窃听与 3.5 嗅探的候选角色（窃听者/猎手）在经典局根本不在场，此时该通知
     纯属每夜重复的噪声——角色不在场，无从「跳过」可言；而角色在场却无人能出手
     （出局/沉默/濒死）是真实的规则事实，通知必须保留。
     ⚠ 判据必须精确：2026-10-05 曾试改为推导层推导（sendersAt ∩ 本局在场），实测与
     本表的静默集合**并不逐位等价**（指纹 9e939c90 ≠ 基线 fdd6415f）——「声明层无人」
     与「本局无人」在自动步位上不可混同。故此表为显式登记，并由 §23 断言把守
     （经典局日志不得出现变体机制步位的跳过通知）。
     变体局有角色在场时通知照常出现——那是规则事实，不是噪声。 */
  const PLACEHOLDER_STEPS = { '0.2': 1, '3.5': 1 };

  /* ============ 基础工具 ============ */
  const alive  = g => g.players.filter(p => !p.out);
  const aliveF = (g, f) => alive(g).filter(p => p.faction === f);
  const P      = (g, id) => g.players.find(p => p.id === id);
  const canAct = (g, p) => !p.out && !p.dying && p.silenceNight !== g.night && !p.noActive;

  /* ============ 投递原语：已解耦至 js/engine/announce.js ============
     公开/私有分叉的唯一收口点；本文件内调用点与 Engine.* 导出面零改动。 */
  const ANN = global.EngineAnnounce;
  const log = ANN.log, announce = ANN.announce, priv = ANN.priv, god = ANN.god;
  const applyThreat = ANN.applyThreat, banner = ANN.banner;
  /* B5（v6.6 阶段 1.5）：身份揭示唯一收口点（js/v66/reveal/revealService.js） */
  const Reveal = global.RevealService;
  /* P1-a（2026-10-05）：公告 IR——揭示类公告（⑥⑩③④⑤暴露条款）的节点构造与模板渲染
     唯一出口（js/lang/announceIR.js）；2.8.12③ 差量登记于其 SCHEMA 一处。 */
  const AIR = global.AnnounceIR;

  /* ============ 伤害 / 感染 ============ */
  function applyLethal(g, t, type, attacker) {
    /* 保镖受袭感知：被保护者被指定为攻击目标并结算即触发（含对濒死目标的无效攻击）。
       属伤害侧情报（4.8.3），由伤害侧保护位触发；感染侧不触发。 */
    if (t && t.guardDmg && t.guardedBy) {
      const bg = P(g, t.guardedBy);
      if (bg && !bg.out) {
        priv(g, bg, `受袭感知：你保护的对象遭到攻击，伤害类型为「${D.DAMAGE_TYPE[type]}」。`);
        /* v32 批 5′（角色注意力 / 私有源流水）：R04「受袭感知：伤害类型三分」此前只有 priv() 文本
           （交接文档 §3 点名的两条缺落盘之一）。以单人私有流水入账（own:bodyguard:hit，delta=0 占位，
           量级留 7′），伤害类型进 src 供后续通道判据读取。 */
        if (global.MoE && global.MoE.absorbPrivate)
          global.MoE.absorbPrivate(g, bg.id, t.id, `own:bodyguard:hit:${g.night}:${type}`, 'fact');
      }
    }

    let res = 'wasted';
    let immuneUsed = false;
    if (t && !t.out && !t.dying) {
      /* 4.4⑤：记录「当夜对该目标出过枪击的攻击方」——悬赏与死因归属解耦，各自独立触发 */
      if (type === 'gun' && attacker && attacker.id !== t.id) {
        (t.gunAttackers = t.gunAttackers || []).push(attacker.id);
      }
      res = 'hit';
      /* A12 双计数独立（2.8.2⑤/4.8.1）：伤害侧与感染侧各计 1 单位、独立消耗、互不牵连。
         此前 t.guard 布尔两侧共用，一次保护在伤害侧消耗后感染侧同时失效（唯一确认的实现缺陷）。 */
      /* 4.3.1/2.8.2⑥：安全室为全额减免层，先于一切抵挡层、不消耗任何其他层、当夜不限次数。
         （v6.6 2.3 表 #8：工程师第 1 夜被动全能免疫已移除，改为此限定技。） */
      if (t.safeRoomNight != null && t.safeRoomNight === g.night) res = 'blocked';
      /* 4.6.4③〔通则 2.8.2⑥ 之例外，登记于 2.8.9(18)〕：毒伤层序与伤害侧相反——**仅全额减免层
         可挡**（安全室、外星人夜晚免疫），庇护类（保护 / 巡逻 / 工匠护甲 / 结茧护盾）一律不防。
         故此处须在任何抵挡层之前单独判一次，不能与下方 damage 侧层序合并。 */
      else if (type === 'poison') {
        if (t.faction === 'xeno') {
          if (t.immuneActiveNight != null && t.immuneActiveNight === g.night) res = 'blocked';
          else if (t.nightImmune > 0) { t.nightImmune -= 1; t.immuneActiveNight = g.night; res = 'blocked'; immuneUsed = true; }
        }
      }
      else if (t.guardDmg) { t.guardDmg = false; res = 'blocked'; }
      else if (t.patrolDmg) { t.patrolDmg = false; res = 'blocked'; }
      /* 4.11.1⑤ 层序（伤害侧「保护→巡逻→护甲→护盾」）：工匠护甲为存续类，排在结茧护盾**之前**
         （类内明文优先）。双计数独立：护甲同时含伤害侧与感染侧各 1 单位，本处扣伤害侧。 */
      else if (t.armor && t.armor.mode) { t.armor.mode = null; res = 'blocked'; priv(g, t, '你的护甲被打破了。'); }
      else if (t.shield > 0) {
        t.shield -= 1; res = 'blocked';
        /* 5.7⑧：结茧护盾被打破时，其持有者知情（不含攻击者信息） */
        priv(g, t, '你的结茧护盾被打破了。');
      }
      else if (t.faction === 'xeno') {
        if (t.immuneActiveNight != null && t.immuneActiveNight === g.night) res = 'blocked';
        else if (t.nightImmune > 0) {
          t.nightImmune -= 1; t.immuneActiveNight = g.night; res = 'blocked'; immuneUsed = true;
        }
      }

      if (res === 'hit') {
        t.dying = true; t.dyingCause = type; t.killedBy = attacker ? attacker.id : null;
        /* v24 规则修正：沉默是【蛰伏专属】（6.1），已移到步骤 1b——
           此前挂在「已觉醒外星人双刀命中附带」（注释称 6.2⑤），但 6.2 只讲刀数与时点，
           全文无沉默；规则与实现正好挂反，现已按 6.1 归位。 */

      }
    }
    /* 4.10.6 尸体调查报告：逐项列出该尸体于当夜查明的全部致死来源——「落身即记」，
       即未被任何抵挡层与全额减免拦下的攻击，无论是否造成濒死（对濒死目标的补刀亦落身）；
       落身来源去重后按类别汇总，不带次数、不指明攻击者。感染/中毒致死单列（见步骤 0.55）。 */
    if (t && res !== 'blocked' && (res === 'hit' || res === 'wasted')) {
      if (!t.deathCauses) t.deathCauses = [];
      if (t.deathCauses.indexOf(type) < 0) t.deathCauses.push(type);
    }
    /* 4.10⑥/7.2.2：攻击结果即时反馈——同一次出手的多份由调用方汇总为一条（见 steps.js 步骤 5/6/7）；
       本函数只产出单份结果与结构化落盘（攻击方私有流水，供 AI 推理）。 */
    if (attacker && !attacker.out) {
      priv(g, attacker, res === 'hit' ? '你的攻击生效。' : '你的攻击无效。');
      /* v26：攻击反馈【结构化】落盘（私有源，只写攻击方本人）——
         总表 N302~N307 族的唯一载体。此前只有 priv() 文本，AI 无从推理
         「连续两夜攻击同一目标均无效 ⇒ 目标持结茧护盾 ⇒ 异形」（N306 ★★★）。 */
      (attacker.attackLog = attacker.attackLog || []).push({ night: g.night, target: t ? t.id : null, type, res });
    }
    /* 7.2.4：夜晚免疫消耗即时告知本人——只报已消耗/路径/剩余，不含任何来源 */
    if (immuneUsed && t) {
      priv(g, t, `夜晚免疫消耗：已消耗 1 次（伤害侧），剩余 ${t.nightImmune} 次。`);
    }
    god(g, `${attacker ? attacker.id + ' 号' : '系统'} → ${t.id} 号：${D.CAUSE_NAME[type] || type}，` +
          `${res === 'hit' ? '命中（进入濒死）' : res === 'blocked' ? '被抵挡层拦下' : '目标已濒死/出局（无效）'}`);
    return res;
  }

  function applyInfection(g, t, infector) {
    if (!t || t.out) return 'none';
    /* 4.3.1：安全室于施加阶段拦截标记（全额减免层，当夜不受次数限制），不消耗其他层 */
    if (t.safeRoomNight != null && t.safeRoomNight === g.night) return 'blocked';
    if (t.antibodyNight === g.night) {
      t.antibodyNight = null;
      const b = t.antibodyBy ? P(g, t.antibodyBy) : null;
      if (b && !b.out && b.role === 'bio') {
        priv(g, b, '你赋予的抗体生效了。');   // 不报来源/真假
        /* v31 批 3.5（N407 输入）：P15「抗体生效」结构化落盘（私有源，只写该生化医师本人）——
           此前只有 priv() 文本，AI 无从推理「我这夜确实被施加过一次感染」，
           于是总表自评的「全场唯一能识别 N360 欺诈感染的私有路径」在实现上是空的。
           注意层序：抗体在【效果免疫之前】结算 ⇒ 真假标记皆不会落地（4.5 明文，N407 note 已记录）。 */
        (b.antibodyFired = b.antibodyFired || []).push({ night: g.night, target: t.id });
        /* v32 批 5′：R05 抗体生效流水（单人私有，delta=0 占位） */
        if (global.MoE && global.MoE.absorbPrivate)
          global.MoE.absorbPrivate(g, b.id, t.id, `own:bio:antibody:${g.night}`, 'fact');
      }
      return 'blocked';
    }
    /* A12 双计数独立（5.3.3 感染侧层序：抗体→保护→巡逻→护甲）——与伤害侧各计各的 */
    if (t.guardInf) { t.guardInf = false; return 'blocked'; }
    if (t.patrolInf) { t.patrolInf = false; return 'blocked'; }
    /* 4.11.1⑤ 感染侧第四层（护甲）：与伤害侧**双计数独立**——伤害侧已扣掉的护甲不连带
       消耗本侧（4.11.1①「双计数独立，分别消耗、互不牵连」）。 */
    if (t.armor && t.armor.mode) { t.armor.mode = null; priv(g, t, '你的护甲被打破了。'); return 'blocked'; }
    if (t.infection) return 'none';                                          // 标记天然互斥
    const fast = infector && infector.faction === 'alien' && infector.alien.dir === 'infect';
    let out;
    if (t.faction === 'alien') {                                             // 效果免疫 → 假标记
      t.infection = { real: false, appliedNight: g.night, deathNight: null };
      out = 'fake';
    } else {
      t.infection = { real: true, appliedNight: g.night, deathNight: g.night + (fast ? 1 : 2) };
      if (t.faction === 'xeno') t.cureSelf = Math.min(1, t.cureSelf + 1);
      priv(g, t, `你身上出现感染标记，将于第 ${t.infection.deathNight} 夜致死。`);
      out = 'real';
    }
    god(g, `${infector ? infector.id + ' 号' : '系统'}感染 ${t.id} 号 → ` +
          (out === 'real' ? `真标记，第 ${t.infection.deathNight} 夜致死` : '假标记（受体为异形）'));
    /* v32 批 5′：R09 标记清单流水（规则 3.3④：异形可见标记清单且可辨真伪）。
       流水只记「该目标当夜被施加标记」——真伪辨读走既有合法视野（x.infection 真值读），
       src 不携带真伪字段（AI 不读真相红线）；delta=0 占位，量级留 7′。 */
    if (out === 'real' || out === 'fake') {
      for (const a of g.players) {
        if (a.out || a.faction !== 'alien') continue;
        if (global.MoE && global.MoE.absorbPrivate)
          global.MoE.absorbPrivate(g, a.id, t.id, `own:alien:mark:${g.night}`, 'fact');
      }
    }
    return out;
  }

  /* 清除感染的唯一入口：外星人的感染治疗额度随感染消失而作废（6.5⑥） */
  function clearInfection(g, t) {
    t.infection = null;
    if (t.faction === 'xeno') t.cureSelf = 0;
  }

  /* ============ 转职 ============ */
  function doTransfer(g, p, dir) {
    p.transferred = true;
    p.role = dir; p.roleName = D.ROLES[dir].name;
    /* v32 批 5′（角色注意力）：转职 = 换眼睛 —— 挂载新角色专家、卸载原职业的（规则 120）。
       已入账的 p.tEvents 不删除（留记忆，规则 118）；技能层额度重置引擎已按规则 120 处理，
       本批只动「入账资格」（挂载），不碰技能层（交接文档 §1.3）。 */
    p.roleExpert = dir;
    if (dir === 'armed') {
      p.bullets = 1;
      (p.bulletLog = p.bulletLog || []).push({ night: g.night, delta: 1, src: '转职初始 1 发' });
      /* 4.4.5 武装识别（双向）：猎杀位席位由警长/猎手开局定其一（1.1.1）——识别目标为
         该席位实际在场者（hunter 局即猎手，4.4.7⑤「依 4.4.5 同制」）。角色集合经
         声明层读（RD.rolesOfGroup('hunt')，D6：族判定不得手写角色键链）。 */
      const huntSeat = RD.rolesOfGroup('hunt');
      const gunSeat = g.players.find(x => huntSeat.indexOf(x.role) >= 0 && !x.out);
      if (gunSeat) {
        p.known.set(gunSeat.id, { faction: 'human', role: gunSeat.role });
        gunSeat.known.set(p.id, { faction: 'human', role: 'armed' });
        priv(g, gunSeat, `武装识别：${p.id} 号已成为武装船员。`);
        priv(g, p, `武装识别：${D.ROLES[gunSeat.role].name}是 ${gunSeat.id} 号。`);
      }
    } else if (dir === 'assistant') {
      p.repairTotal = 0;
    } else if (dir === 'tempdoc') {
      p.rescueLeft = 1; p.cureLeft = 2;
    }
    log(g, `${p.id} 号完成转职 → ${p.roleName}`, 'info');
  }

  /* ============ 额度发放 ============ */
  function grants(g) {
    const n = g.night;
    /* 4.4.6（v6.6 2.3 表 #10）：警长子弹存量上限 2 发——达上限后到账即作废
       （不入库、不结转、不预存、不补发）。悬赏回复按守恒定理本不溢出，一并收口。
       〔通则 4.4.6 之例外〕猎手不受本上限约束（4.4.7③，登记于 2.8.9(14)）——
       其成长路径（攒弹/悬赏）依 4.4.7③「可正常累积」。 */
    const grantBullets = (p, count, msg) => {
      const cap = p.role === 'hunter' ? Infinity : 2;
      const added = Math.min(count, Math.max(0, cap - p.bullets));
      p.bullets += added;
      (p.bulletLog = p.bulletLog || []).push({ night: g.night, delta: added, src: msg });
      priv(g, p, added < count ? `${msg}；已达存储上限 2 发，溢出 ${count - added} 发作废。` : `${msg}。`);
    };
    for (const p of g.players) {
      if (p.out) continue;
      /* A6 批次 32 · 6.8.3④【镜像账本·被动额度】死囚的各身份镜像**于到账时点各自独立领取**
         当夜应得的被动额度（4.4.3 的第 5 夜＋1 发、4.4.6 上限等），变形仅转移操作权、
         不改已到账额度。故被动额度写进**每一张镜像**，不写本体——变形当夜即可取用。
         主动资源（进化、转化等）仅于实际处于该身份期间产生（2.8.5②），故不预写。 */
      if (p.convict && p.mirror) {
        const M = global.SKMirror;
        for (const k of M.keysOf(p.mirror)) {
          if (k === 'sheriff' || k === 'hunter') {
            const cur = M.get(p.mirror, k, 'bullets') || 0;
            let add = 0;
            if (k === 'sheriff' && n === 5) add = 1;                                  // 4.4.3① 警长专属
            if (k === 'sheriff' && !M.get(p.mirror, 'sheriff', 'lowPopGiven')) {        // 4.4.3② 存活≤6
              if (alive(g).length <= 6) { add += 1; M.set(p.mirror, 'sheriff', 'lowPopGiven', true); }
            }
            if (add) M.set(p.mirror, k, 'bullets', Math.min(cur + add, k === 'hunter' ? Infinity : 2));
          }
          if (k === 'xeno' && n === 7) M.set(p.mirror, k, 'nightImmune', (M.get(p.mirror, k, 'nightImmune') || 0) + 1);
        }
      }
      if (p.role === 'bio' && n <= 3) { p.healLeft += 1; priv(g, p, '你获得 1 次治疗额度。'); }
      if (p.role === 'rescue' && n <= 2) { p.rescueLeft += 1; priv(g, p, '你获得 1 次救援额度。'); }
      /* 4.4.3：警长两项独立的额外子弹——① 第 5 夜起（全局仅此 1 次）② 全场存活≤6 名（全局仅此
         1 次，见本函数下方 lowPopGiven）。两项可叠加，至多额外 2 发，均受 4.4.6 存储上限 2 约束。
         〔2026-10-05 规则方裁决〕到账夜为**第 5 夜**（正文 4.4.3 明文），此前实现的 n===7 作废。
         ⚠ 不要与下方外星人的「第 7 夜夜晚免疫」（6.4）混为一谈——两者夜次不同，勿再统一。 */
      if (p.role === 'sheriff' && n === 5) grantBullets(p, 1, '第 5 夜：额外获得 1 发子弹');
      /* 6.4：外星人夜晚免疫第 7 夜额外 1 次（与警长子弹的夜次无关，各自依其条款） */
      if (p.role === 'xeno' && n === 7) { p.nightImmune = Math.min(2, p.nightImmune + 1); priv(g, p, '第 7 夜：额外获得 1 次夜晚免疫。'); }
      if (p.bounty > 0) {
        grantBullets(p, p.bounty, `悬赏：回复 ${p.bounty} 发子弹`);
        p.bounty = 0;
      }
      /* A6 批次 31 · 4.6.4⑥：毒师额度——毒药/解药各 3 份，第 1、3、5 夜各到账 1 份（初始 1
         ＋ 第 3 夜 ＋1 ＋ 第 5 夜 ＋1），到账时点依 2.1.5 默认额度发放时序（此处即 grants，
         位于白天投票之后、当夜步骤 0 之前），到账当夜即可使用。无击杀回复、无补充途径。 */
      if (p.role === 'poisoner' && (n === 3 || n === 5)) {
        p.poisonLeft += 1; p.antidoteLeft += 1;
        priv(g, p, `第 ${n} 夜：毒药与解药各到账 1 份（各剩 ${p.poisonLeft} 份）。`);
      }
      /* A6 批次 31 · 4.11.2①之二：速成护甲的 4 夜期限（铸造夜为第 1 夜且当夜不生效，
         第 2、3 夜具保护功能，第 4 夜自动消失）。到期消失即不复存在、不返还、不折算
         （4.11.2①之二）；到期时告知持有者（4.11.4）。常规护甲为存续型、无期限，不在此判定。 */
      if (p.armor && p.armor.mode === 'fast' && p.armor.expireNight != null && g.night >= p.armor.expireNight) {
        p.armor.mode = null; p.armor.expireNight = null;
        priv(g, p, '你的速成护甲已到期消失。');
        god(g, `${p.id} 号的速成护甲到期消失（第 ${g.night} 夜）`);
      }
      /* C11（进程注册表）：进程型产出的次夜到账——通用引擎按声明的资源增量落实并按模板发私反馈
         （制药的 rescueLeft+1 / cureLeft+2 与文案均在 js/v66/declaration/processRegistry.js）。
         〔批次 31〕铸造产物为 armorStock（工匠护甲入库），同走此口。 */
      if (global.SKProcessEngine) global.SKProcessEngine.deliver(g, p, { say: t => priv(g, p, t) });
    }
    if (!g.lowPopGiven && alive(g).length <= 6) {
      g.lowPopGiven = true;
      const s = g.players.find(x => x.role === 'sheriff' && !x.out);
      if (s) grantBullets(s, 1, '全场存活≤6：额外获得 1 发子弹');
    }
  }

  /* ============ 阶段切换 ============ */
  function nextNight(g) {
    g.night += 1;
    g.day = g.day || 0;
    g.phase = 'night';
    g.step = null;
    g.sub = null;
    g.suppressCount = 0; g.cureHands = 0;
    g.checkCount = 0; g.patrolCount = 0;
    g.stopNight = g.pendingStop; g.pendingStop = false;
    g.skipCountdown = false;
    g.lastAliveCount = alive(g).length;
    for (const p of g.players) {
      p.guardDmg = false; p.guardInf = false; p.patrolDmg = false; p.patrolInf = false;
      p.noActive = false; p.guardedBy = null;
      p.killedBy = null; p.repairedTonight = 0; p.branch = null; p.gunAttackers = null; p.sabAmount = null;
      p.patroledTonight = false; p.repairValue = null;
      p.sniffedTonight = false;              // A6 批次 29：嗅探当夜标记（攒弹互斥的时序绑定，4.4.7②b）

      /* 转化：新方向于次夜生效；次夜步骤 0.6 前死亡 → 回滚（不公告、不计次数，5.5） */
      if (p.alien && p.alien.pendingDir) {
        if (p.out) { p.alien.converts -= 1; g.pendingEvolve = Math.max(0, (g.pendingEvolve || 0) - 1); }
        else {
          p.alien.dir = p.alien.pendingDir;
          if (p.alien.dir !== 'kill') p.alien.extraKill = 0;   // 离开击杀方向：额外出刀作废（5.4）
          priv(g, p, `转化完成，当前方向：${{ destroy: '破坏', infect: '感染', kill: '击杀' }[p.alien.dir]}。`);
        }
        p.alien.pendingDir = null;
      }
      /* 击杀进化：额外出刀自进化后的下一个夜晚起可用（5.4） */
      if (p.alien && p.alien.dir === 'kill' && p.alien.evoNight === g.night - 1 && !p.alien.extraGiven) {
        p.alien.extraKill = 1; p.alien.extraGiven = true;
      }
    }
    grants(g);
    g.nightChats = [];                     // A6 批次 29：当夜配对私聊正文副本（0c 落、0.2 窃读取）
    g.nightOrder = g.rng.shuffle(g.players.map(p => p.id));   // 每夜独立随机结算顺序（2.1，与编号解耦）
    g.queue = updateQueue(g);
    log(g, `—— 第 ${g.night} 夜开始 ——`, 'info');
  }

  /* 阶段队列选取（1.4，C3 2026-10-04）：寂灭与决斗可同时为真——人类全灭后存活若再收敛至
     2 名且分属两个敌对阵营，1.4.2 明文「同样适用本条」。此时【以寂灭为准】：EXTINCT 不含
     '11' ⇒ 步骤 11 冻结。该优先级由回归断言钉死（防后续改动改坏）。 */
  function updateQueue(g) {
    if (g.extinction) return EXTINCT.slice();
    if (g.duel) return DUEL.slice();
    return NORMAL.slice();
  }

  /* 按「当夜结算顺序」遍历（决策并行、结算串行） */
  function orderedPlayers(g) {
    return (g.nightOrder || g.players.map(p => p.id)).map(id => P(g, id));
  }

  function startDay(g) {
    g.phase = 'day'; g.day += 1; g.step = null;
    /* 2.3.2：白天阶段顺序＝窃听报告发布（条件性阶段·仅当窃听者持有**当夜且非空**的读取时
       启用，否则整体跳过）→〇留言→自由讨论→投票。批次⑪随 D-report 发布（4.12.2②：位于
       〇留言与自由讨论之前，即全场首次发言之前）。
       非空条件是必要的：无任何可读组时挂入阶段只会开出一个空决策窗（读取无处可用），
       白白消耗一次报告额度前的决策机会，且让玩家看见一个无内容的窗口。 */
    const hasReport = g.players.some(p => p.role === 'listener' && !p.out &&
      p.reportLeft > 0 && p.wiretap && p.wiretap.night === g.night && p.wiretap.groups.length > 0);
    g.queue = (hasReport ? ['D-report'] : []).concat(['D-will', 'D-talk', 'D-vote']);
    log(g, `—— 第 ${g.day} 个白天 ——`, 'info');
  }

  function nextPhase(g) {
    if (g.over) return;
    if (g.phase === 'open') { nextNight(g); return; }   // 开局讨论结束 → 第 1 夜
    if (g.phase === 'night') {
      if (g.extinction || g.duel) nextNight(g);
      else startDay(g);
    } else {
      nextNight(g);
    }
  }

  /* 假标记拔除（1.4.1 寂灭 + 5.9 决斗，2026-10-03 裁决③）：进入两阶段时全部现存假标记立即清除，
   此后清洗窗口不再存在（无医生可欺、无假标记可清，P-clean 亦已从两阶段队列移除）。 */
function clearFakeMarks(g) {
  for (const p of g.players) if (p.infection && !p.infection.real) p.infection = null;
}
function updatePhases(g) {
    const al = alive(g);
    const h = al.filter(p => p.faction === 'human').length;
    const a = al.filter(p => p.faction === 'alien').length;
    const x = al.filter(p => p.faction === 'xeno').length;
    if (!g.extinction && h === 0 && a > 0 && x > 0) {
      g.extinction = true; g.queue.length = 0;
      clearFakeMarks(g);          /* 假标记与清洗窗口一并拔除（1.4.1，2026-10-03 裁决③） */
      banner(g, '人类全灭 → 进入【寂灭时刻】；倒计时胜利线已取消。');
      log(g, '人类全灭，进入寂灭时刻。', 'bad');
    }
    const factions = new Set(al.map(p => p.faction));
    if (!g.duel && al.length === 2 && factions.size === 2) {
      g.duel = true; g.queue.length = 0;
      clearFakeMarks(g);          /* 同上：决斗时刻亦拔除（5.9 曾引 1.4.1 扩及决斗，正文 1.4.2 未写明，按就近明文裁决） */
      banner(g, '存活仅剩 2 名敌对玩家 → 进入【决斗时刻】，白天流程取消。');
      log(g, '进入决斗时刻。', 'bad');
    }
  }

  function checkWin(g, node) {
    /* 1.2.3 判定顺序⓪：夜数兜底（第 99 夜结束仍无胜负）全局平局，优先级最高，先于①②③④。
       节点守卫见 NIGHT_CAP 处说明——本条不得退回「只看 g.night」的写法。 */
    if (nightCapDraw(g, node)) return 'draw';
    const al = alive(g);
    const h = al.filter(p => p.faction === 'human').length;
    const a = al.filter(p => p.faction === 'alien').length;
    const x = al.filter(p => p.faction === 'xeno').length;
    if (a === 0 && x === 0) return 'human';
    if (h === 0 && x === 0) return 'alien';
    if (h === 0 && a === 0) return 'xeno';
    if (g.countdown <= 0 && h > 0 && !g.tiers[9] && !g.extinction) return 'human';
    return null;
  }

  function endGame(g, w) {
    g.over = true; g.winner = w; g.queue.length = 0; g.pending = null;
    const name = { human: '人类', alien: '异形', xeno: '外星人', draw: '平局' }[w];
    log(g, `对局结束：${name}${w === 'draw' ? '' : ' 获胜'}。`, w === 'draw' ? '' : 'good');
  }

  /* ============ 表单（玩家决策） ============ */
  function formPlayers(list, max, min, exclude, label) {
    return { list: list || 'aliveOthers', max: max, min: min || 0, exclude: exclude || [], label };
  }
  function toDecision(kind, d) {
    d = d || {};
    const t = d.targets || [];
    switch (kind) {
      case 'invite':    return { invite: t[0] != null ? t[0] : null };
      /* v25 遗留修复：此前缺 inviteAccept / chat 两个 case → 真人走到私聊步骤时
         toDecision 返回 {} → 0b 的 d.accept 与 0c 的 d.text 永远缺失 = 真人私聊 100% 失效 */
      case 'inviteAccept': return { accept: d.opt || 'none' };
      case 'chat':      return { text: d.text || '' };
      case 'suppress':  return { use: d.opt === 'yes' };
      case 'evolve':    return { dir: d.opt === 'none' ? null : d.opt };
      case 'convert':   return { do: d.opt !== 'none', dir: d.opt === 'none' ? null : d.opt };
      case 'transfer':  return { dir: d.opt === 'none' ? null : d.opt };
      /* A13（4.1.1 验证式）：提交的待查证身份逐个独立作答；num2 为第二身份（第 2 次起可用）。
         4b 破坏/结茧：branch + 自选破坏量 num + 结茧目标 targets[0]。 */
      case 'branch':    return { branch: d.opt, num: d.num,
                                 cocoonTarget: t[0] != null ? t[0] : null };
      case 'awaken':    return { do: d.opt === 'yes' };
      /* A19 乔装（7.3）：opt＝伪装身份键或 'none'（不乔装）。 */
      case 'disguise':  return { opt: d.opt || 'none' };
      case 'crewAction':return d.opt === 'check' ? { mode: 'check', target: t[0],
                              ids: [d.num, d.num2].filter(v => typeof v === 'string' && v !== 'none') }
                            : d.opt && d.opt.indexOf('repair') === 0 ? { mode: 'repair', value: parseFloat(d.opt.slice(6)) }
                            : { mode: 'none' };
      case 'detective': return { mode: d.opt || 'none', target: t[0] };
      case 'patrol':    return { use: d.opt === 'yes', targets: t };
      case 'guard':     return { target: t[0] != null ? t[0] : null };
      /* A6 批次 32：死囚变形（opt＝目标角色键或 'none'）与复生（use/targets） */
      case 'morph':        return { opt: d.opt || 'none' };
      case 'revive':       return { use: !!d.use, targets: t };
      /* A6 批次 31：工匠三选一（铸造/分配互斥，4.11.2）；分配份数＝当前库存（2.5 额度制） */
      case 'craft':     return { opt: d.opt || 'none', targets: t };
      case 'repair':    return { do: d.opt === 'repair' || d.opt === 'extra', extra: d.opt === 'extra',
                                 value: d.num, extraValue: d.num2 };
      case 'safeRoom':  return { use: d.opt === 'yes' };
      case 'xenoCheck': return { target: t[0] };
      case 'xenoSilence': return { silence: d.opt === 'yes' };   // v24：蛰伏沉默字段（真人通道此前缺）
      case 'xenoKill':  return { targets: t };
      case 'shoot':
        /* A6 批次 29：猎手三选一（gather/none/shoot）；警长提交无 opt——targets 即开枪。 */
        if (d.opt === 'gather') return { mode: 'gather' };
        if (d.opt === 'none') return { mode: 'none' };
        return { targets: t };
      /* A6 批次 29：嗅探（targets＝至多 2 名）；窃听报告（opt＝'gN'/'none'，text＝改写覆盖）。 */
      case 'sniff':         return { targets: t };
      case 'wiretapReport': return { opt: d.opt || 'none', text: d.text || '' };
      case 'alienAct':  return { act: d.opt || 'none', targets: t };
      case 'doctor':    return { act: d.opt || 'none', targets: t, product: d.num };
      case 'xenoCure':  return { use: d.opt === 'yes' };
      case 'meeting':   return { call: d.opt === 'yes' };
      case 'vote':      return { target: t[0] != null ? t[0] : null };
      case 'clean':     return { do: d.opt === 'yes' };
      case 'talk':      return { text: d.text || '' };
      case 'will':      return { text: d.text || '' };
      /* v32：验票官专属发言（M-speech）此前未登记 → 玩家提交专属发言时被旧 default 静默吞成
         {}（正文恒缺失）。探测器（default throw）在回归冒烟中当场炸出——正是它该抓的东西。 */
      case 'speech':    return { text: d.text || '' };
    }
    /* v32（isHuman 语义收窄 · 探测器）：default 从静默 `return {}` 改为立刻失败——
       上一处缺 case（inviteAccept/chat）曾让真人私聊 100% 静默失效，断言全绿、只能靠游玩撞见。
       新增步骤/决策类型时若漏登记 case，这里当场炸出来，而不是留一处新的静默歧视。 */
    throw new Error('toDecision: 未登记的决策类型 kind=' + kind + '（真人表单会被静默吞掉，必须显式登记）');
  }

  /* ============ 步骤定义 ============ */
  /* ============ 步骤定义表 STEPS：已解耦至 js/engine/steps.js（工厂注入）============
     1165 行 / 26 个步骤条目在 steps.js；本文件末尾用全部顶层作用域名注入工厂。
     STEPS 的对外导出与全部读取点（beginStep / finishStep / stepOnce / Engine.STEPS）零改动。 */
  let STEPS = null;

  /* ============ 投票结算 ============ */
  function resolveVote(g, isMeeting) {
    const voters = alive(g);
    g.voteSources = {};
    const counts = {};
    for (const v of voters) {
      const d = g.decisions[v.id];
      const t = d && d.target != null ? d.target : null;
      v.lastVote = t;
      g.voteSources[v.id] = t;
      if (t != null) counts[t] = (counts[t] || 0) + 1;
      god(g, `${v.id} 号 投给 ${t == null ? '（弃票）' : t + ' 号'}`);
    }
    const total = Object.keys(counts).reduce((a, k) => a + counts[k], 0);
    (g.voteHistory = g.voteHistory || []).push({ night: g.night, round: isMeeting ? '会议' : '白天', src: Object.assign({}, g.voteSources) });
    /* R64 投票声明对账第一段：宣称投 X 而 X 零票 → 必定撒谎 +25（得票数为⑨公开信息） */
    if (global.AI.onVoteSettle) global.AI.onVoteSettle(g, counts);

    let out = null;
    const keys = Object.keys(counts);
    /* ⑨ 公示：总票数 + 每名被投玩家的得票数（票数公开；票源仍仅验票官可见） */
    const detail = keys.slice().sort((a, b) => counts[b] - counts[a])
      .map(k => `${k} 号 ${counts[k]} 票`).join('、');
    const abstain = voters.length - total;
    announce(g, '⑨', `本轮投票总票数：${total}（弃票 ${abstain}）。得票：${detail || '无人得票'}`);
    if (keys.length) {
      const max = Math.max(...keys.map(k => counts[k]));
      const tops = keys.filter(k => counts[k] === max);
      if (tops.length === 1 && max >= 2) out = +tops[0];
    }
    if (out != null) {
      const p = P(g, out);
      p.out = true; p.outType = 'vote'; p.outNight = g.night;
      /* B5：驱逐揭示走统一服务（2.3.4：真实阵营＋呈现职业＋真实职业）；B2 删原职业标注。
         C6（2026-10-04）：公告文案改由揭示服务出参拼装——真实职业走独立槽位 trueRole，
         与已删除的「原职业 originRole」物理分离（originRole 属转职史，2.8.12④ 已删）。 */
      Reveal.reveal(g, p, 'expel');
      const er = Reveal.checkResult(p, 'expel');
      /* P1-a 公告 IR：节点由揭示出参构造，模板渲染统一走 AnnounceIR */
      announce(g, '⑩', AIR.render(AIR.expel(er, D.FACTION[p.faction].name)));
    } else {
      announce(g, '⑩', '本轮无人被驱逐（未满足最高票 / 无平票 / 至少 2 票）。');
    }
    /* 会议夜（isMeeting）跳过步骤 11，投票结算即该夜最后节点，夜数兜底在此生效 */
    const w = checkWin(g, isMeeting ? 'vote' : null);
    if (w) endGame(g, w);
    return out;
  }

  /* ============ 实时讨论流 ============ */
  /* 每条公开发言在入库时即做 NLP 解析（sig 随条目存储）：
     UI 用它渲染「原意」小字翻译，AI 威胁度链用它做结构化反应 */
  function addTalk(g, id, text, kind, sig) {
    const s = sig || (global.NLP ? global.NLP.parse(text, { speaker: id }) : null);
    g.talks.push({ id, text });
    g.chatLog.push({ night: g.night, kind, id, text, sig: s });
  }

  /* 公开发言的唯一入口（玩家实时输入 / AI 流式发言共用）：
     内容处理全部交给结合层 Bridge —— 语言产出 Claim IR → 推理链 → 影响后续发言与投票行为。 */
  function talk(g, pid, text, accuseId, askId) {
    const p = P(g, pid);
    /* §8.1 验票官专属发言期间：其余玩家禁言 */
    if (g.step === 'M-speech' && (!p || p.role !== 'inspector')) return false;
    if (!p || p.out) return false;
    /* 只点质询、无正文：自动合成质询句 */
    if ((!text || !text.trim()) && askId && askId !== pid)
      text = '质询 ' + askId + ' 号：请解释一下你的身份和行动。';
    if (!text || !text.trim()) return false;
    const clean = text.trim();
    const kind = g.step === 'M-talk' ? '会议' : g.step === 'D-open' ? '开局' : '讨论';
    /* 下拉菜单的点名（指控 / 质询）并入 IR，与文本解析结果合并处理 */
    const extra = [];
    if (global.IR) {
      const base = { speaker: pid, night: g.night, step: g.step, channel: 'public' };
      if (accuseId && accuseId !== pid) extra.push(global.IR.mk('accuse', [accuseId], { tier: 'hard' }, base));
      if (askId && askId !== pid) extra.push(global.IR.mk('ask', [askId], {}, base));
    }
    if (global.Bridge) return global.Bridge.say(g, pid, clean, { kind, extra, markTarget: accuseId });
    addTalk(g, pid, clean, kind);                      // Bridge 缺失时的兜底
    return true;
  }

  /* 驱动按 elapsedMs 调用：让 AI 依排程逐条发言，返回本 tick 是否有新发言 */
  function streamPump(g, elapsedMs) {
    const s = g.stream;
    if (!s) return false;
    let said = false;
    while (s.idx < s.speakers.length) {
      const sp = s.speakers[s.idx];
      if (elapsedMs < sp.at) break;
      const p = P(g, sp.pid);
      if (p && !p.out && alive(g).length > 1) {
        const kind = g.step === 'M-talk' ? '会议' : '讨论';
        const text = global.AI.speak(g, p);            // speak 同时产出 p.outClaims（说话意图）
        if (global.Bridge) {
          /* AI 发言与玩家发言同管道：Claim IR → 推理链 → 后续行为 */
          global.Bridge.say(g, p.id, text, { kind, claims: p.outClaims, aiSource: true });
        } else {                                        // 兜底：旧的直连路径
          addTalk(g, p.id, text, kind);
          if (p.lastAccuse) { global.AI.onAccuse(g, p.id, [p.lastAccuse]); p.lastAccuse = null; }
          if (p.lastAsk != null) {
            const target = P(g, p.lastAsk);
            if (target && !target.out) global.AI.onAsk(g, p.id, [p.lastAsk]);
            if (target && !target.out && !target.isHuman) {
              const ans = global.AI.answerQuestion(g, target, p.id);
              addTalk(g, target.id, ans.text, kind);
              global.AI.evaluateAnswer(g, target, ans.quality);
            } else if (target && target.isHuman) {
              g.pendingAsk = { night: g.night, target: target.id, asker: p.id };
            }
            const key = p.id + ':' + p.lastAsk + ':' + g.night;
            g.askTally = g.askTally || {};
            g.askTally[key] = (g.askTally[key] || 0) + 1;
            p.lastAsk = null;
          }
        }
        global.AI.updatePublicThreat(g);
        said = true;
      }
      s.idx += 1;
    }
    return said;
  }

  /* ============ 驱动 ============ */
  function beginStep(g, step) {
    g.step = step;
    g.decisions = {};
    g.pendings = {};
    g.pending = null;
    g.stepSkipped = false;
    const def = STEPS[step];
    const hasReq = !!def.req;                        // 自动结算步（0.55/4b/9/11）无 req，必须照常执行
    const reqs = hasReq ? def.req(g) : [];
    /* 0.4「无决策权跳过」：本步定义了决策者但全员已出局/无权限（且非实时讨论步）→ 整步跳过，0 秒推进 */
    if (hasReq && reqs.length === 0 && !def.stream) {
      /* T19：变体/未实装步位静默（PLACEHOLDER_STEPS，见其定义处的口径说明） */
      if (!PLACEHOLDER_STEPS[step]) log(g, `步骤 ${step}（${STEP_NAME[step] || step}）无决策者，整步跳过。`, 'info');
      g.stepSkipped = true;
      return false;
    }
    const humSet = new Set(g.humans && g.humans.length ? g.humans : [g.humanId]);
    let tm = D.STEP_TIME[step] || {};
    /* B 类运营参数覆盖：会议次日讨论减半至 90 秒（§5.7）；决斗时刻行动决策 10 秒并行（§5.3.2） */
    if (step === 'D-talk' && g.talkHalved) tm = Object.assign({}, tm, { duration: 90 });
    if (g.duel && (step === '5' || step === '7')) tm = Object.assign({}, tm, { duration: 10 });
    for (const r of reqs) {
      if (humSet.has(r.pid) && (!P(g, r.pid).out || def.allowOut)) {
        const f = def.form(g, P(g, r.pid));
        f.kind = r.kind; f.pid = r.pid;
        f.duration = tm.duration || 0;
        f.auto = tm.auto || false;
        f.stream = !!def.stream;
        f.allowOut = !!def.allowOut;
        g.pendings[r.pid] = f;
      } else {
        g.decisions[r.pid] = global.AI.decide(g, r);
      }
    }
    /* AI「分散提交」模拟：用于提前跳秒与「决策中 N 人」显示（显示方案 0.4/1.1） */
    const aiN = Object.keys(g.decisions).length;
    g.aiTotal = aiN;
    g.aiSubmitAt = aiN ? (0.3 + g.rng.next() * 0.45) * (tm.duration || 30) * 1000 : 0;
    if (def.stream) {
      /* AI 发言排程：在窗口的前 3/4 时段内逐条出现（soloTalk = 专属发言，无 AI 发言） */
      const speakers = def.soloTalk ? [] : alive(g).filter(p => !humSet.has(p.id)).map(p => p.id);
      g.rng.shuffle(speakers);
      const win = (tm.duration || 60) * 1000;
      const n = speakers.length;
      g.stream = {
        idx: 0,
        speakers: speakers.map((pid, i) => ({ pid, at: ((i + 0.6) / (n + 0.9)) * win * 0.75 })),
      };
      g.talks = [];
      if (!Object.keys(g.pendings).length) streamPump(g, Infinity);   // 无人（观战）时一次性完成发言
    }
    if (step === 'D-talk') g.talkHalved = false;   // 减半只作用于会议次日这一次讨论
    const ids = Object.keys(g.pendings);
    if (ids.length) g.pending = g.pendings[ids[0]];   // 兼容单机（取首个待决策席位）
  }

  function finishStep(g) {
    const def = STEPS[g.step];
    if (def && def.run) def.run(g);
    g.stepDone = g.step;
  }

  function pendingCount(g) { return Object.keys(g.pendings || {}).length; }

  /* elapsedMs 内已"提交"决策的 AI 数量（决策中人数显示用） */
  function decisionProgress(g, elapsedMs) {
    const total = g.aiTotal || 0, at = g.aiSubmitAt || 0;
    const ready = !total || elapsedMs >= at ? total : Math.floor(total * elapsedMs / at);
    return { ready, total };
  }

  function stepOnce(g) {
    if (g.over || pendingCount(g)) return;
    if (!g.queue.length) {
      nextPhase(g);
      if (g.over || !g.queue.length) return;
    }
    const step = g.queue.shift();
    if (beginStep(g, step) === false) { g.stepDone = step; return; }   // 无决策者：整步跳过，不执行 run
    if (!pendingCount(g)) finishStep(g);
  }

  /* 记录某席位决策（不结算）；全员提交即跳秒 */
  function setDecisionFor(g, pid, data) {
    const f = g.pendings && g.pendings[pid];
    if (!f) return false;
    g.decisions[pid] = toDecision(f.kind, data);
    delete g.pendings[pid];
    if (pid === g.humanId) g.pending = null;
    return true;
  }

  function setDecision(g, data) {
    const ids = Object.keys(g.pendings || {});
    if (!ids.length) return false;
    return setDecisionFor(g, +ids[0], data);
  }

  function submit(g, data) {
    const ids = Object.keys(g.pendings || {});
    if (!ids.length) return;
    setDecisionFor(g, +ids[0], data);
    if (!pendingCount(g)) finishStep(g);
  }

  function finishIfReady(g) {
    if (!g.over && !pendingCount(g) && g.step) finishStep(g);
  }

  /* A21（批次〇，2.3.0）：开局职业公告——「本局全部职业构成：各职业名称及其人数」。
     构成数据与 H21 查证池同源（compositionOf 读 originRole||role，本函数同字段计数），
     防两处漂移；不含任何编号归属（2.3.0③），此后不随出局/变形/转职更新（2.3.0⑤）。
     外星人变体注记在 A17（局变体配置）实装前固定为「经典」，届时改为声明驱动。 */
  function openingRosterText(g) {
    const comp = {};
    for (const r of ACT.compositionOf(g)) comp[r] = 0;   // 与查证池同源的本局构成（去重集合）
    for (const p of g.players) {
      const r = p.originRole || p.role;
      if (r in comp) comp[r] += 1;
    }
    const parts = [];
    for (const k of RD.keys()) {
      if (!comp[k]) continue;
      parts.push(`${RD.ROLE_DECL[k].name}×${comp[k]}`);
    }
    return `开局职业公告：${parts.join('、')}；外星人变体：经典。本公告不含编号归属，此后不随出局、变形、转职更新（2.3.0）。`;
  }

  /* 开局公开讨论（2.3）：第 1 夜前全场唯一一次无投票讨论 */
  function begin(g) {
    g.phase = 'open';
    g.night = 0; g.day = 0;
    /* A21（批次〇，2.3.0①）：职业选定完毕后、开局公开讨论之前，系统一次性公告。
       步位临时置 '〇'——公告的 (步位,批次) 组合与事件族契约 STEPS 登记完全对齐，
       步位×批次一致性审计按实测命中。 */
    g.step = '〇';
    announce(g, '〇', openingRosterText(g));
    g.step = null;
    g.queue = ['D-open'];
    if (global.AI) global.AI.updatePublicThreat(g);   // 开局即有威胁度共识基准
    log(g, '—— 开局公开讨论（无投票、无公告，仅发言）——', 'info');
  }

  /* 依赖注入：把本文件的顶层作用域交给工厂，装配出 STEPS（顺序与拆分前一致） */
  STEPS = global.EngineSteps({
    D,
    NORMAL,
    EXTINCT,
    DUEL,
    STEP_NAME,
    NIGHT_CAP,
    alive,
    aliveF,
    P,
    canAct,
    ANN,
    log,
    announce,
    priv,
    god,
    applyThreat,
    banner,
    applyLethal,
    applyInfection,
    clearInfection,
    doTransfer,
    grants,
    nextNight,
    orderedPlayers,
    startDay,
    nextPhase,
    updatePhases,
    checkWin,
    endGame,
    formPlayers,
    toDecision,
    STEPS,
    resolveVote,
    addTalk,
    talk,
    streamPump,
    beginStep,
    finishStep,
    pendingCount,
    decisionProgress,
    stepOnce,
    setDecisionFor,
    setDecision,
    submit,
    finishIfReady,
    begin,
  });

  global.Engine = {
    STEP_NAME, NORMAL, EXTINCT, DUEL, STEPS, NIGHT_CAP,
    begin, stepOnce, submit, setDecision, setDecisionFor, toDecision, pendingCount, finishIfReady,
    talk, streamPump, decisionProgress,
    alive, aliveF, P, canAct, checkWin, nightCapDraw, updateQueue, log, announce, priv, god, grants,
    /* 〔批次 31〕applyLethal/applyInfection 导出：抵挡层序（2.8.2⑤ 双计数独立、4.10.5 完整层序、
       4.6.4③ 毒伤层序反常）的断言需要直调结算入口——此前层序只能经步骤处理器间接覆盖，
       毒伤「仅全额减免可挡」这类反常层序无法被常规对局稳定触发到。 */
    applyLethal, applyInfection,
  };
})(typeof window !== 'undefined' ? window : globalThis);
