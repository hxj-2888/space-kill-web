/* 音频：音效走 CC0 素材库（Kenney / rubberduck），背景音乐为用户提供的录音。
   素材来源与许可（见 audio/CREDITS.md）：
     · BGM  music-bgm.m4a —— 用户提供录音（2026-10-06），替换原 CC0 space ambience
       （〔批次 38〕音乐资源清理：旧 BGM 文件已删除，只留音效＋本 BGM）；
     · SFX  sfx-*.ogg —— Kenney Sci-Fi Sounds + 60 CC0 Sci-Fi SFX（均 CC0）。
   对外接口与合成器版本一致（SKAudio.{startMusic,sfx,toggle,setVolume,isOn,ensure}），
   〔批次 38〕新增 setRate/rate：BGM 播放速度条状连续调节（38b 由循环按钮改为滑杆）；
   文件缺失时静默降级（play() 的 promise 拒绝被吞掉），不阻塞任何流程。 */
(function (global) {
  const BASE = 'audio/';
  let musicOn = true, sfxOn = true, volume = 0.6;
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
      music = new Audio(BASE + 'music-bgm.m4a');
      music.loop = true;
      music.volume = Math.min(1, 0.5 * volume);
      music.playbackRate = rate;
      if ('preservesPitch' in music) music.preservesPitch = true;
      music.addEventListener('canplaythrough', () => { musicReady = true; });
      music.addEventListener('error', () => { musicReady = false; });
    } catch (e) { music = null; }
    return music;
  }

  function startMusic() {
    const m = ensure();
    if (!m || started() || !musicOn) return;   /* 〔41〕音乐闸关闭时不启动 */
    m.currentTime = 0;
    const p = m.play();
    if (p && p.catch) p.catch(() => { /* 自动播放被拦：等待下一次用户手势重试 */ });
  }
  function started() { return !!(music && music.currentTime > 0 && !music.paused); }

  /* 音效：按名克隆 Audio 节点——同名短间隔连发（如快速点击）互不打断 */
  const cache = {};
  function sfx(name) {
    if (!sfxOn) return;                 /* 〔41〕音效闸独立，不再受音乐开关影响 */
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

  /* 〔批次 41〕音乐与音效解耦：此前一个 muted 闸同时管BGM 与 sfx，导致「只想关音乐」
     却把按键音也一起关掉。现在两个独立闸、两个独立 API：
       musicOn / sfxOn —— 各自的开关状态；toggleMusic() / toggleSfx() 各自翻转
       isOn() 保留为「总闸」（两者都开才算开），仅供旧调用点兼容，不新增耦合
     约定：关音乐不动音效；关音效不动音乐。 */
  function toggleMusic() {
    musicOn = !musicOn;
    if (music) {
      if (!musicOn) music.pause();
      else { const p = music.play(); if (p && p.catch) p.catch(() => {}); }
    }
    return musicOn;
  }
  function toggleSfx() { sfxOn = !sfxOn; return sfxOn; }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (music && musicOn) music.volume = Math.min(1, 0.5 * volume);
  }
  function isOn() { return musicOn && sfxOn; }          // 总闸：兼容旧调用点
  function musicEnabled() { return musicOn; }
  function sfxEnabled() { return sfxOn; }

  /* 〔批次 38b〕BGM 播放速度：条状滑杆连续设置（0.5×~2×，钳制后立即生效）；
     preservesPitch 恒真（变速不变调——BGM 是氛围层，变调会破坏音色）。
     音乐未创建时只记档位，ensure() 时套用；rate() 返回当前档位供滑杆回显。 */
  let rate = 1;
  function setRate(v) {
    v = Math.max(0.5, Math.min(2, Number(v) || 1));
    rate = v;
    if (music) music.playbackRate = rate;
    return rate;
  }

  global.SKAudio = {
    startMusic, sfx, setVolume, isOn, ensure, setRate, rate: () => rate,
    /* 分离后的开关 */
    toggleMusic, toggleSfx, musicEnabled, sfxEnabled,
    /* 兼容旧调用点：toggle() 现在只作用于音乐（历史上它同时管两者） */
    toggle: toggleMusic,
  };
})(typeof window !== 'undefined' ? window : globalThis);
