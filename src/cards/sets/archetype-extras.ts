// Archetype extras: the cards the group-D archetype decks (src/decks/group-d.ts) need that no other set file
// defines. Six Samurai (Grandmaster and the original Six), Backs to the Wall, Evil HERO Infernal Prodigy (Diva Hero),
// the Dark Turbo pieces (Red-Eyes Darkness Metal Dragon, Red-Eyes Wyvern, Phantom of Chaos, Sky Scourge Norleras)
// and the Monarch floodgates Dark Dust Spirit and Vanity's Fiend.
//
// Every card had an English TCG printing on or before the Edison cut-off (2010-04-24); the first English printing
// is noted on each card. None of them was on the March 2010 Forbidden & Limited list, so all are Unlimited.
// Card text is the Edison-era (pre-errata) wording; effects follow the 2010 TCG rulings as far as the engine allows.
// Approximations are marked "APPROX:".
//
// No engine change. Hooks reused: EffectDef.replaceDestroyOne (ABPF) for the Six Samurai destruction
// substitution, the per-instance data override `patchData` (abpf.ts) for Phantom of Chaos, `nomi` for
// "cannot be Special Summoned" (as Tsukuyomi). Game rules the engine has no hook for are installed per game by
// `ensureArchetypeExtrasPatches` (the technique of lodt.ts / glas.ts):
//  * battle damage: Phantom of Chaos (the opponent takes none from attacks involving it);
//  * Summon legality: Grandmaster of the Six Samurai (only 1 face-up under your control), Dark Dust Spirit and
//    Vanity's Fiend (never Special Summoned, also by effects that do not check `Ctx.canSummonCard`).
import { monster, trap } from '../define';
import { cardValue } from '../helpers';
import type { CardData, CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { Game } from '../../engine/game';
import type { GameEvent, Location, PlayerId } from '../../engine/types';
import { patchData } from './abpf';

type C = CardInstance;

// ============================================================ names

const GRANDMASTER = 'Grandmaster of the Six Samurai';
const REDMD = 'Red-Eyes Darkness Metal Dragon';
const WYVERN = 'Red-Eyes Wyvern';
const CHICK = 'Red-Eyes B. Chick';
const PHANTOM = 'Phantom of Chaos';
const NORLERAS = 'Sky Scourge Norleras';
const DARK_DUST = 'Dark Dust Spirit';
const VANITY = "Vanity's Fiend";
const PHANTOM_ID = 'phantom-of-chaos';

// ============================================================ helpers

const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
const isMain = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';
const isSixSamurai = (c: C) => c.isMonster && (c.inSet('six-samurai') || c.name.includes('Six Samurai'));
const isHero = (c: C) => c.isMonster && (c.inSet('hero') || /\bHERO\b|\bHero\b/.test(c.name));
const isDragon = (c: C) => c.isMonster && c.data.race === 'Dragon';
const isRedEyes = (c: C) => c.isMonster && c.name.startsWith('Red-Eyes');
/** AI: Red-Eyes monsters our own Red-Eyes Wyvern links on the chain already target. */
const wyvernTargeted = (ctx: Ctx) => new Set(ctx.game.chain.filter((l) => l.player === ctx.player && l.card.name === WYVERN && l.card !== ctx.self).flatMap((l) => l.ctx.targets));

/** Events since the start of the current turn's Draw Phase. */
function turnEvents(g: Game): GameEvent[] {
  const log = g.eventLog;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'phaseStart' && e.phase === 'draw') return log.slice(i);
  }
  return log;
}

/** Did player `p` Normal Summon or Set a monster this turn? */
function normalSummonedThisTurn(g: Game, p: PlayerId) {
  // https://edisonrul.ing/cards/r/red-eyes-wyvern.html — a Normal Summon negated by "Solemn Judgment" still counts.
  return !!g.turnData.normalSummonedOrSet?.[p] || turnEvents(g).some((e) => (e.type === 'normalSummoned' || e.type === 'monsterSet') && e.player === p);
}

/** The face-up, non-negated Six Samurai monster `self` needs: one with a different name that its controller controls. */
const otherSamurai = (ctx: Ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && isSixSamurai(c) && c.name !== ctx.self.name).length > 0;

// ============================================================ per-game patches

const PATCHED = new WeakSet<Game>();

