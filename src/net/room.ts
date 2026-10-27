// A "Play a friend" room: the lobby, the match and every game's decision logs, kept in step
// between the two phones over a NetSession.
//
// Seats: the host is seat 0 and the guest seat 1 on both phones, so both build the identical Game.
// Each phone owns its seat's decisions (`logs[mySeat]`), sends each new one as a `d` message and
// receives the friend's into `logs[peerSeat]`, which the RemoteController plays from. On every
// (re)connection both sides re-send their whole state (lobby, decks, first-player choices,
// outside game ends, rematch requests) and a `sync` per game saying how many of the friend's
// entries they hold; the friend re-sends the rest. Every message is idempotent, so duplicates are
// harmless and nothing needs acknowledgements.
//
// Between games of a Bo3 each side submits its deck for the next game (`submitDeck`, the place
// where siding plugs in) and the loser of the previous game chooses who goes first. The next game
// starts when both decks and the choice are known (`gameReady`).
//
// DOM-free: the friend screen and scripts/net-test.ts both drive it.
import { GameOver } from '../engine/game';
import type { Decision } from '../engine/replay';
import type { PlayerId } from '../engine/types';
import { matchOutcome } from '../tournament/simulate';
import type { GameResult } from '../tournament/types';
import { PROTOCOL_VERSION, REACTIONS, gameSeed, roomPeerId, type GameEnd, type LobbyState, type MatchStart, type Msg, type NetPlayer, type Reaction, type WireDeck } from './protocol';
import { RemoteController } from './remote';
import { NetSession, type NetStatus } from './session';
import type { Transport } from './transport';

export interface GameState {
  index: number;
  seed: number;
  first: PlayerId | 'coin' | null;
  decks: [WireDeck | null, WireDeck | null];
  /** Decisions by seat. */
  logs: [Decision[], Decision[]];
  /** Turn number at our last decision (resume card). */
  turn: number;
  end: GameEnd | null;
  /** We ended it outside the engine (concede, claim, desync): re-sent on reconnect. */
  endByMe?: boolean;
  endDetail?: string;
  /** Card ids each seat showed by the end (this phone's own view; feeds the siding screen). */
  seen?: [string[], string[]];
}

export interface MatchState {
  start: MatchStart;
  games: GameState[];
}

export interface RoomSnapshot {
  v: 1;
  role: 'host' | 'guest';
  code: string;
  me: NetPlayer;
  peer: NetPlayer | null;
  mine: LobbyState;
  theirs: LobbyState | null;
  match: MatchState | null;
  rematch: [boolean, boolean];
}

export interface RoomEvents {
  status?(s: NetStatus): void;
  /** The friend joined (or came back). */
  peer?(p: NetPlayer): void;
  lobby?(): void;
  matchStart?(m: MatchState): void;
  /** Everything for game `g` is known: start it. */
  gameReady?(g: number): void;
  /** Game `g` ended outside our engine (the friend conceded, claimed the win, or saw a desync). */
  gameEnd?(g: number, end: GameEnd): void;
  /** A first-player choice or deck for the next game arrived. */
  between?(): void;
  /** Waiting for the friend's decision. */
  waiting?(on: boolean): void;
  /** Both asked for a rematch: back in the lobby. */
  rematch?(): void;
  /** The friend asked for a rematch. */
  rematchAsked?(): void;
  /** The friend left the room. */
  left?(): void;
  /** The friend's app is a different version, or the room is in use by someone else. */
  refused?(reason: 'busy' | 'version'): void;
  /** Something to save (decisions, results). */
  changed?(): void;
  /** Our desync report (details for the console). */
  desync?(g: number, detail: string): void;
  /** The friend sent a quick reaction (Friends Locals). */
  reaction?(r: Reaction): void;
}

export interface RoomOptions {
  role: 'host' | 'guest';
  code: string;
  me: NetPlayer;
  build: string;
  transport: Transport;
  events?: RoomEvents;
  /** Restore from a saved snapshot (resume). */
  snapshot?: RoomSnapshot;
  heartbeatMs?: number;
  timeoutMs?: number;
  /** Only this clientId may join (Friends Locals: the paired opponent). */
  expectPeer?: string;
}

const sid = () => Math.random().toString(36).slice(2, 10);

export class Room {
  readonly role: 'host' | 'guest';
  readonly code: string;
  readonly mySeat: PlayerId;
  readonly peerSeat: PlayerId;
  me: NetPlayer;
  peer: NetPlayer | null = null;
  mine: LobbyState = { deckKey: null, deck: null, ready: false, bestOf: 1 };
  theirs: LobbyState | null = null;
  match: MatchState | null = null;
  /** Rematch requests: [mine, theirs]. */
  rematch: [boolean, boolean] = [false, false];
  readonly session: NetSession;
  ev: RoomEvents;
  private readonly sid = sid();
  private remotes = new Map<number, RemoteController>();
  private announced = new Set<number>();
  private closed = false;

