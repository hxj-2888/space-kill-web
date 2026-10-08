/* =============================================================
 * 太空杀 · 进程注册表（v6.6 重构 C11 · 阶段 2 声明层）
 *
 * 职责：把 2.9「资源生产通则（进程型产出）」落成**数据**——凡「投入若干夜晚、完成后产出
 *       固定一份」的机制都在此声明；执行层只跑通用进程状态机，不认识任何具体机制名。
 *
 * 规则依据（v6.6 正文，唯一权威源）：
 *   · 2.9① 适用范围 —— 判据仅为「投入—完成—产出」形态本身，不问阵营/职业/行动位；
 *          现行合此形态者：制药（3.3.1）、猎手攒弹（4.4.7②）、工匠铸造（4.11.2①、①之二）
 *   · 2.9② 进度记账 —— 仅记「已投入几个夜晚」，不记产物选择、不锁定后续夜晚之选择
 *   · 2.9③ 可中断 —— 各投入夜不必连续；中断夜可正常执行其他行动；进度保留、不清零、不回退
 *   · 2.9 完成时定产物 + 次夜到账 —— 产物于完成后的次夜发放（3.3⑨）
 *
 * 纪律：进程引擎（js/v66/execution/process.js）只读本表字段，**加进程只改本文件**
 *       （断言 H26：新增进程后引擎 diff 为空）。产物被声明为「资源增量 + 文案标签」，
 *       故连产物效果都不需要新代码。
 *
 * 〔2026-10-05 规则方裁决 · 已解除留档〕工匠铸造分为两个选择（4.11.2① 常规 / ①之二 速成），
 *       两条已按 2.9④「投入夜数不同的两个独立进程」登记为 cast / castFast，并以 exclusiveGroup
 *       表达 2.9⑤ 的同组互斥；速成护甲的 4 夜期限以 ttl 声明（到期消费随 artisan 实装）。
 * ============================================================= */