/** Face-up copies of `name` controlled by `p`. */
const faceUpNamed = (g: Game, p: PlayerId, name: string) => g.faceUpMonsters(p).filter((c) => c.name === name);
const neverSpecial = (c: C) => c.name === DARK_DUST || c.name === VANITY;

export function ensureArchetypeExtrasPatches(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;

  // ---- battle damage: Phantom of Chaos
  const origDamage = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: C, sourcePlayer?: PlayerId) => {
    if (kind === 'battle' && amount > 0 && g.battle) {
      const b = g.battle;
      const involved = [b.attacker, b.target].filter((c): c is C => !!c);
      const ph = involved.find((c) => c.data.id === PHANTOM_ID && c.controller !== p && faceUpOn(c) && !g.isNegated(c));
      if (ph) {
        g.log(`${g.players[p].name} takes no battle damage (${PHANTOM}).`, 'battle', p);
        return 0;
      }
    }
    return origDamage(p, amount, kind, source, sourcePlayer);
  };

  // ---- Summon legality
  const origCanNS = g.canNormalSummon.bind(g);
  anyG.canNormalSummon = (p: PlayerId, card: C, set = false) => {
    if (!origCanNS(p, card, set)) return false;
    if (!set && card.name === GRANDMASTER && faceUpNamed(g, p, GRANDMASTER).length) return false;
    return true;
  };
  const origSS = g.specialSummon.bind(g);
  anyG.specialSummon = async (cards: C[], player: PlayerId, opts: Parameters<Game['specialSummon']>[2] = {}) => {
    const ctrl = opts?.controller ?? player;
    const list: C[] = [];
    for (const c of cards) {
      if (neverSpecial(c)) continue;
      if (c.name === GRANDMASTER && !opts?.faceDown && (faceUpNamed(g, ctrl, GRANDMASTER).length || list.some((x) => x.name === GRANDMASTER))) continue;
      list.push(c);
    }
    if (!list.length) return [];
    return origSS(list, player, opts);
  };
  const origISS = g.inherentSpecialSummon.bind(g);
  anyG.inherentSpecialSummon = async (p: PlayerId, card: C, ...rest: any[]) => {
    if (neverSpecial(card)) return false;
    return (origISS as any)(p, card, ...rest);
  };
}

/** Installs the per-game patches at the first phase (from any location, never activates). */
const PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  eventFilter: (ctx) => {
    ensureArchetypeExtrasPatches(ctx.game);
    return false;
  },
};

type MonsterOpts = Parameters<typeof monster>[1];
type STOpts = Parameters<typeof trap>[2];
/** Define a card of this file (adds the patch installer). */
const M = (name: string, o: MonsterOpts) => monster(name, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });
const T = (name: string, t: Parameters<typeof trap>[1], o: STOpts) => trap(name, t, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });

// ============================================================ Six Samurai

/**
 * "If this card would be destroyed, you can destroy another face-up "Six Samurai" monster you control instead."
 * The substitute is destroyed by this effect; it is not itself replaced again.
 * APPROX: the replacement hook sees one card at a time, so during a mass destruction (Dark Hole, Mirror Force) the
 * substitute may be a Samurai that was going to be destroyed anyway.
 */
const SUBSTITUTING = new WeakSet<Game>();
const samuraiSubstitute: EffectDef = {
  kind: 'continuous',
  replaceDestroyOne: async (ctx, card) => {
    if (card !== ctx.self || !faceUpOn(ctx.self) || SUBSTITUTING.has(ctx.game)) return false;
    const subs = ctx.faceUpMonsters('me', (c) => c !== ctx.self && isSixSamurai(c));
    if (!subs.length) return false;
    const val = (c: C) => cardValue(ctx.game, c);
    const cheapest = [...subs].sort((a, b) => val(a) - val(b))[0];
    // AI: only trade down (a cheaper Samurai for this one).
    if (!(await ctx.confirm(`Destroy another face-up "Six Samurai" monster instead of ${ctx.self.name}?`, val(cheapest) < val(ctx.self)))) return false;
    const [sub] = await ctx.select(subs, 1, 1, `Destroy 1 face-up "Six Samurai" monster instead of ${ctx.self.name}.`, 'cost', { aiScore: (c) => -val(c) });
    if (!sub) return false;
    ctx.game.log(`${sub.name} is destroyed instead of ${ctx.self.name}.`, 'action', ctx.player);
    SUBSTITUTING.add(ctx.game);
    try {
      await ctx.game.destroy([sub], 'effect', ctx.player, ctx.self);
    } finally {
      SUBSTITUTING.delete(ctx.game);
    }
    return sub.location !== 'mzone' && faceUpOn(ctx.self);
  },
};

