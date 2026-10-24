// Card definitions: Plants & Synchron engine (Quickdraw Plant).
// Also exports a few small helpers shared by zombies.ts / lightsworn.ts (group A files).
import { monster, token } from '../define';
import { cardValue } from '../helpers';
import type { CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';

// =================================================================== shared helpers

/** Tribute cards as a cost (not for a Tribute Summon). Emits `tributed`. */
export async function tributeCost(ctx: Ctx, cards: CardInstance[]) {
  return ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}

/** Monsters this player can Tribute as a cost. */
export function tributable(ctx: Ctx, filter: (c: CardInstance) => boolean = () => true) {
  return ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed') && filter(c));
}

/**
 * Synchro Monsters in this player's Extra Deck that could be Synchro Summoned if the
 * hypothetical monsters in `add` were face-up on the field (and `remove` were gone).
 * Uses plain level sums; used only for AI hints.
 */
export function synchroOptions(ctx: Ctx, add: { card: CardInstance; level?: number }[] = [], remove: CardInstance[] = []): CardInstance[] {
  type M = { card: CardInstance; level: number };
  const mons: M[] = ctx
    .faceUpMonsters('me', (c) => !remove.includes(c) && !ctx.query(c, 'cannotBeSynchroMaterial') && !c.flags.noSynchroMaterial)
    .map((c) => ({ card: c, level: ctx.level(c) }));
  for (const a of add) if (!mons.some((m) => m.card === a.card)) mons.push({ card: a.card, level: a.level ?? a.card.data.level ?? 0 });
  if (mons.length < 2) return [];
  const out: CardInstance[] = [];
  const seen = new Set<string>();
  for (const s of ctx.extra()) {
    if (!s.hasType('synchro') || seen.has(s.name)) continue;
    const req = s.data.synchro;
    if (!req) continue;
    const lv = s.data.level ?? 0;
    let ok = false;
    for (const t of mons) {
      if (ok) break;
      if (!t.card.isTuner || (req.tuner && !req.tuner(t.card))) continue;
      const nonT = mons.filter((m) => m !== t && !m.card.isTuner && (!req.nonTuner || req.nonTuner(m.card))).slice(0, 10);
      const minN = req.minNonTuners ?? 1;
      const maxN = req.maxNonTuners ?? 99;
      for (let mask = 1; mask < 1 << nonT.length && !ok; mask++) {
        const sel = nonT.filter((_, i) => mask & (1 << i));
        if (sel.length < minN || sel.length > maxN) continue;
        if (t.level + sel.reduce((a, m) => a + m.level, 0) !== lv) continue;
        const combo = [t.card, ...sel.map((m) => m.card)];
        if (combo.some((c) => c.data.synchroMaterialCheck && !c.data.synchroMaterialCheck(s, combo, c))) continue;
        ok = true;
      }
    }
    if (ok) {
      seen.add(s.name);
      out.push(s);
    }
  }
  return out;
}

/** Best (highest ATK + aiValue) synchro reachable, 0 if none. */
export function bestSynchroValue(ctx: Ctx, add: { card: CardInstance; level?: number }[] = [], remove: CardInstance[] = []) {
  return Math.max(0, ...synchroOptions(ctx, add, remove).map((s) => (s.data.atk ?? 0) + (s.data.aiValue ?? 0)));
}

/**
 * Gemini support: the engine has no Gemini Summon action, so a Gemini monster gets an
 * ignition effect that uses the player's Normal Summon to become an Effect Monster
 * (approximation: it starts a chain instead of being a summon).
 */
export function geminiSummonEffect(): EffectDef {
  return {
    kind: 'ignition',
    label: 'Gemini Summon (Normal Summon again)',
    categories: [],
    condition: (ctx) => !ctx.self.flags.geminiSummoned && ctx.game.players[ctx.player].normalSummonsLeft > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotNormalSummon'),
    activate: async (ctx) => {
      ctx.game.players[ctx.player].normalSummonsLeft--;
    },
    resolve: async (ctx) => {
      if (ctx.self.location === 'mzone' && ctx.self.faceUp) {
        ctx.self.flags.geminiSummoned = true;
        ctx.log(`${ctx.self.name} is Gemini Summoned and becomes an Effect Monster.`);
      }
    },
    ai: { score: () => 58 },
  };
}
export const isGeminiActive = (ctx: Ctx) => !!ctx.self.flags.geminiSummoned;

/** Like ctx.search but with an AI preference. */
export async function searchScored(ctx: Ctx, filter: (c: CardInstance) => boolean, prompt: string, aiScore: (c: CardInstance) => number) {
  if (ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck')) return [];
  const cands = ctx.deck('me', filter);
  const sel = await ctx.select(cands, 1, 1, prompt, 'toHand', { aiScore });
  const r = sel.length ? await ctx.toHand(sel) : [];
  ctx.game.shuffleDeck(ctx.player);
  if (r.length) await ctx.game.anim({ type: 'reveal', cards: r.map((c) => c.uid), player: ctx.player });
  return r;
}

/** Does the Synchro Monster list a "Synchron" Tuner as material? */
export function listsSynchron(synchro: CardInstance) {
  const desc = synchro.data.synchro?.desc ?? '';
  const firstLine = (synchro.data.text ?? '').split('\n')[0];
  return /Synchron/.test(desc) || /Synchron/.test(firstLine);
}

const isPlant = (c: CardInstance) => c.isMonster && c.data.race === 'Plant';

// =================================================================== tokens

const fluff = token('Fluff Token', 'WIND', 'Plant', 1, 0, 0, 'Fluff Token (Plant/WIND/Level 1/ATK 0/DEF 0). Cannot be Tributed for a Tribute Summon the turn it is Special Summoned.');

// =================================================================== monsters

monster('Dandylion', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 3,
  atk: 300,
  def: 300,
  text: 'If this card is sent to the GY: Special Summon 2 "Fluff Tokens" (Plant/WIND/Level 1/ATK 0/DEF 0) in Defense Position. They cannot be Tributed for a Tribute Summon during the turn they are Special Summoned.',
  aiValue: 700,
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Summon 2 Fluff Tokens',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.to === 'grave',
      condition: (ctx) => ctx.canSpecialSummon() && ctx.freeMZones() >= 2,
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon() || ctx.freeMZones() < 2) return;
        const toks = await ctx.createTokens(fluff, 2, 'def');
        for (const t of toks) {
          t.flags.noTributeSummonFodder = true;
          const id = t.moveId;
          ctx.later('end', async () => {
            if (t.location === 'mzone' && t.moveId === id) delete t.flags.noTributeSummonFodder;
          });
        }
      },
    },
  ],
});

