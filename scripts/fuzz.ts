// Large self-play fuzz for the duel engine and card scripts (not part of `npm test`).
//
// Plays thousands of seeded duels: every premade pairing, plus random 40-card decks built from each
// draftable set's playable cards (what Draft / Sealed hand out). Seats are AI (easy / normal / hard)
// or a "chaotic human": a controller that reports isHuman (so human-only card paths run) and picks
// uniformly at random among the legal options, cancels where it may and declines optional triggers.
//
// Every game is checked for:
//   - thrown errors and console.error output
//   - games that never end (turn cap) and runaway turns (decision / animation cap per turn)
//   - prompts offered with no valid choice and no way out
//   - illegal states, checked at every decision: zone overflow or corruption, a card in two places
//     or nowhere, cards not conserved, NaN / negative LP, NaN ATK / DEF / Level, tokens off the
//     field, Extra Deck monsters in the Main Deck or hand, a hand over the limit after the End Phase
//   - replay divergence: a sample of games is replayed from both seats' decision logs and the final
//     board must be identical.
//
// Games run in worker processes; a worker that stops reporting (a synchronous infinite loop) is
// killed and the game is recorded as a hang. Failures are written to --out (default
// fuzz-out/) as JSON with the seed, decks, seats and both decision logs. Reproduce one game with
//   npx tsx scripts/fuzz.ts --seed S --only I [--verbose]
//
// Usage: npx tsx scripts/fuzz.ts [--games N] [--seed S] [--workers W] [--mode mixed|premade|draft]
//                                [--chaos P] [--replay-every K] [--max-turns T] [--out DIR]
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AIController, aiDebug, type Difficulty } from '../src/ai/ai';
import { findCard } from '../src/cards';
import { playableSet } from '../src/collection/catalog';
import { PREMADE_DECKS, buildDeckList } from '../src/decks';
import { draftPool } from '../src/draft/cards';
import type { CardData, CardInstance } from '../src/engine/card';
import type { Action, Activation, ConfirmRequest, OptionRequest, PlayerController, ResponseRequest, SelectRequest } from '../src/engine/controller';
import { Game, GameOver, type DeckList } from '../src/engine/game';
import { RecordingController, type Decision } from '../src/engine/replay';
import { Rng } from '../src/engine/rng';
import type { BattlePos, PlayerId } from '../src/engine/types';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const GAMES = Number(arg('games', '200'));
const SEED = Number(arg('seed', '1'));
const MODE = arg('mode', 'mixed') as 'mixed' | 'premade' | 'draft' | 'pool';
const CHAOS = Number(arg('chaos', '0.4'));
const REPLAY_EVERY = Number(arg('replay-every', '8'));
const MAX_TURNS = Number(arg('max-turns', '200'));
const OUT = arg('out', 'fuzz-out')!;
const ONLY = arg('only');
const VERBOSE = args.includes('--verbose');
const WORKER = args.includes('--worker');
const COVERAGE = args.includes('--coverage');
const WORKERS = Number(arg('workers', String(Math.max(1, cpus().length))));
/** Decisions in one turn before the turn counts as runaway. */
const DECISION_CAP = 3000;
/** Animation events in one turn before the turn counts as runaway (a loop that asks nothing). */
const ANIM_CAP = 40000;

export const DRAFT_CODES = ['TDGS', 'CSOC', 'GLAS', 'PTDN', 'LODT', 'CRMS', 'RGBT', 'ANPR', 'SOVR', 'ABPF', 'HA01'];

// ------------------------------------------------------------------ job generation

type Seat = Difficulty | 'chaos';
interface Job {
  index: number;
  seed: number;
  kind: 'premade' | 'draft' | 'pool';
  skipFirstDraw: boolean;
  label: [string, string];
  decks: [DeckList, DeckList];
  seats: [Seat, Seat];
}