const SUB_TEXT = 'If this card would be destroyed, you can destroy another face-up "Six Samurai" monster on your side of the field instead.';

// In print before Edison: Gold Series (GLD1, 2008-04-09) and Turbo Pack: Booster One (TU01, 2009-09-12), per the
// collection set lists (src/collection/sets).
M(GRANDMASTER, {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 5,
  atk: 2100,
  def: 800,
  sets: ['six-samurai'],
  aiValue: 600,
  text: 'You can only control 1 "Grandmaster of the Six Samurai". While you control a face-up "Six Samurai" monster, you can Special Summon this card from your hand. When this card is destroyed by your opponent\'s card effect, add 1 "Six Samurai" monster from your Graveyard to your hand.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (you control a Six Samurai)',
      categories: ['specialSummon'],
      condition: (ctx) =>
        ctx.freeMZones() > 0 && ctx.faceUpMonsters('me', isSixSamurai).length > 0 && !ctx.faceUpMonsters('me', (c) => c.name === GRANDMASTER).length,
      perform: async () => true,
      ai: { score: () => 72 },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      range: ['grave', 'banished'],
      label: 'Add a Six Samurai from the GY',
      categories: ['toHand'],
      // https://edisonrul.ing/cards/g/grandmaster-of-the-six-samurai.html — a mandatory Trigger Effect that cannot miss
      // the timing; it targets 1 "Six Samurai" monster in your GY (itself included) and activates & resolves in the GY /
      // removed-from-play area, wherever the opponent's card effect destroyed it.
      mandatory: true,
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.reason === 'effect' && ev.reasonPlayer !== undefined && ev.reasonPlayer !== ctx.player,
      canActivate: (ctx) => ctx.grave('me', (c) => isSixSamurai(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isSixSamurai(c)), 1, 1, 'Select 1 "Six Samurai" monster in your GY.', 'toHand', {
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

/** "Once per turn ... destroy 1 [face-up | Set] Spell/Trap Card. This card cannot attack during the turn you activate this effect." */
function samuraiSpellKiller(faceUp: boolean): EffectDef {
  const cands = (ctx: Ctx) => ctx.spellTraps('both', (c) => (faceUp ? c.faceUp : !c.faceUp) && c !== ctx.self);
  return {
    kind: 'ignition',
    opt: true,
    label: faceUp ? 'Destroy 1 face-up Spell/Trap' : 'Destroy 1 Set Spell/Trap',
    categories: ['destroy'],
    // https://edisonrul.ing/cards/t/the-six-samurai-kamon.html (and -yaichi): "This monster cannot declare an attack during
    // the turn this effect is used" — not usable once it has attacked this turn (even if it was flipped face-down since).
    condition: (ctx) => otherSamurai(ctx) && ctx.self.attacksThisTurn === 0,
    canActivate: (ctx) => cands(ctx).some((c) => ctx.canTarget(c)),
    activate: async (ctx) => {
      ctx.self.flags.cannotAttackTurn = ctx.turn;
      await ctx.selectTargets(cands(ctx), 1, 1, `Target 1 ${faceUp ? 'face-up' : 'Set'} Spell/Trap Card to destroy.`, 'destroy', {
        aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000),
      });
    },
    resolve: async (ctx) => {
      if (!otherSamurai(ctx)) return; // must still control another Six Samurai to resolve
      const t = ctx.validTargets((c) => c.onField);
      if (t.length) await ctx.destroy(t);
    },
    ai: {
      score: (ctx) => {
        const opp = cands(ctx).filter((c) => c.controller === ctx.opp && ctx.canTarget(c));
        if (!opp.length) return 0;
        // Prefer attacking first when the board is open: still worth it in Main Phase 1 against backrow.
        return faceUp ? 48 : 52;
      },
    },
  };
}

// First English printing (all five): Strike of Neos (STON-EN007 .. STON-EN012), 2007-02-28.
M('The Six Samurai - Yaichi', {
  attribute: 'WATER',
  race: 'Warrior',
  level: 3,
  atk: 1300,
  def: 800,
  sets: ['six-samurai'],
  aiValue: 400,
  text: `If there is a face-up "Six Samurai" monster other than "The Six Samurai - Yaichi" on your side of the field, once per turn, you can destroy 1 face-down Spell or Trap Card on the field. This card cannot declare an attack during the turn you activate this effect. ${SUB_TEXT}`,
  effects: [samuraiSpellKiller(false), samuraiSubstitute],
});

M('The Six Samurai - Kamon', {
  attribute: 'FIRE',
  race: 'Warrior',
  level: 3,
  atk: 1500,
  def: 1000,
  sets: ['six-samurai'],
  aiValue: 300,
  text: `If there is a face-up "Six Samurai" monster other than "The Six Samurai - Kamon" on your side of the field, once per turn, you can destroy 1 face-up Spell or Trap Card on the field. This card cannot declare an attack during the turn you activate this effect. ${SUB_TEXT}`,
  effects: [samuraiSpellKiller(true), samuraiSubstitute],
});

M('The Six Samurai - Irou', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 1700,
  def: 1200,
  sets: ['six-samurai'],
  aiValue: 400,
  text: `If there is a face-up "Six Samurai" monster other than "The Six Samurai - Irou" on your side of the field, when this card attacks a face-down Defense Position monster, destroy that monster without applying damage calculation. ${SUB_TEXT}`,
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      mandatory: true,
      label: 'Destroy the face-down monster',
      categories: ['destroy'],
      // APPROX: resolves at the attack declaration instead of the start of the Damage Step; the attack then ends
      // without damage calculation (no replay).
      eventFilter: (ctx, ev) => {
        const t = ev.other as C | undefined;
        return ev.card === ctx.self && !!t && t.location === 'mzone' && !t.faceUp && t.pos === 'def' && otherSamurai(ctx);
      },
      activate: async (ctx) => {
        const t = ctx.event?.other as C | undefined;
        ctx.data.t = t;
        ctx.data.moveId = t?.moveId;
      },
      resolve: async (ctx) => {
        const t = ctx.data.t as C | undefined;
        if (!t || t.location !== 'mzone' || t.moveId !== ctx.data.moveId || t.faceUp || !otherSamurai(ctx)) return;
        await ctx.destroy(t);
        if (t.location !== 'mzone' && ctx.game.battle?.attacker === ctx.self) ctx.game.battle.negated = true;
      },
    },
    samuraiSubstitute,
  ],
});

