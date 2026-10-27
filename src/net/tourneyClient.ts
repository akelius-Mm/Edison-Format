// Friends Locals: a player's phone. Keeps the link to the organiser (a guest NetSession that dials
// the tournament id; the organiser's own phone uses a LocalLink), the last view of the event it was
// sent, its registration, and the match reports the organiser has not confirmed yet.
//
// On every (re)connection it re-sends its registration (`tj`), every unconfirmed report and its
// draw offers; the organiser answers with the current view. A report counts as delivered once the
// view lists this player under the match's `reported`, or the match has a result. While the
// organiser is away (its phone asleep, reloading) matches keep going between the players' phones
// and reports simply wait here.
//
// Chat lines wait in an outbox until the organiser echoes them back (`tmsg` with our `cid`), and
// are re-sent on reconnect; the organiser drops the duplicates. The chat history it sends on every
// connect (`tchats`) replaces ours.
//
// DOM-free: the Friends Locals screen and scripts/tourney-test.ts both drive it.
import type { Room } from './room';
import { PROTOCOL_VERSION, type Msg, type NetPlayer, type WireDeck } from './protocol';
import { NetSession, type NetStatus } from './session';
import type { Transport } from './transport';
import { CHAT_KEEP, CHAT_MAX, TOURNEY_PROTO, cleanName, matchRoomCode, tourneyPeerId, type ChatLine, type Report, type TMatch, type TView } from './tourneyProtocol';

/** What carries messages to the organiser: a NetSession, or the organiser's LocalLink. */
export interface Link {
  readonly status: NetStatus;
  onStatus: (s: NetStatus) => void;
  onMessage: (m: Msg) => void;
  onConnect: (h?: any) => void;
  start(): Promise<void>;
  send(m: Msg): void;
  close(farewell?: Msg): void;
  wake?(): void;
}

export interface ClientSnapshot {
  v: 1;
  code: string;
  me: NetPlayer;
  deck: WireDeck | null;
  ready: boolean;
  view: TView | null;
  /** Reports the organiser has not confirmed, by match id. */
  pending: Record<string, Report>;
  idOffers: string[];
  dropped: boolean;
  chat?: ChatLine[];
  outbox?: { cid: string; text: string }[];
  /** Number of the last chat line this player has seen. */
  chatSeen?: number;
}

export interface ClientEvents {
  status?(s: NetStatus): void;
  /** A newer view arrived. */
  view?(v: TView, prev: TView | null): void;
  /** The organiser refused us or closed the event. */
  refused?(reason: 'started' | 'full' | 'version' | 'closed' | 'busy'): void;
  /** Chat lines arrived (or the history was replaced). */
  chat?(): void;
  /** Something to save. */
  changed?(): void;
}

export interface ClientOptions {
  code: string;
  me: NetPlayer;
  build: string;
  /** Dial the organiser over this transport (players). */
  transport?: Transport;
  /** ...or use this link (the organiser's own phone). */
  link?: Link;
  snapshot?: ClientSnapshot;
  events?: ClientEvents;
  heartbeatMs?: number;
  timeoutMs?: number;
}

export class TourneyClient {
  readonly code: string;
  me: NetPlayer;
  deck: WireDeck | null = null;
  ready = false;
  view: TView | null = null;
  pending: Record<string, Report> = {};
  idOffers = new Set<string>();
  dropped = false;
  /** The event chat, oldest first. */
  chat: ChatLine[] = [];
  /** Chat lines the organiser has not echoed yet. */
  outbox: { cid: string; text: string }[] = [];
  chatSeen = 0;
  ev: ClientEvents;
  readonly link: Link;
  private closed = false;

  constructor(private o: ClientOptions) {
    this.code = o.code;
    this.me = o.me;
    this.ev = o.events ?? {};
    const s = o.snapshot;
    if (s) {
      this.deck = s.deck;
      this.ready = s.ready;
      this.view = s.view;
      this.pending = { ...s.pending };
      this.idOffers = new Set(s.idOffers);
      this.dropped = s.dropped;
      this.chat = s.chat ?? [];
      this.outbox = s.outbox ?? [];
      this.chatSeen = s.chatSeen ?? 0;
    }
    this.link =
      o.link ??
      new NetSession(o.transport!, {
        role: 'guest',
        roomId: tourneyPeerId(o.code),
        heartbeatMs: o.heartbeatMs,
        timeoutMs: o.timeoutMs,
        hello: () => ({ t: 'hello', proto: PROTOCOL_VERSION, build: o.build, sid: Math.random().toString(36).slice(2, 10), role: 'guest', player: this.me, match: null, game: null, have: 0 }),
        accept: (h) => (h.proto !== PROTOCOL_VERSION || h.build !== o.build ? 'version' : h.role !== 'host' ? 'busy' : true),
      });
    this.link.onStatus = (st) => this.ev.status?.(st);
    this.link.onConnect = () => this.onLinkUp();
    this.link.onMessage = (m) => this.receive(m);
    if (this.link instanceof NetSession) this.link.onRefused = (r) => this.ev.refused?.(r);
  }

