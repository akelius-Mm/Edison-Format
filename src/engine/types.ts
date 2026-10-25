// Core type definitions for the Edison Format duel engine.

export type PlayerId = 0 | 1;

export type Location =
  | 'deck'
  | 'hand'
  | 'mzone'
  | 'szone'
  | 'fzone'
  | 'grave'
  | 'banished'
  | 'extra'
  | 'none';

export const FIELD_LOCS: Location[] = ['mzone', 'szone', 'fzone'];

export type CardKind = 'monster' | 'spell' | 'trap';

export type MonsterType =
  | 'normal'
  | 'effect'
  | 'fusion'
  | 'synchro'
  | 'ritual'
  | 'tuner'
  | 'flip'
  | 'gemini'
  | 'spirit'
  | 'union'
  | 'toon'
  | 'token';

export type Attribute = 'DARK' | 'LIGHT' | 'EARTH' | 'WATER' | 'FIRE' | 'WIND' | 'DIVINE';

export type Race =
  | 'Aqua'
  | 'Beast'
  | 'Beast-Warrior'
  | 'Dinosaur'
  | 'Divine-Beast'
  | 'Dragon'
  | 'Fairy'
  | 'Fiend'
  | 'Fish'
  | 'Insect'
  | 'Machine'
  | 'Plant'
  | 'Psychic'
  | 'Pyro'
  | 'Reptile'
  | 'Rock'
  | 'Sea Serpent'
  | 'Spellcaster'
  | 'Thunder'
  | 'Warrior'
  | 'Winged Beast'
  | 'Zombie';

export type SpellType = 'normal' | 'quickplay' | 'continuous' | 'equip' | 'field' | 'ritual';
export type TrapType = 'normal' | 'continuous' | 'counter';

export type Phase = 'draw' | 'standby' | 'main1' | 'battle' | 'main2' | 'end';

export type BattlePos = 'atk' | 'def';

/** Restriction status on the Edison (April 2010) Forbidden & Limited list. */
export type Limit = 0 | 1 | 2 | 3;

export type Reason =
  | 'effect'
  | 'battle'
  | 'cost'
  | 'tribute'
  | 'synchro'
  | 'fusion'
  | 'material'
  | 'rule'
  | 'discard'
  | 'destroy'
  | 'draw'
  | 'summon'
  | 'negated'
  | 'release';

export type EventType =
  | 'normalSummoned'
  | 'tributeSummoned'
  | 'specialSummoned'
  | 'flipSummoned'
  | 'synchroSummoned'
  | 'fusionSummoned'
  | 'summoned' // any successful summon (normal/flip/special)
  | 'monsterSet'
  | 'flipped' // turned face-up by any means (flip effects)
  | 'destroyed'
  | 'sentToGrave'
  | 'banished'
  | 'addedToHand'
  | 'returnedToHand'
  | 'returnedToDeck'
  | 'discarded'
  | 'drawn'
  | 'milled' // sent from deck to graveyard
  | 'leftField'
  | 'tributed'
  | 'usedAsMaterial'
  | 'attackDeclared'
  | 'attackNegated'
  | 'battleDestroyed' // card was destroyed by battle (card = destroyed, other = destroyer)
  | 'battleDamage' // player took battle damage
  | 'damage' // player took any damage
  | 'lpGain'
  | 'phaseStart'
  | 'phaseEnd'
  | 'battleEnd'
  | 'damageStepEnd'
  /** After damage calculation, before battle-destroyed monsters leave the field (Ehren, Lightsworn Monk). */
  | 'damageCalculated'
  | 'chainActivated'
  | 'chainResolved'
  | 'positionChanged'
  | 'controlChanged'
  | 'targeted'
  | 'cardActivated';

export interface GameEvent {
  type: EventType;
  seq: number;
  batch: number;
  card?: CardRef;
  other?: CardRef;
  player?: PlayerId;
  from?: Location;
  to?: Location;
  fromFaceUp?: boolean;
  fromController?: PlayerId;
  reason?: Reason;
  reasons?: Reason[];
  reasonPlayer?: PlayerId;
  reasonCard?: CardRef;
  amount?: number;
  phase?: Phase;
  turnPlayer?: PlayerId;
  /** For tribute summons: monsters tributed. */
  tributes?: CardRef[];
  /** For summons: the summon method. */
  method?: 'normal' | 'tribute' | 'flip' | 'special' | 'synchro' | 'fusion' | 'ritual';
  /** For events during a chain, the chain link index it happened in. */
  inChain?: boolean;
  /** Damage step id: events in the same damage step share timing. */
  dsId?: number;
  /** True for cleanup events that do not count for 'missing the timing'. */
  minor?: boolean;
  /** Arbitrary extra data. */
  data?: any;
}

/** Forward declaration to avoid circular import (CardInstance lives in card.ts). */
export interface CardRef {
  uid: number;
}

export type Category =
  | 'destroy'
  | 'destroyMulti'
  | 'banish'
  | 'negate'
  | 'negateSummon'
  | 'negateAttack'
  | 'specialSummon'
  | 'draw'
  | 'search'
  | 'toHand'
  | 'damage'
  | 'recover'
  | 'control'
  | 'position'
  | 'atkChange'
  | 'mill'
  | 'discard'
  | 'toDeck'
  | 'lockdown'
  | 'protect';
