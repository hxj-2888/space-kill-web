/* =============================================================
 * 新返航录 · 房间布局数据（批 U1 / 批 UI-7 增补）
 * -------------------------------------------------------------
 * 纯数据 + 纯函数，**零 DOM、零规则**。渲染器（ui-scene.js）只是消费者。
 *
 * 为什么单独成文件（而不是写进 ui-scene.js）：
 *   ① 布局是"谁在哪、多大、什么朝向"，属于**数据**，不是视图逻辑；
 *   ② 门禁可以只测这份数据（坐标不重叠、门连通对称、道具落在房内），
 *      不需要起浏览器 —— 这是 PixiJS 渲染层无法被 vm 沙盒测试的补偿；
 *   ③ 换素材 / 调布局只改这里，渲染器不动。
 *
 * 坐标系：房间本地坐标，单位 = 格（1 格 = 32px 素材像素 = 场景 32 单位）。
 *   原点在房间左上角，x 向右、y 向下（屏幕坐标，不是数学坐标）。
 *   渲染器负责把本地坐标乘 TILE 并加房间偏移。
 *
 * 素材命名与 assets/scene/cozy/ 一一对应：
 *   tiles/<id>.png       地板 / 墙 / 门窗
 *   furniture/<id>.png   家具
 * ============================================================= */
