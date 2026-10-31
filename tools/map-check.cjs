/* 离线地图体检：可行走网格 / 掩体审计 / 巡逻线 / 任务点可达性
 * 用法： node tools/_map-check.cjs
 * 只读 js/data/map.js 与 js/engine/geo.js，不启动浏览器。
 */
global.window = global;
require('../js/data/map.js');
require('../js/engine/geo.js');
const M = window.SKMapData, G = window.SKGeo;
const { GS, GW, GH, free, nearestFree, roomAt, d2seg } = G;

const gaps = [], dead = [];
const rectGap = (a, b) => {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  return Math.hypot(dx, dy);
};
for (let i = 0; i < M.cover.length; i++) for (let j = i + 1; j < M.cover.length; j++) {
  const a = M.cover[i], b = M.cover[j];
  if (a.room !== b.room) continue;
  const g = rectGap(a, b);
  if (g > 0 && g < 1.2) gaps.push({ room: a.room, a: a.label, b: b.label, gap: +g.toFixed(2) });
}
const wallGap = (c, w) => {
  const pts = [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]];
  let best = 1e9;
  for (const p of pts) best = Math.min(best, d2seg(p[0], p[1], w[0][0], w[0][1], w[1][0], w[1][1]));
  for (const p of w) {
    const dx = Math.max(c.x - p[0], p[0] - (c.x + c.w), 0);
    const dy = Math.max(c.y - p[1], p[1] - (c.y + c.h), 0);
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
};
for (const c of M.cover) for (const w of M.walls) {
  const g = wallGap(c, w);
  if (g > 0.2 && g < 1.2) gaps.push({ room: c.room, cover: c.label, wall: true, gap: +g.toFixed(2) });
  /* 掩体伸出舱室外：四角必须落在房间多边形里（或贴边 0.35 内） */
  if (w === M.walls[0]) {
    const room = M.rooms.find(r => r.id === c.room);
    if (room) {
      const out = [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]]
        .filter(p => !G.inPoly(p[0] - 0.03, p[1] - 0.03, room.poly) && !G.inPoly(p[0] + 0.03, p[1] + 0.03, room.poly));
      if (out.length) gaps.push({ room: c.room, cover: c.label, outside: out.length });
    }
  }
}
const nearCover = (x, y) => M.cover.some(c => x >= c.x - .75 && x <= c.x + c.w + .75 && y >= c.y - .75 && y <= c.y + c.h + .75);
for (let gy = 1; gy < GH - 1; gy++) for (let gx = 1; gx < GW - 1; gx++) {
  const x = (gx + .5) * GS, y = (gy + .5) * GS;
  if (!free(x, y)) continue;
  const room = roomAt(x, y); if (!room) continue;
  let nb = 0;
  if (free(x + GS, y)) nb++; if (free(x - GS, y)) nb++;
  if (free(x, y + GS)) nb++; if (free(x, y - GS)) nb++;
  if (nb <= 1 && nearCover(x, y)) dead.push({ room: room.id, x: +x.toFixed(1), y: +y.toFixed(1), nb });
}

// 连通性：从会议室附近 BFS，检查每间房都能到。
// 必须按**整数格索引**扩展，不能像以前那样在浮点坐标上 ±GS 步进：
// 0.6*119 = 71.3999…，从 y=71.4 再 +0.6 得 72.0，floor(72.0/0.6)=120 —— 第 119 行被整行跳过。
// 老地图走廊都短，跳一行看不出来；走廊一拉长就会把可达的房间误报成 unreachable。
const start = nearestFree(41, 33);
const cellOf = (x, y) => [Math.floor(x / GS), Math.floor(y / GS)];
const seen = new Set(), q = [cellOf(...start)];
seen.add(q[0][0] + ',' + q[0][1]);
while (q.length) {
  const [gx, gy] = q.pop();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = gx + dx, ny = gy + dy;
    if (!free((nx + .5) * GS, (ny + .5) * GS)) continue;
    const k = nx + ',' + ny;
    if (seen.has(k)) continue;
    seen.add(k); q.push([nx, ny]);
  }
}
const unreachable = [];
for (const r of M.rooms) {
  let hit = false;
  for (const k of seen) {
    const [gx, gy] = k.split(',').map(Number);
    const rr = roomAt((gx + .5) * GS, (gy + .5) * GS);
    if (rr && rr.id === r.id) { hit = true; break; }
  }
  if (!hit) unreachable.push(r.id);
}

// 巡逻线：按 0.2 秒步进模拟 3 圈，检查每一步是否可行走
const patrolBad = [];
for (const f of M.facility) {
  if (!f.patrol) continue;
  let x = nearestFree(f.x, f.y)[0], y = nearestFree(f.x, f.y)[1], wp = 0;
  const wps = f.patrol.map(p => nearestFree(p[0], p[1]));
  if (!free(x, y)) patrolBad.push({ bot: f.kind, at: 'dock', x: +x.toFixed(2), y: +y.toFixed(2) });
  for (let i = 0; i < 900; i++) {
    const w = wps[wp], dx = w[0] - x, dy = w[1] - y, d = Math.hypot(dx, dy);
    if (d < 0.3) { wp = (wp + 1) % wps.length; continue; }
    const step = Math.min(d, 1.6 * 0.2);
    x += dx / d * step; y += dy / d * step;
    if (!free(x, y)) patrolBad.push({ bot: f.kind, at: 'step' + i, x: +x.toFixed(2), y: +y.toFixed(2) });
  }
}

// 任务点：2.6 格内必须有可行走点
const pointBad = [];
for (const p of M.points) {
  if (free(p.x, p.y)) continue;
  let ok = false;
  for (let r = 0.3; r <= 2.6 && !ok; r += 0.3)
    for (let a = 0; a < 24 && !ok; a++) {
      const t = a / 24 * Math.PI * 2;
      if (free(p.x + Math.cos(t) * r, p.y + Math.sin(t) * r)) ok = true;
    }
  if (!ok) pointBad.push({ room: p.room, label: p.label });
}
// 设施可达性
const facBad = [];
for (const f of M.facility) {
  const c = nearestFree(f.x, f.y);
  if (!free(c[0], c[1])) facBad.push({ kind: f.kind, label: f.label });
}

console.log('bounds', JSON.stringify(M.bounds), 'rooms', M.rooms.length, 'cover', M.cover.length,
  'decor', (M.decor || []).length, 'points', M.points.length, 'walls', M.walls.length,
  'corridors', M.corridors.length, 'pipes', M.pipes.length);
console.log('gaps', gaps.length, JSON.stringify(gaps.slice(0, 20)));
console.log('dead', dead.length, JSON.stringify(dead.slice(0, 20)));
console.log('unreachable', JSON.stringify(unreachable));
console.log('patrolBad', patrolBad.length, JSON.stringify(patrolBad.slice(0, 10)));
console.log('pointBad', JSON.stringify(pointBad));
console.log('facBad', JSON.stringify(facBad));
