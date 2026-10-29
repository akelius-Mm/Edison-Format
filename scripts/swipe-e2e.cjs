// Swipe up to play (Playwright, Chromium, iPhone 13 portrait 390×844 with touch; a landscape pass at 844×390).
//
//  1. Duel (dev harness, /duel-dev.html on the Vite dev server), real touch drags (CDP touch events):
//     - a plain tap on a hand card still opens its action menu (and Set from it still plays)
//     - a sideways drag (the hand shuffle), a downward drag and a short upward drag that stops below the
//       commit line play nothing, open nothing, and leave the card back in the hand
//     - swiping up a monster with two actions (a vanilla monster: Normal Summon / Set) opens the same menu a tap does
//     - swiping up a monster with one action (Dark Armed Dragon with 3 DARK in the GY) plays it at once (its
//       Special Summon then asks for a position)
//     - swiping up a card with no action shows the menu with the reason, the card stays in hand
//     - landscape: a swipe up on a playable card plays it or opens its menu
//  2. Built app (dist/, python3 -m http.server): Settings → Gameplay has "Swipe up to play" (on), and the
//     Guide mentions the gesture.
//
// Usage (after `npm run build`; Playwright is not a project dependency):
//   node scripts/swipe-e2e.cjs [outDir]          SHOT=<png path> also saves the mid-drag screenshot there
const { chromium } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
  }
})();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'edison-swipe-shots');
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(__dirname, '..');
const DEV_PORT = 5318;
const APP_PORT = 8385;
const VIEW = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const IGNORED = /Failed to load resource|net::ERR|ygoprodeck|ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION/i;

let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHttp(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`server did not start: ${url}`);
}

async function duelPage(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript(() => {
    localStorage.setItem('edison.settings.v1', JSON.stringify({ animationSpeed: 0.5, sound: false, music: false, officialImages: false }));
    localStorage.setItem('edison.hint.hold', '1');
    localStorage.setItem('edison.hint.shuffle', '1');
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.test(m.text())) errors.push(m.text());
  });
  await page.goto(`http://127.0.0.1:${DEV_PORT}/duel-dev.html?first=0&seed=7&ai=easy`);
  await waitMyPrompt(page, 60000);
  await sleep(600);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors };
}

/** Back at your Main Phase 1 play prompt (a "respond?" prompt on the way is passed). */
async function waitMyPrompt(page, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ready = await page.evaluate(() => {
      const ctl = window.__duelCtl;
      return !!(ctl && ctl.game.turnPlayer === ctl.me && ctl.game.phase === 'main1' && document.querySelector('.duel-root.awaiting-action') && !document.querySelector('.dc-moving'));
    });
    if (ready) return;
    const pass = page.locator('.dlg-layer:not(.is-closing) button', { hasText: /^\s*Pass/ });
    if (await pass.count()) await pass.first().click().catch(() => {});
    await sleep(200);
  }
  const what = await page.evaluate(() => [[...document.querySelectorAll('.dlg-layer')].map((e) => e.className + ' ' + [...e.querySelectorAll('button')].map((b) => b.outerHTML.slice(0, 120)).join(' ')).join(' ;; '), window.__duelCtl.game.phase, document.querySelector('.duel-root').className].join(' / '));
  throw new Error(`timed out waiting for your Main Phase prompt (${what})`);
}

