// Playwright check for side decking between best-of-3 games (iPhone 13, portrait and landscape).
//  A: concede game 1 of a Bo3 vs AI with a tournament deck that has a Side Deck: the siding
//     screen opens; swaps keep counts, the summary and reset work, long-press reads a card.
//  B: reload in the middle of siding: Home's card resumes to the siding screen with the swaps.
//  C: Done -> go-first choice -> game 2 starts with the sided deck (40 cards, sided-in cards drawn).
//  D: landscape 844x390 layout, and "Skip siding" is one tap.
//  E: Settings off: no siding screen.
// Playwright is not a project dependency: run with a globally installed copy against a build, e.g.
//   npm run build && python3 -m http.server -d dist 5191 &
//   NODE_PATH=$(npm root -g) node scripts/siding-e2e.cjs http://localhost:5191/ /tmp/siding-shots
const { chromium, devices } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
  }
})();
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:5191/';
const OUT = process.argv[3] || require('os').tmpdir() + '/edison-siding-shots';
fs.mkdirSync(OUT, { recursive: true });
const MY_DECK = 'premade:t-sjc-edison-1st';

const errors = [];
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

async function newPage(browser, { landscape = false, settings = {} } = {}) {
  const iphone = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  if (landscape) iphone.viewport = { width: 844, height: 390 };
  const ctx = await browser.newContext({ ...iphone, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR|ygoprodeck|ERR_TUNNEL|ERR_PROXY/i.test(t)) return; // card art from the web is blocked here
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.evaluate(
    ({ s, deck }) => {
      localStorage.clear();
      localStorage.setItem('edison.settings.v1', JSON.stringify({ animationSpeed: 0.15, sound: false, music: false, confirmEndTurn: false, officialImages: false, ...s }));
      localStorage.setItem('edison.settings.musicOn.v1', 'true');
      localStorage.setItem('edison.settings.artOn.v1', 'true');
      localStorage.setItem('edison.settings.firstDraw.v1', 'true');
      localStorage.setItem('edison.hint.hold', '1');
      localStorage.setItem('edison.duelSetup.v1', JSON.stringify({ myDeck: deck, oppDeck: 'premade:lightsworn', persona: { name: 'Rei Mori', avatar: 'a1', difficulty: 'easy' }, bestOf: 3 }));
    },
    { s: settings, deck: MY_DECK },
  );
  await page.reload(); // settings are read once at start
  return { ctx, page };
}

async function startVsAI(page) {
  await page.goto(BASE + '#/duel');
  await page.locator('.flow-step-btn').nth(1).click();
  await page.locator('button.cta', { hasText: 'Duel' }).last().click();
  await page.waitForSelector('.duel-root');
}

const isAwaiting = (page) => page.evaluate(() => !!document.querySelector('.duel-root.awaiting-action'));
async function untilMyAction(page, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isAwaiting(page)) return;
    const layer = page.locator('.duel-root .dlg-layer.is-open:not(.dlg--leave) .dlg-actions .btn:not([disabled])');
    if (await layer.count()) await layer.first().click({ timeout: 1000 }).catch(() => {});
    await page.waitForTimeout(150);
  }
  throw new Error('timed out waiting for my action');
}

/** Concede the current game and continue from its result screen. */
async function concedeGame(page) {
  await untilMyAction(page);
  await page.locator('.duel-root .icon-btn--danger').click();
  await page.locator('.dlg--leave .btn', { hasText: 'Concede' }).click();
  await page.waitForSelector('.result.is-open');
  await page.locator('.result-continue').click();
}

const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('edison.duel.active.v1') || 'null'));
const statusText = (page) => page.locator('.sd-status').innerText();
const countsText = (page) => page.locator('.sd-counts').innerText();

/** No element wider than the viewport (no sideways page scroll). */
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Swap n cards: each time an original Main Deck card for an original Side card. */
async function swapCards(page, n, orig) {
  const names = [];
  for (let i = 0; i < n; i++) {
    const pick = await page.evaluate((o) => {
      const tiles = (sec) => [...document.querySelectorAll(`.sd-sec--${sec} .sd-tile`)];
      const m = tiles('main').findIndex((t) => o.main.includes(t.dataset.id) && !o.side.includes(t.dataset.id));
      return m;
    }, orig);
    if (pick < 0) break;
    await page.locator('.sd-sec--main .sd-tile').nth(pick).click();
    const sideIdx = await page.evaluate((o) => [...document.querySelectorAll('.sd-sec--side .sd-tile')].findIndex((t) => t.classList.contains('can') && o.side.includes(t.dataset.id) && !o.main.includes(t.dataset.id)), orig);
    if (sideIdx < 0) {
      await page.locator('.sd-sec--main .sd-tile.sel').click();
      break;
    }
    const side = page.locator('.sd-sec--side .sd-tile').nth(sideIdx);
    names.push(await side.getAttribute('aria-label'));
    await side.click();
    await page.waitForTimeout(60);
  }
  return names;
}
const origOf = (rec) => ({ main: rec.setup.sides[0].main, side: rec.setup.sides[0].side });

