/* =============================================================
 * 新返航录 · V3 规则模式（批 V3-合流 · 2026-10-28）
 * -------------------------------------------------------------
 * 职责：   把「11 人类 vs 4 异形」的实时规则作为**原游戏内的一个模式**挂载，
 *          不新开页面、不复制游戏本体；由开始页的按钮调用 SKV3.start() 进入。
 * 不变量： · 只定义 window.SKV3，不改动老引擎的任何状态与 DOM；
 *          · 进入时创建一个全屏 #v3-root 覆盖层，退出即整块移除（老游戏原样还在）；
 *          · 素材全部复用 assets/scene/**（cozy 瓦片 + 家具 + 15 套行走图）；
 *          · 地图来自 js/data/map.js（SKMapData），几何/寻路来自 js/engine/geo.js，零 fetch，file:// 也能跑。
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
    ROLE_WANT = (role === 'alien') ? 'alien' : (role === 'spect' ? 'spect' : 'human');
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
        tIdx:0,doing:0,progress:0,qual:0,qualPending:0,_q3:false,_q5:false,bullet:0,medkit:0,
        knife:1,think:0,target:null,
        /* 幽灵 / 尸体 / 拖拽 / 搜查 */
        ghost:false,ghostPts:0,deathCause:null,deathAt:0,deathRoom:null,deathX:null,deathY:null,
        killedBy:null,bodyX:null,bodyY:null,bodyGone:false,bodyMoved:false,
        downX:null,downY:null,downRoom:null,woundCause:null,draggedBy:null,searched:false,
        drag:null,redT:0,_dragSnd:0,_dragAiT:0,_hideSpot:null,_hideRoom:null,_hideCD:0,_hides:0,
        _lightGo:false,_pipePlan:null,_pipeSeeks:0,_secAvoidT:0,_botCD:0,
        _killBody:null,_killAt:0,_killDecided:true,_reportPlan:null,
        /* 表现层：动作 / 工作计时 / 夜间见闻（会议发言要用真实事实） */
        act:null,_rest:0,_delay:2+Math.random()*6,_fxT:0,
        nRoom:null,nSeen:{},nTask:null,nTaskRoom:null,accuse:null,_lie:null,
        _taskPt:null,_reportT:0,_sawBody:null,
        /* 认知层：只记录自己看见/听见/搜查到的事实，不保存身份答案。
           mind 统一由 mindReset() 建，避免两处字面量漂移（known/redSeen 漏字段）。 */
        mind:null
      }));
      for(const a of agents)mindReset(a);
      // 出生：15 人全部在中央会议室，异形混在人群里
      const br=M.rooms.find(r=>r.id==='bridge');
      for(const a of agents){
        const p=randIn(br); a.x=p[0]; a.y=p[1];
      }
      const me=agents[0];
      G={agents,me,night:1,t:NIGHT,prog:0,over:null,overWhy:'',meet:null,
         lit:{},blackout:false,vis:null,fogOn:true,camMode:'follow',fx:[],waves:[],clickFx:null,lightState:0,
         corrLit:true,paused:false,pauseAt:0,taskKey:'',camView:false,pipePick:null,powerFixed:false,
         secbotUsed:false,secbotUses:0,secbotDead:false,medbotUsed:false,medbotDead:false,medbotT:0,secbotT:0,
         medbotLeft:2,botHp:{secbot:2,medbot:1},
         bots:null,jailPos:null,breakerSaboteur:null,
         dmg:[],sabPick:null,sabTarget:null,aiReportUsed:false,evSeq:0,
         drag:null,inspect:null,wheel:null,dev:keepDev,gfx:{coverFlashes:0,dashedBorders:0},
         spectMode:(ROLE_WANT==='spect'),spect:null,
         inv:{runs:0,checks:0,fails:[],warned:{},lastTag:''},invT:0,devT:0};
      G.aimX=me.x+1; G.aimY=me.y;
      if(G.spectMode){
        /* 第 16 人旁观者：不在 15 个席位里，只是一台高速全知的幽灵相机 */
        const p=randIn(br);
        G.spect={x:p[0],y:p[1],path:null,moving:false,dir:'down'};
        G.fogOn=false;
      }
      resetBots();
      G.doors=buildDoors();
      const alienIds=agents.filter(a=>a.alien&&a.i!==0).map(a=>a.i);
      G.breakerSaboteur=alienIds.length?alienIds[Math.floor(Math.random()*alienIds.length)]:null;
      refreshLight();
      document.getElementById('end').classList.add('hide');
      document.getElementById('body').classList.add('hide');
      document.getElementById('cam').classList.add('hide');
      document.getElementById('pipe').classList.add('hide');
      document.getElementById('sabot').classList.add('hide');
      document.getElementById('wheel').classList.add('hide');
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

    /* ---------------- 自动门 ----------------
       每个房间门口一扇：房间 door 数据 + 走廊端点配对。没人时闭合，
       有活人进入 3 格内自动滑开；关门后同时阻挡移动与视线。 */
    const DOOR_OPEN_R=3.0, DOOR_CLOSE_R=3.6, DOOR_SPEED=4.0, DOOR_W=1.8, DOOR_PASS=0.6;
    function buildDoors(){
      const out=[];
      for(const c of M.corridors){
        const ends=[[0,c.a],[c.pts.length-1,c.b]];
        for(const [ei,rid] of ends){
          const r=M.rooms.find(q=>q.id===rid); if(!r)continue;
          const p=c.pts[ei];
          let best=null,bd=1e9;
          for(const d of r.doors){
            const axis=d[0],v=d[1],horiz=(axis==='t'||axis==='b');
            if(horiz){
              const wy=axis==='t'?r.rect[1]:r.rect[1]+r.rect[3];
              if(Math.abs(p[1]-wy)>0.01)continue;
              const dd=Math.abs(v-p[0]);
              if(dd<bd){bd=dd;best=d;}
            }else{
              const wx=axis==='l'?r.rect[0]:r.rect[0]+r.rect[2];
              if(Math.abs(p[0]-wx)>0.01)continue;
              const dd=Math.abs(v-p[1]);
              if(dd<bd){bd=dd;best=d;}
            }
          }
          if(!best)continue;
          const horiz=best[0]==='t'||best[0]==='b';
          const x=horiz?best[1]:(best[0]==='l'?r.rect[0]:r.rect[0]+r.rect[2]);
          const y=horiz?(best[0]==='t'?r.rect[1]:r.rect[1]+r.rect[3]):best[1];
          out.push({id:c.id+':'+rid,x,y,horiz,w:DOOR_W,open:0,target:0,
            x1:horiz?x-DOOR_W/2:x,y1:horiz?y:y-DOOR_W/2,
            x2:horiz?x+DOOR_W/2:x,y2:horiz?y:y+DOOR_W/2});
        }
      }
      return out;
    }
    function doorTick(dt){
      if(!G||!G.doors||G.meet||G.over)return;
      for(const d of G.doors){
        let busy=false;
        /* 关门用更大的半径做滞回，避免站在门口时门反复开合 */
        const range=d.open>0.02?DOOR_CLOSE_R:DOOR_OPEN_R;
        for(const a of G.agents){
          if(!a.alive||a.downed||a.detained)continue;
          if(Math.hypot(a.x-d.x,a.y-d.y)<range){busy=true;break;}
        }
        d.target=busy?1:0;
        const prev=d.open;
        if(d.open<d.target)d.open=Math.min(d.target,d.open+dt*DOOR_SPEED);
        else if(d.open>d.target)d.open=Math.max(d.target,d.open-dt*DOOR_SPEED);
        if((prev<1&&d.open>=1)||(prev>0&&d.open<=0))doorAutoSound(d);
      }
    }
    function doorAutoSound(d){
      if(!G||G.camView||G.over)return;
      /* 门声对附近 AI 始终可听；玩家音量才按距离裁剪 */
      aiHear('door',d.x,d.y,7);
      const dm=Math.hypot(G.me.x-d.x,G.me.y-d.y);
      if(dm>12)return;
      SND.doorAuto(Math.max(0.12,0.5*(1-dm/12)));
    }
    function doorBlockedSegment(x1,y1,x2,y2){
      if(!G||!G.doors)return false;
      for(const d of G.doors){
        if(d.open>DOOR_PASS)continue;
        if(segX([x1,y1],[x2,y2],[d.x1,d.y1],[d.x2,d.y2]))return true;
      }
      return false;
    }
    function losNow(x1,y1,x2,y2){
      if(!los(x1,y1,x2,y2))return false;
      if(!G||!G.doors)return true;
      for(const d of G.doors){
        if(d.open>DOOR_PASS)continue;
        if(segX([x1,y1],[x2,y2],[d.x1,d.y1],[d.x2,d.y2]))return false;
      }
      return true;
    }
    /* 门禁/调试用：检查硬掩体是否留下窄夹缝或掩体制造的尽端死路 */
    function coverAudit(){
      const gaps=[],dead=[];
      const rectGap=(a,b)=>{
        const dx=Math.max(a.x-(b.x+b.w),b.x-(a.x+a.w),0);
        const dy=Math.max(a.y-(b.y+b.h),b.y-(a.y+a.h),0);
        return Math.hypot(dx,dy);
      };
      for(let i=0;i<M.cover.length;i++)for(let j=i+1;j<M.cover.length;j++){
        const a=M.cover[i],b=M.cover[j]; if(a.room!==b.room)continue;
        const g=rectGap(a,b);
        if(g>0&&g<1.2)gaps.push({room:a.room,a:a.label,b:b.label,gap:+g.toFixed(2)});
      }
      const wallGap=(c,w)=>{
        const pts=[[c.x,c.y],[c.x+c.w,c.y],[c.x+c.w,c.y+c.h],[c.x,c.y+c.h]];
        let best=1e9;
        for(const p of pts)best=Math.min(best,d2seg(p[0],p[1],w[0][0],w[0][1],w[1][0],w[1][1]));
        for(const p of w){
          const dx=Math.max(c.x-p[0],p[0]-(c.x+c.w),0);
          const dy=Math.max(c.y-p[1],p[1]-(c.y+c.h),0);
          best=Math.min(best,Math.hypot(dx,dy));
        }
        return best;
      };
      for(const c of M.cover)for(const w of M.walls){
        const g=wallGap(c,w);
        if(g>0.2&&g<1.2)gaps.push({room:c.room,cover:c.label,wall:true,gap:+g.toFixed(2)});
      }
      const nearCover=(x,y)=>M.cover.some(c=>x>=c.x-.75&&x<=c.x+c.w+.75&&y>=c.y-.75&&y<=c.y+c.h+.75);
      for(let gy=1;gy<GH-1;gy++)for(let gx=1;gx<GW-1;gx++){
        const x=(gx+.5)*GS,y=(gy+.5)*GS;
        if(!free(x,y))continue;
        const room=roomAt(x,y); if(!room)continue;
        let nb=0;
        if(free(x+GS,y))nb++; if(free(x-GS,y))nb++;
        if(free(x,y+GS))nb++; if(free(x,y-GS))nb++;
        if(nb<=1&&nearCover(x,y))dead.push({room:room.id,x:+x.toFixed(1),y:+y.toFixed(1),nb});
      }
      return {gaps,dead};
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
        out.push('<div class="dr'+(a.alien?' al':'')+((a===G.me&&!G.spectMode)?' me':'')+(!a.alive?' dead':'')+'">'
          +'<b>'+a.name+(a===G.me?'（你）':'')+'</b><span>'+(a.alien?'异形':'人类')+'</span>'
          +'<i>'+st+' · '+where
          +(a.alien?' · 刀 '+a.knife+(a.bullet?' · 弹':'')+'':'')
          +(a.detained?' · 被保安锁住':'')
          +(a.draggedBy!=null?' · 被拖':'')
          +(a.drag!=null?' · 拖尸':'')
          +'</i></div>');
      }
      box.innerHTML=out.join('');
    }
    function syncDevUi(){
      const on=!!(G&&(G.dev||G.spectMode));
      const dev=document.getElementById('dev');
      if(dev)dev.classList.toggle('hide',!on);
      const dl=document.getElementById('devline');
      if(dl){
        dl.classList.toggle('hide',!on);
        dl.innerHTML=G&&G.spectMode?'旁观者 · <b>全知总览</b> · 断言 <b id="inv">0</b> 失败'
          :'DEV <b>无敌 · 全知</b> · 断言 <b id="inv">0</b> 失败';
      }
      const dt=dev&&dev.querySelector('.dt');
      if(dt)dt.textContent=G&&G.spectMode?'旁观者 · 全知总览（不参与对局）':'DEV · 全知总览';
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
    function pullBreaker(actor){
      G.lightState=(G.lightState===2?(G.powerFixed?1:0):2);
      refreshLight(); SND.breaker(); pulseHud('pwr');
      const br=M.facility.find(f=>f.kind==='breaker');
      if(br){
        G.fx.push({type:'power',x:br.x,y:br.y,t:1.0,dur:1.0,on:G.lightState!==2});
        hear(br.x,br.y,'power',1.1);
        noticeAction(actor,br.x,br.y,6,'breaker');
        aiHear('power',br.x,br.y,30,{actor:actor});
        envNotice('lights',br.x,br.y,G.lightState===2?0.85:0.45);
      }
      toast(G.lightState===2
        ?'电闸已拉下：全船变暗 · 走廊灯全熄 · 监控信号中断'
        :(G.powerFixed?'电闸已合上：配电已修复，全船照明恢复':'电闸已合上：房间与走廊灯光恢复'));
    }
    /* 单机暂停：冻结 update 与 SKClock（恢复时整体平移相位时间），会议/搜尸中不可暂停 */
    function togglePause(){
      if(!G||G.over||G.meet||G.inspect||G.camView||G.pipePick||G.sabPick)return;
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
    /* 场上所有活人（玩家 / AI 人类 / AI 异形）共用同一移动速度；
       拖拽尸体与幽灵态是明确的例外，速度单独写在调用处。 */
    const MOVE_SPEED=5;
    /* 拖拽统一降速到 3.0；AI 与玩家共用同一入口，避免出现“AI 拖着尸体跑得比人快” */
    const DRAG_SPEED=3.0;
    function moveSpeed(a){ return a&&a.drag!=null?DRAG_SPEED:MOVE_SPEED; }
    function walkTo(a,x,y){ a._stuckT=0; a.path=astar(a.x,a.y,x,y); }
    /* 旁观者相机：不在对局里，直线穿墙、9 格/秒，不参与任何碰撞与判定 */
    const SPECT_SPEED=9;
    function stepSpect(dt){
      const sp=G&&G.spect; if(!sp)return;
      if(!sp.path||!sp.path.length){sp.moving=false;return;}
      sp.moving=true;
      let left=SPECT_SPEED*dt;
      while(left>0&&sp.path.length){
        const p=sp.path[0],dx=p[0]-sp.x,dy=p[1]-sp.y,d=Math.hypot(dx,dy);
        if(d<0.05){sp.path.shift();continue;}
        if(Math.abs(dx)>Math.abs(dy))sp.dir=dx>0?'right':'left';else sp.dir=dy>0?'down':'up';
        if(d<=left){sp.x=p[0];sp.y=p[1];left-=d;sp.path.shift();}
        else{sp.x+=dx/d*left;sp.y+=dy/d*left;left=0;}
      }
      sp.moving=!!(sp.path&&sp.path.length);
    }
    function camFocus(){ return (G&&G.spectMode&&G.spect)?G.spect:G.me; }
    function stepMove(a,dt,sp){
      if(a.detained){a.moving=false;return true;}
      if(!a.path||!a.path.length){a.moving=false;return true;}
      a.moving=true;
      const ox=a.x, oy=a.y;
      let left=sp*dt;
      while(left>0&&a.path.length){
        const p=a.path[0],dx=p[0]-a.x,dy=p[1]-a.y,d=Math.hypot(dx,dy);
        if(d<0.02){a.path.shift();continue;}
        if(Math.abs(dx)>Math.abs(dy)) a.dir=dx>0?'right':'left'; else a.dir=dy>0?'down':'up';
        if(d<=left){
          if(!(a.ghost&&!a.alive)&&doorBlockedSegment(a.x,a.y,p[0],p[1])){a.moving=false;return false;}
          a.x=p[0];a.y=p[1];left-=d;a.path.shift();
        }
        else{
          const nx=a.x+dx/d*left, ny=a.y+dy/d*left;
          if(!(a.ghost&&!a.alive)&&doorBlockedSegment(a.x,a.y,nx,ny)){a.moving=false;return false;}
          a.x=nx;a.y=ny;left=0;
        }
      }
      /* 围墙兜底：活人永远留在船体可行走面内；幽灵才允许穿墙 */
      if(!(a.ghost&&!a.alive)&&!free(a.x,a.y)){
        const f=nearestFree(a.x,a.y); a.x=f[0]; a.y=f[1];
      }
      /* 拐角卡死兜底：路径还在但连续 0.7 秒没有位移 ⇒ 从最近可走点重寻路 */
      if(!(a.ghost&&!a.alive)&&a.path&&a.path.length){
        if(Math.hypot(a.x-ox,a.y-oy)<0.004)a._stuckT=(a._stuckT||0)+dt;
        else a._stuckT=0;
        if(a._stuckT>0.7){
          const dest=a.path[a.path.length-1];
          const f=nearestFree(a.x,a.y);
          a.x=f[0];a.y=f[1];
          a._stuckT=0;
          a.path=astar(a.x,a.y,dest[0],dest[1]);
        }
      }else a._stuckT=0;
      /* 脚步：按实际走过的距离触发，近处才响 */
      const moved=sp*dt;
      a._stepAcc=(a._stepAcc||0)+moved;
      if(a._stepAcc>=0.78){
        a._stepAcc=0;
        const dme=Math.hypot(a.x-G.me.x,a.y-G.me.y);
        if(dme<6&&(a===G.me||visibleAt(a.x,a.y))) SND.step(a===G.me?0.5:Math.max(0.05,0.28*(1-dme/6)));
        /* 声纹：别人的脚步即使被墙挡住也能听见方向（近处才画） */
        if(a!==G.me&&dme<14) hear(a.x,a.y,'step',Math.max(0.18,0.7*(1-dme/14)));
      }
      a.moving=!!(a.path&&a.path.length);
      if(a.doing>0&&Math.hypot(a.x-ox,a.y-oy)>0.002)a._moveHit=true;
      if(a.drag!=null)syncDragOf(a);
      return !a.moving;
    }
    
    /* ---------------- 交互 ---------------- */
    function nearPipe(a){
      let best=null,bd=1.6;
      for(const q of M.pipes){ const d=Math.hypot(q.x-a.x,q.y-a.y); if(d<bd){bd=d;best=q;} }
      return best;
    }
    function pipeOpts(from){ return M.pipes.map((q,i)=>({q,i})).filter(o=>o.q!==from); }
    function openPipePick(from){
      if(!G||G.meet||G.over||G.inspect||G.camView||G.sabPick)return false;
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
      const from=M.pipes[pp.from];
      const me=G.me;
      if(!me.alien)return false;
      if(me.drag!=null)releaseDragBy(me,true);
      me.x=to.x;me.y=to.y;me.path=null;me.moving=false;me._stepAcc=0;
      G.pipePick=null;
      document.getElementById('pipe').classList.add('hide');
      G.fx.push({type:'pipefx',x:to.x,y:to.y,t:0.8,dur:0.8});
      SND.pipe(); hear(to.x,to.y,'pipe',1.1);
      if(from)witnessAlienAction(me,from.x,from.y,6,'pipe');
      witnessAlienAction(me,to.x,to.y,6,'pipe');
      aiHear('pipe',to.x,to.y,12,{actor:me});
      toast('穿管道 → '+roomNameById(to.room));
      runInvariants('pipe');
      return true;
    }
    function camMonitor(){ return M.facility.find(f=>f.kind==='monitor'); }
    /* 物资申请单：中央会议室圆桌领取；军械库/医疗间各有专用补给点 */
    function roundTableCover(){
      return M.cover.find(c=>c.room==='bridge'&&c.label==='圆桌')||null;
    }
    function roundTableClaimSpot(){
      const t=roundTableCover(); if(!t)return null;
      return {x:t.x+t.w/2,y:t.y+t.h+1.2,label:'圆桌 · 物资申请单'};
    }
    function nearRoundTable(a){
      const t=roundTableCover(); if(!t)return null;
      const dx=Math.max(t.x-a.x,0,a.x-(t.x+t.w));
      const dy=Math.max(t.y-a.y,0,a.y-(t.y+t.h));
      return Math.hypot(dx,dy)<1.7?t:null;
    }
    function supplyPoints(){ return M.facility.filter(f=>f.kind==='supply'); }
    function nearSupply(a){
      let best=null,bd=1.7;
      for(const q of supplyPoints()){
        const d=Math.hypot(q.x-a.x,q.y-a.y);
        if(d<bd){bd=d;best=q;}
      }
      return best;
    }
    function supplyTargetFor(a){
      if(!a||!a.qual||a.qual<1)return null;
      if(a.bullet<1&&a.suspect!=null)return 'ammo';
      if(a.medkit<1&&G.agents.some(v=>v!==a&&v.alive&&v.downed))return 'med';
      return null;
    }
    function qualDesk(){ return roundTableClaimSpot(); }
    function nearMonitor(a){
      const m=camMonitor();
      return (m&&Math.hypot(m.x-a.x,m.y-a.y)<1.8)?m:null;
    }
    function inCamRoom(a){const r=roomAt(a.x,a.y);return !!(r&&r.id==='cam');}
    function openCams(){
      if(!G||G.over||G.meet||G.inspect||G.pipePick||G.sabPick)return false;
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

    /* ---------------- 异形破坏 / 故障维修 ----------------
       每个异形每晚一次破坏技：选一个非会议室舱室，抵达后损毁该舱室的设备。
       故障 60 秒内没人连续修满 10 秒就扣 3 点维修进度；天亮前没修完不追罚。
       幽灵不能破坏（但可以参与维修），破坏必须在活着的异形手里。 */
    const SAB_TIME=60, FIX_TIME=10, SAB_RANGE=1.7, FIX_RANGE=2.0;
    function dmgOfRoom(rid){ return G.dmg.find(d=>d.room===rid)||null; }
    function sabRoomOk(rid){
      return !!rid&&rid!=='bridge'&&M.rooms.some(r=>r.id===rid)&&!dmgOfRoom(rid);
    }
    /* 破坏落点取该舱室的高难任务点（没有就退普通点，再没有就房间中心），
       这样被损毁的“物品”有名字，维修也落在人本来就会去的地方 */
    function sabSpot(rid){
      const ps=M.points.filter(p=>p.room===rid);
      const p=ps.find(q=>q.kind==='hard')||ps[0];
      if(p){const f=nearestFree(p.x,p.y);return{room:rid,x:f[0],y:f[1],label:p.label};}
      const r=M.rooms.find(q=>q.id===rid);
      if(!r)return null;
      const f=nearestFree(r.rect[0]+r.rect[2]/2,r.rect[1]+r.rect[3]/2);
      return{room:rid,x:f[0],y:f[1],label:r.name+'设备'};
    }
    function nearDmg(a,maxD){
      let best=null,bd=maxD==null?FIX_RANGE:maxD;
      for(const d of G.dmg){
        const dd=Math.hypot(d.x-a.x,d.y-a.y);
        if(dd<bd){bd=dd;best=d;}
      }
      return best;
    }
    function openSabPick(){
      if(!G||G.over||G.meet||G.inspect||G.camView||G.pipePick)return false;
      const me=G.me;
      if(!me.alive||me.downed||me.detained){toast('当前状态无法破坏');return false;}
      if(!me.alien){toast('你做不到');return false;}
      if(me.sabUsed){toast('今晚已经破坏过了');return false;}
      const rooms=M.rooms.filter(r=>sabRoomOk(r.id));
      if(!rooms.length){toast('已经没有可破坏的舱室');return false;}
      G.sabPick={rooms:rooms.map(r=>r.id)};
      me.path=null;me.moving=false;me.doing=0;me._doing=null;
      const box=document.getElementById('sabot-list');
      box.innerHTML=rooms.map((r,n)=>{
        const sp=sabSpot(r.id),d=sp?Math.hypot(sp.x-me.x,sp.y-me.y):0;
        return '<button data-room="'+r.id+'"><span class="pn">'+(n+1)+'</span>'
          +'<span class="pr">'+r.name+'</span><span class="pd">'+d.toFixed(0)+' 格</span></button>';
      }).join('');
      [...box.children].forEach(btn=>{btn.onclick=()=>pickSabRoom(btn.dataset.room);});
      const sub=document.getElementById('sabot-sub');
      if(sub)sub.textContent='每夜一次 · 抵达目标舱室后损毁设备 · 60 秒内未修复则维修进度 -3';
      document.getElementById('sabot').classList.remove('hide');
      SND.interact();
      return true;
    }
    function closeSabPick(silent){
      if(G)G.sabPick=null;
      const el=document.getElementById('sabot'); if(el)el.classList.add('hide');
      if(!silent)toast('已取消');
    }
    function pickSabRoom(rid){
      if(!G||!G.sabPick||!sabRoomOk(rid))return false;
      const sp=sabSpot(rid); if(!sp)return false;
      G.sabTarget=sp; G.sabPick=null;
      const el=document.getElementById('sabot'); if(el)el.classList.add('hide');
      const d=Math.hypot(sp.x-G.me.x,sp.y-G.me.y);
      toast('破坏目标：'+roomNameById(rid)+'「'+sp.label+'」· 进入舱室自动下手 · '+d.toFixed(0)+' 格');
      SND.interact();
      return true;
    }
    function damageRoom(a,rid){
      if(!a||!a.alive||a.downed||!a.alien||a.sabUsed)return false;
      if(!sabRoomOk(rid))return false;
      const sp=sabSpot(rid); if(!sp)return false;
      G.dmg.push({room:rid,x:sp.x,y:sp.y,label:sp.label,left:SAB_TIME,dur:SAB_TIME,by:a.i});
      a.sabUsed=true;a.sabRoom=null;a.target=null;a.path=null;
      if(a===G.me)G.sabTarget=null;
      G.fx.push({type:'spark',x:sp.x,y:sp.y,t:1.6,dur:1.6});
      G.fx.push({type:'alarm',x:sp.x,y:sp.y,t:1.3,dur:1.3});
      hear(sp.x,sp.y,'power',1.0);
      SND.sabotage();
      witnessAlienAction(a,a.x,a.y,6,'sabotage');
      aiHear('sabotage',sp.x,sp.y,20,{actor:a});
      envNotice('fault',sp.x,sp.y,0.55);
      toast('警报：'+roomNameById(rid)+'「'+sp.label+'」被损毁 · 60 秒内修复，否则维修进度 -3');
      runInvariants('damageRoom');
      return true;
    }
    function startFix(a,d){
      if(!a||!d||G.dmg.indexOf(d)<0)return false;
      if(!a.alive&&!a.ghost)return false;
      const dur=a.ghost?FIX_TIME*1.6:FIX_TIME;
      a.doing=dur;a._dur=dur;a._doing='fix';a._fix=d;
      a.path=null;a.moving=false;a._fixGo=null;
      if(a===G.me){toast((a.ghost?'幽灵维修故障「':'维修故障「')+d.label+'」· 连续 '+dur.toFixed(dur%1?1:0)+' 秒 · 移动会中断');SND.interact();}
      return true;
    }
    function finishFix(a){
      const d=a._fix;
      a._fix=null;a._doing=null;a.doing=0;
      if(!d||G.dmg.indexOf(d)<0)return;
      G.dmg.splice(G.dmg.indexOf(d),1);
      /* 同一座故障可能有好几个人在赶/在修：修好的一瞬间全部松手，
         不用把剩下的 10 秒站完，也别再往已经修好的设备跑。 */
      for(const x of G.agents){
        if(x===a)continue;
        if(x._doing==='fix'&&x._fix===d){
          x._doing=null;x._fix=null;x.doing=0;x.path=null;x.moving=false;
          if(x===G.me)toast('故障已被队友修好，停止维修');
        }
        if(x._fixGo===d)x._fixGo=null;
      }
      G.fx.push({type:'heal',x:d.x,y:d.y,t:1.2,dur:1.2});
      G.fx.push({type:'done',x:a.x,y:a.y,t:1.0,dur:1.0});
      if(a===G.me)toast('故障已修复：'+roomNameById(d.room)+'「'+d.label+'」');
      SND.done();
      runInvariants('finishFix');
    }
    /* 连续维修：所有站桩动作一旦移动就打断；计时到 0 才结算 */
    const STAND_ACT={task:'维修任务',fix:'故障维修',breaker:'拉闸',med:'取医疗包',ammo:'取子弹',revive:'施救',search:'搜查',qual:'领取物资申请单'};
    function tickDoing(a,dt){
      if(!(a.doing>0)){a._standDoing=null;a._moveHit=false;return;}
      if(a._standDoing!==a._doing){a._standDoing=a._doing;a._moveHit=false;}
      /* 真实位移（含一帧内走完整条短路径）或仍在沿路径移动都算打断 */
      if(a._moveHit||(a.moving&&a.path&&a.path.length)){
        const label=STAND_ACT[a._doing]||'动作';
        a.doing=0;a._doing=null;a._fix=null;a._rv=null;a._sv=null;a._standDoing=null;a._moveHit=false;
        a._taskPt=null;
        if(a===G.me)toast('移动打断了'+label);
        return;
      }
      a.doing-=dt;
      if(a.doing<=0)finishDoing(a);
    }
    function dmgTick(dt){
      if(!G.dmg.length)return;
      for(let i=G.dmg.length-1;i>=0;i--){
        const d=G.dmg[i];
        d.left-=dt;
        if(d.left>0)continue;
        /* 天亮后不再追罚：dawn 会清掉剩余故障，这一夜算白干但不扣分 */
        if(G.t>0.05){
          G.prog=Math.max(0,G.prog-3);
          G.fx.push({type:'alarm',x:d.x,y:d.y,t:1.4,dur:1.4});
          G.fx.push({type:'spark',x:d.x,y:d.y,t:1.0,dur:1.0});
          hear(d.x,d.y,'power',1.0);
          toast('故障未修复：'+roomNameById(d.room)+'「'+d.label+'」· 维修进度 -3');
          runInvariants('faultPenalty');
        }
        G.dmg.splice(i,1);
        for(const a of G.agents){
          if(a._doing==='fix'&&a._fix===d){a._doing=null;a._fix=null;a.doing=0;}
        }
      }
    }
    /* 玩家异形的目标引爆：进入目标舱室即可，不要求踩准某个点 */
    function sabTick(){
      const me=G.me;
      if(G.t<=0||!me.alien||!me.alive||me.downed||me.detained||me.sabUsed)return;
      const t=G.sabTarget;
      if(!t)return;
      if(!sabRoomOk(t.room)){G.sabTarget=null;return;}
      if(roomIdAt(me.x,me.y)===t.room||Math.hypot(me.x-t.x,me.y-t.y)<SAB_RANGE)
        damageRoom(me,t.room);
    }
    
    /* 夜间见闻：只记录真的进过的房间和视距内看见的人。
       会议发言全部从这些事实里生成，才不会前言不搭后语。 */
    function trackNight(a){
      const rid=roomIdAt(a.x,a.y);
      if(rid!=='corridor'&&rid!=='unknown')a.nRoom=rid;
      if(!a.nSeen)a.nSeen={};
      if(!a.mind)mindReset(a);
      const scanR=a.alien?8:5.5;
      for(const w of G.agents){
        if(w===a||!w.alive||w.downed)continue;
        if(Math.hypot(w.x-a.x,w.y-a.y)>scanR)continue;
        if(aiCanSee(a,w.x,w.y,scanR)){
          a.nSeen[w.i]=(a.nSeen[w.i]||0)+1;
          /* 目击时间线：同一个人每 3.5 秒最多记一条，供尸体关联与会议对质 */
          const last=a.mind.seenT[w.i]||-99;
          if(evNow()-last>=3.5){
            a.mind.seenT[w.i]=evNow();
            evPush(a,{kind:'saw_agent',x:w.x,y:w.y,room:roomIdAt(w.x,w.y),subj:w.i,conf:0.8,src:'sight'});
          }
          /* 刀者红身：只有刚出刀的人会红 3 秒；人类没有刀，所以看到红光 = 确证异形。
             同一个人的一次红身只记一条，避免 3 秒里刷满记忆。 */
          if(!a.alien&&w.redT>0){
            const lastRed=a.mind.redSeen[w.i]||-99;
            if(evNow()-lastRed>5){
              a.mind.redSeen[w.i]=evNow();
              const ev={kind:'saw_red',x:w.x,y:w.y,room:roomIdAt(w.x,w.y),subj:w.i,
                conf:0.9,src:'sight'};
              evPush(a,ev);
              susAdd(a,w.i,EV_W.saw_red,'saw_red',ev);
              a.mind.known[w.i]={t:ev.t,kind:'saw_red',room:ev.room,conf:0.9};
              a.mind.sus[w.i]=1;
              a.suspect=w.i;
            }
          }
        }
      }
    }

    /* ---------------- AI 认知层（感知 / 记忆 / 推理） ----------------
       所有判断只来自 AI 自己看见、听见或搜查到的事实；不读取 alien 身份。
       证据 → 嫌疑分 → 行为（报告 / 开枪 / 投票）与会议语料。 */
    const MEM_MAX=64;
    const EV_W={saw_knife:0.75,saw_shot:0.55,saw_pipe:0.7,saw_sabotage:0.65,
      saw_bot:0.6,saw_breaker:0.32,saw_drag:0.22,saw_detain:0.6,saw_red:0.85,
      heard_knife:0.18,heard_shot:0.16,heard_scream:0.22,heard_power:0.14,
      heard_robot:0.12,heard_pipe:0.2,heard_door:0.04,heard_detain:0.6,heard_drag:0.12,
      env_lights:0.1,env_fault:0.12,env_robot:0.14};
    function evNow(){ return Math.max(0,NIGHT-(G?G.t:0)); }
    function mindReset(a){
      if(!a)return;
      /* known 是**长期记忆**：亲眼确认的身份结论不随夜晚清空，
         后续每一场会议都会继续指控并投这个人（见 bestKnownTarget / startVote）。 */
      const keepKnown=(a.mind&&a.mind.known)||{};
      a.mind={mem:[],sus:{},why:{},alert:0,noise:null,seenBy:{},seenT:{},
        lastBody:null,tone:(a.i||0)%3,
        /* known：亲眼确认「这个人就是异形」（钻管道 / 出刀 / 破坏 / 停摆机器人 /
           身上带着刚出刀的红光）。不是嫌疑分，是不再动摇的身份结论。 */
        known:keepKnown,redSeen:{}};
    }
    function evPush(a,ev){
      if(!a||!G)return;
      if(!a.mind)mindReset(a);
      ev.t=ev.t==null?evNow():ev.t;
      ev.night=G.night;
      ev.id=(G.evSeq=(G.evSeq||0)+1);
      a.mind.mem.push(ev);
      if(a.mind.mem.length>MEM_MAX)a.mind.mem.shift();
      if(ev.conf>0.25&&(String(ev.kind).indexOf('heard_')===0||
        ev.kind==='env_lights'||ev.kind==='env_fault'||ev.kind==='env_robot')){
        a.mind.alert=Math.min(1,a.mind.alert+ev.conf*0.35);
        a.mind.noise={x:ev.x,y:ev.y,t:ev.t,kind:ev.kind};
      }
    }
    function susAdd(a,i,w,reason,ev){
      if(!a||i==null||i===a.i||!G)return;
      if(!a.mind)mindReset(a);
      const old=a.mind.sus[i]||0;
      const gain=w*(1-old*0.55);
      a.mind.sus[i]=Math.min(1,old+gain);
      const arr=a.mind.why[i]||(a.mind.why[i]=[]);
      arr.push({w:+gain.toFixed(3),reason:reason||'',kind:ev?ev.kind:'',
        t:ev?ev.t:evNow(),x:ev&&ev.x!=null?ev.x:null,y:ev&&ev.y!=null?ev.y:null,
        room:ev?ev.room:null});
      if(arr.length>8)arr.shift();
    }
    function topSus(a,min){
      if(!a||!a.mind)return null;
      let best=null,bi=null;
      for(const k in a.mind.sus){
        const i=+k,s=a.mind.sus[k];
        if(s<(min==null?0.5:min))continue;
        if(best==null||s>best){best=s;bi=i;}
      }
      return bi==null?null:{i:bi,score:best,why:(a.mind.why[bi]||[]).slice(-4)};
    }
    function liveTarget(i,self){const t=G.agents[i];return t&&t!==self&&t.alive&&!t.downed?t:null;}
    function bestSusTarget(a,min){
      const s=topSus(a,min); if(!s)return null;
      return liveTarget(s.i,a)?s:null;
    }
    /* 确证目标：亲眼见过异形专属行为的人，不再靠嫌疑分猜。
       返回 {i,score,why,known}，known 里带确证类型（saw_pipe / saw_knife / saw_red…）。 */
    function bestKnownTarget(a){
      if(!a||!a.mind||!a.mind.known)return null;
      let best=null,bt=-1;
      for(const k in a.mind.known){
        const i=+k, t=a.mind.known[k];
        if(!liveTarget(i,a))continue;
        if((t.t||0)>bt){bt=t.t||0;best={i,score:1,known:t,
          why:(a.mind.why[i]||[]).slice(-4)};}
      }
      return best;
    }
    function evidenceReason(a,i){
      const why=(a.mind&&a.mind.why[i])||[];
      return why.length?why[why.length-1]:null;
    }
    /* 视野：人类 = 亮房照明 + 7 格手电锥 + 近身 4.2 格；
       异形拿同一只手电（同样的锥形与距离），只有自带近身视野 ×4/3 ≈ 5.6 格。
       异形不再有 360° 远视野，AI 的视距上限也与人类统一。 */
    const ALIEN_INNATE_MUL=4/3;                 /* 异形自带近身视野 = 人类 ×4/3（唯一调参点） */
    const HUMAN_LIGHT_R=7, HUMAN_DARK_R=4.2;
    const ALIEN_DARK_R=HUMAN_DARK_R*ALIEN_INNATE_MUL;     /* ≈5.6 格 */
    function aiCanSee(a,x,y,maxD){
      if(!a)return false;
      const d=Math.hypot(a.x-x,a.y-y);
      const cap=maxD==null?8:maxD;
      if(d>cap)return false;
      if(!losNow(a.x,a.y,x,y))return false;
      const tr=roomAt(x,y);
      if(tr&&G.lit[tr.id])return true;
      if(G.lightState===1)return true;
      const ar=roomAt(a.x,a.y);
      if(ar&&G.lit[ar.id])return true;
      if(!ar&&inCorr(a.x,a.y)&&G.corrLit)return true;
      return d<=(a.alien?ALIEN_DARK_R:HUMAN_DARK_R);
    }
    function aiHear(kind,x,y,rad,extra){
      if(!G||G.over||G.meet)return;
      extra=extra||{};
      for(const a of G.agents){
        if(!a.alive||a.downed||a.detained)continue;
        if(extra.actor===a)continue;
        const d=Math.hypot(a.x-x,a.y-y);
        if(d>rad)continue;
        const los=losNow(a.x,a.y,x,y);
        const conf=Math.max(0.12,1-d/rad)*(los?1:0.72);
        const vid=extra.victim==null?null:
          (typeof extra.victim==='object'?extra.victim.i:extra.victim);
        const ev={kind:'heard_'+kind,x,y,room:roomIdAt(x,y),
          subj:extra.subj!=null?extra.subj:null,
          victim:vid,
          conf:+conf.toFixed(2),src:'sound'};
        evPush(a,ev);
        const w=EV_W['heard_'+kind];
        if(w&&extra.subj!=null)susAdd(a,extra.subj,w*conf,'heard_'+kind,ev);
      }
    }
    function envNotice(kind,x,y,conf){
      if(!G||G.over)return;
      for(const a of G.agents){
        if(!a.alive||a.downed||a.detained)continue;
        evPush(a,{kind:'env_'+kind,x,y,room:roomIdAt(x,y),
          conf:conf==null?0.5:conf,src:'env'});
      }
    }
    /* 视觉目击：保留旧的 suspect 契约，同时写入证据与嫌疑分。
       异形不作为目击者写入，避免借证人表反推队友身份。 */
    function noticeAction(actor,x,y,rad,kind,victim){
      if(!G||!actor)return;
      const alienAct=!!actor.alien&&(kind==='knife'||kind==='pipe'||
        kind==='sabotage'||kind==='bot');
      const wt=EV_W['saw_'+kind]||0.2;
      for(const w of G.agents){
        if(w===actor||!w.alive||w.downed||w.detained)continue;
        if(w.alien)continue;
        if(Math.hypot(w.x-x,w.y-y)>rad)continue;
        if(!aiCanSee(w,x,y,rad))continue;
        const ev={kind:'saw_'+kind,x,y,room:roomIdAt(x,y),subj:actor.i,
          victim:victim?victim.i:null,conf:0.95,src:'sight'};
        evPush(w,ev);
        susAdd(w,actor.i,wt,'saw_'+kind,ev);
        if(alienAct||kind==='shot'||kind==='detain')w.suspect=actor.i;
        /* 异形专属行为（出刀 / 钻管道 / 破坏设备 / 停摆机器人）是身份级证据：
           直接看见就等于确证，不再只是加一点嫌疑分。开枪与拘留人类也会做，不算确证。 */
        if(alienAct){
          w.mind.known[actor.i]={t:ev.t,kind:'saw_'+kind,room:ev.room,conf:0.95};
          w.mind.sus[actor.i]=1;
          w.mind.why[actor.i]=(w.mind.why[actor.i]||[]).concat([{
            w:1,reason:'确证异形',kind:'saw_'+kind,t:ev.t,x,y,room:ev.room}]).slice(-8);
        }
      }
      /* 异形自己知道谁在视线里看见了它；这是现场感知，不是读取对方内心 */
      if(actor.alien){
        if(!actor.mind)mindReset(actor);
        for(const w of G.agents){
          if(w===actor||w.alien||!w.alive||w.downed)continue;
          if(Math.hypot(w.x-x,w.y-y)>rad)continue;
          if(!aiCanSee(actor,x,y,rad)||!aiCanSee(w,x,y,rad))continue;
          actor.mind.seenBy[w.i]={t:evNow(),conf:0.9};
        }
      }
    }
    function witnessAlienAction(actor,x,y,rad,kind,victim){
      if(!actor||!actor.alien||!G)return;
      noticeAction(actor,x,y,rad,kind||'alien',victim);
    }
    function bodyWound(b){
      if(!b)return '未知';
      if(b.alive&&b.downed)
        return b.woundCause==='shot'?'枪伤 · 仍在渗血':
          (b.woundCause==='knife'?'刀伤 · 仍在渗血':'重伤 · 仍在渗血');
      if(!b.alive)return causeName(b.deathCause);
      return '无伤';
    }
    /* ---------------- 搜尸 = 检查伤口 + 取走尸体身上的物资 ----------------
       尸体保留生前没花掉的子弹 / 医疗包 / 申请单；搜一次把能带走的都带走，
       背包满了就留在尸体上，下一个人还能再来搜（见 bodyHasLoot）。 */
    function bodyHasLoot(b){
      if(!b)return false;
      return (b.bullet|0)>0||(b.medkit|0)>0||(b.qual|0)>0;
    }
    function lootBody(a,b){
      if(!a||!b)return {bullet:0,medkit:0,qual:0,none:true};
      const got={bullet:0,medkit:0,qual:0};
      if((a.bullet|0)<1&&(b.bullet|0)>0){got.bullet=1;b.bullet=(b.bullet|0)-1;a.bullet=1;}
      if((a.medkit|0)<1&&(b.medkit|0)>0){got.medkit=1;b.medkit=(b.medkit|0)-1;a.medkit=1;}
      const cap=2-(a.qual|0);
      if(cap>0&&(b.qual|0)>0){const n=Math.min(cap,b.qual|0);got.qual=n;b.qual=(b.qual|0)-n;a.qual=(a.qual|0)+n;}
      got.none=!(got.bullet||got.medkit||got.qual);
      return got;
    }
    function bodyItemsText(b){
      if(!b)return '';
      const p=[];
      if((b.bullet|0)>0)p.push('子弹 ×'+b.bullet);
      if((b.medkit|0)>0)p.push('医疗包 ×'+b.medkit);
      if((b.qual|0)>0)p.push('申请单 ×'+b.qual);
      return p.join(' · ');
    }
    function lootText(got,b){
      const nm=b?b.name:'尸体';
      if(!got||got.none)return nm+'身上没有可带走的物资（伤情记录已更新）';
      const parts=[];
      if(got.bullet)parts.push('子弹 ×'+got.bullet);
      if(got.medkit)parts.push('医疗包 ×'+got.medkit);
      if(got.qual)parts.push('申请单 ×'+got.qual);
      return '从'+nm+'身上取得：'+parts.join(' · ');
    }
    /* AI 判断值不值得为物资停下来搜一次（只在真正的尸体上摸） */
    function aiWantsLoot(a,b){
      if(!a||!b||b.alive)return false;
      if((a.bullet|0)<1&&(b.bullet|0)>0)return true;
      if((a.medkit|0)<1&&(b.medkit|0)>0)return true;
      if((a.qual|0)<2&&(b.qual|0)>0)return true;
      return false;
    }
    function bodyInfo(b){
      if(!b)return null;
      const bp=bodyPos(b);
      const t=b.alive?b.downAt:b.deathAt;
      return {i:b.i,name:b.name,alive:b.alive,downed:b.downed,
        wound:bodyWound(b),cause:b.alive?(b.woundCause||null):(b.deathCause||null),
        room:b.alive?(b.downRoom||roomIdAt(b.x,b.y)):
          (b.deathRoom||roomIdAt(b.x,b.y)),
        t:t==null?null:+Number(t).toFixed(1),moved:!!b.bodyMoved,
        searched:!!b.searched,draggedBy:b.draggedBy==null?null:b.draggedBy,
        pos:bp?[+bp[0].toFixed(2),+bp[1].toFixed(2)]:null};
    }
    /* 尸体观察：只有状态变化才记一条，避免每 0.5 秒刷屏 */
    function observeBody(a,v){
      if(!a||!v||!a.mind)return;
      const bi=bodyInfo(v); if(!bi)return;
      const sig=[bi.alive,bi.downed,bi.wound,bi.moved,bi.searched,bi.room].join('|');
      if(a.mind.lastBody&&a.mind.lastBody.i===v.i&&a.mind.lastBody.sig===sig)return;
      a.mind.lastBody={i:v.i,sig:sig};
      const ev={kind:'saw_body',x:bi.pos?bi.pos[0]:0,y:bi.pos?bi.pos[1]:0,
        room:bi.room,subj:null,victim:v.i,conf:0.9,src:'sight',body:bi};
      evPush(a,ev);
      if(bi.moved)evPush(a,Object.assign({},ev,{kind:'saw_body_moved'}));
      a.mind.alert=Math.min(1,a.mind.alert+0.45);
      /* 关联最近 8 秒在同一房间见过的人：只能说明“他在附近”，不能定罪 */
      for(const e of a.mind.mem){
        if(e===ev||e.night!==G.night||e.kind!=='saw_agent'||e.subj==null)continue;
        if(e.room!==bi.room)continue;
        if(Math.abs(e.t-ev.t)>8)continue;
        susAdd(a,e.subj,0.16,'near_body',e);
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
      doorTick(dt);
      botTick(dt);
      /* 计时交给 SKClock：相位对象按墙钟走，会议/搜尸期间不调 update ⇒ 时间自然从夜里扣掉 */
      if(!G.phase) G.phase=SKClock.newPhase('night',performance.now(),NIGHT*1000);
      G.t=SKClock.remaining(G.phase,performance.now())/1000;
      const me=G.me;
      /* 故障：60 秒倒计时（只在夜里 update 里走），到点未修扣 3 分 */
      dmgTick(dt);
      if(!G.spectMode)sabTick();
      /* 被擒 / 倒下 / 死亡时立刻退出监控台、地道与破坏选择，避免卡在遮罩里 */
      if(G.camView&&(!me.alive||me.downed||me.detained))closeCams(true);
      if(G.wheel&&(!me.alive||me.downed||me.detained))closeWheel(true);
      if(G.pipePick&&(!me.alive||me.downed||me.detained))closePipePick(true);
      if(G.sabPick&&(!me.alive||me.downed||me.detained||!me.alien||me.sabUsed))closeSabPick(true);
      if(G.sabTarget&&(me.sabUsed||!me.alien||!me.alive||me.downed))G.sabTarget=null;
      /* 保安机器人拘留倒计时：60 秒后自动释放 */
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
      // 玩家：活人正常走；幽灵穿墙飘；濒死/被擒不能动。旁观者只移动自己的相机幽灵。
      if(G.spectMode){
        stepSpect(dt);
      }else if(me.alive&&!me.downed&&!me.detained){
        if(me.path) stepMove(me,dt,moveSpeed(me));
        tickDoing(me,dt);
      }else if(!me.alive&&me.ghost){
        if(me.path) stepMove(me,dt,6.5);
        tickDoing(me,dt);
      }
      /* 拖拽声：玩家与 AI 同时结算，低频摩擦和脚步/出刀明确分开（旁观者不发声） */
      if(!G.spectMode)for(const a of G.agents) dragSound(a,dt);
      for(const a of G.agents) if(a.drag!=null)syncDragOf(a);
      // AI：死者变幽灵（只给幽灵/DEV 看，活人看不到就不必模拟）
      for(const a of G.agents){
        if(a===me&&!G.spectMode)continue;
        if(!a.alive){ aiGhost(a,dt); continue; }
        if(a.downed||a.detained)continue;
        if(a.alien) aiAlien(a,dt); else aiHuman(a,dt);
        aiScanBodies(a,dt);
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

    /* 拖拽：玩家与 AI 共用同一套双向标记；尸体跟在拖拽者身后 0.62 格。
       被救活 / 放下 / 会议 / 死亡 / 拘留时自动松手。 */
    function draggerOf(victim){
      if(!victim)return null;
      for(const a of G.agents) if(a.drag!=null&&a.drag===victim.i)return a;
      return null;
    }
    function syncDragOf(a){
      if(!a||a.drag==null)return;
      const v=G.agents[a.drag];
      if(!v||!bodyPos(v)||!a.alive||a.downed||a.detained||G.meet||G.over){
        releaseDragBy(a,true);return;
      }
      const bp=bodyPos(v);
      const dx=bp[0]-a.x, dy=bp[1]-a.y, d=Math.hypot(dx,dy);
      const want=0.62;
      if(d>want){
        const f=nearestFree(a.x+dx/d*want,a.y+dy/d*want);
        if(v.alive){ v.x=f[0]; v.y=f[1]; }
        else { v.bodyX=f[0]; v.bodyY=f[1]; }
        if(!v.bodyMoved){
          const ox=v.alive?v.downX:v.deathX, oy=v.alive?v.downY:v.deathY;
          if(ox!=null&&Math.hypot(f[0]-ox,f[1]-oy)>1.2)v.bodyMoved=true;
        }
      }
    }
    function startDrag(a,v,silent){
      if(!a||!v||a===v)return false;
      if(!a.alive||a.downed||a.detained)return false;
      if(!bodyPos(v)||v.draggedBy!=null)return false;
      if(a.drag!=null)releaseDragBy(a,true);
      a.drag=v.i; v.draggedBy=a.i;
      a._reportT=0; a._reportBody=null; a._sawBody=null;
      if(a===G.me){
        G.drag=v.i;
        if(!G.spectMode){
          const tag=document.getElementById('dragtag'); if(tag)tag.classList.remove('hide');
          if(!silent){SND.drag(0.7);hear(a.x,a.y,'drag',0.8);toast('拖拽 '+v.name+' · 移动变慢，再按 D 放下');}
        }
      }
      if(!silent){
        const bp=bodyPos(v);
        if(bp)noticeAction(a,bp[0],bp[1],6,'drag',v);
        aiHear('drag',a.x,a.y,8,{actor:a});
        if(a!==G.me)hear(a.x,a.y,'drag',0.6);
        runInvariants('drag');
      }
      return true;
    }
    function releaseDragBy(a,silent){
      if(!a||a.drag==null)return false;
      const v=G.agents[a.drag];
      if(v&&v.draggedBy===a.i)v.draggedBy=null;
      a.drag=null;
      if(a===G.me){
        G.drag=null;
        const tag=document.getElementById('dragtag'); if(tag)tag.classList.add('hide');
        if(!silent)toast('已放下尸体');
      }
      return true;
    }
    function releaseDrag(silent){ return releaseDragBy(G.me,silent); }
    function releaseAllDrags(silent){
      for(const a of G.agents) if(a.drag!=null)releaseDragBy(a,silent);
      G.drag=null;
      const tag=document.getElementById('dragtag'); if(tag)tag.classList.add('hide');
    }
    /* 拖拽声：玩家听感与 AI 听觉分开；每 1.6 秒给 AI 记一次声纹，避免刷屏 */
    function dragSound(a,dt){
      if(!G||!a||a.drag==null||!a.moving||!a.alive||a.downed)return;
      a._dragSnd=(a._dragSnd||0)+dt;
      if(a._dragSnd<0.72)return;
      a._dragSnd=0;
      const dme=Math.hypot(a.x-G.me.x,a.y-G.me.y);
      if(dme<14)hear(a.x,a.y,'drag',Math.max(0.2,0.7*(1-dme/14)));
      if(dme<10)SND.drag(Math.max(0.08,0.5*(1-dme/10)));
      a._dragAiT=(a._dragAiT||0)+0.72;
      if(a._dragAiT>=1.6){a._dragAiT=0;aiHear('drag',a.x,a.y,8,{actor:a});}
    }
    
    /* AI 目击尸体：靠近 + 视线 → 写入身体证据 → 人类先搜尸 → 再决定是否拉铃。
       每夜最多触发 1 次 AI 报告，避免 3 次报告会议直接吞掉 90 秒夜晚。 */
    function aiScanBodies(a,dt){
      if(!a.alive||a.downed||a.detained||G.over)return;
      /* 正在拖尸 / 正按计划"绕一圈再回来报告"时，不让扫描抢先拉铃 */
      if(a.drag!=null||a._reportPlan)return;
      if(!a.mind)mindReset(a);
      if(a._reportT>0){
        a._reportT-=dt;
        if(a._reportT<=0){
          const v=a._reportBody; a._reportBody=null;
          if(v&&bodyPos(v)&&!G.meet&&!G.over&&!G.aiReportUsed){
            const bp=bodyPos(v);
            if(Math.hypot(bp[0]-a.x,bp[1]-a.y)<=5.8&&losNow(a.x,a.y,bp[0],bp[1])){
              v.reported=true;G.aiReportUsed=true;
              openMeeting('night',a,v);
            }
          }
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
        if(d<bd&&aiCanSee(a,bp[0],bp[1],5.4)){bd=d;best=v;}
      }
      if(!best){a._sawBody=null;return;}
      observeBody(a,best);
      /* 人类先搜查取证；任何 AI 看到尸体上有自己缺的物资都会停下来搜一次。
         濒死（还活着）的伤者不摸物资，只做伤情检查。 */
      const rescue=a.medkit>0&&best.alive&&best.downed;
      const busySearch=G.agents.some(x=>x!==a&&x._doing==='search'&&x._sv===best.i);
      const wantEvidence=!a.alien&&!best.searched;
      const wantLoot=!best.alive&&aiWantsLoot(a,best);
      if(!rescue&&!busySearch&&bd<2.2&&a.doing<=0&&!a._fixGo&&!a._lightGo&&
        (wantEvidence||wantLoot)){
        a.path=null;a.moving=false;
        a.doing=1.2;a._dur=1.2;a._doing='search';a._sv=best.i;
        return;
      }
      if(G.noReport)return;
      if(G.aiReportUsed||rescue||!canReportBody(a,best))return;
      a._sawBody=best;
      a._reportT=(a.alien?2.0:1.4)+Math.random()*(a.alien?2.0:1.6);
      a._reportBody=best;
    }
    function canReportBody(a,v){
      if(v.alive&&v.downed){
        /* 濒死者不是尸体：人类只有在听到动静/掌握嫌疑时才拉铃，
           否则继续任务，避免 AI 把“发现伤者”变成 30 秒会议。 */
        if(a.alien){
          const now=evNow();
          const wits=Object.keys(a.mind.seenBy||{}).filter(k=>{
            const w=G.agents[+k];
            return w&&w.alive&&!w.downed&&now-(a.mind.seenBy[k].t||0)<20;
          });
          return !wits.length;
        }
        if(a.mind.alert>=0.4)return true;
        return !!topSus(a,0.45);
      }
      return true;
    }

    /* 最近的可救目标：只认视线内的濒死者，避免 AI 隔墙“知道”谁倒了 */
    function nearestDowned(a,maxD){
      let best=null,bd=maxD;
      for(const v of G.agents){
        if(v===a||!v.alive||!v.downed)continue;
        const d=Math.hypot(v.x-a.x,v.y-a.y);
        if(d<bd&&aiCanSee(a,v.x,v.y,maxD)){bd=d;best=v;}
      }
      return best;
    }
    /* 医疗间复活调度：AI 人类没有医疗包时，会把濒死者拖到医疗间交给医疗机器人 */
    let MED_DROP=null;
    function medbotUsable(){
      return !!(G&&!G.medbotDead&&(G.medbotLeft==null?2:G.medbotLeft)>0);
    }
    function inMedRoom(x,y){const r=roomAt(x,y);return !!(r&&r.id==='med');}
    /* 拖拽目标点：医疗机器人是巡逻的，直接以它的实时位置为目标，
       否则把人丢在医疗间门口，机器人走远了一样救不活（判定半径 7 格）。 */
    function medDropSpot(){
      const b=medbotUsable()?botPos('medbot'):null;
      if(b&&inMedRoom(b.x,b.y))return nearestFree(b.x,b.y);
      if(!MED_DROP)MED_DROP=nearestFree(55.5,50.0);
      return MED_DROP;
    }
    function nearMedBot(v,rad){
      const b=botPos('medbot');
      return !!(b&&Math.hypot(v.x-b.x,v.y-b.y)<(rad||4.5));
    }
    /* 故障被别人修好后，正在站桩/赶路的人立即放弃，不浪费剩下的时间 */
    function dropStaleFix(a){
      if(!a)return;
      if(a._doing==='fix'&&(!a._fix||G.dmg.indexOf(a._fix)<0)){
        a._doing=null;a._fix=null;a.doing=0;
        if(a===G.me)toast('故障已被队友修好，停止维修');
      }
      if(a._fixGo&&G.dmg.indexOf(a._fixGo)<0){
        a._fixGo=null;
        if(a.path&&a.doing<=0){a.path=null;a.moving=false;}
      }
    }
    function aiHuman(a,dt){
      if(G.meet||G.over)return;
      if(a.detained)return;
      dropStaleFix(a);
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
        if(a.path&&a.path.length) stepMove(a,dt,moveSpeed(a));
        return;
      }
      /* 已经在拖人：送到巡逻中的医疗机器人旁边；拖拽中状态失效就松手 */
      if(a.drag!=null){
        const v=G.agents[a.drag];
        if(!v||!v.alive||!v.downed){releaseDragBy(a,true);}
        else if(!medbotUsable()){releaseDragBy(a,true);a._rest=1.0;return;}
        else if(inMedRoom(v.x,v.y)&&nearMedBot(v)){releaseDragBy(a,true);a._rest=1.0;return;}
        else{
          const m=medDropSpot();
          if(Math.hypot(a.x-m[0],a.y-m[1])<1.0&&inMedRoom(v.x,v.y)){
            /* 机器人刚走开：原地等一下再跟着走，不在医疗间里乱转 */
            a.moving=false;return;
          }
          if(!a.path||!a.path.length)walkTo(a,m[0],m[1]);
          stepMove(a,dt,moveSpeed(a));return;
        }
      }
      /* 医疗包优先救人：濒死者拖到天亮会失血而死，AI 会主动跑过去按 F */
      if(a.medkit>0&&(!a.path||!a.path.length)){
        const v=nearestDowned(a,7.5);
        const busy=v&&(v.draggedBy!=null||G.agents.some(x=>x!==a&&x._doing==='revive'&&x._rv===v));
        if(v&&!busy){
          if(Math.hypot(v.x-a.x,v.y-a.y)<1.7){
            a.doing=5;a._dur=5;a._doing='revive';a._rv=v;a.path=null;
            setAct(a,'heal',0.6,{ang:0});
          }else walkTo(a,v.x,v.y);
          return;
        }
      }
      /* 有枪 + 有目击凶手 / 高置信证据：射程内直接开枪，结算与玩家共用 fireShot */
      if(a.bullet>0){
        let si=a.suspect;
        if(si!=null){
          const s=G.agents[si];
          if(!s||s===a||!s.alive||s.downed){a.suspect=null;si=null;}
        }
        if(si==null){
          const bs=bestSusTarget(a,0.62);
          if(bs)si=bs.i;
        }
        if(si!=null){
          const s=G.agents[si];
          const kn=bestKnownTarget(a);
          const sure=!!(kn&&kn.i===si);
          const shootR=sure?10:8, chaseR=sure?14:10;
          const d=Math.hypot(s.x-a.x,s.y-a.y);
          if(d<shootR&&aiCanSee(a,s.x,s.y,shootR)){
            fireShot(a,s);a._rest=2.5+Math.random()*2;return;
          }
          if(d<chaseR){
            if(!a.path||!a.path.length)walkTo(a,s.x,s.y);
            stepMove(a,dt,moveSpeed(a));return;
          }
        }
      }
      /* 没有医疗包但医疗机器人可用：把视线内的濒死者拖进医疗间，交给机器人复活。
         只排除"自己刚开枪打倒的人"，避免救活自己刚制服的嫌疑人。 */
      if(a.medkit<1&&medbotUsable()){
        const v=nearestDowned(a,8.5);
        if(v&&v.draggedBy==null&&v.killedBy!==a.i&&!inMedRoom(v.x,v.y)){
          if(Math.hypot(v.x-a.x,v.y-a.y)<1.9){
            startDrag(a,v);
            const m=medDropSpot();
            if(!a.path||!a.path.length)walkTo(a,m[0],m[1]);
            stepMove(a,dt,moveSpeed(a));return;
          }
          walkTo(a,v.x,v.y);stepMove(a,dt,moveSpeed(a));return;
        }
      }
      /* 听到尖叫/枪声/刀声：高警觉且手头没有更急的事时，去现场看一眼 */
      if(a.mind&&a.mind.alert>=0.7&&a.mind.noise&&!a._look){
        const n=a.mind.noise;
        if(evNow()-n.t<8&&Math.hypot(n.x-a.x,n.y-a.y)>3){
          a._look={x:n.x,y:n.y,t:evNow()};
          walkTo(a,n.x,n.y);
        }else{a.mind.alert=0;a.mind.noise=null;}
      }
      if(a._look){
        if(Math.hypot(a._look.x-a.x,a._look.y-a.y)<3||
          evNow()-a._look.t>10){
          a._look=null;a.mind.alert=Math.max(0,a.mind.alert-0.5);a.mind.noise=null;
        }else{
          if(!a.path||!a.path.length)walkTo(a,a._look.x,a._look.y);
          stepMove(a,dt,moveSpeed(a));return;
        }
      }
      /* 故障抢修：一座故障最多 2 名 AI 响应，18 格内优先赶过去连续修 10 秒。
         60 秒后要扣 3 分，比手上零散任务的收益高，所以排在开枪之后、任务之前。 */
      if(G.dmg.length){
        if(a._fixGo&&G.dmg.indexOf(a._fixGo)<0)a._fixGo=null;
        if(!a._fixGo){
          let best=null,bd=18;
          for(const d of G.dmg){
            const crew=G.agents.filter(x=>x!==a&&((x._doing==='fix'&&x._fix===d)||x._fixGo===d)).length;
            if(crew>=2)continue;
            const dd=Math.hypot(d.x-a.x,d.y-a.y);
            if(dd<bd){bd=dd;best=d;}
          }
          if(best&&best!==a._fixGo){a._fixGo=best;a.path=null;}
        }
        if(a._fixGo){
          const d=a._fixGo;
          if(Math.hypot(d.x-a.x,d.y-a.y)<1.5){startFix(a,d);return;}
          if(!a.path||!a.path.length)walkTo(a,d.x,d.y);
          stepMove(a,dt,moveSpeed(a));return;
        }
      }
      /* 全船断电：最多 1 名人类 AI 去配电室合闸，恢复视野后再做任务 */
      if(G.lightState===2){
        const br=M.facility.find(f=>f.kind==='breaker');
        if(br){
          if(!a._lightGo){
            const crew=G.agents.filter(x=>x!==a&&x._lightGo&&x.alive&&!x.downed).length;
            if(crew<1)a._lightGo=true;
          }
          if(a._lightGo){
            if(Math.hypot(br.x-a.x,br.y-a.y)<1.7){
              a.path=null;a.moving=false;a.doing=3;a._dur=3;a._doing='breaker';return;
            }
            if(!a.path||!a.path.length)walkTo(a,br.x,br.y);
            stepMove(a,dt,moveSpeed(a));return;
          }
        }
      }else if(a._lightGo)a._lightGo=false;
      if(a.path&&a.path.length){ stepMove(a,dt,moveSpeed(a)); return; }
      /* 物资申请单必须回中央会议室圆桌领取 */
      if(a.qualPending>0){
        const qd=roundTableClaimSpot();
        if(qd){
          if(Math.hypot(qd.x-a.x,qd.y-a.y)<1.8){
            a.path=null;a.moving=false;
            a.doing=3;a._dur=3;a._doing='qual';return;
          }
          walkTo(a,qd.x,qd.y);stepMove(a,dt,moveSpeed(a));return;
        }
      }
      /* 已经站在专用补给点：消耗申请单换物资 */
      const spNear=nearSupply(a);
      if(spNear&&a.qual>0){
        if(spNear.item==='ammo'&&a.bullet<1){a.path=null;a.moving=false;a.doing=10;a._dur=10;a._doing='ammo';return;}
        if(spNear.item==='med'&&a.medkit<1){a.path=null;a.moving=false;a.doing=6;a._dur=6;a._doing='med';return;}
      }
      /* 有申请单且确实需要（目击凶手缺弹 / 有人濒死缺包）→ 主动去对应补给点 */
      const need=supplyTargetFor(a);
      if(need){
        const sp=supplyPoints().find(q=>q.item===need);
        if(sp){
          if(Math.hypot(sp.x-a.x,sp.y-a.y)<1.7){
            a.path=null;a.moving=false;
            if(need==='ammo'){a.doing=10;a._dur=10;a._doing='ammo';}
            else{a.doing=6;a._dur=6;a._doing='med';}
            return;
          }
          walkTo(a,sp.x,sp.y);stepMove(a,dt,moveSpeed(a));return;
        }
      }
      if(a.tIdx>=a.tasks.length){
        if(Math.random()<dt*0.25){
          const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
          const p=randIn(r); walkTo(a,p[0],p[1]);
        }else a.moving=false;
        return;
      }
      const p=M.points[a.tasks[a.tIdx]];
      if(Math.hypot(p.x-a.x,p.y-a.y)<2.8){
        a.doing=p.dur; a._dur=a.doing; a._doing='task';
        a._taskPt=a.tasks[a.tIdx];
      }else walkTo(a,p.x,p.y);
    }
    /* ---- 藏尸点 / 藏尸对象 ---- */
    const HIDE_SPOTS={};
    function hideSpotFor(rid){
      if(Object.prototype.hasOwnProperty.call(HIDE_SPOTS,rid))return HIDE_SPOTS[rid];
      const r=M.rooms.find(q=>q.id===rid);
      if(!r){HIDE_SPOTS[rid]=null;return null;}
      const [x0,y0,w,h]=r.rect, cx=x0+w/2, cy=y0+h/2;
      let best=null,bestScore=-1e9;
      for(let y=y0+0.7;y<=y0+h-0.7;y+=0.6){
        for(let x=x0+0.7;x<=x0+w-0.7;x+=0.6){
          if(!free(x,y)||!inPoly(x,y,r.poly))continue;
          if(M.cover.some(c=>x>=c.x-0.3&&x<=c.x+c.w+0.3&&y>=c.y-0.3&&y<=c.y+c.h+0.3))continue;
          let score=0,doorD=1e9,pointD=1e9;
          for(const d of (G.doors||[])){
            if(d.x<x0-1||d.x>x0+w+1||d.y<y0-1||d.y>y0+h+1)continue;
            doorD=Math.min(doorD,Math.hypot(x-d.x,y-d.y));
          }
          for(const p of M.points){
            if(p.room!==rid)continue;
            pointD=Math.min(pointD,Math.hypot(x-p.x,y-p.y));
          }
          if(doorD<1e9)score+=Math.min(6,doorD)*1.5;
          if(pointD<1e9)score+=Math.min(6,pointD)*1.2;
          score+=Math.min(7,Math.hypot(x-cx,y-cy))*0.5;
          if(score>bestScore){bestScore=score;best=[x,y];}
        }
      }
      HIDE_SPOTS[rid]=best;
      return best;
    }
    function hideRoomFor(rid,x,y){
      if(rid&&rid!=='med'&&rid!=='bridge'&&rid!=='corridor'&&rid!=='unknown')return rid;
      let best=null,bd=1e9;
      for(const r of M.rooms){
        if(r.id==='med'||r.id==='bridge')continue;
        const c=nearestFree(r.rect[0]+r.rect[2]/2,r.rect[1]+r.rect[3]/2);
        const d=Math.hypot(c[0]-x,c[1]-y);
        if(d<bd){bd=d;best=r.id;}
      }
      return best||rid;
    }
    function findHideBody(a){
      let best=null,bd=3.2;
      for(const v of G.agents){
        if(v===a)continue;
        const bp=bodyPos(v); if(!bp)continue;
        if(v.draggedBy!=null)continue;
        const d=Math.hypot(bp[0]-a.x,bp[1]-a.y);
        if(d<bd&&aiCanSee(a,bp[0],bp[1],3.6)){bd=d;best=v;}
      }
      return best;
    }
    function recentWitness(a,sec){
      if(!a||!a.mind||!a.mind.seenBy)return false;
      const now=evNow();
      for(const k in a.mind.seenBy){
        if(now-(a.mind.seenBy[k].t||0)>=sec)continue;
        const w=G.agents[+k];
        if(w&&w.alive&&!w.downed)return true;
      }
      return false;
    }
    /* 报告前的"不在场"落点：先去 6~24 格外的房间晃一圈，再回现场 */
    function reportAlibiSpot(a){
      const cands=[];
      for(const r of M.rooms){
        if(r.id==='bridge')continue;
        const c=nearestFree(r.rect[0]+r.rect[2]/2,r.rect[1]+r.rect[3]/2);
        const d=Math.hypot(c[0]-a.x,c[1]-a.y);
        if(d>6&&d<24)cands.push(r);
      }
      if(!cands.length)return null;
      return randIn(cands[Math.floor(Math.random()*cands.length)]);
    }
    function aiAlien(a,dt){
      if(G.meet||G.over)return;
      if(a.detained)return;
      dropStaleFix(a);
      if(a.doing>0){a.doing-=dt;if(a.doing<=0)finishDoing(a);return;}
      /* 开局全员同舱：异形也必须遵守错峰延迟，否则一进夜就贴脸出刀 */
      if(a._delay>0){
        a._delay-=dt;
        if(!a.path||!a.path.length){
          if(Math.random()<dt*0.35){
            const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
            const p=randIn(r); walkTo(a,p[0],p[1]);
          }else a.moving=false;
        }
        if(a.path&&a.path.length) stepMove(a,dt,moveSpeed(a));
        return;
      }
      /* 杀完人后的"重返现场报告"计划：先离开、过几秒再回尸体旁拉铃。
         这是主动策略：用会议拖人类的时间，同时把自己包装成"发现尸体的人"；
         代价是尸体还热就有人来报，会被在场者记成可疑（见 buildMeetCtx 的 quick_report）。 */
      if(a._reportPlan){
        const p=a._reportPlan, v=G.agents[p.body];
        if(!v||!bodyPos(v)||v.reported||G.aiReportUsed||v.draggedBy!=null&&v.draggedBy!==a.i){
          a._reportPlan=null;
        }else if(p.wait>0){
          p.wait-=dt;
          if(!a.path||!a.path.length){
            if(!p.spot)p.spot=reportAlibiSpot(a);
            if(p.spot)walkTo(a,p.spot[0],p.spot[1]);
          }
          stepMove(a,dt,moveSpeed(a));return;
        }else{
          const bp=bodyPos(v);
          const d=Math.hypot(bp[0]-a.x,bp[1]-a.y);
          if(d<2.6&&losNow(a.x,a.y,bp[0],bp[1])){
            v.reported=true;G.aiReportUsed=true;a._reportPlan=null;
            openMeeting('night',a,v);
            return;
          }
          if(!a.path||!a.path.length)walkTo(a,bp[0],bp[1]);
          stepMove(a,dt,moveSpeed(a));return;
        }
      }
      if(a._killBody!=null&&!a._killDecided){
        /* 每次行凶只掷一次骰子：有活人目击时更谨慎（15%），没人看见则更敢演（40%） */
        a._killDecided=true;
        const v=G.agents[a._killBody];
        if(v&&bodyPos(v)&&!v.reported&&!G.aiReportUsed){
          const p=recentWitness(a,20)?0.15:0.40;
          if(Math.random()<p){
            a._reportT=0;a._reportBody=null;
            a._reportPlan={body:v.i,wait:5+Math.random()*7,spot:null};
            return;
          }
        }
      }
      if(a._pipeCD>0)a._pipeCD-=dt;
      if(a._botCD>0)a._botCD-=dt;
      if(!a.target||!a.target.alive||a.target.downed){
        let best=null,bd=1e9;
        for(const h of G.agents){
          if(h===a||!h.alive||h.downed||h.detained)continue;
          const d=Math.hypot(h.x-a.x,h.y-a.y); if(d<bd){bd=d;best=h;}
        }
        a.target=best;
      }
      /* 现场目击者优先：异形自己看见谁在视线里，就去处理谁；不读取任何队友信息 */
      if(a.knife>0&&a.mind&&a.mind.seenBy){
        let wit=null,bd=1e9;
        for(const k in a.mind.seenBy){
          const e=a.mind.seenBy[k];
          if(evNow()-e.t>25)continue;
          const w=G.agents[+k];
          if(!w||!w.alive||w.downed||w.detained||w===a)continue;
          const d=Math.hypot(w.x-a.x,w.y-a.y);
          if(d<bd){bd=d;wit=w;}
        }
        if(wit){
          const cur=a.target?Math.hypot(a.target.x-a.x,a.target.y-a.y):1e9;
          const wd=Math.hypot(wit.x-a.x,wit.y-a.y);
          /* 目击者优先，但不能为了远处证人放弃贴脸目标 */
          if(wd<12&&wd<cur+2)a.target=wit;
        }
      }
      const tgt=a.target;
      const td=tgt?Math.hypot(tgt.x-a.x,tgt.y-a.y):1e9;
      /* 保安扇形内动手会被拘留：先退开，过几秒再找机会 */
      if(a._secAvoidT>0){
        a._secAvoidT-=dt;
        if(!a.path||!a.path.length){
          const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
          const p=randIn(r);walkTo(a,p[0],p[1]);
        }
        stepMove(a,dt,moveSpeed(a));return;
      }
      /* 每晚一次的破坏：指定的拉闸手跨图去配电室断电。
         离人太近（<5 格）时先处理人，避免异形当着面无视玩家去拆设备。 */
      if(!a.sabUsed){
        const br=M.facility.find(f=>f.kind==='breaker');
        if(a.i===G.breakerSaboteur&&br&&G.lightState!==2&&td>5){
          const d=Math.hypot(br.x-a.x,br.y-a.y);
          if(d<1.6){
            a.sabUsed=true;a.doing=3;a._dur=3;a._doing='breaker';
            return;
          }
          if(!a.path||!a.path.length)walkTo(a,br.x,br.y);
          stepMove(a,dt,moveSpeed(a));return;
        }
      }
      /* 机器人：有刀就先出刀砍装甲（消耗刀数，按保安 2 / 医疗 1 的 HP 结算，
         与玩家 Q 完全同一条 knifeBot 入口）；刀用完了才动用每夜一次的破坏技直接停摆。 */
      {
        let bk=null,bp=null,bd=8;
        for(const k of ['secbot','medbot']){
          if(k==='secbot'&&G.secbotDead)continue;
          if(k==='medbot'&&G.medbotDead)continue;
          const q=botPos(k); if(!q)continue;
          const d=Math.hypot(q.x-a.x,q.y-a.y);
          if(d<bd){bd=d;bk=k;bp=q;}
        }
        if(bk&&bp&&td>5&&a._botCD<=0){
          if(bd<1.8){
            /* 有刀先用刀：消耗刀数、按装甲 HP 结算（与玩家 Q 共用 knifeBot 入口） */
            if(a.knife>0&&knifeBot(a,bk)){a._botCD=10;return;}
            /* 刀用完了才动每夜一次的破坏技直接停摆 */
            if(!a.sabUsed){
              a.sabUsed=true;
              if(bk==='secbot')G.secbotDead=true;else G.medbotDead=true;
              G.botHp[bk]=0;
              G.fx.push({type:'spark',x:bp.x,y:bp.y,t:1.4,dur:1.4});
              hear(bp.x,bp.y,'power',0.9);
              SND.sabotage();
              witnessAlienAction(a,bp.x,bp.y,6,'bot');
              aiHear('robot_down',bp.x,bp.y,18,{actor:a});
              return;
            }
          }
          /* 只有还留着破坏技时，才专门为机器人跑一趟，避免抢掉追人节奏 */
          if(!a.sabUsed){
            if(!a.path||!a.path.length)walkTo(a,bp.x,bp.y);
            stepMove(a,dt,moveSpeed(a));return;
          }
        }
      }
      if(!a.sabUsed){
        /* 破坏技：选一个非会议室的舱室，走到设备旁下手（每夜每人一次）。
           离活人 5 格内时先处理人，避免当着面无视目标去拆设备。 */
        if(!a.sabRoom||!sabRoomOk(a.sabRoom)){
          const cands=M.rooms.filter(r=>r.id!=='bridge'&&sabRoomOk(r.id)&&r.id!==roomIdAt(a.x,a.y));
          a.sabRoom=cands.length?cands[Math.floor(Math.random()*cands.length)].id:null;
        }
        if(a.sabRoom&&td>5){
          const sp=sabSpot(a.sabRoom);
          if(sp){
            const dd=Math.hypot(sp.x-a.x,sp.y-a.y);
            if(dd<1.7||roomIdAt(a.x,a.y)===a.sabRoom){
              /* 保安正对这里时先换一间，别为了拆设备把自己送进拘留区 */
              if(secbotWouldSee(a.x,a.y)){a.sabRoom=null;return;}
              damageRoom(a,a.sabRoom);return;
            }
            if(!a.path||!a.path.length)walkTo(a,sp.x,sp.y);
            stepMove(a,dt,moveSpeed(a));return;
          }
        }
      }
      /* 正在拖尸：先拖到藏尸点；若活人贴脸且看得见，松手应战。
         计划性的破坏技优先于机会性的藏尸，所以这一段排在破坏之后。 */
      if(a.drag!=null){
        const v=G.agents[a.drag];
        if(!v||!bodyPos(v))releaseDragBy(a,true);
        else{
          const danger=!!(tgt&&td<4.5&&aiCanSee(a,tgt.x,tgt.y,4.5));
          if(!danger){
            const vp=bodyPos(v);
            const spot=a._hideSpot||hideSpotFor(a._hideRoom||roomIdAt(vp[0],vp[1]));
            if(!spot)releaseDragBy(a,true);
            else if(Math.hypot(a.x-spot[0],a.y-spot[1])<1.2){
              releaseDragBy(a,true);
              a._hideCD=25;a._hides=(a._hides||0)+1;a._hideSpot=null;a._hideRoom=null;a._rest=0.6;
              return;
            }else{
              if(!a.path||!a.path.length)walkTo(a,spot[0],spot[1]);
              stepMove(a,dt,moveSpeed(a));return;
            }
          }else releaseDragBy(a,true);
        }
      }
      /* 藏尸：附近没有活人、没有目击者时，把尸体拖到房间角落/远离门与任务点处。
         濒死者还可能有救，只有确实没人可追（>12 格）才拖；每夜最多 2 次并有冷却；
         医疗间/会议室的尸体优先拖去别的舱室。 */
      if(!a.drag&&(a._hideCD||0)<=0&&(a._hides||0)<2&&!recentWitness(a,25)){
        const v=findHideBody(a);
        const bp=v?bodyPos(v):null;
        const busy=!!(v&&v.alive&&v.downed);
        if(bp&&td>(busy?12:6)){
          const dest=hideRoomFor(roomIdAt(bp[0],bp[1]),bp[0],bp[1]);
          const spot=hideSpotFor(dest);
          if(spot&&Math.hypot(bp[0]-spot[0],bp[1]-spot[1])>2.0){
            if(Math.hypot(bp[0]-a.x,bp[1]-a.y)<2.0){
              a._hideSpot=spot;a._hideRoom=dest;a.path=null;
              if(startDrag(a,v))return;
              a._hideSpot=null;a._hideRoom=null;
            }
            if(!a.path||!a.path.length)walkTo(a,bp[0],bp[1]);
            stepMove(a,dt,moveSpeed(a));return;
          }
        }
      }
      if(a.knife<=0){ // 没刀了就游荡
        if(!a.path||!a.path.length){const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];const p=randIn(r);walkTo(a,p[0],p[1]);}
        stepMove(a,dt,moveSpeed(a)); return;
      }
      if(!tgt)return;
      /* 管道：目标远且自己正好站在管道口，钻到离目标最近的出口（20 秒冷却）。
         不在管道口时，先主动寻路到能显著缩短距离的入口；每夜最多两次。 */
      if(td>15&&a._pipeCD<=0&&a.drag==null){
        const from=nearPipe(a);
        if(from){
          let best=null,bd=1e9;
          for(const q of M.pipes){
            if(q===from)continue;
            const d=Math.hypot(q.x-tgt.x,q.y-tgt.y);
            if(d<bd){bd=d;best=q;}
          }
          if(best&&bd<td-4){
            a.x=best.x;a.y=best.y;a.path=null;a._pipeCD=20;a._pipePlan=null;
            a._pipeSeeks=(a._pipeSeeks||0)+1;
            G.fx.push({type:'pipefx',x:best.x,y:best.y,t:0.8,dur:0.8});
            hear(best.x,best.y,'pipe',0.9);
            witnessAlienAction(a,from.x,from.y,6,'pipe');
            witnessAlienAction(a,best.x,best.y,6,'pipe');
            aiHear('pipe',best.x,best.y,12,{actor:a});
            return;
          }
        }
        if((a._pipeSeeks||0)<2){
          if(!a._pipePlan){
            let plan=null,gain=5;
            for(const pin of M.pipes){
              let out=null,bd=1e9;
              for(const q of M.pipes){
                if(q===pin)continue;
                const d=Math.hypot(q.x-tgt.x,q.y-tgt.y);
                if(d<bd){bd=d;out=q;}
              }
              if(!out)continue;
              const g=td-(Math.hypot(pin.x-a.x,pin.y-a.y)+bd);
              if(g>gain){gain=g;plan={in:pin,out};}
            }
            a._pipePlan=plan;
          }
          if(a._pipePlan){
            const pin=a._pipePlan.in;
            if(Math.hypot(a.x-pin.x,a.y-pin.y)<1.2){
              const out=a._pipePlan.out;
              a.x=out.x;a.y=out.y;a.path=null;a._pipeCD=20;a._pipePlan=null;
              a._pipeSeeks=(a._pipeSeeks||0)+1;
              G.fx.push({type:'pipefx',x:out.x,y:out.y,t:0.8,dur:0.8});
              hear(out.x,out.y,'pipe',0.9);
              witnessAlienAction(a,pin.x,pin.y,6,'pipe');
              witnessAlienAction(a,out.x,out.y,6,'pipe');
              aiHear('pipe',out.x,out.y,12,{actor:a});
              return;
            }
            if(!a.path||!a.path.length)walkTo(a,pin.x,pin.y);
            stepMove(a,dt,moveSpeed(a));return;
          }
        }
      }else if(td<=15||a._pipeCD>0)a._pipePlan=null;
      if(td<1.3){
        if(secbotWouldSee(a.x,a.y)){
          a._secAvoidT=2.5;a.target=null;a.path=null;return;
        }
        knife(a,tgt); return;
      }
      if(!a.path||!a.path.length) walkTo(a,tgt.x,tgt.y);
      stepMove(a,dt,moveSpeed(a));
    }
    
    /* ---- 动作表现（纯视觉，不改变判定）：出手/受击短动作 ---- */
    function setAct(a,kind,dur,extra){
      if(!a)return;
      a.act=Object.assign({kind,dur,t:0},extra||{});
    }
    function tickActs(dt){
      for(const a of G.agents){
        if(a.redT>0)a.redT=Math.max(0,a.redT-dt);
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
      /* 危险行为先记账：即使 DEV 免伤/未造成濒死，保安也能据此反制 */
      G.pendingCrime=killer.i;
      /* 先扣刀再进 DEV 免伤分支：否则 AI 对 DEV 玩家能无限连刀，刀数永远用不掉
         （与「DEV 免伤也必须先扣子弹」同一口径） */
      killer.knife--;
      /* 3 秒红身：让目击者一眼认出刚出刀的人（纯表现，不改变判定） */
      killer.redT=3.0;
      if(victim===G.me&&G.dev){
        setAct(killer,'stab',0.4,{ang,lunge:0.4});
        G.fx.push({type:'shield',x:victim.x,y:victim.y,t:0.6,dur:0.6});
        if(killer&&killer!==G.me){killer.target=null;killer.path=null;}
        toast('DEV 无敌：这一刀没有生效');
        return;
      }
      /* 只响一次：单层刀风，不再叠 70ms 后的血肉声 */
      SND.knife(Math.max(0.18,Math.min(1,1.25-Math.hypot(victim.x-G.me.x,victim.y-G.me.y)/16)));
      hear(victim.x,victim.y,'knife',1.0);
      setAct(killer,'stab',0.5,{ang,lunge:0.55});
      setAct(victim,'hurt',0.6,{ang});
      G.fx.push({type:'slash',x:victim.x,y:victim.y,t:0.5,dur:0.5,ang,by:killer.i});
      G.fx.push({type:'blood',x:victim.x,y:victim.y,t:0.9,dur:0.9,ang});
      victim.downed=true; victim.downAt=G.t;
      victim.downX=victim.x; victim.downY=victim.y; victim.killedBy=killer.i;
      /* 异形记下自己刚放倒谁：稍后可能绕一圈再回来"发现"尸体，用会议拖时间 */
      if(killer.alien){killer._killBody=victim.i;killer._killAt=evNow();killer._killDecided=false;}
      victim.woundCause='knife'; victim.downRoom=roomIdAt(victim.x,victim.y);
      victim.searched=false;
      victim.path=null; victim.doing=0; victim._doing=null; victim._sv=null;
      witnessAlienAction(killer,victim.x,victim.y,6,'knife',victim);
      aiHear('knife',victim.x,victim.y,14,{actor:killer,victim:victim});
      screamFor(victim);
      if(victim===G.me){closeCams(true);closePipePick(true);closeSabPick(true);G.sabTarget=null;toast('你被出刀击倒，濒死');}
    }

    /* 被击倒者喊叫：公开 CC0 人声采样，距离越远越轻 */
    function screamFor(victim){
      if(!victim)return;
      /* AI 听觉与玩家音量分开：玩家离得远不播采样，但附近的 AI 仍要听见 */
      aiHear('scream',victim.x,victim.y,16,{victim:victim});
      const d=Math.hypot(victim.x-G.me.x,victim.y-G.me.y);
      if(victim!==G.me&&d>16)return;
      SND.scream(victim===G.me?0.72:Math.max(0.08,0.6*(1-d/16)));
    }

    /* 行为推断入口见上方 noticeAction：视觉写入证据 + 嫌疑分，此处不再重复实现 */

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
      a.searched=false;
      a.downed=false; a.detained=false;
      a.path=null; a.doing=0; a._doing=null;
      a.redT=0;
      if(a.drag!=null)releaseDragBy(a,true);
      const dg=draggerOf(a);
      if(dg)releaseDragBy(dg,true);
      if(a===G.me){
        G.drag=null;
        document.getElementById('dragtag').classList.add('hide');
        closeBodyCard();
        closeCams(true);closePipePick(true);closeSabPick(true);
        closeWheel(true);
        G.sabTarget=null;
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
        if(b){
          const first=!b.searched;
          b.searched=true;
          const got=lootBody(a,b);
          if(first){
            const bi=bodyInfo(b);
            evPush(a,{kind:'search_result',x:bi.pos?bi.pos[0]:b.x,y:bi.pos?bi.pos[1]:b.y,
              room:bi.room,victim:b.i,conf:1,src:'search',body:bi});
            if(bi.moved)evPush(a,{kind:'search_body_moved',x:bi.pos?bi.pos[0]:b.x,
              y:bi.pos?bi.pos[1]:b.y,room:bi.room,victim:b.i,conf:1,src:'search',body:bi});
          }
          if(actor){openBodyCard(b);toast(lootText(got,b));}
        }
        return;
      }
      if(a._doing==='med'){
        a._doing=null;
        if((a.qual||0)<1){if(actor)toast('没有物资申请单：先回中央会议室圆桌领取');return;}
        a.medkit=1;a.qual--;
        G.fx.push({type:'pickup',x:a.x,y:a.y,t:1.2,dur:1.2,item:'med'});
        setAct(a,'pickup',0.55,{});
        if(actor){toast('拿到医疗包 · 物资申请单 -1');pulseHud('md');pulseHud('ql');SND.med();}
        return;
      }
      if(a._doing==='ammo'){
        a._doing=null;
        if((a.qual||0)<1){if(actor)toast('没有物资申请单：先回中央会议室圆桌领取');return;}
        a.bullet=1;a.qual--;
        G.fx.push({type:'pickup',x:a.x,y:a.y,t:1.2,dur:1.2,item:'ammo'});
        setAct(a,'pickup',0.55,{});
        if(actor){toast('拿到子弹 · 物资申请单 -1');pulseHud('bl');pulseHud('ql');SND.ammo();}
        return;
      }
      if(a._doing==='qual'){
        a._doing=null;
        if(a.qualPending>0){
          a.qualPending--; a.qual=Math.min(2,(a.qual||0)+1);
          G.fx.push({type:'qual',x:a.x,y:a.y,t:1.5,dur:1.5,n:a.qual});
          if(actor){toast('领取物资申请单 ×1 · 可去军械库/医疗间补给点兑换');pulseHud('ql');SND.qual();}
        }else if(actor)toast('没有待领取的物资申请单');
        return;
      }
      if(a._doing==='breaker'){
        a._doing=null;a._lightGo=false;
        /* AI 拉闸以前只播特效不改状态（if(actor) 挡住了），这里统一走真断电 */
        pullBreaker(a);
        return;
      }
      if(a._doing==='fix'){finishFix(a);return;}
      if(a._doing==='revive'){
        const v=a._rv;
        if(v&&v.downed&&v.alive){
          const dg=draggerOf(v);
          if(dg)releaseDragBy(dg,true);
          v.draggedBy=null;
          v.downed=false;v.downAt=0;v.killedBy=null;a.medkit=0;
          v.woundCause=null;v.downRoom=null;v.downX=null;v.downY=null;v.searched=false;
          G.fx.push({type:'heal',x:v.x,y:v.y,t:1.2,dur:1.2});
          setAct(v,'heal',0.7,{ang:0});
          if(actor){toast('救起 '+v.name);SND.revive();}
        }
        a._rv=null;a._doing=null;return;
      }
      /* 任务结算：按实际修的点记账；乱序完成时把该点交换到 tIdx 槽位，
         保持 [0,tIdx) 全是已完成任务，tIdx 仍是“已完成数量” */
      a._doing=null;a.doing=0;
      const picked=a._taskPt;
      a._taskPt=null;
      let k=a.tIdx;
      if(picked!=null){
        const pi=a.tasks.indexOf(picked);
        if(pi>=a.tIdx)k=pi;
      }
      if(k!==a.tIdx){
        const cur=a.tasks[a.tIdx];
        a.tasks[a.tIdx]=a.tasks[k];
        a.tasks[k]=cur;
      }
      const p=M.points[a.tasks[a.tIdx]];
      if(!p)return;
      const v=p.kind==='hard'?2:1;
      if(a.ghost&&(a.ghostPts||0)+v>2){
        a._doing=null;a.doing=0;
        if(actor)toast('幽灵最多维修 2 分的剩余任务');
        return;
      }
      G.prog=Math.min(40,G.prog+v);
      if(a.ghost)a.ghostPts=(a.ghostPts||0)+v;
      a.tIdx++; a.progress+=v;
      a.nTask=p.label; a.nTaskRoom=roomIdAt(a.x,a.y);
      let gotQual=false;
      if(a.progress>=3&&!a._q3){a._q3=true;a.qualPending=(a.qualPending||0)+1;gotQual=true;}
      if(a.progress>=5&&!a._q5){a._q5=true;a.qualPending=(a.qualPending||0)+1;gotQual=true;}
      G.fx.push({type:'done',x:a.x,y:a.y,t:1.0,dur:1.0});
      G.fx.push({type:'spark',x:p.x,y:p.y,t:0.8,dur:0.8});
      if(gotQual&&actor){pulseHud('qp');SND.qual();}
      /* 修好配电室的高难任务 ⇒ 全船照明恢复（拉闸仍可再次断电） */
      let powerFix=false;
      if(p.room==='power'&&p.kind==='hard'&&!G.powerFixed){
        G.powerFixed=true; powerFix=true;
        if(G.lightState!==2){G.lightState=1;refreshLight();}
        const br=M.facility.find(f=>f.kind==='breaker');
        if(br)G.fx.push({type:'power',x:br.x,y:br.y,t:1.2,dur:1.2,on:true});
        hear(p.x,p.y,'power',0.9);
      }
      if(actor){
        SND.done();
        toast('完成「'+p.label+'」 +'+v+' 分'+(powerFix?' · 全船照明恢复':'')
          +(gotQual?' · 获得 1 份待领取物资申请单（回中央会议室圆桌领取）':''));
        if(powerFix)pulseHud('pwr');
      }
      if(a!==G.me) a._rest=6+Math.random()*5;
    }
    
    function dawn(){
      for(const a of G.agents) if(a.downed&&a.alive) die(a,'bled',a.killedBy);
      G.t=0;
      /* 天亮：没修完的故障随夜结束一起消失，不扣分（规则只罚“夜里超时”） */
      G.dmg=[];
      G.sabTarget=null;
      if(checkWin())return;
      openMeeting('day',null,null);
    }
    
    /* ---- 两台机器人 ---- */
    /* 巡逻机器人：M.facility 的 x/y 只是初始位，运行时坐标放在 G.bots。
       botTick / interact / sabotage / 绘制都读运行时坐标，否则巡逻只是画面上动、玩法不变。 */
    const BOT_SPEED=1.6;
    /* 保安机器人：14 格 + 180° 前方扇形；隔墙不算，仍需 losWalls 视线。 */
    const SEC_RANGE=14, SEC_ARC=Math.PI/2, DETAIN_TIME=60;
    function secArcOk(sec,x,y){
      if(!sec)return false;
      const b=G.bots&&G.bots.secbot;
      const ang=b&&Number.isFinite(b.ang)?b.ang:0;
      let d=Math.atan2(y-sec.y,x-sec.x)-ang;
      d=Math.atan2(Math.sin(d),Math.cos(d));
      return Math.abs(d)<=SEC_ARC;
    }
    /* AI 预判：这个位置动手会不会被保安看到（与 botTick 的判定同源） */
    function secbotWouldSee(x,y){
      if(!G||G.secbotDead||(G.secbotUses||0)>=3)return false;
      const sec=botPos('secbot');
      if(!sec)return false;
      if(Math.hypot(x-sec.x,y-sec.y)>=SEC_RANGE)return false;
      if(!losWalls(sec.x,sec.y,x,y))return false;
      return secArcOk(sec,x,y);
    }
    function resetBots(){
      if(!G)return;
      G.bots=G.bots||{};
      for(const kind of ['medbot','secbot']){
        const f=M.facility.find(q=>q.kind===kind);
        if(!f)continue;
        const p=nearestFree(f.x,f.y);
        const wps=(f.patrol&&f.patrol.length?f.patrol:[[f.x,f.y]]).map(q=>nearestFree(q[0],q[1]));
        G.bots[kind]={x:p[0],y:p[1],wp:0,ang:0,face:1,wps:wps,moving:false};
      }
      /* 拘留位固定在军械库角落：被擒者是硬控状态，不能拖着锁链跟着机器人满地图跑 */
      const sec=M.facility.find(q=>q.kind==='secbot');
      G.jailPos=sec?nearestFree(sec.x+1.7,sec.y+1.3):null;
    }
    function botPos(kind){
      const b=G&&G.bots&&G.bots[kind];
      if(b)return b;
      const f=M.facility.find(q=>q.kind===kind);
      return f?{x:f.x,y:f.y}:null;
    }
    /* 巡逻推进：1.6 格/秒（玩家 5 格/秒），到点 0.3 格换下一个航点。
       不做避障——巡逻线是照家具空位手动排的，硬套 A* 会被掩体绕路带偏。 */
    function moveBot(b,dt,dead){
      if(!b)return;
      b.moving=false;
      if(dead||!b.wps||!b.wps.length)return;
      const w=b.wps[b.wp]||b.wps[0];
      const dx=w[0]-b.x, dy=w[1]-b.y, d=Math.hypot(dx,dy);
      if(d<0.3){ b.wp=(b.wp+1)%b.wps.length; return; }
      const step=Math.min(d,BOT_SPEED*dt);
      b.x+=dx/d*step; b.y+=dy/d*step;
      b.ang=Math.atan2(dy,dx);
      if(Math.abs(dx)>0.05)b.face=dx<0?-1:1;
      b.moving=true;
    }
    /* 拘留位：军械库角落（保安机器人把凶手拽过去，60 秒后自动解锁） */
    function secJail(){
      /* 缓存一次即可：拘留位必须固定；原来每帧 nearestFree 会白跑 128 次循环 */
      return G&&G.jailPos?G.jailPos:null;
    }
    function botTick(dt){
      if(G.meet||G.over)return;
      if(!G.bots)resetBots();
      const med=botPos('medbot');
      const sec=botPos('secbot');
      moveBot(G.bots.medbot,dt,G.medbotDead);
      moveBot(G.bots.secbot,dt,G.secbotDead);
      if(G.secbotT>0)G.secbotT=Math.max(0,G.secbotT-dt);
      // 医疗机器人：每夜最多救 2 个「倒在医疗间里」的濒死者（拖进来也算）
      if(med&&!G.medbotDead&&(G.medbotLeft==null?2:G.medbotLeft)>0){
        const v=G.agents.find(a=>a.downed&&a.alive&&
          Math.hypot(a.x-med.x,a.y-med.y)<7&&roomAt(a.x,a.y)&&roomAt(a.x,a.y).id==='med');
        if(v){
          G.medbotT=(G.medbotT||0)+dt;
          if(G.medbotT>=3){
            v.downed=false; v.downAt=0; v.killedBy=null;
            const dg=draggerOf(v);
            if(dg)releaseDragBy(dg,true);
            v.draggedBy=null;
            v.woundCause=null;v.downRoom=null;v.downX=null;v.downY=null;v.searched=false;
            G.medbotUsed=true;G.medbotLeft=Math.max(0,(G.medbotLeft==null?2:G.medbotLeft)-1);
            G.fx.push({type:'healBeam',x1:med.x,y1:med.y,x2:v.x,y2:v.y,t:1.1,dur:1.1});
            G.fx.push({type:'heal',x:v.x,y:v.y,t:1.2,dur:1.2});
            setAct(v,'heal',0.7,{ang:0});
            hear(med.x,med.y,'robot',1.1);
            aiHear('robot',med.x,med.y,18);
            envNotice('revive',v.x,v.y,0.3);
            SND.revive(); SND.robot();
            toast('医疗机器人救起了 '+v.name+(G.medbotLeft>0?' · 剩余电量 '+G.medbotLeft+'/2':' · 电量耗尽'));
            runInvariants('medbot');
          }
        }else G.medbotT=0;
      }
      // 保安机器人：180° 前方扇形内行凶 ⇒ 拽进军械库角落拘留 60 秒（每夜 1 次）
      if(sec&&!G.secbotDead&&(G.secbotUses||0)<3&&G.secbotT<=0&&G.pendingCrime!=null){
        const c=G.pendingCrime; G.pendingCrime=null;
        const killer=G.agents[c];
        if(killer&&Math.hypot(killer.x-sec.x,killer.y-sec.y)<SEC_RANGE&&losWalls(sec.x,sec.y,killer.x,killer.y)&&secArcOk(sec,killer.x,killer.y)){
          if(killer===G.me&&G.dev){ toast('DEV：保安机器人没有看见你'); }
          else{
            const jail=secJail()||[sec.x,sec.y+1.6];
            const fx0=killer.x, fy0=killer.y;
            G.secbotUsed=true;G.secbotUses=(G.secbotUses||0)+1;G.secbotT=1.6;
            if(killer.drag!=null)releaseDragBy(killer,true);
            killer.detained=true; killer.detainedT=DETAIN_TIME;
            killer.path=null; killer.moving=false; killer.doing=0; killer._doing=null;
            killer.act=null;
            killer.x=jail[0]; killer.y=jail[1];
            G.fx.push({type:'detain',x1:fx0,y1:fy0,x2:jail[0],y2:jail[1],t:1.3,dur:1.3});
            G.fx.push({type:'alarm',x:sec.x,y:sec.y,t:1.4,dur:1.4});
            hear(sec.x,sec.y,'robot',1.25);
            aiHear('alarm',sec.x,sec.y,22,{});
            aiHear('detain',killer.x,killer.y,26,{subj:killer.i});
            SND.alarm(); SND.robot();
            toast(tagName(killer)+' 被保安机器人擒拿：锁在军械库角落 60 秒');
            if(killer===G.me){closeCams(true);closePipePick(true);toast('你被保安机器人擒拿：60 秒后自动释放');}
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
      releaseAllDrags(true);
      closeBodyCard();
      closeCams(true);closePipePick(true);
      closeWheel(true);
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
        cause:bodyWound(victim).replace(' · 仍在渗血','')};
    }
    function buildMeetCtx(kind,reporter,victim){
      const vi=victimInfo(victim);
      const ctx={kind,reporter,victim,victimInfo:vi,claims:[],playerSays:[],
        playerAccuse:null,playerVote:null,playerClaimRoom:null,quick:null};
      /* 尸体还热就有人来报：见过这具尸体的 AI 会想"你怎么这么快就到现场"。
         对异形是主动报告的代价，对人类是"发现得太巧"的合理怀疑。 */
      if(kind==='night'&&victim){
        const tDeath=victim.alive?(victim.downAt||0):(victim.deathAt||0);
        const age=Math.max(0,tDeath-G.t);
        ctx.quick={age:+age.toFixed(1),reporter:reporter?reporter.i:null};
        if(reporter&&reporter.alive&&age<=10){
          for(const w of G.agents){
            if(w===reporter||w.alien||!w.alive||w.downed||!w.mind)continue;
            if(!w.mind.mem.some(e=>e.kind==='saw_body'&&e.victim===victim.i))continue;
            susAdd(w,reporter.i,0.24,'quick_report',{kind:'quick_report',x:0,y:0,room:null,t:evNow()});
          }
        }
      }
      const used=new Set(vi?[vi.roomId]:[]);
      const alienAccused=new Set();
      /* 先做一轮时间线对质：如果我在别的舱室见过你，而你现在声称整晚在另一处，
         就给你的嫌疑分记一笔；这不是身份信息，只是我自己的目击记忆。 */
      for(const w of G.agents){
        if(w.alien||!w.alive||w.downed||!w.mind)continue;
        for(const a of G.agents){
          if(a===w||a.alien||!a.alive||a.downed)continue;
          const claim=alibiOf(a).room;
          for(const e of w.mind.mem.slice(-24)){
            if(e.kind!=='saw_agent'||e.subj!==a.i||e.night!==G.night||!e.room)continue;
            if(evNow()-e.t>45)continue;
            if(roomNameById(e.room)===claim)continue;
            susAdd(w,a.i,0.28,'contradiction',e);
            break;
          }
        }
      }
      for(const a of G.agents){
        a.accuse=null;a.accuseWhy=null;a._abstain=false;
        if(a.alien&&a.alive&&!a.downed&&a!==G.me){
          // 异形 AI：整场会议只用一个假口供，避免前后矛盾；玩家异形不参与自动指控
          const rooms=M.rooms.filter(r=>!used.has(r.id)&&r.id!=='bridge');
          const r=rooms.length?rooms[Math.floor(Math.random()*rooms.length)]:M.rooms[0];
          used.add(r.id);
          const pts=M.points.filter(p=>roomIdAt(p.x,p.y)===r.id);
          a._lie={room:r.name,task:pts.length?pts[Math.floor(Math.random()*pts.length)].label:'配电盘'};
          /* 异形不读取队友信息：可指控任何存活席位（包括异形），
             并尽量让每个异形选不同目标，避免看起来像统一串供。 */
          const allPool=G.agents.filter(x=>x!==a&&x.alive&&!x.downed);
          const clean=allPool.filter(x=>!x.detained);
          const pool=clean.length?clean:allPool;
          const fresh=pool.filter(x=>!alienAccused.has(x.i));
          const src=fresh.length?fresh:pool;
          const pick=src.length?src[Math.floor(Math.random()*src.length)]:null;
          a.accuse=pick?pick.i:null;
          if(a.accuse!=null)alienAccused.add(a.accuse);
        }else{
          /* 人类：确证优先（见过出刀/钻管道/破坏/红身），其次目击凶手，最后嫌疑分 */
          const kn=bestKnownTarget(a);
          let si=kn?kn.i:(a.suspect!=null?a.suspect:null);
          if(si==null){const bs=bestSusTarget(a,0.5);if(bs)si=bs.i;}
          const s=si!=null?G.agents[si]:null;
          if(s&&s!==a&&s.alive&&!s.downed){
            a.accuse=si;
            a.accuseWhy=kn?{kind:kn.known.kind,room:kn.known.room||null,
              reason:'确证异形',known:true}:
              (evidenceReason(a,si)||(a.suspect!=null?
                {kind:'saw_alien',room:null,reason:'亲眼目击'}:null));
          }
        }
      }
      return ctx;
    }
    /* 语料选择：按席位 / 夜数 / 会议轮次轮换，避免所有 AI 说同一句 */
    function pickLine(a,arr,salt){
      if(!arr||!arr.length)return '';
      const tone=a&&a.mind?a.mind.tone:0;
      return arr[(Math.abs((a?a.i:0)*5+(G.night||1)*3+tone+(salt||0)+MEET.id))%arr.length];
    }
    function evRoomName(w){
      if(!w||!w.room)return '现场';
      return roomNameById(w.room);
    }
    function evClause(w){
      if(!w)return '他的时间线对不上';
      switch(w.kind){
        case 'saw_knife':return '我亲眼看见他在'+evRoomName(w)+'出刀';
        case 'saw_shot':return '我亲眼看见他在'+evRoomName(w)+'开枪';
        case 'saw_pipe':return '我看见他钻进了管道';
        case 'saw_sabotage':return '他在'+evRoomName(w)+'破坏了设备';
        case 'saw_bot':return '他停摆了巡逻机器人';
        case 'saw_breaker':return '断电前他就在配电室附近';
        case 'saw_drag':return '我看见他拖动了尸体';
        case 'saw_red':return '我看见他身上带着刚出刀的红光';
        case 'quick_report':return '尸体还热着就有人来报，他当时就在附近';
        case 'saw_detain':return '保安机器人当场抓住了他';
        case 'near_body':return '尸体旁边的人里就有他';
        case 'heard_scream':return '尖叫声响起时他在附近';
        case 'heard_pipe':return '管道响的时候他就在那一带';
        case 'saw_alien':return '我亲眼看见他动手';
        default:return '他的说法和我看到的不一致';
      }
    }
    function defenseClause(a){
      const seen=seenNames(a,{aliveOnly:true});
      if(seen.length)return seen[0].name+'能给我作证，我们当时在'+alibiOf(a).room+'碰过面。';
      if(a.mind&&a.mind.alert>0.5)return '我也听到了动静，但我没有动手。';
      return '我一个人在'+alibiOf(a).room+'，没人作证不代表我有罪。';
    }
    function openingLine(a,m){
      const vi=m.ctx.victimInfo;
      if(!vi)return m.kind==='day'
        ? pickLine(a,['天亮了，昨晚有人动手但没留下尸体。各自把昨晚的位置说清楚。',
          '天亮了，昨晚的动静不小。先把各自最后待过的舱室报一遍。'],1)
        : pickLine(a,['没有尸体，但我不想把今晚糊弄过去。各自说一下自己在哪。',
          '没有尸体，但声音不会骗人。谁最后去过那一带？'],2);
      const bi=vi.a?bodyInfo(vi.a):null;
      const moved=bi&&bi.moved?' 尸体被移动过。':'';
      const searched=bi&&bi.searched?' 我已经检查过伤口。':'';
      if(vi.dead)return pickLine(a,[
        '我在'+vi.room+'发现了'+vi.name+'，'+vi.cause+'，人已经没了。'+moved+searched+'谁在那一带？',
        '我在'+vi.room+'看见'+vi.name+'倒着，'+vi.cause+'，已经没呼吸了。'+moved+searched+'谁最后见过他？',
        '我在'+vi.room+'找到'+vi.name+'，'+vi.cause+'，来不及了。'+moved+searched+'谁当时在附近？'
      ],3);
      return pickLine(a,[
        '我在'+vi.room+'发现'+vi.name+'倒在地上，还有呼吸，'+vi.cause+'。先救人，但动手的人就在我们中间。',
        '我在'+vi.room+'看见'+vi.name+'还有气，'+vi.cause+'。谁先把他送去医疗间，谁又该为这一刀负责？',
        '我在'+vi.room+'发现'+vi.name+'伤得很重，'+vi.cause+'。先别急着乱投，先救人。'
      ],4);
    }
    function alibiLine(a,m){
      const f=alibiOf(a),vi=m.ctx.victimInfo;
      if(m.kind==='pre'){
        return pickLine(a,[
          '我从'+f.room+'那边开始'+(f.task?('，先修'+f.task):'')+'。',
          '我打算先去'+f.room+(f.task?('，把'+f.task+'做掉'):'')+'，路上会经过走廊。',
          '我今晚从'+f.room+'起步'+(f.task?('，先修'+f.task):'')+'，谁要跟上就一起。'
        ],5);
      }
      let line='我今晚在'+f.room;
      if(f.task)line+=pickLine(a,[
        '，把'+f.task+'搞定了',
        '，'+f.task+'已经收尾',
        '，刚把'+f.task+'做完'
      ],19);
      else if(f.nextTask)line+=pickLine(a,[
        '，接下来要去'+f.nextRoom+'修'+f.nextTask,
        '，下一步准备去'+f.nextRoom+'处理'+f.nextTask,
        '，我正往'+f.nextRoom+'赶，要修'+f.nextTask
      ],20);
      else line+=pickLine(a,['，在找任务点','，任务清完了，在找下一处','，手上暂时没任务'],21);
      if(f.witnesses.length)line+=pickLine(a,[
        '，路上碰到'+f.witnesses[0].name,
        '，在'+f.room+'和'+f.witnesses[0].name+'打过照面',
        '，'+f.witnesses[0].name+'可以证明我在那一带'
      ],22);
      line+='。';
      const why=a.accuse!=null?(a.accuseWhy||evidenceReason(a,a.accuse)):null;
      if(!a.alien&&why)line+=' 我怀疑'+nameOf(a.accuse)+'：'+evClause(why)+'。';
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
      if(ch.kind==='doubt')return pickLine(ch.c,[
        ch.s.a.name+'，你说你在'+ch.s.room+'？我整晚也在'+ch.s.room+'，没看见你。',
        ch.s.a.name+'，你说你在'+ch.s.room+'？我在'+ch.s.room+'转了两圈，没碰上你。',
        ch.s.a.name+'，你说你在'+ch.s.room+'？那段时间我也在'+ch.s.room+'，你解释一下。'
      ],7);
      if(ch.kind==='support')return pickLine(ch.c,[
        '我可以给'+ch.s.a.name+'作证，我确实在'+ch.s.room+'看见过他。',
        '我可以给'+ch.s.a.name+'作证，'+ch.s.room+'那会儿我也在。',
        '我可以给'+ch.s.a.name+'作证，我们在'+ch.s.room+'碰过面。'
      ],8);
      return pickLine(ch.c,[
        ch.s.a.name+'，你那边还有谁？一个人待一晚上，没人能作证吧。',
        ch.s.a.name+'，你那边还有谁？别只说舱室，说个人名。',
        ch.s.a.name+'，你那边还有谁？时间线对不上，你得给个说法。'
      ],9);
    }
    function respondText(ch,m){
      const s=ch.s;
      if(ch.kind==='support')return pickLine(s.a,[
        '对，'+ch.c.name+'当时就在旁边。',
        '没错，'+ch.c.name+'和我一起在'+alibiOf(s.a).room+'。',
        '对，'+ch.c.name+'能作证，我们不是单独行动。'
      ],10);
      const vi=m.ctx.victimInfo;
      if(s.a.alien)return pickLine(s.a,[
        '我走的是后舱通道，没碰上人很正常。'+(vi?('我更想知道谁最后见过'+vi.name+'。'):''),
        '我一个人绕了远路，没证人。'+(vi?('先查'+vi.name+'那条线吧。'):''),
        '我没动过手。'+(vi?('先查'+vi.name+'那条线吧。'):'')
      ],11);
      const f=alibiOf(s.a);
      if(f.witnesses.length)return pickLine(s.a,[
        f.witnesses[0].name+'能作证，我们当时在'+f.room+'碰上过。',
        f.witnesses[0].name+'可以作证，我那会儿就在'+f.room+'。',
        '我和'+f.witnesses[0].name+'在'+f.room+'碰过面，不是一个人。'
      ],12);
      return pickLine(s.a,[
        '我一个人在'+f.room+'，没人看见也正常；但我没去过'+(vi?vi.room:'那片区域')+'。',
        '我在'+f.room+'修东西，没人作证不代表我有罪。',
        '我确实在'+f.room+'，但我没靠近'+(vi?vi.room:'现场')+'。'
      ],13);
    }
    function accuseLine(a,m){
      if(a.accuse==null)return null;
      const t=G.agents[a.accuse];
      if(!t||!t.alive||t.downed)return null;
      if(a.alien)return pickLine(a,[
        '我倾向'+t.name+'。今晚他的位置最说不清。',
        '我投'+t.name+'。他的说法对不上。',
        '我跟一票'+t.name+'，总得有人为这事负责。'
      ],14);
      /* 确证：不是"我怀疑"，是"我知道"——直接点破动作 */
      const kn=bestKnownTarget(a);
      if(kn&&kn.i===a.accuse){
        const k=kn.known.kind, rm=kn.known.room?roomNameById(kn.known.room):'现场';
        const act=k==='saw_pipe'?'钻管道':(k==='saw_knife'?'出刀':
          (k==='saw_sabotage'?'破坏设备':(k==='saw_bot'?'停摆机器人':'带着刚出刀的红光')));
        return pickLine(a,[
          '我确定：'+t.name+'是异形。我亲眼看见他'+act+'，就在'+rm+'。这一票我投他。',
          '不用再猜了，'+t.name+'刚才在'+rm+act+'，我看得很清楚——他是异形。我投'+t.name+'。',
          '我确证'+t.name+'是异形：'+act+'，就在'+rm+'，不是推断。我投他。'
        ],23);
      }
      const why=a.accuseWhy||evidenceReason(a,a.accuse);
      if(a.suspect!=null){
        if(why&&why.kind==='saw_knife'&&m&&m.ctx.victimInfo)
          return '我投'+t.name+'。我亲眼看见他对'+m.ctx.victimInfo.name+'出刀，不是猜的。';
        return '我投'+t.name+'。我亲眼看见他动手，不是猜的。';
      }
      if(why)return '我投'+t.name+'。'+evClause(why)+'。';
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
      const D=Math.max(12,m.discuss||25);
      const endAt=Math.max(5200,D*1000-2200);   /* 收尾留 2.2 秒 */
      const agenda=[];
      const push=fn=>agenda.push(fn);

      if(m.kind==='pre'){
        push(()=>sysSay('第 1 天 · 公开讨论 '+D+' 秒：先认识彼此、报第一站，讨论完直接进入第 1 夜。'));
        for(const a of cands.slice(0,3)) push(()=>say(a.name,alibiLine(a,m)));
        for(const a of cands.slice(3,5)){
          push(()=>{
            const f=alibiOf(a);
            say(a.name,pickLine(a,[
              '我打算先去'+f.room+(f.task?('，把'+f.task+'做掉'):'')+'，谁顺路？',
              '第 1 夜我先跑'+f.room+'，'+(f.task||'手头任务')+'优先。',
              '有没有人跟我一块去'+f.room+'？一个人修太慢了。'
            ],41));
          });
        }
        const p1=cands[5]||cands[0], p2=cands[6]||cands[1];
        if(p1&&p2&&p1!==p2){
          push(()=>{
            const f=alibiOf(p2);
            say(p1.name,'我和'+p2.name+'说好了，开局先去'+f.room+'那边看看。');
          });
        }
        if(G.me.alive&&!G.me.downed&&!G.spectMode){
          const asker=cands[3]||cands[0];
          push(()=>say(asker.name,'你呢，'+G.me.name+'？准备先修哪片？'));
        }
        const tail=cands[cands.length-1];
        push(()=>sysSay('提示：异形会拉闸 / 钻管道 / 破坏设备 / 停摆机器人；亲眼看见可以直接在会议里点破。'));
        push(()=>say(tail.name,pickLine(tail,[
          '都精神点，今晚谁看见谁钻管道，天亮直接说。',
          '我建议每个人先报自己第一站，出了事好对时间线。',
          '别一个人乱跑，两两结伴最好，出了事也有证人。'
        ],42)));
        if(G.me.alive&&!G.me.downed&&!G.spectMode){
          const q=cands[1]||cands[0];
          push(()=>say(q.name,'对了，'+G.me.name+'，你要是看到管道有人钻，记得先记下是谁。'));
        }
      }else{
        const vi=m.ctx.victimInfo;
        if(m.reporter&&m.reporter!==G.me&&m.reporter.alive&&!m.reporter.downed){
          push(()=>say(m.reporter.name,openingLine(m.reporter,m)));
        }else if(vi){
          push(()=>say(G.me.name,'我在'+vi.room+'发现'+vi.name+'，'+vi.cause+(vi.dead?'，人已经没了。':'，还有呼吸。'),true));
        }else{
          push(()=>sysSay(m.kind==='day'?'天亮了，全员到会议室。':'没有尸体，但有人按下了会议铃。'));
        }
        if(m.ctx.quick&&m.ctx.quick.age<=10&&m.ctx.quick.reporter!=null){
          const rp=G.agents[m.ctx.quick.reporter];
          const q=cands.find(x=>!x.alien&&((x.mind&&x.mind.sus[m.ctx.quick.reporter])||0)>=0.2);
          if(rp&&q)push(()=>say(q.name,pickLine(q,[
            '尸体还是热的就有人来报？'+rp.name+'，你刚才就在那一带吧。',
            rp.name+'，你到得也太快了——第一个喊人的就是你？',
            '我记着是'+rp.name+'喊的人。尸体那会儿刚倒下，你怎么正好在旁边？'
          ],45)));
        }
        const speakers=cands.slice(0,3);
        for(const a of speakers){
          m.ctx.claims.push({a,room:alibiOf(a).room});
          push(()=>say(a.name,alibiLine(a,m)));
        }
        const asker=cands[3]||cands[0];
        if(G.me.alive&&!G.me.downed&&!G.spectMode){
          push(()=>say(asker.name,'你呢，'+G.me.name+'？今晚在哪，看到谁了？'));
        }
        const ch=pickChallenge(m.ctx.claims,cands);
        if(ch){
          push(()=>say(ch.c.name,challengeText(ch)));
          push(()=>say(ch.s.a.name,respondText(ch,m)));
        }
        const accusers=cands.filter(a=>a.accuse!=null&&G.agents[a.accuse]&&G.agents[a.accuse].alive&&a.accuse!==a.i)
          .sort((x,y)=>{
            const sx=(x.alien?0:2)+(x.suspect!=null?2:0)+(x.accuseWhy?1:0);
            const sy=(y.alien?0:2)+(y.suspect!=null?2:0)+(y.accuseWhy?1:0);
            return sy-sx;
          }).slice(0,2);
        for(const a of accusers){
          push(()=>{const l=accuseLine(a,m);if(l)say(a.name,l);});
        }
        const accused=cands.find(a=>a.accuse!=null&&G.agents[a.accuse]&&G.agents[a.accuse].alive&&
          a.accuse!==a.i&&a!==accusers[0]);
        if(accused)push(()=>say(accused.name,defenseClause(accused)));
        /* 有确证的人最后点名：不是"我怀疑"，是"我确定" */
        const sure=cands.find(a=>!a.alien&&bestKnownTarget(a));
        if(sure)push(()=>{const l=accuseLine(sure,m);if(l)say(sure.name,l);});
        let supporter=null;
        if(accusers.length){
          const a0=accusers[0],tgt=G.agents[a0.accuse];
          const pool=cands.filter(x=>x!==a0&&x!==tgt&&x.suspect==null&&x.accuse==null&&
            x.alive&&!x.downed&&!x.alien&&(x.mind?x.mind.alert:0)>=0.25);
          if(pool.length&&Math.random()<0.6){
            supporter=pool[Math.floor(Math.random()*pool.length)];
            supporter.accuse=tgt.i;
            push(()=>say(supporter.name,pickLine(supporter,[
              '我跟'+a0.name+'一票，'+tgt.name+'得给个说法。',
              '我信'+a0.name+'的判断，先投'+tgt.name+'。',
              '我跟一票'+tgt.name+'，时间线对不上。'
            ],15)));
          }
        }
        /* 第二轮：再追一个没被问到的人，避免 60 秒里只有前三位开口 */
        const extra=cands.find(x=>!speakers.includes(x)&&x!==asker);
        if(extra){
          push(()=>{
            const f=alibiOf(extra);
            say(extra.name,pickLine(extra,[
              '我补一句：我在'+f.room+(f.task?('修'+f.task):'')+'，路上没碰上'+ (vi?vi.name:'出事的人') +'。',
              '我这边是'+f.room+'，谁要核对时间线可以找我。'
            ],43));
          });
        }
        const closer=cands[cands.length-1];
        push(()=>{
          const target=closer.accuse!=null?G.agents[closer.accuse]:null;
          if(target&&target.alive){
            say(closer.name,pickLine(closer,[
              '我先把票压在'+target.name+'身上。'+(vi?vi.name+'的事不能就这么算了。':''),
              '我跟'+target.name+'，他的口供最不干净。',
              '我投'+target.name+'，这一票不是随便给的。'
            ],16));
          }else if(vi){
            closer._abstain=true;
            say(closer.name,pickLine(closer,[
              '我信息不够，先弃权。'+(G.me.alive&&!G.me.downed?('你呢，'+G.me.name+'？'):''),
              '我手上没有能落地的证据，先不投。',
              '我先弃权，别把无辜的人推出去。'
            ],17));
          }else{
            closer._abstain=true;
            say(closer.name,pickLine(closer,[
              '没有尸体就别乱投，今晚把任务修起来。',
              '没有证据我不投，先回去修船。'
            ],18));
          }
        });
      }

      /* 均匀铺满讨论窗口：行与行间隔最多 2.6 秒，最少 1.2 秒；
         内容提前讲完后用系统提示补空档，避免"开头 7 秒热闹、剩下 50 秒死寂"。 */
      const t0=520;
      const step=Math.min(1600,Math.max(1000,(endAt-t0)/Math.max(1,agenda.length-1)));
      agenda.forEach((fn,i)=>meetLater(m,t0+i*step+Math.random()*160,fn));
      const lastAt=t0+step*(agenda.length-1);
      const nudges=[];
      for(let tn=lastAt+4200;tn<endAt-1600;tn+=9000){
        nudges.push(Math.round(tn));
        const seq=nudges.length;
        if(seq%2===1){
          meetLater(m,tn,()=>sysSay('自由讨论 · 剩余 '+Math.max(0,Math.round(m.t))+' 秒 · 输入框发言可直接追问'));
        }else{
          /* 空档里让 AI 主动接话：优先引用玩家刚才自述的位置，
             把「槽位」真正用进 AI 之间的对话，而不是只用于回复玩家。 */
          meetLater(m,tn,()=>{
            const a=cands[(seq*3)%cands.length]||cands[0];
            const cr=m.ctx&&m.ctx.playerClaimRoom;
            if(cr)say(a.name,'刚才'+G.me.name+'说在'+roomNameById(cr)+'，那会儿谁在那边？有没有人能对上时间线？');
            else say(a.name,pickLine(a,[
              '还有谁没报自己第一站的？趁现在说清楚。',
              '我第二站去'+alibiOf(a).room+'，有人同路吗？',
              '刚才说的那几个人，谁还有补充？别等投票再想起来。',
              '谁的路线要经过走廊的，结个伴，别落单。'
            ],44+seq));
          });
        }
      }
      /* 排期审计：门禁用它确认「讨论内容真的覆盖到结束前」 */
      m.plan={kind:m.kind,discuss:D,t0:Math.round(t0),step:Math.round(step),
        n:agenda.length,lastAt:Math.round(lastAt),endAt:Math.round(endAt),nudges,
        lastScheduled:Math.round(Math.max(lastAt,nudges.length?nudges[nudges.length-1]:0,endAt))};
      meetLater(m,endAt,()=>{
        if(m.kind==='pre')sysSay('讨论结束，进入第 1 夜。');
        else sysSay('讨论时间到，进入投票。');
      });
    }
    /* ---------------- 玩家发言 → 槽位解析 ----------------
       把自由文本拆成「提到的人 / 舱室 / 指控 / 投票 / 是否否认 / 自述位置」，
       再用这些槽位生成 AI 回应：时间线对质、当场辩护、附和确证、追问证据。
       纯本地规则，不接模型；关键词只做槽位抽取，不做语义理解。 */
    const ROOM_WORDS=[
      ['中央会议室','bridge'],['会议室','bridge'],['监控室','cam'],['监控','cam'],
      ['生态舱','ecosys'],['生态','ecosys'],['配电室','power'],['配电','power'],
      ['中转间','transit'],['中转','transit'],['娱乐室','fun'],['娱乐','fun'],
      ['引擎','engine'],['医疗间','med'],['医疗','med'],['军械库','armory'],['军械','armory'],
      ['走廊','corridor']
    ];
    function parseSpeech(text){
      const s=String(text||'');
      const out={raw:s.slice(0,80),rooms:[],people:[],accuse:null,vote:null,deny:false,where:null};
      for(const [w,id] of ROOM_WORDS){
        if(s.indexOf(w)>=0&&out.rooms.indexOf(id)<0)out.rooms.push(id);
      }
      for(const a of G.agents){
        if(a.i===0||!a.name)continue;
        if(s.indexOf(a.name)>=0||s.indexOf(seatNo(a))>=0)out.people.push(a.i);
      }
      if(out.people.length){
        if(/我(投|跟|票给)|投给/.test(s))out.vote=out.people[0];
        if(/怀疑|凶手|就是他|是他|他杀|异形|杀了/.test(s))out.accuse=out.people[0];
      }
      if(/不是我|我没|我没去|我没动|不在场|冤枉/.test(s))out.deny=true;
      if(out.rooms.length&&/(我在|就在|一直在|当时在|去过|待在|在)/.test(s))out.where=out.rooms[0];
      return out;
    }
    /* 找一个能替某人作证的证人（只用于台词，不改变判定） */
    function seedWitness(a){
      const seen=seenNames(a,{aliveOnly:true});
      return seen.length?(seen[0].name+'能给我作证'):'';
    }
    function playerTalk(text){
      const m=G.meet;
      if(!m||m.phase!=='discuss')return;
      const cands=G.agents.filter(a=>a.alive&&!a.downed&&a!==G.me);
      if(!cands.length)return;
      const sl=parseSpeech(text);
      m.ctx.playerSays=m.ctx.playerSays||[];
      m.ctx.playerSays.push({t:evNow(),slots:sl});
      if(sl.accuse!=null)m.ctx.playerAccuse=sl.accuse;
      if(sl.vote!=null)m.ctx.playerVote=sl.vote;
      if(sl.where)m.ctx.playerClaimRoom=sl.where;
      const vi=m.ctx.victimInfo;

      /* 1) 时间线对质：玩家自称在哪，但某个 AI 记得在别处见过他 → 当场拆穿 */
      let challenger=null,conflict=null;
      if(sl.where){
        for(const w of cands){
          if(w.alien||!w.mind)continue;
          for(const e of w.mind.mem.slice(-24)){
            if(e.kind!=='saw_agent'||e.subj!==0||e.room==null||e.night!==G.night)continue;
            if(evNow()-e.t>45||e.room===sl.where)continue;
            susAdd(w,0,0.3,'contradiction_player',e);
            challenger=w;conflict=e;break;
          }
          if(challenger)break;
        }
      }
      if(challenger&&conflict){
        const roomClaim=roomNameById(sl.where),roomSeen=roomNameById(conflict.room);
        meetLater(m,650+Math.random()*400,()=>say(challenger.name,pickLine(challenger,[
          G.me.name+'，你说你在'+roomClaim+'？我明明在'+roomSeen+'看见你了。',
          G.me.name+'，你说你在'+roomClaim+'？'+roomSeen+'那会儿你可不在那儿，我亲眼看到的。',
          G.me.name+'，'+roomClaim+'？我在'+roomSeen+'碰见你了，别跟我说两个地方。'
        ],31)));
        return;
      }

      /* 2) 玩家点名指控：被点的人辩护；有同款确证的人直接站队 */
      if(sl.accuse!=null){
        const t=G.agents[sl.accuse];
        if(!t||!t.alive||t.downed)return;
        const sameKnown=cands.find(w=>w!==t&&!w.alien&&w.mind&&w.mind.known&&w.mind.known[t.i]);
        if(sameKnown){
          const k=sameKnown.mind.known[t.i];
          const rm=k.room?roomNameById(k.room):'现场';
          const act=k.kind==='saw_pipe'?'钻了管道':(k.kind==='saw_knife'?'出刀':
            (k.kind==='saw_red'?'身上带着刚出刀的红光':'破坏了设备'));
          meetLater(m,600+Math.random()*500,()=>say(sameKnown.name,
            '我同意'+G.me.name+'。'+t.name+'在'+rm+act+'，我亲眼看见的——他就是异形。'));
          return;
        }
        meetLater(m,650+Math.random()*450,()=>say(t.name,pickLine(t,[
          G.me.name+'，你凭什么怀疑我？我今晚在'+alibiOf(t).room+'，'+
            (seedWitness(t)||'没人作证不代表我有罪')+'。',
          '我不是异形。'+G.me.name+'，你说我，那你说说你当时在哪？',
          '要投我就直说，别拿猜测当证据。'
        ],32)));
        const bw=cands.find(w=>w!==t&&!w.alien&&((w.mind&&w.mind.sus[t.i])||0)>=0.4);
        if(bw)meetLater(m,1500,()=>say(bw.name,pickLine(bw,[
          '我这边也有一条对得上'+t.name+'的线索，先记他一票。',
          '我不止听'+G.me.name+'说，我自己也看到过'+t.name+'不对劲。'
        ],33)));
        return;
      }

      /* 3) 玩家自述位置（无冲突）：在场的人可以作证或反问 */
      if(sl.where){
        const there=cands.find(w=>!w.alien&&w.nRoom===sl.where&&
          !(w.mind&&w.mind.seenT&&w.mind.seenT[0]&&evNow()-w.mind.seenT[0]<8));
        if(there){
          const rn=roomNameById(sl.where);
          meetLater(m,600+Math.random()*500,()=>say(there.name,pickLine(there,[
            '我那会儿也在'+rn+'，怎么没看见你？',
            '你说你在'+rn+'？我整晚都在那边，没碰上你。',
            rn+'？我就在那儿修东西，没见到你。'
          ],34)));
        }else{
          const rn=roomNameById(sl.where);
          const resp=pickResponder(m,cands);
          meetLater(m,600+Math.random()*500,()=>say(resp.name,pickLine(resp,[
            '记下了：'+G.me.name+'在'+rn+'。',
            '好，'+G.me.name+'的位置是'+rn+'，我先记着。'
          ],35)));
        }
        return;
      }

      /* 4) 玩家投票：有警觉的人可以跟票，零证据的人不跟（规则不允许无证据投票） */
      if(sl.vote!=null){
        const t=G.agents[sl.vote];
        if(!t||!t.alive||t.downed)return;
        const follower=cands.find(w=>w!==t&&!w.alien&&w.mind&&w.mind.alert>=0.25&&w.accuse==null);
        if(follower){
          follower.accuse=t.i;
          meetLater(m,600+Math.random()*500,()=>say(follower.name,
            '我跟'+G.me.name+'一票，'+t.name+'得给个说法。'));
        }else{
          const resp=pickResponder(m,cands);
          meetLater(m,600+Math.random()*500,()=>say(resp.name,
            G.me.name+'，你要投'+t.name+'？先说说你看到了什么，我不跟没证据的票。'));
        }
        return;
      }

      /* 5) 玩家否认：有人会接受，有人会追问 */
      if(sl.deny){
        const press=cands.find(w=>w.alien||((w.mind&&w.mind.sus[0])||0)>=0.3);
        if(press){
          const where=vi?vi.room:'案发那会儿';
          meetLater(m,600+Math.random()*500,()=>say(press.name,pickLine(press,[
            '你说不是你，那'+where+'你在哪？说清楚。',
            '没人说是你，但你得把时间线说圆了。'
          ],36)));
        }else{
          const resp=pickResponder(m,cands);
          meetLater(m,600+Math.random()*500,()=>say(resp.name,'行，我记下了。'));
        }
        return;
      }

      /* 6) 兜底：任务 / 进度 / 看见谁 */
      const a=pickResponder(m,cands);
      meetLater(m,600+Math.random()*600,()=>{
        const f=alibiOf(a);
        let line;
        if(/在哪|哪里|位置|哪边/.test(text)){
          line='我在'+f.room+(f.task?('，把'+f.task+'搞定了'):'')+'。'+
            (f.witnesses[0]?('路上碰到'+f.witnesses[0].name+'。'):'');
        }else if(/谁|怀疑|投|凶手/.test(text)){
          if(a.accuse!=null)line='我怀疑'+nameOf(a.accuse)+'。'+
            (a.suspect!=null?'我亲眼看见的。':'他的说法对不上。');
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
      releaseAllDrags(true);
      closeBodyCard();
      closeCams(true);closePipePick(true);closeSabPick(true);
      closeWheel(true);
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
      const canAct=G.me.alive&&!G.me.downed&&!G.spectMode;
      document.getElementById('m-skip').classList.toggle('hide',!canAct);
      const inp=document.getElementById('m-text');
      inp.disabled=!canAct;
      inp.placeholder=canAct?'自由发言，回车发送':(G.spectMode?'旁观者只读':'幽灵只能旁观');
      document.getElementById('m-who').innerHTML='';
      document.getElementById('m-tally').innerHTML='';
      document.getElementById('m-say').innerHTML='';
      if(!canAct) say(G.spectMode?'旁观者':G.me.name,G.spectMode?'（旁观）只读观战，不参与讨论与投票。':'（幽灵）我在看着。','sys');
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
      if(!G.me.downed&&G.me.alive&&!G.spectMode){
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
      // AI 投票：先说出口的指控 → 证据链最高嫌疑 → 人类无证据弃权；异形随机独立投票
      for(const a of G.agents){
        if(!a.alive||a===G.me||a.downed)continue;
        /* 确证优先：见过异形专属行为的人不需要再猜，直接投确证目标 */
        if(!a.alien){
          const kn=bestKnownTarget(a);
          if(kn){ m.votes[a.i]=kn.i; continue; }
        }
        const acc=(a.accuse!=null&&G.agents[a.accuse]&&G.agents[a.accuse].alive&&a.accuse!==a.i)?a.accuse:null;
        if(acc!=null){ m.votes[a.i]=acc; continue; }
        if(a.suspect!=null&&G.agents[a.suspect]&&G.agents[a.suspect].alive&&G.agents[a.suspect]!==a){
          m.votes[a.i]=a.suspect; continue;
        }
        const bs=bestSusTarget(a,0.5);
        if(bs){m.votes[a.i]=bs.i;continue;}
        if(a.alien){
          const all=G.agents.filter(x=>x.alive&&x!==a);
          const clean=all.filter(x=>!x.detained);
          const pool=clean.length?clean:all;
          m.votes[a.i]=pool.length?pool[Math.floor(Math.random()*pool.length)].i:-1;
          continue;
        }
        /* 人类没有证据不随机投人：弃权比冤枉一个无辜者更符合规则 */
        m.votes[a.i]=-1;
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
      if(G)releaseAllDrags(true);
      G.t=NIGHT;
      G.phase=SKClock.newPhase('night',performance.now(),NIGHT*1000);
      for(const a of G.agents){
        a.knife=1;a.path=null;a.doing=0;a.target=null;a.reported=false;
        a._doing=null;a.sabUsed=false;a.detained=false;a.detainedT=0;
        a._pipeCD=0;a._rv=null;a.sabRoom=null;a._fix=null;a._fixGo=null;a._taskPt=null;a._look=null;
        /* 每夜重置认知：没有跨夜记忆，也不让上一夜的 suspect 自动带进新夜 */
        mindReset(a);a.suspect=null;a.accuseWhy=null;a._abstain=false;
        a._reportT=0;a._reportBody=null;a._sawBody=null;a._scanT=0;
        /* 拖拽 / 红身 / 藏尸 / 断电响应 / 管道规划：全部按夜清空 */
        a.drag=null;a.draggedBy=null;a.redT=0;a._dragSnd=0;a._dragAiT=0;
        a._hideSpot=null;a._hideRoom=null;a._hideCD=0;a._hides=0;
        a._lightGo=false;a._pipePlan=null;a._pipeSeeks=0;a._secAvoidT=0;a._botCD=0;
        a._killBody=null;a._killAt=0;a._killDecided=true;a._reportPlan=null;
        /* 节奏控制：错峰开工 + 修完歇一会儿；异形更早开始活动，但不会开局贴脸 */
        a.act=null;a._rest=0;a._delay=2+Math.random()*6;a._fxT=0;
        a.nRoom=roomIdAt(a.x,a.y);a.nSeen={};a.nTask=null;a.nTaskRoom=null;
        a.accuse=null;a._lie=null;
      }
      G.drag=null;
      G.aiReportUsed=false;G.evSeq=0;
      G.trackT=0;G.medbotUsed=false;G.medbotT=0;G.medbotLeft=2;G.botHp={secbot:2,medbot:1};G.secbotUsed=false;G.secbotUses=0;G.secbotT=0;G.pendingCrime=null;
      G.medbotDead=false;G.secbotDead=false;G.powerFixed=false;
      for(const d of (G.doors||[])){d.open=0;d.target=0;}
      /* 新的一夜：故障与破坏目标全部清空（上夜没修完的故障不跨夜追罚） */
      G.dmg=[];G.sabTarget=null;
      resetBots();
      const alienIds=G.agents.filter(a=>a.alien&&a.alive&&a.i!==0).map(a=>a.i);
      G.breakerSaboteur=alienIds.length?alienIds[Math.floor(Math.random()*alienIds.length)]:null;
      G.lightState=0;G.waves=[];G.fx=[];
      closeCams(true);closePipePick(true);closeSabPick(true);
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
      const f=G?camFocus():{x:0,y:0};
      let ox=innerWidth/2-f.x*s, oy=innerHeight/2-f.y*s;
      ox = mw>innerWidth ? Math.min(0,Math.max(innerWidth-mw,ox)) : (innerWidth-mw)/2;
      oy = mh>innerHeight ? Math.min(0,Math.max(innerHeight-mh,oy)) : (innerHeight-mh)/2;
      VIEW.ox=ox; VIEW.oy=oy;
    }
    addEventListener('resize',()=>{if(DEAD||!G)return;resize();PAT={};});
    const SX=x=>x*VIEW.s+VIEW.ox, SY=y=>y*VIEW.s+VIEW.oy;
    const WX=x=>(x-VIEW.ox)/VIEW.s, WY=y=>(y-VIEW.oy)/VIEW.s;
    
    cv.addEventListener('click',e=>{
      if(DEAD||!G||G.paused||G.over||G.meet||G.inspect||G.camView||G.pipePick||G.sabPick||G.wheel)return;
      const me=G.me;
      if(!G.spectMode){
        if(!me.alive&&!me.ghost)return;
        if(me.downed)return;
        if(me.detained)return;
      }
      const tx=WX(e.clientX),ty=WY(e.clientY);
      if(G.spectMode&&G.spect){        // 旁观者：直线穿墙飞过去
        G.spect.path=[[tx,ty]];
      }else if(!me.alive){ // 幽灵：直线穿墙
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
      /* 设置面板在最上层：只允许 ESC 关闭，其余按键不落到对局 */
      if(global.SKSettings&&global.SKSettings.isOpen()){
        if(k==='escape'){e.preventDefault();global.SKSettings.close();}
        return;
      }
      if(k==='f2'){e.preventDefault();toggleDev();return;}
      if(k==='escape'){
        if(G.wheel){closeWheel();return;}
        if(G.inspect){closeBodyCard();return;}
        if(G.sabPick){closeSabPick();return;}
        if(G.pipePick){closePipePick();return;}
        if(G.camView){closeCams();return;}
        if(G.meet||G.over)return;
        togglePause();return;
      }
      /* 交互轮盘：数字键 / 点击选择，屏蔽其它输入 */
      if(G.wheel){
        if(k==='m'){SND.setOn(!SND.isOn());toast(SND.isOn()?'音效：开':'音效：关');return;}
        if(/^[1-9]$/.test(k))pickWheel(+k-1);
        return;
      }
      /* 破坏选择：数字键直达，其余按键屏蔽 */
      if(G.sabPick){
        if(k==='m'){SND.setOn(!SND.isOn());toast(SND.isOn()?'音效：开':'音效：关');return;}
        if(/^[1-9]$/.test(k)){
          const rid=G.sabPick.rooms[+k-1];
          if(rid)pickSabRoom(rid);
        }
        return;
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
      if(G.meet||G.over)return;
      if(G.spectMode){
        /* 旁观者不参与对局：只允许暂停、视野、相机、静音 */
        if(k==='p'||k==='escape'){togglePause();return;}
        if(k==='t'){G.fogOn=!G.fogOn;toast(G.fogOn?'视野：手电筒':'视野：全亮');return;}
        if(k==='c'){G.camMode=(G.camMode==='map'?'follow':'map');resize();
          toast(G.camMode==='map'?'相机：全图':'相机：跟随（近景）');return;}
        if(k==='m'){SND.setOn(!SND.isOn());toast(SND.isOn()?'音效：开':'音效：关');return;}
        return;
      }
      if(k==='p'){if(!G.meet&&!G.over&&!G.inspect)togglePause();return;}
      if(G.paused)return;
      if(k==='r'){tryReport();return;}
      if(k==='m'){SND.setOn(!SND.isOn());toast(SND.isOn()?'音效：开':'音效：关');return;}
      /* WASD 是主操作键（移动仍然是点击地面）：W 交互 / A 出刀 / S 搜尸 / D 收尸 */
      if(k==='w'){if(G.inspect)closeBodyCard();else interact();return;}
      if(k==='a'){attack();return;}
      if(k==='s'){e.preventDefault();if(G.inspect)closeBodyCard();else searchBody();return;}
      if(k==='d'){e.preventDefault();toggleDrag();return;}
      if(k==='e'){if(G.inspect)closeBodyCard();else interact();return;}
      if(k==='f'){rescue();return;}
      if(k==='h'){sabotage();return;}
      if(k==='v'){(G.camView?closeCams():openCams());return;}
      if(k==='q'){attack();return;}
      if(k==='b'){shoot();return;}
      if(k==='x'){e.preventDefault();if(G.inspect)closeBodyCard();else searchBody();return;}
      if(k==='g'){e.preventDefault();toggleDrag();return;}
      if(k==='t'){G.fogOn=!G.fogOn;toast(G.fogOn?'视野：手电筒':'视野：全亮（审计用）');return;}
      if(k==='c'){G.camMode=(G.camMode==='map'?'follow':'map');resize();
        toast(G.camMode==='map'?'相机：全图':'相机：跟随（近景）');return;}
    });
    
    /* ---------------- 交互轮盘 ----------------
       E 收集附近所有可交互项：只有 1 项直接执行，多项打开轮盘，避免按键语义重叠。 */
    function startClaim(me){
      me.path=null;me.moving=false;
      me.doing=3;me._dur=3;me._doing='qual';
      SND.interact();toast('领取物资申请单 3s · 移动会打断');
    }
    function startSupply(me,sp){
      if(!sp)return false;
      if(me.qual<=0){toast('需要物资申请单：先回中央会议室圆桌领取');return false;}
      if(sp.item==='ammo'&&me.bullet>=1){toast('子弹已满');return false;}
      if(sp.item==='med'&&me.medkit>=1){toast('医疗包已满');return false;}
      me.path=null;me.moving=false;
      const dur=sp.item==='ammo'?10:6;
      me.doing=dur;me._dur=dur;me._doing=sp.item==='ammo'?'ammo':'med';
      toast('消耗 1 张物资申请单领取'+(sp.item==='ammo'?'子弹 10s':'医疗包 6s'));
      SND.interact();
      return true;
    }
    function ghostTaskPts(p){return p&&p.kind==='hard'?2:1;}
    function ghostTaskAllowed(a,p){return !a||!a.ghost||((a.ghostPts||0)+ghostTaskPts(p)<=2);}
    function startTask(me,p,ghost){
      me.path=null;me.moving=false;
      if(me.ghost&&!ghostTaskAllowed(me,p)){
        toast('幽灵最多维修 2 分的剩余任务');return false;
      }
      /* 记住实际修的任务点：玩家可以乱序修自己的任意剩余任务，
         结算时不能按 tasks[tIdx] 记账（否则会出现“修 C 记 A 完成”） */
      me._taskPt=M.points.indexOf(p);
      me.doing=ghost?p.dur*1.6:p.dur; me._dur=me.doing; me._doing='task';
      if(ghost)toast('幽灵维修「'+p.label+'」 '+me.doing.toFixed(1)+'s');
      else toast('开始维修「'+p.label+'」 '+me.doing+'s · 站桩，移动会打断');
    }
    function collectInteractions(me){
      const out=[],ghost=!me.alive,ml=me.tasks.slice(me.tIdx);
      const fd=nearDmg(me);
      if(fd)out.push({id:'fix',x:fd.x,y:fd.y,short:'维修故障',
        pill:'[E] 维修故障 '+fd.label+' 10s · 剩余 '+Math.max(0,Math.ceil(fd.left))+'s',
        accent:'rgba(255,107,97,.8)',fg:'#FFB3AC',run:()=>startFix(me,fd)});
      if(!ghost){
        const pipe=nearPipe(me);
        if(pipe&&me.alien)out.push({id:'pipe',x:pipe.x,y:pipe.y,short:'钻管道',
          pill:'[E] 地道 · 选择出口',accent:'rgba(168,150,255,.75)',fg:'#D6CCFF',
          run:()=>openPipePick(pipe)});
        if(nearRoundTable(me)&&me.qualPending>0){
          const q=roundTableClaimSpot();
          out.push({id:'req',x:q.x,y:q.y,short:'领物资申请单',
            pill:'[E] 领取物资申请单 · 待领 '+me.qualPending,
            accent:'rgba(240,198,116,.8)',fg:'#FFE8B0',run:()=>startClaim(me)});
        }
        const sp=nearSupply(me);
        if(sp)out.push({id:'supply-'+sp.item,x:sp.x,y:sp.y,
          short:sp.item==='ammo'?'领子弹':'领医疗包',
          pill:'[E] '+sp.label+(me.qual>0?' · 消耗 1 张申请单':' · 需要物资申请单'),
          accent:sp.item==='ammo'?'rgba(224,169,75,.8)':'rgba(63,191,140,.75)',
          fg:sp.item==='ammo'?'#FFE0A3':'#B9F5DA',run:()=>startSupply(me,sp)});
        const br=M.facility.find(f=>f.kind==='breaker'&&Math.hypot(f.x-me.x,f.y-me.y)<1.6);
        if(br)out.push({id:'breaker',x:br.x,y:br.y,
          short:G.lightState===2?'合闸':'拉闸',
          pill:'[E] '+(G.lightState===2?'合闸':'拉闸')+' 3s · '+(G.lightState===2?'当前断电':'当前照明'),
          accent:'rgba(127,211,240,.75)',fg:'#BFE9F7',
          run:()=>{me.path=null;me.moving=false;me.doing=3;me._dur=3;me._doing='breaker';SND.interact();toast('拉闸 3s');}});
        const mon=nearMonitor(me);
        if(mon)out.push({id:'cams',x:mon.x,y:mon.y,short:'全船监控',
          pill:'[V] 全船监控'+(G.lightState===2?'（信号中断）':''),
          accent:'rgba(95,224,168,.75)',fg:'#B9F5DA',run:()=>openCams()});
      }
      /* 尸体操作收口：查验 / 搜尸取物资 / 收尸 / 报告 / 施救都能从 E 轮盘做 */
      const nb=ghost?null:bodyNear(2.2);
      if(nb){
        const bp=bodyPos(nb);
        if(bp&&visibleAt(bp[0],bp[1])){
          const canLoot=!nb.alive&&bodyHasLoot(nb);
          if(!nb.alive&&(!nb.searched||canLoot))out.push({id:'search',x:bp[0],y:bp[1],
            short:'搜尸（取物资）',pill:'[S] 搜尸 · 取走子弹/医疗包/申请单',
            accent:'rgba(127,211,240,.8)',fg:'#BFE9F7',run:()=>searchBody()});
          if(nb.alive&&!nb.searched)out.push({id:'search',x:bp[0],y:bp[1],
            short:'查看伤情',pill:'[S] 检查伤情 · 取得伤口与时间线',
            accent:'rgba(127,211,240,.8)',fg:'#BFE9F7',run:()=>searchBody()});
          if(nb.searched)out.push({id:'inspect',x:bp[0],y:bp[1],short:'查看记录',
            pill:'[X] 查看'+(nb.alive?'伤情':'尸检')+'记录',
            accent:'rgba(143,166,192,.7)',fg:'#C9D1DB',run:()=>openBodyCard(nb)});
          if(G.drag===nb.i)out.push({id:'drop',x:bp[0],y:bp[1],short:'放下尸体',
            pill:'[D] 放下尸体',accent:'rgba(240,198,116,.8)',fg:'#FFE8B0',run:()=>releaseDrag()});
          else if(nb.draggedBy==null)out.push({id:'drag',x:bp[0],y:bp[1],short:'收尸（拖走）',
            pill:'[D] 收尸 · 扛起后移动变慢',accent:'rgba(240,198,116,.8)',fg:'#FFE8B0',
            run:()=>toggleDrag()});
          if(!nb.reported)out.push({id:'report',x:bp[0],y:bp[1],short:'报告尸体',
            pill:'[R] 报告尸体 · 立即开会',accent:'rgba(255,107,97,.75)',fg:'#FFB3AC',
            run:()=>tryReport()});
          if(nb.alive&&nb.downed&&me.medkit>0)out.push({id:'revive',x:bp[0],y:bp[1],short:'施救',
            pill:'[F] 施救 5s · 消耗医疗包',accent:'rgba(63,191,140,.8)',fg:'#B9F5DA',
            run:()=>rescue()});
        }
      }
      const p=nearPoint(me);
      const mine=p&&ml.indexOf(M.points.indexOf(p))>=0;
      if(mine&&(!ghost||ghostTaskAllowed(me,p)))out.push({id:'task',x:p.x,y:p.y,short:p.label,
        pill:'[E] 维修 '+p.label+'  '+p.dur+'s',
        accent:'rgba(255,205,60,.7)',fg:'#F0C674',run:()=>startTask(me,p,ghost)});
      return out;
    }
    function openWheel(items){
      const me=G.me;
      if(!items||!items.length)return false;
      if(items.length===1){items[0].run();return true;}
      me.path=null;me.moving=false;
      G.wheel={items:items.slice()};
      const box=document.getElementById('wheel-opts');
      if(!box)return false;
      const n=items.length;
      box.innerHTML=items.map((it,i)=>{
        const ang=(n===2?Math.PI:-Math.PI/2)+i*Math.PI*2/n;
        const rad=n===2?30:34;
        const lx=50+Math.cos(ang)*rad,ly=50+Math.sin(ang)*rad;
        return '<button data-wheel="'+i+'" style="left:'+lx.toFixed(1)+'%;top:'+ly.toFixed(1)+'%">'
          +'<span class="pn">'+(i+1)+'</span><span class="pl">'+it.short+'</span></button>';
      }).join('');
      [...box.children].forEach(b=>{b.onclick=()=>pickWheel(+b.dataset.wheel);});
      const w=document.getElementById('wheel'); if(w)w.classList.remove('hide');
      SND.interact();
      return true;
    }
    function closeWheel(silent){
      if(G)G.wheel=null;
      const w=document.getElementById('wheel'); if(w)w.classList.add('hide');
      if(!silent)toast('已取消交互');
    }
    function pickWheel(i){
      const w=G&&G.wheel; if(!w)return false;
      const it=w.items[i]; if(!it)return false;
      closeWheel(true);
      it.run();
      return true;
    }
    function interact(){
      const me=G.me; if(!me.alive&&!me.ghost)return;
      if(G.wheel||me.doing>0)return;
      if(me.downed||me.detained)return;
      const items=collectInteractions(me);
      if(!items.length){
        let bot=null,bd=1.7;
        for(const f of M.facility){
          if(f.kind!=='medbot'&&f.kind!=='secbot')continue;
          const bp=botPos(f.kind); if(!bp)continue;
          const d=Math.hypot(bp.x-me.x,bp.y-me.y);
          if(d<bd){bd=d;bot=f;}
        }
        if(bot){
          if(bot.kind==='secbot')toast(G.secbotDead?'保安机器人：今晚已停摆':(G.secbotUses>=3?'保安机器人：本夜 3 次擒拿已用完':('保安机器人：在线 · 本夜 '+((G.secbotUses||0))+'/3 · '+SEC_RANGE+' 格半圆内危险行为会被拘留 60s')));
          else toast(G.medbotDead?'医疗机器人：今晚已停摆':(G.medbotLeft<=0?'医疗机器人：电量耗尽':(G.medbotUsed?'医疗机器人：电量 '+G.medbotLeft+'/2':'医疗机器人：在线 · 电量 2/2 · 把濒死者拖进医疗间会自动施救')));
          return;
        }
        toast(!me.alive?
          (me.tIdx<me.tasks.length&&!ghostTaskAllowed(me,M.points[me.tasks[me.tIdx]])?
            '幽灵维修额度已用尽（每只幽灵最多 2 分）':'幽灵只能维修任务点或故障'):
          '这里没有你能做的事');
        return;
      }
      if(items.length===1){items[0].run();return;}
      openWheel(items);
    }
    function sabotageBot(target,tp){
      const me=G.me;
      me.sabUsed=true;G.sabTarget=null;
      if(target.kind==='secbot'){G.secbotDead=true;G.botHp.secbot=0;}
      else{G.medbotDead=true;G.medbotLeft=0;G.botHp.medbot=0;}
      G.fx.push({type:'spark',x:tp.x,y:tp.y,t:1.4,dur:1.4});
      hear(tp.x,tp.y,'power',0.9);
      SND.sabotage();
      witnessAlienAction(me,me.x,me.y,6,'bot');
      aiHear('robot_down',me.x,me.y,18,{actor:me});
      envNotice('robot',tp.x,tp.y,0.5);
      toast(target.kind==='secbot'?'破坏成功：保安机器人今晚停摆':'破坏成功：医疗机器人今晚停摆');
      runInvariants('sabotageBot');
    }
    function sabotage(){
      const me=G.me;
      /* 幽灵不能施展破坏 —— 异形死后仍能维修，但破坏技只属于活着的异形 */
      if(!me.alive){ toast('幽灵无法破坏'); return; }
      if(me.downed||me.detained){ toast('当前状态无法破坏'); return; }
      if(!me.alien){ toast('你做不到'); return; }
      if(me.sabUsed){ toast('今晚已经破坏过了'); return; }
      if(G.sabPick)return;
      /* 异形按 H：贴着机器人时轮盘选择「停摆机器人 / 破坏舱室」；只贴身时给机器人选项 */
      let target=null,tp=null,td=1.8;
      for(const f of M.facility){
        if(f.kind!=='medbot'&&f.kind!=='secbot')continue;
        if(f.kind==='secbot'&&G.secbotDead)continue;
        if(f.kind==='medbot'&&G.medbotDead)continue;
        const p=botPos(f.kind); if(!p)continue;
        const d=Math.hypot(p.x-me.x,p.y-me.y);
        if(d<td){td=d;target=f;tp=p;}
      }
      if(target){
        const botOpt={id:'sab-bot',
          short:'停摆'+(target.kind==='secbot'?'保安机器人':'医疗机器人'),
          run:()=>sabotageBot(target,tp)};
        const roomOpt={id:'sab-room',short:'破坏舱室',run:()=>openSabPick()};
        openWheel([botOpt,roomOpt]);
        return;
      }
      openSabPick();
    }

    function rescue(){
      const me=G.me; if(!me.alive||me.downed)return;
      if(me.medkit<1){toast('没有医疗包');return;}
      let best=null,bd=1.8;
      for(const a of G.agents) if(a.downed&&a.alive){
        const d=Math.hypot(a.x-me.x,a.y-me.y); if(d<bd){bd=d;best=a;}}
      if(!best){toast('附近没有濒死者');return;}
      const dg=draggerOf(best);
      if(dg)releaseDragBy(dg,true);
      best.draggedBy=null;
      me.path=null;me.moving=false;
      me.doing=5; me._dur=5; me._doing='revive'; me._rv=best; toast('施救中 5s');
    }
    function attack(){
      const me=G.me;
      if(G.over||G.meet||G.inspect)return;
      if(!me.alive){toast('幽灵无法攻击');return;}
      if(me.downed||me.detained)return;
      if(!me.alien){toast('人类没有刀：按 B 开枪');return;}
      stab();
    }
    function stab(){
      const me=G.me;
      if(me.knife<1){toast('今晚的刀已经用掉了');return;}
      let best=null,bd=1.35,botKind=null;
      for(const a of G.agents){
        if(a===me||!a.alive||a.downed)continue;
        const d=Math.hypot(a.x-me.x,a.y-me.y);
        if(d<bd&&losNow(me.x,me.y,a.x,a.y)){bd=d;best=a;botKind=null;}
      }
      for(const kind of ['secbot','medbot']){
        if(botDead(kind))continue;
        const p=botPos(kind); if(!p)continue;
        const d=Math.hypot(p.x-me.x,p.y-me.y);
        if(d<bd&&losNow(me.x,me.y,p.x,p.y)){bd=d;best=null;botKind=kind;}
      }
      if(!best&&!botKind){toast('近身没有目标（1.3 格内、无遮挡）');return;}
      if(botKind){
        if(!knifeBot(me,botKind)){toast('这一刀没有砍到机器人');return;}
        toast('出刀：'+(botKind==='secbot'?'保安机器人':'医疗机器人')+'装甲受击 · 刀数 -1');
        return;
      }
      knife(me,best);
      toast('出刀：'+best.name+' 濒死');
    }
    /* 开枪的公共结算：玩家与 AI 共用一套射程 / 遮挡 / 声纹 / 目击逻辑，
       AI 开枪同样要留下 pendingCrime，保安机器人才能按规则抓人 */
    function fireShot(shooter,target){
      if(!shooter||!target||!target.alive||target.downed)return false;
      if(shooter.bullet<1)return false;
      shooter.bullet--;
      G.pendingCrime=shooter.i;
      if(target===G.me&&G.dev){
        const ang=Math.atan2(target.y-shooter.y,target.x-shooter.x);
        setAct(shooter,'shoot',0.5,{ang});
        G.fx.push({type:'shield',x:target.x,y:target.y,t:0.6,dur:0.6});
        if(shooter!==G.me){shooter.target=null;shooter.path=null;}
        toast('DEV 无敌：这一枪没有生效');
        return false;
      }
      const ang=Math.atan2(target.y-shooter.y,target.x-shooter.x);
      setAct(shooter,'shoot',0.55,{ang});
      setAct(target,'hurt',0.55,{ang});
      G.fx.push({type:'tracer',x1:shooter.x,y1:shooter.y,x2:target.x,y2:target.y,t:0.45,dur:0.45,ang});
      G.fx.push({type:'muzzle',x:shooter.x+Math.cos(ang)*0.55,y:shooter.y+Math.sin(ang)*0.55,t:0.2,dur:0.2,ang});
      G.fx.push({type:'impact',x:target.x,y:target.y,t:0.55,dur:0.55});
      G.fx.push({type:'blood',x:target.x,y:target.y,t:0.9,dur:0.9,ang});
      SND.shot();
      hear(shooter.x,shooter.y,'shot',1.15);
      target.downed=true; target.downAt=G.t; target.path=null; target.doing=0;
      target._doing=null; target._sv=null;
      target.downX=target.x; target.downY=target.y; target.killedBy=shooter.i;
      target.woundCause='shot'; target.downRoom=roomIdAt(target.x,target.y);
      target.searched=false;
      noticeAction(shooter,shooter.x,shooter.y,7,'shot',target);
      aiHear('shot',shooter.x,shooter.y,20,{actor:shooter,victim:target});
      screamFor(target);
      if(target===G.me){closeSabPick(true);G.sabTarget=null;toast('你被击中，濒死');}
      else if(shooter===G.me) toast('开枪击中 '+target.name);
      return true;
    }
    function botDead(kind){return kind==='secbot'?!!G.secbotDead:!!G.medbotDead;}
    function botHp(kind){
      if(!G.botHp)G.botHp={secbot:2,medbot:1};
      if(G.botHp[kind]==null)G.botHp[kind]=kind==='secbot'?2:1;
      return G.botHp[kind];
    }
    /* 出刀打机器人的公共入口：玩家 Q 与 AI 异形共用，
       必须消耗刀数并按装甲 HP（保安 2 / 医疗 1）结算，不允许"一刀拆死" */
    function knifeBot(a,kind){
      if(!a||a.knife<1)return false;
      if(botDead(kind))return false;
      const p=botPos(kind); if(!p)return false;
      if(Math.hypot(p.x-a.x,p.y-a.y)>=1.8)return false;
      if(!losNow(a.x,a.y,p.x,p.y))return false;
      a.knife--;
      if(!damageBot(kind,a,'knife')){ a.knife++; return false; }
      return true;
    }
    /* 机器人受击：刀/枪都可摧毁；保安存活时会面向袭击者并尝试反制拘留 */
    function damageBot(kind,attacker,cause){
      if(!G||G.over||!attacker||!attacker.alive||attacker.downed||attacker.detained)return false;
      if(kind!=='secbot'&&kind!=='medbot')return false;
      if(botDead(kind))return false;
      const p=botPos(kind); if(!p)return false;
      const hp=botHp(kind)-1;
      G.botHp[kind]=Math.max(0,hp);
      G.pendingCrime=attacker.i;
      /* 出刀打机器人也留下「刀者红身」与挥砍动作，和打人一刀的表现对齐 */
      if(cause==='knife'){
        const ang=Math.atan2(p.y-attacker.y,p.x-attacker.x);
        attacker.redT=3.0;
        setAct(attacker,'stab',0.5,{ang,lunge:0.55});
        SND.knife(Math.max(0.18,Math.min(1,1.25-Math.hypot(p.x-G.me.x,p.y-G.me.y)/16)));
      }
      if(kind==='secbot'&&G.bots&&G.bots.secbot){
        G.bots.secbot.ang=Math.atan2(attacker.y-p.y,attacker.x-p.x);
        G.bots.secbot.face=attacker.x<p.x?-1:1;
      }
      G.fx.push({type:'spark',x:p.x,y:p.y,t:1.0,dur:1.0});
      G.fx.push({type:'alarm',x:p.x,y:p.y,t:0.9,dur:0.9});
      hear(p.x,p.y,'power',1.0);
      aiHear(cause==='shot'?'shot':'knife',p.x,p.y,16,{actor:attacker});
      noticeAction(attacker,attacker.x,attacker.y,6,cause==='shot'?'shot':'knife',null);
      SND.sabotage();
      const nm=kind==='secbot'?'保安机器人':'医疗机器人';
      if(G.botHp[kind]<=0){
        if(kind==='secbot')G.secbotDead=true; else{G.medbotDead=true;G.medbotLeft=0;}
        G.fx.push({type:'alarm',x:p.x,y:p.y,t:1.4,dur:1.4});
        toast(nm+'被摧毁 · 本夜停摆');
      }else{
        toast(nm+'装甲受损 · 剩余 '+G.botHp[kind]);
      }
      runInvariants('botDamage');
      return true;
    }
    function fireShotBot(shooter,kind){
      if(!shooter||shooter.bullet<1||botDead(kind))return false;
      const p=botPos(kind); if(!p)return false;
      if(Math.hypot(p.x-shooter.x,p.y-shooter.y)>=9)return false;
      if(!losNow(shooter.x,shooter.y,p.x,p.y))return false;
      if(shooter===G.me&&!visibleAt(p.x,p.y))return false;
      shooter.bullet--;
      G.pendingCrime=shooter.i;
      const ang=Math.atan2(p.y-shooter.y,p.x-shooter.x);
      setAct(shooter,'shoot',0.55,{ang});
      G.fx.push({type:'tracer',x1:shooter.x,y1:shooter.y,x2:p.x,y2:p.y,t:0.45,dur:0.45,ang});
      G.fx.push({type:'muzzle',x:shooter.x+Math.cos(ang)*0.55,y:shooter.y+Math.sin(ang)*0.55,t:0.2,dur:0.2,ang});
      G.fx.push({type:'impact',x:p.x,y:p.y,t:0.55,dur:0.55});
      SND.shot();hear(shooter.x,shooter.y,'shot',1.15);
      damageBot(kind,shooter,'shot');
      if(shooter===G.me)toast('开枪击中 '+(kind==='secbot'?'保安机器人':'医疗机器人'));
      return true;
    }
    function shoot(){
      const me=G.me;
      if(G.over||G.meet||G.inspect)return;
      if(!me.alive||me.downed||me.detained)return;
      if(me.bullet<1){toast('没有子弹');return;}
      let best=null,bd=1e9,botKind=null;
      for(const a of G.agents){
        if(a===me||!a.alive||a.downed)continue;
        const d=Math.hypot(a.x-me.x,a.y-me.y);
        /* 射程=视野：暗处看不见的人不能隔空打中（visibleAt 已含手电锥/亮房/遮挡） */
        if(d<9&&losNow(me.x,me.y,a.x,a.y)&&visibleAt(a.x,a.y)&&d<bd){bd=d;best=a;botKind=null;}
      }
      /* 机器人也是实体目标：鼠标靠近机器人时才把枪口切过去，避免误伤巡逻单位 */
      for(const kind of ['secbot','medbot']){
        if(botDead(kind))continue;
        const p=botPos(kind); if(!p)continue;
        const d=Math.hypot(p.x-me.x,p.y-me.y);
        const aimD=Math.hypot((G.aimX||me.x)-p.x,(G.aimY||me.y)-p.y);
        if(d<9&&aimD<1.2&&losNow(me.x,me.y,p.x,p.y)&&visibleAt(p.x,p.y)){
          bd=d;best=null;botKind=kind;
        }
      }
      if(!best&&!botKind){toast('视野内没有目标');return;}
      if(botKind){fireShotBot(me,botKind);return;}
      fireShot(me,best);
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
      if(!b.searched||(b.alive?false:bodyHasLoot(b))){
        me.path=null;me.moving=false;
        me.doing=1.2; me._dur=1.2; me._doing='search'; me._sv=b.i;
        SND.search();
        toast(b.alive?'检查伤情中…':'搜尸中… 会把身上的物资一起取走');
        return;
      }
      toast('已经检查过，身上也没有可带走的物资');
      if(G.inspect)closeBodyCard();else openBodyCard(b);
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
        row('伤口',bodyWound(b),true);
        row('时间',b.downAt!=null?('夜间剩余约 '+Math.max(0,Math.round(b.downAt))+'s 时倒下'):'—');
        row('检查',b.searched?'已检查 · 伤口与拖拽痕迹完整':'未检查 · 按 X 搜查可获取细节',!b.searched);
        row('凶手',G.dev&&b.killedBy!=null?G.agents[b.killedBy].name:'无法判断');
      }else{
        row('状态','已死亡');
        row('死因',bodyWound(b));
        row('死亡地点',roomNameById(b.deathRoom));
        row('死亡时间','第 '+G.night+' 夜 · 倒计时约 '+Math.max(0,Math.round(b.deathAt||0))+'s');
        row('尸体',b.bodyMoved?'被移动过 · 现场被布置':'未被移动',b.bodyMoved);
        row('检查',b.searched?'已检查 · 伤口与拖拽痕迹完整':'未检查 · 按 S 搜尸可取证并取物资',!b.searched);
        row('凶手',G.dev&&b.killedBy!=null?G.agents[b.killedBy].name:'无法判断');
      }
      const it=bodyItemsText(b);
      row('携带物资',it||'无');
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
      if(startDrag(me,b,true)){
        const bp0=bodyPos(b);
        if(bp0)noticeAction(me,bp0[0],bp0[1],6,'drag',b);
        aiHear('drag',me.x,me.y,8,{actor:me});
        SND.drag(0.7); hear(me.x,me.y,'drag',0.8);
        toast('拖拽 '+b.name+' · 移动变慢，再按 G 放下');
        runInvariants('drag');
      }
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
        scream:['audio/sfx-scream-01.ogg','audio/sfx-scream-02.ogg'],
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
        g.gain.setValueAtTime((vol||0.10)*master,c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0008,c.currentTime+dur);
        o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+dur+0.02);
      }
      function noise(dur,vol,hp){
        if(!on)return; const c=C(); if(!c)return;
        const n=Math.floor(c.sampleRate*dur), b=c.createBuffer(1,n,c.sampleRate), d=b.getChannelData(0);
        for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
        const src=c.createBufferSource(); src.buffer=b;
        const g=c.createGain(); g.gain.setValueAtTime((vol||0.2)*master,c.currentTime);
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
        const g=c.createGain(); g.gain.setValueAtTime((vol||0.2)*master,c.currentTime);
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
        getMaster:function(){return master;},
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
          /* 换成更轻的 CC0 木地板脚步，并整体压低；AI 只在近处播放 */
          if(!play('step',(vol==null?0.4:vol)*0.38,1.02+Math.random()*0.12)) beep(150,120,0.05,'sine',0.03);
        },
        scream:function(vol){
          /* 被击倒时的喊叫：公开 CC0 死亡/受创人声采样；不写播放日志 */
          if(!play('scream',Math.max(0.06,Math.min(0.65,vol==null?0.45:vol)),0.96+Math.random()*0.08)){
            noise(0.12,0.07,600); beep(300,160,0.18,'sawtooth',0.04);
          }
        },
        interact:function(){ if(!play('door',0.5,1)) beep(520,700,0.07,'triangle',0.07); },
        doorAuto:function(vol){
          /* 自动门不写播放日志，避免干扰「一次出刀只响一次」的断言 */
          if(!play('door',(vol==null?0.4:vol)*0.65,0.92)) beep(240,180,0.09,'square',0.035);
        },
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
    loadImg('door','v4/tex/door-panel.png');
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
    /* 人形机器人：脚在 (x,y)，总高约 1.15 格（与船员视觉同高）。
       自绘而不用船员素材：设施要能随时改配色/停摆态，且机器人没有 4 向行走图。 */
    function drawRobotBody(T,x,y,s,o){
      const dead=!!o.dead, face=o.face<0?-1:1, moving=!dead&&!!o.moving;
      const swing=moving?Math.sin(T*8):0;
      /* 身体颠簸 0.03 格；停摆时头部下沉 0.1 格，腿不摆 */
      const bob=moving?Math.abs(Math.sin(T*8))*0.03*s:0;
      const sink=dead?0.1*s:0;
      const base=dead?'#5B6572':o.base;
      const dark=dead?'#39404A':'rgba(12,16,21,.97)';
      ctx.save();ctx.translate(x,y);ctx.scale(face,1);
      ctx.fillStyle='rgba(0,0,0,.32)';
      ctx.beginPath();ctx.ellipse(0,0,.34*s,.12*s,0,0,7);ctx.fill();
      ctx.lineCap='round';
      /* 两条腿：前后摆动 */
      ctx.strokeStyle=base;ctx.lineWidth=.11*s;
      ctx.beginPath();ctx.moveTo(-.09*s,-.42*s+bob*.5);
      ctx.lineTo(-.09*s+swing*.16*s,0);ctx.stroke();
      ctx.beginPath();ctx.moveTo(.09*s,-.42*s+bob*.5);
      ctx.lineTo(.09*s-swing*.16*s,0);ctx.stroke();
      /* 手臂与腿反相摆动 */
      ctx.strokeStyle=dead?'#4E5663':base;ctx.lineWidth=.09*s;
      ctx.beginPath();ctx.moveTo(-.19*s,-.74*s+bob);
      ctx.lineTo(-.24*s-swing*.10*s,-.48*s+bob);ctx.stroke();
      ctx.beginPath();ctx.moveTo(.19*s,-.74*s+bob);
      ctx.lineTo(.24*s+swing*.10*s,-.48*s+bob);ctx.stroke();
      /* 躯干 + 头 */
      ctx.fillStyle=dark;ctx.strokeStyle=base;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.roundRect(-.21*s,-.84*s+bob,.42*s,.44*s,4);ctx.fill();ctx.stroke();
      ctx.beginPath();ctx.arc(0,-1.0*s+bob+sink,.155*s,0,7);ctx.fill();ctx.stroke();
      /* 目镜 */
      ctx.fillStyle=dead?'rgba(90,100,115,.5)':o.accent;
      ctx.fillRect(-.08*s,-1.01*s+bob+sink,.16*s,.045*s);
      if(o.kind==='medbot'){
        /* 胸口十字 */
        ctx.fillStyle=dead?'#5B6572':o.accent;
        ctx.fillRect(-.05*s,-.69*s+bob,.1*s,.22*s);
        ctx.fillRect(-.11*s,-.63*s+bob,.22*s,.1*s);
      }else{
        /* 肩部警示条 + 胸前指示灯 */
        ctx.fillStyle=dead?'#5B6572':'#F0C674';
        ctx.fillRect(-.21*s,-.82*s+bob,.16*s,.055*s);
        ctx.fillStyle=dead?'#5B6572':o.accent;
        ctx.beginPath();ctx.arc(.08*s,-.64*s+bob,.035*s,0,7);ctx.fill();
      }
      ctx.restore();
    }
    function drawBotLabel(f,x,y,s,dead){
      const left=G.medbotLeft==null?2:G.medbotLeft;
      const exhausted=f.kind==='medbot'&&!dead&&left<=0;
      const text=f.label+(dead?' · 停摆':(exhausted?' · 电量耗尽':
        (f.kind==='medbot'?' · 电量 '+left+'/2':
          (f.kind==='secbot'?' · 拘留 '+((G.secbotUses||0))+'/3':' · 在线'))));
      ctx.font='500 9.5px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
      const w=ctx.measureText(text).width+10,h=13,ly=y+0.62*s;
      /* 医疗间地面偏亮，纯文字标签会糊进底图，加一层暗底保证可读 */
      ctx.fillStyle=(dead||exhausted)?'rgba(8,11,16,.55)':'rgba(8,11,16,.72)';
      ctx.beginPath();ctx.roundRect(x-w/2,ly-h/2,w,h,4);ctx.fill();
      ctx.strokeStyle=(dead||exhausted)?'rgba(190,160,100,.35)':'rgba(126,142,164,.35)';
      ctx.lineWidth=1;ctx.stroke();
      ctx.fillStyle=dead?'rgba(170,180,195,.75)':(exhausted?'rgba(230,190,120,.9)':'rgba(225,238,248,.92)');
      ctx.fillText(text,x,ly+0.5);
    }
    /* 设施：电闸 / 监控台 / 医疗机器人 / 保安机器人 / 拘留区 */
    function drawFacilities(T){
      const s=VIEW.s;
      for(const f of M.facility){
        /* 机器人按巡逻运行时坐标画，设施表里的 x/y 只是初始位 */
        const rp=(f.kind==='medbot'||f.kind==='secbot')?botPos(f.kind):null;
        const x=SX(rp?rp.x:f.x),y=SY(rp?rp.y:f.y);
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
        }else if(f.kind==='supply'){
          const ammo=f.item==='ammo';
          ctx.save();ctx.translate(x,y);
          ctx.fillStyle='rgba(10,14,20,.95)';
          ctx.strokeStyle=ammo?'#6B4E19':'#1F5A46';ctx.lineWidth=1.5;
          ctx.beginPath();ctx.roundRect(-0.54*s,-0.48*s,1.08*s,0.82*s,4);ctx.fill();ctx.stroke();
          ctx.fillStyle=ammo?'rgba(224,169,75,.18)':'rgba(63,191,140,.18)';
          ctx.fillRect(-0.44*s,-0.38*s,0.88*s,0.24*s);
          ctx.strokeStyle=ammo?'rgba(224,169,75,.5)':'rgba(63,191,140,.5)';ctx.lineWidth=1;
          ctx.strokeRect(-0.44*s,-0.38*s,0.88*s,0.24*s);
          drawIcon(ammo?'bullet':'cross',ammo?'#E0A94B':'#3FBF8C',0,0.06*s,0.62*s,0);
          ctx.fillStyle=ammo?'#E0A94B':'#3FBF8C';
          ctx.beginPath();ctx.arc(0.42*s,-0.31*s,0.045*s,0,7);ctx.fill();
          ctx.font='500 9px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillStyle=ammo?'rgba(255,224,163,.9)':'rgba(185,245,218,.9)';
          ctx.fillText(f.label,0,-0.64*s);
          ctx.restore();
        }else if(f.kind==='medbot'){
          const dead=!!G.medbotDead;
          const left=G.medbotLeft==null?2:G.medbotLeft;
          const exhausted=!dead&&left<=0;
          const b=G.bots&&G.bots.medbot;
          ctx.save();
          if(!dead&&!exhausted){
            const rad=ctx.createRadialGradient(x,y,0,x,y,1.1*s);
            rad.addColorStop(0,'rgba(63,191,140,.20)');rad.addColorStop(1,'rgba(63,191,140,0)');
            ctx.fillStyle=rad;ctx.beginPath();ctx.arc(x,y,1.1*s,0,7);ctx.fill();
          }
          drawRobotBody(T,x,y,s,{kind:'medbot',dead:dead,face:b?b.face:1,
            moving:!!(b&&b.moving),base:exhausted?'#8A6A45':'#3FBF8C',
            accent:exhausted?'#D4B070':'#7FE3B4'});
          if(G.medbotT>0&&!dead&&!exhausted){
            /* 施救进度环：圆心钉在运行时坐标，机器人边走环边跟着 */
            ctx.strokeStyle='rgba(127,227,180,'+(0.35+0.35*Math.sin(T*10)).toFixed(2)+')';ctx.lineWidth=2;
            ctx.beginPath();ctx.arc(x,y-0.6*s,(0.55+0.65*Math.min(1,G.medbotT/3))*s,0,7);ctx.stroke();
          }
          drawBotLabel(f,x,y,s,dead);
          ctx.restore();
        }else if(f.kind==='secbot'){
          const dead=!!G.secbotDead;
          const used=!!G.secbotUsed;
          const b=G.bots&&G.bots.secbot;
          ctx.save();
          if(!dead){
            const scan=T*0.9;
            const fa=b&&Number.isFinite(b.ang)?b.ang:0;
            /* 180° 前方扇形：实际判定范围在 botTick，这里是朝向提示 */
            ctx.fillStyle='rgba(255,107,97,.035)';ctx.strokeStyle='rgba(255,107,97,.16)';ctx.lineWidth=1.2;
            ctx.beginPath();ctx.moveTo(x,y-0.55*s);
            ctx.arc(x,y-0.55*s,2.5*s,fa-SEC_ARC,fa+SEC_ARC);ctx.closePath();
            ctx.fill();ctx.stroke();
            ctx.strokeStyle='rgba(255,107,97,.28)';ctx.lineWidth=1.6;
            ctx.beginPath();ctx.arc(x,y-0.55*s,2.1*s,scan-0.34,scan+0.34);ctx.stroke();
            ctx.beginPath();ctx.arc(x,y-0.55*s,2.1*s,scan+Math.PI-0.34,scan+Math.PI+0.34);ctx.stroke();
            if(G.secbotT>0){
              ctx.strokeStyle='rgba(255,107,97,'+(0.5+0.4*Math.sin(T*16)).toFixed(2)+')';ctx.lineWidth=2.6;
              ctx.beginPath();ctx.arc(x,y-0.55*s,(1.1+0.8*(1.6-G.secbotT))*s,0,7);ctx.stroke();
            }
          }
          /* 已擒拿过的当晚转琥珀色，保留原有"本夜用过"的信息 */
          drawRobotBody(T,x,y,s,{kind:'secbot',dead:dead,face:b?b.face:1,
            moving:!!(b&&b.moving),base:used?'#8A6A45':'#FF6B61',
            accent:used?'#C9A46B':'#FFB4A8'});
          drawBotLabel(f,x,y,s,dead);
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
    function drawPipes(T){      const s=VIEW.s;
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
    /* 圆桌上的物资申请单：有待领时显示金色单据与脉冲环 */
    function drawReqTable(T){
      const t=roundTableCover(); if(!t)return;
      const x=SX(t.x+t.w/2), y=SY(t.y+t.h/2);
      const pend=G.me.qualPending||0, s=VIEW.s;
      const a=pend?0.55+0.25*Math.sin(T*4.5):0.24;
      ctx.save();ctx.translate(x,y-0.08*s);
      ctx.globalAlpha=pend?1:0.55;
      ctx.fillStyle='rgba(240,198,116,.92)';
      ctx.fillRect(-0.12*s,-0.17*s,0.24*s,0.32*s);
      ctx.strokeStyle='rgba(255,244,210,.95)';ctx.lineWidth=1;
      ctx.strokeRect(-0.12*s,-0.17*s,0.24*s,0.32*s);
      ctx.strokeStyle='rgba(90,66,20,.8)';ctx.lineWidth=.8;
      for(let i=0;i<3;i++){
        ctx.beginPath();ctx.moveTo(-0.07*s,(-0.09+i*0.075)*s);ctx.lineTo(0.07*s,(-0.09+i*0.075)*s);ctx.stroke();
      }
      if(pend){
        ctx.strokeStyle='rgba(240,198,116,'+a.toFixed(2)+')';ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(0,0,0.48*s,0,7);ctx.stroke();
        ctx.font='600 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
        const label='物资申请单 · 待领 '+pend;
        const w=ctx.measureText(label).width+14,ly=-0.76*s;
        ctx.fillStyle='rgba(30,22,6,.88)';
        ctx.beginPath();ctx.roundRect(-w/2,ly-9,w,18,5);ctx.fill();
        ctx.strokeStyle='rgba(240,198,116,.7)';ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle='#FFE8B0';ctx.fillText(label,0,ly+0.5);
      }
      ctx.restore();
    }
    /* 自动门：横向门用立式双开门板，纵向门用贴地滑轨；无人闭合、有人靠近滑开。 */
    /* 自动门：2.5D 只画「门的顶面」。
       相机固定从北侧俯视，立式门板会露出一整块正立面、从上下两侧看还不一样；
       这里统一成一块被抬到墙顶高度的薄板（两块门板左右滑开），
       横门 / 竖门只是旋转 90°，看上去始终是"门的最上面那一层"。 */
    function drawDoors(T){
      if(!G||!G.doors)return;
      const s=VIEW.s, im=IMG['door'], readyIm=ready(im);
      const LIFT=0.24*s;              /* 与墙顶在 12° 俯视下的屏幕位移对齐 */
      for(const d of G.doors){
        const cx=SX(d.x), cy=SY(d.y), open=d.open;
        const len=d.w*s, dep=0.40*s;
        /* 地面滑轨 / 门槛：贴地，给"这里能过去"的方向感 */
        ctx.save();
        ctx.translate(cx,cy);
        if(!d.horiz)ctx.rotate(Math.PI/2);
        ctx.fillStyle='rgba(6,9,13,.55)';
        ctx.beginPath();ctx.roundRect(-len/2-0.06*s,-dep/2,len+0.12*s,dep,2);ctx.fill();
        ctx.fillStyle='rgba(255,176,32,.10)';
        ctx.fillRect(-len/2,-dep/2+0.5,len,Math.max(1,0.02*s));
        ctx.restore();
        /* 门顶面 */
        ctx.save();
        ctx.translate(cx,cy-LIFT);
        if(!d.horiz)ctx.rotate(Math.PI/2);
        /* 侧面厚度：只留 2px 暗边，不画正立面 */
        ctx.fillStyle='rgba(0,0,0,.55)';
        ctx.beginPath();ctx.roundRect(-len/2,-dep/2+2,len,dep,2);ctx.fill();
        ctx.fillStyle='rgba(24,31,40,.98)';
        ctx.beginPath();ctx.roundRect(-len/2,-dep/2,len,dep,2);ctx.fill();
        ctx.strokeStyle='rgba(120,140,160,.38)';ctx.lineWidth=1;
        ctx.beginPath();ctx.roundRect(-len/2,-dep/2,len,dep,2);ctx.stroke();
        ctx.save();
        ctx.beginPath();ctx.rect(-len/2+1,-dep/2+1,len-2,dep-2);ctx.clip();
        const slide=open*(len/2+0.04*s), alpha=1-open*0.55;
        if(readyIm){
          const sw=im.naturalWidth/2, sh=im.naturalHeight;
          ctx.globalAlpha=alpha;
          ctx.drawImage(im,0,0,sw,sh,-len/2-slide,-dep/2,len/2,dep);
          ctx.drawImage(im,sw,0,sw,sh,slide,-dep/2,len/2,dep);
          ctx.globalAlpha=1;
        }else{
          ctx.fillStyle='#4A5563';
          ctx.fillRect(-len/2-slide,-dep/2,len/2,dep);
          ctx.fillRect(slide,-dep/2,len/2,dep);
        }
        if(open<0.5){
          ctx.strokeStyle='rgba(255,170,90,'+(0.45+0.25*Math.sin(T*5+d.x)).toFixed(2)+')';
          ctx.lineWidth=1;
          ctx.beginPath();ctx.moveTo(0,-dep/2+1);ctx.lineTo(0,dep/2-1);ctx.stroke();
        }
        ctx.restore();
        /* 顶面高光 + 状态灯：从哪一侧看都一样 */
        ctx.strokeStyle='rgba(200,225,245,.34)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(-len/2,-dep/2+0.5);ctx.lineTo(len/2,-dep/2+0.5);ctx.stroke();
        ctx.fillStyle=open>0.55?'rgba(127,211,240,.95)':'rgba(255,107,97,.95)';
        ctx.beginPath();ctx.arc(len/2-0.08*s,0,Math.max(1.6,0.045*s),0,7);ctx.fill();
        ctx.restore();
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
          g.save();
          g.beginPath();g.rect(cx+2,bodyY+2,tw-4,bodyH-4);g.clip();
          for(const a of G.agents){
            if(roomIdAt(a.x,a.y)!==r.id)continue;
            if(!a.alive&&a.bodyGone)continue;
            const ax=dx+(a.x-(r.rect[0]-pr))*wpx, ay=dy+(a.y-(r.rect[1]-pr))*wpx;
            if(ax<cx-2||ax>cx+tw+2||ay<bodyY-2||ay>cy+th+2)continue;
            const im=IMG['cr_'+((a.i%15)+1)];
            const w=Math.max(5,wpx*1.25),h=w*160/96;
            if(!a.alive||a.downed){
              if(ready(im)){
                g.save();g.translate(ax,ay);g.rotate(-Math.PI/2);
                g.globalAlpha=a.alive?0.9:0.62;
                g.drawImage(im,0,2*160,96,160,-w/2,-h/2,w,h);
                g.restore();g.globalAlpha=1;
              }else{
                g.strokeStyle=a.alive?'#FF8A80':'rgba(205,150,150,.72)';g.lineWidth=1.6;
                g.beginPath();g.moveTo(ax-3,ay-3);g.lineTo(ax+3,ay+3);
                g.moveTo(ax+3,ay-3);g.lineTo(ax-3,ay+3);g.stroke();
              }
              continue;
            }
            if(ready(im)){
              const row=ROW[a.dir]||2,fr=a.moving?(Math.floor(T*7)%4):0;
              g.drawImage(im,fr*96,row*160,96,160,ax-w/2,ay-h*0.86,w,h);
            }else{
              g.fillStyle=a===G.me?'#F0C674':'#DDE6F0';
              g.beginPath();g.arc(ax,ay,2.6,0,7);g.fill();
              g.strokeStyle='rgba(0,0,0,.6)';g.lineWidth=0.8;g.stroke();
            }
            if(a.detained){g.strokeStyle='#7FD3F0';g.lineWidth=1;g.beginPath();g.arc(ax,ay,4.6,0,7);g.stroke();}
          }
          g.restore();
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
      const stabAct=!!(a.act&&a.act.kind==='stab');
      const shootAct=!!(a.act&&a.act.kind==='shoot');
      const showGun=a.bullet>0||shootAct;
      if(a.alien&&(stabAct||!showGun)){
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
        if(!showGun&&!isMe&&!G.dev&&!acting)return;
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
          ctx.strokeText('申请单 +1',x,y+1);
          ctx.fillText('申请单 +1',x,y+1);
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

    /* 任务目标闪烁：直接从烘焙底图取物体像素做金色叠加，让家具本体发亮，
       不再用黄色虚线边框把物体圈起来。 */
    const TASK_PULSE={};
    function taskPulseLayer(cov){
      const key=cov.room+'|'+cov.label;
      if(Object.prototype.hasOwnProperty.call(TASK_PULSE,key))return TASK_PULSE[key];
      const base=IMG['base'];
      if(!ready(base))return null;
      const bw=base.naturalWidth/M.bounds.w, bh=base.naturalHeight/M.bounds.h;
      const wx=cov.x-0.12, wy=cov.y-0.42, ww=cov.w+0.24, wh=cov.h+0.52;
      const sx=Math.max(0,Math.floor(wx*bw)), sy=Math.max(0,Math.floor(wy*bh));
      const sw=Math.min(base.naturalWidth-sx,Math.ceil(ww*bw));
      const sh=Math.min(base.naturalHeight-sy,Math.ceil(wh*bh));
      if(sw<=0||sh<=0){TASK_PULSE[key]=null;return null;}
      const c=document.createElement('canvas');c.width=sw;c.height=sh;
      const g=c.getContext('2d');
      g.drawImage(base,sx,sy,sw,sh,0,0,sw,sh);
      g.globalCompositeOperation='source-atop';
      g.fillStyle='rgba(255,196,64,0.95)';
      g.fillRect(0,0,sw,sh);
      const rec={c,x:sx/bw,y:sy/bh,w:sw/bw,h:sh/bh};
      TASK_PULSE[key]=rec;
      return rec;
    }
    function drawTaskCoverFlash(cov,alpha){
      const lay=taskPulseLayer(cov);
      if(!lay){
        const x=SX(cov.x+cov.w/2),y=SY(cov.y+cov.h/2);
        const rr=(Math.max(cov.w,cov.h)/2+0.5)*VIEW.s;
        const rad=ctx.createRadialGradient(x,y,0,x,y,rr);
        rad.addColorStop(0,'rgba(255,205,60,'+alpha.toFixed(2)+')');
        rad.addColorStop(1,'rgba(255,205,60,0)');
        ctx.fillStyle=rad;ctx.beginPath();ctx.arc(x,y,rr,0,7);ctx.fill();
        return;
      }
      ctx.save();
      ctx.globalCompositeOperation='screen';
      ctx.globalAlpha=Math.max(0,Math.min(0.72,alpha));
      ctx.drawImage(lay.c,SX(lay.x),SY(lay.y),lay.w*VIEW.s,lay.h*VIEW.s);
      ctx.restore();
      G.gfx.coverFlashes++;
    }

    /* 本人任务标记：画在迷雾之上，当前任务带名称，其余剩余任务只留金色脉冲 */
    function drawTaskMarkers(T,myLeft){
      if(!myLeft||!myLeft.length)return;
      const s=VIEW.s;
      for(let k=0;k<myLeft.length;k++){
        const p=M.points[myLeft[k]]; if(!p)continue;
        const x=SX(p.x),y=SY(p.y),cur=k===0;
        const pulse=0.5+0.35*(0.5+0.5*Math.sin(T*(cur?5.5:3.5)+p.x));
        const rad=ctx.createRadialGradient(x,y,0,x,y,(cur?1.15:0.85)*s);
        rad.addColorStop(0,'rgba(255,205,60,'+(cur?0.20:0.11)+')');
        rad.addColorStop(1,'rgba(255,205,60,0)');
        ctx.fillStyle=rad;ctx.beginPath();ctx.arc(x,y,(cur?1.15:0.85)*s,0,7);ctx.fill();
        const cov=M.cover.find(c=>p.x>=c.x-.25&&p.x<=c.x+c.w+.25&&p.y>=c.y-.25&&p.y<=c.y+c.h+.25);
        ctx.save();
        if(cov){
          drawTaskCoverFlash(cov,cur?0.26+0.26*pulse:0.10+0.10*pulse);
        }else{
          G.gfx.dashedBorders++;
          ctx.strokeStyle='rgba(255,205,60,'+(cur?0.92*pulse+0.08:0.48).toFixed(2)+')';
          ctx.lineWidth=cur?2.4:1.6;ctx.setLineDash([5,4]);ctx.lineDashOffset=-T*14;
          ctx.beginPath();ctx.arc(x,y,(cur?0.95:0.62)*s,0,7);ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.fillStyle='rgba(255,205,60,.95)';
        ctx.beginPath();ctx.arc(x,y,cur?3.2:2.2,0,7);ctx.fill();
        ctx.restore();
        if(cur){
          const label='任务 · '+p.label;
          ctx.font='600 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
          const w=ctx.measureText(label).width+16,ly=y-1.35*s;
          ctx.fillStyle='rgba(30,22,6,.88)';
          ctx.beginPath();ctx.roundRect(x-w/2,ly-9,w,18,5);ctx.fill();
          ctx.strokeStyle='rgba(255,205,60,.7)';ctx.lineWidth=1;ctx.stroke();
          ctx.fillStyle='#FFE8B0';ctx.fillText(label,x,ly+0.5);
        }
      }
    }

    /* 刀者红身：把行走图整张染红后按帧复用，避免每帧重绘 */
    const TINT_SHEETS={};
    function tintedSheet(im){
      if(!im||!im.src)return null;
      const hit=TINT_SHEETS[im.src];
      if(hit)return hit;
      try{
        const c=document.createElement('canvas');
        c.width=im.naturalWidth||im.width;
        c.height=im.naturalHeight||im.height;
        const g=c.getContext('2d');
        g.drawImage(im,0,0);
        g.globalCompositeOperation='source-atop';
        g.fillStyle='rgba(255,38,28,0.62)';
        g.fillRect(0,0,c.width,c.height);
        TINT_SHEETS[im.src]=c;
        return c;
      }catch(e){return null;}
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
      drawReqTable(T);
      drawDoors(T);
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
      // 任务点：他人的任务只留地面暗点；自己的任务标记画在迷雾之上（drawTaskMarkers）
      const myLeft=me.tasks.slice(me.tIdx);
      for(const p of M.points){
        const idx=M.points.indexOf(p);
        if(myLeft.indexOf(idx)>=0)continue;
        ctx.beginPath();ctx.arc(SX(p.x),SY(p.y),2.2,0,7);
        ctx.fillStyle='rgba(120,130,145,.3)';ctx.fill();
      }
      /* 被破坏的设备：红色脉冲 + 倒计时，所有人都看得到（这是全船警报） */
      for(const dm of G.dmg){
        const a=0.42+0.4*(0.5+0.5*Math.sin(T*6.5));
        ctx.save();
        ctx.strokeStyle='rgba(255,90,78,'+a.toFixed(2)+')';ctx.lineWidth=2.4;
        ctx.setLineDash([5,4]);ctx.lineDashOffset=-T*20;
        ctx.beginPath();ctx.arc(SX(dm.x),SY(dm.y),1.7*VIEW.s,0,7);ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();ctx.arc(SX(dm.x),SY(dm.y),0.55*VIEW.s,0,7);
        ctx.fillStyle='rgba(255,70,58,'+a.toFixed(2)+')';ctx.fill();
        ctx.restore();
        ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.lineWidth=3;ctx.strokeStyle='rgba(22,4,4,.9)';
        const s='故障 '+Math.max(0,Math.ceil(dm.left))+'s';
        ctx.strokeText(s,SX(dm.x),SY(dm.y)-2.2*VIEW.s);
        ctx.fillStyle='#FF9A90';ctx.fillText(s,SX(dm.x),SY(dm.y)-2.2*VIEW.s);
      }
      /* 玩家异形的破坏目标：紫色虚线指引到舱室 */
      if(me.alien&&me.alive&&!me.sabUsed&&G.sabTarget){
        const t=G.sabTarget;
        ctx.save();
        ctx.strokeStyle='rgba(168,150,255,'+(0.4+0.3*Math.sin(T*4)).toFixed(2)+')';
        ctx.lineWidth=2;ctx.setLineDash([7,6]);ctx.lineDashOffset=-T*16;
        ctx.beginPath();ctx.arc(SX(t.x),SY(t.y),1.9*VIEW.s,0,7);ctx.stroke();
        ctx.restore();
        ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.lineWidth=3;ctx.strokeStyle='rgba(10,6,20,.85)';
        ctx.strokeText('目标 · '+roomNameById(t.room),SX(t.x),SY(t.y)-2.3*VIEW.s);
        ctx.fillStyle='#C9BCFF';ctx.fillText('目标 · '+roomNameById(t.room),SX(t.x),SY(t.y)-2.3*VIEW.s);
      }
      // 靠近可交互物：E 收集所有选项，多项时提示打开交互轮盘
      if(!G.spectMode&&me.alive&&!me.downed&&!me.detained&&me.doing<=0&&!G.meet&&!G.over){
        const items=collectInteractions(me);
        const np=nearPoint(me);
        const npMine=!!(np&&myLeft.indexOf(M.points.indexOf(np))>=0);
        if(items.length){
          const nearItem=items.slice().sort((a,b)=>
            Math.hypot(a.x-me.x,a.y-me.y)-Math.hypot(b.x-me.x,b.y-me.y))[0];
          const label=items.length>1?('[E] 选择交互 · '+items.length+' 项'):items[0].pill;
          pill(label,SX(nearItem.x),SY(nearItem.y)-2.4*VIEW.s,nearItem.accent,nearItem.fg);
        }else{
          let bot=null,bp=null,botD=1.7;
          for(const f of M.facility){
            if(f.kind!=='medbot'&&f.kind!=='secbot')continue;
            const q=botPos(f.kind); if(!q)continue;
            const d=Math.hypot(q.x-me.x,q.y-me.y);
            if(d<botD){botD=d;bot=f;bp=q;}
          }
          if(bot){
            const dead=bot.kind==='secbot'?G.secbotDead:G.medbotDead;
            pill((bot.kind==='secbot'?'保安机器人':'医疗机器人')+(dead?' · 停摆':' · 在线'),
              SX(bp.x),SY(bp.y)-2.4*VIEW.s,
              dead?'rgba(120,130,145,.5)':'rgba(63,191,140,.7)',dead?'#8A94A3':'#9FE8C6');
          }else if(np&&!npMine){
            pill('设备没有响应',SX(np.x),SY(np.y)-2.4*VIEW.s,'rgba(120,130,145,.5)','#8A94A3');
          }
        }
      }
      // 尸体提示：报告 / 搜尸 / 拖拽 / 施救
      if(!G.spectMode&&me.alive&&!me.downed&&!G.meet&&!G.over&&me.doing<=0){
        const nb=bodyNear(2.2);
        if(nb){
          const bp=bodyPos(nb);
          if(bp&&visibleAt(bp[0],bp[1])){
            const lbl=nb.alive?'[R] 报告 · [S] 查看伤情 · [D] 收尸 · [F] 施救':'[R] 报告 · [S] 搜尸取物资 · [D] 收尸';
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
        if(!G.dev)drawNameTag(a,x,y-0.62*VIEW.s,!G.spectMode&&a.i===G.me.i);
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
          const dx=SX(a.x)-w/2+(off?off.x:0);
          const dy=SY(a.y)-h*0.86+(off?off.y:0)+bob;
          ctx.drawImage(im,fr*96,row*160,96,160,dx,dy,w,h);
          if(a.redT>0){
            const tim=tintedSheet(im);
            const k=Math.min(1,a.redT/1.8);
            const pulse=0.5+0.35*(0.5+0.5*Math.sin(T*15+a.i));
            if(tim){
              ctx.save();
              ctx.globalAlpha=Math.min(0.86,(0.38+0.34*pulse)*(0.35+0.65*k));
              ctx.drawImage(tim,fr*96,row*160,96,160,dx,dy,w,h);
              ctx.restore();
            }
            const rg=ctx.createRadialGradient(SX(a.x),SY(a.y)-0.5*VIEW.s,0,SX(a.x),SY(a.y)-0.5*VIEW.s,1.15*VIEW.s);
            rg.addColorStop(0,'rgba(255,52,38,'+(0.18*k).toFixed(2)+')');
            rg.addColorStop(1,'rgba(255,52,38,0)');
            ctx.fillStyle=rg;
            ctx.beginPath();ctx.arc(SX(a.x),SY(a.y)-0.5*VIEW.s,1.15*VIEW.s,0,7);ctx.fill();
            ctx.strokeStyle='rgba(255,92,72,'+(0.45*k+0.2).toFixed(2)+')';ctx.lineWidth=1.6;
            ctx.beginPath();ctx.arc(SX(a.x),SY(a.y),0.62*VIEW.s,0,7);ctx.stroke();
          }
        }else{
          ctx.beginPath();ctx.arc(SX(a.x),SY(a.y),5,0,7);
          ctx.fillStyle=a===me?'#F0C674':'#8FA6C0';ctx.fill();
        }
        if(a.doing>0)drawWork(a,T);
        drawWeapon(a,T);
        if(!G.dev){
          const topY=SY(a.y)-(ready(im)?(1.25*VIEW.s*160/96)*0.86:0)-9;
          drawNameTag(a,SX(a.x),topY,!G.spectMode&&a===me);
        }
        if(a===me&&!G.spectMode){ctx.strokeStyle='rgba(240,198,116,.7)';ctx.lineWidth=1.4;
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
        if(!G.dev)drawNameTag(a,x,y-(ready(im)?(1.15*VIEW.s*160/96)*0.86:0)-9,!G.spectMode&&a===me);
        ctx.strokeStyle='rgba(127,211,240,.5)';ctx.lineWidth=1.2;
        ctx.beginPath();ctx.arc(x,y,0.62*VIEW.s,0,7);ctx.stroke();
        if(a===me){
          ctx.strokeStyle='rgba(127,211,240,.8)';ctx.lineWidth=1.6;
          ctx.beginPath();ctx.arc(x,y,1.1*VIEW.s,0,7);ctx.stroke();
        }
      }
      /* 旁观者：第 16 人，只是一台相机幽灵（不参与对局、不进 15 席位） */
      if(G.spectMode&&G.spect){
        const sp=G.spect, x=SX(sp.x), y=SY(sp.y);
        const rad=ctx.createRadialGradient(x,y-0.4*VIEW.s,0,x,y-0.4*VIEW.s,1.6*VIEW.s);
        rad.addColorStop(0,'rgba(127,211,240,.22)');rad.addColorStop(1,'rgba(127,211,240,0)');
        ctx.fillStyle=rad;ctx.beginPath();ctx.arc(x,y-0.4*VIEW.s,1.6*VIEW.s,0,7);ctx.fill();
        ctx.save();
        ctx.strokeStyle='rgba(127,211,240,.85)';ctx.lineWidth=1.6;
        ctx.beginPath();ctx.arc(x,y,0.5*VIEW.s,0,7);ctx.stroke();
        ctx.beginPath();ctx.arc(x,y-0.62*VIEW.s,0.26*VIEW.s,0,7);ctx.stroke();
        ctx.restore();
        const txt='旁观者';
        ctx.font='600 11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';
        const w=ctx.measureText(txt).width+14;
        ctx.fillStyle='rgba(8,14,20,.85)';
        ctx.beginPath();ctx.roundRect(x-w/2,y-1.55*VIEW.s-9,w,18,5);ctx.fill();
        ctx.strokeStyle='rgba(127,211,240,.6)';ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle='#BFE9F7';ctx.fillText(txt,x,y-1.55*VIEW.s);
      }
      // 动作特效层（角色之上、雾之下）
      drawFx(d,T);
      // 拖拽绳：玩家与 AI 都能被看到；颜色不区分阵营，避免泄露异形身份
      for(const a of G.agents){
        if(a.drag==null)continue;
        if(a!==me&&!canSee(a))continue;
        const b=G.agents[a.drag],bp=b?bodyPos(b):null; if(!bp)continue;
        ctx.save();ctx.setLineDash([4,4]);
        ctx.strokeStyle=a===me?'rgba(240,198,116,.55)':'rgba(224,140,100,.42)';
        ctx.lineWidth=1.4;
        ctx.beginPath();ctx.moveTo(SX(a.x),SY(a.y));ctx.lineTo(SX(bp[0]),SY(bp[1]));ctx.stroke();ctx.restore();
      }
      drawFog();
      /* 本人任务点画在雾之上：夜里/隔墙也能看到目标舱室与设备位置 */
      drawTaskMarkers(T,G.spectMode?[]:myLeft);
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
      if(G.dev||G.spectMode){
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
          ctx.fillStyle=a.alien?'#FF7B72':((!G.spectMode&&a===G.me)?'#F0C674':'#7FD3F0');
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
        /* 小地图也读运行时坐标，否则机器人巡逻时图上仍停在坞位 */
        const bp=(f.kind==='medbot'||f.kind==='secbot')?botPos(f.kind):null;
        ctx.fillStyle=f.kind==='breaker'?'#E0A94B':'#3FBF8C';
        ctx.beginPath();ctx.arc(x+(bp?bp.x:f.x)*k,my+(bp?bp.y:f.y)*k,1.8,0,7);ctx.fill();
      }
      const mine=G.spectMode?[]:G.me.tasks.slice(G.me.tIdx);
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
      /* 故障：小地图上也给红点，跑图时不用记房间 */
      for(const dm of G.dmg){
        const pu=0.55+0.35*(0.5+0.5*Math.sin(T*6));
        ctx.fillStyle='rgba(255,90,78,'+pu.toFixed(2)+')';
        ctx.beginPath();ctx.arc(x+dm.x*k,my+dm.y*k,2.4,0,7);ctx.fill();
        ctx.strokeStyle='rgba(255,190,180,.9)';ctx.lineWidth=.8;
        ctx.beginPath();ctx.arc(x+dm.x*k,my+dm.y*k,3.6,0,7);ctx.stroke();
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
      /* 自己 / 旁观相机：金色脉冲 */
      const focus=camFocus();
      const myx=x+focus.x*k, myy=my+focus.y*k;
      const pulse=0.45+0.3*(0.5+0.5*Math.sin(T*4.2));
      ctx.strokeStyle='rgba(240,198,116,'+pulse.toFixed(2)+')';ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(myx,myy,5.5,0,7);ctx.stroke();
      ctx.fillStyle=G.spectMode?'#7FD3F0':(G.me.alive?'#F0C674':'#7FD3F0');
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

    /* 视野：幽灵/DEV 全知；活人 = 所在亮房 + 7 格手电锥 + 近身感知圈 */
    function visibleAt(x,y){
      if(G.dev||!G.fogOn||!G.me.alive)return true;
      const me=G.me;
      const r=roomAt(me.x,me.y);
      if(r&&G.lit[r.id]&&inPoly(x,y,r.poly)&&losNow(me.x,me.y,x,y))return true;
      const d=Math.hypot(x-me.x,y-me.y);
      /* 自带近身视野：人类 4.2 格，异形 5.6 格，不看朝向 */
      if(d<=(me.alien?ALIEN_DARK_R:HUMAN_DARK_R)&&losNow(me.x,me.y,x,y))return true;
      if(d>HUMAN_LIGHT_R)return false;
      if(!losNow(me.x,me.y,x,y))return false;
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
      /* 视野孔：手电锥（人与异形同款 7 格 / 60°）+ 近身感知圈
         （人类 4.2 格，异形 ×4/3 ≈ 5.6 格）。异形不再有全向远视野。 */
      const ax=me.x,ay=me.y;
      const a0=Math.atan2(G.aimY-ay,G.aimX-ax);
      const punch=(rad,span)=>{
        const N=span>=Math.PI*2?56:40;
        o.beginPath();o.moveTo(SX(ax),SY(ay));
        for(let i=0;i<=N;i++){
          const ang=a0-span/2+span*i/N;
          let t=rad;
          for(let st=0.4;st<rad;st+=0.3){
            const px=ax+Math.cos(ang)*st,py=ay+Math.sin(ang)*st;
            if(!free(px,py)){t=st;break;}
            let hit=false;
            for(const c of M.cover) if(px>c.x&&px<c.x+c.w&&py>c.y&&py<c.y+c.h){hit=true;break;}
            if(hit){t=st;break;}
          }
          o.lineTo(SX(ax+Math.cos(ang)*t),SY(ay+Math.sin(ang)*t));
        }
        o.closePath();o.fill();
      };
      punch(HUMAN_LIGHT_R,Math.PI/3);
      punch(me.alien?ALIEN_DARK_R:HUMAN_DARK_R,Math.PI*2);
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
      const spectator=!!G.spectMode;
      const pers=document.getElementById('personal');
      if(pers)pers.classList.toggle('hide',spectator);
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
      const qpEl=document.getElementById('qp');
      if(qpEl)qpEl.textContent=G.me.qualPending||0;
      document.getElementById('bl').textContent=G.me.bullet;
      document.getElementById('md').textContent=G.me.medkit;
      const pwr=document.getElementById('pwr');
      if(pwr){
        const off=G.lightState===2;
        pwr.textContent=off?'全船断电':(G.powerFixed?'照明已修复':'照明正常');
        pwr.classList.toggle('off',off);
        pwr.classList.toggle('full',!off&&G.powerFixed);
      }
      if(spectator){const tl=document.getElementById('tasks');if(tl)tl.innerHTML='';}
      else renderTaskList();
      const dl=document.getElementById('dmgline');
      if(dl){
        if(!G.dmg.length){if(!dl.classList.contains('hide'))dl.classList.add('hide');}
        else{
          dl.classList.remove('hide');
          const dtxt='<b>故障</b> '+G.dmg.map(d=>
            roomNameById(d.room)+'「'+d.label+'」 '+Math.max(0,Math.ceil(d.left))+'s').join(' · ');
          if(dl.__txt!==dtxt){dl.__txt=dtxt;dl.innerHTML=dtxt;}
        }
      }
      const roleEl=document.getElementById('role');
      if(roleEl){
        const txt=spectator?'旁观者 · 不参与对局':
          ((G.me.alien?'异形':'人类')+(!G.me.alive?' · 幽灵':(G.me.downed?' · 濒死':
            (G.me.detained?' · 被擒 '+Math.max(0,Math.ceil(G.me.detainedT||0))+'s':''))));
        if(roleEl.textContent!==txt)roleEl.textContent=txt;
      }
      const tip=document.getElementById('tip');
      if(tip){
        const t=spectator
          ?'旁观者：点击地面飞行（9 格/秒 · 穿墙 · 全知） · C 相机 · T 视野 · ESC 暂停/设置'
          :(G.sabPick
          ?'破坏选择：点击舱室按钮或按 1–8 直达 · ESC 取消 · 每夜一次'
          :(G.pipePick
            ?'地道选择：点击出口按钮或按 1–3 直达 · ESC 取消 · 异形专用'
            :(G.camView
              ?'监控台：E / V / ESC 退出 · 配电室拉闸会切断全部 9 路信号'
              :(G.sabTarget&&G.me.alien&&!G.me.sabUsed
                ?'破坏目标：'+roomNameById(G.sabTarget.room)+'「'+G.sabTarget.label+'」· 进入舱室自动下手 · 60 秒内可被修复'
                :(!G.me.alive
                  ?'幽灵态：点击穿墙移动 · E 维修任务（1.6×，额度 '+(2-(G.me.ghostPts||0))+' 分）/故障 · 不能报告/投票/搜尸 · 不能破坏 · F2 DEV'
                  :(G.me.downed
                    ?'你已濒死：等队友 F 施救，或被拖进医疗间 · F2 DEV'
                    :(G.me.detained
                      ?'被保安机器人锁住：'+Math.max(0,Math.ceil(G.me.detainedT||0))+' 秒后自动释放 · 不能移动'
                      :'点击地面移动 · W 交互 · A 出刀 · S 搜尸 · D 收尸 · F 施救 · R 报告 · B 开枪 · H 破坏 · V 监控 · ESC 暂停/设置 · T 视野 · C 相机')))))));
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
    const pset=document.getElementById('p-set');
    if(pset)pset.onclick=()=>{ if(global.SKSettings)global.SKSettings.open(); };
    document.getElementById('p-restart').onclick=()=>restartGame();
    document.getElementById('p-exit').onclick=()=>exitToMenu();
    document.getElementById('b-close').onclick=()=>closeBodyCard();
    const camClose=document.getElementById('cam-close');
    if(camClose)camClose.onclick=()=>closeCams();
    const pipeCancel=document.getElementById('pipe-cancel');
    if(pipeCancel)pipeCancel.onclick=()=>closePipePick();
    const sabCancel=document.getElementById('sabot-cancel');
    if(sabCancel)sabCancel.onclick=()=>closeSabPick();
    document.getElementById('cam').addEventListener('click',e=>{
      if(e.target&&e.target.id==='cam')closeCams();
    });
    document.getElementById('pipe').addEventListener('click',e=>{
      if(e.target&&e.target.id==='pipe')closePipePick();
    });
    document.getElementById('sabot').addEventListener('click',e=>{
      if(e.target&&e.target.id==='sabot')closeSabPick();
    });
    document.getElementById('wheel').addEventListener('click',e=>{
      if(e.target&&e.target.id==='wheel')closeWheel();
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
      attack:()=>{attack();return {knife:G.me.knife,msg:G.msg};},
      shoot:()=>shoot(),
      fireBot:kind=>fireShotBot(G.me,kind),
      tp:(i,x,y)=>{const a=G.agents[i];if(!a)return null;a.path=null;a.moving=false;a.x=x;a.y=y;
        if(!a.alive){a.bodyX=x;a.bodyY=y;a.bodyGone=false;a.deathX=x;a.deathY=y;}
        return[a.x,a.y];},
      setDev:v=>{G.dev=!!v;syncDevUi();},
      dev:()=>!!G.dev,
      bodyOf:i=>bodyPos(G.agents[i]),
      dragOf:i=>i==null?G.drag:(G.agents[i]?G.agents[i].drag:null),
      dragStart:(i,v)=>startDrag(G.agents[i],G.agents[v],true),
      dragRelease:i=>releaseDragBy(G.agents[i],true),
      hideSpot:rid=>hideSpotFor(rid),
      hideRoom:rid=>hideRoomFor(rid),
      medDrop:()=>medDropSpot(),
      secWouldSee:(x,y)=>secbotWouldSee(x,y),
      gfx:()=>Object.assign({},G.gfx),
      newNight:()=>{startNight(true);return {night:G.night,t:G.t};},
      planReport:(i,body,delay)=>{const a=G.agents[i];if(!a)return null;
        const v=body==null?a._killBody:body;
        if(v==null||!G.agents[v])return null;
        a._reportPlan={body:v,wait:(delay==null?0:delay),spot:null};
        a._reportT=0;a._reportBody=null;
        return {body:v,wait:a._reportPlan.wait};},
      reportPlan:i=>{const a=G.agents[i];
        return a&&a._reportPlan?{body:a._reportPlan.body,wait:+a._reportPlan.wait.toFixed(1),
          spot:a._reportPlan.spot?[+a._reportPlan.spot[0].toFixed(1),+a._reportPlan.spot[1].toFixed(1)]:null}:null;},
      bodyItems:i=>{const a=G.agents[i];if(!a)return null;
        return {bullet:a.bullet|0,medkit:a.medkit|0,qual:a.qual|0,searched:!!a.searched};},
      /* 门禁隔离用：把某个 AI 的子状态（拖尸/藏尸/管道规划/断电响应）清干净 */
      resetAiState:i=>{const a=G.agents[i];if(!a)return null;
        a.drag=null;a.draggedBy=null;a.redT=0;a._dragSnd=0;a._dragAiT=0;
        a._hideSpot=null;a._hideRoom=null;a._hideCD=0;a._hides=0;
        a._pipePlan=null;a._pipeSeeks=0;a._secAvoidT=0;a._lightGo=false;a._botCD=0;
        a._killBody=null;a._killAt=0;a._killDecided=true;a._reportPlan=null;
        a._look=null;a._fixGo=null;a.path=null;a.doing=0;a._doing=null;a.target=null;
        return a.i;},
      clearDrags:()=>{releaseAllDrags(true);return G.drag;},
      inspect:()=>G.inspect?G.inspect.agent.name:null,
      openBody:i=>openBodyCard(G.agents[i]),
      openMeeting:(kind,r,v)=>openMeeting(kind||'night',
        r==null?G.me:G.agents[r],
        v==null?(G.agents.find(a=>bodyPos(a))||null):G.agents[v]),
      closeVote:()=>closeVote(),
      finishMeeting:()=>finishMeeting(),
      aiTick:(i,steps,dt)=>{const a=G.agents[i];if(!a)return null;
        for(let n=0;n<(steps||1);n++){doorTick(dt||0.05);aiHuman(a,dt||0.05);}
        return {tIdx:a.tIdx,doing:a.doing,do:a._doing,rest:a._rest,delay:a._delay,
          bullet:a.bullet,qual:a.qual,qualPending:a.qualPending||0,medkit:a.medkit,
          drag:a.drag,lightGo:!!a._lightGo};},
      aiTickAlien:(i,steps,dt)=>{const a=G.agents[i];if(!a)return null;
        for(let n=0;n<(steps||1);n++){doorTick(dt||0.05);aiAlien(a,dt||0.05);}
        return {doing:a.doing,do:a._doing,sab:a.sabUsed,x:a.x,y:a.y,
          bullet:a.bullet,knife:a.knife,drag:a.drag,hides:a._hides||0,
          secAvoid:a._secAvoidT||0,pipeSeeks:a._pipeSeeks||0};},
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
      rooms:()=>M.rooms.map(r=>{
        const c=nearestFree(r.rect[0]+r.rect[2]/2,r.rect[1]+r.rect[3]/2);
        return {id:r.id,name:r.name,x:c[0],y:c[1],area:r.area,cls:r.cls};
      }),
      points:()=>M.points.map(p=>{
        const f=nearestFree(p.x,p.y);
        return {x:p.x,y:p.y,room:p.room,label:p.label,kind:p.kind,
          d:Math.hypot(f[0]-p.x,f[1]-p.y),free:free(p.x,p.y)};
      }),
      meetCtx:()=>G.meet?{victim:G.meet.ctx.victimInfo,quick:G.meet.ctx.quick||null,
        claims:(G.meet.ctx.claims||[]).map(c=>({who:c.a.name,room:c.room})),
        playerSays:(G.meet.ctx.playerSays||[]).map(s=>s.slots),
        playerAccuse:G.meet.ctx.playerAccuse,playerVote:G.meet.ctx.playerVote}:null,
      parseSpeech:t=>parseSpeech(t),
      chatterPlan:()=>G.meet&&G.meet.plan?Object.assign({},G.meet.plan):null,
      accuseLineOf:i=>G.agents[i]?(accuseLine(G.agents[i],G.meet)||''):'',
      notice:(i,x,y,rad,kind,victim)=>noticeAction(G.agents[i],x,y,rad,kind,
        victim==null?null:G.agents[victim]),
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
      visible:(x,y)=>visibleAt(x,y),
      aiSee:(i,x,y,maxD)=>{const a=G.agents[i];return a?aiCanSee(a,x,y,maxD):false;},
      spectTo:(x,y)=>{if(!G.spect)return null;G.spect.x=x;G.spect.y=y;G.spect.path=null;
        G.spect.moving=false;return [x,y];},
      spect:()=>({mode:!!G.spectMode,x:G.spect?G.spect.x:null,y:G.spect?G.spect.y:null,
        moving:!!(G.spect&&G.spect.moving),fog:!!G.fogOn,agents:G.agents.length,
        ctrlAlien:!!(G.me&&G.me.alien)}),
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
      sabSpot:rid=>sabSpot(rid),
      dmg:()=>G.dmg.map(d=>({room:d.room,x:d.x,y:d.y,label:d.label,left:d.left,by:d.by})),
      dmgTick:(dt)=>{dmgTick(dt==null?0.2:dt);return G.dmg.length;},
      damageRoom:(i,rid)=>damageRoom(G.agents[i],rid),
      sabTick:()=>{sabTick();return G.dmg.length;},
      nearDmg:(i,maxD)=>nearDmg(G.agents[i],maxD),
      startFix:(i,room)=>{
        const a=G.agents[i];
        const d=room?G.dmg.find(q=>q.room===room):nearDmg(a,9);
        return startFix(a,d||G.dmg[0]);
      },
      fixing:()=>G.agents.filter(a=>a._doing==='fix').map(a=>({i:a.i,t:a.doing,room:a._fix?a._fix.room:null})),
      openSab:()=>openSabPick(),
      sabPick:()=>G.sabPick?{open:true,rooms:G.sabPick.rooms.slice()}:{open:false,rooms:[]},
      pickSab:rid=>pickSabRoom(rid),
      closeSab:()=>{closeSabPick(true);return !G.sabPick;},
      sabTarget:()=>G.sabTarget?{room:G.sabTarget.room,x:G.sabTarget.x,y:G.sabTarget.y,
        label:G.sabTarget.label}:null,
      setTarget:rid=>{G.sabTarget=sabSpot(rid);return G.sabTarget?G.sabTarget.room:null;},
      sabotage:()=>{sabotage();return {open:!!G.sabPick,target:G.sabTarget?G.sabTarget.room:null,
        wheel:!!G.wheel,n:G.wheel?G.wheel.items.length:0,msg:G.msg};},
      interact:()=>{
        interact();
        let auto=null,n=0;
        if(G.wheel){n=G.wheel.items.length;auto=G.wheel.items[0].id;pickWheel(0);}
        return {doing:G.me.doing,do:G.me._doing,wheel:auto!=null,pick:auto,n};
      },
      wheel:()=>G.wheel?{n:G.wheel.items.length,items:G.wheel.items.map(it=>({id:it.id,label:it.short,pill:it.pill}))}:null,
      openWheel:()=>openWheel(collectInteractions(G.me)),
      pickWheel:i=>{const ok=pickWheel(i);return {ok,doing:G.me.doing,do:G.me._doing,wheel:!!G.wheel};},
      closeWheel:()=>{closeWheel(true);return !G.wheel;},
      supplies:()=>supplyPoints().map(q=>({kind:q.kind,item:q.item,x:q.x,y:q.y,label:q.label})),
      coverAudit:()=>coverAudit(),
      robots:()=>({
        sec:{used:!!G.secbotUsed,uses:G.secbotUses||0,left:3-(G.secbotUses||0),dead:!!G.secbotDead,t:G.secbotT||0,hp:botHp('secbot'),range:SEC_RANGE,arc:SEC_ARC},
        med:{used:!!G.medbotUsed,dead:!!G.medbotDead,t:G.medbotT||0,left:G.medbotLeft==null?2:G.medbotLeft,hp:botHp('medbot')}}),
      bots:()=>{
        const out={};
        for(const k of ['medbot','secbot']){
          const b=G.bots&&G.bots[k];
          const f=M.facility.find(q=>q.kind===k);
          out[k]=b?{x:b.x,y:b.y,wp:b.wp,face:b.face,ang:b.ang,moving:!!b.moving,
            patrol:f&&f.patrol?f.patrol:[]}:null;
        }
        return out;
      },
      setBot:(kind,x,y,ang)=>{
        const b=G.bots&&G.bots[kind]; if(!b)return null;
        const p=nearestFree(x,y);
        b.x=p[0];b.y=p[1];b.moving=false;
        if(Number.isFinite(ang)){b.ang=ang;b.face=Math.cos(ang)<0?-1:1;}
        return[p[0],p[1]];
      },
      jail:()=>secJail(),
      botTick:(dt)=>{botTick(dt==null?0.2:dt);return {sec:G.secbotUsed,secUses:G.secbotUses||0,med:G.medbotUsed,
        medLeft:G.medbotLeft==null?2:G.medbotLeft,
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
      speed:()=>MOVE_SPEED,
      dragSpeed:()=>DRAG_SPEED,
      secRange:()=>SEC_RANGE,
      qualDesk:()=>{const q=roundTableClaimSpot();return q?{x:q.x,y:q.y,label:q.label}:null;},
      doors:()=>G.doors.map(d=>({id:d.id,x:d.x,y:d.y,horiz:d.horiz,
        open:Math.round(d.open*100)/100,target:d.target})),
      doorTick:dt=>{doorTick(dt==null?0.2:dt);return G.doors.map(d=>({
        id:d.id,open:Math.round(d.open*100)/100,target:d.target}));},
      setDoor:(id,open)=>{const d=G.doors.find(q=>q.id===id);if(!d)return null;
        d.open=d.target=Math.max(0,Math.min(1,+open||0));
        return {id:d.id,open:d.open,target:d.target};},
      los:(x1,y1,x2,y2)=>losNow(x1,y1,x2,y2),
      stepOnce:(dt,sp)=>{stepMove(G.me,dt==null?0.2:dt,sp||moveSpeed(G.me));return [G.me.x,G.me.y];},
      walkAgent:(i,steps,dt)=>{
        const a=G.agents[i];if(!a)return null;
        for(let n=0;n<(steps||1);n++){
          doorTick(dt||0.05);
          if(!a.path||!a.path.length)break;
          stepMove(a,dt||0.05,moveSpeed(a));
        }
        return {x:a.x,y:a.y,left:a.path?a.path.length:0,stuck:a._stuckT||0};
      },
      state:()=>G.agents.map(a=>({i:a.i,name:a.name,alien:a.alien,alive:a.alive,ghost:a.ghost,
        qual:a.qual,qualPending:a.qualPending||0,
        downed:a.downed,detained:!!a.detained,detainedT:a.detainedT||0,body:bodyPos(a),cause:a.deathCause,ghostPts:a.ghostPts||0,
        bullet:a.bullet|0,medkit:a.medkit|0,
        wound:a.alive?(a.woundCause||null):(a.deathCause||null),searched:!!a.searched,
        downRoom:a.downRoom||null,
        room:roomIdAt(a.x,a.y),draggedBy:a.draggedBy,bodyMoved:a.bodyMoved,drag:a.drag,
        redT:+(a.redT||0).toFixed(2),hides:a._hides||0,
        deathRoom:a.deathRoom,killedBy:a.killedBy})),
      bodyInfo:i=>bodyInfo(G.agents[i]),
      mind:i=>{const a=G.agents[i];if(!a||!a.mind)return null;
        return {mem:a.mind.mem.slice(-24),sus:Object.assign({},a.mind.sus),
          why:JSON.parse(JSON.stringify(a.mind.why)),alert:a.mind.alert,noise:a.mind.noise,
          seenBy:Object.assign({},a.mind.seenBy),
          known:JSON.parse(JSON.stringify(a.mind.known||{})),
          redSeen:Object.assign({},a.mind.redSeen||{})};},
      /* 门禁用：立刻跑一轮感知（正常由 update 每 0.4 秒调用） */
      track:()=>{for(const a of G.agents)if(a.alive&&!a.downed)trackNight(a);return true;},
      knownOf:i=>{const a=G.agents[i];if(!a||!a.mind)return null;
        return JSON.parse(JSON.stringify(a.mind.known||{}));},
      aiReportUsed:()=>!!G.aiReportUsed,
      invHist:()=>G.inv
    };
    
    Object.assign(global.SKV3,{
      setSfxVolume:v=>SND.setMaster(v),
      getSfxVolume:()=>SND.getMaster(),
      togglePauseGame:()=>{ if(G&&!G.over&&!G.meet&&!G.inspect) togglePause(); },
      isPaused:()=>!!(G&&G.paused),
      playSfx:n=>{ const f=SND[n]; if(typeof f==='function'){try{f(0.8);}catch(e){}} }
    });
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
