// Friends Locals: getting the two phones of a table into their match room.
//
// Both phones open the room on their own (seat a registers it, seat b dials it), so the room keeps
// trying until the opponent's phone is there. That used to go on silently forever: on hotel or
// guest Wi-Fi the phones often cannot reach each other directly, and both just showed "Waiting for
// <name> to sit down…". TableLink runs that loop and reports `stuck` once the room has not
// connected for `stuckMs`, with what went wrong last, so the screen can say why and offer Retry.
// Retry throws the room away and opens a fresh one (a new signalling registration: a stale one,
// "ID taken", is retried with backoff until the server lets the old one go).
//
// DOM-free (timers only): scripts/tourney-test.ts runs it over the in-memory transport.
import type { Room } from './room';
import { TransportError, type TransportErrorKind } from './transport';

/**
 * Why the table has not connected yet:
 * - 'unreachable': the opponent's room is there but no direct connection gets through (Wi-Fi isolation),
 * - 'not-open': nobody is registered under the room id (the opponent has not sat down, or lost the server),
 * - 'id-taken': our own previous registration of the room is still held by the server,
 * - 'server': the signalling server cannot be reached.
 */
export type TableTrouble = 'unreachable' | 'not-open' | 'id-taken' | 'server';

export interface TableLinkOptions {
  /** A fresh room (each with its own transport). Called once at the start and on every retry. */
  makeRoom: () => Room;
  /** Show the trouble after this long without connecting (default 20 s). */
  stuckMs?: number;
  /** A retry replaced the room. */
  onRoom?: (room: Room) => void;
  /** The trouble changed (null: connected, or a retry has just started). */
  onStuck?: (t: TableTrouble | null) => void;
  /** WebRTC is not available: no point in trying again. */
  onFatal?: (e: TransportError) => void;
  /** Delay between attempts (ms), by attempt number and the last error. */
  backoff?: (i: number, kind: TransportErrorKind) => number;
}

const defaultBackoff = (i: number, kind: TransportErrorKind) =>
  // our own stale registration: the server lets it go after its alive timeout, no point hammering it
  kind === 'id-taken' ? Math.min(8000, 1000 * 2 ** Math.min(i, 3)) : Math.min(4000, 800 + i * 300);

export class TableLink {
  room: Room;
  /** Set once the room has not connected for `stuckMs`. */
  stuck: TableTrouble | null = null;
  /** The last error opening the room, if any. */
  lastError: TransportErrorKind | null = null;
  /** Attempts (room.start calls) since the last (re)open. */
  attempts = 0;
  /** Retries so far. */
  retries = 0;
  private gen = 0;
  private since = Date.now();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private everConnected = false;
  readonly stuckMs: number;

  constructor(private o: TableLinkOptions) {
    this.stuckMs = o.stuckMs ?? 20000;
    this.room = o.makeRoom();
  }

  get connected() {
    return this.room.status === 'connected';
  }

  /** Open the room and keep trying until the opponent is in (resolves then, or when closed / retried). */
  async start(): Promise<void> {
    const gen = this.gen;
    this.since = Date.now();
    this.attempts = 0;
    this.ticker ??= setInterval(() => this.check(), Math.min(1000, Math.max(20, this.stuckMs / 10)));
    for (let i = 0; this.live(gen); i++) {
      this.attempts++;
      try {
        await this.room.start();
        this.lastError = null;
        return;
      } catch (e) {
        if (!this.live(gen)) return;
        const kind = e instanceof TransportError ? e.kind : 'other';
        if (kind === 'unsupported') {
          this.stop();
          this.o.onFatal?.(e as TransportError);
          return;
        }
        this.lastError = kind;
        this.check();
        await sleep((this.o.backoff ?? defaultBackoff)(i, kind));
      }
    }
  }

  /**
   * Throw the room away and open a fresh one (Retry). Only before the match: once the phones have
   * met, their session reconnects by itself. Returns false when there is nothing to retry.
   */
  retry(): boolean {
    if (this.closed || this.everConnected || this.room.match || this.connected) return false;
    this.gen++;
    this.retries++;
    const old = this.room;
    old.ev = {};
    old.leave();
    this.room = this.o.makeRoom();
    this.lastError = null;
    this.setStuck(null);
    this.o.onRoom?.(this.room);
    void this.start();
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stop();
  }

  private live(gen: number) {
    return !this.closed && gen === this.gen;
  }

  private stop() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }

  private check() {
    if (this.closed) return;
    if (this.connected || this.room.match) {
      this.everConnected = true;
      this.setStuck(null);
      this.stop();
      return;
    }
    if (Date.now() - this.since < this.stuckMs) return;
    this.setStuck(troubleOf(this.room.role, this.lastError));
  }

  private setStuck(t: TableTrouble | null) {
    if (this.stuck === t) return;
    this.stuck = t;
    this.o.onStuck?.(t);
  }
}

function troubleOf(role: 'host' | 'guest', kind: TransportErrorKind | null): TableTrouble {
  if (kind === 'id-taken') return 'id-taken';
  if (kind === 'server') return 'server';
  if (kind === 'no-peer') return 'not-open';
  // the host is registered and listening: the opponent either has not sat down or cannot get through
  void role;
  return 'unreachable';
}

/** What the waiting pane says when a table is stuck. */
export function tableTroubleText(t: TableTrouble, opponent: string): string {
  const wifi = 'Hotel or guest Wi-Fi often blocks this: put one phone on the other’s Personal Hotspot, then tap Retry.';
  switch (t) {
    case 'not-open':
      return `${opponent}’s phone hasn’t opened the table. Check they tapped Start match. If they have: ${wifi}`;
    case 'id-taken':
      return `This phone’s old connection to the table is still registered. Tap Retry in a moment, or ask the organiser to restart the match.`;
    case 'server':
      return 'Can’t reach the connection service. Check this phone is online, then tap Retry.';
    default:
      return `Can’t reach ${opponent}’s phone. ${wifi}`;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
