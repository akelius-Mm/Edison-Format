import type {
  Attribute,
  BattlePos,
  CardKind,
  Category,
  EventType,
  GameEvent,
  Limit,
  Location,
  MonsterType,
  PlayerId,
  Race,
  Reason,
  SpellType,
  TrapType,
} from './types';
import type { Ctx } from './ctx';

// ---------------------------------------------------------------------------
// Effect definitions
// ---------------------------------------------------------------------------

export type EffectKind =
  /** Activation of a Spell/Trap card itself (from hand or set). */
  | 'activate'
  /** Spell Speed 1 effect activated in your Main Phase. */
  | 'ignition'
  /** Effect that activates when an event happens. */
  | 'trigger'
  /** Spell Speed 2 monster/continuous-card effect usable on either turn. */
  | 'quick'
  /** Passive effect applied while the card is in range. */
  | 'continuous'
  /** Inherent Special Summon procedure (does not start a chain). */
  | 'proc';

/** Keys the engine queries continuous effects for. */
export type QueryKey =
  // card subjects (numeric)
  | 'atk'
  | 'def'
  | 'level'
  | 'extraAttacks'
  // card subjects (boolean)
  | 'indestructibleBattle'
  | 'indestructibleEffect'
  | 'untargetable' // cannot be targeted by the opponent's card effects
  | 'untargetableByAll' // cannot be targeted by any card effect, yours included (Aurkus, Lightsworn Druid)
  | 'cannotAttack'
  | 'cannotBeAttacked'
  | 'directAttack'
  | 'piercing'
  | 'negated'
  | 'cannotChangePos'
  | 'cannotBeTributed'
  | 'cannotBeSynchroMaterial'
  | 'noBattleDamageFrom' // battles involving this card inflict no battle damage to its controller
  | 'unaffectedBySpells'
  | 'unaffectedByTraps'
  | 'mustBeAttacked'
  // SOVR: numeric TempMod only (until 'field'): "this card's ATK becomes X" for as long as it stays
  // face-up on the field (Reptilianne). Read by Game.getAtk; the newest one wins.
  | 'atkBecomes'
  // SOVR: "If this face-up card would be sent from the field to the GY, place it on top of the
  // Deck instead" (Archlord Kristya). Read by Game.rawMove.
  | 'deckTopInsteadOfGrave'
  // Card subject: this monster cannot be Normal Summoned (Setting is still allowed) or Special Summoned face-up,
  // wherever it is (Consecrated Light: "Neither player can Normal or Special Summon DARK monsters").
  | 'cannotBeSummoned'
  // Card subject: this monster cannot be Tribute Summoned (a Tribute Set is still allowed) — Zombie World.
  | 'cannotTributeSummon'
  // player subjects (boolean)
  | 'cannotSpecialSummon'
  | 'cannotNormalSummon'
  | 'cannotActivateTraps'
  | 'cannotActivateSpells'
  | 'noBattleDamage'
  | 'noEffectDamage'
  | 'banishInsteadOfGrave'
  | 'cannotDeclareAttack'
  | 'cannotDraw'
  | 'cannotAddFromDeck'
  | 'cannotSet'
  // player subject: cannot Set Spell/Trap Cards (Cold Wave). Monsters can still be Set.
  | 'cannotSetSpellTrap'
  // ABPF: player subject — "you cannot Synchro Summon this turn" (Variety Comes Out). Checked in Game.canSynchro.
  | 'cannotSynchroSummon'
  // player subject: cards in the GY cannot be banished (Necrovalley, Kycoo); effects with gyBanishCost are not offered.
  | 'cannotBanishFromGY'
  // player subject: Necrovalley's GY lock — card effects that would move a card in the GY, or change Types/Attributes in
  // the GY, are negated (Game.moveCards / specialSummon / cardView; targeted ones by necrovalleyNegates).
  | 'gyLock'
  // player subject (numeric): Monster Zones of that player that cannot be used (Phantom Dragon: 2).
  | 'lockedMZones';

