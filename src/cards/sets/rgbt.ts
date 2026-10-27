// Card definitions: Raging Battle (RGBT), the TCG booster set released June 2009.
// Every RGBT card that no other set file defines. Card text, type, Attribute, Level and ATK/DEF come
// from the YGOJSON v1 aggregate (official English text); behaviour follows the 2010 TCG rulings.
//
// Cards already scripted elsewhere (not repeated here): Blackwing - Blizzard the Far North,
// Blackwing - Shura the Blue Flame, Blackwing - Kalut the Moon Shadow, Blackwing - Elphin the Raven,
// Blackwing Armed Wing, Delta Crow - Anti Reverse (blackwings.ts), Exploder Dragonwing, Power Tool Dragon
// (extra.ts), Magic Planter, Black Whirlwind, Trap Stun, Swallow Flip and Mirror of Oaths. Fixes to those
// definitions are marked "RGBT:" in their files.
//
// Engine hooks reused (no new engine code): EffectDef.replaceDestroyOne and altTribute (ABPF), the
// Earthbound Immortal Normal Summon rule from `ensureAnprPatches` (ANPR). Game-level rules with no engine
// hook (G.B. Hunter, Koa'ki Meiru Drago, Grave of the Super Ancient Organism, Calming Magic, King of the
// Beasts, Miracle Locus, Crimson Fire / Spell of Pain) are installed per game by `ensureRgbtPatches`, the
// same way anpr.ts and traps.ts wrap Game methods. Approximations are marked "APPROX:".
import { monster, spell, token, trap } from '../define';
import { bestTarget, cardValue, flip, selfDestroysByBattle } from '../helpers';
import { synchroOptions } from './plants';
import { ensureAnprPatches } from './anpr';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Activation } from '../../engine/controller';
import { Ctx } from '../../engine/ctx';
import type { ChainLink, Game } from '../../engine/game';
import type { Attribute, BattlePos, GameEvent, Location, PlayerId, Race, Reason } from '../../engine/types';

type C = CardInstance;

// =================================================================== shared helpers

const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const evc = (ev: GameEvent) => ev.card as C | undefined;
const evo = (ev: GameEvent) => ev.other as C | undefined;
const reasonsOf = (ev: GameEvent): Reason[] => ev.reasons ?? (ev.reason ? [ev.reason] : []);
/** Moved by a card effect (not by battle, as a cost, as material or by a game rule). */
const byCardEffect = (ev: GameEvent) => {
  const r = reasonsOf(ev);
  return r.includes('effect') && !r.includes('cost') && !r.includes('battle');
};
const lvl = (c: C) => c.data.level ?? 0;
const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
/** This Spell/Trap is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
/** This monster is face-up on the field and not negated. */
const monActive = (ctx: Ctx) => faceUpOn(ctx.self) && !ctx.game.isNegated(ctx.self);
const isMain = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';
const noChain = (ctx: Ctx) => ctx.game.chain.length === 0;
const isRace = (c: C, ...r: Race[]) => c.isMonster && r.includes(c.data.race as Race);
const isAttr = (c: C, ...a: Attribute[]) => c.isMonster && a.includes(c.data.attribute as Attribute);
const isSpecialSummoned = (c: C) => ['special', 'synchro', 'fusion', 'ritual'].includes(c.summonMethod ?? '');
const isNormalMonster = (c: C) => c.isMonster && c.hasType('normal') && !c.isToken;
const isEquipSpell = (c: C) => c.isSpell && c.data.stype === 'equip';
const canSS = (ctx: Ctx) => !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon');

/** Sphere of Chaos: "While this card is face-up on the field its Attribute is also treated as LIGHT." */
const isLight = (c: C) => isAttr(c, 'LIGHT') || (c.data.name === 'Sphere of Chaos' && faceUpOn(c));
const isLightOrDark = (c: C) => isLight(c) || isAttr(c, 'DARK');

// ---- archetypes (by tag, or by name for cards from other files) ----
const IRON_CORE = "Iron Core of Koa'ki Meiru";
const isIronCore = (c: C) => c.name === IRON_CORE;
const isKoakiMonster = (c: C) => c.isMonster && (c.inSet('koaki-meiru') || c.name.startsWith("Koa'ki Meiru"));
const isMorphtronic = (c: C) => c.inSet('morphtronic') || c.name.startsWith('Morphtronic');
const isMorphMonster = (c: C) => c.isMonster && isMorphtronic(c);
const isOjama = (c: C) => c.inSet('ojama') || c.name.startsWith('Ojama');
const isOjamaMonster = (c: C) => c.isMonster && isOjama(c);
const isBW = (c: C) => c.isMonster && (c.inSet('blackwing') || c.name.startsWith('Blackwing'));
const isEI = (c: C) => c.isMonster && (c.inSet('earthbound-immortal') || c.name.startsWith('Earthbound Immortal'));
const isAlien = (c: C) => c.isMonster && (c.inSet('alien') || c.name.startsWith('Alien'));
const AMARYLLIS = 'Phoenixian Cluster Amaryllis';

/** Tribute cards as a cost (not for a Tribute Summon). */
async function tributeCost(ctx: Ctx, cards: C[]) {
  if (!cards.length) return [];
  ctx.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`);
  return ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}
const tributable = (ctx: Ctx, c: C) => !ctx.query(c, 'cannotBeTributed');

/** Reveal cards from the hand. */
async function reveal(ctx: Ctx, cards: C[]) {
  if (!cards.length) return;
  for (const c of cards) c.revealedUntil = ctx.turn;
  ctx.log(`${ctx.game.players[ctx.player].name} reveals ${cards.map((c) => c.name).join(', ')}.`);
  await ctx.game.anim({ type: 'reveal', cards: cards.map((c) => c.uid), player: ctx.player });
}

/** Position for an effect Special Summon: humans choose, the AI picks by stats. */
function aiPos(ctx: Ctx, c: C): 'atk' | 'def' | 'choose' {
  if (ctx.game.controllers[ctx.player]?.isHuman) return 'choose';
  const atk = c.data.atk ?? 0;
  const oppBest = Math.max(0, ...ctx.faceUpMonsters('opp').map((m) => (m.pos === 'atk' ? ctx.atk(m) : 0)));
  return atk >= 1600 && atk >= oppBest ? 'atk' : 'def';
}
const summonScore = (c: C) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0);

/** Special Summon 1 card from the Deck (non-targeting), shuffling afterwards. */
async function summonFromDeck(ctx: Ctx, filter: (c: C) => boolean, prompt: string, pos?: BattlePos | 'choose') {
  const cands = ctx.deck('me', (c) => filter(c) && ctx.canSummonCard(c));
  if (!cands.length || !ctx.canSpecialSummon()) {
    ctx.game.shuffleDeck(ctx.player);
    return [] as C[];
  }
  const [s] = await ctx.select(cands, 1, 1, prompt, 'specialSummon', { aiScore: summonScore });
  const r = s ? await ctx.specialSummon(s, { pos: pos ?? aiPos(ctx, s) }) : [];
  ctx.game.shuffleDeck(ctx.player);
  return r;
}

/** Monster battling `self` in the current battle. */
function battleOpponent(ctx: Ctx, self: C = ctx.self): C | null {
  const b = ctx.battle;
  if (!b) return null;
  if (b.attacker === self) return b.target;
  if (b.target === self) return b.attacker;
  return null;
}

/** Recursion guard for `active` checks of cards whose mods are 'negated' (the engine skips self-negation checks for that key). */
let negGuard = 0;
function selfNotNegated(ctx: Ctx) {
  if (negGuard > 0) return true;
  negGuard++;
  try {
    return !ctx.game.isNegated(ctx.self);
  } finally {
    negGuard--;
  }
}

/** Would `c` (mine) win or survive its current battle? Used by AI hints. */
function battleStat(ctx: Ctx, c: C) {
  return c.pos === 'atk' ? ctx.atk(c) : ctx.def(c);
}

/** Synchro Monsters reachable right now (AI hints). */
const synchroNow = (ctx: Ctx) => synchroOptions(ctx).length;

// ---- equips ----
const equipped = (ctx: Ctx, c: C) => c === ctx.equipTarget;
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
const ownEquipScore = (ctx: Ctx, filter: (c: C) => boolean, base = 32) =>
  isMain(ctx) && ctx.faceUpMonsters('me', filter).length ? (ctx.phase === 'main1' ? base : base / 2) : 0;

/** Put a monster into its controller's Spell & Trap Zone as an Equip Card for `host`. */
function equipMonster(ctx: Ctx, card: C, host: C) {
  if (ctx.game.freeSZones(ctx.player) <= 0) return false;
  ctx.game.rawMove(card, 'szone', { controller: ctx.player, faceUp: true });
  ctx.game.equip(card, host);
  ctx.log(`${card.name} is equipped to ${host.name}.`);
  ctx.game.update();
  return true;
}

// ---- Koa'ki Meiru upkeep (same shape as sovr.ts / anpr.ts) ----
/**
 * "During each of your End Phases, destroy this card unless you send 1 'Iron Core of Koa'ki Meiru'
 * from your hand to the GY or reveal 1 <X> in your hand." Iron Core Armor's replacement is offered.
 */
function koakiUpkeep(revealDesc: string | null, revealFilter: ((c: C) => boolean) | null): EffectDef {
  return {
    kind: 'trigger',
    event: 'phaseStart',
    range: ['mzone'],
    mandatory: true,
    label: "Koa'ki Meiru upkeep",
    categories: ['destroy'],
    eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && ctx.self.faceUp,
    resolve: async (ctx) => {
      const me = ctx.self;
      if (!faceUpOn(me)) return;
      const cores = ctx.hand('me', isIronCore);
      const reveals = revealFilter ? ctx.hand('me', revealFilter) : [];
      const opts: string[] = [];
      const kinds: ('reveal' | 'send' | 'destroy')[] = [];
      if (reveals.length) {
        opts.push(`Reveal 1 ${revealDesc} in your hand`);
        kinds.push('reveal');
      }
      if (cores.length) {
        opts.push(`Send 1 "${IRON_CORE}" from your hand to the GY`);
        kinds.push('send');
      }
      opts.push(`Destroy ${me.name}`);
      kinds.push('destroy');
      const i = await ctx.option(`${me.name}: End Phase upkeep`, opts, (k) => (kinds[k] === 'reveal' ? 3 : kinds[k] === 'send' ? 2 : 0));
      const kind = kinds[i] ?? 'destroy';
      if (kind === 'reveal') {
        const [r] = await ctx.select(reveals, 1, 1, `Reveal 1 ${revealDesc}.`, 'generic', { aiScore: () => 0 });
        if (r) {
          await reveal(ctx, [r]);
          return;
        }
      }
      if (kind === 'send') {
        const [s] = await ctx.select(cores, 1, 1, `Send 1 "${IRON_CORE}" to the GY.`, 'cost');
        if (s) {
          await ctx.sendToGrave(s, 'cost');
          return;
        }
      }
      const armor = ctx.game.equipsOf(me).find((e) => e.name === 'Iron Core Armor' && e.faceUp && !ctx.game.isNegated(e));
      if (armor && (await ctx.confirm(`Send Iron Core Armor to the GY instead of destroying ${me.name}?`, true))) {
        await ctx.sendToGrave(armor, 'effect');
        return;
      }
      await ctx.destroy(me);
    },
  };
}
/** I control a face-up Koa'ki Meiru monster that will need an Iron Core (AI hints). */
const needsCore = (ctx: Ctx) => ctx.faceUpMonsters('me', isKoakiMonster).length > 0 && !ctx.hand('me', isIronCore).length;

// ---- Earthbound Immortals (same rules as anpr.ts / sovr.ts) ----
const faceUpFieldSpell = (g: Game) => [g.players[0].fzone, g.players[1].fzone].some((c) => !!c && c.faceUp);
const ANPR_PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  eventFilter: (ctx) => {
    ensureAnprPatches(ctx.game); // "only 1 face-up Earthbound Immortal" Normal Summon rule
    return false;
  },
};
function earthboundRules(): EffectDef[] {
  return [
    ANPR_PATCH_LISTENER,
    {
      kind: 'continuous',
      mods: [
        { q: 'cannotBeAttacked' },
        { q: 'directAttack' },
        // If none of this player's monsters can be attacked, the opponent's monsters may attack directly.
        {
          q: 'directAttack',
          to: 'cards',
          filter: (ctx, c: C) =>
            c.location === 'mzone' && c.controller === ctx.opp && ctx.monsters('me').every((m) => ctx.game.queryCard(m, 'cannotBeAttacked')),
        },
      ],
    },
    {
      // APPROX: "If there is no face-up Field Spell, destroy this card" is a mandatory trigger (a Chain Link) here.
      kind: 'trigger',
      event: ['summoned', 'leftField', 'flipped', 'positionChanged', 'phaseStart'],
      range: ['mzone'],
      mandatory: true,
      label: 'No Field Spell: destroy',
      categories: ['destroy'],
      eventFilter: (ctx) => faceUpOn(ctx.self) && !faceUpFieldSpell(ctx.game),
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self) && !faceUpFieldSpell(ctx.game)) await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
      },
    },
    {
      // APPROX: a second face-up "Earthbound Immortal" that still gets Summoned (by an effect) is sent to the GY.
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      label: 'Only 1 Earthbound Immortal',
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.game.allFieldCards().some((c) => c !== ctx.self && faceUpOn(c) && isEI(c)),
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone') await ctx.game.moveCards([ctx.self], 'grave', { reason: 'rule', reasonPlayer: ctx.player, reasonCard: ctx.self });
      },
    },
  ];
}

// =================================================================== per-game rule patches
// The engine has no hook for these rules, so each game instance gets small wrappers (installed once, at the first
// phase start, by any card that carries PATCH_LISTENER; tests can call ensureRgbtPatches directly):
//  * damage: Crimson Fire / Spell of Pain (effect damage redirected from the resolving chain link), Miracle Locus
//    (no battle damage to the opponent from that monster's battles);
//  * moveCards: G.B. Hunter (cards on the field cannot be returned to the Deck / Extra Deck);
//  * specialSummon, inherentSpecialSummon, canSynchro, canProc: Koa'ki Meiru Drago (no LIGHT/DARK Special Summons);
//  * canNormalSummon: "There can only be 1 face-up King of the Beasts on the field";
//  * legalMainActions: Calming Magic (no Flip Summons; Normal/Special Summons use the player queries);
//  * canActivateEffect, canActivateTrigger, activate: Grave of the Super Ancient Organism (no effect activations of
//    Special Summoned Level 6+ monsters on the field) and G.B. Hunter (no tag-outs: blocked triggers are not offered);
//  * attackTargets: Miracle Locus (its second attack must be on a monster).

const PATCHED = new WeakSet<Game>();
const fieldCardActive = (g: Game, name: string, kind: 'monster' | 'st') =>
  g.allFieldCards().some((c) => c.name === name && c.faceUp && (kind === 'monster' ? c.location === 'mzone' : c.activeOnField) && !g.isNegated(c));
const gbHunterActive = (g: Game) => fieldCardActive(g, 'G.B. Hunter', 'monster');
const dragoActive = (g: Game) => fieldCardActive(g, "Koa'ki Meiru Drago", 'monster');
const graveOrganismActive = (g: Game) => fieldCardActive(g, 'Grave of the Super Ancient Organism', 'st');
const dragoBlocks = (g: Game, c: C) => c.isMonster && isAttr(c, 'LIGHT', 'DARK') && dragoActive(g);
const faceUpKing = (g: Game, except?: C) => g.allFieldCards().some((c) => c !== except && faceUpOn(c) && c.name === 'King of the Beasts');
/**
 * G.B. Hunter: effects that return cards from the field to the Deck / Extra Deck cannot be activated (and Contact
 * Fusions that shuffle the materials you control into the Deck cannot be performed), instead of being activated with
 * the return silently skipped. Covers the Gladiator Beast tag-outs (optional End-of-Battle-Phase returns), and the
 * field-to-Deck costs/effects named below.
 */
const GB_HUNTER_NAMED = new Set(['Test Tiger', 'Raptor Wing Strike']);
function gbHunterBlocks(g: Game, c: C, ef: EffectDef) {
  if (!gbHunterActive(g) || ef.kind === 'continuous') return false;
  if (ef.kind === 'proc') return !!c.data.fusion?.noPoly && /shuffling the above cards/i.test(c.data.text);
  if (!(ef.categories ?? []).includes('toDeck')) return false;
  if (ef.kind === 'trigger' && ef.event === 'battleEnd' && !ef.mandatory && c.location === 'mzone') return true;
  return GB_HUNTER_NAMED.has(c.name);
}
/** Grave of the Super Ancient Organism: "nor can players activate their effects". */
function organismBlocks(g: Game, c: C, ef: EffectDef) {
  if (!c.isMonster || c.location !== 'mzone' || !c.faceUp || ef.kind === 'continuous' || ef.kind === 'proc') return false;
  return isSpecialSummoned(c) && g.getLevel(c) >= 6 && graveOrganismActive(g);
}

interface DamageRedirect {
  victim: PlayerId;
  mult: number;
  by: string;
}
/** Crimson Fire / Spell of Pain: the effect damage `link` would inflict to `victim` is taken by the other player. */
function redirectDamage(link: ChainLink, victim: PlayerId, mult: number, by: string) {
  link.ctx.data.rgbtRedirect = { victim, mult, by } as DamageRedirect;
}

export function ensureRgbtPatches(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;

  const origDamage = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: C, sourcePlayer?: PlayerId) => {
    if (kind === 'effect' && amount > 0) {
      const r = g.resolvingLink?.ctx.data.rgbtRedirect as DamageRedirect | undefined;
      if (r && r.victim === p) {
        const q = g.opp(p);
        g.log(`${r.by}: ${g.players[q].name} takes the damage instead.`, 'damage', p);
        return origDamage(q, amount * r.mult, kind, source, sourcePlayer);
      }
    }
    if (kind === 'battle' && g.battle) {
      const b = g.battle;
      const locus = [b.attacker, b.target].find((c): c is C => !!c && c.location === 'mzone' && c.controller !== p && c.flags.rgbtLocusTurn === g.turn);
      if (locus) {
        g.log(`Miracle Locus: ${g.players[p].name} takes no battle damage from ${locus.name}.`, 'battle', p);
        return 0;
      }
    }
    return origDamage(p, amount, kind, source, sourcePlayer);
  };

  const origMove = g.moveCards.bind(g);
  anyG.moveCards = async (cards: C[], to: Location, opts: any) => {
    if ((to === 'deck' || to === 'extra') && cards.some((c) => c.onField) && gbHunterActive(g)) {
      const kept = cards.filter((c) => c.onField);
      g.log(`G.B. Hunter: ${kept.map((c) => (c.faceUp ? c.name : 'a face-down card')).join(', ')} cannot be returned to the Deck.`, 'action');
      cards = cards.filter((c) => !c.onField);
      if (!cards.length) return [];
    }
    return origMove(cards, to, opts);
  };

  const origSS = g.specialSummon.bind(g);
  anyG.specialSummon = async (cards: C[], player: PlayerId, opts: any = {}) => {
    const ok = cards.filter((c) => !dragoBlocks(g, c));
    if (ok.length < cards.length) g.log(`Koa'ki Meiru Drago: LIGHT and DARK monsters cannot be Special Summoned.`, 'action');
    return origSS(ok, player, opts);
  };
  const origInherent = g.inherentSpecialSummon.bind(g);
  anyG.inherentSpecialSummon = async (p: PlayerId, card: C, method?: any, pos?: any, extra?: any) => {
    if (dragoBlocks(g, card)) return false;
    return origInherent(p, card, method, pos, extra);
  };
  const origCanSynchro = g.canSynchro.bind(g);
  anyG.canSynchro = (p: PlayerId, s: C) => !dragoBlocks(g, s) && origCanSynchro(p, s);
  const origCanProc = g.canProc.bind(g);
  anyG.canProc = (p: PlayerId, c: C, ef: EffectDef, idx: number) => !dragoBlocks(g, c) && !gbHunterBlocks(g, c, ef) && origCanProc(p, c, ef, idx);

  const origCanNS = g.canNormalSummon.bind(g);
  anyG.canNormalSummon = (p: PlayerId, card: C, set = false) => {
    if (!origCanNS(p, card, set)) return false;
    if (!set && card.name === 'King of the Beasts' && faceUpKing(g)) return false;
    return true;
  };

  const origLegal = g.legalMainActions.bind(g);
  anyG.legalMainActions = (p: PlayerId) => {
    const acts = origLegal(p);
    if (g.turnData['rgbt:calming']) return acts.filter((a) => a.type !== 'flip');
    return acts;
  };

  const origCAE = g.canActivateEffect.bind(g);
  anyG.canActivateEffect = (player: PlayerId, card: C, ef: EffectDef, idx: number, mode: any) =>
    organismBlocks(g, card, ef) || gbHunterBlocks(g, card, ef) ? null : origCAE(player, card, ef, idx, mode);
  // Triggers (tag-outs) do not go through canActivateEffect: drop them before the player is asked.
  const origCAT = g.canActivateTrigger.bind(g);
  anyG.canActivateTrigger = (player: PlayerId, card: C, ef: EffectDef, idx: number) => {
    if (organismBlocks(g, card, ef)) {
      g.log(`Grave of the Super Ancient Organism: ${card.name}'s effect cannot be activated.`, 'chain', player);
      return false;
    }
    if (gbHunterBlocks(g, card, ef)) {
      g.log(`G.B. Hunter: ${card.name}'s effect cannot be activated (cards on the field cannot be returned to the Deck).`, 'chain', player);
      return false;
    }
    return origCAT(player, card, ef, idx);
  };
  const origActivate = g.activate.bind(g);
  anyG.activate = async (player: PlayerId, act: Activation) => {
    if (organismBlocks(g, act.card, act.effect)) {
      g.log(`Grave of the Super Ancient Organism: ${act.card.name}'s effect cannot be activated.`, 'chain', player);
      return null;
    }
    // safety net (canActivateTrigger drops blocked triggers before they are offered)
    if (gbHunterBlocks(g, act.card, act.effect)) {
      g.log(`G.B. Hunter: ${act.card.name}'s effect cannot be activated (cards on the field cannot be returned to the Deck).`, 'chain', player);
      return null;
    }
    return origActivate(player, act);
  };

  const origTargets = g.attackTargets.bind(g);
  anyG.attackTargets = (attacker: C) => {
    const r = origTargets(attacker);
    if (attacker.flags.rgbtLocusTurn === g.turn && attacker.attacksThisTurn >= 1) return { targets: r.targets, direct: false };
    return r;
  };
}
/** Installs the per-game patches at the first phase start (from any location, never activates). */
const PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  eventFilter: (ctx) => {
    ensureRgbtPatches(ctx.game);
    return false;
  },
};

