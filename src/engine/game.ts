import { CardInstance, type CardData, type EffectDef, type QueryKey, type TempMod } from './card';
import type {
  Action,
  Activation,
  PlayerController,
  SelectPurpose,
  WindowKind,
} from './controller';
import { Ctx } from './ctx';
import { Rng } from './rng';
import type {
  BattlePos,
  EventType,
  GameEvent,
  Location,
  Phase,
  PlayerId,
  Reason,
} from './types';

export class GameOver extends Error {
  constructor(
    public winner: PlayerId | null,
    public reason: string,
  ) {
    super(`Game over: ${winner === null ? 'draw' : `player ${winner} wins`} (${reason})`);
  }
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  lp: number;
  deck: CardInstance[];
  hand: CardInstance[];
  grave: CardInstance[];
  banished: CardInstance[];
  extra: CardInstance[];
  mzone: (CardInstance | null)[];
  szone: (CardInstance | null)[];
  fzone: CardInstance | null;
  normalSummonsLeft: number;
}

export interface ChainLink {
  index: number;
  card: CardInstance;
  effect: EffectDef;
  effectIndex: number;
  player: PlayerId;
  ctx: Ctx;
  negated: boolean;
  speed: number;
  isCardActivation: boolean;
  /** Card was a monster on the field when the effect activated. */
  fromLocation: Location;
}

interface PendingTrigger {
  card: CardInstance;
  effect: EffectDef;
  effectIndex: number;
  event: GameEvent;
  player: PlayerId;
}

export interface BattleState {
  attacker: CardInstance;
  target: CardInstance | null;
  attackerMoveId: number;
  targetMoveId: number;
  negated: boolean;
  inDamageStep: boolean;
  oppMonsterCount: number;
}

export interface LogEntry {
  text: string;
  player?: PlayerId;
  kind: 'info' | 'action' | 'chain' | 'battle' | 'damage' | 'phase' | 'system' | 'win';
  turn: number;
}

export interface AnimEvent {
  type:
    | 'move'
    | 'summon'
    | 'activate'
    | 'resolve'
    | 'attack'
    | 'damage'
    | 'recover'
    | 'destroy'
    | 'flip'
    | 'draw'
    | 'phase'
    | 'negate'
    | 'shuffle'
    | 'reveal'
    | 'target'
    | 'turn'
    | 'coin'
    | 'battle'
    | 'chainEnd';
  [k: string]: any;
}

export interface GameHooks {
  anim?: (a: AnimEvent) => Promise<void> | void;
  log?: (e: LogEntry) => void;
  update?: () => void;
}

export interface GameOptions {
  seed?: number;
  startLP?: number;
  skipFirstDraw?: boolean;
  names?: [string, string];
  firstPlayer?: PlayerId;
  maxTurns?: number;
}

export interface DeckList {
  main: CardData[];
  extra: CardData[];
}

const MZONE_ORDER = [2, 1, 3, 0, 4];
const HAND_LIMIT = 6;

export class Game {
  players: [PlayerState, PlayerState];
  controllers: [PlayerController, PlayerController];
  rng: Rng;
  turn = 0;
  turnPlayer: PlayerId = 0;
  firstPlayer: PlayerId = 0;
  phase: Phase = 'draw';
  chain: ChainLink[] = [];
  resolvingChain = false;
  /** Index of the chain link currently resolving (1-based) or 0. */
  resolvingLink: ChainLink | null = null;
  pending: PendingTrigger[] = [];
  battle: BattleState | null = null;
  winner: PlayerId | null = null;
  winReason = '';
  over = false;
  hooks: GameHooks = {};
  logEntries: LogEntry[] = [];
  options: Required<GameOptions>;

  allCards: CardInstance[] = [];
  private continuousSources: CardInstance[] = [];
  private eventSeq = 0;
  private batchSeq = 0;
  private currentBatch = 0;
  lastBatch = 0;
  lastDsId: number | undefined;
  private damageStepId = 0;
  /** Events since the last top-level action began (used for response windows). */
  recentEvents: GameEvent[] = [];
  eventLog: GameEvent[] = [];
  private optUsed = new Map<string, number>();
  /** Temporary player-level effects (e.g. "you cannot declare an attack this turn"). */
  playerMods: { player: PlayerId; q: QueryKey; value: number | boolean; until: 'turn' | 'nextTurnEnd'; turn: number }[] = [];
  private delayed: { phase: Phase; turn: number; fn: () => Promise<void>; owner?: number }[] = [];
  /** Cards sent to graveyard this turn etc. Track per-turn data for card scripts. */
  turnData: Record<string, any> = {};
  private actionCounter = 0;
  /** Depth guard for continuous queries. */
  private queryDepth = 0;
  /** Summon negation state. */
  pendingSummon: { cards: CardInstance[]; player: PlayerId; method: string; negated: boolean } | null = null;

  constructor(
    decks: [DeckList, DeckList],
    controllers: [PlayerController, PlayerController],
    opts: GameOptions = {},
  ) {
    this.options = {
      seed: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
      startLP: opts.startLP ?? 8000,
      skipFirstDraw: opts.skipFirstDraw ?? true,
      names: opts.names ?? ['Player', 'Opponent'],
      firstPlayer: opts.firstPlayer ?? (-1 as any),
      maxTurns: opts.maxTurns ?? 120,
    };
    this.rng = new Rng(this.options.seed);
    this.controllers = controllers;
    const mk = (id: PlayerId): PlayerState => ({
      id,
      name: this.options.names[id],
      lp: this.options.startLP,
      deck: [],
      hand: [],
      grave: [],
      banished: [],
      extra: [],
      mzone: [null, null, null, null, null],
      szone: [null, null, null, null, null],
      fzone: null,
      normalSummonsLeft: 1,
    });
    this.players = [mk(0), mk(1)];
    for (const p of [0, 1] as PlayerId[]) {
      for (const d of decks[p].main) {
        const c = this.registerCard(new CardInstance(d, p));
        c.location = 'deck';
        this.players[p].deck.push(c);
      }
      for (const d of decks[p].extra) {
        const c = this.registerCard(new CardInstance(d, p));
        c.location = 'extra';
        this.players[p].extra.push(c);
      }
    }
  }

  registerCard(c: CardInstance) {
    this.allCards.push(c);
    if (c.data.effects?.some((e) => e.kind === 'continuous')) this.continuousSources.push(c);
    return c;
  }

  // -------------------------------------------------------------------------
  // Utility
  // -------------------------------------------------------------------------

  opp(p: PlayerId): PlayerId {
    return (1 - p) as PlayerId;
  }

  card(uid: number | null | undefined) {
    if (uid == null) return undefined;
    return this.allCards.find((c) => c.uid === uid);
  }

  log(text: string, kind: LogEntry['kind'] = 'info', player?: PlayerId) {
    const e: LogEntry = { text, kind, player, turn: this.turn };
    this.logEntries.push(e);
    this.hooks.log?.(e);
  }

  async anim(a: AnimEvent) {
    this.hooks.update?.();
    if (this.hooks.anim) await this.hooks.anim(a);
  }

  update() {
    this.hooks.update?.();
  }

  zone(p: PlayerId, loc: Location): CardInstance[] {
    const ps = this.players[p];
    switch (loc) {
      case 'deck':
        return ps.deck;
      case 'hand':
        return ps.hand;
      case 'grave':
        return ps.grave;
      case 'banished':
        return ps.banished;
      case 'extra':
        return ps.extra;
      case 'mzone':
        return ps.mzone.filter((c): c is CardInstance => !!c);
      case 'szone':
        return ps.szone.filter((c): c is CardInstance => !!c);
      case 'fzone':
        return ps.fzone ? [ps.fzone] : [];
      default:
        return [];
    }
  }

  monsters(p: PlayerId) {
    return this.zone(p, 'mzone');
  }
  faceUpMonsters(p: PlayerId) {
    return this.monsters(p).filter((c) => c.faceUp);
  }
  spellTraps(p: PlayerId) {
    return [...this.zone(p, 'szone'), ...this.zone(p, 'fzone')];
  }
  fieldCards(p: PlayerId) {
    return [...this.monsters(p), ...this.spellTraps(p)];
  }
  allFieldCards() {
    return [...this.fieldCards(0), ...this.fieldCards(1)];
  }
  freeMZones(p: PlayerId) {
    return this.players[p].mzone.filter((c) => !c).length;
  }
  freeSZones(p: PlayerId) {
    return this.players[p].szone.filter((c) => !c).length;
  }

  isOptUsed(key: string) {
    return this.optUsed.get(key) === this.turn;
  }
  useOpt(key: string) {
    this.optUsed.set(key, this.turn);
  }
  clearOpt(key: string) {
    this.optUsed.delete(key);
  }
  optKey(card: CardInstance, ef: EffectDef, idx: number, player: PlayerId) {
    if (typeof ef.opt === 'string') return `hard:${player}:${ef.opt}`;
    return `soft:${card.uid}:${idx}`;
  }

  // -------------------------------------------------------------------------
  // Stats & continuous effects
  // -------------------------------------------------------------------------

  private effectCtx(card: CardInstance, ef: EffectDef) {
    return new Ctx(this, card, ef, card.controller);
  }

  /** Is a continuous effect source currently applying? */
  private sourceActive(src: CardInstance, ef: EffectDef, q: QueryKey): boolean {
    const range = ef.range ?? (src.isMonster ? ['mzone'] : ['szone', 'fzone']);
    if (!range.includes(src.location)) return false;
    if (src.onField && !src.faceUp) return false;
    if (!src.isMonster && src.onField && !src.activeOnField) return false;
    if (q !== 'negated' && src.onField && this.queryDepth < 3) {
      if (this.isNegated(src)) return false;
    }
    if (ef.active) {
      const ctx = this.effectCtx(src, ef);
      if (!ef.active(ctx)) return false;
    }
    return true;
  }

  private collectMods(q: QueryKey, subject: CardInstance | PlayerId): (number | boolean)[] {
    const out: (number | boolean)[] = [];
    this.queryDepth++;
    try {
      for (const src of this.continuousSources) {
        for (const ef of src.data.effects ?? []) {
          if (ef.kind !== 'continuous' || !ef.mods) continue;
          for (const m of ef.mods) {
            if (m.q !== q) continue;
            const to = m.to ?? 'self';
            if (to === 'self' && subject !== src) continue;
            if (to === 'cards' && typeof subject === 'number') continue;
            if (to === 'players' && typeof subject !== 'number') continue;
            if (!this.sourceActive(src, ef, q)) continue;
            const ctx = this.effectCtx(src, ef);
            if (m.filter && !m.filter(ctx, subject)) continue;
            const v = typeof m.value === 'function' ? m.value(ctx, subject) : m.value ?? true;
            out.push(v);
          }
        }
      }
      if (typeof subject !== 'number') {
        for (const t of subject.tempMods) if (t.q === q) out.push(t.value);
      } else {
        for (const m of this.playerMods) if (m.player === subject && m.q === q) out.push(m.value);
      }
    } finally {
      this.queryDepth--;
    }
    return out;
  }

  queryCard(card: CardInstance, q: QueryKey): boolean {
    return this.collectMods(q, card).some((v) => v === true || (typeof v === 'number' && v !== 0));
  }
  queryCardNum(card: CardInstance, q: QueryKey): number {
    return this.collectMods(q, card).reduce<number>((a, v) => a + (typeof v === 'number' ? v : 0), 0);
  }
  queryPlayer(p: PlayerId, q: QueryKey): boolean {
    return this.collectMods(q, p).some((v) => !!v);
  }

