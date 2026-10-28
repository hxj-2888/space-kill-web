/* =============================================================
 * 新返航录 · V3 规则模式（批 V3-合流 · 2026-10-28）
 * -------------------------------------------------------------
 * 职责：   把「11 人类 vs 4 异形」的实时规则作为**原游戏内的一个模式**挂载，
 *          不新开页面、不复制游戏本体；由开始页的按钮调用 SKV3.start() 进入。
 * 不变量： · 只定义 window.SKV3，不改动老引擎的任何状态与 DOM；
 *          · 进入时创建一个全屏 #v3-root 覆盖层，退出即整块移除（老游戏原样还在）；
 *          · 素材全部复用 assets/scene/**（cozy 瓦片 + 家具 + 15 套行走图）；
 *          · 地图数据内嵌（来自 地图设计_v1/map_v1.json），零 fetch，file:// 也能跑。
 * 依赖：   assets/scene/cozy/tiles|furniture、assets/scene/crew/crew-01..15.png
 * 状态：   模块内闭包持有 G（单局状态），无全局污染（除 SKV3）。
 * 对外：   window.SKV3 = { start, stop, isOpen }
 * 门禁：   test:site（js 已在白名单）、test:fix（老断言不受影响）
 * ============================================================= */
(function (global) {
  'use strict';

  const CSS = String.raw`html,body{margin:0;height:100%;background:#080A0F;overflow:hidden;
    font-family:system-ui,"Microsoft YaHei",sans-serif;color:#DDE3EC}
  #cv{display:block;width:100vw;height:100vh}
  #hud{position:fixed;left:14px;top:12px;font-size:12.5px;line-height:1.75;
    background:rgba(14,18,25,.88);border:1px solid #29303D;border-radius:10px;
    padding:9px 12px;min-width:196px}
  #hud b{color:#F0C674;font-weight:500}
  #bar{height:6px;background:#222833;border-radius:3px;margin:5px 0 7px;overflow:hidden}
  #bar i{display:block;height:100%;background:linear-gradient(90deg,#3FBF8C,#F0C674);width:0}
  #tip{position:fixed;left:14px;bottom:12px;font-size:12px;color:#7C8798;line-height:1.7}
  .ov{position:fixed;inset:0;background:rgba(6,8,12,.86);display:flex;
    align-items:center;justify-content:center;backdrop-filter:blur(2px)}
  .card{background:#12161E;border:1px solid #2A3240;border-radius:14px;padding:22px 26px;
    min-width:420px;max-width:560px}
  .card h2{margin:0 0 4px;font-size:16px;font-weight:500;color:#fff}
  .card .sub{color:#7C8798;font-size:12px;margin-bottom:14px}
  .row{display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid #1F2733;font-size:13px}
  .row span:first-child{color:#8A94A3}
  .row b{color:#F0C674;font-weight:500}
  .btns{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap}
  button{background:#1D2530;color:#DDE3EC;border:1px solid #313B4B;border-radius:8px;
    padding:8px 14px;font-size:13px;cursor:pointer;font-family:inherit}
  button:hover{background:#26313F;border-color:#43536B}
  button.p{background:#2A4A6B;border-color:#3C6690}
  .who{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
  .who button{padding:6px 11px;font-size:12.5px}
  .hide{display:none}
  #m-tally{margin-top:12px}
  .tl-h{font-size:12px;color:#8A94A3;margin-bottom:4px}
  .tl{display:flex;justify-content:space-between;padding:5px 0;border-top:1px solid #1F2733;font-size:12.5px}
  .tl b{color:#F0C674;font-weight:500}
  .tl-note{margin-top:10px;font-size:12.5px;color:#C9D1DB;line-height:1.6}`;

  const HTML = String.raw`<canvas id="cv"></canvas>
<div id="hud">
  <div>维修 <b><span id="pg">0</span> / 40</b></div>
  <div id="bar"><i id="pgi"></i></div>
  <div>剩余 <b id="tm">120</b> 秒 · 第 <b id="nt">1</b> 夜</div>
  <div>你是 <b>人类</b> · 濒死 <b id="dn">0</b> 人</div>
  <div>任务 <b id="tk">0</b>/4 · 资格 <b id="ql">0</b> · 弹 <b id="bl">0</b> · 包 <b id="md">0</b></div>
</div>
<div id="tip">点击地面移动 · E 交互 · R 报告 · F 施救 · Q 开枪 · T 视野 · C 相机（跟随 / 全图）</div>

<div id="meet" class="ov hide"><div class="card">
  <h2 id="m-title">紧急会议</h2>
  <div class="sub" id="m-sub"></div>
  <div id="m-rows">
    <div class="row"><span>报告地点</span><b id="m-room">—</b></div>
    <div class="row"><span>发起报告</span><b id="m-by">—</b></div>
    <div class="row"><span>濒死者</span><b id="m-vic">—</b></div>
  </div>
  <div class="row"><span>阶段</span><b id="m-ph">讨论</b></div>
  <div class="who" id="m-who"></div>
  <div id="m-tally"></div>
  <div class="btns"><button id="m-skip">跳过讨论</button></div>
</div></div>

<div id="end" class="ov hide"><div class="card">
  <h2 id="e-t">结束</h2><div class="sub" id="e-s"></div>
  <div class="btns"><button class="p" id="e-r">再来一局</button></div>
</div></div>`;

  const MAP = {"scale":{"px_per_tile":56,"corridor_w":3.2},"bounds":{"w":98,"h":60},"rooms":[{"id":"bridge","name":"中央会议室","cls":"超大","light":"bright","cut":3,"rect":[20,3,42,16],"doors":[["b",28],["b",56],["r",10]],"poly":[[23,3],[59,3],[62,6],[62,16],[59,19],[23,19],[20,16],[20,6]],"area":654.0,"label":[31,11.5]},{"id":"cam","name":"监控室","cls":"小","light":"bright","cut":2,"rect":[78,5,11,10],"doors":[["l",10],["b",84]],"poly":[[80,5],[87,5],[89,7],[89,13],[87,15],[80,15],[78,13],[78,7]],"area":102.0,"label":[92.5,9.0]},{"id":"ecosys","name":"生态舱","cls":"大","light":"bright","cut":3,"rect":[17,25,22,15],"doors":[["t",28],["l",31],["r",32],["b",30]],"poly":[[20,25],[36,25],[39,28],[39,37],[36,40],[20,40],[17,37],[17,28]],"area":312.0,"label":[28,34.6]},{"id":"power","name":"配电室","cls":"小","light":"dark","cut":2,"rect":[43,27,10,10],"doors":[["l",32]],"poly":[[45,27],[51,27],[53,29],[53,35],[51,37],[45,37],[43,35],[43,29]],"area":92.0,"label":[48,40.2]},{"id":"transit","name":"中转间","cls":"中","light":"bright","cut":2,"rect":[54,25,14,14],"doors":[["t",56],["b",56],["r",32]],"poly":[[56,25],[66,25],[68,27],[68,37],[66,39],[56,39],[54,37],[54,27]],"area":188.0,"label":[62,26.6]},{"id":"fun","name":"娱乐室","cls":"大","light":"bright","cut":3,"rect":[75,25,20,14],"doors":[["l",32],["t",84],["b",83]],"poly":[[78,25],[92,25],[95,28],[95,36],[92,39],[78,39],[75,36],[75,28]],"area":262.0,"label":[82,33.8]},{"id":"engine","name":"引擎","cls":"小","light":"dark","cut":2,"rect":[3,26,11,10],"doors":[["r",31]],"poly":[[5,26],[12,26],[14,28],[14,34],[12,36],[5,36],[3,34],[3,28]],"area":102.0,"label":[8,39.2]},{"id":"med","name":"医疗间","cls":"中","light":"bright","cut":2,"rect":[46,44,18,12],"doors":[["t",56],["l",50],["r",49]],"poly":[[48,44],[62,44],[64,46],[64,54],[62,56],[48,56],[46,54],[46,46]],"area":208.0,"label":[52.5,46.0]},{"id":"armory","name":"军械库","cls":"中","light":"bright","cut":2,"rect":[75,43,16,13],"doors":[["t",83],["l",49]],"poly":[[77,43],[89,43],[91,45],[91,54],[89,56],[77,56],[75,54],[75,45]],"area":200.0,"label":[85,45.0]}],"corridors":[{"id":"c1","a":"bridge","b":"ecosys","pts":[[28,19],[28,25]]},{"id":"c2","a":"bridge","b":"transit","pts":[[56,19],[56,25]]},{"id":"c3","a":"bridge","b":"cam","pts":[[62,10],[78,10]]},{"id":"c4","a":"ecosys","b":"engine","pts":[[17,31],[13,31]]},{"id":"c5","a":"ecosys","b":"power","pts":[[39,32],[43,32]]},{"id":"c6","a":"ecosys","b":"med","pts":[[30,40],[30,50],[46,50]]},{"id":"c7","a":"transit","b":"med","pts":[[56,39],[56,44]]},{"id":"c8","a":"transit","b":"fun","pts":[[68,32],[75,32]]},{"id":"c9","a":"fun","b":"cam","pts":[[84,25],[84,15]]},{"id":"c10","a":"fun","b":"armory","pts":[[83,39],[83,43]]},{"id":"c11","a":"armory","b":"med","pts":[[75,49],[64,49]]}],"cover":[{"room":"bridge","x":38,"y":7.8,"w":6,"h":6,"kind":"table","label":"圆桌"},{"room":"bridge","x":26,"y":11.5,"w":1.6,"h":1.6,"kind":"pillar","label":"立柱"},{"room":"bridge","x":52,"y":7.5,"w":1.6,"h":1.6,"kind":"pillar","label":"立柱"},{"room":"bridge","x":24,"y":4.4,"w":6,"h":1.9,"kind":"console","label":"控制台"},{"room":"bridge","x":46,"y":4.4,"w":6,"h":1.9,"kind":"console","label":"控制台"},{"room":"bridge","x":22.4,"y":9,"w":1.6,"h":1.6,"kind":"pillar","label":"立柱"},{"room":"bridge","x":58.4,"y":14,"w":1.6,"h":1.6,"kind":"pillar","label":"立柱"},{"room":"bridge","x":32,"y":16.4,"w":5,"h":1.5,"kind":"console","label":"大屏"},{"room":"bridge","x":45,"y":16.4,"w":5,"h":1.5,"kind":"console","label":"大屏"},{"room":"ecosys","x":19,"y":26.5,"w":2.5,"h":3,"kind":"tank","label":"培养罐"},{"room":"ecosys","x":19,"y":33,"w":2.5,"h":3,"kind":"tank","label":"培养罐"},{"room":"ecosys","x":35.5,"y":26.5,"w":2.5,"h":3,"kind":"tank","label":"培养罐"},{"room":"ecosys","x":35.5,"y":33,"w":2.5,"h":3,"kind":"tank","label":"培养罐"},{"room":"ecosys","x":26,"y":30,"w":2.5,"h":2.5,"kind":"tree","label":"巨树"},{"room":"ecosys","x":23,"y":36,"w":4,"h":2.5,"kind":"pond","label":"水池"},{"room":"ecosys","x":32.5,"y":30.5,"w":2,"h":2,"kind":"tree","label":"巨树"},{"room":"engine","x":4.5,"y":27,"w":3,"h":3,"kind":"machine","label":"引擎组"},{"room":"engine","x":4.5,"y":32,"w":3,"h":3,"kind":"machine","label":"缸体"},{"room":"engine","x":9,"y":28.5,"w":2,"h":2,"kind":"crate","label":"零件箱"},{"room":"engine","x":9,"y":33,"w":2,"h":2,"kind":"crate","label":"工具箱"},{"room":"power","x":45,"y":28,"w":2.5,"h":2.5,"kind":"console","label":"电控柜"},{"room":"power","x":45,"y":34,"w":2.5,"h":2.5,"kind":"console","label":"变压器"},{"room":"power","x":50,"y":31,"w":1.6,"h":2.2,"kind":"breaker","label":"电闸"},{"room":"transit","x":58,"y":27,"w":3,"h":3,"kind":"crate","label":"货箱"},{"room":"transit","x":58,"y":34,"w":3,"h":3,"kind":"crate","label":"货箱"},{"room":"transit","x":64,"y":28,"w":2.5,"h":2.5,"kind":"crate","label":"货箱"},{"room":"transit","x":64,"y":35,"w":2.5,"h":2.5,"kind":"crate","label":"货箱"},{"room":"transit","x":61.5,"y":30.5,"w":2,"h":3,"kind":"console","label":"升降台"},{"room":"fun","x":77,"y":27,"w":2.5,"h":2.5,"kind":"machine","label":"街机"},{"room":"fun","x":77,"y":35,"w":2.5,"h":2.5,"kind":"machine","label":"街机"},{"room":"fun","x":81,"y":30,"w":3,"h":2,"kind":"sofa","label":"沙发"},{"room":"fun","x":86,"y":29,"w":3,"h":2,"kind":"table","label":"娱乐桌"},{"room":"fun","x":86,"y":35,"w":3,"h":2,"kind":"table","label":"娱乐桌"},{"room":"fun","x":90,"y":26.5,"w":2,"h":2,"kind":"pillar","label":"音响"},{"room":"fun","x":90,"y":36,"w":2,"h":2,"kind":"pillar","label":"音响"},{"room":"cam","x":80,"y":6,"w":4,"h":1.5,"kind":"console","label":"监控墙"},{"room":"cam","x":86,"y":7,"w":2,"h":2,"kind":"console","label":"操作台"},{"room":"cam","x":82,"y":11,"w":1.5,"h":1.5,"kind":"chair","label":"座椅"},{"room":"med","x":47.5,"y":45,"w":2,"h":3,"kind":"bed","label":"病床"},{"room":"med","x":47.5,"y":52,"w":2,"h":3,"kind":"bed","label":"病床"},{"room":"med","x":55,"y":48,"w":3,"h":2,"kind":"table","label":"手术台"},{"room":"med","x":61,"y":45,"w":2.5,"h":2,"kind":"fridge","label":"药柜"},{"room":"med","x":61,"y":53,"w":2.5,"h":2,"kind":"fridge","label":"消毒池"},{"room":"med","x":57,"y":52.5,"w":2,"h":2,"kind":"machine","label":"机器人坞"},{"room":"armory","x":76.5,"y":44,"w":3,"h":2,"kind":"rack","label":"枪架"},{"room":"armory","x":76.5,"y":52,"w":2.5,"h":2,"kind":"crate","label":"弹药箱"},{"room":"armory","x":82,"y":47,"w":3,"h":2,"kind":"table","label":"工作台"},{"room":"armory","x":86,"y":50,"w":2,"h":3,"kind":"console","label":"靶道"},{"room":"armory","x":79,"y":52,"w":2,"h":2,"kind":"machine","label":"保安位"}],"points":[{"room":"engine","x":6,"y":28.5,"kind":"hard","label":"引擎组同步","dur":18},{"room":"engine","x":6,"y":33.5,"kind":"hard","label":"压力表校准","dur":16},{"room":"engine","x":10,"y":29.5,"kind":"normal","label":"零件台","dur":8},{"room":"engine","x":10,"y":34,"kind":"normal","label":"工具架","dur":7},{"room":"ecosys","x":27.2,"y":31.2,"kind":"hard","label":"氧气循环","dur":16},{"room":"ecosys","x":20.2,"y":28,"kind":"normal","label":"培养罐补液","dur":8},{"room":"ecosys","x":36.7,"y":35,"kind":"normal","label":"温控面板","dur":7},{"room":"ecosys","x":24,"y":37.2,"kind":"normal","label":"水培阀","dur":8},{"room":"power","x":51,"y":32.1,"kind":"hard","label":"电路维修","dur":20},{"room":"power","x":46.2,"y":35.2,"kind":"hard","label":"变压器换芯","dur":16},{"room":"power","x":46.2,"y":29.2,"kind":"normal","label":"电控柜","dur":8},{"room":"transit","x":62.5,"y":32,"kind":"normal","label":"升降台","dur":8},{"room":"transit","x":65.2,"y":29.2,"kind":"normal","label":"储物柜","dur":7},{"room":"fun","x":87.5,"y":30,"kind":"normal","label":"娱乐桌","dur":7},{"room":"fun","x":82.5,"y":31,"kind":"normal","label":"点唱机","dur":8},{"room":"med","x":56.5,"y":49,"kind":"hard","label":"手术台校准","dur":15},{"room":"med","x":62.2,"y":46,"kind":"normal","label":"药柜","dur":8},{"room":"med","x":62.2,"y":54,"kind":"normal","label":"消毒循环","dur":7},{"room":"armory","x":87,"y":51.5,"kind":"hard","label":"靶道校准","dur":15},{"room":"armory","x":83.5,"y":48,"kind":"normal","label":"工作台","dur":8},{"room":"armory","x":77.7,"y":53,"kind":"normal","label":"弹药清点","dur":7},{"room":"cam","x":82,"y":6.8,"kind":"hard","label":"监控墙重连","dur":15},{"room":"cam","x":87,"y":8,"kind":"normal","label":"操作台","dur":8},{"room":"cam","x":83,"y":11.7,"kind":"normal","label":"录像归档","dur":7}],"pipes":[{"room":"engine","x":12.2,"y":35.2},{"room":"power","x":52.2,"y":27.8},{"room":"cam","x":88.2,"y":14.2},{"room":"armory","x":90.2,"y":44.2}],"facility":[{"kind":"breaker","room":"power","x":50.8,"y":32.1,"label":"电闸"},{"kind":"medbot","room":"med","x":58,"y":53.5,"label":"医疗机器人"},{"kind":"secbot","room":"armory","x":80,"y":53,"label":"保安机器人"},{"kind":"monitor","room":"cam","x":84,"y":7,"label":"监控台"}],"walls":[[[23.0,3.0],[59,3]],[[59.0,3.0],[62,6]],[[62.0,6.0],[62.0,9.100000000000001]],[[62.0,10.9],[62,16]],[[62.0,16.0],[59,19]],[[59.0,19.0],[56.9,19.0]],[[55.1,19.0],[28.9,19.0]],[[27.099999999999998,19.0],[23,19]],[[23.0,19.0],[20,16]],[[20.0,16.0],[20,6]],[[20.0,6.0],[23,3]],[[80.0,5.0],[87,5]],[[87.0,5.0],[89,7]],[[89.0,7.0],[89,13]],[[89.0,13.0],[87,15]],[[87.0,15.0],[84.9,15.0]],[[83.1,15.0],[80,15]],[[80.0,15.0],[78,13]],[[78.0,13.0],[78.0,10.9]],[[78.0,9.1],[78,7]],[[78.0,7.0],[80,5]],[[20.0,25.0],[27.1,25.0]],[[28.9,25.0],[36,25]],[[36.0,25.0],[39,28]],[[39.0,28.0],[39.0,31.1]],[[39.0,32.9],[39,37]],[[39.0,37.0],[36,40]],[[36.0,40.0],[30.9,40.0]],[[29.1,40.0],[20,40]],[[20.0,40.0],[17,37]],[[17.0,37.0],[17.0,31.9]],[[17.0,30.1],[17,28]],[[17.0,28.0],[20,25]],[[45.0,27.0],[51,27]],[[51.0,27.0],[53,29]],[[53.0,29.0],[53,35]],[[53.0,35.0],[51,37]],[[51.0,37.0],[45,37]],[[45.0,37.0],[43,35]],[[43.0,35.0],[43.0,32.9]],[[43.0,31.1],[43,29]],[[43.0,29.0],[45,27]],[[56.9,25.0],[66,25]],[[66.0,25.0],[68,27]],[[68.0,27.0],[68.0,31.1]],[[68.0,32.9],[68,37]],[[68.0,37.0],[66,39]],[[66.0,39.0],[56.9,39.0]],[[55.363603896932105,38.363603896932105],[54,37]],[[54.0,37.0],[54,27]],[[54.0,27.0],[55.363603896932105,25.63639610306789]],[[78.0,25.0],[83.1,25.0]],[[84.9,25.0],[92,25]],[[92.0,25.0],[95,28]],[[95.0,28.0],[95,36]],[[95.0,36.0],[92,39]],[[92.0,39.0],[83.9,39.0]],[[82.1,39.0],[78,39]],[[78.0,39.0],[75,36]],[[75.0,36.0],[75.0,32.9]],[[75.0,31.1],[75,28]],[[75.0,28.0],[78,25]],[[5.0,26.0],[12,26]],[[12.0,26.0],[14,28]],[[14.0,28.0],[14.0,30.1]],[[14.0,31.9],[14,34]],[[14.0,34.0],[12,36]],[[12.0,36.0],[5,36]],[[5.0,36.0],[3,34]],[[3.0,34.0],[3,28]],[[3.0,28.0],[5,26]],[[48.0,44.0],[55.1,44.0]],[[56.9,44.0],[62,44]],[[62.0,44.0],[64,46]],[[64.0,46.0],[64.0,48.1]],[[64.0,49.9],[64,54]],[[64.0,54.0],[62,56]],[[62.0,56.0],[48,56]],[[48.0,56.0],[46,54]],[[46.0,54.0],[46.0,50.9]],[[46.0,49.1],[46,46]],[[46.0,46.0],[48,44]],[[77.0,43.0],[82.1,43.0]],[[83.9,43.0],[89,43]],[[89.0,43.0],[91,45]],[[91.0,45.0],[91,54]],[[91.0,54.0],[89,56]],[[89.0,56.0],[77,56]],[[77.0,56.0],[75,54]],[[75.0,54.0],[75.0,49.9]],[[75.0,48.1],[75,45]],[[75.0,45.0],[77,43]],[[26.4,19.0],[26.4,25.0]],[[29.6,19.0],[29.6,25.0]],[[54.4,19.0],[54.4,25.0]],[[57.6,19.0],[57.6,25.0]],[[62.0,11.6],[78.0,11.6]],[[62.0,8.4],[78.0,8.4]],[[17.0,29.4],[13.0,29.4]],[[17.0,32.6],[13.0,32.6]],[[39.0,33.6],[43.0,33.6]],[[39.0,30.4],[43.0,30.4]],[[28.4,40.0],[28.4,51.6]],[[31.6,40.0],[31.6,51.6]],[[28.4,51.6],[46.0,51.6]],[[28.4,48.4],[46.0,48.4]],[[54.4,39.0],[54.4,44.0]],[[57.6,39.0],[57.6,44.0]],[[68.0,33.6],[75.0,33.6]],[[68.0,30.4],[75.0,30.4]],[[85.6,25.0],[85.6,15.0]],[[82.4,25.0],[82.4,15.0]],[[81.4,39.0],[81.4,43.0]],[[84.6,39.0],[84.6,43.0]],[[75.0,47.4],[64.0,47.4]],[[75.0,50.6],[64.0,50.6]]]};

  let booted = false;

  function start() {
    if (booted) return;
    booted = true;
    if (!document.getElementById('v3-style')) {
      const st = document.createElement('style');
      st.id = 'v3-style';
      st.textContent = CSS + '\n#v3-root{position:fixed;inset:0;z-index:9999;background:#080A0F}';
      document.head.appendChild(st);
    }
    const root = document.createElement('div');
    root.id = 'v3-root';
    root.innerHTML = HTML;
    document.body.appendChild(root);
    boot();
  }

  function stop() {
    const r = document.getElementById('v3-root');
    if (r) r.remove();
    booted = false;
  }

  function boot() {
    'use strict';
    const M=MAP, CW=M.scale.corridor_w, NIGHT=120, GS=0.6;
    const GW=Math.ceil(M.bounds.w/GS), GH=Math.ceil(M.bounds.h/GS);
    
    /* ---------------- 几何 ---------------- */
    function inPoly(x,y,p){let c=false;
      for(let i=0,j=p.length-1;i<p.length;j=i++){
        const xi=p[i][0],yi=p[i][1],xj=p[j][0],yj=p[j][1];
        if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c;}
      return c;}
    function d2seg(x,y,ax,ay,bx,by){
      const dx=bx-ax,dy=by-ay,L2=dx*dx+dy*dy;
      let t=L2?((x-ax)*dx+(y-ay)*dy)/L2:0; t=Math.max(0,Math.min(1,t));
      const px=ax+t*dx,py=ay+t*dy; return Math.hypot(x-px,y-py);}
    function inCorr(x,y){
      for(const c of M.corridors) for(let i=0;i<c.pts.length-1;i++){
        const a=c.pts[i],b=c.pts[i+1];
        if(d2seg(x,y,a[0],a[1],b[0],b[1])<=CW/2) return c;}
      return null;}
    function roomAt(x,y){for(const r of M.rooms) if(inPoly(x,y,r.poly)) return r; return null;}
    
    /* ---------------- 可行走网格 ---------------- */
    const walk=new Uint8Array(GW*GH);
    (function build(){
      const cov=M.cover.map(c=>[c.x-.34,c.y-.34,c.x+c.w+.34,c.y+c.h+.34]);
      for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){
        const x=(gx+.5)*GS,y=(gy+.5)*GS; let ok=false;
        for(const r of M.rooms) if(inPoly(x,y,r.poly)){ok=true;break;}
        if(!ok&&inCorr(x,y))ok=true;
        if(ok) for(const c of cov) if(x>c[0]&&x<c[2]&&y>c[1]&&y<c[3]){ok=false;break;}
        if(ok) for(const w of M.walls) if(d2seg(x,y,w[0][0],w[0][1],w[1][0],w[1][1])<.36){ok=false;break;}
        walk[gy*GW+gx]=ok?1:0;
      }
    })();
    function free(x,y){const gx=Math.floor(x/GS),gy=Math.floor(y/GS);
      return gx>=0&&gy>=0&&gx<GW&&gy<GH&&walk[gy*GW+gx]===1;}
    function nearestFree(x,y){
      if(free(x,y))return[x,y];
      for(let r=1;r<=8;r++)for(let a=0;a<16;a++){
        const t=a/16*Math.PI*2,nx=x+Math.cos(t)*r*GS,ny=y+Math.sin(t)*r*GS;
        if(free(nx,ny))return[nx,ny];}
      return[x,y];}
    
    function astar(sx,sy,tx,ty){
      const s=nearestFree(sx,sy),t=nearestFree(tx,ty);
      let s0=[Math.floor(s[0]/GS),Math.floor(s[1]/GS)],t0=[Math.floor(t[0]/GS),Math.floor(t[1]/GS)];
      if(s0[0]===t0[0]&&s0[1]===t0[1])return[[tx,ty]];
      const N=GW*GH,gS=idx(s0[0],s0[1]),gT=idx(t0[0],t0[1]);
      const g=new Float32Array(N).fill(1e9),f=new Float32Array(N).fill(1e9);
      const prev=new Int32Array(N).fill(-1),open=[gS],inOpen=new Uint8Array(N);
      g[gS]=0;f[gS]=0;inOpen[gS]=1;
      const H=(i)=>{const x=i%GW,y=(i/GW)|0;return Math.hypot(x-t0[0],y-t0[1]);};
      let guard=0;
      while(open.length&&guard++<40000){
        let bi=0;for(let i=1;i<open.length;i++)if(f[open[i]]<f[open[bi]])bi=i;
        const cur=open.splice(bi,1)[0];inOpen[cur]=0;
        if(cur===gT)break;
        const cx=cur%GW,cy=(cur/GW)|0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          if(!dx&&!dy)continue;
          const nx=cx+dx,ny=cy+dy;
          if(nx<0||ny<0||nx>=GW||ny>=GH)continue;
          const ni=ny*GW+nx; if(!walk[ni])continue;
          if(dx&&dy&&(!walk[cy*GW+nx]||!walk[ny*GW+cx]))continue;
          const ng=g[cur]+(dx&&dy?1.414:1);
          if(ng<g[ni]-1e-6){g[ni]=ng;f[ni]=ng+H(ni);prev[ni]=cur;
            if(!inOpen[ni]){open.push(ni);inOpen[ni]=1;}}
        }
      }
      if(prev[gT]<0&&gT!==gS)return null;
      const out=[];let c=gT;
      while(c!==-1&&c!==gS){out.push([(c%GW+.5)*GS,(((c/GW)|0)+.5)*GS]);c=prev[c];}
      out.reverse(); out.push([tx,ty]);
      return out;
    }
    function idx(x,y){return y*GW+x;}
    
    /* ---------------- 视线 ---------------- */
    function segX(a,b,c,d){
      const r1=b[0]-a[0],r2=b[1]-a[1],s1=d[0]-c[0],s2=d[1]-c[1];
      const den=r1*s2-r2*s1; if(Math.abs(den)<1e-9)return false;
      const t=((c[0]-a[0])*s2-(c[1]-a[1])*s1)/den;
      const u=((c[0]-a[0])*r2-(c[1]-a[1])*r1)/den;
      return t>0.001&&t<0.999&&u>=0&&u<=1;
    }
    function los(x1,y1,x2,y2){
      const a=[x1,y1],b=[x2,y2];
      for(const w of M.walls) if(segX(a,b,w[0],w[1]))return false;
      for(const c of M.cover){
        const p=[[c.x,c.y],[c.x+c.w,c.y],[c.x+c.w,c.y+c.h],[c.x,c.y+c.h]];
        for(let i=0;i<4;i++) if(segX(a,b,p[i],p[(i+1)%4]))return false;}
      return true;
    }
    
    /* ---------------- 状态 ---------------- */
    /* 名字用老数据层的 15 个人名（SKData.NAMES 恒 15 项，长度参与 rng 序列，不要自己造） */
    const NAMES=(function(){
      const base=(global.SKData&&global.SKData.NAMES)||[];
      const rest=base.filter(function(n){return n!=='你';});
      const out=['你'].concat(rest);
      while(out.length<15) out.push('席位'+(out.length+1));
      return out.slice(0,15);
    })();
    let G;
    function newGame(){
      const aliens=new Set();
      while(aliens.size<4) aliens.add(1+Math.floor(Math.random()*14));
      const pts=M.points.map((p,i)=>i);
      const agents=NAMES.map((n,i)=>({
        i,name:n,alien:aliens.has(i),x:0,y:0,path:null,sp:0,
        alive:true,downed:false,downAt:0,
        tasks:shuffle(pts.slice()).slice(0,4),
        tIdx:0,doing:0,progress:0,qual:0,bullet:0,medkit:0,
        knife:1,think:0,target:null
      }));
      // 出生：人类在中央会议室，异形分散
      const br=M.rooms.find(r=>r.id==='bridge');
      agents.forEach(a=>{
        const r=a.alien?M.rooms[3+Math.floor(Math.random()*6)]:br;
        const p=randIn(r); a.x=p[0]; a.y=p[1];
      });
      const me=agents[0];
      G={agents,me,night:1,t:NIGHT,prog:0,over:null,meet:null,
         lit:{},blackout:false,vis:null,fogOn:true,camMode:'follow'};
      refreshLight();
      document.getElementById('end').classList.add('hide');
      setTimeout(()=>openMeeting('pre',null,null),60);
    }
    function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
    function randIn(r){
      for(let k=0;k<200;k++){
        const p=r.poly[Math.floor(Math.random()*r.poly.length)];
        const x=r.rect[0]+Math.random()*r.rect[2],y=r.rect[1]+Math.random()*r.rect[3];
        if(free(x,y)&&inPoly(x,y,r.poly))return[x,y];
      }
      return[r.rect[0]+r.rect[2]/2,r.rect[1]+r.rect[3]/2];
    }
    function refreshLight(){
      for(const r of M.rooms) G.lit[r.id]=(r.light==='bright');
      if(G.blackout) for(const r of M.rooms) G.lit[r.id]=(r.id==='bridge');
    }
    
    /* ---------------- 移动 ---------------- */
    function walkTo(a,x,y){ a.path=astar(a.x,a.y,x,y); }
    function stepMove(a,dt,sp){
      if(!a.path||!a.path.length){a.moving=false;return true;}
      a.moving=true;
      let left=sp*dt;
      while(left>0&&a.path.length){
        const p=a.path[0],dx=p[0]-a.x,dy=p[1]-a.y,d=Math.hypot(dx,dy);
        if(d<0.02){a.path.shift();continue;}
        if(Math.abs(dx)>Math.abs(dy)) a.dir=dx>0?'right':'left'; else a.dir=dy>0?'down':'up';
        if(d<=left){a.x=p[0];a.y=p[1];left-=d;a.path.shift();}
        else{a.x+=dx/d*left;a.y+=dy/d*left;left=0;}
      }
      return a.path.length===0;
    }
    
    /* ---------------- 交互 ---------------- */
    function nearPoint(a){
      let best=null,bd=1.8;
      for(const p of M.points){
        const d=Math.hypot(p.x-a.x,p.y-a.y);
        if(d<bd){bd=d;best=p;}
      }
      return best;
    }
    function myTasksLeft(a){ return a.tasks.filter((t,i)=>i>=a.tIdx); }
    
    /* ---------------- 主循环 ---------------- */
    let last=0;
    function loop(ts){
      const dt=Math.min(0.05,(ts-last)/1000||0); last=ts;
      if(!G.over&&!G.meet) update(dt);
      draw();
      requestAnimationFrame(loop);
    }
    
    function update(dt){
      /* 计时交给 SKClock：相位对象按墙钟走，会议期间不调 update ⇒ 会议时间自然从夜里扣掉 */
      if(!G.phase) G.phase=SKClock.newPhase('night',performance.now(),NIGHT*1000);
      G.t=SKClock.remaining(G.phase,performance.now())/1000;
      // 玩家
      const me=G.me;
      if(me.alive&&!me.downed){
        if(me.path) stepMove(me,dt,5);
        if(me.doing>0){
          me.doing-=dt;
          if(me.doing<=0) finishDoing(me);
        }
      }
      // AI
      for(const a of G.agents){
        if(a===me||!a.alive||a.downed)continue;
        if(a.alien) aiAlien(a,dt); else aiHuman(a,dt);
      }
      // 濒死计时：到天亮才死
      if(G.t<=0) dawn();
      checkWin();
      syncHud();
    }
    
    function aiHuman(a,dt){
      if(a.doing>0){a.doing-=dt;if(a.doing<=0)finishDoing(a);return;}
      if(!a.path||!a.path.length){
        if(a.tIdx>=a.tasks.length){ // 做完了就闲逛
          const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
          const p=randIn(r); walkTo(a,p[0],p[1]); return;
        }
        const p=M.points[a.tasks[a.tIdx]];
        if(Math.hypot(p.x-a.x,p.y-a.y)<1.6){ a.doing=p.dur; }
        else walkTo(a,p.x,p.y);
        return;
      }
      stepMove(a,dt,4.4);
    }
    function aiAlien(a,dt){
      if(a.knife<=0){ // 没刀了就游荡
        if(!a.path||!a.path.length){const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];const p=randIn(r);walkTo(a,p[0],p[1]);}
        stepMove(a,dt,4.6); return;
      }
      if(!a.target||!a.target.alive||a.target.downed){
        let best=null,bd=1e9;
        for(const h of G.agents) if(!h.alien&&h.alive&&!h.downed){
          const d=Math.hypot(h.x-a.x,h.y-a.y); if(d<bd){bd=d;best=h;}}
        a.target=best;
      }
      if(!a.target)return;
      const d=Math.hypot(a.target.x-a.x,a.target.y-a.y);
      if(d<1.3){ knife(a,a.target); return; }
      if(!a.path||!a.path.length) walkTo(a,a.target.x,a.target.y);
      stepMove(a,dt,4.6);
    }
    
    function knife(killer,victim){
      killer.knife--;
      for(const w of G.agents){
        if(w.alien||!w.alive||w.downed||w===victim)continue;
        if(Math.hypot(w.x-killer.x,w.y-killer.y)<6&&los(w.x,w.y,killer.x,killer.y)) w.suspect=killer.i;
      }
      victim.downed=true; victim.downAt=G.t;
      victim.path=null; victim.doing=0;
      if(victim===G.me) toast('你被出刀击倒，濒死');
    }
    
    function finishDoing(a){
      const p=M.points[a.tasks[a.tIdx]];
      if(!p)return;
      const v=p.kind==='hard'?2:1;
      G.prog=Math.min(40,G.prog+v);
      a.tIdx++; a.progress+=v;
      if(a.progress>=3&&a.qual<1)a.qual=1;
      if(a.progress>=5&&a.qual<2)a.qual=2;
      if(a===G.me) toast('完成「'+p.label+'」 +'+v+' 分');
      else if(a.tIdx>=a.tasks.length) toast(a.name+' 做完了自己的任务');
    }
    
    function dawn(){
      for(const a of G.agents) if(a.downed&&a.alive){a.alive=false;}
      G.t=0;
      openMeeting('day',null,null);
    }
    
    function checkWin(){
      const humans=G.agents.filter(a=>!a.alien&&a.alive).length;
      const aliens=G.agents.filter(a=>a.alien&&a.alive).length;
      if(G.prog>=40) endGame(true,'维修 40 分达成');
      else if(aliens===0) endGame(true,'异形全部出局');
      else if(humans===0) endGame(false,'人类全灭');
    }
    function endGame(win,why){
      G.over=true;
      document.getElementById('end').classList.remove('hide');
      document.getElementById('e-t').textContent=win?'人类胜利':'异形胜利';
      document.getElementById('e-s').textContent=why+' · 维修 '+G.prog+'/40 · 第 '+G.night+' 夜';
    }
    
    /* ---------------- 报告 / 会议 / 投票 ---------------- */
    let meetingTick=null;
    function tryReport(){
      if(!G.me.alive||G.me.downed||G.meet||G.over)return;
      let best=null,bd=2.2;
      for(const a of G.agents){
        if(a.downed&&a.alive&&!a.reported){
          const d=Math.hypot(a.x-G.me.x,a.y-G.me.y);
          if(d<bd){bd=d;best=a;}
        }
      }
      if(!best){toast('附近没有可报告的濒死者');return;}
      best.reported=true;
      openMeeting('night',G.me,best);
    }
    function openMeeting(kind,reporter,victim){
      const r=victim?roomAt(victim.x,victim.y):null;
      const roomName=victim?(r?r.name:(inCorr(victim.x,victim.y)?'走廊':'未知位置')):'—';
      const discuss=(kind==='day'||kind==='pre')?60:25;
      const voteT=kind==='pre'?0:(kind==='day'?10:5);
      G.meet={kind,reporter,victim,room:roomName,phase:'discuss',t:discuss,
              discuss,voteT,votes:{},tally:null};
      document.getElementById('meet').classList.remove('hide');
      document.getElementById('m-title').textContent=
        kind==='pre'?'第 1 天 · 开局公开讨论':(kind==='day'?('第 '+G.night+' 天 · 全员会议'):'紧急会议');
      document.getElementById('m-sub').textContent=
        kind==='pre'?('公开讨论 '+discuss+' 秒 · 本轮不投票 · 讨论完直接进入第 1 夜')
        :('讨论 '+discuss+' 秒 + 投票 '+voteT+' 秒'+(kind==='day'?'':'（从夜晚时间里扣）'));
      document.getElementById('m-rows').style.display=victim?'':'none';
      document.getElementById('m-room').textContent=roomName;
      document.getElementById('m-by').textContent=reporter?reporter.name:'—';
      document.getElementById('m-vic').textContent=victim?victim.name:'—';
      document.getElementById('m-ph').textContent='讨论';
      document.getElementById('m-skip').classList.remove('hide');
      document.getElementById('m-who').innerHTML='';
      document.getElementById('m-tally').innerHTML='';
      meetingTimer();
    }
    function meetingTimer(){
      clearInterval(meetingTick);
      meetingTick=setInterval(()=>{
        const m=G.meet; if(!m){clearInterval(meetingTick);return;}
        m.t-=0.1;
        if(m.phase==='discuss'&&m.t<=0){ if(m.voteT>0) startVote(); else finishMeeting(); }
        else if(m.phase==='vote'&&m.t<=0) closeVote();
        else if(m.phase==='reveal'&&m.t<=0) finishMeeting();
        const ph=document.getElementById('m-ph');
        if(ph&&G.meet) ph.textContent=
          (m.phase==='discuss'?'讨论 ':m.phase==='vote'?'投票 ':'公布 ')+Math.max(0,m.t).toFixed(0)+'s';
      },100);
    }
    function startVote(){
      const m=G.meet; m.phase='vote'; m.t=m.voteT;
      document.getElementById('m-skip').classList.add('hide');
      const box=document.getElementById('m-who'); box.innerHTML='';
      if(!G.me.downed&&G.me.alive){
        for(const a of G.agents){
          if(!a.alive||a===G.me)continue;
          const btn=document.createElement('button');
          btn.textContent=a.name;
          btn.onclick=()=>{ m.votes[G.me.i]=a.i;
            [...box.children].forEach(c=>c.style.borderColor='#313B4B');
            btn.style.borderColor='#F0C674'; };
          box.appendChild(btn);
        }
        const sk=document.createElement('button');
        sk.textContent='弃权';
        sk.onclick=()=>{ m.votes[G.me.i]=-1;
          [...box.children].forEach(c=>c.style.borderColor='#313B4B');
          sk.style.borderColor='#F0C674'; };
        box.appendChild(sk);
      }
      // AI 投票：只看自己看到的（异形之间互不知道身份，没有协同）
      for(const a of G.agents){
        if(!a.alive||a===G.me||a.downed)continue;
        if(a.suspect!=null&&G.agents[a.suspect]&&G.agents[a.suspect].alive&&G.agents[a.suspect]!==a){
          m.votes[a.i]=a.suspect; continue;
        }
        const pool=G.agents.filter(x=>x.alive&&x!==a);
        m.votes[a.i]=pool.length?pool[Math.floor(Math.random()*pool.length)].i:-1;
      }
    }
    function closeVote(){
      const m=G.meet; m.phase='reveal'; m.t=6;
      const tally={}; let abstain=0;
      for(const k in m.votes){const v=m.votes[k]; if(v<0){abstain++;continue;} tally[v]=(tally[v]||0)+1;}
      let max=0,top=-1,tie=false;
      for(const k in tally){const c=tally[k];
        if(c>max){max=c;top=+k;tie=false;} else if(c===max) tie=true;}
      const ok=(max>=3&&!tie);
      const ex=ok?G.agents[top]:null;
      if(ex){ex.alive=false;ex.downed=false;}
      m.tally={tally,abstain,max,ok,ex};
      renderTally();
    }
    function renderTally(){
      const m=G.meet, box=document.getElementById('m-tally');
      const {tally,abstain,max,ex}=m.tally;
      const rows=Object.keys(tally).map(k=>({n:G.agents[k].name,c:tally[k]})).sort((a,b)=>b.c-a.c);
      let h='<div class="tl-h">投票结果（过程不可见）</div>';
      for(const r of rows) h+='<div class="tl"><span>'+r.n+'</span><b>'+r.c+' 票</b></div>';
      h+='<div class="tl"><span>弃权</span><b>'+abstain+' 票</b></div>';
      h+='<div class="tl-note">'+(ex
          ?('驱逐 '+ex.name+' —— '+max+' 票，唯一最高票且达到 3 票门槛')
          :(max<3?('最高票 '+max+' 票，未达 3 票门槛 ⇒ 无人出局')
                  :('最高票 '+max+' 票但有平票 ⇒ 无人出局')))+'</div>';
      box.innerHTML=h;
      document.getElementById('m-who').innerHTML='';
    }
    function finishMeeting(){
      const m=G.meet; clearInterval(meetingTick);
      const kind=m&&m.kind;
      G.meet=null;
      document.getElementById('meet').classList.add('hide');
      checkWin(); if(G.over)return;
      if(kind==='day') startNight(true);
      else if(kind==='pre') startNight(false);
    }
    function startNight(inc){
      if(inc!==false) G.night++;
      G.t=NIGHT;
      G.phase=SKClock.newPhase('night',performance.now(),NIGHT*1000);
      for(const a of G.agents){a.knife=1;a.path=null;a.doing=0;a.target=null;a.reported=false;}
      refreshLight();
      toast('第 '+G.night+' 夜开始');
    }
    
    /* ---------------- 玩家输入 ---------------- */
    const cv=document.getElementById('cv'),ctx=cv.getContext('2d');
    let VIEW={s:10,ox:0,oy:0},dpr=window.devicePixelRatio||1;
    /* 视窗：跟随模式只给 26 格宽（≈ 原游戏 30×12 的近景），全图模式才铺满。
       这是「保留相机跟随」这条要求的落点 —— 平时看不到全船，只锁自己周围一小块。 */
    const VIEW_TILES=30;   /* 与老版 js/scene/const.js 的 VIEW_TILES.w=30 对齐 */
    function resize(){
      cv.width=innerWidth*dpr;cv.height=innerHeight*dpr;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      let s;
      if(G&&G.camMode==='map') s=Math.min(innerWidth/M.bounds.w,innerHeight/M.bounds.h)*0.94;
      else s=innerWidth/VIEW_TILES;
      VIEW={s:s,ox:0,oy:0};
      PAT={};
      updateCamera();
    }
    function updateCamera(){
      const s=VIEW.s, mw=M.bounds.w*s, mh=M.bounds.h*s;
      if(G&&G.camMode==='map'){
        VIEW.ox=(innerWidth-mw)/2; VIEW.oy=(innerHeight-mh)/2; return;
      }
      let ox=innerWidth/2-(G?G.me.x:0)*s, oy=innerHeight/2-(G?G.me.y:0)*s;
      ox = mw>innerWidth ? Math.min(0,Math.max(innerWidth-mw,ox)) : (innerWidth-mw)/2;
      oy = mh>innerHeight ? Math.min(0,Math.max(innerHeight-mh,oy)) : (innerHeight-mh)/2;
      VIEW.ox=ox; VIEW.oy=oy;
    }
    addEventListener('resize',()=>{resize();PAT={};});
    const SX=x=>x*VIEW.s+VIEW.ox, SY=y=>y*VIEW.s+VIEW.oy;
    const WX=x=>(x-VIEW.ox)/VIEW.s, WY=y=>(y-VIEW.oy)/VIEW.s;
    
    cv.addEventListener('click',e=>{
      if(G.over||G.meet||!G.me.alive||G.me.downed)return;
      const p=astar(G.me.x,G.me.y,WX(e.clientX),WY(e.clientY));
      if(p)G.me.path=p;
    });
    addEventListener('keydown',e=>{
      const k=e.key.toLowerCase();
      if(k==='r'){tryReport();return;}
      if(k==='e'){interact();return;}
      if(k==='f'){rescue();return;}
      if(k==='q'){shoot();return;}
      if(k==='t'){G.fogOn=!G.fogOn;toast(G.fogOn?'视野：手电筒':'视野：全亮（审计用）');return;}
      if(k==='c'){G.camMode=(G.camMode==='map'?'follow':'map');resize();
        toast(G.camMode==='map'?'相机：全图':'相机：跟随（近景）');return;}
    });
    
    function interact(){
      const me=G.me; if(!me.alive||me.downed)return;
      if(me.doing>0)return;
      const p=nearPoint(me);
      if(p&&me.tasks.slice(me.tIdx).includes(M.points.indexOf(p))){
        me.doing=p.dur; toast('开始维修「'+p.label+'」 '+p.dur+'s'); return;
      }
      const r=roomAt(me.x,me.y);
      if(r&&r.id==='med'&&me.qual>0&&me.medkit<1){ me.doing=6; me._doing='med'; toast('取医疗包 6s'); return; }
      if(r&&r.id==='armory'&&me.qual>0&&me.bullet<1){ me.doing=10; me._doing='ammo'; toast('取子弹 10s'); return; }
      if(r&&r.id==='power'&&false){}
      toast('这里没有你能做的事');
    }
    function rescue(){
      const me=G.me; if(!me.alive||me.downed)return;
      if(me.medkit<1){toast('没有医疗包');return;}
      let best=null,bd=1.8;
      for(const a of G.agents) if(a.downed&&a.alive){
        const d=Math.hypot(a.x-me.x,a.y-me.y); if(d<bd){bd=d;best=a;}}
      if(!best){toast('附近没有濒死者');return;}
      me.doing=5; me._doing='revive'; me._rv=best; toast('施救中 5s');
    }
    function shoot(){
      const me=G.me; if(me.bullet<1){toast('没有子弹');return;}
      let best=null,bd=1e9;
      for(const a of G.agents){
        if(a===me||!a.alive||a.downed)continue;
        const d=Math.hypot(a.x-me.x,a.y-me.y);
        if(d<9&&los(me.x,me.y,a.x,a.y)&&d<bd){bd=d;best=a;}
      }
      if(!best){toast('视野内没有目标');return;}
      me.bullet--;
      best.downed=true; best.downAt=G.t; best.path=null;
      toast('开枪击中 '+best.name);
    }
    
    function toast(s){ G.msg=s; G.msgT=2.6; }
    
    /* ---------------- 素材 ---------------- */
    const A='assets/scene/';
    const IMG={};
    function loadImg(k,src){const i=new Image();i.src=A+src;IMG[k]=i;return i;}
    const FLOOR={bridge:'cozy/tiles/floor-carpet-blue.png',ecosys:'cozy/tiles/floor-grate.png',
      engine:'cozy/tiles/floor-grate.png',power:'cozy/tiles/floor-steel-vent.png',
      transit:'cozy/tiles/floor-steel.png',fun:'cozy/tiles/floor-carpet-beige.png',
      cam:'cozy/tiles/floor-steel-bolts.png',med:'cozy/tiles/floor-lab.png',
      armory:'cozy/tiles/floor-hazard.png'};
    const FURN={table:'table',console:'console',pillar:'locker',tank:'cooler',tree:'plant',
      pond:'rug',machine:'rack',crate:'crate',breaker:'console',sofa:'sofa',chair:'chair',
      bed:'bed',fridge:'fridge',rack:'rack'};
    for(const k in FLOOR) loadImg('fl_'+k,FLOOR[k]);
    const FSET=new Set(Object.values(FURN));
    for(const f of FSET) loadImg('fu_'+f,'cozy/furniture/'+f+'.png');
    for(let i=1;i<=15;i++) loadImg('cr_'+i,'crew/crew-'+String(i).padStart(2,'0')+'.png');
    const ROW={down:0,up:1,left:3,right:4};
    function ready(im){return im&&im.complete&&im.naturalWidth>0;}
    
    let PAT={};
    function patFor(r){
      const key=r.id+'|'+VIEW.s.toFixed(2);
      if(PAT[key])return PAT[key];
      const im=IMG['fl_'+r.id]||IMG['fl_transit'];
      if(!ready(im))return null;
      const p=ctx.createPattern(im,'repeat');
      const k=VIEW.s/32;
      if(p&&p.setTransform) p.setTransform(new DOMMatrix([k,0,0,k,0,0]));
      PAT[key]=p; return p;
    }
    
    /* ---------------- 渲染 ---------------- */
    function draw(){
      const T=performance.now()/1000;
      updateCamera();
      ctx.fillStyle='#07090D';ctx.fillRect(0,0,innerWidth,innerHeight);
      const me=G.me;
      // 走廊
      for(const c of M.corridors){
        ctx.strokeStyle='#1A2029';ctx.lineWidth=CW*VIEW.s;ctx.lineCap='butt';ctx.lineJoin='round';
        ctx.beginPath();c.pts.forEach((p,i)=>i?ctx.lineTo(SX(p[0]),SY(p[1])):ctx.moveTo(SX(p[0]),SY(p[1])));ctx.stroke();
        ctx.strokeStyle='#2A323E';ctx.lineWidth=1;
        ctx.beginPath();c.pts.forEach((p,i)=>i?ctx.lineTo(SX(p[0]),SY(p[1])):ctx.moveTo(SX(p[0]),SY(p[1])));ctx.stroke();
      }
      // 房间：真实地板瓦片 + 亮暗
      for(const r of M.rooms){
        const lit=G.lit[r.id];
        ctx.beginPath();r.poly.forEach((p,i)=>i?ctx.lineTo(SX(p[0]),SY(p[1])):ctx.moveTo(SX(p[0]),SY(p[1])));ctx.closePath();
        ctx.save();ctx.clip();
        const pat=patFor(r);
        if(pat){ctx.fillStyle=pat;}
        else{ctx.fillStyle=lit?'#1E2632':'#12171E';}
        ctx.fillRect(SX(r.rect[0])-2,SY(r.rect[1])-2,(r.rect[2]+4)*VIEW.s,(r.rect[3]+4)*VIEW.s);
        if(!lit){ctx.fillStyle='rgba(3,5,9,.62)';ctx.fillRect(SX(r.rect[0])-2,SY(r.rect[1])-2,(r.rect[2]+4)*VIEW.s,(r.rect[3]+4)*VIEW.s);}
        ctx.restore();
        ctx.strokeStyle=lit?'#39434F':'#22272F';ctx.lineWidth=1.5;ctx.stroke();
      }
      // 掩体：真实家具贴图（底边对齐）
      for(const c of M.cover){
        const im=IMG['fu_'+(FURN[c.kind]||'crate')];
        if(ready(im)){
          const ar=im.naturalWidth/im.naturalHeight;
          let w=c.w*VIEW.s, h=w/ar;
          const maxH=(c.h+0.9)*VIEW.s;
          if(h>maxH){h=maxH;w=h*ar;}
          ctx.drawImage(im,SX(c.x+c.w/2)-w/2,SY(c.y+c.h)-h,w,h);
        }else{
          ctx.fillStyle='#2E3742';ctx.beginPath();
          ctx.rect(SX(c.x),SY(c.y),c.w*VIEW.s,c.h*VIEW.s);ctx.fill();
        }
      }
      // 房名
      ctx.font='500 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
      for(const r of M.rooms){
        let cx=0,cy=0;r.poly.forEach(p=>{cx+=p[0];cy+=p[1]});cx/=r.poly.length;cy/=r.poly.length;
        ctx.lineWidth=3;ctx.strokeStyle=G.lit[r.id]?'rgba(255,255,255,.85)':'rgba(10,14,20,.75)';
        ctx.strokeText(r.name,SX(cx),SY(cy));
        ctx.fillStyle=G.lit[r.id]?'#121A24':'rgba(150,158,170,.75)';
        ctx.fillText(r.name,SX(cx),SY(cy));
      }
      // 任务点
      for(const p of M.points){
        ctx.beginPath();ctx.arc(SX(p.x),SY(p.y),2.6,0,7);
        ctx.fillStyle=p.kind==='hard'?'#C0392B':'#2E6DA4';ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,.45)';ctx.lineWidth=.8;ctx.stroke();
      }
      // 角色：真实行走图
      for(const a of G.agents){
        if(!a.alive)continue;
        if(a.downed){
          ctx.strokeStyle='#C0392B';ctx.lineWidth=2.6;
          const x=SX(a.x),y=SY(a.y),r=5;
          ctx.beginPath();ctx.moveTo(x-r,y-r);ctx.lineTo(x+r,y+r);ctx.moveTo(x+r,y-r);ctx.lineTo(x-r,y+r);ctx.stroke();
          continue;
        }
        if(a!==me&&!canSee(a))continue;
        const im=IMG['cr_'+((a.i%15)+1)];
        if(ready(im)){
          const w=1.25*VIEW.s,h=w*160/96;
          const row=a.moving?(ROW[a.dir]||0):2;
          const fr=a.moving?(Math.floor(T*7)%4):0;
          ctx.drawImage(im,fr*96,row*160,96,160,SX(a.x)-w/2,SY(a.y)-h*0.86,w,h);
        }else{
          ctx.beginPath();ctx.arc(SX(a.x),SY(a.y),5,0,7);
          ctx.fillStyle=a===me?'#F0C674':'#8FA6C0';ctx.fill();
        }
        if(a===me){ctx.strokeStyle='rgba(240,198,116,.7)';ctx.lineWidth=1.4;
          ctx.beginPath();ctx.arc(SX(a.x),SY(a.y),11,0,7);ctx.stroke();}
      }
      drawFog();
      if(G.msgT>0){G.msgT-=0.016;
        ctx.fillStyle='rgba(240,198,116,.95)';ctx.font='500 14px system-ui';ctx.textAlign='center';
        ctx.fillText(G.msg,innerWidth/2,innerHeight-56);}
    }
    function canSee(a){
      if(!G.fogOn)return true;
      const me=G.me;
      const r=roomAt(me.x,me.y);
      if(r&&G.lit[r.id]&&inPoly(a.x,a.y,r.poly)&&los(me.x,me.y,a.x,a.y))return true;
      const d=Math.hypot(a.x-me.x,a.y-me.y);
      if(d>7)return false;
      if(!los(me.x,me.y,a.x,a.y))return false;
      const ang=Math.atan2(a.y-me.y,a.x-me.x),aim=Math.atan2(G.aimY-me.y,G.aimX-me.x);
      let dd=Math.abs(ang-aim); if(dd>Math.PI)dd=2*Math.PI-dd;
      return dd<=Math.PI/6;
    }
    function drawFog(){
      if(!G.fogOn)return;
      const me=G.me;
      const off=document.createElement('canvas');off.width=cv.width;off.height=cv.height;
      const o=off.getContext('2d');o.setTransform(dpr,0,0,dpr,0,0);
      o.fillStyle='rgba(4,6,10,.87)';o.fillRect(0,0,innerWidth,innerHeight);
      o.globalCompositeOperation='destination-out';
      const r=roomAt(me.x,me.y);
      if(r&&G.lit[r.id]){
        o.beginPath();r.poly.forEach((p,i)=>i?o.lineTo(SX(p[0]),SY(p[1])):o.moveTo(SX(p[0]),SY(p[1])));o.closePath();o.fill();
        for(const c of M.corridors){
          if((c.a===r.id||c.b===r.id)&&!G.blackout){
            o.strokeStyle='#000';o.lineWidth=CW*VIEW.s;o.lineCap='butt';
            o.beginPath();c.pts.forEach((p,i)=>i?o.lineTo(SX(p[0]),SY(p[1])):o.moveTo(SX(p[0]),SY(p[1])));o.stroke();
          }
        }
      }
      // 手电锥
      const ax=me.x,ay=me.y;
      let a0=Math.atan2(G.aimY-ay,G.aimX-ax);
      o.beginPath();o.moveTo(SX(ax),SY(ay));
      for(let i=0;i<=40;i++){
        const ang=a0-Math.PI/6+Math.PI/3*i/40;
        let t=7;
        for(let s=0.4;s<7;s+=0.3){
          const px=ax+Math.cos(ang)*s,py=ay+Math.sin(ang)*s;
          if(!free(px,py)){t=s;break;}
          let hit=false;
          for(const c of M.cover) if(px>c.x&&px<c.x+c.w&&py>c.y&&py<c.y+c.h){hit=true;break;}
          if(hit){t=s;break;}
        }
        o.lineTo(SX(ax+Math.cos(ang)*t),SY(ay+Math.sin(ang)*t));
      }
      o.closePath();o.fill();
      o.beginPath();o.arc(SX(ax),SY(ay),1.5*VIEW.s,0,7);o.fill();
      o.globalCompositeOperation='source-over';
      ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(off,0,0);ctx.restore();
    }
    cv.addEventListener('mousemove',e=>{G.aimX=WX(e.clientX);G.aimY=WY(e.clientY);});
    
    /* ---------------- HUD ---------------- */
    function syncHud(){
      document.getElementById('pg').textContent=G.prog;
      document.getElementById('pgi').style.width=(G.prog/40*100)+'%';
      document.getElementById('tm').textContent=Math.max(0,G.t).toFixed(0);
      document.getElementById('nt').textContent=G.night;
      document.getElementById('dn').textContent=G.agents.filter(a=>a.downed&&a.alive).length;
      document.getElementById('tk').textContent=G.me.tIdx;
      document.getElementById('ql').textContent=G.me.qual;
      document.getElementById('bl').textContent=G.me.bullet;
      document.getElementById('md').textContent=G.me.medkit;
    }
    document.getElementById('m-skip').onclick=()=>{const m=G.meet;if(!m||m.phase!=='discuss')return;
      if(m.voteT>0) startVote(); else finishMeeting();};
    document.getElementById('e-r').onclick=()=>{newGame();};
    
    resize();newGame();G.aimX=G.me.x+1;G.aimY=G.me.y;
    requestAnimationFrame(loop);
  }


  /* 开始页入口：把 #btn-v3 绑到 start()（不新开页面） */
  function bindEntry(){
    var b=document.getElementById('btn-v3');
    if(b && !b.__v3bound){
      b.__v3bound=1;
      b.addEventListener('click', function(e){ e.preventDefault(); start(); });
    }
  }
  bindEntry();
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', bindEntry);

  global.SKV3 = { start: start, stop: stop, isOpen: function () { return booted; } };
})(window);
