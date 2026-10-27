// The Duelist Genesis (TDGS, TCG September 2008): every card of the set that no other set file defines.
// Card type, Attribute, Level, ATK/DEF: YGOJSON v1 aggregate (github.com/iconmaster5326/YGOJSON). Card text uses the
// 2008–2010 TCG wording where it differs from later errata (e.g. Quillbolt Hedgehog, Destructotron, Kinka-byo).
// Effects follow the 2010 TCG rulings as far as the engine allows. Approximations are marked "APPROX:".
//
// Already scripted elsewhere (the pool resolves them by name): Avenging Knight Parshath, Dark Resonator, Krebons,
// Psychic Commander, Gladiator Beast Equeste, Nitro Warrior, Stardust Dragon, Red Dragon Archfiend, Goyo Guardian,
// Magical Android, Thought Ruler Archfiend, Emergency Teleport, Lightsworn Sabre, Gladiator Beast War Chariot,
// Charge of the Light Brigade.
//
// No engine change. Hooks reused: EffectDef.replaceDestroy (ANPR), EffectDef.replaceDestroyOne (ABPF), the per-instance
// data override `patchData` (abpf.ts), synchro/fusion `flags.materials`. Game rules the engine has no hook for are
// installed per game by `ensureTdgsPatches` (the technique of lodt.ts):
//  * Tributes: Big Piece Golem / Cyber Shark (Normal Summon without Tributing), Geartown (1 less for "Ancient Gear");
//  * Special Summons: Power Filter (monsters with 1000 or less ATK cannot be Special Summoned);
//  * battle damage: Defense Draw; LP costs: Telekinetic Charging Cell;
//  * negation: Splendid Venus (your Spell/Trap activations and effects cannot be negated);
//  * Spirit returns: Izanagi / Mirror of Yata (the return to the hand is optional);
//  * lingering links checked after every rule cleanup: Dharc the Dark Charmer (control while face-up), Kinka-byo
//    (banish the revived monster when it leaves the field);
//  * main actions: Toy Magician can be Set in the Spell & Trap Zone.
import { monster, spell, token, trap } from '../define';
import { bestTarget, cardValue, flip } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import { Ctx } from '../../engine/ctx';
import type { Action } from '../../engine/controller';
import type { ChainLink, Game } from '../../engine/game';
import type { Attribute, BattlePos, GameEvent, Location, PlayerId, Race, Reason } from '../../engine/types';
import { patchData, variant } from './abpf';
import { tributable, tributeCost } from './plants';
import { QUESTION_ATK } from './sovr';

type C = CardInstance;

// ============================================================ names

const BIG_PIECE = 'Big Piece Golem';
const MEDIUM_PIECE = 'Medium Piece Golem';
const SMALL_PIECE = 'Small Piece Golem';
const CYBER_SHARK = 'Cyber Shark';
const GEARTOWN = 'Geartown';
const POWER_FILTER = 'Power Filter';
const CHARGING_CELL = 'Telekinetic Charging Cell';
const VENUS = 'Splendid Venus';
const IZANAGI = 'Izanagi';
const MIRROR_YATA = 'Mirror of Yata';
const TOY_MAGICIAN = 'Toy Magician';
const THE_TRICKY = 'The Tricky';
const TRAP_OF_DARKNESS = 'Trap of Darkness';
const MECHA_BUNNY = 'Mecha Bunny';
const MIND_MASTER = 'Mind Master';

// ============================================================ shared helpers

const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const evc = (ev: GameEvent) => ev.card as C | undefined;
const evo = (ev: GameEvent) => ev.other as C | undefined;
const reasonsOf = (ev: GameEvent): Reason[] => ev.reasons ?? (ev.reason ? [ev.reason] : []);
const raceIs = (c: C, ...r: Race[]) => c.isMonster && r.includes(c.data.race as Race);
const attrIs = (c: C, ...a: Attribute[]) => c.isMonster && a.includes(c.data.attribute as Attribute);
const lvl = (c: C) => c.data.level ?? 0;
const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
/** This monster is face-up on the field and not negated. */
const monActive = (ctx: Ctx) => faceUpOn(ctx.self) && !ctx.game.isNegated(ctx.self);
/** This Spell/Trap is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
const isMain = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';
const noChain = (ctx: Ctx) => ctx.game.chain.length === 0;
const myOpenMain = (ctx: Ctx) => ctx.isMyTurn && noChain(ctx) && !ctx.battle && isMain(ctx);
const isPsychic = (c: C) => raceIs(c, 'Psychic');
const isSpirit = (c: C) => c.isMonster && c.hasType('spirit');
const isAncientGear = (c: C) => c.isMonster && c.name.includes('Ancient Gear');
const isLightswornCard = (c: C) => c.inSet('lightsworn') || c.name.includes('Lightsworn');
const isSixSamurai = (c: C) => c.isMonster && (c.inSet('six-samurai') || c.name.includes('Six Samurai'));
/** For a synchro/fusion material trigger: the monster being summoned. */
const summonedFor = (ev: GameEvent) => ev.reasonCard as C | undefined;
const synchroMaterialEv = (ctx: Ctx, ev: GameEvent) => ev.card === ctx.self && ev.to === 'grave' && reasonsOf(ev).includes('synchro');

/** Events since the start of the current turn's Draw Phase. */
function turnEvents(g: Game): GameEvent[] {
  const log = g.eventLog;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'phaseStart' && e.phase === 'draw') return log.slice(i);
  }
  return log;
}

/** Face-up, applying (resolved, not negated) cards with this name on the field. */
function liveCards(g: Game, name: string, p?: PlayerId): C[] {
  return g
    .allFieldCards()
    .filter((c) => c.name === name && c.faceUp && (c.isMonster ? c.location === 'mzone' : c.activeOnField) && (p === undefined || c.controller === p) && !g.isNegated(c));
}

/** Monster battling `self` in the current battle. */
function battleOpponent(ctx: Ctx, self: C = ctx.self): C | null {
  const b = ctx.battle;
  if (!b) return null;
  if (b.attacker === self) return b.target;
  if (b.target === self) return b.attacker;
  return null;
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

/** Special Summon 1 card from the Deck (non-targeting), shuffling afterwards. */
async function summonFromDeck(ctx: Ctx, filter: (c: C) => boolean, prompt: string, pos: BattlePos | 'choose' = 'choose') {
  const cands = ctx.deck('me', (c) => filter(c) && ctx.canSummonCard(c));
  if (!cands.length || !ctx.canSpecialSummon()) {
    ctx.game.shuffleDeck(ctx.player);
    return [] as C[];
  }
  const sel = await ctx.select(cands, 1, 1, prompt, 'specialSummon', { aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) });
  const r = sel.length ? await ctx.specialSummon(sel[0], { pos }) : [];
  ctx.game.shuffleDeck(ctx.player);
  return r;
}

/** AI: is my monster in the current battle about to lose (or take damage)? */
function myBattleMonsterLoses(ctx: Ctx): C | null {
  const b = ctx.battle;
  if (!b || !b.target) return null;
  const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
  const theirs = mine === b.attacker ? b.target : b.attacker;
  if (mine.controller !== ctx.player || !faceUpOn(theirs)) return null;
  const mAtk = ctx.atk(mine);
  if (mine === b.attacker) {
    const s = theirs.pos === 'atk' ? ctx.atk(theirs) : ctx.def(theirs);
    return theirs.pos === 'atk' && s >= mAtk ? mine : null;
  }
  if (mine.pos === 'atk') return ctx.atk(theirs) >= mAtk ? mine : null;
  return ctx.atk(theirs) > ctx.def(mine) ? mine : null;
}

// ============================================================ Ice Counters (Cold Enchanter, Ice Master)

const iceCount = (c: C) => c.counters.ice ?? 0;
const iceOnField = (g: Game) => [...g.monsters(0), ...g.monsters(1)].reduce((a, c) => a + iceCount(c), 0);
function addIce(ctx: Ctx, c: C) {
  c.counters.ice = iceCount(c) + 1;
  ctx.log(`${c.name} gets an Ice Counter (${c.counters.ice}).`);
  ctx.game.update();
}

// ============================================================ per-game rule patches

interface TdgsGameState {
  /** > 0 while a monster is being Set (Normal Summons without Tributing do not apply to Sets). */
  setting: number;
  boundBusy: boolean;
}
const GSTATE = new WeakMap<Game, TdgsGameState>();
function gs(g: Game): TdgsGameState {
  let s = GSTATE.get(g);
  if (!s) GSTATE.set(g, (s = { setting: 0, boundBusy: false }));
  return s;
}

/** Big Piece Golem / Cyber Shark: can be Normal Summoned without Tributing right now. */
function noTributeOk(g: Game, card: C) {
  if (card.location !== 'hand') return false;
  const p = card.owner;
  if (card.name === BIG_PIECE) return g.monsters(g.opp(p)).length > 0 && g.monsters(p).length === 0;
  if (card.name === CYBER_SHARK) return g.faceUpMonsters(p).some((c) => attrIs(c, 'WATER'));
  return false;
}
const geartownOn = (g: Game) => liveCards(g, GEARTOWN).length > 0;
const powerFilterOn = (g: Game) => liveCards(g, POWER_FILTER).length > 0;
/** Power Filter: original ATK of 1000 or less (a "?" ATK counts as 0). */
// https://edisonrul.ing/cards/p/power-filter.html — monsters with "?" ATK can be Special Summoned.
const lowAtk = (c: C) => c.isMonster && (c.data.atk ?? 0) <= 1000 && !QUESTION_ATK.has(c.data.name);

/** Telekinetic Charging Cell equipped to this (Psychic) monster. */
function chargingCellOn(g: Game, m: C) {
  return g.equipsOf(m).some((e) => e.name === CHARGING_CELL && e.faceUp && e.activeOnField && !g.isNegated(e));
}

/** Spirit monsters whose return to the hand is optional (Izanagi, Mirror of Yata). */
function spiritExempt(g: Game, c: C) {
  if (liveCards(g, IZANAGI, c.controller).length) return true;
  return g.equipsOf(c).some((e) => e.name === MIRROR_YATA && e.faceUp && e.activeOnField && !g.isNegated(e));
}

/** Splendid Venus: the activation / effect of this link cannot be negated. */
function venusProtects(g: Game, link: ChainLink) {
  const c = link.card;
  if (!(c.isSpell || c.isTrap) || !c.onField || c.controller !== link.player) return false;
  return liveCards(g, VENUS, link.player).length > 0;
}
const venusShield = new WeakMap<C, { moveId: number; by: ChainLink | null }>();

/**
 * Lingering links (`flags.tdgsBound` on the affected monster): when the source is no longer face-up on the field,
 * Dharc the Dark Charmer's control ends / Kinka-byo's monster is banished.
 */
interface Bound {
  uid: number;
  mid: number;
  kind: 'control' | 'banish';
  player: PlayerId;
}
async function boundCheck(g: Game) {
  const s = gs(g);
  if (s.boundBusy) return;
  s.boundBusy = true;
  try {
    for (const c of [...g.monsters(0), ...g.monsters(1)]) {
      const b = c.flags.tdgsBound as Bound | undefined;
      if (!b) continue;
      const src = g.card(b.uid);
      if (src && src.location === 'mzone' && src.faceUp && src.moveId === b.mid) continue;
      delete c.flags.tdgsBound;
      if (b.kind === 'control') await g.returnControl(c);
      else {
        g.log(`${c.name} is removed from play.`, 'action', b.player);
        await g.banish([c], 'effect', b.player, src);
      }
    }
  } finally {
    s.boundBusy = false;
  }
}

const PATCHED = new WeakSet<Game>();
export function ensureTdgsPatches(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;
  const s = gs(g);

  // ---- battle damage: Defense Draw
  const origDamage = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: C, sourcePlayer?: PlayerId) => {
    if (kind === 'battle' && amount > 0 && ((g.battle as any)?.tdgsNoDamage as PlayerId[] | undefined)?.includes(p)) {
      g.log(`${g.players[p].name} takes no battle damage from this battle.`, 'battle', p);
      return 0;
    }
    return origDamage(p, amount, kind, source, sourcePlayer);
  };

  // ---- Tributes: Big Piece Golem, Cyber Shark, Geartown (Normal Summons only, not Sets)
  const origNeed = g.tributesNeeded.bind(g);
  anyG.tributesNeeded = (card: C) => {
    let n = origNeed(card);
    if (n > 0 && !s.setting && card.location === 'hand') {
      if (noTributeOk(g, card)) return 0;
      if (isAncientGear(card) && geartownOn(g)) n -= 1;
    }
    return n;
  };
  const origCanNS = g.canNormalSummon.bind(g);
  anyG.canNormalSummon = (p: PlayerId, card: C, set = false) => {
    if (set) s.setting++;
    try {
      return origCanNS(p, card, set);
    } finally {
      if (set) s.setting--;
    }
  };
  const origNS = g.normalSummon.bind(g);
  anyG.normalSummon = async (p: PlayerId, card: C, set: boolean) => {
    if (set) s.setting++;
    try {
      return await origNS(p, card, set);
    } finally {
      if (set) s.setting--;
    }
  };

  // ---- Special Summons: Power Filter
  const origSS = g.specialSummon.bind(g);
  anyG.specialSummon = async (cards: C[], player: PlayerId, opts: Parameters<Game['specialSummon']>[2] = {}) => {
    if (powerFilterOn(g)) {
      const ok = cards.filter((c) => !lowAtk(c));
      if (ok.length < cards.length) g.log('Power Filter: monsters with 1000 or less ATK cannot be Special Summoned.', 'info');
      cards = ok;
      if (!cards.length) return [];
    }
    return origSS(cards, player, opts);
  };
  const origISS = g.inherentSpecialSummon.bind(g);
  anyG.inherentSpecialSummon = async (p: PlayerId, card: C, ...rest: any[]) => {
    if (powerFilterOn(g) && lowAtk(card)) return false;
    return (origISS as any)(p, card, ...rest);
  };
  const origCanSyn = g.canSynchro.bind(g);
  anyG.canSynchro = (p: PlayerId, syn: C) => origCanSyn(p, syn) && !(powerFilterOn(g) && lowAtk(syn));

  // ---- main actions: Power Filter (procedures), Toy Magician (Set as a Spell)
  const origLMA = g.legalMainActions.bind(g);
  anyG.legalMainActions = (p: PlayerId) => {
    let out: Action[] = origLMA(p);
    if (powerFilterOn(g)) out = out.filter((a) => !(a.type === 'proc' && lowAtk(a.card)));
    if (g.freeSZones(p) > 0 && !g.queryPlayer(p, 'cannotSet')) {
      for (const c of g.players[p].hand) if (c.name === TOY_MAGICIAN) out.unshift({ type: 'setST', card: c });
    }
    return out;
  };

  // ---- LP costs: Telekinetic Charging Cell ("you do not have to pay Life Points to activate its effects")
  const origPay = g.payLp.bind(g);
  anyG.payLp = async (p: PlayerId, amount: number) => {
    const top = g.chain[g.chain.length - 1];
    if (top && !g.resolvingLink && top.player === p && top.card.isMonster && top.card.location === 'mzone' && chargingCellOn(g, top.card)) {
      g.log(`${top.card.name} activates its effect without paying ${amount} LP (Telekinetic Charging Cell).`, 'action', p);
      return;
    }
    return origPay(p, amount);
  };

  // ---- negation: Splendid Venus
  const origNL = g.negateLink.bind(g);
  anyG.negateLink = (link: ChainLink, destroy = false, by?: C) => {
    if (venusProtects(g, link)) {
      g.log(`${link.card.name} cannot be negated (Splendid Venus).`, 'chain', link.player);
      venusShield.set(link.card, { moveId: link.card.moveId, by: g.resolvingLink });
      return;
    }
    return origNL(link, destroy, by);
  };
  const origDestroy = g.destroy.bind(g);
  anyG.destroy = async (cards: C[], reason: Reason, reasonPlayer?: PlayerId, reasonCard?: C, battleWith?: C) => {
    // "Negate, and if you do, destroy it": a card that could not be negated is not destroyed by that effect.
    cards = cards.filter((c) => {
      const sh = venusShield.get(c);
      return !(sh && sh.moveId === c.moveId && sh.by && sh.by === g.resolvingLink);
    });
    return origDestroy(cards, reason, reasonPlayer, reasonCard, battleWith);
  };

  // ---- Spirit returns: Izanagi, Mirror of Yata
  const origTH = g.toHand.bind(g);
  anyG.toHand = async (cards: C[], reason: Reason, reasonPlayer?: PlayerId, reasonCard?: C) => {
    const c = cards[0];
    if (cards.length === 1 && c === reasonCard && isSpirit(c) && c.location === 'mzone' && c.faceUp && g.phase === 'end' && spiritExempt(g, c)) {
      const keep = await g.confirm(c.controller, `${c.name}: keep it on the field instead of returning it to the hand?`, c, true);
      if (keep) {
        g.log(`${c.name} stays on the field.`, 'action', c.controller);
        return [];
      }
    }
    return origTH(cards, reason, reasonPlayer, reasonCard);
  };

  // ---- lingering links: Dharc the Dark Charmer, Kinka-byo
  const origRC = g.ruleCleanup.bind(g);
  anyG.ruleCleanup = async () => {
    await origRC();
    await boundCheck(g);
  };
}

