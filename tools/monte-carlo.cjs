/* 新返航录 · 蒙特卡洛对局模拟（AI 对 AI，无玩家）
 * ------------------------------------------------------------
 * 用法：node tools/monte-carlo.cjs [--games 1000] [--seed 20261030]
 *        [--dt 0.1] [--max-nights 15] [--out tools/mc-results.json]
 * 依赖：playwright-core（同 test-v3.cjs；可用 PLAYWRIGHT_CORE 指定）
 *
 * 方法：
 * - 浏览器里启动旁观者局，再调用 _t.simGame：真实 update/AI/会议逻辑，
 *   用 simT 模拟时钟、即时会议；跳过渲染/HUD/音效/自动不变量。
 * - 每局用 seed 接管 Math.random，可复现。
 * - 夜会议按 30 秒（25 讨论 + 5 投票）扣夜；白天会议不占夜。
 * - 不模拟玩家自由发言；这是 AI 对 AI 的基准胜率。
 */
const path = require('path');
const fs = require('fs');

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_CORE, 'playwright-core'].filter(Boolean);
  const errors = [];
  for (const c of candidates) {
    try { return require(c); } catch (e) { errors.push(c + ': ' + (e.code || e.message)); }
  }
  throw new Error('未找到 playwright-core。请 npm i -D playwright-core，或设置 PLAYWRIGHT_CORE。\n  ' + errors.join('\n  '));
}

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : def;
}

const { chromium } = loadPlaywright();
const DIR = path.resolve(__dirname, '..');
const URL = 'file:///' + DIR.replace(/\\/g, '/') + '/index.html?test';
const GAMES = Math.max(1, parseInt(arg('games', '1000'), 10) || 1000);
const BASE_SEED = (parseInt(arg('seed', '20261030'), 10) >>> 0);
const DT = Math.max(0.05, Math.min(0.2, parseFloat(arg('dt', '0.1')) || 0.1));
const MAX_NIGHTS = Math.max(1, parseInt(arg('max-nights', '15'), 10) || 15);
const OUT = path.resolve(DIR, arg('out', 'tools/mc-results.json'));
const REPORT = path.resolve(DIR, arg('report', 'tools/mc-report.md'));
const GAME_TIMEOUT = Math.max(1000, parseInt(arg('game-timeout', '20000'), 10) || 20000);
const VERBOSE = process.env.MC_VERBOSE === '1' || arg('verbose', '0') === '1';
const MAX_STEPS = Math.max(0, parseInt(arg('max-steps', '0'), 10) || 0);

