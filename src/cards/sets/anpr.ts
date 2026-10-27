// Ancient Prophecy (ANPR, TCG 2009): every card of the set that was not already in the pool.
// Card text, type, Attribute, Level, ATK/DEF: YGOJSON v1 aggregate (github.com/iconmaster5326/YGOJSON),
// cross-checked against the ProjectIgnis card database. Behaviour follows the 2010 TCG rulings.
//
// Cards already scripted elsewhere (not repeated here): Blackwing - Mistral the Silver Shield,
// Blackwing - Fane the Steel Chain, XX-Saber Faultroll, XX-Saber Gottoms, Flamvell Firedog,
// Ancient Fairy Dragon, Ancient Sacred Wyvern, Saber Slash, Rekindling, Elemental HERO Gaia.
//
// Engine hook used: EffectDef.replaceDestroy ("if X would be destroyed, ... instead"), see the
// `// ANPR:` comments in src/engine/game.ts. Everything else is card-level; the few game-level rules
// (battle-damage changes, summon restrictions, Tribute requirements) are installed per game by
// `ensureAnprPatches`, the same way traps.ts wraps `damage` for Dimension Wall.
// Approximations are marked "APPROX:".
import { monster, spell, token, trap } from '../define';
import { bestTarget, cardValue, destroyTargets, selfDestroysByBattle } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import { faceUpFlag } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { Game } from '../../engine/game';
import type { BattlePos, GameEvent, Location, PlayerId, Race } from '../../engine/types';

type C = CardInstance;

// ============================================================ shared helpers

const evc = (ev: GameEvent) => ev.card as C | undefined;
const evo = (ev: GameEvent) => ev.other as C | undefined;
const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const IRON_CORE = "Iron Core of Koa'ki Meiru";
const isIronCore = (c: C) => c.name === IRON_CORE;
const isKoaki = (c: C) => c.inSet('koaki-meiru') || c.name.includes("Koa'ki Meiru");
const isKoakiMonster = (c: C) => c.isMonster && isKoaki(c);
const isXSaber = (c: C) => c.isMonster && (c.inSet('x-saber') || c.name.includes('X-Saber'));
const isBlackwing = (c: C) => c.isMonster && (c.inSet('blackwing') || c.name.startsWith('Blackwing'));
const isFortuneLady = (c: C) => c.isMonster && (c.inSet('fortune-lady') || c.name.startsWith('Fortune Lady'));
const isEI = (c: C) => c.isMonster && (c.inSet('earthbound-immortal') || c.name.startsWith('Earthbound Immortal'));
const isFlamvell = (c: C) => c.isMonster && (c.inSet('flamvell') || c.name.includes('Flamvell'));
const isRace = (r: Race) => (c: C) => c.isMonster && c.data.race === r;
const lvl = (c: C) => c.data.level ?? 0;
const reasonsOf = (ev: GameEvent) => ev.reasons ?? (ev.reason ? [ev.reason] : []);
const fromField = (ev: GameEvent) => ev.from === 'mzone' || ev.from === 'szone' || ev.from === 'fzone';
const isSpecialSummoned = (c: C) => ['special', 'synchro', 'fusion', 'ritual'].includes(c.summonMethod ?? '');
const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
/** This face-up Continuous/Field/Equip card has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
const mainPhase = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';
const isAi = (ctx: Ctx, p: PlayerId = ctx.player) => !ctx.game.controllers[p].isHuman;

/** Tribute cards as a cost. */
async function tributeCost(ctx: Ctx, cards: C[]) {
  if (!cards.length) return;
  ctx.game.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`, 'action', ctx.player);
  await ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}
const tributable = (ctx: Ctx, c: C) => !ctx.query(c, 'cannotBeTributed');

/** Reveal a card in hand to the opponent. */
function reveal(ctx: Ctx, c: C) {
  c.revealedUntil = ctx.game.turn;
  ctx.log(`${ctx.game.players[ctx.player].name} reveals ${c.name}.`);
}

/** Is there a face-up Field Spell on the field? */
const faceUpFieldSpell = (g: Game) => [g.players[0].fzone, g.players[1].fzone].some((c) => !!c && c.faceUp);

/** Events of the current turn (from the turn's Draw Phase start). */
function turnEvents(g: Game): GameEvent[] {
  const log = g.eventLog;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'phaseStart' && e.phase === 'draw') return log.slice(i);
  }
  return log;
}

/** Remove pending FLIP triggers of a monster (for "Flip Effects are not activated"). */
function dropFlipTriggers(g: Game, c: C) {
  g.pending = g.pending.filter((t) => !(t.event.type === 'flipped' && t.card === c));
}

/** Return a banished monster to the field (not a Summon). If there is no zone it goes to the GY. */
async function returnToField(g: Game, c: C, controller: PlayerId, pos: BattlePos = 'atk') {
  if (c.location !== 'banished') return false;
  if (g.freeMZones(controller) <= 0) {
    await g.sendToGrave([c], 'rule');
    return false;
  }
  g.beginBatch();
  g.rawMove(c, 'mzone', { controller, faceUp: true, pos });
  c.summonTurn = g.turn;
  g.log(`${c.name} returns to the field.`, 'action', controller);
  await g.anim({ type: 'summon', cards: [c.uid], method: 'special', from: ['banished'] });
  g.update();
  return true;
}


/** Equip Spell activation: target 1 face-up monster passing `filter`. */
function equipActivate(filter: (ctx: Ctx, c: C) => boolean, score: (ctx: Ctx) => number, aiTarget?: (ctx: Ctx, c: C) => number): EffectDef {
  const cands = (ctx: Ctx) => ctx.faceUpMonsters('both', (c) => filter(ctx, c));
  return {
    kind: 'activate',
    categories: ['atkChange'],
    canActivate: (ctx) => cands(ctx).some((c) => ctx.canTarget(c)),
    activate: async (ctx) => {
      await ctx.selectTargets(cands(ctx), 1, 1, 'Target 1 face-up monster to equip this card to.', 'equip', {
        aiScore: (c) => (aiTarget ? aiTarget(ctx, c) : c.controller === ctx.player ? cardValue(ctx.game, c) : -10000),
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
const equipped = (ctx: Ctx, c: C) => c === ctx.equipTarget;
/** AI: equip to one of my monsters in Main Phase 1 (or 2 if nothing better). */
const ownEquipScore = (ctx: Ctx, filter: (c: C) => boolean, base = 30) => {
  if (!mainPhase(ctx)) return 0;
  const mine = ctx.faceUpMonsters('me', filter);
  if (!mine.length) return 0;
  return ctx.phase === 'main1' ? base : base / 2;
};
/** "If the equipped monster destroys an opponent's monster by battle". */
const equippedDestroysByBattle = (ctx: Ctx, ev: GameEvent) => {
  const eq = ctx.equipTarget;
  if (!eq || ev.other !== eq || eq.location !== 'mzone') return false;
  return (ev.fromController ?? evc(ev)?.owner) !== eq.controller;
};

/** Monsters destroyed by card effects this turn that are still in the GY where that destruction sent them. */
function destroyedByEffectThisTurn(g: Game): Set<C> {
  const out = new Set<C>();
  const last = new Map<C, GameEvent>();
  for (const ev of turnEvents(g)) {
    const c = evc(ev);
    if (!c || !ev.to || ev.type === 'leftField' || ev.type === 'milled' || ev.type === 'usedAsMaterial' || ev.type === 'tributed' || ev.type === 'discarded') continue;
    last.set(c, ev);
  }
  for (const [c, ev] of last) {
    const rs = reasonsOf(ev);
    if (c.location === 'grave' && ev.to === 'grave' && fromField(ev) && rs.includes('destroy') && rs.includes('effect') && !rs.includes('battle')) out.add(c);
  }
  return out;
}

/** Scary Moth: did player p Special Summon this turn after event `since` (another monster than `except`)? Cached per game. */
const ssCache = new WeakMap<Game, { turn: number; last: number; since: number; res: [boolean, boolean] }>();
function specialSummonedThisTurn(g: Game, p: PlayerId, since = -1, except?: CardInstance) {
  const lastSeq = g.eventLog.length ? g.eventLog[g.eventLog.length - 1].seq : 0;
  let e = ssCache.get(g);
  if (!e || e.turn !== g.turn || e.last !== lastSeq || e.since !== since) {
    const res: [boolean, boolean] = [false, false];
    for (const ev of turnEvents(g)) if (ev.type === 'specialSummoned' && ev.player !== undefined && ev.seq > since && ev.card !== except) res[ev.player] = true;
    e = { turn: g.turn, last: lastSeq, since, res };
    ssCache.set(g, e);
  }
  return e.res[p];
}

// ------------------------------------------------------------ per-game rule patches
// The engine has no hook for these rules, so each game instance gets small wrappers (installed once):
//  * battle damage: Beast Machine King Barbaros Ür and Revival of the Immortals ("your opponent takes no battle
//    damage"), Sauropod Brachion (doubled), Damage Translation (effect damage halved);
//  * Normal Summon legality: only 1 face-up "Earthbound Immortal", only 1 "Jester Confit", Brain Research Lab's
//    extra Normal Summon is for a Psychic-Type monster only;
//  * Tribute Summons: Flamvell Commando (Tribute a "Flamvell" monster), Sauropod Brachion (1 Dinosaur).
const PATCHED = new WeakSet<Game>();
const anyFaceUpEI = (g: Game) => g.allFieldCards().some((c) => c.location === 'mzone' && c.faceUp && isEI(c));
function blocksDamageToOpp(g: Game, c: C) {
  if (g.isNegated(c)) return false;
  return c.name === 'Beast Machine King Barbaros Ür' || c.flags.anprRevivalNoDamage === true;
}
export function ensureAnprPatches(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;

  const origDamage = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: C, sourcePlayer?: PlayerId) => {
    if (kind === 'effect' && g.turnData[`anpr:halve:${p}`] && amount > 0) {
      amount = Math.floor(amount / 2);
      g.log(`Damage Translation halves the damage to ${amount}.`, 'damage', p);
    }
    if (kind === 'battle' && g.battle) {
      const b = g.battle;
      const involved = [b.attacker, b.target].filter((c): c is C => !!c && c.location === 'mzone' && c.faceUp);
      const blocker = involved.find((c) => c.controller !== p && blocksDamageToOpp(g, c));
      if (blocker) {
        g.log(`${g.players[p].name} takes no battle damage (${blocker.name}).`, 'battle', p);
        return 0;
      }
      const t = b.target;
      if (t && t.location === 'mzone' && t.faceUp && t.controller !== p && t.name === 'Sauropod Brachion' && !g.isNegated(t)) {
        amount *= 2;
        g.log('Sauropod Brachion doubles the battle damage.', 'battle', p);
      }
    }
    return origDamage(p, amount, kind, source, sourcePlayer);
  };

  const origCanNS = g.canNormalSummon.bind(g);
  const origNormalSummon = g.normalSummon.bind(g);
  anyG.normalSummon = async (p: PlayerId, card: C, set: boolean) => {
    labGrant(g, p);
    return origNormalSummon(p, card, set);
  };
  anyG.canNormalSummon = (p: PlayerId, card: C, set = false) => {
    // Brain Research Lab: its extra Psychic Normal Summon is granted as soon as the turn player's Normal Summons are looked at.
    labGrant(g, p);
    if (!origCanNS(p, card, set)) return false;
    if (!set && isEI(card) && anyFaceUpEI(g)) return false;
    // AI guard (not a rule): the AI does not Summon an Earthbound Immortal that would destroy itself at once.
    if (isEI(card) && !faceUpFieldSpell(g) && !g.controllers[p].isHuman) return false;
    if (!set && card.name === 'Jester Confit' && g.faceUpMonsters(p).some((c) => c.name === 'Jester Confit')) return false;
    return true;
  };

  const origCands = g.tributeCandidates.bind(g);
  const dinos = (p: PlayerId) => origCands(p).filter((c) => c.data.race === 'Dinosaur');
  const origNeed = g.tributesNeeded.bind(g);
  anyG.tributesNeeded = (card: C) => {
    // APPROX: the 1-Dinosaur Tribute Summon is also allowed when the card is Set.
    if (card.name === 'Sauropod Brachion' && card.location === 'hand' && dinos(card.owner).length) return 1;
    return origNeed(card);
  };
  anyG.tributeCandidates = (p: PlayerId, forCard?: C) => {
    const list = origCands(p, forCard);
    if (forCard?.name === 'Flamvell Commando') return list.filter(isFlamvell);
    if (forCard?.name === 'Sauropod Brachion' && forCard.location === 'hand' && list.some((c) => c.data.race === 'Dinosaur')) {
      return list.filter((c) => c.data.race === 'Dinosaur');
    }
    return list;
  };
}
/** Installs the per-game patches at the first Draw Phase (from any location, never activates). */
const PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  eventFilter: (ctx) => {
    ensureAnprPatches(ctx.game);
    return false;
  },
};

// ------------------------------------------------------------ Koa'ki Meiru maintenance

/** "During each of your End Phases, destroy this card unless you send 1 Iron Core from your hand to the GY or reveal 1 <race> monster in your hand." */
function koakiUpkeep(r: Race): EffectDef {
  return {
    kind: 'trigger',
    event: 'phaseStart',
    mandatory: true,
    label: 'Maintenance',
    categories: ['destroy'],
    eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && faceUpOn(ctx.self),
    resolve: async (ctx) => {
      if (!faceUpOn(ctx.self)) return;
      const cores = ctx.hand('me', isIronCore);
      const reveals = ctx.hand('me', isRace(r));
      const opts: string[] = [];
      const acts: (() => Promise<void>)[] = [];
      if (reveals.length) {
        opts.push(`Reveal 1 ${r}-Type monster`);
        acts.push(async () => {
          const [m] = await ctx.select(reveals, 1, 1, `Reveal 1 ${r}-Type monster in your hand.`, 'generic', { aiScore: (c) => -cardValue(ctx.game, c) });
          if (m) reveal(ctx, m);
        });
      }
      if (cores.length) {
        opts.push(`Send "${IRON_CORE}" to the GY`);
        acts.push(async () => {
          await ctx.sendToGrave(cores[0], 'cost');
        });
      }
      opts.push('Destroy this card');
      acts.push(async () => {
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
      });
      const i = await ctx.option(`${ctx.self.name}: keep it on the field?`, opts, (k) => (k === opts.length - 1 ? 0 : 10 - k));
      await acts[i]();
    },
  };
}

// ------------------------------------------------------------ Fortune Ladies

/** "This card's ATK/DEF become its Level x 200." and the Standby Phase Level increase. */
function fortuneLadyCore(): EffectDef[] {
  return [
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', value: (ctx) => ctx.level(ctx.self) * 200 - ctx.game.baseAtk(ctx.self) },
        { q: 'def', value: (ctx) => ctx.level(ctx.self) * 200 - ctx.game.baseDef(ctx.self) },
      ],
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      opt: true,
      label: 'Level +1',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && faceUpOn(ctx.self),
      condition: (ctx) => ctx.level(ctx.self) < 12,
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self) || ctx.level(ctx.self) >= 12) return;
        ctx.addTempMod(ctx.self, 'level', 1, 'field');
        ctx.log(`${ctx.self.name} is now Level ${ctx.level(ctx.self)}.`);
      },
    },
  ];
}

// ============================================================ MONSTERS

monster('XX-Saber Gardestrike', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 5,
  atk: 2100,
  def: 1400,
  sets: ['x-saber', 'xx-saber'],
  aiValue: 200,
  text: 'If you have 2 or more "X-Saber" monsters in your Graveyard and control no monsters, you can Special Summon this card from your hand.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.monsters('me').length === 0 && ctx.grave('me', isXSaber).length >= 2,
    },
  ],
});

monster('Kuribon', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 1,
  atk: 300,
  def: 200,
  aiValue: 200,
  text: "During damage calculation, if this card is attacked by your opponent's monster: You can activate this effect; you take no battle damage from that battle, your opponent gains LP equal to the attacking monster's ATK, also you return this card to the hand.",
  effects: [
    {
      kind: 'quick',
      damageStep: true,
      label: 'Return to hand',
      categories: ['protect', 'toHand'],
      condition: (ctx) => {
        const b = ctx.battle;
        return !!b && b.inDamageStep && b.target === ctx.self && b.attacker.controller === ctx.opp && faceUpOn(ctx.self);
      },
      activate: async (ctx) => {
        ctx.data.attacker = ctx.battle!.attacker;
      },
      resolve: async (ctx) => {
        const a = ctx.data.attacker as C;
        if (!faceUpOn(ctx.self)) return;
        // No battle damage: Kuribon leaves the battle, so no damage calculation happens.
        if (a) await ctx.recover(ctx.opp, faceUpOn(a) ? ctx.atk(a) : a.data.atk ?? 0);
        await ctx.toHand(ctx.self);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const atk = ctx.atk(b.attacker);
          const mine = ctx.self.pos === 'atk' ? ctx.atk(ctx.self) : ctx.def(ctx.self);
          if (atk <= mine) return 0;
          if (atk >= ctx.lp && ctx.self.pos === 'atk') return 100;
          return 60;
        },
      },
    },
  ],
});

monster('Sunny Pixie', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 1,
  atk: 300,
  def: 400,
  types: ['tuner'],
  aiValue: 200,
  text: 'If this card is sent to the Graveyard for the Synchro Summon of a LIGHT Synchro Monster: Gain 1000 Life Points.',
  effects: [
    {
      kind: 'trigger',
      event: 'usedAsMaterial',
      mandatory: true,
      label: 'Gain 1000 LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self && ev.reason === 'synchro' && ctx.self.location === 'grave' && (ev.reasonCard as C | undefined)?.data.attribute === 'LIGHT',
      resolve: async (ctx) => {
        await ctx.recover(ctx.player, 1000);
      },
    },
  ],
});

monster('Sunlight Unicorn', {
  attribute: 'LIGHT',
  race: 'Beast',
  level: 4,
  atk: 1800,
  def: 1000,
  aiValue: 150,
  text: 'Once per turn: You can excavate the top card of your Deck, and if it is an Equip Spell Card, add it to your hand. Otherwise, place it on the bottom of your Deck.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Excavate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.deck().length > 0,
      resolve: async (ctx) => {
        const deck = ctx.game.players[ctx.player].deck;
        const top = deck[deck.length - 1];
        if (!top) return;
        ctx.log(`${ctx.game.players[ctx.player].name} excavates ${top.name}.`);
        await ctx.game.anim({ type: 'reveal', cards: [top.uid], player: ctx.player });
        if (top.isSpell && top.data.stype === 'equip') await ctx.toHand(top);
        else await ctx.toDeck(top, 'bottom');
      },
      ai: { score: () => 40 },
    },
  ],
});

monster('Blackwing - Vayu the Emblem of Honor', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 1,
  atk: 800,
  def: 0,
  types: ['tuner'],
  sets: ['blackwing'],
  aiValue: 500,
  text: 'This face-up card on the field cannot be used as a Synchro Material. If this card is in the GY: You can target 1 non-Tuner "Blackwing" monster in your GY; banish both this card and that target, and if you do, Special Summon 1 "Blackwing" Synchro Monster from your Extra Deck whose Level equals the total Levels of the banished monsters, but its effects are negated.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'cannotBeSynchroMaterial' }] },
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Banish: Blackwing Synchro',
      categories: ['specialSummon', 'banish'],
      canActivate: (ctx) => ctx.canSpecialSummon() && vayuTargets(ctx).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(vayuTargets(ctx), 1, 1, 'Target 1 non-Tuner "Blackwing" monster in your GY.', 'banish', {
          aiScore: (c) => Math.max(0, ...vayuSynchros(ctx, lvl(c) + lvl(ctx.self)).map((s) => (s.data.atk ?? 0) + (s.data.aiValue ?? 0) / 2)),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t || ctx.self.location !== 'grave') return;
        const total = lvl(t) + lvl(ctx.self);
        const r = await ctx.banish([ctx.self, t]);
        if (r.filter((c) => c.location === 'banished').length < 2) return;
        const cands = vayuSynchros(ctx, total);
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [s] = await ctx.select(cands, 1, 1, `Special Summon 1 Level ${total} "Blackwing" Synchro Monster.`, 'specialSummon');
        if (!s) return;
        const done = await ctx.specialSummon(s);
        if (done.length) ctx.negateEffects(done[0], 'field');
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...vayuTargets(ctx).flatMap((t) => vayuSynchros(ctx, lvl(t) + lvl(ctx.self)).map((s) => s.data.atk ?? 0)));
          return best >= 2000 ? 60 + best / 200 : 0;
        },
      },
    },
  ],
});
function vayuSynchros(ctx: Ctx, level: number) {
  return ctx.extra('me', (s) => s.hasType('synchro') && isBlackwing(s) && lvl(s) === level);
}
function vayuTargets(ctx: Ctx) {
  return ctx.grave('me', (c) => c !== ctx.self && isBlackwing(c) && !c.isTuner && vayuSynchros(ctx, lvl(c) + lvl(ctx.self)).length > 0);
}

monster('Morphtronic Magnen Bar', {
  attribute: 'EARTH',
  race: 'Thunder',
  level: 1,
  atk: 100,
  def: 100,
  sets: ['morphtronic'],
  aiValue: 100,
  text: '● While in Attack Position: Once per turn, if you control exactly 2 other face-up Attack Position monsters, and no additional monsters, this card gains the combined ATK of the other two monsters you control until the End Phase. The other two monsters cannot attack the turn you activate this effect.\n● While in Defense Position: Monsters you control cannot attack.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Gain combined ATK',
      categories: ['atkChange'],
      condition: (ctx) => {
        if (ctx.self.pos !== 'atk') return false;
        const others = ctx.monsters('me', (c) => c !== ctx.self);
        return others.length === 2 && others.every((c) => c.faceUp && c.pos === 'atk');
      },
      activate: async (ctx) => {
        ctx.data.others = ctx.monsters('me', (c) => c !== ctx.self);
        for (const c of ctx.data.others as C[]) c.flags.cannotAttackTurn = ctx.game.turn;
      },
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self) || ctx.self.pos !== 'atk') return;
        const others = (ctx.data.others as C[]).filter(faceUpOn);
        const total = others.reduce((a, c) => a + ctx.atk(c), 0);
        if (total > 0) ctx.addTempMod(ctx.self, 'atk', total, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.game.turn <= 1) return 0;
          const others = ctx.monsters('me', (c) => c !== ctx.self);
          const total = others.reduce((a, c) => a + ctx.atk(c), 0) + ctx.atk(ctx.self);
          const opp = ctx.monsters('opp');
          if (opp.length) return 0;
          return total >= ctx.oppLp ? 90 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      active: (ctx) => ctx.self.pos === 'def',
      mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c) => c.location === 'mzone' && c.controller === ctx.player }],
    },
  ],
});

monster('Jester Lord', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 1,
  atk: 0,
  def: 0,
  sets: ['jester'],
  aiValue: 300,
  text: 'While this card is the only monster on the field, it gains 1000 ATK for each card in the Spell & Trap Card Zones.',
  effects: [
    {
      kind: 'continuous',
      active: (ctx) => ctx.monsters('both').length === 1,
      mods: [{ q: 'atk', value: (ctx) => 1000 * ctx.cards('both', 'szone').length }],
    },
  ],
});

monster('Jester Confit', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 1,
  atk: 0,
  def: 0,
  sets: ['jester'],
  aiValue: 300,
  text: 'You can only control 1 "Jester Confit". You can Special Summon this card (from your hand) in Attack Position. If Summoned this way, during your opponent\'s next End Phase: Target 1 face-up monster your opponent controls; return both that target and this face-up card to the hand.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'proc',
      label: 'Special Summon',
      procPositions: ['atk'],
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && !ctx.faceUpMonsters('me', (c) => c.name === 'Jester Confit').length,
      perform: async (ctx) => {
        ensureAnprPatches(ctx.game);
        ctx.game.turnData[`anpr:confit:${ctx.self.uid}`] = true;
        return true;
      },
      ai: {
        score: (ctx) => {
          const opp = ctx.faceUpMonsters('opp');
          if (!opp.length) return 0;
          // Good as Synchro fodder or to bounce a big monster at the opponent's End Phase.
          return Math.max(...opp.map((c) => cardValue(ctx.game, c))) >= 2000 ? 48 : 30;
        },
      },
    },
    {
      // Bookkeeping: remember a Summon by its own procedure (never activates).
      kind: 'trigger',
      event: 'specialSummoned',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && ctx.game.turnData[`anpr:confit:${ctx.self.uid}`]) {
          ctx.self.flags.confitTurn = ctx.game.turn;
          delete ctx.game.turnData[`anpr:confit:${ctx.self.uid}`];
        }
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Return to hand',
      categories: ['toHand'],
      eventFilter: (ctx, ev) =>
        ev.phase === 'end' && !ctx.isMyTurn && faceUpOn(ctx.self) && ctx.self.flags.confitTurn !== undefined && !ctx.self.flags.confitDone,
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        ctx.self.flags.confitDone = true;
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'bounce');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn);
        const both = [...t, ...(faceUpOn(ctx.self) ? [ctx.self] : [])];
        if (both.length) await ctx.toHand(both);
      },
    },
    {
      // APPROX: a second Jester Confit that still gets Summoned (e.g. Special Summoned by another effect) is sent to the GY.
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      label: 'Only 1 Jester Confit',
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.faceUpMonsters('me', (c) => c !== ctx.self && c.name === 'Jester Confit').length > 0,
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone') await ctx.game.moveCards([ctx.self], 'grave', { reason: 'rule', reasonPlayer: ctx.player, reasonCard: ctx.self });
      },
    },
  ],
});

monster('Fortune Lady Light', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 1,
  atk: 0,
  def: 0,
  sets: ['fortune-lady'],
  aiValue: 700,
  text: "This card's ATK/DEF become its Level x 200. Once per turn, during your Standby Phase: Increase this card's Level by 1 (max. 12). When this card is removed from the field by a card effect, you can Special Summon 1 \"Fortune Lady\" monster from your Deck.",
  effects: [
    ...fortuneLadyCore(),
    {
      kind: 'trigger',
      event: 'leftField',
      when: true,
      label: 'Summon a Fortune Lady',
      categories: ['specialSummon'],
      // 2010 text: "When this card is removed from the field by a card effect" (face-down too, e.g. returned to the hand).
      // https://edisonrul.ing/cards/f/fortune-lady-light.html
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && reasonsOf(ev).includes('effect') && !reasonsOf(ev).includes('cost'),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => isFortuneLady(c) && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => isFortuneLady(c) && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 "Fortune Lady" monster from your Deck.', 'specialSummon', {
          aiScore: (x) => (x.name === 'Fortune Lady Fire' && ctx.faceUpMonsters('opp').length ? 3000 : 0) + lvl(x) * 100,
        });
        ctx.game.shuffleDeck(ctx.player);
        if (!c) return;
        const pos = isAi(ctx) ? (c.name === 'Fortune Lady Fire' && ctx.faceUpMonsters('opp').length ? 'atk' : 'def') : 'choose';
        await ctx.specialSummon(c, { pos });
      },
    },
  ],
});

monster('Fortune Lady Fire', {
  attribute: 'FIRE',
  race: 'Spellcaster',
  level: 2,
  atk: 0,
  def: 0,
  sets: ['fortune-lady'],
  aiValue: 600,
  text: "This card's ATK/DEF become its Level x 200. Once per turn, during your Standby Phase: Increase this card's Level by 1 (max. 12). When this card is Special Summoned in Attack Position by the effect of a \"Fortune Lady\" card: Target 1 face-up monster your opponent controls; destroy that target, and if you do, inflict damage to your opponent equal to the destroyed monster's ATK on the field.",
  effects: [
    ...fortuneLadyCore(),
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Destroy & burn',
      categories: ['destroy', 'damage'],
      eventFilter: (ctx, ev) => {
        const src = ev.reasonCard as C | undefined;
        return ev.card === ctx.self && faceUpOn(ctx.self) && ctx.self.pos === 'atk' && !!src && isFortuneLady(src);
      },
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets(faceUpOn);
        if (!t) return;
        const atk = ctx.atk(t);
        const r = await ctx.destroy(t);
        if (r.length) await ctx.damage(ctx.opp, atk);
      },
    },
  ],
});

monster('Infernity Beast', {
  attribute: 'DARK',
  race: 'Beast',
  level: 3,
  atk: 1600,
  def: 1200,
  sets: ['infernity'],
  aiValue: 100,
  text: 'If this card attacks while you have no cards in your hand, your opponent cannot activate any Spell or Trap Cards until after the Damage Step.',
  effects: [
    {
      kind: 'continuous',
      active: (ctx) => ctx.game.battle?.attacker === ctx.self && ctx.hand('me').length === 0,
      mods: [
        { q: 'cannotActivateSpells', to: 'players', filter: (ctx, p) => p === ctx.opp },
        { q: 'cannotActivateTraps', to: 'players', filter: (ctx, p) => p === ctx.opp },
      ],
    },
  ],
});

monster('Darksea Rescue', {
  attribute: 'DARK',
  race: 'Machine',
  level: 1,
  atk: 0,
  def: 0,
  aiValue: 300,
  text: 'If this card is used for a Synchro Summon and sent to the Graveyard, the owner of this card draws 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: 'usedAsMaterial',
      mandatory: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.reason === 'synchro' && ctx.self.location === 'grave',
      resolve: async (ctx) => {
        await ctx.draw(1, ctx.self.owner);
      },
    },
  ],
});

monster('Darksea Float', {
  attribute: 'DARK',
  race: 'Machine',
  level: 1,
  atk: 0,
  def: 300,
  aiValue: 200,
  text: 'When this card on the field is destroyed by a card effect and sent to the Graveyard, the owner of this card draws 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && fromField(ev) && reasonsOf(ev).includes('destroy') && reasonsOf(ev).includes('effect'),
      resolve: async (ctx) => {
        await ctx.draw(1, ctx.self.owner);
      },
    },
  ],
});

monster('Turbo Rocket', {
  attribute: 'WIND',
  race: 'Machine',
  level: 2,
  atk: 0,
  def: 0,
  types: ['tuner'],
  aiValue: 300,
  text: 'While attacking, this card cannot be destroyed by battle. If this card attacks, after damage calculation, inflict damage equal to half the ATK of the attack target to your opponent.',
  effects: [
    { kind: 'continuous', active: (ctx) => ctx.game.battle?.attacker === ctx.self, mods: [{ q: 'indestructibleBattle' }] },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Burn',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && !!evo(ev),
      resolve: async (ctx) => {
        const t = evo(ctx.event!)!;
        const atk = faceUpOn(t) ? ctx.atk(t) : t.data.atk ?? 0;
        if (atk > 0) await ctx.damage(ctx.opp, Math.floor(atk / 2));
      },
    },
  ],
});

// ------------------------------------------------------------ Earthbound Immortals

function earthboundEffects(): EffectDef[] {
  return [
    PATCH_LISTENER,
    {
      kind: 'continuous',
      mods: [
        { q: 'cannotBeAttacked' },
        { q: 'directAttack' },
        // If none of this player's monsters can be attacked, the opponent's monsters may attack directly.
        {
          q: 'directAttack',
          to: 'cards',
          filter: (ctx, c) =>
            c.location === 'mzone' && c.controller === ctx.opp && ctx.monsters('me').every((m) => ctx.game.queryCard(m, 'cannotBeAttacked')),
        },
      ],
    },
    {
      // APPROX: "If there is no face-up Field Spell, destroy this card" is a mandatory trigger (a Chain Link) here.
      kind: 'trigger',
      event: ['summoned', 'leftField', 'flipped', 'positionChanged', 'phaseStart'],
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

monster('Earthbound Immortal Cusillu', {
  attribute: 'DARK',
  race: 'Beast',
  level: 10,
  atk: 2800,
  def: 2400,
  sets: ['earthbound-immortal'],
  aiValue: 600,
  text: 'There can only be 1 "Earthbound Immortal" monster on the field. If there is no face-up Field Spell on the field, destroy this card. Your opponent\'s monsters cannot target this card for attacks. This card can attack your opponent directly. If this card would be destroyed by battle, you can Tribute 1 other monster instead, and if you do, halve your opponent\'s LP.',
  effects: [
    ...earthboundEffects(),
    {
      kind: 'continuous',
      label: 'Tribute instead',
      replaceDestroy: async (ctx, cards, reason) => {
        if (reason !== 'battle' || !cards.includes(ctx.self)) return [];
        const others = ctx.monsters('me', (c) => c !== ctx.self && tributable(ctx, c));
        if (!others.length) return [];
        if (!(await ctx.confirm(`Tribute 1 other monster instead of destroying ${ctx.self.name} (and halve your opponent's LP)?`))) return [];
        const [t] = await ctx.select(others, 1, 1, 'Tribute 1 other monster.', 'tribute');
        if (!t) return [];
        // Tributing is part of the effect, not a cost: https://edisonrul.ing/cards/e/earthbound-immortal-cusillu.html
        ctx.game.log(`${ctx.game.players[ctx.player].name} Tributes ${t.name}.`, 'action', ctx.player);
        await ctx.game.moveCards([t], 'grave', { reason: 'tribute', reasons: ['tribute', 'effect'], reasonPlayer: ctx.player, reasonCard: ctx.self });
        const ps = ctx.game.players[ctx.opp];
        ps.lp = Math.ceil(ps.lp / 2);
        ctx.log(`${ps.name}'s LP are halved (LP ${ps.lp}).`);
        ctx.game.update();
        return [ctx.self];
      },
    },
  ],
});