/** Installs the per-game patches at the first phase (from any location, never activates). */
const PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  eventFilter: (ctx) => {
    ensureTdgsPatches(ctx.game);
    return false;
  },
};

type MonsterOpts = Parameters<typeof monster>[1];
type STOpts = Parameters<typeof spell>[2];
/** Define a card of this set (adds the patch installer). */
const M = (name: string, o: MonsterOpts) => monster(name, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });
const S = (name: string, t: Parameters<typeof spell>[1], o: STOpts) => spell(name, t, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });
const T = (name: string, t: Parameters<typeof trap>[1], o: STOpts) => trap(name, t, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });

// ============================================================ Spirit helpers (Kinka-byo, Izanami, Yamato-no-Kami)

const markSpirit = (ctx: Ctx, ev: GameEvent) => {
  if (ev.card === ctx.self && (ev.type === 'normalSummoned' || ev.type === 'flipped')) ctx.self.flags.spiritTurn = ctx.turn;
};
const spiritReturn: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  mandatory: true,
  label: 'Return to hand (Spirit)',
  categories: ['toHand'],
  eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.location === 'mzone' && ctx.self.flags.spiritTurn === ctx.turn,
  resolve: async (ctx) => {
    if (ctx.self.location === 'mzone' && ctx.self.faceUp) await ctx.toHand(ctx.self);
  },
};
/** "Equip only to a Spirit monster" equip activation (Sword of Kusanagi, Orb of Yasaka, Mirror of Yata). */
function spiritEquipActivate(score: (ctx: Ctx) => number): EffectDef {
  return {
    kind: 'activate',
    categories: ['atkChange'],
    canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => isSpirit(c) && ctx.canTarget(c)).length > 0,
    activate: async (ctx) => {
      await ctx.selectTargets(ctx.faceUpMonsters('both', isSpirit), 1, 1, 'Target 1 face-up Spirit monster to equip.', 'equip', {
        aiScore: (c) => (c.controller === ctx.player ? ctx.atk(c) : -5000),
      });
    },
    resolve: async (ctx) => {
      const t = ctx.validTargets((c) => faceUpOn(c) && isSpirit(c))[0];
      if (t && ctx.self.onField) ctx.equip(t);
    },
    ai: { score },
  };
}

// ============================================================ MONSTERS

M('Turbo Booster', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 1,
  atk: 0,
  def: 0,
  aiValue: 200,
  text: 'If you have Normal Summoned a monster this turn, you can Special Summon this card from your hand. You can Tribute this card to destroy 1 monster your opponent controls that battled one of your monsters this turn.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (Normal Summoned this turn)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && turnEvents(ctx.game).some((e) => e.type === 'normalSummoned' && e.player === ctx.player),
      perform: async () => true,
      ai: { score: (ctx) => (ctx.monsters('opp').length ? 35 : 20) },
    },
    {
      kind: 'ignition',
      label: 'Tribute: destroy a monster that battled',
      categories: ['destroy'],
      canActivate: (ctx) => !ctx.query(ctx.self, 'cannotBeTributed') && turboTargets(ctx).length > 0,
      activate: async (ctx) => {
        const cands = turboTargets(ctx);
        await tributeCost(ctx, [ctx.self]);
        await ctx.selectTargets(cands, 1, 1, 'Target 1 monster your opponent controls that battled one of your monsters this turn.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (turboTargets(ctx).some((c) => cardValue(ctx.game, c) >= 1500) ? 60 : 0) },
    },
  ],
});
/** Opponent's monsters that battled one of this player's monsters this turn (and are still on the field). */
/** APPROX: "battled" = reached the Damage Step with one of your monsters this turn (from the event log). */
function turboTargets(ctx: Ctx): C[] {
  const out = new Set<C>();
  for (const e of turnEvents(ctx.game)) {
    if (e.type !== 'damageStepEnd') continue;
    const a = evc(e);
    const t = evo(e);
    if (!a || !t) continue;
    for (const [mine, theirs] of [
      [a, t],
      [t, a],
    ] as [C, C][]) {
      if (e.player !== undefined && theirs.location === 'mzone' && theirs.controller === ctx.opp && (mine.owner === ctx.player || mine.controller === ctx.player)) out.add(theirs);
    }
  }
  return [...out].filter((c) => ctx.canTarget(c));
}

M('Nitro Synchron', {
  attribute: 'FIRE',
  race: 'Machine',
  level: 2,
  atk: 300,
  def: 100,
  types: ['tuner'],
  sets: ['synchron'],
  aiValue: 400,
  text: 'When this card is sent to the Graveyard for the Synchro Summon of a "Nitro" Synchro Monster, draw 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Draw 1 card',
      categories: ['draw'],
      eventFilter: (ctx, ev) => synchroMaterialEv(ctx, ev) && !!summonedFor(ev)?.name.startsWith('Nitro'),
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

M('Quillbolt Hedgehog', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 2,
  atk: 800,
  def: 800,
  aiValue: 500,
  text: 'If you control a face-up Tuner monster, you can Special Summon this card from your Graveyard. Remove it from play when it is removed from the field.',
  effects: [
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Special Summon from the Graveyard',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.faceUpMonsters('me', (c) => c.isTuner).length > 0,
      canActivate: (ctx) => ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave' || !ctx.faceUpMonsters('me', (c) => c.isTuner).length) return;
        const r = await ctx.specialSummon(ctx.self, { pos: 'choose' });
        if (r.length) ctx.self.banishOnLeave = true;
      },
      ai: { score: (ctx) => (ctx.freeMZones() > 1 ? 55 : 0) },
    },
  ],
});

M('Ghost Gardna', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 0,
  def: 1900,
  aiValue: 300,
  text: 'When a face-up monster you control is selected as an attack target, you can change the target to this card. When this card is destroyed and sent to the Graveyard, 1 face-up monster your opponent controls loses 1000 ATK, until the End Phase.',
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      when: true,
      label: 'Change the attack target to this card',
      categories: ['protect'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && t !== ctx.self && faceUpOn(t) && t.controller === ctx.player && ev.player === ctx.opp && faceUpOn(ctx.self);
      },
      condition: (ctx) => !!ctx.battle && !ctx.battle.negated && !!ctx.battle.target && ctx.battle.target !== ctx.self,
      resolve: async (ctx) => {
        const b = ctx.battle;
        if (!b || b.negated || !faceUpOn(ctx.self)) return;
        b.target = ctx.self;
        b.targetMoveId = ctx.self.moveId;
        ctx.self.attackedThisTurnOrWasAttacked = true;
        ctx.log(`The attack target changes to ${ctx.self.name}.`);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || !b.target) return 0;
          const a = ctx.atk(b.attacker);
          const t = b.target;
          const loses = t.pos === 'atk' ? a >= ctx.atk(t) : a > ctx.def(t);
          return loses && cardValue(ctx.game, t) > cardValue(ctx.game, ctx.self) ? 1 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: '1 opponent monster loses 1000 ATK',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      condition: (ctx) => ctx.faceUpMonsters('opp').length > 0,
      resolve: async (ctx) => {
        const [t] = await ctx.select(ctx.faceUpMonsters('opp'), 1, 1, '1 face-up monster your opponent controls loses 1000 ATK.', 'target', {
          aiScore: (c) => ctx.atk(c),
        });
        if (t && faceUpOn(t)) ctx.addTempMod(t, 'atk', -1000, 'turn');
      },
    },
  ],
});

M('Shield Warrior', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 3,
  atk: 800,
  def: 1600,
  aiValue: 300,
  text: 'During damage calculation in either player\'s turn, you can remove from play this card from your Graveyard to make monsters you control not be destroyed by that battle.',
  effects: [
    {
      // APPROX: used in the Damage Step window before damage calculation.
      kind: 'quick',
      range: ['grave'],
      damageStep: true,
      // Its cost removes it from play from the GY: not usable while cards in the GY cannot be banished (Necrovalley).
      gyBanishCost: true,
      label: 'Remove from play: your monsters are not destroyed by this battle',
      categories: ['protect'],
      condition: (ctx) => {
        const b = ctx.battle;
        // https://edisonrul.ing/cards/s/shield-warrior.html — cannot be activated if your monster would not be destroyed by the battle.
        return !!b && b.inDamageStep && !b.calc && !b.negated && !!b.target && (b.attacker.controller === ctx.player || b.target.controller === ctx.player) && !!myBattleMonsterLoses(ctx);
      },
      activate: async (ctx) => {
        await ctx.banish(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const b = ctx.battle;
        if (!b) return;
        for (const m of [b.attacker, b.target]) if (m && m.location === 'mzone' && m.controller === ctx.player) ctx.addTempMod(m, 'indestructibleBattle', true, 'battle');
      },
      ai: {
        score: (ctx) => {
          const m = myBattleMonsterLoses(ctx);
          return m && cardValue(ctx.game, m) >= 1600 ? 60 : 0;
        },
      },
    },
  ],
});

function pieceGolem(name: string, other: string, atk: number, level: number) {
  M(name, {
    attribute: 'EARTH',
    race: 'Rock',
    level,
    atk,
    def: 0,
    aiValue: 200,
    text: `When this card is Summoned, if you control a "${BIG_PIECE}", you can Special Summon 1 "${other}" from your Deck. That monster's effect is negated while it is face-up on the field.`,
    effects: [
      {
        kind: 'trigger',
        event: 'summoned',
        when: true,
        label: `Special Summon "${other}"`,
        categories: ['specialSummon'],
        eventFilter: (ctx, ev) => ev.card === ctx.self && faceUpOn(ctx.self),
        condition: (ctx) => ctx.faceUpMonsters('me', (c) => c.name === BIG_PIECE).length > 0,
        canActivate: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => c.name === other && ctx.canSummonCard(c)).length > 0,
        resolve: async (ctx) => {
          // https://edisonrul.ing/cards/s/small-piece-golem.html — still Special Summons if the only "Big Piece Golem"
          // left the field in the chain.
          const r = await summonFromDeck(ctx, (c) => c.name === other, `Special Summon 1 "${other}" from your Deck.`);
          if (r.length) ctx.negateEffects(r[0], 'field');
        },
      },
    ],
  });
}
pieceGolem(SMALL_PIECE, MEDIUM_PIECE, 1100, 3);
pieceGolem(MEDIUM_PIECE, SMALL_PIECE, 1600, 4);

M(BIG_PIECE, {
  attribute: 'EARTH',
  race: 'Rock',
  level: 5,
  atk: 2100,
  def: 0,
  aiValue: 200,
  text: 'If your opponent controls a monster and you control no monsters, you can Normal Summon this card without Tributing.',
  types: ['effect'],
});

M('Sinister Sprocket', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 1,
  atk: 400,
  def: 0,
  types: ['tuner'],
  aiValue: 300,
  text: 'If this card is sent to the Graveyard for the Synchro Summon of a DARK Synchro Monster, you can destroy 1 face-up Spell or Trap Card.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Destroy 1 face-up Spell/Trap',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => synchroMaterialEv(ctx, ev) && !!summonedFor(ev) && attrIs(summonedFor(ev)!, 'DARK'),
      canActivate: (ctx) => ctx.spellTraps('both', (c) => c.faceUp && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both', (c) => c.faceUp), 1, 1, 'Target 1 face-up Spell or Trap Card.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp', (c) => c.faceUp).length ? 50 : 0) },
    },
  ],
});

M('Twin-Shield Defender', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 700,
  def: 1600,
  aiValue: 150,
  text: 'When this card you control is destroyed by battle and sent to your Graveyard, you can halve the current ATK of 1 face-up monster your opponent controls, until the End Phase.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: "Halve an opponent monster's ATK",
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.fromController === ctx.player && ctx.self.location === 'grave',
      condition: (ctx) => ctx.faceUpMonsters('opp').length > 0,
      resolve: async (ctx) => {
        const [t] = await ctx.select(ctx.faceUpMonsters('opp'), 1, 1, 'Halve the ATK of 1 face-up monster your opponent controls.', 'target', { aiScore: (c) => ctx.atk(c) });
        if (t && faceUpOn(t)) ctx.addTempMod(t, 'atk', -Math.ceil(ctx.atk(t) / 2), 'turn');
      },
    },
  ],
});

M('Jutte Fighter', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 2,
  atk: 700,
  def: 900,
  types: ['tuner'],
  aiValue: 300,
  text: 'Once per turn, you can change 1 face-up Attack Position monster your opponent controls to face-up Defense Position.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Change an opponent monster to Defense Position',
      categories: ['position'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => c.pos === 'atk' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp', (c) => c.pos === 'atk'), 1, 1, 'Target 1 face-up Attack Position monster your opponent controls.', 'position', {
          aiScore: (c) => ctx.atk(c) - ctx.def(c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c) && c.pos === 'atk')[0];
        if (t) await ctx.changePos(t, 'def', true);
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1') return 0;
          const myBest = Math.max(0, ...ctx.faceUpMonsters('me', (c) => c.pos === 'atk').map((c) => ctx.atk(c)));
          return ctx.faceUpMonsters('opp', (c) => c.pos === 'atk' && ctx.atk(c) >= myBest && ctx.def(c) < myBest).length ? 45 : 0;
        },
      },
    },
  ],
});

