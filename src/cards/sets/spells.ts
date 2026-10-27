// Card definitions: generic Spells (see docs/CARD_ALLOCATION.md).
import { spell } from '../define';
import { attr, bestTarget, cardValue, isMonster } from '../helpers';
import { faceUpFlag, type AiHints, type CardInstance, type EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { Category, Location, PlayerId } from '../../engine/types';

type CF = (c: CardInstance) => boolean;

// ======================================================================
// Shared helpers
// ======================================================================

/** This face-up Spell/Trap has resolved its activation and is not negated. */
const activeST = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.isNegated(ctx.self);

/** Cards in your hand other than this one (this card is still in hand during canActivate). */
const otherHand = (ctx: Ctx, f?: CF) => ctx.hand('me', (c) => c !== ctx.self && (!f || f(c)));

/** Monsters you control that can be Tributed by a card effect. */
const tributable = (ctx: Ctx, f?: CF) => ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed') && (!f || f(c)));

/** Tribute 1 of your monsters as a cost. */
async function tributeCost(ctx: Ctx, cands: CardInstance[], prompt = 'Tribute 1 monster.') {
  const sel = await ctx.select(cands, 1, 1, prompt, 'tribute');
  if (!sel.length) return [];
  ctx.log(`${ctx.game.players[ctx.player].name} Tributes ${sel.map((c) => (c.faceUp ? c.name : 'a face-down monster')).join(', ')}.`);
  await ctx.game.moveCards(sel, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
  return sel;
}

/** Cheapest monster we could Tribute (AI). */
const cheapestTribute = (ctx: Ctx) => {
  const t = tributable(ctx);
  return t.length ? Math.min(...t.map((c) => cardValue(ctx.game, c))) : Infinity;
};

/** Can this monster be Normal Summoned/Set (Monster Gate, Reasoning). */
const normalSummonable: CF = (c) => c.isMonster && !c.isExtra && !c.isToken && !c.data.cannotNormalSummon;

/** Battle from the point of view of the effect's controller. */
function myBattle(ctx: Ctx) {
  const b = ctx.battle;
  if (!b) return null;
  let mine: CardInstance | null = null;
  let theirs: CardInstance | null = null;
  if (b.attacker.controller === ctx.player) {
    mine = b.attacker;
    theirs = b.target;
  } else if (b.target && b.target.controller === ctx.player) {
    mine = b.target;
    theirs = b.attacker;
  }
  if (!mine) return null;
  return { b, mine, theirs, attacking: mine === b.attacker };
}

/** Stat the opposing monster fights with (null if unknown/face-down). */
function battleStat(ctx: Ctx, c: CardInstance): number | null {
  if (!c.faceUp) return null;
  return c.pos === 'atk' ? ctx.atk(c) : ctx.def(c);
}

/** Is it the very start of Main Phase 1 (nothing has happened yet)? */
function atStartOfMain1(ctx: Ctx) {
  if (ctx.phase !== 'main1' || ctx.game.chain.length) return false;
  const log = ctx.game.eventLog;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'phaseStart') return e.phase === 'main1';
    if (!e.minor) return false;
  }
  return false;
}

/** Search-from-deck score that drops to 0 when nothing matches. */
const searchScore = (f: CF, base = 55) => (ctx: Ctx) => (ctx.deck('me', f).length ? base : 0);

/** Generic "take control of a monster" AI score. */
function stealScore(ctx: Ctx, opts: { canAttack: boolean; faceUpOnly?: boolean }) {
  if (ctx.freeMZones() <= 0) return 0;
  const cands = ctx.monsters('opp', (c) => ctx.canTarget(c) && (!opts.faceUpOnly || c.faceUp));
  if (!cands.length) return 0;
  const best = bestTarget(ctx.game, cands);
  const v = cardValue(ctx.game, best);
  const synchros = ctx.extra('me', (c) => c.hasType('synchro')).length > 0;
  if (ctx.phase === 'main2' && !synchros) return 0;
  if (opts.canAttack) return v >= 1500 ? 45 + v / 100 : 0;
  // Can't attack: useful to clear the way for your attackers or as Synchro/Tribute material.
  const attackers = ctx.faceUpMonsters('me', (c) => c.pos === 'atk').length;
  return v >= 1600 && (synchros || attackers > 0) ? 40 + v / 100 : 0;
}

/** Value lost when using a card as material/cost. */
const lossOf = (ctx: Ctx, c: CardInstance) => (c.location === 'grave' || c.location === 'banished' ? 100 : cardValue(ctx.game, c));

// ======================================================================
// Fusion helper (exported for Miracle Fusion & co.)
// ======================================================================

export interface FusionSummonOpts {
  /** Locations of your own cards that can be used as materials. Default: hand + your monster zones. */
  from?: Location[];
  /** Where the materials go: GY (default), banished (Miracle/Overload Fusion) or shuffled into the Deck. */
  dest?: 'grave' | 'banish' | 'deck';
  /** Restrict which Fusion Monsters can be summoned. */
  fusionFilter?: (fusion: CardInstance, ctx: Ctx) => boolean;
  /** Extra restriction on every material. */
  materialFilter?: (c: CardInstance, ctx: Ctx) => boolean;
  /** Allow Fusion Monsters flagged `noPoly` (contact fusions). Default false. */
  allowNoPoly?: boolean;
  /**
   * For "X + 1 or more Y" Fusions (Chimeratech Overdragon): return a filter for the optional extra
   * materials, or null. Defaults to the Chimeratech Overdragon rule.
   */
  extraMaterials?: (fusion: CardInstance) => CF | null;
  label?: string;
  categories?: Category[];
  /** Override the AI score of the generated effect. */
  ai?: AiHints;
  /** PTDN: called after the Fusion Monster is summoned (Chain Material marks it for destruction). */
  onSummoned?: (ctx: Ctx, fusion: CardInstance) => void;
}

// PTDN: "Chain Material" (ptdn.ts) changes every Fusion Summon of the turn (wider material pool,
// materials banished). Each hook returns replacement options, or null to leave them unchanged.
export const fusionOptionHooks: ((ctx: Ctx, o: FusionSummonOpts) => FusionSummonOpts | null)[] = [];
function hookedFusionOpts(ctx: Ctx, o: FusionSummonOpts): FusionSummonOpts {
  for (const h of fusionOptionHooks) {
    const r = h(ctx, o);
    if (r) return r;
  }
  return o;
}

const defaultExtraMaterials = (f: CardInstance): CF | null =>
  f.name === 'Chimeratech Overdragon' ? (c) => c.isMonster && c.data.race === 'Machine' : null;

export function fusionMaterialPool(ctx: Ctx, o: FusionSummonOpts = {}): CardInstance[] {
  const locs = o.from ?? ['hand', 'mzone'];
  return ctx.cards('me', locs, (c) => {
    if (c === ctx.self || !c.isMonster || c.isToken) return false;
    if (c.location === 'banished' && !c.faceUp) return false;
    if (o.materialFilter && !o.materialFilter(c, ctx)) return false;
    return true;
  });
}

export interface FusionChoice {
  fusion: CardInstance;
  sets: CardInstance[][];
}

/** Every Fusion Monster you could summon right now with its possible material sets. */
export function fusionChoices(ctx: Ctx, o: FusionSummonOpts = {}): FusionChoice[] {
  if (ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return [];
  o = hookedFusionOpts(ctx, o); // PTDN
  const pool = fusionMaterialPool(ctx, o);
  if (!pool.length) return [];
  const out: FusionChoice[] = [];
  const fusions = ctx.extra('me', (c) => c.hasType('fusion') && !!c.data.fusion && (o.allowNoPoly || !c.data.fusion.noPoly) && (!o.fusionFilter || o.fusionFilter(c, ctx)));
  const seen = new Set<string>();
  for (const f of fusions) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    let sets = ctx.game.fusionMaterialSets(f, pool);
    if (ctx.freeMZones() <= 0) sets = sets.filter((s) => s.some((m) => m.location === 'mzone'));
    if (sets.length) out.push({ fusion: f, sets });
  }
  return out;
}

/** AI: value gained by making this fusion with its cheapest material set. */
export function fusionGain(ctx: Ctx, ch: FusionChoice) {
  const f = ch.fusion;
  const val = (f.data.atk ?? 0) + (f.data.aiValue ?? 0) + 700;
  const cost = Math.min(...ch.sets.map((s) => s.reduce((a, m) => a + lossOf(ctx, m) * 0.6, 0)));
  return val - cost;
}

