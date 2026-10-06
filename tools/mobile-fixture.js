module.exports = function () {
  document.querySelectorAll('.screen').forEach(function (s) { s.classList.add('hidden'); });
  var g = document.getElementById('screen-game'); if (g) g.classList.remove('hidden');
  var st = document.getElementById('stage-head'); if (st) st.textContent = '3 夜 · 白天讨论';
  var cd = document.getElementById('hud-cd'); if (cd) cd.textContent = '18';
  var net = document.getElementById('hud-net'); if (net) net.textContent = '3.0';
  var tags = ['船员','船员','神探','异形','船员','工程师','船员','警长','船员','外星人','船员','船员','医生','船员','船员'];
  var r = document.getElementById('roster');
  if (r) for (var i = 1; i <= 15; i++) {
    var e = document.createElement('div'); e.className = 'pl';
    e.innerHTML = '<div class="did">' + i + ' 号</div><div class="name">' + (i <= 2 ? '我' : '') + '</div><div class="tags"><span class="tag">' + tags[i-1] + '</span></div>';
    r.appendChild(e);
  }
  var lines = ['3 号 · 我昨晚查验了 7 号，他是外星人，大家出他。','7 号 · 你胡说，你上一轮就投我，现在又来踩。','11 号 · 我是工程师，昨夜在修 3 号的设备。','我 · 先别急着出人，等神探把查验池摊开。'];
  var c = document.getElementById('chatlog');
  if (c) lines.forEach(function (t) {
    var p = t.split(' · ');
    var s = document.createElement('div'); s.className = 'say';
    s.innerHTML = '<span class="ava">' + p[0].slice(0,1) + '</span><div class="say-main"><div class="who">' + p[0] + '</div>' + p[1] + '</div></div>';
    c.appendChild(s);
  });
  var sb = document.getElementById('stage-body');
  if (sb) sb.innerHTML = '<p style="padding:4px 0;color:#8299bd">白天流程：讨论 → 指认 → 投票。当前讨论中。</p>';
  var tb = document.getElementById('talkbar'); if (tb) tb.classList.remove('hidden');
};