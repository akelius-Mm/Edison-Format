// Card definitions: Elemental HEROes and their support (Hero Beat).
import { monster, normal, spell, trap } from '../define';
import { attr, cardValue, selfDestroysByBattle, selfSummoned, selfToGrave } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';

// ------------------------------------------------------------------ helpers

const isHero = (c: CardInstance) => c.isMonster && c.inSet('hero');
const isEHero = (c: CardInstance) => c.isMonster && c.inSet('elemental-hero');
const isFaceUpEHero = (c: CardInstance) => c.location === 'mzone' && c.faceUp && isEHero(c);
const HERO_SETS = ['hero', 'elemental-hero'];

/** Rough value of having this Fusion monster on the field right now (for AI choices). */
function fusionValue(ctx: Ctx, f: CardInstance, mats: CardInstance[] = []): number {
  const g = ctx.game;
  const oppUp = ctx.faceUpMonsters('opp');
  switch (f.name) {
    case 'Elemental Hero Absolute Zero': {
      const waters = ctx.faceUpMonsters('both', (c) => c.data.attribute === 'WATER' && !mats.includes(c)).length;
      const oppVal = ctx.monsters('opp').reduce((a, c) => a + cardValue(g, c), 0);
      return 2500 + 500 * waters + 600 + oppVal * 0.3;
    }
    case 'Elemental Hero Great Tornado':
      return 2800 + oppUp.reduce((a, c) => a + ctx.atk(c) / 2, 0) * 0.6;
    case 'Elemental Hero Gaia': {
      const best = Math.max(0, ...oppUp.map((c) => ctx.atk(c)));
      return 2200 + best * 0.6;
    }
    case 'Elemental Hero The Shining': {
      const banished = ctx.banished('me', isEHero).length + mats.filter(isEHero).length;
      return 2600 + 300 * banished + 300;
    }
    default:
      return (f.data.atk ?? 0) + (f.data.aiValue ?? 0);
  }
}

/** Cost (for the AI) of using a card as Fusion Material. */
function materialCost(ctx: Ctx, c: CardInstance) {
  if (c.location === 'grave') return 60 + (c.name === 'Elemental Hero Stratos' ? 250 : 0);
  return cardValue(ctx.game, c) + 300;
}

export interface FusionOption {
  fusion: CardInstance;
  combos: CardInstance[][];
}