/** Perform a Fusion Summon at resolution. Returns the summoned Fusion Monster (or null). */
export async function performFusionSummon(ctx: Ctx, o: FusionSummonOpts = {}): Promise<CardInstance | null> {
  o = hookedFusionOpts(ctx, o); // PTDN
  const choices = fusionChoices(ctx, o);
  if (!choices.length) return null;
  const [f] = await ctx.select(
    choices.map((c) => c.fusion),
    1,
    1,
    'Choose a Fusion Monster to Fusion Summon.',
    'specialSummon',
    { aiScore: (c) => fusionGain(ctx, choices.find((x) => x.fusion === c)!) },
  );
  const ch = choices.find((x) => x.fusion === f) ?? choices[0];
  const fusion = ch.fusion;
  let mats = await ctx.game.pickCombo(ctx.player, ch.sets, `Select Fusion Materials for ${fusion.name}`, 'material');
  if (!mats) mats = ch.sets[0];
  mats = [...mats];
  const extraF = (o.extraMaterials ?? defaultExtraMaterials)(fusion);
  if (extraF) {
    const more = fusionMaterialPool(ctx, o).filter((c) => !mats!.includes(c) && extraF(c));
    if (more.length) {
      const sel = await ctx.select(more, 0, more.length, `Select any additional Fusion Materials for ${fusion.name}.`, 'buff', {
        aiScore: (c) => (c.location === 'hand' ? -1 : 1000 - cardValue(ctx.game, c) / 10),
      });
      mats.push(...sel);
    }
  }
  ctx.log(`${ctx.game.players[ctx.player].name} uses ${mats.map((m) => m.name).join(', ')} as Fusion Material.`);
  const dest = o.dest ?? 'grave';
  const moveOpts = { reason: 'fusion' as const, reasons: ['fusion' as const, 'material' as const, 'effect' as const], reasonPlayer: ctx.player, reasonCard: ctx.self };
  const info = mats.map((m) => ({ uid: m.uid, name: m.name, attribute: m.data.attribute, race: m.data.race, level: m.data.level, card: m }));
  if (dest === 'banish') await ctx.game.moveCards(mats, 'banished', { ...moveOpts, faceUp: true });
  else if (dest === 'deck') await ctx.game.moveCards(mats, 'deck', { ...moveOpts, shuffle: true });
  else await ctx.game.moveCards(mats, 'grave', moveOpts);
  if (fusion.location !== 'extra') return null;
  const r = await ctx.specialSummon(fusion, { method: 'fusion', proper: true, pos: 'choose' });
  if (!r.length) return null;
  fusion.flags.materials = info;
  fusion.flags.materialCount = info.length;
  o.onSummoned?.(ctx, fusion); // PTDN
  return fusion;
}

/** Ready-made activation effect: "Fusion Summon 1 Fusion Monster ..." (Polymerization, Miracle Fusion…). */
export function fusionSummonEffect(o: FusionSummonOpts = {}): EffectDef {
  return {
    kind: 'activate',
    label: o.label,
    categories: o.categories ?? ['specialSummon'],
    canActivate: (ctx) => fusionChoices(ctx, o).length > 0,
    resolve: async (ctx) => {
      await performFusionSummon(ctx, o);
    },
    ai: o.ai ?? {
      score: (ctx) => {
        const gains = fusionChoices(ctx, o).map((ch) => fusionGain(ctx, ch));
        const g = Math.max(-Infinity, ...gains);
        return g > 300 ? 48 + g / 150 : 0;
      },
    },
  };
}

// ======================================================================
// Equip helper
// ======================================================================

interface EquipOpts {
  /** Which face-up monsters may be equipped (default: any). */
  filter?: (ctx: Ctx, c: CardInstance) => boolean;
  categories?: Category[];
  score: (ctx: Ctx) => number;
  /** AI target preference (default: own strongest). */
  aiTarget?: (ctx: Ctx, c: CardInstance) => number;
  onEquip?: (ctx: Ctx, target: CardInstance) => Promise<void>;
}

const ownBest = (ctx: Ctx, c: CardInstance) => (c.controller === ctx.player ? ctx.atk(c) + 1000 : -10000);

function equipActivate(o: EquipOpts): EffectDef {
  const cands = (ctx: Ctx) => ctx.faceUpMonsters('both', (c) => !o.filter || o.filter(ctx, c));
  return {
    kind: 'activate',
    categories: o.categories ?? ['atkChange'],
    canActivate: (ctx) => cands(ctx).some((c) => ctx.canTarget(c)),
    activate: async (ctx) => {
      await ctx.selectTargets(cands(ctx), 1, 1, 'Target 1 face-up monster to equip this card to.', 'equip', {
        aiScore: (c) => (o.aiTarget ?? ownBest)(ctx, c),
      });
    },
    resolve: async (ctx) => {
      const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
      if (!t.length || !ctx.self.onField || !ctx.self.faceUp) return;
      ctx.equip(t[0]);
      if (o.onEquip) await o.onEquip(ctx, t[0]);
    },
    ai: { score: o.score },
  };
}

const equipped = (ctx: Ctx, c: CardInstance) => c === ctx.equipTarget;

/** AI score for a plain ATK boost equip. */
const buffEquipScore = (bonus: (ctx: Ctx, c: CardInstance) => number) => (ctx: Ctx) => {
  const mine = ctx.faceUpMonsters('me');
  if (!mine.length || (ctx.phase !== 'main1' && ctx.phase !== 'main2')) return 0;
  const best = Math.max(...mine.map((c) => bonus(ctx, c)));
  if (best < 300) return 0;
  return ctx.phase === 'main1' ? 30 + best / 100 : 15;
};

// ======================================================================
// Draw / search / hand
// ======================================================================

spell('Allure of Darkness', 'normal', {
  text: 'Draw 2 cards, then banish 1 DARK monster from your hand. If you have no DARK monster in your hand to banish, send your entire hand to the GY.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'banish'],
      canActivate: (ctx) => ctx.deck().length >= 2,
      resolve: async (ctx) => {
        await ctx.draw(2);
        const darks = ctx.hand('me', attr('DARK'));
        if (darks.length) {
          const sel = await ctx.select(darks, 1, 1, 'Banish 1 DARK monster from your hand.', 'cost');
          await ctx.banish(sel);
        } else {
          const hand = ctx.hand('me');
          ctx.log(`${ctx.game.players[ctx.player].name} has no DARK monster to banish.`);
          if (hand.length) await ctx.game.moveCards(hand, 'grave', { reason: 'effect', reasonPlayer: ctx.player, reasonCard: ctx.self });
        }
      },
      ai: {
        score: (ctx) => {
          const others = otherHand(ctx);
          if (others.some(attr('DARK'))) return 62;
          return others.length <= 1 ? 40 : 0;
        },
      },
    },
  ],
});

spell('Gold Sarcophagus', 'normal', {
  text: 'Banish 1 card from your Deck face-up. During your second Standby Phase after this card\'s activation, add that card to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['search', 'banish'],
      canActivate: (ctx) => ctx.deck().length > 0,
      resolve: async (ctx) => {
        const sel = await ctx.select(ctx.deck(), 1, 1, 'Banish 1 card from your Deck (it comes to your hand in 2 turns).', 'toHand');
        ctx.game.shuffleDeck(ctx.player);
        if (!sel.length) return;
        const r = await ctx.banish(sel);
        const c = r[0];
        if (!c || c.location !== 'banished') return;
        const id = c.moveId;
        ctx.later(
          'standby',
          async () => {
            if (c.location === 'banished' && c.moveId === id) await ctx.toHand(c);
          },
          4,
        );
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' ? 35 : 25) },
    },
  ],
});

spell('Foolish Burial', 'normal', {
  text: 'Send 1 monster from your Deck to the GY.',
  effects: [
    {
      kind: 'activate',
      categories: ['mill'],
      canActivate: (ctx) => ctx.deck('me', isMonster).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', isMonster);
        const sel = await ctx.select(cands, 1, 1, 'Send 1 monster from your Deck to the GY.', 'generic', {
          aiScore: (c) => {
            const gyEffect = (c.data.effects ?? []).some(
              (e) => (e.range ?? []).includes('grave') || (e.kind === 'trigger' && ([] as string[]).concat(e.event ?? []).includes('sentToGrave')),
            );
            return (gyEffect ? 2000 : 0) + (c.data.aiValue ?? 0) + (c.data.atk ?? 0) / 10;
          },
        });
        if (sel.length) await ctx.sendToGrave(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: (ctx) => (ctx.deck('me', isMonster).length ? 45 : 0) },
    },
  ],
});

const warriorL4: CF = (c) => c.isMonster && c.data.race === 'Warrior' && (c.data.level ?? 0) <= 4 && !c.isExtra;
spell('Reinforcement of the Army', 'normal', {
  text: 'Add 1 Level 4 or lower Warrior monster from your Deck to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['search'],
      canActivate: (ctx) => ctx.deck('me', warriorL4).length > 0,
      resolve: async (ctx) => {
        await ctx.search(warriorL4, 1, 'Add 1 Level 4 or lower Warrior monster to your hand.');
      },
      ai: { score: searchScore(warriorL4, 58) },
    },
  ],
});

spell('Upstart Goblin', 'normal', {
  text: 'Draw 1 card, then your opponent gains 1000 LP.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => ctx.deck().length > 0,
      resolve: async (ctx) => {
        await ctx.draw(1);
        await ctx.recover(ctx.opp, 1000);
      },
      ai: { score: () => 58 },
    },
  ],
});

spell('Pot of Greed', 'normal', {
  text: 'Draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => ctx.deck().length >= 2,
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: { score: () => 85 },
    },
  ],
});

spell('Graceful Charity', 'normal', {
  text: 'Draw 3 cards, then discard 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'discard'],
      canActivate: (ctx) => ctx.deck().length >= 3,
      resolve: async (ctx) => {
        await ctx.draw(3);
        await ctx.discardFromHand(2, undefined, 'effect', ctx.player, 'Discard 2 cards.');
      },
      ai: { score: () => 80 },
    },
  ],
});

spell('Trade-In', 'normal', {
  text: 'Discard 1 Level 8 monster; draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'discard'],
      canActivate: (ctx) => ctx.deck().length >= 2 && otherHand(ctx, (c) => c.isMonster && c.data.level === 8).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(otherHand(ctx, (c) => c.isMonster && c.data.level === 8), 1, 1, 'Discard 1 Level 8 monster.', 'discard');
        if (!sel.length) return false;
        await ctx.discard(sel, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: { score: () => 55 },
    },
  ],
});

