// "Why can't I" reasons + the Rules updates note (Playwright, Chromium, iPhone 13 portrait 390×844).
//
//  1. Duel (dev harness, /duel-dev.html on the Vite dev server): Brain Control in hand with only a face-down monster on
//     the opponent's field → tapping it shows a disabled row with the Brain Control reason.
//  2. Home (built app in dist/, served by python3 -m http.server): the one-time "Rules updates" card is one line, opens the list,
//     is dismissed for good, and Settings → Rules updates opens the full list.
//
// Usage (after `npm run build`; Playwright is not a project dependency):
//   node scripts/whynot-e2e.cjs [outDir]
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

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'edison-whynot-shots');
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(__dirname, '..');
const DEV_PORT = 5317;
const APP_PORT = 8384;
const VIEW = { width: 390, height: 844 };

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

async function duelCheck(browser) {
  console.log('Brain Control reason (duel)');
  const vite = spawn('npx', ['vite', '--port', String(DEV_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  try {
    await waitHttp(`http://127.0.0.1:${DEV_PORT}/duel-dev.html`);
    const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2, hasTouch: true });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${DEV_PORT}/duel-dev.html?first=0&seed=7&ai=easy`);
    await page.waitForFunction(() => {
      const ctl = window.__duelCtl;
      return ctl && ctl.game.turnPlayer === ctl.me && ctl.game.phase === 'main1' && document.querySelector('.duel-root.awaiting-action');
    }, null, { timeout: 60000 });
    await sleep(600);
    const uid = await page.evaluate(() => {
      const ctl = window.__duelCtl;
      const g = ctl.game;
      const me = ctl.me;
      const opp = 1 - me;
      for (const c of [...g.zone(opp, 'mzone')]) g.rawMove(c, 'grave', {});
      const C = g.allCards[0].constructor;
      const add = (name, p, loc, opts) => {
        const c = g.registerCard(new C(window.__cardByName(name), p));
        c.location = 'none';
        g.rawMove(c, loc, { controller: p, ...opts });
        return c;
      };
      add('Sangan', opp, 'mzone', { faceUp: false, pos: 'def' });
      const bc = add('Brain Control', me, 'hand', { faceUp: true });
      g.update();
      return bc.uid;
    });
    await sleep(500);
    const card = page.locator(`[data-uid="${uid}"]`).first();
    await card.click();
    await page.waitForSelector('.ctx-menu', { timeout: 5000 });
    await sleep(300);
    const text = await page.locator('.ctx-menu').innerText();
    check(/Activate: opponent has no face-up monster/.test(text), 'the menu says in one line why Brain Control can\'t be used');
    const rowH = await page.locator('.ctx-menu .ctx-item.is-disabled').first().boundingBox();
    check(!!rowH && rowH.height <= 90, `the reason row is short (${rowH && Math.round(rowH.height)}px)`);
    const enabled = await page.locator('.ctx-menu .ctx-item:not(.is-disabled)').allInnerTexts();
    check(!enabled.some((t) => /^Activate/.test(t.trim())), 'no Activate action is offered');
    const box = await page.locator('.ctx-menu').boundingBox();
    check(!!box && box.x >= 0 && box.x + box.width <= VIEW.width, 'the menu fits on the screen');
    await page.screenshot({ path: path.join(OUT, 'brain-control-reason.png') });

    // Enemy Controller with only Summoner Monk (can't be Tributed): "Change battle position" is offered, and the
    // missing "Tribute: take control" gets a disabled row saying why.
    await page.keyboard.press('Escape');
    await sleep(300);
    const ecUid = await page.evaluate(() => {
      const ctl = window.__duelCtl;
      const g = ctl.game;
      const me = ctl.me;
      for (const c of [...g.zone(me, 'mzone')]) g.rawMove(c, 'grave', {});
      const C = g.allCards[0].constructor;
      const add = (name, p, loc, opts) => {
        const c = g.registerCard(new C(window.__cardByName(name), p));
        c.location = 'none';
        g.rawMove(c, loc, { controller: p, ...opts });
        return c;
      };
      add('Summoner Monk', me, 'mzone', { faceUp: true, pos: 'def' });
      add('Stardust Dragon', 1 - me, 'mzone', { faceUp: true, pos: 'atk' });
      // a Spell/Trap that was already in hand when this prompt's actions were worked out (it can be Set)
      const old = g.zone(me, 'hand').find((c) => (c.isSpell || c.isTrap) && c.data.stype !== 'field');
      const ec = add('Enemy Controller', me, 'hand', { faceUp: true });
      g.update();
      return [ec.uid, old ? old.uid : -1];
    });
    const [ecUidN, stormUid] = ecUid;
    check(stormUid >= 0, 'a Spell/Trap in the starting hand to Set');
    await sleep(500);
    // The offered actions were worked out before Enemy Controller arrived: Set that Spell/Trap so the next prompt
    // is computed with Enemy Controller in hand.
    await page.locator(`[data-uid="${stormUid}"]`).first().click();
    await page.waitForSelector('.ctx-menu', { timeout: 5000 });
    await page.locator('.ctx-menu .ctx-item:not(.is-disabled)', { hasText: /^Set$/ }).first().click();
    await page.waitForFunction(
      (uid) => {
        const ctl = window.__duelCtl;
        const c = ctl.game.card(uid);
        return c && c.location === 'szone' && document.querySelector('.duel-root.awaiting-action');
      },
      stormUid,
      { timeout: 20000 },
    );
    await sleep(800);
    await page.locator(`[data-uid="${ecUidN}"]`).first().click();
    await page.waitForSelector('.ctx-menu', { timeout: 5000 });
    await sleep(300);
    const ecEnabled = (await page.locator('.ctx-menu .ctx-item:not(.is-disabled)').allInnerTexts()).join(' | ');
    const ecDisabled = (await page.locator('.ctx-menu .ctx-item.is-disabled').allInnerTexts()).join(' | ');
    check(/Change battle position/.test(ecEnabled), `Change battle position is offered (${ecEnabled.replace(/\n/g, ' ')})`);
    check(
      /Tribute: take control: your monster can't be Tributed/.test(ecDisabled) && /Summoner Monk/.test(ecDisabled),
      `a disabled row says why Tribute: take control is missing (${ecDisabled.replace(/\n/g, ' ')})`,
    );
    check(!/Tribute: take control/.test(ecEnabled), 'Tribute: take control is not offered');
    const ecBox = await page.locator('.ctx-menu').boundingBox();
    check(!!ecBox && ecBox.x >= 0 && ecBox.x + ecBox.width <= VIEW.width, 'the menu fits on the screen');
    await page.screenshot({ path: path.join(OUT, 'enemy-controller-reason.png') });
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await page.close();
  } finally {
    vite.kill();
  }
}

async function homeCheck(browser) {
  console.log('Rules updates (Home + Settings)');
  const server = spawn('python3', ['-m', 'http.server', String(APP_PORT), '--bind', '127.0.0.1', '-d', path.join(ROOT, 'dist')], { stdio: 'ignore' });
  try {
    const BASE = `http://127.0.0.1:${APP_PORT}/`;
    await waitHttp(BASE);
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '#/title');
    const card = page.locator('.rn-card');
    await card.waitFor({ timeout: 15000 });
    check(/Rules updates/.test(await card.innerText()), 'the Rules updates card is on Home');
    await page.screenshot({ path: path.join(OUT, 'rules-updates-home.png') });
    const h = (await card.boundingBox()).height;
    check(h <= 80, `the card is one compact row (${Math.round(h)}px tall)`);
    check(!/Brain Control/.test(await card.innerText()), 'no rulings text on Home');
    await card.locator('.rn-open').click();
    await page.waitForSelector('.rn-sheet', { timeout: 5000 });
    await sleep(300);
    const sheet = page.locator('.rn-sheet');
    check(!(await sheet.getByText(/Brain Control can take any/).isVisible()), 'decks start collapsed in the sheet');
    await sheet.locator('.rn-group summary').first().click();
    await sleep(300);
    check(await sheet.getByText(/Brain Control can take any/).isVisible(), 'tapping a deck shows its changes');
    await page.screenshot({ path: path.join(OUT, 'rules-updates-home-open.png') });
    await page.locator('.modal').getByRole('button', { name: 'Done' }).click();
    await sleep(400);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(sw <= 0, 'no horizontal scroll');
    await card.locator('.rn-x').click();
    await sleep(400);
    check((await page.locator('.rn-card').count()) === 0, 'dismissed');
    await page.reload();
    await page.waitForSelector('.home', { timeout: 15000 });
    await sleep(300);
    check((await page.locator('.rn-card').count()) === 0, 'stays dismissed after a reload');
    await page.goto(BASE + '#/settings');
    await page.getByText('Rules updates', { exact: true }).first().click();
    await page.waitForSelector('.rn-sheet', { timeout: 5000 });
    await sleep(300);
    check(/Gladiator Beasts/.test(await page.locator('.rn-sheet').innerText()), 'Settings → Rules updates opens the list');
    await page.screenshot({ path: path.join(OUT, 'rules-updates-settings.png') });
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  } finally {
    server.kill();
  }
}

(async () => {
  const browser = await chromium.launch();
  try {
    await homeCheck(browser);
    await duelCheck(browser);
  } catch (e) {
    console.log('  ✗', e);
    failures++;
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  console.log(`Screenshots: ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
