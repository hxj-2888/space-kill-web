/* =============================================================
 * 返航录 · 房间布局数据（批 U1）
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

  /* ---- 房间尺寸（格）：22 × 14，与 Blender 版一致 ---- */
  const ROOM_W = 22;
  const ROOM_H = 14;

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
     k（交互键）只用于**发起行动**，不是新的提交路径 —— 仍委托 #f-targets / 提交按钮。 */
  const ROOMS = {
    bridge: {
      name: '舰桥', floor: 'floor-steel', size: [ROOM_W, ROOM_H],
      doors: [{ to: 'dorms', side: 'b' }, { to: 'safe', side: 't' },
              { to: 'verify', side: 'l' }, { to: 'patrol', side: 'r' }],
      /* 圆桌居中；15 座由渲染器按角度算（见 SEATS） */
      props: [
        { t: 'rug', x: 7, y: 5, w: 8, h: 4, tint: 'deck' },
        { t: 'table', x: 10, y: 6, w: 4, h: 2, k: 'round_table', label: '圆桌' },
        { t: 'console', x: 2, y: 11, k: 'nav', label: '导航台' },
        { t: 'console', x: 18, y: 11, k: 'nav', label: '导航台' },
        { t: 'screen', x: 9, y: 1, k: 'monitor', label: '舰桥大屏' },
        { t: 'plant', x: 1, y: 1 }, { t: 'plant', x: 20, y: 1 },
        { t: 'tallplant', x: 1, y: 12 }, { t: 'tallplant', x: 20, y: 12 },
      ],
      seats: { cx: 11, cy: 7, rx: 5.2, ry: 3.2, n: 15 },
    },
    verify: {
      name: '查证室', floor: 'floor-lab', size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 'r' }, { to: 'medical', side: 'l' }],
      props: [
        { t: 'screen', x: 9, y: 1, k: 'board', label: '证据板' },
        { t: 'desk', x: 9, y: 6, k: 'interrogate', label: '审讯桌' },
        { t: 'chair', x: 9, y: 5 }, { t: 'chair', x: 11, y: 8 },
        { t: 'locker', x: 19, y: 2, k: 'locker', label: '证据柜' },
        { t: 'locker', x: 19, y: 4 },
        { t: 'console', x: 3, y: 11, k: 'fingerprint', label: '指纹仪' },
        { t: 'terminal', x: 15, y: 11, k: 'terminal', label: '档案终端' },
        { t: 'plant', x: 1, y: 1 },
      ],
    },
    medical: {
      name: '医疗室', floor: 'floor-lab', size: [ROOM_W, ROOM_H],
      doors: [{ to: 'verify', side: 'r' }, { to: 'pharma', side: 'l' }],
      props: [
        { t: 'bed', x: 2, y: 2, k: 'bed1', label: '病床一' },
        { t: 'bed', x: 2, y: 5, k: 'bed2', label: '病床二' },
        { t: 'bed', x: 2, y: 8, k: 'bed3', label: '病床三' },
        { t: 'lamp', x: 4, y: 2 }, { t: 'lamp', x: 4, y: 5 }, { t: 'lamp', x: 4, y: 8 },
        { t: 'table', x: 10, y: 6, k: 'surgery', label: '手术台' },
        { t: 'screen', x: 10, y: 1, k: 'monitor', label: '监护屏' },
        { t: 'fridge', x: 19, y: 2, k: 'medicine', label: '药柜' },
        { t: 'sink', x: 19, y: 5 },
        { t: 'bin', x: 19, y: 10, k: 'biohazard', label: '医疗废物箱' },
        { t: 'plant', x: 6, y: 11 },
      ],
    },
    pharma: {
      name: '制药室', floor: 'floor-steel-bolts', size: [ROOM_W, ROOM_H],
      doors: [{ to: 'medical', side: 'r' }],
      props: [
        { t: 'desk', x: 2, y: 3, k: 'bench1', label: '实验台一' },
        { t: 'desk', x: 2, y: 7, k: 'bench2', label: '实验台二' },
        { t: 'console', x: 6, y: 3, k: 'centrifuge', label: '离心机' },
        { t: 'rack', x: 18, y: 2, k: 'reagent', label: '试剂架' },
        { t: 'rack', x: 20, y: 2 },
        { t: 'fridge', x: 18, y: 5, k: 'coldstorage', label: '冷藏柜' },
        { t: 'sink', x: 9, y: 11 },
        { t: 'bin', x: 2, y: 11 },
        { t: 'terminal', x: 12, y: 11, k: 'terminal', label: '配方终端' },
      ],
    },
    patrol: {
      name: '巡逻岗', floor: 'floor-grate', size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 'l' }, { to: 'repair', side: 'r' }],
      props: [
        { t: 'screen', x: 2, y: 1, k: 'monitor_wall', label: '监控墙' },
        { t: 'screen', x: 5, y: 1 },
        { t: 'screen', x: 8, y: 1 },
        { t: 'table', x: 9, y: 6, k: 'patrol_map', label: '巡逻图' },
        { t: 'console', x: 16, y: 6, k: 'security', label: '安防台' },
        { t: 'locker', x: 19, y: 9, k: 'weapon_locker', label: '武器柜' },
        { t: 'terminal', x: 2, y: 11, k: 'terminal', label: '值班终端' },
      ],
    },
    repair: {
      name: '船舱', floor: 'floor-steel-vent', size: [ROOM_W, ROOM_H],
      doors: [{ to: 'patrol', side: 'l' }, { to: 'armory', side: 'r' }],
      props: [
        { t: 'rack', x: 2, y: 2, k: 'engine', label: '引擎组' },
        { t: 'rack', x: 3, y: 2 },
        { t: 'rack', x: 4, y: 2 },
        { t: 'barrel', x: 2, y: 5 }, { t: 'barrel', x: 3, y: 5 },
        { t: 'rug', x: 9, y: 6, w: 4, h: 3, k: 'lift', label: '升降台', tint: 'warn' },
        { t: 'console', x: 15, y: 6, k: 'parts', label: '零件台' },
        { t: 'crate', x: 6, y: 11 }, { t: 'crate', x: 7, y: 11 }, { t: 'crate', x: 6, y: 10 },
        { t: 'rack', x: 19, y: 9, k: 'tool_rack', label: '工具架' },
        { t: 'screen', x: 9, y: 1, k: 'gauge', label: '压力表' },
      ],
    },
    armory: {
      name: '军械库', floor: 'floor-hazard', size: [ROOM_W, ROOM_H],
      doors: [{ to: 'repair', side: 'l' }],
      props: [
        { t: 'rack', x: 2, y: 2, k: 'weapon_rack', label: '枪架' },
        { t: 'rack', x: 4, y: 2 }, { t: 'rack', x: 6, y: 2 },
        { t: 'screen', x: 18, y: 5, k: 'target', label: '靶道' },
        { t: 'crate', x: 9, y: 8, k: 'ammo', label: '弹药箱' },
        { t: 'crate', x: 10, y: 8 }, { t: 'crate', x: 9, y: 7 },
        { t: 'locker', x: 19, y: 9, k: 'locker', label: '储物柜' },
        { t: 'desk', x: 5, y: 6, k: 'workbench', label: '工作台' },
      ],
    },
    safe: {
      name: '安全室', floor: 'floor-carpet-blue', size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 'b' }],
      props: [
        { t: 'screen', x: 9, y: 1, k: 'oxygen', label: '氧气监测' },
        { t: 'barrel', x: 2, y: 2 }, { t: 'barrel', x: 3, y: 2 },
        { t: 'barrel', x: 2, y: 4 }, { t: 'barrel', x: 3, y: 4 },
        { t: 'sofa', x: 16, y: 3, k: 'shelter_seat', label: '避难座椅' },
        { t: 'sofa', x: 16, y: 5 },
        { t: 'crate', x: 9, y: 11, k: 'supply', label: '补给箱' },
        { t: 'crate', x: 11, y: 11 },
        { t: 'lamp', x: 1, y: 10 }, { t: 'lamp', x: 20, y: 10 },
      ],
    },
    dorms: {
      name: '宿舍', floor: 'floor-steel', size: [ROOM_W, ROOM_H],
      doors: [{ to: 'bridge', side: 't' }],
      /* 15 个睡眠舱：3 排 × 5 列，由渲染器按 pods 参数展开 */
      pods: { x0: 2, y0: 2, dx: 2.6, dy: 3.2, cols: 5, rows: 3, n: 15 },
      props: [
        { t: 'locker', x: 19, y: 2, k: 'locker', label: '储物柜' },
        { t: 'locker', x: 19, y: 4 },
        { t: 'table', x: 8, y: 11, k: 'common_table', label: '公共桌' },
        { t: 'chair', x: 7, y: 10 }, { t: 'chair', x: 10, y: 10 },
        { t: 'terminal', x: 14, y: 10, k: 'terminal', label: '个人终端' },
        { t: 'screen', x: 9, y: 1, k: 'notice', label: '公告板' },
      ],
    },
  };

  /* ---- 门：房间 → 出入口（由 doors 派生，供渲染热区） ---- */
  function doorsOf(room) {
    return (ROOMS[room] && ROOMS[room].doors) || [];
  }

  /* ---- 门在房间边界上的锚点（格坐标） ---- */
  function doorAnchor(room, door) {
    const r = ROOMS[room]; if (!r) return null;
    const [w, h] = r.size;
    switch (door.side) {
      case 't': return { x: w / 2, y: 0 };
      case 'b': return { x: w / 2, y: h };
      case 'l': return { x: 0, y: h / 2 };
      case 'r': return { x: w, y: h / 2 };
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

  global.SKSpace = {
    ROOM_W: ROOM_W, ROOM_H: ROOM_H,
    PROP: PROP, ROOMS: ROOMS,
    ids: function () { return Object.keys(ROOMS); },
    room: function (id) { return ROOMS[id] || null; },
    doorsOf: doorsOf, doorAnchor: doorAnchor,
    seatPositions: seatPositions, podPositions: podPositions,
    validate: validate,
  };
})(typeof window !== 'undefined' ? window : globalThis);