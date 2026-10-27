// Card definitions: Phantom Darkness (PTDN, TCG booster set, January 2008).
// Every PTDN card that no other set file defines. Card text, type, Attribute, Level and ATK/DEF come from the
// YGOJSON v1 aggregate (official English text); behaviour follows the 2010 TCG rulings.
//
// Cards already scripted elsewhere (not repeated here): Dark Grepher, Gladiator Beast Andal, Cyber Valley,
// Dark Armed Dragon, Armageddon Knight, Gigaplant, Gladiator Beast Darius, Gladiator Proving Ground,
// Allure of Darkness, Lonefire Blossom, Goblin Zombie.
//
// Engine hooks reused: EffectDef.replaceDestroyOne (Armored Cybern, Vicious Claw, Battle Archfiend Shield),
// EffectDef.altTribute (Darklord Zerato, Earth/Wind Effigy), 'tributeFodderFor' / 'noTributeSummonFodder'
// flags (tokens, The Immortal Bushi), BattleState.calc. Game-level rules with no engine hook are installed
// per game by `ensurePtdnPatches` (the same way anpr.ts and traps.ts wrap game methods):
//  * damage: Rainbow Life (damage becomes LP gain), Prime Material Dragon (effect damage becomes LP gain);
//  * moveCards: Destiny HERO - Departed (banished instead of the GY from the hand/Deck), Transmigration Break
//    (GY -> Deck becomes banished);
//  * responseLoop: a "before damage calculation" trigger point for Yubel / Yubel - Terror Incarnate;
//  * canNormalSummon / normalSummon: Cry Havoc!'s Normal Monster summon;
//  * altTributeCandidates: a face-down Earth/Wind Effigy can still be used as 2 Tributes.
// The only edit outside this file is a small hook in spells.ts (fusionOptionHooks / onSummoned, "// PTDN:") used
// by Chain Material. Approximations are marked "APPROX:".
import { monster, normal, spell, token, trap } from '../define';
import { bestTarget, cardValue, flip, selfDestroysByBattle } from '../helpers';
import type { CardData, CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { BattleState, ChainLink, Game } from '../../engine/game';
import type { BattlePos, GameEvent, Location, PlayerId, Race, Reason } from '../../engine/types';
import { autoPos, tributable, tributeCost } from './plants';
import { QUESTION_ATK } from './sovr';
import { fusionOptionHooks, type FusionSummonOpts } from './spells';

type C = CardInstance;

// ============================================================ shared helpers

const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const evc = (ev: GameEvent) => ev.card as C | undefined;
const evo = (ev: GameEvent) => ev.other as C | undefined;
const reasonsOf = (ev: { reason?: Reason; reasons?: Reason[] }): Reason[] => ev.reasons ?? (ev.reason ? [ev.reason] : []);
const lvl = (c: C) => c.data.level ?? 0;
const isDark = (c: C) => c.isMonster && c.data.attribute === 'DARK';
const isRace = (c: C, r: Race) => c.isMonster && c.data.race === r;
const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
/** This Spell/Trap is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
/** This monster is face-up on the field and not negated. */
const monActive = (ctx: Ctx) => ctx.self.location === 'mzone' && ctx.self.faceUp && !ctx.game.isNegated(ctx.self);
const mainPhase = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';
const isAi = (ctx: Ctx, p: PlayerId = ctx.player) => !ctx.game.controllers[p].isHuman;
const firstLine = (c: C) => (c.data.fusion?.desc ?? '') + '\n' + (c.data.text ?? '').split('\n')[0];
const revScore = (c: C) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0);
const bestOppAtk = (ctx: Ctx) => Math.max(0, ...ctx.faceUpMonsters('opp').map((m) => (m.pos === 'atk' ? ctx.atk(m) : 0)));

// ---- archetypes / name groups
const isGB = (c: C) => c.isMonster && (c.inSet('gladiator') || c.name.startsWith('Gladiator Beast'));
const isDHeroCard = (c: C) => c.inSet('destiny-hero') || /^destiny hero/i.test(c.name);
const isGemini = (c: C) => c.isMonster && c.hasType('gemini');
const geminiActive = (c: C) => isGemini(c) && c.location === 'mzone' && c.faceUp && !!c.flags.geminiSummoned;
const isNeos = (c: C) =>
  c.isMonster && (c.name.toLowerCase() === 'elemental hero neos' || (c.name === 'Elemental Hero Neos Alius' && c.location === 'mzone' && c.faceUp && !!c.flags.geminiSummoned));
const isUltimateCrystal = (c: C) => c.isMonster && (c.inSet('ultimate-crystal') || c.name === 'Rainbow Dragon' || c.name === 'Rainbow Dark Dragon');
const isCrystalBeast = (c: C) => c.inSet('crystal-beast') || c.name.startsWith('Crystal Beast');
const isSixSamurai = (c: C) => c.isMonster && (c.inSet('six-samurai') || c.name.includes('Six Samurai'));
const listsCyberDragon = (c: C) => c.isMonster && c.hasType('fusion') && /"Cyber Dragon"/.test(firstLine(c));
const listsNeos = (c: C) => c.isMonster && c.hasType('fusion') && /"Elemental HERO Neos"/i.test(firstLine(c));
const isPandemonium = (c: C) => c.name === 'Pandemonium' && c.location === 'fzone' && c.faceUp;

/** Reveal cards from the hand. */
async function reveal(ctx: Ctx, cards: C[], p: PlayerId = ctx.player) {
  if (!cards.length) return;
  for (const c of cards) c.revealedUntil = ctx.turn;
  ctx.game.log(`${ctx.game.players[p].name} reveals ${cards.map((c) => c.name).join(', ')}.`, 'action', p);
  await ctx.game.anim({ type: 'reveal', cards: cards.map((c) => c.uid), player: p });
}

/** Monster battling `self` in the current battle. */
function battleOpponent(ctx: Ctx, self: C = ctx.self): C | null {
  const b = ctx.battle;
  if (!b) return null;
  if (b.attacker === self) return b.target;
  if (b.target === self) return b.attacker;
  return null;
}

/** Events since the start of the current turn's Draw Phase. */
function eventsThisTurn(g: Game): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = g.eventLog.length - 1; i >= 0; i--) {
    const e = g.eventLog[i];
    out.push(e);
    if (e.type === 'phaseStart' && e.phase === 'draw') break;
  }
  return out.reverse();
}

/** Did `p` Summon a monster (Normal, Tribute, Flip or Special) this turn? */
const summonedThisTurn = (g: Game, p: PlayerId) => eventsThisTurn(g).some((e) => e.type === 'summoned' && e.player === p);

/** Every card involved in events of `types` in the same batch as the triggering event. */
function batchCards(ctx: Ctx, types: GameEvent['type'][]): C[] {
  const ev = ctx.event;
  if (!ev) return [];
  const out = ctx.game.eventLog.filter((e) => e.batch === ev.batch && types.includes(e.type)).map((e) => e.card as C);
  return [...new Set(out.filter(Boolean))];
}

/** One DARK monster per name in your GY (for "DARK monsters with different names"). */
function distinctDarkGrave(ctx: Ctx): C[] {
  const by = new Map<string, C>();
  for (const c of ctx.grave('me', isDark)) {
    const prev = by.get(c.name);
    if (!prev || cardValue(ctx.game, c) < cardValue(ctx.game, prev)) by.set(c.name, c);
  }
  return [...by.values()];
}

/** Special Summon 1 card matching `filter` from hand/Deck/GY (ignoring "must be Special Summoned by" rules). */
async function summonFromHandDeckGrave(ctx: Ctx, filter: (c: C) => boolean, prompt: string, proper = true, pos: BattlePos | 'choose' = 'choose') {
  if (!ctx.canSpecialSummon()) return [] as C[];
  const cands = ctx.cards('me', ['hand', 'deck', 'grave'], filter);
  if (!cands.length) return [] as C[];
  const sel = await ctx.select(cands, 1, 1, prompt, 'specialSummon', { aiScore: revScore });
  const fromDeck = sel[0]?.location === 'deck';
  const r = sel.length ? await ctx.specialSummon(sel[0], { pos, ignoreConditions: true, proper }) : [];
  if (fromDeck) ctx.game.shuffleDeck(ctx.player);
  return r;
}

/** Equip Spell activation: target 1 face-up monster that passes `filter`; equip this card to it. */
function equipActivate(o: { filter?: (ctx: Ctx, c: C) => boolean; score: (ctx: Ctx) => number; condition?: (ctx: Ctx) => boolean; categories?: EffectDef['categories']; onEquip?: (ctx: Ctx, t: C) => void }): EffectDef {
  const cands = (ctx: Ctx) => ctx.faceUpMonsters('both', (c) => !o.filter || o.filter(ctx, c));
  return {
    kind: 'activate',
    categories: o.categories ?? ['atkChange'],
    condition: o.condition,
    canActivate: (ctx) => cands(ctx).some((c) => ctx.canTarget(c)),
    activate: async (ctx) => {
      await ctx.selectTargets(cands(ctx), 1, 1, 'Target 1 face-up monster to equip this card to.', 'equip', {
        aiScore: (c) => (c.controller === ctx.player ? ctx.atk(c) + 1000 : -10000),
      });
    },
    resolve: async (ctx) => {
      const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && (!o.filter || o.filter(ctx, c)))[0];
      if (!t || !ctx.self.onField || !ctx.self.faceUp) return;
      ctx.equip(t);
      o.onEquip?.(ctx, t);
    },
    ai: { score: o.score },
  };
}
const ownEquipScore = (ctx: Ctx, filter: (c: C) => boolean, base = 30) => {
  if (!mainPhase(ctx)) return 0;
  return ctx.faceUpMonsters('me', filter).length ? base : 0;
};

