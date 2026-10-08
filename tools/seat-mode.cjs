'use strict';
/* ============================================================================
 * 量测口径闸门 —— 「把席位变体接进量测」这一批的**唯一开关**。
 * 两条轴：① 席位口径（variants / classic）② 种子分区（calib / valid / report）。
 *
 * 病根（v7 交接文档 §4.1）：量测探针一律 Setup.createGame(seed,'random')，从不传
 * opts.seatPicks，而 rollSeatPicks 全仓只有 js/main.js（本地/UI 开局）调用 ⇒
 * 猎手 / 窃听者 / 毒师 / 工匠 / 死囚外星人这五个**已实装**角色在任何历史量测里都
 * 从未上场，约一半「角色@步骤」派发面从未被检验过。本模块让探针**显式传** seatPicks，
 * 把这条口径接回量测侧。
 *
 * 三条纪律（docs/防指标博弈治理规范.md 铁律一/五，另见 state.js:133-135 的既有约束）：
 *   1. **不改 createGame 的缺省值**。state.js 用**独立 RNG 流**保护「不传 seatPicks 的
 *      经典局逐字节同接入前」，正是为了让回归基线不漂移；改缺省会一次性漂掉全部种子敏感
 *      断言与行为指纹。故此处只改探针的调用方式，产品与回归套件一字不动。
 *   2. **口径显式**。SK_MEASURE_SEATS = variants（缺省，与本地/UI 真实开局一致）
 *      | classic（历史口径，仅供对照）。非法值抛错 —— 口径拼错不许静默回落到另一种。
 *      产品自带的退路 SK_SEAT_CLASSIC=1 同样被尊重（置 1 即强制 classic）。
 *   3. **口径进产物**。产物 meta 写 seatMode，artifactFor() 按口径给文件名，
 *      tools/verify-handover-doc.cjs 强制核对文档声称的口径与落盘产物一致
 *      —— 防的是两套口径的数字被混算（交接文档 §一 已列明三段种子分区不可混算，
 *      席位口径是同一条轴上的第二个分区维度）。
 *
 * 两种口径的关系（**不是两套平衡，是同一条随机流上的两种角色构成**）：
 *   席位替换发生在 rng.shuffle **之前**且不改变数组长度，rollSeatPicks 又走独立 RNG 流
 *   ⇒ 变体局与经典局的 g.rng 消耗序列**逐位相同**。所以两种口径可做严格 A/B：
 *   观测到的差异只可能来自角色本身，不可能来自组局抽选或洗牌漂移。
 * ========================================================================== */

const MODES = { CLASSIC: 'classic', VARIANTS: 'variants' };
const ENV = 'SK_MEASURE_SEATS';

/* 产品自带的退路（main.js:36）：置 1 即全经典。本模块尊重它，
   以免出现「产品退回经典、量测仍在量变体」这种两侧口径不一致的静默分叉。 */
function forced() {
  return process.env.SK_SEAT_CLASSIC === '1' || process.env.SK_SEAT_CLASSIC === 'true';
}

function seatMode() {
  if (forced()) return MODES.CLASSIC;
  const v = String(process.env[ENV] == null ? '' : process.env[ENV]).trim().toLowerCase();
  if (!v) return MODES.VARIANTS;                       // 缺省 = 变体（对齐本地/UI 真实开局）
  if (v === 'variants' || v === 'variant' || v === 'on' || v === '1') return MODES.VARIANTS;
  if (v === 'classic' || v === 'off' || v === '0') return MODES.CLASSIC;
  throw new Error(ENV + ' 只认 variants | classic（非法值不许静默回落）：' + v);
}

/* 探针建局用这一处，**不要**在探针里自己拼 opts —— 口径只有这里能决定。 */
function seatOpts(Setup, seed) {
  if (!Setup || typeof Setup.rollSeatPicks !== 'function')
    throw new Error('seat-mode: Setup.rollSeatPicks 不存在，不能决定席位口径');
  if (seatMode() === MODES.CLASSIC) return undefined;
  return { seatPicks: Setup.rollSeatPicks(seed) };
}

/* 建局并按 main.js:39 的方式留下本局席位构成（g.seatPicks），供探针做席位普查。
   经典口径下同样写 {} —— 「无变体」与「没量口径」是两件事，不许用 undefined 混过去。 */
function seatGame(Setup, seed, prefFaction) {
  const opts = seatOpts(Setup, seed);
  const g = Setup.createGame(seed, prefFaction || 'random', opts);
  g.seatPicks = (opts && opts.seatPicks) || {};
  return g;
}

/* 写进产物 meta 的口径标签 */
function seatTag() {
  return {
    seatMode: seatMode(),
    seatModeSource: forced() ? 'SK_SEAT_CLASSIC=1（产品退路，强制 classic）'
      : (process.env[ENV] ? ENV + '=' + process.env[ENV] : '缺省 variants（对齐本地/UI 真实开局）'),
  };
}

/* 产物文件名按口径分流：classic 沿用历史名（向后兼容既有产物与核对器），
   variants 加 -variants 后缀 —— 两套口径的数字不可能落进同一个文件。 */
function artifactFor(base) {
  return seatMode() === MODES.CLASSIC ? base + '.json' : base + '-variants.json';
}

/* 探针横幅用的一行口径说明 */
function note() {
  return seatMode() === MODES.VARIANTS
    ? '席位口径 = variants（探针显式传 Setup.rollSeatPicks(seed)，对齐本地/UI 真实开局）'
    : '席位口径 = classic（不传 seatPicks，历史量测口径，仅供对照）';
}

/* ── 种子分区（铁律四 · 种子隔离）───────────────────────────────────────────
   校准 1–120 / 验证 121–240 / 报数 241–500，三段分别报、不可混算。
   放在本模块是因为它和席位口径是同一件事的两条轴：**口径分区不可混算**。
   探针调 zoneOf / zoneReport 只是「自报口径」，不替任何人改种子 —— 改种子属于
   换读数集，必须单独立项说明理由。 */
const ZONES = [
  { key: 'calib', from: 1, to: 120, use: '调参与校准' },
  { key: 'valid', from: 121, to: 240, use: '验证读数' },
  { key: 'report', from: 241, to: 500, use: '验收报数' },
];
function seedZone(seed) {
  const s = Number(seed);
  for (const z of ZONES) if (s >= z.from && s <= z.to) return z.key;
  return 'outside';
}
function zoneReport(from, to) {
  const f = Number(from), t = Number(to);
  const hit = ZONES.filter(z => !(t < z.from || f > z.to)).map(z => z.key);
  const mixed = hit.length > 1;
  return { seedFrom: f, seedTo: t, zones: hit.length ? hit : [seedZone(f)],
           mixed, note: mixed ? '⚠ 该探针的种子跨了多个分区（' + hit.join('/') + '），读数不可当验收报数用'
                              : ('种子分区 = ' + (hit[0] || seedZone(f))) };
}

module.exports = { MODES, ENV, ZONES, seatMode, seatOpts, seatGame, seatTag, artifactFor, note,
                   seedZone, zoneReport };