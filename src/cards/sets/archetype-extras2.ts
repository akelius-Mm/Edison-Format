// Archetype extras, wave 2: the Ancient Gear cards the group-E decks (src/decks/group-e.ts) need that no other set
// file defines, plus Machine Duplication (Structure Deck: Machina Mayhem).
//
// Already defined elsewhere and reused: Geartown (tdgs.ts), Ultimate Ancient Gear Golem (lodt.ts), Ancient Gear
// Knight (glas.ts).
//
// First English printings (all before the Edison cut-off, 2010-04-24):
//  * Ancient Gear Golem: Cybernetic Revolution (CRV), 2005.
//  * Ancient Gear Beast, Ancient Gear Soldier, Ancient Gear, Ancient Gear Castle: Shadow of Infinity (SOI), 2006.
//  * Ancient Gear Gadjiltron Dragon (SD10-EN001), Ancient Gear Gadjiltron Chimera (SD10-EN002), Ancient Gear Engineer
//    (SD10-EN003): Structure Deck: Machine Re-Volt, 2007-01-17.
//  * Machine Duplication: Structure Deck: Machina Mayhem (SDMM), 2010-02-18.
// None of them was on the March 2010 Forbidden & Limited list, so all are Unlimited.
// Card text is the Edison-era (pre-errata) wording; effects follow the 2010 TCG rulings as far as the engine allows.
// Approximations are marked "APPROX:".
//
// Game rules the engine has no hook for are installed per game by `ensureArchetypeExtras2Patches` (the technique of
// lodt.ts / archetype-extras.ts):
//  * Summon legality: Ancient Gear Golem cannot be Special Summoned (except by an effect that ignores the Summoning
//    conditions, such as Ultimate Ancient Gear Golem's);
//  * Tributes: Ancient Gear Castle can be sent to the GY in place of the Tributes for an "Ancient Gear" monster.
import { monster, spell } from '../define';
import { cardValue } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { Game } from '../../engine/game';
import type { GameEvent, Location, PlayerId } from '../../engine/types';

type C = CardInstance;

// ============================================================ names

const AGG = 'Ancient Gear Golem';
const AG = 'Ancient Gear';
const CASTLE = 'Ancient Gear Castle';
const GREEN = 'Green Gadget';
const RED = 'Red Gadget';
const YELLOW = 'Yellow Gadget';

// ============================================================ helpers

const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
const isAncientGear = (c: C) => c.isMonster && c.name.includes('Ancient Gear');

/** Was `c` Normal (Tribute) Summoned by Tributing a monster named `name`? (Gadjiltron Gadget effects.) */
const tributedWith = (c: C, name: string) =>
  c.summonMethod === 'tribute' && ((c.flags.tributedMonsters as { name: string }[] | undefined) ?? []).some((t) => t.name === name);

/**
 * "If this card attacks, your opponent cannot activate any Spell or Trap Cards until the end of the Damage Step."
 * Same shape as Ultimate Ancient Gear Golem (lodt.ts): applies while this card is the attacker of the current battle.
 */
const gearLock: EffectDef = {
  kind: 'continuous',
  mods: [
    { q: 'cannotActivateSpells', to: 'players', filter: (ctx, p: PlayerId) => p === ctx.opp && ctx.battle?.attacker === ctx.self },
    { q: 'cannotActivateTraps', to: 'players', filter: (ctx, p: PlayerId) => p === ctx.opp && ctx.battle?.attacker === ctx.self },
  ],
};
const LOCK_TEXT = 'If this card attacks, your opponent cannot activate any Spell or Trap Cards until the end of the Damage Step.';

/** The face-up, active Ancient Gear Castle `p` controls, if its counters cover the Tributes `card` needs. */
function castleFor(g: Game, p: PlayerId, card: C): C | undefined {
  if (card.location !== 'hand' || !isAncientGear(card)) return undefined;
  const f = g.players[p].fzone;
  if (!f || f.name !== CASTLE || !f.faceUp || !f.activeOnField || g.isNegated(f)) return undefined;
  const need = g.tributesNeeded(card);
  if (need <= 0 || (f.counters.gear ?? 0) < need) return undefined;
  return f;
}