// =================================================================== MONSTERS

const wingedCount = (ctx: Ctx) => ctx.faceUpMonsters('me', (c) => isRace(c, 'Winged Beast')).length;
monster('Battlestorm', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 4,
  atk: 1700,
  def: 1000,
  aiValue: 300,
  text: 'This card gains 100 ATK for each Winged Beast-Type monster you control. Once per turn: You can target 1 Spell/Trap Card your opponent controls; destroy that target. You must control 3 or more Winged Beast-Type monsters to activate and to resolve this effect.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 100 * wingedCount(ctx) }] },
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy 1 Spell/Trap',
      categories: ['destroy'],
      condition: (ctx) => wingedCount(ctx) >= 3,
      canActivate: (ctx) => ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('opp'), 1, 1, 'Target 1 Spell/Trap Card your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        if (wingedCount(ctx) < 3) return;
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: () => 55 },
    },
  ],
});

const rockstoneToken = token('Rockstone Token', 'EARTH', 'Rock', 1, 0, 0, 'Rockstone Token (Rock-Type/EARTH/Level 1/ATK 0/DEF 0). Cannot be Tributed for a Tribute Summon.');
monster('Rockstone Warrior', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 4,
  atk: 1800,
  def: 1600,
  aiValue: 300,
  text: 'You take no Battle Damage from battles involving this card. When this attacking card is destroyed by battle and sent to the Graveyard, Special Summon 2 "Rockstone Tokens" (Rock-Type/EARTH/Level 1/ATK 0/DEF 0). These Tokens cannot be Tributed for a Tribute Summon.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'noBattleDamageFrom' }] },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: '2 Rockstone Tokens',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && reasonsOf(ev).includes('battle') && ctx.game.battle?.attacker === ctx.self,
      resolve: async (ctx) => {
        // Both Tokens or none.
        if (ctx.freeMZones() < 2 || !canSS(ctx)) return;
        const toks = await ctx.createTokens(rockstoneToken, 2, 'def');
        for (const t of toks) t.flags.noTributeSummonFodder = true;
      },
    },
  ],
});

/** Level Warrior: monsters it Special Summoned with its own procedure (card -> moveId before the move). */
const levelWarriorProc = new WeakMap<C, number>();
monster('Level Warrior', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 3,
  atk: 300,
  def: 600,
  aiValue: 100,
  text: 'If there are no monsters on the field, you can Normal Summon this card as a Level 2 monster. If your opponent controls a monster and you control no monsters, you can Special Summon this card (from your hand) as a Level 4 monster.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon as a Level 4 monster',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.monsters('opp').length > 0 && ctx.monsters('me').length === 0 && ctx.freeMZones() > 0,
      perform: async (ctx) => {
        levelWarriorProc.set(ctx.self, ctx.self.moveId);
        return true;
      },
      ai: { score: (ctx) => (synchroNow(ctx) || ctx.hand('me', (c) => c.isMonster && c.isTuner).length ? 45 : 20) },
    },
    {
      // APPROX: "as a Level 2 monster" is always applied when it is Normal Summoned onto an empty field (no choice).
      kind: 'trigger',
      event: ['normalSummoned', 'specialSummoned'],
      range: ['mzone'],
      label: 'Level',
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self) return false;
        if (ev.type === 'specialSummoned') {
          const m = levelWarriorProc.get(ctx.self);
          levelWarriorProc.delete(ctx.self);
          if (m !== undefined && m + 1 === ctx.self.moveId && !ev.reasonCard) ctx.self.flags.baseLevel = 4;
        } else if (ctx.game.allFieldCards().every((c) => c === ctx.self || c.location !== 'mzone')) {
          ctx.self.flags.baseLevel = 2;
        }
        return false;
      },
    },
  ],
});

monster('Strong Wind Dragon', {
  attribute: 'WIND',
  race: 'Dragon',
  level: 6,
  atk: 2400,
  def: 1000,
  aiValue: 200,
  text: 'Cannot be destroyed by battle with a monster that has the same ATK. If this card is Tribute Summoned by Tributing a Dragon-Type monster: It gains ATK equal to half the original ATK of the Tributed monster. If this card attacks a Defense Position monster, inflict piercing battle damage to your opponent.',
  effects: [
    {
      kind: 'continuous',
      active: (ctx) => {
        const o = battleOpponent(ctx);
        return !!o && faceUpOn(o) && ctx.atk(o) === ctx.atk(ctx.self);
      },
      mods: [{ q: 'indestructibleBattle' }],
    },
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      mandatory: true,
      label: 'Gain half the Dragon\'s ATK',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && (ev.tributes ?? []).some((t) => isRace(t as C, 'Dragon')),
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        const gain = ((ctx.event?.tributes ?? []) as C[]).filter((t) => isRace(t, 'Dragon')).reduce((a, t) => a + Math.floor((t.data.atk ?? 0) / 2), 0);
        if (gain > 0) ctx.addTempMod(ctx.self, 'atk', gain, 'field');
      },
    },
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
  ],
});

monster('Dark Verger', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 2,
  atk: 0,
  def: 1000,
  aiValue: 300,
  text: 'When a Plant-Type Tuner monster is Normal Summoned to your side of the field: You can Special Summon this card from your Graveyard in Attack Position.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      range: ['grave'],
      when: true,
      label: 'Special Summon from the GY',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.controller === ctx.player && c.location === 'mzone' && c.isTuner && isRace(c, 'Plant');
      },
      condition: (ctx) => ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave' && ctx.canSummonCard(ctx.self)) await ctx.specialSummon(ctx.self, { pos: 'atk' });
      },
      ai: { score: () => 50 },
    },
  ],
});

monster('Phoenixian Seed', {
  attribute: 'FIRE',
  race: 'Plant',
  level: 2,
  atk: 800,
  def: 0,
  aiValue: 200,
  text: 'You can send this face-up card to the Graveyard to Special Summon 1 "Phoenixian Cluster Amaryllis" from your hand.',
  effects: [
    {
      kind: 'ignition',
      label: 'Summon Phoenixian Cluster Amaryllis',
      categories: ['specialSummon'],
      canActivate: (ctx) => canSS(ctx) && ctx.hand('me', (c) => c.name === AMARYLLIS).length > 0,
      activate: async (ctx) => {
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const a = ctx.hand('me', (c) => c.name === AMARYLLIS);
        if (!a.length || !ctx.canSpecialSummon()) return;
        const [s] = await ctx.select(a, 1, 1, `Special Summon "${AMARYLLIS}" from your hand.`, 'specialSummon');
        if (s) await ctx.specialSummon(s, { pos: aiPos(ctx, s), ignoreConditions: true });
      },
      ai: { score: () => 60 },
    },
  ],
});

monster(AMARYLLIS, {
  attribute: 'FIRE',
  race: 'Plant',
  level: 8,
  atk: 2200,
  def: 0,
  // "Cannot be Special Summoned except with its own effect or with Phoenixian Seed": nomi blocks every other
  // Special Summon (those two summon it with ignoreConditions and never mark it as properly summoned).
  nomi: true,
  aiValue: 500,
  text: 'This card cannot be Special Summoned except with its own effect or with "Phoenixian Seed". If this card attacks, it is destroyed after damage calculation. If this card you control is destroyed and sent to the Graveyard, inflict 800 damage to your opponent. During your End Phase, you can remove from play 1 Plant-Type monster from your Graveyard to Special Summon this card from your Graveyard in Defense Position.',
  effects: [
    {
      // https://edisonrul.ing/cards/p/phoenixian-cluster-amaryllis.html — a Continuous Effect applied right after damage
      // calculation, before any chain; if it was destroyed by that battle, it does not also destroy itself.
      kind: 'trigger',
      event: ['damageCalculated', 'damageStepEnd'],
      mandatory: true,
      noChain: true,
      label: 'Destroyed after attacking',
      categories: ['destroy'],
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self && faceUpOn(ctx.self) && (ev.type === 'damageCalculated' || !ev.other) && !(ctx.game.battle?.calc?.losers ?? []).includes(ctx.self),
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self) && !ctx.game.isNegated(ctx.self)) await ctx.destroy(ctx.self);
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: '800 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && reasonsOf(ev).includes('destroy'),
      resolve: async (ctx) => {
        const fc = ctx.event?.fromController ?? ctx.player;
        await ctx.game.damage(ctx.game.opp(fc), 800, 'effect', ctx.self, fc);
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Banish a Plant: revive in Defense Position',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn,
      canActivate: (ctx) => canSS(ctx) && ctx.freeMZones() > 0 && ctx.grave('me', (c) => c !== ctx.self && isRace(c, 'Plant')).length > 0,
      activate: async (ctx) => {
        const [b] = await ctx.select(ctx.grave('me', (c) => c !== ctx.self && isRace(c, 'Plant')), 1, 1, 'Banish 1 Plant monster from your GY.', 'cost');
        if (!b) return false;
        await ctx.banish(b, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave' && ctx.canSpecialSummon()) await ctx.specialSummon(ctx.self, { pos: 'def', ignoreConditions: true });
      },
      ai: { score: () => 40 },
    },
  ],
});

monster('Rose Tentacles', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 6,
  atk: 2200,
  def: 1200,
  nomi: true, // "Cannot be Special Summoned"
  aiValue: 200,
  text: 'Cannot be Special Summoned. At the start of your Battle Phase, for each Plant monster your opponent currently controls, this card gains 1 additional attack during each Battle Phase this turn. Each time this card destroys a Plant monster by battle: Inflict 300 damage to your opponent.',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['mzone'],
      mandatory: true,
      label: 'Extra attacks',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.phase === 'battle' && ctx.isMyTurn && faceUpOn(ctx.self) && ctx.faceUpMonsters('opp', (c) => isRace(c, 'Plant')).length > 0,
      resolve: async (ctx) => {
        const n = ctx.faceUpMonsters('opp', (c) => isRace(c, 'Plant')).length;
        if (n && faceUpOn(ctx.self)) ctx.addTempMod(ctx.self, 'extraAttacks', n, 'turn');
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: '300 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && !!evc(ev) && isRace(evc(ev)!, 'Plant'),
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 300);
      },
    },
  ],
});

/** Hedge Guard: my monster in the current battle (when it battles another monster). */
function myBattler(ctx: Ctx): C | null {
  const b = ctx.battle;
  if (!b || !b.target) return null;
  if (b.attacker.controller === ctx.player) return b.attacker;
  if (b.target.controller === ctx.player) return b.target;
  return null;
}
monster('Hedge Guard', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 3,
  atk: 0,
  def: 2100,
  aiValue: 300,
  text: "During damage calculation, in either player's turn, when a monster you control attacks or is attacked: You can send this card from your hand to the Graveyard; halve the ATK of that monster you control until the end of this turn, but that monster cannot be destroyed by this battle.",
  effects: [
    {
      // APPROX: used in the Damage Step window right before damage calculation (the engine has no separate
      // "during damage calculation" window).
      kind: 'quick',
      range: ['hand'],
      damageStep: true,
      label: 'Halve ATK: not destroyed by this battle',
      categories: ['protect'],
      condition: (ctx) => {
        const b = ctx.battle;
        const mine = myBattler(ctx);
        return !!b && b.inDamageStep && !b.calc && !!mine && faceUpOn(mine);
      },
      activate: async (ctx) => {
        ctx.data.mine = myBattler(ctx);
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const m = ctx.data.mine as C | null;
        if (!m || !faceUpOn(m) || !ctx.battle) return;
        ctx.addTempMod(m, 'atk', -Math.floor(ctx.atk(m) / 2), 'turn');
        ctx.addTempMod(m, 'indestructibleBattle', true, 'battle');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          const mine = myBattler(ctx);
          if (!b || !mine || ctx.query(mine, 'indestructibleBattle')) return 0;
          const other = mine === b.attacker ? b.target! : b.attacker;
          if (!other.faceUp && mine !== b.attacker) return 0;
          const oAtk = ctx.atk(other);
          let dies = false;
          let dmg = 0;
          if (mine === b.attacker) {
            if (other.pos === 'atk' && oAtk >= ctx.atk(mine)) {
              dies = true;
              dmg = oAtk - Math.floor(ctx.atk(mine) / 2);
            }
          } else if (mine.pos === 'atk') {
            if (oAtk >= ctx.atk(mine)) {
              dies = true;
              dmg = oAtk - Math.floor(ctx.atk(mine) / 2);
            }
          } else if (oAtk > ctx.def(mine)) dies = true;
          if (!dies || dmg >= ctx.lp) return 0;
          return cardValue(ctx.game, mine) >= 1800 ? 65 : 0;
        },
      },
    },
  ],
});

monster('Evil Thorn', {
  attribute: 'DARK',
  race: 'Plant',
  level: 1,
  atk: 100,
  def: 300,
  aiValue: 300,
  text: 'You can Tribute this card; inflict 300 damage to your opponent, and if you do, you can Special Summon up to 2 "Evil Thorn" from your Deck in Attack Position, but their effects cannot be activated.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute: 300 damage',
      categories: ['damage', 'specialSummon'],
      condition: (ctx) => !ctx.self.flags.rgbtNoActivate,
      canActivate: (ctx) => tributable(ctx, ctx.self),
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        const dealt = await ctx.damage(ctx.opp, 300);
        if (!dealt) return;
        const cands = ctx.deck('me', (c) => c.name === 'Evil Thorn' && ctx.canSummonCard(c));
        const max = Math.min(2, cands.length, ctx.freeMZones());
        if (max <= 0 || !ctx.canSpecialSummon()) return;
        if (!(await ctx.confirm('Special Summon up to 2 "Evil Thorn" from your Deck?', true))) return;
        const sel = await ctx.select(cands, 1, max, 'Special Summon up to 2 "Evil Thorn" in Attack Position.', 'specialSummon');
        const r = await ctx.specialSummon(sel, { pos: 'atk' });
        for (const c of r) c.flags.rgbtNoActivate = true;
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          if (ctx.oppLp <= 300) return 100;
          if (!ctx.isMyTurn || !isMain(ctx)) return 0;
          return ctx.deck('me', (c) => c.name === 'Evil Thorn').length ? 40 : 0;
        },
      },
    },
  ],
});