/** A point (CSS px) where the hand card `uid` is the topmost card, low on the card (hand cards overlap). */
const pointOn = (page, uid) =>
  page.evaluate((uid) => {
    const el = document.querySelector(`.hand-me .dc[data-uid="${uid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    for (const fy of [0.35, 0.25, 0.5, 0.15])
      for (const fx of [0.2, 0.12, 0.3, 0.45, 0.6, 0.8]) {
        const x = r.left + r.width * fx;
        const y = Math.min(r.top + r.height * fy, innerHeight - 4);
        const hit = document.elementFromPoint(x, y)?.closest('.dc');
        if (hit && hit.dataset.uid === String(uid)) return { x, y };
      }
    return null;
  }, uid);

/** A touch drag from `from` by (dx, dy) in `steps` moves; `mid` runs before the finger lifts. */
async function drag(cdp, from, dx, dy, { steps = 14, mid } = {}) {
  const pt = (k) => [{ x: from.x + (dx * k) / steps, y: from.y + (dy * k) / steps, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(0) });
  for (let k = 1; k <= steps; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(k) });
    await sleep(16);
  }
  await sleep(60);
  if (mid) await mid();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const where = (page, uid) => page.evaluate((uid) => window.__duelCtl.game.card(uid)?.location, uid);
const menuOpen = (page) => page.evaluate(() => !!document.querySelector('.ctx-menu'));
const closeMenu = async (page) => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelector('.ctx-menu') && document.querySelector('.duel-mat')?.click());
  await sleep(250);
};
/** The card is settled back in the hand: no drag transform, no drop-target glow. */
const settled = (page, uid) =>
  page.evaluate((uid) => {
    const el = document.querySelector(`.hand-me .dc[data-uid="${uid}"]`);
    return !!el && !el.classList.contains('is-swiping') && !el.style.transform && !document.querySelector('.side-me.swipe-drop');
  }, uid);
/** Upward travel that takes a finger from `from` well into your half of the board. */
const upToField = (page, from) =>
  page.evaluate((y0) => {
    const r = document.querySelector('.side-me').getBoundingClientRect();
    return r.top + r.height * 0.45 - y0;
  }, from.y);

async function duelCheck(browser) {
  console.log('Swipe up to play (duel, portrait)');
  const { ctx, page, cdp, errors } = await duelPage(browser, VIEW);
  check(await page.evaluate(() => document.querySelector('.duel-root').classList.contains('swipe-play')), 'swipe up to play is on by default');
  const ids = await page.evaluate(() => {
    const ctl = window.__duelCtl;
    const g = ctl.game;
    const me = ctl.me;
    const C = g.allCards[0].constructor;
    const add = (name, loc, opts) => {
      const c = g.registerCard(new C(window.__cardByName(name), me));
      c.location = 'none';
      g.rawMove(c, loc, { controller: me, ...opts });
      return c;
    };
    // a Spell/Trap from the opening hand, whose actions are already offered: Set by tapping it
    const old = g.zone(me, 'hand').find((c) => (c.isSpell || c.isTrap) && c.data.stype !== 'field');
    for (const c of [...g.zone(me, 'mzone')]) g.rawMove(c, 'grave', {});
    for (let i = 0; i < 3; i++) add('Sangan', 'grave', { faceUp: true });
    const dad = add('Dark Armed Dragon', 'hand', { faceUp: true });
    const trooper = add('Dev Brute', 'hand', { faceUp: true });
    const second = add('Morphing Jar', 'hand', { faceUp: true });
    g.update();
    return { old: old ? old.uid : -1, dad: dad.uid, trooper: trooper.uid, second: second.uid };
  });
  check(ids.old >= 0, 'a Spell/Trap in the opening hand');
  await sleep(500);

  // 1) a plain tap still opens the menu; Set from it (the next prompt then offers the cards added above)
  await page.locator(`.hand-me [data-uid="${ids.old}"]`).first().tap();
  await page.waitForSelector('.ctx-menu', { timeout: 5000 });
  check(true, 'a tap on a hand card opens its menu');
  await page.locator('.ctx-menu .ctx-item:not(.is-disabled)', { hasText: /^Set$/ }).first().tap();
  await page.waitForFunction((uid) => window.__duelCtl.game.card(uid).location === 'szone', ids.old, { timeout: 15000 });
  check(true, 'Set from the tap menu plays the card');
  await waitMyPrompt(page);
  await sleep(700);

  const start = await pointOn(page, ids.trooper);
  check(!!start, 'Dev Brute can be touched in the hand');
  const mz = () => page.evaluate(() => window.__duelCtl.game.zone(window.__duelCtl.me, 'mzone').length);

  // 2) sideways: the hand shuffle, never a play
  await drag(cdp, start, 130, -6);
  await sleep(1800);
  check((await where(page, ids.trooper)) === 'hand' && (await mz()) === 0, 'a sideways drag plays nothing');
  check(!(await menuOpen(page)), 'a sideways drag opens no menu');
  check(await settled(page, ids.trooper), 'after a sideways drag the card sits in the hand');

  // 3) downwards
  const p2 = await pointOn(page, ids.trooper);
  await drag(cdp, p2, 0, 60, { steps: 8 });
  await sleep(500);
  check((await where(page, ids.trooper)) === 'hand' && !(await menuOpen(page)), 'a downward drag plays nothing and opens no menu');
  check(await settled(page, ids.trooper), 'after a downward drag the card sits in the hand');

  // 4) a short lift that stops below the commit line: back into the hand
  const p3 = await pointOn(page, ids.trooper);
  let liftedShort = false;
  await drag(cdp, p3, 0, -28, {
    steps: 6,
    mid: async () => {
      liftedShort = await page.evaluate((uid) => document.querySelector(`.hand-me .dc[data-uid="${uid}"]`).classList.contains('is-swiping'), ids.trooper);
    },
  });
  check(liftedShort, 'a short upward drag lifts the card');
  await sleep(600);
  check((await where(page, ids.trooper)) === 'hand' && !(await menuOpen(page)), 'let go below the line: nothing is played, no menu');
  check(await settled(page, ids.trooper), 'the card settles back into the hand');

  // 5) two actions (Normal Summon / Set): the tap menu opens
  const p4 = await pointOn(page, ids.trooper);
  await drag(cdp, p4, 4, await upToField(page, p4));
  await page.waitForSelector('.ctx-menu', { timeout: 5000 }).catch(() => {});
  const menuText = (await page.locator('.ctx-menu').count()) ? await page.locator('.ctx-menu').innerText() : '';
  check(/Normal Summon/.test(menuText) && /\bSet\b/.test(menuText), `two actions: the menu offers them (${menuText.replace(/\n+/g, ' | ')})`);
  check((await where(page, ids.trooper)) === 'hand', 'nothing was played before picking');
  await sleep(500);
  check(await settled(page, ids.trooper), 'the card went back to the hand under the menu');
  await page.locator('.ctx-menu .ctx-item:not(.is-disabled)', { hasText: /Normal Summon/ }).first().tap();
  await page.waitForFunction((uid) => window.__duelCtl.game.card(uid).location === 'mzone', ids.trooper, { timeout: 15000 });
  check(true, 'Normal Summon from that menu summons it');
  await waitMyPrompt(page);
  await sleep(700);

  // 6) one action (Dark Armed Dragon: 3 DARK in the GY; no Tribute Summon with one monster): played at once
  const p5 = await pointOn(page, ids.dad);
  const up5 = await upToField(page, p5);
  let armed = false;
  await drag(cdp, p5, 6, up5, {
    mid: async () => {
      armed = await page.evaluate(() => !!document.querySelector('.side-me.swipe-drop.is-armed'));
      await page.screenshot({ path: path.join(OUT, 'swipe-mid-drag.png') });
      if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    },
  });
  check(armed, 'mid-drag: your half of the board is highlighted as the drop target');
  // played at once: a Special Summon asks only for its battle position
  const posDlg = page.locator('.dlg-layer:not(.is-closing)', { hasText: /Choose a position for Dark Armed Dragon/ });
  await posDlg.waitFor({ timeout: 8000 }).catch(() => {});
  check((await posDlg.count()) > 0, 'one action: the Special Summon starts at once (it asks for a position)');
  if (await posDlg.count()) await posDlg.getByText('Attack Position').first().tap();
  await page.waitForFunction((uid) => window.__duelCtl.game.card(uid).location === 'mzone', ids.dad, { timeout: 15000 }).catch(() => {});
  check((await where(page, ids.dad)) === 'mzone', 'one action: swiping Dark Armed Dragon up Special Summons it');
  check(!(await menuOpen(page)), 'no menu for a single action');
  await waitMyPrompt(page);
  await sleep(700);
  const fieldEl = await page.evaluate((uid) => {
    const el = document.querySelector(`.dc[data-uid="${uid}"]`);
    return el ? { place: el.dataset.place, swiping: el.classList.contains('is-swiping'), transform: el.style.transform } : null;
  }, ids.dad);
  check(!!fieldEl && fieldEl.place === 'mzone' && !fieldEl.swiping && !fieldEl.transform, 'the card on the field carries no drag transform');

  // 7) no action (Normal Summon used): back to the hand, the reason shows
  const p6 = await pointOn(page, ids.second);
  await drag(cdp, p6, 0, await upToField(page, p6));
  await page.waitForSelector('.ctx-menu', { timeout: 5000 }).catch(() => {});
  const why = (await page.locator('.ctx-menu .ctx-item.is-disabled').count()) ? await page.locator('.ctx-menu .ctx-item.is-disabled').first().innerText() : '';
  check(!!why, `no action: the menu says why (${why.replace(/\n+/g, ' / ')})`);
  check((await where(page, ids.second)) === 'hand', 'the card stays in the hand');
  await sleep(500);
  check(await settled(page, ids.second), 'and settles back into it');
  await closeMenu(page);

  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await ctx.close();
}

async function landscapeCheck(browser) {
  console.log('Swipe up to play (duel, landscape)');
  const { ctx, page, cdp, errors } = await duelPage(browser, LANDSCAPE);
  const uid = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.hand-me .dc.can-act')].pop();
    return el ? Number(el.dataset.uid) : -1;
  });
  check(uid >= 0, 'a playable card in hand');
  const p = await pointOn(page, uid);
  check(!!p, 'it can be touched');
  if (p) {
    await drag(cdp, p, 0, await upToField(page, p));
    await sleep(800);
    const res = await page.evaluate((uid) => ({ menu: !!document.querySelector('.ctx-menu'), loc: window.__duelCtl.game.card(uid).location }), uid);
    check(res.menu || res.loc !== 'hand', `a swipe up plays it or opens its menu (${res.menu ? 'menu' : res.loc})`);
    await page.screenshot({ path: path.join(OUT, 'swipe-landscape.png') });
  }
  check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await ctx.close();
}

async function settingsCheck(browser) {
  console.log('Settings and Guide (built app)');
  const server = spawn('python3', ['-m', 'http.server', String(APP_PORT), '--bind', '127.0.0.1', '-d', path.join(ROOT, 'dist')], { stdio: 'ignore' });
  try {
    const BASE = `http://127.0.0.1:${APP_PORT}/`;
    await waitHttp(BASE);
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '#/settings');
    const row = page.locator('.ios-row', { hasText: 'Swipe up to play' }).first();
    await row.waitFor({ timeout: 15000 });
    const sw = row.locator('input[type="checkbox"], [role="switch"]').first();
    const on = async () => (await sw.getAttribute('aria-checked')) === 'true' || (await sw.isChecked().catch(() => false));
    check(await on(), 'Settings has "Swipe up to play", on by default');
    await sw.click({ force: true });
    await sleep(200);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('edison.settings.v1') || '{}').swipeToPlay);
    check(saved === false, 'switching it off is saved');
    await page.goto(BASE + '#/guide');
    await page.waitForTimeout(800);
    check(/Swipe a card up/.test(await page.locator('body').innerText()), 'the Guide mentions swiping a card up');
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  } finally {
    server.kill();
  }
}

(async () => {
  const browser = await chromium.launch();
  const vite = spawn('npx', ['vite', '--port', String(DEV_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  try {
    await waitHttp(`http://127.0.0.1:${DEV_PORT}/duel-dev.html`);
    await duelCheck(browser);
    await landscapeCheck(browser);
    await settingsCheck(browser);
  } catch (e) {
    console.log('  ✗', e);
    failures++;
  } finally {
    vite.kill();
    await browser.close();
  }
  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  console.log(`Screenshots: ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
