// Card definitions: Absolute Powerforce (ABPF, February 2010).
// Every ABPF card that no other set file defines. Card data (text, stats, types) is from the YGOJSON v1 dataset;
// effects follow the 2010 TCG rulings as far as the engine allows. Approximations are marked "APPROX:".
// Engine hooks added for this set are marked "ABPF:" in src/engine (replaceDestroyOne, altTribute,
// SynchroReq.check, the 'cannotSynchroSummon' player query and Ceremonial-Token tribute fodder).
import { monster, normal, spell, token, trap } from '../define';
import { attr, bestTarget, cardValue, destroyTargets, named, race } from '../helpers';
import type { CardData, CardInstance, EffectDef } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { ChainLink, Game } from '../../engine/game';
import type { GameEvent, Location, PlayerId, Race, Reason } from '../../engine/types';

type C = CardInstance;

// ============================================================ shared helpers

const evc = (ev: GameEvent) => ev.card as C | undefined;
const evo = (ev: GameEvent) => ev.other as C | undefined;
const reasonsOf = (ev: GameEvent): Reason[] => ev.reasons ?? (ev.reason ? [ev.reason] : []);
/** Moved by a card effect (not by battle, as a cost, as material or by a game rule). */
const byCardEffect = (ev: GameEvent) => {
  const r = reasonsOf(ev);
  return r.includes('effect') && !r.includes('cost') && !r.includes('battle');
};
/** This card was destroyed by battle and sent to the GY. */
const selfBattleToGrave = (ctx: Ctx, ev: GameEvent) => ev.card === ctx.self && ev.from === 'mzone' && ev.to === 'grave' && reasonsOf(ev).includes('battle');
/** This card on the field was destroyed and sent to the GY. */
const selfDestroyedToGrave = (ctx: Ctx, ev: GameEvent) => ev.card === ctx.self && ev.from === 'mzone' && ev.to === 'grave' && reasonsOf(ev).includes('destroy');
/** This Spell/Trap is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
/** This monster is face-up on the field and not negated. */
const monActive = (ctx: Ctx) => ctx.self.location === 'mzone' && ctx.self.faceUp && !ctx.game.isNegated(ctx.self);
const isMain = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';
const ALL_LOCS: Location[] = ['mzone', 'szone', 'fzone', 'hand', 'deck', 'grave', 'banished', 'extra'];

const IRON_CORE = "Iron Core of Koa'ki Meiru";
const isKoaki = (c: C) => c.isMonster && (c.inSet('koaki-meiru') || c.name.startsWith("Koa'ki Meiru"));
const isReptilianne = (c: C) => c.inSet('reptilianne') || c.name.startsWith('Reptilianne');
const isGK = (c: C) => c.isMonster && (c.inSet('gravekeeper') || c.name.startsWith("Gravekeeper's"));
const isXS = (c: C) => c.isMonster && c.inSet('x-saber');
const isEI = (c: C) => c.isMonster && (c.inSet('earthbound-immortal') || c.name.startsWith('Earthbound Immortal'));
const isRitual = (c: C) => c.isMonster && c.hasType('ritual');
const isUmi = (c: C) => c.onField && c.faceUp && c.name === 'Umi';
const isRace = (c: C, r: Race) => c.isMonster && c.data.race === r;

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

/** Monster battling `self` in the current battle. */
function battleOpponent(ctx: Ctx, self: C = ctx.self): C | null {
  const b = ctx.battle;
  if (!b) return null;
  if (b.attacker === self) return b.target;
  if (b.target === self) return b.attacker;
  return null;
}

/** True once the current attack has finished its Damage Step. */
function attackFinished(g: Game): boolean {
  for (let i = g.eventLog.length - 1; i >= 0; i--) {
    const t = g.eventLog[i].type;
    if (t === 'damageStepEnd') return true;
    if (t === 'attackDeclared') return false;
  }
  return false;
}

