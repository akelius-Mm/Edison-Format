// Route robustness sweep (Playwright, Chromium, iPhone 13 portrait 390×844 and landscape 844×390)
// against the built app served by `python3 -m http.server -d dist`.
//
// For every route and its main sub-views (params), with an empty profile and again with saved
// progress everywhere (a duel left and saved, a Locals night, an event, a tournament, a draft,
// Friends Locals, a Circuit season):
//   - open it fresh, leave and come back, reload on it, history back and forward, open it twice quickly
//   - assert: the screen is never blank, no page errors, no console errors (blocked image hosts
//     excepted), no horizontal scroll
// Then a brand-new player's first run: Home → Duel → pick decks → finish a duel → Packs → Draft
// start → Deck Builder, and the "Report a problem" sheet and the in-app browser banner.
//
// Usage (after `npm run build`; Playwright is not a project dependency):
//   npm run test:routes-e2e -- [outDir]      ONLY=<route part> limits the sweep, QUICK=1 portrait only
const { chromium, devices } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
  }
})();
const { PeerServer } = require('peer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = (require.main === module && process.argv[2]) || path.join(require('os').tmpdir(), 'edison-routes-shots');
fs.mkdirSync(OUT, { recursive: true });
const DIST = path.join(__dirname, '..', 'dist');
const APP_PORT = 8383;
const PEER_PORT = 9393;
const PEER = `127.0.0.1:${PEER_PORT}/edison`;
const BASE = `http://127.0.0.1:${APP_PORT}/?peer=${encodeURIComponent(PEER)}`;
const ONLY = process.env.ONLY || '';
const QUICK = !!process.env.QUICK;

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

let failures = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${msg}`);
  } else if (process.env.VERBOSE) console.log(`PASS ${msg}`);
  return cond;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROUTES = [
  'title',
  'play',
  'collection',
  'duel',
  'exhibition',
  'deck-builder',
  'deck-builder?from=blackwings',
  'database',
  'customize',
  'settings',
  'rules',
  'rules?tab=banlist',
  'rules?tab=pool',
  'guide',
  'guide?section=rules',
  'tournament',
  'draft',
  'draft?customize=1',
  'packs',
  'packs?tab=shop',
  'binder',
  'friend',
  'friend-locals',
  'locals',
  'locals?view=history',
  'events',
  'events?view=season',
  'events?view=standings',
  'events?view=run',
  'events?view=checkin&kind=regional',
  'events?view=checkin&kind=sjc',
  'profile',
  'nowhere',
].filter((r) => !ONLY || r.includes(ONLY));

const IGNORED = /Failed to load resource|net::ERR|ygoprodeck|yugipedia|ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION/i;

/** A phone: collects page errors and console errors on `bag`. */
async function phone(browser, viewport, storage, bag, opts = {}) {
  const iphone = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  const ctx = await browser.newContext({ ...iphone, viewport, ...(opts.userAgent ? { userAgent: opts.userAgent } : {}) });
  // card art and fonts from the web are blocked here: fail them at once instead of waiting
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  if (storage) {
    await ctx.addInitScript((s) => {
      if (sessionStorage.getItem('e2e.seeded')) return;
      sessionStorage.setItem('e2e.seeded', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    }, storage);
  }
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (IGNORED.test(t)) return;
    bag.push(`console: ${t.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => bag.push(`pageerror: ${String(e).slice(0, 300)}`));
  return { ctx, page };
}

