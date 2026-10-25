// "Your music": audio files the player picks from their own device for the Menu, Duel and Pinch
// slots. They are stored in this browser's IndexedDB and never leave the device.
import type { MusicSlot } from './samples';

export interface UserTrackMeta {
  slot: MusicSlot;
  name: string;
  type: string;
  size: number;
  added: number;
}
interface UserTrack extends UserTrackMeta {
  /** Raw file bytes (an ArrayBuffer stores reliably in every Safari version; Blobs did not). */
  data: ArrayBuffer;
}

export const USER_SLOTS: MusicSlot[] = ['menu', 'duel', 'pinch'];
/** Big enough for a long 320 kbps MP3; decoded audio needs about 10x this in memory. */
export const MAX_USER_TRACK_BYTES = 40 * 1024 * 1024;

const DB = 'edison-audio';
const STORE = 'tracks';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Storage unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'slot' });
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
/** Called after a slot's file is added, replaced or removed. */
export function onUserMusicChange(fn: (slot: MusicSlot) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = (slot: MusicSlot) => {
  metaCache = null;
  for (const f of [...listeners]) f(slot);
};

let metaCache: Promise<Partial<Record<MusicSlot, UserTrackMeta>>> | null = null;
/** Name, size and type of the stored file for each slot (no audio data). */
export function userTrackInfo(): Promise<Partial<Record<MusicSlot, UserTrackMeta>>> {
  if (!metaCache) {
    metaCache = run<UserTrack[]>('readonly', (s) => s.getAll() as IDBRequest<UserTrack[]>)
      .then((all) => {
        const out: Partial<Record<MusicSlot, UserTrackMeta>> = {};
        for (const t of all) out[t.slot] = { slot: t.slot, name: t.name, type: t.type, size: t.size, added: t.added };
        return out;
      })
      .catch(() => ({}));
  }
  return metaCache;
}

/** The stored file bytes for a slot, or null. */
export async function userTrackData(slot: MusicSlot): Promise<ArrayBuffer | null> {
  try {
    const t = await run<UserTrack | undefined>('readonly', (s) => s.get(slot) as IDBRequest<UserTrack | undefined>);
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

/** Store a picked file for a slot (replacing any earlier one). */
export async function setUserTrack(slot: MusicSlot, file: File | Blob, name = (file as File).name || 'Audio file'): Promise<void> {
  if (file.size > MAX_USER_TRACK_BYTES) throw new Error(`That file is ${(file.size / 1048576).toFixed(0)} MB. Pick one under ${MAX_USER_TRACK_BYTES / 1048576} MB.`);
  const data = await readBytes(file);
  const rec: UserTrack = { slot, name, type: file.type || '', size: file.size, added: Date.now(), data };
  await run('readwrite', (s) => s.put(rec));
  changed(slot);
}

export async function removeUserTrack(slot: MusicSlot): Promise<void> {
  await run('readwrite', (s) => s.delete(slot));
  changed(slot);
}
