// Crossroads of Chaos (CSOC, TCG November 2008): every card of the set that no other set file defines.
// Card type, Attribute, Level, ATK/DEF: YGOJSON v1 aggregate (github.com/iconmaster5326/YGOJSON); card text uses the
// 2008–2010 TCG wording. Effects follow the 2010 TCG rulings as far as the engine allows. Approximations are marked "APPROX:".
//
// Already scripted elsewhere: Copy Plant, Nettles, Tytannial, Princess of Camellias, Plaguespreader Zombie, Turbo Warrior,
// Black Rose Dragon, Iron Chain Dragon, Doomkaiser Dragon, Gladiator Beast Retiari, Tempest Magician.
//
// No engine change. Hooks reused: EffectDef.replaceDestroy (ANPR), EffectDef.replaceDestroyOne (ABPF), the
// `mustBeAttacked` / `untargetable` / `extraAttacks` query keys, Game.link (Miracle Fertilizer) and the monster-as-Equip
// technique of abpf.ts. Game rules the engine has no hook for are installed per game by `ensureCsocPatches`
// (the technique of lodt.ts):
//  * events (Game.emit): Ivy Token / Horseytail Token effects (Tokens have left the field when they would trigger),
//    Revived King Ha Des (drops the triggers of monsters it negates), direct-attack bookkeeping (Confusion Chaff),
//    Machine Lord Ür's attacked monsters, Defense Position monsters destroyed this turn (Lineage of Destruction);
//  * battle damage: Machine Lord Ür (no battle damage to the opponent);
//  * attacks: Morphtronic Magnen (only the highest ATK monster), Machine Lord Ür (attack every monster once);
//  * activations: Cursed Fig (locked Set cards), Revived King Ha Des (negated monsters in the GY);
//  * Summon legality: Overdrive Teleporter (cannot be Special Summoned), Rai-Jin (only 1 face-up), Gozen Match;
//  * state checks after every move / action: Zombie Mammoth, Gozen Match, Mark of the Rose (control returns);
//  * control: Botanical Lion; chains: Urgent Tuning (the Synchro Summon right after the Chain resolves);
//  * Battle Mania: the forced monsters must attack (the controllers' "leave the Battle Phase" choice is withheld).
import { monster, spell, token, trap } from '../define';
import { bestTarget, cardValue } from '../helpers';
import type { CardData, CardInstance, EffectDef } from '../../engine/card';
import { faceUpFlag } from '../../engine/card';
import type { Ctx } from '../../engine/ctx';
import type { Action, PlayerController } from '../../engine/controller';
import type { ChainLink, Game } from '../../engine/game';
import type { Attribute, BattlePos, GameEvent, Location, PlayerId, Race, Reason } from '../../engine/types';
import { QUESTION_ATK } from './sovr';

type C = CardInstance;

// ============================================================ names

const IVY_TOKEN_NAME = 'Ivy Token';
const HORSEY_TOKEN_NAME = 'Horseytail Token';
const MAGNEN = 'Morphtronic Magnen';
const UR = 'Machine Lord Ür';
const HA_DES = 'Revived King Ha Des';
const CURSED_FIG = 'Cursed Fig';
const OVERDRIVE = 'Overdrive Teleporter';
const RAI_JIN = 'Rai-Jin';
const MAMMOTH = 'Zombie Mammoth';
const GOZEN = 'Gozen Match';
const LION = 'Botanical Lion';
const GARDEN = 'Black Garden';

// ============================================================ shared helpers

const ALL_LOCS: Location[] = ['deck', 'hand', 'mzone', 'szone', 'fzone', 'grave', 'banished', 'extra'];
const ATTRS: Attribute[] = ['DARK', 'LIGHT', 'EARTH', 'WATER', 'FIRE', 'WIND'];
const evc = (ev: GameEvent) => ev.card as C | undefined;
const evo = (ev: GameEvent) => ev.other as C | undefined;
const reasonsOf = (ev: GameEvent): Reason[] => ev.reasons ?? (ev.reason ? [ev.reason] : []);
const fromField = (ev: GameEvent) => ev.from === 'mzone' || ev.from === 'szone' || ev.from === 'fzone';
const faceUpOn = (c: C) => c.location === 'mzone' && c.faceUp;
const lvl = (c: C) => c.data.level ?? 0;
const raceIs = (c: C, r: Race) => c.isMonster && c.data.race === r;
const attrIs = (c: C, a: Attribute) => c.isMonster && c.data.attribute === a;
/** This monster is face-up on the field and not negated. */
const monActive = (ctx: Ctx) => faceUpOn(ctx.self) && !ctx.game.isNegated(ctx.self);
/** This Continuous/Field/Equip card is face-up, has resolved and is not negated. */
const stActive = (ctx: Ctx) => ctx.self.onField && ctx.self.faceUp && ctx.self.activeOnField && !ctx.game.isNegated(ctx.self);
const isMain = (ctx: Ctx) => ctx.phase === 'main1' || ctx.phase === 'main2';
const isAi = (g: Game, p: PlayerId) => !g.controllers[p].isHuman;
const cantAdd = (ctx: Ctx) => ctx.game.queryPlayer(ctx.player, 'cannotAddFromDeck');

const isMorph = (c: C) => c.inSet('morphtronic') || c.name.startsWith('Morphtronic');
const isMorphMon = (c: C) => c.isMonster && isMorph(c);
const isIronChain = (c: C) => c.isMonster && (c.inSet('iron-chain') || c.name.startsWith('Iron Chain'));
const isPlant = (c: C) => raceIs(c, 'Plant');
const isPsychic = (c: C) => raceIs(c, 'Psychic');
const isZombie = (c: C) => raceIs(c, 'Zombie');
const isNeosFamily = (c: C) =>
  c.isMonster &&
  (c.inSet('hero') || c.inSet('neo-spacian') || /\bHERO\b/.test(c.name) || c.name.startsWith('Neo-Spacian') || /\bNeos\b/.test(c.name) || c.name.includes('Neo Space'));
const isNeos = (c: C) => c.isMonster && (/\bNeos\b/.test(c.name) || c.name.includes('Neo Space'));
const isNeoSpacian = (c: C) => c.isMonster && (c.inSet('neo-spacian') || c.name.startsWith('Neo-Spacian'));
const isHero = (c: C) => c.isMonster && (c.inSet('hero') || /\bHERO\b/i.test(c.name));

const MORPH = ['morphtronic'];
const IRON_CHAIN = ['iron-chain'];

/** Events since the start of the current turn's Draw Phase. */
function turnEvents(g: Game): GameEvent[] {
  const log = g.eventLog;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.type === 'phaseStart' && e.phase === 'draw') return log.slice(i);
  }
  return log;
}

const tributable = (ctx: Ctx, f: (c: C) => boolean = () => true) => ctx.monsters('me', (c) => !ctx.query(c, 'cannotBeTributed') && f(c));
/** Tribute cards as a cost (not for a Tribute Summon). */
async function tributeCost(ctx: Ctx, cards: C[]) {
  if (!cards.length) return [];
  ctx.log(`${ctx.game.players[ctx.player].name} Tributes ${cards.map((c) => c.name).join(', ')}.`);
  return ctx.game.moveCards(cards, 'grave', { reason: 'tribute', reasons: ['tribute', 'cost'], reasonPlayer: ctx.player, reasonCard: ctx.self });
}

async function reveal(ctx: Ctx, cards: C[]) {
  if (!cards.length) return;
  for (const c of cards) c.revealedUntil = ctx.turn;
  ctx.log(`${ctx.game.players[cards[0].owner].name} reveals ${cards.map((c) => c.name).join(', ')}.`);
  await ctx.game.anim({ type: 'reveal', cards: cards.map((c) => c.uid), player: cards[0].owner });
}

/** Monster battling `self` in the current battle. */
function battleOpponent(ctx: Ctx, self: C = ctx.self): C | null {
  const b = ctx.battle;
  if (!b) return null;
  if (b.attacker === self) return b.target;
  if (b.target === self) return b.attacker;
  return null;
}

/** Special Summon a token to the field of `controller` (the summoning player is ctx.player). */
async function tokensTo(ctx: Ctx, data: CardData, n: number, pos: BattlePos, controller: PlayerId) {
  if (ctx.game.queryPlayer(ctx.player, 'cannotSpecialSummon')) return [] as C[];
  return ctx.game.createTokens(ctx.player, data, n, pos, controller);
}

/** Cards of `name` face-up and applying on the field. */
function liveCards(g: Game, name: string, p?: PlayerId): C[] {
  return g
    .allFieldCards()
    .filter((c) => c.name === name && c.faceUp && (c.isMonster ? c.location === 'mzone' : c.activeOnField) && (p === undefined || c.controller === p) && !g.isNegated(c));
}

/** Expected battle damage `p` takes in the current battle (AI hint). */
function expectedBattleDamage(g: Game, p: PlayerId): number {
  const b = g.battle;
  if (!b) return 0;
  const a = b.attacker;
  const t = b.target;
  const atkA = g.getAtk(a);
  if (!t) return a.controller !== p ? atkA : 0;
  if (t.pos === 'atk') {
    const atkT = g.getAtk(t);
    if (atkA > atkT && t.controller === p) return atkA - atkT;
    if (atkT > atkA && a.controller === p) return atkT - atkA;
    return 0;
  }
  const defT = g.getDef(t);
  if (defT > atkA && a.controller === p) return defT - atkA;
  return 0;
}

async function rollDie(ctx: Ctx) {
  const r = ctx.game.rng.int(6) + 1;
  ctx.log(`${ctx.self.name}: die roll — ${r}.`);
  return r;
}

/** Put a monster into its controller's Spell & Trap Zone as an Equip Card for `host` (abpf.ts technique). */
function equipMonster(ctx: Ctx, card: C, host: C, controller: PlayerId) {
  if (ctx.game.freeSZones(controller) <= 0) return false;
  ctx.game.rawMove(card, 'szone', { controller, faceUp: true });
  card.activeOnField = true;
  ctx.game.equip(card, host);
  ctx.game.update();
  return true;
}

// ============================================================ tokens

const IVY_TOKEN = token(IVY_TOKEN_NAME, 'EARTH', 'Plant', 1, 0, 0, 'When this Token is destroyed, its controller takes 300 damage.');
const HORSEY_TOKEN = token(HORSEY_TOKEN_NAME, 'WIND', 'Plant', 1, 0, 0, 'When this Token is destroyed by battle with a Plant-Type monster, its controller sends 1 card from their hand to the Graveyard.');
const ROSE_TOKEN = token('Rose Token', 'DARK', 'Plant', 2, 800, 800);
const SEED_TOKEN = token('Seed Token', 'EARTH', 'Plant', 1, 0, 0, 'This Token cannot be Tributed for a Tribute Summon.');
const NEEDLE_TOKEN = token('Needle Token', 'EARTH', 'Plant', 1, 500, 500);
const FIREBALL_TOKEN = token('Fireball Token', 'FIRE', 'Pyro', 1, 100, 100);
const GIFT_FIEND_TOKEN = token('Gift Fiend Token', 'DARK', 'Fiend', 3, 1500, 1500);
const PLANT_TOKEN = token('Plant Token', 'EARTH', 'Plant', 1, 800, 500);

/** Effects of Tokens that resolve after the Token has left the field (queued by the Game.emit patch). */
const IVY_TOKEN_EFFECT: EffectDef = {
  kind: 'trigger',
  mandatory: true,
  label: 'Ivy Token: 300 damage',
  categories: ['damage'],
  // https://edisonrul.ing/cards/w/wall-of-ivy.html — "'Ivy Token's' effect to inflict damage does not start a Chain."
  noChain: true,
  resolve: async (ctx) => {
    await ctx.game.damage(ctx.player, 300, 'effect', ctx.self, ctx.player);
  },
};
const HORSEY_TOKEN_EFFECT: EffectDef = {
  kind: 'trigger',
  mandatory: true,
  label: 'Horseytail Token: send 1 card from the hand',
  categories: ['discard'],
  // https://edisonrul.ing/cards/h/horseytail.html — "Sending 1 card from your hand to the Graveyard when 'Horseytail
  // Token' is destroyed by battle with a Plant-Type monster does not start a Chain."
  noChain: true,
  resolve: async (ctx) => {
    const hand = ctx.hand('me');
    if (!hand.length) return;
    const [c] = await ctx.select(hand, 1, 1, 'Send 1 card from your hand to the Graveyard.', 'toGrave', { aiScore: (x) => -cardValue(ctx.game, x) });
    if (c) await ctx.sendToGrave(c);
  },
};

// ============================================================ per-game rule patches

interface CsocGameState {
  /** Black Garden is Summoning its Rose Tokens (those Summons do not trigger it). */
  gardenBusy: number;
  /** Urgent Tuning: Synchro Summon right after the Chain resolves. */
  urgent: PlayerId[];
  /** Urgent Tuning's Synchro Summon is being performed (no summon-negation window). */
  urgentSummoning?: boolean;
  /** Battle Mania: player p's listed monsters must attack during turn `turn`. */
  mania: { p: PlayerId; turn: number; uids: Set<number> }[];
  /** Mark of the Rose: control taken while equipped. */
  marks: { mark: C; markMoveId: number; host: C; hostMoveId: number }[];
  checking: boolean;
}
const GSTATE = new WeakMap<Game, CsocGameState>();
function gs(g: Game): CsocGameState {
  let s = GSTATE.get(g);
  if (!s) GSTATE.set(g, (s = { gardenBusy: 0, urgent: [], mania: [], marks: [], checking: false }));
  return s;
}

/** Machine Lord Ür applies its effects. */
const urActive = (g: Game, c: C | null | undefined) => !!c && c.name === UR && faceUpOn(c) && !g.isNegated(c);
function urHit(g: Game, c: C): Set<number> {
  const h = c.flags.csocUrHit as { turn: number; uids: Set<number> } | undefined;
  return h && h.turn === g.turn ? h.uids : new Set();
}
/** Cursed Fig in a GY locks this Set Spell/Trap. */
function figLocked(g: Game, card: C) {
  if (!card.onField || card.faceUp || card.isMonster) return false;
  for (const p of [0, 1] as PlayerId[]) {
    for (const f of g.players[p].grave) {
      if (f.name !== CURSED_FIG) continue;
      const locks = (f.flags.figLocks ?? []) as { uid: number; moveId: number }[];
      if (locks.some((l) => l.uid === card.uid && l.moveId === card.moveId)) return true;
    }
  }
  return false;
}
const hadesNegated = (g: Game, c: C) => c.location === 'grave' && c.flags.hadesNeg === g.turn;
/** Attribute player p is locked to by Gozen Match (the Attribute of its face-up monsters), or null. */
function gozenAttr(g: Game, p: PlayerId): Attribute | null {
  if (!liveCards(g, GOZEN).length) return null;
  const a = g.faceUpMonsters(p).map((c) => c.data.attribute as Attribute);
  return a.length ? a[0] : null;
}
const raiJinBlocks = (g: Game, c: C) => c.name === RAI_JIN && g.allFieldCards().some((x) => x !== c && x.name === RAI_JIN && faceUpOn(x));
function summonBlocked(g: Game, c: C, ctrl: PlayerId, faceUp: boolean, skipGozen = false) {
  if (c.name === OVERDRIVE) return true;
  if (faceUp && raiJinBlocks(g, c)) return true;
  if (skipGozen) return false;
  const a = gozenAttr(g, ctrl);
  if (faceUp && a && c.data.attribute !== a) return true;
  return false;
}

/** State checks run after every move and action. */
async function stateChecks(g: Game) {
  const s = gs(g);
  if (s.checking || g.over) return;
  s.checking = true;
  try {
    // Zombie Mammoth: destroyed if its controller has no Zombie-Type monster in the GY.
    for (const m of [...g.monsters(0), ...g.monsters(1)]) {
      if (m.name !== MAMMOTH || !faceUpOn(m) || g.isNegated(m)) continue;
      if (!g.players[m.controller].grave.some(isZombie)) {
        g.log(`${m.name} is destroyed (no Zombie-Type monster in the Graveyard).`, 'action', m.controller);
        await g.destroy([m], 'effect', m.controller, m);
      }
    }
    // Gozen Match: each player can only control 1 Attribute of face-up monsters.
    if (liveCards(g, GOZEN).length) {
      for (const p of [0, 1] as PlayerId[]) {
        const mons = g.faceUpMonsters(p);
        const attrs = [...new Set(mons.map((c) => c.data.attribute as Attribute))];
        if (attrs.length <= 1) continue;
        const val = (a: Attribute) => mons.filter((c) => c.data.attribute === a).reduce((t, c) => t + cardValue(g, c), 0);
        const i = await g.option(p, 'Gozen Match: choose the Attribute to keep.', attrs, liveCards(g, GOZEN)[0], (k) => val(attrs[k]));
        const keep = attrs[i] ?? attrs[0];
        const out = mons.filter((c) => c.data.attribute !== keep);
        g.log(`Gozen Match: ${g.players[p].name} keeps ${keep} monsters.`, 'action', p);
        await g.sendToGrave(out, 'effect', p, liveCards(g, GOZEN)[0]);
      }
    }
    // Mark of the Rose: when it leaves the field, control of the monster returns.
    for (const r of [...s.marks]) {
      const markGone = !r.mark.onField || r.mark.moveId !== r.markMoveId;
      const hostGone = r.host.location !== 'mzone' || r.host.moveId !== r.hostMoveId;
      if (hostGone) {
        s.marks.splice(s.marks.indexOf(r), 1);
        continue;
      }
      if (markGone) {
        s.marks.splice(s.marks.indexOf(r), 1);
        if (r.host.controller !== r.host.owner) await g.returnControl(r.host);
      }
    }
  } finally {
    s.checking = false;
  }
}

/** Battle Mania: withhold "leave the Battle Phase" while a forced monster can still attack. */
function maniaFilter(g: Game, p: PlayerId, acts: Action[]): Action[] {
  const st = GSTATE.get(g);
  if (!st || g.phase !== 'battle') return acts;
  const m = st.mania.find((x) => x.p === p && x.turn === g.turn);
  if (!m) return acts;
  const forced = acts.some((a) => a.type === 'attack' && m.uids.has(a.card.uid));
  return forced ? acts.filter((a) => a.type !== 'phase') : acts;
}
const WRAPPED_CTRL = new WeakSet<PlayerController>();

