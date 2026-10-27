// Friends Locals spectating: a player in a match lets friends watch it.
//
// Each player of a match registers a spectator feed (spectatePeerId) next to the match room. A
// spectator dials one of the two players and receives the match read-only: the match start, each
// game's setup (seed, first player, decks, the result once known) and both seats' decision logs as
// they grow. The spectator's phone rebuilds the same deterministic game from them and plays both
// seats from the logs (two RemoteControllers), so it sees exactly what happened on the table. The
// spectator board shows public information only (both hands and face-down cards stay hidden).
//
// The feed sends whatever the spectator is missing: on connect the spectator says how many entries
// it holds per game and seat (`wh`) and the player sends the rest, then keeps pushing new entries.
// DOM-free.
import { GameOver } from '../engine/game';
import type { Decision } from '../engine/replay';
import type { PlayerId } from '../engine/types';
import { NetHub } from './hub';
import { PROTOCOL_VERSION, type GameEnd, type MatchStart, type Msg, type NetPlayer, type WireDeck } from './protocol';
import { RemoteController } from './remote';
import type { Room } from './room';
import { NetSession, type NetStatus } from './session';
import type { Transport } from './transport';
import { spectatePeerId } from './tourneyProtocol';

interface Sent {
  start: string | null;
  meta: string[];
  have: [number, number][];
}

/** A player's side: lets any number of spectators watch the match in `room`. */
export class SpectateServer {
  private hub: NetHub;
  private sent = new Map<string, Sent>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(
    private room: Room,
    transport: Transport,
    seat: PlayerId,
    o: { build: string; me: NetPlayer; heartbeatMs?: number; timeoutMs?: number; pushMs?: number },
  ) {
    this.hub = new NetHub(transport, {
      id: spectatePeerId(room.code, seat),
      heartbeatMs: o.heartbeatMs,
      timeoutMs: o.timeoutMs,
      hello: () => ({ t: 'hello', proto: PROTOCOL_VERSION, build: o.build, sid: 'feed', role: 'host', player: o.me, match: null, game: null, have: 0 }),
      accept: (h) => (h.proto !== PROTOCOL_VERSION || h.build !== o.build ? 'version' : true),
    });
    this.hub.onConnect = (id) => {
      this.sent.set(id, { start: null, meta: [], have: [] });
      this.push();
    };
    this.hub.onDisconnect = (id) => this.sent.delete(id);
    this.hub.onMessage = (id, m) => {
      if (m.t !== 'wh') return;
      const s = this.sent.get(id);
      if (!s) return;
      s.have = Array.from(m.have ?? [], (x) => [(x?.[0] ?? 0) | 0, (x?.[1] ?? 0) | 0] as [number, number]);
      this.push();
    };
    this.timer = setInterval(() => this.push(), o.pushMs ?? 400);
  }

  get watchers() {
    return this.sent.size;
  }

  /** Register the feed. Failing to (e.g. the id is still held after a reload) only means nobody can watch. */
  async start() {
    try {
      await this.hub.start({ retryTaken: true });
    } catch {
      /* spectating is optional */
    }
  }

  /** Send every spectator what it is missing. */
  push() {
    const m = this.room.match;
    if (this.closed || !m) return;
    for (const [id, s] of this.sent) {
      if (!this.hub.connected(id)) continue;
      if (s.start !== m.start.id) {
        this.hub.send(id, { t: 'ws', start: m.start });
        s.start = m.start.id;
        s.meta = [];
      }
      for (const g of m.games) {
        const meta = JSON.stringify([g.seed, g.first, g.decks, g.end]);
        if (s.meta[g.index] !== meta) {
          s.meta[g.index] = meta;
          this.hub.send(id, { t: 'wg', g: g.index, seed: g.seed, first: g.first, decks: g.decks, end: g.end });
        }
        const have = (s.have[g.index] ??= [0, 0]);
        for (const seat of [0, 1] as PlayerId[]) {
          const log = g.logs[seat];
          for (let n = have[seat]; n < log.length; n++) this.hub.send(id, { t: 'wd', g: g.index, s: seat, n, e: log[n] });
          have[seat] = Math.max(have[seat], log.length);
        }
      }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.hub.close();
  }
}

export interface WatchGame {
  index: number;
  seed: number;
  first: PlayerId | 'coin' | null;
  decks: [WireDeck | null, WireDeck | null];
  logs: [Decision[], Decision[]];
  end: GameEnd | null;
}

/** Why watching could not start: the players run another app build, or neither feed answered. */
export class SpectateError extends Error {
  constructor(readonly reason: 'version' | 'unreachable') {
    super(reason === 'version' ? 'The players are on a different app version' : 'Could not reach the table');
  }
}

/** The spectator's side: mirrors the match and plays both seats from the logs. */
export class SpectateClient {
  start: MatchStart | null = null;
  games: WatchGame[] = [];
  onUpdate: () => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};
  private session: NetSession | null = null;
  private remotes = new Map<string, RemoteController>();
  private closed = false;

