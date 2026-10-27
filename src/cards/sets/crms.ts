// Card definitions: Crimson Crisis (CRMS, March 2009 TCG core booster).
// Every CRMS card that no other set file defines. Card text, stats and types come from the YGOJSON v1
// aggregate (official English text); behaviour follows the 2010 TCG rulings as far as the engine allows.
// Approximations are marked "APPROX:".
//
// Rules the engine has no hook for are added as small per-game wrappers installed once per game by
// `ensureCrmsPatches` (same pattern as `ensureAnprPatches` in anpr.ts and `patchGame` in traps.ts):
//  * Flying Fortress SKY FIRE: a response window after the opponent Sets a Spell/Trap;
//  * Night Wing Sorceress: "Assault Mode Activate" can be activated the turn it is Set;
//  * Hydra Viper: Tribute 1 Aqua-Type monster as a cost each time it declares an attack;
//  * Dimension Fortress Weapon: cards cannot be sent from the Deck to the GY;
//  * Star Blast: Level reduction of a monster in the hand (Level and Tributes needed);
//  * Ido the Supreme Magical Force: no Summons / Sets; Ido and Alien Overlord: only 1 face-up copy;
//  * Spirit Force: no battle damage for that battle;
//  * Prevention Star: remembers monsters changed from face-up Attack to face-up Defense Position;
//  * Dark Voltanis: remembers Counter Traps that resolved (not negated).
// A-Counters live in `card.counters.A`.
import { monster, spell, token, trap } from '../define';
import { bestTarget, cardValue } from '../helpers';
import type { CardData, CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { Action, Activation } from '../../engine/controller';
import type { ChainLink, Game } from '../../engine/game';
import type { Attribute, BattlePos, GameEvent, Location, PlayerId, Race, Reason } from '../../engine/types';

type C = CardInstance;

// =================================================================== shared helpers

const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const evc = (ev: GameEvent) => ev.card as C | undefined;
const evo = (ev: GameEvent) => ev.other as C | undefined;
const reasonsOf = (ev: GameEvent): Reason[] => ev.reasons ?? (ev.reason ? [ev.reason] : []);
const raceIs = (c: C, ...r: Race[]) => c.isMonster && r.includes(c.data.race as Race);
const attrIs = (c: C, ...a: Attribute[]) => c.isMonster && a.includes(c.data.attribute as Attribute);
const lvl = (c: C) => c.data.level ?? 0;
const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
/** This Spell/Trap is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
/** This monster is face-up on the field and not negated. */
const monActive = (ctx: Ctx) => faceUpOn(ctx.self) && !ctx.game.isNegated(ctx.self);
const isMain = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';
/** Turn offset of this player's next turn (for ctx.later). */
const nextOwnTurn = (ctx: Ctx) => (ctx.isMyTurn ? 2 : 1);
const tributable = (ctx: Ctx, f: (c: C) => boolean = () => true) => ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed') && f(c));
const noChain = (ctx: Ctx) => ctx.game.chain.length === 0;
const myOpenMain = (ctx: Ctx) => ctx.isMyTurn && noChain(ctx) && !ctx.battle && isMain(ctx);

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

/** Events since the start of the current turn's Draw Phase. */
function eventsThisTurn(g: Game): GameEvent[] {
  const log = g.eventLog;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'phaseStart' && e.phase === 'draw') return log.slice(i);
  }
  return log;
}

/** Monster battling `self` in the current battle. */
function battleOpponent(ctx: Ctx, self: C = ctx.self): C | null {
  const b = ctx.battle;
  if (!b) return null;
  if (b.attacker === self) return b.target;
  if (b.target === self) return b.attacker;
  return null;
}

/** Special Summon from the Deck (non-targeting), shuffling afterwards. */
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

/** "Destroy it during the End Phase" for a summoned monster. */
function destroyAtEnd(ctx: Ctx, c: C) {
  const mid = c.moveId;
  ctx.later('end', async () => {
    if (c.location === 'mzone' && c.moveId === mid) await ctx.game.destroy([c], 'effect', ctx.player, ctx.self);
  });
}

/** Per-trigger guard so a side-effect listener only counts once per event batch. */
function oncePerBatch(card: C, key: string, ev: GameEvent) {
  const k = `crmsBatch:${key}`;
  if (card.flags[k] === ev.batch) return false;
  card.flags[k] = ev.batch;
  return true;
}

// ---------------------------------------------------------------- per-instance data overrides
// APPROX: the engine has no Name/Type/Attribute-change hook. Like abpf.ts, these cards shadow a card instance's
// `data` with a modified copy while a condition holds (Scanner, Psychic Tuning, Ivy Shackles). The real CardData
// is never modified. An existing override (e.g. from abpf.ts) is kept underneath.
type DataPatch = (orig: CardData, card: C) => CardData | undefined;
const dataPatches = new WeakSet<C>();
function patchData(card: C, fn: DataPatch) {
  // Engine API (CardInstance.addDataPatch): patches from every set compose in order, under the engine's rule view.
  dataPatches.add(card);
  card.addDataPatch(fn);
}
const variants = new WeakMap<CardData, Map<string, CardData>>();
function variant(orig: CardData, key: string, change: Partial<CardData>): CardData {
  let m = variants.get(orig);
  if (!m) variants.set(orig, (m = new Map()));
  let v = m.get(key);
  if (!v) m.set(key, (v = { ...orig, ...change }));
  return v;
}

// ---------------------------------------------------------------- names & archetypes

const AMA = 'Assault Mode Activate';
const SK = 'Summon Reactor・SK';
const YFI = 'Trap Reactor・Y FI';
const RE = 'Spell Reactor・RE';
const SKY_FIRE = 'Flying Fortress SKY FIRE';
const HYDRA = 'Hydra Viper';
const DFW = 'Dimension Fortress Weapon';
const IDO = 'Ido the Supreme Magical Force';
const OVERLORD = 'Alien Overlord';
const NIGHT_WING = 'Night Wing Sorceress';
const isAssault = (c: C) => c.isMonster && c.name.includes('/Assault Mode');
const isMorph = (c: C) => c.inSet('morphtronic') || c.name.startsWith('Morphtronic');
const isMorphMon = (c: C) => c.isMonster && isMorph(c);
const isAlien = (c: C) => c.isMonster && (c.inSet('alien') || c.name.startsWith('Alien '));
const isBW = (c: C) => c.isMonster && (c.inSet('blackwing') || c.name.startsWith('Blackwing'));
const isGBCard = (c: C) => c.inSet('gladiator') || c.name.startsWith('Gladiator Beast');
const isGBMon = (c: C) => c.isMonster && isGBCard(c);
const isSixSamurai = (c: C) => c.isMonster && (c.inSet('six-samurai') || c.name.includes('Six Samurai'));
const ASSAULT = ['assault-mode'];
const ALIEN = ['alien'];
const MORPH = ['morphtronic'];

// ---------------------------------------------------------------- A-Counters

const aCount = (c: C) => c.counters.A ?? 0;
function addA(ctx: Ctx, c: C, n = 1) {
  if (!c.onField) return;
  c.counters.A = aCount(c) + n;
  ctx.log(`${n} A-Counter(s) placed on ${c.faceUp ? c.name : 'a face-down card'}.`);
  ctx.game.update();
}
const aOnField = (g: Game) => g.allFieldCards().reduce((a, c) => a + aCount(c), 0);
/** Remove `n` A-Counters from anywhere on the field (cost). */
async function removeA(ctx: Ctx, n: number) {
  if (aOnField(ctx.game) < n) return false;
  for (let i = 0; i < n; i++) {
    const holders = ctx.game.allFieldCards().filter((c) => aCount(c) > 0);
    const [h] = await ctx.select(holders, 1, 1, 'Remove an A-Counter from which card?', 'cost', {
      // Counters on the opponent's monsters weaken them against Aliens: take them from my own cards first.
      aiScore: (c) => (ctx.mine(c) ? 100 : 0) + (c.isMonster ? 0 : 50) - aCount(c),
    });
    if (!h) return false;
    h.counters.A = aCount(h) - 1;
  }
  ctx.game.update();
  return true;
}
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

// ---------------------------------------------------------------- per-game rule patches

const PATCHED = new WeakSet<Game>();
/** Monsters changed from face-up Attack to face-up Defense Position: card → turn. */
const atkToDef = new WeakMap<C, { turn: number; moveId: number }>();
/** Battle position of a monster right before its latest changePosition call. */
const prevPos = new WeakMap<C, { pos: BattlePos; faceUp: boolean; moveId: number }>();
/** Counter Traps whose activation resolved: card → moveId at resolution. */
const resolvedCounter = new WeakMap<C, number>();
/** Star Blast: Level reduction of a monster in the hand. */
const starBlast = new WeakMap<C, { turn: number; moveId: number; n: number }>();

const faceUpActive = (g: Game, c: C) => c.location === 'mzone' && c.faceUp && !g.isNegated(c);
const controlsFaceUp = (g: Game, p: PlayerId, name: string) => g.monsters(p).some((c) => c.name === name && faceUpActive(g, c));
const dfwActive = (g: Game) => g.allFieldCards().some((c) => c.name === DFW && faceUpActive(g, c));
function starBlastCut(g: Game, c: C): number {
  const s = starBlast.get(c);
  if (!s || s.turn !== g.turn) return 0;
  if (c.location === 'hand' && c.moveId === s.moveId) return s.n;
  if (c.location === 'mzone' && c.moveId === s.moveId + 1) return s.n;
  return 0;
}

export function ensureCrmsPatches(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;

  // Flying Fortress SKY FIRE: response window after the opponent Sets a Spell/Trap Card.
  const origPerform = g.performAction.bind(g);
  anyG.performAction = async (p: PlayerId, a: Action) => {
    await origPerform(p, a);
    if (a.type === 'setST' && !g.over && a.card.onField) await skyFireOnSet(g, p, a.card);
  };

  // Night Wing Sorceress: "Assault Mode Activate" can be activated the turn it was Set.
  const origCAE = g.canActivateEffect.bind(g);
  anyG.canActivateEffect = (player: PlayerId, card: C, ef: EffectDef, idx: number, mode: { open: boolean; window?: any }) => {
    if (card.name === AMA && card.location === 'szone' && !card.faceUp && card.setTurn === g.turn && controlsFaceUp(g, player, NIGHT_WING)) {
      const st = card.setTurn;
      card.setTurn = -1;
      try {
        return origCAE(player, card, ef, idx, mode);
      } finally {
        card.setTurn = st;
      }
    }
    return origCAE(player, card, ef, idx, mode);
  };

  // Hydra Viper: Tribute 1 Aqua-Type monster each time it declares an attack (cost of the attack).
  const origAttack = g.conductAttack.bind(g);
  anyG.conductAttack = async (p: PlayerId, attacker: C) => {
    if (attacker.name === HYDRA && faceUpActive(g, attacker)) {
      const aquas = g.monsters(p).filter((c) => c.data.race === 'Aqua' && !g.queryCard(c, 'cannotBeTributed'));
      if (!aquas.length) return;
      const sel = await g.select(p, aquas, 1, 1, 'Tribute 1 Aqua-Type monster to attack with Hydra Viper.', 'tribute');
      if (!sel.length) return;
      g.log(`${g.players[p].name} Tributes ${sel[0].name} for Hydra Viper's attack.`, 'action', p);
      await g.moveCards(sel, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: p, reasonCard: attacker });
      if (!faceUpActive(g, attacker) || attacker.pos !== 'atk') return;
    }
    return origAttack(p, attacker);
  };

  // Dimension Fortress Weapon: cards cannot be sent from the Deck to the GY.
  const origMove = g.moveCards.bind(g);
  anyG.moveCards = async (cards: C[], to: Location, opts: any) => {
    if (to === 'grave' && cards.some((c) => c.location === 'deck') && dfwActive(g)) {
      const rest = cards.filter((c) => c.location !== 'deck');
      if (rest.length < cards.length) g.log('Dimension Fortress Weapon: cards cannot be sent from the Deck to the GY.', 'info');
      if (!rest.length) return [];
      return origMove(rest, to, opts);
    }
    return origMove(cards, to, opts);
  };

  // Star Blast: reduced Level in the hand (and after it is Summoned from there, until the End Phase).
  const origLevel = g.getLevel.bind(g);
  anyG.getLevel = (card: C) => {
    const n = starBlastCut(g, card);
    const base = origLevel(card);
    return n ? Math.max(1, base - n) : base;
  };
  const origNeed = g.tributesNeeded.bind(g);
  anyG.tributesNeeded = (card: C) => {
    const n = starBlastCut(g, card);
    if (!n || card.location !== 'hand' || card.flags.noTribute) return origNeed(card);
    const lv = Math.max(1, lvl(card) - n);
    return lv >= 7 ? 2 : lv >= 5 ? 1 : 0;
  };

  // Ido the Supreme Magical Force (no Summons/Sets) and the "only 1 face-up" monsters.
  const origCanNS = g.canNormalSummon.bind(g);
  anyG.canNormalSummon = (p: PlayerId, card: C, set = false) => {
    if (!origCanNS(p, card, set)) return false;
    if (controlsFaceUp(g, p, IDO)) return false;
    if (!set && (card.name === IDO || card.name === OVERLORD) && g.faceUpMonsters(p).some((c) => c.name === card.name)) return false;
    return true;
  };
  const origLegal = g.legalMainActions.bind(g);
  anyG.legalMainActions = (p: PlayerId) => {
    const acts: Action[] = origLegal(p);
    if (!controlsFaceUp(g, p, IDO)) return acts;
    return acts.filter((a) => !['summon', 'set', 'flip', 'proc', 'synchro'].includes(a.type));
  };

  // Spirit Force: the battle damage of that battle becomes 0.
  const origDamage = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: C, sourcePlayer?: PlayerId) => {
    const b = g.battle as any;
    if (kind === 'battle' && b && Array.isArray(b.crmsNoDamage) && b.crmsNoDamage.includes(p)) {
      g.log(`${g.players[p].name} takes no battle damage (Spirit Force).`, 'battle', p);
      return 0;
    }
    return origDamage(p, amount, kind, source, sourcePlayer);
  };

  // Prevention Star: remember "changed from face-up Attack Position to face-up Defense Position this turn".
  const origPos = g.changePosition.bind(g);
  anyG.changePosition = async (card: C, pos: BattlePos, faceUp = true, reasonPlayer?: PlayerId) => {
    const wasUpAtk = card.location === 'mzone' && card.faceUp && card.pos === 'atk';
    // Morphtronic Map: the position before this change (read while the 'positionChanged' event is emitted).
    if (card.location === 'mzone') prevPos.set(card, { pos: card.pos, faceUp: card.faceUp, moveId: card.moveId });
    await origPos(card, pos, faceUp, reasonPlayer);
    if (wasUpAtk && card.location === 'mzone' && card.faceUp && card.pos === 'def') atkToDef.set(card, { turn: g.turn, moveId: card.moveId });
  };

  // Dark Voltanis: "after a Counter Trap Card you control has been activated and has resolved".
  const origResolveLink = anyG.resolveLink.bind(g);
  anyG.resolveLink = async (link: ChainLink) => {
    await origResolveLink(link);
    if (link.isCardActivation && !link.negated && link.card.isTrap && link.card.data.ttype === 'counter') resolvedCounter.set(link.card, link.card.moveId);
  };
}

/** Installs the per-game patches at the first phase change (from any location, never activates). */
const PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  eventFilter: (ctx) => {
    ensureCrmsPatches(ctx.game);
    return false;
  },
};

// =================================================================== /Assault Mode monsters

/** "When this card on the field is destroyed, you can Special Summon 1 "<base>" from your Graveyard." */
function assaultRevive(base: string, targeted = false): EffectDef {
  const cands = (ctx: Ctx) => ctx.grave('me', (c) => c.name === base && ctx.canSummonCard(c));
  return {
    kind: 'trigger',
    event: 'destroyed',
    label: `Revive ${base}`,
    categories: ['specialSummon'],
    eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone',
    canActivate: (ctx) => ctx.canSpecialSummon() && cands(ctx).length > 0,
    activate: async (ctx) => {
      if (targeted) await ctx.selectTargets(cands(ctx), 1, 1, `Target 1 "${base}" in your GY.`, 'specialSummon');
    },
    resolve: async (ctx) => {
      const t = targeted ? ctx.validTargets((c) => c.location === 'grave')[0] : (await ctx.select(cands(ctx), 1, 1, `Special Summon 1 "${base}" from your GY.`, 'specialSummon'))[0];
      if (t && t.location === 'grave' && ctx.canSummonCard(t)) await ctx.specialSummon(t, { pos: 'choose' });
    },
  };
}