/** Tribute as part of an effect's resolution (not a cost). */
async function tributeByEffect(ctx: Ctx, cards: C[]) {
  if (!cards.length) return;
  ctx.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`);
  await ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'effect'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}

// ---------------------------------------------------------------- Trap Monsters
// APPROX (same technique as abpf.ts): the engine has no "Trap Monster" hook, so the card instance's `data` is
// shadowed by a monster copy while it is in the Monster Zone. The real CardData is never modified.
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

function trapMonsterActivate(stats: Partial<CardData>, score: (ctx: Ctx) => number, after?: (ctx: Ctx, me: C) => void): EffectDef {
  return {
    kind: 'activate',
    categories: ['specialSummon'],
    canActivate: (ctx) => ctx.canSpecialSummon(),
    resolve: async (ctx) => {
      const me = ctx.self;
      if (!me.onField) return;
      if (!dataPatches.has(me)) patchData(me, (orig, c) => (c.location === 'mzone' ? variant(orig, 'trap-monster', { kind: 'monster', mtypes: ['effect'], ...stats }) : undefined));
      const r = await ctx.specialSummon(me, { pos: 'def' });
      if (r.length) {
        me.flags.staysOnField = true;
        me.flags.ptdnTrapMonster = true;
        me.flags.trapMonster = true;
        after?.(ctx, me);
      }
    },
    ai: { score },
  };
}
/** AI: Trap Monsters are flipped when the opponent attacks directly, or at the end of the opponent's turn. */
const trapMonsterScore = (ctx: Ctx) => {
  if (ctx.isMyTurn || ctx.game.chain.length) return 0;
  const b = ctx.battle;
  if (b && !b.target && !b.inDamageStep) return 45;
  return ctx.phase === 'end' ? 35 : 0;
};

// ---------------------------------------------------------------- per-game rule patches

const DEPARTED = 'Destiny HERO - Departed';
const YUBEL_BURNERS = new Set(['Yubel', 'Yubel - Terror Incarnate']);
const PATCHED = new WeakSet<Game>();
const transmigrationOn = (g: Game) => g.allFieldCards().some((c) => c.name === 'Transmigration Break' && c.faceUp && c.activeOnField && !g.isNegated(c));
const primeMaterialOn = (g: Game) => g.allFieldCards().some((c) => c.name === 'Prime Material Dragon' && c.location === 'mzone' && c.faceUp && !g.isNegated(c));
/** Effigy rule: can `tribute` count as 2 Tributes for `summoned`? */
function effigyFor(tribute: C, summoned: C) {
  const a = tribute.name === 'Earth Effigy' ? 'EARTH' : tribute.name === 'Wind Effigy' ? 'WIND' : null;
  return !!a && summoned.data.attribute === a && summoned.hasType('normal') && !summoned.isToken;
}

export function ensurePtdnPatches(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;

  // Rainbow Life / Prime Material Dragon: damage becomes an LP gain.
  const origDamage = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: C, sourcePlayer?: PlayerId) => {
    if (Math.floor(amount) > 0) {
      if (g.turnData[`ptdn:rainbowLife:${p}`]) {
        g.log(`Rainbow Life: ${g.players[p].name} gains LP instead of taking damage.`, 'damage', p);
        await g.recover(p, amount, source);
        return 0;
      }
      if (kind === 'effect' && primeMaterialOn(g)) {
        g.log(`Prime Material Dragon: the damage to ${g.players[p].name} becomes an LP gain.`, 'damage', p);
        await g.recover(p, amount, source);
        return 0;
      }
    }
    return origDamage(p, amount, kind, source, sourcePlayer);
  };

  // Destiny HERO - Departed / Transmigration Break.
  const origMove = g.moveCards.bind(g);
  anyG.moveCards = async (cards: C[], to: Location, opts: Parameters<Game['moveCards']>[2]) => {
    const rs = reasonsOf(opts);
    if (to === 'grave' && !rs.includes('rule')) {
      const dep = cards.filter((c) => c.name === DEPARTED && (c.location === 'hand' || c.location === 'deck'));
      if (dep.length) {
        const rest = cards.filter((c) => !dep.includes(c));
        const r1 = rest.length ? await origMove(rest, to, opts) : [];
        g.log(`${DEPARTED} is banished instead of being sent to the GY.`, 'action', dep[0].owner);
        const r2 = await origMove(dep, 'banished', { ...opts, faceUp: true });
        return [...r1, ...r2];
      }
    }
    if (to === 'deck' && transmigrationOn(g)) {
      const fromGY = cards.filter((c) => c.location === 'grave');
      if (fromGY.length) {
        const rest = cards.filter((c) => !fromGY.includes(c));
        const r1 = rest.length ? await origMove(rest, to, opts) : [];
        g.log('Transmigration Break: the cards are banished instead of returning to the Deck.', 'action');
        const r2 = await origMove(fromGY, 'banished', { reason: opts.reason, reasons: opts.reasons, reasonPlayer: opts.reasonPlayer, reasonCard: opts.reasonCard, faceUp: true });
        return [...r1, ...r2];
      }
    }
    return origMove(cards, to, opts);
  };

  // Yubel / Yubel - Terror Incarnate: "Before damage calculation, if this face-up Attack Position card is targeted
  // for an attack" — a trigger point at the start of the Damage Step window (event 'targeted', data.ptdnBeforeCalc).
  const origResp = g.responseLoop.bind(g);
  anyG.responseLoop = async (kind: Parameters<Game['responseLoop']>[0], first: PlayerId, prompt = '') => {
    const b = g.battle as (BattleState & { ptdnBdc?: boolean }) | null;
    if (kind === 'damage' && b && b.inDamageStep && !b.calc && !b.negated && !g.chain.length && !b.ptdnBdc) {
      b.ptdnBdc = true;
      const t = b.target;
      if (t && t.location === 'mzone' && t.faceUp && t.pos === 'atk' && YUBEL_BURNERS.has(t.name)) {
        g.beginBatch();
        g.emit({ type: 'targeted', card: t, other: b.attacker, player: b.attacker.controller, minor: true, data: { ptdnBeforeCalc: true } });
        for (let i = 0; i < 5 && g.pending.length; i++) {
          const built = await g.buildTriggerChainPublic();
          if (!built) break;
          await g.runChain();
        }
      }
    }
    return origResp(kind, first, prompt);
  };

  // Cry Havoc!: the extra Normal Summon/Set it grants is for a Normal Monster only.
  const origCanNS = g.canNormalSummon.bind(g);
  anyG.canNormalSummon = (p: PlayerId, card: C, set = false) => {
    if (!origCanNS(p, card, set)) return false;
    const pend = (g.turnData[`ptdn:cryHavoc:${p}`] as number | undefined) ?? 0;
    if (pend > 0 && g.players[p].normalSummonsLeft <= pend && !card.hasType('normal')) return false;
    return true;
  };
  const origNS = g.normalSummon.bind(g);
  anyG.normalSummon = async (p: PlayerId, card: C, set: boolean) => {
    const key = `ptdn:cryHavoc:${p}`;
    const pend = (g.turnData[key] as number | undefined) ?? 0;
    const before = g.players[p].normalSummonsLeft;
    await origNS(p, card, set);
    if (pend > 0 && card.hasType('normal') && g.players[p].normalSummonsLeft < before) g.turnData[key] = pend - 1;
  };

  // Earth / Wind Effigy: also usable as 2 Tributes while face-down.
  const origAlt = g.altTributeCandidates.bind(g);
  anyG.altTributeCandidates = (p: PlayerId, card: C) => {
    const r = origAlt(p, card);
    if (g.tributesNeeded(card) < 2) return r;
    const more = g.monsters(p).filter((c) => !c.faceUp && !r.includes(c) && effigyFor(c, card) && !g.queryCard(c, 'cannotBeTributed'));
    return more.length ? [...r, ...more] : r;
  };
}

/** Installs the per-game patches at the first phase (from any location, never activates). */
const PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  label: '(rules)',
  eventFilter: (ctx) => {
    ensurePtdnPatches(ctx.game);
    return false;
  },
};

// ---------------------------------------------------------------- Spell resolution watcher
// "Each time a Spell Card is activated, ... when that Spell resolves" / "after resolving a Spell Card": the engine
// emits no event when a chain link resolves, so the Spell's link gets a wrapper that emits 'chainResolved'
// (data.ptdnSpell) right after its effect resolves (the same link-wrapping technique as Spirit Reaper).
interface SpellInfo {
  ptdnSpell: true;
  player: PlayerId;
  turnPlayer: PlayerId;
  /** The Spell was Chain Link 1 (nothing resolves after it). */
  cl1?: boolean;
  phase: Game['phase'];
}
function watchSpell(g: Game, link: ChainLink) {
  const l = link as ChainLink & { ptdnWatched?: boolean };
  if (l.ptdnWatched || !link.isCardActivation || !link.card.isSpell) return;
  l.ptdnWatched = true;
  const info: SpellInfo = { ptdnSpell: true, player: link.player, turnPlayer: g.turnPlayer, phase: g.phase };
  const orig = link.effect;
  link.effect = {
    ...orig,
    resolve: async (c) => {
      info.cl1 = g.chain.length === 0 || g.chain[0] === link;
      if (orig.resolve) await orig.resolve(c);
      g.beginBatch();
      g.emit({ type: 'chainResolved', card: link.card, player: link.player, minor: true, data: info });
    },
  };
}
const SPELL_WATCH: EffectDef = {
  kind: 'trigger',
  event: 'chainActivated',
  label: '(watch Spell resolution)',
  eventFilter: (ctx, ev) => {
    const link = ev.data?.link as ChainLink | undefined;
    if (link && ctx.self.onField && ctx.self.faceUp) watchSpell(ctx.game, link);
    return false;
  },
};
const spellResolved = (ev: GameEvent) => (ev.data?.ptdnSpell ? (ev.data as SpellInfo) : null);

// ---------------------------------------------------------------- Gemini helpers

/** Turn a face-up Gemini monster into an Effect Monster (Gemini Summon, Unleash Your Power!). */
function makeGeminiActive(ctx: Ctx, c: C) {
  if (c.location !== 'mzone' || !c.faceUp || !isGemini(c)) return;
  c.flags.geminiSummoned = true;
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
        const better = ctx.hand('me', (c) => c.isMonster && ctx.game.canNormalSummon(ctx.player, c) && revScore(c) > 1900);
        if (ctx.phase === 'main1' && better.length) return 0;
        return score(ctx);
      },
    },
  };
}
const gemini = (ctx: Ctx) => geminiActive(ctx.self);

// ============================================================ MONSTERS

normal(
  'Atlantean Pikeman',
  'WATER',
  'Sea Serpent',
  2,
  1400,
  0,
  'The Great Ocean Lord, who reigns over the depths, is served by these lancers. Deep-sea creatures exist in fear of facing the stream of attacks their lances are capable of.',
);

monster('Rainbow Dark Dragon', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 10,
  atk: 4000,
  def: 0,
  sets: ['ultimate-crystal'],
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 800,
  text: '(This card is always treated as an "Ultimate Crystal" card.)\nCannot be Normal Summoned/Set. Must be Special Summoned (from your hand) by banishing 7 DARK monsters with different names from your GY. You can banish all other DARK monsters from your field and GY; this card gains 500 ATK for each card banished this way.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (banish 7 DARK monsters)',
      categories: ['specialSummon', 'banish'],
      condition: (ctx) => ctx.freeMZones() > 0 && distinctDarkGrave(ctx).length >= 7,
      perform: async (ctx) => {
        const reps = distinctDarkGrave(ctx);
        const sel = await ctx.select(reps, 7, 7, 'Banish 7 DARK monsters with different names from your GY.', 'cost');
        if (sel.length < 7) return false;
        await ctx.banish(sel, 'cost');
        return true;
      },
      ai: { score: () => 76 },
    },
    {
      kind: 'ignition',
      label: 'Banish all other DARK monsters: +500 ATK each',
      categories: ['atkChange', 'banish'],
      canActivate: (ctx) => ctx.grave('me', isDark).length + ctx.faceUpMonsters('me', (c) => c !== ctx.self && isDark(c)).length > 0,
      activate: async (ctx) => {
        const list = [...ctx.faceUpMonsters('me', (c) => c !== ctx.self && isDark(c)), ...ctx.grave('me', isDark)];
        ctx.data.n = list.length;
        await ctx.banish(list, 'cost');
      },
      resolve: async (ctx) => {
        if (monActive(ctx)) ctx.addTempMod(ctx.self, 'atk', 500 * (ctx.data.n ?? 0), 'field');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1') return 0;
          const field = ctx.faceUpMonsters('me', (c) => c !== ctx.self && isDark(c));
          const gy = ctx.grave('me', isDark).length;
          if (field.length || gy < 2) return 0;
          return 35;
        },
      },
    },
  ],
});

const roseToken = token('Regenerating Rose Token', 'DARK', 'Plant', 3, 1200, 1200, 'Regenerating Rose Token (Plant-Type/DARK/Level 3/ATK 1200/DEF 1200). Special Summoned by "Regenerating Rose".');

monster('Samsara Lotus', {
  attribute: 'DARK',
  race: 'Plant',
  level: 1,
  atk: 0,
  def: 0,
  aiValue: 200,
  text: "During your End Phase, if you control no Spell or Trap Cards, you can Special Summon this card from your Graveyard in face-up Attack Position. This card's controller takes 1000 damage during each of their Standby Phases.",
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Special Summon from the GY',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn,
      condition: (ctx) => ctx.spellTraps('me').length === 0,
      canActivate: (ctx) => ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave' && ctx.spellTraps('me').length === 0 && ctx.canSummonCard(ctx.self)) await ctx.specialSummon(ctx.self, { pos: 'atk' });
      },
      ai: { score: (ctx) => (ctx.lp > 3000 && ctx.monsters('me').length < 3 ? 1 : 0) },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Controller takes 1000 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.location === 'mzone' && ctx.self.faceUp,
      resolve: async (ctx) => {
        // https://edisonrul.ing/cards/s/samsara-lotus.html — flipped face-down in the chain (Book of Moon): the effect disappears.
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) await ctx.damage(ctx.player, 1000);
      },
    },
  ],
});

monster('Regenerating Rose', {
  attribute: 'DARK',
  race: 'Plant',
  level: 7,
  atk: 0,
  def: 1500,
  aiValue: 300,
  text: 'When this card is destroyed by battle and sent to the Graveyard, you can Special Summon 2 "Regenerating Rose Tokens" (Plant-Type/DARK/Level 3/ATK 1200/DEF 1200).',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Summon 2 Regenerating Rose Tokens',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && ev.to === 'grave' && reasonsOf(ev).includes('battle'),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.freeMZones() >= 2,
      resolve: async (ctx) => {
        if (ctx.freeMZones() < 2 || !ctx.canSpecialSummon()) return;
        await ctx.createTokens(roseToken, 2, bestOppAtk(ctx) > 1200 ? 'def' : 'atk');
      },
    },
  ],
});

// ---------------------------------------------------------------- Yubel

/** "Before damage calculation, if this face-up Attack Position card is targeted for an attack". */
const yubelBurn: EffectDef = {
  kind: 'trigger',
  event: 'targeted',
  mandatory: true,
  label: "Inflict damage equal to the attacker's ATK",
  categories: ['damage'],
  eventFilter: (ctx, ev) => {
    const a = evo(ev);
    return !!ev.data?.ptdnBeforeCalc && ev.card === ctx.self && ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.self.pos === 'atk' && !!a && a.controller !== ctx.player;
  },
  activate: async (ctx) => {
    const a = evo(ctx.event!);
    ctx.data.att = a;
    ctx.data.mid = a?.moveId;
  },
  resolve: async (ctx) => {
    const a = ctx.data.att as C | undefined;
    if (a && a.location === 'mzone' && a.faceUp && a.moveId === ctx.data.mid) await ctx.damage(ctx.opp, ctx.atk(a));
  },
};
const yubelBody: EffectDef = { kind: 'continuous', mods: [{ q: 'indestructibleBattle' }, { q: 'noBattleDamageFrom' }] };

monster('Yubel', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 10,
  atk: 0,
  def: 0,
  aiValue: 1400,
  text: 'Cannot be destroyed by battle. You take no battle damage from battles involving this card. Before damage calculation, if this face-up Attack Position card is targeted for an attack: Inflict damage to your opponent equal to that attacking monster\'s ATK. Once per turn, during your End Phase: Tribute 1 other monster or destroy this card. When this card is destroyed, except by its own effect: Its owner can Special Summon 1 "Yubel - Terror Incarnate" from their hand, Deck, or GY.',
  effects: [
    PATCH_LISTENER,
    yubelBody,
    yubelBurn,
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      opt: true,
      label: 'Tribute 1 other monster or destroy Yubel',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && ctx.self.location === 'mzone' && ctx.self.faceUp,
      resolve: async (ctx) => {
        if (!monActive(ctx)) return;
        const others = tributable(ctx, (c) => c !== ctx.self);
        const cheapest = others.length ? Math.min(...others.map((c) => cardValue(ctx.game, c))) : Infinity;
        let choice = 1;
        if (others.length) {
          // Destroyed by its own effect, Yubel does not bring out "Yubel - Terror Incarnate".
          choice = await ctx.option('Yubel: Tribute 1 other monster, or destroy Yubel?', ['Tribute 1 other monster', 'Destroy Yubel'], (i) =>
            i === 1 ? 0 : cheapest < 2600 ? 50 : -10,
          );
        }
        if (choice === 0) {
          const s = await ctx.select(others, 1, 1, 'Tribute 1 other monster (Yubel).', 'tribute');
          if (s.length) {
            await tributeByEffect(ctx, s);
            return;
          }
        }
        await ctx.destroy(ctx.self);
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      when: true,
      label: 'Special Summon "Yubel - Terror Incarnate"',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && ev.reasonCard !== ctx.self,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'deck', 'grave'], (c) => c.name === 'Yubel - Terror Incarnate').length > 0,
      resolve: async (ctx) => {
        await summonFromHandDeckGrave(ctx, (c) => c.name === 'Yubel - Terror Incarnate', 'Special Summon 1 "Yubel - Terror Incarnate" from your hand, Deck, or GY.', true, 'atk');
      },
    },
  ],
});

monster('Yubel - Terror Incarnate', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 11,
  atk: 0,
  def: 0,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1600,
  text: 'Cannot be Normal Summoned or Set. Must be Special Summoned by "Yubel". Cannot be destroyed by battle. You take no battle damage from battles involving this card. Before damage calculation, if this face-up Attack Position card is targeted for an attack: Inflict damage to your opponent equal to that attacking monster\'s ATK. Once per turn, during your End Phase: Destroy all other monsters on the field. When this face-up card leaves the field: You can Special Summon 1 "Yubel - The Ultimate Nightmare" from your hand, Deck, or GY.',
  effects: [
    PATCH_LISTENER,
    yubelBody,
    yubelBurn,
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      opt: true,
      label: 'Destroy all other monsters',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && ctx.self.location === 'mzone' && ctx.self.faceUp,
      resolve: async (ctx) => {
        const list = ctx.monsters('both', (c) => c !== ctx.self);
        if (list.length) await ctx.destroy(list);
      },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      when: true,
      label: 'Special Summon "Yubel - The Ultimate Nightmare"',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && !!ev.fromFaceUp,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'deck', 'grave'], (c) => c.name === 'Yubel - The Ultimate Nightmare').length > 0,
      resolve: async (ctx) => {
        await summonFromHandDeckGrave(ctx, (c) => c.name === 'Yubel - The Ultimate Nightmare', 'Special Summon 1 "Yubel - The Ultimate Nightmare" from your hand, Deck, or GY.', true, 'atk');
      },
    },
  ],
});

monster('Yubel - The Ultimate Nightmare', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 12,
  atk: 0,
  def: 0,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1600,
  text: "Cannot be Normal Summoned or Set. Must be Special Summoned by \"Yubel - Terror Incarnate\". Cannot be destroyed by battle. You take no battle damage from battles involving this card. At the end of the Damage Step, if this face-up Attack Position card battled an opponent's monster: Inflict damage to your opponent equal to that opponent's monster's ATK, also destroy that monster.",
  effects: [
    yubelBody,
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: "Inflict damage equal to the battled monster's ATK and destroy it",
      categories: ['damage', 'destroy'],
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        if (me.location !== 'mzone' || !me.faceUp || me.pos !== 'atk') return false;
        const o = ev.card === me ? evo(ev) : ev.other === me ? evc(ev) : undefined;
        return !!o && o !== me && (o.location !== 'mzone' || o.controller !== ctx.player);
      },
      activate: async (ctx) => {
        const ev = ctx.event!;
        const o = (ev.card === ctx.self ? evo(ev) : evc(ev)) as C;
        ctx.data.o = o;
        ctx.data.mid = o.moveId;
        const b = ctx.battle;
        const calc = b?.calc ? (o === b.attacker ? b.calc.attackerAtk : b.calc.targetAtk) : 0;
        ctx.data.atk = faceUpOn(o) ? ctx.atk(o) : calc;
      },
      resolve: async (ctx) => {
        const o = ctx.data.o as C;
        const still = o.location === 'mzone' && o.moveId === ctx.data.mid;
        await ctx.damage(ctx.opp, still && o.faceUp ? ctx.atk(o) : ctx.data.atk ?? 0);
        if (still) await ctx.destroy(o);
      },
    },
  ],
});

// ---------------------------------------------------------------- Machines / Cyber

const cybernHosts = (ctx: Ctx) =>
  ctx.faceUpMonsters('me', (c) => c !== ctx.self && (c.name === 'Cyber Dragon' || listsCyberDragon(c)) && !ctx.game.equipsOf(c).some((e) => e.isMonster && e.hasType('union')));
monster('Armored Cybern', {
  attribute: 'WIND',
  race: 'Machine',
  level: 4,
  atk: 0,
  def: 2000,
  types: ['union'],
  aiValue: 400,
  text: 'Once per turn, you can either: Target 1 "Cyber Dragon" you control, or 1 Fusion Monster you control that lists "Cyber Dragon" as Fusion Material; equip this card to that target, OR: Unequip this card and Special Summon it. Once per turn, while equipped to a monster by this effect: You can target 1 face-up monster on the field; the equipped monster loses exactly 1000 ATK (even if this card leaves the field), and if it does, destroy that target. If the equipped monster would be destroyed by battle or card effect, destroy this card instead.',
  effects: [
    {
      kind: 'ignition',
      range: ['mzone', 'szone'],
      opt: true,
      label: 'Equip / Unequip',
      categories: ['atkChange'],
      condition: (ctx) =>
        ctx.self.location === 'mzone'
          ? ctx.self.faceUp && ctx.freeSZones() > 0 && cybernHosts(ctx).some((c) => ctx.canTarget(c))
          : ctx.self.location === 'szone' && !!ctx.self.flags.unionEquipped && ctx.equipTarget !== undefined && ctx.canSummonSelf(),
      activate: async (ctx) => {
        ctx.data.mode = ctx.self.location === 'mzone' ? 'equip' : 'unequip';
        if (ctx.data.mode === 'equip') await ctx.selectTargets(cybernHosts(ctx), 1, 1, 'Target 1 "Cyber Dragon" (or a Fusion Monster that lists it) to equip Armored Cybern to.', 'equip');
      },
      resolve: async (ctx) => {
        if (ctx.data.mode === 'equip') {
          const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && c.controller === ctx.player)[0];
          if (!t || ctx.self.location !== 'mzone' || !ctx.self.faceUp || ctx.freeSZones() <= 0) return;
          ctx.game.rawMove(ctx.self, 'szone', { controller: ctx.player, faceUp: true });
          ctx.game.equip(ctx.self, t);
          ctx.self.flags.unionEquipped = true;
          ctx.game.update();
        } else if (ctx.self.location === 'szone') {
          await ctx.specialSummon(ctx.self, { pos: 'choose' });
        }
      },
      ai: {
        score: (ctx) => {
          if (ctx.self.location !== 'mzone' || ctx.phase !== 'main1') return 0;
          return cybernHosts(ctx).some((c) => ctx.atk(c) >= 2100) && ctx.faceUpMonsters('opp').length ? 40 : 0;
        },
      },
    },
    {
      kind: 'ignition',
      range: ['szone'],
      opt: true,
      label: 'Equipped monster loses 1000 ATK: destroy 1 face-up monster',
      categories: ['destroy', 'atkChange'],
      condition: (ctx) => ctx.self.location === 'szone' && !!ctx.self.flags.unionEquipped && !!ctx.equipTarget && ctx.atk(ctx.equipTarget) >= 1000,
      canActivate: (ctx) => ctx.faceUpMonsters('both').some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        const host = ctx.equipTarget!;
        ctx.data.host = host;
        ctx.data.hostMid = host.moveId;
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const host = ctx.data.host as C;
        if (!faceUpOn(host) || host.moveId !== ctx.data.hostMid || ctx.atk(host) < 1000) return;
        ctx.addTempMod(host, 'atk', -1000, 'field');
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (t) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const host = ctx.equipTarget;
          if (!host) return 0;
          const foe = ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c));
          if (!foe.length) return 0;
          return cardValue(ctx.game, bestTarget(ctx.game, foe)) >= 1500 ? 55 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      range: ['szone'],
      replaceDestroyOne: async (ctx, card, reason) => {
        if (!ctx.self.flags.unionEquipped || card !== ctx.equipTarget || !ctx.self.onField || (reason !== 'battle' && reason !== 'effect')) return false;
        ctx.log(`${ctx.self.name} is destroyed instead.`);
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        return ctx.self.location !== 'szone';
      },
    },
  ],
});

monster('Cyber Ouroboros', {
  attribute: 'DARK',
  race: 'Machine',
  level: 2,
  atk: 100,
  def: 600,
  aiValue: 200,
  text: 'When this card is removed from play, you can send 1 card from your hand to the Graveyard to draw 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: 'banished',
      when: true,
      label: 'Send 1 card from hand to the GY: draw 1',
      categories: ['draw'],
      canActivate: (ctx) => ctx.hand('me').length > 0 && ctx.deck('me').length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.hand('me'), 1, 1, 'Send 1 card from your hand to the GY.', 'cost');
        if (!s.length) return false;
        await ctx.sendToGrave(s, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

monster('Volcanic Counter', {
  attribute: 'FIRE',
  race: 'Pyro',
  level: 3,
  atk: 300,
  def: 1300,
  aiValue: 200,
  text: 'When you take battle damage while this card is in your Graveyard: Banish it from your Graveyard, then if there is a FIRE monster other than "Volcanic Counter" in your Graveyard, inflict damage to your opponent equal to the amount of battle damage you took.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      range: ['grave'],
      mandatory: true,
      label: 'Banish: inflict the same damage',
      categories: ['damage', 'banish'],
      eventFilter: (ctx, ev) => ev.player === ctx.player && ctx.self.location === 'grave',
      activate: async (ctx) => {
        ctx.data.amount = ctx.event?.amount ?? 0;
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave') return;
        await ctx.banish(ctx.self);
        if (ctx.grave('me', (c) => c.isMonster && c.data.attribute === 'FIRE' && c.name !== 'Volcanic Counter').length) await ctx.damage(ctx.opp, ctx.data.amount ?? 0);
      },
    },
  ],
});

monster('Fire Trooper', {
  attribute: 'FIRE',
  race: 'Warrior',
  level: 3,
  atk: 1000,
  def: 1000,
  aiValue: 100,
  text: 'When this card is Summoned, you can send it to the Graveyard to inflict 1000 damage to your opponent.',
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      when: true,
      label: 'Send to the GY: inflict 1000 damage',
      categories: ['damage'],
      canActivate: (ctx) => ctx.self.location === 'mzone' && ctx.self.faceUp,
      activate: async (ctx) => {
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 1000);
      },
      ai: {
        score: (ctx) => {
          if (ctx.oppLp <= 1000) return 10;
          if (bestOppAtk(ctx) > 1000) return 5;
          return ctx.phase === 'main2' ? 3 : 0;
        },
      },
    },
  ],
});

monster('Destiny HERO - Dunker', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 1200,
  def: 1700,
  sets: ['hero', 'destiny-hero'],
  aiValue: 200,
  text: 'You can send 1 "Destiny HERO" card from your hand to the Graveyard; inflict 500 damage to your opponent.',
  effects: [
    {
      kind: 'ignition',
      label: 'Send a "Destiny HERO" card: 500 damage',
      categories: ['damage'],
      canActivate: (ctx) => ctx.hand('me', isDHeroCard).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.hand('me', isDHeroCard), 1, 1, 'Send 1 "Destiny HERO" card from your hand to the GY.', 'cost', {
          aiScore: (c) => (c.name === 'Destiny Hero - Malicious' || c.name === 'Destiny Hero - Diamond Dude' ? 1000 : 0) - (c.data.aiValue ?? 0),
        });
        if (!s.length) return false;
        await ctx.sendToGrave(s, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500);
      },
      ai: {
        score: (ctx) => {
          if (ctx.oppLp <= 500) return 90;
          return ctx.hand('me', (c) => c.name === 'Destiny Hero - Malicious').length && ctx.phase === 'main2' ? 32 : 0;
        },
      },
    },
  ],
});

monster(DEPARTED, {
  attribute: 'DARK',
  race: 'Warrior',
  level: 2,
  atk: 1000,
  def: 0,
  sets: ['hero', 'destiny-hero'],
  aiValue: 0,
  text: "During your Standby Phase, if this card is in your Graveyard: Special Summon it in face-up Attack Position to your opponent's side of the field. If this card is destroyed by battle, banish it instead of sending it to the Graveyard. If a card effect would send this card to the Graveyard from the hand or Deck, banish it instead.",
  effects: [
    PATCH_LISTENER,
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      mandatory: true,
      label: "Special Summon to the opponent's field",
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn,
      condition: (ctx) => !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') && ctx.game.freeMZones(ctx.opp) > 0,
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave' && ctx.game.freeMZones(ctx.opp) > 0) await ctx.specialSummon(ctx.self, { pos: 'atk', controller: ctx.opp });
      },
    },
    {
      // Listener: destroyed by battle -> banished instead of the GY (the engine then emits 'banished', not 'sentToGrave').
      kind: 'trigger',
      event: 'battleDestroyed',
      label: '(banished instead)',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && ctx.self.location === 'grave') {
          ctx.game.rawMove(ctx.self, 'banished', { faceUp: true });
          ctx.game.log(`${DEPARTED} is banished instead of being sent to the GY.`, 'action', ctx.self.owner);
        }
        return false;
      },
    },
  ],
});

monster('Dark Horus', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 8,
  atk: 3000,
  def: 1800,
  aiValue: 400,
  text: "Once per turn, after resolving a Spell Card that was activated during your opponent's Main Phase: You can target 1 Level 4 DARK monster in your Graveyard; Special Summon that target. This card must be face-up on the field to activate and to resolve this effect.",
  effects: [
    SPELL_WATCH,
    {
      kind: 'trigger',
      event: 'chainResolved',
      opt: true,
      label: 'Revive a Level 4 DARK monster',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const info = spellResolved(ev);
        // Activates after the Spell resolves and misses the timing unless that Spell was Chain Link 1:
        // https://edisonrul.ing/cards/d/dark-horus.html
        return !!info && !!info.cl1 && info.player === ctx.opp && info.turnPlayer === ctx.opp && (info.phase === 'main1' || info.phase === 'main2') && monActive(ctx);
      },
      canActivate: (ctx) => monActive(ctx) && ctx.canSpecialSummon() && ctx.grave('me', (c) => isDark(c) && lvl(c) === 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isDark(c) && lvl(c) === 4 && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 4 DARK monster in your GY.', 'specialSummon', { aiScore: revScore });
      },
      resolve: async (ctx) => {
        if (!monActive(ctx)) return;
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t, { pos: autoPos(ctx, t) });
      },
    },
  ],
});

monster('The Dark Creator', {
  attribute: 'DARK',
  race: 'Thunder',
  level: 8,
  atk: 2300,
  def: 3000,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 700,
  text: 'Cannot be Normal Summoned/Set. Must first be Special Summoned (from your hand) by having 5 or more DARK monsters in your Graveyard while you control no monsters. Once per turn: You can banish 1 DARK monster from your Graveyard to target 1 DARK monster in your Graveyard; Special Summon that target.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (5+ DARK monsters in the GY)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.monsters('me').length === 0 && ctx.grave('me', isDark).length >= 5,
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish 1 DARK: revive 1 DARK',
      categories: ['specialSummon', 'banish'],
      canActivate: (ctx) => {
        if (!ctx.canSpecialSummon()) return false;
        const g = ctx.grave('me', isDark);
        return g.length >= 2 && g.some((t) => ctx.canSummonCard(t));
      },
      activate: async (ctx) => {
        const g = ctx.grave('me', isDark);
        const targets = g.filter((t) => ctx.canSummonCard(t));
        const best = [...targets].sort((a, b) => revScore(b) - revScore(a))[0];
        const costs = g.filter((c) => targets.some((t) => t !== c));
        const s = await ctx.select(costs, 1, 1, 'Banish 1 DARK monster from your GY.', 'cost', { aiScore: (c) => (c === best ? -99999 : -revScore(c)) });
        if (!s.length) return false;
        await ctx.banish(s, 'cost');
        await ctx.selectTargets(ctx.grave('me', (c) => isDark(c) && ctx.canSummonCard(c)), 1, 1, 'Target 1 DARK monster in your GY to Special Summon.', 'specialSummon', { aiScore: revScore });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t, { pos: autoPos(ctx, t) });
      },
      ai: { score: (ctx) => (ctx.grave('me', (c) => isDark(c) && ctx.canSummonCard(c) && revScore(c) >= 1400).length ? 58 : 0) },
    },
  ],
});

monster('Dark Nephthys', {
  attribute: 'DARK',
  race: 'Winged Beast',
  level: 8,
  atk: 2400,
  def: 1600,
  aiValue: 500,
  text: 'If you have 3 or more DARK monsters in your Graveyard and this card in your hand: You can banish 2 of them from your Graveyard; send this card from your hand to the Graveyard. During your next Standby Phase after this card was sent to the Graveyard by this effect: Special Summon this card from the Graveyard. When this card is Special Summoned: Target 1 Spell/Trap Card on the field; destroy that target.',
  effects: [
    {
      kind: 'ignition',
      range: ['hand'],
      label: 'Banish 2 DARK: send this card to the GY',
      categories: ['banish'],
      canActivate: (ctx) => ctx.grave('me', isDark).length >= 3,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.grave('me', isDark), 2, 2, 'Banish 2 DARK monsters from your GY.', 'cost', { aiScore: (c) => -revScore(c) });
        if (s.length < 2) return false;
        await ctx.banish(s, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'hand') return;
        await ctx.sendToGrave(ctx.self);
        if ((ctx.self.location as Location) === 'grave') ctx.self.flags.nephthysTurn = ctx.turn;
      },
      ai: { score: (ctx) => (ctx.grave('me', isDark).length >= 4 && ctx.hand('me').length >= 2 ? 34 : 0) },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      mandatory: true,
      label: 'Special Summon from the GY',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.flags.nephthysTurn !== undefined && ctx.turn > ctx.self.flags.nephthysTurn,
      resolve: async (ctx) => {
        delete ctx.self.flags.nephthysTurn;
        if (ctx.self.location === 'grave' && ctx.canSummonCard(ctx.self)) await ctx.specialSummon(ctx.self, { pos: autoPos(ctx, ctx.self) });
      },
    },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Destroy 1 Spell/Trap',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.spellTraps('both').some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell/Trap Card on the field to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
    },
  ],
});

monster('Dark Crusader', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 1600,
  def: 200,
  aiValue: 200,
  text: 'You can send 1 DARK monster from your hand to the Graveyard; this card gains 400 ATK.',
  effects: [
    {
      kind: 'ignition',
      label: 'Send a DARK monster: +400 ATK',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.hand('me', isDark).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.hand('me', isDark), 1, 1, 'Send 1 DARK monster from your hand to the GY.', 'cost');
        if (!s.length) return false;
        await ctx.sendToGrave(s, 'cost');
      },
      resolve: async (ctx) => {
        if (monActive(ctx)) ctx.addTempMod(ctx.self, 'atk', 400, 'field');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.self.pos !== 'atk') return 0;
          const atk = ctx.atk(ctx.self);
          const foes = ctx.faceUpMonsters('opp', (c) => c.pos === 'atk');
          const unlock = foes.some((c) => ctx.atk(c) >= atk && ctx.atk(c) < atk + 400);
          const fuel = ctx.hand('me', isDark).some((c) => (c.data.level ?? 0) >= 5 && c.name !== 'Dark Armed Dragon');
          return unlock && fuel ? 36 : 0;
        },
      },
    },
  ],
});

monster('Doomsday Horror', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 0,
  def: 0,
  aiValue: 300,
  text: 'This card\'s ATK and DEF are equal to the number of banished DARK monsters x 300. If this card is destroyed and sent to the Graveyard: Return all banished DARK monsters to the Graveyards.',
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', value: (ctx) => 300 * ctx.banished('both', isDark).length },
        { q: 'def', value: (ctx) => 300 * ctx.banished('both', isDark).length },
      ],
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Return all banished DARK monsters to the GY',
      categories: [],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && reasonsOf(ev).includes('destroy'),
      resolve: async (ctx) => {
        const list = ctx.banished('both', isDark);
        if (list.length) await ctx.sendToGrave(list);
      },
    },
  ],
});
QUESTION_ATK.add('Doomsday Horror');

const obsidianWatch: EffectDef = {
  // Continuous effect: wraps the resolution of a Spell/Trap effect that targets exactly 1 DARK monster you control.
  kind: 'trigger',
  event: 'chainActivated',
  label: '(negate Spell/Trap effects that target a DARK monster)',
  eventFilter: (ctx, ev) => {
    const link = ev.data?.link as (ChainLink & { ptdnObsidian?: boolean }) | undefined;
    if (!link || link.ptdnObsidian || !monActive(ctx)) return false;
    if (!(link.card.isSpell || link.card.isTrap)) return false;
    const t = link.ctx.targets;
    if (t.length !== 1) return false;
    const x = t[0];
    if (!(faceUpOn(x) && x.controller === ctx.player && isDark(x))) return false;
    link.ptdnObsidian = true;
    const me = ctx.self;
    const mid = me.moveId;
    const g = ctx.game;
    const orig = link.effect;
    link.effect = {
      ...orig,
      resolve: async (c) => {
        if (me.location === 'mzone' && me.moveId === mid && me.faceUp && !g.isNegated(me)) {
          g.log(`Obsidian Dragon negates the effect of ${link.card.name}.`, 'chain', me.controller);
          if (link.card.onField) await g.destroy([link.card], 'effect', me.controller, me);
          return;
        }
        if (orig.resolve) await orig.resolve(c);
      },
    };
    return false;
  },
};
monster('Obsidian Dragon', {
  attribute: 'DARK',
  race: 'Rock',
  level: 4,
  atk: 800,
  def: 2100,
  aiValue: 300,
  text: 'Negate any Spell/Trap effects that target exactly 1 DARK monster you control (and no other cards), and if you do, destroy them.',
  effects: [obsidianWatch],
});

monster('Shadowpriestess of Ohm', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 1700,
  def: 1600,
  aiValue: 300,
  text: 'You can Tribute 1 face-up DARK monster you control to inflict 800 damage to your opponent.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute a DARK monster: 800 damage',
      categories: ['damage'],
      canActivate: (ctx) => tributable(ctx, (c) => c.faceUp && isDark(c)).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(tributable(ctx, (c) => c.faceUp && isDark(c)), 1, 1, 'Tribute 1 face-up DARK monster you control.', 'tribute');
        if (!s.length) return false;
        await tributeCost(ctx, s);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 800);
      },
      ai: {
        score: (ctx) => {
          if (ctx.oppLp <= 800) return 95;
          const cheap = tributable(ctx, (c) => c.faceUp && isDark(c) && c !== ctx.self && (c.isToken || cardValue(ctx.game, c) < 700));
          return cheap.length && ctx.phase === 'main2' ? 35 : 0;
        },
      },
    },
  ],
});

monster('Gemini Lancer', {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 4,
  atk: 1800,
  def: 1400,
  types: ['gemini'],
  aiValue: 100,
  text: 'This card is treated as a Normal Monster while face-up on the field or in the Graveyard. While this card is face-up on the field, you can Normal Summon it to have it be treated as an Effect Monster with this effect:\n● During battle between this attacking card and a Defense Position monster whose DEF is lower than the ATK of this card, inflict the difference as Battle Damage to your opponent.',
  effects: [geminiSummon((ctx) => (ctx.faceUpMonsters('opp', (c) => c.pos === 'def').length || ctx.monsters('opp', (c) => !c.faceUp).length ? 38 : 22)), { kind: 'continuous', active: gemini, mods: [{ q: 'piercing' }] }],
});

monster('Future Samurai', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 4,
  atk: 1600,
  def: 1200,
  types: ['gemini'],
  aiValue: 300,
  text: 'This card is treated as a Normal Monster while face-up on the field or in the Graveyard. While this card is face-up on the field, you can Normal Summon it to have it become an Effect Monster with this effect.\n● Once per turn: You can banish 1 monster from your Graveyard to target 1 face-up monster on the field; destroy that target.',
  effects: [
    geminiSummon((ctx) => (ctx.faceUpMonsters('opp').length && ctx.grave('me', (c) => c.isMonster).length ? 48 : 20)),
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish 1 monster from GY: destroy 1 face-up monster',
      categories: ['destroy', 'banish'],
      condition: gemini,
      canActivate: (ctx) => ctx.grave('me', (c) => c.isMonster).length > 0 && ctx.faceUpMonsters('both').some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        const s = await ctx.select(ctx.grave('me', (c) => c.isMonster), 1, 1, 'Banish 1 monster from your GY.', 'cost', { aiScore: (c) => -revScore(c) });
        if (!s.length) return false;
        await ctx.banish(s, 'cost');
        await ctx.selectTargets(ctx.faceUpMonsters('both'), 1, 1, 'Target 1 face-up monster to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        if (t.length) await ctx.destroy(t);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length ? 55 : 0) },
    },
  ],
});

monster('Vengeful Shinobi', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 2,
  atk: 400,
  def: 800,
  aiValue: 100,
  text: 'When this face-up Attack Position card is targeted for an attack: Draw 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      mandatory: true,
      label: 'Draw 1 card',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.self.pos === 'atk',
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

monster('The Immortal Bushi', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 3,
  atk: 1200,
  def: 600,
  aiValue: 200,
  text: 'While this card is face-up on the field, it cannot be Tributed, except for the Tribute Summon of a Warrior-Type monster. During your Standby Phase, if this card is in your Graveyard and all the monsters in your Graveyard are Warrior-Type: You can Special Summon this card. You must also control no monsters to activate and to resolve this effect.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'cannotBeTributed' }] },
    {
      // Listener: the Tribute Summon exception (ABPF 'tributeFodderFor' flag, set whenever it reaches the field).
      kind: 'trigger',
      event: ['summoned', 'specialSummoned', 'flipped', 'monsterSet', 'positionChanged', 'controlChanged'],
      label: '(Tribute only for a Warrior)',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && ctx.self.location === 'mzone') ctx.self.flags.tributeFodderFor = (f: C) => f.data.race === 'Warrior';
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Special Summon from the GY',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn,
      condition: (ctx) => ctx.monsters('me').length === 0 && ctx.grave('me', (c) => c.isMonster).every((c) => c.data.race === 'Warrior'),
      canActivate: (ctx) => ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave' || ctx.monsters('me').length > 0 || !ctx.canSummonCard(ctx.self)) return;
        await ctx.specialSummon(ctx.self, { pos: autoPos(ctx, ctx.self) });
      },
    },
  ],
});

monster('Field-Commander Rahz', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 1600,
  def: 1200,
  aiValue: 300,
  text: 'When this card is Normal or Special Summoned: Choose 1 Level 4 or lower Warrior-Type monster from your Deck, except "Field-Commander Rahz", and place it on top of your Deck.',
  effects: [
    {
      kind: 'trigger',
      event: ['normalSummoned', 'specialSummoned'],
      mandatory: true,
      label: 'Place a Warrior on top of the Deck',
      categories: [],
      canActivate: (ctx) => ctx.deck('me', (c) => isRace(c, 'Warrior') && lvl(c) <= 4 && c.name !== 'Field-Commander Rahz').length > 0,
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => isRace(c, 'Warrior') && lvl(c) <= 4 && c.name !== 'Field-Commander Rahz');
        if (!cands.length) return;
        const [c] = await ctx.select(cands, 1, 1, 'Choose 1 Level 4 or lower Warrior-Type monster to place on top of your Deck.', 'toHand', { aiScore: revScore });
        ctx.game.shuffleDeck(ctx.player);
        if (c && c.location === 'deck') {
          ctx.game.rawMove(c, 'deck');
          ctx.log(`${ctx.game.players[ctx.player].name} places a card on top of their Deck.`);
          ctx.game.update();
        }
      },
    },
  ],
});

monster('Imprisoned Queen Archfiend', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 8,
  atk: 2600,
  def: 1700,
  aiValue: 200,
  text: 'Once per turn, during your Standby Phase, you must pay 1000 LP (this is not optional), or this card is destroyed. Once per turn, during your Standby Phase: Target 1 Level 4 or lower Fiend monster on the field; that target gains 1000 ATK until the end of this turn. "Pandemonium" must be on the field and this card must be in your GY to activate and to resolve this effect.',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      opt: true,
      label: 'Pay 1000 LP or destroy this card',
      categories: [],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.location === 'mzone' && ctx.self.faceUp,
      resolve: async (ctx) => {
        if (ctx.self.location !== 'mzone') return;
        if (ctx.lp > 1000) await ctx.payLp(1000);
        else await ctx.destroy(ctx.self);
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      mandatory: true,
      opt: true,
      label: 'A Level 4 or lower Fiend gains 1000 ATK',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn,
      condition: (ctx) => ctx.field('both').some(isPandemonium),
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => isRace(c, 'Fiend') && ctx.level(c) <= 4).some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => isRace(c, 'Fiend') && ctx.level(c) <= 4), 1, 1, 'Target 1 Level 4 or lower Fiend monster.', 'buff', {
          aiScore: (c) => (c.controller === ctx.player ? ctx.atk(c) : -1000),
        });
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave' || !ctx.field('both').some(isPandemonium)) return;
        const t = ctx.validTargets((c) => faceUpOn(c))[0];
        if (t) ctx.addTempMod(t, 'atk', 1000, 'turn');
      },
    },
  ],
});

monster('Black Veloci', {
  attribute: 'EARTH',
  race: 'Dinosaur',
  level: 4,
  atk: 1800,
  def: 300,
  aiValue: 100,
  text: "If this card attacks an opponent's monster, this card gains 400 ATK during the Damage Step only. If this card is attacked by an opponent's monster, this card loses 400 ATK during the Damage Step only.",
  effects: [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          value: (ctx) => {
            const b = ctx.battle;
            if (!b?.inDamageStep) return 0;
            if (b.attacker === ctx.self && b.target) return 400;
            if (b.target === ctx.self && b.attacker.controller !== ctx.player) return -400;
            return 0;
          },
        },
      ],
    },
  ],
});

const fishFromDeck = (ctx: Ctx) => ctx.deck('me', (c) => isRace(c, 'Fish') && !c.isExtra && lvl(c) <= 4 && ctx.canSummonCard(c));
monster('Superancient Deepsea King Coelacanth', {
  attribute: 'WATER',
  race: 'Fish',
  level: 7,
  atk: 2800,
  def: 2200,
  aiValue: 700,
  text: 'Once per turn: You can discard 1 card; Special Summon as many Level 4 or lower Fish monsters as possible from your Deck, but they cannot declare an attack and their effects are negated. When a card or effect is activated that targets this card on the field (Quick Effect): You can Tribute 1 other Fish monster; negate that effect, and if you do, destroy that card.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Discard 1: Special Summon Fish from the Deck',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.hand('me').length > 0 && ctx.canSpecialSummon() && fishFromDeck(ctx).length > 0,
      activate: async (ctx) => {
        const d = await ctx.discardFromHand(1, undefined, 'cost');
        if (!d.length) return false;
      },
      resolve: async (ctx) => {
        const cands = fishFromDeck(ctx);
        const n = Math.min(ctx.freeMZones(), cands.length);
        if (n <= 0 || !ctx.canSpecialSummon()) return;
        const sel = await ctx.select(cands, n, n, `Special Summon ${n} Level 4 or lower Fish monster(s) from your Deck.`, 'specialSummon', { aiScore: revScore });
        const r = await ctx.specialSummon(sel, { pos: 'choose' });
        for (const c of r) {
          ctx.addTempMod(c, 'cannotAttack', true, 'field');
          ctx.addTempMod(c, 'negated', true, 'field');
        }
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: (ctx) => (fishFromDeck(ctx).length && ctx.freeMZones() > 0 ? 45 : 0) },
    },
    {
      // https://edisonrul.ing/cards/s/superancient-deepsea-king-coelacanth.html — usable several times per turn, even
      // in the Damage Step.
      kind: 'quick',
      label: 'Tribute a Fish: negate the effect that targets this card',
      damageStep: true,
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && ctx.self.location === 'mzone' && ctx.self.faceUp && l.card !== ctx.self && l.ctx.targets.includes(ctx.self) && !l.negated;
      },
      canActivate: (ctx) => tributable(ctx, (c) => c !== ctx.self && isRace(c, 'Fish')).length > 0,
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
        const s = await ctx.select(tributable(ctx, (c) => c !== ctx.self && isRace(c, 'Fish')), 1, 1, 'Tribute 1 other Fish monster.', 'tribute');
        if (!s.length) return false;
        await tributeCost(ctx, s);
      },
      resolve: async (ctx) => {
        const l = ctx.data.link as ChainLink | undefined;
        if (l) await ctx.negateAndDestroy(l);
      },
      ai: { score: (ctx) => (ctx.prevLink()?.player === ctx.opp ? 70 : 0) },
    },
  ],
});

monster('Cannon Soldier MK-2', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 5,
  atk: 1900,
  def: 1200,
  aiValue: 200,
  text: 'You can Tribute 2 monsters to inflict 1500 damage to your opponent.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute 2 monsters: 1500 damage',
      categories: ['damage'],
      canActivate: (ctx) => tributable(ctx).length >= 2,
      activate: async (ctx) => {
        const s = await ctx.select(tributable(ctx), 2, 2, 'Tribute 2 monsters.', 'tribute');
        if (s.length < 2) return false;
        await tributeCost(ctx, s);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 1500);
      },
      ai: {
        score: (ctx) => {
          if (ctx.oppLp <= 1500) return 95;
          const cheap = tributable(ctx, (c) => c !== ctx.self && (c.isToken || cardValue(ctx.game, c) < 600));
          return cheap.length >= 2 && ctx.phase === 'main2' ? 34 : 0;
        },
      },
    },
  ],
});

monster('The Calculator', {
  attribute: 'LIGHT',
  race: 'Thunder',
  level: 2,
  atk: 0,
  def: 0,
  aiValue: 300,
  text: 'The ATK of this card is the combined Levels of all face-up monsters you control x 300.',
  effects: [{ kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 300 * ctx.faceUpMonsters('me').reduce((a, c) => a + ctx.level(c), 0) }] }],
});
QUESTION_ATK.add('The Calculator');

monster('Sea Koala', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 2,
  atk: 100,
  def: 1600,
  aiValue: 200,
  text: "Once per turn: You can target 1 face-up monster your opponent controls; change that target's ATK to 0 until the end of this turn. You must control another Beast monster to activate and to resolve this effect.",
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: "Target's ATK becomes 0",
      categories: ['atkChange'],
      condition: (ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && isRace(c, 'Beast')).length > 0,
      canActivate: (ctx) => ctx.faceUpMonsters('opp').some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'target', { aiScore: (c) => ctx.atk(c) });
      },
      resolve: async (ctx) => {
        if (!ctx.faceUpMonsters('me', (c) => c !== ctx.self && isRace(c, 'Beast')).length) return;
        const t = ctx.validTargets((c) => faceUpOn(c))[0];
        if (!t) return;
        t.flags.setAtk = 0;
        t.flags.setAtkTurn = ctx.turn;
        ctx.log(`${t.name}'s ATK becomes 0 until the end of this turn.`);
        ctx.game.update();
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && bestOppAtk(ctx) >= 1500 && ctx.faceUpMonsters('me', (c) => c.pos === 'atk').length ? 42 : 0) },
    },
  ],
});