(function (global) {
  /* 资源标签：产物到账文案由「资源键 → 中文名」生成（避免为每个产物写一条消息模板） */
  const RESOURCE_LABELS = {
    rescueLeft: '救援',
    cureLeft: '治疗',
    healLeft: '治疗',
    bullets: '子弹',
    nightImmune: '夜晚免疫',
    armorStock: '常规护甲',        // 4.11.2① 存续型
    fastArmorStock: '速成护甲',    // 4.11.2①之二 限期型（ttl=4）
  };

  const PROCESSES = {
    /* 制药（3.3.1）：医生族通用进程；放弃 2 个夜晚的行动，两夜可不连续、中断不回退；
       产物以**完成时**之选为准（3.3③）；产物于次夜到账（3.3⑨）。
       T22 修正（2026-10-05 文本审查第二遍）：owner 由 ['bio'] 修正为医生族全体——
       正文 3.3 明文「医生＝生化医师、救援医师、毒师与临时医生的合称」，3.3.1 标题即
       「制药（医生通用·产出药剂）」，4.6.3 亦把制药列入救援医师的互斥清单 ⇒ 救援医师/
       临时医生制药是正文赋予的能力（审查「生化医师限定技」读法与正文冲突，按正文执行）。
       毒师（4.6.4② 继承制药）待 A6 实装时加入本表。 */
    brew: {
      id: 'brew',
      name: '制药',
      rule: '3.3.1 / 2.9',
      /* 〔v7 速查卡补充 · 2026-10-08〕补 poisoner：卡（毒师条·夜间行动）明载其步骤 8
         五选一含「制药」，且制药为医生族通有（3.3.1）。原 owner 漏 poisoner ⇒
         声明层 ROLE_DECL.poisoner.grants 含 'brew' 而进程引擎不认，声明与实现矛盾。
         潜伏缺陷：医生位开局席位固定 ['bio','rescue']（2.8.14 组位表 capacity 2），
         毒师不上场故当前不可观测；席位表一旦改为三选一即暴露。 */
      owner: ['bio', 'rescue', 'tempdoc', 'poisoner'],
      nights: 2,
      interruptible: true,
      exclusive: true,                       // 投入夜占用当夜出手（"放弃行动"）
      productChoices: ['rescue', 'heal'],
      defaultProduct: 'heal',                // 未指定产物时的缺省（与迁移前的 `d.product || 'heal'` 一致）
      products: {
        rescue: { rescueLeft: 1 },
        heal: { cureLeft: 2 },
      },
      /* 文案：与迁移前逐字一致（表单选项标签 / 进度私反馈标签 / 完成私反馈 / 到账私反馈模板） */
      messages: {
        choiceLabels: { rescue: '1 瓶救援药剂（+1 救援额度）', heal: '2 瓶治疗药剂（+2 治疗额度）' },
        shortLabels: { rescue: '救援药剂', heal: '治疗药剂' },
        progress: '制药进度 {n}/{nights}（{product}）。',
        complete: '制药完成：产物将于下一夜发放。',
        deliver: '制药产物到账：获得 {amount} 次{resource}额度。',
      },
      progressKey: 'brew',                   // 进行中状态挂在玩家对象的哪个键
      doneKey: 'brewDone',                   // 完成待发放状态（产物键）
      delivery: 'nextNight',                 // 次夜到账（2.9）
    },

    /* 猎手攒弹（4.4.7②）：固定投入 2 个夜晚且不必连续；投入夜不可开枪与嗅探；
       〔通则 4.4.6 之例外〕不受 2 发存储上限约束（登记于 2.8.9）。owner 待 A6 实装。 */
    gatherAmmo: {
      id: 'gatherAmmo',
      name: '攒弹',
      rule: '4.4.7② / 2.9',
      owner: ['hunter'],
      nights: 2,
      interruptible: true,
      exclusive: true,
      productChoices: ['bullet'],
      products: { bullet: { bullets: 1 } },
      messages: {
        choiceLabels: { bullet: '1 发子弹（不受 2 发存储上限约束）' },
        shortLabels: { bullet: '子弹' },
        progress: '攒弹进度 {n}/{nights}（{product}）。',
        complete: '攒弹完成：产物将于下一夜发放。',
        deliver: '攒弹产物到账：获得 {amount} 发{resource}。',
      },
      progressKey: 'gather',
      doneKey: 'gatherDone',
      delivery: 'nextNight',
    },

    /* 工匠铸造（4.11.2① 常规 / ①之二 速成）——**两个独立进程**（2.9④「投入夜数不同的两个
       独立进程」），〔2026-10-05 规则方裁决：工匠铸造分为两个选择〕此前本表留档「正文未明定固定
       投入夜数，不登记猜测值」，现役方定案，两条一并登记：
         · cast     常规铸造：投入 2 个夜晚产出 1 件常规护甲（存续型，未被消耗即一直留存）
         · castFast 速成铸造：投入 1 个夜晚产出 1 件速成护甲（限期型：铸造当夜为第 1 夜且不生效，
                      第 2、3 夜具保护功能，第 4 夜自动消失——**到期由 artisan 实装时消费**，
                      本表只负责产出，ttl 字段即该期限的声明）
       两夜/一夜均不必连续（2.9③ 可中断、进度保留不回退）；产出均于次夜到账（2.9）。
       〔2.9⑤ 独占性〕二者受同一独占性约束：同一时期仅可存在一个未完成进程，不得同夜并进——
       由 exclusiveGroup 声明，执行层通用校验（process.js），执行层不认识「铸造」这个机制名。
       〔4.11.3①〕库存上限 2 件，常规与速成**合并计算**（速成于存续期内持续占用），满仓再铸即浪费。
       owner 待 A6 实装 artisan 后接线（声明先行，与 gatherAmmo 同例）。 */
    cast: {
      id: 'cast',
      name: '常规铸造',
      rule: '4.11.2① / 2.9',
      owner: ['artisan'],
      nights: 2,
      interruptible: true,
      exclusive: true,
      exclusiveGroup: 'craft',                 // 2.9⑤：与速成铸造互斥（同一时期仅一个未完成进程）
      productChoices: ['normal'],
      products: { normal: { armorStock: 1 } },
      messages: {
        choiceLabels: { normal: '铸成 1 件常规护甲（存续型，不因夜末失效）' },
        shortLabels: { normal: '常规护甲' },
        progress: '铸造进度 {n}/{nights}（常规护甲）。',
        complete: '常规护甲铸成：将于下一夜入库，届时可分配。',
        deliver: '铸造产物到账：获得 {amount} 件常规护甲。',
      },
      progressKey: 'cast',
      doneKey: 'castDone',
      delivery: 'nextNight',
    },
    castFast: {
      id: 'castFast',
      name: '速成铸造',
      rule: '4.11.2①之二 / 2.9',
      owner: ['artisan'],
      nights: 1,                                 // 2.9④：N 由本项明定为 1（与常规铸造成两个独立进程）
      interruptible: true,                       // 1 夜进程无「中断」可言，保留字段仅为满足 2.9③ 的通用表达
      exclusive: true,
      exclusiveGroup: 'craft',                   // 2.9⑤：与常规铸造互斥
      /* ttl 自【投入夜】起算 4 夜（4.11.2①之二）——依 2.9⑦ 产物于完成次夜到账，故
         投入夜＝第 1 夜（当夜不生效，彼时护甲尚未到账）→ **到账夜恰为第 2 夜并开始生效** →
         第 2、3 夜生效、第 4 夜自动消失，**实际保护 2 夜**。此读法是唯一与 2.9 时序自洽者：
         若把「铸造当夜」读作到账夜，则到账夜不生效、生效期整体后移一夜，与「第 2、3 夜生效」
         的字面冲突。⚠ 正文此处「铸造当夜」与 2.9 术语体系（投入夜/到账夜）错位，已列为待裁决。 */
      ttl: 4,
      productChoices: ['fast'],
      products: { fast: { fastArmorStock: 1 } },
      messages: {
        choiceLabels: { fast: '铸成 1 件速成护甲（限期型：第 2、3 夜生效，第 4 夜消失）' },
        shortLabels: { fast: '速成护甲' },
        progress: '速成铸造进度 {n}/{nights}（速成护甲）。',
        complete: '速成护甲铸成：将于下一夜入库，届时可分配。',
        deliver: '铸造产物到账：获得 {amount} 件速成护甲。',
      },
      progressKey: 'castFast',
      doneKey: 'castFastDone',
      delivery: 'nextNight',
    },
  };

  const keys = () => Object.keys(PROCESSES);
  const get = id => PROCESSES[id] || null;
  /** 某角色的全部进程（owner 声明；未实装角色也有声明，便于 A6 直接接线） */
  function ofRole(roleKey) {
    return keys().filter(id => {
      const o = PROCESSES[id].owner;
      return (Array.isArray(o) ? o : [o]).indexOf(roleKey) >= 0;
    });
  }
  /** 产物到账文案（由「资源增量 + 资源标签」生成；无模板时返回 null，交由调用方兜底） */
  function deliverText(procId, product) {
    const d = PROCESSES[procId];
    if (!d) return null;
    const deltas = d.products[product];
    if (!deltas) return null;
    const [resKey, amount] = Object.entries(deltas)[0] || [];
    if (!resKey) return null;
    const tpl = d.messages.deliver;
    if (!tpl) return null;
    return tpl.replace('{amount}', String(amount))
      .replace('{resource}', RESOURCE_LABELS[resKey] || resKey);
  }

  /** 自检：返回违规清单（空数组＝合规） */
  function audit() {
    const bad = [];
    for (const id of keys()) {
      const d = PROCESSES[id];
      if (!d.id || d.id !== id) bad.push(`${id}: id 与键不一致`);
      if (!d.rule) bad.push(`${id}: 缺规则出处`);
      if (!(d.nights >= 1) || d.nights % 1 !== 0) bad.push(`${id}: nights 非法 ${d.nights}`);
      if (!d.productChoices || !d.productChoices.length) bad.push(`${id}: 缺产物选择`);
      for (const pc of (d.productChoices || []))
        if (!d.products || !d.products[pc]) bad.push(`${id}: 产物 ${pc} 无效果声明`);
      for (const [pk, deltas] of Object.entries(d.products || {}))
        for (const [rk, v] of Object.entries(deltas)) {
          if (typeof v !== 'number' || v <= 0) bad.push(`${id}: 产物 ${pk} 的资源增量非法（${rk}=${v}）`);
          if (!RESOURCE_LABELS[rk]) bad.push(`${id}: 资源 ${rk} 缺中文标签（到账文案无法生成）`);
        }
      if (!d.progressKey || !d.doneKey) bad.push(`${id}: 缺 progressKey/doneKey`);
      if (d.delivery !== 'nextNight') bad.push(`${id}: delivery 仅支持 nextNight（2.9 次夜到账）`);
      if (!d.progressKey || d.progressKey === d.doneKey) bad.push(`${id}: progressKey 与 doneKey 冲突`);
      /* 文案模板必须齐备（否则进程跑起来时静默缺句） */
      for (const f of ['progress', 'complete']) if (!d.messages || !d.messages[f]) bad.push(`${id}: 缺文案 ${f}`);
      /* 2.9⑤ 独占性：声明了 exclusiveGroup 就必须是同一非空串（执行层按串分组做通用校验） */
      if ('exclusiveGroup' in d && (typeof d.exclusiveGroup !== 'string' || !d.exclusiveGroup))
        bad.push(`${id}: exclusiveGroup 非法`);
      /* 限期型产物的有效期（4.11.2①之二 速成护甲：第 2、3 夜生效、第 4 夜消失） */
      if ('ttl' in d && (!(d.ttl >= 1) || d.ttl % 1 !== 0)) bad.push(`${id}: ttl 非法 ${d.ttl}`);
    }
    /* 2.9④：同一独占组内的进程必须是「投入夜数不同的独立进程」——若两进程 nights 相同，
       它们就不是 2.9④ 所说的两个进程，而是同一条被登记了两次（4.11.2① / ①之二 即 nights 2 与 1）。 */
    const groups = {};
    for (const id of keys()) {
      const grp = PROCESSES[id].exclusiveGroup;
      if (grp) (groups[grp] = groups[grp] || []).push(id);
    }
    for (const [grp, ids] of Object.entries(groups)) {
      const ns = ids.map(i => PROCESSES[i].nights);
      if (new Set(ns).size !== ns.length)
        bad.push(`独占组 ${grp}：进程投入夜数相同（2.9④ 要求为独立进程）→ ${ids.map((i, k) => `${i}=${ns[k]}`).join(' ')}`);
    }
    return bad;
  }

  global.SKProcess = { PROCESSES, RESOURCE_LABELS, keys, get, ofRole, deliverText, audit };
})(typeof window !== 'undefined' ? window : globalThis);