M('The Six Samurai - Zanji', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 4,
  atk: 1800,
  def: 1300,
  sets: ['six-samurai'],
  aiValue: 500,
  text: `If there is a face-up "Six Samurai" monster other than "The Six Samurai - Zanji" on your side of the field, any monster this card attacks is destroyed at the end of the Damage Step. ${SUB_TEXT}`,
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Destroy the attacked monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const t = ev.other as C | undefined;
        return ev.card === ctx.self && !!t && t.location === 'mzone' && otherSamurai(ctx);
      },
      activate: async (ctx) => {
        const t = ctx.event?.other as C | undefined;
        ctx.data.t = t;
        ctx.data.moveId = t?.moveId;
      },
      resolve: async (ctx) => {
        const t = ctx.data.t as C | undefined;
        if (!t || t.location !== 'mzone' || t.moveId !== ctx.data.moveId || !otherSamurai(ctx)) return;
        await ctx.destroy(t);
      },
    },
    samuraiSubstitute,
  ],
});

M('The Six Samurai - Nisashi', {
  attribute: 'WIND',
  race: 'Warrior',
  level: 4,
  atk: 1400,
  def: 700,
  sets: ['six-samurai'],
  aiValue: 300,
  text: `If there is a face-up "Six Samurai" monster other than "The Six Samurai - Nisashi" on your side of the field, this card can attack twice during the same Battle Phase. ${SUB_TEXT}`,
  effects: [
    { kind: 'continuous', active: (ctx) => otherSamurai(ctx), mods: [{ q: 'extraAttacks', value: 1 }] },
    samuraiSubstitute,
  ],
});