const thunderOption = token('Thunder Option Token', 'LIGHT', 'Machine', 4, 1500, 1500, 'Thunder Option Token (Machine-Type/LIGHT/Level 4/ATK 1500/DEF 1500). Cannot be Tributed for a Tribute Summon.');
monster('Blue Thunder T-45', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 4,
  atk: 1700,
  def: 1000,
  aiValue: 300,
  text: 'If this card destroys an opponent\'s monster by battle: Special Summon 1 "Thunder Option Token" (Machine-Type/LIGHT/Level 4/ATK 1500/DEF 1500). This Token cannot be Tributed for a Tribute Summon.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Special Summon a Thunder Option Token',
      categories: ['specialSummon'],
      eventFilter: selfDestroysByBattle,
      canActivate: (ctx) => ctx.canSpecialSummon(),
      resolve: async (ctx) => {
        const r = await ctx.createTokens(thunderOption, 1, bestOppAtk(ctx) > 1500 ? 'def' : 'atk');
        for (const t of r) t.flags.noTributeSummonFodder = true;
      },
    },
  ],
});

monster('Magnetic Mosquito', {
  attribute: 'LIGHT',
  race: 'Insect',
  level: 3,
  atk: 300,
  def: 1000,
  types: ['flip'],
  aiValue: 200,
  text: 'FLIP: Destroy all Machine monsters on the field.',
  effects: [
    flip({
      categories: ['destroy', 'destroyMulti'],
      resolve: async (ctx) => {
        const list = ctx.faceUpMonsters('both', (c) => isRace(c, 'Machine'));
        if (list.length) await ctx.destroy(list);
      },
    }),
  ],
});

