// Light of Destruction (LODT, TCG 2008): every card of the set that no other set file defines.
// Card text, type, Attribute, Level, ATK/DEF: YGOJSON v1 aggregate (github.com/iconmaster5326/YGOJSON).
// Effects follow the 2010 TCG rulings as far as the engine allows. Approximations are marked "APPROX:".
//
// Already scripted elsewhere (fixed in place where they disagreed with YGOJSON, see the `// LODT:` comments):
// Honest, the Lightsworn monsters, Judgment Dragon, Solar Recharge, Realm of Light, Substitoad, Phantom Dragon,
// Gladiator Beast Gyzarus.
//
// No engine change. Hooks reused: EffectDef.replaceDestroy (ANPR), EffectDef.altTribute (ABPF), the per-instance
// data override `patchData` (abpf.ts), the `atkBecomes`-style flags.setAtk of Game.getAtk. Game rules the engine has
// no hook for are installed per game by `ensureLodtPatches` (the technique of anpr.ts / traps.ts):
//  * battle damage: Arcana Force XIV - Temperance (halve / no damage), Union Attack (no damage to the opponent);
//  * Summon legality: Guardian of Order / Miracle Flipper (only 1), Arcana Force VI - The Lovers (Tails),
//    Tour of Doom, Summon Limit, Tualatin's Attribute lock, Fog King (0/1 Tribute), Simorgh (1 less Tribute),
//    Super-Ancient Dinobeast (no 1-Tribute Set), Nimble Musasabi (no Tribute Summon fodder), Deck Lockdown,
//    Dark General Freed / Arcana Force EX (cannot be Special Summoned by card effects);
//  * attack targets: Miracle Flipper; activations: Angel O7 (no monster effects), Sanguine Swamp (no face-down
//    Spells/Traps); the normal draw: Mystical Cards of Light (draw 2), Dark General Freed (search instead);
//  * Spell & Trap Zones: Mystical Cards of Light; turns: Arcana Force XXI - The World (skip a turn).
import { monster, spell, token, trap } from '../define';
import { cardValue, flip } from '../helpers';
import type { CardData, CardInstance, EffectDef, QueryKey } from '../../engine/card';
import { faceUpFlag } from '../../engine/card';
import { Ctx } from '../../engine/ctx';
import type { Action } from '../../engine/controller';
import type { ChainLink, Game } from '../../engine/game';
import type { Attribute, BattlePos, EventType, GameEvent, Location, PlayerId } from '../../engine/types';
import { lightswornNamesInGrave } from './lightsworn';
import { geminiSummonEffect, isGeminiActive, synchroOptions } from './plants';
import { patchData, variant } from './abpf';
import { QUESTION_ATK } from './sovr';

type C = CardInstance;

// ============================================================ names

const GUARDIAN = 'Guardian of Order';
const FLIPPER = 'Miracle Flipper';
const FREED = 'Dark General Freed';
const FOG_KING = 'Fog King';
const SIMORGH = 'Simorgh, Bird of Ancestry';
const DINOBEAST = 'Super-Ancient Dinobeast';
const MUSASABI = 'Nimble Musasabi';
const TUALATIN = 'Tualatin';
const ANGEL_O7 = 'Angel O7';
const LADY = 'The Lady in Wight';
const LIGHT_BARRIER = 'Light Barrier';
const LUCKY_CHANCE = 'Lucky Chance';
const SUMMON_LIMIT = 'Summon Limit';
const DECK_LOCKDOWN = 'Deck Lockdown';
const SANGUINE_SWAMP = 'Sanguine Swamp';
const MCOL = 'Mystical Cards of Light';
const AF0 = 'Arcana Force 0 - The Fool';
const AF1 = 'Arcana Force I - The Magician';
const AF3 = 'Arcana Force III - The Empress';
const AF4 = 'Arcana Force IV - The Emperor';
const AF6 = 'Arcana Force VI - The Lovers';
const AF7 = 'Arcana Force VII - The Chariot';
const AF14 = 'Arcana Force XIV - Temperance';
const AF18 = 'Arcana Force XVIII - The Moon';
const AF21 = 'Arcana Force XXI - The World';
const AFEX = 'Arcana Force EX - The Dark Ruler';

// ============================================================ shared helpers

const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const ATTRS: Attribute[] = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND'];
const evc = (ev: GameEvent) => ev.card as C | undefined;
const evo = (ev: GameEvent) => ev.other as C | undefined;
const reasonsOf = (ev: GameEvent) => ev.reasons ?? (ev.reason ? [ev.reason] : []);
const fromField = (ev: GameEvent) => ev.from === 'mzone' || ev.from === 'szone' || ev.from === 'fzone';
const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
/** This monster is face-up on the field and not negated. */
const monActive = (ctx: Ctx) => faceUpOn(ctx.self) && !ctx.game.isNegated(ctx.self);
/** This Continuous/Field/Equip card is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
const isMain = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';
const isAi = (g: Game, p: PlayerId) => !g.controllers[p].isHuman;
const lname = (c: C) => c.name.toLowerCase();
const lvl = (c: C) => c.data.level ?? 0;
const isSpecialSummoned = (c: C) => ['special', 'synchro', 'fusion', 'ritual'].includes(c.summonMethod ?? '');

const isArcana = (c: C) => c.isMonster && (c.inSet('arcana-force') || c.name.startsWith('Arcana Force'));
const isBatteryman = (c: C) => c.isMonster && (c.inSet('batteryman') || c.name.startsWith('Batteryman'));
const isCloudian = (c: C) => c.isMonster && (c.inSet('cloudian') || c.name.startsWith('Cloudian'));
const isDHeroCard = (c: C) => c.inSet('destiny-hero') || lname(c).startsWith('destiny hero');
const isDHero = (c: C) => c.isMonster && isDHeroCard(c);
const isEHero = (c: C) => c.isMonster && (c.inSet('elemental-hero') || lname(c).startsWith('elemental hero'));
const isNeoSpacian = (c: C) => c.isMonster && (c.inSet('neo-spacian') || c.name.startsWith('Neo-Spacian'));
const isFrog = (c: C) => c.isMonster && (c.inSet('frog') || lname(c).includes('frog'));
const isLS = (c: C) => c.isMonster && c.inSet('lightsworn');
const isGB = (c: C) => c.isMonster && (c.inSet('gladiator') || c.name.startsWith('Gladiator Beast'));
const isAncientGear = (c: C) => c.name.includes('Ancient Gear');
const isAGG = (c: C) => c.isMonster && c.name === 'Ancient Gear Golem';
const isCrystalBeast = (c: C) => c.inSet('crystal-beast') || c.name.startsWith('Crystal Beast');
const isUltimateCrystal = (c: C) =>
  c.isMonster && (c.inSet('ultimate-crystal') || c.name.includes('Ultimate Crystal') || c.name === 'Rainbow Dragon' || c.name === 'Rainbow Dark Dragon');
const namedCI = (n: string) => (c: C) => lname(c) === n.toLowerCase();

/** Events since the start of the current turn's Draw Phase. */
function turnEvents(g: Game): GameEvent[] {
  const log = g.eventLog;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'phaseStart' && e.phase === 'draw') return log.slice(i);
  }
  return log;
}

/** Tribute cards as a cost. */
async function tributeCost(ctx: Ctx, cards: C[]) {
  if (!cards.length) return;
  ctx.game.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`, 'action', ctx.player);
  await ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}
const tributable = (ctx: Ctx, c: C) => !ctx.query(c, 'cannotBeTributed');

/** Reveal cards from the hand. */
async function reveal(ctx: Ctx, cards: C[]) {
  if (!cards.length) return;
  for (const c of cards) c.revealedUntil = ctx.turn;
  ctx.log(`${ctx.game.players[ctx.player].name} reveals ${cards.map((c) => c.name).join(', ')}.`);
  await ctx.game.anim({ type: 'reveal', cards: cards.map((c) => c.uid), player: ctx.player });
}

/** Run `fn` during the End Phase of `ctx.player`'s current or next turn. */
function laterOnMyEnd(ctx: Ctx, fn: () => Promise<void>) {
  const g = ctx.game;
  const p = ctx.player;
  const run = async () => {
    if (g.turnPlayer !== p) {
      g.addDelayed('end', run, 1);
      return;
    }
    await fn();
  };
  g.addDelayed('end', run, g.turnPlayer === p ? 0 : 1);
}

/** Player-level restriction from now until the end of this player's next turn. */
function addModUntilMyNextTurnEnd(ctx: Ctx, q: QueryKey) {
  const g = ctx.game;
  const p = ctx.player;
  g.addPlayerMod(p, q, true, 'nextTurnEnd');
  g.addDelayed('end', async () => g.addPlayerMod(p, q, true, 'nextTurnEnd'), 1);
}

/** "End the Battle Phase": negate the attack and forbid further attacks this turn (as monsters.ts does). */
function endBattlePhase(ctx: Ctx) {
  if (ctx.battle) ctx.negateAttack();
  ctx.addPlayerMod(ctx.game.turnPlayer, 'cannotDeclareAttack', true, 'turn');
  ctx.log('The Battle Phase ends.');
}

/** Did player p Normal Summon or Set a monster this turn? */
function normalSummonedThisTurn(g: Game, p: PlayerId) {
  return turnEvents(g).some((e) => (e.type === 'normalSummoned' || e.type === 'monsterSet') && e.player === p);
}

/** Special Summon `card` (inherent procedure, no chain) to `ctrl`'s field — Volcanic Queen. */
async function summonToField(g: Game, p: PlayerId, card: C, ctrl: PlayerId, pos: BattlePos) {
  if (g.freeMZones(ctrl) <= 0) return false;
  const from = card.location;
  g.beginBatch();
  g.rawMove(card, 'mzone', { controller: ctrl, faceUp: true, pos });
  card.summonTurn = g.turn;
  card.summonMethod = 'special';
  card.properlySummoned = true;
  g.log(`${g.players[p].name} Special Summons ${card.name} to ${g.players[ctrl].name}'s field.`, 'action', p);
  await g.anim({ type: 'summon', cards: [card.uid], method: 'special', from: [from] });
  if (await g.summonNegationWindow([card], p, 'special')) return false;
  g.beginBatch();
  const common = { card, player: ctrl, from, to: 'mzone' as Location, method: 'special' as const };
  g.emit({ type: 'specialSummoned', ...common });
  g.emit({ type: 'summoned', ...common });
  await g.processTriggers(true);
  return true;
}

/**
 * Replace the resolution of a chain link: when `guard()` holds at resolution, the link's effect is negated and
 * its card destroyed (The Fool, Dark General Freed). Same technique as Spirit Reaper in monsters.ts.
 */
function negateLinkOnResolve(g: Game, link: ChainLink, by: C, guard: () => boolean) {
  const orig = link.effect;
  link.effect = {
    ...orig,
    resolve: async (c) => {
      if (guard()) {
        g.log(`${by.name} negates the effect of ${link.card.name}.`, 'chain', by.controller);
        if (link.card.onField && link.card !== by) await g.destroy([link.card], 'effect', by.controller, by);
        return;
      }
      if (orig.resolve) await orig.resolve(c);
    },
  };
}

/** Expected battle damage player p takes in the current battle (AI hint). */
function expectedBattleDamage(g: Game, p: PlayerId): number {
  const b = g.battle;
  if (!b) return 0;
  const a = b.attacker;
  const t = b.target;
  const atkA = g.getAtk(a);
  if (!t) return a.controller !== p ? atkA : 0;
  if (t.pos === 'atk') {
    const atkT = g.getAtk(t);
    if (atkA > atkT && t.controller === p) return atkA - atkT;
    if (atkT > atkA && a.controller === p) return atkT - atkA;
    return 0;
  }
  const defT = g.getDef(t);
  if (defT > atkA && a.controller === p) return defT - atkA;
  if (atkA > defT && t.controller === p && g.queryCard(a, 'piercing')) return atkA - defT;
  return 0;
}

/** Face-up, applying (resolved, not negated) cards with this name on the field. */
function liveCards(g: Game, name: string, p?: PlayerId): C[] {
  return g
    .allFieldCards()
    .filter((c) => c.name === name && c.faceUp && (c.isMonster ? c.location === 'mzone' : c.activeOnField) && (p === undefined || c.controller === p) && !g.isNegated(c));
}

/** Effects of this file that roll a die (Dice Try!). APPROX: other cards' dice effects are recognised from their text. */
const DICE_EFFECTS = new WeakSet<EffectDef>();
function rollsDice(link: ChainLink) {
  if (DICE_EFFECTS.has(link.effect)) return true;
  if (link.card.name === 'Dice Try!' || DICE_CARD_NAMES.has(link.card.name)) return false;
  return /\b(die|dice)\b/i.test(link.card.data.text ?? '');
}
/** Cards of this file whose text mentions dice but whose given effect may not (their dice effects are in DICE_EFFECTS). */
const DICE_CARD_NAMES = new Set(['Dangerous Machine Type-6', 'Maximum Six']);
async function rollDie(ctx: Ctx) {
  const r = ctx.game.rng.int(6) + 1;
  ctx.log(`${ctx.self.name}: die roll — ${r}.`);
  return r;
}

// ============================================================ per-game rule patches

interface LodtGameState {
  /** Players whose next turn is skipped (Arcana Force XXI - The World). */
  skip: Set<PlayerId>;
  /** Tour of Doom: player p cannot Normal/Flip Summon during turn `turn`. */
  tour: { p: PlayerId; turn: number }[];
  swampBusy: boolean;
}
const GSTATE = new WeakMap<Game, LodtGameState>();
function gs(g: Game): LodtGameState {
  let s = GSTATE.get(g);
  if (!s) GSTATE.set(g, (s = { skip: new Set(), tour: [], swampBusy: false }));
  return s;
}

/** Number of Summons player p has made this turn (Summon Limit). APPROX: counts successful Summons only, credited to the
 *  player whose field the monster lands on. */
function summonsThisTurn(g: Game, p: PlayerId) {
  return turnEvents(g).filter((e) => e.type === 'summoned' && e.player === p).length;
}
/** Summons player p may still make this turn (Infinity without an applying Summon Limit). */
function summonsLeft(g: Game, p: PlayerId) {
  if (!liveCards(g, SUMMON_LIMIT).length) return Infinity;
  return Math.max(0, 2 - summonsThisTurn(g, p));
}
const tourBlocks = (g: Game, p: PlayerId) => gs(g).tour.some((t) => t.p === p && t.turn === g.turn);
/** Tualatin: `p` cannot Normal/Special Summon monsters of the chosen Attribute. */
const tualatinBlocks = (g: Game, p: PlayerId, c: C) =>
  liveCards(g, TUALATIN).some((t) => t.controller !== p && !!t.flags.tualAttr && c.data.attribute === t.flags.tualAttr);
/** "You can only control 1 Guardian of Order" / "If you control a Miracle Flipper, you cannot Summon this card". */
const uniqueBlocks = (g: Game, ctrl: PlayerId, c: C) => (c.name === GUARDIAN || c.name === FLIPPER) && g.monsters(ctrl).some((m) => m !== c && m.name === c.name);
/** Arcana Force VI - The Lovers (Tails): neither player can Tribute Summon "Arcana Force" monsters. */
const loversTailsBlocks = (g: Game, c: C) => isArcana(c) && g.tributesNeeded(c) > 0 && arcAny(g, AF6, 'T').length > 0;
/** Monsters that can never be Special Summoned by a card effect. */
const NO_EFFECT_SS = new Set([FREED, AFEX]);
function effectSummonForbidden(g: Game, c: C, player: PlayerId, ctrl: PlayerId) {
  if (NO_EFFECT_SS.has(c.name)) return true;
  if (c.location === 'deck' && liveCards(g, DECK_LOCKDOWN).length) return true;
  return uniqueBlocks(g, ctrl, c) || tualatinBlocks(g, player, c);
}
const simorghActive = (g: Game) => liveCards(g, SIMORGH).length > 0;
const angelO7Active = (g: Game) => liveCards(g, ANGEL_O7).some((c) => !!c.flags.o7);
function activationBlocked(g: Game, card: C, ef: EffectDef) {
  if (ef.kind === 'continuous' || ef.kind === 'proc') return false;
  if (card.isMonster && angelO7Active(g)) return true;
  if ((card.isSpell || card.isTrap) && ef.kind === 'activate' && card.onField && !card.faceUp && liveCards(g, SANGUINE_SWAMP).length) return true;
  return false;
}

/** Sanguine Swamp: "If you control any other Spell or Trap Cards, destroy this card." */
async function swampCheck(g: Game) {
  const s = gs(g);
  if (s.swampBusy) return;
  s.swampBusy = true;
  try {
    for (const sw of liveCards(g, SANGUINE_SWAMP)) {
      if (!sw.onField) continue;
      if (g.spellTraps(sw.controller).some((c) => c !== sw)) {
        g.log(`${sw.name} is destroyed (its controller controls another Spell/Trap Card).`, 'action', sw.controller);
        await g.destroy([sw], 'effect', sw.controller, sw);
      }
    }
  } finally {
    s.swampBusy = false;
  }
}