const PATCHED = new WeakSet<Game>();
export function ensureCsocPatches(g: Game) {
  if (PATCHED.has(g)) return;
  PATCHED.add(g);
  const anyG = g as any;

  // ---- events
  const origEmit = g.emit.bind(g);
  anyG.emit = (ev: Omit<GameEvent, 'seq' | 'batch'>) => {
    const full = origEmit(ev);
    onEvent(g, full);
    return full;
  };

  // ---- battle damage: Machine Lord Ür
  const origDamage = g.damage.bind(g);
  anyG.damage = async (p: PlayerId, amount: number, kind: 'battle' | 'effect', source?: C, sourcePlayer?: PlayerId) => {
    if (kind === 'battle' && amount > 0 && g.battle) {
      const b = g.battle;
      for (const u of [b.attacker, b.target]) {
        if (u && urActive(g, u) && u.controller !== p) {
          g.log(`${p === 0 || p === 1 ? g.players[p].name : ''} takes no battle damage (${UR}).`, 'battle', p);
          return 0;
        }
      }
    }
    return origDamage(p, amount, kind, source, sourcePlayer);
  };

  // ---- attacks: Morphtronic Magnen, Machine Lord Ür
  const origAT = g.attackTargets.bind(g);
  anyG.attackTargets = (attacker: C) => {
    const r = origAT(attacker);
    if (attacker.name === MAGNEN && faceUpOn(attacker) && attacker.pos === 'atk' && !g.isNegated(attacker)) {
      const ups = g.faceUpMonsters(g.opp(attacker.controller));
      if (ups.length) {
        const best = Math.max(...ups.map((c) => g.getAtk(c)));
        r.targets = r.targets.filter((t) => t.faceUp && g.getAtk(t) === best);
        r.direct = false;
      }
    }
    if (urActive(g, attacker) && attacker.attacksThisTurn >= 1) {
      const hit = urHit(g, attacker);
      r.targets = r.targets.filter((t) => !hit.has(t.uid));
      r.direct = false;
    }
    return r;
  };
  const origCanAttack = g.canAttack.bind(g);
  anyG.canAttack = (c: C) => {
    if (origCanAttack(c)) return true;
    if (!urActive(g, c) || c.pos !== 'atk' || c.controller !== g.turnPlayer || c.attacksThisTurn < 1) return false;
    if (g.queryCard(c, 'cannotAttack') || c.flags.cannotAttackTurn === g.turn) return false;
    const hit = urHit(g, c);
    return g.monsters(g.opp(c.controller)).some((m) => !hit.has(m.uid) && !g.queryCard(m, 'cannotBeAttacked'));
  };

  // ---- activations: Cursed Fig, Revived King Ha Des
  const blocked = (card: C, ef: EffectDef) => {
    if (ef.kind === 'continuous' || ef.kind === 'proc') return false;
    if (figLocked(g, card) && ef.kind === 'activate') return true;
    if (card.isMonster && hadesNegated(g, card)) return true;
    return false;
  };
  const origCAE = g.canActivateEffect.bind(g);
  anyG.canActivateEffect = (player: PlayerId, card: C, ef: EffectDef, idx: number, mode: any) => {
    if (blocked(card, ef)) return null;
    return origCAE(player, card, ef, idx, mode);
  };

  // ---- Summon legality
  const origCanNS = g.canNormalSummon.bind(g);
  anyG.canNormalSummon = (p: PlayerId, card: C, set = false) => {
    if (!origCanNS(p, card, set)) return false;
    if (set || card.name === OVERDRIVE || !summonBlocked(g, card, p, true)) return true;
    if (summonBlocked(g, card, p, true, true)) return false;
    // Gozen Match, 2010 ruling: you can Tribute Summon a monster of any Attribute by Tributing your face-up monster(s)
    // of the other Attribute. https://edisonrul.ing/cards/g/gozen-match.html
    const need = g.tributesNeeded(card);
    if (need <= 0) return false;
    const trib = g.tributeCandidates(p, card);
    const others = g.faceUpMonsters(p).filter((m) => m.data.attribute !== card.data.attribute);
    return trib.length >= need && others.length <= need && others.every((m) => trib.includes(m));
  };
  const origSS = g.specialSummon.bind(g);
  anyG.specialSummon = async (cards: C[], player: PlayerId, opts: Parameters<Game['specialSummon']>[2] = {}) => {
    const ctrl = opts?.controller ?? player;
    const list: C[] = [];
    for (const c of cards) {
      if (summonBlocked(g, c, ctrl, !opts?.faceDown)) continue;
      // Gozen Match: monsters Summoned together must share one Attribute as well.
      if (liveCards(g, GOZEN).length && !opts?.faceDown && list.length && c.data.attribute !== list[0].data.attribute) continue;
      list.push(c);
    }
    if (!list.length) return [];
    return origSS(list, player, opts);
  };
  const origISS = g.inherentSpecialSummon.bind(g);
  anyG.inherentSpecialSummon = async (p: PlayerId, card: C, ...rest: any[]) => {
    if (summonBlocked(g, card, p, true)) return false;
    return (origISS as any)(p, card, ...rest);
  };
  // Gozen Match: only material combinations that leave face-up monsters of the Synchro Monster's Attribute (or none),
  // so the Synchro Summon never ends with 2 Attributes (it was summoned, then sent to the GY by the state check).
  const origCombos = g.synchroCombos.bind(g);
  anyG.synchroCombos = (p: PlayerId, syn: C, mustInclude?: C) => {
    const combos = origCombos(p, syn, mustInclude);
    if (!liveCards(g, GOZEN).length) return combos;
    return combos.filter((combo) => g.faceUpMonsters(p).every((m) => combo.includes(m) || m.data.attribute === syn.data.attribute));
  };
  const origCanSyn = g.canSynchro.bind(g);
  // (Gozen Match is checked per material combination by synchroCombos above.)
  anyG.canSynchro = (p: PlayerId, syn: C) => origCanSyn(p, syn) && !summonBlocked(g, syn, p, true, true);
  const origLMA = g.legalMainActions.bind(g);
  anyG.legalMainActions = (p: PlayerId) =>
    origLMA(p).filter((a: Action) => {
      if (a.type === 'flip' || a.type === 'proc') return !summonBlocked(g, a.card, p, true);
      return true;
    });

  // ---- state checks
  const origRC = g.ruleCleanup.bind(g);
  anyG.ruleCleanup = async () => {
    await origRC();
    await stateChecks(g);
  };
  const origPA = g.performAction.bind(g);
  anyG.performAction = async (p: PlayerId, a: Action) => {
    await origPA(p, a);
    await stateChecks(g);
  };

  // ---- control: Botanical Lion
  const origTC = g.takeControl.bind(g);
  anyG.takeControl = async (card: C, player: PlayerId, untilEndPhase = false) => {
    if (card.name === LION && faceUpOn(card) && !g.isNegated(card)) {
      g.log(`Control of ${card.name} cannot switch.`, 'action', card.controller);
      return false;
    }
    return origTC(card, player, untilEndPhase);
  };

  // ---- chains: Urgent Tuning
  const origRes = g.resolveChain.bind(g);
  anyG.resolveChain = async () => {
    await origRes();
    const s = gs(g);
    while (s.urgent.length && !g.over) {
      const p = s.urgent.shift()!;
      const cands = g.players[p].extra.filter((c) => g.canSynchro(p, c));
      if (!cands.length) continue;
      const [syn] = await g.select(p, cands, 1, 1, 'Urgent Tuning: Synchro Summon 1 Synchro Monster.', 'specialSummon', {
        aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
      });
      if (!syn) continue;
      s.urgentSummoning = true;
      try {
        await g.synchroSummon(p, syn);
      } finally {
        s.urgentSummoning = false;
      }
    }
  };
  // 2010 ruling: the Synchro Summon is part of Urgent Tuning's resolution, so "Solemn Judgment" cannot negate it.
  // https://edisonrul.ing/cards/u/urgent-tuning.html
  const origSNW = g.summonNegationWindow.bind(g);
  anyG.summonNegationWindow = async (cards: C[], p: PlayerId, method: string) => (gs(g).urgentSummoning ? false : origSNW(cards, p, method));

  // ---- Battle Mania: forced attacks
  for (const ctrl of g.controllers) {
    if (WRAPPED_CTRL.has(ctrl)) continue;
    WRAPPED_CTRL.add(ctrl);
    const orig = ctrl.chooseAction.bind(ctrl);
    ctrl.chooseAction = (game: Game, p: PlayerId, acts: Action[]) => orig(game, p, maniaFilter(game, p, acts));
  }
}

/** Game.emit patch body. */
function onEvent(g: Game, ev: GameEvent) {
  const c = evc(ev);
  // Token effects (the Token has already left the field).
  if (ev.type === 'destroyed' && c?.isToken) {
    const ctrl = (ev.fromController ?? c.controller) as PlayerId;
    if (c.name === IVY_TOKEN_NAME) g.pending.push({ card: c, effect: IVY_TOKEN_EFFECT, effectIndex: 0, event: ev, player: ctrl });
    if (c.name === HORSEY_TOKEN_NAME && reasonsOf(ev).includes('battle')) {
      const by = evo(ev);
      if (by && isPlant(by)) g.pending.push({ card: c, effect: HORSEY_TOKEN_EFFECT, effectIndex: 0, event: ev, player: ctrl });
    }
  }
  // Revived King Ha Des: Effect Monsters destroyed by battle with your Zombie-Type monsters have their effects negated.
  if (ev.type === 'battleDestroyed' && c && c.hasType('effect')) {
    const by = evo(ev);
    if (by && by.location === 'mzone' && isZombie(by) && by.controller !== ev.fromController && liveCards(g, HA_DES, by.controller).length) {
      c.flags.hadesNeg = g.turn;
      g.log(`${c.name}'s effects are negated (${HA_DES}).`, 'action', by.controller);
    }
  }
  if (g.pending.length) g.pending = g.pending.filter((t) => !(t.card.isMonster && hadesNegated(g, t.card)));
  // Direct attacks this turn (Confusion Chaff) and Machine Lord Ür's attacked monsters.
  if (ev.type === 'attackDeclared' && c) {
    const t = evo(ev);
    if (!t) ((g.turnData['csoc:direct'] ??= []) as { card: C; moveId: number }[]).push({ card: c, moveId: c.moveId });
    if (c.name === UR && t) {
      const h = c.flags.csocUrHit as { turn: number; uids: Set<number> } | undefined;
      if (!h || h.turn !== g.turn) c.flags.csocUrHit = { turn: g.turn, uids: new Set([t.uid]) };
      else h.uids.add(t.uid);
    }
  }
  // Defense Position monsters destroyed this turn (Lineage of Destruction).
  if (ev.type === 'destroyed' && c && ev.from === 'mzone' && c.pos === 'def') {
    ((g.turnData['csoc:defKills'] ??= []) as { by?: PlayerId; ctrl?: PlayerId }[]).push({ by: ev.reasonPlayer, ctrl: ev.fromController });
  }
}

/** Installs the per-game patches at the first phase (from any location, never activates). */
const PATCH_LISTENER: EffectDef = {
  kind: 'trigger',
  event: 'phaseStart',
  range: ALL_LOCS,
  eventFilter: (ctx) => {
    ensureCsocPatches(ctx.game);
    return false;
  },
};

type MonsterOpts = Parameters<typeof monster>[1];
type STOpts = Parameters<typeof spell>[2];
/** Define a card of this set (adds the patch installer). */
const M = (name: string, o: MonsterOpts) => monster(name, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });
const S = (name: string, t: Parameters<typeof spell>[1], o: STOpts) => spell(name, t, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });
const T = (name: string, t: Parameters<typeof trap>[1], o: STOpts) => trap(name, t, { ...o, effects: [...(o.effects ?? []), PATCH_LISTENER] });

// ============================================================ MONSTERS

M('Rose, Warrior of Revenge', {
  attribute: 'FIRE',
  race: 'Warrior',
  level: 4,
  atk: 1600,
  def: 600,
  types: ['tuner'],
  aiValue: 300,
  text: "When this card inflicts Battle Damage to your opponent's Life Points, inflict 300 damage to your opponent's Life Points.",
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      mandatory: true,
      label: '300 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp && ctx.self.location === 'mzone',
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 300);
      },
    },
  ],
});

M('Healing Wave Generator', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 4,
  atk: 800,
  def: 1600,
  aiValue: 100,
  text: "Once per turn, you can select another face-up monster you control to gain Life Points equal to that monster's Level x 100.",
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Gain LP (Level x 100)',
      categories: ['recover'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => c !== ctx.self), 1, 1, 'Select another face-up monster you control.', 'target', {
          aiScore: (c) => ctx.level(c),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        if (t) await ctx.recover(ctx.player, ctx.level(t) * 100);
      },
      ai: { score: () => 20 },
    },
  ],
});

M('Turbo Synchron', {
  attribute: 'WIND',
  race: 'Machine',
  level: 1,
  atk: 100,
  def: 500,
  types: ['tuner'],
  sets: ['synchron'],
  aiValue: 400,
  text: 'When this card declares an attack, you can change the attack target to Defense Position. When you take Battle Damage from a battle involving this attacking card, you can Special Summon 1 monster from your hand whose ATK is less than or equal to the Battle Damage you took.',
  effects: [
    {
      kind: 'trigger',
      event: 'attackDeclared',
      when: true,
      label: 'Change the attack target to Defense Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && !!evo(ev) && faceUpOn(evo(ev)!) && evo(ev)!.pos === 'atk',
      resolve: async (ctx) => {
        const t = ctx.battle?.target;
        if (t && faceUpOn(t) && t.pos === 'atk' && ctx.battle?.attacker === ctx.self) await ctx.changePos(t, 'def');
      },
    },
    {
      kind: 'trigger',
      event: 'battleDamage',
      when: true,
      label: 'Special Summon a monster from your hand',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.player === ctx.player && ctx.battle?.attacker === ctx.self && ctx.self.controller === ctx.player,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => c.isMonster && (c.data.atk ?? 0) <= (ctx.event?.amount ?? 0) && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => c.isMonster && (c.data.atk ?? 0) <= (ctx.event?.amount ?? 0) && ctx.canSummonCard(c));
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 monster from your hand.', 'specialSummon', { aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0) });
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
    },
  ],
});

M('Mad Archfiend', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 4,
  atk: 1800,
  def: 0,
  aiValue: 100,
  text: 'During battle between this attacking card and a Defense Position monster whose DEF is lower than the ATK of this card, inflict the difference as Battle Damage to your opponent. When this face-up Attack Position card is selected as an attack target, change it to Defense Position.',
  effects: [
    { kind: 'continuous', mods: [{ q: 'piercing' }] },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      mandatory: true,
      label: 'Change to Defense Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && faceUpOn(ctx.self) && ctx.self.pos === 'atk',
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self) && ctx.self.pos === 'atk') await ctx.changePos(ctx.self, 'def');
      },
    },
  ],
});

M('Wall of Ivy', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 2,
  atk: 300,
  def: 1200,
  types: ['flip'],
  aiValue: 100,
  text: 'FLIP: Special Summon 1 "Ivy Token" (Plant-Type/EARTH/Level 1/ATK 0/DEF 0) in Defense Position on your opponent\'s side of the field. When this Token is destroyed, its controller takes 300 damage.',
  effects: [
    {
      kind: 'trigger',
      event: 'flipped',
      mandatory: true,
      label: 'Ivy Token',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'mzone',
      resolve: async (ctx) => {
        if (ctx.freeMZones('opp') > 0) await tokensTo(ctx, IVY_TOKEN, 1, 'def', ctx.opp);
      },
    },
  ],
});

// ---------------------------------------------------------------- Morphtronic

M('Morphtronic Celfon', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 1,
  atk: 100,
  def: 100,
  sets: MORPH,
  aiValue: 300,
  text: '● While in Attack Position: Once per turn, you can roll a six-sided die. Reveal cards from top of your Deck equal to the roll and Special Summon 1 Level 4 or lower "Morphtronic" monster from among them, ignoring the Summoning conditions. Shuffle the rest into the Deck.\n● While in Defense Position: Once per turn, you can roll a six-sided die. Look at cards from top of your Deck equal to the roll, then return them in the same order.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: '(Attack) Roll a die: Special Summon a Morphtronic',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.self.pos === 'atk',
      // https://edisonrul.ing/cards/m/morphtronic-celfon.html — it cannot be activated if you cannot Special Summon, or
      // if there are no "Morphtronic" monsters left in your Deck.
      canActivate: (ctx) => ctx.deck().length > 0 && ctx.canSpecialSummon() && ctx.deck('me', isMorphMon).length > 0,
      resolve: async (ctx) => {
        const n = await rollDie(ctx);
        const deck = ctx.game.players[ctx.player].deck;
        const top = deck.slice(Math.max(0, deck.length - n)).reverse();
        await reveal(ctx, top);
        const cands = top.filter((c) => isMorphMon(c) && lvl(c) <= 4 && !c.isExtra);
        if (cands.length && ctx.canSpecialSummon()) {
          const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower "Morphtronic" monster.', 'specialSummon', { aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0) });
          if (c) await ctx.specialSummon(c, { pos: 'choose', ignoreConditions: true });
        }
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: (ctx) => (ctx.freeMZones() > 0 ? 35 : 0) },
    },
    {
      kind: 'ignition',
      opt: true,
      label: '(Defense) Roll a die: look at the top cards',
      condition: (ctx) => ctx.self.pos === 'def',
      canActivate: (ctx) => ctx.deck().length > 0,
      resolve: async (ctx) => {
        const n = await rollDie(ctx);
        const deck = ctx.game.players[ctx.player].deck;
        const top = deck.slice(Math.max(0, deck.length - n)).reverse();
        // APPROX: the cards are only counted in the log (the duel log is shared by both players).
        ctx.game.log(`${ctx.game.players[ctx.player].name} looks at the top ${top.length} card(s) of their Deck and returns them in the same order.`, 'action', ctx.player);
      },
      ai: { score: () => 5 },
    },
  ],
});

M(MAGNEN, {
  attribute: 'EARTH',
  race: 'Thunder',
  level: 3,
  atk: 800,
  def: 800,
  sets: MORPH,
  aiValue: 200,
  text: '● While in Attack Position: If your opponent controls a face-up monster, this card can only select their highest ATK monster as an attack target.\n● While in Defense Position: Your opponent cannot select another monster as an attack target.',
  effects: [
    // Attack Position: Game.attackTargets patch (ensureCsocPatches).
    { kind: 'continuous', active: (ctx) => ctx.self.pos === 'def', mods: [{ q: 'mustBeAttacked' }] },
  ],
});

M('Morphtronic Datatron', {
  attribute: 'FIRE',
  race: 'Pyro',
  level: 3,
  atk: 1200,
  def: 600,
  sets: MORPH,
  aiValue: 300,
  text: '● While in Attack Position: Once per turn, you can Tribute 1 monster to inflict 600 damage to your opponent.\n● While in Defense Position: Once per turn, you can inflict 300 damage to your opponent.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: '(Attack) Tribute 1 monster: 600 damage',
      categories: ['damage'],
      condition: (ctx) => ctx.self.pos === 'atk',
      canActivate: (ctx) => tributable(ctx).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx), 1, 1, 'Tribute 1 monster.', 'tribute', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 600);
      },
      ai: { score: (ctx) => (ctx.oppLp <= 600 ? 95 : tributable(ctx, (c) => c.isToken).length ? 30 : 0) },
    },
    {
      kind: 'ignition',
      opt: true,
      label: '(Defense) 300 damage',
      categories: ['damage'],
      condition: (ctx) => ctx.self.pos === 'def',
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 300);
      },
      ai: { score: () => 40 },
    },
  ],
});

M('Morphtronic Boomboxen', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1200,
  def: 400,
  sets: MORPH,
  aiValue: 300,
  text: '● While in Attack Position: This card can attack twice during each Battle Phase.\n● While in Defense Position: Once per turn, when a face-up "Morphtronic" monster you control is selected as an attack target, you can negate the attack.',
  effects: [
    { kind: 'continuous', active: (ctx) => ctx.self.pos === 'atk', mods: [{ q: 'extraAttacks', value: 1 }] },
    {
      kind: 'trigger',
      event: 'attackDeclared',
      when: true,
      opt: true,
      label: '(Defense) Negate the attack',
      categories: ['negateAttack'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && faceUpOn(ctx.self) && ctx.self.pos === 'def' && t.controller === ctx.player && faceUpOn(t) && isMorphMon(t);
      },
      condition: (ctx) => !!ctx.battle && !ctx.battle.negated,
      resolve: async (ctx) => {
        if (ctx.battle) ctx.negateAttack();
      },
    },
  ],
});

