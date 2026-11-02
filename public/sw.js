// Offline support: the app shell is cached on first visit; card images are cached as they load.
// Sound effects (./audio/sfx/, about 0.4 MB) are pre-cached in their own cache, which survives app
// updates. Music (./audio/music/) is cached the first time each track plays, keeping at most about
// 8 MB of it (the least recently played tracks are dropped first).
const VERSION = 'edison-v8';
// v2: v1 kept whatever came back, including the image host's errors (rate limit, blocked), so a card could stay
// broken for good. Only pictures that loaded are kept now.
const CARDS_CACHE = 'edison-cards-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './apple-touch-icon.png'];
// Bump when any file in public/audio/sfx/ changes.
const SFX_CACHE = 'edison-sfx-v2';
const MUSIC_CACHE = 'edison-music-v1';
const MUSIC_MAX_BYTES = 8 * 1024 * 1024;
const SFX = [
  'barrier', 'boom', 'card-flip-1', 'card-flip-2', 'card-place-1', 'card-place-2', 'card-place-3', 'card-place-4',
  'card-shuffle', 'card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-4', 'card-slide-5', 'chime-1', 'chime-2',
  'clang-1', 'clang-2', 'click-1', 'click-2', 'coin-flick', 'coin-land-1', 'coin-land-2', 'crunch-1', 'crunch-2',
  'energy-1', 'energy-2', 'error', 'punch-1', 'punch-2', 'punch-3', 'select-1', 'select-2', 'shards', 'shatter-1',
  'shatter-2', 'shatter-3', 'shimmer', 'shing-1', 'shing-2', 'shing-3', 'sparkle', 'switch-1', 'switch-2', 'swoosh',
  'thud-1', 'thud-2', 'tick-1', 'tick-2', 'vibe-lose', 'vibe-turn', 'vibe-win', 'woosh-1', 'woosh-2', 'woosh-3',
  'woosh-4',
];
const SFX_FILES = SFX.map((n) => './audio/sfx/' + n + '.m4a');

/** Fetch whichever sound effects are not cached yet. Missing files still load on demand. */
function precacheSfx() {
  return caches
    .open(SFX_CACHE)
    .then((c) =>
      Promise.all(
        SFX_FILES.map((u) =>
          c.match(u).then(
            (hit) =>
              hit ||
              fetch(u)
                .then((res) => (res.ok && res.status === 200 ? c.put(u, res) : undefined))
                .catch(() => undefined),
          ),
        ),
      ),
    )
    .catch(() => undefined);
}

/** Size of a cached music response (stored in x-bytes when we cached it). */
function bytesOf(res) {
  return Number(res.headers.get('x-bytes') || res.headers.get('content-length') || 0);
}

/** Drop the least recently played tracks until the music cache fits in MUSIC_MAX_BYTES. */
async function trimMusic(c) {
  const keys = await c.keys(); // insertion order: oldest first (a replay re-inserts the track)
  const sizes = await Promise.all(keys.map((k) => c.match(k).then((r) => (r ? bytesOf(r) : 0))));
  let total = sizes.reduce((a, b) => a + b, 0);
  for (let i = 0; i < keys.length - 1 && total > MUSIC_MAX_BYTES; i++) {
    await c.delete(keys[i]);
    total -= sizes[i];
  }
}

/** Music: from the cache (refreshing its place as most recently played), else the network, then cached. */
async function musicResponse(req) {
  const c = await caches.open(MUSIC_CACHE);
  const key = new URL(req.url);
  key.search = '';
  const hit = await c.match(key.href);
  if (hit) {
    const blob = await hit.blob();
    const headers = { 'Content-Type': hit.headers.get('Content-Type') || 'audio/mp4', 'x-bytes': String(blob.size) };
    await c.delete(key.href);
    await c.put(key.href, new Response(blob, { headers }));
    return new Response(blob, { headers });
  }
  const res = await fetch(req);
  if (!res.ok || res.status !== 200) return res;
  const blob = await res.blob();
  const headers = { 'Content-Type': res.headers.get('Content-Type') || 'audio/mp4', 'x-bytes': String(blob.size) };
  await c.put(key.href, new Response(blob, { headers }));
  await trimMusic(c);
  return new Response(blob, { headers });
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SFX_CACHE && k !== MUSIC_CACHE && k !== CARDS_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for the sound effects once the worker is active, so activation never waits for them.
self.addEventListener('message', (e) => {
  if (e.data === 'precache-audio') e.waitUntil(precacheSfx());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The version check must always reach the network.
  if (url.origin === self.location.origin && url.pathname.endsWith('/version.json')) return;

  // Play a friend: PeerJS signalling (id requests, long-polling) must never be cached or answered
  // from the cache, whichever server it runs on. WebRTC and WebSocket traffic never reaches here.
  if (url.pathname.includes('/peerjs/') || (url.searchParams.has('ts') && url.pathname.endsWith('/id'))) return;

  // Pages: network first (skipping the browser cache) so updates arrive; cache as fallback offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // Card images: keep a copy so each picture is only downloaded once, but only one that actually loaded. An <img>
  // request is no-cors, whose answer can't be checked, so ask with CORS first and fall back to the page's request
  // (shown, not kept) if the host doesn't allow it.
  if (url.hostname === 'images.ygoprodeck.com' || url.hostname === 'ms.yugipedia.com') {
    e.respondWith(
      caches.open(CARDS_CACHE).then((c) =>
        c.match(req.url).then(
          (hit) =>
            hit ||
            fetch(req.url, { mode: 'cors', credentials: 'omit' })
              .then((res) => {
                if (!res.ok) return fetch(req);
                c.put(req.url, res.clone());
                return res;
              })
              .catch(() => fetch(req)),
        ),
      ),
    );
    return;
  }

  // Recorded audio. The app reads whole files with fetch(), so there are no range requests.
  if (url.origin === self.location.origin && url.pathname.includes('/audio/') && !req.headers.has('range')) {
    if (url.pathname.includes('/audio/music/')) {
      e.respondWith(musicResponse(req).catch(() => fetch(req)));
      return;
    }
    e.respondWith(
      caches.open(SFX_CACHE).then((c) =>
        c.match(req, { ignoreSearch: true }).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok && res.status === 200) c.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }

  // Own files (hashed assets): cache first.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
  }
});
