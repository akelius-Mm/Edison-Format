// Friends Locals test, without a browser: an organiser and 3–8 player "phones" (TourneyHost +
// TourneyClient each, over the in-memory transport). Every seat is an AI that reports human, as on
// a phone. Each pairing plays its match in its own room (room.ts lockstep) exactly like the app,
// reports it with the decision logs, and the organiser verifies every report by replaying it
// headlessly before it counts.
//
// Covered: 4, 5 and 8 players; Bo1 and Bo3 with siding; byes; a top cut to a champion; a tampered
// report (must become a dispute, never a result); a player whose phone dies mid-match (the
// opponent claims the games, the organiser accepts and drops the player); a voluntary drop; an
// intentional draw by agreement; the organiser's phone reloading mid-round (state restored from its
// save, players' queued reports re-sent); a spectator replaying a match from the feed to the same
// final board; standings checked against the Swiss rules; and the whole event replayed with the
// same seeds giving the identical result.
//
// Usage: npx tsx scripts/tourney-test.ts [--verbose] [--only <name>]
import { AIController, type Difficulty } from '../src/ai/ai';
import type { CardInstance } from '../src/engine/card';
import type { PlayerController } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import { RecordingController } from '../src/engine/replay';
import type { PlayerId } from '../src/engine/types';
import { PREMADE_DECKS, aiSideDeck, buildDeckList, type DeckDef } from '../src/decks';
import { MemoryHub, MemoryTransport } from '../src/net/memoryTransport';
import { newRoomCode, type WireDeck } from '../src/net/protocol';
import { AsHuman, RemoteController } from '../src/net/remote';
import { Room } from '../src/net/room';
import { SpectateClient, SpectateServer } from '../src/net/spectate';
import { TourneyHost, placeIn, viewStandings, type HostState } from '../src/net/tournament';
import { TourneyClient, reportFromRoom, type ClientSnapshot } from '../src/net/tourneyClient';
import type { TMatch, TView } from '../src/net/tourneyProtocol';
import { buildMatchGame, verifyReport } from '../src/net/verify';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const origError = console.error;
console.error = (...a: unknown[]) => {
  if (verbose) origError(...a);
};
const warnings: string[] = [];
console.warn = (...a: unknown[]) => {
  warnings.push(a.join(' '));
  if (verbose) origError(...a);
};

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`FAIL ${msg}`);
};
const check = (cond: unknown, msg: string) => {
  if (!cond) fail(msg);
  else if (verbose) console.log(`  ok ${msg}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BUILD = 'test-build';

async function waitFor(cond: () => boolean, ms: number, what: string) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(5);
  }
}

function wireDeck(d: DeckDef): WireDeck {
  const l = buildDeckList(d);
  const side = buildDeckList({ main: d.side ?? [], extra: [] }).main.map((c) => c.id);
  return { name: d.name, main: l.main.map((c) => c.id), extra: l.extra.map((c) => c.id), side };
}

function snapshot(g: Game): string {
  const ref = (c: CardInstance | null) => (c ? `${g.allCards.indexOf(c)}${c.faceUp ? 'u' : 'd'}${c.onField && c.isMonster ? c.pos : ''}` : '-');
  return JSON.stringify({ t: g.turn, w: g.winner, p: g.players.map((p) => ({ lp: p.lp, hand: p.hand.map(ref), deck: p.deck.map(ref), m: p.mzone.map(ref), s: p.szone.map(ref), gy: p.grave.map(ref), ban: p.banished.map(ref) })) });
}

/** Yields now and then, like a phone handing control back to the UI. */
function yielding(c: PlayerController): PlayerController {
  let n = 0;
  return new Proxy(c, {
    get(t, k) {
      const v = (t as any)[k];
      if (typeof v !== 'function') return v;
      return async (...a: unknown[]) => {
        if (++n % 8 === 0) await sleep(0);
        return v.apply(t, a);
      };
    },
  });
}

// ------------------------------------------------------------------ phones

interface Phone {
  name: string;
  id: string;
  deck: DeckDef;
  level: Difficulty;
  client: TourneyClient;
  saved: string;
  host?: TourneyHost;
  hostSaved?: string;
  /** Running match (one at a time). */
  run: { mid: string; attempt: number; room: Room; feed?: SpectateServer; games: Map<number, Game>; killed?: boolean; done?: boolean } | null;
  /** Finished matches' final boards (for the spectator check). */
  boards: Map<string, string[]>;
  /** Report a flipped result for this match id. */
  tamper?: string;
  /** Die mid-match in this round (the phone goes silent for good). */
  dieInRound?: number;
  dead?: boolean;
  /** Propose an intentional draw in this round. */
  idInRound?: number;
}

interface Scenario {
  name: string;
  players: number;
  bestOf: 1 | 3;
  topCut: 0 | 4 | 8;
  rounds?: number;
  seed: number;
  /** Organiser reloads after this many reported matches in round 2. */
  hostReload?: boolean;
  tamper?: boolean;
  die?: boolean;
  dropAfterRound?: number;
  id?: boolean;
  spectate?: boolean;
}

interface Outcome {
  placements: string[];
  results: string[];
  view: TView;
}

async function runScenario(sc: Scenario): Promise<Outcome> {
  const hub = new MemoryHub();
  let codeSeed = sc.seed;
  const code = newRoomCode(() => ((codeSeed = (codeSeed * 9301 + 49297) % 233280) / 233280));
  const names = ['Hana', 'Gus', 'Mei', 'Rio', 'Ada', 'Kai', 'Lux', 'Ned'];
  const levels: Difficulty[] = ['normal', 'hard', 'easy'];
  const decks = PREMADE_DECKS.filter((d) => (sc.bestOf === 3 ? (d.side?.length ?? 0) > 0 : true));
  const phones: Phone[] = [];
  const ht = { heartbeatMs: 40, timeoutMs: 1500 };
  for (let i = 0; i < sc.players; i++) {
    const p = { name: names[i], id: `c${sc.seed}-${i}`, deck: decks[(sc.seed + i * 7) % decks.length], level: levels[(sc.seed + i) % 3], saved: '', run: null, boards: new Map() } as Phone;
    phones.push(p);
  }
  const org = phones[0];
  const mkHost = (state?: HostState) => {
    const h = new TourneyHost({
      code,
      me: { name: org.name, avatar: 'a', sleeve: 's', clientId: org.id },
      build: BUILD,
      transport: new MemoryTransport(hub),
      settings: { bestOf: sc.bestOf, topCut: sc.topCut, rounds: sc.rounds ?? null, skipFirstDraw: true },
      state,
      seed: sc.seed,
      save: (s) => (org.hostSaved = JSON.stringify(s)),
      autoPairDelayMs: 0,
      ...ht,
    });
    return h;
  };
  const mkClient = (p: Phone, snap?: ClientSnapshot) => {
    const c = new TourneyClient({
      code,
      me: { name: p.name, avatar: 'a', sleeve: 's', clientId: p.id },
      build: BUILD,
      transport: p === org ? undefined : new MemoryTransport(hub),
      link: p === org ? org.host!.localLink() : undefined,
      snapshot: snap,
      events: { changed: () => (p.saved = JSON.stringify(c.snapshot())) },
      ...ht,
    });
    p.client = c;
    return c;
  };
  org.host = mkHost();
  await org.host.start();
  for (const p of phones) {
    const c = mkClient(p);
    await c.start();
    c.register(wireDeck(p.deck), true);
  }
  await waitFor(() => org.host!.state.players.length === sc.players && !org.host!.startProblem(), 3000, 'everyone registered');
  const host = () => org.host!;
  check(host().startEvent(), `${sc.name}: event starts`);

  if (sc.tamper) phones[1].tamper = 's1';
  if (sc.die) phones[sc.players - 1].dieInRound = 2;
  if (sc.id) phones.forEach((p) => (p.idInRound = host().state.swissRounds));

  // a phone's driver: plays whatever match it is paired in
  const drive = async (p: Phone) => {
    for (;;) {
      if (p.dead) return;
      const v = p.client.view;
      if (v?.phase === 'done') return;
      const m = p.client.myMatch();
      if (p.run && (!m || m.id !== p.run.mid || m.attempt !== p.run.attempt || m.result != null)) {
        // the organiser settled it (or replayed it): leave the room
        if (m && m.id === p.run.mid && m.attempt !== p.run.attempt) p.run.killed = true;
        if (p.run.done || p.run.killed || (m && m.result != null)) {
          p.run.killed = true;
          p.run.room.leave();
          p.run.feed?.close();
          p.run = null;
        }
      }
      if (!p.run && m && m.result == null && m.b != null && !p.client.dropped && !p.client.reportPending(m.id)) {
        const ran = p.boards.get(`${m.id}#${m.attempt}`);
        if (!ran) void playMatch(p, m).catch((e) => fail(`${sc.name} ${p.name} ${m.id}: ${(e as Error).stack}`));
      }
      await sleep(10);
    }
  };

  const playMatch = async (p: Phone, m: TMatch) => {
    const { role, code: roomCode, opponent } = p.client.roomFor(m);
    const room = new Room({ role, code: roomCode, me: p.client.me, build: BUILD, transport: new MemoryTransport(hub), expectPeer: opponent, ...ht });
    const run = { mid: m.id, attempt: m.attempt, room, games: new Map<number, Game>() } as NonNullable<Phone['run']>;
    p.run = run;
    p.boards.set(`${m.id}#${m.attempt}`, []);
    const ready = new Set<number>();
    room.ev.gameReady = (g) => ready.add(g);
    for (let i = 0; ; i++) {
      try {
        await room.start();
        break;
      } catch {
        if (run.killed || i > 400) return;
        await sleep(20); // the host has not opened the room yet
      }
    }
    if (role === 'host' && sc.spectate) {
      run.feed = new SpectateServer(room, new MemoryTransport(hub), 0, { build: BUILD, me: p.client.me, pushMs: 20, ...ht });
      await run.feed.start();
    }
    room.setLobby({ deckKey: p.deck.id, deck: wireDeck(p.deck), ready: true, bestOf: sc.bestOf });
    if (role === 'host') {
      await waitFor(() => room.canStart || !!run.killed, 20000, 'opponent in the room');
      if (run.killed) return;
      room.startMatch({ seed: m.seed, skipFirstDraw: true, id: `${m.id}#${m.attempt}` });
    }
    await waitFor(() => !!room.match || !!run.killed, 20000, 'match start');
    // an intentional draw by agreement: both offer it before playing
    if (p.idInRound === m.round && m.stage === 'swiss') {
      p.client.offerId(m.id, true);
      await waitFor(() => !!run.killed || p.client.myMatch()?.result != null, 20000, 'ID accepted');
      return;
    }
    let awayFor = 0;
    for (let gi = 0; !run.killed; gi++) {
      await waitFor(() => ready.has(gi) || !!room.outcome() || !!run.killed, 60000, `${m.id} game ${gi + 1} ready`);
      if (run.killed || room.outcome()) break;
      const st = room.match!.games[gi];
      const mine = new RecordingController(yielding(new AsHuman(new AIController(p.level, m.seed + room.mySeat * 7919 + gi))), {
        onDecision: (log, game) => room.localDecision(gi, log, game.turn),
      });
      const rc = room.remoteController(gi);
      const game = buildMatchGame(
        { seed: st.seed, first: st.first!, skipFirstDraw: true, names: [room.match!.start.players[0].name, room.match!.start.players[1].name], decks: [st.decks[0]!, st.decks[1]!] },
        room.mySeat === 0 ? [mine, rc] : [rc, mine],
      )!;
      run.games.set(gi, game);
      let res: { winner: PlayerId | null; reason: string; turns: number } | null = null;
      const play = game.start().then((r) => (res = r));
      // the phone dies in the middle of this game
      if (p.dieInRound === m.round && gi === 0) {
        await waitFor(() => (st.logs[0].length + st.logs[1].length > 30) || !!res, 60000, 'mid game');
        p.dead = true;
        run.killed = true;
        rc.fail(new GameOver(null, 'killed'));
        room.ev = {};
        room.session.close();
        p.client.close();
        if (verbose) console.log(`  ${p.name}'s phone died in ${m.id}`);
        return;
      }
      while (!res) {
        await sleep(5);
        if (run.killed) return;
        // the opponent is gone: claim the game after a while (3 minutes in the app)
        if (room.status !== 'connected') awayFor += 5;
        else awayFor = 0;
        if (awayFor > 2500) {
          room.endGame(gi, { winner: room.mySeat, reason: 'Opponent disconnected', turns: game.turn, kind: 'claim' });
          awayFor = 0;
        }
      }
      await play;
      const r = res as unknown as { winner: PlayerId | null; reason: string; turns: number };
      room.gameOver(gi, { winner: r.winner, reason: r.reason, turns: r.turns });
      p.boards.get(`${m.id}#${m.attempt}`)![gi] = snapshot(game);
      if (room.outcome() || room.match!.games[gi].end?.kind === 'desync') break;
      // between games: the loser chooses, both side and submit
      const chooser = room.chooserFor(gi + 1);
      if (chooser === room.mySeat) room.chooseFirst(gi + 1, ((gi + m.seed) % 2) as PlayerId);
      const own = wireDeck(p.deck);
      const opp = room.match!.start.decks[room.peerSeat];
      const sided = own.side?.length ? { name: own.name, ...aiSideDeck({ main: own.main, extra: own.extra, side: own.side }, { main: opp.main, extra: opp.extra }, m.seed + gi + room.mySeat) } : own;
      room.submitDeck(gi + 1, sided);
      // the opponent died between games: claim the next one too
      awayFor = 0;
      while (!ready.has(gi + 1) && !room.outcome() && !run.killed) {
        await sleep(5);
        if (room.status !== 'connected') awayFor += 5;
        if (awayFor > 2500) {
          room.endGame(gi + 1, { winner: room.mySeat, reason: 'Opponent disconnected', turns: 0, kind: 'claim' });
          awayFor = 0;
        }
      }
    }
    if (run.killed) return;
    const rep = reportFromRoom(room, m.id, m.attempt)!;
    if (p.tamper && m.id.startsWith(p.tamper) && rep) {
      // claim the opposite result of game 1
      const g = rep.games[0];
      g.end = { ...g.end, winner: g.end.winner === 0 ? 1 : 0 };
      if (verbose) console.log(`  ${p.name} sends a tampered report for ${m.id}`);
      p.tamper = undefined;
    }
    // the honest side of the tampered match reports late, so the tampered report is seen alone first
    if (sc.tamper && m.id === 's1-1' && p !== phones[1] && opponent === phones[1].id) await sleep(800);
    run.done = true;
    p.client.report(rep);
  };

  const drivers = phones.map((p) => drive(p));
  let reloaded = false;
  let dropped = false;
  let tamperSeen = false;
  let dieHandled = false;
  const t0 = Date.now();
  // the organiser: pairs rounds, resolves disputes, reloads once
  for (;;) {
    if (Date.now() - t0 > 600000) throw new Error(`${sc.name}: event timed out in ${host().state.phase} round ${host().state.rounds.length}`);
    await sleep(10);
    const H = host();
    if (H.state.phase === 'done') break;
    // disputes and claims
    for (const m of H.currentRound()) {
      if (m.result != null || H.busy) continue;
      if (m.dispute) {
        tamperSeen = true;
        if (verbose) console.log(`  dispute on ${m.id}: ${m.dispute.reason} (${m.dispute.detail})`);
        // the organiser checks the honest phone and gives the verified result
        const honest = phones.find((p) => (p.id === m.a || p.id === m.b) && p !== phones[1])!;
        const rep = honest.client.pending[m.id] ?? reportFromRoom(honest.run?.room ?? (null as any), m.id, m.attempt);
        const v = await verifyReport(rep!, { bestOf: sc.bestOf, matchSeed: m.seed, decks: [H.player(m.a)!.deck!, H.player(m.b!)!.deck!], names: [H.player(m.a)!.name, H.player(m.b!)!.name], skipFirstDraw: true });
        check(v.ok, `${sc.name}: the honest report of ${m.id} verifies`);
        H.resolve(m.id, v.result!);
      } else if (m.reported.length === 1 && phones.some((p) => p.dead && (p.id === m.a || p.id === m.b))) {
        // a claimed win over a phone that is gone: the organiser accepts it and drops the player
        const dead = phones.find((p) => p.dead && (p.id === m.a || p.id === m.b))!;
        H.acceptReport(m.id);
        H.dropPlayer(dead.id);
        dieHandled = true;
        check(m.result === (m.a === dead.id ? 'b' : 'a'), `${sc.name}: the claimed win counts for the phone that stayed`);
      }
    }
    // voluntary drop after a round
    if (sc.dropAfterRound && !dropped && H.state.rounds.length === sc.dropAfterRound && H.roundComplete()) {
      const quitter = phones[2];
      quitter.client.drop();
      await waitFor(() => H.player(quitter.id)?.dropped != null, 3000, 'drop');
      dropped = true;
    }
    // the organiser's phone reloads mid-round 2
    if (sc.hostReload && !reloaded && H.state.rounds.length === 2 && H.currentRound().some((x) => x.result != null) && H.currentRound().some((x) => x.result == null)) {
      reloaded = true;
      if (verbose) console.log(`  organiser reloads mid-round (${H.currentRound().filter((x) => x.result != null).length} results in)`);
      await waitFor(() => !H.busy, 30000, 'verification idle');
      H.close();
      org.client.close();
      await sleep(30);
      const state = JSON.parse(org.hostSaved!) as HostState;
      org.host = mkHost(state);
      await org.host.start();
      const c = mkClient(org, JSON.parse(org.saved));
      await c.start();
      continue;
    }
    if (H.roundComplete() && !H.busy) {
      // a match the organiser's view settled while a phone still plays: give drivers a moment
      if (sc.dropAfterRound && !dropped && H.state.rounds.length === sc.dropAfterRound) continue;
      H.pairNext();
    }
  }
  await Promise.race([Promise.all(drivers), sleep(5000)]);
  const H = host();
  const v = H.viewFor(org.id);
  if (sc.tamper) check(tamperSeen, `${sc.name}: the tampered report was caught as a dispute`);
  if (sc.die) check(dieHandled, `${sc.name}: the dead phone's match was claimed and the player dropped`);
  if (sc.hostReload) check(reloaded, `${sc.name}: organiser reloaded`);

  // every phone ends with the same final view
  await waitFor(() => phones.every((p) => p.dead || p.client.view?.phase === 'done'), 5000, 'final views').catch(() => fail(`${sc.name}: not every phone saw the final standings`));
  for (const p of phones) if (!p.dead) check(JSON.stringify(p.client.view?.placements) === JSON.stringify(v.placements), `${sc.name}: ${p.name} has the final placements`);

  checkSwiss(sc, H, v);

  // spectator: replay a match from the feed into its own board, compare with the players'
  if (sc.spectate) await spectatorCheck(sc, hub, phones);

  for (const p of phones) {
    p.run?.room.leave();
    p.run?.feed?.close();
    p.client.close();
  }
  H.close(true);
  await sleep(20);
  const results = [...v.rounds.flat(), ...v.top.flat()].map((m) => `${m.id}:${m.a}-${m.b}:${m.result}:${m.games.map((g) => `${g.winner}/${g.turns}`).join(',')}:${m.how}`);
  if (verbose) {
    const st = viewStandings(v);
    for (const s of st) console.log(`  ${s.rank}. ${v.players.find((x) => x.id === s.id)!.name} ${s.w}-${s.l}-${s.d} ${s.mp}pts omw ${(s.omw * 100).toFixed(1)}${s.dropped ? ' (dropped)' : ''}`);
    console.log(`  champion ${v.players.find((x) => x.id === v.placements![0])!.name}`);
  }
  return { placements: v.placements!, results, view: v };
}

