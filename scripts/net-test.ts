// Lockstep test for "Play a friend", without a browser: two Rooms (host and guest) talk over the
// in-memory transport, each runs its own Game with its seat driven by an AI (reporting human, as
// on a phone) and the other seat by the RemoteController. Every game must end in the identical
// state on both "phones" (full snapshot: LP, every zone in order, faces, positions, winner).
//
// Also covered: Bo3 matches (loser chooses who goes first, decks re-submitted between games),
// channels cut at random moments (re-sync from the log), a "reload" of one side mid-game
// (restore from the saved snapshot, replay the local log, continue), a concede, and a corrupted
// entry, which must stop both sides with "Out of sync" instead of diverging.
//
// Usage: npx tsx scripts/net-test.ts [--games N] [--seed S] [--verbose]
import { AIController, type Difficulty } from '../src/ai/ai';
import type { CardInstance } from '../src/engine/card';
import type { PlayerController } from '../src/engine/controller';
import { Game, GameOver } from '../src/engine/game';
import { RecordingController } from '../src/engine/replay';
import type { PlayerId } from '../src/engine/types';
import { PREMADE_DECKS, buildDeckList, type DeckDef } from '../src/decks';
import { MemoryHub, MemoryTransport } from '../src/net/memoryTransport';
import { newRoomCode, normalizeRoomCode, type GameEnd, type WireDeck } from '../src/net/protocol';
import { AsHuman, RemoteController } from '../src/net/remote';
import { Room, type RoomSnapshot } from '../src/net/room';
import { CARDS } from '../src/cards';
import { parseServer } from '../src/net/transport';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const GAMES = Number(arg('games', '24'));
const SEED0 = Number(arg('seed', '7001'));
const verbose = args.includes('--verbose');
const origError = console.error;
console.error = (...a: unknown[]) => {
  if (verbose) origError(...a);
};
const origWarn = console.warn;
let warnings: string[] = [];
console.warn = (...a: unknown[]) => {
  warnings.push(a.join(' '));
  if (verbose) origWarn(...a);
};