function mean(a, key) {
  const xs = a.map(r => +r[key]).filter(Number.isFinite);
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
function median(a, key) {
  const xs = a.map(r => +r[key]).filter(Number.isFinite).sort((x, y) => x - y);
  if (!xs.length) return 0;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}
function pct(n, d) { return d ? +(n / d * 100).toFixed(2) : 0; }

function summarize(results) {
  const n = results.length;
  const by = k => results.filter(r => r.winner === k).length;
  const why = {};
  for (const r of results) why[r.why] = (why[r.why] || 0) + 1;
  const human = by('human'), alien = by('alien'), timeout = by('timeout');
  const p = human / (n || 1);
  /* Wilson 区间：0/1000 时普通二项正态区间会退化成 100~100 */
  const z = 1.96, nz = n || 1;
  const denom = 1 + z * z / nz;
  const center = (p + z * z / (2 * nz)) / denom;
  const half = z * Math.sqrt(p * (1 - p) / nz + z * z / (4 * nz * nz)) / denom;
  const ciLo = Math.max(0, center - half), ciHi = Math.min(1, center + half);
  const keys = ['nights', 'prog', 'steps', 'meetings', 'knives', 'shots', 'sabotages',
    'exiles', 'humanExiles', 'alienExiles', 'searches', 'loots', 'bulletsLooted',
    'medkitsLooted', 'qualsLooted', 'humanLoots', 'alienLoots', 'humanShots',
    'alienShots', 'fakeRepairs', 'fakeTasks', 'alienTasks', 'revives', 'alienPipes',
    'alienPipePlans', 'humans', 'aliens', 'downed'];
  const avg = {}, med = {};
  for (const k of keys) { avg[k] = +mean(results, k).toFixed(3); med[k] = +median(results, k).toFixed(3); }
  return {
    games: n,
    wins: { human, alien, timeout },
    winRate: { human: pct(human, n), alien: pct(alien, n), timeout: pct(timeout, n) },
    humanWin95CI: [+(ciLo * 100).toFixed(2), +(ciHi * 100).toFixed(2)],
    reasons: why,
    avg, median: med,
    perNight: {
      knives: +(avg.knives / Math.max(1, avg.nights)).toFixed(3),
      meetings: +(avg.meetings / Math.max(1, avg.nights)).toFixed(3),
      exiles: +(avg.exiles / Math.max(1, avg.nights)).toFixed(3)
    }
  };
}

function writeOut(results, finished) {
  const payload = {
    meta: {
      generatedAt: new Date().toISOString(),
      games: GAMES, finished, seed: BASE_SEED, dt: DT, maxNights: MAX_NIGHTS,
      mode: 'AI vs AI（旁观者局，无玩家操作）',
      notes: [
        '夜会议按 30 秒扣夜；白天会议不占夜。',
        '讨论台词不逐条播放，会议决策与传闻嫌疑在开会时同步结算。',
        '跳过渲染/HUD/音效/自动不变量；对局逻辑与正式版一致。',
        '统计口径：searches/loots 为搜尸次数与真正取到物资的次数；humanLoots/alienLoots 按阵营拆分；' +
          'alienPipes 为实际钻管道次数，fakeRepairs/fakeTasks 为异形假装维修与假装做任务次数，' +
          'alienTasks 为真做任务次数。'
      ]
    },
    summary: summarize(results),
    results
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  const s = payload.summary;
  const md = [
    '# 新返航录 · 蒙特卡洛对抗报告',
    '',
    '> 生成：' + payload.meta.generatedAt + ' · 局数：' + finished + ' / ' + GAMES +
      ' · seed：' + BASE_SEED + ' · dt：' + DT + ' · 上限：' + MAX_NIGHTS + ' 夜',
    '',
    '## 胜率',
    '',
    '| 阵营 | 胜局 | 胜率 |',
    '|---|---:|---:|',
    '| 人类 | ' + s.wins.human + ' | ' + s.winRate.human + '% |',
    '| 异形 | ' + s.wins.alien + ' | ' + s.winRate.alien + '% |',
    '| 超时未决 | ' + s.wins.timeout + ' | ' + s.winRate.timeout + '% |',
    '',
    '人类胜率 95% Wilson 区间：' + s.humanWin95CI[0] + '% ~ ' + s.humanWin95CI[1] + '%',
    '',
    '## 结束原因',
    '',
    ...Object.keys(s.reasons).sort().map(k => '- ' + k + '：' + s.reasons[k]),
    '',
    '## 每局均值 / 中位数',
    '',
    '| 指标 | 均值 | 中位数 |',
    '|---|---:|---:|',
    ...Object.keys(s.avg).map(k => '| ' + k + ' | ' + s.avg[k] + ' | ' + s.median[k] + ' |'),
    '',
    '## 方法说明',
    '',
    ...payload.meta.notes.map(x => '- ' + x),
    ''
  ];
  fs.writeFileSync(REPORT, md.join('\n'));
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('CONSOLE ' + m.text());
    if (m.type() === 'log' && m.text().startsWith('SIM ')) console.log(m.text());
  });
  await page.goto(URL);
  /* 主页改成"先选身份再进入"：选中旁观者，再点「进入舱段」 */
  await page.click('[data-role="spect"]');
  await page.click('#home-go');
  await page.waitForFunction(() => window.SKV3 && SKV3._t && SKV3._t.assets().base,
    null, { timeout: 30000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    try { SKV3.setSfxVolume(0); } catch (e) {}
    const g = SKV3._t.G(); if (g) g.paused = true;
  });

  const results = [];
  const t0 = Date.now();
  for (let i = 0; i < GAMES; i++) {
    const seed = (BASE_SEED + i) >>> 0;
    const tg = Date.now();
    if (VERBOSE) console.log('START game ' + (i + 1) + ' seed ' + seed);
    const r = await Promise.race([
      page.evaluate(o => SKV3._t.simGame(o), { seed, dt: DT, maxNights: MAX_NIGHTS, maxSteps: MAX_STEPS || undefined, debug: VERBOSE }),
      new Promise((_, rej) => setTimeout(() =>
        rej(new Error('单局超过 ' + GAME_TIMEOUT + 'ms（seed ' + seed + '，game ' + (i + 1) + '）')),
      GAME_TIMEOUT))
    ]);
    if (VERBOSE) console.log('DONE game ' + (i + 1) + ' seed ' + seed + ' ' +
      (Date.now() - tg) + 'ms ' + r.winner + ' ' + r.why);
    results.push(r);
    if ((i + 1) % 25 === 0 || i === GAMES - 1) {
      writeOut(results, i + 1);
      const s = summarize(results);
      const elapsed = (Date.now() - t0) / 1000;
      console.log('[' + (i + 1) + '/' + GAMES + '] ' + elapsed.toFixed(1) + 's · ' +
        '人 ' + s.winRate.human + '% / 异 ' + s.winRate.alien + '% / 超时 ' + s.winRate.timeout +
        '% · ' + (elapsed / (i + 1) * 1000).toFixed(0) + 'ms/局');
    }
  }
  writeOut(results, GAMES);
  const s = summarize(results);
  console.log('\n=== 汇总 ===');
  console.log(JSON.stringify(s, null, 2));
  if (errors.length) console.log('\n控制台错误：\n' + errors.slice(0, 10).join('\n'));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