M('Morphtronic Cameran', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 2,
  atk: 800,
  def: 600,
  sets: MORPH,
  aiValue: 300,
  text: '● While in Attack Position: When this card is destroyed by battle, you can Special Summon 1 Level 4 or lower "Morphtronic" monster from your hand or Graveyard, except "Morphtronic Cameran".\n● While in Defense Position: "Morphtronic" monsters on the field cannot be targeted by effects.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Special Summon a Morphtronic',
      categories: ['specialSummon'],
      // The position it had when it was destroyed (the position is kept when it moves to the GY).
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.pos === 'atk' && !ctx.self.onField,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.cards('me', ['hand', 'grave'], (c) => isMorphMon(c) && lvl(c) <= 4 && c.name !== 'Morphtronic Cameran' && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.cards('me', ['hand', 'grave'], (c) => isMorphMon(c) && lvl(c) <= 4 && c.name !== 'Morphtronic Cameran' && ctx.canSummonCard(c));
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 4 or lower "Morphtronic" monster from your hand or Graveyard.', 'specialSummon', {
          aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0),
        });
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
    },
    {
      // "cannot be targeted by effects": either player's.
      kind: 'continuous',
      active: (ctx) => ctx.self.pos === 'def',
      mods: [{ q: 'untargetableByAll', to: 'cards', filter: (_ctx, c: C) => faceUpOn(c) && isMorphMon(c) }],
    },
  ],
});

M('Morphtronic Radion', {
  attribute: 'LIGHT',
  race: 'Thunder',
  level: 4,
  atk: 1000,
  def: 900,
  sets: MORPH,
  aiValue: 400,
  text: '● While in Attack Position: "Morphtronic" monsters you control gain 800 ATK.\n● While in Defense Position: "Morphtronic" monsters you control gain 1000 DEF.',
  effects: [
    {
      kind: 'continuous',
      active: (ctx) => ctx.self.pos === 'atk',
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.player && isMorphMon(c), value: 800 }],
    },
    {
      kind: 'continuous',
      active: (ctx) => ctx.self.pos === 'def',
      mods: [{ q: 'def', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.player && isMorphMon(c), value: 1000 }],
    },
  ],
});

M('Morphtronic Clocken', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 2,
  atk: 600,
  def: 1100,
  sets: MORPH,
  aiValue: 200,
  text: '● While in Attack Position: This card gains 500 ATK for each Morph Counter on it.\n● While in Defense Position: Once per turn, you can place 1 Morph Counter on this card. You can Tribute this card to inflict 1000 damage to your opponent for each Morph Counter on it.',
  effects: [
    { kind: 'continuous', active: (ctx) => ctx.self.pos === 'atk', mods: [{ q: 'atk', value: (ctx) => 500 * (ctx.self.counters.morph ?? 0) }] },
    {
      kind: 'ignition',
      opt: true,
      label: '(Defense) Place 1 Morph Counter',
      condition: (ctx) => ctx.self.pos === 'def',
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        ctx.self.counters.morph = (ctx.self.counters.morph ?? 0) + 1;
        ctx.log(`A Morph Counter is placed on ${ctx.self.name} (${ctx.self.counters.morph}).`);
      },
      ai: { score: () => 30 },
    },
    {
      kind: 'ignition',
      label: '(Defense) Tribute: 1000 damage per Morph Counter',
      categories: ['damage'],
      // 2010 ruling: the damage effect is one of its Defense Position effects. https://edisonrul.ing/cards/m/morphtronic-clocken.html
      condition: (ctx) => ctx.self.pos === 'def',
      canActivate: (ctx) => (ctx.self.counters.morph ?? 0) > 0 && !ctx.query(ctx.self, 'cannotBeTributed'),
      activate: async (ctx) => {
        ctx.data.n = ctx.self.counters.morph ?? 0;
        await tributeCost(ctx, [ctx.self]);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 1000 * (ctx.data.n ?? 0));
      },
      ai: { score: (ctx) => ((ctx.self.counters.morph ?? 0) * 1000 >= ctx.oppLp || (ctx.self.counters.morph ?? 0) >= 3 ? 80 : 0) },
    },
  ],
});

M('Gadget Hauler', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 6,
  atk: 1300,
  def: 0,
  aiValue: 100,
  text: 'Once per turn, you can send any number of "Morphtronic" monsters from your hand to the Graveyard to have this card gain 800 ATK for each.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Send Morphtronic monsters: +800 ATK each',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.hand('me', isMorphMon).length > 0,
      // 2010 rulings: sending the "Morphtronic" monsters is NOT a cost (done on resolution); a monster that is removed
      // from play instead ("Banisher of the Radiance") gives no ATK. https://edisonrul.ing/cards/g/gadget-hauler.html
      resolve: async (ctx) => {
        const cands = ctx.hand('me', isMorphMon);
        if (!cands.length) return;
        const sel = await ctx.select(cands, 1, cands.length, 'Send any number of "Morphtronic" monsters from your hand to the Graveyard.', 'toGrave');
        if (!sel.length) return;
        const sent = await ctx.sendToGrave(sel);
        const n = sent.filter((c) => c.location === 'grave').length;
        if (n && faceUpOn(ctx.self)) ctx.addTempMod(ctx.self, 'atk', 800 * n, 'field');
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && ctx.self.pos === 'atk' && ctx.hand('me', isMorphMon).length >= 2 ? 25 : 0) },
    },
  ],
});

M('Gadget Driver', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 1,
  atk: 200,
  def: 200,
  aiValue: 200,
  text: 'You can send this card from your hand to the Graveyard and select any number of face-up "Morphtronic" monsters you control. Change the battle position of the selected monster(s). This effect can be activated during either player\'s turn.',
  effects: [
    {
      kind: 'quick',
      range: ['hand'],
      label: 'Change the battle positions of Morphtronic monsters',
      categories: ['position'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isMorphMon(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.sendToGrave(ctx.self, 'cost');
        const cands = ctx.faceUpMonsters('me', isMorphMon);
        await ctx.selectTargets(cands, 1, cands.length, 'Select any number of face-up "Morphtronic" monsters you control.', 'position');
      },
      resolve: async (ctx) => {
        for (const t of ctx.validTargets((c) => faceUpOn(c) && c.controller === ctx.player)) await ctx.changePos(t, t.pos === 'atk' ? 'def' : 'atk');
      },
      ai: {
        score: (ctx) => {
          // Save a Morphtronic in Attack Position that is being attacked by a stronger monster.
          const b = ctx.battle;
          if (b && b.target && b.target.controller === ctx.player && isMorphMon(b.target) && b.target.pos === 'atk' && ctx.atk(b.attacker) > ctx.atk(b.target)) return 50;
          return 0;
        },
      },
    },
  ],
});

// ---------------------------------------------------------------- other monsters

/** "Changed to Defense Position at the end of the Battle Phase; position locked until the end of your next turn." */
function defenseAfterBattle(label: string, used: (ctx: Ctx) => boolean): EffectDef[] {
  return [
    {
      kind: 'trigger',
      event: 'battleEnd',
      mandatory: true,
      label,
      categories: ['position'],
      eventFilter: (ctx) => faceUpOn(ctx.self) && used(ctx),
      resolve: async (ctx) => {
        if (!faceUpOn(ctx.self)) return;
        if (ctx.self.pos === 'atk') await ctx.changePos(ctx.self, 'def');
        ctx.self.flags.csocPosLock = ctx.turn + 2;
      },
    },
    // APPROX: card effects can still change its position (the lock is the engine's "cannotChangePos", which only stops manual changes).
    { kind: 'continuous', mods: [{ q: 'cannotChangePos', value: (ctx) => (ctx.self.flags.csocPosLock ?? -1) >= ctx.turn }] },
  ];
}

M('Search Striker', {
  attribute: 'WIND',
  race: 'Warrior',
  level: 4,
  atk: 1600,
  def: 1200,
  aiValue: 200,
  text: "If this card attacks a face-down Defense Position monster, you can destroy the monster immediately with this card's effect without flipping it face-up or applying damage calculation. If you do, this card is changed to Defense Position at the end of the Battle Phase. This card's battle position cannot be changed until the end of your next turn, except with a card effect.",
  effects: [
    {
      // APPROX: resolves at the attack declaration (the attack then ends) instead of at the start of the Damage Step.
      kind: 'trigger',
      event: 'attackDeclared',
      when: true,
      label: 'Destroy the face-down monster',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && !!evo(ev) && !evo(ev)!.faceUp && evo(ev)!.pos === 'def',
      resolve: async (ctx) => {
        const t = ctx.battle?.target;
        if (!t || t.faceUp || t.location !== 'mzone' || ctx.battle?.attacker !== ctx.self) return;
        ctx.self.flags.csocStrike = ctx.turn;
        await ctx.destroy(t);
        if (ctx.battle) ctx.negateAttack();
      },
    },
    ...defenseAfterBattle('Change to Defense Position', (ctx) => ctx.self.flags.csocStrike === ctx.turn),
  ],
});

M('Pursuit Chaser', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 3,
  atk: 1400,
  def: 600,
  aiValue: 100,
  text: "When a Defense Position monster is destroyed by battle and sent to the Graveyard, inflict 500 damage to your opponent's Life Points.",
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: '500 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c !== ctx.self && c.location === 'grave' && c.pos === 'def' && faceUpOn(ctx.self);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 500);
      },
    },
  ],
});

M('Iron Chain Repairman', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 4,
  atk: 1600,
  def: 1200,
  sets: IRON_CHAIN,
  aiValue: 300,
  text: 'When this card destroys a monster by battle and sends it to the Graveyard, inflict 300 damage to your opponent. Once per turn, you can Special Summon 1 Level 4 or lower "Iron Chain" monster from your Graveyard, except "Iron Chain Repairman". This card cannot attack the turn you activate this effect.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: '300 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && ctx.self.location === 'mzone' && evc(ev)?.location === 'grave',
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 300);
      },
    },
    {
      kind: 'ignition',
      opt: true,
      label: 'Special Summon an Iron Chain monster from the GY',
      categories: ['specialSummon'],
      // 2010 ruling: it targets 1 Level 4 or lower "Iron Chain" monster in your GY, and cannot be activated in Main
      // Phase 2 if this card already attacked (even if the attack was negated). https://edisonrul.ing/cards/i/iron-chain-repairman.html
      canActivate: (ctx) =>
        ctx.self.attacksThisTurn === 0 &&
        ctx.canSpecialSummon() &&
        ctx.grave('me', (c) => isIronChain(c) && lvl(c) <= 4 && c.name !== 'Iron Chain Repairman' && ctx.canSummonCard(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        ctx.self.flags.cannotAttackTurn = ctx.turn;
        const cands = ctx.grave('me', (c) => isIronChain(c) && lvl(c) <= 4 && c.name !== 'Iron Chain Repairman' && ctx.canSummonCard(c));
        await ctx.selectTargets(cands, 1, 1, 'Target 1 Level 4 or lower "Iron Chain" monster in your Graveyard.', 'specialSummon', {
          aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const [c] = ctx.validTargets((x) => x.location === 'grave');
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
      ai: { score: (ctx) => (ctx.phase === 'main2' || !ctx.monsters('opp').length ? 50 : 30) },
    },
  ],
});

M('Iron Chain Snake', {
  attribute: 'EARTH',
  race: 'Reptile',
  level: 3,
  atk: 800,
  def: 1200,
  sets: IRON_CHAIN,
  aiValue: 300,
  text: 'During your Main Phase, you can equip this card to 1 face-up monster your opponent controls. That monster loses 800 ATK and DEF. When it is destroyed by battle and sent to the Graveyard, its controller sends cards equal to its Level from the top of their Deck to the Graveyard.',
  effects: [
    {
      kind: 'ignition',
      label: 'Equip to an opponent\'s monster',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.freeSZones() > 0 && ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Select 1 face-up monster your opponent controls to equip this card to.', 'equip', {
          aiScore: (c) => cardValue(ctx.game, c),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c) && c.controller === ctx.opp);
        if (!t || !faceUpOn(ctx.self)) return;
        equipMonster(ctx, ctx.self, t, ctx.player);
      },
      ai: {
        score: (ctx) => {
          const mine = Math.max(0, ...ctx.faceUpMonsters('me', (c) => c !== ctx.self).map((c) => ctx.atk(c)));
          return ctx.faceUpMonsters('opp').some((c) => ctx.atk(c) > mine && ctx.atk(c) - 800 < mine) ? 40 : ctx.monsters('opp').length ? 15 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      range: ['szone'],
      mods: [
        { q: 'atk', to: 'cards', filter: (ctx, c: C) => c.uid === ctx.self.equippedTo, value: -800 },
        { q: 'def', to: 'cards', filter: (ctx, c: C) => c.uid === ctx.self.equippedTo, value: -800 },
      ],
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Send cards from the top of the Deck',
      categories: ['mill'],
      eventFilter: (ctx, ev) => ctx.self.location === 'szone' && !!evc(ev) && evc(ev)!.uid === ctx.self.equippedTo && evc(ev)!.location === 'grave',
      resolve: async (ctx) => {
        const v = evc(ctx.event!)!;
        const p = (ctx.event?.fromController ?? v.owner) as PlayerId;
        await ctx.game.mill(p, lvl(v), 'effect', ctx.self);
      },
    },
  ],
});

M('Iron Chain Blaster', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 2,
  atk: 1100,
  def: 0,
  sets: IRON_CHAIN,
  aiValue: 200,
  text: 'Once per turn, you can send 1 "Iron Chain" monster you control to the Graveyard to inflict 800 damage to your opponent.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Send an Iron Chain monster: 800 damage',
      categories: ['damage'],
      canActivate: (ctx) => ctx.monsters('me', (c) => c.faceUp && isIronChain(c)).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.monsters('me', (c) => c.faceUp && isIronChain(c)), 1, 1, 'Send 1 "Iron Chain" monster you control to the Graveyard.', 'cost', {
          aiScore: (c) => -cardValue(ctx.game, c),
        });
        if (!sel.length) return false;
        await ctx.sendToGrave(sel, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 800);
      },
      ai: { score: (ctx) => (ctx.oppLp <= 800 ? 95 : ctx.phase === 'main2' ? 25 : 0) },
    },
  ],
});

M('Iron Chain Coil', {
  attribute: 'EARTH',
  race: 'Machine',
  level: 3,
  atk: 1100,
  def: 1600,
  types: ['tuner'],
  sets: IRON_CHAIN,
  aiValue: 300,
  text: 'Once per turn, you can select 1 "Iron Chain" monster you control to have it gain 300 ATK and DEF as long as this card is face-up on the field.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: '+300 ATK/DEF to an Iron Chain monster',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isIronChain(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', isIronChain), 1, 1, 'Select 1 "Iron Chain" monster you control.', 'buff', { aiScore: (c) => ctx.atk(c) });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        if (!t || !faceUpOn(ctx.self)) return;
        ((ctx.self.flags.coil ??= []) as { uid: number; moveId: number }[]).push({ uid: t.uid, moveId: t.moveId });
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' ? 25 : 10) },
    },
    {
      kind: 'continuous',
      mods: (['atk', 'def'] as const).map((q) => ({
        q,
        to: 'cards' as const,
        filter: (ctx: Ctx, c: C) => ((ctx.self.flags.coil ?? []) as { uid: number; moveId: number }[]).some((x) => x.uid === c.uid && x.moveId === c.moveId),
        value: (ctx: Ctx, c: C) => 300 * ((ctx.self.flags.coil ?? []) as { uid: number; moveId: number }[]).filter((x) => x.uid === c.uid && x.moveId === c.moveId).length,
      })),
    },
  ],
});

M('Power Injector', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 4,
  atk: 1300,
  def: 1400,
  aiValue: 100,
  text: 'Once per turn you can pay 600 Life Points to have all face-up Psychic-Type monsters gain 500 ATK during this turn.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Pay 600: Psychic-Type monsters gain 500 ATK',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.lp > 600,
      activate: async (ctx) => {
        await ctx.payLp(600);
      },
      resolve: async (ctx) => {
        for (const c of ctx.faceUpMonsters('both', isPsychic)) ctx.addTempMod(c, 'atk', 500, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1' || ctx.lp < 2000) return 0;
          const mine = ctx.faceUpMonsters('me', (c) => isPsychic(c) && c.pos === 'atk');
          return mine.some((m) => ctx.monsters('opp').some((o) => o.faceUp && ctx.atk(o) >= ctx.atk(m) && ctx.atk(o) < ctx.atk(m) + 500)) ? 35 : 0;
        },
      },
    },
  ],
});

M('Storm Caller', {
  attribute: 'WIND',
  race: 'Psychic',
  level: 6,
  atk: 2300,
  def: 2000,
  aiValue: 200,
  text: "You can put your opponent's monsters that are destroyed by battle with other Psychic-Type monsters on top of their owner's Deck instead of sending them to the Graveyard. When this card is destroyed by a card effect, this card's controller takes damage equal to its original ATK.",
  effects: [
    {
      kind: 'continuous',
      replaceDestroy: async (ctx, cards, reason) => {
        if (reason !== 'battle' || !faceUpOn(ctx.self)) return [];
        const b = ctx.battle;
        if (!b) return [];
        const saved: C[] = [];
        for (const c of cards) {
          // 2010 ruling: not your own monster that your opponent controls. https://edisonrul.ing/cards/s/storm-caller.html
          if (c.controller !== ctx.opp || c.owner !== ctx.opp || c.location !== 'mzone') continue;
          const by = b.attacker === c ? b.target : b.target === c ? b.attacker : null;
          if (!by || by === ctx.self || by.controller !== ctx.player || !isPsychic(by)) continue;
          if (!(await ctx.confirm(`Storm Caller: put ${c.name} on top of its owner's Deck instead of the Graveyard?`))) continue;
          ctx.game.log(`${c.name} is destroyed by battle and placed on top of the Deck (Storm Caller).`, 'battle', ctx.player);
          await ctx.game.moveCards([c], 'deck', { reason: 'battle', reasons: ['battle', 'destroy'], reasonPlayer: ctx.player, reasonCard: by, destroyed: true, top: true });
          saved.push(c);
        }
        return saved;
      },
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Take damage equal to its original ATK',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && reasonsOf(ev).includes('effect'),
      resolve: async (ctx) => {
        const p = (ctx.event?.fromController ?? ctx.player) as PlayerId;
        await ctx.game.damage(p, ctx.self.data.atk ?? 0, 'effect', ctx.self, p);
      },
    },
  ],
});

M('Psychic Jumper', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 2,
  atk: 100,
  def: 1500,
  types: ['tuner'],
  aiValue: 300,
  text: 'Once per turn, you can pay 1000 Life Points to select 1 face-up monster your opponent controls and 1 Psychic-Type monster you control, except "Psychic Jumper". Switch control of the selected monsters. Their battle positions cannot be changed this turn.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Pay 1000: switch control',
      categories: ['control'],
      canActivate: (ctx) =>
        ctx.lp > 1000 &&
        ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0 &&
        ctx.monsters('me', (c) => c.faceUp && isPsychic(c) && c.name !== 'Psychic Jumper' && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(1000);
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Select 1 face-up monster your opponent controls.', 'control', { aiScore: (c) => cardValue(ctx.game, c) });
        await ctx.selectTargets(ctx.monsters('me', (c) => c.faceUp && isPsychic(c) && c.name !== 'Psychic Jumper'), 1, 1, 'Select 1 Psychic-Type monster you control.', 'cost', {
          aiScore: (c) => -cardValue(ctx.game, c),
        });
      },
      resolve: async (ctx) => {
        const g = ctx.game;
        const theirs = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.opp)[0];
        const mine = ctx.validTargets((c) => c.location === 'mzone' && c.controller === ctx.player)[0];
        if (!theirs || !mine) return;
        const first = g.freeMZones(ctx.opp) > 0 ? mine : theirs;
        if (first === mine) {
          await g.takeControl(mine, ctx.opp, false);
          await g.takeControl(theirs, ctx.player, false);
        } else {
          await g.takeControl(theirs, ctx.player, false);
          await g.takeControl(mine, ctx.opp, false);
        }
        for (const c of [theirs, mine]) if (c.location === 'mzone') ctx.addTempMod(c, 'cannotChangePos', true, 'turn');
      },
      ai: {
        score: (ctx) => {
          if (ctx.lp < 3000) return 0;
          const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp'));
          const cheap = ctx.monsters('me', (c) => c.faceUp && isPsychic(c) && c.name !== 'Psychic Jumper').map((c) => cardValue(ctx.game, c));
          return best && cheap.length && cardValue(ctx.game, best) > Math.min(...cheap) + 800 ? 45 : 0;
        },
      },
    },
  ],
});