function hash(n: number) {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

function randomSetDeck(code: string, rng: Rng): { list: DeckList; names: string[] } {
  const set = playableSet(code);
  const cards = code === 'POOL' ? draftPool() : (set?.playable ?? []).map((n) => findCard(n)).filter((c): c is CardData => !!c && !c.isToken);
  const isExtra = (c: CardData) => !!(c.mtypes?.includes('fusion') || c.mtypes?.includes('synchro'));
  const mains = cards.filter((c) => !isExtra(c));
  const extras = cards.filter(isExtra);
  const main: CardData[] = [];
  const count = new Map<string, number>();
  let guard = 0;
  while (main.length < 40 && mains.length && guard++ < 10000) {
    const c = rng.pick(mains);
    const n = count.get(c.name) ?? 0;
    if (n >= 3) continue;
    count.set(c.name, n + 1);
    main.push(c);
  }
  const extra: CardData[] = [];
  for (const c of rng.shuffle([...extras])) {
    if (extra.length >= 15) break;
    extra.push(c);
    if (extra.length < 15 && rng.next() < 0.5) extra.push(c);
  }
  return { list: { main, extra }, names: [...main, ...extra].map((c) => c.name) };
}

export function makeJob(seed0: number, index: number): Job {
  const seed = seed0 * 100003 + index;
  const rng = new Rng(hash(seed) || 1);
  // mixed: half premade pairings, a third random decks from one draft set, a sixth from the whole Edison Pack pool
  const kind: Job['kind'] = MODE !== 'mixed' ? MODE : index % 6 === 5 ? 'pool' : index % 3 === 2 ? 'draft' : 'premade';
  let decks: [DeckList, DeckList];
  let label: [string, string];
  if (kind === 'premade') {
    const n = PREMADE_DECKS.length;
    const k = Math.floor(index / (MODE === 'premade' ? 1 : 1)) + seed0 * 7;
    const a = PREMADE_DECKS[k % n];
    const b = PREMADE_DECKS[(Math.floor(k / n) + k) % n];
    decks = [buildDeckList(a), buildDeckList(b)];
    label = [a.id, b.id];
  } else if (kind === 'pool') {
    decks = [randomSetDeck('POOL', rng).list, randomSetDeck('POOL', rng).list];
    label = ['pool', 'pool'];
  } else {
    const ca = DRAFT_CODES[index % DRAFT_CODES.length];
    const cb = rng.next() < 0.75 ? ca : rng.pick(DRAFT_CODES);
    decks = [randomSetDeck(ca, rng).list, randomSetDeck(cb, rng).list];
    label = [`draft:${ca}`, `draft:${cb}`];
  }
  const diff = (): Difficulty => rng.pick(['easy', 'normal', 'hard'] as Difficulty[]);
  const r = rng.next();
  let seats: [Seat, Seat];
  if (r < CHAOS * 0.12) seats = ['chaos', 'chaos'];
  else if (r < CHAOS) seats = rng.next() < 0.5 ? ['chaos', diff()] : [diff(), 'chaos'];
  else seats = [diff(), diff()];
  return { index, seed, kind, label, decks, seats, skipFirstDraw: rng.next() < 0.5 };
}

// ------------------------------------------------------------------ chaotic human

class ChaosHuman implements PlayerController {
  readonly isHuman = true;
  rng: Rng;
  constructor(seed: number) {
    this.rng = new Rng(seed);
  }
  async chooseAction(_g: Game, _p: PlayerId, actions: Action[]) {
    return this.rng.pick(actions);
  }
  async chooseResponse(_g: Game, _p: PlayerId, req: ResponseRequest) {
    if (!req.options.length || this.rng.next() < 0.5) return null;
    return this.rng.pick(req.options);
  }
  async selectCards(_g: Game, _p: PlayerId, req: SelectRequest) {
    if (req.cancelable && this.rng.next() < 0.2) return [];
    const lo = Math.min(req.min, req.candidates.length);
    const hi = Math.min(req.max, req.candidates.length);
    const k = lo + this.rng.int(hi - lo + 1);
    return this.rng.shuffle([...req.candidates]).slice(0, k);
  }
  async chooseOption(_g: Game, _p: PlayerId, req: OptionRequest) {
    return this.rng.int(req.options.length);
  }
  async confirm(_g: Game, _p: PlayerId, _r: ConfirmRequest) {
    return this.rng.next() < 0.5;
  }
  async choosePosition(_g: Game, _p: PlayerId, _c: CardInstance, allowed: (BattlePos | 'set')[]) {
    return this.rng.pick(allowed);
  }
  async chooseAttackTarget(_g: Game, _p: PlayerId, _a: CardInstance, targets: CardInstance[], canDirect: boolean) {
    const opts: (CardInstance | null | 'cancel')[] = [...targets];
    if (canDirect) opts.push(null);
    if (!opts.length || this.rng.next() < 0.12) return 'cancel' as const;
    return this.rng.pick(opts);
  }
  async confirmTrigger() {
    return this.rng.next() < 0.6;
  }
  async declareCard(_g: Game, _p: PlayerId, _prompt: string, names: string[]) {
    return this.rng.pick(names);
  }
}

/** Refuses every live request: a full replay must be answered from the log. */
class NoLive implements PlayerController {
  constructor(readonly isHuman: boolean) {}
  private no<T>(): Promise<T> {
    return Promise.reject(new Error('live decision requested during replay'));
  }
  chooseAction() {
    return this.no<Action>();
  }
  chooseResponse() {
    return this.no<Activation | null>();
  }
  selectCards() {
    return this.no<CardInstance[]>();
  }
  chooseOption() {
    return this.no<number>();
  }
  confirm() {
    return this.no<boolean>();
  }
  choosePosition() {
    return this.no<BattlePos | 'set'>();
  }
  chooseAttackTarget() {
    return this.no<CardInstance | null | 'cancel'>();
  }
  confirmTrigger() {
    return this.no<boolean>();
  }
  declareCard() {
    return this.no<string>();
  }
}

// ------------------------------------------------------------------ invariants

class FuzzAbort extends Error {}

/** Per game coverage: effect key "Card Name#i" → [times offered, times activated, times chosen by a controller]. */
let cov = new Map<string, [number, number, number]>();
const covKey = (c: CardInstance, i: number) => `${c.name}#${i}`;
const covBump = (k: string, slot: 0 | 1 | 2) => {
  const v = cov.get(k) ?? [0, 0, 0];
  v[slot]++;
  cov.set(k, v);
};

interface Failure {
  type: string;
  detail: string;
  turn: number;
  phase: string;
}

class Checker {
  failures: Failure[] = [];
  private seen = new Set<string>();
  decisionsThisTurn = 0;
  animsThisTurn = 0;
  private lastTurn = -1;
  ownedTotals: [number, number] = [0, 0];
  constructor(public g: Game) {
    for (const c of g.allCards) if (!c.isToken) this.ownedTotals[c.owner]++;
  }

  fail(type: string, detail: string) {
    const key = `${type}|${detail}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.failures.push({ type, detail, turn: this.g.turn, phase: this.g.phase });
  }

  tick(kind: 'decision' | 'anim') {
    const g = this.g;
    if (g.turn !== this.lastTurn) {
      this.lastTurn = g.turn;
      this.decisionsThisTurn = 0;
      this.animsThisTurn = 0;
    }
    if (kind === 'decision' && ++this.decisionsThisTurn > DECISION_CAP) {
      this.fail('runaway-turn', `more than ${DECISION_CAP} decisions in turn ${g.turn}`);
      throw new FuzzAbort('decision cap');
    }
    if (kind === 'anim' && ++this.animsThisTurn > ANIM_CAP) {
      this.fail('runaway-turn', `more than ${ANIM_CAP} animation events in turn ${g.turn}`);
      throw new FuzzAbort('anim cap');
    }
  }

  check(where: string) {
    const g = this.g;
    const where_ = ` [${where}]`;
    const occ = new Map<CardInstance, string[]>();
    const add = (c: CardInstance | null, place: string) => {
      if (!c) return;
      const a = occ.get(c) ?? [];
      a.push(place);
      occ.set(c, a);
    };
    for (const p of [0, 1] as PlayerId[]) {
      const ps = g.players[p];
      if (!Number.isFinite(ps.lp)) this.fail('bad-lp', `player ${p} LP is ${ps.lp}`);
      else if (ps.lp < 0) this.fail('bad-lp', `player ${p} LP is negative (${ps.lp})`);
      if (ps.mzone.length !== 5) this.fail('zone-overflow', `player ${p} has ${ps.mzone.length} Monster Zones`);
      if (ps.szone.length !== 5) this.fail('zone-overflow', `player ${p} has ${ps.szone.length} Spell/Trap Zones`);
      for (const k of ['deck', 'hand', 'grave', 'banished', 'extra'] as const) {
        for (const c of ps[k]) {
          add(c, `${p}.${k}`);
          if (c.location !== k) this.fail('location-mismatch', `${c.name} is in ${p}.${k} but location=${c.location}${where_}`);
          if (c.owner !== p) this.fail('wrong-owner-pile', `${c.name} (owner ${c.owner}) is in player ${p}'s ${k}${where_}`);
          if (c.isToken) this.fail('token-off-field', `token ${c.name} is in ${k}${where_}`);
          if ((k === 'deck' || k === 'hand') && c.isExtra) this.fail('extra-in-main', `${c.name} is in ${k}${where_}`);
          if (k === 'extra' && !c.isExtra) this.fail('main-in-extra', `${c.name} is in the Extra Deck${where_}`);
        }
      }
      ps.mzone.forEach((c, i) => {
        if (!c) return;
        add(c, `${p}.mzone${i}`);
        if (c.location !== 'mzone') this.fail('location-mismatch', `${c.name} is in mzone but location=${c.location}${where_}`);
        if (c.controller !== p) this.fail('controller-mismatch', `${c.name} in player ${p}'s mzone has controller ${c.controller}${where_}`);
        if (c.seq !== i) this.fail('seq-mismatch', `${c.name} in mzone ${i} has seq ${c.seq}${where_}`);
        if (!c.isMonster) this.fail('non-monster-in-mzone', `${c.name} is in a Monster Zone${where_}`);
        if (c.faceUp) {
          const atk = g.getAtk(c);
          const def = g.getDef(c);
          if (!Number.isFinite(atk)) this.fail('nan-stat', `${c.name} ATK is ${atk}${where_}`);
          if (!Number.isFinite(def)) this.fail('nan-stat', `${c.name} DEF is ${def}${where_}`);
          if (atk < 0 || def < 0) this.fail('negative-stat', `${c.name} ATK/DEF ${atk}/${def}${where_}`);
          const lv = g.getLevel(c);
          if (!Number.isFinite(lv)) this.fail('nan-stat', `${c.name} Level is ${lv}${where_}`);
        }
      });
      ps.szone.forEach((c, i) => {
        if (!c) return;
        add(c, `${p}.szone${i}`);
        if (c.location !== 'szone') this.fail('location-mismatch', `${c.name} is in szone but location=${c.location}${where_}`);
        if (c.controller !== p) this.fail('controller-mismatch', `${c.name} in player ${p}'s szone has controller ${c.controller}${where_}`);
        if (c.seq !== i) this.fail('seq-mismatch', `${c.name} in szone ${i} has seq ${c.seq}${where_}`);
      });
      if (ps.fzone) {
        add(ps.fzone, `${p}.fzone`);
        if (ps.fzone.location !== 'fzone') this.fail('location-mismatch', `${ps.fzone.name} is in fzone but location=${ps.fzone.location}${where_}`);
        if (ps.fzone.data.stype !== 'field') this.fail('non-field-in-fzone', `${ps.fzone.name} is in the Field Zone${where_}`);
      }
    }
    // Semantic checks, only at a settled moment (no chain building / resolving).
    if (!g.chain.length && !g.resolvingChain && !g.over && where !== 'end') {
      for (const p of [0, 1] as PlayerId[]) {
        const ps = g.players[p];
        if (ps.lp <= 0) this.fail('lp-zero-continues', `player ${p} has ${ps.lp} LP but the duel goes on${where_}`);
        if (ps.normalSummonsLeft < 0) this.fail('normal-summons', `player ${p} has ${ps.normalSummonsLeft} Normal Summons left${where_}`);
        for (const c of ps.szone) {
          if (!c || !c.faceUp) continue;
          if (c.data.stype === 'equip' && c.equippedTo == null && where !== 'turn-start')
            this.fail('orphan-equip', `face-up Equip Spell ${c.name} is equipped to nothing${where_}`);
          const oneShot = c.data.stype === 'normal' || c.data.stype === 'quickplay' || c.data.stype === 'ritual' || c.data.ttype === 'normal' || c.data.ttype === 'counter';
          if (oneShot && !c.isMonster && c.equippedTo == null && c.linkedTo == null && !c.flags.staysOnField && where !== 'turn-start') this.fail('lingering-spell-trap', `face-up ${c.data.stype ?? c.data.ttype} ${c.isSpell ? 'Spell' : 'Trap'} ${c.name} stays on the field after its chain${where_}`);
        }
      }
    }
    const totals: [number, number] = [0, 0];
    for (const c of g.allCards) {
      const places = occ.get(c) ?? [];
      if (places.length > 1) this.fail('duplicate-card', `${c.name} is in ${places.join(' and ')}${where_}`);
      if (c.isToken) {
        if (c.location !== 'none' && c.location !== 'mzone') this.fail('token-off-field', `token ${c.name} has location ${c.location}${where_}`);
        if (c.location === 'mzone' && !places.length) this.fail('lost-card', `token ${c.name} says mzone but is in no zone${where_}`);
        continue;
      }
      totals[c.owner]++;
      if (!places.length) this.fail('lost-card', `${c.name} (owner ${c.owner}, location ${c.location}) is in no pile or zone${where_}`);
    }
    for (const p of [0, 1] as PlayerId[]) {
      if (totals[p] !== this.ownedTotals[p]) this.fail('card-count', `player ${p} owns ${totals[p]} cards, started with ${this.ownedTotals[p]}${where_}`);
    }
    for (const c of occ.keys()) if (!g.allCards.includes(c)) this.fail('unregistered-card', `${c.name} is on the board but not registered${where_}`);
  }
}