const PATCHED = new WeakSet<Game>();
export function ensureLodtPatches(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;

  // ---- battle damage
  const origDamage = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: C, sourcePlayer?: PlayerId) => {
    if (kind === 'battle' && amount > 0) {
      const b = g.battle as any;
      if (b?.lodtNoDamage?.has(p)) {
        g.log(`${g.players[p].name} takes no battle damage (Arcana Force XIV - Temperance).`, 'battle', p);
        return 0;
      }
      if (source && source.controller !== p && source.flags.lodtUnion?.turn === g.turn) {
        g.log(`${source.name} cannot inflict battle damage (Union Attack).`, 'battle', p);
        return 0;
      }
      for (const t of [...g.monsters(0), ...g.monsters(1)]) {
        if ((arcIs(g, t, AF14, 'H') && t.controller === p) || (arcIs(g, t, AF14, 'T') && t.controller !== p)) {
          amount = Math.floor(amount / 2);
          g.log(`${t.name} halves the battle damage to ${amount}.`, 'battle', p);
        }
      }
    }
    return origDamage(p, amount, kind, source, sourcePlayer);
  };

  // ---- Tribute requirements
  const origNeed = g.tributesNeeded.bind(g);
  anyG.tributesNeeded = (card: C) => {
    if (card.name === FOG_KING && card.flags.lodtFogNeed !== undefined) return card.flags.lodtFogNeed as number;
    let n = origNeed(card);
    if (n > 0 && card.data.attribute === 'WIND' && simorghActive(g)) n -= 1; // APPROX: also applies to Tribute Sets
    return n;
  };
  const origCands = g.tributeCandidates.bind(g) as (p: PlayerId, forCard?: C) => C[];
  anyG.tributeCandidates = (p: PlayerId, forCard?: C) => origCands(p, forCard).filter((c) => !(c.name === MUSASABI && c.faceUp && !g.isNegated(c)));

  // ---- Normal Summon legality
  const origCanNS = g.canNormalSummon.bind(g);
  anyG.canNormalSummon = (p: PlayerId, card: C, set = false) => {
    let ok = origCanNS(p, card, set);
    if (!ok && !set && card.name === FOG_KING && card.location === 'hand' && g.players[p].normalSummonsLeft > 0 && !g.queryPlayer(p, 'cannotNormalSummon')) {
      ok = g.freeMZones(p) > 0; // Fog King: Normal Summon without Tributing
    }
    if (!ok) return false;
    if (uniqueBlocks(g, p, card) && (card.name === GUARDIAN || !set)) return false;
    if (set) {
      if (card.name === DINOBEAST && origCands(p, card).length < 2) return false;
      return true;
    }
    if (loversTailsBlocks(g, card) || tourBlocks(g, p) || summonsLeft(g, p) < 1 || tualatinBlocks(g, p, card)) return false;
    return true;
  };
  const origNS = g.normalSummon.bind(g);
  anyG.normalSummon = async (p: PlayerId, card: C, set: boolean) => {
    if (set) card.flags.lodtSetting = true;
    try {
      if (card.name === FOG_KING && !set) {
        const cands = g.tributeCandidates(p, card);
        const opts = ['No Tribute'];
        if (cands.length >= 1) opts.push('Tribute 1 monster');
        if (cands.length >= 2) opts.push('Tribute 2 monsters');
        const cheapest = Math.min(...cands.map((c) => cardValue(g, c)));
        const i = await g.option(p, `Normal Summon ${card.name}:`, opts, card, (k) => (k === 1 && cheapest < 1500 ? 2 : k === 0 ? 1 : 0));
        card.flags.lodtFogNeed = i;
      }
      return await origNS(p, card, set);
    } finally {
      if (card.location === 'hand') {
        delete card.flags.lodtSetting;
        delete card.flags.lodtFogNeed;
      }
    }
  };

  // ---- Special Summon legality
  const origSS = g.specialSummon.bind(g);
  anyG.specialSummon = async (cards: C[], player: PlayerId, opts: Parameters<Game['specialSummon']>[2] = {}) => {
    const ctrl = opts?.controller ?? player;
    let list = cards.filter((c) => !effectSummonForbidden(g, c, player, ctrl));
    const left = summonsLeft(g, player);
    if (left < list.length) list = list.slice(0, left);
    if (!list.length) return [];
    return origSS(list, player, opts);
  };
  const origISS = g.inherentSpecialSummon.bind(g);
  anyG.inherentSpecialSummon = async (p: PlayerId, card: C, ...rest: any[]) => {
    if (summonsLeft(g, p) < 1 || tualatinBlocks(g, p, card) || uniqueBlocks(g, p, card)) return false;
    return (origISS as any)(p, card, ...rest);
  };
  const origCanSyn = g.canSynchro.bind(g);
  anyG.canSynchro = (p: PlayerId, syn: C) => origCanSyn(p, syn) && summonsLeft(g, p) >= 1 && !tualatinBlocks(g, p, syn);
  const origLMA = g.legalMainActions.bind(g);
  anyG.legalMainActions = (p: PlayerId) =>
    origLMA(p).filter((a: Action) => {
      if (a.type === 'flip') return !tourBlocks(g, p) && summonsLeft(g, p) >= 1;
      if (a.type === 'proc') return summonsLeft(g, p) >= 1 && !tualatinBlocks(g, p, a.card) && !uniqueBlocks(g, p, a.card);
      return true;
    });

  // ---- attack targets: Miracle Flipper
  const origAT = g.attackTargets.bind(g);
  anyG.attackTargets = (attacker: C) => {
    const r = origAT(attacker);
    const def = g.opp(attacker.controller);
    if (g.faceUpMonsters(def).some((c) => c.name === FLIPPER && !g.isNegated(c))) {
      r.targets = r.targets.filter((t) => !t.faceUp || t.name === FLIPPER);
    }
    return r;
  };

  // ---- activations: Angel O7, Sanguine Swamp
  const origCAE = g.canActivateEffect.bind(g);
  anyG.canActivateEffect = (player: PlayerId, card: C, ef: EffectDef, idx: number, mode: any) => {
    if (activationBlocked(g, card, ef)) return null;
    return origCAE(player, card, ef, idx, mode);
  };
  const origAct = g.activate.bind(g);
  anyG.activate = async (player: PlayerId, act: any) => {
    if (activationBlocked(g, act.card, act.effect)) {
      g.log(`${act.card.name}'s effect cannot be activated.`, 'info', player);
      return null;
    }
    return origAct(player, act);
  };
  const origRC = g.ruleCleanup.bind(g);
  anyG.ruleCleanup = async () => {
    await origRC();
    await swampCheck(g);
  };
  const origPA = g.performAction.bind(g);
  anyG.performAction = async (p: PlayerId, a: Action) => {
    await origPA(p, a);
    await swampCheck(g);
  };

  // ---- the normal draw: Dark General Freed, Mystical Cards of Light
  const origDraw = g.draw.bind(g);
  anyG.draw = async (p: PlayerId, n = 1, reason: any = 'draw') => {
    if (reason === 'draw' && n === 1 && g.phase === 'draw' && p === g.turnPlayer && !g.turnData['lodt:normalDraw']) {
      g.turnData['lodt:normalDraw'] = true;
      const freed = liveCards(g, FREED, p)[0];
      const darks = g.players[p].deck.filter((c) => c.isMonster && c.data.attribute === 'DARK' && lvl(c) === 4 && !c.isExtra);
      if (freed && darks.length && !g.queryPlayer(p, 'cannotAddFromDeck')) {
        const yes = await g.confirm(p, 'Dark General Freed: add 1 Level 4 DARK monster from your Deck instead of drawing?', freed, true);
        if (yes) {
          const [pick] = await g.select(p, darks, 1, 1, 'Add 1 Level 4 DARK monster to your hand.', 'toHand', { source: freed });
          if (pick) {
            await g.toHand([pick], 'effect', p, freed);
            g.log(`${g.players[p].name} adds ${pick.name} to their hand (Dark General Freed).`, 'action', p);
            g.shuffleDeck(p);
            return [];
          }
        }
      }
      if (liveCards(g, MCOL, p).length >= 2 && g.players[p].deck.length >= 2) {
        const src = liveCards(g, MCOL, p)[0];
        if (await g.confirm(p, 'Mystical Cards of Light: draw 2 cards instead of 1?', src, true)) n = 2;
      }
    }
    return origDraw(p, n, reason);
  };

  // ---- Spell & Trap Zones: Mystical Cards of Light (APPROX: the count of free zones is reduced; zones are not tied to a slot)
  const origFreeS = g.freeSZones.bind(g);
  anyG.freeSZones = (p: PlayerId) => Math.max(0, origFreeS(p) - g.zone(p, 'szone').filter((c) => c.name === MCOL && c.faceUp).length);

  // ---- turns: Arcana Force XXI - The World
  const origPT = g.playTurn.bind(g);
  anyG.playTurn = async () => {
    const next = g.opp(g.turnPlayer);
    const s = gs(g);
    if (s.skip.has(next) && !g.over) {
      s.skip.delete(next);
      g.turn++;
      g.turnPlayer = next;
      g.turnData = {};
      g.log(`— Turn ${g.turn}: ${g.players[next].name}'s turn is skipped (Arcana Force XXI - The World) —`, 'phase', next);
      await g.anim({ type: 'turn', player: next, turn: g.turn });
      for (const c of g.allCards) c.tempMods = c.tempMods.filter((t) => t.until === 'field' || (t.until === 'opponentEnd' && t.turn === g.turn));
      g.playerMods = g.playerMods.filter((m) => m.until === 'nextTurnEnd' && m.turn === g.turn);
      g.update();
      return;
    }
    return origPT();
  };
}

/** Installs the per-game patches at the first phase (from any location, never activates). */
const PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  eventFilter: (ctx) => {
    ensureLodtPatches(ctx.game);
    return false;
  },
};

type MonsterOpts = Parameters<typeof monster>[1];
type STOpts = Parameters<typeof spell>[2];
/** Define a card of this set (adds the patch installer). */
const M = (name: string, o: MonsterOpts) => monster(name, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });
const S = (name: string, t: Parameters<typeof spell>[1], o: STOpts) => spell(name, t, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });
const T = (name: string, t: Parameters<typeof trap>[1], o: STOpts) => trap(name, t, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });

// ============================================================ Arcana Force coin tosses
// An Arcana Force monster's coin result lives in ARC (keyed by card, valid while it stays face-up on the field).
// Every Arcana Force monster carries the effects of all of them (ARCANA_EFFECTS), each gated on "this card has
// effect <name> for result <coin>", so Arcana Call can swap the effect and Reversal of Fate can flip the result.

type Coin = 'H' | 'T';
interface ArcState {
  moveId: number;
  coin: Coin;
  /** Arcana Call: until the End Phase the effect is the one of `callName`. */
  callName?: string;
  callTurn?: number;
}
const ARC = new WeakMap<C, ArcState>();
const coinName = (c: Coin) => (c === 'H' ? 'Heads' : 'Tails');
function arcState(c: C): ArcState | undefined {
  const s = ARC.get(c);
  return s && s.moveId === c.moveId && faceUpOn(c) ? s : undefined;
}
const arcName = (g: Game, c: C, s: ArcState) => (s.callName && s.callTurn === g.turn ? s.callName : c.name);
/** Does `c` currently apply the coin-toss effect of `name` for result `coin`? */
function arcIs(g: Game, c: C, name: string, coin: Coin, checkNegated = true) {
  const s = arcState(c);
  return !!s && s.coin === coin && arcName(g, c, s) === name && (!checkNegated || !g.isNegated(c));
}
const arcSelf = (ctx: Ctx, name: string, coin: Coin) => arcIs(ctx.game, ctx.self, name, coin);
function arcAny(g: Game, name: string, coin: Coin): C[] {
  return [...g.monsters(0), ...g.monsters(1)].filter((c) => arcIs(g, c, name, coin));
}
/** Coin result `c` had when it just left the field (its effect when destroyed). */
function arcWas(g: Game, c: C, name: string, coin: Coin) {
  const s = ARC.get(c);
  return !!s && s.moveId === c.moveId - 1 && s.coin === coin && (s.callName && s.callTurn === g.turn ? s.callName : c.name) === name;
}
/** AI: the result each Arcana Force monster would rather have (Light Barrier / Reversal of Fate). */
const ARC_PREF: Record<string, Coin> = { [AF0]: 'T' };
const arcPref = (name: string): Coin => ARC_PREF[name] ?? 'H';
/** AI: an own Arcana Force monster worth fixing (wrong result, and not a Heads Fool that negates our own effects). */
const arcWantsFix = (g: Game, c: C) => {
  const s = arcState(c);
  return !!s && s.coin !== arcPref(arcName(g, c, s)) && !arcIs(g, c, AF0, 'H');
};

function lightBarrierOn(g: Game, p: PlayerId) {
  const f = g.players[p].fzone;
  return !!f && f.name === LIGHT_BARRIER && f.faceUp && f.activeOnField && !g.isNegated(f) && !f.flags.lbOff;
}
function tossCoin(g: Game, who: PlayerId, source: C): Coin {
  const r: Coin = g.rng.int(2) === 0 ? 'H' : 'T';
  g.log(`${source.name}: coin toss — ${coinName(r)}.`, 'action', who);
  return r;
}
/** Coin toss of an Arcana Force monster's effect, with Light Barrier (choose instead) and Lucky Chance (call it). */
async function arcanaToss(ctx: Ctx, forName: string): Promise<Coin> {
  const g = ctx.game;
  if (lightBarrierOn(g, ctx.player)) {
    const pref = arcPref(forName);
    const i = await ctx.option(`Light Barrier: choose the effect of ${forName}.`, ['Heads', 'Tails'], (k) => (k === (pref === 'H' ? 0 : 1) ? 1 : 0));
    const r: Coin = i === 0 ? 'H' : 'T';
    ctx.log(`Light Barrier: ${forName} applies its ${coinName(r)} effect without a coin toss.`);
    return r;
  }
  // Lucky Chance (APPROX: only Arcana Force coin tosses are recognised): the call is made before the toss.
  const calls: { p: PlayerId; call: Coin }[] = [];
  const chainKey = g.chain[0] ?? null;
  for (const lc of liveCards(g, LUCKY_CHANCE)) {
    if (chainKey && lc.flags.lcChain === chainKey) continue;
    lc.flags.lcChain = chainKey;
    // 2010 ruling: with 2 or more face-up "Lucky Chance" you call the toss only once and draw only 1 card.
    // https://edisonrul.ing/cards/l/lucky-chance.html
    if (calls.some((c) => c.p === lc.controller)) continue;
    const guess = g.rng.int(2);
    const i = await g.option(lc.controller, 'Lucky Chance: call the coin toss.', ['Heads', 'Tails'], lc, (k) => (k === guess ? 1 : 0));
    calls.push({ p: lc.controller, call: i === 0 ? 'H' : 'T' });
  }
  const r = tossCoin(g, ctx.player, ctx.self);
  for (const c of calls) if (c.call === r) ((ctx.data.luckyDraws ??= []) as PlayerId[]).push(c.p);
  return r;
}
async function luckyDraws(ctx: Ctx) {
  const list = (ctx.data.luckyDraws ?? []) as PlayerId[];
  ctx.data.luckyDraws = [];
  for (const p of list) {
    ctx.game.log(`Lucky Chance: ${ctx.game.players[p].name} called it right and draws 1 card.`, 'action', p);
    await ctx.game.draw(p, 1, 'effect');
  }
}
/** Effects applied the moment they are gained (Arcana Force VII - The Chariot, Tails). */
async function arcanaOnGain(g: Game, c: C) {
  if (arcIs(g, c, AF7, 'T')) {
    g.log(`${c.name}: control passes to ${g.players[g.opp(c.controller)].name}.`, 'action', c.controller);
    await g.takeControl(c, g.opp(c.controller), false);
  }
}
function setArc(g: Game, c: C, coin: Coin) {
  ARC.set(c, { moveId: c.moveId, coin });
  g.log(`${c.name} gains its ${coinName(coin)} effect.`, 'action', c.controller);
}

/** "If this card is Summoned: Toss a coin" (EX: "When this card is Special Summoned"). */
function arcanaTossTrigger(event: EventType = 'summoned'): EffectDef {
  return {
    kind: 'trigger',
    event,
    mandatory: true,
    label: 'Toss a coin',
    eventFilter: (ctx, ev) => ev.card === ctx.self && faceUpOn(ctx.self),
    resolve: async (ctx) => {
      const self = ctx.self;
      if (!faceUpOn(self)) return;
      const coin = await arcanaToss(ctx, self.name);
      setArc(ctx.game, self, coin);
      await arcanaOnGain(ctx.game, self);
      await luckyDraws(ctx);
    },
  };
}

