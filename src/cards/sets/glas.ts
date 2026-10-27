// Gladiator's Assault (GLAS, TCG November 2007): every card of the set that no other set file defines.
// Card text, type, Attribute, Level, ATK/DEF: YGOJSON v1 aggregate (github.com/iconmaster5326/YGOJSON), with the
// pre-errata (Edison-era) wording where it differs. Effects follow the 2010 TCG rulings as far as the engine allows.
// Approximations are marked "APPROX:".
//
// Already scripted elsewhere: Gladiator Beast Murmillo / Bestiari / Laquari / Hoplomus / Secutor / Heraklinos,
// Gladiator Beast's Respite, Test Tiger (gladiators.ts), Light-/Shadow-Imprisoning Mirror, Soul Taker.
//
// No engine change. Game rules the engine has no hook for are installed per game by `ensureGlasPatches`
// (the technique of lodt.ts / crms.ts):
//  * Special Summon legality: Cloudian - Ghost Fog (never), Gladiator Beast Alexander / Spartacus (only by the effect of
//    Dimacari / Hoplomus), Dragon Ice (only 1 face-up on the field). `Ctx.canSummonCard` is wrapped once so card
//    scripts do not offer those monsters;
//  * battle damage: Cloudian - Ghost Fog (none), Magical Reflect Slime (redirected), Energy-Absorbing Monolith
//    (effect damage becomes a gain); battle destruction: Defensive Tactics;
//  * Tributes: Cloudian - Nimbusman (any number of WATER monsters);
//  * activations: Ancient Gear Knight (no Spell/Trap Cards while it attacks);
//  * state sync on every Game.update: Superalloy Beast Raptinus (Gemini monsters are Effect Monsters),
//    "A" Cell Incubator (A-Counters removed by card effects);
//  * the normal draw: Soul Devouring Bamboo Sword (skip the Draw Phase); Battle Phase: An Unfortunate Report.
// Counters: Fog Counters live in `card.counters.fog` (as lodt.ts), A-Counters in `card.counters.A` (as crms.ts).
import { monster, normal, spell, token, trap } from '../define';
import { cardValue } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import { faceUpFlag } from '../../engine/card';
import { Ctx } from '../../engine/ctx';
import type { Game } from '../../engine/game';
import type { GameEvent, Location, PlayerId } from '../../engine/types';
import { fusionSummonEffect } from './spells';
import { QUESTION_ATK } from './sovr';

type C = CardInstance;

// ============================================================ names

const OCTAVIUS = 'Gladiator Beast Octavius';
const ALEXANDER = 'Gladiator Beast Alexander';
const SPARTACUS = 'Gladiator Beast Spartacus';
const DIMACARI = 'Gladiator Beast Dimacari';
const HOPLOMUS = 'Gladiator Beast Hoplomus';
const GAIODIAZ = 'Gladiator Beast Gaiodiaz';
const TORAX = 'Gladiator Beast Torax';
const BESTIARI = 'Gladiator Beast Bestiari';
const LAQUARI = 'Gladiator Beast Laquari';
const COLOSSEUM = 'Colosseum - Cage of the Gladiator Beasts';
const GHOST_FOG = 'Cloudian - Ghost Fog';
const NIMBUSMAN = 'Cloudian - Nimbusman';
const SMOKE_BALL = 'Cloudian - Smoke Ball';
const SLIME = 'Magical Reflect Slime';
const AG_KNIGHT = 'Ancient Gear Knight';
const RAPTINUS = 'Superalloy Beast Raptinus';
const INCUBATOR = '"A" Cell Incubator';
const DRAGON_ICE = 'Dragon Ice';
const CHAOS_NEOS = 'Elemental HERO Chaos Neos';
const DARK_GAIA = 'Evil HERO Dark Gaia';
const STEALTH_UNION = 'Super Vehicroid - Stealth Union';
const SDBS = 'Soul Devouring Bamboo Sword';

QUESTION_ATK.add(DARK_GAIA);

// ============================================================ shared helpers

const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const evc = (ev: GameEvent) => ev.card as C | undefined;
const evo = (ev: GameEvent) => ev.other as C | undefined;
const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
const lname = (c: C) => c.name.toLowerCase();
const namedCI = (n: string) => (c: C) => lname(c) === n.toLowerCase();
const isMain = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';
/** This Continuous/Field/Equip card is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);

const isGB = (c: C) => c.isMonster && (c.inSet('gladiator') || c.name.startsWith('Gladiator Beast'));
const isGBCard = (c: C) => c.inSet('gladiator') || c.name.startsWith('Gladiator Beast');
const isCloudian = (c: C) => c.isMonster && (c.inSet('cloudian') || c.name.startsWith('Cloudian'));
const isSixSamurai = (c: C) => c.isMonster && (c.inSet('six-samurai') || c.name.includes('Six Samurai'));
const isRoid = (c: C) => c.isMonster && (c.inSet('roid') || /roid\b/i.test(c.name));
const isAlien = (c: C) => c.isMonster && (c.inSet('alien') || c.name.startsWith('Alien '));
const isGemini = (c: C) => c.isMonster && c.hasType('gemini');
/** A Gemini monster that is currently an Effect Monster. */
const geminiOn = (c: C) => isGemini(c) && faceUpOn(c) && !!c.flags.geminiSummoned;
const gemini = (ctx: Ctx) => geminiOn(ctx.self);
/** Normal Monster, or a Gemini monster where it is treated as one (GY / face-up and not Gemini Summoned). */
const isNormalLike = (c: C) =>
  c.isMonster && !c.isToken && (c.hasType('normal') || (isGemini(c) && (c.location === 'grave' || (faceUpOn(c) && !c.flags.geminiSummoned))));

/** Live (face-up, resolved, not negated) copies of a card on the field. */
function liveCards(g: Game, name: string, p?: PlayerId): C[] {
  return g
    .allFieldCards()
    .filter((c) => c.name === name && c.faceUp && (c.isMonster ? c.location === 'mzone' : c.activeOnField) && !g.isNegated(c) && (p === undefined || c.controller === p));
}

/** Events since the start of the current turn's Draw Phase. */
function turnEvents(g: Game): GameEvent[] {
  const log = g.eventLog;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'phaseStart' && e.phase === 'draw') return log.slice(i);
  }
  return log;
}

