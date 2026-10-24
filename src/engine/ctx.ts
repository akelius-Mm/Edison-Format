import type { CardData, CardInstance, EffectDef, QueryKey, TempMod } from './card';
import type { SelectPurpose } from './controller';
import type { ChainLink, Game } from './game';
import type { BattlePos, GameEvent, Location, PlayerId, Reason } from './types';

type Side = 'me' | 'opp' | 'both';
type Filter = (c: CardInstance) => boolean;

/**
 * Effect context: everything a card script needs while checking/activating/resolving.
 * One Ctx is created per activation and lives on the chain link.
 */
export class Ctx {
  event?: GameEvent;
  link?: ChainLink;
  effectIndex = 0;
  targets: CardInstance[] = [];
  private targetMoveIds = new Map<number, number>();
  /** Scratch space shared between activate() and resolve(). */
  data: Record<string, any> = {};

  constructor(
    public game: Game,
    public self: CardInstance,
    public effect: EffectDef,
    public player: PlayerId,
  ) {}

  // ---------------------------------------------------------------- basics
  get opp(): PlayerId {
    return this.game.opp(this.player);
  }
  get turn() {
    return this.game.turn;
  }
  get isMyTurn() {
    return this.game.turnPlayer === this.player;
  }
  get phase() {
    return this.game.phase;
  }
  get lp() {
    return this.game.players[this.player].lp;
  }
  get oppLp() {
    return this.game.players[this.opp].lp;
  }
  get battle() {
    return this.game.battle;
  }
  /** Player id from a side keyword. */
  pid(side: 'me' | 'opp'): PlayerId {
    return side === 'me' ? this.player : this.opp;
  }
  sides(side: Side): PlayerId[] {
    return side === 'both' ? [this.player, this.opp] : [this.pid(side)];
  }

  log(text: string) {
    this.game.log(text, 'action', this.player);
  }

  // --------------------------------------------------------------- queries
  cards(side: Side, locs: Location | Location[], filter?: Filter): CardInstance[] {
    const ls = Array.isArray(locs) ? locs : [locs];
    const out: CardInstance[] = [];
    for (const p of this.sides(side)) for (const l of ls) out.push(...this.game.zone(p, l));
    return filter ? out.filter(filter) : out;
  }
  monsters(side: Side = 'both', filter?: Filter) {
    return this.cards(side, 'mzone', filter);
  }
  faceUpMonsters(side: Side = 'both', filter?: Filter) {
    return this.cards(side, 'mzone', (c) => c.faceUp && (!filter || filter(c)));
  }
  spellTraps(side: Side = 'both', filter?: Filter) {
    return this.cards(side, ['szone', 'fzone'], filter);
  }
  field(side: Side = 'both', filter?: Filter) {
    return this.cards(side, ['mzone', 'szone', 'fzone'], filter);
  }
  hand(side: 'me' | 'opp' = 'me', filter?: Filter) {
    return this.cards(side, 'hand', filter);
  }
  grave(side: Side = 'me', filter?: Filter) {
    return this.cards(side, 'grave', filter);
  }
  deck(side: 'me' | 'opp' = 'me', filter?: Filter) {
    return this.cards(side, 'deck', filter);
  }
  banished(side: Side = 'me', filter?: Filter) {
    return this.cards(side, 'banished', filter);
  }
  extra(side: 'me' | 'opp' = 'me', filter?: Filter) {
    return this.cards(side, 'extra', filter);
  }
  freeMZones(side: 'me' | 'opp' = 'me') {
    return this.game.freeMZones(this.pid(side));
  }
  freeSZones(side: 'me' | 'opp' = 'me') {
    return this.game.freeSZones(this.pid(side));
  }
  atk(c: CardInstance) {
    return this.game.getAtk(c);
  }
  def(c: CardInstance) {
    return this.game.getDef(c);
  }
  level(c: CardInstance) {
    return this.game.getLevel(c);
  }
  isFaceUpOnField(c: CardInstance) {
    return c.onField && c.faceUp;
  }
  /** Does this player control the card? */
  mine(c: CardInstance) {
    return this.game.cardUser(c) === this.player;
  }
  canSpecialSummon(side: 'me' | 'opp' = 'me') {
    return !this.game.queryPlayer(this.pid(side), 'cannotSpecialSummon') && this.freeMZones(side) > 0;
  }
  /** Can the given card be Special Summoned by an effect right now (zone + restrictions + nomi). */
  canSummonCard(c: CardInstance, side: 'me' | 'opp' = 'me') {
    if (!this.canSpecialSummon(side)) return false;
    if (c.data.nomi && !c.properlySummoned && (c.location === 'grave' || c.location === 'banished')) return false;
    if (c.data.nomi && (c.location === 'hand' || c.location === 'deck')) return false;
    if (c.isExtra && c.location !== 'extra' && !c.properlySummoned) return false;
    return true;
  }
  /** Can the opponent's cards be affected/targeted by this effect. */
  canTarget(c: CardInstance) {
    if (c.onField && c.controller !== this.player && this.game.queryCard(c, 'untargetable')) return false;
    if (this.game.isUnaffected(c, this.self, this.player)) return false;
    return true;
  }
  isNegated(c: CardInstance) {
    return this.game.isNegated(c);
  }
  query(c: CardInstance, q: QueryKey) {
    return this.game.queryCard(c, q);
  }

