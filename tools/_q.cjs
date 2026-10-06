const fs = require('fs');
console.log('==== ui.js 暂停文案 ====');
const U = fs.readFileSync('js/ui.js', 'utf8').split(/\r?\n/);
U.forEach((l, i) => { if (/暂停|继续|btn-pause/.test(l)) console.log((i + 1) + ': ' + l.trim().slice(0, 150)); });
console.log('==== css range/orb 样式 ====');
const C = fs.readFileSync('css/style.css', 'utf8').split(/\r?\n/);
C.forEach((l, i) => { if (/range|orb-bar|\.orb\{|\.orb\b/.test(l)) console.log((i + 1) + ': ' + l.trim().slice(0, 165)); });