/** Tribute cards as a cost (not for a Tribute Summon). */
async function tributeCost(ctx: Ctx, cards: C[]) {
  if (!cards.length) return [];
  ctx.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`);
  return ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}

async function reveal(ctx: Ctx, cards: C[]) {
  if (!cards.length) return;
  for (const c of cards) c.revealedUntil = ctx.turn;
  ctx.log(`${ctx.game.players[ctx.player].name} reveals ${cards.map((c) => c.name).join(', ')}.`);
  await ctx.game.anim({ type: 'reveal', cards: cards.map((c) => c.uid), player: ctx.player });
}

/** Toss a coin: true = Heads. */
async function tossCoin(ctx: Ctx): Promise<boolean> {
  const heads = ctx.game.rng.next() < 0.5;
  ctx.log(`Coin toss: ${heads ? 'Heads' : 'Tails'}.`);
  await ctx.game.anim({ type: 'coin', player: ctx.player, result: heads ? 'H' : 'T', source: ctx.self.uid });
  return heads;
}

/** Discard `n` random cards from player p's hand. */
async function discardRandom(ctx: Ctx, p: PlayerId, n = 1) {
  const hand = [...ctx.game.players[p].hand];
  const picked: C[] = [];
  for (let i = 0; i < n && hand.length; i++) picked.push(hand.splice(ctx.game.rng.int(hand.length), 1)[0]);
  if (picked.length) {
    ctx.log(`${ctx.game.players[p].name} discards ${picked.map((c) => c.name).join(', ')} at random.`);
    await ctx.discard(picked);
  }
}

/** Put a monster into the Spell & Trap Zone of `controller` as an Equip Card for `host`. */
function equipMonster(g: Game, card: C, host: C, controller: PlayerId) {
  if (g.freeSZones(controller) <= 0) return false;
  g.rawMove(card, 'szone', { controller, faceUp: true });
  g.equip(card, host);
  g.update();
  return true;
}

/** Simple equip-spell activation: target 1 face-up monster passing `filter`. */
function equipSpell(filter: (ctx: Ctx, c: C) => boolean, score: (ctx: Ctx) => number): EffectDef {
  const cands = (ctx: Ctx) => ctx.faceUpMonsters('both', (c) => filter(ctx, c));
  return {
    kind: 'activate',
    categories: ['atkChange'],
    canActivate: (ctx) => cands(ctx).some((c) => ctx.canTarget(c)),
    activate: async (ctx) => {
      await ctx.selectTargets(cands(ctx), 1, 1, 'Target 1 face-up monster to equip this card to.', 'equip', {
        aiScore: (c) => (c.controller === ctx.player ? ctx.atk(c) + (c.data.aiValue ?? 0) + 1000 : -10000),
      });
    },
    resolve: async (ctx) => {
      const t = ctx.validTargets((c) => faceUpOn(c) && filter(ctx, c));
      if (!t.length || !ctx.self.onField || !ctx.self.faceUp) return;
      ctx.equip(t[0]);
    },
    ai: { score },
  };
}
const equippedTo = (ctx: Ctx, c: C) => c === ctx.equipTarget;
const ownEquipScore = (ctx: Ctx, filter: (c: C) => boolean, base = 34) =>
  isMain(ctx) && ctx.faceUpMonsters('me', filter).length ? (ctx.phase === 'main1' ? base : base / 2) : 0;

// ---------------------------------------------------------------- Fog Counters

const fog = (c: C) => c.counters.fog ?? 0;
function addFog(g: Game, c: C, n = 1) {
  if (!faceUpOn(c) || n <= 0) return;
  c.counters.fog = fog(c) + n;
  g.log(`${n} Fog Counter(s) placed on ${c.name}.`, 'action', c.controller);
  g.update();
}
const fogOnField = (g: Game) => g.allFieldCards().reduce((a, c) => a + fog(c), 0);

/** Remove `n` Fog Counters from anywhere on the field (cost). */
async function removeFogAnywhere(ctx: Ctx, n: number) {
  if (fogOnField(ctx.game) < n) return false;
  for (let i = 0; i < n; i++) {
    const holders = ctx.game.allFieldCards().filter((c) => fog(c) > 0);
    const [h] = await ctx.select(holders, 1, 1, `Remove a Fog Counter (${i + 1}/${n}).`, 'cost', {
      aiScore: (c) => (c.controller === ctx.player ? 0 : 100) + fog(c),
    });
    if (!h) return false;
    h.counters.fog = fog(h) - 1;
  }
  ctx.game.update();
  return true;
}

/** Cloudians: "If this card is in face-up Defense Position, destroy it." (APPROX: uses the chain, as lodt.ts). */
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
const cloudianBody = (): EffectDef[] => [{ kind: 'continuous', mods: [{ q: 'indestructibleBattle' }] }, cloudianSelfDestroy()];
/** "If this card is Normal Summoned: Place 1 Fog Counter on it for each "Cloudian" monster on the field." */
const cloudianNsFog: EffectDef = {
  kind: 'trigger',
  event: 'normalSummoned',
  mandatory: true,
  label: 'Fog Counters',
  eventFilter: (ctx, ev) => ev.card === ctx.self,
  resolve: async (ctx) => {
    if (!faceUpOn(ctx.self)) return;
    addFog(ctx.game, ctx.self, ctx.faceUpMonsters('both', isCloudian).length);
  },
};
/** Cloudians are summoned in Attack Position by the AI (Defense Position destroys them). */
const cloudianPos = (ctx: Ctx, c: C): 'atk' | 'choose' => (isCloudian(c) && !ctx.game.controllers[ctx.player].isHuman ? 'atk' : 'choose');

// ---------------------------------------------------------------- A-Counters

const aCount = (c: C) => c.counters.A ?? 0;
/** "If a monster with an A-Counter battles an "Alien" monster, it loses 300 ATK and DEF for each A-Counter during damage calculation only." */
const alienBattleRule: EffectDef = {
  kind: 'continuous',
  mods: (['atk', 'def'] as const).map((q) => ({
    q,
    to: 'cards' as const,
    filter: (ctx: Ctx, c: C) => {
      const b = ctx.battle;
      if (!b || !b.inDamageStep || aCount(c) <= 0) return false;
      return (b.attacker === ctx.self && b.target === c) || (b.target === ctx.self && b.attacker === c);
    },
    value: (_ctx: Ctx, c: C) => -300 * aCount(c),
  })),
};
const A_RULE = '(If a monster with an A-Counter battles an "Alien" monster, it loses 300 ATK and DEF for each A-Counter during damage calculation only.)';

// ---------------------------------------------------------------- Gemini

function makeGeminiActive(ctx: Ctx, c: C) {
  if (!faceUpOn(c) || !isGemini(c)) return;
  c.flags.geminiSummoned = true;
  delete c.flags.glasRapt;
  ctx.log(`${c.name} is now treated as an Effect Monster.`);
  ctx.game.update();
}
/** Gemini Summon: a Normal Summon of the face-up Gemini monster (Game.geminiSummon, no chain). */
function geminiSummon(score: (ctx: Ctx) => number = () => 40): EffectDef {
  return {
    // The Gemini Summon is a Normal Summon, not an effect (Game.geminiSummon; no chain).
    kind: 'proc',
    geminiSummon: true,
    range: ['mzone'],
    label: 'Gemini Summon (Normal Summon again)',
    categories: [],
    ai: {
      score: (ctx) => {
        const better = ctx.hand('me', (c) => c.isMonster && ctx.game.canNormalSummon(ctx.player, c) && (c.data.atk ?? 0) + (c.data.aiValue ?? 0) > 1900);
        if (ctx.phase === 'main1' && better.length) return 0;
        return score(ctx);
      },
    },
  };
}
const GEMINI_TEXT =
  'This card is treated as a Normal Monster while face-up on the field or in the Graveyard. While this card is face-up on the field, you can Normal Summon it to have it be treated as an Effect Monster with this effect:';

// ============================================================ per-game rule patches

interface GlasState {
  /** Players who skip their next Draw Phase (Soul Devouring Bamboo Sword). */
  skipDraw: Set<PlayerId>;
  /** An Unfortunate Report: player p conducts their next Battle Phase (not before turn `from`) twice. */
  report: { p: PlayerId; from: number }[];
  /** Defensive Tactics: `${turn}:${player}`. */
  defTac: Set<string>;
  /** "A" Cell Incubator: A-Counters on field cards at the last update (uid → moveId / count). */
  aSnap: Map<number, { moveId: number; a: number }>;
  syncing: boolean;
}
const GSTATE = new WeakMap<Game, GlasState>();
function gs(g: Game): GlasState {
  let s = GSTATE.get(g);
  if (!s) GSTATE.set(g, (s = { skipDraw: new Set(), report: [], defTac: new Set(), aSnap: new Map(), syncing: false }));
  return s;
}

/** Can `c` be Special Summoned (by `reason`) to `ctrl`'s field under this set's restrictions? */
function glasSummonForbidden(g: Game, c: C, reason: C | undefined): boolean {
  if (!c.isMonster) return false;
  if (c.name === GHOST_FOG) return true;
  if (c.name === ALEXANDER && reason?.name !== DIMACARI) return true;
  if (c.name === SPARTACUS && reason?.name !== HOPLOMUS) return true;
  if (c.name === DRAGON_ICE && g.allFieldCards().some((m) => m !== c && m.name === DRAGON_ICE && faceUpOn(m))) return true;
  return false;
}

// Card scripts check Ctx.canSummonCard before offering a monster: keep these out of their candidate lists.
const origCanSummonCard = Ctx.prototype.canSummonCard;
Ctx.prototype.canSummonCard = function (this: Ctx, c: C, side: 'me' | 'opp' = 'me') {
  if (!origCanSummonCard.call(this, c, side)) return false;
  return !glasSummonForbidden(this.game, c, this.self);
};

/** Is `c` an active Gemini-Summoned copy of `name`? */
const activeGemini = (g: Game, c: C | null | undefined, name: string) => !!c && c.name === name && geminiOn(c) && !g.isNegated(c);

const PATCHED = new WeakSet<Game>();
export function ensureGlasPatches(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;
  const s = gs(g);

  // ---- Special Summon legality
  const origSS = g.specialSummon.bind(g);
  anyG.specialSummon = async (cards: C[], player: PlayerId, opts: Parameters<Game['specialSummon']>[2] = {}) => {
    const list = cards.filter((c) => !glasSummonForbidden(g, c, opts?.reasonCard));
    if (list.length < cards.length) g.log(`${cards.filter((c) => !list.includes(c)).map((c) => c.name).join(', ')} cannot be Special Summoned this way.`, 'info', player);
    if (!list.length) return [];
    return origSS(list, player, opts);
  };
  const origCanNS = g.canNormalSummon.bind(g);
  anyG.canNormalSummon = (p: PlayerId, card: C, set = false) => {
    if (!origCanNS(p, card, set)) return false;
    if (!set && card.name === DRAGON_ICE && g.allFieldCards().some((m) => m.name === DRAGON_ICE && faceUpOn(m))) return false;
    return true;
  };

  // ---- damage
  const origDamage = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: C, sourcePlayer?: PlayerId) => {
    if (kind === 'battle' && amount > 0 && g.battle) {
      const b = g.battle;
      const involved = [b.attacker, b.target].filter((c): c is C => !!c && c.location === 'mzone');
      if (involved.some((c) => c.name === GHOST_FOG && c.faceUp && !g.isNegated(c))) {
        g.log(`No battle damage is taken from battles involving ${GHOST_FOG}.`, 'battle', p);
        return 0;
      }
      if (!(b as any).glasSlime && involved.some((c) => c.controller === p && activeGemini(g, c, SLIME))) {
        g.log(`${SLIME} reflects the battle damage.`, 'battle', p);
        (b as any).glasSlime = true;
        try {
          return await origDamage(g.opp(p), amount, kind, source, p);
        } finally {
          (b as any).glasSlime = false;
        }
      }
    }
    if (kind === 'effect' && amount > 0) {
      const link = g.resolvingLink as any;
      if (link?.glasMonolith instanceof Set && link.glasMonolith.has(p)) {
        g.log(`Energy-Absorbing Monolith: ${g.players[p].name} gains the LP instead.`, 'action', p);
        await g.recover(p, Math.floor(amount));
        return 0;
      }
    }
    return origDamage(p, amount, kind, source, sourcePlayer);
  };
  const origCanDestroy = g.canDestroy.bind(g);
  anyG.canDestroy = (card: C, reason: any) => {
    if (reason === 'battle' && card.onField && s.defTac.has(`${g.turn}:${card.controller}`)) return false;
    return origCanDestroy(card, reason);
  };

  // ---- Tributes: Cloudian - Nimbusman
  const origNeed = g.tributesNeeded.bind(g);
  anyG.tributesNeeded = (card: C) => (card.name === NIMBUSMAN && card.flags.glasNimbus !== undefined ? (card.flags.glasNimbus as number) : origNeed(card));
  const origCands = g.tributeCandidates.bind(g) as (p: PlayerId, forCard?: C) => C[];
  anyG.tributeCandidates = (p: PlayerId, forCard?: C) => {
    const r = origCands(p, forCard);
    return forCard?.name === NIMBUSMAN && forCard.flags.glasNimbusWater ? r.filter((c) => c.data.attribute === 'WATER') : r;
  };
  const origNS = g.normalSummon.bind(g);
  anyG.normalSummon = async (p: PlayerId, card: C, set: boolean) => {
    try {
      if (card.name === NIMBUSMAN && !set) {
        const water = origCands(p, card).filter((c) => c.data.attribute === 'WATER');
        if (water.length >= 2) {
          const opts = ['Tribute 1 monster', ...water.slice(1).map((_, i) => `Tribute ${i + 2} WATER monsters`)];
          const i = await g.option(p, `Tribute Summon ${card.name}:`, opts, card, (k) => {
            // AI: Tribute WATER monsters that are worth less than the counters they give.
            const cheap = water.filter((c) => cardValue(g, c) < 1600 || c.isToken).length;
            return k === Math.max(0, cheap - 1) ? 2 : k === 0 ? 1 : 0;
          });
          if (i > 0) {
            card.flags.glasNimbus = i + 1;
            card.flags.glasNimbusWater = true;
          }
        }
      }
      return await origNS(p, card, set);
    } finally {
      if (card.location === 'hand') {
        delete card.flags.glasNimbus;
        delete card.flags.glasNimbusWater;
      }
    }
  };

  // ---- activations: Ancient Gear Knight
  const agkBlocks = (player: PlayerId, card: C, ef: EffectDef) => {
    const b = g.battle;
    if (!b || ef.kind !== 'activate' || !(card.isSpell || card.isTrap)) return false;
    return b.attacker.controller !== player && activeGemini(g, b.attacker, AG_KNIGHT) && b.attacker.moveId === b.attackerMoveId;
  };
  const origCAE = g.canActivateEffect.bind(g);
  anyG.canActivateEffect = (player: PlayerId, card: C, ef: EffectDef, idx: number, mode: any) => {
    if (agkBlocks(player, card, ef)) return null;
    return origCAE(player, card, ef, idx, mode);
  };

  // ---- state sync: Superalloy Beast Raptinus, "A" Cell Incubator
  const origUpdate = g.update.bind(g);
  anyG.update = () => {
    if (!s.syncing) {
      s.syncing = true;
      try {
        syncState(g, s);
      } finally {
        s.syncing = false;
      }
    }
    origUpdate();
  };

  // ---- the normal draw: Soul Devouring Bamboo Sword
  const origDraw = g.draw.bind(g);
  anyG.draw = async (p: PlayerId, n = 1, reason: any = 'draw') => {
    if (reason === 'draw' && g.phase === 'draw' && p === g.turnPlayer && s.skipDraw.has(p) && !g.turnData['glas:skipped']) {
      s.skipDraw.delete(p);
      g.turnData['glas:skipped'] = true;
      g.log(`${g.players[p].name} skips the Draw Phase (${SDBS}).`, 'action', p);
      return [];
    }
    return origDraw(p, n, reason);
  };

  // ---- An Unfortunate Report: the next Battle Phase is conducted twice
  const origBP = g.battlePhase.bind(g);
  anyG.battlePhase = async () => {
    const tp = g.turnPlayer;
    const i = s.report.findIndex((r) => r.p === tp && r.from <= g.turn);
    await origBP();
    if (i < 0 || g.over) return;
    s.report.splice(i, 1);
    if (g.turnData.skipMain2) return; // the player went straight to the End Phase
    g.log(`${g.players[tp].name} conducts another Battle Phase (An Unfortunate Report).`, 'phase', tp);
    for (const c of g.monsters(tp)) c.attacksThisTurn = 0; // APPROX: monsters may attack again in the second Battle Phase
    await origBP();
  };
}

// the Raptinus mark goes with the Gemini status when the monster is turned face-down
faceUpFlag('glasRapt');
function syncState(g: Game, s: GlasState) {
  // Superalloy Beast Raptinus: every Gemini monster on the field is an Effect Monster.
  // APPROX: mirrored on the shared `geminiSummoned` flag (marked glasRapt) that all Gemini scripts read.
  const rap = liveCards(g, RAPTINUS).length > 0;
  for (const c of [...g.monsters(0), ...g.monsters(1)]) {
    if (!c.faceUp || !isGemini(c)) continue;
    if (rap && !c.flags.geminiSummoned) {
      c.flags.geminiSummoned = true;
      c.flags.glasRapt = true;
    } else if (!rap && c.flags.glasRapt) {
      delete c.flags.geminiSummoned;
      delete c.flags.glasRapt;
    }
  }
  // "A" Cell Incubator: an A-Counter that disappears from a card that stayed on the field was removed by an effect.
  // APPROX: detected at the next Game.update, one counter per update in which a removal happened.
  const field = g.allFieldCards();
  let removed = false;
  for (const c of field) {
    const prev = s.aSnap.get(c.uid);
    if (prev && prev.moveId === c.moveId && aCount(c) < prev.a) removed = true;
  }
  if (removed) {
    for (const inc of liveCards(g, INCUBATOR)) {
      inc.counters.A = aCount(inc) + 1;
      g.log(`${INCUBATOR} gets an A-Counter.`, 'action', inc.controller);
    }
  }
  s.aSnap.clear();
  for (const c of field) {
    if (aCount(c) > 0) s.aSnap.set(c.uid, { moveId: c.moveId, a: aCount(c) });
    if (c.name === INCUBATOR) INCUBATOR_COUNT.set(c, { moveId: c.moveId, n: aCount(c) });
  }
}
const INCUBATOR_COUNT = new WeakMap<C, { moveId: number; n: number }>();

/** Installs the per-game patches at the first phase (from any location, never activates). */
const PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  eventFilter: (ctx) => {
    ensureGlasPatches(ctx.game);
    return false;
  },
};

type MonsterOpts = Parameters<typeof monster>[1];
type STOpts = Parameters<typeof spell>[2];
/** Define a card of this set (adds the patch installer). */
const M = (name: string, o: MonsterOpts) => monster(name, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });
const S = (name: string, t: Parameters<typeof spell>[1], o: STOpts) => spell(name, t, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });
const T = (name: string, t: Parameters<typeof trap>[1], o: STOpts) => trap(name, t, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });

// ============================================================ Gladiator Beasts

const GB = ['gladiator'];
/** The summon was performed by the effect of a "Gladiator Beast" monster. */
const byGB = (ev: GameEvent) => {
  const r = ev.reasonCard as C | undefined;
  return !!r && r.isMonster && r.inSet('gladiator');
};

/** AI: how much it wants to bring `c` out of the Deck right now. */
function gbTagScore(ctx: Ctx, c: C, by: C, already: C[] = []): number {
  if (glasSummonForbidden(ctx.game, c, by)) return -10000;
  const dup = already.some((a) => a.name === c.name) ? -400 : 0;
  const oppST = ctx.spellTraps('opp').length;
  const oppFaceDownST = ctx.spellTraps('opp', (x) => !x.faceUp).length;
  const oppFaceUp = ctx.faceUpMonsters('opp');
  switch (c.name) {
    case BESTIARI:
      return dup + (oppST ? 900 : 350);
    case 'Gladiator Beast Murmillo':
      return dup + (oppFaceUp.length ? 880 : 120);
    case 'Gladiator Beast Darius':
      return dup + (ctx.grave('me', isGB).length ? 720 : 300);
    case LAQUARI:
      return dup + 650;
    case OCTAVIUS:
      return dup + (oppFaceDownST ? 820 : 380);
    case ALEXANDER:
      return dup + 760;
    case SPARTACUS:
      return dup + 700 + (ctx.deck('me', isGBEquip).length ? 60 : 0);
    case DIMACARI:
      return dup + (oppFaceUp.length ? 520 : 600);
    case TORAX:
      return dup + 480;
    case 'Gladiator Beast Equeste':
      return dup + (ctx.grave('me', isGBCard).length ? 560 : 250);
    case HOPLOMUS:
      return dup + 300 + (ctx.deck('me', (x) => x.name === SPARTACUS).length ? 250 : 0);
    case 'Gladiator Beast Secutor':
      return dup + 200;
    default:
      return dup + (c.data.atk ?? 0) / 10;
  }
}

/** "At the end of the Battle Phase, if this card attacked or was attacked: return it to the (Extra) Deck; SS n GB from Deck". */
function tagOut(n = 1, excludeSelfName = true, exclude?: string): EffectDef {
  const cands = (ctx: Ctx, selfName: string) =>
    ctx.deck('me', (c) => isGB(c) && (!excludeSelfName || c.name !== selfName) && c.name !== exclude && !glasSummonForbidden(ctx.game, c, ctx.self));
  return {
    kind: 'trigger',
    event: 'battleEnd',
    label: n > 1 ? `Tag out (${n} Gladiator Beasts)` : 'Tag out',
    categories: ['specialSummon', 'toDeck'],
    eventFilter: (ctx) => faceUpOn(ctx.self) && ctx.self.attackedThisTurnOrWasAttacked,
    canActivate: (ctx) => !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') && ctx.freeMZones() + 1 >= n && cands(ctx, ctx.self.name).length >= n,
    activate: async (ctx) => {
      ctx.data.name = ctx.self.name;
      await ctx.toDeck(ctx.self, 'shuffle', 'cost');
    },
    resolve: async (ctx) => {
      const list = cands(ctx, ctx.data.name).filter((c) => ctx.canSummonCard(c));
      const k = Math.min(n, ctx.freeMZones(), list.length);
      if (k <= 0) return;
      const picked: C[] = [];
      for (let i = 0; i < k; i++) {
        const rest = list.filter((c) => !picked.includes(c));
        const sel = await ctx.select(rest, 1, 1, `Special Summon a "Gladiator Beast" from your Deck (${i + 1}/${k}).`, 'specialSummon', {
          aiScore: (c) => gbTagScore(ctx, c, ctx.self, picked),
        });
        if (!sel.length) break;
        picked.push(sel[0]);
      }
      if (picked.length) await ctx.specialSummon(picked);
      ctx.game.shuffleDeck(ctx.player);
    },
    ai: { score: (ctx) => (cands(ctx, ctx.self.name).some((c) => gbTagScore(ctx, c, ctx.self) > 0) ? 1 : 0) },
  };
}

/** Bookkeeping: remember that this card was Special Summoned by a Gladiator Beast effect (never builds a chain link). */
const markGB: EffectDef = {
  kind: 'trigger',
  event: 'specialSummoned',
  eventFilter: (ctx, ev) => {
    if (ev.card === ctx.self && byGB(ev) && ctx.self.location === 'mzone') ctx.self.flags.gbSummoned = true;
    return false;
  },
};
const isGBEquip = (c: C) => c.isSpell && c.data.stype === 'equip' && (c.inSet('gladiator') || c.name.startsWith("Gladiator Beast's"));

M(OCTAVIUS, {
  attribute: 'LIGHT',
  race: 'Winged Beast',
  level: 7,
  atk: 2500,
  def: 1200,
  sets: GB,
  aiValue: 500,
  text: 'When this card is Special Summoned by the effect of a "Gladiator Beast" monster, destroy 1 face-down Spell or Trap Card on the field. At the end of the Battle Phase, if this card attacked or was attacked, return it to the Deck or discard 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Destroy 1 face-down Spell/Trap',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && byGB(ev) && ctx.self.location === 'mzone',
      condition: (ctx) => ctx.spellTraps('both', (c) => !c.faceUp && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both', (c) => !c.faceUp), 1, 1, 'Target 1 face-down Spell or Trap Card.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField && !c.faceUp);
        if (t.length) await ctx.destroy(t);
      },
    },
    {
      kind: 'trigger',
      event: 'battleEnd',
      mandatory: true,
      label: 'Return to the Deck or discard 1 card',
      categories: ['toDeck', 'discard'],
      eventFilter: (ctx) => faceUpOn(ctx.self) && ctx.self.attackedThisTurnOrWasAttacked,
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        const hand = ctx.hand();
        let discard = false;
        if (hand.length) {
          const worst = Math.min(...hand.map((c) => cardValue(ctx.game, c)));
          discard = (await ctx.option('Gladiator Beast Octavius:', ['Return it to the Deck', 'Discard 1 card'], (i) => (i === 1 ? (worst < 1300 ? 2 : 0) : 1))) === 1;
        }
        if (discard) await ctx.discardFromHand(1, undefined, 'effect', ctx.player, 'Discard 1 card.');
        else await ctx.toDeck(ctx.self, 'shuffle');
      },
    },
  ],
});

M(ALEXANDER, {
  attribute: 'LIGHT',
  race: 'Beast',
  level: 6,
  atk: 2400,
  def: 600,
  sets: GB,
  aiValue: 600,
  text: `This card cannot be Special Summoned except by the effect of "${DIMACARI}". If this card was Special Summoned, it is unaffected by the effects of Spell Cards. At the end of the Battle Phase, if this card attacked or was attacked, you can return it to the Deck to Special Summon 1 "Gladiator Beast" monster from your Deck, except "${ALEXANDER}".`,
  effects: [{ kind: 'continuous', active: (ctx) => ctx.self.summonMethod === 'special', mods: [{ q: 'unaffectedBySpells' }] }, tagOut()],
});

M(SPARTACUS, {
  attribute: 'EARTH',
  race: 'Dinosaur',
  level: 5,
  atk: 2200,
  def: 1600,
  sets: GB,
  aiValue: 600,
  text: `This card cannot be Special Summoned except by the effect of "${HOPLOMUS}". When this card is Special Summoned, add 1 "Gladiator Beast" Equip Spell Card from your Deck to your hand. At the end of the Battle Phase, if this card attacked or was attacked, you can return it to the Deck to Special Summon 1 "Gladiator Beast" monster from your Deck, except "${SPARTACUS}".`,
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Add 1 "Gladiator Beast" Equip Spell',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', isGBEquip);
        if (!cands.length || ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck')) return;
        const sel = await ctx.select(cands, 1, 1, 'Add 1 "Gladiator Beast" Equip Spell Card to your hand.', 'toHand', {
          aiScore: (c) => (c.name === "Gladiator Beast's Battle Manica" ? 3 : c.name === "Gladiator Beast's Battle Gladius" ? 2 : 1),
        });
        if (sel.length) await ctx.toHand(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
    tagOut(),
  ],
});

M(DIMACARI, {
  attribute: 'EARTH',
  race: 'Beast',
  level: 4,
  atk: 1600,
  def: 1200,
  sets: GB,
  aiValue: 400,
  text: `If this card was Special Summoned by the effect of a "Gladiator Beast" monster, it can attack twice during each Battle Phase. At the end of the Battle Phase, if this card attacked or was attacked, you can return it to the Deck to Special Summon 1 "Gladiator Beast" monster from your Deck, except "${DIMACARI}".`,
  effects: [markGB, { kind: 'continuous', active: (ctx) => !!ctx.self.flags.gbSummoned, mods: [{ q: 'extraAttacks', value: 1 }] }, tagOut()],
});

M(TORAX, {
  attribute: 'WATER',
  race: 'Fish',
  level: 3,
  atk: 1400,
  def: 400,
  sets: GB,
  aiValue: 400,
  text: 'If this card was Special Summoned by the effect of a "Gladiator Beast" monster, at the end of any Battle Phase that this card attacked or was attacked, you can return it to the Deck to draw 1 card.',
  effects: [
    markGB,
    {
      kind: 'trigger',
      event: 'battleEnd',
      label: 'Return to the Deck: draw 1',
      categories: ['draw', 'toDeck'],
      eventFilter: (ctx) => faceUpOn(ctx.self) && !!ctx.self.flags.gbSummoned && ctx.self.attackedThisTurnOrWasAttacked,
      activate: async (ctx) => {
        await ctx.toDeck(ctx.self, 'shuffle', 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
      ai: { score: () => 1 },
    },
  ],
});

M('Test Ape', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 2,
  atk: 700,
  def: 300,
  aiValue: 400,
  text: 'When this card is destroyed by battle and sent to the Graveyard, you can Special Summon 1 Level 4 or lower "Gladiator Beast" monster from your Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Special Summon a Gladiator Beast',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => isGB(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => isGB(c) && (c.data.level ?? 0) <= 4 && ctx.canSummonCard(c));
        if (!cands.length) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower "Gladiator Beast" from your Deck.', 'specialSummon', {
          aiScore: (c) => gbTagScore(ctx, c, ctx.self),
        });
        if (sel.length) await ctx.specialSummon(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

/** Face-up Gladiator Beasts the player can return for a contact fusion. */
const fieldGBs = (ctx: Ctx) => ctx.faceUpMonsters('me', isGB);

M(GAIODIAZ, {
  attribute: 'DARK',
  race: 'Dinosaur',
  level: 7,
  atk: 2600,
  def: 1500,
  types: ['fusion'],
  sets: GB,
  aiValue: 600,
  text: `"${SPARTACUS}" + 1 "Gladiator Beast" monster\nThis card can only be Special Summoned from your Extra Deck, by returning the above cards you control to the Deck. (You do not use "Polymerization".) When this card destroys a monster by battle and sends it to the Graveyard, inflict damage to your opponent equal to the DEF of the destroyed monster. At the end of the Battle Phase, if this card attacked or was attacked, you can return it to the Extra Deck to Special Summon 2 "Gladiator Beast" monsters from your Deck, except "${SPARTACUS}".`,
  fusion: { materials: [(c) => c.name === SPARTACUS, isGB], noPoly: true, desc: `"${SPARTACUS}" + 1 "Gladiator Beast" monster` },
  effects: [
    {
      kind: 'proc',
      range: ['extra'],
      label: 'Contact Fusion',
      categories: ['specialSummon'],
      condition: (ctx) => {
        const f = fieldGBs(ctx);
        return f.some((b) => b.name === SPARTACUS) && f.length >= 2;
      },
      perform: async (ctx) => {
        const f = fieldGBs(ctx);
        const sp = await ctx.select(f.filter((c) => c.name === SPARTACUS), 1, 1, `Select "${SPARTACUS}" to return to the Deck.`, 'material');
        if (!sp.length) return false;
        const o = await ctx.select(f.filter((c) => c !== sp[0]), 1, 1, 'Select 1 other "Gladiator Beast" to return to the Deck.', 'material', {
          aiScore: (c) => -cardValue(ctx.game, c),
        });
        if (!o.length) return false;
        ctx.log(`${ctx.game.players[ctx.player].name} shuffles ${sp[0].name} and ${o[0].name} into the Deck.`);
        await ctx.toDeck([sp[0], o[0]], 'shuffle', 'material');
        return true;
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('opp').length || ctx.phase === 'main1' ? 60 : 0) },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Inflict damage equal to its DEF',
      categories: ['damage'],
      eventFilter: (ctx, ev) => evo(ev) === ctx.self && evc(ev)?.location === 'grave',
      resolve: async (ctx) => {
        const d = evc(ctx.event!);
        if (d) await ctx.damage(ctx.opp, d.data.def ?? 0);
      },
    },
    tagOut(2, false, SPARTACUS),
  ],
});

// ---------------------------------------------------------------- Gladiator Beast Spells / Traps

/** "When the equipped monster is returned from your side of the field to the Deck and this card is sent to the GY, return this card to your hand." */
const GB_EQUIP_RETURN = 'When the equipped monster is returned from your side of the field to the Deck and this card is sent to the Graveyard, return this card to your hand.';
const gbEquipReturn = new WeakMap<C, number>();
function gbEquipReturnEffects(): EffectDef[] {
  return [
    {
      // Bookkeeping: the equipped monster left for the Deck (this card is still attached when the event is emitted).
      kind: 'trigger',
      event: 'leftField',
      range: ['szone'],
      eventFilter: (ctx, ev) => {
        const host = evc(ev);
        if (host && ctx.self.equippedTo === host.uid && ev.fromController === ctx.self.controller && (ev.to === 'deck' || ev.to === 'extra')) {
          gbEquipReturn.set(ctx.self, ctx.self.moveId);
        }
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      range: ['grave'],
      mandatory: true,
      label: 'Return to hand',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && gbEquipReturn.get(ctx.self) === ctx.self.moveId - 1,
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toHand(ctx.self);
      },
    },
  ];
}
const gbEquipScore = (ctx: Ctx) => ownEquipScore(ctx, isGB, 36);

S("Gladiator Beast's Battle Halberd", 'equip', {
  text: `Equip only to a "Gladiator Beast" monster. When it attacks, destroy 1 Spell or Trap Card at the end of the Damage Step. ${GB_EQUIP_RETURN}`,
  effects: [
    equipSpell((_ctx, c) => isGB(c), gbEquipScore),
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Destroy 1 Spell/Trap',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => stActive(ctx) && !!ctx.equipTarget && evc(ev) === ctx.equipTarget,
      condition: (ctx) => ctx.spellTraps('both', (c) => c !== ctx.self).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.spellTraps('both', (c) => c !== ctx.self);
        if (!cands.length) return;
        const sel = await ctx.select(cands, 1, 1, 'Destroy 1 Spell or Trap Card.', 'destroy');
        if (sel.length) await ctx.destroy(sel);
      },
    },
    ...gbEquipReturnEffects(),
  ],
});

S("Gladiator Beast's Battle Gladius", 'equip', {
  text: `Equip only to a "Gladiator Beast" monster. It gains 300 ATK. ${GB_EQUIP_RETURN}`,
  effects: [
    equipSpell((_ctx, c) => isGB(c), gbEquipScore),
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: equippedTo, value: 300 }] },
    ...gbEquipReturnEffects(),
  ],
});

S("Gladiator Beast's Battle Manica", 'equip', {
  text: `Equip only to a "Gladiator Beast" monster. It cannot be destroyed by battle (Damage calculation is applied normally). ${GB_EQUIP_RETURN}`,
  effects: [
    equipSpell((_ctx, c) => isGB(c), gbEquipScore),
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle', to: 'cards', filter: equippedTo }] },
    ...gbEquipReturnEffects(),
  ],
});

S(COLOSSEUM, 'field', {
  text: `Place 1 Counter on this card each time a monster is Special Summoned from either player's Deck. All "Gladiator Beast" monsters gain 100 ATK and DEF for each of these counters on this card. If this card would be destroyed by a card effect, you can discard 1 "${COLOSSEUM}" to prevent this card from being destroyed.`,
  effects: [
    {
      kind: 'activate',
      categories: [],
      ai: { score: (ctx) => (ctx.spellTraps('me', (c) => c.name === COLOSSEUM && c.faceUp).length ? 0 : 40) },
    },
    {
      // Placing the Counter starts a Chain (2010 ruling): https://edisonrul.ing/cards/c/colosseum-cage-of-the-gladiator-beasts.html
      kind: 'trigger',
      event: 'specialSummoned',
      range: ['fzone'],
      mandatory: true,
      label: 'Place 1 Counter',
      categories: [],
      eventFilter: (ctx, ev) => ev.from === 'deck' && stActive(ctx),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'fzone' || !ctx.self.faceUp) return;
        ctx.self.counters.colosseum = (ctx.self.counters.colosseum ?? 0) + 1;
        ctx.game.update();
      },
    },
    {
      kind: 'continuous',
      mods: (['atk', 'def'] as const).map((q) => ({
        q,
        to: 'cards' as const,
        filter: (_ctx: Ctx, c: C) => isGB(c) && faceUpOn(c),
        value: (ctx: Ctx) => 100 * (ctx.self.counters.colosseum ?? 0),
      })),
    },
    {
      kind: 'continuous',
      range: ['fzone'],
      replaceDestroyOne: async (ctx, card, reason) => {
        if (card !== ctx.self || reason !== 'effect') return false;
        const spare = ctx.game.players[ctx.self.controller].hand.filter((c) => c.name === COLOSSEUM);
        if (!spare.length) return false;
        if (!(await ctx.game.confirm(ctx.self.controller, `Discard 1 "${COLOSSEUM}" to keep this card?`, ctx.self, true))) return false;
        await ctx.game.discard([spare[0]], 'effect', ctx.self.controller, ctx.self);
        ctx.game.log(`${ctx.self.name} is not destroyed.`, 'action', ctx.self.controller);
        return true;
      },
    },
  ],
});

