/* =============================================================
 * 太空杀 · 推理层配置与专家注册表（自 js/infer/moe.js 解耦，v27 模块化第二批）
 *
 * 内容：档位序 RANK · 专家表 EXPERTS · 硬路由 HARD_ROUTE · 相关性 RELEVANCE ·
 *       闸门表 GATES · 门槛 BASE_GATE / THETA_BIAS · gateThreshold()
 * 性质：纯配置与纯函数（专家表的 run/handle 只接收 (g, evt, self) 并返回 Claim），
 *       不含运行时状态；路由器 / 仲裁 / 影子 / 通道执行器仍留在 js/infer/moe.js。
 * 依赖：仅 global.Tiers。
 * ============================================================= */
(function (global) {
  const T = global.Tiers;
  /* 档位序：三档仲裁的比较基准。v28 新增 D--（专用最弱档，见 tiers.js SCORE 注释），
     排在 D- 之下、F 之上——它仍是「有方向的证据」，不是零值语义标记。 */
  const RANK = { 'A+': 13, 'A': 12, 'A-': 11, 'B+': 10, 'B': 9, 'B-': 8, 'C+': 7, 'C': 6, 'C-': 5, 'D+': 4, 'D': 3, 'D-': 2, 'D--': 1, 'F': 0 };

  /* ============ 13 专家注册表（§6.1 映射表）============
     E13 不是独立专家，是「同一批专家跑第二遍」的模式标记（§2.2 影子层）。
     const = 常驻专家（E9 一致性 / E10 威胁评估）几乎总激活。 */
  const EXPERTS = {
    E1:  { name: '破坏分析',  channels: 'N01~N130',        constant: false },
    E2:  { name: '感染分析',  channels: 'N131~N170',       constant: false },
    E3:  { name: '票型分析',  channels: 'N171~N220',       constant: false },
    E4:  { name: '查验分析',  channels: 'A01/A02/A12/A13', constant: false },
    E5:  { name: '维修分析',  channels: 'A07/A10/A18',     constant: false },
    E6:  { name: '死亡分析',  channels: 'A05/A14',         constant: false },
    E7:  { name: '承诺追踪',  channels: 'A01/A02/N336/N337', constant: false },
    E8:  { name: '身份推断',  channels: 'B01~B20 宣称总量对账 + N263~N281 结构事实（v33 修正：A10/A11/A16 总表实归 E7）', constant: false },
    E9:  { name: '一致性校验', channels: 'Z 档 N282~N301',  constant: false, relevance: 0.55 },
    E10: { name: '威胁评估',  channels: '汇聚层',           constant: false, relevance: 0.50 },
    E11: { name: '社会网络',  channels: 'N302~N322/D01/D11/D17/N270/C25/C50', constant: false },
    E12: { name: '元认知',    channels: '性格观测/噪声自检', constant: false },
    E13: { name: '自我镜像',  channels: 'N221~N262/N324~N335（影子模式标记）', constant: false },
  };

  /* ============ 硬路由（§4 层一）：事件 → 必激活专家，静态表 ============ */
  const HARD_ROUTE = {
    '④': ['E5', 'E8'],        // 维修暴露
    '⑤': ['E1', 'E5'],        // 破坏者暴露
    '⑥': ['E6'],              // 死亡揭示
    '⑩': ['E3', 'E6'],        // 驱逐揭示
    '①': ['E11'],             // 私聊配对公告
    'reveal': ['E6'],   // 揭示结算：死亡分析必激活（方案 §4 硬路由仅列 ⑥）；其余专家软路由
    'pm': ['E11'],            // 私聊频道
  };

  /* ============ 软路由（§4 层二）：专家对事件类型的相关度 0~1 ============
     批次 5 通道录入后由各专家真实 gate 替换；当前为静态相关度表 + 少量已实现的
     结构化 gate（E7：场上无承诺 → 0）。
     v26 注释清理：删去「个体阈值偏移（±0.12）」与「重合度 0.3~0.6 健康区间的结构保证」两处
     失效表述——±0.12/±0.40 个体偏移已在 v25 批次 1 随 ID 哈希一并删除，铺值不再是「设靶」产物。
     当前口径：相关度是专家对事件类型的静态先验，个体差异只能来自 gate 读到的真实状态差异 + θ 调制；
     指标只观测不设靶（不设健康区间、不进 gate、只进 mc_result.json）。 */
  const RELEVANCE = {
    '④':  { E1: 0.46, E2: 0.44, E3: 0.50, E4: 0.47, E5: 1.0, E6: 0.44, E7: 0.45, E8: 0.56, E11: 0.46, E12: 0.50 },
    '⑤':  { E1: 1.0, E2: 0.47, E3: 0.50, E4: 0.44, E5: 1.0, E6: 0.53, E7: 0.45, E8: 0.52, E11: 0.46, E12: 0.50 },
    '⑥':  { E1: 0.44, E2: 0.53, E3: 0.50, E4: 0.44, E5: 0.42, E6: 1.0, E7: 0.45, E8: 0.55, E11: 0.53, E12: 0.50 },
    '⑩':  { E1: 0.44, E2: 0.44, E3: 0.55, E4: 0.44, E5: 0.42, E6: 0.56, E7: 0.45, E8: 0.52, E11: 0.54, E12: 0.50 },
    'reveal': { E1: 0.44, E2: 0.50, E3: 0.60, E4: 0.55, E5: 0.42, E6: 1.0, E7: 0.45, E8: 0.62, E11: 0.53, E12: 0.50 },
    '①':  { E1: 0.42, E2: 0.42, E3: 0.47, E4: 0.42, E5: 0.42, E6: 0.42, E7: 0.50, E8: 0.42, E11: 1.0, E12: 0.47 },
    'pm': { E1: 0.42, E2: 0.42, E3: 0.47, E4: 0.42, E5: 0.42, E6: 0.42, E7: 0.53, E8: 0.42, E11: 1.0, E12: 0.47 },
  };
  /* E7 承诺追踪（§4 例子）：场上无承诺 → gate = 0 */
  const GATES = {
    E7: (g) => (g.players || []).some(p => (p.promises || []).length) ? 0.8 : 0,
  };

  /* ============ 性格调制（§4 层三）：gate 阈值按 θ 偏移 ============
     激进 E7/E8 阈值低（更易激活），保守 E9/E10 阈值低；常驻专家不受调制 */
  const BASE_GATE = 0.5;
  const THETA_BIAS = { E7: { 25: -0.15, 50: 0, 75: 0.15 }, E8: { 25: -0.15, 50: 0, 75: 0.15 }, E9: { 25: 0.10, 50: 0, 75: -0.10 }, E10: { 25: 0.10, 50: 0, 75: -0.10 } };
  function gateThreshold(expert, self) {
    const bias = (THETA_BIAS[expert] || {})[self && self.theta] || 0;
    return Math.max(0, Math.min(1, BASE_GATE + bias));
  }
  /* ============ v32 批 5′：角色专家注册表（R01~R13，13 席 = 引擎角色键 1:1）============
     方案 §4.1 写「16 席（13 初始 + 3 转职）」，但引擎 ROLES 恰是 13 个角色键
     （10 初始 + 3 转职系），方案的「16」内部计数不一致——按交接文档 §1.2/§9.1 裁定：
     以角色键 1:1 落 13 席开工，差额（异形按进化方向拆分？）留待拍板。
     转职 = 换眼睛 + 留记忆（规则 118/120）：doTransfer 改写 p.roleExpert（挂载新角色专家、
     卸载原职业的），已入账的 p.tEvents 不删除。
     私有源（source 列）= 分叉度的全部来源（方案 §4.1：「这 16 个私有源就是分叉度的全部来源」）。 */
  const ROLES_EXPERTS = {
    R01: { role: 'crew',      name: '普通船员',   source: '查验二选一（弱）· 维修人数 N（4.1）' },
    R02: { role: 'detective', name: '神探',       source: 'checkPool 已查验池（4.7）' },
    R03: { role: 'sheriff',   name: '警长',       source: '巡逻结果 · 子弹/悬赏流水（4.4）' },
    R04: { role: 'bodyguard', name: '保镖',       source: '受袭感知：伤害类型三分（4.8）' },
    R05: { role: 'bio',       name: '生化医师',   source: '抗体生效反馈（P15）· 标记记忆（4.5）' },
    R06: { role: 'rescue',    name: '救援医师',   source: '当夜全场濒死名单（P13）' },
    R07: { role: 'inspector', name: '验票官',     source: '票源（票型记录，2.3）' },
    R08: { role: 'engineer',  name: '工程师',     source: '累计维修量 · 距暴露阈值 · 已暴露态（4.3）' },
    R09: { role: 'alien',     name: '异形',       source: '队友互认 · 标记清单可辨真伪（3.3④）· attackLog' },
    R10: { role: 'xeno',      name: '外星人',     source: '蛰伏查验结果 · 夜晚免疫/感染治疗额度（7.2.4）' },
    R11: { role: 'armed',     name: '武装船员',   source: '子弹/悬赏 · 警长编号（规则 138 双向识别）' },
    R12: { role: 'assistant', name: '助理工程师', source: '累计维修量 · 距 3.0 阈值（规则 130，阈值独立）' },
    R13: { role: 'tempdoc',   name: '临时医生',   source: '当夜濒死名单（P13）' },
  };

  /* ============ v32 批 7′ 前置：通用专家 G1~G8（方案 §4.2，与 E 组的合并映射）============
     正交分解（方案 §3.1）：角色专家 = 视角（这件事要不要进我的账，R01~R13，批 5′ 挂载）；
     通用专家 = 推理方法（进账后怎么解读）。方法维度对谁都适用，故映射到既有 E 组的执行资产
     （GATE_IMPL 通道执行器就是「专家产出 Claim」的运行形态）；E12 元认知当前 0 条资产（空席），
     资产定义留待标定（交接文档 §9.3）。 */
  const G_EXPERTS = {
    G1: { name: '时序一致性', maps: ['E9', 'E7'], asset: '承诺↔兑现（settle/promiseMiss）· 宣称↔后续行为' },
    G2: { name: '社会网络',   maps: ['E11', 'E3'], asset: '指控链 · 私聊配对 · 跟票（N302~N322）' },
    G3: { name: '生死账本',   maps: ['E6', 'E4'], asset: '⑥⑩揭示 · 死因对账 · 存活数（A05/A14）' },
    G4: { name: '物理资源',   maps: ['E1', 'E5'], asset: '破坏量/维修量/倒计时/停转夜（N01~N130/A07）' },
    G5: { name: '感染流',     maps: ['E2'],        asset: '标记出现/消失/致死（N131~N170）' },
    G6: { name: '身份锚定',   maps: ['E8', 'E10'], asset: '硬源对账（A10/A11/A16 + 汇聚层）' },
    G7: { name: '反事实（影子）', maps: ['E13'],   asset: '「我这样做会暴露什么」——影子层第二遍运行' },
    G8: { name: '元认知',     maps: [],            asset: '空席：0 条通道资产，待定义性格观测/噪声自检判据（§9.3）' },
  };

  global.MoERegistry = {
    RANK, EXPERTS, HARD_ROUTE, RELEVANCE, GATES, BASE_GATE, THETA_BIAS, gateThreshold,
    ROLES_EXPERTS, G_EXPERTS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
