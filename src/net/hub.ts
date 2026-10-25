// The listening side of a star: one registered id, many phones. Used by the Friends Locals
// organiser (every player dials the tournament id) and by a player's spectator feed (any number of
// friends dial it to watch).
//
// Each phone connects with an ordinary guest NetSession (session.ts), so the handshake mirrors it:
// both sides send `hello`, the guest's hello is checked by `accept`, and the hub answers pings with
// pongs. A phone is identified by its clientId: a new channel from the same phone (a reconnect or a
// reload) replaces the old one. Channels that stay silent past `timeoutMs` are closed; the phone
// dials again on its own.
//
// DOM-free (timers only), so scripts/tourney-test.ts runs it in Node over the in-memory transport.
import { Reassembler, toFrames } from './frames';
import { parseMsg, type Msg, type NetPlayer } from './protocol';
import { TransportError, type Channel, type Transport } from './transport';

type Hello = Extract<Msg, { t: 'hello' }>;

export interface HubOptions {
  /** Signalling id to register. */
  id: string;
  /** Our hello (role 'host'), built fresh for every channel. */
  hello: () => Hello;
  accept: (h: Hello) => true | 'busy' | 'version';
  heartbeatMs?: number;
  timeoutMs?: number;
  relistenMs?: number;
}

interface Peer {
  ch: Channel;
  player: NetPlayer;
  lastHeard: number;
}

export class NetHub {
  /** A phone's hello was accepted (first time or again after a drop). */
  onConnect: (clientId: string, h: Hello) => void = () => {};
  onMessage: (clientId: string, m: Msg) => void = () => {};
  /** A phone's channel closed (it may come back). */
  onDisconnect: (clientId: string) => void = () => {};
  /** Listening (true) or not registered with the signalling server (false). */
  onListening: (on: boolean) => void = () => {};

  private peers = new Map<string, Peer>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private listening = false;
  private holdUntil = 0;
  readonly heartbeatMs: number;
  readonly timeoutMs: number;

  constructor(
    private transport: Transport,
    private o: HubOptions,
  ) {
    this.heartbeatMs = o.heartbeatMs ?? 2000;
    this.timeoutMs = o.timeoutMs ?? 7000;
  }

  get ids(): string[] {
    return [...this.peers.keys()];
  }

  connected(clientId: string): boolean {
    return !!this.peers.get(clientId)?.ch.open;
  }

  /** Register the id (rejects with a TransportError; retries a while when `retryTaken`, e.g. after a reload). */
  async start(opts: { retryTaken?: boolean } = {}): Promise<void> {
    const until = Date.now() + (opts.retryTaken ? this.o.relistenMs ?? 60000 : 0);
    for (;;) {
      try {
        await this.transport.listen(this.o.id, (ch) => this.adopt(ch));
        break;
      } catch (e) {
        if (this.closed) return;
        if (!(e instanceof TransportError) || e.kind === 'unsupported' || Date.now() > until) throw e;
        await sleep(e.kind === 'id-taken' ? 2500 : 1500);
      }
    }
    this.setListening(true);
    this.timer = setInterval(() => this.tick(), this.heartbeatMs);
  }

  send(clientId: string, m: Msg) {
    const p = this.peers.get(clientId);
    if (p?.ch.open) for (const f of toFrames(JSON.stringify(m))) p.ch.send(f);
  }

  /** Close one phone's channel (it may dial again unless refused). */
  kick(clientId: string, farewell?: Msg) {
    const p = this.peers.get(clientId);
    if (!p) return;
    if (farewell) p.ch.send(JSON.stringify(farewell));
    this.peers.delete(clientId);
    setTimeout(() => p.ch.close(), 300);
    this.onDisconnect(clientId);
  }

  /** Test hook: drop every channel now and refuse new ones for `holdMs`. */
  drop(holdMs = 0) {
    this.holdUntil = Date.now() + holdMs;
    for (const [id, p] of [...this.peers]) {
      this.peers.delete(id);
      p.ch.onClose = () => {};
      p.ch.close();
      this.onDisconnect(id);
    }
  }

  close(farewell?: Msg) {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    const chans = [...this.peers.values()].map((p) => p.ch);
    if (farewell) for (const ch of chans) if (ch.open) ch.send(JSON.stringify(farewell));
    this.peers.clear();
    setTimeout(() => {
      for (const ch of chans) {
        ch.onClose = () => {};
        ch.close();
      }
      this.transport.destroy();
    }, farewell ? 300 : 0);
  }

  /** The app came back to the foreground. */
  wake() {
    this.transport.revive();
    this.tick();
  }

  private setListening(on: boolean) {
    if (this.listening === on) return;
    this.listening = on;
    this.onListening(on);
  }

  private adopt(ch: Channel) {
    if (this.closed || Date.now() < this.holdUntil) {
      ch.close();
      return;
    }
    let who: string | null = null;
    const re = new Reassembler();
    ch.onMessage = (piece) => {
      const raw = re.push(piece);
      if (raw == null) {
        const p = who ? this.peers.get(who) : null;
        if (p && p.ch === ch) p.lastHeard = Date.now();
        return;
      }
      const m = parseMsg(raw);
      if (!m) return;
      if (!who) {
        if (m.t !== 'hello') return;
        const ok = this.o.accept(m);
        if (ok !== true) {
          ch.send(JSON.stringify({ t: 'leave', reason: ok } satisfies Msg));
          setTimeout(() => ch.close(), 300);
          return;
        }
        who = m.player.clientId;
        const old = this.peers.get(who);
        if (old && old.ch !== ch) {
          old.ch.onClose = () => {};
          old.ch.close();
        }
        this.peers.set(who, { ch, player: m.player, lastHeard: Date.now() });
        this.onConnect(who, m);
        return;
      }
      const p = this.peers.get(who);
      if (!p || p.ch !== ch) return;
      p.lastHeard = Date.now();
      if (m.t === 'ping') ch.send(JSON.stringify({ t: 'pong', at: m.at } satisfies Msg));
      else if (m.t === 'pong' || m.t === 'hello') return;
      else this.onMessage(who, m);
    };
    ch.onClose = () => {
      if (!who) return;
      const p = this.peers.get(who);
      if (!p || p.ch !== ch) return;
      this.peers.delete(who);
      if (!this.closed) this.onDisconnect(who);
    };
    ch.send(JSON.stringify(this.o.hello()));
  }

  private tick() {
    if (this.closed) return;
    if (!this.transport.online) {
      this.setListening(false);
      this.transport.revive();
    } else this.setListening(true);
    const now = Date.now();
    for (const [, p] of [...this.peers]) {
      if (now - p.lastHeard > this.timeoutMs) p.ch.close(); // silent for too long: dropped
    }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