export interface Mod {
  q: QueryKey;
  /** Who this applies to. 'cards' → any card that passes the filter, 'players' → players passing filter. Default 'self'. */
  to?: 'self' | 'cards' | 'players';
  filter?: (ctx: Ctx, subject: any) => boolean;
  value?: number | boolean | ((ctx: Ctx, subject: any) => number | boolean);
}

export interface AiHints {
  /** Higher → AI more eager to activate. Return <= 0 to skip. */
  score?: (ctx: Ctx) => number;
  /**
   * Monster cards only, read from any of the card's effects while it is in the hand: a bonus for Normal Summoning it
   * face-up (the AI then prefers the Summon over a Set), e.g. "Ancient Gear", whose Special Summons need it face-up.
   * A negative value tells the AI not to Normal Summon it face-up right now.
   */
  summon?: (ctx: Ctx) => number;
}

export interface EffectDef {
  kind: EffectKind;
  /** Short label shown on the activate button. */
  label?: string;
  /** Locations this effect works from. */
  range?: Location[];
  speed?: 1 | 2 | 3;
  /** Event(s) that trigger this effect (trigger) or allow activation (activate/quick with event). */
  event?: EventType | EventType[];
  eventFilter?: (ctx: Ctx, ev: GameEvent) => boolean;
  /** Mandatory trigger. */
  mandatory?: boolean;
  /** "When ... you can" — optional trigger that can miss timing. */
  when?: boolean;
  /** Once per turn. true → per card copy, string → shared key (hard once per turn). */
  opt?: boolean | string;
  /** Can be activated during the damage step. */
  damageStep?: boolean;
  /** Can be used in the summon-negation window (Solemn Judgment, Royal Oppression...). */
  negateSummon?: boolean;
  /**
   * Either player can use this effect of a face-up card on the field, whoever controls it (Royal Oppression: "Any
   * player can pay 800 LP..."). Read by Game.getActivations / canActivateEffect.
   */
  anyPlayer?: boolean;
  categories?: Category[];
  /** Situational requirement for activation. */
  condition?: (ctx: Ctx) => boolean;
  /** Costs/targets are available. */
  canActivate?: (ctx: Ctx) => boolean;
  /** Pay costs & choose targets. Return false to cancel (only when nothing was paid yet). */
  activate?: (ctx: Ctx) => Promise<boolean | void>;
  resolve?: (ctx: Ctx) => Promise<void>;
  /** Continuous modifiers. */
  mods?: Mod[];
  /** Only for kind 'continuous': condition for mods to apply. */
  active?: (ctx: Ctx) => boolean;
  /** For 'proc': pay the procedure's requirement. The engine then Special Summons the card. */
  perform?: (ctx: Ctx) => Promise<boolean>;
  /** For 'proc': allowed summon positions. */
  procPositions?: BattlePos[];
  /**
   * ANPR: destruction replacement ("if X would be destroyed, you can ... instead").
   * Called by `Game.destroy` (reason 'effect') and by battle destruction (reason 'battle') for every
   * source card in `range` (default: monsters 'mzone', Spells/Traps 'szone'/'fzone'; face-up, not negated
   * when on the field). Receives the cards about to be destroyed; returns the ones it saved.
   */
  replaceDestroy?: (ctx: Ctx, cards: CardInstance[], reason: Reason) => Promise<CardInstance[]>;
  /** Its cost / Summon procedure banishes cards from a GY: not usable while 'cannotBanishFromGY' applies (src/cards/gy-costs.ts). */
  gyBanishCost?: boolean;
  /** Effect may be activated while the card is face-down (e.g. hand traps don't need this). */
  ai?: AiHints;
  /**
   * ABPF (`replaceDestroyOne`): per-card destruction replacement / prevention on a 'continuous' effect (Gravekeeper's Visionary, Union monsters,
   * Underground Arachnid, Shield Wing, Earthbound Linewalker). Called by Game.destroy and battle destruction for each
   * card about to be destroyed while this effect applies. Return true if `card` is NOT destroyed (the hook replaced it).
   */
  replaceDestroyOne?: (ctx: Ctx, card: CardInstance, reason: Reason, reasonCard?: CardInstance) => Promise<boolean>;
  /**
   * On a 'continuous' effect: changes the printed data (Type, name...) of cards while the effect applies, so every check
   * that reads `card.data` / `card.name` sees it (Zombie World, Proto-Cyber Dragon). `to`: 'self' (default) or any card
   * passing `filter`. `apply` must return a stable object for the same input (use `dataVariant`). Applied by
   * Game.cardView; a change to a card in the GY does not apply while the GY is locked (Necrovalley, query 'gyLock').
   */
  dataMod?: { to?: 'self' | 'cards'; filter?: (c: CardInstance) => boolean; apply: (d: CardData, c: CardInstance) => CardData };
  /**
   * ABPF: alternative Tribute Summon rule on a 'continuous' effect (Gravekeeper's Visionary, Advance Force): `summoned`,
   * which normally needs 2 Tributes, can be Tribute Summoned by Tributing 1 monster that passes this check.
   * Applies to the source's own card (e.g. range ['hand']) or, for a card on the field, to its controller's summons.
   */
  altTribute?: (ctx: Ctx, summoned: CardInstance, tribute: CardInstance) => boolean;
  /**
   * SDMM (Blast Sphere): a 'trigger' with no event that activates while this card is a face-down monster attacked by
   * an opponent's monster, at the start of the Damage Step before it would be flipped face-up (Game.damageStep).
   */
  faceDownAttacked?: boolean;
  /**
   * UI only (never read by the engine): a one-line, player-facing reason this effect can't be used right now, or null
   * when the card has nothing specific to say. Shown on the disabled rows of the duel action menu and in the pile
   * viewer before the generic "condition not met" text. Must only read the game state. Most are set in src/cards/why-not.ts.
   */
  whyNot?: (ctx: Ctx) => string | null;
}