/** The coin-toss effects of every Arcana Force monster of this set (each gated on name + result). */
const ARCANA_EFFECTS: EffectDef[] = [
  {
    // A face-down Arcana Force monster loses its coin result: flipped face-up again it has no effect unless it is
    // Flip Summoned (a new toss). Face-down monsters see no events but 'flipped', and 'flipped' is emitted before the
    // 'summoned' of a Flip Summon, so the result is dropped on the flip.
    kind: 'trigger',
    event: 'flipped',
    eventFilter: (ctx, ev) => {
      if (ev.card === ctx.self) ARC.delete(ctx.self);
      return false;
    },
  },
  {
    // The Fool: negate (and destroy) your (Heads) / your opponent's (Tails) card effects that target this card.
    kind: 'trigger',
    event: 'chainActivated',
    eventFilter: (ctx, ev) => {
      const me = ctx.self;
      const g = ctx.game;
      const link = ev.data?.link as ChainLink | undefined;
      if (!link || !link.ctx.targets.includes(me) || link.card === me) return false;
      const mine = link.player === me.controller;
      const coin: Coin = mine ? 'H' : 'T';
      if (!arcIs(g, me, AF0, coin)) return false;
      const moveId = me.moveId;
      negateLinkOnResolve(g, link, me, () => me.moveId === moveId && arcIs(g, me, AF0, coin));
      return false;
    },
  },
  {
    // APPROX (both Magician results): several Spells activated in the same Chain trigger it once.
    kind: 'trigger',
    event: 'chainActivated',
    mandatory: true,
    label: 'The Magician (Heads): ATK doubles',
    categories: ['atkChange'],
    eventFilter: (ctx, ev) => {
      const l = ev.data?.link as ChainLink | undefined;
      return !!l && l.isCardActivation && l.card.isSpell && arcSelf(ctx, AF1, 'H');
    },
    condition: (ctx) => arcSelf(ctx, AF1, 'H'),
    resolve: async (ctx) => {
      const s = ctx.self;
      if (!faceUpOn(s)) return;
      s.flags.setAtk = 2 * (s.data.atk ?? 0);
      s.flags.setAtkTurn = ctx.turn;
      ctx.log(`${s.name}'s ATK becomes ${s.flags.setAtk} until the end of the turn.`);
    },
  },
  {
    kind: 'trigger',
    event: 'chainActivated',
    mandatory: true,
    label: 'The Magician (Tails): opponent gains 500 LP',
    categories: ['recover'],
    eventFilter: (ctx, ev) => {
      const l = ev.data?.link as ChainLink | undefined;
      return !!l && l.isCardActivation && l.card.isSpell && arcSelf(ctx, AF1, 'T');
    },
    condition: (ctx) => arcSelf(ctx, AF1, 'T'),
    resolve: async (ctx) => {
      await ctx.recover(ctx.opp, 500);
    },
  },
  {
    kind: 'trigger',
    event: ['normalSummoned', 'monsterSet'],
    when: true,
    label: 'The Empress (Heads): Special Summon an Arcana Force',
    categories: ['specialSummon'],
    eventFilter: (ctx, ev) => ev.player === ctx.opp && arcSelf(ctx, AF3, 'H'),
    condition: (ctx) => arcSelf(ctx, AF3, 'H'),
    canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => isArcana(c) && ctx.canSummonCard(c)).length > 0,
    resolve: async (ctx) => {
      const cands = ctx.hand('me', (c) => isArcana(c) && ctx.canSummonCard(c));
      const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 "Arcana Force" monster from your hand.', 'specialSummon');
      if (c) await ctx.specialSummon(c, { pos: 'choose' });
    },
  },
  {
    kind: 'trigger',
    event: ['normalSummoned', 'monsterSet'],
    mandatory: true,
    label: 'The Empress (Tails): send 1 card from your hand to the GY',
    categories: ['discard'],
    eventFilter: (ctx, ev) => ev.player === ctx.opp && arcSelf(ctx, AF3, 'T'),
    condition: (ctx) => arcSelf(ctx, AF3, 'T') && ctx.hand().length > 0,
    resolve: async (ctx) => {
      const [c] = await ctx.select(ctx.hand(), 1, 1, 'Send 1 card from your hand to the GY.', 'toGrave');
      if (c) await ctx.sendToGrave(c);
    },
  },
  {
    kind: 'continuous',
    active: (ctx) => arcIs(ctx.game, ctx.self, AF4, 'H', false),
    mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => c.faceUpMonster && c.controller === ctx.player && isArcana(c), value: 500 }],
  },
  {
    kind: 'continuous',
    active: (ctx) => arcIs(ctx.game, ctx.self, AF4, 'T', false),
    mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => c.faceUpMonster && c.controller === ctx.player && isArcana(c), value: -500 }],
  },
  {
    // The Lovers (Heads): can be treated as 2 Tributes for the Tribute Summon of an "Arcana Force" monster.
    kind: 'continuous',
    active: (ctx) => arcIs(ctx.game, ctx.self, AF6, 'H', false),
    altTribute: (ctx, summoned, trib) => trib === ctx.self && isArcana(summoned),
  },
  {
    kind: 'trigger',
    event: 'battleDestroyed',
    when: true,
    label: 'The Chariot (Heads): Special Summon the destroyed monster',
    categories: ['specialSummon'],
    eventFilter: (ctx, ev) => {
      const v = evc(ev);
      return ev.other === ctx.self && !!v && ev.fromController !== ctx.self.controller && v.location === 'grave' && arcSelf(ctx, AF7, 'H');
    },
    condition: (ctx) => arcSelf(ctx, AF7, 'H'),
    canActivate: (ctx) => {
      const v = evc(ctx.event!);
      return !!v && v.location === 'grave' && ctx.canSummonCard(v);
    },
    resolve: async (ctx) => {
      const v = evc(ctx.event!);
      if (v && v.location === 'grave' && ctx.canSummonCard(v)) await ctx.specialSummon(v, { pos: 'choose' });
    },
  },
  {
    kind: 'trigger',
    event: 'phaseStart',
    opt: true,
    label: 'The Moon (Heads): Special Summon a Moon Token',
    categories: ['specialSummon'],
    eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && arcSelf(ctx, AF18, 'H'),
    condition: (ctx) => arcSelf(ctx, AF18, 'H') && ctx.canSpecialSummon(),
    resolve: async (ctx) => {
      if (ctx.canSpecialSummon()) await ctx.createTokens(MOON_TOKEN, 1, 'def');
    },
  },
  {
    kind: 'trigger',
    event: 'phaseStart',
    opt: true,
    mandatory: true,
    label: 'The Moon (Tails): give control of 1 monster',
    categories: ['control'],
    eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && arcSelf(ctx, AF18, 'T'),
    condition: (ctx) => arcSelf(ctx, AF18, 'T') && ctx.monsters('me', (c) => ctx.canTarget(c)).length > 0,
    activate: async (ctx) => {
      await ctx.selectTargets(ctx.monsters('me'), 1, 1, 'Target 1 monster you control; your opponent gains control of it.', 'cost', {
        aiScore: (c) => -cardValue(ctx.game, c),
      });
    },
    resolve: async (ctx) => {
      const [t] = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.player);
      if (t) await ctx.game.takeControl(t, ctx.opp, false);
    },
  },
  {
    kind: 'trigger',
    event: 'phaseStart',
    opt: true,
    label: 'The World (Heads): send 2 monsters, skip the next turn',
    categories: [],
    eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && arcSelf(ctx, AF21, 'H'),
    condition: (ctx) => arcSelf(ctx, AF21, 'H') && ctx.monsters('me').length >= 2,
    activate: async (ctx) => {
      const sel = await ctx.select(ctx.monsters('me'), 2, 2, 'Send 2 monsters you control to the GY.', 'cost', {
        aiScore: (c) => -cardValue(ctx.game, c) - (c === ctx.self ? 5000 : 0),
      });
      if (sel.length < 2) return false;
      await ctx.sendToGrave(sel, 'cost');
    },
    resolve: async (ctx) => {
      gs(ctx.game).skip.add(ctx.opp);
      ctx.log(`${ctx.game.players[ctx.opp].name}'s next turn will be skipped.`);
    },
    ai: {
      score: (ctx) => {
        const others = ctx.monsters('me', (c) => c !== ctx.self).map((c) => cardValue(ctx.game, c)).sort((a, b) => a - b);
        return others.length >= 2 && others[0] + others[1] <= 3200 ? 1 : 0;
      },
    },
  },
  {
    kind: 'trigger',
    event: 'phaseStart',
    opt: true,
    mandatory: true,
    label: "The World (Tails): your opponent adds the top card of their GY",
    categories: ['toHand'],
    eventFilter: (ctx, ev) => ev.phase === 'draw' && !ctx.isMyTurn && arcSelf(ctx, AF21, 'T'),
    condition: (ctx) => arcSelf(ctx, AF21, 'T') && ctx.grave('opp').length > 0,
    resolve: async (ctx) => {
      const gy = ctx.grave('opp');
      const top = gy[gy.length - 1];
      if (top) await ctx.game.toHand([top], 'effect', ctx.player, ctx.self);
    },
  },
  {
    kind: 'continuous',
    active: (ctx) => arcIs(ctx.game, ctx.self, AFEX, 'H', false),
    mods: [{ q: 'extraAttacks', value: 1 }],
  },
  {
    kind: 'continuous',
    mods: [{ q: 'cannotChangePos', value: (ctx) => (ctx.self.flags.exLock ?? -1) >= ctx.turn }],
  },
  {
    kind: 'trigger',
    event: 'battleEnd',
    mandatory: true,
    label: 'The Dark Ruler (Heads): change to Defense Position',
    categories: ['position'],
    eventFilter: (ctx) => arcSelf(ctx, AFEX, 'H') && ctx.self.attacksThisTurn >= 2 && ctx.self.pos === 'atk',
    resolve: async (ctx) => {
      if (!faceUpOn(ctx.self)) return;
      await ctx.changePos(ctx.self, 'def');
      ctx.self.flags.exLock = ctx.turn + 2;
    },
  },
  {
    kind: 'trigger',
    event: 'destroyed',
    mandatory: true,
    label: 'The Dark Ruler (Tails): destroy all cards on the field',
    categories: ['destroy', 'destroyMulti'],
    eventFilter: (ctx, ev) => ev.card === ctx.self && fromField(ev) && arcWas(ctx.game, ctx.self, AFEX, 'T'),
    resolve: async (ctx) => {
      await ctx.destroy(ctx.field('both'));
    },
  },
];

const MOON_TOKEN = token('Moon Token', 'LIGHT', 'Fairy', 1, 0, 0);

const ARCANA_TOSS_TEXT = 'If this card is Summoned: Toss a coin.';
function arcana(name: string, level: number, atk: number, def: number, text: string, extra: EffectDef[] = [], o: Partial<MonsterOpts> = {}) {
  return M(name, {
    attribute: 'LIGHT',
    race: 'Fairy',
    level,
    atk,
    def,
    sets: ['arcana-force'],
    text,
    aiValue: 200,
    ...o,
    effects: [...extra, ...(o.effects ?? [arcanaTossTrigger()]), ...ARCANA_EFFECTS],
  });
}

// ============================================================ MONSTERS — Arcana Force

arcana(
  AF0,
  1,
  0,
  0,
  "Cannot be destroyed by battle. Cannot be changed to Defense Position. If this card is Summoned: Toss a coin.\n● Heads: Negate your card effects that target this card, and if you do, destroy them.\n● Tails: Negate your opponent's card effects that target this card, and if you do, destroy them.",
  [{ kind: 'continuous', mods: [{ q: 'indestructibleBattle' }, { q: 'cannotChangePos', value: (ctx) => ctx.self.pos === 'atk' }] }],
  { aiValue: 300 },
);

arcana(
  AF1,
  4,
  1100,
  1100,
  `${ARCANA_TOSS_TEXT}\n● Heads: If a Spell Card is activated, this card's ATK becomes double its original ATK until the end of that turn.\n● Tails: If a Spell Card is activated, your opponent gains 500 LP.`,
);

arcana(
  AF3,
  4,
  1300,
  1300,
  `${ARCANA_TOSS_TEXT}\n● Heads: When your opponent Normal Summons/Sets a monster: You can Special Summon 1 "Arcana Force" monster from your hand.\n● Tails: Each time your opponent Normal Summons/Sets a monster: Send 1 card from your hand to the GY.`,
);

arcana(
  AF4,
  4,
  1400,
  1400,
  `${ARCANA_TOSS_TEXT}\n● Heads: All "Arcana Force" monsters you control gain 500 ATK.\n● Tails: All "Arcana Force" monsters you control lose 500 ATK.`,
);

arcana(
  AF6,
  4,
  1600,
  1600,
  `${ARCANA_TOSS_TEXT}\n● Heads: This card can be treated as 2 Tributes for the Tribute Summon of an "Arcana Force" monster.\n● Tails: Neither player can Tribute Summon "Arcana Force" monsters.`,
);

arcana(
  AF7,
  4,
  1700,
  1700,
  `${ARCANA_TOSS_TEXT}\n● Heads: When this card destroys an opponent's monster by battle: You can Special Summon that monster to your field.\n● Tails: Give control of this card to your opponent.`,
);

arcana(
  AF14,
  6,
  2400,
  2400,
  `During damage calculation (Quick Effect): You can discard this card; you take no battle damage from that battle. ${ARCANA_TOSS_TEXT}\n● Heads: Halve all battle damage you take.\n● Tails: Halve all battle damage your opponent takes.`,
  [
    {
      kind: 'quick',
      range: ['hand'],
      damageStep: true,
      label: 'Discard: take no battle damage',
      categories: ['protect'],
      condition: (ctx) => {
        const b = ctx.battle as any;
        if (!b || !b.inDamageStep) return false;
        const involved = b.attacker.controller === ctx.player || (b.target ? b.target.controller === ctx.player : true);
        return involved && !b.lodtNoDamage?.has(ctx.player);
      },
      activate: async (ctx) => {
        await ctx.discard(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const b = ctx.battle as any;
        if (!b) return;
        (b.lodtNoDamage ??= new Set<PlayerId>()).add(ctx.player);
        ctx.log(`${ctx.game.players[ctx.player].name} will take no battle damage from this battle.`);
      },
      ai: { score: (ctx) => (expectedBattleDamage(ctx.game, ctx.player) >= 1000 ? 70 : 0) },
    },
  ],
);

arcana(
  AF18,
  7,
  2800,
  2800,
  `${ARCANA_TOSS_TEXT}\n● Heads: Once per turn, during your Standby Phase: You can Special Summon 1 "Moon Token" (Fairy/LIGHT/Level 1/ATK 0/DEF 0).\n● Tails: Once per turn, during your End Phase: Target 1 monster you control; give control of it to your opponent.`,
);

arcana(
  AF21,
  8,
  3100,
  3100,
  `${ARCANA_TOSS_TEXT}\n● Heads: Once per turn, during your End Phase: You can send 2 monsters you control to the GY; skip your opponent's next turn.\n● Tails: Once per turn, during your opponent's Draw Phase: Add the top card of their GY to their hand.`,
  [],
  { aiValue: 500 },
);

arcana(
  AFEX,
  10,
  4000,
  4000,
  'Cannot be Normal Summoned/Set. Must be Special Summoned (from your hand) by sending 3 monsters you control to the Graveyard, and cannot be Special Summoned by other ways. When this card is Special Summoned: Toss a coin and gain the appropriate effect.\n● Heads: This card can make a second attack during each Battle Phase, but if it does so using this effect, change it to Defense Position at the end of the Battle Phase. Its battle position cannot be changed until the end of your next turn.\n● Tails: If this card is destroyed, destroy all cards on the field.',
  [
    {
      kind: 'proc',
      label: 'Special Summon (send 3 monsters)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.monsters('me').length >= 3,
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.monsters('me'), 3, 3, 'Send 3 monsters you control to the GY.', 'cost');
        if (sel.length < 3) return false;
        await ctx.sendToGrave(sel, 'cost');
        return true;
      },
      ai: {
        score: (ctx) => {
          const v = ctx
            .monsters('me')
            .map((c) => cardValue(ctx.game, c))
            .sort((a, b) => a - b)
            .slice(0, 3)
            .reduce((a, b) => a + b, 0);
          return v <= 4500 ? 66 : 0;
        },
      },
    },
  ],
  { cannotNormalSummon: true, nomi: true, aiValue: 600, effects: [arcanaTossTrigger('specialSummoned')] },
);

// ============================================================ MONSTERS

M(GUARDIAN, {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 8,
  atk: 2500,
  def: 1200,
  aiValue: 300,
  text: 'If you control 2 or more LIGHT monsters, you can Special Summon this card (from your hand). You can only control 1 "Guardian of Order".',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon',
      categories: ['specialSummon'],
      condition: (ctx) =>
        ctx.freeMZones() > 0 && ctx.faceUpMonsters('me', (c) => c.data.attribute === 'LIGHT').length >= 2 && !ctx.monsters('me', (c) => c.name === GUARDIAN).length,
      ai: { score: () => 74 },
    },
  ],
});

M('Cross Porter', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 2,
  atk: 400,
  def: 400,
  aiValue: 300,
  text: 'You can target 1 monster you control; send that target to the GY, and if you do, Special Summon 1 "Neo-Spacian" monster from your hand. When this card is sent to the GY: You can add 1 "Neo-Spacian" monster from your Deck to your hand.',
  effects: [
    {
      kind: 'ignition',
      label: 'Send 1 monster: Special Summon a Neo-Spacian',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') && ctx.monsters('me', (c) => ctx.canTarget(c)).length > 0 && ctx.hand('me', isNeoSpacian).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('me'), 1, 1, 'Target 1 monster you control to send to the GY.', 'cost', {
          aiScore: (c) => (c === ctx.self ? 5000 : -cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.player);
        if (!t) return;
        await ctx.sendToGrave(t);
        if (t.location === 'mzone') return;
        const cands = ctx.hand('me', (c) => isNeoSpacian(c) && ctx.canSummonCard(c));
        const [n] = await ctx.select(cands, 1, 1, 'Special Summon 1 "Neo-Spacian" monster from your hand.', 'specialSummon');
        if (n) await ctx.specialSummon(n, { pos: 'choose' });
      },
      ai: { score: (ctx) => (ctx.hand('me', (c) => isNeoSpacian(c) && (c.data.atk ?? 0) >= 900).length ? 45 : 0) },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Add a Neo-Spacian',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.deck('me', isNeoSpacian).length > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck'),
      resolve: async (ctx) => {
        await ctx.search(isNeoSpacian, 1, 'Add 1 "Neo-Spacian" monster from your Deck to your hand.');
      },
    },
  ],
});

M(FLIPPER, {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 2,
  atk: 300,
  def: 500,
  aiValue: 300,
  text: 'If you control a "Miracle Flipper", you cannot Summon this card. Your opponent cannot select another face-up monster as an attack target. If this card is destroyed by battle, Special Summon it to your opponent\'s side of the field at the end of the Battle Phase. If this card is destroyed by the effect of a Spell or Trap Card, destroy 1 monster your opponent controls.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      eventFilter: (ctx, ev) => {
        // 2010 ruling: also when it is removed from play as it is destroyed by battle.
        // https://edisonrul.ing/cards/m/miracle-flipper.html
        if (ev.card === ctx.self && (ctx.self.location === 'grave' || ctx.self.location === 'banished'))
          ctx.self.flags.flipperBattle = { turn: ctx.turn, fromCtrl: ev.fromController ?? ctx.self.owner };
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'battleEnd',
      range: ['grave', 'banished'],
      mandatory: true,
      label: "Special Summon to the opponent's field",
      categories: ['specialSummon'],
      eventFilter: (ctx) => ctx.self.flags.flipperBattle?.turn === ctx.turn,
      resolve: async (ctx) => {
        const rec = ctx.self.flags.flipperBattle as { turn: number; fromCtrl: PlayerId } | undefined;
        delete ctx.self.flags.flipperBattle;
        if (!rec || (ctx.self.location !== 'grave' && ctx.self.location !== 'banished')) return;
        await ctx.specialSummon(ctx.self, { pos: 'choose', controller: ctx.game.opp(rec.fromCtrl) });
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Destroy 1 monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const rc = ev.reasonCard as C | undefined;
        return ev.card === ctx.self && ev.from === 'mzone' && reasonsOf(ev).includes('effect') && !!rc && (rc.isSpell || rc.isTrap);
      },
      // 2010 ruling: this effect targets the monster to be destroyed (also when destroyed face-down).
      // https://edisonrul.ing/cards/m/miracle-flipper.html
      activate: async (ctx) => {
        const g = ctx.game;
        const ctrl = ctx.event?.fromController ?? ctx.player;
        ctx.data.ctrl = ctrl;
        const victims = g.monsters(g.opp(ctrl)).filter((c) => ctx.canTarget(c));
        if (!victims.length) return;
        const sel = await ctx.select(victims, 1, 1, 'Target 1 monster your opponent controls to destroy.', 'destroy', { player: ctrl });
        ctx.addTargets(sel);
      },
      resolve: async (ctx) => {
        const [v] = ctx.validTargets((c) => c.location === 'mzone');
        if (v) await ctx.game.destroy([v], 'effect', (ctx.data.ctrl ?? ctx.player) as PlayerId, ctx.self);
      },
    },
  ],
});