// First English printing: Force of the Breaker (FOTB-EN052), 2007-05-16.
T('Backs to the Wall', 'normal', {
  text: 'Pay Life Points so that you only have 100 Life Points left. Special Summon as many "Six Samurai" monsters with different names from your Graveyard as possible. (You cannot Special Summon a monster with the same name as a monster you control.)',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.lp > 100 && ctx.canSpecialSummon() && ctx.grave('me', (c) => isSixSamurai(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(ctx.lp - 100);
      },
      resolve: async (ctx) => {
        const taken = new Set(ctx.faceUpMonsters('me').map((c) => c.name));
        const pick: C[] = [];
        const byName = new Map<string, C[]>();
        for (const c of ctx.grave('me', (x) => isSixSamurai(x) && ctx.canSummonCard(x))) {
          if (taken.has(c.name)) continue;
          byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
        }
        // Strongest names first when there are more names than free zones.
        const names = [...byName.keys()].sort((a, b) => (byName.get(b)![0].data.atk ?? 0) - (byName.get(a)![0].data.atk ?? 0));
        for (const n of names) {
          if (pick.length >= ctx.freeMZones()) break;
          if (n === GRANDMASTER && ctx.faceUpMonsters('me', (c) => c.name === GRANDMASTER).length) continue;
          pick.push(byName.get(n)![0]);
        }
        // APPROX: always face-up Attack Position (the card leaves the position open; the deck plays it as a finisher).
        if (pick.length) await ctx.specialSummon(pick, { pos: 'atk' });
      },
      ai: {
        score: (ctx) => {
          const names = new Set(ctx.grave('me', isSixSamurai).map((c) => c.name));
          for (const c of ctx.faceUpMonsters('me')) names.delete(c.name);
          const n = Math.min(names.size, ctx.freeMZones());
          if (n < 2) return 0;
          const atk = ctx
            .grave('me', (c) => isSixSamurai(c) && names.has(c.name))
            .map((c) => c.data.atk ?? 0)
            .sort((a, b) => b - a)
            .slice(0, n)
            .reduce((a, b) => a + b, ctx.faceUpMonsters('me', (c) => c.pos === 'atk').reduce((a, c) => a + ctx.atk(c), 0));
          // Go for it as a finisher (open board, enough ATK), or as a last stand.
          if (ctx.isMyTurn && ctx.phase === 'main1' && ctx.turn > 1 && ctx.monsters('opp').length === 0 && atk >= ctx.oppLp) return 80;
          if (ctx.lp <= 1500 && n >= 3) return 40;
          return 0;
        },
      },
    },
  ],
});

// ============================================================ Diva Hero

// First English printing: Duelist Pack: Jaden Yuki 3 (DP06-EN008), 2008-01-26.
M('Evil HERO Infernal Prodigy', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 2,
  atk: 300,
  def: 600,
  sets: ['hero', 'evil-hero'],
  aiValue: 300,
  text: 'If you control no monsters, you can Special Summon this card from your hand in face-up Attack Position. During the End Phase of a turn in which this card was Tributed for the Tribute Summon of a "HERO" monster, draw 1 card.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (you control no monsters)',
      categories: ['specialSummon'],
      procPositions: ['atk'],
      condition: (ctx) => ctx.monsters('me').length === 0 && ctx.freeMZones() > 0,
      perform: async () => true,
      ai: {
        score: (ctx) => {
          const g = ctx.game;
          const canTribute = g.players[ctx.player].normalSummonsLeft > 0 && ctx.hand('me', (c) => c.isMonster && !c.data.cannotNormalSummon && g.tributesNeeded(c) === 1).length > 0;
          if (canTribute) return 75;
          if (ctx.hand('me', (c) => c.isTuner && !c.data.cannotNormalSummon).length && g.players[ctx.player].normalSummonsLeft > 0) return 66;
          return ctx.phase === 'main1' ? 20 : 0;
        },
      },
    },
    {
      // Bookkeeping: remember that it was Tributed for a "HERO" Tribute Summon this turn.
      kind: 'trigger',
      event: 'tributed',
      range: ['grave', 'banished'],
      label: '(Tributed for a HERO)',
      eventFilter: (ctx, ev) => {
        const by = ev.reasonCard as C | undefined;
        // A Tribute Summon moves the Tributes before the monster, so the summoned HERO is still in the hand here.
        if (ev.card === ctx.self && ev.from === 'mzone' && by && isHero(by)) ctx.self.flags.prodigyTurn = ctx.turn;
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave', 'banished'],
      mandatory: true,
      label: 'Draw 1 card',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.flags.prodigyTurn === ctx.turn,
      resolve: async (ctx) => {
        if (ctx.self.flags.prodigyTurn !== ctx.turn) return;
        ctx.self.flags.prodigyTurn = undefined;
        await ctx.draw(1);
      },
    },
  ],
});

// ============================================================ Dark Turbo