S("Gladiator's Return", 'normal', {
  text: 'Select 3 "Gladiator Beast" cards in your Graveyard, and return them to the Deck. Then draw 1 card.',
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck', 'draw'],
      canActivate: (ctx) => ctx.grave('me', isGBCard).filter((c) => ctx.canTarget(c)).length >= 3,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', isGBCard), 3, 3, 'Target 3 "Gladiator Beast" cards in your GY.', 'toDeck', {
          aiScore: (c) => (c.isMonster ? 1000 : 500) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length < 3) return;
        await ctx.toDeck(t, 'shuffle');
        await ctx.draw(1);
      },
      ai: { score: () => 45 },
    },
  ],
});

/** "Return 1 Gladiator Beast card from your hand to the Deck" (cost of Disarm / Parry). */
function gbCounter(kind: 'spell' | 'trap'): EffectDef {
  return {
    kind: 'activate',
    categories: ['negate', 'destroy'],
    condition: (ctx) => {
      // "negate the activation of a Spell/Trap Card": only a card activation, not an effect of a face-up Spell/Trap.
      const l = ctx.prevLink();
      return !!l && !l.negated && l.isCardActivation && l.player !== ctx.player && (kind === 'spell' ? l.card.isSpell : l.card.isTrap);
    },
    // The "Gladiator Beast" monster is shown and returned to the Deck on resolution (not a cost); it cannot be activated
    // without one in hand: https://edisonrul.ing/cards/d/disarm.html, https://edisonrul.ing/cards/p/parry.html
    // UNSETTLED: if no "Gladiator Beast" monster is left in hand on resolution, the negation still applies here.
    canActivate: (ctx) => ctx.hand('me', (c) => c !== ctx.self && isGB(c)).length > 0,
    resolve: async (ctx) => {
      const gb = ctx.hand('me', (c) => c !== ctx.self && isGB(c));
      if (gb.length) {
        const [c] = await ctx.select(gb, 1, 1, 'Return 1 "Gladiator Beast" monster from your hand to the Deck.', 'toDeck');
        if (c) {
          c.revealedUntil = ctx.turn;
          await ctx.toDeck(c, 'shuffle');
        }
      }
      await ctx.negateAndDestroy(ctx.prevLink());
    },
    ai: {
      score: (ctx) => {
        const l = ctx.prevLink();
        if (!l || l.player !== ctx.opp) return 0;
        const cats = l.effect.categories ?? [];
        if (cats.some((c) => ['destroy', 'destroyMulti', 'banish', 'control', 'negate', 'specialSummon', 'draw', 'search', 'toHand'].includes(c))) return 68;
        return 30;
      },
    },
  };
}
T('Disarm', 'counter', {
  text: 'Return 1 "Gladiator Beast" card from your hand to the Deck, and negate the activation and effect of a Spell Card, and destroy it.',
  effects: [gbCounter('spell')],
});
T('Parry', 'counter', {
  text: 'Return 1 "Gladiator Beast" card from your hand to the Deck, and negate the activation and effect of a Trap Card, and destroy it.',
  effects: [gbCounter('trap')],
});

T('Defensive Tactics', 'normal', {
  text: 'Activate only while you control a face-up "Gladiator Beast" monster. Monsters you control cannot be destroyed by battle this turn, and the Battle Damage to your Life Points becomes 0. After this card resolves, put it on the bottom of your Deck instead of sending it to the Graveyard.',
  effects: [
    {
      kind: 'activate',
      categories: ['protect'],
      condition: (ctx) => ctx.faceUpMonsters('me', isGB).length > 0,
      resolve: async (ctx) => {
        gs(ctx.game).defTac.add(`${ctx.turn}:${ctx.player}`);
        ctx.addPlayerMod(ctx.player, 'noBattleDamage', true, 'turn');
        ctx.log('This turn, monsters you control cannot be destroyed by battle and you take no battle damage.');
        if (ctx.self.onField) await ctx.toDeck(ctx.self, 'bottom');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || b.attacker.controller !== ctx.opp) return 0;
          const t = b.target;
          const atk = ctx.atk(b.attacker);
          if (!t) return atk >= 1500 ? 45 : 0;
          if (t.controller !== ctx.player) return 0;
          return (t.pos === 'atk' ? ctx.atk(t) : ctx.def(t)) < atk ? 50 : 0;
        },
      },
    },
  ],
});

// ============================================================ Cloudians

normal(SMOKE_BALL, 'WATER', 'Fairy', 1, 200, 600, 'Smoke Balls are newly born Cloudians. They fear being alone, and would rather swing and sway in the sky with their friends.').sets = ['cloudian'];

const CLOUD = ['cloudian'];
const CL_TEXT = 'This card cannot be destroyed by battle. If this card is in face-up Defense Position, destroy it.';

M('Cloudian - Eye of the Typhoon', {
  attribute: 'WIND',
  race: 'Aqua',
  level: 8,
  atk: 3000,
  def: 1000,
  sets: CLOUD,
  aiValue: 600,
  text: `${CL_TEXT} When this card declares an attack, change the battle positions of all face-up monsters on the field, except "Cloudian" monsters.`,
  effects: [
    ...cloudianBody(),
    {
      kind: 'trigger',
      event: 'attackDeclared',
      mandatory: true,
      label: 'Change battle positions',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      resolve: async (ctx) => {
        for (const c of ctx.faceUpMonsters('both', (m) => !isCloudian(m))) {
          if (c.location === 'mzone' && c.faceUp) await ctx.changePos(c, c.pos === 'atk' ? 'def' : 'atk');
        }
      },
    },
  ],
});