M('Destiny HERO - Dread Servant', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 3,
  atk: 400,
  def: 700,
  sets: ['hero', 'destiny-hero'],
  aiValue: 100,
  text: 'If this card is Normal Summoned: Place 1 Clock Counter on each "Clock Tower Prison". When this card is destroyed by battle and sent to the GY: You can target 1 Spell/Trap you control; destroy that target.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      mandatory: true,
      label: 'Clock Counters',
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      condition: (ctx) => ctx.spellTraps('both', (c) => c.name === 'Clock Tower Prison' && c.faceUp).length > 0,
      resolve: async (ctx) => {
        for (const c of ctx.spellTraps('both', (x) => x.name === 'Clock Tower Prison' && x.faceUp)) c.counters.clock = (c.counters.clock ?? 0) + 1;
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Destroy 1 of your Spells/Traps',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      canActivate: (ctx) => ctx.spellTraps('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('me'), 1, 1, 'Target 1 Spell/Trap you control.', 'cost');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: () => 0 },
    },
  ],
});

M('Volcanic Queen', {
  attribute: 'FIRE',
  race: 'Pyro',
  level: 6,
  atk: 2500,
  def: 1200,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 200,
  text: 'Cannot be Normal Summoned/Set. Must first be Special Summoned (from your hand) to your opponent\'s field by Tributing 1 monster they control. You cannot Normal Summon/Set the turn you Special Summon this card. Once per turn: You can send 1 other card you control to the GY; inflict 1000 damage to your opponent. Once per turn, during your End Phase: Tribute 1 other monster or take 1000 damage.',
  effects: [
    {
      kind: 'proc',
      label: "Special Summon to the opponent's field",
      categories: ['specialSummon'],
      condition: (ctx) => !normalSummonedThisTurn(ctx.game, ctx.player) && ctx.monsters('opp', (c) => tributable(ctx, c)).length > 0,
      perform: async (ctx) => {
        const g = ctx.game;
        const [t] = await ctx.select(ctx.monsters('opp', (c) => tributable(ctx, c)), 1, 1, 'Tribute 1 monster your opponent controls.', 'destroy');
        if (!t) return false;
        await tributeCost(ctx, [t]);
        ctx.addPlayerMod(ctx.player, 'cannotNormalSummon');
        ctx.addPlayerMod(ctx.player, 'cannotSet');
        await summonToField(g, ctx.player, ctx.self, ctx.opp, 'atk');
        return false; // the Summon was performed above (onto the opponent's field)
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.monsters('opp', (c) => tributable(ctx, c)).map((c) => cardValue(ctx.game, c)));
          return best >= 2400 && !normalSummonedThisTurn(ctx.game, ctx.player) ? 62 : 0;
        },
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Send 1 card: 1000 damage',
      categories: ['damage'],
      canActivate: (ctx) => ctx.field('me', (c) => c !== ctx.self).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.field('me', (c) => c !== ctx.self), 1, 1, 'Send 1 other card you control to the GY.', 'cost');
        if (!sel.length) return false;
        await ctx.sendToGrave(sel, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 1000);
      },
      ai: {
        score: (ctx) => {
          if (ctx.oppLp <= 1000) return 95;
          const cheap = ctx.field('me', (c) => c !== ctx.self && cardValue(ctx.game, c) < 1300);
          return cheap.length ? 40 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      opt: true,
      label: 'Tribute 1 monster or take 1000 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && faceUpOn(ctx.self),
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        const others = ctx.monsters('me', (c) => c !== ctx.self && tributable(ctx, c));
        let i = 1;
        if (others.length) {
          const cheapest = Math.min(...others.map((c) => cardValue(ctx.game, c)));
          i = await ctx.option('Volcanic Queen:', ['Tribute 1 other monster', 'Take 1000 damage'], (k) =>
            k === 0 ? (cheapest < 1200 || ctx.lp <= 1000 ? 2 : 0) : ctx.lp > 1000 ? 1 : -1,
          );
        }
        if (i === 0) {
          const sel = await ctx.select(others, 1, 1, 'Tribute 1 other monster.', 'tribute');
          if (sel.length) {
            await tributeCost(ctx, sel);
            return;
          }
        }
        await ctx.damage(ctx.player, 1000);
      },
    },
  ],
});

M('Jinzo - Returner', {
  attribute: 'DARK',
  race: 'Machine',
  level: 3,
  atk: 600,
  def: 1400,
  aiValue: 300,
  text: 'This card can attack directly. When this card is sent to the GY: You can target 1 "Jinzo" in your GY; Special Summon it, but destroy it during your End Phase.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'directAttack' }] },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Special Summon "Jinzo"',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c.name === 'Jinzo' && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.name === 'Jinzo' && ctx.canSummonCard(c)), 1, 1, 'Target 1 "Jinzo" in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t) return;
        const r = await ctx.specialSummon(t, { pos: 'choose' });
        if (!r.length) return;
        const mid = t.moveId;
        const fid = t.faceUpId;
        // 2010 ruling: a "Jinzo" flipped face-down is not destroyed in the End Phase. https://edisonrul.ing/cards/j/jinzo-returner.html
        laterOnMyEnd(ctx, async () => {
          if (t.location === 'mzone' && t.moveId === mid && t.faceUpId === fid && t.faceUp) await ctx.game.destroy([t], 'effect', ctx.player, ctx.self);
        });
      },
    },
  ],
});

M('Jinzo - Lord', {
  attribute: 'DARK',
  race: 'Machine',
  level: 8,
  atk: 2600,
  def: 1600,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1100,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned (from your hand) by sending 1 face-up "Jinzo" you control to the GY. Trap Cards, and their effects on the field, cannot be activated. Negate all Trap effects on the field. Once per turn: You can destroy as many face-up Traps on the field as possible, and if you do, inflict 300 damage to your opponent for each card destroyed.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (send "Jinzo")',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.faceUpMonsters('me', (c) => c.name === 'Jinzo').length > 0,
      perform: async (ctx) => {
        const [j] = await ctx.select(ctx.faceUpMonsters('me', (c) => c.name === 'Jinzo'), 1, 1, 'Send 1 face-up "Jinzo" you control to the GY.', 'cost');
        if (!j) return false;
        await ctx.sendToGrave(j, 'cost');
        return true;
      },
      ai: { score: () => 70 },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'cannotActivateTraps', to: 'players' },
        { q: 'negated', to: 'cards', filter: (_ctx, c: C) => c.isTrap && c.onField && c.faceUp },
      ],
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy face-up Traps: 300 damage each',
      categories: ['destroy', 'damage'],
      canActivate: (ctx) => ctx.spellTraps('both', (c) => c.isTrap && c.faceUp).length > 0,
      resolve: async (ctx) => {
        const r = await ctx.destroy(ctx.spellTraps('both', (c) => c.isTrap && c.faceUp));
        if (r.length) await ctx.damage(ctx.opp, 300 * r.length);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp', (c) => c.isTrap && c.faceUp).length ? 50 : 0) },
    },
  ],
});

/** "During each of your End Phases: Send the top N cards of your Deck to the GY." */
function endPhaseMill(n: number): EffectDef {
  return {
    kind: 'trigger',
    event: 'phaseStart',
    mandatory: true,
    label: `End Phase: send top ${n} to GY`,
    categories: ['mill'],
    eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && faceUpOn(ctx.self),
    resolve: async (ctx) => {
      await ctx.mill(n);
    },
  };
}

M('Gragonith, Lightsworn Dragon', {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 6,
  atk: 2000,
  def: 1600,
  sets: ['lightsworn'],
  aiValue: 300,
  text: 'This card gains 300 ATK and DEF for each "Lightsworn" monster with a different name in your Graveyard. If this card attacks a Defense Position monster, inflict piercing battle damage to your opponent. During each of your End Phases: Send the top 3 cards of your Deck to the Graveyard.',
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', value: (ctx) => 300 * lightswornNamesInGrave(ctx) },
        { q: 'def', value: (ctx) => 300 * lightswornNamesInGrave(ctx) },
        { q: 'piercing' },
      ],
    },
    endPhaseMill(3),
  ],
});

// "Once, while this card is face-up on the field": the engine drops the flag (and the Spell Counters) when it is turned face-down.
faceUpFlag('valkPlaced');
M('Dark Valkyria', {
  attribute: 'DARK',
  race: 'Fairy',
  level: 4,
  atk: 1800,
  def: 1050,
  types: ['gemini'],
  aiValue: 400,
  text: 'This card is treated as a Normal Monster while face-up on the field or in the Graveyard. While this card is a Normal Monster on the field, you can Normal Summon it to have it become an Effect Monster with this effect.\n● Once, while this card is face-up on the field: You can place 1 Spell Counter on it. This card gains 300 ATK for each Spell Counter on it. You can remove 1 Spell Counter from this card, then target 1 monster on the field; destroy that target.',
  effects: [
    geminiSummonEffect(),
    {
      kind: 'ignition',
      label: 'Place 1 Spell Counter',
      categories: ['atkChange'],
      condition: (ctx) => isGeminiActive(ctx) && !ctx.self.flags.valkPlaced,
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self) || ctx.self.flags.valkPlaced) return;
        ctx.self.counters.spell = (ctx.self.counters.spell ?? 0) + 1;
        ctx.self.flags.valkPlaced = true;
        ctx.log(`${ctx.self.name} gets a Spell Counter.`);
      },
      ai: { score: () => 50 },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => (isGeminiActive(ctx) ? 300 * (ctx.self.counters.spell ?? 0) : 0) }] },
    {
      kind: 'ignition',
      label: 'Remove 1 Spell Counter: destroy 1 monster',
      categories: ['destroy'],
      condition: (ctx) => isGeminiActive(ctx) && (ctx.self.counters.spell ?? 0) > 0,
      canActivate: (ctx) => ctx.monsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        ctx.self.counters.spell = Math.max(0, (ctx.self.counters.spell ?? 0) - 1);
        await ctx.selectTargets(ctx.monsters('both'), 1, 1, 'Target 1 monster on the field to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.monsters('opp', (c) => ctx.canTarget(c)).map((c) => cardValue(ctx.game, c)));
          return best >= 1600 ? 55 : 0;
        },
      },
    },
  ],
});

M('Unifrog', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 2,
  atk: 400,
  def: 400,
  sets: ['frog'],
  aiValue: 200,
  text: 'This card can attack your opponent directly. When this card successfully attacks directly, if you control a "Frog" monster other than "Frog the Jam" or "Unifrog", you can destroy 1 Spell or Trap your opponent controls.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'directAttack' }] },
    {
      kind: 'trigger',
      event: 'battleDamage',
      when: true,
      label: 'Destroy 1 Spell/Trap',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp && !!ctx.battle && !ctx.battle.target,
      canActivate: (ctx) =>
        ctx.faceUpMonsters('me', (c) => c !== ctx.self && isFrog(c) && c.name !== 'Frog the Jam' && c.name !== 'Unifrog').length > 0 &&
        ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length > 0,
      // https://edisonrul.ing/cards/u/unifrog.html — it targets 1 Spell / Trap Card your opponent controls.
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('opp'), 1, 1, 'Target 1 Spell/Trap your opponent controls.', 'destroy', { aiScore: (c) => cardValue(ctx.game, c) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
    },
  ],
});

M('Batteryman Charger', {
  attribute: 'LIGHT',
  race: 'Thunder',
  level: 5,
  atk: 1800,
  def: 1200,
  sets: ['batteryman'],
  aiValue: 300,
  text: 'When this card is Normal Summoned, you can Special Summon 1 "Batteryman" monster, except "Batteryman Charger", from your hand or Deck. This card gains 300 ATK and DEF for each Thunder-Type monster you control.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Special Summon a Batteryman',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'deck'], (c) => isBatteryman(c) && c.name !== 'Batteryman Charger' && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['hand', 'deck'], (c) => isBatteryman(c) && c.name !== 'Batteryman Charger' && ctx.canSummonCard(c));
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 "Batteryman" monster from your hand or Deck.', 'specialSummon');
        const fromDeck = c?.location === 'deck';
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', value: (ctx) => 300 * ctx.faceUpMonsters('me', (c) => c.data.race === 'Thunder').length },
        { q: 'def', value: (ctx) => 300 * ctx.faceUpMonsters('me', (c) => c.data.race === 'Thunder').length },
      ],
    },
  ],
});

M('Batteryman Industrial Strength', {
  attribute: 'LIGHT',
  race: 'Thunder',
  level: 8,
  atk: 2600,
  def: 0,
  sets: ['batteryman'],
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 900,
  text: 'This card cannot be Normal Summoned or Set. This card cannot be Special Summoned except by removing from play 2 "Batteryman" monsters from your Graveyard. Once per turn, you can remove from play 1 Thunder-Type monster from your Graveyard to destroy 1 monster and 1 Spell or Trap Card on the field.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (banish 2 Batterymen)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.grave('me', isBatteryman).length >= 2,
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', isBatteryman), 2, 2, 'Banish 2 "Batteryman" monsters from your GY.', 'cost');
        if (sel.length < 2) return false;
        await ctx.banish(sel, 'cost');
        return true;
      },
      ai: { score: () => 72 },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish 1 Thunder: destroy 1 monster and 1 Spell/Trap',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) =>
        ctx.grave('me', (c) => c.isMonster && c.data.race === 'Thunder').length > 0 &&
        ctx.monsters('both', (c) => ctx.canTarget(c)).length > 0 &&
        ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const [b] = await ctx.select(ctx.grave('me', (c) => c.isMonster && c.data.race === 'Thunder'), 1, 1, 'Banish 1 Thunder-Type monster from your GY.', 'cost');
        if (!b) return false;
        await ctx.banish(b, 'cost');
        // "1 monster ... on the field": this card itself can be the monster target (no "other" in the text).
        await ctx.selectTargets(ctx.monsters('both'), 1, 1, 'Target 1 monster on the field.', 'destroy', { aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000) });
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell/Trap on the field.', 'destroy', { aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) =>
          ctx.monsters('opp', (c) => ctx.canTarget(c)).length && ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length ? 62 : 0,
      },
    },
  ],
});

/** Did `c` get flipped face-up since it last arrived on the field (it has just left it)? */
function flippedDuringStint(g: Game, c: C): boolean {
  let passedLeave = false;
  for (let i = g.eventLog.length - 1; i >= 0; i--) {
    const e = g.eventLog[i];
    if (e.card !== c) continue;
    if (!passedLeave) {
      if (e.type === 'leftField' || e.type === 'battleDestroyed' || e.type === 'destroyed') passedLeave = true;
      continue;
    }
    if (e.type === 'flipped') return true;
    if (e.type === 'normalSummoned' || e.type === 'specialSummoned' || e.type === 'monsterSet') return false;
  }
  return false;
}

M('Batteryman Micro-Cell', {
  attribute: 'LIGHT',
  race: 'Thunder',
  level: 1,
  atk: 100,
  def: 100,
  types: ['flip'],
  sets: ['batteryman'],
  aiValue: 400,
  text: 'FLIP: Special Summon 1 Level 4 or lower "Batteryman" monster from your Deck, except "Batteryman Micro-Cell". After this card has been flipped face-up, when it is destroyed by battle and sent to the Graveyard, draw 1 card.',
  effects: [
    flip({
      label: 'FLIP: Special Summon a Batteryman',
      categories: ['specialSummon'],
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => isBatteryman(c) && lvl(c) <= 4 && c.name !== 'Batteryman Micro-Cell' && ctx.canSummonCard(c));
        if (cands.length && ctx.canSpecialSummon()) {
          const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower "Batteryman" monster from your Deck.', 'specialSummon');
          if (c) await ctx.specialSummon(c, { pos: 'choose' });
        }
        ctx.game.shuffleDeck(ctx.player);
      },
    }),
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Draw 1 card',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave' && flippedDuringStint(ctx.game, ctx.self),
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

M('Goblin Recon Squad', {
  attribute: 'WIND',
  race: 'Warrior',
  level: 4,
  atk: 1700,
  def: 0,
  aiValue: 100,
  text: "If this card successfully attacks directly, you can look at 1 random card in your opponent's hand. If it is a Spell Card, send it to the Graveyard. If this card attacks, it is changed to Defense Position at the end of the Battle Phase. This card's battle position cannot be changed until the end of your next turn, except with a card effect.",
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      when: true,
      label: 'Look at 1 random card',
      categories: ['discard'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp && !!ctx.battle && !ctx.battle.target,
      canActivate: (ctx) => ctx.hand('opp').length > 0,
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        const c = hand[ctx.game.rng.int(hand.length)];
        c.revealedUntil = ctx.turn;
        ctx.log(`${ctx.game.players[ctx.player].name} looks at ${c.name}.`);
        if (c.isSpell) await ctx.sendToGrave(c);
      },
    },
    {
      kind: 'trigger',
      event: 'battleEnd',
      mandatory: true,
      label: 'Change to Defense Position',
      categories: ['position'],
      eventFilter: (ctx) => ctx.isMyTurn && faceUpOn(ctx.self) && ctx.self.attacksThisTurn > 0 && ctx.self.pos === 'atk',
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        await ctx.changePos(ctx.self, 'def');
        ctx.self.flags.reconLock = ctx.turn + 2;
      },
    },
    { kind: 'continuous', mods: [{ q: 'cannotChangePos', value: (ctx) => (ctx.self.flags.reconLock ?? -1) >= ctx.turn }] },
  ],
});