/** Tribute cards as a cost. */
async function tributeCost(ctx: Ctx, cards: C[]) {
  if (!cards.length) return;
  ctx.game.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`, 'action', ctx.player);
  await ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}

/** Reveal cards from the hand. */
async function reveal(ctx: Ctx, cards: C[]) {
  if (!cards.length) return;
  for (const c of cards) c.revealedUntil = ctx.turn;
  ctx.log(`${ctx.game.players[ctx.player].name} reveals ${cards.map((c) => c.name).join(', ')}.`);
  await ctx.game.anim({ type: 'reveal', cards: cards.map((c) => c.uid), player: ctx.player });
}

/** Special Summon from the Deck by name filter (non-targeting), shuffling afterwards. */
async function summonFromDeck(ctx: Ctx, filter: (c: C) => boolean, prompt: string, pos: 'atk' | 'def' | 'choose' = 'choose') {
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

/** "Target 1 <filter> in your GY; Special Summon it" trigger body. */
function reviveFromGrave(label: string, filter: (c: C) => boolean, extra: Partial<EffectDef> = {}): EffectDef {
  const cands = (ctx: Ctx) => ctx.grave('me', (c) => filter(c) && ctx.canSummonCard(c));
  return {
    kind: 'trigger',
    label,
    categories: ['specialSummon'],
    canActivate: (ctx) => ctx.canSpecialSummon() && cands(ctx).length > 0,
    activate: async (ctx) => {
      await ctx.selectTargets(cands(ctx), 1, 1, `${label}: target 1 monster in your GY.`, 'specialSummon', { aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0) });
    },
    resolve: async (ctx) => {
      const t = ctx.validTargets((c) => c.location === 'grave');
      if (t.length && ctx.canSummonCard(t[0])) await ctx.specialSummon(t[0], { pos: 'choose' });
    },
    ...extra,
  };
}

/** Last summon of `c` in its current stint on the field came from the GY. */
function summonedFromGrave(g: Game, c: C): boolean {
  if (c.location !== 'mzone') return false;
  const cached = c.flags.abpfFromGrave as { moveId: number; v: boolean } | undefined;
  if (cached && cached.moveId === c.moveId) return cached.v;
  let v = false;
  for (let i = g.eventLog.length - 1; i >= 0; i--) {
    const e = g.eventLog[i];
    if (e.card !== c) continue;
    if (e.type === 'specialSummoned') {
      v = e.from === 'grave';
      break;
    }
    if (e.type === 'normalSummoned' || e.type === 'monsterSet') break;
  }
  c.flags.abpfFromGrave = { moveId: c.moveId, v };
  return v;
}

// ---------------------------------------------------------------- per-instance data overrides
// APPROX: the engine has no Type/Name-change or "Trap Monster" hook. These cards shadow the card instance's `data`
// with a modified copy while the condition holds (Reptilianne Rage, Alien Brain, Cyber Dragon Zwei,
// Forgotten Temple of the Deep, Machine King - 3000 B.C.). The real CardData is never modified.
type DataPatch = (orig: CardData, card: C) => CardData | undefined;
const dataPatches = new WeakMap<C, DataPatch[]>();
function patchData(card: C, fn: DataPatch) {
  let list = dataPatches.get(card);
  if (!list) {
    const l: DataPatch[] = [];
    list = l;
    dataPatches.set(card, l);
    const orig = card.data;
    Object.defineProperty(card, 'data', {
      configurable: true,
      enumerable: true,
      get: () => {
        for (const f of l) {
          const d = f(orig, card);
          if (d) return d;
        }
        return orig;
      },
      set: () => {},
    });
  }
  list.push(fn);
}
const variants = new WeakMap<CardData, Map<string, CardData>>();
function variant(orig: CardData, key: string, change: Partial<CardData>): CardData {
  let m = variants.get(orig);
  if (!m) variants.set(orig, (m = new Map()));
  let v = m.get(key);
  if (!v) m.set(key, (v = { ...orig, ...change }));
  return v;
}
/** The monster is treated as `r` while `active()` holds. */
function raceWhile(card: C, r: Race, active: () => boolean) {
  patchData(card, (orig) => (active() ? variant(orig, `race:${r}`, { race: r }) : undefined));
}

// ---------------------------------------------------------------- equip helpers

const equipped = (ctx: Ctx, c: C) => c === ctx.equipTarget;
function equipActivate(o: {
  filter?: (ctx: Ctx, c: C) => boolean;
  aiTarget?: (ctx: Ctx, c: C) => number;
  score?: (ctx: Ctx) => number;
  categories?: EffectDef['categories'];
  onEquip?: (ctx: Ctx, t: C) => void;
}): EffectDef {
  const cands = (ctx: Ctx) => ctx.faceUpMonsters('both', (c) => !o.filter || o.filter(ctx, c));
  return {
    kind: 'activate',
    categories: o.categories ?? ['atkChange'],
    canActivate: (ctx) => cands(ctx).some((c) => ctx.canTarget(c)),
    activate: async (ctx) => {
      await ctx.selectTargets(cands(ctx), 1, 1, 'Target 1 face-up monster to equip this card to.', 'equip', {
        aiScore: (c) => (o.aiTarget ? o.aiTarget(ctx, c) : c.controller === ctx.player ? ctx.atk(c) + 1000 : -10000),
      });
    },
    resolve: async (ctx) => {
      const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && (!o.filter || o.filter(ctx, c)));
      if (!t.length || !ctx.self.onField || !ctx.self.faceUp) return;
      ctx.equip(t[0]);
      o.onEquip?.(ctx, t[0]);
    },
    ai: { score: o.score ?? ((ctx) => (ctx.phase === 'main1' && ctx.faceUpMonsters('me').length ? 30 : 0)) },
  };
}

/** Put a monster into its controller's Spell & Trap Zone as an Equip Card for `host`. */
function equipMonster(ctx: Ctx, card: C, host: C, controller: PlayerId) {
  if (ctx.game.freeSZones(controller) <= 0) return false;
  ctx.game.rawMove(card, 'szone', { controller, faceUp: true });
  ctx.game.equip(card, host);
  ctx.game.update();
  return true;
}

// ---------------------------------------------------------------- Spirit (Gundari)

const markSpirit = (ctx: Ctx, ev: GameEvent) => {
  if (ev.card === ctx.self && (ev.type === 'normalSummoned' || ev.type === 'flipped')) ctx.self.flags.spiritTurn = ctx.turn;
};
const spiritEffects: EffectDef[] = [
  {
    kind: 'trigger',
    event: ['normalSummoned', 'flipped'],
    label: 'Spirit',
    eventFilter: (ctx, ev) => {
      markSpirit(ctx, ev);
      return false;
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
];

// ---------------------------------------------------------------- Koa'ki Meiru maintenance

/** "During each of your End Phases, destroy this card unless you send 1 Iron Core from your hand to the GY (or reveal …)." */
function koakiMaintenance(alt?: { filter: (c: C) => boolean; what: string }, self: 'monster' | 'field' = 'monster'): EffectDef {
  return {
    kind: 'trigger',
    event: 'phaseStart',
    mandatory: true,
    range: self === 'monster' ? ['mzone'] : ['fzone'],
    label: 'Maintenance',
    categories: ['destroy'],
    eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && ctx.self.faceUp && (self === 'monster' || ctx.self.activeOnField),
    resolve: async (ctx) => {
      if (!ctx.self.onField || !ctx.self.faceUp) return;
      const cores = ctx.hand('me', (c) => c.name === IRON_CORE);
      const reveals = alt ? ctx.hand('me', alt.filter) : [];
      const opts: string[] = [];
      const acts: ('core' | 'reveal' | 'destroy')[] = [];
      if (self === 'monster' && cores.length) {
        opts.push(`Send 1 "${IRON_CORE}" from your hand to the GY`);
        acts.push('core');
      }
      if (reveals.length) {
        opts.push(`Reveal 1 ${alt!.what} in your hand`);
        acts.push('reveal');
      }
      opts.push(`Destroy ${ctx.self.name}`);
      acts.push('destroy');
      const i = await ctx.option(`${ctx.self.name}: keep it on the field?`, opts, (k) => (acts[k] === 'reveal' ? 3 : acts[k] === 'core' ? 2 : 0));
      if (acts[i] === 'core') {
        const s = await ctx.select(cores, 1, 1, `Send 1 "${IRON_CORE}" to the GY.`, 'cost');
        if (s.length) {
          await ctx.sendToGrave(s, 'cost');
          return;
        }
      } else if (acts[i] === 'reveal') {
        const s = await ctx.select(reveals, 1, 1, `Reveal 1 ${alt!.what}.`, 'generic');
        if (s.length) {
          await reveal(ctx, s);
          return;
        }
      }
      await ctx.destroy(ctx.self);
    },
  };
}

// ---------------------------------------------------------------- Rituals
// APPROX: the engine has no Ritual Summon procedure; Ritual Spells do it in their resolution (no summon-negation window).

const isDjinn = (c: C) => c.isMonster && c.inSet('djinn-of-rituals');
interface RitualInfo {
  moveId: number;
  mats: { uid: number; moveId: number }[];
  djinns: { uid: number; moveId: number }[];
}
const ritualInfos = new WeakMap<C, RitualInfo>();
/** Materials of the current Ritual Summon of `c` (undefined if it was not Ritual Summoned this time). */
function ritualInfo(c: C | undefined): RitualInfo | undefined {
  if (!c) return undefined;
  const i = ritualInfos.get(c);
  return i && i.moveId === c.moveId && c.location === 'mzone' ? i : undefined;
}
/** Face-up Ritual Monster that was Ritual Summoned using the Djinn `djinn`. */
function ritualUsing(g: Game, djinn: C): C | undefined {
  return [...g.faceUpMonsters(0), ...g.faceUpMonsters(1)].find((m) => ritualInfo(m)?.djinns.some((d) => d.uid === djinn.uid && d.moveId === djinn.moveId));
}
const ritualLevel = (ctx: Ctx, c: C) => (c.location === 'mzone' ? ctx.level(c) : c.data.level ?? 0);
function ritualCombos(ctx: Ctx, ritual: C, minLevel: number): C[][] {
  const pool = [
    ...ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed') && !c.flags.noTributeSummonFodder),
    ...ctx.hand('me', (c) => c.isMonster && c !== ritual),
    ...ctx.grave('me', isDjinn),
  ]
    .filter((c) => ritualLevel(ctx, c) > 0)
    .slice(0, 12);
  const lv = pool.map((c) => ritualLevel(ctx, c));
  const out: C[][] = [];
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    let sum = 0;
    let min = Infinity;
    for (let i = 0; i < pool.length; i++)
      if (mask & (1 << i)) {
        sum += lv[i];
        min = Math.min(min, lv[i]);
      }
    // Total Levels must reach the requirement, and no Tribute may be unnecessary.
    if (sum < minLevel || sum - min >= minLevel) continue;
    const combo = pool.filter((_, i) => mask & (1 << i));
    if (ctx.freeMZones() + combo.filter((c) => c.location === 'mzone').length <= 0) continue;
    out.push(combo);
  }
  return out;
}
const ritualCandidates = (ctx: Ctx, filter: (c: C) => boolean, minLevel: number) =>
  ctx.hand('me', (c) => filter(c) && isRitual(c) && ritualCombos(ctx, c, minLevel).length > 0);

async function ritualSummon(ctx: Ctx, filter: (c: C) => boolean, minLevel: number): Promise<C | null> {
  if (ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return null;
  const rituals = ritualCandidates(ctx, filter, minLevel);
  if (!rituals.length) return null;
  const [r] = await ctx.select(rituals, 1, 1, 'Select the Ritual Monster to Ritual Summon.', 'specialSummon');
  if (!r) return null;
  const combos = ritualCombos(ctx, r, minLevel);
  const cost = (combo: C[]) => combo.reduce((a, c) => a + (c.location === 'grave' ? 0 : cardValue(ctx.game, c)), 0);
  const mats = ctx.game.controllers[ctx.player].isHuman
    ? await ctx.game.pickCombo(ctx.player, combos, `Select monsters to Tribute for ${r.name}`, 'tribute')
    : [...combos].sort((a, b) => cost(a) - cost(b))[0];
  if (!mats) return null;
  const djinns = mats.filter((c) => c.location === 'grave');
  const trib = mats.filter((c) => c.location !== 'grave');
  if (trib.length) {
    ctx.log(`${ctx.game.players[ctx.player].name} Tributes ${trib.map((c) => c.name).join(', ')} for ${r.name}.`);
    await ctx.game.moveCards(trib, 'grave', { reason: 'tribute', reasons: ['tribute', 'material'], reasonPlayer: ctx.player, reasonCard: r });
  }
  if (djinns.length) await ctx.game.moveCards(djinns, 'banished', { reason: 'material', reasonPlayer: ctx.player, reasonCard: r });
  if (r.location !== 'hand') return null;
  ritualInfos.set(r, {
    moveId: r.moveId + 1,
    mats: trib.map((c) => ({ uid: c.uid, moveId: c.moveId })),
    djinns: djinns.map((c) => ({ uid: c.uid, moveId: c.moveId })),
  });
  const res = await ctx.specialSummon(r, { pos: 'choose', method: 'ritual' });
  return res[0] ?? null;
}

function ritualActivate(ritualName: string, minLevel: number): EffectDef {
  const filter = (c: C) => c.name === ritualName;
  return {
    kind: 'activate',
    categories: ['specialSummon'],
    canActivate: (ctx) => !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') && ritualCandidates(ctx, filter, minLevel).length > 0,
    resolve: async (ctx) => {
      await ritualSummon(ctx, filter, minLevel);
    },
    ai: { score: () => 55 },
  };
}

/** Djinn: "When you Ritual Summon a monster, you can banish this card from your GY as 1 of the monsters required." */
const DJINN_TEXT_NOTE = 'djinn-of-rituals';

// ============================================================ MONSTERS

monster("Gravekeeper's Priestess", {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 3,
  atk: 1000,
  def: 1500,
  sets: ['gravekeeper'],
  aiValue: 500,
  text: `While there is no face-up Field Spell, the field is treated as "Necrovalley". All "Gravekeeper's" monsters on the field gain 200 ATK/DEF.`,
  effects: [
    {
      // APPROX: only Necrovalley's "+500 ATK/DEF to Gravekeeper's monsters" is applied; its Graveyard lock
      // (no banishing from the GY, negating effects that move cards in the GY) has no engine hook.
      kind: 'continuous',
      mods: (['atk', 'def'] as const).flatMap((q) => [
        { q, to: 'cards' as const, filter: (_ctx: Ctx, c: C) => c.faceUpMonster && isGK(c), value: 200 },
        {
          q,
          to: 'cards' as const,
          filter: (ctx: Ctx, c: C) => {
            if (!c.faceUpMonster || !isGK(c)) return false;
            const g = ctx.game;
            if ([g.players[0].fzone, g.players[1].fzone].some((f) => f && f.faceUp)) return false;
            // Only one "Necrovalley" applies, however many Priestesses there are.
            const first = [...g.faceUpMonsters(0), ...g.faceUpMonsters(1)].filter((m) => m.name === ctx.self.name).sort((a, b) => a.uid - b.uid)[0];
            return first === ctx.self;
          },
          value: 500,
        },
      ]),
    },
  ],
});

normal('Unicycular', 'EARTH', 'Machine', 1, 100, 100, 'The third of the brothers, following Tricular and Bicular.');

function cycleBrother(name: string, level: number, stat: number, next: string) {
  monster(name, {
    attribute: 'EARTH',
    race: 'Machine',
    level,
    atk: stat,
    def: stat,
    aiValue: 200,
    text: `When this card is destroyed by battle and sent to the Graveyard, you can Special Summon 1 "${next}" from your hand or Deck.`,
    effects: [
      {
        kind: 'trigger',
        event: 'sentToGrave',
        label: `Summon ${next}`,
        categories: ['specialSummon'],
        eventFilter: selfBattleToGrave,
        condition: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'deck'], named(next)).length > 0,
        resolve: async (ctx) => {
          const cands = ctx.cards('me', ['hand', 'deck'], (c) => c.name === next && ctx.canSummonCard(c));
          const sel = await ctx.select(cands, 1, 1, `Special Summon 1 "${next}" from your hand or Deck.`, 'specialSummon', {
            aiScore: (c) => (c.location === 'deck' ? 1 : 0),
          });
          if (sel.length) await ctx.specialSummon(sel[0], { pos: 'choose' });
          ctx.game.shuffleDeck(ctx.player);
        },
      },
    ],
  });
}
cycleBrother('Bicular', 2, 200, 'Unicycular');
cycleBrother('Tricular', 3, 300, 'Bicular');

monster('Drill Synchron', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 3,
  atk: 800,
  def: 300,
  types: ['tuner'],
  sets: ['synchron'],
  aiValue: 400,
  text: 'If a Warrior-Type monster you control attacks a Defense Position monster, inflict piercing battle damage to your opponent. Once per turn, when you inflict battle damage to your opponent with this effect: You can draw 1 card.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'piercing', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && c.faceUp && c.controller === ctx.player && isRace(c, 'Warrior') }] },
    {
      kind: 'trigger',
      event: 'battleDamage',
      range: ['mzone'],
      opt: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => {
        const b = ctx.battle;
        const a = ev.reasonCard as C | undefined;
        return ev.player === ctx.opp && !!b && !!a && b.attacker === a && a.controller === ctx.player && isRace(a, 'Warrior') && !!b.target && b.target.pos === 'def' && monActive(ctx);
      },
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
  ],
});

monster('Ogre of the Scarlet Sorrow', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 0,
  def: 0,
  aiValue: 500,
  text: "During your opponent's turn, when your opponent declares a second direct attack during the same Battle Phase, you can Special Summon this card from your hand. When you do, this card's ATK and DEF becomes equal to the ATK and DEF of the first monster that attacked directly this turn, if it is still face-up on the field. The turn this card is Special Summoned with this effect, your opponent cannot select monsters other than this card as an attack target while this card is face-up on the field.",
  effects: [
    {
      kind: 'quick',
      range: ['hand'],
      event: 'attackDeclared',
      label: 'Special Summon',
      categories: ['specialSummon', 'protect'],
      eventFilter: (ctx, ev) => !ev.other && ev.player === ctx.opp,
      condition: (ctx) => {
        const b = ctx.battle;
        if (ctx.isMyTurn || !b || b.target || b.inDamageStep || attackFinished(ctx.game)) return false;
        const directs = eventsThisTurn(ctx.game).filter((e) => e.type === 'attackDeclared' && !e.other && e.player === ctx.opp);
        return directs.length === 2 && ctx.canSpecialSummon() && ctx.canSummonCard(ctx.self);
      },
      activate: async (ctx) => {
        ctx.data.first = eventsThisTurn(ctx.game).find((e) => e.type === 'attackDeclared' && !e.other && e.player === ctx.opp)?.card;
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'hand') return;
        const r = await ctx.specialSummon(ctx.self, { pos: 'choose' });
        if (!r.length) return;
        const f = ctx.data.first as C | undefined;
        if (f && f.location === 'mzone' && f.faceUp) {
          ctx.self.flags.baseAtk = ctx.atk(f);
          ctx.self.flags.baseDef = ctx.def(f);
        }
        ctx.addTempMod(ctx.self, 'mustBeAttacked', true, 'turn');
      },
      ai: { score: (ctx) => (ctx.battle && ctx.atk(ctx.battle.attacker) >= 800 ? 80 : 0) },
    },
  ],
});

monster('Power Supplier', {
  attribute: 'EARTH',
  race: 'Spellcaster',
  level: 2,
  atk: 400,
  def: 400,
  aiValue: 300,
  text: "Once per turn, you can select 1 face-up monster you control. It gains 400 ATK while you control this face-up card. (A monster cannot gain more than 400 ATK from this card's effect.)",
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: '+400 ATK',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const supplied = (ctx.self.flags.supplied ?? []) as { uid: number; moveId: number }[];
        await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Target 1 face-up monster you control.', 'buff', {
          aiScore: (c) => (supplied.some((s) => s.uid === c.uid && s.moveId === c.moveId) ? -5000 : ctx.atk(c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && c.controller === ctx.player)[0];
        if (!t || !monActive(ctx)) return;
        (ctx.self.flags.supplied ??= []).push({ uid: t.uid, moveId: t.moveId });
      },
      ai: {
        score: (ctx) => {
          const supplied = (ctx.self.flags.supplied ?? []) as { uid: number; moveId: number }[];
          return ctx.faceUpMonsters('me', (c) => !supplied.some((s) => s.uid === c.uid && s.moveId === c.moveId)).length ? 40 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (ctx, c: C) =>
            c.location === 'mzone' && c.faceUp && ((ctx.self.flags.supplied ?? []) as { uid: number; moveId: number }[]).some((s) => s.uid === c.uid && s.moveId === c.moveId),
          value: 400,
        },
      ],
    },
  ],
});

monster('Magic Hole Golem', {
  attribute: 'DARK',
  race: 'Rock',
  level: 3,
  atk: 0,
  def: 2000,
  aiValue: 300,
  text: 'Once per turn, you can select 1 face-up monster you control. Its ATK is halved until the End Phase, and it can attack your opponent directly this turn. During the turn you activate this effect, only the selected monster can attack.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Halve ATK: direct attack',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me'), 1, 1, 'Target 1 face-up monster you control.', 'buff', {
          aiScore: (c) => (ctx.game.canAttack(c) ? ctx.atk(c) : 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && c.controller === ctx.player)[0];
        ctx.game.turnData[`abpfGolem:${ctx.player}`] = t ? { uid: t.uid, moveId: t.moveId } : { uid: -1, moveId: -1 };
        if (!t) return;
        const a = ctx.atk(t);
        ctx.addTempMod(t, 'atk', -(a - Math.floor(a / 2)), 'turn');
        ctx.addTempMod(t, 'directAttack', true, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.turn <= 1 || !ctx.monsters('opp').length) return 0;
          const attackers = ctx.faceUpMonsters('me', (c) => ctx.game.canAttack(c));
          if (attackers.length !== 1) return 0;
          const half = Math.floor(ctx.atk(attackers[0]) / 2);
          const oppBest = Math.max(0, ...ctx.faceUpMonsters('opp', (c) => c.pos === 'atk').map((c) => ctx.atk(c)));
          return half >= 1000 && ctx.atk(attackers[0]) <= oppBest ? 45 : half >= ctx.oppLp ? 90 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      range: ALL_LOCS,
      mods: [
        {
          q: 'cannotAttack',
          to: 'cards',
          filter: (ctx, c: C) => {
            const g = ctx.game.turnData[`abpfGolem:${ctx.player}`] as { uid: number; moveId: number } | undefined;
            return !!g && c.location === 'mzone' && c.controller === ctx.player && !(c.uid === g.uid && c.moveId === g.moveId);
          },
        },
      ],
    },
  ],
});

monster('Power Invader', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 5,
  atk: 2200,
  def: 0,
  text: 'If your opponent controls 2 or more monsters, you can Normal Summon this card without Tributing.',
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
            if (p === ctx.player) ctx.self.flags.noTribute = ctx.monsters('opp').length >= 2;
            return false;
          },
        },
      ],
    },
  ],
});

monster('Dark Bug', {
  attribute: 'DARK',
  race: 'Insect',
  level: 1,
  atk: 100,
  def: 100,
  aiValue: 300,
  text: 'When this card is Normal Summoned, select and Special Summon 1 Level 3 Tuner monster from your Graveyard. The effect(s) of that monster is negated.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      mandatory: true,
      label: 'Revive Level 3 Tuner',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c.isMonster && c.isTuner && c.data.level === 3 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && c.isTuner && c.data.level === 3 && ctx.canSummonCard(c)), 1, 1, 'Target 1 Level 3 Tuner in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.canSummonCard(t)) return;
        const r = await ctx.specialSummon(t, { pos: 'choose' });
        if (r.length) ctx.negateEffects(r[0], 'field');
      },
    },
  ],
});

monster('Sword Master', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 3,
  atk: 1200,
  def: 0,
  types: ['tuner'],
  aiValue: 200,
  text: "If a Warrior-Type monster you control attacks your opponent's monster, and the opponent's monster is not destroyed by battle, at the end of the Damage Step you can Special Summon this card from your hand. During battle between this attacking card and a Defense Position monster whose DEF is lower than the ATK of this card, inflict the difference as Battle Damage to your opponent.",
  effects: [
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      range: ['hand'],
      label: 'Special Summon',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        const t = evo(ev);
        const b = ctx.battle;
        return !!a && !!t && !!b && ev.player === ctx.player && isRace(a, 'Warrior') && t.location === 'mzone' && t.moveId === b.targetMoveId && t.controller === ctx.opp;
      },
      condition: (ctx) => ctx.canSpecialSummon() && ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location === 'hand') await ctx.specialSummon(ctx.self, { pos: 'choose' });
      },
    },
  ],
});

monster('Witch of the Black Rose', {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 4,
  atk: 1700,
  def: 1200,
  types: ['tuner'],
  // "Cannot be Special Summoned": nomi blocks every Special Summon (it is never properly summoned).
  nomi: true,
  aiValue: 300,
  text: 'Cannot be Special Summoned. If this card is Normal Summoned, and you control no other cards: Draw 1 card and show it, then, if it is not a monster, send it to the GY, also destroy this card.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      mandatory: true,
      label: 'Draw & reveal',
      categories: ['draw'],
      condition: (ctx) => ctx.field('me', (c) => c !== ctx.self).length === 0,
      resolve: async (ctx) => {
        const [d] = await ctx.draw(1);
        if (!d) return;
        await reveal(ctx, [d]);
        if (!d.isMonster) {
          if (d.location === 'hand') await ctx.sendToGrave(d);
          if (ctx.self.location === 'mzone') await ctx.destroy(ctx.self);
        }
      },
    },
  ],
});

monster('Rose Fairy', {
  attribute: 'WIND',
  race: 'Plant',
  level: 3,
  atk: 600,
  def: 1200,
  aiValue: 300,
  text: 'If this card is added from your Deck to your hand by a card effect: You can Special Summon this card.',
  effects: [
    {
      kind: 'trigger',
      event: 'addedToHand',
      range: ['hand'],
      label: 'Special Summon',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'deck' && ev.reason !== 'draw',
      condition: (ctx) => ctx.canSpecialSummon() && ctx.canSummonCard(ctx.self),
      resolve: async (ctx) => {
        if (ctx.self.location === 'hand') await ctx.specialSummon(ctx.self, { pos: 'choose' });
      },
    },
  ],
});

const contSpells = (ctx: Ctx) => ctx.spellTraps('me', (c) => c.faceUp && c.isSpell && c.data.stype === 'continuous');
monster('Dragon Queen of Tragic Endings', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 6,
  atk: 1900,
  def: 2600,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 600,
  text: 'Cannot be Normal Summoned or Set. Must first be Special Summoned (from your hand) while you control 3 or more face-up Continuous Spell Cards. When this attacking card inflicts Battle Damage to your opponent: Your opponent sends 1 card from their hand to the Graveyard, then you draw 1 card. During your Standby Phase, if this card is in your Graveyard and was sent there from the field: You can send 1 face-up Continuous Spell Card you control to the Graveyard; Special Summon this card from the Graveyard.',
  effects: [
    { kind: 'proc', label: 'Special Summon', condition: (ctx) => ctx.freeMZones() > 0 && contSpells(ctx).length >= 3 },
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      label: 'Hand to GY, draw 1',
      categories: ['discard', 'draw'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp && ctx.battle?.attacker === ctx.self,
      resolve: async (ctx) => {
        const hand = ctx.hand('opp');
        if (hand.length) {
          const s = await ctx.select(hand, 1, 1, 'Send 1 card from your hand to the GY.', 'toGrave', { player: ctx.opp });
          await ctx.sendToGrave(s);
        }
        await ctx.draw(1);
      },
    },
    {
      // Bookkeeping: remember whether it was sent to the GY from the field.
      kind: 'trigger',
      event: 'sentToGrave',
      label: '(sent from the field)',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && ctx.self.location === 'grave') ctx.self.flags.fromField = ev.from === 'mzone';
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Revive',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && !!ctx.self.flags.fromField,
      condition: (ctx) => ctx.canSpecialSummon() && ctx.canSummonCard(ctx.self),
      canActivate: (ctx) => contSpells(ctx).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(contSpells(ctx), 1, 1, 'Send 1 face-up Continuous Spell you control to the GY.', 'cost');
        if (!s.length) return false;
        await ctx.sendToGrave(s, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'grave' && ctx.canSummonCard(ctx.self)) await ctx.specialSummon(ctx.self, { pos: 'choose' });
      },
    },
  ],
});

// ------------------------------------------------------------ Reptilianne

const REP = ['reptilianne'];

monster('Reptilianne Servant', {
  attribute: 'DARK',
  race: 'Reptile',
  level: 1,
  atk: 100,
  def: 100,
  sets: REP,
  aiValue: -900, // self-destructs next to any face-up monster
  text: 'Destroy this card if there are face-up monsters on the field other than this card. Destroy this card when it is targeted by the effect of a Spell or Trap Card. Neither player can Normal Summon a monster while this card is face-up on the field.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'cannotNormalSummon', to: 'players' }] },
    {
      // APPROX: a self-destruction "rule" effect, done as a mandatory trigger after any monster turns up face-up.
      kind: 'trigger',
      event: ['summoned', 'flipped', 'positionChanged', 'controlChanged'],
      mandatory: true,
      label: 'Self-destruct',
      categories: ['destroy'],
      eventFilter: (ctx) => monActive(ctx) && ctx.faceUpMonsters('both', (c) => c !== ctx.self).length > 0,
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.faceUpMonsters('both', (c) => c !== ctx.self).length) await ctx.destroy(ctx.self);
      },
    },
    {
      // Destroyed when targeted by a Spell/Trap: wraps the targeting link so this card is destroyed first.
      kind: 'trigger',
      event: 'chainActivated',
      label: 'Destroyed when targeted',
      eventFilter: (ctx, ev) => {
        const me = ctx.self;
        const link = ev.data?.link as ChainLink | undefined;
        if (!link || !monActive(ctx) || !(link.card.isSpell || link.card.isTrap) || !link.ctx.targets.includes(me)) return false;
        const orig = link.effect;
        const moveId = me.moveId;
        const game = ctx.game;
        link.effect = {
          ...orig,
          resolve: async (c) => {
            if (me.location === 'mzone' && me.moveId === moveId && me.faceUp && !game.isNegated(me)) {
              game.log(`${me.name} was targeted by a Spell/Trap and is destroyed.`, 'action', me.controller);
              await game.destroy([me], 'effect', me.controller, me);
            }
            if (orig.resolve) await orig.resolve(c);
          },
        };
        return false;
      },
    },
  ],
});

monster('Reptilianne Gardna', {
  attribute: 'WATER',
  race: 'Reptile',
  level: 4,
  atk: 0,
  def: 2000,
  sets: REP,
  aiValue: 300,
  text: 'When this card you control is destroyed and sent to the Graveyard, add 1 "Reptilianne" monster from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Search Reptilianne',
      categories: ['search'],
      eventFilter: (ctx, ev) => selfDestroyedToGrave(ctx, ev) && ev.fromController === ctx.self.owner,
      resolve: async (ctx) => {
        await ctx.search((c) => c.isMonster && isReptilianne(c), 1, 'Add 1 "Reptilianne" monster from your Deck to your hand.');
      },
    },
  ],
});

monster('Reptilianne Naga', {
  attribute: 'DARK',
  race: 'Reptile',
  level: 1,
  atk: 0,
  def: 0,
  sets: REP,
  aiValue: 400,
  text: 'This card cannot be destroyed by battle. The ATK of any monster that battles this card becomes 0 at the end of that Battle Phase. During your End Phase, change this face-up Defense Position card on the field to face-up Attack Position.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle' }] },
    {
      // Records the monsters it battled; their ATK becomes 0 when the Battle Phase ends (start of Main Phase 2 / End Phase).
      kind: 'trigger',
      event: 'damageStepEnd',
      label: '(battled)',
      eventFilter: (ctx, ev) => {
        if (!monActive(ctx)) return false;
        const a = evc(ev);
        const t = evo(ev);
        const o = a === ctx.self ? t : t === ctx.self ? a : undefined;
        if (!o) return false;
        const g = ctx.game;
        const list = (g.turnData.abpfNaga ??= []) as { c: C; moveId: number }[];
        list.push({ c: o, moveId: o.moveId });
        if (!g.turnData.abpfNagaScheduled) {
          g.turnData.abpfNagaScheduled = true;
          const turn = g.turn;
          const apply = async () => {
            if (g.turn !== turn || g.turnData.abpfNagaDone) return;
            g.turnData.abpfNagaDone = true;
            for (const v of (g.turnData.abpfNaga ?? []) as { c: C; moveId: number }[]) {
              if (v.c.location === 'mzone' && v.c.faceUp && v.c.moveId === v.moveId) {
                const now = g.getAtk(v.c);
                if (now > 0) g.addTempMod(v.c, 'atk', -now, 'field');
                g.log(`${v.c.name}'s ATK becomes 0 (Reptilianne Naga).`, 'action');
              }
            }
          };
          g.addDelayed('main2', apply);
          g.addDelayed('end', apply);
        }
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Change to Attack Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && monActive(ctx) && ctx.self.pos === 'def',
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp && ctx.self.pos === 'def') await ctx.changePos(ctx.self, 'atk');
      },
    },
  ],
});