/** Effigy: "can be treated as 2 Tributes for the Tribute Summon of an <ATTRIBUTE> Normal Monster". */
const effigyRule: EffectDef = {
  kind: 'continuous',
  altTribute: (ctx, summoned, tribute) => tribute === ctx.self && effigyFor(ctx.self, summoned),
};
monster('Earth Effigy', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 4,
  atk: 100,
  def: 2000,
  aiValue: 100,
  text: 'This card can be treated as 2 Tributes for the Tribute Summon of an EARTH Normal Monster.',
  effects: [PATCH_LISTENER, effigyRule],
});
monster('Wind Effigy', {
  attribute: 'WIND',
  race: 'Winged Beast',
  level: 4,
  atk: 1800,
  def: 200,
  aiValue: 0,
  text: 'This card can be treated as 2 Tributes for the Tribute Summon of a WIND Normal Monster.',
  effects: [PATCH_LISTENER, effigyRule],
});

/** "End the Battle Phase": no engine hook, so the attack is negated and no more attacks can be declared this turn. */
function endBattlePhase(ctx: Ctx) {
  if (ctx.battle) ctx.negateAttack();
  ctx.addPlayerMod(ctx.game.turnPlayer, 'cannotDeclareAttack', true, 'turn');
  ctx.log('The Battle Phase ends.');
}

monster('Neo-Spacian Twinkle Moss', {
  attribute: 'LIGHT',
  race: 'Plant',
  level: 4,
  atk: 500,
  def: 1100,
  types: ['fusion'],
  nomi: true,
  aiValue: 200,
  text: 'This card\'s name is also treated as "Neo-Spacian Glow Moss". This card cannot be Special Summoned except with "NEX". When this card attacks or is attacked, draw 1 card. Reveal that card, and based on its type apply the proper effect: ● Monster: End the Battle Phase. ● Spell: You can change this card\'s attack to a direct attack. ● Trap: This monster is changed to Defense Position.',
  // "NEX" is not in this card pool, so no Fusion material combination ever matches.
  fusion: { materials: [() => false], noPoly: true, desc: 'Cannot be Special Summoned except with "NEX".' },
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      mandatory: true,
      label: 'Draw 1 and reveal it',
      categories: ['draw'],
      eventFilter: (ctx, ev) => (ev.card === ctx.self || ev.other === ctx.self) && ctx.self.location === 'mzone' && ctx.self.faceUp,
      resolve: async (ctx) => {
        const [c] = await ctx.draw(1);
        if (!c) return;
        await reveal(ctx, [c]);
        const b = ctx.battle;
        if (c.isMonster) endBattlePhase(ctx);
        else if (c.isSpell) {
          if (b && b.attacker === ctx.self && b.target && !b.negated && (await ctx.confirm('Change this attack to a direct attack?', true))) {
            b.target = null;
            b.targetMoveId = -1;
            ctx.log(`${ctx.self.name} attacks directly instead.`);
          }
        } else if (ctx.self.location === 'mzone' && ctx.self.pos === 'atk') await ctx.changePos(ctx.self, 'def');
      },
    },
  ],
});

// ---------------------------------------------------------------- Neos Fusions

const instantNeoSpaceOn = (g: Game, c: C) => g.equipsOf(c).some((e) => e.name === 'Instant Neo Space' && e.faceUp);
monster('Elemental HERO Storm Neos', {
  attribute: 'WIND',
  race: 'Warrior',
  level: 9,
  atk: 3000,
  def: 2500,
  types: ['fusion'],
  sets: ['hero', 'elemental-hero'],
  nomi: true,
  aiValue: 900,
  text: '"Elemental HERO Neos" + "Neo-Spacian Air Hummingbird" + "Neo-Spacian Aqua Dolphin"\nMust first be Special Summoned (from your Extra Deck) by shuffling the above cards you control into the Deck. Once per turn: You can destroy all Spells and Traps on the field. Once per turn, during the End Phase: Return this card to the Extra Deck. If this card is returned into the Extra Deck this way: Shuffle all cards on the field into the Deck.',
  fusion: {
    materials: [isNeos, (c) => c.name === 'Neo-Spacian Air Hummingbird', (c) => c.name === 'Neo-Spacian Aqua Dolphin'],
    noPoly: true,
    desc: '"Elemental HERO Neos" + "Neo-Spacian Air Hummingbird" + "Neo-Spacian Aqua Dolphin"',
  },
  effects: [
    {
      kind: 'proc',
      range: ['extra'],
      label: 'Contact Fusion',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.game.fusionMaterialSets(ctx.self, ctx.faceUpMonsters('me')).length > 0,
      perform: async (ctx) => {
        const sets = ctx.game.fusionMaterialSets(ctx.self, ctx.faceUpMonsters('me'));
        const mats = (await ctx.game.pickCombo(ctx.player, sets, 'Select the monsters to shuffle into the Deck', 'material')) ?? sets[0];
        if (!mats?.length) return false;
        ctx.log(`${ctx.game.players[ctx.player].name} shuffles ${mats.map((m) => m.name).join(', ')} into the Deck.`);
        await ctx.toDeck(mats, 'shuffle', 'material');
        return true;
      },
      ai: { score: () => 75 },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy all Spells and Traps',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.spellTraps('both').length > 0,
      resolve: async (ctx) => {
        const list = ctx.spellTraps('both');
        if (list.length) await ctx.destroy(list);
      },
      ai: { score: (ctx) => (ctx.spellTraps('opp').length > ctx.spellTraps('me').length ? 55 : 0) },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      opt: true,
      label: 'Return to the Extra Deck',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.location === 'mzone' && ctx.self.faceUp,
      resolve: async (ctx) => {
        if (!monActive(ctx)) return;
        if (instantNeoSpaceOn(ctx.game, ctx.self) && !(await ctx.confirm('Return Elemental HERO Storm Neos to the Extra Deck? (Instant Neo Space)', false))) return;
        await ctx.toDeck(ctx.self);
      },
    },
    {
      kind: 'trigger',
      event: 'returnedToDeck',
      range: ['extra'],
      mandatory: true,
      label: 'Shuffle all cards on the field into the Deck',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.reasonCard === ctx.self && ev.from === 'mzone',
      resolve: async (ctx) => {
        const list = ctx.field('both');
        if (list.length) await ctx.toDeck(list);
      },
    },
  ],
});

monster('Rainbow Neos', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 10,
  atk: 4500,
  def: 3000,
  types: ['fusion'],
  sets: ['hero', 'elemental-hero'],
  nomi: true,
  aiValue: 1200,
  text: '"Elemental HERO Neos" + 1 "Ultimate Crystal" monster\nMust be Fusion Summoned with the above Fusion Materials. Once per turn: You can activate 1 of these effects.\n● Send 1 monster you control to the GY; shuffle all monsters your opponent controls into the Deck. ● Send 1 Spell/Trap you control to the GY; shuffle all Spells and Traps your opponent controls into the Deck. ● Send 1 card from the top of your Deck to the GY; shuffle all cards from your opponent\'s GY into the Deck.',
  fusion: { materials: [isNeos, isUltimateCrystal], desc: '"Elemental HERO Neos" + 1 "Ultimate Crystal" monster' },
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Shuffle the opponent\'s cards into the Deck',
      categories: ['toDeck'],
      canActivate: (ctx) => ctx.monsters('me').length > 0 || ctx.spellTraps('me').length > 0 || ctx.deck('me').length > 0,
      activate: async (ctx) => {
        const modes: { key: string; label: string; score: number }[] = [];
        const oppMonVal = ctx.monsters('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0);
        const oppStVal = ctx.spellTraps('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0);
        const cheapMon = Math.min(Infinity, ...ctx.monsters('me', (c) => c !== ctx.self).map((c) => cardValue(ctx.game, c)));
        if (ctx.monsters('me').length) modes.push({ key: 'mon', label: 'Send 1 monster: shuffle all opponent\'s monsters into the Deck', score: oppMonVal - (Number.isFinite(cheapMon) ? cheapMon : 5000) });
        if (ctx.spellTraps('me').length) modes.push({ key: 'st', label: 'Send 1 Spell/Trap: shuffle all opponent\'s Spells/Traps into the Deck', score: oppStVal - 900 });
        if (ctx.deck('me').length) modes.push({ key: 'gy', label: "Send the top card of your Deck: shuffle the opponent's GY into the Deck", score: ctx.grave('opp').length * 40 - 300 });
        const i = await ctx.option('Rainbow Neos: choose an effect.', modes.map((m) => m.label), (k) => modes[k].score);
        const m = modes[i] ?? modes[0];
        ctx.data.mode = m.key;
        if (m.key === 'mon') {
          const s = await ctx.select(ctx.monsters('me'), 1, 1, 'Send 1 monster you control to the GY.', 'cost', { aiScore: (c) => (c === ctx.self ? -99999 : -cardValue(ctx.game, c)) });
          if (!s.length) return false;
          await ctx.sendToGrave(s, 'cost');
        } else if (m.key === 'st') {
          const s = await ctx.select(ctx.spellTraps('me'), 1, 1, 'Send 1 Spell/Trap you control to the GY.', 'cost');
          if (!s.length) return false;
          await ctx.sendToGrave(s, 'cost');
        } else {
          await ctx.game.mill(ctx.player, 1, 'cost', ctx.self);
        }
      },
      resolve: async (ctx) => {
        const list = ctx.data.mode === 'mon' ? ctx.monsters('opp') : ctx.data.mode === 'st' ? ctx.spellTraps('opp') : ctx.grave('opp');
        if (list.length) await ctx.toDeck(list);
      },
      ai: {
        score: (ctx) => {
          const mon = ctx.monsters('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const others = ctx.monsters('me', (c) => c !== ctx.self);
          if (others.length && mon >= 2500) return 60;
          if (ctx.spellTraps('me').length && ctx.spellTraps('opp').length >= 2) return 50;
          return 0;
        },
      },
    },
  ],
});

