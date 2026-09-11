/* 无头冒烟测试：纯 AI 对局，检查运行时错误与胜负分布 */
const fs = require('fs');
const path = require('path');
const { makeCtx, loadInto, profiles } = require('./load-order.cjs');

const base = path.join(__dirname, '..', 'js');
const ctx = makeCtx();
ctx.SK_LEGACY_AI_ROUTE = process.env.SK_LEGACY_AI_ROUTE === '1' ? 1 : 0;   // 对照用：AI 发言只走旧两路
loadInto(ctx, base, process.env.SK_NO_BRIDGE === '1' ? profiles.noBridge : profiles.full);

const { Setup, Engine } = ctx;
const N = parseInt(process.argv[2] || '200', 10);
const wins = { human: 0, alien: 0, xeno: 0, draw: 0, stuck: 0 };
let nights = 0, errs = 0, evictions = 0;

/* humanId>=0 时模拟真人：按表单描述随机填一份合法决策，用于验证 UI 表单通路 */
function answer(g, f) {
  const me = Engine.P(g, g.humanId);
  const data = { opt: null, targets: [], num: null, text: '' };
  if (f.opts) {
    const ok = f.opts.filter(o => !o.disabled);
    if (ok.length) data.opt = ok[Math.floor(Math.random() * ok.length)].v;
  }
  if (f.targets) {
    let list = Engine.alive(g);
    if (f.targets.list === 'aliveNotAlien') list = list.filter(p => p.faction !== 'alien');
    if (f.targets.list !== 'alive') list = list.filter(p => p.id !== me.id);
    list = list.filter(p => (f.targets.exclude || []).indexOf(p.id) < 0);
    const n = Math.min(f.targets.max || 1, list.length);
    for (let k = 0; k < n; k++) data.targets.push(list[k].id);
  }
  if (f.num) data.num = f.num.options[0].v;
  data.text = '';
  return data;
}

const WITH_HUMAN = process.argv[3] === 'human';

for (let i = 0; i < N; i++) {
  const g = Setup.createGame(1000 + i, 'random');
  g.humanId = WITH_HUMAN ? 1 + (i % 15) : -1;   // -1：无真人席位，全部 AI
  if (!WITH_HUMAN) g.humans = [];
  try {
    Engine.begin(g);
    let steps = 0;
    while (!g.over && steps < 4000) {
      const before = g.night;
      Engine.stepOnce(g);
      steps++;
      if (g.pending) {
        if (!g.pending.opts && !g.pending.targets && !g.pending.num && !g.pending.text)
          throw new Error('空表单：步骤 ' + g.step + ' / ' + g.pending.kind);
        Engine.submit(g, answer(g, g.pending));
      }
    }
    if (!g.over) wins.stuck++;
    else {
      wins[g.winner]++;
      const key = g.winner + (g.extinction ? '/寂灭' : g.duel ? '/决斗' : '/常规');
      wins[key] = (wins[key] || 0) + 1;
    }
    evictions += g.players.filter(p => p.out && p.outType === 'vote').length;
    nights += g.night;
    if (g.night > 200) console.log('  [长局] seed', 1000 + i, 'night', g.night, 'winner', g.winner);
  } catch (e) {
    errs++;
    console.log('  [异常] seed', 1000 + i, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e);
    if (errs > 3) break;
  }
}

console.log(`\n对局数 ${N}  异常 ${errs}  平均夜数 ${(nights / N).toFixed(1)}  场均驱逐 ${(evictions / N).toFixed(2)}`);
console.log('结果分布：', wins);