spell('Card Destruction', 'normal', {
  text: 'Both players discard their entire hands, then each draws the same number of cards they discarded.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'discard'],
      canActivate: (ctx) => otherHand(ctx).length + ctx.hand('opp').length > 0,
      resolve: async (ctx) => {
        const counts: Record<number, number> = {};
        const all: CardInstance[] = [];
        for (const p of [ctx.player, ctx.opp]) {
          const hand = [...ctx.game.zone(p, 'hand')];
          counts[p] = hand.length;
          all.push(...hand);
        }
        if (all.length) await ctx.game.discard(all, 'effect', ctx.player, ctx.self);
        for (const p of [ctx.game.turnPlayer, ctx.game.opp(ctx.game.turnPlayer)] as PlayerId[]) {
          if (counts[p]) await ctx.draw(counts[p], p);
        }
      },
      ai: {
        score: (ctx) => {
          const mine = otherHand(ctx);
          if (mine.length < 2) return 0;
          // Refresh a weak hand: monsters/cards we can't use right now.
          const avg = mine.reduce((a, c) => a + cardValue(ctx.game, c), 0) / mine.length;
          return avg < 1600 || ctx.hand('opp').length <= mine.length ? 32 : 0;
        },
      },
    },
  ],
});

spell('Hand Destruction', 'quickplay', {
  text: 'Each player sends 2 cards from their hand to the GY, then draws 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'discard'],
      canActivate: (ctx) =>
        otherHand(ctx).length >= 2 && ctx.hand('opp').length >= 2 && ctx.deck('me').length >= 2 && ctx.deck('opp').length >= 2,
      resolve: async (ctx) => {
        const tp = ctx.game.turnPlayer;
        const order: PlayerId[] = [tp, ctx.game.opp(tp)];
        const chosen: CardInstance[] = [];
        for (const p of order) {
          const hand = ctx.game.zone(p, 'hand');
          const sel = await ctx.game.select(p, hand, Math.min(2, hand.length), Math.min(2, hand.length), 'Send 2 cards from your hand to the GY.', 'discard', { source: ctx.self });
          chosen.push(...sel);
        }
        if (chosen.length) await ctx.game.discard(chosen, 'effect', ctx.player, ctx.self);
        for (const p of order) await ctx.draw(2, p);
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' && ctx.phase !== 'main2') return 0;
          const vals = otherHand(ctx)
            .map((c) => cardValue(ctx.game, c))
            .sort((a, b) => a - b);
          return vals.length >= 2 && vals[0] + vals[1] < 2600 ? 30 : 0;
        },
      },
    },
  ],
});

spell('Painful Choice', 'normal', {
  text: 'Select 5 cards from your Deck; your opponent picks 1 of them for you to add to your hand, and the rest are sent to the GY.',
  effects: [
    {
      kind: 'activate',
      categories: ['search', 'mill'],
      canActivate: (ctx) => ctx.deck().length >= 5 && !ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck'),
      resolve: async (ctx) => {
        const five = await ctx.select(ctx.deck(), 5, 5, 'Select 5 cards from your Deck.', 'toHand');
        if (!five.length) return;
        const [pick] = await ctx.select(five, 1, 1, 'Pick 1 card for your opponent to add to their hand.', 'generic', {
          player: ctx.opp,
          aiScore: (c) => -cardValue(ctx.game, c),
        });
        if (pick) await ctx.toHand(pick);
        const rest = five.filter((c) => c !== pick && c.location === 'deck');
        if (rest.length) await ctx.sendToGrave(rest);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 60 },
    },
  ],
});

spell('Magic Planter', 'normal', {
  text: 'Send 1 face-up Continuous Trap you control to the GY; draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => ctx.deck().length >= 2 && ctx.spellTraps('me', (c) => c.faceUp && c.isTrap && c.data.ttype === 'continuous').length > 0,
      activate: async (ctx) => {
        const cands = ctx.spellTraps('me', (c) => c.faceUp && c.isTrap && c.data.ttype === 'continuous');
        const sel = await ctx.select(cands, 1, 1, 'Send 1 face-up Continuous Trap you control to the GY.', 'cost', {
          aiScore: (c) => (c.linkedTo == null && (c.data.effects?.[0]?.categories ?? []).includes('specialSummon') ? 1000 : -cardValue(ctx.game, c)),
        });
        if (!sel.length) return false;
        await ctx.sendToGrave(sel, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: {
        score: (ctx) => {
          // Spent revival traps (Call of the Haunted whose monster is gone) make perfect fodder.
          const spent = ctx.spellTraps(
            'me',
            (c) => c.faceUp && c.isTrap && c.data.ttype === 'continuous' && c.linkedTo == null && (c.data.effects?.[0]?.categories ?? []).includes('specialSummon'),
          );
          return spent.length ? 65 : 0;
        },
      },
    },
  ],
});

spell('Spell Reproduction', 'normal', {
  text: 'Send 2 Spells from your hand to the GY, then target 1 Spell in your GY; add it to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => otherHand(ctx, (c) => c.isSpell).length >= 2 && ctx.grave('me', (c) => c.isSpell).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isSpell), 1, 1, 'Target 1 Spell in your GY to add to your hand.', 'toHand', {
          aiScore: (c) => cardValue(ctx.game, c),
        });
        const sel = await ctx.select(otherHand(ctx, (c) => c.isSpell), 2, 2, 'Send 2 Spells from your hand to the GY.', 'cost');
        await ctx.sendToGrave(sel, 'cost');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('me', (c) => c.isSpell).map((c) => c.data.aiValue ?? 0));
          return best >= 600 ? 35 : 0;
        },
      },
    },
  ],
});

spell('Magical Stone Excavation', 'normal', {
  text: 'Discard 2 cards, then target 1 Spell in your GY; add it to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand', 'discard'],
      canActivate: (ctx) => otherHand(ctx).length >= 2 && ctx.grave('me', (c) => c.isSpell).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isSpell), 1, 1, 'Target 1 Spell in your GY to add to your hand.', 'toHand', {
          aiScore: (c) => cardValue(ctx.game, c),
        });
        await ctx.discardFromHand(2, undefined, 'cost', ctx.player, 'Discard 2 cards.');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('me', (c) => c.isSpell).map((c) => c.data.aiValue ?? 0));
          const fodder = otherHand(ctx).filter((c) => cardValue(ctx.game, c) < 1300).length;
          return best >= 800 && fodder >= 2 ? 35 : 0;
        },
      },
    },
  ],
});

spell('Monster Reincarnation', 'normal', {
  text: 'Discard 1 card, then target 1 monster in your GY; add it to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand', 'discard'],
      canActivate: (ctx) => otherHand(ctx).length >= 1 && ctx.grave('me', isMonster).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', isMonster), 1, 1, 'Target 1 monster in your GY to add to your hand.', 'toHand', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
        await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('me', isMonster).map((c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0)));
          const worst = Math.min(...otherHand(ctx).map((c) => cardValue(ctx.game, c)));
          return best >= 1800 && best - worst > 600 ? 38 : 0;
        },
      },
    },
  ],
});

spell('The Forceful Sentry', 'normal', {
  text: 'Look at your opponent\'s hand, choose 1 card in it, and shuffle that card into their Deck.',
  effects: [
    {
      kind: 'activate',
      categories: ['toDeck'],
      canActivate: (ctx) => ctx.hand('opp').length > 0,
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        ctx.log(`${ctx.game.players[ctx.opp].name}'s hand: ${hand.map((c) => c.name).join(', ')}.`);
        for (const c of hand) c.revealedUntil = ctx.turn;
        const sel = await ctx.select(hand, 1, 1, 'Choose 1 card to shuffle into your opponent\'s Deck.', 'toDeck');
        if (sel.length) await ctx.toDeck(sel, 'shuffle');
      },
      ai: { score: (ctx) => (ctx.hand('opp').length ? 48 : 0) },
    },
  ],
});

spell('Delinquent Duo', 'normal', {
  text: 'Pay 1000 LP; your opponent discards 1 random card, then discards 1 more card of their choice.',
  effects: [
    {
      kind: 'activate',
      categories: ['discard'],
      canActivate: (ctx) => ctx.lp > 1000 && ctx.hand('opp').length > 0,
      activate: async (ctx) => {
        await ctx.payLp(1000);
      },
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        const rnd = hand[ctx.game.rng.int(hand.length)];
        await ctx.discard(rnd);
        if (ctx.hand('opp').length) await ctx.discardFromHand(1, undefined, 'effect', ctx.opp, 'Discard 1 card.');
      },
      ai: { score: (ctx) => (ctx.lp > 2500 && ctx.hand('opp').length >= 2 ? 55 : 0) },
    },
  ],
});

// ======================================================================
// Removal
// ======================================================================

spell('Smashing Ground', 'normal', {
  text: 'Destroy the face-up monster your opponent controls with the highest DEF (your choice if tied).',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp').length > 0,
      resolve: async (ctx) => {
        const mons = ctx.faceUpMonsters('opp');
        if (!mons.length) return;
        const hi = Math.max(...mons.map((c) => ctx.def(c)));
        const sel = await ctx.select(mons.filter((c) => ctx.def(c) === hi), 1, 1, 'Destroy the monster with the highest DEF.', 'destroy');
        await ctx.destroy(sel);
      },
      ai: {
        score: (ctx) => {
          const mons = ctx.faceUpMonsters('opp');
          if (!mons.length) return 0;
          const hi = Math.max(...mons.map((c) => ctx.def(c)));
          const v = Math.max(...mons.filter((c) => ctx.def(c) === hi).map((c) => cardValue(ctx.game, c)));
          return v >= 1000 ? 42 + v / 150 : 0;
        },
      },
    },
  ],
});