monster('Earthbound Immortal Chacu Challhua', {
  attribute: 'DARK',
  race: 'Fish',
  level: 10,
  atk: 2900,
  def: 2400,
  sets: ['earthbound-immortal'],
  aiValue: 600,
  text: 'There can only be 1 "Earthbound Immortal" monster on the field. If there is no face-up Field Spell on the field, destroy this card. Your opponent\'s monsters cannot target this card for attacks. This card can attack your opponent directly. Once per turn: You can inflict damage to your opponent equal to half this card\'s DEF on the field. This card cannot attack the turn this effect is activated. While this card is in Defense Position, your opponent cannot conduct their Battle Phase.',
  effects: [
    ...earthboundEffects(),
    {
      kind: 'ignition',
      opt: true,
      label: 'Burn half DEF',
      categories: ['damage'],
      activate: async (ctx) => {
        ctx.self.flags.cannotAttackTurn = ctx.game.turn;
      },
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self)) await ctx.damage(ctx.opp, Math.floor(ctx.def(ctx.self) / 2));
      },
      ai: {
        score: (ctx) => {
          const burn = Math.floor(ctx.def(ctx.self) / 2);
          if (burn >= ctx.oppLp) return 95;
          // Attack directly in Main Phase 1 when possible; burn in Main Phase 2 or in Defense Position.
          if (ctx.self.pos === 'def' || ctx.phase === 'main2' || ctx.self.attacksThisTurn > 0 || ctx.game.turn <= 1) return 50;
          return 0;
        },
      },
    },
    {
      kind: 'continuous',
      active: (ctx) => ctx.self.pos === 'def',
      mods: [{ q: 'cannotDeclareAttack', to: 'players', filter: (ctx, p) => p === ctx.opp }],
    },
  ],
});

// ------------------------------------------------------------ Koa'ki Meiru