monster('Colossal Fighter/Assault Mode', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 10,
  atk: 3300,
  def: 1500,
  sets: ASSAULT,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1500,
  text: 'This card cannot be Normal Summoned or Set. This card cannot be Special Summoned except with "Assault Mode Activate". When this card is Special Summoned, you can send up to 2 Warrior-Type monsters from your Deck to the Graveyard. All monsters your opponent controls lose 100 ATK for every Warrior-Type monster in your Graveyard. When this card on the field is destroyed, you can Special Summon 1 "Colossal Fighter" from your Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      label: 'Send Warriors to the GY',
      categories: ['mill'],
      canActivate: (ctx) => ctx.deck('me', (c) => raceIs(c, 'Warrior')).length > 0,
      resolve: async (ctx) => {
        const sel = await ctx.select(ctx.deck('me', (c) => raceIs(c, 'Warrior')), 0, 2, 'Send up to 2 Warrior-Type monsters from your Deck to the GY.', 'buff', {
          aiScore: (c) => 100 - (c.data.aiValue ?? 0) / 10,
        });
        if (sel.length) await ctx.sendToGrave(sel);
        ctx.game.shuffleDeck(ctx.player);
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.opp,
          value: (ctx) => -100 * ctx.grave('me', (c) => raceIs(c, 'Warrior')).length,
        },
      ],
    },
    assaultRevive('Colossal Fighter'),
  ],
});

monster('Red Dragon Archfiend/Assault Mode', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 10,
  atk: 3500,
  def: 2500,
  sets: ASSAULT,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 2000,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned with "Assault Mode Activate". After damage calculation, if this card attacked: Destroy all other monsters on the field. When this card on the field is destroyed: You can target 1 "Red Dragon Archfiend" in your GY; Special Summon that target.',
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Destroy all other monsters',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      resolve: async (ctx) => {
        const list = ctx.monsters('both', (c) => c !== ctx.self);
        if (list.length) await ctx.destroy(list);
      },
    },
    assaultRevive('Red Dragon Archfiend', true),
  ],
});

monster('Doomkaiser Dragon/Assault Mode', {
  attribute: 'FIRE',
  race: 'Zombie',
  level: 8,
  atk: 2900,
  def: 2000,
  sets: ASSAULT,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1500,
  text: 'This card cannot be Normal Summoned or Set. This card cannot be Special Summoned except with "Assault Mode Activate". When this card is Special Summoned, Special Summon any number of Zombie-Type monsters from either player\'s Graveyard(s) to your side of the field. Those monsters\' effects are negated, and they are destroyed during the End Phase this turn. When this card on the field is destroyed, you can Special Summon 1 "Doomkaiser Dragon" from your Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Special Summon Zombies',
      categories: ['specialSummon'],
      resolve: async (ctx) => {
        const cands = ctx.grave('both', (c) => raceIs(c, 'Zombie') && ctx.canSummonCard(c));
        const room = ctx.freeMZones();
        if (!cands.length || !room || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 0, room, 'Special Summon any number of Zombie-Type monsters from either GY.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.name === 'Bone Crusher' ? 2000 : 0),
        });
        if (!sel.length) return;
        const r = await ctx.specialSummon(sel, { pos: 'choose' });
        for (const m of r) {
          ctx.negateEffects(m, 'field');
          destroyAtEnd(ctx, m);
        }
      },
    },
    assaultRevive('Doomkaiser Dragon'),
  ],
});

monster('Hyper Psychic Blaster/Assault Mode', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 11,
  atk: 3500,
  def: 3000,
  sets: ASSAULT,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1500,
  text: 'This card cannot be Normal Summoned or Set. This card cannot be Special Summoned except with "Assault Mode Activate". If this card battles a monster, at the end of the Damage Step, inflict damage to your opponent equal to that monster\'s DEF and gain Life Points equal to its ATK. When this card on the field is destroyed, you can Special Summon 1 "Hyper Psychic Blaster" from your Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Burn DEF, gain ATK',
      categories: ['damage', 'recover'],
      eventFilter: (ctx, ev) => (ev.card === ctx.self || ev.other === ctx.self) && !!ev.other && monActive(ctx),
      activate: async (ctx) => {
        const ev = ctx.event!;
        const other = (ev.card === ctx.self ? evo(ev) : evc(ev))!;
        const calc = ctx.battle?.calc;
        const onField = faceUpOn(other);
        if (ev.card === ctx.self) {
          ctx.data.def = onField ? ctx.def(other) : calc?.targetDef ?? other.data.def ?? 0;
          ctx.data.atk = onField ? ctx.atk(other) : calc?.targetAtk ?? other.data.atk ?? 0;
        } else {
          ctx.data.def = onField ? ctx.def(other) : other.data.def ?? 0;
          ctx.data.atk = onField ? ctx.atk(other) : calc?.attackerAtk ?? other.data.atk ?? 0;
        }
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, ctx.data.def ?? 0);
        await ctx.recover(ctx.player, ctx.data.atk ?? 0);
      },
    },
    assaultRevive('Hyper Psychic Blaster'),
  ],
});

monster('Arcanite Magician/Assault Mode', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 9,
  atk: 900,
  def: 2300,
  sets: ASSAULT,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 2000,
  text: 'This card cannot be Normal Summoned or Set. This card cannot be Special Summoned except with "Assault Mode Activate". When this card is Special Summoned, place 2 Spell Counters on it. This card gains 1000 ATK for each Spell Counter on it. You can remove 2 Spell Counters from this card to destroy all cards your opponent controls. When this card on the field is destroyed, you can Special Summon 1 "Arcanite Magician" from your Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Place 2 Spell Counters',
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        ctx.self.counters.spell = (ctx.self.counters.spell ?? 0) + 2;
        ctx.log(`${ctx.self.name} gets 2 Spell Counters.`);
        ctx.game.update();
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 1000 * (ctx.self.counters.spell ?? 0) }] },
    {
      kind: 'ignition',
      label: 'Remove 2 Spell Counters: destroy all opponent\'s cards',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => (ctx.self.counters.spell ?? 0) >= 2 && ctx.field('opp').length > 0,
      activate: async (ctx) => {
        ctx.self.counters.spell = (ctx.self.counters.spell ?? 0) - 2;
        ctx.game.update();
      },
      resolve: async (ctx) => {
        const list = ctx.field('opp');
        if (list.length) await ctx.destroy(list);
      },
      ai: {
        score: (ctx) => {
          const v = ctx.field('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return ctx.field('opp').length >= 2 || v >= 2500 ? 70 : 0;
        },
      },
    },
    assaultRevive('Arcanite Magician'),
  ],
});

// =================================================================== Assault Mode support

/** The /Assault Mode monster for a Synchro Monster on the field, from a list of candidates. */
const assaultFor = (base: C) => (c: C) => isAssault(c) && c.name.includes(base.name);
const amaSources = (ctx: Ctx) =>
  tributable(ctx, (c) => c.hasType('synchro') && c.faceUp).filter((s) => ctx.deck('me', assaultFor(s)).length > 0);

trap(AMA, 'normal', {
  text: 'Tribute 1 Synchro Monster; Special Summon 1 "/Assault Mode" monster, whose name includes the Tributed monster\'s name, from your Deck in Attack Position.',
  aiValue: 300,
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => amaSources(ctx).length > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon'),
      activate: async (ctx) => {
        const top = ctx.prevLink();
        const sel = await ctx.select(amaSources(ctx), 1, 1, 'Tribute 1 Synchro Monster.', 'tribute', {
          aiScore: (c) => (top && top.player === ctx.opp && top.ctx.targets.includes(c) ? 5000 : 0) + (ctx.deck('me', assaultFor(c))[0]?.data.atk ?? 0) - ctx.atk(c),
        });
        if (!sel.length) return false;
        ctx.data.name = sel[0].name;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        const name = ctx.data.name as string;
        const cands = ctx.deck('me', (c) => isAssault(c) && c.name.includes(name));
        if (!cands.length || !ctx.canSpecialSummon()) {
          ctx.game.shuffleDeck(ctx.player);
          return;
        }
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "/Assault Mode" monster from your Deck.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0], { pos: 'atk', proper: true, ignoreConditions: true });
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: {
        score: (ctx) => {
          const top = ctx.prevLink();
          if (top && top.player === ctx.opp && !top.negated && amaSources(ctx).some((s) => top.ctx.targets.includes(s) || (top.effect.categories ?? []).includes('destroyMulti'))) return 80;
          if (ctx.battle && ctx.battle.attacker.controller === ctx.opp && ctx.battle.target && amaSources(ctx).includes(ctx.battle.target)) return 60;
          if (myOpenMain(ctx) && ctx.phase === 'main1') return 60;
          return 0;
        },
      },
    },
  ],
});

monster('Arcane Apprentice', {
  attribute: 'FIRE',
  race: 'Spellcaster',
  level: 2,
  atk: 1000,
  def: 400,
  types: ['tuner'],
  aiValue: 400,
  text: 'If this card is sent to the Graveyard for a Synchro Summon, you can add 1 "Assault Mode Activate" from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Search "Assault Mode Activate"',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && reasonsOf(ev).includes('synchro'),
      canActivate: (ctx) => ctx.deck('me', (c) => c.name === AMA).length > 0,
      resolve: async (ctx) => {
        await ctx.search((c) => c.name === AMA, 1, 'Add 1 "Assault Mode Activate" from your Deck to your hand.');
      },
    },
  ],
});

monster('Assault Mercenary', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 1800,
  def: 300,
  aiValue: 200,
  text: 'Once per turn, you can return 1 "Assault Mode Activate" from your hand or Graveyard to the Deck to destroy 1 Spell or Trap Card your opponent controls.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy 1 Spell/Trap',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.cards('me', ['hand', 'grave'], (c) => c.name === AMA).length > 0 && ctx.spellTraps('opp').length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.cards('me', ['hand', 'grave'], (c) => c.name === AMA), 1, 1, 'Return 1 "Assault Mode Activate" to the Deck.', 'cost', {
          aiScore: (c) => (c.location === 'grave' ? 10 : 0),
        });
        if (!sel.length) return false;
        await ctx.toDeck(sel, 'shuffle', 'cost');
      },
      resolve: async (ctx) => {
        const st = ctx.spellTraps('opp');
        if (!st.length) return;
        const sel = await ctx.select(st, 1, 1, 'Destroy 1 Spell or Trap Card your opponent controls.', 'destroy');
        if (sel.length) await ctx.destroy(sel);
      },
      ai: { score: (ctx) => (ctx.cards('me', ['grave'], (c) => c.name === AMA).length || !amaSources(ctx).length ? 50 : 20) },
    },
  ],
});

monster('Assault Beast', {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 4,
  atk: 1900,
  def: 1200,
  aiValue: 300,
  text: 'You can discard this card to the GY; add 1 "Assault Mode Activate" from your Deck to your hand.',
  effects: [
    {
      kind: 'ignition',
      range: ['hand'],
      label: 'Search "Assault Mode Activate"',
      categories: ['search'],
      canActivate: (ctx) => ctx.deck('me', (c) => c.name === AMA).length > 0,
      activate: async (ctx) => {
        await ctx.discard(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.search((c) => c.name === AMA, 1, 'Add 1 "Assault Mode Activate" from your Deck to your hand.');
      },
      ai: {
        score: (ctx) => {
          if (ctx.hand('me', (c) => c.name === AMA).length) return 0;
          const hasTarget = ctx.extra('me', (s) => ctx.deck('me', assaultFor(s)).length > 0).length > 0 || amaSources(ctx).length > 0;
          return hasTarget ? 50 : 0;
        },
      },
    },
  ],
});

monster(NIGHT_WING, {
  attribute: 'WIND',
  race: 'Spellcaster',
  level: 3,
  atk: 1300,
  def: 1200,
  aiValue: 200,
  text: 'You can activate "Assault Mode Activate" the turn it is Set.',
  effects: [PATCH_LISTENER],
});

spell('Assault Overload', 'quickplay', {
  text: 'Tribute 1 "/Assault Mode" monster. Inflict damage to both players equal to its Level x 200.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      canActivate: (ctx) => tributable(ctx, (c) => c.faceUp && isAssault(c)).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => c.faceUp && isAssault(c)), 1, 1, 'Tribute 1 "/Assault Mode" monster.', 'tribute');
        if (!sel.length) return false;
        ctx.data.dmg = ctx.level(sel[0]) * 200;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, ctx.data.dmg ?? 0);
        await ctx.damage(ctx.player, ctx.data.dmg ?? 0);
      },
      ai: {
        score: (ctx) => {
          const m = tributable(ctx, (c) => c.faceUp && isAssault(c));
          const d = Math.max(0, ...m.map((c) => ctx.level(c) * 200));
          // Only as a finisher, or to keep the monster's value when it is about to be removed anyway.
          if (d >= ctx.oppLp && d < ctx.lp) return 95;
          const top = ctx.prevLink();
          if (top && top.player === ctx.opp && m.some((c) => top.ctx.targets.includes(c)) && d < ctx.lp) return 40;
          return 0;
        },
      },
    },
  ],
});

spell('Assault Teleport', 'normal', {
  text: 'Return 1 "/Assault Mode" monster from your hand to the Deck. Draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => ctx.hand('me', (c) => c !== ctx.self && isAssault(c)).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me', (c) => c !== ctx.self && isAssault(c)), 1, 1, 'Return 1 "/Assault Mode" monster from your hand to the Deck.', 'cost');
        if (!sel.length) return false;
        await ctx.toDeck(sel, 'shuffle', 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: { score: () => 60 },
    },
  ],
});

spell('Assault Revival', 'quickplay', {
  text: 'Remove from play 1 "Assault Mode Activate" from your Graveyard. Destroy all monsters you control and Special Summon 1 "/Assault Mode" monster from your Graveyard, ignoring its Summoning conditions. Its effect(s) is negated, and it cannot be Tributed. If it is removed from the field, remove it from play.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.grave('me', (c) => c.name === AMA).length > 0 && ctx.grave('me', isAssault).length > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon'),
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', (c) => c.name === AMA), 1, 1, 'Remove from play 1 "Assault Mode Activate" from your GY.', 'cost');
        if (!sel.length) return false;
        await ctx.banish(sel, 'cost');
      },
      resolve: async (ctx) => {
        const mine = ctx.monsters('me');
        if (mine.length) await ctx.destroy(mine);
        const cands = ctx.grave('me', isAssault);
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "/Assault Mode" monster from your GY.', 'specialSummon');
        if (!sel.length) return;
        const r = await ctx.specialSummon(sel[0], { pos: 'choose', ignoreConditions: true });
        if (!r.length) return;
        ctx.negateEffects(r[0], 'field');
        ctx.addTempMod(r[0], 'cannotBeTributed', true, 'field');
        r[0].banishOnLeave = true;
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.grave('me', isAssault).map((c) => c.data.atk ?? 0));
          const lose = ctx.monsters('me').reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return myOpenMain(ctx) && ctx.phase === 'main1' && best >= 2900 && lose < 1500 ? 55 : 0;
        },
      },
    },
  ],
});

trap('Assault Slash', 'normal', {
  text: 'Activate only while you control an "/Assault Mode" monster. Destroy all face-up monsters on the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) => ctx.faceUpMonsters('me', isAssault).length > 0,
      resolve: async (ctx) => {
        const list = ctx.faceUpMonsters('both');
        if (list.length) await ctx.destroy(list);
      },
      ai: {
        score: (ctx) => {
          const opp = ctx.faceUpMonsters('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const mine = ctx.faceUpMonsters('me').reduce((a, c) => a + cardValue(ctx.game, c) - (isAssault(c) ? 1500 : 0), 0);
          return opp >= 3000 && opp > mine + 1500 ? 50 : 0;
        },
      },
    },
  ],
});

trap('Assault Counter', 'counter', {
  text: "Activate only while you control an \"/Assault Mode\" monster. Negate the activation of a Spell Card, Trap Card, or Effect Monster's effect and destroy it.",
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && ctx.faceUpMonsters('me', isAssault).length > 0 && (l.isCardActivation || l.card.isMonster);
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp) return 0;
          const cats = l.effect.categories ?? [];
          if (l.ctx.targets.some((t) => t.controller === ctx.player)) return 70;
          return cats.some((c) => ['destroyMulti', 'destroy', 'control', 'specialSummon', 'banish', 'negate', 'draw', 'search'].includes(c)) ? 55 : 0;
        },
      },
    },
  ],
});

// =================================================================== Synchro Monsters

