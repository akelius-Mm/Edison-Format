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
// same seeds giving the identical result. Also: player names (cleaning, unique suffixes, renames by
// the player and by the organiser, a re-join keeping an organiser rename), the version check at
// join, and spectating failing with a clear reason instead of connecting forever. Tables: a table that
// cannot connect (Wi-Fi isolation, the opponent not sitting down, a stale "ID taken" registration) is
// reported as stuck after the timeout and Retry gets it going; the organiser restarting a match that
// is under way moves both phones to the fresh room and closes the old one.
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
import { newRoomCode, roomPeerId, type WireDeck } from '../src/net/protocol';
import { TableLink, tableTroubleText, type TableTrouble } from '../src/net/tableLink';
import { TransportError, type Channel } from '../src/net/transport';
import { AsHuman, RemoteController } from '../src/net/remote';
import { Room } from '../src/net/room';
import { SpectateClient, SpectateError, SpectateServer } from '../src/net/spectate';
import { TourneyHost, placeIn, viewStandings, type HostState } from '../src/net/tournament';
import { TourneyClient, reportFromRoom, type ClientSnapshot } from '../src/net/tourneyClient';
import { NAME_MAX, cleanName, uniqueName, type TMatch, type TView } from '../src/net/tourneyProtocol';
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
  /** The organiser restarts a round-1 match while both phones are in its room. */
  restart?: boolean;
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
  let restarted: { mid: string; rooms: Room[]; code: string } | null = null;
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
    // the organiser restarts a match that is under way (a stuck table, say): both phones must leave
    // the old room and meet again in the fresh one
    if (sc.restart && !restarted && H.state.rounds.length === 1) {
      const m = H.currentRound().find((x) => x.b != null && x.result == null && phones.filter((p) => p.run?.mid === x.id && p.run.room.match).length === 2);
      if (m) {
        const ps = phones.filter((p) => p.run?.mid === m.id);
        restarted = { mid: m.id, rooms: ps.map((p) => p.run!.room), code: ps[0].client.roomFor(m).code };
        H.replay(m.id);
        check(m.attempt === 1 && m.reported.length === 0 && m.result == null, `${sc.name}: restart bumps the attempt and clears the reports`);
        const fresh = ps[0].client.roomFor(m).code;
        check(fresh !== restarted.code, `${sc.name}: the restarted match gets a new room code (${restarted.code} → ${fresh})`);
        const rooms = restarted.rooms;
        await waitFor(() => rooms.every((r) => r.status === 'closed') && !hub.listeners.has(roomPeerId(restarted!.code)), 3000, 'old room closed').catch(() => {});
        check(rooms.every((r) => r.status === 'closed'), `${sc.name}: both phones left the old room (${rooms.map((r) => r.status).join(', ')})`);
        check(!hub.listeners.has(roomPeerId(restarted.code)), `${sc.name}: the old room's id is released`);
        // (a Bo1 between bots is over in moments: look at what each phone played, not at what it plays now)
        const played = (p: Phone) => (p.boards.get(`${m.id}#1`)?.length ?? 0) > 0;
        await waitFor(() => ps.every(played), 20000, 'restarted match played').catch(() => {});
        check(ps.every(played), `${sc.name}: both phones played the restarted match in the fresh room`);
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
  if (sc.restart) {
    check(!!restarted, `${sc.name}: a match was restarted`);
    const m = restarted && H.match(restarted.mid);
    check(m && m.attempt === 1 && m.result != null && m.how === 'verified', `${sc.name}: the restarted match was played again and verified (${m?.attempt} ${m?.result} ${m?.how})`);
  }

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

// ------------------------------------------------------------------ names, versions, spectate errors

async function namesCheck() {
  // cleaning
  check(cleanName('  Alex   the\tGreat  ') === 'Alex the Great', 'names: whitespace trimmed and collapsed');
  check(cleanName('Al\u0000e\u0007x​‮') === 'Alex', 'names: control, zero-width and bidi characters stripped');
  check(cleanName('<b>Bo</b>') === 'bBo/b', 'names: angle brackets stripped');
  check(cleanName('x'.repeat(40)).length === NAME_MAX, `names: at most ${NAME_MAX} characters`);
  const emoji = cleanName('😀'.repeat(25));
  check(Array.from(emoji).length === NAME_MAX && !/[\ud800-\udbff]$/.test(emoji), 'names: long emoji names cut on whole characters');
  check(cleanName('   ') === '' && cleanName(null) === '' && cleanName(42) === '42', 'names: empty and non-string input');
  // unique
  check(uniqueName('Alex', ['alex']) === 'Alex 2', 'names: a duplicate (any case) gets " 2"');
  check(uniqueName('Alex', ['Alex', 'Alex 2']) === 'Alex 3', 'names: the next free number');
  check(uniqueName('Bea', ['Alex']) === 'Bea', 'names: a free name is kept');
  const long = uniqueName('y'.repeat(NAME_MAX), ['y'.repeat(NAME_MAX)]);
  check(long.length === NAME_MAX && long.endsWith(' 2'), 'names: a long duplicate is shortened to fit its number');

  // an event: three phones that all call themselves Alex, then renames
  const hub = new MemoryHub();
  const code = 'NAME-2345';
  const ht = { heartbeatMs: 40, timeoutMs: 1500 };
  const host = new TourneyHost({ code, me: { name: 'Org', avatar: 'a', sleeve: 's', clientId: 'org' }, build: BUILD, transport: new MemoryTransport(hub), settings: { bestOf: 1, topCut: 0, rounds: null, skipFirstDraw: true }, seed: 1, autoPairDelayMs: 0, ...ht });
  await host.start();
  const org = new TourneyClient({ code, me: { name: 'Org', avatar: 'a', sleeve: 's', clientId: 'org' }, build: BUILD, link: host.localLink(), ...ht });
  await org.start();
  const deck = wireDeck(PREMADE_DECKS[0]);
  org.register(deck, true);
  const mk = (id: string, name: string, build = BUILD) => {
    const refused: string[] = [];
    const c = new TourneyClient({ code, me: { name, avatar: 'a', sleeve: 's', clientId: id }, build, transport: new MemoryTransport(hub), events: { refused: (r) => refused.push(r) }, ...ht });
    return { c, refused };
  };
  const ps = [mk('p1', 'Alex'), mk('p2', 'alex'), mk('p3', '  Alex\u0007 ')];
  for (const { c } of ps) {
    await c.start();
    c.register(deck, true);
  }
  const nameOf = (c: TourneyClient, id: string) => c.view?.players.find((p) => p.id === id)?.name;
  await waitFor(() => ps.every(({ c }) => c.view?.players.length === 4) && nameOf(ps[0].c, 'p3') != null, 3000, 'name event joined');
  check(nameOf(ps[0].c, 'p1') === 'Alex' && nameOf(ps[0].c, 'p2') === 'alex 2' && nameOf(ps[0].c, 'p3') === 'Alex 3', `names: duplicates numbered in join order (${host.state.players.map((p) => p.name).join(', ')})`);
  // a player renames itself: everyone sees it
  check(ps[1].c.rename('  Bea '), 'names: the player renames itself');
  await waitFor(() => ps.every(({ c }) => nameOf(c, 'p2') === 'Bea') && nameOf(org, 'p2') === 'Bea', 3000, 'rename reached everyone');
  check(true, 'names: a rename reaches every phone and the organiser');
  check(!ps[1].c.rename(' \u0000 '), 'names: an empty rename is refused');
  // taking a name already used gets a number
  ps[2].c.rename('BEA');
  await waitFor(() => nameOf(ps[0].c, 'p3') === 'BEA 2', 3000, 'duplicate rename numbered');
  check(true, 'names: renaming to a taken name gets a number');
  // the organiser renames a player; that player's re-join (same asked name) keeps it
  check(host.rename('p1', 'Champ'), 'names: the organiser renames a player');
  check(!host.rename('p1', '   '), 'names: the organiser cannot set an empty name');
  await waitFor(() => nameOf(ps[0].c, 'p1') === 'Champ', 3000, 'organiser rename seen');
  ps[0].c.register(deck, true); // re-sends the join with "Alex"
  await sleep(100);
  check(host.player('p1')?.name === 'Champ', 'names: a re-join with the same name keeps the organiser rename');
  ps[0].c.rename('Alex');
  await waitFor(() => nameOf(org, 'p1') === 'Alex', 3000, 'self rename after organiser rename');
  check(true, 'names: the player can still rename itself afterwards');
  // the organiser renames itself through its own client
  org.rename('Boss');
  await waitFor(() => nameOf(ps[0].c, 'org') === 'Boss', 3000, 'organiser self rename');
  check(true, 'names: the organiser renames itself');
  // names reach the match: standings and pairings use the view names
  check(host.startEvent(), 'names: the event starts');
  await waitFor(() => !!ps[0].c.myMatch(), 3000, 'paired');
  const v = ps[0].c.view!;
  const named = v.rounds[0].flatMap((m) => [m.a, m.b]).filter(Boolean).map((id) => v.players.find((p) => p.id === id)?.name);
  check(named.every((n) => n && n !== 'Duelist') && viewStandings(v).every((st) => v.players.find((p) => p.id === st.id)?.name), `names: pairings and standings carry the names (${named.join(', ')})`);
  // mid-event rename still works
  ps[0].c.rename('Alex Prime');
  await waitFor(() => nameOf(ps[1].c, 'p1') === 'Alex Prime', 3000, 'mid-event rename');
  check(true, 'names: renaming during the event');

  // version check at join: another build is refused with 'version'
  const old = mk('p9', 'Old', 'other-build');
  await old.c.start().catch(() => {});
  await waitFor(() => old.refused.length > 0, 3000, 'old build refused');
  check(old.refused[0] === 'version', `version: a phone on another build is refused with 'version' (${old.refused.join(',')})`);
  check(!host.player('p9'), 'version: the old build never joins the event');
  old.c.close();

  // spectating: a feed on another build fails fast with 'version'; no feed at all with 'unreachable'
  const room = new Room({ role: 'host', code: 'SPEC-2345', me: { name: 'A', avatar: 'a', sleeve: 's', clientId: 'sa' }, build: 'other-build', transport: new MemoryTransport(hub), ...ht });
  const feed = new SpectateServer(room, new MemoryTransport(hub), 0, { build: 'other-build', me: { name: 'A', avatar: 'a', sleeve: 's', clientId: 'sa' }, ...ht });
  await feed.start();
  const watcher = { name: 'W', avatar: 'a', sleeve: 's', clientId: 'w' };
  let t0 = Date.now();
  let err: unknown = null;
  const s1 = new SpectateClient({ roomCode: 'SPEC-2345', transport: () => new MemoryTransport(hub), build: BUILD, me: watcher, ...ht });
  await s1.begin([0, 1], 1500).catch((e) => (err = e));
  check(err instanceof SpectateError && err.reason === 'version', `spectate: a feed on another build gives a 'version' error (${(err as Error)?.message})`);
  check(Date.now() - t0 < 2500, `spectate: the version error comes within the timeout (${Date.now() - t0}ms)`);
  s1.close();
  feed.close();
  t0 = Date.now();
  err = null;
  const s2 = new SpectateClient({ roomCode: 'NONE-2345', transport: () => new MemoryTransport(hub), build: BUILD, me: watcher, ...ht });
  await s2.begin([0, 1], 1200).catch((e) => (err = e));
  check(err instanceof SpectateError && err.reason === 'unreachable', `spectate: no feed gives an 'unreachable' error (${(err as Error)?.message})`);
  check(Date.now() - t0 < 2500, `spectate: gives up within the timeout (${Date.now() - t0}ms)`);
  s2.close();

  // a match room: the friend's name arrives cleaned (it comes from another phone)
  const ra = new Room({ role: 'host', code: 'ROOM-2345', me: { name: 'Hana', avatar: 'a', sleeve: 's', clientId: 'ra' }, build: BUILD, transport: new MemoryTransport(hub), ...ht });
  const rb = new Room({ role: 'guest', code: 'ROOM-2345', me: { name: ' <i>Gus\u0000</i>   ', avatar: 'a', sleeve: 's', clientId: 'rb' }, build: BUILD, transport: new MemoryTransport(hub), ...ht });
  await ra.start();
  await rb.start();
  await waitFor(() => !!ra.peer && !!rb.peer, 3000, 'room peers');
  check(ra.peer!.name === 'iGus/i' && rb.peer!.name === 'Hana', `names: a match room cleans the friend's name (${ra.peer!.name})`);
  ra.leave();
  rb.leave();

  for (const { c } of ps) c.close();
  org.close();
  host.close();
}

// ------------------------------------------------------------------ a table that can't connect

/** Hotel Wi-Fi: this phone's direct connections never get through (the signalling works). */
class BlockedTransport extends MemoryTransport {
  blocked = true;
  dials = 0;
  async dial(id: string): Promise<Channel> {
    this.dials++;
    if (this.blocked) {
      await sleep(5);
      throw new TransportError('timeout', 'Could not reach your friend’s phone.');
    }
    return super.dial(id);
  }
}

async function tableCheck() {
  const hub = new MemoryHub();
  const ht = { heartbeatMs: 40, timeoutMs: 1500 };
  const me = (id: string, name: string) => ({ name, avatar: 'a', sleeve: 's', clientId: id });
  const fast = (i: number) => Math.min(60, 10 + i * 5);
  const stuckMs = 250;
  const mkRoom = (role: 'host' | 'guest', code: string, t = new MemoryTransport(hub)) => {
    const r = new Room({ role, code, me: role === 'host' ? me('ta', 'Hana') : me('tb', 'Gus'), build: BUILD, transport: t, expectPeer: role === 'host' ? 'tb' : 'ta', ...ht });
    return r;
  };

  // 1. the guest's phone can't reach the host's (Wi-Fi isolation): stuck after stuckMs, a clear
  //    message, and Retry (on a network that works now) connects with a fresh room
  {
    const code = 'TBLA-2345';
    const host = new TableLink({ makeRoom: () => mkRoom('host', code), stuckMs, backoff: fast });
    const transports: BlockedTransport[] = [];
    const seen: (TableTrouble | null)[] = [];
    const guest = new TableLink({
      makeRoom: () => {
        const t = new BlockedTransport(hub);
        t.blocked = transports.length === 0; // the first room's network blocks; after Retry it works
        transports.push(t);
        return mkRoom('guest', code, t);
      },
      stuckMs,
      backoff: fast,
      onStuck: (t) => seen.push(t),
    });
    const first = guest.room;
    void host.start();
    void guest.start();
    await sleep(stuckMs / 2);
    check(!guest.stuck && !host.stuck, 'table: no trouble shown before the timeout');
    await waitFor(() => !!guest.stuck && !!host.stuck, 3000, 'stuck table').catch(() => {});
    check(guest.stuck === 'unreachable', `table: the guest is told the opponent's phone can't be reached (${guest.stuck})`);
    check(host.stuck === 'unreachable', `table: the host is told too (${host.stuck})`);
    const text = tableTroubleText(guest.stuck ?? 'unreachable', 'Hana');
    check(/Can’t reach Hana’s phone/.test(text) && /Personal Hotspot/.test(text) && /Retry/.test(text), `table: the message names the opponent and the fix (${text})`);
    const before = transports[0].dials;
    await sleep(150);
    check(transports[0].dials > before, 'table: keeps retrying in the background while stuck');
    check(guest.retry(), 'table: Retry re-opens the room');
    check(guest.room !== first && first.status === 'closed', 'table: Retry replaces the old room and closes it');
    check(seen.includes(null), 'table: the trouble clears while the retry runs');
    await waitFor(() => guest.connected && host.connected, 3000, 'table connects after Retry').catch(() => {});
    check(guest.connected && host.connected, 'table: the fresh room connects');
    await sleep(50);
    check(!guest.stuck && !host.stuck, 'table: no trouble once connected');
    check(!guest.retry(), 'table: Retry does nothing once connected');
    guest.room.leave();
    host.room.leave();
    guest.close();
    host.close();
  }

  // 2. the opponent never sits down: the guest is told the table isn't open
  {
    const guest = new TableLink({ makeRoom: () => mkRoom('guest', 'TBLB-2345'), stuckMs, backoff: fast });
    void guest.start();
    await waitFor(() => !!guest.stuck, 3000, 'not open').catch(() => {});
    check(guest.stuck === 'not-open', `table: no room yet is reported as not open (${guest.stuck})`);
    check(/hasn’t opened the table/.test(tableTroubleText('not-open', 'Hana')), 'table: the not-open message asks the opponent to sit down');
    guest.room.leave();
    guest.close();
  }

  // 3. a stale registration of the room id ("ID taken", our previous session still on the server):
  //    reported, retried with backoff, and the table connects once the server lets it go
  {
    const code = 'TBLC-2345';
    const stale = new MemoryTransport(hub);
    await stale.listen(roomPeerId(code), () => {});
    let tries = 0;
    const host = new TableLink({ makeRoom: () => mkRoom('host', code), stuckMs, backoff: (i, kind) => (tries++, kind === 'id-taken' ? Math.min(80, 10 * 2 ** i) : 10) });
    const guest = new TableLink({ makeRoom: () => mkRoom('guest', code), stuckMs, backoff: fast });
    void host.start();
    void guest.start();
    await waitFor(() => host.stuck === 'id-taken', 3000, 'id taken').catch(() => {});
    check(host.stuck === 'id-taken' && host.lastError === 'id-taken', `table: a stale room id is reported (${host.stuck})`);
    check(tries > 2, `table: the taken id is retried (${tries} tries)`);
    check(host.retry(), 'table: Retry with the id still taken');
    stale.destroy(); // the server drops the stale registration
    await sleep(20);
    // the guest's dial reached the stale registration (a dead phone): it taps Retry too
    check(guest.retry(), 'table: the guest retries as well');
    await waitFor(() => guest.connected && host.connected, 3000, 'connects after the stale id goes').catch(() => {});
    check(guest.connected && host.connected, 'table: connects once the stale id is released');
    guest.room.leave();
    host.room.leave();
    guest.close();
    host.close();
  }
  await sleep(20);
}

// ------------------------------------------------------------------ the runs

const SCENARIOS: Scenario[] = [
  { name: '4 players Bo1 + organiser reload + ID', players: 4, bestOf: 1, topCut: 0, seed: 4101, hostReload: true, id: true },
  { name: '5 players Bo3 siding + byes + tampered report + Top 4', players: 5, bestOf: 3, topCut: 4, seed: 5203, tamper: true, spectate: true },
  { name: '8 players Bo1 + dead phone + drop + Top 8', players: 8, bestOf: 1, topCut: 8, seed: 8307, die: true, dropAfterRound: 1 },
  { name: '3 players Bo1 + organiser restarts a match', players: 3, bestOf: 1, topCut: 0, seed: 3409, restart: true },
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
  if (!only || only === 'names') {
    try {
      await namesCheck();
      console.log('names, versions, spectate errors: checked');
    } catch (e) {
      fail(`names: ${(e as Error).stack}`);
    }
  }
  if (!only || only === 'table') {
    try {
      await tableCheck();
      console.log('table connect timeout, retry, stale id: checked');
    } catch (e) {
      fail(`table: ${(e as Error).stack}`);
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