/** Every Fusion monster in the Extra Deck matching `fusionFilter` that can be made from `pool`. */
export function fusionOptions(ctx: Ctx, fusionFilter: (c: CardInstance) => boolean, pool: CardInstance[]): FusionOption[] {
  if (ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return [];
  const out: FusionOption[] = [];
  const seen = new Set<string>();
  for (const f of ctx.extra('me', (c) => c.hasType('fusion') && !!c.data.fusion && fusionFilter(c))) {
    if (seen.has(f.name)) continue; // identical copies have identical options
    let combos = ctx.game.fusionMaterialSets(f, pool);
    // Need a free Monster Zone, or a material that leaves the field.
    if (ctx.freeMZones() <= 0) combos = combos.filter((cb) => cb.some((m) => m.location === 'mzone' && m.controller === ctx.player));
    if (combos.length) {
      seen.add(f.name);
      out.push({ fusion: f, combos });
    }
  }
  return out;
}

/** Best AI combo + net gain for one fusion option. */
function bestCombo(ctx: Ctx, o: FusionOption) {
  let best = o.combos[0];
  let bestCost = Infinity;
  for (const cb of o.combos) {
    const cost = cb.reduce((a, m) => a + materialCost(ctx, m), 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = cb;
    }
  }
  return { combo: best, gain: fusionValue(ctx, o.fusion, best) - bestCost };
}

/** Best net gain over all fusion options (AI scoring). */
export function bestFusionGain(ctx: Ctx, options: FusionOption[]) {
  return Math.max(-Infinity, ...options.map((o) => bestCombo(ctx, o).gain));
}

/**
 * Generic Fusion Summon procedure for card scripts (Miracle Fusion, Polymerization-likes).
 * Chooses a Fusion monster and materials from `pool`, moves the materials to `dest`
 * (with reason 'fusion'), then Fusion Summons the monster.
 */
export async function performFusionSummon(
  ctx: Ctx,
  fusionFilter: (c: CardInstance) => boolean,
  pool: CardInstance[],
  dest: 'grave' | 'banished' = 'grave',
): Promise<CardInstance | null> {
  const opts = fusionOptions(ctx, fusionFilter, pool);
  if (!opts.length) return null;
  const isHuman = ctx.game.controllers[ctx.player].isHuman;
  const fusions = opts.map((o) => o.fusion);
  const pick = await ctx.select(fusions, 1, 1, 'Choose a Fusion Monster to Fusion Summon.', 'specialSummon', {
    aiScore: (f) => bestCombo(ctx, opts.find((o) => o.fusion === f)!).gain,
  });
  if (!pick.length) return null;
  const opt = opts.find((o) => o.fusion === pick[0])!;
  let mats: CardInstance[] | null;
  if (isHuman) mats = await ctx.game.pickCombo(ctx.player, opt.combos, `Select Fusion Materials for ${opt.fusion.name}`);
  else mats = bestCombo(ctx, opt).combo;
  if (!mats || !mats.length) return null;
  ctx.log(`${ctx.game.players[ctx.player].name} uses ${mats.map((m) => m.name).join(', ')} as Fusion Material for ${opt.fusion.name}.`);
  await ctx.game.moveCards(mats, dest, { reason: 'fusion', reasons: ['fusion', 'material'], reasonPlayer: ctx.player, reasonCard: opt.fusion });
  if (!ctx.canSpecialSummon()) return null;
  const r = await ctx.specialSummon(opt.fusion, { method: 'fusion', proper: true, pos: 'choose' });
  return r[0] ?? null;
}

/** Elemental HERO Fusion: "1 'HERO' monster + 1 <ATTRIBUTE> monster", must be Fusion Summoned. */
function heroFusion(
  name: string,
  attribute: 'WATER' | 'WIND' | 'EARTH' | 'LIGHT',
  race: 'Warrior',
  atk: number,
  def: number,
  text: string,
  effects: EffectDef[],
  aiValue = 600,
) {
  return monster(name, {
    attribute,
    race,
    level: 8,
    atk,
    def,
    types: ['fusion'],
    sets: HERO_SETS,
    nomi: true,
    aiValue,
    fusion: { materials: [isHero, attr(attribute)], desc: `1 "HERO" monster + 1 ${attribute} monster` },
    text: `1 "HERO" monster + 1 ${attribute} monster\nMust be Fusion Summoned. ${text}`,
    effects,
  });
}

// ============================================================ MAIN DECK HEROES

monster('Elemental Hero Stratos', {
  attribute: 'WIND',
  race: 'Warrior',
  level: 4,
  atk: 1800,
  def: 300,
  sets: HERO_SETS,
  aiValue: 900,
  text: 'When this card is Normal or Special Summoned: You can activate 1 of these effects. ● Destroy Spells/Traps on the field, up to the number of other "HERO" monsters you control. ● Add 1 "HERO" monster from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      when: true,
      label: 'Destroy Spells/Traps or search a HERO',
      categories: ['search', 'destroy'],
      eventFilter: selfSummoned('normal', 'special'),
      canActivate: (ctx) =>
        ctx.deck('me', isHero).length > 0 || (ctx.faceUpMonsters('me', (c) => c !== ctx.self && isHero(c)).length > 0 && ctx.spellTraps('both').length > 0),
      activate: async (ctx) => {
        const n = ctx.faceUpMonsters('me', (c) => c !== ctx.self && isHero(c)).length;
        const canDestroy = n > 0 && ctx.spellTraps('both').length > 0;
        const canSearch = ctx.deck('me', isHero).length > 0;
        const opts: string[] = [];
        if (canDestroy) opts.push(`Destroy up to ${n} Spell/Trap(s)`);
        if (canSearch) opts.push('Add 1 "HERO" from Deck to hand');
        const oppST = ctx.spellTraps('opp').length;
        const i = await ctx.option('Choose an effect for Elemental Hero Stratos.', opts, (k) => {
          if (opts[k].startsWith('Destroy')) return oppST ? 400 * Math.min(n, oppST) : -1;
          return 500;
        });
        ctx.data.mode = opts[i].startsWith('Destroy') ? 'destroy' : 'search';
      },
      resolve: async (ctx) => {
        if (ctx.data.mode === 'destroy') {
          const n = ctx.faceUpMonsters('me', (c) => c !== ctx.self && isHero(c)).length;
          if (!n) return;
          const sel = await ctx.select(ctx.spellTraps('both'), 1, n, `Destroy up to ${n} Spell/Trap card(s).`, 'destroy');
          if (sel.length) await ctx.destroy(sel);
          return;
        }
        if (ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck')) return;
        const hand = new Set(ctx.hand().map((c) => c.name));
        const sel = await ctx.select(ctx.deck('me', isHero), 1, 1, 'Add 1 "HERO" monster from your Deck to your hand.', 'toHand', {
          aiScore: (c) => {
            if (c.name === 'Elemental Hero Ocean' && !hand.has(c.name)) return 700;
            if (c.name === 'Elemental Hero Neos Alius') return 600 - (hand.has(c.name) ? 200 : 0);
            if (c.name === 'Elemental Hero Bubbleman') return ctx.hand().length <= 1 ? 800 : 100;
            return (c.data.atk ?? 0) / 10 - (hand.has(c.name) ? 300 : 0);
          },
        });
        if (sel.length) await ctx.toHand(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

monster('Elemental Hero Neos Alius', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 4,
  atk: 1900,
  def: 1300,
  types: ['gemini'],
  sets: HERO_SETS,
  aiValue: 100,
  text: 'Gemini: treated as a Normal Monster while face-up on the field or in the GY. While face-up on the field, you can Normal Summon it to have it become an Effect Monster with this effect. ● This card\'s name is treated as "Elemental Hero Neos" while it is face-up on the field.',
  effects: [
    {
      // The Gemini Summon is a Normal Summon, not an effect (Game.geminiSummon; no chain).
      kind: 'proc',
      geminiSummon: true,
      range: ['mzone'],
      label: 'Gemini Summon',
      categories: [],
      ai: {
        score: (ctx) => {
          // Only worth it when the Normal Summon would otherwise be wasted.
          if (ctx.phase !== 'main2') return 0;
          const canSummonOther = ctx.hand('me', (c) => c.isMonster && ctx.game.canNormalSummon(ctx.player, c)).length > 0;
          return canSummonOther ? 0 : 5;
        },
      },
    },
  ],
});

monster('Elemental Hero Wildheart', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 1500,
  def: 1600,
  sets: HERO_SETS,
  aiValue: 400,
  text: 'Unaffected by Trap effects.',
  effects: [{ kind: 'continuous', mods: [{ q: 'unaffectedByTraps', value: true }] }],
});

monster('Elemental Hero Bubbleman', {
  attribute: 'WATER',
  race: 'Warrior',
  level: 4,
  atk: 800,
  def: 1200,
  sets: HERO_SETS,
  aiValue: 500,
  text: 'If this is the only card in your hand, you can Special Summon it (from your hand). When this card is Normal, Flip, or Special Summoned: If you control no other cards and have no cards in your hand, you can draw 2 cards.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (only card in hand)',
      condition: (ctx) => ctx.hand().length === 1 && ctx.freeMZones() > 0,
      ai: { score: () => 72 },
    },
    {
      kind: 'trigger',
      event: 'summoned',
      when: true,
      label: 'Draw 2',
      categories: ['draw'],
      eventFilter: selfSummoned(),
      condition: (ctx) => ctx.hand().length === 0 && ctx.field('me', (c) => c !== ctx.self).length === 0,
      resolve: async (ctx) => {
        if (ctx.hand().length === 0 && ctx.field('me', (c) => c !== ctx.self).length === 0) await ctx.draw(2);
      },
    },
  ],
});

monster('Elemental Hero Ocean', {
  attribute: 'WATER',
  race: 'Warrior',
  level: 4,
  atk: 1500,
  def: 1200,
  sets: HERO_SETS,
  aiValue: 600,
  text: 'Once per turn, during your Standby Phase: You can return 1 "HERO" monster from your field or GY to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      opt: true,
      label: 'Return a HERO to hand',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.location === 'mzone',
      canActivate: (ctx) => ctx.grave('me', isHero).length > 0 || ctx.faceUpMonsters('me', isHero).length > 0,
      resolve: async (ctx) => {
        const cands = [...ctx.grave('me', isHero), ...ctx.faceUpMonsters('me', isHero)];
        const sel = await ctx.select(cands, 1, 1, 'Return 1 "HERO" monster from your field or GY to your hand.', 'toHand', {
          aiScore: (c) => (c.isExtra ? -2000 : c.location === 'grave' ? (c.data.aiValue ?? 0) + (c.data.atk ?? 0) : -3000),
        });
        if (sel.length) await ctx.toHand(sel);
      },
      ai: { score: (ctx) => (ctx.grave('me', (c) => isHero(c) && !c.isExtra).length ? 10 : 0) },
    },
  ],
});

