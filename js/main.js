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
    startLocal(seed, pref, preferRole) {
      this.mode = 'local'; this.endData = null; this.room = null;
      /* 〔42〕接入席位变体（1.1.1「同席位开局定其一」）：此前 createGame 从不收 opts，
         五个席位变体（猎手/毒师/工匠/窃听者/死囚外星人）虽已实装却永不触发。掷骰用独立
         RNG 流（Setup.rollSeatPicks），不消耗 g.rng —— 故组局序列与经典局逐字节同。
         SK_SEAT_CLASSIC=1 可临时退回全经典（对拍用）。
         〔44〕preferRole：首页自选身份。传入后该席位掷骰被钉死到玩家选的变体（A/B 都钉），
         席位数不变；不传时 rollSeatPicks 与 createGame 逐字节同接入前。 */
      const picks = (global.SK_SEAT_CLASSIC === 1) ? null : global.Setup.rollSeatPicks(seed, preferRole);
      this.g = global.Setup.createGame(seed, pref,
        picks ? { seatPicks: picks, preferRole } : undefined);
      this.g.seatPicks = picks || {};      // 供 UI/复盘标注本局席位构成
      /* 自选身份的开局提示：只有「玩家点了却没给到」才说话，给到了就闭嘴。
         走两个通道（生命周期不同，不是重复）：
           · banner —— 立即可见。沿用寂灭/决斗/停转夜横幅的既有约定（g.banner 常驻，
             被后续横幅覆盖）；配置类提示不该藏在「私人」标签里等人去找。
           · priv    —— 永久私人记录，复盘可查。
         必须在 Engine.begin 之后发：begin 会公告批次〇并建立队列，
         插在它前面会让这条提示排在开局公告之前、读起来像上局残留。 */
      global.Engine.begin(this.g);
      if (this.g.roleNote) {
        const me = global.Engine.P(this.g, this.g.humanId);
        global.Engine.banner(this.g, this.g.roleNote);
        global.Engine.priv(this.g, me, this.g.roleNote);
      }
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
        /* K3（B3/2.6.3）：完整回放经唯一发放口 View.replayOf（仅终局后非 null） */
        replay: global.View.replayOf(g),
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

    /* 开发者视角：开启后可见各 AI 私有威胁度表与票型（规则上属私有/验票官专属）。
       〔42〕受全局 ENABLE_DEV 约束（定义与按钮移除见 ui.js）：关闭时此处一并空操作，
       使「手工构造 g.dev=true」也无法让任何 UI 渲染它。 */
    toggleDev() {
      if (!this.g) return;
      const v = global.SK_ENABLE_DEV;
      if (v === 0 || v === false || v === '0' || v === 'false') return;
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
    global.UI.mountRolePicker();          // 〔44〕自选身份面板（角色清单由声明层派生）

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
      /* 〔44〕双向联动的反向：改阵营后，已选身份若不属于该阵营就清空并说明。
         「随机」尤其要注意 —— 随机意味着连阵营都不定，保留一个具体身份偏好会让人
         以为开局一定是那个身份。故随机一律清空。 */
      const want = global.UI.preferredRole();
      if (want) {
        const fac = inp && inp.value;
        const owned = (global.SKRoleDecl.ROLE_DECL[want] || {}).faction;
        if (!fac || fac === 'random' || owned !== fac) {
          global.UI.rpPick(null);
          global.UI.showToast('阵营已改，自选身份「' + ((global.SKData.ROLES[want] || {}).name || want)
            + '」不属于该阵营，已清除身份选择');
        }
      }
    });

    /* 〔2026-10-09〕音乐/音效在**首页**就生效，不必等点「开始 / 创建 / 加入」才响。
       浏览器的自动播放策略要求首次播放必须发生在用户手势里，所以在首页挂一次性监听：
       任意一次指针/触摸/键盘交互即解锁音频并起 BGM（音乐闸关闭时不起，仅解锁）。
       解锁后立刻摘掉监听，不残留。 */
    (function armHomeAudio() {
      var armed = false;
      var EVENTS = ['pointerdown', 'touchstart', 'keydown'];
      function kick() {
        if (armed) return;
        armed = true;
        for (var i = 0; i < EVENTS.length; i++) document.removeEventListener(EVENTS[i], kick);
        try {
          if (A().musicEnabled()) { A().ensure(); A().startMusic(); }
        } catch (e) { /* 音频不可用时静默，不影响对局 */ }
      }
      for (var i = 0; i < EVENTS.length; i++) document.addEventListener(EVENTS[i], kick, { passive: true });
    })();

    el('btn-start').onclick = () => {
      if (A().musicEnabled()) { A().ensure(); A().startMusic(); }
      A().sfx('click');
      const seed = (el('seed').value || '').trim() || String(Date.now() % 100000000);
      const n = parseInt(seed, 10);
      const pref = (document.querySelector('input[name=fac]:checked') || {}).value || 'random';
      /* 〔44〕自选身份（软偏好）。不选时传 null，全链路逐字节同接入前。 */
      Game.startLocal(isNaN(n) ? hash(seed) : n, pref, global.UI.preferredRole());
    };

    el('btn-create').onclick = () => { if (A().musicEnabled()) { A().ensure(); A().startMusic(); } Game.connect('create'); };
    el('btn-join').onclick = () => { if (A().musicEnabled()) { A().ensure(); A().startMusic(); } Game.connect('join'); };
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