  constructor(private o: RoomOptions) {
    this.role = o.role;
    this.code = o.code;
    this.mySeat = o.role === 'host' ? 0 : 1;
    this.peerSeat = (1 - this.mySeat) as PlayerId;
    this.me = o.me;
    this.ev = o.events ?? {};
    const s = o.snapshot;
    if (s) {
      this.peer = s.peer;
      this.mine = { ...s.mine };
      this.theirs = s.theirs;
      this.match = s.match;
      this.rematch = s.rematch ?? [false, false];
      // games already over were announced before the reload
      for (const g of this.match?.games ?? []) if (g.decks[0] && g.decks[1] && g.first != null) this.announced.add(g.index);
    }
    this.session = new NetSession(o.transport, {
      role: o.role,
      roomId: roomPeerId(o.code),
      heartbeatMs: o.heartbeatMs,
      timeoutMs: o.timeoutMs,
      hello: () => ({
        t: 'hello',
        proto: PROTOCOL_VERSION,
        build: o.build,
        sid: this.sid,
        role: this.role,
        player: this.me,
        match: this.match?.start.id ?? null,
        game: this.match ? this.match.games.length - 1 : null,
        have: this.current ? this.current.logs[this.peerSeat].length : 0,
      }),
      accept: (h) => {
        if (h.proto !== PROTOCOL_VERSION || h.build !== o.build) return 'version';
        if (h.role === this.role) return 'busy';
        if (o.expectPeer && h.player.clientId !== o.expectPeer) return 'busy';
        // a different phone while the friend is connected: the room is taken
        if (this.peer && h.player.clientId !== this.peer.clientId && this.session.connected) return 'busy';
        return true;
      },
    });
    this.session.onStatus = (st) => this.ev.status?.(st);
    this.session.onConnect = (h) => this.connected(h.player, h.match);
    this.session.onMessage = (m) => this.receive(m);
    this.session.onRefused = (r) => this.ev.refused?.(r);
  }

  /** Open the room (host) or join it (guest). Rejects with a TransportError. */
  start() {
    return this.session.start({ retryTaken: !!this.o.snapshot });
  }

  get status() {
    return this.session.status;
  }

  get current(): GameState | null {
    const g = this.match?.games;
    return g && g.length ? g[g.length - 1] : null;
  }

  snapshot(): RoomSnapshot {
    return { v: 1, role: this.role, code: this.code, me: this.me, peer: this.peer, mine: this.mine, theirs: this.theirs, match: this.match, rematch: this.rematch };
  }

  // ------------------------------------------------------------------ lobby

  setLobby(patch: Partial<LobbyState>) {
    if (this.role !== 'host') delete patch.bestOf;
    this.mine = { ...this.mine, ...patch };
    this.session.send({ t: 'lobby', state: this.mine });
    this.ev.lobby?.();
  }

  get bestOf(): 1 | 3 {
    return (this.role === 'host' ? this.mine.bestOf : this.theirs?.bestOf) === 3 ? 3 : 1;
  }

  /** Host: both are ready with a deck. */
  get canStart() {
    return this.role === 'host' && !this.match && !!this.peer && this.session.connected && this.mine.ready && !!this.mine.deck && !!this.theirs?.ready && !!this.theirs.deck;
  }

  /** Host: start the match. `seed` and `skipFirstDraw` come from the host. */
  startMatch(opts: { seed?: number; skipFirstDraw: boolean; id?: string }) {
    if (!this.canStart) return false;
    const start: MatchStart = {
      id: opts.id ?? `${this.code}-${Date.now().toString(36)}`,
      seed: opts.seed ?? Math.floor(Math.random() * 2 ** 31),
      bestOf: this.bestOf,
      skipFirstDraw: opts.skipFirstDraw,
      players: [this.me, this.peer!],
      decks: [this.mine.deck!, this.theirs!.deck!],
    };
    this.beginMatch(start);
    this.session.send({ t: 'start', match: start });
    return true;
  }

  private beginMatch(start: MatchStart) {
    this.match = { start, games: [] };
    this.rematch = [false, false];
    this.newGame(0).decks = [start.decks[0], start.decks[1]];
    this.match.games[0].first = 'coin';
    this.ev.changed?.();
    this.ev.matchStart?.(this.match);
    this.checkReady(0);
  }

  private newGame(index: number): GameState {
    const m = this.match!;
    let g = m.games[index];
    if (!g) {
      g = { index, seed: gameSeed(m.start.seed, index), first: null, decks: [null, null], logs: [[], []], turn: 0, end: null };
      m.games[index] = g;
    }
    return g;
  }

  // ------------------------------------------------------------------ games

