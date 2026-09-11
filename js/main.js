/* 入口：单机时钟驱动 + 联机消息驱动 + 音频触发 */
(function (global) {
  const el = id => document.getElementById(id);
  const A = () => global.SKAudio;

  const Game = {
    g: null, mode: 'local', fast: false,
    deadline: 0, commitAt: 0, holdUntil: 0, pendingResolved: false, needFinish: false,
    lastLogLen: 0, endData: null, room: null, netPendingAction: null,
    timer: null,

    /* ---------- 计时信息（UI 用） ---------- */
    timerInfo() {
      if (this.mode === 'net') {
        const t = this.g && this.g.timer;
        return t ? { left: t.left, duration: t.duration, waiting: t.waiting } : null;
      }
      const g = this.g;
      if (!g || !g.pending || this.pendingResolved) return null;
      const dur = g.pending.duration || 0;
      if (!dur) return { left: 0, duration: 0 };
      const prog = global.Engine.decisionProgress(g, Date.now() - (this.streamStart || Date.now()));
      const waiting = (prog.total - prog.ready) + 1;   // +1 = 我自己
      return { left: Math.max(0, (this.deadline - Date.now()) / 1000), duration: dur, waiting };
    },

    /* ---------- 单机 ---------- */
    startLocal(seed, pref) {
      this.mode = 'local'; this.endData = null; this.room = null;
      this.g = global.Setup.createGame(seed, pref);
      global.Engine.begin(this.g);
      this.lastLogLen = 0;
      this.showGame();
      this.afterStep();
      this.holdUntil = Date.now() + 500;
      global.UI.render();
      if (!this.timer) this.timer = setInterval(() => this.tick(), 200);
    },

    showGame() {
      el('screen-start').classList.add('hidden');
      el('screen-room').classList.add('hidden');
      el('screen-over').classList.add('hidden');
      el('screen-game').classList.remove('hidden');
    },

    tick() {
      if (this.mode !== 'local') return;
      const g = this.g;
      if (!g) return;
      if (this.paused) return;                    // v32：暂停 = 冻结整个推进循环
      if (g.over) { this.endData = this.endData || this.collectEnd(g); return; }
      const now = Date.now();
      if (this.fast) { this.holdUntil = 0; this.commitAt = 0; }
      if (this.holdUntil) {
        if (now < this.holdUntil) { global.UI.updateTimer(); return; }
        this.holdUntil = 0;
      }

      /* 已提交，等待「AI 思考」停顿后统一结算（提前提交即跳秒） */
      if (!g.pending && this.needFinish) {
        if (now < this.commitAt) { global.UI.updateTimer(); return; }
        this.needFinish = false;
        global.Engine.finishIfReady(g);
        this.afterStep(); this.audio(g); global.UI.render();
        return;
      }

      if (g.pending) {
        const me = g.players[g.humanId - 1];

        /* 实时讨论：流式发言 + 到点自动收束 + 静默检测跳过（§5.6：30 秒保护期后，
           连续 10 秒无人发言且无人输入 → 跳过剩余讨论；任一活动立即重置计时） */
        if (g.pending.stream) {
          const elapsed = now - (this.streamStart || now);
          const said = global.Engine.streamPump(g, elapsed);
          if (said) this.lastTalkAt = now;
          if (elapsed > 30000 && now - (this.lastTalkAt || now) > 10000) {
            global.Engine.setDecision(g, {});
            global.Engine.finishIfReady(g);
            this.afterStep(); this.audio(g); global.UI.render();
            return;
          }
          if (now >= this.deadline) {
            global.Engine.setDecision(g, {});
            global.Engine.finishIfReady(g);
            this.afterStep(); this.audio(g); global.UI.render();
            return;
          }
          if (said) { A().sfx('notify'); global.UI.render(); }
          else global.UI.updateTimer();
          return;
        }

        if (!this.pendingResolved) {
          if ((me.out && !g.pending.allowOut) || now >= this.deadline) {   // 出局托管（遗言除外）/ 超时弃权
            global.Engine.submit(g, {});
            this.afterStep(); this.audio(g); global.UI.render();
            return;
          }
          global.UI.updateTimer();
          return;
        }
        global.UI.updateTimer();
        return;
      }

      global.Engine.stepOnce(g);
      this.afterStep(); this.audio(g); global.UI.render();
    },

    afterStep() {
      const g = this.g, D = global.SKData;
      this.pendingResolved = false; this.commitAt = 0; this.needFinish = false;
      if (g.stepSkipped) { g.stepSkipped = false; this.holdUntil = 0; A().sfx('notify'); return; }   // 跳过步骤：0 秒推进
      if (g.pending) {
        this.deadline = Date.now() + (g.pending.duration || 0) * 1000;
        this.holdUntil = 0;
        if (g.pending.stream) { this.streamStart = Date.now(); this.lastTalkAt = Date.now(); }
        /* 投票决策用专属音效（vote 素材此前从未接入），其余待决策沿用 notify */
        A().sfx(g.pending.kind === 'vote' ? 'vote' : 'notify');
        return;
      }
      const st = D.STEP_TIME[g.stepDone] || {};
      this.holdUntil = Date.now() + (this.fast ? 0 : (st.auto ? st.auto * 1000 : 350 + Math.random() * 750));
    },

    audio(g) {
      const fresh = g.log.slice(this.lastLogLen);
      this.lastLogLen = g.log.length;
      if (g.over) {
        const me = g.players[g.humanId - 1];
        A().sfx(g.winner === 'draw' ? 'lose' : (me && me.faction === g.winner) ? 'win' : 'lose');
        this.endData = this.endData || this.collectEnd(g);
        return;
      }
      if (fresh.some(e => e.batch === '⑥')) A().sfx('death');
      else if (fresh.some(e => e.batch)) A().sfx('notify');
    },

    collectEnd(g) {
      return {
        replay: g.replay,
        roster: g.players.map(p => ({
          id: p.id, name: p.name, faction: p.faction, role: p.role, roleName: p.roleName,
          out: p.out, outNight: p.outNight, outType: p.outType, cause: p.cause,
        })),
      };
    },

    next() {
      if (this.mode === 'net') { global.Net.send({ t: 'continue' }); return; }
      if (this.holdUntil) { this.holdUntil = 0; this.tick(); }
    },

    /* v32（用户拍板）：单机对局的暂停 / 退出。
       暂停 = 冻结 tick 并把全部时间基准（holdUntil / commitAt / streamStart / lastTalkAt /
       deadline）整体平移暂停时长，恢复后节奏不变；退出 = 停表 + 销毁对局 + 返回主界面。 */
    togglePause() {
      if (this.mode !== 'local' || !this.g || this.g.over) return;
      if (!this.paused) {
        this.paused = true;
        this.pausedAt = Date.now();
      } else {
        const dt = Date.now() - (this.pausedAt || Date.now());
        for (const k of ['holdUntil', 'commitAt', 'streamStart', 'lastTalkAt', 'deadline'])
          if (this[k]) this[k] += dt;
        this.paused = false;
      }
      global.UI.render();
    },

    exitLocal() {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this.g = null;
      this.paused = false;
      this.endData = null;
      this.fast = false;
      el('screen-game').classList.add('hidden');
      el('screen-over').classList.add('hidden');
      el('screen-start').classList.remove('hidden');
    },

    submit(data) {
      if (this.mode === 'net') { global.Net.decision(data); return; }
      const g = this.g;
      if (!g.pending || this.pendingResolved) return;
      global.Engine.setDecision(g, data);
      this.pendingResolved = true;
      this.needFinish = !global.Engine.pendingCount(g);
      /* 提前跳秒：我提交后，等最后一名 AI「提交」即结算（不越过本步窗口） */
      const aiAt = (this.streamStart || Date.now()) + (g.aiSubmitAt || 300);
      this.commitAt = this.fast || !this.needFinish ? 0 : Math.max(Date.now() + 120, Math.min(aiAt, this.deadline || aiAt));
      global.UI.render();
    },

    /* 讨论窗口内实时发言（可选点名指控 / 点名质询） */
    talk(text, accuse, ask) {
      if (this.mode === 'net') { global.Net.send({ t: 'talk', text, accuse }); return; }
      const g = this.g;
      if (!g.pending || !g.pending.stream) return;
      if (global.Engine.talk(g, g.humanId, text, accuse, ask)) {
        this.lastTalkAt = Date.now();               // 发言重置静默检测计时（§5.6）
        A().sfx('submit'); global.UI.render();
      }
    },

    /* 开发者视角：开启后可见各 AI 私有威胁度表与票型（规则上属私有/验票官专属） */
    toggleDev() {
      if (!this.g) return;
      this.g.dev = !this.g.dev;
      if (this.mode === 'net') global.Net.send({ t: 'dev', on: this.g.dev });
      global.UI.render();
    },

    /* 正在输入（未发送）同样重置静默检测计时——「想说的没说完」不应被跳过 */
    markTyping() {
      if (this.mode === 'local' && this.g && this.g.pending && this.g.pending.stream) this.lastTalkAt = Date.now();
    },

    /* ---------- 联机 ---------- */
    connect(action) {
      const addr = el('addr').value.trim();
      const nick = (el('nick').value || '船员').trim() || '船员';
      this.netPendingAction = { action, room: (el('roomid').value || '').trim() };
      global.Net.connect(addr, nick, m => this.onNet(m));
    },

    onNet(m) {
      switch (m.t) {
        case 'hello':
          if (this.netPendingAction) {
            const a = this.netPendingAction;
            global.Net.send(a.action === 'create' ? { t: 'create', name: global.Net.info().name }
                                                  : { t: 'join', name: global.Net.info().name, room: a.room });
          }
          break;
        case 'seat': break;
        case 'room':
          this.room = m;
          if (!m.started) {
            el('screen-game').classList.add('hidden');
            el('screen-over').classList.add('hidden');
            global.UI.renderRoom(m);
          }
          break;
        case 'begin':
          this.mode = 'net'; this.endData = null; this.lastLogLen = 0;
          this.showGame();
          break;
        case 'state':
          if (!m.view) break;
          this.g = global.View.hydrate(m.view);
          this.showGame();
          global.UI.render();
          if (this.g.pending) A().sfx('notify');
          break;
        case 'end':
          this.endData = { replay: m.replay, roster: m.roster };
          if (this.g) { this.g.over = true; global.UI.render(); }
          A().sfx('win');
          break;
        case 'note':
          if (this.g) this.g.log.push({ night: this.g.night, step: this.g.step, batch: null, text: m.msg, kind: 'info', scope: 'all' });
          break;
        case 'err':
          el('room-hint').textContent = m.msg;
          alert(m.msg);
          break;
        case 'closed':
          el('room-hint').textContent = '与服务器断开连接';
          break;
      }
    },
  };

  global.Game = Game;

  document.addEventListener('DOMContentLoaded', () => {
    global.UI.init();

    document.querySelectorAll('.fp').forEach(fp => fp.onclick = () => {
      document.querySelectorAll('.fp').forEach(x => x.classList.remove('active'));
      fp.classList.add('active');
      fp.querySelector('input').checked = true;
      /* v33：选中阵营 → 顶部「本局配置」预览条联动高亮（纯 UI 反馈，读 input value）
         v34 B3：同时在开始页作用域临时切换全局强调色为该阵营色 */
      const inp = fp.querySelector('input');
      const cs = document.querySelector('.config-strip');
      const scr = document.getElementById('screen-start');
      if (inp && cs) cs.dataset.fac = inp.value;
      if (inp && scr) scr.dataset.fac = inp.value;
    });

    el('btn-start').onclick = () => {
      if (el('bgm').checked) { A().ensure(); A().startMusic(); }
      A().sfx('click');
      const seed = (el('seed').value || '').trim() || String(Date.now() % 100000000);
      const n = parseInt(seed, 10);
      const pref = (document.querySelector('input[name=fac]:checked') || {}).value || 'random';
      Game.startLocal(isNaN(n) ? hash(seed) : n, pref);
    };

    el('btn-create').onclick = () => { if (el('bgm').checked) { A().ensure(); A().startMusic(); } Game.connect('create'); };
    el('btn-join').onclick = () => { if (el('bgm').checked) { A().ensure(); A().startMusic(); } Game.connect('join'); };
    el('btn-back').onclick = () => { global.Net.close(); el('screen-room').classList.add('hidden'); el('screen-start').classList.remove('hidden'); };
    el('btn-launch').onclick = () => global.Net.startGame(Date.now() % 100000000);

    el('btn-replay').onclick = () => {
      A().sfx('click');
      el('replay-box').classList.toggle('hidden');
      if (!el('replay-box').classList.contains('hidden')) global.UI.renderReplayBody(Game.g);
    };
    el('btn-again').onclick = () => {
      if (Game.mode === 'net') { global.Net.again(); }
      el('screen-over').classList.add('hidden');
      el('screen-start').classList.remove('hidden');
      const dv = el('btn-dev');
      if (dv) dv.classList.remove('on');
      const ov = document.getElementById('dev-overlay');
      if (ov) ov.classList.add('hidden');
      if (Game.g) Game.g.dev = false;
    };
  });

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
})(typeof window !== 'undefined' ? window : globalThis);
