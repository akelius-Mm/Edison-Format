// The connection between two phones, kept behind a small interface so the signalling service can
// be swapped (PeerJS cloud today; a self-hosted PeerJS server, or something else, later).
//
// A Transport only has to do two things: register under a well-known id and accept channels
// (`listen`, the host), and open a channel to such an id (`dial`, the guest). A Channel is a
// reliable, ordered, bidirectional pipe for strings. Everything above it (heartbeats,
// reconnecting, re-syncing) lives in session.ts and room.ts and does not depend on PeerJS.

export interface Channel {
  send(data: string): void;
  close(): void;
  readonly open: boolean;
  onMessage: (data: string) => void;
  /** Fired once when the channel closes for any reason (either side, or the network). */
  onClose: () => void;
}

export type TransportErrorKind =
  /** Another device holds the room id (or our previous session has not timed out yet). */
  | 'id-taken'
  /** Nobody is registered under the id we dialled. */
  | 'no-peer'
  /** The signalling server could not be reached. */
  | 'server'
  /** The direct connection could not be set up in time. */
  | 'timeout'
  /** WebRTC is not available in this browser. */
  | 'unsupported'
  | 'other';

export class TransportError extends Error {
  constructor(
    public kind: TransportErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface Transport {
  /** Register as `id` and hand every incoming channel to `onChannel`. Rejects with a TransportError. */
  listen(id: string, onChannel: (ch: Channel) => void): Promise<void>;
  /** Open a channel to the peer registered as `id`. Rejects with a TransportError. */
  dial(id: string, timeoutMs?: number): Promise<Channel>;
  /** The connection to the signalling server dropped (e.g. the phone slept): try to get it back. */
  revive(): void;
  /** True while registered with the signalling server (needed to accept new channels). */
  readonly online: boolean;
  destroy(): void;
}

// ------------------------------------------------------------------ server configuration

/** Where the PeerJS signalling server lives. Empty host = the free PeerJS cloud server. */
export interface PeerServerConfig {
  host: string;
  port: number;
  path: string;
  secure: boolean;
}

export const CLOUD_SERVER: PeerServerConfig = { host: '0.peerjs.com', port: 443, path: '/', secure: true };

/**
 * Parse "host[:port][/path]" with an optional scheme: "https://peer.example.com/edison",
 * "localhost:9000/edison", "ws://127.0.0.1:9000". No scheme: secure unless the host is local.
 * Empty or "cloud" = the PeerJS cloud server. Null when it can't be parsed.
 */
export function parseServer(text: string | null | undefined): PeerServerConfig | null {
  const s = (text ?? '').trim();
  if (!s || s.toLowerCase() === 'cloud') return { ...CLOUD_SERVER };
  const m = s.match(/^(?:(https?|wss?):\/\/)?([^/:\s]+)(?::(\d+))?(\/[^\s]*)?$/i);
  if (!m) return null;
  const host = m[2];
  const local = /^(localhost|127\.|10\.|192\.168\.|\[?::1)/.test(host) || host.endsWith('.local');
  const secure = m[1] ? /^(https|wss)$/i.test(m[1]) : !local;
  const port = m[3] ? Number(m[3]) : secure ? 443 : 80;
  return { host, port, path: m[4] || '/', secure };
}

export function describeServer(c: PeerServerConfig): string {
  if (c.host === CLOUD_SERVER.host) return 'PeerJS cloud';
  return `${c.secure ? 'https' : 'http'}://${c.host}${(c.secure && c.port === 443) || (!c.secure && c.port === 80) ? '' : `:${c.port}`}${c.path === '/' ? '' : c.path}`;
}