/** Wraps a seat: checks invariants and stuck prompts at every request. */
class Guard implements PlayerController {
  readonly isHuman: boolean;
  constructor(
    private inner: PlayerController,
    private ck: () => Checker,
  ) {
    this.isHuman = inner.isHuman;
  }
  private pre(g: Game, what: string) {
    const ck = this.ck();
    ck.tick('decision');
    ck.check(what);
  }
  async chooseAction(g: Game, p: PlayerId, a: Action[]) {
    this.pre(g, 'action');
    if (!a.length) this.ck().fail('stuck', `no actions offered (phase ${g.phase})`);
    if (g.chain.length) this.ck().fail('chain-open-at-action', `main action requested with ${g.chain.length} chain link(s) open`);
    if (a.some((x) => x.type === 'phase' && x.to === 'battle') && g.phase !== 'main1') this.ck().fail('bad-action', `Battle Phase offered in ${g.phase}`);
    for (const x of a) if (x.type === 'activate' || x.type === 'proc') covBump(covKey(x.card, x.act.effectIndex), 0);
    const r = await this.inner.chooseAction(g, p, a);
    if (r.type === 'proc') covBump(covKey(r.card, r.act.effectIndex), 1);
    if (r.type === 'activate' || r.type === 'proc') covBump(covKey(r.card, r.act.effectIndex), 2);
    if (!a.includes(r) && r.type !== 'phase' && r.type !== 'surrender') this.ck().fail('controller', `${r.type} not among offered actions`);
    return r;
  }
  async chooseResponse(g: Game, p: PlayerId, r: ResponseRequest) {
    this.pre(g, 'response');
    if (!r.options.length) this.ck().fail('empty-prompt', `response window (${r.kind}) offered with no options`);
    for (const x of r.options) covBump(covKey(x.card, x.effectIndex), 0);
    const o = await this.inner.chooseResponse(g, p, r);
    if (o) covBump(covKey(o.card, o.effectIndex), 2);
    return o;
  }
  async selectCards(g: Game, p: PlayerId, r: SelectRequest) {
    this.pre(g, 'select');
    if (!r.candidates.length) this.ck().fail('stuck', `selection "${r.prompt}" offered with no candidates${r.cancelable ? '' : ' and no cancel'}`);
    if (r.min > r.candidates.length && !r.cancelable) this.ck().fail('stuck', `selection "${r.prompt}" needs ${r.min} of ${r.candidates.length}`);
    if (r.max < r.min) this.ck().fail('stuck', `selection "${r.prompt}" has max ${r.max} < min ${r.min}`);
    if (r.max <= 0) this.ck().fail('stuck', `selection "${r.prompt}" has max ${r.max}`);
    return this.inner.selectCards(g, p, r);
  }
  async chooseOption(g: Game, p: PlayerId, r: OptionRequest) {
    this.pre(g, 'option');
    if (!r.options.length) this.ck().fail('stuck', `option prompt "${r.prompt}" has no options`);
    return this.inner.chooseOption(g, p, r);
  }
  async confirm(g: Game, p: PlayerId, r: ConfirmRequest) {
    this.pre(g, 'confirm');
    return this.inner.confirm(g, p, r);
  }
  async choosePosition(g: Game, p: PlayerId, c: CardInstance, allowed: (BattlePos | 'set')[]) {
    this.pre(g, 'position');
    if (!allowed.length) this.ck().fail('stuck', `position prompt for ${c.name} has no positions`);
    return this.inner.choosePosition(g, p, c, allowed);
  }
  async chooseAttackTarget(g: Game, p: PlayerId, a: CardInstance, t: CardInstance[], d: boolean) {
    this.pre(g, 'attack-target');
    if (!t.length && !d) this.ck().fail('empty-prompt', `attack target prompt for ${a.name} with no target and no direct attack`);
    return this.inner.chooseAttackTarget(g, p, a, t, d);
  }
  async confirmTrigger(g: Game, p: PlayerId, act: Activation) {
    this.pre(g, 'trigger');
    covBump(covKey(act.card, act.effectIndex), 0);
    // (a confirmed optional trigger counts as chosen when it activates)
    return this.inner.confirmTrigger(g, p, act);
  }
  async declareCard(g: Game, p: PlayerId, prompt: string, names: string[]) {
    this.pre(g, 'declare');
    if (!names.length) this.ck().fail('stuck', `declare prompt "${prompt}" has no names`);
    return this.inner.declareCard ? this.inner.declareCard(g, p, prompt, names) : names[0];
  }
}