M('Gigantic Cephalotus', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 4,
  atk: 1850,
  def: 700,
  aiValue: 100,
  text: 'This card gains 200 ATK each time a Plant-Type monster is sent from the field to the Graveyard.',
  effects: [
    {
      // Bookkeeping only (never activates): counts Plant-Type monsters sent from the field to the GY while this card is face-up.
      kind: 'trigger',
      event: 'sentToGrave',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && c !== ctx.self && ev.from === 'mzone' && isPlant(c) && faceUpOn(ctx.self) && !ctx.game.isNegated(ctx.self)) {
          ctx.self.flags.cephalotus = (ctx.self.flags.cephalotus ?? 0) + 1;
        }
        return false;
      },
    },
    { kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 200 * (ctx.self.flags.cephalotus ?? 0) }] },
  ],
});

M('Horseytail', {
  attribute: 'WIND',
  race: 'Plant',
  level: 2,
  atk: 400,
  def: 500,
  aiValue: 100,
  text: 'When this card is destroyed by battle and sent to the Graveyard, Special Summon 1 "Horseytail Token" (Plant-Type/WIND/Level 1/ATK 0/DEF 0) to your opponent\'s side of the field in Defense Position. When this Token is destroyed by battle with a Plant-Type monster, its controller sends 1 card from their hand to the Graveyard.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Horseytail Token',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      resolve: async (ctx) => {
        if (ctx.freeMZones('opp') > 0) await tokensTo(ctx, HORSEY_TOKEN, 1, 'def', ctx.opp);
      },
    },
  ],
});

M('Botanical Girl', {
  attribute: 'WATER',
  race: 'Plant',
  level: 3,
  atk: 1300,
  def: 1100,
  aiValue: 400,
  text: 'When this card is sent from the field to the Graveyard, you can add 1 Plant-Type monster with 1000 or less DEF from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      when: true,
      label: 'Add a Plant-Type monster',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && fromField(ev) && ctx.self.location === 'grave',
      canActivate: (ctx) => !cantAdd(ctx) && ctx.deck('me', (c) => isPlant(c) && (c.data.def ?? 0) <= 1000).length > 0,
      resolve: async (ctx) => {
        await ctx.search((c) => isPlant(c) && (c.data.def ?? 0) <= 1000, 1, 'Add 1 Plant-Type monster with 1000 or less DEF from your Deck to your hand.');
      },
    },
  ],
});

M(CURSED_FIG, {
  attribute: 'WATER',
  race: 'Plant',
  level: 1,
  atk: 200,
  def: 200,
  aiValue: 200,
  text: 'When this card is destroyed by battle and sent to the Graveyard, select 2 face-down Spell or Trap Cards on the field. As long as this card remains in the Graveyard, the selected cards cannot be activated.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Lock 2 Set Spell/Trap Cards',
      categories: ['lockdown'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      condition: (ctx) => ctx.spellTraps('both', (c) => !c.faceUp && ctx.canTarget(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both', (c) => !c.faceUp), 2, 2, 'Select 2 face-down Spell or Trap Cards on the field.', 'target', {
          aiScore: (c) => (c.controller === ctx.opp ? 10 : 0),
        });
      },
      resolve: async (ctx) => {
        if (ctx.self.location !== 'grave') return;
        const ts = ctx.validTargets((c) => c.onField && !c.faceUp);
        ctx.self.flags.figLocks = ts.map((c) => ({ uid: c.uid, moveId: c.moveId }));
        if (ts.length) ctx.log(`${ts.length} Set card(s) cannot be activated while ${ctx.self.name} is in the Graveyard.`);
      },
    },
  ],
});

M(MAMMOTH, {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 4,
  atk: 1900,
  def: 0,
  aiValue: 0,
  text: 'Destroy this card if you do not have a Zombie-Type monster in your Graveyard. When this face-up card is destroyed, inflict damage to its controller equal to its original ATK.',
  effects: [
    // The self-destruction is a state check (ensureCsocPatches).
    {
      kind: 'trigger',
      event: 'destroyed',
      mandatory: true,
      label: 'Its controller takes damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && !!ev.fromFaceUp,
      resolve: async (ctx) => {
        const p = (ctx.event?.fromController ?? ctx.player) as PlayerId;
        await ctx.game.damage(p, ctx.self.data.atk ?? 0, 'effect', ctx.self, p);
      },
    },
  ],
});

M('Goblin Decoy Squad', {
  attribute: 'DARK',
  race: 'Warrior',
  level: 4,
  atk: 1000,
  def: 0,
  aiValue: 100,
  text: "When this card inflicts Battle Damage to your opponent, you can draw 1 card. If this card attacks, it is changed to Defense Position at the end of the Battle Phase. This card's battle position cannot be changed until the end of your next turn, except with a card effect.",
  effects: [
    {
      kind: 'trigger',
      event: 'battleDamage',
      when: true,
      label: 'Draw 1 card',
      categories: ['draw'],
      eventFilter: (ctx, ev) => ev.reasonCard === ctx.self && ev.player === ctx.opp && ctx.self.location === 'mzone',
      resolve: async (ctx) => {
        await ctx.draw(1);
      },
    },
    ...defenseAfterBattle('Change to Defense Position', (ctx) => ctx.self.attacksThisTurn > 0 && ctx.isMyTurn),
  ],
});

M('Comrade Swordsman of Landstar', {
  attribute: 'EARTH',
  race: 'Warrior',
  level: 3,
  atk: 500,
  def: 1200,
  types: ['tuner'],
  aiValue: 200,
  text: 'All Warrior-Type monsters you control gain 400 ATK.',
  effects: [{ kind: 'continuous', mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.player && raceIs(c, 'Warrior'), value: 400 }] }],
});

M('Hanewata', {
  attribute: 'LIGHT',
  race: 'Fairy',
  level: 1,
  atk: 200,
  def: 300,
  types: ['tuner'],
  aiValue: 300,
  text: 'You can discard this card to make any effect damage you take this turn become 0. This effect can be activated during either player\'s turn.',
  effects: [
    {
      kind: 'quick',
      range: ['hand'],
      label: 'Discard: no effect damage this turn',
      categories: ['protect'],
      condition: (ctx) => !ctx.game.queryPlayer(ctx.player, 'noEffectDamage'),
      activate: async (ctx) => {
        await ctx.discard(ctx.self, 'cost');
      },
      resolve: async (ctx) => {
        ctx.addPlayerMod(ctx.player, 'noEffectDamage', true, 'turn');
        ctx.log(`${ctx.game.players[ctx.player].name} takes no effect damage this turn.`);
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          return l && l.player === ctx.opp && (l.effect.categories ?? []).includes('damage') ? (ctx.lp <= 2000 ? 80 : 45) : 0;
        },
      },
    },
  ],
});

M('The White Stone of Legend', {
  attribute: 'LIGHT',
  race: 'Dragon',
  level: 1,
  atk: 300,
  def: 250,
  types: ['tuner'],
  aiValue: 300,
  text: 'When this card is sent to the Graveyard, add 1 "Blue-Eyes White Dragon" from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'sentToGrave',
      mandatory: true,
      label: 'Add "Blue-Eyes White Dragon"',
      categories: ['search'],
      // https://edisonrul.ing/cards/t/the-white-stone-of-legend.html — the mandatory effect activates even with no
      // "Blue-Eyes White Dragon" left in the Deck (and under Thunder King Rai-Oh it activates but adds nothing).
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      resolve: async (ctx) => {
        if (cantAdd(ctx) || !ctx.deck('me', (c) => c.name === 'Blue-Eyes White Dragon').length) return;
        await ctx.search((c) => c.name === 'Blue-Eyes White Dragon', 1, 'Add 1 "Blue-Eyes White Dragon" from your Deck to your hand.');
      },
    },
  ],
});

M('Tiger Dragon', {
  attribute: 'EARTH',
  race: 'Dragon',
  level: 6,
  atk: 2400,
  def: 1800,
  aiValue: 200,
  text: "When this card is Tribute Summoned by Tributing a Dragon-Type monster, you can select up to 2 face-down cards in your opponent's Spell & Trap Card Zone, and destroy them.",
  effects: [
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      when: true,
      label: 'Destroy up to 2 Set cards',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ((ctx.self.flags.tributedMonsters ?? []) as { race?: Race }[]).some((t) => t.race === 'Dragon'),
      canActivate: (ctx) => ctx.cards('opp', 'szone', (c) => !c.faceUp && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.cards('opp', 'szone', (c) => !c.faceUp), 1, 2, "Select up to 2 face-down cards in your opponent's Spell & Trap Card Zone.", 'destroy');
      },
      resolve: async (ctx) => {
        // 2010 ruling: a target that was chained (now face-up) is not destroyed. https://edisonrul.ing/cards/t/tiger-dragon.html
        const ts = ctx.validTargets((c) => c.onField && !c.faceUp);
        if (ts.length) await ctx.destroy(ts);
      },
    },
  ],
});

M('Jade Knight', {
  attribute: 'LIGHT',
  race: 'Machine',
  level: 4,
  atk: 1000,
  def: 1800,
  aiValue: 300,
  text: 'While this card is in face-up Attack Position, Machine-Type monsters you control with 1200 or less ATK cannot be destroyed by the effects of Trap Cards. When this card is destroyed by battle and sent to the Graveyard, you can add 1 Level 4 LIGHT Machine-Type monster from your Deck to your hand.',
  effects: [
    {
      kind: 'continuous',
      active: (ctx) => ctx.self.pos === 'atk',
      replaceDestroyOne: async (ctx, card, reason, reasonCard) => {
        if (reason !== 'effect' || !reasonCard?.isTrap) return false;
        if (!faceUpOn(card) || card.controller !== ctx.player || !raceIs(card, 'Machine') || ctx.atk(card) > 1200) return false;
        ctx.game.log(`${card.name} is not destroyed (Jade Knight).`, 'action', ctx.player);
        return true;
      },
    },
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Add a Level 4 LIGHT Machine-Type monster',
      categories: ['search'],
      // 2010 ruling: it cannot activate if this card was face-down when it was attacked and destroyed by battle.
      // https://edisonrul.ing/cards/j/jade-knight.html
      eventFilter: (ctx, ev) =>
        ev.card === ctx.self && ctx.self.location === 'grave' && !(ctx.battle?.target === ctx.self && ctx.battle.targetFaceDownAtStart),
      canActivate: (ctx) => !cantAdd(ctx) && ctx.deck('me', (c) => lvl(c) === 4 && attrIs(c, 'LIGHT') && raceIs(c, 'Machine')).length > 0,
      resolve: async (ctx) => {
        await ctx.search((c) => lvl(c) === 4 && attrIs(c, 'LIGHT') && raceIs(c, 'Machine'), 1, 'Add 1 Level 4 LIGHT Machine-Type monster from your Deck to your hand.');
      },
    },
  ],
});

M('Psychic Lifetrancer', {
  attribute: 'EARTH',
  race: 'Psychic',
  level: 7,
  atk: 2400,
  def: 2000,
  types: ['synchro'],
  aiValue: 300,
  synchro: { desc: '1 Tuner + 1 or more non-Tuner monsters' },
  text: '1 Tuner + 1 or more non-Tuner monsters\nOnce per turn, you can remove from play 1 Psychic-Type monster from your Graveyard to gain 1200 Life Points.',
  effects: [
    {
      kind: 'ignition',
      opt: true,
      label: 'Banish a Psychic-Type monster: gain 1200 LP',
      categories: ['recover'],
      canActivate: (ctx) => ctx.grave('me', isPsychic).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', isPsychic), 1, 1, 'Remove from play 1 Psychic-Type monster from your Graveyard.', 'cost', { aiScore: (c) => -(c.data.aiValue ?? 0) });
        if (!sel.length) return false;
        await ctx.banish(sel, 'cost');
      },
      resolve: async (ctx) => {
        await ctx.recover(ctx.player, 1200);
      },
      ai: { score: () => 25 },
    },
  ],
});

M('Queen of Thorns', {
  attribute: 'LIGHT',
  race: 'Plant',
  level: 6,
  atk: 2200,
  def: 1800,
  types: ['synchro'],
  aiValue: 400,
  synchro: { nonTuner: isPlant, desc: '1 Tuner + 1 or more non-Tuner Plant-Type monsters' },
  text: '1 Tuner + 1 or more non-Tuner Plant-Type monsters\nEach player must pay 1000 Life Points to Normal Summon or Special Summon a non-Plant-Type monster from their hand.',
  effects: [
    {
      // https://edisonrul.ing/cards/q/queen-of-thorns.html — a Continuous Effect that does not activate: the 1000 LP are
      // paid as a cost when the Summon is performed (Lava Golem), or while an effect that Summons resolves; a player who
      // cannot pay cannot Summon. Tributing a face-up Queen still costs 1000; 2 face-up Queens cost 2000 (Game.summonLpCost).
      kind: 'continuous',
      summonLpCost: (ctx, card) => (card.isMonster && !isPlant(card) && monActive(ctx) ? 1000 : 0),
    },
  ],
});

M(HA_DES, {
  attribute: 'DARK',
  race: 'Zombie',
  level: 6,
  atk: 2450,
  def: 0,
  types: ['synchro'],
  aiValue: 400,
  synchro: { tuner: (c) => c.name === 'Plaguespreader Zombie', nonTuner: isZombie, desc: '"Plaguespreader Zombie" + 1 or more non-Tuner Zombie-Type monsters' },
  text: '"Plaguespreader Zombie" + 1 or more non-Tuner Zombie-Type monsters\nNegate the effects of Effect Monsters destroyed by battle with Zombie-Type monsters you control.',
  // Effect: Game.emit patch (ensureCsocPatches). APPROX: the destroyed monster's effects stay negated until the end of the turn.
  effects: [],
});

M('Seed of Flame', {
  attribute: 'FIRE',
  race: 'Plant',
  level: 3,
  atk: 1600,
  def: 1200,
  aiValue: 300,
  text: 'When this card on your side of the field is destroyed by a card effect and sent to the Graveyard, you can Special Summon 1 Level 4 or lower Plant-Type monster from your Graveyard, except "Seed of Flame". Then, Special Summon 1 "Seed Token" (Plant-Type/EARTH/Level 1/ATK 0/DEF 0) on your opponent\'s side of the field in Defense Position. This Token cannot be Tributed for a Tribute Summon.',
  effects: [
    {
      kind: 'trigger',
      event: 'destroyed',
      when: true,
      label: 'Special Summon a Plant-Type monster',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'mzone' && ev.fromController === ctx.self.owner && reasonsOf(ev).includes('effect') && ctx.self.location === 'grave',
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isPlant(c) && lvl(c) <= 4 && c.name !== 'Seed of Flame' && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isPlant(c) && lvl(c) <= 4 && c.name !== 'Seed of Flame' && ctx.canSummonCard(c)), 1, 1, 'Select 1 Level 4 or lower Plant-Type monster in your Graveyard.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t) return;
        const r = await ctx.specialSummon(t, { pos: 'choose' });
        if (!r.length || ctx.freeMZones('opp') <= 0) return;
        const [tok] = await tokensTo(ctx, SEED_TOKEN, 1, 'def', ctx.opp);
        if (tok) tok.flags.noTributeSummonFodder = true;
      },
    },
  ],
});

M('Cactus Fighter', {
  attribute: 'EARTH',
  race: 'Plant',
  level: 4,
  atk: 1900,
  def: 400,
  aiValue: 0,
  text: 'When this card destroys an opponent\'s monster by battle, Special Summon 1 "Needle Token" (Plant-Type/EARTH/Level 1/ATK 500/DEF 500) on your opponent\'s side of the field in Defense Position.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      mandatory: true,
      label: 'Needle Token',
      categories: ['specialSummon'],
      // No historical ruling; edisonformat.net (revised): it triggers as long as it destroyed a monster by battle, even
      // if it was destroyed too. https://edisonrul.ing/cards/c/cactus-fighter.html
      range: ['mzone', 'grave', 'banished'],
      eventFilter: (ctx, ev) => ev.other === ctx.self && ev.fromController === ctx.opp,
      resolve: async (ctx) => {
        if (ctx.freeMZones('opp') > 0) await tokensTo(ctx, NEEDLE_TOKEN, 1, 'def', ctx.opp);
      },
    },
  ],
});

// "Once while this card is face-up on the field": the engine drops the flag when it is turned face-down.
faceUpFlag('overdriveUsed');
M(OVERDRIVE, {
  attribute: 'LIGHT',
  race: 'Psychic',
  level: 6,
  atk: 2100,
  def: 1200,
  aiValue: 500,
  text: 'This card cannot be Special Summoned. You can pay 2000 Life Points to Special Summon 2 Level 3 Psychic-Type monsters from your Deck. This effect can only be used once while this card is face-up on the field.',
  // "Cannot be Special Summoned": Summon legality patch (ensureCsocPatches).
  effects: [
    {
      kind: 'ignition',
      label: 'Pay 2000: Special Summon 2 Level 3 Psychic-Type monsters',
      categories: ['specialSummon'],
      canActivate: (ctx) =>
        !ctx.self.flags.overdriveUsed && ctx.lp > 2000 && ctx.freeMZones() >= 2 && ctx.canSpecialSummon() && ctx.deck('me', (c) => isPsychic(c) && lvl(c) === 3 && ctx.canSummonCard(c)).length >= 2,
      activate: async (ctx) => {
        ctx.self.flags.overdriveUsed = true;
        await ctx.payLp(2000);
      },
      resolve: async (ctx) => {
        const cands = ctx.deck('me', (c) => isPsychic(c) && lvl(c) === 3 && ctx.canSummonCard(c));
        if (cands.length >= 2 && ctx.freeMZones() >= 2) {
          const sel = await ctx.select(cands, 2, 2, 'Special Summon 2 Level 3 Psychic-Type monsters from your Deck.', 'specialSummon', {
            aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
          });
          if (sel.length === 2) await ctx.specialSummon(sel, { pos: 'choose' });
        }
        ctx.game.shuffleDeck(ctx.player);
      },
      ai: { score: (ctx) => (ctx.lp >= 4000 ? 45 : 0) },
    },
  ],
});

QUESTION_ATK.add(RAI_JIN);
M(RAI_JIN, {
  attribute: 'LIGHT',
  race: 'Thunder',
  level: 4,
  atk: 0,
  def: 1000,
  aiValue: 100,
  text: 'All LIGHT monsters you control gain 100 ATK for each LIGHT monster in your Graveyard. During your End Phase, destroy 1 LIGHT monster you control. There can only be 1 face-up "Rai-Jin" on the field.',
  effects: [
    {
      kind: 'continuous',
      mods: [{ q: 'atk', to: 'cards', filter: (ctx, c: C) => faceUpOn(c) && c.controller === ctx.player && attrIs(c, 'LIGHT'), value: (ctx) => 100 * ctx.grave('me', (c) => attrIs(c, 'LIGHT')).length }],
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Destroy 1 LIGHT monster you control',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && faceUpOn(ctx.self),
      resolve: async (ctx) => {
        const cands = ctx.faceUpMonsters('me', (c) => attrIs(c, 'LIGHT'));
        const [c] = await ctx.select(cands, 1, 1, 'Destroy 1 LIGHT monster you control.', 'destroy', { aiScore: (x) => -cardValue(ctx.game, x) });
        if (c) await ctx.destroy(c);
      },
    },
  ],
});

