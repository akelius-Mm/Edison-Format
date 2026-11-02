// Playwright check for resuming duels (iPhone 13 viewport, Chromium), against `npx vite`.
//  A: make a few moves, reload mid-duel, resume from Home's card: the board must match.
//  B: leave (Leave and save) with a decision prompt open: the same prompt comes back.
//  C: leave between Bo3 games: resume at game 2 with the loser's first-player choice.
//  D: a saved log that no longer fits shows "Couldn't restore this duel exactly".
// Playwright is not a project dependency: run with a globally installed copy, e.g.
//   npx vite --port 5179 &  NODE_PATH=$(npm root -g) node scripts/resume-e2e.cjs http://localhost:5179/ /tmp/shots
const { chromium, devices } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
  }
})();
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:5179/';
const OUT = process.argv[3] || require('os').tmpdir() + '/edison-resume-shots';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

async function newPage(browser, extraSettings = {}, bestOf = 1) {
  const iphone = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  const ctx = await browser.newContext(iphone);
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
    ({ s, bestOf }) => {
      localStorage.clear();
      localStorage.setItem('edison.settings.v1', JSON.stringify({ animationSpeed: 0.15, sound: false, confirmEndTurn: false, ...s }));
      localStorage.setItem('edison.settings.musicOn.v1', 'true');
      localStorage.setItem('edison.settings.artOn.v1', 'true');
      localStorage.setItem('edison.hint.hold', '1');
      localStorage.setItem(
        'edison.duelSetup.v1',
        JSON.stringify({ myDeck: 'premade:blackwings', oppDeck: 'premade:lightsworn', persona: { name: 'Rei Mori', avatar: 'a1', difficulty: 'easy' }, bestOf }),
      );
    },
    { s: extraSettings, bestOf },
  );
  return { ctx, page };
}

async function startVsAI(page) {
  await page.goto(BASE + '#/duel');
  await page.locator('.flow-step-btn').nth(1).click();
  await page.locator('button.cta', { hasText: 'Duel' }).last().click();
  await page.waitForSelector('.duel-root');
}

/** Board signature: LP, phase, caption and every card's place / face / position / face text. */
const sig = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.duel-root');
    if (!root) return null;
    const cards = [...root.querySelectorAll('.dc[data-uid]')]
      .filter((e) => !e.classList.contains('dc-ghost'))
      .map((e) => {
        const zone = e.closest('[data-p]');
        return [zone?.className.split(' ')[0] ?? '', zone?.dataset.p ?? '', e.dataset.place, e.classList.contains('is-def') ? 'def' : '', e.classList.contains('is-set') ? 'set' : '', (e.textContent || '').trim().slice(0, 60)].join('|');
      })
      .sort();
    const lp = [...root.querySelectorAll('.pp-lp')].map((e) => e.textContent);
    const phase = root.querySelector('.phasebar, .phase-bar, .duel-right > div:nth-child(2)')?.textContent ?? '';
    const cap = root.querySelector('.duel-caption')?.textContent ?? '';
    return { lp, phase, cap, cards };
  });

const isAwaiting = (page) => page.evaluate(() => !!document.querySelector('.duel-root.awaiting-action'));
/** An open decision prompt (not the leave dialog). */
const openPrompt = (page) =>
  page.evaluate(() => {
    const l = [...document.querySelectorAll('.duel-root .dlg-layer.is-open')].find((x) => !x.classList.contains('dlg--leave'));
    return l ? l.querySelector('.dlg-title')?.textContent ?? '?' : null;
  });

/** Answer whatever prompt is open with its safest choice (pass / no / cancel, else the first). */
async function answerPrompt(page) {
  const layer = page.locator('.duel-root .dlg-layer.is-open:not(.dlg--leave)').last();
  if (!(await layer.count())) return false;
  // card selection: pick candidates until the confirm button enables
  const tiles = layer.locator('.tile:not(.is-disabled), .sel-tile');
  const ghost = layer.locator('.dlg-actions .btn--ghost:not([disabled])');
  if (await ghost.count()) {
    await ghost.first().click({ timeout: 2000 }).catch(() => {});
    return true;
  }
  const primary = layer.locator('.dlg-actions .btn:not([disabled])');
  if (await primary.count()) {
    await primary.first().click({ timeout: 2000 }).catch(() => {});
    return true;
  }
  const n = await tiles.count();
  for (let i = 0; i < n; i++) {
    await tiles.nth(i).click({ timeout: 1000 }).catch(() => {});
    if (await layer.locator('.dlg-actions .btn:not([disabled])').count()) break;
  }
  const opt = layer.locator('button.pos-opt, button.opt, .dlg-body button');
  if (!(await primary.count()) && (await opt.count())) await opt.first().click({ timeout: 1000 }).catch(() => {});
  await page.locator('.duel-root .dlg-layer.is-open .dlg-actions .btn:not([disabled])').first().click({ timeout: 1000 }).catch(() => {});
  return true;
}

