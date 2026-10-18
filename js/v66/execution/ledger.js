/* =============================================================
 * 太空杀 · 发起者记账与有效输出（v1preview1.0 新增 2.8.16 / 4.10.0）
 *
 * 2.8.16 主动行动发起者记账通则【记账类·唯一权威源】：
 *   凡主动行动一律由系统记录其发起者——即实际作出该次行动之玩家（依**真实身份**记：
 *   乔装与死囚变形仅改呈现、不改真实身份；转职为真实职业变化，随变化后之身份记），
 *   连同目标、时点、行动类型与结果一并留痕。本账**仅系统可见**（2.8.7）：不进任何公告
 *   批次、不进任何私人反馈、不向任何玩家公开（含本人）；唯一用途为结算判据与事后追溯。
 *
 * 4.10.0 有效输出∕无效输出【机制类·唯一权威源】：
 *   以「是否造成或协助造成了击杀」为判据，分四档——
 *     致死型：所致死伤害行为致目标濒死，且目标于步骤 9 死亡结算中被确认死亡；
 *     濒死型：致目标濒死而目标活过步骤 9（步骤 8 获救）；
 *     追溯型：击破存续型防护（工匠护甲 4.11∕结茧护盾 5.7）或消耗跨夜稀缺防御资源
              （外星人夜晚免疫 6.4）——目标须于击破∕消耗当夜起 5 夜内死亡方结算；
 *     无效输出：被全额减免层实际拦截而未消耗任何跨夜稀缺资源者（工程师安全室 4.3.1
              之当夜免除——其状态当夜过后自动消失，故不得判有效）。
 *   档位次序恒为 致死型 ＞ 濒死型 ＞ 追溯型；同一发起者对同一目标取最高档、不叠加，
 *   且同一夜至多结算一次（含两刀分别命中之情形）；多名发起者对同一目标各自独立结算。
 *
 * 现行援引者：6.9 外星人逃亡积分（分值表在该条，本模块只判「是否计分、计何种档」）。
 * 未来新增任何以发起者为准之机制（含助攻类）一律援引本账，无须另设记账规则。
 * ============================================================= */