// ------------------------------------------------------------------ running one game

function snapshot(g: Game): string {
  const ref = (c: CardInstance | null) => (c ? `${g.allCards.indexOf(c)}${c.faceUp ? 'u' : 'd'}${c.onField && c.isMonster ? c.pos : ''}` : '-');
  return JSON.stringify({
    t: g.turn,
    ph: g.phase,
    w: g.winner,
    r: g.winReason,
    p: g.players.map((p) => ({ lp: p.lp, hand: p.hand.map(ref), deck: p.deck.map(ref), m: p.mzone.map(ref), s: p.szone.map(ref), f: ref(p.fzone), gy: p.grave.map(ref), ban: p.banished.map(ref), ex: p.extra.map(ref) })),
  });
}

let consoleErrors: string[] = [];
aiDebug.onHintError = (card, e) => consoleErrors.push(`AI hint of ${card} threw: ${(e as Error)?.stack?.split('\n').slice(0, 4).join(' | ') ?? e}`);
const origError = console.error;
console.error = (...a: unknown[]) => {
  consoleErrors.push(a.map((x) => (x instanceof Error ? x.stack ?? x.message : String(x))).join(' ').slice(0, 2000));
  if (VERBOSE) origError(...a);
};

export interface GameReport {
  index: number;
  seed: number;
  label: [string, string];
  seats: [Seat, Seat];
  kind: string;
  winner: PlayerId | null;
  reason: string;
  turns: number;
  failures: Failure[];
  replayed: boolean;
  ms: number;
  logs?: [Decision[], Decision[]];
  lastLog?: string[];
  /** Coverage: effect key → [offered, activated]; names of cards that left the Deck. */
  cov?: [string, number, number, number][];
  seen?: string[];
}