/** How happy Lonefire is to Tribute this card. */
function lonefireTributeScore(ctx: Ctx, c: CardInstance) {
  if (c.name === 'Fluff Token') return 1000;
  if (c.name === 'Dandylion') return ctx.freeMZones() >= 1 ? 900 : 300;
  if (c.name === 'Lonefire Blossom') return c === ctx.self ? 500 : 450;
  if (c.name === 'Copy Plant') return 300;
  if (c.isToken) return 800;
  return -cardValue(ctx.game, c);
}

function lonefireFetchScore(ctx: Ctx, c: CardInstance) {
  const fieldNames = ctx.monsters('me').map((m) => m.name);
  const fodder = ctx.monsters('me', (m) => m.name === 'Fluff Token' || m.name === 'Dandylion').length;
  const freshLonefire = ctx.faceUpMonsters('me', (m) => m.name === 'Lonefire Blossom' && m !== ctx.self && !ctx.game.isOptUsed(`soft:${m.uid}:0`)).length;
  switch (c.name) {
    case 'Tytannial, Princess of Camellias':
      return 700 + (fodder ? 100 : 0);
    case 'Dandylion':
      return freshLonefire ? 950 : fieldNames.includes('Dandylion') ? 400 : 600;
    case 'Lonefire Blossom':
      return fodder ? 850 : 650;
    case 'Gigaplant':
      return 500;
    case 'Copy Plant':
      return 250;
    default:
      return (c.data.atk ?? 0) / 10;
  }
}