// ---------------------------------------------------------------------------
// Card data
// ---------------------------------------------------------------------------

export interface SynchroReq {
  tuner?: (c: CardInstance) => boolean;
  nonTuner?: (c: CardInstance) => boolean;
  minNonTuners?: number;
  maxNonTuners?: number;
  desc?: string;
  /** ABPF: whole-combination check (e.g. "Majestic Dragon" + "Red Dragon Archfiend" + 1 non-Tuner). */
  check?: (materials: CardInstance[]) => boolean;
}

export interface FusionReq {
  /** Each entry must be matched by a distinct material. */
  materials: ((c: CardInstance) => boolean)[];
  /** Contact fusions / special fusions can't be made with Polymerization. */
  noPoly?: boolean;
  desc?: string;
}

export interface CardData {
  id: string;
  name: string;
  kind: CardKind;
  mtypes?: MonsterType[];
  attribute?: Attribute;
  race?: Race;
  level?: number;
  atk?: number;
  def?: number;
  stype?: SpellType;
  ttype?: TrapType;
  text: string;
  /** Archetype tags e.g. 'blackwing', 'lightsworn'. */
  sets?: string[];
  synchro?: SynchroReq;
  fusion?: FusionReq;
  effects?: EffectDef[];
  /** Cannot be Normal Summoned/Set (must be Special Summoned by proc). */
  cannotNormalSummon?: boolean;
  /** Must be properly Special Summoned before being revived (nomi). */
  nomi?: boolean;
  /** Set code / rarity flavour for display. */
  setCode?: string;
  /** Edison list status, filled by banlist. */
  limit?: Limit;
  /** For tokens. */
  isToken?: boolean;
  /** Value for AI heuristics (higher = better card to keep / protect). */
  aiValue?: number;
  /** Treat as Tribute fodder of 2 (e.g. not needed now). */
  doubleTribute?: boolean;
  /**
   * Restriction when this card is used as Synchro Material (e.g. Debris Dragon).
   * Called with the Synchro monster being summoned and the full material list.
   */
  synchroMaterialCheck?: (synchro: CardInstance, materials: CardInstance[], self: CardInstance) => boolean;
  /** Another Level this card can be treated as when used as Synchro Material (Tuningware: 2). */
  synchroLevel?: number;
  /**
   * While face-up on the field and not negated: true when this card cannot be targeted by the effect of `source`
   * (checked by Ctx.canTarget with the targeting effect's Ctx), e.g. Turbo Warrior vs Level 6 or lower monsters.
   */
  targetImmunity?: (self: CardInstance, source: CardInstance, ctx: Ctx) => boolean;
  /** SDMM (Machina Force): LP its controller must pay to declare an attack with it (not while its effects are negated). */
  attackLpCost?: number;
  /** SDMM (The Big Saturn): locations it cannot be Special Summoned from (unless the effect ignores Summoning conditions). */
  noSpecialFrom?: Location[];
  /** Its effects cannot be negated by Necrovalley's GY lock (Gravekeeper's Stele). */
  ignoresGyLock?: boolean;
}