interface InvaderRecord {
  inv: number;
  ctrl: PlayerId;
  att: C;
  mid: number;
}
M('Interplanetary Invader "A"', {
  attribute: 'LIGHT',
  race: 'Reptile',
  level: 1,
  atk: 0,
  def: 500,
  aiValue: 300,
  text: 'Gain control of a monster that attacks this face-up Attack Position card, at the end of the Battle Phase.',
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        const a = evc(ev);
        if (a && ev.other === me && faceUpOn(me) && me.pos === 'atk' && !ctx.game.isNegated(me)) {
          const list = (ctx.game.turnData['lodt:invaderPending'] ??= []) as InvaderRecord[];
          list.push({ inv: me.uid, ctrl: me.controller, att: a, mid: a.moveId });
        }
        return false;
      },
    },
    {
      // 2010 ruling: the effect activates at the end of the Damage Step, so it does not activate when the attack is
      // negated or when this card is destroyed before damage calculation; it does activate if this card is destroyed
      // by the battle. https://edisonrul.ing/cards/i/interplanetary-invader-a.html
      kind: 'trigger',
      event: 'damageStepEnd',
      range: ALL_LOCS,
      eventFilter: (ctx, ev) => {
        const pending = (ctx.game.turnData['lodt:invaderPending'] ?? []) as InvaderRecord[];
        const r = pending.find((x) => x.inv === ctx.self.uid && ev.other === ctx.self && x.att === evc(ev));
        if (r) {
          ctx.game.turnData['lodt:invaderPending'] = pending.filter((x) => x !== r);
          ((ctx.game.turnData['lodt:invader'] ??= []) as InvaderRecord[]).push(r);
        }
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'battleEnd',
      range: ALL_LOCS,
      mandatory: true,
      label: 'Gain control of the attacker',
      categories: ['control'],
      eventFilter: (ctx) => ((ctx.game.turnData['lodt:invader'] ?? []) as InvaderRecord[]).some((r) => r.inv === ctx.self.uid),
      resolve: async (ctx) => {
        const g = ctx.game;
        const all = (g.turnData['lodt:invader'] ?? []) as InvaderRecord[];
        const mine = all.filter((r) => r.inv === ctx.self.uid);
        g.turnData['lodt:invader'] = all.filter((r) => r.inv !== ctx.self.uid);
        for (const r of mine) {
          if (r.att.location !== 'mzone' || r.att.moveId !== r.mid || r.att.controller === r.ctrl) continue;
          // No open Monster Card Zone: the monster is destroyed instead (2010 ruling, same page).
          if (g.freeMZones(r.ctrl) <= 0) await g.destroy([r.att], 'effect', r.ctrl, ctx.self);
          else await g.takeControl(r.att, r.ctrl, false);
        }
      },
    },
  ],
});

M('Diskblade Rider', {
  attribute: 'WIND',
  race: 'Fiend',
  level: 4,
  atk: 1700,
  def: 1500,
  aiValue: 200,
  text: 'Once per turn: You can target 1 Normal Trap in your GY; banish that target, and if you do, this card gains 500 ATK until the end of your opponent\'s turn.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish a Normal Trap: +500 ATK',
      categories: ['atkChange', 'banish'],
      canActivate: (ctx) => ctx.grave('me', (c) => c.isTrap && c.data.ttype === 'normal').length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isTrap && c.data.ttype === 'normal'), 1, 1, 'Target 1 Normal Trap in your GY.', 'cost');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t) return;
        await ctx.banish(t);
        if (t.location === 'banished' && monActive(ctx)) ctx.addTempMod(ctx.self, 'atk', 500, 'opponentEnd');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.self.pos !== 'atk') return 0;
          const atk = ctx.atk(ctx.self);
          return ctx.faceUpMonsters('opp', (m) => (m.pos === 'atk' ? ctx.atk(m) : ctx.def(m)) >= atk && (m.pos === 'atk' ? ctx.atk(m) : ctx.def(m)) < atk + 500).length ? 40 : 20;
        },
      },
    },
  ],
});

M('Golden Ladybug', {
  attribute: 'LIGHT',
  race: 'Insect',
  level: 1,
  atk: 0,
  def: 0,
  aiValue: 300,
  text: 'During your Standby Phase: You can reveal this card in your hand, and it will remain revealed until the end of this turn; gain 500 LP.',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['hand'],
      label: 'Reveal: gain 500 LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.location === 'hand',
      condition: (ctx) => ctx.self.location === 'hand',
      resolve: async (ctx) => {
        if (ctx.self.location !== 'hand') return;
        await reveal(ctx, [ctx.self]);
        await ctx.recover(ctx.player, 500);
      },
    },
  ],
});

M('DUCKER Mobile Cannon', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 3,
  atk: 500,
  def: 500,
  types: ['flip'],
  aiValue: 500,
  text: 'FLIP: Target 1 Level 4 monster in your GY; add that target to your hand.',
  effects: [
    flip({
      label: 'FLIP: add a Level 4 monster',
      categories: ['toHand'],
      activate: async (ctx) => {
        const cands = ctx.grave('me', (c) => c.isMonster && lvl(c) === 4 && !c.isExtra);
        if (cands.length) await ctx.selectTargets(cands, 1, 1, 'Target 1 Level 4 monster in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (t) await ctx.toHand(t);
      },
    }),
  ],
});

const LADY_PATCHED = new WeakSet<C>();
function installLady(c: C) {
  if (LADY_PATCHED.has(c)) return;
  LADY_PATCHED.add(c);
  // APPROX: name change through the per-instance data override (abpf.ts patchData).
  patchData(c, (orig, card) => (card.location === 'grave' ? variant(orig, 'name:Skull Servant', { name: 'Skull Servant' }) : undefined));
}
// APPROX: the engine's "unaffected" check only shields from the opponent's Spells/Traps.
const ladyProtects = (ctx: Ctx, c: C) => c.location === 'mzone' && c.faceUp && c.data.race === 'Zombie' && c.name !== LADY && ctx.level(c) <= 3;
M(LADY, {
  attribute: 'DARK',
  race: 'Zombie',
  level: 3,
  atk: 0,
  def: 2200,
  aiValue: 500,
  text: 'Face-up Level 3 or lower Zombie monsters on the field, except "The Lady in Wight", cannot be destroyed by battle, also they are unaffected by Spell/Trap Cards and effects. This card\'s name becomes "Skull Servant" while it is in the GY.',
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'indestructibleBattle', to: 'cards', filter: (ctx, c: C) => ladyProtects(ctx, c) },
        { q: 'unaffectedBySpells', to: 'cards', filter: (ctx, c: C) => ladyProtects(ctx, c) },
        { q: 'unaffectedByTraps', to: 'cards', filter: (ctx, c: C) => ladyProtects(ctx, c) },
      ],
    },
    {
      kind: 'trigger',
      event: ['phaseStart', 'sentToGrave'],
      range: ALL_LOCS,
      eventFilter: (ctx) => {
        installLady(ctx.self);
        return false;
      },
    },
  ],
});

const SIMORGH_PATCHED = new WeakSet<C>();
M(SIMORGH, {
  attribute: 'WIND',
  race: 'Winged Beast',
  level: 8,
  atk: 2900,
  def: 2000,
  aiValue: 400,
  text: 'Both players Tribute Summon WIND monsters with 1 less Tribute than required. If you Tribute Summon this card by Tributing only WIND monsters, return up to 2 cards your opponent controls to their owner\'s hand. This card is treated as a Normal Monster while in your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      mandatory: true,
      label: 'Return up to 2 cards',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => {
        const ts = (ev.tributes ?? []) as C[];
        return ev.card === ctx.self && ts.length > 0 && ts.every((t) => t.data.attribute === 'WIND');
      },
      condition: (ctx) => ctx.field('opp').length > 0,
      resolve: async (ctx) => {
        const sel = await ctx.select(ctx.field('opp'), 0, 2, 'Return up to 2 cards your opponent controls to the hand.', 'bounce');
        if (sel.length) await ctx.toHand(sel);
      },
    },
    {
      // APPROX: "treated as a Normal Monster in your hand" through the per-instance data override.
      kind: 'trigger',
      event: 'phaseStart',
      range: ALL_LOCS,
      eventFilter: (ctx) => {
        const me = ctx.self;
        if (!SIMORGH_PATCHED.has(me)) {
          SIMORGH_PATCHED.add(me);
          patchData(me, (orig, card) => (card.location === 'hand' ? variant(orig, 'normal-in-hand', { mtypes: ['normal'] }) : undefined));
        }
        return false;
      },
    },
  ],
});

/** Cloudians: "If this card is in face-up Defense Position, destroy it." (APPROX: uses the chain). */
function cloudianSelfDestroy(): EffectDef {
  return {
    kind: 'trigger',
    event: ['summoned', 'positionChanged', 'flipped', 'controlChanged'],
    mandatory: true,
    label: 'Destroyed in face-up Defense Position',
    categories: ['destroy'],
    eventFilter: (ctx, ev) => ev.card === ctx.self && faceUpOn(ctx.self) && ctx.self.pos === 'def',
    condition: (ctx) => faceUpOn(ctx.self) && ctx.self.pos === 'def',
    resolve: async (ctx) => {
      if (faceUpOn(ctx.self) && ctx.self.pos === 'def') await ctx.destroy(ctx.self);
    },
  };
}

M('Cloudian - Storm Dragon', {
  attribute: 'WATER',
  race: 'Fairy',
  level: 4,
  atk: 1000,
  def: 0,
  sets: ['cloudian'],
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 300,
  text: 'Cannot be Normal Summoned/Set. Must first be Special Summoned (from your hand) by banishing 1 "Cloudian" monster from your GY. Cannot be destroyed by battle. If this card is in face-up Defense Position, destroy it. Once per turn: You can target 1 face-up monster on the field; place 1 Fog Counter on that target.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (banish a Cloudian)',
      categories: ['specialSummon'],
      procPositions: ['atk'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.grave('me', isCloudian).length > 0,
      perform: async (ctx) => {
        const [c] = await ctx.select(ctx.grave('me', isCloudian), 1, 1, 'Banish 1 "Cloudian" monster from your GY.', 'cost');
        if (!c) return false;
        await ctx.banish(c, 'cost');
        return true;
      },
      ai: { score: () => 50 },
    },
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle' }] },
    cloudianSelfDestroy(),
    {
      kind: 'ignition',
      opt: true,
      label: 'Place 1 Fog Counter',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to place a Fog Counter on.', 'buff', {
          aiScore: (c) => (c.controller === ctx.player && isCloudian(c) ? 100 : 0),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        if (!t) return;
        t.counters.fog = (t.counters.fog ?? 0) + 1;
        ctx.log(`${t.name} gets a Fog Counter.`);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => isCloudian(c)).length ? 15 : 0) },
    },
  ],
});

/** Has player p entered the Battle Phase this turn? */
const battlePhaseThisTurn = (g: Game, p: PlayerId) => turnEvents(g).some((e) => e.type === 'phaseStart' && e.phase === 'battle' && e.player === p);

M('Destiny End Dragoon', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 10,
  atk: 3000,
  def: 3000,
  types: ['fusion'],
  sets: ['hero', 'destiny-hero'],
  aiValue: 1200,
  fusion: {
    materials: [namedCI('Destiny HERO - Plasma'), namedCI('Destiny HERO - Dogma')],
    desc: '"Destiny HERO - Plasma" + "Destiny HERO - Dogma"',
  },
  text: '"Destiny HERO - Plasma" + "Destiny HERO - Dogma"\nA Fusion Summon of this card can only be done with the above Fusion Materials. Once per turn: You can target 1 monster your opponent controls; destroy that target, and if it was face-up, inflict damage to your opponent equal to the ATK it had on the field. You cannot conduct your Battle Phase the turn you activate this effect. Once per turn, during your Standby Phase, if this card is in your GY: You can banish 1 "Destiny HERO" card from your GY; Special Summon this card.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy 1 monster and burn its ATK',
      categories: ['destroy', 'damage'],
      condition: (ctx) => !battlePhaseThisTurn(ctx.game, ctx.player),
      canActivate: (ctx) => ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        ctx.addPlayerMod(ctx.player, 'cannotDeclareAttack');
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'mzone');
        if (!t) return;
        const wasFaceUp = t.faceUp;
        const atk = ctx.atk(t);
        const r = await ctx.destroy(t);
        if (r.length && wasFaceUp) await ctx.damage(ctx.opp, atk);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.monsters('opp', (c) => ctx.canTarget(c)).map((c) => cardValue(ctx.game, c)));
          const atkBest = Math.max(0, ...ctx.monsters('opp', (c) => ctx.canTarget(c) && c.faceUp).map((c) => ctx.atk(c)));
          if (atkBest >= ctx.oppLp) return 90;
          return best >= 2000 ? 55 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      opt: true,
      label: 'Banish a Destiny HERO: Special Summon this card',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.location === 'grave',
      canActivate: (ctx) => ctx.canSummonCard(ctx.self) && ctx.grave('me', (c) => c !== ctx.self && isDHeroCard(c)).length > 0,
      activate: async (ctx) => {
        const [c] = await ctx.select(ctx.grave('me', (x) => x !== ctx.self && isDHeroCard(x)), 1, 1, 'Banish 1 "Destiny HERO" card from your GY.', 'cost');
        if (!c) return false;
        await ctx.banish(c, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.specialSummon(ctx.self, { pos: 'choose' });
      },
    },
  ],
});

M('Ultimate Ancient Gear Golem', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 10,
  atk: 4400,
  def: 3400,
  types: ['fusion'],
  sets: ['ancient-gear'],
  nomi: true,
  aiValue: 1200,
  fusion: { materials: [isAGG, (c) => c.isMonster && isAncientGear(c), (c) => c.isMonster && isAncientGear(c)], desc: '"Ancient Gear Golem" + 2 "Ancient Gear" monsters' },
  text: '"Ancient Gear Golem" + 2 "Ancient Gear" monsters\nMust be Fusion Summoned. If this card attacks a Defense Position monster, inflict piercing battle damage. If this card attacks, your opponent cannot activate Spell/Trap Cards until the end of the Damage Step. If this card is destroyed: You can target 1 "Ancient Gear Golem" in your GY; Special Summon it, ignoring its Summoning conditions.',
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'piercing' },
        { q: 'cannotActivateSpells', to: 'players', filter: (ctx, p: PlayerId) => p === ctx.opp && ctx.battle?.attacker === ctx.self },
        { q: 'cannotActivateTraps', to: 'players', filter: (ctx, p: PlayerId) => p === ctx.opp && ctx.battle?.attacker === ctx.self },
      ],
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: 'Special Summon "Ancient Gear Golem"',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && fromField(ev),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', isAGG).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', isAGG), 1, 1, 'Target 1 "Ancient Gear Golem" in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (t) await ctx.specialSummon(t, { pos: 'choose', ignoreConditions: true });
      },
    },
  ],
});

M(FREED, {
  attribute: 'DARK',
  race: 'Warrior',
  level: 5,
  atk: 2300,
  def: 1700,
  aiValue: 700,
  text: 'Cannot be Special Summoned. Negate any Spell effects that target a face-up DARK monster(s) you control, and if you do, destroy that Spell Card. During your Draw Phase, instead of conducting your normal draw: You can add 1 Level 4 DARK monster from your Deck to your hand. This card must be face-up on the field to activate and to resolve this effect.',
  // APPROX: the Draw Phase search replaces the draw without starting a chain (see ensureLodtPatches).
  effects: [
    {
      kind: 'trigger',
      event: 'chainActivated',
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        const g = ctx.game;
        const link = ev.data?.link as ChainLink | undefined;
        const hits = (l: ChainLink) => l.ctx.targets.some((t) => faceUpOn(t) && t.controller === me.controller && t.data.attribute === 'DARK');
        if (!link || !link.card.isSpell || !monActive(ctx) || !hits(link)) return false;
        const moveId = me.moveId;
        negateLinkOnResolve(g, link, me, () => me.moveId === moveId && faceUpOn(me) && !g.isNegated(me) && hits(link));
        return false;
      },
    },
  ],
});

M('Magical Exemplar', {
  attribute: 'EARTH',
  race: 'Spellcaster',
  level: 4,
  atk: 1700,
  def: 1400,
  aiValue: 600,
  text: 'Each time a Spell Card is activated, place 2 Spell Counters on this card when that Spell resolves. Once per turn: You can remove any number of Spell Counters from this card; Special Summon 1 Spellcaster monster from your hand or GY whose Level is equal to the number of Spell Counters you removed.',
  effects: [
    {
      kind: 'trigger',
      event: 'chainActivated',
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        const g = ctx.game;
        const l = ev.data?.link as ChainLink | undefined;
        if (!l || !l.isCardActivation || !l.card.isSpell || !monActive(ctx)) return false;
        const mid = me.moveId;
        const orig = l.effect;
        l.effect = {
          ...orig,
          resolve: async (c) => {
            if (orig.resolve) await orig.resolve(c);
            if (faceUpOn(me) && me.moveId === mid && !g.isNegated(me)) {
              me.counters.spell = (me.counters.spell ?? 0) + 2;
              g.log(`${me.name} gets 2 Spell Counters (${me.counters.spell}).`, 'action', me.controller);
            }
          },
        };
        return false;
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Remove Spell Counters: Special Summon a Spellcaster',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && exemplarCands(ctx, ctx.self.counters.spell ?? 0).length > 0,
      activate: async (ctx) => {
        const cands = exemplarCands(ctx, ctx.self.counters.spell ?? 0);
        const [c] = await ctx.select(cands, 1, 1, 'Choose the Spellcaster to Special Summon (remove Spell Counters equal to its Level).', 'specialSummon');
        if (!c) return false;
        ctx.data.n = lvl(c);
        ctx.self.counters.spell = (ctx.self.counters.spell ?? 0) - lvl(c);
        ctx.log(`${ctx.self.name}: ${lvl(c)} Spell Counter(s) removed.`);
      },
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['hand', 'grave'], (c) => c.isMonster && c.data.race === 'Spellcaster' && lvl(c) === ctx.data.n && ctx.canSummonCard(c));
        const [c] = await ctx.select(cands, 1, 1, `Special Summon 1 Level ${ctx.data.n} Spellcaster monster from your hand or GY.`, 'specialSummon');
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
      ai: { score: (ctx) => (Math.max(0, ...exemplarCands(ctx, ctx.self.counters.spell ?? 0).map((c) => c.data.atk ?? 0)) >= 1500 ? 60 : 0) },
    },
  ],
});
function exemplarCands(ctx: Ctx, counters: number) {
  return ctx.cards('me', ['hand', 'grave'], (c) => c.isMonster && c.data.race === 'Spellcaster' && lvl(c) >= 1 && lvl(c) <= counters && !c.isExtra && ctx.canSummonCard(c));
}