const handcuffsHostDestroyed = new WeakMap<C, number>();
M('Handcuffs Dragon', {
  attribute: 'WIND',
  race: 'Dragon',
  level: 5,
  atk: 1800,
  def: 1800,
  aiValue: 200,
  text: 'When this card is destroyed by battle with an attacking monster your opponent controls and is sent to the Graveyard, you can equip this card to that monster. The equipped monster loses 1800 ATK. When it is destroyed and this card is sent to the Graveyard, you can Special Summon this card.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Equip this card to the attacking monster',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => {
        const o = evo(ev);
        return ev.card === ctx.self && ctx.self.location === 'grave' && !!o && o.controller !== ev.fromController && ctx.battle?.attacker === o;
      },
      canActivate: (ctx) => ctx.freeSZones() > 0,
      activate: async (ctx) => {
        ctx.data.host = evo(ctx.event!);
        ctx.data.mid = (ctx.data.host as C).moveId;
      },
      resolve: async (ctx) => {
        const host = ctx.data.host as C;
        if (ctx.self.location !== 'grave' || !faceUpOn(host) || host.moveId !== ctx.data.mid || ctx.freeSZones() <= 0) return;
        ctx.game.rawMove(ctx.self, 'szone', { controller: ctx.player, faceUp: true });
        ctx.self.activeOnField = true;
        ctx.equip(host);
        ctx.log(`${ctx.self.name} is equipped to ${host.name}.`);
        await ctx.game.anim({ type: 'move', cards: [{ uid: ctx.self.uid, from: 'grave', to: 'szone', ctrl: ctx.player }] });
        ctx.game.update();
      },
    },
    {
      kind: 'continuous',
      range: ['szone'],
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => ctx.self.equippedTo === c.uid, value: -1800 }],
    },
    {
      // Bookkeeping: the equipped monster is destroyed.
      kind: 'trigger',
      event: 'destroyed',
      label: '(equipped monster destroyed)',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && ctx.self.location === 'szone' && ctx.self.equippedTo === c.uid) handcuffsHostDestroyed.set(ctx.self, ctx.self.moveId + 1);
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Special Summon this card',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && handcuffsHostDestroyed.get(ctx.self) === ctx.self.moveId,
      canActivate: (ctx) => ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave' && ctx.canSummonCard(ctx.self)) await ctx.specialSummon(ctx.self, { pos: 'choose' });
      },
    },
  ],
});

const montageAtk = new WeakMap<C, { moveId: number; atk: number }>();
M('Montage Dragon', {
  attribute: 'EARTH',
  race: 'Dragon',
  level: 8,
  atk: 0,
  def: 0,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 500,
  text: "This card cannot be Normal Summoned or Set. This card can only be Special Summoned by sending 3 monsters from your hand to the Graveyard. This card's ATK is equal to the combined original Levels of the 3 monsters x 300.",
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (send 3 monsters from your hand)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.hand('me', (c) => c !== ctx.self && c.isMonster).length >= 3,
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me', (c) => c !== ctx.self && c.isMonster), 3, 3, 'Send 3 monsters from your hand to the Graveyard.', 'cost', {
          aiScore: (c) => lvl(c) * 300 - cardValue(ctx.game, c) / 2,
        });
        if (sel.length < 3) return false;
        montageAtk.set(ctx.self, { moveId: ctx.self.moveId + 1, atk: sel.reduce((a, c) => a + lvl(c), 0) * 300 });
        await ctx.sendToGrave(sel, 'cost');
        return true;
      },
      ai: {
        score: (ctx) => {
          const best = ctx
            .hand('me', (c) => c !== ctx.self && c.isMonster)
            .map((c) => lvl(c))
            .sort((a, b) => b - a)
            .slice(0, 3)
            .reduce((a, b) => a + b, 0);
          return best * 300 >= 3000 ? 50 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) => {
            const m = montageAtk.get(ctx.self);
            return m && m.moveId === ctx.self.moveId ? m.atk : 0;
          },
        },
      ],
    },
  ],
});

M('Gonogo', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 3,
  atk: 1350,
  def: 1600,
  aiValue: 200,
  text: "At the end of the Damage Step, if this card battled an opponent's monster: Change that monster to face-down Defense Position.",
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Change the monster to face-down Defense Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => {
        const o = ev.card === ctx.self ? evo(ev) : ev.other === ctx.self ? evc(ev) : undefined;
        if (!o || !faceUpOn(o) || o.controller === ctx.player || ctx.isNegated(ctx.self)) return false;
        ctx.self.flags.gonogoFoe = { uid: o.uid, mid: o.moveId };
        return true;
      },
      resolve: async (ctx) => {
        const f = ctx.self.flags.gonogoFoe as { uid: number; mid: number } | undefined;
        const o = f ? ctx.game.card(f.uid) : undefined;
        if (o && faceUpOn(o) && o.moveId === f!.mid) await ctx.changePos(o, 'def', false);
      },
    },
  ],
});

M(MIND_MASTER, {
  attribute: 'LIGHT',
  race: 'Psychic',
  level: 1,
  atk: 100,
  def: 200,
  types: ['tuner'],
  aiValue: 400,
  text: 'You can pay 800 Life Points and Tribute 1 Psychic-Type monster, except "Mind Master", to Special Summon 1 Level 4 or lower Psychic-Type monster from your Deck in face-up Attack Position.',
  effects: [
    {
      kind: 'ignition',
      label: 'Pay 800, Tribute a Psychic: Special Summon a Psychic',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        ctx.lp > 800 &&
        tributable(ctx, (c) => isPsychic(c) && c.name !== MIND_MASTER).length > 0 &&
        ctx.deck('me', (c) => isPsychic(c) && lvl(c) <= 4).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => isPsychic(c) && c.name !== MIND_MASTER), 1, 1, 'Tribute 1 Psychic-Type monster, except "Mind Master".', 'tribute', {
          aiScore: (c) => -cardValue(ctx.game, c),
        });
        if (!sel.length) return false;
        await ctx.payLp(800);
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        await summonFromDeck(ctx, (c) => isPsychic(c) && lvl(c) <= 4, 'Special Summon 1 Level 4 or lower Psychic-Type monster from your Deck.', 'atk');
      },
      ai: {
        score: (ctx) => {
          const fodder = tributable(ctx, (c) => isPsychic(c) && c.name !== MIND_MASTER).sort((a, b) => cardValue(ctx.game, a) - cardValue(ctx.game, b))[0];
          const best = Math.max(0, ...ctx.deck('me', (c) => isPsychic(c) && lvl(c) <= 4).map((c) => c.data.atk ?? 0));
          return fodder && ctx.lp > 3000 && best >= cardValue(ctx.game, fodder) + 300 ? 40 : 0;
        },
      },
    },
  ],
});

M('Doctor Cranium', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 1,
  atk: 100,
  def: 100,
  aiValue: 200,
  text: 'When this card is destroyed by battle and sent to the Graveyard, you can pay 800 Life Points to add 1 Psychic-Type monster from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Pay 800: add a Psychic from the Deck',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      canActivate: (ctx) => ctx.lp > 800 && ctx.deck('me', isPsychic).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(800);
      },
      resolve: async (ctx) => {
        await ctx.search(isPsychic, 1, 'Add 1 Psychic-Type monster from your Deck to your hand.');
      },
      ai: { score: (ctx) => (ctx.lp > 2500 ? 1 : 0) },
    },
  ],
});

M('Mind Protector', {
  attribute: 'LIGHT',
  race: 'Psychic',
  level: 3,
  atk: 0,
  def: 2200,
  aiValue: 300,
  text: "This card's controller must pay 500 Life Points during each of their Standby Phases. If they cannot, destroy this card. Monsters with 2000 or less ATK cannot declare an attack, except for Psychic-Type monsters.",
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Pay 500 LP or destroy this card',
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && faceUpOn(ctx.self),
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        // APPROX: pays only while that leaves the player above 0 LP.
        if (ctx.lp > 500) await ctx.payLp(500);
        else await ctx.destroy(ctx.self);
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && !isPsychic(c) && ctx.atk(c) <= 2000 }],
    },
  ],
});

// APPROX: the extra attack lasts for this turn only.
M('Psychic Snail', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 4,
  atk: 1900,
  def: 1200,
  aiValue: 200,
  text: 'You can pay 800 Life Points and select 1 other face-up Psychic-Type monster you control. That monster can attack twice during each Battle Phase this turn. This card cannot attack the turn you activate this effect.',
  effects: [
    {
      kind: 'ignition',
      label: 'Pay 800: another Psychic attacks twice',
      categories: ['atkChange'],
      condition: (ctx) => ctx.phase === 'main1',
      canActivate: (ctx) => ctx.lp > 800 && ctx.faceUpMonsters('me', (c) => c !== ctx.self && isPsychic(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(800);
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => c !== ctx.self && isPsychic(c)), 1, 1, 'Select 1 other face-up Psychic-Type monster you control.', 'buff', {
          aiScore: (c) => ctx.atk(c),
        });
        ctx.addTempMod(ctx.self, 'cannotAttack', true, 'turn');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (t) ctx.addTempMod(t, 'extraAttacks', 1, 'turn');
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.faceUpMonsters('me', (c) => c !== ctx.self && isPsychic(c) && c.pos === 'atk').map((c) => ctx.atk(c)));
          return ctx.lp > 3000 && best >= 2000 && !ctx.monsters('opp').length ? 45 : 0;
        },
      },
    },
  ],
});

M('Telekinetic Shocker', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 4,
  atk: 1700,
  def: 700,
  aiValue: 200,
  text: 'If a face-up Psychic-Type monster(s) on the field would be destroyed, you can pay 500 Life Points and destroy this card instead.',
  effects: [
    {
      kind: 'continuous',
      replaceDestroy: async (ctx, cards) => {
        const saved = cards.filter((c) => c !== ctx.self && faceUpOn(c) && isPsychic(c));
        if (!saved.length || cards.includes(ctx.self) || ctx.lp <= 500 || !faceUpOn(ctx.self)) return [];
        const worth = saved.reduce((a, c) => a + cardValue(ctx.game, c), 0) > cardValue(ctx.game, ctx.self) + 300;
        if (!(await ctx.confirm(`Pay 500 LP and destroy ${ctx.self.name} instead of ${saved.map((c) => c.name).join(', ')}?`, worth))) return [];
        await ctx.payLp(500);
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        return saved;
      },
    },
  ],
});

M('Destructotron', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 4,
  atk: 1600,
  def: 400,
  aiValue: 300,
  text: 'You can pay 1000 Life Points to destroy 1 face-down Spell or Trap Card your opponent controls.',
  effects: [
    {
      kind: 'ignition',
      label: 'Pay 1000: destroy a face-down Spell/Trap',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.lp > 1000 && ctx.spellTraps('opp', (c) => !c.faceUp && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(1000);
        await ctx.selectTargets(ctx.spellTraps('opp', (c) => !c.faceUp), 1, 1, 'Target 1 face-down Spell or Trap Card your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.lp > 3000 && ctx.phase === 'main1' ? 42 : ctx.lp > 4000 ? 25 : 0) },
    },
  ],
});

M('Jenis, Lightsworn Mender', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 4,
  atk: 300,
  def: 2100,
  sets: ['lightsworn'],
  aiValue: 200,
  text: 'During the End Phase, if a card(s) was sent from your Deck to the Graveyard by the effect of a "Lightsworn" card this turn, inflict 500 damage to your opponent and gain 500 Life Points.',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Inflict 500 damage and gain 500 LP',
      categories: ['damage', 'recover'],
      eventFilter: (ctx, ev) =>
        ev.phase === 'end' &&
        faceUpOn(ctx.self) &&
        turnEvents(ctx.game).some((e) => e.type === 'milled' && evc(e)?.owner === ctx.player && !!e.reasonCard && isLightswornCard(e.reasonCard as C)),
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500);
        await ctx.recover(ctx.player, 500);
      },
    },
  ],
});

M('Dharc the Dark Charmer', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 3,
  atk: 500,
  def: 1500,
  types: ['flip'],
  aiValue: 300,
  text: 'FLIP: Take control of 1 DARK monster your opponent controls while this card remains face-up on the field.',
  effects: [
    flip({
      label: 'Take control of 1 DARK monster',
      categories: ['control'],
      canActivate: (ctx) => ctx.monsters('opp', (c) => c.faceUp && attrIs(c, 'DARK') && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('opp', (c) => c.faceUp && attrIs(c, 'DARK')), 1, 1, 'Target 1 DARK monster your opponent controls.', 'control', {
          aiScore: (c) => cardValue(ctx.game, c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.opp)[0];
        if (!t || !faceUpOn(ctx.self)) return;
        if (await ctx.takeControl(t, false)) t.flags.tdgsBound = { uid: ctx.self.uid, mid: ctx.self.moveId, kind: 'control', player: ctx.player } satisfies Bound;
      },
    }),
  ],
});

M(MECHA_BUNNY, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 2,
  atk: 800,
  def: 100,
  aiValue: 200,
  text: 'When this card is flipped face-up, select 1 card on the field and inflict 500 damage to its controller. When this card is destroyed by battle and sent to the Graveyard, you can Special Summon 1 "Mecha Bunny" from your Deck in face-down Defense Position.',
  effects: [
    flip({
      label: 'Inflict 500 damage',
      categories: ['damage'],
      canActivate: (ctx) => ctx.field('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('both'), 1, 1, 'Select 1 card on the field; its controller takes 500 damage.', 'target', {
          aiScore: (c) => (c.controller === ctx.opp ? 100 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField)[0];
        if (t) await ctx.damage(t.controller, 500);
      },
    }),
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Special Summon a "Mecha Bunny" face-down',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => c.name === MECHA_BUNNY).length > 0,
      resolve: async (ctx) => {
        const c = ctx.deck('me', (x) => x.name === MECHA_BUNNY)[0];
        if (c && ctx.canSpecialSummon()) await ctx.specialSummon(c, { pos: 'def', faceDown: true });
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

const oysterToken = token('Oyster Token', 'WATER', 'Fish', 1, 0, 0, 'Oyster Token (Fish-Type/WATER/Level 1/ATK 0/DEF 0). Special Summoned by "Oyster Meister".');
M('Oyster Meister', {
  attribute: 'WATER',
  race: 'Fish',
  level: 3,
  atk: 1600,
  def: 200,
  aiValue: 300,
  text: 'When this card is sent from the field to the Graveyard, except by being destroyed by battle, Special Summon 1 "Oyster Token" (Fish-Type/WATER/Level 1/ATK 0/DEF 0).',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Special Summon an Oyster Token',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && !(reasonsOf(ev).includes('battle') && reasonsOf(ev).includes('destroy')),
      condition: (ctx) => ctx.canSpecialSummon(),
      resolve: async (ctx) => {
        if (ctx.canSpecialSummon()) await ctx.createTokens(oysterToken, 1, 'def');
      },
    },
  ],
});

M('Twin-Barrel Dragon', {
  attribute: 'DARK',
  race: 'Machine',
  level: 4,
  atk: 1700,
  def: 200,
  aiValue: 300,
  text: 'When this card is Normal Summoned, Flip Summoned, or Special Summoned, select 1 card your opponent controls. Toss a coin twice and destroy the selected card if both results are Heads.',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      label: 'Toss a coin twice',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && faceUpOn(ctx.self),
      condition: (ctx) => ctx.field('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('opp'), 1, 1, 'Select 1 card your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const r1 = ctx.game.rng.int(2) === 0;
        const r2 = ctx.game.rng.int(2) === 0;
        ctx.log(`${ctx.self.name}: coin tosses — ${r1 ? 'Heads' : 'Tails'}, ${r2 ? 'Heads' : 'Tails'}.`);
        if (!r1 || !r2) return;
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
    },
  ],
});

