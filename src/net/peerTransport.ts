// Transport over PeerJS (WebRTC data channels, signalling through a PeerJS server).
// peerjs is loaded on demand so it is only downloaded when someone plays a friend.
import type { DataConnection, Peer as PeerT, PeerError } from 'peerjs';
import { TransportError, type Channel, type PeerServerConfig, type Transport, type TransportErrorKind } from './transport';

type PeerCtor = typeof import('peerjs').Peer;
let peerCtor: Promise<PeerCtor> | null = null;
const loadPeer = () => (peerCtor ??= import('peerjs').then((m) => m.Peer));

function kindOf(type: string): TransportErrorKind {
  switch (type) {
    case 'unavailable-id':
      return 'id-taken';
    case 'peer-unavailable':
      return 'no-peer';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
    case 'disconnected':
      return 'server';
    case 'browser-incompatible':
      return 'unsupported';
    default:
      return 'other';
  }
}

/** Wrap a DataConnection. Opens the channel when the data channel opens. */
function wrap(conn: DataConnection): Channel {
  let closed = false;
  const ch: Channel = {
    send(data) {
      if (closed || !conn.open) return;
      try {
        void Promise.resolve(conn.send(data)).catch(() => {});
      } catch {
        /* the channel is going away; the session notices */
      }
    },
    close() {
      if (closed) return;
      try {
        conn.close();
      } catch {
        /* ignore */
      }
      fire();
    },
    get open() {
      return !closed && conn.open;
    },
    onMessage: () => {},
    onClose: () => {},
  };
  const fire = () => {
    if (closed) return;
    closed = true;
    ch.onClose();
  };
  conn.on('data', (d) => {
    if (!closed && typeof d === 'string') ch.onMessage(d);
  });
  conn.on('close', fire);
  conn.on('error', fire);
  // ICE "disconnected"/"failed" do not always close the DataConnection: watch the peer connection.
  const watch = () => {
    const pc = conn.peerConnection;
    if (!pc) return;
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') fire();
    });
  };
  if (conn.peerConnection) watch();
  else conn.on('open', watch);
  return ch;
}

/**
 * STUN finds each phone's public address; the TURN relays carry the duel when two networks can't connect directly
 * (phone data, carrier NAT, strict Wi-Fi, Brave). ICE tries direct paths first, so a relay is only used as a fallback.
 */
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export class PeerTransport implements Transport {
  private peer: PeerT | null = null;
  private destroyed = false;
  /** Rejecters of dials in flight, by target id (peer-unavailable arrives on the Peer). */
  private dials = new Map<string, (e: TransportError) => void>();
  /** Registered under a fixed id (listen): keep that id when reconnecting. */
  private listening = false;

  constructor(private cfg: PeerServerConfig) {}

  get online() {
    return !!this.peer && this.peer.open && !this.peer.disconnected;
  }

  /** Create the Peer under `id` (random when undefined) and wait until the server accepts it. */
  private async open(id?: string): Promise<PeerT> {
    if (typeof RTCPeerConnection === 'undefined') throw new TransportError('unsupported', 'This browser cannot make direct connections (WebRTC).');
    const Peer = await loadPeer();
    if (this.destroyed) throw new TransportError('other', 'closed');
    const opts = { host: this.cfg.host, port: this.cfg.port, path: this.cfg.path, secure: this.cfg.secure, debug: 0, config: { iceServers: ICE_SERVERS } };
    const peer = id ? new Peer(id, opts) : new Peer(opts);
    this.peer = peer;
    peer.on('error', (err: PeerError<string>) => {
      const kind = kindOf(err.type);
      if (kind === 'no-peer') {
        for (const [target, rej] of this.dials) {
          if (!err.message || err.message.includes(target)) {
            this.dials.delete(target);
            rej(new TransportError('no-peer', 'No room with that code is open right now.'));
          }
        }
      }
    });
    peer.on('disconnected', () => {
      // lost the signalling server (the phone slept, wifi changed): come back when possible
      if (!this.destroyed) setTimeout(() => this.revive(), 1500);
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new TransportError('server', 'The connection service did not answer.')), 15000);
      peer.once('open', () => {
        clearTimeout(t);
        resolve();
      });
      peer.once('error', (err: PeerError<string>) => {
        clearTimeout(t);
        reject(new TransportError(kindOf(err.type), err.message || err.type));
      });
    }).catch((e) => {
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
      if (this.peer === peer) this.peer = null;
      throw e;
    });
    return peer;
  }

  async listen(id: string, onChannel: (ch: Channel) => void): Promise<void> {
    this.peer?.destroy();
    this.listening = true;
    const peer = await this.open(id);
    peer.on('connection', (conn: DataConnection) => {
      const ch = wrap(conn);
      conn.on('open', () => onChannel(ch));
    });
  }

  async dial(id: string, timeoutMs = 20000): Promise<Channel> {
    let peer = this.peer;
    if (!peer || peer.destroyed) peer = await this.open();
    else if (peer.disconnected) {
      this.revive();
      await new Promise((r) => setTimeout(r, 800));
      // a dialling phone needs no fixed id: if the server will not take the old one back, start afresh
      if (peer.disconnected && !this.listening) {
        try {
          peer.destroy();
        } catch {
          /* ignore */
        }
        peer = await this.open();
      }
    }
    return new Promise<Channel>((resolve, reject) => {
      const conn = peer!.connect(id, { reliable: true, serialization: 'json' });
      const done = (e?: TransportError) => {
        clearTimeout(t);
        // only our own entry: a second dial of the same id may have replaced it
        if (this.dials.get(id) === fail) this.dials.delete(id);
        if (e) {
          try {
            conn.close();
          } catch {
            /* ignore */
          }
          reject(e);
        }
      };
      const t = setTimeout(() => done(new TransportError('timeout', 'Could not reach your friend’s phone.')), timeoutMs);
      const fail = (e: TransportError) => done(e);
      this.dials.set(id, fail);
      const ch = wrap(conn);
      conn.on('open', () => {
        done();
        resolve(ch);
      });
    });
  }

  revive() {
    const p = this.peer;
    if (this.destroyed || !p || p.destroyed || !p.disconnected) return;
    try {
      p.reconnect();
    } catch {
      /* try again on the next revive */
    }
  }

  destroy() {
    this.destroyed = true;
    for (const rej of this.dials.values()) rej(new TransportError('other', 'closed'));
    this.dials.clear();
    try {
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.peer = null;
  }
}
