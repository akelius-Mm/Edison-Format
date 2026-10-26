// Keeps the installed app up to date: checks for a newer published version when the app opens,
// when it comes back to the foreground, and every 15 minutes. A new version never interrupts play:
// it installs right away only while the app is still starting up on Home, otherwise quietly the next
// time the app goes to the background (outside a duel or an online room), or when the player taps
// "Restart" on the small note on Home.
declare const __BUILD_ID__: string;

const CHECK_EVERY_MS = 15 * 60 * 1000;
let pending = false;
let reloading = false;
let banner: HTMLElement | null = null;
let target = '';
/** The first seconds after launch, before the player has done anything: an update then just looks like loading. */
const startedAt = Date.now();
let interacted = false;
const STARTUP_MS = 8000;
const TRIED_KEY = 'edison.updateTried';

/** The version we last reloaded for. If a reload didn't bring it, don't keep reloading for it. */
function triedFor(id: string) {
  try {
    return sessionStorage.getItem(TRIED_KEY) === id;
  } catch {
    return false;
  }
}

// a duel, an online room (reloading would drop the connection to the friend), or a Friends Locals
// event in progress anywhere in the app (the organiser's phone runs it; players are in rounds)
const busy = () => document.body.classList.contains('in-duel') || document.body.classList.contains('in-online') || /^#\/?friend(-locals)?\b/.test(location.hash);

function reloadNow() {
  if (reloading) return;
  reloading = true;
  try {
    if (target) sessionStorage.setItem(TRIED_KEY, target);
  } catch {
    /* ignore */
  }
  location.reload();
}

const onHome = () => /^#?\/?(title)?$/.test(location.hash.replace(/\?.*$/, ''));

/** Apply at launch on Home; otherwise wait for the background (or the player's tap), never mid-play. */
function applyWhenSafe() {
  pending = true;
  if (!busy() && !interacted && Date.now() - startedAt < STARTUP_MS && onHome()) return reloadNow();
  showBanner();
}

/** A small note, shown only on Home (never over a duel): the update installs next time, or now on a tap. */
function showBanner() {
  if (!banner) {
    banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = '<span>Update ready. It installs next time you open the app.</span>';
    const now = document.createElement('button');
    now.type = 'button';
    now.textContent = 'Restart';
    now.onclick = reloadNow;
    banner.append(now);
    document.body.append(banner);
  }
  banner.hidden = busy() || !onHome();
}

async function check() {
  if (pending || document.visibilityState !== 'visible') return;
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { id } = (await res.json()) as { id?: string };
    if (!id || id === __BUILD_ID__ || triedFor(id)) return;
    target = id;
    applyWhenSafe();
  } catch {
    /* offline: try again later */
  }
}

export function startUpdater() {
  if (location.protocol !== 'https:' || location.hostname.endsWith('claude.ai')) return;

  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => (interacted = true), { once: true, capture: true });
  // The note only shows on Home, outside duels.
  window.addEventListener('hashchange', () => pending && showBanner());
  new MutationObserver(() => pending && showBanner()).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  document.addEventListener('visibilitychange', () => {
    // a waiting update installs while the app is in the background, so the next open is simply up to date
    if (document.visibilityState === 'hidden') {
      if (pending && !busy()) reloadNow();
      return;
    }
    void check();
    void navigator.serviceWorker?.getRegistration().then((r) => r?.update());
  });
  setInterval(() => void check(), CHECK_EVERY_MS);
  setTimeout(() => void check(), 3000);

  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    // A new service worker taking over also means a new version.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) applyWhenSafe();
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support unavailable; the app still works online */
    });
    // Once a worker is active, have it fetch the sound effects in the background for offline play
    // (music is cached as each track is first played).
    void navigator.serviceWorker.ready.then((r) => r.active?.postMessage('precache-audio')).catch(() => {});
  });
}