(function (global) {
  'use strict';

  /* ---- 房间尺寸（格）〔批 UI-6 · 2026-10-26〕30 × 11 ----
     -------------------------------------------------------------
     用户原话：「先做好整体布局，再细化素材质量」。

     为什么从 26×17 改成 30×11：
       26×17 的宽高比是 **1.53**，而对局主区（1600×900 下）是 1568×581 = **2.70**。
       场景 SVG 用 meet 等比缩放，必须按**高度**绑定 ⇒ 房间只能占视口宽的 56%，
       两侧各空 346px（用户反复说的"黑区"）。这是数学问题，不是审美问题：
       要占满宽度，房间宽高比必须接近 2.7。

       30×11 = **2.73**，与主区几乎完全一致 ⇒ 房间可以吃满整个主区。

     【注意】改尺寸会牵动所有道具坐标与座圈，所以本批**同时**重排全部 9 间房。
       门禁 test-space 会拦住越界 / 重叠 / 门不对称 —— 改完必须跑。 */
  const ROOM_W = 30;
  const ROOM_H = 11;

  /* 房间水平中线（格）。9 间房全部按它做中轴对称 —— 见 §对称性门禁 S4。 */
  const MID_X = ROOM_W / 2;

  /* ---- 道具表 ----
     w/h = 占地格数（按素材实际尺寸：bed 1×2、desk 3×1、console 2×1 …）
     anchor = 素材锚点（Cozy Space 的家具"坐在图片底边"，故锚点 y=1） */
  const PROP = {
    bed:      { w: 1, h: 2 },  desk:     { w: 3, h: 1 },  chair:  { w: 1, h: 1 },
    console:  { w: 2, h: 1 },  rack:     { w: 1, h: 2 },  plant:  { w: 1, h: 1 },
    tallplant:{ w: 1, h: 2 },  crate:    { w: 1, h: 1 },  sofa:   { w: 2, h: 1 },
    table:    { w: 2, h: 1 },  lamp:     { w: 1, h: 1 },  fridge: { w: 1, h: 2 },
    locker:   { w: 1, h: 2 },  bookshelf:{ w: 1, h: 2 },  rug:    { w: 2, h: 1 },
    sink:     { w: 1, h: 1 },  vending:  { w: 1, h: 2 },  cooler: { w: 1, h: 1 },
    barrel:   { w: 1, h: 1 },  terminal: { w: 1, h: 2 },  cryopod:{ w: 1, h: 2 },
    bin:      { w: 1, h: 1 },  screen:   { w: 2, h: 1 },
  };

  /* ---- 9 个房间 ----
     每个 prop: { t: 类型, x/y: 左上角格坐标, k: 可选交互键, label: 提示文字 }
     k（交互键）只用于**发起行动**，不是新的提交路径 —— 仍委托 #f-targets / 提交按钮。

     〔批 UI-6 · 2026-10-26〕全部重排为 30×11 的**横向**房间。
     〔批 UI-7 · 2026-10-27〕**素材质量**：补 `wall` 材质表，
       并按中轴对称重排 —— 见下方 §材质表 与 各房间注释。

     材质表（wall）——这是批 UI-7 的重点
     -------------------------------------------------------------
     改动前：**9 间房共用同一张 wall.png**（空白灰墙），而 cozy 素材包里其实有
       7 种墙面变体（screen / light / vent / window / window-planet / pipes / sign）
       和 12 种地板，全部躺在 assets/ 里**零引用**。
     截图后果：无论走进哪间房，墙都是同一面白灰，房间读起来像"同一个房间换家具"，
       而且**顶部三分之一是死白**（用户说的"黑区"的另一半其实是"白区"）。

     所以每个房间现在声明：
       · wall   —— 墙面装饰瓦片循环表（渲染器沿上壁逐格循环贴，一格一张）
       · （曾试过 accent 地板高光，实测像贴图没对齐，已撤 —— 见 ui-scene.js 的注释）
     两张表里的名字都必须是 assets/scene/cozy/tiles/ 下真实存在的文件，
     门禁 test-space 的 S1/S2/S3 逐个核对，并反向检查"没有零引用素材"。 */
  const ROOMS = {
    bridge: {
      name: '舰桥', floor: 'floor-steel',
      wall: ['wall-screen', 'wall-light', 'wall-screen', 'wall-window-planet'],
      size: [ROOM_W, ROOM_H],
      /* 〔批 M2〕米字+环：舰桥接 8 条辐条 ⇒ 顶/底各 3 扇（at = 8/15/22），左右各 1 扇。
              at 与 ship-map 的 LINKS.aAt 必须逐位一致（门禁 SH3 双向核对）。 */
      doors: [{ to: 'medical', side: 't', at: 8 }, { to: 'verify', side: 't', at: 15 }, { to: 'patrol', side: 't', at: 22 },
              { to: 'repair', side: 'r' }, { to: 'pharma', side: 'l' },
              { to: 'armory', side: 'b', at: 22 }, { to: 'dorms', side: 'b', at: 15 }, { to: 'safe', side: 'b', at: 8 }],
      /* 圆桌居中；15 座由渲染器按角度算（见 SEATS） */
      props: [
        /* 这张地毯就是玩家眼里的「大桌子」：15 席围着它坐。
           书记官记录板钉在它中央（data-anchor="clerk"）。
           16×5 居中（x7, y3）—— 中线正好 15，左右各留 7 格给两列座位。 */
        { t: 'rug', x: 7, y: 3, w: 16, h: 5, tint: 'deck', anchor: 'clerk' },
        /* 〔批 UI-7〕圆桌从中线偏左 2 格（cx 13）搬回**正中对齐**（13 宽 4 ⇒ 中线 15）。
           截图上原来桌心与座圈中心差 28px，读作"桌子歪了"。 */
        { t: 'table', x: 13, y: 4, w: 4, h: 2, k: 'round_table', label: '圆桌' },
        /* 舰桥大屏：2 格宽，中线 15（x14）；y=1 落在墙脚线上，不再被顶墙压住 */
        { t: 'screen', x: 14, y: 1, k: 'monitor', label: '舰桥大屏' },
        /* 四角植物：必须**完全在房间内**（y=0 会被顶墙压住，y=8 + 2 格高正好贴底） */
        { t: 'plant', x: 0, y: 0 }, { t: 'plant', x: 29, y: 0 },
        { t: 'tallplant', x: 0, y: 8 }, { t: 'tallplant', x: 29, y: 8 },
        /* 三件交互物件：HUD 删除后，发言/投票/留言改为点物件发起
           （映射见 js/hud-map.js）。左右**严格镜像**：0↔29、1↔27。 */
        { t: 'console', x: 1, y: 1, k: 'comms', label: '通讯台' },
        { t: 'console', x: 27, y: 1, k: 'nav', label: '导航台' },
        { t: 'bookshelf', x: 0, y: 3, k: 'logbook', label: '航海日志' },
        { t: 'crate', x: 29, y: 3, k: 'ballot', label: '投票箱' },
      ],
      /* 座位圈在桌子外面：桌占 4×2（半宽 2、半高 1），座圈 rx/ry 必须大于它。
         30×11 房间中心是 (15, 5.5)。rx 12 / ry 3.4：
           左右座位落在 x=3 / 27（房间内，且避开外沿的家具列 x=0~2 / x=27~29）；
           上下座位落在 y=2.1 / 8.9（在房间内，不越出 0~11）。
         【注意】rx/ry 再大就会把角色推出房间边界 —— test-space 的「座位在房内」判据会拦。 */
      seats: { cx: 15, cy: 5.5, rx: 12, ry: 3.4, n: 15 },
    },
    verify: {
      name: '查证室', floor: 'floor-steel-plain',
      wall: ['wall-screen', 'wall-light', 'wall-screen', 'wall-light'],
      size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 'b' }, { to: 'patrol', side: 'r' }, { to: 'medical', side: 'l' }],
      /* 〔批 UI-7〕全部按 x=15 镜像重排：证据板/审讯桌守中线，左右各成一组。 */
      props: [
        { t: 'rug', x: 5, y: 2, w: 20, h: 7, tint: 'deck' },
        /* 审讯区顶灯投在地上的两块亮地砖（真实瓦片，不是虚线框） */
        { t: 'rug', x: 13, y: 5, w: 2, h: 1, tile: 'floor-light-panel', decal: true },
        { t: 'rug', x: 16, y: 5, w: 2, h: 1, tile: 'floor-light-panel', decal: true },
        { t: 'screen', x: 14, y: 1, k: 'board', label: '证据板' },
        { t: 'table', x: 14, y: 5, k: 'interrogate', label: '审讯桌' },
        { t: 'chair', x: 13, y: 6 }, { t: 'chair', x: 16, y: 6 },
        { t: 'locker', x: 1, y: 1 }, { t: 'locker', x: 2, y: 1 },
        { t: 'locker', x: 27, y: 1, k: 'locker', label: '证据柜' },
        { t: 'locker', x: 28, y: 1 },
        { t: 'console', x: 1, y: 5, k: 'fingerprint', label: '指纹仪' },
        { t: 'console', x: 27, y: 5, k: 'terminal', label: '档案终端' },
        { t: 'bookshelf', x: 5, y: 1 }, { t: 'bookshelf', x: 24, y: 1 },
        { t: 'table', x: 9, y: 2 }, { t: 'table', x: 19, y: 2 },
        { t: 'bin', x: 12, y: 2 }, { t: 'bin', x: 17, y: 2 },
        { t: 'cooler', x: 6, y: 7 }, { t: 'cooler', x: 23, y: 7 },
        /* 〔批 UI-7〕中段（x 6~23 / y 3~6）此前是整片空地 —— 用户说的"房间显得空"。
           补四组对称家具，把通行带切成"三进"：近门 / 中段 / 里面。 */
        { t: 'rack', x: 7, y: 3 }, { t: 'rack', x: 22, y: 3 },
        { t: 'terminal', x: 5, y: 5 }, { t: 'terminal', x: 24, y: 5 },
        { t: 'chair', x: 10, y: 4 }, { t: 'chair', x: 19, y: 4 },
        { t: 'plant', x: 1, y: 8 }, { t: 'plant', x: 28, y: 8 },
      ],
    },
    medical: {
      name: '医疗室', floor: 'floor-lab',
      wall: ['wall-light', 'wall-screen', 'wall-light', 'wall-vent'],
      size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 'r' }, { to: 'verify', side: 't' }, { to: 'pharma', side: 'l' }],
      /* 〔批 UI-7〕三张病床成组左墙，右侧镜像成"药柜/抑制器/冷柜"一列；
         中部手术台守中线。旧版中部家具散在 4~12 列，读作"地上随手丢的"。 */
      props: [
        { t: 'rug', x: 5, y: 2, w: 20, h: 7, tint: 'deck' },
        /* 三张病床沿左墙竖排：床是 1×2，y=1/3/5 → 占 y1~7，互不重叠 */
        { t: 'bed', x: 1, y: 1, k: 'bed1', label: '病床一' },
        { t: 'bed', x: 1, y: 3, k: 'bed2', label: '病床二' },
        { t: 'bed', x: 1, y: 5, k: 'bed3', label: '病床三' },
        { t: 'lamp', x: 2, y: 1 }, { t: 'lamp', x: 2, y: 3 }, { t: 'lamp', x: 2, y: 5 },
        /* 右墙镜像一列：药柜 / 抑制器 / 冷柜（都是 1×2，与病床同高） */
        { t: 'fridge', x: 28, y: 1, k: 'medicine', label: '药柜' },
        { t: 'terminal', x: 28, y: 3, k: 'suppressor', label: '抑制器' },
        { t: 'cooler', x: 28, y: 5 },
        { t: 'table', x: 14, y: 5, k: 'surgery', label: '手术台' },
        { t: 'chair', x: 13, y: 4 }, { t: 'chair', x: 16, y: 4 },
        { t: 'screen', x: 14, y: 1, k: 'monitor', label: '监护屏' },
        /* 中段补密度：器械台 / 洗手池 / 废物桶，左右成对（不再是一条跑道） */
        { t: 'desk', x: 9, y: 2 }, { t: 'desk', x: 18, y: 2 },
        { t: 'cooler', x: 6, y: 7 }, { t: 'cooler', x: 23, y: 7 },
        /* 〔批 UI-7〕中段补密度：器械柜 / 候诊椅，左右成对 */
        { t: 'rack', x: 7, y: 3 }, { t: 'rack', x: 22, y: 3 },
        { t: 'chair', x: 10, y: 4 }, { t: 'chair', x: 19, y: 4 },
        { t: 'chair', x: 10, y: 6 }, { t: 'chair', x: 19, y: 6 },
        { t: 'bin', x: 2, y: 8, k: 'biohazard', label: '医疗废物箱' },
        { t: 'sink', x: 27, y: 8, k: 'sink', label: '洗手池' },
        { t: 'plant', x: 12, y: 8 }, { t: 'plant', x: 17, y: 8 },
      ],
    },
    pharma: {
      name: '制药室', floor: 'floor-steel-bolts',
      wall: ['wall-pipes', 'wall-vent', 'wall-pipes', 'wall-light'],
      size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 'r' }, { to: 'safe', side: 'b' }, { to: 'medical', side: 't' }],
      props: [
        { t: 'rug', x: 6, y: 2, w: 18, h: 7, tint: 'deck' },
        { t: 'desk', x: 5, y: 2, k: 'bench1', label: '实验台一' },
        { t: 'desk', x: 22, y: 2, k: 'bench2', label: '实验台二' },
        { t: 'console', x: 14, y: 4, k: 'centrifuge', label: '离心机' },
        { t: 'table', x: 14, y: 6 },
        { t: 'rack', x: 1, y: 1 }, { t: 'rack', x: 2, y: 1 },
        { t: 'rack', x: 27, y: 1, k: 'reagent', label: '试剂架' },
        { t: 'rack', x: 28, y: 1 },
        { t: 'fridge', x: 1, y: 5, k: 'coldstorage', label: '冷藏柜' },
        { t: 'fridge', x: 28, y: 5 },
        { t: 'terminal', x: 14, y: 7, k: 'terminal', label: '配方终端' },
        { t: 'terminal', x: 5, y: 7 }, { t: 'terminal', x: 24, y: 7 },
        { t: 'sink', x: 9, y: 3 }, { t: 'sink', x: 20, y: 3 },
        { t: 'bin', x: 12, y: 2 }, { t: 'bin', x: 17, y: 2 },
        /* 〔批 UI-7〕中段补密度：试剂车 / 椅子 */
        { t: 'console', x: 9, y: 5 }, { t: 'console', x: 19, y: 5 },
        { t: 'chair', x: 12, y: 5 }, { t: 'chair', x: 17, y: 5 },
        { t: 'plant', x: 10, y: 8 }, { t: 'plant', x: 19, y: 8 },
      ],
    },
    patrol: {
      name: '巡逻岗', floor: 'floor-grate',
      wall: ['wall-window-planet', 'wall-screen', 'wall-window-planet', 'wall-light'],
      size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 'l' }, { to: 'verify', side: 't' }, { to: 'repair', side: 'b' }],
      props: [
        /* 监控墙：三块屏 2 格宽连排（12/14/16 ⇒ 合起来 12~18，中线 15） */
        { t: 'screen', x: 12, y: 1, k: 'monitor_wall', label: '监控墙' },
        { t: 'screen', x: 14, y: 1 },
        { t: 'screen', x: 16, y: 1 },
        { t: 'rug', x: 5, y: 2, w: 20, h: 7, tint: 'warn' },
        { t: 'table', x: 14, y: 5, k: 'patrol_map', label: '巡逻图' },
        { t: 'chair', x: 13, y: 6 }, { t: 'chair', x: 16, y: 6 },
        { t: 'console', x: 1, y: 5, k: 'terminal', label: '值班终端' },
        { t: 'console', x: 27, y: 5, k: 'security', label: '安防台' },
        { t: 'rack', x: 5, y: 1 }, { t: 'rack', x: 24, y: 1 },
        { t: 'barrel', x: 6, y: 2 }, { t: 'barrel', x: 23, y: 2 },
        { t: 'cooler', x: 9, y: 7 }, { t: 'cooler', x: 20, y: 7 },
        /* 〔批 UI-7〕中段补密度：值班椅 / 装备架 */
        { t: 'chair', x: 9, y: 3 }, { t: 'chair', x: 20, y: 3 },
        { t: 'rack', x: 10, y: 4 }, { t: 'rack', x: 19, y: 4 },
        { t: 'locker', x: 1, y: 7 },
        { t: 'locker', x: 28, y: 7, k: 'weapon_locker', label: '武器柜' },
        { t: 'plant', x: 3, y: 8 }, { t: 'plant', x: 26, y: 8 },
      ],
    },
    repair: {
      name: '船舱', floor: 'floor-steel-vent',
      wall: ['wall-pipes', 'wall-vent', 'wall-pipes', 'wall-vent'],
      size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 'l' }, { to: 'patrol', side: 't' }, { to: 'armory', side: 'b' }],
      props: [
        { t: 'rug', x: 6, y: 2, w: 18, h: 7, tint: 'deck' },
        /* 升降台：4×2 的警示地毯，中线 15（x13） */
        /* 升降台：用**真实瓦片**铺一块黄黑警示地，而不是画个虚线框。
           rug 的 `tile` 是可选的：给了就按 w×h 平铺那张瓦片（渲染器见 propsHtml），
           不给仍是"装饰地毯"的虚线轮廓。这样 floor-hazard 这种"点缀型地板"
           才有正确用法 —— 小面积铺，而不是把整间房铺成警戒线。 */
        { t: 'rug', x: 13, y: 3, w: 4, h: 2, k: 'lift', label: '升降台', tile: 'floor-hazard' },
        /* 引擎组：三台机架连排（rack 1×2），右侧镜像一组 */
        { t: 'rack', x: 2, y: 1, k: 'engine', label: '引擎组' },
        { t: 'rack', x: 3, y: 1 }, { t: 'rack', x: 4, y: 1 },
        { t: 'rack', x: 25, y: 1 }, { t: 'rack', x: 26, y: 1 }, { t: 'rack', x: 27, y: 1 },
        { t: 'barrel', x: 2, y: 4 }, { t: 'barrel', x: 3, y: 4 },
        { t: 'barrel', x: 26, y: 4 }, { t: 'barrel', x: 27, y: 4 },
        { t: 'console', x: 14, y: 6, k: 'parts', label: '零件台' },
        { t: 'rack', x: 1, y: 7 },
        { t: 'rack', x: 28, y: 7, k: 'tool_rack', label: '工具架' },
        { t: 'crate', x: 2, y: 8 }, { t: 'crate', x: 3, y: 8 },
        { t: 'crate', x: 26, y: 8 }, { t: 'crate', x: 27, y: 8 },
        { t: 'screen', x: 14, y: 1, k: 'gauge', label: '压力表' },
        { t: 'cryopod', x: 28, y: 4, k: 'escapepod', label: '逃生舱' },
        { t: 'table', x: 5, y: 5 }, { t: 'table', x: 23, y: 5 },
        { t: 'plant', x: 10, y: 8 }, { t: 'plant', x: 19, y: 8 },
      ],
    },
    armory: {
      /* 〔批 UI-7〕军械库原来是 floor-hazard 铺满整间 —— 黄黑警示斜纹是**点缀**素材，
         铺满后整间房读作"警戒线糊了一地"，家具全被吃掉。改成钢栓地板，
         警示感交给房间已有的 warn 地毯 + 弹药箱。 */
      name: '军械库', floor: 'floor-hatch',
      wall: ['wall-vent', 'wall-screen', 'wall-vent', 'wall-sign'],
      size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 'l' }, { to: 'repair', side: 'r' }, { to: 'dorms', side: 'b' }],
      props: [
        { t: 'rack', x: 2, y: 1, k: 'weapon_rack', label: '枪架' },
        { t: 'rack', x: 3, y: 1 }, { t: 'rack', x: 4, y: 1 },
        { t: 'rack', x: 25, y: 1 }, { t: 'rack', x: 26, y: 1 }, { t: 'rack', x: 27, y: 1 },
        { t: 'rug', x: 8, y: 2, w: 14, h: 7, tint: 'warn' },
        { t: 'barrel', x: 8, y: 1 }, { t: 'barrel', x: 9, y: 1 },
        { t: 'barrel', x: 20, y: 1 }, { t: 'barrel', x: 21, y: 1 },
        { t: 'screen', x: 4, y: 3 }, { t: 'screen', x: 24, y: 3, k: 'target', label: '靶道' },
        { t: 'desk', x: 11, y: 5, k: 'workbench', label: '工作台' },
        { t: 'desk', x: 16, y: 5 },
        { t: 'chair', x: 12, y: 6 }, { t: 'chair', x: 17, y: 6 },
        { t: 'crate', x: 6, y: 6, k: 'ammo', label: '弹药箱' }, { t: 'crate', x: 7, y: 6 },
        { t: 'crate', x: 22, y: 6 }, { t: 'crate', x: 23, y: 6 },
        /* 〔批 UI-7〕中段补密度：弹药架 / 靶位桶 */
        { t: 'rack', x: 10, y: 3 }, { t: 'rack', x: 19, y: 3 },
        { t: 'barrel', x: 12, y: 7 }, { t: 'barrel', x: 17, y: 7 },
        { t: 'locker', x: 1, y: 6 },
        { t: 'locker', x: 28, y: 6, k: 'locker', label: '储物柜' },
        { t: 'plant', x: 5, y: 8 }, { t: 'plant', x: 24, y: 8 },
      ],
    },
    safe: {
      name: '安全室', floor: 'floor-carpet-blue',
      wall: ['wall-window', 'wall-light', 'wall-window', 'wall-sign'],
      size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 'r' }, { to: 'dorms', side: 'b' }, { to: 'pharma', side: 'l' }],
      props: [
        { t: 'screen', x: 14, y: 1, k: 'oxygen', label: '氧气监测' },
        { t: 'barrel', x: 1, y: 1 }, { t: 'barrel', x: 1, y: 3 },
        { t: 'barrel', x: 28, y: 1 }, { t: 'barrel', x: 28, y: 3 },
        { t: 'rug', x: 6, y: 2, w: 18, h: 6, tint: 'deck' },
        { t: 'table', x: 14, y: 4 },
        { t: 'chair', x: 13, y: 5 }, { t: 'chair', x: 16, y: 5 },
        { t: 'bookshelf', x: 5, y: 1 }, { t: 'bookshelf', x: 24, y: 1 },
        { t: 'sofa', x: 1, y: 6, k: 'shelter_seat', label: '避难座椅' },
        { t: 'sofa', x: 27, y: 6 },
        { t: 'crate', x: 13, y: 8, k: 'supply', label: '补给箱' },
        { t: 'crate', x: 15, y: 8 },
        { t: 'lamp', x: 6, y: 8 }, { t: 'lamp', x: 23, y: 8 },
        /* 〔批 UI-7〕中段补密度：储物架 / 座椅 */
        { t: 'rack', x: 8, y: 3 }, { t: 'rack', x: 21, y: 3 },
        { t: 'chair', x: 11, y: 6 }, { t: 'chair', x: 18, y: 6 },
        { t: 'plant', x: 9, y: 8 }, { t: 'plant', x: 20, y: 8 },
      ],
    },
    dorms: {
      /* 〔批 UI-7〕宿舍是唯一一间暖色地面（地毯），其余八间都是金属/实验地板。
         暖色在深色舱壁旁对比很强，实测比别的房间"亮一整档" —— 用 dim 0.46 压回来。
         dim 是每间房可选的地板压暗强度（默认 0.34，渲染器见 floorWallShell）。 */
      name: '宿舍', floor: 'floor-carpet-beige', dim: 0.46,
      wall: ['wall-light', 'wall-window-planet', 'wall-light', 'wall-window'],
      size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 't' }, { to: 'armory', side: 'r' }, { to: 'safe', side: 'l' }],
      /* 15 个睡眠舱：5 列 × 3 排，**整块居中**（批 UI-7）。
         旧版 x0=3 起步 ⇒ 舱块占 x3~14.4，中线 8.7，画面整块压在左边、右边空一半。
         现在 x0=9.3：5 列间距 2.6 ⇒ 最后一列 19.7，舱块 9.3~20.7，中线正好 15。
         左右两侧因此腾出对称的两条边带，放储物柜 / 书架 / 终端。 */
      pods: { x0: 9.3, y0: 1, dx: 2.6, dy: 3, cols: 5, rows: 3, n: 15 },
      props: [
        { t: 'rug', x: 13, y: 3, w: 4, h: 4, tint: 'deck' },
        { t: 'locker', x: 1, y: 1 }, { t: 'locker', x: 1, y: 3 },
        { t: 'locker', x: 28, y: 1, k: 'locker', label: '储物柜' },
        { t: 'locker', x: 28, y: 3 },
        { t: 'terminal', x: 1, y: 6, k: 'terminal', label: '个人终端' },
        { t: 'bookshelf', x: 28, y: 6 },
        /* 下沿一条：左桌椅组 + 公告板 + 右桌椅组，**严格对称**（中线 15）。
           〔批 UI-7〕旧版只有左边一组桌椅 + 右边的公告板，中央带质心偏左 1.25 格，
           整间房读作"往左歪"（门禁 S4 会报）。 */
        { t: 'chair', x: 8, y: 9 }, { t: 'table', x: 9, y: 9, k: 'common_table', label: '公共桌' },
        { t: 'chair', x: 11, y: 9 },
        { t: 'screen', x: 14, y: 9, k: 'notice', label: '公告板' },
        { t: 'chair', x: 18, y: 9 }, { t: 'table', x: 19, y: 9, k: 'night_table', label: '值夜桌' },
        { t: 'chair', x: 21, y: 9 },
        { t: 'lamp', x: 6, y: 1 }, { t: 'lamp', x: 23, y: 1 },
        /* 〔批 UI-7〕舱块居中后两侧腾出两条边带，这里补上（原来只有柜子） */
        { t: 'bookshelf', x: 3, y: 4 }, { t: 'bookshelf', x: 26, y: 4 },
        { t: 'plant', x: 3, y: 6 }, { t: 'plant', x: 26, y: 6 },
        { t: 'plant', x: 5, y: 9 }, { t: 'plant', x: 24, y: 9 },
        { t: 'bin', x: 1, y: 8 }, { t: 'bin', x: 28, y: 8 },
      ],
    },
  };

  /* ---- 门：房间 → 出入口（由 doors 派生，供渲染热区） ---- */
  function doorsOf(room) {
    return (ROOMS[room] && ROOMS[room].doors) || [];
  }

  /* ---- 门在房间边界上的锚点（格坐标） ---- */
  /* 〔批 M1 · 2026-10-28〕door.at = **沿墙偏移**（格，从该墙起点算；缺省居中）。
     米字+环布局里舰桥要接 8 条辐条（四侧各两扇），"每侧一扇"装不下；
     与 ship-map.js 的 doorPoint(room, side, at) 同一口径（改一处必须改另一处）。 */
  function doorAnchor(room, door) {
    const r = ROOMS[room]; if (!r) return null;
    const [w, h] = r.size;
    const at = (door.at == null) ? null : door.at;
    switch (door.side) {
      case 't': return { x: at == null ? w / 2 : at, y: 0 };
      case 'b': return { x: at == null ? w / 2 : at, y: h };
      case 'l': return { x: 0, y: at == null ? h / 2 : at };
      case 'r': return { x: w, y: at == null ? h / 2 : at };
      default: return null;
    }
  }

  /* ---- 15 席座位坐标（舰桥专用；参数角均分，与 R2 的结论一致） ---- */
  function seatPositions(room) {
    const r = ROOMS[room]; if (!r || !r.seats) return [];
    const s = r.seats, out = [];
    for (let i = 0; i < s.n; i++) {
      const a = (i / s.n) * Math.PI * 2 + Math.PI / 2;
      out.push({ i: i + 1, x: s.cx + Math.cos(a) * s.rx, y: s.cy + Math.sin(a) * s.ry, a });
    }
    return out;
  }

  /* ---- 睡眠舱坐标 ---- */
  function podPositions(room) {
    const r = ROOMS[room]; if (!r || !r.pods) return [];
    const p = r.pods, out = [];
    for (let i = 0; i < p.n; i++) {
      out.push({ i: i + 1, x: p.x0 + (i % p.cols) * p.dx, y: p.y0 + Math.floor(i / p.cols) * p.dy });
    }
    return out;
  }

  /* ---- 墙面装饰瓦片序列（渲染器沿上壁逐格循环） ----
     没有声明 wall 的房间回落到空墙 'wall' —— 渲染器不因此崩，
     但门禁 S1 会红（"这间房没接墙面材质"）。 */
  function wallTiles(room) {
    const r = ROOMS[room];
    return (r && r.wall && r.wall.length) ? r.wall : ['wall'];
  }

  /* ---- 自检：布局合法性（门禁直接调用，不需要浏览器） ----
     判据：
       ① 每个道具都落在房间内（含 1 格边距，避免贴墙穿模）
       ② 同房间道具矩形互不重叠
       ③ 门的两端房间都存在，且对方也声明了反向门
       ④ 舰桥座位数为 15，宿舍睡眠舱数为 15 */
  function validate() {
    const errs = [];
    for (const id in ROOMS) {
      const r = ROOMS[id];
      const [W, H] = r.size;
      const boxes = [];
      for (const p of r.props) {
        const d = PROP[p.t];
        if (!d) { errs.push(id + ' 未知道具类型 ' + p.t); continue; }
        const w = p.w || d.w, h = p.h || d.h;
        if (p.x < 0 || p.y < 0 || p.x + w > W || p.y + h > H) {
          errs.push(id + ' 道具 ' + p.t + ' 越界 @' + p.x + ',' + p.y);
        }
        /* 地毯 / 地标属于"地面装饰层"，桌子椅子本就压在上面，不参与重叠判定 */
        if (p.t !== 'rug' && !p.decal) boxes.push({ t: p.t, x: p.x, y: p.y, w, h });
      }
      for (let a = 0; a < boxes.length; a++) {
        for (let b = a + 1; b < boxes.length; b++) {
          const A = boxes[a], B = boxes[b];
          if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h) {
            errs.push(id + ' 道具重叠 ' + A.t + ' × ' + B.t);
          }
        }
      }
      for (const d of r.doors) {
        if (!ROOMS[d.to]) { errs.push(id + ' 门指向不存在的房间 ' + d.to); continue; }
        const back = ROOMS[d.to].doors.some(x => x.to === id);
        if (!back) errs.push(id + ' → ' + d.to + ' 缺反向门');
        if (!doorAnchor(id, d)) errs.push(id + ' 门朝向非法 ' + d.side);
      }
      if (id === 'bridge' && seatPositions(id).length !== 15) errs.push('舰桥座位数不是 15');
      if (id === 'dorms' && podPositions(id).length !== 15) errs.push('宿舍睡眠舱数不是 15');
    }
    return errs;
  }

  /* ---- 统计：给门禁用的纯函数（不参与渲染） ----
     solidBoxes: 该房间**不透明**家具的矩形（地毯等装饰层排除）
     midOffset : 家具**面积加权**的 x 质心与房间中线之差（格）
       为什么用面积加权而不是"包围盒中心"：包围盒只看最左和最右两件，
       中间整片空着也判"对称"（旧版各房就是这个状态）。
     density   : 家具占房面积比（%）—— 用户反复说的"房间显得空"就是这个数。 */
  function solidBoxes(room) {
    const r = ROOMS[room]; if (!r) return [];
    const out = [];
    for (const p of r.props) {
      if (p.t === 'rug' || p.decal) continue;
      const d = PROP[p.t]; if (!d) continue;
      out.push({ t: p.t, x: p.x, y: p.y, w: p.w || d.w, h: p.h || d.h });
    }
    return out;
  }

  /* 中轴对称度：**只量中央带**（|x - 中线| <= 8 格）的家具质心偏移。
     -------------------------------------------------------------
     为什么不量整间房：靠墙那两列本来就该长得不一样 —— 医疗室左边是三张病床、
     右边是药柜/抑制器/冷柜；宿舍左边是储物柜、右边是书架。逐件镜像反而假。
     玩家眼里的"房间歪了"来自**中间那片空地**偏左或偏右，所以只量那里。
     容差 0.6 格（约 34px @ TILE 56），超过就是真的歪。 */
  function midOffset(room) {
    const r = ROOMS[room]; if (!r) return 0;
    const mid = r.size[0] / 2, band = 8;
    let sum = 0, wsum = 0;
    for (const b of solidBoxes(room)) {
      const cx = b.x + b.w / 2;
      if (Math.abs(cx - mid) > band) continue;      /* 靠墙家具不参与 */
      const a = b.w * b.h;
      sum += cx * a; wsum += a;
    }
    return wsum ? (sum / wsum) - mid : 0;
  }

  function density(room) {
    const r = ROOMS[room]; if (!r) return 0;
    let a = 0;
    for (const b of solidBoxes(room)) a += b.w * b.h;
    return (a / (r.size[0] * r.size[1])) * 100;
  }

  global.SKSpace = {
    ROOM_W: ROOM_W, ROOM_H: ROOM_H, MID_X: MID_X,
    PROP: PROP, ROOMS: ROOMS,
    ids: function () { return Object.keys(ROOMS); },
    room: function (id) { return ROOMS[id] || null; },
    doorsOf: doorsOf, doorAnchor: doorAnchor,
    seatPositions: seatPositions, podPositions: podPositions,
    wallTiles: wallTiles,
    solidBoxes: solidBoxes, midOffset: midOffset, density: density,
    validate: validate,
  };
})(typeof window !== 'undefined' ? window : globalThis);
