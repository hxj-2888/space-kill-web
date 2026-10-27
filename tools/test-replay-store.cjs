'use strict';
const path=require('path');
const { loadInto, makeCtx } = require(path.join(__dirname,'..','tools','load-order.cjs'));
// 用最小 fake localStorage 在 Node 侧量存档模块的行为
const mem={}; const fakeLS={getItem:k=>k in mem?mem[k]:null,setItem:(k,v)=>{mem[k]=String(v);},removeItem:k=>{delete mem[k];}};
const ctx=makeCtx({ localStorage: fakeLS });
loadInto(ctx, path.join(__dirname,'..','js'), ['replay-store']);
const S=ctx.SKReplayStore;
console.log('模块加载:', !!S, ' MAX =', S && S.MAX);
const mk=(n)=>({night:n,phase:'over',winner:'human',humanId:1,seed:n,
  players:[{id:1,name:'我',faction:'human',out:false}],
  replay:[{night:1,step:'9',scope:'pub',batch:'⑥',text:'局'+n}]});
let fails=0;
function ok(name,cond,extra){console.log((cond?'  √ ':'  × ')+name+(cond?'':'  ['+(extra||'')+']'));if(!cond)fails++;}
ok('初始为空', S.list().length===0);
for(let i=1;i<=4;i++) S.save(mk(i), mk(i).replay);
ok('存 4 局后只留 3 局', S.list().length===3, 'got '+S.list().length);
ok('留下的是最新的 3 局（seed 4/3/2）', JSON.stringify(S.list().map(r=>r.seed))==='[4,3,2]', JSON.stringify(S.list().map(r=>r.seed)));
ok('列表按 savedAt 倒序（最新在最前）', S.list()[0].savedAt >= S.list()[2].savedAt);
ok('存档里带 players 快照（事后上帝视角用）', (S.list()[0].players||[]).length>0);
ok('存档里带 replay 流', Array.isArray(S.list()[0].replay) && S.list()[0].replay.length>0);
const ids=S.list().map(r=>r.id);
ok('按 id 删除一局', (S.remove([ids[1]]), S.list().length===2));
ok('删掉的是指定的那局', !S.list().some(r=>r.id===ids[1]));
ok('可以一次删多局', (S.remove(S.list().map(r=>r.id)), S.list().length===0));
for(let i=1;i<=3;i++) S.save(mk(i), mk(i).replay);
ok('clear() 清空', (S.clear(), S.list().length===0));
mem[S.KEY]='not json';
ok('脏数据不致崩（当空处理）', S.list().length===0);
mem[S.KEY]=JSON.stringify([{noid:1},{id:'x'},{id:'y',replay:[]}]);
ok('缺 id / 缺 replay 的条目被丢弃', S.list().length===1 && S.list()[0].id==='y');
console.log('');
console.log(fails? '有 '+fails+' 条失败' : '全部通过');
process.exitCode = fails?1:0;