/** Run the duel until it waits for my main-phase action, answering prompts on the way. */
async function untilMyAction(page, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.locator('.result.is-open').count()) return 'over';
    if (await isAwaiting(page)) return 'action';
    if (await openPrompt(page)) await answerPrompt(page);
    await page.waitForTimeout(120);
  }
  throw new Error('timed out waiting for my action');
}

/** One move: summon / set a monster from hand if possible, else go to the next phase. */
async function oneMove(page) {
  const hand = page.locator('.duel-root .dc.can-act[data-place="hand"]');
  const n = await hand.count();
  for (let i = 0; i < n; i++) {
    await hand.nth(i).click();
    const item = page.locator('.ctx-menu .ctx-item', { hasText: /Normal Summon|^Set|Activate/ });
    if (await item.count()) {
      await item.first().click();
      return 'card';
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('.zoom-close, .zoom-backdrop').first().click({ timeout: 300 }).catch(() => {});
  }
  const end = page.locator('.duel-root .btn--end:not([disabled])');
  if (await end.count()) {
    await end.first().click();
    return 'end';
  }
  return 'none';
}

/** Between games: once premade decks have Side Decks the siding screen comes first; keep the deck. */
async function skipSiding(page) {
  await page.waitForSelector('.inter, .sd');
  if (await page.locator('.sd').count()) await page.locator('.sd-skip').click();
  await page.waitForSelector('.inter');
}

async function waitRestored(page) {
  await page.waitForSelector('.duel-root');
  await page.waitForFunction(() => !document.querySelector('.duel-restoring:not(.is-gone)'), null, { timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch();

  // ------------------------------------------------ A: reload mid-duel, resume from Home
  {
    const { ctx, page } = await newPage(browser);
    await startVsAI(page);
    let moves = 0;
    for (let k = 0; k < 6 && moves < 3; k++) {
      const st = await untilMyAction(page);
      if (st === 'over') break;
      const r = await oneMove(page);
      if (r === 'card') moves++;
      await page.waitForTimeout(400);
    }
    await untilMyAction(page);
    await page.waitForTimeout(600);
    const before = await sig(page);
    await page.screenshot({ path: `${OUT}/a1-before-reload.png` });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('edison.duel.active.v1') || 'null'));
    ok(!!saved && saved.game && saved.game.log.length > 0, `A: duel saved with ${saved?.game?.log.length} decisions after ${moves} moves`);
    await page.reload();
    await page.waitForSelector('.home-resume--duel', { timeout: 10000 });
    const cardText = await page.locator('.home-resume--duel').innerText();
    ok(/Duel in progress/.test(cardText) && /vs Rei Mori/.test(cardText) && /Turn \d+/.test(cardText) && /Resume/.test(cardText), `A: Home resume card: ${cardText.replace(/\s+/g, ' ')}`);
    ok((await page.evaluate(() => location.hash)) === '#/title', 'A: reopened on Home');
    await page.screenshot({ path: `${OUT}/a2-home-card.png` });
    await page.locator('.home-resume--duel').click();
    await waitRestored(page);
    await untilMyAction(page, 15000);
    await page.waitForTimeout(600);
    const after = await sig(page);
    await page.screenshot({ path: `${OUT}/a3-after-resume.png` });
    ok(JSON.stringify(before) === JSON.stringify(after), `A: board after resume matches (${before.cards.length} cards, LP ${before.lp.join('/')})`);
    if (JSON.stringify(before) !== JSON.stringify(after)) console.log(JSON.stringify(before), '\n', JSON.stringify(after));
    // keep playing after the resume
    await oneMove(page);
    await page.waitForTimeout(500);
    const saved2 = await page.evaluate(() => JSON.parse(localStorage.getItem('edison.duel.active.v1') || 'null'));
    ok(saved2 && saved2.game.log.length >= saved.game.log.length, 'A: decisions keep being saved after resuming');
    // Leave and save from the flag button
    await untilMyAction(page);
    await page.locator('.duel-root .icon-btn--danger').click();
    await page.locator('.dlg--leave .btn', { hasText: 'Leave and save' }).click();
    await page.waitForSelector('.home-resume--duel', { timeout: 10000 });
    ok(!(await page.locator('.duel-root').count()), 'A: Leave and save returns Home with the duel saved');
    await ctx.close();
  }

  // ------------------------------------------------ B: leave in the middle of a prompt
  {
    let ctx, page;
    let prompt = null;
    // the coin toss and draws are random: try a few duels until one reaches an open prompt
    for (let attempt = 0; attempt < 4 && !prompt; attempt++) {
    if (ctx) await ctx.close();
    ({ ctx, page } = await newPage(browser, { responsePrompts: 'always' }));
    await startVsAI(page);
    for (let k = 0; k < 40 && !prompt; k++) {
      // play until a decision prompt is open while no main action is pending
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        if (await page.locator('.result.is-open').count()) break;
        const p = await openPrompt(page);
        if (p && !(await isAwaiting(page))) {
          prompt = p;
          break;
        }
        if (await isAwaiting(page)) break;
        await page.waitForTimeout(100);
      }
      if (prompt || (await page.locator('.result.is-open').count())) break;
      await oneMove(page);
      await page.waitForTimeout(300);
    }
    }
    ok(!!prompt, `B: reached an open prompt: "${prompt}"`);
    if (prompt) {
      await page.waitForTimeout(500);
      const before = await sig(page);
      await page.screenshot({ path: `${OUT}/b1-prompt-before.png` });
      await page.locator('.duel-root .icon-btn--danger').click();
      await page.locator('.dlg--leave .btn', { hasText: 'Leave and save' }).click();
      await page.waitForSelector('.home-resume--duel', { timeout: 10000 });
      await page.reload();
      await page.locator('.home-resume--duel').click();
      await waitRestored(page);
      await page.waitForFunction(() => !!document.querySelector('.duel-root .dlg-layer.is-open'), null, { timeout: 15000 });
      await page.waitForTimeout(600);
      const again = await openPrompt(page);
      const after = await sig(page);
      await page.screenshot({ path: `${OUT}/b2-prompt-after.png` });
      ok(again === prompt, `B: the same prompt is shown again ("${again}")`);
      ok(JSON.stringify(before) === JSON.stringify(after), 'B: board behind the prompt matches');
    }
    await ctx.close();
  }

  // ------------------------------------------------ C: leave between Bo3 games
  {
    const { ctx, page } = await newPage(browser, {}, 3);
    await startVsAI(page);
    await untilMyAction(page);
    await page.locator('.duel-root .icon-btn--danger').click();
    await page.locator('.dlg--leave .btn', { hasText: 'Concede' }).click();
    await page.waitForSelector('.result.is-open');
    await page.locator('.result-continue').click();
    await skipSiding(page);
    const s1 = await page.evaluate(() => JSON.parse(localStorage.getItem('edison.duel.active.v1') || 'null'));
    ok(s1 && s1.games.length === 1 && s1.game === null, 'C: game 1 recorded, between games');
    await page.screenshot({ path: `${OUT}/c1-interstitial.png` });
    await page.reload();
    await page.waitForSelector('.home-resume--duel');
    const card = (await page.locator('.home-resume--duel').innerText()).replace(/\s+/g, ' ');
    ok(/Game 2/.test(card), `C: Home card: ${card}`);
    await page.locator('.home-resume--duel').click();
    await skipSiding(page);
    const msg = await page.locator('.inter-msg').innerText();
    ok(/You lost the previous game/.test(msg), `C: interstitial offers the loser's choice: "${msg}"`);
    await page.locator('.inter .cta', { hasText: 'Go second' }).click();
    await page.waitForSelector('.duel-root');
    const cap = await page.locator('.duel-caption').innerText();
    ok(/Game 2 of 3/.test(cap), `C: game 2 caption "${cap}"`);
    await untilMyAction(page);
    const turnOne = await page.evaluate(() => JSON.parse(localStorage.getItem('edison.duel.active.v1')).game);
    ok(turnOne.first === 1 && turnOne.index === 1, `C: game 2 saved with the AI going first (first=${turnOne.first})`);
    const before = await sig(page);
    await page.reload();
    await page.locator('.home-resume--duel').click();
    await waitRestored(page);
    await untilMyAction(page, 15000);
    await page.waitForTimeout(500);
    const after = await sig(page);
    ok(JSON.stringify(before) === JSON.stringify(after) && /Game 2 of 3/.test(after.cap), 'C: mid game 2 resume matches');
    await page.screenshot({ path: `${OUT}/c2-game2-resumed.png` });
    await ctx.close();
  }

  // ------------------------------------------------ D: a log that no longer fits fails safely
  {
    const { ctx, page } = await newPage(browser);
    await startVsAI(page);
    await untilMyAction(page);
    await oneMove(page);
    await untilMyAction(page);
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('edison.duel.active.v1'));
      d.game.log[0].h = 'corrupt';
      localStorage.setItem('edison.duel.active.v1', JSON.stringify(d));
    });
    await page.reload();
    await page.locator('.home-resume--duel').click();
    await page.waitForSelector('.inter--restore', { timeout: 15000 });
    const txt = (await page.locator('.inter--restore').innerText()).replace(/\s+/g, ' ');
    ok(/Couldn.t restore this duel exactly/.test(txt), `D: restore failure screen: ${txt.slice(0, 90)}`);
    await page.screenshot({ path: `${OUT}/d1-restore-failed.png` });
    await page.locator('.inter--restore .cta').click();
    await page.waitForSelector('.duel-root');
    await untilMyAction(page);
    const d = await page.evaluate(() => JSON.parse(localStorage.getItem('edison.duel.active.v1')));
    ok(d && d.game.index === 0, 'D: the game starts again and is saved');
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
