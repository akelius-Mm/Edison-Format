// Keeps the installed app up to date: checks for a newer published version when the app opens,
// when it comes back to the foreground, and every 15 minutes. A new version is applied straight
// away unless a duel is in progress; then it waits until the duel ends.
declare const __BUILD_ID__: string;

const CHECK_EVERY_MS = 15 * 60 * 1000;
let pending = false;
let reloading = false;
let banner: HTMLElement | null = null;
let target = '';
const TRIED_KEY = 'edison.updateTried';

/** The version we last reloaded for. If a reload didn't bring it, don't keep reloading for it. */
function triedFor(id: string) {
  try {
    return sessionStorage.getItem(TRIED_KEY) === id;
  } catch {
    return false;
  }
}

// a duel, or an online room (reloading would drop the connection to the friend)
const busy = () => document.body.classList.contains('in-duel') || /^#\/?friend\b/.test(location.hash);

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

/** Reload now if nothing is in progress, otherwise as soon as the duel ends. */
function applyWhenSafe() {
  pending = true;
  if (!busy()) return reloadNow();
  showBanner();
}

function showBanner() {
  if (banner) return;
  banner = document.createElement('div');
  banner.className = 'update-banner';
  banner.setAttribute('role', 'status');
  banner.innerHTML = '<span>Update ready. It installs when this duel ends.</span>';
  const now = document.createElement('button');
  now.type = 'button';
  now.textContent = 'Update now';
  now.onclick = reloadNow;
  banner.append(now);
  document.body.append(banner);
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

  // Apply a waiting update the moment a duel finishes.
  new MutationObserver(() => {
    if (pending && !busy()) reloadNow();
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // ...or the moment the player leaves the online room
  window.addEventListener('hashchange', () => {
    if (pending && !busy()) reloadNow();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
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