  // ------------------------------------------------------------- selection
  async select(
    cands: CardInstance[],
    min: number,
    max: number,
    prompt: string,
    purpose: SelectPurpose = 'generic',
    extra: { cancelable?: boolean; aiScore?: (c: CardInstance) => number; player?: PlayerId } = {},
  ) {
    return this.game.select(extra.player ?? this.player, cands, min, max, prompt, purpose, { ...extra, source: this.self });
  }

  /** Select and lock targets. Returns the chosen targets. */
  async selectTargets(
    cands: CardInstance[],
    min: number,
    max: number,
    prompt: string,
    purpose: SelectPurpose = 'target',
    extra: { aiScore?: (c: CardInstance) => number } = {},
  ) {
    const ok = cands.filter((c) => this.canTarget(c));
    const sel = await this.select(ok, min, max, prompt, purpose, extra);
    this.addTargets(sel);
    return sel;
  }

  addTargets(cards: CardInstance[]) {
    for (const c of cards) {
      if (!this.targets.includes(c)) this.targets.push(c);
      this.targetMoveIds.set(c.uid, c.moveId);
    }
  }

  /** Targets that are still where they were when targeted. */
  validTargets(filter?: Filter) {
    return this.targets.filter(
      (c) => this.targetMoveIds.get(c.uid) === c.moveId && (!filter || filter(c)) && !this.game.isUnaffected(c, this.self, this.player),
    );
  }
  get target(): CardInstance | undefined {
    return this.validTargets()[0];
  }

  async confirm(prompt: string, aiDefault = true) {
    return this.game.confirm(this.player, prompt, this.self, aiDefault);
  }
  async option(prompt: string, options: string[], aiScore?: (i: number) => number) {
    return this.game.option(this.player, prompt, options, this.self, aiScore);
  }

  // ---------------------------------------------------------------- chain
  chainTop() {
    const ch = this.game.chain;
    return ch[ch.length - 1];
  }
  /** The chain link this effect is responding to (the one just below it). */
  prevLink(): ChainLink | undefined {
    const ch = this.game.chain;
    if (this.link) {
      const i = ch.indexOf(this.link);
      if (i > 0) return ch[i - 1];
      if (i === 0) return undefined;
    }
    return ch[ch.length - 1];
  }
  negate(link: ChainLink | undefined, destroyCard = false) {
    if (!link) return;
    this.game.negateLink(link, destroyCard, this.self);
  }
  /** Negate the activation of `link` and destroy the card if it is still around. */
  async negateAndDestroy(link: ChainLink | undefined) {
    if (!link) return;
    this.game.negateLink(link, true, this.self);
    if (link.card.onField || link.card.location === 'hand') {
      if (link.card.onField) await this.game.destroy([link.card], 'effect', this.player, this.self);
    }
  }