function controllersFor(job: Job): [PlayerController, PlayerController] {
  return job.seats.map((s, i) => (s === 'chaos' ? new ChaosHuman(job.seed * 31 + i * 7 + 1) : new AIController(s, job.seed * 13 + i * 101))) as unknown as [PlayerController, PlayerController];
}

async function playOne(job: Job, doReplay: boolean): Promise<GameReport> {
  const t0 = Date.now();
  let ck: Checker = null as any;
  const recs = controllersFor(job).map((c) => new RecordingController(new Guard(c, () => ck))) as [RecordingController, RecordingController];
  const g = new Game(job.decks, recs, { seed: job.seed, names: [job.label[0], job.label[1]], maxTurns: MAX_TURNS, skipFirstDraw: job.skipFirstDraw });
  ck = new Checker(g);
  cov = new Map();
  const origActivate = g.activate.bind(g);
  g.activate = async (player, act) => {
    const link = await origActivate(player, act);
    if (link) covBump(covKey(act.card, act.effectIndex), 1);
    return link;
  };
  if (VERBOSE) g.hooks.log = (e) => origError(`  [T${e.turn}] ${e.text}`);
  let prevTurn = -1;
  g.hooks.anim = (a) => {
    ck.tick('anim');
    if (a.type === 'turn') {
      ck.check('turn-start');
      if (prevTurn >= 0) {
        const prevTp = g.opp(g.turnPlayer);
        const n = g.players[prevTp].hand.length;
        if (n > 6) ck.fail('hand-limit', `player ${prevTp} ended turn ${prevTurn} with ${n} cards in hand`);
      }
      prevTurn = g.turn;
    }
  };
  consoleErrors = [];
  let res: { winner: PlayerId | null; reason: string; turns: number } = { winner: null, reason: '', turns: 0 };
  try {
    res = await g.start();
  } catch (e) {
    if (e instanceof FuzzAbort) res = { winner: null, reason: 'aborted: ' + e.message, turns: g.turn };
    else {
      ck.fail('crash', (e as Error)?.stack?.split('\n').slice(0, 8).join('\n') ?? String(e));
      res = { winner: null, reason: 'crash', turns: g.turn };
    }
  }
  try {
    ck.check('end');
  } catch (e) {
    ck.fail('crash', 'invariant check threw: ' + (e as Error).message);
  }
  if (res.reason === 'Turn limit reached') ck.fail('turn-cap', `game reached the ${MAX_TURNS}-turn cap`);
  for (const e of [...new Set(consoleErrors)]) ck.fail('console-error', e);
  let replayed = false;
  if (doReplay && !ck.failures.length) {
    replayed = true;
    const want = snapshot(g);
    let mismatch = '';
    const rp = recs.map((r, i) => new RecordingController(new NoLive(job.seats[i] === 'chaos'), { replay: r.log, onMismatch: (d) => (mismatch ||= d) })) as [RecordingController, RecordingController];
    const g2 = new Game(job.decks, rp, { seed: job.seed, names: [job.label[0], job.label[1]], maxTurns: MAX_TURNS, skipFirstDraw: job.skipFirstDraw });
    consoleErrors = [];
    try {
      await g2.start();
    } catch (e) {
      mismatch ||= 'replay threw: ' + ((e as Error)?.message ?? String(e));
    }
    if (!mismatch && snapshot(g2) !== want) mismatch = 'final board differs after a full replay';
    if (mismatch) ck.fail('replay-divergence', mismatch);
  }
  const rep: GameReport = {
    index: job.index,
    seed: job.seed,
    label: job.label,
    seats: job.seats,
    kind: job.kind,
    winner: res.winner,
    reason: res.reason,
    turns: res.turns,
    failures: ck.failures,
    replayed,
    ms: Date.now() - t0,
  };
  if (COVERAGE) {
    rep.cov = [...cov].map(([k, [o, a, ch]]) => [k, o, a, ch]);
    rep.seen = [...new Set(g.allCards.filter((c) => !c.isToken && c.location !== 'deck' && c.location !== 'extra').map((c) => c.name))];
  }
  if (ck.failures.length) {
    rep.logs = [recs[0].log, recs[1].log];
    rep.lastLog = g.logEntries.slice(-40).map((l) => `[T${l.turn}] ${l.text}`);
  }
  return rep;
}