// APPROX: "do not have to activate" is a yes/no prompt when the Spirit would return (any Spirit, via the toHand patch).
M(IZANAGI, {
  attribute: 'WIND',
  race: 'Fairy',
  level: 6,
  atk: 2200,
  def: 1000,
  aiValue: 300,
  text: 'You can Special Summon this card from your hand by removing from play 1 Spirit monster from your hand. Spirit monsters you control do not have to have their effects that return them to the hand activated.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (remove 1 Spirit monster in hand from play)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.hand('me', (c) => c !== ctx.self && isSpirit(c)).length > 0,
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me', (c) => c !== ctx.self && isSpirit(c)), 1, 1, 'Remove from play 1 Spirit monster from your hand.', 'cost', {
          aiScore: (c) => -cardValue(ctx.game, c),
        });
        if (!sel.length) return false;
        await ctx.banish(sel, 'cost');
        return true;
      },
      ai: { score: (ctx) => (ctx.hand('me', (c) => c !== ctx.self && isSpirit(c)).length >= 2 ? 45 : 25) },
    },
  ],
});

M('Kunoichi', {
  attribute: 'WIND',
  race: 'Warrior',
  level: 4,
  atk: 1800,
  def: 1000,
  aiValue: 100,
  text: 'When control of this face-up card changes, its new controller discards 1 random card.',
  effects: [
    {
      // APPROX: control returning at the End Phase emits no engine event, so only a change of control that takes it triggers.
      kind: 'trigger',
      event: 'controlChanged',
      mandatory: true,
      label: 'New controller discards 1 random card',
      categories: ['discard'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && faceUpOn(ctx.self),
      condition: (ctx) => ctx.hand().length > 0,
      resolve: async (ctx) => {
        const p = ctx.self.controller;
        const hand = ctx.game.players[p].hand;
        if (!hand.length) return;
        const c = hand[ctx.game.rng.int(hand.length)];
        ctx.game.log(`${ctx.game.players[p].name} discards ${c.name} at random.`, 'action', p);
        await ctx.game.discard([c], 'effect', ctx.player, ctx.self);
      },
    },
  ],
});

M('Beast of the Pharaoh', {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 3,
  atk: 400,
  def: 600,
  aiValue: 300,
  text: 'When this card is sent to the Graveyard for a Synchro Summon, you can Special Summon 1 Level 4 or lower Zombie-Type monster from your Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Special Summon a Level 4 or lower Zombie',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => synchroMaterialEv(ctx, ev),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c !== ctx.self && raceIs(c, 'Zombie') && lvl(c) <= 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c !== ctx.self && raceIs(c, 'Zombie') && lvl(c) <= 4 && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 4 or lower Zombie-Type monster in your Graveyard.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.isTuner ? 400 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t, { pos: 'choose' });
      },
    },
  ],
});

M('Dark Hunter', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 1600,
  def: 400,
  aiValue: 200,
  text: "This card's effect changes depending on the number of DARK monsters in your Graveyard.\n● 1 or fewer: This card loses 400 ATK.\n● 2 to 4: This card gains 400 ATK.\n● 5 or more: You can send this card to the Graveyard to destroy all face-down monsters your opponent controls.",
  effects: [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) => {
            const n = ctx.grave('me', (c) => attrIs(c, 'DARK')).length;
            return n <= 1 ? -400 : n <= 4 ? 400 : 0;
          },
        },
      ],
    },
    {
      kind: 'ignition',
      label: 'Send to GY: destroy all face-down opponent monsters',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) => ctx.grave('me', (c) => attrIs(c, 'DARK')).length >= 5,
      canActivate: (ctx) => ctx.monsters('opp', (c) => !c.faceUp).length > 0,
      activate: async (ctx) => {
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const list = ctx.monsters('opp', (c) => !c.faceUp);
        if (list.length) await ctx.destroy(list);
      },
      ai: { score: (ctx) => (ctx.monsters('opp', (c) => !c.faceUp).length >= 2 ? 55 : ctx.monsters('opp', (c) => !c.faceUp).length ? 30 : 0) },
    },
  ],
});

M('Kinka-byo', {
  attribute: 'DARK',
  race: 'Beast',
  level: 1,
  atk: 400,
  def: 200,
  types: ['spirit'],
  nomi: true,
  aiValue: 300,
  text: 'This card cannot be Special Summoned. This card returns to its owner\'s hand during the End Phase of the turn it is Normal Summoned or flipped face-up. When this card is Normal Summoned or flipped face-up, you can Special Summon 1 Level 1 monster from your Graveyard. When this card is removed from the field, remove that monster from play.',
  effects: [
    spiritReturn,
    {
      kind: 'trigger',
      event: ['normalSummoned', 'flipped'],
      when: true,
      label: 'Special Summon a Level 1 monster from your GY',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        markSpirit(ctx, ev);
        return ev.card === ctx.self && ctx.self.location === 'mzone';
      },
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c.isMonster && lvl(c) === 1 && !c.isExtra && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && lvl(c) === 1 && !c.isExtra && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 1 monster in your Graveyard.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.isTuner ? 500 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.canSummonCard(t)) return;
        const r = await ctx.specialSummon(t, { pos: 'choose' });
        if (r.length) {
          r[0].flags.tdgsBound = { uid: ctx.self.uid, mid: ctx.self.moveId, kind: 'banish', player: ctx.player } satisfies Bound;
          await boundCheck(ctx.game);
        }
      },
    },
  ],
});

M('Yamato-no-Kami', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 6,
  atk: 2200,
  def: 1200,
  types: ['spirit', 'effect'],
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 300,
  text: 'This card cannot be Normal Summoned or Set. This card cannot be Special Summoned except by removing from play 1 Spirit monster from your Graveyard. This card returns to its owner\'s hand during the End Phase of the turn it is Special Summoned. If this card destroys an opponent\'s monster by battle, you can destroy 1 Spell or Trap Card your opponent controls.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (remove 1 Spirit in GY from play)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.grave('me', isSpirit).length > 0,
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', isSpirit), 1, 1, 'Remove from play 1 Spirit monster from your Graveyard.', 'cost');
        if (!sel.length) return false;
        await ctx.banish(sel, 'cost');
        return true;
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' ? 40 : 0) },
    },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      label: '(Spirit: Special Summoned)',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self) ctx.self.flags.spiritTurn = ctx.turn;
        return false;
      },
    },
    spiritReturn,
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Destroy 1 Spell/Trap your opponent controls',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && faceUpOn(ctx.self) && ev.fromController === ctx.opp,
      canActivate: (ctx) => ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('opp'), 1, 1, 'Target 1 Spell or Trap Card your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
    },
  ],
});

function levelBug(name: string, atk: number, def: number, delta: number) {
  M(name, {
    attribute: 'EARTH',
    race: 'Insect',
    level: 2,
    atk,
    def,
    aiValue: 150,
    text:
      delta < 0
        ? 'You can send this card from your hand to the Graveyard to reduce the Level of 1 face-up monster on the field by 1, until the End Phase.'
        : 'You can send this card from your hand to the Graveyard to select 1 face-up monster on the field. Increase its Level by 1 until the End Phase.',
    effects: [
      {
        kind: 'ignition',
        range: ['hand'],
        label: delta < 0 ? 'Send to GY: Level -1' : 'Send to GY: Level +1',
        categories: [],
        canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c) && (delta > 0 || ctx.level(c) > 1)).length > 0,
        activate: async (ctx) => {
          await ctx.sendToGrave(ctx.self, 'cost');
          await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => delta > 0 || ctx.level(c) > 1), 1, 1, `Target 1 face-up monster (Level ${delta > 0 ? '+1' : '-1'}).`, 'buff', {
            aiScore: (c) => (c.controller === ctx.player ? levelBugGain(ctx, c, delta) : -1000),
          });
        },
        resolve: async (ctx) => {
          const t = ctx.validTargets(faceUpOn)[0];
          if (t) ctx.addTempMod(t, 'level', delta, 'turn');
        },
        ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => levelBugGain(ctx, c, delta) > 0).length && myOpenMain(ctx) ? 40 : 0) },
      },
    ],
  });
}
/** AI: the level change makes a Synchro Summon possible. */
function levelBugGain(ctx: Ctx, c: C, delta: number) {
  const g = ctx.game;
  const before = ctx.extra('me', (s) => g.canSynchro(ctx.player, s)).length;
  c.tempMods.push({ q: 'level', value: delta, until: 'turn', turn: g.turn });
  try {
    return ctx.extra('me', (s) => g.canSynchro(ctx.player, s)).length - before;
  } finally {
    c.tempMods.pop();
  }
}
levelBug('Silent Strider', 300, 700, -1);
levelBug('Noisy Gnat', 700, 300, 1);

M('Multiple Piece Golem', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 7,
  atk: 2600,
  def: 1300,
  types: ['fusion'],
  aiValue: 300,
  fusion: { materials: [(c) => c.name === BIG_PIECE, (c) => c.name === MEDIUM_PIECE], desc: `"${BIG_PIECE}" + "${MEDIUM_PIECE}"` },
  text: `"${BIG_PIECE}" + "${MEDIUM_PIECE}"\nAt the end of the Battle Phase, if this card attacked or was attacked, you can return it to the Extra Deck. Then, if all of the Fusion Material Monsters that were used for the Fusion Summon of this card are in your Graveyard, you can Special Summon them.`,
  effects: [
    {
      kind: 'trigger',
      event: 'battleEnd',
      when: true,
      label: 'Return to the Extra Deck',
      categories: ['specialSummon'],
      eventFilter: (ctx) => faceUpOn(ctx.self) && ctx.self.attackedThisTurnOrWasAttacked,
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        const mats = ((ctx.self.flags.materials ?? []) as { uid: number; card?: C }[]).map((m) => m.card ?? ctx.game.card(m.uid)).filter((c): c is C => !!c);
        await ctx.toDeck(ctx.self);
        await summonMaterials(ctx, mats);
      },
      ai: {
        score: (ctx) => {
          const mats = ((ctx.self.flags.materials ?? []) as { card?: C }[]).map((m) => m.card);
          return mats.length === 2 && mats.every((c) => c && c.location === 'grave' && c.owner === ctx.player) ? 1 : 0;
        },
      },
    },
  ],
});
/** "If all of the materials are in your Graveyard, you can Special Summon them" (Multiple Piece Golem, De-Synchro). */
async function summonMaterials(ctx: Ctx, mats: C[]) {
  if (!mats.length || !mats.every((c) => c.location === 'grave' && c.owner === ctx.player && ctx.canSummonCard(c))) return;
  if (ctx.freeMZones() < mats.length) return;
  if (!(await ctx.confirm(`Special Summon ${mats.map((c) => c.name).join(', ')} from your Graveyard?`))) return;
  await ctx.specialSummon(mats, { pos: 'choose' });
}

M('Counselor Lily', {
  attribute: 'EARTH',
  race: 'Fairy',
  level: 3,
  atk: 400,
  def: 1500,
  types: ['tuner'],
  aiValue: 300,
  text: 'When this card is sent to the Graveyard for a Synchro Summon, you can pay 500 Life Points to have that Synchro Monster gain 1000 ATK until the End Phase.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Pay 500: the Synchro Monster gains 1000 ATK',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => synchroMaterialEv(ctx, ev) && !!summonedFor(ev),
      canActivate: (ctx) => ctx.lp > 500,
      activate: async (ctx) => {
        ctx.data.s = summonedFor(ctx.event!);
        await ctx.payLp(500);
      },
      resolve: async (ctx) => {
        const s = ctx.data.s as C;
        if (s && faceUpOn(s)) ctx.addTempMod(s, 'atk', 1000, 'turn');
      },
      ai: { score: (ctx) => (ctx.isMyTurn && ctx.phase === 'main1' && ctx.lp > 2000 ? 1 : 0) },
    },
  ],
});

M('Herald of Orange Light', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 2,
  atk: 300,
  def: 500,
  types: ['tuner'],
  aiValue: 400,
  text: "When your opponent activates an Effect Monster's effect, you can send this card and 1 Fairy-Type monster from your hand to the Graveyard to negate the activation and destroy that card.",
  effects: [
    {
      kind: 'quick',
      range: ['hand'],
      label: "Negate a monster's effect",
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.player === ctx.opp && l.card.isMonster && !l.isCardActivation;
      },
      // https://edisonrul.ing/cards/h/herald-of-orange-light.html — sending the cards to the GY is the cost, so "this
      // effect cannot activate while "Macro Cosmos" is active".
      canActivate: (ctx) =>
        !ctx.game.queryPlayer(ctx.player, 'banishInsteadOfGrave') &&
        !ctx.game.queryCard(ctx.self, 'banishInsteadOfGrave') &&
        ctx.hand('me', (c) => c !== ctx.self && raceIs(c, 'Fairy')).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me', (c) => c !== ctx.self && raceIs(c, 'Fairy')), 1, 1, 'Send 1 other Fairy-Type monster from your hand to the Graveyard.', 'cost', {
          aiScore: (c) => -cardValue(ctx.game, c),
        });
        if (!sel.length) return false;
        ctx.data.link = ctx.prevLink();
        await ctx.sendToGrave([ctx.self, ...sel], 'cost');
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l) return 0;
          const cats = l.effect.categories ?? [];
          return cats.some((c) => ['destroy', 'destroyMulti', 'control', 'banish', 'negate', 'specialSummon', 'search'].includes(c)) ? 60 : 0;
        },
      },
    },
  ],
});