/** Standings and pairings follow the Swiss rules. */
function checkSwiss(sc: Scenario, H: TourneyHost, v: TView) {
  const st = viewStandings(v);
  const tag = sc.name;
  check(v.rounds.length === H.state.swissRounds || v.players.filter((p) => p.dropped == null).length < 2, `${tag}: ${H.state.swissRounds} Swiss rounds played (${v.rounds.length})`);
  const met = new Set<string>();
  const byes = new Map<string, number>();
  for (const [ri, r] of v.rounds.entries()) {
    const active = new Set(v.players.filter((p) => p.dropped == null || p.dropped > ri).map((p) => p.id));
    const seen = new Set<string>();
    for (const m of r) {
      check(m.result != null, `${tag}: R${ri + 1} ${m.id} has a result`);
      for (const id of [m.a, m.b]) if (id) {
        check(!seen.has(id), `${tag}: R${ri + 1} ${id} paired once`);
        seen.add(id);
      }
      if (m.b == null) byes.set(m.a, (byes.get(m.a) ?? 0) + 1);
      else {
        const k = [m.a, m.b].sort().join('|');
        if (v.players.length > H.state.swissRounds) check(!met.has(k), `${tag}: R${ri + 1} no rematch ${k}`);
        met.add(k);
      }
    }
    check(seen.size === active.size, `${tag}: R${ri + 1} every active player paired (${seen.size}/${active.size})`);
    const byeCount = r.filter((m) => m.b == null).length;
    check(byeCount === active.size % 2, `${tag}: R${ri + 1} ${active.size % 2 ? 'one bye' : 'no bye'} for ${active.size} players`);
  }
  if (v.players.length > v.rounds.length) for (const [id, n] of byes) check(n <= 1, `${tag}: ${id} got ${n} byes`);
  // points: 3 per win (byes included), 1 per draw; order by points, then OMW%, then OOMW%
  for (const s of st) {
    const mine = v.rounds.flat().filter((m) => m.a === s.id || m.b === s.id);
    const w = mine.filter((m) => (m.result === 'a' && m.a === s.id) || (m.result === 'b' && m.b === s.id)).length;
    const d = mine.filter((m) => m.result === 'draw').length;
    check(s.mp === 3 * w + d, `${tag}: ${s.id} has ${s.mp} points for ${w} wins and ${d} draws`);
  }
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1];
    const b = st[i];
    const okOrder = a.mp > b.mp || (a.mp === b.mp && (a.omw > b.omw + 1e-9 || (Math.abs(a.omw - b.omw) < 1e-9 && a.oomw >= b.oomw - 1e-9)));
    check(okOrder, `${tag}: standings order ${a.id} (${a.mp}, ${a.omw.toFixed(3)}) before ${b.id} (${b.mp}, ${b.omw.toFixed(3)})`);
  }
  // placements: the champion won the final (or leads the standings without a cut)
  const champ = v.placements![0];
  if (v.top.length) {
    const final = v.top[v.top.length - 1][0];
    check(v.top[v.top.length - 1].length === 1, `${tag}: the bracket ends in one final`);
    check((final.result === 'a' ? final.a : final.b) === champ, `${tag}: the champion won the final`);
    const cutIds = v.top[0].flatMap((m) => [m.a, m.b]);
    const expect = st.filter((s) => !s.dropped).slice(0, cutIds.length).map((s) => s.id);
    check(cutIds.slice().sort().join() === expect.slice().sort().join(), `${tag}: the top ${cutIds.length} by Swiss standings made the cut`);
  } else check(st[0].id === champ, `${tag}: without a cut the Swiss leader is champion`);
  check(placeIn(v, champ) === 1 && new Set(v.placements).size === v.players.length, `${tag}: every player placed once`);
  // every played match was verified by replay (or settled for a stated reason)
  for (const m of [...v.rounds.flat(), ...v.top.flat()]) check(!!m.how, `${tag}: ${m.id} settled (${m.how})`);
  const verified = [...v.rounds.flat(), ...v.top.flat()].filter((m) => m.how === 'verified').length;
  check(verified > 0, `${tag}: matches verified by replay (${verified})`);
  if (sc.bestOf === 3) check([...v.rounds.flat(), ...v.top.flat()].some((m) => m.how === 'verified' && m.games.length >= 2), `${tag}: Bo3 matches went past game 1 (siding between games)`);
}