monster('Elemental Hero Woodsman', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 1000,
  def: 2000,
  sets: HERO_SETS,
  aiValue: 300,
  text: 'Once per turn, during your Standby Phase: You can add 1 "Polymerization" from your Deck or GY to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      opt: true,
      label: 'Add Polymerization',
      categories: ['search', 'toHand'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.location === 'mzone',
      canActivate: (ctx) => ctx.cards('me', ['deck', 'grave'], (c) => c.name === 'Polymerization').length > 0,
      resolve: async (ctx) => {
        const blocked = ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck');
        const cands = ctx.cards('me', ['deck', 'grave'], (c) => c.name === 'Polymerization' && !(blocked && c.location === 'deck'));
        const sel = await ctx.select(cands, 1, 1, 'Add 1 "Polymerization" to your hand.', 'toHand', { aiScore: (c) => (c.location === 'grave' ? 1 : 0) });
        const fromDeck = sel.some((c) => c.location === 'deck');
        if (sel.length) await ctx.toHand(sel);
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
    },
  ],
});

const skyscraperOnField = (ctx: Ctx) =>
  [ctx.game.players[0].fzone, ctx.game.players[1].fzone].some((c) => !!c && c.faceUp && c.name === 'Skyscraper');

monster('Elemental Hero Captain Gold', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 4,
  atk: 2100,
  def: 800,
  sets: HERO_SETS,
  aiValue: 0,
  text: 'You can discard this card; add 1 "Skyscraper" from your Deck to your hand. If "Skyscraper" is not on the field, destroy this card.',
  effects: [
    {
      kind: 'ignition',
      range: ['hand'],
      label: 'Discard: search Skyscraper',
      categories: ['search', 'discard'],
      canActivate: (ctx) => ctx.deck('me', (c) => c.name === 'Skyscraper').length > 0,
      activate: async (ctx) => {
        await ctx.discard(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.search((c) => c.name === 'Skyscraper', 1, 'Add 1 "Skyscraper" to your hand.');
      },
      ai: { score: (ctx) => (ctx.hand('me', (c) => c.name === 'Skyscraper').length || skyscraperOnField(ctx) ? 0 : 40) },
    },
    {
      kind: 'trigger',
      event: ['summoned', 'leftField', 'phaseStart', 'positionChanged'],
      mandatory: true,
      label: 'Self-destruct (no Skyscraper)',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ctx.self.location === 'mzone' && ctx.self.faceUp && (ev.type !== 'summoned' || ev.card === ctx.self),
      condition: (ctx) => !skyscraperOnField(ctx),
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp && !skyscraperOnField(ctx)) await ctx.destroy(ctx.self);
      },
    },
  ],
});