monster('Hyper Psychic Blaster', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 9,
  atk: 3000,
  def: 2500,
  types: ['synchro'],
  aiValue: 800,
  text: '1 Tuner + 1 or more non-Tuner Psychic-Type Monsters\nIf this card attacks a Defense Position monster, inflict piercing battle damage to your opponent. At the end of the Damage Step, if this card attacked a Defense Position monster and that monster\'s DEF is lower than this card\'s ATK (use its original values if the other monster is no longer on the field): Gain LP equal to the surplus.',
  synchro: { nonTuner: (c) => raceIs(c, 'Psychic'), desc: '1 Tuner + 1+ non-Tuner Psychic-Type monsters' },
  effects: [
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Gain LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => {
        const calc = ctx.battle?.calc;
        if (ev.card !== ctx.self || !ev.other || !calc || calc.targetPos !== 'def' || !monActive(ctx)) return false;
        const t = evo(ev)!;
        const def = faceUpOn(t) ? ctx.def(t) : t.data.def ?? 0;
        const atk = ctx.atk(ctx.self);
        return def < atk;
      },
      activate: async (ctx) => {
        const t = evo(ctx.event!)!;
        const def = faceUpOn(t) ? ctx.def(t) : t.data.def ?? 0;
        ctx.data.gain = ctx.atk(ctx.self) - def;
      },
      resolve: async (ctx) => {
        await ctx.recover(ctx.player, ctx.data.gain ?? 0);
      },
    },
  ],
});

monster("Cosmic Fortress Gol'gar", {
  attribute: 'LIGHT',
  race: 'Reptile',
  level: 5,
  atk: 2600,
  def: 1800,
  types: ['synchro'],
  aiValue: 900,
  text: '"Alien Ammonite" + 1 or more non-Tuner "Alien" monsters\nOnce per turn, you can select any number of face-up Spell or Trap Cards. Return those cards to their owners\' hands, and distribute new A-Counters among monsters on the field equal to the number of cards returned. Once per turn, you can remove 2 A-Counters from anywhere on the field to destroy 1 card your opponent controls.',
  synchro: { tuner: (c) => c.name === 'Alien Ammonite', nonTuner: isAlien, desc: '"Alien Ammonite" + 1+ non-Tuner "Alien" monsters' },
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Return Spells/Traps, place A-Counters',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.spellTraps('both', (c) => c.faceUp && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cands = ctx.spellTraps('both', (c) => c.faceUp);
        await ctx.selectTargets(cands, 1, cands.length, 'Select any number of face-up Spell/Trap Cards to return to the hand.', 'bounce', {
          aiScore: (c) => (c.controller === ctx.opp ? 1000 + cardValue(ctx.game, c) : c.data.stype === 'continuous' || c.data.stype === 'field' ? 300 : -1000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField && c.faceUp);
        if (!t.length) return;
        const r = await ctx.toHand(t);
        const n = r.filter((c) => c.location === 'hand').length;
        for (let i = 0; i < n; i++) {
          const mons = ctx.monsters('both');
          if (!mons.length) break;
          const [m] = await ctx.select(mons, 1, 1, `Place an A-Counter (${i + 1}/${n}).`, 'generic', {
            aiScore: (c) => (c.controller === ctx.opp ? 1000 + cardValue(ctx.game, c) : -1000),
          });
          if (m) addA(ctx, m);
        }
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp', (c) => c.faceUp && ctx.canTarget(c)).length ? 55 : 0) },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Remove 2 A-Counters: destroy 1 card',
      categories: ['destroy'],
      canActivate: (ctx) => aOnField(ctx.game) >= 2 && ctx.field('opp').length > 0,
      activate: async (ctx) => {
        if (!(await removeA(ctx, 2))) return false;
      },
      resolve: async (ctx) => {
        const f = ctx.field('opp');
        if (!f.length) return;
        const sel = await ctx.select(f, 1, 1, 'Destroy 1 card your opponent controls.', 'destroy');
        if (sel.length) await ctx.destroy(sel);
      },
      ai: { score: (ctx) => (ctx.field('opp').length ? 55 : 0) },
    },
  ],
});

// =================================================================== Reactors

monster(SK, {
  attribute: 'DARK',
  race: 'Machine',
  level: 5,
  atk: 2000,
  def: 1400,
  sets: ['reactor'],
  aiValue: 500,
  text: 'The first time a monster(s) is Summoned to your opponent\'s side of the field each turn, inflict 800 damage to your opponent. During the Battle Phase of the turn this effect is activated, you can negate the attack of 1 monster your opponent controls. You can send 1 face-up "Trap Reactor・Y FI", 1 face-up "Spell Reactor・RE" and this face-up card you control to the Graveyard to Special Summon 1 "Flying Fortress SKY FIRE" from your hand, Deck, or Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      opt: true,
      label: 'Inflict 800 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c !== ctx.self && c.location === 'mzone' && c.controller === ctx.opp && monActive(ctx);
      },
      resolve: async (ctx) => {
        ctx.self.flags.skBurnTurn = ctx.turn;
        await ctx.damage(ctx.opp, 800);
      },
    },
    {
      kind: 'quick',
      event: 'attackDeclared',
      opt: true,
      label: 'Negate an attack',
      categories: ['negateAttack'],
      eventFilter: (ctx, ev) => evc(ev)?.controller === ctx.opp,
      condition: (ctx) => ctx.self.flags.skBurnTurn === ctx.turn && ctx.phase === 'battle' && !!ctx.battle && !ctx.battle.inDamageStep,
      resolve: async (ctx) => {
        ctx.negateAttack();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const a = ctx.atk(b.attacker);
          if (!b.target) return a >= 1000 ? 70 : 0;
          const s = b.target.pos === 'atk' ? ctx.atk(b.target) : ctx.def(b.target);
          return a >= s ? 70 : 0;
        },
      },
    },
    {
      kind: 'ignition',
      label: 'Summon Flying Fortress SKY FIRE',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        ctx.faceUpMonsters('me', (c) => c.name === YFI).length > 0 &&
        ctx.faceUpMonsters('me', (c) => c.name === RE).length > 0 &&
        ctx.cards('me', ['hand', 'deck', 'grave'], (c) => c.name === SKY_FIRE).length > 0 &&
        !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon'),
      activate: async (ctx) => {
        const y = ctx.faceUpMonsters('me', (c) => c.name === YFI)[0];
        const r = ctx.faceUpMonsters('me', (c) => c.name === RE)[0];
        await ctx.sendToGrave([y, r, ctx.self], 'cost');
      },
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['hand', 'deck', 'grave'], (c) => c.name === SKY_FIRE);
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "Flying Fortress SKY FIRE".', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0], { pos: 'choose', proper: true, ignoreConditions: true });
        if (cands.some((c) => c.location === 'deck')) ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 80 },
    },
  ],
});

function reactor(name: string, kind: 'trap' | 'spell', o: { attribute: Attribute; level: number; atk: number; def: number; text: string }) {
  monster(name, {
    attribute: o.attribute,
    race: 'Machine',
    level: o.level,
    atk: o.atk,
    def: o.def,
    sets: ['reactor'],
    aiValue: 600,
    text: o.text,
    effects: [
      {
        kind: 'quick',
        opt: true,
        label: `Destroy the ${kind === 'trap' ? 'Trap' : 'Spell'} Card, 800 damage`,
        categories: ['destroy', 'damage'],
        condition: (ctx) => {
          const l = ctx.prevLink();
          return !!l && l.player === ctx.opp && l.isCardActivation && (kind === 'trap' ? l.card.isTrap : l.card.isSpell) && l.card.onField;
        },
        activate: async (ctx) => {
          ctx.data.card = ctx.prevLink()!.card;
          ctx.data.mid = (ctx.data.card as C).moveId;
        },
        resolve: async (ctx) => {
          const c = ctx.data.card as C;
          if (c.onField && c.moveId === ctx.data.mid) await ctx.destroy(c);
          await ctx.damage(ctx.opp, 800);
        },
        ai: { score: () => 60 },
      },
    ],
  });
}
reactor(YFI, 'trap', {
  attribute: 'DARK',
  level: 4,
  atk: 800,
  def: 1800,
  text: 'Once per turn, when your opponent activates a Trap Card, you can destroy the Trap Card and inflict 800 damage to your opponent.',
});
reactor(RE, 'spell', {
  attribute: 'DARK',
  level: 3,
  atk: 1200,
  def: 900,
  text: 'Once per turn, when your opponent activates a Spell Card, you can destroy the Spell Card and inflict 800 damage to your opponent.',
});

/** SKY FIRE: "Once during each of your opponent's turns" — shared by both options. */
const skyFireUsed = (ctx: Ctx) => ctx.self.flags.skyFireTurn === ctx.turn;
const skyFireOk = (ctx: Ctx) => !ctx.isMyTurn && !skyFireUsed(ctx) && monActive(ctx);
const skyFireOnSetEffect: EffectDef = {
  kind: 'quick',
  event: 'monsterSet',
  label: 'Destroy the Set card, 800 damage',
  categories: ['destroy', 'damage'],
  eventFilter: (ctx, ev) => evc(ev)?.controller === ctx.opp && !!evc(ev)?.onField,
  condition: skyFireOk,
  activate: async (ctx) => {
    ctx.self.flags.skyFireTurn = ctx.turn;
    ctx.data.card = evc(ctx.event!);
    ctx.data.mid = (ctx.data.card as C)?.moveId;
  },
  resolve: async (ctx) => {
    const c = ctx.data.card as C | undefined;
    if (c && c.onField && c.moveId === ctx.data.mid) await ctx.destroy(c);
    await ctx.damage(ctx.opp, 800);
  },
  ai: { score: () => 60 },
};

/** Offered by the per-game patch when the opponent Sets a Spell/Trap Card. */
async function skyFireOnSet(g: Game, setter: PlayerId, card: C) {
  const p = g.opp(setter);
  for (const sf of g.monsters(p).filter((c) => c.name === SKY_FIRE)) {
    const effs = sf.data.effects ?? [];
    const idx = effs.indexOf(skyFireOnSetEffect);
    if (idx < 0 || !faceUpActive(g, sf) || sf.flags.skyFireTurn === g.turn || g.turnPlayer === p || g.chain.length) continue;
    const event = { type: 'monsterSet', seq: -1, batch: -1, card, player: setter } as GameEvent;
    const act: Activation = { card: sf, effect: skyFireOnSetEffect, effectIndex: idx, label: skyFireOnSetEffect.label!, event };
    const choice = await g.controllers[p].chooseResponse(g, p, { kind: 'response', options: [act], prompt: `${g.players[setter].name} Set a card. Use ${sf.name}?` });
    if (!choice) continue;
    const link = await g.activate(p, act);
    if (link) {
      await g.runChain();
      await g.processTriggers(true);
    }
    return;
  }
}

monster(SKY_FIRE, {
  attribute: 'WIND',
  race: 'Machine',
  level: 8,
  atk: 3000,
  def: 2500,
  sets: ['reactor'],
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 2000,
  text: 'This card cannot be Normal Summoned or Set. This card cannot be Special Summoned except with the effect of "Summon Reactor・SK". Once per turn, you can send 1 card from your hand to the Graveyard to destroy 1 card your opponent controls. Once during each of your opponent\'s turns, you can activate 1 of the following effects:\n● When your opponent Normal Summons or Special Summons a monster, destroy it and inflict 800 damage to your opponent.\n● When your opponent Sets a card, destroy it and inflict 800 damage to your opponent.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'ignition',
      opt: true,
      label: 'Discard: destroy 1 card',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.hand('me').length > 0 && ctx.field('opp').length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me'), 1, 1, 'Send 1 card from your hand to the GY.', 'discard');
        if (!sel.length) return false;
        await ctx.sendToGrave(sel, 'cost');
      },
      resolve: async (ctx) => {
        const f = ctx.field('opp');
        if (!f.length) return;
        const sel = await ctx.select(f, 1, 1, 'Destroy 1 card your opponent controls.', 'destroy');
        if (sel.length) await ctx.destroy(sel);
      },
      ai: { score: (ctx) => (bestTarget(ctx.game, ctx.field('opp')) && cardValue(ctx.game, bestTarget(ctx.game, ctx.field('opp'))) >= 1200 ? 55 : 0) },
    },
    {
      kind: 'quick',
      event: 'summoned',
      label: 'Destroy the Summoned monster, 800 damage',
      categories: ['destroy', 'damage'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.location === 'mzone' && c.controller === ctx.opp && ev.player === ctx.opp && ev.method !== 'flip';
      },
      condition: skyFireOk,
      activate: async (ctx) => {
        ctx.self.flags.skyFireTurn = ctx.turn;
        ctx.data.card = evc(ctx.event!);
        ctx.data.mid = (ctx.data.card as C).moveId;
      },
      resolve: async (ctx) => {
        const c = ctx.data.card as C;
        if (c.location === 'mzone' && c.moveId === ctx.data.mid) await ctx.destroy(c);
        await ctx.damage(ctx.opp, 800);
      },
      ai: { score: (ctx) => (ctx.event && cardValue(ctx.game, evc(ctx.event)!) >= 1500 ? 70 : 35) },
    },
    skyFireOnSetEffect,
  ],
});

// =================================================================== other monsters

monster('Turret Warrior', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 5,
  atk: 1200,
  def: 2000,
  aiValue: 200,
  text: 'You can Special Summon this card (from your hand) by Tributing 1 Warrior-Type monster, and if you do, it gains ATK equal to the Tributed monster\'s original ATK.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (Tribute 1 Warrior)',
      categories: ['specialSummon'],
      condition: (ctx) => tributable(ctx, (c) => raceIs(c, 'Warrior')).length > 0,
      perform: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => raceIs(c, 'Warrior')), 1, 1, 'Tribute 1 Warrior-Type monster.', 'tribute', {
          aiScore: (c) => (c.data.atk ?? 0) - cardValue(ctx.game, c) / 2,
        });
        if (!sel.length) return false;
        turretBonus.set(ctx.self, { moveId: ctx.self.moveId + 1, atk: sel[0].data.atk ?? 0 });
        await tributeCost(ctx, sel);
        return true;
      },
      ai: {
        score: (ctx) => {
          const w = tributable(ctx, (c) => raceIs(c, 'Warrior'));
          return w.some((c) => 1200 + (c.data.atk ?? 0) >= ctx.atk(c) + 1000 && cardValue(ctx.game, c) < 2200) ? 55 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) => {
            const b = turretBonus.get(ctx.self);
            return b && b.moveId === ctx.self.moveId ? b.atk : 0;
          },
        },
      ],
    },
  ],
});
const turretBonus = new WeakMap<C, { moveId: number; atk: number }>();

monster('Hyper Synchron', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 4,
  atk: 1600,
  def: 800,
  types: ['tuner'],
  sets: ['synchron'],
  aiValue: 300,
  text: 'If this card is sent to the Graveyard for the Synchro Summon of a Dragon-Type monster: That monster gains 800 ATK, also banish that face-up monster during the End Phase.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: '+800 ATK, banish in the End Phase',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => {
        const s = ev.reasonCard as C | undefined;
        return ev.card === ctx.self && reasonsOf(ev).includes('synchro') && !!s && raceIs(s, 'Dragon');
      },
      activate: async (ctx) => {
        ctx.data.s = ctx.event!.reasonCard;
      },
      resolve: async (ctx) => {
        const s = ctx.data.s as C;
        if (!faceUpOn(s)) return;
        ctx.addTempMod(s, 'atk', 800, 'field');
        const mid = s.moveId;
        ctx.later('end', async () => {
          if (faceUpOn(s) && s.moveId === mid) await ctx.banish(s);
        });
      },
    },
  ],
});

monster('Trap Eater', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 1900,
  def: 1600,
  types: ['tuner'],
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 400,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned (from your hand) by sending 1 face-up Trap your opponent controls to the GY.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (send 1 face-up Trap)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.spellTraps('opp', (c) => c.isTrap && c.faceUp).length > 0,
      perform: async (ctx) => {
        const sel = await ctx.select(ctx.spellTraps('opp', (c) => c.isTrap && c.faceUp), 1, 1, 'Send 1 face-up Trap your opponent controls to the GY.', 'destroy');
        if (!sel.length) return false;
        await ctx.sendToGrave(sel, 'cost');
        return true;
      },
      ai: { score: () => 78 },
    },
  ],
});

