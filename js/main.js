/* =============================================================
 * 入口绑定（返航录V3 · 2026-10-29）
 * -------------------------------------------------------------
 * 职责：   绑定开始页角色按钮、填充版本号、托管设置面板（音乐/音效/暂停/退出）；
 *          游戏本体由 js/game.js 提供 SKV3。
 * 不变量： · 不定义游戏状态，只通过 data-* 属性、SKV3 公开 API 与 DOM 协作；
 *          · 必须在 version.js 与 game.js 之后加载；
 *          · 设置只写入 localStorage（sk.settings.v1），不进对局状态。
 * 依赖：   js/config/version.js、js/game.js
 * ============================================================= */
(function () {
  'use strict';

  var KEY = 'sk.settings.v1';
  var DEFAULTS = { music: 0.35, sfx: 0.8 };
  var S = load();

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      return {
        music: typeof raw.music === 'number' ? Math.max(0, Math.min(1, raw.music)) : DEFAULTS.music,
        sfx: typeof raw.sfx === 'number' ? Math.max(0, Math.min(1, raw.sfx)) : DEFAULTS.sfx
      };
    } catch (e) {
      return { music: DEFAULTS.music, sfx: DEFAULTS.sfx };
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }
  function $(id) { return document.getElementById(id); }

  function fillVersion() {
    if (!window.SKConfig) return;
    document.querySelectorAll('[data-version]').forEach(function (el) {
      el.textContent = window.SKConfig.version;
    });
  }

  /* ---------------- 音乐 / 音效 ---------------- */
  function bgmEl() { return $('bgm'); }
  function apply() {
    var bgm = bgmEl();
    if (bgm) bgm.volume = Math.max(0, Math.min(1, S.music * 0.7));
    if (window.SKV3 && SKV3.setSfxVolume) SKV3.setSfxVolume(S.sfx);
  }
  function playBgm() {
    var bgm = bgmEl();
    if (!bgm || S.music <= 0) return;
    try {
      var p = bgm.play();
      if (p && p.catch) p.catch(function () {});
    } catch (e) {}
  }

  function syncSettings() {
    var mm = Math.round(S.music * 100), ss = Math.round(S.sfx * 100);
    var m = $('set-music'), s = $('set-sfx');
    if (m) m.value = mm;
    if (s) s.value = ss;
    if ($('set-music-v')) $('set-music-v').textContent = mm;
    if ($('set-sfx-v')) $('set-sfx-v').textContent = ss;
    var pb = $('set-pause');
    if (pb) {
      var live = !!(window.SKV3 && SKV3.isOpen && SKV3.isOpen());
      pb.style.display = live ? '' : 'none';   /* 只藏「暂停游戏」，别把整排按钮藏掉 */
      pb.textContent = (window.SKV3 && SKV3.isPaused && SKV3.isPaused()) ? '继续游戏' : '暂停游戏';
    }
  }

  function openSettings() {
    var el = $('settings');
    if (el) el.classList.remove('hide');
    syncSettings();
  }
  function closeSettings() {
    var el = $('settings');
    if (el) el.classList.add('hide');
  }
  function settingsOpen() {
    var el = $('settings');
    return !!(el && !el.classList.contains('hide'));
  }

  function bindSettings() {
    var btn = $('btn-settings');
    if (btn) btn.addEventListener('click', function () { playBgm(); openSettings(); });
    var close = $('set-close');
    if (close) close.addEventListener('click', closeSettings);
    var m = $('set-music');
    if (m) m.addEventListener('input', function () {
      S.music = Math.max(0, Math.min(1, (+m.value || 0) / 100));
      $('set-music-v').textContent = Math.round(S.music * 100);
      if (S.music > 0) playBgm();
      apply(); save();
    });
    var s = $('set-sfx');
    if (s) s.addEventListener('input', function () {
      S.sfx = Math.max(0, Math.min(1, (+s.value || 0) / 100));
      $('set-sfx-v').textContent = Math.round(S.sfx * 100);
      apply(); save();
      if (window.SKV3 && SKV3.playSfx) SKV3.playSfx('click');
    });
    var pause = $('set-pause');
    if (pause) pause.addEventListener('click', function () {
      if (window.SKV3 && SKV3.togglePauseGame) SKV3.togglePauseGame();
      syncSettings();
    });
    var exit = $('set-exit');
    if (exit) exit.addEventListener('click', function () {
      if (window.SKV3 && SKV3.isOpen && SKV3.isOpen()) SKV3.stop();
      closeSettings();
      syncSettings();
    });
    var ov = $('settings');
    if (ov) ov.addEventListener('click', function (e) { if (e.target === ov) closeSettings(); });
  }

  /* 身份卡改为"先选后进"：点卡片只切换选中态（主页会同时锚亮船上对应舱室），
     真正的开局走「进入舱段」或双击卡片。卡片没有 #home-go 时（旧页面）保持点一下就开局。 */
  var picked = 'human';

  function selectRole(el) {
    var role = el.getAttribute('data-role');
    if (!role) return;
    picked = role;
    document.querySelectorAll('[data-role]').forEach(function (x) {
      x.classList.toggle('sel', x === el);
    });
  }

  function startRole(role) {
    playBgm();
    if (window.SKV3) window.SKV3.start(role);
    setTimeout(function () { apply(); syncSettings(); }, 0);
  }

  function bindRoles() {
    var hasGo = !!$('home-go');
    document.querySelectorAll('[data-role]').forEach(function (el) {
      el.addEventListener('click', function () {
        selectRole(el);
        if (!hasGo) startRole(el.getAttribute('data-role'));
      });
      el.addEventListener('dblclick', function () {
        startRole(el.getAttribute('data-role'));
      });
    });
    var go = $('home-go');
    if (go) go.addEventListener('click', function () { startRole(picked); });
  }

  function boot() {
    fillVersion();
    bindRoles();
    bindSettings();
    apply();
    // 浏览器要求用户手势后才能播放音频：首次点击页面时尝试启动 BGM
    document.addEventListener('pointerdown', function once() {
      playBgm();
      document.removeEventListener('pointerdown', once);
    });
  }

  window.SKSettings = {
    open: openSettings,
    close: closeSettings,
    isOpen: settingsOpen,
    apply: apply,
    get: function () { return { music: S.music, sfx: S.sfx }; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