spell('Fissure', 'normal', {
  text: 'Destroy the face-up monster your opponent controls with the lowest ATK (your choice if tied).',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp').length > 0,
      resolve: async (ctx) => {
        const mons = ctx.faceUpMonsters('opp');
        if (!mons.length) return;
        const lo = Math.min(...mons.map((c) => ctx.atk(c)));
        const sel = await ctx.select(mons.filter((c) => ctx.atk(c) === lo), 1, 1, 'Destroy the monster with the lowest ATK.', 'destroy');
        await ctx.destroy(sel);
      },
      ai: {
        score: (ctx) => {
          const mons = ctx.faceUpMonsters('opp');
          if (!mons.length) return 0;
          const lo = Math.min(...mons.map((c) => ctx.atk(c)));
          const v = Math.max(...mons.filter((c) => ctx.atk(c) === lo).map((c) => cardValue(ctx.game, c)));
          return v >= 900 ? 40 + v / 150 : 0;
        },
      },
    },
  ],
});

spell('Lightning Vortex', 'normal', {
  text: 'Discard 1 card; destroy all face-up monsters your opponent controls.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti', 'discard'],
      canActivate: (ctx) => otherHand(ctx).length >= 1 && ctx.faceUpMonsters('opp').length > 0,
      activate: async (ctx) => {
        await ctx.discardFromHand(1, undefined, 'cost', ctx.player, 'Discard 1 card.');
      },
      resolve: async (ctx) => {
        await ctx.destroy(ctx.faceUpMonsters('opp'));
      },
      ai: {
        score: (ctx) => {
          const mons = ctx.faceUpMonsters('opp');
          const total = mons.reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return mons.length >= 2 || total >= 2200 ? 50 + total / 200 : 0;
        },
      },
    },
  ],
});

spell('Raigeki', 'normal', {
  text: 'Destroy all monsters your opponent controls.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.monsters('opp').length > 0,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.monsters('opp'));
      },
      ai: { score: (ctx) => (ctx.monsters('opp').length ? 60 + ctx.monsters('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0) / 200 : 0) },
    },
  ],
});

spell("Harpie's Feather Duster", 'normal', {
  text: 'Destroy all Spells and Traps your opponent controls.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.spellTraps('opp').length > 0,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.spellTraps('opp'));
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp').length ? 55 + 8 * ctx.spellTraps('opp').length : 0) },
    },
  ],
});

spell('Giant Trunade', 'normal', {
  text: 'Return all Spells and Traps on the field to the hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.spellTraps('both', (c) => c !== ctx.self).length > 0,
      resolve: async (ctx) => {
        const all = ctx.spellTraps('both', (c) => c !== ctx.self);
        if (all.length) await ctx.toHand(all);
      },
      ai: {
        score: (ctx) => {
          const theirs = ctx.spellTraps('opp').length;
          const mine = ctx.spellTraps('me', (c) => c !== ctx.self && c.faceUp).length;
          return theirs >= 1 && theirs > mine ? 45 + 8 * (theirs - mine) : 0;
        },
      },
    },
  ],
});

spell('Shield Crush', 'normal', {
  text: 'Target 1 Defense Position monster on the field; destroy it.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.monsters('both', (c) => c.pos === 'def' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both', (c) => c.pos === 'def'), 1, 1, 'Target 1 Defense Position monster to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.pos === 'def');
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.monsters('opp', (c) => c.pos === 'def' && ctx.canTarget(c)).length ? 45 : 0) },
    },
  ],
});

spell('Nobleman of Crossout', 'normal', {
  text: 'Target 1 face-down monster on the field; destroy it and banish it. If it was a Flip monster, each player banishes all cards with that name from their Deck.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'banish'],
      canActivate: (ctx) => ctx.monsters('both', (c) => !c.faceUp && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both', (c) => !c.faceUp), 1, 1, 'Target 1 face-down monster to destroy and banish.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && !c.faceUp);
        if (!t.length) return;
        const victim = t[0];
        const isFlip = victim.hasType('flip');
        const name = victim.name;
        const d = await ctx.destroy(victim);
        if (!d.length) return;
        if (victim.location === 'grave') await ctx.banish(victim);
        ctx.log(`Nobleman of Crossout reveals ${name}.`);
        if (isFlip) {
          const same = [...ctx.deck('me', (c) => c.name === name), ...ctx.deck('opp', (c) => c.name === name)];
          if (same.length) await ctx.banish(same);
        }
      },
      ai: { score: (ctx) => (ctx.monsters('opp', (c) => !c.faceUp && ctx.canTarget(c)).length ? 52 : 0) },
    },
  ],
});

// ======================================================================
// Revival / Special Summon
// ======================================================================

spell('Premature Burial', 'equip', {
  text: 'Pay 800 LP, then target 1 monster in your GY; Special Summon it in Attack Position and equip it with this card. When this card is destroyed, destroy the equipped monster.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.lp > 800 && ctx.canSpecialSummon() && ctx.grave('me', (c) => c.isMonster && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(800);
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && ctx.canSummonCard(c)), 1, 1, 'Target 1 monster in your GY to Special Summon.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.isExtra ? 800 : 0),
        });
      },
      resolve: async (ctx) => {
        if (!ctx.self.onField || !ctx.self.faceUp) return;
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (!t.length) return;
        const r = await ctx.specialSummon(t[0], { pos: 'atk' });
        if (!r.length || !ctx.self.onField) return;
        ctx.equip(r[0]);
        // "When this card is destroyed, destroy the equipped monster" (not when it is returned to the hand: Giant Trunade).
        ctx.game.link(r[0], ctx.self, false, { cardOnlyIfDestroyed: true });
      },
      ai: {
        score: (ctx) => {
          if (ctx.lp <= 1600) return 0;
          const best = Math.max(0, ...ctx.grave('me', (c) => c.isMonster && ctx.canSummonCard(c)).map((c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) + (c.isExtra ? 800 : 0)));
          return best >= 1900 ? 44 + best / 200 : 0;
        },
      },
    },
  ],
});

spell('Burial from a Different Dimension', 'quickplay', {
  text: 'Target up to 3 banished monsters; return them to the GY.',
  effects: [
    {
      kind: 'activate',
      categories: [], // banished -> GY has no dedicated category
      canActivate: (ctx) => ctx.banished('both', (c) => c.isMonster && c.faceUp).length > 0,
      activate: async (ctx) => {
        const cands = ctx.banished('both', (c) => c.isMonster && c.faceUp);
        const top = ctx.prevLink();
        const denyOpp = !!top && top.player === ctx.opp && (top.effect.categories ?? []).includes('specialSummon');
        await ctx.selectTargets(cands, 1, 3, 'Target up to 3 banished monsters to return to the GY.', 'specialSummon', {
          aiScore: (c) => (c.owner === ctx.player ? (denyOpp ? 0 : 1000 + (c.data.aiValue ?? 0) + (c.data.atk ?? 0) / 10) : denyOpp ? 3000 : -1000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'banished');
        if (t.length) await ctx.sendToGrave(t);
      },
      ai: {
        score: (ctx) => {
          const top = ctx.chainTop();
          // Deny "Return from the Different Dimension"-style revival.
          if (top && top.player === ctx.opp && (top.effect.categories ?? []).includes('specialSummon') && ctx.banished('opp', (c) => c.isMonster).length >= 2) return 60;
          if (top) return 0;
          const mine = ctx.banished('me', (c) => c.isMonster && c.faceUp).length;
          return mine >= 3 && !ctx.isMyTurn && ctx.phase === 'end' ? 32 : 0;
        },
      },
    },
  ],
});

/** Excavate from the top of the deck until a Normal-Summonable monster is revealed. */
function excavateForMonster(ctx: Ctx) {
  const deck = ctx.game.players[ctx.player].deck; // top of deck = end of array
  const revealed: CardInstance[] = [];
  let found: CardInstance | undefined;
  for (let i = deck.length - 1; i >= 0; i--) {
    const c = deck[i];
    revealed.push(c);
    if (normalSummonable(c)) {
      found = c;
      break;
    }
  }
  if (revealed.length) ctx.log(`Excavated: ${revealed.map((c) => c.name).join(', ')}.`);
  return { found, others: revealed.filter((c) => c !== found) };
}

async function excavatedToGrave(ctx: Ctx, cards: CardInstance[]) {
  const list = cards.filter((c) => c.location === 'deck');
  if (list.length) await ctx.game.moveCards(list, 'grave', { reason: 'effect', reasonPlayer: ctx.player, reasonCard: ctx.self });
}

spell('Monster Gate', 'normal', {
  text: 'Tribute 1 monster; excavate cards from the top of your Deck until you reveal a monster that can be Normal Summoned/Set. Special Summon it, and send the other excavated cards to the GY.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon', 'mill'],
      canActivate: (ctx) => tributable(ctx).length > 0 && ctx.deck().length > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon'),
      activate: async (ctx) => {
        const t = await tributeCost(ctx, tributable(ctx));
        if (!t.length) return false;
      },
      resolve: async (ctx) => {
        const { found, others } = excavateForMonster(ctx);
        await ctx.game.anim({ type: 'reveal', cards: [...others, ...(found ? [found] : [])].map((c) => c.uid), player: ctx.player });
        // 2010 ruling: if the whole Deck is picked up without finding a monster, the effect is negated and the cards
        // are shuffled back into the Deck. https://edisonrul.ing/cards/m/monster-gate.html
        if (!found) {
          ctx.game.shuffleDeck(ctx.player);
          return;
        }
        let summoned = false;
        if (found && ctx.canSummonCard(found)) summoned = (await ctx.specialSummon(found)).length > 0;
        await excavatedToGrave(ctx, summoned || !found ? others : [...others, found]);
      },
      ai: {
        score: (ctx) => {
          const deckMons = ctx.deck('me', normalSummonable);
          if (!deckMons.length) return 0;
          const avg = deckMons.reduce((a, c) => a + (c.data.atk ?? 0) + (c.data.aiValue ?? 0), 0) / deckMons.length;
          return avg - cheapestTribute(ctx) > 300 ? 40 : 0;
        },
      },
    },
  ],
});