(function (global) {
  const RETRO_WINDOW = 5;          // 4.10.0④/6.9.1③：追溯时限 5 夜
  const MAX_RECORDS = 4000;        // 防御性上限：长局（99 夜）下的账本容量护栏

  /* 发起者的真实身份键（2.8.16②）：死囚的真实身份恒为本体（convict），
     乔装/变形仅改呈现；转职为真实变化，取变化后身份。 */
  function trueRoleOf(p) { return p && p.convict ? 'convict' : (p ? p.role : null); }

  /* 记一笔（攻击）。landed＝未被任何抵挡层与全额减免拦下（落身即记，4.10.6）。 */
  function recordAttack(g, attacker, target, type, res) {
    if (!g.ledger) g.ledger = [];
    if (g.ledger.length < MAX_RECORDS) {
      g.ledger.push({
        kind: 'attack', night: g.night, step: g.step || null,
        by: attacker ? attacker.id : null, byTrue: trueRoleOf(attacker),
        target: target ? target.id : null, type,
        landed: res === 'hit' || res === 'wasted',      // 落身（含对濒死目标的后手攻击）
        causedDying: res === 'hit',
        retro: null, settled: false,
      });
    }
    return g.ledger[g.ledger.length - 1];
  }

  /* 记一笔（延迟类施加：感染/毒药）。4.10.1④：其击杀归属归施加者（真实身份）。 */
  function recordDelayed(g, applier, target, kind, real) {
    if (!g.ledger) g.ledger = [];
    if (g.ledger.length < MAX_RECORDS) {
      g.ledger.push({
        kind, night: g.night, step: g.step || null,
        by: applier ? applier.id : null, byTrue: trueRoleOf(applier),
        target: target ? target.id : null, real: !!real,
        landed: !!real, causedDying: false, retro: null, settled: false,
      });
    }
  }

  /* 记一笔（追溯型候选：击破存续防护 / 消耗夜晚免疫）。
     broken: 'armor' | 'shield' | 'immune' —— 均为跨夜稀缺资源（4.10.0④）。
     安全室的当夜免除**不记**（4.10.0⑥(a)：当夜攻击与否均不影响其状态消失 ⇒ 无效输出）。 */
  function recordRetro(g, attacker, target, broken) {
    if (!g.ledger) g.ledger = [];
    if (g.ledger.length < MAX_RECORDS) {
      g.ledger.push({
        kind: 'retro', night: g.night, step: g.step || null,
        by: attacker ? attacker.id : null, byTrue: trueRoleOf(attacker),
        target: target ? target.id : null, broken,
        landed: false, causedDying: false, retro: broken, settled: false,
      });
    }
  }

  /* 步骤 9 死亡结算后统一收盘：把当夜（及追溯窗内）的记录定档。
     死亡者进 致死型（其濒死由该发起者所致且未获救）；获救者进 濒死型。 */
  function settle(g, diedIds) {
    const L = g.ledger || [];
    const dead = new Set(diedIds);
    for (const e of L) {
      if (e.settled) continue;
      if (e.kind === 'attack') {
        if (e.causedDying) {
          e.settled = true;
          e.cls = dead.has(e.target) ? 'lethal' : 'dying';
        } else if (e.landed) {
          /* 落身但未致死（对已濒死目标的后手攻击）：不计分（4.10.0 已删补刀空集，
             后手不取得击杀归属；本账只为凶手集合与追溯服务，故仅标记不建档）。 */
          e.settled = true; e.cls = 'landed-only';
        } else {
          e.settled = true; e.cls = 'void';
        }
      } else if (e.kind === 'infect' || e.kind === 'poison') {
        /* 延迟类：施加当夜不定档——致死与否看步骤 9（目标是否死亡且死因为该延迟类）。
           假标记（e.real===false）不进计时、不致死 ⇒ 永不定档（只留痕供凶手集合排除）。 */
        if (!e.real) { e.settled = true; e.cls = 'fake'; continue; }
        if (dead.has(e.target)) { e.settled = true; e.cls = 'lethal'; }
        else if (g.night > e.night) { e.settled = true; e.cls = 'dying'; }
      } else if (e.kind === 'retro') {
        /* 追溯型：目标于击破/消耗当夜起 5 夜内死亡方结算；发起者或目标出局即销毁（4.10.0⑤）。 */
        const t = g.players.find(p => p.id === e.target);
        const a = g.players.find(p => p.id === e.by);
        if (dead.has(e.target) && g.night - e.night <= RETRO_WINDOW) {
          e.settled = true; e.cls = 'retro-scored';
        } else if ((t && t.out) || (a && a.out) || g.night - e.night > RETRO_WINDOW) {
          e.settled = true; e.cls = 'retro-void';      // 档案销毁
        }
      }
    }
  }

  /* 目标出局（未死亡）时，挂其名下的未结算追溯档案一并销毁（4.10.0⑤(b)）。 */
  function destroyFor(g, targetId) {
    for (const e of (g.ledger || [])) {
      if (!e.settled && e.kind === 'retro' && e.target === targetId) { e.settled = true; e.cls = 'retro-void'; }
    }
  }

  /* 凶手指集合（4.13.1⑤）：该死者当夜调查报告所列全部**落身**致死来源各自之发起者，去重。
     ——被抵挡而未落身者不入集合；对已濒死目标的后手攻击虽无效果仍属落身，其发起者入集合
     （4.10.2③）；延迟类（感染/毒药）以施加者为发起者，且仅当其确实致死（进调查报告）时入集合。 */
  function killerIds(g, targetId, night) {
    const out = new Set();
    for (const e of (g.ledger || [])) {
      if (e.target !== targetId || e.night !== night) continue;
      if (e.kind === 'attack' && e.landed && e.by != null) out.add(e.by);
      if ((e.kind === 'infect' || e.kind === 'poison') && e.cls === 'lethal' && e.by != null) out.add(e.by);
    }
    return [...out];
  }

  /* 某玩家的当前积分（6.9 判据依 4.10.0；分值表在 6.9.1）——仅外星人（含死囚）消费。 */
  function scoreOf(g, pid) {
    let lethal = 0, dying = 0, retro = 0;
    for (const e of (g.ledger || [])) {
      if (e.by !== pid) continue;
      if (e.cls === 'lethal') {
        /* 6.9.1①：致死型按**目标真实阵营**计——普通船员 1.5；转职者及一切有职业者 2.0；异形 2.5。
           外星人/死囚目标不在此表（同阵营不计分——6.9.1⑧ 自指出手明文排除）。 */
        const t = g.players.find(p => p.id === e.target);
        if (!t) continue;
        const fac = t.faction;
        if (fac === 'xeno') continue;                       // 同阵营不计分
        if (fac === 'alien') lethal += 2.5;
        else lethal += (t.role === 'crew' ? 1.5 : 2.0);     // 转职者及一切有职业者
      } else if (e.cls === 'dying') dying += 1.0;
      else if (e.cls === 'retro-scored') retro += 0.5;
    }
    return { lethal, dying, retro, sum: lethal + dying + retro };
  }

  global.SKLedger = {
    trueRoleOf, recordAttack, recordDelayed, recordRetro, settle, destroyFor, killerIds, scoreOf,
    RETRO_WINDOW,
  };
})(typeof window !== 'undefined' ? window : globalThis);
