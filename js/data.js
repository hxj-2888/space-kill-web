/* 角色 / 职业静态数据 */
(function (global) {
  /* 阵营声明（D2 开放维度 / D5 命名空间隔离，v6.6 阶段 2）
     · hostileTo：该阵营视角下的「敌对阵营集合」——敌对度 = Σ 这些阵营的分布概率。
       迁移自 belief.js hostileOf 的三个写死分支（人类→异形+外星人；异形→人类+外星人；
       外星人→仅异形，即外星人不以人类为敌对），逐项等价；新增第四阵营只改本表。
     · order/short/barCls：阵营的展示元数据（UI 不再写死「异/外/人」与条形类名）。
     · 键集 = 分布的全部维度（belief 的 fallback 按本表长度动态计算，不再写死 1/3）。 */
  const FACTION = {
    human: { key: 'human', name: '人类',   cls: 'f-h', order: 3, short: '人', barCls: 'bh',
             hostileTo: ['alien', 'xeno'] },
    alien: { key: 'alien', name: '异形',   cls: 'f-a', order: 1, short: '异', barCls: 'ba',
             hostileTo: ['human', 'xeno'] },
    xeno:  { key: 'xeno',  name: '外星人', cls: 'f-x', order: 2, short: '外', barCls: 'bk',
             hostileTo: ['alien'] },
  };

  /* D1 单一真相源（v6.6 阶段 2）：ROLES / HUMAN_BASE_ROLES / HUMAN_SETUP 全部由
     v66 角色声明表派生（js/v66/declaration/roleDecl.js，C2 附录 C 九关 schema）。
     本文件不再持有任何角色属性字面量——**加角色只改声明层，本文件 diff 为空**（K1/H1 验收）。 */
  const RD = global.SKRoleDecl;

  const ROLES = {};
  for (const k of RD.keys()) {
    const d = RD.ROLE_DECL[k];
    ROLES[k] = { name: d.name, faction: d.faction, desc: d.desc };
  }

  /* 普通船员查验用的「有效排除池」＝ 4.1.1① 开局公告之人类职业
     （由 faction + isBase 推导，取代此前的 8 项硬编码；失效后果曾是「新人类职业
     静默不进查证池，游戏照跑没人发现」——D 组最阴的一类框死点）。 */
  const HUMAN_BASE_ROLES = RD.baseHumanRoles();

  /* A4/H5（2026-10-04）：名字供给与扩展池。NAMES 恒为 15 项（正文 2.3.0②附二
     「玩家共 15 人」为结构常量；**数组长度参与 createGame 的 rng.shuffle 消耗序列**，
     长度一变全流后移，故扩展名不得并入本数组——曾因此使种子敏感断言全数漂移）。
     NAMES_EXTRA 供未来席位扩充时 concat 使用（H5：名字供给不设瓶颈、不重名）。 */
  const NAMES = ['星尘', '银翼', '北极', '磷火', '铁砧', '罗盘', '苍鹭', '玄武岩', '游隼',
                 '回声', '子夜', '砂岩', '灯塔', '青霜', '归零'];
  const NAMES_EXTRA = ['远航', '寒鸦', '孤帆', '残响', '蚀刻', '晨昏', '界限', '纬线', '星图',
                       '暗涌', '浮标', '季风', '棱镜', '坠点', '静默', '余烬', '逆旅', '浮空',
                       '折返', '镜面'];

  /* A3：组位表驱动（2.8.14 组位表逐项）＝基础位 4 + 工程位 1 + 猎杀位 1 + 医生位 2 +
     查证位 1 + 防御位 1 + 社交位 1，共 11 席。取代此前的 11 项硬编码字面量。 */
  const HUMAN_SETUP = RD.humanSetup();

  /* A2 双口径（v6.6 2.8.4 / 4.10.6）：
     DAMAGE_TYPE —— 伤害类型四种，受袭感知（4.8.3）与「感染不属伤害」判定用；
     CAUSE_NAME  —— 调查报告致死来源五类，含感染与中毒单列（4.10.6）。
     毒师（A6）未实装前 poison 无产生点，但口径先立。 */
  const DAMAGE_TYPE = { alien: '异形出刀', xeno: '外星人出刀', gun: '枪击', poison: '中毒' };
  const CAUSE_NAME = { alien: '异形出刀', xeno: '外星人出刀', gun: '枪击', infect: '感染', poison: '中毒' };

  /* B 类运营参数：各决策窗口秒数（显示方案 5.1 的「典型」值，可标定调整）。
     duration 为该步开窗时长；auto 表示无输入的自动结算展示时长（可点继续跳过）。 */
  const STEP_TIME = {
    /* 夜间决策窗口（B 类运营参数，上限值）——步位对齐 v6.6 2.1.1（A7，2026-10-03）：
       新增前置子阶段与 0.1/0.2/3.5 窗口（A5）；0.7/1b/2b/D-clean 随步位重排移除 */
    'P-id': { duration: 20 }, 'P-clean': { duration: 10 },
    '0a': { duration: 15 }, '0b': { duration: 15 }, '0c': { duration: 30 },
    '0.1': { duration: 30 }, '0.1s': { duration: 20 }, '0.2': { duration: 15 },
    '0.5': { duration: 15 }, '0.6': { duration: 30 },
    '1': { duration: 15 }, '2': { duration: 30 },
    '3': { duration: 15 }, '3.5': { duration: 15 }, '4a': { duration: 25 }, '4b': { duration: 12, auto: true },
    '5': { duration: 15 }, '6': { duration: 22 }, '7': { duration: 25 },
    '8': { duration: 25 }, '9': { duration: 0, auto: 10 },
    '10': { duration: 20 }, '11': { duration: 0, auto: 8 },
    '0.55': { duration: 0, auto: 6 },
    'M-talk': { duration: 150 }, 'M-vote': { duration: 30 }, 'M-speech': { duration: 30 },
    'D-open': { duration: 60 },
    'D-will': { duration: 30 }, 'D-talk': { duration: 180 },
    'D-report': { duration: 20 },   // A6 批次 29：窃听报告提交窗口（条件性阶段）
    'D-vote': { duration: 30 },
  };

  global.SKData = { FACTION, ROLES, HUMAN_BASE_ROLES, NAMES, NAMES_EXTRA, HUMAN_SETUP, DAMAGE_TYPE, CAUSE_NAME, STEP_TIME };
})(typeof window !== 'undefined' ? window : globalThis);