// ---- Morphtronics ----
/** Morphtronic monsters in my GY that a Remoten (Attack Position) could banish for a same-Level search. */
const remotenAtkCands = (ctx: Ctx) => ctx.grave('me', (c) => isMorphMonster(c) && ctx.deck('me', (d) => isMorphMonster(d) && lvl(d) === lvl(c)).length > 0);
/** Morphtronic monsters in hand with another same-Level Morphtronic in the GY. */
const remotenDefCands = (ctx: Ctx) => ctx.hand('me', (c) => isMorphMonster(c) && ctx.grave('me', (g) => isMorphMonster(g) && lvl(g) === lvl(c)).length > 0);
monster('Morphtronic Remoten', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 3,
  atk: 300,
  def: 1200,
  types: ['tuner'],
  sets: ['morphtronic'],
  aiValue: 400,
  text: '● Attack Position: Once per turn: You can target 1 "Morphtronic" monster in your GY; banish that target, and if you do, add 1 "Morphtronic" monster with the same Level as the target from your Deck to your hand.\n● Defense Position: Once per turn: You can send 1 "Morphtronic" monster from your hand to the GY, and if you do, add 1 other "Morphtronic" monster with the same Level as that monster from your GY to your hand.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: '(Attack) Banish a Morphtronic: search the same Level',
      categories: ['search', 'banish'],
      condition: (ctx) => ctx.self.pos === 'atk' && !ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck'),
      canActivate: (ctx) => remotenAtkCands(ctx).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(remotenAtkCands(ctx), 1, 1, 'Target 1 "Morphtronic" monster in your GY.', 'cost');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t) return;
        const lv = lvl(t);
        await ctx.banish(t);
        if (t.location !== 'banished') return;
        await ctx.search((c) => isMorphMonster(c) && lvl(c) === lv, 1, `Add 1 Level ${lv} "Morphtronic" monster to your hand.`);
      },
      ai: { score: () => 45 },
    },
    {
      kind: 'ignition',
      opt: true,
      label: '(Defense) Send a Morphtronic: add the same Level from the GY',
      categories: ['toHand'],
      condition: (ctx) => ctx.self.pos === 'def',
      canActivate: (ctx) => remotenDefCands(ctx).length > 0,
      resolve: async (ctx) => {
        const cands = remotenDefCands(ctx);
        const [s] = await ctx.select(cands, 1, 1, 'Send 1 "Morphtronic" monster from your hand to the GY.', 'toGrave');
        if (!s) return;
        const lv = lvl(s);
        await ctx.sendToGrave(s);
        if (s.location !== 'grave') return;
        const back = ctx.grave('me', (c) => c !== s && isMorphMonster(c) && lvl(c) === lv);
        const [b] = await ctx.select(back, 1, 1, `Add 1 other Level ${lv} "Morphtronic" monster from your GY to your hand.`, 'toHand');
        if (b) await ctx.toHand(b);
      },
      ai: { score: () => 25 },
    },
  ],
});

monster('Morphtronic Videon', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 4,
  atk: 1000,
  def: 1000,
  sets: ['morphtronic'],
  aiValue: 100,
  text: '● While in Attack Position: This card gains 800 ATK for each Equip Card equipped to it.\n● While in Defense Position: This card gains 800 DEF for each Equip Card equipped to it.',
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', value: (ctx) => (ctx.self.pos === 'atk' ? 800 * ctx.game.equipsOf(ctx.self).length : 0) },
        { q: 'def', value: (ctx) => (ctx.self.pos === 'def' ? 800 * ctx.game.equipsOf(ctx.self).length : 0) },
      ],
    },
  ],
});

monster('Morphtronic Scopen', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 3,
  atk: 800,
  def: 1400,
  types: ['tuner'],
  sets: ['morphtronic'],
  aiValue: 400,
  text: '● While in Attack Position: Once per turn, you can Special Summon 1 Level 4 "Morphtronic" monster from your hand. Destroy it during the End Phase.\n● While in Defense Position: While this card is in face-up Defense Position, it is Level 4.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: '(Attack) Special Summon a Level 4 Morphtronic',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.self.pos === 'atk',
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => isMorphMonster(c) && lvl(c) === 4 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => isMorphMonster(c) && lvl(c) === 4 && ctx.canSummonCard(c));
        const [s] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 "Morphtronic" monster from your hand.', 'specialSummon');
        if (!s) return;
        const [m] = await ctx.specialSummon(s, { pos: aiPos(ctx, s) });
        if (!m) return;
        const mid = m.moveId;
        ctx.later('end', async () => {
          if (m.location === 'mzone' && m.moveId === mid) await ctx.game.destroy([m], 'effect', ctx.player, ctx.self);
        });
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' || synchroNow(ctx) ? 45 : 20) },
    },
    {
      kind: 'continuous',
      active: (ctx) => ctx.self.pos === 'def',
      mods: [{ q: 'level', value: (ctx) => 4 - (ctx.self.flags.baseLevel ?? lvl(ctx.self)) }],
    },
  ],
});

monster('Gadget Arms', {
  attribute: 'WATER',
  race: 'Machine',
  level: 2,
  atk: 200,
  def: 400,
  types: ['flip'],
  aiValue: 300,
  text: 'FLIP: Select 1 "Morphtronic" Spell or Trap Card in your Graveyard and add it to your hand.',
  effects: [
    flip({
      label: 'Add a Morphtronic Spell/Trap',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.grave('me', (c) => !c.isMonster && isMorphtronic(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => !c.isMonster && isMorphtronic(c)), 1, 1, 'Target 1 "Morphtronic" Spell/Trap in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    }),
  ],
});

monster('Torapart', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 2,
  atk: 600,
  def: 600,
  types: ['tuner'],
  aiValue: 300,
  text: 'This card cannot be used as a Synchro Material Monster, except for the Synchro Summon of a Warrior-Type Synchro Monster. If the Synchro Monster that used this card as a Synchro Material Monster attacks, your opponent cannot activate Trap Cards until the end of the Damage Step.',
  synchroMaterialCheck: (synchro) => synchro.data.race === 'Warrior',
  effects: [
    {
      // Marks the Synchro Monster it was used for (never activates).
      kind: 'trigger',
      event: 'synchroSummoned',
      range: ALL_LOCS,
      label: 'Torapart material',
      eventFilter: (ctx, ev) => {
        const s = evc(ev);
        const mats = (s?.flags.materials ?? []) as { uid: number }[];
        if (s && mats.some((m) => m.uid === ctx.self.uid)) s.flags.rgbtTorapart = ctx.self.uid;
        return false;
      },
    },
    {
      kind: 'continuous',
      range: ALL_LOCS,
      mods: [
        {
          q: 'cannotActivateTraps',
          to: 'players',
          filter: (ctx, p: PlayerId) => {
            const a = ctx.game.battle?.attacker;
            return !!a && a.flags.rgbtTorapart === ctx.self.uid && faceUpOn(a) && a.controller !== p;
          },
        },
      ],
    },
  ],
});

monster('Earthbound Immortal Aslla piscu', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 10,
  atk: 2500,
  def: 2500,
  sets: ['earthbound-immortal'],
  aiValue: 800,
  text: 'There can only be 1 "Earthbound Immortal" monster on the field. If there is no face-up Field Spell on the field, destroy this card. Your opponent\'s monsters cannot target this card for attacks. This card can attack directly. If this face-up card leaves the field, except by its own effect: Destroy as many face-up monsters your opponent controls as possible, and if you do, inflict 800 damage to your opponent for each monster destroyed.',
  effects: [
    ...earthboundRules(),
    {
      kind: 'trigger',
      event: 'leftField',
      range: ALL_LOCS,
      mandatory: true,
      label: 'Destroy face-up monsters: 800 damage each',
      categories: ['destroy', 'destroyMulti', 'damage'],
      // Not when it is returned to the Deck or banished face-down: https://edisonrul.ing/cards/e/earthbound-immortal-aslla-piscu.html
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self &&
        ev.from === 'mzone' &&
        ev.fromFaceUp !== false &&
        ev.reasonCard !== ctx.self &&
        ev.to !== 'deck' &&
        ev.to !== 'extra' &&
        !(ev.to === 'banished' && !ctx.self.faceUp),
      resolve: async (ctx) => {
        const fc = ctx.event?.fromController ?? ctx.player;
        const opp = ctx.game.opp(fc);
        const victims = ctx.game.faceUpMonsters(opp);
        if (!victims.length) return;
        const d = await ctx.game.destroy(victims, 'effect', fc, ctx.self);
        const n = d.filter((c) => c.location !== 'mzone').length;
        if (n) await ctx.game.damage(opp, 800 * n, 'effect', ctx.self, fc);
      },
    },
  ],
});

monster('Earthbound Immortal Ccapac Apu', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 10,
  atk: 3000,
  def: 2500,
  sets: ['earthbound-immortal'],
  aiValue: 700,
  text: 'There can only be 1 "Earthbound Immortal" monster on the field. If there is no face-up Field Spell on the field, destroy this card. Your opponent\'s monsters cannot target this card for attacks. This card can attack directly. If this card destroys an opponent\'s monster by battle: Inflict damage to your opponent equal to the destroyed monster\'s original ATK.',
  effects: [
    ...earthboundRules(),
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Damage equal to original ATK',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return ev.other === ctx.self && !!c && (ev.fromController ?? c.owner) !== ctx.player && (ctx.self.location === 'mzone' || ctx.self.location === 'grave');
      },
      resolve: async (ctx) => {
        const c = evc(ctx.event!)!;
        const atk = c.data.atk ?? 0;
        if (atk > 0) await ctx.damage(ctx.opp, atk);
      },
    },
  ],
});

// ---- Koa'ki Meiru ----

monster("Koa'ki Meiru Valafar", {
  attribute: 'FIRE',
  race: 'Fiend',
  level: 8,
  atk: 3000,
  def: 2100,
  sets: ['koaki-meiru'],
  aiValue: 400,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard. You can Tribute Summon this monster by Tributing 1 "Koa\'ki Meiru" monster. This card cannot be destroyed by the effects of Trap Cards. During battle between this attacking card and a Defense Position monster whose DEF is lower than the ATK of this card, inflict the difference as Battle Damage to your opponent.',
  effects: [
    koakiUpkeep(null, null),
    { kind: 'continuous', range: ['hand'], altTribute: (ctx, summoned, tribute) => summoned === ctx.self && isKoakiMonster(tribute) },
    {
      // "Cannot be destroyed by the effects of Trap Cards" (per-source protection through the ABPF per-card hook).
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card, reason, rc) => card === ctx.self && reason === 'effect' && !!rc && rc.isTrap,
    },
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
  ],
});

monster("Koa'ki Meiru Powerhand", {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 2100,
  def: 1600,
  sets: ['koaki-meiru'],
  aiValue: 200,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 Normal Trap Card in your hand. If this card battles a LIGHT or DARK monster, any of that monster\'s effects that activate or apply on the field are negated during that Battle Phase, while this card remains on the field.',
  effects: [
    koakiUpkeep('Normal Trap Card', (c) => c.isTrap && c.data.ttype === 'normal'),
    {
      // Remembers the LIGHT/DARK monsters it battled (never activates).
      kind: 'trigger',
      event: 'damageStepEnd',
      label: 'Powerhand battle',
      eventFilter: (ctx, ev) => {
        const o = ev.card === ctx.self ? evo(ev) : ev.other === ctx.self ? evc(ev) : undefined;
        if (o && faceUpOn(o) && isLightOrDark(o)) o.flags.rgbtPowerhand = { src: ctx.self.uid, turn: ctx.turn };
        return false;
      },
    },
    {
      kind: 'continuous',
      active: selfNotNegated,
      mods: [
        {
          q: 'negated',
          to: 'cards',
          filter: (ctx, c: C) => {
            if (!faceUpOn(c) || c.controller === ctx.player || !isLightOrDark(c) || ctx.phase !== 'battle') return false;
            const b = ctx.game.battle;
            if (b && b.inDamageStep && battleOpponent(ctx) === c) return true;
            const f = c.flags.rgbtPowerhand as { src: number; turn: number } | undefined;
            return !!f && f.src === ctx.self.uid && f.turn === ctx.turn;
          },
        },
      ],
    },
  ],
});

monster("Koa'ki Meiru Guardian", {
  attribute: 'EARTH',
  race: 'Rock',
  level: 4,
  atk: 1900,
  def: 1200,
  sets: ['koaki-meiru'],
  aiValue: 500,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the GY or reveal 1 Rock monster in your hand. When a monster effect is activated (Quick Effect): You can Tribute this card; negate the activation, and if you do, destroy that monster.',
  effects: [
    koakiUpkeep('Rock-Type monster', (c) => isRace(c, 'Rock')),
    {
      kind: 'quick',
      label: 'Tribute: negate a monster effect',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.card.isMonster && !l.isCardActivation && l.card !== ctx.self;
      },
      canActivate: (ctx) => tributable(ctx, ctx.self),
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        const l = ctx.data.link as ChainLink | undefined;
        if (!l) return;
        ctx.negate(l);
        if (l.card.onField) await ctx.destroy(l.card);
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp) return 0;
          const cats = l.effect.categories ?? [];
          return cats.some((c) => ['destroy', 'destroyMulti', 'control', 'specialSummon', 'search', 'draw', 'banish', 'negate'].includes(c)) ? 60 : 35;
        },
      },
    },
  ],
});

monster("Koa'ki Meiru Drago", {
  attribute: 'WIND',
  race: 'Dragon',
  level: 4,
  atk: 1900,
  def: 1600,
  sets: ['koaki-meiru'],
  aiValue: 400,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the GY or reveal 1 Dragon monster in your hand. Neither player can Special Summon LIGHT or DARK monsters.',
  effects: [
    PATCH_LISTENER,
    koakiUpkeep('Dragon-Type monster', (c) => isRace(c, 'Dragon')),
    // "Neither player can Special Summon LIGHT or DARK monsters": see ensureRgbtPatches (specialSummon wrappers).
    { kind: 'continuous', label: 'No LIGHT/DARK Special Summons' },
  ],
});

monster("Koa'ki Meiru Ice", {
  attribute: 'WATER',
  race: 'Aqua',
  level: 4,
  atk: 1900,
  def: 1200,
  sets: ['koaki-meiru'],
  aiValue: 400,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 Continuous Spell Card in your hand. You can send 1 card from your hand to the Graveyard to destroy 1 Special Summoned monster on the field.',
  effects: [
    koakiUpkeep('Continuous Spell Card', (c) => c.isSpell && c.data.stype === 'continuous'),
    {
      kind: 'ignition',
      label: 'Discard: destroy a Special Summoned monster',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.monsters('both', isSpecialSummoned).length > 0,
      activate: async (ctx) => {
        const [d] = await ctx.select(ctx.hand(), 1, 1, 'Send 1 card from your hand to the GY.', 'cost', {
          aiScore: (c) => -cardValue(ctx.game, c) + (isIronCore(c) ? -3000 : 0),
        });
        if (!d) return false;
        await ctx.sendToGrave(d, 'cost');
      },
      resolve: async (ctx) => {
        const cands = ctx.monsters('both', isSpecialSummoned);
        const [t] = await ctx.select(cands, 1, 1, 'Destroy 1 Special Summoned monster on the field.', 'destroy');
        if (t) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const t = bestTarget(ctx.game, ctx.monsters('opp', isSpecialSummoned));
          if (!t || cardValue(ctx.game, t) < 1600) return 0;
          const cheap = ctx.hand('me', (c) => !isIronCore(c) || ctx.hand('me', isIronCore).length > 1);
          return cheap.length ? 55 : 0;
        },
      },
    },
  ],
});

monster("Koa'ki Meiru Doom", {
  attribute: 'WIND',
  race: 'Fiend',
  level: 3,
  atk: 1700,
  def: 800,
  sets: ['koaki-meiru'],
  aiValue: 400,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 Fiend-Type monster in your hand. Negate the effects of LIGHT and DARK monsters that activate during the Main Phase.',
  effects: [
    koakiUpkeep('Fiend-Type monster', (c) => isRace(c, 'Fiend')),
    {
      // APPROX: applied the moment the effect is activated (as Light-Imprisoning Mirror does in this engine).
      kind: 'trigger',
      event: 'chainActivated',
      label: "Koa'ki Meiru Doom (negate)",
      eventFilter: (ctx, ev) => {
        const link = ev.data?.link as ChainLink | undefined;
        if (!link || link.negated || !isMain(ctx) || !monActive(ctx)) return false;
        const c = link.card;
        if (c.isMonster && !link.isCardActivation && isLightOrDark(c)) ctx.game.negateLink(link, false, ctx.self);
        return false;
      },
    },
  ],
});

monster('Brain Golem', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 6,
  atk: 2500,
  def: 1800,
  aiValue: 300,
  text: 'Effects of face-up LIGHT monsters are negated. If this card destroys a LIGHT monster by battle, it can attack once again in a row.',
  effects: [
    { kind: 'continuous', active: selfNotNegated, mods: [{ q: 'negated', to: 'cards', filter: (_ctx, c: C) => faceUpOn(c) && isLight(c) }] },
    {
      // APPROX: the second attack can be declared any time later in this Battle Phase.
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Attack again',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && faceUpOn(ctx.self) && !!evc(ev) && isAttr(evc(ev)!, 'LIGHT'),
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self)) ctx.addTempMod(ctx.self, 'extraAttacks', 1, 'turn');
      },
    },
  ],
});

const centaurCands = (ctx: Ctx) => ctx.deck('me', (c) => isNormalMonster(c) && lvl(c) === 4 && isRace(c, 'Beast-Warrior') && ctx.canSummonCard(c));
monster('Minoan Centaur', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 6,
  atk: 1800,
  def: 1000,
  nomi: true, // "This card cannot be Special Summoned"
  aiValue: 200,
  text: 'This card cannot be Special Summoned. You can Tribute this card to Special Summon 2 Level 4 Beast-Warrior-Type Normal Monsters from your Deck.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute: summon 2 Beast-Warriors',
      categories: ['specialSummon'],
      canActivate: (ctx) => tributable(ctx, ctx.self) && canSS(ctx) && ctx.freeMZones() + 1 >= 2 && centaurCands(ctx).length >= 2,
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        const cands = centaurCands(ctx);
        if (cands.length < 2 || ctx.freeMZones() < 2 || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 2, 2, 'Special Summon 2 Level 4 Beast-Warrior-Type Normal Monsters.', 'specialSummon');
        if (sel.length === 2) await ctx.specialSummon(sel, { pos: 'choose' });
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 50 },
    },
  ],
});