const zeroAtk = (ctx: Ctx) => ctx.faceUpMonsters('both', (c) => ctx.atk(c) === 0 && !ctx.query(c, 'cannotBeTributed'));
const faceUpVaskii = (ctx: Ctx) => ctx.faceUpMonsters('both', (c) => c.name === 'Reptilianne Vaskii').length > 0;
monster('Reptilianne Vaskii', {
  attribute: 'DARK',
  race: 'Reptile',
  level: 8,
  atk: 2600,
  def: 0,
  sets: REP,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 1200,
  text: 'This card cannot be Normal Summoned or Set. This card cannot be Special Summoned except by Tributing 2 face-up monsters with 0 ATK from anywhere on the field. Once per turn, you can select and destroy 1 face-up monster your opponent controls. There can only be 1 face-up "Reptilianne Vaskii" on the field.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (Tribute 2 monsters with 0 ATK)',
      condition: (ctx) => {
        if (faceUpVaskii(ctx)) return false;
        const z = zeroAtk(ctx);
        if (z.length < 2) return false;
        return ctx.freeMZones() + Math.min(2, z.filter((c) => c.controller === ctx.player).length) > 0;
      },
      perform: async (ctx) => {
        const z = zeroAtk(ctx);
        const sel = await ctx.select(z, 2, 2, 'Tribute 2 face-up monsters with 0 ATK.', 'tribute', {
          aiScore: (c) => (c.controller === ctx.player ? -cardValue(ctx.game, c) : 5000 + cardValue(ctx.game, c)),
        });
        if (sel.length < 2) return false;
        if (ctx.freeMZones() + sel.filter((c) => c.controller === ctx.player).length <= 0) return false;
        await tributeCost(ctx, sel);
        return true;
      },
      ai: {
        score: (ctx) => {
          const z = [...zeroAtk(ctx)].sort((a, b) => (a.controller === ctx.player ? cardValue(ctx.game, a) : -1) - (b.controller === ctx.player ? cardValue(ctx.game, b) : -1));
          const loss = z.slice(0, 2).reduce((a, c) => a + (c.controller === ctx.player ? cardValue(ctx.game, c) : -cardValue(ctx.game, c)), 0);
          return loss < 2000 ? 75 : 0;
        },
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Destroy 1 monster',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'destroy');
      },
      resolve: destroyTargets,
      ai: { score: () => 65 },
    },
  ],
});

// ------------------------------------------------------------ Oracle of the Sun / Inca

monster('Oracle of the Sun', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 5,
  atk: 1000,
  def: 2000,
  aiValue: 300,
  text: 'If only your opponent controls a monster, you can Special Summon this card (from your hand). When this card on the field is destroyed and sent to the GY: You can add 1 "Fire Ant Ascator" or "Supay" from your Deck to your hand.',
  effects: [
    { kind: 'proc', label: 'Special Summon', condition: (ctx) => ctx.monsters('opp').length > 0 && ctx.monsters('me').length === 0 },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Search Ascator / Supay',
      categories: ['search'],
      eventFilter: selfDestroyedToGrave,
      canActivate: (ctx) => ctx.deck('me', (c) => c.name === 'Fire Ant Ascator' || c.name === 'Supay').length > 0,
      resolve: async (ctx) => {
        await ctx.search((c) => c.name === 'Fire Ant Ascator' || c.name === 'Supay', 1, 'Add 1 "Fire Ant Ascator" or "Supay" to your hand.');
      },
    },
  ],
});

monster('Fire Ant Ascator', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 3,
  atk: 700,
  def: 1300,
  types: ['tuner'],
  aiValue: 300,
  text: 'When this card is destroyed by battle and sent to the GY: You can target 1 Level 5 monster in your GY; Special Summon that target, but its effects are negated, also send it to the GY during the End Phase of this turn.',
  effects: [
    reviveFromGrave('Revive Level 5', (c) => c.isMonster && c.data.level === 5, {
      event: 'sentToGrave',
      eventFilter: selfBattleToGrave,
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.canSummonCard(t)) return;
        const r = await ctx.specialSummon(t, { pos: 'choose' });
        if (!r.length) return;
        const m = r[0];
        ctx.negateEffects(m, 'field');
        const id = m.moveId;
        const g = ctx.game;
        const self = ctx.self;
        const p = ctx.player;
        ctx.later('end', async () => {
          if (m.location === 'mzone' && m.moveId === id) await g.sendToGrave([m], 'effect', p, self);
        });
      },
    }),
  ],
});

monster('Weeping Idol', {
  attribute: 'DARK',
  race: 'Rock',
  level: 2,
  atk: 0,
  def: 500,
  aiValue: 300,
  text: 'You can banish 1 Tuner from your GY; Special Summon this card from your hand.',
  effects: [
    {
      kind: 'ignition',
      range: ['hand'],
      label: 'Banish a Tuner: Special Summon',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.grave('me', (c) => c.isMonster && c.isTuner).length > 0 && ctx.canSpecialSummon() && ctx.canSummonCard(ctx.self),
      activate: async (ctx) => {
        const s = await ctx.select(ctx.grave('me', (c) => c.isMonster && c.isTuner), 1, 1, 'Banish 1 Tuner from your GY.', 'cost');
        if (!s.length) return false;
        await ctx.banish(s, 'cost');
      },
      resolve: async (ctx) => {
        if (ctx.self.location === 'hand') await ctx.specialSummon(ctx.self, { pos: 'choose' });
      },
      ai: {
        score: (ctx) => {
          // Worth it when a face-up Tuner or a Level 2+ partner is there to Synchro with.
          const tuner = ctx.faceUpMonsters('me', (c) => c.isTuner).length > 0;
          return tuner && ctx.extra('me', (c) => c.hasType('synchro')).length ? 45 : 0;
        },
      },
    },
  ],
});

monster('Apocatequil', {
  attribute: 'LIGHT',
  race: 'Thunder',
  level: 4,
  atk: 1800,
  def: 1200,
  aiValue: 200,
  text: 'While this card is face-up on the field, it is Level 5 if you control a face-up Tuner monster. When this card on the field is destroyed and sent to the Graveyard, you can select and Special Summon 1 "Oracle of the Sun" from your Graveyard.',
  effects: [
    { kind: 'continuous', active: (ctx) => ctx.faceUpMonsters('me', (c) => c.isTuner && c !== ctx.self).length > 0, mods: [{ q: 'level', value: 1 }] },
    reviveFromGrave('Revive Oracle of the Sun', named('Oracle of the Sun'), { event: 'sentToGrave', eventFilter: selfDestroyedToGrave }),
  ],
});

monster('Supay', {
  attribute: 'EARTH',
  race: 'Fiend',
  level: 1,
  atk: 300,
  def: 100,
  types: ['tuner'],
  aiValue: 300,
  text: 'When this card is sent from the field to the GY by card effect: You can Special Summon 1 "Oracle of the Sun" from your Deck, and if you do, double its ATK, also return it to the hand during the End Phase of this turn.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Summon Oracle of the Sun',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && byCardEffect(ev),
      condition: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', named('Oracle of the Sun')).length > 0,
      resolve: async (ctx) => {
        const r = await summonFromDeck(ctx, named('Oracle of the Sun'), 'Special Summon "Oracle of the Sun" from your Deck.', 'atk');
        if (!r.length) return;
        const m = r[0];
        ctx.addTempMod(m, 'atk', ctx.atk(m), 'field');
        const id = m.moveId;
        const g = ctx.game;
        const self = ctx.self;
        const p = ctx.player;
        ctx.later('end', async () => {
          if (m.location === 'mzone' && m.moveId === id) await g.toHand([m], 'effect', p, self);
        });
      },
    },
  ],
});

monster('Informer Spider', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 4,
  atk: 500,
  def: 1800,
  aiValue: 400,
  text: 'When this card is sent from the field to the Graveyard by a card effect, take control of 1 Defense Position monster your opponent controls.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Take control',
      categories: ['control'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && byCardEffect(ev),
      condition: (ctx) => ctx.monsters('opp', (c) => c.pos === 'def').length > 0,
      resolve: async (ctx) => {
        const cands = ctx.monsters('opp', (c) => c.pos === 'def');
        const [t] = await ctx.select(cands, 1, 1, 'Take control of 1 Defense Position monster your opponent controls.', 'control');
        if (t) await ctx.takeControl(t, false);
      },
    },
  ],
});

monster("Koa'ki Meiru Urnight", {
  attribute: 'EARTH',
  race: 'Beast-Warrior',
  level: 4,
  atk: 2000,
  def: 1500,
  sets: ['koaki-meiru'],
  aiValue: 500,
  text: `During each of your End Phases, destroy this card unless you send 1 "Iron Core of Koa'ki Meiru" from your hand to the Graveyard or reveal 1 Beast-Warrior-Type monster in your hand. Once per turn, you can reveal 1 "Iron Core of Koa'ki Meiru" in your hand to Special Summon 1 Level 4 or lower "Koa'ki Meiru" monster from your Deck, except "Koa'ki Meiru Urnight".`,
  effects: [
    koakiMaintenance({ filter: (c) => isRace(c, 'Beast-Warrior'), what: 'Beast-Warrior-Type monster' }),
    {
      kind: 'ignition',
      opt: true,
      label: "Reveal Iron Core: summon Koa'ki Meiru",
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        ctx.hand('me', named(IRON_CORE)).length > 0 &&
        ctx.canSpecialSummon() &&
        ctx.deck('me', (c) => isKoaki(c) && (c.data.level ?? 0) <= 4 && c.name !== ctx.self.name).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.hand('me', named(IRON_CORE)), 1, 1, `Reveal 1 "${IRON_CORE}".`, 'generic');
        if (!s.length) return false;
        await reveal(ctx, s);
      },
      resolve: async (ctx) => {
        await summonFromDeck(ctx, (c) => isKoaki(c) && (c.data.level ?? 0) <= 4 && c.name !== "Koa'ki Meiru Urnight", 'Special Summon 1 Level 4 or lower "Koa\'ki Meiru" monster.');
      },
      ai: { score: () => 55 },
    },
  ],
});

monster('XX-Saber Garsem', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 4,
  atk: 1400,
  def: 400,
  sets: ['x-saber', 'xx-saber'],
  aiValue: 400,
  text: 'Gains 200 ATK for each "X-Saber" monster you control. If this card on the field is destroyed by card effect and sent to the GY: Add 1 "X-Saber" monster from your Deck to your hand.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 200 * ctx.faceUpMonsters('me', isXS).length }] },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Search X-Saber',
      categories: ['search'],
      eventFilter: (ctx, ev) => selfDestroyedToGrave(ctx, ev) && reasonsOf(ev).includes('effect'),
      resolve: async (ctx) => {
        await ctx.search(isXS, 1, 'Add 1 "X-Saber" monster from your Deck to your hand.');
      },
    },
  ],
});

monster("Gravekeeper's Visionary", {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 8,
  atk: 2000,
  def: 1800,
  sets: ['gravekeeper'],
  aiValue: 700,
  text: `You can Tribute Summon this card by Tributing 1 "Gravekeeper's" monster. This card gains 200 ATK for each "Gravekeeper's" monster in your Graveyard. If this face-up card would be destroyed, you can discard 1 "Gravekeeper's" monster instead.`,
  effects: [
    { kind: 'continuous', range: ['hand'], altTribute: (ctx, summoned, t) => summoned === ctx.self && isGK(t) },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 200 * ctx.grave('me', isGK).length }] },
    {
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card) => {
        if (card !== ctx.self || !monActive(ctx)) return false;
        const gk = ctx.hand('me', isGK);
        if (!gk.length) return false;
        if (!(await ctx.confirm(`Discard 1 "Gravekeeper's" monster instead of destroying ${ctx.self.name}?`, true))) return false;
        const s = await ctx.select(gk, 1, 1, `Discard 1 "Gravekeeper's" monster.`, 'discard');
        if (!s.length) return false;
        await ctx.discard(s);
        ctx.log(`${ctx.self.name} is not destroyed.`);
        return true;
      },
    },
  ],
});

monster('Black Potan', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 1,
  atk: 200,
  def: 100,
  aiValue: 200,
  text: 'If you control a face-up Tuner monster, this card cannot be destroyed by battle. When a face-up Tuner monster(s) you control is removed from the field, gain 800 Life Points.',
  effects: [
    { kind: 'continuous', active: (ctx) => ctx.faceUpMonsters('me', (c) => c.isTuner).length > 0, mods: [{ q: 'indestructibleBattle' }] },
    {
      kind: 'trigger',
      event: 'leftField',
      range: ['mzone'],
      mandatory: true,
      label: 'Gain 800 LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c !== ctx.self && ev.from === 'mzone' && !!ev.fromFaceUp && ev.fromController === ctx.player && c.isMonster && c.isTuner && monActive(ctx);
      },
      resolve: async (ctx) => {
        await ctx.recover(ctx.player, 800);
      },
    },
  ],
});

const machineInHand = (ctx: Ctx) => ctx.hand('me', (c) => isRace(c, 'Machine'));
monster('Shreddder', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1600,
  def: 1000,
  aiValue: 500,
  text: "Once per turn: You can send 1 Machine-Type monster from your hand to the Graveyard, then target 1 monster your opponent controls with a Level less than or equal to the sent monster's; destroy that target.",
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Send Machine: destroy',
      categories: ['destroy'],
      canActivate: (ctx) => {
        const maxL = Math.max(0, ...machineInHand(ctx).map((c) => c.data.level ?? 0));
        return ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c) && ctx.level(c) <= maxL).length > 0;
      },
      activate: async (ctx) => {
        const maxL = Math.max(0, ...machineInHand(ctx).map((c) => c.data.level ?? 0));
        const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c) && ctx.level(c) <= maxL));
        const need = best ? ctx.level(best) : 0;
        const minT = Math.min(...ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).map((c) => ctx.level(c)));
        const s = await ctx.select(machineInHand(ctx).filter((c) => (c.data.level ?? 0) >= minT), 1, 1, 'Send 1 Machine-Type monster from your hand to the GY.', 'cost', {
          aiScore: (c) => ((c.data.level ?? 0) >= need ? 10000 : 0) - cardValue(ctx.game, c),
        });
        if (!s.length) return false;
        const lv = s[0].data.level ?? 0;
        await ctx.sendToGrave(s, 'cost');
        await ctx.selectTargets(ctx.faceUpMonsters('opp', (c) => ctx.level(c) <= lv), 1, 1, `Target 1 monster with Level ${lv} or lower.`, 'destroy');
      },
      resolve: destroyTargets,
      ai: {
        score: (ctx) => {
          const maxL = Math.max(0, ...machineInHand(ctx).map((c) => c.data.level ?? 0));
          const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c) && ctx.level(c) <= maxL));
          return best && cardValue(ctx.game, best) >= 1500 ? 50 : 0;
        },
      },
    },
  ],
});

monster('Pandaborg', {
  attribute: 'WATER',
  race: 'Psychic',
  level: 4,
  atk: 1700,
  def: 1400,
  aiValue: 300,
  text: 'When this card is destroyed by battle and sent to the Graveyard, you can pay 800 Life Points to Special Summon 1 Level 4 Psychic-Type monster from your Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Pay 800: recruit Psychic',
      categories: ['specialSummon'],
      eventFilter: selfBattleToGrave,
      canActivate: (ctx) => ctx.lp > 800 && ctx.canSpecialSummon() && ctx.deck('me', (c) => isRace(c, 'Psychic') && c.data.level === 4 && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(800);
      },
      resolve: async (ctx) => {
        await summonFromDeck(ctx, (c) => isRace(c, 'Psychic') && c.data.level === 4, 'Special Summon 1 Level 4 Psychic-Type monster from your Deck.');
      },
      ai: { score: (ctx) => (ctx.lp > 2500 ? 1 : 0) },
    },
  ],
});