M('Izanami', {
  attribute: 'WATER',
  race: 'Fairy',
  level: 4,
  atk: 1100,
  def: 1800,
  types: ['spirit'],
  nomi: true,
  aiValue: 300,
  text: "This card cannot be Special Summoned. This card returns to its owner's hand during the End Phase of the turn it is Normal Summoned or flipped face-up. When this card is Normal Summoned or flipped face-up, you can discard 1 card to add 1 Spirit monster from your Graveyard to your hand.",
  effects: [
    spiritReturn,
    {
      kind: 'trigger',
      event: ['normalSummoned', 'flipped'],
      when: true,
      label: 'Discard 1: add a Spirit from your GY',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => {
        markSpirit(ctx, ev);
        return ev.card === ctx.self && ctx.self.location === 'mzone';
      },
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.grave('me', isSpirit).length > 0,
      activate: async (ctx) => {
        const d = await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
        if (!d.length) return false;
      },
      resolve: async (ctx) => {
        const cands = ctx.grave('me', isSpirit);
        const [c] = await ctx.select(cands, 1, 1, 'Add 1 Spirit monster from your Graveyard to your hand.', 'toHand');
        if (c) await ctx.toHand(c);
      },
      ai: { score: (ctx) => (ctx.grave('me', (c) => isSpirit(c) && (c.data.aiValue ?? 0) >= 500).length ? 1 : 0) },
    },
  ],
});

M('Maiden of Macabre', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 1700,
  def: 0,
  aiValue: 200,
  text: "When this card destroys an opponent's monster by battle, place 1 Spell Counter on this card. This card gains 200 ATK for each Spell Counter on it.",
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Place 1 Spell Counter',
      eventFilter: (ctx, ev) => ev.other === ctx.self && faceUpOn(ctx.self) && ev.fromController === ctx.opp,
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        ctx.self.counters.spell = (ctx.self.counters.spell ?? 0) + 1;
        ctx.game.update();
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 200 * (ctx.self.counters.spell ?? 0) }] },
  ],
});

M('Hand of the Six Samurai', {
  attribute: 'FIRE',
  race: 'Warrior',
  level: 3,
  atk: 1600,
  def: 1000,
  sets: ['six-samurai'],
  aiValue: 400,
  text: 'If you control another face-up "Six Samurai" monster, you can Tribute 1 "Six Samurai" monster you control to destroy 1 monster on the field.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute a Six Samurai: destroy 1 monster',
      categories: ['destroy'],
      condition: (ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && isSixSamurai(c)).length > 0,
      canActivate: (ctx) => tributable(ctx, isSixSamurai).length > 0 && ctx.monsters('both', (c) => ctx.canTarget(c)).length > 1,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, isSixSamurai), 1, 1, 'Tribute 1 "Six Samurai" monster you control.', 'tribute', {
          aiScore: (c) => -cardValue(ctx.game, c) - (c === ctx.self ? 3000 : 0),
        });
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
        await ctx.selectTargets(ctx.monsters('both'), 1, 1, 'Target 1 monster on the field.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.monsters('opp'));
          const fodder = Math.min(...tributable(ctx, (c) => isSixSamurai(c) && c !== ctx.self).map((c) => cardValue(ctx.game, c)));
          return best && cardValue(ctx.game, best) > fodder + 300 ? 50 : 0;
        },
      },
    },
  ],
});

M(CYBER_SHARK, {
  attribute: 'WATER',
  race: 'Fish',
  level: 5,
  atk: 2100,
  def: 2000,
  aiValue: 100,
  text: 'If you control a face-up WATER monster, you can Normal Summon this card without Tributing.',
  types: ['effect'],
});

M('Grapple Blocker', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 4,
  atk: 1200,
  def: 2000,
  aiValue: 200,
  text: 'When this card is Normal Summoned, you can select 1 monster your opponent controls. The selected monster cannot attack or be Tributed, while this card remains face-up on the field. During each of your End Phases, pay 500 Life Points or destroy this card.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      label: 'Lock 1 opponent monster',
      categories: ['lockdown'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Select 1 monster your opponent controls.', 'target', { aiScore: (c) => cardValue(ctx.game, c) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone')[0];
        if (t && faceUpOn(ctx.self)) ctx.self.flags.grapple = { uid: t.uid, mid: t.moveId };
      },
    },
    {
      kind: 'continuous',
      mods: (['cannotAttack', 'cannotBeTributed'] as const).map((q) => ({
        q,
        to: 'cards' as const,
        filter: (ctx: Ctx, c: C) => {
          const g = ctx.self.flags.grapple as { uid: number; mid: number } | undefined;
          return !!g && c.uid === g.uid && c.moveId === g.mid;
        },
      })),
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Pay 500 LP or destroy this card',
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && faceUpOn(ctx.self),
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        const pay =
          ctx.lp > 500 && (await ctx.option(`${ctx.self.name}: pay 500 LP or destroy it?`, ['Pay 500 LP', 'Destroy this card'], (i) => (i === 0 ? (ctx.lp > 2500 ? 1 : 0) : 0.5))) === 0;
        if (pay) await ctx.payLp(500);
        else await ctx.destroy(ctx.self);
      },
    },
  ],
});

M(THE_TRICKY, {
  attribute: 'WIND',
  race: 'Spellcaster',
  level: 5,
  atk: 2000,
  def: 1200,
  aiValue: 300,
  text: 'You can Special Summon this card from your hand by discarding 1 card from your hand.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (discard 1 card)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.hand('me', (c) => c !== ctx.self).length > 0,
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me', (c) => c !== ctx.self), 1, 1, 'Discard 1 card.', 'discard', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        await ctx.discard(sel, 'cost');
        return true;
      },
      ai: { score: (ctx) => (ctx.hand('me', (c) => c !== ctx.self && cardValue(ctx.game, c) < 1400).length ? 48 : 0) },
    },
  ],
});

M(VENUS, {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 8,
  atk: 2800,
  def: 2400,
  aiValue: 300,
  text: 'All non-Fairy-Type monsters lose 500 ATK and DEF. The activation and effects of Spell and Trap Cards you control cannot be negated.',
  effects: [
    {
      // APPROX: protects the activation (and the "negate, and if you do, destroy" destruction) of chain links; effects of
      // face-up Continuous cards negated by continuous effects are not covered.
      kind: 'continuous',
      mods: (['atk', 'def'] as const).map((q) => ({ q, to: 'cards' as const, filter: (_ctx: Ctx, c: C) => faceUpOn(c) && !raceIs(c, 'Fairy'), value: -500 })),
    },
  ],
});

const engineToken = token('Engine Token', 'EARTH', 'Machine', 1, 200, 200, 'Engine Token (Machine-Type/EARTH/Level 1/ATK 200/DEF 200). Special Summoned by "Fiendish Engine Ω".');
M('Fiendish Engine Ω', {
  attribute: 'DARK',
  race: 'Machine',
  level: 8,
  atk: 2800,
  def: 2000,
  aiValue: 300,
  text: 'During each of your End Phases, Special Summon 1 "Engine Token" (Machine-Type/EARTH/Level 1/ATK 200/DEF 200) in Attack Position. Once per turn, you can increase this card\'s ATK by 1000 until the End Phase. If you do, destroy this card during the End Phase.',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Special Summon an Engine Token',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && faceUpOn(ctx.self),
      condition: (ctx) => ctx.canSpecialSummon(),
      resolve: async (ctx) => {
        if (ctx.canSpecialSummon()) await ctx.createTokens(engineToken, 1, 'atk');
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: '+1000 ATK (destroyed in the End Phase)',
      categories: ['atkChange'],
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        ctx.addTempMod(ctx.self, 'atk', 1000, 'turn');
        const mid = ctx.self.moveId;
        ctx.later('end', async () => {
          if (ctx.self.location === 'mzone' && ctx.self.moveId === mid) await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        });
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1') return 0;
          if (!ctx.monsters('opp').length) return ctx.oppLp <= ctx.atk(ctx.self) + 1000 ? 80 : 0;
          return 0;
        },
      },
    },
  ],
});

M('Cold Enchanter', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 4,
  atk: 1600,
  def: 1200,
  aiValue: 200,
  text: 'You can discard 1 card to place 1 Ice Counter on 1 face-up monster on the field. This card gains 300 ATK for each Ice Counter on the field.',
  effects: [
    {
      kind: 'ignition',
      label: 'Discard 1: place an Ice Counter',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const d = await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
        if (!d.length) return false;
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster; place an Ice Counter on it.', 'target', {
          aiScore: (c) => (c.controller === ctx.opp ? 100 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (t) addIce(ctx, t);
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && ctx.hand().length >= 3 && ctx.faceUpMonsters('opp', (c) => ctx.atk(c) >= ctx.atk(ctx.self) && ctx.atk(c) < ctx.atk(ctx.self) + 300).length ? 35 : 0) },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 300 * iceOnField(ctx.game) }] },
  ],
});

M('Ice Master', {
  attribute: 'WATER',
  race: 'Spellcaster',
  level: 8,
  atk: 2500,
  def: 2000,
  aiValue: 300,
  text: 'You can Special Summon this card from your hand by Tributing 2 WATER monsters. Once per turn, you can place 1 Ice Counter on 1 face-up monster on the field. You can Tribute this card to destroy all monsters with Ice Counters.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (Tribute 2 WATER monsters)',
      categories: ['specialSummon'],
      condition: (ctx) => tributable(ctx, (c) => attrIs(c, 'WATER')).length >= 2,
      perform: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => attrIs(c, 'WATER')), 2, 2, 'Tribute 2 WATER monsters.', 'tribute', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (sel.length < 2) return false;
        await tributeCost(ctx, sel);
        return true;
      },
      ai: { score: (ctx) => (tributable(ctx, (c) => attrIs(c, 'WATER')).filter((c) => cardValue(ctx.game, c) < 1500).length >= 2 ? 50 : 0) },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Place an Ice Counter',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster; place an Ice Counter on it.', 'target', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -1000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (t) addIce(ctx, t);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('opp').length ? 40 : 0) },
    },
    {
      kind: 'ignition',
      label: 'Tribute: destroy all monsters with Ice Counters',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => !ctx.query(ctx.self, 'cannotBeTributed') && ctx.monsters('both', (c) => c !== ctx.self && iceCount(c) > 0).length > 0,
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        const list = ctx.monsters('both', (c) => iceCount(c) > 0);
        if (list.length) await ctx.destroy(list);
      },
      ai: {
        score: (ctx) => {
          const theirs = ctx.monsters('opp', (c) => iceCount(c) > 0).reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const mine = ctx.monsters('me', (c) => c !== ctx.self && iceCount(c) > 0).reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return theirs - mine > cardValue(ctx.game, ctx.self) ? 45 : 0;
        },
      },
    },
  ],
});

// APPROX: Setting it in the Spell & Trap Zone is offered as an extra "Set" main action (setST); the AI never uses it.
M(TOY_MAGICIAN, {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 4,
  atk: 1600,
  def: 1500,
  aiValue: 200,
  text: 'You can Set this card from your hand to your Spell & Trap Card Zone as a Spell Card. When this card is destroyed and sent to the Graveyard by your opponent\'s card effect while Set in the Spell & Trap Card Zone, Special Summon it during the End Phase. When this card is Flip Summoned, destroy Spell and Trap Cards on the field equal to the number of "Toy Magician" on the field.',
  effects: [
    {
      // Bookkeeping: destroyed while Set in the Spell & Trap Zone by an opponent's card effect.
      kind: 'trigger',
      event: 'destroyed',
      label: '(destroyed while Set)',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && ev.from === 'szone' && !ev.fromFaceUp && ctx.self.location === 'grave' && ev.reasonPlayer !== undefined && ev.reasonPlayer !== ctx.self.owner) {
          ctx.self.flags.toyTurn = ctx.turn;
        }
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Special Summon this card',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.location === 'grave' && ctx.self.flags.toyTurn === ctx.turn,
      condition: (ctx) => ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave' && ctx.canSummonCard(ctx.self)) await ctx.specialSummon(ctx.self, { pos: 'choose' });
      },
    },
    {
      kind: 'trigger',
      event: 'flipSummoned',
      mandatory: true,
      label: 'Destroy Spells and Traps',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      condition: (ctx) => ctx.spellTraps('both').length > 0,
      resolve: async (ctx) => {
        const n = ctx.faceUpMonsters('both', (c) => c.name === TOY_MAGICIAN).length;
        const st = ctx.spellTraps('both');
        if (!n || !st.length) return;
        const sel = await ctx.select(st, Math.min(n, st.length), Math.min(n, st.length), `Destroy ${n} Spell/Trap Card(s) on the field.`, 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000),
        });
        if (sel.length) await ctx.destroy(sel);
      },
    },
  ],
});

// ============================================================ SPELLS

S('Fighting Spirit', 'equip', {
  text: 'The equipped monster gains 300 ATK for each monster your opponent controls. If the equipped monster would be destroyed by battle, you can destroy this card instead.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to equip.', 'equip', { aiScore: (c) => (c.controller === ctx.player ? ctx.atk(c) : -5000) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (t && ctx.self.onField) ctx.equip(t);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('me').length && ctx.monsters('opp').length >= 2 && myOpenMain(ctx) ? 35 : 0) },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget, value: (ctx) => 300 * ctx.monsters('opp').length }],
      replaceDestroyOne: async (ctx, card, reason) => {
        if (reason !== 'battle' || card !== ctx.equipTarget || !ctx.self.onField) return false;
        if (!(await ctx.confirm(`Destroy ${ctx.self.name} instead of ${card.name}?`))) return false;
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        return true;
      },
    },
  ],
});

S('Domino Effect', 'continuous', {
  text: 'When a monster your opponent controls is destroyed by battle and sent to the Graveyard, you can send 1 monster you control to the Graveyard to destroy 1 monster your opponent controls.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (myOpenMain(ctx) && ctx.monsters('me').length >= 2 ? 15 : 0) } },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Send 1 monster: destroy 1 opponent monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.fromController === ctx.opp && evc(ev)?.location === 'grave' && stActive(ctx),
      // Sending your monster is the cost; the effect targets 1 monster your opponent controls:
      // https://edisonrul.ing/cards/d/domino-effect.html
      canActivate: (ctx) => ctx.monsters('me').length > 0 && ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.monsters('me'), 1, 1, 'Send 1 monster you control to the Graveyard.', 'cost', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        await ctx.sendToGrave(sel, 'cost');
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const mine = Math.min(...ctx.monsters('me').map((c) => cardValue(ctx.game, c)));
          const best = bestTarget(ctx.game, ctx.monsters('opp'));
          return best && cardValue(ctx.game, best) > mine + 300 ? 1 : 0;
        },
      },
    },
  ],
});

S('Junk Barrage', 'equip', {
  text: "When the equipped monster destroys a monster by battle and sends it to the Graveyard, inflict damage to your opponent equal to half the destroyed monster's ATK in the Graveyard.",
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to equip.', 'equip', { aiScore: (c) => (c.controller === ctx.player ? ctx.atk(c) : -5000) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (t && ctx.self.onField) ctx.equip(t);
      },
      ai: { score: (ctx) => (myOpenMain(ctx) && ctx.phase === 'main1' && ctx.faceUpMonsters('me', (c) => c.pos === 'atk' && ctx.atk(c) >= 1800).length ? 25 : 0) },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Inflict half its ATK',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const o = evo(ev);
        const v = evc(ev);
        return !!o && !!v && stActive(ctx) && o.uid === ctx.self.equippedTo && v.location === 'grave';
      },
      activate: async (ctx) => {
        ctx.data.dmg = Math.floor((evc(ctx.event!)!.data.atk ?? 0) / 2);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, ctx.data.dmg ?? 0);
      },
    },
  ],
});

