/* 临时：DOM 桩驱动新 UI（含计时/复盘/房间渲染）做冒烟验证 */
const fs = require('fs');
const path = require('path');
const { loadInto, profiles } = require('./load-order.cjs');

const base = path.join(__dirname, '..', 'js');
const cache = {};
function mkEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, scrollTop: 0, scrollHeight: 0,
    disabled: false, checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    onclick: null, onchange: null, oninput: null,
  };
}
/* 标签页按钮：ui.js 的 renderSide 靠 `#nb-tabs .tab` 的 onclick 切换右侧栏（阵营页 = selfPanel），
   原先桩里恒返回 []，于是**整个标签页切换从未被覆盖过** —— 死囚面板显示四条用不了的外星人技能
   正是从这里漏过去的（43）。此处从 index.html 解析出真实 data-tab，避免与页面结构漂移。 */
const TAB_NAMES = (() => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const block = html.match(/id="nb-tabs"[\s\S]*?<\/div>/);
  return block ? [...block[0].matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]) : [];
})();
const TAB_ELLS = TAB_NAMES.map(name => { const e = mkEl('tab-' + name); e.dataset.tab = name; return e; });

const document = {
  getElementById: id => (cache[id] = cache[id] || mkEl(id)),
  querySelectorAll: sel => (sel.indexOf('#nb-tabs .tab') >= 0 ? TAB_ELLS : []),
  querySelector: () => null, addEventListener: () => {},
};
const clickTab = name => {
  const t = TAB_ELLS.find(e => e.dataset.tab === name);
  if (!t || typeof t.onclick !== 'function') throw new Error('标签页 ' + name + ' 不可点击（ui.js 未绑定 onclick）');
  t.onclick();
};
const ctx = { console, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, parseInt, parseFloat, isNaN, isFinite, document, alert(){}, setInterval(){ return 1; }, clearInterval(){} };
ctx.window = ctx; ctx.globalThis = ctx;
ctx.addEventListener = () => {};          // ui.js init() 绑定 window 事件；桩里只需不抛
/* 定时器一律不触发：ui.js 用 setTimeout 做「稍后再渲染」与提示条自动消失，
   若在桩里同步执行会引入真实环境不会有的重入（曾导致 renderForm 读到半初始化状态）。 */
ctx.setTimeout = () => 1;
ctx.clearTimeout = () => {};
ctx.document.body = { appendChild() {}, remove() {}, classList: { add() {}, remove() {}, toggle() {} } };
loadInto(ctx, base, profiles.ui);

const { Setup, Engine, View, UI, Game } = ctx;
let errs = 0;

/* ⚠ 可复现性：这一处原先用 Math.random() 挑选项，于是**同一份代码每次跑的路径不同**。
 * 后果实测到过：2026-10-08 连续两轮里，`node tools/uismoke.cjs` 一次 exit=0、一次 exit=1
 * （「冒烟失败：1 处异常」），紧接着重跑 5 轮共 150 局又全绿 —— 一个**时绿时红**的冒烟
 * 等于没有冒烟：红了没人知道是不是自己刚改的，绿了也不能证明什么。
 * 本仓库的验收规矩是「故意改坏实现必挂」；一个靠运气决定红绿的测试连这条都谈不上。
 *
 * 改为**可播种的确定性 LCG**：同一 SK_SMOKE_RNG 下逐局逐帧完全一致，红了可原样复现。
 * 扫遍多组种子由 tools 侧的扫描脚本驱动（一次跑多组），不必改本文件。
 * ⚠ 注意 uismoke 走 vm/runInContext，host 的 Math.random 补丁对它无效 —— 必须改这里。
 * ⚠ 只替换**选项挑选**这一处随机；对局本身已由 createGame 的种子决定，不受影响。 */
const RNG_SEED = Number(process.env.SK_SMOKE_RNG || 20261008);
let __rs = RNG_SEED >>> 0;
function pickRnd() { __rs = (Math.imul(__rs, 1103515245) + 12345) >>> 0; return __rs / 4294967296; }

/* 死面命中记录：某一步的**必答项没有可选项**。不计入失败，但必须打印出来 ——
   冒烟绿了不等于没有死面，只等于没有崩。 */
const deadFaces = Object.create(null);

try { UI.init(); } catch (e) { errs++; console.log('  [异常] UI.init：' + (e && e.message)); }

