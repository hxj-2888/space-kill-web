/* =============================================================
 * SKUITemplates · 游戏界面样式与结构模板（返航录V2 · 2026-10-29）
 * -------------------------------------------------------------
 * 职责：   集中存放 `#v3-root` 的 CSS 与 HTML 字符串，供 js/game.js 注入页面。
 * 不变量： · 纯字符串常量，不读 DOM、不执行逻辑；
 *          · 与 js/game.js 的 DOM id 一一对应（改 id 必须同批改这里与 game.js）。
 * 依赖：   无。
 * 对外：   window.SKUITemplates = { CSS, HTML }
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
  #tip{position:fixed;left:14px;bottom:12px;font-size:12px;color:#FFE0A3;line-height:1.7;
    background:linear-gradient(90deg,rgba(62,38,6,.95),rgba(28,22,12,.88));
    border:1px solid #B9892F;border-left:4px solid #FFB020;border-radius:8px;
    padding:7px 12px 7px 10px;box-shadow:0 0 22px rgba(255,176,32,.16);
    max-width:calc(100vw - 420px);text-shadow:0 1px 2px rgba(0,0,0,.7)}
  #tip::before{content:"操作";display:inline-block;margin-right:8px;padding:0 6px;
    background:#FFB020;color:#1A1306;border-radius:4px;font-weight:700;font-size:11px;
    letter-spacing:1px;vertical-align:1px}
  #tasks{margin-top:8px;border-top:1px solid #2B3442;padding-top:7px;font-size:11.5px}
  #tasks .th{color:#8A94A3;letter-spacing:1.5px;font-size:10.5px;margin-bottom:3px}
  #tasks .tr{display:flex;gap:6px;align-items:baseline;padding:2px 0;color:#B7C2D0;line-height:1.45}
  #tasks .tr .no{color:#5E6B7C;font-variant-numeric:tabular-nums;min-width:15px}
  #tasks .tr .tag{flex:0 0 auto;font-size:9.5px;padding:0 4px;border-radius:3px;border:1px solid #4A5568;color:#8FA6C0}
  #tasks .tr.hard .tag{color:#FF9A90;border-color:#7A3530;background:rgba(90,28,26,.35)}
  #tasks .tr.normal .tag{color:#8CC6F0;border-color:#2E587A;background:rgba(22,50,76,.35)}
  #tasks .tr .loc{color:#F0C674}
  #tasks .tr .nm{color:#DDE3EC;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #tasks .tr.now{background:rgba(240,198,116,.08);border-radius:4px;padding-left:2px}
  #tasks .tr.done{opacity:.42}
  #tasks .tr.done .nm{text-decoration:line-through}
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
  .mtg{display:grid;grid-template-columns:1fr 1.05fr .95fr;gap:14px;width:min(1180px,94vw);
    height:min(620px,86vh)}
  .mtg .col{background:#12161E;border:1px solid #2A3240;border-radius:14px;padding:16px 18px;
    display:flex;flex-direction:column;min-height:0}
  .mtg .ch{font-size:12px;color:#8A94A3;letter-spacing:2px;margin-bottom:10px}
  .mtg .mid h2{margin:0 0 4px}
  #m-say{flex:1;overflow-y:auto;font-size:13px;line-height:1.9;padding-right:4px}
  #m-say .ln{margin-bottom:6px;color:#C9D1DB;word-break:break-word}
  #m-say .ln b{color:#8FA6C0;font-weight:500;margin-right:8px}
  #m-say .ln.me b{color:#F0C674}
  #hud .surv b{font-variant-numeric:tabular-nums}
  #hud #hum{color:#8FD3F0}
  #hud #ali{color:#FF8A80}
  #pwr.off{color:#FF6B61 !important}
  #pwr.full{color:#7FE3B4 !important}
  #cam{z-index:8}
  #cam .cam-panel{background:#070C12;border:1px solid #24405A;border-radius:14px;
    padding:14px 16px 12px;box-shadow:0 24px 80px rgba(0,0,0,.65);max-width:calc(100vw - 28px)}
  .cam-head{display:flex;align-items:baseline;justify-content:space-between;gap:18px;margin-bottom:9px}
  .cam-title{font-size:14px;letter-spacing:2px;color:#BFE9F7}
  .cam-sub{font-size:10.5px;color:#5E7286;letter-spacing:1px}
  .cam-right{display:flex;gap:14px;align-items:baseline;font-size:11px;color:#8A94A3}
  #cam-state{color:#5FE0A8}
  #cam-state.cut{color:#FF6B61}
  #camcv{display:block;width:min(1080px,calc(92vw - 32px));height:auto;border-radius:8px;
    background:#04070B;border:1px solid #16222E}
  .cam-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;
    margin-top:9px;font-size:11px;color:#6D7C8D}
  .cam-foot b{color:#BFE9F7;font-weight:500}
  .cam-foot button{padding:5px 10px;font-size:11.5px}
  #wheel{z-index:9;background:rgba(6,8,12,.62)}
  .wheel-card{position:relative;width:min(520px,92vw);height:min(520px,92vw);border-radius:50%;
    background:radial-gradient(circle at 50% 50%,rgba(26,34,45,.98),rgba(9,13,19,.97) 70%);
    border:1px solid #33465C;box-shadow:0 24px 90px rgba(0,0,0,.7),inset 0 0 40px rgba(60,90,120,.12)}
  .wheel-title{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#F0C674;
    font-size:14px;letter-spacing:3px;text-align:center;line-height:1.6;pointer-events:none}
  .wheel-sub{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);color:#6D7C8D;
    font-size:11px;letter-spacing:1px;white-space:nowrap}
  #wheel-opts{position:absolute;inset:0}
  #wheel-opts button{position:absolute;transform:translate(-50%,-50%);width:150px;padding:8px 9px;
    display:flex;align-items:center;gap:7px;justify-content:flex-start;white-space:nowrap}
  #wheel-opts .pn{display:inline-flex;width:17px;height:17px;border-radius:50%;align-items:center;
    justify-content:center;background:rgba(240,198,116,.18);color:#F0C674;font-size:10px;flex:0 0 auto}
  #wheel-opts .pl{font-size:12px;color:#DDE3EC;overflow:hidden;text-overflow:ellipsis}
  #pipe{z-index:8}
  .pipe-card{width:min(520px,88vw);min-width:0}
  .pipe-list{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
  .pipe-list button{display:flex;align-items:center;gap:9px;text-align:left;padding:10px 11px}
  .pipe-list .pn{color:#A896FF;font-variant-numeric:tabular-nums;font-size:11px}
  .pipe-list .pr{color:#DDE3EC;font-size:13px}
  .pipe-list .pd{margin-left:auto;color:#6D7C8D;font-size:10.5px}
  .pipe-card .sub{margin-bottom:2px}
  #sabot .pipe-list .pn{color:#FF9A90}
  #dmgline{margin-top:8px;border-top:1px solid #4A2320;padding-top:6px;
    font-size:11.5px;color:#FF9A90;line-height:1.55;max-width:236px}
  #dmgline b{color:#FF6B61;font-weight:500}
  .inp{display:flex;gap:8px;margin-top:10px}
  .inp input{flex:1;background:#0D1117;border:1px solid #313B4B;border-radius:8px;
    color:#DDE3EC;padding:8px 10px;font-size:13px;font-family:inherit;outline:none}
  .inp input:focus{border-color:#F0C674}
  .vote .who{flex:0 0 auto;max-height:52%;overflow-y:auto}
  .vote #m-tally{flex:1;overflow-y:auto;margin-top:10px}
  #m-tally{margin-top:12px}
  .tl-h{font-size:12px;color:#8A94A3;margin-bottom:4px}
  .tl{display:flex;justify-content:space-between;padding:5px 0;border-top:1px solid #1F2733;font-size:12.5px}
  .tl b{color:#F0C674;font-weight:500}
  .tl-note{margin-top:10px;font-size:12.5px;color:#C9D1DB;line-height:1.6}
  .ex-role{font-weight:700;letter-spacing:.5px}
  .ex-role.ali{color:#FF8A80}
  .ex-role.hum{color:#8FD3F0}
  #devline{color:#7FD3F0}
  #dev{position:fixed;right:196px;top:16px;width:272px;max-height:calc(100vh - 150px);overflow-y:auto;
    background:rgba(9,13,19,.93);border:1px solid #2E4A63;border-radius:10px;padding:10px 12px;
    font-size:11.5px;line-height:1.5;z-index:6;box-shadow:0 8px 30px rgba(0,0,0,.45);
    pointer-events:none}
  #dev .dt{color:#7FD3F0;letter-spacing:1.5px;font-size:10.5px;margin-bottom:6px}
  #dev .dr{display:grid;grid-template-columns:1fr auto;gap:0 6px;padding:3px 0;border-top:1px solid #1B2530}
  #dev .dr b{color:#C9D1DB;font-weight:500}
  #dev .dr span{color:#7C8798;font-size:10.5px}
  #dev .dr i{grid-column:1/3;color:#5E6B7C;font-style:normal;font-size:10.5px}
  #dev .dr.al b{color:#E0574F}
  #dev .dr.dead{opacity:.5}
  #dev .dr.me b{color:#F0C674}
  #dev .dt2{margin-top:6px;color:#5E6B7C;font-size:10.5px;line-height:1.6}
  #dragtag{position:fixed;left:50%;bottom:88px;transform:translateX(-50%);font-size:12px;
    color:#F0C674;background:rgba(10,14,20,.88);border:1px solid #4A3C1E;border-radius:8px;
    padding:4px 12px;z-index:5}
  #invfail{position:fixed;left:50%;top:10px;transform:translateX(-50%);font-size:12px;color:#FF8A80;
    background:rgba(40,8,8,.94);border:1px solid #7A2A2A;border-radius:8px;padding:6px 12px;z-index:50}
  #body .card{width:min(460px,88vw)}
  #body .row{display:flex;justify-content:space-between;gap:18px;padding:7px 0;
    border-top:1px solid #1F2733;font-size:13px;align-items:flex-start}
  #body .row span:first-child{color:#8A94A3;flex:0 0 auto}
  #body .row b{color:#F0C674;font-weight:500;text-align:right;word-break:break-word}
  #body .bd-note{margin-top:12px;font-size:12px;color:#7C8798;line-height:1.7}
  #body .bd-bad{color:#E0574F}
  @keyframes qpop{0%{transform:scale(1)}35%{transform:scale(1.9);color:#FFF3C4;text-shadow:0 0 12px #F0C674}100%{transform:scale(1)}}
  #hud b.pop{display:inline-block;animation:qpop .75s ease}
  #m-say .ln.sys{color:#7C8798;font-size:12px}`;

  const HTML = String.raw`<canvas id="cv"></canvas>
<div id="hud">
  <div>维修 <b><span id="pg">0</span> / 40</b></div>
  <div id="bar"><i id="pgi"></i></div>
  <div>剩余 <b id="tm">120</b> 秒 · 第 <b id="nt">1</b> 夜 · <b id="pwr">照明正常</b></div>
  <div class="surv">存活 <b id="alive">15</b> 人 · 人类 <b id="hum">11</b> · 异形 <b id="ali">4</b></div>
  <div>你是 <b id="role">人类</b> · 濒死 <b id="dn">0</b> 人</div>
  <div id="personal">任务 <b id="tk">0</b>/4 · 申请单 <b id="ql">0</b> · 待领 <b id="qp">0</b> · 弹 <b id="bl">0</b> · 包 <b id="md">0</b></div>
  <div id="tasks"></div>
  <div id="dmgline" class="hide"></div>
  <div id="devline" class="hide">DEV <b>无敌 · 全知</b> · 断言 <b id="inv">0</b> 失败</div>
</div>
<div id="tip">点击地面移动 · W 交互（多项开轮盘） · A 出刀 · S 搜尸/查验 · D 收尸 · F 施救 · R 报告 · B 开枪 · H 破坏 · V 监控 · ESC 暂停/设置 · T 视野 · C 相机</div>
<div id="dragtag" class="hide">拖拽中 · 按 G 放下</div>
<div id="invfail" class="hide"></div>
<div id="dev" class="hide">
  <div class="dt">DEV · 全知总览</div>
  <div id="dev-rows"></div>
  <div class="dt2">F2 关闭 · 攻击与驱逐对你无效<br>尸体信息里会显示凶手</div>
</div>

<div id="body" class="ov hide"><div class="card">
  <h2 id="b-t">尸检记录</h2><div class="sub" id="b-s"></div>
  <div id="b-rows"></div>
  <div class="bd-note" id="b-note">搜查会花掉一点时间，夜里也一样。</div>
  <div class="btns"><button class="p" id="b-close">关闭 (X / Esc)</button></div>
</div></div>

<div id="pipe" class="ov hide"><div class="card pipe-card">
  <h2>地道 · 选择出口</h2><div class="sub" id="pipe-sub">异形专用 · 选择要去的那一端</div>
  <div class="pipe-list" id="pipe-list"></div>
  <div class="btns"><button id="pipe-cancel">取消 (Esc)</button></div>
</div></div>

<div id="sabot" class="ov hide"><div class="card pipe-card">
  <h2>破坏 · 选择目标舱室</h2><div class="sub" id="sabot-sub">每夜一次 · 抵达目标舱室后损毁设备 · 60 秒内未修复则维修进度 -3</div>
  <div class="pipe-list" id="sabot-list"></div>
  <div class="btns"><button id="sabot-cancel">取消 (Esc)</button></div>
</div></div>

<div id="wheel" class="ov hide"><div class="wheel-card">
  <div class="wheel-title">选择交互</div>
  <div id="wheel-opts"></div>
  <div class="wheel-sub">数字键 / 点击选择 · ESC 取消</div>
</div></div>

<div id="cam" class="ov hide"><div class="cam-panel">
  <div class="cam-head">
    <div><span class="cam-title">全船监控</span> <span class="cam-sub">CCTV · 9 路画面</span></div>
    <div class="cam-right"><span id="cam-state">● 信号正常</span><span id="cam-meta"></span></div>
  </div>
  <canvas id="camcv" width="1080" height="620"></canvas>
  <div class="cam-foot"><span>画面只显示在场人员与倒地者，不显示身份 · 配电室拉闸会切断全部信号</span>
    <button id="cam-close">关闭 (E / V / Esc)</button></div>
</div></div>

<div id="meet" class="ov hide"><div class="mtg">
  <div class="col say">
    <div class="ch">发言</div>
    <div id="m-say"></div>
    <div class="inp"><input id="m-text" placeholder="自由发言，回车发送"><button id="m-send">发送</button></div>
  </div>
  <div class="col mid">
    <h2 id="m-title">紧急会议</h2>
    <div class="sub" id="m-sub"></div>
    <div id="m-rows">
      <div class="row"><span>报告地点</span><b id="m-room">—</b></div>
      <div class="row"><span>发起报告</span><b id="m-by">—</b></div>
      <div class="row"><span id="m-vic-l">伤者</span><b id="m-vic">—</b></div>
    </div>
    <div class="row"><span>阶段</span><b id="m-ph">讨论</b></div>
    <div class="btns"><button id="m-skip">跳过讨论</button></div>
  </div>
  <div class="col vote">
    <div class="ch">投票</div>
    <div class="who" id="m-who"></div>
    <div id="m-tally"></div>
  </div>
</div></div>

<div id="end" class="ov hide"><div class="card">
  <h2 id="e-t">结束</h2><div class="sub" id="e-s"></div>
  <div class="btns"><button class="p" id="e-r">再来一局</button></div>
</div></div>

<div id="pause" class="ov hide"><div class="card">
  <h2>已暂停</h2><div class="sub">单机模式 · 夜里的倒计时和 AI 都已冻结</div>
  <div class="row"><span>继续游戏</span><b>ESC / P</b></div>
  <div class="row"><span>当前进度</span><b id="p-info">—</b></div>
  <div class="row"><span>版本</span><b data-version>返航录V2</b></div>
  <div class="btns">
    <button class="p" id="p-resume">继续</button>
    <button id="p-set">设置</button>
    <button id="p-restart">重开本局</button>
    <button id="p-exit">退出到开始页</button>
  </div>
</div></div>`;

  global.SKUITemplates = Object.freeze({ CSS: CSS, HTML: HTML });
})(typeof window !== 'undefined' ? window : globalThis);