  /** Results so far, seat 0 = host. */
  results(): GameResult[] {
    return (this.match?.games ?? []).filter((g) => g.end).map((g) => ({ winner: g.end!.winner as 0 | 1 | null, turns: g.end!.turns, reason: g.end!.reason, how: 'human' as const }));
  }

  /** The match result once decided ('a' = host won). */
  outcome(): 'a' | 'b' | 'draw' | null {
    if (!this.match) return null;
    if (this.match.games.some((g) => g.end?.kind === 'desync')) return null;
    const out = matchOutcome(this.results(), this.match.start.bestOf);
    return out.result ?? (out.exhausted ? 'draw' : null);
  }

  /** Who chooses first for game `g` (the loser of g-1), or null after a draw / for game 1. */
  chooserFor(g: number): PlayerId | null {
    const prev = this.match?.games[g - 1]?.end;
    if (!prev || prev.winner == null) return null;
    return (1 - prev.winner) as PlayerId;
  }

  /** Our decision log for game `g` changed (the duel's onDecision): send the new entries. */
  localDecision(g: number, log: readonly Decision[], turn?: number) {
    const st = this.match?.games[g];
    if (!st) return;
    const mine = st.logs[this.mySeat];
    const from = mine.length;
    for (let i = from; i < log.length; i++) mine.push(log[i]);
    if (turn != null) st.turn = turn;
    this.ev.changed?.();
    for (let i = from; i < mine.length; i++) this.session.send({ t: 'd', m: this.match!.start.id, g, n: i, e: mine[i] });
  }

  /** The friend's seat for game `g`. */
  remoteController(g: number): RemoteController {
    const st = this.match!.games[g];
    const rc = new RemoteController({
      entries: () => st.logs[this.peerSeat],
      onWaiting: (on) => this.ev.waiting?.(on),
      onMismatch: (detail) => {
        this.ev.desync?.(g, detail);
        this.endGame(g, { winner: null, reason: 'Out of sync', turns: 0, kind: 'desync' }, detail);
      },
    });
    this.remotes.set(g, rc);
    return rc;
  }

  /** The engine finished game `g` (both phones reach the same result). */
  gameOver(g: number, end: GameEnd) {
    const st = this.match?.games[g];
    if (!st || st.end) return;
    st.end = { winner: end.winner, reason: end.reason, turns: end.turns };
    this.afterEnd(g);
  }

  /** End game `g` from this phone: concede, claim the win after a disconnect, or a desync. */
  endGame(g: number, end: GameEnd, detail?: string) {
    const st = this.match?.games[g];
    if (!st || st.end) return;
    st.end = end;
    st.endByMe = true;
    st.endDetail = detail;
    this.remotes.get(g)?.fail(new GameOver(end.winner, end.reason));
    this.session.send({ t: 'end', m: this.match!.start.id, g, end, detail });
    this.afterEnd(g);
  }

  private afterEnd(g: number) {
    const st = this.match!.games[g];
    if (!this.outcome() && st.end?.kind !== 'desync') {
      const next = this.newGame(g + 1);
      if (st.end!.winner == null) next.first = 'coin';
    }
    this.ev.changed?.();
    this.checkReady(g + 1);
  }

  /** Between games: our deck for game `g` (siding plugs in here; default the same deck). */
  submitDeck(g: number, deck: WireDeck) {
    const st = this.match?.games[g];
    if (!st || st.decks[this.mySeat]) return;
    st.decks[this.mySeat] = deck;
    this.session.send({ t: 'deck', m: this.match!.start.id, g, deck });
    this.ev.changed?.();
    this.checkReady(g);
  }

  /** Between games: the loser of the previous game chooses who goes first in game `g`. */
  chooseFirst(g: number, first: PlayerId) {
    const st = this.match?.games[g];
    if (!st || st.first != null || this.chooserFor(g) !== this.mySeat) return;
    st.first = first;
    this.session.send({ t: 'first', m: this.match!.start.id, g, first });
    this.ev.changed?.();
    this.checkReady(g);
  }

  private checkReady(g: number) {
    const st = this.match?.games[g];
    if (!st || this.announced.has(g) || !st.decks[0] || !st.decks[1] || st.first == null) return;
    this.announced.add(g);
    this.ev.gameReady?.(g);
  }

  // ------------------------------------------------------------------ after the match

  /** Ask for a rematch (after the match, or after a desync). Both asking returns to the lobby. */
  askRematch() {
    if (!this.match) return;
    this.rematch[0] = true;
    this.session.send({ t: 'rematch', m: this.match.start.id });
    this.maybeRematch();
  }