monster("Koa'ki Meiru Boulder", {
  attribute: 'EARTH',
  race: 'Rock',
  level: 4,
  atk: 1200,
  def: 1000,
  sets: ['koaki-meiru'],
  aiValue: 300,
  text: 'When this card is destroyed by battle and sent to the Graveyard, you can add 1 "Iron Core of Koa\'ki Meiru" or 1 Level 4 or lower "Koa\'ki Meiru" monster from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Search',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      canActivate: (ctx) => ctx.deck('me', boulderFilter).length > 0,
      resolve: async (ctx) => {
        await ctx.search(boulderFilter, 1, `Add "${IRON_CORE}" or 1 Level 4 or lower "Koa'ki Meiru" monster to your hand.`);
      },
    },
  ],
});
const boulderFilter = (c: C) => isIronCore(c) || (isKoakiMonster(c) && lvl(c) <= 4);

monster("Koa'ki Meiru Crusader", {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 4,
  atk: 1900,
  def: 1300,
  sets: ['koaki-meiru'],
  aiValue: 200,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 Beast-Warrior-Type monster in your hand. If this card destroys an opponent\'s monster by battle, you can add 1 "Koa\'ki Meiru" card from your Graveyard to your hand.',
  effects: [
    koakiUpkeep('Beast-Warrior'),
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      label: "Add Koa'ki Meiru card",
      categories: ['toHand'],
      // https://edisonrul.ing/cards/k/koaki-meiru-crusader.html — "This effect targets 1 "Koa'ki Meiru" card in your
      // Graveyard. If this card battles a monster with the same ATK and both are destroyed, its effect will activate."
      eventFilter: (ctx, ev) => ev.type === 'battleDestroyed' && ev.other === ctx.self && (ev.card as C).owner !== ctx.player,
      canActivate: (ctx) => ctx.grave('me', (c) => isKoaki(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', isKoaki), 1, 1, 'Target 1 "Koa\'ki Meiru" card in your GY to add to your hand.', 'toHand', {
          aiScore: (c) => (isIronCore(c) ? 5000 : cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    },
  ],
});

monster("Koa'ki Meiru Speeder", {
  attribute: 'WIND',
  race: 'Machine',
  level: 3,
  atk: 1200,
  def: 2200,
  sets: ['koaki-meiru'],
  aiValue: 200,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 Machine-Type monster in your hand. If you draw "Iron Core of Koa\'ki Meiru" during your Draw Phase, you can reveal it to your opponent to draw 1 more card.',
  effects: [
    koakiUpkeep('Machine'),
    {
      kind: 'trigger',
      event: 'drawn',
      range: ['mzone'],
      label: 'Reveal Iron Core: draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.player === ctx.player && ev.reason === 'draw' && ctx.phase === 'draw' && !!evc(ev) && isIronCore(evc(ev)!),
      resolve: async (ctx) => {
        const c = evc(ctx.event!)!;
        if (c.location === 'hand') reveal(ctx, c);
        await ctx.draw(1);
      },
    },
  ],
});

monster("Koa'ki Meiru Tornado", {
  attribute: 'WIND',
  race: 'Winged Beast',
  level: 4,
  atk: 1500,
  def: 1200,
  sets: ['koaki-meiru'],
  aiValue: 300,
  text: 'You can return 1 "Iron Core of Koa\'ki Meiru" from your hand to the top of the Deck to destroy all Special Summoned monsters your opponent controls.',
  effects: [
    {
      kind: 'ignition',
      label: 'Destroy Special Summoned monsters',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.hand('me', isIronCore).length > 0,
      activate: async (ctx) => {
        await ctx.toDeck(ctx.hand('me', isIronCore)[0], 'top', 'cost');
      },
      resolve: async (ctx) => {
        await ctx.destroy(ctx.monsters('opp', (c) => c.faceUp && isSpecialSummoned(c)));
      },
      ai: {
        score: (ctx) => {
          const v = ctx.monsters('opp', (c) => c.faceUp && isSpecialSummoned(c)).reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return v >= 1800 ? 50 + v / 200 : 0;
        },
      },
    },
  ],
});

monster("Koa'ki Meiru Hydro Barrier", {
  attribute: 'WATER',
  race: 'Aqua',
  level: 3,
  atk: 1000,
  def: 1900,
  sets: ['koaki-meiru'],
  aiValue: 300,
  text: 'You can return 1 "Iron Core of Koa\'ki Meiru" from your hand to the top of the Deck. If you do, the effect(s) of all face-up Effect Monsters are negated until the Standby Phase of your next turn, except "Koa\'ki Meiru" monsters.',
  effects: [
    {
      kind: 'ignition',
      label: 'Negate Effect Monsters',
      categories: ['negate'],
      canActivate: (ctx) => ctx.hand('me', isIronCore).length > 0,
      activate: async (ctx) => {
        await ctx.toDeck(ctx.hand('me', isIronCore)[0], 'top', 'cost');
      },
      resolve: async (ctx) => {
        const victims = ctx.faceUpMonsters('both', (c) => c.hasType('effect') && !isKoakiMonster(c));
        const added: { c: C; m: unknown }[] = [];
        for (const c of victims) {
          if (ctx.game.isUnaffected(c, ctx.self, ctx.player)) continue;
          ctx.negateEffects(c, 'field');
          added.push({ c, m: c.tempMods[c.tempMods.length - 1] });
        }
        if (!added.length) return;
        ctx.log(`The effects of ${added.map((a) => a.c.name).join(', ')} are negated.`);
        ctx.later(
          'standby',
          async () => {
            for (const a of added) a.c.tempMods = a.c.tempMods.filter((m) => m !== a.m);
            ctx.game.update();
          },
          ctx.isMyTurn ? 2 : 1,
        );
      },
      ai: {
        score: (ctx) => {
          const v = ctx.faceUpMonsters('opp', (c) => c.hasType('effect') && !isKoakiMonster(c)).reduce((a, c) => a + (c.data.aiValue ?? 300), 0);
          return v >= 800 ? 45 : 0;
        },
      },
    },
  ],
});

monster("Koa'ki Meiru Ghoulungulate", {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 5,
  atk: 2500,
  def: 1700,
  sets: ['koaki-meiru'],
  aiValue: 400,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 Zombie-Type monster in your hand. If a "Koa\'ki Meiru" monster you control would be destroyed by battle or by a card effect, you can remove from play 1 "Koa\'ki Meiru" monster in your Graveyard instead.',
  effects: [
    koakiUpkeep('Zombie'),
    {
      kind: 'continuous',
      label: "Banish a Koa'ki Meiru instead",
      replaceDestroy: async (ctx, cards) => {
        const saved: C[] = [];
        for (const c of cards) {
          if (!(isKoakiMonster(c) && c.location === 'mzone' && c.controller === ctx.player && c.faceUp)) continue;
          const g = ctx.grave('me', isKoakiMonster);
          if (!g.length) break;
          if (!(await ctx.confirm(`Banish 1 "Koa'ki Meiru" monster from your GY instead of destroying ${c.name}?`))) continue;
          const [b] = await ctx.select(g, 1, 1, 'Banish 1 "Koa\'ki Meiru" monster from your GY.', 'cost');
          if (!b) continue;
          await ctx.banish(b, 'cost');
          saved.push(c);
        }
        return saved;
      },
    },
  ],
});

monster("Koa'ki Meiru Gravirose", {
  attribute: 'FIRE',
  race: 'Plant',
  level: 4,
  atk: 1900,
  def: 1300,
  sets: ['koaki-meiru'],
  aiValue: 300,
  text: 'During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa\'ki Meiru" from your hand to the Graveyard or reveal 1 Plant-Type monster in you hand. During each of your Standby Phases, you can send 1 Level 3 or lower monster from your Deck to your Graveyard.',
  effects: [
    koakiUpkeep('Plant'),
    {
      kind: 'trigger',
      event: 'phaseStart',
      label: 'Send to GY',
      categories: ['mill'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && faceUpOn(ctx.self),
      canActivate: (ctx) => ctx.deck('me', (c) => c.isMonster && lvl(c) <= 3).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => c.isMonster && lvl(c) <= 3);
        const sel = await ctx.select(cands, 1, 1, 'Send 1 Level 3 or lower monster from your Deck to the GY.', 'toGrave', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (c.hasType('effect') ? 200 : 0),
        });
        if (sel.length) await ctx.sendToGrave(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

monster('Scary Moth', {
  attribute: 'WIND',
  race: 'Insect',
  level: 6,
  atk: 1800,
  def: 2300,
  aiValue: 400,
  text: 'Each player can only Special Summon a monster(s) once per turn.',
  effects: [
    {
      kind: 'continuous',
      // https://edisonrul.ing/cards/s/scary-moth.html — monsters Special Summoned before Scary Moth was Summoned (and Scary
      // Moth's own Special Summon) do not count.
      mods: [{ q: 'cannotSpecialSummon', to: 'players', filter: (ctx, p) => specialSummonedThisTurn(ctx.game, p, ctx.self.flags.mothSeq ?? -1, ctx.self) }],
    },
    {
      // Bookkeeping (never activates): when this card arrived face-up.
      kind: 'trigger',
      event: ['summoned', 'specialSummoned', 'flipped'],
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self) ctx.self.flags.mothSeq = Math.max(ev.seq, ctx.self.flags.mothSeq ?? -1);
        return false;
      },
    },
  ],
});

monster('Shiny Black "C"', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 1,
  atk: 200,
  def: 500,
  aiValue: 300,
  text: "During either player's turn, when exactly 1 Synchro Monster is Special Summoned to your opponent's side of the field: You can banish this card from your Graveyard to target that face-up Synchro Monster; destroy that target.",
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      range: ['grave'],
      when: true,
      label: 'Destroy Synchro',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || !c.hasType('synchro') || c.controller !== ctx.opp || !faceUpOn(c)) return false;
        const same = ctx.game.eventLog.filter((e) => e.type === 'specialSummoned' && e.batch === ev.batch && evc(e)?.hasType('synchro') && evc(e)?.controller === ctx.opp);
        return same.length === 1;
      },
      canActivate: (ctx) => ctx.self.location === 'grave' && !!ctx.event && ctx.canTarget(evc(ctx.event)!),
      activate: async (ctx) => {
        const t = evc(ctx.event!)!;
        await ctx.banish(ctx.self, 'cost');
        if (faceUpOn(t)) ctx.addTargets([t]);
      },
      resolve: destroyTargets,
      ai: { score: (ctx) => (ctx.event && cardValue(ctx.game, evc(ctx.event)!) >= 1500 ? 80 : 0) },
    },
  ],
});

monster('Armed Sea Hunter', {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 4,
  atk: 1800,
  def: 400,
  aiValue: 200,
  text: 'If you control another face-up WATER monster, negate the effects of the monster that battled with this card, after damage calculation. If this card would be destroyed, you can destroy 1 face-up Level 3 or lower WATER monster you control instead.',
  effects: [
    {
      // 2010 rulings: it activates after damage calculation (before battle-destroyed monsters leave the field), even
      // if this card is destroyed by that battle; it does not target. https://edisonrul.ing/cards/a/armed-sea-hunter.html
      // APPROX: the negation only applies while that monster stays on the field (no GY negation hook).
      kind: 'trigger',
      event: 'damageCalculated',
      mandatory: true,
      label: 'Negate battled monster',
      categories: ['negate'],
      eventFilter: (ctx, ev) => {
        const other = ev.card === ctx.self ? evo(ev) : evo(ev) === ctx.self ? evc(ev) : undefined;
        return !!other && other.hasType('effect') && faceUpOn(ctx.self);
      },
      condition: (ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && c.data.attribute === 'WATER').length > 0,
      activate: async (ctx) => {
        const ev = ctx.event!;
        ctx.data.other = ev.card === ctx.self ? evo(ev) : evc(ev);
      },
      resolve: async (ctx) => {
        if (!ctx.faceUpMonsters('me', (c) => c !== ctx.self && c.data.attribute === 'WATER').length) return;
        const o = ctx.data.other as C;
        if (o && faceUpOn(o)) {
          ctx.negateEffects(o, 'field');
          ctx.log(`${o.name}'s effects are negated.`);
        }
      },
    },
    {
      kind: 'continuous',
      label: 'Destroy a WATER instead',
      replaceDestroy: async (ctx, cards) => {
        if (!cards.includes(ctx.self)) return [];
        // 2010 ruling: a monster that cannot be destroyed ("Aegis of the Ocean Dragon Lord") cannot be the substitute.
        const subs = ctx.faceUpMonsters(
          'me',
          (c) => c !== ctx.self && !cards.includes(c) && c.data.attribute === 'WATER' && ctx.level(c) <= 3 && !ctx.game.queryCard(c, 'indestructibleEffect'),
        );
        if (!subs.length) return [];
        if (!(await ctx.confirm(`Destroy 1 Level 3 or lower WATER monster instead of ${ctx.self.name}?`))) return [];
        const [s] = await ctx.select(subs, 1, 1, 'Destroy 1 face-up Level 3 or lower WATER monster you control instead.', 'cost');
        if (!s) return [];
        await ctx.game.destroy([s], 'effect', ctx.player, ctx.self);
        return [ctx.self];
      },
    },
  ],
});

monster('Divine Dragon Aquabizarre', {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 5,
  atk: 2100,
  def: 1500,
  aiValue: 100,
  text: 'Once per turn, you can Tribute 1 other face-up WATER monster and select 1 Continuous or Field Spell Card in your Graveyard to return it to the top of your Deck.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Recycle Spell',
      categories: ['toDeck'],
      canActivate: (ctx) => aquaFodder(ctx).length > 0 && ctx.grave('me', aquaSpell).length > 0,
      activate: async (ctx) => {
        const t = await ctx.select(aquaFodder(ctx), 1, 1, 'Tribute 1 other face-up WATER monster.', 'tribute');
        await tributeCost(ctx, t);
        await ctx.selectTargets(ctx.grave('me', aquaSpell), 1, 1, 'Select 1 Continuous or Field Spell in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toDeck(t, 'top');
      },
      ai: { score: () => 0 },
    },
  ],
});
const aquaSpell = (c: C) => c.isSpell && (c.data.stype === 'continuous' || c.data.stype === 'field');
const aquaFodder = (ctx: Ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && c.data.attribute === 'WATER' && tributable(ctx, c));

monster('Fishborg Blaster', {
  attribute: 'WATER',
  race: 'Fish',
  level: 1,
  atk: 100,
  def: 200,
  types: ['tuner'],
  aiValue: 500,
  text: 'If you control a face-up Level 3 or lower WATER monster: You can discard 1 card; Special Summon this card from your GY. If this card is used as Synchro Material, all other Synchro Materials must be WATER.',
  synchroMaterialCheck: (_s, mats, self) => mats.every((m) => m === self || m.data.attribute === 'WATER'),
  effects: [
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Discard: revive',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        ctx.canSummonSelf() && ctx.hand().length > 0 && ctx.faceUpMonsters('me', (c) => c.data.attribute === 'WATER' && ctx.level(c) <= 3).length > 0,
      activate: async (ctx) => {
        await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.specialSummon(ctx.self);
      },
      ai: {
        score: (ctx) => {
          // Only when it makes a Synchro Summon possible with a WATER partner.
          const partner = ctx.faceUpMonsters('me', (c) => c.data.attribute === 'WATER' && !c.isTuner);
          const syn = ctx.extra('me', (s) => s.hasType('synchro') && partner.some((p) => ctx.level(p) + 1 === lvl(s)));
          return syn.length && ctx.hand().length >= 2 ? 45 : 0;
        },
      },
    },
  ],
});

monster('Shark Cruiser', {
  attribute: 'WATER',
  race: 'Fish',
  level: 5,
  atk: 1800,
  def: 2200,
  aiValue: 300,
  text: "If this face-up card you control is destroyed by your opponent's card effect, you can Special Summon up to 2 Level 4 or lower WATER monsters from your Deck.",
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      label: 'Summon WATER monsters',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self && ev.from === 'mzone' && !!ev.fromFaceUp && ev.fromController === ctx.self.owner && reasonsOf(ev).includes('effect') && ev.reasonPlayer === ctx.opp,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', sharkFilter(ctx)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', sharkFilter(ctx));
        const n = Math.min(2, ctx.freeMZones());
        if (cands.length && n > 0 && ctx.canSpecialSummon()) {
          const sel = await ctx.select(cands, 1, n, 'Special Summon up to 2 Level 4 or lower WATER monsters from your Deck.', 'specialSummon');
          if (sel.length) await ctx.specialSummon(sel);
        }
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});
const sharkFilter = (ctx: Ctx) => (c: C) => c.isMonster && !c.isExtra && c.data.attribute === 'WATER' && lvl(c) <= 4 && ctx.canSummonCard(c);

monster('Armored Axon Kicker', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 6,
  atk: 2200,
  def: 1800,
  aiValue: 200,
  text: "If you control a face-up Psychic-Type monster, you can Normal Summon this card without Tributing. If this card destroys an opponent's monster by battle, you take damage equal to half the destroyed monster's ATK. Then, you can Special Summon 1 monster from your Graveyard with ATK less than or equal to the damage you took.",
  effects: [
    {
      // Same workaround as Blackwing - Elphin the Raven: refresh the noTribute flag whenever Normal Summon legality is checked.
      kind: 'continuous',
      range: ['hand'],
      mods: [
        {
          q: 'cannotNormalSummon',
          to: 'players',
          filter: (ctx, p) => {
            if (p === ctx.player) ctx.self.flags.noTribute = ctx.faceUpMonsters('me', isRace('Psychic')).length > 0;
            return false;
          },
        },
        {
          q: 'cannotSet',
          to: 'players',
          filter: (ctx, p) => {
            if (p === ctx.player) ctx.self.flags.noTribute = ctx.faceUpMonsters('me', isRace('Psychic')).length > 0;
            return false;
          },
        },
      ],
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Take damage, revive',
      categories: ['damage', 'specialSummon'],
      eventFilter: selfDestroysByBattle,
      resolve: async (ctx) => {
        const v = evc(ctx.event!)!;
        // APPROX: uses the destroyed monster's printed ATK (its ATK on the field is gone once it is in the GY).
        const dmg = await ctx.damage(ctx.player, Math.floor((v.data.atk ?? 0) / 2));
        const cands = ctx.grave('me', (c) => c.isMonster && (c.data.atk ?? 0) <= dmg && ctx.canSummonCard(c));
        if (!dmg || !cands.length || !ctx.canSpecialSummon()) return;
        if (!(await ctx.confirm('Special Summon 1 monster from your GY?'))) return;
        const sel = await ctx.select(cands, 1, 1, `Special Summon 1 monster with ${dmg} or less ATK from your GY.`, 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0]);
      },
    },
  ],
});