// First English printing: Shonen Jump subscription promo (JUMP-EN030), 2009-02-01.
M(REDMD, {
  attribute: 'DARK',
  race: 'Dragon',
  level: 10,
  atk: 2800,
  def: 2400,
  aiValue: 900,
  text: 'You can remove from play 1 face-up Dragon-Type monster you control to Special Summon this card from your hand. Once per turn, during your Main Phase, you can Special Summon 1 Dragon-Type monster from your hand or Graveyard, except "Red-Eyes Darkness Metal Dragon".',
  // https://edisonrul.ing/cards/r/red-eyes-darkness-metal-dragon.html — its effect does not target a card in the GY
  // and is not negated by "Necrovalley" (the general 2010 rule in src/cards/necrovalley.ts).
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (banish 1 face-up Dragon)',
      categories: ['specialSummon'],
      // The Edison wording has no once-per-turn on this Summon (that was added by later errata).
      condition: (ctx) => ctx.faceUpMonsters('me', isDragon).length > 0,
      perform: async (ctx) => {
        const [d] = await ctx.select(ctx.faceUpMonsters('me', isDragon), 1, 1, 'Remove from play 1 face-up Dragon-Type monster you control.', 'cost', {
          aiScore: (c) => -cardValue(ctx.game, c),
        });
        if (!d) return false;
        await ctx.banish(d, 'cost');
        return true;
      },
      ai: {
        score: (ctx) => {
          const cheapest = Math.min(...ctx.faceUpMonsters('me', isDragon).map((c) => cardValue(ctx.game, c)));
          return cheapest < 2400 ? 74 : 0;
        },
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Special Summon 1 Dragon from hand or GY',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'grave'], (c) => isDragon(c) && c.name !== REDMD && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['hand', 'grave'], (c) => isDragon(c) && c.name !== REDMD && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Dragon-Type monster from your hand or Graveyard.', 'specialSummon', {
          aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0) + (x.location === 'grave' ? 200 : 0),
        });
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
      ai: { score: () => 62 },
    },
  ],
});

// First English printing: Yu-Gi-Oh! GX Tag Force 3 promotional card (GX06-EN002), 2008-11-28.
M(WYVERN, {
  attribute: 'WIND',
  race: 'Dragon',
  level: 4,
  atk: 1800,
  def: 1600,
  aiValue: 300,
  text: 'During your End Phase, if you did not Normal Summon or Set a monster this turn, you can remove from play this card from your Graveyard to Special Summon 1 "Red-Eyes" monster from your Graveyard, except "Red-Eyes B. Chick".',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Banish: Special Summon a Red-Eyes from the GY',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && !normalSummonedThisTurn(ctx.game, ctx.player),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c !== ctx.self && isRedEyes(c) && c.name !== CHICK && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.banish(ctx.self, 'cost');
        await ctx.selectTargets(ctx.grave('me', (c) => isRedEyes(c) && c.name !== CHICK && ctx.canSummonCard(c)), 1, 1, 'Select 1 "Red-Eyes" monster in your GY.', 'specialSummon', {
          // AI: not a monster another of our Wyverns already targets on this chain
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) - (wyvernTargeted(ctx).has(c) ? 10000 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.specialSummon(t[0], { pos: 'choose' });
      },
      ai: {
        // Several Wyverns trigger together: only as many as there are monsters to revive (the triggers are all confirmed
        // before any goes on the chain, so rank this Wyvern among them), never a second one at the same monster.
        score: (ctx) => {
          const taken = wyvernTargeted(ctx);
          const wyverns = ctx.grave('me', (c) => c.name === WYVERN && c !== ctx.self);
          const targets = ctx.grave('me', (c) => c !== ctx.self && isRedEyes(c) && c.name !== CHICK && c.name !== WYVERN && !taken.has(c) && ctx.canSummonCard(c));
          if (!targets.length && (taken.size || !wyverns.length)) return 0;
          const rank = wyverns.filter((c) => c.uid < ctx.self.uid).length;
          return rank < Math.max(1, targets.length) ? 60 : 0;
        },
      },
    },
  ],
});