async function spectatorCheck(sc: Scenario, hub: MemoryHub, phones: Phone[]) {
  // the feed only runs while a match is live, so watch one live: a fresh Bo1 room between two phones
  const a = phones[0];
  const b = phones[1];
  const roomCode = `WTCH-${sc.seed}`;
  const mk = (p: Phone, role: 'host' | 'guest', peer: Phone) => new Room({ role, code: roomCode, me: { ...p.client.me }, build: BUILD, transport: new MemoryTransport(hub), expectPeer: peer.id, heartbeatMs: 40, timeoutMs: 1500 });
  const ra = mk(a, 'host', b);
  const rb = mk(b, 'guest', a);
  await ra.start();
  await rb.start();
  const feed = new SpectateServer(rb, new MemoryTransport(hub), 1, { build: BUILD, me: b.client.me, pushMs: 15, heartbeatMs: 40, timeoutMs: 1500 });
  await feed.start();
  ra.setLobby({ deckKey: 'x', deck: wireDeck(a.deck), ready: true, bestOf: 1 });
  rb.setLobby({ deckKey: 'y', deck: wireDeck(b.deck), ready: true });
  await waitFor(() => ra.canStart, 3000, 'watch room ready');
  ra.startMatch({ seed: sc.seed * 31, skipFirstDraw: true });
  await waitFor(() => !!rb.match, 3000, 'watch match');
  const boards: string[] = [];
  const play = (room: Room, p: Phone) => {
    const st = room.match!.games[0];
    const rec = new RecordingController(yielding(new AsHuman(new AIController('normal', sc.seed + room.mySeat))), { onDecision: (log, g) => room.localDecision(0, log, g.turn) });
    const rc = room.remoteController(0);
    const g = buildMatchGame({ seed: st.seed, first: st.first!, skipFirstDraw: true, names: [room.match!.start.players[0].name, room.match!.start.players[1].name], decks: [st.decks[0]!, st.decks[1]!] }, room.mySeat === 0 ? [rec, rc] : [rc, rec])!;
    return g.start().then((r) => {
      room.gameOver(0, r);
      boards[room.mySeat] = snapshot(g);
      void p;
    });
  };
  const games = Promise.all([play(ra, a), play(rb, b)]);
  // the spectator joins mid-game (catches up from the log), with seat 0's feed missing
  await waitFor(() => (rb.current?.logs[0].length ?? 0) > 10, 30000, 'game under way');
  const spec = new SpectateClient({ roomCode, transport: () => new MemoryTransport(hub), build: BUILD, me: { name: 'Watcher', avatar: 'a', sleeve: 's', clientId: 'watcher' }, heartbeatMs: 40, timeoutMs: 1500 });
  await spec.begin([0, 1]);
  await waitFor(() => !!spec.start && !!spec.games[0]?.decks[1], 5000, 'spectator got the match');
  const w = spec.games[0];
  const sg = buildMatchGame({ seed: w.seed, first: w.first!, skipFirstDraw: true, names: [spec.start!.players[0].name, spec.start!.players[1].name], decks: [w.decks[0]!, w.decks[1]!] }, [spec.remote(0, 0), spec.remote(0, 1)] as [RemoteController, RemoteController])!;
  const sres = await sg.start();
  await games;
  check(snapshot(sg) === boards[0] && boards[0] === boards[1], `${sc.name}: the spectator's board matches both players' (winner ${sres.winner}, turn ${sres.turns})`);
  spec.close();
  feed.close();
  ra.leave();
  rb.leave();
}

