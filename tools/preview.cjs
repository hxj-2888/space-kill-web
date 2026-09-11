/* 轻量静态预览服务器（no-store，避免开发期缓存） */
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
http.createServer((q, s) => {
  let p = q.url.split('?')[0];
  if (p === '/') p = '/index.html';
  try {
    const d = fs.readFileSync(path.join(root, p));
    s.writeHead(200, {
      'Content-Type': p.endsWith('.css') ? 'text/css'
        : p.endsWith('.js') ? 'text/javascript'
        : p.endsWith('.png') ? 'image/png'
        : p.endsWith('.mp3') ? 'audio/mpeg'
        : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    s.end(d);
  } catch (e) { s.writeHead(404); s.end(); }
}).listen(8091, () => console.log('preview on 8091'));