// ============================================================ per-game patches

const PATCHED = new WeakSet<Game>();

export function ensureArchetypeExtras2Patches(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;

  // ---- Summon legality: Ancient Gear Golem "cannot be Special Summoned"
  const origSS = g.specialSummon.bind(g);
  anyG.specialSummon = async (cards: C[], player: PlayerId, opts: Parameters<Game['specialSummon']>[2] = {}) => {
    if (!opts?.ignoreConditions && cards.some((c) => c.name === AGG && c.location !== 'mzone')) {
      cards = cards.filter((c) => c.name !== AGG);
      if (!cards.length) return [];
    }
    return origSS(cards, player, opts);
  };

  // ---- Tributes: Ancient Gear Castle
  const origCanNS = g.canNormalSummon.bind(g);
  anyG.canNormalSummon = (p: PlayerId, card: C, set = false) => {
    if (origCanNS(p, card, set)) return true;
    if (set || !castleFor(g, p, card)) return false;
    card.flags.noTribute = true;
    try {
      return origCanNS(p, card, set);
    } finally {
      delete card.flags.noTribute;
    }
  };
  const origNS = g.normalSummon.bind(g);
  anyG.normalSummon = async (p: PlayerId, card: C, set: boolean) => {
    const castle = set ? undefined : castleFor(g, p, card);
    if (castle) {
      const need = g.tributesNeeded(card);
      const pool = g.tributeCandidates(p, card);
      const plainOk = pool.length >= need;
      // AI: keep the Castle (+300 ATK for every "Ancient Gear") unless the Tributes would cost more than it.
      const tribCost = pool
        .map((m) => cardValue(g, m))
        .sort((a, b) => a - b)
        .slice(0, need)
        .reduce((a, b) => a + b, 0);
      const useCastle =
        !plainOk ||
        (await g.option(p, `Tribute Summon ${card.name}:`, [`Tribute ${need} monster(s)`, `Send ${CASTLE} to the GY instead`], card, (i) =>
          i === 1 ? tribCost - 1200 : 0,
        )) === 1;
      if (useCastle) {
        g.log(`${g.players[p].name} sends ${CASTLE} to the Graveyard instead of Tributing.`, 'action', p);
        await g.sendToGrave([castle], 'cost', p, castle);
        card.flags.noTribute = true;
        try {
          return await origNS(p, card, set);
        } finally {
          if (card.location === 'hand') delete card.flags.noTribute;
        }
      }
    }
    return origNS(p, card, set);
  };
}

/** Installs the per-game patches at the first phase (from any location, never activates). */
const PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  eventFilter: (ctx) => {
    ensureArchetypeExtras2Patches(ctx.game);
    return false;
  },
};

type MonsterOpts = Parameters<typeof monster>[1];
type STOpts = Parameters<typeof spell>[2];
const M = (name: string, o: MonsterOpts) => monster(name, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });
const S = (name: string, t: Parameters<typeof spell>[1], o: STOpts) => spell(name, t, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });

/** "If this card destroys an opponent's monster by battle: inflict `n` damage" (Yellow Gadget bonus). */
function yellowBurn(n: number): EffectDef {
  return {
    kind: 'trigger',
    event: 'battleDestroyed',
    mandatory: true,
    label: `Inflict ${n} damage`,
    categories: ['damage'],
    eventFilter: (ctx, ev) =>
      tributedWith(ctx.self, YELLOW) && ev.other === ctx.self && faceUpOn(ctx.self) && (ev.fromController ?? (ev.card as C).owner) !== ctx.player,
    resolve: async (ctx) => {
      await ctx.damage(ctx.opp, n);
    },
  };
}