(async () => {
  const browser = await chromium.launch();

  // ------------------------------------------------ A-C: portrait
  {
    const { ctx, page } = await newPage(browser);
    await startVsAI(page);
    await concedeGame(page);
    await page.waitForSelector('.sd', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/a1-siding-portrait.png` });
    const title = await page.locator('.sd-title').innerText();
    ok(/Side Deck/.test(title) && /Game 2/.test(title), `A: siding screen after game 1 ("${title.replace(/\s+/g, ' ')}")`);
    const s0 = await saved(page);
    const orig = origOf(s0);
    const want = `Main ${orig.main.length} · Extra ${s0.setup.sides[0].extra.length} · Side 15`;
    ok((await countsText(page)) === want, `A: counts ${await countsText(page)}`);
    ok(/You lost game 1/.test(await page.locator('.sd-sub').innerText()), 'A: shows the game 1 result');
    ok((await page.locator('.sd-opp').innerText()).includes('Rei Mori'), 'A: shows the opponent');
    ok((await overflow(page)) <= 0, 'A: no sideways scroll at 390px');
    ok(s0 && s0.siding && s0.siding.index === 1 && !s0.game, 'A: the record says siding for game 2');
    ok(s0 && Array.isArray(s0.setup.sides[0].side) && s0.setup.sides[0].side.length === 15, 'A: the record keeps the original Side Deck');
    ok(s0 && s0.played && s0.played[0] && s0.played[0].decks, 'A: the record keeps game 1 decks');

    // select a card: compatible side cards light up
    await page.locator('.sd-sec--main .sd-tile').first().click();
    ok((await page.locator('.sd-sec--side .sd-tile.can').count()) > 0, 'A: selecting a Main card highlights Side cards it can swap with');
    ok(/tap a Side card/.test(await statusText(page)), `A: hint "${await statusText(page)}"`);
    await page.screenshot({ path: `${OUT}/a2-selected.png` });
    await page.locator('.sd-sec--main .sd-tile').first().click(); // deselect
    // two swaps, then a summary
    const two = await swapCards(page, 2, orig);
    const sum = await statusText(page);
    ok(two.length === 2 && /\+\d/.test(sum) && /−\d/.test(sum), `A: summary after 2 swaps: "${sum}"`);
    ok((await countsText(page)) === want, `A: counts kept: ${await countsText(page)}`);
    // reset
    await page.locator('.sd-reset').click();
    ok(/No swaps/.test(await statusText(page)), 'A: Reset to original undoes the swaps');
    // long-press reads a card
    const tile = page.locator('.sd-sec--side .sd-tile').first();
    const box = await tile.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await page.waitForSelector('.card-zoom', { timeout: 3000 }).catch(() => {});
    ok((await page.locator('.card-zoom').count()) > 0, 'A: long-press zooms the card');
    await page.screenshot({ path: `${OUT}/a3-zoom.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok((await page.locator('.sd-tile.sel').count()) === 0, 'A: long-press does not select');

    // many swaps, so a sided-in card shows up in game 2's opening hand
    const swapped = await swapCards(page, 15, orig);
    const sum2 = await statusText(page);
    ok(swapped.length >= 10, `A: swapped ${swapped.length} cards: ${sum2.slice(0, 120)}`);
    await page.screenshot({ path: `${OUT}/a4-swapped.png` });
    const s1 = await saved(page);
    ok(s1 && s1.siding && s1.siding.deck.main.length === orig.main.length && s1.siding.deck.side.length === 15, 'A: swaps are saved as they are made');

    // B: reload in the middle of siding
    await page.reload();
    await page.waitForSelector('.home-resume--duel', { timeout: 10000 });
    const card = (await page.locator('.home-resume--duel').innerText()).replace(/\s+/g, ' ');
    ok(/Siding/.test(card) || /Game 2/.test(card), `B: Home card: ${card}`);
    await page.locator('.home-resume--duel').click();
    await page.waitForSelector('.sd', { timeout: 10000 });
    const sum3 = await statusText(page);
    ok(sum3 === sum2, `B: resumed to the siding screen with the same swaps`);
    await page.screenshot({ path: `${OUT}/b1-resumed-siding.png` });
    const sidedIn = await page.evaluate(() => [...document.querySelectorAll('.sd-sec--main .sd-tile.new')].map((t) => t.getAttribute('aria-label').split(',')[0]));

    // C: Done -> choice -> game 2
    await page.locator('.sd-done').click();
    await page.waitForSelector('.inter');
    const s2 = await saved(page);
    ok(s2 && s2.siding && s2.siding.done, 'C: siding marked done before the go-first choice');
    await page.screenshot({ path: `${OUT}/c1-choice.png` });
    // reload at the choice: siding is not asked again
    await page.reload();
    await page.locator('.home-resume--duel').click();
    await page.waitForSelector('.inter, .sd', { timeout: 10000 });
    ok((await page.locator('.sd').count()) === 0 && (await page.locator('.inter').count()) === 1, 'C: a reload at the go-first choice keeps the sided deck and goes back to the choice');
    await page.locator('.inter .cta', { hasText: 'Go first' }).click();
    await page.waitForSelector('.duel-root');
    await untilMyAction(page);
    await page.waitForTimeout(500);
    const g2 = await saved(page);
    ok(g2 && g2.game && g2.game.index === 1 && g2.game.decks && g2.game.decks[0].main.length === orig.main.length, 'C: game 2 is saved with its sided decks');
    const sideIds = new Set(s0.setup.sides[0].side);
    const inGame = g2 && g2.game.decks[0].main.filter((id) => sideIds.has(id) && !s0.setup.sides[0].main.includes(id));
    ok(inGame && inGame.length >= 10, `C: game 2 Main Deck holds ${inGame && inGame.length} sided-in cards`);
    const info = await page.evaluate(() => {
      const root = document.querySelector('.duel-root');
      const me = [...root.querySelectorAll('[data-p="0"]')];
      const deckN = me.map((z) => z.querySelector('.zone--deck .pile-count')).find(Boolean)?.textContent ?? '';
      const hand = [...root.querySelectorAll('.dc[data-place="hand"]')].filter((e) => !e.classList.contains('is-opp') && !e.classList.contains('dc-ghost'));
      return { deckN, hand: hand.map((e) => (e.textContent || '').trim().slice(0, 60)) };
    });
    console.log('    game 2 deck pile', info.deckN, 'hand', JSON.stringify(info.hand));
    const handHasSided = info.hand.some((t) => sidedIn.some((n) => t.includes(n)));
    ok(handHasSided, `C: a sided-in card is in game 2's hand (${sidedIn.slice(0, 4).join(', ')} …)`);
    await page.screenshot({ path: `${OUT}/c2-game2.png` });
    // resume mid game 2 restores the same sided decks
    await page.reload();
    await page.locator('.home-resume--duel').click();
    await page.waitForSelector('.duel-root');
    await page.waitForFunction(() => !document.querySelector('.duel-restoring:not(.is-gone)'), null, { timeout: 30000 });
    await untilMyAction(page, 15000);
    const restoreFailed = await page.locator('.inter--restore').count();
    ok(!restoreFailed, 'C: game 2 resumes exactly after a reload');
    // game 3: siding starts from the game 2 deck
    await concedeGame(page);
    await page.waitForSelector('.sd, .result', { timeout: 10000 }).catch(() => {});
    const done = await page.locator('.res-headline, .results').count();
    ok(done > 0 || (await page.locator('.sd').count()) === 0, 'C: conceding game 2 (0–2) ends the match');
    await ctx.close();
  }

  // ------------------------------------------------ D: landscape + skip, and game 3 from the game 2 deck
  {
    const { ctx, page } = await newPage(browser, { landscape: true });
    await startVsAI(page);
    await concedeGame(page);
    await page.waitForSelector('.sd', { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/d1-siding-landscape.png` });
    ok((await overflow(page)) <= 0, 'D: no sideways scroll at 844x390');
    const vis = await page.evaluate(() => {
      const r = (s) => document.querySelector(s)?.getBoundingClientRect();
      const done = r('.sd-done');
      const body = r('.sd-body');
      return { done: done && done.bottom <= innerHeight && done.top >= 0, body: body && body.left > innerWidth * 0.25 };
    });
    ok(vis.done && vis.body, 'D: landscape keeps Done on screen with the deck on the right');
    await swapCards(page, 1, origOf(await saved(page)));
    await page.locator('.sd-skip').click();
    await page.waitForSelector('.inter');
    const s = await saved(page);
    ok(s && s.siding && s.siding.done && JSON.stringify(s.siding.deck.main) === JSON.stringify(s.played[0].decks[0].main), 'D: Skip siding keeps last game’s deck');
    await page.screenshot({ path: `${OUT}/d2-choice-landscape.png` });
    await ctx.close();
  }

  // ------------------------------------------------ E: Settings off
  {
    const { ctx, page } = await newPage(browser, { settings: { sideDecking: false } });
    await startVsAI(page);
    await concedeGame(page);
    await page.waitForSelector('.inter, .sd', { timeout: 10000 });
    ok((await page.locator('.sd').count()) === 0, 'E: side decking off: straight to the go-first choice');
    await ctx.close();
  }

  await browser.close();
  ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