monster('Codarus', {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 4,
  atk: 1400,
  def: 1200,
  aiValue: 300,
  text: 'You can send 1 face-up "Umi" you control to the Graveyard to target up to 2 cards your opponent controls; send those targets to the Graveyard.',
  effects: [
    {
      kind: 'ignition',
      label: 'Send Umi: send 2 cards to the GY',
      categories: [], // sends to the GY (not destruction)
      canActivate: (ctx) => ctx.spellTraps('me', isUmi).length > 0 && ctx.field('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.spellTraps('me', isUmi), 1, 1, 'Send 1 face-up "Umi" you control to the GY.', 'cost');
        if (!s.length) return false;
        await ctx.sendToGrave(s, 'cost');
        await ctx.selectTargets(ctx.field('opp'), 1, 2, 'Target up to 2 cards your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.onField);
        if (t.length) await ctx.sendToGrave(t);
      },
      ai: { score: (ctx) => (ctx.field('opp').reduce((a, c) => a + cardValue(ctx.game, c), 0) >= 2500 ? 50 : 0) },
    },
  ],
});

monster('Gundari', {
  attribute: 'FIRE',
  race: 'Pyro',
  level: 4,
  atk: 1000,
  def: 200,
  types: ['spirit'],
  nomi: true,
  aiValue: 300,
  text: "This card cannot be Special Summoned. This card returns to its owner's hand during the End Phase of the turn it is Normal Summoned or flipped face-up. If this card battles a Synchro Monster, return both monsters to their owners' hands at the start of the Damage Step (without damage calculation).",
  effects: [
    ...spiritEffects,
    {
      // APPROX: no "start of the Damage Step" event; used in the Damage Step window before damage calculation.
      kind: 'quick',
      damageStep: true,
      label: 'Return both monsters to the hand',
      categories: ['toHand'],
      condition: (ctx) => {
        const o = battleOpponent(ctx);
        return !!ctx.battle?.inDamageStep && !!o && o.location === 'mzone' && o.faceUp && o.hasType('synchro') && monActive(ctx);
      },
      resolve: async (ctx) => {
        const o = battleOpponent(ctx);
        const list = [ctx.self, o].filter((c): c is C => !!c && c.location === 'mzone');
        if (list.length) await ctx.toHand(list);
      },
      ai: { score: () => 100 },
    },
  ],
});

const zweiInstalled = new WeakSet<C>();
function installZwei(card: C, g: Game) {
  if (zweiInstalled.has(card)) return;
  zweiInstalled.add(card);
  patchData(card, (orig, c) =>
    c.location === 'grave' || (c.location === 'mzone' && c.flags.zweiTurn === g.turn) ? variant(orig, 'name:Cyber Dragon', { name: 'Cyber Dragon' }) : undefined,
  );
}
monster('Cyber Dragon Zwei', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 4,
  atk: 1500,
  def: 1000,
  sets: ['cyber'],
  aiValue: 300,
  text: 'This card\'s name becomes "Cyber Dragon" while in the GY. Once per turn: You can reveal 1 Spell in your hand; this card\'s name becomes "Cyber Dragon" until the End Phase. If this card attacks an opponent\'s monster, it gains 300 ATK during the Damage Step only.',
  effects: [
    {
      // APPROX: name change through a per-instance data override (see patchData).
      kind: 'trigger',
      event: 'sentToGrave',
      label: '(name in GY)',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self) installZwei(ctx.self, ctx.game);
        return false;
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Reveal Spell: becomes "Cyber Dragon"',
      categories: [],
      canActivate: (ctx) => ctx.hand('me', (c) => c.isSpell).length > 0 && ctx.self.flags.zweiTurn !== ctx.turn,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.hand('me', (c) => c.isSpell), 1, 1, 'Reveal 1 Spell in your hand.', 'generic');
        if (!s.length) return false;
        await reveal(ctx, s);
      },
      resolve: async (ctx) => {
        if (!monActive(ctx)) return;
        installZwei(ctx.self, ctx.game);
        ctx.self.flags.zweiTurn = ctx.turn;
        ctx.log(`${ctx.game.players[ctx.player].name}'s Cyber Dragon Zwei is treated as "Cyber Dragon".`);
      },
      ai: {
        score: (ctx) =>
          ctx.extra('me', (c) => c.hasType('fusion') && /"Cyber Dragon"/.test(c.data.text)).length && ctx.hand('me', (c) => c.name === 'Polymerization' || c.name === 'Power Bond').length ? 30 : 0,
      },
    },
    {
      kind: 'continuous',
      mods: [{ q: 'atk', value: (ctx) => (ctx.battle?.inDamageStep && ctx.battle.attacker === ctx.self && ctx.battle.target ? 300 : 0) }],
    },
  ],
});

const unionTargets = (ctx: Ctx) =>
  ctx.faceUpMonsters('me', (c) => c !== ctx.self && isRace(c, 'Machine') && !ctx.game.equipsOf(c).some((e) => e.isMonster && e.hasType('union')));
monster('Oilman', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 2,
  atk: 400,
  def: 400,
  types: ['union'],
  aiValue: 300,
  text: 'Once per turn, you can either: Target 1 Machine-Type monster you control; equip this card to that target, OR: Unequip this card and Special Summon it in Attack Position. While equipped by this effect, if the equipped monster destroys an opponent\'s monster by battle: Draw 1 card. (A monster can only be equipped with 1 Union monster at a time. If the equipped monster would be destroyed, destroy this card instead.)',
  effects: [
    {
      kind: 'ignition',
      range: ['mzone', 'szone'],
      opt: true,
      label: 'Equip / Unequip',
      categories: ['atkChange'],
      condition: (ctx) =>
        ctx.self.location === 'mzone'
          ? ctx.self.faceUp && ctx.freeSZones() > 0 && unionTargets(ctx).some((c) => ctx.canTarget(c))
          : ctx.self.location === 'szone' && !!ctx.self.flags.unionEquipped && ctx.equipTarget !== undefined && ctx.canSpecialSummon(),
      activate: async (ctx) => {
        ctx.data.mode = ctx.self.location === 'mzone' ? 'equip' : 'unequip';
        if (ctx.data.mode === 'equip') await ctx.selectTargets(unionTargets(ctx), 1, 1, 'Target 1 Machine-Type monster you control to equip Oilman to.', 'equip');
      },
      resolve: async (ctx) => {
        if (ctx.data.mode === 'equip') {
          const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && c.controller === ctx.player)[0];
          if (!t || ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
          if (equipMonster(ctx, ctx.self, t, ctx.player)) ctx.self.flags.unionEquipped = true;
        } else if (ctx.self.location === 'szone') {
          await ctx.specialSummon(ctx.self, { pos: 'atk' });
        }
      },
      ai: {
        score: (ctx) => {
          if (ctx.self.location !== 'mzone' || ctx.phase !== 'main1') return 0;
          return unionTargets(ctx).some((c) => ctx.atk(c) >= 1800) ? 35 : 0;
        },
      },
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
        ctx.log(`${ctx.self.name} is destroyed instead.`);
        await ctx.game.destroy([ctx.self], 'effect', ctx.player, ctx.self);
        return ctx.self.location !== 'szone';
      },
    },
  ],
});

// ------------------------------------------------------------ Djinns of Rituals

const DJ = [DJINN_TEXT_NOTE, 'djinn']; // both tags, so Stardust Overdrive's Ritual Spells recognise these Djinns too
monster('Djinn Cursenchanter of Rituals', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 1700,
  def: 1000,
  sets: DJ,
  aiValue: 200,
  text: "When you Ritual Summon a monster, you can banish this card from your Graveyard as 1 of the monsters required for the Ritual Summon. While the monster Ritual Summoned using this card is face-up on the field, Synchro Monsters' effects are negated.",
  effects: [
    {
      kind: 'continuous',
      range: ['banished'],
      mods: [{ q: 'negated', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && c.faceUp && c.hasType('synchro') && !!ritualUsing(ctx.game, ctx.self) }],
    },
  ],
});

monster('Djinn Prognosticator of Rituals', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 3,
  atk: 400,
  def: 300,
  sets: DJ,
  aiValue: 200,
  text: 'When you Ritual Summon a monster, you can banish this card from your GY as 1 of the monsters required for the Ritual Summon. If you Ritual Summon using this card, if that Ritual Summoned monster inflicts battle damage to your opponent, they discard 1 card.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      range: ['banished'],
      mandatory: true,
      label: 'Opponent discards 1',
      categories: ['discard'],
      eventFilter: (ctx, ev) => {
        const r = ev.reasonCard as C | undefined;
        return ev.player === ctx.opp && !!r && r.controller === ctx.player && ritualUsing(ctx.game, ctx.self) === r;
      },
      resolve: async (ctx) => {
        if (ctx.hand('opp').length) await ctx.discardFromHand(1, undefined, 'effect', ctx.opp, 'Discard 1 card.');
      },
    },
  ],
});

monster('Djinn Disserere of Rituals', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 1,
  atk: 200,
  def: 200,
  sets: DJ,
  aiValue: 200,
  text: 'When you Ritual Summon a monster, you can banish this card from your GY as 1 of the monsters required for the Ritual Summon. The monster Ritual Summoned using this card is unaffected by Trap effects.',
  effects: [
    {
      kind: 'continuous',
      range: ['banished'],
      mods: [{ q: 'unaffectedByTraps', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && ritualUsing(ctx.game, ctx.self) === c }],
    },
  ],
});

monster('Garlandolf, King of Destruction', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 7,
  atk: 2500,
  def: 1400,
  types: ['ritual'],
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 800,
  text: 'This card can only be Ritual Summoned with the Ritual Spell Card, "Ritual of Destruction". When this card is Ritual Summoned, destroy all other face-up monsters on the field with DEF less than or equal to this card\'s ATK. This card gains 100 ATK for each monster destroyed by this effect.',
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Destroy monsters',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.method === 'ritual',
      resolve: async (ctx) => {
        if (!monActive(ctx)) return;
        const a = ctx.atk(ctx.self);
        const d = await ctx.destroy(ctx.faceUpMonsters('both', (c) => c !== ctx.self && ctx.def(c) <= a));
        if (d.length && ctx.self.location === 'mzone' && ctx.self.faceUp) ctx.addTempMod(ctx.self, 'atk', 100 * d.length, 'field');
      },
    },
  ],
});

// ------------------------------------------------------------ Extra Deck

monster('Majestic Red Dragon', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 10,
  atk: 4000,
  def: 3000,
  types: ['synchro'],
  aiValue: 1500,
  text: '"Majestic Dragon" + "Red Dragon Archfiend" + 1 non-Tuner monster\nCannot be destroyed by card effects. After damage calculation, if this card attacks: Destroy all Defense Position monsters on the field. Once per turn: You can target 1 face-up monster your opponent controls; negate its effects, and if you do, this card gains ATK equal to that monster\'s ATK. These changes last until the end of this turn. During the End Phase: Target 1 "Red Dragon Archfiend" in your Graveyard; return this card from the field to the Extra Deck, then Special Summon that target.',
  synchro: {
    tuner: named('Majestic Dragon'),
    minNonTuners: 2,
    maxNonTuners: 2,
    check: (mats) => mats.some((c) => c.name === 'Red Dragon Archfiend'),
    desc: '"Majestic Dragon" + "Red Dragon Archfiend" + 1 non-Tuner monster',
  },
  effects: [
    { kind: 'continuous', mods: [{ q: 'indestructibleEffect' }] },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Destroy Defense Position monsters',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && monActive(ctx),
      resolve: async (ctx) => {
        const v = ctx.monsters('both', (c) => c.pos === 'def');
        if (v.length) await ctx.destroy(v);
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Negate & absorb ATK',
      categories: ['negate', 'atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'negate', { aiScore: (c) => ctx.atk(c) + cardValue(ctx.game, c) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (!t) return;
        const a = ctx.atk(t);
        ctx.negateEffects(t, 'turn');
        if (monActive(ctx)) ctx.addTempMod(ctx.self, 'atk', a, 'turn');
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' ? 55 : 0) },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Return; summon Red Dragon Archfiend',
      categories: ['specialSummon', 'toDeck'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.self.location === 'mzone' && ctx.self.faceUp,
      canActivate: (ctx) => ctx.grave('me', (c) => c.name === 'Red Dragon Archfiend' && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.name === 'Red Dragon Archfiend'), 1, 1, 'Target "Red Dragon Archfiend" in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || ctx.self.location !== 'mzone') return;
        await ctx.toDeck(ctx.self, 'shuffle');
        if ((ctx.self.location as Location) === 'extra' && ctx.canSummonCard(t)) await ctx.specialSummon(t, { pos: 'choose', ignoreConditions: true });
      },
    },
  ],
});

monster('Sun Dragon Inti', {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 8,
  atk: 3000,
  def: 2800,
  types: ['synchro'],
  aiValue: 900,
  text: '"Fire Ant Ascator" + 1+ non-Tuner monsters\nIf this card is destroyed by battle and sent to the GY: Destroy the monster that destroyed this card, and if you do, inflict damage to your opponent equal to half the ATK that monster had on the field. Once per turn, during the Standby Phase of the next turn after this card on the field was destroyed: You can target 1 "Moon Dragon Quilla" in your GY; Special Summon that target.',
  synchro: { tuner: named('Fire Ant Ascator'), desc: '"Fire Ant Ascator" + 1+ non-Tuner monsters' },
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Destroy the destroyer, burn',
      categories: ['destroy', 'damage'],
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self || ctx.self.location !== 'grave') return false;
        const o = evo(ev);
        if (!o) return false;
        ctx.self.flags.intiKiller = { c: o, moveId: o.moveId };
        return true;
      },
      resolve: async (ctx) => {
        const k = ctx.self.flags.intiKiller as { c: C; moveId: number } | undefined;
        if (!k || k.c.location !== 'mzone' || k.c.moveId !== k.moveId) return;
        const a = ctx.atk(k.c);
        const d = await ctx.destroy(k.c);
        if (d.length) await ctx.damage(ctx.opp, Math.floor(a / 2));
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '(destroyed)',
      eventFilter: (ctx, ev) => {
        if (ev.card === ctx.self && ev.from === 'mzone') ctx.self.flags.intiDestroyedTurn = ctx.turn;
        return false;
      },
    },
    reviveFromGrave('Revive Moon Dragon Quilla', named('Moon Dragon Quilla'), {
      event: 'phaseStart',
      range: ['grave'],
      opt: true,
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.self.flags.intiDestroyedTurn === ctx.turn - 1,
    }),
  ],
});

monster('Moon Dragon Quilla', {
  attribute: 'DARK',
  race: 'Dragon',
  level: 6,
  atk: 2500,
  def: 2000,
  types: ['synchro'],
  aiValue: 700,
  text: '"Supay" + 1+ non-Tuner monsters\nIf this card is targeted for an attack: Gain LP equal to half the attacking monster\'s ATK. If this card on the field is destroyed: You can target 1 "Sun Dragon Inti" in your GY; Special Summon that target.',
  synchro: { tuner: named('Supay'), desc: '"Supay" + 1+ non-Tuner monsters' },
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      mandatory: true,
      label: 'Gain LP',
      categories: ['recover'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && monActive(ctx),
      resolve: async (ctx) => {
        const a = evc(ctx.event!);
        if (a) await ctx.recover(ctx.player, Math.floor(ctx.atk(a) / 2));
      },
    },
    reviveFromGrave('Revive Sun Dragon Inti', named('Sun Dragon Inti'), {
      event: 'destroyed',
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone',
    }),
  ],
});

monster('Underground Arachnid', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 6,
  atk: 2400,
  def: 1200,
  types: ['synchro'],
  aiValue: 900,
  text: '1 DARK Tuner + 1 non-Tuner Insect-Type monster\nIf this card attacks, your opponent cannot activate any Spell or Trap Cards until the end of the Damage Step. Once per turn, you can select 1 face-up monster your opponent controls, and equip it to this card. If this card would be destroyed by battle, you can destroy the monster equipped to this card by its effect instead. (You can only equip 1 monster at a time to this card.)',
  synchro: { tuner: attr('DARK'), nonTuner: race('Insect'), minNonTuners: 1, maxNonTuners: 1, desc: '1 DARK Tuner + 1 non-Tuner Insect-Type monster' },
  effects: [
    {
      kind: 'continuous',
      mods: [
        { q: 'cannotActivateSpells', to: 'players', filter: (ctx, p) => p === ctx.opp && ctx.game.battle?.attacker === ctx.self },
        { q: 'cannotActivateTraps', to: 'players', filter: (ctx, p) => p === ctx.opp && ctx.game.battle?.attacker === ctx.self },
      ],
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Equip an opponent\'s monster',
      categories: ['control'],
      canActivate: (ctx) => ctx.freeSZones() > 0 && !arachnidEquip(ctx) && ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls to equip.', 'control');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && c.controller === ctx.opp)[0];
        if (!t || !monActive(ctx) || arachnidEquip(ctx)) return;
        if (equipMonster(ctx, t, ctx.self, ctx.player)) {
          t.flags.arachnidEquip = ctx.self.uid;
          ctx.log(`${t.name} is equipped to ${ctx.self.name}.`);
        }
      },
      ai: { score: () => 60 },
    },
    {
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card, reason) => {
        if (card !== ctx.self || reason !== 'battle') return false;
        const eq = arachnidEquip(ctx);
        if (!eq) return false;
        if (!(await ctx.confirm(`Destroy ${eq.name} instead of ${ctx.self.name}?`, true))) return false;
        await ctx.game.destroy([eq], 'effect', ctx.player, ctx.self);
        return eq.location !== 'szone';
      },
    },
  ],
});
function arachnidEquip(ctx: Ctx): C | undefined {
  return ctx.game.equipsOf(ctx.self).find((c) => c.isMonster && c.flags.arachnidEquip === ctx.self.uid);
}