spell('Reasoning', 'normal', {
  text: 'Your opponent declares a Level. Excavate from the top of your Deck until you reveal a monster that can be Normal Summoned/Set: if it has the declared Level, send all excavated cards to the GY; otherwise Special Summon it and send the rest to the GY.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon', 'mill'],
      canActivate: (ctx) => ctx.deck().length > 0,
      resolve: async (ctx) => {
        const levels = Array.from({ length: 12 }, (_, i) => `Level ${i + 1}`);
        const lvIdx = await ctx.game.option(ctx.opp, 'Declare a monster Level for Reasoning.', levels, ctx.self, (i) => (i === 3 ? 10 : i === 2 ? 6 : i === 1 ? 4 : i === 0 ? 3 : 1));
        const declared = lvIdx + 1;
        ctx.log(`${ctx.game.players[ctx.opp].name} declares Level ${declared}.`);
        const { found, others } = excavateForMonster(ctx);
        await ctx.game.anim({ type: 'reveal', cards: [...others, ...(found ? [found] : [])].map((c) => c.uid), player: ctx.player });
        if (found && (found.data.level ?? 0) !== declared && ctx.canSummonCard(found)) {
          const r = await ctx.specialSummon(found);
          await excavatedToGrave(ctx, r.length ? others : [...others, found]);
        } else {
          await excavatedToGrave(ctx, found ? [...others, found] : others);
        }
      },
      ai: {
        score: (ctx) => {
          if (!ctx.canSpecialSummon()) return 0;
          const deckMons = ctx.deck('me', normalSummonable);
          if (!deckMons.length) return 0;
          const avg = deckMons.reduce((a, c) => a + (c.data.atk ?? 0) + (c.data.aiValue ?? 0), 0) / deckMons.length;
          return avg >= 1400 ? 42 : 25;
        },
      },
    },
  ],
});

spell('Polymerization', 'normal', {
  text: 'Fusion Summon 1 Fusion Monster from your Extra Deck, using monsters from your hand or field as Fusion Material.',
  effects: [fusionSummonEffect()],
});

spell('Overload Fusion', 'normal', {
  text: 'Fusion Summon 1 DARK Machine Fusion Monster from your Extra Deck, by banishing Fusion Materials listed on it from your field or GY.',
  effects: [
    fusionSummonEffect({
      from: ['mzone', 'grave'],
      dest: 'banish',
      fusionFilter: (c) => c.data.attribute === 'DARK' && c.data.race === 'Machine',
      categories: ['specialSummon', 'banish'],
    }),
  ],
});

spell('Future Fusion', 'continuous', {
  text: 'Reveal 1 Fusion Monster in your Extra Deck and send the Fusion Materials listed on it from your Deck to the GY. During your 2nd Standby Phase after this card\'s activation, Special Summon that Fusion Monster (treated as a Fusion Summon). When this card is removed from the field, destroy that monster. When the monster is destroyed, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['mill', 'specialSummon'],
      // SJC Edison (May 2010) ruling: it performs a Special Summon (in the future) when activated, so it cannot be
      // activated while you cannot Special Summon. https://edisonrul.ing/cards/f/future-fusion.html
      canActivate: (ctx) => {
        if (!ctx.canSpecialSummon()) return false;
        const deckMons = ctx.deck('me', isMonster);
        return ctx.extra('me', (c) => c.hasType('fusion') && !!c.data.fusion && ctx.game.fusionMaterialSets(c, deckMons).length > 0).length > 0;
      },
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const deckMons = ctx.deck('me', isMonster);
        const choices = ctx
          .extra('me', (c) => c.hasType('fusion') && !!c.data.fusion)
          .map((f) => ({ f, sets: ctx.game.fusionMaterialSets(f, deckMons) }))
          .filter((x) => x.sets.length);
        if (!choices.length) return;
        const [f] = await ctx.select(
          choices.map((x) => x.f),
          1,
          1,
          'Reveal 1 Fusion Monster in your Extra Deck.',
          'specialSummon',
          { aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) },
        );
        const ch = choices.find((x) => x.f === f) ?? choices[0];
        ctx.log(`${ctx.game.players[ctx.player].name} reveals ${ch.f.name}.`);
        const mats = (await ctx.game.pickCombo(ctx.player, ch.sets, `Select materials for ${ch.f.name} to send from your Deck`, 'material')) ?? ch.sets[0];
        await ctx.sendToGrave(mats);
        ctx.game.shuffleDeck(ctx.player);
        ctx.self.flags.ffFusion = ch.f.uid;
        ctx.self.flags.ffStandbys = 0;
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' || ctx.phase === 'main2' ? 42 : 0) },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Future Fusion countdown',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.flags.ffFusion != null,
      condition: activeST,
      resolve: async (ctx) => {
        if (!ctx.self.onField || ctx.self.flags.ffFusion == null) return;
        const n = (ctx.self.flags.ffStandbys ?? 0) + 1;
        ctx.self.flags.ffStandbys = n;
        if (n < 2) {
          ctx.log('Future Fusion: 1 more Standby Phase.');
          return;
        }
        const f = ctx.game.card(ctx.self.flags.ffFusion);
        ctx.self.flags.ffFusion = null;
        if (!f || f.location !== 'extra') return;
        const r = await ctx.specialSummon(f, { method: 'fusion', proper: true, pos: 'choose' });
        // 2010 text: "When this card is removed from the field, destroy that monster. When the monster is destroyed,
        // destroy this card" (no Chain; a bounced monster leaves this card on the field).
        // https://edisonrul.ing/cards/f/future-fusion.html
        if (r.length && ctx.self.onField) ctx.game.link(ctx.self, r[0], true, { cardOnlyIfDestroyed: true });
      },
    },
  ],
});

spell('Metamorphosis', 'normal', {
  // 2010 ruling: a face-down monster can be Tributed. https://edisonrul.ing/cards/m/metamorphosis.html
  text: 'Tribute 1 monster; Special Summon from your Extra Deck 1 Fusion Monster with the same Level as the Tributed monster.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') &&
        tributable(ctx).some((m) => ctx.extra('me', (f) => f.hasType('fusion') && f.data.level === ctx.level(m)).length > 0),
      activate: async (ctx) => {
        const cands = tributable(ctx, (c) => ctx.extra('me', (f) => f.hasType('fusion') && f.data.level === ctx.level(c)).length > 0);
        const sel = await ctx.select(cands, 1, 1, 'Tribute 1 monster.', 'tribute');
        if (!sel.length) return false;
        ctx.data.level = ctx.level(sel[0]);
        await ctx.game.moveCards(sel, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
      },
      resolve: async (ctx) => {
        const cands = ctx.extra('me', (f) => f.hasType('fusion') && f.data.level === ctx.data.level);
        const sel = await ctx.select(cands, 1, 1, `Special Summon 1 Level ${ctx.data.level} Fusion Monster.`, 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
        if (sel.length) await ctx.specialSummon(sel, { ignoreConditions: true });
      },
      ai: {
        score: (ctx) => {
          let best = 0;
          for (const m of tributable(ctx, (c) => c.faceUp)) {
            for (const f of ctx.extra('me', (x) => x.hasType('fusion') && x.data.level === ctx.level(m))) {
              best = Math.max(best, (f.data.atk ?? 0) + (f.data.aiValue ?? 0) - cardValue(ctx.game, m));
            }
          }
          return best > 500 ? 45 + best / 200 : 0;
        },
      },
    },
  ],
});

spell('Dimension Fusion', 'normal', {
  text: 'Pay 2000 LP; each player Special Summons as many of their banished monsters as possible.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.lp > 2000 && ctx.banished('both', (c) => c.isMonster && c.faceUp).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(2000);
      },
      resolve: async (ctx) => {
        const tp = ctx.game.turnPlayer;
        for (const p of [tp, ctx.game.opp(tp)] as PlayerId[]) {
          if (ctx.game.queryPlayer(p, 'cannotSpecialSummon')) continue;
          const cands = ctx.game
            .zone(p, 'banished')
            .filter((c) => c.isMonster && c.faceUp && !c.isToken && !((c.data.nomi || c.isExtra) && !c.properlySummoned));
          const n = Math.min(ctx.game.freeMZones(p), cands.length);
          if (n <= 0) continue;
          const sel = await ctx.game.select(p, cands, n, n, 'Special Summon your banished monsters.', 'specialSummon', { source: ctx.self });
          if (sel.length) await ctx.game.specialSummon(sel, p, { pos: 'choose', reasonCard: ctx.self });
        }
      },
      ai: {
        score: (ctx) => {
          if (ctx.lp <= 3000) return 0;
          const val = (side: 'me' | 'opp') =>
            ctx
              .cards(side, 'banished', (c) => c.isMonster && c.faceUp)
              .map((c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0))
              .sort((a, b) => b - a)
              .slice(0, 5)
              .reduce((a, b) => a + b, 0);
          const gain = val('me') - val('opp');
          return gain > 3000 ? 45 + gain / 300 : 0;
        },
      },
    },
  ],
});

// ======================================================================
// Control
// ======================================================================

spell('Mind Control', 'normal', {
  text: 'Target 1 monster your opponent controls; take control of it until the End Phase. It cannot declare an attack or be Tributed.',
  effects: [
    {
      kind: 'activate',
      categories: ['control'],
      canActivate: (ctx) => ctx.freeMZones() > 0 && ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls.', 'control');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.opp);
        if (!t.length) return;
        if (await ctx.takeControl(t[0], true)) {
          ctx.addTempMod(t[0], 'cannotAttack', true, 'turn');
          ctx.addTempMod(t[0], 'cannotBeTributed', true, 'turn');
        }
      },
      ai: { score: (ctx) => stealScore(ctx, { canAttack: false }) },
    },
  ],
});