  isNegated(card: CardInstance): boolean {
    if (!card.onField) return false;
    if (card.flags.negatedTurn === this.turn) return true;
    return this.queryCard(card, 'negated');
  }

  baseAtk(card: CardInstance) {
    return card.flags.baseAtk ?? card.data.atk ?? 0;
  }
  baseDef(card: CardInstance) {
    return card.flags.baseDef ?? card.data.def ?? 0;
  }
  getAtk(card: CardInstance): number {
    if (!card.isMonster) return 0;
    if (!(card.location === 'mzone' && card.faceUp)) return card.data.atk ?? 0;
    if (card.flags.setAtk !== undefined && card.flags.setAtkTurn === this.turn) {
      return Math.max(0, card.flags.setAtk + this.queryCardNum(card, 'atk'));
    }
    return Math.max(0, this.baseAtk(card) + this.queryCardNum(card, 'atk'));
  }
  getDef(card: CardInstance): number {
    if (!card.isMonster) return 0;
    if (!(card.location === 'mzone' && card.faceUp)) return card.data.def ?? 0;
    return Math.max(0, this.baseDef(card) + this.queryCardNum(card, 'def'));
  }
  getLevel(card: CardInstance): number {
    const base = card.flags.baseLevel ?? card.data.level ?? 0;
    if (card.location !== 'mzone') return base;
    return Math.max(1, base + this.queryCardNum(card, 'level'));
  }

  addPlayerMod(player: PlayerId, q: QueryKey, value: number | boolean = true, until: 'turn' | 'nextTurnEnd' = 'turn') {
    this.playerMods.push({ player, q, value, until, turn: this.turn });
    this.update();
  }

  addTempMod(card: CardInstance, q: QueryKey, value: number | boolean, until: TempMod['until'] = 'turn', source?: CardInstance) {
    card.tempMods.push({ q, value, until, turn: this.turn, source: source?.uid });
    this.update();
  }

  // -------------------------------------------------------------------------
  // Events & triggers
  // -------------------------------------------------------------------------

  beginBatch() {
    this.currentBatch = ++this.batchSeq;
    return this.currentBatch;
  }

  emit(ev: Omit<GameEvent, 'seq' | 'batch'>): GameEvent {
    const full: GameEvent = {
      ...ev,
      seq: ++this.eventSeq,
      batch: this.currentBatch,
      inChain: this.resolvingChain,
      turnPlayer: this.turnPlayer,
      dsId: this.battle?.inDamageStep ? this.damageStepId : undefined,
    } as GameEvent;
    this.eventLog.push(full);
    if (this.eventLog.length > 2000) this.eventLog.splice(0, 1000);
    if (!full.minor) {
      this.lastBatch = full.batch;
      this.lastDsId = full.dsId;
      this.recentEvents.push(full);
    }
    this.collectTriggers(full);
    return full;
  }