M(GHOST_FOG, {
  attribute: 'WATER',
  race: 'Fiend',
  level: 1,
  atk: 0,
  def: 0,
  sets: CLOUD,
  aiValue: 300,
  text: 'This card cannot be Special Summoned. Neither player takes any Battle Damage from battles involving this card. When this card is destroyed by battle, place Fog Counters equal to the Level of the monster that destroyed it on face-up monsters in any way you like.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Distribute Fog Counters',
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      resolve: async (ctx) => {
        const by = evo(ctx.event!);
        const n = by ? (faceUpOn(by) ? ctx.level(by) : (by.data.level ?? 0)) : 0;
        for (let i = 0; i < n; i++) {
          const cands = ctx.faceUpMonsters('both');
          if (!cands.length) return;
          const [t] = await ctx.select(cands, 1, 1, `Place a Fog Counter on a face-up monster (${i + 1}/${n}).`, 'buff', {
            aiScore: (c) => (c.controller === ctx.player ? (isCloudian(c) ? 300 : 100) : 0) + (c.name === NIMBUSMAN ? 500 : 0),
          });
          if (t) addFog(ctx.game, t, 1);
        }
      },
    },
  ],
});

M(NIMBUSMAN, {
  attribute: 'WATER',
  race: 'Fairy',
  level: 5,
  atk: 1000,
  def: 1000,
  sets: CLOUD,
  aiValue: 400,
  text: `${CL_TEXT} You can Tribute any number of WATER monsters to Tribute Summon this card. Place 1 Fog Counter on this card for each WATER monster Tributed. This card gains 500 ATK for each Fog Counter on the field.`,
  effects: [
    ...cloudianBody(),
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      mandatory: true,
      label: 'Fog Counters',
      eventFilter: (ctx, ev) => ev.card === ctx.self && ((ctx.self.flags.tributedMonsters ?? []) as { attribute?: string }[]).some((t) => t.attribute === 'WATER'),
      resolve: async (ctx) => {
        const n = ((ctx.self.flags.tributedMonsters ?? []) as { attribute?: string }[]).filter((t) => t.attribute === 'WATER').length;
        if (faceUpOn(ctx.self)) addFog(ctx.game, ctx.self, n);
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 500 * fogOnField(ctx.game) }] },
  ],
});

const CLOUDIAN_TOKEN = token('Cloudian Token', 'WATER', 'Fairy', 1, 0, 0, 'This card cannot be Tributed for a Tribute Summon, except for the Tribute Summon of a "Cloudian" monster.');

M('Cloudian - Sheep Cloud', {
  attribute: 'WATER',
  race: 'Fairy',
  level: 1,
  atk: 0,
  def: 0,
  sets: CLOUD,
  aiValue: 400,
  text: 'When this card is destroyed by battle and sent to the Graveyard, Special Summon 2 "Cloudian Tokens" (Fairy-Type/WATER/Level 1/ATK 0/DEF 0) in Defense Position. These Tokens cannot be Tributed for a Tribute Summon, except for the Tribute Summon of a "Cloudian" monster.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Special Summon 2 Cloudian Tokens',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon()) return;
        const toks = await ctx.createTokens(CLOUDIAN_TOKEN, Math.min(2, ctx.freeMZones()), 'def');
        for (const t of toks) {
          t.flags.noTributeSummonFodder = true;
          t.flags.tributeFodderFor = (f: C) => isCloudian(f);
        }
      },
    },
  ],
});

M('Cloudian - Poison Cloud', {
  attribute: 'WATER',
  race: 'Fiend',
  level: 3,
  atk: 0,
  def: 1000,
  sets: CLOUD,
  aiValue: 400,
  text: 'When this card is destroyed by battle and sent to the Graveyard, if it was face-up at the start of the Damage Step, destroy the monster that destroyed it and inflict 800 damage to your opponent.',
  effects: [
    {
      // Bookkeeping: face-down when its battle started? (APPROX: checked at attack declaration)
      kind: 'trigger',
      event: 'attackDeclared',
      eventFilter: (ctx) => {
        const b = ctx.battle as any;
        if (b && b.target === ctx.self) b.glasPoisonFaceDown = !ctx.self.faceUp;
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Destroy the monster that destroyed it',
      categories: ['destroy', 'damage'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave' && !(ctx.battle as any)?.glasPoisonFaceDown,
      activate: async (ctx) => {
        const by = evo(ctx.event!);
        if (by) ctx.addTargets([by]);
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (!t.length) return;
        const r = await ctx.destroy(t);
        if (r.length) await ctx.damage(ctx.opp, 800);
      },
    },
  ],
});

/** Level 4 Cloudians with "remove Fog Counters: ..." Ignition effects. */
function cloudian4(name: string, atk: number, text: string, effect: EffectDef, aiValue = 300) {
  M(name, {
    attribute: 'WATER',
    race: 'Fairy',
    level: 4,
    atk,
    def: 0,
    sets: CLOUD,
    aiValue,
    text: `${CL_TEXT} When this card is Normal Summoned, place 1 Fog Counter on it for each "Cloudian" monster on the field. ${text}`,
    effects: [...cloudianBody(), cloudianNsFog, effect],
  });
}
const removeOwnFog = async (ctx: Ctx, n: number) => {
  ctx.self.counters.fog = fog(ctx.self) - n;
  ctx.game.update();
};

cloudian4('Cloudian - Acid Cloud', 500, 'You can remove 2 Fog Counters from this card to destroy 1 Spell or Trap Card on the field.', {
  kind: 'ignition',
  label: 'Remove 2 Fog Counters: destroy 1 Spell/Trap',
  categories: ['destroy'],
  canActivate: (ctx) => fog(ctx.self) >= 2 && ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
  activate: async (ctx) => {
    await removeOwnFog(ctx, 2);
    await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell or Trap Card to destroy.', 'destroy');
  },
  resolve: async (ctx) => {
    const t = ctx.validTargets((c) => c.onField);
    if (t.length) await ctx.destroy(t);
  },
  ai: { score: (ctx) => (ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length ? 55 : 0) },
});

cloudian4('Cloudian - Cirrostratus', 900, 'You can remove 2 Fog Counters from this card to destroy 1 monster on the field.', {
  kind: 'ignition',
  label: 'Remove 2 Fog Counters: destroy 1 monster',
  categories: ['destroy'],
  canActivate: (ctx) => fog(ctx.self) >= 2 && ctx.monsters('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
  activate: async (ctx) => {
    await removeOwnFog(ctx, 2);
    await ctx.selectTargets(ctx.monsters('both', (c) => c !== ctx.self), 1, 1, 'Target 1 monster to destroy.', 'destroy');
  },
  resolve: async (ctx) => {
    const t = ctx.validTargets((c) => c.location === 'mzone');
    if (t.length) await ctx.destroy(t);
  },
  ai: { score: (ctx) => (ctx.monsters('opp', (c) => ctx.canTarget(c)).length ? 60 : 0) },
});

cloudian4('Cloudian - Altus', 1300, 'You can remove 3 Fog Counters from anywhere on the field to discard 1 random card from your opponent\'s hand.', {
  kind: 'ignition',
  label: 'Remove 3 Fog Counters: random discard',
  categories: ['discard'],
  canActivate: (ctx) => fogOnField(ctx.game) >= 3 && ctx.hand('opp').length > 0,
  activate: async (ctx) => {
    if (!(await removeFogAnywhere(ctx, 3))) return false;
  },
  resolve: async (ctx) => {
    await discardRandom(ctx, ctx.opp, 1);
  },
  ai: { score: () => 45 },
});

cloudian4(
  'Cloudian - Turbulence',
  800,
  `You can remove 1 Fog Counter from this card to Special Summon 1 "${SMOKE_BALL}" from your hand, Deck, or Graveyard.`,
  {
    kind: 'ignition',
    label: `Remove 1 Fog Counter: Special Summon "${SMOKE_BALL}"`,
    categories: ['specialSummon'],
    // APPROX: YGOJSON (modern) text says "from your Deck or either GY"; the GLAS print allows hand, Deck or GY.
    canActivate: (ctx) => fog(ctx.self) >= 1 && ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'deck', 'grave'], (c) => c.name === SMOKE_BALL).length > 0,
    activate: async (ctx) => {
      await removeOwnFog(ctx, 1);
    },
    resolve: async (ctx) => {
      const cands = ctx.cards('me', ['hand', 'deck', 'grave'], (c) => c.name === SMOKE_BALL && ctx.canSummonCard(c));
      if (!cands.length) return;
      const sel = await ctx.select(cands, 1, 1, `Special Summon 1 "${SMOKE_BALL}".`, 'specialSummon', { aiScore: (c) => (c.location === 'deck' ? 3 : c.location === 'grave' ? 2 : 1) });
      const fromDeck = sel[0]?.location === 'deck';
      if (sel.length) await ctx.specialSummon(sel, { pos: 'atk' });
      if (fromDeck) ctx.game.shuffleDeck(ctx.player);
    },
    ai: { score: (ctx) => (ctx.freeMZones() > 1 ? 40 : 0) },
  },
);

S('Diamond-Dust Cyclone', 'quickplay', {
  text: 'Destroy 1 monster with 4 or more Fog Counters. Draw 1 card for every 4 Fog Counters that were on that monster.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'draw'],
      // Not with an empty Deck; a target flipped face-down in Chain is still destroyed, but its counters are gone so you
      // draw nothing: https://edisonrul.ing/cards/d/diamond-dust-cyclone.html
      canActivate: (ctx) => ctx.deck('me').length > 0 && ctx.monsters('both', (c) => fog(c) >= 4 && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both', (c) => fog(c) >= 4), 1, 1, 'Target 1 monster with 4 or more Fog Counters.', 'destroy', {
          aiScore: (c) => fog(c) * 100 + (c.controller === ctx.opp ? cardValue(ctx.game, c) : -cardValue(ctx.game, c) / 2),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'mzone');
        if (!t) return;
        const n = Math.floor(fog(t) / 4);
        const r = await ctx.destroy(t);
        if (r.length && n) await ctx.draw(n);
      },
      ai: { score: (ctx) => (ctx.monsters('both', (c) => fog(c) >= 4 && (c.controller === ctx.opp || fog(c) >= 8)).length ? 60 : 0) },
    },
  ],
});

S('Summon Cloud', 'continuous', {
  text: 'Once per turn, during your Main Phase, if you control no monsters, you can Special Summon 1 Level 4 or lower "Cloudian" monster from your hand or either player\'s Graveyard. When you Special Summon a monster from the Graveyard with this effect, destroy this card.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('both', ['hand', 'grave'], (c) => isCloudian(c) && (c.data.level ?? 0) <= 4).length ? 38 : 10) } },
    {
      kind: 'ignition',
      opt: true,
      label: 'Special Summon a Cloudian',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.monsters('me').length === 0,
      canActivate: (ctx) =>
        ctx.canSpecialSummon() && ctx.cards('me', 'hand', (c) => isCloudian(c) && (c.data.level ?? 0) <= 4).concat(ctx.grave('both', (c) => isCloudian(c) && (c.data.level ?? 0) <= 4)).some((c) => ctx.canSummonCard(c)),
      resolve: async (ctx) => {
        if (ctx.monsters('me').length) return;
        const cands = ctx.cards('me', 'hand', (c) => isCloudian(c) && (c.data.level ?? 0) <= 4).concat(ctx.grave('both', (c) => isCloudian(c) && (c.data.level ?? 0) <= 4)).filter((c) => ctx.canSummonCard(c));
        if (!cands.length) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower "Cloudian" monster.', 'specialSummon', {
          aiScore: (x) => (x.data.atk ?? 0) + (x.location === 'hand' ? 300 : 0),
        });
        if (!c) return;
        const fromGrave = c.location === 'grave';
        await ctx.specialSummon(c, { pos: cloudianPos(ctx, c) });
        if (fromGrave && ctx.self.onField) await ctx.destroy(ctx.self);
      },
      ai: { score: () => 55 },
    },
  ],
});

S('Lucky Cloud', 'normal', {
  text: 'During the End Phase of this turn, if you Summoned 2 or more "Cloudian" monsters with the same name this turn, draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      resolve: async (ctx) => {
        const g = ctx.game;
        const p = ctx.player;
        const turn = ctx.turn;
        g.addDelayed('end', async () => {
          if (g.turn !== turn) return;
          if (!sameNameCloudians(g, p)) return;
          g.log(`Lucky Cloud: ${g.players[p].name} draws 2 cards.`, 'action', p);
          await g.draw(p, 2, 'effect');
        });
      },
      ai: { score: (ctx) => (sameNameCloudians(ctx.game, ctx.player) ? 62 : 0) },
    },
  ],
});
/** Did player p Summon 2+ "Cloudian" monsters with the same name this turn? */
function sameNameCloudians(g: Game, p: PlayerId) {
  const n = new Map<string, number>();
  for (const e of turnEvents(g)) {
    const c = evc(e);
    if (e.type !== 'summoned' || e.player !== p || !c || !isCloudian(c)) continue;
    n.set(c.name, (n.get(c.name) ?? 0) + 1);
  }
  return [...n.values()].some((v) => v >= 2);
}

S('Fog Control', 'quickplay', {
  text: 'Tribute 1 face-up "Cloudian" monster you control. Place 3 Fog Counters on 1 face-up monster on the field.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isCloudian(c) && !ctx.query(c, 'cannotBeTributed')).length > 0 && ctx.faceUpMonsters('both').length > 1,
      activate: async (ctx) => {
        const [c] = await ctx.select(ctx.faceUpMonsters('me', (m) => isCloudian(m) && !ctx.query(m, 'cannotBeTributed')), 1, 1, 'Tribute 1 face-up "Cloudian" monster.', 'cost');
        if (!c) return false;
        await tributeCost(ctx, [c]);
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to place 3 Fog Counters on.', 'buff', {
          aiScore: (m) => (m.controller === ctx.player ? (m.name === NIMBUSMAN ? 1000 : isCloudian(m) ? 500 : 0) : 100),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets(faceUpOn);
        if (t) addFog(ctx.game, t, 3);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => c.name === NIMBUSMAN || c.name === 'Cloudian - Cirrostratus').length && ctx.faceUpMonsters('me', isCloudian).length >= 2 ? 40 : 0) },
    },
  ],
});

S('Cloudian Squall', 'continuous', {
  text: 'During each of your Standby Phases, place 1 Fog Counter on each face-up monster on the field.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isCloudian).length ? 40 : 0) } },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Fog Counters',
      // Activates (starts a Chain) each Standby Phase even with no face-up monster: https://edisonrul.ing/cards/c/cloudian-squall.html
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ev.player === ctx.player && stActive(ctx),
      resolve: async (ctx) => {
        for (const c of ctx.faceUpMonsters('both')) addFog(ctx.game, c, 1);
      },
    },
  ],
});

T('Natural Disaster', 'continuous', {
  text: 'Each time a card(s) your opponent controls is destroyed and sent to the Graveyard by the effect of a "Cloudian" monster, inflict 500 damage to your opponent.',
  effects: [
    { kind: 'activate', categories: ['damage'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isCloudian).length ? 30 : 0) } },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Inflict 500 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const r = ev.reasonCard as C | undefined;
        return stActive(ctx) && ev.fromController === ctx.opp && ev.to === 'grave' && !!r && isCloudian(r) && ev.reason !== 'battle';
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500);
      },
    },
  ],
});

