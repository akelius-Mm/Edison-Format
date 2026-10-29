// Back up and restore the player's progress as one JSON file (Settings → Data). Everything the app saves
// lives in localStorage under "edison." keys, which the browser can clear (iOS Safari drops a site's
// storage after about 7 days without a visit unless it is on the Home Screen), so this is the way to
// keep decks and the collection safe, or move them to another phone.
//
// "Your music" is not included: those audio files live in IndexedDB and can be tens of MB.

export const BACKUP_APP = 'edison-format';
export const BACKUP_VERSION = 1;
const PREFIX = 'edison.';

/** Per-device or diagnostic keys that must not travel to another device or overwrite this one's. */
const DEVICE_KEYS = new Set([
  'edison.clientId', // online identity: two phones with the same id would look like one player
  'edison.boot.v1', // crash guard state
  'edison.crashguard.v1',
  'edison.duel.restoring.v1',
  'edison.errors.v1', // error log for "Report a problem"
  'edison.updateTried',
]);

export interface Backup {
  app: typeof BACKUP_APP;
  version: number;
  build: string;
  createdAt: string;
  data: Record<string, string>;
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

function isProgressKey(k: string | null): k is string {
  return !!k && k.startsWith(PREFIX) && !DEVICE_KEYS.has(k);
}

function progressKeys(store: Store): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (isProgressKey(k)) keys.push(k);
  }
  return keys.sort();
}

export function createBackup(store: Store, build: string, now = new Date()): Backup {
  const data: Record<string, string> = {};
  for (const k of progressKeys(store)) {
    const v = store.getItem(k);
    if (v !== null) data[k] = v;
  }
  return { app: BACKUP_APP, version: BACKUP_VERSION, build, createdAt: now.toISOString(), data };
}

export function backupFileName(b: Backup) {
  return `edison-backup-${b.createdAt.slice(0, 10)}.json`;
}

/** Reads a backup file's text. Throws an Error with a message fit to show the player. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This isn’t an Edison backup file.');
  }
  const b = raw as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.app !== BACKUP_APP || !b.data || typeof b.data !== 'object') {
    throw new Error('This isn’t an Edison backup file.');
  }
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Update the app, then try again.');
  }
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.data)) {
    if (isProgressKey(k) && typeof v === 'string') data[k] = v;
  }
  return { app: BACKUP_APP, version: b.version, build: String(b.build ?? ''), createdAt: String(b.createdAt ?? ''), data };
}

/** What a backup holds, for the confirmation before restoring. */
export function describeBackup(b: Backup): { decks: number; cards: number; games: number } {
  const json = (k: string): any => {
    try {
      return JSON.parse(b.data[k] ?? 'null');
    } catch {
      return null;
    }
  };
  const decks = json('edison.decks.v1');
  const coll = json('edison.collection.v1');
  const profile = json('edison.profile.v1');
  // collection.owned: card name → rarity → copies (src/collection/index.ts)
  let cards = 0;
  for (const byRarity of Object.values(coll?.owned ?? {})) {
    for (const n of Object.values(byRarity ?? {})) if (typeof n === 'number') cards += n;
  }
  const g = profile?.games;
  return { decks: Array.isArray(decks) ? decks.length : 0, cards, games: g ? (g.w | 0) + (g.l | 0) + (g.d | 0) : 0 };
}

/**
 * Replaces this device's progress with the backup's. Device keys are kept. If the browser runs out of
 * space part-way, the previous progress is put back and the error is rethrown.
 */
export function restoreBackup(store: Store, b: Backup) {
  const previous: Record<string, string> = {};
  for (const k of progressKeys(store)) previous[k] = store.getItem(k)!;
  const replaceWith = (data: Record<string, string>) => {
    for (const k of progressKeys(store)) store.removeItem(k);
    for (const [k, v] of Object.entries(data)) store.setItem(k, v);
  };
  try {
    replaceWith(b.data);
  } catch (e) {
    replaceWith(previous);
    throw new Error((e as Error)?.name === 'QuotaExceededError' ? 'Not enough storage space on this device to restore this backup.' : 'The backup couldn’t be restored. Nothing was changed.');
  }
}
