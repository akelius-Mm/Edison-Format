// Optional official card artwork, looked up by card name from the public YGOPRODeck API.
// Off by default (Settings → "Load official card images"). When a lookup or image load
// fails (offline, blocked by a sandbox CSP, unknown name) the procedural art stays.
import { getSettings, loadJSON, saveJSON } from '../settings';

export interface OfficialImage {
  /** Full card scan. */
  full: string;
  /** Artwork-only crop (used inside our card frames). */
  art: string;
}

const API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?name=';
const CACHE_KEY = 'edison.officialArt.v1';
/** null = looked up and not found. */
let cache: Record<string, OfficialImage | null> | null = null;
const inflight = new Map<string, Promise<OfficialImage | null>>();
let queue: { name: string; resolve: (v: OfficialImage | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** When a lookup last failed on the network (0 = never). New lookups wait a while after a failure, but art already
 *  looked up keeps showing: one dropped request (a phone switching networks, the API's rate limit) must not switch
 *  every mat, sleeve and card back to the drawn art for the rest of the session. */
let downSince = 0;
const RETRY_MS = 60_000;
const apiDown = () => downSince > 0 && Date.now() - downSince < RETRY_MS;

function store() {
  if (!cache) cache = loadJSON<Record<string, OfficialImage | null>>(CACHE_KEY, {});
  return cache;
}

export function officialArtEnabled() {
  return getSettings().officialImages;
}

/** Synchronous cache read (undefined = not looked up yet). */
export function cachedOfficialImage(name: string): OfficialImage | null | undefined {
  return store()[name];
}

/** Look up a card's images. Requests are batched (the API accepts `A|B|C`). */
export function getOfficialImage(name: string): Promise<OfficialImage | null> {
  const hit = store()[name];
  if (hit !== undefined) return Promise.resolve(hit);
  const pending = inflight.get(name);
  if (pending) return pending;
  // the API just failed: don't look up now (and don't remember a miss), try again on a later call
  if (apiDown()) return Promise.resolve(null);
  const p = new Promise<OfficialImage | null>((resolve) => {
    queue.push({ name, resolve });
    if (!timer) timer = setTimeout(flush, 40);
  });
  inflight.set(name, p);
  return p;
}

async function flush() {
  timer = null;
  const batch = queue.splice(0, 40);
  if (queue.length) timer = setTimeout(flush, 40);
  if (!batch.length) return;
  const names = [...new Set(batch.map((b) => b.name))];
  const found: Record<string, OfficialImage> = {};
  let failed = false;
  try {
    const res = await fetch(API + encodeURIComponent(names.join('|')));
    if (res.ok) {
      const json = await res.json();
      for (const c of json.data ?? []) {
        const img = c.card_images?.[0];
        if (img) found[String(c.name).toLowerCase()] = { full: img.image_url, art: img.image_url_cropped ?? img.image_url };
      }
    } else if (res.status !== 400) {
      // rate limited or the server is having trouble: not an answer about these names
      failed = true;
    } else if (names.length > 1) {
      // One unknown name fails the whole batch: retry individually.
      for (const b of batch) {
        inflight.delete(b.name);
        queue.push(b);
      }
      singleMode = true;
      if (!timer) timer = setTimeout(flushSingles, 40);
      return;
    }
  } catch {
    // offline, or blocked (e.g. a sandboxed preview)
    failed = true;
  }
  if (failed) downSince = Date.now();
  const c = store();
  for (const b of batch) {
    const v = found[b.name.toLowerCase()] ?? null;
    if (!failed) c[b.name] = v;
    inflight.delete(b.name);
    b.resolve(v);
  }
  if (!failed) saveJSON(CACHE_KEY, c);
}

let singleMode = false;
async function flushSingles() {
  timer = null;
  const items = queue.splice(0);
  for (const [i, b] of items.entries()) {
    let v: OfficialImage | null = null;
    let failed = apiDown();
    // one at a time, well under the API's rate limit (it blocks clients that send more than 20 a second)
    if (i > 0 && !failed) await new Promise((r) => setTimeout(r, 120));
    if (!failed)
      try {
        const res = await fetch(API + encodeURIComponent(b.name));
        if (res.ok) {
          const img = (await res.json()).data?.[0]?.card_images?.[0];
          if (img) v = { full: img.image_url, art: img.image_url_cropped ?? img.image_url };
        } else if (res.status !== 400) failed = true;
      } catch {
        failed = true;
      }
    if (failed) downSince ||= Date.now();
    else store()[b.name] = v;
    inflight.delete(b.name);
    b.resolve(v);
  }
  saveJSON(CACHE_KEY, store());
  void singleMode;
}

/**
 * Replace the contents of a card's art box with the official artwork once it loads.
 * `artEl` keeps its procedural SVG until the image has actually loaded.
 * Use `mode: 'full'` for a whole-card scan (e.g. a large preview).
 */
export function attachOfficialArt(artEl: HTMLElement, cardName: string, mode: 'art' | 'full' = 'art') {
  if (!officialArtEnabled()) return;
  void getOfficialImage(cardName).then((img) => {
    if (!img) return;
    const el = new Image();
    el.decoding = 'async';
    el.alt = cardName;
    el.draggable = false;
    el.className = 'official-art';
    el.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    el.onload = () => {
      if (!artEl.isConnected && !artEl.parentElement) return;
      artEl.replaceChildren(el);
      artEl.classList.add('has-official-art');
    };
    el.onerror = () => {
      /* keep procedural art */
    };
    el.src = mode === 'full' ? img.full : img.art;
  });
}

/**
 * Swap a rendered card face for the real full card scan once it loads.
 * Badges (limit status, chain numbers) stay on top. Drawn face stays if loading fails.
 */
export function attachOfficialCard(cardEl: HTMLElement, cardName: string) {
  if (!officialArtEnabled()) return;
  // When the scan is known, hide the drawn face while it loads (briefly), so a played card never shows the
  // drawing first; if it is slow or fails, the drawn face comes back.
  const known = cachedOfficialImage(cardName);
  let waitTimer = 0;
  const stopWaiting = () => {
    window.clearTimeout(waitTimer);
    cardEl.classList.remove('yc--awaiting-art');
  };
  if (known) {
    cardEl.classList.add('yc--awaiting-art');
    waitTimer = window.setTimeout(stopWaiting, 900);
  }
  void getOfficialImage(cardName).then((img) => {
    if (!img) return stopWaiting();
    const el = new Image();
    el.decoding = 'async';
    el.alt = cardName;
    el.draggable = false;
    el.className = 'official-card';
    el.onload = () => {
      const keep = [...cardEl.querySelectorAll(':scope > .yc-limit, :scope > .yc-badge')];
      cardEl.replaceChildren(el, ...keep);
      cardEl.classList.add('yc--official');
      stopWaiting();
    };
    el.onerror = stopWaiting;
    el.src = img.full;
  });
}

/**
 * Warm the card scans of a duel's decks, one at a time, into the offline cache (the service worker stores
 * card images on disk), without keeping any image in memory. Played cards then load almost at once.
 */
export function prefetchOfficialImages(names: Iterable<string>) {
  if (!officialArtEnabled()) return;
  // Look every name up at once (the lookups are batched into a few requests and remembered), then download
  // the scans one by one.
  const lookups = [...new Set(names)].map((n) => getOfficialImage(n));
  void Promise.all(lookups).then(async (imgs) => {
    for (const img of imgs) {
      if (!img || !officialArtEnabled()) continue;
      try {
        await fetch(img.full, { mode: 'no-cors' });
      } catch {
        /* offline: skip */
      }
    }
  });
}

/** Clear cached lookups (Settings → reset). */
export function clearOfficialArtCache() {
  cache = {};
  saveJSON(CACHE_KEY, {});
}