T('Rain Storm', 'normal', {
  text: 'Select 1 "Cloudian" monster you control and reduce its ATK by exactly 1000 or 2000. Apply the appropriate effect.\n● 1000: Destroy 1 Spell or Trap Card your opponent controls.\n● 2000: Destroy 2 cards your opponent controls.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isCloudian(c) && ctx.atk(c) >= 1000).length > 0 && ctx.field('opp').length > 0,
      activate: async (ctx) => {
        const [t] = await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => isCloudian(c) && ctx.atk(c) >= 1000), 1, 1, 'Target 1 "Cloudian" monster you control.', 'buff', {
          aiScore: (c) => ctx.atk(c),
        });
        if (!t) return false;
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets(faceUpOn);
        if (!t || ctx.atk(t) < 1000) return;
        // https://edisonrul.ing/cards/r/rain-storm.html — you select which effect to apply when resolving it.
        const opts = ['Reduce by 1000 (destroy 1 Spell/Trap)'];
        if (ctx.atk(t) >= 2000) opts.push('Reduce by 2000 (destroy 2 cards)');
        const mode = opts.length > 1 ? await ctx.option('Rain Storm:', opts, (i) => (i === 1 && ctx.field('opp').length >= 2 ? 2 : i === 0 && ctx.spellTraps('opp').length ? 1 : 0)) : 0;
        const x = mode === 1 ? 2000 : 1000;
        ctx.addTempMod(t, 'atk', -x, 'field');
        if (x === 1000) {
          const st = ctx.spellTraps('opp');
          if (!st.length) return;
          const sel = await ctx.select(st, 1, 1, 'Destroy 1 Spell or Trap Card your opponent controls.', 'destroy');
          if (sel.length) await ctx.destroy(sel);
        } else {
          const f = ctx.field('opp');
          if (!f.length) return;
          const sel = await ctx.select(f, Math.min(2, f.length), 2, 'Destroy 2 cards your opponent controls.', 'destroy');
          if (sel.length) await ctx.destroy(sel);
        }
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp').length || ctx.field('opp').length >= 2 ? 50 : 0) },
    },
  ],
});

T('Updraft', 'normal', {
  text: 'Remove all Fog Counters on the field. Inflict 300 damage to your opponent for each Fog Counter removed.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      canActivate: (ctx) => fogOnField(ctx.game) > 0,
      resolve: async (ctx) => {
        let n = 0;
        for (const c of ctx.game.allFieldCards()) {
          n += fog(c);
          if (fog(c)) c.counters.fog = 0;
        }
        ctx.game.update();
        if (n) await ctx.damage(ctx.opp, 300 * n);
      },
      ai: {
        score: (ctx) => {
          const n = fogOnField(ctx.game);
          if (300 * n >= ctx.oppLp) return 90;
          const mine = ctx.monsters('me').reduce((a, c) => a + fog(c), 0);
          return n >= 5 && mine <= n / 2 ? 45 : 0;
        },
      },
    },
  ],
});

// ============================================================ "roid" monsters

M('Truckroid', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1000,
  def: 2000,
  sets: ['roid'],
  aiValue: 200,
  text: 'When this card destroys an opponent\'s monster by battle and sends it to the Graveyard, equip the destroyed monster to this card. This card gains ATK equal to the combined ATK of the monsters equipped to this card by this effect.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Equip the destroyed monster',
      eventFilter: (ctx, ev) => evo(ev) === ctx.self && faceUpOn(ctx.self) && ev.fromController === ctx.opp && evc(ev)?.location === 'grave',
      resolve: async (ctx) => {
        const d = evc(ctx.event!);
        if (!d || d.location !== 'grave' || !faceUpOn(ctx.self)) return;
        if (equipMonster(ctx.game, d, ctx.self, ctx.player)) {
          d.flags.glasEquipBy = ctx.self.uid;
          ctx.log(`${d.name} is equipped to ${ctx.self.name}.`);
        }
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) => ctx.game.equipsOf(ctx.self).filter((e) => e.isMonster && e.flags.glasEquipBy === ctx.self.uid).reduce((a, e) => a + (e.data.atk ?? 0), 0),
        },
      ],
    },
  ],
});

M('Stealthroid', {
  attribute: 'DARK',
  race: 'Machine',
  level: 4,
  atk: 1200,
  def: 0,
  sets: ['roid'],
  aiValue: 200,
  text: 'At the end of the Battle Phase, if this card battled, you can destroy 1 Spell or Trap Card on the field. You must control another face-up "roid" monster to activate and to resolve this effect.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleEnd',
      label: 'Destroy 1 Spell/Trap',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.player === ctx.player && faceUpOn(ctx.self) && ctx.self.attackedThisTurnOrWasAttacked,
      condition: (ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && isRoid(c)).length > 0,
      canActivate: (ctx) => ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell or Trap Card to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        if (!ctx.faceUpMonsters('me', (c) => c !== ctx.self && isRoid(c)).length) return;
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length ? 1 : 0) },
    },
  ],
});

M('Expressroid', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 400,
  def: 1600,
  sets: ['roid'],
  aiValue: 600,
  text: 'When this card is Summoned, you can add 2 "roid" monsters from your Graveyard to your hand, except "Expressroid".',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      when: true,
      label: 'Add 2 "roid" monsters',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.grave('me', (c) => isRoid(c) && c.name !== 'Expressroid' && ctx.canTarget(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isRoid(c) && c.name !== 'Expressroid'), 2, 2, 'Target 2 "roid" monsters in your GY.', 'toHand', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    },
  ],
});

M(STEALTH_UNION, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 9,
  atk: 3600,
  def: 3000,
  types: ['fusion'],
  sets: ['roid'],
  aiValue: 800,
  text: '"Truckroid" + "Expressroid" + "Drillroid" + "Stealthroid"\nOnce per turn, during your Main Phase, you can equip 1 face-up non-Machine-Type monster on the field to this card. While this card is equipped with a monster by this effect, it can attack all monsters your opponent controls once each. When this card attacks, its original ATK is halved during damage calculation only. If this card attacks a Defense Position monster, inflict the difference between its ATK and the DEF of the attacked monster as Battle Damage to your opponent.',
  fusion: {
    materials: [namedCI('Truckroid'), namedCI('Expressroid'), namedCI('Drillroid'), namedCI('Stealthroid')],
    desc: '"Truckroid" + "Expressroid" + "Drillroid" + "Stealthroid"',
  },
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Equip a non-Machine monster',
      categories: ['control'],
      canActivate: (ctx) => ctx.freeSZones() > 0 && ctx.faceUpMonsters('both', (c) => c !== ctx.self && c.data.race !== 'Machine' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => c !== ctx.self && c.data.race !== 'Machine'), 1, 1, 'Target 1 face-up non-Machine-Type monster to equip.', 'control');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c) && c.data.race !== 'Machine');
        if (!t || !faceUpOn(ctx.self)) return;
        const from = t.location;
        const ctrl = t.controller;
        if (equipMonster(ctx.game, t, ctx.self, ctx.player)) {
          t.flags.glasEquipBy = ctx.self.uid;
          ctx.log(`${t.name} is equipped to ${ctx.self.name}.`);
          ctx.game.beginBatch();
          ctx.game.emit({ type: 'leftField', card: t, from, to: 'szone', fromController: ctrl, fromFaceUp: true, reason: 'effect', reasonCard: ctx.self, reasonPlayer: ctx.player });
          await ctx.game.ruleCleanup();
        }
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('opp', (c) => c.data.race !== 'Machine' && ctx.canTarget(c)).length ? 70 : 0) },
    },
    {
      kind: 'continuous',
      mods: [
        // APPROX: "attack all monsters once each" = one extra attack per opponent monster beyond the first.
        {
          q: 'extraAttacks',
          value: (ctx) =>
            ctx.game.equipsOf(ctx.self).some((e) => e.isMonster && e.flags.glasEquipBy === ctx.self.uid) ? Math.max(0, ctx.game.monsters(ctx.opp).length - 1 + ctx.self.attacksThisTurn) : 0,
        },
        { q: 'atk', value: (ctx) => (ctx.battle?.inDamageStep && ctx.battle.attacker === ctx.self ? -Math.floor(ctx.game.baseAtk(ctx.self) / 2) : 0) },
        { q: 'piercing' },
      ],
    },
  ],
});

// ============================================================ HEROes

const EVIL_HERO = ['hero', 'evil-hero'];
/** Evil HEROes that must be Special Summoned with "Dark Fusion" carry this tag (and `noPoly`). */
const DARK_FUSION_ONLY = 'dark-fusion';

M('Evil HERO Malicious Edge', {
  attribute: 'EARTH',
  race: 'Fiend',
  level: 7,
  atk: 2600,
  def: 1800,
  sets: EVIL_HERO,
  aiValue: 400,
  text: 'If your opponent controls a monster, you can Tribute Summon this card by Tributing 1 monster. During battle between this attacking card and a Defense Position monster whose DEF is lower than the ATK of this card, inflict the difference as Battle Damage to your opponent.',
  effects: [
    {
      // APPROX: the 1-Tribute rule also allows a 1-Tribute Set.
      kind: 'continuous',
      range: ['hand'],
      altTribute: (ctx, summoned) => summoned === ctx.self && ctx.game.monsters(ctx.opp).length > 0,
    },
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
  ],
});

M('Evil HERO Infernal Gainer', {
  attribute: 'EARTH',
  race: 'Fiend',
  level: 4,
  atk: 1600,
  def: 0,
  sets: EVIL_HERO,
  aiValue: 300,
  text: 'During your Main Phase 1, you can remove this card on your side of the field from play to have 1 Fiend-Type monster you control be able to attack twice during each Battle Phase. During your second Standby Phase after activation, Special Summon this card from your removed from play zone in face-up Attack Position.',
  effects: [
    {
      kind: 'ignition',
      label: 'Banish: a Fiend attacks twice',
      categories: ['atkChange'],
      condition: (ctx) => ctx.phase === 'main1',
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && c.data.race === 'Fiend').length > 0,
      activate: async (ctx) => {
        await ctx.banish(ctx.self, 'cost');
        const g = ctx.game;
        const self = ctx.self;
        const p = ctx.player;
        const moveId = self.moveId;
        // "Your second Standby Phase after activation": activated on your turn → 4 turns later.
        g.addDelayed(
          'standby',
          async () => {
            if (self.location !== 'banished' || self.moveId !== moveId || g.turnPlayer !== p) return;
            g.log(`${self.name} returns from the banished zone.`, 'action', p);
            await g.specialSummon([self], p, { pos: 'atk', reasonCard: self });
          },
          4,
        );
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => c.data.race === 'Fiend'), 1, 1, 'Target 1 Fiend-Type monster you control.', 'buff', { aiScore: (c) => ctx.atk(c) });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c) && c.controller === ctx.player);
        // APPROX: lasts while the monster stays face-up on the field (not tied to who controls it).
        if (t) ctx.addTempMod(t, 'extraAttacks', 1, 'field');
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.faceUpMonsters('me', (c) => c !== ctx.self && c.data.race === 'Fiend' && c.isAttack).map((c) => ctx.atk(c)));
          return best >= 2000 ? 45 : 0;
        },
      },
    },
  ],
});

M('Evil HERO Inferno Wing', {
  attribute: 'FIRE',
  race: 'Fiend',
  level: 6,
  atk: 2100,
  def: 1200,
  types: ['fusion'],
  sets: [...EVIL_HERO, DARK_FUSION_ONLY],
  nomi: true,
  aiValue: 500,
  text: '"Elemental HERO Avian" + "Elemental HERO Burstinatrix"\nThis monster cannot be Special Summoned except with "Dark Fusion". If this card attacks a Defense Position monster, inflict piercing Battle Damage to your opponent. When this card destroys a monster by battle and sends it to the Graveyard, inflict damage to your opponent equal to the ATK or DEF of the destroyed monster in the Graveyard, whichever is higher.',
  fusion: { materials: [namedCI('Elemental HERO Avian'), namedCI('Elemental HERO Burstinatrix')], noPoly: true, desc: '"Elemental HERO Avian" + "Elemental HERO Burstinatrix"' },
  effects: [
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Burn',
      categories: ['damage'],
      eventFilter: (ctx, ev) => evo(ev) === ctx.self && evc(ev)?.location === 'grave',
      resolve: async (ctx) => {
        const d = evc(ctx.event!);
        if (d) await ctx.damage(ctx.opp, Math.max(d.data.atk ?? 0, d.data.def ?? 0));
      },
    },
  ],
});

M('Evil HERO Lightning Golem', {
  attribute: 'LIGHT',
  race: 'Fiend',
  level: 6,
  atk: 2400,
  def: 1500,
  types: ['fusion'],
  sets: [...EVIL_HERO, DARK_FUSION_ONLY],
  nomi: true,
  aiValue: 700,
  text: '"Elemental HERO Sparkman" + "Elemental HERO Clayman"\nThis monster cannot be Special Summoned except with "Dark Fusion". Once per turn, you can destroy 1 monster on the field.',
  fusion: { materials: [namedCI('Elemental HERO Sparkman'), namedCI('Elemental HERO Clayman')], noPoly: true, desc: '"Elemental HERO Sparkman" + "Elemental HERO Clayman"' },
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy 1 monster',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.monsters('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both', (c) => c !== ctx.self), 1, 1, 'Target 1 monster to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.monsters('opp', (c) => ctx.canTarget(c)).length ? 65 : 0) },
    },
  ],
});

M(DARK_GAIA, {
  attribute: 'EARTH',
  race: 'Fiend',
  level: 8,
  atk: 0,
  def: 0,
  types: ['fusion'],
  sets: [...EVIL_HERO, DARK_FUSION_ONLY],
  nomi: true,
  aiValue: 600,
  text: '1 Fiend-Type monster + 1 Rock-Type monster\nThis monster cannot be Special Summoned except with "Dark Fusion". The original ATK of this card becomes the combined original ATK of the Fusion Material Monsters used to Fusion Summon this card. When this card declares an attack, you can change all Defense Position monsters your opponent controls to face-up Attack Position. (Flip Effects are not activated at this time.)',
  fusion: { materials: [(c) => c.data.race === 'Fiend', (c) => c.data.race === 'Rock'], noPoly: true, desc: '1 Fiend-Type monster + 1 Rock-Type monster' },
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: 'Change Defense Position monsters to Attack Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.monsters('opp', (c) => c.pos === 'def').length > 0,
      resolve: async (ctx) => {
        const g = ctx.game;
        const list = ctx.monsters('opp', (c) => c.pos === 'def');
        if (!list.length) return;
        g.beginBatch();
        for (const c of list) {
          // Turned face-up without a flip: no "flipped" event, so Flip Effects do not activate.
          c.pos = 'atk';
          c.faceUp = true;
          await g.anim({ type: 'flip', card: c.uid, pos: 'atk', faceUp: true });
          g.emit({ type: 'positionChanged', card: c, reasonPlayer: ctx.player });
        }
        ctx.log('All Defense Position monsters are changed to face-up Attack Position.');
        g.update();
      },
      ai: { score: (ctx) => (ctx.monsters('opp', (c) => c.pos === 'def').length ? 1 : 0) },
    },
  ],
});

S('Dark Fusion', 'normal', {
  // 2010 text: https://edisonrul.ing/cards/d/dark-fusion.html
  text: "Send, from your hand or your side of the field to the Graveyard, Fusion Material Monsters that are listed on a Fiend-Type Fusion Monster Card, and Special Summon that Fusion Monster from your Fusion Deck. (This Special Summon is treated as a Fusion Summon). The Special Summoned monster cannot be targeted by the effects of your opponent's Monsters, Spells, and Traps this turn.",
  effects: [
    fusionSummonEffect({
      allowNoPoly: true,
      fusionFilter: (f) => f.data.race === 'Fiend' && (!f.data.fusion?.noPoly || f.inSet(DARK_FUSION_ONLY)),
      onSummoned: (ctx, f) => {
        ctx.addTempMod(f, 'untargetable', true, 'turn');
        if (f.name === DARK_GAIA) {
          const mats = (f.flags.materials ?? []) as { card?: C }[];
          f.flags.baseAtk = mats.reduce((a, m) => a + (m.card?.data.atk ?? 0), 0);
          ctx.log(`${f.name}'s original ATK becomes ${f.flags.baseAtk}.`);
          ctx.game.update();
        }
      },
    }),
  ],
});

const NEOS = 'Elemental HERO Neos';
const DARK_PANTHER = 'Neo-Spacian Dark Panther';
const GLOW_MOSS = 'Neo-Spacian Glow Moss';
const CHAOS_MATS = [NEOS, DARK_PANTHER, GLOW_MOSS];