monster('Lonefire Blossom', {
  attribute: 'FIRE',
  race: 'Plant',
  level: 3,
  atk: 500,
  def: 1400,
  text: 'Once per turn: You can Tribute 1 face-up Plant-Type monster; Special Summon 1 Plant-Type monster from your Deck.',
  aiValue: 800,
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Tribute a Plant: summon a Plant from Deck',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') &&
        tributable(ctx, (c) => c.faceUp && isPlant(c)).length > 0 &&
        ctx.deck('me', isPlant).length > 0,
      activate: async (ctx) => {
        const cands = tributable(ctx, (c) => c.faceUp && isPlant(c));
        const sel = await ctx.select(cands, 1, 1, 'Tribute 1 face-up Plant-Type monster.', 'tribute', { aiScore: (c) => lonefireTributeScore(ctx, c) });
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        if (!ctx.canSpecialSummon()) return;
        const sel = await ctx.select(ctx.deck('me', isPlant), 1, 1, 'Special Summon 1 Plant-Type monster from your Deck.', 'specialSummon', {
          aiScore: (c) => lonefireFetchScore(ctx, c),
        });
        if (sel.length) await ctx.specialSummon(sel[0]);
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          const cands = tributable(ctx, (c) => c.faceUp && isPlant(c));
          const best = Math.max(...cands.map((c) => lonefireTributeScore(ctx, c)));
          if (best < 0) return 0;
          return best >= 900 ? 72 : 62;
        },
      },
    },
  ],
});

/** Quickdraw Synchron: what to send from the hand (higher = better to send). */
function quickdrawCostScore(ctx: Ctx, c: CardInstance) {
  const darks = ctx.grave('me', (g) => g.isMonster && g.data.attribute === 'DARK').length;
  const dadInHand = ctx.hand('me', (h) => h.name === 'Dark Armed Dragon').length > 0;
  let s = 0;
  switch (c.name) {
    case 'Dandylion':
      s = 1000;
      break;
    case 'Level Eater':
      s = 850;
      break;
    case 'Plaguespreader Zombie':
      s = 800;
      break;
    case 'Lonefire Blossom':
      s = ctx.hand('me', (h) => h.name === 'Debris Dragon').length ? 700 : 300;
      break;
    case 'Quickdraw Synchron':
      s = 450;
      break;
    case 'Necro Gardna':
      s = 750;
      break;
    case 'Dark Armed Dragon':
      s = -2000;
      break;
    default:
      s = -cardValue(ctx.game, c) / 4;
  }
  if (dadInHand && c.data.attribute === 'DARK' && c.name !== 'Dark Armed Dragon') s += darks < 3 ? 150 : -300;
  return s;
}

const quickdraw = monster('Quickdraw Synchron', {
  attribute: 'WIND',
  race: 'Machine',
  level: 5,
  atk: 700,
  def: 1400,
  types: ['tuner'],
  sets: ['synchron'],
  text: 'You can Special Summon this card (from your hand) by sending 1 monster from your hand to the GY. This card can be used as a substitute for any 1 "Synchron" Tuner for a Synchro Summon. Cannot be used as Synchro Material, except for the Synchro Summon of a monster that lists a "Synchron" Tuner as material.',
  aiValue: 500,
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (send 1 monster from hand)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.hand('me', (c) => c.isMonster && c !== ctx.self).length > 0,
      perform: async (ctx) => {
        const cands = ctx.hand('me', (c) => c.isMonster && c !== ctx.self);
        const sel = await ctx.select(cands, 1, 1, 'Send 1 monster from your hand to the GY.', 'cost', { cancelable: true, aiScore: (c) => quickdrawCostScore(ctx, c) });
        if (!sel.length) return false;
        await ctx.sendToGrave(sel, 'cost');
        return true;
      },
      ai: {
        score: (ctx) => {
          const cands = ctx.hand('me', (c) => c.isMonster && c !== ctx.self);
          if (!cands.length) return 0;
          const best = Math.max(...cands.map((c) => quickdrawCostScore(ctx, c)));
          if (best >= 1000) return 82;
          if (best >= 700) return 74;
          if (best >= 400) return 60;
          // Only dump a real card if it turns into a Synchro right away.
          return synchroOptions(ctx, [{ card: ctx.self }]).length ? 55 : 0;
        },
      },
    },
  ],
});