M('Maniacal Servant', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 3,
  atk: 600,
  def: 1000,
  aiValue: 100,
  text: "Once per turn during your opponent's Standby Phase, you can remove from play any number of DARK monsters from your Graveyard. This monster gains 500 DEF for each monster you removed, until the End Phase.",
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      opt: true,
      label: 'Banish DARK monsters: +500 DEF each',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && !ctx.isMyTurn && faceUpOn(ctx.self),
      canActivate: (ctx) => ctx.grave('me', (c) => c.isMonster && c.data.attribute === 'DARK').length > 0,
      activate: async (ctx) => {
        const darks = ctx.grave('me', (c) => c.isMonster && c.data.attribute === 'DARK');
        let sel: C[];
        if (isAi(ctx.game, ctx.player)) {
          const need = Math.max(1, Math.ceil((maniacalThreat(ctx) - ctx.def(ctx.self) + 1) / 500));
          sel = await ctx.select(darks, Math.min(need, darks.length), Math.min(need, darks.length), 'Banish DARK monsters from your GY.', 'cost');
        } else sel = await ctx.select(darks, 1, darks.length, 'Banish any number of DARK monsters from your GY.', 'cost');
        if (!sel.length) return false;
        ctx.data.n = sel.length;
        await ctx.banish(sel, 'cost');
      },
      resolve: async (ctx) => {
        if (monActive(ctx)) ctx.addTempMod(ctx.self, 'def', 500 * (ctx.data.n ?? 0), 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.self.pos !== 'def') return 0;
          const threat = maniacalThreat(ctx);
          if (threat < ctx.def(ctx.self)) return 0;
          const need = Math.ceil((threat - ctx.def(ctx.self) + 1) / 500);
          return need <= ctx.grave('me', (c) => c.isMonster && c.data.attribute === 'DARK').length && need <= 3 ? 1 : 0;
        },
      },
    },
  ],
});
const maniacalThreat = (ctx: Ctx) => Math.max(0, ...ctx.faceUpMonsters('opp', (m) => m.pos === 'atk').map((m) => ctx.atk(m)));

M(MUSASABI, {
  attribute: 'EARTH',
  race: 'Beast',
  level: 2,
  atk: 800,
  def: 100,
  aiValue: 200,
  text: 'When this card is destroyed by battle and sent to the Graveyard, inflict 500 damage to your opponent. You can also Special Summon up to 2 "Nimble Musasabi" from your Deck to your opponent\'s side of the field in face-up Attack Position. This card cannot be Tributed for a Tribute Summon.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: '500 damage',
      categories: ['damage', 'specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500);
        const cands = ctx.deck('me', (c) => c.name === MUSASABI);
        const room = ctx.freeMZones('opp');
        if (!cands.length || room <= 0 || ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return;
        if (!(await ctx.confirm('Special Summon "Nimble Musasabi" from your Deck to your opponent\'s field?', true))) return;
        const sel = await ctx.select(cands, 1, Math.min(2, room), 'Special Summon up to 2 "Nimble Musasabi" to your opponent\'s field.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel, { pos: 'atk', controller: ctx.opp });
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

M('Flame Spirit Ignis', {
  attribute: 'FIRE',
  race: 'Pyro',
  level: 4,
  atk: 1500,
  def: 1200,
  aiValue: 100,
  text: 'You can Tribute 1 face-up FIRE monster to inflict 100 damage to your opponent for each FIRE monsters in your Graveyard.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute a FIRE monster: 100 damage per FIRE in GY',
      categories: ['damage'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => c.data.attribute === 'FIRE' && tributable(ctx, c)).length > 0,
      activate: async (ctx) => {
        const [t] = await ctx.select(ctx.faceUpMonsters('me', (c) => c.data.attribute === 'FIRE' && tributable(ctx, c)), 1, 1, 'Tribute 1 face-up FIRE monster.', 'tribute');
        if (!t) return false;
        await tributeCost(ctx, [t]);
      },
      resolve: async (ctx) => {
        const n = ctx.grave('me', (c) => c.isMonster && c.data.attribute === 'FIRE').length;
        if (n) await ctx.damage(ctx.opp, 100 * n);
      },
      ai: {
        score: (ctx) => {
          const n = ctx.grave('me', (c) => c.isMonster && c.data.attribute === 'FIRE').length + 1;
          return 100 * n >= ctx.oppLp ? 90 : 0;
        },
      },
    },
  ],
});

M(DINOBEAST, {
  attribute: 'EARTH',
  race: 'Dinosaur',
  level: 8,
  atk: 2700,
  def: 1400,
  aiValue: 300,
  text: 'You can Tribute Summon this card in face-up Attack Position by Tributing 1 Dinosaur monster. When a Dinosaur monster(s) is Special Summoned from your GY while this monster is on the field (except during the Damage Step): You can draw 1 card.',
  effects: [
    {
      kind: 'continuous',
      range: ['hand'],
      altTribute: (ctx, summoned, t) => summoned === ctx.self && !ctx.self.flags.lodtSetting && t.data.race === 'Dinosaur',
    },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      when: true,
      label: 'Draw 1 card',
      categories: ['draw'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return monActive(ctx) && !!c && c.data.race === 'Dinosaur' && ev.from === 'grave' && c.owner === ctx.player && !ctx.battle?.inDamageStep;
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

/** Tualatin bookkeeping: the monsters the non-turn player controlled at the start of the Battle Phase, and those destroyed by battle since. */
function tualRecord(g: Game, ev: GameEvent) {
  if (ev.type === 'phaseStart' && ev.phase === 'battle' && !g.turnData['lodt:tualStart']) {
    const p = g.opp(g.turnPlayer);
    g.turnData['lodt:tualStart'] = { p, uids: g.monsters(p).map((c) => c.uid) };
    g.turnData['lodt:tualDead'] = new Set<number>();
  }
  if (ev.type === 'battleDestroyed' && g.turnData['lodt:tualDead']) {
    const c = evc(ev);
    if (c) (g.turnData['lodt:tualDead'] as Set<number>).add(c.uid);
  }
}
function tualatinReady(g: Game, p: PlayerId, just?: C) {
  const start = g.turnData['lodt:tualStart'] as { p: PlayerId; uids: number[] } | undefined;
  const dead = g.turnData['lodt:tualDead'] as Set<number> | undefined;
  if (!start || !dead || start.p !== p || start.uids.length < 2 || g.phase !== 'battle' || g.turnPlayer === p) return false;
  if (just && !start.uids.includes(just.uid)) return false;
  return start.uids.every((u) => dead.has(u) && g.card(u)?.location === 'grave');
}
M(TUALATIN, {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 8,
  atk: 2800,
  def: 2500,
  aiValue: 600,
  text: 'If it is your opponent\'s Battle Phase, a monster you controlled at the start of this Battle Phase was just destroyed, and all monsters you controlled at the start of this Battle Phase (min. 2) have now been destroyed by battle and sent to the GY: You can Special Summon this card from your hand. If Summoned this way: Choose an Attribute, and if you do, destroy all face-up monsters with that Attribute. Your opponent cannot Normal or Special Summon monsters with that Attribute.',
  effects: [
    {
      kind: 'trigger',
      event: ['phaseStart', 'battleDestroyed'],
      range: ALL_LOCS,
      eventFilter: (ctx, ev) => {
        tualRecord(ctx.game, ev);
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['hand'],
      label: 'Special Summon Tualatin',
      categories: ['specialSummon', 'destroyMulti'],
      eventFilter: (ctx, ev) => {
        tualRecord(ctx.game, ev);
        return ctx.self.location === 'hand' && tualatinReady(ctx.game, ctx.player, evc(ev));
      },
      condition: (ctx) => ctx.canSummonSelf(),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'hand') return;
        const r = await ctx.specialSummon(ctx.self, { pos: 'choose' });
        if (!r.length) return;
        const g = ctx.game;
        const score = (a: Attribute) =>
          ctx.faceUpMonsters('opp', (c) => c.data.attribute === a).reduce((s, c) => s + cardValue(g, c), 0) -
          ctx.faceUpMonsters('me', (c) => c.data.attribute === a).reduce((s, c) => s + cardValue(g, c), 0) +
          (ctx.deck('opp').length ? 0 : 0);
        const i = await ctx.option('Tualatin: choose an Attribute.', ATTRS, (k) => score(ATTRS[k]));
        const a = ATTRS[i];
        if (faceUpOn(ctx.self)) ctx.self.flags.tualAttr = a;
        ctx.log(`Tualatin declares ${a}.`);
        const victims = ctx.faceUpMonsters('both', (c) => c.data.attribute === a);
        if (victims.length) await ctx.destroy(victims);
      },
    },
  ],
});

M('Divine Knight Ishzark', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 6,
  atk: 2300,
  def: 1800,
  aiValue: 300,
  text: 'After damage calculation, when this card destroys a monster by battle: Banish that monster.',
  // APPROX: applied as the monster is destroyed (it is banished instead of going to the GY) via the replaceDestroy hook.
  effects: [
    {
      kind: 'continuous',
      replaceDestroy: async (ctx, cards, reason) => {
        const b = ctx.battle;
        const me = ctx.self;
        if (reason !== 'battle' || !b || (b.attacker !== me && b.target !== me) || b.calc?.losers.includes(me)) return [];
        const foe = b.attacker === me ? b.target : b.attacker;
        if (foe && cards.includes(foe) && !foe.isToken) {
          foe.banishOnLeave = true;
          ctx.log(`${me.name} banishes ${foe.name}.`);
        }
        return [];
      },
    },
  ],
});

M(ANGEL_O7, {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 7,
  atk: 2500,
  def: 1500,
  aiValue: 800,
  text: 'If this card is Tribute Summoned, it gains this effect:\n● Neither player can activate monster effects.',
  effects: [
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && faceUpOn(ctx.self)) {
          ctx.self.flags.o7 = true;
          ctx.log(`${ctx.self.name}: neither player can activate monster effects.`);
        }
        return false;
      },
    },
  ],
});

M('Helios Trice Megistus', {
  attribute: 'LIGHT',
  race: 'Pyro',
  level: 8,
  atk: 0,
  def: 0,
  aiValue: 800,
  text: 'You can Special Summon this card (from your hand) by Tributing 1 "Helios Duo Megistus". This card\'s ATK/DEF become the number of banished monsters x 300. After this card attacks, if your opponent controls a monster, this card can make a second attack in a row. During the End Phase, if this card is in the GY because it was destroyed by battle and sent there this turn: You can Special Summon this card, and it gains 500 ATK/DEF.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (Tribute "Helios Duo Megistus")',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.monsters('me', (c) => c.name === 'Helios Duo Megistus' && tributable(ctx, c)).length > 0,
      perform: async (ctx) => {
        const [t] = await ctx.select(ctx.monsters('me', (c) => c.name === 'Helios Duo Megistus' && tributable(ctx, c)), 1, 1, 'Tribute 1 "Helios Duo Megistus".', 'tribute');
        if (!t) return false;
        await tributeCost(ctx, [t]);
        return true;
      },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', value: (ctx) => 300 * banishedMonsters(ctx.game) },
        { q: 'def', value: (ctx) => 300 * banishedMonsters(ctx.game) },
        // APPROX: "a second attack in a row" = 1 extra attack while the opponent controls a monster.
        { q: 'extraAttacks', value: (ctx) => (ctx.monsters('opp').length > 0 ? 1 : 0) },
      ],
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      opt: true,
      label: 'Special Summon this card (+500 ATK/DEF)',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.location === 'grave' && destroyedByBattleThisTurn(ctx.game, ctx.self),
      canActivate: (ctx) => ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave') return;
        const r = await ctx.specialSummon(ctx.self, { pos: 'choose' });
        if (r.length) {
          ctx.addTempMod(ctx.self, 'atk', 500, 'field');
          ctx.addTempMod(ctx.self, 'def', 500, 'field');
        }
      },
    },
  ],
});
QUESTION_ATK.add('Helios Trice Megistus');
const banishedMonsters = (g: Game) => [...g.players[0].banished, ...g.players[1].banished].filter((c) => c.isMonster).length;
/** `c` is in the GY because it was destroyed by battle and sent there this turn. */
function destroyedByBattleThisTurn(g: Game, c: C) {
  const evs = turnEvents(g);
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e.card !== c || e.type === 'leftField' || e.type === 'destroyed') continue;
    if (e.type === 'battleDestroyed') return e.to === 'grave';
    if (e.type === 'sentToGrave') continue;
    return false;
  }
  return false;
}

M('Maximum Six', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 6,
  atk: 1900,
  def: 1600,
  aiValue: 200,
  text: 'When this card is Tribute Summoned: Roll a six-sided die, and this card gains ATK equal to the result x 200.',
  effects: [
    (() => {
      const ef: EffectDef = {
        kind: 'trigger',
        event: 'tributeSummoned',
        mandatory: true,
        label: 'Roll a die: +200 ATK per pip',
        categories: ['atkChange'],
        eventFilter: (ctx, ev) => ev.card === ctx.self,
        resolve: async (ctx) => {
          const r = await rollDie(ctx);
          if (monActive(ctx)) ctx.addTempMod(ctx.self, 'atk', 200 * r, 'field');
        },
      };
      DICE_EFFECTS.add(ef);
      return ef;
    })(),
  ],
});

M(FOG_KING, {
  attribute: 'WATER',
  race: 'Spellcaster',
  level: 7,
  atk: 0,
  def: 0,
  aiValue: 400,
  text: 'You can Tribute 1 monster, or no monsters, to Normal Summon (but not Set) this card. The ATK of this card becomes the combined original ATK of the Tributed monsters. Neither player can Tribute cards.',
  effects: [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) =>
            ((ctx.self.flags.tributedMonsters ?? []) as { uid: number }[]).reduce((s, t) => s + (ctx.game.card(t.uid)?.data.atk ?? 0), 0),
        },
        { q: 'cannotBeTributed', to: 'cards', filter: (_ctx, c: C) => c.location === 'mzone' },
      ],
    },
  ],
});

M('Fossil Dyna Pachycephalo', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 4,
  atk: 1200,
  def: 1300,
  aiValue: 600,
  text: 'If this card is flipped face-up: Destroy all Special Summoned monsters on the field. Neither player can Special Summon monsters.',
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      label: 'Destroy all Special Summoned monsters',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'mzone',
      resolve: async (ctx) => {
        const v = ctx.monsters('both', (c) => isSpecialSummoned(c));
        if (v.length) await ctx.destroy(v);
      },
    },
    { kind: 'continuous', mods: [{ q: 'cannotSpecialSummon', to: 'players' }] },
  ],
});

// ============================================================ SPELLS

/** Per-instance temporary name change (Hero Mask): `name` until the end of `turn`. */
const TEMP_NAME = new WeakMap<C, { name: string; turn: number; moveId: number }>();
const TEMP_NAME_PATCHED = new WeakSet<C>();
function setTempName(g: Game, c: C, name: string) {
  TEMP_NAME.set(c, { name, turn: g.turn, moveId: c.moveId });
  if (TEMP_NAME_PATCHED.has(c)) return;
  TEMP_NAME_PATCHED.add(c);
  // APPROX: name change through the per-instance data override (abpf.ts patchData).
  patchData(c, (orig, card) => {
    const s = TEMP_NAME.get(card);
    return s && s.turn === g.turn && s.moveId === card.moveId && card.location === 'mzone' ? variant(orig, `name:${s.name}`, { name: s.name }) : undefined;
  });
}

S('Hero Mask', 'normal', {
  text: 'Target 1 face-up monster you control; send 1 "Elemental HERO" monster from your Deck to the Graveyard, and if you do, that target\'s name becomes the sent monster\'s name, until the End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['mill'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0 && ctx.deck('me', isEHero).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Target 1 face-up monster you control.', 'buff');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        const [h] = await ctx.select(ctx.deck('me', isEHero), 1, 1, 'Send 1 "Elemental HERO" monster from your Deck to the GY.', 'toGrave');
        if (!h) return;
        await ctx.sendToGrave(h);
        ctx.game.shuffleDeck(ctx.player);
        if (t && h.location === 'grave' && faceUpOn(t)) {
          setTempName(ctx.game, t, h.name);
          ctx.log(`${t.data.name} is treated as "${h.name}" until the End Phase.`);
        }
      },
      ai: { score: () => 0 },
    },
  ],
});

S('Space Gift', 'normal', {
  text: 'Draw 1 card for each different "Neo-Spacian" name on the monsters you control.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => {
        const n = new Set(ctx.faceUpMonsters('me', isNeoSpacian).map((c) => c.name)).size;
        return n > 0 && ctx.deck().length >= n;
      },
      resolve: async (ctx) => {
        const n = new Set(ctx.faceUpMonsters('me', isNeoSpacian).map((c) => c.name)).size;
        if (n) await ctx.draw(n);
      },
      ai: { score: () => 60 },
    },
  ],
});

/** Activate a Field Spell from the Deck (Demise of the Land). APPROX: the Field Spell's activation resolves at once (no new Chain Link). */
async function activateFieldFromDeck(ctx: Ctx, card: C) {
  const g = ctx.game;
  await (g as any).replaceFieldSpell(ctx.player);
  g.rawMove(card, 'fzone', { controller: ctx.player, faceUp: true });
  g.shuffleDeck(ctx.player);
  ctx.log(`${g.players[ctx.player].name} activates ${card.name} from the Deck.`);
  await g.anim({ type: 'activate', card: card.uid, player: ctx.player });
  const ef = card.data.effects?.find((e) => e.kind === 'activate');
  if (ef?.resolve) {
    const c2 = new Ctx(g, card, ef, ctx.player);
    await ef.resolve(c2);
  }
  if (card.location === 'fzone') card.activeOnField = true;
  g.update();
}

S('Demise of the Land', 'quickplay', {
  text: 'When your opponent Special Summons a monster(s): Activate 1 Field Spell Card directly from your Deck.',
  effects: [
    {
      kind: 'activate',
      event: 'specialSummoned',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.player === ctx.opp,
      canActivate: (ctx) => ctx.deck('me', (c) => c.isSpell && c.data.stype === 'field').length > 0,
      resolve: async (ctx) => {
        const [f] = await ctx.select(ctx.deck('me', (c) => c.isSpell && c.data.stype === 'field'), 1, 1, 'Activate 1 Field Spell from your Deck.', 'toHand');
        if (f) await activateFieldFromDeck(ctx, f);
      },
      ai: { score: (ctx) => (!ctx.game.players[ctx.player].fzone ? 40 : 0) },
    },
  ],
});

