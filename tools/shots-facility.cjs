/* 设施贴图验收截图：四个舱室各拍一张，确认 SDXL 2.5D 贴图真的被画出来。
 * 用法： node tools/shots-facility.cjs
 * 依赖： playwright-core（PLAYWRIGHT_CORE 指向安装目录）+ 系统 Edge
 * 产出： tools/screenshots/facility_{med,armory,power,cam}.png
 */
const path = require('path');
const fs = require('fs');

function loadPlaywright() {
  const c = [process.env.PLAYWRIGHT_CORE, 'playwright-core'].filter(Boolean);
  for (const p of c) { try { return require(p); } catch (e) { /* next */ } }
  throw new Error('未找到 playwright-core：设置 PLAYWRIGHT_CORE');
}
const { chromium } = loadPlaywright();

const DIR = path.resolve(__dirname, '..');
const URL = 'file:///' + DIR.replace(/\\/g, '/') + '/index.html?test';
const OUT = path.join(DIR, 'tools', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

/* 每项：[玩家站位, 需要强制点亮的房间（暗房设施在无手电时看不清）] */
const SPOTS = {
  med: [[55, 88], 'med'],        /* 医疗间中央：医疗无人机 */
  armory: [[83, 73], 'armory'],  /* 军械库：保安机器人 + 拘留区 */
  power: [[48.5, 55.5], 'power'],/* 配电室：电闸（暗房，临时点亮便于验收） */
  cam: [[84, 31.5], 'cam'],      /* 监控室：监控台 */
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await page.goto(URL);
  /* 主页是"先选身份再进入"：必须点「进入舱段」才会创建对局与 SKV3._t */
  await page.click('#home-go');
  await page.waitForFunction(() => window.SKV3 && SKV3._t && SKV3._t.assets,
    null, { timeout: 60000 });
  /* 等设施贴图真正解码完成（file:// 下大图加载有延迟） */
  await page.waitForFunction(() => {
    const imgs = ['assets/scene/v4/facility/medbot.png',
      'assets/scene/v4/facility/secbot.png',
      'assets/scene/v4/facility/monitor.png',
      'assets/scene/v4/facility/breaker.png'];
    return imgs.every(src => {
      const im = new Image(); im.src = src; return im.complete;
    });
  }, null, { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => { SKV3._t.setDev(false); SKV3._t.newGame(); });
  await page.waitForTimeout(1500);
  for (const [k, spec] of Object.entries(SPOTS)) {
    const p = spec[0], room = spec[1];
    await page.evaluate(o => {
      const t = SKV3._t, g = t.G();
      g.paused = false; g.noReport = true;
      /* 验收用：把该舱室点亮，否则暗房里的设施只看得见手电里的一小块 */
      if (g.lit) g.lit[o.room] = true;
      t.tp(0, o.x, o.y);
    }, { x: p[0], y: p[1], room });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, 'facility_' + k + '.png'),
      clip: { x: 360, y: 120, width: 720, height: 560 } });
    console.log('shot facility_' + k + '.png');
  }
  if (errs.length) console.log('页面报错：\n' + errs.join('\n'));
  await browser.close();
})();
