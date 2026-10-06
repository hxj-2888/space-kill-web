/* =============================================================
 * tools/pkg-field.cjs — 读 package.json 的字段（纯文本输出，无引号无换行）
 *
 * 为什么需要它：android\build.cmd 需要 version / androidVersionCode 两个值，
 * 而在批处理里内嵌 `node -p "require('…\\package.json').version"` 会踩两层坑
 * —— ① 仓库路径含中文/空格，反斜杠要双重转义；② for /f 取到的引号与转义极易错位。
 * 把读取逻辑放进一个 .cjs，批处理只管 for /f 取一行纯文本，版本号从此单一真源。
 *
 * 用法：  node tools\pkg-field.cjs version      →  2.0preview
 *         node tools\pkg-field.cjs androidVersionCode
 * 退出码： 0 = 取到了值；1 = 字段缺失或为空（调用方据此报错，不要静默用默认值）
 * ============================================================= */
'use strict';
const fs = require('fs');
const path = require('path');

const key = process.argv[2] || 'version';
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const val = pkg[key];

if (val === undefined || val === null || val === '') {
  console.error('package.json 缺少字段：' + key);
  process.exit(1);
}
process.stdout.write(String(val));