  constructor(
    private o: { roomCode: string; transport: () => Transport; build: string; me: NetPlayer; heartbeatMs?: number; timeoutMs?: number },
  ) {}

  get status(): NetStatus {
    return this.session?.status ?? 'idle';
  }

  /**
   * Dial the match host's feed, then the other player's, and wait for the handshake. Rejects with a
   * SpectateError when neither feed lets us in within `timeoutMs` (all seats together): 'version'
   * when a feed refused our build, 'unreachable' otherwise. Without the handshake wait a refused
   * spectator would sit on "Connecting…" forever while its session redialled.
   */
  async begin(seats: PlayerId[] = [0, 1], timeoutMs = 8000) {
    const until = Date.now() + timeoutMs;
    let reason: SpectateError['reason'] = 'unreachable';
    for (const seat of seats) {
      if (this.closed) return;
      const left = until - Date.now();
      if (left <= 0) break;
      const s = new NetSession(this.o.transport(), {
        role: 'guest',
        roomId: spectatePeerId(this.o.roomCode, seat),
        heartbeatMs: this.o.heartbeatMs,
        timeoutMs: this.o.timeoutMs,
        hello: () => ({ t: 'hello', proto: PROTOCOL_VERSION, build: this.o.build, sid: 'watch', role: 'guest', player: this.o.me, match: null, game: null, have: 0 }),
        accept: (h) => (h.proto !== PROTOCOL_VERSION || h.build !== this.o.build ? 'version' : true),
      });
      s.onStatus = (st) => this.onStatus(st);
      s.onMessage = (m) => this.receive(m);
      const out = await new Promise<'ok' | 'version' | 'fail'>((res) => {
        const timer = setTimeout(() => res('fail'), left);
        const done = (r: 'ok' | 'version' | 'fail') => {
          clearTimeout(timer);
          res(r);
        };
        s.onConnect = () => {
          s.send({ t: 'wh', have: this.have() });
          done('ok');
        };
        s.onRefused = (r) => done(r === 'version' ? 'version' : 'fail');
        s.start().catch(() => done('fail'));
      });
      if (out === 'ok' && !this.closed) {
        s.onConnect = () => s.send({ t: 'wh', have: this.have() });
        s.onRefused = () => {};
        this.session = s;
        return;
      }
      s.close();
      if (out === 'version') reason = 'version';
    }
    if (this.closed) return;
    throw new SpectateError(reason);
  }

  /** The seat `seat` of game `g`, fed from the stream. */
  remote(g: number, seat: PlayerId, onWaiting?: (on: boolean) => void): RemoteController {
    const rc = new RemoteController({
      entries: () => this.games[g]?.logs[seat] ?? [],
      onWaiting,
      onMismatch: (detail) => console.warn(`[spectate] game ${g + 1} does not replay: ${detail}`),
    });
    this.remotes.set(`${g}:${seat}`, rc);
    const end = this.games[g]?.end;
    if (end?.kind) rc.fail(new GameOver(end.winner, end.reason));
    return rc;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const rc of this.remotes.values()) rc.fail(new GameOver(null, 'Spectating stopped'));
    this.session?.close();
  }

  private have(): [number, number][] {
    return Array.from(this.games, (g) => [g?.logs[0].length ?? 0, g?.logs[1].length ?? 0] as [number, number]);
  }

  private game(g: number): WatchGame {
    return (this.games[g] ??= { index: g, seed: 0, first: null, decks: [null, null], logs: [[], []], end: null });
  }

  private receive(m: Msg) {
    switch (m.t) {
      case 'ws':
        if (this.start?.id !== m.start.id) {
          this.start = m.start;
          this.games = [];
        }
        break;
      case 'wg': {
        const g = this.game(m.g);
        g.seed = m.seed;
        g.first = m.first;
        g.decks = m.decks;
        const had = g.end;
        g.end = m.end;
        // ended outside the engine (concede, claim, desync): stop the board there
        if (!had && m.end?.kind) for (const s of [0, 1]) this.remotes.get(`${m.g}:${s}`)?.fail(new GameOver(m.end.winner, m.end.reason));
        break;
      }
      case 'wd': {
        const g = this.game(m.g);
        const log = g.logs[m.s];
        if (m.n < log.length) return;
        if (m.n > log.length) {
          this.session?.send({ t: 'wh', have: this.have() });
          return;
        }
        log.push(m.e);
        this.remotes.get(`${m.g}:${m.s}`)?.notify();
        break;
      }
      default:
        return;
    }
    this.onUpdate();
  }
}
