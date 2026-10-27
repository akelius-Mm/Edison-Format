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
  'click-1', 'click-2', 'error', 'tick-1', 'tick-2', 'vibe-turn', 'vibe-win', 'vibe-lose',
] as const;
export type SampleName = (typeof SFX_SAMPLES)[number];

export type MusicSlot = 'menu' | 'duel' | 'pinch';
export const MUSIC_SLOTS: MusicSlot[] = ['menu', 'duel', 'pinch'];

export interface MusicTrack {
  id: string;
  slot: MusicSlot;
  title: string;
  artist: string;
  file: string;
  /** Loop points in seconds of the decoded file: a bar-aligned section that loops seamlessly. */
  loopStart: number;
  loopEnd: number;
  bpm: number;
}

/**
 * The built-in playlists (public/audio/music/*.m4a, credits in credits.ts). Each file is a
 * 24-32 bar section of the original with a seamless loop point; the player plays it twice
 * through (about three minutes) and then crossfades to the next track of the slot.
 */
export const MUSIC_TRACKS: MusicTrack[] = [
  { id: 'first-snow', slot: 'menu', title: 'First Snow', artist: 'HoliznaCC0', file: 'music/first-snow.m4a', loopStart: 0.5, loopEnd: 94.158458, bpm: 82 },
  { id: 'snow-drift', slot: 'menu', title: 'Snow Drift', artist: 'HoliznaCC0', file: 'music/snow-drift.m4a', loopStart: 0.5, loopEnd: 90.852902, bpm: 85 },
  { id: 'two-hour-delay', slot: 'menu', title: '2 Hour Delay', artist: 'HoliznaCC0', file: 'music/two-hour-delay.m4a', loopStart: 0.5, loopEnd: 96.499955, bpm: 80 },
  { id: 'chill-lofi', slot: 'menu', title: 'Chill Lofi Inspired', artist: 'omfgdude', file: 'music/chill-lofi.m4a', loopStart: 0.5, loopEnd: 73.418277, bpm: 79 },
  { id: 'funky-lofi-jam', slot: 'duel', title: 'Funky Hip Hop Lofi Jam', artist: 'omfgdude', file: 'music/funky-lofi-jam.m4a', loopStart: 0.5, loopEnd: 85.743719, bpm: 90.1 },
  { id: 'winter-blues', slot: 'duel', title: 'Winter Blues', artist: 'HoliznaCC0', file: 'music/winter-blues.m4a', loopStart: 0.5, loopEnd: 91.066077, bpm: 84.8 },
  { id: 'lofi-hip-hop', slot: 'duel', title: 'Lofi Hip Hop', artist: 'omfgdude', file: 'music/lofi-hip-hop.m4a', loopStart: 0.5, loopEnd: 91.060181, bpm: 84.8 },
  { id: 'autumn', slot: 'duel', title: 'Autumn', artist: 'HoliznaCC0', file: 'music/autumn.m4a', loopStart: 0.5, loopEnd: 84.099456, bpm: 91.9 },
  { id: 'fire-place', slot: 'pinch', title: 'Fire Place', artist: 'HoliznaCC0', file: 'music/fire-place.m4a', loopStart: 0.5, loopEnd: 78.406281, bpm: 98.6 },
  { id: 'a-little-shade', slot: 'pinch', title: 'A Little Shade', artist: 'HoliznaCC0', file: 'music/a-little-shade.m4a', loopStart: 0.5, loopEnd: 84.747234, bpm: 91.2 },
];
export const trackById = (id: string) => MUSIC_TRACKS.find((t) => t.id === id);

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

// Music is decoded at a lower rate: a decoded track is raw float samples, about 35 MB per track at
// 48 kHz, and a duel keeps two or three of them. iPhone Safari kills a tab that holds too much memory
// ("A problem repeatedly occurred"), so tracks are kept at 22.05 kHz (about 16 MB each), which is
// plenty for lo-fi loops. The live context resamples them as they play.
const MUSIC_RATE = 22050;
let musicDecoder: BaseAudioContext | null | undefined;
function musicDecodeContext(): BaseAudioContext | null {
  if (musicDecoder !== undefined) return musicDecoder ?? decodeContext();
  try {
    const OAC = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    musicDecoder = new OAC(2, 1, MUSIC_RATE) as OfflineAudioContext;
  } catch {
    musicDecoder = null;
  }
  return musicDecoder ?? decodeContext();
}

/** decodeAudioData with the callback form too (older Safari has no promise version). */
export function decodeAudio(data: ArrayBuffer, opts: { music?: boolean } = {}): Promise<AudioBuffer> {
  const ac = opts.music ? musicDecodeContext() : decodeContext();
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

async function fetchDecode(url: string, opts: { music?: boolean } = {}): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return decodeAudio(await res.arrayBuffer(), opts);
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

// ---------------------------------------------------------------- music tracks
const music = new Map<string, Promise<AudioBuffer>>();

/** Fetch and decode a built-in track (kept until `dropMusicTrack`; the service worker caches the file). */
export function loadMusicTrack(id: string): Promise<AudioBuffer> {
  let p = music.get(id);
  if (!p) {
    const t = trackById(id);
    p = t ? fetchDecode(audioUrl(t.file), { music: true }) : Promise.reject(new Error(`No track ${id}`));
    music.set(id, p);
    p.catch(() => music.delete(id));
  }
  return p;
}

/** Forget a decoded track to free memory (about 16 MB each). */
export function dropMusicTrack(id: string) {
  music.delete(id);
}