M('Rai-Mei', {
  attribute: 'LIGHT',
  race: 'Thunder',
  level: 3,
  atk: 1400,
  def: 1200,
  aiValue: 300,
  text: 'When this card is destroyed by battle and sent to the Graveyard, you can add 1 Level 2 or lower LIGHT monster from your Deck to your hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'battleDestroyed',
      when: true,
      label: 'Add a Level 2 or lower LIGHT monster',
      categories: ['search'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ctx.self.location === 'grave',
      canActivate: (ctx) => !cantAdd(ctx) && ctx.deck('me', (c) => attrIs(c, 'LIGHT') && lvl(c) <= 2 && !c.isExtra).length > 0,
      resolve: async (ctx) => {
        await ctx.search((c) => attrIs(c, 'LIGHT') && lvl(c) <= 2 && !c.isExtra, 1, 'Add 1 Level 2 or lower LIGHT monster from your Deck to your hand.');
      },
    },
  ],
});

M("Night's End Sorcerer", {
  attribute: 'DARK',
  race: 'Spellcaster',
  level: 2,
  atk: 1300,
  def: 400,
  types: ['tuner'],
  aiValue: 300,
  text: "When this card is Special Summoned, you can select up to 2 cards in your opponent's Graveyard, and remove them from play.",
  effects: [
    {
      kind: 'trigger',
      event: 'specialSummoned',
      when: true,
      label: "Banish up to 2 cards from the opponent's GY",
      categories: ['banish'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.grave('opp').length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('opp'), 1, 2, "Select up to 2 cards in your opponent's Graveyard.", 'banish', {
          aiScore: (c) => (c.data.aiValue ?? 0) + (c.isMonster ? 200 : 0),
        });
      },
      resolve: async (ctx) => {
        const ts = ctx.validTargets((c) => c.location === 'grave');
        if (ts.length) await ctx.banish(ts);
      },
    },
  ],
});

M('Puppet Master', {
  attribute: 'DARK',
  race: 'Fiend',
  level: 6,
  atk: 0,
  def: 0,
  aiValue: 300,
  text: 'When this card is Tribute Summoned, you can pay 2000 Life Points to select and Special Summon 2 Fiend-Type monsters from your Graveyard. They cannot attack this turn.',
  effects: [
    {
      kind: 'trigger',
      event: 'tributeSummoned',
      when: true,
      label: 'Pay 2000: Special Summon 2 Fiend-Type monsters',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.lp > 2000 && ctx.freeMZones() >= 2 && ctx.canSpecialSummon() && ctx.grave('me', (c) => raceIs(c, 'Fiend') && ctx.canSummonCard(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.payLp(2000);
        await ctx.selectTargets(ctx.grave('me', (c) => raceIs(c, 'Fiend') && ctx.canSummonCard(c)), 2, 2, 'Select 2 Fiend-Type monsters in your Graveyard.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        // https://edisonrul.ing/cards/p/puppet-master.html — if a target leaves the GY, the other is still Special Summoned.
        let ts = ctx.validTargets((c) => c.location === 'grave');
        const room = ctx.freeMZones();
        if (!ts.length || room < 1) return;
        if (ts.length > room) ts = await ctx.select(ts, room, room, 'Select the monster(s) to Special Summon.', 'specialSummon');
        const r = await ctx.specialSummon(ts, { pos: 'choose' });
        for (const c of r) c.flags.cannotAttackTurn = ctx.turn;
      },
      ai: { score: (ctx) => (ctx.lp >= 4500 ? 40 : 0) },
    },
  ],
});

M(UR, {
  attribute: 'EARTH',
  race: 'Machine',
  level: 4,
  atk: 1600,
  def: 1500,
  aiValue: 300,
  text: 'This card can attack all monsters your opponent controls once each. If this card attacks or is attacked, your opponent takes no Battle Damage.',
  // Effects: attack and battle damage patches (ensureCsocPatches).
  effects: [],
});

M('Mosaic Manticore', {
  attribute: 'EARTH',
  race: 'Beast',
  level: 8,
  atk: 2800,
  def: 2500,
  aiValue: 300,
  text: 'During the Standby Phase of your next turn after you Tribute Summoned this face-up card on the field: Special Summon, from the Graveyard, as many monster(s) as possible that were used for its Tribute Summon. They cannot declare an attack, and their effects are negated.',
  effects: [
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Special Summon the Tributed monsters',
      categories: ['specialSummon'],
      // 2010 rulings: also after a Tribute Set that is flipped face-up; a Tributed monster of the opponent is Special
      // Summoned to your side; a Tributed monster that left the GY and came back is not Summoned; with too few zones you
      // choose. https://edisonrul.ing/cards/m/mosaic-manticore.html
      eventFilter: (ctx, ev) =>
        ev.phase === 'standby' &&
        ctx.isMyTurn &&
        faceUpOn(ctx.self) &&
        (ctx.self.summonMethod === 'tribute' || ctx.self.summonMethod === 'set') &&
        ((ctx.self.flags.tributedMonsters ?? []) as unknown[]).length > 0 &&
        ctx.turn === ctx.self.summonTurn + 2,
      resolve: async (ctx) => {
        const recs = (ctx.self.flags.tributedMonsters ?? []) as { uid: number; moveId?: number }[];
        const all = ctx.grave('both', (c) => recs.some((t) => t.uid === c.uid && (t.moveId === undefined || t.moveId === c.moveId)) && ctx.canSummonCard(c));
        const n = Math.min(all.length, ctx.freeMZones());
        if (n <= 0 || !ctx.canSpecialSummon()) return;
        const cands = all.length > n ? await ctx.select(all, n, n, `Special Summon ${n} of the Tributed monsters.`, 'specialSummon') : all;
        if (!cands.length) return;
        const r = await ctx.specialSummon(cands, { pos: 'choose', controller: ctx.player });
        for (const c of r) {
          ctx.addTempMod(c, 'cannotAttack', true, 'field');
          ctx.negateEffects(c, 'field');
        }
      },
    },
  ],
});

/** Goka was just Special Summoned by its own procedure (card → its moveId after the Summon). */
const GOKA_PROC = new WeakMap<C, number>();
M('Goka, the Pyre of Malice', {
  attribute: 'FIRE',
  race: 'Zombie',
  level: 6,
  atk: 2200,
  def: 1900,
  aiValue: 300,
  text: 'If you control a FIRE monster, you can Special Summon this card (from your hand). When this card is Special Summoned this way, destroy 1 FIRE monster you control. During each of your Standby Phases, Special Summon 1 "Fireball Token" (Pyro-Type/FIRE/Level 1/ATK 100/DEF 100) in Defense Position. You can Tribute 1 other FIRE monster to have this card gain 500 ATK until the End Phase.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (you control a FIRE monster)',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.freeMZones() > 0 && ctx.faceUpMonsters('me', (c) => attrIs(c, 'FIRE')).length > 0,
      perform: async (ctx) => {
        GOKA_PROC.set(ctx.self, ctx.self.moveId + 1);
        return true;
      },
      ai: {
        score: (ctx) => (ctx.faceUpMonsters('me', (c) => attrIs(c, 'FIRE')).some((c) => c.isToken || cardValue(ctx.game, c) < 1500) ? 70 : 0),
      },
    },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      label: 'Destroy 1 FIRE monster you control',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && GOKA_PROC.get(ctx.self) === ctx.self.moveId,
      condition: (ctx) => ctx.faceUpMonsters('me', (c) => attrIs(c, 'FIRE') && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => attrIs(c, 'FIRE')), 1, 1, 'Select 1 FIRE monster you control to destroy.', 'destroy', {
          aiScore: (c) => (c === ctx.self ? -5000 : -cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        const ts = ctx.validTargets((c) => c.onField);
        if (ts.length) await ctx.destroy(ts);
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Fireball Token',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && faceUpOn(ctx.self),
      resolve: async (ctx) => {
        if (ctx.freeMZones() > 0) await tokensTo(ctx, FIREBALL_TOKEN, 1, 'def', ctx.player);
      },
    },
    {
      kind: 'ignition',
      label: 'Tribute a FIRE monster: +500 ATK',
      categories: ['atkChange'],
      canActivate: (ctx) => tributable(ctx, (c) => c !== ctx.self && attrIs(c, 'FIRE') && c.faceUp).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, (c) => c !== ctx.self && attrIs(c, 'FIRE') && c.faceUp), 1, 1, 'Tribute 1 other FIRE monster.', 'tribute', {
          aiScore: (c) => -cardValue(ctx.game, c),
        });
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self)) ctx.addTempMod(ctx.self, 'atk', 500, 'turn');
      },
      ai: {
        score: (ctx) =>
          ctx.phase === 'main1' && ctx.self.pos === 'atk' && tributable(ctx, (c) => c !== ctx.self && attrIs(c, 'FIRE') && c.isToken).length && ctx.monsters('opp').some((o) => o.faceUp && ctx.atk(o) >= ctx.atk(ctx.self) && ctx.atk(o) < ctx.atk(ctx.self) + 500)
            ? 40
            : 0,
      },
    },
  ],
});

M('Red Ogre', {
  attribute: 'EARTH',
  race: 'Zombie',
  level: 7,
  atk: 2800,
  def: 2100,
  aiValue: 200,
  text: 'When this card is Normal Summoned, you can send any number of cards from your hand to the Graveyard to select the same number of cards on the field and return them to the owner\'s hand.',
  effects: [
    {
      kind: 'trigger',
      event: 'normalSummoned',
      when: true,
      label: 'Discard: return cards on the field to the hand',
      categories: ['toHand'],
      eventFilter: (ctx, ev) => ev.card === ctx.self,
      canActivate: (ctx) => ctx.hand().length > 0 && ctx.field('both', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const cands = ctx.field('both', (c) => ctx.canTarget(c));
        const max = Math.min(ctx.hand().length, cands.length);
        const ai = isAi(ctx.game, ctx.player);
        const oppGood = ctx.field('opp', (c) => ctx.canTarget(c)).sort((a, b) => cardValue(ctx.game, b) - cardValue(ctx.game, a));
        const cheap = ctx.hand().sort((a, b) => cardValue(ctx.game, a) - cardValue(ctx.game, b));
        const aiN = Math.max(1, Math.min(max, oppGood.filter((c, i) => cheap[i] && cardValue(ctx.game, c) > cardValue(ctx.game, cheap[i])).length));
        const disc = await ctx.select(ctx.hand(), 1, ai ? aiN : max, 'Send any number of cards from your hand to the Graveyard.', 'cost', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!disc.length) return false;
        await ctx.sendToGrave(disc, 'cost');
        await ctx.selectTargets(cands, disc.length, disc.length, `Select ${disc.length} card(s) on the field to return to the hand.`, 'bounce', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000),
        });
      },
      resolve: async (ctx) => {
        const ts = ctx.validTargets((c) => c.onField);
        if (ts.length) await ctx.toHand(ts);
      },
      ai: { score: (ctx) => (ctx.field('opp').length && ctx.hand().length ? 40 : 0) },
    },
  ],
});

M('Neos Wiseman', {
  attribute: 'LIGHT',
  race: 'Spellcaster',
  level: 10,
  atk: 3000,
  def: 3000,
  cannotNormalSummon: true,
  nomi: true,
  aiValue: 800,
  text: 'This card cannot be Normal Summoned or Set. This card can only be Special Summoned by sending 1 face-up "Elemental Hero Neos" and 1 face-up "Yubel" you control to the Graveyard. This card cannot be destroyed by card effects. At the end of the Damage Step, if this card battled an opponent\'s monster, inflict damage to your opponent equal to the ATK of that monster, and you gain Life Points equal to that monster\'s DEF.',
  effects: [
    {
      kind: 'proc',
      label: 'Special Summon (send Neos and Yubel)',
      categories: ['specialSummon'],
      condition: (ctx) =>
        ctx.faceUpMonsters('me', (c) => c.name.toLowerCase() === 'elemental hero neos').length > 0 && ctx.faceUpMonsters('me', (c) => c.name === 'Yubel').length > 0,
      perform: async (ctx) => {
        const neos = ctx.faceUpMonsters('me', (c) => c.name.toLowerCase() === 'elemental hero neos')[0];
        const yubel = ctx.faceUpMonsters('me', (c) => c.name === 'Yubel')[0];
        if (!neos || !yubel) return false;
        await ctx.sendToGrave([neos, yubel], 'cost');
        return true;
      },
      ai: { score: () => 80 },
    },
    { kind: 'continuous', mods: [{ q: 'indestructibleEffect' }] },
    {
      kind: 'trigger',
      event: 'damageStepEnd',
      mandatory: true,
      label: 'Damage and LP',
      categories: ['damage', 'recover'],
      eventFilter: (ctx, ev) => {
        if (ctx.self.location !== 'mzone') return false;
        const a = evc(ev);
        const t = evo(ev);
        const o = a === ctx.self ? t : t === ctx.self ? a : undefined;
        // Any monster this card battled was controlled by the opponent (it may be owned by this card's controller).
        return !!o;
      },
      resolve: async (ctx) => {
        const ev = ctx.event!;
        const a = evc(ev);
        const t = evo(ev);
        const o = (a === ctx.self ? t : a)!;
        // https://edisonrul.ing/cards/n/neos-wiseman.html — destroyed: its original ATK/DEF; still on the field: its
        // current ATK/DEF; returned to the hand/Deck or flipped face-down before the end of the Damage Step: no effect.
        if (!(o.location === 'mzone' && o.faceUp) && o.location !== 'grave' && o.location !== 'banished') return;
        const atk = o.location === 'mzone' && o.faceUp ? ctx.atk(o) : o.data.atk ?? 0;
        const def = o.location === 'mzone' && o.faceUp ? ctx.def(o) : o.data.def ?? 0;
        await ctx.damage(ctx.opp, atk);
        await ctx.recover(ctx.player, def);
      },
    },
  ],
});

M(LION, {
  attribute: 'EARTH',
  race: 'Plant',
  level: 4,
  atk: 1600,
  def: 2000,
  aiValue: 200,
  text: 'This card gains 300 ATK for each face-up Plant-Type monster you control. Control of this face-up card cannot switch.',
  effects: [{ kind: 'continuous', mods: [{ q: 'atk', value: (ctx) => 300 * ctx.faceUpMonsters('me', isPlant).length }] }],
});

M('Elemental HERO Divine Neos', {
  attribute: 'LIGHT',
  race: 'Warrior',
  level: 12,
  atk: 2500,
  def: 2500,
  types: ['fusion'],
  sets: ['hero', 'elemental-hero'],
  nomi: true,
  aiValue: 600,
  fusion: {
    materials: [isNeos, isNeoSpacian, isHero, isNeosFamily, isNeosFamily],
    desc: '5 "Neos", "Neo-Spacian" and/or "HERO" monsters (at least 1 "Neos", 1 "Neo-Spacian" and 1 "HERO")',
  },
  text: 'This card can only be Fusion Summoned with 5 "Neos", "Neo-Spacian" and/or "HERO" monsters as Fusion Material Monsters, including at least 1 "Neos", 1 "Neo-Spacian" and 1 "HERO" monster. Once per turn, you can remove from play 1 "Neos", "Neo-Spacian" or "HERO" monster from your Graveyard. This card gains 500 ATK, and until the End Phase, this card gains the removed monster\'s effects.',
  effects: [
    {
      // APPROX: the ATK gain is applied; the removed monster's effects are not copied.
      kind: 'ignition',
      opt: true,
      label: 'Banish a Neos/Neo-Spacian/HERO: +500 ATK',
      categories: ['atkChange'],
      canActivate: (ctx) => ctx.grave('me', isNeosFamily).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', isNeosFamily), 1, 1, 'Remove from play 1 "Neos", "Neo-Spacian" or "HERO" monster from your Graveyard.', 'cost', {
          aiScore: (c) => -(c.data.aiValue ?? 0),
        });
        if (!sel.length) return false;
        await ctx.banish(sel, 'cost');
      },
      resolve: async (ctx) => {
        if (faceUpOn(ctx.self)) ctx.addTempMod(ctx.self, 'atk', 500, 'field');
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' ? 40 : 10) },
    },
  ],
});

// ============================================================ SPELLS

/** Equip Spell activation: target a face-up monster passing `filter`, then equip. */
function equipSpell(filter: (ctx: Ctx, c: C) => boolean, score: (ctx: Ctx) => number, onEquip?: (ctx: Ctx, t: C) => Promise<void>): EffectDef {
  const cands = (ctx: Ctx) => ctx.faceUpMonsters('both', (c) => filter(ctx, c));
  return {
    kind: 'activate',
    categories: ['atkChange'],
    canActivate: (ctx) => cands(ctx).some((c) => ctx.canTarget(c)),
    activate: async (ctx) => {
      await ctx.selectTargets(cands(ctx), 1, 1, 'Select 1 face-up monster to equip this card to.', 'equip', {
        aiScore: (c) => (c.controller === ctx.player ? ctx.atk(c) : -1),
      });
    },
    resolve: async (ctx) => {
      const [t] = ctx.validTargets((c) => faceUpOn(c) && filter(ctx, c));
      if (!t || !ctx.self.onField || !ctx.self.faceUp) return;
      ctx.equip(t);
      if (onEquip) await onEquip(ctx, t);
    },
    ai: { score },
  };
}
const equippedTo = (ctx: Ctx, c: C) => c === ctx.equipTarget;

S('Card Rotator', 'normal', {
  text: 'Send 1 card from your hand to the Graveyard. Change the battle positions of all monsters your opponent controls. (Face-down Defense Position monsters are flipped to face-up Attack Position.)',
  effects: [
    {
      kind: 'activate',
      categories: ['position'],
      canActivate: (ctx) => ctx.hand('me', (c) => c !== ctx.self).length > 0 && ctx.monsters('opp').length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.hand('me', (c) => c !== ctx.self), 1, 1, 'Send 1 card from your hand to the Graveyard.', 'cost', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        await ctx.sendToGrave(sel, 'cost');
      },
      resolve: async (ctx) => {
        for (const m of ctx.monsters('opp')) {
          if (!ctx.canTarget(m) && ctx.game.isUnaffected(m, ctx.self, ctx.player)) continue;
          if (!m.faceUp) await ctx.changePos(m, 'atk', true);
          else await ctx.changePos(m, m.pos === 'atk' ? 'def' : 'atk', true);
        }
      },
      ai: {
        score: (ctx) => {
          if (ctx.phase !== 'main1') return 0;
          const myBest = Math.max(0, ...ctx.faceUpMonsters('me', (c) => c.pos === 'atk').map((c) => ctx.atk(c)));
          const opp = ctx.monsters('opp');
          const gain = opp.filter((m) => (m.faceUp ? (m.pos === 'def' ? ctx.atk(m) < myBest : ctx.def(m) < myBest) : (m.data.atk ?? 0) < myBest)).length;
          return gain >= 2 ? 35 : 0;
        },
      },
    },
  ],
});

