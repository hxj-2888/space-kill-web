const path=require('path'),http=require('http'),fs=require('fs'),os=require('os');
const ROOT=path.join(__dirname,'..');
const OUT=process.argv[2]||path.join(os.tmpdir(),'sk-mobile-shots');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.m4a':'audio/mp4','.ogg':'audio/ogg'};
const DEV=[{n:'iphone14-landscape',w:844,h:390},{n:'iphonese-landscape',w:667,h:375},{n:'iphone14-portrait',w:390,h:844}];
function serve(){const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});return new Promise(k=>s.listen(0,()=>k(s)));}
const FIX=require('./mobile-fixture.js');
(async()=>{const pw=require('playwright-core');
const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
fs.mkdirSync(OUT,{recursive:true});const srv=await serve();const base='http://127.0.0.1:'+srv.address().port;
const br=await pw.chromium.launch(exe?{executablePath:exe}:{});
for(const d of DEV){const c=await br.newContext({viewport:{width:d.w,height:d.h},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const pg=await c.newPage();await pg.goto(base+'/index.html',{waitUntil:'load'});await pg.evaluate(FIX);await pg.waitForTimeout(220);
const f=path.join(OUT,'mobile-'+d.n+'.png');await pg.screenshot({path:f});console.log('shot: '+f);await c.close();}
await br.close();srv.close();})();