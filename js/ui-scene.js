/* =============================================================
 * 返航录 · 房间场景渲染器（批 U1 · 重写）
 * -------------------------------------------------------------
 * 与旧版（备份在 backup/ui-scene-R2.js）的差别：
 *   ① **房间制**：一次只画一个房间，不再是"圆桌 + 8 张房间卡"的拼盘；
 *   ② **素材统一**：地板/墙/家具/角色全部来自 assets/scene/cozy/
 *      （同一作者 Bramble & Byte，同一调色板 16px 网格，CC-BY 必须署名）；
 *   ③ **数据驱动**：布局来自 js/space.js 的 SKSpace（道具坐标、门、座位），
 *      本文件只负责"把数据画成 DOM"；
 *   ④ **点击导航**：点房间里的门 → 切场景；点道具 → 委托既有表单控件。
 *
 * 不变量（红线，改这个文件时逐条守）：
 *   · 只读 g.phase / g.pending + V = View.viewFor 的裁剪视图，不读引擎内部；
 *   · **不新建提交路径**：点道具只 click 既有 #f-targets / #btn-submit，
 *     房间层里出现 Game.submit 即判红（门禁 主区O 守这条）；
 *   · 控件语义零变更：input 的 id/name/value/disabled 一律不碰。
 *
 * 坐标系：场景用 viewBox 1600×1000（与 R2 的 1600×900 兼容，多 100 给房间底部信息条）。
 *   房间本地坐标（格）× TILE(44) 平移到房间偏移。
 * ============================================================= */