monster('Reinforced Human Psychic Borg', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 4,
  atk: 1500,
  def: 800,
  aiValue: 200,
  text: 'Up to twice per turn, you can remove from play 1 Psychic-Type monster from your Graveyard to have this card gain 500 ATK.',
  effects: [
    {
      kind: 'ignition',
      label: 'Banish a Psychic: +500 ATK',
      categories: ['atkChange'],
      condition: (ctx) => {
        const f = ctx.self.flags.rgbtBorg as { turn: number; n: number } | undefined;
        return !f || f.turn !== ctx.turn || f.n < 2;
      },
      canActivate: (ctx) => ctx.grave('me', (c) => isRace(c, 'Psychic')).length > 0,
      activate: async (ctx) => {
        const [b] = await ctx.select(ctx.grave('me', (c) => isRace(c, 'Psychic')), 1, 1, 'Banish 1 Psychic-Type monster from your GY.', 'cost');
        if (!b) return false;
        const f = ctx.self.flags.rgbtBorg as { turn: number; n: number } | undefined;
        ctx.self.flags.rgbtBorg = { turn: ctx.turn, n: f && f.turn === ctx.turn ? f.n + 1 : 1 };
        await ctx.banish(b, 'cost');
      },
      resolve: async (ctx) => {
        if (monActive(ctx)) ctx.addTempMod(ctx.self, 'atk', 500, 'field');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || !ctx.game.canAttack(ctx.self) || ctx.turn <= 1) return 0;
          const atk = ctx.atk(ctx.self);
          const opp = ctx.faceUpMonsters('opp').map((m) => battleStat(ctx, m));
          // Beat a monster we could not beat before.
          return opp.some((s) => s >= atk && s < atk + 500) ? 40 : 0;
        },
      },
    },
  ],
});

monster('Master Gig', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 8,
  atk: 2600,
  def: 1400,
  aiValue: 600,
  text: 'Once per turn, you can pay 1000 Life Points to destroy monsters your opponent controls equal to the number of face-up Psychic-Type monsters you control.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Pay 1000 LP: destroy monsters',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.lp > 1000 && ctx.monsters('opp').length > 0,
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        const n = ctx.faceUpMonsters('me', (c) => isRace(c, 'Psychic')).length;
        const opp = ctx.monsters('opp');
        if (!n || !opp.length) return;
        const sel = await ctx.select(opp, Math.min(n, opp.length), Math.min(n, opp.length), `Destroy ${n} monster(s) your opponent controls.`, 'destroy');
        if (sel.length) await ctx.destroy(sel);
      },
      ai: { score: (ctx) => (ctx.lp > 2500 && ctx.monsters('opp').length ? 55 : 0) },
    },
  ],
});

monster('Emissary from Pandemonium', {
  attribute: 'EARTH',
  race: 'Fiend',
  level: 7,
  atk: 2600,
  def: 1800,
  types: ['tuner'],
  nomi: true, // "This card cannot be Special Summoned"
  aiValue: 100,
  text: 'This card cannot be Special Summoned. You can Normal Summon this card with 1 Tribute. If you do, it becomes Level 5 and its original ATK and DEF are halved.',
  effects: [
    // 2010 ruling: it cannot be Set by Tributing just 1 monster (the 1-Tribute rule is a Normal Summon only).
    // https://edisonrul.ing/cards/e/emissary-from-pandemonium.html
    { kind: 'continuous', range: ['hand'], altTribute: (ctx, summoned) => summoned === ctx.self, altTributeNoSet: true },
    {
      // Applies the 1-Tribute penalty (never activates).
      kind: 'trigger',
      event: ['normalSummoned', 'flipped'],
      range: ['mzone'],
      label: 'Level 5, halved ATK/DEF',
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        if (ev.card === me && me.flags.tributeCount === 1 && !me.flags.rgbtHalved) {
          me.flags.rgbtHalved = true;
          me.flags.baseLevel = 5;
          me.flags.baseAtk = Math.floor((me.data.atk ?? 0) / 2);
          me.flags.baseDef = Math.floor((me.data.def ?? 0) / 2);
        }
        return false;
      },
    },
  ],
});

monster('Gigastone Omega', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 5,
  atk: 1000,
  def: 2300,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 500,
  text: 'This card cannot be Normal Summoned or Set. This card can only be Special Summoned by removing from play 2 EARTH monsters from your Graveyard. When this face-up card you control is sent to the Graveyard by a card effect, destroy all Spell and Trap Cards your opponent controls.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (banish 2 EARTH)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.grave('me', (c) => isAttr(c, 'EARTH')).length >= 2,
      perform: async (ctx) => {
        const s = await ctx.select(ctx.grave('me', (c) => isAttr(c, 'EARTH')), 2, 2, 'Banish 2 EARTH monsters from your GY.', 'cost', {
          aiScore: (c) => -(c.data.aiValue ?? 0) - (c.data.atk ?? 0) / 10,
        });
        if (s.length < 2) return false;
        await ctx.banish(s, 'cost');
        return true;
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp').length >= 2 || ctx.monsters('me').length === 0 ? 55 : 30) },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: "Destroy all opponent's Spells/Traps",
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && ev.fromFaceUp === true && ev.fromController === ctx.player && byCardEffect(ev),
      resolve: async (ctx) => {
        const st = ctx.spellTraps('opp');
        if (st.length) await ctx.destroy(st);
      },
    },
  ],
});

monster('Alien Dog', {
  attribute: 'LIGHT',
  race: 'Reptile',
  level: 3,
  atk: 1500,
  def: 1000,
  sets: ['alien'],
  aiValue: 100,
  text: 'When you Normal Summon an "Alien" monster, you can Special Summon this card from your hand. When you do, place 2 A-Counters on face-up monster(s) your opponent controls.',
  effects: [
    {
      // A-Counter rule (same as crms.ts alienBattleRule): a monster with A-Counters battling this "Alien"
      // loses 300 ATK and DEF for each A-Counter during damage calculation.
      kind: 'continuous',
      mods: (['atk', 'def'] as const).map((q) => ({
        q,
        to: 'cards' as const,
        filter: (ctx: Ctx, c: C) => {
          const b = ctx.battle;
          if (!b || !b.inDamageStep || (c.counters.A ?? 0) <= 0) return false;
          return (b.attacker === ctx.self && b.target === c) || (b.target === ctx.self && b.attacker === c);
        },
        value: (_ctx: Ctx, c: C) => -300 * (c.counters.A ?? 0),
      })),
    },
    {
      kind: 'trigger',
      event: 'normalSummoned',
      range: ['hand'],
      when: true,
      label: 'Special Summon (Alien)',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c !== ctx.self && c.controller === ctx.player && isAlien(c);
      },
      condition: (ctx) => ctx.canSummonSelf(),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'hand' || !ctx.canSpecialSummon()) return;
        const r = await ctx.specialSummon(ctx.self, { pos: aiPos(ctx, ctx.self) });
        if (!r.length) return;
        for (let i = 0; i < 2; i++) {
          const opp = ctx.faceUpMonsters('opp');
          if (!opp.length) break;
          const [m] = await ctx.select(opp, 1, 1, 'Place 1 A-Counter on a face-up monster your opponent controls.', 'target');
          if (!m) break;
          // A-Counters live in `card.counters.A` (crms.ts / glas.ts).
          m.counters.A = (m.counters.A ?? 0) + 1;
          ctx.log(`An A-Counter is placed on ${m.name}.`);
        }
        ctx.game.update();
      },
      ai: { score: () => 45 },
    },
  ],
});

monster('Spined Gillman', {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 3,
  atk: 1300,
  def: 0,
  aiValue: 300,
  text: 'All Fish, Sea Serpent, and Aqua-Type monsters you control gain 400 ATK.',
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.player && isRace(c, 'Fish', 'Sea Serpent', 'Aqua'), value: 400 }],
    },
  ],
});

monster('Deep Sea Diva', {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 2,
  atk: 200,
  def: 400,
  types: ['tuner'],
  aiValue: 600,
  text: 'When this card is Normal Summoned: You can Special Summon 1 Level 3 or lower Sea Serpent monster from your Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Summon a Sea Serpent',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => isRace(c, 'Sea Serpent') && lvl(c) <= 3 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        await summonFromDeck(ctx, (c) => isRace(c, 'Sea Serpent') && lvl(c) <= 3, 'Special Summon 1 Level 3 or lower Sea Serpent monster from your Deck.');
      },
      ai: { score: () => 60 },
    },
  ],
});

function archerEquip(ctx: Ctx): C | undefined {
  return ctx.game.equipsOf(ctx.self).find((c) => c.isMonster && c.flags.rgbtArcher === ctx.self.uid);
}
monster('Mermaid Archer', {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 3,
  atk: 1200,
  def: 200,
  aiValue: 300,
  text: 'Once per turn: You can target 1 face-up Level 3 or lower monster you control; equip that target to this card. (You can only equip 1 monster at a time to this card with this effect.) While equipped with a monster by this effect, this card gains 800 ATK. If this card would be destroyed, you can destroy the monster equipped to it with this effect, instead.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Equip a Level 3 or lower monster',
      categories: ['atkChange'],
      canActivate: (ctx) => !archerEquip(ctx) && ctx.freeSZones() > 0 && ctx.faceUpMonsters('me', (c) => c !== ctx.self && ctx.level(c) <= 3).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => c !== ctx.self && ctx.level(c) <= 3), 1, 1, 'Target 1 face-up Level 3 or lower monster you control.', 'cost');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c) && c.controller === ctx.player && ctx.level(c) <= 3)[0];
        if (!t || !monActive(ctx) || archerEquip(ctx)) return;
        if (equipMonster(ctx, t, ctx.self)) t.flags.rgbtArcher = ctx.self.uid;
      },
      ai: {
        score: (ctx) =>
          ctx.phase === 'main1' && ctx.faceUpMonsters('me', (c) => c !== ctx.self && ctx.level(c) <= 3 && cardValue(ctx.game, c) < 1300 && !c.isTuner).length ? 35 : 0,
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => (archerEquip(ctx) ? 800 : 0) }] },
    {
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card) => {
        if (card !== ctx.self) return false;
        const eq = archerEquip(ctx);
        if (!eq) return false;
        if (!(await ctx.confirm(`Destroy ${eq.name} instead of ${ctx.self.name}?`, true))) return false;
        await ctx.game.destroy([eq], 'effect', ctx.player, ctx.self);
        return eq.location !== 'szone';
      },
    },
  ],
});

const lavaHand = (ctx: Ctx) => ctx.hand('me', (c) => isRace(c, 'Dragon') && lvl(c) <= 3 && ctx.canSummonCard(c));
const lavaGrave = (ctx: Ctx) => ctx.grave('me', (c) => c !== ctx.self && isRace(c, 'Dragon') && lvl(c) <= 3 && ctx.canSummonCard(c));
monster('Lava Dragon', {
  attribute: 'FIRE',
  race: 'Dragon',
  level: 4,
  atk: 1600,
  def: 1200,
  aiValue: 200,
  text: 'You can Tribute this face-up Defense Position card to Special Summon 2 Level 3 or lower Dragon-Type monsters: 1 from your hand, and 1 from your Graveyard.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute: summon 2 Dragons',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.self.pos === 'def',
      canActivate: (ctx) => tributable(ctx, ctx.self) && canSS(ctx) && ctx.freeMZones() + 1 >= 2 && lavaHand(ctx).length > 0 && lavaGrave(ctx).length > 0,
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        const h = lavaHand(ctx);
        const gr = lavaGrave(ctx);
        if (!h.length || !gr.length || ctx.freeMZones() < 2 || !ctx.canSpecialSummon()) return;
        const [a] = await ctx.select(h, 1, 1, 'Special Summon 1 Level 3 or lower Dragon from your hand.', 'specialSummon');
        const [b] = await ctx.select(gr, 1, 1, 'Special Summon 1 Level 3 or lower Dragon from your GY.', 'specialSummon');
        if (a && b) await ctx.specialSummon([a, b], { pos: 'choose' });
      },
      ai: { score: () => 45 },
    },
  ],
});

monster('Vanguard of the Dragon', {
  attribute: 'EARTH',
  race: 'Dragon',
  level: 4,
  atk: 1700,
  def: 1300,
  aiValue: 200,
  text: "You can send 1 Dragon monster from your hand to the GY; this card gains 300 ATK. When this card you control is sent to your GY by an opponent's card effect: You can target 1 Dragon Normal Monster in either GY; Special Summon that target.",
  effects: [
    {
      kind: 'ignition',
      label: 'Send a Dragon: +300 ATK',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.hand('me', (c) => isRace(c, 'Dragon')).length > 0,
      activate: async (ctx) => {
        const [d] = await ctx.select(ctx.hand('me', (c) => isRace(c, 'Dragon')), 1, 1, 'Send 1 Dragon monster from your hand to the GY.', 'cost');
        if (!d) return false;
        await ctx.sendToGrave(d, 'cost');
      },
      resolve: async (ctx) => {
        if (monActive(ctx)) ctx.addTempMod(ctx.self, 'atk', 300, 'field');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || !ctx.game.canAttack(ctx.self) || ctx.turn <= 1) return 0;
          const atk = ctx.atk(ctx.self);
          const fodder = ctx.hand('me', (c) => isRace(c, 'Dragon') && (c.data.atk ?? 0) < 1500);
          return fodder.length && ctx.faceUpMonsters('opp').some((m) => battleStat(ctx, m) >= atk && battleStat(ctx, m) < atk + 300) ? 35 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Revive a Dragon Normal Monster',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && ev.fromController === ctx.player && ev.reasonPlayer === ctx.opp && byCardEffect(ev),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('both', (c) => isNormalMonster(c) && isRace(c, 'Dragon') && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('both', (c) => isNormalMonster(c) && isRace(c, 'Dragon') && ctx.canSummonCard(c)), 1, 1, 'Target 1 Dragon Normal Monster in either GY.', 'specialSummon', {
          aiScore: summonScore,
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t, { pos: aiPos(ctx, t) });
      },
      ai: { score: () => 60 },
    },
  ],
});

monster('G.B. Hunter', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 1200,
  def: 2000,
  aiValue: 200,
  text: 'Cards on the field cannot be returned to the Deck.',
  // The rule itself lives in ensureRgbtPatches (moveCards wrapper).
  effects: [PATCH_LISTENER, { kind: 'continuous', label: 'Cards on the field cannot be returned to the Deck' }],
});

monster('Trident Dragion', {
  attribute: 'FIRE',
  race: 'Dragon',
  level: 10,
  atk: 3000,
  def: 2800,
  types: ['synchro'],
  nomi: true, // "Must be Synchro Summoned"
  aiValue: 400,
  text: '1 Dragon Tuner + 1+ non-Tuner Dragon monsters\nMust be Synchro Summoned. When this card is Synchro Summoned: You can target up to 2 other cards you control; destroy those targets, and if you do, for each destroyed card, this card gains 1 additional attack during each Battle Phase this turn.',
  synchro: { tuner: (c) => isRace(c, 'Dragon'), nonTuner: (c) => isRace(c, 'Dragon'), desc: '1 Dragon Tuner + 1+ non-Tuner Dragon monsters' },
  effects: [
    {
      kind: 'trigger',
      event: 'synchroSummoned',
      when: true,
      label: 'Destroy up to 2: extra attacks',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.field('me', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cands = ctx.field('me', (c) => c !== ctx.self);
        // Cheap cards first: Tokens, spent face-up Spells/Traps, weak monsters.
        const cheap = (c: C) => (c.isToken ? 3000 : 0) + (c.faceUp && !c.isMonster && c.data.stype !== 'field' ? 800 : 0) - cardValue(ctx.game, c);
        const ranked = [...cands].sort((a, b) => cheap(b) - cheap(a));
        const max = Math.min(2, cands.length);
        const k = (await ctx.option('Target how many cards?', Array.from({ length: max }, (_, i) => `${i + 1}`), (i) => (ranked.slice(0, i + 1).every((c) => cheap(c) > -1300) ? i : -1))) + 1;
        await ctx.selectTargets(cands, k, k, `Target ${k} other card(s) you control to destroy.`, 'cost', { aiScore: cheap });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField && c.controller === ctx.player && c !== ctx.self);
        if (!t.length) return;
        const d = await ctx.destroy(t);
        const n = d.filter((c) => !c.onField).length;
        if (n && faceUpOn(ctx.self)) ctx.addTempMod(ctx.self, 'extraAttacks', n, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (!ctx.isMyTurn || ctx.phase !== 'main1' || !ctx.monsters('opp').length) return 0;
          return ctx.field('me', (c) => c !== ctx.self && (c.isToken || cardValue(ctx.game, c) < 1300)).length ? 40 : 0;
        },
      },
    },
  ],
});

/** Current Level of a card as far as the Synchro material filters can tell (they get no Game). */
function levelNow(c: C) {
  let lv = c.flags.baseLevel ?? lvl(c);
  for (const t of c.tempMods) if (t.q === 'level' && typeof t.value === 'number') lv += t.value;
  if (c.data.name === 'Morphtronic Scopen' && faceUpOn(c) && c.pos === 'def') lv = 4;
  return Math.max(1, lv);
}
monster('Sea Dragon Lord Gishilnodon', {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 5,
  atk: 2300,
  def: 1800,
  types: ['synchro'],
  aiValue: 200,
  text: '1 Tuner + 1 Level 3 non-Tuner monster\nWhen a face-up Level 3 or lower monster on the field is sent to the Graveyard, this card\'s ATK becomes 3000 until the End Phase of this turn.',
  synchro: { nonTuner: (c) => levelNow(c) === 3, minNonTuners: 1, maxNonTuners: 1, desc: '1 Tuner + 1 Level 3 non-Tuner monster' },
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'ATK becomes 3000',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c !== ctx.self && c.isMonster && ev.from === 'mzone' && ev.fromFaceUp === true && lvl(c) <= 3 && faceUpOn(ctx.self);
      },
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        ctx.self.flags.setAtk = 3000;
        ctx.self.flags.setAtkTurn = ctx.turn;
        ctx.game.update();
      },
    },
  ],
});

monster('Light End Dragon', {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 8,
  atk: 2600,
  def: 2100,
  types: ['synchro'],
  aiValue: 500,
  text: '1 Tuner + 1 or more non-Tuner LIGHT monsters\nAt attack declaration, if this card battles another monster: You can have this card lose 500 ATK and DEF (permanently), and the monster this card is battling loses 1500 ATK and DEF until the End Phase.',
  synchro: { nonTuner: (c) => isLight(c), desc: '1 Tuner + 1+ non-Tuner LIGHT monsters' },
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      when: true,
      label: '-500 to this card, -1500 to the battling monster',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        const t = evo(ev);
        return faceUpOn(ctx.self) && !!a && !!t && (a === ctx.self || t === ctx.self);
      },
      activate: async (ctx) => {
        const ev = ctx.event!;
        ctx.data.other = evc(ev) === ctx.self ? evo(ev) : evc(ev);
      },
      resolve: async (ctx) => {
        const o = ctx.data.other as C | undefined;
        if (!faceUpOn(ctx.self)) return;
        ctx.addTempMod(ctx.self, 'atk', -500, 'field');
        ctx.addTempMod(ctx.self, 'def', -500, 'field');
        if (o && o.location === 'mzone') {
          ctx.addTempMod(o, 'atk', -1500, 'turn');
          ctx.addTempMod(o, 'def', -1500, 'turn');
        }
      },
      ai: {
        score: (ctx) => {
          const ev = ctx.event;
          if (!ev) return 0;
          const o = evc(ev) === ctx.self ? evo(ev) : evc(ev);
          if (!o) return 0;
          const mine = ctx.atk(ctx.self);
          if (!o.faceUp) return 0;
          if (evc(ev) === ctx.self) {
            const s = battleStat(ctx, o);
            return s >= mine && s - 1500 < mine - 500 ? 80 : 0;
          }
          const myStat = ctx.self.pos === 'atk' ? mine : ctx.def(ctx.self);
          return ctx.atk(o) >= myStat && ctx.atk(o) - 1500 < myStat - 500 ? 80 : 0;
        },
      },
    },
  ],
});

