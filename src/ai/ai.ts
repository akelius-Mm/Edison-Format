// Heuristic AI opponent.
import type { CardInstance, EffectDef } from '../engine/card';
import type {
  Action,
  Activation,
  ConfirmRequest,
  OptionRequest,
  PlayerController,
  ResponseRequest,
  SelectRequest,
} from '../engine/controller';
import { Ctx } from '../engine/ctx';
import type { Game } from '../engine/game';
import { Rng } from '../engine/rng';
import type { BattlePos, PlayerId } from '../engine/types';
import { cardValue } from '../cards/helpers';

export type Difficulty = 'easy' | 'normal' | 'hard';

const HARMFUL = new Set(['destroy', 'banish', 'bounce', 'control', 'negate', 'toDeck', 'position']);
const COSTLY = new Set(['discard', 'tribute', 'cost', 'material', 'toGrave']);

export class AIController implements PlayerController {
  readonly isHuman = false;
  private rng: Rng;
  private usage = new Map<string, number>();
  private usageTurn = -1;
  private attackPlan = new Map<number, CardInstance | null>();
  /** Face-down monsters the AI has seen face-up before (uid -> moveId when seen). */
  private seen = new Map<number, number>();

  /** Remember the identity of opponent monsters that were face-up (until they move). */
  private observe(game: Game, p: PlayerId) {
    for (const m of game.monsters(game.opp(p))) if (m.faceUp) this.seen.set(m.uid, m.moveId);
  }
  private knows(c: CardInstance) {
    return this.seen.get(c.uid) === c.moveId;
  }

  constructor(
    public difficulty: Difficulty = 'normal',
    seed = Math.floor(Math.random() * 1e9),
  ) {
    this.rng = new Rng(seed);
  }

  // ------------------------------------------------------------ helpers
  private ctxFor(game: Game, p: PlayerId, act: Activation) {
    const ctx = new Ctx(game, act.card, act.effect, p);
    ctx.effectIndex = act.effectIndex;
    ctx.event = act.event;
    return ctx;
  }

  private bump(game: Game, key: string) {
    if (this.usageTurn !== game.turn) {
      this.usage.clear();
      this.usageTurn = game.turn;
    }
    const n = (this.usage.get(key) ?? 0) + 1;
    this.usage.set(key, n);
    return n;
  }
  private used(game: Game, key: string) {
    if (this.usageTurn !== game.turn) return 0;
    return this.usage.get(key) ?? 0;
  }

  private noise(amount: number) {
    const k = this.difficulty === 'easy' ? 3 : this.difficulty === 'normal' ? 1 : 0.3;
    return (this.rng.next() - 0.5) * amount * k;
  }

  private bestOppAtk(game: Game, p: PlayerId) {
    return Math.max(0, ...game.faceUpMonsters(game.opp(p)).map((m) => (m.pos === 'atk' ? game.getAtk(m) : 0)));
  }

  /** Default activation score when the card has no AI hint. */
  private defaultEffectScore(game: Game, p: PlayerId, act: Activation, ctx: Ctx, window: string): number {
    const ef = act.effect;
    const cats = ef.categories ?? [];
    const opp = game.opp(p);
    if (window === 'main') {
      if (act.card.isTrap) {
        // traps with no event requirement: use them in main phase only if they do something proactive
        if (ef.event) return 0;
        if (cats.includes('specialSummon') || cats.includes('draw') || cats.includes('search')) return 35;
        if (cats.includes('destroy') && game.fieldCards(opp).length) return 30;
        return 0;
      }
      if (cats.includes('draw') || cats.includes('search')) return 55;
      if (cats.includes('specialSummon')) return 50;
      if (cats.includes('destroy') || cats.includes('banish') || cats.includes('toHand') || cats.includes('control')) {
        return game.fieldCards(opp).length ? 45 : 0;
      }
      if (cats.includes('damage')) return 30;
      if (cats.includes('atkChange')) return 0;
      if (cats.includes('lockdown') || cats.includes('protect')) return 15;
      return act.card.isMonster ? 25 : 20;
    }
    // reactive windows
    const top = game.chain[game.chain.length - 1];
    if (window === 'chain' && top && top.player === opp) {
      if (cats.includes('negate')) {
        const tc = top.effect.categories ?? [];
        if (tc.some((c) => ['destroyMulti', 'control', 'specialSummon', 'search', 'draw'].includes(c))) return 55;
        if (top.ctx.targets.some((t) => t.controller === p)) return 55;
        return 0;
      }
    }
    if (ef.event && window !== 'chain') {
      // event-based traps (respond to summon/attack)
      if (cats.includes('destroy') || cats.includes('banish') || cats.includes('negateAttack')) return 45;
      if (cats.includes('damage')) return 40;
      return 30;
    }
    return 0;
  }