// MonsterOpts has no synchroMaterialCheck field yet (see docs/engine-requests/group-a.md), so set it on the data.
quickdraw.synchroMaterialCheck = (synchro) => listsSynchron(synchro);

/** Debris Dragon revive target score. */
function debrisTargetScore(ctx: Ctx, c: CardInstance) {
  const lv = c.data.level ?? 0;
  let s = (c.data.atk ?? 0) / 10;
  if (c.name === 'Dandylion') s += 1000;
  if (!c.isTuner && lv !== 4 && (lv === 3 || lv === 4)) s += 600; // Debris(4)+3 = 7 Dragon Synchro
  if (c.isTuner) s -= 500; // two tuners don't synchro together
  if (lv === 4) s -= 400; // Debris can't synchro with Level 4s
  return s;
}

const debris = monster('Debris Dragon', {
  attribute: 'WIND',
  race: 'Dragon',
  level: 4,
  atk: 1000,
  def: 2000,
  types: ['tuner'],
  text: 'When this card is Normal Summoned: You can target 1 monster with 500 or less ATK in your GY; Special Summon it in Attack Position, but its effects are negated. Cannot be used as Synchro Material, except for the Synchro Summon of a Dragon-Type monster; the other Synchro Materials cannot be Level 4 monsters.',
  aiValue: 600,
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Revive a 500-or-less ATK monster',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      condition: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c.isMonster && (c.data.atk ?? 0) <= 500 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && (c.data.atk ?? 0) <= 500 && ctx.canSummonCard(c)), 1, 1, 'Target 1 monster with 500 or less ATK in your GY.', 'specialSummon', {
          aiScore: (c) => debrisTargetScore(ctx, c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (!t.length) return;
        const r = await ctx.specialSummon(t[0], { pos: 'atk' });
        for (const c of r) ctx.negateEffects(c, 'field');
      },
    },
  ],
});

debris.synchroMaterialCheck = (synchro, materials, self) =>
  synchro.data.race === 'Dragon' && materials.every((m) => m === self || (m.flags.baseLevel ?? m.data.level ?? 0) !== 4);

monster('Level Eater', {
  attribute: 'DARK',
  race: 'Insect',
  level: 1,
  atk: 600,
  def: 0,
  text: 'If this card is in your GY: You can target 1 Level 5 or higher monster you control; reduce its Level by 1, and if you do, Special Summon this card.',
  aiValue: 500,
  effects: [
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Lower a Level, revive itself',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.faceUpMonsters('me', (c) => ctx.level(c) >= 5 && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => ctx.level(c) >= 5), 1, 1, 'Target 1 Level 5 or higher monster you control.', 'target', {
          aiScore: (c) => (c.isExtra ? 300 : 0) + (c.isTuner ? -200 : 100) + (c.name === 'Quickdraw Synchron' ? 150 : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && ctx.level(c) >= 5);
        if (!t.length || ctx.self.location !== 'grave') return;
        ctx.addTempMod(t[0], 'level', -1, 'field');
        const oppBest = Math.max(0, ...ctx.faceUpMonsters('opp', (m) => m.pos === 'atk').map((m) => ctx.atk(m)));
        await ctx.specialSummon(ctx.self, { pos: oppBest > 600 ? 'def' : 'choose' });
      },
      ai: {
        score: (ctx) => {
          if (ctx.freeMZones() <= 0) return 0;
          if (synchroOptions(ctx, [{ card: ctx.self }]).length) return 66;
          // A spare tuner in hand turns the extra body into a synchro next.
          if (ctx.hand('me', (h) => h.isTuner && !h.data.cannotNormalSummon).length && ctx.game.players[ctx.player].normalSummonsLeft > 0) return 40;
          // Otherwise only as a free attacker / blocker.
          return ctx.monsters('opp').length === 0 && ctx.phase === 'main1' && ctx.turn > 1 ? 25 : 0;
        },
      },
    },
  ],
});