// ---------------------------------------------------------------- DARK support monsters

monster('Darklord Zerato', {
  attribute: 'DARK',
  race: 'Fairy',
  level: 8,
  atk: 2800,
  def: 2300,
  aiValue: 800,
  text: 'If you have 4 or more DARK monsters with different names in your Graveyard, you can Tribute Summon this card by Tributing 1 DARK monster. You can send 1 DARK monster from your hand to the Graveyard; destroy all monsters your opponent controls. Once per turn, during the End Phase, if this effect was activated this turn: Destroy this card.',
  effects: [
    {
      kind: 'continuous',
      range: ['hand'],
      altTribute: (ctx, summoned, tribute) =>
        summoned === ctx.self && isDark(tribute) && new Set(ctx.grave('me', isDark).map((c) => c.name)).size >= 4,
    },
    {
      kind: 'ignition',
      label: 'Send a DARK monster: destroy all opponent\'s monsters',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.hand('me', isDark).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.hand('me', isDark), 1, 1, 'Send 1 DARK monster from your hand to the GY.', 'cost');
        if (!s.length) return false;
        await ctx.sendToGrave(s, 'cost');
        ctx.self.flags.zeratoTurn = ctx.turn;
      },
      resolve: async (ctx) => {
        const list = ctx.monsters('opp');
        if (list.length) await ctx.destroy(list);
      },
      ai: {
        score: (ctx) => {
          const v = ctx.monsters('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return v >= 2500 || ctx.monsters('opp').length >= 2 ? 62 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      opt: true,
      label: 'Destroy this card',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.location === 'mzone' && ctx.self.flags.zeratoTurn === ctx.turn,
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone') await ctx.destroy(ctx.self);
      },
    },
  ],
});

monster('Darknight Parshath', {
  attribute: 'DARK',
  race: 'Fairy',
  level: 5,
  atk: 1900,
  def: 1400,
  aiValue: 400,
  text: "If this card destroys an opponent's monster by battle: You can banish 1 DARK monster from your Graveyard; draw 1 card. This card gains 100 ATK for each DARK monster in your Graveyard.",
  effects: [
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 100 * ctx.grave('me', isDark).length }] },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      label: 'Banish 1 DARK: draw 1',
      categories: ['draw'],
      eventFilter: selfDestroysByBattle,
      canActivate: (ctx) => ctx.grave('me', isDark).length > 0 && ctx.deck('me').length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.grave('me', isDark), 1, 1, 'Banish 1 DARK monster from your GY.', 'cost', { aiScore: (c) => -revScore(c) });
        if (!s.length) return false;
        await ctx.banish(s, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

monster('Deepsea Macrotrema', {
  attribute: 'WATER',
  race: 'Fish',
  level: 1,
  atk: 600,
  def: 100,
  aiValue: 100,
  text: 'When this card is sent from the field to the Graveyard, all face-up WATER monsters you control gain 500 ATK until the end of this turn.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'WATER monsters gain 500 ATK',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone',
      resolve: async (ctx) => {
        for (const c of ctx.faceUpMonsters('me', (m) => m.data.attribute === 'WATER')) ctx.addTempMod(c, 'atk', 500, 'turn');
      },
    },
  ],
});

const metaboToken = token('Metabo Token', 'DARK', 'Fiend', 1, 0, 0, 'Metabo Token (Fiend-Type/DARK/Level 1/ATK 0/DEF 0). Cannot be Tributed for a Tribute Summon.');
monster('Metabo Globster', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 3,
  atk: 800,
  def: 300,
  aiValue: 400,
  text: 'When you Tribute this card for the Tribute Summon of a DARK monster, Special Summon 3 "Metabo Tokens" (Fiend-Type/DARK/Level 1/ATK 0/DEF 0) in Defense Position. These tokens cannot be Tributed for a Tribute Summon.',
  effects: [
    {
      kind: 'trigger',
      event: 'tributed',
      mandatory: true,
      label: 'Special Summon 3 Metabo Tokens',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const s = ev.reasonCard as C | undefined;
        return ev.card === ctx.self && ev.from === 'mzone' && !!s && s.location === 'hand' && isDark(s) && !reasonsOf(ev).includes('effect');
      },
      canActivate: (ctx) => ctx.canSpecialSummon(),
      resolve: async (ctx) => {
        const n = Math.min(3, ctx.freeMZones());
        if (n <= 0) return;
        const r = await ctx.createTokens(metaboToken, n, 'def');
        for (const t of r) t.flags.noTributeSummonFodder = true;
      },
    },
  ],
});

monster('Golden Flying Fish', {
  attribute: 'LIGHT',
  race: 'Fish',
  level: 4,
  atk: 1700,
  def: 1000,
  aiValue: 400,
  text: 'You can Tribute 1 other Fish-Type monster, then target 1 card on the field; destroy that target.',
  effects: [
    {
      kind: 'ignition',
      label: 'Tribute a Fish: destroy 1 card',
      categories: ['destroy'],
      canActivate: (ctx) => tributable(ctx, (c) => c !== ctx.self && isRace(c, 'Fish')).length > 0 && ctx.field('both').some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        const s = await ctx.select(tributable(ctx, (c) => c !== ctx.self && isRace(c, 'Fish')), 1, 1, 'Tribute 1 other Fish-Type monster.', 'tribute');
        if (!s.length) return false;
        await tributeCost(ctx, s);
        await ctx.selectTargets(ctx.field('both'), 1, 1, 'Target 1 card on the field to destroy.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const foes = ctx.field('opp', (c) => ctx.canTarget(c));
          if (!foes.length) return 0;
          const fodder = tributable(ctx, (c) => c !== ctx.self && isRace(c, 'Fish'));
          const cheap = Math.min(...fodder.map((c) => cardValue(ctx.game, c)));
          return cardValue(ctx.game, bestTarget(ctx.game, foes)) > cheap ? 50 : 0;
        },
      },
    },
  ],
});

const destroysMonster = (ctx: Ctx, l: ChainLink) => {
  const cats = l.effect.categories ?? [];
  if (!cats.includes('destroy') && !cats.includes('destroyMulti')) return false;
  if (l.ctx.targets.length) return l.ctx.targets.some((t) => t.location === 'mzone');
  return ctx.monsters('both').length > 0;
};
monster('Prime Material Dragon', {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 6,
  atk: 2400,
  def: 2000,
  aiValue: 900,
  text: 'Any effect that would inflict damage to a player increases their LP by the same amount, instead. When a card or effect is activated that would destroy a monster(s) on the field (Quick Effect): You can send 1 card from your hand to the GY; negate the activation, and if you do, destroy it.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'quick',
      label: 'Send 1 card from hand: negate a destruction effect',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && !l.negated && l.card !== ctx.self && destroysMonster(ctx, l);
      },
      canActivate: (ctx) => ctx.hand('me').length > 0,
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
        const s = await ctx.select(ctx.hand('me'), 1, 1, 'Send 1 card from your hand to the GY.', 'cost');
        if (!s.length) return false;
        await ctx.sendToGrave(s, 'cost');
      },
      resolve: async (ctx) => {
        const l = ctx.data.link as ChainLink | undefined;
        if (l) await ctx.negateAndDestroy(l);
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp) return 0;
          const mine = l.ctx.targets.length ? l.ctx.targets.some((t) => t.location === 'mzone' && t.controller === ctx.player) : ctx.monsters('me').length > 0;
          return mine ? 65 : 0;
        },
      },
    },
  ],
});

/** Aztekipede "cannot be Special Summoned by other ways": it never counts as properly summoned (no revival). */
const neverProper = new WeakSet<C>();
monster('Aztekipede, the Worm Warrior', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 4,
  atk: 1900,
  def: 400,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 200,
  text: 'Cannot be Normal Summoned/Set. Must be Special Summoned by banishing 1 Insect-Type monster from your Graveyard, and cannot be Special Summoned by other ways. If this card inflicts battle damage to your opponent: Send the top card of their Deck to the Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ALL_LOCS,
      label: '(cannot be Special Summoned by other ways)',
      eventFilter: (ctx) => {
        const me = ctx.self;
        if (!neverProper.has(me)) {
          neverProper.add(me);
          Object.defineProperty(me, 'properlySummoned', { configurable: true, get: () => false, set: () => {} });
        }
        return false;
      },
    },
    {
      kind: 'proc',
      label: 'Special Summon (banish 1 Insect)',
      categories: ['specialSummon', 'banish'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.grave('me', (c) => isRace(c, 'Insect')).length > 0,
      perform: async (ctx) => {
        const s = await ctx.select(ctx.grave('me', (c) => isRace(c, 'Insect')), 1, 1, 'Banish 1 Insect-Type monster from your GY.', 'cost', { aiScore: (c) => -revScore(c) });
        if (!s.length) return false;
        await ctx.banish(s, 'cost');
        return true;
      },
    },
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      label: "Send the top card of the opponent's Deck to the GY",
      categories: ['mill'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp,
      resolve: async (ctx) => {
        await ctx.mill(1, ctx.opp);
      },
    },
  ],
});

monster("Vampire's Curse", {
  attribute: 'DARK',
  race: 'Zombie',
  level: 6,
  atk: 2000,
  def: 800,
  aiValue: 400,
  text: 'When this card is destroyed by battle and sent to the GY: You can pay 500 LP; Special Summon it during the Standby Phase of the next turn. If you do: It gains 500 ATK.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Pay 500 LP: revive next Standby Phase',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && reasonsOf(ev).includes('battle'),
      canActivate: (ctx) => ctx.lp > 500,
      activate: async (ctx) => {
        await ctx.payLp(500);
      },
      resolve: async (ctx) => {
        const me = ctx.self;
        const mid = me.moveId;
        ctx.later(
          'standby',
          async () => {
            if (me.location !== 'grave' || me.moveId !== mid || !ctx.canSpecialSummon()) return;
            const r = await ctx.specialSummon(me, { pos: 'atk' });
            if (r.length) ctx.addTempMod(me, 'atk', 500, 'field');
          },
          1,
        );
      },
      ai: { score: (ctx) => (ctx.lp > 2000 ? 1 : 0) },
    },
  ],
});

monster('Castle Gate', {
  attribute: 'EARTH',
  race: 'Rock',
  level: 6,
  atk: 0,
  def: 2400,
  aiValue: 300,
  text: "This card cannot be destroyed by battle. Once per turn, if this card is in face-up Attack Position, you can Tribute 1 Level 5 or lower monster to inflict damage to your opponent equal to that monster's original ATK.",
  effects: [
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle' }] },
    {
      kind: 'ignition',
      opt: true,
      label: 'Tribute a Level 5 or lower monster: damage',
      categories: ['damage'],
      condition: (ctx) => ctx.self.pos === 'atk',
      canActivate: (ctx) => tributable(ctx, (c) => c !== ctx.self && (!c.faceUp || ctx.level(c) <= 5) && lvl(c) <= 5).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(tributable(ctx, (c) => c !== ctx.self && (!c.faceUp || ctx.level(c) <= 5) && lvl(c) <= 5), 1, 1, 'Tribute 1 Level 5 or lower monster.', 'tribute', {
          aiScore: (c) => (c.data.atk ?? 0) - cardValue(ctx.game, c) * 0.5,
        });
        if (!s.length) return false;
        ctx.data.dmg = s[0].data.atk ?? 0; // original ATK
        await tributeCost(ctx, s);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, ctx.data.dmg ?? 0);
      },
      ai: {
        score: (ctx) => {
          const cands = tributable(ctx, (c) => c !== ctx.self && lvl(c) <= 5);
          if (!cands.length) return 0;
          const best = Math.max(...cands.map((c) => c.data.atk ?? 0));
          if (best >= ctx.oppLp) return 95;
          return ctx.phase === 'main2' && cands.some((c) => (c.data.atk ?? 0) >= 1500 && cardValue(ctx.game, c) <= 1900) ? 33 : 0;
        },
      },
    },
  ],
});

monster('Dark-Eyes Illusionist', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 2,
  atk: 0,
  def: 1400,
  types: ['flip'],
  aiValue: 400,
  text: 'FLIP: Target 1 monster on the field; it cannot attack while this card is face-up on the field.',
  effects: [
    flip({
      categories: ['lockdown'],
      canActivate: (ctx) => ctx.monsters('both', (c) => c !== ctx.self).some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both', (c) => c !== ctx.self), 1, 1, 'Target 1 monster on the field.', 'target', {
          aiScore: (c) => (c.controller === ctx.player ? -5000 : c.faceUp ? ctx.atk(c) : 1000),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone')[0];
        if (!t || ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        ctx.self.flags.illusionTarget = t.uid;
        ctx.self.flags.illusionMid = t.moveId;
      },
    }),
    {
      kind: 'continuous',
      mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c: C) => c.uid === ctx.self.flags.illusionTarget && c.moveId === ctx.self.flags.illusionMid }],
    },
  ],
});

monster('Legendary Fiend', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 6,
  atk: 1500,
  def: 1800,
  aiValue: 400,
  text: 'Once per turn, during your Standby Phase: This card gains 700 ATK.',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      opt: true,
      label: '+700 ATK',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && ctx.self.location === 'mzone' && ctx.self.faceUp,
      resolve: async (ctx) => {
        if (monActive(ctx)) ctx.addTempMod(ctx.self, 'atk', 700, 'field');
      },
    },
  ],
});

monster('Dark Red Enchanter', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 6,
  atk: 1700,
  def: 2200,
  aiValue: 500,
  text: 'If this card is Normal Summoned: Place 2 Spell Counters on it. Each time a Spell Card is activated, place 1 Spell Counter on this card when that Spell resolves. Gains 300 ATK for each Spell Counter on it. Once per turn: You can remove 2 Spell Counters from this card; discard 1 random card from your opponent\'s hand.',
  effects: [
    SPELL_WATCH,
    {
      kind: 'trigger',
      event: 'normalSummoned',
      mandatory: true,
      label: 'Place 2 Spell Counters',
      categories: [],
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self)) ctx.self.counters.spell = (ctx.self.counters.spell ?? 0) + 2;
      },
    },
    {
      // Listener (no chain): a Spell Counter when a Spell Card resolves.
      kind: 'trigger',
      event: 'chainResolved',
      label: '(Spell Counter)',
      eventFilter: (ctx, ev) => {
        if (spellResolved(ev) && monActive(ctx)) {
          ctx.self.counters.spell = (ctx.self.counters.spell ?? 0) + 1;
          ctx.game.update();
        }
        return false;
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 300 * (ctx.self.counters.spell ?? 0) }] },
    {
      kind: 'ignition',
      opt: true,
      label: 'Remove 2 Spell Counters: random discard',
      categories: ['discard'],
      canActivate: (ctx) => (ctx.self.counters.spell ?? 0) >= 2 && ctx.hand('opp').length > 0,
      activate: async (ctx) => {
        ctx.self.counters.spell = (ctx.self.counters.spell ?? 0) - 2;
      },
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (!hand.length) return;
        const c = ctx.game.rng.pick(hand);
        await ctx.game.discard([c], 'effect', ctx.player, ctx.self);
      },
      ai: { score: (ctx) => (ctx.phase === 'main2' || (ctx.self.counters.spell ?? 0) >= 4 || bestOppAtk(ctx) < ctx.atk(ctx.self) - 600 ? 40 : 0) },
    },
  ],
});

monster('Belial - Marquis of Darkness', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 8,
  atk: 2800,
  def: 2400,
  aiValue: 700,
  text: 'Your opponent cannot target any face-up monster you control, except "Belial - Marquis of Darkness", for an attack, or with Spell/Trap effects.',
  effects: [
    {
      kind: 'continuous',
      mods: [
        {
          q: 'cannotBeAttacked',
          to: 'cards',
          filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.player && c.name !== 'Belial - Marquis of Darkness',
        },
        {
          // APPROX (as Ritual Cage): the Spell/Trap being activated is on top of the chain while its targets are chosen.
          q: 'untargetable',
          to: 'cards',
          filter: (ctx, c: C) => {
            const l = ctx.game.chain[ctx.game.chain.length - 1];
            return faceUpOn(c) && c.controller === ctx.player && c.name !== 'Belial - Marquis of Darkness' && !!l && (l.card.isSpell || l.card.isTrap) && l.player !== ctx.player;
          },
        },
      ],
    },
  ],
});

// ============================================================ SPELLS

spell('Rainbow Veil', 'equip', {
  text: "If the equipped monster battles an opponent's monster, while that monster is on the field its effect(s) is negated during the Battle Phase only.",
  effects: [
    equipActivate({ score: (ctx) => ownEquipScore(ctx, (c) => c.pos === 'atk', ctx.faceUpMonsters('opp', (c) => c.hasType('effect')).length ? 32 : 0) }),
    {
      // Listener: remember the opponent's monster the equipped monster battles.
      kind: 'trigger',
      event: ['attackDeclared', 'damageStepEnd'],
      range: ['szone'],
      label: '(record battled monster)',
      eventFilter: (ctx) => {
        const host = ctx.equipTarget;
        if (!host || !stActive(ctx)) return false;
        const o = battleOpponent(ctx, host);
        if (o && o.controller !== host.controller) {
          o.flags.ptdnVeil = ctx.self.uid;
          o.flags.ptdnVeilTurn = ctx.turn;
        }
        return false;
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'negated',
          to: 'cards',
          filter: (ctx, c: C) => {
            if (ctx.phase !== 'battle' || c.location !== 'mzone') return false;
            const host = ctx.equipTarget;
            if (!host) return false;
            if (battleOpponent(ctx, host) === c && c.controller !== host.controller) return true;
            return c.flags.ptdnVeil === ctx.self.uid && c.flags.ptdnVeilTurn === ctx.turn;
          },
        },
      ],
    },
  ],
});

