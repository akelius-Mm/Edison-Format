// Hand shuffle (fidget.ts) in a real duel (Playwright, Chromium, iPhone 13 portrait 390×844, touch).
//
// On your own turn, waiting in Main Phase 1: a sideways swipe across your hand does the Yu-Gi-Oh hand shuffle — the
// hand squares up into a pile on the right, the front card is slid off it into a pile on the left, then the next onto
// that, one at a time, until the whole hand has moved over (the first card slid ends at the back), then the hand fans
// out in its original order. The opponent's turn looks the same.
// A tap on the hand mid-shuffle stops it and selects the tapped card as usual.
//
// Usage (Playwright is not a project dependency):
//   node scripts/shuffle-e2e.cjs [outDir]
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

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'edison-shuffle-shots');
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(__dirname, '..');
const DEV_PORT = 5323;

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

/** Swipe across the middle of my hand with touch events (CDP), left to right. */
async function swipe(page, cdp) {
  const box = await page.locator('.hand-me').boundingBox();
  const y = box.y + box.height * 0.55;
  const x0 = box.x + box.width * 0.3;
  const pt = (x) => [{ x, y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: pt(x0),
  });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: pt(x0 + i * 10),
    });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
}

/** Sample every hand card's on-screen centre (its .dc-fx box) each frame for `ms`. */
function sample(page, ms) {
  return page.evaluate(
    (ms) =>
      new Promise((done) => {
        const hand = document.querySelector('.hand-me');
        const cards = [...hand.children].filter((c) => c.classList.contains('dc') && !c.classList.contains('dc-ghost'));
        const frames = [];
        const t0 = performance.now();
        const tick = () => {
          frames.push(
            cards.map((c) => {
              const r = c.querySelector('.dc-fx').getBoundingClientRect();
              return { x: r.left + r.width / 2, y: r.top + r.height / 2, z: +c.style.zIndex || 0 };
            }),
          );
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else done({ frames, n: cards.length, cw: cards[0].offsetWidth, ch: cards[0].offsetHeight });
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

/**
 * Returns whether the hand squared up into one pile, whether cards were slid one at a time from a right pile into a
 * left pile (the first two slid together on the left while the last was still on the right), and whether the first
 * card slid ended at the back of the new pile.
 */
function summarize(res) {
  const { frames, n, cw } = res;
  const width = (f) => Math.max(...f.map((p) => p.x)) - Math.min(...f.map((p) => p.x));
  const squared = frames.some((f) => width(f) < cw * 0.6);
  const twoPiles = frames.some((f) => Math.abs(f[0].x - f[1].x) < cw * 0.5 && f[n - 1].x - f[1].x > cw * 0.8);
  const top = (f) => f[0].z >= Math.max(...f.map((p) => p.z));
  // the last frame before the fan opens: every card slid over (all z-indexes 80+)
  const last = frames.filter((f) => Math.min(...f.map((p) => p.z)) >= 80).pop();
  return { n, squared, twoPiles, endsAtBack: frames.some((f) => !top(f)) && !!last && !top(last) };
}

(async () => {
  const vite = spawn('npx', ['vite', '--port', String(DEV_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    await waitHttp(`http://127.0.0.1:${DEV_PORT}/duel-dev.html`);
    const ctx = await browser.newContext({
      ...devices['iPhone 13'],
      viewport: { width: 390, height: 844 },
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      try {
        localStorage.setItem('edison.hint.hold', '1');
        localStorage.setItem('edison.hint.shuffle', '1');
      } catch {
        /* ignore */
      }
    });
    await page.goto(`http://127.0.0.1:${DEV_PORT}/duel-dev.html?first=0&seed=7&ai=easy`);
    await page.waitForFunction(
      () => {
        const ctl = window.__duelCtl;
        return ctl && ctl.game.turnPlayer === ctl.me && ctl.game.phase === 'main1' && document.querySelector('.duel-root.awaiting-action');
      },
      null,
      { timeout: 60000 },
    );
    await sleep(800);
    const cdp = await ctx.newCDPSession(page);
    const orderOf = () =>
      page.evaluate(() =>
        [...document.querySelector('.hand-me').children]
          .filter((c) => c.classList.contains('dc'))
          .map((c) => c.dataset.uid)
          .join(','),
      );

    console.log('Your turn (Main Phase 1, waiting for you)');
    const before = await orderOf();
    await swipe(page, cdp);
    const res = await sample(page, 3200);
    const mine = summarize(res);
    check(mine.squared, `the hand squares up into a pile on your own turn (${mine.n} cards)`);
    check(mine.twoPiles, 'cards are slid one at a time from the right pile into a left pile');
    check(mine.endsAtBack, 'the first card slid ends at the back of the new pile');
    fs.writeFileSync(path.join(OUT, 'my-turn-frames.json'), JSON.stringify(res));
    await sleep(600);
    check((await orderOf()) === before, 'the hand ends in its original order');
    check(!(await page.locator('.ctx-menu').count()), 'no card was selected by the swipe');
    check(await page.evaluate(() => !!document.querySelector('.duel-root.awaiting-action')), 'still your move');

    console.log("Opponent's turn (same as yours)");
    await page.evaluate(() => {
      const ctl = window.__duelCtl;
      ctl.__realTurn = ctl.game.turnPlayer;
      ctl.game.turnPlayer = 1 - ctl.me;
    });
    await swipe(page, cdp);
    const opp = summarize(await sample(page, 3200));
    await page.evaluate(() => {
      const ctl = window.__duelCtl;
      ctl.game.turnPlayer = ctl.__realTurn;
    });
    check(opp.squared, `the hand squares up into a pile (${opp.n} cards)`);
    check(opp.twoPiles, 'cards are slid one at a time from the right pile into a left pile');
    check(opp.endsAtBack, 'the first card slid ends at the back of the new pile');
    await sleep(600);
    check((await orderOf()) === before, 'the hand ends in its original order');

    console.log('Tap mid-shuffle');
    await swipe(page, cdp);
    await sleep(250);
    const target = page.locator('.hand-me .dc').nth(1);
    const uid = await target.getAttribute('data-uid');
    const tb = await target.boundingBox();
    await page.touchscreen.tap(tb.x + tb.width * 0.3, tb.y + tb.height * 0.75);
    await sleep(400);
    check(!(await page.evaluate(() => document.getAnimations().filter((a) => a.id === 'fidget').length)), 'the shuffle stops at once');
    const menu = await page.locator('.ctx-menu').count();
    check(menu === 1, 'the tap opens the card menu as usual');
    await page.screenshot({ path: path.join(OUT, 'tap-after-shuffle.png') });
    void uid;
    check((await orderOf()) === before, 'hand order unchanged');
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } catch (e) {
    console.log('  ✗', e);
    failures++;
  } finally {
    await browser.close();
    vite.kill();
  }
  console.log(failures ? `\n${failures} failed` : '\nAll passed');
  console.log(`Screenshots: ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