// ---- Phantom of Chaos: the copied card data lives in PHANTOM_COPY until the End Phase (or until it leaves).
const PHANTOM_COPY = new WeakMap<C, { data: CardData; turn: number; moveId: number }>();
/** Phantom of Chaos's printed data (before any copy). */
const CARD_BASE = new WeakMap<C, CardData>();
const PHANTOM_PATCHED = new WeakSet<C>();
/** Phantom of Chaos's own lasting effects, kept while it copies another monster. */
const PHANTOM_KEEP: EffectDef[] = [
  // Registers Phantom of Chaos as a continuous source so copied continuous effects apply (no mods of its own:
  // the battle damage rule lives in ensureArchetypeExtrasPatches).
  { kind: 'continuous', mods: [] },
  PATCH_LISTENER,
];
function copyInto(g: Game, ph: C, src: C) {
  if (!PHANTOM_PATCHED.has(ph)) {
    PHANTOM_PATCHED.add(ph);
    patchData(ph, (_orig, card) => {
      const s = PHANTOM_COPY.get(card);
      return s && s.turn === g.turn && s.moveId === card.moveId && card.location === 'mzone' ? s.data : undefined;
    });
  }
  const base = CARD_BASE.get(ph) ?? ph.data;
  CARD_BASE.set(ph, base);
  // APPROX: only the effects that work on the field are copied (Special Summon procedures and hand / GY effects are
  // dropped), and the copy keeps Phantom of Chaos's Level, Attribute and Type.
  const copied = (src.data.effects ?? []).filter((e) => {
    if (e.kind === 'proc' || e === PATCH_LISTENER) return false;
    if (e.range && !e.range.includes('mzone')) return false;
    return true;
  });
  // The kept effects come first so the copied ones never share an effect index (once-per-turn key) with
  // Phantom of Chaos's own copy effect (index 0 of its printed data).
  const data: CardData = { ...base, name: src.data.name, atk: src.data.atk, effects: [...PHANTOM_KEEP, ...copied] };
  PHANTOM_COPY.set(ph, { data, turn: g.turn, moveId: ph.moveId });
  // "Until the End Phase": the copy ends as the End Phase begins.
  g.addDelayed('end', async () => {
    if (PHANTOM_COPY.get(ph)?.data === data) {
      PHANTOM_COPY.delete(ph);
      g.update();
    }
  });
  g.update();
}

/** How much Phantom of Chaos gains by copying `c` (AI). */
function phantomValue(c: C) {
  let v = (c.data.atk ?? 0) + (c.data.aiValue ?? 0) / 2;
  if (c.name === 'Dark Armed Dragon') v += 1500;
  if ((c.data.effects ?? []).some((e) => e.kind === 'ignition' && (!e.range || e.range.includes('mzone')))) v += 300;
  return v;
}

// First English printing: Gladiator's Assault Special Edition (GLAS-ENSE1), 2007-12-12.
M(PHANTOM, {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 0,
  def: 0,
  aiValue: 500,
  text: 'Once per turn, you can select 1 Effect Monster in your Graveyard and remove it from play (the banish is not a cost). Until the End Phase, this card\'s name is treated as the removed monster\'s name, and this card has the same original ATK and effects as that monster. Any Battle Damage your opponent takes from attacks involving this card becomes 0.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish an Effect Monster: copy it',
      categories: ['atkChange'],
      // Rulings audit: the Effect Monster is targeted on activation and banished on resolution (not a cost), so
      // D.D. Crow / Necrovalley in response stop the copy; the copy happens only if it was banished.
      canActivate: (ctx) => ctx.grave('me', (c) => c.hasType('effect') && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const [c] = await ctx.selectTargets(ctx.grave('me', (x) => x.hasType('effect')), 1, 1, 'Target 1 Effect Monster in your Graveyard.', 'banish', {
          aiScore: (x) => phantomValue(x),
        });
        if (!c) return false;
      },
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        const [src] = ctx.validTargets((c) => c.location === 'grave');
        if (!src) return;
        const r = await ctx.banish(src);
        if (!r.length || src.location !== 'banished') return;
        copyInto(ctx.game, ctx.self, src);
        ctx.log(`${PHANTOM} becomes "${src.name}" (${src.data.atk ?? 0} ATK) until the End Phase.`);
      },
      ai: {
        score: (ctx) => {
          if (!isMain(ctx)) return 0;
          const best = Math.max(0, ...ctx.grave('me', (c) => c.hasType('effect')).map(phantomValue));
          return best >= 1800 ? 64 : 0;
        },
      },
    },
    ...PHANTOM_KEEP.slice(0, 1),
  ],
});

