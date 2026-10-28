/* 反向自检（批 SHIP）：把实现/数据故意改坏，确认 test-ship 的对应断言真的会红。
   规矩（AGENTS 红线 11 + 交接文档 §4.2）：**先断言变异命中**，不命中就报"未命中"，
   不许把"没命中"报成"空转"。所有变异都在内存里做，跑完立刻还原。 */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');

let bad = 0;
const GATE = path.join(ROOT, 'tools', 'test-ship.cjs');
function runGate() {
  const r = cp.spawnSync(process.execPath, [GATE], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function mutate(file, from, to, label, expectTag) {
  const p = path.join(ROOT, file);
  const orig = fs.readFileSync(p, 'utf8');
  /* ⚠ 换行符归一化：CSS 是 CRLF、JS 是 LF，手写的变异片段是 LF。
     不归一化会把"变异未命中"误报成"断言空转"（自检脚本自己写错，§4.2）。 */
  const norm = (s) => s.replace(/\r\n/g, '\n');
  const origN = norm(orig), fromN = norm(from), toN = norm(to);
  if (origN.indexOf(fromN) < 0) { console.log('  ✗ 变异未命中：' + label); bad++; return; }
  const nextN = origN.split(fromN).join(toN);
  if (nextN === origN) { console.log('  ✗ 变异未改变内容：' + label); bad++; return; }
  const crlf = /\r\n/.test(orig);
  fs.writeFileSync(p, crlf ? nextN.replace(/\n/g, '\r\n') : nextN, 'utf8');
  const r = runGate();
  fs.writeFileSync(p, orig, 'utf8');
  const red = r.code !== 0;
  /* 不只要求"整体变红"，还要确认**是哪一条**红了 —— 否则别的断言替它变红，
     这条仍然是空转的。这是本批新加的判据。 */
  const named = expectTag ? (r.out.indexOf('✗ ' + expectTag) >= 0) : true;
  if (!red || !named) {
    console.log('  ✗ ' + label + (red ? ' ⇒ 变红了但不是 ' + expectTag : ' ⇒ 仍然绿（断言空转！）'));
    bad++;
  } else {
    console.log('  ✓ ' + label + ' ⇒ ' + expectTag + ' 红（预期）');
  }
}

const before = runGate();
console.log('基线：exit=' + before.code + (before.code === 0 ? '（绿）' : '（红）'));
if (before.code !== 0) { console.log(before.out.slice(-2000)); process.exit(1); }

console.log('\n反向自检（批 SHIP · 数据层）：');
/* SH1：让两间房重叠 ⇒ 自检必须报（〔批 M2〕坐标已换成米字布局，变异跟着换） */
mutate('js/ship-map.js', 'verify:  { x: 48,     y: 0.5 },', 'verify:  { x: 20,     y: 20 },',
  'SH1 让 verify 压到 medical 上（房间重叠）', 'SH1');
/* SH3：让**通道自己的端点**从门上滑开半格（门锚点不动 ⇒ 廊仍水平，
   只有"廊接在门旁边"这一个错误 ⇒ 只该 SH3 红）。
   第一版改的是 doorPoint（顶门锚点），结果廊变斜 ⇒ SH1/SH5 抢先红，
   反向自检报"变红了但不是 SH3" —— 那是变异选得不对，不是断言空转。 */
mutate('js/ship-map.js',
  '    const p0 = doorPoint(link.a, link.sa, link.aAt), p1 = doorPoint(link.b, link.sb, link.bAt);',
  '    const p0 = doorPoint(link.a, link.sa, link.aAt), p1 = doorPoint(link.b, link.sb, link.bAt);\n    if (p0) p0.x += 0.5;',
  'SH3 廊的起点从门上滑开半格（廊接在门旁边）', 'SH3');
/* SH4：anchorY 分支失效（〔批 M2〕房间已恒小于视窗高，"不夹紧"变异变成空转，
   改打 anchorY —— 这正是批 SHIP-2 用真实截图抓出来的那类缺陷） */
mutate('js/ship-map.js',
  '    const wantsAnchor = Math.abs(ay - 0.5) > 1e-6;',
  '    const wantsAnchor = false;',
  'SH4 anchorY 分支失效（面板展开时看不见自己）', 'SH4');
/* SH5：让寻路的折线**跳进路线外的房间**（插一个跳到 repair 中心的点） */
mutate('js/ship-map.js',
  '      for (const p of ordered) push(p);',
  '      for (const p of ordered) push(p);\n      if (hops.length > 1) push({ x: 111, y: 54 });',
  'SH5 折线跳进路线外的房间', 'SH5');
/* SH6：船体多一间 space.js 里没有的房间（〔批 M2〕坐标已换成米字布局） */
mutate('js/ship-map.js', '    dorms:   { x: 48,     y: 96.5 },', '    dorms:   { x: 48,     y: 96.5 },\n    cargo:   { x: 60,     y: 60 },',
  'SH6 船体多一间 cargo（space.js 没有）', 'SH6');

console.log('\n反向自检（批 SHIP · 渲染层）：');
/* SH7：渲染器不再读 SKShip */
mutate('js/ui-scene.js', 'function shipOf() { return global.SKShip || null; }',
  'function shipOf() { return null; }', 'SH7 渲染器不再读 SKShip', 'SH7');
/* SH8：删掉廊面 pattern 的定义（只留引用）—— 这正是截图抓到的那个 bug
   〔批 ART-0/B2a〕走廊带已搬到 js/scene/shell.js：变异必须打在新位置，
   否则自检会报"变异未命中"（那不是断言空转，是变异选错文件 —— 两者都要报出来）。 */
mutate('js/scene/shell.js',
  "'<defs><pattern id=\"sk-floor-corridor\" width=\"' + TILE + '\" height=\"' + TILE",
  "'<defs><pattern id=\"sk-floor-other\" width=\"' + TILE + '\" height=\"' + TILE",
  'SH8 廊面 pattern 定义改名（引用悬空，截图会变空）', 'SH8');
/* SH9：viewBox 写死整张船 */
mutate('js/ui-scene.js', "const vbStr = [cam.x * TILE, cam.y * TILE, cam.w * TILE, cam.h * TILE].join(' ');",
  "const vbStr = '0 0 ' + VB.w + ' ' + VB.h;", 'SH9 viewBox 写死（不再是近景）', 'SH9');
/* SH10：小地图不再画通道 */
mutate('js/ui-scene.js', '    for (const L of M.LINKS) {\n      const a = M.doorPoint(L.a, L.sa), b = M.doorPoint(L.b, L.sb);',
  '    for (const L of []) {\n      const a = M.doorPoint(L.a, L.sa), b = M.doorPoint(L.b, L.sb);',
  'SH10 小地图不画通道', 'SH10');
/* SH11：goto 立刻落定房间（瞬移） */
mutate('js/ui-scene.js', '    const p = walkTo(roomId);',
  '    curRoom = roomId; sig = null; const p = walkTo(roomId);',
  'SH11 goto 立刻落定房间（瞬移）', 'SH11');
/* SH12：crewHtml 去掉可见性裁剪 ⇒ 15 个人全画出来（批 R1 换了判据，变异也换位置） */
mutate('js/ui-scene.js',
  '      if (!inSight(pos, at, M2)) continue;',
  '      if (false) continue;',
  'SH12 去掉视野裁剪（15 人全画）', 'SH12');
/* SH27：指纹闸门恒拒（把所有 grant 物件都拦掉，主玩法直接死）*/
mutate('js/ui-scene.js',
  '    if (decisive.some(a => RD.hasGrant(role, a.cap) || ch[a.cap] != null)) return true;',
  '    return false;',
  'SH27 闸门恒拒（谁的物件都点不开）', 'SH27');
/* SH26：倒计时改成写死文本（不再问 SKClock）*/
mutate('js/ui-scene.js',
  '      const txt = C.fmt(C.remaining(st, now()));',
  "      const txt = '0:00';",
  'SH26 倒计时写死（不随相位时钟走）', 'SH26');
/* SH25：走动改成"每帧都重建 DOM"（性能）*/
mutate('js/ui-scene.js',
  '    if (visBefore !== visAfter) {',
  '    if (true) {',
  'SH25 每帧重建整船 DOM（进出视野才重建这条被删）', 'SH25');
/* SH24：losClear 退化成"永远可见" ⇒ 隔墙透视 */
mutate('js/ship-map.js',
  '    losClear: lineClear,',
  '    losClear: function () { return true; },',
  'SH24 视线不挡墙（隔墙可见）', 'SH24');
/* SH13：seatRects 不再用 CREW_BOX（回到旧常数） */
mutate('js/ui-scene.js', '    const w = CREW_BOX.w(), h = CREW_BOX.h();\n    /* 内容在帧内的相对位置',
  '    const w = TILE * 0.92, h = w * 1.6;\n    /* 内容在帧内的相对位置',
  'SH13 seatRects 回到旧常数（与渲染器不同源）', 'SH13');

/* =============================================================
 * 〔批 SHIP〕被本批**改写守护对象**的旧断言，也要反向自检。
 * -------------------------------------------------------------
 * 为什么必须补这一段：本批把 U2A 拆成 U2A1/A2/A3、改写了 S3a 与 T2、
 * 还改了移动端门禁的"门出视口"判据。改断言最容易犯的错就是把它改成
 * **恒真**（交接文档 §4.2 的两次空转都是这么来的）。所以这些断言必须重新
 * 证明"还能变红"，否则本批等于把防护悄悄关掉了。
 * ============================================================= */
function runGateFile(rel) {
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, rel)], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function mutateWith(file, from, to, label, gateRel, expectTag) {
  const p = path.join(ROOT, file);
  const orig = fs.readFileSync(p, 'utf8');
  const norm = (s) => s.replace(/\r\n/g, '\n');
  const origN = norm(orig), fromN = norm(from), toN = norm(to);
  if (origN.indexOf(fromN) < 0) { console.log('  ✗ 变异未命中：' + label); bad++; return; }
  const nextN = origN.split(fromN).join(toN);
  if (nextN === origN) { console.log('  ✗ 变异未改变内容：' + label); bad++; return; }
  const crlf = /\r\n/.test(orig);
  fs.writeFileSync(p, crlf ? nextN.replace(/\n/g, '\r\n') : nextN, 'utf8');
  const r = runGateFile(gateRel);
  fs.writeFileSync(p, orig, 'utf8');
  const red = r.code !== 0;
  /* expectTag 用**子串**匹配：test-space / test-ship 的行首是「✗ 标签」，
     而 mobile-layout-check 的明细行是「    · 文案」，两者格式不同。
     只匹配标签本身，不假设行首符号 —— 否则会把"红对了"误报成"变红了但不是它"。 */
  const named = expectTag ? (r.out.indexOf(expectTag) >= 0) : true;
  if (!red || !named) {
    console.log('  ✗ ' + label + (red ? ' ⇒ 变红了但不是 ' + expectTag : ' ⇒ 仍然绿（断言空转！）'));
    bad++;
  } else {
    console.log('  ✓ ' + label + ' ⇒ ' + expectTag + ' 红（预期）');
  }
}

console.log('\n反向自检（批 SHIP · 被改写守护对象的旧断言）：');
/* U2A1：把帧动画删空 */
mutateWith('css/06-scene.css',
  '@keyframes sk-walk-frames {\n  0%   { transform: translateX(0); }\n  25%  { transform: translateX(-96px); }\n  50%  { transform: translateX(-192px); }\n  75%  { transform: translateX(-96px); }\n  100% { transform: translateX(0); }\n}',
  '@keyframes sk-walk-frames {\n  0%   { opacity: 1; }\n}',
  'U2A1 删空 @keyframes sk-walk-frames', 'tools/test-space.cjs', 'U2A1');
/* U2A2：四向选行退化成单行（〔批 ART-0/B1b〕帧表已搬到 js/scene/crew.js） */
mutateWith('js/scene/crew.js', 'const ROW_OF = { down: 0, up: 1, left: 3, right: 4 };',
  'const ROW_OF = { down: 0, up: 0, left: 0, right: 0 };',
  'U2A2 四向选行退化成单行', 'tools/test-space.cjs', 'U2A2');
/* U2A3：删掉逐帧写 transform */
mutateWith('js/ui-scene.js',
  "g.setAttribute('transform', 'translate(' + (pos.x * TILE).toFixed(1) + ','",
  "void (0) || ('translate(' + (pos.x * TILE).toFixed(1) + ','",
  'U2A3 删掉 paintWalk 的逐帧 transform', 'tools/test-space.cjs', 'U2A3');
/* S3a：墙饰不再按列落位（〔批 ART-0/B2a〕外壳已搬到 js/scene/shell.js） */
mutateWith('js/scene/shell.js', '(ox + col * TILE)', '(ox)',
  'S3a 墙饰不再按列落位', 'tools/test-space.cjs', 'S3a');
/* T2：渲染器不再写 --step-ms（〔批 ART-0/B1b〕帧切换已搬到 js/scene/crew.js） */
mutateWith('js/scene/crew.js', "layer.style.setProperty('--step-ms', ms + 'ms');",
  'void ms;', 'T2 渲染器不写 --step-ms（"算了不写"）', 'tools/test-space.cjs', 'T2');
/* 移动端：当前房间的门必须有热区（把当前房间的 data-room 全改掉） */
mutateWith('js/ui-scene.js',
  '\'<rect class="sk-door" data-door="\' + escAttr(d.to) + \'" data-room="\' + escAttr(id)',
  '\'<rect class="sk-door" data-door="\' + escAttr(d.to) + \'" data-room="\' + escAttr("x")',
  '移动端 当前房间的门没有 data-room（出不去）', 'tools/mobile-layout-check.cjs', '当前房间');

console.log('\n反向自检（批 SHIP-2 · 玩家能不能看见自己）：');
/* SH14：让 clampRect 的居中分支重新吃掉 anchorY —— 这正是本批修掉的那个缺陷。
   注意：不能在 camera() 里删掉 wantsAnchor，那样 SH4 也会红（居中被破坏），
   反向自检会报"变红了但不是 SH14"。所以变异要**精准**：只让 anchorY 失效、
   仍保留居中，即把 wantsAnchor 恒判为 false。 */
mutate('js/ship-map.js', '    const wantsAnchor = Math.abs(ay - 0.5) > 1e-6;',
  '    const wantsAnchor = false;',
  'SH14 anchorY 重新被居中分支吃掉（人又被面板盖住）', 'SH14');
/* SH15：把相机写回挪进"重建 DOM"分支里（回到本批修掉的那个位置） */
mutate('js/ui-scene.js', '    applyCamera(mount);\n    layoutClerk();',
  '    if (key !== sig) applyCamera(mount);\n    layoutClerk();',
  'SH15 相机只在重建 DOM 时才写（面板变高不跟着变）', 'SH15');
/* SH16：房名搬回左上角 */
mutate('js/ui-scene.js',
  "'<text class=\"sk-room-name\" x=\"' + ((o.x + o.w) * TILE - TILE * 0.45)",
  "'<text class=\"sk-room-name\" x=\"' + (o.x * TILE + 14)",
  'SH16 房名搬回左上角（又压在记录板下）', 'SH16');
/* SH17：门标签不再推进房内 */
mutate('js/ui-scene.js', "        if (d.side === 'l') { tx = RX + DW + off; ty = RY + DH / 2 + 4; anchor = 'start'; }",
  "        if (d.side === 'l') { tx = RX + DW / 2; }",
  'SH17 门标签退回门洞正中（压在描边上读不出）', 'SH17');
/* SH18：openRules 只开不渲染（首局自动弹出永远停在"正在载入"） */
mutate('js/ui.js', '    if (global.SKArena && global.SKArena.renderRules) {',
  '    if (false && global.SKArena && global.SKArena.renderRules) {',
  'SH18 openRules 只开浮层不渲染（首局自动弹出是空的）', 'SH18');

console.log('\n反向自检（批 WALK · 自由行走）：');
/* SH19：通道带不再伸进房间 ⇒ 内缩墙与门之间多出死缝，人卡在门口。
   这正是本批最容易写错的那个数（WALK_DOOR_REACH 与 WALK_INSET_TOP 必须成对）。 */
mutate('js/ship-map.js', 'const WALK_DOOR_REACH = 2.6;', 'const WALK_DOOR_REACH = 0;',
  'SH19 通道带不伸进房间（门口出现死缝，人卡住）', 'SH19');
/* SH20：化简时不再检查视线 ⇒ 折线退化成"起点直连终点"，从墙里穿过去。
   注意：这条变异**不会**影响 walkable（SH19 仍绿），只让寻路穿墙。 */
mutate('js/ship-map.js',
  'if (lineClear(out[cur], out[j])) { next = j; break; }',
  'if (true) { next = j; break; }',
  'SH20 折线化简不检查视线（路径直穿墙）', 'SH20');
/* SH21：键盘位移不再走 slideMove（退回"人到点"的写法） */
mutate('js/ui-scene.js',
  'const to = slideMove(from, v.x * WALK_SPEED * dt, v.y * WALK_SPEED * dt);',
  'const to = { x: from.x, y: from.y };',
  'SH21 键盘不走逐轴滑动（直接定死坐标）', 'SH21');
/* SH21b：起步不再收敛到可站位置 ⇒ 从宿舍舱位（锚点差 0.1 格）按方向键会卡死 */
mutate('js/ui-scene.js',
  'if (!M.walkable(from.x, from.y) && M.nearestWalkable) {',
  'if (false && M.nearestWalkable) {',
  'SH21b 起步不收敛到可站位置（舱位起步卡死）', 'SH21');
/* SH22：点地面不再用格子级寻路（退回房间级折线 ⇒ 点到房间中间会先跑到房间中心） */
mutate('js/ui-scene.js', 'const p = M.walkPath(from, pt);', 'const p = M.path(curRoom, curRoom);',
  'SH22 点地面不用 A* 寻路（退回房间级折线）', 'SH22');
/* SH23：freePos 不再优先于锚点 ⇒ 一停下就弹回座位（自由行走等于没做） */
mutate('js/ui-scene.js', 'if (freePos) return {', 'if (false && freePos) return {',
  'SH23 freePos 不生效（停下弹回座位）', 'SH23');

console.log('');
if (bad) { console.log('反向自检失败 ' + bad + ' 项 —— 有断言是空转的'); process.exit(1); }
console.log('反向自检全部通过');