S('Seed of Deception', 'quickplay', {
  text: 'Special Summon 1 Level 2 or lower Plant-Type monster from your hand.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.hand('me', (c) => isPlant(c) && lvl(c) <= 2 && ctx.canSummonCard(c)).length > 0,
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => isPlant(c) && lvl(c) <= 2 && ctx.canSummonCard(c));
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Level 2 or lower Plant-Type monster from your hand.', 'specialSummon', {
          aiScore: (x) => (x.data.aiValue ?? 0) + (x.data.atk ?? 0),
        });
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
      ai: { score: (ctx) => (isMain(ctx) && ctx.isMyTurn ? 35 : 0) },
    },
  ],
});

S('Mark of the Rose', 'equip', {
  text: 'Activate this card by removing from play 1 Plant-Type monster from your Graveyard. Equip only to a monster your opponent controls. Take control of the equipped monster. During each of your End Phases, the control of the equipped monster returns to your opponent until your next Standby Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['control'],
      canActivate: (ctx) => ctx.grave('me', isPlant).length > 0 && ctx.freeMZones() > 0 && ctx.faceUpMonsters('opp', (c) => ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(ctx.grave('me', isPlant), 1, 1, 'Remove from play 1 Plant-Type monster from your Graveyard.', 'cost', { aiScore: (c) => -(c.data.aiValue ?? 0) });
        if (!sel.length) return false;
        await ctx.banish(sel, 'cost');
        await ctx.selectTargets(ctx.faceUpMonsters('opp'), 1, 1, 'Select 1 face-up monster your opponent controls to equip this card to.', 'control', {
          aiScore: (c) => cardValue(ctx.game, c),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c) && c.controller === ctx.opp);
        if (!t || !ctx.self.onField || !ctx.self.faceUp) return;
        ctx.equip(t);
        if (await ctx.game.takeControl(t, ctx.player, false)) {
          gs(ctx.game).marks.push({ mark: ctx.self, markMoveId: ctx.self.moveId, host: t, hostMoveId: t.moveId });
        }
      },
      ai: {
        score: (ctx) => {
          const best = bestTarget(ctx.game, ctx.faceUpMonsters('opp'));
          return best && cardValue(ctx.game, best) >= 1800 && isMain(ctx) ? 55 : 0;
        },
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Control returns until your next Standby Phase',
      categories: ['control'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && stActive(ctx) && !!ctx.equipTarget && ctx.equipTarget.controller === ctx.player,
      resolve: async (ctx) => {
        const t = ctx.equipTarget;
        if (!t || !stActive(ctx) || t.controller !== ctx.player) return;
        await ctx.game.takeControl(t, ctx.opp, false);
      },
    },
    {
      kind: 'trigger',
      event: 'phaseStart',
      mandatory: true,
      label: 'Take control again',
      categories: ['control'],
      eventFilter: (ctx, ev) => ev.phase === 'standby' && ctx.isMyTurn && stActive(ctx) && !!ctx.equipTarget && ctx.equipTarget.controller !== ctx.player,
      resolve: async (ctx) => {
        const t = ctx.equipTarget;
        if (!t || !stActive(ctx) || t.controller === ctx.player) return;
        await ctx.game.takeControl(t, ctx.player, false);
      },
    },
  ],
});

/** Black Garden: halve the ATK of face-up Summoned monsters and give their controller's opponent a Rose Token. */
S(GARDEN, 'field', {
  text: 'When a monster is Normal Summoned or Special Summoned (except by the effect of "Black Garden"), its ATK is halved, and its controller Special Summons 1 "Rose Token" (Plant-Type/DARK/Level 2/ATK 800/DEF 800) in Attack Position on their opponent\'s side of the field. You can destroy this card and all Plant-Type monsters on the field to Special Summon 1 monster from your Graveyard with ATK equal to the total ATK of the destroyed Plant-Type monsters.',
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      ai: { score: (ctx) => (ctx.isMyTurn && isMain(ctx) ? 15 : 0) },
    },
    {
      kind: 'trigger',
      event: 'summoned',
      mandatory: true,
      label: 'Halve ATK and Summon a Rose Token',
      categories: ['atkChange', 'specialSummon'],
      // 2010 rulings: it also activates for a monster Special Summoned face-down (its ATK is not halved, but the Rose
      // Token is still Summoned), and once for monsters Summoned at the same time: a single Rose Token (one for each
      // player whose monsters were Summoned, e.g. "The Shallow Grave"). No token if the monster left the field.
      // https://edisonrul.ing/cards/b/black-garden.html
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && ev.method !== 'flip' && c.location === 'mzone' && !gs(ctx.game).gardenBusy && stActive(ctx);
      },
      condition: (ctx) => stActive(ctx),
      resolve: async (ctx) => {
        const g = ctx.game;
        const ev = ctx.event!;
        const mons = [...new Set(g.eventLog.filter((e) => e.batch === ev.batch && e.type === 'summoned' && e.method !== 'flip').map((e) => evc(e)!))].filter(
          (c) => !!c && c.location === 'mzone',
        );
        for (const m of mons) {
          if (!faceUpOn(m)) continue;
          const half = Math.floor(g.getAtk(m) / 2);
          g.addTempMod(m, 'atk', -(g.getAtk(m) - half), 'field', ctx.self);
          ctx.log(`${m.name}'s ATK is halved to ${g.getAtk(m)} (Black Garden).`);
        }
        const s = gs(g);
        s.gardenBusy++;
        try {
          for (const ctrl of [...new Set(mons.map((m) => m.controller))]) {
            if (g.freeMZones(g.opp(ctrl)) <= 0 || g.queryPlayer(ctrl, 'cannotSpecialSummon')) continue;
            await g.createTokens(ctrl, ROSE_TOKEN, 1, 'atk', g.opp(ctrl));
          }
        } finally {
          s.gardenBusy--;
        }
      },
    },
    {
      kind: 'ignition',
      label: 'Destroy this card and all Plants: Special Summon',
      categories: ['destroy', 'specialSummon'],
      range: ['fzone'],
      // 2010 rulings: it cannot be activated without a Plant-Type monster on the field. At resolution, Black Garden
      // and the Plants must be destroyed, and the target is Summoned only if its ATK still equals the Plants' total
      // ATK; if Black Garden already left the field, nothing is destroyed. https://edisonrul.ing/cards/b/black-garden.html
      canActivate: (ctx) => {
        if (!ctx.faceUpMonsters('both', isPlant).length) return false;
        const total = ctx.faceUpMonsters('both', isPlant).reduce((a, c) => a + ctx.atk(c), 0);
        return ctx.grave('me', (c) => c.isMonster && (c.data.atk ?? 0) === total && ctx.canSummonCard(c)).length > 0;
      },
      activate: async (ctx) => {
        const total = ctx.faceUpMonsters('both', isPlant).reduce((a, c) => a + ctx.atk(c), 0);
        await ctx.selectTargets(ctx.grave('me', (c) => c.isMonster && (c.data.atk ?? 0) === total && ctx.canSummonCard(c)), 1, 1, 'Select 1 monster in your Graveyard.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        if (!ctx.self.onField) return;
        const plants = ctx.monsters('both', (c) => c.faceUp && isPlant(c));
        const total = plants.reduce((a, c) => a + ctx.atk(c), 0);
        const all = [ctx.self, ...plants].filter((c) => c.onField);
        await ctx.destroy(all);
        if (!plants.length || plants.some((c) => c.onField) || ctx.self.onField) return;
        const [t] = ctx.validTargets((c) => c.location === 'grave' && (c.data.atk ?? 0) === total);
        if (t && ctx.canSummonCard(t)) await ctx.specialSummon(t, { pos: 'choose' });
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.faceUpMonsters('me', isPlant).reduce((a, c) => a + cardValue(ctx.game, c), 0);
          const theirs = ctx.faceUpMonsters('opp', isPlant).reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return theirs + 1500 >= mine ? 50 : 0;
        },
      },
    },
  ],
});

S('Factory of 100 Machines', 'quickplay', {
  text: 'Remove from play all "Morphtronic" monsters from your Graveyard. Select 1 face-up Machine-Type monster you control. It gains 200 ATK for each card removed from play by this effect, until the End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange', 'banish'],
      canActivate: (ctx) => ctx.grave('me', isMorphMon).length > 0 && ctx.faceUpMonsters('me', (c) => raceIs(c, 'Machine') && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => raceIs(c, 'Machine')), 1, 1, 'Select 1 face-up Machine-Type monster you control.', 'buff', { aiScore: (c) => ctx.atk(c) });
      },
      resolve: async (ctx) => {
        const gy = ctx.grave('me', isMorphMon);
        const r = await ctx.banish(gy);
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        if (t) ctx.addTempMod(t, 'atk', 200 * r.filter((c) => c.location === 'banished').length, 'turn');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || !b.inDamageStep) return ctx.grave('me', isMorphMon).length >= 4 && ctx.phase === 'main1' ? 20 : 0;
          return expectedBattleDamage(ctx.game, ctx.player) > 0 ? 50 : 0;
        },
      },
      damageStep: true,
    },
  ],
});

S('Morphtronic Accelerator', 'normal', {
  text: 'Return 1 "Morphtronic" monster from your hand to the Deck. Destroy 1 card on the field, and draw 1 card.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'draw'],
      // Rulings (Yugipedia, Card Rulings:Morphtronic Accelerator): it targets 1 card on the field; returning the
      // "Morphtronic" monster is part of the effect, not a cost; if the target is not destroyed, you do not draw.
      canActivate: (ctx) => ctx.hand('me', isMorphMon).length > 0 && ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0 && ctx.deck().length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, 1, 'Target 1 card on the field to destroy.', 'destroy', {
          aiScore: (x) => (x.controller === ctx.opp ? cardValue(ctx.game, x) : -5000),
        });
      },
      resolve: async (ctx) => {
        const morphs = ctx.hand('me', isMorphMon);
        if (!morphs.length) return;
        const sel = await ctx.select(morphs, 1, 1, 'Return 1 "Morphtronic" monster from your hand to the Deck.', 'toDeck', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return;
        await ctx.toDeck(sel, 'shuffle');
        if (sel[0].location !== 'deck') return;
        const ts = ctx.validTargets((c) => c.onField);
        if (!ts.length) return;
        const d = await ctx.destroy(ts);
        if (d.length) await ctx.draw(1);
      },
      ai: { score: (ctx) => (ctx.field('opp').length ? 50 : 0) },
    },
  ],
});

S('Morphtronic Cord', 'equip', {
  text: 'Equip only to a "Morphtronic" monster. Each time the equipped monster\'s battle position is changed, destroy 1 Spell or Trap Card on the field.',
  effects: [
    equipSpell((_ctx, c) => isMorphMon(c), (ctx) => (isMain(ctx) && ctx.faceUpMonsters('me', isMorphMon).length ? 25 : 0)),
    {
      kind: 'trigger',
      event: 'positionChanged',
      mandatory: true,
      label: 'Destroy 1 Spell/Trap',
      categories: ['destroy'],
      eventFilter: (ctx, ev) => !!ctx.equipTarget && ev.card === ctx.equipTarget && stActive(ctx) && evc(ev)!.faceUp,
      condition: (ctx) => ctx.spellTraps('both').length > 0,
      // 2010 ruling: mandatory and targets 1 Spell or Trap Card (itself if it is the only one).
      // https://edisonrul.ing/cards/m/morphtronic-cord.html
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.spellTraps('both'), 1, 1, 'Target 1 Spell or Trap Card on the field to destroy.', 'destroy', {
          aiScore: (x) => (x.controller === ctx.opp ? cardValue(ctx.game, x) : x === ctx.self ? -9000 : -5000),
        });
      },
      resolve: async (ctx) => {
        const [c] = ctx.validTargets((x) => x.onField);
        if (c) await ctx.destroy(c);
      },
    },
  ],
});

S('Morphtronic Engine', 'equip', {
  text: 'Equip only to a Level 3 "Morphtronic" monster. Its ATK becomes double its original ATK. During your second Standby Phase after this card\'s activation, destroy this card, and take damage equal to the original ATK of the equipped monster.',
  effects: [
    equipSpell(
      (_ctx, c) => isMorphMon(c) && lvl(c) === 3,
      (ctx) => (ctx.phase === 'main1' && ctx.faceUpMonsters('me', (c) => isMorphMon(c) && lvl(c) === 3 && c.pos === 'atk').length ? 30 : 0),
      async (ctx) => {
        // Counted by the Standby Phase trigger below.
        ctx.self.flags.morphEngine = { mid: ctx.self.moveId, standbys: 0, player: ctx.player };
      },
    ),
    {
      // https://edisonrul.ing/cards/m/morphtronic-engine.html — "The effect to destroy the equipped 'Morphtronic' monster
      // during your second Standby Phase after activating 'Morphtronic Engine' starts a Chain." A skipped Standby Phase
      // does not count; if this card cannot be destroyed it stays equipped.
      kind: 'trigger',
      event: 'phaseStart',
      range: ['szone'],
      mandatory: true,
      label: 'Second Standby Phase: destroy this card and take damage',
      categories: ['destroy', 'damage'],
      eventFilter: (ctx, ev) => {
        const m = ctx.self.flags.morphEngine as { mid: number; standbys: number; player: PlayerId } | undefined;
        if (ev.phase !== 'standby' || !m || m.mid !== ctx.self.moveId || ctx.game.turnPlayer !== m.player) return false;
        m.standbys++;
        return m.standbys === 2;
      },
      resolve: async (ctx) => {
        const self = ctx.self;
        if (!self.onField) return;
        const host = self.equippedTo != null ? ctx.game.card(self.equippedTo) : undefined;
        const dmg = host?.data.atk ?? 0;
        ctx.game.log(`${self.name}: its time is up.`, 'action', self.controller);
        await ctx.game.destroy([self], 'effect', self.controller, self);
        await ctx.game.damage(self.controller, dmg, 'effect', self, self.controller);
      },
    },
    // 2010 ruling: extra copies on the same monster are redundant (only the first one doubles its original ATK).
    // https://edisonrul.ing/cards/m/morphtronic-engine.html
    {
      kind: 'continuous',
      mods: [
        {
          q: 'atk',
          to: 'cards',
          filter: (ctx, c: C) =>
            equippedTo(ctx, c) && ctx.game.equipsOf(c).find((e) => e.name === 'Morphtronic Engine' && e.faceUp && !ctx.game.isNegated(e)) === ctx.self,
          value: (ctx, c: C) => ctx.game.baseAtk(c),
        },
      ],
    },
  ],
});

S('Poison Chain', 'continuous', {
  text: 'During the End Phase of your turn, if you did not attack, you can make your opponent send cards equal to the number of face-up "Iron Chain" monsters you control from the top of their Deck to the Graveyard.',
  effects: [
    { kind: 'activate', categories: ['mill'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isIronChain).length ? 20 : 5) } },
    {
      kind: 'trigger',
      event: 'phaseStart',
      when: true,
      label: 'Send cards from the top of the opponent\'s Deck',
      categories: ['mill'],
      eventFilter: (ctx, ev) => ev.phase === 'end' && ctx.isMyTurn && stActive(ctx),
      condition: (ctx) =>
        stActive(ctx) &&
        ctx.faceUpMonsters('me', isIronChain).length > 0 &&
        // https://edisonrul.ing/cards/p/poison-chain.html — does not activate if the opponent's Deck has fewer cards than
        // the number of "Iron Chain" monsters you control.
        ctx.deck('opp').length >= ctx.faceUpMonsters('me', isIronChain).length &&
        !turnEvents(ctx.game).some((e) => e.type === 'attackDeclared' && e.player === ctx.player),
      resolve: async (ctx) => {
        const n = ctx.faceUpMonsters('me', isIronChain).length;
        if (n) await ctx.mill(n, ctx.opp);
      },
    },
  ],
});

S('Paralyzing Chain', 'continuous', {
  text: "When a card(s) is sent from your opponent's Deck to the Graveyard by a card effect, inflict 300 damage to your opponent.",
  effects: [
    { kind: 'activate', categories: ['damage'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', isIronChain).length ? 20 : 5) } },
    {
      kind: 'trigger',
      event: 'milled',
      mandatory: true,
      label: '300 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => evc(ev)?.owner === ctx.opp && ev.reason === 'effect' && stActive(ctx),
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 300);
      },
    },
  ],
});

S('Teleport', 'continuous', {
  text: 'Once per turn, if your opponent controls a monster and you control no monsters, you can pay 800 Life Points to Special Summon 1 Psychic-Type monster from your hand.',
  effects: [
    { kind: 'activate', categories: ['specialSummon'], ai: { score: (ctx) => (ctx.hand('me', isPsychic).length ? 20 : 0) } },
    {
      kind: 'ignition',
      opt: true,
      label: 'Pay 800: Special Summon a Psychic-Type monster',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.monsters('opp').length > 0 && ctx.monsters('me').length === 0,
      canActivate: (ctx) => ctx.lp > 800 && ctx.canSpecialSummon() && ctx.hand('me', (c) => isPsychic(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.payLp(800);
      },
      resolve: async (ctx) => {
        const cands = ctx.hand('me', (c) => isPsychic(c) && ctx.canSummonCard(c));
        const [c] = await ctx.select(cands, 1, 1, 'Special Summon 1 Psychic-Type monster from your hand.', 'specialSummon', { aiScore: (x) => (x.data.atk ?? 0) + (x.data.aiValue ?? 0) });
        if (c) await ctx.specialSummon(c, { pos: 'choose' });
      },
      ai: { score: (ctx) => (ctx.lp > 2000 ? 50 : 0) },
    },
  ],
});

S('Psychokinesis', 'normal', {
  text: 'Activate only while you control a face-up Psychic-Type monster. Select and destroy 1 card on the field. You take 1000 damage.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'damage'],
      condition: (ctx) => ctx.faceUpMonsters('me', isPsychic).length > 0,
      canActivate: (ctx) => ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, 1, 'Select 1 card on the field to destroy.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000),
        });
      },
      resolve: async (ctx) => {
        const ts = ctx.validTargets((c) => c.onField);
        // https://edisonrul.ing/cards/p/psychokinesis.html — destroying and the 1000 damage happen at the same time: if the
        // target left the field in the chain, no damage is inflicted.
        if (!ts.length) return;
        await ctx.destroy(ts);
        await ctx.game.damage(ctx.player, 1000, 'effect', ctx.self, ctx.player);
      },
      ai: { score: (ctx) => (ctx.lp > 2500 && ctx.field('opp').length ? 50 : 0) },
    },
  ],
});

S('Miracle Fertilizer', 'continuous', {
  text: 'Once per turn, you can Special Summon 1 Plant-Type monster from your Graveyard. You cannot Normal Summon or Set the turn you activate this effect. When the monster Special Summoned by this effect is removed from the field, destroy this card.',
  effects: [
    { kind: 'activate', categories: ['specialSummon'], ai: { score: (ctx) => (ctx.grave('me', isPlant).length ? 30 : 5) } },
    {
      kind: 'ignition',
      opt: true,
      label: 'Special Summon a Plant-Type monster from the GY',
      categories: ['specialSummon'],
      condition: (ctx) => !turnEvents(ctx.game).some((e) => (e.type === 'normalSummoned' || e.type === 'monsterSet') && e.player === ctx.player),
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isPlant(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isPlant(c) && ctx.canSummonCard(c)), 1, 1, 'Select 1 Plant-Type monster in your Graveyard.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (!t || !ctx.self.onField) return;
        const r = await ctx.specialSummon(t, { pos: 'choose' });
        // 2010 ruling: if the targeted Plant is removed in response, you can still Normal Summon or Set that turn;
        // once a monster is Special Summoned, the restriction stays even if this card leaves the field.
        // https://edisonrul.ing/cards/m/miracle-fertilizer.html
        if (r.length) {
          ctx.addPlayerMod(ctx.player, 'cannotNormalSummon');
          ctx.addPlayerMod(ctx.player, 'cannotSet');
        }
        if (r.length && ctx.self.onField) ctx.game.link(ctx.self, r[0], false);
      },
      ai: { score: (ctx) => (ctx.game.players[ctx.player].normalSummonsLeft <= 0 || ctx.grave('me', (c) => isPlant(c) && (c.data.atk ?? 0) >= 1500).length ? 55 : 20) },
    },
  ],
});

