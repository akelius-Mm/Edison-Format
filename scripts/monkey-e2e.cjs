// Monkey test (Playwright, Chromium, iPhone 13) against the built app served by
// `python3 -m http.server -d dist`: random taps, long presses, swipes, Escape and history back,
// across the whole app and inside duels, with a seeded random sequence per run.
//
// Fails on page errors and unhandled rejections, a blank screen, or a spinner / "Restoring" cover
// that stays up for more than ~10 s. Each failure prints the seed, the step and the last actions,
// so `SEEDS=<seed> STEPS=<n>` replays the same run.
//
// Usage (after `npm run build`): npm run test:monkey-e2e -- [outDir]
//   SEEDS=1,2,3 (default 11,22,33,44)  STEPS=900 per seed (default)
const { chromium, devices } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
  }
})();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'edison-monkey-shots');
fs.mkdirSync(OUT, { recursive: true });
const DIST = path.join(__dirname, '..', 'dist');
const APP_PORT = 8484;
// no friend server here: the online screens must fail politely (an unreachable server)
const BASE = `http://127.0.0.1:${APP_PORT}/?peer=${encodeURIComponent('127.0.0.1:9/none')}`;
const SEEDS = (process.env.SEEDS || '11,22,33,44').split(',').map(Number);
const STEPS = Number(process.env.STEPS || 900);
const STUCK_MS = 10000;

const ROUTES = ['title', 'play', 'duel', 'exhibition', 'deck-builder', 'database', 'customize', 'settings', 'rules', 'tournament', 'draft', 'packs', 'binder', 'locals', 'events', 'events?view=season', 'profile', 'friend', 'friend-locals'];
const IGNORED = /Failed to load resource|net::ERR|ygoprodeck|yugipedia|ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION|peerjs|PeerJS|Lost connection to server|Could not get an ID|socket|WebSocket/i;

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tappable things on screen (topmost layer first: dialogs, then the duel, then the page). */
function targets(page) {
  return page.evaluate(() => {
    const layer =
      [...document.querySelectorAll('.modal-backdrop.in .modal, .duel-root .dlg-layer.is-open:not(.is-peeking) .dlg, .zoom-backdrop, .ctx-menu')].pop() ??
      document.querySelector('.duel-host:not(.closing)') ??
      document.body;
    const skip = '[data-test=create-room], [data-test=fl-create], .fr-join-btn, a[href^="http"], input[type=file], .tab-bar-hidden';
    const sel = 'button:not([disabled]), a[href], [role=button], .dc[data-uid], .tile, .seg-btn, summary, .cb-cell, .cb-row, .dkc-box, .home-tile, .ios-row--nav, input[type=checkbox], select, .pile';
    const out = [];
    for (const e of layer.querySelectorAll(sel)) {
      if (e.closest(skip) || e.matches(skip)) continue;
      const r = e.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const x = Math.min(innerWidth - 2, Math.max(2, r.left + r.width / 2));
      const y = Math.min(innerHeight - 2, Math.max(2, r.top + r.height / 2));
      const top = document.elementFromPoint(x, y);
      if (!top || !(e === top || e.contains(top) || top.contains(e))) continue;
      out.push({ x, y, label: `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)}"` });
    }
    return out;
  });
}

/** Problems visible right now: blank screen, or spinners (returned for the stuck-timer). */
function inspect(page) {
  return page.evaluate(() => {
    const app = document.getElementById('app');
    const duel = document.querySelector('.duel-host .duel-root');
    const host = document.querySelector('.duel-host:not(.closing)');
    let blank = null;
    if (!host) {
      const screens = [...app.children].filter((e) => e.classList.contains('screen') && !e.classList.contains('screen-leave'));
      const s = screens[screens.length - 1];
      if (!s) blank = 'no screen';
      else {
        const vis = [...s.querySelectorAll('*')].filter((e) => {
          const b = e.getBoundingClientRect();
          return b.width > 0 && b.height > 0;
        }).length;
        if (vis < 3 || !(s.innerText || '').trim()) blank = `blank ${s.className}`;
      }
    } else if (!duel && !host.innerText.trim() && !host.querySelector('*')) blank = 'empty duel host';
    const spin = [...document.querySelectorAll('.spinner, .duel-restoring:not(.is-gone), .fr-busy')].filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('.fr-offline');
    });
    return { blank, spinner: spin.length ? spin.map((e) => e.className.split(' ')[0]).join(',') : null, hash: location.hash };
  });
}