// ------------------------------------------------------------------ worker / parent

async function workerMain() {
  const from = Number(arg('from', '0'));
  const to = Number(arg('to', String(GAMES)));
  const stride = Number(arg('stride', '1'));
  for (let i = from; i < to; i += stride) {
    process.send!({ start: i });
    const job = makeJob(SEED, i);
    const rep = await playOne(job, REPLAY_EVERY > 0 && i % REPLAY_EVERY === 0);
    await new Promise<void>((r) => process.send!({ done: rep }, () => r()));
  }
  process.exit(0);
}

async function parentMain() {
  const started = Date.now();
  const reports: GameReport[] = [];
  const hangs: { index: number }[] = [];
  const script = fileURLToPath(import.meta.url);
  const passThrough = args.filter((a, i) => !['--workers', '--from', '--to', '--stride'].includes(a) && !['--workers', '--from', '--to', '--stride'].includes(args[i - 1] ?? ''));
  const W = Math.max(1, Math.min(WORKERS, GAMES));
  let progressAt = Date.now();
  const runWorker = (from: number, stride: number) =>
    new Promise<void>((resolve) => {
      const child = fork(script, [...passThrough, '--worker', '--from', String(from), '--to', String(GAMES), '--stride', String(stride)], {
        execArgv: process.execArgv,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      });
      let current = -1;
      let last = Date.now();
      const timer = setInterval(() => {
        if (Date.now() - last > 90000) {
          clearInterval(timer);
          child.kill('SIGKILL');
          hangs.push({ index: current });
          const job = makeJob(SEED, current);
          reports.push({ index: current, seed: job.seed, label: job.label, seats: job.seats, kind: job.kind, winner: null, reason: 'hang', turns: 0, failures: [{ type: 'hang', detail: 'worker silent for 90s (synchronous infinite loop?)', turn: -1, phase: '?' }], replayed: false, ms: 90000 });
          // continue with the next game of this slice
          if (current + stride < GAMES) runWorker(current + stride, stride).then(resolve);
          else resolve();
        }
      }, 2000);
      child.on('message', (m: any) => {
        last = Date.now();
        if (m.start !== undefined) current = m.start;
        if (m.done) {
          reports.push(m.done);
          if (Date.now() - progressAt > 15000) {
            progressAt = Date.now();
            const bad = reports.filter((r) => r.failures.length).length;
            console.log(`  ... ${reports.length}/${GAMES} games, ${bad} with failures, ${((Date.now() - started) / 1000).toFixed(0)}s`);
          }
        }
      });
      child.on('exit', () => {
        clearInterval(timer);
        if (Date.now() - last <= 90000) resolve();
      });
    });
  await Promise.all(Array.from({ length: W }, (_, w) => runWorker(w, W)));
  summarize(reports, started);
}