monster('Genetic Woman', {
  attribute: 'WIND',
  race: 'Psychic',
  level: 4,
  atk: 1700,
  def: 1200,
  aiValue: 150,
  text: 'Once per turn, you can pay 1000 Life Points and select 1 of your removed from play Psychic-Type monsters. Add it to your hand.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Pay 1000: add banished Psychic',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.lp > 1000 && ctx.banished('me', (c) => isRace('Psychic')(c) && c.faceUp).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(1000);
        await ctx.selectTargets(ctx.banished('me', (c) => isRace('Psychic')(c) && c.faceUp), 1, 1, 'Select 1 of your banished Psychic-Type monsters.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'banished');
        if (t.length) await ctx.toHand(t);
      },
      ai: { score: (ctx) => (ctx.lp >= 4000 && ctx.banished('me', (c) => isRace('Psychic')(c) && (c.data.atk ?? 0) >= 1700).length ? 35 : 0) },
    },
  ],
});

monster('Magicat', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 2,
  atk: 600,
  def: 500,
  aiValue: 150,
  text: 'If this card is sent to the Graveyard for the Synchro Summon of a Spellcaster-Type Synchro Monster, you can return 1 Spell Card from your Graveyard to the top of your Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'usedAsMaterial',
      label: 'Spell to top of Deck',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self && ev.reason === 'synchro' && ctx.self.location === 'grave' && (ev.reasonCard as C | undefined)?.data.race === 'Spellcaster',
      canActivate: (ctx) => ctx.grave('me', (c) => c.isSpell).length > 0,
      resolve: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', (c) => c.isSpell), 1, 1, 'Return 1 Spell Card from your GY to the top of your Deck.', 'toHand');
        if (sel.length) await ctx.toDeck(sel, 'top');
      },
    },
  ],
});

monster('Cyborg Doctor', {
  attribute: 'EARTH',
  race: 'Spellcaster',
  level: 4,
  atk: 1500,
  def: 1700,
  aiValue: 200,
  text: 'Once per turn, you can Tribute 1 Tuner monster you control to Special Summon a monster from your Graveyard with the same Attribute and Level as the Tributed monster.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Tribute Tuner: revive',
      categories: ['specialSummon'],
      // A face-down Tuner can be Tributed (cost); the effect targets 1 monster in your GY:
      // https://edisonrul.ing/cards/c/cyborg-doctor.html
      canActivate: (ctx) => ctx.monsters('me', (c) => c.isTuner && tributable(ctx, c)).some((t) => doctorMatches(ctx, t, true).length > 0),
      activate: async (ctx) => {
        const tuners = ctx.monsters('me', (c) => c.isTuner && tributable(ctx, c)).filter((t) => doctorMatches(ctx, t, true).length > 0);
        const [t] = await ctx.select(tuners, 1, 1, 'Tribute 1 Tuner monster you control.', 'tribute');
        if (!t) return false;
        const attr = t.data.attribute;
        const level = t.faceUp ? ctx.level(t) : lvl(t);
        await tributeCost(ctx, [t]);
        const cands = ctx.grave('me', (c) => c.isMonster && c.data.attribute === attr && lvl(c) === level && ctx.canSummonCard(c));
        await ctx.selectTargets(cands, 1, 1, 'Target 1 monster with the same Attribute and Level in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.faceUpMonsters('me', (c) => c.isTuner).flatMap((t) => doctorMatches(ctx, t, false).map((c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) - cardValue(ctx.game, t))));
          return best >= 500 ? 45 : 0;
        },
      },
    },
  ],
});
function doctorMatches(ctx: Ctx, t: C, includeSelf: boolean) {
  return ctx.grave('me', (c) => c.isMonster && c.data.attribute === t.data.attribute && lvl(c) === ctx.level(t) && ctx.canSummonCard(c)).concat(
    includeSelf && !t.data.nomi ? [t] : [],
  );
}

monster('White Potan', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 1,
  atk: 100,
  def: 200,
  aiValue: 150,
  text: 'If you control a face-up Tuner monster, this card cannot be destroyed by battle. When a face-up Tuner monster you control is destroyed by battle and sent to the Graveyard, inflict 500 damage to your opponent.',
  effects: [
    { kind: 'continuous', active: (ctx) => ctx.faceUpMonsters('me', (c) => c.isTuner).length > 0, mods: [{ q: 'indestructibleBattle' }] },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['mzone'],
      mandatory: true,
      label: 'Burn 500',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.isTuner && c.location === 'grave' && ev.fromController === ctx.player && faceUpOn(ctx.self);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500);
      },
    },
  ],
});

monster('Minefieldriller', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1500,
  def: 1500,
  aiValue: 150,
  text: 'When this face-up card you control leaves the field and is still in your possession: You can target 1 Field Spell Card in your Graveyard; add that target to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'leftField',
      when: true,
      label: 'Add Field Spell',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && !!ev.fromFaceUp && ev.fromController === ctx.self.owner,
      canActivate: (ctx) => ctx.grave('me', (c) => c.isSpell && c.data.stype === 'field').length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isSpell && c.data.stype === 'field'), 1, 1, 'Target 1 Field Spell in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    },
  ],
});

monster('XX-Saber Ragigura', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 1,
  atk: 200,
  def: 1000,
  sets: ['x-saber', 'xx-saber'],
  aiValue: 400,
  text: 'When this card is Normal or Special Summoned, you can add 1 "X-Saber" monster from your Graveyard to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      when: true,
      label: 'Add X-Saber from GY',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.method !== 'flip',
      // https://edisonrul.ing/cards/x/xx-saber-ragigura.html — it targets 1 "X-Saber" monster in your Graveyard.
      canActivate: (ctx) => ctx.grave('me', (c) => isXSaber(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', isXSaber), 1, 1, 'Target 1 "X-Saber" monster in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    },
  ],
});

monster('Ancient Crimson Ape', {
  attribute: 'LIGHT',
  race: 'Beast',
  level: 7,
  atk: 2600,
  def: 1800,
  aiValue: 100,
  text: 'When a monster(s) you control is destroyed and sent to the Graveyard, gain 1000 Life Points.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      range: ['mzone'],
      mandatory: true,
      label: 'Gain 1000 LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => ev.from === 'mzone' && reasonsOf(ev).includes('destroy') && ev.fromController === ctx.player && faceUpOn(ctx.self),
      resolve: async (ctx) => {
        await ctx.recover(ctx.player, 1000);
      },
    },
  ],
});

monster('Falchionβ', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 4,
  atk: 1200,
  def: 800,
  aiValue: 300,
  text: "If this card destroys an opponent's monster by battle: Activate 1 of these effects.\n● Send 1 LIGHT Machine monster with 1200 or less ATK from your Deck to your GY.\n● Target 1 LIGHT Machine monster with 1200 or less ATK in your GY; Special Summon that target.",
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Falchion effect',
      categories: ['mill', 'specialSummon'],
      eventFilter: selfDestroysByBattle,
      canActivate: (ctx) => ctx.deck('me', falchionFilter).length > 0 || (ctx.canSpecialSummon() && falchionRevive(ctx).length > 0),
      activate: async (ctx) => {
        const canMill = ctx.deck('me', falchionFilter).length > 0;
        const canRevive = ctx.canSpecialSummon() && falchionRevive(ctx).some((c) => ctx.canTarget(c));
        const opts: string[] = [];
        if (canMill) opts.push('Send a LIGHT Machine from your Deck to the GY');
        if (canRevive) opts.push('Special Summon a LIGHT Machine from your GY');
        if (!opts.length) return false;
        const i = await ctx.option('Activate 1 of these effects.', opts, (k) => (opts[k].startsWith('Special') ? 2 : 1));
        ctx.data.mode = opts[i].startsWith('Special') ? 'revive' : 'mill';
        if (ctx.data.mode === 'revive') {
          await ctx.selectTargets(falchionRevive(ctx), 1, 1, 'Target 1 LIGHT Machine monster with 1200 or less ATK in your GY.', 'specialSummon');
        }
      },
      resolve: async (ctx) => {
        if (ctx.data.mode === 'revive') {
          const t = ctx.validTargets((c) => c.location === 'grave');
          if (t.length) await ctx.specialSummon(t[0]);
          return;
        }
        const sel = await ctx.select(ctx.deck('me', falchionFilter), 1, 1, 'Send 1 LIGHT Machine monster with 1200 or less ATK from your Deck to the GY.', 'toGrave');
        if (sel.length) await ctx.sendToGrave(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});
const falchionFilter = (c: C) => c.isMonster && c.data.attribute === 'LIGHT' && c.data.race === 'Machine' && (c.data.atk ?? 0) <= 1200;
const falchionRevive = (ctx: Ctx) => ctx.grave('me', (c) => falchionFilter(c) && ctx.canSummonCard(c));

// "Once while this card is face-up on the field": the engine drops the flag when it is turned face-down.
faceUpFlag('fulhelmUsed');
monster('XX-Saber Fulhelmknight', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 3,
  atk: 1300,
  def: 1000,
  types: ['tuner'],
  sets: ['x-saber', 'xx-saber'],
  aiValue: 500,
  text: "When an opponent's monster declares an attack: You can target the attacking monster; negate that attack. This effect can only be used once while this card is face-up on the field. If this card destroys an opponent's Defense Position monster by battle: You can target 1 Level 4 or lower \"X-Saber\" monster in your Graveyard; Special Summon it.",
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: 'Negate attack',
      categories: ['negateAttack'],
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        return !!a && a.controller === ctx.opp && faceUpOn(ctx.self) && !ctx.self.flags.fulhelmUsed;
      },
      canActivate: (ctx) => !!ctx.event && faceUpOn(evc(ctx.event)!) && ctx.canTarget(evc(ctx.event)!),
      activate: async (ctx) => {
        ctx.self.flags.fulhelmUsed = true;
        ctx.addTargets([evc(ctx.event!)!]);
      },
      resolve: async (ctx) => {
        if (ctx.validTargets((c) => c.location === 'mzone').length && ctx.battle) ctx.negateAttack();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const atk = ctx.atk(b.attacker);
          const t = b.target;
          if (!t) return atk >= 1500 ? 1 : 0;
          const td = t.faceUp ? (t.pos === 'atk' ? ctx.atk(t) : ctx.def(t)) : 1000;
          return atk >= td ? 1 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      label: 'Revive X-Saber',
      categories: ['specialSummon'],
      // https://edisonrul.ing/cards/x/xx-saber-fulhelmknight.html — it activates & resolves even if Fulhelmknight left
      // the field (e.g. destroyed by a flipped Ryko) before the end of the Damage Step.
      eventFilter: (ctx, ev) =>
        ev.type === 'battleDestroyed' && ev.other === ctx.self && (evc(ev) as CardInstance).owner !== ctx.player && evc(ev)?.pos === 'def',
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isXSaber(c) && lvl(c) <= 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isXSaber(c) && lvl(c) <= 4 && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 4 or lower "X-Saber" in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0]);
      },
    },
  ],
});

monster('Psychic Emperor', {
  attribute: 'LIGHT',
  race: 'Psychic',
  level: 6,
  atk: 2400,
  def: 1000,
  aiValue: 100,
  text: 'When this card is Normal or Special Summoned, gain 500 Life Points for each Psychic-Type monster in your Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      label: 'Gain LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.method !== 'flip',
      resolve: async (ctx) => {
        const n = ctx.grave('me', isRace('Psychic')).length;
        if (n) await ctx.recover(ctx.player, 500 * n);
      },
    },
  ],
});

monster('Card Guard', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 1600,
  def: 500,
  aiValue: 300,
  text: 'If this card is Normal or Special Summoned: Place 1 Guard Counter on it. This card gains 300 ATK for each Guard Counter on it. Once per turn: You can target 1 other face-up card you control; remove 1 Guard Counter from this card, and if you do, place 1 Guard Counter on that target (if that card would ever be destroyed, remove 1 Guard Counter from it instead).',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      label: 'Place Guard Counter',
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.method !== 'flip',
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self)) ctx.self.counters.guard = (ctx.self.counters.guard ?? 0) + 1;
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 300 * (ctx.self.counters.guard ?? 0) }] },
    {
      kind: 'ignition',
      opt: true,
      label: 'Move Guard Counter',
      categories: ['protect'],
      canActivate: (ctx) => (ctx.self.counters.guard ?? 0) > 0 && ctx.field('me', (c) => c !== ctx.self && c.faceUp).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('me', (c) => c !== ctx.self && c.faceUp), 1, 1, 'Target 1 other face-up card you control.', 'buff');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.onField && c.faceUp);
        if (!t || !faceUpOn(ctx.self) || (ctx.self.counters.guard ?? 0) <= 0) return;
        ctx.self.counters.guard -= 1;
        t.counters.guard = (t.counters.guard ?? 0) + 1;
        t.flags.guardSrc = ctx.self.uid;
        ctx.log(`${t.name} gets a Guard Counter.`);
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main2') return 0;
          const best = bestTarget(ctx.game, ctx.field('me', (c) => c !== ctx.self && c.faceUp));
          return best && cardValue(ctx.game, best) >= 2200 ? 30 : 0;
        },
      },
    },
    {
      // Guard Counters placed by this card's effect protect their card even after Card Guard has left the field.
      kind: 'continuous',
      range: ALL_LOCS,
      replaceDestroy: async (ctx, cards) => {
        const saved: C[] = [];
        for (const c of cards) {
          if (c.flags.guardSrc !== ctx.self.uid || (c.counters.guard ?? 0) <= 0) continue;
          c.counters.guard -= 1;
          ctx.game.log(`A Guard Counter is removed from ${c.name} instead.`, 'action', c.controller);
          saved.push(c);
        }
        return saved;
      },
    },
  ],
});

monster('Flamvell Commando', {
  attribute: 'FIRE',
  race: 'Pyro',
  level: 6,
  atk: 2200,
  def: 200,
  sets: ['flamvell'],
  nomi: true,
  aiValue: 400,
  text: 'This card cannot be Special Summoned. This card can only be Normal Summoned by Tributing 1 "Flamvell" monster you control. Once per turn, you can remove from play 1 monster in your Graveyard with 200 DEF to inflict damage to your opponent equal to that monster\'s ATK.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish 200 DEF: burn',
      categories: ['damage'],
      canActivate: (ctx) => ctx.grave('me', (c) => c.isMonster && c.data.def === 200).length > 0,
      activate: async (ctx) => {
        const [c] = await ctx.select(ctx.grave('me', (c) => c.isMonster && c.data.def === 200), 1, 1, 'Banish 1 monster with 200 DEF from your GY.', 'cost', {
          aiScore: (c) => c.data.atk ?? 0,
        });
        ctx.data.dmg = c.data.atk ?? 0;
        await ctx.banish(c, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.data.dmg > 0) await ctx.damage(ctx.opp, ctx.data.dmg);
      },
      ai: { score: (ctx) => (Math.max(0, ...ctx.grave('me', (c) => c.isMonster && c.data.def === 200).map((c) => c.data.atk ?? 0)) >= 1000 ? 40 : 0) },
    },
  ],
});

monster('White Night Dragon', {
  attribute: 'WATER',
  race: 'Dragon',
  level: 8,
  atk: 3000,
  def: 2500,
  aiValue: 900,
  text: "During either player's turn, when a Spell/Trap Card that targets this card is activated: Negate the activation, and if you do, destroy it. When another face-up monster you control is targeted for an attack: You can send 1 Spell/Trap Card you control to the Graveyard; change the attack target to this card.",
  effects: [
    {
      // APPROX: a mandatory effect in the real game; here it is a Quick Effect the AI always uses.
      kind: 'quick',
      label: 'Negate targeting Spell/Trap',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.isCardActivation && (l.card.isSpell || l.card.isTrap) && l.ctx.targets.includes(ctx.self) && faceUpOn(ctx.self);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: { score: () => 100 },
    },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: 'Redirect attack',
      categories: ['protect'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && t !== ctx.self && t.controller === ctx.player && t.faceUp && faceUpOn(ctx.self) && evc(ev)?.controller === ctx.opp;
      },
      canActivate: (ctx) => ctx.spellTraps('me').length > 0,
      activate: async (ctx) => {
        const [c] = await ctx.select(ctx.spellTraps('me'), 1, 1, 'Send 1 Spell/Trap Card you control to the GY.', 'cost');
        await ctx.sendToGrave(c, 'cost');
      },
      resolve: async (ctx) => {
        const b = ctx.battle;
        if (!b || b.negated || !faceUpOn(ctx.self)) return;
        b.target = ctx.self;
        b.targetMoveId = ctx.self.moveId;
        ctx.log(`The attack target becomes ${ctx.self.name}.`);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || !b.target) return 0;
          const a = ctx.atk(b.attacker);
          const mineDef = b.target.pos === 'atk' ? ctx.atk(b.target) : ctx.def(b.target);
          if (a <= mineDef) return 0;
          // Only spend a face-up continuous card or a dead face-down card.
          const cheap = ctx.spellTraps('me').some((c) => !c.faceUp || cardValue(ctx.game, c) < 1200);
          return cheap && ctx.atk(ctx.self) >= a ? 1 : 0;
        },
      },
    },
  ],
});

