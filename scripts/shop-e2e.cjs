// Card Shop and trades (Playwright, Chromium, iPhone 13 portrait 390×844), against the built app in dist/ served by
// python3 -m http.server:
//  1. Home shows the Card Shop and Trades tiles.
//  2. Glass case: the page never scrolls sideways; buying a bulk single pays its price and adds the card.
//  3. Sell: selling a card pays the buylist price.
//  4. Trade: an offer worth too little is refused with how much is missing; enough DP gets the deal, and the card
//     leaves the regular's binder.
//
// Usage (after `npm run build`; Playwright is not a project dependency):
//   node scripts/shop-e2e.cjs [outDir]
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

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'edison-shop-shots');
const ROOT = path.join(__dirname, '..');
const APP_PORT = 8391;
const BASE = `http://127.0.0.1:${APP_PORT}/`;
const VIEW = { width: 390, height: 844 };
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? '✓' : '✗'} ${msg}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => Number(String(s).replace(/[^\d]/g, ''));

async function waitHttp(url) {
  for (let i = 0; i < 60; i++) {
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

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1);

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(APP_PORT), '-d', 'dist', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    await waitHttp(BASE);
    const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '#/title');
    await page.evaluate(() => localStorage.setItem('edison.settings.v1', JSON.stringify({ playerName: 'Tester', nameChosen: true })));
    await page.reload();
    await sleep(800);

    console.log('Collection');
    await page.locator('.tabbar .tab[data-route=collection]').click();
    await page.waitForSelector('.collection-screen');
    check(await page.locator('.home-tile', { hasText: 'Card Shop' }).count() === 1, 'Card Shop tile');
    check(await page.locator('.home-tile', { hasText: 'Trades' }).count() === 1, 'Trades tile');

    console.log('Glass case');
    await page.locator('.home-tile', { hasText: 'Card Shop' }).click();
    await page.waitForSelector('.sh-feat-card');
    check(await noSideScroll(page), 'no sideways scrolling at phone width');
    await page.screenshot({ path: path.join(OUT, 'shop-case.png') });
    await page.fill('.sh-search input', 'pot of avarice');
    await sleep(300);
    const dp0 = num(await page.locator('.dp-chip b').first().innerText());
    const cost = num(await page.locator('.sh-print b').first().innerText());
    await page.locator('.sh-print').first().click();
    await sleep(400);
    const dp1 = num(await page.locator('.dp-chip b').first().innerText());
    check(dp1 === dp0 - cost, `buying a single pays its price (${dp0} → ${dp1}, cost ${cost})`);
    check(/you have \d/.test(await page.locator('.sh-row').first().innerText()), 'the row shows the copies you now have');

    console.log('Sell');
    await page.getByRole('radio', { name: 'Sell' }).click();
    await page.waitForSelector('.sh-row--sell');
    check(await noSideScroll(page), 'no sideways scrolling');
    await page.screenshot({ path: path.join(OUT, 'shop-sell.png') });
    // sell the cheapest card in the list (no confirmation needed)
    const sell = page.locator('.sh-row--sell .sh-sell').last();
    const pay = num(await sell.innerText());
    const dp2 = num(await page.locator('.dp-chip b').first().innerText());
    await sell.click();
    await sleep(400);
    check(num(await page.locator('.dp-chip b').first().innerText()) === dp2 + pay, `selling pays ${pay} DP`);

    console.log('Trade');
    await page.getByRole('radio', { name: 'Trade' }).click();
    await page.waitForSelector('.sh-trader');
    check((await page.locator('.sh-trader').count()) >= 9, 'every regular is at the trade table');
    await page.screenshot({ path: path.join(OUT, 'shop-traders.png') });
    await page.locator('.sh-trader', { hasText: 'Felix' }).click();
    await page.waitForSelector('.sh-pocket');
    check(await noSideScroll(page), 'no sideways scrolling on the trade table');
    // the cheapest card in their binder (the last pocket), so the starting DP can cover it
    const pick = page.locator('.sh-pocket').last();
    const name = await pick.getAttribute('data-name');
    await pick.scrollIntoViewIfNeeded();
    await pick.click();
    check(await pick.getAttribute('aria-pressed') === 'true', 'tapping a pocket picks the card');
    await page.getByRole('button', { name: 'Offer trade' }).click();
    await sleep(300);
    check(/short|add a little/i.test(await page.locator('.sh-reply').innerText()), 'nothing for something is refused, with how much is missing');
    await page.screenshot({ path: path.join(OUT, 'trade-refused.png') });
    for (let i = 0; i < 40; i++) {
      if ((await page.locator('.sh-meter span').getAttribute('class'))?.includes('ok')) break;
      await page.getByRole('button', { name: '+100' }).click();
    }
    await page.getByRole('button', { name: 'Offer trade' }).click();
    await page.getByRole('button', { name: 'Trade', exact: true }).click();
    await sleep(500);
    check(/sweet|deal/i.test(await page.locator('.sh-reply').innerText()), 'enough DP gets the deal');
    check(!(await page.locator(`.sh-pocket[data-name="${name}"]`).count()), `${name} left their binder`);
    await page.screenshot({ path: path.join(OUT, 'trade-done.png') });

    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    await ctx.close();
  } catch (e) {
    console.log('  ✗', e);
    failures++;
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  console.log(`Screenshots: ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