monster('Twin-Sword Marauder', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 1600,
  def: 1000,
  aiValue: 200,
  text: 'Once per Battle Phase, if this card attacks a Defense Position monster, it can make a second attack in a row. If this card attacks a Defense Position monster, inflict piercing battle damage to your opponent.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
    {
      // APPROX: the second attack is granted at the end of the Damage Step; it does not have to be the very next attack.
      kind: 'trigger',
      event: 'damageStepEnd',
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self || ctx.battle?.calc?.targetPos !== 'def' || !monActive(ctx)) return false;
        if (ctx.self.flags.twinSwordTurn === ctx.turn) return false;
        ctx.self.flags.twinSwordTurn = ctx.turn;
        ctx.addTempMod(ctx.self, 'extraAttacks', 1, 'turn');
        return false;
      },
    },
  ],
});

monster('Dark Tinker', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 2,
  atk: 1000,
  def: 1300,
  types: ['tuner'],
  aiValue: 200,
  text: 'When this card you control is sent to the Graveyard, look at the top card of your Deck. Return that card to either the top or the bottom of the Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Look at the top card',
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.fromController === ctx.player && (ev.from === 'mzone' || ev.from === 'szone'),
      resolve: async (ctx) => {
        const deck = ctx.game.players[ctx.player].deck;
        const top = deck[deck.length - 1];
        if (!top) return;
        ctx.log(`${ctx.game.players[ctx.player].name} looks at the top card of their Deck.`);
        const v = cardValue(ctx.game, top);
        const i = await ctx.option(`Top card: ${top.name}. Where should it go?`, ['Top of the Deck', 'Bottom of the Deck'], (k) => (k === 0 ? v : 1500));
        if (i === 1) {
          deck.pop();
          deck.unshift(top);
          ctx.log('The card is placed on the bottom of the Deck.');
        }
      },
    },
  ],
});

monster('Twilight Rose Knight', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 3,
  atk: 1000,
  def: 1000,
  types: ['tuner'],
  aiValue: 500,
  text: 'Monsters your opponent controls cannot target Plant monsters for attacks. When this card is Normal Summoned: You can Special Summon 1 Level 4 or lower Plant monster from your hand.',
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'cannotBeAttacked', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && c.controller === ctx.player && c.faceUp && raceIs(c, 'Plant') }],
    },
    {
      kind: 'trigger',
      event: 'normalSummoned',
      label: 'Special Summon a Plant',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => raceIs(c, 'Plant') && lvl(c) <= 4 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => raceIs(c, 'Plant') && lvl(c) <= 4 && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower Plant-Type monster from your hand.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0], { pos: 'choose' });
      },
    },
  ],
});

monster('Black Salvo', {
  attribute: 'DARK',
  race: 'Machine',
  level: 3,
  atk: 100,
  def: 1100,
  types: ['tuner'],
  aiValue: 400,
  text: 'When this card is Normal Summoned: You can target 1 Level 4 DARK Machine-Type monster in your Graveyard; Special Summon that target in Defense Position, but its effects are negated.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      label: 'Revive a Level 4 DARK Machine',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => lvl(c) === 4 && attrIs(c, 'DARK') && raceIs(c, 'Machine') && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => lvl(c) === 4 && attrIs(c, 'DARK') && raceIs(c, 'Machine') && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 4 DARK Machine-Type monster in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.canSummonCard(t)) return;
        const r = await ctx.specialSummon(t, { pos: 'def' });
        if (r.length) ctx.negateEffects(r[0], 'field');
      },
    },
  ],
});

monster('Morphtronic Boarden', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 3,
  atk: 500,
  def: 1800,
  sets: MORPH,
  aiValue: 300,
  text: '● While in Attack Position: "Morphtronic" monsters you control can attack your opponent directly.\n● While in Defense Position: Other "Morphtronic" monsters you control cannot be destroyed by battle.',
  effects: [
    {
      kind: 'continuous',
      active: (ctx) => ctx.self.pos === 'atk',
      mods: [{ q: 'directAttack', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.player && isMorphMon(c) }],
    },
    {
      kind: 'continuous',
      active: (ctx) => ctx.self.pos === 'def',
      mods: [{ q: 'indestructibleBattle', to: 'cards', filter: (ctx, c: C) => c !== ctx.self && faceUpOn(c) && c.controller === ctx.player && isMorphMon(c) }],
    },
  ],
});

monster('Morphtronic Slingen', {
  attribute: 'WIND',
  race: 'Machine',
  level: 4,
  atk: 1200,
  def: 800,
  sets: MORPH,
  aiValue: 400,
  text: '● While in Attack Position: Once per turn, you can Tribute 1 "Morphtronic" monster, except "Morphtronic Slingen", to destroy 1 card on the field.\n● While in Defense Position: If this card would be destroyed, you can destroy another "Morphtronic" monster you control instead.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Tribute a Morphtronic: destroy 1 card',
      categories: ['destroy'],
      condition: (ctx) => ctx.self.pos === 'atk',
      canActivate: (ctx) => tributable(ctx, (c) => isMorphMon(c) && c.name !== 'Morphtronic Slingen').length > 0 && ctx.field('both').length > 1,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => isMorphMon(c) && c.name !== 'Morphtronic Slingen'), 1, 1, 'Tribute 1 "Morphtronic" monster.', 'tribute');
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        const f = ctx.field('both');
        if (!f.length) return;
        const sel = await ctx.select(f, 1, 1, 'Destroy 1 card on the field.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000),
        });
        if (sel.length) await ctx.destroy(sel);
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.field('opp'));
          const fodder = Math.min(...tributable(ctx, (c) => isMorphMon(c) && c.name !== 'Morphtronic Slingen').map((c) => cardValue(ctx.game, c)));
          return best && cardValue(ctx.game, best) > fodder + 300 ? 50 : 0;
        },
      },
    },
    {
      // The replacement monster cannot be one that is being destroyed at the same time (batch hook).
      kind: 'continuous',
      replaceDestroy: async (ctx, cards) => {
        if (!cards.includes(ctx.self) || ctx.self.pos !== 'def' || !faceUpOn(ctx.self)) return [];
        const others = ctx.monsters('me', (c) => c !== ctx.self && c.faceUp && isMorphMon(c) && !cards.includes(c));
        if (!others.length || !(await ctx.confirm('Destroy another "Morphtronic" monster instead of Morphtronic Slingen?'))) return [];
        const [o] = await ctx.select(others, 1, 1, 'Destroy another "Morphtronic" monster you control instead.', 'cost');
        if (!o) return [];
        await ctx.game.destroy([o], 'effect', ctx.player, ctx.self);
        return [ctx.self];
      },
    },
  ],
});

monster('Lifeforce Harmonizer', {
  attribute: 'WIND',
  race: 'Psychic',
  level: 2,
  atk: 800,
  def: 400,
  aiValue: 500,
  text: 'When your opponent activates a card\'s effect that inflicts damage, you can discard this card to negate its activation and destroy it.',
  effects: [
    {
      kind: 'quick',
      range: ['hand'],
      label: 'Negate a damage effect',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.player === ctx.opp && (l.effect.categories ?? []).includes('damage');
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
        await ctx.discard(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: { score: () => 60 },
    },
  ],
});

monster('B.E.S. Big Core MK-2', {
  attribute: 'FIRE',
  race: 'Machine',
  level: 6,
  atk: 2400,
  def: 1100,
  sets: ['bes'],
  aiValue: 300,
  text: 'If you control no monsters, you can Normal Summon this card without Tributing. When this card is Special Summoned, place 3 counters on it. This card cannot be destroyed by battle. If this card attacks or is attacked, remove 1 counter from this card at the end of the Damage Step. If you cannot, destroy it.',
  effects: [
    {
      // Same workaround as Power Invader / Blackwing - Elphin the Raven: refresh the noTribute flag whenever Normal Summon legality is checked.
      kind: 'continuous',
      range: ['hand'],
      mods: [
        {
          q: 'cannotNormalSummon',
          to: 'players',
          filter: (ctx, p) => {
            if (p === ctx.player) ctx.self.flags.noTribute = ctx.monsters('me').length === 0;
            return false;
          },
        },
      ],
    },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Place 3 counters',
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        ctx.self.counters.bes = (ctx.self.counters.bes ?? 0) + 3;
        ctx.game.update();
      },
    },
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle' }] },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Remove 1 counter',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => (ev.card === ctx.self || ev.other === ctx.self) && faceUpOn(ctx.self),
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        if ((ctx.self.counters.bes ?? 0) > 0) {
          ctx.self.counters.bes -= 1;
          ctx.game.update();
        } else await ctx.destroy(ctx.self);
      },
    },
  ],
});

monster('Inmato', {
  attribute: 'DARK',
  race: 'Plant',
  level: 3,
  atk: 1400,
  def: 800,
  aiValue: 300,
  text: 'When 1 other face-up Plant-Type monster is targeted by the effect of a Spell or Trap Card your opponent controls, you can Tribute this card to draw 2 cards.',
  effects: [
    {
      kind: 'quick',
      label: 'Tribute: draw 2',
      categories: ['draw'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        if (!l || l.player !== ctx.opp || !(l.card.isSpell || l.card.isTrap)) return false;
        const plants = l.ctx.targets.filter((t) => t !== ctx.self && faceUpOn(t) && raceIs(t, 'Plant'));
        return plants.length === 1 && !ctx.query(ctx.self, 'cannotBeTributed');
      },
      activate: async (ctx) => {
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: { score: () => 65 },
    },
  ],
});

const scannerOn = (c: C) => c.location === 'mzone' && !!c.flags.crmsScan;
monster('Scanner', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 1,
  atk: 0,
  def: 0,
  aiValue: 300,
  text: "Once per turn, you can select 1 of your opponent's monsters that is removed from play. Until the End Phase, this card's name is treated as the selected monster's name, and this card has the same Attribute, Level, ATK, and DEF as the selected monster. If this card is removed from the field while this effect is applied, remove it from play.",
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Copy a removed monster',
      canActivate: (ctx) => ctx.banished('opp', (c) => c.isMonster && c.faceUp).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.banished('opp', (c) => c.isMonster && c.faceUp), 1, 1, "Select 1 of your opponent's removed from play monsters.", 'generic', {
          aiScore: (c) => c.data.atk ?? 0,
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'banished')[0];
        if (!t || !monActive(ctx)) return;
        const me = ctx.self;
        // APPROX: name/Attribute/Level/ATK/DEF copied through a per-instance data override.
        if (!dataPatches.has(me)) {
          patchData(me, (orig, c) => {
            const s = c.flags.crmsScan as { name: string; attribute?: Attribute; level?: number; atk?: number; def?: number } | undefined;
            if (!s || !scannerOn(c)) return undefined;
            return variant(orig, `scan:${s.name}`, { name: s.name, attribute: s.attribute, level: s.level, atk: s.atk, def: s.def });
          });
        }
        me.flags.crmsScan = { name: t.name, attribute: t.data.attribute, level: t.data.level, atk: t.data.atk, def: t.data.def };
        me.banishOnLeave = true;
        ctx.game.update();
        const mid = me.moveId;
        ctx.later('end', async () => {
          if (me.moveId === mid) {
            me.flags.crmsScan = undefined;
            me.banishOnLeave = false;
            ctx.game.update();
          }
        });
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.banished('opp', (c) => c.isMonster && c.faceUp).map((c) => c.data.atk ?? 0));
          return isMain(ctx) && ctx.phase === 'main1' && best >= 1500 ? 55 : 0;
        },
      },
    },
  ],
});

monster(DFW, {
  attribute: 'DARK',
  race: 'Machine',
  level: 4,
  atk: 1700,
  def: 200,
  aiValue: 400,
  text: 'Cards cannot be sent from the Deck to the GY.',
  // APPROX: cards whose cost would send cards from the Deck to the GY can still be activated (the cards just stay).
  effects: [PATCH_LISTENER],
});

monster('Desert Protector', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 4,
  atk: 800,
  def: 1000,
  aiValue: 300,
  text: 'This card gains 300 DEF for each Spell and Trap Card on the field. If an Insect-Type monster you control would be destroyed, you can destroy this card instead.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'def', value: (ctx) => 300 * ctx.spellTraps('both', (c) => c.isSpell || c.isTrap).length }] },
    {
      kind: 'continuous',
      replaceDestroy: async (ctx, cards) => {
        if (cards.includes(ctx.self) || !faceUpOn(ctx.self)) return [];
        const mine = cards.filter((c) => c.location === 'mzone' && c.controller === ctx.player && c.faceUp && raceIs(c, 'Insect'));
        if (!mine.length) return [];
        const [save] = await ctx.select(mine, 0, 1, 'Destroy Desert Protector instead of which Insect-Type monster?', 'generic', {
          aiScore: (c) => cardValue(ctx.game, c) - cardValue(ctx.game, ctx.self) - 200,
        });
        if (!save) return [];
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        return [save];
      },
    },
  ],
});

monster('Cross-Sword Beetle', {
  attribute: 'WIND',
  race: 'Insect',
  level: 4,
  atk: 1800,
  def: 1200,
  aiValue: 200,
  text: 'While you control another Insect monster, if an Insect monster you control attacks a Defense Position monster, inflict piercing battle damage to your opponent.',
  effects: [
    {
      kind: 'continuous',
      active: (ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && raceIs(c, 'Insect')).length > 0,
      mods: [{ q: 'piercing', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.player && raceIs(c, 'Insect') }],
    },
  ],
});

monster('Bee List Soldier', {
  attribute: 'WIND',
  race: 'Insect',
  level: 1,
  atk: 500,
  def: 400,
  aiValue: 200,
  text: 'You can Tribute this card and 1 face-up Insect monster, except "Bee List Soldier"; draw 2 cards.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute: draw 2',
      categories: ['draw'],
      canActivate: (ctx) => !ctx.query(ctx.self, 'cannotBeTributed') && tributable(ctx, (c) => c.faceUp && raceIs(c, 'Insect') && c.name !== 'Bee List Soldier').length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => c.faceUp && raceIs(c, 'Insect') && c.name !== 'Bee List Soldier'), 1, 1, 'Tribute 1 face-up Insect monster.', 'tribute');
        if (!sel.length) return false;
        await tributeCost(ctx, [ctx.self, sel[0]]);
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: {
        score: (ctx) => {
          const v = Math.min(...tributable(ctx, (c) => c.faceUp && raceIs(c, 'Insect') && c.name !== 'Bee List Soldier').map((c) => cardValue(ctx.game, c)));
          return isMain(ctx) && (ctx.phase === 'main2' || ctx.turn <= 1) && v < 2200 ? 45 : 0;
        },
      },
    },
  ],
});

monster(HYDRA, {
  attribute: 'WATER',
  race: 'Reptile',
  level: 4,
  atk: 1800,
  def: 400,
  aiValue: 200,
  text: 'Each time this card declares an attack, you must Tribute 1 Aqua-Type monster. This card can attack 3 times during each Battle Phase.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'continuous',
      mods: [
        { q: 'extraAttacks', value: 2 },
        { q: 'cannotAttack', value: (ctx) => !ctx.monsters('me', (c) => c.data.race === 'Aqua' && !ctx.query(c, 'cannotBeTributed')).length },
      ],
    },
  ],
});

monster(OVERLORD, {
  attribute: 'DARK',
  race: 'Reptile',
  level: 6,
  atk: 2200,
  def: 1600,
  sets: ALIEN,
  aiValue: 500,
  text: 'You can remove 2 A-Counters from anywhere on the field to Special Summon this card from your hand. Once per turn, you can place 1 A-Counter on each face-up monster your opponent controls. (If a monster with an A-Counter battles an "Alien" monster, it loses 300 ATK and DEF for each A-Counter during damage calculation only.) You can only control 1 "Alien Overlord".',
  effects: [
    PATCH_LISTENER,
    alienBattleRule,
    {
      kind: 'proc',
      label: 'Special Summon (remove 2 A-Counters)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && aOnField(ctx.game) >= 2 && !ctx.faceUpMonsters('me', (c) => c.name === OVERLORD).length,
      perform: async (ctx) => removeA(ctx, 2),
      ai: { score: () => 68 },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Place A-Counters',
      canActivate: (ctx) => ctx.faceUpMonsters('opp').length > 0,
      resolve: async (ctx) => {
        if (!monActive(ctx)) return;
        for (const c of ctx.faceUpMonsters('opp')) addA(ctx, c);
      },
      ai: { score: () => 45 },
    },
  ],
});