  private collectTriggers(ev: GameEvent) {
    for (const card of this.allCards) {
      const effs = card.data.effects;
      if (!effs) continue;
      for (let i = 0; i < effs.length; i++) {
        const ef = effs[i];
        if (ef.kind !== 'trigger' || !ef.event) continue;
        const evs = Array.isArray(ef.event) ? ef.event : [ef.event];
        if (!evs.includes(ev.type)) continue;
        if (ef.range && !ef.range.includes(card.location)) continue;
        if (card.location === 'mzone' && !card.faceUp && ev.type !== 'flipped') continue;
        if (card.location === 'deck' && !(ef.range ?? []).includes('deck')) {
          // Triggers from the deck only when explicitly in range (rare); cards milled are already in GY.
          continue;
        }
        if (card.location === 'none') continue;
        const player = card.location === 'mzone' || card.location === 'szone' || card.location === 'fzone' ? card.controller : card.owner;
        const ctx = new Ctx(this, card, ef, player);
        ctx.event = ev;
        ctx.effectIndex = i;
        let ok = false;
        try {
          ok = ef.eventFilter ? ef.eventFilter(ctx, ev) : ev.card === card;
        } catch (e) {
          console.error('eventFilter error', card.name, e);
        }
        if (!ok) continue;
        this.pending.push({ card, effect: ef, effectIndex: i, event: ev, player });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Card movement
  // -------------------------------------------------------------------------

  private detach(card: CardInstance) {
    const ps = this.players[card.controller];
    const po = this.players[card.owner];
    for (const p of [ps, po]) {
      for (const key of ['deck', 'hand', 'grave', 'banished', 'extra'] as const) {
        const i = p[key].indexOf(card);
        if (i >= 0) p[key].splice(i, 1);
      }
      for (let i = 0; i < 5; i++) {
        if (p.mzone[i] === card) p.mzone[i] = null;
        if (p.szone[i] === card) p.szone[i] = null;
      }
      if (p.fzone === card) p.fzone = null;
    }
  }

  private placeInZone(card: CardInstance, loc: Location, controller: PlayerId, seq?: number): boolean {
    const ps = this.players[controller];
    if (loc === 'mzone' || loc === 'szone') {
      const arr = ps[loc];
      let idx = seq !== undefined && seq >= 0 && !arr[seq] ? seq : -1;
      if (idx < 0) {
        const order = loc === 'mzone' ? MZONE_ORDER : MZONE_ORDER;
        for (const i of order) if (!arr[i]) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return false;
      arr[idx] = card;
      card.seq = idx;
      return true;
    }
    if (loc === 'fzone') {
      ps.fzone = card;
      card.seq = 0;
      return true;
    }
    card.seq = -1;
    return true;
  }

  /**
   * Low level move. Returns the actual destination. Does not emit events.
   */
  rawMove(
    card: CardInstance,
    to: Location,
    opts: { controller?: PlayerId; faceUp?: boolean; pos?: BattlePos; seq?: number; top?: boolean; bottom?: boolean } = {},
  ): Location {
    const from = card.location;
    const wasOnField = card.onField;
    let dest = to;
    if (dest === 'grave' && this.queryPlayer(card.owner, 'banishInsteadOfGrave')) dest = 'banished';
    if (dest === 'grave' && card.banishOnLeave && wasOnField) dest = 'banished';
    if (wasOnField && card.banishOnLeave && (dest === 'hand' || dest === 'deck')) dest = 'banished';
    if ((dest === 'deck' || dest === 'hand') && card.isExtra) dest = 'extra';
    if (card.isToken && !(dest === 'mzone')) dest = 'none';

    this.detach(card);
    const leavingField = wasOnField && !(dest === 'mzone' || dest === 'szone' || dest === 'fzone');
    if (from !== dest || wasOnField) {
      const keepProper = card.properlySummoned;
      card.resetOnMove();
      card.properlySummoned = keepProper && (dest === 'grave' || dest === 'banished');
      if (dest !== 'mzone') card.banishOnLeave = false;
    }
    void leavingField;
    const owner = card.owner;
    switch (dest) {
      case 'deck':
        card.faceUp = false;
        if (opts.bottom) this.players[owner].deck.unshift(card);
        else this.players[owner].deck.push(card); // top of deck = end of array
        card.controller = owner;
        break;
      case 'hand':
        card.faceUp = false;
        this.players[owner].hand.push(card);
        card.controller = owner;
        break;
      case 'grave':
        card.faceUp = true;
        this.players[owner].grave.push(card);
        card.controller = owner;
        break;
      case 'banished':
        card.faceUp = opts.faceUp ?? true;
        this.players[owner].banished.push(card);
        card.controller = owner;
        break;
      case 'extra':
        card.faceUp = false;
        this.players[owner].extra.push(card);
        card.controller = owner;
        break;
      case 'mzone':
      case 'szone':
      case 'fzone': {
        const ctrl = opts.controller ?? card.controller;
        card.controller = ctrl;
        if (!this.placeInZone(card, dest, ctrl, opts.seq)) {
          // no room: send to grave instead
          this.players[owner].grave.push(card);
          card.controller = owner;
          card.location = 'grave';
          card.faceUp = true;
          return 'grave';
        }
        card.faceUp = opts.faceUp ?? true;
        if (dest === 'mzone') card.pos = opts.pos ?? 'atk';
        break;
      }
      case 'none':
        break;
    }
    card.location = dest;
    return dest;
  }

  /**
   * Move a group of cards simultaneously, emitting the appropriate events.
   */
  async moveCards(
    cards: CardInstance[],
    to: Location,
    opts: {
      reason: Reason;
      reasons?: Reason[];
      reasonPlayer?: PlayerId;
      reasonCard?: CardInstance;
      destroyed?: boolean;
      battleWith?: CardInstance;
      faceUp?: boolean;
      top?: boolean;
      bottom?: boolean;
      shuffle?: boolean;
      minor?: boolean;
      noAnim?: boolean;
    },
  ): Promise<CardInstance[]> {
    if (!cards.length) return [];
    this.beginBatch();
    const moved: { card: CardInstance; from: Location; to: Location; fromFaceUp: boolean; fromCtrl: PlayerId; wasMonster: boolean }[] = [];
    for (const card of cards) {
      const from = card.location;
      const fromFaceUp = card.faceUp;
      const fromCtrl = card.controller;
      const dest = this.rawMove(card, to, { faceUp: opts.faceUp, bottom: opts.bottom });
      moved.push({ card, from, to: dest, fromFaceUp, fromCtrl, wasMonster: from === 'mzone' });
    }
    if (!opts.noAnim) {
      await this.anim({
        type: opts.destroyed ? 'destroy' : 'move',
        cards: moved.map((m) => ({ uid: m.card.uid, from: m.from, to: m.to, ctrl: m.fromCtrl })),
        reason: opts.reason,
      });
    }
    for (const p of [0, 1] as PlayerId[]) {
      if (opts.shuffle || (to === 'deck' && !opts.top && !opts.bottom)) {
        if (moved.some((m) => m.card.owner === p && m.to === 'deck')) this.shuffleDeck(p);
      }
    }
    const reasons = opts.reasons ?? [opts.reason];
    const base = {
      reason: opts.reason,
      reasons,
      reasonPlayer: opts.reasonPlayer,
      reasonCard: opts.reasonCard,
      minor: opts.minor,
    };
    for (const m of moved) {
      const common = { ...base, card: m.card, from: m.from, to: m.to, fromFaceUp: m.fromFaceUp, fromController: m.fromCtrl };
      const wasField = m.from === 'mzone' || m.from === 'szone' || m.from === 'fzone';
      if (wasField && !(m.to === 'mzone' || m.to === 'szone' || m.to === 'fzone')) this.emit({ type: 'leftField', ...common });
      if (opts.destroyed) this.emit({ type: 'destroyed', ...common });
      if (opts.battleWith && opts.destroyed) this.emit({ type: 'battleDestroyed', ...common, other: opts.battleWith });
      if (opts.reason === 'tribute') this.emit({ type: 'tributed', ...common });
      if (opts.reason === 'synchro' || opts.reason === 'fusion' || opts.reason === 'material') this.emit({ type: 'usedAsMaterial', ...common });
      if (opts.reason === 'discard' || reasons.includes('discard')) this.emit({ type: 'discarded', ...common });
      if (m.to === 'grave') {
        this.emit({ type: 'sentToGrave', ...common });
        if (m.from === 'deck') this.emit({ type: 'milled', ...common });
      }
      if (m.to === 'banished') this.emit({ type: 'banished', ...common });
      if (m.to === 'hand') {
        this.emit({ type: 'addedToHand', ...common });
        if (wasField) this.emit({ type: 'returnedToHand', ...common });
      }
      if ((m.to === 'deck' || m.to === 'extra') && m.from !== 'deck' && m.from !== 'extra') {
        this.emit({ type: 'returnedToDeck', ...common });
      }
    }
    await this.ruleCleanup();
    this.update();
    return moved.map((m) => m.card);
  }

  /** Destroy equips without a host and break links. */
  async ruleCleanup() {
    const kill = new Set<CardInstance>();
    for (const c of this.allFieldCards()) {
      if (c.equippedTo != null) {
        const host = this.card(c.equippedTo);
        if (!host || host.location !== 'mzone' || !host.faceUp || host.moveId !== c.flags.hostMoveId) kill.add(c);
      }
      if (c.linkedTo != null && c.flags.linkDestroy) {
        const other = this.card(c.linkedTo);
        if (!other || other.moveId !== c.flags.linkMoveId || !other.onField) kill.add(c);
      }
    }
    const list = [...kill].filter((c) => c.onField);
    if (list.length) {
      await this.moveCards(list, 'grave', { reason: 'rule', reasons: ['rule', 'destroy'], destroyed: true });
    }
  }

  shuffleDeck(p: PlayerId) {
    this.rng.shuffle(this.players[p].deck);
  }

  // -------------------------------------------------------------------------
  // High level operations used by effects
  // -------------------------------------------------------------------------

  async draw(p: PlayerId, n = 1, reason: Reason = 'draw'): Promise<CardInstance[]> {
    const out: CardInstance[] = [];
    if (n <= 0) return out;
    if (this.queryPlayer(p, 'cannotDraw')) return out;
    this.beginBatch();
    for (let i = 0; i < n; i++) {
      const deck = this.players[p].deck;
      if (!deck.length) {
        this.lose(p, 'Deck out');
      }
      const c = deck[deck.length - 1];
      this.rawMove(c, 'hand');
      out.push(c);
    }
    await this.anim({ type: 'draw', player: p, cards: out.map((c) => c.uid) });
    for (const c of out) {
      this.emit({ type: 'drawn', card: c, player: p, reason, from: 'deck', to: 'hand' });
      this.emit({ type: 'addedToHand', card: c, player: p, reason, from: 'deck', to: 'hand' });
    }
    this.update();
    return out;
  }

  canDestroy(card: CardInstance, reason: Reason) {
    if (!card.onField) return false;
    if (reason === 'battle') return !this.queryCard(card, 'indestructibleBattle');
    if (reason === 'effect') return !this.queryCard(card, 'indestructibleEffect');
    return true;
  }

  async destroy(cards: CardInstance[], reason: Reason, reasonPlayer?: PlayerId, reasonCard?: CardInstance, battleWith?: CardInstance) {
    const list = cards.filter((c) => this.canDestroy(c, reason) && !this.isUnaffected(c, reasonCard, reasonPlayer));
    if (!list.length) return [];
    for (const c of list) this.log(`${c.name} is destroyed.`, 'action', c.controller);
    return this.moveCards(list, 'grave', { reason, reasons: [reason, 'destroy'], reasonPlayer, reasonCard, destroyed: true, battleWith });
  }

  isUnaffected(card: CardInstance, by?: CardInstance, byPlayer?: PlayerId): boolean {
    if (!by || !card.onField) return false;
    if (byPlayer !== undefined && byPlayer === card.controller) return false;
    if (by.isSpell && this.queryCard(card, 'unaffectedBySpells')) return true;
    if (by.isTrap && this.queryCard(card, 'unaffectedByTraps')) return true;
    return false;
  }

  async sendToGrave(cards: CardInstance[], reason: Reason, reasonPlayer?: PlayerId, reasonCard?: CardInstance) {
    return this.moveCards(cards, 'grave', { reason, reasonPlayer, reasonCard });
  }

  async banish(cards: CardInstance[], reason: Reason, reasonPlayer?: PlayerId, reasonCard?: CardInstance, faceDown = false) {
    return this.moveCards(cards, 'banished', { reason, reasonPlayer, reasonCard, faceUp: !faceDown });
  }

  async toHand(cards: CardInstance[], reason: Reason, reasonPlayer?: PlayerId, reasonCard?: CardInstance) {
    const r = await this.moveCards(cards, 'hand', { reason, reasonPlayer, reasonCard });
    for (const c of r) if (c.location === 'hand') c.revealedUntil = this.turn;
    return r;
  }

  async toDeck(cards: CardInstance[], reason: Reason, where: 'shuffle' | 'top' | 'bottom' = 'shuffle', reasonPlayer?: PlayerId, reasonCard?: CardInstance) {
    return this.moveCards(cards, 'deck', {
      reason,
      reasonPlayer,
      reasonCard,
      top: where === 'top',
      bottom: where === 'bottom',
      shuffle: where === 'shuffle',
    });
  }

  async discard(cards: CardInstance[], reason: Reason = 'effect', reasonPlayer?: PlayerId, reasonCard?: CardInstance) {
    return this.moveCards(cards, 'grave', { reason: 'discard', reasons: ['discard', reason], reasonPlayer, reasonCard });
  }

  async mill(p: PlayerId, n: number, reason: Reason = 'effect', reasonCard?: CardInstance) {
    const deck = this.players[p].deck;
    const cards = deck.slice(Math.max(0, deck.length - n)).reverse();
    if (!cards.length) return [];
    this.log(`${this.players[p].name} sends the top ${cards.length} card(s) of their Deck to the GY.`, 'action', p);
    return this.moveCards(cards, 'grave', { reason, reasonPlayer: p, reasonCard });
  }

  async damage(p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: CardInstance, sourcePlayer?: PlayerId) {
    amount = Math.floor(amount);
    if (amount <= 0) return 0;
    if (kind === 'effect' && this.queryPlayer(p, 'noEffectDamage')) return 0;
    this.players[p].lp = Math.max(0, this.players[p].lp - amount);
    this.log(`${this.players[p].name} takes ${amount} ${kind === 'battle' ? 'battle ' : ''}damage. (LP ${this.players[p].lp})`, 'damage', p);
    await this.anim({ type: 'damage', player: p, amount, kind });
    this.beginBatch();
    if (kind === 'battle') this.emit({ type: 'battleDamage', player: p, amount, reasonCard: source, reasonPlayer: sourcePlayer });
    this.emit({ type: 'damage', player: p, amount, reasonCard: source, reason: kind === 'battle' ? 'battle' : 'effect', reasonPlayer: sourcePlayer });
    this.checkLp();
    return amount;
  }

  async recover(p: PlayerId, amount: number, source?: CardInstance) {
    amount = Math.floor(amount);
    if (amount <= 0) return;
    this.players[p].lp += amount;
    this.log(`${this.players[p].name} gains ${amount} LP. (LP ${this.players[p].lp})`, 'damage', p);
    await this.anim({ type: 'recover', player: p, amount });
    this.beginBatch();
    this.emit({ type: 'lpGain', player: p, amount, reasonCard: source });
  }

  async payLp(p: PlayerId, amount: number) {
    this.players[p].lp = Math.max(0, this.players[p].lp - amount);
    this.log(`${this.players[p].name} pays ${amount} LP. (LP ${this.players[p].lp})`, 'damage', p);
    await this.anim({ type: 'damage', player: p, amount, kind: 'cost' });
    this.checkLp();
  }

  checkLp() {
    const dead0 = this.players[0].lp <= 0;
    const dead1 = this.players[1].lp <= 0;
    if (dead0 && dead1) this.endGame(null, 'Both players reached 0 LP');
    else if (dead0) this.lose(0, 'LP reached 0');
    else if (dead1) this.lose(1, 'LP reached 0');
  }

  lose(p: PlayerId, reason: string): never {
    this.endGame(this.opp(p), reason);
  }

  endGame(winner: PlayerId | null, reason: string): never {
    this.over = true;
    this.winner = winner;
    this.winReason = reason;
    this.log(winner === null ? `The duel is a draw (${reason}).` : `${this.players[winner].name} wins! (${reason})`, 'win');
    this.update();
    throw new GameOver(winner, reason);
  }

  async changePosition(card: CardInstance, pos: BattlePos, faceUp = true, reasonPlayer?: PlayerId) {
    if (card.location !== 'mzone') return;
    const wasFaceDown = !card.faceUp;
    card.pos = pos;
    card.faceUp = faceUp;
    if (!faceUp) {
      card.tempMods = [];
      card.flags.flipped = false;
      await this.ruleCleanup();
    }
    this.beginBatch();
    await this.anim({ type: 'flip', card: card.uid, pos, faceUp });
    this.emit({ type: 'positionChanged', card, reasonPlayer });
    if (wasFaceDown && faceUp) {
      this.emit({ type: 'flipped', card, reasonPlayer });
    }
    this.update();
  }

  async setFaceDown(card: CardInstance) {
    await this.changePosition(card, 'def', false);
  }

  /** Special Summon cards. Returns those that were summoned. */
  async specialSummon(
    cards: CardInstance[],
    player: PlayerId,
    opts: {
      pos?: BattlePos | 'choose';
      faceDown?: boolean;
      method?: 'special' | 'synchro' | 'fusion' | 'ritual';
      reasonCard?: CardInstance;
      ignoreConditions?: boolean;
      controller?: PlayerId;
      proper?: boolean;
      noTrigger?: boolean;
    } = {},
  ): Promise<CardInstance[]> {
    const ctrl = opts.controller ?? player;
    if (this.queryPlayer(player, 'cannotSpecialSummon')) return [];
    const list: CardInstance[] = [];
    for (const c of cards) {
      if (this.freeMZones(ctrl) - list.length <= 0) break;
      if (!opts.ignoreConditions && c.data.nomi && !c.properlySummoned && (c.location === 'grave' || c.location === 'banished')) continue;
      list.push(c);
    }
    if (!list.length) return [];
    const positions: BattlePos[] = [];
    for (const c of list) {
      let pos: BattlePos = 'atk';
      if (opts.pos === 'choose') {
        const r = await this.controllers[player].choosePosition(this, player, c, ['atk', 'def']);
        pos = r === 'set' ? 'def' : r;
      } else if (opts.pos) pos = opts.pos;
      positions.push(pos);
    }
    this.beginBatch();
    const from: Location[] = [];
    list.forEach((c, i) => {
      from.push(c.location);
      this.rawMove(c, 'mzone', { controller: ctrl, faceUp: !opts.faceDown, pos: opts.faceDown ? 'def' : positions[i] });
      c.summonTurn = this.turn;
      c.summonMethod = opts.method ?? 'special';
      if (opts.proper || opts.method === 'synchro' || opts.method === 'fusion' || opts.method === 'ritual') c.properlySummoned = true;
      if (opts.faceDown) c.setTurn = this.turn;
      this.log(`${this.players[ctrl].name} Special Summons ${opts.faceDown ? 'a face-down monster' : c.name}${opts.method && opts.method !== 'special' ? ` (${opts.method})` : ''}.`, 'action', ctrl);
    });
    await this.anim({ type: 'summon', cards: list.map((c) => c.uid), method: opts.method ?? 'special', from });
    list.forEach((c, i) => {
      const common = { card: c, player: ctrl, from: from[i], to: 'mzone' as Location, reasonCard: opts.reasonCard, method: opts.method ?? 'special' };
      this.emit({ type: 'specialSummoned', ...common });
      if (opts.method === 'synchro') this.emit({ type: 'synchroSummoned', ...common });
      if (opts.method === 'fusion') this.emit({ type: 'fusionSummoned', ...common });
      this.emit({ type: 'summoned', ...common });
    });
    this.update();
    return list;
  }

  async createTokens(player: PlayerId, data: CardData, count: number, pos: BattlePos = 'def', controller?: PlayerId): Promise<CardInstance[]> {
    const ctrl = controller ?? player;
    const tokens: CardInstance[] = [];
    for (let i = 0; i < count; i++) {
      if (this.freeMZones(ctrl) - tokens.length <= 0) break;
      const t = this.registerCard(new CardInstance(data, ctrl));
      t.location = 'none';
      tokens.push(t);
    }
    return this.specialSummon(tokens, player, { pos, controller: ctrl, ignoreConditions: true });
  }

  async takeControl(card: CardInstance, player: PlayerId, untilEndPhase = false) {
    if (card.location !== 'mzone' || card.controller === player) return false;
    if (this.freeMZones(player) <= 0) return false;
    const prevCtrl = card.controller;
    const ps = this.players[prevCtrl];
    ps.mzone[card.seq] = null;
    card.controller = player;
    this.placeInZone(card, 'mzone', player);
    card.flags.controlChangedTurn = this.turn;
    this.log(`${this.players[player].name} takes control of ${card.name}.`, 'action', player);
    this.beginBatch();
    await this.anim({ type: 'move', cards: [{ uid: card.uid, from: 'mzone', to: 'mzone', ctrl: prevCtrl }] });
    this.emit({ type: 'controlChanged', card, player });
    if (untilEndPhase) {
      const moveId = card.moveId;
      this.addDelayed('end', async () => {
        if (card.location === 'mzone' && card.moveId === moveId && card.controller !== card.owner) {
          await this.returnControl(card);
        }
      });
    }
    this.update();
    return true;
  }

  async returnControl(card: CardInstance) {
    if (card.location !== 'mzone' || card.controller === card.owner) return;
    if (this.freeMZones(card.owner) <= 0) {
      await this.sendToGrave([card], 'rule');
      return;
    }
    const prev = card.controller;
    this.players[prev].mzone[card.seq] = null;
    card.controller = card.owner;
    this.placeInZone(card, 'mzone', card.owner);
    this.log(`Control of ${card.name} returns to ${this.players[card.owner].name}.`, 'action');
    await this.anim({ type: 'move', cards: [{ uid: card.uid, from: 'mzone', to: 'mzone', ctrl: prev }] });
    this.update();
  }

  addDelayed(phase: Phase, fn: () => Promise<void>, turnOffset = 0) {
    this.delayed.push({ phase, turn: this.turn + turnOffset, fn });
  }

  /** Attach an equip card. */
  equip(equipCard: CardInstance, target: CardInstance) {
    equipCard.equippedTo = target.uid;
    equipCard.flags.hostMoveId = target.moveId;
    this.update();
  }

  equipsOf(monster: CardInstance) {
    return this.allFieldCards().filter((c) => c.equippedTo === monster.uid);
  }

  /** Link two cards: when `other` leaves the field, `card` is destroyed (and vice versa if mutual). */
  link(card: CardInstance, other: CardInstance, mutual = true) {
    card.linkedTo = other.uid;
    card.flags.linkDestroy = true;
    card.flags.linkMoveId = other.moveId;
    if (mutual) {
      other.linkedTo = card.uid;
      other.flags.linkDestroy = true;
      other.flags.linkMoveId = card.moveId;
    }
  }

  // -------------------------------------------------------------------------
  // Selection helpers
  // -------------------------------------------------------------------------

  async select(
    player: PlayerId,
    candidates: CardInstance[],
    min: number,
    max: number,
    prompt: string,
    purpose: SelectPurpose = 'generic',
    extra: { cancelable?: boolean; aiScore?: (c: CardInstance) => number; source?: CardInstance } = {},
  ): Promise<CardInstance[]> {
    const cands = [...new Set(candidates)];
    if (!cands.length) return [];
    min = Math.min(min, cands.length);
    max = Math.min(max, cands.length);
    if (min === cands.length && max === cands.length && !extra.cancelable && min > 0) {
      // forced: still let the UI show? skip prompt for speed
      return cands;
    }
    const r = await this.controllers[player].selectCards(this, player, {
      prompt,
      candidates: cands,
      min,
      max,
      purpose,
      cancelable: extra.cancelable,
      aiScore: extra.aiScore,
      source: extra.source,
    });
    const valid = r.filter((c) => cands.includes(c));
    if (valid.length < min && !extra.cancelable) {
      // fallback: fill automatically
      for (const c of cands) {
        if (valid.length >= min) break;
        if (!valid.includes(c)) valid.push(c);
      }
    }
    return valid.slice(0, max);
  }

  async confirm(player: PlayerId, prompt: string, source?: CardInstance, aiDefault = true) {
    return this.controllers[player].confirm(this, player, { prompt, source, aiDefault });
  }

  async option(player: PlayerId, prompt: string, options: string[], source?: CardInstance, aiScore?: (i: number) => number) {
    if (options.length === 1) return 0;
    return this.controllers[player].chooseOption(this, player, { prompt, options, source, aiScore });
  }

  // -------------------------------------------------------------------------
  // Activation legality
  // -------------------------------------------------------------------------

  defaultRange(card: CardInstance, ef: EffectDef): Location[] {
    if (ef.range) return ef.range;
    switch (ef.kind) {
      case 'activate':
        return card.isSpell ? ['hand', 'szone', 'fzone'] : ['szone'];
      case 'proc':
        return ['hand'];
      default:
        return card.isMonster ? ['mzone'] : ['szone', 'fzone'];
    }
  }

  effectSpeed(card: CardInstance, ef: EffectDef): number {
    if (ef.speed) return ef.speed;
    if (ef.kind === 'activate') {
      if (card.isTrap) return card.data.ttype === 'counter' ? 3 : 2;
      return card.data.stype === 'quickplay' ? 2 : 1;
    }
    if (ef.kind === 'quick') return 2;
    return 1;
  }

  /** Who may use the card's effects right now. */
  cardUser(card: CardInstance): PlayerId {
    return card.onField ? card.controller : card.owner;
  }

  private matchEvent(ctx: Ctx, ef: EffectDef): GameEvent | undefined | null {
    if (!ef.event) return undefined;
    const evs = Array.isArray(ef.event) ? ef.event : [ef.event];
    for (let i = this.recentEvents.length - 1; i >= 0; i--) {
      const ev = this.recentEvents[i];
      if (!evs.includes(ev.type)) continue;
      ctx.event = ev;
      try {
        if (!ef.eventFilter || ef.eventFilter(ctx, ev)) return ev;
      } catch (e) {
        console.error(e);
      }
    }
    ctx.event = undefined;
    return null;
  }

  /**
   * Check whether `player` can activate effect `ef` of `card` right now.
   * Returns the context if possible.
   */
  canActivateEffect(
    player: PlayerId,
    card: CardInstance,
    ef: EffectDef,
    idx: number,
    mode: { open: boolean; window?: WindowKind },
  ): Ctx | null {
    if (ef.kind === 'continuous' || ef.kind === 'trigger') return null;
    if (this.cardUser(card) !== player) return null;
    const range = this.defaultRange(card, ef);
    if (!range.includes(card.location)) return null;
    const isOwnTurn = this.turnPlayer === player;
    const speed = this.effectSpeed(card, ef);
    const window = mode.window;
    const damageStep = !!this.battle?.inDamageStep;

    if (damageStep && !ef.damageStep && !(card.isTrap && card.data.ttype === 'counter')) return null;

    if (window === 'summonNegation') {
      if (!ef.negateSummon) return null;
    } else if (ef.negateSummon) {
      // summon negation effects are only usable in that window
      return null;
    }

    // Chain speed
    if (this.chain.length) {
      const top = this.chain[this.chain.length - 1];
      if (speed < 2 || speed < top.speed) return null;
    } else if (speed === 1) {
      if (!(mode.open && isOwnTurn && (this.phase === 'main1' || this.phase === 'main2'))) return null;
    }

    if (ef.kind === 'proc') return null; // procs handled as actions

    // Card state requirements
    if (ef.kind === 'activate') {
      if (card.isSpell) {
        if (this.queryPlayer(player, 'cannotActivateSpells')) return null;
        if (card.location === 'hand') {
          if (card.data.stype === 'quickplay' && !isOwnTurn) return null;
          if (card.data.stype === 'field') {
            // ok
          } else if (this.freeSZones(player) <= 0) return null;
        } else if (card.location === 'szone' || card.location === 'fzone') {
          if (card.faceUp) return null;
          if (card.data.stype === 'quickplay' && card.setTurn === this.turn) return null;
        } else return null;
      } else if (card.isTrap) {
        if (this.queryPlayer(player, 'cannotActivateTraps')) return null;
        if (card.location !== 'szone' || card.faceUp) {
          if (!(range.includes(card.location) && card.location !== 'szone')) return null;
        }
        if (card.location === 'szone' && card.setTurn === this.turn) return null;
      }
    } else {
      // monster or continuous card effect
      if (card.onField) {
        if (!card.faceUp) return null;
        if (!card.isMonster && !card.activeOnField) return null;
        if (this.isNegated(card)) return null;
        if (card.isTrap && this.queryPlayer(player, 'cannotActivateTraps')) return null;
      }
      if (ef.kind === 'ignition' && (!isOwnTurn || this.chain.length)) return null;
    }

    if (ef.opt && this.isOptUsed(this.optKey(card, ef, idx, player))) return null;
    // A card can't activate the same effect twice in one chain.
    if (this.chain.some((l) => l.card === card && l.effectIndex === idx)) return null;
    if (ef.kind === 'activate' && this.chain.some((l) => l.card === card)) return null;

    const ctx = new Ctx(this, card, ef, player);
    ctx.effectIndex = idx;
    const evMatch = this.matchEvent(ctx, ef);
    if (evMatch === null) return null;
    try {
      if (ef.condition && !ef.condition(ctx)) return null;
      if (ef.canActivate && !ef.canActivate(ctx)) return null;
    } catch (e) {
      console.error('condition error', card.name, e);
      return null;
    }
    return ctx;
  }

  /** All effects player can activate now. */
  getActivations(player: PlayerId, mode: { open: boolean; window?: WindowKind }): Activation[] {
    const out: Activation[] = [];
    const ps = this.players[player];
    const cards = [
      ...ps.hand,
      ...this.fieldCards(player),
      ...ps.grave,
      ...ps.banished,
    ];
    for (const card of cards) {
      const effs = card.data.effects ?? [];
      for (let i = 0; i < effs.length; i++) {
        const ef = effs[i];
        const ctx = this.canActivateEffect(player, card, ef, i, mode);
        if (!ctx) continue;
        out.push({ card, effect: ef, effectIndex: i, label: ef.label ?? (ef.kind === 'activate' ? 'Activate' : 'Use effect'), event: ctx.event });
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Activation and chains
  // -------------------------------------------------------------------------

  /** Activate an effect, pay costs, and add it to the chain. Returns the link or null if cancelled. */
  async activate(player: PlayerId, act: Activation): Promise<ChainLink | null> {
    const { card, effect: ef, effectIndex: idx } = act;
    const ctx = new Ctx(this, card, ef, player);
    ctx.effectIndex = idx;
    ctx.event = act.event;
    const fromLocation = card.location;
    const isCardActivation = ef.kind === 'activate' && (card.isSpell || card.isTrap);
    let placedFromHand = false;
    let wasFaceDown = false;
    if (isCardActivation) {
      if (card.location === 'hand') {
        if (card.data.stype === 'field') {
          await this.replaceFieldSpell(player);
          this.rawMove(card, 'fzone', { controller: player, faceUp: true });
        } else {
          this.rawMove(card, 'szone', { controller: player, faceUp: true });
        }
        placedFromHand = true;
      } else if (!card.faceUp) {
        if (card.data.stype === 'field') await this.replaceFieldSpell(player, card);
        card.faceUp = true;
        wasFaceDown = true;
      }
    }
    if (ef.opt) this.useOpt(this.optKey(card, ef, idx, player));
    const link: ChainLink = {
      index: this.chain.length + 1,
      card,
      effect: ef,
      effectIndex: idx,
      player,
      ctx,
      negated: false,
      speed: this.effectSpeed(card, ef),
      isCardActivation,
      fromLocation,
    };
    ctx.link = link;
    this.log(`${this.players[player].name} activates ${card.name}${ef.label && !isCardActivation ? ` (${ef.label})` : ''}.`, 'chain', player);
    await this.anim({ type: 'activate', card: card.uid, player, chainIndex: link.index, label: ef.label });
    let ok: boolean | void = true;
    // Mark link as pending so cost-time checks see it.
    this.chain.push(link);
    try {
      if (ef.activate) ok = await ef.activate(ctx);
    } catch (e) {
      if (e instanceof GameOver) throw e;
      console.error('activate error', card.name, e);
      ok = false;
    }
    if (ok === false) {
      this.chain.pop();
      if (ef.opt) this.clearOpt(this.optKey(card, ef, idx, player));
      if (placedFromHand) this.rawMove(card, 'hand');
      else if (wasFaceDown) card.faceUp = false;
      this.log(`${card.name}'s activation was cancelled.`, 'info', player);
      this.update();
      return null;
    }
    this.beginBatch();
    this.emit({ type: 'cardActivated', card, player, minor: true, data: { link } });
    this.emit({ type: 'chainActivated', card, player, minor: true, data: { link } });
    if (ctx.targets.length) {
      const names = ctx.targets.map((c) => (c.faceUp || c.location === 'grave' ? c.name : 'a face-down card'));
      this.log(`${card.name} targets ${names.join(', ')}.`, 'chain', player);
      await this.anim({ type: 'target', cards: ctx.targets.map((c) => c.uid), source: card.uid });
    }
    this.update();
    return link;
  }

  private async replaceFieldSpell(player: PlayerId, except?: CardInstance) {
    // Master Rule 2: only one face-up Field Spell on the whole field.
    const olds = [this.players[0].fzone, this.players[1].fzone].filter(
      (c): c is CardInstance => !!c && c !== except && (c.faceUp || c.controller === player),
    );
    const toRemove = olds.filter((c) => c.faceUp || c.controller === player);
    if (toRemove.length) await this.moveCards(toRemove, 'grave', { reason: 'rule', destroyed: true });
  }

  /** Run the chain: response windows then resolution. */
  async runChain() {
    if (!this.chain.length) return;
    await this.responseLoop('chain', this.opp(this.chain[this.chain.length - 1].player));
    await this.resolveChain();
  }

  /**
   * Alternate priority between players until both pass consecutively.
   * Any activation adds a chain link.
   */
  async responseLoop(kind: WindowKind, first: PlayerId, prompt = '') {
    let prio = first;
    let passes = 0;
    let guard = 0;
    while (passes < 2 && guard++ < 40) {
      const opts = this.getActivations(prio, { open: false, window: kind });
      let choice: Activation | null = null;
      if (opts.length) {
        choice = await this.controllers[prio].chooseResponse(this, prio, {
          kind,
          options: opts,
          prompt: prompt || this.describeWindow(kind),
        });
      }
      if (choice) {
        const link = await this.activate(prio, choice);
        if (link) {
          passes = 0;
          kind = 'chain';
          prio = this.opp(prio);
          continue;
        }
      }
      passes++;
      prio = this.opp(prio);
    }
  }

  describeWindow(kind: WindowKind): string {
    if (kind === 'chain' && this.chain.length) {
      const top = this.chain[this.chain.length - 1];
      return `${this.players[top.player].name} activated ${top.card.name} (Chain Link ${top.index}). Respond?`;
    }
    if (kind === 'attack' && this.battle) {
      return `${this.battle.attacker.name} declares an attack${this.battle.target ? ` on ${this.battle.target.faceUp ? this.battle.target.name : 'a face-down monster'}` : ' directly'}. Respond?`;
    }
    if (kind === 'damage') return 'Damage Step. Activate a card?';
    if (kind === 'summonNegation' && this.pendingSummon) return `${this.pendingSummon.cards.map((c) => c.name).join(', ')} is being summoned. Negate?`;
    if (kind === 'phase') return `${phaseName(this.phase)}. Activate a card?`;
    const last = this.recentEvents[this.recentEvents.length - 1];
    if (last?.type === 'summoned' || last?.type === 'specialSummoned' || last?.type === 'normalSummoned') {
      return `${(last.card as CardInstance)?.name ?? 'A monster'} was summoned. Respond?`;
    }
    return 'Respond?';
  }

  async resolveChain() {
    this.resolvingChain = true;
    this.recentEvents = [];
    const resolved: ChainLink[] = [];
    try {
      while (this.chain.length) {
        const link = this.chain[this.chain.length - 1];
        this.resolvingLink = link;
        await this.anim({ type: 'resolve', card: link.card.uid, chainIndex: link.index });
        if (link.negated) {
          this.log(`Chain Link ${link.index} (${link.card.name}) is negated.`, 'chain');
        } else {
          await this.resolveLink(link);
        }
        this.chain.pop();
        resolved.push(link);
      }
    } finally {
      this.resolvingLink = null;
      this.resolvingChain = false;
    }
    // Send resolved normal spells/traps to the graveyard.
    const toGrave: CardInstance[] = [];
    for (const l of resolved) {
      const c = l.card;
      if (!l.isCardActivation) continue;
      if (!c.onField || !c.faceUp) continue;
      const stays =
        (c.isSpell && ['continuous', 'equip', 'field'].includes(c.data.stype ?? '')) ||
        (c.isTrap && c.data.ttype === 'continuous') ||
        c.flags.staysOnField;
      if (c.isSpell && c.data.stype === 'equip' && c.equippedTo == null) {
        toGrave.push(c);
        continue;
      }
      if (!stays || l.negated) toGrave.push(c);
    }
    if (toGrave.length) await this.moveCards(toGrave, 'grave', { reason: 'rule', minor: true, noAnim: false });
    await this.anim({ type: 'chainEnd' });
    this.update();
  }

  private async resolveLink(link: ChainLink) {
    const { card, effect: ef, ctx } = link;
    // Continuous / equip / field cards must still be on the field to resolve
    if (link.isCardActivation) {
      const lasting =
        (card.isSpell && ['continuous', 'equip', 'field'].includes(card.data.stype ?? '')) ||
        (card.isTrap && card.data.ttype === 'continuous');
      if (lasting && (!card.onField || !card.faceUp)) {
        this.log(`${card.name} is no longer on the field; its effect does not resolve.`, 'chain');
        return;
      }
      if ((card.isTrap && this.queryPlayer(link.player, 'cannotActivateTraps') && card.onField) || this.isNegated(card)) {
        this.log(`${card.name}'s effect is negated.`, 'chain');
        return;
      }
    } else if (link.fromLocation === 'mzone' && card.location === 'mzone' && card.faceUp && this.isNegated(card)) {
      this.log(`${card.name}'s effect is negated.`, 'chain');
      return;
    }
    this.log(`Resolving ${card.name}${ef.label && !link.isCardActivation ? ` (${ef.label})` : ''}.`, 'chain', link.player);
    try {
      if (ef.resolve) await ef.resolve(ctx);
    } catch (e) {
      if (e instanceof GameOver) throw e;
      console.error('resolve error', card.name, e);
      this.log(`[engine] Error resolving ${card.name}: ${(e as Error).message}`, 'system');
    }
    if (link.isCardActivation && card.onField && card.faceUp) {
      const lasting =
        (card.isSpell && ['continuous', 'equip', 'field'].includes(card.data.stype ?? '')) ||
        (card.isTrap && card.data.ttype === 'continuous');
      if (lasting) card.activeOnField = true;
    }
    this.update();
  }

  negateLink(link: ChainLink, destroy = false, by?: CardInstance) {
    link.negated = true;
    this.log(`${link.card.name}'s activation is negated${by ? ` by ${by.name}` : ''}.`, 'chain');
    void this.anim({ type: 'negate', card: link.card.uid });
    if (destroy) link.ctx.data.__destroyOnNegate = true;
  }

  // -------------------------------------------------------------------------
  // Trigger processing (SEGOC)
  // -------------------------------------------------------------------------

  /** Build chains from pending triggers and open response windows. */
  async processTriggers(openResponse = true, responseFirst?: PlayerId) {
    let loops = 0;
    let respondedOnce = false;
    while (loops++ < 30) {
      if (this.over) return;
      const built = await this.buildTriggerChain();
      if (built) {
        await this.runChain();
        respondedOnce = false;
        continue;
      }
      if (openResponse && !respondedOnce && this.recentEvents.length && this.recentEvents.some((e) => !e.minor)) {
        respondedOnce = true;
        const first = responseFirst ?? this.opp(this.turnPlayer);
        await this.responseLoop('response', first);
        if (this.chain.length) {
          await this.resolveChain();
          respondedOnce = false;
          continue;
        }
      }
      break;
    }
  }

  private async buildTriggerChain(): Promise<boolean> {
    if (!this.pending.length) return false;
    const pend = this.pending;
    this.pending = [];
    const valid: (PendingTrigger & { ctx: Ctx })[] = [];
    for (const t of pend) {
      const { card, effect: ef, effectIndex: idx } = t;
      const sameDamageStep = t.event.dsId !== undefined && t.event.dsId === this.lastDsId;
      if (ef.when && !ef.mandatory && t.event.batch !== this.lastBatch && !sameDamageStep) continue; // missed timing
      const player = t.player;
      if (ef.opt && this.isOptUsed(this.optKey(card, ef, idx, player))) continue;
      // monster on field must still be face-up and not negated
      if (card.location === 'mzone' && !card.faceUp && t.event.type !== 'flipped') continue;
      if (card.location === 'mzone' && this.isNegated(card)) continue;
      const ctx = new Ctx(this, card, ef, player);
      ctx.event = t.event;
      ctx.effectIndex = idx;
      try {
        if (ef.condition && !ef.condition(ctx)) continue;
        if (ef.canActivate && !ef.canActivate(ctx)) continue;
      } catch (e) {
        console.error(e);
        continue;
      }
      // dedupe: same card & effect only once per batch
      if (valid.some((v) => v.card === card && v.effectIndex === idx)) continue;
      valid.push({ ...t, ctx });
    }
    if (!valid.length) return false;
    const tp = this.turnPlayer;
    const ntp = this.opp(tp);
    const order = [
      ...valid.filter((v) => v.player === tp && v.effect.mandatory),
      ...valid.filter((v) => v.player === ntp && v.effect.mandatory),
      ...valid.filter((v) => v.player === tp && !v.effect.mandatory),
      ...valid.filter((v) => v.player === ntp && !v.effect.mandatory),
    ];
    let any = false;
    for (const t of order) {
      const act: Activation = { card: t.card, effect: t.effect, effectIndex: t.effectIndex, label: t.effect.label ?? 'Trigger', event: t.event };
      if (!t.effect.mandatory) {
        // re-check cost availability now (things may have changed while building)
        if (t.effect.canActivate && !t.effect.canActivate(t.ctx)) continue;
        const yes = await this.controllers[t.player].confirmTrigger(this, t.player, act);
        if (!yes) continue;
      }
      const link = await this.activate(t.player, act);
      if (link) any = true;
    }
    return any;
  }

  // -------------------------------------------------------------------------
  // Summoning
  // -------------------------------------------------------------------------

  tributesNeeded(card: CardInstance): number {
    const lv = card.data.level ?? 0;
    if (card.flags.noTribute) return 0;
    if (lv >= 7) return 2;
    if (lv >= 5) return 1;
    return 0;
  }

  tributeCandidates(p: PlayerId, forCard?: CardInstance) {
    return this.monsters(p).filter((c) => !this.queryCard(c, 'cannotBeTributed') && !c.flags.noTributeSummonFodder);
  }

  canNormalSummon(p: PlayerId, card: CardInstance, set = false): boolean {
    if (card.location !== 'hand' || !card.isMonster) return false;
    if (card.isExtra || card.data.cannotNormalSummon) return false;
    if (this.players[p].normalSummonsLeft <= 0) return false;
    if (!set && this.queryPlayer(p, 'cannotNormalSummon')) return false;
    if (set && this.queryPlayer(p, 'cannotSet')) return false;
    const need = this.tributesNeeded(card);
    if (need === 0) return this.freeMZones(p) > 0;
    const trib = this.tributeCandidates(p, card);
    return trib.length >= need;
  }

  /** Normal Summon or Set a monster (handles tributes). */
  async normalSummon(p: PlayerId, card: CardInstance, set: boolean) {
    const need = this.tributesNeeded(card);
    let tributes: CardInstance[] = [];
    if (need > 0) {
      tributes = await this.select(p, this.tributeCandidates(p, card), need, need, `Select ${need} monster(s) to Tribute for ${card.name}.`, 'tribute');
      if (tributes.length < need) return;
      this.log(`${this.players[p].name} Tributes ${tributes.map((t) => t.name).join(', ')}.`, 'action', p);
      await this.moveCards(tributes, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: p, reasonCard: card });
    }
    this.players[p].normalSummonsLeft--;
    this.recentEvents = [];
    this.beginBatch();
    this.rawMove(card, 'mzone', { controller: p, faceUp: !set, pos: set ? 'def' : 'atk' });
    card.summonTurn = this.turn;
    card.setTurn = set ? this.turn : -1;
    card.summonMethod = set ? 'set' : need ? 'tribute' : 'normal';
    card.flags.tributeCount = tributes.length;
    card.flags.tributedMonsters = tributes.map((t) => ({ uid: t.uid, attribute: t.data.attribute, name: t.name, race: t.data.race }));
    if (set) {
      this.log(`${this.players[p].name} Sets a monster.`, 'action', p);
      await this.anim({ type: 'summon', cards: [card.uid], method: 'set', from: ['hand'] });
      this.emit({ type: 'monsterSet', card, player: p });
      await this.processTriggers(true);
      return;
    }
    this.log(`${this.players[p].name} ${need ? 'Tribute' : 'Normal'} Summons ${card.name}.`, 'action', p);
    await this.anim({ type: 'summon', cards: [card.uid], method: need ? 'tribute' : 'normal', from: ['hand'] });
    if (await this.summonNegationWindow([card], p, need ? 'tribute' : 'normal')) return;
    this.beginBatch();
    const common = { card, player: p, from: 'hand' as Location, to: 'mzone' as Location, tributes, method: (need ? 'tribute' : 'normal') as GameEvent['method'] };
    this.emit({ type: 'normalSummoned', ...common });
    if (need) this.emit({ type: 'tributeSummoned', ...common });
    this.emit({ type: 'summoned', ...common });
    await this.processTriggers(true);
  }

  /** Window where summons can be negated (Solemn Judgment etc.). Returns true if negated. */
  async summonNegationWindow(cards: CardInstance[], player: PlayerId, method: string): Promise<boolean> {
    this.pendingSummon = { cards, player, method, negated: false };
    try {
      const opp = this.opp(player);
      // Only the window where counter traps can be used.
      await this.responseLoop('summonNegation', opp);
      if (this.chain.length) await this.resolveChain();
      if (this.pendingSummon.negated) {
        this.log(`The summon of ${cards.map((c) => c.name).join(', ')} is negated.`, 'chain');
        const still = cards.filter((c) => c.location === 'mzone');
        if (still.length) await this.destroy(still, 'rule');
        return true;
      }
      return false;
    } finally {
      this.pendingSummon = null;
    }
  }

  negateAttack() {
    if (this.battle) {
      this.battle.negated = true;
      this.log(`The attack of ${this.battle.attacker.name} is negated.`, 'battle');
      this.beginBatch();
      this.emit({ type: 'attackNegated', card: this.battle.attacker });
    }
  }

  negatePendingSummon() {
    if (this.pendingSummon) this.pendingSummon.negated = true;
  }

  async flipSummon(p: PlayerId, card: CardInstance) {
    this.recentEvents = [];
    card.pos = 'atk';
    card.faceUp = true;
    card.posChangedTurn = this.turn;
    this.log(`${this.players[p].name} Flip Summons ${card.name}.`, 'action', p);
    await this.anim({ type: 'flip', card: card.uid, pos: 'atk', faceUp: true });
    if (await this.summonNegationWindow([card], p, 'flip')) return;
    this.beginBatch();
    const common = { card, player: p, method: 'flip' as const };
    this.emit({ type: 'flipSummoned', ...common });
    this.emit({ type: 'flipped', ...common });
    this.emit({ type: 'summoned', ...common });
    await this.processTriggers(true);
  }

  /** Special Summon via an inherent procedure (no chain; can be negated by Solemn). */
  async inherentSpecialSummon(
    p: PlayerId,
    card: CardInstance,
    method: 'special' | 'synchro' | 'fusion' = 'special',
    pos: BattlePos | 'choose' = 'choose',
    extraFlags: Record<string, any> = {},
  ) {
    if (this.queryPlayer(p, 'cannotSpecialSummon')) return false;
    let position: BattlePos = 'atk';
    if (pos === 'choose') {
      const r = await this.controllers[p].choosePosition(this, p, card, ['atk', 'def']);
      position = r === 'set' ? 'def' : r;
    } else position = pos;
    const from = card.location;
    this.beginBatch();
    this.rawMove(card, 'mzone', { controller: p, faceUp: true, pos: position });
    card.summonTurn = this.turn;
    card.summonMethod = method;
    card.properlySummoned = true;
    Object.assign(card.flags, extraFlags);
    this.log(`${this.players[p].name} Special Summons ${card.name}${method !== 'special' ? ` (${method[0].toUpperCase() + method.slice(1)} Summon)` : ''}.`, 'action', p);
    await this.anim({ type: 'summon', cards: [card.uid], method, from: [from] });
    if (await this.summonNegationWindow([card], p, method)) return false;
    this.beginBatch();
    const common = { card, player: p, from, to: 'mzone' as Location, method };
    this.emit({ type: 'specialSummoned', ...common });
    if (method === 'synchro') this.emit({ type: 'synchroSummoned', ...common });
    if (method === 'fusion') this.emit({ type: 'fusionSummoned', ...common });
    this.emit({ type: 'summoned', ...common });
    return true;
  }

  // ---- Synchro -------------------------------------------------------------

  /** All valid synchro material combinations for `synchro` controlled by p. */
  synchroCombos(p: PlayerId, synchro: CardInstance, mustInclude?: CardInstance): CardInstance[][] {
    const req = synchro.data.synchro;
    if (!req) return [];
    const lv = synchro.data.level ?? 0;
    const mons = this.faceUpMonsters(p).filter((c) => !this.queryCard(c, 'cannotBeSynchroMaterial') && !c.flags.noSynchroMaterial);
    const tuners = mons.filter((c) => c.isTuner && (!req.tuner || req.tuner(c)));
    const combos: CardInstance[][] = [];
    for (const t of tuners) {
      const nonT = mons.filter((c) => c !== t && !c.isTuner && (!req.nonTuner || req.nonTuner(c)));
      // Some tuners can also be non-tuners (treat tuners as non-tuners when allowed? Not in this era)
      const minN = req.minNonTuners ?? 1;
      const maxN = req.maxNonTuners ?? 99;
      const n = nonT.length;
      for (let mask = 1; mask < 1 << n; mask++) {
        const sel: CardInstance[] = [];
        for (let i = 0; i < n; i++) if (mask & (1 << i)) sel.push(nonT[i]);
        if (sel.length < minN || sel.length > maxN) continue;
        const total = this.getLevel(t) + sel.reduce((a, c) => a + this.getLevel(c), 0);
        if (total !== lv) continue;
        const combo = [t, ...sel];
        if (combo.some((c) => c.data.synchroMaterialCheck && !c.data.synchroMaterialCheck(synchro, combo, c))) continue;
        if (mustInclude && !combo.includes(mustInclude)) continue;
        combos.push(combo);
      }
    }
    return combos;
  }

  canSynchro(p: PlayerId, synchro: CardInstance) {
    if (synchro.location !== 'extra' || !synchro.hasType('synchro')) return false;
    if (this.queryPlayer(p, 'cannotSpecialSummon')) return false;
    return this.synchroCombos(p, synchro).length > 0;
  }

  /** Let a player pick one combination from a list incrementally. */
  async pickCombo(p: PlayerId, combos: CardInstance[][], prompt: string, purpose: SelectPurpose = 'material'): Promise<CardInstance[] | null> {
    if (!combos.length) return null;
    if (combos.length === 1) {
      return combos[0];
    }
    const sel: CardInstance[] = [];
    for (let guard = 0; guard < 12; guard++) {
      const consistent = combos.filter((c) => sel.every((s) => c.includes(s)));
      const complete = consistent.find((c) => c.length === sel.length);
      const cands = [...new Set(consistent.flatMap((c) => c.filter((x) => !sel.includes(x))))];
      if (!cands.length) return complete ?? null;
      if (consistent.length === 1 && complete === undefined) {
        // only one way to finish
        return consistent[0];
      }
      const picked = await this.controllers[p].selectCards(this, p, {
        prompt: `${prompt} (${sel.length} selected)`,
        candidates: cands,
        min: complete ? 0 : 1,
        max: 1,
        purpose,
        cancelable: sel.length === 0,
      });
      if (!picked.length) {
        if (complete) return complete;
        return null;
      }
      sel.push(picked[0]);
    }
    return null;
  }

  async synchroSummon(p: PlayerId, synchro: CardInstance, forced?: CardInstance[]): Promise<boolean> {
    const combos = this.synchroCombos(p, synchro);
    const mats = forced ?? (await this.pickCombo(p, combos, `Select Synchro Materials for ${synchro.name}`));
    if (!mats) return false;
    this.recentEvents = [];
    this.log(`${this.players[p].name} Synchro Summons ${synchro.name} using ${mats.map((m) => m.name).join(', ')}.`, 'action', p);
    await this.moveCards(mats, 'grave', { reason: 'synchro', reasons: ['synchro', 'material'], reasonPlayer: p, reasonCard: synchro });
    const materials = mats.map((m) => ({ uid: m.uid, name: m.name, attribute: m.data.attribute, race: m.data.race, level: m.data.level, card: m }));
    const ok = await this.inherentSpecialSummon(p, synchro, 'synchro', 'choose', { materials });
    await this.processTriggers(true);
    return ok;
  }

  // ---- Fusion --------------------------------------------------------------

  fusionMaterialSets(fusion: CardInstance, pool: CardInstance[]): CardInstance[][] {
    const req = fusion.data.fusion;
    if (!req) return [];
    const out: CardInstance[][] = [];
    const n = req.materials.length;
    const rec = (i: number, used: CardInstance[]) => {
      if (out.length > 60) return;
      if (i === n) {
        out.push([...used]);
        return;
      }
      for (const c of pool) {
        if (used.includes(c)) continue;
        if (!req.materials[i](c)) continue;
        used.push(c);
        rec(i + 1, used);
        used.pop();
      }
    };
    rec(0, []);
    // dedupe by set
    const seen = new Set<string>();
    return out.filter((s) => {
      const k = s.map((c) => c.uid).sort().join(',');
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // Turn structure
  // -------------------------------------------------------------------------

  async start(): Promise<{ winner: PlayerId | null; reason: string; turns: number }> {
    try {
      await this.setup();
      for (;;) {
        await this.playTurn();
        if (this.turn >= this.options.maxTurns) this.endGame(null, 'Turn limit reached');
      }
    } catch (e) {
      if (e instanceof GameOver) return { winner: e.winner, reason: e.reason, turns: this.turn };
      throw e;
    }
  }

  private async setup() {
    this.shuffleDeck(0);
    this.shuffleDeck(1);
    let first: PlayerId = this.options.firstPlayer as PlayerId;
    if ((first as number) !== 0 && (first as number) !== 1) first = this.rng.int(2) as PlayerId;
    this.firstPlayer = first;
    this.log(`${this.players[first].name} goes first.`, 'system');
    await this.anim({ type: 'coin', player: first });
    for (const p of [0, 1] as PlayerId[]) {
      const deck = this.players[p].deck;
      const hand = deck.splice(Math.max(0, deck.length - 5), 5).reverse();
      for (const c of hand) {
        c.location = 'hand';
        this.players[p].hand.push(c);
      }
    }
    await this.anim({ type: 'draw', player: 0, cards: this.players[0].hand.map((c) => c.uid), opening: true });
    await this.anim({ type: 'draw', player: 1, cards: this.players[1].hand.map((c) => c.uid), opening: true });
    this.turnPlayer = this.opp(first);
  }

  private async setPhase(ph: Phase) {
    this.phase = ph;
    this.recentEvents = [];
    this.log(`${phaseName(ph)}`, 'phase', this.turnPlayer);
    await this.anim({ type: 'phase', phase: ph, player: this.turnPlayer });
    this.beginBatch();
    this.emit({ type: 'phaseStart', phase: ph, player: this.turnPlayer });
    // run delayed effects scheduled for this phase
    const due = this.delayed.filter((d) => d.phase === ph && d.turn <= this.turn);
    this.delayed = this.delayed.filter((d) => !due.includes(d));
    for (const d of due) await d.fn();
    await this.processTriggers(false);
  }

  /** Window at a phase where both players (non-turn player first) may activate quick effects. */
  async phaseWindow() {
    if (this.over) return;
    this.recentEvents = [];
    await this.responseLoop('phase', this.opp(this.turnPlayer));
    if (this.chain.length) await this.resolveChain();
    else this.recentEvents = [];
    await this.processTriggers(true);
  }

  async playTurn() {
    this.turn++;
    this.turnPlayer = this.opp(this.turnPlayer);
    const tp = this.turnPlayer;
    this.turnData = {};
    this.players[tp].normalSummonsLeft = 1;
    this.actionCounter = 0;
    for (const c of this.allCards) {
      c.attacksThisTurn = 0;
      c.attackedThisTurnOrWasAttacked = false;
    }
    this.log(`— Turn ${this.turn}: ${this.players[tp].name} —`, 'phase', tp);
    await this.anim({ type: 'turn', player: tp, turn: this.turn });

    // Draw Phase
    this.phase = 'draw';
    await this.setPhase('draw');
    if (!(this.turn === 1 && this.options.skipFirstDraw)) {
      this.beginBatch();
      await this.draw(tp, 1);
      await this.processTriggers(true);
    }
    await this.phaseWindow();

    // Standby
    await this.setPhase('standby');
    await this.phaseWindow();

    // Main 1
    await this.setPhase('main1');
    let next = await this.mainPhase();

    if (next === 'battle' && this.turn > 1) {
      await this.battlePhase();
      if (!this.turnData.skipMain2) {
        await this.setPhase('main2');
        next = await this.mainPhase();
      }
    }

    // End Phase
    await this.setPhase('end');
    await this.phaseWindow();
    // hand size
    const hand = this.players[tp].hand;
    if (hand.length > HAND_LIMIT) {
      const n = hand.length - HAND_LIMIT;
      const disc = await this.select(tp, hand, n, n, `Discard ${n} card(s) for hand size limit.`, 'discard');
      await this.discard(disc, 'rule', tp);
      await this.processTriggers(false);
    }
    // expire temp mods
    for (const c of this.allCards) {
      c.tempMods = c.tempMods.filter((t) => t.until === 'field' || (t.until === 'opponentEnd' && t.turn === this.turn));
    }
    this.playerMods = this.playerMods.filter((m) => m.until === 'nextTurnEnd' && m.turn === this.turn);
    this.update();
  }

  /** Main phase loop. Returns the phase the player moves to. */
  async mainPhase(): Promise<'battle' | 'end'> {
    const tp = this.turnPlayer;
    for (;;) {
      if (this.over) return 'end';
      if (++this.actionCounter > 250) return 'end';
      const actions = this.legalMainActions(tp);
      const a = await this.controllers[tp].chooseAction(this, tp, actions);
      if (a.type === 'phase') {
        if (a.to === 'battle' && this.phase === 'main1' && this.turn > 1) return 'battle';
        return 'end';
      }
      if (a.type === 'surrender') this.lose(tp, 'Surrendered');
      await this.performAction(tp, a);
    }
  }

  legalMainActions(p: PlayerId): Action[] {
    const out: Action[] = [];
    const ps = this.players[p];
    for (const c of ps.hand) {
      if (c.isMonster) {
        if (this.canNormalSummon(p, c, false)) out.push({ type: 'summon', card: c });
        if (this.canNormalSummon(p, c, true)) out.push({ type: 'set', card: c });
      } else {
        const canSet = c.data.stype === 'field' ? true : this.freeSZones(p) > 0;
        if (canSet && !this.queryPlayer(p, 'cannotSet')) out.push({ type: 'setST', card: c });
      }
    }
    // procs
    for (const c of [...ps.hand, ...ps.grave, ...ps.extra, ...ps.banished, ...this.monsters(p)]) {
      const effs = c.data.effects ?? [];
      effs.forEach((ef, i) => {
        if (ef.kind !== 'proc') return;
        if (this.canProc(p, c, ef, i)) out.push({ type: 'proc', card: c, act: { card: c, effect: ef, effectIndex: i, label: ef.label ?? 'Special Summon' } });
      });
    }
    for (const c of ps.extra) {
      if (c.hasType('synchro') && this.freeMZones(p) >= 0 && this.canSynchro(p, c)) out.push({ type: 'synchro', card: c });
    }
    for (const c of this.monsters(p)) {
      if (!c.faceUp && c.setTurn !== this.turn && c.summonTurn !== this.turn && c.posChangedTurn !== this.turn) {
        out.push({ type: 'flip', card: c });
      } else if (c.faceUp && c.summonTurn !== this.turn && c.posChangedTurn !== this.turn && c.attacksThisTurn === 0 && !this.queryCard(c, 'cannotChangePos')) {
        out.push({ type: 'position', card: c });
      }
    }
    for (const act of this.getActivations(p, { open: true })) {
      out.push({ type: 'activate', card: act.card, act });
    }
    if (this.phase === 'main1' && this.turn > 1 && !this.queryPlayer(p, 'cannotDeclareAttack')) out.push({ type: 'phase', to: 'battle' });
    out.push({ type: 'phase', to: 'end' });
    return out;
  }

  canProc(p: PlayerId, c: CardInstance, ef: EffectDef, idx: number): boolean {
    const range = this.defaultRange(c, ef);
    if (!range.includes(c.location)) return false;
    if (this.chain.length) return false;
    if (this.queryPlayer(p, 'cannotSpecialSummon')) return false;
    if (c.location === 'mzone') {
      // e.g. contact fusion from field, handled via extra deck card; not supported here
      return false;
    }
    if (this.cardUser(c) !== p) return false;
    if (ef.opt && this.isOptUsed(this.optKey(c, ef, idx, p))) return false;
    const ctx = new Ctx(this, c, ef, p);
    ctx.effectIndex = idx;
    try {
      if (ef.condition && !ef.condition(ctx)) return false;
      if (ef.canActivate && !ef.canActivate(ctx)) return false;
    } catch (e) {
      console.error(e);
      return false;
    }
    // Need a free zone unless the proc frees one (perform handles it) – require canActivate to check when relevant.
    return true;
  }

  async performAction(p: PlayerId, a: Action) {
    this.recentEvents = [];
    switch (a.type) {
      case 'summon':
        return this.normalSummon(p, a.card, false);
      case 'set':
        return this.normalSummon(p, a.card, true);
      case 'flip':
        return this.flipSummon(p, a.card);
      case 'position': {
        const c = a.card;
        c.posChangedTurn = this.turn;
        this.log(`${this.players[p].name} changes ${c.name} to ${c.pos === 'atk' ? 'Defense' : 'Attack'} Position.`, 'action', p);
        await this.changePosition(c, c.pos === 'atk' ? 'def' : 'atk', true, p);
        c.posChangedTurn = this.turn;
        await this.processTriggers(false);
        return;
      }
      case 'setST': {
        const c = a.card;
        if (c.data.stype === 'field') {
          const old = this.players[p].fzone;
          if (old) await this.moveCards([old], 'grave', { reason: 'rule' });
          this.rawMove(c, 'fzone', { controller: p, faceUp: false });
        } else {
          this.rawMove(c, 'szone', { controller: p, faceUp: false });
        }
        c.setTurn = this.turn;
        this.log(`${this.players[p].name} Sets a card in the Spell & Trap Zone.`, 'action', p);
        await this.anim({ type: 'move', cards: [{ uid: c.uid, from: 'hand', to: c.location, ctrl: p }], set: true });
        this.update();
        return;
      }
      case 'activate': {
        const link = await this.activate(p, a.act);
        if (link) {
          await this.runChain();
          await this.processTriggers(true);
        }
        return;
      }
      case 'proc': {
        const { card, effect: ef, effectIndex: idx } = a.act;
        const ctx = new Ctx(this, card, ef, p);
        ctx.effectIndex = idx;
        if (ef.opt) this.useOpt(this.optKey(card, ef, idx, p));
        const ok = ef.perform ? await ef.perform(ctx) : true;
        if (!ok) {
          if (ef.opt) this.clearOpt(this.optKey(card, ef, idx, p));
          return;
        }
        if (this.freeMZones(p) <= 0) return;
        const pos = ef.procPositions && ef.procPositions.length === 1 ? ef.procPositions[0] : 'choose';
        const method = card.hasType('fusion') ? 'fusion' : card.hasType('synchro') ? 'synchro' : 'special';
        await this.inherentSpecialSummon(p, card, method === 'synchro' ? 'special' : method, pos);
        await this.processTriggers(true);
        return;
      }
      case 'synchro':
        await this.synchroSummon(p, a.card);
        return;
      case 'attack':
        await this.conductAttack(p, a.card);
        return;
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Battle
  // -------------------------------------------------------------------------

  canAttack(c: CardInstance): boolean {
    if (c.location !== 'mzone' || !c.faceUp || c.pos !== 'atk') return false;
    if (c.controller !== this.turnPlayer) return false;
    if (this.queryCard(c, 'cannotAttack')) return false;
    if (c.flags.cannotAttackTurn === this.turn) return false;
    const max = 1 + this.queryCardNum(c, 'extraAttacks');
    return c.attacksThisTurn < max;
  }

  attackTargets(attacker: CardInstance): { targets: CardInstance[]; direct: boolean } {
    const opp = this.opp(attacker.controller);
    const mons = this.monsters(opp);
    let targets = mons.filter((m) => !this.queryCard(m, 'cannotBeAttacked'));
    const must = targets.filter((m) => m.faceUp && this.queryCard(m, 'mustBeAttacked'));
    if (must.length) targets = must;
    const direct = mons.length === 0 || this.queryCard(attacker, 'directAttack') || (targets.length === 0 && mons.length > 0 && false);
    return { targets, direct };
  }

  async battlePhase() {
    const tp = this.turnPlayer;
    await this.setPhase('battle');
    await this.phaseWindow();
    for (;;) {
      if (this.over) return;
      if (++this.actionCounter > 250) break;
      const actions: Action[] = [];
      if (!this.queryPlayer(tp, 'cannotDeclareAttack')) {
        for (const c of this.monsters(tp)) {
          if (!this.canAttack(c)) continue;
          const t = this.attackTargets(c);
          if (t.targets.length || t.direct) actions.push({ type: 'attack', card: c });
        }
      }
      for (const act of this.getActivations(tp, { open: true })) actions.push({ type: 'activate', card: act.card, act });
      actions.push({ type: 'phase', to: 'main2' });
      actions.push({ type: 'phase', to: 'end' });
      const a = await this.controllers[tp].chooseAction(this, tp, actions);
      if (a.type === 'phase') {
        if (a.to === 'end') this.turnData.skipMain2 = true;
        break;
      }
      if (a.type === 'surrender') this.lose(tp, 'Surrendered');
      await this.performAction(tp, a);
    }
    // End of battle phase
    this.recentEvents = [];
    this.beginBatch();
    this.emit({ type: 'battleEnd', player: tp, phase: 'battle' });
    await this.processTriggers(true);
  }

  async conductAttack(p: PlayerId, attacker: CardInstance) {
    const opp = this.opp(p);
    const { targets, direct } = this.attackTargets(attacker);
    const choice = await this.controllers[p].chooseAttackTarget(this, p, attacker, targets, direct);
    if (choice === 'cancel') return;
    if (choice === null && !direct) return;
    const target = choice;
    attacker.attacksThisTurn++;
    attacker.attackedThisTurnOrWasAttacked = true;
    if (target) target.attackedThisTurnOrWasAttacked = true;
    this.battle = {
      attacker,
      target,
      attackerMoveId: attacker.moveId,
      targetMoveId: target?.moveId ?? -1,
      negated: false,
      inDamageStep: false,
      oppMonsterCount: this.monsters(opp).length,
    };
    this.recentEvents = [];
    this.log(
      `${attacker.name} attacks ${target ? (target.faceUp ? target.name : 'a face-down monster') : 'directly'}!`,
      'battle',
      p,
    );
    await this.anim({ type: 'attack', attacker: attacker.uid, target: target?.uid ?? null, player: p });
    this.beginBatch();
    this.emit({ type: 'attackDeclared', card: attacker, other: target ?? undefined, player: p });
    // triggers + attack window
    let built = 0;
    while (built++ < 10) {
      const b = await this.buildTriggerChainPublic();
      if (!b) break;
      await this.runChain();
    }
    await this.responseLoop('attack', opp);
    if (this.chain.length) await this.resolveChain();
    else this.recentEvents = []; // both passed: don't reopen the same window
    await this.processTriggers(true);

    try {
      const b = this.battle;
      if (!b || b.negated) return;
      if (attacker.location !== 'mzone' || attacker.moveId !== b.attackerMoveId || attacker.controller !== p || attacker.pos !== 'atk' || !attacker.faceUp) return;
      // Replay check
      const nowCount = this.monsters(opp).length;
      const targetGone = b.target && (b.target.location !== 'mzone' || b.target.moveId !== b.targetMoveId || b.target.controller !== opp);
      if (targetGone || nowCount !== b.oppMonsterCount) {
        const t2 = this.attackTargets(attacker);
        if (!t2.targets.length && !t2.direct) return;
        const again = await this.controllers[p].chooseAttackTarget(this, p, attacker, t2.targets, t2.direct);
        if (again === 'cancel' || (again === null && !t2.direct)) return;
        b.target = again;
        b.targetMoveId = again?.moveId ?? -1;
        this.log(`Replay: ${attacker.name} attacks ${again ? (again.faceUp ? again.name : 'a face-down monster') : 'directly'}.`, 'battle', p);
        await this.anim({ type: 'attack', attacker: attacker.uid, target: again?.uid ?? null, player: p });
      }
      await this.damageStep();
    } finally {
      this.battle = null;
      for (const c of this.allCards) c.tempMods = c.tempMods.filter((t) => t.until !== 'battle');
      this.update();
    }
  }

  /** public wrapper for trigger chain building */
  async buildTriggerChainPublic() {
    return this.buildTriggerChain();
  }

  private async damageStep() {
    const b = this.battle!;
    const { attacker } = b;
    const p = attacker.controller;
    const opp = this.opp(p);
    b.inDamageStep = true;
    this.damageStepId++;
    let target = b.target;
    this.recentEvents = [];
    if (target && !target.faceUp) {
      // flip face-up (flip effects resolve after damage calculation)
      target.faceUp = true;
      this.beginBatch();
      await this.anim({ type: 'flip', card: target.uid, pos: target.pos, faceUp: true });
      this.log(`${target.name} is flipped face-up.`, 'battle');
      this.emit({ type: 'flipped', card: target, reasonPlayer: p });
    }
    const flipPending = this.pending;
    this.pending = [];
    // Damage step window (before damage calculation)
    this.beginBatch();
    await this.responseLoop('damage', p);
    if (this.chain.length) await this.resolveChain();
    this.pending.push(...flipPending);
    if (b.negated) {
      await this.processTriggers(false);
      return;
    }
    if (attacker.location !== 'mzone' || attacker.moveId !== b.attackerMoveId || attacker.pos !== 'atk') {
      await this.processTriggers(false);
      return;
    }
    if (target && (target.location !== 'mzone' || target.moveId !== b.targetMoveId)) {
      await this.processTriggers(false);
      return;
    }
    // Damage calculation
    const atkA = this.getAtk(attacker);
    const losers: { card: CardInstance; by: CardInstance }[] = [];
    let dmg: { player: PlayerId; amount: number } | null = null;
    if (!target) {
      dmg = { player: opp, amount: atkA };
    } else if (target.pos === 'atk') {
      const atkT = this.getAtk(target);
      if (atkA > atkT) {
        losers.push({ card: target, by: attacker });
        dmg = { player: opp, amount: atkA - atkT };
      } else if (atkA < atkT) {
        losers.push({ card: attacker, by: target });
        dmg = { player: p, amount: atkT - atkA };
      } else if (atkA > 0) {
        losers.push({ card: target, by: attacker }, { card: attacker, by: target });
      }
    } else {
      const defT = this.getDef(target);
      if (atkA > defT) {
        losers.push({ card: target, by: attacker });
        if (this.queryCard(attacker, 'piercing')) dmg = { player: opp, amount: atkA - defT };
      } else if (atkA < defT) {
        dmg = { player: p, amount: defT - atkA };
      }
    }
    this.log(
      target
        ? `Damage calculation: ${attacker.name} (${atkA}) vs ${target.name} (${target.pos === 'atk' ? this.getAtk(target) : this.getDef(target)} ${target.pos === 'atk' ? 'ATK' : 'DEF'})`
        : `Damage calculation: ${attacker.name} (${atkA}) attacks directly`,
      'battle',
    );
    await this.anim({ type: 'battle', attacker: attacker.uid, target: target?.uid ?? null });
    if (dmg) {
      const involved = dmg.player === p ? attacker : target;
      const blocked =
        this.queryPlayer(dmg.player, 'noBattleDamage') ||
        (involved && this.queryCard(involved, 'noBattleDamageFrom')) ||
        (target && dmg.player === opp && this.queryCard(target, 'noBattleDamageFrom'));
      if (!blocked) {
        const src = dmg.player === p ? target ?? undefined : attacker;
        await this.damage(dmg.player, dmg.amount, 'battle', src, this.opp(dmg.player));
        this.turnData.battleDamageTo = this.turnData.battleDamageTo ?? {};
        this.turnData.battleDamageTo[dmg.player] = true;
      }
    }
    // Destroy losers
    const destroyGroup = losers.filter((l) => l.card.location === 'mzone' && this.canDestroy(l.card, 'battle'));
    if (destroyGroup.length) {
      this.beginBatch();
      const moved: { card: CardInstance; by: CardInstance; from: Location; ctrl: PlayerId }[] = [];
      for (const l of destroyGroup) {
        moved.push({ card: l.card, by: l.by, from: l.card.location, ctrl: l.card.controller });
        this.log(`${l.card.name} is destroyed by battle.`, 'battle', l.card.controller);
      }
      for (const m of moved) this.rawMove(m.card, 'grave');
      await this.anim({ type: 'destroy', cards: moved.map((m) => ({ uid: m.card.uid, from: m.from, to: m.card.location, ctrl: m.ctrl })), reason: 'battle' });
      for (const m of moved) {
        const common = { card: m.card, from: m.from as Location, to: m.card.location, fromController: m.ctrl, fromFaceUp: true, reason: 'battle' as Reason, reasons: ['battle', 'destroy'] as Reason[], reasonCard: m.by, reasonPlayer: m.by.controller, other: m.by };
        this.emit({ type: 'leftField', ...common });
        this.emit({ type: 'destroyed', ...common });
        this.emit({ type: 'battleDestroyed', ...common });
        if (m.card.location === 'grave') this.emit({ type: 'sentToGrave', ...common });
        if (m.card.location === 'banished') this.emit({ type: 'banished', ...common });
      }
      await this.ruleCleanup();
    }
    this.beginBatch();
    this.emit({ type: 'damageStepEnd', card: attacker, other: target ?? undefined, player: p, minor: true });
    b.inDamageStep = false;
    await this.processTriggers(true);
  }

  // -------------------------------------------------------------------------
  // Views for UI/AI
  // -------------------------------------------------------------------------

  isPublic(card: CardInstance, viewer: PlayerId) {
    if (card.location === 'grave' || card.location === 'banished') return card.faceUp;
    if (card.onField) return card.faceUp || card.controller === viewer;
    if (card.location === 'hand') return card.owner === viewer || card.revealedUntil >= this.turn;
    if (card.location === 'extra') return card.owner === viewer;
    return false;
  }
}

export function phaseName(p: Phase) {
  return {
    draw: 'Draw Phase',
    standby: 'Standby Phase',
    main1: 'Main Phase 1',
    battle: 'Battle Phase',
    main2: 'Main Phase 2',
    end: 'End Phase',
  }[p];
}

export type { EventType };