S('Battle Tuned', 'quickplay', {
  text: "Remove from play 1 Tuner monster from your Graveyard. Target face-up monster you control gains ATK equal to the removed monster's ATK.",
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      // Cost: removes a Tuner from play from the GY (not payable under Necrovalley).
      gyBanishCost: true,
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.grave('me', (c) => c.isMonster && c.isTuner).length > 0 && ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const [cost] = await ctx.select(ctx.grave('me', (c) => c.isMonster && c.isTuner), 1, 1, 'Remove from play 1 Tuner monster from your Graveyard.', 'cost', {
          aiScore: (c) => c.data.atk ?? 0,
        });
        if (!cost) return false;
        ctx.data.atk = cost.data.atk ?? 0;
        await ctx.banish(cost, 'cost');
        await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Target 1 face-up monster you control.', 'buff', {
          aiScore: (c) => (ctx.battle && (ctx.battle.attacker === c || ctx.battle.target === c) ? 5000 : 0) + ctx.atk(c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (t) ctx.addTempMod(t, 'atk', ctx.data.atk ?? 0, 'field');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || !b.inDamageStep || b.calc) return 0;
          const gain = Math.max(0, ...ctx.grave('me', (c) => c.isMonster && c.isTuner).map((c) => c.data.atk ?? 0));
          const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
          const theirs = mine === b.attacker ? b.target : b.attacker;
          if (!mine || !theirs || mine.controller !== ctx.player || !faceUpOn(theirs)) return 0;
          const s = theirs.pos === 'atk' ? ctx.atk(theirs) : ctx.def(theirs);
          return ctx.atk(mine) <= s && ctx.atk(mine) + gain > s ? 75 : 0;
        },
      },
    },
  ],
});

S('De-Synchro', 'normal', {
  text: 'Select 1 face-up Synchro Monster on the field and return it to the Extra Deck. Then, if all of the Synchro Material Monsters used for that Synchro Summon are in your Graveyard, you can Special Summon them.',
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck', 'specialSummon'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => c.hasType('synchro') && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => c.hasType('synchro')), 1, 1, 'Target 1 face-up Synchro Monster on the field.', 'toDeck', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -2000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c) && c.hasType('synchro'))[0];
        if (!t) return;
        const mats = ((t.flags.materials ?? []) as { uid: number; card?: C }[]).map((m) => m.card ?? ctx.game.card(m.uid)).filter((c): c is C => !!c);
        await ctx.toDeck(t);
        await summonMaterials(ctx, mats);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('opp', (c) => c.hasType('synchro')).length ? 60 : 0) },
    },
  ],
});

const lightwavePatched = new WeakSet<C>();
S('Lightwave Tuning', 'normal', {
  text: 'Select 1 Level 4 LIGHT monster you control. It is treated as a Tuner monster while it is face-up on the field.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.level(c) === 4 && attrIs(c, 'LIGHT') && !c.isTuner && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => ctx.level(c) === 4 && attrIs(c, 'LIGHT') && !c.isTuner), 1, 1, 'Target 1 Level 4 LIGHT monster you control.', 'buff');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (!t) return;
        t.flags.tdgsLightwave = true;
        // APPROX: Tuner status through a per-instance data override while it stays face-up on the field.
        if (!lightwavePatched.has(t)) {
          lightwavePatched.add(t);
          patchData(t, (orig, c) =>
            faceUpOn(c) && c.flags.tdgsLightwave && !(orig.mtypes ?? []).includes('tuner') ? variant(orig, 'tuner', { mtypes: [...(orig.mtypes ?? []), 'tuner'] }) : undefined,
          );
        }
        ctx.log(`${t.name} is treated as a Tuner monster.`);
        ctx.game.update();
      },
      ai: {
        score: (ctx) => {
          if (!myOpenMain(ctx)) return 0;
          const lights = ctx.faceUpMonsters('me', (c) => ctx.level(c) === 4 && attrIs(c, 'LIGHT') && !c.isTuner);
          const others = ctx.faceUpMonsters('me', (c) => !c.isTuner).length;
          return lights.length && others >= 2 && ctx.extra('me', (s) => s.hasType('synchro')).length ? 35 : 0;
        },
      },
    },
  ],
});

S('Psi-Station', 'continuous', {
  text: 'Each time a Psychic-Type monster is Normal Summoned, you can pay 500 Life Points to increase its Level by 1 and its ATK by 300.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (myOpenMain(ctx) && ctx.cards('me', ['hand', 'mzone'], isPsychic).length >= 2 ? 15 : 0) } },
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Pay 500: Level +1, ATK +300',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => !!evc(ev) && isPsychic(evc(ev)!) && faceUpOn(evc(ev)!) && stActive(ctx),
      canActivate: (ctx) => ctx.lp > 500,
      activate: async (ctx) => {
        ctx.data.m = evc(ctx.event!);
        ctx.data.mid = (ctx.data.m as C).moveId;
        await ctx.payLp(500);
      },
      resolve: async (ctx) => {
        const m = ctx.data.m as C;
        if (!faceUpOn(m) || m.moveId !== ctx.data.mid) return;
        ctx.addTempMod(m, 'level', 1, 'field');
        ctx.addTempMod(m, 'atk', 300, 'field');
      },
      ai: { score: (ctx) => (ctx.event && evc(ctx.event)?.controller === ctx.player && ctx.lp > 2500 ? 1 : 0) },
    },
  ],
});

S('Psi-Impulse', 'normal', {
  text: "Tribute 1 Psychic-Type monster. Your opponent returns all cards in their hand to the Deck and shuffles it. Then, they draw 3 cards.",
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck'],
      // https://edisonrul.ing/cards/p/psi-impulse.html — cannot be activated if the opponent has fewer than 3 cards in the
      // Deck or no cards in the hand; if their hand is empty when it resolves, the effect disappears.
      canActivate: (ctx) => tributable(ctx, isPsychic).length > 0 && ctx.hand('opp').length > 0 && ctx.deck('opp').length >= 3,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, isPsychic), 1, 1, 'Tribute 1 Psychic-Type monster.', 'tribute', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        await ctx.toDeck(hand, 'shuffle');
        await ctx.draw(3, ctx.opp);
      },
      ai: { score: (ctx) => (myOpenMain(ctx) && ctx.hand('opp').length >= 5 && tributable(ctx, (c) => isPsychic(c) && cardValue(ctx.game, c) < 1200).length ? 30 : 0) },
    },
  ],
});

S('Sword of Kusanagi', 'equip', {
  text: 'Equip only to a Spirit monster. If the equipped monster attacks a Defense Position monster, inflict piercing battle damage to your opponent. When the equipped monster you control is returned to the hand and this card is sent to the Graveyard, return this card to your hand.',
  effects: [
    spiritEquipActivate((ctx) => (myOpenMain(ctx) && ctx.phase === 'main1' && ctx.faceUpMonsters('me', isSpirit).length ? 30 : 0)),
    { kind: 'continuous', mods: [{ q: 'piercing', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget }] },
    ...spiritEquipReturn(),
  ],
});

S('Orb of Yasaka', 'equip', {
  text: "Equip only to a Spirit monster. When it destroys an opponent's monster by battle and sends it to the Graveyard, gain Life Points equal to that monster's original ATK. When the equipped monster you control is returned to the hand and this card is sent to the Graveyard, return this card to your hand.",
  effects: [
    spiritEquipActivate((ctx) => (myOpenMain(ctx) && ctx.phase === 'main1' && ctx.faceUpMonsters('me', isSpirit).length ? 28 : 0)),
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: "Gain LP equal to the destroyed monster's ATK",
      categories: ['recover'],
      eventFilter: (ctx, ev) => {
        const o = evo(ev);
        const v = evc(ev);
        return !!o && !!v && stActive(ctx) && o.uid === ctx.self.equippedTo && v.location === 'grave' && ev.fromController !== o.controller;
      },
      activate: async (ctx) => {
        ctx.data.lp = evc(ctx.event!)!.data.atk ?? 0;
      },
      resolve: async (ctx) => {
        await ctx.recover(ctx.player, ctx.data.lp ?? 0);
      },
    },
    ...spiritEquipReturn(),
  ],
});

S(MIRROR_YATA, 'equip', {
  text: 'Equip only to a Spirit monster. The equipped monster does not have to have its effect that returns it to the hand activated. If it would be destroyed by battle, destroy this card instead.',
  effects: [
    spiritEquipActivate((ctx) => (myOpenMain(ctx) && ctx.faceUpMonsters('me', isSpirit).length ? 32 : 0)),
    {
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card, reason) => {
        if (reason !== 'battle' || card !== ctx.equipTarget || !ctx.self.onField) return false;
        ctx.log(`${ctx.self.name} is destroyed instead of ${card.name}.`);
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        return true;
      },
    },
  ],
});

/** Return-to-hand clause of the Spirit equips: remembers the host when it goes back to the hand. */
function spiritEquipReturn(): EffectDef[] {
  return [
    {
      kind: 'trigger',
      event: 'returnedToHand',
      label: '(equipped monster returned)',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && ctx.self.onField && ctx.self.equippedTo === c.uid && ev.fromController === ctx.self.controller) spiritHostBack.set(ctx.self, ctx.self.moveId + 1);
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Return this card to the hand',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && spiritHostBack.get(ctx.self) === ctx.self.moveId,
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toHand(ctx.self);
      },
    },
  ];
}
const spiritHostBack = new WeakMap<C, number>();

S(GEARTOWN, 'field', {
  text: 'Both players can Tribute Summon "Ancient Gear" monsters with 1 less Tribute than required. When this card is destroyed and sent to the Graveyard, you can Special Summon 1 "Ancient Gear" monster from your hand, Deck, or Graveyard.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'deck'], isAncientGear).length >= 2 ? 30 : 5) } },
    {
      kind: 'trigger',
      event: 'destroyed',
      when: true,
      label: 'Special Summon an "Ancient Gear" monster',
      categories: ['specialSummon'],
      // https://edisonrul.ing/cards/g/geartown.html — it activates when this card is destroyed and sent to the GY face-up
      // or face-down, or from the hand; not when its controller replaced it by activating a new Field Spell.
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self &&
        (ev.from === 'fzone' || ev.from === 'hand') &&
        ctx.self.location === 'grave' &&
        !(ev.reason === 'rule' && ev.reasonPlayer === ctx.player),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'deck', 'grave'], (c) => isAncientGear(c) && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['hand', 'deck', 'grave'], (c) => isAncientGear(c) && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 "Ancient Gear" monster from your hand, Deck, or Graveyard.', 'specialSummon', {
          aiScore: (x) => x.data.atk ?? 0,
        });
        const fromDeck = c?.location === 'deck';
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

// APPROX: an effect that pays a cost and then Special Summons a low-ATK monster under Power Filter still pays the cost.
S(POWER_FILTER, 'continuous', {
  text: 'Monsters with 1000 or less ATK cannot be Special Summoned.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      canActivate: (ctx) => {
        ensureTdgsPatches(ctx.game);
        return true;
      },
      ai: { score: (ctx) => (myOpenMain(ctx) && ctx.cards('me', ['hand', 'deck', 'extra'], (c) => c.isMonster && lowAtk(c)).length <= 4 ? 18 : 0) },
    },
  ],
});

S('Unstable Evolution', 'equip', {
  text: "While your Life Points are lower than your opponent's, the equipped monster's original ATK becomes 2400. While your Life Points are higher than your opponent's, the equipped monster's original ATK becomes 1000.",
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const lower = ctx.lp < ctx.oppLp;
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to equip.', 'equip', {
          aiScore: (c) => (lower ? (c.controller === ctx.player ? 2400 - (c.data.atk ?? 0) : -5000) : c.controller === ctx.opp ? (c.data.atk ?? 0) - 1000 : -5000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (t && ctx.self.onField) ctx.equip(t);
      },
      ai: {
        score: (ctx) => {
          if (!myOpenMain(ctx)) return 0;
          if (ctx.lp < ctx.oppLp) return ctx.faceUpMonsters('me', (c) => (c.data.atk ?? 0) <= 1600).length ? 35 : 0;
          if (ctx.lp > ctx.oppLp) return ctx.faceUpMonsters('opp', (c) => (c.data.atk ?? 0) >= 2400).length ? 35 : 0;
          return 0;
        },
      },
    },
    {
      // APPROX: "original ATK becomes X" as the difference to the printed ATK.
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (ctx, c: C) => c === ctx.equipTarget,
          value: (ctx, c: C) => {
            const mine = ctx.lp;
            const theirs = ctx.oppLp;
            if (mine < theirs) return 2400 - ctx.game.baseAtk(c);
            if (mine > theirs) return 1000 - ctx.game.baseAtk(c);
            return 0;
          },
        },
      ],
    },
  ],
});

S('Recycling Batteries', 'normal', {
  text: 'Select 2 Thunder-Type monsters with 1500 or less ATK in your Graveyard, and add them to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.grave('me', (c) => raceIs(c, 'Thunder') && (c.data.atk ?? 0) <= 1500).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => raceIs(c, 'Thunder') && (c.data.atk ?? 0) <= 1500), 2, 2, 'Target 2 Thunder-Type monsters with 1500 or less ATK in your Graveyard.', 'toHand', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (c.data.atk ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
      ai: { score: (ctx) => (myOpenMain(ctx) ? 40 : 0) },
    },
  ],
});

S('Book of Eclipse', 'quickplay', {
  text: 'Change all face-up monsters on the field to face-down Defense Position. During the End Phase of this turn, change as many face-down Defense Position monsters your opponent controls as possible to face-up Defense Position, then your opponent draws cards equal to the number of monsters changed face-up by this effect.',
  effects: [
    {
      kind: 'activate',
      categories: ['position'],
      canActivate: (ctx) => ctx.faceUpMonsters('both').length > 0,
      resolve: async (ctx) => {
        for (const c of ctx.faceUpMonsters('both')) if (faceUpOn(c)) await ctx.changePos(c, 'def', false);
        const opp = ctx.opp;
        const g = ctx.game;
        ctx.later('end', async () => {
          const list = g.monsters(opp).filter((c) => !c.faceUp && c.pos === 'def');
          for (const c of list) await g.changePosition(c, 'def', true, ctx.player);
          if (list.length) await g.draw(opp, list.length, 'effect');
        });
      },
      ai: {
        score: (ctx) => {
          const theirs = ctx.faceUpMonsters('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const mine = ctx.faceUpMonsters('me').reduce((a, c) => a + cardValue(ctx.game, c), 0);
          // Best on the opponent's turn before an attack, or to clear the way for our own attack.
          if (ctx.battle && ctx.battle.attacker.controller === ctx.opp && !ctx.battle.inDamageStep) return theirs > mine + 1500 ? 45 : 0;
          return 0;
        },
      },
    },
  ],
});

S(CHARGING_CELL, 'equip', {
  text: 'Equip only to a Psychic-Type monster. You do not have to pay Life Points to activate its effect(s). When the equipped monster is destroyed and this card is sent to the Graveyard, you can pay 1000 Life Points to return this card to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => {
        ensureTdgsPatches(ctx.game);
        return ctx.faceUpMonsters('both', (c) => isPsychic(c) && ctx.canTarget(c)).length > 0;
      },
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', isPsychic), 1, 1, 'Target 1 face-up Psychic-Type monster to equip.', 'equip', {
          aiScore: (c) => (c.controller === ctx.player ? cardValue(ctx.game, c) : -5000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c) && isPsychic(c))[0];
        if (t && ctx.self.onField) ctx.equip(t);
      },
      ai: { score: (ctx) => (myOpenMain(ctx) && ctx.faceUpMonsters('me', (c) => isPsychic(c) && (c.data.effects ?? []).some((e) => e.kind === 'ignition' || e.kind === 'quick')).length ? 30 : 0) },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '(equipped monster destroyed)',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && ctx.self.onField && ctx.self.equippedTo === c.uid) cellHostDestroyed.set(ctx.self, ctx.self.moveId + 1);
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Pay 1000: return this card to the hand',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && cellHostDestroyed.get(ctx.self) === ctx.self.moveId,
      canActivate: (ctx) => ctx.lp > 1000,
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toHand(ctx.self);
      },
      ai: { score: (ctx) => (ctx.lp > 4000 ? 1 : 0) },
    },
  ],
});
const cellHostDestroyed = new WeakMap<C, number>();

