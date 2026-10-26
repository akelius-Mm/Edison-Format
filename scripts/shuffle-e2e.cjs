// Hand shuffle (fidget.ts) in a real duel (Playwright, Chromium, iPhone 13 portrait 390×844, touch).
//
// On your own turn, waiting in Main Phase 1: a sideways swipe across your hand shuffles it the locals way — the
// leftmost card is held, then one at a time from the right-hand end each card travels across to the left and lands on
// top of it (the hand does not close up first; the held card ends at the back), then the stack fans back out in the
// original order. The opponent's turn looks the same.
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
 * Returns whether the rightmost card travelled across to the held (leftmost) card while the next card was still out
 * in the fan (one at a time from the side, not closing the hand up first), whether the held card stayed near its own
 * place, and whether cards landed on top of it and it was still underneath just before the stack fanned out.
 */
function summarize(res) {
  const { frames, n, cw } = res;
  const near = (f, i) => Math.abs(f[i].x - f[0].x) < cw * 0.4;
  const oneAtATime = frames.some((f) => near(f, n - 1) && Math.abs(f[n - 2].x - f[0].x) > cw * 0.9);
  const heldMove = Math.max(...frames.map((f) => Math.abs(f[0].x - frames[0][0].x))) / cw;
  const top = (f) => f[0].z >= Math.max(...f.map((p) => p.z));
  // the last frame before the fan opens: every card on the stack (all z-indexes 80+)
  const last = frames.filter((f) => Math.min(...f.map((p) => p.z)) >= 80).pop();
  return { n, oneAtATime, heldMove, buried: frames.some((f) => !top(f)), staysBack: !!last && !top(last) };
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
    check(mine.oneAtATime, `cards travel one at a time from the right side onto the held card on your own turn (${mine.n} cards)`);
    check(mine.heldMove < 0.3, `the held (leftmost) card stays at its place (moved ${mine.heldMove.toFixed(2)} card widths)`);
    check(mine.buried && mine.staysBack, 'they land on top of the held card, which ends at the back');
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
    check(opp.oneAtATime, `cards travel one at a time from the right side onto the held card (${opp.n} cards)`);
    check(opp.heldMove < 0.3, `the held (leftmost) card stays at its place (moved ${opp.heldMove.toFixed(2)} card widths)`);
    check(opp.buried && opp.staysBack, 'they land on top of the held card, which ends at the back');
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