monster('Chaos-End Master', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 3,
  atk: 1500,
  def: 1000,
  types: ['tuner'],
  aiValue: 400,
  text: 'When this card destroys an opponent\'s monster by battle and sends it to the Graveyard, you can Special Summon 1 Level 5 or higher monster with 1600 or less ATK from your Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Summon a Level 5+ monster from the Deck',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev) && evc(ev)!.location === 'grave',
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => c.isMonster && lvl(c) >= 5 && (c.data.atk ?? 0) <= 1600 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        await summonFromDeck(ctx, (c) => c.isMonster && lvl(c) >= 5 && (c.data.atk ?? 0) <= 1600, 'Special Summon 1 Level 5 or higher monster with 1600 or less ATK.');
      },
      ai: { score: () => 60 },
    },
  ],
});

monster('Sphere of Chaos', {
  attribute: 'DARK',
  race: 'Machine',
  level: 5,
  atk: 1600,
  def: 0,
  aiValue: 400,
  // APPROX: "also treated as LIGHT" is known to this file's checks only (Brain Golem, Light End Dragon,
  // Koa'ki Meiru cards); cards from other files see a DARK monster.
  text: 'While this card is face-up on the field its Attribute is also treated as LIGHT. Once per turn, this card cannot be destroyed by battle. When this card is Tribute Summoned, you can add 1 Level 3 monster from your Deck to your hand.',
  effects: [
    {
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card, reason) => {
        if (card !== ctx.self || reason !== 'battle' || ctx.self.flags.rgbtSphereTurn === ctx.turn) return false;
        ctx.self.flags.rgbtSphereTurn = ctx.turn;
        ctx.log(`${ctx.self.name} is not destroyed by battle (once per turn).`);
        return true;
      },
    },
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      when: true,
      label: 'Add a Level 3 monster',
      categories: ['search'],
      canActivate: (ctx) => ctx.deck('me', (c) => c.isMonster && lvl(c) === 3).length > 0,
      resolve: async (ctx) => {
        await ctx.search((c) => c.isMonster && lvl(c) === 3, 1, 'Add 1 Level 3 monster from your Deck to your hand.');
      },
      ai: { score: () => 60 },
    },
  ],
});

monster('Snowman Eater', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 3,
  atk: 0,
  def: 1900,
  aiValue: 600,
  text: 'If this card is flipped face-up: Target 1 face-up monster on the field; destroy that target.',
  effects: [
    flip({
      label: 'Destroy 1 face-up monster',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster on the field.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.player ? -5000 - cardValue(ctx.game, c) : cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c));
        if (t.length) await ctx.destroy(t);
      },
    }),
  ],
});

const otterOk = (ctx: Ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && isRace(c, 'Beast')).length > 0;
monster('Tree Otter', {
  attribute: 'WATER',
  race: 'Beast',
  level: 2,
  atk: 1200,
  def: 100,
  aiValue: 200,
  text: 'Once per turn: You can target 1 face-up monster you control; it gains 1000 ATK until the end of this turn. You must control a Beast-Type monster (other than this card) to activate and to resolve this effect.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: '+1000 ATK',
      categories: ['atkChange'],
      condition: otterOk,
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Target 1 face-up monster you control.', 'buff', {
          aiScore: (c) => (ctx.game.canAttack(c) ? 1000 : 0) + ctx.atk(c),
        });
      },
      resolve: async (ctx) => {
        if (!otterOk(ctx)) return;
        const t = ctx.validTargets((c) => faceUpOn(c))[0];
        if (t) ctx.addTempMod(t, 'atk', 1000, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.turn <= 1) return 0;
          return ctx.faceUpMonsters('me', (c) => ctx.game.canAttack(c)).length ? 35 : 0;
        },
      },
    },
  ],
});

monster('Ojama Red', {
  attribute: 'LIGHT',
  race: 'Beast',
  level: 2,
  atk: 0,
  def: 1000,
  sets: ['ojama'],
  aiValue: 200,
  text: 'When this card is Normal Summoned: You can Special Summon up to 4 "Ojama" monsters from your hand in Attack Position.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Summon Ojama monsters from the hand',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => isOjamaMonster(c) && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => isOjamaMonster(c) && ctx.canSummonCard(c));
        const max = Math.min(4, cands.length, ctx.freeMZones());
        if (max <= 0 || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, max, 'Special Summon up to 4 "Ojama" monsters in Attack Position.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel, { pos: 'atk' });
      },
      ai: { score: (ctx) => (ctx.monsters('opp', (c) => c.faceUp && c.pos === 'atk').length ? 0 : 40) },
    },
  ],
});

monster('Ojama Blue', {
  attribute: 'LIGHT',
  race: 'Beast',
  level: 2,
  atk: 0,
  def: 1000,
  sets: ['ojama'],
  aiValue: 300,
  text: 'When this card is destroyed by battle and sent to the GY: You can add 2 "Ojama" cards from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Add 2 Ojama cards',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && reasonsOf(ev).includes('battle'),
      canActivate: (ctx) => !ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck') && ctx.deck('me', isOjama).length >= 2,
      resolve: async (ctx) => {
        if (ctx.deck('me', isOjama).length < 2) return;
        await ctx.search(isOjama, 2, 'Add 2 "Ojama" cards from your Deck to your hand.', 2);
      },
      ai: { score: () => 60 },
    },
  ],
});

monster('Emperor Sem', {
  attribute: 'LIGHT',
  race: 'Fiend',
  level: 4,
  atk: 1300,
  def: 2200,
  aiValue: 100,
  text: 'Each time you Tribute Summon a monster, each player can select 1 card from their Graveyard and return it to the top of their Deck.',
  effects: [
    {
      // 2010 rulings: an optional Trigger Effect that starts a Chain. If you activate it you must target 1 card in your
      // GY (so you need one); your opponent may also target 1 card in their GY (optional; their GY can be empty). If
      // control of this card shifts to your opponent before it resolves, nothing happens.
      // https://edisonrul.ing/cards/e/emperor-sem.html
      kind: 'trigger',
      event: 'tributeSummoned',
      label: 'Return a GY card to the top of the Deck',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) => ev.player === ctx.player && faceUpOn(ctx.self) && ev.card !== ctx.self,
      canActivate: (ctx) => ctx.grave('me').some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        const mine = await ctx.selectTargets(ctx.grave('me'), 1, 1, 'Target 1 card in your GY to return to the top of your Deck.', 'toDeck', {
          aiScore: (x) => cardValue(ctx.game, x),
        });
        if (!mine.length) return false;
        const theirs = ctx.grave('opp').filter((c) => ctx.canTarget(c));
        if (!theirs.length) return;
        const best = bestTarget(ctx.game, theirs);
        const want = !!best && cardValue(ctx.game, best) >= 1800;
        if (!(await ctx.game.confirm(ctx.opp, 'Emperor Sem: target 1 card in your GY to return to the top of your Deck?', ctx.self, want))) return;
        const [c] = await ctx.select(theirs, 1, 1, 'Target 1 card in your GY to return to the top of your Deck.', 'toDeck', { player: ctx.opp, aiScore: (x) => cardValue(ctx.game, x) });
        if (c) ctx.addTargets([c]);
      },
      resolve: async (ctx) => {
        if (ctx.self.controller !== ctx.player) return;
        for (const t of ctx.validTargets((c) => c.location === 'grave')) await ctx.game.toDeck([t], 'effect', 'top', t.owner, ctx.self);
      },
      ai: { score: (ctx) => (bestTarget(ctx.game, ctx.grave('me')) ? 30 : 0) },
    },
  ],
});

function warArmsEquips(ctx: Ctx): C[] {
  return ctx.game.equipsOf(ctx.self).filter((c) => c.isMonster && c.flags.rgbtWarArms === ctx.self.uid);
}
monster("Koa'ki Meiru War Arms", {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 1400,
  def: 1200,
  sets: ['koaki-meiru'],
  aiValue: 400,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 Warrior-Type monster in your hand. Once per turn: You can target 1 Level 3 or lower Warrior-Type monster in your Graveyard; equip that target to this card. This card gains ATK equal to half the combined ATK of the monsters equipped to it by this effect. If this card would be destroyed by battle, destroy all monsters equipped to it by this effect instead.',
  effects: [
    koakiUpkeep('Warrior-Type monster', (c) => isRace(c, 'Warrior')),
    {
      kind: 'ignition',
      opt: true,
      label: 'Equip a Warrior from the GY',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.freeSZones() > 0 && ctx.grave('me', (c) => isRace(c, 'Warrior') && lvl(c) <= 3).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isRace(c, 'Warrior') && lvl(c) <= 3), 1, 1, 'Target 1 Level 3 or lower Warrior in your GY.', 'equip', {
          aiScore: (c) => c.data.atk ?? 0,
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !monActive(ctx)) return;
        if (equipMonster(ctx, t, ctx.self)) t.flags.rgbtWarArms = ctx.self.uid;
      },
      ai: { score: () => 40 },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => Math.floor(warArmsEquips(ctx).reduce((a, c) => a + (c.data.atk ?? 0), 0) / 2) }] },
    {
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card, reason) => {
        if (card !== ctx.self || reason !== 'battle') return false;
        const eqs = warArmsEquips(ctx);
        if (!eqs.length) return false;
        await ctx.game.destroy(eqs, 'effect', ctx.player, ctx.self);
        return eqs.some((e) => e.location !== 'szone');
      },
    },
  ],
});

monster('Immortal Ruler', {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 4,
  atk: 1800,
  def: 200,
  nomi: true, // "Cannot be Special Summoned"
  aiValue: 200,
  text: 'Cannot be Special Summoned. You can Tribute this card, then target 1 "Zombie World" in your GY; add that target to your hand.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute: add Zombie World',
      categories: ['toHand'],
      canActivate: (ctx) => tributable(ctx, ctx.self) && ctx.grave('me', (c) => c.name === 'Zombie World').length > 0,
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
        await ctx.selectTargets(ctx.grave('me', (c) => c.name === 'Zombie World'), 1, 1, 'Target 1 "Zombie World" in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
      ai: {
        score: (ctx) => (ctx.cards('me', ['hand', 'fzone'], (c) => c.name === 'Zombie World').length || ctx.phase !== 'main2' ? 0 : 35),
      },
    },
  ],
});

monster('Hardened Armed Dragon', {
  attribute: 'EARTH',
  race: 'Dragon',
  level: 4,
  atk: 1500,
  def: 800,
  aiValue: 300,
  text: '(This card is not treated as an "Armed Dragon" card.)\nYou can Special Summon this card (from your hand) by sending 1 Level 8 or higher monster from your hand to the GY. If you Tribute this card for the Tribute Summon of a Level 7 or higher monster, that monster cannot be destroyed by card effects.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (send a Level 8+ monster)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.hand('me', (c) => c !== ctx.self && c.isMonster && lvl(c) >= 8).length > 0,
      perform: async (ctx) => {
        const [s] = await ctx.select(ctx.hand('me', (c) => c !== ctx.self && c.isMonster && lvl(c) >= 8), 1, 1, 'Send 1 Level 8 or higher monster from your hand to the GY.', 'cost');
        if (!s) return false;
        await ctx.sendToGrave(s, 'cost');
        return true;
      },
      ai: {
        score: (ctx) => {
          const big = ctx.hand('me', (c) => c !== ctx.self && c.isMonster && lvl(c) >= 8);
          // Worth it with a second big monster to Tribute Summon, or a big monster that is hard to use anyway.
          return big.length >= 2 || big.some((c) => c.data.cannotNormalSummon || c.data.nomi) ? 45 : 0;
        },
      },
    },
    {
      // Grants the protection when it is Tributed for a Level 7+ Tribute Summon (never activates).
      kind: 'trigger',
      event: 'tributeSummoned',
      range: ALL_LOCS,
      label: 'Tribute: cannot be destroyed by card effects',
      eventFilter: (ctx, ev) => {
        const s = evc(ev);
        if (s && s.location === 'mzone' && (ev.tributes ?? []).includes(ctx.self) && lvl(s) >= 7) {
          ctx.game.addTempMod(s, 'indestructibleEffect', true, 'field', ctx.self);
          ctx.game.log(`${s.name} cannot be destroyed by card effects (Hardened Armed Dragon).`, 'action', s.controller);
        }
        return false;
      },
    },
  ],
});

monster('Moja', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 1,
  atk: 100,
  def: 100,
  aiValue: 200,
  text: 'When this card is destroyed by battle and sent to the Graveyard, you can add 1 Level 4 Beast-Type monster from your Graveyard to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Add a Level 4 Beast from the GY',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && reasonsOf(ev).includes('battle'),
      canActivate: (ctx) => ctx.grave('me', (c) => isRace(c, 'Beast') && lvl(c) === 4).length > 0,
      resolve: async (ctx) => {
        const [c] = await ctx.select(ctx.grave('me', (c) => isRace(c, 'Beast') && lvl(c) === 4), 1, 1, 'Add 1 Level 4 Beast-Type monster from your GY to your hand.', 'toHand');
        if (c) await ctx.toHand(c);
      },
      ai: { score: () => 60 },
    },
  ],
});

monster('Beast Striker', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 4,
  atk: 1850,
  def: 400,
  aiValue: 300,
  text: 'Once per turn, you can discard 1 card to Special Summon 1 "Moja" from your Deck.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Discard: summon Moja',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.canSpecialSummon() && ctx.deck('me', (c) => c.name === 'Moja').length > 0,
      activate: async (ctx) => {
        const [d] = await ctx.select(ctx.hand(), 1, 1, 'Discard 1 card.', 'discard', { aiScore: (c) => -cardValue(ctx.game, c) + (c.name === 'King of the Beasts' ? -5000 : 0) });
        if (!d) return false;
        await ctx.discard(d, 'cost');
      },
      resolve: async (ctx) => {
        // No position is specified: either Attack or Defense Position.
        await summonFromDeck(ctx, (c) => c.name === 'Moja', 'Special Summon 1 "Moja" from your Deck.', ctx.game.controllers[ctx.player]?.isHuman ? 'choose' : 'def');
      },
      ai: {
        score: (ctx) => {
          const king = ctx.cards('me', ['hand', 'grave'], (c) => c.name === 'King of the Beasts').length > 0;
          if (king) return 55;
          return ctx.hand().length >= 4 && synchroOptions(ctx).length === 0 ? 20 : 0;
        },
      },
    },
  ],
});

monster('King of the Beasts', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 7,
  atk: 2500,
  def: 800,
  aiValue: 300,
  text: 'You can Tribute 1 face-up "Moja" you control to Special Summon this card from your hand or Graveyard. There can only be 1 face-up "King of the Beasts" on the field.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'proc',
      range: ['hand', 'grave'],
      label: 'Special Summon (Tribute Moja)',
      categories: ['specialSummon'],
      condition: (ctx) => !faceUpKing(ctx.game) && ctx.faceUpMonsters('me', (c) => c.name === 'Moja' && tributable(ctx, c)).length > 0,
      perform: async (ctx) => {
        const [m] = await ctx.select(ctx.faceUpMonsters('me', (c) => c.name === 'Moja' && tributable(ctx, c)), 1, 1, 'Tribute 1 face-up "Moja".', 'tribute');
        if (!m) return false;
        await tributeCost(ctx, [m]);
        return true;
      },
    },
    {
      // A second face-up "King of the Beasts" (Summoned by another effect or flipped) is sent to the GY.
      kind: 'trigger',
      event: ['summoned', 'flipped'],
      mandatory: true,
      label: 'Only 1 King of the Beasts',
      eventFilter: (ctx, ev) => ev.card === ctx.self && faceUpOn(ctx.self) && faceUpKing(ctx.game, ctx.self),
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self) && faceUpKing(ctx.game, ctx.self)) await ctx.game.moveCards([ctx.self], 'grave', { reason: 'rule', reasonPlayer: ctx.player, reasonCard: ctx.self });
      },
    },
  ],
});

// =================================================================== SPELLS

const oneForOneTargets = (ctx: Ctx, except?: C) =>
  ctx.cards('me', ['hand', 'deck'], (c) => c !== except && c.isMonster && lvl(c) === 1 && !c.isExtra && ctx.canSummonCard(c));
spell('One for One', 'normal', {
  text: 'Send 1 monster from your hand to the GY; Special Summon 1 Level 1 monster from your hand or Deck.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => {
        if (!ctx.canSpecialSummon()) return false;
        const hand = ctx.hand('me', (c) => c.isMonster);
        return hand.some((h) => oneForOneTargets(ctx, h).length > 0);
      },
      activate: async (ctx) => {
        const hand = ctx.hand('me', (c) => c.isMonster && oneForOneTargets(ctx, c).length > 0);
        const [s] = await ctx.select(hand, 1, 1, 'Send 1 monster from your hand to the GY.', 'cost', {
          aiScore: (c) => -cardValue(ctx.game, c) + (lvl(c) >= 7 ? 600 : 0) - (lvl(c) === 1 ? 1500 : 0),
        });
        if (!s) return false;
        await ctx.sendToGrave(s, 'cost');
      },
      resolve: async (ctx) => {
        const cands = oneForOneTargets(ctx);
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 1 monster from your hand or Deck.', 'specialSummon', {
          aiScore: (c) => summonScore(c) + (c.isTuner ? 500 : 0),
        });
        const fromDeck = c?.location === 'deck';
        if (c) await ctx.specialSummon(c, { pos: aiPos(ctx, c) });
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' && !synchroNow(ctx)) return 0;
          const best = Math.max(0, ...oneForOneTargets(ctx).map((c) => (c.data.aiValue ?? 0) + (c.isTuner ? 400 : 0)));
          return best >= 300 ? 45 : 0;
        },
      },
    },
  ],
});

const mindTrustTributes = (ctx: Ctx) =>
  ctx.monsters('me', (c) => tributable(ctx, c) && ctx.level(c) >= 2 && ctx.grave('me', (t) => t.isMonster && t.isTuner && lvl(t) <= Math.floor(ctx.level(c) / 2)).length > 0);
