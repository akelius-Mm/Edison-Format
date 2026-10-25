// One logical connection between the two phones of a room, kept alive across dropped channels.
//
// The host registers the room id and accepts channels; the guest dials it. Every new channel
// starts with both sides sending `hello`; the channel becomes the active one once the other side's
// hello is accepted (right protocol and build, the same friend). Heartbeats detect channels that
// died silently (a sleeping phone, a changed network): no message for `timeoutMs` closes the
// channel, and the guest dials again with backoff until it gets through. The host keeps listening
// and swaps in the new channel. Nothing here knows about games; room.ts re-syncs state on every
// (re)connection through `onConnect`.
//
// DOM-free (timers only), so scripts/net-test.ts runs it in Node over the in-memory transport.
import { parseMsg, type Msg } from './protocol';
import { TransportError, type Channel, type Transport } from './transport';

export type NetStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';
type Hello = Extract<Msg, { t: 'hello' }>;

export interface SessionOptions {
  role: 'host' | 'guest';
  /** Signalling id of the room (the host registers it). */
  roomId: string;
  /** Our hello, built fresh for every channel. */
  hello: () => Hello;
  /** Accept the other side's hello, or return the reason to refuse it. */
  accept: (h: Hello) => true | 'busy' | 'version';
  heartbeatMs?: number;
  timeoutMs?: number;
  /** Give up re-registering a room id held by our own previous session after this long. */
  relistenMs?: number;
}

export class NetSession {
  status: NetStatus = 'idle';
  onStatus: (s: NetStatus) => void = () => {};
  /** Every message on the active channel except hello / ping / pong. */
  onMessage: (m: Msg) => void = () => {};
  /** The other side's hello was accepted on a new channel. */
  onConnect: (h: Hello) => void = () => {};
  /** The other side refused us (or we refused them). */
  onRefused: (reason: 'busy' | 'version', h?: Hello) => void = () => {};
  /** A failure that ends the session (e.g. the room id is taken by someone else). */
  onFatal: (e: TransportError) => void = () => {};

  private active: Channel | null = null;
  private lastHeard = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private dialing = false;
  private closed = false;
  /** Test hook: refuse to reconnect until this time. */
  private holdUntil = 0;
  readonly heartbeatMs: number;
  readonly timeoutMs: number;

  constructor(
    private transport: Transport,
    private o: SessionOptions,
  ) {
    this.heartbeatMs = o.heartbeatMs ?? 2000;
    this.timeoutMs = o.timeoutMs ?? 7000;
  }

  get connected() {
    return this.status === 'connected';
  }

  private set(s: NetStatus) {
    if (this.status === s || this.closed) return;
    this.status = s;
    this.onStatus(s);
  }

  /**
   * Host: register the room id (rejects with TransportError 'id-taken' when someone else holds it).
   * Guest: dial the room (rejects when it can't be reached). Later drops are handled internally.
   */
  async start(opts: { retryTaken?: boolean } = {}): Promise<void> {
    this.set('connecting');
    if (this.o.role === 'host') {
      const until = Date.now() + (opts.retryTaken ? this.o.relistenMs ?? 60000 : 0);
      for (;;) {
        try {
          await this.transport.listen(this.o.roomId, (ch) => this.adopt(ch));
          break;
        } catch (e) {
          // a reload: the server may still hold our previous registration for a little while
          if (this.closed) return;
          if (!(e instanceof TransportError) || e.kind === 'unsupported' || Date.now() > until) throw e;
          await sleep(e.kind === 'id-taken' ? 2500 : 1500);
        }
      }
      this.set('reconnecting'); // listening, waiting for the guest
    } else {
      const ch = await this.transport.dial(this.o.roomId);
      this.adopt(ch);
    }
    this.timer = setInterval(() => this.tick(), this.heartbeatMs);
  }

  send(m: Msg) {
    if (this.active?.open) this.active.send(JSON.stringify(m));
  }

  /** Test hook: drop the channel now and stay offline for `holdMs`. */
  drop(holdMs = 0) {
    this.holdUntil = Date.now() + holdMs;
    this.active?.close();
  }

  close(farewell?: Msg) {
    if (this.closed) return;
    if (farewell) this.send(farewell);
    const ch = this.active;
    this.set('closed');
    this.closed = true;
    this.active = null;
    if (this.timer) clearInterval(this.timer);
    // give the farewell a moment to leave
    setTimeout(() => {
      ch?.close();
      this.transport.destroy();
    }, farewell ? 300 : 0);
  }

  /** A new channel (incoming for the host, dialled for the guest): handshake, then make it active. */
  private adopt(ch: Channel) {
    if (this.closed || Date.now() < this.holdUntil) {
      ch.close();
      return;
    }
    let accepted = false;
    ch.onMessage = (raw) => {
      const m = parseMsg(raw);
      if (!m) return;
      if (!accepted) {
        if (m.t === 'leave') {
          if (m.reason === 'busy' || m.reason === 'version') this.onRefused(m.reason);
          ch.close();
          return;
        }
        if (m.t !== 'hello') return;
        const ok = this.o.accept(m);
        if (ok !== true) {
          ch.send(JSON.stringify({ t: 'leave', reason: ok } satisfies Msg));
          this.onRefused(ok, m);
          setTimeout(() => ch.close(), 300);
          return;
        }
        accepted = true;
        const old = this.active;
        this.active = ch;
        if (old && old !== ch) {
          old.onClose = () => {};
          old.close();
        }
        this.lastHeard = Date.now();
        this.set('connected');
        this.onConnect(m);
        return;
      }
      if (this.active !== ch) return;
      this.lastHeard = Date.now();
      if (m.t === 'ping') ch.send(JSON.stringify({ t: 'pong', at: m.at } satisfies Msg));
      else if (m.t === 'pong' || m.t === 'hello') return;
      else this.onMessage(m);
    };
    ch.onClose = () => {
      if (this.active !== ch) return;
      this.active = null;
      if (this.closed) return;
      this.set('reconnecting');
      if (this.o.role === 'guest') void this.redial();
      else this.transport.revive();
    };
    ch.send(JSON.stringify(this.o.hello()));
  }

  private async redial() {
    if (this.dialing || this.closed) return;
    this.dialing = true;
    let wait = 500;
    try {
      while (!this.closed && !this.active) {
        const hold = this.holdUntil - Date.now();
        if (hold > 0) await sleep(hold);
        if (this.closed || this.active) break;
        try {
          const ch = await this.transport.dial(this.o.roomId, 12000);
          if (this.closed) {
            ch.close();
            break;
          }
          this.adopt(ch);
          // wait for the handshake (or the channel to fail) before trying again
          const t0 = Date.now();
          while (!this.closed && !this.active && ch.open && Date.now() - t0 < 8000) await sleep(100);
          if (this.active) break;
          ch.close();
        } catch {
          /* the host may be reloading or offline: keep trying */
        }
        await sleep(wait);
        wait = Math.min(5000, wait * 1.6);
      }
    } finally {
      this.dialing = false;
    }
  }

  private tick() {
    if (this.closed) return;
    const ch = this.active;
    if (!ch) {
      if (this.o.role === 'guest') void this.redial();
      else this.transport.revive();
      return;
    }
    if (Date.now() - this.lastHeard > this.timeoutMs) {
      ch.close(); // silent for too long: treat as dropped
      return;
    }
    ch.send(JSON.stringify({ t: 'ping', at: Date.now() } satisfies Msg));
  }

  /** The app came back to the foreground: check the connection straight away. */
  wake() {
    this.transport.revive();
    this.tick();
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