/** "If this card inflicts battle damage to your opponent [by a direct attack]: inflict `n` damage" (Red Gadget bonus). */
function redBurn(n: number, directOnly: boolean): EffectDef {
  return {
    kind: 'trigger',
    event: 'battleDamage',
    mandatory: true,
    label: `Inflict ${n} damage`,
    categories: ['damage'],
    eventFilter: (ctx, ev) =>
      tributedWith(ctx.self, RED) &&
      ev.reasonCard === ctx.self &&
      ev.player === ctx.opp &&
      (ev.amount ?? 0) > 0 &&
      (!directOnly || (!!ctx.battle && ctx.battle.attacker === ctx.self && !ctx.battle.target)),
    resolve: async (ctx) => {
      await ctx.damage(ctx.opp, n);
    },
  };
}

// ============================================================ Ancient Gear monsters

M(AGG, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 8,
  atk: 3000,
  def: 3000,
  sets: ['ancient-gear'],
  // "Cannot be Special Summoned": nomi keeps it out of effect Summons from the hand, Deck and GY (Ctx.canSummonCard);
  // the patch above also blocks effects that do not check (Ultimate Ancient Gear Golem ignores the condition).
  nomi: true,
  aiValue: 700,
  text: `This card cannot be Special Summoned. If this card attacks a Defense Position monster, inflict the difference between this card's ATK and the DEF of the attacked monster as Battle Damage to your opponent. ${LOCK_TEXT}`,
  effects: [{ kind: 'continuous', mods: [{ q: 'piercing' }] }, gearLock],
});

M('Ancient Gear Gadjiltron Dragon', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 8,
  atk: 3000,
  def: 2000,
  sets: ['ancient-gear'],
  aiValue: 700,
  text: `${LOCK_TEXT} This card gains the appropriate effect(s) if you Tribute Summon it by Tributing these monster(s):\n● "Green Gadget": If this card attacks a Defense Position monster, inflict the difference between this card's ATK and the DEF of the attacked monster as Battle Damage to your opponent.\n● "Red Gadget": Each time this card inflicts Battle Damage to your opponent, inflict 400 damage to your opponent.\n● "Yellow Gadget": Each time this card destroys an opponent's monster by battle, inflict 600 damage to your opponent.`,
  effects: [
    gearLock,
    { kind: 'continuous', active: (ctx) => tributedWith(ctx.self, GREEN), mods: [{ q: 'piercing' }] },
    redBurn(400, false),
    yellowBurn(600),
  ],
});

M('Ancient Gear Gadjiltron Chimera', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 6,
  atk: 2300,
  def: 1300,
  sets: ['ancient-gear'],
  aiValue: 400,
  text: 'This card gains the appropriate effect(s) if you Tribute Summon it by Tributing these monster(s):\n● "Green Gadget": This card gains 300 ATK.\n● "Red Gadget": If this card inflicts Battle Damage to your opponent by a direct attack, inflict 500 damage to your opponent.\n● "Yellow Gadget": If this card destroys an opponent\'s monster by battle, inflict 700 damage to your opponent.',
  effects: [
    { kind: 'continuous', active: (ctx) => tributedWith(ctx.self, GREEN), mods: [{ q: 'atk', value: 300 }] },
    redBurn(500, true),
    yellowBurn(700),
  ],
});

M('Ancient Gear Beast', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 6,
  atk: 2000,
  def: 2000,
  sets: ['ancient-gear'],
  aiValue: 400,
  text: `Negate the effects of monsters destroyed by battle with this card. ${LOCK_TEXT}`,
  effects: [
    gearLock,
    {
      // Same technique as Dark Balter the Terrible (extra.ts): drop the destroyed monster's pending triggers.
      kind: 'trigger',
      event: ['battleDestroyed', 'damageStepEnd'],
      label: 'Negate destroyed monster',
      eventFilter: (ctx, ev: GameEvent) => {
        if (ev.type === 'battleDestroyed' && ev.other === ctx.self && !ctx.isNegated(ctx.self)) {
          const c = ev.card as C;
          if (c.hasType('effect')) c.flags.agBeastNegated = true;
        } else if (ev.type === 'damageStepEnd' && (ev.card === ctx.self || ev.other === ctx.self)) {
          ctx.game.pending = ctx.game.pending.filter((t) => !t.card.flags.agBeastNegated);
          for (const p of [0, 1] as const) for (const c of ctx.game.players[p].grave) delete c.flags.agBeastNegated;
        }
        return false;
      },
    },
  ],
});

