#!/usr/bin/env node
/* =============================================================
 * test-clock.cjs —— 实时化三块地基的门禁（批 RTA-0 / R2 · 2026-10-28）
 * -------------------------------------------------------------
 * 守三件事：
 *   ① 相位时钟：夜 90s / 昼 60s / tick 0.25s，补帧有上限，格式化正确；
 *   ② 个人技能槽：一个人用掉夜技只影响**他自己**；劳务（维修等）不占技能槽；
 *   ③ 动作请求：六道校验各挡一类错误；结算顺序与"点击顺序"无关（保随机流纪律）。
 *
 * 全部是纯函数测试：clock.js 不读 DOM、不自己起计时器，时间由这里注入。
 * ============================================================= */
'use strict';
const path = require('path');
const { loadInto, makeCtx } = require('./load-order.cjs');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'js');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' —— ' + detail : '')); }
}

const ctx = makeCtx({});
loadInto(ctx, JS, ['action-map', 'engine/clock']);
const C = ctx.SKClock, S = ctx.SKSlots, A = ctx.SKActions, AM = ctx.SKActionMap;

console.log('\n实时时钟与动作队列门禁：');

/* ---------- ① 相位时钟 ---------- */
{
  const t0 = 1000;
  const n = C.newPhase('night', t0);
  const d = C.newPhase('day', t0);
  const after = t0 + 30000;
  const ticks = C.newPhase('night', t0);
  const first = C.dueTicks(ticks, t0 + 500);      /* 0.5s ⇒ 2 个 tick */
  const burst = C.dueTicks(C.newPhase('night', t0), t0 + 90000);  /* 切后台 90s ⇒ 补帧有上限 */
  ok('CL1：相位时长（夜 90s / 昼 60s）+ 剩余时间递减 + 到点过期',
    C.PHASE_MS.night === 90000 && C.PHASE_MS.day === 60000 &&
    C.remaining(n, after) === 60000 && C.expired(n, t0 + 90000) === true &&
    C.expired(d, t0 + 60000) === true);
  ok('CL2：tick = 0.25s，0.5s 出两个 tick，且补帧有上限（不许一次结算 360 个）',
    C.TICK_MS === 250 && first.length === 2 && first[0] === 0 && first[1] === 1 &&
    burst.length === C.MAX_CATCHUP);
  ok('CL3：倒计时格式化（90000 → 1:30）', C.fmt(90000) === '1:30' && C.fmt(5000) === '0:05');
}

/* ---------- ② 个人技能槽 ---------- */
{
  const g = { night: 3 };
  S.resetSlots(g);
  const knife = AM.get('alien.knife');      /* 夜×1(G1) */
  const infect = AM.get('alien.infect');    /* 夜×1(G1) */
  const repair = AM.get('crew.repair');     /* 夜×1 但无 group ⇒ 劳务 */
  const use1 = S.useSlot(g, 1, knife);
  ok('CL4：同一个人用掉夜技后不能再放同组夜技（个人技能槽）',
    use1 === true && S.canUse(g, 1, infect) === false && S.canUse(g, 1, knife) === false);
  ok('CL5：槽位按人隔离 —— 别人不受影响，劳务也不占槽',
    S.canUse(g, 2, knife) === true && S.isNightSkill(repair) === false && S.canUse(g, 1, repair) === true);
  S.resetSlots({ night: 4 });
  ok('CL6：换夜清零', S.canUse({ night: 4 }, 1, knife) === true);
}

/* ---------- ③ 六道校验 ---------- */
{
  const base = {
    g: { night: 5 },
    now: 0,
    actor: { id: 7, caps: ['alien.kill'], room: 'bridge', pos: { x: 100, y: 22 } },
    target: { id: 8, room: 'bridge', pos: { x: 101, y: 22 }, out: false },
    place: { room: 'bridge', prop: null },
    los: () => true,
  };
  S.resetSlots(base.g);
  ok('CL7：权能不符 ⇒ cap',
    A.validate(Object.assign({}, base, { actionId: 'crew.shoot' })).reason === 'cap');
  /* 注意：近身动作的场所是 `any`（不绑物件），所以这里必须用**绑了房间**的动作来测 place */
  ok('CL8：场所不符 ⇒ place（维修点在 repair/engine，却点了医疗室手术台）',
    A.validate(Object.assign({}, base, {
      actionId: 'crew.repair',
      actor: Object.assign({}, base.actor, { caps: ['repair'], room: 'repair', pos: { x: 10, y: 22 } }),
      target: { room: 'repair', pos: { x: 10, y: 22 } },
      place: { room: 'medical', prop: 'surgery' },
    })).reason === 'place');
  ok('CL9：近身超距 ⇒ dist（1.3 格不行 / 1.0 格可以）',
    A.validate(Object.assign({}, base, { actionId: 'alien.knife', target: Object.assign({}, base.target, { pos: { x: 101.3, y: 22 } }) })).reason === 'dist' &&
    A.validate(Object.assign({}, base, { actionId: 'alien.knife', target: Object.assign({}, base.target, { pos: { x: 101, y: 22 } }) })).ok === true);
  ok('CL10：远程被墙挡 ⇒ los',
    A.validate(Object.assign({}, base, {
      actionId: 'crew.shoot', actor: Object.assign({}, base.actor, { caps: ['shoot'] }), los: () => false,
    })).reason === 'los');
  const q = [];
  const reqRepair = {
    g: { night: 6 }, actor: { id: 3, caps: ['repair'], room: 'repair', pos: { x: 10, y: 22 } },
    actionId: 'crew.repair', place: { room: 'repair', prop: 'engine' },
    target: { room: 'repair', pos: { x: 10, y: 22 } },
  };
  S.resetSlots(reqRepair.g);
  ok('CL11：校验通过的请求才入队（repair 走 place 校验）',
    A.request(q, reqRepair).ok === true && q.length === 1);
}

/* ---------- ③-b 结算顺序与点击顺序无关 ---------- */
{
  const mk = (tick, actorId, actionId, room) => ({ tick, actorId, actionId, room });
  const a = [mk(0, 9, 'alien.knife', 'bridge'), mk(0, 2, 'crew.shoot', 'bridge'), mk(1, 5, 'crew.repair', 'repair')];
  const b = [mk(1, 5, 'crew.repair', 'repair'), mk(0, 2, 'crew.shoot', 'bridge'), mk(0, 9, 'alien.knife', 'bridge')];
  const f1 = A.flush(a).map(x => x.tick + ':' + x.actorId + ':' + x.actionId).join('|');
  const f2 = A.flush(b).map(x => x.tick + ':' + x.actorId + ':' + x.actionId).join('|');
  ok('CL12：结算顺序固定为 tick→房间→玩家编号→动作（与点击顺序无关）',
    f1 === f2 && f1.indexOf('0:2:crew.shoot') === 0 && a.length === 0 && b.length === 0);
}

console.log('\n实时时钟与动作队列门禁：通过 ' + pass + ' 条、失败 ' + fail + ' 条');
if (fail) process.exitCode = 1;