async function touchSwipe(cdp, x1, y1, x2, y2, steps = 6) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }] });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function longPress(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function run(browser, seed, landscape) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const iphone = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  const ctx = await browser.newContext({ ...iphone, ...(landscape ? { viewport: { width: 844, height: 390 } } : {}) });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (rt) => rt.abort());
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('monkey.seeded')) return;
    sessionStorage.setItem('monkey.seeded', '1');
    localStorage.setItem('edison.settings.v1', JSON.stringify({ animationSpeed: 0.1, sound: false, music: false, haptics: false, officialImages: false }));
    localStorage.setItem('edison.hint.hold', '1');
    // the share sheet does not exist here; never block on it
    window.__monkey = true;
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 600)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.test(m.text())) consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const trail = [];
  const fail = async (step, why) => {
    failures++;
    console.log(`FAIL seed ${seed}${landscape ? ' (landscape)' : ''} step ${step}: ${why}\n  last actions:\n    ${trail.slice(-15).join('\n    ')}`);
    await page.screenshot({ path: path.join(OUT, `fail-${seed}-${step}.png`) }).catch(() => {});
  };
  await page.goto(BASE + '#/title');
  let spinSince = 0;
  let spinWhat = '';
  let duels = 0;
  let stop = false;
  for (let step = 0; step < STEPS && !stop; step++) {
    const roll = r();
    let act = '';
    try {
      if (roll < 0.03 && !(await page.locator('.duel-root').count())) {
        // into a duel vs the AI (the monkey then plays it, badly)
        act = 'start a duel';
        await page.evaluate(() => (location.hash = '#/duel'));
        await page.locator('.screen:not(.screen-leave) .dkc-box').nth(Math.floor(r() * 6)).click({ timeout: 3000 });
        await page.locator('.screen:not(.screen-leave) button.cta', { hasText: 'Duel' }).last().click({ timeout: 3000 });
        await page.waitForSelector('.duel-root', { timeout: 10000 });
      } else if (roll < 0.06) {
        const route = pick(ROUTES);
        act = `go ${route}`;
        await page.evaluate((h) => (location.hash = h), `#/${route}`);
      } else if (roll < 0.08) {
        act = 'history back';
        await page.goBack({ timeout: 3000 }).catch(() => {});
      } else if (roll < 0.10) {
        act = 'Escape';
        await page.keyboard.press('Escape');
      } else if (roll < 0.15) {
        const w = landscape ? 844 : 390;
        const hgt = landscape ? 390 : 844;
        const x1 = 20 + r() * (w - 40);
        const y1 = 60 + r() * (hgt - 120);
        const dir = pick([[0, -1], [0, 1], [1, 0], [-1, 0]]);
        const d = 80 + r() * 220;
        act = `swipe ${dir.join(',')} from ${x1 | 0},${y1 | 0}`;
        await touchSwipe(cdp, x1, y1, x1 + dir[0] * d, y1 + dir[1] * d);
      } else if (roll < 0.18) {
        const ts = await targets(page);
        if (ts.length) {
          const t = pick(ts);
          act = `long-press ${t.label}`;
          await longPress(cdp, t.x, t.y);
        }
      } else if (roll < 0.19) {
        act = 'reload';
        await page.reload();
      } else {
        const ts = await targets(page);
        if (ts.length) {
          const t = pick(ts);
          act = `tap ${t.label}`;
          await page.touchscreen.tap(t.x, t.y);
        } else {
          act = 'tap nothing (no targets)';
        }
      }
    } catch (e) {
      act += ` (threw: ${String(e).split('\n')[0]})`;
    }
    trail.push(`${step}: ${act}`);
    await page.waitForTimeout(40 + Math.floor(r() * 120));
    if (errors.length) {
      await fail(step, `page error: ${errors.splice(0).join(' | ')}`);
      stop = true;
      break;
    }
    if (step % 3 === 0) {
      let s;
      try {
        s = await inspect(page);
      } catch {
        continue; // navigating
      }
      if (s.blank) {
        // a screen may be mid-transition: look again shortly
        await page.waitForTimeout(500);
        const again = await inspect(page).catch(() => null);
        if (again && again.blank) {
          await fail(step, `blank screen at ${again.hash}: ${again.blank}`);
          stop = true;
          break;
        }
      }
      if (s.spinner) {
        if (spinWhat !== s.spinner + s.hash) {
          spinWhat = s.spinner + s.hash;
          spinSince = Date.now();
        } else if (Date.now() - spinSince > STUCK_MS) {
          await fail(step, `spinner up for over ${STUCK_MS / 1000}s at ${s.hash}: ${s.spinner}`);
          stop = true;
          break;
        }
      } else spinWhat = '';
      if (await page.locator('.duel-root').count()) duels += 0.34;
    }
  }
  console.log(`  seed ${seed}${landscape ? ' landscape' : ''}: ${trail.length} actions, ~${Math.round(duels * 3)} checks inside duels, ${consoleErrors.length} console errors${consoleErrors.length ? ` (${[...new Set(consoleErrors)].slice(0, 3).join(' | ')})` : ''}`);
  await ctx.close();
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.log('Build first: npm run build');
    process.exit(1);
  }
  const server = spawn('python3', ['-m', 'http.server', String(APP_PORT), '--bind', '127.0.0.1', '-d', DIST], { stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch();
  const t0 = Date.now();
  try {
    for (const [i, seed] of SEEDS.entries()) await run(browser, seed, i % 2 === 1);
  } catch (e) {
    failures++;
    console.log('FAIL', e.stack || e);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`monkey-e2e: ${SEEDS.length} seeds × ${STEPS} steps, ${failures} failure${failures === 1 ? '' : 's'}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  process.exit(failures ? 1 : 0);
})();