M('Ancient Gear Soldier', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1300,
  def: 1300,
  sets: ['ancient-gear'],
  aiValue: 100,
  text: LOCK_TEXT,
  effects: [gearLock],
});

M('Ancient Gear Engineer', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 5,
  atk: 1500,
  def: 1500,
  sets: ['ancient-gear'],
  aiValue: 400,
  text: `${LOCK_TEXT} When this card attacks, select 1 Spell or Trap Card your opponent controls and destroy it at the end of the Damage Step.`,
  effects: [
    gearLock,
    {
      // APPROX: the target is chosen and destroyed at the end of the Damage Step (one chain link instead of a target
      // at the attack and a delayed destruction); the opponent cannot respond with Spells/Traps either way.
      kind: 'trigger',
      event: 'damageStepEnd',
      range: ['mzone', 'grave'],
      mandatory: true,
      label: 'Destroy 1 Spell/Trap',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.spellTraps('opp').some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('opp'), 1, 1, 'Select 1 Spell or Trap Card your opponent controls.', 'destroy', {
          aiScore: (c) => cardValue(ctx.game, c) + (c.faceUp ? 0 : 300),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
    },
  ],
});

/** Machine Duplication in hand with a copy of `name` left in the Deck. */
const dupReady = (ctx: Ctx, name: string) =>
  ctx.hand('me', (c) => c.name === 'Machine Duplication').length > 0 && ctx.deck('me', (c) => c.name === name).length > 0;
/** Extra bodies from "Ancient Gear" pay off this turn: Machine Duplication, Polymerization + Golem, or a Tribute Summon still to make. */
const agPayoff = (ctx: Ctx) =>
  dupReady(ctx, AG) ||
  (ctx.hand('me', (c) => c.name === 'Polymerization').length > 0 && ctx.cards('me', ['hand', 'mzone'], (c) => c.name === AGG).length > 0) ||
  (ctx.game.players[ctx.player].normalSummonsLeft > 0 && ctx.hand('me', (c) => isAncientGear(c) && (c.data.level ?? 0) >= 5).length > 0);

M(AG, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 2,
  atk: 100,
  def: 800,
  sets: ['ancient-gear'],
  aiValue: 150,
  text: 'When there is a face-up "Ancient Gear" on your side of the field, you can Special Summon this card from your hand in face-up Attack Position.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (you control a face-up "Ancient Gear")',
      categories: ['specialSummon'],
      procPositions: ['atk'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.faceUpMonsters('me', (c) => c.name === AG).length > 0,
      perform: async () => true,
      ai: { score: (ctx) => (agPayoff(ctx) ? 66 : 0) },
    },
    // AI only: Normal Summon it face-up (not Set) when that turns on the Special Summons / Machine Duplication.
    {
      kind: 'continuous',
      ai: {
        summon: (ctx) =>
          dupReady(ctx, AG) || (ctx.hand('me', (c) => c !== ctx.self && c.name === AG).length > 0 && ctx.hand('me', (c) => c.name === 'Polymerization' || (isAncientGear(c) && (c.data.level ?? 0) >= 7)).length > 0)
            ? 30
            : 0,
      },
    },
  ],
});

// ============================================================ Spells

S(CASTLE, 'field', {
  text: 'Increase the ATK of all "Ancient Gear" monsters by 300 points. Each time a monster is Normal Summoned, place 1 counter on this card. When Tribute Summoning an "Ancient Gear" monster, you can send this card to the Graveyard instead of Tributing monsters, if the number of counters on this card is equal to or greater than the number of required Tributes.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      ai: { score: (ctx) => (ctx.cards('me', ['hand', 'deck', 'mzone'], isAncientGear).length >= 2 ? 32 : 6) },
    },
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: (_ctx, c: C) => faceUpOn(c) && isAncientGear(c), value: 300 }] },
    {
      // Counters are placed by the card's continuous effect (no chain).
      // APPROX: Normal Summons only (the Edison text); Tribute Summons count, Sets do not.
      kind: 'trigger',
      event: 'normalSummoned',
      range: ['fzone'],
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        if (me.location === 'fzone' && me.faceUp && me.activeOnField && !ctx.isNegated(me) && ev.card !== me) {
          me.counters.gear = (me.counters.gear ?? 0) + 1;
          ctx.game.log(`${CASTLE} gains a counter (${me.counters.gear}).`, 'info');
        }
        return false;
      },
    },
  ],
});