monster('Alien Ammonite', {
  attribute: 'LIGHT',
  race: 'Reptile',
  level: 1,
  atk: 500,
  def: 200,
  types: ['tuner'],
  sets: ALIEN,
  aiValue: 400,
  text: 'When this card is Normal Summoned: You can target 1 Level 4 or lower "Alien" monster in your GY; Special Summon it, but destroy it during the End Phase.',
  effects: [
    alienBattleRule,
    {
      kind: 'trigger',
      event: 'normalSummoned',
      label: 'Revive an Alien',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isAlien(c) && lvl(c) <= 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isAlien(c) && lvl(c) <= 4 && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 4 or lower "Alien" monster in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.canSummonCard(t)) return;
        const r = await ctx.specialSummon(t, { pos: 'choose' });
        if (r.length) destroyAtEnd(ctx, r[0]);
      },
    },
  ],
});

monster('Alien Kid', {
  attribute: 'LIGHT',
  race: 'Reptile',
  level: 4,
  atk: 1600,
  def: 700,
  sets: ALIEN,
  aiValue: 300,
  text: 'Place 1 A-Counter on all monsters Special Summoned to your opponent\'s side of the field. (If a monster with an A-Counter battles an "Alien" monster, it loses 300 ATK and DEF for each A-Counter during damage calculation only.)',
  effects: [
    alienBattleRule,
    {
      // Continuous effect: no chain (the counter is placed in the event listener).
      kind: 'trigger',
      event: 'specialSummoned',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && c.location === 'mzone' && c.controller === ctx.opp && monActive(ctx)) addA(ctx, c);
        return false;
      },
    },
  ],
});

monster('Dark Voltanis', {
  attribute: 'DARK',
  race: 'Fairy',
  level: 8,
  atk: 2800,
  def: 1400,
  aiValue: 800,
  text: 'After 1 Counter Trap Card you control has been activated and has resolved, you can Tribute 1 DARK monster to Special Summon this card from your hand. If this card is Special Summoned in this way, destroy 1 card on the field.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'trigger',
      event: 'sentToGrave',
      range: ['hand'],
      label: 'Special Summon (Tribute 1 DARK monster)',
      categories: ['specialSummon', 'destroy'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.isTrap && c.data.ttype === 'counter' && ev.fromController === ctx.player && resolvedCounter.get(c) === c.moveId - 1;
      },
      canActivate: (ctx) => tributable(ctx, (c) => attrIs(c, 'DARK') && c.faceUp).length > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon'),
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => attrIs(c, 'DARK') && c.faceUp), 1, 1, 'Tribute 1 DARK monster.', 'tribute');
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'hand' || !ctx.canSpecialSummon()) return;
        const r = await ctx.specialSummon(ctx.self, { pos: 'choose', proper: true });
        if (!r.length) return;
        const f = ctx.field('both', (c) => c !== ctx.self);
        if (!f.length) return;
        const sel = await ctx.select(f, 1, 1, 'Destroy 1 card on the field.', 'destroy', { aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000) });
        if (sel.length) await ctx.destroy(sel);
      },
      ai: { score: (ctx) => (tributable(ctx, (c) => attrIs(c, 'DARK') && c.faceUp).some((c) => cardValue(ctx.game, c) < 2400) ? 80 : 0) },
    },
  ],
});

monster('Prime Material Falcon', {
  attribute: 'WIND',
  race: 'Winged Beast',
  level: 5,
  atk: 2200,
  def: 800,
  aiValue: 600,
  text: "When an Effect Monster's effect to destroy a Spell or Trap Card(s) on the field is activated, you can send 1 card from your hand to the Graveyard to negate its activation and destroy the card.",
  effects: [
    {
      // APPROX: "an effect to destroy Spell/Trap Cards" is detected from the link's 'destroy' category plus a Spell/Trap
      // target (or a 'destroyMulti' effect while Spells/Traps are on the field).
      kind: 'quick',
      label: 'Negate (send 1 card)',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        if (!l || l.negated || l.isCardActivation || !l.card.isMonster) return false;
        const cats = l.effect.categories ?? [];
        if (!cats.includes('destroy')) return false;
        return l.ctx.targets.some((t) => t.onField && (t.isSpell || t.isTrap)) || (cats.includes('destroyMulti') && ctx.spellTraps('both').length > 0);
      },
      canActivate: (ctx) => ctx.hand('me').length > 0,
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
        const sel = await ctx.select(ctx.hand('me'), 1, 1, 'Send 1 card from your hand to the GY.', 'discard');
        if (!sel.length) return false;
        await ctx.sendToGrave(sel, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: { score: (ctx) => (ctx.prevLink()?.player === ctx.opp && ctx.prevLink()!.ctx.targets.some((t) => t.controller === ctx.player) ? 65 : 0) },
    },
  ],
});

monster('Bone Crusher', {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 4,
  atk: 1600,
  def: 200,
  aiValue: 300,
  text: 'When this card is Special Summoned from your Graveyard by the effect of a Zombie-Type monster: You can target 1 Spell/Trap Card your opponent controls; destroy that target. During the End Phase of the turn this card was Special Summoned: Destroy it.',
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      label: 'Destroy 1 Spell/Trap',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const r = ev.reasonCard as C | undefined;
        return ev.card === ctx.self && ev.from === 'grave' && !!r && r.isMonster && r.data.race === 'Zombie';
      },
      canActivate: (ctx) => ctx.spellTraps('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('opp'), 1, 1, 'Target 1 Spell/Trap Card your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Destroy this card',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && faceUpOn(ctx.self) && ctx.self.summonTurn === ctx.turn && ctx.self.summonMethod === 'special',
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone') await ctx.destroy(ctx.self);
      },
    },
  ],
});

monster('Royal Swamp Eel', {
  attribute: 'WATER',
  race: 'Fish',
  level: 4,
  atk: 1700,
  def: 1200,
  types: ['tuner', 'effect'],
  aiValue: 200,
  text: 'If this card is used as a Synchro Material Monster, all the other Synchro Material Monsters must be Fish-Type.',
  synchroMaterialCheck: (_s, mats, self) => mats.every((c) => c === self || raceIs(c, 'Fish')),
});

monster('Submarine Frog', {
  attribute: 'WATER',
  race: 'Aqua',
  level: 2,
  atk: 1200,
  def: 600,
  sets: ['frog'],
  aiValue: 100,
  text: 'During battle between this attacking card and a Defense Position monster whose DEF is lower than the ATK of this card, inflict the difference as Battle Damage to your opponent.',
  effects: [{ kind: 'continuous', mods: [{ q: 'piercing' }] }],
});

monster('Puppet King', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 7,
  atk: 2800,
  def: 2600,
  aiValue: 400,
  text: 'When your opponent adds a Monster Card(s) to their hand, except by drawing, you can Special Summon this card from your hand. If you do, destroy it during your next turn\'s End Phase.',
  effects: [
    {
      kind: 'trigger',
      event: 'addedToHand',
      range: ['hand'],
      when: true,
      label: 'Special Summon',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || !c.isMonster || c.owner !== ctx.opp || ev.reason === 'draw' || ev.from === 'hand') return false;
        // Effect draws also emit 'addedToHand' (reason 'effect'): skip cards drawn in the same batch.
        const log = ctx.game.eventLog;
        for (let i = log.length - 1; i >= 0 && log[i].batch === ev.batch; i--) if (log[i].type === 'drawn' && log[i].card === c) return false;
        return true;
      },
      canActivate: (ctx) => ctx.canSummonSelf() && ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'hand' || !ctx.canSpecialSummon()) return;
        const r = await ctx.specialSummon(ctx.self, { pos: 'choose' });
        if (!r.length) return;
        const mid = ctx.self.moveId;
        ctx.later(
          'end',
          async () => {
            if (ctx.self.location === 'mzone' && ctx.self.moveId === mid) await ctx.destroy(ctx.self);
          },
          nextOwnTurn(ctx),
        );
      },
    },
  ],
});

const evaToken = token('Eva Token', 'DARK', 'Fiend', 2, 500, 500, 'Eva Token (Fiend-Type/DARK/Level 2/ATK 500/DEF 500). Special Summoned by "Zeta Reticulant".');
monster('Zeta Reticulant', {
  attribute: 'DARK',
  race: 'Fairy',
  level: 7,
  atk: 2400,
  def: 2100,
  aiValue: 600,
  text: 'You can Tribute 1 "Eva Token" to Special Summon this card from your hand. While this card is in your Graveyard, each time a monster(s) your opponent controls is removed from play, Special Summon 1 "Eva Token" (Fiend-Type/DARK/Level 2/ATK 500/DEF 500).',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (Tribute 1 Eva Token)',
      categories: ['specialSummon'],
      condition: (ctx) => tributable(ctx, (c) => c.name === 'Eva Token').length > 0,
      perform: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => c.name === 'Eva Token'), 1, 1, 'Tribute 1 "Eva Token".', 'tribute');
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
        return true;
      },
      ai: { score: () => 70 },
    },
    {
      kind: 'trigger',
      event: 'banished',
      range: ['grave'],
      mandatory: true,
      label: 'Special Summon an Eva Token',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => !!evc(ev)?.isMonster && ev.from === 'mzone' && ev.fromController === ctx.opp,
      condition: (ctx) => ctx.canSpecialSummon(),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave' && ctx.canSpecialSummon()) await ctx.createTokens(evaToken, 1, 'def');
      },
    },
  ],
});

monster('Tethys, Goddess of Light', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 5,
  atk: 2400,
  def: 1800,
  aiValue: 800,
  text: 'When you draw a Fairy monster(s) (except during the Damage Step): You can reveal 1 of those monsters; draw 1 card. This card must be face-up on the field to activate and to resolve this effect.',
  effects: [
    {
      kind: 'trigger',
      event: 'drawn',
      label: 'Reveal a Fairy: draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && ev.player === ctx.player && raceIs(c, 'Fairy') && c.location === 'hand' && monActive(ctx) && !ctx.battle?.inDamageStep;
      },
      activate: async (ctx) => {
        const c = evc(ctx.event!)!;
        await reveal(ctx, [c]);
      },
      resolve: async (ctx) => {
        if (monActive(ctx)) await ctx.draw(1);
      },
    },
  ],
});

monster(IDO, {
  attribute: 'DARK',
  race: 'Fiend',
  level: 6,
  atk: 2200,
  def: 800,
  aiValue: 300,
  text: 'You cannot Summon or Normal Set monsters. You can only control 1 "Ido the Supreme Magical Force". Once per turn, during the Standby Phase of the next turn after this card was destroyed by card effect and sent to the GY: Special Summon this card from the GY, and if you do, destroy all other monsters you control.',
  effects: [
    PATCH_LISTENER,
    { kind: 'continuous', mods: [{ q: 'cannotSpecialSummon', to: 'players', filter: (ctx, p) => p === ctx.player }] },
    {
      // Remember the turn it was destroyed by a card effect (no chain).
      kind: 'trigger',
      event: 'sentToGrave',
      eventFilter: (ctx, ev) => {
        const r = reasonsOf(ev);
        if (ev.card === ctx.self && ev.from === 'mzone' && r.includes('destroy') && r.includes('effect')) idoDestroyed.set(ctx.self, { turn: ctx.turn, moveId: ctx.self.moveId });
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      mandatory: true,
      opt: true,
      label: 'Revive',
      categories: ['specialSummon', 'destroy'],
      eventFilter: (ctx, ev) => {
        const d = idoDestroyed.get(ctx.self);
        return ev.phase === 'standby' && !!d && d.moveId === ctx.self.moveId && ctx.turn === d.turn + 1;
      },
      condition: (ctx) => ctx.canSummonSelf(),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave' || !ctx.canSpecialSummon()) return;
        const r = await ctx.specialSummon(ctx.self, { pos: 'choose', proper: true });
        if (!r.length) return;
        const others = ctx.monsters('me', (c) => c !== ctx.self);
        if (others.length) await ctx.destroy(others);
      },
    },
  ],
});
const idoDestroyed = new WeakMap<C, { turn: number; moveId: number }>();

monster('Violet Witch', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 1100,
  def: 1200,
  aiValue: 400,
  text: 'If this card is destroyed by battle and sent to the Graveyard: Add 1 Plant-Type monster with 1500 or less DEF from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Search a Plant',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      resolve: async (ctx) => {
        await ctx.search((c) => raceIs(c, 'Plant') && (c.data.def ?? 0) <= 1500, 1, 'Add 1 Plant-Type monster with 1500 or less DEF from your Deck to your hand.');
      },
    },
  ],
});

monster('Greed Quasar', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 7,
  atk: 0,
  def: 0,
  aiValue: 300,
  text: "This card's original ATK and DEF are each equal to its Level x 300. This monster's Level is increased by the Level of monsters it destroys by battle.",
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'level', value: (ctx) => ctx.self.flags.quasarLv ?? 0 },
        { q: 'atk', value: (ctx) => ctx.level(ctx.self) * 300 },
        { q: 'def', value: (ctx) => ctx.level(ctx.self) * 300 },
      ],
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (ev.other === ctx.self && c && faceUpOn(ctx.self) && !ctx.game.isNegated(ctx.self)) ctx.self.flags.quasarLv = (ctx.self.flags.quasarLv ?? 0) + lvl(c);
        return false;
      },
    },
  ],
});

monster('Armoroid', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 8,
  atk: 2700,
  def: 2000,
  sets: ['roid'],
  aiValue: 300,
  text: 'If this card is Tribute Summoned by Tributing at least 1 "roid" monster: Banish all Spells and Traps on the field.',
  effects: [
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      mandatory: true,
      label: 'Banish all Spells and Traps',
      categories: ['banish'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && (ev.tributes ?? []).some((t) => ((t as C).data?.name ?? '').toLowerCase().includes('roid')),
      resolve: async (ctx) => {
        const st = ctx.spellTraps('both');
        if (st.length) await ctx.banish(st);
      },
    },
  ],
});

// =================================================================== Spells

const preventionMemo = new WeakMap<C, { sel?: { c: C; mid: number } }>();
spell('Prevention Star', 'equip', {
  text: 'Equip only to a monster you control, if it was changed from face-up Attack Position to face-up Defense Position this turn. Select 1 monster your opponent controls. That monster cannot attack or change its battle position. When the equipped monster is destroyed and this card is sent to the Graveyard, remove from play the selected monster.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: ['lockdown'],
      canActivate: (ctx) => {
        ensureCrmsPatches(ctx.game);
        return ctx.faceUpMonsters('me', (c) => changedToDef(ctx, c) && ctx.canTarget(c)).length > 0 && ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0;
      },
      activate: async (ctx) => {
        const [mine] = await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => changedToDef(ctx, c)), 1, 1, 'Target 1 monster you control to equip.', 'equip');
        const [theirs] = await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Select 1 monster your opponent controls.', 'target', { aiScore: (c) => ctx.atk(c) });
        ctx.data.mine = mine;
        ctx.data.theirs = theirs;
      },
      resolve: async (ctx) => {
        const valid = ctx.validTargets();
        const mine = ctx.data.mine as C;
        const theirs = ctx.data.theirs as C;
        if (!valid.includes(mine) || !faceUpOn(mine) || !ctx.self.onField) return;
        ctx.equip(mine);
        if (valid.includes(theirs) && theirs.location === 'mzone') ctx.self.flags.pstar = { uid: theirs.uid, mid: theirs.moveId };
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.monsters('opp').map((c) => ctx.atk(c)));
          return best >= 1800 ? 40 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: (['cannotAttack', 'cannotChangePos'] as const).map((q) => ({
        q,
        to: 'cards' as const,
        filter: (ctx: Ctx, c: C) => {
          const s = ctx.self.flags.pstar as { uid: number; mid: number } | undefined;
          return !!s && ctx.self.equippedTo != null && c.uid === s.uid && c.moveId === s.mid;
        },
      })),
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Remove the selected monster from play',
      categories: ['banish'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || ctx.self.equippedTo == null || c.uid !== ctx.self.equippedTo || !ctx.self.onField) return false;
        const s = ctx.self.flags.pstar as { uid: number; mid: number } | undefined;
        const sc = s ? ctx.game.card(s.uid) : undefined;
        preventionMemo.set(ctx.self, { sel: sc && s ? { c: sc, mid: s.mid } : undefined });
        return !!sc;
      },
      resolve: async (ctx) => {
        const m = preventionMemo.get(ctx.self);
        if (ctx.self.location !== 'grave' || !m?.sel) return;
        if (m.sel.c.location === 'mzone' && m.sel.c.moveId === m.sel.mid) await ctx.banish(m.sel.c);
      },
    },
  ],
});
function changedToDef(ctx: Ctx, c: C) {
  const r = atkToDef.get(c);
  return !!r && r.turn === ctx.turn && r.moveId === c.moveId && c.pos === 'def' && c.faceUp;
}