monster('Card Blocker', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 3,
  atk: 400,
  def: 400,
  aiValue: 200,
  text: 'When this card is Summoned: Change it to Defense Position. When a face-up monster you control is targeted for an attack: You can change the target to this card. When this card is targeted for an attack: You can choose a number from 1 to 3, then send that many cards from the top of your Deck to the Graveyard; this card gains 500 DEF for each card sent, until the End Phase.',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      label: 'To Defense Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && faceUpOn(ctx.self) && ctx.self.pos === 'atk',
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self) && ctx.self.pos === 'atk') await ctx.changePos(ctx.self, 'def');
      },
    },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: 'Become the attack target',
      categories: ['protect'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && t !== ctx.self && t.controller === ctx.player && t.faceUp && faceUpOn(ctx.self);
      },
      // 2010 ruling: with several "Card Blocker", only 1 of them can change the attack target for that attack.
      // https://edisonrul.ing/cards/c/card-blocker.html
      canActivate: (ctx) => !ctx.game.chain.some((l) => l.card.name === 'Card Blocker' && l.effect.label === 'Become the attack target'),
      resolve: async (ctx) => {
        const b = ctx.battle;
        if (!b || b.negated || !faceUpOn(ctx.self)) return;
        b.target = ctx.self;
        b.targetMoveId = ctx.self.moveId;
        ctx.log(`The attack target becomes ${ctx.self.name}.`);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || !b.target) return 0;
          const a = ctx.atk(b.attacker);
          const t = b.target;
          const td = t.pos === 'atk' ? ctx.atk(t) : ctx.def(t);
          return a > td && cardValue(ctx.game, t) > cardValue(ctx.game, ctx.self) ? 1 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      label: 'Mill for DEF',
      categories: ['mill', 'atkChange'],
      eventFilter: (ctx, ev) => evo(ev) === ctx.self && faceUpOn(ctx.self) && evc(ev)?.controller === ctx.opp,
      canActivate: (ctx) => ctx.deck().length > 1,
      // 2010 ruling: sending up to 3 cards from the Deck to the Graveyard is a cost. https://edisonrul.ing/cards/c/card-blocker.html
      activate: async (ctx) => {
        const max = Math.min(3, ctx.deck().length - 1);
        const a = ctx.battle ? ctx.atk(ctx.battle.attacker) : 0;
        const need = Math.max(1, Math.min(max, Math.ceil((a + 1 - ctx.def(ctx.self)) / 500)));
        const opts = Array.from({ length: max }, (_, i) => `${i + 1}`);
        const n = (await ctx.option('Send how many cards from the top of your Deck?', opts, (i) => (i + 1 === need ? 10 : -i))) + 1;
        const sent = await ctx.game.mill(ctx.player, n, 'cost', ctx.self);
        ctx.data.n = sent.filter((c) => c.location === 'grave').length;
      },
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self) && ctx.data.n) ctx.addTempMod(ctx.self, 'def', 500 * ctx.data.n, 'turn');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          return ctx.atk(b.attacker) > ctx.def(ctx.self) && ctx.deck().length > 10 ? 1 : 0;
        },
      },
    },
  ],
});

monster('Gaia Plate the Earth Giant', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 8,
  atk: 2800,
  def: 1000,
  aiValue: 300,
  text: 'Once per turn, during your Standby Phase, banish 1 Rock monster from your GY or send this card to the GY. You can Special Summon this card (from your hand) by banishing 2 Rock monsters from your GY. If this card battles an opponent\'s monster, that monster\'s ATK/DEF become halved during damage calculation only.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.grave('me', isRace('Rock')).length >= 2,
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', isRace('Rock')), 2, 2, 'Banish 2 Rock monsters from your GY.', 'cost');
        if (sel.length < 2) return false;
        await ctx.banish(sel, 'cost');
        return true;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      opt: true,
      label: 'Maintenance',
      categories: ['banish'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && faceUpOn(ctx.self),
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        const rocks = ctx.grave('me', isRace('Rock'));
        if (rocks.length && (await ctx.confirm('Banish 1 Rock monster from your GY to keep Gaia Plate?'))) {
          const [r] = await ctx.select(rocks, 1, 1, 'Banish 1 Rock monster from your GY.', 'cost');
          if (r) {
            await ctx.banish(r);
            return;
          }
        }
        await ctx.sendToGrave(ctx.self);
      },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', to: 'cards', filter: gaiaPlateFoe, value: (ctx, c) => -halfOf(ctx, c, 'atk') },
        { q: 'def', to: 'cards', filter: gaiaPlateFoe, value: (ctx, c) => -halfOf(ctx, c, 'def') },
      ],
    },
  ],
});
/** The opponent's monster battling Gaia Plate, during the Damage Step. */
function gaiaPlateFoe(ctx: Ctx, c: C) {
  const b = ctx.game.battle;
  if (!b || !b.inDamageStep || c.location !== 'mzone' || c.controller === ctx.player) return false;
  return (b.attacker === ctx.self && b.target === c) || (b.target === ctx.self && b.attacker === c);
}
let halfGuard = 0;
function halfOf(ctx: Ctx, c: C, stat: 'atk' | 'def') {
  if (halfGuard) return 0;
  halfGuard++;
  try {
    return Math.floor((stat === 'atk' ? ctx.atk(c) : ctx.def(c)) / 2);
  } finally {
    halfGuard--;
  }
}

monster('Sauropod Brachion', {
  attribute: 'EARTH',
  race: 'Dinosaur',
  level: 8,
  atk: 1500,
  def: 3000,
  aiValue: 200,
  text: 'Cannot be Special Summoned from the Deck. You can Tribute Summon this card face-up by Tributing 1 Dinosaur monster. Once per turn: You can change this card to face-down Defense Position. If this card is Flip Summoned: Change all other monsters on the field to face-down Defense Position. If this card is attacked, any battle damage your opponent takes from that battle is doubled.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'ignition',
      opt: true,
      label: 'Flip face-down',
      categories: ['position'],
      condition: (ctx) => faceUpOn(ctx.self),
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self)) await ctx.changePos(ctx.self, 'def', false);
      },
      ai: { score: (ctx) => (ctx.phase === 'main2' && ctx.monsters('opp').length >= 2 ? 35 : 0) },
    },
    {
      kind: 'trigger',
      event: 'flipSummoned',
      mandatory: true,
      label: 'Flip all face-down',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      resolve: async (ctx) => {
        for (const c of ctx.monsters('both', (m) => m !== ctx.self && m.faceUp)) {
          if (!ctx.game.isUnaffected(c, ctx.self, ctx.player)) await ctx.changePos(c, 'def', false);
        }
      },
    },
  ],
});
// "Cannot be Special Summoned from the Deck": no effect in this pool Special Summons a Level 8 Dinosaur from the
// Deck, so the restriction never comes up (APPROX: not enforced).

monster('Gaap the Divine Soldier', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 6,
  atk: 2200,
  def: 2000,
  aiValue: 300,
  text: 'All monsters are changed to Attack Position, also their battle positions cannot be changed. (Flip Effects are not activated.) Once per turn: You can reveal any number of Fiend monsters in your hand; this card gains 300 ATK for each, until the end of this turn.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'cannotChangePos', to: 'cards', filter: (_ctx, c) => c.location === 'mzone' }] },
    {
      // APPROX: the position change is a mandatory trigger (a Chain Link) here, not a continuous rule.
      kind: 'trigger',
      event: ['summoned', 'monsterSet', 'positionChanged', 'flipped'],
      mandatory: true,
      label: 'All monsters to Attack Position',
      categories: ['position'],
      eventFilter: (ctx) => faceUpOn(ctx.self) && ctx.monsters('both', (c) => c.pos === 'def').length > 0,
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        for (const c of ctx.monsters('both', (m) => m.pos === 'def')) {
          if (ctx.game.isUnaffected(c, ctx.self, ctx.player)) continue;
          const wasDown = !c.faceUp;
          await ctx.changePos(c, 'atk', true);
          if (wasDown) dropFlipTriggers(ctx.game, c);
        }
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Reveal Fiends',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.hand('me', isRace('Fiend')).length > 0,
      resolve: async (ctx) => {
        const fiends = ctx.hand('me', isRace('Fiend'));
        const sel = await ctx.select(fiends, 1, fiends.length, 'Reveal any number of Fiend monsters in your hand.', 'buff');
        for (const c of sel) reveal(ctx, c);
        if (faceUpOn(ctx.self) && sel.length) ctx.addTempMod(ctx.self, 'atk', 300 * sel.length, 'turn');
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && ctx.game.turn > 1 ? 30 : 0) },
    },
  ],
});

monster('Beast Machine King Barbaros Ür', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 8,
  atk: 3800,
  def: 1200,
  aiValue: 300,
  text: 'You can Special Summon this card (from your hand) by banishing 1 Machine-Type monster and 1 Beast-Warrior-Type monster from your hand, field, and/or Graveyard. If this card attacks or is attacked, your opponent takes no battle damage.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'proc',
      label: 'Special Summon',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && barbarosPairs(ctx).machines.length > 0 && barbarosPairs(ctx).bw.some((b) => barbarosPairs(ctx).machines.some((m) => m !== b)),
      perform: async (ctx) => {
        ensureAnprPatches(ctx.game);
        const { machines } = barbarosPairs(ctx);
        const [m] = await ctx.select(machines, 1, 1, 'Banish 1 Machine-Type monster from your hand, field or GY.', 'cost', { aiScore: (c) => -barbarosCost(ctx, c) });
        if (!m) return false;
        const bw = barbarosPairs(ctx).bw.filter((c) => c !== m);
        const [b] = await ctx.select(bw, 1, 1, 'Banish 1 Beast-Warrior-Type monster from your hand, field or GY.', 'cost', { aiScore: (c) => -barbarosCost(ctx, c) });
        if (!b) return false;
        await ctx.banish([m, b], 'cost');
        return true;
      },
      ai: {
        score: (ctx) => {
          const { machines, bw } = barbarosPairs(ctx);
          const cost = Math.min(...machines.map((c) => barbarosCost(ctx, c))) + Math.min(...bw.map((c) => barbarosCost(ctx, c)));
          return cost < 1500 ? 72 : 0;
        },
      },
    },
  ],
});
function barbarosPairs(ctx: Ctx) {
  const pool = [...ctx.hand('me'), ...ctx.monsters('me', (c) => c.faceUp), ...ctx.grave('me')].filter((c) => c !== ctx.self && c.isMonster);
  return { machines: pool.filter(isRace('Machine')), bw: pool.filter(isRace('Beast-Warrior')) };
}
function barbarosCost(ctx: Ctx, c: C) {
  if (c.location === 'grave') return 0;
  if (c.location === 'hand') return 800 + cardValue(ctx.game, c) / 2;
  return cardValue(ctx.game, c);
}

monster('Kasha', {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 8,
  atk: 0,
  def: 1000,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 800,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned (from your hand) by controlling 2 or more Zombie monsters. If this card is Special Summoned: Shuffle as many other monsters on the field as possible into the Deck, and if you do, this card\'s ATK becomes 1000 x the number of face-up monsters shuffled into the Deck this way, whose original Type was Zombie.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.faceUpMonsters('me', isRace('Zombie')).length >= 2,
      ai: {
        score: (ctx) => {
          const g = ctx.game;
          const mine = ctx.monsters('me').reduce((a, c) => a + cardValue(g, c), 0);
          const theirs = ctx.monsters('opp').reduce((a, c) => a + cardValue(g, c), 0);
          const zombies = ctx.monsters('both', (c) => c.faceUp && c.data.race === 'Zombie').length;
          return theirs + zombies * 1000 > mine + 1000 ? 70 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Shuffle all other monsters',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      resolve: async (ctx) => {
        const others = ctx.monsters('both', (c) => c !== ctx.self && !ctx.game.isUnaffected(c, ctx.self, ctx.player));
        if (!others.length) return;
        const zombies = new Set(others.filter((c) => c.faceUp && c.data.race === 'Zombie' && !c.isToken));
        const r = await ctx.toDeck(others, 'shuffle');
        const n = r.filter((c) => zombies.has(c) && (c.location === 'deck' || c.location === 'extra')).length;
        if (faceUpOn(ctx.self)) {
          ctx.self.flags.baseAtk = 1000 * n;
          ctx.log(`${ctx.self.name}'s ATK becomes ${1000 * n}.`);
          ctx.game.update();
        }
      },
    },
  ],
});

// ============================================================ EXTRA DECK

monster('Turbo Cannon', {
  attribute: 'FIRE',
  race: 'Machine',
  level: 3,
  atk: 0,
  def: 0,
  types: ['synchro'],
  aiValue: 1800,
  text: '"Turbo Rocket" + 1 or more non-Tuner monsters\nOnce per turn, you can destroy 1 face-up monster on the field and inflict damage to its controller equal to half of its ATK.',
  synchro: { tuner: (c) => c.name === 'Turbo Rocket', desc: '"Turbo Rocket" + 1 or more non-Tuner monsters' },
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy & burn',
      categories: ['destroy', 'damage'],
      canActivate: (ctx) => ctx.faceUpMonsters('both').length > 0,
      resolve: async (ctx) => {
        const cands = ctx.faceUpMonsters('both');
        if (!cands.length) return;
        const [t] = await ctx.select(cands, 1, 1, 'Destroy 1 face-up monster on the field.', 'destroy');
        if (!t) return;
        const atk = ctx.atk(t);
        const who = t.controller;
        const r = await ctx.destroy(t);
        if (r.length) await ctx.damage(who, Math.floor(atk / 2));
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('opp').length ? 60 : 0) },
    },
  ],
});

monster('Archfiend Zombie-Skull', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 6,
  atk: 2500,
  def: 1200,
  types: ['synchro'],
  aiValue: 500,
  text: '"Plaguespreader Zombie" + 2+ non-Tuner Zombie monsters\nZombie monsters you control cannot be destroyed by card effects.',
  synchro: {
    tuner: (c) => c.name === 'Plaguespreader Zombie',
    nonTuner: isRace('Zombie'),
    minNonTuners: 2,
    desc: '"Plaguespreader Zombie" + 2+ non-Tuner Zombie monsters',
  },
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'indestructibleEffect', to: 'cards', filter: (ctx, c) => faceUpOn(c) && c.controller === ctx.player && c.data.race === 'Zombie' }],
    },
  ],
});

monster('Arcana Knight Joker', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 9,
  atk: 3800,
  def: 2500,
  types: ['fusion'],
  aiValue: 800,
  text: '"Queen\'s Knight" + "Jack\'s Knight" + "King\'s Knight"\nA Fusion Summon of this card can only be done with the above materials. Once per turn, when a Spell/Trap Card, or monster effect, is activated that targets this face-up card on the field (Quick Effect): You can discard the same type of card (Monster, Spell, or Trap); negate the effect.',
  fusion: {
    materials: [(c) => c.name === "Queen's Knight", (c) => c.name === "Jack's Knight", (c) => c.name === "King's Knight"],
    desc: '"Queen\'s Knight" + "Jack\'s Knight" + "King\'s Knight"',
  },
  effects: [
    {
      // 2010 ruling: it can be activated during the Damage Step. https://edisonrul.ing/cards/a/arcana-knight-joker.html
      kind: 'quick',
      opt: true,
      damageStep: true,
      label: 'Discard: negate',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        if (!l || l.negated || !faceUpOn(ctx.self) || !l.ctx.targets.includes(ctx.self)) return false;
        return l.card.isSpell || l.card.isTrap || (l.card.isMonster && !l.isCardActivation);
      },
      canActivate: (ctx) => {
        const l = ctx.prevLink();
        return !!l && ctx.hand('me', jokerSameType(l.card)).length > 0;
      },
      activate: async (ctx) => {
        const l = ctx.prevLink()!;
        ctx.data.link = l;
        await ctx.discardFromHand(1, jokerSameType(l.card), 'cost', ctx.player, 'Discard 1 card of the same type.');
      },
      resolve: async (ctx) => {
        ctx.negate(ctx.data.link);
      },
      ai: { score: (ctx) => (ctx.prevLink()?.player === ctx.opp ? 90 : 0) },
    },
  ],
});
const jokerSameType = (src: C) => (c: C) => (src.isMonster ? c.isMonster : src.isSpell ? c.isSpell : c.isTrap);

const SACRED_BEASTS = ['Uria, Lord of Searing Flames', 'Hamon, Lord of Striking Thunder', 'Raviel, Lord of Phantasms'];
monster('Armityle the Chaos Phantasm', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 12,
  atk: 0,
  def: 0,
  types: ['fusion'],
  nomi: true,
  aiValue: 1000,
  text: '"Uria, Lord of Searing Flames" + "Hamon, Lord of Striking Thunder" + "Raviel, Lord of Phantasms"\nMust first be Special Summoned (from your Extra Deck) by banishing the above cards you control. (You do not use "Polymerization".) Cannot be destroyed by battle. Gains 10,000 ATK during your turn only.',
  fusion: { materials: SACRED_BEASTS.map((n) => (c: C) => c.name === n), noPoly: true, desc: '"Uria" + "Hamon" + "Raviel"' },
  effects: [
    {
      kind: 'proc',
      range: ['extra'],
      label: 'Contact Fusion',
      categories: ['specialSummon'],
      condition: (ctx) => SACRED_BEASTS.every((n) => ctx.faceUpMonsters('me', (c) => c.name === n).length > 0),
      perform: async (ctx) => {
        const mats = SACRED_BEASTS.map((n) => ctx.faceUpMonsters('me', (c) => c.name === n)[0]);
        if (mats.some((m) => !m)) return false;
        await ctx.game.moveCards(mats, 'banished', { reason: 'material', reasons: ['material', 'fusion', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
        return true;
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'indestructibleBattle' }, { q: 'atk', value: (ctx) => (ctx.isMyTurn ? 10000 : 0) }],
    },
  ],
});

// ============================================================ SPELLS

spell('Release Restraint Wave', 'normal', {
  text: 'Target 1 face-up Equip Spell Card you control; destroy the Equip Spell Card and all face-down Spell and Trap Cards your opponent controls.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      // https://edisonrul.ing/cards/r/release-restraint-wave.html — cannot be activated if the opponent has no Set Spell/Trap Cards.
      canActivate: (ctx) =>
        ctx.spellTraps('opp', (c) => !c.faceUp).length > 0 && ctx.spellTraps('me', (c) => c.faceUp && c.data.stype === 'equip' && c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('me', (c) => c.faceUp && c.data.stype === 'equip' && c !== ctx.self), 1, 1, 'Target 1 face-up Equip Spell you control.', 'cost');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.onField && c.faceUp);
        if (!t) return;
        await ctx.destroy([t, ...ctx.spellTraps('opp', (c) => !c.faceUp)]);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp', (c) => !c.faceUp).length >= 2 ? 60 : 0) },
    },
  ],
});