spell('Change of Heart', 'normal', {
  text: 'Target 1 monster your opponent controls; take control of it until the End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['control'],
      canActivate: (ctx) => ctx.freeMZones() > 0 && ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls.', 'control');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.opp);
        if (t.length) await ctx.takeControl(t[0], true);
      },
      ai: { score: (ctx) => stealScore(ctx, { canAttack: true }) + 5 },
    },
  ],
});

const snatchHosts = new Map<number, { mon: CardInstance; moveId: number }>();
spell('Snatch Steal', 'equip', {
  text: 'Equip only to a monster your opponent controls. Take control of the equipped monster. During each of your opponent\'s Standby Phases, they gain 1000 LP.',
  effects: [
    equipActivate({
      filter: (ctx, c) => c.controller === ctx.opp,
      categories: ['control'],
      aiTarget: (ctx, c) => cardValue(ctx.game, c),
      score: (ctx) => stealScore(ctx, { canAttack: true, faceUpOnly: true }) + 8,
      onEquip: async (ctx, t) => {
        if (t.controller !== ctx.opp) return;
        if (await ctx.takeControl(t, false)) snatchHosts.set(ctx.self.uid, { mon: t, moveId: t.moveId });
      },
    }),
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Opponent gains 1000 LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && !ctx.isMyTurn && ctx.self.equippedTo != null,
      condition: activeST,
      resolve: async (ctx) => {
        await ctx.recover(ctx.opp, 1000);
      },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      mandatory: true,
      label: 'Return control',
      categories: ['control'],
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self) return false;
        const h = snatchHosts.get(ctx.self.uid);
        if (h && !(h.mon.location === 'mzone' && h.mon.moveId === h.moveId)) snatchHosts.delete(ctx.self.uid);
        return snatchHosts.has(ctx.self.uid);
      },
      resolve: async (ctx) => {
        const h = snatchHosts.get(ctx.self.uid);
        snatchHosts.delete(ctx.self.uid);
        if (h && h.mon.location === 'mzone' && h.mon.moveId === h.moveId && h.mon.controller !== h.mon.owner) await ctx.game.returnControl(h.mon);
      },
    },
  ],
});

/** Soul Exchange support: let the engine accept marked opponent monsters as Tribute Summon fodder. */
function ensureSoulExchangePatch(ctx: Ctx) {
  const g = ctx.game as any;
  if (g.__soulExchangePatched) return;
  g.__soulExchangePatched = true;
  const orig = g.tributeCandidates.bind(g) as (p: PlayerId, forCard?: CardInstance) => CardInstance[];
  g.tributeCandidates = (p: PlayerId, forCard?: CardInstance) => {
    const base = orig(p, forCard);
    const extra = ctx.game
      .monsters(ctx.game.opp(p))
      .filter((c) => c.flags.soulExchangeFor === p && c.flags.soulExchangeTurn === ctx.game.turn && !ctx.game.queryCard(c, 'cannotBeTributed'));
    return [...base, ...extra];
  };
}

/** AI plan for Soul Exchange: which opponent monster to borrow, and how good it is. */
function soulExchangePlan(ctx: Ctx): { target: CardInstance; score: number } | null {
  if (ctx.phase !== 'main1' || ctx.game.players[ctx.player].normalSummonsLeft <= 0) return null;
  const own = ctx.game.tributeCandidates(ctx.player);
  const ownVals = own.map((c) => cardValue(ctx.game, c)).sort((a, b) => a - b);
  const oppMons = ctx.monsters('opp', (c) => ctx.canTarget(c) && !ctx.query(c, 'cannotBeTributed'));
  let best: { target: CardInstance; score: number } | null = null;
  for (const m of otherHand(ctx, (c) => c.isMonster && !c.isExtra && !c.data.cannotNormalSummon)) {
    const need = ctx.game.tributesNeeded(m);
    if (need === 0 || own.length >= need || own.length + 1 < need) continue;
    const mVal = (m.data.atk ?? 0) + (m.data.aiValue ?? 0) + (m.hasType('effect') ? 200 : 0);
    for (const t of oppMons) {
      // Mirror the AI summon heuristic so the follow-up Tribute Summon actually happens.
      const vals = [...ownVals, cardValue(ctx.game, t)].sort((a, b) => a - b).slice(0, need);
      const loss = vals.reduce((a, b) => a + b, 0);
      if (mVal - loss < 400) continue;
      const s = 40 + cardValue(ctx.game, t) / 100;
      if (!best || s > best.score) best = { target: t, score: s };
    }
  }
  return best;
}

spell('Soul Exchange', 'normal', {
  text: 'Target 1 monster your opponent controls; this turn, you can Tribute it for a Tribute Summon as if you controlled it. You cannot conduct your Battle Phase the turn you activate this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['control'],
      condition: (ctx) => ctx.phase === 'main1',
      canActivate: (ctx) => ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      // https://edisonrul.ing/cards/s/soul-exchange.html — if its ACTIVATION is negated (Dark Bribe) you can conduct your
      // Battle Phase; if only its effect is negated (Imperial Order) you still cannot.
      onActivationNegated: (ctx) => {
        const g = ctx.game;
        const lock = (ctx.data.lock ?? []) as typeof g.playerMods;
        g.playerMods = g.playerMods.filter((m) => !lock.includes(m));
        g.update();
      },
      activate: async (ctx) => {
        // Activation condition: no Battle Phase this turn (applies even if its effect is negated).
        ctx.addPlayerMod(ctx.player, 'cannotDeclareAttack');
        ctx.data.lock = ctx.game.playerMods.slice(-1);
        const plan = soulExchangePlan(ctx);
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls to Tribute this turn.', 'control', {
          aiScore: (c) => (plan && c === plan.target ? 100000 : cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.opp);
        if (!t.length) return;
        ensureSoulExchangePatch(ctx);
        t[0].flags.soulExchangeFor = ctx.player;
        t[0].flags.soulExchangeTurn = ctx.turn;
        ctx.log(`${ctx.game.players[ctx.player].name} may Tribute ${t[0].faceUp ? t[0].name : 'that face-down monster'} this turn.`);
      },
      ai: { score: (ctx) => soulExchangePlan(ctx)?.score ?? 0 },
    },
  ],
});

spell('Enemy Controller', 'quickplay', {
  text: 'Activate 1 of these effects: ● Target 1 face-up monster your opponent controls; change its battle position. ● Tribute 1 monster, then target 1 face-up monster your opponent controls; take control of it until the End Phase.',
  effects: [
    {
      kind: 'activate',
      label: 'Change battle position',
      categories: ['position'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const b = ctx.battle;
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster to change its battle position.', 'position', {
          aiScore: (c) => (b && b.attacker === c ? 100000 : c.pos === 'def' ? 5000 - ctx.atk(c) : cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.changePos(t[0], t[0].pos === 'atk' ? 'def' : 'atk', true);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (b && !b.inDamageStep && b.attacker.controller === ctx.opp && ctx.canTarget(b.attacker)) {
            const atk = ctx.atk(b.attacker);
            if (!b.target) return atk >= 1000 ? 65 : 0;
            const st = battleStat(ctx, b.target);
            return st === null || atk > st || atk >= 1900 ? 62 : 0;
          }
          if (ctx.isMyTurn && ctx.phase === 'main1' && !ctx.game.chain.length) {
            // Flip a high-DEF wall into Attack Position so it can be run over.
            const myBest = Math.max(0, ...ctx.faceUpMonsters('me', (c) => c.pos === 'atk' && ctx.game.canAttack(c)).map((c) => ctx.atk(c)));
            const walls = ctx.faceUpMonsters('opp', (c) => c.pos === 'def' && ctx.canTarget(c) && ctx.def(c) >= myBest && ctx.atk(c) < myBest);
            return walls.length ? 34 : 0;
          }
          return 0;
        },
      },
    },
    {
      kind: 'activate',
      label: 'Tribute: take control',
      categories: ['control'],
      canActivate: (ctx) => tributable(ctx).length > 0 && ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const b = ctx.battle;
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster to take control of.', 'control', {
          aiScore: (c) => (b && b.attacker === c ? 100000 : cardValue(ctx.game, c)),
        });
        await tributeCost(ctx, tributable(ctx));
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && c.controller === ctx.opp);
        if (t.length) await ctx.takeControl(t[0], true);
      },
      ai: {
        score: (ctx) => {
          const cheap = cheapestTribute(ctx);
          const b = ctx.battle;
          if (b && !b.inDamageStep && b.attacker.controller === ctx.opp && ctx.canTarget(b.attacker)) {
            const v = cardValue(ctx.game, b.attacker);
            return v >= 1900 && cheap < 1300 ? 58 : 0;
          }
          if (!ctx.isMyTurn || ctx.phase !== 'main1' || ctx.game.chain.length) return 0;
          const cands = ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c));
          if (!cands.length) return 0;
          const v = cardValue(ctx.game, bestTarget(ctx.game, cands));
          return v >= 1900 && v - cheap >= 800 ? 46 + v / 200 : 0;
        },
      },
    },
  ],
});

// ======================================================================
// Burn / LP
// ======================================================================

const burnScore = (n: number) => (ctx: Ctx) => (ctx.oppLp <= n ? 100 : ctx.phase === 'main2' || ctx.oppLp <= 2000 ? 30 : 22);