  private effectScore(game: Game, p: PlayerId, act: Activation, window: string): number {
    const ctx = this.ctxFor(game, p, act);
    let s: number;
    try {
      s = act.effect.ai?.score ? act.effect.ai.score(ctx) : this.defaultEffectScore(game, p, act, ctx, window);
    } catch (e) {
      s = 0;
    }
    // Save a card that is about to be destroyed / removed by chaining it.
    const top = game.chain[game.chain.length - 1];
    if (top && top.player !== p && act.card.onField && !act.card.faceUp && top.ctx.targets.includes(act.card)) {
      if (s >= 0) s = Math.max(s, 45);
    }
    if (s > 0) s += this.noise(10);
    return s;
  }

  // ------------------------------------------------------------ main
  async chooseAction(game: Game, p: PlayerId, actions: Action[]): Promise<Action> {
    this.observe(game, p);
    let best: Action | null = null;
    let bestScore = -Infinity;
    for (const a of actions) {
      const key = this.actionKey(a);
      const n = this.used(game, key);
      let s = this.scoreAction(game, p, a);
      if (n >= 3) s -= 100;
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }
    if (!best) best = actions[actions.length - 1];
    this.bump(game, this.actionKey(best));
    return best;
  }

  private actionKey(a: Action) {
    switch (a.type) {
      case 'activate':
      case 'proc':
        return `${a.type}:${a.card.uid}:${a.act.effectIndex}`;
      case 'phase':
        return `phase:${a.to}`;
      case 'surrender':
        return 'surrender';
      default:
        return `${a.type}:${a.card.uid}`;
    }
  }

  private scoreAction(game: Game, p: PlayerId, a: Action): number {
    const opp = game.opp(p);
    switch (a.type) {
      case 'phase': {
        if (a.to === 'battle') {
          return this.hasGoodAttack(game, p) ? 8 : -1;
        }
        if (a.to === 'main2') return 2;
        return 1;
      }
      case 'surrender':
        return -1000;
      case 'activate': {
        if (game.phase === 'battle' && !a.act.effect.ai?.score) {
          // In battle phase only use effects that have explicit AI.
          return -5;
        }
        const s = this.effectScore(game, p, a.act, 'main');
        return s > 0 ? s : -5;
      }
      case 'proc': {
        const c = a.card;
        const ctx = this.ctxFor(game, p, a.act);
        if (a.act.effect.ai?.score) return a.act.effect.ai.score(ctx);
        return 70 + (c.data.atk ?? 0) / 100;
      }
      case 'synchro':
        return this.scoreSynchro(game, p, a.card);
      case 'summon':
        return this.scoreSummon(game, p, a.card, false);
      case 'set':
        return this.scoreSummon(game, p, a.card, true);
      case 'flip': {
        const c = a.card;
        const atk = c.data.atk ?? 0;
        if (c.hasType('flip')) return 40;
        return atk > this.bestOppAtk(game, p) && game.phase === 'main1' ? 30 : -1;
      }
      case 'position': {
        const c = a.card;
        const atk = game.getAtk(c);
        const def = game.getDef(c);
        const oppBest = this.bestOppAtk(game, p);
        if (c.pos === 'def') {
          // switch to attack if it can attack well in main1
          if (game.phase === 'main1' && atk > oppBest && atk >= def - 300) return 18;
          return -1;
        }
        if (game.phase === 'main2' && atk < oppBest && def > atk) return 12;
        return -1;
      }
      case 'setST':
        return this.scoreSetST(game, p, a.card);
      case 'attack': {
        const plan = this.planAttack(game, p, a.card);
        if (!plan) return -1;
        this.attackPlan.set(a.card.uid, plan.target);
        return plan.score;
      }
    }
    void opp;
    return 0;
  }

  private scoreSetST(game: Game, p: PlayerId, c: CardInstance): number {
    const free = game.freeSZones(p);
    if (c.isTrap) return free > 1 ? 22 : 12;
    if (c.data.stype === 'quickplay') {
      const ef = c.data.effects?.[0];
      // set quick-plays that are useful on the opponent's turn
      if (ef && (ef.categories ?? []).some((x) => ['position', 'destroy', 'protect', 'negate'].includes(x))) return free > 1 ? 14 : 6;
      return -1;
    }
    if (c.data.stype === 'field') return game.players[p].fzone ? -1 : 5;
    return -1;
  }

  private monsterScoreOnField(game: Game, c: CardInstance) {
    return (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.hasType('effect') ? 200 : 0);
  }