(function (global) {
  'use strict';
  const N = 15;
  /* 〔批 UI-6 · 2026-10-26〕一格 56，画布 = 房间本身（1680×616）。
     -------------------------------------------------------------
     房间改成 30×11 之后，宽高比 2.727 与主区（1568×581 = 2.699）几乎一致 ——
     所以这次画布**直接取房间尺寸**，meet 缩放时高度和宽度同时吃满，
     不再有任何"画布比房间大"的余量，也就不再有黑边。

     旧值（58 / 2400×1000）是给 26×17 的竖长房间用的，那时画布必须比房间宽很多，
     否则房间会被裁；现在房间本身已经是横的，那层补偿不再需要。 */
  const TILE = 56;
  const ASSET = 'assets/scene/cozy/';
  /* 画布 = 30×11 格 = 1680×616。
     【注意】画布可以略大于房间（例如留 1 格边距给门热区），但不能小于房间 ——
       小于房间时 SVG 会把房间裁掉（批 UI-5 就因此丢过「宿舍」门，玩家点不到）。
     这里四周各留 0 格：门热区是**压在墙上的矩形**（见 roomHtml），不越出房间边界。 */
  const VB = { w: 1680, h: 616 };

  /* 席位 15 色（与 space.js 的座位顺序对齐；仅用于底座光环） */
  const PALETTE = ['#ff6b6b', '#ff922b', '#fcc419', '#c0eb75', '#69db7c', '#38d9a9', '#3bc9db',
    '#4dabf7', '#748ffc', '#9775fa', '#da77f2', '#e64980', '#f783ac', '#ffe066', '#94d82d'];
  const MINE = '#ffd43b';

  /* 角色行走图：4 列 × 5 行，单帧 96×160（4x）
     〔批 UI-2 · 2026-10-26〕15 席各有独立行走图（`assets/scene/crew/crew-NN.png`），
     由 `tools/gen-crew-sprites.cjs` 生成。此前只有 8 套（CC-BY 的 Walking Crew），
     用 `(p.id-1) % 8` 循环复用 ⇒ 1 号与 9 号穿同一件衣服、只有脚下光环不同。
     现在一对一，且**外观与本局身份完全无关**（只按席位号取，不读 role/faction ——
     否则等于泄露阵营，违 7.0 防透视）。版式与旧素材逐项相同，故渲染与 CSS 帧动画零改动。 */
  const CREW_W = 96, CREW_H = 160;
  const CREW_COUNT = 15;
  const CREW_FILE = id => 'crew-' + String(((id - 1) % CREW_COUNT) + 1).padStart(2, '0');

  /* 〔批 UI-7 · 2026-10-27〕行走图的**可见内容**占比（实测，不是估计）
     -------------------------------------------------------------
     15 套行走图都是 4 列 × 5 行、单帧 96×160，但每帧里的角色只占：
       待机帧 y 48..159（高 112 / 160 = 0.70）、x 20..79（宽 60 / 96 = 0.625）
     旧代码按**帧框**定尺寸（w = TILE*0.92），于是画出来的角色只有 32×60，
     比座圈还窄 —— 15 席看着像"点"。本批改成按**可见宽**定尺寸：
     可见宽度固定 = 1.15 格（TILE×1.15 = 64.4px），再把帧框反推回去。
     这样换图（只要版式还是 4×5 / 96×160）不用重调这三个常数。 */
  const CREW_VIS_W = 60 / CREW_W;   /* 可见宽 / 帧宽 */
  const CREW_VIS_H = 112 / CREW_H;  /* 可见高 / 帧高（待机行） */
  const CREW_VIS_TILES = 1.15;      /* 可见宽 = 多少格 */
  const CREW_BOX = {
    w: function () { return (TILE * CREW_VIS_TILES) / CREW_VIS_W; },
    h: function () { return ((TILE * CREW_VIS_TILES) / CREW_VIS_W) * (CREW_H / CREW_W); },
    visW: function () { return TILE * CREW_VIS_TILES; },
    visH: function () { return ((TILE * CREW_VIS_TILES) / CREW_VIS_W) * (CREW_H / CREW_W) * CREW_VIS_H; },
  };
  /* 行序：0 下走 / 1 上走 / 2 待机 / 3 左走 / 4 右走 */
  const ROW_IDLE = 2;

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function el(id) { const d = global.document; return d && d.getElementById ? d.getElementById(id) : null; }
  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }

  /* =============================================================
   * 房间几何：把 space.js 的格坐标换算成场景坐标
   * ============================================================= */
  const ROOM_ID_DEFAULT = 'bridge';
  let curRoom = ROOM_ID_DEFAULT;
  /* 〔U2〕入场行走：切换房间/阶段时，角色从门快步走到落点。
     用时间戳而不是 setTimeout —— 重绘是幂等的，重绘时按剩余时长决定是否还在走。 */
  const WALK_MS = 900;
  let walkUntil = 0;

  function roomOrigin(S) {
    const r = S.room(curRoom) || S.room(ROOM_ID_DEFAULT);
    const [w, h] = r.size;
    return { x: (VB.w - w * TILE) / 2, y: (VB.h - h * TILE) / 2, w: w * TILE, h: h * TILE, r };
  }

  /* =============================================================
   * 〔批 UI-7 · 2026-10-27〕房间外壳（地板 + 四壁 + 门）——**唯一一份**
   * -------------------------------------------------------------
   * 为什么重写：批 UI-6 之前，对局页 roomHtml() 与主页 renderHomeScene()
   * 各写了一份"地板 pattern + 四壁 + 踢脚线"，两处参数已经开始漂移
   * （主页 opacity .42 / 对局 .34）。
   *
   * 更关键的是**素材没接线**：9 间房共用同一张 wall.png（空白灰墙），
   * 而 cozy 包里 7 种墙面变体与 12 种地板一直躺在 assets/ 里零引用。
   * 截图后果：走遍 9 间房，墙都是同一面白灰，房间读起来像"同一间房换家具"；
   * 而且上壁 1.35 格以下、踢脚线以上是一片死白（"黑区"的另一半）。
   *
   * 现在由 js/space.js 每间房声明 wall[]（上壁稀疏挂的墙饰），本函数只消费。
   * wall 里名字的合法性由 test-space 的 S1~S3 守。
   *
   * 参数：
   *   o     = { x, y, w, h } 房间矩形（场景坐标）
   *   r     = space.js 的房间对象
   *   id    = 房间 id（前缀 pattern / clipPath 用，避免同页多实例串号）
   *   dim   = 地板压暗强度（对局页 0.34；主页更暗，让"预览"读作未入场）
   * ============================================================= */
  function floorWallShell(S, o, r, id, dim) {
    const PT = TILE;   /* 一张素材在场景里的边长 = 1 格 */
    const fpat = 'sk-floor-' + id, wpat = 'sk-wall-' + id, wclip = 'sk-wallclip-' + id;
    let html = '';

    /* ---- 地板：整间平铺 ---- */
    html += '<defs><pattern id="' + fpat + '" width="' + PT + '" height="' + PT
      + '" patternUnits="userSpaceOnUse"><image href="' + ASSET + 'tiles/' + r.floor
      + '.png" width="' + PT + '" height="' + PT
      + '" image-rendering="pixelated"/></pattern></defs>';
    html += '<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h
      + '" fill="url(#' + fpat + ')"/>';

    /* 〔批 UI-7〕地板高光**不画**（试过两版，都撤了）。
       试过两版：6 格间距 × 两行不透明 ⇒ floor-hazard 房间读作"泼了油漆"；
       8 格间距 × 单行 45% ⇒ 每间房地上多出 4 块半透明方斑，像贴图没对齐。
       根本原因：accent 素材是**整块地板瓦片**而不是叠加层，叠在另一张地板上
       只会得到"两种地砖拼在一起"，不会得到"高光"。
       所以房间之间的地面差异改由 floor 本身承担（9 间房 6 种地板），
       将来真要做高光，得是**叠加层**（半透明亮斑），不能是整块地板瓦片。 */

    /* ---- 地板压暗：地砖本身很亮，压一层让家具与角色浮出来（仍保留纹理） ---- */
    html += '<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + o.h
      + '" fill="#0a1524" opacity="' + dim + '"/>';

    /* ---- 四壁 ----
       素材是 32×64（墙顶 1 格 + 墙面 1 格）：
         · 上壁 2 格高 = 完整一段墙（顶 + 面）；
         · 左右壁各 0.55 格宽（只借"墙面"那条，不重复贴墙顶）。

       〔批 UI-7〕墙面装饰**稀疏摆放**，不逐格循环。
       第一版是"每列按 wall[] 轮换"，实测截图上变成一条 12 块屏的"胶片带"——
       比原来的空白灰墙更糟：装饰一旦每格都有，就不再是装饰，而是噪声。
       现在：底座整条贴 wall.png，wall[] 里的变体按**等距**撒上去
       （4 张装饰 → 30 格上每 7~8 格一个），读作"舱壁上零星挂着东西"。 */
    const tiles = S.wallTiles ? S.wallTiles(id) : ['wall'];
    const nCols = Math.ceil(r.size[0]);
    /* 侧壁 pattern：**永远是空白墙 wall.png**，不是墙饰表里的第一张。
       注意：第一版这里写的是 tiles[0]，于是舰桥的"底座"本身就成了 wall-screen
         的无限平铺 —— 装饰失去了稀疏性，整条上壁又变回"胶片带"。
         底座负责"这面墙是什么颜色"，装饰负责"上面挂了什么"，两者不能混用。
       放在这里而不是用到的地方 —— url(#…) 前向引用在部分浏览器下取不到。 */
    html += '<defs><pattern id="' + wpat + '" width="' + TILE + '" height="' + (TILE * 2)
      + '" patternUnits="userSpaceOnUse"><image href="' + ASSET + 'tiles/wall.png" width="'
      + TILE + '" height="' + (TILE * 2) + '" image-rendering="pixelated"/></pattern></defs>';
    html += '<defs><clipPath id="' + wclip + '"><rect x="' + o.x + '" y="' + o.y
      + '" width="' + o.w + '" height="' + (TILE * 2) + '"/></clipPath></defs>';
    html += '<g clip-path="url(#' + wclip + ')">';
    /* 底座：整条空墙 */
    html += '<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + (TILE * 2)
      + '" fill="url(#' + wpat + ')"/>';
    /* 装饰：等距落位（跳过左右壁那 0.55 格，免得压在边梁上） */
    for (let k = 0; k < tiles.length; k++) {
      const col = Math.round((k + 1) * nCols / (tiles.length + 1)) - 1;
      if (col < 1 || col > nCols - 2) continue;
      html += '<image href="' + ASSET + 'tiles/' + tiles[k] + '.png" x="' + (o.x + col * TILE)
        + '" y="' + o.y + '" width="' + TILE + '" height="' + (TILE * 2)
        + '" image-rendering="pixelated"/>';
    }
    html += '</g>';

    /* 墙面压暗：素材本身是接近纯白的（#E9EEF0），铺满 2 格高 × 30 格宽后
       是画面里最亮的一块，眼睛会先被它吸住 —— 这是用户反复说的"白区"。
       压一层 #0a1524 / 0.26 之后，它读作"舱壁在船内灯光下的样子"，
       与深色地板接得上，装饰瓦片（屏/舷窗/管线）反而更跳得出来。 */
    html += '<rect x="' + o.x + '" y="' + o.y + '" width="' + o.w + '" height="' + (TILE * 2)
      + '" fill="#0a1524" opacity="0.26"/>';

    /* 左右壁（0.55 格宽，只借"墙面"那条） */
    html += '<rect x="' + o.x + '" y="' + o.y + '" width="' + (TILE * 0.55) + '" height="' + o.h
      + '" fill="url(#' + wpat + ')"/>';
    html += '<rect x="' + (o.x + o.w - TILE * 0.55) + '" y="' + o.y + '" width="' + (TILE * 0.55)
      + '" height="' + o.h + '" fill="url(#' + wpat + ')"/>';

    /* 下壁：只留一条暗色踢脚（否则会挡住房间底部的角色） */
    html += '<rect x="' + o.x + '" y="' + (o.y + o.h - TILE * 0.28) + '" width="' + o.w
      + '" height="' + (TILE * 0.28) + '" fill="#0a1220" opacity="0.9"/>';

    /* 房间外圈光：把场景从背景里"托"起来 */
    html += '<rect x="' + (o.x - 8) + '" y="' + (o.y - 8) + '" width="' + (o.w + 16)
      + '" height="' + (o.h + 16) + '" fill="none" stroke="#2a4a6e" stroke-width="3" rx="8"/>';
    return html;
  }

  /* 房间背景：地板平铺 + 四壁 + 门 */
  function roomHtml(S) {
    const o = roomOrigin(S);
    const r = o.r;
    let html = '<g class="sk-room-floor">';
    /* 〔批 UI-5〕画布**不铺**整张地板：房间以外留给 CSS 的船体内衬 + 暗角。
       〔批 UI-8a〕那层内衬已从"开源社区写实背景图"换成**本仓自绘**的无缝舱壁瓦片
       （.scene-mount::before 的 hull-tile.png + .scene-mount::after 的暗角）。 */
    /* 每间房可用 space.js 的 dim 覆盖地板压暗强度（暖色地板需要压得更深） */
    html += floorWallShell(S, o, r, curRoom, r.dim != null ? r.dim : 0.34);

    /* ---- 门：墙面上的开口 + 可点热区 ----
       〔批 UI-7〕旧版门只是一块描边矩形（fill #0b1424），读作"墙上贴了张蓝框标签"。
       现在先贴 cozy 的 door-open 素材做**开口**，再在上面盖热区。
       上下两侧的门按 side 旋转 90°（素材是竖版 32×64）。
       〔批 UI-6 的约束仍然有效〕热区必须整块落在房间内 —— 见下方按 side 收边。 */
    for (const d of r.doors) {
      const a = S.doorAnchor(curRoom, d);
      if (!a) continue;
      const px = o.x + a.x * TILE, py = o.y + a.y * TILE;
      const horiz = (d.side === 't' || d.side === 'b');
      const dw = horiz ? TILE * 2 : TILE * 0.7, dh = horiz ? TILE * 0.7 : TILE * 2;
      /* 〔批 UI-6 · 2026-10-26〕门热区**必须整块落在房间内**。
         画布现在等于房间尺寸（TILE 56 / 1680×616），而门锚点就在房间边界上
         （side='l' 的锚点 x=0），以锚点为中心画 0.7×2 格的矩形 ⇒ 一半在画布外，
         实测左右两侧的门各被裁掉一半、标签显示成「查室」「制药室」。
         现在按 side 把矩形**收进边界内侧**：完整可见、完整可点。 */
      let rx, ry;
      if (d.side === 'l') { rx = o.x; ry = py - dh / 2; }
      else if (d.side === 'r') { rx = o.x + o.w - dw; ry = py - dh / 2; }
      else if (d.side === 't') { rx = px - dw / 2; ry = o.y; }
      else { rx = px - dw / 2; ry = o.y + o.h - dh; }
      /* 门洞素材：竖门直接贴；横门**旋转 90°**，不是把 32×64 拉成 2:0.7。
         注意：第一版是"交换 width/height"——那是拉伸，门框与门板的像素比例会被拉歪，
           截图上门变成一片浅色长方形。这里用 rotate 围绕矩形中心转，保持像素比例。 */
      if (horiz) {
        const cx = rx + dw / 2, cy = ry + dh / 2;
        html += '<image class="sk-door-art" pointer-events="none" href="' + ASSET
          + 'tiles/door-open.png" x="' + (cx - dh / 2) + '" y="' + (cy - dw / 2)
          + '" width="' + dh + '" height="' + dw
          + '" transform="rotate(90 ' + cx + ' ' + cy + ')"'
          + ' image-rendering="pixelated" opacity="0.95"/>';
      } else {
        html += '<image class="sk-door-art" pointer-events="none" href="' + ASSET
          + 'tiles/door-open.png" x="' + rx + '" y="' + ry + '" width="' + dw + '" height="' + dh
          + '" image-rendering="pixelated" opacity="0.95"/>';
      }
      html += '<rect class="sk-door" data-door="' + escAttr(d.to) + '" x="' + rx
        + '" y="' + ry + '" width="' + dw + '" height="' + dh
        + '" fill="none" stroke="#4dabf7" stroke-width="2" rx="4"/>';
      /* 标签也收进矩形内侧（不再压在墙上被裁） */
      const tx = rx + dw / 2, ty = ry + dh / 2 + 4;
      html += '<text class="sk-door-t" x="' + tx + '" y="' + ty
        + '" text-anchor="middle">' + escAttr((S.room(d.to) || {}).name || d.to) + '</text>';
    }

    /* 房名 */
    html += '<text class="sk-room-name" x="' + (o.x + 14) + '" y="' + (o.y + 34) + '">'
      + escAttr(r.name) + '</text>';
    html += '</g>';
    return html;
  }

  /* 家具层 */
  function propsHtml(S) {
    const o = roomOrigin(S);
    const r = o.r;
    let html = '<g class="sk-props">';
    for (const p of r.props) {
      const d = S.PROP[p.t];
      if (!d) continue;
      const w = (p.w || d.w) * TILE, h = (p.h || d.h) * TILE;
      const x = o.x + p.x * TILE, y = o.y + p.y * TILE;
      const cls = 'sk-prop' + (p.k ? ' sk-hit' : '') + (p.t === 'rug' ? ' sk-decal' : '');
      html += '<image class="' + cls + '" '
        + (p.k ? 'data-hit="' + escAttr(p.k) + '" data-label="' + escAttr(p.label || '') + '" ' : '')
        + 'href="' + ASSET + 'furniture/' + p.t + '.png" '
        + 'x="' + x + '" y="' + (y + h - (p.t === 'rug' ? h : 0)) + '" width="' + w
        + '" height="' + h + '" preserveAspectRatio="none" image-rendering="pixelated"/>';
      if (p.t === 'rug' && p.tile) {
        /* 〔批 UI-7〕带 `tile` 的地毯 = **用真实瓦片铺的地面片**（升降台 / 顶灯亮面）。
           为什么不复用 furniture/rug.png：那张是"地毯"素材（自带边框），
           铺 4×2 会被拉伸成一块布；而这里要的是"地上这块贴了不同的地砖"。
           所以直接平铺 tiles/<tile>.png（32px → TILE），一格一张，不做拉伸。
           它仍然是装饰层：不带 data-hit 时只是地皮；带 k 时可点（升降台）。 */
        html = html.replace(/<image class="sk-prop sk-decal"[^>]*\/>/, '');
        for (let gy = 0; gy < (p.h || d.h); gy++) {
          for (let gx = 0; gx < (p.w || d.w); gx++) {
            html += '<image class="sk-prop sk-decal" href="' + ASSET + 'tiles/' + p.tile + '.png" x="'
              + (x + gx * TILE) + '" y="' + (y + gy * TILE) + '" width="' + TILE
              + '" height="' + TILE + '" image-rendering="pixelated"/>';
          }
        }
        /* 可交互的地面片：热区用一块透明矩形盖住整片（瓦片本身不宜带 data-hit，
           否则点击会落到其中一格上，白框只框住 1/16 的面积） */
        if (p.k) {
          html += '<rect class="sk-prop sk-decal" x="' + x + '" y="' + y + '" width="' + w
            + '" height="' + h + '" fill="none" pointer-events="all"'
            + ' data-hit="' + escAttr(p.k) + '" data-label="' + escAttr(p.label || '') + '"/>';
        }
      } else if (p.t === 'rug') {
        /* 地毯是纯色块，不用素材。
           〔批 UI-6〕**分两种画法**，因为语义不同：
             · 舰桥那张（anchor='clerk'）= 玩家眼里的「大桌子」⇒ 实心底色；
             · 其他房间的装饰地毯 ⇒ 只画**虚线轮廓**。
           实测：装饰地毯画成实心深色时，在亮地板房里读作「地上挖了个洞」，
           比空着还难看（宿舍右侧那一大块就是这样）。
           这个教训主页场景已经付过一次（批 H1：整块实心会把桌子与座位全盖住），
           当时只改了主页那处，对局内这处没跟着改。 */
        html = html.replace(/<image class="sk-prop sk-decal"[^>]*\/>/, '');
        const isDeck = p.anchor === 'clerk';
        html += '<rect class="sk-prop sk-decal" x="' + x + '" y="' + y + '" width="' + w
          + '" height="' + h + '" rx="' + (isDeck ? 6 : 18) + '"'
          + (isDeck
            ? ' fill="' + (p.tint === 'warn' ? '#8a6a2a' : '#16233a') + '" opacity="0.85"'
            : ' fill="none" stroke="#2f5178" stroke-width="2" opacity="0.55" stroke-dasharray="10 8"')
          + (p.k ? ' data-hit="' + escAttr(p.k) + '" data-label="' + escAttr(p.label || '') + '"' : '')
          + (p.anchor ? ' data-anchor="' + escAttr(p.anchor) + '"' : '')
          + '/>';
      }
      /* 〔批 UI-5〕新增的 5 件交互道具（通讯台 / 投票箱 / 抑制器 / 逃生舱 / 航海日志）
         没有正式素材，用 cozy 家具打底 + **同色角标**（角标里一个字），
         让玩家一眼分辨"这件东西能点、叫什么"。角标不是 emoji（用户排斥 emoji 图标）。 */
      const np = global.SKHudMap && global.SKHudMap.newProp(p.k);
      if (np) {
        html += '<g class="sk-mark" pointer-events="none">'
          + '<rect x="' + (x + w - 26) + '" y="' + (y + h - 26) + '" width="24" height="24" rx="6"'
          + ' fill="' + np.tint + '" opacity="0.92" stroke="#04080f" stroke-width="2"/>'
          + '<text x="' + (x + w - 14) + '" y="' + (y + h - 9) + '" text-anchor="middle"'
          + ' class="sk-mark-t">' + escAttr(np.mark) + '</text></g>';
      }
    }

    /* 15 席（舰桥）：座椅底座 + 编号
       〔批 UI-6〕座圈必须与角色**同步压扁**：只改角色的 py 会让椭圆留在原位，
       画面上就是"角色飘在半空、底下还留着一排空圈"（实测截图一眼可见）。
       所以这里也走 squashSeatY —— 一处定义，两处消费。 */
    const seats = S.seatPositions(curRoom);
    for (const s of seats) {
      const px = o.x + s.x * TILE, py = o.y + squashSeatY(S, s.y) * TILE;
      html += '<g class="sk-seat' + (s.i === 1 ? '' : '') + '" data-seatpos="' + s.i + '">'
        + '<ellipse cx="' + px + '" cy="' + py + '" rx="' + (TILE * 0.46) + '" ry="' + (TILE * 0.28)
        + '" fill="#0b1424" stroke="' + PALETTE[s.i - 1] + '" stroke-width="2"/>'
        + '<text x="' + px + '" y="' + (py + 6) + '" text-anchor="middle" class="sk-seat-n">'
        + s.i + '</text></g>';
    }

    /* 15 个睡眠舱（宿舍） */
    const pods = S.podPositions(curRoom);
    for (const p of pods) {
      const px = o.x + p.x * TILE, py = o.y + p.y * TILE;
      html += '<image class="sk-prop" href="' + ASSET + 'furniture/cryopod.png" x="' + px
        + '" y="' + py + '" width="' + TILE + '" height="' + (TILE * 2)
        + '" image-rendering="pixelated"/>'
        + '<text class="sk-pod-n" x="' + (px + TILE / 2) + '" y="' + (py + TILE * 2 + 12)
        + '" text-anchor="middle">' + p.i + '</text>';
    }
    html += '</g>';
    return html;
  }

  /* =============================================================
   * 席位：把 15 个玩家放到座位/睡眠舱/房间空位
   *   白天（讨论/投票）：全部入座舰桥
   *   夜间：玩家在各自编号的睡眠舱（宿舍）；「我」在自己舱位
   * 出局：灰度 + 半透明（公开信息）
   * ============================================================= */
  /* 〔批 UI-6 · 2026-10-26〕行动面板展开时，座位圈怎么让位
     -------------------------------------------------------------
     面板改成贴底抽屉后不再挤压场景（桌面档场景恒 789px，改前只有 543px），
     代价是它会盖住房间下沿那一排 —— 30×11 新房里是 1/2/15 号。

     【两种档位必须分开处理】这是量出来的，不是拍脑袋：
       桌面档（1440×900）：场景 1408×827，座圈占 245~632，面板顶边 560
         ⇒ 差 82px。把座圈**纵向压扁**（锚定上沿）即可让开，且永不越出房间。
       矮横屏（844×390）：场景 824×356，座圈占 76~303（227px），面板 226px
         ⇒ 场景总高还不够"座圈 + 面板"，**几何上不可能共存**。
         这时面板做成**模态抽屉**（盖住场景、场景压暗）：
         这一步玩家要做的就是在面板里点目标，场景此刻不是必要信息。

     【为什么是压扁而不是平移】
       平移受房间上沿限制：座圈上沿在 2.1 格，最多抬 1.5 格 ≈ 84px，而桌面档需要 98px
       —— 抬不动（实测抬到上限仍压住 1/2/15）。压扁把 [cy-ry, cy+ry] 映射到
       [cy-ry, cy+0.1ry]，上沿不动、下沿抬 0.9·ry（≈3 格），一次就够且永不越界。 */
  const PANEL_MODAL_MAX_H = 560;   /* 与 CSS 的 @media (max-height:560px) 同口径 */

  /* 矮屏 ⇒ 走模态抽屉档（用视口高度判定，与 CSS 断点同一口径） */
  function panelIsModal() {
    try { return (global.innerHeight || 900) <= PANEL_MODAL_MAX_H; } catch (_) { return false; }
  }

  /* 座圈纵向压缩比：面板展开且非模态时压扁，其余原样 */
  function seatSquash() {
    return (panelOpen && !panelIsModal()) ? 0.55 : 1;
  }
  /* 按"锚定上沿"的方式压扁一个座圈 y（格） */
  function squashSeatY(S, y) {
    const k = seatSquash();
    if (k === 1) return y;
    const s = (S.room('bridge') || {}).seats;
    if (!s) return y;
    const top = s.cy - s.ry;
    return top + (y - top) * k;
  }
  function crewHtml(g, V, S) {
    const o = roomOrigin(S);
    const players = (V && V.players) || [];
    const seats = S.seatPositions('bridge');
    const pods = S.podPositions('dorms');
    const walking = walkUntil > 0;
    let html = '<g class="sk-crew-layer' + (walking ? ' sk-walking' : '') + '">';

    /* 入场起点 = 房间的第一扇门（无门则从下缘外进） */
    const doors = (S.room(curRoom) || {}).doors || [];
    const da = doors.length ? S.doorAnchor(curRoom, doors[0]) : null;
    const baseX = da ? o.x + da.x * TILE : o.x + o.w / 2;
    const baseY = da ? o.y + da.y * TILE : o.y + o.h + TILE * 1.4;

    for (const p of players) {
      const isMe = p.id === V.humanId;
      const isDay = g.phase !== 'night';
      let px, py;
      if (curRoom === 'bridge' && isDay) {
        const s = seats[(p.id - 1) % seats.length];
        px = o.x + s.x * TILE;
        /* 〔批 UI-6〕面板展开且非模态时，座圈纵向压扁（锚定上沿），给贴底抽屉让位 */
        py = o.y + squashSeatY(S, s.y) * TILE;
      } else if (curRoom === 'dorms') {
        const q = pods[(p.id - 1) % pods.length];
        px = o.x + q.x * TILE + TILE / 2; py = o.y + q.y * TILE + TILE;
      } else {
        /* 其他房间：只画「我」，站在房间中央偏下 */
        if (!isMe) continue;
        px = o.x + o.w / 2; py = o.y + o.h - TILE * 1.6;
      }

      /* 〔批 UI-7〕角色尺寸按**帧内实际内容**算，不按 96×160 的帧框算。
         -------------------------------------------------------------
         实测 crew-01..15 的待机帧：内容只占 y48~159、x20~79 ——
         也就是帧框上部 30% 是透明的，左右各 20px 也是透明的。
         旧写法 w = TILE*0.92 = 51.5 ⇒ h = 51.5×(160/96) = 85.9，
         但**可见**只有 85.9×(112/160) = 60px 高、51.5×(60/96) = 32px 宽。
         于是在 56px 的格子上，角色只有 32px 宽 —— 比座圈（rx 25.8）还窄，
         读作"点"而不是"人"；同屏 15 个也显得稀稀拉拉。
         现在按内容比例反推帧框：可见宽固定为 1.15 格（64px），
         帧框高 = 64×(160/60)×(96/96)… 见 CREW_BOX。 */
      const w = CREW_BOX.w(), h = CREW_BOX.h();
      const file = CREW_FILE(p.id);
      const ring = isMe ? MINE : PALETTE[(p.id - 1) % PALETTE.length];

      /* 入场起点：沿门横向散开 + 纵向错开，避免 15 人叠在同一个门口点
         （实测：全部同起点时画面是一坨人）。每人再用 --delay 错峰出发。 */
      const spread = ((p.id - 1) % 5 - 2) * TILE * 0.85;
      const row = Math.floor((p.id - 1) / 5);
      const entryX = baseX + spread;
      const entryY = baseY + (da && da.y === 0 ? -row * TILE * 0.6 : TILE * 0.6 + row * TILE * 0.6);
      const dx = (entryX - px).toFixed(1), dy = (entryY - py).toFixed(1);
      const delay = ((p.id * 37) % 220);

      /* 行走图截帧：
           行走 = viewBox 框住「向下走」那一行的第 1 帧，CSS 在 4 帧列之间平移（1-2-3-2 循环）
           待机 = viewBox 框住「待机」行第 2 列 */
      const vb = walking
        ? ('0 0 ' + CREW_W + ' ' + CREW_H)
        : (CREW_W + ' ' + (CREW_H * ROW_IDLE) + ' ' + CREW_W + ' ' + CREW_H);

      /* 〔批 UI-6 · 2026-10-26〕删掉 clipPath —— 它既多余又有害。
         -------------------------------------------------------------
         历史：批 UI-3a 加了一条 `<clipPath>` 想裁掉 384×800 行走图的溢出，
         UI-5a 又"修"了它的坐标系（rect 跟着 viewBox 原点走）。
         本批实测发现：**嵌套 `<svg>` 本身就会裁到自己的视口**（overflow 默认 hidden），
         所以 clipPath 完全是多余的；而它引用的用户空间在"外层 svg / 内层 svg"
         之间有歧义，实测在宿舍房间里把角色整块裁掉（同一份代码在舰桥却正常）——
         也就是说它是**间歇性**的，取决于角色在画布上的位置。

         证据：把 clip-path 属性去掉（只留 viewBox 取景）后，
         舰桥与宿舍的角色都完整显示、且每帧只出一格（嵌套 svg 的裁剪生效）。

         结论：删掉 clipPath 与它的 `<defs>`，只留 `overflow="hidden"` + `.sk-frame{contain:paint}`。
         这样「待机帧不可见」那一类缺陷从根上不可能复发 —— 没有裁剪坐标系了。 */
      html += '<g class="sk-crew' + (isMe ? ' sk-mine' : '') + (p.out ? ' sk-out' : '')
        + '" data-seat="' + p.id + '" transform="translate(' + px.toFixed(1) + ','
        + (py + TILE * 0.34).toFixed(1) + ')" style="--dx:' + dx + 'px;--dy:' + dy + 'px;--delay:'
        /* 〔批 UI-8a · 2026-10-27〕--delay 以前**算出来了但没写进 DOM**（死变量）。
           后果不只是"错峰失效"：CSS 变量是**可继承**的，重建 DOM 时新元素没声明它，
           会继承上一次的值 —— 15 个人的出发时间实际是乱的，加重了"一坨人"的观感。
           实测：getComputedStyle(el).getPropertyValue('--delay') 返回空串。 */
        + delay + 'ms">'
        + '<g class="sk-enter">'
        + '<ellipse cx="0" cy="0" rx="' + (TILE * 0.42) + '" ry="' + (TILE * 0.17)
        + '" fill="' + ring + '" opacity="0.35"/>'
        + '<svg class="sk-frame" x="' + (-w / 2).toFixed(1) + '" y="' + (-h * 0.62).toFixed(1)
        + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1)
        + '" viewBox="' + vb + '" overflow="hidden" preserveAspectRatio="xMidYMax meet">'
        + '<g class="sk-frames">'
        + '<image href="assets/scene/crew/' + file + '.png" x="0" y="0" width="'
        + (CREW_W * 4) + '" height="' + (CREW_H * 5) + '" image-rendering="pixelated"/>'
        + '</g></svg>'
        + '<text class="sk-crew-n" x="0" y="' + (TILE * 0.62).toFixed(1)
        + '" text-anchor="middle">' + p.id + '</text>'
        + '</g></g>';
    }
    html += '</g>';
    return html;
  }

  /* =============================================================
   * 〔批 UI-5 · 2026-10-26〕席位的**真实绘制矩形**（屏幕坐标）
   * -------------------------------------------------------------
   * 为什么不直接 getBoundingClientRect()：嵌套 <svg> 的包围盒包含整张
   * 384×800 行走图（实测 124×258px，而实际画出来只有 57×95px），
   * 拿它做遮挡判定会把「纸上其实什么都没有」的地方判成压住人。
   * 这是交接文档 §3.2 记过的坑，本批又踩了一次（第一版书记官记录板因此被
   * 挤到屏幕角落）。
   *
   * 做法：读 <g class="sk-crew"> 的 transform（用户空间里的落点），
   * 再用 svg.getScreenCTM() 映射到屏幕坐标，按 crewHtml 里 sk-frame 的
   * x/y/width/height 还原那个矩形。与渲染代码逐项一致，不另写一份几何。
   *
   * 〔批 UI-7 · 2026-10-27〕再加一条：**返回的是可见内容矩形，不是帧框**。
   *   帧框 96×160 里有 30% 是透明的（见 CREW_VIS_*）。UI-6 的教训是
   *   "包围盒不是绘制范围"——当时踩的是外层 <g> 的包围盒（含整张 384×800），
   *   这次踩的是**帧框本身**：帧框已经比包围盒准了，但仍比角色实际画出来的
   *   区域大一圈。纸的避让判定用它 ⇒ 会把"纸上其实什么都没有"的地方判成压住人。
   *   所以按 CREW_VIS_W / CREW_VIS_H 把帧框收成内容矩形。
   *
   *   尺寸必须走 CREW_BOX（与 crewHtml 同一份），不许在这里再写一次 TILE*0.92——
   *     那正是本次两个数对不上的原因。
   * ============================================================= */
  function seatRects() {
    const mount = el('scene-mount');
    if (!mount) return [];
    const svg = mount.querySelector('svg.sk-scene');
    if (!svg || typeof svg.getScreenCTM !== 'function') return [];
    const ctm = svg.getScreenCTM();
    if (!ctm) return [];
    const w = CREW_BOX.w(), h = CREW_BOX.h();
    /* 内容在帧内的相对位置（0..1）：由实测 bbox 得出，与 CREW_VIS_* 同源 */
    const fx0 = 20 / CREW_W, fx1 = 79 / CREW_W;
    const fy0 = 48 / CREW_H, fy1 = 1;
    const out = [];
    const gs = mount.querySelectorAll('[data-seat]');
    for (const g of gs) {
      const m = /translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(g.getAttribute('transform') || '');
      if (!m) continue;
      const px = +m[1], py = +m[2];
      /* 帧框：与 crewHtml 的 <svg class="sk-frame" x=-w/2 y=-h*0.62 width=w height=h> 完全一致 */
      const bx = px - w / 2, by = py - h * 0.62;
      const x0 = bx + fx0 * w, x1 = bx + fx1 * w;
      const y0 = by + fy0 * h, y1 = by + fy1 * h;
      const L = x0 * ctm.a + ctm.e, T = y0 * ctm.d + ctm.f;
      const R = x1 * ctm.a + ctm.e, B = y1 * ctm.d + ctm.f;
      out.push({ seat: +g.getAttribute('data-seat'), left: L, top: T, right: R, bottom: B, width: R - L, height: B - T });
    }
    return out;
  }

  /* =============================================================
   * 〔批 UI-5 · 2026-10-26〕书记官记录板归位
   * -------------------------------------------------------------
   * 顶部 HUD 删除后，阶段名 / 倒计时 / 净破坏 / 决策窗口落在**桌子中央的纸**上。
   * 那张纸是 #clerk（#scene-mount 的兄弟节点，见 index.html），这里负责把它摆好。
   *
   * 摆放规则（一条，按优先级）：
   *   ① 首选圆桌正中（用户要的「桌子中央书记官记录」）；
   *   ② 若纸比桌面大（矮横屏 / 小屏，桌面只有 100 多像素），硬居中会压住 1/2/15 号
   *      席位 —— 玩家点不到人。此时在**一组候选位置**里挑「压席位最少、离桌子最近」
   *      的那个：桌心上下左右、场景四角、场景上/下居中。
   *      实测四档视口：桌面档仍落在桌心；844×390 落到场景左上角（那里是空地）。
   *   ③ 全都会压住时，取压得最少的那个 —— 宁可少压一个，也不要压在正中间。
   *
   * 非舰桥房间没有圆桌：锚点改地板，纸落在房间中央偏上。
   * ============================================================= */
  function layoutClerk() {
    const mount = el('scene-mount');
    const paper = el('clerk');
    if (!mount || !paper) return;
    const svg = mount.querySelector('svg.sk-scene');
    /* 锚点：优先取带 data-anchor="clerk" 的道具（舰桥那张「大桌」= 地毯），
       其次圆桌，最后地板。用**大桌**而不是中间那张矮桌，是因为纸比矮桌还宽 ——
       钉在矮桌上会横跨到 1/2/15 号席位头顶。 */
    const marked = mount.querySelector('[data-anchor="clerk"]');
    const table = mount.querySelector('[data-hit="round_table"]');
    const anchor = marked || table || (svg && svg.querySelector('.sk-room-floor rect'));
    /* 【注意】取不到锚点时**不要 .add('hidden')**：ResizeObserver 会在切屏（#screen-game
       被隐藏 → 尺寸归零）时触发一次，隐藏是粘性的 —— 回到对局后纸就再也不出现
       （实测：移动端门禁在 844×390 直接判成"未挂载"）。留着上一次的位置即可。 */
    if (!svg || !anchor) return;
    const tb = anchor.getBoundingClientRect();
    if (!tb.width) return;
    paper.classList.remove('hidden');
    /* 坐标系：纸是 #screen-game 的绝对定位子节点（不是 #scene-mount 的子节点），
       所以 left/top 必须相对**它的 offsetParent** 算，而不是相对场景挂载点。
       改前用 mb.left 当原点，实测整块纸向右偏了场景左边距（16px）—— 视觉上看不出来，
       但它会在小屏上把纸推出桌面。 */
    const host = paper.offsetParent || mount;
    const hb = host.getBoundingClientRect();
    /* 纸宽：舰桥取「大桌」宽的 46%（上限 330），其他房间取地板宽 40%。
       下限 150 —— 再窄「倒计时 24.0」就会折行。 */
    const w = marked
      ? Math.max(150, Math.min(330, tb.width * 0.46))
      : Math.max(150, Math.min(330, tb.width * 0.40));
    paper.style.width = Math.round(w) + 'px';
    const ph = paper.offsetHeight || 96;

    /* ---- 候选位置：舰桥优先桌心；**其他房间优先左上角** ----
       〔批 UI-6〕非舰桥房间里没有圆桌，纸若落在房间正中就会盖住交互家具
       （实测医疗室的手术台被整块盖住）。那些房间的中部正是玩家要点的东西，
       所以纸改钉左上角（那里通常只有房名），把中部让给家具。
       候选表仍保留其余位置，用于"左上角也压到人/出界"时的兜底。 */
    const sb = mount.getBoundingClientRect();
    const m = 8;
    const rel = (x, y) => ({ left: x - hb.left, top: y - hb.top });
    const centerX = tb.left + (tb.width - w) / 2;
    const centerY = tb.top + (tb.height - ph) / 2;
    const cornerTL = rel(sb.left + m, sb.top + m);
    const cands = marked
      ? [rel(centerX, centerY),                                      /* ① 桌心 */
        rel(centerX, tb.top - ph + 6),                               /* 桌上沿 */
        rel(centerX, tb.bottom - 6),                                 /* 桌下沿 */
        rel(tb.left - w - 6, centerY),                               /* 桌左 */
        rel(tb.right + 6, centerY),                                  /* 桌右 */
        cornerTL,                                                    /* 场景左上 */
        rel(sb.right - w - m, sb.top + m),                           /* 场景右上 */
        rel(sb.left + m, sb.bottom - ph - m),                        /* 场景左下 */
        rel(sb.right - w - m, sb.bottom - ph - m),                   /* 场景右下 */
        rel(sb.left + (sb.width - w) / 2, sb.bottom - ph - m)]       /* 场景下中 */
      : [rel(sb.left + (sb.width - w) / 2, sb.top + m),              /* 其他房间：场景上黑边居中 */
        rel(sb.left + m, sb.top + m),
        rel(sb.left + (sb.width - w) / 2, sb.bottom - ph - m),
        rel(sb.right - w - m, sb.top + m),
        rel(sb.left + m, sb.bottom - ph - m),
        rel(sb.right - w - m, sb.bottom - ph - m),
        rel(centerX, tb.top + 6),
        rel(centerX, centerY)];

    /* ---- 逐个量：压住几个席位（按角色**实际绘制矩形**，不按包围盒 —— 见 seatRects 的注释） ---- */
    const rects = seatRects();
    const overlapAt = (pos) => {
      const L = hb.left + pos.left, T = hb.top + pos.top;
      const R = L + w, B = T + ph;
      let n = 0;
      for (const r of rects) {
        if (r.left < R && L < r.right && r.top < B && T < r.bottom) n++;
      }
      return n;
    };
    let best = cands[0], bestN = overlapAt(best);
    for (const c of cands) {
      if (c === best) continue;
      const n = overlapAt(c);
      /* 严格更少才换：同等遮挡时保留更靠前的候选（桌心优先） */
      if (n < bestN) { best = c; bestN = n; }
      if (bestN === 0) break;
    }
    /* 〔批 UI-5〕最后一道夹紧：任何候选都不许把纸推出场景。
       实测「宿舍」那间房：锚点取的是地板，候选落在房间上沿时 top 会算成 -27
       （纸有一半在场景外，玩家看不到「当夜记录」）。夹紧到场景内即可。 */
    const minL = sb.left - hb.left + m, maxL = sb.right - hb.left - w - m;
    const minT = sb.top - hb.top + m, maxT = sb.bottom - hb.top - ph - m;
    const left = Math.min(Math.max(best.left, minL), Math.max(minL, maxL));
    const top = Math.min(Math.max(best.top, minT), Math.max(minT, maxT));
    paper.style.left = Math.round(left) + 'px';
    paper.style.top = Math.round(top) + 'px';
  }

  /* 〔批 UI-5〕场景尺寸变化（行动面板展开 / 输入框浮出 / 窗口缩放）后，纸要重新归位。
     用 ResizeObserver 而不是"每次 render 都算一遍"：render 不在布局变化时触发，
     而纸的位置依赖场景的**像素**尺寸。没有 ResizeObserver 的环境（老浏览器 / vm 沙盒）
     静默跳过 —— 此时纸停在最后一次显式布局的位置，不会崩。 */
  let roBound = false;
  function observeScene(mount) {
    if (roBound || !mount || typeof global.ResizeObserver !== 'function') return;
    roBound = true;
    try {
      const ro = new global.ResizeObserver(function () { layoutClerk(); });
      ro.observe(mount);
      global.__skClerkRO = ro;
    } catch (_) { roBound = false; }
  }

  /* 渲染入口（接口与旧版一致：render(g, V)） */
  let sig = null, lastG = null, lastV = null, lastMount = null, lastPhaseKey = null;
  /* 〔批 UI-5〕上一次「按待决策自动跳房间」去过的房间：只在 kind 变化时跳一次，
     否则玩家一点门就被拽回去（那会让人以为门坏了）。 */
  let lastAutoRoom = null;
  /* 〔批 UI-6〕行动面板是否展开 —— 决定座圈压扁与模态态（见 seatSquash / panelIsModal） */
  let panelOpen = false;
  /* 面板展开时给场景容器加类：模态档（矮屏）下 CSS 用它压暗场景，
     非模态档只是状态标记（座圈压扁由 squashSeatY 直接算，不依赖 CSS）。 */
  function mountPanelUp(v) {
    const m = el('scene-mount');
    if (!m) return;
    m.classList.toggle('panel-up', !!v);
    m.classList.toggle('panel-modal', !!v && panelIsModal());
  }
  function setPanelOpen(v) {
    const nv = !!v;
    if (nv === panelOpen) return;
    panelOpen = nv;
    mountPanelUp(nv);
    /* 座圈位置变了（压扁 / 还原），必须重建场景。
       不需要"先量后算"的两趟渲染 —— 压扁比是常量，不依赖量测结果。 */
    sig = null;
    if (lastG && lastV) render(lastG, lastV);
  }

  function render(g, V) {
    if (!g || !V || !V.players) return;
    const S = global.SKSpace;
    if (!S) return;
    const mount = el('scene-mount');
    if (!mount) return;

    const key = [V.humanId, g.phase, curRoom,
      V.players.map(p => (p.out ? 1 : 0)).join(''),
      g.pending && !g.pending.stream ? (g.pending.kind || '') : '',
      panelOpen ? 'P1' : 'P0'].join('|');
    /* 〔批 UI-8b · 2026-10-27〕什么时候才该"走"？
       -------------------------------------------------------------
       用户原话：「每次决策的时候，小人都会突然冒出来，然后站住 15 个座位，
       然后下一步决策的时候又突然冒出来站住 15 个座位……没有轮到这名玩家决策的时候，
       其他玩家都是不动的，不需要新决策就刷新一遍新帧」。

       旧逻辑把 `pending.kind` 也算进"阶段"，于是 **每换一个决策就重播一次入场动画**：
       15 个人凭空出现在门口，再滑回座位 —— 那就是"突然冒出来"。
       但换决策**不是移动**。真正算移动的只有两种：
         ① 房间变了（我走了门 / 被自动带去该做事的房间）
         ② 昼夜阶段变了（白天回圆桌 / 夜里回睡眠舱）
       所以这里把 kind 从判据里**拿掉**，只留 phase 与房间。 */
    /* 顺序很重要：**先**决定"这一步要去哪"，**再**比较 phaseKey。
       -------------------------------------------------------------
       第一版把 phaseKey 算在自动跳房之前，于是"被带去另一个房间"这件事
       永远体现在**下一次** render 上；而这一步的 walkUntil 是旧的（可能是 0）——
       实测：换决策后 15 个角色瞬间跳到新座位、一帧动画都没有（"凭空出现"）。
       现在先解析目标房间并落定 curRoom，再拿它组 phaseKey。 */

    /* 〔批 UI-5 · 2026-10-26〕待决策时自动回到「该做这件事的房间」。
       用户要的是"交互跟着物件走"：轮到我私聊，就该在舰桥的通讯台前，而不是
       上一步停在制药室里对着空气点。
       〔批 UI-8b〕判据从 `want !== curRoom && want !== lastAutoRoom` 收成
       **只看 `want !== curRoom`**：lastAutoRoom 那半个条件会让"回到上一个去过的房间"
       被静默跳过（那是错的 —— 房间确实变了，就该走）。 */
    if (g.pending && !g.pending.stream && global.SKHudMap) {
      const want = global.SKHudMap.roomOf(g.pending.kind || '');
      if (want && want !== curRoom) {
        curRoom = want;
        lastAutoRoom = want;
        sig = null;
      }
    } else if (!g.pending) {
      lastAutoRoom = null;
    }

    /* 只有"房间变了"或"昼夜变了"才走。换决策不移动。 */
    const phaseKey = g.phase + '|' + curRoom;
    if (lastPhaseKey && lastPhaseKey !== phaseKey) walkUntil = now() + WALK_MS;
    lastPhaseKey = phaseKey;

    if (key !== sig || !mount.__skBuilt) {
      mount.innerHTML =
        '<svg class="sk-scene" viewBox="0 0 ' + VB.w + ' ' + VB.h + '" preserveAspectRatio="xMidYMid meet">'
        + roomHtml(S) + propsHtml(S) + crewHtml(g, V, S) + '</svg>'
        + '<div id="sk-room-stage" class="sk-room-stage" aria-label="房间"></div>';
      mount.__skBuilt = true;
      bind(mount);
      sig = key;
    }
    lastG = g; lastV = V; lastMount = mount;
    updateInteractive(g, V, mount);
    layoutClerk();
    observeScene(mount);

    /* 还在行走 → 到时重绘一次，切回待机帧（避免角色永远在迈步） */
    if (walkUntil > now()) {
      if (walkTimer) clearTimeout(walkTimer);
      walkTimer = setTimeout(function () {
        walkUntil = 0; sig = null;
        if (lastG && lastV) render(lastG, lastV);
      }, walkUntil - now() + 20);
    }
  }
  let walkTimer = null;

  /* ---- 交互：点门切房间；点道具/席位委托既有控件 ---- */
  function bind(mount) {
    if (!mount.addEventListener || mount.__skBound) return;
    mount.__skBound = true;
    mount.addEventListener('click', function (e) {
      try {
        const t = e.target;
        if (!t || !t.closest) return;

        const door = t.closest('[data-door]');
        if (door) { goto(door.getAttribute('data-door')); return; }

        const seat = t.closest('[data-seat]');
        if (seat) { onSeatClick(+seat.getAttribute('data-seat'), mount); return; }

        const hit = t.closest('[data-hit]');
        if (hit) { onPropClick(hit.getAttribute('data-hit'), hit.getAttribute('data-label'), mount); return; }

        /* 〔U1〕旧笔记本道具已随场景退役；账本入口改由 HUD / 席位弹窗承担，
           这里保留 openLedger 的委托点，供将来在房间内加「日志终端」时接回。 */
        if (t.closest('[data-hit="ledger"]')) { if (global.UI && global.UI.openLedger) global.UI.openLedger(); }
      } catch (_) { /* 交互层异常不外抛 */ }
    });
  }

  /* 切房间：只改 curRoom 并重绘（不触发任何规则） */
  function goto(roomId) {
    const S = global.SKSpace;
    if (!S || !S.room(roomId) || roomId === curRoom) return;
    curRoom = roomId;
    /* 玩家手动走门后，别在同一步里再被"自动回房间"拽回去 */
    lastAutoRoom = curRoom;
    walkUntil = now() + WALK_MS;
    sig = null;
    if (lastG && lastV) render(lastG, lastV);
    else { const m = el('scene-mount'); if (m) m.__skBuilt = false; }
    layoutClerk();
  }

  /* 需要补参数的行动（勾选目标后不能立即提交），沿用旧版判定 */
  const NEEDS_MORE = ['branch', 'disguise', 'craft', 'doctor', 'repair', 'crewRepair',
    'crewAction', 'morph', 'transfer', 'evolve', 'convert', 'awaken', 'suppress',
    'talk', 'chat', 'will', 'speech', 'xenoCheck', 'clean', 'meeting', 'inviteAccept'];

  /* 〔U2〕点道具 = 开始一次交互。
     白框（sk-focus）落在道具矩形上 —— 这是"交互已开始"的视觉锚点，
     而不是弹一个居中的方框对话框（用户明确排斥那种"雷霆方框"）。
     之后仍委托既有控件：能选就选，不能选就说明为什么。

     〔批 UI-5 · 2026-10-26〕顶栏删除后，道具成了**唯一入口**，所以要分三种情况：
       ① 这件道具正是「当前待决策」的那件（映射表说 kind → 本房本物件）：
          → 展开行动面板（#region-dec），白框落在物件上；
       ② 这件道具属于「本局该做、但现在不在这间房」的动作：→ 直接走过去（goto）；
       ③ 其余：说明现在为什么用不了（不假装成功）。
     判据全部来自 js/hud-map.js，渲染器里不再自己写"哪个 kind 在哪间房"。 */
  function onPropClick(key, label, mount) {
    const g = global.Game && global.Game.g;
    if (!g) return;
    const H = global.SKHudMap;
    const myTurn = !!(g.pending && !g.pending.stream);
    const kind = myTurn ? (g.pending.kind || '') : '';
    const wantHit = myTurn && H ? H.hitOf(kind) : null;

    /* ① 就是现在该点的那件：开面板（表单在 #region-dec 里，控件语义不变） */
    if (wantHit && wantHit === key) {
      focusProp(key, label, mount);
      if (global.UI && global.UI.openDockPanel) global.UI.openDockPanel();
      toast(mount, (label || key) + ' · ' + (g.pending.title || '开始行动'));
      return;
    }

    /* ② 现在该做的动作在别的房间：走过去，而不是干瞪眼 */
    if (myTurn) {
      const room = H ? H.roomOf(kind) : null;
      if (room && room !== curRoom) {
        const dest = global.SKSpace && global.SKSpace.room(room);
        goto(room);
        toast(mount, '这一步在「' + ((dest && dest.name) || room) + '」完成');
        return;
      }
      /* 本房内的其他道具：说明本次用不到 */
      focusProp(key, label, mount);
      toast(mount, (label || key) + '：本次行动用不到它（这一步在'
        + (H ? (H.labelOf(kind) || kind) : kind) + '）');
      return;
    }

    /* ③ 不在决策时间：给一句"它是什么"，而不是沉默 */
    const np = H && H.newProp(key);
    if (np) {
      focusProp(key, label, mount);
      toast(mount, (label || np.label) + '：轮到对应行动时才用得上');
      return;
    }
    focusProp(key, label, mount);
    toast(mount, (label || key) + '：现在不是决策时间');
  }

  /* 白框：用一个独立 <rect> 叠在道具上，带呼吸动画；再次点击别处则清除 */
  let focusTimer = null;
  function focusProp(key, label, mount) {
    try {
      const svg = mount.querySelector('svg.sk-scene');
      if (!svg) return;
      let box = svg.querySelector('#sk-focus');
      if (!box) {
        box = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        box.setAttribute('id', 'sk-focus');
        box.setAttribute('style', 'pointer-events:none');
        svg.appendChild(box);   /* 追加到最后 = 压在所有图层之上 */
      }
      box.innerHTML = '';
      const hit = svg.querySelector('[data-hit="' + key + '"]');
      if (hit) {
        const r = hit.getBBox();
        const pad = 9;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', r.x - pad); rect.setAttribute('y', r.y - pad);
        rect.setAttribute('width', r.width + pad * 2); rect.setAttribute('height', r.height + pad * 2);
        rect.setAttribute('rx', 6);
        rect.setAttribute('class', 'sk-focus-box');
        box.appendChild(rect);
        /* 标签：贴着白框上方，不是方框对话框 */
        const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        t.setAttribute('x', r.x + r.width / 2);
        t.setAttribute('y', r.y - pad - 10);
        t.setAttribute('text-anchor', 'middle');
        t.setAttribute('class', 'sk-focus-t');
        t.textContent = label || key;
        box.appendChild(t);
      }
      if (focusTimer) clearTimeout(focusTimer);
      focusTimer = setTimeout(function () { box.innerHTML = ''; }, 2600);
    } catch (_) {}
  }

  function onSeatClick(pid, mount) {
    const g = global.Game && global.Game.g;
    if (!g) return;
    if (!(g.pending && !g.pending.stream)) {
      if (global.UI && global.UI.openPlayerPop) global.UI.openPlayerPop(pid);
      return;
    }
    const f = g.pending;
    const body = el('stage-body');
    const inp = body && body.querySelector('#f-targets input[value="' + pid + '"]:not([disabled])');
    const inpPool = body && body.querySelector('#f-pool input[value="' + pid + '"]:not([disabled])');
    const pick = inp || inpPool;
    if (!pick) {
      toast(mount, '本次行动不能指向 ' + pid + ' 号');
      if (global.UI && global.UI.openPlayerPop) global.UI.openPlayerPop(pid);
      return;
    }
    pick.click();
    refresh();
    const max = (f.targets && f.targets.max) || 1;
    const needsMore = NEEDS_MORE.indexOf(f.kind) >= 0 || f.num || f.num2 || f.text;
    if (max === 1 && !needsMore) {
      const btn = el('btn-submit');
      if (btn && !btn.disabled) {
        setTimeout(function () { try { btn.click(); } catch (_) {} }, 160);
        toast(mount, '已对 ' + pid + ' 号发动：' + (f.title || f.kind));
        return;
      }
    }
    toast(mount, '已选中 ' + pid + ' 号' + (needsMore ? ' · 在房间里补完剩余选项再提交' : ''));
  }

  let toastTimer = null;
  /* 〔U2〕提示条贴在场景顶部（不是屏幕中央）—— 白框在道具上，中央留给它 */
  function toast(mount, msg) {
    try {
      let t = mount.querySelector('.sk-toast');
      if (!t) { mount.insertAdjacentHTML('beforeend', '<div class="sk-toast"></div>'); t = mount.querySelector('.sk-toast'); }
      t.textContent = msg;
      t.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000);
    } catch (_) {}
  }

  /* 高亮：轮到我时，把匹配当前行动的房间门点亮 */
  /* 〔批 UI-5〕房间表退役：决策 → 房间 的唯一来源改为 js/hud-map.js（用户要的「映射表」）。
     这里保留一个薄转发，避免调用点散落两份数据。 */
  function kindRoom(kind) {
    const H = global.SKHudMap;
    return H ? H.roomOf(kind) : null;
  }
  function updateInteractive(g, V, mount) {
    try {
      const myTurn = !!(g.pending && !g.pending.stream);
      const kind = myTurn ? (g.pending.kind || '') : '';
      const lit = myTurn ? kindRoom(kind) : null;
      const doors = mount.querySelectorAll('[data-door]');
      for (const d of doors) d.classList.toggle('sk-lit', !!lit && d.getAttribute('data-door') === lit);
      /* 〔批 UI-5〕轮到我在别的房间做这件事时，把「去那间房」写进书记官记录板，
         而不是在顶栏挂一条提示（顶栏已经删了）。 */
      const goHint = el('clerk-go');
      if (goHint) {
        const S = global.SKSpace;
        const destName = lit && S && S.room(lit) ? S.room(lit).name : '';
        const here = lit && lit === curRoom;
        goHint.textContent = lit ? (here ? '' : '去 ' + destName + ' · ' + (global.SKHudMap.labelOf(kind) || '')) : '';
        goHint.classList.toggle('hidden', !lit || here);
      }
      /* 当前该点的物件：轮到谁、在哪间房，就把那件道具点亮（点它 = 发起这次行动） */
      const hit = myTurn && lit === curRoom ? (global.SKHudMap ? global.SKHudMap.hitOf(kind) : null) : null;
      const props = mount.querySelectorAll('[data-hit]');
      for (const p of props) p.classList.toggle('sk-need', !!hit && p.getAttribute('data-hit') === hit);
      let sel = [];
      const body = el('stage-body');
      if (body && myTurn) sel = [].map.call(body.querySelectorAll('#f-targets input:checked, #f-pool input:checked'), function (x) { return +x.value; });
      const crews = mount.querySelectorAll('[data-seat]');
      for (const c of crews) c.classList.toggle('sk-sel', sel.indexOf(+c.getAttribute('data-seat')) >= 0);
    } catch (_) {}
  }

  function refresh() {
    if (lastG && lastV) updateInteractive(lastG, lastV, lastMount);
  }

  /* ESC：退出到舰桥（与规则速览同款手势） */
  try {
    global.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape' && curRoom !== 'bridge') goto('bridge');
    });
  } catch (_) {}

  /* =============================================================
   * 〔H1〕主页场景：俯视圆桌 + 15 席（与游戏内同一套绘制代码）
   * -------------------------------------------------------------
   * 用户拍板「主页就是游戏预览页」「俯视圆桌」。
   * 复用 roomOrigin / propsHtml 的数据来源（js/space.js），但**不读 g/V**：
   *   主页阶段没有对局状态，只有 15 个空席位 + 我这席的名字牌。
   * 输出：一个 <svg>，其中「我这席」带 data-home-seat="me"，供名字牌定位。
   * ============================================================= */
  function renderHomeScene(host, opt) {
    const S = global.SKSpace;
    if (!host || !S) return;
    const o = global.document;
    const r = S.room('bridge');
    if (!r) return;
    const [w, h] = r.size;
    const W2 = w * TILE, H2 = h * TILE;
    const OX = 0, OY = 0;
    const myId = 3;                      /* 主页固定展示「我这席」坐在 3 号位 */
    const myName = (opt && opt.myName) || '玄武岩';

    let html = '<svg class="sk-scene sk-home" viewBox="0 0 ' + (W2 + 40) + ' ' + (H2 + 40)
      + '" preserveAspectRatio="xMidYMid meet">';
    /* 底板 */
    html += '<rect x="0" y="0" width="' + (W2 + 40) + '" height="' + (H2 + 40)
      + '" fill="none"/>';
    html += '<g transform="translate(20,20)">';

    /* 地板 + 四壁：与游戏内**同一个函数**（floorWallShell），不再各写一份。
       主页只是把压暗强度提到 .42 —— 让"预览"读作尚未入场，而不是已经开打。
       〔批 UI-7〕此前这里是手抄的第二份实现，两处参数已经漂移（.42 vs .34）。 */
    html += floorWallShell(S, { x: 0, y: 0, w: W2, h: H2 }, r, 'home', 0.42);

    /* 家具（复用 space.js 的桥房道具表，跳过地毯与座位） */
    for (const p of r.props) {
      const d = S.PROP[p.t];
      if (!d) continue;
      const pw = (p.w || d.w) * TILE, ph = (p.h || d.h) * TILE;
      const px = p.x * TILE, py = p.y * TILE;
      if (p.t === 'rug') {
        /* 地毯只画**细边框轮廓**：整块实心会把桌子与座位全盖住（批 H1 实测） */
        html += '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + ph
          + '" rx="18" fill="none" stroke="#2f5178" stroke-width="2" opacity="0.55" stroke-dasharray="10 8"/>';
        continue;
      }
      html += '<image href="' + ASSET + 'furniture/' + p.t + '.png" x="' + px + '" y="' + py
        + '" width="' + pw + '" height="' + ph + '" preserveAspectRatio="none" image-rendering="pixelated"/>';
    }

    /* 15 席 */
    const seats = S.seatPositions('bridge');
    for (const s of seats) {
      const cx = s.x * TILE, cy = s.y * TILE;
      const isMe = s.i === myId;
      const col = PALETTE[(s.i - 1) % PALETTE.length];
      html += '<g data-home-seat="' + (isMe ? 'me' : 'seat-' + s.i) + '">';
      html += '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (TILE * 0.34) + '" ry="'
        + (TILE * 0.20) + '" fill="#0b1424" stroke="' + (isMe ? MINE : col)
        + '" stroke-width="' + (isMe ? 2.5 : 1.6) + '"/>';
      if (isMe) {
        /* 我这席：画一个小人站在座前（用 crew 素材的待机帧）。其余 14 席留空椅 ——
           主页是"预览"，不是"已经坐满了"。 */
        const w2 = TILE * 1.15, h2 = w2 * (CREW_H / CREW_W);
        /* 〔批 UI-5a · 2026-10-26〕主页也踩了同一个坑（P0 的第二处）：
           `overflow="hidden"` 对嵌套 <svg> 的 x/y/width/height 溢出**无效**，
           整张 4×5 行走图会被完整画出来 —— 主页左侧那"一堆绿色小人"就是它。
           批 H1 的注释写着"不裁剪时画面上是一堆红小人"，但当时只加了 overflow:hidden，
           等于没修。这里补 clipPath，且矩形按**当前 viewBox 的原点**给
           （待机帧的 viewBox y = CREW_H*ROW_IDLE，不是 0 —— 与对局内同一处根因）。 */
        const hvbx = CREW_W, hvby = CREW_H * ROW_IDLE;
        html += '<svg x="' + (cx - w2 / 2) + '" y="' + (cy - h2 * 0.62) + '" width="' + w2
          + '" height="' + h2 + '" viewBox="' + hvbx + ' ' + hvby + ' ' + CREW_W + ' ' + CREW_H
          + '" overflow="hidden" preserveAspectRatio="xMidYMax meet">'
          + '<defs><clipPath id="sk-home-clip"><rect x="' + hvbx + '" y="' + hvby
          + '" width="' + CREW_W + '" height="' + CREW_H + '"/></clipPath></defs>'
          + '<g clip-path="url(#sk-home-clip)">'
          + '<image href="assets/scene/crew/crew-15.png"'
          + ' x="0" y="0" width="' + (CREW_W * 4) + '" height="' + (CREW_H * 5) + '" image-rendering="pixelated"/>'
          + '</g></svg>';
      }
      /* 编号放到椅面下方一点：与椅面椭圆同心会糊成一团（实测像"一堆小人"） */
      html += '<text x="' + cx + '" y="' + (cy + TILE * 0.40) + '" text-anchor="middle" class="sk-seat-n">'
        + s.i + '</text></g>';
    }

    /* 中央船核心：全息环（与游戏内同一套观感） */
    const hx = w / 2 * TILE, hy = h / 2 * TILE;
    html += '<circle cx="' + hx + '" cy="' + hy + '" r="' + (TILE * 0.9)
      + '" fill="#0a3350" opacity="0.9"/>';
    html += '<circle cx="' + hx + '" cy="' + hy + '" r="' + (TILE * 0.9)
      + '" fill="none" stroke="#4dd0e1" stroke-width="2" opacity="0.85"/>';
    html += '<circle class="sk-home-core" cx="' + hx + '" cy="' + hy + '" r="' + (TILE * 0.42)
      + '" fill="#2fd8e8" opacity="0.2"/>';

    html += '</g></svg>';

    host.innerHTML = html;
    /* 点击任意席位 → 打开「我这席」面板（可改身份+名字） */
    host.onclick = function (e) {
      const t = e.target;
      if (t && t.closest && t.closest('[data-home-seat]') && opt && opt.onSeatClick) opt.onSeatClick();
    };
  }

  global.SKScene = {
    render: render,
    renderHomeScene: renderHomeScene,
    refresh: refresh,
    goto: goto,
    currentRoom: function () { return curRoom; },
    /* 〔批 UI-5〕席位的真实绘制矩形（屏幕坐标）：书记官记录板的避让与门禁共用这一份，
       免得"渲染器按真实矩形算、门禁按包围盒算"两边各说各话。 */
    seatRects: seatRects,
    layoutClerk: layoutClerk,
    /* 〔批 UI-6〕行动面板展开/收起 → 座位圈整体让位（见 crewHtml 的 SEAT_LIFT） */
    setPanelOpen: setPanelOpen,
    isPanelOpen: function () { return panelOpen; },
    _tile: TILE, _vb: VB, _palette: PALETTE,
  };
})(typeof window !== 'undefined' ? window : globalThis);