S('D - Formation', 'continuous', {
  text: 'Each time a face-up "Destiny HERO" monster(s) you control is destroyed, place 1 D Counter on this card for each of those monsters. When you Normal or Special Summon a monster during your Main Phase: You can send this card with 2 or more D Counters to the Graveyard; add up to 2 cards from your Deck and/or Graveyard to your hand, with the same name as that monster.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['deck', 'hand'], isDHero).length >= 3 ? 18 : 0) } },
    {
      kind: 'trigger',
      event: 'destroyed',
      range: ['szone'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (stActive(ctx) && c && ev.from === 'mzone' && ev.fromFaceUp && ev.fromController === ctx.player && isDHero(c)) {
          ctx.self.counters.d = (ctx.self.counters.d ?? 0) + 1;
          ctx.log(`${ctx.self.name} gets a D Counter (${ctx.self.counters.d}).`);
        }
        return false;
      },
    },
    {
      kind: 'trigger',
      event: ['normalSummoned', 'specialSummoned'],
      range: ['szone'],
      when: true,
      label: 'Send this card: add 2 copies',
      categories: ['search', 'toHand'],
      eventFilter: (ctx, ev) => stActive(ctx) && (ctx.self.counters.d ?? 0) >= 2 && ev.player === ctx.player && ctx.isMyTurn && isMain(ctx),
      canActivate: (ctx) => {
        const name = evc(ctx.event!)?.name;
        return !!name && ctx.cards('me', ['deck', 'grave'], (c) => c.name === name).length > 0;
      },
      activate: async (ctx) => {
        ctx.data.name = evc(ctx.event!)?.name;
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['deck', 'grave'], (c) => c.name === ctx.data.name);
        const sel = await ctx.select(cands, 1, 2, `Add up to 2 "${ctx.data.name}" from your Deck and/or GY to your hand.`, 'toHand');
        const fromDeck = sel.some((c) => c.location === 'deck');
        if (sel.length) await ctx.toHand(sel);
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

S('Spell Gear', 'normal', {
  text: 'Send 3 "Ancient Gear" cards you control to the Graveyard. You can Special Summon up to 1 "Ancient Gear Golem" from your hand and 1 from your Deck, ignoring the Summoning conditions. Then, destroy all monsters you control except "Ancient Gear Golems". You cannot Normal Summon or Set until the end of your next turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.field('me', (c) => c.faceUp && isAncientGear(c)).length >= 3,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.field('me', (c) => c.faceUp && isAncientGear(c)), 3, 3, 'Send 3 "Ancient Gear" cards you control to the GY.', 'cost');
        if (sel.length < 3) return false;
        await ctx.sendToGrave(sel, 'cost');
      },
      resolve: async (ctx) => {
        const picks: C[] = [];
        const fromHand = ctx.hand('me', isAGG);
        const fromDeck = ctx.deck('me', isAGG);
        if (fromHand.length) picks.push(...(await ctx.select(fromHand, 0, 1, 'Special Summon up to 1 "Ancient Gear Golem" from your hand.', 'specialSummon')));
        if (fromDeck.length) picks.push(...(await ctx.select(fromDeck, 0, 1, 'Special Summon up to 1 "Ancient Gear Golem" from your Deck.', 'specialSummon')));
        if (picks.length) await ctx.specialSummon(picks, { pos: 'choose', ignoreConditions: true });
        ctx.game.shuffleDeck(ctx.player);
        const others = ctx.monsters('me', (c) => !isAGG(c));
        if (others.length) await ctx.destroy(others);
        addModUntilMyNextTurnEnd(ctx, 'cannotNormalSummon');
        addModUntilMyNextTurnEnd(ctx, 'cannotSet');
      },
      ai: { score: (ctx) => (ctx.cards('me', ['hand', 'deck'], isAGG).length ? 50 : 0) },
    },
  ],
});

S('Cup of Ace', 'normal', {
  text: 'Toss a coin and apply this effect.\n● Heads: Draw 2 cards.\n● Tails: Your opponent draws 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => ctx.deck('me').length >= 2,
      resolve: async (ctx) => {
        const r = tossCoin(ctx.game, ctx.player, ctx.self);
        await ctx.draw(2, r === 'H' ? ctx.player : ctx.opp);
      },
      ai: { score: (ctx) => (ctx.hand('me', (c) => c !== ctx.self).length === 0 ? 30 : 0) },
    },
  ],
});

S(LIGHT_BARRIER, 'field', {
  text: 'Once per turn, during your Standby Phase: Toss a coin. If the result is Tails, the following effects are negated until your next Standby Phase.\n● When you Summon an "Arcana Force" monster, choose which effect to apply without tossing a coin.\n● If your "Arcana Force" monster destroys an opponent\'s monster by battle: You gain LP equal to the destroyed monster\'s original ATK.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone'], isArcana).length ? 30 : 0) } },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['fzone'],
      mandatory: true,
      opt: true,
      label: 'Toss a coin',
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && stActive(ctx),
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const r = tossCoin(ctx.game, ctx.player, ctx.self);
        ctx.self.flags.lbOff = r === 'T';
        if (r === 'T') ctx.log(`${ctx.self.name}'s effects are negated until the next Standby Phase.`);
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['fzone'],
      mandatory: true,
      label: 'Gain LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => {
        const by = evo(ev);
        const v = evc(ev);
        return stActive(ctx) && !ctx.self.flags.lbOff && !!by && !!v && by.controller === ctx.player && isArcana(by) && ev.fromController !== ctx.player;
      },
      resolve: async (ctx) => {
        const v = evc(ctx.event!);
        if (v && (v.data.atk ?? 0) > 0) await ctx.recover(ctx.player, v.data.atk ?? 0);
      },
    },
  ],
});

S('Wetlands', 'field', {
  text: 'All Aqua-Type/WATER/Level 2 or lower monsters gain 1200 ATK.',
  effects: [
    { kind: 'activate', categories: ['atkChange'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => wetlandsHits(ctx, c)).length ? 35 : 0) } },
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => wetlandsHits(ctx, c), value: 1200 }] },
  ],
});
function wetlandsHits(ctx: Ctx, c: C) {
  return c.faceUpMonster && c.data.race === 'Aqua' && c.data.attribute === 'WATER' && ctx.level(c) <= 2;
}

S('Quick Charger', 'quickplay', {
  text: 'Add 2 Level 4 or lower "Batteryman" monsters from your Graveyard to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.grave('me', (c) => isBatteryman(c) && lvl(c) <= 4).length >= 2,
      resolve: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', (c) => isBatteryman(c) && lvl(c) <= 4), 2, 2, 'Add 2 Level 4 or lower "Batteryman" monsters to your hand.', 'toHand');
        if (sel.length) await ctx.toHand(sel);
      },
      ai: { score: (ctx) => (ctx.isMyTurn ? 45 : 0) },
    },
  ],
});

S('Short Circuit', 'normal', {
  text: 'Activate only if you control 3 or more "Batteryman" monsters. Destroy all cards your opponent controls.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) => ctx.faceUpMonsters('me', isBatteryman).length >= 3,
      canActivate: (ctx) => ctx.field('opp').length > 0,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.field('opp'));
      },
      ai: { score: (ctx) => (ctx.field('opp').length >= 2 ? 80 : 40) },
    },
  ],
});

S('Light of Redemption', 'normal', {
  text: 'Pay 800 Life Points, then target 1 of your banished LIGHT monsters; add that target to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.lp > 800 && ctx.banished('me', (c) => c.isMonster && c.faceUp && c.data.attribute === 'LIGHT').length > 0,
      activate: async (ctx) => {
        await ctx.payLp(800);
        await ctx.selectTargets(ctx.banished('me', (c) => c.isMonster && c.faceUp && c.data.attribute === 'LIGHT'), 1, 1, 'Target 1 of your banished LIGHT monsters.', 'toHand');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'banished');
        if (t) await ctx.toHand(t);
      },
      ai: {
        score: (ctx) => (ctx.lp > 3000 && Math.max(0, ...ctx.banished('me', (c) => c.isMonster && c.data.attribute === 'LIGHT').map((c) => cardValue(ctx.game, c))) >= 1800 ? 45 : 0),
      },
    },
  ],
});

S(MCOL, 'continuous', {
  text: 'You cannot use 1 of your Spell & Trap Card Zones. During your Draw Phase, if you control another "Mystical Cards of Light", you can draw 2 cards instead of 1 for your normal draw.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      // 2010 ruling: cannot be activated without a Spell & Trap Card Zone to make unusable.
      // https://edisonrul.ing/cards/m/mystical-cards-of-light.html
      canActivate: (ctx) => ctx.freeSZones() >= (ctx.self.location === 'szone' ? 1 : 2),
      ai: { score: (ctx) => (ctx.spellTraps('me', (c) => c.name === MCOL && c !== ctx.self && c.faceUp).length ? 45 : ctx.hand('me', (c) => c.name === MCOL && c !== ctx.self).length ? 15 : 0) },
    },
  ],
});

S('Level Tuning', 'normal', {
  text: 'Reduce the Level of all face-up monsters you control by 1, until the End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('me').length > 0,
      resolve: async (ctx) => {
        for (const c of ctx.faceUpMonsters('me')) ctx.addTempMod(c, 'level', -1, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (!isMain(ctx)) return 0;
          const mons = ctx.faceUpMonsters('me');
          if (synchroOptions(ctx).length) return 0;
          const lowered = synchroOptions(ctx, mons.map((c) => ({ card: c, level: Math.max(1, ctx.level(c) - 1) })), mons);
          return lowered.length ? 50 : 0;
        },
      },
    },
  ],
});

S(DECK_LOCKDOWN, 'continuous', {
  text: 'Neither player can add cards from the Deck to their hand except by drawing them. Monsters cannot be Special Summoned from the Main Deck. Destroy this card during your 2nd Standby Phase after activation.',
  effects: [
    { kind: 'activate', categories: ['lockdown'], ai: { score: (ctx) => (ctx.isMyTurn && ctx.deck('opp').length > 10 ? 18 : 0) } },
    { kind: 'continuous', mods: [{ q: 'cannotAddFromDeck', to: 'players' }] },
    secondStandbyDestroy(),
  ],
});
/** "Destroy this card during your 2nd Standby Phase after activation." */
function secondStandbyDestroy(): EffectDef {
  return {
    kind: 'trigger',
    event: 'phaseStart',
    range: ['szone'],
    mandatory: true,
    label: 'Standby Phase count',
    categories: ['destroy'],
    eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.faceUp && ctx.self.activeOnField,
    resolve: async (ctx) => {
      if (!ctx.self.onField) return;
      ctx.self.flags.standbys = (ctx.self.flags.standbys ?? 0) + 1;
      if (ctx.self.flags.standbys >= 2) await ctx.destroy(ctx.self);
    },
  };
}

S('Ribbon of Rebirth', 'equip', {
  text: 'During the End Phase, if the equipped monster was destroyed by battle and sent to the Graveyard this turn: Special Summon it from the Graveyard to your side of the field.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to equip this card to.', 'equip', {
          aiScore: (c) => (c.controller === ctx.player ? cardValue(ctx.game, c) : -10000),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        if (t && ctx.self.onField) ctx.equip(t);
      },
      ai: { score: (ctx) => (isMain(ctx) && ctx.faceUpMonsters('me', (c) => c.pos === 'atk' && cardValue(ctx.game, c) >= 1800).length ? 22 : 0) },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['szone'],
      eventFilter: (ctx, ev) => {
        const s = ctx.self;
        const c = evc(ev);
        if (!c || !stActive(ctx) || s.equippedTo !== c.uid || c.location !== 'grave') return false;
        const g = ctx.game;
        const p = s.controller;
        const mid = c.moveId;
        g.addDelayed('end', async () => {
          if (c.location === 'grave' && c.moveId === mid && g.freeMZones(p) > 0) {
            g.log(`Ribbon of Rebirth returns ${c.name}.`, 'action', p);
            await g.specialSummon([c], p, { pos: 'choose', reasonCard: s });
          }
        });
        return false;
      },
    },
  ],
});

S('Golden Bamboo Sword', 'normal', {
  text: 'If you control a "Bamboo Sword" Equip Spell: Draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      condition: (ctx) => ctx.spellTraps('me', (c) => c.faceUp && c.isSpell && c.data.stype === 'equip' && c.name.includes('Bamboo Sword')).length > 0,
      canActivate: (ctx) => ctx.deck().length >= 2,
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: { score: () => 70 },
    },
  ],
});

S('Union Attack', 'normal', {
  text: 'Target 1 face-up monster you control; add up the total ATK of all other face-up Attack Position monsters you currently control, then during the Battle Phase of this turn only, the monster gains that much ATK, but cannot inflict battle damage to your opponent, also other face-up Attack Position monsters cannot attack.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Target 1 face-up monster you control.', 'buff', {
          aiScore: (c) => (c.pos === 'atk' ? ctx.atk(c) : -1000),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        if (!t) return;
        const others = ctx.faceUpMonsters('me', (c) => c !== t && c.pos === 'atk');
        const sum = others.reduce((s, c) => s + ctx.atk(c), 0);
        t.flags.lodtUnion = { turn: ctx.turn, sum, src: ctx.self.uid };
        for (const o of others) o.flags.cannotAttackTurn = ctx.turn;
        ctx.log(`${t.name} gains ${sum} ATK during this Battle Phase.`);
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.turn <= 1) return 0;
          const mons = ctx.faceUpMonsters('me', (c) => c.pos === 'atk' && ctx.game.canAttack(c));
          if (mons.length < 2) return 0;
          const total = mons.reduce((s, c) => s + ctx.atk(c), 0);
          const best = Math.max(...mons.map((c) => ctx.atk(c)));
          const wall = ctx.faceUpMonsters('opp').filter((m) => (m.pos === 'atk' ? ctx.atk(m) : ctx.def(m)) >= best && (m.pos === 'atk' ? ctx.atk(m) : ctx.def(m)) < total);
          return wall.length ? 35 : 0;
        },
      },
    },
    {
      // The boost itself (only for the monster this copy of Union Attack chose).
      kind: 'continuous',
      range: ALL_LOCS,
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (ctx, c: C) => c.flags.lodtUnion?.src === ctx.self.uid && c.flags.lodtUnion?.turn === ctx.turn && ctx.phase === 'battle',
          value: (_ctx, c: C) => c.flags.lodtUnion?.sum ?? 0,
        },
      ],
    },
  ],
});

S("Owner's Seal", 'normal', {
  text: 'Return control of all monsters on the field to their owners.',
  effects: [
    {
      kind: 'activate',
      categories: ['control'],
      canActivate: (ctx) => ctx.monsters('both', (c) => c.controller !== c.owner).length > 0,
      resolve: async (ctx) => {
        for (const c of ctx.monsters('both', (x) => x.controller !== x.owner)) await ctx.game.returnControl(c);
      },
      ai: { score: (ctx) => (ctx.monsters('opp', (c) => c.owner === ctx.player).length ? 55 : 0) },
    },
  ],
});

S('Dangerous Machine Type-6', 'continuous', {
  text: 'During each of your Standby Phases: Roll a six-sided die and apply the result.\n● 1: Discard 1 card.\n● 2: Your opponent discards 1 card.\n● 3: Draw 1 card.\n● 4: Your opponent draws 1 card.\n● 5: Destroy 1 monster your opponent controls.\n● 6: Destroy this card.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (isMain(ctx) ? 20 : 0) } },
    (() => {
      const ef: EffectDef = {
        kind: 'trigger',
        event: 'phaseStart',
        range: ['szone'],
        mandatory: true,
        label: 'Roll a die',
        categories: ['draw', 'discard', 'destroy'],
        eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && stActive(ctx),
        resolve: async (ctx) => {
          if (!ctx.self.onField) return;
          const r = await rollDie(ctx);
          switch (r) {
            case 1:
              if (ctx.hand().length) await ctx.discardFromHand(1);
              break;
            case 2:
              if (ctx.hand('opp').length) await ctx.discardFromHand(1, undefined, 'effect', ctx.opp);
              break;
            case 3:
              await ctx.draw(1);
              break;
            case 4:
              await ctx.draw(1, ctx.opp);
              break;
            case 5: {
              const [v] = await ctx.select(ctx.monsters('opp'), 1, 1, 'Destroy 1 monster your opponent controls.', 'destroy');
              if (v) await ctx.destroy(v);
              break;
            }
            default:
              await ctx.destroy(ctx.self);
          }
        },
      };
      DICE_EFFECTS.add(ef);
      return ef;
    })(),
  ],
});

// ============================================================ TRAPS

/** "Activate this card by targeting 1 monster in your GY; Special Summon it in Attack Position" + link (Call of the Haunted style). */
function linkedRevive(filter: (ctx: Ctx, c: C) => boolean, prompt: string, score: (ctx: Ctx) => number): EffectDef {
  const cands = (ctx: Ctx) => ctx.grave('me', (c) => c.isMonster && filter(ctx, c) && ctx.canSummonCard(c));
  return {
    kind: 'activate',
    categories: ['specialSummon'],
    canActivate: (ctx) => ctx.canSpecialSummon() && cands(ctx).length > 0,
    activate: async (ctx) => {
      await ctx.selectTargets(cands(ctx), 1, 1, prompt, 'specialSummon', { aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) });
    },
    resolve: async (ctx) => {
      const [t] = ctx.validTargets((c) => c.location === 'grave');
      if (!t || !ctx.self.onField) return;
      const r = await ctx.specialSummon(t, { pos: 'atk' });
      if (r.length && ctx.self.onField) ctx.game.link(ctx.self, r[0]);
    },
    ai: { score },
  };
}
const reviveScore = (ctx: Ctx, best: number) => {
  if (best < 1000) return 0;
  if (!ctx.isMyTurn && ctx.phase === 'end') return 55;
  if (ctx.isMyTurn && ctx.phase === 'main1') return 45;
  return 0;
};

T('Limit Reverse', 'continuous', {
  text: 'Target 1 monster with 1000 or less ATK in your GY; Special Summon it in Attack Position. If the target is changed to Defense Position, destroy it and this card. When this card leaves the field, destroy the target. When the target is destroyed, destroy this card.',
  effects: [
    linkedRevive(
      (_ctx, c) => (c.data.atk ?? 0) <= 1000,
      'Target 1 monster with 1000 or less ATK in your GY.',
      (ctx) => reviveScore(ctx, 1000 + Math.max(0, ...ctx.grave('me', (c) => c.isMonster && (c.data.atk ?? 0) <= 1000 && ctx.canSummonCard(c)).map((c) => (c.data.aiValue ?? 0) + (c.isTuner ? 400 : 0)))),
    ),
    {
      kind: 'trigger',
      event: 'positionChanged',
      range: ['szone'],
      mandatory: true,
      label: 'Destroy the monster and this card',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return ctx.self.faceUp && !!c && ctx.self.linkedTo === c.uid && c.location === 'mzone' && c.pos === 'def';
      },
      resolve: async (ctx) => {
        const m = ctx.game.card(ctx.self.linkedTo);
        await ctx.destroy([...(m && m.location === 'mzone' ? [m] : []), ...(ctx.self.onField ? [ctx.self] : [])]);
      },
    },
  ],
});