// ---- Super Polymerization
interface SpChoice {
  fusion: C;
  sets: C[][];
}
function superPolyChoices(ctx: Ctx): SpChoice[] {
  if (ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return [];
  const pool = ctx.monsters('both', (c) => !c.isToken);
  if (!pool.length) return [];
  const out: SpChoice[] = [];
  const seen = new Set<string>();
  for (const f of ctx.extra('me', (c) => c.hasType('fusion') && !!c.data.fusion && !c.data.fusion.noPoly)) {
    if (seen.has(f.name)) continue;
    seen.add(f.name);
    let sets = ctx.game.fusionMaterialSets(f, pool);
    if (ctx.freeMZones() <= 0) sets = sets.filter((s) => s.some((m) => m.controller === ctx.player));
    if (sets.length) out.push({ fusion: f, sets });
  }
  return out;
}
/** AI value of Fusion Summoning `f` with `set` (the opponent's materials count as a gain). */
function spGain(ctx: Ctx, f: C, set: C[]) {
  const val = revScore(f) + 700;
  return set.reduce((a, m) => a + (m.controller === ctx.player ? -cardValue(ctx.game, m) * 0.6 : cardValue(ctx.game, m)), val);
}
function spBest(ctx: Ctx, ch: SpChoice) {
  let best = ch.sets[0];
  let bv = -Infinity;
  for (const s of ch.sets) {
    const v = spGain(ctx, ch.fusion, s);
    if (v > bv) {
      bv = v;
      best = s;
    }
  }
  return { set: best, gain: bv };
}
spell('Super Polymerization', 'quickplay', {
  text: 'Discard 1 card; Fusion Summon 1 Fusion Monster from your Extra Deck, using monsters from either field. Neither player can activate cards or effects in response to this card\'s activation.',
  effects: [
    {
      kind: 'activate',
      // Spell Speed 4: nothing can be chained to it (the engine compares Spell Speeds when responding).
      speed: 4 as 3,
      categories: ['specialSummon'],
      condition: (ctx) => {
        const top = ctx.chainTop();
        return !top || top === ctx.link || top.speed <= 2;
      },
      canActivate: (ctx) => ctx.hand('me', (c) => c !== ctx.self).length > 0 && superPolyChoices(ctx).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.hand('me', (c) => c !== ctx.self), 1, 1, 'Discard 1 card.', 'discard');
        if (!s.length) return false;
        await ctx.discard(s, 'cost');
      },
      resolve: async (ctx) => {
        const choices = superPolyChoices(ctx);
        if (!choices.length) return;
        const [f] = await ctx.select(
          choices.map((c) => c.fusion),
          1,
          1,
          'Choose a Fusion Monster to Fusion Summon.',
          'specialSummon',
          { aiScore: (c) => spBest(ctx, choices.find((x) => x.fusion === c)!).gain },
        );
        const ch = choices.find((x) => x.fusion === f) ?? choices[0];
        let mats: C[] | null;
        if (isAi(ctx)) mats = spBest(ctx, ch).set;
        else mats = await ctx.game.pickCombo(ctx.player, ch.sets, `Select Fusion Materials for ${ch.fusion.name}`, 'material');
        if (!mats) mats = ch.sets[0];
        ctx.log(`${ctx.game.players[ctx.player].name} uses ${mats.map((m) => m.name).join(', ')} as Fusion Material.`);
        const info = mats.map((m) => ({ uid: m.uid, name: m.name, attribute: m.data.attribute, race: m.data.race, level: m.data.level, card: m }));
        await ctx.game.moveCards(mats, 'grave', { reason: 'fusion', reasons: ['fusion', 'material', 'effect'], reasonPlayer: ctx.player, reasonCard: ctx.self });
        if (ch.fusion.location !== 'extra' || !ctx.canSpecialSummon()) return;
        const r = await ctx.specialSummon(ch.fusion, { method: 'fusion', proper: true, pos: 'choose' });
        if (r.length) {
          ch.fusion.flags.materials = info;
          ch.fusion.flags.materialCount = info.length;
        }
      },
      ai: {
        score: (ctx) => {
          const g = Math.max(-Infinity, ...superPolyChoices(ctx).map((ch) => spBest(ctx, ch).gain));
          return g > 1200 ? 55 + g / 200 : 0;
        },
      },
    },
  ],
});

const evilToken = token('Evil Token', 'DARK', 'Fiend', 7, 2500, 2500, 'Evil Token (Fiend-Type/DARK/Level 7/ATK 2500/DEF 2500). Special Summoned by "Vicious Claw".');
spell('Vicious Claw', 'equip', {
  text: "The equipped monster gains 300 ATK. If the equipped monster would be destroyed by battle, return this card to its owner's hand instead. Then, destroy 1 monster, except the one that battled the equipped monster, and inflict 600 damage to your opponent. After that, Special Summon 1 \"Evil Token\" (Fiend-Type/DARK/Level 7/ATK 2500/DEF 2500) on your opponent's side of the field. During the turn this card is returned to your hand, you cannot use \"Vicious Claw\" from your hand.",
  effects: [
    equipActivate({
      condition: (ctx) => !(ctx.self.location === 'hand' && ctx.game.turnData[`ptdn:claw:${ctx.player}`]),
      score: (ctx) => ownEquipScore(ctx, (c) => c.pos === 'atk', 28),
    }),
    {
      kind: 'continuous',
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget, value: 300 }],
      replaceDestroyOne: async (ctx, card, reason) => {
        if (reason !== 'battle' || card !== ctx.equipTarget || !ctx.self.onField) return false;
        const me = ctx.self;
        const foe = battleOpponent(ctx, card);
        ctx.log(`${me.name} returns to the hand instead.`);
        await ctx.toHand(me);
        if (me.location !== 'hand') return false;
        ctx.game.turnData[`ptdn:claw:${me.owner}`] = true;
        const cands = ctx.monsters('both', (c) => c !== foe);
        if (cands.length) {
          const s = await ctx.select(cands, 1, 1, 'Destroy 1 monster (Vicious Claw).', 'destroy', {
            aiScore: (c) => (c === card ? -9000 : c.controller === ctx.player ? -cardValue(ctx.game, c) : cardValue(ctx.game, c)),
          });
          if (s.length) await ctx.destroy(s);
        }
        await ctx.damage(ctx.opp, 600);
        if (ctx.game.freeMZones(ctx.opp) > 0 && !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) await ctx.createTokens(evilToken, 1, 'atk', ctx.opp);
        return true;
      },
    },
  ],
});

spell('Instant Neo Space', 'equip', {
  text: 'Equip only to a Fusion Monster that lists "Elemental HERO Neos" as material. It does not have to activate its effect during the End Phase to shuffle itself into the Extra Deck. If the equipped monster leaves the field: You can Special Summon 1 "Elemental HERO Neos" from your hand, Deck, or GY.',
  effects: [
    equipActivate({ filter: (_ctx, c) => listsNeos(c), score: (ctx) => ownEquipScore(ctx, listsNeos, 40) }),
    {
      kind: 'trigger',
      event: 'leftField',
      label: 'Special Summon "Elemental HERO Neos"',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => !!evc(ev) && ctx.self.onField && ctx.self.equippedTo === evc(ev)!.uid,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'deck', 'grave'], (c) => c.name.toLowerCase() === 'elemental hero neos').length > 0,
      resolve: async (ctx) => {
        await summonFromHandDeckGrave(ctx, (c) => c.name.toLowerCase() === 'elemental hero neos' && ctx.canSummonCard(c), 'Special Summon 1 "Elemental HERO Neos" from your hand, Deck, or GY.', false);
      },
    },
  ],
});

spell('Mirage Tube', 'quickplay', {
  text: 'This card cannot be activated from your hand. Activate only when a face-up monster you control is selected as an attack target. Inflict 1000 damage to your opponent.',
  effects: [
    {
      kind: 'activate',
      range: ['szone'],
      event: 'attackDeclared',
      // 'protect' only so the AI Sets it (it cannot be activated from the hand).
      categories: ['damage', 'protect'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && faceUpOn(t) && t.controller === ctx.player;
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 1000);
      },
      ai: { score: () => 50 },
    },
  ],
});

// ---- Spell Chronicle
const chronicleBanished = new WeakMap<C, { card: C; mid: number }[]>();
const chronicleLive = (src: C) => (chronicleBanished.get(src) ?? []).filter((x) => x.card.location === 'banished' && x.card.moveId === x.mid).map((x) => x.card);
spell('Spell Chronicle', 'continuous', {
  text: "Activate this card by sending your entire hand to the GY; banish 5 Spells/Traps from your Deck. Each time your opponent activates a Spell Card, place 1 Chronicle Counter on this card when that Spell Card resolves. You can remove 2 Chronicle Counters from this card; your opponent chooses 1 card banished by this card's effect for you to add to your hand. If this face-up card in the Spell & Trap Zone leaves the field: You take 500 damage for each card currently banished by this card's effect.",
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: ['banish'],
      canActivate: (ctx) => ctx.deck('me', (c) => c.isSpell || c.isTrap).length >= 5,
      activate: async (ctx) => {
        chronicleBanished.set(ctx.self, []);
        const hand = ctx.hand('me', (c) => c !== ctx.self);
        if (hand.length) await ctx.sendToGrave(hand, 'cost');
      },
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const cands = ctx.deck('me', (c) => c.isSpell || c.isTrap);
        const n = Math.min(5, cands.length);
        const s = await ctx.select(cands, n, n, 'Banish 5 Spells/Traps from your Deck.', 'toHand');
        const r = await ctx.banish(s);
        ctx.game.shuffleDeck(ctx.player);
        chronicleBanished.set(
          ctx.self,
          r.filter((c) => c.location === 'banished').map((c) => ({ card: c, mid: c.moveId })),
        );
      },
      ai: { score: (ctx) => (mainPhase(ctx) && ctx.hand('me', (c) => c !== ctx.self).length === 0 ? 22 : 0) },
    },
    SPELL_WATCH,
    {
      kind: 'trigger',
      event: 'chainResolved',
      range: ['szone'],
      label: '(Chronicle Counter)',
      eventFilter: (ctx, ev) => {
        const info = spellResolved(ev);
        if (info && info.player === ctx.opp && stActive(ctx)) {
          ctx.self.counters.chronicle = (ctx.self.counters.chronicle ?? 0) + 1;
          ctx.game.update();
        }
        return false;
      },
    },
    {
      kind: 'ignition',
      range: ['szone'],
      label: 'Remove 2 Chronicle Counters: add a banished card',
      categories: ['toHand'],
      canActivate: (ctx) => (ctx.self.counters.chronicle ?? 0) >= 2 && chronicleLive(ctx.self).length > 0,
      activate: async (ctx) => {
        ctx.self.counters.chronicle = (ctx.self.counters.chronicle ?? 0) - 2;
      },
      resolve: async (ctx) => {
        const live = chronicleLive(ctx.self);
        if (!live.length) return;
        const [c] = await ctx.select(live, 1, 1, 'Choose 1 card banished by Spell Chronicle for your opponent to add to their hand.', 'generic', {
          player: ctx.opp,
          aiScore: (x) => -cardValue(ctx.game, x),
        });
        if (c) await ctx.toHand(c);
      },
      ai: { score: () => 50 },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      mandatory: true,
      label: 'Take 500 damage per banished card',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && !!ev.fromFaceUp,
      resolve: async (ctx) => {
        const n = chronicleLive(ctx.self).length;
        if (n) await ctx.damage(ctx.player, 500 * n);
      },
    },
  ],
});

const dimExplosionCands = (ctx: Ctx, p: PlayerId) =>
  ctx.game
    .zone(p, 'banished')
    .filter((c) => c.isMonster && c.faceUp && !c.isToken && !(c.data.nomi && !c.properlySummoned) && !(c.isExtra && !c.properlySummoned) && ctx.canTarget(c));
spell('Dimension Explosion', 'quickplay', {
  text: 'Return 1 face-up Fusion Monster you control to the Fusion Deck. Both players select up to 2 of their monsters that are removed from play, and Special Summon them.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      // Returning the Fusion Monster is the cost; it targets banished monsters of both players, and needs at least 1
      // banished monster and 1 open Monster Card Zone for each player: https://edisonrul.ing/cards/d/dimension-explosion.html
      canActivate: (ctx) =>
        ctx.faceUpMonsters('me', (c) => c.hasType('fusion')).length > 0 &&
        ([ctx.player, ctx.opp] as PlayerId[]).every((p) => dimExplosionCands(ctx, p).length > 0) &&
        ctx.game.freeMZones(ctx.opp) > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.faceUpMonsters('me', (c) => c.hasType('fusion')), 1, 1, 'Return 1 face-up Fusion Monster you control to the Extra Deck.', 'cost');
        if (!s.length) return false;
        await ctx.toDeck(s, 'shuffle', 'cost');
        for (const p of [ctx.player, ctx.opp] as PlayerId[]) {
          const max = Math.max(1, Math.min(2, ctx.game.freeMZones(p)));
          const t = await ctx.select(dimExplosionCands(ctx, p), 1, max, 'Select up to 2 of your banished monsters to Special Summon.', 'specialSummon', { player: p, aiScore: revScore });
          ctx.addTargets(t);
        }
      },
      resolve: async (ctx) => {
        for (const p of [ctx.player, ctx.opp] as PlayerId[]) {
          const g = ctx.game;
          if (g.queryPlayer(p, 'cannotSpecialSummon') || g.freeMZones(p) <= 0) continue;
          const s = ctx.validTargets((c) => c.location === 'banished' && c.owner === p).slice(0, g.freeMZones(p));
          if (s.length) await g.specialSummon(s, p, { pos: 'choose', reasonCard: ctx.self });
        }
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.banished('me', (c) => c.isMonster && c.faceUp).map(revScore).sort((a, b) => b - a).slice(0, 2);
          const theirs = ctx.banished('opp', (c) => c.isMonster && c.faceUp).map(revScore).sort((a, b) => b - a).slice(0, 2);
          const fusion = Math.min(...ctx.faceUpMonsters('me', (c) => c.hasType('fusion')).map((c) => cardValue(ctx.game, c)));
          const net = mine.reduce((a, b) => a + b, 0) - theirs.reduce((a, b) => a + b, 0) - fusion;
          return mainPhase(ctx) && net > 1000 ? 45 : 0;
        },
      },
    },
  ],
});

spell('Cybernetic Zone', 'quickplay', {
  text: 'Select 1 face-up Machine-Type Fusion Monster you control and remove it from play until the End Phase of this turn. When that monster is returned to the field, double its ATK. During your next Standby Phase, destroy it.',
  effects: [
    {
      kind: 'activate',
      categories: ['banish', 'protect'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => c.hasType('fusion') && isRace(c, 'Machine')).some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => c.hasType('fusion') && isRace(c, 'Machine')), 1, 1, 'Select 1 face-up Machine-Type Fusion Monster you control.', 'target');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => faceUpOn(c))[0];
        if (!t) return;
        const r = await ctx.banish(t);
        if (!r.length || t.location !== 'banished') return;
        const mid = t.moveId;
        const p = ctx.player;
        const g = ctx.game;
        ctx.later('end', async () => {
          if (t.location !== 'banished' || t.moveId !== mid) return;
          // APPROX: returned to the field without Summon events (it is not a Summon).
          const dest = g.rawMove(t, 'mzone', { controller: p, faceUp: true, pos: 'atk' });
          if (dest !== 'mzone') return;
          g.log(`${t.name} returns to the field with double ATK.`, 'action', p);
          g.addTempMod(t, 'atk', g.getAtk(t), 'field', ctx.self);
          g.update();
          const back = t.moveId;
          ctx.later(
            'standby',
            async () => {
              if (t.location === 'mzone' && t.moveId === back) await g.destroy([t], 'effect', p, ctx.self);
            },
            g.turnPlayer === p ? 2 : 1,
          );
        });
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l || l.player !== ctx.opp) return 0;
          const hit = ctx.faceUpMonsters('me', (c) => c.hasType('fusion') && isRace(c, 'Machine')).some((c) => l.ctx.targets.includes(c) || (l.effect.categories ?? []).includes('destroyMulti'));
          return hit ? 60 : 0;
        },
      },
    },
  ],
});

spell('The Beginning of the End', 'normal', {
  text: 'If you have 7 or more DARK monsters in your GY: Banish 5 DARK monsters from your GY; draw 3 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'banish'],
      condition: (ctx) => ctx.grave('me', isDark).length >= 7,
      canActivate: (ctx) => ctx.deck('me').length >= 3 && !ctx.game.queryPlayer(ctx.player, 'cannotDraw'),
      activate: async (ctx) => {
        const s = await ctx.select(ctx.grave('me', isDark), 5, 5, 'Banish 5 DARK monsters from your GY.', 'cost', { aiScore: (c) => -revScore(c) });
        if (s.length < 5) return false;
        await ctx.banish(s, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(3);
      },
      ai: { score: () => 70 },
    },
  ],
});

spell('Dark Eruption', 'normal', {
  text: 'Target 1 DARK monster with 1500 or less ATK in your GY; add that target to your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.grave('me', (c) => isDark(c) && (c.data.atk ?? 0) <= 1500).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isDark(c) && (c.data.atk ?? 0) <= 1500), 1, 1, 'Target 1 DARK monster with 1500 or less ATK in your GY.', 'toHand', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (c.data.atk ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
      ai: { score: (ctx) => (ctx.grave('me', (c) => isDark(c) && (c.data.atk ?? 0) <= 1500 && revScore(c) >= 900).length ? 45 : 0) },
    },
  ],
});