spell('Mind Trust', 'normal', {
  text: "Tribute 1 Level 2 or higher monster. Add 1 Tuner Monster from your Graveyard to your hand whose Level is less than or equal to half of the Tributed monster's.",
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => mindTrustTributes(ctx).length > 0,
      activate: async (ctx) => {
        const [t] = await ctx.select(mindTrustTributes(ctx), 1, 1, 'Tribute 1 Level 2 or higher monster.', 'tribute');
        if (!t) return false;
        ctx.data.level = ctx.level(t);
        await tributeCost(ctx, [t]);
      },
      resolve: async (ctx) => {
        const max = Math.floor((ctx.data.level ?? 0) / 2);
        const cands = ctx.grave('me', (c) => c.isMonster && c.isTuner && lvl(c) <= max);
        const [c] = await ctx.select(cands, 1, 1, `Add 1 Tuner (Level ${max} or lower) from your GY to your hand.`, 'toHand');
        if (c) await ctx.toHand(c);
      },
      ai: {
        score: (ctx) => (mindTrustTributes(ctx).some((c) => c.isToken || cardValue(ctx.game, c) < 1000) && isMain(ctx) ? 30 : 0),
      },
    },
  ],
});

const thornHost = (_ctx: Ctx, c: C) => c.name === 'Black Rose Dragon' || isRace(c, 'Plant');
spell('Thorn of Malice', 'equip', {
  text: 'Equip only to "Black Rose Dragon" or a Plant monster. It gains 600 ATK. If the equipped monster attacks a Defense Position monster, inflict piercing battle damage to your opponent. If the equipped monster attacks a monster, after damage calculation: The attacked monster loses 600 ATK/DEF. An opponent\'s monster that battles with the equipped monster cannot be destroyed by that battle.',
  effects: [
    equipSpell(thornHost, (ctx) => ownEquipScore(ctx, (c) => thornHost(ctx, c), 30)),
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', to: 'cards', filter: equipped, value: 600 },
        { q: 'piercing', to: 'cards', filter: equipped },
        {
          q: 'indestructibleBattle',
          to: 'cards',
          filter: (ctx, c: C) => {
            const eq = ctx.equipTarget;
            return !!eq && c !== eq && c.controller !== eq.controller && battleOpponent(ctx, eq) === c;
          },
        },
      ],
    },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Attacked monster loses 600 ATK/DEF',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => stActive(ctx) && !!ctx.equipTarget && ev.card === ctx.equipTarget && !!evo(ev) && faceUpOn(evo(ev)!),
      activate: async (ctx) => {
        ctx.data.t = evo(ctx.event!);
      },
      resolve: async (ctx) => {
        const t = ctx.data.t as C | undefined;
        if (!t || !faceUpOn(t)) return;
        ctx.addTempMod(t, 'atk', -600, 'field');
        ctx.addTempMod(t, 'def', -600, 'field');
      },
    },
  ],
});

const cloverFodder = (ctx: Ctx) => ctx.hand('me', (c) => isRace(c, 'Plant') && lvl(c) === 4);
spell('Wonder Clover', 'normal', {
  text: 'Select 1 face-up monster you control and send 1 Level 4 Plant-Type monster from your hand to the Graveyard. During this turn, the selected monster can attack twice, but other monsters you control cannot declare an attack.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0 && cloverFodder(ctx).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Select 1 face-up monster you control.', 'buff', { aiScore: (c) => ctx.atk(c) });
        const [p] = await ctx.select(cloverFodder(ctx), 1, 1, 'Send 1 Level 4 Plant-Type monster from your hand to the GY.', 'cost');
        if (p) await ctx.sendToGrave(p, 'cost');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c))[0];
        const list = (ctx.game.turnData['rgbt:clover'] ??= []) as { player: PlayerId; uid: number; moveId: number }[];
        list.push({ player: ctx.player, uid: t?.uid ?? -1, moveId: t?.moveId ?? -1 });
        if (t) ctx.addTempMod(t, 'extraAttacks', 1, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.turn <= 1) return 0;
          const attackers = ctx.faceUpMonsters('me', (c) => ctx.game.canAttack(c));
          if (attackers.length !== 1) return 0;
          const a = attackers[0];
          const opp = ctx.monsters('opp');
          return opp.length <= 1 && opp.every((m) => m.faceUp && battleStat(ctx, m) < ctx.atk(a)) ? 35 : 0;
        },
      },
    },
    {
      // "other monsters you control cannot declare an attack" (this turn), from wherever this card is.
      kind: 'continuous',
      range: ALL_LOCS,
      mods: [
        {
          q: 'cannotAttack',
          to: 'cards',
          filter: (ctx, c: C) => {
            const list = ctx.game.turnData['rgbt:clover'] as { player: PlayerId; uid: number; moveId: number }[] | undefined;
            return !!list && list.some((e) => e.player === c.controller && !(e.uid === c.uid && e.moveId === c.moveId));
          },
        },
      ],
    },
  ],
});

spell('Against the Wind', 'normal', {
  text: 'Select 1 "Blackwing" monster in your Graveyard. Take damage equal to the ATK of the selected monster, and add it to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.grave('me', isBW).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', isBW), 1, 1, 'Target 1 "Blackwing" monster in your GY.', 'toHand', {
          aiScore: (c) => (c.data.aiValue ?? 0) - (c.data.atk ?? 0) / 2,
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t) return;
        // 2010 ruling: if the damage becomes 0 (Des Wombat), the monster is not added to the hand.
        // https://edisonrul.ing/cards/a/against-the-wind.html
        const dealt = await ctx.damage(ctx.player, t.data.atk ?? 0);
        if ((t.data.atk ?? 0) > 0 && !dealt) return;
        await ctx.toHand(t);
      },
      ai: {
        score: (ctx) => {
          const best = ctx.grave('me', isBW).filter((c) => (c.data.atk ?? 0) + 2000 < ctx.lp);
          return best.length && isMain(ctx) ? 35 : 0;
        },
      },
    },
  ],
});

spell('Junk Box', 'normal', {
  text: 'Select and Special Summon 1 Level 4 or lower "Morphtronic" monster from your Graveyard. Destroy it during the End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isMorphMonster(c) && lvl(c) <= 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isMorphMonster(c) && lvl(c) <= 4 && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 4 or lower "Morphtronic" monster in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.canSummonCard(t)) return;
        const [m] = await ctx.specialSummon(t, { pos: aiPos(ctx, t) });
        if (!m) return;
        const mid = m.moveId;
        ctx.later('end', async () => {
          if (m.location === 'mzone' && m.moveId === mid) await ctx.game.destroy([m], 'effect', ctx.player, ctx.self);
        });
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' ? 40 : 15) },
    },
  ],
});

const cdHost = (ctx: Ctx, c: C) =>
  c.controller === ctx.player && (c.name === 'Power Tool Dragon' || (isMorphMonster(c) && isRace(c, 'Machine') && ctx.level(c) >= 4));
spell('Double Tool C&D', 'equip', {
  text: 'Equip only to a "Power Tool Dragon" or Level 4 or higher Machine-Type "Morphtronic" monster you control. While equipped: ● During your turn: It gains 1000 ATK. If it attacks, any effects of the attack target that activate or apply on the field are negated during that Battle Phase. ● During your opponent\'s turn: Your opponent cannot select a monster other than the equipped monster as an attack target. An opponent\'s monster that battles the equipped monster is destroyed at the end of the Damage Step.',
  effects: [
    equipSpell(cdHost, (ctx) => ownEquipScore(ctx, (c) => cdHost(ctx, c), 40)),
    {
      // Remembers the attack target (never activates).
      kind: 'trigger',
      event: 'attackDeclared',
      label: 'Double Tool C&D attack',
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        if (stActive(ctx) && ctx.isMyTurn && t && ev.card === ctx.equipTarget) t.flags.rgbtCD = { src: ctx.self.uid, turn: ctx.turn };
        return false;
      },
    },
    {
      kind: 'continuous',
      active: selfNotNegated,
      mods: [
        { q: 'atk', to: 'cards', filter: (ctx, c: C) => equipped(ctx, c) && ctx.isMyTurn, value: 1000 },
        { q: 'mustBeAttacked', to: 'cards', filter: (ctx, c: C) => equipped(ctx, c) && !ctx.isMyTurn },
        {
          q: 'negated',
          to: 'cards',
          filter: (ctx, c: C) => {
            if (!ctx.isMyTurn || ctx.phase !== 'battle' || !faceUpOn(c)) return false;
            const eq = ctx.equipTarget;
            if (eq && ctx.game.battle?.attacker === eq && ctx.game.battle.target === c) return true;
            const f = c.flags.rgbtCD as { src: number; turn: number } | undefined;
            return !!f && f.src === ctx.self.uid && f.turn === ctx.turn;
          },
        },
      ],
    },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Destroy the battling monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const eq = ctx.equipTarget;
        if (!eq || ctx.isMyTurn || !stActive(ctx)) return false;
        const o = ev.card === eq ? evo(ev) : ev.other === eq ? evc(ev) : undefined;
        return !!o && o.location === 'mzone' && o.controller === ctx.opp;
      },
      activate: async (ctx) => {
        const eq = ctx.equipTarget!;
        const ev = ctx.event!;
        const o = ev.card === eq ? evo(ev)! : evc(ev)!;
        ctx.data.o = o;
        ctx.data.mid = o.moveId;
      },
      resolve: async (ctx) => {
        const o = ctx.data.o as C;
        if (o.location === 'mzone' && o.moveId === ctx.data.mid) await ctx.destroy(o);
      },
    },
  ],
});

/** Morphtronic Repair Unit: the monster it Special Summoned (equip card -> monster/moveId). */
const repairLinks = new WeakMap<C, { m: C; moveId: number }>();
spell('Morphtronic Repair Unit', 'equip', {
  text: 'Send 1 "Morphtronic" monster from your hand to the Graveyard and select 1 "Morphtronic" monster in your Graveyard. Special Summon the selected monster and equip it with this card. The equipped monster cannot change its Battle Position. When this card is removed from the Field, destroy the equipped monster.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        ctx.canSpecialSummon() && ctx.hand('me', isMorphMonster).length > 0 && ctx.cards('me', ['grave', 'hand'], (c) => isMorphMonster(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        const [s] = await ctx.select(ctx.hand('me', isMorphMonster), 1, 1, 'Send 1 "Morphtronic" monster from your hand to the GY.', 'cost');
        if (!s) return false;
        await ctx.sendToGrave(s, 'cost');
        await ctx.selectTargets(ctx.grave('me', (c) => isMorphMonster(c) && ctx.canSummonCard(c)), 1, 1, 'Target 1 "Morphtronic" monster in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.self.onField || !ctx.canSummonCard(t)) return;
        const [m] = await ctx.specialSummon(t, { pos: aiPos(ctx, t) });
        if (!m || !ctx.self.onField) return;
        ctx.equip(m);
        repairLinks.set(ctx.self, { m, moveId: m.moveId });
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' ? 40 : 20) },
    },
    { kind: 'continuous', mods: [{ q: 'cannotChangePos', to: 'cards', filter: equipped }] },
    {
      kind: 'trigger',
      event: 'leftField',
      range: ALL_LOCS,
      mandatory: true,
      label: 'Destroy the equipped monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self) return false;
        const l = repairLinks.get(ctx.self);
        return !!l && l.m.location === 'mzone' && l.m.moveId === l.moveId;
      },
      resolve: async (ctx) => {
        const l = repairLinks.get(ctx.self);
        repairLinks.delete(ctx.self);
        if (l && l.m.location === 'mzone' && l.m.moveId === l.moveId) await ctx.destroy(l.m);
      },
    },
  ],
});

spell(IRON_CORE, 'normal', {
  sets: ['koaki-meiru'],
  // It has no effect when activated, so it cannot be activated (it can only be Set).
  text: 'During your Draw Phase, if this card is in your Graveyard, you can add this card to your hand instead of drawing, and/or send 1 "Koa\'ki Meiru" monster from your hand to your Graveyard to add this card to your hand.',
  aiValue: 600,
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Add to hand instead of drawing',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.phase === 'draw' && ctx.isMyTurn && !(ctx.turn === 1 && ctx.game.options.skipFirstDraw),
      condition: (ctx) => !ctx.game.queryPlayer(ctx.player, 'cannotDraw'),
      canActivate: (ctx) => !ctx.game.turnData[`rgbt:coreDraw:${ctx.player}`],
      activate: async (ctx) => {
        if (ctx.game.turnData[`rgbt:coreDraw:${ctx.player}`]) return false;
        ctx.game.turnData[`rgbt:coreDraw:${ctx.player}`] = true;
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave') return;
        const g = ctx.game;
        const p = ctx.player;
        await ctx.toHand(ctx.self);
        // The normal draw is replaced: no draw for the rest of this Draw Phase.
        const mod = { player: p, q: 'cannotDraw' as const, value: true as number | boolean, until: 'turn' as const, turn: g.turn };
        g.playerMods.push(mod);
        g.addDelayed('standby', async () => {
          const i = g.playerMods.indexOf(mod);
          if (i >= 0) g.playerMods.splice(i, 1);
        });
      },
      ai: { score: (ctx) => (needsCore(ctx) ? 1 : 0) },
    },
    {
      kind: 'quick',
      range: ['grave'],
      label: "Send a Koa'ki Meiru: add this card",
      categories: ['toHand'],
      condition: (ctx) => ctx.isMyTurn && ctx.phase === 'draw' && noChain(ctx),
      canActivate: (ctx) => ctx.hand('me', isKoakiMonster).length > 0,
      activate: async (ctx) => {
        const [k] = await ctx.select(ctx.hand('me', isKoakiMonster), 1, 1, 'Send 1 "Koa\'ki Meiru" monster from your hand to the GY.', 'cost');
        if (!k) return false;
        await ctx.sendToGrave(k, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toHand(ctx.self);
      },
      ai: { score: (ctx) => (needsCore(ctx) && ctx.hand('me', isKoakiMonster).length >= 2 ? 35 : 0) },
    },
  ],
});

spell('Iron Core Immediate Disposal', 'normal', {
  sets: ['koaki-meiru'],
  text: 'Select and send 1 "Iron Core of Koa\'ki Meiru" from your Deck to your Graveyard.',
  effects: [
    {
      kind: 'activate',
      categories: ['mill'],
      canActivate: (ctx) => ctx.deck('me', isIronCore).length > 0,
      resolve: async (ctx) => {
        const [c] = await ctx.select(ctx.deck('me', isIronCore), 1, 1, `Send 1 "${IRON_CORE}" from your Deck to the GY.`, 'toGrave');
        if (c) await ctx.sendToGrave(c);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: (ctx) => (isMain(ctx) && !ctx.grave('me', isIronCore).length ? 30 : 0) },
    },
  ],
});

const urgentCands = (ctx: Ctx) => ctx.cards('me', ['hand', 'grave'], (c) => isKoakiMonster(c) && lvl(c) <= 4 && ctx.canSummonCard(c));
spell('Urgent Synthesis', 'normal', {
  sets: ['koaki-meiru'],
  text: 'Return 1 "Iron Core of Koa\'ki Meiru" from your Graveyard to the Deck. Special Summon 1 Level 4 or lower "Koa\'ki Meiru" monster from your hand or your Graveyard.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', isIronCore).length > 0 && urgentCands(ctx).length > 0,
      activate: async (ctx) => {
        const [c] = await ctx.select(ctx.grave('me', isIronCore), 1, 1, `Return 1 "${IRON_CORE}" from your GY to the Deck.`, 'cost');
        if (!c) return false;
        await ctx.toDeck(c, 'shuffle', 'cost');
      },
      resolve: async (ctx) => {
        const cands = urgentCands(ctx);
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower "Koa\'ki Meiru" monster from your hand or GY.', 'specialSummon', { aiScore: summonScore });
        if (c) await ctx.specialSummon(c, { pos: aiPos(ctx, c) });
      },
      ai: { score: (ctx) => (isMain(ctx) ? 45 : 0) },
    },
  ],
});

spell('Psychic Path', 'normal', {
  text: 'Pay 800 Life Points and select up to 2 of your removed from play Psychic-Type monsters. Add them to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.lp > 800 && ctx.banished('me', (c) => c.faceUp && isRace(c, 'Psychic')).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(800);
        await ctx.selectTargets(ctx.banished('me', (c) => c.faceUp && isRace(c, 'Psychic')), 1, 2, 'Target up to 2 of your banished Psychic-Type monsters.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'banished');
        if (t.length) await ctx.toHand(t);
      },
      ai: { score: (ctx) => (ctx.lp > 2500 && isMain(ctx) ? 35 : 0) },
    },
  ],
});

// ---- Natural Tune: a Normal Monster treated as a Tuner ----
const tunerPatched = new WeakSet<C>();
/** Install the "treated as a Tuner while face-up" getter on `c` (CardInstance.isTuner is a getter). */
function patchTunerGetter(c: C) {
  if (tunerPatched.has(c)) return;
  tunerPatched.add(c);
  const desc = Object.getOwnPropertyDescriptor(c, 'isTuner') ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), 'isTuner');
  const base = () => !!desc?.get?.call(c);
  Object.defineProperty(c, 'isTuner', { configurable: true, get: () => base() || (c.flags.rgbtTuner === true && faceUpOn(c)) });
}
function makeTuner(c: C) {
  patchTunerGetter(c);
  c.flags.rgbtTuner = true;
}
const tuneCands = (ctx: Ctx) => ctx.faceUpMonsters('me', (c) => isNormalMonster(c) && ctx.level(c) <= 4 && !c.isTuner);
spell('Natural Tune', 'normal', {
  text: 'Select 1 face-up Level 4 or lower Normal Monster you control. It is treated as a Tuner monster while it is face-up on the field.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => tuneCands(ctx).some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        await ctx.selectTargets(tuneCands(ctx), 1, 1, 'Target 1 face-up Level 4 or lower Normal Monster you control.', 'buff');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c) && isNormalMonster(c))[0];
        if (!t) return;
        makeTuner(t);
        ctx.log(`${t.name} is treated as a Tuner monster.`);
        ctx.game.update();
      },
      ai: {
        score: (ctx) => {
          if (!isMain(ctx)) return 0;
          const before = synchroOptions(ctx).length;
          for (const c of tuneCands(ctx)) {
            patchTunerGetter(c);
            const had = c.flags.rgbtTuner;
            c.flags.rgbtTuner = true;
            const after = synchroOptions(ctx).length;
            c.flags.rgbtTuner = had;
            if (after > before) return 45;
          }
          return 0;
        },
      },
    },
  ],
});

