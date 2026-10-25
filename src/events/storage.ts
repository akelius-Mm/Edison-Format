// Versioned localStorage helpers for the Events / Circuit / Ratings modules. Headless-safe: with
// no localStorage (node tests without a shim) reads return the fallback and writes are dropped.

export const KEYS = {
  ratings: 'edison.ratings.v1',
  activeEvent: 'edison.events.active.v1',
  eventHistory: 'edison.events.history.v1',
  eventForm: 'edison.events.form.v1',
  season: 'edison.circuit.season.v1',
  seasonArchive: 'edison.circuit.archive.v1',
} as const;

export function load<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, v: unknown) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or unavailable: play continues */
  }
}

export function remove(key: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