function summarize(reports: GameReport[], started: number) {
  reports.sort((a, b) => a.index - b.index);
  const failing = reports.filter((r) => r.failures.length);
  const byType = new Map<string, number>();
  const groups = new Map<string, { n: number; example: GameReport; f: Failure }>();
  for (const r of failing) {
    for (const f of r.failures) {
      byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
      const key = `${f.type}: ${f.detail.split('\n')[0].replace(/#\d+/g, '').replace(/\d+/g, 'N').slice(0, 160)}`;
      const gr = groups.get(key);
      if (gr) gr.n++;
      else groups.set(key, { n: 1, example: r, f });
    }
  }
  const chaos = reports.filter((r) => r.seats.includes('chaos')).length;
  const draft = reports.filter((r) => r.kind === 'draft').length;
  const turns = reports.reduce((a, r) => a + r.turns, 0);
  const reasons = new Map<string, number>();
  for (const r of reports) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  console.log(`\nFuzz seed ${SEED}: ${reports.length} games (${chaos} with a chaotic human, ${draft} draft-set decks), ${reports.filter((r) => r.replayed).length} replay-checked, avg ${(turns / Math.max(1, reports.length)).toFixed(1)} turns, ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`End reasons: ${[...reasons].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`${failing.length} games with failures${failing.length ? ': ' + [...byType].map(([k, v]) => `${k} ${v}`).join(', ') : ''}`);
  if (failing.length) {
    mkdirSync(OUT, { recursive: true });
    for (const [key, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) {
      console.log(`\n[${g.n}x] ${key}\n   e.g. --seed ${SEED} --only ${g.example.index}  (${g.example.label.join(' vs ')}, seats ${g.example.seats.join('/')}, T${g.f.turn} ${g.f.phase})\n   ${g.f.detail.split('\n').slice(0, 6).join('\n   ')}`);
    }
    for (const r of failing) writeFileSync(`${OUT}/seed${SEED}-game${r.index}.json`, JSON.stringify(r));
    writeFileSync(`${OUT}/seed${SEED}-summary.json`, JSON.stringify({ seed: SEED, games: reports.length, failing: failing.map((r) => ({ index: r.index, label: r.label, seats: r.seats, failures: r.failures })) }, null, 1));
    console.log(`\nFailure records (seed, decks, seats, both decision logs): ${OUT}/seed${SEED}-game*.json`);
  }
  if (COVERAGE) writeCoverage(reports);
  process.exit(failing.length ? 1 : 0);
}

/** Cards that left the Deck in many games but whose effects were never offered / never activated. */
function writeCoverage(reports: GameReport[]) {
  const seen = new Map<string, number>();
  const eff = new Map<string, [number, number, number]>();
  for (const r of reports) {
    for (const n of r.seen ?? []) seen.set(n, (seen.get(n) ?? 0) + 1);
    for (const [k, o, a, ch] of r.cov ?? []) {
      const v = eff.get(k) ?? [0, 0, 0];
      v[0] += o;
      v[1] += a;
      v[2] += ch;
      eff.set(k, v);
    }
  }
  // Chosen by a player but (almost) never got onto the chain: activation cancelled or failed.
  mkdirSync(OUT, { recursive: true });
  const fizz = [...eff].filter(([, [, a, ch]]) => ch >= 3 && a < ch * 0.25).sort((x, y) => y[1][2] - x[1][2]);
  writeFileSync(`${OUT}/fizzles-seed${SEED}.txt`, fizz.map(([k, [o, a, ch]]) => `chosen ${String(ch).padStart(5)}  activated ${String(a).padStart(5)}  offered ${String(o).padStart(6)}  ${k}`).join('\n') + '\n');
  const rows: string[] = [];
  for (const [name, games] of [...seen].sort((a, b) => b[1] - a[1])) {
    const data = findCard(name);
    (data?.effects ?? []).forEach((e, i) => {
      if (e.kind === 'continuous') return;
      const [o, a] = eff.get(`${name}#${i}`) ?? [0, 0, 0];
      if (a === 0) rows.push(`${String(games).padStart(5)} games  offered ${String(o).padStart(5)}  activated 0  ${name}#${i} (${e.kind}${e.label ? ': ' + e.label : ''})`);
    });
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/coverage-seed${SEED}.txt`, rows.join('\n') + '\n');
  writeFileSync(`${OUT}/coverage-seed${SEED}.json`, JSON.stringify({ seen: [...seen], eff: [...eff] }));
  console.log(`\nCoverage: ${rows.length} non-continuous effects never activated; list in ${OUT}/coverage-seed${SEED}.txt`);
}

async function onlyMain() {
  const i = Number(ONLY);
  const job = makeJob(SEED, i);
  console.log(`game ${i}: ${job.label.join(' vs ')}, seats ${job.seats.join('/')}, seed ${job.seed}`);
  const rep = await playOne(job, true);
  console.log(`winner ${rep.winner} (${rep.reason}) in ${rep.turns} turns, replay-checked ${rep.replayed}`);
  for (const f of rep.failures) console.log(`- ${f.type} (T${f.turn} ${f.phase}): ${f.detail}`);
  if (rep.lastLog && !VERBOSE) console.log('last log lines:\n  ' + rep.lastLog.join('\n  '));
  process.exit(rep.failures.length ? 1 : 0);
}

if (ONLY !== undefined) void onlyMain();
else if (WORKER) void workerMain();
else void parentMain();
void GameOver;