spell('Vengeful Servant', 'equip', {
  text: 'When control of the equipped monster changes, inflict damage equal to its original ATK to its new controller.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to equip.', 'equip', {
          aiScore: (c) => (c.controller === ctx.player ? (c.data.atk ?? 0) : -5000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (t && ctx.self.onField) ctx.equip(t);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => (c.data.atk ?? 0) >= 2000).length && ctx.freeSZones() > 1 ? 15 : 0) },
    },
    {
      // APPROX: control returning at the End Phase emits no engine event, so only a change of control that takes it triggers.
      kind: 'trigger',
      event: 'controlChanged',
      mandatory: true,
      label: 'Inflict damage to the new controller',
      categories: ['damage'],
      eventFilter: (ctx, ev) => !!evc(ev) && evc(ev)!.uid === ctx.self.equippedTo && stActive(ctx),
      activate: async (ctx) => {
        const c = evc(ctx.event!)!;
        ctx.data.p = c.controller;
        ctx.data.dmg = c.data.atk ?? 0;
      },
      resolve: async (ctx) => {
        await ctx.game.damage(ctx.data.p as PlayerId, ctx.data.dmg ?? 0, 'effect', ctx.self, ctx.player);
      },
    },
  ],
});

spell('Star Blast', 'normal', {
  text: 'Pay any number of Life Points in multiples of 500; reduce the Level of 1 monster you control or that is in your hand by 1 for each 500 Life Points you paid, until the End Phase.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: [],
      // Current Level (a monster in hand may already be lowered by another Star Blast), as the activation uses.
      canActivate: (ctx) => ctx.lp > 500 && (ctx.faceUpMonsters('me', (c) => ctx.level(c) > 1).length > 0 || ctx.hand('me', (c) => c.isMonster && ctx.level(c) > 1).length > 0),
      activate: async (ctx) => {
        ensureCrmsPatches(ctx.game);
        const cands = [...ctx.faceUpMonsters('me', (c) => ctx.level(c) > 1), ...ctx.hand('me', (c) => c.isMonster && ctx.level(c) > 1 && c !== ctx.self)];
        const [m] = await ctx.select(cands, 1, 1, 'Choose 1 monster you control or in your hand.', 'buff', { aiScore: (c) => starBlastAiValue(ctx, c) });
        if (!m) return false;
        const lvNow = ctx.level(m);
        const maxN = Math.min(lvNow - 1, Math.floor((ctx.lp - 1) / 500));
        if (maxN < 1) return false;
        const opts = Array.from({ length: maxN }, (_, i) => `Pay ${(i + 1) * 500} LP (-${i + 1} Level)`);
        const want = m.location === 'hand' ? Math.max(1, lvNow - 4) : 1;
        const i = await ctx.option('How many Life Points?', opts, (k) => -Math.abs(k + 1 - want));
        ctx.data.m = m;
        ctx.data.mid = m.moveId;
        ctx.data.n = i + 1;
        await ctx.payLp((i + 1) * 500);
      },
      resolve: async (ctx) => {
        const m = ctx.data.m as C;
        const n = ctx.data.n as number;
        if (m.moveId !== ctx.data.mid) return;
        if (m.location === 'hand') {
          starBlast.set(m, { turn: ctx.turn, moveId: m.moveId, n });
          ctx.log(`${m.name}'s Level is reduced by ${n}.`);
          ctx.game.update();
        } else if (faceUpOn(m)) ctx.addTempMod(m, 'level', -n, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (!myOpenMain(ctx) || ctx.game.players[ctx.player].normalSummonsLeft <= 0) return 0;
          const best = Math.max(0, ...ctx.hand('me', (c) => c.isMonster).map((c) => starBlastAiValue(ctx, c)));
          return best > 0 ? 40 : 0;
        },
      },
    },
  ],
});
/** AI: worth of making `c` summonable without Tributes. */
function starBlastAiValue(ctx: Ctx, c: C) {
  if (c.location !== 'hand' || c.data.cannotNormalSummon || c.isExtra) return -1;
  const lv = lvl(c);
  if (lv < 5 || lv > 6) return -1;
  if (ctx.monsters('me').length > 0 || ctx.lp <= 2000) return -1;
  const atk = c.data.atk ?? 0;
  return atk >= 2000 ? atk : -1;
}

spell('Raptor Wing Strike', 'normal', {
  text: 'Return 1 "Blackwing" monster you control to the Deck; add 1 "Blackwing" monster from your Deck to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['search', 'toDeck'],
      // https://edisonrul.ing/cards/r/raptor-wing-strike.html — a "Blackwing" Synchro Monster can pay the cost (it returns to
      // the Extra Deck).
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isBW(c) && !c.isToken).length > 0 && ctx.deck('me', isBW).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.faceUpMonsters('me', (c) => isBW(c) && !c.isToken), 1, 1, 'Shuffle 1 "Blackwing" monster you control into the Deck.', 'cost');
        if (!sel.length) return false;
        await ctx.toDeck(sel, 'shuffle', 'cost');
      },
      resolve: async (ctx) => {
        await ctx.search(isBW, 1, 'Add 1 "Blackwing" monster from your Deck to your hand.');
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.faceUpMonsters('me', (c) => isBW(c) && !c.isExtra);
          return mine.some((c) => c.summonTurn !== ctx.turn && cardValue(ctx.game, c) < 1800) && ctx.phase === 'main2' ? 40 : 0;
        },
      },
    },
  ],
});

const rustyMemo = new WeakMap<C, number>();
spell('Morphtronic Rusty Engine', 'equip', {
  text: 'Equip only to a "Morphtronic" monster. If the equipped monster is destroyed, inflict damage to each player equal to its original ATK.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => isMorphMon(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', isMorphMon), 1, 1, 'Target 1 face-up "Morphtronic" monster to equip.', 'equip');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c) && isMorphMon(c))[0];
        if (t && ctx.self.onField) ctx.equip(t);
      },
      ai: { score: () => 0 },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Inflict damage to each player',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || ctx.self.equippedTo == null || c.uid !== ctx.self.equippedTo || !stActive(ctx)) return false;
        rustyMemo.set(ctx.self, c.data.atk ?? 0);
        return true;
      },
      resolve: async (ctx) => {
        const d = rustyMemo.get(ctx.self) ?? 0;
        await ctx.damage(ctx.player, d);
        await ctx.damage(ctx.opp, d);
      },
    },
  ],
});

spell('Morphtronic Map', 'field', {
  text: 'Each time a monster\'s battle position is changed, place 1 Morph Counter on this card. All "Morphtronic" monsters gain 300 ATK for each Morph Counter on this card. When this card is destroyed and sent from the field to the Graveyard, you can Special Summon 1 "Morphtronic" monster from your Graveyard.',
  effects: [
    PATCH_LISTENER,
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone'], isMorphMon).length ? 25 : 5) } },
    {
      kind: 'trigger',
      // A Flip Summon (face-down Defense -> face-up Attack) is a battle position change too (no 'positionChanged' event).
      event: ['positionChanged', 'flipSummoned'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        // Ruling: flipping a face-down Defense Position monster face-up (e.g. when it is attacked) does not change its
        // battle position, so no Morph Counter is placed.
        const before = c ? prevPos.get(c) : undefined;
        if (ev.type === 'positionChanged' && c && before && before.moveId === c.moveId && before.pos === c.pos && !before.faceUp && c.faceUp) return false;
        if (c?.location === 'mzone' && stActive(ctx)) {
          ctx.self.counters.morph = (ctx.self.counters.morph ?? 0) + 1;
          ctx.game.update();
        }
        return false;
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: (_ctx, c: C) => faceUpOn(c) && isMorphMon(c), value: (ctx) => 300 * (ctx.self.counters.morph ?? 0) }] },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Special Summon a Morphtronic',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'fzone' && reasonsOf(ev).includes('destroy'),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isMorphMon(c) && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.grave('me', (c) => isMorphMon(c) && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "Morphtronic" monster from your GY.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0], { pos: 'choose' });
      },
    },
  ],
});

spell('Psychic Sword', 'equip', {
  text: "Equip only to a Psychic-Type monster. While your LP is lower than your opponent's, the equipped monster gains ATK equal to the difference (max. 2000).",
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => raceIs(c, 'Psychic') && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => raceIs(c, 'Psychic')), 1, 1, 'Target 1 face-up Psychic-Type monster to equip.', 'equip', {
          aiScore: (c) => (c.controller === ctx.player ? ctx.atk(c) : -5000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c) && raceIs(c, 'Psychic'))[0];
        if (t && ctx.self.onField) ctx.equip(t);
      },
      ai: { score: (ctx) => (ctx.oppLp - ctx.lp >= 1000 && ctx.faceUpMonsters('me', (c) => raceIs(c, 'Psychic')).length ? 40 : 0) },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget, value: (ctx) => Math.max(0, Math.min(2000, ctx.oppLp - ctx.lp)) }],
    },
  ],
});

spell('Telekinetic Power Well', 'quickplay', {
  text: 'Special Summon any number of Level 2 or lower Psychic-Type monsters from your Graveyard. You take damage equal to the total Levels of those monsters x 300.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => raceIs(c, 'Psychic') && lvl(c) <= 2 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.grave('me', (c) => raceIs(c, 'Psychic') && lvl(c) <= 2 && ctx.canSummonCard(c));
        const room = ctx.freeMZones();
        if (!cands.length || !room) return;
        const sel = await ctx.select(cands, 1, room, 'Special Summon any number of Level 2 or lower Psychic-Type monsters from your GY.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.isTuner ? 500 : 0),
        });
        // AI guard (not a rule): never take lethal damage from this card.
        if (!ctx.game.controllers[ctx.player].isHuman) while (sel.length > 1 && sel.reduce((a, c) => a + lvl(c), 0) * 300 >= ctx.lp) sel.pop();
        const r = await ctx.specialSummon(sel, { pos: 'choose' });
        const total = r.reduce((a, c) => a + lvl(c), 0);
        if (total) await ctx.damage(ctx.player, total * 300);
      },
      ai: { score: (ctx) => (myOpenMain(ctx) && ctx.lp > 3000 && ctx.grave('me', (c) => raceIs(c, 'Psychic') && lvl(c) <= 2).length >= 2 ? 40 : 0) },
    },
  ],
});

spell('Indomitable Gladiator Beast', 'quickplay', {
  text: 'Target face-up "Gladiator Beast" monster you control gains 500 ATK until the End Phase. While this card is in your Graveyard, you can return 2 "Gladiator Beast" cards from your Graveyard to the Deck to return this card to your hand.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isGBMon(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', isGBMon), 1, 1, 'Target 1 face-up "Gladiator Beast" monster you control.', 'buff', {
          aiScore: (c) => (ctx.battle && (ctx.battle.attacker === c || ctx.battle.target === c) ? 5000 : 0) + ctx.atk(c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (t) ctx.addTempMod(t, 'atk', 500, 'turn');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || !b.inDamageStep || b.calc) return 0;
          const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
          const theirs = mine === b.attacker ? b.target : b.attacker;
          if (!mine || !isGBMon(mine) || !theirs || !faceUpOn(theirs)) return 0;
          const a = ctx.atk(mine);
          const s = theirs.pos === 'atk' ? ctx.atk(theirs) : ctx.def(theirs);
          return a <= s && a + 500 > s ? 80 : 0;
        },
      },
    },
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Return 2 Gladiator Beast cards: add this card to hand',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.grave('me', (c) => c !== ctx.self && isGBCard(c)).length >= 2,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', (c) => c !== ctx.self && isGBCard(c)), 2, 2, 'Return 2 "Gladiator Beast" cards from your GY to the Deck.', 'cost');
        if (sel.length < 2) return false;
        await ctx.toDeck(sel, 'shuffle', 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toHand(ctx.self);
      },
      ai: { score: () => 30 },
    },
  ],
});

spell('Seed Cannon', 'continuous', {
  text: 'Each time a Plant-Type monster(s) is Summoned, place 1 Plant Counter on this card (max. 5). You can send this card to the Graveyard to inflict 500 damage to your opponent for each Plant Counter on it.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'deck'], (c) => raceIs(c, 'Plant')).length >= 4 ? 20 : 0) } },
    {
      kind: 'trigger',
      event: 'summoned',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && raceIs(c, 'Plant') && stActive(ctx) && oncePerBatch(ctx.self, 'seed', ev)) {
          ctx.self.counters.plant = Math.min(5, (ctx.self.counters.plant ?? 0) + 1);
          ctx.game.update();
        }
        return false;
      },
    },
    {
      kind: 'ignition',
      label: 'Send to GY: 500 damage per counter',
      categories: ['damage'],
      canActivate: (ctx) => (ctx.self.counters.plant ?? 0) > 0,
      activate: async (ctx) => {
        ctx.data.n = ctx.self.counters.plant ?? 0;
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500 * (ctx.data.n ?? 0));
      },
      ai: {
        score: (ctx) => {
          const n = ctx.self.counters.plant ?? 0;
          if (500 * n >= ctx.oppLp) return 95;
          return n >= 5 ? 45 : 0;
        },
      },
    },
  ],
});

spell('Super Solar Nutrient', 'continuous', {
  text: 'Activate this card by Tributing 1 Level 2 or lower Plant-Type monster; Special Summon 1 Plant-Type monster from your hand or Deck whose Level is less than or equal to the Level the Tributed monster had on the field +3. When this card leaves the field, destroy that monster. When that monster leaves the field, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => {
        const fodder = tributable(ctx, (c) => c.faceUp && raceIs(c, 'Plant') && ctx.level(c) <= 2);
        return !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') && fodder.some((f) => ctx.cards('me', ['hand', 'deck'], (c) => raceIs(c, 'Plant') && lvl(c) <= ctx.level(f) + 3 && ctx.canSummonCard(c)).length > 0);
      },
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => c.faceUp && raceIs(c, 'Plant') && ctx.level(c) <= 2), 1, 1, 'Tribute 1 Level 2 or lower Plant-Type monster.', 'tribute');
        if (!sel.length) return false;
        ctx.data.lv = ctx.level(sel[0]);
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const cands = ctx.cards('me', ['hand', 'deck'], (c) => raceIs(c, 'Plant') && lvl(c) <= (ctx.data.lv ?? 0) + 3 && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Plant-Type monster from your hand or Deck.', 'specialSummon', { aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) });
        const fromDeck = sel[0]?.location === 'deck';
        const r = sel.length ? await ctx.specialSummon(sel[0], { pos: 'choose' }) : [];
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
        if (r.length) ctx.game.link(ctx.self, r[0]);
      },
      ai: { score: (ctx) => (myOpenMain(ctx) ? 45 : 0) },
    },
  ],
});

spell('Six Scrolls of the Samurai', 'quickplay', {
  text: 'Tribute 2 face-up "Six Samurai" monsters. Special Summon 1 "Great Shogun Shien" from your Deck.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => tributable(ctx, (c) => c.faceUp && isSixSamurai(c)).length >= 2 && ctx.deck('me', (c) => c.name === 'Great Shogun Shien').length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => c.faceUp && isSixSamurai(c)), 2, 2, 'Tribute 2 face-up "Six Samurai" monsters.', 'tribute');
        if (sel.length < 2) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        await summonFromDeck(ctx, (c) => c.name === 'Great Shogun Shien', 'Special Summon 1 "Great Shogun Shien" from your Deck.');
      },
      ai: { score: (ctx) => (myOpenMain(ctx) ? 50 : 0) },
    },
  ],
});

spell('Verdant Sanctuary', 'continuous', {
  text: 'When a face-up Insect monster is destroyed by battle or card effect and sent to the GY: Its controller can add 1 Insect monster with the same Level as the destroyed monster from their Deck to their hand.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['deck', 'mzone', 'hand'], (c) => raceIs(c, 'Insect')).length >= 4 ? 20 : 0) } },
    {
      // APPROX: the trigger is activated by this card's controller; for the opponent's Insect, the opponent decides.
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Search an Insect',
      categories: ['search'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && raceIs(c, 'Insect') && ev.from === 'mzone' && ev.fromFaceUp !== false && reasonsOf(ev).includes('destroy') && stActive(ctx);
      },
      activate: async (ctx) => {
        const c = evc(ctx.event!)!;
        ctx.data.p = ctx.event!.fromController ?? c.owner;
        ctx.data.lv = lvl(c);
      },
      resolve: async (ctx) => {
        const p = ctx.data.p as PlayerId;
        const g = ctx.game;
        if (g.queryPlayer(p, 'cannotAddFromDeck')) return;
        const cands = g.zone(p, 'deck').filter((c) => raceIs(c, 'Insect') && lvl(c) === ctx.data.lv);
        if (!cands.length) return;
        if (p !== ctx.player && !(await g.confirm(p, 'Verdant Sanctuary: add 1 Insect monster from your Deck to your hand?', ctx.self))) return;
        const sel = await g.select(p, cands, 0, 1, 'Add 1 Insect monster with the same Level from your Deck to your hand.', 'toHand', { source: ctx.self });
        if (sel.length) await g.toHand(sel, 'effect', p, ctx.self);
        g.shuffleDeck(p);
      },
    },
  ],
});