S('Fragrance Storm', 'normal', {
  text: 'Select and destroy 1 face-up Plant-Type monster on the field. Draw 1 card. If it is a Plant-Type monster, you can show it to your opponent and draw 1 more card.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'draw'],
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => isPlant(c) && ctx.canTarget(c)).length > 0 && ctx.deck().length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', isPlant), 1, 1, 'Select 1 face-up Plant-Type monster on the field.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        const ts = ctx.validTargets((c) => faceUpOn(c));
        if (!ts.length) return;
        const d = await ctx.destroy(ts);
        if (!d.length) return;
        const [c] = await ctx.draw(1);
        if (c && isPlant(c) && (await ctx.confirm(`Reveal ${c.name} and draw 1 more card?`))) {
          await reveal(ctx, [c]);
          await ctx.draw(1);
        }
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('opp', isPlant).length || ctx.faceUpMonsters('me', (c) => isPlant(c) && c.isToken).length ? 40 : 0) },
    },
  ],
});

S('The World Tree', 'continuous', {
  text: 'Each time a face-up Plant-Type monster(s) on the field is destroyed, place 1 Flower Counter on this card. You can remove any number of Flower Counters from this card to activate these effects.\n● 1 Counter: Select 1 Plant-Type monster on the field. It gains 400 ATK and DEF until the End Phase.\n● 2 Counters: Select and destroy 1 card on the field.\n● 3 Counters: Select and Special Summon 1 Plant-Type monster from your Graveyard.',
  effects: [
    { kind: 'activate', categories: [], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone'], isPlant).length ? 20 : 0) } },
    {
      // Bookkeeping only (never activates): 1 Flower Counter per destruction of face-up Plant-Type monster(s).
      kind: 'trigger',
      event: 'destroyed',
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        if (c && ev.from === 'mzone' && ev.fromFaceUp && isPlant(c) && stActive(ctx) && ctx.self.flags.wtBatch !== ev.batch) {
          ctx.self.flags.wtBatch = ev.batch;
          ctx.self.counters.flower = (ctx.self.counters.flower ?? 0) + 1;
          ctx.game.log(`A Flower Counter is placed on ${ctx.self.name} (${ctx.self.counters.flower}).`, 'action', ctx.player);
        }
        return false;
      },
    },
    {
      kind: 'ignition',
      label: '1 Counter: +400 ATK/DEF to a Plant',
      categories: ['atkChange'],
      canActivate: (ctx) => (ctx.self.counters.flower ?? 0) >= 1 && ctx.faceUpMonsters('both', (c) => isPlant(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        ctx.self.counters.flower -= 1;
        await ctx.selectTargets(ctx.faceUpMonsters('both', isPlant), 1, 1, 'Select 1 Plant-Type monster on the field.', 'buff', { aiScore: (c) => (c.controller === ctx.player ? ctx.atk(c) : -1) });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        if (!t) return;
        ctx.addTempMod(t, 'atk', 400, 'turn');
        ctx.addTempMod(t, 'def', 400, 'turn');
      },
      ai: { score: (ctx) => (ctx.phase === 'main1' && ctx.faceUpMonsters('me', isPlant).length && (ctx.self.counters.flower ?? 0) === 1 ? 15 : 0) },
    },
    {
      kind: 'ignition',
      label: '2 Counters: destroy 1 card',
      categories: ['destroy'],
      canActivate: (ctx) => (ctx.self.counters.flower ?? 0) >= 2 && ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        ctx.self.counters.flower -= 2;
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 1, 1, 'Select 1 card on the field to destroy.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000),
        });
      },
      resolve: async (ctx) => {
        const ts = ctx.validTargets((c) => c.onField);
        if (ts.length) await ctx.destroy(ts);
      },
      ai: { score: (ctx) => (ctx.field('opp').length ? 45 : 0) },
    },
    {
      kind: 'ignition',
      label: '3 Counters: Special Summon a Plant from the GY',
      categories: ['specialSummon'],
      canActivate: (ctx) => (ctx.self.counters.flower ?? 0) >= 3 && ctx.canSpecialSummon() && ctx.grave('me', (c) => isPlant(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        ctx.self.counters.flower -= 3;
        await ctx.selectTargets(ctx.grave('me', (c) => isPlant(c) && ctx.canSummonCard(c)), 1, 1, 'Select 1 Plant-Type monster in your Graveyard.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (t) await ctx.specialSummon(t, { pos: 'choose' });
      },
      ai: { score: () => 50 },
    },
  ],
});

S('Everliving Underworld Cannon', 'continuous', {
  text: 'When a Zombie-Type monster is Special Summoned to your side of the field, inflict 800 damage to your opponent. This effect can only be activated once per turn.',
  effects: [
    { kind: 'activate', categories: ['damage'], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'grave', 'mzone'], isZombie).length >= 2 ? 25 : 5) } },
    {
      kind: 'trigger',
      event: 'specialSummoned',
      mandatory: true,
      opt: true,
      label: '800 damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.location === 'mzone' && c.controller === ctx.player && isZombie(c) && stActive(ctx);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, 800);
      },
    },
  ],
});

S('Secret Village of the Spellcasters', 'field', {
  text: 'If you control a Spellcaster-Type monster and your opponent does not, your opponent cannot activate Spell Cards. If you do not control a Spellcaster-Type monster, you cannot activate Spell Cards.',
  effects: [
    { kind: 'activate', categories: ['lockdown'], ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => raceIs(c, 'Spellcaster')).length ? 40 : 0) } },
    {
      kind: 'continuous',
      mods: [
        {
          q: 'cannotActivateSpells',
          to: 'players',
          filter: (ctx, p: PlayerId) => {
            const mine = ctx.faceUpMonsters('me', (c) => raceIs(c, 'Spellcaster')).length > 0;
            const theirs = ctx.faceUpMonsters('opp', (c) => raceIs(c, 'Spellcaster')).length > 0;
            if (p === ctx.opp) return mine && !theirs;
            return !mine;
          },
        },
      ],
    },
  ],
});

S('Omega Goggles', 'equip', {
  text: 'Equip only to a monster you control. Once per turn, you can look at 1 random card in your opponent\'s hand. The equipped monster cannot attack the turn you activate this effect.',
  effects: [
    equipSpell((ctx, c) => c.controller === ctx.player, (ctx) => (isMain(ctx) && ctx.faceUpMonsters('me').length && ctx.hand('opp').length ? 15 : 0)),
    {
      kind: 'ignition',
      opt: true,
      label: "Look at 1 random card in the opponent's hand",
      condition: (ctx) => stActive(ctx) && !!ctx.equipTarget,
      canActivate: (ctx) => ctx.hand('opp').length > 0,
      resolve: async (ctx) => {
        const h = ctx.hand('opp');
        // The attack restriction is applied by the continuous effect below, only while this card stays equipped.
        ctx.self.flags.gogglesTurn = ctx.turn;
        if (!h.length) return;
        const c = h[ctx.game.rng.int(h.length)];
        c.revealedUntil = ctx.turn;
        ctx.game.log(`${ctx.game.players[ctx.player].name} looks at 1 random card in ${ctx.game.players[ctx.opp].name}'s hand.`, 'action', ctx.player);
        await ctx.game.anim({ type: 'reveal', cards: [c.uid], player: ctx.player });
      },
      ai: { score: (ctx) => (ctx.phase === 'main2' ? 20 : 0) },
    },
    {
      // https://edisonrul.ing/cards/o/omega-goggles.html — if Omega Goggles is unequipped after using its effect, the
      // monster can attack this turn.
      kind: 'continuous',
      mods: [{ q: 'cannotAttack', to: 'cards', filter: (ctx, c: C) => c === ctx.equipTarget && ctx.self.flags.gogglesTurn === ctx.turn }],
    },
  ],
});

// ============================================================ TRAPS

T('Battle Mania', 'normal', {
  text: "Activate only during your opponent's Standby Phase. All face-up monsters your opponent controls are changed to Attack Position, and cannot change their battle positions this turn. All monsters your opponent currently controls must attack this turn, if able.",
  effects: [
    {
      kind: 'activate',
      categories: ['position'],
      condition: (ctx) => !ctx.isMyTurn && ctx.phase === 'standby' && ctx.monsters('opp').length > 0,
      resolve: async (ctx) => {
        const mons = ctx.monsters('opp');
        for (const m of mons) {
          if (!faceUpOn(m)) continue;
          if (m.pos !== 'atk') await ctx.changePos(m, 'atk');
          ctx.addTempMod(m, 'cannotChangePos', true, 'turn');
        }
        gs(ctx.game).mania.push({ p: ctx.opp, turn: ctx.turn, uids: new Set(mons.map((m) => m.uid)) });
        ctx.log(`All monsters ${ctx.game.players[ctx.opp].name} controls must attack this turn.`);
      },
      ai: {
        score: (ctx) => {
          const mine = ctx.monsters('me');
          const theirs = ctx.faceUpMonsters('opp');
          const weak = theirs.filter((t) => mine.some((m) => (m.faceUp ? (m.pos === 'atk' ? ctx.atk(m) : ctx.def(m)) : m.data.def ?? 0) > ctx.atk(t)));
          return weak.length ? 45 : 0;
        },
      },
    },
  ],
});

T('Confusion Chaff', 'normal', {
  text: 'Activate only when your opponent declares a second direct attack during the same Battle Phase. Conduct battle between the attacking monster and the first monster that attacked directly (other effects cannot be activated during this battle).',
  effects: [
    {
      // APPROX: the battle is resolved at once by comparing ATK/DEF (the loser is destroyed by battle); the Battle Damage
      // goes to the attacking player (who controls both monsters), without damage-reflection effects (Amazoness Swords Woman).
      // A face-down first attacker is flipped face-up and the battle is conducted normally:
      // https://edisonrul.ing/cards/c/confusion-chaff.html
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack', 'destroy'],
      eventFilter: (ctx, ev) => {
        const a = evc(ev);
        if (!a || a.controller !== ctx.opp || evo(ev)) return false;
        return !!firstDirectAttacker(ctx, a);
      },
      condition: (ctx) => !!ctx.battle && !ctx.battle.inDamageStep && !ctx.battle.target,
      resolve: async (ctx) => {
        const b = ctx.battle;
        if (!b) return;
        const a = b.attacker;
        const first = firstDirectAttacker(ctx, a);
        ctx.negateAttack();
        if (!first || !faceUpOn(a) || first.location !== 'mzone') return;
        if (!first.faceUp) await ctx.changePos(first, first.pos, true);
        if (!faceUpOn(first)) return;
        ctx.log(`Confusion Chaff: ${a.name} battles ${first.name}.`);
        const atkA = ctx.atk(a);
        const vs = first.pos === 'atk' ? ctx.atk(first) : ctx.def(first);
        const losers: C[] = [];
        if (first.pos === 'atk') {
          if (atkA >= vs && atkA > 0) losers.push(first);
          if (vs >= atkA && vs > 0) losers.push(a);
        } else if (atkA > vs) losers.push(first);
        const dmg = first.pos === 'atk' ? Math.abs(atkA - vs) : Math.max(0, vs - atkA);
        if (dmg > 0 && !ctx.game.queryPlayer(ctx.opp, 'noBattleDamage')) await ctx.game.damage(ctx.opp, dmg, 'battle', atkA >= vs ? a : first, ctx.opp);
        const dead = losers.filter((c) => ctx.game.canDestroy(c, 'battle'));
        if (dead.length) await ctx.game.destroy(dead, 'battle', ctx.opp, a);
      },
      ai: { score: () => 60 },
    },
  ],
});
/** The monster `ctx.opp` attacked directly with earlier this turn (still on the field), other than `attacker`. */
function firstDirectAttacker(ctx: Ctx, attacker: C): C | undefined {
  const list = (ctx.game.turnData['csoc:direct'] ?? []) as { card: C; moveId: number }[];
  const direct = list.filter((d) => d.card.controller === ctx.opp);
  if (direct.length < 2) return undefined;
  const first = direct[0];
  if (first.card === attacker || first.card.moveId !== first.moveId || first.card.location !== 'mzone') return undefined;
  return first.card;
}

T('Urgent Tuning', 'normal', {
  text: 'Activate only during the Battle Phase. Synchro Summon 1 Synchro Monster.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      condition: (ctx) => ctx.phase === 'battle' && !ctx.battle?.inDamageStep,
      canActivate: (ctx) => ctx.extra('me', (c) => ctx.game.canSynchro(ctx.player, c)).length > 0,
      resolve: async (ctx) => {
        // The Synchro Summon is performed right after this Chain resolves (Game.resolveChain patch).
        gs(ctx.game).urgent.push(ctx.player);
      },
      ai: { score: (ctx) => (ctx.isMyTurn ? 55 : 40) },
    },
  ],
});

/**
 * Synchro Strike: Synchro Summoned and not flipped face-up since (2010 ruling: not one turned face-down by "Book of Moon"
 * and later Flip Summoned). https://edisonrul.ing/cards/s/synchro-strike.html
 */
function synchroSummonedStill(g: Game, c: C) {
  if (c.summonMethod !== 'synchro') return false;
  for (let i = g.eventLog.length - 1; i >= 0; i--) {
    const e = g.eventLog[i];
    if (e.card !== c) continue;
    if (e.type === 'flipped') return false;
    if (e.type === 'synchroSummoned') return true;
  }
  return true;
}

T('Synchro Strike', 'normal', {
  text: 'Select 1 Synchro Monster that was Synchro Summoned. It gains 500 ATK for each Synchro Material Monster used to Synchro Summon it, until the End Phase.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      damageStep: true,
      canActivate: (ctx) => ctx.faceUpMonsters('both', (c) => synchroSummonedStill(ctx.game, c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('both', (c) => synchroSummonedStill(ctx.game, c)), 1, 1, 'Select 1 Synchro Summoned monster.', 'buff', {
          aiScore: (c) => (c.controller === ctx.player ? 1000 + ctx.atk(c) : 0),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        if (!t) return;
        const n = ((t.flags.materials ?? []) as unknown[]).length || 2;
        ctx.addTempMod(t, 'atk', 500 * n, 'turn');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b) return 0;
          const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
          if (!mine || mine.summonMethod !== 'synchro' || !faceUpOn(mine)) return 0;
          return expectedBattleDamage(ctx.game, ctx.player) > 0 || (b.target && b.target.controller === ctx.player && ctx.atk(b.attacker) >= ctx.atk(b.target)) ? 55 : 0;
        },
      },
    },
  ],
});

T('Prideful Roar', 'normal', {
  text: "Activate only during damage calculation, when your monster battles an opponent's monster with higher ATK. Pay Life Points equal to the difference in ATK, and your monster gains ATK equal to the difference +300 during damage calculation only.",
  effects: [
    {
      kind: 'activate',
      damageStep: true,
      categories: ['atkChange'],
      condition: (ctx) => {
        const b = ctx.battle;
        if (!b || !b.inDamageStep || !b.target) return false;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target.controller === ctx.player ? b.target : null;
        const other = mine === b.attacker ? b.target : b.attacker;
        if (!mine || !other || !faceUpOn(mine) || !faceUpOn(other)) return false;
        const d = ctx.atk(other) - ctx.atk(mine);
        return d > 0 && ctx.lp > d;
      },
      activate: async (ctx) => {
        const b = ctx.battle!;
        const mine = b.attacker.controller === ctx.player ? b.attacker : b.target!;
        const other = mine === b.attacker ? b.target! : b.attacker;
        const d = ctx.atk(other) - ctx.atk(mine);
        ctx.data.mine = mine;
        ctx.data.d = d;
        await ctx.payLp(d);
      },
      resolve: async (ctx) => {
        const mine = ctx.data.mine as C;
        // https://edisonrul.ing/cards/p/prideful-roar.html — if your monster's ATK is no longer lower than the ATK of the
        // monster it battles when this resolves, the effect disappears.
        const b = ctx.battle;
        const other = b ? (mine === b.attacker ? b.target : b.attacker) : null;
        if (!other || !faceUpOn(other) || ctx.atk(mine) >= ctx.atk(other)) return;
        if (mine && faceUpOn(mine)) ctx.addTempMod(mine, 'atk', (ctx.data.d ?? 0) + 300, 'battle');
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (!b || !b.target) return 0;
          const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
          const other = mine === b.attacker ? b.target : b.attacker;
          const d = ctx.atk(other) - ctx.atk(mine);
          return d > 0 && d <= 1500 && ctx.lp - d >= 2500 && cardValue(ctx.game, other) >= 1800 ? 50 : 0;
        },
      },
    },
  ],
});

T('Revival Gift', 'normal', {
  text: 'Select 1 Tuner monster from your Graveyard and Special Summon it. Its effects are negated. Special Summon 2 "Gift Fiend Tokens" (Fiend-Type/DARK/Level 3/ATK 1500/DEF 1500) to your opponent\'s side of the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      // https://edisonrul.ing/cards/r/revival-gift.html — cannot be activated if the opponent has 1 or fewer empty Monster Zones.
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.freeMZones('opp') >= 2 && ctx.grave('me', (c) => c.isTuner && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => c.isTuner && ctx.canSummonCard(c)), 1, 1, 'Select 1 Tuner monster in your Graveyard.', 'specialSummon', {
          aiScore: (c) => lvl(c) * 100 + (c.data.atk ?? 0),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (t) {
          const r = await ctx.specialSummon(t, { pos: 'choose' });
          if (r.length) ctx.negateEffects(r[0], 'field');
        }
        const n = Math.min(2, ctx.freeMZones('opp'));
        if (n > 0) await tokensTo(ctx, GIFT_FIEND_TOKEN, n, 'atk', ctx.opp);
      },
      ai: { score: (ctx) => (ctx.isMyTurn && isMain(ctx) && ctx.faceUpMonsters('me').length && ctx.extra().length ? 30 : 0) },
    },
  ],
});

T('Lineage of Destruction', 'normal', {
  text: 'Activate only during a turn in which you destroyed a Defense Position monster your opponent controlled. Select 1 Level 8 monster you control. During this turn, the selected monster can attack twice.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      condition: (ctx) => ((ctx.game.turnData['csoc:defKills'] ?? []) as { by?: PlayerId; ctrl?: PlayerId }[]).some((k) => k.by === ctx.player && k.ctrl === ctx.opp),
      // 2010 ruling: cannot target a monster that can already attack twice in the same Battle Phase.
      // https://edisonrul.ing/cards/l/lineage-of-destruction.html
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => ctx.level(c) === 8 && ctx.game.queryCardNum(c, 'extraAttacks') <= 0 && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', (c) => ctx.level(c) === 8 && ctx.game.queryCardNum(c, 'extraAttacks') <= 0), 1, 1, 'Select 1 Level 8 monster you control.', 'buff');
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c));
        if (t) ctx.addTempMod(t, 'extraAttacks', 1, 'turn');
      },
      ai: { score: (ctx) => (ctx.isMyTurn && ctx.phase === 'battle' ? 45 : 0) },
    },
  ],
});