const doomsdayToken = token('Doomsday Token', 'DARK', 'Fiend', 1, 0, 0, 'Doomsday Token (Fiend/DARK/Level 1/ATK 0/DEF 0). Cannot be Tributed for a Tribute Summon, unless it is for a DARK monster.');
spell('Fires of Doomsday', 'quickplay', {
  text: 'Special Summon 2 "Doomsday Tokens" (Fiend/DARK/Level 1/ATK 0/DEF 0) in Defense Position. They cannot be Tributed for a Tribute Summon, unless it is for a DARK monster. You cannot Summon other monsters the turn you activate this card (but you can Normal Set).',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      condition: (ctx) => !summonedThisTurn(ctx.game, ctx.player),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.freeMZones() >= 2,
      resolve: async (ctx) => {
        if (ctx.freeMZones() >= 2 && ctx.canSpecialSummon()) {
          const r = await ctx.createTokens(doomsdayToken, 2, 'def');
          for (const t of r) {
            t.flags.noTributeSummonFodder = true;
            t.flags.tributeFodderFor = (f: C) => isDark(f);
          }
        }
        // APPROX: Flip Summons are not blocked (the engine has no Flip Summon restriction).
        ctx.addPlayerMod(ctx.player, 'cannotNormalSummon');
        ctx.addPlayerMod(ctx.player, 'cannotSpecialSummon');
      },
      ai: {
        score: (ctx) => {
          if (!ctx.isMyTurn || ctx.phase !== 'main2') return 0;
          const darkBoss = ctx.hand('me', (c) => isDark(c) && lvl(c) >= 5 && !c.data.cannotNormalSummon).length > 0;
          return darkBoss || ctx.monsters('me').length === 0 ? 30 : 0;
        },
      },
    },
  ],
});

spell('Unleash Your Power!', 'quickplay', {
  text: 'All Gemini monsters that were on your side of the field when this card was activated are treated as Effect Monsters, and gain their effect(s). During the End Phase of this turn, Set all monsters affected by this card\'s effect.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      canActivate: (ctx) => ctx.faceUpMonsters('me', isGemini).length > 0,
      activate: async (ctx) => {
        ctx.data.list = ctx.faceUpMonsters('me', isGemini).map((c) => ({ c, mid: c.moveId }));
      },
      resolve: async (ctx) => {
        const list = (ctx.data.list as { c: C; mid: number }[]).filter((x) => faceUpOn(x.c) && x.c.moveId === x.mid && x.c.controller === ctx.player);
        for (const x of list) makeGeminiActive(ctx, x.c);
        if (!list.length) return;
        ctx.later('end', async () => {
          for (const x of list) {
            if (x.c.location === 'mzone' && x.c.moveId === x.mid && x.c.faceUp) {
              await ctx.game.setFaceDown(x.c); // loses its Gemini status (engine: resetOnFaceDown)
            }
          }
        });
      },
      ai: { score: (ctx) => (mainPhase(ctx) && ctx.faceUpMonsters('me', (c) => isGemini(c) && !c.flags.geminiSummoned).length ? 38 : 0) },
    },
  ],
});

spell('Chain Summoning', 'quickplay', {
  text: 'Activate as Chain Link 3 or higher: You can conduct up to 3 Normal Summons/Sets this turn, not just 1. You cannot activate this card if multiple cards with the same name, or the effects of such cards, are already activated in that Chain.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      condition: (ctx) => {
        const ch = ctx.game.chain.filter((l) => l !== ctx.link);
        if (ch.length < 2) return false;
        const names = ch.map((l) => l.card.name);
        return new Set(names).size === names.length && !names.includes('Chain Summoning');
      },
      resolve: async (ctx) => {
        const g = ctx.game;
        const used = eventsThisTurn(g).filter((e) => (e.type === 'normalSummoned' || e.type === 'monsterSet') && e.player === ctx.player).length;
        if (g.turnPlayer !== ctx.player) return;
        g.players[ctx.player].normalSummonsLeft = Math.max(g.players[ctx.player].normalSummonsLeft, 3 - used);
        ctx.log(`${g.players[ctx.player].name} can conduct up to 3 Normal Summons/Sets this turn.`);
      },
      ai: { score: (ctx) => (ctx.isMyTurn && mainPhase(ctx) && ctx.hand('me', (c) => c.isMonster && lvl(c) <= 4).length >= 2 ? 40 : 0) },
    },
  ],
});

spell('Acidic Downpour', 'field', {
  text: 'All EARTH monsters lose 500 ATK and gain 400 DEF.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      ai: {
        score: (ctx) => {
          const n = (p: 'me' | 'opp') => ctx.faceUpMonsters(p, (c) => c.data.attribute === 'EARTH').length;
          return mainPhase(ctx) && n('opp') > n('me') ? 30 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'atk', to: 'cards', filter: (_ctx, c: C) => faceUpOn(c) && c.data.attribute === 'EARTH', value: -500 },
        { q: 'def', to: 'cards', filter: (_ctx, c: C) => faceUpOn(c) && c.data.attribute === 'EARTH', value: 400 },
      ],
    },
  ],
});

spell('Six Samurai United', 'continuous', {
  text: 'Each time a "Six Samurai" monster(s) is Normal or Special Summoned, place 1 Bushido Counter on this card (max. 2). You can send this card to the GY; draw 1 card for each Bushido Counter on this card.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (mainPhase(ctx) && ctx.hand('me', isSixSamurai).length ? 30 : 0) } },
    {
      // Listener: Bushido Counters (once per Summon event batch).
      kind: 'trigger',
      event: ['normalSummoned', 'specialSummoned'],
      range: ['szone'],
      label: '(Bushido Counter)',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || !isSixSamurai(c) || !stActive(ctx) || ctx.self.flags.ssuBatch === ev.batch) return false;
        ctx.self.flags.ssuBatch = ev.batch;
        ctx.self.counters.bushido = Math.min(2, (ctx.self.counters.bushido ?? 0) + 1);
        ctx.game.update();
        return false;
      },
    },
    {
      kind: 'ignition',
      range: ['szone'],
      label: 'Send to the GY: draw 1 per Bushido Counter',
      categories: ['draw'],
      canActivate: (ctx) => ctx.self.faceUp && ctx.self.activeOnField,
      activate: async (ctx) => {
        ctx.data.n = ctx.self.counters.bushido ?? 0;
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.data.n) await ctx.draw(ctx.data.n);
      },
      ai: { score: (ctx) => ((ctx.self.counters.bushido ?? 0) >= 2 ? 55 : 0) },
    },
  ],
});

const shieldHost = new WeakMap<C, { host: C; mid: number; ctrl: PlayerId }>();
spell("Gladiator Beast's Battle Archfiend Shield", 'equip', {
  sets: ['gladiator'],
  text: 'Equip only to a "Gladiator Beast" monster. If the equipped monster would be destroyed, destroy this card instead. When this card is sent to your Graveyard because the equipped monster you controlled was shuffled into your Deck: Return this card to your hand.',
  effects: [
    equipActivate({
      filter: (_ctx, c) => isGB(c),
      score: (ctx) => ownEquipScore(ctx, isGB, 30),
      onEquip: (ctx, t) => shieldHost.set(ctx.self, { host: t, mid: t.moveId, ctrl: t.controller }),
    }),
    {
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card) => {
        if (card !== ctx.equipTarget || !ctx.self.onField) return false;
        ctx.log(`${ctx.self.name} is destroyed instead.`);
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        return !ctx.self.onField;
      },
    },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Return this card to your hand',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self || ev.from !== 'szone') return false;
        const h = shieldHost.get(ctx.self);
        return !!h && h.ctrl === ctx.player && (h.host.location === 'deck' || h.host.location === 'extra') && h.host.moveId === h.mid + 1;
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave') await ctx.toHand(ctx.self);
      },
    },
  ],
});

spell('Dark World Grimoire', 'continuous', {
  text: 'During your End Phase, if you discard a monster(s) to the Graveyard because you had more cards than your hand size limit: You can target 1 of those monsters; Special Summon that target.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (mainPhase(ctx) && ctx.hand('me').length >= 7 ? 25 : 0) } },
    {
      kind: 'trigger',
      event: 'discarded',
      range: ['szone'],
      label: 'Special Summon a discarded monster',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return stActive(ctx) && ctx.isMyTurn && ctx.phase === 'end' && reasonsOf(ev).includes('rule') && !!c && c.isMonster && c.owner === ctx.player && c.location === 'grave';
      },
      canActivate: (ctx) => ctx.canSpecialSummon() && batchCards(ctx, ['discarded']).some((c) => c.location === 'grave' && c.isMonster && ctx.canSummonCard(c)),
      activate: async (ctx) => {
        const cands = batchCards(ctx, ['discarded']).filter((c) => c.location === 'grave' && c.isMonster && c.owner === ctx.player && ctx.canSummonCard(c));
        await ctx.selectTargets(cands, 1, 1, 'Target 1 of the discarded monsters.', 'specialSummon', { aiScore: revScore });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t, { pos: autoPos(ctx, t) });
      },
    },
  ],
});

// ============================================================ TRAPS

const isOppAttack = (ctx: Ctx, ev: GameEvent) => {
  const a = evc(ev);
  return !!a && a.controller === ctx.opp && a.location === 'mzone';
};

trap('Rainbow Path', 'normal', {
  text: 'When an opponent\'s monster declares an attack: Send 1 "Crystal Beast" card from your Spell & Trap Zone to the GY, then target the attacking monster; negate the attack, then you can add 1 "Rainbow Dragon" or "Rainbow Dark Dragon" from your Deck to your hand.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack', 'search'],
      eventFilter: isOppAttack,
      canActivate: (ctx) => ctx.cards('me', 'szone', (c) => c !== ctx.self && isCrystalBeast(c)).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.cards('me', 'szone', (c) => c !== ctx.self && isCrystalBeast(c)), 1, 1, 'Send 1 "Crystal Beast" card from your Spell & Trap Zone to the GY.', 'cost');
        if (!s.length) return false;
        await ctx.sendToGrave(s, 'cost');
        const a = evc(ctx.event!);
        if (a) ctx.addTargets([a]);
      },
      resolve: async (ctx) => {
        if (!ctx.validTargets((c) => c.location === 'mzone').length) return;
        ctx.negateAttack();
        const f = (c: C) => c.name === 'Rainbow Dragon' || c.name === 'Rainbow Dark Dragon';
        if (ctx.deck('me', f).length && (await ctx.confirm('Add "Rainbow Dragon" or "Rainbow Dark Dragon" from your Deck to your hand?', true))) await ctx.search(f);
      },
      ai: { score: (ctx) => (ctx.battle && ctx.atk(ctx.battle.attacker) >= 1500 ? 50 : 0) },
    },
  ],
});

/** Expected damage to `p` from the current attack (AI helper). */
function incomingBattleDamage(ctx: Ctx, p: PlayerId): number {
  const b = ctx.battle;
  if (!b || b.attacker.controller === p) return 0;
  const atk = ctx.atk(b.attacker);
  if (!b.target) return atk;
  if (b.target.pos === 'atk') return Math.max(0, atk - ctx.atk(b.target));
  return ctx.query(b.attacker, 'piercing') ? Math.max(0, atk - ctx.def(b.target)) : 0;
}

trap('Rainbow Life', 'normal', {
  text: 'Discard 1 card; until the end of this turn, each time you would take damage, gain that amount of LP instead.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: ['recover', 'protect'],
      canActivate: (ctx) => ctx.hand('me').length > 0,
      activate: async (ctx) => {
        ensurePtdnPatches(ctx.game);
        const d = await ctx.discardFromHand(1, undefined, 'cost');
        if (!d.length) return false;
      },
      resolve: async (ctx) => {
        ensurePtdnPatches(ctx.game);
        ctx.game.turnData[`ptdn:rainbowLife:${ctx.player}`] = true;
        ctx.log('Until the end of this turn, damage becomes an LP gain.');
      },
      ai: {
        score: (ctx) => {
          if (ctx.game.turnData[`ptdn:rainbowLife:${ctx.player}`]) return 0;
          const dmg = incomingBattleDamage(ctx, ctx.player);
          if (dmg >= 1500 && !ctx.battle?.inDamageStep) return 45;
          const top = ctx.chainTop();
          if (top && top.player === ctx.opp && (top.effect.categories ?? []).includes('damage')) return 40;
          return 0;
        },
      },
    },
  ],
});

/** Battle damage the player took in the battle (Damage Step) of `ev`. */
const seedsDamage = (ctx: Ctx, ev: GameEvent) =>
  ev.dsId === undefined
    ? 0
    : ctx.game.eventLog.filter((e) => e.type === 'battleDamage' && e.player === ctx.player && e.dsId === ev.dsId).reduce((a, e) => a + (e.amount ?? 0), 0);
const seedToken = token('Sinister Seed Token', 'DARK', 'Plant', 1, 100, 100, 'Sinister Seed Token (Plant-Type/DARK/Level 1/ATK 100/DEF 100). Special Summoned by "Sinister Seeds".');
trap('Sinister Seeds', 'normal', {
  text: 'When a monster you control is destroyed by a battle in which you took damage, and it was in face-up Attack Position at the start of the Damage Step and when it was destroyed: Special Summon 1 "Sinister Seed Token" (Plant-Type/DARK/Level 1/ATK 100/DEF 100) for every 500 points of battle damage you took from that battle.',
  effects: [
    {
      kind: 'activate',
      event: 'battleDestroyed',
      damageStep: true,
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || ev.fromController !== ctx.player) return false;
        const b = ctx.battle;
        const wasAtk = !b?.calc || (c === b.attacker ? true : b.calc.targetPos === 'atk');
        return seedsDamage(ctx, ev) >= 500 && wasAtk;
      },
      // https://edisonrul.ing/cards/s/sinister-seeds.html — cannot be activated without enough empty Monster Zones for every
      // Token (so never for 3000 or more battle damage).
      canActivate: (ctx) => ctx.canSpecialSummon() && !!ctx.event && ctx.freeMZones() >= Math.floor(seedsDamage(ctx, ctx.event) / 500),
      activate: async (ctx) => {
        ctx.data.n = ctx.event ? Math.floor(seedsDamage(ctx, ctx.event) / 500) : 0;
      },
      resolve: async (ctx) => {
        const n = Math.min(ctx.data.n ?? 0, ctx.freeMZones());
        if (n > 0) await ctx.createTokens(seedToken, n, 'def');
      },
      ai: { score: (ctx) => (ctx.event && seedsDamage(ctx, ctx.event) >= 1000 ? 40 : 0) },
    },
  ],
});

trap('Hate Buster', 'normal', {
  text: "When a Fiend-Type monster you control is targeted for an attack: Target the opponent's attacking monster and that monster you control; destroy both targets, and if you do, inflict damage to your opponent equal to the original ATK of the opponent's destroyed monster.",
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['destroy', 'damage'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return isOppAttack(ctx, ev) && !!t && faceUpOn(t) && t.controller === ctx.player && isRace(t, 'Fiend');
      },
      activate: async (ctx) => {
        const a = evc(ctx.event!)!;
        const t = evo(ctx.event!)!;
        ctx.addTargets([a, t].filter((c) => ctx.canTarget(c)));
        ctx.data.att = a;
      },
      resolve: async (ctx) => {
        const a = ctx.data.att as C;
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length < 2) return;
        const atk = a.data.atk ?? 0;
        await ctx.destroy(t);
        if (a.location !== 'mzone') await ctx.damage(ctx.opp, atk);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b?.target) return 0;
          return cardValue(ctx.game, b.attacker) >= cardValue(ctx.game, b.target) || (b.attacker.data.atk ?? 0) >= ctx.oppLp ? 50 : 0;
        },
      },
    },
  ],
});

// ---- Chain Material: hooks into spells.ts' Fusion Summon helper for the rest of the turn.
const chainMaterialHooked = new WeakSet<FusionSummonOpts>();
fusionOptionHooks.push((ctx, o) => {
  if (chainMaterialHooked.has(o) || !ctx.game.turnData[`ptdn:chainMaterial:${ctx.player}`]) return null;
  const from = [...new Set<Location>([...(o.from ?? ['hand', 'mzone']), 'mzone', 'hand', 'deck', 'grave'])];
  const prev = o.onSummoned;
  const r: FusionSummonOpts = {
    ...o,
    from,
    dest: 'banish',
    onSummoned: (c, fusion) => {
      prev?.(c, fusion);
      const mid = fusion.moveId;
      c.later('end', async () => {
        if (fusion.location === 'mzone' && fusion.moveId === mid) await c.game.destroy([fusion], 'effect', c.player, fusion);
      });
    },
  };
  chainMaterialHooked.add(r);
  return r;
});
trap('Chain Material', 'normal', {
  text: 'Any time you Fusion Summon a monster this turn, you can remove from play, from your side of the field, Deck, hand or Graveyard, Fusion Material Monsters that are listed on the Fusion Monster Card, and use them as Fusion Material Monsters. You cannot attack during the turn this card is activated. If you used this effect for a Fusion Summon, the Summoned Fusion Monster(s) is destroyed during the End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      condition: (ctx) => !ctx.game.turnData[`ptdn:chainMaterial:${ctx.player}`],
      resolve: async (ctx) => {
        // APPROX: applies to every Fusion Summon made with spells.ts' helper (Polymerization, Overload Fusion);
        // the materials are always taken from the wider pool and banished.
        ctx.game.turnData[`ptdn:chainMaterial:${ctx.player}`] = true;
        ctx.addPlayerMod(ctx.player, 'cannotDeclareAttack');
        ctx.log('Fusion Materials can be banished from the field, Deck, hand or GY this turn.');
      },
      // AI: not used (the Fusion Monster cannot attack this turn and is destroyed in the End Phase).
      ai: { score: () => 0 },
    },
  ],
});

