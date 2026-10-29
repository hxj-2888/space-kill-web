/* =============================================================
 * 入口绑定（返航录V1 · 2026-10-29）
 * -------------------------------------------------------------
 * 职责：   绑定开始页角色按钮、填充版本号；游戏本体由 js/game.js 提供 SKV3。
 * 不变量： · 不定义任何全局对象，只通过 data-* 属性与 DOM 协作；
 *          · 必须在 version.js 与 game.js 之后加载；
 *          · 不承担任何游戏逻辑。
 * 依赖：   js/config/version.js、js/game.js
 * ============================================================= */
(function () {
  'use strict';

  function fillVersion() {
    if (!window.SKConfig) return;
    document.querySelectorAll('[data-version]').forEach(function (el) {
      el.textContent = window.SKConfig.version;
    });
  }

  function bindRoles() {
    document.querySelectorAll('[data-role]').forEach(function (el) {
      el.addEventListener('click', function () {
        if (window.SKV3) window.SKV3.start(el.getAttribute('data-role'));
      });
    });
  }

  function boot() {
    fillVersion();
    bindRoles();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