  // --------------------------------------------------------------- actions
  async draw(n = 1, p: PlayerId = this.player) {
    return this.game.draw(p, n, 'effect');
  }
  async destroy(cards: CardInstance[] | CardInstance, reason: Reason = 'effect') {
    const list = Array.isArray(cards) ? cards : [cards];
    return this.game.destroy(list.filter((c) => c.onField), reason, this.player, this.self);
  }
  async banish(cards: CardInstance[] | CardInstance, reason: Reason = 'effect', faceDown = false) {
    const list = Array.isArray(cards) ? cards : [cards];
    return this.game.banish(list.filter((c) => !this.game.isUnaffected(c, this.self, this.player)), reason, this.player, this.self, faceDown);
  }
  async sendToGrave(cards: CardInstance[] | CardInstance, reason: Reason = 'effect') {
    const list = Array.isArray(cards) ? cards : [cards];
    return this.game.sendToGrave(list, reason, this.player, this.self);
  }
  async toHand(cards: CardInstance[] | CardInstance, reason: Reason = 'effect') {
    const list = Array.isArray(cards) ? cards : [cards];
    if (list.some((c) => c.location === 'deck') && this.game.queryPlayer(this.player, 'cannotAddFromDeck')) return [];
    const r = await this.game.toHand(list, reason, this.player, this.self);
    if (r.length && list.some((c) => c.owner === this.player)) {
      const shown = r.filter((c) => c.location === 'hand');
      if (shown.length) this.game.log(`${this.game.players[this.player].name} adds ${shown.map((c) => c.name).join(', ')} to their hand.`, 'action', this.player);
    }
    return r;
  }
  async toDeck(cards: CardInstance[] | CardInstance, where: 'shuffle' | 'top' | 'bottom' = 'shuffle', reason: Reason = 'effect') {
    const list = Array.isArray(cards) ? cards : [cards];
    return this.game.toDeck(list, reason, where, this.player, this.self);
  }
  async discard(cards: CardInstance[] | CardInstance, reason: Reason = 'effect') {
    const list = Array.isArray(cards) ? cards : [cards];
    return this.game.discard(list, reason, this.player, this.self);
  }
  /** Player chooses `n` cards from their own hand to discard. */
  async discardFromHand(n: number, filter?: Filter, reason: Reason = 'effect', p: PlayerId = this.player, prompt?: string) {
    const hand = this.game.zone(p, 'hand').filter((c) => c !== this.self && (!filter || filter(c)));
    const sel = await this.game.select(p, hand, n, n, prompt ?? `Discard ${n} card(s).`, 'discard', { source: this.self });
    return this.game.discard(sel, reason, this.player, this.self);
  }
  async mill(n: number, p: PlayerId = this.player) {
    return this.game.mill(p, n, 'effect', this.self);
  }
  async damage(p: PlayerId, amount: number) {
    return this.game.damage(p, amount, 'effect', this.self, this.player);
  }
  async recover(p: PlayerId, amount: number) {
    return this.game.recover(p, amount, this.self);
  }
  async payLp(amount: number) {
    return this.game.payLp(this.player, amount);
  }
  async specialSummon(
    cards: CardInstance[] | CardInstance,
    opts: { pos?: BattlePos | 'choose'; faceDown?: boolean; controller?: PlayerId; ignoreConditions?: boolean; proper?: boolean; method?: 'special' | 'synchro' | 'fusion' | 'ritual' } = {},
  ) {
    const list = Array.isArray(cards) ? cards : [cards];
    return this.game.specialSummon(list, this.player, { pos: opts.pos ?? 'choose', reasonCard: this.self, ...opts });
  }
  async createTokens(data: CardData, n: number, pos: BattlePos = 'def', controller?: PlayerId) {
    return this.game.createTokens(this.player, data, n, pos, controller);
  }
  /** Search the deck for cards matching filter and add them to hand. */
  async search(filter: Filter, n = 1, prompt = 'Add a card from your Deck to your hand.', min = n) {
    if (this.game.queryPlayer(this.player, 'cannotAddFromDeck')) return [];
    const cands = this.deck('me', filter);
    const sel = await this.select(cands, Math.min(min, cands.length), n, prompt, 'toHand');
    if (!sel.length) {
      this.game.shuffleDeck(this.player);
      return [];
    }
    const r = await this.toHand(sel);
    this.game.shuffleDeck(this.player);
    await this.game.anim({ type: 'reveal', cards: r.map((c) => c.uid), player: this.player });
    return r;
  }
  async changePos(card: CardInstance, pos: BattlePos, faceUp = true) {
    return this.game.changePosition(card, pos, faceUp, this.player);
  }
  async takeControl(card: CardInstance, untilEndPhase = true) {
    return this.game.takeControl(card, this.player, untilEndPhase);
  }
  addTempMod(card: CardInstance, q: QueryKey, value: number | boolean, until: TempMod['until'] = 'turn') {
    this.game.addTempMod(card, q, value, until, this.self);
  }
  equip(target: CardInstance, equipCard: CardInstance = this.self) {
    this.game.equip(equipCard, target);
  }
  /** Banish/destroy/etc helpers for "the equipped monster" */
  get equipTarget(): CardInstance | undefined {
    return this.self.equippedTo != null ? this.game.card(this.self.equippedTo) : undefined;
  }
  /** Negate the current attack. */
  negateAttack() {
    this.game.negateAttack();
  }
  /** Temporary player-level effect, e.g. addPlayerMod(ctx.opp, 'cannotDeclareAttack'). */
  addPlayerMod(p: PlayerId, q: QueryKey, value: number | boolean = true, until: 'turn' | 'nextTurnEnd' = 'turn') {
    this.game.addPlayerMod(p, q, value, until);
  }
  /** Grant an additional Normal Summon/Set this turn. */
  gainNormalSummon(n = 1) {
    this.game.players[this.player].normalSummonsLeft += n;
  }
  /** Negate a face-up monster's effects while it stays on the field (or until end of turn). */
  negateEffects(card: CardInstance, until: TempMod['until'] = 'field') {
    this.game.addTempMod(card, 'negated', true, until, this.self);
  }
  /** Schedule something at a later phase. */
  later(phase: 'end' | 'standby', fn: () => Promise<void>, turnOffset = 0) {
    this.game.addDelayed(phase, fn, turnOffset);
  }
  /** Use or check a 'once per turn' key manually. */
  usedThisTurn(key: string) {
    return this.game.isOptUsed(`custom:${this.player}:${key}`);
  }
  markUsed(key: string) {
    this.game.useOpt(`custom:${this.player}:${key}`);
  }
}
