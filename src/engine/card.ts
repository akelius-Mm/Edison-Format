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
  | 'cannotSet';

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
  /** Effect may be activated while the card is face-down (e.g. hand traps don't need this). */
  ai?: AiHints;
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

export class CardInstance {
  uid: number;
  data: CardData;
  owner: PlayerId;
  controller: PlayerId;
  location: Location = 'deck';
  /** Zone index on the field (0-4). -1 otherwise. */
  seq = -1;
  faceUp = false;
  pos: BattlePos = 'atk';
  /** Increments every time the card moves; used to validate targets. */
  moveId = 0;
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
    this.data = data;
    this.owner = owner;
    this.controller = owner;
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
    return (this.data.mtypes ?? []).includes(t);
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
    if (this.controller !== this.owner) this.controller = this.owner;
  }

  toString() {
    return `${this.data.name}#${this.uid}`;
  }
}
