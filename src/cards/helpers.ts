// Reusable filters, event filters and effect builders for card scripts.
import type { CardInstance, EffectDef } from '../engine/card';
import type { Ctx } from '../engine/ctx';
import type { Game } from '../engine/game';
import type { Attribute, GameEvent, Location, Race } from '../engine/types';

export type F = (c: CardInstance) => boolean;

// ------------------------------------------------------------------ filters
export const isMonster: F = (c) => c.isMonster;
export const isSpell: F = (c) => c.isSpell;
export const isTrap: F = (c) => c.isTrap;
export const isST: F = (c) => c.isSpell || c.isTrap;
export const faceUp: F = (c) => c.faceUp;
export const faceDown: F = (c) => !c.faceUp;
export const isTuner: F = (c) => c.isTuner;
export const isNormalMonster: F = (c) => c.hasType('normal') && !c.isToken;
export const isEffectMonster: F = (c) => c.hasType('effect');
export const notToken: F = (c) => !c.isToken;
export const attr = (a: Attribute): F => (c) => c.isMonster && c.data.attribute === a;
export const race = (r: Race): F => (c) => c.isMonster && c.data.race === r;
export const inSet = (tag: string): F => (c) => c.inSet(tag);
export const named = (n: string): F => (c) => c.name === n;
export const levelMax = (n: number): F => (c) => c.isMonster && (c.data.level ?? 0) <= n && !c.isExtra;
export const levelMin = (n: number): F => (c) => c.isMonster && (c.data.level ?? 0) >= n;
export const levelIs = (n: number): F => (c) => c.isMonster && (c.data.level ?? 0) === n;
export const and = (...fs: F[]): F => (c) => fs.every((f) => f(c));
export const or = (...fs: F[]): F => (c) => fs.some((f) => f(c));
export const not = (f: F): F => (c) => !f(c);

const FIELD: Location[] = ['mzone', 'szone', 'fzone'];
export const wasOnField = (ev: GameEvent) => !!ev.from && FIELD.includes(ev.from);
export const evCard = (ev: GameEvent) => ev.card as CardInstance | undefined;
export const evOther = (ev: GameEvent) => ev.other as CardInstance | undefined;

// ------------------------------------------------------------ event filters
type EvF = (ctx: Ctx, ev: GameEvent) => boolean;

export const selfEv: EvF = (ctx, ev) => ev.card === ctx.self;
/** This card was sent from the field to the GY. */
export const selfFieldToGrave: EvF = (ctx, ev) => ev.card === ctx.self && wasOnField(ev) && ev.to === 'grave';
/** This card was sent to the GY from anywhere. */
export const selfToGrave: EvF = (ctx, ev) => ev.card === ctx.self && ev.to === 'grave';
export const selfDestroyedByBattle: EvF = (ctx, ev) => ev.card === ctx.self && ev.type === 'battleDestroyed';
/** This card destroyed an opponent's monster by battle and is still on the field. */
export const selfDestroysByBattle: EvF = (ctx, ev) =>
  ev.type === 'battleDestroyed' && ev.other === ctx.self && ctx.self.location === 'mzone' && (ev.card as CardInstance).owner !== ctx.self.controller;
export const selfSummoned =
  (...methods: NonNullable<GameEvent['method']>[]): EvF =>
  (ctx, ev) =>
    ev.card === ctx.self && (!methods.length || (!!ev.method && methods.includes(ev.method)));
export const oppSummoned: EvF = (ctx, ev) => !!ev.card && (ev.card as CardInstance).controller !== ctx.player && ev.player !== ctx.player;

// ------------------------------------------------------------- builders

/** FLIP: effect (mandatory unless optional is set). */
export function flip(e: Omit<EffectDef, 'kind' | 'event'> & { optional?: boolean }): EffectDef {
  const { optional, ...rest } = e;
  return {
    kind: 'trigger',
    event: 'flipped',
    mandatory: !optional,
    label: e.label ?? 'Flip effect',
    eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'mzone',
    ...rest,
  };
}

/** Standard "target 1 card; destroy it" resolve body. */
export async function destroyTargets(ctx: Ctx) {
  const t = ctx.validTargets((c) => c.onField);
  if (t.length) await ctx.destroy(t);
}

// --------------------------------------------------------------- AI values

/** Rough value of a card on board for AI decisions. */
export function cardValue(game: Game, c: CardInstance): number {
  if (c.data.aiValue !== undefined && !(c.location === 'mzone' && c.faceUp)) return c.data.aiValue;
  if (c.isMonster) {
    if (c.location === 'mzone') {
      if (!c.faceUp) return 1200 + (c.data.aiValue ?? 0) / 2;
      const atk = game.getAtk(c);
      const def = game.getDef(c);
      let v = Math.max(atk, c.pos === 'def' ? def : 0) + (c.isExtra ? 600 : 0) + (c.hasType('effect') ? 300 : 0);
      if (c.data.aiValue) v += c.data.aiValue / 2;
      if (c.isToken) v -= 500;
      return v;
    }
    return (c.data.atk ?? 0) + (c.hasType('effect') ? 400 : 0) + (c.data.aiValue ?? 0);
  }
  // spells / traps
  if (c.onField && !c.faceUp) return 1500;
  if (c.onField && c.faceUp) {
    if (c.data.stype === 'continuous' || c.data.ttype === 'continuous' || c.data.stype === 'field' || c.data.stype === 'equip') return 1400 + (c.data.aiValue ?? 0);
    return 300;
  }
  return 1000 + (c.data.aiValue ?? 0);
}

/** Best card for the opponent to lose (highest value). */
export function bestTarget(game: Game, cards: CardInstance[]) {
  return [...cards].sort((a, b) => cardValue(game, b) - cardValue(game, a))[0];
}