function answer(g) {
  const f = g.pending, me = Engine.P(g, g.humanId);
  const data = { opt: null, targets: [], num: null, text: '测试发言' };
  if (f.opts) { const ok = f.opts.filter(o => !o.disabled); if (ok.length) data.opt = ok[Math.floor(pickRnd() * ok.length)].v; }
  if (f.targets) {
    let list = Engine.alive(g).filter(p => p.id !== me.id);
    if (f.targets.list === 'aliveNotAlien') list = list.filter(p => p.faction !== 'alien');
    list = list.filter(p => (f.targets.exclude || []).indexOf(p.id) < 0);
    for (let k = 0; k < Math.min(f.targets.max || 1, list.length); k++) data.targets.push(list[k].id);
  }
  /* ⚠ num 槽的 options **可能为空**（见 js/ui.js 同处注释：船员首次查验池在
   * 「所有基础人类职业都没有存活持有者」的残局下为空，而表单仍把身份①标为必答）。
   * 本行原先无脑取 options[0].v，于是同一个空池先炸 UI 再炸冒烟本身。
   *
   * 空池时该提交什么，是**产品裁定**（无身份可查时船员是否只能放弃行动），
   * 冒烟不替它决定 —— 这里只做「选一个不需要 num 的选项」，也就是选项表里
   * 标着放弃/不提交的那一个，并把这一局**单独记成一条死面命中**让输出看得见。
   * 静默自动跳过才是危险的那种处理：红绿都看不出来。 */
  let emptyRequired = false;
  for (const key of ['num', 'num2']) {
    const slot = f[key];
    if (!slot) continue;
    const opts = Array.isArray(slot.options) ? slot.options : [];
    if (!opts.length) { emptyRequired = true; continue; }
    data[key] = opts[0].v;
  }
  if (emptyRequired && Array.isArray(f.opts) && f.opts.length) {
    /* 优先挑「放弃/不提交」类选项 —— 真实玩家在无选项时也只能这么走。 */
    const waive = f.opts.filter(o => !o.disabled
      && /放弃|不提交|不出手|放弃行动|不行动/.test(o.label || ''));
    data.opt = (waive.length ? waive[0] : f.opts.filter(o => !o.disabled)[0] || f.opts[0]).v;
    const which = f.num && !(f.num.options || []).length ? 'num' : 'num2';
    const dkey = f.kind + '.' + which;
    deadFaces[dkey] = (deadFaces[dkey] || 0) + 1;
  }
  return data;
}

for (let s = 0; s < 30; s++) {
  try {
    Game.startLocal(900 + s, ['random', 'human', 'alien', 'xeno'][s % 4]);
    Game.fast = true;
    let n = 0;
    while (!Game.g.over && n < 4000) {
      Game.tick();
      if (Game.g.pending && !Game.pendingResolved) Game.submit(answer(Game.g));
      n++;
    }
    if (!Game.g.over) console.log('  未结束 seed', 900 + s);
    UI.render();                                   // 结算页 + 复盘
    UI.renderReplayBody(Game.g);
    const v = View.build(Game.g, 1 + (s % 15));    // 视图裁剪
    if (!v || !v.players || v.players.length !== 15) throw new Error('view 构建异常');
  } catch (e) {
    errs++;
    console.log('  [异常] seed', 900 + s, e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : e);
    if (errs > 2) break;
  }
}
/* ---------- 43. 阵营页（selfPanel）不得按阵营罗列能力 ---------- *
 * 死囚阵营是 xeno、但一条经典外星人技能都不持（6.8.2）。面板此前按 faction 罗列，
 * 于是死囚看到「夜晚免疫／双刀／破坏／感染治疗额度」四条它用不了的东西，而它真正持有的
 * 变形与复生一条都不显示；变形后更荒唐——外星人资产与所变形身份���资产并排出现。
 * 这里断言的是**渲染出来的 HTML**，不是源码：源码改对了但渲染仍旧错，是这类回归的常见形态。
 *
 * 比对方式是**整行标签**，不是子串：「感染治疗额度」含「治疗额度」，用 indexOf 判定
 * 会让「外星人行漏进来了」这件事被判成通过。行结构固定为 <div class="kv"><span>标签</span>… */