M(CHAOS_NEOS, {
  attribute: 'DARK',
  race: 'Warrior',
  level: 9,
  atk: 3000,
  def: 2500,
  types: ['fusion'],
  sets: ['hero', 'elemental-hero'],
  aiValue: 800,
  text: `"${NEOS}" + "${DARK_PANTHER}" + "${GLOW_MOSS}"\nThis monster can only be Special Summoned from your Extra Deck, by returning the above cards you control to the Deck. (You do not use "Polymerization".) During the End Phase, this card returns to the Extra Deck, and all face-up monsters on the field are changed to face-down Defense Position. Once per turn, during your Main Phase 1, you can toss a coin 3 times and apply the appropriate effect.\n● 3 Heads: Destroy all monsters your opponent controls.\n● 2 Heads: The effects of all face-up monsters your opponent currently controls are negated.\n● 1 Head: Return all monsters you control to your hand.`,
  fusion: { materials: CHAOS_MATS.map(namedCI), noPoly: true, desc: `"${NEOS}" + "${DARK_PANTHER}" + "${GLOW_MOSS}"` },
  effects: [
    {
      kind: 'proc',
      range: ['extra'],
      label: 'Contact Fusion',
      categories: ['specialSummon'],
      condition: (ctx) => CHAOS_MATS.every((n) => ctx.faceUpMonsters('me', namedCI(n)).length > 0),
      perform: async (ctx) => {
        const mats: C[] = [];
        for (const n of CHAOS_MATS) {
          const [m] = await ctx.select(ctx.faceUpMonsters('me', namedCI(n)), 1, 1, `Select "${n}" to return to the Deck.`, 'material');
          if (!m) return false;
          mats.push(m);
        }
        ctx.log(`${ctx.game.players[ctx.player].name} shuffles ${mats.map((m) => m.name).join(', ')} into the Deck.`);
        await ctx.toDeck(mats, 'shuffle', 'material');
        return true;
      },
      ai: { score: () => 60 },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Return to the Extra Deck',
      categories: ['toDeck', 'position'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && faceUpOn(ctx.self),
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        await ctx.toDeck(ctx.self, 'shuffle');
        if (ctx.self.location !== 'extra') return;
        for (const c of ctx.faceUpMonsters('both')) if (c.location === 'mzone' && c.faceUp) await ctx.game.setFaceDown(c);
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Toss a coin 3 times',
      categories: ['destroy', 'negate'],
      condition: (ctx) => ctx.phase === 'main1',
      resolve: async (ctx) => {
        let heads = 0;
        for (let i = 0; i < 3; i++) if (await tossCoin(ctx)) heads++;
        if (heads === 3) await ctx.destroy(ctx.monsters('opp'));
        else if (heads === 2) for (const c of ctx.faceUpMonsters('opp')) ctx.negateEffects(c, 'turn');
        else if (heads === 1) {
          const mine = ctx.monsters('me');
          if (mine.length) await ctx.toHand(mine);
        }
      },
      ai: { score: (ctx) => (ctx.monsters('opp').length ? 45 : 0) },
    },
  ],
});

M('Elemental HERO Plasma Vice', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 8,
  atk: 2600,
  def: 2300,
  types: ['fusion'],
  sets: ['hero', 'elemental-hero'],
  nomi: true,
  aiValue: 700,
  text: '"Elemental HERO Sparkman" + "Elemental HERO Bladedge"\nThis card can only be Special Summoned by Fusion Summon. During battle between this attacking card and a Defense Position monster whose DEF is lower than the ATK of this card, inflict the difference as Battle Damage to your opponent. You can discard 1 card to destroy 1 Attack Position monster your opponent controls.',
  fusion: { materials: [namedCI('Elemental HERO Sparkman'), namedCI('Elemental HERO Bladedge')], desc: '"Elemental HERO Sparkman" + "Elemental HERO Bladedge"' },
  effects: [
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
    {
      kind: 'ignition',
      label: 'Discard 1: destroy 1 Attack Position monster',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.monsters('opp', (c) => c.isAttack && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
        await ctx.selectTargets(ctx.monsters('opp', (c) => c.isAttack), 1, 1, 'Target 1 Attack Position monster your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.pos === 'atk');
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.monsters('opp', (c) => c.isAttack && ctx.canTarget(c)).map((c) => cardValue(ctx.game, c)));
          const worst = Math.min(...ctx.hand().map((c) => cardValue(ctx.game, c)));
          return best > worst + 300 ? 55 : 0;
        },
      },
    },
  ],
});

S('Contact Out', 'quickplay', {
  text: 'Return 1 "Neos" Fusion Monster you control to the Extra Deck. If all the Fusion Material Monsters listed on that Fusion Monster are in your Deck, you can Special Summon them.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon', 'toDeck'],
      canActivate: (ctx) => ctx.monsters('me', isNeosFusion).length > 0,
      resolve: async (ctx) => {
        const [f] = await ctx.select(ctx.monsters('me', isNeosFusion), 1, 1, 'Return 1 "Neos" Fusion Monster you control to the Extra Deck.', 'toDeck');
        if (!f) return;
        const names = fusionMaterialNames(f);
        await ctx.toDeck(f, 'shuffle');
        if (f.location !== 'extra' || !names.length) return;
        const mats: C[] = [];
        for (const n of names) {
          const c = ctx.deck('me', (x) => lname(x) === n.toLowerCase() && !mats.includes(x) && ctx.canSummonCard(x))[0];
          if (!c) return;
          mats.push(c);
        }
        if (ctx.freeMZones() < mats.length || !(await ctx.confirm('Special Summon the Fusion Material Monsters from your Deck?'))) return;
        await ctx.specialSummon(mats);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          // Mostly a save from removal / Chaos Neos' End Phase.
          const l = ctx.prevLink();
          if (l && l.player === ctx.opp && (l.effect.categories ?? []).some((c) => ['destroy', 'destroyMulti', 'banish', 'control'].includes(c))) return 55;
          return 0;
        },
      },
    },
  ],
});
/** Names listed as Fusion Material on the first line of a Fusion Monster's text. */
function fusionMaterialNames(f: C): string[] {
  const line = (f.data.fusion?.desc ?? f.data.text.split('\n')[0]) || '';
  return [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}
const isNeosFusion = (c: C) => c.isMonster && c.hasType('fusion') && fusionMaterialNames(c).some((n) => /\bneos\b/i.test(n));

// ============================================================ Gemini monsters

M('Infinity Dark', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 1500,
  def: 1200,
  types: ['gemini'],
  aiValue: 200,
  text: `${GEMINI_TEXT}\n● When this card declares an attack, you can change the battle position of 1 face-up monster your opponent controls.`,
  effects: [
    geminiSummon((ctx) => (ctx.faceUpMonsters('opp', (c) => c.isDefense).length ? 35 : 20)),
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: 'Change battle position',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && gemini(ctx),
      canActivate: (ctx) => ctx.faceUpMonsters('opp').length > 0,
      resolve: async (ctx) => {
        const cands = ctx.faceUpMonsters('opp');
        const [t] = await ctx.select(cands, 1, 1, 'Change the battle position of 1 face-up monster your opponent controls.', 'position', {
          aiScore: (c) => (c.pos === 'def' ? 1000 - ctx.atk(c) / 10 : ctx.def(c) < ctx.atk(ctx.self) ? 500 : 0),
        });
        if (t && faceUpOn(t)) await ctx.changePos(t, t.pos === 'atk' ? 'def' : 'atk');
      },
      ai: { score: () => 1 },
    },
  ],
});

M(SLIME, {
  attribute: 'WATER',
  race: 'Aqua',
  level: 3,
  atk: 700,
  def: 1200,
  types: ['gemini'],
  aiValue: 200,
  text: `${GEMINI_TEXT}\n● Your opponent takes any Battle Damage you would have taken from battles involving this card.`,
  effects: [geminiSummon(() => 30)],
});

M(AG_KNIGHT, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1800,
  def: 500,
  types: ['gemini'],
  sets: ['ancient-gear'],
  aiValue: 200,
  text: `${GEMINI_TEXT}\n● If this card attacks, your opponent cannot activate any Spell or Trap Cards until the end of the Damage Step.`,
  effects: [geminiSummon((ctx) => (ctx.spellTraps('opp', (c) => !c.faceUp).length ? 38 : 25))],
});

M('Alien Hypno', {
  attribute: 'WATER',
  race: 'Reptile',
  level: 4,
  atk: 1600,
  def: 700,
  types: ['gemini'],
  sets: ['alien'],
  aiValue: 300,
  text: `${GEMINI_TEXT}\n● During your Main Phase, you can select 1 monster your opponent controls with an A-Counter(s), and take control of it while this card is on the field. During each of your End Phases, remove 1 A-Counter from each controlled monster. If all A-Counters are removed from one of these monsters, destroy it.\n${A_RULE}`,
  effects: [
    alienBattleRule,
    geminiSummon((ctx) => (ctx.monsters('opp', (c) => aCount(c) > 0).length ? 50 : 20)),
    {
      kind: 'ignition',
      label: 'Take control of a monster with an A-Counter',
      categories: ['control'],
      condition: gemini,
      canActivate: (ctx) => ctx.freeMZones() > 0 && ctx.monsters('opp', (c) => aCount(c) > 0 && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('opp', (c) => aCount(c) > 0), 1, 1, 'Target 1 monster your opponent controls with an A-Counter.', 'control');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.opp);
        if (!t || !faceUpOn(ctx.self)) return;
        if (await ctx.takeControl(t, false)) {
          t.flags.glasHypno = ctx.self.uid;
          t.flags.glasHypnoMove = ctx.self.moveId;
        }
      },
      ai: { score: (ctx) => (ctx.monsters('opp', (c) => aCount(c) > 0 && ctx.canTarget(c)).length ? 70 : 0) },
    },
    {
      // 2010 ruling: removing the A-Counters, and destroying a monster that has none left, do not start a Chain
      // (run in the End Phase, outside the Chain). https://edisonrul.ing/cards/a/alien-hypno.html
      kind: 'trigger',
      event: 'phaseStart',
      label: 'Remove A-Counters',
      eventFilter: (ctx, ev) => {
        if (ev.phase !== 'end' || ev.player !== ctx.player || !faceUpOn(ctx.self) || ctx.isNegated(ctx.self) || !hypnoControlled(ctx).length) return false;
        const self = ctx.self;
        const mid = self.moveId;
        ctx.later('end', async () => {
          if (!faceUpOn(self) || self.moveId !== mid || ctx.isNegated(self)) return;
          const kill: C[] = [];
          for (const m of hypnoControlled(ctx)) {
            m.counters.A = Math.max(0, aCount(m) - 1);
            if (aCount(m) === 0) kill.push(m);
          }
          ctx.game.update();
          if (kill.length) await ctx.destroy(kill);
        });
        return false;
      },
    },
    {
      // "while this card is on the field": control returns when Alien Hypno leaves the field.
      kind: 'trigger',
      event: 'leftField',
      range: ALL_LOCS,
      mandatory: true,
      label: 'Return control',
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.game.monsters(ctx.self.owner).some((m) => m.flags.glasHypno === ctx.self.uid && m.flags.glasHypnoMove === ctx.self.moveId - 1),
      resolve: async (ctx) => {
        for (const m of [...ctx.game.monsters(0), ...ctx.game.monsters(1)]) {
          if (m.flags.glasHypno === ctx.self.uid && m.flags.glasHypnoMove === ctx.self.moveId - 1) {
            delete m.flags.glasHypno;
            await ctx.game.returnControl(m);
          }
        }
      },
    },
  ],
});
const hypnoControlled = (ctx: Ctx) => ctx.monsters('me', (m) => m.flags.glasHypno === ctx.self.uid && m.flags.glasHypnoMove === ctx.self.moveId);

M(RAPTINUS, {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 8,
  atk: 2200,
  def: 2200,
  types: ['fusion'],
  aiValue: 400,
  text: '1 Gemini monster + 1 Gemini monster\nAll Gemini monsters on the field are treated as Effect Monsters, and gain their effects.',
  fusion: { materials: [isGemini, isGemini], desc: '1 Gemini monster + 1 Gemini monster' },
  effects: [],
});

S('Super Double Summon', 'quickplay', {
  text: 'Select 1 Gemini Monster you control and Normal Summon it. During the End Phase of this turn, return it to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isGemini(c) && !c.flags.geminiSummoned).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => isGemini(c) && !c.flags.geminiSummoned), 1, 1, 'Select 1 Gemini monster you control.', 'buff', { aiScore: (c) => ctx.atk(c) });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c) && c.controller === ctx.player);
        if (!t) return;
        makeGeminiActive(ctx, t);
        const moveId = t.moveId;
        ctx.later('end', async () => {
          if (t.location === 'mzone' && t.moveId === moveId) {
            ctx.game.log(`${t.name} returns to the hand (Super Double Summon).`, 'action', ctx.player);
            await ctx.game.toHand([t], 'effect', ctx.player, ctx.self);
          }
        });
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && ctx.isMyTurn && ctx.faceUpMonsters('me', (c) => isGemini(c) && !c.flags.geminiSummoned).length ? 30 : 0) },
    },
  ],
});

// ============================================================ Six Samurai

normal(
  'Chamberlain of the Six Samurai',
  'EARTH',
  'Warrior',
  3,
  200,
  2000,
  'The Six Samurai are supported from the shadows by this silent and mysterious warrior. His past is unknown to them, but his countless scars are proof of his experience.',
).sets = ['six-samurai'];

M("Enishi, Shien's Chancellor", {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 6,
  atk: 2200,
  def: 1200,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 700,
  text: 'This card cannot be Normal Summoned or Set. This card can only be Special Summoned by removing from play 2 "Six Samurai" monsters in your Graveyard. Once per turn, you can destroy 1 face-up monster on the field. This card cannot attack during the turn you activate this effect.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (banish 2 Six Samurai)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.grave('me', isSixSamurai).length >= 2,
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', isSixSamurai), 2, 2, 'Banish 2 "Six Samurai" monsters from your GY.', 'cost');
        if (sel.length < 2) return false;
        await ctx.banish(sel, 'cost');
        return true;
      },
      ai: { score: () => 55 },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy 1 face-up monster',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        ctx.self.flags.cannotAttackTurn = ctx.turn;
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => c !== ctx.self), 1, 1, 'Target 1 face-up monster to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c) && cardValue(ctx.game, c) >= 1200).length ? 60 : 0) },
    },
  ],
});

const spiritTargets = (ctx: Ctx) =>
  ctx.faceUpMonsters('me', (c) => c !== ctx.self && isSixSamurai(c) && !ctx.game.equipsOf(c).some((e) => e.isMonster && e.hasType('union')));
M('Spirit of the Six Samurai', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 3,
  atk: 500,
  def: 500,
  types: ['union'],
  sets: ['six-samurai'],
  aiValue: 300,
  text: 'Once per turn, you can either: Target 1 face-up "Six Samurai" monster you control; equip this card to that target, OR: Unequip this card and Special Summon it in face-up Attack Position. While equipped by this effect, the equipped monster gains 500 ATK and DEF. If the equipped monster destroys an opponent\'s monster by battle: Draw 1 card. (A monster can only be equipped with 1 Union Monster at a time. If the equipped monster would be destroyed, destroy this card instead.)',
  effects: [
    {
      kind: 'ignition',
      range: ['mzone', 'szone'],
      opt: true,
      label: 'Equip / Unequip',
      categories: ['atkChange'],
      condition: (ctx) =>
        ctx.self.location === 'mzone'
          ? ctx.self.faceUp && ctx.freeSZones() > 0 && spiritTargets(ctx).some((c) => ctx.canTarget(c))
          : ctx.self.location === 'szone' && !!ctx.self.flags.unionEquipped && ctx.equipTarget !== undefined && ctx.canSummonSelf(),
      activate: async (ctx) => {
        ctx.data.mode = ctx.self.location === 'mzone' ? 'equip' : 'unequip';
        if (ctx.data.mode === 'equip') await ctx.selectTargets(spiritTargets(ctx), 1, 1, 'Target 1 face-up "Six Samurai" monster you control.', 'equip', { aiScore: (c) => ctx.atk(c) });
      },
      resolve: async (ctx) => {
        if (ctx.data.mode === 'equip') {
          const t = ctx.validTargets((c) => faceUpOn(c) && c.controller === ctx.player)[0];
          if (!t || !faceUpOn(ctx.self)) return;
          if (equipMonster(ctx.game, ctx.self, t, ctx.player)) ctx.self.flags.unionEquipped = true;
        } else if (ctx.self.location === 'szone') {
          await ctx.specialSummon(ctx.self, { pos: 'atk' });
        }
      },
      ai: { score: (ctx) => (ctx.self.location === 'mzone' && ctx.phase === 'main1' && spiritTargets(ctx).length ? 40 : 0) },
    },
    {
      kind: 'continuous',
      range: ['szone'],
      active: (ctx) => !!ctx.self.flags.unionEquipped,
      mods: (['atk', 'def'] as const).map((q) => ({ q, to: 'cards' as const, filter: equippedTo, value: 500 })),
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['szone'],
      mandatory: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => !!ctx.self.flags.unionEquipped && !!ctx.equipTarget && evo(ev) === ctx.equipTarget && ev.fromController !== ctx.player,
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
    {
      kind: 'continuous',
      range: ['szone'],
      replaceDestroyOne: async (ctx, card) => {
        if (!ctx.self.flags.unionEquipped || card !== ctx.equipTarget || !ctx.self.onField) return false;
        ctx.game.log(`${ctx.self.name} is destroyed instead.`, 'action', ctx.self.controller);
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        return ctx.self.location !== 'szone';
      },
    },
  ],
});