// ------------------------------------------------------------ more Main Deck monsters

monster('XX-Saber Emmersblade', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 3,
  atk: 1300,
  def: 800,
  sets: ['x-saber', 'xx-saber'],
  aiValue: 400,
  text: 'When this card is destroyed by battle and sent to the GY: You can Special Summon 1 Level 4 or lower "X-Saber" monster from your Deck.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      label: 'Recruit X-Saber',
      categories: ['specialSummon'],
      eventFilter: selfBattleToGrave,
      condition: (ctx) => ctx.canSpecialSummon() && ctx.deck('me', (c) => isXS(c) && (c.data.level ?? 0) <= 4).length > 0,
      resolve: async (ctx) => {
        await summonFromDeck(ctx, (c) => isXS(c) && (c.data.level ?? 0) <= 4, 'Special Summon 1 Level 4 or lower "X-Saber" monster from your Deck.');
      },
    },
  ],
});

/** Face-up card that can hold a Spell Counter (cards whose text mentions Spell Counters). */
const canHoldSpellCounter = (c: C) =>
  c.onField && c.faceUp && c.name !== 'Alchemist of Black Spells' && /Spell Counter/.test(c.data.text) && !(/max\.? 1/i.test(c.data.text) && (c.counters.spell ?? 0) >= 1);
monster('Alchemist of Black Spells', {
  attribute: 'WIND',
  race: 'Spellcaster',
  level: 4,
  atk: 1200,
  def: 1800,
  aiValue: 200,
  text: 'Once per turn: You can target 1 face-up card you control that you can place a Spell Counter on; change this Attack Position card you control to face-up Defense Position, and if you do, place 1 Spell Counter on that target.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Place a Spell Counter',
      categories: [],
      canActivate: (ctx) => ctx.self.pos === 'atk' && ctx.field('me', canHoldSpellCounter).some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('me', canHoldSpellCounter), 1, 1, 'Target 1 card that can hold a Spell Counter.', 'buff');
      },
      resolve: async (ctx) => {
        if (!monActive(ctx) || ctx.self.pos !== 'atk') return;
        await ctx.changePos(ctx.self, 'def');
        const t = ctx.validTargets((c) => c.onField && c.faceUp)[0];
        if (t) t.counters.spell = (t.counters.spell ?? 0) + 1;
      },
      ai: { score: () => 35 },
    },
  ],
});

monster('Cactus Bouncer', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 4,
  atk: 1800,
  def: 300,
  nomi: true,
  aiValue: 400,
  text: 'Cannot be Special Summoned. While another Plant monster is on the field, neither player can Special Summon monsters.',
  effects: [
    {
      kind: 'continuous',
      active: (ctx) => ctx.faceUpMonsters('both', (c) => c !== ctx.self && isRace(c, 'Plant')).length > 0,
      mods: [{ q: 'cannotSpecialSummon', to: 'players' }],
    },
  ],
});

monster('Dragonic Guard', {
  attribute: 'FIRE',
  race: 'Dragon',
  level: 4,
  atk: 1500,
  def: 1800,
  aiValue: 300,
  text: 'Each time a monster is Normal Summoned or Set, place 1 Dragonic Counter on this card. You can send this face-up card to the Graveyard to Special Summon 1 Dragon-Type monster from your Deck whose Level is less than or equal to the number of Dragonic Counters on this card.',
  effects: [
    {
      kind: 'trigger',
      event: ['normalSummoned', 'monsterSet'],
      label: '(Dragonic Counter)',
      eventFilter: (ctx) => {
        if (monActive(ctx)) ctx.self.counters.dragonic = (ctx.self.counters.dragonic ?? 0) + 1;
        return false;
      },
    },
    {
      kind: 'ignition',
      label: 'Send to GY: summon a Dragon',
      categories: ['specialSummon'],
      canActivate: (ctx) => {
        const n = ctx.self.counters.dragonic ?? 0;
        return n > 0 && ctx.canSpecialSummon() && ctx.deck('me', (c) => isRace(c, 'Dragon') && (c.data.level ?? 0) <= n && ctx.canSummonCard(c)).length > 0;
      },
      activate: async (ctx) => {
        ctx.data.n = ctx.self.counters.dragonic ?? 0;
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const n = ctx.data.n as number;
        await summonFromDeck(ctx, (c) => isRace(c, 'Dragon') && (c.data.level ?? 0) <= n, `Special Summon 1 Dragon-Type monster with Level ${n} or lower from your Deck.`);
      },
      ai: {
        score: (ctx) => {
          const n = ctx.self.counters.dragonic ?? 0;
          const best = Math.max(0, ...ctx.deck('me', (c) => isRace(c, 'Dragon') && (c.data.level ?? 0) <= n && ctx.canSummonCard(c)).map((c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0)));
          return best >= 2200 ? 55 : 0;
        },
      },
    },
  ],
});

const oceanCounters = new WeakMap<C, { moveId: number; n: number }>();
monster('The Dragon Dwelling in the Deep', {
  attribute: 'WATER',
  race: 'Sea Serpent',
  level: 4,
  atk: 1700,
  def: 1400,
  aiValue: 200,
  text: "Place 1 Ocean Counter on this card during each player's Standby Phase. When this card is removed from the field, all Fish-Type and Sea Serpent-Type monsters you control gain 200 ATK for each Ocean Counter on this card, until the End Phase.",
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      label: '(Ocean Counter)',
      eventFilter: (ctx, ev) => {
        if (ev.phase === 'standby' && monActive(ctx)) {
          const n = (ctx.self.counters.ocean ?? 0) + 1;
          ctx.self.counters.ocean = n;
          oceanCounters.set(ctx.self, { moveId: ctx.self.moveId, n });
        }
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      mandatory: true,
      label: 'Fish / Sea Serpent gain ATK',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => {
        if (ev.card !== ctx.self || ev.from !== 'mzone' || !ev.fromFaceUp) return false;
        const o = oceanCounters.get(ctx.self);
        if (!o || o.moveId !== ctx.self.moveId - 1 || o.n <= 0) return false;
        ctx.self.flags.oceanLeft = o.n;
        return true;
      },
      resolve: async (ctx) => {
        const n = ctx.self.flags.oceanLeft ?? 0;
        for (const m of ctx.faceUpMonsters('me', (c) => isRace(c, 'Fish') || isRace(c, 'Sea Serpent'))) ctx.addTempMod(m, 'atk', 200 * n, 'turn');
      },
    },
  ],
});

monster('Earthbound Linewalker', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 1200,
  def: 1900,
  aiValue: 300,
  text: '"Earthbound Immortal" monsters cannot be destroyed by their own effects.',
  effects: [
    {
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card, reason, reasonCard) => {
        if (!isEI(card) || reasonCard !== card || reason === 'battle') return false;
        ctx.log(`${card.name} cannot be destroyed by its own effect (Earthbound Linewalker).`);
        return true;
      },
    },
  ],
});

monster('Gale Dogra', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 2,
  atk: 650,
  def: 600,
  aiValue: 200,
  text: 'You can pay 3000 LP; send 1 monster from your Extra Deck to the GY.',
  effects: [
    {
      kind: 'ignition',
      label: 'Pay 3000: send from Extra Deck',
      categories: [],
      canActivate: (ctx) => ctx.lp > 3000 && ctx.extra('me', (c) => c.isMonster).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(3000);
      },
      resolve: async (ctx) => {
        const s = await ctx.select(ctx.extra('me', (c) => c.isMonster), 1, 1, 'Send 1 monster from your Extra Deck to the GY.', 'toGrave');
        if (s.length) await ctx.sendToGrave(s);
      },
      ai: { score: () => 0 },
    },
  ],
});

monster('Berfomet', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 5,
  atk: 1400,
  def: 1800,
  sets: ['phantom-beast'],
  aiValue: 300,
  text: 'When this card is Normal or Flip Summoned: You can add 1 "Gazelle the King of Mythical Beasts" from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: ['normalSummoned', 'flipSummoned'],
      when: true,
      label: 'Search Gazelle',
      categories: ['search'],
      canActivate: (ctx) => ctx.deck('me', named('Gazelle the King of Mythical Beasts')).length > 0,
      resolve: async (ctx) => {
        await ctx.search(named('Gazelle the King of Mythical Beasts'), 1, 'Add "Gazelle the King of Mythical Beasts" to your hand.');
      },
    },
  ],
});

monster('Chimera the Flying Mythical Beast', {
  attribute: 'WIND',
  race: 'Beast',
  level: 6,
  atk: 2100,
  def: 1800,
  types: ['fusion'],
  sets: ['phantom-beast'],
  aiValue: 400,
  text: '"Gazelle the King of Mythical Beasts" + "Berfomet"\n(This card is always treated as a "Phantom Beast" card.)\nWhen this card is destroyed: You can target 1 "Berfomet" or 1 "Gazelle the King of Mythical Beasts" in your GY; Special Summon that target.',
  fusion: { materials: [named('Gazelle the King of Mythical Beasts'), named('Berfomet')], desc: '"Gazelle the King of Mythical Beasts" + "Berfomet"' },
  effects: [
    reviveFromGrave('Revive Berfomet / Gazelle', (c) => c.name === 'Berfomet' || c.name === 'Gazelle the King of Mythical Beasts', {
      event: 'destroyed',
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone',
    }),
  ],
});

monster('Viser Des', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 500,
  def: 1200,
  aiValue: 400,
  text: 'If this card is Normal Summoned: Target 1 monster your opponent controls; during your third Standby Phase after this effect\'s activation, destroy that monster. This card cannot be destroyed by battle while the targeted monster is on the field.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      mandatory: true,
      label: 'Mark a monster',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone')[0];
        if (!t) return;
        const mid = t.moveId;
        if (ctx.self.location === 'mzone') ctx.self.flags.viser = { c: t, moveId: mid };
        const g = ctx.game;
        const p = ctx.player;
        const self = ctx.self;
        ctx.log(`${t.name} will be destroyed during the third Standby Phase.`);
        ctx.later(
          'standby',
          async () => {
            if (t.location === 'mzone' && t.moveId === mid) await g.destroy([t], 'effect', p, self);
          },
          6,
        );
      },
    },
    {
      kind: 'continuous',
      active: (ctx) => {
        const v = ctx.self.flags.viser as { c: C; moveId: number } | undefined;
        return !!v && v.c.location === 'mzone' && v.c.moveId === v.moveId;
      },
      mods: [{ q: 'indestructibleBattle' }],
    },
  ],
});

monster('Shield Wing', {
  attribute: 'WIND',
  race: 'Winged Beast',
  level: 2,
  atk: 0,
  def: 900,
  aiValue: 500,
  text: 'Twice per turn, this card cannot be destroyed by battle.',
  effects: [
    {
      kind: 'continuous',
      replaceDestroyOne: async (ctx, card, reason) => {
        if (card !== ctx.self || reason !== 'battle') return false;
        const f = ctx.self.flags;
        if (f.shieldWingTurn !== ctx.turn) {
          f.shieldWingTurn = ctx.turn;
          f.shieldWingUsed = 0;
        }
        if (f.shieldWingUsed >= 2) return false;
        f.shieldWingUsed++;
        ctx.log(`${ctx.self.name} is not destroyed by battle (${f.shieldWingUsed}/2 this turn).`);
        return true;
      },
    },
  ],
});

const zombieCombos = (ctx: Ctx) => {
  const hand = ctx.hand('me', (c) => c !== ctx.self && isRace(c, 'Zombie') && ctx.canSummonCard(c));
  const out: C[][] = [];
  for (let i = 0; i < hand.length; i++) {
    if ((hand[i].data.atk ?? 0) === 2000) out.push([hand[i]]);
    for (let j = i + 1; j < hand.length; j++) if ((hand[i].data.atk ?? 0) + (hand[j].data.atk ?? 0) === 2000) out.push([hand[i], hand[j]]);
  }
  return out.filter((cb) => cb.length <= ctx.freeMZones());
};
monster('Skull Conductor', {
  attribute: 'DARK',
  race: 'Zombie',
  level: 4,
  atk: 2000,
  def: 0,
  aiValue: -800, // a one-turn attacker: prefer its hand effect / other monsters,
  text: 'If this card is face-up on the field at the end of the Battle Phase: Destroy this face-up card. You can send this card from your hand to the Graveyard; Special Summon up to 2 Zombie-Type monsters from your hand whose combined ATK is exactly 2000.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleEnd',
      mandatory: true,
      label: 'Destroy this card',
      categories: ['destroy'],
      eventFilter: (ctx) => monActive(ctx),
      resolve: async (ctx) => {
        if (ctx.self.location === 'mzone' && ctx.self.faceUp) await ctx.destroy(ctx.self);
      },
    },
    {
      kind: 'ignition',
      range: ['hand'],
      label: 'Send to GY: summon Zombies',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && zombieCombos(ctx).length > 0,
      activate: async (ctx) => {
        await ctx.sendToGrave(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        const combos = zombieCombos(ctx);
        if (!combos.length) return;
        const pick = ctx.game.controllers[ctx.player].isHuman
          ? await ctx.game.pickCombo(ctx.player, combos, 'Select Zombies with exactly 2000 combined ATK', 'specialSummon')
          : [...combos].sort((a, b) => b.length - a.length || b.reduce((s, c) => s + (c.data.aiValue ?? 0), 0) - a.reduce((s, c) => s + (c.data.aiValue ?? 0), 0))[0];
        if (pick?.length) await ctx.specialSummon(pick, { pos: 'choose' });
      },
      ai: { score: (ctx) => (zombieCombos(ctx).some((cb) => cb.length === 2) ? 60 : 35) },
    },
  ],
});

monster('Shield Worm', {
  attribute: 'EARTH',
  race: 'Insect',
  level: 4,
  atk: 800,
  def: 2000,
  aiValue: 200,
  text: "When this card is Summoned, it is changed to Defense Position. Then, send 1 card from the top of your opponent's Deck to the Graveyard for each face-up Insect-Type monster you control.",
  effects: [
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      label: 'Defense Position, mill',
      categories: ['position', 'mill'],
      resolve: async (ctx) => {
        if (ctx.self.location !== 'mzone' || !ctx.self.faceUp) return;
        if (ctx.self.pos === 'atk') await ctx.changePos(ctx.self, 'def');
        const n = ctx.faceUpMonsters('me', (c) => isRace(c, 'Insect')).length;
        if (n) await ctx.mill(n, ctx.opp);
      },
    },
  ],
});

// ============================================================ SPELLS

spell('Cards of Consonance', 'normal', {
  text: 'Discard 1 Dragon Tuner with 1000 or less ATK; draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      canActivate: (ctx) => ctx.deck().length >= 2 && ctx.hand('me', (c) => c !== ctx.self && isRace(c, 'Dragon') && c.isTuner && (c.data.atk ?? 0) <= 1000).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.hand('me', (c) => c !== ctx.self && isRace(c, 'Dragon') && c.isTuner && (c.data.atk ?? 0) <= 1000), 1, 1, 'Discard 1 Dragon Tuner with 1000 or less ATK.', 'discard');
        if (!s.length) return false;
        await ctx.discard(s, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.draw(2);
      },
      ai: { score: () => 70 },
    },
  ],
});

/** Tuner groups in the GY whose Levels total exactly `lv`. */
function tunerSets(ctx: Ctx, lv: number, zones: number): C[][] {
  const pool = ctx.grave('me', (c) => c.isMonster && c.isTuner && ctx.canSummonCard(c)).slice(0, 12);
  const out: C[][] = [];
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    const set = pool.filter((_, i) => mask & (1 << i));
    if (set.length > zones) continue;
    if (set.reduce((a, c) => a + (c.data.level ?? 0), 0) === lv) out.push(set);
  }
  return out;
}
const synchroSummonedThisTurn = (ctx: Ctx) => eventsThisTurn(ctx.game).some((e) => e.type === 'synchroSummoned' && e.player === ctx.player);
const varietySynchros = (ctx: Ctx) =>
  ctx.faceUpMonsters('me', (c) => c.hasType('synchro') && tunerSets(ctx, ctx.level(c), ctx.freeMZones() + 1).length > 0);
spell('Variety Comes Out', 'normal', {
  text: 'Return 1 face-up Synchro Monster you control to the Extra Deck to select and Special Summon a Tuner monster(s) from your Graveyard, whose total Levels equal the Level of that Synchro Monster. You cannot Synchro Summon the turn you activate this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      condition: (ctx) => !synchroSummonedThisTurn(ctx),
      canActivate: (ctx) => !ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon') && varietySynchros(ctx).length > 0,
      activate: async (ctx) => {
        const [s] = await ctx.select(varietySynchros(ctx), 1, 1, 'Return 1 face-up Synchro Monster you control to the Extra Deck.', 'cost', {
          aiScore: (c) => (c.owner !== ctx.player ? 10000 : 0) - cardValue(ctx.game, c),
        });
        if (!s) return false;
        const lv = ctx.level(s);
        await ctx.toDeck(s, 'shuffle', 'cost');
        ctx.addPlayerMod(ctx.player, 'cannotSynchroSummon');
        const sets = tunerSets(ctx, lv, ctx.freeMZones());
        const pick = ctx.game.controllers[ctx.player].isHuman
          ? await ctx.game.pickCombo(ctx.player, sets, `Select Tuners with total Level ${lv}`, 'specialSummon')
          : [...sets].sort((a, b) => b.reduce((x, c) => x + (c.data.atk ?? 0), 0) - a.reduce((x, c) => x + (c.data.atk ?? 0), 0))[0];
        if (pick) ctx.addTargets(pick);
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave' && ctx.canSummonCard(c));
        if (t.length && t.length <= ctx.freeMZones()) await ctx.specialSummon(t, { pos: 'choose' });
      },
      ai: {
        score: (ctx) => (ctx.faceUpMonsters('me', (c) => c.hasType('synchro') && c.owner !== ctx.player).some((c) => varietySynchros(ctx).includes(c)) ? 60 : 0),
      },
    },
  ],
});