monster('Junk Synchron', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 3,
  atk: 1300,
  def: 500,
  types: ['tuner'],
  sets: ['synchron'],
  text: 'When this card is Normal Summoned: You can target 1 Level 2 or lower monster in your GY; Special Summon it in Defense Position, but its effects are negated.',
  aiValue: 500,
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Revive a Level 2 or lower monster',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      condition: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c.isMonster && (c.data.level ?? 0) <= 2 && !c.isExtra && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && (c.data.level ?? 0) <= 2 && !c.isExtra && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 2 or lower monster in your GY.', 'specialSummon', {
          aiScore: (c) => (c.isTuner ? -500 : 0) + (c.data.atk ?? 0) / 10 + (c.data.level ?? 0) * 100,
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (!t.length) return;
        const r = await ctx.specialSummon(t[0], { pos: 'def' });
        for (const c of r) ctx.negateEffects(c, 'field');
      },
    },
  ],
});

monster('Tytannial, Princess of Camellias', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 8,
  atk: 2800,
  def: 2600,
  text: 'When a card or effect is activated that targets a face-up Plant-Type monster(s) on the field: You can Tribute 1 face-up Plant-Type monster; negate the activation, and if you do, destroy that card.',
  aiValue: 600,
  effects: [
    {
      kind: 'quick',
      label: 'Tribute a Plant: negate',
      categories: ['negate'],
      damageStep: true,
      condition: (ctx) => {
        const l = ctx.prevLink();
        if (!l || l.card === ctx.self) return false;
        return l.ctx.targets.some((t) => t.location === 'mzone' && t.faceUp && isPlant(t));
      },
      canActivate: (ctx) => tributable(ctx, (c) => c.faceUp && isPlant(c)).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => c.faceUp && isPlant(c)), 1, 1, 'Tribute 1 face-up Plant-Type monster.', 'tribute', {
          aiScore: (c) => (c === ctx.self ? -3000 : -cardValue(ctx.game, c)),
        });
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.prevLink());
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp) return 0;
          const targets = l.ctx.targets.filter((t) => t.controller === ctx.player);
          if (!targets.length) return 0;
          const others = tributable(ctx, (c) => c.faceUp && isPlant(c) && c !== ctx.self && !targets.includes(c));
          return others.length || targets.includes(ctx.self) ? 80 : 40;
        },
      },
    },
  ],
});

monster('Gigaplant', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 6,
  atk: 2400,
  def: 1200,
  types: ['gemini'],
  text: 'Gemini: treated as a Normal Monster while face-up on the field or in the GY; you can Normal Summon it again to make it an Effect Monster with this effect.\nOnce per turn: You can Special Summon 1 Insect-Type or Plant-Type monster from your hand or GY.',
  aiValue: 300,
  effects: [
    geminiSummonEffect(),
    {
      kind: 'ignition',
      opt: true,
      label: 'Summon an Insect/Plant from hand or GY',
      categories: ['specialSummon'],
      condition: isGeminiActive,
      canActivate: (ctx) =>
        ctx.canSpecialSummon() &&
        ctx.cards('me', ['hand', 'grave'], (c) => c.isMonster && (c.data.race === 'Insect' || c.data.race === 'Plant') && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['hand', 'grave'], (c) => c.isMonster && (c.data.race === 'Insect' || c.data.race === 'Plant') && ctx.canSummonCard(c));
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Insect or Plant monster from your hand or GY.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0]);
      },
      ai: { score: () => 60 },
    },
  ],
});

