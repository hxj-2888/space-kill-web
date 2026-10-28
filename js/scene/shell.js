/* =============================================================
 * SKSceneShell · 房间外壳（地板 + 四壁 + 踢脚 + 走廊）的 HTML 构建（批 ART-0/B2a · 2026-10-28）
 * -------------------------------------------------------------
 * 职责：   把 js/space.js 的房间声明 + js/ship-map.js 的通道几何，拼成场景 SVG 的
 *          **静态外壳**（地板 pattern / 四壁 / 墙饰 / 走廊带）。零交互、零状态。
 * 不变量： · **唯一一份**：对局页与主页共用 floorWallShell，不许再各写一份
 *            （批 UI-7 之前两处参数已经漂移：主页 opacity .42 / 对局 .34）；
 *          · 墙饰按列**等距稀疏**落位，不许逐格循环（会变成"胶片带"）；
 *          · 走廊 pattern 的引用与定义必须成对（SH8 守：少一处廊就是空的）；
 *          · 纯字符串输出，不读 DOM、不读 g/V。
 * 依赖：   js/scene/const.js（TILE/ASSET）、js/space.js（房间表）、js/ship-map.js（通道矩形）。
 * 状态：   无。
 * 对外：   global.SKSceneShell = { floorWallShell, corridorHtml }
 * 门禁：   test:ship SH8（廊 pattern 成对）、test:space S3a（墙饰按列落位）/ S4（唯一一份）。
 * ============================================================= */