spell('Reptilianne Rage', 'equip', {
  sets: REP,
  text: 'The equipped monster becomes Reptile-Type. It gains 800 ATK. If this card is destroyed and sent to the Graveyard: Target 1 face-up monster your opponent controls; it loses 800 ATK.',
  effects: [
    equipActivate({
      score: (ctx) => (ctx.phase === 'main1' && ctx.faceUpMonsters('me').length ? 35 : 0),
      onEquip: (ctx, t) => {
        // APPROX: Type change through a per-instance data override.
        const rage = ctx.self;
        const mid = t.moveId;
        raceWhile(t, 'Reptile', () => rage.onField && rage.equippedTo === t.uid && t.moveId === mid && t.location === 'mzone');
      },
    }),
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: equipped, value: 800 }] },
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Opponent monster loses 800 ATK',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && reasonsOf(ev).includes('destroy'),
      canActivate: (ctx) => ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Target 1 face-up monster your opponent controls.', 'destroy', { aiScore: (c) => ctx.atk(c) });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (t) ctx.addTempMod(t, 'atk', -800, 'field');
      },
    },
  ],
});

spell('Advance Force', 'continuous', {
  text: 'You can Tribute 1 Level 5 or higher monster to Tribute Summon a Level 7 or higher monster.',
  effects: [
    {
      kind: 'activate',
      categories: [],
      ai: {
        score: (ctx) =>
          ctx.hand('me', (c) => c.isMonster && (c.data.level ?? 0) >= 7 && !c.data.cannotNormalSummon).length && ctx.monsters('me', (c) => ctx.level(c) >= 5).length ? 45 : 0,
      },
    },
    { kind: 'continuous', altTribute: (ctx, summoned, t) => (summoned.data.level ?? 0) >= 7 && ctx.level(t) >= 5 },
  ],
});

spell("Viper's Rebirth", 'normal', {
  text: 'If all monsters in your GY are Reptile: Target 1 non-Tuner in your GY; Special Summon it, but destroy it during the End Phase of this turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      condition: (ctx) => {
        const mons = ctx.grave('me', (c) => c.isMonster);
        return mons.length > 0 && mons.every((c) => isRace(c, 'Reptile'));
      },
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => c.isMonster && !c.isTuner && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && !c.isTuner && ctx.canSummonCard(c)), 1, 1, 'Target 1 non-Tuner in your GY.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t || !ctx.canSummonCard(t)) return;
        const r = await ctx.specialSummon(t, { pos: 'choose' });
        if (!r.length) return;
        const m = r[0];
        const id = m.moveId;
        const g = ctx.game;
        const p = ctx.player;
        const self = ctx.self;
        ctx.later('end', async () => {
          if (m.location === 'mzone' && m.moveId === id) await g.destroy([m], 'effect', p, self);
        });
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' ? 40 : 0) },
    },
  ],
});

spell('Temple of the Sun', 'continuous', {
  text: 'Face-up monsters you control that were Special Summoned from the Graveyard gain 300 ATK.',
  effects: [
    { kind: 'activate', categories: ['atkChange'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => summonedFromGrave(ctx.game, c)).length ? 30 : 0) } },
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && c.faceUp && c.controller === ctx.player && summonedFromGrave(ctx.game, c), value: 300 }] },
  ],
});

spell('Rocket Pilder', 'equip', {
  text: 'While the equipped monster is attacking, it cannot be destroyed by battle. At the end of the Damage Step, if the equipped monster attacked: The attack target loses ATK equal to the ATK of the equipped monster, until the End Phase.',
  effects: [
    equipActivate({ score: (ctx) => (ctx.phase === 'main1' && ctx.faceUpMonsters('me', (c) => ctx.game.canAttack(c)).length ? 30 : 0) }),
    { kind: 'continuous', mods: [{ q: 'indestructibleBattle', to: 'cards', filter: (ctx, c: C) => equipped(ctx, c) && ctx.game.battle?.attacker === c }] },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      range: ['szone'],
      mandatory: true,
      label: 'Attack target loses ATK',
      categories: ['atkChange'],
      eventFilter: (ctx, ev) => stActive(ctx) && !!ctx.equipTarget && ev.card === ctx.equipTarget && !!evo(ev) && evo(ev)!.location === 'mzone',
      resolve: async (ctx) => {
        const a = ctx.equipTarget;
        const t = evo(ctx.event!);
        if (a && t && t.location === 'mzone' && t.faceUp) ctx.addTempMod(t, 'atk', -ctx.atk(a), 'turn');
      },
    },
  ],
});

spell('Break! Draw!', 'equip', {
  text: "Equip only to a Machine monster. If the equipped monster destroys an opponent's monster by battle and sends it to the GY: Draw 1 card. Destroy this card during your 3rd End Phase after activation.",
  effects: [
    equipActivate({
      filter: (_ctx, c) => isRace(c, 'Machine'),
      score: (ctx) => (ctx.phase === 'main1' && ctx.faceUpMonsters('me', (c) => isRace(c, 'Machine') && ctx.game.canAttack(c)).length ? 35 : 0),
    }),
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['szone'],
      mandatory: true,
      label: 'Draw 1',
      categories: ['draw'],
      eventFilter: (ctx, ev) => stActive(ctx) && !!ctx.equipTarget && evo(ev) === ctx.equipTarget && ev.fromController !== ctx.player && evc(ev)?.location === 'grave',
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Destroy this card (3rd End Phase)',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        if (ev.phase !== 'end' || !ctx.isMyTurn || !ctx.self.faceUp || !ctx.self.activeOnField) return false;
        ctx.self.flags.breakDrawEnds = (ctx.self.flags.breakDrawEnds ?? 0) + 1;
        return ctx.self.flags.breakDrawEnds >= 3;
      },
      resolve: async (ctx) => {
        if (ctx.self.onField) await ctx.destroy(ctx.self);
      },
    },
  ],
});

spell('Power Pickaxe', 'equip', {
  text: "Once per turn, you can select and remove from play 1 monster in your opponent's Graveyard whose Level is less than or equal to the equipped monster's, and have the equipped monster gain 500 ATK until the End Phase.",
  effects: [
    equipActivate({ score: (ctx) => (ctx.phase === 'main1' && ctx.faceUpMonsters('me').length && ctx.grave('opp', (c) => c.isMonster).length ? 30 : 0) }),
    {
      kind: 'ignition',
      range: ['szone'],
      opt: true,
      label: 'Banish from GY: +500 ATK',
      categories: ['banish', 'atkChange'],
      canActivate: (ctx) => {
        const e = ctx.equipTarget;
        return !!e && ctx.grave('opp', (c) => c.isMonster && (c.data.level ?? 0) <= ctx.level(e)).length > 0;
      },
      activate: async (ctx) => {
        const e = ctx.equipTarget!;
        await ctx.selectTargets(ctx.grave('opp', (c) => c.isMonster && (c.data.level ?? 0) <= ctx.level(e)), 1, 1, 'Target 1 monster in your opponent\'s GY.', 'banish');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (!t) return;
        const r = await ctx.banish(t);
        const e = ctx.equipTarget;
        if (r.length && e && e.location === 'mzone' && e.faceUp) ctx.addTempMod(e, 'atk', 500, 'turn');
      },
      ai: { score: () => 40 },
    },
  ],
});

type Mark = { uid: number; moveId: number };
const marked = (list: Mark[] | undefined, c: C) => !!list?.some((m) => m.uid === c.uid && m.moveId === c.moveId);
spell("Spiders' Lair", 'continuous', {
  text: "Once per turn, you can select 1 face-up Insect-Type monster you control. While this card remains on the field, any opponent's monster that battles with one of those monsters is changed to Defense Position at the end of the Battle Phase, and cannot change its battle position while this card is on the field.",
  effects: [
    { kind: 'activate', categories: ['position'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => isRace(c, 'Insect')).length ? 25 : 0) } },
    {
      kind: 'ignition',
      opt: true,
      label: 'Select an Insect',
      categories: ['position'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isRace(c, 'Insect') && !marked(ctx.self.flags.lair, c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => isRace(c, 'Insect') && !marked(ctx.self.flags.lair, c)), 1, 1, 'Target 1 face-up Insect-Type monster you control.', 'buff');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (t && stActive(ctx)) (ctx.self.flags.lair ??= []).push({ uid: t.uid, moveId: t.moveId });
      },
      ai: { score: () => 30 },
    },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      label: '(battled)',
      eventFilter: (ctx, ev) => {
        if (!stActive(ctx)) return false;
        const a = evc(ev);
        const t = evo(ev);
        if (!a || !t) return false;
        const lair = ctx.self.flags.lair as Mark[] | undefined;
        const victim = marked(lair, a) && t.controller === ctx.opp ? t : marked(lair, t) && a.controller === ctx.opp ? a : undefined;
        if (victim) (ctx.self.flags.lairPending ??= []).push({ uid: victim.uid, moveId: victim.moveId, c: victim });
        return false;
      },
    },
    {
      kind: 'trigger',
      event: 'battleEnd',
      range: ['szone'],
      mandatory: true,
      label: 'Change to Defense Position',
      categories: ['position'],
      eventFilter: (ctx) => stActive(ctx) && !!(ctx.self.flags.lairPending as unknown[] | undefined)?.length,
      resolve: async (ctx) => {
        const pending = (ctx.self.flags.lairPending ?? []) as (Mark & { c: C })[];
        ctx.self.flags.lairPending = [];
        for (const v of pending) {
          if (v.c.location !== 'mzone' || v.c.moveId !== v.moveId || !ctx.self.onField) continue;
          if (v.c.pos !== 'def' || !v.c.faceUp) await ctx.changePos(v.c, 'def', true);
          (ctx.self.flags.lairLocked ??= []).push({ uid: v.c.uid, moveId: v.c.moveId });
        }
      },
    },
    { kind: 'continuous', mods: [{ q: 'cannotChangePos', to: 'cards', filter: (ctx, c: C) => marked(ctx.self.flags.lairLocked, c) }] },
  ],
});

spell('Iron Core Specimen Lab', 'field', {
  sets: ['koaki-meiru'],
  text: `During each of your End Phases, destroy this card unless you reveal 1 "Iron Core of Koa'ki Meiru" in your hand. Each time a "Koa'ki Meiru" monster on the field is destroyed during the End Phase, its owner can add 1 "Koa'ki Meiru" monster from their Deck to their hand.`,
  effects: [
    { kind: 'activate', categories: ['search'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isKoaki).length ? 35 : 0) } },
    koakiMaintenance({ filter: named(IRON_CORE), what: `"${IRON_CORE}"` }, 'field'),
    {
      kind: 'trigger',
      event: 'destroyed',
      range: ['fzone'],
      mandatory: true,
      label: "Add a Koa'ki Meiru",
      categories: ['search'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return ctx.phase === 'end' && stActive(ctx) && !!c && ev.from === 'mzone' && isKoaki(c);
      },
      resolve: async (ctx) => {
        const batch = ctx.event!.batch;
        const victims = ctx.game.eventLog.filter((e) => e.type === 'destroyed' && e.batch === batch && e.from === 'mzone' && isKoaki(e.card as C)).map((e) => e.card as C);
        for (const v of victims) {
          const owner = v.owner;
          if (ctx.game.queryPlayer(owner, 'cannotAddFromDeck')) continue;
          const cands = ctx.game.zone(owner, 'deck').filter(isKoaki);
          if (!cands.length) continue;
          if (!(await ctx.game.confirm(owner, `Add 1 "Koa'ki Meiru" monster from your Deck to your hand?`, ctx.self, true))) continue;
          const s = await ctx.game.select(owner, cands, 1, 1, `Add 1 "Koa'ki Meiru" monster to your hand.`, 'toHand', { source: ctx.self });
          if (s.length) await ctx.game.toHand(s, 'effect', owner, ctx.self);
          ctx.game.shuffleDeck(owner);
        }
      },
    },
  ],
});

spell("Gravekeeper's Stele", 'normal', {
  sets: ['gravekeeper'],
  text: 'Target 2 "Gravekeeper\'s" monsters in your GY; add those targets to your hand. This effect cannot be negated by the effect of "Necrovalley".',
  effects: [
    {
      kind: 'activate',
      categories: ['toHand'],
      canActivate: (ctx) => ctx.grave('me', isGK).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', isGK), 2, 2, 'Target 2 "Gravekeeper\'s" monsters in your GY.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
      ai: { score: () => 55 },
    },
  ],
});

spell('Machine Assembly Line', 'continuous', {
  text: 'All Machine monsters on the field gain 200 ATK. Each time a face-up Machine monster(s) on the field is destroyed by battle or card effect, place 2 Junk Counters on this card. You can send this card to the GY, then target 1 Machine monster in your GY whose Level is less than or equal to the number of Junk Counters that were on this card; Special Summon that target.',
  effects: [
    { kind: 'activate', categories: ['atkChange'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => isRace(c, 'Machine')).length ? 30 : 10) } },
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: (_ctx, c: C) => c.location === 'mzone' && c.faceUp && isRace(c, 'Machine'), value: 200 }] },
    {
      kind: 'trigger',
      event: 'destroyed',
      label: '(Junk Counters)',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (!stActive(ctx) || !c || ev.from !== 'mzone' || !ev.fromFaceUp || !isRace(c, 'Machine')) return false;
        const r = reasonsOf(ev);
        if (!r.includes('battle') && !r.includes('effect')) return false;
        if (ctx.self.flags.junkBatch === ev.batch) return false;
        ctx.self.flags.junkBatch = ev.batch;
        ctx.self.counters.junk = (ctx.self.counters.junk ?? 0) + 2;
        return false;
      },
    },
    {
      kind: 'ignition',
      label: 'Send to GY: revive a Machine',
      categories: ['specialSummon'],
      canActivate: (ctx) => {
        const n = ctx.self.counters.junk ?? 0;
        return n > 0 && ctx.canSpecialSummon() && ctx.grave('me', (c) => isRace(c, 'Machine') && (c.data.level ?? 0) <= n && ctx.canSummonCard(c)).length > 0;
      },
      activate: async (ctx) => {
        const n = ctx.self.counters.junk ?? 0;
        await ctx.sendToGrave(ctx.self, 'cost');
        await ctx.selectTargets(ctx.grave('me', (c) => isRace(c, 'Machine') && (c.data.level ?? 0) <= n && ctx.canSummonCard(c)), 1, 1, `Target 1 Machine monster with Level ${n} or lower in your GY.`, 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t, { pos: 'choose' });
      },
      ai: {
        score: (ctx) => {
          const n = ctx.self.counters.junk ?? 0;
          const best = Math.max(0, ...ctx.grave('me', (c) => isRace(c, 'Machine') && (c.data.level ?? 0) <= n && ctx.canSummonCard(c)).map((c) => c.data.atk ?? 0));
          return best >= 1800 ? 50 : 0;
        },
      },
    },
  ],
});

spell('Ritual of Destruction', 'ritual', {
  text: 'This card is used to Ritual Summon "Garlandolf, King of Destruction". You must also Tribute monsters whose total Levels equal 7 or more from the field or your hand. During your Main Phase, you can remove from play this card from your Graveyard. If you do, during this turn, any monster destroyed by battle with a Ritual Monster you control will be returned to the top of the Deck instead of being sent to the Graveyard.',
  effects: [
    ritualActivate('Garlandolf, King of Destruction', 7),
    {
      kind: 'ignition',
      range: ['grave'],
      label: 'Banish: battle victims go to the Deck',
      categories: ['toDeck'],
      condition: (ctx) => !ctx.game.turnData[`abpfRoD:${ctx.player}`],
      activate: async (ctx) => {
        await ctx.banish(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        ctx.game.turnData[`abpfRoD:${ctx.player}`] = true;
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && ctx.turn > 1 && ctx.faceUpMonsters('me', (c) => isRitual(c) && ctx.game.canAttack(c)).length ? 30 : 0) },
    },
    {
      // APPROX: the monster first reaches the GY (its GY triggers still happen) and is then put on top of the Deck.
      kind: 'trigger',
      event: 'battleDestroyed',
      range: ['banished', 'grave'],
      mandatory: true,
      label: 'Return to the top of the Deck',
      categories: ['toDeck'],
      eventFilter: (ctx, ev) => {
        const g = ctx.game;
        const v = evc(ev);
        const by = evo(ev);
        if (!g.turnData[`abpfRoD:${ctx.player}`] || !v || !by || v.location !== 'grave') return false;
        if (!isRitual(by) || by.controller !== ctx.player) return false;
        const key = `abpfRoDDone:${v.uid}:${v.moveId}`;
        if (g.turnData[key]) return false;
        g.turnData[key] = true;
        return true;
      },
      resolve: async (ctx) => {
        const v = evc(ctx.event!);
        if (v && v.location === 'grave') await ctx.toDeck(v, 'top');
      },
    },
  ],
});