/** Per-instance override of a card's data (abpf.ts patchData & co.): return a changed copy, or undefined for no change. */
export type DataPatch = (orig: CardData, card: CardInstance) => CardData | undefined;

const dataVariants = new WeakMap<CardData, Map<string, CardData>>();
/** A stable modified copy of `orig` (the same object for the same `key`), for data patches / dataMod. */
export function dataVariant(orig: CardData, key: string, change: Partial<CardData>): CardData {
  let m = dataVariants.get(orig);
  if (!m) dataVariants.set(orig, (m = new Map()));
  let v = m.get(key);
  if (!v) m.set(key, (v = { ...orig, ...change }));
  return v;
}

// ---------------------------------------------------------------------------
// Card instance
// ---------------------------------------------------------------------------

export interface TempMod {
  q: QueryKey;
  value: number | boolean;
  /** 'turn' expires at end of turn; 'field' lasts while on field; 'battle' expires end of damage step. */
  until: 'turn' | 'field' | 'battle' | 'opponentEnd';
  turn: number;
  source?: number;
}

let NEXT_UID = 1;

/**
 * Per-instance `flags` that hold "while this card is face-up" state. A face-up monster turned face-down is a new card
 * once it is flipped face-up again (Gemini status, "once while this card is face-up", effects applied to it), so
 * CardInstance.resetOnFaceDown drops these keys. Card scripts add their own keys with faceUpFlag().
 * Flags that are not listed survive a face-down turn (how it was Summoned, its materials, links, locks...).
 */
export const FACE_UP_FLAGS = new Set<string>([
  'flipped',
  // Gemini: "Gemini Summoned" status is lost when it is turned face-down (it is a Normal Monster again once flipped).
  'geminiSummoned',
  // effects applied to it by other cards end: "its ATK becomes X this turn", "negate its effects this turn"
  'setAtk',
  'setAtkTurn',
  'negatedTurn',
]);
/** Register flag keys that reset when the card is turned face-down (see FACE_UP_FLAGS). */
export function faceUpFlag(...keys: string[]) {
  for (const k of keys) FACE_UP_FLAGS.add(k);
}

export class CardInstance {
  uid: number;
  /** Printed data; read through `data`, which applies data patches and the engine's rule view. */
  private baseData: CardData;
  private dataPatches?: DataPatch[];
  /**
   * Engine hook (set by Game.registerCard): the card's data as changed by rules that depend on where it is
   * (Zombie World, "this card's name becomes ..."). See EffectDef.dataMod.
   */
  view?: (c: CardInstance, d: CardData) => CardData;
  owner: PlayerId;
  controller: PlayerId;
  location: Location = 'deck';
  /** Zone index on the field (0-4). -1 otherwise. */
  seq = -1;
  faceUp = false;
  pos: BattlePos = 'atk';
  /** Increments every time the card moves; used to validate targets. */
  moveId = 0;
  /**
   * Increments every time a monster on the field is turned face-down (it is a new card once flipped face-up again).
   * Unlike moveId this does not break targeting, battle or "negate and destroy": the card is still on the field.
   */
  faceUpId = 0;
  summonTurn = -1;
  summonMethod: string | null = null;
  setTurn = -1;
  posChangedTurn = -1;
  attacksThisTurn = 0;
  attackedThisTurnOrWasAttacked = false;
  counters: Record<string, number> = {};
  tempMods: TempMod[] = [];
  /** For equip spells: uid of equipped monster. */
  equippedTo: number | null = null;
  /** Generic link to other card (Call of the Haunted, Premature Burial...). */
  linkedTo: number | null = null;
  /** Spell/trap that has fully resolved its activation and stays on field. */
  activeOnField = false;
  /** Was properly summoned (for nomi monsters). */
  properlySummoned = false;
  /** Banish this when it leaves the field (Plaguespreader, etc.) */
  banishOnLeave = false;
  /** Generic per-instance flags for card scripts. */
  flags: Record<string, any> = {};
  /** Revealed to opponent (e.g. searched) — UI only. */
  revealedUntil = -1;

