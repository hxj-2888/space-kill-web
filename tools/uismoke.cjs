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
const document = {
  getElementById: id => (cache[id] = cache[id] || mkEl(id)),
  querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {},
};
const ctx = { console, Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean, parseInt, parseFloat, isNaN, isFinite, document, alert(){}, setInterval(){ return 1; }, clearInterval(){} };
ctx.window = ctx; ctx.globalThis = ctx;
loadInto(ctx, base, profiles.ui);

const { Setup, Engine, View, UI, Game } = ctx;
let errs = 0;

function answer(g) {
  const f = g.pending, me = Engine.P(g, g.humanId);
  const data = { opt: null, targets: [], num: null, text: '测试发言' };
  if (f.opts) { const ok = f.opts.filter(o => !o.disabled); if (ok.length) data.opt = ok[Math.floor(Math.random() * ok.length)].v; }
  if (f.targets) {
    let list = Engine.alive(g).filter(p => p.id !== me.id);
    if (f.targets.list === 'aliveNotAlien') list = list.filter(p => p.faction !== 'alien');
    list = list.filter(p => (f.targets.exclude || []).indexOf(p.id) < 0);
    for (let k = 0; k < Math.min(f.targets.max || 1, list.length); k++) data.targets.push(list[k].id);
  }
  if (f.num) data.num = f.num.options[0].v;
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
console.log(errs ? `冒烟失败：${errs} 处异常` : '冒烟通过：30 局（本地+视图+复盘渲染）无异常');
