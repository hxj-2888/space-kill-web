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
    if (global.SKReplay && global.SKReplay.isOpen && global.SKReplay.isOpen()) global.SKReplay.close();
    const r = document.getElementById('v3-root');
    if (r) r.remove();
    booted = false;
    const pk = document.getElementById('pick');
    if (pk) pk.style.display = '';
  }

  function boot() {
    'use strict';
    const M=MAP, NIGHT=120;
    let SIM_RUN=false;   /* 批量模拟：跳过渲染/HUD/音效/自动不变量，只跑对局逻辑 */
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
    /* 医疗无人机每夜充电次数（每救 1 人扣 1 次）：只在这里改 */
    const MEDBOT_CHARGES=2;
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
        _avoid:{},_fleeT:0,_fleeFrom:null,_pathCD:0,_fakeN:0,_alienTaskN:0,_fakeTaskN:0,_fakeKind:null,_alienTaskTotal:0,_supportGoal:null,_lootMem:{},
        /* 表现层：动作 / 工作计时 / 夜间见闻（会议发言要用真实事实） */
        act:null,_rest:0,_delay:2+Math.random()*6,_fxT:0,
        nRoom:null,nSeen:{},nTask:null,nTaskRoom:null,accuse:null,_lie:null,
        _taskPt:null,_reportT:0,_sawBody:null,
        /* 认知层：只记录自己看见/听见/搜查到的事实，不保存身份答案。
           mates 只由目击异形专属行为推断，不是系统下发的队友表。 */
        mind:null,mates:{}
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
         medbotTarget:null,
         medbotLeft:MEDBOT_CHARGES,botHp:{secbot:2,medbot:1},secCatch:null,
         bots:null,jailPos:null,breakerSaboteur:null,
         dmg:[],sabPick:null,sabTarget:null,aiReportUsed:false,evSeq:0,
         drag:null,inspect:null,wheel:null,dev:keepDev,gfx:{coverFlashes:0,dashedBorders:0},
         spectMode:(ROLE_WANT==='spect'),spect:null,
         events:[],frames:[],playT:0,_frameAcc:0,
        /* 局内统计（2026-10-31）：医疗无人机救治 / 医疗包施救 / 幽灵任务 / 幽灵修故障。
           只累加、不参与任何判定，供结束页与复盘报告读取。 */
        stats:{medbotRevives:0,medkitRevives:0,ghostTasks:0,ghostFixes:0},
         inv:{runs:0,checks:0,fails:[],warned:{},lastTag:''},invT:0,devT:0};
      G.aimX=me.x+1; G.aimY=me.y;
      logEvent('game_start',{night:1});
      recordFrame();
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
    /* 全船只在这 4 个舱室有管道口：任何“在 X 钻管道”的说法都必须落在这些房间，
       否则就是物理上不可能的口供（生成端不编、解析端要能拆穿）。 */
    function pipeRoomIds(){
      const out=[];
      for(const q of M.pipes)if(out.indexOf(q.room)<0)out.push(q.room);
      return out;
    }
    function isPipeRoom(id){ return !!id&&M.pipes.some(q=>q.room===id); }
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
          out.push({id:c.id+':'+rid,x,y,horiz,w:DOOR_W,open:0,target:0,scanT:0,
            x1:horiz?x-DOOR_W/2:x,y1:horiz?y:y-DOOR_W/2,
            x2:horiz?x+DOOR_W/2:x,y2:horiz?y:y+DOOR_W/2});
        }
      }
      return out;
    }
    function doorTick(dt){
      if(!G||!G.doors||G.meet||G.over)return;
      const blackout=G.lightState===2;
      for(const d of G.doors){
        /* 断电期间：全船每一扇门（含会议室三门）在有人靠近时先做 2 秒安检扫描，
           扫描完成才允许开启；人离开后重新上锁，恢复供电立即解除。 */
        const scanRule=blackout;
        let busy=false;
        /* 扫描/关门用更大的半径做滞回，避免站在门口时门反复开合 */
        const range=scanRule?DOOR_CLOSE_R:(d.open>0.02?DOOR_CLOSE_R:DOOR_OPEN_R);
        for(const a of G.agents){
          if(!a.alive||a.downed||a.detained)continue;
          if(Math.hypot(a.x-d.x,a.y-d.y)<range){busy=true;break;}
        }
        if(!scanRule){
          d.scanT=0;
          d.target=busy?1:0;
        }else if(!busy){
          d.scanT=0;
          d.target=0;
        }else{
          d.scanT=Math.min(2,(d.scanT||0)+dt);
          d.target=d.scanT>=2?1:0;
        }
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
        if(!segX([x1,y1],[x2,y2],[d.x1,d.y1],[d.x2,d.y2]))continue;
        /* 断电期间所有门都要完成 2 秒扫描才放行（会议室也不再豁免） */
        if(G.lightState===2&&(d.scanT||0)<2)return true;
        if(d.open>DOOR_PASS)continue;
        return true;
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
      if(SIM_RUN)return null;
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

    /* DEV 横栏：一人一张小卡（名字 / 身份 / 状态 / 舱室 + 身上的资源）。
       资源是玩家在正常对局里看不到的信息，所以只在这里展示，不进 HUD。
       卡片横向排开贴顶，#hud 由 syncDevUi 下移让位，绝不压住左上角。 */
    function renderDevPanel(){
      const box=document.getElementById('dev-rows');
      if(!box||!G)return;
      const out=[];
      for(const a of G.agents){
        let st='待机';
        if(!a.alive) st=a.ghost?'幽灵':'出局';
        else if(a.downed) st='濒死';
        else if(a.detained) st='被擒';
        else if(a.doing>0) st=(a._doing==='task'?'做任务':(a._doing==='fix'?'修故障':
          (a._doing==='revive'?'施救':(a._doing==='qual'?'领申请单':(a._doing==='ammo'?'取子弹':
          (a._doing==='med'?'取医疗包':(a._doing==='breaker'?'拉闸':(a._doing==='fake'?'假装做任务':'行动'))))))));
        else if(a.moving) st='移动';
        const bp=bodyPos(a);
        const where=bp?roomNameAt(bp[0],bp[1]):roomNameAt(a.x,a.y);
        const res='弹 '+a.bullet+' · 包 '+a.medkit+' · 单 '+a.qual+(a.qualPending>0?'(+'+a.qualPending+')':'')
          +' · 任务 '+a.tIdx+'/'+a.tasks.length+(a.alien?' · 刀 '+a.knife:'');
        out.push('<div class="dr'+(a.alien?' al':'')+((a===G.me&&!G.spectMode)?' me':'')+(!a.alive?' dead':'')+'">'
          +'<div class="top"><b>'+a.name+(a===G.me?(G.spectMode?'（AI）':'（你）'):'')+'</b>'
          +'<span>'+(a.alien?'异形':'人类')+'</span></div>'
          +'<i>'+st+' · '+where+(a.detained?' · 被锁':(a.draggedBy!=null?' · 被拖':(a.drag!=null?' · 拖尸':'')))+'</i>'
          +'<u>'+res+'</u></div>');
      }
      box.innerHTML=out.join('');
    }
    function syncDevUi(){
      if(SIM_RUN)return;
      const on=!!(G&&(G.dev||G.spectMode));
      const dev=document.getElementById('dev');
      if(dev)dev.classList.toggle('hide',!on);
      const dl=document.getElementById('devline');
      if(dl){
        dl.classList.toggle('hide',!on);
        dl.innerHTML=G&&G.spectMode?'旁观者 · <b>全知总览</b> · 断言 <b id="inv">0</b> 失败'
          :'DEV <b>无敌 · 全知</b> · 断言 <b id="inv">0</b> 失败';
      }
      const dt=dev&&dev.querySelector('.dt span');
      if(dt)dt.textContent=G&&G.spectMode?'旁观者 · 全知总览（不参与对局）':'DEV · 全知总览';
      if(on)renderDevPanel();
      /* 横栏贴顶：先渲染再量高度，把 #hud 整体让下去，
         左上角的维修进度 / 存活人数 / 个人任务永远不被遮住 */
      const hud=document.getElementById('hud');
      /* 横栏高度要等布局落定才量得准（首次显示时 offsetHeight 还是 0）：
         同步一次 + 下一帧再校正一次，保证左上角的维修进度永远在横栏下方。 */
      const place=()=>{
        if(!hud)return;
        hud.style.top=on?(dev?Math.max(96,dev.offsetHeight+18):96)+'px':'';
      };
      place();
      if(on&&typeof requestAnimationFrame==='function')requestAnimationFrame(place);
      /* 濒死人数是对局隐藏信息：只有 DEV / 旁观全知才显示 */
      const dnw=document.getElementById('dnwrap');
      if(dnw)dnw.classList.toggle('hide',!on);
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
    function breakerPullTime(){
      /* 电路维修完成后，再拉断电闸需要 6 秒；恢复电力仍是 3 秒 */
      return G.lightState===2?3:(G.powerFixed?6:3);
    }
    /* 电闸拉杆角度：按供电状态平滑过渡（模块级变量，只在渲染里用） */
    let BREAKER_LEVER=0;
    function breakerPuller(){
      for(const a of G.agents){
        if(a._doing==='breaker'&&a.doing>0&&a._dur>0)
          return {p:1-a.doing/a._dur, heavy:a._dur>4};
      }
      return null;
    }
    function pullBreaker(actor){
      G.lightState=(G.lightState===2?(G.powerFixed?1:0):2);
      refreshLight(); SND.breaker(); pulseHud('pwr');
      /* 断电期间每扇门单独扫描 2 秒（人离开重新上锁）；恢复供电立即清零 */
      for(const d of (G.doors||[]))d.scanT=0;
      const br=M.facility.find(f=>f.kind==='breaker');
      logEvent('breaker',{actor:actor?actor.i:null,on:G.lightState!==2,state:G.lightState,
        room:br?roomIdAt(br.x,br.y):'power',x:br?+br.x.toFixed(1):null,y:br?+br.y.toFixed(1):null});
      if(br){
        G.fx.push({type:'power',x:br.x,y:br.y,t:1.0,dur:1.0,on:G.lightState!==2});
        /* 断电是重动作：拉杆落下时补一圈电弧，6 秒重闸（配电已修复）电火花更密 */
        G.fx.push({type:'spark',x:br.x,y:br.y,t:1.0,dur:1.0});
        if(G.lightState===2&&G.powerFixed)
          G.fx.push({type:'alarm',x:br.x,y:br.y,t:1.4,dur:1.4});
        hear(br.x,br.y,'power',1.1);
        noticeAction(actor,br.x,br.y,6,'breaker');
        aiHear('power',br.x,br.y,30,{actor:actor});
        envNotice('lights',br.x,br.y,G.lightState===2?0.85:0.45);
      }
      toast(G.lightState===2
        ?'电闸已拉下：全船变暗 · 走廊灯全熄 · 监控信号中断 · 所有门需扫描 2 秒才能通过'
          +(G.powerFixed?' · 配电已修复，再拉闸要 6 秒':'')
        :(G.powerFixed?'电闸已合上：配电已修复，全船照明恢复 · 自动门安检解除':'电闸已合上：房间与走廊灯光恢复 · 自动门安检解除'));
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
    
    /* ---------------- 胜负 ---------------- */
    /* 人类维修胜利目标分的唯一真源：checkWin、结算文案、HUD 上限与进度条
       全部读这里。之前 HUD 单独写死「/ 40」，与 45 分的实际口径不符。 */
    const WIN_PTS=45;

    /* ---------------- 移动 ---------------- */
    /* 场上所有活人（玩家 / AI 人类 / AI 异形）共用同一移动速度；
       拖拽尸体与幽灵态是明确的例外，速度单独写在调用处。 */
    const MOVE_SPEED=4.2;
    /* 拖拽统一降速到 2.5 格/秒；AI 与玩家共用同一入口，避免出现"AI 拖着尸体跑得比人快" */
    const DRAG_SPEED=2.7;
    function moveSpeed(a){ return a&&a.drag!=null?DRAG_SPEED:MOVE_SPEED; }
    function walkTo(a,x,y){
      a._stuckT=0;
      /* 不可达目标不要每帧重跑 A*：给 AI 一个短冷却，避免 1000 局里单个坏目标拖死整局 */
      if(a!==G.me||G.spectMode){
        if((a._pathCD||0)>0)return;
      }
      const p=astar(a.x,a.y,x,y);
      if(!p&&(a!==G.me||G.spectMode))a._pathCD=1.2;
      a.path=p;
    }
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
      /* 脚步：按实际走过的距离触发，近处才响。
         幽灵（a.alive=false）不发出任何脚步痕迹：它们飘在墙里，既不该响，
         也不该在声纹上留下一个"有人在走"的圈——那会让活人误读现场。 */
      const moved=sp*dt;
      a._stepAcc=(a._stepAcc||0)+moved;
      if(a._stepAcc>=0.78){
        a._stepAcc=0;
        if(a.alive){
          const dme=Math.hypot(a.x-G.me.x,a.y-G.me.y);
          if(dme<6&&(a===G.me||visibleAt(a.x,a.y))) SND.step(a===G.me?0.5:Math.max(0.05,0.28*(1-dme/6)));
          /* 声纹：别人的脚步即使被墙挡住也能听见方向（近处才画） */
          if(a!==G.me&&dme<14) hear(a.x,a.y,'step',Math.max(0.18,0.7*(1-dme/14)));
        }
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
      logEvent('pipe',{actor:me.i,from:from?from.room:null,to:to.room,
        x:+to.x.toFixed(1),y:+to.y.toFixed(1)});
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
      return Math.hypot(dx,dy)<2.3?t:null;
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
      /* 有人濒死时医疗包优先；否则只要没有子弹就用申请单备弹。
         不再要求“当前已有嫌疑人”——AI 会先武装自己，再去找人。 */
      if(a.medkit<1&&G.agents.some(v=>v!==a&&v.alive&&v.downed))return 'med';
      if(a.bullet<1)return 'ammo';
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
      if(st){st.textContent=G.lightState===2?'● 信号中断 · 电闸断开':'● '+M.rooms.length+' 路在线';st.classList.toggle('cut',G.lightState===2);}
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
       故障 30 秒内没人连续修满 10 秒就扣 5 点维修进度；天亮前没修完不追罚。
       幽灵不能破坏（但可以参与维修），破坏必须在活着的异形手里。 */
    const SAB_TIME=30, FIX_TIME=10, SAB_RANGE=1.7, FIX_RANGE=2.0;
    /* 专用补给点兑换物资的站桩时长（2026-10-31：子弹 10 → 7 秒、医疗包 6 → 5 秒）。
       玩家与 AI 共用这两个常量，改这里即可，别在调用处再写死数字。 */
    const SUPPLY_AMMO_TIME=7, SUPPLY_MED_TIME=5;
    /* 电闸交互半径（2026-10-31）：锚点对齐到柜体中心后，柜体是 1.6×2.2 格的大件，
       1.6 格时代玩家贴着正面都按不到。三处判定（玩家轮盘 / AI 合闸 / AI 拉闸）共用。 */
    const BREAKER_USE_R=2.0;
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
      if(sub)sub.textContent='每夜一次 · 抵达目标舱室后损毁设备 · 30 秒内未修复则维修进度 -5';
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
      if(G.simMode&&G.simStats)G.simStats.sabotages++;
      logEvent('sabotage',{actor:a.i,room:rid,label:sp.label,
        x:+sp.x.toFixed(1),y:+sp.y.toFixed(1)});
      a.sabUsed=true;a.sabRoom=null;a.target=null;a.path=null;
      if(!G.spectMode&&a===G.me)G.sabTarget=null;
      G.fx.push({type:'spark',x:sp.x,y:sp.y,t:1.6,dur:1.6});
      G.fx.push({type:'alarm',x:sp.x,y:sp.y,t:1.3,dur:1.3});
      hear(sp.x,sp.y,'power',1.0);
      SND.sabotage();
      witnessAlienAction(a,a.x,a.y,6,'sabotage');
      aiHear('sabotage',sp.x,sp.y,20,{actor:a});
      envNotice('fault',sp.x,sp.y,0.55);
      toast('警报：'+roomNameById(rid)+'「'+sp.label+'」被损毁 · 30 秒内修复，否则维修进度 -5');
      runInvariants('damageRoom');
      return true;
    }
    function startFix(a,d){
      if(!a||!d||G.dmg.indexOf(d)<0)return false;
      if(!a.alive&&!a.ghost)return false;
      if(a.ghost&&a.alien){if(a===G.me&&!G.spectMode)toast('异形幽灵不能维修');return false;}
      const dur=a.ghost?FIX_TIME*1.6:FIX_TIME;
      a.doing=dur;a._dur=dur;a._doing='fix';a._fix=d;
      a.path=null;a.moving=false;a._fixGo=null;
      if(!G.spectMode&&a===G.me){toast((a.ghost?'幽灵维修故障「':'维修故障「')+d.label+'」· 连续 '+dur.toFixed(dur%1?1:0)+' 秒 · 移动会中断');SND.interact();}
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
          if(!G.spectMode&&x===G.me)toast('故障已被队友修好，停止维修');
        }
        if(x._fixGo===d)x._fixGo=null;
      }
      G.fx.push({type:'heal',x:d.x,y:d.y,t:1.2,dur:1.2});
      G.fx.push({type:'done',x:a.x,y:a.y,t:1.0,dur:1.0});
      /* 局内统计：幽灵修好的故障次数（与「幽灵任务」分开记） */
      if(a.ghost&&G.stats)G.stats.ghostFixes=(G.stats.ghostFixes||0)+1;
      if(G.simMode&&G.simStats&&a.ghost)G.simStats.ghostFixes++;
      logEvent('fix',{actor:a.i,room:d.room,label:d.label,ghost:!!a.ghost,
        x:+d.x.toFixed(1),y:+d.y.toFixed(1)});
      if(!G.spectMode&&a===G.me)toast('故障已修复：'+roomNameById(d.room)+'「'+d.label+'」');
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
        if(!G.spectMode&&a===G.me)toast('移动打断了'+label);
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
          G.prog=Math.max(0,G.prog-5);
          G.fx.push({type:'alarm',x:d.x,y:d.y,t:1.4,dur:1.4});
          G.fx.push({type:'spark',x:d.x,y:d.y,t:1.0,dur:1.0});
          hear(d.x,d.y,'power',1.0);
          toast('故障未修复：'+roomNameById(d.room)+'「'+d.label+'」· 维修进度 -5');
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
             异形看到红光则记成队友；同一个人的一次红身只记一条，避免刷满记忆。 */
          if(a.alien&&w!==a&&w.redT>0){
            markMate(a,w,'saw_red');
          }else if(!a.alien&&w.redT>0){
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
      saw_bot:0.6,saw_breaker:0.32,saw_drag:0.22,saw_drag_away:0.45,saw_detain:0.6,saw_red:0.85,
      heard_knife:0.18,heard_shot:0.16,heard_scream:0.22,heard_power:0.14,
      heard_robot:0.12,heard_pipe:0.2,heard_door:0.04,heard_detain:0.6,heard_drag:0.12,
      env_lights:0.1,env_fault:0.12,env_robot:0.14};
    function evNow(){ return Math.max(0,NIGHT-(G?G.t:0)); }

    /* ---------------- 对局事件流 / 回放采样（只记录，不参与任何判定） ----------------
       时间轴用 playT（真实模拟秒，会议期间不增长）排序；night / t 只用于展示
       “第几夜 · 夜里还剩多少秒”。事件与帧都做上限，异常长局也不会把内存拖爆。 */
    const EV_CAP=8000, FRAME_CAP=12000, FRAME_DT=0.5;
    function logEvent(kind,data){
      if(!G)return null;
      const e=Object.assign({kind:kind,night:G.night||0,
        pt:+(G.playT||0).toFixed(2),t:+Math.max(0,G.t||0).toFixed(1),
        actor:null,victim:null,room:null,x:null,y:null},data||{});
      const arr=(G.events=G.events||[]);
      if(arr.length<EV_CAP)arr.push(e);
      return e;
    }
    function recordFrame(){
      if(!G||G.simMode||G.over)return;
      const p=[];
      for(const a of G.agents){
        let x=a.x,y=a.y;
        if(!a.alive){
          if(a.bodyGone||a.deathCause==='vote'||a.bodyX==null)continue;
          x=a.bodyX;y=a.bodyY;
        }
        let f=(a.alive?1:0)|(a.downed?2:0)|(a.detained?4:0)|(a.drag!=null?8:0);
        p.push([a.i,+x.toFixed(1),+y.toFixed(1),f]);
      }
      const arr=(G.frames=G.frames||[]);
      if(arr.length<FRAME_CAP)arr.push({pt:+G.playT.toFixed(1),n:G.night,p:p});
    }
    /* 复盘/导出用的完整回放包：种子没有（对手都是 AI），所以直接存事件 + 位置帧 */
    function replayData(){
      return {
        v:1,game:(typeof SKConfig!=='undefined'&&SKConfig.version)||'返航录V3',
        savedAt:new Date().toISOString(),
        map:{w:M.bounds.w,h:M.bounds.h,rooms:M.rooms.length,pipes:M.pipes.length},
        result:{win:!!G.overWin,why:G.overWhy||'',prog:G.prog,winPts:WIN_PTS,nights:G.night},
        roster:G.agents.map(a=>({i:a.i,name:a.name,alien:!!a.alien,alive:!!a.alive,
          deathCause:a.deathCause||null,deathRoom:a.deathRoom||null})),
        events:(G.events||[]).slice(),
        frames:(G.frames||[]).slice()
      };
    }
    function mindReset(a){
      if(!a)return;
      /* known 是**长期记忆**：亲眼确认的身份结论不随夜晚清空，
         后续每一场会议都会继续指控并投这个人（见 bestKnownTarget / startVote）。 */
      const keepKnown=(a.mind&&a.mind.known)||{};
      a.mind={mem:[],sus:{},why:{},alert:0,noise:null,seenBy:{},seenT:{},
        lastBody:null,tone:(a.i||0)%3,
        /* known：亲眼确认「这个人就是异形」（钻管道 / 出刀 / 破坏 / 停摆机器人 /
           身上带着刚出刀的红光）。不是嫌疑分，是不再动摇的身份结论。 */
        known:keepKnown,redSeen:{},alibi:{}};
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
    /* 反向证据：目击到某人案发时在别处，降低普通嫌疑；但不会抹掉自己的确证。 */
    function susCut(a,i,w,reason,ev){
      if(!a||i==null||i===a.i||!G)return;
      if(!a.mind)mindReset(a);
      if(a.mind.known&&a.mind.known[i])return;
      const old=a.mind.sus[i]||0;
      if(old<=0)return;
      const cut=Math.min(old,w);
      a.mind.sus[i]=Math.max(0,old-cut);
      a.mind.alibi[i]={t:ev?ev.t:evNow(),room:ev?ev.room:null,reason:reason||''};
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
    /* 视野：人类 = 亮房照明 + 7 格手电锥 + 近身 2.8 格；
       异形拿同一只手电（同样的锥形与距离），只有自带近身视野 ×10/9 ≈ 3.11 格。
       异形不再有 360° 远视野，AI 的视距上限也与人类统一。 */
    const ALIEN_INNATE_MUL=10/9;                /* 异形自带近身视野 = 人类 ×10/9（唯一调参点；2026-10-30 从 4/3 削短约 1/6） */
    const HUMAN_LIGHT_R=7;
    const HUMAN_DARK_R=2.8;                     /* 人类近身圆视野：2026-10-30 从 4.2 削短 1/3 */
    const ALIEN_DARK_R=HUMAN_DARK_R*ALIEN_INNATE_MUL;     /* ≈3.11 格 */
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
        /* 如果目击者自己已经确证被害者是异形，这枪是处决，不是凶手证据 */
        const justified=kind==='shot'&&victim&&w.mind.known&&w.mind.known[victim.i];
        if(justified)ev.justified=1;
        evPush(w,ev);
        if(!justified){
          susAdd(w,actor.i,wt,'saw_'+kind,ev);
          if(alienAct||kind==='shot'||kind==='detain')w.suspect=actor.i;
        }
        /* 异形专属行为（出刀 / 钻管道 / 破坏设备 / 停摆机器人）是身份级证据：
           直接看见就等于确证，不再只是加一点嫌疑分。开枪与拘留人类也会做，不算确证。 */
        if(alienAct){
          w.mind.known[actor.i]={t:ev.t,kind:'saw_'+kind,room:ev.room,conf:0.95};
          w.mind.sus[actor.i]=1;
          w.mind.why[actor.i]=(w.mind.why[actor.i]||[]).concat([{
            w:1,reason:'确证异形',kind:'saw_'+kind,t:ev.t,x,y,room:ev.room}]).slice(-8);
        }
      }
      /* 异形队友识别：只根据观察到的异形专属行为推断，不读任何队友表。
         断电拉闸（状态变为全黑）也算；人类合闸、开枪、拖尸不算。 */
      if(alienAct||(kind==='breaker'&&G.lightState===2)){
        for(const w of G.agents){
          if(w===actor||!w.alien||!w.alive||w.downed||w.detained)continue;
          if(Math.hypot(w.x-x,w.y-y)>rad)continue;
          if(!aiCanSee(w,x,y,rad))continue;
          markMate(w,actor,kind);
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
    function isMate(a,i){
      return !!(a&&a.alien&&a.mates&&a.mates[i]);
    }
    function markMate(observer,actor,kind){
      if(!observer||!actor||observer===actor||!observer.alien)return;
      if(!observer.mates)observer.mates={};
      observer.mates[actor.i]={t:evNow(),kind:kind||'alien'};
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
      return (b.bullet|0)>0||(b.medkit|0)>0||(b.qual|0)>0||(b.qualPending|0)>0;
    }
    function lootBody(a,b){
      if(!a||!b)return {bullet:0,medkit:0,qual:0,none:true};
      const got={bullet:0,medkit:0,qual:0};
      if((a.bullet|0)<1&&(b.bullet|0)>0){got.bullet=1;b.bullet=(b.bullet|0)-1;a.bullet=1;}
      if((a.medkit|0)<1&&(b.medkit|0)>0){got.medkit=1;b.medkit=(b.medkit|0)-1;a.medkit=1;}
      const cap=2-(a.qual|0);
      /* 死者身上已领到的申请单优先，未领取的也一并继承，避免“人死了票就作废” */
      const pool=(b.qual|0)+(b.qualPending|0);
      if(cap>0&&pool>0){
        const n=Math.min(cap,pool);
        const fromQual=Math.min(n,b.qual|0);
        b.qual=(b.qual|0)-fromQual;
        b.qualPending=Math.max(0,(b.qualPending|0)-(n-fromQual));
        got.qual=n;
        a.qual=(a.qual|0)+n;
      }
      got.none=!(got.bullet||got.medkit||got.qual);
      return got;
    }
    function bodyItemsText(b){
      if(!b)return '';
      const p=[];
      if((b.bullet|0)>0)p.push('子弹 ×'+b.bullet);
      if((b.medkit|0)>0)p.push('医疗包 ×'+b.medkit);
      const q=(b.qual|0)+(b.qualPending|0);
      if(q>0)p.push('申请单 ×'+q);
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
      if(!a||!b)return false;
      if(a.alien&&isMate(a,b.i))return false;
      if(b.alive&&!b.downed)return false;
      if((a.bullet|0)<1&&(b.bullet|0)>0)return true;
      if((a.medkit|0)<1&&(b.medkit|0)>0)return true;
      if((a.qual|0)<2&&((b.qual|0)>0||(b.qualPending|0)>0))return true;
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
      /* 记住“这里有自己缺的物资”的尸体/倒地伤员：即使离开视野，30 秒内也会回来收 */
      if(bodyHasLoot(v)&&aiWantsLoot(a,v)){
        const bp=bodyPos(v);
        a._lootMem=a._lootMem||{};
        a._lootMem[v.i]={t:evNow(),x:bp?bp[0]:v.x,y:bp?bp[1]:v.y,room:bi.room};
      }
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
      /* 计时：正常对局交给 SKClock；批量模拟用 simT 推进，避免真实时间阻塞 */
      if(G.simMode){
        G.simT=Math.max(0,(G.simT==null?NIGHT:G.simT)-dt);
        G.t=G.simT;
      }else{
        if(!G.phase) G.phase=SKClock.newPhase('night',performance.now(),NIGHT*1000);
        G.t=SKClock.remaining(G.phase,performance.now())/1000;
      }
      G.playT=(G.playT||0)+dt;
      G._frameAcc=(G._frameAcc||0)+dt;
      if(G._frameAcc>=FRAME_DT){G._frameAcc=0;recordFrame();}
      const me=G.me;
      /* 故障：30 秒倒计时（只在夜里 update 里走），到点未修扣 5 分 */
      dmgTick(dt);
      if(!G.spectMode)sabTick();
      /* 被擒 / 倒下 / 死亡时立刻退出监控台、地道与破坏选择，避免卡在遮罩里 */
      if(!G.spectMode&&G.camView&&(!me.alive||me.downed||me.detained))closeCams(true);
      if(!G.spectMode&&G.wheel&&(!me.alive||me.downed||me.detained))closeWheel(true);
      if(!G.spectMode&&G.pipePick&&(!me.alive||me.downed||me.detained))closePipePick(true);
      if(!G.spectMode&&G.sabPick&&(!me.alive||me.downed||me.detained||!me.alien||me.sabUsed))closeSabPick(true);
      if(!G.spectMode&&G.sabTarget&&(me.sabUsed||!me.alien||!me.alive||me.downed))G.sabTarget=null;
      /* 保安机器人拘留倒计时：30 秒后自动释放 */
      for(const a of G.agents){
        if(!a.detained)continue;
        a.detainedT=(a.detainedT||0)-dt;
        a.moving=false; a.path=null;
        if(a.detainedT<=0){
          a.detained=false; a.detainedT=0;
          if(!G.spectMode&&a===me)toast('保安机器人解锁：你被释放了');
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
        if(G.simDebug&&G.simMode)console.log('SIM ai '+a.i+' alien='+a.alien+' doing='+a.doing+' path='+(a.path?a.path.length:0));
        if(a.alien) aiAlien(a,dt); else aiHuman(a,dt);
        aiScanBodies(a,dt);
        if(G.simDebug&&G.simMode)console.log('SIM ai done '+a.i);
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
            st.textContent=G.lightState===2?'● 信号中断 · 电闸断开':'● '+M.rooms.length+' 路在线';
            st.classList.toggle('cut',G.lightState===2);
          }
          const meta=document.getElementById('cam-meta');
          if(meta)meta.textContent='第 '+G.night+' 夜 · 剩余 '+Math.max(0,G.t).toFixed(0)+'s';
        }
      }
      if(!G.simMode){
        syncHud();
        G.invT+=dt;
        if(G.invT>=1){ G.invT=0; runInvariants('tick'); }
      }
    }

    /* 无事可做时不要站着（2026-10-31 用户裁定）：
       开局错峰（_delay）、硬控（濒死/被擒/被拖）与短暂恢复（_rest）之外，
       AI 不允许出现"非任务/非维修/非领取"的呆站。任务修完后按
       「去修亮着的故障 → 回圆桌领申请单 → 巡舱」继续移动；
       移动不产生任何情报，站着不动才是白白浪费人类的时间窗口。 */
    function aiIdleRoam(a,dt){
      if(!a)return;
      if(!a.path||!a.path.length){
        let tg=null;
        if(G.dmg&&G.dmg.length){
          const d=G.dmg[Math.floor(Math.random()*G.dmg.length)];
          tg=[d.x,d.y];
        }else if((a.qualPending||0)>0){
          const q=roundTableClaimSpot();
          if(q)tg=[q.x,q.y];
        }
        if(!tg){
          const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
          const p=randIn(r); tg=[p[0],p[1]];
        }
        walkTo(a,tg[0],tg[1]);
      }
      if(a.path&&a.path.length)stepMove(a,dt,moveSpeed(a));
      else a.moving=false;
    }
    /* 人类 AI 幽灵：优先修故障，其次做剩余任务；
       任务进度严格受 ghostPts 额度限制（每只幽灵最多 2 分），超过就只飘不修。 */
    function aiGhost(a,dt){
      /* 异形幽灵对维修/任务没有任何帮助，也不应该继续推进人类进度：直接待机。 */
      if(a.alien){a.moving=false;return;}
      if(a._pathCD>0)a._pathCD-=dt;
      if(a.doing>0){a.doing-=dt;if(a.doing<=0)finishDoing(a);return;}
      if(G.dmg.length){
        let best=null,bd=1e9;
        for(const d of G.dmg){
          const dd=Math.hypot(d.x-a.x,d.y-a.y);
          if(dd<bd){bd=dd;best=d;}
        }
        if(best){
          if(bd<1.5){startFix(a,best);return;}
          if(!a.path||!a.path.length)walkTo(a,best.x,best.y);
          stepMove(a,dt,6.5);return;
        }
      }
      if((a.ghostPts||0)<2&&a.tIdx<a.tasks.length){
        const p=M.points[a.tasks[a.tIdx]];
        if(p){
          if(Math.hypot(p.x-a.x,p.y-a.y)<2.8){
            if(ghostTaskAllowed(a,p)){startTask(a,p,true);return;}
          }else{
            if(!a.path||!a.path.length)walkTo(a,p.x,p.y);
            stepMove(a,dt,6.5);return;
          }
        }
      }
      /* 幽灵额度用尽后也不再呆站：换个舱室继续飘（幽灵是 2.4 格/秒的慢速巡游） */
      if(!a.path||!a.path.length){
        const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
        const p=randIn(r); a.path=[[p[0],p[1]]];
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
      /* 尸体被拖离医疗间 2.2 格以上：附近的活人目击一次“反常拖尸”，只加嫌疑 */
      if(!v.alive&&MED_CENTER&&!a._dragAway){
        const dm=Math.hypot(a.x-MED_CENTER[0],a.y-MED_CENTER[1]);
        if(dm>(a._dragMedD0||dm)+2.2){
          a._dragAway=true;
          dragAwayNotice(a,v);
        }
      }
    }
    function startDrag(a,v,silent){
      if(!a||!v||a===v)return false;
      if(!a.alive||a.downed||a.detained)return false;
      if(!bodyPos(v)||v.draggedBy!=null)return false;
      if(a.drag!=null)releaseDragBy(a,true);
      a.drag=v.i; v.draggedBy=a.i;
      a._dragAway=false;
      a._dragMedD0=MED_CENTER?Math.hypot(a.x-MED_CENTER[0],a.y-MED_CENTER[1]):0;
      const bp0=bodyPos(v);
      logEvent('drag_start',{actor:a.i,victim:v.i,downed:!!v.downed,
        room:bp0?roomIdAt(bp0[0],bp0[1]):null,
        x:bp0?+bp0[0].toFixed(1):null,y:bp0?+bp0[1].toFixed(1):null});
      a._reportT=0; a._reportBody=null; a._sawBody=null;
      if(a===G.me&&!G.spectMode){
        G.drag=v.i;
        const tag=document.getElementById('dragtag'); if(tag)tag.classList.remove('hide');
        if(!silent){SND.drag(0.7);hear(a.x,a.y,'drag',0.8);toast('拖拽 '+v.name+' · 移动变慢，再按 D 放下');}
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
      if(v){
        const bp=bodyPos(v);
        logEvent('drag_end',{actor:a.i,victim:v.i,downed:!!v.downed,
          room:bp?roomIdAt(bp[0],bp[1]):null,
          x:bp?+bp[0].toFixed(1):null,y:bp?+bp[1].toFixed(1):null});
      }
      if(a===G.me&&!G.spectMode){
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
       不再限制「每晚只开一次会」：同一具尸体在同一夜只能被报道一次（reportNight），
       同一夜多具尸体可以连续开会，跨夜后同一具尸体重新可报。 */
    function aiScanBodies(a,dt){
      if(!a.alive||a.downed||a.detained||G.over)return;
      /* 正在拖尸 / 正按计划"绕一圈再回来报告"时，不让扫描抢先拉铃 */
      if(a.drag!=null||a._reportPlan)return;
      if(!a.mind)mindReset(a);
      if(a._reportT>0){
        a._reportT-=dt;
        if(a._reportT<=0){
          const v=a._reportBody; a._reportBody=null;
          if(v&&bodyPos(v)&&!G.meet&&!G.over){
            const bp=bodyPos(v);
            if(Math.hypot(bp[0]-a.x,bp[1]-a.y)<=5.8&&losNow(a.x,a.y,bp[0],bp[1])){
              markBodyReported(v);G.aiReportUsed=true;
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
        if(v.downed&&bodyReported(v))continue;
        const d=Math.hypot(bp[0]-a.x,bp[1]-a.y);
        if(d<bd&&aiCanSee(a,bp[0],bp[1],5.4)){bd=d;best=v;}
      }
      if(!best){a._sawBody=null;return;}
      observeBody(a,best);
      /* 人类先搜查取证；任何 AI 看到伤者/尸体上有自己缺的物资都会停下来搜一次。
         濒死者（还活着）也可以被搜走物资——否则异形永远等不到天亮尸体就被清场。 */
      const rescue=a.medkit>0&&best.alive&&best.downed;
      const busySearch=G.agents.some(x=>x!==a&&x._doing==='search'&&x._sv===best.i);
      const wantEvidence=!a.alien&&!best.searched;
      const wantLoot=aiWantsLoot(a,best);
      if(!rescue&&!busySearch&&!a.drag&&best.draggedBy==null&&bd<2.2&&
        a.doing<=0&&!a._fixGo&&!a._lightGo&&(wantEvidence||wantLoot)){
        a.path=null;a.moving=false;
        a.doing=1.2;a._dur=1.2;a._doing='search';a._sv=best.i;
        return;
      }
      if(G.noReport)return;
      if(rescue||!canReportBody(a,best))return;
      a._sawBody=best;
      a._reportT=(a.alien?2.0:1.4)+Math.random()*(a.alien?2.0:1.6);
      a._reportBody=best;
    }
    /* 报告判断（2026-10-30 改版）：
       · 不再限制「每晚只开一次会」，改成「同一具尸体同一夜只报道一次」
         （reportNight 记的是哪一夜；天亮入夜后同一具尸体可以再次拉铃）；
       · 异形会主动报告来拖人类的时间，但要权衡收益与暴露风险；
       · 人类只在有实际线索时报告，已经确定凶手则一定报告。 */
    function alienReportWorth(a,v){
      const prog=G.prog||0;
      /* 拖时间收益：人类进度越高、夜晚剩得越多，越值得拖 */
      const benefit=prog>=36?0.86:prog>=26?0.64:prog>=16?0.44:0.26;
      /* 暴露风险：旁边有非队友活人看着时，报告等于把自己放到现场 */
      const wit=watchersAt(a,v.x,v.y,7,a.i).filter(w=>!isMate(a,w.i)).length;
      const risk=wit>=2?0.28:(wit===1?0.58:1);
      /* 刚被人看见过（25 秒内）就先别抛头露面：再去拉铃只会把自己钉在案发现场 */
      const seen=recentWitness(a,25)?0.6:1;
      /* 每只异形每夜一个固定倾向（0.8~1.2），避免同一只永远同一套打法 */
      const bias=a._stallBias||1;
      return benefit*risk*seen*bias;
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
        /* 已确定凶手必报；否则只在有实际线索/高警觉时报告，避免空耗夜晚 */
        if(bestKnownTarget(a))return true;
        if(a.mind.alert>=0.4)return true;
        return !!topSus(a,0.45);
      }
      /* 尸体：异形按收益/风险算一次（每具尸体只算一次，避免反复采样变成必报），人类照常报告 */
      if(a.alien){
        if(!a._reportMemo)a._reportMemo={};
        if(a._reportMemo[v.i]==null)
          a._reportMemo[v.i]=alienReportWorth(a,v)>=0.45;
        return a._reportMemo[v.i];
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
    /* 谁会去翻尸体/伤者：人类需要证据/物资，异形需要子弹/医疗包/申请单。
       先走到目标旁，再由 search 结算；活着且没倒下的不搜。 */
    function nearestLootBody(a,maxD){
      let best=null,bd=maxD;
      for(const v of G.agents){
        if(v===a)continue;
        const bp=bodyPos(v); if(!bp||(v.alive&&!v.downed))continue;
        if(a.alien&&isMate(a,v.i))continue;
        if(v.draggedBy!=null||!bodyHasLoot(v)||!aiWantsLoot(a,v))continue;
        const d=Math.hypot(bp[0]-a.x,bp[1]-a.y);
        if(d<bd&&aiCanSee(a,bp[0],bp[1],maxD)){bd=d;best=v;}
      }
      return best;
    }
    function startLootSearch(a,v,dt){
      if(!a||!v||!bodyHasLoot(v)||!aiWantsLoot(a,v))return false;
      if(a.alien&&isMate(a,v.i))return false;
      if(v.draggedBy!=null)return false;
      const bp=bodyPos(v); if(!bp)return false;
      if(G.agents.some(x=>x!==a&&x._doing==='search'&&x._sv===v.i))return false;
      if(a.alien&&G.simMode&&G.simStats)G.simStats.alienLootTries++;
      if(a._lootMem)delete a._lootMem[v.i];
      const d=Math.hypot(bp[0]-a.x,bp[1]-a.y);
      if(d<2.2){
        a.path=null;a.moving=false;
        a.doing=1.2;a._dur=1.2;a._doing='search';a._sv=v.i;
        return true;
      }
      if(!a.path||!a.path.length)walkTo(a,bp[0],bp[1]);
      if(!a.path||!a.path.length){
        if(a._lootMem)delete a._lootMem[v.i];
        return false;
      }
      stepMove(a,dt,moveSpeed(a));return true;
    }
    function lootRun(a,dt){
      if(!a||a.doing>0||a.drag!=null||a._fixGo||a._lightGo)return false;
      if(!((a.bullet|0)<1||(a.medkit|0)<1||(a.qual|0)<2))return false;
      const v=nearestLootBody(a,12);
      if(v&&startLootSearch(a,v,dt))return true;
      /* 视野里没有时，回到 30 秒内见过、仍然带自己缺的物资的目标：
         形成“看到伤者 → 之后专门绕回去收尸”的节奏，而不是只在贴脸时顺手摸一下。 */
      const mem=a._lootMem||{};
      let best=null,bd=20;
      for(const k in mem){
        const t=mem[k], v2=G.agents[+k];
        if(!v2||!t||evNow()-t.t>30||!bodyHasLoot(v2)||v2.draggedBy!=null||
          !aiWantsLoot(a,v2)){
          delete mem[k];continue;
        }
        const bp=bodyPos(v2); if(!bp){delete mem[k];continue;}
        const d=Math.hypot(bp[0]-a.x,bp[1]-a.y);
        if(d<bd){bd=d;best=v2;}
      }
      return !!(best&&startLootSearch(a,best,dt));
    }
    /* 医疗间复活调度：AI 人类没有医疗包时，会把濒死者拖到医疗间交给医疗无人机 */
    let MED_DROP=null;
    function medbotUsable(){
      return !!(G&&!G.medbotDead&&(G.medbotLeft==null?MEDBOT_CHARGES:G.medbotLeft)>0);
    }
    function inMedRoom(x,y){const r=roomAt(x,y);return !!(r&&r.id==='med');}
    /* 拖拽目标点：无人机固定在医疗间正中央悬停，把人丢进医疗间任意位置它都会飞过来，
       所以目标点就是房间中心，不再追着巡逻中的机器人跑。 */
    function medDropSpot(){
      const b=medbotUsable()?botPos('medbot'):null;
      if(b&&inMedRoom(b.x,b.y))return nearestFree(b.x,b.y);
      if(!MED_DROP){const mr=M.rooms.find(r=>r.id==='med');MED_DROP=nearestFree(mr.rect[0]+mr.rect[2]/2,mr.rect[1]+mr.rect[3]/2);}
      return MED_DROP;
    }
    /* 只要在医疗间里就算到位：无人机会自己飞过来，不再要求贴近机器人 */
    function nearMedBot(v,rad){
      if(!v)return false;
      if(inMedRoom(v.x,v.y))return true;
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
    /* 正在修任务时，已确证的异形在视野内快速靠近，且赶不上修完 → 弃修逃跑 */
    function taskThreat(a,remain){
      if(!a||a.alien||!a.alive||a.downed)return null;
      const kn=bestKnownTarget(a);
      if(!kn)return null;
      const t=G.agents[kn.i];
      if(!t||!t.alive||t.downed||t===a)return null;
      const d=Math.hypot(t.x-a.x,t.y-a.y);
      if(d>7||!aiCanSee(a,t.x,t.y,7))return null;
      const closing=!!(t.moving||(t.path&&t.path.length));
      if(!closing&&d>3.5)return null;
      const travel=d/Math.max(1,moveSpeed(t));
      return (remain==null?2.5:remain)>travel-0.6?t:null;
    }
    function fleeTask(a,t){
      a.doing=0;a._doing=null;a._taskPt=null;
      a._fleeT=3.5+Math.random()*1.5;a._fleeFrom=t?t.i:null;
      const ang=t?Math.atan2(a.y-t.y,a.x-t.x):Math.random()*6.283;
      const bx=Math.max(1,Math.min(M.bounds.w-1,
        a.x+Math.cos(ang)*(7+Math.random()*3)));
      const by=Math.max(1,Math.min(M.bounds.h-1,
        a.y+Math.sin(ang)*(7+Math.random()*3)));
      let q=nearestFree(bx,by);
      if(!free(q[0],q[1])){
        const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];
        q=nearestFree(r.rect[0]+r.rect[2]/2,r.rect[1]+r.rect[3]/2);
      }
      a.path=null;a.moving=false;walkTo(a,q[0],q[1]);
      if(a===G.me&&!G.spectMode)toast('异形正在靠近，放弃维修');
    }
    function aiHuman(a,dt){
      if(G.meet||G.over)return;
      if(a.detained)return;
      if(a._pathCD>0)a._pathCD-=dt;
      dropStaleFix(a);
      if(a.doing>0&&a._doing==='task'){
        const th=taskThreat(a,a.doing);
        if(th){fleeTask(a,th);return;}
      }
      if(a._fleeT>0){
        a._fleeT-=dt;
        if(a.path&&a.path.length)stepMove(a,dt,moveSpeed(a));else a.moving=false;
        return;
      }
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
      /* 已经在拖人：人进了医疗间就松手（无人机会自己飞过来）；拖拽中状态失效就松手 */
      if(a.drag!=null){
        const v=G.agents[a.drag];
        if(!v||!v.alive||!v.downed){releaseDragBy(a,true);}
        else if(!medbotUsable()){releaseDragBy(a,true);a._rest=1.0;return;}
        else if(nearMedBot(v)){releaseDragBy(a,true);a._rest=1.0;return;}
        else{
          const m=medDropSpot();
          if(Math.hypot(a.x-m[0],a.y-m[1])<1.0){
            /* 已经贴到无人机坞位却还没进房间：原地等一下，不在医疗间门口乱转 */
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
          const bs=bestSusTarget(a,0.5);
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
      /* 没有医疗包但医疗无人机可用：把视线内的濒死者拖进医疗间，交给机器人复活。
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
      /* 全船断电：先让 1 名人类 AI 去合闸；断电视野差，优先级高于零散任务。
         合闸人一旦被指定就不再抢故障，避免两个目标来回切换。 */
      if(G.lightState===2){
        const br=M.facility.find(f=>f.kind==='breaker');
        if(br){
          if(!a._lightGo){
            const crew=G.agents.filter(x=>x!==a&&x._lightGo&&x.alive&&!x.downed).length;
            if(crew<1)a._lightGo=true;
          }
          if(a._lightGo){
            if(Math.hypot(br.x-a.x,br.y-a.y)<BREAKER_USE_R){
              a.path=null;a.moving=false;a.doing=3;a._dur=3;a._doing='breaker';return;
            }
            if(!a.path||!a.path.length)walkTo(a,br.x,br.y);
            stepMove(a,dt,moveSpeed(a));return;
          }
        }
      }else if(a._lightGo)a._lightGo=false;
      /* 故障抢修：一座故障最多 2 名 AI 响应，最近的两名直接赶过去连续修 10 秒。
         30 秒后要扣 5 分，比零散任务更贵；锁定后不被脚步声/任务点打断，避免踱步。 */
      if(G.dmg.length){
        if(a._fixGo&&G.dmg.indexOf(a._fixGo)<0)a._fixGo=null;
        if(!a._fixGo){
          let best=null,bd=1e9;
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
      /* 尸体上有自己缺的子弹/医疗包/申请单 → 主动去翻尸（人类同样会搜尸取证） */
      if(lootRun(a,dt))return;
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
        if(spNear.item==='ammo'&&a.bullet<1){a.path=null;a.moving=false;a.doing=SUPPLY_AMMO_TIME;a._dur=SUPPLY_AMMO_TIME;a._doing='ammo';return;}
        if(spNear.item==='med'&&a.medkit<1){a.path=null;a.moving=false;a.doing=SUPPLY_MED_TIME;a._dur=SUPPLY_MED_TIME;a._doing='med';return;}
      }
      /* 有申请单且确实需要（目击凶手缺弹 / 有人濒死缺包）→ 主动去对应补给点 */
      const need=supplyTargetFor(a);
      if(need){
        const sp=supplyPoints().find(q=>q.item===need);
        if(sp){
          if(Math.hypot(sp.x-a.x,sp.y-a.y)<1.7){
            a.path=null;a.moving=false;
            if(need==='ammo'){a.doing=SUPPLY_AMMO_TIME;a._dur=SUPPLY_AMMO_TIME;a._doing='ammo';}
            else{a.doing=SUPPLY_MED_TIME;a._dur=SUPPLY_MED_TIME;a._doing='med';}
            return;
          }
          walkTo(a,sp.x,sp.y);stepMove(a,dt,moveSpeed(a));return;
        }
      }
      /* 任务全做完：不再原地呆站（2026-10-31），改去干别的有用的事 */
      if(a.tIdx>=a.tasks.length){ aiIdleRoam(a,dt); return; }
      const p=M.points[a.tasks[a.tIdx]];
      if(Math.hypot(p.x-a.x,p.y-a.y)<2.8){
        const th=taskThreat(a,p.dur);
        if(th){fleeTask(a,th);return;}
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
    /* 藏尸目的地：永远排除医疗间和会议室，并尽量把尸体拖离医疗间——
       越远医疗间分越高，同时每多拖 1 格扣 0.55 分，避免为了藏尸横穿全图。 */
    /* 藏尸目的地：远离医疗间的方向 + 远离活人 + 随机挑选，
       不再每局都把尸体固定拖去仓库（旧实现是纯确定性最高分，仓库离医疗间最远）。 */
    function hideRoomFor(rid,x,y){
      const med=M.rooms.find(r=>r.id==='med');
      const mc=med?nearestFree(med.rect[0]+med.rect[2]/2,med.rect[1]+med.rect[3]/2):null;
      const cands=[];
      for(const r of M.rooms){
        if(r.id==='med'||r.id==='bridge'||r.id===rid)continue;
        const c=nearestFree(r.rect[0]+r.rect[2]/2,r.rect[1]+r.rect[3]/2);
        const dBody=Math.hypot(c[0]-x,c[1]-y);
        const dMed=mc?Math.hypot(c[0]-mc[0],c[1]-mc[1]):0;
        let crowd=0,near=1e9;
        for(const a of G.agents){
          if(!a.alive||a.downed||a.detained)continue;
          const dd=Math.hypot(a.x-c[0],a.y-c[1]);
          if(dd<10){crowd++;if(dd<near)near=dd;}
        }
        /* 有人看着的房间优先排除；实在没有空房时才选人少的 */
        const risk=crowd?(crowd*10/(1+near)):0;
        const score=dMed-dBody*0.55-risk*6+Math.random()*7;
        cands.push({id:r.id,score,crowd});
      }
      if(!cands.length)return rid;
      const empty=cands.filter(c=>c.crowd===0);
      const pool=(empty.length?empty:cands).sort((a,b)=>b.score-a.score).slice(0,3);
      return pool[Math.floor(Math.random()*pool.length)].id;
    }
    /* 医疗间中心：判断“拖尸是不是在往医疗间走” */
    const MED_CENTER=(function(){
      const r=M.rooms.find(q=>q.id==='med');
      return r?[r.rect[0]+r.rect[2]/2,r.rect[1]+r.rect[3]/2]:null;
    })();
    /* 目击者看到“尸体被拖离医疗间” → 只加嫌疑，不写 known（拖尸人类也会做） */
    function dragAwayNotice(a,v){
      if(!a||!v||v.alive)return;
      logEvent('drag_away',{actor:a.i,victim:v.i,room:roomIdAt(a.x,a.y),
        x:+a.x.toFixed(1),y:+a.y.toFixed(1)});
      for(const w of G.agents){
        if(w===a||w.alien||!w.alive||w.downed||w.detained)continue;
        if(Math.hypot(w.x-a.x,w.y-a.y)>6)continue;
        if(!aiCanSee(w,a.x,a.y,6))continue;
        w._dragAwaySeen=w._dragAwaySeen||{};
        const key=a.i+':'+G.night;
        if(w._dragAwaySeen[key])continue;
        w._dragAwaySeen[key]=1;
        const ev={kind:'saw_drag_away',x:a.x,y:a.y,room:roomIdAt(a.x,a.y),
          subj:a.i,victim:v.i,conf:0.85,src:'sight'};
        evPush(w,ev);
        susAdd(w,a.i,EV_W.saw_drag_away,'saw_drag_away',ev);
        if(w.suspect==null||(w.mind.sus[w.suspect]||0)<0.5)w.suspect=a.i;
      }
    }
    function findHideBody(a){
      let best=null,bd=3.2;
      for(const v of G.agents){
        if(v===a)continue;
        const bp=bodyPos(v); if(!bp)continue;
        if(v.draggedBy!=null)continue;
        /* 尸体上还有自己缺的物资：先搜尸再藏，别把子弹/医疗包一起埋了 */
        if(aiWantsLoot(a,v))continue;
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
    /* 某个位置（通常是受害者脚下）除了受害者以外，还有哪些活人看得见。
       不按 alien 过滤：AI 不读取队友身份，异形同伴也会被当成"旁人"。
       半径与 witnessAlienAction 的 6 格取证一致，避免"规则看不见、实际被看到"。 */
    function watchersAt(a,x,y,rad,except){
      const out=[];
      for(const w of G.agents){
        if(w===a||w===except||!w.alive||w.downed||w.detained)continue;
        if(Math.hypot(w.x-x,w.y-y)>rad)continue;
        if(!aiCanSee(w,x,y,rad))continue;
        out.push(w);
      }
      return out;
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
    /* 异形的“伪装/补给”支持：拿申请单、换子弹、翻尸、偶尔做任务换弹、假装维修。
       目标：异形也能使用规则，只是动机不同——做任务通常是为了继续杀人。 */
    function alienFakeSpot(a){
      if(!G.dmg.length)return null;
      let best=null,bd=1e9;
      for(const d of G.dmg){
        const dd=Math.hypot(d.x-a.x,d.y-a.y);
        if(dd<bd){bd=dd;best=d;}
      }
      return best?{x:best.x,y:best.y}:null;
    }
    /* 假装做任务：去一个任务点站一会儿，动画看起来像在维修，但不加任何进度 */
    function alienFakeTaskSpot(a){
      const idx=a.tasks&&a.tasks[a.tIdx];
      const p=M.points[idx]||M.points[Math.floor(Math.random()*M.points.length)];
      if(!p)return null;
      /* 任务点本身常在家具/掩体上，假装修理要走到最近的可站点，
         否则 A* 到不了、异形会在旁边原地卡住 */
      const f=nearestFree(p.x,p.y);
      return {x:f[0],y:f[1],pt:idx};
    }
    /* 附近是否有能当“观众”的非队友活人（假装维修/做任务只在有人看时演） */
    function alienAudience(a,rad){
      for(const w of G.agents){
        if(w===a||!w.alive||w.downed||w.detained||isMate(a,w.i))continue;
        if(Math.hypot(w.x-a.x,w.y-a.y)<rad&&aiCanSee(a,w.x,w.y,rad))return true;
      }
      return false;
    }
    function alienSupport(a,dt){
      if(!a||!a.alien||a.doing>0||a.drag!=null)return false;
      /* 贴脸有人可杀时先处理人；没刀时才搞伪装/补给 */
      if(a.knife>0&&a.target&&a.target.alive&&!a.target.downed&&
        Math.hypot(a.target.x-a.x,a.target.y-a.y)<5)return false;
      let close=1e9;
      for(const w of G.agents){
        if(w===a||!w.alive||w.downed||w.detained||isMate(a,w.i))continue;
        const d=Math.hypot(w.x-a.x,w.y-a.y);
        if(d<close)close=d;
      }
      /* 自己刀倒的人如果已经失血死亡，记得回去收走物资 / 藏尸（不是杀完就永远不管） */
      if(a._killBody!=null&&evNow()-(a._killAt||0)<45){
        const kv=G.agents[a._killBody];
        const kp=kv?bodyPos(kv):null;
        if(kp&&!kv.alive&&kv.draggedBy==null&&aiWantsLoot(a,kv)){
          const d=Math.hypot(kp[0]-a.x,kp[1]-a.y);
          if(d<2.2){
            a.path=null;a.moving=false;
            a.doing=1.2;a._dur=1.2;a._doing='search';a._sv=kv.i;
            return true;
          }
          if(!a.path||!a.path.length)walkTo(a,kp[0],kp[1]);
          stepMove(a,dt,moveSpeed(a));return true;
        }
      }
      /* 已锁定的伪装/任务目标：持续走过去，到了就装忙/做任务 */
      if(a._supportGoal){
        const g=a._supportGoal;
        if(g.kind==='task'&&a._alienTaskN===G.night)a._supportGoal=null;
        else if(g.kind==='fake'&&a._fakeN===G.night)a._supportGoal=null;
        else if(g.kind==='fakeTask'&&a._fakeTaskN===G.night)a._supportGoal=null;
        else{
          if(Math.hypot(g.x-a.x,g.y-a.y)<2.0){
            a._supportGoal=null;a.path=null;a.moving=false;
            if(g.kind==='task'){
              a._alienTaskN=G.night;a._alienTaskTotal=(a._alienTaskTotal||0)+1;
              a.doing=g.dur;a._dur=g.dur;
              a._doing='task';a._taskPt=g.pt;
            }else if(g.kind==='fakeTask'){
              a._fakeTaskN=G.night;a._fakeKind='task';
              a.doing=g.dur;a._dur=g.dur;a._doing='fake';
            }else{
              a._fakeN=G.night;a._fakeKind='repair';
              a.doing=g.dur;a._dur=g.dur;a._doing='fake';
            }
            return true;
          }
          if(!a.path||!a.path.length)walkTo(a,g.x,g.y);
          stepMove(a,dt,moveSpeed(a));return true;
        }
      }
      /* 有申请单先回圆桌领取 */
      if(a.qualPending>0){
        const qd=roundTableClaimSpot();
        if(qd){
          if(Math.hypot(qd.x-a.x,qd.y-a.y)<1.8){
            a.path=null;a.moving=false;a.doing=3;a._dur=3;a._doing='qual';return true;
          }
          if(!a.path||!a.path.length)walkTo(a,qd.x,qd.y);
          stepMove(a,dt,moveSpeed(a));return true;
        }
      }
      /* 有申请单且缺子弹 → 军械补给点（与人类同一条补给规则） */
      if(a.qual>0&&a.bullet<1){
        const sp=supplyPoints().find(q=>q.item==='ammo');
        if(sp){
          if(Math.hypot(sp.x-a.x,sp.y-a.y)<1.7){
            a.path=null;a.moving=false;a.doing=SUPPLY_AMMO_TIME;a._dur=SUPPLY_AMMO_TIME;a._doing='ammo';return true;
          }
          if(!a.path||!a.path.length)walkTo(a,sp.x,sp.y);
          stepMove(a,dt,moveSpeed(a));return true;
        }
      }
      /* 翻尸体拿子弹/医疗包/申请单 */
      if(lootRun(a,dt))return true;
      if(!a._supportGoal&&(a.knife<=0||close>8)){
        const nearFault=G.dmg.some(d=>Math.hypot(d.x-a.x,d.y-a.y)<8);
        /* 假装维修：就在故障旁时站桩，不修好、不加进度 */
        if(nearFault&&a._fakeN!==G.night&&alienAudience(a,8)&&Math.random()<dt*0.10){
          const sp=alienFakeSpot(a);
          if(sp){a._supportGoal={kind:'fake',x:sp.x,y:sp.y,dur:5+Math.random()*4};return true;}
        }
        /* 假装做任务：没有近处故障可演时，去任务点站一会儿；
           动画看起来像在维修，但不加任何进度，用来制造目击者在场的不在场证明。 */
        if(a._fakeTaskN!==G.night&&alienAudience(a,8)&&Math.random()<dt*0.10){
          const p=alienFakeTaskSpot(a);
          if(p){a._supportGoal={kind:'fakeTask',x:p.x,y:p.y,pt:p.pt,dur:4+Math.random()*4};return true;}
        }
      }
      /* 真做任务只为换申请单，是少数策略：每只异形整局最多 1 次；
         人类进度接近 45 时不做，避免替人类完成维修胜利。 */
      if(!a._supportGoal&&a.knife<=0&&a.bullet<1&&a.qual<1&&
        (a._alienTaskTotal||0)<1&&G.prog<38&&a._alienTaskN!==G.night&&
        Math.random()<dt*0.02){
        const p=M.points[a.tasks[a.tIdx]];
        if(p){a._supportGoal={kind:'task',x:p.x,y:p.y,dur:p.dur,pt:a.tasks[a.tIdx]};return true;}
      }
      return false;
    }
    function alienMateRevive(a,dt){
      if(!a||!a.alien||a.medkit<1||a.doing>0)return false;
      let v=null,bd=8;
      for(const w of G.agents){
        if(w===a||!w.alive||!w.downed||!isMate(a,w.i))continue;
        const d=Math.hypot(w.x-a.x,w.y-a.y);
        if(d<bd&&aiCanSee(a,w.x,w.y,8)){bd=d;v=w;}
      }
      if(!v)return false;
      if(bd<1.7){
        a.path=null;a.moving=false;
        a.doing=5;a._dur=5;a._doing='revive';a._rv=v;return true;
      }
      if(!a.path||!a.path.length)walkTo(a,v.x,v.y);
      stepMove(a,dt,moveSpeed(a));return true;
    }
    /* 管道机动：目标远、自己不在管道口时，先规划到能显著缩短距离的入口；
       站在口上就直接钻到离目标最近的出口。每夜最多 2 次、20 秒冷却。
       这是异形的核心位移能力，必须排在“没刀就游荡/补给”之前。 */
    function alienPipeMove(a,dt,tgt,td){
      if(!tgt||td<=15||a._pipeCD>0||a.drag!=null){a._pipePlan=null;return false;}
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
          if(G.simMode&&G.simStats)G.simStats.alienPipes++;
          G.fx.push({type:'pipefx',x:best.x,y:best.y,t:0.8,dur:0.8});
          hear(best.x,best.y,'pipe',0.9);
          logEvent('pipe',{actor:a.i,from:from.room,to:best.room,
            x:+best.x.toFixed(1),y:+best.y.toFixed(1)});
          witnessAlienAction(a,from.x,from.y,6,'pipe');
          witnessAlienAction(a,best.x,best.y,6,'pipe');
          aiHear('pipe',best.x,best.y,12,{actor:a});
          return true;
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
          if(plan&&G.simMode&&G.simStats)G.simStats.alienPipePlans++;
          a._pipePlan=plan;
        }
        if(a._pipePlan){
          const pin=a._pipePlan.in;
          if(Math.hypot(a.x-pin.x,a.y-pin.y)<1.2){
            const out=a._pipePlan.out;
            a.x=out.x;a.y=out.y;a.path=null;a._pipeCD=20;a._pipePlan=null;
            a._pipeSeeks=(a._pipeSeeks||0)+1;
            if(G.simMode&&G.simStats)G.simStats.alienPipes++;
            G.fx.push({type:'pipefx',x:out.x,y:out.y,t:0.8,dur:0.8});
            hear(out.x,out.y,'pipe',0.9);
            logEvent('pipe',{actor:a.i,from:pin.room,to:out.room,
              x:+out.x.toFixed(1),y:+out.y.toFixed(1)});
            witnessAlienAction(a,pin.x,pin.y,6,'pipe');
            witnessAlienAction(a,out.x,out.y,6,'pipe');
            aiHear('pipe',out.x,out.y,12,{actor:a});
            return true;
          }
          if(!a.path||!a.path.length)walkTo(a,pin.x,pin.y);
          stepMove(a,dt,moveSpeed(a));return true;
        }
      }
      return false;
    }
    function aiAlien(a,dt){
      if(G.meet||G.over)return;
      if(a.detained)return;
      if(a._pathCD>0)a._pathCD-=dt;
      dropStaleFix(a);
      if(a.doing>0){
        a.doing-=dt;
        if(a.doing<=0){
          if(a._doing==='fake'){
            a._doing=null;a.doing=0;
            if(G.simMode&&G.simStats){
              if(a._fakeKind==='task')G.simStats.fakeTasks++;
              else G.simStats.fakeRepairs++;
            }
            a._fakeKind=null;
          }
          else finishDoing(a);
        }
        return;
      }
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
        if(!v||!bodyPos(v)||bodyReported(v)||v.draggedBy!=null&&v.draggedBy!==a.i){
          a._reportPlan=null;
        }else if(p.wait>0){
          p.wait-=dt;
          if(p.direct){
            /* 直接报案：不绕去别处做不在场，原地稍等就拉铃 */
            const bp=bodyPos(v);
            if(bp&&Math.hypot(bp[0]-a.x,bp[1]-a.y)>2.2){
              if(!a.path||!a.path.length)walkTo(a,bp[0],bp[1]);
              stepMove(a,dt,moveSpeed(a));
            }else a.moving=false;
            return;
          }
          if(!a.path||!a.path.length){
            if(!p.spot)p.spot=reportAlibiSpot(a);
            if(p.spot)walkTo(a,p.spot[0],p.spot[1]);
          }
          stepMove(a,dt,moveSpeed(a));return;
        }else{
          const bp=bodyPos(v);
          const d=Math.hypot(bp[0]-a.x,bp[1]-a.y);
          if(d<2.6&&losNow(a.x,a.y,bp[0],bp[1])){
            /* 回到自己做的尸体旁：四周没人时先把死者身上的物资摸走，再拉铃报案 */
            if(aiWantsLoot(a,v)&&!watchersAt(a,bp[0],bp[1],7,v).length){
              a.path=null;a.moving=false;
              a.doing=1.2;a._dur=1.2;a._doing='search';a._sv=v.i;
              return;
            }
            markBodyReported(v);G.aiReportUsed=true;a._reportPlan=null;
            openMeeting('night',a,v);
            return;
          }
          if(!a.path||!a.path.length)walkTo(a,bp[0],bp[1]);
          stepMove(a,dt,moveSpeed(a));return;
        }
      }
      if(a._killBody!=null&&!a._killDecided){
        /* 每次行凶只掷一次骰子：有活人目击时更谨慎（15%），没人看见则更敢演（40%）。
           决定报案后还有一小段概率"直接原地拉铃"：不绕去别处做不在场，
           开会更快但更像凶手——大多数时候仍然先离开再回来。 */
        a._killDecided=true;
        const v=G.agents[a._killBody];
        if(v&&bodyPos(v)&&!bodyReported(v)){
          const wit=recentWitness(a,20);
          /* 拖时间收益随人类进度升高；被目击时暴露风险把概率压到 42% */
          const benefit=G.prog>=34?0.72:(G.prog>=24?0.52:0.34);
          const p=wit?benefit*0.42:benefit;
          if(Math.random()<p){
            a._reportT=0;a._reportBody=null;
            const direct=Math.random()<(wit?0.2:0.35);
            a._reportPlan={body:v.i,wait:direct?0.8+Math.random()*1.2:5+Math.random()*7,
              spot:null,direct:direct};
            return;
          }
        }
      }
      /* 已认出队友倒下且手里有医疗包：优先救队友，别把他当尸体拖走 */
      if(alienMateRevive(a,dt))return;
      if(a._pipeCD>0)a._pipeCD-=dt;
      if(a._botCD>0)a._botCD-=dt;
      if(!a.target||!a.target.alive||a.target.downed){
        /* 挑目标：队友永不打；被围观的目标加 12 格风险；队友已在追的目标让给队友；
           被晾过的目标 12 秒内不碰，只有实在没人时才回头。 */
        let best=null,bs=1e9,fallback=null,fs=1e9;
        for(const h of G.agents){
          if(h===a||!h.alive||h.downed||h.detained)continue;
          if(isMate(a,h.i))continue;
          const d=Math.hypot(h.x-a.x,h.y-a.y);
          const watched=watchersAt(a,h.x,h.y,6,h).some(w=>!isMate(a,w.i));
          const mateOnIt=G.agents.some(m=>m!==a&&m.alien&&isMate(a,m.i)&&m.alive&&
            m.target&&m.target.i===h.i);
          /* 正在站桩做任务/维修/领取的人更值得下手：优先度按距离减 12 格，
             即使稍远也先挑他；被围观惩罚仍会抵消这个优先。 */
          const busy=h.doing>0;
          const s=d+(watched?12:0)+(mateOnIt?8:0)+(busy?-12:0);
          const until=a._avoid&&(a._avoid[h.i]||0);
          if(until&&evNow()<until){
            if(s<fs){fs=s;fallback=h;}
            continue;
          }
          if(s<bs){bs=s;best=h;}
        }
        a.target=best||fallback;
      }
      /* 现场目击者优先：异形自己看见谁在视线里，就去处理谁；队友除外 */
      if(a.knife>0&&a.mind&&a.mind.seenBy){
        let wit=null,bd=1e9;
        for(const k in a.mind.seenBy){
          const e=a.mind.seenBy[k];
          if(evNow()-e.t>25)continue;
          const w=G.agents[+k];
          if(!w||!w.alive||w.downed||w.detained||w===a||isMate(a,w.i))continue;
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
      /* 异形有子弹也会开枪：远距离/没刀时优先用枪，而不是永远只贴脸出刀 */
      if(a.bullet>0&&tgt&&!isMate(a,tgt.i)&&(td>1.4||a.knife<=0)&&td<9&&
        aiCanSee(a,tgt.x,tgt.y,9)&&Math.random()<0.7){
        fireShot(a,tgt);a._rest=1.5;return;
      }
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
            const bd=G.powerFixed?6:3;
            a.sabUsed=true;a.doing=bd;a._dur=bd;a._doing='breaker';
            return;
          }
          if(!a.path||!a.path.length)walkTo(a,br.x,br.y);
          stepMove(a,dt,moveSpeed(a));return;
        }
      }
      /* 机器人：有刀就先出刀砍装甲（消耗刀数，按保安 2 / 医疗 1 的 HP 结算，
         与玩家 Q 完全同一条 knifeBot 入口）；刀用完了才动用每夜一次的破坏技直接停摆。
         2026-10-31 收紧：保安默认不碰，必须先满足 secbotRaidOk（房间里认出 2 名以上队友
         + 有一个共同捕杀目标）才列为候选；无人机仍然是高价值目标（它挡救援）。 */
      {
        let bk=null,bp=null,bd=8;
        for(const k of ['secbot','medbot']){
          if(k==='secbot'){
            if(G.secbotDead)continue;
            const q=botPos('secbot');
            if(!q||!secbotRaidOk(a,q))continue;
            const d=Math.hypot(q.x-a.x,q.y-a.y);
            if(d<bd){bd=d;bk=k;bp=q;}
            continue;
          }
          if(G.medbotDead)continue;
          const q=botPos('medbot'); if(!q)continue;
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
          /* 拖尸尽量避开活人：有非队友在 6.5 格内且看得见，先松手走开，
             过几秒再回来；比拖着尸体从人堆里穿过更安全。 */
          const seen=watchersAt(a,a.x,a.y,6.5).filter(w=>!isMate(a,w.i));
          if(seen.length){
            releaseDragBy(a,true);a._hideCD=8;a._hideSpot=null;a._hideRoom=null;a._rest=0.8;
            return;
          }
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
         藏尸目的地永远排除医疗间/会议室，并尽量拖到离医疗间更远的舱室，
         降低尸体被医疗无人机/队友发现并复活的机会。 */
      if(!a.drag&&(a._hideCD||0)<=0&&(a._hides||0)<2&&!recentWitness(a,25)){
        const v=findHideBody(a);
        const bp=v?bodyPos(v):null;
        const busy=!!(v&&v.alive&&v.downed);
        if(bp&&td>(busy?12:6)){
          /* 有人在看就不动手：藏尸本身不能制造目击者 */
          const seen=watchersAt(a,bp[0],bp[1],6.5).filter(w=>!isMate(a,w.i));
          if(seen.length){a._hideCD=7;return;}
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
      if(a.knife<=0&&alienSupport(a,dt))return;
      /* 有刀但附近没有可下手的目标：也会顺手翻尸/补给/装忙，
         不是“有刀就只会直线追人”的单一行为。 */
      if(a.knife>0&&td>12&&alienSupport(a,dt))return;
      /* 管道是核心位移能力：排在补给/伪装之后、没刀游荡之前，
         否则刀用完后永远走不到管道口。 */
      if(alienPipeMove(a,dt,tgt,td))return;
      if(a.knife<=0){ // 没刀了就游荡（先尝试补给/翻尸/假装维修/做任务换弹）
        if(!a.path||!a.path.length){const r=M.rooms[Math.floor(Math.random()*M.rooms.length)];const p=randIn(r);walkTo(a,p[0],p[1]);}
        stepMove(a,dt,moveSpeed(a)); return;
      }
      if(!tgt)return;
      if(td<1.3){
        if(secbotWouldSee(a.x,a.y)){
          a._secAvoidT=2.5;a.target=null;a.path=null;return;
        }
        /* 旁边有非队友目击者：只有 1 个时 55% 冒险出手；2 个以上必定放弃目标，
           改为去找落单的人 —— 不再原地来回踱步。队友看着不算风险，可以配合出刀。 */
        const watchers=watchersAt(a,tgt.x,tgt.y,6,tgt).filter(w=>!isMate(a,w.i));
        if(watchers.length>=2||(watchers.length===1&&Math.random()>=0.55)){
          if(!a._avoid)a._avoid={};
          a._avoid[tgt.i]=evNow()+12;
          a.target=null;a.path=null;
          return;
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
      if(G.simMode&&G.simStats)G.simStats.knives++;
      /* 3 秒红身：让目击者一眼认出刚出刀的人（纯表现，不改变判定） */
      killer.redT=3.0;
      if(!G.spectMode&&victim===G.me&&G.dev){
        setAct(killer,'stab',0.4,{ang,lunge:0.4});
        G.fx.push({type:'shield',x:victim.x,y:victim.y,t:0.6,dur:0.6});
        if(killer&&killer!==G.me){killer.target=null;killer.path=null;}
        toast('DEV 无敌：这一刀没有生效');
        return;
      }
      /* 只响一次：单层刀风，不再叠 70ms 后的血肉声 */
      SND.knife(Math.max(0.18,Math.min(1,1.25-Math.hypot(victim.x-G.me.x,victim.y-G.me.y)/16)));
      SND.flesh(0.34);
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
      logEvent('knife',{actor:killer.i,victim:victim.i,room:victim.downRoom,
        x:+victim.x.toFixed(1),y:+victim.y.toFixed(1)});
      victim.path=null; victim.doing=0; victim._doing=null; victim._sv=null;
      witnessAlienAction(killer,victim.x,victim.y,6,'knife',victim);
      aiHear('knife',victim.x,victim.y,14,{actor:killer,victim:victim});
      screamFor(victim);
      if(!G.spectMode&&victim===G.me){closeCams(true);closePipePick(true);closeSabPick(true);G.sabTarget=null;toast('你被出刀击倒，濒死');}
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
      if(!G.spectMode&&a===G.me&&G.dev){toast('DEV 无敌：死亡被拦截');return false;}
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
      logEvent('kill',{actor:by==null?null:by,victim:a.i,
        method:cause==='bled'?(a.woundCause||'bled'):cause,
        room:a.deathRoom,x:a.deathX,y:a.deathY,gone:!!a.bodyGone});
      a.path=null; a.doing=0; a._doing=null;
      a.redT=0;
      if(a.drag!=null)releaseDragBy(a,true);
      const dg=draggerOf(a);
      if(dg)releaseDragBy(dg,true);
      if(!G.spectMode&&a===G.me){
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
      const actor=!G.spectMode&&a===G.me;
      if(a._doing==='search'){
        const b=a._sv!=null?G.agents[a._sv]:null;
        a._doing=null; a._sv=null;
        G.fx.push({type:'search',x:a.x,y:a.y,t:0.5,dur:0.5});
        if(b){
          const first=!b.searched;
          b.searched=true;
          const got=lootBody(a,b);
          const bp=bodyPos(b);
          logEvent('search',{actor:a.i,victim:b.i,first:first,none:!!got.none,
            room:bp?roomIdAt(bp[0],bp[1]):null,
            x:bp?+bp[0].toFixed(1):null,y:bp?+bp[1].toFixed(1):null,
            bullet:got.bullet,medkit:got.medkit,qual:got.qual});
          if(first){
            const bi=bodyInfo(b);
            evPush(a,{kind:'search_result',x:bi.pos?bi.pos[0]:b.x,y:bi.pos?bi.pos[1]:b.y,
              room:bi.room,victim:b.i,conf:1,src:'search',body:bi});
            if(bi.moved)evPush(a,{kind:'search_body_moved',x:bi.pos?bi.pos[0]:b.x,
              y:bi.pos?bi.pos[1]:b.y,room:bi.room,victim:b.i,conf:1,src:'search',body:bi});
          }
          if(actor){openBodyCard(b);toast(lootText(got,b));}
          if(G.simMode&&G.simStats){
            G.simStats.searches++;
            if(a.alien)G.simStats.alienLoots++; else G.simStats.humanLoots++;
            if(!got.none){
              G.simStats.loots++;
              G.simStats.bulletsLooted+=got.bullet;
              G.simStats.medkitsLooted+=got.medkit;
              G.simStats.qualsLooted+=got.qual;
            }
          }
        }
        return;
      }
      if(a._doing==='med'){
        a._doing=null;
        if((a.qual||0)<1){if(actor)toast('没有物资申请单：先回中央会议室圆桌领取');return;}
        a.medkit=1;a.qual--;
        G.fx.push({type:'pickup',x:a.x,y:a.y,t:1.2,dur:1.2,item:'med'});
        setAct(a,'pickup',0.55,{});
        logEvent('supply',{actor:a.i,item:'medkit',room:roomIdAt(a.x,a.y),
          x:+a.x.toFixed(1),y:+a.y.toFixed(1),qual:a.qual});
        if(actor){toast('拿到医疗包 · 物资申请单 -1');pulseHud('md');pulseHud('ql');SND.med();}
        return;
      }
      if(a._doing==='ammo'){
        a._doing=null;
        if((a.qual||0)<1){if(actor)toast('没有物资申请单：先回中央会议室圆桌领取');return;}
        a.bullet=1;a.qual--;
        G.fx.push({type:'pickup',x:a.x,y:a.y,t:1.2,dur:1.2,item:'ammo'});
        setAct(a,'pickup',0.55,{});
        logEvent('supply',{actor:a.i,item:'bullet',room:roomIdAt(a.x,a.y),
          x:+a.x.toFixed(1),y:+a.y.toFixed(1),qual:a.qual});
        if(actor){toast('拿到子弹 · 物资申请单 -1');pulseHud('bl');pulseHud('ql');SND.ammo();}
        return;
      }
      if(a._doing==='qual'){
        a._doing=null;
        if(a.qualPending>0){
          a.qualPending--; a.qual=Math.min(2,(a.qual||0)+1);
          G.fx.push({type:'qual',x:a.x,y:a.y,t:1.5,dur:1.5,n:a.qual});
          logEvent('qual',{actor:a.i,room:roomIdAt(a.x,a.y),
            x:+a.x.toFixed(1),y:+a.y.toFixed(1),n:a.qual});
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
          logEvent('revive',{actor:a.i,victim:v.i,method:'medkit',room:roomIdAt(v.x,v.y),
            x:+v.x.toFixed(1),y:+v.y.toFixed(1)});
          if(actor){toast('救起 '+v.name);SND.revive();}
          if(G.stats)G.stats.medkitRevives=(G.stats.medkitRevives||0)+1;
          if(G.simMode&&G.simStats){G.simStats.revives++;G.simStats.medkitRevives++;}
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
      /* ghostPts 是硬上限：AI 幽灵也走同一结算，玩家与 AI 都最多 2 分。 */
      G.prog=Math.min(45,G.prog+v);
      if(a.ghost)a.ghostPts=(a.ghostPts||0)+v;
      a.tIdx++; a.progress+=v;
      if(G.simMode&&G.simStats&&a.alien)G.simStats.alienTasks++;
      /* 分任务点计数：只看不干预，用来定位「某些任务点几乎没人完成」 */
      if(G.simMode&&G.simStats&&G.simStats.tasksByPoint)
        G.simStats.tasksByPoint[p.label]=(G.simStats.tasksByPoint[p.label]||0)+1;
      /* 局内统计：幽灵完成的维修任务（报告里要单列「幽灵修了几个任务」） */
      if(a.ghost&&G.stats)G.stats.ghostTasks=(G.stats.ghostTasks||0)+1;
      if(G.simMode&&G.simStats&&a.ghost)G.simStats.ghostTasks++;
      a.nTask=p.label; a.nTaskRoom=roomIdAt(a.x,a.y);
      logEvent('task',{actor:a.i,label:p.label,room:p.room,pts:v,ghost:!!a.ghost,
        x:+a.x.toFixed(1),y:+a.y.toFixed(1),prog:G.prog});
      let gotQual=false;
      if(a.progress>=3&&!a._q3){a._q3=true;a.qualPending=(a.qualPending||0)+1;gotQual=true;}
      if(a.progress>=5&&!a._q5){a._q5=true;a.qualPending=(a.qualPending||0)+1;gotQual=true;}
      G.fx.push({type:'done',x:a.x,y:a.y,t:1.0,dur:1.0});
      G.fx.push({type:'spark',x:p.x,y:p.y,t:0.8,dur:0.8});
      if(gotQual&&actor){pulseHud('qp');SND.qual();}
      /* 修好配电室的「电路维修」⇒ 全船照明恢复（拉闸仍可再次断电，但再拉要 6 秒） */
      let powerFix=false;
      if(p.room==='power'&&p.label==='电路维修'&&!G.powerFixed){
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
      /* AI 完成任务后不再原地休息，直接接下一个任务/维修。 */
    }
    
    function dawn(){
      logEvent('dawn',{prog:G.prog});
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
    /* 保安机器人：2026-10-30 削弱——视野半径 14 → 10.5 格（削 1/4，前方 180° 半圆不变）、
       每夜擒拿上限 3 → 2 次。SEC_USES_MAX 是唯一真源，判定与文案都读它。 */
    const SEC_RANGE=10.5, SEC_ARC=Math.PI/2, DETAIN_TIME=30, SEC_USES_MAX=2;
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
      if(!G||G.secbotDead||(G.secbotUses||0)>=SEC_USES_MAX)return false;
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
        /* 医疗无人机不巡逻：坞位就是医疗间正中央，航点只有它自己（它靠 medbotTick
           主动飞向伤员，巡逻线已删除）；保安机器人仍按 facility.patrol 走 4 点巡逻。 */
        const pts=kind==='medbot'?[[p[0],p[1]]]:(f.patrol&&f.patrol.length?f.patrol:[[f.x,f.y]]);
        const wps=pts.map(q=>nearestFree(q[0],q[1]));
        G.bots[kind]={x:p[0],y:p[1],wp:0,ang:0,face:1,wps:wps,moving:false};
        if(kind==='medbot')G.bots[kind].home=[p[0],p[1]];
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
    /* 拘留位：军械库角落（保安机器人把凶手押过去，30 秒后自动解锁） */
    function secJail(){
      /* 缓存一次即可：拘留位必须固定；原来每帧 nearestFree 会白跑 128 次循环 */
      return G&&G.jailPos?G.jailPos:null;
    }
    /* 保安捕捉：先近身追逐 → 压制 0.9 秒 → 押送到军械库角落。
       不再是“看到犯罪就瞬移锁角落”，但视频/音频仍会暴露这次抓捕。 */
    const SEC_CATCH_SPEED=7.5;
    function secCatchStart(killer,sec){
      const jail=secJail()||[sec.x,sec.y+1.6];
      G.secCatch={i:killer.i,phase:'chase',t:0,jail:[jail[0],jail[1]]};
      G.secbotUsed=true;G.secbotUses=(G.secbotUses||0)+1;G.secbotT=2.5;
      if(killer.drag!=null)releaseDragBy(killer,true);
      killer.path=null;killer.moving=false;killer.doing=0;killer._doing=null;
      G.fx.push({type:'alarm',x:sec.x,y:sec.y,t:1.4,dur:1.4});
      hear(sec.x,sec.y,'robot',1.25);
      aiHear('alarm',sec.x,sec.y,22,{});
      SND.alarm(); SND.robot();
    }
    function secCatchTick(dt,sec){
      const c=G.secCatch; if(!c)return false;
      const killer=G.agents[c.i];
      if(!killer||!killer.alive||killer.downed||G.over){G.secCatch=null;return false;}
      c.t+=dt;
      if(c.phase==='chase'){
        const d=Math.hypot(killer.x-sec.x,killer.y-sec.y);
        if(d>1.2&&c.t<7){
          const step=Math.min(d,SEC_CATCH_SPEED*dt);
          sec.x+=(killer.x-sec.x)/d*step; sec.y+=(killer.y-sec.y)/d*step;
          sec.ang=Math.atan2(killer.y-sec.y,killer.x-sec.x);
          sec.face=killer.x<sec.x?-1:1; sec.moving=true;
          /* 一帧就追到（大 dt 或目标很近）时直接进入压制，不等下一帧 */
          if(Math.hypot(killer.x-sec.x,killer.y-sec.y)>1.2)return true;
        }
        if(Math.hypot(killer.x-sec.x,killer.y-sec.y)>1.2){G.secCatch=null;return false;}
        c.phase='press';c.t=0;
        killer.detained=true;killer.detainedT=DETAIN_TIME+1.2;
        killer.path=null;killer.moving=false;killer.doing=0;killer._doing=null;killer.act=null;
        c.from=[killer.x,killer.y];
        G.fx.push({type:'detain',x1:sec.x,y1:sec.y,x2:killer.x,y2:killer.y,t:1.0,dur:1.0});
        aiHear('detain',killer.x,killer.y,26,{subj:killer.i});
        SND.robot();
        return true;
      }
      if(c.phase==='press'){
        if(c.t<0.9)return true;
        c.phase='escort';c.t=0;c.from=[killer.x,killer.y];
        return true;
      }
      const p=Math.min(1,c.t/1.2);
      killer.x=c.from[0]+(c.jail[0]-c.from[0])*p;
      killer.y=c.from[1]+(c.jail[1]-c.from[1])*p;
      sec.x=c.jail[0]+(c.jail[0]-c.from[0])*0.06;
      sec.y=c.jail[1]+(c.jail[1]-c.from[1])*0.06;
      sec.face=killer.x<sec.x?-1:1;
      if(p>=1){
        killer.x=c.jail[0];killer.y=c.jail[1];killer.detainedT=DETAIN_TIME;
        /* 押送到位这一下是可见的：在场人类看到「某人被保安按在角落」，
           只加嫌疑分，不写确证（拘留人类也会做，不是异形专属）。 */
        noticeAction(killer,killer.x,killer.y,14,'detain');
        aiHear('detain',killer.x,killer.y,18,{subj:killer.i});
        logEvent('detain',{actor:null,victim:killer.i,room:roomIdAt(killer.x,killer.y),
          x:+killer.x.toFixed(1),y:+killer.y.toFixed(1)});
        G.secCatch=null;
      }
      return true;
    }
    /* 医疗无人机（2026-10-31 从「巡逻机器人 + 隔空 5 秒施救」整体重做）：
       · 不再巡逻，悬停在医疗间正中央（坞位即医疗间中心，单航点）；
       · 医疗间里出现濒死者就自己飞过去，悬停到伤员身边（MEDBOT_TOUCH_R）才开始治疗；
       · 近身治疗满 MEDBOT_HEAL_TIME 秒才真正拉起，不再是隔空读条；
       · 救完自动飞回房间正中央等下一个，不再靠巡逻线覆盖判定。 */
    const MEDBOT_HEAL_TIME=3;      /* 近身治疗时长（秒）：判定、进度环、交互文案共用 */
    const MEDBOT_TOUCH_R=1.15;     /* 悬停到多近算「贴住伤员」 */
    const MEDBOT_FLY_SPEED=4.6;    /* 飞行速度（格/秒）：无人机不是地勤，比巡逻快 */
    /* 覆盖半径只服务对外文案与调试读数：医疗间半对角 ≈10.8 格，取 12 表示整间覆盖。
       真正的救援判定是 inMedRoom()（房间内即响应），不再用半径卡人。 */
    const MEDBOT_R=12;
    function medbotHome(){
      const b=G&&G.bots&&G.bots.medbot;
      if(b&&b.home)return b.home;
      const f=M.facility.find(q=>q.kind==='medbot');
      return f?[f.x,f.y]:[55,85.6];
    }
    function medbotFlyTo(b,tx,ty,dt,speed){
      const dx=tx-b.x, dy=ty-b.y, d=Math.hypot(dx,dy);
      if(d<1e-4){b.moving=false;return d;}
      b.ang=Math.atan2(dy,dx);
      if(Math.abs(dx)>0.05)b.face=dx<0?-1:1;
      const step=Math.min(d,speed*dt);
      b.x+=dx/d*step; b.y+=dy/d*step;
      b.moving=step>1e-4;
      return d;
    }
    /* 返回 true = 本帧由医疗逻辑接管（回坞 / 飞向伤员 / 治疗中），不跑巡逻 */
    function medbotTick(dt,med){
      if(!med)return false;
      if(G.medbotDead||(G.medbotLeft==null?MEDBOT_CHARGES:G.medbotLeft)<=0){
        G.medbotTarget=null;G.medbotT=0;med.healing=false;
        return false;
      }
      const home=medbotHome();
      /* 目标：医疗间内的濒死者。沿用上一帧的目标，避免两名伤员之间来回换人 */
      let v=null;
      if(G.medbotTarget!=null){
        const cur=G.agents[G.medbotTarget];
        if(cur&&cur.downed&&cur.alive&&inMedRoom(cur.x,cur.y))v=cur;
        else G.medbotTarget=null;
      }
      if(!v){
        let bd=1e9;
        for(const a of G.agents){
          if(!a.downed||!a.alive||!inMedRoom(a.x,a.y))continue;
          const d=Math.hypot(a.x-med.x,a.y-med.y);
          if(d<bd){bd=d;v=a;}
        }
        if(v)G.medbotTarget=v.i;
      }
      med.healing=false;
      if(!v){
        /* 没人可救：飞回医疗间正中央悬停 */
        G.medbotT=0;
        if(Math.hypot(home[0]-med.x,home[1]-med.y)>0.1)
          medbotFlyTo(med,home[0],home[1],dt,MEDBOT_FLY_SPEED*0.75);
        else med.moving=false;
        return true;
      }
      const d=Math.hypot(v.x-med.x,v.y-med.y);
      if(d>MEDBOT_TOUCH_R){
        /* 飞向伤员：途中不计时，贴着伤员才开始治疗 */
        medbotFlyTo(med,v.x,v.y,dt,MEDBOT_FLY_SPEED);
        G.medbotT=0;
        return true;
      }
      /* 近身悬停：治疗动画走满 MEDBOT_HEAL_TIME 秒才真正拉起 */
      med.moving=false;
      med.healing=true;
      med.ang=Math.atan2(v.y-med.y,v.x-med.x);
      G.medbotT=(G.medbotT||0)+dt;
      if(G.medbotT<MEDBOT_HEAL_TIME)return true;
      v.downed=false; v.downAt=0; v.killedBy=null;
      const dg=draggerOf(v);
      if(dg)releaseDragBy(dg,true);
      v.draggedBy=null;
      v.woundCause=null;v.downRoom=null;v.downX=null;v.downY=null;v.searched=false;
      G.medbotUsed=true;G.medbotLeft=Math.max(0,(G.medbotLeft==null?MEDBOT_CHARGES:G.medbotLeft)-1);
      /* 计时与目标必须一起清零：否则救完第一个后 ticks 直接 ≥MEDBOT_HEAL_TIME，
         同一波濒死会被瞬间连带救起（门禁断言 b1.medLeft===1 && b2===0） */
      G.medbotT=0; G.medbotTarget=null;
      G.fx.push({type:'healBeam',x1:med.x,y1:med.y,x2:v.x,y2:v.y,t:1.1,dur:1.1});
      G.fx.push({type:'heal',x:v.x,y:v.y,t:1.2,dur:1.2});
      setAct(v,'heal',0.7,{ang:0});
      /* 救治不对外报告（2026-10-31 用户裁定）：不给 toast、不写 envNotice ——
         以前 envNotice('revive') 会让全场活人 AI 拿到一条「医疗间有人被救活」的环境证据，
         等于把医疗无人机当成免费情报源。现在只留机器人运作声（环境音，不含受害者），
         事件流照旧记一条（复盘是只读旁路，不是对局情报）。 */
      hear(med.x,med.y,'robot',1.1);
      aiHear('robot',med.x,med.y,18);
      SND.robot();
      logEvent('revive',{actor:null,victim:v.i,method:'medbot',room:'med',
        x:+v.x.toFixed(1),y:+v.y.toFixed(1)});
      if(G.stats)G.stats.medbotRevives=(G.stats.medbotRevives||0)+1;
      if(G.simMode&&G.simStats)G.simStats.medbotRevives++;
      runInvariants('medbot');
      return true;
    }
    function botTick(dt){
      if(G.meet||G.over)return;
      if(!G.bots)resetBots();
      const med=botPos('medbot');
      const sec=botPos('secbot');
      if(!medbotTick(dt,med))moveBot(G.bots.medbot,dt,G.medbotDead);
      if(!G.secCatch)moveBot(G.bots.secbot,dt,G.secbotDead);
      if(G.secbotT>0)G.secbotT=Math.max(0,G.secbotT-dt);
      // 保安机器人：180° 前方扇形内行凶 ⇒ 近身压制后押送到军械库角落（30 秒）
      if(G.secCatch){
        secCatchTick(dt,sec);
      }else if(sec&&!G.secbotDead&&(G.secbotUses||0)<SEC_USES_MAX&&G.secbotT<=0&&G.pendingCrime!=null){
        const c=G.pendingCrime; G.pendingCrime=null;
        const killer=G.agents[c];
        if(killer&&Math.hypot(killer.x-sec.x,killer.y-sec.y)<SEC_RANGE&&losWalls(sec.x,sec.y,killer.x,killer.y)&&secArcOk(sec,killer.x,killer.y)){
          if(killer===G.me&&G.dev){ toast('DEV：保安机器人没有看见你'); }
          else secCatchStart(killer,sec);
        }
      }
    }

    function checkWin(){
      if(G.over)return true;
      const humans=G.agents.filter(a=>!a.alien&&a.alive).length;
      const aliens=G.agents.filter(a=>a.alien&&a.alive).length;
      if(G.prog>=WIN_PTS){ endGame(true,'维修 '+WIN_PTS+' 分达成'); return true; }
      if(aliens===0){ endGame(true,'异形全部出局'); return true; }
      if(humans===0){ endGame(false,'人类全灭'); return true; }
      return false;
    }
    function endGame(win,why){
      if(G.over)return;
      G.over=true; G.overWhy=why; G.overWin=!!win;
      logEvent('game_end',{win:!!win,why:why,prog:G.prog,nights:G.night});
      stopChatter();
      releaseAllDrags(true);
      closeBodyCard();
      closeCams(true);closePipePick(true);
      closeWheel(true);
      if(G.meet){ clearInterval(meetingTick); G.meet=null; document.getElementById('meet').classList.add('hide'); }
      document.getElementById('end').classList.remove('hide');
      document.getElementById('e-t').textContent=win?'人类胜利':'异形胜利';
      /* 结算摘要带上本局新增的三项统计（2026-10-31）：医疗无人机救治 / 幽灵任务 / 幽灵修故障 */
      const st=G.stats||{};
      document.getElementById('e-s').textContent=why+' · 维修 '+G.prog+'/'+WIN_PTS+' · 第 '+G.night+' 夜'
        +' · 无人机救治 '+(st.medbotRevives||0)+' 次 · 幽灵任务 '+(st.ghostTasks||0)+' 个'
        +' · 幽灵修故障 '+(st.ghostFixes||0)+' 次';
      if(win)SND.win(); else SND.lose();
      runInvariants('end');
    }
    
    /* ---------------- 报告 / 会议 / 投票 ---------------- */
    let meetingTick=null;
    /* 同一具尸体在同一夜只能拉一次铃：第一次报告之后，那具尸体对本夜所有人失效；
       天亮进入下一夜（G.night++）后重新开放。reported 保留为布尔位供 UI 沿用，
       真正的判据是 reportNight —— 之前跨夜也锁死，等于一局只能报一次。 */
    function bodyReported(v){ return !!v.reported && v.reportNight===G.night; }
    function markBodyReported(v){ v.reported=true; v.reportNight=G.night; }
    function tryReport(){
      if(!G.me.alive||G.me.downed||G.meet||G.over)return;
      let best=null,bd=2.4;
      for(const a of G.agents){
        const bp=bodyPos(a); if(!bp)continue;
        if(bodyReported(a))continue;
        const d=Math.hypot(bp[0]-G.me.x,bp[1]-G.me.y);
        if(d<bd){bd=d;best=a;}
      }
      if(!best){toast('本夜可见的尸体都已报告过，再靠近一点才能报告（2.4 格内）');return;}
      markBodyReported(best);
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
      const raw=String(text).slice(0,140);
      /* 会议发言也进事件流（复盘要看“为什么投他”）；模拟局不记，避免 1000 局刷爆内存 */
      if(!SIM_RUN&&G){
        const seat=G.agents.findIndex(a=>a.name===who);
        logEvent('chat',{actor:seat>=0?seat:null,who:who,sys:kind==='sys',text:raw});
      }
      if(SIM_RUN){
        if(G.meet){G.meet.lines=G.meet.lines||[];G.meet.lines.push({who,text:raw,sys:kind==='sys'});}
        return;
      }
      const box=document.getElementById('m-say'); if(!box)return;
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
        playerAccuse:null,playerVote:null,playerClaimRoom:null,quick:null,frames:[],
        playerClaims:[],playerSupport:null};
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
      /* 反向洗清：如果目击者在案发时间附近在另一个舱室看见某人，
         这个人的普通嫌疑降低；自己的确证不受影响。 */
      if(kind==='night'&&victim&&vi){
        const deathEv=NIGHT-Math.max(0,victim.alive?(victim.downAt||0):(victim.deathAt||0));
        const bodyRoom=vi.roomId;
        for(const w of G.agents){
          if(w.alien||!w.alive||w.downed||!w.mind)continue;
          for(const a of G.agents){
            if(a===w||!a.alive||a.downed)continue;
            for(const e of w.mind.mem.slice(-24)){
              if(e.kind!=='saw_agent'||e.subj!==a.i||!e.room||e.night!==G.night)continue;
              if(Math.abs(e.t-deathEv)>8||e.room===bodyRoom)continue;
              susCut(w,a.i,0.25,'alibi_clear',e);
              break;
            }
          }
        }
      }
      for(const a of G.agents){
        a.accuse=null;a.accuseWhy=null;a._abstain=false;
        if(a.alien&&a.alive&&!a.downed&&(a!==G.me||G.spectMode)){
          // 异形 AI：整场会议只用一个假口供，避免前后矛盾；玩家异形不参与自动指控
          const rooms=M.rooms.filter(r=>!used.has(r.id)&&r.id!=='bridge');
          const r=rooms.length?rooms[Math.floor(Math.random()*rooms.length)]:M.rooms[0];
          used.add(r.id);
          const pts=M.points.filter(p=>roomIdAt(p.x,p.y)===r.id);
          a._lie={room:r.name,task:pts.length?pts[Math.floor(Math.random()*pts.length)].label:'配电盘'};
          /* 只用自己目击推断出的队友（a.mates）做保护，不读取系统队友表；
             未识别的目标仍然可能被指控/投票，保持“同类也会被攻击”的规则。 */
          const allPool=G.agents.filter(x=>x!==a&&x.alive&&!x.downed&&!isMate(a,x.i));
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
      /* 零证据指控会损耗发言者可信度：人类听众给空口指控者记一笔小嫌疑 */
      for(const w of G.agents){
        if(w.alien||!w.alive||w.downed||!w.mind)continue;
        for(const a of G.agents){
          if(a===w||!a.alive||a.downed||a.accuse==null)continue;
          const noEvidence=!a.accuseWhy&&a.suspect==null&&!bestKnownTarget(a)&&!topSus(a,0.5);
          if(noEvidence){
            const ev={kind:'empty_accuse',x:0,y:0,room:null,conf:0.25,src:'speech',subj:a.accuse};
            susAdd(w,a.i,0.05,'empty_accuse',ev);
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
        case 'saw_drag_away':return '我看见他拖着尸体往远离医疗间的方向走';
        case 'saw_red':return '我看见他身上带着刚出刀的红光';
        case 'quick_report':return '尸体还热着就有人来报，他当时就在附近';
        case 'saw_detain':return '保安机器人当场抓住了他';
        case 'near_body':return '尸体旁边的人里就有他';
        case 'heard_scream':return '尖叫声响起时他在附近';
        case 'heard_pipe':return '管道响的时候他就在那一带';
        case 'heard_frame':return '有人声称看见他钻管道或带着红光';
        case 'heard_claim':{
          const ck=w.claimKind;
          return '玩家声称看见他'+(ck==='saw_pipe'?'钻管道':(ck==='saw_red'?'身上带着红光':
            (ck==='saw_knife'?'出刀':(ck==='saw_sabotage'?'破坏设备':
            (ck==='saw_bot'?'停摆机器人':'拉闸')))));
        }
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
    /* 异形会议欺骗：被确证时先反驳，再可能反咬一个"钻管道 / 带红光"的假目击；
       没有被确证时偶尔主动搅浑水。假话只进 ctx.frames 与传闻嫌疑
       （heard_frame），永远不写 mind.known，也不改变真目击者的投票锁定。
       听众若用自己的 saw_agent 记忆抓到说谎者的假口供，会反过来怀疑说谎者。 */
    function planAlienDeception(m,cands,sureAcc){
      const out={frames:[],lines:[]};
      if(!m||m.kind==='pre')return out;
      const vi=m.ctx?m.ctx.victimInfo:null;
      const pool=G.agents.filter(x=>x.alive&&!x.downed&&(x!==G.me||G.spectMode));
      const aliens=pool.filter(x=>x.alien);
      if(!aliens.length)return out;
      const sureKn=sureAcc?bestKnownTarget(sureAcc):null;
      const sureTgt=sureKn?G.agents[sureKn.i]:null;
      let liar=null,counter=false;
      if(sureTgt&&sureTgt.alien&&(sureTgt!==G.me||G.spectMode)){
        liar=sureTgt;counter=true;
      }else if(Math.random()<0.4){
        liar=aliens[Math.floor(Math.random()*aliens.length)];
      }
      if(!liar)return out;
      /* 绝不构陷已经认出的队友；只把水泼到非队友身上 */
      const targets=pool.filter(x=>x!==liar&&(!vi||x!==vi.a)&&!isMate(liar,x.i));
      if(!targets.length)return out;
      let tgt=null;
      if(counter&&sureAcc&&sureAcc.alive&&!sureAcc.downed&&sureAcc!==liar&&Math.random()<0.65)
        tgt=sureAcc;
      if(!tgt)tgt=targets[Math.floor(Math.random()*targets.length)];
      if(!tgt)return out;
      const sureKind=sureKn?sureKn.known.kind:null;
      /* 主动先发制人时优先说"红光"，更像现场目击 */
      const kind=counter?(sureKind==='saw_pipe'?(Math.random()<0.7?'saw_pipe':'saw_red'):
        (sureKind==='saw_red'?(Math.random()<0.7?'saw_red':'saw_pipe'):
          (Math.random()<0.5?'saw_pipe':'saw_red'))):'saw_red';
      /* 已经认出队友时，队友帮腔共同诬陷 */
      const ally=pool.find(x=>x.alien&&x!==liar&&x!==tgt&&isMate(x,liar.i));
      if(ally&&((ally.accuse==null)||isMate(ally,ally.accuse)))ally.accuse=tgt.i;
      const own=alibiOf(liar), tf=alibiOf(tgt);
      /* 管道只存在 4 个舱室：构陷目标自述的房间如果没有管道口，
         就换一间真有管道的舱室，不能凭空在医疗间/走廊“钻管道”。 */
      let room=tf.room||null;
      if(kind==='saw_pipe'){
        const names=pipeRoomIds().map(roomNameById);
        if(names.indexOf(room)<0)room=names.length?names[Math.floor(Math.random()*names.length)]:null;
      }
      if(!room)room='走廊';
      const claim=kind==='saw_pipe'
        ?'我亲眼看见'+tgt.name+'在'+room+'钻进了管道'
        :'我亲眼看见'+tgt.name+'身上带着刚出刀的红光';
      const denial=sureKind==='saw_pipe'?'我没钻过管道':
        (sureKind==='saw_red'?'我没出过刀':
        (sureKind==='saw_knife'?'我没杀过人':
        (sureKind==='saw_sabotage'?'我没破坏过设备':
        (sureKind==='saw_bot'?'我没碰过机器人':'我没动过手'))));
      const rebut=(counter?denial+'。':'')+'我今晚在'+own.room+'，'+claim+'。';
      const frame={by:liar.i,target:tgt.i,kind:kind,room:room,ownRoom:own.room,
        sureKind:sureKind,text:rebut,reaffirm:null,response:null,caught:null,
        ally:ally?ally.i:null,allyText:null};
      if(ally&&!(ally.mind&&ally.mind.known&&ally.mind.known[liar.i])){
        /* 同上：确证过说谎者的人不会反过来替他背书 */
        frame.allyText='我今晚在'+alibiOf(ally).room+'，我也看见了：'+tgt.name+
          (kind==='saw_pipe'?'钻进了管道':'身上带着刚出刀的红光')+'。'+liar.name+'没撒谎。';
        /* 为已被自己确证的异形辩护，会引来“你是不是同伙”的怀疑 */
        for(const w of G.agents){
          if(w.alien||!w.alive||w.downed||!w.mind)continue;
          if(w.mind.known&&w.mind.known[tgt.i])susAdd(w,ally.i,0.1,'defended_suspect');
        }
      }
      /* 反咬目标如果不是证人，让它自己回应（不读阵营，谁被点名谁说话） */
      if(tgt!==sureAcc&&(tgt!==G.me||G.spectMode)){
        const tRoom=alibiOf(tgt).room;
        frame.response=kind==='saw_pipe'
          ?'我没钻过管道。那会儿我在'+tRoom+'，谁能给我作证？'
          :'我身上没有红光。那会儿我在'+tRoom+'，别只凭一句话。';
      }
      /* 真目击者不吃这一套：重申自己看见的是谁 */
      if(counter&&sureAcc&&(sureAcc!==G.me||G.spectMode)&&sureAcc.alive&&!sureAcc.downed){
        const knownRoom=sureKn&&sureKn.known&&sureKn.known.room;
        const wRoom=kind==='saw_pipe'&&knownRoom?roomNameById(knownRoom):alibiOf(sureAcc).room;
        const act=kind==='saw_pipe'?'钻管道':'带着红光';
        frame.reaffirm='我没看错，'+liar.name+'。我今晚在'+wRoom+'，亲眼看见'+act+'的就是你'+
          (tgt===sureAcc?'。':'，不是'+tgt.name+'。');
      }
      /* 听众用自己的时间线记忆拆谎：说谎者假口供里的舱室与目击记录对不上 */
      for(const w of G.agents){
        if(w===liar||w===tgt||w===sureAcc||!w.alive||w.downed||w.alien||!w.mind)continue;
        const mem=w.mind.mem||[];
        for(let i=mem.length-1;i>=0;i--){
          const e=mem[i];
          if(e.kind!=='saw_agent'||e.subj!==liar.i||!e.room||e.night!==G.night)continue;
          if(evNow()-e.t>45)continue;
          const seen=roomNameById(e.room);
          if(seen===own.room)continue;
          frame.caught={i:w.i,text:'我今晚在'+alibiOf(w).room+'，可我在'+seen+'看见'+liar.name+'了。你的口供对不上。',e:e};
          break;
        }
        if(frame.caught)break;
      }
      /* 传闻嫌疑：没有确证的听众只加很少的 heard_frame；
         抓到假口供的听众反过来怀疑说谎者。真目击者（有 known）不受影响。 */
      for(const w of G.agents){
        if(w===liar||w===tgt||w===sureAcc||!w.alive||w.downed||!w.mind)continue;
        if(bestKnownTarget(w))continue;
        if(frame.caught&&frame.caught.i===w.i){
          susAdd(w,liar.i,0.24,'contradiction_lie',frame.caught.e);
        }else{
          const ev={kind:'heard_frame',x:0,y:0,room:null,conf:0.32,src:'speech',subj:tgt.i};
          evPush(w,ev);
          susAdd(w,tgt.i,0.14,'heard_frame',ev);
          if(ally){
            const ev2={kind:'heard_frame',x:0,y:0,room:null,conf:0.3,src:'speech',subj:tgt.i,ally:1};
            evPush(w,ev2);
            susAdd(w,tgt.i,0.08,'heard_frame_ally',ev2);
          }
        }
      }
      /* 让说谎者的投票与假口供保持一致；其他 AI 的目标不动 */
      liar.accuse=tgt.i;
      liar.accuseWhy={kind:kind,room:null,reason:'反咬'};
      out.frames.push(frame);
      out.lines.push(()=>say(liar.name,rebut));
      if(frame.allyText)out.lines.push(()=>say(ally.name,frame.allyText));
      if(frame.response)out.lines.push(()=>say(tgt.name,frame.response));
      if(frame.caught)out.lines.push(()=>say(G.agents[frame.caught.i].name,frame.caught.text));
      if(frame.reaffirm)out.lines.push(()=>say(sureAcc.name,frame.reaffirm));
      return out;
    }
    function pickResponder(m,cands){
      const spoken=(m.lines||[]).map(l=>l.who);
      const fresh=cands.filter(a=>spoken.indexOf(a.name)<0);
      const pool=fresh.length?fresh:cands;
      return pool[Math.floor(Math.random()*pool.length)];
    }
    /* 人类互相辩护（2026-10-31）：人类也会替人说话，不只是异形护队友。
       约束保留：手上有对该人的确证时绝不辩护（当场自相矛盾）；
       只替「人类 + 正被普通指控」的人开口，概率 55%。
       决策放在同步段调用，蒙特卡洛也能统计到次数。 */
    function decideHumanDefend(cands){
      const accusers=cands.filter(a=>a.accuse!=null&&G.agents[a.accuse]&&
        G.agents[a.accuse].alive&&a.accuse!==a.i);
      for(const a0 of accusers){
        const tgt=G.agents[a0.accuse];
        if(!tgt||tgt.alien||!tgt.alive||tgt.downed)continue;
        const pool=cands.filter(x=>!x.alien&&x!==a0&&x!==tgt&&x.alive&&!x.downed&&
          !(x.mind&&x.mind.known&&x.mind.known[tgt.i]));
        if(!pool.length)continue;
        if(Math.random()>0.55)continue;
        const by=pool[Math.floor(Math.random()*pool.length)];
        if(G.stats)G.stats.humanDefends=(G.stats.humanDefends||0)+1;
        if(G.simMode&&G.simStats)G.simStats.humanDefends++;
        return {by:by,target:tgt,accuser:a0};
      }
      return null;
    }
    /* 异形也会质疑「尸体还热就喊人」的报案者（2026-10-31）。
       只搅浑水，不写 known、不加确证；40% 概率出手，优先自己没被确证的异形。 */
    function decideAlienDoubt(m,cands){
      const q=m&&m.ctx&&m.ctx.quick;
      if(!q||q.age>10||q.reporter==null)return null;
      const rp=G.agents[q.reporter];
      if(!rp||!rp.alive||rp.downed)return null;
      const pool=cands.filter(x=>x.alien&&x!==rp);
      if(!pool.length)return null;
      if(Math.random()>0.4)return null;
      const by=pool[Math.floor(Math.random()*pool.length)];
      if(G.simMode&&G.simStats)G.simStats.reportDoubts++;
      return {by:by,reporter:rp};
    }
    function startChatter(m){
      stopChatter();
      /* 旁观模式下 0 号星尘是独立 AI，不是"玩家席位"，必须进入发言与投票池 */
      const ai=G.agents.filter(a=>a.alive&&!a.downed&&(a!==G.me||G.spectMode));
      if(!ai.length)return;
      const cands=ai.slice().sort(()=>Math.random()-0.5);
      m.ctx.aiCands=cands.map(a=>a.i);
      const D=Math.max(12,m.discuss||25);
      const endAt=Math.max(5200,D*1000-2200);   /* 收尾留 2.2 秒 */
      const agenda=[];
      const push=fn=>agenda.push(fn);
      /* 会议欺骗要先算：说谎者的投票目标要在大厅指控那一轮之前定下来 */
      const sureAcc=cands.find(a=>!a.alien&&bestKnownTarget(a));
      const deception=planAlienDeception(m,cands,sureAcc);
      if(deception.frames.length)m.ctx.frames=deception.frames;
      /* 人类辩护 / 异形质疑报案者：都在同步段定下来（批量模拟也要统计到） */
      const humanDefend=decideHumanDefend(cands);
      const alienDoubt=decideAlienDoubt(m,cands);
      /* 批量模拟：不排真实台词定时器；会议决策/传闻嫌疑已在上面同步完成 */
      if(G.simMode)return;

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
        if(m.reporter&&(m.reporter!==G.me||G.spectMode)&&m.reporter.alive&&!m.reporter.downed){
          push(()=>say(m.reporter.name,openingLine(m.reporter,m)));
        }else if(vi){
          /* 报告者是玩家本人时不替玩家编台词：那会在聊天栏里冒出一个"AI 星尘"，
             说的还是玩家没打过的字。改成系统播报，事实同样来自 victimInfo。
             顺带修掉另一件事——原来这里写死一句"人已经没了/还有呼吸"，
             导致 openingLine 里"先别急着乱投，先救人"那一档永远没有机会说出口。 */
          if(G.spectMode)push(()=>sysSay('在'+vi.room+'发现'+vi.name+'，'+vi.cause+'。'));
          else push(()=>sysSay(G.me.name+' 在'+vi.room+'发现了'+vi.name+'，'+vi.cause+
            (vi.dead?'，人已经没了。':'，还有呼吸——先救人，但动手的人就在我们中间。')));
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
        /* 异形也会跟着起哄：同样咬「来太快」的报案者，把水搅浑（只进传闻嫌疑，不写确证） */
        if(alienDoubt)push(()=>say(alienDoubt.by.name,pickLine(alienDoubt.by,[
          alienDoubt.reporter.name+'，你到得太巧了吧？尸体刚热你就喊人。',
          '我不针对谁，但'+alienDoubt.reporter.name+'是第一个喊的，先说说你当时在哪。',
          '报得这么快，要么运气好，要么你就在现场——'+alienDoubt.reporter.name+'，解释一下。'
        ],46)));
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
        const sure=sureAcc;
        if(sure)push(()=>{const l=accuseLine(sure,m);if(l)say(sure.name,l);});
        /* 异形的反驳 / 反咬紧跟在确证之后；真目击者会再顶回去 */
        for(const fn of deception.lines)push(fn);
        /* 已认出队友被普通指控时，队友公开辩护（确证反咬链已处理的不重复）。
           但"锁定过他就不会再保他"：谁手里有对他的确证（mind.known），
           就绝不能再开口说他不是异形——那是当场自相矛盾。 */
        const defended=new Set();
        for(const def of cands.filter(x=>x.alien)){
          for(const k in (def.mates||{})){
            const mate=G.agents[+k];
            if(!mate||!mate.alive||mate.downed)continue;
            if(deception.frames.some(f=>f.by===mate.i))continue;
            if(def.mind&&def.mind.known&&def.mind.known[mate.i])continue;
            const accuser=cands.find(x=>x!==mate&&x.accuse===mate.i);
            if(accuser&&!defended.has(mate.i)){
              defended.add(mate.i);
              for(const w of G.agents){
                if(w.alien||!w.alive||w.downed||!w.mind)continue;
                if(w.mind.known&&w.mind.known[mate.i])susAdd(w,def.i,0.1,'defended_suspect');
              }
              push(()=>say(def.name,'我今晚在'+alibiOf(def).room+'，'+mate.name+
                '不是异形，别投他。'));
              break;
            }
          }
        }
        /* 人类也会替人说话（2026-10-31）：只替人类、且自己手上没有对他确证的人辩护，
           不再让「辩护」变成异形专属行为 */
        if(humanDefend)push(()=>say(humanDefend.by.name,pickLine(humanDefend.by,[
          '等等，'+humanDefend.target.name+'那会儿跟我在一起，投他不合理。',
          '我这边时间和'+humanDefend.target.name+'对得上，先别急着投。',
          humanDefend.target.name+'我保一下，他刚才一直在我视线里。'
        ],18)));
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
              '我信息不够，先弃权。'+(G.me.alive&&!G.me.downed&&!G.spectMode?('你呢，'+G.me.name+'？'):''),
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
      ['中央会议室','bridge'],['会议室','bridge'],['大厅','bridge'],
      ['仓库','warehouse'],['库房','warehouse'],['食堂','transit'],['餐厅','transit'],
      ['监控室','cam'],['监控','cam'],['中控室','cam'],['中控','cam'],
      ['生态舱','ecosys'],['生态区','ecosys'],['生态','ecosys'],
      ['配电室','power'],['配电站','power'],['配电间','power'],['配电','power'],
      ['中转间','transit'],['中转舱','transit'],['中转','transit'],
      ['娱乐室','fun'],['娱乐间','fun'],['休闲室','fun'],['娱乐','fun'],
      ['引擎室','engine'],['引擎','engine'],
      ['医疗间','med'],['医疗舱','med'],['医务室','med'],['病房','med'],['医疗','med'],
      ['军械库','armory'],['军械室','armory'],['武器库','armory'],['军械','armory'],
      ['走廊','corridor'],['通道','corridor']
    ];
    const CN_SEAT={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,
      十一:11,十二:12,十三:13,十四:14,十五:15};
    function seatIndex(n){
      const i=(n|0)-1;
      return i>=1&&i<G.agents.length?i:null;
    }
    function parseSpeech(text){
      const s=String(text||'');
      const out={raw:s.slice(0,80),rooms:[],people:[],accuse:null,vote:null,
        deny:false,where:null,claim:null,support:null};
      for(const [w,id] of ROOM_WORDS){
        if(s.indexOf(w)>=0&&out.rooms.indexOf(id)<0)out.rooms.push(id);
      }
      /* 人物按在文本里第一次出现的位置排序，避免「南极被北极杀了」把凶手认成南极 */
      const at={};
      const put=(i,pos)=>{
        if(i==null||i===0||at[i]!=null)return;
        at[i]=pos;
      };
      for(const a of G.agents){
        if(a.i===0||!a.name)continue;
        let p1=s.indexOf(a.name),p2=s.indexOf(seatNo(a));
        if(p1<0)p1=1e9; if(p2<0)p2=1e9;
        const p=Math.min(p1,p2);
        if(p<1e9)put(a.i,p);
      }
      let m;
      const reNum=/(?:第\s*)?0?([1-9]|1[0-5])\s*(?:号|席)/g;
      while((m=reNum.exec(s))){const i=seatIndex(+m[1]); if(i!=null)put(i,m.index);}
      const reCn=/([一二三四五六七八九十]{1,3})\s*(?:号|席)/g;
      while((m=reCn.exec(s))){const i=seatIndex(CN_SEAT[m[1]]||0); if(i!=null)put(i,m.index);}
      out.people=Object.keys(at).map(Number).sort((a,b)=>at[a]-at[b]);
      const has=out.people.length>0;
      const support=has&&/(作证|担保|保他|保她|相信他|相信她|信他|是好人|不是他|不是异形|不是凶手|不是狼|不是内鬼|别投|不要投|投错|无辜|没问题)/.test(s);
      const negVote=/不投|别投|不要投|投错|不能投/.test(s);
      const negAcc=/(不怀疑|没怀疑|不是他|不是异形|不是凶手|不是狼|不是内鬼|没问题|好人|无辜|冤枉)/.test(s);
      const negSee=/(没看见|没看到|没发现|没亲眼|看错|误会|不确定)/.test(s);
      if(support)out.support=out.people[0];
      let claimKind=null;
      if(!support){
        for(const [k,re] of [
          ['saw_pipe',/(钻管道|钻进管道|钻了管道|从管道里|管道里出来)/],
          ['saw_red',/(红光|发红|红身|身上带着红|带着红光)/],
          ['saw_knife',/(出刀|捅了|捅人|刀了|杀人|杀了|动手|行凶)/],
          ['saw_sabotage',/(破坏设备|破坏舱|拆设备|弄坏设备|损毁设备)/],
          ['saw_bot',/(停摆机器人|关掉机器人|弄停机器人|机器人停摆|拆机器人)/],
          ['saw_breaker',/(拉闸|断电|关灯|电闸)/]
        ]){
          if(re.test(s)){claimKind=k;break;}
        }
      }
      const saw=/(亲眼|看见|看到|发现|确定|确认|我保证|我发誓|确实看到|确实看见)/.test(s);
      if(claimKind&&saw&&!negSee&&has&&!support){
        out.claim={target:out.people[0],kind:claimKind,room:out.rooms[0]||null};
      }
      if(!support&&!out.claim){
        if(has&&/怀疑|凶手|内鬼|狼|可疑|有问题|就是他|是他|他杀|杀了|动了手|出刀|钻管道|红光/.test(s)&&!negAcc)
          out.accuse=out.people[0];
        if(has&&/我(投|跟|票给)|投给/.test(s)&&!negVote)
          out.vote=out.people[0];
      }
      if(/不是我|我没|我没去|我没动|不在场|冤枉|我是好人|别投我|我清白|我无辜/.test(s))out.deny=true;
      /* 只认第一人称的自述位置，避免「我看见X在配电室」被当成玩家在配电室 */
      if(out.rooms.length&&/(我今晚在|我当时在|我整晚都在|我整晚在|我一整晚都在|我今晚都在|我一直在|我就在|我待在|我去过|我刚才在|我之前在|我现在在|我在)/.test(s))
        out.where=out.rooms[0];
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

      /* 2) 玩家提供的直接证据：先当"传闻"记下，绝不写成 known。
         有确证的人公开支持；没有确证的人只加少量 heard_claim 嫌疑；
         如果听众的时间线与玩家声称的现场冲突，反过来怀疑玩家（contradiction_claim）。 */
      if(sl.claim){
        const t=G.agents[sl.claim.target];
        if(!t||!t.alive||t.downed)return;
        /* “在医疗间/走廊钻管道”是物理上不可能的口供：那里没有管道口。
           不把它算成目标的证据，反过来怀疑编造者（玩家也适用）。 */
        if(sl.claim.kind==='saw_pipe'&&sl.claim.room&&!isPipeRoom(sl.claim.room)){
          const rn=roomNameById(sl.claim.room);
          const ev={kind:'impossible_claim',x:G.me.x,y:G.me.y,room:sl.claim.room,
            t:evNow(),conf:0.3,src:'speech'};
          for(const w of cands){
            if(w.alien||!w.mind)continue;
            susAdd(w,0,0.22,'impossible_claim',ev);
          }
          const speaker=cands.find(w=>!w.alien&&w.mind);
          if(speaker)meetLater(m,650+Math.random()*400,()=>say(speaker.name,
            pickLine(speaker,[
              rn+'没有管道口，怎么可能在那儿看见人钻管道？',
              rn+'根本没有管道，你这个说法不成立。',
              '等等，'+rn+'没有管道口。你再想想是在哪儿看见的？'
            ],32)));
          return;
        }
        m.ctx.playerClaims.push({t:evNow(),target:t.i,kind:sl.claim.kind,
          room:sl.claim.room||null});
        m.ctx.playerAccuse=t.i;
        const kindName={saw_pipe:'钻管道',saw_red:'身上带着红光',saw_knife:'出刀',
          saw_sabotage:'破坏设备',saw_bot:'停摆机器人',saw_breaker:'拉闸'}[sl.claim.kind]||'动手';
        const knownW=cands.find(w=>w!==t&&!w.alien&&w.mind&&w.mind.known&&w.mind.known[t.i]);
        let caught=null;
        if(!knownW&&sl.claim.room){
          for(const w of cands){
            if(w.alien||!w.mind||bestKnownTarget(w))continue;
            for(const e of w.mind.mem.slice(-24)){
              if(e.kind!=='saw_agent'||e.subj!==t.i||e.room==null||e.night!==G.night)continue;
              if(evNow()-e.t>45||e.room===sl.claim.room)continue;
              caught={w:w,e:e,seen:e.room}; break;
            }
            if(caught)break;
          }
        }
        if(caught){
          susAdd(caught.w,0,0.22,'contradiction_claim',caught.e);
          meetLater(m,600+Math.random()*400,()=>say(caught.w.name,
            G.me.name+'，你说'+t.name+'在'+roomNameById(sl.claim.room)+'？我明明在'+
            roomNameById(caught.seen)+'看见他了。你的话对不上。'));
          return;
        }
        const weight={saw_pipe:0.26,saw_red:0.24,saw_knife:0.30,
          saw_sabotage:0.22,saw_bot:0.20,saw_breaker:0.12}[sl.claim.kind]||0.2;
        for(const w of cands){
          if(w===t||!w.mind||bestKnownTarget(w))continue;
          const ev={kind:'heard_claim',claimKind:sl.claim.kind,x:0,y:0,
            room:sl.claim.room||null,conf:0.5,src:'speech',subj:t.i,by:0};
          evPush(w,ev);
          susAdd(w,t.i,weight,'heard_claim',ev);
        }
        const follower=cands.find(w=>w!==t&&!w.alien&&w.mind&&w.accuse==null&&
          w.mind.alert>=0.25);
        if(follower){
          follower.accuse=t.i;
          meetLater(m,900+Math.random()*400,()=>say(follower.name,
            '我跟'+G.me.name+'一票，'+t.name+'得给个说法。'));
        }
        if(knownW){
          const k=knownW.mind.known[t.i], rm=k.room?roomNameById(k.room):'现场';
          const act=k.kind==='saw_pipe'?'钻管道':(k.kind==='saw_knife'?'出刀':
            (k.kind==='saw_red'?'身上带着红光':'破坏了设备'));
          meetLater(m,600+Math.random()*400,()=>say(knownW.name,
            '我同意'+G.me.name+'。'+t.name+'在'+rm+act+'，我亲眼看见的——他就是异形。'));
        }
        meetLater(m,650+Math.random()*500,()=>say(t.name,pickLine(t,[
          G.me.name+'，你说看见我'+kindName+'？我今晚在'+alibiOf(t).room+'，谁能作证？',
          '我没'+kindName+'。'+G.me.name+'，你看错了吧？',
          G.me.name+'，你看见我在哪？说清楚，别凭一句话。'
        ],48)));
        return;
      }

      /* 3) 玩家公开为某人作证：被保的人回应，怀疑他的人追问证据（不加减嫌疑分） */
      if(sl.support!=null){
        const t=G.agents[sl.support];
        if(!t||!t.alive||t.downed)return;
        m.ctx.playerSupport=t.i;
        const skeptic=cands.find(w=>w!==t&&!w.alien&&w.mind&&
          ((w.mind.sus[t.i])||0)>=0.3);
        if(skeptic){
          meetLater(m,600+Math.random()*400,()=>say(skeptic.name,
            G.me.name+'，你拿什么给'+t.name+'作证？'+(vi?(' '+vi.name+'倒下那会儿你在哪？'):'')));
        }else{
          meetLater(m,600+Math.random()*400,()=>say(t.name,pickLine(t,[
            '谢了，'+G.me.name+'。我今晚在'+alibiOf(t).room+'，谁要核对可以找我。',
            '我记住这句了。'+G.me.name+'愿意给我作证。'
          ],49)));
        }
        return;
      }

      /* 4) 玩家点名指控：被点的人辩护；有同款确证的人直接站队 */
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
    /* 会议模板：生成一句一定会被 parseSpeech 识别的标准句 */
    function meetTemplateText(kind,t,roomId){
      const tag=t?tagName(t):'';
      const rn=roomId?roomNameById(roomId):'';
      if(kind==='where')return '我今晚在 '+(rn||'走廊');
      if(kind==='deny')return '不是我'+(rn?('，我今晚在 '+rn):'');
      if(!t)return '';
      if(kind==='accuse')return '我怀疑 '+tag;
      if(kind==='vote')return '我投 '+tag;
      if(kind==='support')return '我可以为 '+tag+' 作证';
      if(kind==='pipe'){
        const at=rn&&isPipeRoom(roomId)?('，就在'+rn):'';
        return '我亲眼看见 '+tag+' 钻管道'+at;
      }
      const at=rn?('，就在'+rn):'';
      if(kind==='red')return '我亲眼看见 '+tag+' 身上有红光'+at;
      if(kind==='knife')return '我亲眼看见 '+tag+' 出刀'+at;
      return '';
    }
    function syncMeetTemplates(){
      if(SIM_RUN)return;
      const box=document.getElementById('m-tpl'); if(!box)return;
      const m=G.meet;
      const can=!!(m&&m.phase==='discuss'&&G.me.alive&&!G.me.downed&&!G.spectMode);
      box.classList.toggle('hide',!can);
      if(!can)return;
      const sel=document.getElementById('m-tpl-target');
      if(sel){
        const old=sel.value;
        sel.innerHTML='';
        for(const a of G.agents){
          if(!a.alive||a===G.me)continue;
          const op=document.createElement('option');
          op.value=String(a.i);op.textContent=tagName(a);
          sel.appendChild(op);
        }
        if(old&&G.agents[+old]&&G.agents[+old].alive&&(+old)!==G.me.i)sel.value=old;
        else if(sel.options.length)sel.selectedIndex=0;
      }
      const roomSel=document.getElementById('m-tpl-room');
      if(roomSel){
        if(!roomSel.options.length){
          const none=document.createElement('option');
          none.value='';none.textContent='不指定舱室';roomSel.appendChild(none);
          for(const r of M.rooms){
            const op=document.createElement('option');
            op.value=r.id;op.textContent=r.name;roomSel.appendChild(op);
          }
          const cor=document.createElement('option');
          cor.value='corridor';cor.textContent='走廊';roomSel.appendChild(cor);
        }
        const cur=G.me.nRoom||roomIdAt(G.me.x,G.me.y);
        if(cur&&Array.from(roomSel.options).some(o=>o.value===cur))roomSel.value=cur;
      }
    }
    function sendPlayerSpeech(text){
      const m=G.meet;
      if(!m||m.phase!=='discuss'||G.spectMode)return false;
      if(!G.me.alive||G.me.downed){toast('你现在不能发言');return false;}
      const raw=String(text||'').trim(); if(!raw)return false;
      const el=document.getElementById('m-text'); if(el)el.value='';
      say(G.me.name,raw,true); SND.vote(); playerTalk(raw);
      return true;
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
      logEvent('meeting',{kind:kind,reporter:reporter?reporter.i:null,
        victim:victim?victim.i:null,room:r?r.id:null,
        x:victim?+vx.toFixed(1):null,y:victim?+vy.toFixed(1):null});
      if(kind==='night'&&victim)
        logEvent('report',{actor:reporter?reporter.i:null,victim:victim.i,room:r?r.id:null,
          x:+vx.toFixed(1),y:+vy.toFixed(1)});
      // 尸体在会议开始时就清场（与经典规则一致）；濒死者还活着，继续躺着
      for(const a of G.agents) if(!a.alive&&!a.bodyGone) a.bodyGone=true;
      const discuss=(kind==='day'||kind==='pre')?60:25;
      const voteT=kind==='pre'?0:(kind==='day'?10:5);
      const remainMs=kind==='night'?(G.simMode?Math.max(0,G.simT||0)*1000:
        (G.phase?SKClock.remaining(G.phase,performance.now()):NIGHT*1000)):NIGHT*1000;
      if(G.simMode&&G.simStats)G.simStats.meetings++;
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
      const canSkip=canAct||G.spectMode;   /* 旁观者可以快进讨论，但不能发言/投票 */
      const skipBtn=document.getElementById('m-skip');
      skipBtn.classList.toggle('hide',!canSkip);
      skipBtn.textContent=G.spectMode?'跳过讨论（旁观）':'跳过讨论';
      const inp=document.getElementById('m-text');
      inp.disabled=!canAct;
      inp.placeholder=canAct?'自由发言，回车发送':(G.spectMode?'旁观者只读':'幽灵只能旁观');
      document.getElementById('m-who').innerHTML='';
      document.getElementById('m-tally').innerHTML='';
      document.getElementById('m-say').innerHTML='';
      syncMeetTemplates();
      if(!canAct) say(G.spectMode?'旁观者':G.me.name,G.spectMode?'（旁观）只读观战，不参与讨论与投票。':'（幽灵）我在看着。','sys');
      startChatter(G.meet);
      if(!G.simMode)meetingTimer();
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
      const tpl=document.getElementById('m-tpl'); if(tpl)tpl.classList.add('hide');
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
        if(!a.alive||(!G.spectMode&&a===G.me)||a.downed)continue;
        /* 确证优先：见过异形专属行为的人不需要再猜，直接投确证目标 */
        if(!a.alien){
          const kn=bestKnownTarget(a);
          if(kn){ m.votes[a.i]=kn.i; continue; }
        }
        const acc=(a.accuse!=null&&G.agents[a.accuse]&&G.agents[a.accuse].alive&&a.accuse!==a.i&&
          (!a.alien||!isMate(a,a.accuse)))?a.accuse:null;
        if(acc!=null){ m.votes[a.i]=acc; continue; }
        if(a.suspect!=null&&G.agents[a.suspect]&&G.agents[a.suspect].alive&&
          G.agents[a.suspect]!==a&&(!a.alien||!isMate(a,a.suspect))){
          m.votes[a.i]=a.suspect; continue;
        }
        const bs=bestSusTarget(a,0.5);
        if(bs&&(!a.alien||!isMate(a,bs.i))){m.votes[a.i]=bs.i;continue;}
        if(a.alien){
          const all=G.agents.filter(x=>x.alive&&x!==a&&!isMate(a,x.i));
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
      for(const k in m.votes){
        const v=m.votes[k];
        logEvent('vote',{actor:+k,target:v,victim:v>=0?v:null});
      }
      let devSaved=false;
      if(cand){
        if(!G.spectMode&&cand===G.me&&G.dev) devSaved=true;
        else{ die(cand,'vote',null); SND.expel(); }
      }
      m.tally={tally,abstain,max,ok,ex:devSaved?null:cand,devSaved,
        exName:cand?tagName(cand):null,exRole:cand?(cand.alien?'异形':'人类'):null};
      if(cand&&!devSaved)
        logEvent('eject',{victim:cand.i,votes:max,alien:!!cand.alien});
      renderTally();
      if(cand)sysSay('驱逐 '+tagName(cand)+' · 身份公布：'+(cand.alien?'异形':'人类'));
      runInvariants('vote');
    }
    function renderTally(){
      if(SIM_RUN)return;
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
        nightLeft=Math.max(8000,m.remainMs-(G.simMode?(m.discuss+m.voteT)*1000:
          (performance.now()-(m.startAt||performance.now()))));
      }
      G.meet=null;
      document.getElementById('meet').classList.add('hide');
      checkWin(); if(G.over)return;
      if(kind==='day') startNight(true);
      else if(kind==='pre') startNight(false);
      else if(nightLeft!=null){
        if(G.simMode){G.simT=nightLeft/1000;G.t=G.simT;G.phase=null;}
        else G.phase=SKClock.newPhase('night',performance.now(),nightLeft);
      }
      runInvariants('meetingEnd');
    }
    function startNight(inc){
      if(inc!==false) G.night++;
      logEvent('night_start',{night:G.night});
      if(G)releaseAllDrags(true);
      G.t=NIGHT;
      if(G.simMode){G.simT=NIGHT;G.phase=null;}
      else G.phase=SKClock.newPhase('night',performance.now(),NIGHT*1000);
      for(const a of G.agents){
        a.knife=1;a.path=null;a.doing=0;a.target=null;if(a.alive)a.reported=false;
        a._doing=null;a.sabUsed=false;a.detained=false;a.detainedT=0;
        a._pipeCD=0;a._rv=null;a.sabRoom=null;a._fix=null;a._fixGo=null;a._taskPt=null;a._look=null;
        /* 每夜重置认知：没有跨夜记忆，也不让上一夜的 suspect 自动带进新夜 */
        mindReset(a);a.suspect=null;a.accuseWhy=null;a._abstain=false;
        a._reportT=0;a._reportBody=null;a._sawBody=null;a._scanT=0;a._reportMemo={};
        /* 拖拽 / 红身 / 藏尸 / 断电响应 / 管道规划：全部按夜清空 */
        a.drag=null;a.draggedBy=null;a.redT=0;a._dragSnd=0;a._dragAiT=0;
        a._dragAway=false;a._dragMedD0=0;a._dragAwaySeen={};
        a._hideSpot=null;a._hideRoom=null;a._hideCD=0;a._hides=0;
        a._lightGo=false;a._pipePlan=null;a._pipeSeeks=0;a._secAvoidT=0;a._botCD=0;
        a._killBody=null;a._killAt=0;a._killDecided=true;a._reportPlan=null;
        a._avoid={};a._fleeT=0;a._fleeFrom=null;a._pathCD=0;a._fakeN=0;a._alienTaskN=0;a._stallBias=0.8+Math.random()*0.4;
        a._fakeTaskN=0;a._fakeKind=null;a._supportGoal=null;a._lootMem={};
        /* 节奏控制：错峰开工 + 修完歇一会儿；异形更早开始活动，但不会开局贴脸 */
        a.act=null;a._rest=0;a._delay=2+Math.random()*6;a._fxT=0;
        a.nRoom=roomIdAt(a.x,a.y);a.nSeen={};a.nTask=null;a.nTaskRoom=null;
        a.accuse=null;a._lie=null;
      }
      G.drag=null;
      G.aiReportUsed=false;G.evSeq=0;
      G.trackT=0;G.medbotUsed=false;G.medbotT=0;G.medbotTarget=null;G.medbotLeft=MEDBOT_CHARGES;G.botHp={secbot:2,medbot:1};G.secbotUsed=false;G.secbotUses=0;G.secbotT=0;G.pendingCrime=null;
      G.medbotDead=false;G.secbotDead=false;G.powerFixed=false;G.secCatch=null;
      for(const d of (G.doors||[])){d.open=0;d.target=0;d.scanT=0;}
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
      const dur=sp.item==='ammo'?SUPPLY_AMMO_TIME:SUPPLY_MED_TIME;
      me.doing=dur;me._dur=dur;me._doing=sp.item==='ammo'?'ammo':'med';
      toast('消耗 1 张物资申请单领取'+(sp.item==='ammo'?'子弹 '+dur+'s':'医疗包 '+dur+'s')+' · 站桩，移动会打断');
      SND.interact();
      return true;
    }
    function ghostTaskPts(p){return p&&p.kind==='hard'?2:1;}
    function ghostTaskAllowed(a,p){return !a||!a.ghost||((a.ghostPts||0)+ghostTaskPts(p)<=2);}
    function startTask(me,p,ghost){
      me.path=null;me.moving=false;
      if(me.ghost&&me.alien){if(me===G.me&&!G.spectMode)toast('异形幽灵不能执行维修');return false;}
      if(me.ghost&&!ghostTaskAllowed(me,p)){
        if(me===G.me&&!G.spectMode)toast('幽灵最多维修 2 分的剩余任务');return false;
      }
      /* 记住实际修的任务点：玩家可以乱序修自己的任意剩余任务，
         结算时不能按 tasks[tIdx] 记账（否则会出现“修 C 记 A 完成”） */
      me._taskPt=M.points.indexOf(p);
      me.doing=ghost?p.dur*1.6:p.dur; me._dur=me.doing; me._doing='task';
      if(ghost){if(me===G.me&&!G.spectMode)toast('幽灵维修「'+p.label+'」 '+me.doing.toFixed(1)+'s');}
      else toast('开始维修「'+p.label+'」 '+me.doing+'s · 站桩，移动会打断');
    }
    function collectInteractions(me){
      const out=[],ghost=!me.alive,ml=me.tasks.slice(me.tIdx);
      const fd=nearDmg(me);
      if(fd&&(!ghost||!me.alien))out.push({id:'fix',x:fd.x,y:fd.y,short:'维修故障',
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
        const br=M.facility.find(f=>f.kind==='breaker'&&Math.hypot(f.x-me.x,f.y-me.y)<BREAKER_USE_R);
        if(br){
          const bd=breakerPullTime();
          out.push({id:'breaker',x:br.x,y:br.y,
            short:G.lightState===2?'合闸':'拉闸',
            pill:'[E] '+(G.lightState===2?'合闸':'拉闸')+' '+bd+'s · '+(G.lightState===2?'当前断电':'当前照明'),
            accent:'rgba(127,211,240,.75)',fg:'#BFE9F7',
            run:()=>{me.path=null;me.moving=false;me.doing=bd;me._dur=bd;me._doing='breaker';SND.interact();toast((G.lightState===2?'合闸 ':'拉闸 ')+bd+'s');}});
        }
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
          if(!bodyReported(nb))out.push({id:'report',x:bp[0],y:bp[1],short:'报告尸体',
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
          if(bot.kind==='secbot')toast(G.secbotDead?'保安机器人：今晚已停摆':(G.secbotUses>=SEC_USES_MAX?'保安机器人：本夜 '+SEC_USES_MAX+' 次擒拿已用完':('保安机器人：在线 · 本夜 '+((G.secbotUses||0))+'/'+SEC_USES_MAX+' · '+SEC_RANGE+' 格半圆内危险行为会被押送拘留 30s')));
          else toast(G.medbotDead?'医疗无人机：今晚已停摆':(G.medbotLeft<=0?'医疗无人机：电量耗尽':(G.medbotUsed?'医疗无人机：电量 '+G.medbotLeft+'/'+MEDBOT_CHARGES:'医疗无人机：待命 · 电量 '+MEDBOT_CHARGES+'/'+MEDBOT_CHARGES+' · 悬停在医疗间正中央，有人濒死会飞过去近身治疗 '+MEDBOT_HEAL_TIME+' 秒')));
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
      logEvent('bot_down',{actor:me.i,bot:target.kind,method:'sabotage',
        room:roomIdAt(tp.x,tp.y),x:+tp.x.toFixed(1),y:+tp.y.toFixed(1)});
      G.fx.push({type:'spark',x:tp.x,y:tp.y,t:1.4,dur:1.4});
      hear(tp.x,tp.y,'power',0.9);
      SND.sabotage();
      witnessAlienAction(me,me.x,me.y,6,'bot');
      aiHear('robot_down',me.x,me.y,18,{actor:me});
      envNotice('robot',tp.x,tp.y,0.5);
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
          short:'停摆'+(target.kind==='secbot'?'保安机器人':'医疗无人机'),
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
        toast('出刀：'+(botKind==='secbot'?'保安机器人':'医疗无人机')+'装甲受击 · 刀数 -1');
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
      if(G.simMode&&G.simStats){
        G.simStats.shots++;
        if(shooter.alien)G.simStats.alienShots++; else G.simStats.humanShots++;
      }
      G.pendingCrime=shooter.i;
      if(!G.spectMode&&target===G.me&&G.dev){
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
      SND.flesh(0.36);
      hear(shooter.x,shooter.y,'shot',1.15);
      target.downed=true; target.downAt=G.t; target.path=null; target.doing=0;
      target._doing=null; target._sv=null;
      target.downX=target.x; target.downY=target.y; target.killedBy=shooter.i;
      target.woundCause='shot'; target.downRoom=roomIdAt(target.x,target.y);
      target.searched=false;
      logEvent('shoot',{actor:shooter.i,victim:target.i,room:target.downRoom,
        x:+target.x.toFixed(1),y:+target.y.toFixed(1)});
      noticeAction(shooter,shooter.x,shooter.y,7,'shot',target);
      aiHear('shot',shooter.x,shooter.y,20,{actor:shooter,victim:target});
      screamFor(target);
      if(!G.spectMode&&target===G.me){closeSabPick(true);G.sabTarget=null;toast('你被击中，濒死');}
      else if(!G.spectMode&&shooter===G.me) toast('开枪击中 '+target.name);
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
    /* 拆保安的前置条件（2026-10-31）：异形之间不能通信，只有「房间里已经认出多名队友 +
       能推断出一个共同捕杀目标」时才值得冒暴露风险——落单拆保安等于白送一条
       saw_bot 确证（会被直接锁定投票）。默认不攻击保安。 */
    function secbotRaidOk(a,secPos){
      if(!a||!secPos||!a.alive||a.downed)return false;
      let mates=0;
      for(const k in (a.mates||{})){
        const m2=G.agents[+k];
        if(!m2||!m2.alive||m2.downed||m2.detained)continue;
        if(Math.hypot(m2.x-secPos.x,m2.y-secPos.y)<=8)mates++;
      }
      if(mates<2)return false;
      /* 共同目标：保安 8 格内有活人（非队友），且至少一名队友也在朝他靠 */
      for(const v of G.agents){
        if(v===a||!v.alive||v.downed||v.detained||v.alien)continue;
        if(Math.hypot(v.x-secPos.x,v.y-secPos.y)>8)continue;
        for(const k in (a.mates||{})){
          const m2=G.agents[+k];
          if(!m2||!m2.alive||m2.downed||m2.detained)continue;
          if(Math.hypot(m2.x-secPos.x,m2.y-secPos.y)>8)continue;
          if(Math.hypot(m2.x-v.x,m2.y-v.y)<=7)return Math.random()<0.7;
        }
      }
      return false;
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
      const nm=kind==='secbot'?'保安机器人':'医疗无人机';
      logEvent('bot_hit',{actor:attacker.i,bot:kind,method:cause||'knife',
        hp:Math.max(0,G.botHp[kind]),room:roomIdAt(p.x,p.y),
        x:+p.x.toFixed(1),y:+p.y.toFixed(1)});
      if(G.botHp[kind]<=0){
        if(kind==='secbot')G.secbotDead=true; else{G.medbotDead=true;G.medbotLeft=0;}
        G.fx.push({type:'alarm',x:p.x,y:p.y,t:1.4,dur:1.4});
        logEvent('bot_down',{actor:attacker.i,bot:kind,method:cause||'knife',
          room:roomIdAt(p.x,p.y),x:+p.x.toFixed(1),y:+p.y.toFixed(1)});
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
      if(G.simMode&&G.simStats){
        G.simStats.shots++;
        if(shooter.alien)G.simStats.alienShots++; else G.simStats.humanShots++;
      }
      G.pendingCrime=shooter.i;
      const ang=Math.atan2(p.y-shooter.y,p.x-shooter.x);
      setAct(shooter,'shoot',0.55,{ang});
      G.fx.push({type:'tracer',x1:shooter.x,y1:shooter.y,x2:p.x,y2:p.y,t:0.45,dur:0.45,ang});
      G.fx.push({type:'muzzle',x:shooter.x+Math.cos(ang)*0.55,y:shooter.y+Math.sin(ang)*0.55,t:0.2,dur:0.2,ang});
      G.fx.push({type:'impact',x:p.x,y:p.y,t:0.55,dur:0.55});
      SND.shot();hear(shooter.x,shooter.y,'shot',1.15);
      damageBot(kind,shooter,'shot');
      if(shooter===G.me)toast('开枪击中 '+(kind==='secbot'?'保安机器人':'医疗无人机'));
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
        ui:['audio/sfx-ui.ogg'],
        work:['audio/sfx-work.ogg'],
        flesh:['audio/sfx-flesh.ogg'],
        win:['audio/sfx-win.ogg'],
        lose:['audio/sfx-lose.ogg'],
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
        if(!on||SIM_RUN)return true;
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
        if(!on||SIM_RUN)return; const c=C(); if(!c)return;
        const o=c.createOscillator(), g=c.createGain();
        o.type=type||'sine'; o.frequency.setValueAtTime(f0,c.currentTime);
        if(f1) o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),c.currentTime+dur);
        g.gain.setValueAtTime((vol||0.10)*master,c.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0008,c.currentTime+dur);
        o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime+dur+0.02);
      }
      function noise(dur,vol,hp){
        if(!on||SIM_RUN)return; const c=C(); if(!c)return;
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
        if(!on||SIM_RUN)return; const c=C(); if(!c)return;
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
          const v=Math.max(0.12,Math.min(0.78,(vol==null?0.6:vol)*0.86));
          if(!play('knife',v,0.92+Math.random()*0.10)){
            noise(0.09,0.10,1200); beep(300,140,0.14,'triangle',0.07);
          }
        },
        flesh:function(vol){
          /* 命中反馈：枪/刀之后叠一层血肉闷响，与“枪声/刀风”本身区分开 */
          if(!play('flesh',Math.max(0.10,Math.min(0.55,vol==null?0.32:vol)),0.94+Math.random()*0.10))
            noise(0.10,0.06,900);
        },
        shot:function(vol){
          note('shot');
          if(!play('gun',vol==null?1:vol,0.97+Math.random()*0.06)){ noise(0.10,0.34,300); beep(900,120,0.16,'square',0.18); }
        },
        step:function(vol){
          note('step');
          /* 换成更轻的 CC0 木地板脚步，并整体压低；AI 只在近处播放 */
          if(!play('step',(vol==null?0.4:vol)*0.78,1.02+Math.random()*0.12)) beep(150,120,0.06,'sine',0.05);
        },
        scream:function(vol){
          /* 被击倒时的喊叫：公开 CC0 死亡/受创人声采样；不写播放日志 */
          if(!play('scream',Math.max(0.06,Math.min(0.65,vol==null?0.45:vol)),0.96+Math.random()*0.08)){
            noise(0.12,0.07,600); beep(300,160,0.18,'sawtooth',0.04);
          }
        },
        ui:function(){ if(!play('ui',0.85,1)) beep(520,700,0.07,'triangle',0.12); },
        interact:function(){ if(!play('ui',0.85,1)) beep(520,700,0.07,'triangle',0.12); },
        doorAuto:function(vol){
          /* 自动门不写播放日志，避免干扰「一次出刀只响一次」的断言 */
          if(!play('door',(vol==null?0.4:vol)*0.65,0.92)) beep(240,180,0.09,'square',0.035);
        },
        done:function(){ beep(660,990,0.15,'triangle',0.16); },
        qual:function(){ beep(520,1040,0.32,'sine',0.18); beep(780,1560,0.22,'sine',0.09); },
        work:function(){ if(!play('work',0.55,0.94+Math.random()*0.12)) noise(0.05,0.06,1600); },
        med:function(){ beep(420,760,0.20,'sine',0.16); },
        ammo:function(){ beep(300,240,0.13,'square',0.15); },
        revive:function(){ beep(380,900,0.30,'sine',0.17); },
        report:function(){ note('report'); if(!play('report',0.75,1)){ beep(880,440,0.28,'triangle',0.13); } },
        vote:function(){ if(!play('ui',0.55,1.18)) beep(600,900,0.09,'square',0.10); },
        expel:function(){ note('expel'); if(!play('metal',0.9,0.72)) beep(300,80,0.50,'sawtooth',0.16); },
        breaker:function(){ note('breaker'); noise(0.18,0.26,200); beep(95,55,0.28,'square',0.11); play('metal',0.85,0.9); },
        sabotage:function(){ note('sabotage'); noise(0.30,0.20,600); beep(180,1500,0.28,'sawtooth',0.09); play('metal',0.6,0.78); },
        pipe:function(){ note('pipe'); beep(210,760,0.24,'sine',0.11); },
        robot:function(){ note('robot'); beep(240,180,0.12,'square',0.08); play('metal',0.55,1.04); noise(0.10,0.10,1200); },
        alarm:function(){ note('alarm'); beep(780,780,0.10,'square',0.16); },
        search:function(){ noise(0.16,0.10,1800); beep(520,640,0.10,'triangle',0.09); },
        ghost:function(){ beep(880,220,0.55,'sine',0.09); beep(440,110,0.70,'sine',0.05); },
        win:function(){ note('win'); if(!play('win',0.9)){ beep(660,1320,0.5,'sine',0.16); } },
        lose:function(){ note('lose'); if(!play('lose',0.85)){ beep(220,60,0.7,'sawtooth',0.14); } },
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
      transit:'cozy/tiles/floor-carpet-beige.png',fun:'cozy/tiles/floor-carpet-beige.png',warehouse:'cozy/tiles/floor-steel.png',
      cam:'cozy/tiles/floor-steel-bolts.png',med:'cozy/tiles/floor-lab.png',
      armory:'cozy/tiles/floor-hazard.png'};
    const FURN={table:'table',console:'console',pillar:'locker',tank:'cooler',tree:'plant',
      pond:'rug',machine:'rack',crate:'crate',breaker:'console',sofa:'sofa',chair:'chair',
      bed:'bed',fridge:'fridge',rack:'rack',warehouse_rack:'rack',counter:'table',plate_stack:'table',pot:'console',
      /* 专用 kind（tools/blender-ship.py 家具层）在底图未就绪的兜底路径上的近似替身 */
      reactor:'cryopod',engineblock:'rack',screenwall:'screen',servercab:'locker',
      switchgear:'terminal',transformer:'cooler',shelftall:'rack',pallet:'crate',
      medbed:'bed',ventilator:'terminal',ivstand:'lamp',servicecounter:'desk',
      forklift:'crate',jukebox:'vending',billiard:'table',holoscreen:'screen',gunrack:'rack'};
    for(const k in FLOOR) loadImg('fl_'+k,FLOOR[k]);
    const FSET=new Set(Object.values(FURN));
    for(const f of FSET) loadImg('fu_'+f,'cozy/furniture/'+f+'.png');
    for(let i=1;i<=15;i++) loadImg('cr_'+i,'crew/crew-'+String(i).padStart(2,'0')+'.png');
    loadImg('base','v4/base-lit.png');
    loadImg('hull','v4/hull-deck.png');
    loadImg('door','v4/tex/door-panel.png');
    /* 设施 2.5D 贴图（tools/gen-facility-sprites.py · SDXL 出图 + 统一调色抠图）：
       与 Blender 底图共用同一套冷暗配色；未就绪时 drawFacilities 自动回退到
       原来的 Canvas 造型，file:// 冷启动也不会出现空白设施。 */
    loadImg('fx_medbot','v4/facility/medbot.png');
    loadImg('fx_secbot','v4/facility/secbot.png');
    /* 监控台 / 电闸的贴图不再进运行时：它们的本体由 Blender 底图烘出来，
       面板与屏幕材质走 assets/scene/v4/tex/facility-*.png（见 tools/blender-ship.py）。
       assets/scene/v4/facility/monitor.png / breaker.png 保留为素材库。 */
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
    /* 医疗无人机（2026-10-31 取代原来的巡逻医疗机器人）：悬浮机身 + 四旋翼 + 医疗十字 + 推进器底光。
       和 drawRobotBody 分开画——那台是长腿的地勤机器人，无人机不接地，
       悬停高度、旋翼旋转、治疗光束都是独立表现；停摆时整台砸在地上、旋翼停转。 */
    function drawMedDrone(T,x,y,s,o){
      const dead=!!o.dead, exhausted=!!o.exhausted;
      const hover=dead?0.24*s:(0.52*s+Math.sin(T*2.4)*0.04*s);
      const cy=y-hover;
      const base=dead?'#5B6572':(exhausted?'#8A6A45':'#3FBF8C');
      const accent=dead?'#4E5663':(exhausted?'#D4B070':'#7FE3B4');
      ctx.save();
      /* 地面投影：悬停呼吸，飞得高时更小更淡 */
      const sh=0.30+0.04*Math.sin(T*2.4);
      ctx.fillStyle='rgba(0,0,0,'+(dead?0.32:0.18)+')';
      ctx.beginPath();ctx.ellipse(x,y-0.02*s,sh*s*0.86,sh*s*0.34,0,0,7);ctx.fill();
      /* 推进器底光 */
      if(!dead){
        const g=ctx.createRadialGradient(x,cy+0.20*s,0,x,cy+0.20*s,0.95*s);
        g.addColorStop(0,exhausted?'rgba(212,176,112,.15)':'rgba(63,191,140,.20)');
        g.addColorStop(1,'rgba(63,191,140,0)');
        ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,cy+0.20*s,0.95*s,0,7);ctx.fill();
      }
      /* 机体：优先用 SDXL 出的 2.5D 俯视贴图（assets/scene/v4/facility/medbot.png）。
         贴图自带四旋翼 + 青绿医疗十字；代码只叠加「悬停浮动 + 旋翼残影 + 状态灯」，
         贴图没加载完（file:// 冷启动）时回退到原来的矢量造型。 */
      const img=IMG['fx_medbot'];
      if(ready(img)){
        const w=1.72*s, h=1.72*s;
        if(!dead){
          const spin=T*16;
          for(const ax of [-1,1])for(const ay of [-1,1]){
            ctx.strokeStyle='rgba(159,240,203,'+(0.14+0.09*Math.sin(spin+ax+ay)).toFixed(2)+')';
            ctx.lineWidth=0.028*s;
            ctx.beginPath();
            ctx.ellipse(x+ax*0.40*s,cy+ay*0.22*s,0.20*s,0.085*s,spin*0.4,0,7);
            ctx.stroke();
          }
        }
        ctx.globalAlpha=dead?0.5:0.98;
        ctx.drawImage(img,x-w/2,cy-h*0.50,w,h);
        ctx.globalAlpha=1;
      }else{
        /* 四旋翼：支臂 + 高速旋转双弧（停摆后只剩静止的桨盘） */
        const spin=T*(dead?0:16);
        for(const ax of [-1,1])for(const ay of [-1,1]){
          const rx=x+ax*0.36*s, ry=cy+ay*0.19*s;
          ctx.strokeStyle=dead?'rgba(92,102,118,.6)':base;ctx.lineWidth=0.05*s;
          ctx.beginPath();ctx.moveTo(x,cy);ctx.lineTo(rx,ry);ctx.stroke();
          if(dead){
            ctx.fillStyle='rgba(92,102,118,.28)';
            ctx.beginPath();ctx.ellipse(rx,ry,0.15*s,0.06*s,0,0,7);ctx.fill();
          }else{
            for(let k=0;k<2;k++){
              ctx.strokeStyle='rgba(159,240,203,'+(0.26+0.20*Math.sin(spin+k*2.1+ax+ay)).toFixed(2)+')';
              ctx.lineWidth=0.045*s;
              ctx.beginPath();ctx.ellipse(rx,ry,0.17*s,0.075*s,spin*0.35+k*Math.PI*0.5,0,7);ctx.stroke();
            }
          }
        }
        /* 机身 */
        ctx.fillStyle=dead?'rgba(52,58,68,.95)':'rgba(12,20,26,.96)';
        ctx.strokeStyle=base;ctx.lineWidth=Math.max(1.4,0.045*s);
        ctx.beginPath();ctx.roundRect(x-0.23*s,cy-0.17*s,0.46*s,0.31*s,0.11*s);ctx.fill();ctx.stroke();
        /* 顶盖高光 */
        ctx.fillStyle=dead?'rgba(70,78,90,.45)':'rgba(127,227,180,.13)';
        ctx.beginPath();ctx.roundRect(x-0.17*s,cy-0.14*s,0.34*s,0.09*s,0.045*s);ctx.fill();
        /* 医疗十字 */
        ctx.fillStyle=accent;
        ctx.fillRect(x-0.035*s,cy-0.075*s,0.07*s,0.17*s);
        ctx.fillRect(x-0.085*s,cy-0.025*s,0.17*s,0.07*s);
      }
      /* 侧灯：在线=呼吸绿灯，电量耗尽=琥珀慢闪 */
      const blink=exhausted?(0.35+0.35*Math.sin(T*4)):(0.55+0.35*Math.sin(T*3));
      ctx.fillStyle='rgba('+(exhausted?'212,176,112':'127,227,180')+','+blink.toFixed(2)+')';
      ctx.beginPath();ctx.arc(x+0.28*s,cy-0.10*s,0.045*s,0,7);ctx.fill();
      /* 治疗光束：悬停在伤员身边时持续拉住（不是读条瞬间才闪一下） */
      if(o.healing&&o.target){
        const tx=SX(o.target.x), ty=SY(o.target.y)-0.30*s;
        const sx0=x, sy0=cy+0.16*s;
        const flick=0.55+0.28*Math.sin(T*13);
        const bg=ctx.createLinearGradient(sx0,sy0,tx,ty);
        bg.addColorStop(0,'rgba(200,255,228,.78)');
        bg.addColorStop(1,'rgba(127,227,180,'+(0.20*flick).toFixed(2)+')');
        ctx.strokeStyle=bg;ctx.lineWidth=Math.max(2,0.085*s);ctx.lineCap='round';
        ctx.beginPath();ctx.moveTo(sx0,sy0);ctx.lineTo(tx,ty);ctx.stroke();
        for(let k=0;k<3;k++){
          const p=((T*1.7+k*0.33)%1);
          ctx.fillStyle='rgba(210,255,236,'+(0.5*(1-p)).toFixed(2)+')';
          ctx.beginPath();
          ctx.arc(sx0+(tx-sx0)*p,sy0+(ty-sy0)*p,0.055*s,0,7);ctx.fill();
        }
        ctx.strokeStyle='rgba(127,227,180,'+(0.34+0.34*Math.sin(T*9)).toFixed(2)+')';
        ctx.lineWidth=2;
        ctx.beginPath();ctx.ellipse(tx,ty+0.30*s,0.56*s,0.30*s,0,0,7);ctx.stroke();
      }
      ctx.restore();
    }
    /* 机器人标签的唯一文案源：保安拘留次数必须读 SEC_USES_MAX，不能再写死 3 */
    function botLabelText(f,dead){
      const left=G.medbotLeft==null?MEDBOT_CHARGES:G.medbotLeft;
      const exhausted=f.kind==='medbot'&&!dead&&left<=0;
      return f.label+(dead?' · 停摆':(exhausted?' · 电量耗尽':
        (f.kind==='medbot'?' · 电量 '+left+'/'+MEDBOT_CHARGES:
          (f.kind==='secbot'?' · 拘留 '+((G.secbotUses||0))+'/'+SEC_USES_MAX:' · 在线'))));
    }
    function drawBotLabel(f,x,y,s,dead){
      const text=botLabelText(f,dead);
      const left=G.medbotLeft==null?MEDBOT_CHARGES:G.medbotLeft;
      const exhausted=f.kind==='medbot'&&!dead&&left<=0;
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
    /* 设施：电闸 / 监控台 / 医疗无人机 / 保安机器人 / 拘留区 */
    function drawFacilities(T){
      const s=VIEW.s;
      for(const f of M.facility){
        /* 机器人按巡逻运行时坐标画，设施表里的 x/y 只是初始位 */
        const rp=(f.kind==='medbot'||f.kind==='secbot')?botPos(f.kind):null;
        const x=SX(rp?rp.x:f.x),y=SY(rp?rp.y:f.y);
        if(f.kind==='breaker'){
          const off=G.lightState===2;
          /* 电闸优化：柜体 + 危险色边框 + 大拉杆（角度随供电状态平滑过渡）+
             状态灯 + 拉闸进度环。6 秒重拉闸时进度环变成橙红并带电流抖动。 */
          const pull=breakerPuller();
          const lever=off?1:0;
          BREAKER_LEVER+= (lever-BREAKER_LEVER)*Math.min(1,0.16);
          const ang=-0.62+BREAKER_LEVER*1.22;
          ctx.save();ctx.translate(x,y);
          /* 柜体本体交给底图（2026-10-31 改）：
             tools/blender-ship.py 的 breaker 分支早就烘了柜体 + 门板 + 拉杆 + LED 灯带 +
             线管 + 地面框，面板材质换成 SDXL 的 facility-panel.png。Canvas 只画玩法状态层
             —— 断电冷光、供电状态灯、拉闸进度环、重闸电弧。以前这里再画一台柜子（或叠一张
             SDXL 精灵），会跟底图那台叠成两台设备，玩家看到的就是「突兀」。 */
          if(off){
            const g0=ctx.createRadialGradient(0,0,0,0,0,1.05*s);
            g0.addColorStop(0,'rgba(70,150,190,.28)');
            g0.addColorStop(1,'rgba(70,150,190,0)');
            ctx.fillStyle=g0;ctx.beginPath();ctx.arc(0,0,1.05*s,0,7);ctx.fill();
          }
          const blink=off?(0.50+0.35*Math.sin(T*6)):(0.60+0.30*Math.sin(T*2.2));
          ctx.fillStyle=(off?'rgba(127,211,240,':'rgba(127,227,180,')+blink.toFixed(2)+')';
          ctx.beginPath();ctx.arc(-0.46*s,-0.62*s,0.085*s,0,7);ctx.fill();
          ctx.fillStyle='rgba(205,216,230,.90)';
          ctx.font='600 '+Math.max(8,0.17*s).toFixed(1)+'px system-ui';
          ctx.textAlign='left';ctx.textBaseline='middle';
          ctx.fillText(off?'断电':'供电',-0.32*s,-0.62*s);
          /* 拉闸进度环 */
          if(pull&&pull.p>0){
            const hot=pull.heavy;
            ctx.strokeStyle=hot?'rgba(255,150,60,.92)':'rgba(127,211,240,.92)';
            ctx.lineWidth=3;ctx.lineCap='round';
            ctx.beginPath();ctx.arc(0,0,0.86*s,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,pull.p));
            ctx.stroke();
            if(hot){
              for(let k=0;k<3;k++){
                const aa=T*9+k*2.1, rr=0.62*s+Math.sin(T*13+k)*0.06*s;
                ctx.strokeStyle='rgba(255,214,140,'+(0.35+0.35*Math.sin(T*17+k)).toFixed(2)+')';
                ctx.lineWidth=1.4;
                ctx.beginPath();
                ctx.moveTo(Math.cos(aa)*rr,Math.sin(aa)*rr);
                ctx.lineTo(Math.cos(aa+0.5)*rr*1.12,Math.sin(aa+0.5)*rr*1.12);
                ctx.stroke();
              }
            }
          }
          drawIcon('bolt',off?'#7FD3F0':'#F0C674',0.40*s,-0.50*s,0.30*s,0);
          ctx.restore();
        }else if(f.kind==='monitor'){
          const cut=G.lightState===2;
          ctx.save();ctx.translate(x,y);
          /* 监控台本体同样交给底图（2026-10-31 改）：监控室的 screenwall（多屏拼接墙）、
             console（主控台）、servercab（备份机柜）都是 Blender 模型，屏幕内容用 SDXL 的
             facility-screen.png。Canvas 只画「这台还能不能调画面」的读数：在线呼吸灯 /
             断线红点 + 一层屏光。以前这里再叠一张屏幕精灵，等于墙上多出一台设备。 */
          if(!cut){
            const gg=ctx.createRadialGradient(0,-0.62*s,0,0,-0.62*s,1.15*s);
            gg.addColorStop(0,'rgba(95,224,168,.18)');
            gg.addColorStop(1,'rgba(95,224,168,0)');
            ctx.fillStyle=gg;ctx.beginPath();ctx.arc(0,-0.62*s,1.15*s,0,7);ctx.fill();
          }else{
            const gr=ctx.createRadialGradient(0,-0.62*s,0,0,-0.62*s,0.95*s);
            gr.addColorStop(0,'rgba(190,60,50,.22)');
            gr.addColorStop(1,'rgba(190,60,50,0)');
            ctx.fillStyle=gr;ctx.beginPath();ctx.arc(0,-0.62*s,0.95*s,0,7);ctx.fill();
          }
          const mblink=cut?(0.55+0.35*Math.sin(T*8)):(0.45+0.30*Math.sin(T*2.6));
          ctx.fillStyle=cut?('rgba(255,107,97,'+mblink.toFixed(2)+')')
            :('rgba(95,224,168,'+mblink.toFixed(2)+')');
          ctx.beginPath();ctx.arc(0,-0.92*s,0.075*s,0,7);ctx.fill();
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
          const left=G.medbotLeft==null?MEDBOT_CHARGES:G.medbotLeft;
          const exhausted=!dead&&left<=0;
          const b=G.bots&&G.bots.medbot;
          ctx.save();
          if(!dead&&!exhausted){
            /* 覆盖范围显化：整间医疗间（呼吸虚线沿房间轮廓）。
               改成无人机后不再有「以机器人为圆心的 6 格圆」——它会自己飞过去，
               玩家只要记住一条规则：人落在医疗间里就有人来救。 */
            const mr=M.rooms.find(r=>r.id==='med');
            if(mr){
              ctx.beginPath();
              mr.poly.forEach((p,i)=>i?ctx.lineTo(SX(p[0]),SY(p[1])):ctx.moveTo(SX(p[0]),SY(p[1])));
              ctx.closePath();
              ctx.fillStyle='rgba(63,191,140,.045)';ctx.fill();
              ctx.setLineDash([0.22*s,0.26*s]);ctx.lineDashOffset=-T*10;
              ctx.strokeStyle='rgba(127,227,180,'+(0.34+0.16*Math.sin(T*2.2)).toFixed(2)+')';
              ctx.lineWidth=1.6;ctx.stroke();
              ctx.setLineDash([]);
            }
          }
          drawMedDrone(T,x,y,s,{dead:dead,exhausted:exhausted,
            face:b?b.face:1,moving:!!(b&&b.moving),healing:!!(b&&b.healing),
            target:G.medbotTarget!=null?G.agents[G.medbotTarget]:null});
          if(G.medbotT>0&&!dead&&!exhausted){
            /* 治疗进度环：钉在无人机悬停位，按 MEDBOT_HEAL_TIME 走满才拉起 */
            const p=Math.min(1,G.medbotT/MEDBOT_HEAL_TIME);
            ctx.strokeStyle='rgba(200,255,228,.26)';ctx.lineWidth=1.6;
            ctx.beginPath();ctx.arc(x,y-0.52*s,0.66*s,0,7);ctx.stroke();
            ctx.strokeStyle='rgba(127,227,180,'+(0.42+0.34*Math.sin(T*10)).toFixed(2)+')';
            ctx.lineWidth=2.8;ctx.lineCap='round';
            ctx.beginPath();ctx.arc(x,y-0.52*s,0.66*s,-Math.PI/2,-Math.PI/2+Math.PI*2*p);ctx.stroke();
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
            /* 观察范围显化：真实 14 格 / 180° 扇形，不再只画 2.5 格的小弧。
               扇形按保安所在舱室裁剪——墙会挡视线，画到舱外只会误导玩家。 */
            const sroom=roomAt(b?b.x:f.x,b?b.y:f.y);
            ctx.save();
            if(sroom){
              ctx.beginPath();
              sroom.poly.forEach((p,i)=>i?ctx.lineTo(SX(p[0]),SY(p[1])):ctx.moveTo(SX(p[0]),SY(p[1])));
              ctx.closePath();ctx.clip();
            }
            ctx.fillStyle='rgba(255,107,97,.05)';ctx.strokeStyle='rgba(255,107,97,.30)';ctx.lineWidth=1.4;
            ctx.beginPath();ctx.moveTo(x,y-0.55*s);
            ctx.arc(x,y-0.55*s,SEC_RANGE*s,fa-SEC_ARC,fa+SEC_ARC);ctx.closePath();
            ctx.fill();ctx.stroke();
            ctx.strokeStyle='rgba(255,107,97,.38)';ctx.lineWidth=1.8;
            ctx.beginPath();ctx.arc(x,y-0.55*s,SEC_RANGE*s*0.72,scan-0.34,scan+0.34);ctx.stroke();
            ctx.beginPath();ctx.arc(x,y-0.55*s,SEC_RANGE*s*0.72,scan+Math.PI-0.34,scan+Math.PI+0.34);ctx.stroke();
            ctx.restore();
            ctx.fillStyle='rgba(255,180,170,.75)';ctx.font='500 8px system-ui';ctx.textAlign='center';
            ctx.fillText(SEC_RANGE+' 格 · 180°',x,y-0.55*s-3.2*s);
            if(G.secbotT>0){
              ctx.strokeStyle='rgba(255,107,97,'+(0.5+0.4*Math.sin(T*16)).toFixed(2)+')';ctx.lineWidth=2.6;
              ctx.beginPath();ctx.arc(x,y-0.55*s,(1.1+0.8*(1.6-G.secbotT))*s,0,7);ctx.stroke();
            }
          }
          /* 已擒拿过的当晚转琥珀色，保留原有"本夜用过"的信息。
             机体优先用 SDXL 出的 2.5D 贴图（站立 3/4 视角，与 crew 立绘同一套语言） */
          const simg=IMG['fx_secbot'];
          if(ready(simg)){
            const w=1.05*s, h=1.50*s;
            ctx.globalAlpha=dead?0.42:0.98;
            ctx.drawImage(simg,x-w/2,y-h*0.93,w,h);
            ctx.globalAlpha=1;
            if(dead){
              /* 停摆：机身压暗 + 一道斜向裂纹提示，避免和在线状态混淆 */
              ctx.strokeStyle='rgba(150,160,175,.55)';ctx.lineWidth=1.4;
              ctx.beginPath();ctx.moveTo(x-0.26*s,y-0.35*s);ctx.lineTo(x+0.24*s,y-1.02*s);ctx.stroke();
            }
            if(used&&!dead){
              ctx.fillStyle='rgba(201,164,107,.85)';
              ctx.beginPath();ctx.arc(x+0.30*s,y-1.18*s,0.07*s,0,7);ctx.fill();
            }
          }else{
            drawRobotBody(T,x,y,s,{kind:'secbot',dead:dead,face:b?b.face:1,
              moving:!!(b&&b.moving),base:used?'#8A6A45':'#FF6B61',
              accent:used?'#C9A46B':'#FFB4A8'});
          }
          if(G.secCatch&&!dead){
            const cd=G.secCatch, tgt=G.agents[cd.i];
            if(tgt){
              const tx=SX(tgt.x),ty=SY(tgt.y);
              ctx.strokeStyle='rgba(255,107,97,'+(0.55+0.3*Math.sin(T*14)).toFixed(2)+')';
              ctx.lineWidth=2;ctx.setLineDash([5,3]);
              ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(tx,ty);ctx.stroke();ctx.setLineDash([]);
              ctx.strokeStyle='rgba(255,180,170,.85)';ctx.lineWidth=1.5;
              ctx.beginPath();ctx.arc(tx,ty,1.15*s,0,7);ctx.stroke();
              ctx.fillStyle='rgba(255,190,180,.9)';ctx.font='600 9px system-ui';ctx.textAlign='center';
              ctx.fillText(cd.phase==='chase'?'追捕':'压制',tx,ty-1.5*s);
            }
          }
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
    /* 地道口：菱形格栅 + 呼吸光环。
       形状语言全船统一（菱形 + 三道格栅 + 呼吸环），配色跟随所在舱室的主题色，
       这样食堂口是暖金、医疗口是冷青、引擎口是橙红，看起来长在房间里而不是贴上去的。
       颜色值与 tools/blender-ship.py 的 ROOM_THEME[].mark 对齐。 */
    const PIPE_TINT={
      engine:[245,117,51], cam:[61,199,242], armory:[250,184,51], warehouse:[250,199,61],
      transit:[250,204,115], med:[77,209,240], bridge:[242,184,71], ecosys:[87,219,112],
      power:[245,179,41], fun:[224,82,204],
    };
    function pipeTint(rid){
      const c=PIPE_TINT[rid]||[168,150,255];
      return {a:(v)=>'rgba('+c[0]+','+c[1]+','+c[2]+','+v+')',
              dim:(v)=>'rgba('+Math.round(c[0]*0.82)+','+Math.round(c[1]*0.82)+','+Math.round(c[2]*0.88)+','+v+')'};
    }
    function drawPipes(T){      const s=VIEW.s;
      for(const q of M.pipes){
        const x=SX(q.x),y=SY(q.y);
        const tint=pipeTint(q.room);
        const rad=ctx.createRadialGradient(x,y,0,x,y,0.95*s);
        rad.addColorStop(0,tint.a('.20'));
        rad.addColorStop(1,tint.a('0'));
        ctx.fillStyle=rad;ctx.beginPath();ctx.arc(x,y,0.95*s,0,7);ctx.fill();
        ctx.save();ctx.translate(x,y);ctx.rotate(Math.PI/4);
        ctx.fillStyle='rgba(12,12,20,.96)';
        ctx.strokeStyle=tint.a('.8');ctx.lineWidth=1.3;
        ctx.fillRect(-0.33*s,-0.33*s,0.66*s,0.66*s);
        ctx.strokeRect(-0.33*s,-0.33*s,0.66*s,0.66*s);
        ctx.strokeStyle=tint.dim('.55');ctx.lineWidth=1;
        for(let i=-1;i<=1;i++){
          ctx.beginPath();ctx.moveTo(-0.24*s,i*0.13*s);ctx.lineTo(0.24*s,i*0.13*s);ctx.stroke();
        }
        ctx.restore();
        const k=(T*0.55+q.x*0.07)%1;
        ctx.strokeStyle=tint.a((0.5*(1-k)).toFixed(2));ctx.lineWidth=1.4;
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
        /* 断电安检：所有门在有人等待时显示 2 秒红色扫描（会议室也不再豁免） */
        const scanT=(G.lightState===2)?
          Math.max(0,Math.min(2,d.scanT||0)):0;
        const scanning=scanT>0&&scanT<2;
        const locked=G.lightState===2&&scanT<2;
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
        if(scanning){
          /* 2 秒红色安检扫描：一条亮线沿门板从左扫到右 + 红色脉冲底 */
          const sx=-len/2+len*(scanT/2);
          ctx.save();
          ctx.beginPath();ctx.rect(-len/2,-dep/2,len,dep);ctx.clip();
          ctx.fillStyle='rgba(255,44,34,'+(0.13+0.09*(0.5+0.5*Math.sin(T*18))).toFixed(2)+')';
          ctx.fillRect(-len/2,-dep/2,len,dep);
          const sg=ctx.createLinearGradient(sx-0.12*s,0,sx+0.12*s,0);
          sg.addColorStop(0,'rgba(255,40,30,0)');
          sg.addColorStop(0.5,'rgba(255,96,72,.95)');
          sg.addColorStop(1,'rgba(255,40,30,0)');
          ctx.fillStyle=sg;ctx.fillRect(sx-0.12*s,-dep/2,0.24*s,dep);
          ctx.strokeStyle='rgba(255,150,130,.95)';ctx.lineWidth=1.2;
          ctx.beginPath();ctx.moveTo(sx,-dep/2);ctx.lineTo(sx,dep/2);ctx.stroke();
          ctx.restore();
        }
        /* 顶面高光 + 状态灯：从哪一侧看都一样 */
        ctx.strokeStyle='rgba(200,225,245,.34)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(-len/2,-dep/2+0.5);ctx.lineTo(len/2,-dep/2+0.5);ctx.stroke();
        ctx.fillStyle=locked?'rgba(255,80,64,.98)':
          (open>0.55?'rgba(127,211,240,.95)':'rgba(255,107,97,.95)');
        ctx.beginPath();ctx.arc(len/2-0.08*s,0,Math.max(1.6,0.045*s),0,7);ctx.fill();
        if(locked){
          ctx.strokeStyle='rgba(255,90,70,.85)';ctx.lineWidth=1.2;
          ctx.beginPath();ctx.arc(len/2-0.08*s,0,Math.max(2.4,0.085*s),0,7);ctx.stroke();
        }
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
    /* 全船监控：4×3 实时画面（10 个舱室；底图裁切 + 在场人员点位），断电时整屏雪花 */
    function drawCams(T){
      const c=document.getElementById('camcv');
      if(!c)return;
      const g=c.getContext('2d');
      const W=c.width,H=c.height,pad=8,head=17;
      g.clearRect(0,0,W,H);
      g.fillStyle='#04070B';g.fillRect(0,0,W,H);
      const cols=4, rows=Math.ceil(M.rooms.length/cols);
      const tw=(W-pad*(cols+1))/cols, th=(H-pad*(rows+1))/rows;
      const base=IMG['base'], bReady=ready(base);
      const isc=base&&base.naturalWidth?base.naturalWidth/M.bounds.w:48;
      const cut=G.lightState===2;
      const rooms=M.rooms;
      rooms.forEach((r,n)=>{
        const cx=pad+(n%cols)*(tw+pad), cy=pad+Math.floor(n/cols)*(th+pad);
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
      if(a._doing==='task'||a._doing==='breaker'||a._doing==='fake'){
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
      /* 外观与人类完全一致：异形空闲时不亮刀，只有真实出刀动作才画刀；
         有子弹的人/异形都画同一把枪；空手时都空手。 */
      if(a.alien&&stabAct){
        let ang=dirAng(a);
        if(a.act)ang=a.act.ang+(a.act.t/a.act.dur-0.5)*1.8;
        const hx=x+Math.cos(ang)*0.32*VIEW.s,hy=y+Math.sin(ang)*0.32*VIEW.s-0.20*VIEW.s;
        ctx.save();ctx.lineCap='round';
        ctx.strokeStyle='#E9EDF4';ctx.lineWidth=2.4;
        ctx.beginPath();ctx.moveTo(hx,hy);ctx.lineTo(hx+Math.cos(ang)*0.36*VIEW.s,hy+Math.sin(ang)*0.36*VIEW.s);ctx.stroke();
        ctx.strokeStyle='#8A94A3';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(hx,hy);ctx.lineTo(hx+Math.cos(ang)*0.36*VIEW.s,hy+Math.sin(ang)*0.36*VIEW.s);ctx.stroke();
        ctx.restore();
      }else if(showGun||shootAct){
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
            pill((bot.kind==='secbot'?'保安机器人':'医疗无人机')+(dead?' · 停摆':' · 在线'),
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
      const SHORT={bridge:'会议室',warehouse:'仓库',ecosys:'生态舱',engine:'引擎',power:'配电',transit:'食堂',cam:'监控',med:'医疗',armory:'军械',fun:'娱乐'};
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
      /* 待领申请单：小地图上给圆桌一个金色脉冲，跑图时不用找 */
      if(!G.spectMode&&G.me.qualPending>0){
        const q=roundTableClaimSpot();
        if(q){
          const pu=0.45+0.35*(0.5+0.5*Math.sin(T*5));
          ctx.strokeStyle='rgba(240,198,116,'+pu.toFixed(2)+')';ctx.lineWidth=1.2;
          ctx.beginPath();ctx.arc(x+q.x*k,my+q.y*k,3.4+1.2*Math.sin(T*5),0,7);ctx.stroke();
          ctx.fillStyle='#F0C674';
          ctx.beginPath();ctx.arc(x+q.x*k,my+q.y*k,1.7,0,7);ctx.fill();
        }
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
    /* 亮区：亮舱整间可见；未断电时走廊默认有灯，也整条按亮区处理。
       返回 'r:房id' / 'c:走廊下标'，不属于亮区返回 null。 */
    function litZoneAt(x,y){
      const r=roomAt(x,y);
      if(r)return G.lit[r.id]?'r:'+r.id:null;
      const c=inCorr(x,y);
      if(c&&G.corrLit)return 'c:'+M.corridors.indexOf(c);
      return null;
    }
    function corrJoinsRoom(r,c){return !!(r&&c&&(c.a===r.id||c.b===r.id));}
    function visibleAt(x,y){
      if(G.dev||!G.fogOn||!G.me.alive)return true;
      const me=G.me;
      const r=roomAt(me.x,me.y);
      /* 亮区整片可见：亮舱整间；亮走廊整条（走廊灯默认开着，不看手电朝向）。
         从亮舱看相连走廊仍按视线结算，避免隔着舱壁看见走廊弯后的人。 */
      const mz=litZoneAt(me.x,me.y);
      if(mz){
        const tz=litZoneAt(x,y);
        if(tz===mz)return true;
        if(mz[0]==='r'&&tz&&tz[0]==='c'&&
          corrJoinsRoom(r,M.corridors[+tz.slice(2)])&&losNow(me.x,me.y,x,y))return true;
      }
      const d=Math.hypot(x-me.x,y-me.y);
      /* 自带近身视野：人类 2.8 格，异形 3.11 格，不看朝向 */
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
      /* 未断电时走廊默认有灯：站在亮走廊里整条揭开（与 visibleAt 的亮区规则一致），
         不再只给自己脚下点一盏 4.6 格的小灯。 */
      const meCorr=!r&&G.corrLit?inCorr(me.x,me.y):null;
      if(meCorr){
        o.strokeStyle='#000';o.lineWidth=CW*VIEW.s;o.lineCap='butt';
        o.beginPath();meCorr.pts.forEach((p,i)=>i?o.lineTo(SX(p[0]),SY(p[1])):o.moveTo(SX(p[0]),SY(p[1])));o.stroke();
      }
      /* 视野孔：手电锥（人与异形同款 7 格 / 60°）+ 近身感知圈
         （人类 2.8 格，异形 ×10/9 ≈ 3.11 格）。异形不再有全向远视野。
         站在亮舱/亮走廊里时整片已经揭开，不再叠自己的手电锥——那只会在门口拖出一块
         跟着鼠标转的亮楔形，是噪声不是信息。 */
      const ax=me.x,ay=me.y;
      if(!(r&&G.lit[r.id])&&!meCorr){
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
      }
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
      if(SIM_RUN)return;
      const spectator=!!G.spectMode;
      const pers=document.getElementById('personal');
      if(pers)pers.classList.toggle('hide',spectator);
      document.getElementById('pg').textContent=G.prog;
      const pgmax=document.getElementById('pgmax');
      if(pgmax&&pgmax.textContent!==String(WIN_PTS))pgmax.textContent=WIN_PTS;
      document.getElementById('pgi').style.width=Math.min(100,G.prog/WIN_PTS*100)+'%';
      document.getElementById('tm').textContent=Math.max(0,G.t).toFixed(0);
      document.getElementById('nt').textContent=G.night;
      const alive=G.agents.filter(a=>a.alive).length;
      const hum=G.agents.filter(a=>a.alive&&!a.alien).length;
      const ali=G.agents.filter(a=>a.alive&&a.alien).length;
      document.getElementById('alive').textContent=alive;
      document.getElementById('hum').textContent=hum;
      document.getElementById('ali').textContent=ali;
      /* 濒死人数只在 DEV / 旁观全知时才有值（正常对局看不到谁倒了几个） */
      const dnEl=document.getElementById('dn');
      if(dnEl)dnEl.textContent=(G.dev||G.spectMode)?G.agents.filter(a=>a.downed&&a.alive).length:0;
      document.getElementById('tk').textContent=G.me.tIdx;
      document.getElementById('ql').textContent=G.me.qual;
      const qpEl=document.getElementById('qp');
      if(qpEl)qpEl.textContent=G.me.qualPending||0;
      const qh=document.getElementById('qual-hint');
      if(qh)qh.classList.toggle('hide',!(G.me.qualPending>0));
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
              ?'监控台：E / V / ESC 退出 · 配电室拉闸会切断全部 '+M.rooms.length+' 路信号'
              :(G.sabTarget&&G.me.alien&&!G.me.sabUsed
                ?'破坏目标：'+roomNameById(G.sabTarget.room)+'「'+G.sabTarget.label+'」· 进入舱室自动下手 · 30 秒内可被修复'
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
    document.getElementById('m-send').onclick=()=>sendPlayerSpeech(
      document.getElementById('m-text').value);
    document.getElementById('m-tpl-btns').addEventListener('click',e=>{
      const b=e.target.closest?e.target.closest('button[data-tpl]'):null;
      if(!b)return;
      const m=G.meet; if(!m||m.phase!=='discuss'||G.spectMode)return;
      const ti=+(document.getElementById('m-tpl-target').value);
      const rid=document.getElementById('m-tpl-room').value||
        G.me.nRoom||roomIdAt(G.me.x,G.me.y)||'corridor';
      const text=meetTemplateText(b.dataset.tpl,G.agents[ti],rid);
      if(text)sendPlayerSpeech(text);
    });
    document.getElementById('m-text').addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault(); document.getElementById('m-send').click(); }
      e.stopPropagation();
    });
    document.getElementById('m-skip').onclick=()=>{const m=G.meet;if(!m||m.phase!=='discuss')return;
      if(m.voteT>0) startVote(); else finishMeeting();};
    document.getElementById('e-r').onclick=()=>{newGame();};
    document.getElementById('e-rep').onclick=()=>{
      if(global.SKReplay)global.SKReplay.open(replayData());
    };
    document.getElementById('e-save').onclick=()=>{
      if(global.SKReplay)global.SKReplay.save(replayData());
    };
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
    /* ---------------- 批量模拟（蒙特卡洛） ----------------
       simGame 走真实 update / AI / 会议逻辑，但用 simT 模拟时钟并即时结算会议。
       - 夜会议按 30 秒（25 讨论 + 5 投票）从夜里扣除；白天会议不占夜；
       - 跳过渲染 / HUD / 音效 / 自动不变量，只保留对局逻辑；
       - 每局用 seed 接管 Math.random，便于复现。 */
    function simRng(seed){
      let a=seed>>>0;
      return function(){
        a|=0; a=a+0x6D2B79F5|0;
        let t=Math.imul(a^a>>>15,1|a);
        t=t+Math.imul(t^t>>>7,61|t)^t;
        return ((t^t>>>14)>>>0)/4294967296;
      };
    }
    function simResolveMeeting(){
      const m=G.meet; if(!m)return;
      if(G.simDebug)console.log('SIM meet '+m.kind+' phase='+m.phase+' voteT='+m.voteT);
      if(m.phase==='discuss'&&m.voteT>0){
        startVote();
        if(G.meet){
          closeVote();
          const tal=G.meet?G.meet.tally:null;
          if(tal&&tal.ex&&G.simStats){
            G.simStats.exiles++;
            if(tal.ex.alien)G.simStats.alienExiles++; else G.simStats.humanExiles++;
          }
        }
      }
      if(G.meet)finishMeeting();
    }
    function simGame(opts){
      opts=opts||{};
      const seed=(opts.seed==null?((Math.random()*4294967296)>>>0):(opts.seed>>>0));
      const oldRandom=Math.random, oldSim=SIM_RUN;
      SIM_RUN=true; Math.random=simRng(seed);
      let result;
      try{
        newGame();
        if(G.meet)finishMeeting();          /* 非 ?test 页面的开局会议 */
        if(!G.spectMode){
          G.spectMode=true;G.fogOn=false;
          G.spect={x:49,y:30,path:null,moving:false,dir:'down'};
        }
        G.simMode=true;G.simT=NIGHT;G.t=NIGHT;G.phase=null;G.paused=true;
        G.simStats={meetings:0,knives:0,shots:0,sabotages:0,
          exiles:0,humanExiles:0,alienExiles:0,
          searches:0,loots:0,bulletsLooted:0,medkitsLooted:0,qualsLooted:0,
          humanLoots:0,alienLoots:0,humanShots:0,alienShots:0,
          fakeRepairs:0,fakeTasks:0,alienTasks:0,revives:0,alienLootTries:0,
          alienPipes:0,alienPipePlans:0,
          /* 2026-10-31 新增：医疗无人机救治 / 幽灵任务 / 幽灵修故障 / 人类辩护 / 异形质疑报案 */
          medbotRevives:0,medkitRevives:0,ghostTasks:0,ghostFixes:0,
          humanDefends:0,alienDefends:0,reportDoubts:0,
          /* 每个任务点被完成的次数（label → n）：用来观察「电路维修完成率异常低」
             这类分布问题。2026-10-31 起只统计、不改任何 AI 行为。 */
          tasksByPoint:{}};
        const dt=Math.min(0.2,Math.max(0.05,opts.dt||0.1));
        const maxNights=opts.maxNights||15;
        const maxSteps=opts.maxSteps||Math.ceil(maxNights*NIGHT/dt)+6000;
        G.simDebug=!!opts.debug;
        let steps=0;
        while(!G.over&&G.night<=maxNights&&steps<maxSteps){
          if(G.simDebug)console.log('SIM step '+steps+' t='+(G.t||0).toFixed(2)+
            ' night='+G.night+' meet='+(G.meet?G.meet.kind+':'+G.meet.phase:'-'));
          if(G.meet){simResolveMeeting();steps++;continue;}
          update(dt);steps++;
          if(G.fx.length)G.fx.length=0;
          if(G.waves.length)G.waves.length=0;
          if(G.meet)simResolveMeeting();
        }
        const alive=G.agents.filter(a=>a.alive);
        const humans=alive.filter(a=>!a.alien).length;
        const aliens=alive.filter(a=>a.alien).length;
        const downed=G.agents.filter(a=>a.downed&&a.alive).length;
        result={seed,winner:G.over?(G.overWin?'human':'alien'):'timeout',
          why:G.over?(G.overWhy||''):'timeout',nights:G.night,prog:G.prog,steps,
          humans,aliens,downed,meetings:G.simStats.meetings,knives:G.simStats.knives,
          shots:G.simStats.shots,sabotages:G.simStats.sabotages,
          exiles:G.simStats.exiles,humanExiles:G.simStats.humanExiles,
          alienExiles:G.simStats.alienExiles,
          searches:G.simStats.searches,loots:G.simStats.loots,
          bulletsLooted:G.simStats.bulletsLooted,medkitsLooted:G.simStats.medkitsLooted,
          qualsLooted:G.simStats.qualsLooted,
          humanLoots:G.simStats.humanLoots,alienLoots:G.simStats.alienLoots,
          humanShots:G.simStats.humanShots,alienShots:G.simStats.alienShots,
          fakeRepairs:G.simStats.fakeRepairs,fakeTasks:G.simStats.fakeTasks,
          alienTasks:G.simStats.alienTasks,
          revives:G.simStats.revives,alienLootTries:G.simStats.alienLootTries,
          alienPipes:G.simStats.alienPipes,alienPipePlans:G.simStats.alienPipePlans,
          /* 2026-10-31 新增统计：医疗无人机救治 / 医疗包施救 / 幽灵任务 / 幽灵修故障 /
             人类辩护 / 异形质疑快速报案者 */
          medbotRevives:G.simStats.medbotRevives,medkitRevives:G.simStats.medkitRevives,
          ghostTasks:G.simStats.ghostTasks,ghostFixes:G.simStats.ghostFixes,
          humanDefends:G.simStats.humanDefends,reportDoubts:G.simStats.reportDoubts,
          tasksByPoint:Object.assign({},G.simStats.tasksByPoint)};
      } finally {
        Math.random=oldRandom; SIM_RUN=oldSim;
        if(G){G.simMode=false;G.simDebug=false;G.paused=true;}
      }
      return result;
    }
    global.SKV3._t={
      G:()=>G,
      newGame:()=>newGame(),
      inv:()=>{const r=runInvariants('api');return r?{checks:r.checks,fails:r.fails,all:G.inv.fails}:null;},
      checkWin:()=>checkWin(),
      winPts:()=>WIN_PTS,
      report:()=>{tryReport();return !!G.meet;},
      medbotR:()=>MEDBOT_R,
      medbotHealTime:()=>MEDBOT_HEAL_TIME,
      medbotTouchR:()=>MEDBOT_TOUCH_R,
      medbotHome:()=>medbotHome(),
      stats:()=>Object.assign({},(G&&G.stats)||{}),
      bodyReported:i=>!!G.agents[i]&&bodyReported(G.agents[i]),
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
      witnessesAt:(i,x,y,rad,except)=>{const a=G.agents[i];
        if(!a)return [];
        return watchersAt(a,x,y,rad==null?6:rad,except==null?null:G.agents[except]).map(w=>w.i);},
      gfx:()=>Object.assign({},G.gfx),
      newNight:()=>{startNight(true);return {night:G.night,t:G.t};},
      planReport:(i,body,delay,direct)=>{const a=G.agents[i];if(!a)return null;
        const v=body==null?a._killBody:body;
        if(v==null||!G.agents[v])return null;
        a._reportPlan={body:v,wait:(delay==null?0:delay),spot:null,direct:!!direct};
        a._reportT=0;a._reportBody=null;
        return {body:v,wait:a._reportPlan.wait,direct:!!direct};},
      reportPlan:i=>{const a=G.agents[i];
        return a&&a._reportPlan?{body:a._reportPlan.body,wait:+a._reportPlan.wait.toFixed(1),
          direct:!!a._reportPlan.direct,
          spot:a._reportPlan.spot?[+a._reportPlan.spot[0].toFixed(1),+a._reportPlan.spot[1].toFixed(1)]:null}:null;},
      bodyItems:i=>{const a=G.agents[i];if(!a)return null;
        return {bullet:a.bullet|0,medkit:a.medkit|0,qual:a.qual|0,searched:!!a.searched};},
      /* 门禁隔离用：把某个 AI 的子状态（拖尸/藏尸/管道规划/断电响应）清干净 */
      resetAiState:i=>{const a=G.agents[i];if(!a)return null;
        a.drag=null;a.draggedBy=null;a.redT=0;a._dragSnd=0;a._dragAiT=0;
        a._dragAway=false;a._dragMedD0=0;a._dragAwaySeen={};
        a._hideSpot=null;a._hideRoom=null;a._hideCD=0;a._hides=0;
        a._pipePlan=null;a._pipeSeeks=0;a._secAvoidT=0;a._lightGo=false;a._botCD=0;
        a._killBody=null;a._killAt=0;a._killDecided=true;a._reportPlan=null;
        a._avoid={};a._fleeT=0;a._fleeFrom=null;a._pathCD=0;a._fakeN=0;a._alienTaskN=0;a._stallBias=0.8+Math.random()*0.4;
        a._fakeTaskN=0;a._fakeKind=null;a._alienTaskTotal=0;a._supportGoal=null;a._lootMem={};
        a.mates={};
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
      aiGhostTick:(i,steps,dt)=>{const a=G.agents[i];if(!a)return null;
        for(let n=0;n<(steps||1);n++){doorTick(dt||0.05);aiGhost(a,dt||0.05);}
        return {doing:a.doing,do:a._doing,ghostPts:a.ghostPts||0,tIdx:a.tIdx};},
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
        return {id:r.id,name:r.name,x:c[0],y:c[1],area:r.area,cls:r.cls,doors:r.doors.map(d=>d.slice())};
      }),
      hideRoomFor:(rid,x,y)=>hideRoomFor(rid,x,y),
      points:()=>M.points.map(p=>{
        const f=nearestFree(p.x,p.y);
        return {x:p.x,y:p.y,room:p.room,label:p.label,kind:p.kind,
          d:Math.hypot(f[0]-p.x,f[1]-p.y),free:free(p.x,p.y)};
      }),
      meetCtx:()=>G.meet?{victim:G.meet.ctx.victimInfo,quick:G.meet.ctx.quick||null,
        claims:(G.meet.ctx.claims||[]).map(c=>({who:c.a.name,room:c.room})),
        playerClaims:(G.meet.ctx.playerClaims||[]).map(c=>({target:c.target,kind:c.kind,room:c.room})),
        playerSupport:G.meet.ctx.playerSupport,
        frames:(G.meet.ctx.frames||[]).map(f=>({by:f.by,target:f.target,kind:f.kind,
          room:f.room,ownRoom:f.ownRoom,text:f.text,reaffirm:f.reaffirm||null,
          response:f.response||null,ally:f.ally==null?null:f.ally,allyText:f.allyText||null,
          caught:f.caught?{i:f.caught.i,text:f.caught.text}:null})),
        aiCands:(G.meet.ctx.aiCands||[]).slice(),
        playerSays:(G.meet.ctx.playerSays||[]).map(s=>s.slots),
        playerAccuse:G.meet.ctx.playerAccuse,playerVote:G.meet.ctx.playerVote}:null,
      simGame:opts=>simGame(opts),
      parseSpeech:t=>parseSpeech(t),
      tplText:(kind,target,room)=>meetTemplateText(kind,target==null?null:G.agents[target],room),
      chatterPlan:()=>G.meet&&G.meet.plan?Object.assign({},G.meet.plan):null,
      accuseLineOf:i=>G.agents[i]?(accuseLine(G.agents[i],G.meet)||''):'',
      notice:(i,x,y,rad,kind,victim)=>noticeAction(G.agents[i],x,y,rad,kind,
        victim==null?null:G.agents[victim]),
      fx:()=>G.fx.map(f=>f.type),
      acts:()=>G.agents.map(a=>a.act&&a.act.kind).filter(Boolean),
      roomName:id=>roomNameById(id),
      roomIdAt:(x,y)=>roomIdAt(x,y),
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
      litZone:(x,y)=>litZoneAt(x,y),
      events:()=>(G.events||[]).map(e=>Object.assign({},e)),
      frames:()=>(G.frames||[]).length,
      replay:()=>replayData(),
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
      dmg:()=>G.dmg.map(d=>({room:d.room,x:d.x,y:d.y,label:d.label,left:d.left,dur:d.dur,by:d.by})),
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
      botLabel:kind=>{const f=M.facility.find(q=>q.kind===kind);
        return f?botLabelText(f,kind==='secbot'?!!G.secbotDead:!!G.medbotDead):null;},
      robots:()=>({
        sec:{used:!!G.secbotUsed,uses:G.secbotUses||0,left:SEC_USES_MAX-(G.secbotUses||0),dead:!!G.secbotDead,t:G.secbotT||0,hp:botHp('secbot'),range:SEC_RANGE,arc:SEC_ARC},
        med:{used:!!G.medbotUsed,dead:!!G.medbotDead,t:G.medbotT||0,
          left:G.medbotLeft==null?MEDBOT_CHARGES:G.medbotLeft,hp:botHp('medbot'),
          heal:MEDBOT_HEAL_TIME,touch:MEDBOT_TOUCH_R,target:G.medbotTarget==null?null:G.medbotTarget,
          home:medbotHome()}}),
      bots:()=>{
        const out={};
        for(const k of ['medbot','secbot']){
          const b=G.bots&&G.bots[k];
          const f=M.facility.find(q=>q.kind===k);
          out[k]=b?{x:b.x,y:b.y,wp:b.wp,face:b.face,ang:b.ang,moving:!!b.moving,
            healing:!!b.healing,home:b.home?[b.home[0],b.home[1]]:null,
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
        medLeft:G.medbotLeft==null?MEDBOT_CHARGES:G.medbotLeft,
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
        open:Math.round(d.open*100)/100,target:d.target,
        scanT:+Math.max(0,Math.min(2,d.scanT||0)).toFixed(2),
        scanning:G.lightState===2&&!/:bridge$/.test(d.id)&&(d.scanT||0)>0&&(d.scanT||0)<2,
        locked:G.lightState===2&&!/:bridge$/.test(d.id)&&(d.scanT||0)<2})),
      doorBlock:(x1,y1,x2,y2)=>doorBlockedSegment(x1,y1,x2,y2),
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
          alibi:JSON.parse(JSON.stringify(a.mind.alibi||{})),
          mates:Object.assign({},a.mates||{}),
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