  private scoreSummon(game: Game, p: PlayerId, c: CardInstance, set: boolean): number {
    const atk = c.data.atk ?? 0;
    const def = c.data.def ?? 0;
    const oppBest = this.bestOppAtk(game, p);
    const need = game.tributesNeeded(c);
    let tribLoss = 0;
    if (need > 0) {
      const trib = game
        .tributeCandidates(p, c)
        .map((m) => cardValue(game, m))
        .sort((x, y) => x - y)
        .slice(0, need);
      tribLoss = trib.reduce((x, y) => x + y, 0);
      const gain = this.monsterScoreOnField(game, c) - tribLoss;
      if (gain < 400) return -1;
    }
    const hasSummonTrigger = (c.data.effects ?? []).some(
      (e) => e.kind === 'trigger' && (([] as string[]).concat(e.event ?? [])).some((x) => x === 'normalSummoned' || x === 'summoned' || x === 'tributeSummoned'),
    );
    const isFlip = c.hasType('flip');
    const ai = c.data.aiValue ?? 0;
    if (set) {
      if (isFlip) return 45 + ai / 100;
      if (hasSummonTrigger) return 5;
      if (atk < oppBest && def >= 1200) return 38 + def / 200;
      if (atk < 1200 && def >= atk) return 30;
      return 8;
    }
    if (isFlip) return 5;
    let s = 35 + atk / 100 + ai / 100 + (hasSummonTrigger ? 15 : 0) - tribLoss / 200;
    if (atk < oppBest && !hasSummonTrigger && game.phase === 'main1') s -= 15;
    // keep the tuner for a synchro if there is a non-tuner on board
    return s;
  }

  private scoreSynchro(game: Game, p: PlayerId, syn: CardInstance): number {
    const combos = game.synchroCombos(p, syn);
    if (!combos.length) return -1;
    const matValue = Math.min(...combos.map((cb) => cb.reduce((a, m) => a + cardValue(game, m) * (m.isToken ? 0.3 : 1), 0)));
    const val = (syn.data.atk ?? 0) + (syn.data.aiValue ?? 0) + 800;
    const gain = val - matValue;
    if (gain < 0) return -1;
    return 55 + gain / 100 + this.noise(5);
  }

  private hasGoodAttack(game: Game, p: PlayerId) {
    if (game.turn <= 1) return false;
    for (const c of game.monsters(p)) {
      if (!game.canAttack(c)) continue;
      if (this.planAttack(game, p, c)) return true;
    }
    return false;
  }

  /** Decide the best target for an attacker. */
  private planAttack(game: Game, p: PlayerId, attacker: CardInstance): { target: CardInstance | null; score: number } | null {
    if (!game.canAttack(attacker)) return null;
    const { targets, direct } = game.attackTargets(attacker);
    const atk = game.getAtk(attacker);
    const opp = game.opp(p);
    let best: { target: CardInstance | null; score: number } | null = null;
    const consider = (target: CardInstance | null, score: number) => {
      if (!best || score > best.score) best = { target, score };
    };
    if (direct) consider(null, 60 + atk / 100 + (game.players[opp].lp <= atk ? 500 : 0));
    for (const t of targets) {
      if (!t.faceUp && this.knows(t)) {
        // We saw this monster before it was flipped face-down.
        const td = game.getDef(t);
        if (atk > td) consider(t, 45 + cardValue(game, t) / 100);
        continue;
      }
      if (!t.faceUp) {
        const guess = 1500;
        if (atk >= 1900 || (atk > guess && this.difficulty !== 'easy')) consider(t, 30 + atk / 200);
        else if (this.difficulty === 'easy' && atk >= 1500) consider(t, 20);
        continue;
      }
      const v = cardValue(game, t);
      if (game.queryCard(t, 'indestructibleBattle')) {
        if (t.pos === 'atk' && atk > game.getAtk(t)) consider(t, 20 + (atk - game.getAtk(t)) / 100);
        continue;
      }
      if (t.pos === 'atk') {
        const ta = game.getAtk(t);
        if (atk > ta) consider(t, 50 + v / 100);
        else if (atk === ta && cardValue(game, attacker) < v - 300) consider(t, 25);
      } else {
        const td = game.getDef(t);
        if (atk > td) consider(t, 45 + v / 100);
      }
    }
    if (best && (best as { score: number }).score > 0) {
      // with many set cards behind, slightly less eager
      const sets = game.spellTraps(opp).filter((c) => !c.faceUp).length;
      (best as { score: number }).score -= sets * 2;
      return best;
    }
    return null;
  }

  async chooseAttackTarget(
    game: Game,
    p: PlayerId,
    attacker: CardInstance,
    targets: CardInstance[],
    canDirect: boolean,
  ): Promise<CardInstance | null | 'cancel'> {
    const plan = this.planAttack(game, p, attacker);
    if (plan) {
      if (plan.target === null && canDirect) return null;
      if (plan.target && targets.includes(plan.target)) return plan.target;
    }
    if (canDirect) return null;
    // replay with no good target: cancel unless forced
    if (!targets.length) return 'cancel';
    const winnable = targets.filter((t) => t.faceUp && (t.pos === 'atk' ? game.getAtk(t) < game.getAtk(attacker) : game.getDef(t) < game.getAtk(attacker)));
    if (winnable.length) return winnable[0];
    return 'cancel';
  }