  constructor(data: CardData, owner: PlayerId) {
    this.uid = NEXT_UID++;
    this.baseData = data;
    this.owner = owner;
    this.controller = owner;
  }

  /** The card's current data: printed data, then per-instance patches (in order), then the engine's rule view. */
  get data(): CardData {
    let d = this.baseData;
    if (this.dataPatches) for (const f of this.dataPatches) d = f(d, this) ?? d;
    return this.view ? this.view(this, d) : d;
  }
  set data(d: CardData) {
    this.baseData = d;
  }
  /** Add a per-instance data override (Reptilianne Rage, Cyber Dragon Zwei, Trap Monsters...). Patches compose in order. */
  addDataPatch(fn: DataPatch) {
    (this.dataPatches ??= []).push(fn);
  }

  get name() {
    return this.data.name;
  }
  get isMonster() {
    return this.data.kind === 'monster';
  }
  get isSpell() {
    return this.data.kind === 'spell';
  }
  get isTrap() {
    return this.data.kind === 'trap';
  }
  get isExtra() {
    const t = this.data.mtypes ?? [];
    return t.includes('fusion') || t.includes('synchro');
  }
  get isToken() {
    return !!this.data.isToken;
  }
  hasType(t: MonsterType) {
    const types = this.data.mtypes ?? [];
    // Gemini: treated as a Normal Monster (not an Effect Monster) in the GY, and face-up on the field until it is Gemini Summoned.
    if ((t === 'normal' || t === 'effect') && types.includes('gemini')) {
      const asNormal = this.location === 'grave' || (this.location === 'mzone' && this.faceUp && !this.flags.geminiSummoned);
      if (asNormal) return t === 'normal';
    }
    return types.includes(t);
  }
  get isTuner() {
    return this.hasType('tuner');
  }
  inSet(tag: string) {
    return (this.data.sets ?? []).includes(tag);
  }
  get onField() {
    return this.location === 'mzone' || this.location === 'szone' || this.location === 'fzone';
  }
  get faceUpMonster() {
    return this.location === 'mzone' && this.faceUp;
  }
  get isAttack() {
    return this.location === 'mzone' && this.pos === 'atk';
  }
  get isDefense() {
    return this.location === 'mzone' && this.pos === 'def';
  }

  /**
   * A face-up monster on the field was turned face-down: drop everything that lasts only "while face-up" —
   * effects applied to it (stat changes), counters and the FACE_UP_FLAGS. moveId is kept on purpose: it is still the
   * same card for targets, an ongoing battle and "negate and destroy" (War Chariot). Equips are destroyed by
   * Game.ruleCleanup (an equip needs a face-up host).
   */
  resetOnFaceDown() {
    this.faceUpId++;
    this.tempMods = [];
    this.counters = {};
    for (const k of Object.keys(this.flags)) if (FACE_UP_FLAGS.has(k)) delete this.flags[k];
  }

  resetOnMove() {
    this.moveId++;
    this.tempMods = [];
    this.counters = {};
    this.equippedTo = null;
    this.linkedTo = null;
    this.activeOnField = false;
    this.attacksThisTurn = 0;
    this.attackedThisTurnOrWasAttacked = false;
    this.posChangedTurn = -1;
    this.summonTurn = -1;
    this.summonMethod = null;
    this.setTurn = -1;
    this.flags = {};
    // a reveal lasts only while the card stays in the hand: once it moves, it is a new card to the opponent
    this.revealedUntil = -1;
    if (this.controller !== this.owner) this.controller = this.owner;
  }

  toString() {
    return `${this.data.name}#${this.uid}`;
  }
}