let failures = 0;
const fail = (msg: string) => {
  failures++;
  console.log(`FAIL ${msg}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wireDeck(d: DeckDef): WireDeck {
  const l = buildDeckList(d);
  return { name: d.name, main: l.main.map((c) => c.id), extra: l.extra.map((c) => c.id) };
}
const fromWire = (w: WireDeck) => ({ main: w.main.map((id) => CARDS[id]), extra: w.extra.map((id) => CARDS[id]) });

function snapshot(g: Game): string {
  const ref = (c: CardInstance | null) => (c ? `${g.allCards.indexOf(c)}${c.faceUp ? 'u' : 'd'}${c.onField && c.isMonster ? c.pos : ''}` : '-');
  return JSON.stringify({
    t: g.turn,
    ph: g.phase,
    tp: g.turnPlayer,
    w: g.winner,
    ch: g.chain.map((l) => `${g.allCards.indexOf(l.card)}:${l.effectIndex}`),
    p: g.players.map((p) => ({ lp: p.lp, hand: p.hand.map(ref), deck: p.deck.map(ref), m: p.mzone.map(ref), s: p.szone.map(ref), f: ref(p.fzone), gy: p.grave.map(ref), ban: p.banished.map(ref), ex: p.extra.map(ref) })),
  });
}

/** Yields now and then, like a phone handing control back to the UI. */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
interface Yielding extends Omit<PlayerController, 'isHuman'> {}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
class Yielding {
  readonly isHuman = true;
  private n = 0;
  constructor(private inner: PlayerController) {}
  private async y() {
    if (++this.n % 8 === 0) await sleep(0);
  }
}
for (const k of ['chooseAction', 'chooseResponse', 'selectCards', 'chooseOption', 'confirm', 'choosePosition', 'chooseAttackTarget', 'confirmTrigger', 'declareCard'] as const) {
  (Yielding.prototype as any)[k] = async function (this: any, ...a: unknown[]) {
    await this.y();
    return this.inner[k](...a);
  };
}

interface Phone {
  name: string;
  room: Room;
  /** Saved snapshot JSON (what localStorage would hold). */
  saved: string;
  game: Game | null;
  rc: RemoteController | null;
  run: Promise<{ winner: PlayerId | null; reason: string; turns: number }> | null;
  /** Result of the current run (a killed run never reports). */
  res: { winner: PlayerId | null; reason: string; turns: number } | null;
  aiLevel: Difficulty;
  aiSeed: number;
}

const BUILD = 'test-build';
let clientN = 0;

function makeRoom(hub: MemoryHub, role: 'host' | 'guest', code: string, phone: Partial<Phone>, snap?: RoomSnapshot, clientId?: string): Room {
  const room = new Room({
    role,
    code,
    me: { name: role === 'host' ? 'Hana' : 'Gus', avatar: 'a1', sleeve: 's', clientId: clientId ?? `c${++clientN}` },
    build: BUILD,
    transport: new MemoryTransport(hub),
    snapshot: snap,
    heartbeatMs: 40,
    timeoutMs: 1500,
    events: {
      changed: () => {
        phone.saved = JSON.stringify(room.snapshot());
      },
    },
  });
  return room;
}

/** Start game `g` on a phone: replays its saved log (resume), then plays live. */
function startGame(p: Phone, g: number, localLog: unknown[] = []) {
  const room = p.room;
  const st = room.match!.games[g];
  const decks = [fromWire(st.decks[0]!), fromWire(st.decks[1]!)] as [any, any];
  const rec = new RecordingController(new Yielding(new AsHuman(new AIController(p.aiLevel, p.aiSeed + g * 31))), {
    replay: localLog as any,
    onDecision: (log, game) => room.localDecision(g, log, game.turn),
  });
  const rc = room.remoteController(g);
  const ctls: [PlayerController, PlayerController] = room.mySeat === 0 ? [rec, rc] : [rc, rec];
  const game = new Game(decks, ctls, {
    seed: st.seed,
    names: [room.match!.start.players[0].name, room.match!.start.players[1].name],
    firstPlayer: typeof st.first === 'number' ? st.first : undefined,
    skipFirstDraw: room.match!.start.skipFirstDraw,
    maxTurns: 60,
  });
  p.game = game;
  p.rc = rc;
  p.res = null;
  const run = game.start().then((r) => {
    if (p.run !== run) return r; // this "app" was killed
    room.gameOver(g, { winner: r.winner, reason: r.reason, turns: r.turns });
    p.res = r;
    return r;
  });
  p.run = run;
}

async function waitFor(cond: () => boolean, ms: number, what: string) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await sleep(5);
  }
}

interface Case {
  a: DeckDef;
  b: DeckDef;
  seed: number;
  bestOf: 1 | 3;
  cuts: number;
  reload: 'none' | 'host' | 'guest';
  concede: boolean;
  corrupt: boolean;
}

async function runCase(c: Case, label: string) {
  const hub = new MemoryHub();
  const code = newRoomCode(mulberry(c.seed));
  const host: Phone = { name: 'host', saved: '', game: null, rc: null, run: null, res: null, aiLevel: (['easy', 'normal', 'hard'] as Difficulty[])[c.seed % 3], aiSeed: c.seed * 3 + 1 } as Phone;
  const guest: Phone = { name: 'guest', saved: '', game: null, rc: null, run: null, res: null, aiLevel: (['hard', 'normal', 'easy'] as Difficulty[])[c.seed % 3], aiSeed: c.seed * 5 + 2 } as Phone;
  host.room = makeRoom(hub, 'host', code, host);
  guest.room = makeRoom(hub, 'guest', code, guest);
  const ready: [number[], number[]] = [[], []];
  const hookReady = (p: Phone, i: 0 | 1) => {
    p.room.ev.gameReady = (g) => ready[i].push(g);
  };
  hookReady(host, 0);
  hookReady(guest, 1);
  await host.room.start();
  await guest.room.start();
  await waitFor(() => host.room.session.connected && guest.room.session.connected, 2000, 'connect');
  host.room.setLobby({ deckKey: c.a.id, deck: wireDeck(c.a), ready: true, bestOf: c.bestOf });
  guest.room.setLobby({ deckKey: c.b.id, deck: wireDeck(c.b), ready: true });
  await waitFor(() => host.room.canStart, 2000, 'both ready');
  host.room.startMatch({ seed: c.seed, skipFirstDraw: c.seed % 4 === 3 });
  await waitFor(() => !!guest.room.match, 2000, 'match start');

  let decisions = 0;
  for (let gi = 0; gi < 5; gi++) {
    await waitFor(() => ready[0].includes(gi) && ready[1].includes(gi), 5000, `game ${gi + 1} ready`);
    startGame(host, gi);
    startGame(guest, gi);
    let cutsLeft = c.cuts;
    let reloaded = gi > 0 || c.reload === 'none';
    let conceded = !c.concede || gi > 0;
    let corrupted = !c.corrupt || gi > 0;
    const t0 = Date.now();
    while (!host.res || !guest.res) {
      const guestRes = guest.res;
      const hostRes = host.res;
      await sleep(3);
      if (Date.now() - t0 > 120000) throw new Error(`game ${gi + 1} timed out at turn ${host.game!.turn}/${guest.game!.turn}`);
      const n = host.room.match!.games[gi].logs[0].length + host.room.match!.games[gi].logs[1].length;
      if (cutsLeft > 0 && n > 30 * (c.cuts - cutsLeft + 1)) {
        cutsLeft--;
        hub.down = true;
        hub.cut();
        setTimeout(() => (hub.down = false), 60);
      }
      if (!corrupted && n > 40 && !guestRes) {
        // the host's next entry arrives tampered with: both sides must stop, not diverge
        corrupted = true;
        const session = host.room.session;
        const send = session.send.bind(session);
        let done = false;
        session.send = (m) => {
          if (!done && m.t === 'd') {
            done = true;
            m = { ...m, e: { ...m.e, h: 'corrupt' } };
          }
          send(m);
        };
      }
      if (!conceded && n > 60 && !guestRes) {
        conceded = true;
        guest.room.endGame(gi, { winner: 0, reason: 'Conceded', turns: guest.game!.turn, kind: 'concede' });
      }
      if (!reloaded && n > 50 && !guestRes && !hostRes) {
        reloaded = true;
        const p = c.reload === 'host' ? host : guest;
        // the app is killed: drop everything but the saved snapshot, then come back
        const snap = JSON.parse(p.saved) as RoomSnapshot;
        const me = p.room.me;
        p.rc!.fail(new GameOver(null, 'killed'));
        p.room.ev = {};
        p.room.session.close();
        await sleep(20);
        const ev = { gameReady: (g: number) => ready[p === host ? 0 : 1].push(g) };
        p.room = makeRoom(hub, p === host ? 'host' : 'guest', code, p, snap, me.clientId);
        p.room.ev = { ...p.room.ev, ...ev };
        await p.room.start();
        const local = snap.match!.games[gi].logs[p.room.mySeat];
        startGame(p, gi, local);
      }
    }
    const hr = host.res!;
    const gr = guest.res!;
    const hs = host.room.match!.games[gi];
    const gs = guest.room.match!.games[gi];
    decisions += hs.logs[0].length + hs.logs[1].length;
    const tag = `${label} g${gi + 1}`;
    if (c.corrupt && gi === 0) {
      if (hs.end?.kind !== 'desync' && gs.end?.kind !== 'desync') fail(`${tag}: corrupted entry did not stop the game as a desync (${JSON.stringify(hs.end)} / ${JSON.stringify(gs.end)})`);
      if (hr.reason !== 'Out of sync' || gr.reason !== 'Out of sync') fail(`${tag}: desync results ${hr.reason} / ${gr.reason}`);
      if (verbose) console.log(`${tag}: desync detected as expected`);
      break;
    }
    if (c.concede && gi === 0) {
      if (hs.end?.winner !== 0 || gs.end?.winner !== 0 || hs.end?.kind !== 'concede') fail(`${tag}: concede not agreed ${JSON.stringify(hs.end)} / ${JSON.stringify(gs.end)}`);
    } else {
      const a = snapshot(host.game!);
      const b = snapshot(guest.game!);
      if (a !== b) fail(`${tag}: final states differ\n  host  ${a.slice(0, 400)}\n  guest ${b.slice(0, 400)}`);
      if (hr.winner !== gr.winner || hr.turns !== gr.turns || hr.reason !== gr.reason) fail(`${tag}: results differ ${JSON.stringify(hr)} vs ${JSON.stringify(gr)}`);
      if (JSON.stringify(hs.logs) !== JSON.stringify(gs.logs)) fail(`${tag}: decision logs differ`);
    }
    if (verbose) console.log(`${tag}: ${hs.logs[0].length}+${hs.logs[1].length} decisions, ${hr.turns} turns, winner ${hr.winner} (${hr.reason})${c.reload !== 'none' && gi === 0 ? `, ${c.reload} reloaded` : ''}${c.cuts && gi === 0 ? `, ${c.cuts} cuts` : ''}`);
    await waitFor(() => !!host.room.match!.games[gi].end && !!guest.room.match!.games[gi].end, 3000, 'both ends');
    if (host.room.outcome() || guest.room.outcome()) {
      await waitFor(() => host.room.outcome() === guest.room.outcome(), 3000, 'agreed outcome');
      break;
    }
    // between games: the loser chooses, both submit (unchanged) decks
    const chooser = host.room.chooserFor(gi + 1);
    if (chooser != null) {
      const p = chooser === 0 ? host : guest;
      p.room.chooseFirst(gi + 1, ((gi + c.seed) % 2) as PlayerId);
    }
    host.room.submitDeck(gi + 1, wireDeck(c.a));
    guest.room.submitDeck(gi + 1, wireDeck(c.b));
  }
  // rematch: both ask, both land in the lobby
  host.room.askRematch();
  guest.room.askRematch();
  await waitFor(() => !host.room.match && !guest.room.match, 3000, 'rematch to lobby');
  host.room.leave();
  guest.room.leave();
  await sleep(10);
  return decisions;
}

function mulberry(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

(async () => {
  const t0 = Date.now();
  // room codes and server strings
  const code = newRoomCode();
  if (normalizeRoomCode(code.toLowerCase().replace('-', ' ')) !== code) fail(`room code ${code} does not round-trip`);
  if (normalizeRoomCode('IIII-0000') !== null) fail('ambiguous code accepted');
  const srv = parseServer('localhost:9000/edison');
  if (!srv || srv.secure || srv.port !== 9000 || srv.path !== '/edison') fail(`parseServer: ${JSON.stringify(srv)}`);

  const decks = PREMADE_DECKS;
  let total = 0;
  let games = 0;
  for (let i = 0; i < GAMES; i++) {
    const c: Case = {
      a: decks[(i * 7) % decks.length],
      b: decks[(i * 13 + 5) % decks.length],
      seed: SEED0 + i * 7919,
      bestOf: i % 3 === 1 ? 3 : 1,
      cuts: i % 4 === 2 ? 3 : 0,
      reload: i % 6 === 3 ? 'guest' : i % 6 === 5 ? 'host' : 'none',
      concede: i === 4,
      corrupt: i === 8,
    };
    const label = `#${i + 1} ${c.a.id} vs ${c.b.id} seed ${c.seed} bo${c.bestOf}`;
    warnings = [];
    try {
      total += await runCase(c, label);
      games++;
    } catch (e) {
      fail(`${label}: ${(e as Error).stack}`);
    }
    if (!c.corrupt && warnings.length) fail(`${label}: unexpected warnings ${warnings.slice(0, 2).join(' | ')}`);
  }
  console.log(`net-test: ${games}/${GAMES} matches, ${total} decisions in lockstep, ${failures} failure${failures === 1 ? '' : 's'}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failures ? 1 : 0);
})();
void (null as unknown as GameEnd);