S('Cunning of the Six Samurai', 'quickplay', {
  text: 'Send 1 face-up "Six Samurai" monster you control to the Graveyard to select 1 "Six Samurai" monster in either player\'s Graveyard, and Special Summon it to your side of the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      // 2010 ruling: it cannot be activated with no "Six Samurai" monster in the GY (the one sent as the cost can then
      // be the one Summoned). https://edisonrul.ing/cards/c/cunning-of-the-six-samurai.html
      canActivate: (ctx) => ctx.faceUpMonsters('me', isSixSamurai).length > 0 && ctx.grave('both', isSixSamurai).length > 0,
      activate: async (ctx) => {
        const [c] = await ctx.select(ctx.faceUpMonsters('me', isSixSamurai), 1, 1, 'Send 1 face-up "Six Samurai" monster you control to the GY.', 'cost');
        if (!c) return false;
        await ctx.sendToGrave(c, 'cost');
        await ctx.selectTargets(ctx.grave('both', isSixSamurai), 1, 1, 'Target 1 "Six Samurai" monster in either GY.', 'specialSummon', { aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0) });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t);
      },
      ai: { score: (ctx) => (ctx.grave('both', (c) => isSixSamurai(c) && (c.data.atk ?? 0) >= 1800).length ? 40 : 0) },
    },
  ],
});

T('Swiftstrike Armor', 'continuous', {
  text: 'During your Draw Phase, when you draw a "Six Samurai" monster, you can show it to your opponent and Special Summon it.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: () => 25 } },
    {
      kind: 'trigger',
      event: 'drawn',
      label: 'Special Summon the drawn Six Samurai',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => stActive(ctx) && ev.player === ctx.player && ctx.phase === 'draw' && ctx.isMyTurn && !!evc(ev) && isSixSamurai(evc(ev)!),
      canActivate: (ctx) => {
        const c = evc(ctx.event!);
        return !!c && c.location === 'hand' && ctx.canSummonCard(c);
      },
      activate: async (ctx) => {
        const c = evc(ctx.event!)!;
        await reveal(ctx, [c]);
        ctx.data.card = c;
        ctx.data.moveId = c.moveId;
      },
      resolve: async (ctx) => {
        const c = ctx.data.card as C;
        if (c.location === 'hand' && c.moveId === ctx.data.moveId && ctx.canSummonCard(c)) await ctx.specialSummon(c);
      },
      ai: { score: () => 1 },
    },
  ],
});

T('Double-Edged Sword Technique', 'normal', {
  text: 'Select 2 "Six Samurai" monsters in your Graveyard, and Special Summon them in face-up Attack Position. During the End Phase of this turn, destroy them, and you take damage equal to their combined ATK.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.freeMZones() >= 2 && ctx.grave('me', (c) => isSixSamurai(c) && ctx.canSummonCard(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isSixSamurai(c) && ctx.canSummonCard(c)), 2, 2, 'Target 2 "Six Samurai" monsters in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length < 2 || ctx.freeMZones() < 2) return;
        const r = await ctx.specialSummon(t, { pos: 'atk' });
        const ids = r.map((c) => c.moveId);
        ctx.later('end', async () => {
          const still = r.filter((c, i) => c.location === 'mzone' && c.moveId === ids[i]);
          if (!still.length) return;
          // Only the monsters actually destroyed count (Legendary Ebon Steed); no Chain:
          // https://edisonrul.ing/cards/d/double-edged-sword-technique.html
          const atkOf = new Map(still.map((c) => [c, ctx.atk(c)] as const));
          const d = await ctx.game.destroy(still, 'effect', ctx.player, ctx.self);
          const atk = d.reduce((a, c) => a + (atkOf.get(c) ?? 0), 0);
          if (atk > 0) await ctx.game.damage(ctx.player, atk, 'effect', ctx.self, ctx.player);
        });
      },
      ai: { score: (ctx) => (ctx.isMyTurn && ctx.phase === 'main1' && ctx.lp > 5000 && ctx.monsters('opp').length === 0 ? 40 : 0) },
    },
  ],
});

// ============================================================ Aliens / A-Counters

M('Alien Telepath', {
  attribute: 'FIRE',
  race: 'Reptile',
  level: 4,
  atk: 1600,
  def: 1000,
  sets: ['alien'],
  aiValue: 400,
  text: `Once per turn, you can remove 1 A-Counter from an opponent's monster to destroy 1 Spell or Trap Card. ${A_RULE}`,
  effects: [
    alienBattleRule,
    {
      kind: 'ignition',
      opt: true,
      label: 'Remove 1 A-Counter: destroy 1 Spell/Trap',
      categories: ['destroy'],
      // The historical page has no Telepath entry; edisonformat.net (revised): the Spell/Trap is targeted at activation.
      // https://edisonrul.ing/cards/a/alien-telepath.html
      canActivate: (ctx) => ctx.monsters('opp', (c) => aCount(c) > 0).length > 0 && ctx.spellTraps('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const [h] = await ctx.select(ctx.monsters('opp', (c) => aCount(c) > 0), 1, 1, "Remove 1 A-Counter from an opponent's monster.", 'cost');
        if (!h) return false;
        h.counters.A = aCount(h) - 1;
        ctx.game.update();
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell or Trap Card to destroy.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? 1000 : -1000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp').length ? 55 : 0) },
    },
  ],
});

S(INCUBATOR, 'continuous', {
  text: 'Each time an A-Counter(s) is removed by a card effect, place 1 A-Counter on this card. When this card is destroyed, distribute the A-Counters on this card among face-up monsters on the field.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isAlien).length ? 30 : 10) } },
    {
      kind: 'trigger',
      event: 'destroyed',
      range: ['grave', 'banished', 'hand', 'deck'],
      mandatory: true,
      label: 'Distribute A-Counters',
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && !!ev.fromFaceUp && (INCUBATOR_COUNT.get(ctx.self)?.n ?? 0) > 0,
      activate: async (ctx) => {
        const rec = INCUBATOR_COUNT.get(ctx.self);
        ctx.data.n = rec && rec.moveId === ctx.self.moveId - 1 ? rec.n : 0;
      },
      resolve: async (ctx) => {
        const n = ctx.data.n as number;
        for (let i = 0; i < n; i++) {
          const cands = ctx.faceUpMonsters('both');
          if (!cands.length) return;
          const [t] = await ctx.select(cands, 1, 1, `Place an A-Counter on a face-up monster (${i + 1}/${n}).`, 'target', {
            aiScore: (c) => (c.controller === ctx.opp ? 100 + ctx.atk(c) / 100 : -100),
          });
          if (t) {
            t.counters.A = aCount(t) + 1;
            ctx.log(`An A-Counter is placed on ${t.name}.`);
          }
        }
        ctx.game.update();
      },
    },
  ],
});

T('Cell Explosion Virus', 'normal', {
  text: "Activate only when an opponent's monster with an A-Counter declares an attack. Destroy all Attack Position monsters your opponent controls.",
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        return !!a && a.controller === ctx.opp && aCount(a) > 0;
      },
      resolve: async (ctx) => {
        const list = ctx.monsters('opp', (c) => c.pos === 'atk');
        if (list.length) await ctx.destroy(list);
      },
      ai: { score: () => 80 },
    },
  ],
});

T('Detonator Circle "A"', 'normal', {
  text: 'Destroy 1 face-up monster with an A-Counter(s), and then inflict 1000 damage to each player.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'damage'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => aCount(c) > 0 && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => aCount(c) > 0), 1, 1, 'Target 1 face-up monster with an A-Counter.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn);
        if (!t.length) return;
        await ctx.destroy(t);
        await ctx.damage(ctx.player, 1000);
        await ctx.damage(ctx.opp, 1000);
      },
      ai: { score: (ctx) => (ctx.lp > 2000 && ctx.faceUpMonsters('opp', (c) => aCount(c) > 0 && cardValue(ctx.game, c) >= 1500).length ? 50 : ctx.oppLp <= 1000 ? 90 : 0) },
    },
  ],
});

T('Interdimensional Warp', 'normal', {
  text: 'Select a monster you control and a monster with an A-Counter(s) your opponent controls. Switch control of those monsters.',
  effects: [
    {
      kind: 'activate',
      categories: ['control'],
      canActivate: (ctx) => ctx.monsters('me').length > 0 && ctx.monsters('opp', (c) => aCount(c) > 0 && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const [mine] = await ctx.selectTargets(ctx.monsters('me'), 1, 1, 'Select a monster you control.', 'cost', { aiScore: (c) => -cardValue(ctx.game, c) });
        const [theirs] = await ctx.selectTargets(ctx.monsters('opp', (c) => aCount(c) > 0), 1, 1, 'Select a monster with an A-Counter your opponent controls.', 'control');
        if (!mine || !theirs) return false;
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        const mine = t.find((c) => c.controller === ctx.player);
        const theirs = t.find((c) => c.controller === ctx.opp);
        if (!mine || !theirs) return;
        await swapControl(ctx.game, mine, theirs);
      },
      ai: { score: (ctx) => (ctx.monsters('opp', (c) => aCount(c) > 0 && cardValue(ctx.game, c) >= 1800).length ? 55 : 0) },
    },
  ],
});
/** Switch control of two monsters on opposite sides (each takes the other's zone). */
async function swapControl(g: Game, a: C, b: C) {
  const pa = a.controller;
  const pb = b.controller;
  const sa = a.seq;
  const sb = b.seq;
  g.players[pa].mzone[sa] = b;
  g.players[pb].mzone[sb] = a;
  a.controller = pb;
  a.seq = sb;
  b.controller = pa;
  b.seq = sa;
  a.flags.controlChangedTurn = g.turn;
  b.flags.controlChangedTurn = g.turn;
  g.log(`Control of ${a.name} and ${b.name} is switched.`, 'action', pa);
  await g.anim({ type: 'move', cards: [{ uid: a.uid, from: 'mzone', to: 'mzone', ctrl: pa }, { uid: b.uid, from: 'mzone', to: 'mzone', ctrl: pb }] });
  g.beginBatch();
  g.emit({ type: 'controlChanged', card: a, player: pb });
  g.emit({ type: 'controlChanged', card: b, player: pa });
  g.update();
}

// ============================================================ other monsters

M('Witch Doctor of Sparta', {
  attribute: 'EARTH',
  race: 'Spellcaster',
  level: 4,
  atk: 400,
  def: 2000,
  aiValue: 400,
  text: "Each time a monster(s) is Special Summoned from either player's Deck, inflict 500 damage to your opponent.",
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Inflict 500 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.from === 'deck' && faceUpOn(ctx.self),
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500);
      },
    },
  ],
});

M('Goblin Black Ops', {
  attribute: 'DARK',
  race: 'Beast-Warrior',
  level: 4,
  atk: 1300,
  def: 0,
  aiValue: 200,
  text: "This card can attack your opponent's Life Points directly. If this card attacks, it is changed to Defense Position at the end of the Battle Phase, and its battle position cannot be changed until the End Phase of your next turn.",
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'directAttack' }, { q: 'cannotChangePos', value: (ctx) => (ctx.self.flags.glasGboLock ?? -1) >= ctx.turn }],
    },
    {
      kind: 'trigger',
      event: 'battleEnd',
      mandatory: true,
      label: 'Change to Defense Position',
      categories: ['position'],
      eventFilter: (ctx) => faceUpOn(ctx.self) && ctx.self.attacksThisTurn > 0,
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        if (ctx.self.pos === 'atk') await ctx.changePos(ctx.self, 'def');
        ctx.self.flags.glasGboLock = ctx.turn + (ctx.isMyTurn ? 2 : 1);
      },
    },
  ],
});

M('Gambler of Legend', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 500,
  def: 1400,
  aiValue: 200,
  text: "Once per turn, you can toss a coin 3 times and apply the appropriate effect.\n● 3 Heads: Destroy all monsters your opponent controls.\n● 2 Heads: Discard 1 random card from your opponent's hand.\n● 1 Head: Destroy 1 card you control.\n● 3 Tails: Discard your entire hand.",
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Toss a coin 3 times',
      categories: ['destroy', 'discard'],
      resolve: async (ctx) => {
        let heads = 0;
        for (let i = 0; i < 3; i++) if (await tossCoin(ctx)) heads++;
        if (heads === 3) {
          await ctx.destroy(ctx.monsters('opp'));
        } else if (heads === 2) {
          await discardRandom(ctx, ctx.opp, 1);
        } else if (heads === 1) {
          const mine = ctx.field('me');
          if (!mine.length) return;
          const sel = await ctx.select(mine, 1, 1, 'Destroy 1 card you control.', 'destroy', { aiScore: (c) => -cardValue(ctx.game, c) });
          if (sel.length) await ctx.destroy(sel);
        } else {
          const hand = ctx.hand();
          if (hand.length) await ctx.discard(hand);
        }
      },
      ai: { score: (ctx) => (ctx.hand().length <= 1 && ctx.monsters('opp').length ? 35 : 0) },
    },
  ],
});

M(DRAGON_ICE, {
  attribute: 'WATER',
  race: 'Dragon',
  level: 5,
  atk: 1800,
  def: 2200,
  aiValue: 500,
  text: 'When your opponent Special Summons a monster, you can discard 1 card to Special Summon this card from your hand or Graveyard. There can only be 1 face-up "Dragon Ice" on the field.',
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      range: ['hand', 'grave'],
      label: 'Discard 1: Special Summon',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.player === ctx.opp && ev.dsId === undefined && !!evc(ev) && evc(ev)!.controller === ctx.opp,
      // Ruling: from the hand, Dragon Ice can discard itself as the cost; it is then Special Summoned from the GY.
      canActivate: (ctx) => ctx.hand('me').length > 0 && ctx.canSummonCard(ctx.self),
      activate: async (ctx) => {
        const prompt = ctx.self.location === 'hand' ? 'Discard 1 card (this card can be it: it is then Summoned from the GY).' : 'Discard 1 card.';
        const sel = await ctx.select(ctx.hand('me'), 1, 1, prompt, 'discard', {
          aiScore: (c) => (c === ctx.self ? 5000 : -cardValue(ctx.game, c)),
        });
        if (!sel.length) return false;
        await ctx.discard(sel, 'cost');
        ctx.data.moveId = ctx.self.moveId;
      },
      resolve: async (ctx) => {
        if (ctx.self.moveId !== ctx.data.moveId || !ctx.canSummonCard(ctx.self)) return;
        await ctx.specialSummon(ctx.self);
      },
      ai: {
        score: (ctx) => {
          if (ctx.self.location === 'hand') return 1; // discarding itself costs nothing
          const worst = Math.min(...ctx.hand('me').map((c) => cardValue(ctx.game, c)));
          return worst <= 1600 ? 1 : 0;
        },
      },
    },
  ],
});