spell('Arcane Barrier', 'continuous', {
  text: 'Each time a face-up Spellcaster monster(s) on the field is destroyed, place 1 Spell Counter on this card (max. 4). You can send this card and 1 face-up Spellcaster monster you control to the GY; draw 1 card for each Spell Counter that was on this card.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['deck', 'mzone', 'hand'], (c) => raceIs(c, 'Spellcaster')).length >= 5 ? 20 : 0) } },
    {
      kind: 'trigger',
      event: 'destroyed',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && raceIs(c, 'Spellcaster') && ev.from === 'mzone' && ev.fromFaceUp !== false && stActive(ctx) && oncePerBatch(ctx.self, 'arcane', ev)) {
          ctx.self.counters.spell = Math.min(4, (ctx.self.counters.spell ?? 0) + 1);
          ctx.game.update();
        }
        return false;
      },
    },
    {
      kind: 'ignition',
      label: 'Draw per Spell Counter',
      categories: ['draw'],
      canActivate: (ctx) => (ctx.self.counters.spell ?? 0) > 0 && ctx.faceUpMonsters('me', (c) => raceIs(c, 'Spellcaster')).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.faceUpMonsters('me', (c) => raceIs(c, 'Spellcaster')), 1, 1, 'Send 1 face-up Spellcaster-Type monster you control to the GY.', 'cost');
        if (!sel.length) return false;
        ctx.data.n = ctx.self.counters.spell ?? 0;
        await ctx.sendToGrave([ctx.self, sel[0]], 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(ctx.data.n ?? 0);
      },
      ai: { score: (ctx) => ((ctx.self.counters.spell ?? 0) >= 3 ? 50 : 0) },
    },
  ],
});

spell('Mysterious Triangle', 'quickplay', {
  text: 'Destroy 1 monster on the field with an A-Counter. Then, you can Special Summon 1 Level 4 "Alien" monster from your Deck. Destroy it during the End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'specialSummon'],
      canActivate: (ctx) => ctx.monsters('both', (c) => aCount(c) > 0).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.monsters('both', (c) => aCount(c) > 0);
        if (!cands.length) return;
        const sel = await ctx.select(cands, 1, 1, 'Destroy 1 monster with an A-Counter.', 'destroy');
        if (!sel.length) return;
        await ctx.destroy(sel);
        if (!ctx.canSpecialSummon() || !ctx.deck('me', (c) => isAlien(c) && lvl(c) === 4).length) return;
        if (!(await ctx.confirm('Special Summon 1 Level 4 "Alien" monster from your Deck?'))) return;
        const r = await summonFromDeck(ctx, (c) => isAlien(c) && lvl(c) === 4, 'Special Summon 1 Level 4 "Alien" monster from your Deck.');
        if (r.length) destroyAtEnd(ctx, r[0]);
      },
      ai: { score: (ctx) => (ctx.monsters('opp', (c) => aCount(c) > 0 && cardValue(ctx.game, c) >= 1500).length ? 55 : 0) },
    },
  ],
});

spell('Code A Ancient Ruins', 'continuous', {
  text: 'Each time a face-up "Alien" monster(s) is destroyed, place 1 A-Counter on this card. Once per turn, you can remove 2 A-Counters from anywhere on the field to Special Summon 1 "Alien" monster from your Graveyard.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['deck', 'mzone', 'hand', 'grave'], isAlien).length >= 3 ? 25 : 0) } },
    {
      kind: 'trigger',
      event: 'destroyed',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && isAlien(c) && ev.from === 'mzone' && ev.fromFaceUp !== false && stActive(ctx) && oncePerBatch(ctx.self, 'codea', ev)) addA(ctx, ctx.self);
        return false;
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Remove 2 A-Counters: revive an Alien',
      categories: ['specialSummon'],
      canActivate: (ctx) => aOnField(ctx.game) >= 2 && ctx.canSpecialSummon() && ctx.grave('me', (c) => isAlien(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        if (!(await removeA(ctx, 2))) return false;
      },
      resolve: async (ctx) => {
        const cands = ctx.grave('me', (c) => isAlien(c) && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "Alien" monster from your GY.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0], { pos: 'choose' });
      },
      ai: { score: () => 55 },
    },
  ],
});

spell('Synchro Change', 'normal', {
  text: 'Remove from play 1 face-up Synchro Monster you control. Special Summon 1 Synchro Monster from your Extra Deck whose Level is the same as the removed monster\'s. Its effect(s) is negated.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') &&
        ctx.faceUpMonsters('me', (c) => c.hasType('synchro')).some((s) => ctx.extra('me', (e) => e.hasType('synchro') && lvl(e) === ctx.level(s)).length > 0),
      activate: async (ctx) => {
        const cands = ctx.faceUpMonsters('me', (c) => c.hasType('synchro') && ctx.extra('me', (e) => e.hasType('synchro') && lvl(e) === ctx.level(c)).length > 0);
        const sel = await ctx.select(cands, 1, 1, 'Remove from play 1 face-up Synchro Monster you control.', 'cost', {
          aiScore: (c) => Math.max(...ctx.extra('me', (e) => e.hasType('synchro') && lvl(e) === ctx.level(c)).map((e) => e.data.atk ?? 0)) - ctx.atk(c),
        });
        if (!sel.length) return false;
        ctx.data.lv = ctx.level(sel[0]);
        ctx.data.name = sel[0].name;
        await ctx.banish(sel, 'cost');
      },
      resolve: async (ctx) => {
        const cands = ctx.extra('me', (e) => e.hasType('synchro') && lvl(e) === ctx.data.lv && ctx.canSummonCard(e));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 Synchro Monster from your Extra Deck.', 'specialSummon', { aiScore: (c) => (c.data.atk ?? 0) + (c.name === ctx.data.name ? -500 : 0) });
        if (!sel.length) return;
        const r = await ctx.specialSummon(sel[0], { pos: 'choose' });
        if (r.length) ctx.negateEffects(r[0], 'field');
      },
      ai: {
        score: (ctx) => {
          const gain = Math.max(
            -9999,
            ...ctx.faceUpMonsters('me', (c) => c.hasType('synchro')).map((s) => Math.max(-9999, ...ctx.extra('me', (e) => e.hasType('synchro') && lvl(e) === ctx.level(s)).map((e) => (e.data.atk ?? 0) - ctx.atk(s)))),
          );
          return myOpenMain(ctx) && ctx.phase === 'main1' && gain >= 600 ? 45 : 0;
        },
      },
    },
  ],
});

const kuribohToken = token('Kuriboh Token', 'DARK', 'Fiend', 1, 300, 200, 'Kuriboh Token (Fiend/DARK/Level 1/ATK 300/DEF 200). Cannot be Tributed for a Tribute Summon.');
spell('Multiply', 'quickplay', {
  text: 'Tribute 1 face-up "Kuriboh"; Special Summon as many "Kuriboh Tokens" (Fiend/DARK/Level 1/ATK 300/DEF 200) as possible, in Defense Position. They cannot be Tributed for a Tribute Summon.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => tributable(ctx, (c) => c.faceUp && c.name === 'Kuriboh').length > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon'),
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => c.faceUp && c.name === 'Kuriboh'), 1, 1, 'Tribute 1 face-up "Kuriboh".', 'tribute');
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        const n = ctx.freeMZones();
        if (!n || !ctx.canSpecialSummon()) return;
        const r = await ctx.createTokens(kuribohToken, n, 'def');
        for (const t of r) t.flags.noTributeSummonFodder = true;
      },
      ai: { score: (ctx) => (ctx.battle && ctx.battle.attacker.controller === ctx.opp ? 50 : 0) },
    },
  ],
});

spell('Makiu, the Magical Mist', 'normal', {
  text: 'Target 1 "Summoned Skull", or 1 Thunder monster, in your Monster Zone; destroy all monsters your opponent controls with DEF less than or equal to the ATK of that monster. You cannot conduct your Battle Phase the turn you activate this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) => ctx.phase === 'main1' && !ctx.game.queryPlayer(ctx.player, 'cannotDeclareAttack'),
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => (c.name === 'Summoned Skull' || raceIs(c, 'Thunder')) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => c.name === 'Summoned Skull' || raceIs(c, 'Thunder')), 1, 1, 'Target 1 "Summoned Skull" or Thunder monster you control.', 'buff', {
          aiScore: (c) => ctx.atk(c),
        });
        ctx.addPlayerMod(ctx.player, 'cannotDeclareAttack');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (!t) return;
        const a = ctx.atk(t);
        const list = ctx.monsters('opp', (c) => ctx.def(c) <= a);
        if (list.length) await ctx.destroy(list);
      },
      ai: {
        score: (ctx) => {
          const a = Math.max(0, ...ctx.faceUpMonsters('me', (c) => c.name === 'Summoned Skull' || raceIs(c, 'Thunder')).map((c) => ctx.atk(c)));
          const hit = ctx.monsters('opp', (c) => ctx.def(c) <= a);
          return hit.length >= 2 || hit.some((c) => cardValue(ctx.game, c) >= 2000) ? 50 : 0;
        },
      },
    },
  ],
});

spell('Assault Armor', 'equip', {
  text: 'Equip only to a Warrior-Type monster that is the only monster you control. It gains 300 ATK. During your Main Phase 1, you can send this equipped card to the Graveyard to allow the equipped monster to attack twice during each Battle Phase this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      canActivate: (ctx) => {
        const m = ctx.monsters('me');
        return m.length === 1 && faceUpOn(m[0]) && raceIs(m[0], 'Warrior') && ctx.canTarget(m[0]);
      },
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('me'), 1, 1, 'Target the Warrior-Type monster to equip.', 'equip');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c) && raceIs(c, 'Warrior'))[0];
        if (t && ctx.self.onField) ctx.equip(t);
      },
      ai: { score: (ctx) => (myOpenMain(ctx) && ctx.phase === 'main1' ? 35 : 0) },
    },
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget, value: 300 }] },
    {
      kind: 'ignition',
      label: 'Send to GY: attack twice',
      categories: ['atkChange'],
      condition: (ctx) => ctx.phase === 'main1' && !!ctx.equipTarget,
      activate: async (ctx) => {
        ctx.data.t = ctx.equipTarget;
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const t = ctx.data.t as C;
        if (faceUpOn(t)) ctx.addTempMod(t, 'extraAttacks', 1, 'turn');
      },
      ai: {
        score: (ctx) => {
          const t = ctx.equipTarget;
          if (!t || ctx.turn <= 1) return 0;
          const opp = ctx.monsters('opp');
          return opp.length === 0 ? 50 : opp.length === 1 && opp[0].faceUp && ctx.atk(t) - 300 > (opp[0].pos === 'atk' ? ctx.atk(opp[0]) : ctx.def(opp[0])) ? 45 : 0;
        },
      },
    },
  ],
});

// =================================================================== Traps

trap('Spirit Force', 'normal', {
  text: "During your opponent's turn, at damage calculation: Make the battle damage you take from this battle 0, then you can add 1 Warrior-Type Tuner monster with 1500 or less DEF from your Graveyard to your hand.",
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      damageStep: true,
      categories: ['protect', 'toHand'],
      condition: (ctx) => !ctx.isMyTurn && !!ctx.battle && ctx.battle.inDamageStep && !ctx.battle.calc && !ctx.battle.negated,
      resolve: async (ctx) => {
        ensureCrmsPatches(ctx.game);
        const b = ctx.battle as any;
        if (b) (b.crmsNoDamage ??= []).push(ctx.player);
        const cands = ctx.grave('me', (c) => raceIs(c, 'Warrior') && c.isTuner && (c.data.def ?? 0) <= 1500);
        if (!cands.length || !(await ctx.confirm('Add 1 Warrior-Type Tuner monster from your GY to your hand?'))) return;
        const sel = await ctx.select(cands, 1, 1, 'Add 1 Warrior-Type Tuner monster with 1500 or less DEF from your GY to your hand.', 'toHand');
        if (sel.length) await ctx.toHand(sel);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const a = ctx.atk(b.attacker);
          const t = b.target;
          const dmg = !t ? a : t.pos === 'atk' ? a - ctx.atk(t) : 0;
          if (dmg >= ctx.lp) return 95;
          return dmg >= 1500 ? 55 : 0;
        },
      },
    },
  ],
});

trap('Descending Lost Star', 'normal', {
  text: 'Target 1 Synchro Monster in your Graveyard; Special Summon that target in Defense Position, but its effects are negated, its Level is reduced by 1, its DEF becomes 0, also its battle position cannot be changed.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c.hasType('synchro') && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.hasType('synchro') && ctx.canSummonCard(c)), 1, 1, 'Target 1 Synchro Monster in your GY.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.canSummonCard(t)) return;
        const r = await ctx.specialSummon(t, { pos: 'def' });
        if (!r.length) return;
        const m = r[0];
        ctx.negateEffects(m, 'field');
        ctx.addTempMod(m, 'level', -1, 'field');
        m.flags.baseDef = 0;
        ctx.addTempMod(m, 'cannotChangePos', true, 'field');
        ctx.game.update();
      },
      ai: {
        score: (ctx) => {
          if (ctx.isMyTurn && myOpenMain(ctx)) return ctx.extra('me', (e) => e.hasType('synchro')).length && ctx.faceUpMonsters('me', (c) => c.isTuner).length ? 45 : 30;
          return !ctx.isMyTurn && ctx.phase === 'end' && noChain(ctx) ? 35 : 0;
        },
      },
    },
  ],
});

trap('Shining Silver Force', 'counter', {
  text: 'Activate only when your opponent activates a Trap Card that inflicts damage. Negate the activation of that card and destroy it and all face-up Spell and Trap Cards your opponent controls.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.player === ctx.opp && l.isCardActivation && l.card.isTrap && (l.effect.categories ?? []).includes('damage');
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
        const st = ctx.spellTraps('opp', (c) => c.faceUp);
        if (st.length) await ctx.destroy(st);
      },
      ai: { score: () => 70 },
    },
  ],
});

trap('Half or Nothing', 'normal', {
  text: "During your opponent's Battle Phase (except during the Damage Step): Your opponent chooses 1 of these effects.\n● Halve the ATK of all monsters they currently control, until the end of the Battle Phase.\n● End the Battle Phase.",
  effects: [
    {
      kind: 'activate',
      categories: ['negateAttack', 'atkChange'],
      condition: (ctx) => !ctx.isMyTurn && ctx.phase === 'battle' && !ctx.battle?.inDamageStep,
      resolve: async (ctx) => {
        const g = ctx.game;
        const theirs = ctx.faceUpMonsters('opp');
        const canHit = theirs.filter((c) => g.canAttack(c) || c === ctx.battle?.attacker);
        const halfDmg = canHit.reduce((a, c) => a + Math.floor(ctx.atk(c) / 2), 0);
        const i = await g.option(ctx.opp, 'Half or Nothing: choose 1 effect.', ['Halve the ATK of all your monsters until the end of the Battle Phase', 'End the Battle Phase'], ctx.self, (k) =>
          k === 0 ? halfDmg / 1000 : 1,
        );
        if (i === 1) {
          if (ctx.battle) ctx.negateAttack();
          ctx.addPlayerMod(g.turnPlayer, 'cannotDeclareAttack', true, 'turn');
          ctx.log('The Battle Phase ends.');
          return;
        }
        for (const c of theirs) {
          if (!faceUpOn(c)) continue;
          const t = { q: 'atk' as const, value: -(ctx.atk(c) - Math.floor(ctx.atk(c) / 2)), until: 'turn' as const, turn: g.turn, source: ctx.self.uid };
          c.tempMods.push(t);
          const mid = c.moveId;
          const drop = async () => {
            if (c.moveId === mid) c.tempMods = c.tempMods.filter((x) => x !== t);
          };
          g.addDelayed('main2', drop);
          g.addDelayed('end', drop);
        }
        g.update();
      },
      ai: {
        score: (ctx) => {
          const att = ctx.faceUpMonsters('opp', (c) => ctx.game.canAttack(c) || c === ctx.battle?.attacker);
          const total = att.reduce((a, c) => a + ctx.atk(c), 0);
          if (total >= ctx.lp) return 90;
          return total >= 3000 ? 50 : 0;
        },
      },
    },
  ],
});