const trickyToken = token('Tricky Token', 'WIND', 'Spellcaster', 5, 2000, 1200, 'Tricky Token (Spellcaster-Type/WIND/Level 5/ATK 2000/DEF 1200). Cannot declare an attack.');
S('Tricky Spell 4', 'quickplay', {
  text: 'Send 1 face-up "The Tricky" you control to the Graveyard to Special Summon "Tricky Tokens" (Spellcaster-Type/WIND/Level 5/ATK 2000/DEF 1200) in Defense Position, equal to the number of monsters your opponent controls. "Tricky Tokens" cannot declare an attack.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => c.name === THE_TRICKY).length > 0 && ctx.monsters('opp').length > 0,
      activate: async (ctx) => {
        const [t] = await ctx.select(ctx.faceUpMonsters('me', (c) => c.name === THE_TRICKY), 1, 1, 'Send 1 face-up "The Tricky" you control to the Graveyard.', 'cost');
        if (!t) return false;
        await ctx.sendToGrave(t, 'cost');
      },
      resolve: async (ctx) => {
        const n = ctx.monsters('opp').length;
        if (!n || !ctx.canSpecialSummon()) return;
        const r = await ctx.createTokens(trickyToken, Math.min(n, ctx.freeMZones()), 'def');
        for (const t of r) ctx.addTempMod(t, 'cannotAttack', true, 'field');
      },
      ai: { score: (ctx) => (ctx.monsters('opp').length >= 2 && ctx.freeMZones() >= 1 && myOpenMain(ctx) ? 40 : 0) },
    },
  ],
});

// ============================================================ TRAPS

T('Equip Shot', 'normal', {
  text: 'Activate only during the Battle Phase. Select 1 Equip Card equipped to a face-up Attack Position monster you control, and select 1 face-up Attack Position monster your opponent controls. Equip that monster with the selected Equip Card. Then, conduct battle between your previously equipped monster and the selected monster (other effects cannot be activated during this battle).',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      condition: (ctx) => ctx.phase === 'battle' && !ctx.battle?.inDamageStep,
      canActivate: (ctx) => equipShotEquips(ctx).length > 0 && ctx.faceUpMonsters('opp', (c) => c.pos === 'atk' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const [eq] = await ctx.selectTargets(equipShotEquips(ctx), 1, 1, 'Select 1 Equip Card equipped to a face-up Attack Position monster you control.', 'target');
        const [foe] = await ctx.selectTargets(ctx.faceUpMonsters('opp', (c) => c.pos === 'atk'), 1, 1, 'Select 1 face-up Attack Position monster your opponent controls.', 'target', {
          aiScore: (c) => -ctx.atk(c),
        });
        if (!eq || !foe) return false;
        ctx.data.eq = eq;
        ctx.data.foe = foe;
        ctx.data.host = ctx.game.card(eq.equippedTo);
      },
      resolve: async (ctx) => {
        const eq = ctx.data.eq as C;
        const foe = ctx.data.foe as C;
        const host = ctx.data.host as C | undefined;
        const valid = ctx.validTargets();
        if (!valid.includes(eq) || !valid.includes(foe) || !eq.onField || !faceUpOn(foe) || foe.pos !== 'atk') return;
        ctx.game.equip(eq, foe);
        ctx.log(`${eq.name} is now equipped to ${foe.name}.`);
        await ctx.game.ruleCleanup();
        if (host && faceUpOn(host) && host.pos === 'atk' && host.controller === ctx.player && faceUpOn(foe)) await forcedBattle(ctx, host, foe);
      },
      ai: {
        score: (ctx) => {
          for (const eq of equipShotEquips(ctx)) {
            const host = ctx.game.card(eq.equippedTo)!;
            for (const foe of ctx.faceUpMonsters('opp', (c) => c.pos === 'atk')) if (ctx.atk(host) > ctx.atk(foe) + 500) return 40;
          }
          return 0;
        },
      },
    },
  ],
});
function equipShotEquips(ctx: Ctx): C[] {
  return ctx.spellTraps('both', (c) => {
    if (c.equippedTo == null || !c.faceUp) return false;
    const h = ctx.game.card(c.equippedTo);
    return !!h && faceUpOn(h) && h.pos === 'atk' && h.controller === ctx.player;
  });
}
/** APPROX (Equip Shot): a battle conducted by a card effect — damage calculation only, no Damage Step windows. */
async function forcedBattle(ctx: Ctx, a: C, t: C) {
  const g = ctx.game;
  const atkA = g.getAtk(a);
  const atkT = g.getAtk(t);
  ctx.log(`Battle: ${a.name} (${atkA}) vs ${t.name} (${atkT}).`);
  const losers: C[] = [];
  if (atkA > atkT) {
    losers.push(t);
    await g.damage(t.controller, atkA - atkT, 'battle', a, a.controller);
  } else if (atkT > atkA) {
    losers.push(a);
    await g.damage(a.controller, atkT - atkA, 'battle', t, t.controller);
  } else if (atkA > 0) losers.push(a, t);
  for (const l of losers) if (l.location === 'mzone') await g.destroy([l], 'battle', (l === a ? t : a).controller, l === a ? t : a, l === a ? t : a);
}

T('Graceful Revival', 'continuous', {
  text: 'Select 1 Level 2 or lower monster in your Graveyard, and Special Summon it in face-up Attack Position. When this card is removed from the field, destroy that monster. When that monster is destroyed, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c.isMonster && lvl(c) <= 2 && !c.isExtra && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && lvl(c) <= 2 && !c.isExtra && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 2 or lower monster in your Graveyard.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.isTuner ? 600 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.self.onField || !ctx.canSummonCard(t)) return;
        const r = await ctx.specialSummon(t, { pos: 'atk' });
        if (r.length) ctx.game.link(ctx.self, r[0]);
      },
      ai: {
        score: (ctx) => {
          if (ctx.isMyTurn && myOpenMain(ctx)) return ctx.grave('me', (c) => c.isTuner && lvl(c) <= 2).length && ctx.faceUpMonsters('me').length ? 40 : 25;
          return !ctx.isMyTurn && ctx.phase === 'end' && noChain(ctx) ? 30 : 0;
        },
      },
    },
  ],
});

T('Defense Draw', 'normal', {
  text: 'During your opponent\'s turn, at damage calculation: Make the battle damage you take from this battle 0, and if you do, draw 1 card.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['protect', 'draw'],
      // Not if you would take no battle damage, nor with an empty Deck: https://edisonrul.ing/cards/d/defense-draw.html
      condition: (ctx) =>
        !ctx.isMyTurn && !!ctx.battle && ctx.battle.inDamageStep && !ctx.battle.calc && !ctx.battle.negated && expectedBattleDamage(ctx.game, ctx.player) > 0 && ctx.deck('me').length > 0,
      resolve: async (ctx) => {
        ensureTdgsPatches(ctx.game);
        const b = ctx.battle as any;
        if (!b) return;
        (b.tdgsNoDamage ??= []).push(ctx.player);
        await ctx.draw(1);
      },
      ai: {
        score: (ctx) => {
          const dmg = expectedBattleDamage(ctx.game, ctx.player);
          if (dmg >= ctx.lp) return 95;
          return dmg >= 1000 ? 55 : 0;
        },
      },
    },
  ],
});

T('Remote Revenge', 'normal', {
  text: "Activate only when a monster you control is targeted by a Spell, Trap, or Effect Monster's effect that destroys 1 monster on the field. Switch the target to an appropriate monster your opponent controls.",
  effects: [
    {
      // APPROX: works on effects that read their target at resolution (validTargets); the new target must be a monster
      // your opponent controls that the effect could target.
      kind: 'activate',
      categories: ['protect'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        if (!l || l.negated) return false;
        const cats = l.effect.categories ?? [];
        const ts = l.ctx.targets;
        return cats.includes('destroy') && !cats.includes('destroyMulti') && ts.length === 1 && ts[0].location === 'mzone' && ts[0].controller === ctx.player;
      },
      canActivate: (ctx) => ctx.monsters('opp', (c) => remoteOk(ctx, c)).length > 0,
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        const l = ctx.data.link as ChainLink;
        if (!l || !ctx.game.chain.includes(l)) return;
        const cands = ctx.monsters('opp', (c) => remoteOk(ctx, c));
        const [t] = await ctx.select(cands, 1, 1, 'Select the new target (a monster your opponent controls).', 'target', { aiScore: (c) => cardValue(ctx.game, c) });
        if (!t) return;
        l.ctx.targets.length = 0;
        l.ctx.addTargets([t]);
        ctx.log(`The target of ${l.card.name} changes to ${t.faceUp ? t.name : 'a face-down monster'}.`);
      },
      ai: { score: (ctx) => (ctx.monsters('opp').length ? 70 : 0) },
    },
  ],
});
function remoteOk(ctx: Ctx, c: C) {
  const l = ctx.data.link ?? ctx.prevLink();
  const old = (l as ChainLink | undefined)?.ctx.targets[0];
  if (!l || !old) return false;
  if (old.faceUp && !c.faceUp) return false;
  return (l as ChainLink).ctx.canTarget(c);
}

T('Spacegate', 'continuous', {
  text: 'Each time a monster your opponent controls attacks or is attacked, place 1 Gate Counter on this card at the end of the Damage Step. During your Main Phase, you can send this card to the Graveyard to Special Summon 1 monster from your hand whose Level is less than or equal to the number of Gate Counters on this card.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      ai: { score: (ctx) => (!ctx.isMyTurn && noChain(ctx) ? 15 : 0) },
    },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      label: '(Gate Counter)',
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        const t = evo(ev);
        if (!stActive(ctx)) return false;
        const oppInvolved = (a && (a.controller === ctx.opp || ev.player === ctx.opp)) || (t && t.controller === ctx.opp);
        if (oppInvolved) {
          ctx.self.counters.gate = (ctx.self.counters.gate ?? 0) + 1;
          ctx.game.update();
        }
        return false;
      },
    },
    {
      kind: 'ignition',
      label: 'Send to GY: Special Summon from your hand',
      categories: ['specialSummon'],
      canActivate: (ctx) => {
        const n = ctx.self.counters.gate ?? 0;
        return ctx.canSpecialSummon() && ctx.hand('me', (c) => c.isMonster && lvl(c) <= n && ctx.canSummonCard(c)).length > 0;
      },
      activate: async (ctx) => {
        ctx.data.n = ctx.self.counters.gate ?? 0;
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => c.isMonster && lvl(c) <= (ctx.data.n ?? 0) && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 monster from your hand.', 'specialSummon', { aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0) });
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
      ai: { score: (ctx) => (ctx.hand('me', (c) => c.isMonster && lvl(c) <= (ctx.self.counters.gate ?? 0) && lvl(c) >= 5).length ? 50 : 0) },
    },
  ],
});

T('Synchro Deflector', 'normal', {
  text: 'Activate only when a face-up Synchro Monster you control is selected as an attack target. Negate the attack and destroy 1 monster your opponent controls.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack', 'destroy'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && faceUpOn(t) && t.controller === ctx.player && t.hasType('synchro');
      },
      resolve: async (ctx) => {
        if (ctx.battle) ctx.negateAttack();
        const [t] = await ctx.select(ctx.monsters('opp'), 1, 1, 'Destroy 1 monster your opponent controls.', 'destroy');
        if (t) await ctx.destroy(t);
      },
      ai: { score: () => 75 },
    },
  ],
});

T('Broken Blocker', 'normal', {
  text: 'Activate only when a Defense Position monster you control, whose DEF is higher than its ATK, is destroyed by battle. Special Summon up to 2 monsters with the same name as that monster from your Deck in face-up Defense Position.',
  effects: [
    {
      kind: 'activate',
      event: 'battleDestroyed',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        const calc = ctx.battle?.calc;
        return !!c && ev.fromController === ctx.player && !!calc && calc.targetPos === 'def' && ctx.battle?.target === c && calc.targetDef > g0(c.data.atk);
      },
      canActivate: (ctx) => {
        const c = evc(ctx.event!);
        return !!c && ctx.canSpecialSummon() && ctx.deck('me', (x) => x.name === c.name && ctx.canSummonCard(x)).length > 0;
      },
      activate: async (ctx) => {
        ctx.data.name = evc(ctx.event!)!.name;
      },
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (x) => x.name === ctx.data.name && ctx.canSummonCard(x));
        const max = Math.min(2, cands.length, ctx.freeMZones());
        if (max > 0) {
          const sel = await ctx.select(cands, 1, max, `Special Summon up to ${max} "${ctx.data.name}" from your Deck.`, 'specialSummon');
          if (sel.length) await ctx.specialSummon(sel, { pos: 'def' });
        }
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 60 },
    },
  ],
});
const g0 = (n: number | undefined) => n ?? 0;

T('Psychic Overload', 'normal', {
  text: 'Select 3 Psychic-Type monsters in your Graveyard and shuffle them into your Deck. Then, draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck', 'draw'],
      canActivate: (ctx) => ctx.grave('me', isPsychic).length >= 3,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', isPsychic), 3, 3, 'Target 3 Psychic-Type monsters in your Graveyard.', 'toDeck', { aiScore: (c) => -(c.data.aiValue ?? 0) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length < 3) return;
        await ctx.toDeck(t, 'shuffle');
        await ctx.draw(2);
      },
      ai: { score: (ctx) => (noChain(ctx) && (myOpenMain(ctx) || (!ctx.isMyTurn && ctx.phase === 'end')) ? 50 : 0) },
    },
  ],
});