const XENO_PANEL_ROWS = ['夜晚免疫', '双刀', '破坏', '感染治疗额度'];
const panelOf = () => (cache['side-body'] || {}).innerHTML || '';
const rowLabels = html => [...html.matchAll(/<span>([^<]{1,24})<\/span>/g)].map(m => m[1]);
let panelChecked = 0, panelFails = [];
{
  /* startLocal 自己掷席位变体（main.js 无 picks 入参），故在此临时接管掷骰以便确定性地
     构造死囚局；用完即还原，不留残留。 */
  const realRoll = ctx.Setup.rollSeatPicks;
  ctx.Setup.rollSeatPicks = () => ({ xeno: 'convict' });
  try {
    Game.startLocal(9700, 'xeno');
  } finally {
    ctx.Setup.rollSeatPicks = realRoll;
  }
  Game.fast = true;
  const g = Game.g;
  const me = Engine.P(g, g.humanId);
  if (!me || !me.convict) { panelFails.push('未能构造出人类为死囚的对局'); }
  else {
    UI.render(); clickTab('camp');
    let labels = rowLabels(panelOf());
    panelChecked++;
    const leaked = XENO_PANEL_ROWS.filter(k => labels.indexOf(k) >= 0);
    if (leaked.length) panelFails.push('未变形的死囚面板出现外星人资产行：' + leaked.join(','));
    ['复生额度', '镜像账本', '当前形态'].forEach(k => {
      if (labels.indexOf(k) < 0) panelFails.push('死囚面板缺少自有能力行：' + k);
    });

    /* 变形为救援医生（rescue）：面板应转为救援/治疗两行（医生技能），且仍无外星人资产。
       变形经引擎的 P-id 步位提交，不直接改字段（否则测不到真实渲染路径）。
       选 rescue 而非神探，是因为它有无条件出现的资产行——神探的「已查验池」要查过人才有，
       用它做断言会把「还没查过人」误判成回归。 */
    let n = 0, morphed = false;
    while (!g.over && n < 4000) {
      n++; Game.tick();
      if (g.pending && !Game.pendingResolved) {
        if (g.step === 'P-id' && g.pending.kind === 'morph' && !morphed) {
          const pick = (g.pending.opts || []).find(o => o.v === 'rescue' && !o.disabled);
          if (pick) { Game.submit({ opt: pick.v, targets: [], num: null, text: '' }); morphed = true; continue; }
        }
        Game.submit(answer(g));
      }
    }
    if (!morphed || me.role !== 'rescue') panelFails.push('死囚未能变形为救援医生（role=' + me.role + '）');
    else {
      UI.render(); clickTab('camp');
      labels = rowLabels(panelOf()); panelChecked++;
      const leaked2 = XENO_PANEL_ROWS.filter(k => labels.indexOf(k) >= 0);
      if (leaked2.length) panelFails.push('变形为救援后面板仍出现外星人资产行：' + leaked2.join(','));
      ['救援额度', '治疗额度'].forEach(k => {
        if (labels.indexOf(k) < 0) panelFails.push('变形为救援医生后面板未切到医生资产（缺「' + k + '」行）');
      });
      if (labels.indexOf('当前形态') < 0) panelFails.push('变形后应显示当前形态行');
    }
  }
  panelFails.forEach(m => { errs++; console.log('  [异常] 阵营页 43：' + m); });
  if (!panelFails.length) console.log(`  阵营页 43：${panelChecked} 次渲染断言通过（死囚资产隔离）`);
}

/* 死面命中（必答项无可选项）不计入退出码 —— 它是**引擎面的待裁定问题**，不是渲染崩溃；
   但必须打印，且打印里带复现参数，否则「绿」会被读成「没有死面」。 */
const dfKeys = Object.keys(deadFaces);
if (dfKeys.length) {
  console.log('  [死面] 必答项无可选项：' + dfKeys.map(k => k + ' ×' + deadFaces[k]).join('、'));
  console.log('        （不计入退出码：这是引擎面待裁定项，UI 与冒烟均已不崩。'
    + '复现：SK_SMOKE_RNG=' + RNG_SEED + ' 对局种子 912）');
}
console.log(errs ? `冒烟失败：${errs} 处异常` : '冒烟通过：30 局（本地+视图+复盘渲染）无异常');
/* 失败必须落到退出码上：否则 `npm run test:all` 一路绿灯，回归直接溜过去。
   （实测：断言命中时本脚本仍以 0 退出。） */
process.exitCode = errs ? 1 : 0;