spell('Ascending Soul', 'continuous', {
  text: 'Once per turn, when a Ritual Monster(s) is Ritual Summoned: You can target 1 monster in your Graveyard that was Tributed for the Ritual Summon; add that target to your hand.',
  effects: [
    { kind: 'activate', categories: ['toHand'], ai: { score: (ctx) => (ctx.hand('me', isRitual).length ? 30 : 0) } },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      range: ['szone'],
      opt: true,
      label: 'Add a Tributed monster',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => stActive(ctx) && ev.method === 'ritual' && !!ritualInfo(evc(ev)),
      canActivate: (ctx) => ascendable(ctx).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ascendable(ctx), 1, 1, 'Target 1 monster Tributed for the Ritual Summon.', 'toHand');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toHand(t);
      },
    },
  ],
});
function ascendable(ctx: Ctx): C[] {
  const info = ritualInfo(evc(ctx.event!));
  if (!info) return [];
  return ctx.grave('me', (c) => c.isMonster && info.mats.some((m) => m.uid === c.uid && m.moveId === c.moveId));
}

spell('Ritual Cage', 'continuous', {
  text: 'You take no battle damage from attacks involving a Ritual Monster you control. Ritual Monsters you control cannot be targeted by, or destroyed by, monster effects.',
  effects: [
    { kind: 'activate', categories: ['protect'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isRitual).length ? 30 : 0) } },
    {
      kind: 'continuous',
      mods: [
        { q: 'noBattleDamageFrom', to: 'cards', filter: (ctx, c: C) => c.location === 'mzone' && c.controller === ctx.player && isRitual(c) },
        {
          // APPROX: "cannot be targeted by monster effects" checks the link being activated (the engine's untargetable has no source).
          q: 'untargetable',
          to: 'cards',
          filter: (ctx, c: C) => {
            const l = ctx.game.chain[ctx.game.chain.length - 1];
            return c.location === 'mzone' && c.controller === ctx.player && isRitual(c) && !!l && l.card.isMonster;
          },
        },
      ],
      replaceDestroyOne: async (ctx, card, reason, reasonCard) => {
        if (reason === 'battle' || !reasonCard?.isMonster || card.controller !== ctx.player || !isRitual(card)) return false;
        ctx.log(`${card.name} cannot be destroyed by monster effects (Ritual Cage).`);
        return true;
      },
    },
  ],
});

spell('Pot of Benevolence', 'normal', {
  text: 'Target 2 cards in the GY(s); shuffle them into the Deck(s). After activation, banish this card instead of sending it to the GY. You can only activate 1 "Pot of Benevolence" per turn.',
  effects: [
    {
      kind: 'activate',
      opt: 'pot-of-benevolence',
      categories: ['toDeck'],
      canActivate: (ctx) => ctx.grave('both').length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('both'), 2, 2, 'Target 2 cards in the GY(s).', 'toDeck', {
          aiScore: (c) => (c.owner === ctx.opp ? cardValue(ctx.game, c) : (c.data.aiValue ?? 0) + (c.isExtra ? 1000 : 0) - 500),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave');
        if (t.length) await ctx.toDeck(t, 'shuffle');
        // APPROX: banished at the end of its resolution (a negated copy goes to the GY).
        if (ctx.self.onField) await ctx.banish(ctx.self, 'rule');
      },
      ai: {
        score: (ctx) => {
          const theirs = ctx.grave('opp', (c) => c.isMonster && ((c.data.aiValue ?? 0) >= 600 || c.isExtra)).length;
          return theirs >= 1 && ctx.grave('both').length >= 2 ? 30 : 0;
        },
      },
    },
  ],
});

spell('Synchro Control', 'quickplay', {
  text: 'Activate only if you have no Synchro Monsters on your side of the field or in your Graveyard. Pay 1000 Life Points and select 1 face-up Synchro Monster your opponent controls. Take control of the selected monster until the End Phase of your turn.',
  effects: [
    {
      kind: 'activate',
      categories: ['control'],
      condition: (ctx) => ctx.cards('me', ['mzone', 'grave'], (c) => c.isMonster && c.hasType('synchro')).length === 0,
      canActivate: (ctx) => ctx.lp > 1000 && ctx.freeMZones() > 0 && ctx.faceUpMonsters('opp', (c) => c.hasType('synchro') && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(1000);
        await ctx.selectTargets(ctx.faceUpMonsters('opp', (c) => c.hasType('synchro')), 1, 1, 'Target 1 face-up Synchro Monster your opponent controls.', 'control');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp && c.controller === ctx.opp)[0];
        if (!t) return;
        if (ctx.isMyTurn) {
          await ctx.takeControl(t, true);
          return;
        }
        if (await ctx.takeControl(t, false)) {
          const id = t.moveId;
          const g = ctx.game;
          ctx.later(
            'end',
            async () => {
              if (t.location === 'mzone' && t.moveId === id && t.controller !== t.owner) await g.returnControl(t);
            },
            1,
          );
        }
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp', (c) => c.hasType('synchro') && ctx.canTarget(c)));
          return best && ctx.isMyTurn && ctx.phase === 'main1' && cardValue(ctx.game, best) >= 2200 ? 55 : 0;
        },
      },
    },
  ],
});

spell('Core Transport Unit', 'continuous', {
  sets: ['koaki-meiru'],
  text: `Once per turn, you can discard 1 card to add 1 "Iron Core of Koa'ki Meiru" from your Deck to your hand.`,
  effects: [
    { kind: 'activate', categories: ['search'], ai: { score: (ctx) => (ctx.deck('me', named(IRON_CORE)).length ? 30 : 0) } },
    {
      kind: 'ignition',
      opt: true,
      label: 'Discard: search Iron Core',
      categories: ['search'],
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.deck('me', named(IRON_CORE)).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.hand(), 1, 1, 'Discard 1 card.', 'discard');
        if (!s.length) return false;
        await ctx.discard(s, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.search(named(IRON_CORE), 1, `Add 1 "${IRON_CORE}" to your hand.`);
      },
      ai: { score: (ctx) => (ctx.hand().length >= 2 && !ctx.hand('me', named(IRON_CORE)).length ? 40 : 0) },
    },
  ],
});

// ============================================================ TRAPS

const oppAttack = (ctx: Ctx, ev: GameEvent) => evc(ev)?.controller === ctx.opp;
const attackWindow = (ctx: Ctx) => !!ctx.battle && !ctx.battle.inDamageStep && !ctx.battle.negated;

trap('Changing Destiny', 'normal', {
  text: "When an opponent's monster declares an attack: Target the attacking monster; negate the attack, and if you do, change it to Defense Position and it cannot change its battle position while it is face-up on the field. Then, your opponent chooses 1 of these effects.\n● You (the opponent of this card's activator) gain LP equal to half the target's ATK.\n● Your opponent (the activator of this card) takes damage equal to half the target's ATK.",
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack', 'position'],
      eventFilter: oppAttack,
      condition: attackWindow,
      canActivate: (ctx) => !!ctx.battle && ctx.canTarget(ctx.battle.attacker),
      activate: async (ctx) => {
        await ctx.selectTargets([ctx.battle!.attacker], 1, 1, 'Target the attacking monster.', 'position');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone')[0];
        if (!t || !ctx.battle || ctx.battle.attacker !== t) return;
        ctx.negateAttack();
        if (t.faceUp && t.pos !== 'def') await ctx.changePos(t, 'def', true);
        ctx.addTempMod(t, 'cannotChangePos', true, 'field');
        const half = Math.floor(ctx.atk(t) / 2);
        if (half <= 0) return;
        const i = await ctx.game.option(ctx.opp, 'Changing Destiny: choose 1 effect.', [`You gain ${half} LP`, `Your opponent takes ${half} damage`], ctx.self, (k) =>
          k === 1 ? (ctx.lp <= half * 2 ? 3 : 2) : 1,
        );
        if (i === 0) await ctx.recover(ctx.opp, half);
        else await ctx.damage(ctx.player, half);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const a = ctx.atk(b.attacker);
          if (a >= ctx.lp) return 95;
          if (!b.target) return a >= 1500 ? 55 : 0;
          const mine = b.target.faceUp ? (b.target.pos === 'atk' ? ctx.atk(b.target) : ctx.def(b.target)) : 1500;
          return a > mine && cardValue(ctx.game, b.target) >= 1200 ? 50 : 0;
        },
      },
    },
  ],
});

trap('Fiendish Chain', 'continuous', {
  text: 'Activate this card by targeting 1 Effect Monster on the field; negate the effects of that face-up monster while it is on the field, also that face-up monster cannot attack. When it is destroyed, destroy this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['negate'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => c.hasType('effect') && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const top = ctx.chainTop();
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => c.hasType('effect')), 1, 1, 'Target 1 face-up Effect Monster.', 'negate', {
          aiScore: (c) => (c.controller === ctx.player ? -10000 : (top && top.card === c ? 5000 : 0) + cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (t && ctx.self.onField) ctx.self.flags.chained = { uid: t.uid, moveId: t.moveId };
      },
      ai: {
        score: (ctx) => {
          const top = ctx.chainTop();
          if (top && top.player === ctx.opp && top.card.location === 'mzone' && top.card.faceUp && top.fromLocation === 'mzone' && top.card.hasType('effect')) return 75;
          const b = ctx.battle;
          if (b && b.attacker.controller === ctx.opp && !b.inDamageStep && b.attacker.hasType('effect') && ctx.atk(b.attacker) >= 1900) return 55;
          const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp', (c) => c.hasType('effect') && ctx.canTarget(c)));
          return best && (best.data.aiValue ?? 0) >= 800 && !ctx.isMyTurn && ctx.phase === 'end' ? 40 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      mods: [
        { q: 'negated', to: 'cards', filter: (ctx, c: C) => marked(ctx.self.flags.chained ? [ctx.self.flags.chained] : [], c) },
        { q: 'cannotAttack', to: 'cards', filter: (ctx, c: C) => marked(ctx.self.flags.chained ? [ctx.self.flags.chained] : [], c) },
      ],
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      range: ['szone'],
      mandatory: true,
      label: 'Destroyed with the chained monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const f = ctx.self.flags.chained as Mark | undefined;
        const c = evc(ev);
        return !!f && !!c && c.uid === f.uid && ev.from === 'mzone' && ctx.self.faceUp;
      },
      resolve: async (ctx) => {
        if (ctx.self.onField) await ctx.destroy(ctx.self);
      },
    },
  ],
});

const reflectPatched = new WeakSet<Game>();
function ensureReflectPatch(g: Game) {
  if (reflectPatched.has(g)) return;
  reflectPatched.add(g);
  const anyG = g as any;
  const orig = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: C, sourcePlayer?: PlayerId) => {
    if (kind === 'effect' && sourcePlayer !== undefined && sourcePlayer !== p && g.turnData[`abpfNatRefl:${p}`]) {
      g.log(`Nature's Reflection: the damage is inflicted to ${g.players[sourcePlayer].name} instead.`, 'action', p);
      return orig(sourcePlayer, amount, kind, source, sourcePlayer);
    }
    return orig(p, amount, kind, source, sourcePlayer);
  };
}
trap("Nature's Reflection", 'normal', {
  text: 'During this turn, any effect activated by your opponent that would inflict damage becomes an effect that inflicts damage to their Life Points.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      resolve: async (ctx) => {
        ensureReflectPatch(ctx.game);
        ctx.game.turnData[`abpfNatRefl:${ctx.player}`] = true;
      },
      ai: {
        score: (ctx) => {
          if (ctx.game.turnData[`abpfNatRefl:${ctx.player}`]) return 0;
          const top = ctx.chainTop();
          return top && top.player === ctx.opp && !top.negated && (top.effect.categories ?? []).includes('damage') ? 80 : 0;
        },
      },
    },
  ],
});

trap('Serpent Suppression', 'continuous', {
  sets: REP,
  text: 'Face-up Attack Position monsters with 0 ATK your opponent controls cannot be destroyed by battle with "Reptilianne" monsters.',
  effects: [
    {
      kind: 'activate',
      categories: ['protect'],
      ai: {
        score: (ctx) =>
          ctx.faceUpMonsters('me', isReptilianne).length && ctx.faceUpMonsters('opp', (c) => c.pos === 'atk' && ctx.atk(c) === 0).length ? 30 : 0,
      },
    },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'indestructibleBattle',
          to: 'cards',
          filter: (ctx, c: C) => {
            if (c.location !== 'mzone' || !c.faceUp || c.pos !== 'atk' || c.controller !== ctx.opp || ctx.atk(c) !== 0) return false;
            const o = battleOpponent(ctx, c);
            return !!o && isReptilianne(o);
          },
        },
      ],
    },
  ],
});

trap('Meteor Flare', 'normal', {
  text: 'Activate by sending 2 cards from your hand to the Graveyard while your opponent has more than 3000 Life Points. Inflict 2000 damage to your opponent. If this card is in the Graveyard, you can add it to your hand instead of conducting your normal draw during your Draw Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['damage'],
      condition: (ctx) => ctx.oppLp > 3000,
      canActivate: (ctx) => ctx.hand().length >= 2,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.hand(), 2, 2, 'Send 2 cards from your hand to the GY.', 'cost');
        if (s.length < 2) return false;
        await ctx.sendToGrave(s, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 2000);
      },
      ai: { score: (ctx) => (ctx.hand().length >= 5 && !ctx.isMyTurn && ctx.phase === 'end' ? 35 : 0) },
    },
    {
      // Replaces the normal draw: the card returns to the hand, then the Draw Phase draw is skipped.
      kind: 'trigger',
      event: 'phaseStart',
      range: ['grave'],
      label: 'Add to hand instead of drawing',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.phase === 'draw' && ctx.isMyTurn && !(ctx.turn === 1 && ctx.game.options.skipFirstDraw),
      condition: (ctx) => !ctx.game.queryPlayer(ctx.player, 'cannotDraw'),
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave') return;
        await ctx.toHand(ctx.self);
        const g = ctx.game;
        g.addPlayerMod(ctx.player, 'cannotDraw', true, 'turn');
        const mod = g.playerMods[g.playerMods.length - 1];
        ctx.later('standby', async () => {
          g.playerMods = g.playerMods.filter((m) => m !== mod);
        });
      },
      ai: { score: (ctx) => (ctx.hand().length >= 3 && ctx.oppLp > 3000 && ctx.oppLp <= 6000 ? 1 : 0) },
    },
  ],
});

const ceremonialToken = token(
  'Ceremonial Token',
  'EARTH',
  'Rock',
  1,
  0,
  0,
  'Cannot be Tributed, except for the Tribute Summon of an "Earthbound Immortal" monster, and cannot be used as Synchro Material.',
);
trap('Offering to the Immortals', 'normal', {
  text: 'When your opponent\'s monster declares a direct attack while you have 3000 or less LP: Negate the attack, and if you do, Special Summon 2 "Ceremonial Tokens" (Rock/EARTH/Level 1/ATK 0/DEF 0), and if you do that, add 1 "Earthbound Immortal" card from your Deck to your hand. "Ceremonial Tokens" cannot be Tributed, except for a Tribute Summon of an "Earthbound Immortal" monster, and cannot be used as Synchro Material.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack', 'specialSummon', 'search'],
      eventFilter: (ctx, ev) => oppAttack(ctx, ev) && !ev.other,
      condition: (ctx) => attackWindow(ctx) && !ctx.battle!.target && ctx.lp <= 3000,
      resolve: async (ctx) => {
        if (!ctx.battle || ctx.battle.negated) return;
        ctx.negateAttack();
        if (ctx.freeMZones() < 2 || !ctx.canSpecialSummon()) return;
        const toks = await ctx.createTokens(ceremonialToken, 2, 'def');
        for (const t of toks) {
          t.flags.noSynchroMaterial = true;
          t.flags.tributeFodderFor = (f: C) => isEI(f);
          ctx.addTempMod(t, 'cannotBeTributed', true, 'field');
        }
        if (toks.length === 2) await ctx.search((c) => c.name.includes('Earthbound Immortal'), 1, 'Add 1 "Earthbound Immortal" card to your hand.');
      },
      ai: { score: (ctx) => (ctx.battle && ctx.atk(ctx.battle.attacker) >= ctx.lp ? 100 : 60) },
    },
  ],
});

trap('Destruct Potion', 'normal', {
  text: 'Select 1 monster you control. Destroy it, and gain Life Points equal to its ATK.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'recover'],
      canActivate: (ctx) => ctx.monsters('me', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const threatened = new Set(ctx.game.chain.filter((l) => l.player === ctx.opp).flatMap((l) => l.ctx.targets));
        await ctx.selectTargets(ctx.monsters('me'), 1, 1, 'Target 1 monster you control.', 'generic', {
          aiScore: (c) => (threatened.has(c) ? 10000 : 0) + ctx.atk(c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone')[0];
        if (!t) return;
        const a = ctx.atk(t);
        const d = await ctx.destroy(t);
        if (d.length && a > 0) await ctx.recover(ctx.player, a);
      },
      ai: {
        score: (ctx) => {
          const top = ctx.chainTop();
          if (!top || top.player !== ctx.opp || top.negated) return 0;
          const hit = top.ctx.targets.filter((c) => c.controller === ctx.player && c.location === 'mzone');
          const cats = top.effect.categories ?? [];
          return hit.some((c) => ctx.atk(c) >= 1000) && (cats.includes('destroy') || cats.includes('banish') || cats.includes('control') || cats.includes('toDeck')) ? 55 : 0;
        },
      },
    },
  ],
});

const reaperTargets = (ctx: Ctx) => ctx.grave('me', (c) => (c.name === 'Supay' || c.name === 'Fire Ant Ascator') && ctx.canSummonCard(c));
trap('Call of the Reaper', 'normal', {
  text: 'Activate only when a monster(s) is Special Summoned from your Graveyard. Select and Special Summon 1 "Supay" or 1 "Fire Ant Ascator" from your Graveyard.',
  effects: [
    {
      kind: 'activate',
      event: 'specialSummoned',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.from === 'grave' && evc(ev)?.owner === ctx.player,
      canActivate: (ctx) => ctx.canSpecialSummon() && reaperTargets(ctx).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(reaperTargets(ctx), 1, 1, 'Target "Supay" or "Fire Ant Ascator" in your GY.', 'specialSummon');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'grave')[0];
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t, { pos: 'choose' });
      },
      ai: { score: () => 45 },
    },
  ],
});

