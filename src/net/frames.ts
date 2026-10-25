// Large messages over a data channel. WebRTC data channels (and PeerJS's JSON mode) fail on big
// messages (Safari and Chrome differ; a match report with full decision logs can be 50–100 kB), and
// a failed send can take the whole channel down. Anything longer than FRAME_CHARS is cut into
// numbered pieces `{t:'~', id, i, n, d}` and joined again on the other side before parsing.
// Small messages (almost all of them) go out unchanged.
const FRAME_CHARS = 8000;
let seq = 0;

/** The strings to send for one message. */
export function toFrames(raw: string): string[] {
  if (raw.length <= FRAME_CHARS) return [raw];
  const id = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  const n = Math.ceil(raw.length / FRAME_CHARS);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(JSON.stringify({ t: '~', id, i, n, d: raw.slice(i * FRAME_CHARS, (i + 1) * FRAME_CHARS) }));
  return out;
}

/** Joins pieces back together (one per channel): returns the whole message, or null while incomplete. */
export class Reassembler {
  private parts = new Map<string, { n: number; got: number; d: string[] }>();

  /** `raw` as received; returns the complete message text, or null (a piece we keep). */
  push(raw: string): string | null {
    if (raw.length < 8 || !raw.startsWith('{"t":"~"')) return raw;
    let f: { id: string; i: number; n: number; d: string };
    try {
      f = JSON.parse(raw);
    } catch {
      return null;
    }
    let p = this.parts.get(f.id);
    if (!p) {
      p = { n: f.n, got: 0, d: [] };
      this.parts.set(f.id, p);
      // a channel never has many messages in flight: drop stale halves
      if (this.parts.size > 32) this.parts.delete(this.parts.keys().next().value!);
    }
    if (p.d[f.i] == null) {
      p.d[f.i] = f.d;
      p.got++;
    }
    if (p.got < p.n) return null;
    this.parts.delete(f.id);
    return p.d.join('');
  }
}