spell('Supremacy Berry', 'normal', {
  text: "If your Life Points were lower than your opponent's when this card was activated, gain 2000 Life Points. If your Life Points were higher than your opponent's, you take 1000 damage.",
  effects: [
    {
      kind: 'activate',
      categories: ['recover'],
      activate: async (ctx) => {
        ctx.data.cmp = Math.sign(ctx.lp - ctx.oppLp);
      },
      resolve: async (ctx) => {
        if (ctx.data.cmp < 0) await ctx.recover(ctx.player, 2000);
        else if (ctx.data.cmp > 0) await ctx.damage(ctx.player, 1000);
      },
      ai: { score: (ctx) => (ctx.lp < ctx.oppLp ? 45 : 0) },
    },
  ],
});

spell('Forbidden Chalice', 'quickplay', {
  text: 'Target 1 face-up monster on the field; until the end of this turn, that target gains 400 ATK, but its effects are negated.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['negate', 'atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const top = ctx.prevLink();
        const b = ctx.battle;
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster.', 'target', {
          aiScore: (c) => {
            if (top && top.player === ctx.opp && top.card === c) return 5000;
            if (b && b.inDamageStep && c.controller === ctx.player && (b.attacker === c || b.target === c)) return 4000;
            return c.controller === ctx.opp ? (c.data.aiValue ?? 0) : -1000;
          },
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c))[0];
        if (!t) return;
        ctx.addTempMod(t, 'atk', 400, 'turn');
        ctx.negateEffects(t, 'turn');
      },
      ai: {
        score: (ctx) => {
          const top = ctx.prevLink();
          // Negate an opponent's monster effect on the chain (the monster must still be on the field).
          if (top && top.player === ctx.opp && !top.isCardActivation && top.card.isMonster && faceUpOn(top.card) && ctx.canTarget(top.card)) return 60;
          const b = ctx.battle;
          if (b && b.inDamageStep && !b.calc && b.target) {
            const mine = b.attacker.controller === ctx.player ? b.attacker : b.target.controller === ctx.player ? b.target : null;
            if (!mine || !faceUpOn(mine) || mine.pos !== 'atk') return 0;
            const other = mine === b.attacker ? b.target : b.attacker;
            if (!other.faceUp) return 0;
            const s = battleStat(ctx, other);
            return s >= ctx.atk(mine) && s < ctx.atk(mine) + 400 ? 70 : 0;
          }
          return 0;
        },
      },
    },
  ],
});

/** Calming Magic: nothing has happened yet in this Main Phase 1 (only Sets, which emit no events). */
function startOfMain1(g: Game) {
  for (let i = g.eventLog.length - 1; i >= 0; i--) {
    const e = g.eventLog[i];
    if (e.type === 'phaseStart') return e.phase === 'main1';
    if (!e.minor) return false;
  }
  return false;
}
spell('Calming Magic', 'normal', {
  text: 'This card can only be activated at the start of Main Phase 1. During the Main Phases and Battle Phase of this turn, neither player can Summon monsters.',
  effects: [
    PATCH_LISTENER,
    {
      // APPROX: "at the start of Main Phase 1" = before anything else happened in Main Phase 1 (Sets do not count).
      kind: 'activate',
      categories: ['lockdown'],
      condition: (ctx) => ctx.isMyTurn && ctx.phase === 'main1' && startOfMain1(ctx.game),
      resolve: async (ctx) => {
        const g = ctx.game;
        const mods: (typeof g.playerMods)[number][] = [];
        for (const p of [0, 1] as PlayerId[]) {
          for (const q of ['cannotNormalSummon', 'cannotSpecialSummon'] as const) {
            const m = { player: p, q, value: true as number | boolean, until: 'turn' as const, turn: g.turn };
            g.playerMods.push(m);
            mods.push(m);
          }
        }
        g.turnData['rgbt:calming'] = true;
        ctx.later('end', async () => {
          g.playerMods = g.playerMods.filter((m) => !mods.includes(m));
          g.turnData['rgbt:calming'] = false;
        });
        g.update();
      },
      ai: { score: () => 0 },
    },
  ],
});

spell("Swallow's Nest", 'quickplay', {
  text: 'Tribute 1 face-up Winged Beast monster; Special Summon 1 Winged Beast monster from your Deck with the same Level the Tributed monster had on the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        canSS(ctx) &&
        ctx.faceUpMonsters('me', (c) => isRace(c, 'Winged Beast') && tributable(ctx, c) && ctx.deck('me', (d) => isRace(d, 'Winged Beast') && lvl(d) === ctx.level(c) && ctx.canSummonCard(d)).length > 0).length > 0,
      activate: async (ctx) => {
        const cands = ctx.faceUpMonsters('me', (c) => isRace(c, 'Winged Beast') && tributable(ctx, c) && ctx.deck('me', (d) => isRace(d, 'Winged Beast') && lvl(d) === ctx.level(c)).length > 0);
        const [t] = await ctx.select(cands, 1, 1, 'Tribute 1 face-up Winged Beast monster.', 'tribute');
        if (!t) return false;
        ctx.data.level = ctx.level(t);
        await tributeCost(ctx, [t]);
      },
      resolve: async (ctx) => {
        await summonFromDeck(ctx, (c) => isRace(c, 'Winged Beast') && lvl(c) === ctx.data.level, `Special Summon 1 Level ${ctx.data.level} Winged Beast monster from your Deck.`);
      },
      ai: {
        score: (ctx) => {
          if (!ctx.isMyTurn || !isMain(ctx)) return 0;
          // Swap a weak Winged Beast for a better one of the same Level.
          const gain = ctx.faceUpMonsters('me', (c) => isRace(c, 'Winged Beast') && tributable(ctx, c)).some((c) =>
            ctx.deck('me', (d) => isRace(d, 'Winged Beast') && lvl(d) === ctx.level(c) && summonScore(d) > cardValue(ctx.game, c) + 300).length > 0,
          );
          return gain ? 40 : 0;
        },
      },
    },
  ],
});

spell('Ojama Country', 'field', {
  sets: ['ojama'],
  text: 'Once per turn: You can send 1 "Ojama" card from your hand to the GY; Special Summon 1 "Ojama" monster from your GY. While you control an "Ojama" monster, switch the original ATK/DEF of all monsters on the field.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone', 'grave'], isOjamaMonster).length ? 30 : 0) },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Send an Ojama: revive an Ojama',
      categories: ['specialSummon'],
      // https://edisonrul.ing/cards/o/ojama-country.html — sending the "Ojama" card is a cost; the effect targets 1 "Ojama"
      // monster in your GY and cannot be activated without one there (the card just sent can then be the target).
      canActivate: (ctx) =>
        ctx.canSpecialSummon() && ctx.hand('me', isOjama).length > 0 && ctx.grave('me', (c) => isOjamaMonster(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        const [s] = await ctx.select(ctx.hand('me', isOjama), 1, 1, 'Send 1 "Ojama" card from your hand to the GY.', 'cost');
        if (!s) return false;
        await ctx.sendToGrave(s, 'cost');
        await ctx.selectTargets(ctx.grave('me', (c) => isOjamaMonster(c) && ctx.canSummonCard(c)), 1, 1, 'Target 1 "Ojama" monster in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const [c] = ctx.validTargets((x) => x.location === 'grave');
        if (c && ctx.canSpecialSummon()) await ctx.specialSummon(c, { pos: aiPos(ctx, c) });
      },
      ai: { score: () => 45 },
    },
    {
      // APPROX: the ATK/DEF switch is applied as modifiers of (original DEF - original ATK) and the reverse.
      kind: 'continuous',
      active: (ctx) => ctx.faceUpMonsters('me', isOjamaMonster).length > 0,
      mods: [
        { q: 'atk', to: 'cards', filter: (_ctx, c: C) => faceUpOn(c), value: (ctx, c: C) => ctx.game.baseDef(c) - ctx.game.baseAtk(c) },
        { q: 'def', to: 'cards', filter: (_ctx, c: C) => faceUpOn(c), value: (ctx, c: C) => ctx.game.baseAtk(c) - ctx.game.baseDef(c) },
      ],
    },
  ],
});

spell('Spell of Pain', 'quickplay', {
  text: 'When your opponent activates a card or effect that would inflict effect damage to you: Your opponent takes the effect damage from that card or effect, instead.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: ['damage'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.player === ctx.opp && (l.effect.categories ?? []).includes('damage');
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        const l = ctx.data.link as ChainLink | undefined;
        if (l) redirectDamage(l, ctx.player, 1, 'Spell of Pain');
      },
      ai: { score: () => 70 },
    },
  ],
});

// =================================================================== TRAPS

trap('Miracle Locus', 'normal', {
  text: 'Target 1 face-up Attack Position monster you control; your opponent draws 1 card, also that monster gains 1000 ATK until the end of this turn, and if it does, it can make up to 2 attacks on monsters during each Battle Phase this turn. If it attacks or is attacked this turn, your opponent takes no battle damage from that attack.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => c.pos === 'atk' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => c.pos === 'atk'), 1, 1, 'Target 1 face-up Attack Position monster you control.', 'buff', { aiScore: (c) => ctx.atk(c) });
      },
      resolve: async (ctx) => {
        await ctx.draw(1, ctx.opp);
        const t = ctx.validTargets((c) => faceUpOn(c))[0];
        if (!t) return;
        ctx.addTempMod(t, 'atk', 1000, 'turn');
        ctx.addTempMod(t, 'extraAttacks', 1, 'turn');
        t.flags.rgbtLocusTurn = ctx.turn;
      },
      ai: {
        score: (ctx) => {
          if (!ctx.isMyTurn || !(ctx.phase === 'main1' || ctx.phase === 'battle') || ctx.battle || !noChain(ctx) || ctx.turn <= 1) return 0;
          const best = ctx.faceUpMonsters('me', (c) => c.pos === 'atk' && ctx.game.canAttack(c) && c.attacksThisTurn === 0);
          const opp = ctx.monsters('opp', (m) => m.faceUp);
          return best.some((a) => opp.filter((m) => battleStat(ctx, m) < ctx.atk(a) + 1000).length >= 2) ? 40 : 0;
        },
      },
    },
  ],
});

trap('Crimson Fire', 'counter', {
  text: 'When your opponent activates a Spell/Trap Card that would inflict damage to you, while you control a "Red Dragon Archfiend": Your opponent takes twice the effect damage you would have taken, instead.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: ['damage'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return (
          !!l &&
          !l.negated &&
          l.player === ctx.opp &&
          l.isCardActivation &&
          (l.card.isSpell || l.card.isTrap) &&
          (l.effect.categories ?? []).includes('damage') &&
          ctx.faceUpMonsters('me', (c) => c.name === 'Red Dragon Archfiend').length > 0
        );
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        const l = ctx.data.link as ChainLink | undefined;
        if (l) redirectDamage(l, ctx.player, 2, 'Crimson Fire');
      },
      ai: { score: () => 80 },
    },
  ],
});

trap('Tuner Capture', 'normal', {
  text: 'Activate only when your opponent Synchro Summons a monster. Special Summon 1 Tuner Monster used for that Synchro Summon from their Graveyard to your side of the field.',
  effects: [
    {
      kind: 'activate',
      event: 'synchroSummoned',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const s = evc(ev);
        return !!s && ev.player === ctx.opp;
      },
      canActivate: (ctx) => {
        const s = ctx.event ? evc(ctx.event) : undefined;
        const uids = ((s?.flags.materials ?? []) as { uid: number }[]).map((m) => m.uid);
        return ctx.canSpecialSummon() && ctx.grave('opp', (c) => uids.includes(c.uid) && c.isTuner && ctx.canSummonCard(c)).length > 0;
      },
      activate: async (ctx) => {
        const s = evc(ctx.event!)!;
        ctx.data.uids = ((s.flags.materials ?? []) as { uid: number }[]).map((m) => m.uid);
      },
      resolve: async (ctx) => {
        const uids = ctx.data.uids as number[];
        const cands = ctx.grave('opp', (c) => uids.includes(c.uid) && c.isTuner && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Tuner used for that Synchro Summon.', 'specialSummon');
        if (c) await ctx.specialSummon(c, { pos: aiPos(ctx, c) });
      },
      ai: { score: () => 50 },
    },
  ],
});

trap('Overdoom Line', 'continuous', {
  text: 'If a Plant-Type monster(s) is Special Summoned from the Graveyard to your side of the field: It gains 1000 ATK while this card is face-up on the field. Destroy this card during your 2nd End Phase after activation.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      resolve: async (ctx) => {
        ctx.self.flags.rgbtOdEnds = 0;
      },
      ai: {
        score: (ctx) => (ctx.grave('me', (c) => isRace(c, 'Plant')).length >= 2 && !ctx.isMyTurn && ctx.phase === 'end' && noChain(ctx) ? 30 : 0),
      },
    },
    {
      // APPROX: marks the monsters directly instead of starting a Chain Link (several Plants can be summoned at once).
      kind: 'trigger',
      event: 'specialSummoned',
      range: ['szone'],
      label: 'Overdoom Line (mark)',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && stActive(ctx) && ev.from === 'grave' && c.location === 'mzone' && c.controller === ctx.player && isRace(c, 'Plant')) {
          c.flags.rgbtOverdoom = [...((c.flags.rgbtOverdoom as number[] | undefined) ?? []), ctx.self.uid];
        }
        return false;
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && ((c.flags.rgbtOverdoom as number[] | undefined) ?? []).includes(ctx.self.uid), value: 1000 }] },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Destroy on the 2nd End Phase',
      categories: ['destroy'],
      // https://edisonrul.ing/cards/o/overdoom-line.html — the self-destruction is not an effect (Royal Decree does not stop it).
      noChain: true,
      eventFilter: (ctx, ev) => {
        if (ev.phase !== 'end' || !ctx.isMyTurn || !ctx.self.faceUp || !ctx.self.activeOnField) return false;
        ctx.self.flags.rgbtOdEnds = (ctx.self.flags.rgbtOdEnds ?? 0) + 1;
        return ctx.self.flags.rgbtOdEnds >= 2;
      },
      resolve: async (ctx) => {
        if (ctx.self.onField) await ctx.destroy(ctx.self);
      },
    },
  ],
});

trap('Wicked Rebirth', 'continuous', {
  text: 'Activate this card by paying 800 LP, then target 1 Synchro Monster in your Graveyard; Special Summon it in Attack Position. Its effects are negated, also it cannot declare an attack this turn. When this card leaves the field, destroy that monster. When that monster is destroyed, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.lp > 800 && ctx.canSpecialSummon() && ctx.grave('me', (c) => c.hasType('synchro') && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(800);
        await ctx.selectTargets(ctx.grave('me', (c) => c.hasType('synchro') && ctx.canSummonCard(c)), 1, 1, 'Target 1 Synchro Monster in your GY.', 'specialSummon', { aiScore: summonScore });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.self.onField || !ctx.canSummonCard(t)) return;
        const [m] = await ctx.specialSummon(t, { pos: 'atk' });
        if (!m) return;
        ctx.negateEffects(m, 'field');
        m.flags.cannotAttackTurn = ctx.turn;
        // APPROX: linked like Call of the Haunted (the link also breaks if the monster leaves the field another way).
        ctx.game.link(ctx.self, m);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('me', (c) => c.hasType('synchro') && ctx.canSummonCard(c)).map((c) => c.data.atk ?? 0));
          if (best < 2300 || ctx.lp <= 2000) return 0;
          if (ctx.isMyTurn && isMain(ctx) && noChain(ctx)) return 45;
          return !ctx.isMyTurn && ctx.phase === 'end' && noChain(ctx) ? 45 : 0;
        },
      },
    },
  ],
});

/** Synchro Summons this player could do if `c` had `delta` Levels more (AI hints; restores the card). */
function synchroWithLevelDelta(ctx: Ctx, c: C, delta: number) {
  c.tempMods.push({ q: 'level', value: delta, until: 'turn', turn: ctx.turn });
  try {
    return synchroOptions(ctx).length;
  } finally {
    c.tempMods.pop();
  }
}
trap('Level Retuner', 'normal', {
  text: 'Reduce the Level of 1 face-up monster you control by up to 2.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.level(c) >= 2).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.faceUpMonsters('me', (c) => ctx.level(c) >= 2);
        const before = synchroOptions(ctx).length;
        const [t] = await ctx.select(cands, 1, 1, 'Select 1 face-up monster you control.', 'buff', {
          aiScore: (c) => (synchroWithLevelDelta(ctx, c, -1) > before || synchroWithLevelDelta(ctx, c, -2) > before ? 1000 : 0) + ctx.level(c),
        });
        if (!t) return;
        const max = Math.min(2, ctx.level(t) - 1);
        const n = (await ctx.option(`Reduce ${t.name}'s Level by:`, Array.from({ length: max }, (_, i) => `${i + 1}`), (i) => (synchroWithLevelDelta(ctx, t, -(i + 1)) > before ? 10 - i : i))) + 1;
        ctx.addTempMod(t, 'level', -n, 'field');
        ctx.log(`${t.name}'s Level is reduced by ${n} (Level ${ctx.level(t)}).`);
      },
      ai: {
        score: (ctx) => {
          if (!ctx.isMyTurn || !isMain(ctx)) return 0;
          const before = synchroOptions(ctx).length;
          return ctx.faceUpMonsters('me', (c) => ctx.level(c) >= 2).some((c) => synchroWithLevelDelta(ctx, c, -1) > before || (ctx.level(c) >= 3 && synchroWithLevelDelta(ctx, c, -2) > before)) ? 45 : 0;
        },
      },
    },
  ],
});