T('Hero Blast', 'normal', {
  text: 'Target 1 "Elemental HERO" Normal Monster in your GY; add that target to your hand, then if your opponent controls any monsters with ATK less than or equal to that target\'s ATK, destroy 1 of them.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand', 'destroy'],
      canActivate: (ctx) => ctx.grave('me', (c) => isEHero(c) && c.hasType('normal')).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isEHero(c) && c.hasType('normal')), 1, 1, 'Target 1 "Elemental HERO" Normal Monster in your GY.', 'toHand', {
          aiScore: (c) => c.data.atk ?? 0,
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t) return;
        await ctx.toHand(t);
        if (t.location !== 'hand') return;
        const victims = ctx.faceUpMonsters('opp', (c) => ctx.atk(c) <= (t.data.atk ?? 0));
        if (!victims.length) return;
        const [v] = await ctx.select(victims, 1, 1, 'Destroy 1 monster your opponent controls.', 'destroy');
        if (v) await ctx.destroy(v);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('me', (c) => isEHero(c) && c.hasType('normal')).map((c) => c.data.atk ?? 0));
          return ctx.faceUpMonsters('opp', (c) => ctx.atk(c) <= best).length ? 50 : !ctx.isMyTurn && ctx.phase === 'end' ? 30 : 0;
        },
      },
    },
  ],
});

T('Rainbow Gravity', 'normal', {
  text: 'If you have 7 "Crystal Beast" cards with different names on your field and/or in your GY: Special Summon 1 "Ultimate Crystal" monster from your Deck or GY, ignoring its Summoning conditions.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      condition: (ctx) => new Set(ctx.cards('me', ['mzone', 'szone', 'grave'], (c) => isCrystalBeast(c) && (c.faceUp || c.location === 'grave')).map((c) => c.name)).size >= 7,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['deck', 'grave'], isUltimateCrystal).length > 0,
      resolve: async (ctx) => {
        const [c] = await ctx.select(ctx.cards('me', ['deck', 'grave'], isUltimateCrystal), 1, 1, 'Special Summon 1 "Ultimate Crystal" monster.', 'specialSummon');
        const fromDeck = c?.location === 'deck';
        if (c) await ctx.specialSummon(c, { pos: 'choose', ignoreConditions: true });
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 60 },
    },
  ],
});

T('D - Fortune', 'normal', {
  text: 'When your opponent declares a direct attack: Banish 1 "Destiny HERO" monster from your Graveyard; end the Battle Phase.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack'],
      eventFilter: (ctx, ev) => !ev.other && evc(ev)?.controller === ctx.opp,
      canActivate: (ctx) => ctx.grave('me', isDHero).length > 0,
      activate: async (ctx) => {
        const [c] = await ctx.select(ctx.grave('me', isDHero), 1, 1, 'Banish 1 "Destiny HERO" monster from your GY.', 'cost');
        if (!c) return false;
        await ctx.banish(c, 'cost');
      },
      resolve: async (ctx) => {
        endBattlePhase(ctx); // APPROX: the attack is negated and no further attacks can be declared this turn
      },
      ai: { score: (ctx) => (ctx.battle && ctx.atk(ctx.battle.attacker) >= 1000 ? 60 : 0) },
    },
  ],
});

T('Reversal of Fate', 'normal', {
  text: 'Target 1 "Arcana Force" monster you control; that monster\'s effect is now treated as the opposite coin toss result.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isArcana(c) && !!arcState(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => isArcana(c) && !!arcState(c)), 1, 1, 'Target 1 "Arcana Force" monster you control.', 'buff', {
          aiScore: (c) => (arcWantsFix(ctx.game, c) ? 100 : arcIs(ctx.game, c, AF0, 'H') ? -100 : 0),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        const s = t && arcState(t);
        if (!t || !s) return;
        s.coin = s.coin === 'H' ? 'T' : 'H';
        ctx.log(`${t.name}'s effect is now treated as ${coinName(s.coin)}.`);
        await arcanaOnGain(ctx.game, t);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => arcWantsFix(ctx.game, c)).length ? 50 : 0) },
    },
  ],
});

T('Tour of Doom', 'continuous', {
  text: "During your opponent's Standby Phase, toss a coin: ● Heads: Your opponent cannot Normal or Flip Summon until the End Phase. ● Tails: You cannot Normal or Flip Summon during your next turn.",
  effects: [
    { kind: 'activate', categories: ['lockdown'], ai: { score: (ctx) => (ctx.isMyTurn && isMain(ctx) ? 20 : 0) } },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Toss a coin',
      eventFilter: (ctx, ev) => ev.phase === 'standby' && !ctx.isMyTurn && stActive(ctx),
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const r = tossCoin(ctx.game, ctx.player, ctx.self);
        const s = gs(ctx.game);
        if (r === 'H') {
          s.tour.push({ p: ctx.opp, turn: ctx.turn });
          ctx.log(`${ctx.game.players[ctx.opp].name} cannot Normal or Flip Summon this turn.`);
        } else {
          s.tour.push({ p: ctx.player, turn: ctx.turn + 1 });
          ctx.log(`${ctx.game.players[ctx.player].name} cannot Normal or Flip Summon during their next turn.`);
        }
      },
    },
  ],
});

T('Arcana Call', 'normal', {
  text: 'Target 1 "Arcana Force" monster you control and 1 "Arcana Force" monster in either GY; banish the second target from the GY, and if you do, until the End Phase, the first target\'s effect gained as a result of a coin toss becomes the banished monster\'s effect for the same coin toss result.',
  effects: [
    {
      kind: 'activate',
      categories: ['banish'],
      canActivate: (ctx) =>
        ctx.faceUpMonsters('me', (c) => isArcana(c) && !!arcState(c) && ctx.canTarget(c)).length > 0 && ctx.grave('both', (c) => isArcana(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const [a] = await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => isArcana(c) && !!arcState(c)), 1, 1, 'Target 1 "Arcana Force" monster you control.', 'buff', {
          aiScore: (c) => (arcWantsFix(ctx.game, c) ? 100 : arcIs(ctx.game, c, AF0, 'H') ? -100 : 0),
        });
        const [b] = await ctx.selectTargets(ctx.grave('both', isArcana), 1, 1, 'Target 1 "Arcana Force" monster in either GY.', 'banish', {
          aiScore: (c) => (a && arcState(a) && arcState(a)!.coin === arcPref(c.name) ? 100 : 0),
        });
        ctx.data.first = a;
        ctx.data.second = b;
      },
      resolve: async (ctx) => {
        const valid = ctx.validTargets();
        const a = ctx.data.first as C | undefined;
        const b = ctx.data.second as C | undefined;
        if (!b || !valid.includes(b) || b.location !== 'grave') return;
        await ctx.banish(b);
        if ((b.location as Location) !== 'banished' || !a || !valid.includes(a)) return;
        const s = arcState(a);
        if (!s) return;
        s.callName = b.name;
        s.callTurn = ctx.turn;
        ctx.log(`${a.name} applies the ${coinName(s.coin)} effect of ${b.name} until the End Phase.`);
        await arcanaOnGain(ctx.game, a);
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.faceUpMonsters('me', (c) => arcWantsFix(ctx.game, c));
          return mine.length && ctx.grave('both', (c) => isArcana(c) && arcPref(c.name) === arcState(mine[0])!.coin).length ? 35 : 0;
        },
      },
    },
  ],
});

T('Light Spiral', 'continuous', {
  text: 'Each time a card(s) is sent from your Deck to the Graveyard by the effect of a "Lightsworn" monster, remove from play the top card of your opponent\'s Deck.',
  effects: [
    { kind: 'activate', categories: ['banish'], ai: { score: (ctx) => (ctx.cards('me', ['mzone', 'hand', 'deck'], isLS).length >= 4 ? 22 : 0) } },
    {
      kind: 'trigger',
      event: 'milled',
      range: ['szone'],
      mandatory: true,
      label: "Banish the top card of the opponent's Deck",
      categories: ['banish'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        const rc = ev.reasonCard as C | undefined;
        return stActive(ctx) && !!c && c.owner === ctx.player && !!rc && isLS(rc);
      },
      resolve: async (ctx) => {
        const deck = ctx.deck('opp');
        const top = deck[deck.length - 1];
        if (top) await ctx.banish(top);
      },
    },
  ],
});

T('Glorious Illusion', 'continuous', {
  text: 'Activate this card by targeting 1 "Lightsworn" monster in your Graveyard; Special Summon that target in face-up Attack Position. During each of your End Phases: Send the top 2 cards of your Deck to the Graveyard. When this card leaves the field, destroy that monster. When that monster leaves the field, destroy this card.',
  effects: [
    linkedRevive(
      (_ctx, c) => isLS(c),
      'Target 1 "Lightsworn" monster in your GY.',
      (ctx) => reviveScore(ctx, Math.max(0, ...ctx.grave('me', (c) => isLS(c) && ctx.canSummonCard(c)).map((c) => c.data.atk ?? 0))),
    ),
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'End Phase: send top 2 to GY',
      categories: ['mill'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && stActive(ctx),
      resolve: async (ctx) => {
        await ctx.mill(2);
      },
    },
  ],
});

/** Does this chain link destroy a monster on the field (Destruction Jammer)? APPROX: read from the effect's categories and targets. */
function destroysMonster(l: ChainLink) {
  const cats = l.effect.categories ?? [];
  if (!cats.includes('destroy') && !cats.includes('destroyMulti')) return false;
  const ts = l.ctx.targets;
  return !ts.length || ts.some((t) => t.isMonster && t.location === 'mzone');
}
T('Destruction Jammer', 'counter', {
  text: "Discard 1 card. Negate the activation of a Spell Card, Trap Card, or Effect Monster's effect that destroys a monster(s) on the field, and destroy that card.",
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && destroysMonster(l);
      },
      canActivate: (ctx) => ctx.hand('me', (c) => c !== ctx.self).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me', (c) => c !== ctx.self), 1, 1, 'Discard 1 card.', 'discard');
        if (!sel.length) return false;
        await ctx.discard(sel, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp) return 0;
          const cats = l.effect.categories ?? [];
          if (l.ctx.targets.some((t) => t.controller === ctx.player && t.isMonster && cardValue(ctx.game, t) >= 1500)) return 70;
          if (cats.includes('destroyMulti') && ctx.monsters('me').length) return 70;
          return 0;
        },
      },
    },
  ],
});

T('Froggy Forcefield', 'normal', {
  text: 'Activate only when a face-up "Frog" monster you control, except "Frog the Jam", is selected as an attack target. Destroy all Attack Position monsters your opponent controls.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && faceUpOn(t) && t.controller === ctx.player && isFrog(t) && t.name !== 'Frog the Jam';
      },
      canActivate: (ctx) => ctx.monsters('opp', (c) => c.isAttack).length > 0,
      resolve: async (ctx) => {
        const v = ctx.monsters('opp', (c) => c.isAttack);
        if (v.length) await ctx.destroy(v);
      },
      ai: { score: () => 70 },
    },
  ],
});

T('Portable Battery Pack', 'continuous', {
  text: 'Select 2 "Batteryman" monsters from your Graveyard and Special Summon them in Attack Position. When this card is removed from the field, destroy those monsters. When both of those monsters have been removed from the field, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.freeMZones() >= 2 && ctx.grave('me', (c) => isBatteryman(c) && ctx.canSummonCard(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isBatteryman(c) && ctx.canSummonCard(c)), 2, 2, 'Target 2 "Batteryman" monsters in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (!t.length || !ctx.self.onField) return;
        const r = await ctx.specialSummon(t, { pos: 'atk' });
        if (!r.length || !ctx.self.onField) return;
        ctx.self.flags.pbp = r.map((c) => ({ uid: c.uid, mid: c.moveId }));
        for (const c of r) ctx.game.link(c, ctx.self, false);
      },
      ai: { score: (ctx) => reviveScore(ctx, 1500) },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      range: ['szone'],
      mandatory: true,
      label: 'Destroy this card',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const list = ctx.self.flags.pbp as { uid: number; mid: number }[] | undefined;
        const c = evc(ev);
        if (!ctx.self.faceUp || !list || !c || !list.some((r) => r.uid === c.uid)) return false;
        return list.every((r) => {
          const m = ctx.game.card(r.uid);
          return !m || m.location !== 'mzone' || m.moveId !== r.mid;
        });
      },
      resolve: async (ctx) => {
        if (ctx.self.onField) await ctx.destroy(ctx.self);
      },
    },
  ],
});

T('Gladiator Lash', 'normal', {
  text: 'Activate only when you Special Summon a "Gladiator Beast" monster. Your opponent discards 1 card of their choice.',
  effects: [
    {
      kind: 'activate',
      event: 'specialSummoned',
      categories: ['discard'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.controller === ctx.player && ev.player === ctx.player && isGB(c);
      },
      canActivate: (ctx) => ctx.hand('opp').length > 0,
      resolve: async (ctx) => {
        if (ctx.hand('opp').length) await ctx.discardFromHand(1, undefined, 'effect', ctx.opp, 'Discard 1 card (Gladiator Lash).');
      },
      ai: { score: () => 45 },
    },
  ],
});

T('Raging Cloudian', 'normal', {
  text: 'When a "Cloudian" monster(s) you control is destroyed by its own effect and sent to your GY: Target 1 of those monsters; Special Summon it in Attack Position, and if you do, place 1 Fog Counter on it, also it cannot be changed to Defense Position by card effects.',
  // APPROX: "cannot be changed to Defense Position by card effects" is not enforced (no engine hook).
  effects: [
    {
      kind: 'activate',
      event: 'destroyed',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && isCloudian(c) && ev.fromController === ctx.player && ev.reasonCard === c && c.location === 'grave' && c.owner === ctx.player;
      },
      canActivate: (ctx) => ctx.canSpecialSummon() && ragingCands(ctx).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ragingCands(ctx), 1, 1, 'Target 1 of those "Cloudian" monsters.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t) return;
        const r = await ctx.specialSummon(t, { pos: 'atk' });
        if (r.length) t.counters.fog = (t.counters.fog ?? 0) + 1;
      },
      ai: { score: () => 50 },
    },
  ],
});
function ragingCands(ctx: Ctx): C[] {
  const g = ctx.game;
  const out = new Set<C>();
  for (const ev of g.recentEvents) {
    const c = evc(ev);
    if (ev.type === 'destroyed' && c && isCloudian(c) && ev.reasonCard === c && ev.fromController === ctx.player && c.location === 'grave' && ctx.canSummonCard(c)) out.add(c);
  }
  return [...out];
}

T(SANGUINE_SWAMP, 'continuous', {
  text: 'If you control any other Spell or Trap Cards, destroy this card. Face-down Spell and Trap Cards cannot be activated. Destroy this card during your 2nd Standby Phase after activation.',
  // APPROX: when another Spell/Trap is activated from the hand, this card is destroyed after that Chain (not at once).
  effects: [
    { kind: 'activate', categories: ['lockdown'], ai: { score: (ctx) => (ctx.spellTraps('me', (c) => c !== ctx.self).length === 0 && ctx.spellTraps('opp', (c) => !c.faceUp).length >= 2 ? 40 : 0) } },
    secondStandbyDestroy(),
    {
      kind: 'trigger',
      event: 'cardActivated',
      range: ['szone'],
      mandatory: true,
      label: 'Destroy this card',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return stActive(ctx) && !!c && c !== ctx.self && (c.isSpell || c.isTrap) && c.onField && c.controller === ctx.player;
      },
      resolve: async (ctx) => {
        if (ctx.self.onField) await ctx.destroy(ctx.self);
      },
    },
  ],
});

T(LUCKY_CHANCE, 'continuous', {
  text: 'Once per Chain, if a monster effect is activated that tosses a coin once: Call heads or tails. If your call matches the coin toss for that monster effect, draw 1 card immediately after that effect resolves.',
  effects: [{ kind: 'activate', categories: ['draw'], ai: { score: (ctx) => (ctx.cards('both', ['mzone', 'hand'], isArcana).length ? 22 : 0) } }],
});

T(SUMMON_LIMIT, 'continuous', {
  text: 'Neither player can Summon more than two times per turn.',
  effects: [{ kind: 'activate', categories: ['lockdown'], ai: { score: (ctx) => (!ctx.isMyTurn && summonsThisTurn(ctx.game, ctx.opp) >= 2 ? 45 : 0) } }],
});

T('Dice Try!', 'counter', {
  text: 'When your opponent activates a Spell/Trap Card, or monster effect, that requires a dice roll: Negate the activation, and if you do, destroy it.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.player === ctx.opp && rollsDice(l);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: { score: () => 60 },
    },
  ],
});

T('Vanquishing Light', 'counter', {
  text: 'When a monster(s) would be Summoned: Tribute 1 "Lightsworn" monster; negate the Summon, and if you do, destroy that monster(s).',
  effects: [
    {
      kind: 'activate',
      negateSummon: true,
      categories: ['negateSummon'],
      condition: (ctx) => !!ctx.game.pendingSummon && !ctx.game.pendingSummon.negated,
      canActivate: (ctx) => ctx.monsters('me', (c) => c.faceUp && isLS(c) && tributable(ctx, c)).length > 0,
      activate: async (ctx) => {
        const [t] = await ctx.select(ctx.monsters('me', (c) => c.faceUp && isLS(c) && tributable(ctx, c)), 1, 1, 'Tribute 1 "Lightsworn" monster.', 'tribute');
        if (!t) return false;
        await tributeCost(ctx, [t]);
      },
      resolve: async (ctx) => {
        ctx.game.negatePendingSummon();
      },
      ai: {
        score: (ctx) => {
          const ps = ctx.game.pendingSummon;
          if (!ps || ps.player !== ctx.opp) return 0;
          const v = Math.max(0, ...ps.cards.map((c) => cardValue(ctx.game, c)));
          const fodder = Math.min(...ctx.monsters('me', (c) => c.faceUp && isLS(c)).map((c) => cardValue(ctx.game, c)));
          return v >= 2200 && v > fodder ? 60 : 0;
        },
      },
    },
  ],
});

export const LODT_LOADED = true;