S('Machine Duplication', 'normal', {
  text: 'Select 1 face-up Machine-Type monster with 500 or less ATK on your side of the field. Special Summon up to 2 monsters with the same name as that monster from your Deck.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        ctx.canSpecialSummon() &&
        ctx.faceUpMonsters('me', (c) => c.data.race === 'Machine' && ctx.atk(c) <= 500 && ctx.deck('me', (d) => d.name === c.name && ctx.canSummonCard(d)).length > 0).length > 0,
      activate: async (ctx) => {
        const cands = ctx.faceUpMonsters('me', (c) => c.data.race === 'Machine' && ctx.atk(c) <= 500);
        const [t] = await ctx.selectTargets(cands, 1, 1, 'Select 1 face-up Machine-Type monster with 500 or less ATK you control.', 'target', {
          aiScore: (c) => ctx.deck('me', (d) => d.name === c.name).length * 100 + cardValue(ctx.game, c),
        });
        ctx.data.name = t?.name;
      },
      // https://edisonrul.ing/cards/m/machine-duplication.html — you still Special Summon from the Deck if the target was
      // flipped face-down / left the field, has more than 500 ATK or is no longer a Machine by the time this resolves.
      resolve: async (ctx) => {
        const name = ctx.data.name as string | undefined;
        if (!name || !ctx.canSpecialSummon()) return;
        const copies = ctx.deck('me', (d) => d.name === name && ctx.canSummonCard(d));
        const n = Math.min(2, copies.length, ctx.freeMZones());
        if (!n) return;
        const pick = await ctx.select(copies, 1, n, `Special Summon up to ${n} "${name}" from your Deck.`, 'specialSummon');
        if (pick.length) await ctx.specialSummon(pick, { pos: 'choose' });
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(
            0,
            ...ctx
              .faceUpMonsters('me', (c) => c.data.race === 'Machine' && ctx.atk(c) <= 500)
              .map((c) => Math.min(2, ctx.deck('me', (d) => d.name === c.name).length, ctx.freeMZones())),
          );
          return best >= 2 ? 64 : best === 1 ? 40 : 0;
        },
      },
    },
  ],
});

// ============================================================ Zombie Recursion

// First English printing: Ancient Sanctuary (AST), 2004. Unlimited in March 2010.
S('Call of the Mummy', 'continuous', {
  text: 'Once per turn, if you have no monsters on your side of the field, you can Special Summon 1 Zombie-Type monster from your hand.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      ai: { score: (ctx) => (ctx.hand('me', (c) => c.isMonster && c.data.race === 'Zombie' && (c.data.level ?? 0) >= 5).length ? 34 : 12) },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Special Summon 1 Zombie from your hand',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.self.faceUp && ctx.self.activeOnField && ctx.monsters('me').length === 0,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => c.isMonster && c.data.race === 'Zombie' && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        if (ctx.monsters('me').length) return;
        const cands = ctx.hand('me', (c) => c.isMonster && c.data.race === 'Zombie' && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Zombie-Type monster from your hand.', 'specialSummon', {
          aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0),
        });
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
      // Use it for the big Zombies (a Level 4 is a Normal Summon anyway).
      ai: {
        score: (ctx) =>
          ctx.hand('me', (c) => c.isMonster && c.data.race === 'Zombie' && (c.data.level ?? 0) >= 5).length
            ? 68
            : ctx.game.players[ctx.player].normalSummonsLeft <= 0
              ? 50
              : 0,
      },
    },
  ],
});

export const ARCHETYPE_EXTRAS2_LOADED = true;