T('Doppelganger', 'continuous', {
  text: 'When you take damage from the effect of a monster your opponent controls, inflict the same amount of damage to your opponent.',
  effects: [
    { kind: 'activate', categories: ['damage'], ai: { score: () => 10 } },
    {
      kind: 'trigger',
      event: 'damage',
      mandatory: true,
      label: 'Inflict the same damage',
      categories: ['damage'],
      eventFilter: (ctx, ev) => {
        const src = ev.reasonCard as C | undefined;
        return ev.player === ctx.player && ev.reason === 'effect' && !!src && src.isMonster && ev.reasonPlayer === ctx.opp && src.controller === ctx.opp && stActive(ctx);
      },
      resolve: async (ctx) => {
        await ctx.damage(ctx.opp, ctx.event?.amount ?? 0);
      },
    },
  ],
});

T('Morphtransition', 'normal', {
  text: 'Activate only when a face-up "Morphtronic" monster you control is selected as an attack target. Negate the attack, and change the battle position of the selected "Morphtronic" monster.',
  effects: [
    {
      kind: 'activate',
      event: 'attackDeclared',
      categories: ['negateAttack', 'position'],
      eventFilter: (ctx, ev) => {
        const t = evo(ev);
        return !!t && t.controller === ctx.player && faceUpOn(t) && isMorphMon(t);
      },
      condition: (ctx) => !!ctx.battle && !ctx.battle.inDamageStep && !ctx.battle.negated,
      // 2010 rulings: targets both the attacking monster and the attack target; if the attacking monster is no longer
      // on the field, the "Morphtronic" monster's battle position cannot be changed. https://edisonrul.ing/cards/m/morphtransition.html
      canActivate: (ctx) => !!ctx.battle?.target && ctx.canTarget(ctx.battle.attacker) && ctx.canTarget(ctx.battle.target),
      activate: async (ctx) => {
        const b = ctx.battle!;
        ctx.data.attacker = b.attacker;
        ctx.data.target = b.target;
        ctx.addTargets([b.attacker, b.target!]);
      },
      resolve: async (ctx) => {
        const a = ctx.data.attacker as C;
        const t = ctx.data.target as C;
        const ok = ctx.validTargets();
        if (!ok.includes(a) || a.location !== 'mzone') return;
        ctx.negateAttack();
        if (ok.includes(t) && faceUpOn(t) && t.controller === ctx.player) await ctx.changePos(t, t.pos === 'atk' ? 'def' : 'atk');
      },
      ai: { score: (ctx) => (expectedBattleDamage(ctx.game, ctx.player) > 0 || (ctx.battle?.target && ctx.atk(ctx.battle.attacker) > (ctx.battle.target.pos === 'atk' ? ctx.atk(ctx.battle.target) : ctx.def(ctx.battle.target))) ? 55 : 0) },
    },
  ],
});

T('Morphtronic Monitron', 'continuous', {
  text: 'When a "Morphtronic" monster is Summoned, you can change it to face-up Defense Position.',
  effects: [
    { kind: 'activate', categories: ['position'], ai: { score: (ctx) => (ctx.cards('me', ['hand', 'mzone'], isMorphMon).length ? 15 : 0) } },
    {
      kind: 'trigger',
      event: 'summoned',
      when: true,
      label: 'Change it to Defense Position',
      categories: ['position'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && faceUpOn(c) && c.pos === 'atk' && isMorphMon(c) && stActive(ctx);
      },
      resolve: async (ctx) => {
        const c = evc(ctx.event!);
        if (c && faceUpOn(c) && c.pos === 'atk') await ctx.changePos(c, 'def');
      },
    },
  ],
});

T('Psychic Trigger', 'normal', {
  text: "Activate only while your Life Points are lower than your opponent's. Select 2 Psychic-Type monsters in your Graveyard. Remove them from play and draw 2 cards.",
  effects: [
    {
      kind: 'activate',
      categories: ['draw', 'banish'],
      condition: (ctx) => ctx.lp < ctx.oppLp,
      canActivate: (ctx) => ctx.grave('me', isPsychic).length >= 2 && ctx.deck().length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', isPsychic), 2, 2, 'Select 2 Psychic-Type monsters in your Graveyard.', 'banish', { aiScore: (c) => -(c.data.aiValue ?? 0) });
      },
      resolve: async (ctx) => {
        const ts = ctx.validTargets((c) => c.location === 'grave');
        if (ts.length < 2) return;
        await ctx.banish(ts);
        await ctx.draw(2);
      },
      ai: { score: () => 50 },
    },
  ],
});

T('Pollinosis', 'counter', {
  text: 'Activate only by Tributing 1 Plant-Type monster. Negate the Summon of a monster or the activation of a Spell or Trap Card, and destroy it.',
  effects: [
    {
      kind: 'activate',
      label: 'Negate Summon',
      negateSummon: true,
      categories: ['negateSummon'],
      condition: (ctx) => !!ctx.game.pendingSummon && ctx.game.pendingSummon.player === ctx.opp,
      canActivate: (ctx) => tributable(ctx, isPlant).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, isPlant), 1, 1, 'Tribute 1 Plant-Type monster.', 'tribute', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        ctx.game.negatePendingSummon();
      },
      ai: {
        score: (ctx) => {
          const cards = ctx.game.pendingSummon?.cards ?? [];
          const v = Math.max(0, ...cards.map((c) => cardValue(ctx.game, c)));
          const cheap = Math.min(...tributable(ctx, isPlant).map((c) => cardValue(ctx.game, c)));
          return v >= 2200 && v > cheap ? 60 + v / 100 : 0;
        },
      },
    },
    {
      kind: 'activate',
      label: 'Negate Spell/Trap',
      categories: ['negate'],
      condition: (ctx) => {
        const l = ctx.prevLink();
        return !!l && l.isCardActivation && l.player === ctx.opp;
      },
      canActivate: (ctx) => tributable(ctx, isPlant).length > 0,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, isPlant), 1, 1, 'Tribute 1 Plant-Type monster.', 'tribute', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        ctx.data.link = ctx.prevLink();
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        await ctx.negateAndDestroy(ctx.data.link as ChainLink);
      },
      ai: {
        score: (ctx) => {
          const l = ctx.prevLink();
          if (!l) return 0;
          const cats = l.effect.categories ?? [];
          return cats.includes('destroyMulti') || cats.includes('control') || (l.card.data.aiValue ?? 0) >= 500 || l.ctx.targets.some((t) => t.controller === ctx.player) ? 65 : 0;
        },
      },
    },
  ],
});

T('Bamboo Scrap', 'normal', {
  text: 'Tribute 1 Plant-Type monster. Special Summon 2 "Plant Tokens" (Plant-Type/EARTH/Level 1/ATK 800/DEF 500) to your opponent\'s side of the field in Defense Position.',
  effects: [
    {
      kind: 'activate',
      categories: ['specialSummon'],
      canActivate: (ctx) => tributable(ctx, isPlant).length > 0 && ctx.freeMZones('opp') >= 2,
      activate: async (ctx) => {
        const sel = await ctx.select(tributable(ctx, isPlant), 1, 1, 'Tribute 1 Plant-Type monster.', 'tribute', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        const n = Math.min(2, ctx.freeMZones('opp'));
        if (n > 0) await tokensTo(ctx, PLANT_TOKEN, n, 'def', ctx.opp);
      },
      ai: { score: (ctx) => (ctx.faceUpMonsters('me', (c) => isPlant(c) && c.isToken).length && ctx.cards('me', ['hand', 'mzone'], (c) => c.name === 'Black Rose Dragon').length ? 30 : 0) },
    },
  ],
});

/** Plant Food Chain was equipped (card → its moveId while equipped). */
const PFC_EQUIPPED = new WeakMap<C, number>();
T('Plant Food Chain', 'normal', {
  text: 'Equip this card to 1 Plant-Type monster you control. It gains 500 ATK. When this card is destroyed by a card effect while equipped, you can Special Summon 1 Plant-Type monster from your Graveyard.',
  effects: [
    {
      kind: 'activate',
      categories: ['atkChange'],
      damageStep: true,
      canActivate: (ctx) => ctx.faceUpMonsters('me', (c) => isPlant(c) && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.faceUpMonsters('me', isPlant), 1, 1, 'Select 1 Plant-Type monster you control.', 'equip', { aiScore: (c) => ctx.atk(c) });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => faceUpOn(c) && c.controller === ctx.player);
        if (!t || !ctx.self.onField) return;
        ctx.equip(t);
        ctx.self.flags.staysOnField = true;
        ctx.self.activeOnField = true;
        PFC_EQUIPPED.set(ctx.self, ctx.self.moveId);
      },
      ai: {
        score: (ctx) => {
          const b = ctx.battle;
          if (b && b.inDamageStep) {
            const mine = b.attacker.controller === ctx.player ? b.attacker : b.target;
            const other = mine === b.attacker ? b.target : b.attacker;
            if (mine && other && isPlant(mine) && faceUpOn(mine) && mine.pos === 'atk' && other.faceUp) {
              const vs = other.pos === 'atk' ? ctx.atk(other) : ctx.def(other);
              if (vs >= ctx.atk(mine) && vs < ctx.atk(mine) + 500) return 60;
            }
            return 0;
          }
          return ctx.isMyTurn && ctx.phase === 'main1' && ctx.faceUpMonsters('me', (c) => isPlant(c) && c.pos === 'atk').length ? 20 : 0;
        },
      },
    },
    {
      kind: 'continuous',
      active: (ctx) => ctx.self.flags.staysOnField === true,
      mods: [{ q: 'atk', to: 'cards', filter: equippedTo, value: 500 }],
    },
    {
      kind: 'trigger',
      event: 'destroyed',
      when: true,
      label: 'Special Summon a Plant-Type monster from the GY',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => ev.card === ctx.self && ev.from === 'szone' && reasonsOf(ev).includes('effect') && PFC_EQUIPPED.get(ctx.self) === ctx.self.moveId - 1,
      canActivate: (ctx) => ctx.canSpecialSummon() && ctx.grave('me', (c) => isPlant(c) && ctx.canSummonCard(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.grave('me', (c) => isPlant(c) && ctx.canSummonCard(c)), 1, 1, 'Select 1 Plant-Type monster in your Graveyard.', 'specialSummon', {
          aiScore: (c) => (c.data.atk ?? 0) + (c.data.aiValue ?? 0),
        });
      },
      resolve: async (ctx) => {
        const [t] = ctx.validTargets((c) => c.location === 'grave');
        if (t) await ctx.specialSummon(t, { pos: 'choose' });
      },
    },
  ],
});

T('Trap of the Imperial Tomb', 'normal', {
  text: "Activate only when a Zombie-Type monster is Special Summoned from your opponent's Graveyard to your opponent's side of the field. Select and destroy 2 cards on the field.",
  effects: [
    {
      kind: 'activate',
      event: 'specialSummoned',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && isZombie(c) && ev.from === 'grave' && c.owner === ctx.opp && c.location === 'mzone' && c.controller === ctx.opp;
      },
      canActivate: (ctx) => ctx.field('both', (c) => c !== ctx.self && ctx.canTarget(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.field('both', (c) => c !== ctx.self), 2, 2, 'Select 2 cards on the field to destroy.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -5000),
        });
      },
      resolve: async (ctx) => {
        const ts = ctx.validTargets((c) => c.onField);
        if (ts.length) await ctx.destroy(ts);
      },
      ai: { score: (ctx) => (ctx.field('opp').length >= 2 ? 60 : 0) },
    },
  ],
});

T('DNA Checkup', 'normal', {
  text: 'Select 1 face-down monster you control. Your opponent declares 2 Attributes. Reveal the selected monster. If its Attribute is one of the declared Attributes, your opponent draws 2 cards. If not, you draw 2 cards.',
  effects: [
    {
      kind: 'activate',
      categories: ['draw'],
      // Not while either player has fewer than 2 cards in the Deck: https://edisonrul.ing/cards/d/dna-checkup.html
      canActivate: (ctx) => ctx.deck('me').length >= 2 && ctx.deck('opp').length >= 2 && ctx.monsters('me', (c) => !c.faceUp && ctx.canTarget(c)).length > 0,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('me', (c) => !c.faceUp), 1, 1, 'Select 1 face-down monster you control.', 'target');
      },
      resolve: async (ctx) => {
        const g = ctx.game;
        const [t] = ctx.validTargets((c) => c.location === 'mzone' && !c.faceUp);
        if (!t) return;
        const guessA = g.rng.int(6);
        const i1 = await g.option(ctx.opp, 'DNA Checkup: declare the first Attribute.', ATTRS, ctx.self, (k) => (k === guessA ? 1 : 0));
        const rest = ATTRS.filter((_, k) => k !== i1);
        const guessB = g.rng.int(5);
        const i2 = await g.option(ctx.opp, 'DNA Checkup: declare the second Attribute.', rest, ctx.self, (k) => (k === guessB ? 1 : 0));
        const declared = [ATTRS[i1], rest[i2]];
        ctx.log(`${g.players[ctx.opp].name} declares ${declared.join(' and ')}.`);
        t.revealedUntil = ctx.turn;
        ctx.log(`The selected monster is ${t.name} (${t.data.attribute}).`);
        await g.anim({ type: 'reveal', cards: [t.uid], player: ctx.player });
        if (declared.includes(t.data.attribute as Attribute)) await ctx.draw(2, ctx.opp);
        else await ctx.draw(2, ctx.player);
      },
      ai: { score: (ctx) => (isMain(ctx) ? 25 : 0) },
    },
  ],
});

T(GOZEN, 'continuous', {
  text: 'Each player sends monsters they control to the Graveyard until they each control monsters of only 1 Attribute. Each player cannot control monsters with different Attributes.',
  // The Attribute rule is a state check and a Summon restriction (ensureCsocPatches).
  // APPROX: Flip Summons of another Attribute are allowed (the monster is then sent by the state check).
  effects: [
    {
      kind: 'activate',
      categories: ['lockdown'],
      ai: {
        score: (ctx) => {
          const attrs = (p: 'me' | 'opp') => new Set(ctx.faceUpMonsters(p).map((c) => c.data.attribute)).size;
          return attrs('opp') >= 2 && attrs('me') <= 1 ? 50 : 0;
        },
      },
    },
  ],
});

T('Giant Trap Hole', 'normal', {
  text: 'Activate only when 2 or more monsters are Special Summoned at the same time. Destroy all monsters on the field.',
  effects: [
    {
      kind: 'activate',
      event: 'specialSummoned',
      categories: ['destroy', 'destroyMulti'],
      eventFilter: (ctx, ev) => ctx.game.recentEvents.filter((e) => e.type === 'specialSummoned' && e.batch === ev.batch).length >= 2,
      resolve: async (ctx) => {
        await ctx.destroy(ctx.monsters('both'));
      },
      ai: {
        score: (ctx) => {
          const v = (p: 'me' | 'opp') => ctx.monsters(p).reduce((a, c) => a + cardValue(ctx.game, c), 0);
          return v('opp') > v('me') + 1500 ? 60 : 0;
        },
      },
    },
  ],
});

T('Treacherous Trap Hole', 'normal', {
  text: 'Activate only if there are no Trap Cards in your Graveyard. Select and destroy 2 monsters on the field.',
  effects: [
    {
      kind: 'activate',
      categories: ['destroy', 'destroyMulti'],
      condition: (ctx) => ctx.grave('me', (c) => c.isTrap).length === 0,
      canActivate: (ctx) => ctx.monsters('both', (c) => ctx.canTarget(c)).length >= 2,
      activate: async (ctx) => {
        await ctx.selectTargets(ctx.monsters('both'), 2, 2, 'Select 2 monsters on the field to destroy.', 'destroy', {
          aiScore: (c) => (c.controller === ctx.opp ? cardValue(ctx.game, c) : -cardValue(ctx.game, c)),
        });
      },
      resolve: async (ctx) => {
        const ts = ctx.validTargets((c) => c.location === 'mzone');
        if (ts.length) await ctx.destroy(ts);
      },
      ai: {
        score: (ctx) => {
          const opp = ctx.monsters('opp');
          if (opp.length >= 2) return 60;
          const myCheap = ctx.monsters('me', (c) => c.isToken || cardValue(ctx.game, c) < 1000);
          return opp.length === 1 && myCheap.length && cardValue(ctx.game, opp[0]) >= 2000 ? 45 : 0;
        },
      },
    },
  ],
});

T('Time Machine', 'normal', {
  text: "Activate only when a monster is destroyed by battle and sent to the Graveyard. Special Summon that monster to its controller's side of the field in the same battle position it was in when destroyed.",
  effects: [
    {
      kind: 'activate',
      event: 'battleDestroyed',
      categories: ['specialSummon'],
      eventFilter: (ctx, ev) => {
        const c = evc(ev);
        return !!c && c.location === 'grave';
      },
      canActivate: (ctx) => {
        const c = evc(ctx.event!);
        const ctrl = (ctx.event?.fromController ?? c?.owner) as PlayerId;
        // 2010 ruling: cannot be activated if both monsters were destroyed by the same battle.
        // https://edisonrul.ing/cards/t/time-machine.html
        const ev = ctx.event!;
        if (ev.dsId !== undefined && ctx.game.eventLog.some((e) => e.type === 'battleDestroyed' && e.dsId === ev.dsId && e.card !== c)) return false;
        return !!c && c.location === 'grave' && ctx.game.freeMZones(ctrl) > 0 && ctx.canSummonCard(c, ctrl === ctx.player ? 'me' : 'opp');
      },
      activate: async (ctx) => {
        const c = evc(ctx.event!)!;
        ctx.addTargets([c]);
        ctx.data.ctrl = ctx.event?.fromController ?? c.owner;
        ctx.data.pos = c.pos;
      },
      resolve: async (ctx) => {
        const [c] = ctx.validTargets((x) => x.location === 'grave');
        if (!c) return;
        await ctx.specialSummon(c, { pos: (ctx.data.pos as BattlePos) ?? 'atk', controller: ctx.data.ctrl as PlayerId });
      },
      ai: {
        score: (ctx) => {
          const c = evc(ctx.event!);
          const ctrl = ctx.event?.fromController ?? c?.owner;
          return c && ctrl === ctx.player && cardValue(ctx.game, c) >= 1800 ? 55 : 0;
        },
      },
    },
  ],
});

T('Virus Cannon', 'normal', {
  text: 'Tribute any number of monsters, except Tokens. Your opponent selects Spell Cards from their Deck equal to the number of Tributed monsters, and sends them to the Graveyard.',
  effects: [
    {
      kind: 'activate',
      categories: ['mill'],
      canActivate: (ctx) => tributable(ctx, (c) => !c.isToken).length > 0,
      activate: async (ctx) => {
        const cands = tributable(ctx, (c) => !c.isToken);
        const ai = isAi(ctx.game, ctx.player);
        const sel = await ctx.select(cands, 1, ai ? 1 : cands.length, 'Tribute any number of monsters, except Tokens.', 'tribute', { aiScore: (c) => -cardValue(ctx.game, c) });
        if (!sel.length) return false;
        ctx.data.n = sel.length;
        await tributeCost(ctx, sel);
      },
      resolve: async (ctx) => {
        const spells = ctx.deck('opp', (c) => c.isSpell);
        const n = Math.min(ctx.data.n ?? 0, spells.length);
        if (!n) return;
        const sel = await ctx.game.select(ctx.opp, spells, n, n, `Send ${n} Spell Card(s) from your Deck to the Graveyard.`, 'toGrave', {
          source: ctx.self,
          aiScore: (c) => -cardValue(ctx.game, c),
        });
        await ctx.game.sendToGrave(sel, 'effect', ctx.player, ctx.self);
        ctx.game.shuffleDeck(ctx.opp);
      },
      ai: { score: (ctx) => (ctx.monsters('me', (c) => !c.isToken && cardValue(ctx.game, c) < 1000).length && ctx.phase === 'end' && !ctx.isMyTurn ? 15 : 0) },
    },
  ],
});
