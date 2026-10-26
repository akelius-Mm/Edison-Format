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
  // ABPF: player subject — "you cannot Synchro Summon this turn" (Variety Comes Out). Checked in Game.canSynchro.
  | 'cannotSynchroSummon'
  // player subject: cards in the GY cannot be banished (Necrovalley); effects with gyBanishCost are not offered.
  | 'cannotBanishFromGY'
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
   * ABPF: alternative Tribute Summon rule on a 'continuous' effect (Gravekeeper's Visionary, Advance Force): `summoned`,
   * which normally needs 2 Tributes, can be Tribute Summoned by Tributing 1 monster that passes this check.
   * Applies to the source's own card (e.g. range ['hand']) or, for a card on the field, to its controller's summons.
   */
  altTribute?: (ctx: Ctx, summoned: CardInstance, tribute: CardInstance) => boolean;
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
  /**
   * While face-up on the field and not negated: true when this card cannot be targeted by the effect of `source`
   * (checked by Ctx.canTarget with the targeting effect's Ctx), e.g. Turbo Warrior vs Level 6 or lower monsters.
   */
  targetImmunity?: (self: CardInstance, source: CardInstance, ctx: Ctx) => boolean;
  /** SDMM (Machina Force): LP its controller must pay to declare an attack with it (not while its effects are negated). */
  attackLpCost?: number;
  /** SDMM (The Big Saturn): locations it cannot be Special Summoned from (unless the effect ignores Summoning conditions). */
  noSpecialFrom?: Location[];
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