spell('Silver Wing', 'equip', {
  text: 'Equip only to a Level 8 or higher Dragon-Type Synchro Monster. Twice per turn, it cannot be destroyed by battle. If it would be destroyed by a card effect, you can destroy this card instead.',
  effects: [
    equipActivate(silverWingOk, (ctx) => ownEquipScore(ctx, (c) => silverWingOk(ctx, c), 35)),
    {
      kind: 'continuous',
      replaceDestroy: async (ctx, cards, reason) => {
        const eq = ctx.equipTarget;
        if (!eq || !cards.includes(eq)) return [];
        // https://edisonrul.ing/cards/s/silver-wing.html — copies are not cumulative (2 battles per turn per monster, not per
        // copy), and it cannot replace when it is destroyed by the same effect as the monster.
        if (reason !== 'battle' && cards.includes(ctx.self)) return [];
        if (reason === 'battle') {
          const k = `anpr:silverwing:${eq.uid}:${eq.moveId}`;
          const used = ctx.game.turnData[k] ?? 0;
          if (used >= 2) return [];
          ctx.game.turnData[k] = used + 1;
          ctx.log(`${eq.name} is not destroyed by battle (Silver Wing).`);
          return [eq];
        }
        if (!(await ctx.confirm(`Destroy Silver Wing instead of ${eq.name}?`))) return [];
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        return [eq];
      },
    },
  ],
});
function silverWingOk(_ctx: Ctx, c: C) {
  return c.hasType('synchro') && c.data.race === 'Dragon' && lvl(c) >= 8;
}

spell('Advance Draw', 'normal', {
  text: 'Tribute 1 face-up Level 8 or higher monster you control; draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.level(c) >= 8 && tributable(ctx, c)).length > 0,
      activate: async (ctx) => {
        const t = await ctx.select(ctx.faceUpMonsters('me', (c) => ctx.level(c) >= 8 && tributable(ctx, c)), 1, 1, 'Tribute 1 face-up Level 8 or higher monster.', 'tribute');
        await tributeCost(ctx, t);
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: {
        score: (ctx) => {
          const worst = ctx.faceUpMonsters('me', (c) => ctx.level(c) >= 8).sort((a, b) => cardValue(ctx.game, a) - cardValue(ctx.game, b))[0];
          if (!worst) return 0;
          // Good with Earthbound Immortals that are about to die, or a monster that cannot attack well.
          return ctx.phase === 'main2' || !faceUpFieldSpell(ctx.game) || cardValue(ctx.game, worst) < 2200 ? 50 : 0;
        },
      },
    },
  ],
});

spell('Ancient Forest', 'field', {
  text: 'When you activate this card, change any Defense Position monster(s) to face-up Attack Position. Flip Effects are not activated at this time. If a monster attacks, destroy it at the end of that turn\'s Battle Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['position', 'destroy'],
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        for (const c of ctx.monsters('both', (m) => m.pos === 'def')) {
          if (ctx.game.isUnaffected(c, ctx.self, ctx.player)) continue;
          const wasDown = !c.faceUp;
          await ctx.changePos(c, 'atk', true);
          if (wasDown) dropFlipTriggers(ctx.game, c);
        }
      },
      ai: {
        score: (ctx) => {
          if (ctx.game.players[ctx.player].fzone?.faceUp) return 0;
          // It destroys every monster that attacks (including yours): mainly a home for Earthbound Immortals.
          const ei = ctx.hand('me', isEI).length + ctx.monsters('me', isEI).length;
          const oppDef = ctx.monsters('opp', (c) => c.pos === 'def').length;
          return ei ? 45 : oppDef >= 2 && !ctx.monsters('me').length ? 20 : 0;
        },
      },
    },
    {
      // Bookkeeping: mark each monster that attacks while this card is face-up (never activates). 2010 rulings: a
      // monster that attacks while this card is negated is still destroyed if the negation is gone by the end of the
      // Battle Phase; one whose attack was negated ("Magic Cylinder") is not. https://edisonrul.ing/cards/a/ancient-forest.html
      kind: 'trigger',
      event: ['attackDeclared', 'attackNegated'],
      range: ['fzone'],
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        if (!a || !ctx.self.faceUp || !ctx.self.activeOnField) return false;
        if (ev.type === 'attackDeclared') a.flags.anprForestTurn = ctx.game.turn;
        else if (a.flags.anprForestTurn === ctx.game.turn) delete a.flags.anprForestTurn;
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'battleEnd',
      range: ['fzone'],
      mandatory: true,
      label: 'Destroy attackers',
      categories: ['destroy'],
      eventFilter: (ctx) => stActive(ctx) && ctx.monsters('both', (c) => c.flags.anprForestTurn === ctx.game.turn).length > 0,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.monsters('both', (c) => c.flags.anprForestTurn === ctx.game.turn));
      },
    },
  ],
});

spell('Emergency Assistance', 'normal', {
  text: 'Activate during your Main Phase 2, to Special Summon 1 Level 4 monster from your Graveyard that was destroyed by a card effect and sent to the Graveyard this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.phase === 'main2' && ctx.isMyTurn,
      canActivate: (ctx) => ctx.canSpecialSummon() && emergencyCands(ctx).length > 0,
      resolve: async (ctx) => {
        const cands = emergencyCands(ctx);
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 monster destroyed by a card effect this turn.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0]);
      },
      ai: { score: (ctx) => (Math.max(0, ...emergencyCands(ctx).map((c) => c.data.atk ?? 0)) >= 1400 ? 50 : 0) },
    },
  ],
});
function emergencyCands(ctx: Ctx) {
  const set = destroyedByEffectThisTurn(ctx.game);
  return ctx.grave('me', (c) => set.has(c) && c.isMonster && lvl(c) === 4 && ctx.canSummonCard(c));
}

spell('Spirit Burner', 'equip', {
  text: 'Once per turn, you can change the battle position of the equipped monster to Defense Position. When the equipped monster is returned from the field to the hand and this card is sent to the Graveyard, inflict 600 damage to your opponent. If this card is in the Graveyard, you can add it to your hand instead of conducting a normal draw during your Draw Phase.',
  effects: [
    equipActivate((_ctx, _c) => true, (ctx) => {
      if (!mainPhase(ctx)) return 0;
      // Best on a Spirit or a monster that likes to switch to Defense after attacking.
      return ctx.faceUpMonsters('me', (c) => c.hasType('spirit')).length ? 30 : 0;
    }),
    {
      kind: 'ignition',
      opt: true,
      label: 'Equipped to Defense Position',
      categories: ['position'],
      condition: (ctx) => !!ctx.equipTarget && ctx.equipTarget.pos === 'atk' && ctx.equipTarget.controller === ctx.player,
      resolve: async (ctx) => {
        const eq = ctx.equipTarget;
        if (eq && faceUpOn(eq) && eq.pos === 'atk') await ctx.changePos(eq, 'def');
      },
      ai: { score: (ctx) => (ctx.phase === 'main2' && ctx.equipTarget && ctx.atk(ctx.equipTarget) < ctx.def(ctx.equipTarget) ? 20 : 0) },
    },
    {
      // Bookkeeping: remember that the equipped monster went back to the hand (never activates).
      kind: 'trigger',
      event: 'returnedToHand',
      range: ['szone'],
      eventFilter: (ctx, ev) => {
        if (ctx.self.equippedTo != null && evc(ev)?.uid === ctx.self.equippedTo) ctx.game.turnData[`anpr:burner:${ctx.self.uid}`] = ctx.self.moveId;
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Burn 600',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && ctx.game.turnData[`anpr:burner:${ctx.self.uid}`] === ctx.self.moveId - 1,
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 600);
      },
    },
    {
      // APPROX: "instead of conducting a normal draw" is an optional trigger at the start of the Draw Phase.
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Add instead of drawing',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.phase === 'draw' && ctx.isMyTurn && !(ctx.game.turn === 1 && ctx.game.options.skipFirstDraw),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave') return;
        const g = ctx.game;
        const p = ctx.player;
        await ctx.toHand(ctx.self);
        const mod = { player: p, q: 'cannotDraw' as const, value: true as number | boolean, until: 'turn' as const, turn: g.turn };
        g.playerMods.push(mod);
        g.addDelayed('standby', async () => {
          const i = g.playerMods.indexOf(mod);
          if (i >= 0) g.playerMods.splice(i, 1);
        });
      },
      ai: { score: () => 0 },
    },
  ],
});

spell('Future Visions', 'field', {
  text: 'Each time a monster is Normal Summoned: Target that monster; banish it. During the next Standby Phase of the player who controlled that monster: Return it to the field in face-up Attack Position.',
  effects: [
    { kind: 'activate', categories: ['banish'], ai: { score: (ctx) => (!ctx.hand('me', (c) => c.isMonster).length && ctx.hand('opp').length >= 3 ? 15 : 0) } },
    {
      kind: 'trigger',
      event: 'normalSummoned',
      range: ['fzone'],
      mandatory: true,
      label: 'Banish Normal Summoned monster',
      categories: ['banish'],
      eventFilter: (ctx, ev) => stActive(ctx) && !!evc(ev) && faceUpOn(evc(ev)!),
      activate: async (ctx) => {
        const c = evc(ctx.event!)!;
        if (ctx.canTarget(c)) ctx.addTargets([c]);
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'mzone');
        if (!t) return;
        const ctrl = t.controller;
        const r = await ctx.banish(t);
        if (!r.length || t.location !== 'banished') return;
        const id = t.moveId;
        const g = ctx.game;
        g.addDelayed(
          'standby',
          async () => {
            if (t.location === 'banished' && t.moveId === id) await returnToField(g, t, t.owner === ctrl ? ctrl : t.owner, 'atk');
          },
          g.turnPlayer === ctrl ? 2 : 1,
        );
      },
    },
  ],
});

spell('Core Compression', 'normal', {
  text: 'Reveal 1 "Iron Core of Koa\'ki Meiru" in your hand and discard 1 "Koa\'ki Meiru" monster to activate this card. Draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'discard'],
      canActivate: (ctx) => ctx.hand('me', isIronCore).length > 0 && ctx.hand('me', (c) => c !== ctx.self && isKoakiMonster(c)).length > 0,
      activate: async (ctx) => {
        reveal(ctx, ctx.hand('me', isIronCore)[0]);
        await ctx.discardFromHand(1, isKoakiMonster, 'cost', ctx.player, 'Discard 1 "Koa\'ki Meiru" monster.');
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: { score: () => 55 },
    },
  ],
});

spell('Core Blaster', 'equip', {
  text: 'Equip only to a "Koa\'ki Meiru" monster. If it battles a LIGHT or DARK monster, destroy that monster without applying damage calculation. When the equipped monster is removed from the field and this card is sent to the Graveyard, you can return this card to your hand.',
  effects: [
    equipActivate((_ctx, c) => isKoakiMonster(c), (ctx) => ownEquipScore(ctx, isKoakiMonster, 32)),
    {
      // APPROX: applied as a Damage Step Quick Effect (no "start of the Damage Step" event); the AI always uses it.
      kind: 'quick',
      damageStep: true,
      label: 'Destroy LIGHT/DARK battler',
      categories: ['destroy'],
      condition: (ctx) => {
        const foe = coreBlasterFoe(ctx);
        return !!foe && stActive(ctx);
      },
      activate: async (ctx) => {
        ctx.data.foe = coreBlasterFoe(ctx);
      },
      resolve: async (ctx) => {
        const f = ctx.data.foe as C;
        if (f && f.location === 'mzone') await ctx.destroy(f);
      },
      ai: { score: () => 100 },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Return to hand',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && reasonsOf(ev).includes('rule'),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toHand(ctx.self);
      },
    },
  ],
});
function coreBlasterFoe(ctx: Ctx): C | undefined {
  const b = ctx.battle;
  const eq = ctx.equipTarget;
  if (!b || !b.inDamageStep || !eq || !b.target) return undefined;
  const foe = b.attacker === eq ? b.target : b.target === eq ? b.attacker : undefined;
  if (!foe || foe.location !== 'mzone' || !foe.faceUp) return undefined;
  return foe.data.attribute === 'LIGHT' || foe.data.attribute === 'DARK' ? foe : undefined;
}

spell('Solidarity', 'continuous', {
  text: 'If you have only 1 original Type of monster in your Graveyard, all monsters you control with the same Type gain 800 ATK.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      ai: {
        score: (ctx) => {
          const r = solidarityRace(ctx);
          return r && ctx.faceUpMonsters('me', (c) => c.data.race === r).length ? 35 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (ctx, c) => {
            const r = solidarityRace(ctx);
            return !!r && faceUpOn(c) && c.controller === ctx.player && c.data.race === r;
          },
          value: 800,
        },
      ],
    },
  ],
});
// https://edisonrul.ing/cards/s/solidarity.html — the GY is checked by ORIGINAL (printed) Types (Zombie World does not
// make them all Zombies); the monsters on the field by their current Type (DNA Surgery counts).
function solidarityRace(ctx: Ctx): Race | undefined {
  const races = new Set(ctx.grave('me', (c) => c.isMonster).map((c) => c.printedData.race));
  return races.size === 1 ? [...races][0] : undefined;
}

spell('Hydro Pressure Cannon', 'equip', {
  text: "Equip only to a Level 3 or lower WATER monster. If it destroys an opponent's monster by battle, send 1 random card in your opponent's hand to the Graveyard.",
  effects: [
    equipActivate(
      (ctx, c) => c.data.attribute === 'WATER' && ctx.level(c) <= 3,
      (ctx) => ownEquipScore(ctx, (c) => c.data.attribute === 'WATER' && ctx.level(c) <= 3, 28),
    ),
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Random discard',
      categories: ['discard'],
      eventFilter: equippedDestroysByBattle,
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (hand.length) await ctx.discard(hand[ctx.game.rng.int(hand.length)]);
      },
    },
  ],
});

spell('Water Hazard', 'continuous', {
  text: 'Once per turn: You can Special Summon 1 Level 4 or lower WATER monster from your hand. You must control no monsters to activate and to resolve this effect.',
  effects: [
    { kind: 'activate', categories: ['specialSummon'], ai: { score: (ctx) => (ctx.hand('me', waterHazardOk).length ? 30 : 0) } },
    {
      kind: 'ignition',
      opt: true,
      label: 'Summon WATER from hand',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.monsters('me').length === 0,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => waterHazardOk(c) && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        if (ctx.monsters('me').length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(ctx.hand('me', (c) => waterHazardOk(c) && ctx.canSummonCard(c)), 1, 1, 'Special Summon 1 Level 4 or lower WATER monster from your hand.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0]);
      },
      ai: { score: () => 60 },
    },
  ],
});
const waterHazardOk = (c: C) => c.isMonster && !c.isExtra && c.data.attribute === 'WATER' && lvl(c) <= 4;

/** Brain Research Lab: counters survive the move that resets them, so its leave-field damage can read them. */
const labCounters = new WeakMap<C, { moveId: number; n: number }>();
interface LabGrant {
  lab: C;
  entry: { allow: (card: C, set: boolean) => boolean };
  used: boolean;
}
const labLive = (g: Game, lab: C, p: PlayerId) =>
  lab.location === 'fzone' && lab.faceUp && lab.activeOnField && lab.controller === p && !g.isNegated(lab);
/** Brain Research Lab: once per turn, the turn player with a face-up Lab gets 1 extra Normal Summon for a Psychic-Type monster. */
function labGrant(g: Game, p: PlayerId) {
  if (g.turnPlayer !== p || g.turnData[`anpr:brl:${p}`]) return;
  const lab = g.players[p].fzone;
  if (!lab || lab.name !== 'Brain Research Lab' || !labLive(g, lab, p)) return;
  const entry = { allow: (card: C, set: boolean) => !set && card.data.race === 'Psychic' && labLive(g, lab, p) };
  const ps = g.players[p];
  ps.normalSummonsLeft += 1;
  (ps.restrictedSummons ??= []).push(entry);
  g.turnData[`anpr:brl:${p}`] = { lab, entry, used: false } satisfies LabGrant;
}
spell('Brain Research Lab', 'field', {
  text: 'Once per turn, you can Normal Summon 1 Psychic-Type monster in addition to your Normal Summon or Set. If successful, place 1 Psychic Counter on this card. You can also place 1 Psychic Counter on this card instead of paying Life Points to activate any Psychic-Type monster\'s effect that you control. When this card is removed from the field, the controller of this card takes 1000 damage for each Psychic Counter on it.',
  effects: [
    PATCH_LISTENER,
    { kind: 'activate', categories: ['lockdown'], ai: { score: (ctx) => (ctx.hand('me', isRace('Psychic')).length >= 2 ? 25 : 0) } },
    {
      // 2010 rulings: the extra Normal Summon is a Continuous-like effect (no Chain, nothing to activate). It can be used
      // before or after your regular Normal Summon/Set, only to Normal (Tribute) Summon a Psychic-Type monster (not to
      // Set), and only once per turn even with 2 copies (the grant is per player, see labGrant). The Psychic Counter is
      // placed when it is used. https://edisonrul.ing/cards/b/brain-research-lab.html
      // APPROX: the "Psychic Counter instead of paying Life Points" option is not implemented.
      // Bookkeeping (never activates): place the Psychic Counter when the extra Normal Summon was used.
      kind: 'trigger',
      event: 'normalSummoned',
      range: ['fzone'],
      eventFilter: (ctx, ev) => {
        const grant = ctx.game.turnData[`anpr:brl:${ctx.player}`] as LabGrant | undefined;
        const c = evc(ev);
        if (grant && !grant.used && grant.lab === ctx.self && c && ev.player === ctx.player && !(ctx.game.players[ctx.player].restrictedSummons ?? []).includes(grant.entry)) {
          grant.used = true;
          ctx.self.counters.psychic = (ctx.self.counters.psychic ?? 0) + 1;
          labCounters.set(ctx.self, { moveId: ctx.self.moveId, n: ctx.self.counters.psychic });
          ctx.game.log(`A Psychic Counter is placed on ${ctx.self.name}.`, 'action', ctx.player);
        }
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      mandatory: true,
      label: 'Psychic Counter damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const rec = labCounters.get(ctx.self);
        return ev.card === ctx.self && ev.from === 'fzone' && !!rec && rec.moveId === ctx.self.moveId - 1 && rec.n > 0;
      },
      resolve: async (ctx) => {
        const rec = labCounters.get(ctx.self);
        const who = ctx.event?.fromController ?? ctx.player;
        if (rec) await ctx.damage(who, 1000 * rec.n);
      },
    },
  ],
});

spell('Sword of Sparkles', 'equip', {
  text: 'Equip only to an "X-Saber" monster. If it destroys an opponent\'s monster by battle, you can destroy 1 card your opponent controls. You can Tribute 1 monster you control to return this card from your Graveyard to the top of your Deck.',
  effects: [
    equipActivate((_ctx, c) => isXSaber(c), (ctx) => ownEquipScore(ctx, isXSaber, 30)),
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      label: 'Destroy 1 card',
      categories: ['destroy'],
      eventFilter: equippedDestroysByBattle,
      canActivate: (ctx) => ctx.field('opp').length > 0,
      resolve: async (ctx) => {
        const sel = await ctx.select(ctx.field('opp'), 1, 1, 'Destroy 1 card your opponent controls.', 'destroy');
        if (sel.length) await ctx.destroy(sel);
      },
    },
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Tribute: return to Deck',
      categories: ['toDeck'],
      canActivate: (ctx) => ctx.monsters('me', (c) => tributable(ctx, c)).length > 0,
      activate: async (ctx) => {
        const t = await ctx.select(ctx.monsters('me', (c) => tributable(ctx, c)), 1, 1, 'Tribute 1 monster you control.', 'tribute');
        await tributeCost(ctx, t);
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toDeck(ctx.self, 'top');
      },
      ai: { score: () => 0 },
    },
  ],
});