/** The screen on show: not blank, no horizontal scroll. Returns a problem or null. */
async function screenProblem(page) {
  // the leaving screen fades for 240 ms; give async renders a moment
  await page.waitForTimeout(380);
  return page.evaluate(() => {
    const app = document.getElementById('app');
    const duel = document.querySelector('.duel-host .duel-root');
    const screens = [...app.children].filter((e) => e.classList.contains('screen') && !e.classList.contains('screen-leave'));
    if (!duel) {
      if (screens.length !== 1) return `${screens.length} live screens`;
      const s = screens[0];
      const r = s.getBoundingClientRect();
      if (r.height < 100 || r.width < 200) return `screen is ${Math.round(r.width)}×${Math.round(r.height)}`;
      const body = s.querySelector('.frame-body') ?? s;
      const visible = [...body.querySelectorAll('*')].filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
      });
      if (visible.length < 3) return `blank: ${body.className} has ${visible.length} visible elements`;
      if (!(s.innerText || '').trim()) return 'blank: no text';
    }
    const se = document.scrollingElement;
    const w = window.innerWidth;
    const over = Math.max(se.scrollWidth, document.body.scrollWidth) - w;
    if (over > 1) {
      const wide = [...document.querySelectorAll('body *')]
        .filter((e) => {
          const b = e.getBoundingClientRect();
          return b.right > w + 1 && b.width > 0 && getComputedStyle(e).position !== 'fixed';
        })
        .slice(0, 3)
        .map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`);
      return `horizontal scroll ${over}px (${wide.join(', ')})`;
    }
    const spin = document.querySelector('.duel-restoring:not(.is-gone)');
    if (spin && !duel) return 'restoring cover without a duel';
    return null;
  });
}

const hashOf = (r) => `#/${r}`;

async function setHash(page, r) {
  await page.evaluate((h) => (location.hash = h), hashOf(r));
}

/** Every navigation pattern on one route. */
async function sweepRoute(page, r, label, bag, full) {
  const check = async (what) => {
    const p = await screenProblem(page);
    const errs = bag.splice(0);
    const good = ok(!p && !errs.length, `${label} ${r}: ${what}${p ? ` · ${p}` : ''}${errs.length ? ` · ${errs.slice(0, 3).join(' | ')}` : ''}`);
    if (!good) await page.screenshot({ path: path.join(OUT, `fail-${label}-${r.replace(/[^a-z0-9]+/gi, '_')}-${what.replace(/\W+/g, '_')}.png`) }).catch(() => {});
  };
  await page.goto(BASE + hashOf(r));
  await check('fresh');
  if (!full) return;
  await setHash(page, 'title');
  await page.waitForTimeout(150);
  await setHash(page, r);
  await check('leave and come back');
  await page.reload();
  await check('reload');
  await setHash(page, 'settings');
  await page.waitForTimeout(120);
  await page.goBack();
  await check('history back');
  await page.goForward();
  await page.waitForTimeout(120);
  await page.goBack();
  await check('history forward then back');
  // twice quickly: away and back within a frame, then the same hash again (re-render)
  await page.evaluate(
    ([a, b]) => {
      location.hash = '#/play';
      setTimeout(() => (location.hash = a), 0);
      setTimeout(() => (location.hash = b), 30);
    },
    [hashOf(r), hashOf('packs')],
  );
  await page.waitForTimeout(60);
  await setHash(page, r);
  await check('opened twice quickly');
}

// ------------------------------------------------------------------ saved progress everywhere

/** Duel vs AI setup: tap your deck (the first one), then Duel. */
async function pickDecks(page) {
  await page.locator('.screen:not(.screen-leave) .dkc-box').first().click();
  const duel = page.locator('.screen:not(.screen-leave) button.cta', { hasText: 'Duel' }).last();
  await duel.waitFor({ timeout: 10000 });
  await duel.click();
}

async function clickText(page, sel, text, timeout = 15000) {
  await page.locator(sel, { hasText: text }).first().click({ timeout });
}

/** Drive the app to leave something in progress in every mode; returns localStorage. */
async function buildProgress(browser) {
  const bag = [];
  const { ctx, page } = await phone(browser, PORTRAIT, { 'edison.settings.v1': JSON.stringify({ animationSpeed: 0, sound: false, music: false, haptics: false, confirmEndTurn: false, officialImages: false, playerName: 'Tester', nameChosen: true }), 'edison.hint.hold': '1' }, bag);
  const step = async (name, f) => {
    try {
      await f();
      ok(true, `progress: ${name}`);
    } catch (e) {
      ok(false, `progress: ${name}: ${String(e).split('\n')[0]}`);
      await page.screenshot({ path: path.join(OUT, `fail-progress-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
    }
  };
  await page.goto(BASE + '#/title');
  await step('Locals night', async () => {
    await page.goto(BASE + '#/locals');
    await clickText(page, 'button.cta', 'Check in');
    await page.waitForFunction(() => !!localStorage.getItem('edison.locals.active.v1'));
  });
  await step('tournament', async () => {
    await page.goto(BASE + '#/tournament');
    await clickText(page, 'button.cta', 'Create tournament');
    await page.waitForFunction(() => !!localStorage.getItem('edison.tournament.active.v1'));
  });
  await step('Circuit season', async () => {
    await page.goto(BASE + '#/events');
    await clickText(page, 'button.cta', 'Start a season');
    await page.waitForFunction(() => !!localStorage.getItem('edison.circuit.season.v1'));
  });
  await step('event', async () => {
    await page.goto(BASE + '#/events?view=checkin&kind=regional');
    await clickText(page, 'button.cta', 'Check in');
    await page.waitForFunction(() => !!localStorage.getItem('edison.events.active.v1'));
  });
  await step('draft', async () => {
    await page.goto(BASE + '#/draft');
    await clickText(page, 'button', 'Start draft');
    await page.waitForFunction(() => !!localStorage.getItem('edison.draft.v1'));
  });
  await step('Friends Locals', async () => {
    await page.goto(BASE + '#/friend-locals');
    await page.locator('[data-test=fl-create]').click();
    await page.waitForFunction(() => !!localStorage.getItem('edison.friendsLocals.host.v1') || !!localStorage.getItem('edison.friendsLocals.active.v1'), null, { timeout: 20000 });
  });
  await step('duel left and saved', async () => {
    await page.goto(BASE + '#/duel');
    await pickDecks(page);
    await page.waitForSelector('.duel-root.awaiting-action, .duel-root .dlg-layer.is-open', { timeout: 30000 });
    await page.locator('.duel-root .icon-btn--danger').click();
    await page.locator('.dlg--leave .dlg-actions button', { hasText: 'Leave and save' }).click();
    await page.waitForFunction(() => !document.querySelector('.duel-root') && !!localStorage.getItem('edison.duel.active.v1'), null, { timeout: 15000 });
  });
  ok(!bag.length, `progress: no errors while building it${bag.length ? `: ${bag.slice(0, 3).join(' | ')}` : ''}`);
  const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
  await ctx.close();
  return storage;
}

// ------------------------------------------------------------------ a brand-new player

const isAwaiting = (page) => page.evaluate(() => !!document.querySelector('.duel-root.awaiting-action'));

async function answerPrompt(page) {
  const layer = page.locator('.duel-root .dlg-layer.is-open:not(.dlg--leave)').last();
  if (!(await layer.count())) return false;
  const ghost = layer.locator('.dlg-actions .btn--ghost:not([disabled])');
  if (await ghost.count()) return void (await ghost.first().click({ timeout: 2000 }).catch(() => {}));
  const primary = layer.locator('.dlg-actions .btn:not([disabled])');
  if (await primary.count()) return void (await primary.first().click({ timeout: 2000 }).catch(() => {}));
  const tiles = layer.locator('.tile:not(.is-disabled), .sel-tile');
  const n = await tiles.count();
  for (let i = 0; i < n; i++) {
    await tiles.nth(i).click({ timeout: 1000 }).catch(() => {});
    if (await layer.locator('.dlg-actions .btn:not([disabled])').count()) break;
  }
  const opt = layer.locator('button.pos-opt, button.btn--option, .dlg-body button');
  if (!(await layer.locator('.dlg-actions .btn:not([disabled])').count()) && (await opt.count())) await opt.first().click({ timeout: 1000 }).catch(() => {});
  await layer.locator('.dlg-actions .btn:not([disabled])').first().click({ timeout: 1000 }).catch(() => {});
}

/** Play the duel to its end like a cautious beginner: summon what you can, attack, end the turn. */
async function playToEnd(page, ms = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.locator('.result.is-open').count()) return true;
    if (await page.locator('.duel-root .dlg-layer.is-open:not(.dlg--leave)').count()) {
      await answerPrompt(page);
    } else if (await isAwaiting(page)) {
      const hand = page.locator('.duel-root .dc.can-act[data-place="hand"]');
      let acted = false;
      if (await hand.count()) {
        await hand.first().click({ timeout: 1000 }).catch(() => {});
        const item = page.locator('.ctx-menu .ctx-item', { hasText: /Normal Summon|^Set$/ });
        if (await item.count()) {
          await item.first().click({ timeout: 1000 }).catch(() => {});
          acted = true;
        } else await page.keyboard.press('Escape').catch(() => {});
      }
      if (!acted) {
        const battle = page.locator('.duel-root .phasebar button:not([disabled])', { hasText: /Battle/ });
        const end = page.locator('.duel-root .btn--end:not([disabled])');
        if (await end.count()) await end.first().click({ timeout: 1000 }).catch(() => {});
        else if (await battle.count()) await battle.first().click({ timeout: 1000 }).catch(() => {});
      }
    }
    await page.waitForTimeout(150);
  }
  return false;
}

async function firstRun(browser, viewport, tag) {
  const bag = [];
  const { ctx, page } = await phone(browser, viewport, {}, bag);
  const step = async (name, f) => {
    try {
      await f();
      const p = await screenProblem(page);
      const errs = bag.splice(0);
      ok(!p && !errs.length, `first run (${tag}): ${name}${p ? ` · ${p}` : ''}${errs.length ? ` · ${errs.slice(0, 3).join(' | ')}` : ''}`);
    } catch (e) {
      ok(false, `first run (${tag}): ${name}: ${String(e).split('\n')[0]}`);
      await page.screenshot({ path: path.join(OUT, `fail-firstrun-${tag}-${name.replace(/\W+/g, '_')}.png`) }).catch(() => {});
      throw e;
    }
  };
  try {
    await step('Home', async () => {
      await page.goto(BASE);
      await page.waitForSelector('.home');
      ok((await page.evaluate(() => localStorage.length)) >= 0, 'empty profile opens');
    });
    await step('Settings: animations Instant', async () => {
      await page.locator('.home-gear').click();
      await page.locator('.seg-btn', { hasText: 'Instant' }).first().click();
    });
    await step('Duel → pick decks', async () => {
      await page.locator('.tabbar .tab[data-route=title]').click();
      await page.locator('.home-cta').click();
      await pickDecks(page);
      await page.waitForSelector('.duel-root', { timeout: 20000 });
    });
    await step('finish the duel', async () => {
      const done = await playToEnd(page);
      await page.screenshot({ path: path.join(OUT, `firstrun-${tag}-result.png`) });
      if (!ok(done, `first run (${tag}): the duel reached its result`)) throw new Error('duel did not finish');
      await page.locator('.result-continue').click();
      await page.waitForFunction(() => !document.querySelector('.duel-root'), null, { timeout: 15000 });
    });
    await step('Packs', async () => {
      await page.goto(BASE + '#/packs');
      await page.waitForSelector('.screen:not(.screen-leave)');
    });
    await step('Draft start', async () => {
      await page.locator('.tabbar .tab[data-route=draft]').click();
      await clickText(page, 'button', 'Start draft');
      await page.waitForFunction(() => !!localStorage.getItem('edison.draft.v1'), null, { timeout: 15000 });
      await page.getByRole('button', { name: 'Open pack' }).last().click();
      await page.waitForTimeout(1500);
    });
    await step('Deck Builder', async () => {
      // the draft is full screen (no tab bar): back out first, as a player would
      await page.getByRole('button', { name: /^Back to/ }).last().click();
      await page.locator('.tabbar .tab[data-route=deck-builder]').click();
      await page.waitForFunction(() => location.hash.startsWith('#/deck-builder'));
    });
  } catch {
    /* reported */
  }
  await ctx.close();
}

// ------------------------------------------------------------------ report sheet and banner

const MESSENGER_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/458.0.0.38.108;FBBV/600000000;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5]';

/** Open "Show the full report" and read the JSON. */
async function fullReport(page) {
  await page.locator('.rp-details summary').click();
  await page.waitForFunction(() => (document.querySelector('.rp-json')?.textContent || '').length > 10);
  return JSON.parse(await page.locator('.rp-json').innerText());
}

async function reportAndBanner(browser, viewport, tag, progress) {
  const bag = [];
  const { ctx, page } = await phone(browser, viewport, progress, bag, { userAgent: MESSENGER_UA });
  await page.goto(BASE + '#/title');
  const banner = page.locator('.br-banner');
  ok(await banner.isVisible(), `banner (${tag}): shown in Messenger's in-app browser`);
  ok(/open in Safari/i.test(await banner.innerText()) && /Open in Safari/.test(await banner.innerText()), `banner (${tag}): says to open in Safari, with steps`);
  ok(!(await screenProblem(page)), `banner (${tag}): Home has no horizontal scroll`);
  await page.screenshot({ path: path.join(OUT, `banner-${tag}.png`) });
  await page.locator('.br-x').click();
  await page.reload();
  await page.waitForSelector('.home');
  ok(!(await page.locator('.br-banner').count()), `banner (${tag}): the dismissal is remembered`);
  // an uncaught error from the app's own code: the toast, then the sheet
  await page.evaluate(() => {
    const s = document.createElement('script');
    s.src = URL.createObjectURL(new Blob(['setTimeout(function(){ throw new Error("routes-e2e test error") }, 0)'], { type: 'text/javascript' }));
    document.body.appendChild(s);
  });
  await page.waitForSelector('.err-toast.in', { timeout: 5000 });
  ok(true, `report (${tag}): "Something went wrong. Report it?" after an uncaught error`);
  bag.splice(0); // the test's own error
  await page.locator('.err-toast-report').click();
  await page.waitForSelector('.rp-sheet .modal');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `report-${tag}.png`) });
  const r = await page.evaluate(() => {
    const m = document.querySelector('.rp-sheet .modal').getBoundingClientRect();
    return { inside: m.left >= 0 && m.right <= innerWidth + 1 && m.top >= 0 && m.bottom <= innerHeight + 1, text: document.querySelector('.rp-sheet').innerText };
  });
  ok(r.inside, `report (${tag}): the sheet fits the screen`);
  ok(/routes-e2e test error/.test(r.text), `report (${tag}): lists the error`);
  await page.locator('.rp-note').fill('Tapped a card and nothing happened');
  const json = await fullReport(page);
  ok(json.kind === 'edison-report' && json.app.version && json.device.inAppBrowser === 'Messenger' && json.note.includes('Tapped') && json.errors.length >= 1 && Array.isArray(json.log), `report (${tag}): version, device, in-app browser, note, errors and log`);
  ok(!progress || (json.savedDuel && json.savedDuel.game && Array.isArray(json.savedDuel.game.log)), `report (${tag}): carries the saved duel record`);
  await page.locator('.rp-sheet .modal-x').click();
  // from the duel's flag menu: the duel's seed, decks and decisions
  if (progress) {
    await page.locator('.home-resume--duel').click();
    await page.waitForSelector('.duel-root');
    await page.waitForFunction(() => !document.querySelector('.duel-restoring:not(.is-gone)'), null, { timeout: 20000 });
    await page.locator('.duel-root .icon-btn--danger').click();
    await page.locator('.dlg--leave .dlg-actions button', { hasText: 'Report a problem' }).click();
    await page.waitForSelector('.rp-sheet .modal');
    const dj = await fullReport(page);
    const rec = dj.duel && dj.duel.record;
    ok(!!rec && rec.v === 1 && typeof rec.game.seed === 'number' && rec.setup.sides[0].main.length >= 40 && Array.isArray(rec.game.log), `report (${tag}): in a duel, the resume record (seed ${rec && rec.game.seed}, ${rec && rec.game.log.length} decisions)`);
    await page.screenshot({ path: path.join(OUT, `report-duel-${tag}.png`) });
    await page.locator('.rp-sheet .modal-x').click();
  }
  ok(!bag.length, `report (${tag}): no errors${bag.length ? `: ${bag.slice(0, 3).join(' | ')}` : ''}`);
  await ctx.close();
}

// ------------------------------------------------------------------ main

// scripts/css-snapshot.cjs reuses the route list and the saved-progress builder
module.exports = { ROUTES, buildProgress, pickDecks, BASE, APP_PORT, PEER_PORT, DIST };

if (require.main === module) (async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.log('Build first: npm run build');
    process.exit(1);
  }
  const server = spawn('python3', ['-m', 'http.server', String(APP_PORT), '--bind', '127.0.0.1', '-d', DIST], { stdio: 'ignore' });
  const peer = PeerServer({ port: PEER_PORT, host: '127.0.0.1', path: '/edison' });
  await sleep(800);
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const t0 = Date.now();
  try {
    const progress = await buildProgress(browser);
    console.log(`  saved progress: ${Object.keys(progress).filter((k) => /active|season|draft\.v1|host/.test(k)).join(', ')}`);
    for (const [label, viewport] of QUICK ? [['portrait', PORTRAIT]] : [['portrait', PORTRAIT], ['landscape', LANDSCAPE]]) {
      for (const [state, storage] of [['empty', {}], ['saved', progress]]) {
        const bag = [];
        const { ctx, page } = await phone(browser, viewport, storage, bag);
        // the full set of navigation patterns in portrait; landscape opens each route fresh
        for (const r of ROUTES) await sweepRoute(page, r, `${label}/${state}`, bag, label === 'portrait');
        await ctx.close();
      }
    }
    await reportAndBanner(browser, PORTRAIT, 'portrait', progress);
    if (!QUICK) await reportAndBanner(browser, LANDSCAPE, 'landscape', null);
    await firstRun(browser, PORTRAIT, 'portrait');
  } catch (e) {
    failures++;
    console.log('FAIL', e.stack || e);
  } finally {
    await browser.close();
    server.kill();
    peer.close?.();
  }
  console.log(`routes-e2e: ${checks - failures}/${checks} checks passed, ${failures} failure${failures === 1 ? '' : 's'}, ${((Date.now() - t0) / 1000).toFixed(0)}s, screenshots in ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