  private maybeRematch() {
    if (!this.rematch[0] || !this.rematch[1]) return;
    this.match = null;
    this.remotes.clear();
    this.announced.clear();
    this.rematch = [false, false];
    this.mine = { ...this.mine, ready: false };
    if (this.theirs) this.theirs = { ...this.theirs, ready: false };
    this.session.send({ t: 'lobby', state: this.mine });
    this.ev.changed?.();
    this.ev.rematch?.();
  }

  /**
   * A quick reaction ("GG", "Nice!"…) to the friend. Fire and forget over the room's own link: it is
   * not part of the match state, the decision logs or the save, so it can never change a game or
   * its replay; one sent while the link is down is simply lost.
   */
  react(r: Reaction) {
    if (this.closed || !REACTIONS.includes(r)) return;
    this.session.send({ t: 'rx', r });
  }

  leave() {
    if (this.closed) return;
    this.closed = true;
    this.session.close({ t: 'leave', reason: 'left' });
  }

  // ------------------------------------------------------------------ wire

  /** A (re)connection: re-send everything the friend may have missed. */
  private connected(p: NetPlayer, theirMatch: string | null) {
    this.peer = p;
    this.ev.peer?.(p);
    const send = (m: Msg) => this.session.send(m);
    send({ t: 'lobby', state: this.mine });
    const m = this.match;
    // they are still in a match we already left for the lobby (they missed the rematch)
    if (theirMatch && (!m || m.start.id !== theirMatch) && this.role === 'host') send({ t: 'rematch', m: theirMatch });
    if (!m) return;
    const id = m.start.id;
    if (this.role === 'host') send({ t: 'start', match: m.start });
    for (const g of m.games) {
      if (g.index > 0 && g.decks[this.mySeat]) send({ t: 'deck', m: id, g: g.index, deck: g.decks[this.mySeat]! });
      if (g.index > 0 && g.first != null && this.chooserFor(g.index) === this.mySeat) send({ t: 'first', m: id, g: g.index, first: g.first });
      if (g.end && g.endByMe) send({ t: 'end', m: id, g: g.index, end: g.end, detail: g.endDetail });
      send({ t: 'sync', m: id, g: g.index, have: g.logs[this.peerSeat].length });
    }
    if (this.rematch[0]) send({ t: 'rematch', m: id });
  }

  private receive(msg: Msg) {
    if (this.closed) return;
    const m = this.match;
    switch (msg.t) {
      case 'lobby':
        this.theirs = msg.state;
        this.ev.lobby?.();
        return;
      case 'start':
        if (this.role !== 'guest' || m?.start.id === msg.match.id) return;
        this.beginMatch(msg.match);
        return;
      case 'rx':
        if (REACTIONS.includes(msg.r)) this.ev.reaction?.(msg.r);
        return;
      case 'leave':
        this.ev.left?.();
        return;
      case 'rematch':
        if (!m || msg.m !== m.start.id || this.rematch[1]) return;
        this.rematch[1] = true;
        this.ev.rematchAsked?.();
        this.maybeRematch();
        return;
    }
    if (!m || !('m' in msg) || msg.m !== m.start.id) return;
    switch (msg.t) {
      case 'd': {
        const st = m.games[msg.g];
        if (!st) return;
        const theirs = st.logs[this.peerSeat];
        if (msg.n < theirs.length) return; // duplicate
        if (msg.n > theirs.length) {
          // a gap (should not happen on an ordered channel): ask for the rest
          this.session.send({ t: 'sync', m: m.start.id, g: msg.g, have: theirs.length });
          return;
        }
        theirs.push(msg.e);
        this.ev.changed?.();
        this.remotes.get(msg.g)?.notify();
        return;
      }
      case 'sync': {
        const st = m.games[msg.g];
        if (!st) return;
        const mine = st.logs[this.mySeat];
        for (let i = msg.have; i < mine.length; i++) this.session.send({ t: 'd', m: m.start.id, g: msg.g, n: i, e: mine[i] });
        return;
      }
      case 'deck': {
        const st = this.newGame(msg.g);
        if (st.decks[this.peerSeat]) return;
        st.decks[this.peerSeat] = msg.deck;
        this.ev.changed?.();
        this.ev.between?.();
        this.checkReady(msg.g);
        return;
      }
      case 'first': {
        const st = this.newGame(msg.g);
        if (st.first != null) return;
        st.first = msg.first;
        this.ev.changed?.();
        this.ev.between?.();
        this.checkReady(msg.g);
        return;
      }
      case 'end': {
        const st = m.games[msg.g];
        if (!st || st.end) return;
        st.end = msg.end;
        if (msg.end.kind === 'desync') console.warn(`[online] friend reported a desync in game ${msg.g + 1}: ${msg.detail ?? ''}`);
        this.remotes.get(msg.g)?.fail(new GameOver(msg.end.winner, msg.end.reason));
        this.ev.gameEnd?.(msg.g, msg.end);
        this.afterEnd(msg.g);
        return;
      }
    }
  }
}
