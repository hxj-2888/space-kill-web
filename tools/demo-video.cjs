/* 演示视频录制：Playwright 录屏 → ffmpeg 转 H.264 mp4 + poster + 作品集缩略图。
 * 用法： node tools/demo-video.cjs
 * 依赖： playwright-core（PLAYWRIGHT_CORE）+ 系统 Edge + ffmpeg（PATH 或 FFMPEG 环境变量）
 * 产出： assets/portfolio/returnlog-demo.mp4   （1280×720 · 静音 · 可循环）
 *        assets/portfolio/returnlog-demo-poster.jpg
 *        assets/portfolio/returnlog-thumb.png  （卡片回退图 · 16:9）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_CORE, 'playwright-core'].filter(Boolean)) {
    try { return require(c); } catch (e) { /* next */ }
  }
  throw new Error('未找到 playwright-core：设置 PLAYWRIGHT_CORE');
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, '..');
const URL = 'file:///' + ROOT.replace(/\\/g, '/') + '/index.html?test';
const OUT = path.join(ROOT, 'assets', 'portfolio');
fs.mkdirSync(OUT, { recursive: true });

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const rawDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-demo-'));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  /* viewport 与录制尺寸必须一致：Playwright 的录制器会按 deviceScaleFactor 缩放，
     1280×720 的视口配 1280×720 的录制会得到 960×540 且顶部被裁，HUD 第一行会缺一块。 */
  const ctx = await browser.newContext({
    viewport: { width: 960, height: 540 },
    recordVideo: { dir: rawDir, size: { width: 960, height: 540 } },
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR ' + e.message));
  const T = (fn, a) => page.evaluate(fn, a);

  await page.goto(URL);
  await page.waitForFunction(() => !!document.getElementById('home-go'), null, { timeout: 30000 });

  /* 1) 开始页：让首页的船图与统计条停留 2.4 秒 */
  await sleep(2400);

  /* 2) 进入对局（人类） */
  await page.click('#home-go');
  await page.waitForFunction(() => window.SKV3 && SKV3._t && SKV3._t.assets().base,
    null, { timeout: 60000 });
  await sleep(1400);
  /* 演示不展示 DEV 全知横栏：?test 开局带调试态，而且 newGame 会把 dev 重置回 keepDev，
     所以必须等对局真正建立之后再关一次 */
  await T(() => { try { SKV3._t.setDev(false); } catch (e) {} });
  await sleep(500);

  /* 3) 医疗间：先走过一段，再让无人机起飞去救人 */
  await T(() => {
    const t = SKV3._t, g = t.G();
    g.paused = false; g.noReport = true;
    t.tp(0, 57, 88);
    g.me.path = [[53, 87]];
  });
  await sleep(1600);
  await T(() => {
    const t = SKV3._t, g = t.G();
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    if (v) {
      t.tp(v.i, 49.2, 82.4);
      v.downed = true; v.downAt = g.t; v.path = null; v.doing = 0; v._doing = null;
    }
    t.tp(0, 52.4, 86.2);
  });
  await sleep(3600);   /* 无人机飞过去 + 3 秒近身治疗 */

  /* 4) 配电室：电闸 2.5D 贴图 + 拉闸提示 */
  await T(() => {
    const t = SKV3._t, g = t.G();
    if (g.lit) g.lit.power = true;
    t.tp(0, 48.4, 55.6);
    g.me.path = [[47.4, 53.6]];
  });
  await sleep(2100);

  /* 5) 监控室：监控台 + 全船监控画面（按 V） */
  await T(() => {
    const t = SKV3._t, g = t.G();
    if (g.lit) g.lit.cam = true;
    t.tp(0, 84, 30.4);   /* 监控台在 (84,29)，要进 1.7 格才能调画面 */
  });
  await sleep(900);
  await page.keyboard.press('v');
  await sleep(2000);
  await page.keyboard.press('v');
  await sleep(700);

  /* 6) 军械库：保安机器人 + 拖尸痕迹 */
  await T(() => {
    const t = SKV3._t, g = t.G();
    if (g.lit) g.lit.armory = true;
    t.tp(0, 82, 71);
    g.me.path = [[85, 73]];
  });
  await sleep(2000);

  /* 7) 会议：拉铃后 AI 开始发言（画面出现发言流） */
  await T(() => {
    const t = SKV3._t, g = t.G();
    const v = g.agents.find(a => !a.alien && a.i !== 0 && a.alive && !a.downed);
    /* 先在玩家脚边放倒一个，再拉铃：report() 要求 2.4 格内有本夜未报过的尸体 */
    if (v) { t.tp(v.i, 84, 73); t.kill(v.i, 'knife'); }
    t.report();
  });
  await sleep(4200);

  /* 8) 收尾：切回对局视角停 1.2 秒 */
  await T(() => { const t = SKV3._t; if (t.G().meet) t.finishMeeting(); });
  await sleep(1200);

  const video = page.video();
  await page.close();
  await ctx.close();
  await browser.close();

  const webm = await video.path();
  console.log('raw video:', webm);

  const mp4 = path.join(OUT, 'returnlog-demo.mp4');
  execFileSync(FFMPEG, ['-y', '-i', webm,
    '-vf', 'scale=1280:720:flags=lanczos,fps=30',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '24',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' });
  console.log('mp4 ->', mp4, (fs.statSync(mp4).size / 1048576).toFixed(1) + ' MB');

  const poster = path.join(OUT, 'returnlog-demo-poster.jpg');
  execFileSync(FFMPEG, ['-y', '-i', mp4, '-ss', '4.2', '-frames:v', '1', '-q:v', '3', poster],
    { stdio: 'inherit' });
  const thumb = path.join(OUT, 'returnlog-thumb.png');
  execFileSync(FFMPEG, ['-y', '-i', mp4, '-ss', '2.0', '-frames:v', '1',
    '-vf', 'scale=960:-1', thumb], { stdio: 'inherit' });
  console.log('poster / thumb 已生成');
  fs.rmSync(rawDir, { recursive: true, force: true });
})();