(function (global) {
  'use strict';

  const C = global.SKSceneConst;
  if (!C) throw new Error('scene/shell：缺少 js/scene/const.js（加载顺序见 tools/load-order.cjs）');
  const TILE = C.TILE, ASSET = C.ASSET;

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
    /* 房间矩形是**船体格**：渲染时统一由外层 <g> 减去相机偏移，
       所以这里直接写船体坐标即可（见 render 里的 camera 平移）。
       参数 o 现在是 { x, y, w, h }（船体格），不再是"居中铺满画布"的偏移。 */
    const ox = o.x * PT, oy = o.y * PT, ow = o.w * PT, oh = o.h * PT;
    const fpat = 'sk-floor-' + id, wpat = 'sk-wall-' + id, wclip = 'sk-wallclip-' + id;
    let html = '';

    /* ---- 地板：整间平铺 ---- */
    html += '<defs><pattern id="' + fpat + '" width="' + PT + '" height="' + PT
      + '" patternUnits="userSpaceOnUse"><image href="' + ASSET + 'tiles/' + r.floor
      + '.png" width="' + PT + '" height="' + PT
      + '" image-rendering="pixelated"/></pattern></defs>';
    html += '<rect x="' + ox + '" y="' + oy + '" width="' + ow + '" height="' + oh
      + '" fill="url(#' + fpat + ')"/>';

    /* 〔批 UI-7〕地板高光**不画**（试过两版，都撤了）。
       试过两版：6 格间距 × 两行不透明 ⇒ floor-hazard 房间读作"泼了油漆"；
       8 格间距 × 单行 45% ⇒ 每间房地上多出 4 块半透明方斑，像贴图没对齐。
       根本原因：accent 素材是**整块地板瓦片**而不是叠加层，叠在另一张地板上
       只会得到"两种地砖拼在一起"，不会得到"高光"。
       所以房间之间的地面差异改由 floor 本身承担（9 间房 6 种地板），
       将来真要做高光，得是**叠加层**（半透明亮斑），不能是整块地板瓦片。 */

    /* ---- 地板压暗：地砖本身很亮，压一层让家具与角色浮出来（仍保留纹理） ---- */
    html += '<rect x="' + ox + '" y="' + oy + '" width="' + ow + '" height="' + oh
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
    html += '<defs><clipPath id="' + wclip + '"><rect x="' + ox + '" y="' + oy
      + '" width="' + ow + '" height="' + (TILE * 2) + '"/></clipPath></defs>';
    html += '<g clip-path="url(#' + wclip + ')">';
    /* 底座：整条空墙 */
    html += '<rect x="' + ox + '" y="' + oy + '" width="' + ow + '" height="' + (TILE * 2)
      + '" fill="url(#' + wpat + ')"/>';
    /* 装饰：等距落位（跳过左右壁那 0.55 格，免得压在边梁上） */
    for (let k = 0; k < tiles.length; k++) {
      const col = Math.round((k + 1) * nCols / (tiles.length + 1)) - 1;
      if (col < 1 || col > nCols - 2) continue;
      html += '<image href="' + ASSET + 'tiles/' + tiles[k] + '.png" x="' + (ox + col * TILE)
        + '" y="' + oy + '" width="' + TILE + '" height="' + (TILE * 2)
        + '" image-rendering="pixelated"/>';
    }
    html += '</g>';

    /* 墙面压暗：素材本身是接近纯白的（#E9EEF0），铺满 2 格高 × 30 格宽后
       是画面里最亮的一块，眼睛会先被它吸住 —— 这是用户反复说的"白区"。
       压一层 #0a1524 / 0.26 之后，它读作"舱壁在船内灯光下的样子"，
       与深色地板接得上，装饰瓦片（屏/舷窗/管线）反而更跳得出来。 */
    html += '<rect x="' + ox + '" y="' + oy + '" width="' + ow + '" height="' + (TILE * 2)
      + '" fill="#0a1524" opacity="0.26"/>';

    /* 左右壁（0.55 格宽，只借"墙面"那条） */
    html += '<rect x="' + ox + '" y="' + oy + '" width="' + (TILE * 0.55) + '" height="' + oh
      + '" fill="url(#' + wpat + ')"/>';
    html += '<rect x="' + (ox + ow - TILE * 0.55) + '" y="' + oy + '" width="' + (TILE * 0.55)
      + '" height="' + oh + '" fill="url(#' + wpat + ')"/>';

    /* 下壁：只留一条暗色踢脚（否则会挡住房间底部的角色） */
    html += '<rect x="' + ox + '" y="' + (oy + oh - TILE * 0.28) + '" width="' + ow
      + '" height="' + (TILE * 0.28) + '" fill="#0a1220" opacity="0.9"/>';

    /* 房间外圈光：把场景从背景里"托"起来（船体格） */
    html += '<rect x="' + (ox - 8) + '" y="' + (oy - 8) + '" width="' + (ow + 16)
      + '" height="' + (oh + 16) + '" fill="none" stroke="#2a4a6e" stroke-width="3" rx="8"/>';
    return html;
  }

  function corridorHtml(M) {
    let html = '<defs><pattern id="sk-floor-corridor" width="' + TILE + '" height="' + TILE
      + '" patternUnits="userSpaceOnUse"><image href="' + ASSET + 'tiles/floor-grate.png" width="'
      + TILE + '" height="' + TILE + '" image-rendering="pixelated"/></pattern></defs>';
    html += '<g class="sk-corridors">';
    const W = M.CORRIDOR_W * TILE;
    for (const L of M.LINKS) {
      const segs = M.corridorSegs ? M.corridorSegs(L) : [];
      if (!segs.length) continue;
      /* 走廊 = 一条折线，用 stroke 画三遍（壁 → 面 → 压暗）。
         〔批 M1 · 2026-10-28〕为什么不再用 <rect>：米字布局的外圈必有 45° 斜廊，
         矩形只能画轴对齐，斜段会画成一大块盖住房间。描边天然支持任意角度与转角，
         而且"壁"用同一路径加粗一号就能画出来（米字/折角/直廊共用一份代码）。 */
      let d = '';
      for (let i = 0; i < segs.length; i++) {
        const g = segs[i];
        d += (i === 0 ? 'M' : 'L') + (g.a.x * TILE).toFixed(1) + ' ' + (g.a.y * TILE).toFixed(1);
        if (i === segs.length - 1) {
          d += 'L' + (g.b.x * TILE).toFixed(1) + ' ' + (g.b.y * TILE).toFixed(1);
        }
      }
      html += '<path class="sk-corridor-wall" d="' + d + '" fill="none" stroke="#0a1220" stroke-width="'
        + (W + TILE * 0.34).toFixed(1) + '" stroke-linecap="butt" stroke-linejoin="miter" opacity="0.85"/>';
      html += '<path class="sk-corridor" d="' + d + '" fill="none" stroke="url(#sk-floor-corridor)" stroke-width="'
        + W.toFixed(1) + '" stroke-linecap="butt" stroke-linejoin="miter"/>';
      /* 廊面压暗：与房间地板同一档，否则廊比房间亮，视线被廊抢走 */
      html += '<path class="sk-corridor-dim" d="' + d + '" fill="none" stroke="#0a1524" stroke-width="'
        + W.toFixed(1) + '" opacity="0.40"/>';
    }
    html += '</g>';
    return html;
  }

  global.SKSceneShell = {
    floorWallShell: floorWallShell,
    corridorHtml: corridorHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
