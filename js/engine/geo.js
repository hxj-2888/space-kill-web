/* =============================================================
 * SKGeo · 几何 / 可行走网格 / A* 寻路 / 视线（返航录V1 · 2026-10-29）
 * -------------------------------------------------------------
 * 职责：   多边形命中、走廊判定、房间查询、可行走网格（含家具软代价）、
 *          A* 寻路、视线遮挡。
 * 不变量： · 只读 SKMapData，不读写对局状态、不读 DOM、不掷随机；
 *          · 网格在脚本加载时一次性烘焙（GS = 0.6 格），运行期零分配；
 *          · 家具是"软代价"不是硬墙（穿过 +2.2，绕路更近时才绕）；
 *          · 船体外不可达：free() 对越界/墙外一律返回 false。
 * 依赖：   js/data/map.js（window.SKMapData）
 * 对外：   window.SKGeo = { CW, GS, GW, GH, inPoly, d2seg, inCorr,
 *            roomAt, free, nearestFree, pathClear, smoothPath,
 *            astar, idx, segX, los, losWalls }
 * ============================================================= */
(function (global) {
  'use strict';

  const M = global.SKMapData;
  if (!M) throw new Error('SKGeo: 缺少 SKMapData，请先加载 js/data/map.js');
  const CW = M.scale.corridor_w;
  const GS = 0.6;
  const GW = Math.ceil(M.bounds.w / GS), GH = Math.ceil(M.bounds.h / GS);

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
    /* 家具不再是硬墙：人物本来就能从家具上走过去，硬堵只会让 A* 绕大圈。
       这里改成「软代价」—— 只有绕路比穿过家具明显更划算时才绕。 */
    const walk=new Uint8Array(GW*GH), soft=new Uint8Array(GW*GH);
    (function build(){
      const cov=M.cover.map(c=>[c.x-.12,c.y-.12,c.x+c.w+.12,c.y+c.h+.12]);
      for(let gy=0;gy<GH;gy++)for(let gx=0;gx<GW;gx++){
        const x=(gx+.5)*GS,y=(gy+.5)*GS; let ok=false;
        for(const r of M.rooms) if(inPoly(x,y,r.poly)){ok=true;break;}
        if(!ok&&inCorr(x,y))ok=true;
        if(ok) for(const c of cov) if(x>c[0]&&x<c[2]&&y>c[1]&&y<c[3]){soft[gy*GW+gx]=1;break;}
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
    
    function pathClear(x1,y1,x2,y2){
      const d=Math.hypot(x2-x1,y2-y1), n=Math.max(2,Math.ceil(d/0.22));
      for(let i=1;i<n;i++){
        const t=i/n;
        if(!free(x1+(x2-x1)*t,y1+(y2-y1)*t))return false;
      }
      return true;
    }
    function smoothPath(out){
      if(!out||out.length<3)return out;
      const res=[out[0]]; let i=0;
      while(i<out.length-1){
        let j=out.length-1;
        for(;j>i+1;j--) if(pathClear(out[i][0],out[i][1],out[j][0],out[j][1]))break;
        res.push(out[j]); i=j;
      }
      return res;
    }
    function astar(sx,sy,tx,ty){
      const s=nearestFree(sx,sy),t=nearestFree(tx,ty);
      let s0=[Math.floor(s[0]/GS),Math.floor(s[1]/GS)],t0=[Math.floor(t[0]/GS),Math.floor(t[1]/GS)];
      if(s0[0]===t0[0]&&s0[1]===t0[1])return[[t[0],t[1]]];
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
          const ng=g[cur]+(dx&&dy?1.414:1)+(soft[ni]?2.2:0);
          if(ng<g[ni]-1e-6){g[ni]=ng;f[ni]=ng+H(ni);prev[ni]=cur;
            if(!inOpen[ni]){open.push(ni);inOpen[ni]=1;}}
        }
      }
      if(prev[gT]<0&&gT!==gS)return null;
      const out=[];let c=gT;
      while(c!==-1&&c!==gS){out.push([(c%GW+.5)*GS,(((c/GW)|0)+.5)*GS]);c=prev[c];}
      out.reverse(); out.push(t);
      return smoothPath(out);
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
    /* 只算墙体：保安机器人坐在安保位家具里，用 los() 会被自己的机位挡住 */
    function losWalls(x1,y1,x2,y2){
      const a=[x1,y1],b=[x2,y2];
      for(const w of M.walls) if(segX(a,b,w[0],w[1]))return false;
      return true;
    }
    
    
  global.SKGeo = Object.freeze({
    CW: CW, GS: GS, GW: GW, GH: GH,
    inPoly: inPoly, d2seg: d2seg, inCorr: inCorr, roomAt: roomAt,
    free: free, nearestFree: nearestFree, pathClear: pathClear,
    smoothPath: smoothPath, astar: astar, idx: idx, segX: segX,
    los: los, losWalls: losWalls,
  });
})(typeof window !== 'undefined' ? window : globalThis);
