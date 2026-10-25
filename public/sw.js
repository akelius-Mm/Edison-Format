// Offline support: the app shell is cached on first visit; card images are cached as they load.
// Recorded audio (./audio/) is pre-cached in its own cache, which survives app updates.
const VERSION = 'edison-v6';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './apple-touch-icon.png'];
// Bump when any file in public/audio/ changes.
const AUDIO_CACHE = 'edison-audio-v1';
const SFX = [
  'barrier', 'boom', 'card-flip-1', 'card-flip-2', 'card-place-1', 'card-place-2', 'card-place-3', 'card-place-4',
  'card-shuffle', 'card-slide-1', 'card-slide-2', 'card-slide-3', 'card-slide-4', 'card-slide-5', 'chime-1', 'chime-2',
  'clang-1', 'clang-2', 'click-1', 'click-2', 'coin-flick', 'coin-land-1', 'coin-land-2', 'crunch-1', 'crunch-2',
  'energy-1', 'energy-2', 'error', 'punch-1', 'punch-2', 'punch-3', 'sax-lose', 'sax-turn', 'sax-win', 'select-1',
  'select-2', 'shards', 'shatter-1', 'shatter-2', 'shatter-3', 'shimmer', 'shing-1', 'shing-2', 'shing-3', 'sparkle',
  'switch-1', 'switch-2', 'swoosh', 'thud-1', 'thud-2', 'tick-1', 'tick-2', 'woosh-1', 'woosh-2', 'woosh-3', 'woosh-4',
];
const AUDIO = [...SFX.map((n) => './audio/sfx/' + n + '.m4a'), './audio/music/menu.m4a', './audio/music/duel.m4a', './audio/music/pinch.m4a'];

/** Fetch whatever audio is not cached yet. Never fails the install: missing files load on demand. */
function precacheAudio() {
  return caches
    .open(AUDIO_CACHE)
    .then((c) =>
      Promise.all(
        AUDIO.map((u) =>
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
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== AUDIO_CACHE && k !== 'edison-cards').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks for the audio once the worker is active, so activation never waits for 5 MB.
self.addEventListener('message', (e) => {
  if (e.data === 'precache-audio') e.waitUntil(precacheAudio());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The version check must always reach the network.
  if (url.origin === self.location.origin && url.pathname.endsWith('/version.json')) return;

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

  // Card images: keep a copy so each picture is only downloaded once.
  if (url.hostname === 'images.ygoprodeck.com' || url.hostname === 'ms.yugipedia.com') {
    e.respondWith(
      caches.open('edison-cards').then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              c.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }

  // Recorded audio: cache first from the audio cache (kept across app updates). The app reads
  // whole files with fetch(), so there are no range requests to deal with.
  if (url.origin === self.location.origin && url.pathname.includes('/audio/') && !req.headers.has('range')) {
    e.respondWith(
      caches.open(AUDIO_CACHE).then((c) =>
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