// ---- Fake Feather: copies a Normal Trap in the opponent's GY ----
interface FeatherOption {
  card: C;
  ef: EffectDef;
  idx: number;
  ev?: GameEvent;
}
/** The event (from the current response window) that a copied Trap responds to; undefined = none needed, null = missing. */
function copiedEvent(sub: Ctx, ef: EffectDef): GameEvent | undefined | null {
  if (!ef.event) return undefined;
  const evs = Array.isArray(ef.event) ? ef.event : [ef.event];
  const recent = sub.game.recentEvents;
  for (let i = recent.length - 1; i >= 0; i--) {
    const ev = recent[i];
    if (!evs.includes(ev.type)) continue;
    sub.event = ev;
    try {
      if (!ef.eventFilter || ef.eventFilter(sub, ev)) return ev;
    } catch {
      // ignore broken filters
    }
  }
  sub.event = undefined;
  return null;
}
function featherOptions(ctx: Ctx): FeatherOption[] {
  const out: FeatherOption[] = [];
  const inDS = !!ctx.battle?.inDamageStep;
  for (const t of ctx.grave('opp', (c) => c.isTrap && c.data.ttype === 'normal' && c.name !== 'Fake Feather')) {
    const effs = t.data.effects ?? [];
    const idx = effs.findIndex((e) => e.kind === 'activate');
    if (idx < 0) continue;
    const ef = effs[idx];
    if (ef.negateSummon || (inDS && !ef.damageStep) || ef.range?.includes('hand')) continue;
    const sub = new Ctx(ctx.game, ctx.self, ef, ctx.player);
    sub.effectIndex = ctx.effectIndex;
    sub.link = ctx.link;
    const ev = copiedEvent(sub, ef);
    if (ev === null) continue;
    try {
      if (ef.condition && !ef.condition(sub)) continue;
      if (ef.canActivate && !ef.canActivate(sub)) continue;
    } catch {
      continue;
    }
    out.push({ card: t, ef, idx, ev: ev ?? undefined });
  }
  return out;
}
function featherScore(ctx: Ctx, o: FeatherOption) {
  const sub = new Ctx(ctx.game, ctx.self, o.ef, ctx.player);
  sub.event = o.ev;
  try {
    return o.ef.ai?.score ? o.ef.ai.score(sub) : 40;
  } catch {
    return 0;
  }
}
trap('Fake Feather', 'normal', {
  sets: ['blackwing'],
  text: 'Send 1 "Blackwing" monster from your hand to the Graveyard and select 1 Normal Trap Card in your opponent\'s Graveyard. The effect of this card will be same as the selected Normal Trap Card.',
  effects: [
    {
      // APPROX: the copied Trap's own activation code runs with this card as `ctx.self`; the Trap in the GY is
      // chosen as the copy source but is not kept as one of the copied effect's targets.
      // 2010 ruling: "Fake Feather" cannot be activated during the Damage Step.
      // https://edisonrul.ing/cards/f/fake-feather.html
      kind: 'activate',
      categories: ['negate'],
      canActivate: (ctx) => ctx.hand('me', isBW).length > 0 && featherOptions(ctx).length > 0,
      activate: async (ctx) => {
        const opts = featherOptions(ctx);
        if (!opts.length) return false;
        const [bw] = await ctx.select(ctx.hand('me', isBW), 1, 1, 'Send 1 "Blackwing" monster from your hand to the GY.', 'cost');
        if (!bw) return false;
        await ctx.sendToGrave(bw, 'cost');
        const [t] = await ctx.select(
          opts.map((o) => o.card).filter((c) => ctx.canTarget(c)),
          1,
          1,
          "Select 1 Normal Trap Card in your opponent's GY to copy.",
          'target',
          { aiScore: (c) => featherScore(ctx, opts.find((o) => o.card === c)!) },
        );
        const o = opts.find((x) => x.card === t);
        if (!o) return;
        ctx.log(`Fake Feather copies ${o.card.name}.`);
        ctx.data.copy = o.ef;
        if (o.ev) ctx.event = o.ev;
        if (o.ef.activate) {
          const r = await o.ef.activate(ctx);
          if (r === false) ctx.data.copyFailed = true;
        }
      },
      resolve: async (ctx) => {
        const ef = ctx.data.copy as EffectDef | undefined;
        if (!ef || ctx.data.copyFailed || !ef.resolve) return;
        await ef.resolve(ctx);
      },
      ai: {
        score: (ctx) => {
          if (!ctx.hand('me', isBW).length) return 0;
          return Math.max(0, ...featherOptions(ctx).map((o) => featherScore(ctx, o))) - 5;
        },
      },
    },
  ],
});

const bindActive = (ctx: Ctx) => ctx.faceUpMonsters('me', isMorphMonster).length > 0;
trap('Morphtronic Bind', 'continuous', {
  sets: ['morphtronic'],
  text: 'While you control a face-up "Morphtronic" monster, all Level 4 or higher monsters your opponent controls cannot declare an attack or change their battle positions.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      ai: { score: (ctx) => (bindActive(ctx) && ctx.faceUpMonsters('opp', (c) => ctx.level(c) >= 4).length ? 40 : 0) },
    },
    {
      kind: 'continuous',
      active: bindActive,
      mods: [
        { q: 'cannotAttack', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.opp && ctx.level(c) >= 4 },
        { q: 'cannotChangePos', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.opp && ctx.level(c) >= 4 },
      ],
    },
  ],
});

trap('Reckoned Power', 'normal', {
  sets: ['koaki-meiru'],
  text: 'Reveal 1 "Iron Core of Koa\'ki Meiru" in your hand. Destroy all face-down Spell and Trap Cards your opponent controls.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.hand('me', isIronCore).length > 0 && ctx.spellTraps('opp', (c) => !c.faceUp).length > 0,
      activate: async (ctx) => {
        await reveal(ctx, ctx.hand('me', isIronCore).slice(0, 1));
      },
      resolve: async (ctx) => {
        const st = ctx.spellTraps('opp', (c) => !c.faceUp);
        if (st.length) await ctx.destroy(st);
      },
      ai: {
        score: (ctx) => {
          const n = ctx.spellTraps('opp', (c) => !c.faceUp).length;
          if (!n) return 0;
          if (ctx.isMyTurn && ctx.phase === 'main1') return 40 + 10 * n;
          return n >= 2 && !ctx.isMyTurn && ctx.phase === 'end' ? 35 : 0;
        },
      },
    },
  ],
});

/** Automatic Laser: the opponent's monsters Summoned (Normal or Special) in the triggering batch with 1000+ ATK. */
function laserVictims(ctx: Ctx): C[] {
  const ev = ctx.event;
  if (!ev) return [];
  const out = ctx.game.eventLog
    .filter((e) => e.batch === ev.batch && e.type === 'summoned' && e.method !== 'flip')
    .map((e) => e.card as C)
    .filter((c) => !!c && faceUpOn(c) && c.controller === ctx.opp && ctx.atk(c) >= 1000);
  return [...new Set(out)];
}
trap('Automatic Laser', 'normal', {
  sets: ['koaki-meiru'],
  text: 'When your opponent Normal or Special Summons a monster(s) with 1000 or more ATK, reveal 1 "Iron Core of Koa\'ki Meiru" in your hand to activate this card. Destroy that Summoned monster(s).',
  effects: [
    {
      kind: 'activate',
      event: 'summoned',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && ev.method !== 'flip' && ev.player === ctx.opp && faceUpOn(c) && ctx.atk(c) >= 1000;
      },
      canActivate: (ctx) => ctx.hand('me', isIronCore).length > 0 && laserVictims(ctx).length > 0,
      activate: async (ctx) => {
        await reveal(ctx, ctx.hand('me', isIronCore).slice(0, 1));
        const v = laserVictims(ctx);
        ctx.data.victims = v.map((c) => ({ c, mid: c.moveId }));
      },
      resolve: async (ctx) => {
        const v = (ctx.data.victims as { c: C; mid: number }[]).filter((x) => x.c.location === 'mzone' && x.c.moveId === x.mid).map((x) => x.c);
        if (v.length) await ctx.destroy(v);
      },
      ai: { score: (ctx) => (laserVictims(ctx).some((c) => cardValue(ctx.game, c) >= 1700) ? 55 : 0) },
    },
  ],
});

/** Attack of the Cornered Rat: my Level 3 or lower Normal Monster in the current battle, and its opponent. */
const ratUsed = new WeakMap<C, object>();
function ratBattle(ctx: Ctx): { mine: C; theirs: C } | null {
  const b = ctx.battle;
  if (!b || !b.target || !b.inDamageStep || b.calc) return null;
  const mine = b.attacker.controller === ctx.player ? b.attacker : b.target.controller === ctx.player ? b.target : null;
  if (!mine || !faceUpOn(mine) || !isNormalMonster(mine) || ctx.level(mine) > 3) return null;
  const theirs = mine === b.attacker ? b.target : b.attacker;
  if (!faceUpOn(theirs) || ctx.atk(theirs) < 100) return null;
  return { mine, theirs };
}
trap('Attack of the Cornered Rat', 'continuous', {
  text: "If a Level 3 or lower Normal Monster you control battles, during the Damage Step you can pay Life Points in multiples of 100. The ATK of the opponent's monster is reduced by the amount of Life Points you paid, until the End Phase. (You cannot pay more Life Points than the ATK of the opponent's monster.)",
  effects: [
    { kind: 'activate', categories: ['atkChange'], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone'], (c) => isNormalMonster(c) && lvl(c) <= 3).length ? 15 : 0) } },
    {
      kind: 'quick',
      damageStep: true,
      label: 'Pay LP: reduce ATK',
      categories: ['atkChange'],
      // 2010 ruling: it can only be activated once during the same Damage Step.
      // https://edisonrul.ing/cards/a/attack-of-the-cornered-rat.html
      condition: (ctx) => stActive(ctx) && ctx.lp > 100 && !!ratBattle(ctx) && ratUsed.get(ctx.self) !== ctx.battle,
      activate: async (ctx) => {
        const r = ratBattle(ctx)!;
        const cap = Math.min(ctx.atk(r.theirs), Math.floor((ctx.lp - 1) / 100) * 100, 5000);
        const steps = Math.floor(cap / 100);
        if (steps <= 0) return false;
        // AI: the least LP that wins (or ties) the battle.
        const myStat = battleStat(ctx, r.mine);
        const need = r.mine.pos === 'atk' ? ctx.atk(r.theirs) - myStat + 100 : ctx.atk(r.theirs) - myStat;
        const want = Math.max(100, Math.ceil(need / 100) * 100);
        const i = await ctx.option('Pay how many Life Points?', Array.from({ length: steps }, (_, k) => `${(k + 1) * 100}`), (k) => -Math.abs((k + 1) * 100 - want));
        const amount = (i + 1) * 100;
        await ctx.payLp(amount);
        ratUsed.set(ctx.self, ctx.battle!);
        ctx.data.theirs = r.theirs;
        ctx.data.amount = amount;
      },
      resolve: async (ctx) => {
        const t = ctx.data.theirs as C;
        if (faceUpOn(t)) ctx.addTempMod(t, 'atk', -ctx.data.amount, 'turn');
      },
      ai: {
        score: (ctx) => {
          const r = ratBattle(ctx);
          if (!r) return 0;
          const myStat = battleStat(ctx, r.mine);
          const need = r.mine.pos === 'atk' ? ctx.atk(r.theirs) - myStat + 100 : ctx.atk(r.theirs) - myStat;
          return need > 0 && need <= Math.min(2000, ctx.lp - 2000) ? 50 : 0;
        },
      },
    },
  ],
});

trap('Proof of Powerlessness', 'normal', {
  text: 'Activate only while you control a face-up Level 7 or higher monster. Destroy all face-up Level 5 or lower monsters your opponent controls. Monsters you control cannot attack this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.level(c) >= 7).length > 0,
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.level(c) <= 5).length > 0,
      resolve: async (ctx) => {
        const v = ctx.faceUpMonsters('opp', (c) => ctx.level(c) <= 5);
        if (v.length) await ctx.destroy(v);
        ctx.addPlayerMod(ctx.player, 'cannotDeclareAttack');
      },
      ai: {
        score: (ctx) => {
          const n = ctx.faceUpMonsters('opp', (c) => ctx.level(c) <= 5).length;
          if (!n) return 0;
          if (ctx.isMyTurn && ctx.phase === 'main1') return n >= 2 ? 45 : 0;
          return 40 + 10 * n;
        },
      },
    },
  ],
});

const boneOppCands = (ctx: Ctx) => ctx.grave('opp', (c) => c.isMonster && lvl(c) <= 4 && ctx.canSummonCard(c));
trap('Bone Temple Block', 'normal', {
  text: 'Discard 1 card. Special Summon 1 Level 4 or lower monster from your opponent\'s Graveyard to your side of the field, and your opponent Special Summons 1 Level 4 or lower monster from your Graveyard to your opponent\'s side of the field. Those monsters are destroyed during the End Phase of the next turn.',
  effects: [
    {
      // 2010 rulings: discarding is part of the resolution (not a cost), the effects happen in sequence, and the
      // monsters chosen by each player (the turn player first) are targeted. https://edisonrul.ing/cards/b/bone-temple-block.html
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.canSpecialSummon() && boneOppCands(ctx).some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        const theirs = ctx.grave('me', (c) => c.isMonster && lvl(c) <= 4 && ctx.canSummonCard(c, 'opp') && ctx.canTarget(c));
        const oppCan = theirs.length > 0 && ctx.game.freeMZones(ctx.opp) > 0 && !ctx.game.queryPlayer(ctx.opp, 'cannotSpecialSummon');
        const pickMine = async () => {
          const [c] = await ctx.selectTargets(boneOppCands(ctx), 1, 1, "Target 1 Level 4 or lower monster in your opponent's GY.", 'specialSummon', { aiScore: summonScore });
          ctx.data.mine = c;
        };
        const pickTheirs = async () => {
          if (!oppCan) return;
          const [c] = await ctx.select(theirs, 1, 1, "Target 1 Level 4 or lower monster in your opponent's GY.", 'specialSummon', { player: ctx.opp, aiScore: summonScore });
          if (c) ctx.addTargets([c]);
          ctx.data.theirs = c;
        };
        if (ctx.game.turnPlayer === ctx.player) {
          await pickMine();
          await pickTheirs();
        } else {
          await pickTheirs();
          await pickMine();
        }
      },
      resolve: async (ctx) => {
        const g = ctx.game;
        if (!ctx.hand().length) return;
        const d = await ctx.discardFromHand(1, undefined, 'effect');
        if (!d.length) return;
        const valid = ctx.validTargets((c) => c.location === 'grave');
        const summoned: C[] = [];
        const mine = ctx.data.mine as C | undefined;
        if (mine && valid.includes(mine) && ctx.canSpecialSummon() && ctx.canSummonCard(mine)) summoned.push(...(await ctx.specialSummon(mine, { pos: aiPos(ctx, mine) })));
        const theirs = ctx.data.theirs as C | undefined;
        if (theirs && valid.includes(theirs) && g.freeMZones(ctx.opp) > 0 && !g.queryPlayer(ctx.opp, 'cannotSpecialSummon')) {
          summoned.push(...(await g.specialSummon([theirs], ctx.opp, { pos: 'choose', reasonCard: ctx.self })));
        }
        const marks = summoned.map((c) => ({ c, mid: c.moveId }));
        ctx.later(
          'end',
          async () => {
            const live = marks.filter((m) => m.c.location === 'mzone' && m.c.moveId === m.mid).map((m) => m.c);
            if (live.length) await g.destroy(live, 'effect', ctx.player, ctx.self);
          },
          1,
        );
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...boneOppCands(ctx).map(summonScore));
          const give = Math.max(0, ...ctx.grave('me', (c) => c.isMonster && lvl(c) <= 4).map(summonScore));
          return best >= 1600 && best > give + 300 && isMain(ctx) && ctx.isMyTurn ? 40 : 0;
        },
      },
    },
  ],
});

trap('Grave of the Super Ancient Organism', 'continuous', {
  text: 'Level 6 or higher Special Summoned monsters on the field cannot declare attacks, nor can players activate their effects.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: ['lockdown'],
      ai: {
        score: (ctx) => {
          const hit = (side: 'me' | 'opp') => ctx.faceUpMonsters(side, (c) => isSpecialSummoned(c) && ctx.level(c) >= 6).length;
          const mineExtra = ctx.extra().filter((c) => (c.data.level ?? 0) >= 6).length;
          return hit('opp') > hit('me') && mineExtra < 3 ? 50 : 0;
        },
      },
    },
    // "nor can players activate their effects": see ensureRgbtPatches (canActivateEffect / activate wrappers).
    { kind: 'continuous', mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && isSpecialSummoned(c) && ctx.level(c) >= 6 }] },
  ],
});

trap('Overwhelm', 'counter', {
  text: "Activate only while you control a face-up Level 7 or higher monster that was Tribute Summoned. Negate the activation of a Trap Card or Effect Monster's effect and destroy that card.",
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        if (!l || l.negated) return false;
        const ok = (l.isCardActivation && l.card.isTrap) || (l.card.isMonster && !l.isCardActivation);
        return ok && ctx.faceUpMonsters('me', (c) => ctx.level(c) >= 7 && c.summonMethod === 'tribute').length > 0;
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: { score: (ctx) => (ctx.prevLink()?.player === ctx.opp ? 60 : 0) },
    },
  ],
});

trap('Berserking', 'continuous', {
  text: 'Once per turn, during your Main Phase or your opponent\'s Battle Phase, you can select 2 face-up Beast-Type monsters on the field. Until the end of turn, 1 of the selected monsters loses half its ATK, and the other monster gains an equal amount of ATK.',
  effects: [
    { kind: 'activate', categories: ['atkChange'], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone'], (c) => isRace(c, 'Beast')).length ? 15 : 0) } },
    {
      kind: 'quick',
      opt: true,
      label: 'Move half the ATK between 2 Beasts',
      categories: ['atkChange'],
      condition: (ctx) => stActive(ctx) && ((ctx.isMyTurn && isMain(ctx)) || (!ctx.isMyTurn && ctx.phase === 'battle' && !ctx.battle?.inDamageStep)),
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => isRace(c, 'Beast') && ctx.canTarget(c)).length >= 2,
      activate: async (ctx) => {
        const beasts = ctx.faceUpMonsters('both', (c) => isRace(c, 'Beast'));
        const sel = await ctx.selectTargets(beasts, 2, 2, 'Select 2 face-up Beast-Type monsters.', 'target', {
          aiScore: (c) => (c.controller === ctx.opp ? 2000 + ctx.atk(c) : 1000 + ctx.atk(c)),
        });
        if (sel.length < 2) return;
        const i = await ctx.option(`Which monster loses half its ATK?`, sel.map((c) => c.name), (k) => (sel[k].controller === ctx.opp ? 10 : 0) + ctx.atk(sel[k]) / 1000);
        ctx.data.loser = sel[i];
        ctx.data.gainer = sel[1 - i];
      },
      resolve: async (ctx) => {
        const l = ctx.data.loser as C | undefined;
        const w = ctx.data.gainer as C | undefined;
        const ok = ctx.validTargets((c) => faceUpOn(c));
        if (!l || !w || !ok.includes(l) || !ok.includes(w)) return;
        const half = Math.floor(ctx.atk(l) / 2);
        ctx.addTempMod(l, 'atk', -half, 'turn');
        ctx.addTempMod(w, 'atk', half, 'turn');
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.faceUpMonsters('me', (c) => isRace(c, 'Beast'));
          const theirs = ctx.faceUpMonsters('opp', (c) => isRace(c, 'Beast') && ctx.atk(c) >= 1000);
          if (!mine.length || !theirs.length) return 0;
          if (ctx.isMyTurn) return ctx.phase === 'main1' ? 45 : 0;
          return ctx.battle && theirs.includes(ctx.battle.attacker) ? 55 : 0;
        },
      },
    },
  ],
});

export const RGBT_LOADED = true;