spell('Ancient Leaf', 'normal', {
  text: 'If you have 9000 or more Life Points, you can pay 2000 Life Points to draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      condition: (ctx) => ctx.lp >= 9000,
      activate: async (ctx) => {
        await ctx.payLp(2000);
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: { score: () => 60 },
    },
  ],
});

spell('Fossil Dig', 'normal', {
  text: 'Add 1 Level 6 or lower Dinosaur monster from your Deck to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['search'],
      canActivate: (ctx) => ctx.deck('me', fossilFilter).length > 0,
      resolve: async (ctx) => {
        await ctx.search(fossilFilter, 1, 'Add 1 Level 6 or lower Dinosaur monster to your hand.');
      },
    },
  ],
});
const fossilFilter = (c: C) => c.isMonster && c.data.race === 'Dinosaur' && lvl(c) <= 6;

spell('Pseudo Space', 'field', {
  text: "Once per turn: You can banish 1 Field Spell Card from your Graveyard; until the End Phase, this card's name becomes that card's original name, and replace this effect with that card's original effects.",
  effects: [
    { kind: 'activate', categories: ['lockdown'], ai: { score: (ctx) => (ctx.grave('me', isFieldSpell).length ? 20 : 0) } },
    {
      // APPROX: the copied card's lasting effects (continuous, ignition, trigger) apply; effects that only happen
      // when that card is activated do not.
      kind: 'ignition',
      opt: true,
      label: 'Copy a Field Spell',
      categories: ['lockdown'],
      canActivate: (ctx) => ctx.grave('me', (c) => isFieldSpell(c) && c.name !== ctx.self.data.name).length > 0,
      activate: async (ctx) => {
        const [f] = await ctx.select(ctx.grave('me', (c) => isFieldSpell(c) && c.name !== ctx.self.data.name), 1, 1, 'Banish 1 Field Spell from your GY.', 'cost', {
          aiScore: (c) => (c.data.effects ?? []).filter((e) => e.kind !== 'activate').length,
        });
        ctx.data.copy = f.data;
        await ctx.banish(f, 'cost');
      },
      resolve: async (ctx) => {
        const src = ctx.data.copy as C['data'];
        const me = ctx.self;
        if (!stActive(ctx) || !src) return;
        const orig = me.data;
        const id = me.moveId;
        me.data = { ...orig, name: src.name, text: src.text, effects: (src.effects ?? []).filter((e) => e.kind !== 'activate') };
        const sources = (ctx.game as any).continuousSources as C[];
        if (Array.isArray(sources) && !sources.includes(me)) sources.push(me);
        ctx.log(`${orig.name} becomes "${src.name}" until the End Phase.`);
        ctx.game.update();
        ctx.later('end', async () => {
          if (me.data !== orig) {
            me.data = orig;
            if (me.moveId === id) ctx.game.log(`${me.name} returns to normal.`, 'info');
            ctx.game.update();
          }
        });
      },
      ai: {
        score: (ctx) => {
          const best = ctx.grave('me', (c) => isFieldSpell(c) && c.name !== ctx.self.data.name);
          return best.some((c) => (c.data.effects ?? []).some((e) => e.kind === 'continuous')) && ctx.phase === 'main1' ? 30 : 0;
        },
      },
    },
  ],
});
const isFieldSpell = (c: C) => c.isSpell && c.data.stype === 'field';

spell('Greed Grado', 'quickplay', {
  text: 'Activate only if you destroyed a face-up Synchro Monster controlled by your opponent this turn, either by battle or by a card effect. Draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      condition: (ctx) =>
        turnEvents(ctx.game).some(
          (ev) =>
            ev.type === 'destroyed' &&
            !!evc(ev)?.hasType('synchro') &&
            ev.from === 'mzone' &&
            !!ev.fromFaceUp &&
            ev.fromController === ctx.opp &&
            ev.reasonPlayer === ctx.player &&
            (reasonsOf(ev).includes('battle') || reasonsOf(ev).includes('effect')),
        ),
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: { score: () => 70 },
    },
  ],
});

// ============================================================ TRAPS

trap('Skill Successor', 'normal', {
  text: 'Target 1 face-up monster you control; it gains 400 ATK until the end of this turn. During your turn, except the turn this card was sent to the GY: You can banish this card from your GY, then target 1 face-up monster you control; that target gains 800 ATK until the end of this turn.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Target 1 face-up monster you control.', 'buff', { aiScore: (c) => battlingMine(ctx, c) });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets(faceUpOn);
        if (t) ctx.addTempMod(t, 'atk', 400, 'turn');
      },
      ai: { score: (ctx) => boostScore(ctx, 400) },
    },
    {
      // Bookkeeping: the turn this card was sent to the GY (never activates).
      kind: 'trigger',
      event: 'sentToGrave',
      range: ['grave'],
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self) ctx.self.flags.gyTurn = ctx.game.turn;
        return false;
      },
    },
    {
      kind: 'quick',
      range: ['grave'],
      damageStep: true,
      label: 'Banish: +800 ATK',
      categories: ['atkChange'],
      condition: (ctx) => ctx.isMyTurn && ctx.self.flags.gyTurn !== ctx.game.turn,
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.banish(ctx.self, 'cost');
        await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Target 1 face-up monster you control.', 'buff', { aiScore: (c) => battlingMine(ctx, c) });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets(faceUpOn);
        if (t) ctx.addTempMod(t, 'atk', 800, 'turn');
      },
      ai: { score: (ctx) => boostScore(ctx, 800) },
    },
  ],
});
/** AI: prefer the monster of mine that is battling. */
function battlingMine(ctx: Ctx, c: C) {
  const b = ctx.battle;
  return (b && (b.attacker === c || b.target === c) ? 10000 : 0) + ctx.atk(c);
}
/** AI: is an ATK boost of `n` now enough to win the current battle (or finish the opponent)? */
function boostScore(ctx: Ctx, n: number) {
  const b = ctx.battle;
  if (!b || !b.inDamageStep) return 0;
  const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
  const theirs = mine === b.attacker ? b.target : b.attacker;
  if (!mine || mine.controller !== ctx.player || !faceUpOn(mine)) return 0;
  if (!theirs) return mine === b.attacker && ctx.atk(mine) + n >= ctx.oppLp ? 100 : 0;
  const their = theirs.pos === 'atk' ? ctx.atk(theirs) : ctx.def(theirs);
  const my = ctx.atk(mine);
  if (mine === b.target && mine.pos === 'def') return 0;
  return my <= their && my + n > their ? 90 : 0;
}

trap('Reinforce Truth', 'normal', {
  text: 'Special Summon 1 Level 2 or lower Warrior-Type monster from your Deck. You cannot conduct your Battle Phase the turn you activate this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => truthFilter(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        ctx.addPlayerMod(ctx.player, 'cannotDeclareAttack');
        ctx.data.lock = ctx.game.playerMods.slice(-1);
      },
      // https://edisonrul.ing/cards/r/reinforce-truth.html — if its activation is negated (Seven Tools, Solemn Judgment) you
      // can still conduct your Battle Phase; if only its effect is negated (Royal Decree) you cannot.
      onActivationNegated: (ctx) => {
        const g = ctx.game;
        const lock = (ctx.data.lock ?? []) as typeof g.playerMods;
        g.playerMods = g.playerMods.filter((m) => !lock.includes(m));
        g.update();
      },
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => truthFilter(c) && ctx.canSummonCard(c));
        if (cands.length && ctx.canSpecialSummon()) {
          const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 2 or lower Warrior-Type monster from your Deck.', 'specialSummon');
          if (sel.length) await ctx.specialSummon(sel[0]);
        }
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          if (ctx.isMyTurn) return 0;
          const b = ctx.battle;
          if (b && b.attacker.controller === ctx.opp && !b.target && !b.inDamageStep) return 60;
          return ctx.phase === 'end' ? 40 : 0;
        },
      },
    },
  ],
});
const truthFilter = (c: C) => c.isMonster && !c.isExtra && c.data.race === 'Warrior' && lvl(c) <= 2;

trap('Pixie Ring', 'continuous', {
  text: 'While you control 2 or more face-up Attack Position monsters, your opponent cannot target your monster(s) with the lowest ATK for an attack.',
  effects: [
    { kind: 'activate', categories: ['protect'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => c.pos === 'atk').length >= 2 ? 25 : 0) } },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'cannotBeAttacked',
          to: 'cards',
          filter: (ctx, c) => {
            // https://edisonrul.ing/cards/p/pixie-ring.html — your lowest-ATK monster cannot be attacked even in Defense Position.
            if (!faceUpOn(c) || c.controller !== ctx.player) return false;
            if (ctx.faceUpMonsters('me', (m) => m.pos === 'atk').length < 2) return false;
            const min = Math.min(...ctx.faceUpMonsters('me').map((m) => ctx.atk(m)));
            return ctx.atk(c) === min;
          },
        },
      ],
    },
  ],
});

trap('Fairy Wind', 'normal', {
  text: 'Destroy as many face-up Spells/Traps on the field as possible, except this card, and if you do, each player takes damage equal to the total number of cards destroyed by this effect x 300.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti', 'damage'],
      canActivate: (ctx) => ctx.spellTraps('both', (c) => c !== ctx.self && c.faceUp).length > 0,
      resolve: async (ctx) => {
        const r = await ctx.destroy(ctx.spellTraps('both', (c) => c !== ctx.self && c.faceUp));
        if (!r.length) return;
        await ctx.damage(ctx.player, 300 * r.length);
        await ctx.damage(ctx.opp, 300 * r.length);
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.spellTraps('me', (c) => c !== ctx.self && c.faceUp && !ctx.game.chain.some((l) => l.card === c)).length;
          const theirs = ctx.spellTraps('opp', (c) => c.faceUp && !ctx.game.chain.some((l) => l.card === c)).length;
          if (theirs <= mine || ctx.lp <= 300 * (mine + theirs)) return 0;
          return 40 + 10 * (theirs - mine);
        },
      },
    },
  ],
});

trap('Imperial Custom', 'continuous', {
  text: 'Face-up Continuous Traps cannot be destroyed by battle or card effect, except "Imperial Custom". You can only control 1 "Imperial Custom".',
  effects: [
    {
      kind: 'activate',
      categories: ['protect'],
      canActivate: (ctx) => !ctx.spellTraps('me', (c) => c !== ctx.self && c.faceUp && c.name === 'Imperial Custom').length,
      ai: { score: (ctx) => (ctx.spellTraps('me', (c) => c.faceUp && c.data.ttype === 'continuous').length ? 30 : 0) },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'indestructibleEffect', to: 'cards', filter: (_ctx, c) => imperialProtected(c) },
        { q: 'indestructibleBattle', to: 'cards', filter: (_ctx, c) => imperialProtected(c) },
      ],
    },
  ],
});
const imperialProtected = (c: C) => c.location === 'szone' && c.faceUp && c.isTrap && c.data.ttype === 'continuous' && c.name !== 'Imperial Custom';

trap('Discord', 'continuous', {
  text: 'Neither player can Synchro Summon. Send this card to the Graveyard during your 3rd End Phase after activation.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      resolve: async (ctx) => {
        ctx.self.counters.discord = 0;
      },
      ai: {
        score: (ctx) => {
          const theirs = ctx.extra('opp').length;
          const mine = ctx.extra('me').length;
          if (ctx.isMyTurn) return 0;
          return theirs > mine && ctx.monsters('opp').length >= 1 ? 35 : 0;
        },
      },
    },
    {
      // Neither player can Synchro Summon: no monster can be used as Synchro Material.
      kind: 'continuous',
      mods: [{ q: 'cannotBeSynchroMaterial', to: 'cards', filter: (_ctx, c) => c.location === 'mzone' }],
    },
    {
      // Sending it to the GY on your 3rd End Phase does not start a Chain: https://edisonrul.ing/cards/d/discord.html
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      label: '(End Phase count)',
      eventFilter: (ctx, ev) => {
        if (ev.phase !== 'end' || !ctx.isMyTurn || !stActive(ctx)) return false;
        const me = ctx.self;
        const n = (me.counters.discord ?? 0) + 1;
        me.counters.discord = n;
        if (n >= 3) {
          const mid = me.moveId;
          ctx.game.addDelayed('end', async () => {
            if (me.onField && me.moveId === mid) await ctx.game.sendToGrave([me], 'effect', me.controller, me);
          });
        }
        return false;
      },
    },
  ],
});

trap('Slip of Fortune', 'normal', {
  text: 'Activate only when your opponent\'s monster declares an attack targeting a monster. Negate the attack and remove from play the attack target monster until the next Standby Phase.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack', 'banish'],
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        return !!a && a.controller === ctx.opp && !!evo(ev) && !!ctx.battle && !ctx.battle.inDamageStep;
      },
      activate: async (ctx) => {
        const t = ctx.battle?.target;
        if (t && ctx.canTarget(t)) ctx.addTargets([t]);
      },
      resolve: async (ctx) => {
        if (ctx.battle) ctx.negateAttack();
        const [t] = ctx.validTargets((c) => c.location === 'mzone');
        if (!t) return;
        const pos = t.pos;
        const r = await ctx.banish(t);
        if (!r.length || t.location !== 'banished') return;
        const id = t.moveId;
        const g = ctx.game;
        g.addDelayed('standby', async () => {
          if (t.location === 'banished' && t.moveId === id) await returnToField(g, t, t.owner, pos);
        }, 1);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || !b.target || b.target.controller !== ctx.player) return 0;
          const a = ctx.atk(b.attacker);
          const t = b.target;
          const td = t.faceUp ? (t.pos === 'atk' ? ctx.atk(t) : ctx.def(t)) : 1200;
          return a > td && cardValue(ctx.game, t) >= 1200 ? 50 : 0;
        },
      },
    },
  ],
});

trap('Depth Amulet', 'continuous', {
  text: "When your opponent's monster declares an attack, you can discard 1 card to negate the attack. Destroy this card during your opponent's 3rd End Phase after activation.",
  effects: [
    {
      kind: 'activate',
      categories: ['protect'],
      resolve: async (ctx) => {
        ctx.self.counters.amulet = 0;
      },
      ai: { score: (ctx) => (!ctx.isMyTurn && ctx.hand().length >= 3 ? 20 : 0) },
    },
    {
      kind: 'quick',
      event: 'attackDeclared',
      label: 'Discard: negate attack',
      categories: ['negateAttack'],
      // Targets the attacking monster; discarding is not a cost: the discard and the negation happen together on
      // resolution: https://edisonrul.ing/cards/d/depth-amulet.html
      eventFilter: (ctx, ev) => evc(ev)?.controller === ctx.opp && !!ctx.battle && !ctx.battle.inDamageStep && !ctx.battle.negated,
      canActivate: (ctx) => ctx.hand().length > 0 && !!ctx.battle && ctx.canTarget(ctx.battle.attacker),
      activate: async (ctx) => {
        if (ctx.battle) ctx.addTargets([ctx.battle.attacker]);
      },
      resolve: async (ctx) => {
        if (!ctx.hand().length) return;
        const d = await ctx.discardFromHand(1, undefined, 'effect', ctx.player, 'Discard 1 card.');
        if (d.length && ctx.battle && ctx.validTargets((c) => c === ctx.battle?.attacker).length) ctx.negateAttack();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const a = ctx.atk(b.attacker);
          if (!b.target) return a >= 1200 || a >= ctx.lp ? 60 : 0;
          const t = b.target;
          const td = t.faceUp ? (t.pos === 'atk' ? ctx.atk(t) : ctx.def(t)) : 1200;
          return a > td && cardValue(ctx.game, t) >= 1500 ? 50 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Turn count',
      eventFilter: (ctx, ev) => ev.phase === 'end' && !ctx.isMyTurn && stActive(ctx),
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const n = (ctx.self.counters.amulet ?? 0) + 1;
        ctx.self.counters.amulet = n;
        if (n >= 3) await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
      },
    },
  ],
});