T('Psychic Rejuvenation', 'normal', {
  text: 'Gain 1000 Life Points for each face-up Psychic-Type monster you control.',
  effects: [
    {
      kind: 'activate',
      categories: ['recover'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', isPsychic).length > 0,
      resolve: async (ctx) => {
        const n = ctx.faceUpMonsters('me', isPsychic).length;
        if (n) await ctx.recover(ctx.player, 1000 * n);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('me', isPsychic).length >= 2 || ctx.lp <= 2000 ? 40 : 0) },
    },
  ],
});

T('Telepathic Power', 'normal', {
  text: "Activate only when a Psychic-Type monster you control is destroyed by battle with an opponent's attacking monster and sent to the Graveyard. Destroy that opponent's monster and gain Life Points equal to its ATK.",
  effects: [
    {
      kind: 'activate',
      event: 'battleDestroyed',
      categories: ['destroy', 'recover'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        const o = evo(ev);
        return !!c && !!o && ev.fromController === ctx.player && c.location === 'grave' && isPsychic(c) && o.controller === ctx.opp && o.location === 'mzone' && ctx.battle?.attacker === o;
      },
      activate: async (ctx) => {
        const o = evo(ctx.event!)!;
        ctx.addTargets([o]);
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c))[0];
        if (!t) return;
        const atk = ctx.atk(t);
        const r = await ctx.destroy(t);
        if (r.length) await ctx.recover(ctx.player, atk);
      },
      ai: { score: () => 75 },
    },
  ],
});

T('Mind Over Matter', 'counter', {
  text: 'Tribute 1 Psychic-Type monster to negate the Summon of a monster, or the activation of a Spell or Trap Card, and destroy it.',
  effects: [
    {
      kind: 'activate',
      label: 'Negate Summon',
      negateSummon: true,
      categories: ['negateSummon'],
      condition: (ctx) => !!ctx.game.pendingSummon,
      canActivate: (ctx) => tributable(ctx, isPsychic).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, isPsychic), 1, 1, 'Tribute 1 Psychic-Type monster.', 'tribute', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        ctx.game.negatePendingSummon();
      },
      ai: {
        score: (ctx) => {
          const ps = ctx.game.pendingSummon;
          if (!ps || ps.player === ctx.player) return 0;
          const v = Math.max(0, ...ps.cards.map((c) => cardValue(ctx.game, c)));
          const fodder = Math.min(...tributable(ctx, isPsychic).map((c) => cardValue(ctx.game, c)));
          return v >= 2200 && v > fodder + 500 ? 60 : 0;
        },
      },
    },
    {
      kind: 'activate',
      label: 'Negate Spell/Trap',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.isCardActivation;
      },
      canActivate: (ctx) => tributable(ctx, isPsychic).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, isPsychic), 1, 1, 'Tribute 1 Psychic-Type monster.', 'tribute', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        ctx.data.link = ctx.prevLink();
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player === ctx.player) return 0;
          const cats = l.effect.categories ?? [];
          return cats.some((c) => ['destroyMulti', 'control', 'specialSummon', 'draw', 'search'].includes(c)) || l.ctx.targets.some((t) => t.controller === ctx.player) ? 60 : 0;
        },
      },
    },
  ],
});

T('Lightsworn Barrier', 'continuous', {
  text: 'When a "Lightsworn" monster you control is selected as an attack target, you can send the top 2 cards of your Deck to the Graveyard to negate the attack.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (!ctx.isMyTurn && noChain(ctx) && ctx.faceUpMonsters('me', (c) => c.inSet('lightsworn')).length ? 25 : 0) } },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      when: true,
      label: 'Send the top 2 cards: negate the attack',
      categories: ['negateAttack', 'mill'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && t.location === 'mzone' && t.controller === ctx.player && t.faceUp && t.inSet('lightsworn') && stActive(ctx);
      },
      canActivate: (ctx) => ctx.deck().length >= 2 && !!ctx.battle && !ctx.battle.negated,
      activate: async (ctx) => {
        await ctx.mill(2);
      },
      resolve: async (ctx) => {
        if (ctx.battle && !ctx.battle.negated) ctx.negateAttack();
      },
      ai: { score: (ctx) => (ctx.deck().length > 10 ? 1 : 0) },
    },
  ],
});

T('Intercept', 'counter', {
  text: 'Activate only when a monster is Tribute Summoned with 1 Tribute. Take control of that monster.',
  effects: [
    {
      kind: 'activate',
      event: 'tributeSummoned',
      categories: ['control'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && faceUpOn(c) && c.controller === ctx.opp && (ev.tributes?.length ?? 0) === 1;
      },
      canActivate: (ctx) => ctx.freeMZones() > 0,
      activate: async (ctx) => {
        ctx.addTargets([evc(ctx.event!)!]);
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.opp)[0];
        if (t) await ctx.takeControl(t, false);
      },
      ai: { score: () => 80 },
    },
  ],
});

T('Judgment of Thunder', 'normal', {
  text: 'Activate only when you Summon a Thunder-Type monster(s). Destroy 1 card your opponent controls.',
  effects: [
    {
      kind: 'activate',
      event: 'summoned',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && ev.player === ctx.player && c.controller === ctx.player && raceIs(c, 'Thunder');
      },
      canActivate: (ctx) => ctx.field('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('opp'), 1, 1, 'Target 1 card your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: () => 60 },
    },
  ],
});

T('Fish Depth Charge', 'normal', {
  text: 'Tribute 1 Fish-Type monster to destroy 1 card on the field. Then draw 1 card.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'draw'],
      canActivate: (ctx) => tributable(ctx, (c) => raceIs(c, 'Fish')).length > 0 && ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => raceIs(c, 'Fish')), 1, 1, 'Tribute 1 Fish-Type monster.', 'tribute', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, 1, 'Target 1 card on the field.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (!t.length) return;
        const r = await ctx.destroy(t);
        if (r.length) await ctx.draw(1);
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.field('opp'));
          const fodder = Math.min(...tributable(ctx, (c) => raceIs(c, 'Fish')).map((c) => cardValue(ctx.game, c)));
          return best && cardValue(ctx.game, best) >= fodder ? 45 : 0;
        },
      },
    },
  ],
});

T('Needlebug Nest', 'normal', {
  text: 'Send the top 5 cards of your Deck to the Graveyard.',
  effects: [
    {
      kind: 'activate',
      categories: ['mill'],
      canActivate: (ctx) => ctx.deck().length >= 5,
      resolve: async (ctx) => {
        await ctx.mill(5);
      },
      ai: { score: (ctx) => (ctx.deck().length > 20 && !ctx.isMyTurn && ctx.phase === 'end' && noChain(ctx) ? 35 : 0) },
    },
  ],
});

T('Overworked', 'normal', {
  text: 'Destroy all monsters whose current ATK is higher than their original ATK.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => overworkedList(ctx).length > 0,
      resolve: async (ctx) => {
        const list = overworkedList(ctx);
        if (list.length) await ctx.destroy(list);
      },
      ai: {
        score: (ctx) => {
          const l = overworkedList(ctx);
          const theirs = l.filter((c) => c.controller === ctx.opp).reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const mine = l.filter((c) => c.controller === ctx.player).reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return theirs > mine + 800 ? 55 : 0;
        },
      },
    },
  ],
});
const overworkedList = (ctx: Ctx) => ctx.faceUpMonsters('both', (c) => ctx.atk(c) > (c.data.atk ?? 0));

T('Kunai with Chain', 'normal', {
  text: "Activate 1 or both of these effects:\n● Change the attacking monster to Defense Position when your opponent's monster declares an attack.\n● Equip this card to a face-up monster you control. It gains 500 ATK.",
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      damageStep: false,
      label: 'Change the attacker to Defense Position',
      categories: ['position', 'negateAttack'],
      eventFilter: (ctx, ev) => ev.player === ctx.opp && !!evc(ev) && faceUpOn(evc(ev)!),
      condition: (ctx) => !!ctx.battle && faceUpOn(ctx.battle.attacker) && ctx.battle.attacker.pos === 'atk',
      activate: async (ctx) => {
        const a = ctx.battle!.attacker;
        if (ctx.canTarget(a)) ctx.addTargets([a]);
        ctx.data.attacker = a;
        const mine = ctx.faceUpMonsters('me', (c) => ctx.canTarget(c));
        if (mine.length && (await ctx.confirm('Also equip Kunai with Chain to a face-up monster you control (+500 ATK)?', true))) {
          const [m] = await ctx.selectTargets(mine, 1, 1, 'Target 1 face-up monster you control to equip.', 'equip', { aiScore: (c) => ctx.atk(c) });
          ctx.data.equip = m;
        }
      },
      resolve: async (ctx) => {
        const a = ctx.data.attacker as C;
        if (ctx.validTargets().includes(a) && faceUpOn(a) && a.pos === 'atk') await ctx.changePos(a, 'def', true);
        await kunaiEquip(ctx);
      },
      ai: { score: (ctx) => (ctx.battle && ctx.atk(ctx.battle.attacker) >= 1500 ? 55 : 0) },
    },
    {
      kind: 'activate',
      damageStep: true,
      label: 'Equip: +500 ATK',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const [m] = await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Target 1 face-up monster you control to equip.', 'equip', {
          aiScore: (c) => (ctx.battle && (ctx.battle.attacker === c || ctx.battle.target === c) ? 5000 : 0) + ctx.atk(c),
        });
        ctx.data.equip = m;
      },
      resolve: async (ctx) => {
        await kunaiEquip(ctx);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || !b.inDamageStep || b.calc) return 0;
          const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
          const theirs = mine === b.attacker ? b.target : b.attacker;
          if (!mine || !theirs || mine.controller !== ctx.player || !faceUpOn(theirs)) return 0;
          const s = theirs.pos === 'atk' ? ctx.atk(theirs) : ctx.def(theirs);
          return ctx.atk(mine) <= s && ctx.atk(mine) + 500 > s ? 70 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget, value: 500 }],
    },
  ],
});
async function kunaiEquip(ctx: Ctx) {
  const m = ctx.data.equip as C | undefined;
  if (!m || !ctx.validTargets().includes(m) || !faceUpOn(m) || m.controller !== ctx.player || !ctx.self.onField) return;
  ctx.self.flags.staysOnField = true;
  ctx.self.activeOnField = true;
  ctx.equip(m);
  ctx.log(`${ctx.self.name} is equipped to ${m.name}.`);
}

/** Trap of Darkness: the Normal Trap effects it can copy right now (with the event that makes each legal). */
function darknessCopies(ctx: Ctx): { card: C; ef: EffectDef; ev?: GameEvent }[] {
  const out: { card: C; ef: EffectDef; ev?: GameEvent }[] = [];
  for (const card of ctx.grave('me', (c) => c.isTrap && c.data.ttype === 'normal' && c.name !== TRAP_OF_DARKNESS)) {
    for (const ef of card.data.effects ?? []) {
      if (ef.kind !== 'activate' || ef.negateSummon) continue;
      if (ctx.battle?.inDamageStep && !ef.damageStep) continue;
      const c2 = new Ctx(ctx.game, ctx.self, ef, ctx.player);
      c2.link = ctx.link;
      let ev: GameEvent | undefined;
      try {
        if (ef.event) {
          const types = Array.isArray(ef.event) ? ef.event : [ef.event];
          const recent = ctx.game.recentEvents;
          for (let i = recent.length - 1; i >= 0 && !ev; i--) {
            const e = recent[i];
            if (!types.includes(e.type)) continue;
            c2.event = e;
            if (!ef.eventFilter || ef.eventFilter(c2, e)) ev = e;
          }
          if (!ev) continue;
          c2.event = ev;
        }
        if (ef.condition && !ef.condition(c2)) continue;
        if (ef.canActivate && !ef.canActivate(c2)) continue;
      } catch {
        continue;
      }
      out.push({ card, ef, ev });
      break;
    }
  }
  return out;
}
T(TRAP_OF_DARKNESS, 'normal', {
  text: 'Activate only when your Life Points are 3000 or less. Pay 1000 Life Points and select 1 Normal Trap Card in your Graveyard, except "Trap of Darkness". This card\'s effect becomes the same as that card\'s effect. Remove that card from play.',
  effects: [
    {
      // APPROX: the copied effect is checked against the events of the current window; it resolves as this card's effect.
      kind: 'activate',
      damageStep: true,
      // Cost: removes the copied Normal Trap from play from the GY (not payable under Necrovalley).
      gyBanishCost: true,
      categories: [],
      condition: (ctx) => ctx.lp <= 3000 && ctx.lp > 1000,
      canActivate: (ctx) => darknessCopies(ctx).length > 0,
      activate: async (ctx) => {
        const copies = darknessCopies(ctx);
        const [pick] = await ctx.selectTargets(
          copies.map((x) => x.card),
          1,
          1,
          'Select 1 Normal Trap Card in your Graveyard to copy.',
          'target',
          { aiScore: (c) => trapCopyScore(ctx, copies.find((x) => x.card === c)!) },
        );
        const copy = copies.find((x) => x.card === pick);
        if (!copy) return false;
        await ctx.payLp(1000);
        ctx.data.copy = copy.ef;
        if (copy.ev) ctx.event = copy.ev;
        ctx.log(`${ctx.self.name} copies the effect of ${copy.card.name}.`);
        await ctx.banish(copy.card, 'cost');
        ctx.targets.length = 0;
        if (copy.ef.activate) await copy.ef.activate(ctx);
      },
      resolve: async (ctx) => {
        const ef = ctx.data.copy as EffectDef | undefined;
        if (ef?.resolve) await ef.resolve(ctx);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...darknessCopies(ctx).map((x) => trapCopyScore(ctx, x)));
          return best;
        },
      },
    },
  ],
});
function trapCopyScore(ctx: Ctx, copy: { ef: EffectDef; ev?: GameEvent }) {
  const c2 = new Ctx(ctx.game, ctx.self, copy.ef, ctx.player);
  c2.event = copy.ev;
  try {
    if (copy.ef.ai?.score) return copy.ef.ai.score(c2);
  } catch {
    return 0;
  }
  const cats = copy.ef.categories ?? [];
  return cats.includes('destroyMulti') || cats.includes('negateAttack') ? 50 : 30;
}

T('The Selection', 'counter', {
  text: 'Pay 1000 Life Points. Negate the Summon of a monster that has the same Type as a monster on the field, and destroy it.',
  effects: [
    {
      kind: 'activate',
      negateSummon: true,
      categories: ['negateSummon'],
      condition: (ctx) => {
        const ps = ctx.game.pendingSummon;
        if (!ps || ctx.lp <= 1000) return false;
        const others = [...ctx.game.faceUpMonsters(0), ...ctx.game.faceUpMonsters(1)].filter((c) => !ps.cards.includes(c));
        return ps.cards.some((s) => others.some((o) => o.data.race === s.data.race));
      },
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        ctx.game.negatePendingSummon();
      },
      ai: {
        score: (ctx) => {
          const ps = ctx.game.pendingSummon;
          if (!ps || ps.player === ctx.player || ctx.lp < 3000) return 0;
          const v = Math.max(0, ...ps.cards.map((c) => cardValue(ctx.game, c)));
          return v >= 2200 ? 60 : 0;
        },
      },
    },
  ],
});

export const TDGS_LOADED = true;