monster('Nettles', {
  attribute: 'WATER',
  race: 'Plant',
  level: 2,
  atk: 1200,
  def: 400,
  text: 'If a face-up Plant-Type monster you control would be destroyed, you can return this face-up card to the hand instead.',
  aiValue: 200,
  // Approximation (no destruction-replacement hook in the engine): Nettles can be returned
  // to the hand in response to an opponent's destruction effect targeting another Plant, or when
  // a Plant is attacked, making that Plant indestructible for the rest of the turn.
  effects: [
    {
      kind: 'quick',
      label: 'Return to hand: protect a Plant',
      categories: ['protect'],
      damageStep: true,
      condition: (ctx) => {
        const l = ctx.prevLink();
        if (l && l.player === ctx.opp && (l.effect.categories ?? []).includes('destroy')) {
          return l.ctx.targets.some((t) => t !== ctx.self && t.controller === ctx.player && t.faceUpMonster && isPlant(t));
        }
        const b = ctx.battle;
        return !l && !!b && !!b.target && b.target !== ctx.self && b.target.controller === ctx.player && b.target.faceUp && isPlant(b.target) && !b.inDamageStep;
      },
      activate: async (ctx) => {
        const l = ctx.prevLink();
        ctx.data.protect = l ? l.ctx.targets.filter((t) => t !== ctx.self && t.controller === ctx.player && t.faceUpMonster && isPlant(t)) : [ctx.battle!.target];
      },
      resolve: async (ctx) => {
        if (!(ctx.self.location === 'mzone' && ctx.self.faceUp)) return;
        await ctx.toHand(ctx.self);
        for (const c of ctx.data.protect as CardInstance[]) {
          if (c.location !== 'mzone') continue;
          ctx.addTempMod(c, 'indestructibleEffect', true, 'turn');
          ctx.addTempMod(c, 'indestructibleBattle', true, 'turn');
        }
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          const prot: CardInstance[] = l ? l.ctx.targets : ctx.battle?.target ? [ctx.battle.target] : [];
          return prot.some((c) => c.controller === ctx.player && cardValue(ctx.game, c) >= 1500) ? 60 : 0;
        },
      },
    },
  ],
});

monster('Copy Plant', {
  attribute: 'WIND',
  race: 'Plant',
  level: 1,
  atk: 0,
  def: 0,
  types: ['tuner'],
  text: 'Once per turn: You can target 1 Plant-Type monster on the field; this card\'s Level becomes that monster\'s current Level until the End Phase.',
  aiValue: 100,
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Copy a Plant\'s Level',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => c !== ctx.self && isPlant(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => c !== ctx.self && isPlant(c)), 1, 1, 'Target 1 Plant-Type monster on the field.', 'target', {
          aiScore: (c) => (c.controller === ctx.player ? 0 : 100) + ctx.level(c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.faceUpMonster);
        if (!t.length || !ctx.self.faceUpMonster) return;
        const delta = ctx.level(t[0]) - ctx.level(ctx.self);
        if (delta) ctx.addTempMod(ctx.self, 'level', delta, 'turn');
      },
      ai: {
        score: (ctx) => {
          const now = synchroOptions(ctx).length;
          for (const t of ctx.faceUpMonsters('both', (c) => c !== ctx.self && isPlant(c))) {
            if (synchroOptions(ctx, [{ card: ctx.self, level: ctx.level(t) }], [ctx.self]).length > now) return 50;
          }
          return 0;
        },
      },
    },
  ],
});

export const PLANTS_LOADED = true;