spell('Dian Keto the Cure Master', 'normal', {
  text: 'Gain 1000 LP.',
  effects: [
    {
      kind: 'activate',
      categories: ['recover'],
      resolve: async (ctx) => {
        await ctx.recover(ctx.player, 1000);
      },
      ai: { score: (ctx) => (ctx.lp <= 2000 ? 40 : 12) },
    },
  ],
});

spell('Ookazi', 'normal', {
  text: 'Inflict 800 damage to your opponent.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 800);
      },
      ai: { score: burnScore(800) },
    },
  ],
});

spell('Hinotama', 'normal', {
  text: 'Inflict 500 damage to your opponent.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500);
      },
      ai: { score: burnScore(500) },
    },
  ],
});

spell('Emergency Provisions', 'quickplay', {
  text: 'Send any number of other Spells/Traps you control to the GY; gain 1000 LP for each card sent.',
  effects: [
    {
      kind: 'activate',
      categories: ['recover', 'protect'],
      canActivate: (ctx) => ctx.spellTraps('me', (c) => c !== ctx.self).length > 0,
      activate: async (ctx) => {
        const cands = ctx.spellTraps('me', (c) => c !== ctx.self);
        const top = ctx.prevLink();
        const doomed = new Set<CardInstance>();
        if (top && top.player === ctx.opp) {
          for (const t of top.ctx.targets) if (cands.includes(t)) doomed.add(t);
          if ((top.effect.categories ?? []).includes('destroyMulti')) for (const c of cands) doomed.add(c);
        }
        // Spent cards (face-up normal S/T in a chain, or continuous cards that do nothing anymore) are fine too.
        for (const c of cands) if (c.faceUp && c.linkedTo == null && c.data.ttype === 'continuous' && (c.data.effects?.[0]?.categories ?? []).includes('specialSummon')) doomed.add(c);
        const human = ctx.game.controllers[ctx.player].isHuman;
        const pick = human
          ? await ctx.select(cands, 1, cands.length, 'Send any number of your other Spells/Traps to the GY.', 'cost', { cancelable: false })
          : [...doomed].length
            ? [...doomed]
            : await ctx.select(cands, 1, 1, 'Send 1 Spell/Trap to the GY.', 'cost');
        if (!pick.length) return false;
        ctx.data.n = pick.length;
        await ctx.sendToGrave(pick, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.recover(ctx.player, 1000 * (ctx.data.n ?? 0));
      },
      ai: {
        score: (ctx) => {
          const top = ctx.chainTop();
          if (!top || top.player !== ctx.opp) return 0;
          const mine = ctx.spellTraps('me', (c) => c !== ctx.self);
          const hit = (top.effect.categories ?? []).includes('destroyMulti') && top.card.isSpell && mine.length > 0;
          return top.ctx.targets.some((t) => mine.includes(t) && t.faceUp) || (hit && mine.some((c) => c.faceUp)) ? 50 : 0;
        },
      },
    },
  ],
});

// ======================================================================
// Quick-play stat changes
// ======================================================================

// Shrink's "already halved" mark ends when the monster is turned face-down (its effect stops applying then).
faceUpFlag('shrunkTurn');
spell('Shrink', 'quickplay', {
  text: 'Select 1 face-up monster on the field. The original ATK of that monster is halved until the end of this turn.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const mb = myBattle(ctx);
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to halve its original ATK.', 'target', {
          aiScore: (c) => (mb && c === mb.theirs ? 100000 : c.controller === ctx.opp ? cardValue(ctx.game, c) : -10000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (!t.length) return;
        // https://edisonrul.ing/cards/s/shrink.html — it halves the ORIGINAL ATK: a second "Shrink" on the same monster
        // achieves nothing.
        if (t[0].flags.shrunkTurn === ctx.turn) return;
        t[0].flags.shrunkTurn = ctx.turn;
        const base = ctx.game.baseAtk(t[0]);
        ctx.addTempMod(t[0], 'atk', -Math.floor(base / 2), 'turn');
      },
      ai: {
        score: (ctx) => {
          const mb = myBattle(ctx);
          if (!mb || !mb.b.inDamageStep || !mb.theirs || !mb.theirs.faceUp || mb.theirs.pos !== 'atk') return 0;
          const theirAtk = ctx.atk(mb.theirs);
          const after = theirAtk - Math.floor(ctx.game.baseAtk(mb.theirs) / 2);
          const myStat = mb.mine.pos === 'atk' ? ctx.atk(mb.mine) : ctx.def(mb.mine);
          if (myStat <= theirAtk && myStat > after) return 90;
          if (mb.mine.pos === 'def' && theirAtk > myStat && after <= myStat) return 70;
          return 0;
        },
      },
    },
  ],
});

spell('Rush Recklessly', 'quickplay', {
  text: 'Target 1 face-up monster on the field; it gains 700 ATK until the end of this turn.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const mb = myBattle(ctx);
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to gain 700 ATK.', 'buff', {
          aiScore: (c) => (mb && c === mb.mine ? 100000 : c.controller === ctx.player ? ctx.atk(c) : -10000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) ctx.addTempMod(t[0], 'atk', 700, 'turn');
      },
      ai: {
        score: (ctx) => {
          const mb = myBattle(ctx);
          if (!mb || mb.mine.pos !== 'atk' || !mb.mine.faceUp) return 0;
          const atk = ctx.atk(mb.mine);
          if (!mb.theirs) return mb.attacking && ctx.oppLp <= atk + 700 && ctx.oppLp > atk ? 95 : 0;
          if (!mb.b.inDamageStep) return 0;
          const st = battleStat(ctx, mb.theirs);
          if (st === null) return 0;
          return atk <= st && atk + 700 > st ? 88 : 0;
        },
      },
    },
  ],
});

// ======================================================================
// Equip Spells
// ======================================================================

spell('Megamorph', 'equip', {
  text: 'Equip only to a face-up monster. While your LP are lower than your opponent\'s, the equipped monster\'s ATK becomes double its original ATK. While your LP are higher, it becomes half its original ATK.',
  effects: [
    equipActivate({
      aiTarget: (ctx, c) => {
        if (ctx.lp < ctx.oppLp) return c.controller === ctx.player ? ctx.game.baseAtk(c) : -10000;
        return c.controller === ctx.opp ? ctx.game.baseAtk(c) : -10000;
      },
      score: (ctx) => {
        if (ctx.lp === ctx.oppLp) return 0;
        const side = ctx.lp < ctx.oppLp ? 'me' : 'opp';
        const cands = ctx.faceUpMonsters(side, (c) => ctx.canTarget(c));
        if (!cands.length) return 0;
        const best = Math.max(...cands.map((c) => ctx.game.baseAtk(c)));
        return best >= 1400 ? 35 + best / 150 : 0;
      },
    }),
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          // 2010 ruling: several "Megamorph" on one monster are the same as one (only the first one applies).
          // https://edisonrul.ing/cards/m/megamorph.html
          filter: (ctx, c) => equipped(ctx, c) && ctx.game.equipsOf(c).find((e) => e.name === 'Megamorph' && e.faceUp && !ctx.game.isNegated(e)) === ctx.self,
          value: (ctx, c) => {
            const base = ctx.game.baseAtk(c);
            if (ctx.lp < ctx.oppLp) return base;
            if (ctx.lp > ctx.oppLp) return -Math.floor(base / 2);
            return 0;
          },
        },
      ],
    },
  ],
});

spell('Axe of Despair', 'equip', {
  text: 'The equipped monster gains 1000 ATK. When this card is sent from the field to the GY: You can Tribute 1 monster; place this card on top of your Deck.',
  effects: [
    equipActivate({ score: buffEquipScore(() => 1000) }),
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: equipped, value: 1000 }] },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Tribute: return to Deck top',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && (ev.from === 'szone' || ev.from === 'fzone'),
      canActivate: (ctx) => tributable(ctx).length > 0,
      activate: async (ctx) => {
        const t = await tributeCost(ctx, tributable(ctx));
        if (!t.length) return false;
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toDeck(ctx.self, 'top');
      },
      ai: { score: (ctx) => (tributable(ctx, (c) => c.isToken).length ? 25 : 0) },
    },
  ],
});

spell('United We Stand', 'equip', {
  text: 'The equipped monster gains 800 ATK and DEF for each face-up monster you control.',
  effects: [
    equipActivate({ score: buffEquipScore((ctx) => 800 * ctx.faceUpMonsters('me').length) }),
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', to: 'cards', filter: equipped, value: (ctx) => 800 * ctx.faceUpMonsters('me').length },
        { q: 'def', to: 'cards', filter: equipped, value: (ctx) => 800 * ctx.faceUpMonsters('me').length },
      ],
    },
  ],
});

spell('Mage Power', 'equip', {
  text: 'The equipped monster gains 500 ATK and DEF for each Spell and Trap you control.',
  effects: [
    equipActivate({ score: buffEquipScore((ctx) => 500 * (ctx.spellTraps('me').length + (ctx.self.location === 'hand' ? 1 : 0))) }),
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', to: 'cards', filter: equipped, value: (ctx) => 500 * ctx.spellTraps('me').length },
        { q: 'def', to: 'cards', filter: equipped, value: (ctx) => 500 * ctx.spellTraps('me').length },
      ],
    },
  ],
});

spell('Butterfly Dagger - Elma', 'equip', {
  text: 'The equipped monster gains 300 ATK. When this card is destroyed and sent to the GY: You can return it to its owner\'s hand.',
  effects: [
    equipActivate({ score: buffEquipScore(() => 300) }),
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: equipped, value: 300 }] },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Return to hand',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && (ev.from === 'szone' || ev.from === 'fzone') && (ev.reasons ?? []).includes('destroy'),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toHand(ctx.self);
      },
    },
  ],
});