  /** Reach the organiser (rejects with a TransportError when it cannot be dialled the first time). */
  start() {
    return this.link.start();
  }

  get status(): NetStatus {
    return this.link.status;
  }
  get connected() {
    return this.link.status === 'connected';
  }
  get isOrganiser() {
    return !!this.view && this.view.organiser === this.me.clientId;
  }

  snapshot(): ClientSnapshot {
    return { v: 1, code: this.code, me: this.me, deck: this.deck, ready: this.ready, view: this.view, pending: this.pending, idOffers: [...this.idOffers], dropped: this.dropped, chat: this.chat, outbox: this.outbox, chatSeen: this.chatSeen };
  }

  // ------------------------------------------------------------------ queries

  /** The match this phone plays in the current round (pending or finished), if any. */
  myMatch(): TMatch | null {
    const v = this.view;
    if (!v) return null;
    const round = v.phase === 'swiss' ? v.rounds[v.rounds.length - 1] : v.phase === 'top' ? v.top[v.top.length - 1] : null;
    return round?.find((m) => m.a === this.me.clientId || m.b === this.me.clientId) ?? null;
  }

  /** Room settings for a match: seat a hosts it, b joins; only the paired opponent is let in. */
  roomFor(m: TMatch): { role: 'host' | 'guest'; code: string; opponent: string } {
    const host = m.a === this.me.clientId;
    return { role: host ? 'host' : 'guest', code: matchRoomCode(this.code, m), opponent: (host ? m.b : m.a)! };
  }

  /** Chat lines from other players this phone has not seen. */
  unread(): number {
    return this.chat.filter((l) => l.n > this.chatSeen && l.from !== this.me.clientId).length;
  }

  /** The organiser muted this player in the chat. */
  get muted() {
    return !!this.view?.muted?.includes(this.me.clientId);
  }

  /** A report is waiting for the organiser. */
  reportPending(mid: string) {
    return !!this.pending[mid];
  }

  // ------------------------------------------------------------------ actions

  /** Lobby: register (or change) the deck and the ready state. */
  register(deck: WireDeck | null, ready: boolean) {
    this.deck = deck;
    this.ready = ready && !!deck;
    this.sendJoin();
    this.ev.changed?.();
  }

  /** Send a finished match's report (kept until the organiser confirms it). */
  report(rep: Report) {
    const old = this.pending[rep.mid];
    if (old && old.attempt === rep.attempt && old.games.length === rep.games.length) return;
    this.pending[rep.mid] = rep;
    this.ev.changed?.();
    this.sendReport(rep);
  }

  offerId(mid: string, on: boolean) {
    if (on) this.idOffers.add(mid);
    else this.idOffers.delete(mid);
    this.ev.changed?.();
    this.link.send({ t: 'tido', tid: this.view?.tid ?? '', mid, on });
  }

  /** Change my name for this event (the organiser makes it unique and tells everyone). */
  rename(raw: string): boolean {
    const name = cleanName(raw);
    if (!name) return false;
    this.me = { ...this.me, name };
    this.ev.changed?.();
    if (this.view) this.link.send({ t: 'tname', tid: this.view.tid, name });
    else this.sendJoin(); // not in yet: the join carries the name
    return true;
  }