const alchemyMarks = new WeakMap<C, { src: number; mid: number; turn: number }>();
trap('Alchemy Cycle', 'normal', {
  text: 'The original ATK of all face-up monsters you control becomes 0, until the End Phase. Each time a monster that had its original ATK reduced to 0 by this effect is destroyed by battle and sent to the Graveyard, draw 1 card.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange', 'draw'],
      canActivate: (ctx) => ctx.faceUpMonsters('me').length > 0,
      resolve: async (ctx) => {
        const g = ctx.game;
        for (const c of ctx.faceUpMonsters('me')) {
          c.flags.baseAtk = 0;
          alchemyMarks.set(c, { src: ctx.self.uid, mid: c.moveId, turn: ctx.turn });
          const mid = c.moveId;
          ctx.later('end', async () => {
            if (c.location === 'mzone' && c.moveId === mid) delete c.flags.baseAtk;
            g.update();
          });
        }
        g.update();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || b.inDamageStep || !b.target || b.attacker.controller !== ctx.opp) return 0;
          const t = b.target;
          return t.controller === ctx.player && t.faceUp && t.pos === 'atk' && ctx.atk(t) < ctx.atk(b.attacker) && ctx.lp > ctx.atk(b.attacker) + 1000 ? 35 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ALL_LOCS,
      mandatory: true,
      label: 'Draw 1 card',
      categories: ['draw'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || c.location !== 'grave') return false;
        const m = alchemyMarks.get(c);
        return !!m && m.src === ctx.self.uid && m.turn === ctx.turn && c.moveId === m.mid + 1 && c.owner === ctx.player;
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

const cyberHostsToSend = (ctx: Ctx) => ctx.faceUpMonsters('me', (c) => c.name === 'Cyber Dragon' || listsCyberDragon(c));
trap('Cybernetic Hidden Technology', 'continuous', {
  text: 'When an opponent\'s monster declares an attack: You can send to the Graveyard 1 "Cyber Dragon" you control, or 1 Fusion Monster you control that lists "Cyber Dragon" as a Fusion Material Monster, then target the attacking monster; destroy that target.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      ai: { score: (ctx) => (!ctx.isMyTurn && !ctx.game.chain.length && (ctx.phase === 'standby' || ctx.phase === 'battle') && cyberHostsToSend(ctx).length ? 35 : 0) },
    },
    {
      kind: 'quick',
      range: ['szone'],
      event: 'attackDeclared',
      label: 'Send a "Cyber Dragon": destroy the attacker',
      categories: ['destroy'],
      eventFilter: isOppAttack,
      condition: stActive,
      canActivate: (ctx) => cyberHostsToSend(ctx).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(cyberHostsToSend(ctx), 1, 1, 'Send 1 "Cyber Dragon" (or a Fusion Monster that lists it) to the GY.', 'cost');
        if (!s.length) return false;
        await ctx.sendToGrave(s, 'cost');
        const a = evc(ctx.event!);
        if (a && ctx.canTarget(a)) ctx.addTargets([a]);
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone');
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const cheapest = Math.min(...cyberHostsToSend(ctx).map((c) => cardValue(ctx.game, c)));
          return cardValue(ctx.game, b.attacker) > cheapest || incomingBattleDamage(ctx, ctx.player) >= 1500 ? 55 : 0;
        },
      },
    },
  ],
});

trap('Dark Spirit Art - Greed', 'normal', {
  text: 'Tribute 1 DARK monster. Draw 2 cards. Your opponent can negate this effect by revealing 1 Spell Card in their hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => tributable(ctx, (c) => isDark(c)).length > 0 && ctx.deck('me').length >= 2,
      activate: async (ctx) => {
        const s = await ctx.select(tributable(ctx, (c) => isDark(c)), 1, 1, 'Tribute 1 DARK monster.', 'tribute');
        if (!s.length) return false;
        await tributeCost(ctx, s);
      },
      resolve: async (ctx) => {
        const spells = ctx.hand('opp', (c) => c.isSpell);
        if (spells.length && (await ctx.game.confirm(ctx.opp, 'Reveal 1 Spell Card in your hand to negate "Dark Spirit Art - Greed"?', ctx.self, true))) {
          const [s] = await ctx.select(spells, 1, 1, 'Reveal 1 Spell Card.', 'generic', { player: ctx.opp });
          if (s) {
            await reveal(ctx, [s], ctx.opp);
            ctx.log('The effect of "Dark Spirit Art - Greed" is negated.');
            return;
          }
        }
        await ctx.draw(2);
      },
      ai: {
        score: (ctx) => {
          if (ctx.isMyTurn ? ctx.phase !== 'main2' : ctx.phase !== 'end') return 0;
          return tributable(ctx, (c) => isDark(c) && (c.isToken || cardValue(ctx.game, c) < 1300)).length ? 40 : 0;
        },
      },
    },
  ],
});

trap('Dark Illusion', 'counter', {
  text: 'When a Spell/Trap Card, or monster effect, is activated that targets a DARK monster on the field: Negate the activation, and if you do, destroy that card.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate', 'destroy'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        if (!l || l.negated) return false;
        if (l.card.isMonster && l.isCardActivation) return false;
        return l.ctx.targets.some((t) => faceUpOn(t) && isDark(t));
      },
      activate: async (ctx) => {
        ctx.data.link = ctx.prevLink();
      },
      resolve: async (ctx) => {
        const l = ctx.data.link as ChainLink | undefined;
        if (l) await ctx.negateAndDestroy(l);
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          return l && l.player === ctx.opp && l.ctx.targets.some((t) => faceUpOn(t) && isDark(t) && t.controller === ctx.player) ? 65 : 0;
        },
      },
    },
  ],
});

trap('Escape from the Dark Dimension', 'continuous', {
  text: 'Target 1 of your banished DARK monsters; Special Summon that target. When this card leaves the field, destroy that target, and if you do, banish it. When that target is destroyed, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.banished('me', (c) => isDark(c) && c.faceUp && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.banished('me', (c) => isDark(c) && c.faceUp && ctx.canSummonCard(c)), 1, 1, 'Target 1 of your banished DARK monsters.', 'specialSummon', { aiScore: revScore });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'banished')[0];
        const me = ctx.self;
        if (!t || !me.onField || !ctx.canSummonCard(t)) return;
        const r = await ctx.specialSummon(t, { pos: autoPos(ctx, t) });
        if (!r.length) return;
        // This card is destroyed when the monster leaves; the monster is destroyed (and banished) when this card leaves.
        ctx.game.link(me, t, true);
        const tmid = t.moveId;
        const emid = me.moveId;
        let backing = false;
        Object.defineProperty(t, 'banishOnLeave', {
          configurable: true,
          get: () => backing || (t.moveId === tmid && t.location === 'mzone' && !(me.onField && me.moveId === emid)),
          set: (v: boolean) => {
            backing = v;
          },
        });
      },
      ai: {
        score: (ctx) => {
          const best = Math.max(0, ...ctx.banished('me', (c) => isDark(c) && c.faceUp && ctx.canSummonCard(c)).map(revScore));
          if (best < 1600) return 0;
          return (ctx.isMyTurn && ctx.phase === 'main1') || (!ctx.isMyTurn && ctx.phase === 'end') ? 45 : 0;
        },
      },
    },
  ],
});

/** Gemini Trap Hole: which monsters were Gemini-active Effect Monsters when the attack was declared. */
const geminiAtBattle = new WeakMap<C, number>();
trap('Gemini Trap Hole', 'normal', {
  text: 'Activate only when a Gemini monster that is treated as an Effect Monster is destroyed by battle. Destroy all monsters your opponent controls.',
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      range: ALL_LOCS,
      label: '(record Gemini monsters)',
      eventFilter: (ctx, ev) => {
        for (const c of [evc(ev), evo(ev)]) if (c && geminiActive(c)) geminiAtBattle.set(c, c.moveId);
        return false;
      },
    },
    {
      kind: 'activate',
      event: 'battleDestroyed',
      damageStep: true,
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && isGemini(c) && geminiAtBattle.get(c) === c.moveId - 1;
      },
      canActivate: (ctx) => ctx.monsters('opp').length > 0,
      resolve: async (ctx) => {
        const list = ctx.monsters('opp');
        if (list.length) await ctx.destroy(list);
      },
      ai: { score: (ctx) => (ctx.monsters('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0) >= 2000 ? 70 : 0) },
    },
  ],
});

trap('Drastic Drop Off', 'counter', {
  text: 'When your opponent adds a card(s) from their Deck to their hand, including drawing: They must discard 1 of those cards.',
  effects: [
    {
      kind: 'activate',
      event: 'addedToHand',
      categories: ['discard'],
      // Not when the same resolution then has them discard (Graceful Charity): https://edisonrul.ing/cards/d/drastic-drop-off.html
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || ev.from !== 'deck' || c.owner !== ctx.opp || c.location !== 'hand') return false;
        const evs = ctx.game.recentEvents;
        return !evs.slice(evs.indexOf(ev) + 1).some((e) => e.type === 'discarded' && evc(e)?.owner === ctx.opp);
      },
      activate: async (ctx) => {
        ctx.data.cards = batchCards(ctx, ['addedToHand']).filter((c) => c.owner === ctx.opp && c.location === 'hand');
        ctx.data.drawn = ctx.event?.reason === 'draw';
      },
      resolve: async (ctx) => {
        const list = (ctx.data.cards as C[]).filter((c) => c.location === 'hand' && c.owner === ctx.opp);
        if (!list.length) return;
        const s = await ctx.select(list, 1, 1, 'Discard 1 of the cards you added to your hand.', 'discard', { player: ctx.opp });
        if (s.length) await ctx.game.discard(s, 'effect', ctx.player, ctx.self);
      },
      ai: {
        score: (ctx) => {
          const ev = ctx.event;
          if (!ev) return 0;
          if (ev.reason === 'draw') return ctx.phase === 'draw' ? 0 : 45;
          return 60;
        },
      },
    },
  ],
});

trap('All-Out Attacks', 'continuous', {
  text: 'If a monster(s) is Special Summoned while this card is face-up on the field: Change that monster to face-up Attack Position, and must attack, if able, during the turn they are Special Summoned.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (!ctx.isMyTurn && ctx.phase === 'end' && !ctx.game.chain.length ? 15 : 0) } },
    {
      // Continuous effect (no chain). APPROX: "must attack, if able" is not enforced (no engine hook for forced attacks).
      kind: 'trigger',
      event: 'specialSummoned',
      range: ['szone'],
      label: '(change to Attack Position)',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!c || !stActive(ctx) || c.location !== 'mzone' || (c.faceUp && c.pos === 'atk')) return false;
        c.pos = 'atk';
        c.faceUp = true;
        ctx.game.log(`${c.name} is changed to face-up Attack Position (All-Out Attacks).`, 'action');
        ctx.game.update();
        return false;
      },
    },
  ],
});

trap('Double Tag Team', 'normal', {
  sets: ['gladiator'],
  text: 'Activate only when you Special Summon a "Gladiator Beast" monster. Special Summon 1 Level 4 or lower "Gladiator Beast" monster from your hand or Deck.',
  effects: [
    {
      kind: 'activate',
      event: 'specialSummoned',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && isGB(c) && ev.player === ctx.player && c.location === 'mzone';
      },
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'deck'], (c) => isGB(c) && lvl(c) <= 4 && !c.isExtra && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['hand', 'deck'], (c) => isGB(c) && lvl(c) <= 4 && !c.isExtra);
        if (!cands.length || !ctx.canSpecialSummon()) return;
        const s = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower "Gladiator Beast" monster from your hand or Deck.', 'specialSummon', { aiScore: revScore });
        const fromDeck = s[0]?.location === 'deck';
        if (s.length) await ctx.specialSummon(s, { pos: autoPos(ctx, s[0]) });
        if (fromDeck) ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: () => 55 },
    },
  ],
});

trap('Offering to the Snake Deity', 'normal', {
  text: 'Target 1 face-up Reptile monster you control and 2 cards your opponent controls; destroy all three targets.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isRace(c, 'Reptile')).some((c) => ctx.canTarget(c)) && ctx.field('opp').filter((c) => ctx.canTarget(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => isRace(c, 'Reptile')), 1, 1, 'Target 1 face-up Reptile monster you control.', 'cost');
        await ctx.selectTargets(ctx.field('opp'), 2, 2, 'Target 2 cards your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.destroy(t);
      },
      ai: {
        score: (ctx) => {
          const rep = Math.min(...ctx.faceUpMonsters('me', (c) => isRace(c, 'Reptile')).map((c) => cardValue(ctx.game, c)));
          const foes = ctx.field('opp').map((c) => cardValue(ctx.game, c)).sort((a, b) => b - a).slice(0, 2);
          return foes.length === 2 && foes[0] + foes[1] > rep + 1200 ? 50 : 0;
        },
      },
    },
  ],
});

trap('Cry Havoc!', 'continuous', {
  text: 'You can remove from play 1 monster from your Graveyard to Normal Summon or Set 1 Normal Monster from your hand. You can only activate this effect during your Main Phase.',
  effects: [
    PATCH_LISTENER,
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.isMyTurn && mainPhase(ctx) && ctx.hand('me', (c) => c.hasType('normal')).length ? 25 : 0) } },
    {
      kind: 'ignition',
      range: ['szone'],
      label: 'Banish 1 monster from GY: Normal Summon/Set a Normal Monster',
      categories: [],
      condition: (ctx) => stActive(ctx) && mainPhase(ctx),
      canActivate: (ctx) => ctx.grave('me', (c) => c.isMonster).length > 0 && ctx.hand('me', (c) => c.hasType('normal') && !c.isToken).length > 0,
      activate: async (ctx) => {
        ensurePtdnPatches(ctx.game);
        const s = await ctx.select(ctx.grave('me', (c) => c.isMonster), 1, 1, 'Banish 1 monster from your GY.', 'cost', { aiScore: (c) => -revScore(c) });
        if (!s.length) return false;
        await ctx.banish(s, 'cost');
      },
      resolve: async (ctx) => {
        // APPROX: grants 1 additional Normal Summon/Set this turn that can only be used for a Normal Monster,
        // instead of summoning during the resolution.
        ensurePtdnPatches(ctx.game);
        const key = `ptdn:cryHavoc:${ctx.player}`;
        ctx.game.turnData[key] = ((ctx.game.turnData[key] as number | undefined) ?? 0) + 1;
        ctx.gainNormalSummon(1);
        ctx.log('You can Normal Summon or Set 1 Normal Monster.');
      },
      ai: {
        score: (ctx) =>
          ctx.game.players[ctx.player].normalSummonsLeft === 0 && ctx.hand('me', (c) => c.hasType('normal') && lvl(c) <= 4 && (c.data.atk ?? 0) >= 1400).length ? 40 : 0,
      },
    },
  ],
});

trap('Transmigration Break', 'continuous', {
  text: 'Any cards that would be returned to the Deck from the Graveyard are removed from play instead.',
  effects: [
    PATCH_LISTENER,
    {
      kind: 'activate',
      categories: ['lockdown'],
      activate: async (ctx) => {
        ensurePtdnPatches(ctx.game);
      },
      ai: { score: (ctx) => (!ctx.isMyTurn && ctx.phase === 'end' && ctx.grave('opp').length >= 6 && !ctx.game.chain.length ? 18 : 0) },
    },
  ],
});

/** Cards in hand that have an effect when they are discarded (Dark World & co.). */
const likesDiscard = (c: C) => (c.data.effects ?? []).some((e) => e.kind === 'trigger' && (e.event === 'discarded' || (Array.isArray(e.event) && e.event.includes('discarded'))));
trap('Fine', 'normal', {
  text: 'Discard 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['discard'],
      canActivate: (ctx) => ctx.hand('me').length >= 2,
      resolve: async (ctx) => {
        const hand = ctx.hand('me');
        if (hand.length < 2) {
          if (hand.length) await ctx.discard(hand);
          return;
        }
        const s = await ctx.select(hand, 2, 2, 'Discard 2 cards.', 'discard', { aiScore: (c) => (likesDiscard(c) ? 5000 : 0) - cardValue(ctx.game, c) });
        await ctx.discard(s);
      },
      ai: { score: (ctx) => (ctx.hand('me', likesDiscard).length >= 1 ? 35 : 0) },
    },
  ],
});

trap('Metal Reflect Slime', 'continuous', {
  text: 'Special Summon this card in Defense Position as an Effect Monster (Aqua/WATER/Level 10/ATK 0/DEF 3000) (this card is also still a Trap). If Summoned this way, this card cannot attack.',
  effects: [
    trapMonsterActivate({ attribute: 'WATER', race: 'Aqua', level: 10, atk: 0, def: 3000 }, trapMonsterScore, (ctx, me) => ctx.addTempMod(me, 'cannotAttack', true, 'field')),
  ],
});

trap('Zoma the Spirit', 'continuous', {
  text: 'Special Summon this card in Defense Position as an Effect Monster (Zombie/DARK/Level 4/ATK 1800/DEF 500) (this card is also still a Trap). If this card Summoned this way is destroyed by battle: Inflict damage to your opponent equal to the ATK of the monster that destroyed it.',
  effects: [
    trapMonsterActivate({ attribute: 'DARK', race: 'Zombie', level: 4, atk: 1800, def: 500 }, trapMonsterScore),
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Inflict damage equal to the destroyer\'s ATK',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone',
      activate: async (ctx) => {
        const o = evo(ctx.event!);
        const b = ctx.battle;
        const calc = b?.calc && o ? (o === b.attacker ? b.calc.attackerAtk : b.calc.targetAtk) : 0;
        ctx.data.atk = o && faceUpOn(o) ? ctx.atk(o) : calc;
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, ctx.data.atk ?? 0);
      },
    },
  ],
});

trap('Call of the Earthbound', 'normal', {
  text: "When an opponent's monster declares an attack: You choose the target of the attack.",
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['protect'],
      eventFilter: isOppAttack,
      canActivate: (ctx) => ctx.monsters('me').length > 0,
      resolve: async (ctx) => {
        const b = ctx.battle;
        if (!b || b.negated || b.attacker.location !== 'mzone') return;
        const cands = ctx.game.attackTargets(b.attacker).targets.filter((c) => c.controller === ctx.player);
        if (!cands.length) return;
        const atk = ctx.atk(b.attacker);
        const [t] = await ctx.select(cands, 1, 1, 'Choose the target of the attack.', 'generic', {
          aiScore: (c) => {
            if (!c.faceUp) return 500;
            if (c.pos === 'atk') return ctx.atk(c) > atk ? 3000 + ctx.atk(c) : ctx.atk(c) === atk ? 0 : -cardValue(ctx.game, c) - 1000;
            return ctx.def(c) > atk ? 2500 + ctx.def(c) : -cardValue(ctx.game, c);
          },
        });
        if (!t) return;
        b.target = t;
        b.targetMoveId = t.moveId;
        ctx.log(`${b.attacker.name} now attacks ${t.faceUp ? t.name : 'a face-down monster'}.`);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const atk = ctx.atk(b.attacker);
          const winner = ctx.faceUpMonsters('me', (c) => (c.pos === 'atk' ? ctx.atk(c) > atk : ctx.def(c) > atk) && !ctx.query(c, 'cannotBeAttacked'));
          return winner.length && b.target !== winner[0] ? 50 : 0;
        },
      },
    },
  ],
});

export const PTDN_LOADED = true;