normal('Elemental Hero Sparkman', 'LIGHT', 'Warrior', 4, 1600, 1400, 'An Elemental HERO who wields the power of light, striking foes with dazzling bolts.', HERO_SETS);
normal('Elemental Hero Clayman', 'EARTH', 'Warrior', 4, 800, 2000, 'An Elemental HERO with a body of rock-hard clay that shields his allies.', HERO_SETS);
normal('Elemental Hero Avian', 'WIND', 'Warrior', 3, 1000, 1000, 'A winged Elemental HERO who dives from the sky to strike his foes.', HERO_SETS);
normal('Elemental Hero Burstinatrix', 'FIRE', 'Warrior', 3, 1200, 800, 'A fiery Elemental HERO who scorches evil with blazing flames.', HERO_SETS);

// ============================================================ SPELLS

spell('E - Emergency Call', 'normal', {
  text: 'Add 1 "Elemental HERO" monster from your Deck to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['search'],
      canActivate: (ctx) => ctx.deck('me', isEHero).length > 0,
      resolve: async (ctx) => {
        const hand = new Set(ctx.hand().map((c) => c.name));
        const cands = ctx.deck('me', isEHero);
        const sel = await ctx.select(cands, 1, 1, 'Add 1 "Elemental HERO" monster from your Deck to your hand.', 'toHand', {
          aiScore: (c) => {
            if (c.name === 'Elemental Hero Stratos') return 1000;
            if (c.name === 'Elemental Hero Ocean' && !hand.has(c.name)) return 700;
            if (c.name === 'Elemental Hero Neos Alius') return 600 - (hand.has(c.name) ? 300 : 0);
            return (c.data.atk ?? 0) / 10 - (hand.has(c.name) ? 300 : 0);
          },
        });
        if (sel.length) await ctx.toHand(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 58 },
    },
  ],
});

