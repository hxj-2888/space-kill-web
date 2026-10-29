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

  const CSS = global.SKUITemplates.CSS;
  const HTML = global.SKUITemplates.HTML;

  const MAP = global.SKMapData;

  let booted = false;
  let shutdown = null;

  let ROLE_WANT = 'human';
  function start(role) {
    if (booted) return;
    ROLE_WANT = (role === 'alien') ? 'alien' : 'human';
    var pk=document.getElementById('pick'); if(pk) pk.style.display='none';
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
    if (global.SKConfig) {
      root.querySelectorAll('[data-version]').forEach(function (el) {
        el.textContent = global.SKConfig.version;
      });
    }
    document.body.appendChild(root);
    shutdown = boot();
  }

  function stop() {
    if (shutdown) { try { shutdown(); } catch (e) {} shutdown = null; }
    const r = document.getElementById('v3-root');
    if (r) r.remove();
    booted = false;
    const pk = document.getElementById('pick');
    if (pk) pk.style.display = '';
  }

  function boot() {
    'use strict';
    const M=MAP, NIGHT=120;
    const TEST=/[?&]test\b/.test(location.search);
    const DEV0=/[?&#]dev\b/.test(location.search+location.hash);
    const STRICT=/[?&]strict\b/.test(location.search);
    
    /* ---------------- 几何 / 寻路（js/engine/geo.js） ---------------- */
    const {
      CW, GS, GW, GH,
      inPoly, d2seg, inCorr, roomAt, free, nearestFree,
      pathClear, smoothPath, astar, idx, segX, los, losWalls,
    } = global.SKGeo;
    
    /* ---------------- 状态 ---------------- */
    /* 名字用老数据层的 15 个人名（SKData.NAMES 恒 15 项，长度参与 rng 序列，不要自己造） */
    /* 15 个人名（与旧数据层 SKData.NAMES 一致；新项目不引规则层，故在此内联） */
    const NAMES=['星尘','银翼','北极','磷火','铁砧','罗盘','苍鹭','玄武岩','游隼','回声','子夜','砂岩','灯塔','青霜','归零'];
    let G;
    function newGame(){
      const keepDev=G?!!G.dev:DEV0;
      clearInterval(meetingTick);
      stopChatter();
      document.getElementById('meet').classList.add('hide');
      const aliens=new Set();
      while(aliens.size<4) aliens.add(1+Math.floor(Math.random()*14));
      if(ROLE_WANT==='alien'){ const arr=[...aliens]; aliens.delete(arr[0]); aliens.add(0); }
      const pts=M.points.map((p,i)=>i);
      const hardPts=pts.filter(i=>M.points[i].kind==='hard');
      const normalPts=pts.filter(i=>M.points[i].kind==='normal');
      const agents=NAMES.map((n,i)=>({
        i,name:n,alien:aliens.has(i),x:0,y:0,path:null,sp:0,
        alive:true,downed:false,downAt:0,detained:false,detainedT:0,
        tasks:[hardPts[Math.floor(Math.random()*hardPts.length)]]
          .concat(shuffle(normalPts.slice()).slice(0,3)),
        tIdx:0,doing:0,progress:0,qual:0,bullet:0,medkit:0,
        knife:1,think:0,target:null,
        /* 幽灵 / 尸体 / 拖拽 / 搜查 */
        ghost:false,deathCause:null,deathAt:0,deathRoom:null,deathX:null,deathY:null,
        killedBy:null,bodyX:null,bodyY:null,bodyGone:false,bodyMoved:false,
        downX:null,downY:null,draggedBy:null,searched:false,
        /* 表现层：动作 / 工作计时 / 夜间见闻（会议发言要用真实事实） */
        act:null,_rest:0,_delay:2+Math.random()*6,_fxT:0,
        nRoom:null,nSeen:{},nTask:null,nTaskRoom:null,accuse:null,_lie:null,
        _reportT:0,_sawBody:null
      }));
      // 出生：15 人全部在中央会议室，异形混在人群里
      const br=M.rooms.find(r=>r.id==='bridge');
      for(const a of agents){
        const p=randIn(br); a.x=p[0]; a.y=p[1];
      }
      const me=agents[0];
      G={agents,me,night:1,t:NIGHT,prog:0,over:null,overWhy:'',meet:null,
         lit:{},blackout:false,vis:null,fogOn:true,camMode:'follow',fx:[],waves:[],clickFx:null,lightState:0,
         corrLit:true,paused:false,pauseAt:0,taskKey:'',camView:false,pipePick:null,powerFixed:false,
         secbotUsed:false,secbotDead:false,medbotUsed:false,medbotDead:false,medbotT:0,secbotT:0,
         drag:null,inspect:null,dev:keepDev,inv:{runs:0,checks:0,fails:[],warned:{},lastTag:''},invT:0,devT:0};
      G.aimX=me.x+1; G.aimY=me.y;
      refreshLight();
      document.getElementById('end').classList.add('hide');
      document.getElementById('body').classList.add('hide');
      document.getElementById('cam').classList.add('hide');
      document.getElementById('pipe').classList.add('hide');
      document.getElementById('dragtag').classList.add('hide');
      const pe=document.getElementById('pause'); if(pe)pe.classList.add('hide');
      syncDevUi();
      runInvariants('newGame');
      if(TEST){
        G.t=NIGHT;
        G.phase=SKClock.newPhase('night',performance.now(),NIGHT*1000);
      }else setTimeout(()=>openMeeting('pre',null,null),60);
    }
    function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
    function randIn(r){
      for(let k=0;k<200;k++){
        const p=r.poly[Math.floor(Math.random()*r.poly.length)];
        const x=r.rect[0]+Math.random()*r.rect[2],y=r.rect[1]+Math.random()*r.rect[3];
        if(free(x,y)&&inPoly(x,y,r.poly))return[x,y];
      }
      return nearestFree(r.rect[0]+r.rect[2]/2,r.rect[1]+r.rect[3]/2);
    }

    /* ---------------- 尸体 / 幽灵的公共查询 ---------------- */
    /* 濒死（还活着）用本人坐标；已死亡用固定的 bodyX/bodyY —— 幽灵可以飘走，
       尸体留在原地，所以这两套坐标必须分开。驱逐没有尸体。 */
    function bodyPos(a){
      if(!a)return null;
      if(a.alive)return a.downed?[a.x,a.y]:null;
      if(a.bodyGone||a.deathCause==='vote'||a.bodyX==null)return null;
      return[a.bodyX,a.bodyY];
    }
    function bodyPresent(a){ return !!bodyPos(a); }
    function nearestBody(maxD){
      let best=null,bd=maxD;
      for(const a of G.agents){
        if(a===G.me)continue;
        const bp=bodyPos(a); if(!bp)continue;
        const d=Math.hypot(bp[0]-G.me.x,bp[1]-G.me.y);
        if(d<bd){bd=d;best=a;}
      }
      return best;
    }
    function roomIdAt(x,y){
      const r=roomAt(x,y); if(r)return r.id;
      return inCorr(x,y)?'corridor':'unknown';
    }
    function roomNameById(id){
      if(id==='corridor')return '走廊';
      if(id==='unknown')return '船体未知区域';
      const r=M.rooms.find(q=>q.id===id); return r?r.name:'未知位置';
    }
    function roomNameAt(x,y){ return roomNameById(roomIdAt(x,y)); }
    function causeName(c){
      return {knife:'刀伤',shot:'枪伤',bled:'失血过多',vote:'被驱逐出舱'}[c]||'未知';
    }
    /* 断言用：站位判定给 0.75 格容差（路径终点、贴墙走位都不算违规） */
    function walkableNear(x,y){
      if(free(x,y))return true;
      for(const r of [0.3,0.55,0.8]){
        for(let i=0;i<8;i++){
          const t=i/8*Math.PI*2;
          if(free(x+Math.cos(t)*r,y+Math.sin(t)*r))return true;
        }
      }
      return false;
    }
    function nearPipeXY(x,y){
      for(const q of M.pipes) if(Math.hypot(q.x-x,q.y-y)<1.8)return true;
      return false;
    }

    /* ---------------- 断言层 / DEV ---------------- */
    /* 每秒 + 关键状态切换各跑一次；失败只报，不修状态（修状态会掩盖 bug）。
       ?strict 时直接抛错 —— 给 Playwright 门禁用。 */
    function runInvariants(tag){
      const inv=global.SKInvariants;
      if(!inv||!G)return null;
      let r;
      try{
        r=inv.check(G,{M:M,NIGHT:NIGHT,roomAt:roomAt,inCorr:inCorr,free:free,
          walkableNear:walkableNear,nearPipe:nearPipeXY,bodyPos:bodyPos});
      }catch(err){
        r={checks:0,fails:[{code:'EX',msg:String((err&&err.message)||err)}]};
      }
      G.inv.runs++; G.inv.checks+=r.checks; G.inv.lastTag=tag;
      const now=performance.now();
      for(const f of r.fails){
        const key=f.code+'|'+f.msg;
        if(now-(G.inv.warned[key]||0)>4000){
          G.inv.warned[key]=now;
          console.warn('[invariant]',tag,f.code,f.msg);
        }
      }
      G.inv.fails=r.fails.slice();
      const el=document.getElementById('inv');
      if(el)el.textContent=G.inv.fails.length;
      const box=document.getElementById('invfail');
      if(box){
        if(G.inv.fails.length){
          const f=G.inv.fails[0];
          box.textContent='断言失败 '+G.inv.fails.length+' · '+tag+' · '+f.code+' · '+f.msg;
          box.classList.remove('hide');
        }else box.classList.add('hide');
      }
      if(STRICT&&G.inv.fails.length){
        const f=G.inv.fails[0];
        throw new Error('SKInvariants['+tag+'] '+f.code+' '+f.msg);
      }
      return r;
    }

    function renderDevPanel(){
      const box=document.getElementById('dev-rows');
      if(!box||!G)return;
      const out=[];
      for(const a of G.agents){
        let st='待机';
        if(!a.alive) st=a.ghost?'幽灵':'出局';
        else if(a.downed) st='濒死';
        else if(a.detained) st='被擒';
        else if(a.doing>0) st='行动';
        else if(a.moving) st='移动';
        const bp=bodyPos(a);
        const where=bp?roomNameAt(bp[0],bp[1]):roomNameAt(a.x,a.y);
        out.push('<div class="dr'+(a.alien?' al':'')+(a===G.me?' me':'')+(!a.alive?' dead':'')+'">'
          +'<b>'+a.name+(a===G.me?'（你）':'')+'</b><span>'+(a.alien?'异形':'人类')+'</span>'
          +'<i>'+st+' · '+where
          +(a.alien?' · 刀 '+a.knife+(a.bullet?' · 弹':'')+'':'')
          +(a.detained?' · 被保安锁住':'')
          +(a.draggedBy!=null?' · 被拖':'')
          +'</i></div>');
      }
      box.innerHTML=out.join('');
    }
    function syncDevUi(){
      const on=!!(G&&G.dev);
      const dev=document.getElementById('dev');
      if(dev)dev.classList.toggle('hide',!on);
      const dl=document.getElementById('devline');
      if(dl)dl.classList.toggle('hide',!on);
      if(on)renderDevPanel();
    }
    function toggleDev(){
      if(!G)return;
      G.dev=!G.dev;
      syncDevUi();
      runInvariants('dev');
      toast(G.dev?'DEV：无敌 + 全知（F2 关闭）':'DEV：已关闭');
    }
    /* 三态灯：0 常态（引擎/配电暗）· 1 电路修好（全亮）· 2 拉闸（只有会议室亮） */
    function refreshLight(){
      const st=G.lightState|0;
      for(const r of M.rooms){
        if(st===2) G.lit[r.id]=(r.id==='bridge');
        else if(st===1) G.lit[r.id]=true;
        else G.lit[r.id]=(r.light==='bright');
      }
      /* 走廊灯：常态亮，拉闸后全熄（含桥接灯带） */
      G.corrLit=(st!==2);
      G.blackout=(st===2);
    }
    function pullBreaker(){
      G.lightState=(G.lightState===2?(G.powerFixed?1:0):2);
      refreshLight(); SND.breaker(); pulseHud('pwr');
      const br=M.facility.find(f=>f.kind==='breaker');
      if(br){
        G.fx.push({type:'power',x:br.x,y:br.y,t:1.0,dur:1.0,on:G.lightState!==2});
        hear(br.x,br.y,'power',1.1);
      }
      toast(G.lightState===2
        ?'电闸已拉下：全船变暗 · 走廊灯全熄 · 监控信号中断'
        :(G.powerFixed?'电闸已合上：配电已修复，全船照明恢复':'电闸已合上：房间与走廊灯光恢复'));
    }
    /* 单机暂停：冻结 update 与 SKClock（恢复时整体平移相位时间），会议/搜尸中不可暂停 */
    function togglePause(){
      if(!G||G.over||G.meet||G.inspect||G.camView||G.pipePick)return;
      const el=document.getElementById('pause');
      if(!G.paused){
        G.paused=true; G.pauseAt=performance.now(); G.pauseT=performance.now()/1000;
        const info=document.getElementById('p-info');
        if(info)info.textContent='第 '+G.night+' 夜 · 剩余 '+Math.max(0,Math.round(G.t))+' 秒 · 任务 '+G.me.tIdx+'/4';
        if(el)el.classList.remove('hide');
      }else{
        const d=performance.now()-(G.pauseAt||performance.now());
        if(G.phase){G.phase.startedAt+=d;G.phase.endsAt+=d;}
        G.paused=false;
        if(el)el.classList.add('hide');
      }
    }
    function restartGame(){
      G.paused=false;
      const el=document.getElementById('pause'); if(el)el.classList.add('hide');
      newGame();
    }
    function exitToMenu(){ stop(); }
    
    /* ---------------- 移动 ---------------- */
    function walkTo(a,x,y){ a.path=astar(a.x,a.y,x,y); }
    function stepMove(a,dt,sp){
      if(a.detained){a.moving=false;return true;}
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
      /* 围墙兜底：活人永远留在船体可行走面内；幽灵才允许穿墙 */
      if(!(a.ghost&&!a.alive)&&!free(a.x,a.y)){
        const f=nearestFree(a.x,a.y); a.x=f[0]; a.y=f[1];
      }
      /* 脚步：按实际走过的距离触发，近处才响 */
      const moved=sp*dt;
      a._stepAcc=(a._stepAcc||0)+moved;
      if(a._stepAcc>=0.78){
        a._stepAcc=0;
        const dme=Math.hypot(a.x-G.me.x,a.y-G.me.y);
        if(dme<9&&(a===G.me||visibleAt(a.x,a.y))) SND.step(a===G.me?0.5:Math.max(0.08,0.42*(1-dme/9)));
        /* 声纹：别人的脚步即使被墙挡住也能听见方向（近处才画） */
        if(a!==G.me&&dme<14) hear(a.x,a.y,'step',Math.max(0.18,0.7*(1-dme/14)));
      }
      return a.path.length===0;
    }
    
    /* ---------------- 交互 ---------------- */
    function nearPipe(a){
      let best=null,bd=1.6;
      for(const q of M.pipes){ const d=Math.hypot(q.x-a.x,q.y-a.y); if(d<bd){bd=d;best=q;} }
      return best;
    }
    function pipeOpts(from){ return M.pipes.map((q,i)=>({q,i})).filter(o=>o.q!==from); }
    function openPipePick(from){
      if(!G||G.meet||G.over||G.inspect||G.camView)return false;
      const me=G.me;
      if(!me.alive||me.downed||me.detained)return false;
      if(!me.alien){toast('管道口：你没有能力打开它');return false;}
      if(!from)from=nearPipe(me);
      if(!from){toast('要站在管道口才能钻地道');return false;}
      G.pipePick={from:M.pipes.indexOf(from)};
      me.path=null;me.doing=0;me._doing=null;
      const opts=pipeOpts(from), box=document.getElementById('pipe-list');
      box.innerHTML=opts.map((o,n)=>{
        const nm=roomNameById(o.q.room),d=Math.hypot(o.q.x-me.x,o.q.y-me.y);
        return '<button data-pipe="'+o.i+'"><span class="pn">'+(n+1)+'</span>'
          +'<span class="pr">'+nm+'</span><span class="pd">'+d.toFixed(0)+' 格</span></button>';
      }).join('');
      [...box.children].forEach(btn=>{btn.onclick=()=>pickPipe(+btn.dataset.pipe);});
      document.getElementById('pipe-sub').textContent=
        '当前：'+roomNameById(from.room)+' 管道口 · 数字键 1–'+opts.length+' 直接选择';
      document.getElementById('pipe').classList.remove('hide');
      SND.interact(); hear(from.x,from.y,'pipe',0.8);
      return true;
    }
    function closePipePick(silent){
      if(G)G.pipePick=null;
      const el=document.getElementById('pipe'); if(el)el.classList.add('hide');
      if(!silent)toast('已取消');
    }
    function pickPipe(i){
      const pp=G&&G.pipePick; if(!pp)return false;
      if(i===pp.from)return false;
      const to=M.pipes[i]; if(!to)return false;
      const me=G.me;
      if(!me.alien)return false;
      me.x=to.x;me.y=to.y;me.path=null;me.moving=false;me._stepAcc=0;
      G.pipePick=null;
      document.getElementById('pipe').classList.add('hide');
      G.fx.push({type:'pipefx',x:to.x,y:to.y,t:0.8,dur:0.8});
      SND.pipe(); hear(to.x,to.y,'pipe',1.1);
      toast('穿管道 → '+roomNameById(to.room));
      runInvariants('pipe');
      return true;
    }
    function camMonitor(){ return M.facility.find(f=>f.kind==='monitor'); }
    function nearMonitor(a){
      const m=camMonitor();
      return (m&&Math.hypot(m.x-a.x,m.y-a.y)<1.8)?m:null;
    }
    function inCamRoom(a){const r=roomAt(a.x,a.y);return !!(r&&r.id==='cam');}
    function openCams(){
      if(!G||G.over||G.meet||G.inspect||G.pipePick)return false;
      const me=G.me;
      if(!me.alive||me.downed||me.detained)return false;
      if(!inCamRoom(me)&&!nearMonitor(me)){toast('要走到监控室才能调取画面');return false;}
      me.path=null;me.doing=0;me._doing=null;
      G.camView=true;
      document.getElementById('cam').classList.remove('hide');
      const st=document.getElementById('cam-state');
      if(st){st.textContent=G.lightState===2?'● 信号中断 · 电闸断开':'● 9 路在线';st.classList.toggle('cut',G.lightState===2);}
      const meta=document.getElementById('cam-meta');
      if(meta)meta.textContent='第 '+G.night+' 夜 · 剩余 '+Math.max(0,G.t).toFixed(0)+'s';
      SND.interact();
      toast(G.lightState===2?'监控信号中断：先合上配电室的电闸':'监控台已接入 · E / V / ESC 退出');
      runInvariants('cams');
      return true;
    }
    function closeCams(silent){
      if(G)G.camView=false;
      const el=document.getElementById('cam');if(el)el.classList.add('hide');
      if(!silent)toast('已离开监控台');
    }
    function hear(x,y,kind,str){
      if(!G||G.over||G.meet||G.camView)return;
      if(!G.me||!G.me.alive)return;
      const d=Math.hypot(x-G.me.x,y-G.me.y);
      if(d>18)return;
      if(G.waves.length>52)G.waves.shift();
      G.waves.push({x,y,kind:kind||'step',t:0,dur:0.9+Math.min(0.5,d*0.02),
        str:Math.max(0.22,1-d/18)*(str==null?1:str)});
    }
    function nearPoint(a){
      let best=null,bd=2.6;
      for(const p of M.points){
        const d=Math.hypot(p.x-a.x,p.y-a.y);
        if(d<bd){bd=d;best=p;}
      }
      return best;
    }
    function myTasksLeft(a){ return a.tasks.filter((t,i)=>i>=a.tIdx); }
    
    /* 夜间见闻：只记录真的进过的房间和视距内看见的人。
       会议发言全部从这些事实里生成，才不会前言不搭后语。 */
    function trackNight(a){
      const rid=roomIdAt(a.x,a.y);
      if(rid!=='corridor'&&rid!=='unknown')a.nRoom=rid;
      if(!a.nSeen)a.nSeen={};
      for(const w of G.agents){
        if(w===a||!w.alive||w.downed)continue;
        if(Math.hypot(w.x-a.x,w.y-a.y)>5.5)continue;
        if(los(a.x,a.y,w.x,w.y)) a.nSeen[w.i]=(a.nSeen[w.i]||0)+1;
      }
    }

    /* ---------------- 主循环 ---------------- */
    let last=0, rafId=0, DEAD=false;
    function loop(ts){
      if(DEAD)return;
      const dt=Math.min(0.05,(ts-last)/1000||0); last=ts;
      if(!G.paused&&!G.over&&!G.meet&&!G.inspect) update(dt);
      draw(G.paused?0:dt);
      rafId=requestAnimationFrame(loop);
    }
    
    function update(dt){
      botTick(dt);
      /* 计时交给 SKClock：相位对象按墙钟走，会议/搜尸期间不调 update ⇒ 时间自然从夜里扣掉 */
      if(!G.phase) G.phase=SKClock.newPhase('night',performance.now(),NIGHT*1000);
      G.t=SKClock.remaining(G.phase,performance.now())/1000;
      const me=G.me;
      /* 被擒 / 倒下 / 死亡时立刻退出监控台与地道选择，避免卡在遮罩里 */
      if(G.camView&&(!me.alive||me.downed||me.detained))closeCams(true);
      if(G.pipePick&&(!me.alive||me.downed||me.detained))closePipePick(true);
      /* 保安机器人拘留倒计时：18 秒后自动释放 */
      for(const a of G.agents){
        if(!a.detained)continue;
        a.detainedT=(a.detainedT||0)-dt;
        a.moving=false; a.path=null;
        if(a.detainedT<=0){
          a.detained=false; a.detainedT=0;
          if(a===me)toast('保安机器人解锁：你被释放了');
          runInvariants('release');
        }
      }
      // 玩家：活人正常走；幽灵穿墙飘；濒死/被擒不能动
      if(me.alive&&!me.downed&&!me.detained){
        if(me.path) stepMove(me,dt,G.drag!=null?3.0:5);
        if(me.doing>0){
          me.doing-=dt;
          if(me.doing<=0) finishDoing(me);
        }
      }else if(!me.alive&&me.ghost){
        if(me.path) stepMove(me,dt,6.5);
        if(me.doing>0){
          me.doing-=dt;
          if(me.doing<=0) finishDoing(me);
        }
      }
      /* 拖拽声：低频摩擦，和脚步/出刀完全分开 */
      if(G.drag!=null&&me.moving&&me.alive&&!me.downed){
        G.dragSnd=(G.dragSnd||0)+dt;
        if(G.dragSnd>=0.72){
          G.dragSnd=0;
          SND.drag(0.55);
          hear(me.x,me.y,'drag',0.7);
        }
      }else G.dragSnd=0;
      syncDrag();
      // AI：死者变幽灵（只给幽灵/DEV 看，活人看不到就不必模拟）
      for(const a of G.agents){
        if(a===me)continue;
        if(!a.alive){ aiGhost(a,dt); continue; }
        if(a.downed||a.detained)continue;
        if(a.alien) aiAlien(a,dt); else { aiHuman(a,dt); aiScanBodies(a,dt); }
      }
      tickActs(dt);
      G.trackT=(G.trackT||0)+dt;
      if(G.trackT>=0.4){G.trackT=0;
        for(const a of G.agents) if(a.alive&&!a.downed) trackNight(a);}
      // 维修火花：所有正在修的人都冒，玩家/可见 AI 都有手感
      for(const a of G.agents){
        if(a.doing>0&&a._doing==='task'){
          a._fxT=(a._fxT||0)+dt;
          if(a._fxT>=0.34){a._fxT=0;
            G.fx.push({type:'workSpark',x:a.x,y:a.y,t:0.55,dur:0.55,ang:Math.random()*6.283});
            if(a===me&&Math.random()<0.5)SND.work();
          }
        }else a._fxT=0;
      }
      // 濒死计时：到天亮才死
      if(G.t<=0) dawn();
      checkWin();
      /* 监控台状态条：断电/恢复要在画面上立刻可见 */
      if(G.camView){
        G.camMetaT=(G.camMetaT||0)+dt;
        if(G.camMetaT>=0.25){
          G.camMetaT=0;
          const st=document.getElementById('cam-state');
          if(st){
            st.textContent=G.lightState===2?'● 信号中断 · 电闸断开':'● 9 路在线';
            st.classList.toggle('cut',G.lightState===2);
          }
          const meta=document.getElementById('cam-meta');
          if(meta)meta.textContent='第 '+G.night+' 夜 · 剩余 '+Math.max(0,G.t).toFixed(0)+'s';
        }
      }
      syncHud();
      G.invT+=dt;
      if(G.invT>=1){ G.invT=0; runInvariants('tick'); }
    }

    /* 幽灵 AI：无视墙体随机飘，纯气氛（活人看不到，所以活人视角不跑） */
    function aiGhost(a,dt){
      if(G.me.alive&&!G.dev){ a.moving=false; return; }
      if(!a.path||!a.path.length){
        if(Math.random()<dt*0.35){
          const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
          const p=randIn(r); a.path=[[p[0],p[1]]];
        }else a.moving=false;
      }
      if(a.path) stepMove(a,dt,2.4);
    }

    /* 拖拽：尸体跟在身后 0.62 格，玩家降速；被救活/放下/会议时自动松手 */
    function syncDrag(){
      if(G.drag==null)return;
      const me=G.me, b=G.agents[G.drag];
      if(!b||!bodyPos(b)||!me.alive||me.downed||G.meet||G.over){ releaseDrag(true); return; }
      const bp=bodyPos(b);
      const dx=bp[0]-me.x, dy=bp[1]-me.y, d=Math.hypot(dx,dy);
      const want=0.62;
      if(d>want){
        const f=nearestFree(me.x+dx/d*want,me.y+dy/d*want);
        if(b.alive){ b.x=f[0]; b.y=f[1]; }
        else { b.bodyX=f[0]; b.bodyY=f[1]; }
        if(!b.bodyMoved){
          const ox=b.alive?b.downX:b.deathX, oy=b.alive?b.downY:b.deathY;
          if(ox!=null&&Math.hypot(f[0]-ox,f[1]-oy)>1.2)b.bodyMoved=true;
        }
      }
    }
    function releaseDrag(silent){
      const b=G.drag!=null?G.agents[G.drag]:null;
      if(b)b.draggedBy=null;
      G.drag=null;
      const tag=document.getElementById('dragtag');
      if(tag)tag.classList.add('hide');
      if(!silent)toast('已放下尸体');
    }
    
    /* AI 目击尸体：靠近 + 有视线，犹豫 1.4–3s 后主动拉会议铃。
       以前只有玩家能报告，AI 永远不报，尸体报告形同虚设。 */
    function aiScanBodies(a,dt){
      if(G.noReport||a.alien||!a.alive||a.downed||a.detained)return;
      if(a._reportT>0){
        a._reportT-=dt;
        if(a._reportT<=0){
          const v=a._reportBody;
          if(v&&bodyPos(v)&&!G.meet&&!G.over){
            if(!(v.downed&&v.reported)){v.reported=true;openMeeting('night',a,v);}
          }
          a._reportBody=null;
        }
        return;
      }
      a._scanT=(a._scanT||0)+dt;
      if(a._scanT<0.5)return;
      a._scanT=0;
      let best=null,bd=5.4;
      for(const v of G.agents){
        if(v===a)continue;
        const bp=bodyPos(v); if(!bp)continue;
        if(v.downed&&v.reported)continue;
        const d=Math.hypot(bp[0]-a.x,bp[1]-a.y);
        if(d<bd&&los(a.x,a.y,bp[0],bp[1])){bd=d;best=v;}
      }
      if(best&&best!==a._sawBody){a._sawBody=best;a._reportT=1.4+Math.random()*1.6;a._reportBody=best;}
      else if(!best)a._sawBody=null;
    }

    /* AI 做任务比玩家慢一档；且和玩家一样，一夜只能修一个 */
    const AI_TASK_MULT=1.55;
    function aiHuman(a,dt){
      if(a.detained)return;
      if(a.doing>0){a.doing-=dt;if(a.doing<=0)finishDoing(a);return;}
      if(a._rest>0){a._rest-=dt;a.moving=false;return;}
      /* 开局先各自散开、错峰开工，避免所有人同一秒冲向任务点 */
      if(a._delay>0){
        a._delay-=dt;
        if(!a.path||!a.path.length){
          if(Math.random()<dt*0.45){
            const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
            const p=randIn(r); walkTo(a,p[0],p[1]);
          }else a.moving=false;
        }
        if(a.path&&a.path.length) stepMove(a,dt,3.2);
        return;
      }
      if(!a.path||!a.path.length){
        if(a.tIdx>=a.tasks.length){
          if(Math.random()<dt*0.25){
            const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
            const p=randIn(r); walkTo(a,p[0],p[1]);
          }else a.moving=false;
          return;
        }
        const p=M.points[a.tasks[a.tIdx]];
        if(Math.hypot(p.x-a.x,p.y-a.y)<2.8){
          a.doing=p.dur*AI_TASK_MULT; a._dur=a.doing; a._doing='task';
        }else walkTo(a,p.x,p.y);
        return;
      }
      stepMove(a,dt,4.0);
    }
    function aiAlien(a,dt){
      if(a.detained)return;
      /* 开局全员同舱：异形也必须遵守错峰延迟，否则一进夜就贴脸出刀 */
      if(a._delay>0){
        a._delay-=dt;
        if(!a.path||!a.path.length){
          if(Math.random()<dt*0.35){
            const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
            const p=randIn(r); walkTo(a,p[0],p[1]);
          }else a.moving=false;
        }
        if(a.path&&a.path.length) stepMove(a,dt,3.4);
        return;
      }
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
    
    /* ---- 动作表现（纯视觉，不改变判定）：出手/受击短动作 ---- */
    function setAct(a,kind,dur,extra){
      if(!a)return;
      a.act=Object.assign({kind,dur,t:0},extra||{});
    }
    function tickActs(dt){
      for(const a of G.agents){
        if(!a.act)continue;
        a.act.t+=dt;
        if(a.act.t>=a.act.dur)a.act=null;
      }
    }
    function actOffset(a){
      if(!a.act)return null;
      const p=Math.min(1,a.act.t/a.act.dur), k=Math.sin(Math.min(1,p/0.6)*Math.PI);
      if(a.act.kind==='stab')
        return {x:Math.cos(a.act.ang)*a.act.lunge*k*VIEW.s,y:Math.sin(a.act.ang)*a.act.lunge*k*VIEW.s};
      if(a.act.kind==='shoot')
        return {x:-Math.cos(a.act.ang)*0.16*k*VIEW.s,y:-Math.sin(a.act.ang)*0.16*k*VIEW.s};
      if(a.act.kind==='hurt')
        return {x:Math.cos(a.act.ang)*0.20*k*VIEW.s,y:Math.sin(a.act.ang)*0.20*k*VIEW.s};
      if(a.act.kind==='pickup') return {x:0,y:0.10*k*VIEW.s};
      if(a.act.kind==='heal') return {x:0,y:0.06*k*VIEW.s};
      return null;
    }

    function knife(killer,victim){
      if(!killer||killer.knife<1)return;
      if(!victim||!victim.alive||victim.downed)return;
      const ang=Math.atan2(victim.y-killer.y,victim.x-killer.x);
      if(victim===G.me&&G.dev){
        setAct(killer,'stab',0.4,{ang,lunge:0.4});
        G.fx.push({type:'shield',x:victim.x,y:victim.y,t:0.6,dur:0.6});
        if(killer&&killer!==G.me){killer.target=null;killer.path=null;}
        toast('DEV 无敌：这一刀没有生效');
        return;
      }
      killer.knife--;
      G.pendingCrime=killer.i;
      /* 只响一次：单层刀风，不再叠 70ms 后的血肉声 */
      SND.knife(Math.max(0.18,Math.min(1,1.25-Math.hypot(victim.x-G.me.x,victim.y-G.me.y)/16)));
      hear(victim.x,victim.y,'knife',1.0);
      setAct(killer,'stab',0.5,{ang,lunge:0.55});
      setAct(victim,'hurt',0.6,{ang});
      G.fx.push({type:'slash',x:victim.x,y:victim.y,t:0.5,dur:0.5,ang,by:killer.i});
      G.fx.push({type:'blood',x:victim.x,y:victim.y,t:0.9,dur:0.9,ang});
      for(const w of G.agents){
        if(w.alien||!w.alive||w.downed||w===victim)continue;
        if(Math.hypot(w.x-killer.x,w.y-killer.y)<6&&los(w.x,w.y,killer.x,killer.y)) w.suspect=killer.i;
      }
      victim.downed=true; victim.downAt=G.t;
      victim.downX=victim.x; victim.downY=victim.y; victim.killedBy=killer.i;
      victim.path=null; victim.doing=0; victim._doing=null; victim._sv=null;
      if(victim===G.me){closeCams(true);closePipePick(true);toast('你被出刀击倒，濒死');}
    }

    /* 真正的死亡：尸体坐标与幽灵坐标分离 —— 幽灵可以飘走，尸体留在现场。
       驱逐没有尸体（bodyGone），刀伤/枪伤/失血都留尸。 */
    function die(a,cause,by){
      if(!a||!a.alive)return false;
      if(a===G.me&&G.dev){toast('DEV 无敌：死亡被拦截');return false;}
      a.alive=false; a.ghost=true;
      a.deathCause=cause||'knife';
      a.deathAt=G.t;
      a.deathRoom=roomIdAt(a.x,a.y);
      a.deathX=a.x; a.deathY=a.y;
      a.killedBy=(by==null?null:by);
      a.bodyGone=(cause==='vote');
      a.bodyX=a.bodyGone?null:a.x;
      a.bodyY=a.bodyGone?null:a.y;
      a.bodyMoved=false;
      a.downed=false; a.detained=false;
      a.path=null; a.doing=0; a._doing=null;
      if(G.drag===a.i) releaseDrag(true);
      if(a===G.me){
        G.drag=null;
        document.getElementById('dragtag').classList.add('hide');
        closeBodyCard();
        closeCams(true);closePipePick(true);
        G.fogOn=false;
        toast('你已阵亡 · 幽灵态：穿墙、全视，仍可维修（1.6×）');
        SND.ghost();
        syncHud();
      }
      runInvariants('die');
      return true;
    }
    
    function finishDoing(a){
      const actor=a===G.me;
      if(a._doing==='search'){
        const b=a._sv!=null?G.agents[a._sv]:null;
        a._doing=null; a._sv=null;
        G.fx.push({type:'search',x:a.x,y:a.y,t:0.5,dur:0.5});
        if(actor&&b)openBodyCard(b);
        return;
      }
      if(a._doing==='med'){
        a.medkit=1;a._doing=null;a.qual=Math.max(0,a.qual-1);
        G.fx.push({type:'pickup',x:a.x,y:a.y,t:1.2,dur:1.2,item:'med'});
        setAct(a,'pickup',0.55,{});
        if(actor){toast('拿到医疗包 · 资格 -1');pulseHud('md');pulseHud('ql');SND.med();}
        return;
      }
      if(a._doing==='ammo'){
        a.bullet=1;a._doing=null;a.qual=Math.max(0,a.qual-1);
        G.fx.push({type:'pickup',x:a.x,y:a.y,t:1.2,dur:1.2,item:'ammo'});
        setAct(a,'pickup',0.55,{});
        if(actor){toast('拿到子弹 · 资格 -1');pulseHud('bl');pulseHud('ql');SND.ammo();}
        return;
      }
      if(a._doing==='breaker'){
        a._doing=null;
        const br=M.facility.find(f=>f.kind==='breaker');
        if(br)G.fx.push({type:'power',x:br.x,y:br.y,t:1.0,dur:1.0,on:G.lightState!==2});
        if(actor)pullBreaker();
        return;
      }
      if(a._doing==='revive'){
        const v=a._rv;
        if(v&&v.downed&&v.alive){
          v.downed=false;v.downAt=0;v.killedBy=null;a.medkit=0;
          G.fx.push({type:'heal',x:v.x,y:v.y,t:1.2,dur:1.2});
          setAct(v,'heal',0.7,{ang:0});
          if(actor){toast('救起 '+v.name);SND.revive();}
        }
        a._rv=null;a._doing=null;return;
      }
      const p=M.points[a.tasks[a.tIdx]];
      if(!p){a._doing=null;return;}
      const v=p.kind==='hard'?2:1;
      const q0=a.qual;
      G.prog=Math.min(40,G.prog+v);
      a.tIdx++; a.progress+=v; a._doing=null;
      a.nTask=p.label; a.nTaskRoom=roomIdAt(a.x,a.y);
      G.fx.push({type:'done',x:a.x,y:a.y,t:1.0,dur:1.0});
      G.fx.push({type:'spark',x:p.x,y:p.y,t:0.8,dur:0.8});
      if(a.progress>=3&&a.qual<1)a.qual=1;
      if(a.progress>=5&&a.qual<2)a.qual=2;
      /* 修好配电室的高难任务 ⇒ 全船照明恢复（拉闸仍可再次断电） */
      let powerFix=false;
      if(p.room==='power'&&p.kind==='hard'&&!G.powerFixed){
        G.powerFixed=true; powerFix=true;
        if(G.lightState!==2){G.lightState=1;refreshLight();}
        const br=M.facility.find(f=>f.kind==='breaker');
        if(br)G.fx.push({type:'power',x:br.x,y:br.y,t:1.2,dur:1.2,on:true});
        hear(p.x,p.y,'power',0.9);
      }
      /* 领取资格：维修积分到 3/5 时弹出资格徽章，HUD 同步跳一下 */
      if(a.qual>q0){
        G.fx.push({type:'qual',x:a.x,y:a.y,t:1.5,dur:1.5,n:a.qual});
        if(actor){pulseHud('ql');SND.qual();toast('维修积分 '+a.progress+'：补给资格升到 '+a.qual+' 级');}
      }
      if(actor){
        SND.done();
        toast('完成「'+p.label+'」 +'+v+' 分'+(powerFix?' · 全船照明恢复':''));
        if(powerFix)pulseHud('pwr');
      }
      if(a!==G.me) a._rest=12+Math.random()*10;
    }
    
    function dawn(){
      for(const a of G.agents) if(a.downed&&a.alive) die(a,'bled',a.killedBy);
      G.t=0;
      if(checkWin())return;
      openMeeting('day',null,null);
    }
    
    /* ---- 两台机器人 ---- */
    /* 拘留位：军械库角落（保安机器人把凶手拽过去，18 秒后自动解锁） */
    function secJail(){
      const sec=M.facility.find(f=>f.kind==='secbot');
      if(!sec)return null;
      /* 拘留位放在保安位东南侧的空地：不被弹药箱挡视线，玩家能看到被擒者 */
      return nearestFree(sec.x+1.7,sec.y+1.3);
    }
    function botTick(dt){
      if(G.meet||G.over)return;
      const med=M.facility.find(f=>f.kind==='medbot');
      const sec=M.facility.find(f=>f.kind==='secbot');
      if(G.secbotT>0)G.secbotT=Math.max(0,G.secbotT-dt);
      // 医疗机器人：每夜救 1 个「倒在医疗间里」的濒死者（拖进来也算）
      if(med&&!G.medbotUsed&&!G.medbotDead){
        const v=G.agents.find(a=>a.downed&&a.alive&&
          Math.hypot(a.x-med.x,a.y-med.y)<7&&roomAt(a.x,a.y)&&roomAt(a.x,a.y).id==='med');
        if(v){
          G.medbotT=(G.medbotT||0)+dt;
          if(G.medbotT>=3){
            v.downed=false; v.downAt=0; v.killedBy=null; v.draggedBy=null;
            if(G.drag===v.i)releaseDrag(true);
            G.medbotUsed=true;
            G.fx.push({type:'healBeam',x1:med.x,y1:med.y,x2:v.x,y2:v.y,t:1.1,dur:1.1});
            G.fx.push({type:'heal',x:v.x,y:v.y,t:1.2,dur:1.2});
            setAct(v,'heal',0.7,{ang:0});
            hear(med.x,med.y,'robot',1.1);
            SND.revive(); SND.robot();
            toast('医疗机器人救起了 '+v.name);
            runInvariants('medbot');
          }
        }else G.medbotT=0;
      }
      // 保安机器人：视野内发生行凶 ⇒ 拽进军械库角落拘留 18 秒（每夜 1 次）
      if(sec&&!G.secbotUsed&&!G.secbotDead&&G.pendingCrime){
        const c=G.pendingCrime; G.pendingCrime=null;
        const killer=G.agents[c];
        if(killer&&Math.hypot(killer.x-sec.x,killer.y-sec.y)<6&&losWalls(sec.x,sec.y,killer.x,killer.y)){
          if(killer===G.me&&G.dev){ toast('DEV：保安机器人没有看见你'); }
          else{
            const jail=secJail()||[sec.x,sec.y+1.6];
            const fx0=killer.x, fy0=killer.y;
            G.secbotUsed=true; G.secbotT=1.6;
            if(G.drag===killer.i)releaseDrag(true);
            killer.detained=true; killer.detainedT=18;
            killer.path=null; killer.moving=false; killer.doing=0; killer._doing=null;
            killer.act=null;
            killer.x=jail[0]; killer.y=jail[1];
            G.fx.push({type:'detain',x1:fx0,y1:fy0,x2:jail[0],y2:jail[1],t:1.3,dur:1.3});
            G.fx.push({type:'alarm',x:sec.x,y:sec.y,t:1.4,dur:1.4});
            hear(sec.x,sec.y,'robot',1.25);
            SND.alarm(); SND.robot();
            toast(tagName(killer)+' 被保安机器人擒拿：锁在军械库角落 18 秒');
            if(killer===G.me){closeCams(true);closePipePick(true);toast('你被保安机器人擒拿：18 秒后自动释放');}
            runInvariants('secbot');
          }
        }
      }
    }

    function checkWin(){
      if(G.over)return true;
      const humans=G.agents.filter(a=>!a.alien&&a.alive).length;
      const aliens=G.agents.filter(a=>a.alien&&a.alive).length;
      if(G.prog>=40){ endGame(true,'维修 40 分达成'); return true; }
      if(aliens===0){ endGame(true,'异形全部出局'); return true; }
      if(humans===0){ endGame(false,'人类全灭'); return true; }
      return false;
    }
    function endGame(win,why){
      if(G.over)return;
      G.over=true; G.overWhy=why;
      stopChatter();
      releaseDrag(true);
      closeBodyCard();
      closeCams(true);closePipePick(true);
      if(G.meet){ clearInterval(meetingTick); G.meet=null; document.getElementById('meet').classList.add('hide'); }
      document.getElementById('end').classList.remove('hide');
      document.getElementById('e-t').textContent=win?'人类胜利':'异形胜利';
      document.getElementById('e-s').textContent=why+' · 维修 '+G.prog+'/40 · 第 '+G.night+' 夜';
      runInvariants('end');
    }
    
    /* ---------------- 报告 / 会议 / 投票 ---------------- */
    let meetingTick=null;
    function tryReport(){
      if(!G.me.alive||G.me.downed||G.meet||G.over)return;
      let best=null,bd=2.4;
      for(const a of G.agents){
        const bp=bodyPos(a); if(!bp)continue;
        if(a.reported)continue;
        const d=Math.hypot(bp[0]-G.me.x,bp[1]-G.me.y);
        if(d<bd){bd=d;best=a;}
      }
      if(!best){toast('再靠近一点才能报告（2.4 格内）');return;}
      best.reported=true;
      SND.report();
      openMeeting('night',G.me,best);
    }
    /* ---------------- 会议发言：本地上下文叙事引擎 ----------------
       没有接外部 LLM（当前工具里没有可用的模型接口）。这里不随机抽台词，
       而是把每个 AI 真实去过的房间 / 修过的任务 / 看见过的人 / 目击的凶手
       拿来组句；质疑与回应引用上一条发言，投票沿用发言里的指控。 */
    const MEET={id:0,timers:[]};
    function stopChatter(){
      MEET.id++;
      for(const h of MEET.timers)clearTimeout(h);
      MEET.timers=[];
    }
    function meetLater(m,ms,fn){
      const id=MEET.id;
      const h=setTimeout(()=>{
        MEET.timers=MEET.timers.filter(x=>x!==h);
        if(G.meet!==m||MEET.id!==id||m.phase!=='discuss')return;
        try{fn();}catch(e){}
      },ms);
      MEET.timers.push(h);
    }
    function say(who,text,kind){
      const box=document.getElementById('m-say'); if(!box)return;
      const raw=String(text).slice(0,140);
      const d=document.createElement('div');
      d.className='ln'+(kind===true||kind==='me'?' me':'')+(kind==='sys'?' sys':'');
      const b=document.createElement('b'); b.textContent=tagByName(who);
      d.appendChild(b); d.appendChild(document.createTextNode(raw));
      box.appendChild(d); box.scrollTop=box.scrollHeight;
      if(G.meet){G.meet.lines=G.meet.lines||[];G.meet.lines.push({who,text:raw,sys:kind==='sys'});}
    }
    function seatNo(a){return String(((a&&a.i)||0)+1).padStart(2,'0');}
    function tagName(a){return a?(seatNo(a)+' '+a.name):'—';}
    function tagByName(who){
      const a=G.agents.find(x=>x.name===who);
      return a?tagName(a):who;
    }
    function sysSay(t){ say('系统',t,'sys'); }
    function nameOf(i){const a=G.agents[i];return a?a.name:'—';}
    function seenNames(a,opt){
      const out=[];
      for(const k in (a.nSeen||{})){
        const w=G.agents[+k];
        if(!w||w===a)continue;
        if((a.nSeen[k]||0)<3)continue;
        if(opt&&opt.aliveOnly&&(!w.alive||w.downed))continue;
        out.push(w);
      }
      return out;
    }
    function alibiOf(a){
      if(a.alien&&a._lie)return {room:a._lie.room,task:a._lie.task,witnesses:[],lie:true,nextTask:null};
      const seen=seenNames(a,{aliveOnly:true});
      const rid=a.nRoom||roomIdAt(a.x,a.y);
      const p=M.points[a.tasks[a.tIdx]];
      return {room:roomNameById(rid),task:a.nTask||null,witnesses:seen,
        nextTask:p?p.label:null,nextRoom:p?roomNameById(roomIdAt(p.x,p.y)):null};
    }
    function victimInfo(victim){
      if(!victim)return null;
      const bp=bodyPos(victim);
      const x=bp?bp[0]:(victim.deathX!=null?victim.deathX:victim.x);
      const y=bp?bp[1]:(victim.deathY!=null?victim.deathY:victim.y);
      const rid=victim.deathRoom||roomIdAt(x,y);
      return {a:victim,name:victim.name,roomId:rid,room:roomNameById(rid),
        dead:!victim.alive,
        cause:victim.alive?'重伤':(victim.deathCause==='shot'?'枪伤':victim.deathCause==='bled'?'失血':'刀伤')};
    }
    function buildMeetCtx(kind,reporter,victim){
      const vi=victimInfo(victim);
      const ctx={kind,reporter,victim,victimInfo:vi,claims:[]};
      const used=new Set(vi?[vi.roomId]:[]);
      for(const a of G.agents){
        a.accuse=null;
        if(a.alien&&a.alive&&!a.downed){
          // 异形：整场会议只用一个假口供，避免前后矛盾
          const rooms=M.rooms.filter(r=>!used.has(r.id)&&r.id!=='bridge');
          const r=rooms.length?rooms[Math.floor(Math.random()*rooms.length)]:M.rooms[0];
          used.add(r.id);
          const pts=M.points.filter(p=>roomIdAt(p.x,p.y)===r.id);
          a._lie={room:r.name,task:pts.length?pts[Math.floor(Math.random()*pts.length)].label:'配电盘'};
          const pool=G.agents.filter(x=>!x.alien&&x.alive&&!x.downed);
          a.accuse=pool.length?pool[Math.floor(Math.random()*pool.length)].i:null;
        }else if(a.suspect!=null){
          const s=G.agents[a.suspect];
          if(s&&s!==a&&s.alive&&!s.downed)a.accuse=a.suspect;
        }
      }
      return ctx;
    }
    function openingLine(a,m){
      const vi=m.ctx.victimInfo;
      if(!vi)return m.kind==='day'
        ?'天亮了，昨晚有人动手但没留下尸体。各自把昨晚的位置说清楚。'
        :'没有尸体，但我不想把今晚糊弄过去。各自说一下自己在哪。';
      if(vi.dead)return '我在'+vi.room+'发现了'+vi.name+'，'+vi.cause+'，人已经没了。谁在那一带？';
      return '我在'+vi.room+'发现'+vi.name+'倒在地上，还有呼吸，'+vi.cause+'。先救人，但动手的人就在我们中间。';
    }
    function alibiLine(a,m){
      const f=alibiOf(a),vi=m.ctx.victimInfo;
      if(m.kind==='pre'){
        return '我从'+f.room+'那边开始'+(f.task?('，先修'+f.task):'')+'。';
      }
      let line='我今晚在'+f.room;
      if(f.task)line+='，把'+f.task+'搞定了';
      else if(f.nextTask)line+='，接下来要去'+f.nextRoom+'修'+f.nextTask;
      else line+='，在找任务点';
      if(f.witnesses.length)line+='，路上碰到'+f.witnesses[0].name;
      line+='。';
      const sawVictim=vi?seenNames(a).find(w=>w===vi.a):null;
      if(sawVictim)line+=' '+vi.name+'从我那边经过，当时还没事。';
      else if(!a.alien&&a.accuse!=null&&a.suspect!=null&&vi){
        line+=' 我看见'+nameOf(a.accuse)+'对'+vi.name+'动了手。';
      }
      return line;
    }
    function pickChallenge(claims,cands){
      for(const s of claims){
        const c=cands.find(x=>x!==s.a&&alibiOf(x).room===s.room&&!seenNames(x).includes(s.a));
        if(c)return {c,s,kind:'doubt'};
      }
      for(const s of claims){
        const c=cands.find(x=>x!==s.a&&seenNames(x).includes(s.a));
        if(c)return {c,s,kind:'support'};
      }
      const s=claims[claims.length-1];
      if(!s)return null;
      const c=cands.find(x=>x!==s.a);
      return c?{c,s,kind:'ask'}:null;
    }
    function challengeText(ch){
      if(ch.kind==='doubt')
        return ch.s.a.name+'，你说你在'+ch.s.room+'？我整晚也在'+ch.s.room+'，没看见你。';
      if(ch.kind==='support')
        return '我可以给'+ch.s.a.name+'作证，我确实在'+ch.s.room+'看见过他。';
      return ch.s.a.name+'，你那边还有谁？一个人待一晚上，没人能作证吧。';
    }
    function respondText(ch,m){
      const s=ch.s;
      if(ch.kind==='support')return '对，'+ch.c.name+'当时就在旁边。';
      const vi=m.ctx.victimInfo;
      if(s.a.alien)
        return '我走的是后舱通道，没碰上人很正常。'+(vi?('我更想知道谁最后见过'+vi.name+'。'):'');
      const f=alibiOf(s.a);
      if(f.witnesses.length)return f.witnesses[0].name+'能作证，我们当时在'+f.room+'碰上过。';
      return '我一个人在'+f.room+'，没人看见也正常；但我没去过'+(vi?vi.room:'那片区域')+'。';
    }
    function accuseLine(a){
      if(a.accuse==null)return null;
      const t=G.agents[a.accuse];
      if(!t||!t.alive||t.downed)return null;
      if(a.alien)return '我倾向'+t.name+'。今晚他的位置最说不清。';
      if(a.suspect!=null)return '我投'+t.name+'。我亲眼看见他动手，不是猜的。';
      return '我跟一票'+t.name+'，他的说法和我看到的对不上。';
    }
    function pickResponder(m,cands){
      const spoken=(m.lines||[]).map(l=>l.who);
      const fresh=cands.filter(a=>spoken.indexOf(a.name)<0);
      const pool=fresh.length?fresh:cands;
      return pool[Math.floor(Math.random()*pool.length)];
    }
    function startChatter(m){
      stopChatter();
      const ai=G.agents.filter(a=>a.alive&&!a.downed&&a!==G.me);
      if(!ai.length)return;
      const cands=ai.slice().sort(()=>Math.random()-0.5);
      let t=520;
      if(m.kind==='pre'){
        meetLater(m,t,()=>sysSay('第 1 天 · 公开讨论：先认识彼此，讨论完直接进入第 1 夜。'));
        t+=1200;
        for(const a of cands.slice(0,3)){
          meetLater(m,t,()=>say(a.name,alibiLine(a,m)));
          t+=1250;
        }
        const asker=cands[3]||cands[0];
        if(G.me.alive)meetLater(m,t,()=>say(asker.name,'你呢，'+G.me.name+'？准备先修哪片？'));
        t+=1200;
        meetLater(m,t,()=>sysSay('讨论结束，进入第 1 夜。'));
        return;
      }
      const vi=m.ctx.victimInfo;
      if(m.reporter&&m.reporter!==G.me&&m.reporter.alive&&!m.reporter.downed){
        meetLater(m,t,()=>say(m.reporter.name,openingLine(m.reporter,m)));
      }else if(vi){
        meetLater(m,t,()=>say(G.me.name,'我在'+vi.room+'发现'+vi.name+'，'+vi.cause+(vi.dead?'，人已经没了。':'，还有呼吸。'),true));
      }else{
        meetLater(m,t,()=>sysSay(m.kind==='day'?'天亮了，全员到会议室。':'没有尸体，但有人按下了会议铃。'));
      }
      t+=1450;
      const speakers=cands.slice(0,3);
      for(const a of speakers){
        m.ctx.claims.push({a,room:alibiOf(a).room});
        meetLater(m,t,()=>say(a.name,alibiLine(a,m)));
        t+=1300;
      }
      const asker=cands[3]||cands[0];
      if(G.me.alive&&!G.me.downed){
        meetLater(m,t,()=>say(asker.name,'你呢，'+G.me.name+'？今晚在哪，看到谁了？'));
        t+=1250;
      }
      const ch=pickChallenge(m.ctx.claims,cands);
      if(ch){
        meetLater(m,t,()=>say(ch.c.name,challengeText(ch)));
        t+=1300;
        meetLater(m,t,()=>say(ch.s.a.name,respondText(ch,m)));
        t+=1400;
      }
      const accusers=cands.filter(a=>a.accuse!=null&&G.agents[a.accuse]&&G.agents[a.accuse].alive&&a.accuse!==a.i).slice(0,2);
      for(const a of accusers){
        meetLater(m,t,()=>{const l=accuseLine(a);if(l)say(a.name,l);});
        t+=1250;
      }
      // 有人跟票：把指控同步进投票，做到「说的」和「投的」一致
      let supporter=null;
      if(accusers.length){
        const a0=accusers[0],tgt=G.agents[a0.accuse];
        const pool=cands.filter(x=>x!==a0&&x!==tgt&&!x.alien&&x.suspect==null&&x.accuse==null);
        if(pool.length&&Math.random()<0.6){
          supporter=pool[Math.floor(Math.random()*pool.length)];
          supporter.accuse=tgt.i;
          meetLater(m,t,()=>say(supporter.name,'我跟'+a0.name+'一票，'+tgt.name+'得给个说法。'));
          t+=1200;
        }
      }
      const closer=cands[cands.length-1];
      meetLater(m,t,()=>{
        const target=closer.accuse!=null?G.agents[closer.accuse]:null;
        if(target&&target.alive){
          say(closer.name,'我先把票压在'+target.name+'身上。'+(vi?vi.name+'的事不能就这么算了。':''));
        }else if(vi){
          say(closer.name,'我信息不够，先不投。'+(G.me.alive&&!G.me.downed?('你呢，'+G.me.name+'？'):''));
        }else{
          say(closer.name,'没有尸体就别乱投，今晚把任务修起来。');
        }
      });
    }
    /* 玩家发言 → 按意图回答，并引用真实位置/任务/指控 */
    function playerTalk(text){
      const m=G.meet;
      if(!m||m.phase!=='discuss')return;
      const cands=G.agents.filter(a=>a.alive&&!a.downed&&a!==G.me);
      if(!cands.length)return;
      const a=pickResponder(m,cands);
      meetLater(m,700+Math.random()*900,()=>{
        const f=alibiOf(a),vi=m.ctx.victimInfo;
        let line;
        if(/你.*(可疑|凶手|刀|杀|开枪)|怀疑你|是不是你/.test(text)){
          line=(a.alien?'我要是异形，就不会站在这里让你点名。':'我没动过手。')+
            '我今晚在'+f.room+(f.task?('，把'+f.task+'搞定了'):'')+'，'+
            (f.witnesses[0]?f.witnesses[0].name+'能作证。':'没人作证，但我没去过'+(vi?vi.room:'那片区域')+'。');
        }else if(/在哪|哪里|位置|哪边/.test(text)){
          line='我在'+f.room+(f.task?('，把'+f.task+'搞定了'):'')+'。'+
            (f.witnesses[0]?('路上碰到'+f.witnesses[0].name+'。'):'');
        }else if(/谁|怀疑|投|凶手/.test(text)){
          if(a.accuse!=null)line='我怀疑'+nameOf(a.accuse)+'。'+(a.suspect!=null?'我亲眼看见的。':'他的说法对不上。');
          else line='我还没定。'+(vi?('我更在意'+vi.name+'倒下的那会儿，谁在'+vi.room+'。'):'你先说说你看到了什么。');
        }else if(/任务|修|进度/.test(text)){
          line='我修了'+a.tIdx+'个，还剩'+Math.max(0,4-a.tIdx)+'个。'+
            (a.doing>0?'正在赶下一个。':'刚跑完一段路。');
        }else if(/看见|看到|发现/.test(text)){
          const seen=seenNames(a,{aliveOnly:true});
          line=seen.length?('我看见'+seen[0].name+'在'+f.room+'附近。'):'我这一路没碰上人。';
        }else{
          line='「'+String(text).slice(0,20)+'」我记下了。'+
            (vi?('现在最要紧的是'+vi.name+'那条线，谁最后见过他？'):'你继续说，我听着。');
        }
        say(a.name,line);
      });
    }

    function openMeeting(kind,reporter,victim){
      if(G.over)return;
      releaseDrag(true);
      closeBodyCard();
      closeCams(true);closePipePick(true);
      const vp=victim?bodyPos(victim):null;
      const vx=vp?vp[0]:(victim?victim.x:0), vy=vp?vp[1]:(victim?victim.y:0);
      const r=victim?roomAt(vx,vy):null;
      const roomName=victim?(r?r.name:(inCorr(vx,vy)?'走廊':(vp||victim?'未知位置':'—'))):'—';
      /* 先按现场事实建上下文（尸体清场前算，保留死亡坐标），再清场 */
      const ctx=buildMeetCtx(kind,reporter,victim);
      // 尸体在会议开始时就清场（与经典规则一致）；濒死者还活着，继续躺着
      for(const a of G.agents) if(!a.alive&&!a.bodyGone) a.bodyGone=true;
      const discuss=(kind==='day'||kind==='pre')?60:25;
      const voteT=kind==='pre'?0:(kind==='day'?10:5);
      const remainMs=(kind==='night'&&G.phase)?SKClock.remaining(G.phase,performance.now()):NIGHT*1000;
      G.meet={kind,reporter,victim,room:roomName,phase:'discuss',t:discuss,
              discuss,voteT,votes:{},tally:null,remainMs:remainMs,startAt:performance.now(),
              ctx,lines:[]};
      document.getElementById('meet').classList.remove('hide');
      document.getElementById('m-title').textContent=
        kind==='pre'?'第 1 天 · 开局公开讨论':(kind==='day'?('第 '+G.night+' 天 · 全员会议'):'紧急会议');
      document.getElementById('m-sub').textContent=
        kind==='pre'?('公开讨论 '+discuss+' 秒 · 本轮不投票 · 讨论完直接进入第 1 夜')
        :('讨论 '+discuss+' 秒 + 投票 '+voteT+' 秒'+(kind==='day'?'':'（从夜晚时间里扣）'));
      document.getElementById('m-rows').style.display=victim?'':'none';
      document.getElementById('m-room').textContent=roomName;
      document.getElementById('m-by').textContent=reporter?tagName(reporter):'—';
      document.getElementById('m-vic').textContent=victim?tagName(victim):'—';
      const vl=document.getElementById('m-vic-l');
      if(vl)vl.textContent=victim?(victim.alive?'濒死者':'死者'):'伤者';
      document.getElementById('m-ph').textContent='讨论';
      const canAct=G.me.alive&&!G.me.downed;
      document.getElementById('m-skip').classList.toggle('hide',!canAct);
      const inp=document.getElementById('m-text');
      inp.disabled=!canAct; inp.placeholder=canAct?'自由发言，回车发送':'幽灵只能旁观';
      document.getElementById('m-who').innerHTML='';
      document.getElementById('m-tally').innerHTML='';
      document.getElementById('m-say').innerHTML='';
      if(!canAct) say(G.me.name,'（幽灵）我在看着。','sys');
      startChatter(G.meet);
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
      stopChatter();
      document.getElementById('m-skip').classList.add('hide');
      const box=document.getElementById('m-who'); box.innerHTML='';
      if(!G.me.downed&&G.me.alive){
        for(const a of G.agents){
          if(!a.alive||a===G.me)continue;
          const btn=document.createElement('button');
          btn.textContent=tagName(a);
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
      // AI 投票：优先沿用会议里说出口的指控，再退回到亲眼所见
      for(const a of G.agents){
        if(!a.alive||a===G.me||a.downed)continue;
        const acc=(a.accuse!=null&&G.agents[a.accuse]&&G.agents[a.accuse].alive&&a.accuse!==a.i)?a.accuse:null;
        if(acc!=null){ m.votes[a.i]=acc; continue; }
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
      const cand=ok?G.agents[top]:null;
      let devSaved=false;
      if(cand){
        if(cand===G.me&&G.dev) devSaved=true;
        else{ die(cand,'vote',null); SND.expel(); }
      }
      m.tally={tally,abstain,max,ok,ex:devSaved?null:cand,devSaved,
        exName:cand?tagName(cand):null,exRole:cand?(cand.alien?'异形':'人类'):null};
      renderTally();
      if(cand)sysSay('驱逐 '+tagName(cand)+' · 身份公布：'+(cand.alien?'异形':'人类'));
      runInvariants('vote');
    }
    function renderTally(){
      const m=G.meet, box=document.getElementById('m-tally');
      const {tally,abstain,max,ex,devSaved,exName,exRole}=m.tally;
      const rows=Object.keys(tally).map(k=>({n:tagName(G.agents[k]),c:tally[k]})).sort((a,b)=>b.c-a.c);
      let h='<div class="tl-h">投票结果（过程不可见）</div>';
      for(const r of rows) h+='<div class="tl"><span>'+r.n+'</span><b>'+r.c+' 票</b></div>';
      h+='<div class="tl"><span>弃权</span><b>'+abstain+' 票</b></div>';
      h+='<div class="tl-note">'+(devSaved
          ?('票数指向你 —— DEV 无敌：驱逐无效（'+max+' 票）')
          :(ex
            ?('驱逐 '+(exName||ex.name)+' —— '+max+' 票，唯一最高票且达到 3 票门槛'
              +'<br><span class="ex-role '+(ex.alien?'ali':'hum')+'">身份：'+(exRole||(ex.alien?'异形':'人类'))+'</span>')
            :(max<3?('最高票 '+max+' 票，未达 3 票门槛 ⇒ 无人出局')
                    :('最高票 '+max+' 票但有平票 ⇒ 无人出局'))))+'</div>';
      box.innerHTML=h;
      document.getElementById('m-who').innerHTML='';
    }
    function finishMeeting(){
      const m=G.meet; clearInterval(meetingTick);
      stopChatter();
      const kind=m&&m.kind;
      let nightLeft=null;
      if(m&&kind==='night'&&m.remainMs!=null){
        nightLeft=Math.max(8000,m.remainMs-(performance.now()-(m.startAt||performance.now())));
      }
      G.meet=null;
      document.getElementById('meet').classList.add('hide');
      checkWin(); if(G.over)return;
      if(kind==='day') startNight(true);
      else if(kind==='pre') startNight(false);
      else if(nightLeft!=null){
        G.phase=SKClock.newPhase('night',performance.now(),nightLeft);
      }
      runInvariants('meetingEnd');
    }
    function startNight(inc){
      if(inc!==false) G.night++;
      G.t=NIGHT;
      G.phase=SKClock.newPhase('night',performance.now(),NIGHT*1000);
      for(const a of G.agents){
        a.knife=1;a.path=null;a.doing=0;a.target=null;a.reported=false;
        a._doing=null;a.sabUsed=false;a.detained=false;a.detainedT=0;
        /* 节奏控制：错峰开工 + 修完歇一会儿；异形更早开始活动，但不会开局贴脸 */
        a.act=null;a._rest=0;a._delay=a.alien?4+Math.random()*14:8+Math.random()*58;a._fxT=0;
        a.nRoom=roomIdAt(a.x,a.y);a.nSeen={};a.nTask=null;a.nTaskRoom=null;
        a.accuse=null;a._lie=null;
      }
      G.trackT=0;G.medbotUsed=false;G.medbotT=0;G.secbotUsed=false;G.secbotT=0;G.pendingCrime=null;
      G.medbotDead=false;G.secbotDead=false;G.powerFixed=false;
      G.lightState=0;G.waves=[];G.fx=[];
      closeCams(true);closePipePick(true);
      refreshLight();
      toast('第 '+G.night+' 夜开始');
      runInvariants('night');
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
    addEventListener('resize',()=>{if(DEAD||!G)return;resize();PAT={};});
    const SX=x=>x*VIEW.s+VIEW.ox, SY=y=>y*VIEW.s+VIEW.oy;
    const WX=x=>(x-VIEW.ox)/VIEW.s, WY=y=>(y-VIEW.oy)/VIEW.s;
    
    cv.addEventListener('click',e=>{
      if(DEAD||!G||G.paused||G.over||G.meet||G.inspect||G.camView||G.pipePick)return;
      const me=G.me;
      if(!me.alive&&!me.ghost)return;
      if(me.downed)return;
      if(me.detained)return;
      const tx=WX(e.clientX),ty=WY(e.clientY);
      if(!me.alive){ // 幽灵：直线穿墙
        me.path=[[tx,ty]];
      }else{
        const p=astar(me.x,me.y,tx,ty);
        if(p){me.path=p;}
      }
      G.clickFx={x:tx,y:ty,t:0.55};
    });
    addEventListener('keydown',e=>{
      if(DEAD||!G)return;
      const k=e.key.toLowerCase();
      if(k==='f2'){e.preventDefault();toggleDev();return;}
      if(k==='escape'){
        if(G.inspect){closeBodyCard();return;}
        if(G.pipePick){closePipePick();return;}
        if(G.camView){closeCams();return;}
        if(G.meet||G.over)return;
        togglePause();return;
      }
      /* 地道选择：数字键直达，其余按键屏蔽（避免误触移动/攻击） */
      if(G.pipePick){
        if(k==='m'){SND.setOn(!SND.isOn());toast(SND.isOn()?'音效：开':'音效：关');return;}
        if(/^[1-9]$/.test(k)){
          const opts=pipeOpts(M.pipes[G.pipePick.from]);
          const o=opts[+k-1];
          if(o)pickPipe(o.i);
        }
        return;
      }
      /* 监控台：只允许 E / V / ESC / 静音，其它输入全部吞掉 */
      if(G.camView){
        if(k==='m'){SND.setOn(!SND.isOn());toast(SND.isOn()?'音效：开':'音效：关');return;}
        if(k==='e'||k==='v'){closeCams();return;}
        return;
      }
      if(k==='p'){if(!G.meet&&!G.over&&!G.inspect)togglePause();return;}
      if(G.paused)return;
      if(k==='r'){tryReport();return;}
      if(k==='m'){SND.setOn(!SND.isOn());toast(SND.isOn()?'音效：开':'音效：关');return;}
      if(k==='e'){if(G.inspect)closeBodyCard();else interact();return;}
      if(k==='f'){(G.me.alien? sabotage(): rescue());return;}
      if(k==='v'){(G.camView?closeCams():openCams());return;}
      if(k==='q'){attack();return;}
      if(k==='x'){e.preventDefault();if(G.inspect)closeBodyCard();else searchBody();return;}
      if(k==='g'){e.preventDefault();toggleDrag();return;}
      if(k==='t'){G.fogOn=!G.fogOn;toast(G.fogOn?'视野：手电筒':'视野：全亮（审计用）');return;}
      if(k==='c'){G.camMode=(G.camMode==='map'?'follow':'map');resize();
        toast(G.camMode==='map'?'相机：全图':'相机：跟随（近景）');return;}
    });
    
    function interact(){
      const me=G.me; if(!me.alive&&!me.ghost)return;
      if(me.doing>0)return;
      const ghost=!me.alive;
      if(ghost){ // 幽灵只能维修自己的任务点，耗时 1.6×
        const gp=nearPoint(me);
        if(gp&&me.tasks.slice(me.tIdx).includes(M.points.indexOf(gp))){
          me.doing=gp.dur*1.6; me._dur=me.doing; me._doing='task';
          toast('幽灵维修「'+gp.label+'」 '+me.doing.toFixed(1)+'s');
        }else toast('幽灵只能维修任务点');
        return;
      }
      if(me.downed||me.detained)return;
      // 管道：只有异形能用；按 E 打开目的地选择（不再随机传送）
      const pipe=nearPipe(me);
      if(pipe){
        if(!me.alien){ toast('管道口：你没有能力打开它'); return; }
        openPipePick(pipe); return;
      }
      // 电闸：任何人 3 秒
      const br=M.facility.find(f=>f.kind==='breaker'&&Math.hypot(f.x-me.x,f.y-me.y)<1.6);
      if(br){ me.doing=3; me._dur=3; me._doing='breaker'; SND.interact(); toast('拉闸 3s'); return; }
      /* 监控台与自己的任务点都在手边时，按距离近的那个走 —— 否则站在监控室任务点上永远开不了监控 */
      const mon=nearMonitor(me);
      const p=nearPoint(me);
      const mine=p&&me.tasks.slice(me.tIdx).includes(M.points.indexOf(p));
      if(mon&&(!mine||Math.hypot(mon.x-me.x,mon.y-me.y)<=Math.hypot(p.x-me.x,p.y-me.y))){
        openCams(); return;
      }
      if(mine){
        me.doing=p.dur; me._dur=p.dur; me._doing='task';
        toast('开始维修「'+p.label+'」 '+p.dur+'s'); return;
      }
      // 两台机器人不能手动操作，但靠近能读到状态
      const bot=M.facility.find(f=>(f.kind==='medbot'||f.kind==='secbot')&&Math.hypot(f.x-me.x,f.y-me.y)<1.7);
      if(bot){
        if(bot.kind==='secbot')toast(G.secbotDead?'保安机器人：今晚已停摆':(G.secbotUsed?'保安机器人：本夜已经擒拿过一次':'保安机器人：在线 · 视野内行凶会被拘留 18s'));
        else toast(G.medbotDead?'医疗机器人：今晚已停摆':(G.medbotUsed?'医疗机器人：本夜已经救过一次':'医疗机器人：在线 · 把濒死者拖进医疗间会自动施救'));
        return;
      }
      const r=roomAt(me.x,me.y);
      if(r&&r.id==='med'&&me.qual>0&&me.medkit<1){ me.doing=6; me._dur=6; me._doing='med'; toast('取医疗包 6s'); return; }
      if(r&&r.id==='armory'&&me.qual>0&&me.bullet<1){ me.doing=10; me._dur=10; me._doing='ammo'; toast('取子弹 10s'); return; }
      toast('这里没有你能做的事');
    }
    function sabotage(){
      const me=G.me;
      if(!me.alive||me.downed){ toast('幽灵无法破坏'); return; }
      if(!me.alien){ toast('你做不到'); return; }
      if(me.sabUsed){ toast('今晚已经破坏过了'); return; }
      /* 贴着机器人按 F：让这台机器今晚停摆（医疗/保安各一次机会） */
      const rb=M.facility.find(f=>(f.kind==='medbot'||f.kind==='secbot')&&Math.hypot(f.x-me.x,f.y-me.y)<1.8);
      if(rb){
        me.sabUsed=true;
        if(rb.kind==='secbot')G.secbotDead=true; else G.medbotDead=true;
        G.fx.push({type:'spark',x:rb.x,y:rb.y,t:1.4,dur:1.4});
        hear(rb.x,rb.y,'power',0.9);
        SND.sabotage();
        toast(rb.kind==='secbot'?'破坏成功：保安机器人今晚停摆':'破坏成功：医疗机器人今晚停摆');
        runInvariants('sabotageBot');
        return;
      }
      const p=nearPoint(me);
      if(!p){ toast('要站在任务点上才能破坏'); return; }
      me.sabUsed=true;
      G.prog=Math.max(0,G.prog-2);
      G.fx.push({type:'spark',x:p.x,y:p.y,t:1.2});
      hear(p.x,p.y,'power',0.8);
      SND.sabotage();
      toast('破坏成功：进度 -2（电流闪烁，全房可见）');
    }

    function rescue(){
      const me=G.me; if(!me.alive||me.downed)return;
      if(me.medkit<1){toast('没有医疗包');return;}
      let best=null,bd=1.8;
      for(const a of G.agents) if(a.downed&&a.alive){
        const d=Math.hypot(a.x-me.x,a.y-me.y); if(d<bd){bd=d;best=a;}}
      if(!best){toast('附近没有濒死者');return;}
      if(G.drag===best.i)releaseDrag(true);
      best.draggedBy=null;
      me.doing=5; me._dur=5; me._doing='revive'; me._rv=best; toast('施救中 5s');
    }
    function attack(){
      const me=G.me;
      if(G.over||G.meet||G.inspect)return;
      if(!me.alive){toast('幽灵无法攻击');return;}
      if(me.downed||me.detained)return;
      if(me.alien) stab(); else shoot();
    }
    function stab(){
      const me=G.me;
      if(me.knife<1){toast('今晚的刀已经用掉了');return;}
      let best=null,bd=1.35;
      for(const a of G.agents){
        if(a===me||a.alien||!a.alive||a.downed)continue;
        const d=Math.hypot(a.x-me.x,a.y-me.y);
        if(d<bd&&los(me.x,me.y,a.x,a.y)){bd=d;best=a;}
      }
      if(!best){toast('近身没有目标（1.3 格内、无遮挡）');return;}
      knife(me,best);
      toast('出刀：'+best.name+' 濒死');
    }
    function shoot(){
      const me=G.me;
      if(!me.alive||me.downed||me.detained)return;
      if(me.bullet<1){toast('没有子弹');return;}
      let best=null,bd=1e9;
      for(const a of G.agents){
        if(a===me||!a.alive||a.downed)continue;
        const d=Math.hypot(a.x-me.x,a.y-me.y);
        if(d<9&&los(me.x,me.y,a.x,a.y)&&d<bd){bd=d;best=a;}
      }
      if(!best){toast('视野内没有目标');return;}
      me.bullet--;
      G.pendingCrime=me.i;
      const ang=Math.atan2(best.y-me.y,best.x-me.x);
      setAct(me,'shoot',0.55,{ang});
      setAct(best,'hurt',0.55,{ang});
      G.fx.push({type:'tracer',x1:me.x,y1:me.y,x2:best.x,y2:best.y,t:0.45,dur:0.45,ang});
      G.fx.push({type:'muzzle',x:me.x+Math.cos(ang)*0.55,y:me.y+Math.sin(ang)*0.55,t:0.2,dur:0.2,ang});
      G.fx.push({type:'impact',x:best.x,y:best.y,t:0.55,dur:0.55});
      G.fx.push({type:'blood',x:best.x,y:best.y,t:0.9,dur:0.9,ang});
      SND.shot();
      hear(me.x,me.y,'shot',1.15);
      best.downed=true; best.downAt=G.t; best.path=null; best.doing=0;
      best._doing=null; best._sv=null;
      best.downX=best.x; best.downY=best.y; best.killedBy=me.i;
      for(const w of G.agents){
        if(w.alien||!w.alive||w.downed||w===best||w===me)continue;
        if(Math.hypot(w.x-me.x,w.y-me.y)<7&&los(w.x,w.y,me.x,me.y)) w.suspect=me.i;
      }
      if(best===G.me) toast('你被击中，濒死');
      else toast('开枪击中 '+best.name);
    }

    /* ---------------- 搜尸 / 拖拽 ---------------- */
    function bodyNear(maxD){
      const me=G.me;
      let best=null,bd=maxD;
      for(const a of G.agents){
        if(a===me)continue;
        const bp=bodyPos(a); if(!bp)continue;
        const d=Math.hypot(bp[0]-me.x,bp[1]-me.y);
        if(d<bd){bd=d;best=a;}
      }
      return best;
    }
    function searchBody(){
      const me=G.me;
      if(G.over||G.meet||G.inspect)return;
      if(!me.alive){toast('幽灵无法触碰尸体');return;}
      if(me.downed||me.detained){toast('你现在动不了');return;}
      if(me.doing>0)return;
      const b=bodyNear(2.2);
      if(!b){toast('附近没有尸体或伤者');return;}
      me.doing=1.2; me._dur=1.2; me._doing='search'; me._sv=b.i;
      SND.search();
      toast('检查中…');
    }
    function openBodyCard(b){
      const bp=bodyPos(b);
      G.inspect={agent:b};
      document.getElementById('b-t').textContent=(b.alive?'伤情记录 · ':'尸检记录 · ')+b.name;
      document.getElementById('b-s').textContent=bp?roomNameAt(bp[0],bp[1]):'船体未知区域';
      let h='';
      const row=(k,v,bad)=>h+='<div class="row"><span>'+k+'</span><b'+(bad?' class="bd-bad"':'')+'>'+v+'</b></div>';
      if(b.alive){
        row('状态','濒死 · 还有呼吸，拖进医疗间可由机器人救活');
        row('发现地点',bp?roomNameAt(bp[0],bp[1]):'—');
        row('伤口','刀伤/枪伤，仍在渗血');
        row('时间',b.downAt!=null?('夜间剩余约 '+Math.max(0,Math.round(b.downAt))+'s 时倒下'):'—');
        row('凶手',G.dev&&b.killedBy!=null?G.agents[b.killedBy].name:'无法判断');
      }else{
        row('状态','已死亡');
        row('死因',causeName(b.deathCause));
        row('死亡地点',roomNameById(b.deathRoom));
        row('死亡时间','第 '+G.night+' 夜 · 倒计时约 '+Math.max(0,Math.round(b.deathAt||0))+'s');
        row('尸体',b.bodyMoved?'被移动过 · 现场被布置':'未被移动',b.bodyMoved);
        row('凶手',G.dev&&b.killedBy!=null?G.agents[b.killedBy].name:'无法判断');
      }
      document.getElementById('b-rows').innerHTML=h;
      document.getElementById('body').classList.remove('hide');
      runInvariants('inspect');
    }
    function closeBodyCard(){
      const el=document.getElementById('body');
      if(el)el.classList.add('hide');
      if(G)G.inspect=null;
    }
    function toggleDrag(){
      const me=G.me;
      if(G.over||G.meet||G.inspect)return;
      if(!me.alive){toast('幽灵无法拖拽');return;}
      if(me.downed||me.detained){toast('你现在动不了');return;}
      if(G.drag!=null){ releaseDrag(); return; }
      const b=bodyNear(2.2);
      if(!b){toast('附近没有尸体或伤者');return;}
      if(b.draggedBy!=null){toast('已经有人在拖这具身体');return;}
      G.drag=b.i; b.draggedBy=me.i;
      document.getElementById('dragtag').classList.remove('hide');
      SND.drag(0.7); hear(me.x,me.y,'drag',0.8);
      toast('拖拽 '+b.name+' · 移动变慢，再按 G 放下');
      runInvariants('drag');
    }
    
    function toast(s){ G.msg=s; G.msgT=2.6; }
    function pulseHud(id){
      const el=document.getElementById(id);
      if(!el)return;
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
      setTimeout(()=>el.classList.remove('pop'),800);
    }
    
    /* ---------------- 音效（CC0 采样优先，WebAudio 合成兜底） ---------------- */
    const SND=(function(){
      let ac=null, on=true, master=1;
      /* file:// 下不能 fetch 音频，用 <audio> 元素池播放；每种音效 2~3 条并发。 */
      const FILE={
        knife:['audio/sfx-knife-01.ogg','audio/sfx-knife-02.ogg'],
        gun:['audio/sfx-gun.ogg'],
        step:['audio/sfx-step-01.ogg','audio/sfx-step-02.ogg'],
        metal:['audio/sfx-metal.ogg'],
        door:['audio/sfx-door.ogg'],
        report:['audio/sfx-notify.ogg']
      };
      const POOL={}; let rr=0;
      /* 播放日志：Playwright 用它验证「一次出刀只响一次」 */
      const LOG=[]; let LOGN=0;
      function note(n){LOG.push(n);LOGN++;if(LOG.length>120)LOG.shift();}
      function prep(name){
        if(POOL[name])return POOL[name];
        const pool=[];
        for(const src of FILE[name]){
          for(let i=0;i<2;i++){
            const a=new Audio(src);
            a.preload='auto';
            a.__src=src;
            pool.push(a);
          }
        }
        return POOL[name]=pool;
      }
      function play(name,vol,rate){
        if(!on)return true;
        if(!FILE[name])return false;
        const pool=prep(name);
        let a=pool.find(x=>x.paused||x.ended);
        if(!a){a=pool[rr++%pool.length];try{a.pause();}catch(e){}}
        try{
          a.currentTime=0;
          a.volume=Math.max(0,Math.min(1,(vol==null?1:vol)*master));
          a.playbackRate=Math.max(0.5,Math.min(1.8,rate||1));
          const p=a.play();
          if(p&&p.catch)p.catch(()=>{});
        }catch(e){}
        return true;
      }
      function C(){ if(!ac){ try{ ac=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ ac=null; } } return ac; }
      function beep(f0,f1,dur,type,vol){
        if(!on)return; const c=C(); if(!c)return;
        const o=c.createOscillator(), g=c.createGain();
        o.type=type||'sine'; o.frequency.setValueAtTime(f0,c.currentTime);
        if(f1) o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),c.currentTime+dur);
        g.gain.setValueAtTime(vol||0.10,c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0008,c.currentTime+dur);
        o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+dur+0.02);
      }
      function noise(dur,vol,hp){
        if(!on)return; const c=C(); if(!c)return;
        const n=Math.floor(c.sampleRate*dur), b=c.createBuffer(1,n,c.sampleRate), d=b.getChannelData(0);
        for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
        const src=c.createBufferSource(); src.buffer=b;
        const g=c.createGain(); g.gain.setValueAtTime(vol||0.2,c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0008,c.currentTime+dur);
        let node=src;
        if(hp){ const f=c.createBiquadFilter(); f.type='highpass'; f.frequency.value=hp; src.connect(f); node=f; }
        node.connect(g); g.connect(c.destination); src.start();
      }
      /* 低通噪声：拖拽/机械摩擦专用，和脚步的高频沙沙明确分开 */
      function noiseLp(dur,vol,cut){
        if(!on)return; const c=C(); if(!c)return;
        const n=Math.floor(c.sampleRate*dur), b=c.createBuffer(1,n,c.sampleRate), d=b.getChannelData(0);
        let last=0;
        for(let i=0;i<n;i++){
          last=last*0.82+(Math.random()*2-1)*0.18;
          d[i]=last*(1-i/n);
        }
        const src=c.createBufferSource(); src.buffer=b;
        const f=c.createBiquadFilter(); f.type='lowpass'; f.frequency.value=cut||260;
        const g=c.createGain(); g.gain.setValueAtTime(vol||0.2,c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0008,c.currentTime+dur);
        src.connect(f); f.connect(g); g.connect(c.destination); src.start();
      }
      /* 开局即预载采样，避免第一次出刀/开枪时还在读盘 */
      for(const k in FILE) prep(k);
      return {
        setOn:function(v){
          on=!!v;
          if(!on)for(const k in POOL)for(const a of POOL[k]){try{a.pause();}catch(e){}}
        },
        isOn:function(){return on;},
        setMaster:function(v){master=Math.max(0,Math.min(1,+v||0));},
        debug:function(){
          const out={};
          for(const k in POOL) out[k]=POOL[k].map(a=>({src:a.__src,ready:a.readyState,err:a.error?a.error.code:0}));
          return out;
        },
        log:function(){return LOG.slice();},
        logCount:function(){return LOGN;},
        clearLog:function(){LOG.length=0;},
        knife:function(vol){
          note('knife');
          /* 只响一次、音量压低 22%：不再叠 70ms 后的血肉层，避免「一刀两声」 */
          const v=Math.max(0.12,Math.min(0.72,(vol==null?0.6:vol)*0.78));
          if(!play('knife',v,0.92+Math.random()*0.10)){
            noise(0.09,0.08,1200); beep(300,140,0.14,'triangle',0.06);
          }
        },
        shot:function(vol){
          note('shot');
          if(!play('gun',vol==null?1:vol,0.97+Math.random()*0.06)){ noise(0.10,0.34,300); beep(900,120,0.16,'square',0.18); }
        },
        step:function(vol){
          note('step');
          if(!play('step',(vol==null?0.4:vol)*0.62,1.02+Math.random()*0.12)) beep(150,120,0.05,'sine',0.04);
        },
        interact:function(){ if(!play('door',0.5,1)) beep(520,700,0.07,'triangle',0.07); },
        done:function(){ beep(660,990,0.15,'triangle',0.09); },
        qual:function(){ beep(520,1040,0.32,'sine',0.10); beep(780,1560,0.22,'sine',0.05); },
        work:function(){ noise(0.05,0.03,1600); },
        med:function(){ beep(420,760,0.20,'sine',0.10); },
        ammo:function(){ beep(300,240,0.13,'square',0.09); },
        revive:function(){ beep(380,900,0.30,'sine',0.10); },
        report:function(){ note('report'); if(!play('report',0.75,1)){ beep(880,440,0.28,'triangle',0.13); } },
        vote:function(){ if(!play('door',0.35,1.25)) beep(600,600,0.07,'square',0.07); },
        expel:function(){ note('expel'); if(!play('door',0.8,0.72)) beep(300,80,0.50,'sawtooth',0.13); },
        breaker:function(){ note('breaker'); noise(0.18,0.26,200); beep(95,55,0.28,'square',0.11); play('metal',0.85,0.9); },
        sabotage:function(){ note('sabotage'); noise(0.30,0.20,600); beep(180,1500,0.28,'sawtooth',0.09); play('metal',0.6,0.78); },
        pipe:function(){ note('pipe'); beep(210,760,0.24,'sine',0.11); },
        robot:function(){ note('robot'); beep(240,180,0.12,'square',0.08); play('metal',0.55,1.04); noise(0.10,0.10,1200); },
        alarm:function(){ note('alarm'); beep(780,780,0.10,'square',0.09); },
        search:function(){ noise(0.16,0.06,1800); beep(520,640,0.10,'triangle',0.05); },
        ghost:function(){ beep(880,220,0.55,'sine',0.09); beep(440,110,0.70,'sine',0.05); },
        drag:function(vol){
          note('drag');
          /* 低频摩擦 + 极轻的机械吱声：和脚步（高频沙沙）、出刀（刀风）三套材质 */
          const v=vol==null?0.5:vol;
          noiseLp(0.28,v*0.20,300);
          beep(72,58,0.22,'sine',0.028*v);
        }
      };
    })();

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
    loadImg('base','v4/base-lit.png');
    loadImg('hull','v4/hull-deck.png');
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
    /* 2.5D 底图：Blender 正交俯视（12° 倾角）渲出的整船，含地面/墙面/家具。
       贴图没加载完时退回老 cozy 平铺，保证首帧不空。 */
    function drawLegacyMap(){
      for(const c of M.corridors){
        ctx.strokeStyle='#1A2029';ctx.lineWidth=CW*VIEW.s;ctx.lineCap='butt';ctx.lineJoin='round';
        ctx.beginPath();c.pts.forEach((p,i)=>i?ctx.lineTo(SX(p[0]),SY(p[1])):ctx.moveTo(SX(p[0]),SY(p[1])));ctx.stroke();
        ctx.strokeStyle='#2A323E';ctx.lineWidth=1;
        ctx.beginPath();c.pts.forEach((p,i)=>i?ctx.lineTo(SX(p[0]),SY(p[1])):ctx.moveTo(SX(p[0]),SY(p[1])));ctx.stroke();
      }
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
    }
    /* 每条走廊两盏顶灯，配电室拉闸后整条走廊全熄 */
    function corridorLampPos(c){
      let total=0; const segs=[];
      for(let i=0;i<c.pts.length-1;i++){
        const a=c.pts[i],b=c.pts[i+1],L=Math.hypot(b[0]-a[0],b[1]-a[1]);
        segs.push({a,b,L,s:total,ang:Math.atan2(b[1]-a[1],b[0]-a[0])}); total+=L;
      }
      const at=(f)=>{
        const d=total*f;
        for(const s of segs) if(d<=s.s+s.L||s===segs[segs.length-1]){
          const k=s.L?Math.min(1,Math.max(0,(d-s.s)/s.L)):0;
          return [s.a[0]+(s.b[0]-s.a[0])*k,s.a[1]+(s.b[1]-s.a[1])*k,s.ang];
        }
        return [c.pts[0][0],c.pts[0][1],0];
      };
      return [at(0.28),at(0.72)];
    }
    function drawCorridorLights(T){
      if(!G)return;
      for(const c of M.corridors){
        for(const p of corridorLampPos(c)){
          const x=SX(p[0]),y=SY(p[1]);
          if(G.corrLit){
            const rad=ctx.createRadialGradient(x,y,0,x,y,2.35*VIEW.s);
            rad.addColorStop(0,'rgba(140,235,250,.20)');
            rad.addColorStop(0.45,'rgba(110,205,240,.09)');
            rad.addColorStop(1,'rgba(90,180,230,0)');
            ctx.fillStyle=rad;
            ctx.beginPath();ctx.ellipse(x,y,2.35*VIEW.s,1.25*VIEW.s,0,0,7);ctx.fill();
          }
          ctx.save();ctx.translate(x,y);ctx.rotate(p[2]);
          ctx.fillStyle=G.corrLit?'rgba(196,246,255,.92)':'rgba(54,61,70,.95)';
          ctx.fillRect(-0.34*VIEW.s,-0.085*VIEW.s,0.68*VIEW.s,0.17*VIEW.s);
          if(G.corrLit){
            ctx.fillStyle='rgba(255,255,255,'+(0.55+0.25*Math.sin(T*3+p[0])).toFixed(2)+')';
            ctx.fillRect(-0.26*VIEW.s,-0.045*VIEW.s,0.52*VIEW.s,0.09*VIEW.s);
          }
          ctx.restore();
        }
      }
    }
    /* 设施：电闸 / 监控台 / 医疗机器人 / 保安机器人 / 拘留区 */
    function drawFacilities(T){
      const s=VIEW.s;
      for(const f of M.facility){
        const x=SX(f.x),y=SY(f.y);
        if(f.kind==='breaker'){
          const off=G.lightState===2;
          ctx.save();ctx.translate(x,y);
          ctx.fillStyle='rgba(10,14,20,.94)';
          ctx.strokeStyle=off?'#7FD3F0':'#3C4B5D';ctx.lineWidth=1.5;
          ctx.beginPath();ctx.roundRect(-0.5*s,-0.55*s,1.0*s,1.1*s,3);ctx.fill();ctx.stroke();
          ctx.fillStyle=off?'#7FD3F0':'#7FE3B4';
          ctx.beginPath();ctx.arc(-0.28*s,-0.38*s,0.065*s,0,7);ctx.fill();
          ctx.strokeStyle=off?'#FF6B61':'#7FE3B4';ctx.lineWidth=2.2;ctx.lineCap='round';
          ctx.beginPath();ctx.moveTo(0.06*s,0.04*s);
          ctx.lineTo(0.06*s+(off?-0.24:0.22)*s, off?-0.30*s:0.18*s);ctx.stroke();
          ctx.fillStyle='rgba(205,216,230,.75)';
          ctx.beginPath();ctx.arc(0.06*s,0.04*s,0.06*s,0,7);ctx.fill();
          drawIcon('bolt',off?'#7FD3F0':'#F0C674',0.0,0.36*s,0.4*s,0);
          ctx.restore();
        }else if(f.kind==='monitor'){
          const cut=G.lightState===2;
          ctx.save();ctx.translate(x,y);
          ctx.fillStyle='rgba(10,16,24,.95)';
          ctx.strokeStyle=cut?'#6B3A3A':'#3C4B5D';ctx.lineWidth=1.4;
          ctx.beginPath();ctx.roundRect(-0.72*s,-0.5*s,1.44*s,0.85*s,3);ctx.fill();ctx.stroke();
          for(let i=0;i<4;i++){
            const sx0=(-0.58+(i%2)*0.62)*s, sy0=(-0.36+Math.floor(i/2)*0.34)*s;
            ctx.fillStyle=cut?'rgba(255,90,80,.18)':'rgba(95,224,168,.16)';
            ctx.fillRect(sx0,sy0,0.52*s,0.26*s);
            if(!cut){
              const k=0.25+0.55*(0.5+0.5*Math.sin(T*3+i*1.7));
              ctx.fillStyle='rgba(150,245,205,'+(0.25*k).toFixed(2)+')';
              ctx.fillRect(sx0+0.05*s,sy0+0.05*s,0.42*s,0.03*s);
            }
          }
          ctx.fillStyle=cut?'#FF6B61':'#5FE0A8';
          ctx.beginPath();ctx.arc(0.54*s,-0.40*s,0.05*s,0,7);ctx.fill();
          ctx.restore();
        }else if(f.kind==='medbot'){
          const dead=!!G.medbotDead;
          const hover=Math.sin(T*2.1)*0.045*s;
          ctx.save();ctx.translate(x,y+hover);
          if(!dead){
            const rad=ctx.createRadialGradient(0,0,0,0,0,1.1*s);
            rad.addColorStop(0,'rgba(63,191,140,.20)');rad.addColorStop(1,'rgba(63,191,140,0)');
            ctx.fillStyle=rad;ctx.beginPath();ctx.arc(0,0,1.1*s,0,7);ctx.fill();
          }
          ctx.fillStyle='rgba(14,22,26,.96)';
          ctx.strokeStyle=dead?'#5B6572':'#3FBF8C';ctx.lineWidth=1.6;
          ctx.beginPath();ctx.arc(0,0,0.36*s,0,7);ctx.fill();ctx.stroke();
          drawIcon('cross',dead?'#5B6572':'#7FE3B4',0,0,0.34*s,0,1.8);
          ctx.fillStyle=dead?'#5B6572':'#5FE0A8';
          ctx.beginPath();ctx.arc(0.34*s,-0.26*s,0.05*s,0,7);ctx.fill();
          if(G.medbotT>0&&!G.medbotUsed&&!dead){
            ctx.strokeStyle='rgba(127,227,180,'+(0.35+0.35*Math.sin(T*10)).toFixed(2)+')';ctx.lineWidth=2;
            ctx.beginPath();ctx.arc(0,0,(0.5+0.6*Math.min(1,G.medbotT/3))*s,0,7);ctx.stroke();
          }
          ctx.restore();
        }else if(f.kind==='secbot'){
          const dead=!!G.secbotDead;
          const used=!!G.secbotUsed;
          ctx.save();ctx.translate(x,y);
          if(!dead){
            const scan=T*0.9;
            ctx.strokeStyle='rgba(255,107,97,.28)';ctx.lineWidth=1.6;
            ctx.beginPath();ctx.arc(0,0,2.1*s,scan-0.34,scan+0.34);ctx.stroke();
            ctx.beginPath();ctx.arc(0,0,2.1*s,scan+Math.PI-0.34,scan+Math.PI+0.34);ctx.stroke();
            if(G.secbotT>0){
              ctx.strokeStyle='rgba(255,107,97,'+(0.5+0.4*Math.sin(T*16)).toFixed(2)+')';ctx.lineWidth=2.6;
              ctx.beginPath();ctx.arc(0,0,(1.1+0.8*(1.6-G.secbotT))*s,0,7);ctx.stroke();
            }
          }
          ctx.fillStyle='rgba(12,15,20,.97)';
          ctx.strokeStyle=dead?'#4E5663':(used?'#8A6A45':'#FF7B72');ctx.lineWidth=1.6;
          ctx.beginPath();ctx.roundRect(-0.42*s,-0.34*s,0.84*s,0.7*s,4);ctx.fill();ctx.stroke();
          ctx.fillStyle=dead?'#4E5663':(used?'#8A6A45':'#FF6B61');
          ctx.beginPath();ctx.arc(0,-0.02*s,0.16*s,0,7);ctx.fill();
          ctx.fillStyle=dead?'rgba(78,86,99,.6)':(used?'rgba(138,106,69,.6)':'rgba(255,107,97,.55)');
          ctx.fillRect(-0.26*s,0.18*s,0.52*s,0.08*s);
          ctx.fillStyle=dead?'#5B6572':(used?'#C9A46B':'#FFB4A8');
          ctx.font='600 8px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText(dead?'OFF':(used?'EMPTY':'GUARD'),0,0.37*s);
          ctx.restore();
        }
      }
      /* 拘留区：保安机器人旁边的红色虚线角笼 */
      const jail=secJail();
      if(jail){
        const jx=SX(jail[0]),jy=SY(jail[1]);
        const busy=G.agents.some(a=>a.detained&&a.alive);
        ctx.save();
        ctx.setLineDash([4,3]);
        ctx.strokeStyle=busy?'rgba(255,107,97,.6)':'rgba(120,136,154,.22)';
        ctx.lineWidth=1.2;
        ctx.beginPath();ctx.ellipse(jx,jy,0.52*s,0.34*s,0,0,7);ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle=busy?'rgba(255,150,140,.75)':'rgba(120,136,154,.35)';
        ctx.font='500 9px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText('拘留区',jx,jy-0.5*s);
        ctx.restore();
      }
    }
    /* 地道口：紫色格栅 + 呼吸光环 */
    function drawPipes(T){
      const s=VIEW.s;
      for(const q of M.pipes){
        const x=SX(q.x),y=SY(q.y);
        const rad=ctx.createRadialGradient(x,y,0,x,y,0.95*s);
        rad.addColorStop(0,'rgba(168,150,255,.20)');
        rad.addColorStop(1,'rgba(168,150,255,0)');
        ctx.fillStyle=rad;ctx.beginPath();ctx.arc(x,y,0.95*s,0,7);ctx.fill();
        ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);
        ctx.fillStyle='rgba(12,12,20,.96)';
        ctx.strokeStyle='rgba(168,150,255,.8)';ctx.lineWidth=1.3;
        ctx.fillRect(-0.33*s,-0.33*s,0.66*s,0.66*s);
        ctx.strokeRect(-0.33*s,-0.33*s,0.66*s,0.66*s);
        ctx.strokeStyle='rgba(140,124,220,.55)';ctx.lineWidth=1;
        for(let i=-1;i<=1;i++){
          ctx.beginPath();ctx.moveTo(-0.24*s,i*0.13*s);ctx.lineTo(0.24*s,i*0.13*s);ctx.stroke();
        }
        ctx.restore();
        const k=(T*0.55+q.x*0.07)%1;
        ctx.strokeStyle='rgba(168,150,255,'+(0.5*(1-k)).toFixed(2)+')';ctx.lineWidth=1.4;
        ctx.beginPath();ctx.ellipse(x,y,(0.4+0.7*k)*s,(0.26+0.45*k)*s,0,0,7);ctx.stroke();
      }
    }
    /* 声纹：多个声音同时出现时画多圈涟漪，穿墙可见（雾之上） */
    const WAVE_COL={step:'203,218,234',knife:'255,107,97',shot:'255,192,97',
      drag:'224,169,75',power:'127,211,240',pipe:'168,150,255',robot:'255,138,101',alarm:'255,107,97'};
    function drawWaves(d){
      if(!G||!G.waves.length)return;
      const s=VIEW.s;
      for(const w of G.waves){
        w.t=(w.t||0)+d;
        if(w.t>=w.dur)continue;
        const p=Math.max(0,Math.min(1,w.t/w.dur));
        const a=(1-p)*(w.str==null?0.8:w.str);
        const col=WAVE_COL[w.kind]||WAVE_COL.step;
        const r=(0.28+1.75*p)*s;
        ctx.strokeStyle='rgba('+col+','+(0.62*a).toFixed(2)+')';
        ctx.lineWidth=1.3+1.4*(1-p);
        ctx.beginPath();ctx.ellipse(SX(w.x),SY(w.y),r,r*0.6,0,0,7);ctx.stroke();
        if(p>0.22){
          const r2=(0.12+1.3*(p-0.22))*s;
          ctx.strokeStyle='rgba('+col+','+(0.35*a).toFixed(2)+')';
          ctx.lineWidth=1;
          ctx.beginPath();ctx.ellipse(SX(w.x),SY(w.y),r2,r2*0.6,0,0,7);ctx.stroke();
        }
        const dot=Math.max(0,4.2*(1-p));
        if(dot>0.4){
          ctx.fillStyle='rgba('+col+','+(0.85*a).toFixed(2)+')';
          ctx.beginPath();ctx.arc(SX(w.x),SY(w.y),dot,0,7);ctx.fill();
        }
      }
      G.waves=G.waves.filter(w=>w.t<w.dur);
    }
    /* 全船监控：3×3 实时画面（底图裁切 + 在场人员点位），断电时整屏雪花 */
    function drawCams(T){
      const c=document.getElementById('camcv');
      if(!c)return;
      const g=c.getContext('2d');
      const W=c.width,H=c.height,pad=8,head=17;
      g.clearRect(0,0,W,H);
      g.fillStyle='#04070B';g.fillRect(0,0,W,H);
      const tw=(W-pad*4)/3, th=(H-pad*4)/3;
      const base=IMG['base'], bReady=ready(base);
      const isc=base&&base.naturalWidth?base.naturalWidth/M.bounds.w:48;
      const cut=G.lightState===2;
      const rooms=M.rooms.slice(0,9);
      rooms.forEach((r,n)=>{
        const cx=pad+(n%3)*(tw+pad), cy=pad+Math.floor(n/3)*(th+pad);
        const bodyY=cy+head, bodyH=th-head;
        g.save();
        g.beginPath();g.roundRect(cx,cy,tw,th,5);g.clip();
        g.fillStyle='#05090E';g.fillRect(cx,cy,tw,th);
        const inRoom=G.agents.filter(a=>a.alive&&!a.downed&&roomIdAt(a.x,a.y)===r.id).length;
        g.fillStyle='rgba(10,18,26,.96)';g.fillRect(cx,cy,tw,head);
        g.textBaseline='middle';
        g.font='600 10px system-ui';g.textAlign='left';
        g.fillStyle=cut?'#8C97A6':'#BFE9F7';g.fillText(r.name,cx+6,cy+head/2+0.5);
        g.font='500 9px system-ui';g.textAlign='right';
        g.fillStyle=cut?'#FF6B61':'#5FE0A8';
        g.fillText(cut?'NO SIGNAL':(inRoom?'● '+inRoom+' 人':'● 无人'),cx+tw-6,cy+head/2+0.5);
        if(cut){
          for(let i=0;i<90;i++){
            const qx=cx+((i*97+Math.floor(T*37)*13)%Math.max(1,tw));
            const qy=bodyY+((i*53+Math.floor(T*29)*7)%Math.max(1,bodyH));
            g.fillStyle='rgba(190,210,225,'+(0.05+((i*7)%10)/28).toFixed(2)+')';
            g.fillRect(qx,qy,2,1);
          }
          g.fillStyle='rgba(255,107,97,.92)';g.font='600 13px system-ui';g.textAlign='center';
          g.fillText('信号中断 · 电闸断开',cx+tw/2,bodyY+bodyH/2);
        }else if(bReady){
          const pr=1.4;
          const srx=Math.max(0,(r.rect[0]-pr)*isc), sry=Math.max(0,(r.rect[1]-pr)*isc);
          const srw=(r.rect[2]+pr*2)*isc, srh=(r.rect[3]+pr*2)*isc;
          const k=Math.min(tw/srw,bodyH/srh);
          const dw=srw*k,dh=srh*k,dx=cx+(tw-dw)/2,dy=bodyY+(bodyH-dh)/2;
          g.drawImage(base,srx,sry,srw,srh,dx,dy,dw,dh);
          g.fillStyle=G.lit[r.id]?'rgba(8,20,26,.08)':'rgba(2,8,12,.50)';
          g.fillRect(dx,dy,dw,dh);
          g.fillStyle='rgba(74,226,168,.045)';g.fillRect(dx,dy,dw,dh);
          const wpx=isc*k;
          for(const a of G.agents){
            if(roomIdAt(a.x,a.y)!==r.id)continue;
            if(!a.alive&&a.bodyGone)continue;
            const ax=dx+(a.x-(r.rect[0]-pr))*wpx, ay=dy+(a.y-(r.rect[1]-pr))*wpx;
            if(ax<cx+3||ax>cx+tw-3||ay<bodyY+3||ay>cy+th-3)continue;
            if(!a.alive||a.downed){
              g.strokeStyle=a.alive?'#FF8A80':'rgba(205,150,150,.72)';g.lineWidth=1.6;
              g.beginPath();g.moveTo(ax-3,ay-3);g.lineTo(ax+3,ay+3);
              g.moveTo(ax+3,ay-3);g.lineTo(ax-3,ay+3);g.stroke();
              continue;
            }
            g.fillStyle=a===G.me?'#F0C674':'#DDE6F0';
            g.beginPath();g.arc(ax,ay,2.6,0,7);g.fill();
            g.strokeStyle='rgba(0,0,0,.6)';g.lineWidth=0.8;g.stroke();
            if(a.detained){g.strokeStyle='#7FD3F0';g.lineWidth=1;g.beginPath();g.arc(ax,ay,4.6,0,7);g.stroke();}
          }
          const sy=bodyY+((T*36)%Math.max(1,bodyH));
          g.fillStyle='rgba(120,230,190,.10)';g.fillRect(cx,sy,tw,1.2);
        }else{
          g.fillStyle='#8C97A6';g.font='600 12px system-ui';g.textAlign='center';
          g.fillText('画面载入中…',cx+tw/2,bodyY+bodyH/2);
        }
        g.strokeStyle=cut?'rgba(255,107,97,.35)':'rgba(90,170,220,.35)';
        g.lineWidth=1;g.strokeRect(cx+0.5,cy+0.5,tw-1,th-1);
        g.restore();
        if(!cut){
          g.fillStyle='rgba(255,90,80,'+(0.35+0.5*(0.5+0.5*Math.sin(T*4))).toFixed(2)+')';
          g.beginPath();g.arc(cx+tw-8,cy+th-8,2.4,0,7);g.fill();
        }
      });
      g.fillStyle='rgba(140,160,180,.6)';g.font='500 9px system-ui';
      g.textAlign='right';g.textBaseline='middle';
      g.fillText('CCTV · 只显示在场人员，不显示身份 · '+(cut?'OFFLINE':'LIVE'),W-pad,H-4);
    }

    function pill(text,x,y,accent,fg){
      ctx.font='500 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
      const w=ctx.measureText(text).width+16;
      ctx.fillStyle='rgba(8,11,16,.84)';
      ctx.beginPath();ctx.roundRect(x-w/2,y-10,w,20,6);ctx.fill();
      ctx.strokeStyle=accent;ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle=fg||'#C9D1DB';ctx.fillText(text,x,y+0.5);
    }

    /* ---- 动作贴片：工具 / 武器 / 命中特效（纯视觉，不改判定） ---- */
    function rowForAng(ang){
      const c=Math.cos(ang),s=Math.sin(ang);
      if(Math.abs(c)>=Math.abs(s)) return c>0?ROW.right:ROW.left;
      return s>0?ROW.down:ROW.up;
    }
    function dirAng(a){
      if(!a)return 0;
      if(a.dir==='left')return Math.PI;
      if(a.dir==='up')return -Math.PI/2;
      if(a.dir==='down')return Math.PI/2;
      return 0;
    }
    function workStyle(a){
      if(a._doing==='med')return {c:'#3FBF8C',icon:'cross',glow:'rgba(63,191,140,.12)'};
      if(a._doing==='ammo')return {c:'#E0A94B',icon:'bullet',glow:'rgba(224,169,75,.12)'};
      if(a._doing==='search')return {c:'#7FD3F0',icon:'lens',glow:'rgba(127,211,240,.10)'};
      if(a._doing==='revive')return {c:'#3FBF8C',icon:'cross',glow:'rgba(63,191,140,.12)'};
      if(a._doing==='breaker')return {c:'#7FD3F0',icon:'bolt',glow:'rgba(127,211,240,.12)'};
      return {c:'#F0C674',icon:'wrench',glow:'rgba(240,198,116,.11)'};
    }
    function drawIcon(icon,c,x,y,s,ang,lw){
      ctx.save();ctx.translate(x,y);ctx.rotate(ang||0);
      ctx.strokeStyle=c;ctx.fillStyle=c;ctx.lineWidth=lw||2;ctx.lineCap='round';ctx.lineJoin='round';
      if(icon==='wrench'){
        ctx.beginPath();ctx.moveTo(-s*0.48,s*0.48);ctx.lineTo(s*0.20,-s*0.16);ctx.stroke();
        ctx.beginPath();ctx.arc(s*0.34,-s*0.30,s*0.24,-0.9,2.0);ctx.stroke();
      }else if(icon==='cross'){
        ctx.fillRect(-s*0.11,-s*0.46,s*0.22,s*0.92);
        ctx.fillRect(-s*0.46,-s*0.11,s*0.92,s*0.22);
      }else if(icon==='bullet'){
        ctx.beginPath();ctx.roundRect(-s*0.16,-s*0.36,s*0.32,s*0.72,s*0.12);ctx.fill();
        ctx.beginPath();ctx.arc(0,-s*0.36,s*0.16,Math.PI,0);ctx.fill();
      }else if(icon==='lens'){
        ctx.beginPath();ctx.arc(0,0,s*0.28,0,7);ctx.stroke();
        ctx.beginPath();ctx.moveTo(s*0.2,s*0.2);ctx.lineTo(s*0.46,s*0.46);ctx.stroke();
      }else if(icon==='bolt'){
        ctx.beginPath();ctx.moveTo(-s*0.14,-s*0.48);ctx.lineTo(s*0.16,-s*0.06);ctx.lineTo(0,-s*0.06);
        ctx.lineTo(s*0.14,s*0.48);ctx.lineTo(-s*0.16,0);ctx.lineTo(0,0);ctx.closePath();ctx.fill();
      }
      ctx.restore();
    }
    function drawWork(a,T,ghost){
      const x=SX(a.x),y=SY(a.y),st=workStyle(a);
      const total=(a._dur||1), k=1-Math.max(0,a.doing)/total;
      ctx.save();
      if(ghost)ctx.globalAlpha=0.55;
      ctx.fillStyle=st.glow;
      ctx.beginPath();ctx.ellipse(x,y,1.5*VIEW.s,0.8*VIEW.s,0,0,7);ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,.16)';ctx.lineWidth=4;
      ctx.beginPath();ctx.arc(x,y,1.05*VIEW.s,0,7);ctx.stroke();
      ctx.strokeStyle=st.c;ctx.lineWidth=4.5;ctx.lineCap='round';
      ctx.beginPath();ctx.arc(x,y,1.05*VIEW.s,-Math.PI/2,-Math.PI/2+k*Math.PI*2);ctx.stroke();
      const aEnd=-Math.PI/2+k*Math.PI*2;
      ctx.fillStyle=st.c;
      ctx.beginPath();ctx.arc(x+Math.cos(aEnd)*1.05*VIEW.s,y+Math.sin(aEnd)*1.05*VIEW.s,4,0,7);ctx.fill();
      const bob=Math.sin(T*9)*0.09*VIEW.s;
      const tx=x+0.80*VIEW.s,ty=y-0.62*VIEW.s+bob;
      const ga=ctx.globalAlpha;
      ctx.globalAlpha=ga*0.16;ctx.fillStyle=st.c;
      ctx.beginPath();ctx.arc(tx,ty,0.46*VIEW.s,0,7);ctx.fill();
      ctx.globalAlpha=ga;
      ctx.save();ctx.shadowColor='rgba(8,12,16,.85)';ctx.shadowBlur=5;
      drawIcon(st.icon,st.icon==='wrench'?'#FFE8B0':st.c,tx,ty,0.66*VIEW.s,-0.5+Math.sin(T*4.5)*0.28,3.2);
      ctx.restore();
      /* 工具接触点的连续火花，比一次性粒子更能读出「正在修」 */
      if(a._doing==='task'||a._doing==='breaker'){
        const hx=x+0.72*VIEW.s,hy=y-0.48*VIEW.s;
        ctx.lineCap='round';
        for(let i=0;i<7;i++){
          const ph=(T*2.8+i*0.17)%1, ang=-1.35+i*0.45;
          ctx.strokeStyle='rgba(210,244,255,'+(0.85*(1-ph)).toFixed(2)+')';ctx.lineWidth=2.2;
          const r0=(0.40+0.34*ph)*VIEW.s, r1=r0+0.18*VIEW.s;
          ctx.beginPath();
          ctx.moveTo(hx+Math.cos(ang)*r0,hy+Math.sin(ang)*r0*0.7);
          ctx.lineTo(hx+Math.cos(ang)*r1,hy+Math.sin(ang)*r1*0.7);
          ctx.stroke();
        }
        ctx.fillStyle='rgba(255,255,255,'+(0.55+0.35*Math.sin(T*14)).toFixed(2)+')';
        ctx.beginPath();ctx.arc(hx,hy,2.6,0,7);ctx.fill();
      }
      ctx.restore();
    }
    function drawWeapon(a,T){
      if(!a.alive||a.downed)return;
      const isMe=a===G.me, acting=a.act&&(a.act.kind==='stab'||a.act.kind==='shoot');
      if(!isMe&&!acting&&!G.dev)return;
      const x=SX(a.x),y=SY(a.y);
      if(a.alien){
        if(a.knife<1&&!isMe&&!G.dev&&!acting)return;
        let ang=dirAng(a);
        if(a.act&&a.act.kind==='stab')ang=a.act.ang+(a.act.t/a.act.dur-0.5)*1.8;
        const hx=x+Math.cos(ang)*0.32*VIEW.s,hy=y+Math.sin(ang)*0.32*VIEW.s-0.20*VIEW.s;
        ctx.save();ctx.lineCap='round';
        ctx.strokeStyle='#E9EDF4';ctx.lineWidth=2.4;
        ctx.beginPath();ctx.moveTo(hx,hy);ctx.lineTo(hx+Math.cos(ang)*0.36*VIEW.s,hy+Math.sin(ang)*0.36*VIEW.s);ctx.stroke();
        ctx.strokeStyle='#8A94A3';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(hx,hy);ctx.lineTo(hx+Math.cos(ang)*0.36*VIEW.s,hy+Math.sin(ang)*0.36*VIEW.s);ctx.stroke();
        ctx.restore();
      }else{
        if(a.bullet<1&&!isMe&&!G.dev&&!acting)return;
        let ang=dirAng(a);
        if(a.act&&a.act.kind==='shoot')ang=a.act.ang;
        const hx=x+Math.cos(ang)*0.28*VIEW.s,hy=y+Math.sin(ang)*0.28*VIEW.s-0.16*VIEW.s;
        ctx.save();ctx.lineCap='round';
        ctx.strokeStyle='#3A4556';ctx.lineWidth=4;
        ctx.beginPath();ctx.moveTo(hx,hy);ctx.lineTo(hx+Math.cos(ang)*0.28*VIEW.s,hy+Math.sin(ang)*0.28*VIEW.s);ctx.stroke();
        ctx.strokeStyle='#C9D1DB';ctx.lineWidth=1.3;
        ctx.beginPath();ctx.moveTo(hx,hy);ctx.lineTo(hx+Math.cos(ang)*0.24*VIEW.s,hy+Math.sin(ang)*0.24*VIEW.s);ctx.stroke();
        ctx.restore();
      }
    }

    /* ---- 特效层：在角色之后、战争迷雾之前绘制 ---- */
    function drawFx(d,T){
      for(const f of G.fx){
        f.t-=d;
        if(f.t<=0)continue;
        if(f.x!=null&&!visibleAt(f.x,f.y))continue;
        if(f.type==='tracer'&&!(visibleAt(f.x1,f.y1)||visibleAt(f.x2,f.y2)))continue;
        const D=f.dur||0.6,p=1-Math.max(0,f.t)/D,a=1-p;
        if(f.type==='slash'){
          const a0=f.ang-1.6+2.6*p;
          const rO=(0.62+0.95*p)*VIEW.s, rI=(0.38+0.75*p)*VIEW.s;
          ctx.save();ctx.translate(SX(f.x),SY(f.y));ctx.lineCap='round';
          ctx.beginPath();
          ctx.arc(0,0,rO,a0-0.55,a0+0.55);
          ctx.arc(0,0,rI,a0+0.55,a0-0.55,true);
          ctx.closePath();
          ctx.fillStyle='rgba(200,225,255,'+(0.30*a).toFixed(2)+')';ctx.fill();
          ctx.strokeStyle='rgba(255,245,235,'+(0.95*a).toFixed(2)+')';ctx.lineWidth=1.5+6*a;
          ctx.beginPath();ctx.arc(0,0,rO,a0-0.5,a0+0.5);ctx.stroke();
          ctx.strokeStyle='rgba(224,87,79,'+(0.85*a).toFixed(2)+')';ctx.lineWidth=2;
          ctx.beginPath();ctx.arc(0,0,rI,a0-0.62,a0+0.62);ctx.stroke();
          ctx.fillStyle='rgba(255,255,255,'+a.toFixed(2)+')';
          ctx.beginPath();ctx.arc(Math.cos(a0)*rO,Math.sin(a0)*rO,3.2,0,7);ctx.fill();
          ctx.restore();
        }else if(f.type==='blood'){
          for(let i=0;i<12;i++){
            const sp=0.4+(((i*37)%10)/10)*1.2;
            const ang=f.ang+(((i*53)%100)/100-0.5)*1.4;
            const dist=sp*(0.25+k1(p))*VIEW.s;
            const px=SX(f.x)+Math.cos(ang)*dist, py=SY(f.y)+Math.sin(ang)*dist+p*p*0.28*VIEW.s;
            ctx.fillStyle='rgba(150,20,20,'+(0.85*a).toFixed(2)+')';
            ctx.beginPath();ctx.ellipse(px,py,3.1*(1-p*0.45),1.9*(1-p*0.45),ang,0,7);ctx.fill();
          }
        }else if(f.type==='tracer'){
          const x1=SX(f.x1),y1=SY(f.y1),x2=SX(f.x2),y2=SY(f.y2);
          ctx.save();ctx.lineCap='round';
          ctx.strokeStyle='rgba(255,225,140,'+(0.26*a).toFixed(2)+')';ctx.lineWidth=11;
          ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
          const g=ctx.createLinearGradient(x1,y1,x2,y2);
          g.addColorStop(0,'rgba(255,250,220,'+a.toFixed(2)+')');
          g.addColorStop(0.75,'rgba(255,220,120,'+(0.85*a).toFixed(2)+')');
          g.addColorStop(1,'rgba(255,255,255,0)');
          ctx.strokeStyle=g;ctx.lineWidth=2+3.6*a;
          ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
          ctx.restore();
        }else if(f.type==='muzzle'){
          const x=SX(f.x),y=SY(f.y),g=ctx.createRadialGradient(x,y,0,x,y,0.9*VIEW.s);
          g.addColorStop(0,'rgba(255,250,210,'+a.toFixed(2)+')');
          g.addColorStop(0.35,'rgba(255,200,90,'+(0.55*a).toFixed(2)+')');
          g.addColorStop(1,'rgba(255,180,60,0)');
          ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,0.9*VIEW.s,0,7);ctx.fill();
          ctx.strokeStyle='rgba(255,240,180,'+a.toFixed(2)+')';ctx.lineWidth=2;
          for(let i=0;i<4;i++){
            const ang=(f.ang||0)+i*Math.PI/2+0.3, r0=0.12*VIEW.s, r1=(0.5+0.4*a)*VIEW.s;
            ctx.beginPath();ctx.moveTo(x+Math.cos(ang)*r0,y+Math.sin(ang)*r0);
            ctx.lineTo(x+Math.cos(ang)*r1,y+Math.sin(ang)*r1);ctx.stroke();
          }
        }else if(f.type==='impact'){
          const x=SX(f.x),y=SY(f.y);
          ctx.strokeStyle='rgba(255,210,160,'+(0.9*a).toFixed(2)+')';ctx.lineWidth=2;
          ctx.beginPath();ctx.arc(x,y,(0.12+0.7*p)*VIEW.s,0,7);ctx.stroke();
          ctx.strokeStyle='rgba(255,235,190,'+(0.7*a).toFixed(2)+')';ctx.lineWidth=1.5;
          for(let i=0;i<6;i++){
            const ang=i*1.047+0.4, r0=(0.18+0.5*p)*VIEW.s, r1=(0.3+0.65*p)*VIEW.s;
            ctx.beginPath();ctx.moveTo(x+Math.cos(ang)*r0,y+Math.sin(ang)*r0);
            ctx.lineTo(x+Math.cos(ang)*r1,y+Math.sin(ang)*r1);ctx.stroke();
          }
          ctx.fillStyle='rgba(190,30,30,'+a.toFixed(2)+')';
          ctx.beginPath();ctx.arc(x,y,2.4,0,7);ctx.fill();
        }else if(f.type==='done'){
          const x=SX(f.x),y=SY(f.y);
          ctx.strokeStyle='rgba(240,198,116,'+a.toFixed(2)+')';ctx.lineWidth=2.6;
          ctx.beginPath();ctx.arc(x,y,(0.35+1.15*p)*VIEW.s,0,7);ctx.stroke();
          ctx.strokeStyle='rgba(63,191,140,'+(0.6*a).toFixed(2)+')';ctx.lineWidth=1.6;
          ctx.beginPath();ctx.arc(x,y,(0.18+0.9*p)*VIEW.s,0,7);ctx.stroke();
          for(let i=0;i<5;i++){
            const ang=-1.7+i*0.85, r=(0.35+0.75*p)*VIEW.s;
            ctx.fillStyle='rgba(255,236,170,'+(0.8*a).toFixed(2)+')';
            ctx.beginPath();ctx.arc(x+Math.cos(ang)*r,y+Math.sin(ang)*r*0.55-0.35*VIEW.s,2.2,0,7);ctx.fill();
          }
          ctx.font='600 15px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillStyle='rgba(255,246,214,'+a.toFixed(2)+')';
          ctx.fillText('✓',x-1.25*VIEW.s,y-(2.0+0.5*p)*VIEW.s);
        }else if(f.type==='qual'){
          const qr=0.40*VIEW.s;
          const x=SX(f.x)+1.45*VIEW.s,y=SY(f.y)-(2.05+0.6*p)*VIEW.s;
          ctx.strokeStyle='rgba(240,198,116,'+a.toFixed(2)+')';ctx.lineWidth=2.2;
          ctx.beginPath();ctx.arc(x,y,qr,0,7);ctx.stroke();
          ctx.fillStyle='rgba(240,198,116,'+(0.20*a).toFixed(2)+')';
          ctx.beginPath();ctx.arc(x,y,qr,0,7);ctx.fill();
          ctx.font='600 13px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillStyle='rgba(255,244,214,'+a.toFixed(2)+')';
          ctx.strokeStyle='rgba(8,10,14,'+(0.6*a).toFixed(2)+')';ctx.lineWidth=3;
          ctx.strokeText('资格 +1',x,y+1);
          ctx.fillText('资格 +1',x,y+1);
          ctx.strokeStyle='rgba(240,198,116,'+(0.55*a).toFixed(2)+')';ctx.lineWidth=1.8;
          ctx.beginPath();ctx.ellipse(SX(f.x),SY(f.y),(0.5+1.0*p)*VIEW.s,(0.3+0.55*p)*VIEW.s,0,0,7);ctx.stroke();
        }else if(f.type==='pickup'){
          const isMed=f.item==='med';
          const c=isMed?'#3FBF8C':'#E0A94B';
          const rgba=isMed?'63,191,140':'224,169,75';
          const x=SX(f.x),y=SY(f.y);
          ctx.strokeStyle='rgba('+rgba+','+(0.55*a).toFixed(2)+')';ctx.lineWidth=2;
          ctx.beginPath();ctx.ellipse(x,y,(0.45+0.6*p)*VIEW.s,(0.28+0.35*p)*VIEW.s,0,0,7);ctx.stroke();
          const pg=ctx.createLinearGradient(x,y-1.8*VIEW.s,x,y);
          pg.addColorStop(0,'rgba('+rgba+',0)');
          pg.addColorStop(0.6,'rgba('+rgba+','+(0.30*a).toFixed(2)+')');
          pg.addColorStop(1,'rgba('+rgba+','+(0.08*a).toFixed(2)+')');
          ctx.fillStyle=pg;
          ctx.beginPath();
          ctx.moveTo(x-0.18*VIEW.s,y);ctx.lineTo(x-0.32*VIEW.s,y-1.8*VIEW.s);
          ctx.lineTo(x+0.32*VIEW.s,y-1.8*VIEW.s);ctx.lineTo(x+0.18*VIEW.s,y);ctx.closePath();ctx.fill();
          ctx.fillStyle='rgba('+rgba+','+(0.22*a).toFixed(2)+')';
          ctx.beginPath();ctx.arc(x,y-1.0*VIEW.s,0.62*VIEW.s,0,7);ctx.fill();
          drawIcon(isMed?'cross':'bullet',c,x,y-(0.8+0.5*p)*VIEW.s,0.76*VIEW.s,0);
          ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.lineWidth=3;ctx.strokeStyle='rgba(8,12,10,.75)';
          const label=isMed?'拿到医疗包':'拿到子弹';
          ctx.strokeText(label,x,y-(1.9+0.25*p)*VIEW.s);
          ctx.fillStyle='rgba(235,245,240,'+a.toFixed(2)+')';
          ctx.fillText(label,x,y-(1.9+0.25*p)*VIEW.s);
        }else if(f.type==='power'){
          const x=SX(f.x),y=SY(f.y);
          ctx.strokeStyle='rgba(127,211,240,'+a.toFixed(2)+')';ctx.lineWidth=2.4;
          ctx.beginPath();ctx.arc(x,y,(0.5+1.4*p)*VIEW.s,0,7);ctx.stroke();
          ctx.lineWidth=1.8;
          for(let i=0;i<3;i++){
            const ang=-Math.PI/2+i*2.094, r=(0.55+0.75*a)*VIEW.s;
            ctx.beginPath();
            ctx.moveTo(x+Math.cos(ang)*0.25*VIEW.s,y+Math.sin(ang)*0.25*VIEW.s);
            ctx.lineTo(x+Math.cos(ang+0.25)*r*0.65,y+Math.sin(ang+0.25)*r*0.65);
            ctx.lineTo(x+Math.cos(ang-0.18)*r,y+Math.sin(ang-0.18)*r);
            ctx.stroke();
          }
        }else if(f.type==='heal'){
          const x=SX(f.x),y=SY(f.y);
          ctx.strokeStyle='rgba(63,191,140,'+a.toFixed(2)+')';ctx.lineWidth=2.4;
          ctx.beginPath();ctx.arc(x,y,(0.35+1.0*p)*VIEW.s,0,7);ctx.stroke();
          drawIcon('cross','#7FE3B4',x,y-(0.3+0.8*p)*VIEW.s,0.5*VIEW.s,0);
        }else if(f.type==='search'){
          const x=SX(f.x),y=SY(f.y);
          ctx.strokeStyle='rgba(127,211,240,'+(0.8*a).toFixed(2)+')';ctx.lineWidth=2;
          ctx.beginPath();ctx.arc(x,y,(0.3+0.9*p)*VIEW.s,0,7);ctx.stroke();
          drawIcon('lens','#BFE9F7',x,y-(0.4+0.5*p)*VIEW.s,0.45*VIEW.s,0);
        }else if(f.type==='workSpark'){
          const x=SX(f.x),y=SY(f.y)-0.2*VIEW.s;
          ctx.strokeStyle='rgba(180,230,255,'+(0.9*a).toFixed(2)+')';ctx.lineWidth=1.5;ctx.lineCap='round';
          for(let i=0;i<3;i++){
            const ang=f.ang+i*2.1, r0=(0.1+0.5*p)*VIEW.s;
            ctx.beginPath();
            ctx.moveTo(x+Math.cos(ang)*r0,y+Math.sin(ang)*r0*0.6);
            ctx.lineTo(x+Math.cos(ang)*(r0+0.14*VIEW.s),y+Math.sin(ang)*(r0+0.14*VIEW.s)*0.6-0.06*VIEW.s);
            ctx.stroke();
          }
        }else if(f.type==='spark'){
          const ang0=Math.abs(Math.sin(f.t*18));
          ctx.strokeStyle='rgba(150,220,255,'+(ang0*0.95).toFixed(2)+')';ctx.lineWidth=2;
          for(let i=0;i<5;i++){
            const ang=f.t*7+i*1.7, r0=0.25*VIEW.s, r1=(0.7+ang0*0.5)*VIEW.s;
            ctx.beginPath();
            ctx.moveTo(SX(f.x)+Math.cos(ang)*r0,SY(f.y)+Math.sin(ang)*r0);
            ctx.lineTo(SX(f.x)+Math.cos(ang)*r1,SY(f.y)+Math.sin(ang)*r1);
            ctx.stroke();
          }
        }else if(f.type==='shield'){
          ctx.strokeStyle='rgba(127,211,240,'+(0.9*a).toFixed(2)+')';ctx.lineWidth=3;
          ctx.beginPath();ctx.arc(SX(f.x),SY(f.y),(0.4+1.6*p)*VIEW.s,0,7);ctx.stroke();
          ctx.strokeStyle='rgba(127,211,240,'+(0.5*a).toFixed(2)+')';
          ctx.beginPath();ctx.arc(SX(f.x),SY(f.y),1.1*VIEW.s,0,7);ctx.stroke();
        }else if(f.type==='healBeam'){
          const x1=SX(f.x1),y1=SY(f.y1),x2=SX(f.x2),y2=SY(f.y2);
          ctx.save();ctx.setLineDash([5,4]);ctx.lineDashOffset=-T*30;
          ctx.strokeStyle='rgba(127,227,180,'+(0.65*a).toFixed(2)+')';ctx.lineWidth=2.2;
          ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle='rgba(127,227,180,'+(0.45*a).toFixed(2)+')';ctx.lineWidth=1.4;
          ctx.beginPath();ctx.arc(x2,y2,(0.35+0.8*p)*VIEW.s,0,7);ctx.stroke();
          ctx.restore();
        }else if(f.type==='detain'){
          const x1=SX(f.x1),y1=SY(f.y1),x2=SX(f.x2),y2=SY(f.y2);
          ctx.strokeStyle='rgba(255,138,101,'+(0.75*a).toFixed(2)+')';ctx.lineWidth=2.4;
          ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();
          ctx.strokeStyle='rgba(255,107,97,'+(0.85*a).toFixed(2)+')';ctx.lineWidth=2;
          ctx.beginPath();ctx.arc(x2,y2,(0.4+0.9*p)*VIEW.s,0,7);ctx.stroke();
          ctx.setLineDash([3,3]);
          ctx.strokeStyle='rgba(255,180,160,'+(0.5*a).toFixed(2)+')';ctx.lineWidth=1.2;
          ctx.beginPath();ctx.arc(x2,y2,0.52*VIEW.s,0,7);ctx.stroke();
          ctx.setLineDash([]);
        }else if(f.type==='alarm'){
          const x=SX(f.x),y=SY(f.y);
          for(let i=0;i<3;i++){
            const k=Math.max(0,Math.min(1,p-i*0.18));
            if(k<=0)continue;
            ctx.strokeStyle='rgba(255,107,97,'+(0.55*(1-k)*a).toFixed(2)+')';ctx.lineWidth=2;
            ctx.beginPath();ctx.arc(x,y,(0.4+1.5*k)*VIEW.s,0,7);ctx.stroke();
          }
        }else if(f.type==='pipefx'){
          const x=SX(f.x),y=SY(f.y);
          for(let i=0;i<3;i++){
            const k=Math.max(0,Math.min(1,p-i*0.15));
            if(k<=0)continue;
            ctx.strokeStyle='rgba(168,150,255,'+(0.7*(1-k)*a).toFixed(2)+')';ctx.lineWidth=2;
            ctx.beginPath();ctx.ellipse(x,y,(0.3+1.1*k)*VIEW.s,(0.2+0.7*k)*VIEW.s,0,0,7);ctx.stroke();
          }
        }else if(f.type==='knife'){
          ctx.strokeStyle='rgba(224,87,79,'+a.toFixed(2)+')';ctx.lineWidth=3;
          ctx.beginPath();ctx.arc(SX(f.x),SY(f.y),(0.3+1.3*p)*VIEW.s,0,7);ctx.stroke();
        }else if(f.type==='shot'){
          ctx.strokeStyle='rgba(255,235,150,'+a.toFixed(2)+')';ctx.lineWidth=2;
          ctx.beginPath();ctx.moveTo(SX(f.x1),SY(f.y1));ctx.lineTo(SX(f.x2),SY(f.y2));ctx.stroke();
        }
      }
      G.fx=G.fx.filter(f=>f.t>0);
    }
    function k1(p){return p<0.35?p/0.35*0.6:(0.6+(p-0.35)/0.65*0.4);}
    /* 头顶常显「席位号 + 名字」；编号永远在前，会议里也用同一套标签 */
    let TAG_RECTS=[];
    function drawNameTag(a,x,y,isMe){
      const no=seatNo(a), nm=a.name;
      ctx.save();
      ctx.font='600 10.5px system-ui';
      const wNo=ctx.measureText(no).width, wNm=ctx.measureText(nm).width;
      const w=wNo+wNm+17, h=15;
      /* 同屏标签互相压住时向上错开，保证编号和名字始终可读 */
      for(let k=0;k<12;k++){
        let hit=false;
        for(const r of TAG_RECTS){
          if(Math.abs(r.x-x)<(r.w+w)/2+3 && Math.abs(r.y-y)<(r.h+h)/2+1){hit=true;break;}
        }
        if(!hit)break;
        y-=h+2;
      }
      TAG_RECTS.push({x,y,w,h});
      ctx.fillStyle=isMe?'rgba(40,31,12,.92)':'rgba(8,11,16,.84)';
      ctx.beginPath();ctx.roundRect(x-w/2,y-h/2,w,h,4);ctx.fill();
      ctx.strokeStyle=isMe?'rgba(240,198,116,.8)':'rgba(126,142,164,.4)';ctx.lineWidth=1;ctx.stroke();
      ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillStyle='#F0C674';ctx.fillText(no,x-w/2+7,y+0.5);
      ctx.fillStyle='#E8EEF6';ctx.fillText(nm,x-w/2+7+wNo+5,y+0.5);
      ctx.restore();
    }

    function draw(dt){
      const T=(G.paused&&G.pauseT)?G.pauseT:performance.now()/1000;
      const d=dt||1/60;
      if(G.camView){drawCams(T);return;}
      updateCamera();
      ctx.fillStyle='#07090D';ctx.fillRect(0,0,innerWidth,innerHeight);
      const me=G.me;
      const base=IMG['base'];
      const hull=IMG['hull'];
      if(ready(hull)){
        ctx.drawImage(hull,SX(0),SY(0),M.bounds.w*VIEW.s,M.bounds.h*VIEW.s);
        if(G.lightState===2){ctx.fillStyle='rgba(4,7,11,.45)';ctx.fillRect(SX(0),SY(0),M.bounds.w*VIEW.s,M.bounds.h*VIEW.s);}
      }
      if(ready(base)){
        ctx.drawImage(base,SX(0),SY(0),M.bounds.w*VIEW.s,M.bounds.h*VIEW.s);
        for(const r of M.rooms){
          if(G.lit[r.id])continue;
          ctx.beginPath();
          r.poly.forEach((p,i)=>i?ctx.lineTo(SX(p[0]),SY(p[1])):ctx.moveTo(SX(p[0]),SY(p[1])));
          ctx.closePath();
          ctx.fillStyle='rgba(3,6,11,.55)';ctx.fill();
        }
      }else drawLegacyMap();
      drawCorridorLights(T);
      drawFacilities(T);
      drawPipes(T);
      // 房名
      for(const r of M.rooms){
        const cx=r.label?r.label[0]:r.rect[0]+r.rect[2]/2;
        const cy=r.label?r.label[1]+1.2:r.rect[1]+r.rect[3]/2;
        ctx.font='500 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.lineWidth=3;ctx.strokeStyle=G.lit[r.id]?'rgba(255,255,255,.8)':'rgba(10,14,20,.75)';
        ctx.strokeText(r.name,SX(cx),SY(cy));
        ctx.fillStyle=G.lit[r.id]?'rgba(18,26,36,.85)':'rgba(150,158,170,.75)';
        ctx.fillText(r.name,SX(cx),SY(cy));
      }
      // 任务点：只有「我」名下的任务才闪黄框（定制可见），别人的任务对我不显示
      const myLeft=me.tasks.slice(me.tIdx);
      for(const p of M.points){
        const idx=M.points.indexOf(p);
        const mine=myLeft.indexOf(idx)>=0;
        ctx.beginPath();ctx.arc(SX(p.x),SY(p.y),2.2,0,7);
        ctx.fillStyle=mine?'rgba(255,205,60,.85)':'rgba(120,130,145,.3)';ctx.fill();
        if(mine){
          const cov=M.cover.find(c=>p.x>=c.x-.25&&p.x<=c.x+c.w+.25&&p.y>=c.y-.25&&p.y<=c.y+c.h+.25);
          const a=0.35+0.55*(0.5+0.5*Math.sin(T*5.5));
          ctx.save();
          ctx.strokeStyle='rgba(255,205,60,'+a.toFixed(2)+')';
          ctx.lineWidth=2.4;ctx.setLineDash([5,4]);ctx.lineDashOffset=-T*14;
          if(cov) ctx.strokeRect(SX(cov.x)-2,SY(cov.y)-2,cov.w*VIEW.s+4,cov.h*VIEW.s+4);
          else {ctx.beginPath();ctx.arc(SX(p.x),SY(p.y),0.95*VIEW.s,0,7);ctx.stroke();}
          ctx.restore();
        }
      }
      // 靠近可交互物：中性提示（不暴露身份，不区分成败文案）
      if(me.alive&&!me.downed&&!me.detained&&me.doing<=0&&!G.meet&&!G.over){
        const cands=[];
        const np=nearPoint(me);
        const npMine=!!(np&&myLeft.indexOf(M.points.indexOf(np))>=0);
        if(np&&npMine){
          cands.push({d:Math.hypot(np.x-me.x,np.y-me.y),x:np.x,y:np.y,
            label:'[E] 维修 '+np.label+'  '+np.dur+'s',
            accent:'rgba(255,205,60,.7)',fg:'#F0C674'});
        }
        const pipe=nearPipe(me);
        if(pipe&&me.alien){
          cands.push({d:Math.hypot(pipe.x-me.x,pipe.y-me.y),x:pipe.x,y:pipe.y,
            label:'[E] 地道 · 选择出口',accent:'rgba(168,150,255,.75)',fg:'#D6CCFF'});
        }
        const br=M.facility.find(f=>f.kind==='breaker');
        if(br&&Math.hypot(br.x-me.x,br.y-me.y)<1.6){
          cands.push({d:Math.hypot(br.x-me.x,br.y-me.y),x:br.x,y:br.y,
            label:'[E] '+(G.lightState===2?'合闸':'拉闸')+' 3s · '+(G.lightState===2?'当前断电':'当前照明'),
            accent:'rgba(127,211,240,.75)',fg:'#BFE9F7'});
        }
        const mon=nearMonitor(me);
        if(mon){
          cands.push({d:Math.hypot(mon.x-me.x,mon.y-me.y),x:mon.x,y:mon.y,
            label:'[V] 全船监控'+(G.lightState===2?'（信号中断）':''),
            accent:'rgba(95,224,168,.75)',fg:'#B9F5DA'});
        }
        const bot=M.facility.find(f=>(f.kind==='medbot'||f.kind==='secbot')&&Math.hypot(f.x-me.x,f.y-me.y)<1.7);
        if(bot){
          const dead=bot.kind==='secbot'?G.secbotDead:G.medbotDead;
          cands.push({d:Math.hypot(bot.x-me.x,bot.y-me.y),x:bot.x,y:bot.y,
            label:(bot.kind==='secbot'?'保安机器人':'医疗机器人')+(dead?' · 停摆':' · 在线'),
            accent:dead?'rgba(120,130,145,.5)':'rgba(63,191,140,.7)',fg:dead?'#8A94A3':'#9FE8C6'});
        }
        if(cands.length){
          cands.sort((a,b)=>a.d-b.d);
          const c=cands[0];
          pill(c.label,SX(c.x),SY(c.y)-2.4*VIEW.s,c.accent,c.fg);
        }else if(np&&!npMine){
          pill('设备没有响应',SX(np.x),SY(np.y)-2.4*VIEW.s,'rgba(120,130,145,.5)','#8A94A3');
        }
      }
      // 尸体提示：报告 / 搜尸 / 拖拽 / 施救
      if(me.alive&&!me.downed&&!G.meet&&!G.over&&me.doing<=0){
        const nb=bodyNear(2.2);
        if(nb){
          const bp=bodyPos(nb);
          if(bp&&visibleAt(bp[0],bp[1])){
            const lbl=nb.alive?'[R] 报告 · [X] 查看伤情 · [G] 拖走 · [F] 施救':'[R] 报告 · [X] 搜尸 · [G] 拖拽';
            pill(lbl,SX(bp[0]),SY(bp[1])-1.15*VIEW.s,'rgba(255,176,32,.85)','#FFE0A3');
          }
        }
      }
      // 点击地面提示：一个扩散的圈
      if(G.clickFx){
        G.clickFx.t-=d;
        if(G.clickFx.t<=0)G.clickFx=null;
        else{
          const k=1-G.clickFx.t/0.55, r=(0.35+0.75*k)*VIEW.s;
          ctx.strokeStyle='rgba(240,198,116,'+(0.7*(1-k)).toFixed(2)+')';ctx.lineWidth=2;
          ctx.beginPath();ctx.ellipse(SX(G.clickFx.x),SY(G.clickFx.y),r,r*0.55,0,0,7);ctx.stroke();
        }
      }
      // 尸体 / 濒死者：躺倒的行走图 + 血泊（先画，活人叠在上面）
      TAG_RECTS=[];
      for(const a of G.agents){
        const bp=bodyPos(a); if(!bp)continue;
        if(!visibleAt(bp[0],bp[1]))continue;
        const x=SX(bp[0]),y=SY(bp[1]);
        ctx.fillStyle=a.alive?'rgba(150,26,26,.30)':'rgba(110,12,12,.42)';
        ctx.beginPath();ctx.ellipse(x,y,0.62*VIEW.s,0.34*VIEW.s,0,0,7);ctx.fill();
        const im=IMG['cr_'+((a.i%15)+1)];
        if(ready(im)){
          const w=1.05*VIEW.s,h=w*160/96;
          ctx.save();ctx.translate(x,y);ctx.rotate(-Math.PI/2);
          ctx.globalAlpha=a.alive?0.92:0.62;
          ctx.drawImage(im,0,2*160,96,160,-w/2,-h/2,w,h);
          ctx.restore();ctx.globalAlpha=1;
        }
        if(a.alive){
          const k=0.5+0.5*Math.sin(T*6);
          ctx.strokeStyle='rgba(224,87,79,'+(0.45+0.4*k).toFixed(2)+')';ctx.lineWidth=2;
          ctx.beginPath();ctx.arc(x,y,0.68*VIEW.s,0,7);ctx.stroke();
        }else{
          ctx.strokeStyle='rgba(200,210,225,.28)';ctx.lineWidth=1.2;
          ctx.beginPath();ctx.arc(x,y,0.7*VIEW.s,0,7);ctx.stroke();
        }
        if(!G.dev)drawNameTag(a,x,y-0.62*VIEW.s,a.i===G.me.i);
        if(a.act&&a.act.kind==='hurt'){
          const hk=1-Math.max(0,a.act.t)/a.act.dur;
          ctx.strokeStyle='rgba(255,90,80,'+(0.8*hk).toFixed(2)+')';ctx.lineWidth=2;
          ctx.beginPath();ctx.arc(x,y,(0.55+0.8*(1-hk))*VIEW.s,0,7);ctx.stroke();
        }
      }
      // 活人：真实行走图
      for(const a of G.agents){
        if(!a.alive||a.downed)continue;
        if(a!==me&&!canSee(a))continue;
        const im=IMG['cr_'+((a.i%15)+1)];
        const off=actOffset(a);
        const acting=a.act&&(a.act.kind==='stab'||a.act.kind==='shoot');
        /* 脚下软阴影：把 3D 渲染的角色压进地毯/钢板上，不然像贴纸 */
        ctx.save();
        ctx.fillStyle='rgba(0,0,0,.34)';
        ctx.beginPath();ctx.ellipse(SX(a.x),SY(a.y),0.42*VIEW.s,0.15*VIEW.s,0,0,7);ctx.fill();
        ctx.restore();
        if(ready(im)){
          const w=1.25*VIEW.s,h=w*160/96;
          const row=acting?rowForAng(a.act.ang):(a.moving?(ROW[a.dir]||0):2);
          const fr=a.moving?(Math.floor(T*7)%4):0;
          const bob=a.doing>0?Math.sin(T*11)*0.02*VIEW.s:0;
          ctx.drawImage(im,fr*96,row*160,96,160,
            SX(a.x)-w/2+(off?off.x:0),SY(a.y)-h*0.86+(off?off.y:0)+bob,w,h);
        }else{
          ctx.beginPath();ctx.arc(SX(a.x),SY(a.y),5,0,7);
          ctx.fillStyle=a===me?'#F0C674':'#8FA6C0';ctx.fill();
        }
        if(a.doing>0)drawWork(a,T);
        drawWeapon(a,T);
        if(!G.dev){
          const topY=SY(a.y)-(ready(im)?(1.25*VIEW.s*160/96)*0.86:0)-9;
          drawNameTag(a,SX(a.x),topY,a===me);
        }
        if(a===me){ctx.strokeStyle='rgba(240,198,116,.7)';ctx.lineWidth=1.4;
          ctx.beginPath();ctx.arc(SX(a.x),SY(a.y),11,0,7);ctx.stroke();}
      }
      // 幽灵：半透明 + 青色光晕（活人看不见，幽灵与 DEV 看得见）
      for(const a of G.agents){
        if(a.alive||!a.ghost)continue;
        if(a!==me&&me.alive&&!G.dev)continue;
        const x=SX(a.x),y=SY(a.y);
        const rad=ctx.createRadialGradient(x,y-0.4*VIEW.s,0,x,y-0.4*VIEW.s,1.5*VIEW.s);
        rad.addColorStop(0,'rgba(127,211,240,.20)');rad.addColorStop(1,'rgba(127,211,240,0)');
        ctx.fillStyle=rad;ctx.beginPath();ctx.arc(x,y-0.4*VIEW.s,1.5*VIEW.s,0,7);ctx.fill();
        const im=IMG['cr_'+((a.i%15)+1)];
        if(ready(im)){
          const w=1.15*VIEW.s,h=w*160/96;
          ctx.save();
          ctx.globalAlpha=0.28+0.06*Math.sin(T*2.2+a.i);
          const fr=Math.floor(T*3+a.i)%4;
          ctx.drawImage(im,fr*96,2*160,96,160,x-w/2,y-h*0.86,w,h);
          ctx.restore();
        }
        if(a.doing>0)drawWork(a,T,true);
        if(!G.dev)drawNameTag(a,x,y-(ready(im)?(1.15*VIEW.s*160/96)*0.86:0)-9,a===me);
        ctx.strokeStyle='rgba(127,211,240,.5)';ctx.lineWidth=1.2;
        ctx.beginPath();ctx.arc(x,y,0.62*VIEW.s,0,7);ctx.stroke();
        if(a===me){
          ctx.strokeStyle='rgba(127,211,240,.8)';ctx.lineWidth=1.6;
          ctx.beginPath();ctx.arc(x,y,1.1*VIEW.s,0,7);ctx.stroke();
        }
      }
      // 动作特效层（角色之上、雾之下）
      drawFx(d,T);
      // 拖拽绳
      if(G.drag!=null){
        const b=G.agents[G.drag],bp=bodyPos(b);
        if(bp){
          ctx.save();ctx.setLineDash([4,4]);ctx.strokeStyle='rgba(240,198,116,.55)';ctx.lineWidth=1.4;
          ctx.beginPath();ctx.moveTo(SX(me.x),SY(me.y));ctx.lineTo(SX(bp[0]),SY(bp[1]));ctx.stroke();ctx.restore();
        }
      }
      drawFog();
      /* 声纹画在雾之上：墙后的脚步/刀声也能看见方向 */
      drawWaves(d);
      // 受击红晕（命中反馈）
      if(me.act&&me.act.kind==='hurt'){
        const hk=1-Math.max(0,me.act.t)/me.act.dur;
        const rg=ctx.createRadialGradient(innerWidth/2,innerHeight/2,Math.min(innerWidth,innerHeight)*0.22,
          innerWidth/2,innerHeight/2,Math.max(innerWidth,innerHeight)*0.72);
        rg.addColorStop(0,'rgba(180,20,20,0)');
        rg.addColorStop(1,'rgba(180,20,20,'+(0.5*hk).toFixed(2)+')');
        ctx.fillStyle=rg;ctx.fillRect(0,0,innerWidth,innerHeight);
      }
      // DEV 标签：全知视角下每个席位都标身份/状态（画在雾之上）
      if(G.dev){
        ctx.font='500 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
        for(const a of G.agents){
          const y=SY(a.y)-(a.alive&&!a.downed?1.55:0.9)*VIEW.s;
          let txt=tagName(a)+(a.alien?' · 异形':' · 人类');
          if(!a.alive)txt+=' · 幽灵';
          else if(a.downed)txt+=' · 濒死';
          else if(a.detained)txt+=' · 被擒';
          const w=ctx.measureText(txt).width+8;
          ctx.fillStyle='rgba(8,11,16,.82)';
          ctx.beginPath();ctx.roundRect(SX(a.x)-w/2,y-8,w,16,4);ctx.fill();
          ctx.fillStyle=a.alien?'#FF7B72':(a===G.me?'#F0C674':'#7FD3F0');
          ctx.fillText(txt,SX(a.x),y);
          const bp=bodyPos(a);
          if(bp&&!a.alive){
            const by=SY(bp[1])+0.95*VIEW.s;
            const kt='尸体 · 凶手 '+(a.killedBy!=null?G.agents[a.killedBy].name:'?');
            const kw=ctx.measureText(kt).width+8;
            ctx.fillStyle='rgba(40,8,8,.85)';
            ctx.beginPath();ctx.roundRect(SX(bp[0])-kw/2,by-8,kw,16,4);ctx.fill();
            ctx.fillStyle='#FF9A90';ctx.fillText(kt,SX(bp[0]),by);
          }
        }
      }
      /* 全图模式本身已展示完整船体，再叠小地图会盖住右上角的监控室 */
      if(G.camMode!=='map') drawMini();
      if(G.msgT>0){G.msgT-=d;
        ctx.fillStyle='rgba(240,198,116,.95)';ctx.font='500 14px system-ui';ctx.textAlign='center';
        ctx.fillText(G.msg,innerWidth/2,innerHeight-56);}
      // DEV 面板刷新（0.5s）
      if(G.dev){ G.devT=(G.devT+1)%30; if(G.devT===1)renderDevPanel(); }
    }
    /* 小地图：照蓝图风格重画 —— 房间轮廓 + 连接通道 + 舱室名 + 任务点图例 */
    function drawMini(){
      const w=Math.min(300,Math.max(220,Math.round(innerWidth*0.19)));
      const k=w/M.bounds.w, mh=M.bounds.h*k;
      const padT=18, legH=22;
      const x=innerWidth-w-16, y=16, my=y+padT;
      const h=mh+padT+legH;
      const T=performance.now()/1000;
      ctx.save();
      /* 面板 */
      ctx.fillStyle='rgba(7,12,18,.92)';ctx.strokeStyle='#33465C';ctx.lineWidth=1;
      ctx.beginPath();ctx.roundRect(x-6,y-6,w+12,h+12,8);ctx.fill();ctx.stroke();
      ctx.fillStyle='rgba(196,214,232,.7)';ctx.font='600 9.5px system-ui';
      ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText('船体蓝图',x,y+3);
      ctx.textAlign='right';ctx.fillStyle='rgba(120,138,158,.7)';
      ctx.fillText(M.bounds.w+' × '+M.bounds.h,x+w,y+3);
      /* 蓝图网格 */
      ctx.strokeStyle='rgba(110,140,170,.07)';ctx.lineWidth=.5;
      for(let gx=10;gx<M.bounds.w;gx+=10){
        ctx.beginPath();ctx.moveTo(x+gx*k,my);ctx.lineTo(x+gx*k,my+mh);ctx.stroke();
      }
      for(let gy=10;gy<M.bounds.h;gy+=10){
        ctx.beginPath();ctx.moveTo(x,my+gy*k);ctx.lineTo(x+w,my+gy*k);ctx.stroke();
      }
      /* 通道：先粗后细，像参考图里的浅灰走廊 */
      for(const c of M.corridors){
        ctx.strokeStyle=G.corrLit?'rgba(176,192,208,.42)':'rgba(92,104,118,.30)';
        ctx.lineWidth=Math.max(3,CW*k*.92);ctx.lineCap='butt';ctx.lineJoin='round';
        ctx.beginPath();c.pts.forEach((p,i)=>i?ctx.lineTo(x+p[0]*k,my+p[1]*k):ctx.moveTo(x+p[0]*k,my+p[1]*k));ctx.stroke();
        ctx.strokeStyle=G.corrLit?'rgba(220,234,246,.55)':'rgba(130,142,156,.22)';
        ctx.lineWidth=1;
        ctx.beginPath();c.pts.forEach((p,i)=>i?ctx.lineTo(x+p[0]*k,my+p[1]*k):ctx.moveTo(x+p[0]*k,my+p[1]*k));ctx.stroke();
      }
      /* 房间轮廓：小地图空间有限，用短名 + 描边保证越界也读得清 */
      const SHORT={bridge:'会议室',ecosys:'生态舱',engine:'引擎',power:'配电',transit:'中转',cam:'监控',med:'医疗',armory:'军械',fun:'娱乐'};
      for(const r of M.rooms){
        ctx.beginPath();
        r.poly.forEach((p,i)=>{const px=x+p[0]*k,py=my+p[1]*k; i?ctx.lineTo(px,py):ctx.moveTo(px,py);});
        ctx.closePath();
        const lit=G.lit[r.id];
        ctx.fillStyle=lit?'rgba(198,209,222,.86)':'rgba(48,57,69,.90)';ctx.fill();
        ctx.strokeStyle=lit?'rgba(240,247,255,.75)':'rgba(120,136,154,.55)';
        ctx.lineWidth=lit?1.1:.8;ctx.stroke();
        const lx=x+(r.label?r.label[0]:r.rect[0]+r.rect[2]/2)*k;
        const ly=my+(r.label?r.label[1]:r.rect[1]+r.rect[3]/2)*k;
        const nm=SHORT[r.id]||r.name;
        ctx.font='600 '+Math.max(7,Math.round(k*2.5))+'px system-ui';
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
        ctx.strokeStyle=lit?'rgba(236,243,250,.92)':'rgba(7,12,18,.88)';
        ctx.lineWidth=1.6;ctx.strokeText(nm,lx,ly);
        ctx.fillStyle=lit?'#1D2632':'rgba(190,204,220,.92)';
        ctx.fillText(nm,lx,ly);
      }
      /* 管道 / 设施 / 任务点 */
      for(const q of M.pipes){
        ctx.save();ctx.translate(x+q.x*k,my+q.y*k);ctx.rotate(Math.PI/4);
        ctx.fillStyle='rgba(168,150,255,.9)';ctx.fillRect(-1.8,-1.8,3.6,3.6);ctx.restore();
      }
      for(const f of M.facility){
        ctx.fillStyle=f.kind==='breaker'?'#E0A94B':'#3FBF8C';
        ctx.beginPath();ctx.arc(x+f.x*k,my+f.y*k,1.8,0,7);ctx.fill();
      }
      const mine=G.me.tasks.slice(G.me.tIdx);
      for(const p of M.points){
        const idx=M.points.indexOf(p), isMine=mine.indexOf(idx)>=0;
        const hard=p.kind==='hard';
        if(!isMine){
          ctx.fillStyle=hard?'rgba(224,87,79,.22)':'rgba(77,143,209,.22)';
          ctx.beginPath();ctx.arc(x+p.x*k,my+p.y*k,1.1,0,7);ctx.fill();
          continue;
        }
        ctx.fillStyle=hard?'#E0574F':'#5AA7EE';
        ctx.beginPath();ctx.arc(x+p.x*k,my+p.y*k,2.0,0,7);ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=.8;
        ctx.beginPath();ctx.arc(x+p.x*k,my+p.y*k,2.9,0,7);ctx.stroke();
      }
      /* DEV 可见的其他席位 */
      if(G.dev){
        for(const a of G.agents){
          if(a===G.me)continue;
          const bp=bodyPos(a);
          ctx.fillStyle=!a.alive?'rgba(127,211,240,.65)':(a.alien?'#E0574F':'#DDE3EC');
          ctx.beginPath();ctx.arc(x+(bp?bp[0]:a.x)*k,my+(bp?bp[1]:a.y)*k,1.7,0,7);ctx.fill();
        }
      }
      /* 自己：金色脉冲 */
      const myx=x+G.me.x*k, myy=my+G.me.y*k;
      const pulse=0.45+0.3*(0.5+0.5*Math.sin(T*4.2));
      ctx.strokeStyle='rgba(240,198,116,'+pulse.toFixed(2)+')';ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(myx,myy,5.5,0,7);ctx.stroke();
      ctx.fillStyle=G.me.alive?'#F0C674':'#7FD3F0';
      ctx.beginPath();ctx.arc(myx,myy,2.6,0,7);ctx.fill();
      /* 图例 */
      const ly=y+h-7;
      ctx.font='500 8.5px system-ui';ctx.textAlign='left';ctx.textBaseline='middle';
      let lx=x;
      const dot=(c)=>{ctx.fillStyle=c;ctx.beginPath();ctx.arc(lx,ly,2,0,7);ctx.fill();lx+=6;};
      const label=(t)=>{ctx.fillStyle='rgba(170,184,200,.9)';ctx.fillText(t,lx,ly);lx+=ctx.measureText(t).width+10;};
      dot('#E0574F');label('高难 2分');
      dot('#5AA7EE');label('普通 1分');
      ctx.save();ctx.translate(lx,ly);ctx.rotate(Math.PI/4);ctx.fillStyle='#A896FF';ctx.fillRect(-1.6,-1.6,3.2,3.2);ctx.restore();
      lx+=6;ctx.fillStyle='rgba(170,184,200,.9)';ctx.fillText('管道',lx,ly);
      ctx.restore();
    }

    /* 视野：幽灵/DEV 全知；活人 = 所在亮房 + 7 格手电锥 */
    function visibleAt(x,y){
      if(G.dev||!G.fogOn||!G.me.alive)return true;
      const me=G.me;
      const r=roomAt(me.x,me.y);
      if(r&&G.lit[r.id]&&inPoly(x,y,r.poly)&&los(me.x,me.y,x,y))return true;
      const d=Math.hypot(x-me.x,y-me.y);
      if(d>7)return false;
      if(!los(me.x,me.y,x,y))return false;
      const ang=Math.atan2(y-me.y,x-me.x),aim=Math.atan2(G.aimY-me.y,G.aimX-me.x);
      let dd=Math.abs(ang-aim); if(dd>Math.PI)dd=2*Math.PI-dd;
      return dd<=Math.PI/6;
    }
    function canSee(a){
      if(!G.me.alive||G.dev)return true;
      return visibleAt(a.x,a.y);
    }
    let FOG=null;
    function drawFog(){
      if(!G.fogOn||!G.me.alive||G.dev||G.camMode==='map')return;
      const me=G.me;
      if(!FOG||FOG.width!==cv.width||FOG.height!==cv.height){
        FOG=document.createElement('canvas');FOG.width=cv.width;FOG.height=cv.height;
      }
      const o=FOG.getContext('2d');
      o.setTransform(1,0,0,1,0,0);o.clearRect(0,0,FOG.width,FOG.height);
      o.setTransform(dpr,0,0,dpr,0,0);
      o.fillStyle='rgba(4,6,10,.87)';o.fillRect(0,0,innerWidth,innerHeight);
      o.globalCompositeOperation='destination-out';
      const r=roomAt(me.x,me.y);
      if(r&&G.lit[r.id]){
        o.beginPath();r.poly.forEach((p,i)=>i?o.lineTo(SX(p[0]),SY(p[1])):o.moveTo(SX(p[0]),SY(p[1])));o.closePath();o.fill();
        for(const c of M.corridors){
          if((c.a===r.id||c.b===r.id)&&G.corrLit){
            o.strokeStyle='#000';o.lineWidth=CW*VIEW.s;o.lineCap='butt';
            o.beginPath();c.pts.forEach((p,i)=>i?o.lineTo(SX(p[0]),SY(p[1])):o.moveTo(SX(p[0]),SY(p[1])));o.stroke();
          }
        }
      }
      /* 走廊灯开着时，站在走廊里能看到周围一段 */
      if(!r&&G.corrLit&&inCorr(me.x,me.y)){
        o.beginPath();o.arc(SX(me.x),SY(me.y),4.6*VIEW.s,0,7);o.fill();
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
      ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(FOG,0,0);ctx.restore();
    }
    cv.addEventListener('mousemove',e=>{if(DEAD||!G)return;G.aimX=WX(e.clientX);G.aimY=WY(e.clientY);});
    
    /* ---------------- HUD ---------------- */
    function renderTaskList(){
      const box=document.getElementById('tasks'); if(!box||!G)return;
      const me=G.me, key=me.tIdx+'|'+me.tasks.join(',');
      if(G.taskKey===key)return;
      G.taskKey=key;
      let h='<div class="th">本局任务 · 目标舱室</div>';
      me.tasks.forEach((ti,n)=>{
        const p=M.points[ti]; if(!p)return;
        const done=n<me.tIdx, now=n===me.tIdx;
        h+='<div class="tr '+(p.kind==='hard'?'hard':'normal')+(done?' done':'')+(now?' now':'')+'">'
          +'<span class="no">'+String(n+1).padStart(2,'0')+'</span>'
          +'<span class="tag">'+(p.kind==='hard'?'高难':'普通')+'</span>'
          +'<span class="loc">'+roomNameById(p.room)+'</span>'
          +'<span class="nm">'+p.label+'</span></div>';
      });
      box.innerHTML=h;
    }
    function syncHud(){
      document.getElementById('pg').textContent=G.prog;
      document.getElementById('pgi').style.width=(G.prog/40*100)+'%';
      document.getElementById('tm').textContent=Math.max(0,G.t).toFixed(0);
      document.getElementById('nt').textContent=G.night;
      const alive=G.agents.filter(a=>a.alive).length;
      const hum=G.agents.filter(a=>a.alive&&!a.alien).length;
      const ali=G.agents.filter(a=>a.alive&&a.alien).length;
      document.getElementById('alive').textContent=alive;
      document.getElementById('hum').textContent=hum;
      document.getElementById('ali').textContent=ali;
      document.getElementById('dn').textContent=G.agents.filter(a=>a.downed&&a.alive).length;
      document.getElementById('tk').textContent=G.me.tIdx;
      document.getElementById('ql').textContent=G.me.qual;
      document.getElementById('bl').textContent=G.me.bullet;
      document.getElementById('md').textContent=G.me.medkit;
      const pwr=document.getElementById('pwr');
      if(pwr){
        const off=G.lightState===2;
        pwr.textContent=off?'全船断电':(G.powerFixed?'照明已修复':'照明正常');
        pwr.classList.toggle('off',off);
        pwr.classList.toggle('full',!off&&G.powerFixed);
      }
      renderTaskList();
      const roleEl=document.getElementById('role');
      if(roleEl){
        const txt=(G.me.alien?'异形':'人类')+(!G.me.alive?' · 幽灵':(G.me.downed?' · 濒死':
          (G.me.detained?' · 被擒 '+Math.max(0,Math.ceil(G.me.detainedT||0))+'s':'')));
        if(roleEl.textContent!==txt)roleEl.textContent=txt;
      }
      const tip=document.getElementById('tip');
      if(tip){
        const t=G.pipePick
          ?'地道选择：点击出口按钮或按 1–3 直达 · ESC 取消 · 异形专用'
          :(G.camView
            ?'监控台：E / V / ESC 退出 · 配电室拉闸会切断全部 9 路信号'
            :(!G.me.alive
              ?'幽灵态：点击穿墙移动 · E 维修任务（1.6×）· 不能报告/投票/搜尸 · F2 DEV'
              :(G.me.downed
                ?'你已濒死：等队友 F 施救，或被拖进医疗间 · F2 DEV'
                :(G.me.detained
                  ?'被保安机器人锁住：'+Math.max(0,Math.ceil(G.me.detainedT||0))+' 秒后自动释放 · 不能移动'
                  :'点击地面移动 · E 交互 · V 监控 · R 报告 · F 施救/破坏 · Q 出刀/开枪 · X 搜尸 · G 拖拽 · ESC 暂停 · T 视野 · C 相机 · F2 DEV'))));
        if(tip.textContent!==t)tip.textContent=t;
      }
    }
    document.getElementById('m-send').onclick=()=>{
      const el=document.getElementById('m-text'); if(!el)return;
      const t=el.value.trim(); if(!t)return;
      if(!G.me.alive||G.me.downed){toast('你现在不能发言');return;}
      el.value=''; say(G.me.name,t,true); SND.vote(); playerTalk(t);
    };
    document.getElementById('m-text').addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault(); document.getElementById('m-send').click(); }
      e.stopPropagation();
    });
    document.getElementById('m-skip').onclick=()=>{const m=G.meet;if(!m||m.phase!=='discuss')return;
      if(m.voteT>0) startVote(); else finishMeeting();};
    document.getElementById('e-r').onclick=()=>{newGame();};
    document.getElementById('p-resume').onclick=()=>{if(G.paused)togglePause();};
    document.getElementById('p-restart').onclick=()=>restartGame();
    document.getElementById('p-exit').onclick=()=>exitToMenu();
    document.getElementById('b-close').onclick=()=>closeBodyCard();
    const camClose=document.getElementById('cam-close');
    if(camClose)camClose.onclick=()=>closeCams();
    const pipeCancel=document.getElementById('pipe-cancel');
    if(pipeCancel)pipeCancel.onclick=()=>closePipePick();
    document.getElementById('cam').addEventListener('click',e=>{
      if(e.target&&e.target.id==='cam')closeCams();
    });
    document.getElementById('pipe').addEventListener('click',e=>{
      if(e.target&&e.target.id==='pipe')closePipePick();
    });
    document.getElementById('body').addEventListener('click',e=>{
      if(e.target&&e.target.id==='body')closeBodyCard();
    });

    /* 测试钩子：只读写这一局的状态，不碰 DOM 布局（Playwright 用） */
    global.SKV3._t={
      G:()=>G,
      newGame:()=>newGame(),
      inv:()=>{const r=runInvariants('api');return r?{checks:r.checks,fails:r.fails,all:G.inv.fails}:null;},
      kill:(i,c)=>{const a=G.agents[i];if(!a)return false;return die(a,c||'knife',null);},
      knife:(k,v)=>knife(G.agents[k],G.agents[v]),
      shoot:()=>shoot(),
      tp:(i,x,y)=>{const a=G.agents[i];if(!a)return null;a.path=null;a.x=x;a.y=y;
        if(!a.alive){a.bodyX=x;a.bodyY=y;a.bodyGone=false;a.deathX=x;a.deathY=y;}
        return[a.x,a.y];},
      setDev:v=>{G.dev=!!v;syncDevUi();},
      dev:()=>!!G.dev,
      bodyOf:i=>bodyPos(G.agents[i]),
      dragOf:()=>G.drag,
      inspect:()=>G.inspect?G.inspect.agent.name:null,
      openBody:i=>openBodyCard(G.agents[i]),
      openMeeting:(kind,r,v)=>openMeeting(kind||'night',
        r==null?G.me:G.agents[r],
        v==null?(G.agents.find(a=>bodyPos(a))||null):G.agents[v]),
      closeVote:()=>closeVote(),
      finishMeeting:()=>finishMeeting(),
      aiTick:(i,steps,dt)=>{const a=G.agents[i];if(!a)return null;
        for(let n=0;n<(steps||1);n++)aiHuman(a,dt||0.05);
        return {tIdx:a.tIdx,doing:a.doing,do:a._doing,rest:a._rest,delay:a._delay};},
      aiInfo:i=>{const a=G.agents[i];if(!a)return null;
        return {tIdx:a.tIdx,doing:a.doing,do:a._doing,rest:a._rest,delay:a._delay,
          room:a.nRoom,task:a.nTask,seen:a.nSeen,accuse:a.accuse,lie:a._lie};},
      taskSpot:i=>{const a=G.agents[i];if(!a)return null;
        const p=M.points[a.tasks[a.tIdx]];if(!p)return null;
        const f=nearestFree(p.x,p.y);
        return {x:f[0],y:f[1],label:p.label,dur:p.dur};},
      startVote:()=>startVote(),
      chat:t=>{playerTalk(t);return (G.meet&&G.meet.lines||[]).length;},
      meetLines:()=>G.meet?(G.meet.lines||[]):[],
      roomNames:()=>M.rooms.map(r=>r.name),
      meetCtx:()=>G.meet?{victim:G.meet.ctx.victimInfo,
        claims:(G.meet.ctx.claims||[]).map(c=>({who:c.a.name,room:c.room}))}:null,
      fx:()=>G.fx.map(f=>f.type),
      acts:()=>G.agents.map(a=>a.act&&a.act.kind).filter(Boolean),
      roomName:id=>roomNameById(id),
      assets:()=>({base:ready(IMG['base']),hull:ready(IMG['hull']),
        w:IMG['base']?IMG['base'].naturalWidth:0,h:IMG['base']?IMG['base'].naturalHeight:0,
        hw:IMG['hull']?IMG['hull'].naturalWidth:0,hh:IMG['hull']?IMG['hull'].naturalHeight:0}),
      sfx:()=>SND.debug(),
      playSfx:name=>{const f=SND[name];if(typeof f!=='function')return false;f(1);return true;},
      pause:()=>{togglePause();return {paused:!!G.paused,ui:!document.getElementById('pause').classList.contains('hide')};},
      paused:()=>!!G.paused,
      breaker:()=>{pullBreaker();return {state:G.lightState,corr:G.corrLit};},
      lights:()=>({state:G.lightState,corr:G.corrLit,lit:Object.assign({},G.lit)}),
      cams:()=>({open:!!G.camView,cut:G.lightState===2,room:inCamRoom(G.me),
        near:!!nearMonitor(G.me),feeds:M.rooms.length}),
      openCams:()=>openCams(),
      closeCams:()=>{closeCams(true);return !G.camView;},
      pipe:()=>({open:!!G.pipePick,from:G.pipePick?G.pipePick.from:null,
        fromRoom:G.pipePick?roomNameById(M.pipes[G.pipePick.from].room):null,
        opts:G.pipePick?pipeOpts(M.pipes[G.pipePick.from]).map(o=>({i:o.i,room:o.q.room,name:roomNameById(o.q.room)})):[]}),
      openPipe:()=>openPipePick(),
      pickPipe:i=>pickPipe(i),
      closePipe:()=>{closePipePick(true);return !G.pipePick;},
      pipes:()=>M.pipes.map((q,i)=>({i,x:q.x,y:q.y,room:q.room,name:roomNameById(q.room)})),
      robots:()=>({
        sec:{used:!!G.secbotUsed,dead:!!G.secbotDead,t:G.secbotT||0},
        med:{used:!!G.medbotUsed,dead:!!G.medbotDead,t:G.medbotT||0}}),
      jail:()=>secJail(),
      botTick:(dt)=>{botTick(dt==null?0.2:dt);return {sec:G.secbotUsed,med:G.medbotUsed,
        detained:G.agents.filter(a=>a.detained&&a.alive).map(a=>({i:a.i,t:a.detainedT}))};},
      detained:()=>G.agents.filter(a=>a.detained&&a.alive).map(a=>({i:a.i,name:a.name,t:a.detainedT})),
      waves:()=>G.waves.map(w=>({kind:w.kind,x:w.x,y:w.y,life:w.t,dur:w.dur,str:w.str})),
      hear:(x,y,kind,str)=>{hear(x,y,kind,str);return G.waves.length;},
      sfxLog:()=>SND.log(),
      sfxClear:()=>SND.clearLog(),
      taskDurs:()=>M.points.map(p=>({kind:p.kind,dur:p.dur})),
      lamps:()=>M.corridors.map(c=>corridorLampPos(c).length),
      tags:()=>G.agents.map(a=>tagName(a)),
      taskPlan:()=>G.agents.map(a=>a.tasks.map(ti=>({kind:M.points[ti].kind,room:M.points[ti].room,label:M.points[ti].label}))),
      finishDoing:i=>{finishDoing(G.agents[i]);return {msg:G.msg,prog:G.prog,tIdx:G.agents[i].tIdx};},
      aiScan:(i,dt)=>{const a=G.agents[i];aiScanBodies(a,dt);
        return {t:a._reportT,body:a._reportBody?a._reportBody.i:null,meet:!!G.meet};},
      astar:(sx,sy,tx,ty)=>astar(sx,sy,tx,ty),
      free:(x,y)=>free(x,y),
      stepTo:(x,y)=>{G.me.path=[[x,y]];stepMove(G.me,5,20);return [G.me.x,G.me.y];},
      fog:()=>!!G.fogOn,
      pos:()=>[G.me.x,G.me.y],
      state:()=>G.agents.map(a=>({i:a.i,name:a.name,alien:a.alien,alive:a.alive,ghost:a.ghost,
        downed:a.downed,detained:!!a.detained,detainedT:a.detainedT||0,body:bodyPos(a),cause:a.deathCause,
        room:roomIdAt(a.x,a.y),draggedBy:a.draggedBy,bodyMoved:a.bodyMoved,
        deathRoom:a.deathRoom,killedBy:a.killedBy})),
      invHist:()=>G.inv
    };
    
    resize();newGame();G.aimX=G.me.x+1;G.aimY=G.me.y;
    rafId=requestAnimationFrame(loop);
    return function(){
      DEAD=true;
      cancelAnimationFrame(rafId);
      clearInterval(meetingTick);
      stopChatter();
    };
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
