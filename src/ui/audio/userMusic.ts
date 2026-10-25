// "Your music": audio files the player picks from their own device for the Menu, Duel and Pinch
// slots. Each slot can hold several files, which then play as that slot's playlist. They are
// stored in this browser's IndexedDB and never leave the device.
import type { MusicSlot } from './samples';

export interface UserTrackMeta {
  id: number;
  slot: MusicSlot;
  name: string;
  type: string;
  size: number;
  added: number;
}
interface UserTrack extends Omit<UserTrackMeta, 'id'> {
  id?: number;
  /** Raw file bytes (an ArrayBuffer stores reliably in every Safari version; Blobs did not). */
  data: ArrayBuffer;
}

export const USER_SLOTS: MusicSlot[] = ['menu', 'duel', 'pinch'];
/** Big enough for a long 320 kbps MP3; decoded audio needs about 10x this in memory. */
export const MAX_USER_TRACK_BYTES = 40 * 1024 * 1024;
/** Files per slot. */
export const MAX_USER_TRACKS = 12;

const DB = 'edison-audio';
/** v1 kept one file per slot in 'tracks' (key: slot); v2 keeps any number in 'files'. */
const STORE = 'files';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Storage unavailable'));
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      const tx = req.transaction!;
      const files = d.objectStoreNames.contains(STORE) ? tx.objectStore(STORE) : d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      if (!files.indexNames.contains('slot')) files.createIndex('slot', 'slot');
      // move files saved by the one-per-slot version
      if (e.oldVersion >= 1 && d.objectStoreNames.contains('tracks')) {
        const old = tx.objectStore('tracks');
        old.openCursor().onsuccess = (ev) => {
          const c = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (c) {
            const { slot, name, type, size, added, data } = c.value as UserTrack;
            files.add({ slot, name, type, size, added, data });
            c.continue();
          } else d.deleteObjectStore('tracks');
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Storage unavailable'));
    req.onblocked = () => reject(new Error('Storage blocked'));
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        let result: T;
        req.onsuccess = () => (result = req.result);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? req.error ?? new Error('Storage error'));
        tx.onabort = () => reject(tx.error ?? new Error('Storage error (quota?)'));
      }),
  );
}

const listeners = new Set<(slot: MusicSlot) => void>();
/** Called after a slot's files are added or removed. */
export function onUserMusicChange(fn: (slot: MusicSlot) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = (slot: MusicSlot) => {
  metaCache = null;
  for (const f of [...listeners]) f(slot);
};

let metaCache: Promise<UserTrackMeta[]> | null = null;
/** Name, size and type of every stored file, oldest first (no audio data). */
export function userTracks(): Promise<UserTrackMeta[]> {
  if (!metaCache) {
    metaCache = db()
      .then(
        (d) =>
          new Promise<UserTrackMeta[]>((resolve, reject) => {
            // walk with a cursor so the (large) audio data is never collected into one array
            const out: UserTrackMeta[] = [];
            const tx = d.transaction(STORE, 'readonly');
            tx.objectStore(STORE).openCursor().onsuccess = (ev) => {
              const c = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
              if (!c) return;
              const { id, slot, name, type, size, added } = c.value as UserTrack;
              out.push({ id: id!, slot, name, type, size, added });
              c.continue();
            };
            tx.oncomplete = () => resolve(out.sort((a, b) => a.added - b.added || a.id - b.id));
            tx.onerror = () => reject(tx.error);
          }),
      )
      .catch(() => []);
  }
  return metaCache;
}

/** The stored file bytes, or null. */
export async function userTrackData(id: number): Promise<ArrayBuffer | null> {
  try {
    const t = await run<UserTrack | undefined>('readonly', (s) => s.get(id) as IDBRequest<UserTrack | undefined>);
    return t?.data ?? null;
  } catch {
    return null;
  }
}

function readBytes(b: Blob): Promise<ArrayBuffer> {
  if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error ?? new Error('Could not read the file'));
    r.readAsArrayBuffer(b);
  });
}

/** Store a picked file in a slot's playlist. Returns its id. */
export async function addUserTrack(slot: MusicSlot, file: File | Blob, name = (file as File).name || 'Audio file', bytes?: ArrayBuffer): Promise<number> {
  if (file.size > MAX_USER_TRACK_BYTES) throw new Error(`That file is ${(file.size / 1048576).toFixed(0)} MB. Pick one under ${MAX_USER_TRACK_BYTES / 1048576} MB.`);
  const data = bytes ?? (await readBytes(file));
  const rec: UserTrack = { slot, name, type: file.type || '', size: file.size, added: Date.now(), data };
  const id = (await run('readwrite', (s) => s.add(rec))) as number;
  changed(slot);
  return id;
}

export async function removeUserTrack(id: number): Promise<void> {
  const meta = (await userTracks()).find((t) => t.id === id);
  await run('readwrite', (s) => s.delete(id));
  if (meta) changed(meta.slot);
  else metaCache = null;
}