/** Miracle Fusion's materials: your monsters, plus those in your GY unless GY cards cannot be banished (Necrovalley, Kycoo). */
const miracleMaterials = (ctx: Ctx) => [...ctx.monsters('me'), ...(ctx.game.gyBanishLocked(ctx.player) ? [] : ctx.grave('me', (c) => c.isMonster))];
spell('Miracle Fusion', 'normal', {
  text: 'Fusion Summon 1 "Elemental HERO" Fusion Monster from your Extra Deck by banishing Fusion Materials listed on it from your field or GY.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon', 'banish'],
      canActivate: (ctx) => fusionOptions(ctx, isEHero, miracleMaterials(ctx)).length > 0,
      resolve: async (ctx) => {
        await performFusionSummon(ctx, isEHero, miracleMaterials(ctx), 'banished');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase === 'main2' && ctx.isMyTurn) {
            // Prefer to fuse in Main Phase 1 so the Fusion can attack; still fine in Main 2 as a wall.
          }
          const opts = fusionOptions(ctx, isEHero, miracleMaterials(ctx));
          const gain = bestFusionGain(ctx, opts);
          if (gain >= 1500) return 66 + gain / 300;
          if (gain >= 600) return 45;
          return 0;
        },
      },
    },
  ],
});

/** Recursion guard: Skyscraper's ATK check reads ATK values. */
let skyscraperDepth = 0;
spell('Skyscraper', 'field', {
  text: 'When an "Elemental HERO" monster attacks a monster with higher ATK, the attacking monster gains 1000 ATK during damage calculation only.',
  effects: [
    { kind: 'activate', categories: ['atkChange'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isEHero).length || ctx.hand('me', isEHero).length ? 30 : 10) } },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (ctx, c) => {
            const b = ctx.game.battle;
            if (!b || !b.inDamageStep || b.attacker !== c || !b.target || !isFaceUpEHero(c)) return false;
            if (skyscraperDepth > 0) return false;
            skyscraperDepth++;
            try {
              return ctx.game.getAtk(c) < ctx.game.getAtk(b.target);
            } finally {
              skyscraperDepth--;
            }
          },
          value: 1000,
        },
      ],
    },
  ],
});

// ============================================================ TRAPS

trap('Hero Signal', 'normal', {
  text: 'When a monster you control is destroyed by battle and sent to the GY: Special Summon 1 Level 4 or lower "Elemental HERO" monster from your hand or Deck.',
  effects: [
    {
      kind: 'activate',
      event: 'battleDestroyed',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.fromController === ctx.player && (ev.card as CardInstance).location === 'grave',
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'deck'], (c) => isEHero(c) && (c.data.level ?? 0) <= 4).length > 0,
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon()) return;
        const cands = ctx.cards('me', ['hand', 'deck'], (c) => isEHero(c) && (c.data.level ?? 0) <= 4);
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower "Elemental HERO" from your hand or Deck.', 'specialSummon', {
          aiScore: (c) => (c.name === 'Elemental Hero Stratos' ? 4000 : c.name === 'Elemental Hero Captain Gold' && !skyscraperOnField(ctx) ? -1000 : (c.data.atk ?? 0) + (c.location === 'deck' ? 100 : 0)),
        });
        const fromDeck = sel.some((c) => c.location === 'deck');
        if (sel.length) await ctx.specialSummon(sel[0]);
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 60 },
    },
  ],
});