// ======================================================================
// Continuous Spells / lasting effects
// ======================================================================

spell('Swords of Revealing Light', 'normal', {
  text: 'Flip all monsters your opponent controls face-up. This card stays on the field; while it is face-up, your opponent\'s monsters cannot declare an attack. Destroy it during your opponent\'s 3rd End Phase after activation.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown', 'position'],
      resolve: async (ctx) => {
        if (!ctx.self.onField || !ctx.self.faceUp) return;
        ctx.self.flags.staysOnField = true;
        ctx.self.activeOnField = true;
        ctx.self.counters.swords = 0;
        for (const c of ctx.monsters('opp', (m) => !m.faceUp)) {
          if (!ctx.game.isUnaffected(c, ctx.self, ctx.player)) await ctx.changePos(c, 'def', true);
        }
      },
      ai: {
        score: (ctx) => {
          const threats = ctx.monsters('opp');
          if (!threats.length) return ctx.spellTraps('opp').length ? 0 : 12;
          const total = threats.reduce((a, c) => a + (c.faceUp ? ctx.atk(c) : 1500), 0);
          const mineBest = Math.max(0, ...ctx.faceUpMonsters('me').map((c) => ctx.atk(c)));
          const theirBest = Math.max(0, ...ctx.faceUpMonsters('opp').map((c) => ctx.atk(c)));
          return theirBest > mineBest || ctx.lp <= total ? 55 : 30;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c) => c.location === 'mzone' && c.controller === ctx.opp }],
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Turn count',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && !ctx.isMyTurn,
      condition: (ctx) => ctx.self.faceUp && ctx.self.activeOnField,
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const n = (ctx.self.counters.swords ?? 0) + 1;
        ctx.self.counters.swords = n;
        ctx.log(`Swords of Revealing Light: turn ${n} of 3.`);
        if (n >= 3) await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
      },
    },
  ],
});

spell('Messenger of Peace', 'continuous', {
  text: 'Monsters with 1500 or more ATK cannot declare an attack. Once per turn, during your Standby Phase, pay 100 LP or destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      ai: {
        score: (ctx) => {
          const big = (side: 'me' | 'opp') => ctx.faceUpMonsters(side, (c) => c.pos === 'atk' && ctx.atk(c) >= 1500).length;
          return big('opp') > big('me') ? 42 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c) => c.location === 'mzone' && c.faceUp && ctx.atk(c) >= 1500 }],
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Maintenance',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn,
      condition: activeST,
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        let pay = false;
        if (ctx.lp > 100) {
          const big = (side: 'me' | 'opp') => ctx.monsters(side, (c) => c.isMonster && ctx.atk(c) >= 1500).length;
          const keep = big('opp') >= big('me');
          pay = (await ctx.option('Messenger of Peace: maintain it?', ['Pay 100 LP', 'Destroy Messenger of Peace'], (i) => (i === 0 ? (keep ? 1 : 0) : keep ? 0 : 1))) === 0;
        }
        if (pay) await ctx.payLp(100);
        else await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
      },
    },
  ],
});

const llVictims = (ctx: Ctx) =>
  ctx.faceUpMonsters('both', (c) => c.pos === 'atk' && ctx.level(c) >= 4 && !ctx.game.isUnaffected(c, ctx.self, ctx.player));
async function llApply(ctx: Ctx) {
  for (const c of llVictims(ctx)) await ctx.changePos(c, 'def', true);
}
spell('Level Limit - Area B', 'continuous', {
  text: 'All face-up Level 4 or higher monsters are changed to Defense Position.',
  effects: [
    {
      kind: 'activate',
      categories: ['position', 'lockdown'],
      resolve: async (ctx) => {
        if (ctx.self.onField && ctx.self.faceUp) {
          ctx.self.activeOnField = true;
          await llApply(ctx);
        }
      },
      ai: {
        score: (ctx) => {
          const n = (side: 'me' | 'opp') => ctx.faceUpMonsters(side, (c) => c.pos === 'atk' && ctx.level(c) >= 4).length;
          const opp4 = ctx.monsters('opp', (c) => (c.data.level ?? 0) >= 4).length;
          return n('opp') > n('me') || (opp4 > 0 && n('me') === 0) ? 40 : 0;
        },
      },
    },
    {
      // Modelled as a mandatory trigger that re-applies the position change whenever something changes.
      kind: 'trigger',
      event: ['summoned', 'flipped', 'positionChanged', 'controlChanged', 'phaseStart'],
      range: ['szone'],
      mandatory: true,
      label: 'Change to Defense Position',
      categories: ['position'],
      eventFilter: (ctx) => activeST(ctx) && llVictims(ctx).length > 0,
      condition: (ctx) => activeST(ctx) && llVictims(ctx).length > 0,
      resolve: llApply,
    },
  ],
});

spell('Mass Driver', 'continuous', {
  text: 'Tribute 1 monster; inflict 400 damage to your opponent.',
  effects: [
    { kind: 'activate', categories: ['damage'], ai: { score: (ctx) => (ctx.monsters('me').length ? 15 : 8) } },
    {
      kind: 'ignition',
      label: 'Tribute: 400 damage',
      categories: ['damage'],
      canActivate: (ctx) => tributable(ctx).length > 0,
      activate: async (ctx) => {
        const t = await tributeCost(ctx, tributable(ctx));
        if (!t.length) return false;
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 400);
      },
      ai: {
        score: (ctx) => {
          if (ctx.oppLp <= 400) return 100;
          if (ctx.oppLp <= 400 * tributable(ctx).length && ctx.phase === 'main2') return 60;
          return tributable(ctx, (c) => c.isToken).length && ctx.phase === 'main2' ? 25 : 0;
        },
      },
    },
  ],
});

spell('Cold Wave', 'normal', {
  text: 'Activate only at the start of Main Phase 1. Until your next turn, neither player can activate or Set Spell/Trap Cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      condition: atStartOfMain1,
      resolve: async (ctx) => {
        for (const p of [ctx.player, ctx.opp]) {
          ctx.addPlayerMod(p, 'cannotActivateSpells', true, 'nextTurnEnd');
          ctx.addPlayerMod(p, 'cannotActivateTraps', true, 'nextTurnEnd');
          ctx.addPlayerMod(p, 'cannotSetSpellTrap', true, 'nextTurnEnd');
        }
        ctx.log('Cold Wave: no Spells/Traps can be activated or Set until the next turn.');
      },
      ai: {
        score: (ctx) => {
          const theirSets = ctx.spellTraps('opp', (c) => !c.faceUp).length;
          return theirSets >= 2 && ctx.monsters('me').length + otherHand(ctx, isMonster).length > 0 ? 50 + theirSets * 5 : 0;
        },
      },
    },
  ],
});

spell('Double Summon', 'normal', {
  text: 'You can conduct 2 Normal Summons/Sets this turn, not just 1.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      resolve: async (ctx) => {
        ctx.gainNormalSummon(1);
      },
      ai: {
        score: (ctx) => {
          const left = ctx.game.players[ctx.player].normalSummonsLeft;
          const summonable = otherHand(ctx, (c) => c.isMonster && !c.data.cannotNormalSummon && !c.isExtra && ctx.game.tributesNeeded(c) === 0);
          if (ctx.freeMZones() <= 0) return 0;
          return left === 0 && summonable.length >= 1 ? 40 : left === 1 && summonable.length >= 2 ? 30 : 0;
        },
      },
    },
  ],
});

spell('Card of Safe Return', 'continuous', {
  text: 'When a monster is Special Summoned from your GY to your field: You can draw 1 card.',
  effects: [
    { kind: 'activate', categories: ['draw'], ai: { score: (ctx) => (ctx.grave('me', isMonster).length ? 28 : 15) } },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      range: ['szone'],
      label: 'Draw',
      categories: ['draw'],
      eventFilter: (ctx, ev) => {
        const c = ev.card as CardInstance;
        return ev.from === 'grave' && !!c && c.owner === ctx.player && c.controller === ctx.player;
      },
      condition: activeST,
      resolve: async (ctx) => {
        const ev = ctx.event;
        const n = ev
          ? ctx.game.eventLog.filter((e) => e.type === 'specialSummoned' && e.batch === ev.batch && e.from === 'grave' && (e.card as CardInstance)?.owner === ctx.player).length
          : 1;
        await ctx.draw(Math.max(1, n));
      },
    },
  ],
});

spell('Mirage of Nightmare', 'continuous', {
  text: 'During your opponent\'s Standby Phase: Draw until you have 4 cards in your hand. During your next Standby Phase, discard at random as many cards as you drew with this effect.',
  effects: [
    { kind: 'activate', categories: ['draw'], ai: { score: (ctx) => (otherHand(ctx).length <= 2 ? 35 : 10) } },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Draw to 4',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && !ctx.isMyTurn,
      condition: (ctx) => activeST(ctx) && ctx.hand('me').length < 4,
      resolve: async (ctx) => {
        const n = Math.max(0, 4 - ctx.hand('me').length);
        const drawn = await ctx.draw(n);
        if (ctx.self.onField) ctx.self.flags.mirageOwed = (ctx.self.flags.mirageOwed ?? 0) + drawn.length;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Random discard',
      categories: ['discard'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && (ctx.self.flags.mirageOwed ?? 0) > 0,
      condition: activeST,
      resolve: async (ctx) => {
        const n = ctx.self.flags.mirageOwed ?? 0;
        ctx.self.flags.mirageOwed = 0;
        const hand = [...ctx.hand('me')];
        ctx.game.rng.shuffle(hand);
        const disc = hand.slice(0, Math.min(n, hand.length));
        if (disc.length) await ctx.discard(disc);
      },
    },
  ],
});

export const SPELLS_LOADED = true;
