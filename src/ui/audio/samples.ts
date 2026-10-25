// Recorded audio files (public/audio/): fetched once, decoded with Web Audio and kept as AudioBuffers.
// An AudioBuffer is not tied to the context that decoded it, so the same buffers play in the live
// context and in offline (test) contexts.
import { audioContext } from './core';

/** Every sound-effect sample in public/audio/sfx/ (each exists as .m4a and .ogg). */
export const SFX_SAMPLES = [
  'card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-4', 'card-slide-5',
  'card-place-1', 'card-place-2', 'card-place-3', 'card-place-4',
  'card-flip-1', 'card-flip-2', 'card-shuffle',
  'coin-flick', 'coin-land-1', 'coin-land-2',
  'punch-1', 'punch-2', 'punch-3', 'thud-1', 'thud-2', 'clang-1', 'clang-2',
  'shatter-1', 'shatter-2', 'shatter-3', 'shards',
  'boom', 'crunch-1', 'crunch-2', 'energy-1', 'energy-2', 'barrier', 'swoosh',
  'woosh-1', 'woosh-2', 'woosh-3', 'woosh-4', 'shing-1', 'shing-2', 'shing-3',
  'chime-1', 'chime-2', 'sparkle', 'shimmer', 'select-1', 'select-2', 'switch-1', 'switch-2',
  'click-1', 'click-2', 'error', 'tick-1', 'tick-2', 'sax-turn', 'sax-win', 'sax-lose',
] as const;
export type SampleName = (typeof SFX_SAMPLES)[number];

/** Built-in music loops (public/audio/music/*.m4a). Loop points are in seconds of the decoded file. */
export const MUSIC_LOOPS = {
  menu: { file: 'music/menu.m4a', loopStart: 0.5, loopEnd: 94.158458, bpm: 82 },
  duel: { file: 'music/duel.m4a', loopStart: 0.5, loopEnd: 85.743719, bpm: 90.1 },
  pinch: { file: 'music/pinch.m4a', loopStart: 0.5, loopEnd: 78.406281, bpm: 98.58 },
} as const;
export type MusicSlot = keyof typeof MUSIC_LOOPS;

const base = (): string => {
  try {
    return (import.meta as any).env?.BASE_URL ?? './';
  } catch {
    return './';
  }
};
export const audioUrl = (path: string) => `${base()}audio/${path}`;

let aacOk: boolean | null = null;
/** AAC in MP4 (every iPhone, Chrome, Safari, Edge) with an Ogg Vorbis fallback for the rest. */
function sfxExt(): 'm4a' | 'ogg' {
  if (aacOk === null) {
    try {
      const a = document.createElement('audio');
      aacOk = !!a.canPlayType?.('audio/mp4; codecs="mp4a.40.2"') || !a.canPlayType?.('audio/ogg; codecs="vorbis"');
    } catch {
      aacOk = true;
    }
  }
  return aacOk ? 'm4a' : 'ogg';
}

// ---------------------------------------------------------------- decoding
let decoder: BaseAudioContext | null = null;
/** The live context when it exists, otherwise a tiny offline one (decoding needs no user gesture). */
function decodeContext(): BaseAudioContext | null {
  const live = audioContext();
  if (live) return live;
  if (decoder) return decoder;
  try {
    const OAC = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    decoder = new OAC(2, 1, 48000) as OfflineAudioContext;
    return decoder;
  } catch {
    return null;
  }
}

/** decodeAudioData with the callback form too (older Safari has no promise version). */
export function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const ac = decodeContext();
  if (!ac) return Promise.reject(new Error('Web Audio unavailable'));
  return new Promise<AudioBuffer>((resolve, reject) => {
    let settled = false;
    const ok = (b: AudioBuffer) => {
      if (!settled) (settled = true), resolve(b);
    };
    const bad = (e: unknown) => {
      if (!settled) (settled = true), reject(e instanceof Error ? e : new Error('Could not decode audio'));
    };
    try {
      const p = ac.decodeAudioData(data, ok, bad) as Promise<AudioBuffer> | undefined;
      p?.then(ok, bad);
    } catch (e) {
      bad(e);
    }
  });
}

async function fetchDecode(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return decodeAudio(await res.arrayBuffer());
}

// ---------------------------------------------------------------- sound-effect bank
const sfx = new Map<SampleName, AudioBuffer>();
const failed = new Set<string>();
let sfxLoad: Promise<void> | null = null;

/** Start loading every sound-effect sample (once). Resolves when all have loaded or failed. */
export function loadSfxSamples(): Promise<void> {
  if (sfxLoad) return sfxLoad;
  if (typeof window === 'undefined' || typeof fetch === 'undefined') return (sfxLoad = Promise.resolve());
  const ext = sfxExt();
  sfxLoad = Promise.all(
    SFX_SAMPLES.map(async (n) => {
      try {
        sfx.set(n, await fetchDecode(audioUrl(`sfx/${n}.${ext}`)));
      } catch {
        // one more try with the other format before giving up (the synthesized sound is used then)
        try {
          sfx.set(n, await fetchDecode(audioUrl(`sfx/${n}.${ext === 'm4a' ? 'ogg' : 'm4a'}`)));
        } catch {
          failed.add(n);
        }
      }
    }),
  ).then(() => undefined);
  return sfxLoad;
}

export const sample = (n: SampleName): AudioBuffer | undefined => sfx.get(n);

/** For tests and diagnostics. */
export function sampleStatus() {
  return { loaded: sfx.size, failed: [...failed], total: SFX_SAMPLES.length };
}

// ---------------------------------------------------------------- music loops
const music = new Map<MusicSlot, Promise<AudioBuffer>>();

/** Fetch and decode a built-in music loop (cached until `dropMusicLoop`). */
export function loadMusicLoop(slot: MusicSlot): Promise<AudioBuffer> {
  let p = music.get(slot);
  if (!p) {
    p = fetchDecode(audioUrl(MUSIC_LOOPS[slot].file));
    music.set(slot, p);
    p.catch(() => music.delete(slot));
  }
  return p;
}

/** Forget a decoded loop to free memory (about 35 MB each); it is fetched from cache again when needed. */
export function dropMusicLoop(slot: MusicSlot) {
  music.delete(slot);
}