const nightmareToken = token('Nightmare Archfiend Token', 'DARK', 'Fiend', 6, 2000, 2000, 'Nightmare Archfiend Token (Fiend-Type/DARK/Level 6/ATK 2000/DEF 2000). Each time 1 is destroyed, its controller takes 800 damage.');
const nightmareTokens = new WeakMap<C, Set<number>>();
trap('Nightmare Archfiends', 'normal', {
  text: 'Tribute 1 monster; Special Summon 3 "Nightmare Archfiend Tokens" (Fiend-Type/DARK/Level 6/ATK 2000/DEF 2000) to your opponent\'s field in Attack Position. Each time 1 is destroyed, its controller takes 800 damage.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.freeMZones('opp') >= 3 && tributable(ctx).length > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon'),
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx), 1, 1, 'Tribute 1 monster.', 'tribute');
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        if (ctx.freeMZones('opp') < 3 || !ctx.canSpecialSummon('opp')) return;
        const r = await ctx.createTokens(nightmareToken, 3, 'atk', ctx.opp);
        let s = nightmareTokens.get(ctx.self);
        if (!s) nightmareTokens.set(ctx.self, (s = new Set()));
        for (const t of r) s.add(t.uid);
      },
      ai: {
        score: (ctx) => {
          // Only worth it when the opponent's field is about to be wiped (Torrential / Mirror Force set) or as a finisher.
          const wipe = ctx.spellTraps('me', (c) => !c.faceUp && ['Torrential Tribute', 'Mirror Force', 'Dark Hole'].includes(c.name)).length;
          return wipe && ctx.oppLp <= 2400 && tributable(ctx).some((c) => cardValue(ctx.game, c) < 1200) ? 35 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      range: ALL_LOCS,
      mandatory: true,
      label: 'Nightmare Archfiend Token: 800 damage',
      categories: ['damage'],
      // https://edisonrul.ing/cards/n/nightmare-archfiends.html — the damage when a Token is destroyed does not start a
      // chain (Barrel Behind the Door cannot be activated against it).
      noChain: true,
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.isToken && !!nightmareTokens.get(ctx.self)?.has(c.uid);
      },
      resolve: async (ctx) => {
        await ctx.game.damage(ctx.event!.fromController ?? ctx.opp, 800, 'effect', ctx.self, ctx.player);
      },
    },
  ],
});

const ebonMarks = new WeakMap<Game, { uid: number; mid: number; trap: number; turn: number }[]>();
trap('Ebon Arrow', 'normal', {
  text: 'Select 1 face-up monster you control. Until the End Phase, it loses 500 ATK and during battle between that attacking monster and a Defense Position monster whose DEF is lower than the selected monster\'s ATK, inflict the difference as Battle Damage to your opponent. When the selected monster destroys a monster by battle and sends it to the Graveyard this turn, inflict damage to your opponent equal to the destroyed monster\'s original DEF.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Select 1 face-up monster you control.', 'buff', { aiScore: (c) => ctx.atk(c) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets(faceUpOn)[0];
        if (!t) return;
        ctx.addTempMod(t, 'atk', -500, 'turn');
        ctx.addTempMod(t, 'piercing', true, 'turn');
        let l = ebonMarks.get(ctx.game);
        if (!l) ebonMarks.set(ctx.game, (l = []));
        l.push({ uid: t.uid, mid: t.moveId, trap: ctx.self.uid, turn: ctx.turn });
      },
      ai: {
        score: (ctx) => {
          if (!myOpenMain(ctx) || ctx.phase !== 'main1') return 0;
          const defs = ctx.monsters('opp', (c) => c.pos === 'def');
          return ctx.faceUpMonsters('me', (m) => ctx.game.canAttack(m) && defs.some((d) => (d.faceUp ? ctx.def(d) : 1200) + 1000 <= ctx.atk(m) - 500)).length ? 40 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ALL_LOCS,
      mandatory: true,
      label: 'Inflict the original DEF as damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        const o = evo(ev);
        if (!c || !o || c.location !== 'grave') return false;
        return (ebonMarks.get(ctx.game) ?? []).some((m) => m.trap === ctx.self.uid && m.turn === ctx.turn && m.uid === o.uid && m.mid === o.moveId);
      },
      activate: async (ctx) => {
        ctx.data.d = evc(ctx.event!)!.data.def ?? 0;
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, ctx.data.d ?? 0);
      },
    },
  ],
});

trap('Ivy Shackles', 'continuous', {
  text: 'All face-up monsters your opponent controls become Plant-Type during your turns only. If this face-up card you control is destroyed and sent to your Graveyard by an opponent\'s card effect: Draw 1 card.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      resolve: async (ctx) => {
        // APPROX: the Type change goes through a per-instance data override (cards that exist when it resolves).
        let s = ivies.get(ctx.game);
        if (!s) ivies.set(ctx.game, (s = new Set()));
        s.add(ctx.self);
        for (const c of ctx.game.allCards) {
          if (ivyPatched.has(c)) continue;
          ivyPatched.add(c);
          patchData(c, (orig, card) => (orig.kind === 'monster' && ivyApplies(ctx.game, card) ? variant(orig, 'race:Plant', { race: 'Plant' }) : undefined));
        }
      },
      ai: { score: (ctx) => (myOpenMain(ctx) && ctx.cards('me', ['hand', 'szone'], (c) => c.name === 'Wall of Thorns' || c.name === 'Inmato').length ? 30 : 10) },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => {
        const r = reasonsOf(ev);
        return ev.card === ctx.self && ev.from === 'szone' && ev.fromFaceUp === true && ev.fromController === ctx.player && r.includes('destroy') && r.includes('effect') && ev.reasonPlayer === ctx.opp;
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});
const ivyPatched = new WeakSet<C>();
const ivies = new WeakMap<Game, Set<C>>();
let ivyBusy = false;
/** The opponent's face-up monster during the turn of an active Ivy Shackles' controller. */
function ivyApplies(g: Game, card: C) {
  if (ivyBusy || card.location !== 'mzone' || !card.faceUp || card.controller === g.turnPlayer) return false;
  const s = ivies.get(g);
  if (!s) return false;
  ivyBusy = true;
  try {
    for (const ivy of s) {
      if (ivy.location === 'szone' && ivy.faceUp && ivy.activeOnField && ivy.controller === g.turnPlayer && !g.isNegated(ivy)) return true;
    }
    return false;
  } finally {
    ivyBusy = false;
  }
}

trap('Fake Explosion', 'normal', {
  text: 'Activate only when an opponent\'s monster declares an attack. Monsters cannot be destroyed by this battle. After damage calculation, Special Summon 1 "Summon Reactor・SK" from your hand or Graveyard.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['protect', 'specialSummon'],
      eventFilter: (ctx, ev) => evc(ev)?.controller === ctx.opp,
      resolve: async (ctx) => {
        const b = ctx.battle as any;
        if (!b) return;
        for (const c of [b.attacker, b.target]) if (c && c.location === 'mzone') ctx.addTempMod(c, 'indestructibleBattle', true, 'battle');
        (b.crmsFake ??= []).push(ctx.self.uid);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const hasSK = ctx.cards('me', ['hand', 'grave'], (c) => c.name === SK).length > 0;
          const t = b.target;
          const loses = t && t.faceUp && ctx.atk(b.attacker) > (t.pos === 'atk' ? ctx.atk(t) : ctx.def(t));
          return hasSK ? 55 : loses && t && cardValue(ctx.game, t) >= 1500 ? 35 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      range: ALL_LOCS,
      mandatory: true,
      label: 'Special Summon "Summon Reactor・SK"',
      categories: ['specialSummon'],
      eventFilter: (ctx) => {
        const b = ctx.battle as any;
        return !!b && Array.isArray(b.crmsFake) && b.crmsFake.includes(ctx.self.uid) && !!b.calc;
      },
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['hand', 'grave'], (c) => c.name === SK && ctx.canSummonCard(c));
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "Summon Reactor・SK" from your hand or GY.', 'specialSummon');
        if (sel.length) await ctx.specialSummon(sel[0], { pos: 'choose' });
      },
    },
  ],
});

/** A face-up "Morphtronic" monster I control is threatened by the destruction effect of link `l`. */
function threatensMorph(ctx: Ctx, l: ChainLink) {
  const cats = l.effect.categories ?? [];
  if (!cats.includes('destroy')) return false;
  const mine = ctx.faceUpMonsters('me', isMorphMon);
  if (!mine.length) return false;
  return l.ctx.targets.some((t) => mine.includes(t)) || cats.includes('destroyMulti');
}
trap('Morphtronic Forcefield', 'counter', {
  text: 'Negate the activation of a Spell or Trap Card that would destroy a face-up "Morphtronic" monster you control and destroy it. Add 1 "Morphtronic" card from your Deck to your hand.',
  effects: [
    {
      // APPROX: "would destroy" is read from the link's 'destroy' category with a face-up Morphtronic target, or a 'destroyMulti' effect.
      kind: 'activate',
      categories: ['negate', 'search'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.isCardActivation && (l.card.isSpell || l.card.isTrap) && threatensMorph(ctx, l);
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
        await ctx.search(isMorph, 1, 'Add 1 "Morphtronic" card from your Deck to your hand.');
      },
      ai: { score: (ctx) => (ctx.prevLink()?.player === ctx.opp ? 75 : 0) },
    },
  ],
});

trap('Morphtronic Mix-up', 'normal', {
  text: "If you control 2 or more face-up \"Morphtronic\" monsters, select 2 cards your opponent controls. Destroy 1 card of your opponent's choice from those 2.",
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      condition: (ctx) => ctx.faceUpMonsters('me', isMorphMon).length >= 2,
      canActivate: (ctx) => ctx.field('opp', (c) => ctx.canTarget(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('opp'), 2, 2, 'Select 2 cards your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (!t.length) return;
        const sel = t.length === 1 ? t : await ctx.select(t, 1, 1, 'Morphtronic Mix-up: choose 1 of your cards to be destroyed.', 'toGrave', { player: ctx.opp, aiScore: (c) => -cardValue(ctx.game, c) });
        if (sel.length) await ctx.destroy(sel);
      },
      ai: { score: (ctx) => (ctx.field('opp').length >= 2 ? 45 : 0) },
    },
  ],
});

const tuningLevel = new WeakMap<C, number>();
trap('Psychic Tuning', 'continuous', {
  text: 'Select 1 Psychic-Type monster in your Graveyard and Special Summon it in Attack Position. It is treated as a Tuner monster. When this card is removed from the field, destroy that monster. When that monster is removed from the field, destroy this card. When this card is sent to the Graveyard, take damage equal to that monster\'s Level x 400.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => raceIs(c, 'Psychic') && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => raceIs(c, 'Psychic') && ctx.canSummonCard(c)), 1, 1, 'Target 1 Psychic-Type monster in your GY.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) - lvl(c) * 200,
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.self.onField || !ctx.canSummonCard(t)) return;
        const r = await ctx.specialSummon(t, { pos: 'atk' });
        if (!r.length) return;
        const m = r[0];
        tuningLevel.set(ctx.self, lvl(m));
        m.flags.crmsTuning = true;
        // APPROX: Tuner status through a per-instance data override while it stays on the field.
        if (!tuningPatched.has(m)) {
          tuningPatched.add(m);
          patchData(m, (orig, c) => (c.location === 'mzone' && c.flags.crmsTuning && !(orig.mtypes ?? []).includes('tuner') ? variant(orig, 'tuner', { mtypes: [...(orig.mtypes ?? []), 'tuner'] }) : undefined));
        }
        ctx.game.link(ctx.self, m);
        ctx.game.update();
      },
      ai: {
        score: (ctx) => {
          const best = ctx.grave('me', (c) => raceIs(c, 'Psychic')).sort((a, b) => (b.data.atk ?? 0) - (a.data.atk ?? 0))[0];
          return myOpenMain(ctx) && best && lvl(best) * 400 < ctx.lp - 2000 && (best.data.atk ?? 0) >= 1200 ? 40 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Take damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && tuningLevel.has(ctx.self),
      activate: async (ctx) => {
        ctx.data.d = (tuningLevel.get(ctx.self) ?? 0) * 400;
        tuningLevel.delete(ctx.self);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.player, ctx.data.d ?? 0);
      },
    },
  ],
});
const tuningPatched = new WeakSet<C>();

trap('Supernatural Regeneration', 'normal', {
  text: 'Activate only during the End Phase. Gain 1000 Life Points for each Psychic-Type monster sent to the Graveyard this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['recover'],
      condition: (ctx) => ctx.phase === 'end',
      resolve: async (ctx) => {
        const n = psychicsToGraveThisTurn(ctx.game);
        if (n) await ctx.recover(ctx.player, 1000 * n);
      },
      ai: { score: (ctx) => (psychicsToGraveThisTurn(ctx.game) > 0 ? 45 : 0) },
    },
  ],
});
function psychicsToGraveThisTurn(g: Game) {
  const seen = new Set<number>();
  for (const e of eventsThisTurn(g)) {
    const c = evc(e);
    if (e.type === 'sentToGrave' && c && c.isMonster && (c.data.race === 'Psychic')) seen.add(e.seq);
  }
  return seen.size;
}

trap('Trojan Gladiator Beast', 'normal', {
  text: 'Special Summon 1 "Gladiator Beast" monster from your hand to your opponent\'s side of the field. Then, draw 1 card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon', 'draw'],
      canActivate: (ctx) => ctx.freeMZones('opp') > 0 && ctx.hand('me', (c) => isGBMon(c) && ctx.canSummonCard(c, 'opp')).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => isGBMon(c) && ctx.canSummonCard(c, 'opp'));
        if (!cands.length || ctx.freeMZones('opp') <= 0) return;
        const sel = await ctx.select(cands, 1, 1, 'Special Summon 1 "Gladiator Beast" monster to your opponent\'s side of the field.', 'cost', { aiScore: (c) => -(c.data.atk ?? 0) });
        if (!sel.length) return;
        const r = await ctx.specialSummon(sel[0], { pos: 'choose', controller: ctx.opp });
        if (r.length) await ctx.draw(1);
      },
      ai: { score: (ctx) => (myOpenMain(ctx) && ctx.hand('me', (c) => isGBMon(c) && (c.data.atk ?? 0) <= 1000).length ? 32 : 0) },
    },
  ],
});

trap('Wall of Thorns', 'normal', {
  text: 'When a Plant-Type monster you control is targeted for an attack: Destroy all Attack Position monsters your opponent controls.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && t.location === 'mzone' && t.controller === ctx.player && raceIs(t, 'Plant');
      },
      resolve: async (ctx) => {
        const list = ctx.monsters('opp', (c) => c.faceUp && c.pos === 'atk');
        if (list.length) await ctx.destroy(list);
      },
      ai: { score: () => 70 },
    },
  ],
});

const virusRegs = new WeakMap<Game, { trap: number; player: PlayerId; until: number }[]>();
trap('Planet Pollutant Virus', 'normal', {
  text: "Tribute 1 \"Alien\" monster; destroy all face-up monsters your opponent controls without A-Counters, also until the end of your opponent's 3rd turn after this card resolves, place 1 A-Counter on each monster they Summon.",
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => tributable(ctx, isAlien).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, isAlien), 1, 1, 'Tribute 1 "Alien" monster.', 'tribute');
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        let l = virusRegs.get(ctx.game);
        if (!l) virusRegs.set(ctx.game, (l = []));
        l.push({ trap: ctx.self.uid, player: ctx.opp, until: ctx.turn + (ctx.isMyTurn ? 5 : 6) });
        const list = ctx.faceUpMonsters('opp', (c) => aCount(c) === 0);
        if (list.length) await ctx.destroy(list);
      },
      ai: {
        score: (ctx) => {
          const hit = ctx.faceUpMonsters('opp', (c) => aCount(c) === 0);
          const v = hit.reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const cost = Math.min(...tributable(ctx, isAlien).map((c) => cardValue(ctx.game, c)));
          return v > cost + 1000 ? 55 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'summoned',
      range: ALL_LOCS,
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || c.location !== 'mzone') return false;
        const reg = (virusRegs.get(ctx.game) ?? []).find((r) => r.trap === ctx.self.uid && r.player === c.controller && ctx.turn <= r.until);
        if (reg) addA(ctx, c);
        return false;
      },
    },
  ],
});

// =================================================================== exports for tests
export const CRMS_TOKENS = { evaToken, kuribohToken, nightmareToken };
