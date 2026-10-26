import type { CardData, EffectDef, FusionReq, SynchroReq } from '../engine/card';
import type { Attribute, MonsterType, Race, SpellType, TrapType } from '../engine/types';

/** Global card database keyed by id. */
export const CARDS: Record<string, CardData> = {};
const BY_NAME = new Map<string, CardData>();

export function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/["'!.,:]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function register(data: CardData): CardData {
  if (CARDS[data.id]) {
    throw new Error(`Duplicate card definition: ${data.name}`);
  }
  CARDS[data.id] = data;
  BY_NAME.set(data.name.toLowerCase(), data);
  return data;
}

export function cardByName(name: string): CardData {
  const c = BY_NAME.get(name.toLowerCase());
  if (!c) throw new Error(`Unknown card: ${name}`);
  return c;
}
export function findCard(name: string): CardData | undefined {
  return BY_NAME.get(name.toLowerCase());
}
export function allCards(): CardData[] {
  return Object.values(CARDS).filter((c) => !c.isToken);
}

interface MonsterOpts {
  attribute: Attribute;
  race: Race;
  level: number;
  atk: number;
  def: number;
  /** Additional types; 'effect' is added automatically when effects are present. */
  types?: MonsterType[];
  text?: string;
  sets?: string[];
  effects?: EffectDef[];
  cannotNormalSummon?: boolean;
  nomi?: boolean;
  synchro?: SynchroReq;
  fusion?: FusionReq;
  aiValue?: number;
  setCode?: string;
  synchroMaterialCheck?: CardData['synchroMaterialCheck'];
  targetImmunity?: CardData['targetImmunity'];
  attackLpCost?: number;
  noSpecialFrom?: CardData['noSpecialFrom'];
}

/** Define an effect / normal / extra deck monster. */
export function monster(name: string, o: MonsterOpts): CardData {
  const types = new Set<MonsterType>(o.types ?? []);
  const isNormal = !o.effects?.length && !types.has('fusion') && !types.has('synchro') && !types.has('effect') && !types.has('token');
  if (isNormal) types.add('normal');
  else if (o.effects?.length) types.add('effect');
  return register({
    id: slug(name),
    name,
    kind: 'monster',
    mtypes: [...types],
    attribute: o.attribute,
    race: o.race,
    level: o.level,
    atk: o.atk,
    def: o.def,
    text: o.text ?? '',
    sets: o.sets,
    effects: o.effects,
    cannotNormalSummon: o.cannotNormalSummon || types.has('fusion') || types.has('synchro'),
    nomi: o.nomi,
    synchro: o.synchro,
    fusion: o.fusion,
    aiValue: o.aiValue,
    setCode: o.setCode,
    synchroMaterialCheck: o.synchroMaterialCheck,
    targetImmunity: o.targetImmunity,
    attackLpCost: o.attackLpCost,
    noSpecialFrom: o.noSpecialFrom,
  });
}

/** Shorthand for vanilla monsters. */
export function normal(name: string, attribute: Attribute, race: Race, level: number, atk: number, def: number, text = '', sets?: string[]) {
  return monster(name, { attribute, race, level, atk, def, text, sets });
}

export function token(name: string, attribute: Attribute, race: Race, level: number, atk: number, def: number, text = ''): CardData {
  const d: CardData = {
    id: 'token-' + slug(name),
    name,
    kind: 'monster',
    mtypes: ['token', 'normal'],
    attribute,
    race,
    level,
    atk,
    def,
    text: text || 'This card is used as a Token.',
    isToken: true,
  };
  CARDS[d.id] = d;
  return d;
}

interface STOpts {
  text: string;
  sets?: string[];
  effects?: EffectDef[];
  aiValue?: number;
}

export function spell(name: string, stype: SpellType, o: STOpts): CardData {
  return register({ id: slug(name), name, kind: 'spell', stype, text: o.text, sets: o.sets, effects: o.effects, aiValue: o.aiValue });
}

export function trap(name: string, ttype: TrapType, o: STOpts): CardData {
  return register({ id: slug(name), name, kind: 'trap', ttype, text: o.text, sets: o.sets, effects: o.effects, aiValue: o.aiValue });
}