/** Tongue Twister: Tribute Summoned copies (card → moveId while on the field). */
const tributeSummoned = new WeakMap<C, number>();
M('Tongue Twister', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 6,
  atk: 400,
  def: 300,
  aiValue: 300,
  text: 'If this card was Tribute Summoned, when it is sent from the field to the Graveyard, draw 2 cards and remove this card from play.',
  effects: [
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self) tributeSummoned.set(ctx.self, ctx.self.moveId);
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      range: ['grave'],
      mandatory: true,
      label: 'Draw 2',
      categories: ['draw', 'banish'],
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self && (ev.from === 'mzone') && tributeSummoned.get(ctx.self) === ctx.self.moveId - 1,
      resolve: async (ctx) => {
        await ctx.draw(2);
        if (ctx.self.location === 'grave') await ctx.banish(ctx.self);
      },
    },
  ],
});

M('Skreech', {
  attribute: 'WATER',
  race: 'Reptile',
  level: 4,
  atk: 1500,
  def: 400,
  aiValue: 300,
  text: 'When this card is destroyed by battle, send 2 WATER monsters from your Deck to the Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Send 2 WATER monsters to the GY',
      categories: ['mill'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => c.isMonster && c.data.attribute === 'WATER');
        if (!cands.length) return;
        const sel = await ctx.select(cands, Math.min(2, cands.length), 2, 'Send 2 WATER monsters from your Deck to the GY.', 'toGrave', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (isCloudian(c) ? 300 : 0),
        });
        if (sel.length) await ctx.sendToGrave(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

M('Royal Firestorm Guards', {
  attribute: 'FIRE',
  race: 'Pyro',
  level: 4,
  atk: 1700,
  def: 1200,
  aiValue: 400,
  text: 'When this card is Normal Summoned, you can return 4 Pyro-Type monsters from your Graveyard to the Deck. Then draw 2 cards.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Return 4 Pyro monsters: draw 2',
      categories: ['toDeck', 'draw'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.grave('me', (c) => c.isMonster && c.data.race === 'Pyro' && ctx.canTarget(c)).length >= 4,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && c.data.race === 'Pyro'), 4, 4, 'Target 4 Pyro-Type monsters in your GY.', 'toDeck');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length < 4) return;
        await ctx.toDeck(t, 'shuffle');
        await ctx.draw(2);
      },
    },
  ],
});

M('Necroface', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 4,
  atk: 1200,
  def: 1800,
  aiValue: 300,
  text: 'When this card is Normal Summoned, shuffle all removed from play cards into the Deck. This card gains 100 ATK for each card returned to the Deck. When this card is removed from play, each player removes the top 5 cards of his or her Deck from play.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      mandatory: true,
      label: 'Shuffle banished cards into the Deck',
      categories: ['toDeck', 'atkChange'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      resolve: async (ctx) => {
        const list = ctx.banished('both');
        if (!list.length) return;
        const r = await ctx.toDeck(list, 'shuffle');
        const n = r.filter((c) => c.location === 'deck').length;
        if (n && faceUpOn(ctx.self)) ctx.addTempMod(ctx.self, 'atk', 100 * n, 'field');
      },
    },
    {
      kind: 'trigger',
      event: 'banished',
      range: ['banished'],
      mandatory: true,
      label: 'Each player banishes the top 5 cards of their Deck',
      categories: ['banish'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      resolve: async (ctx) => {
        for (const p of [ctx.player, ctx.opp] as PlayerId[]) {
          const deck = ctx.game.players[p].deck;
          const top = deck.slice(Math.max(0, deck.length - 5)).reverse();
          if (top.length) await ctx.game.banish(top, 'effect', ctx.player, ctx.self);
        }
      },
    },
  ],
});

normal('Gil Garth', 'DARK', 'Fiend', 4, 1800, 1200, 'This steel-armored terror machine ruthlessly strikes down enemies with its giant katana.');

// ============================================================ other Spells

S('Swing of Memories', 'normal', {
  text: 'Select 1 Normal Monster in your Graveyard, and Special Summon it. Destroy it during the End Phase of this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isNormalLike(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isNormalLike(c) && ctx.canSummonCard(c)), 1, 1, 'Target 1 Normal Monster in your GY.', 'specialSummon', { aiScore: (c) => c.data.atk ?? 0 });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t) return;
        const r = await ctx.specialSummon(t);
        if (!r.length) return;
        const moveId = t.moveId;
        ctx.later('end', async () => {
          if (t.location === 'mzone' && t.moveId === moveId) await ctx.game.destroy([t], 'effect', ctx.player, ctx.self);
        });
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && ctx.grave('me', (c) => isNormalLike(c) && (c.data.atk ?? 0) >= 1800).length ? 35 : 0) },
    },
  ],
});

S('Silent Doom', 'normal', {
  text: 'Special Summon 1 Normal Monster from your Graveyard in face-up Defense Position. It cannot attack.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isNormalLike(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isNormalLike(c) && ctx.canSummonCard(c)), 1, 1, 'Target 1 Normal Monster in your GY.', 'specialSummon', {
          aiScore: (c) => Math.max(c.data.def ?? 0, c.data.atk ?? 0),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t) return;
        const r = await ctx.specialSummon(t, { pos: 'def' });
        if (r.length) ctx.addTempMod(t, 'cannotAttack', true, 'field');
      },
      ai: { score: (ctx) => (ctx.grave('me', (c) => isNormalLike(c) && (c.data.def ?? 0) >= 1500).length ? 30 : 0) },
    },
  ],
});

S('Magic Formula', 'equip', {
  text: 'Equip only to "Dark Magician" or "Dark Magician Girl". It gains 700 ATK. When this card is sent from the field to the Graveyard, you gain 1000 Life Points.',
  effects: [
    equipSpell((_ctx, c) => c.name === 'Dark Magician' || c.name === 'Dark Magician Girl', (ctx) => ownEquipScore(ctx, (c) => c.name === 'Dark Magician' || c.name === 'Dark Magician Girl', 40)),
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: equippedTo, value: 700 }] },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      range: ['grave'],
      mandatory: true,
      label: 'Gain 1000 LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && !!ev.fromFaceUp,
      resolve: async (ctx) => {
        await ctx.recover(ctx.player, 1000);
      },
    },
  ],
});

S('Veil of Darkness', 'continuous', {
  text: 'During your Draw Phase, when you draw a DARK monster, you can show it to your opponent and send it to the Graveyard to draw 1 card.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['deck'], (c) => c.isMonster && c.data.attribute === 'DARK').length >= 8 ? 30 : 0) } },
    {
      kind: 'trigger',
      event: 'drawn',
      label: 'Send the drawn DARK monster to the GY: draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return stActive(ctx) && ev.player === ctx.player && ctx.isMyTurn && ctx.phase === 'draw' && !!c && c.isMonster && c.data.attribute === 'DARK';
      },
      canActivate: (ctx) => evc(ctx.event!)?.location === 'hand',
      activate: async (ctx) => {
        const c = evc(ctx.event!)!;
        await reveal(ctx, [c]);
        await ctx.sendToGrave(c, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
      ai: { score: () => 1 },
    },
  ],
});

S(SDBS, 'continuous', {
  text: 'Select 1 monster equipped with a "Bamboo Sword" Equip Spell Card. If it inflicts Battle Damage to your opponent while equipped with a "Bamboo Sword" card, they skip their next Draw Phase. Destroy this card during your second Standby Phase after activation.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('both', bambooEquipped(ctx)).some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', bambooEquipped(ctx)), 1, 1, 'Select 1 monster equipped with a "Bamboo Sword" card.', 'buff');
        const g = ctx.game;
        const self = ctx.self;
        const p = ctx.player;
        // "During your second Standby Phase after activation".
        const offset = ctx.isMyTurn ? 4 : 3;
        g.addDelayed(
          'standby',
          async () => {
            if (self.onField && self.faceUp && g.turnPlayer === p) await g.destroy([self], 'effect', p, self);
          },
          offset,
        );
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets(faceUpOn);
        if (t && ctx.self.onField) {
          ctx.self.flags.glasBamboo = t.uid;
          ctx.self.flags.glasBambooMove = t.moveId;
        }
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('me', bambooEquipped(ctx)).length ? 50 : 0) },
    },
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      label: 'Skip the next Draw Phase',
      eventFilter: (ctx, ev) => {
        const src = ev.reasonCard as C | undefined;
        return stActive(ctx) && ev.player === ctx.opp && !!src && src.uid === ctx.self.flags.glasBamboo && src.moveId === ctx.self.flags.glasBambooMove && bambooEquipped(ctx)(src);
      },
      resolve: async (ctx) => {
        gs(ctx.game).skipDraw.add(ctx.opp);
        ctx.log(`${ctx.game.players[ctx.opp].name} will skip their next Draw Phase.`);
      },
    },
  ],
});
const bambooEquipped = (ctx: Ctx) => (c: C) => ctx.game.equipsOf(c).some((e) => e.isSpell && e.faceUp && e.name.includes('Bamboo Sword'));

// ============================================================ other Traps

T('Over Limit', 'normal', {
  text: 'Pay 500 Life Points. Special Summon as many Normal Monsters with 1000 or less ATK that were destroyed by battle this turn from both players\' Graveyards as possible.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.lp > 500 && overLimitCands(ctx).length > 0 && ctx.canSpecialSummon(),
      activate: async (ctx) => {
        await ctx.payLp(500);
      },
      resolve: async (ctx) => {
        const list = overLimitCands(ctx).filter((c) => ctx.canSummonCard(c));
        if (!list.length) return;
        const n = Math.min(ctx.freeMZones(), list.length);
        const sel = list.length > n ? await ctx.select(list, n, n, `Special Summon ${n} Normal Monster(s).`, 'specialSummon') : list;
        if (sel.length) await ctx.specialSummon(sel);
      },
      ai: { score: (ctx) => (overLimitCands(ctx).length >= 2 ? 45 : 0) },
    },
  ],
});
/** Normal Monsters with 1000 or less ATK in either GY that were destroyed by battle this turn. APPROX: identified by the event log. */
function overLimitCands(ctx: Ctx): C[] {
  const out = new Set<C>();
  for (const e of turnEvents(ctx.game)) {
    const c = evc(e);
    if (e.type === 'battleDestroyed' && c && c.location === 'grave' && isNormalLike(c) && (c.data.atk ?? 0) <= 1000) out.add(c);
  }
  // https://edisonrul.ing/cards/o/over-limit.html — a monster destroyed by battle that left the GY and was later sent back
  // there this turn by other means (Tributed, etc.) cannot be Special Summoned: its last trip to the GY must be the battle.
  const evs = turnEvents(ctx.game);
  return [...out].filter((c) => {
    for (let i = evs.length - 1; i >= 0; i--) {
      const e = evs[i];
      if (e.type === 'sentToGrave' && evc(e) === c) return (e.reasons ?? [e.reason]).includes('battle');
    }
    return false;
  });
}

T('No Entry!!', 'normal', {
  text: 'Change all Attack Position monsters on the field to Defense Position.',
  effects: [
    {
      kind: 'activate',
      categories: ['position'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => c.pos === 'atk').length > 0,
      resolve: async (ctx) => {
        for (const c of ctx.faceUpMonsters('both', (m) => m.pos === 'atk')) await ctx.changePos(c, 'def');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (b && b.attacker.controller === ctx.opp && !b.inDamageStep) {
            const mine = ctx.monsters('me').length;
            return !b.target && ctx.atk(b.attacker) >= 1500 ? 55 : mine && ctx.monsters('opp', (c) => c.isAttack).length >= 2 ? 45 : 0;
          }
          return 0;
        },
      },
    },
  ],
});

T('Release from Stone', 'continuous', {
  text: 'Select 1 of your removed from play Rock-Type monsters, and Special Summon it to your side of the field. When this card is removed from the field, destroy that monster. When that monster is destroyed, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.banished('me', (c) => c.isMonster && c.faceUp && c.data.race === 'Rock' && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.banished('me', (c) => c.isMonster && c.faceUp && c.data.race === 'Rock' && ctx.canSummonCard(c)), 1, 1, 'Target 1 of your banished Rock-Type monsters.', 'specialSummon', {
          aiScore: (c) => c.data.atk ?? 0,
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'banished');
        if (!t || !ctx.self.onField) return;
        const r = await ctx.specialSummon(t);
        if (r.length && ctx.self.onField) ctx.game.link(ctx.self, t, true);
      },
      ai: { score: (ctx) => (ctx.banished('me', (c) => c.isMonster && c.data.race === 'Rock' && (c.data.atk ?? 0) >= 1500).length ? 40 : 0) },
    },
  ],
});

T('Energy-Absorbing Monolith', 'normal', {
  text: "Activate only when your opponent activates a card or effect that would inflict damage to your Life Points. Negate that damage, and increase your Life Points by the same amount instead.",
  effects: [
    {
      kind: 'activate',
      categories: ['recover'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.player === ctx.opp && (l.effect.categories ?? []).includes('damage');
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        const l = ctx.data.link as any;
        if (!l) return;
        if (!(l.glasMonolith instanceof Set)) l.glasMonolith = new Set<PlayerId>();
        l.glasMonolith.add(ctx.player);
      },
      ai: { score: () => 70 },
    },
  ],
});

T('Foolish Revival', 'normal', {
  text: "Select 1 monster from your opponent's Graveyard, and Special Summon it in face-up Defense Position on your opponent's side of the field.",
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.freeMZones('opp') > 0 && ctx.grave('opp', (c) => c.isMonster && ctx.canSummonCard(c, 'opp')).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('opp', (c) => c.isMonster && ctx.canSummonCard(c, 'opp')), 1, 1, "Target 1 monster in your opponent's GY.", 'specialSummon', {
          aiScore: (c) => -(c.data.def ?? 0) - (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (t && ctx.freeMZones('opp') > 0) await ctx.specialSummon(t, { pos: 'def', controller: ctx.opp });
      },
      // Only useful with Witch Doctor-style or Tribute-fodder plays the AI does not plan.
      ai: { score: () => 0 },
    },
  ],
});

T('An Unfortunate Report', 'normal', {
  text: 'Your opponent conducts his or her next Battle Phase twice.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      resolve: async (ctx) => {
        const g = ctx.game;
        // "Next" Battle Phase: not the one in progress.
        const from = g.turnPlayer === ctx.opp && (g.phase === 'battle' || g.phase === 'main2' || g.phase === 'end') ? g.turn + 1 : g.turn;
        gs(g).report.push({ p: ctx.opp, from });
        ctx.log(`${g.players[ctx.opp].name} will conduct their next Battle Phase twice.`);
      },
      ai: { score: () => 0 },
    },
  ],
});

T('Security Orb', 'normal', {
  text: "Activate only when an opponent's monster declares an attack. Change the battle position of the attacking monster. When this face-down card is destroyed and sent to the Graveyard by a Spell or Trap Card your opponent controls, destroy 1 monster on the field.",
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['position', 'negateAttack'],
      eventFilter: (ctx, ev) => evc(ev)?.controller === ctx.opp,
      canActivate: (ctx) => !!ctx.battle && ctx.canTarget(ctx.battle.attacker),
      activate: async (ctx) => {
        if (ctx.battle) ctx.addTargets([ctx.battle.attacker]);
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets(faceUpOn);
        if (t) await ctx.changePos(t, t.pos === 'atk' ? 'def' : 'atk');
      },
      ai: { score: (ctx) => (ctx.battle && ctx.atk(ctx.battle.attacker) >= 1500 ? 55 : 0) },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      range: ['grave'],
      mandatory: true,
      label: 'Destroy 1 monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const r = ev.reasonCard as C | undefined;
        return ev.card === ctx.self && ev.from === 'szone' && !ev.fromFaceUp && ev.fromController === ctx.self.owner && ev.reasonPlayer === ctx.game.opp(ctx.self.owner) && !!r && (r.isSpell || r.isTrap);
      },
      condition: (ctx) => ctx.monsters('both').length > 0,
      resolve: async (ctx) => {
        const list = ctx.monsters('both');
        if (!list.length) return;
        const sel = await ctx.select(list, 1, 1, 'Destroy 1 monster on the field.', 'destroy');
        if (sel.length) await ctx.destroy(sel);
      },
    },
  ],
});

export const GLAS_LOADED = true;