trap('Lair Wire', 'normal', {
  text: 'Remove from play 1 Insect-Type monster from your Graveyard and select 1 monster your opponent controls. Destroy the selected monster.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.grave('me', (c) => isRace(c, 'Insect')).length > 0 && ctx.monsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.grave('me', (c) => isRace(c, 'Insect')), 1, 1, 'Banish 1 Insect-Type monster from your GY.', 'cost');
        if (!s.length) return false;
        await ctx.banish(s, 'cost');
        await ctx.selectTargets(ctx.monsters('opp'), 1, 1, 'Target 1 monster your opponent controls.', 'destroy');
      },
      resolve: destroyTargets,
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (b && b.attacker.controller === ctx.opp && !b.inDamageStep && ctx.canTarget(b.attacker) && ctx.atk(b.attacker) >= 1500) return 60;
          const best = bestTarget(ctx.game, ctx.monsters('opp', (c) => ctx.canTarget(c)));
          return best && cardValue(ctx.game, best) >= 2200 ? 45 : 0;
        },
      },
    },
  ],
});

trap('Core Blast', 'continuous', {
  sets: ['koaki-meiru'],
  text: 'You can only activate this card\'s effect while you control a face-up "Koa\'ki Meiru" monster. Once per turn, during your Standby Phase, if your opponent controls more monsters than you do, you can destroy a number of cards your opponent controls so that your opponent will control the same number of cards as you control monsters.',
  effects: [
    { kind: 'activate', categories: ['destroy'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isKoaki).length ? 25 : 0) } },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      opt: true,
      label: 'Destroy cards',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && stActive(ctx),
      condition: (ctx) => ctx.faceUpMonsters('me', isKoaki).length > 0 && ctx.monsters('opp').length > ctx.monsters('me').length,
      resolve: async (ctx) => {
        const n = ctx.field('opp').length - ctx.monsters('me').length;
        if (n <= 0) return;
        const s = await ctx.select(ctx.field('opp'), n, n, `Destroy ${n} card(s) your opponent controls.`, 'destroy');
        if (s.length) await ctx.destroy(s);
      },
    },
  ],
});

trap('Saber Hole', 'counter', {
  sets: ['x-saber'],
  text: 'When a monster(s) would be Summoned, while you control an "X-Saber" monster: Negate the Summon, and if you do, destroy that monster(s).',
  effects: [
    {
      kind: 'activate',
      negateSummon: true,
      categories: ['negateSummon'],
      condition: (ctx) => !!ctx.game.pendingSummon && ctx.faceUpMonsters('me', isXS).length > 0,
      resolve: async (ctx) => {
        ctx.game.negatePendingSummon();
      },
      ai: {
        score: (ctx) => {
          const ps = ctx.game.pendingSummon;
          if (!ps || ps.player !== ctx.opp) return 0;
          const v = Math.max(0, ...ps.cards.map((c) => cardValue(ctx.game, c)));
          return v >= 1800 ? 70 : 0;
        },
      },
    },
  ],
});

const mkInstalled = new WeakSet<C>();
const summonedThisTurn = (ctx: Ctx) => eventsThisTurn(ctx.game).some((e) => (e.type === 'normalSummoned' || e.type === 'specialSummoned') && e.player === ctx.player);
trap('Machine King - 3000 B.C.', 'continuous', {
  text: 'Special Summon this card as an Effect Monster (Machine/EARTH/Level 4/ATK 1000/DEF 1000). (This card is also still a Trap.) If Summoned this way, once per turn, during your Main Phase: You can Tribute 1 Machine monster; this card gains ATK equal to the ATK the Tributed monster had on the field, until the end of this turn. You cannot Normal or Special Summon other monsters the turn you activate this card.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      condition: (ctx) => !summonedThisTurn(ctx),
      canActivate: (ctx) => ctx.canSpecialSummon(),
      resolve: async (ctx) => {
        const me = ctx.self;
        if (!me.onField) return;
        // APPROX: Trap Monster through a per-instance data override; while in the Monster Zone it is not also a Trap.
        if (!mkInstalled.has(me)) {
          mkInstalled.add(me);
          patchData(me, (orig, c) =>
            c.location === 'mzone'
              ? variant(orig, 'trap-monster', { kind: 'monster', mtypes: ['effect'], attribute: 'EARTH', race: 'Machine', level: 4, atk: 1000, def: 1000 })
              : undefined,
          );
        }
        const r = await ctx.specialSummon(me, { pos: 'choose' });
        if (r.length) {
          me.flags.staysOnField = true;
          me.flags.mkSummoned = true;
        }
        ctx.addPlayerMod(ctx.player, 'cannotNormalSummon');
        ctx.addPlayerMod(ctx.player, 'cannotSpecialSummon');
      },
      ai: {
        score: (ctx) => {
          if (ctx.isMyTurn) return 0;
          const b = ctx.battle;
          if (b && !b.target && !b.inDamageStep && ctx.atk(b.attacker) < 1000) return 45;
          return ctx.phase === 'end' && !ctx.game.chain.length ? 35 : 0;
        },
      },
    },
    {
      kind: 'ignition',
      range: ['mzone'],
      opt: true,
      label: 'Tribute a Machine: gain ATK',
      categories: ['atkChange'],
      condition: (ctx) => !!ctx.self.flags.mkSummoned,
      canActivate: (ctx) => ctx.monsters('me', (c) => c !== ctx.self && isRace(c, 'Machine') && !ctx.query(c, 'cannotBeTributed')).length > 0,
      activate: async (ctx) => {
        const s = await ctx.select(ctx.monsters('me', (c) => c !== ctx.self && isRace(c, 'Machine') && !ctx.query(c, 'cannotBeTributed')), 1, 1, 'Tribute 1 Machine monster.', 'tribute');
        if (!s.length) return false;
        ctx.data.atk = s[0].faceUp ? ctx.atk(s[0]) : s[0].data.atk ?? 0;
        await tributeCost(ctx, s);
      },
      resolve: async (ctx) => {
        if (monActive(ctx)) ctx.addTempMod(ctx.self, 'atk', ctx.data.atk ?? 0, 'turn');
      },
      ai: { score: () => 0 },
    },
  ],
});

trap('Alien Brain', 'normal', {
  text: "If a Reptile monster you control is destroyed by battle with an opponent's attacking monster and sent to the GY: Take control of the opponent's monster, and if you do, it becomes a Reptile.",
  effects: [
    {
      kind: 'activate',
      event: 'battleDestroyed',
      categories: ['control'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        const o = evo(ev);
        return !!c && !!o && ev.fromController === ctx.player && c.location === 'grave' && isRace(c, 'Reptile') && o.controller === ctx.opp && o.location === 'mzone' && ctx.battle?.attacker === o;
      },
      canActivate: (ctx) => ctx.freeMZones() > 0,
      activate: async (ctx) => {
        ctx.data.o = evo(ctx.event!);
        ctx.data.mid = (ctx.data.o as C).moveId;
      },
      resolve: async (ctx) => {
        const o = ctx.data.o as C;
        if (!o || o.location !== 'mzone' || o.moveId !== ctx.data.mid || o.controller !== ctx.opp) return;
        if (!(await ctx.takeControl(o, false))) return;
        // APPROX: Type change through a per-instance data override.
        const mid = o.moveId;
        raceWhile(o, 'Reptile', () => o.location === 'mzone' && o.moveId === mid);
      },
      ai: { score: () => 75 },
    },
  ],
});

const templeTargets = (ctx: Ctx) =>
  ctx.faceUpMonsters('me', (c) => ctx.level(c) <= 4 && (isRace(c, 'Fish') || isRace(c, 'Sea Serpent') || isRace(c, 'Aqua')));
trap('Forgotten Temple of the Deep', 'continuous', {
  text: 'While this card is on the field, this card\'s name becomes "Umi". Once per turn: You can target 1 Level 4 or lower Fish, Sea Serpent or Aqua-Type monster you control; banish that target. During your End Phase: Special Summon the monster(s) banished by this effect.',
  effects: [
    {
      kind: 'activate',
      categories: ['protect'],
      resolve: async (ctx) => {
        const me = ctx.self;
        // APPROX: the "Umi" name through a per-instance data override (face-up on the field only).
        if (!dataPatches.has(me)) patchData(me, (orig, c) => (c.onField && c.faceUp ? variant(orig, 'name:Umi', { name: 'Umi' }) : undefined));
      },
      ai: { score: (ctx) => (templeTargets(ctx).length || ctx.monsters('me', (c) => isRace(c, 'Sea Serpent')).length ? 25 : 5) },
    },
    {
      kind: 'quick',
      opt: true,
      label: 'Banish a Fish / Sea Serpent / Aqua',
      categories: ['protect'],
      canActivate: (ctx) => templeTargets(ctx).some((c) => ctx.canTarget(c)),
      activate: async (ctx) => {
        const top = ctx.chainTop();
        await ctx.selectTargets(templeTargets(ctx), 1, 1, 'Target 1 Level 4 or lower Fish, Sea Serpent or Aqua-Type monster you control.', 'buff', {
          aiScore: (c) => (top?.ctx.targets.includes(c) ? 10000 : 0) + cardValue(ctx.game, c),
        });
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.player)[0];
        if (!t || !stActive(ctx)) return;
        const r = await ctx.banish(t);
        if (r.length && t.location === 'banished') (ctx.self.flags.templeBanished ??= []).push({ c: t, moveId: t.moveId });
      },
      ai: {
        score: (ctx) => {
          const top = ctx.chainTop();
          if (top && top.player === ctx.opp && !top.negated && top.ctx.targets.some((c) => templeTargets(ctx).includes(c))) return 70;
          const b = ctx.battle;
          if (b && b.attacker.controller === ctx.opp && b.target && templeTargets(ctx).includes(b.target) && !b.inDamageStep) {
            const t = b.target;
            const mine = t.pos === 'atk' ? ctx.atk(t) : ctx.def(t);
            return ctx.atk(b.attacker) > mine ? 55 : 0;
          }
          return 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Return the banished monsters',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && stActive(ctx) && !!(ctx.self.flags.templeBanished as unknown[] | undefined)?.length,
      resolve: async (ctx) => {
        const list = (ctx.self.flags.templeBanished ?? []) as { c: C; moveId: number }[];
        ctx.self.flags.templeBanished = [];
        const back = list.filter((v) => v.c.location === 'banished' && v.c.moveId === v.moveId).map((v) => v.c);
        if (back.length) await ctx.specialSummon(back, { pos: 'choose', ignoreConditions: true });
      },
    },
  ],
});

trap('Psi-Curse', 'normal', {
  text: "When a Psychic-Type monster you control is destroyed by battle with an opponent's attacking monster and sent to the Graveyard: Target the opponent's monster; destroy that target, and if you do, inflict damage to your opponent equal to the Level of your destroyed Psychic-Type monster x 300.",
  effects: [
    {
      kind: 'activate',
      event: 'battleDestroyed',
      categories: ['destroy', 'damage'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        const o = evo(ev);
        return !!c && !!o && ev.fromController === ctx.player && c.location === 'grave' && isRace(c, 'Psychic') && o.controller === ctx.opp && o.location === 'mzone' && ctx.battle?.attacker === o;
      },
      canActivate: (ctx) => {
        const o = evo(ctx.event!);
        return !!o && ctx.canTarget(o);
      },
      activate: async (ctx) => {
        ctx.data.lv = evc(ctx.event!)?.data.level ?? 0;
        await ctx.selectTargets([evo(ctx.event!)!], 1, 1, 'Target the attacking monster.', 'destroy');
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone')[0];
        if (!t) return;
        const d = await ctx.destroy(t);
        if (d.length) await ctx.damage(ctx.opp, 300 * (ctx.data.lv ?? 0));
      },
      ai: { score: () => 75 },
    },
  ],
});

interface DudState {
  stint: number;
  targets: { c: C; moveId: number }[];
}
const dudStates = new WeakMap<C, DudState>();
trap('Widespread Dud', 'continuous', {
  text: 'Select 2 face-up Attack Position monsters on the field. When any of the selected monsters are removed from the field, destroy this card. When this card is destroyed, destroy the selected monster(s).',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => c.pos === 'atk' && ctx.canTarget(c)).length >= 2,
      activate: async (ctx) => {
        const threatened = new Set(ctx.game.chain.filter((l) => l.player === ctx.opp).flatMap((l) => l.ctx.targets));
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => c.pos === 'atk'), 2, 2, 'Target 2 face-up Attack Position monsters.', 'target', {
          aiScore: (c) => (c.controller === ctx.player ? (threatened.has(c) ? 20000 : -cardValue(ctx.game, c)) : 10000 + cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp);
        dudStates.set(ctx.self, { stint: ctx.self.moveId, targets: t.map((c) => ({ c, moveId: c.moveId })) });
      },
      ai: {
        score: (ctx) => {
          const top = ctx.chainTop();
          if (!top || top.player !== ctx.opp || top.negated) return 0;
          const mine = top.ctx.targets.some((c) => c.controller === ctx.player && c.location === 'mzone' && c.faceUp && c.pos === 'atk');
          const theirs = ctx.faceUpMonsters('opp', (c) => c.pos === 'atk' && ctx.canTarget(c) && cardValue(ctx.game, c) >= 1500).length;
          return mine && theirs ? 55 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'leftField',
      range: ['szone'],
      mandatory: true,
      label: 'Destroy this card',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => {
        const s = dudStates.get(ctx.self);
        const c = evc(ev);
        return !!s && s.stint === ctx.self.moveId && !!c && ev.from === 'mzone' && s.targets.some((t) => t.c === c) && ctx.self.faceUp;
      },
      resolve: async (ctx) => {
        if (ctx.self.onField) await ctx.destroy(ctx.self);
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Destroy the selected monsters',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => {
        const s = dudStates.get(ctx.self);
        return ev.card === ctx.self && ev.from === 'szone' && !!s && s.stint === ctx.self.moveId - 1;
      },
      resolve: async (ctx) => {
        const s = dudStates.get(ctx.self);
        if (!s) return;
        dudStates.delete(ctx.self);
        const live = s.targets.filter((t) => t.c.location === 'mzone' && t.c.moveId === t.moveId).map((t) => t.c);
        if (live.length) await ctx.destroy(live);
      },
    },
  ],
});

trap('Inverse Universe', 'normal', {
  text: 'Switch the ATK/DEF of all face-up Effect Monsters on the field.',
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => c.hasType('effect')).length > 0,
      resolve: async (ctx) => {
        const g = ctx.game;
        for (const c of ctx.faceUpMonsters('both', (m) => m.hasType('effect'))) {
          const a = g.getAtk(c);
          const d = g.getDef(c);
          c.flags.baseAtk = d - g.queryCardNum(c, 'atk');
          c.flags.baseDef = a - g.queryCardNum(c, 'def');
          delete c.flags.setAtk;
        }
        g.update();
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (b && b.inDamageStep && b.target) {
            const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
            const theirs = mine === b.attacker ? b.target : b.attacker;
            const swap = (c: C, stat: 'atk' | 'def') => (c.hasType('effect') ? (stat === 'atk' ? ctx.def(c) : ctx.atk(c)) : stat === 'atk' ? ctx.atk(c) : ctx.def(c));
            const now = (c: C) => (c.pos === 'atk' ? ctx.atk(c) : ctx.def(c));
            const after = (c: C) => (c.pos === 'atk' ? swap(c, 'atk') : swap(c, 'def'));
            const winsNow = mine === b.attacker ? ctx.atk(mine) > now(theirs) : now(mine) >= ctx.atk(theirs);
            const winsAfter = mine === b.attacker ? swap(mine, 'atk') > after(theirs) : after(mine) >= swap(theirs, 'atk');
            return !winsNow && winsAfter ? 80 : 0;
          }
          return 0;
        },
      },
    },
  ],
});

trap('Evil Blast', 'normal', {
  text: "Activate only when a monster is Special Summoned to your opponent's side of the field. Equip this card to that monster. It gains 500 ATK. During each of your opponent's Standby Phases, inflict 500 damage to your opponent.",
  effects: [
    {
      kind: 'activate',
      event: 'specialSummoned',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.controller === ctx.opp && c.location === 'mzone' && c.faceUp;
      },
      activate: async (ctx) => {
        const summoned = ctx.game.recentEvents.filter((e) => e.type === 'specialSummoned').map((e) => e.card as C).filter((c) => c.controller === ctx.opp && c.location === 'mzone' && c.faceUp);
        const [t] = await ctx.select([...new Set(summoned)], 1, 1, 'Select the monster to equip Evil Blast to.', 'generic', { aiScore: (c) => -ctx.atk(c) });
        if (t) ctx.addTargets([t]);
      },
      resolve: async (ctx) => {
        const t = ctx.validTargets((c) => c.location === 'mzone' && c.faceUp)[0];
        if (!t || !ctx.self.onField) return;
        ctx.equip(t);
        ctx.self.flags.staysOnField = true;
        ctx.self.activeOnField = true;
      },
      ai: { score: (ctx) => (ctx.oppLp <= 3000 ? 40 : 0) },
    },
    { kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: equipped, value: 500 }] },
    {
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Inflict 500 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && !ctx.isMyTurn && stActive(ctx) && !!ctx.equipTarget,
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500);
      },
    },
  ],
});

export const ABPF_LOADED = true;