const ghostToken = token('Ghost Token', 'DARK', 'Fiend', 1, 0, 0, 'Ghost Token (Fiend-Type/DARK/Level 1/ATK 0/DEF 0). Special Summoned by "Damage Translation".');
trap('Damage Translation', 'normal', {
  text: 'Halve all effect damage you take this turn. During the End Phase this turn, Special Summon 1 "Ghost Token" (Fiend-Type/DARK/Level 1/ATK 0/DEF 0) in Defense Position for each time you took effect damage this turn.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: ['protect', 'specialSummon'],
      resolve: async (ctx) => {
        const g = ctx.game;
        const p = ctx.player;
        ensureAnprPatches(g);
        g.turnData[`anpr:halve:${p}`] = true;
        const turn = g.turn;
        g.addDelayed('end', async () => {
          if (g.turn !== turn) return;
          const n = turnEvents(g).filter((ev) => ev.type === 'damage' && ev.player === p && ev.reason === 'effect').length;
          if (n > 0 && !g.queryPlayer(p, 'cannotSpecialSummon')) await g.createTokens(p, ghostToken, Math.min(n, g.freeMZones(p)), 'def');
        });
      },
      ai: {
        score: (ctx) => {
          const top = ctx.chainTop();
          if (top && top.player === ctx.opp && (top.effect.categories ?? []).includes('damage')) return 55;
          return 0;
        },
      },
    },
  ],
});

trap('Battle Teleportation', 'normal', {
  text: 'Activate if you control only 1 face-up Psychic-Type monster, and select that monster. It can attack your opponent directly this turn. At the end of the Battle Phase, give control of that monster to your opponent.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange', 'control'],
      // 2010 rulings: it can be activated any time from your Draw Phase to the end of your Battle Phase (not if you cannot
      // conduct a Battle Phase); if your opponent has no open Monster Card Zone, the monster cannot move and is
      // destroyed. https://edisonrul.ing/cards/b/battle-teleportation.html
      condition: (ctx) => ctx.isMyTurn && ctx.game.turn > 1 && ['draw', 'standby', 'main1', 'battle'].includes(ctx.phase),
      canActivate: (ctx) => {
        const ps = ctx.faceUpMonsters('me', isRace('Psychic'));
        return ps.length === 1 && ctx.canTarget(ps[0]);
      },
      activate: async (ctx) => {
        ctx.addTargets(ctx.faceUpMonsters('me', isRace('Psychic')));
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets(faceUpOn);
        if (!t) return;
        ctx.addTempMod(t, 'directAttack', true, 'turn');
        ctx.game.turnData[`anpr:teleport:${t.uid}`] = { card: t, moveId: t.moveId, to: ctx.opp };
      },
      ai: {
        score: (ctx) => {
          const [t] = ctx.faceUpMonsters('me', isRace('Psychic'));
          if (!t || !ctx.monsters('opp').length) return 0;
          return ctx.atk(t) >= ctx.oppLp ? 100 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'battleEnd',
      range: ['grave', 'banished', 'hand', 'deck'],
      mandatory: true,
      label: 'Give control',
      categories: ['control'],
      eventFilter: (ctx) => teleported(ctx).length > 0,
      resolve: async (ctx) => {
        for (const e of teleported(ctx)) {
          delete ctx.game.turnData[`anpr:teleport:${e.card.uid}`];
          if (e.card.location !== 'mzone' || e.card.moveId !== e.moveId || e.card.controller === e.to) continue;
          if (ctx.game.freeMZones(e.to) <= 0) await ctx.game.destroy([e.card], 'effect', ctx.player, ctx.self);
          else await ctx.game.takeControl(e.card, e.to, false);
        }
      },
    },
  ],
});
function teleported(ctx: Ctx): { card: C; moveId: number; to: PlayerId }[] {
  return Object.entries(ctx.game.turnData)
    .filter(([k, v]) => k.startsWith('anpr:teleport:') && v && (v as any).to === ctx.opp)
    .map(([, v]) => v as { card: C; moveId: number; to: PlayerId });
}

/** Core Reinforcement: the monster it revived (kept across the trap's own moves). */
const coreLinks = new WeakMap<C, { mon: C; moveId: number }>();
trap('Core Reinforcement', 'continuous', {
  text: 'Select and Special Summon 1 "Koa\'ki Meiru" monster from your Graveyard in Attack Position. When that monster is destroyed during your End Phase, the controller of this card takes damage equal to that monster\'s ATK. When this card is removed from the field, destroy that monster. When that monster is destroyed, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isKoakiMonster(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isKoakiMonster(c) && ctx.canSummonCard(c)), 1, 1, 'Select 1 "Koa\'ki Meiru" monster in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t) return;
        const r = await ctx.specialSummon(t, { pos: 'atk' });
        if (r.length && ctx.self.onField) {
          ctx.game.link(ctx.self, r[0]);
          coreLinks.set(ctx.self, { mon: r[0], moveId: r[0].moveId });
        }
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('me', (c) => isKoakiMonster(c) && ctx.canSummonCard(c)).map((c) => c.data.atk ?? 0));
          if (best < 1500) return 0;
          return !ctx.isMyTurn && ctx.phase === 'end' ? 55 : ctx.isMyTurn && ctx.phase === 'main1' ? 45 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      range: ['szone', 'grave'],
      mandatory: true,
      label: 'Take damage',
      categories: ['damage'],
      // Not when the monster is destroyed because this card left the field first (MST in the End Phase), but yes when
      // both are destroyed together (Icarus Attack): https://edisonrul.ing/cards/c/core-reinforcement.html
      eventFilter: (ctx, ev) => {
        const l = coreLinks.get(ctx.self);
        return (
          !!l && ev.card === l.mon && l.mon.moveId === l.moveId + 1 && ctx.phase === 'end' && ctx.game.turnPlayer === ctx.player && !reasonsOf(ev).includes('rule')
        );
      },
      resolve: async (ctx) => {
        const l = coreLinks.get(ctx.self);
        if (!l) return;
        coreLinks.delete(ctx.self);
        await ctx.damage(ctx.player, l.mon.data.atk ?? 0);
      },
    },
  ],
});

trap('Iron Core Luster', 'counter', {
  text: 'Reveal 1 "Iron Core of Koa\'ki Meiru" in your hand. Negate the activation of your opponent\'s Spell or Trap Card, and destroy it.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.isCardActivation && l.player === ctx.opp && (l.card.isSpell || l.card.isTrap);
      },
      canActivate: (ctx) => ctx.hand('me', isIronCore).length > 0,
      activate: async (ctx) => {
        reveal(ctx, ctx.hand('me', isIronCore)[0]);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: { score: (ctx) => negateWorth(ctx) },
    },
  ],
});
/** AI: is the opponent's Spell/Trap on the chain worth negating? */
function negateWorth(ctx: Ctx) {
  const l = ctx.prevLink();
  if (!l || l.player !== ctx.opp) return 0;
  const cats = l.effect.categories ?? [];
  if (cats.some((c) => ['destroyMulti', 'control', 'specialSummon', 'draw', 'search', 'negate', 'negateAttack'].includes(c))) return 70;
  if (l.ctx.targets.some((t) => t.controller === ctx.player)) return 65;
  return (l.card.data.aiValue ?? 0) >= 400 ? 50 : 0;
}

trap('Battle of the Elements', 'normal', {
  text: 'Activate only while all monsters on the field are face-up. Both players send monsters they control to the Graveyard so that they each control only 1 Attribute.',
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck', 'destroyMulti'],
      // 2010 ruling: it can only be activated with at least 1 face-up monster on each side of the field.
      // https://edisonrul.ing/cards/b/battle-of-the-elements.html
      condition: (ctx) => ctx.monsters('me').length > 0 && ctx.monsters('opp').length > 0 && ctx.monsters('both').every((c) => c.faceUp),
      canActivate: (ctx) => [ctx.player, ctx.opp].some((p) => attrGroups(ctx.game, p).size > 1),
      resolve: async (ctx) => {
        if (!ctx.monsters('both').every((c) => c.faceUp)) return;
        const send: C[] = [];
        for (const p of [ctx.game.turnPlayer, ctx.game.opp(ctx.game.turnPlayer)] as PlayerId[]) {
          const groups = attrGroups(ctx.game, p);
          if (groups.size <= 1) continue;
          const keys = [...groups.keys()];
          const vals = keys.map((k) => groups.get(k)!.reduce((a, c) => a + cardValue(ctx.game, c), 0));
          const i = await ctx.game.option(p, 'Choose the Attribute you keep.', keys, ctx.self, (k) => vals[k]);
          for (const k of keys) if (k !== keys[i]) send.push(...groups.get(k)!);
        }
        if (send.length) await ctx.sendToGrave(send);
      },
      ai: {
        score: (ctx) => {
          const loss = (p: PlayerId) => {
            const groups = [...attrGroups(ctx.game, p).values()].map((g) => g.reduce((a, c) => a + cardValue(ctx.game, c), 0));
            return groups.reduce((a, v) => a + v, 0) - Math.max(0, ...groups);
          };
          const d = loss(ctx.opp) - loss(ctx.player);
          return d >= 2000 ? 50 + d / 200 : 0;
        },
      },
    },
  ],
});
function attrGroups(g: Game, p: PlayerId) {
  const m = new Map<string, C[]>();
  for (const c of g.monsters(p)) {
    const a = c.data.attribute ?? '?';
    m.set(a, [...(m.get(a) ?? []), c]);
  }
  return m;
}

trap('Aegis of the Ocean Dragon Lord', 'normal', {
  text: 'Until the End Phase of this turn, face-up Level 3 or lower WATER monsters you control cannot be destroyed by battle or by card effects.',
  effects: [
    {
      // 2010 rulings: it can be activated with no such monster, and it also covers the ones Summoned after it resolved
      // (a lingering effect for the rest of the turn). https://edisonrul.ing/cards/a/aegis-of-the-ocean-dragon-lord.html
      kind: 'activate',
      damageStep: true,
      categories: ['protect'],
      resolve: async (ctx) => {
        const list = ((ctx.game.turnData.anprAegis ??= []) as { uid: number; p: PlayerId }[]);
        list.push({ uid: ctx.self.uid, p: ctx.player });
        ctx.game.update();
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.faceUpMonsters('me', aegisOk(ctx));
          const top = ctx.chainTop();
          if (top && top.player === ctx.opp && (top.ctx.targets.some((t) => mine.includes(t)) || (top.effect.categories ?? []).includes('destroyMulti'))) return 60;
          const b = ctx.battle;
          if (b && !b.inDamageStep && b.target && mine.includes(b.target)) {
            const t = b.target;
            return ctx.atk(b.attacker) > (t.pos === 'atk' ? ctx.atk(t) : ctx.def(t)) ? 45 : 0;
          }
          return 0;
        },
      },
    },
    {
      kind: 'continuous',
      range: ALL_LOCS,
      active: (ctx) => ((ctx.game.turnData.anprAegis ?? []) as { uid: number }[]).some((e) => e.uid === ctx.self.uid),
      mods: (['indestructibleBattle', 'indestructibleEffect'] as const).map((q) => ({
        q,
        to: 'cards' as const,
        filter: (ctx: Ctx, c: C) =>
          faceUpOn(c) && aegisOk(ctx)(c) && ((ctx.game.turnData.anprAegis ?? []) as { uid: number; p: PlayerId }[]).some((e) => e.uid === ctx.self.uid && e.p === c.controller),
      })),
    },
  ],
});
const aegisOk = (ctx: Ctx) => (c: C) => c.data.attribute === 'WATER' && ctx.level(c) <= 3;

trap('Psychic Soul', 'normal', {
  text: 'Tribute 1 Psychic-Type monster you control. Gain Life Points equal to the Level of the Tributed monster x 300.',
  effects: [
    {
      kind: 'activate',
      categories: ['recover'],
      canActivate: (ctx) => ctx.monsters('me', (c) => isRace('Psychic')(c) && tributable(ctx, c)).length > 0,
      activate: async (ctx) => {
        const [t] = await ctx.select(ctx.monsters('me', (c) => isRace('Psychic')(c) && tributable(ctx, c)), 1, 1, 'Tribute 1 Psychic-Type monster you control.', 'tribute');
        ctx.data.level = ctx.level(t);
        await tributeCost(ctx, [t]);
      },
      resolve: async (ctx) => {
        await ctx.recover(ctx.player, 300 * (ctx.data.level ?? 0));
      },
      ai: {
        score: (ctx) => {
          // Save a Psychic that is about to be destroyed anyway.
          const top = ctx.chainTop();
          const doomed = top && top.player === ctx.opp && top.ctx.targets.some((t) => t.controller === ctx.player && t.data.race === 'Psychic');
          return doomed ? 45 : 0;
        },
      },
    },
  ],
});

trap('Flamvell Counter', 'counter', {
  text: 'When a Spell/Trap Card is activated: Banish 1 FIRE monster with 200 DEF from your GY; negate the activation, and if you do, destroy it.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.isCardActivation && (l.card.isSpell || l.card.isTrap);
      },
      canActivate: (ctx) => ctx.grave('me', flamvellCounterCost).length > 0,
      activate: async (ctx) => {
        const [c] = await ctx.select(ctx.grave('me', flamvellCounterCost), 1, 1, 'Banish 1 FIRE monster with 200 DEF from your GY.', 'cost');
        await ctx.banish(c, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: { score: (ctx) => negateWorth(ctx) },
    },
  ],
});
const flamvellCounterCost = (c: C) => c.isMonster && c.data.attribute === 'FIRE' && c.data.def === 200;

trap('At One With the Sword', 'normal', {
  text: "Activate while the only monster you control is 1 face-up \"X-Saber\" monster. Equip this card to that monster. It gains 800 ATK. If it destroys your opponent's monster by battle, draw 1 card.",
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      condition: (ctx) => {
        const m = ctx.monsters('me');
        return m.length === 1 && faceUpOn(m[0]) && isXSaber(m[0]);
      },
      canActivate: (ctx) => ctx.canTarget(ctx.monsters('me')[0]),
      activate: async (ctx) => {
        ctx.addTargets(ctx.monsters('me'));
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets(faceUpOn);
        if (!t || !ctx.self.onField || !ctx.self.faceUp) return;
        ctx.self.flags.staysOnField = true;
        ctx.self.activeOnField = true;
        ctx.equip(t);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (b && b.inDamageStep) return boostScore(ctx, 800);
          return ctx.isMyTurn && ctx.phase === 'main1' && ctx.game.turn > 1 ? 30 : 0;
        },
      },
      damageStep: true,
    },
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: equipped, value: 800 }] },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: equippedDestroysByBattle,
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

trap('A Major Upset', 'normal', {
  text: 'Tribute 1 face-up Attack Position Level 2 or lower monster; return all Level 7 or higher Special Summoned monsters to the hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand', 'destroyMulti'],
      canActivate: (ctx) => upsetFodder(ctx).length > 0 && ctx.monsters('both', upsetVictim(ctx)).length > 0,
      activate: async (ctx) => {
        const t = await ctx.select(upsetFodder(ctx), 1, 1, 'Tribute 1 face-up Attack Position Level 2 or lower monster.', 'tribute');
        await tributeCost(ctx, t);
      },
      resolve: async (ctx) => {
        const v = ctx.monsters('both', upsetVictim(ctx));
        if (v.length) await ctx.toHand(v);
      },
      ai: {
        score: (ctx) => {
          const g = ctx.game;
          const theirs = ctx.monsters('opp', upsetVictim(ctx)).reduce((a, c) => a + cardValue(g, c), 0);
          const mine = ctx.monsters('me', upsetVictim(ctx)).reduce((a, c) => a + cardValue(g, c), 0);
          return theirs - mine >= 2500 ? 60 : 0;
        },
      },
    },
  ],
});
const upsetFodder = (ctx: Ctx) => ctx.faceUpMonsters('me', (c) => c.pos === 'atk' && ctx.level(c) <= 2 && tributable(ctx, c));
const upsetVictim = (ctx: Ctx) => (c: C) => faceUpOn(c) && ctx.level(c) >= 7 && isSpecialSummoned(c);

trap('Revival of the Immortals', 'normal', {
  text: 'Target 1 "Earthbound Immortal" monster in your GY; Special Summon it, but it cannot declare an attack this turn, also your opponent takes no battle damage from attacks involving it.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && !anyFaceUpEI(ctx.game) && ctx.grave('me', (c) => isEI(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isEI(c) && ctx.canSummonCard(c)), 1, 1, 'Target 1 "Earthbound Immortal" monster in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        ensureAnprPatches(ctx.game);
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t || anyFaceUpEI(ctx.game)) return;
        const r = await ctx.specialSummon(t);
        if (!r.length) return;
        r[0].flags.cannotAttackTurn = ctx.game.turn;
        r[0].flags.anprRevivalNoDamage = true;
      },
      ai: { score: (ctx) => (faceUpFieldSpell(ctx.game) && (!ctx.isMyTurn ? ctx.phase === 'end' : ctx.phase === 'main1') ? 55 : 0) },
    },
  ],
});

export const ANPR_LOADED = true;
