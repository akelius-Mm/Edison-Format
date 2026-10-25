// Which boosters a draft can use: the "Edison Pack" (a 15-card pack built from the whole
// Edison pool) or real core boosters that were on shelves in spring 2010.
import { playableSet } from '../collection/catalog';
import { PACK_FORMATS } from '../collection/packs';

/** Plan entry for the simulator's own 15-card pack. */
export const EDISON_PACK = 'EDISON';
export const EDISON_PACK_SIZE = 15;

/**
 * Real boosters offered in Draft: the three core sets on shelves for Edison locals (spring 2010).
 * The Shining Darkness was not Edison-legal; Hidden Arsenal used special 5-card packs.
 */
export const REAL_SETS = ['ABPF', 'SOVR', 'ANPR'] as const;

/** A real set is offered once this share of its printed cards is playable. */
export const DRAFT_READY_SHARE = 0.85;

export interface PackOption {
  code: string;
  name: string;
  /** Short label ("Edison", "ABPF"). */
  short: string;
  cardsPerPack: number;
  /** Real sets: implemented / printed cards. */
  playable: number;
  printed: number;
  released?: string;
  /** Can be drafted now (complete enough, or forced by the dev override). */
  ready: boolean;
}

export function packOption(code: string, devAll = false): PackOption {
  if (code === EDISON_PACK)
    return { code, name: 'Edison Pack', short: 'Edison', cardsPerPack: EDISON_PACK_SIZE, playable: 1, printed: 1, ready: true };
  const s = playableSet(code);
  if (!s) return { code, name: code, short: code, cardsPerPack: 9, playable: 0, printed: 1, ready: false };
  const playable = s.playable.length;
  const printed = Math.max(1, s.printed);
  return {
    code,
    name: s.data.name,
    short: code,
    cardsPerPack: PACK_FORMATS[s.data.format].cardsPerPack,
    playable,
    printed,
    released: s.data.released,
    ready: (devAll && playable > 0) || playable / printed >= DRAFT_READY_SHARE,
  };
}

/** Edison Pack first, then the real sets in release order (newest first). */
export function packOptions(devAll = false): PackOption[] {
  return [packOption(EDISON_PACK), ...REAL_SETS.map((c) => packOption(c, devAll))];
}

export const packSize = (code: string) => (code === EDISON_PACK ? EDISON_PACK_SIZE : packOption(code).cardsPerPack);
export const isRealPack = (code: string) => code !== EDISON_PACK;
export const planCards = (plan: string[]) => plan.reduce((a, c) => a + packSize(c), 0);

export type PresetId = 'edison' | 'abpf' | 'core3';
export const PRESETS: { id: PresetId; label: string; sets: string[] }[] = [
  { id: 'edison', label: 'Edison Pack', sets: [EDISON_PACK] },
  { id: 'abpf', label: 'All ABPF', sets: ['ABPF'] },
  { id: 'core3', label: 'ABPF · SOVR · ANPR', sets: ['ABPF', 'SOVR', 'ANPR'] },
];

/** Pack counts on offer. 9-card boosters need more packs to reach a 40-card deck. */
export function countOptions(mode: 'draft' | 'sealed', anyReal: boolean): number[] {
  if (mode === 'sealed') return anyReal ? [6, 7, 8] : [6];
  return anyReal ? [5, 6] : [3, 4];
}
export function defaultCount(mode: 'draft' | 'sealed', anyReal: boolean): number {
  if (mode === 'sealed') return anyReal ? 8 : 6;
  return anyReal ? 5 : 4;
}

/** Spread a preset's sets over `count` packs, newest set first (ABPF ×2, SOVR ×2, ANPR …). */
export function presetPlan(id: PresetId, count: number): string[] {
  const sets = PRESETS.find((p) => p.id === id)!.sets;
  const out: string[] = [];
  const per = Math.floor(count / sets.length);
  let extra = count - per * sets.length;
  for (const s of sets) {
    const n = per + (extra-- > 0 ? 1 : 0);
    for (let i = 0; i < n; i++) out.push(s);
  }
  return out;
}

export function presetOf(plan: string[]): PresetId | null {
  for (const p of PRESETS) {
    const want = presetPlan(p.id, plan.length);
    if (want.every((c, i) => c === plan[i])) return p.id;
  }
  return null;
}

/** Resize a plan, repeating its last pack when it grows. */
export function resizePlan(plan: string[], count: number): string[] {
  const out = plan.slice(0, count);
  while (out.length < count) out.push(out[out.length - 1] ?? EDISON_PACK);
  return out;
}

/** "Edison Pack", "ABPF ×5", "ABPF · SOVR · ANPR". */
export function planLabel(plan: string[]): string {
  const uniq = [...new Set(plan)];
  if (uniq.length === 1) return uniq[0] === EDISON_PACK ? 'Edison Pack' : `${uniq[0]} ×${plan.length}`;
  return uniq.map((c) => (c === EDISON_PACK ? 'Edison' : c)).join(' · ');
}

/** Minimum cards an event must hand each player so a 40-card deck is possible. */
export const MIN_EVENT_CARDS = { draft: 45, sealed: 54 } as const;