  // ------------------------------------------------------------ responses
  async chooseResponse(game: Game, p: PlayerId, req: ResponseRequest): Promise<Activation | null> {
    this.observe(game, p);
    if (this.difficulty === 'easy' && this.rng.next() < 0.35) return null;
    const window = req.kind;
    let best: Activation | null = null;
    let bestScore = 0;
    for (const o of req.options) {
      // don't use speed-1-ish normal spells here (engine already prevents) and avoid wasting
      const s = this.effectScore(game, p, o, window);
      if (s > bestScore) {
        bestScore = s;
        best = o;
      }
    }
    const threshold = this.difficulty === 'hard' ? 28 : 30;
    if (best && bestScore >= threshold) return best;
    return null;
  }

  async confirmTrigger(game: Game, p: PlayerId, act: Activation): Promise<boolean> {
    if (act.effect.ai?.score) {
      try {
        return act.effect.ai.score(this.ctxFor(game, p, act)) > 0;
      } catch {
        return true;
      }
    }
    return true;
  }

  // ------------------------------------------------------------ selections
  async selectCards(game: Game, p: PlayerId, req: SelectRequest): Promise<CardInstance[]> {
    const harmful = HARMFUL.has(req.purpose);
    const costly = COSTLY.has(req.purpose);
    const handNames = new Set(game.players[p].hand.map((c) => c.name));
    const score = (c: CardInstance): number => {
      if (req.aiScore) return req.aiScore(c);
      const mine = game.cardUser(c) === p;
      const v = cardValue(game, c);
      if (costly) return mine ? -v : v;
      if (harmful || req.purpose === 'target' || req.purpose === 'generic') {
        return mine ? -v - 5000 : v;
      }
      // beneficial for self (search/toHand/specialSummon/buff/equip)
      let s = mine ? v : -v;
      if (req.purpose === 'toHand' && handNames.has(c.name)) s -= 600;
      return s;
    };
    const sorted = [...req.candidates].sort((a, b) => score(b) - score(a));
    let n = req.min;
    if (harmful || req.purpose === 'toHand' || req.purpose === 'specialSummon' || req.purpose === 'buff') {
      // take as many good picks as allowed
      n = req.max;
      if (harmful) {
        const good = sorted.filter((c) => game.cardUser(c) !== p);
        n = Math.max(req.min, Math.min(req.max, good.length));
      }
    }
    if (req.purpose === 'discard' || req.purpose === 'cost' || req.purpose === 'tribute') n = req.min;
    if (n === 0 && req.min === 0 && req.max > 0 && !costly && req.candidates.length) {
      n = score(sorted[0]) > 0 ? 1 : 0;
    }
    return sorted.slice(0, Math.max(req.min, n));
  }

  async chooseOption(game: Game, p: PlayerId, req: OptionRequest): Promise<number> {
    if (req.aiScore) {
      let best = 0;
      let bs = -Infinity;
      req.options.forEach((_, i) => {
        const s = req.aiScore!(i);
        if (s > bs) {
          bs = s;
          best = i;
        }
      });
      return best;
    }
    return 0;
  }

  async confirm(game: Game, p: PlayerId, req: ConfirmRequest): Promise<boolean> {
    return req.aiDefault ?? true;
  }

  async choosePosition(game: Game, p: PlayerId, card: CardInstance, allowed: (BattlePos | 'set')[]): Promise<BattlePos | 'set'> {
    const atk = card.data.atk ?? 0;
    const def = card.data.def ?? 0;
    const oppBest = this.bestOppAtk(game, p);
    let pos: BattlePos = 'atk';
    if (game.turnPlayer !== p) pos = def > atk || atk < oppBest ? 'def' : 'atk';
    else if (atk < oppBest && def > atk) pos = 'def';
    else if (atk === 0 && def > 0) pos = 'def';
    if (!allowed.includes(pos)) return allowed[0];
    return pos;
  }

  async declareCard(game: Game, p: PlayerId, prompt: string, names: string[]): Promise<string> {
    // Prefer a card the opponent has revealed this turn.
    const opp = game.opp(p);
    const known = game.players[opp].hand.filter((c) => c.revealedUntil >= game.turn).map((c) => c.name);
    const hit = names.find((n) => known.includes(n));
    return hit ?? names[this.rng.int(names.length)];
  }
}

export function createAI(difficulty: Difficulty = 'normal', seed?: number) {
  return new AIController(difficulty, seed);
}

export type { EffectDef };