trap('Hero Barrier', 'normal', {
  text: 'When an opponent\'s monster declares an attack, while you control a face-up "Elemental HERO" monster: Negate the attack.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack'],
      eventFilter: (ctx, ev) => (ev.card as CardInstance).controller === ctx.opp,
      condition: (ctx) => !!ctx.battle && !ctx.battle.inDamageStep && ctx.faceUpMonsters('me', isEHero).length > 0,
      resolve: async (ctx) => {
        if (ctx.faceUpMonsters('me', isEHero).length) ctx.negateAttack();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const a = ctx.atk(b.attacker);
          if (!b.target) return a >= 1500 ? 50 : 0;
          const stat = b.target.faceUp ? (b.target.pos === 'atk' ? ctx.atk(b.target) : ctx.def(b.target)) : 1500;
          return a > stat ? 50 : 0;
        },
      },
    },
  ],
});

trap('A Hero Emerges', 'normal', {
  text: 'You can only activate this card when your opponent declares an attack. Your opponent selects 1 random card from your hand. If it is a Monster Card, Special Summon it on your side of the field. If not, send it to the Graveyard.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => (ev.card as CardInstance).controller === ctx.opp,
      condition: (ctx) => !!ctx.battle && !ctx.battle.inDamageStep,
      canActivate: (ctx) => ctx.hand().length > 0,
      resolve: async (ctx) => {
        const hand = ctx.hand();
        if (!hand.length) return;
        const c = hand[ctx.game.rng.int(hand.length)];
        ctx.log(`${ctx.game.players[ctx.opp].name} picks ${c.name} at random.`);
        c.revealedUntil = ctx.turn;
        // 2010 text/rulings: a card that is not Summoned (not a monster, a Special Summon-only or Spirit monster) is
        // sent to the Graveyard. https://edisonrul.ing/cards/a/a-hero-emerges.html
        if (c.isMonster && !c.data.cannotNormalSummon && !c.hasType('spirit') && ctx.canSummonCard(c)) await ctx.specialSummon(c);
        if (c.location === 'hand') await ctx.sendToGrave(c);
      },
      ai: {
        score: (ctx) => {
          const h = ctx.hand();
          if (!h.length) return 0;
          const good = h.filter((c) => c.isMonster && !c.data.cannotNormalSummon && (c.data.atk ?? 0) >= 1500).length;
          return good / h.length >= 0.5 ? 45 : 0;
        },
      },
    },
  ],
});

// ============================================================ FUSIONS

heroFusion(
  'Elemental Hero Absolute Zero',
  'WATER',
  'Warrior',
  2500,
  2000,
  'Gains 500 ATK for each face-up WATER monster on the field, except "Elemental Hero Absolute Zero". When this card leaves the field: Destroy all monsters your opponent controls.',
  [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) => 500 * ctx.faceUpMonsters('both', (c) => c !== ctx.self && c.name !== 'Elemental Hero Absolute Zero' && c.data.attribute === 'WATER').length,
        },
      ],
    },
    {
      kind: 'trigger',
      event: 'leftField',
      mandatory: true,
      label: 'Destroy all opponent\'s monsters',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.fromFaceUp === true,
      resolve: async (ctx) => {
        const opp = ctx.game.monsters(ctx.game.opp(ctx.player));
        if (opp.length) await ctx.destroy(opp);
      },
    },
  ],
  1200,
);

heroFusion(
  'Elemental Hero Great Tornado',
  'WIND',
  'Warrior',
  2800,
  2200,
  'When this card is Fusion Summoned: Halve the ATK and DEF of all face-up monsters your opponent controls.',
  [
    {
      kind: 'trigger',
      event: 'fusionSummoned',
      mandatory: true,
      label: 'Halve opponent\'s monsters',
      categories: ['atkChange'],
      eventFilter: selfSummoned('fusion'),
      resolve: async (ctx) => {
        for (const c of ctx.faceUpMonsters('opp')) {
          if (ctx.game.isUnaffected(c, ctx.self, ctx.player)) continue;
          const a = ctx.atk(c);
          const d = ctx.def(c);
          ctx.addTempMod(c, 'atk', -Math.ceil(a / 2), 'field');
          ctx.addTempMod(c, 'def', -Math.ceil(d / 2), 'field');
        }
      },
    },
  ],
  700,
);

