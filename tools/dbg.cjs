const fs=require('fs'),path=require('path');
const {makeCtx,loadInto,profiles}=require('./load-order.cjs');
const base=path.join(__dirname,'..','js');
const ctx=makeCtx();
loadInto(ctx,base,profiles.minimal);
const {Setup,Engine}=ctx;
const g=Setup.createGame(900,'random');
Engine.begin(g);
let n=0;
while(!g.over&&n<60){
  Engine.stepOnce(g);
  if(Engine.pendingCount(g)){
    console.log('step',g.step,'pendings',Object.keys(g.pendings),'invites?',typeof g.invites);
    const pid=+Object.keys(g.pendings)[0];
    const ok=Engine.setDecisionFor(g,pid,{targets:[]});
    console.log('  setDecisionFor:',ok,'pendings now',Object.keys(g.pendings),'finishIfReady?',typeof Engine.finishIfReady,'stepDone',g.stepDone);
    Engine.finishIfReady(g);
    console.log('  after finish: stepDone',g.stepDone,'invites?',typeof g.invites,'pairs?',typeof g.pairs);
  }
  n++;
  if(n>12)break;
}
