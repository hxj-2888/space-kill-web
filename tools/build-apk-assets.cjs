/* 把游戏本体复制进 android/assets/www（APK 的 web 资源）。
 * 用法： node tools/build-apk-assets.cjs
 * 白名单式复制：只带运行时真正会读的文件，v4/tex 下的烘焙源材质（20MB）不打包，
 * 只保留 door-panel.png（门板纹理在运行时会被 drawDoors 采样）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'android', 'assets', 'www');

function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

function copyTree(src, dst, filter) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      const s = path.join(src, name), d = path.join(dst, name);
      if (filter && !filter(s, name, true)) continue;
      n += copyTree(s, d, filter);
    }
    return n;
  }
  if (filter && !filter(src, path.basename(src), false)) return 0;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return 1;
}

rmrf(WWW);
fs.mkdirSync(WWW, { recursive: true });

let count = 0;
/* 1) 入口与脚本 */
for (const f of ['index.html', 'LICENSE', 'README.md']) {
  const s = path.join(ROOT, f);
  if (fs.existsSync(s)) { fs.copyFileSync(s, path.join(WWW, f)); count++; }
}
count += copyTree(path.join(ROOT, 'js'), path.join(WWW, 'js'));
count += copyTree(path.join(ROOT, 'audio'), path.join(WWW, 'audio'));

/* 2) 场景素材：v4/tex 只留 door-panel.png，其余（家具材质源）不进包 */
count += copyTree(path.join(ROOT, 'assets'), path.join(WWW, 'assets'), (full, name, isDir) => {
  if (isDir) return true;
  const rel = path.relative(path.join(ROOT, 'assets'), full).replace(/\\/g, '/');
  if (rel.startsWith('scene/v4/facility/_raw/')) return false;
  if (rel.startsWith('scene/v4/tex/') && rel !== 'scene/v4/tex/door-panel.png') return false;
  if (/\.md$/i.test(rel)) return false;
  return true;
});

function sizeOf(dir) {
  let s = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) s += sizeOf(p); else s += fs.statSync(p).size;
  }
  return s;
}
console.log('[apk] 复制 ' + count + ' 个文件 → ' + WWW);
console.log('[apk] www 体积 ' + (sizeOf(WWW) / 1048576).toFixed(1) + ' MB');