// 2010 text and rulings: 1 "Elemental Hero" (not "Destiny Hero" / "Evil Hero") + 1 EARTH monster, and the Fusion
// Summon trigger is mandatory (it targets). https://edisonrul.ing/cards/e/elemental-hero-gaia.html
const gaia = heroFusion(
  'Elemental Hero Gaia',
  'EARTH',
  'Warrior',
  2200,
  2600,
  'When this card is Fusion Summoned, select 1 face-up monster your opponent controls. Until the end of this turn, that monster\'s ATK is halved and this card gains the same amount of ATK.',
  [
    {
      kind: 'trigger',
      event: 'fusionSummoned',
      mandatory: true,
      label: 'Halve 1 monster\'s ATK and steal it',
      categories: ['atkChange'],
      eventFilter: selfSummoned('fusion'),
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'target', {
          aiScore: (c) => ctx.atk(c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (!t.length) return;
        const lost = Math.ceil(ctx.atk(t[0]) / 2);
        ctx.addTempMod(t[0], 'atk', -lost, 'turn');
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', lost, 'turn');
      },
    },
  ],
  500,
);

gaia.fusion = { materials: [isEHero, attr('EARTH')], desc: '1 "Elemental Hero" monster + 1 EARTH monster' };
gaia.text = gaia.text.replace('1 "HERO" monster + 1 EARTH monster', '1 "Elemental Hero" monster + 1 EARTH monster');

heroFusion(
  'Elemental Hero The Shining',
  'LIGHT',
  'Warrior',
  2600,
  2100,
  'Gains 300 ATK for each of your banished "Elemental HERO" monsters. When this card is sent to the GY: You can add up to 2 of your banished "Elemental HERO" monsters to your hand.',
  [
    {
      kind: 'continuous',
      mods: [{ q: 'atk', value: (ctx) => 300 * ctx.banished('me', isEHero).length }],
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Add up to 2 banished Elemental HEROes',
      categories: ['toHand'],
      eventFilter: selfToGrave,
      canActivate: (ctx) => ctx.banished('me', (c) => isEHero(c) && !c.isExtra).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.banished('me', (c) => isEHero(c) && !c.isExtra);
        const sel = await ctx.select(cands, 1, 2, 'Add up to 2 banished "Elemental HERO" monsters to your hand.', 'toHand');
        if (sel.length) await ctx.toHand(sel);
      },
    },
  ],
  600,
);

monster('Elemental Hero Flame Wingman', {
  attribute: 'WIND',
  race: 'Warrior',
  level: 6,
  atk: 2100,
  def: 1200,
  types: ['fusion'],
  sets: HERO_SETS,
  nomi: true,
  aiValue: 400,
  fusion: { materials: [(c) => c.name === 'Elemental Hero Avian', (c) => c.name === 'Elemental Hero Burstinatrix'], desc: '"Elemental Hero Avian" + "Elemental Hero Burstinatrix"' },
  text: '"Elemental Hero Avian" + "Elemental Hero Burstinatrix"\nMust be Fusion Summoned. When this card destroys an opponent\'s monster by battle and sends it to the GY: Inflict damage to your opponent equal to that monster\'s original ATK.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Burn',
      categories: ['damage'],
      eventFilter: (ctx, ev) => selfDestroysByBattle(ctx, ev) && (ev.card as CardInstance).location === 'grave',
      resolve: async (ctx) => {
        const c = ctx.event?.card as CardInstance | undefined;
        if (c) await ctx.damage(ctx.opp, c.data.atk ?? 0);
      },
    },
  ],
});

monster('Elemental Hero Steam Healer', {
  attribute: 'WATER',
  race: 'Warrior',
  level: 5,
  atk: 1800,
  def: 1000,
  types: ['fusion'],
  sets: HERO_SETS,
  nomi: true,
  aiValue: 200,
  fusion: { materials: [(c) => c.name === 'Elemental Hero Burstinatrix', (c) => c.name === 'Elemental Hero Bubbleman'], desc: '"Elemental Hero Burstinatrix" + "Elemental Hero Bubbleman"' },
  text: '"Elemental Hero Burstinatrix" + "Elemental Hero Bubbleman"\nMust be Fusion Summoned. When this card destroys an opponent\'s monster by battle: Gain LP equal to that monster\'s original ATK.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Gain LP',
      categories: ['recover'],
      eventFilter: selfDestroysByBattle,
      resolve: async (ctx) => {
        const c = ctx.event?.card as CardInstance | undefined;
        if (c) await ctx.recover(ctx.player, c.data.atk ?? 0);
      },
    },
  ],
});
