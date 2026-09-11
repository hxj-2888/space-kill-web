/* =============================================================
 * 太空杀 · 证据域模块 E10：汇聚层·群体结构事实（首批接线 9 条，universal）
 *
 * 资产出处：总表 v20 E10 汇聚层（81 条 C/F 档群体指纹）。
 * 效用定位：「证群体不证个体」——结构事实进入普适层（universalOf），整体校正
 *   群体威胁基线，不指向任何个体；这正是 E10 的设计载体（普适层饱和 cap25/k60）。
 * 判据全部只读【公开口径】：⑥/⑨/⑩/②/③/④/⑤ 公告批次（g.log）、公开展示的
 *   死亡字段（out/outNight/cause/outType——⑥⑩公开揭示，见总表 C37~C40 判据）、
 *   g.net10 / g._t10Night / voteHistory / 存活数。不读任何私有状态。
 * 批次口径：本批 9 条（C07/C09/C14/C22/C42/C43/C45/C55/C56）为「判据可机械评估」
 *   的首批；C04/C36（死者排除）、C51/C67（配对图结构）等留待后续批。
 * ============================================================= */
(function (global) {
  const P = global.SKPred;

  const infectDeathTonight = g => g.players.some(x => x.out && x.outNight === g.night && x.cause === 'infect');
  const cureAnnounceN = (g, night) => (g.log || []).filter(e => e.batch === '⑫' && e.night === night).length;
  const aliveN = g => g.players.filter(p => !p.out).length;

  /* v33 标定注记（500 局 A/B，本批同日）：结构事实若逐夜重复入账（C14 曾 2,889 次/100 局），
     普适层被反复抬压 ⇒ 人类 32.4% → 30.6%（-1.8pp，方向与 100 局一致）。
     结构事实的正确语义是「知道了就是知道了」——全部改为 once per game（onceChan）。
     改后复跑 500 局验收，若人类仍 <31% 则降档或摘除最高频条目。 */

  const acc = global.SKChanGates = global.SKChanGates || {};
  Object.assign(acc, {
    /* C07（C+）：平票指纹——⑨ 最高票 ≥2 而⑩无人被驱逐 ⇒ 全场分裂，无人达到驱逐线 */
    C07: { expert: 'E10', universal: true, tier: 'C+',
           gate: (g, p) => {
             const round = (g.voteHistory || [])[(g.voteHistory || []).length - 1];
             if (!round || round.night !== g.night) return false;
             const maxVotes = Math.max(0, ...Object.keys(round.src).map(k => round.src[k] || 0));
             const evicted = g.players.some(x => x.out && x.outType === 'vote' && x.outNight === g.night);
             return maxVotes >= 2 && !evicted && P.onceChan(g, p, 'C07');
           } },
    /* C09（C）：警长已死（⑥公开揭示）而之后仍有枪击死亡 ⇒ 必有武装船员在世 */
    C09: { expert: 'E10', universal: true, tier: 'C',
           gate: (g, p) => {
             const sheriffDead = g.players.some(x => x.out && x.role === 'sheriff');
             if (!sheriffDead) return false;
             return g.players.some(x => x.out && x.cause === 'gun' && x.outNight === g.night) && P.onceChan(g, p, 'C09');
           } },
    /* C14（C）：⑫＞0 而无人死于感染 ⇒ 当夜有真标记被清除（医生在行动） */
    C14: { expert: 'E10', universal: true, tier: 'C',
           gate: (g, p) => cureAnnounceN(g, g.night) > 0 && !infectDeathTonight(g) && P.onceChan(g, p, 'C14') },
    /* C22（C+）：连续 3 夜无感染死亡且⑫=0 ⇒ 全场无真标记存在（感染威胁清零期） */
    C22: { expert: 'E10', universal: true, tier: 'C+',
           gate: (g, p) => {
             if (g.night < 3) return false;
             for (let n = g.night - 2; n <= g.night; n++) {
               if (g.players.some(x => x.out && x.outNight === n && x.cause === 'infect')) return false;
               if (cureAnnounceN(g, n) > 0) return false;
             }
             return P.onceChan(g, p, 'C22');
           } },
    /* C42（C）：单夜净破坏量为负（维修量 ＞ 新增破坏）⇒ 场上有正牌工程师在维修 */
    C42: { expert: 'E10', universal: true, tier: 'C',
           gate: (g, p) => g._t10Night != null && g._t10Night < 0 && P.onceChan(g, p, 'C42') },
    /* C43（C+）：净破坏量达 9.0 ⇒ 人类倒计时胜利永久失效（残局规则改写） */
    C43: { expert: 'E10', universal: true, tier: 'C+',
           gate: (g, p) => (g.net10 || 0) >= 90 && P.onceChan(g, p, 'C43') },
    /* C45（C+）：③ 为 0（当夜未发布任何查验公告）⇒ 无查验、无蛰伏、无巡逻 */
    C45: { expert: 'E10', universal: true, tier: 'C+',
           gate: (g, p) => g.night >= 1 && !(g.log || []).some(e => e.batch === '③' && e.night === g.night) && P.onceChan(g, p, 'C45') },
    /* C55（C+）：存活 ≤6 ⇒ 转职资格 + 警长额外子弹 + 外星人双刀觉醒资格同时解锁 */
    C55: { expert: 'E10', universal: true, tier: 'C+',
           gate: (g, p) => aliveN(g) <= 6 && P.onceChan(g, p, 'C55') },
    /* C56（C+）：存活 <5 ⇒ 验票官紧急会议窗口永久失效（验票官威胁度下调的结构依据） */
    C56: { expert: 'E10', universal: true, tier: 'C+',
           gate: (g, p) => aliveN(g) < 5 && P.onceChan(g, p, 'C56') },
  });
})(typeof window !== 'undefined' ? window : globalThis);
