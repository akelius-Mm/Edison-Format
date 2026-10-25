// In-process Transport for tests (scripts/net-test.ts): channels are pairs of queues that deliver
// asynchronously and in order, like a reliable data channel. `MemoryHub.cut()` drops every open
// channel to simulate a network failure.
import { TransportError, type Channel, type Transport } from './transport';

export class MemoryHub {
  listeners = new Map<string, (ch: Channel) => void>();
  private open = new Set<Channel>();
  /** While true, dials fail (the network is down). */
  down = false;
  /** Messages delivered (for test statistics). */
  delivered = 0;

  pair(): [Channel, Channel] {
    const mk = (): Channel & { peer?: Channel & { deliver(d: string): void }; deliver(d: string): void; closed: boolean } => {
      const ch = {
        closed: false,
        peer: undefined as any,
        get open() {
          return !ch.closed;
        },
        send(data: string) {
          if (ch.closed) return;
          const p = ch.peer!;
          setTimeout(() => {
            if (!ch.closed && !p.closed) {
              hub.delivered++;
              p.onMessage(data);
            }
          }, 0);
        },
        close() {
          if (ch.closed) return;
          ch.closed = true;
          hub.open.delete(ch);
          setTimeout(() => ch.onClose(), 0);
          ch.peer?.close();
        },
        deliver(d: string) {
          ch.onMessage(d);
        },
        onMessage: (_: string) => {},
        onClose: () => {},
      };
      return ch;
    };
    const hub = this;
    const a = mk();
    const b = mk();
    a.peer = b as any;
    b.peer = a as any;
    this.open.add(a);
    this.open.add(b);
    return [a, b];
  }

  /** Drop every open channel. */
  cut() {
    for (const ch of [...this.open]) ch.close();
  }
}

export class MemoryTransport implements Transport {
  private ids: string[] = [];
  online = true;
  constructor(private hub: MemoryHub) {}

  async listen(id: string, onChannel: (ch: Channel) => void) {
    if (this.hub.listeners.has(id)) throw new TransportError('id-taken', 'id taken');
    this.hub.listeners.set(id, onChannel);
    this.ids.push(id);
  }

  async dial(id: string): Promise<Channel> {
    await new Promise((r) => setTimeout(r, 1));
    if (this.hub.down) throw new TransportError('timeout', 'network down');
    const l = this.hub.listeners.get(id);
    if (!l) throw new TransportError('no-peer', 'no such room');
    const [mine, theirs] = this.hub.pair();
    setTimeout(() => l(theirs), 0);
    return mine;
  }

  revive() {}

  destroy() {
    for (const id of this.ids) this.hub.listeners.delete(id);
    this.ids = [];
  }
}
