/* 音频：太空悬疑素材库（CC0 实录/采样音频文件）驱动，替代 v33 之前的 WebAudio 合成器。
   素材来源与许可（见 audio/CREDITS.md）：
     · BGM  music-space-ambience.ogg —— 60 CC0 Sci-Fi SFX（rubberduck，OpenGameArt CC0）
     · SFX  sfx-*.ogg —— 同上 + Kenney Sci-Fi Sounds（Kenney，CC0，经 soundcn 镜像取用）
   对外接口与合成器版本完全一致（SKAudio.{startMusic,sfx,toggle,setVolume,isOn,ensure}），
   调用点零改动；文件缺失时静默降级（play() 的 promise 拒绝被吞掉），不阻塞任何流程。 */
(function (global) {
  const BASE = 'audio/';
  let muted = false, volume = 0.6;
  let music = null, musicReady = false;

  /* 音效音量表（v33b：素材已低通柔化 + loudnorm -20 LUFS，角色增益整体下调约 35%——
     用户反馈合成器替代初版「刺耳」；如嫌轻可整体上调此表，勿改文件） */
  const SFX_GAIN = {
    click: 0.4, submit: 0.5, notify: 0.45, death: 0.65,
    vote: 0.45, win: 0.6, lose: 0.65, tick: 0.3,
  };

  function ensure() {
    /* 兼容旧调用点（合成器时代的音频上下文预热）——文件播放器无需预热，
       但保留函数与用户手势语义：首个 ensure() 时机即解锁自动播放限制。 */
    if (music) return music;
    try {
      music = new Audio(BASE + 'music-space-ambience.ogg');
      music.loop = true;
      music.volume = Math.min(1, 0.5 * volume);
      music.addEventListener('canplaythrough', () => { musicReady = true; });
      music.addEventListener('error', () => { musicReady = false; });
    } catch (e) { music = null; }
    return music;
  }

  function startMusic() {
    const m = ensure();
    if (!m || started()) return;
    m.currentTime = 0;
    const p = m.play();
    if (p && p.catch) p.catch(() => { /* 自动播放被拦：等待下一次用户手势重试 */ });
  }
  function started() { return !!(music && music.currentTime > 0 && !music.paused); }

  /* 音效：按名克隆 Audio 节点——同名短间隔连发（如快速点击）互不打断 */
  const cache = {};
  function sfx(name) {
    if (muted) return;
    const src = BASE + 'sfx-' + name + '.ogg';
    try {
      let base = cache[name];
      if (!base) { base = cache[name] = new Audio(src); base.preload = 'auto'; }
      const node = base.cloneNode();
      node.volume = Math.min(1, (SFX_GAIN[name] != null ? SFX_GAIN[name] : 0.6) * volume / 0.6);
      const p = node.play();
      if (p && p.catch) p.catch(() => { /* 文件缺失 / 自动播放拦截：静默 */ });
    } catch (e) { /* 音频不可用环境：静默 */ }
  }

  function toggle() {
    muted = !muted;
    if (music) { if (muted) music.pause(); else { const p = music.play(); if (p && p.catch) p.catch(() => {}); } }
    return !muted;
  }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (music && !muted) music.volume = Math.min(1, 0.5 * volume);
  }
  function isOn() { return !muted; }

  global.SKAudio = { startMusic, sfx, toggle, setVolume, isOn, ensure };
})(typeof window !== 'undefined' ? window : globalThis);