// First English printing: Force of the Breaker (FOTB-EN022), 2007-05-16.
const isLightFairy = (c: C) => c.isMonster && c.data.attribute === 'LIGHT' && c.data.race === 'Fairy';
const isDarkFiend = (c: C) => c.isMonster && c.data.attribute === 'DARK' && c.data.race === 'Fiend';
M(NORLERAS, {
  attribute: 'DARK',
  race: 'Fiend',
  level: 8,
  atk: 2400,
  def: 1500,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 600,
  text: 'This card cannot be Normal Summoned or Set. This card can only be Special Summoned by removing from play 1 LIGHT Fairy-Type monster and 3 DARK Fiend-Type monsters in your Graveyard. You can pay 1000 Life Points to send all cards on the field and in both players\' hands to the Graveyard. Then, draw 1 card.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (banish 1 LIGHT Fairy + 3 DARK Fiends)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.grave('me', isLightFairy).length >= 1 && ctx.grave('me', isDarkFiend).length >= 3,
      perform: async (ctx) => {
        const [l] = await ctx.select(ctx.grave('me', isLightFairy), 1, 1, 'Remove from play 1 LIGHT Fairy-Type monster in your GY.', 'cost');
        const d = await ctx.select(ctx.grave('me', isDarkFiend), 3, 3, 'Remove from play 3 DARK Fiend-Type monsters in your GY.', 'cost');
        if (!l || d.length < 3) return false;
        await ctx.banish([l, ...d], 'cost');
        return true;
      },
      ai: { score: () => 66 },
    },
    {
      kind: 'ignition',
      label: 'Pay 1000: send all field and hand cards to the GY, draw 1',
      categories: ['destroyMulti'],
      canActivate: (ctx) => ctx.lp > 1000,
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        const all = [...ctx.field('both'), ...ctx.hand('me'), ...ctx.hand('opp')];
        if (all.length) await ctx.sendToGrave(all);
        await ctx.draw(1);
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.field('me').filter((c) => c !== ctx.self).length + ctx.hand('me').length;
          const theirs = ctx.field('opp').length + ctx.hand('opp').length;
          return ctx.lp > 2500 && theirs - mine >= 4 ? 70 : 0;
        },
      },
    },
  ],
});

// ============================================================ Monarch floodgates

// First English printing: Pharaonic Guardian (PGD-017), 2003-07-18.
M(DARK_DUST, {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 6,
  atk: 2200,
  def: 1800,
  types: ['spirit'],
  nomi: true,
  aiValue: 500,
  text: 'This card cannot be Special Summoned. This card returns to its owner\'s hand during the End Phase of the turn it is Normal Summoned or flipped face-up. When this card is Normal Summoned or flipped face-up, destroy all other face-up monsters on the field.',
  effects: [
    {
      kind: 'trigger',
      event: ['normalSummoned', 'flipped'],
      mandatory: true,
      label: 'Destroy all other face-up monsters',
      categories: ['destroyMulti'],
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self) ctx.self.flags.spiritTurn = ctx.turn;
        return ev.card === ctx.self && ctx.self.location === 'mzone';
      },
      resolve: async (ctx) => {
        const all = ctx.faceUpMonsters('both', (c) => c !== ctx.self);
        if (all.length) await ctx.destroy(all);
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Return to hand (Spirit)',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.location === 'mzone' && ctx.self.flags.spiritTurn === ctx.turn,
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) await ctx.toHand(ctx.self);
      },
    },
  ],
});

// First English printing: Cyberdark Impact (CDIP-EN017), 2006-11-15.
M(VANITY, {
  attribute: 'DARK',
  race: 'Fiend',
  level: 6,
  atk: 2400,
  def: 1200,
  nomi: true,
  aiValue: 700,
  text: 'This card cannot be Special Summoned. Neither player can Special Summon monsters.',
  effects: [{ kind: 'continuous', mods: [{ q: 'cannotSpecialSummon', to: 'players', value: true }] }],
});

/** For tests: the names this file defines. */
export const ARCHETYPE_EXTRAS = [
  GRANDMASTER,
  'The Six Samurai - Yaichi',
  'The Six Samurai - Kamon',
  'The Six Samurai - Irou',
  'The Six Samurai - Zanji',
  'The Six Samurai - Nisashi',
  'Backs to the Wall',
  'Evil HERO Infernal Prodigy',
  REDMD,
  WYVERN,
  PHANTOM,
  NORLERAS,
  DARK_DUST,
  VANITY,
];