// ------------------------------------------------------------------ the runs

const SCENARIOS: Scenario[] = [
  { name: '4 players Bo1 + organiser reload + ID', players: 4, bestOf: 1, topCut: 0, seed: 4101, hostReload: true, id: true },
  { name: '5 players Bo3 siding + byes + tampered report + Top 4', players: 5, bestOf: 3, topCut: 4, seed: 5203, tamper: true, spectate: true },
  { name: '8 players Bo1 + dead phone + drop + Top 8', players: 8, bestOf: 1, topCut: 8, seed: 8307, die: true, dropAfterRound: 1 },
  { name: '3 players Bo1', players: 3, bestOf: 1, topCut: 0, seed: 3409 },
];

(async () => {
  const t0 = Date.now();
  let events = 0;
  let matches = 0;
  for (const sc of SCENARIOS) {
    if (only && !sc.name.includes(only)) continue;
    const t1 = Date.now();
    try {
      const out = await runScenario(sc);
      events++;
      matches += out.results.length;
      console.log(`${sc.name}: ${out.results.length} matches, champion ${out.view.players.find((p) => p.id === out.placements[0])!.name}, ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    } catch (e) {
      fail(`${sc.name}: ${(e as Error).stack}`);
    }
  }
  // determinism: the same event with the same seeds plays out identically
  if (!only || only === 'determinism') {
    const sc: Scenario = { name: 'determinism', players: 5, bestOf: 1, topCut: 4, seed: 6151 };
    try {
      const x = await runScenario(sc);
      const y = await runScenario(sc);
      check(JSON.stringify(x.results) === JSON.stringify(y.results) && JSON.stringify(x.placements) === JSON.stringify(y.placements), 'determinism: the same seeds give the same event');
      if (JSON.stringify(x.results) !== JSON.stringify(y.results)) console.log(x.results, y.results);
      events += 2;
    } catch (e) {
      fail(`determinism: ${(e as Error).stack}`);
    }
  }
  const bad = warnings.filter((w) => !/out of sync|Out of sync/.test(w));
  if (bad.length) fail(`unexpected warnings: ${bad.slice(0, 3).join(' | ')}`);
  console.log(`tourney-test: ${events} events, ${matches} matches, ${failures} failure${failures === 1 ? '' : 's'}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failures ? 1 : 0);
})();