  /** Send a chat line (kept until the organiser echoes it). False when empty or muted. */
  say(raw: string): boolean {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!text || this.muted) return false;
    const line = { cid: Math.random().toString(36).slice(2, 12), text };
    this.outbox.push(line);
    this.ev.changed?.();
    if (this.view) this.link.send({ t: 'tchat', tid: this.view.tid, ...line });
    return true;
  }

  /** Everything in the chat has been seen. */
  markChatRead() {
    const n = this.chat[this.chat.length - 1]?.n ?? 0;
    if (n <= this.chatSeen) return;
    this.chatSeen = n;
    this.ev.changed?.();
  }

  /** Drop from the event (in the lobby: leave it). */
  drop() {
    this.dropped = true;
    this.ev.changed?.();
    this.link.send({ t: 'tdrop', tid: this.view?.tid ?? '' });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.link.close();
  }

  wake() {
    this.link.wake?.();
  }

  // ------------------------------------------------------------------ wire

  private sendJoin() {
    this.link.send({ t: 'tj', tp: TOURNEY_PROTO, tid: this.view?.tid ?? '', player: this.me, deck: this.deck, ready: this.ready, build: this.o.build });
  }

  private sendReport(rep: Report) {
    const tid = this.view?.tid ?? '';
    for (const g of rep.games) this.link.send({ t: 'trg', tid, mid: rep.mid, attempt: rep.attempt, n: rep.games.length, skipFirstDraw: rep.skipFirstDraw, g });
  }

  /** (Re)connected: re-send everything the organiser may have missed. */
  private onLinkUp() {
    this.sendJoin();
    if (this.dropped && this.view && this.view.phase !== 'lobby') this.link.send({ t: 'tdrop', tid: this.view.tid });
    // reports and offers go once the view (tid) is known: sent from receive() on the first view
    if (this.view) this.resend();
  }

  private resend() {
    for (const rep of Object.values(this.pending)) this.sendReport(rep);
    for (const mid of this.idOffers) this.link.send({ t: 'tido', tid: this.view!.tid, mid, on: true });
    for (const line of this.outbox) this.link.send({ t: 'tchat', tid: this.view!.tid, ...line });
  }

  /** Lines from the organiser: add them in order (or replace the whole history). */
  private takeChat(lines: ChatLine[], replace: boolean) {
    const by = new Map((replace ? [] : this.chat).map((l) => [l.n, l]));
    for (const l of lines) if (l && typeof l.n === 'number') by.set(l.n, l);
    this.chat = [...by.values()].sort((a, b) => a.n - b.n).slice(-CHAT_KEEP);
    const mine = new Set(lines.filter((l) => l.from === this.me.clientId).map((l) => l.cid));
    this.outbox = this.outbox.filter((x) => !mine.has(x.cid));
    // our own lines count as seen
    const last = this.chat[this.chat.length - 1];
    if (last && last.from === this.me.clientId && this.unread() === 0) this.chatSeen = Math.max(this.chatSeen, last.n);
    this.ev.changed?.();
    this.ev.chat?.();
  }

  private receive(m: Msg) {
    if (this.closed) return;
    if (m.t === 'tmsg' || m.t === 'tchats') {
      if (this.view && m.tid !== this.view.tid) return;
      this.takeChat(m.t === 'tmsg' ? [m.m] : (m.lines ?? []), m.t === 'tchats');
      return;
    }
    if (m.t === 'tref') {
      if (this.view && m.tid && m.tid !== this.view.tid) return;
      this.ev.refused?.(m.reason);
      return;
    }
    if (m.t !== 'tview') return;
    const v = m.view;
    const prev = this.view;
    if (prev && prev.tid === v.tid && v.rev <= prev.rev) return;
    const first = !prev || prev.tid !== v.tid;
    this.view = v;
    // confirmed reports and settled offers can go
    const all = [...v.rounds.flat(), ...v.top.flat()];
    for (const [mid, rep] of Object.entries(this.pending)) {
      const mm = all.find((x) => x.id === mid);
      if (!mm || mm.result != null || mm.attempt !== rep.attempt || mm.reported.includes(this.me.clientId)) delete this.pending[mid];
    }
    for (const mid of [...this.idOffers]) {
      const mm = all.find((x) => x.id === mid);
      if (!mm || mm.result != null) this.idOffers.delete(mid);
    }
    if (v.phase !== 'lobby') {
      const me = v.players.find((p) => p.id === this.me.clientId);
      if (me?.dropped != null) this.dropped = true;
    }
    if (first && prev?.tid !== v.tid) this.resend();
    this.ev.changed?.();
    this.ev.view?.(v, prev);
  }
}

/** Build a match report from a finished match room (seat 0 = the match's a). */
export function reportFromRoom(room: Room, mid: string, attempt: number): Report | null {
  const m = room.match;
  if (!m) return null;
  const games = m.games
    .filter((g) => g.end && g.decks[0] && g.decks[1] && g.first != null)
    .map((g) => ({ index: g.index, seed: g.seed, first: g.first!, decks: [g.decks[0]!, g.decks[1]!] as [WireDeck, WireDeck], logs: [g.logs[0], g.logs[1]] as Report['games'][0]['logs'], end: g.end! }));
  if (!games.length) return null;
  return { mid, attempt, skipFirstDraw: m.start.skipFirstDraw, games };
}
