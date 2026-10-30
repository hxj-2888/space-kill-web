/* =============================================================
 * SKConfig · 版本与项目元信息（返航录V3 · 2026-10-29）
 * -------------------------------------------------------------
 * 职责：   全项目唯一的版本口径：显示名、构建日期、仓库地址。
 * 不变量： · 只读常量（Object.freeze），不读 DOM、不写业务状态；
 *          · 改版本只改这里 + package.json（displayVersion 同步），
 *            并在 CHANGELOG.md 记录；
 *          · 显示版本为「返航录V3」；package.json 的 3.0.0 是语义化镜像。
 * 依赖：   无。
 * 对外：   window.SKConfig
 * ============================================================= */
(function (global) {
  'use strict';

  global.SKConfig = Object.freeze({
    name: '新返航录',
    version: '返航录V3',
    build: '2026-10-30',
    license: 'MIT',
    repos: Object.freeze({
      github: 'https://github.com/hxj-2888/space-kill-web',
      gitee: 'https://gitee.com/hxj-2888/space-kill-web',
    }),
  });
})(typeof window !== 'undefined' ? window : globalThis);
