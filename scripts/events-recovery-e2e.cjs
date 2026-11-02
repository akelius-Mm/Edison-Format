// Events crash-loop recovery (Playwright, Chromium, iPhone 13 portrait) against the built app.
//
// Live report: on iPhone Safari #/events?view=run crashed the tab over and over ("A problem repeatedly
// occurred"): whatever kills the page while the event opens or a saved duel is restored runs again on
// every reopen. This drives a real event with a duel in progress, saves it, then reopens it with the
// saved state changed the ways that matter:
//   A. duel saved by an older build (no build stamp), moves intact: it resumes into the duel
//   B. duel saved by an older build whose moves no longer replay: "Saved by an older version", the
//      game starts over (never replayed again)
//   C. the last restore of this game never finished (the app died during it): "Couldn't restore this
//      duel", the game starts over instead of replaying into the same crash
//   D. the app died while the event was opening / pairing: a recovery screen, "Try again" opens it
//   E. a damaged event save (impossible top cut): a recovery screen, "Abandon event" clears it
// Every case: no page errors, the page stays responsive, memory stays small.
//
// Usage (after `npm run build`): npm run test:events-recovery-e2e
const { chromium, devices } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
  }
})();
const { spawn } = require('child_process');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');
const PORT = 8391;
const BASE = `http://127.0.0.1:${PORT}/`;
const SETTINGS = { 'edison.settings.v1': JSON.stringify({ animationSpeed: 0, sound: false, music: false, haptics: false, confirmEndTurn: false, officialImages: false, playerName: 'Tester', nameChosen: true }), 'edison.hint.hold': '1' };

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

async function phone(browser, storage) {
  const iphone = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  const ctx = await browser.newContext({ ...iphone, viewport: { width: 390, height: 844 } });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem('e2e.seeded')) return;
    sessionStorage.setItem('e2e.seeded', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, storage);
  const page = await ctx.newPage();
  const bag = [];
  page.on('pageerror', (e) => bag.push(`pageerror: ${String(e).slice(0, 300)}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text()) && bag.push(`console: ${m.text().slice(0, 300)}`));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const heapMB = async () => {
    const m = await cdp.send('Performance.getMetrics');
    return m.metrics.find((x) => x.name === 'JSHeapUsedSize').value / 1e6;
  };
  return { ctx, page, bag, heapMB };
}

/** Answer whatever the duel asks with the first sensible choice; end the turn otherwise. */
async function playFor(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.locator('.result.is-open').count()) return 'over';
    const layer = page.locator('.duel-root .dlg-layer.is-open:not(.dlg--leave)').last();
    if (await layer.count()) {
      const btn = layer.locator('.dlg-actions .btn:not([disabled])');
      if (await btn.count()) await btn.first().click({ timeout: 1000 }).catch(() => {});
      else await layer.locator('.tile:not(.is-disabled), .sel-tile').first().click({ timeout: 1000 }).catch(() => {});
    } else if (await page.evaluate(() => !!document.querySelector('.duel-root.awaiting-action'))) {
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
      if (!acted) await page.locator('.duel-root .btn--end:not([disabled])').first().click({ timeout: 1000 }).catch(() => {});
    }
    await page.waitForTimeout(120);
  }
  return 'time';
}

// (without the app-wide open mark, which a dump taken while the app is open always carries)
const dump = (page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k !== 'edison.boot.v1').map((k) => [k, localStorage.getItem(k)])));

/** A Regional with the player's round-1 duel in progress (game 1, some moves made), as saved on the phone. */
async function buildState(browser) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { ctx, page, bag } = await phone(browser, SETTINGS);
    await page.goto(BASE + '#/events?view=checkin&kind=regional');
    await page.locator('button.cta', { hasText: 'Check in' }).first().click({ timeout: 20000 });
    await page.waitForFunction(() => !!localStorage.getItem('edison.events.active.v1'));
    for (let i = 0; i < 4 && !(await page.locator('.duel-root').count()); i++) {
      await page.locator('button.cta', { hasText: /Sit down|Play match/ }).first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await page.waitForSelector('.duel-root', { timeout: 30000 });
    await playFor(page, 7000);
    const st = await dump(page);
    await ctx.close();
    const duel = JSON.parse(st['edison.duel.active.v1'] || 'null');
    ok(!bag.length, `building the state: no errors${bag.length ? `: ${bag.slice(0, 3).join(' | ')}` : ''}`);
    if (duel && duel.game && duel.game.index === 0 && duel.game.log.length >= 3) return st;
  }
  throw new Error('could not leave a game in progress');
}

/** Open `hash` with `storage`; optionally tap Home's resume card. Returns once `until` shows (or times out). */
async function scenario(browser, name, storage, { hash, tapResume, until, then }) {
  const { ctx, page, bag, heapMB } = await phone(browser, storage);
  try {
    await page.goto(BASE + hash);
    if (tapResume) {
      const card = page.locator('.home-resume--duel').first();
      await card.waitFor({ timeout: 10000 });
      await card.click();
    }
    let shown = true;
    await page.waitForSelector(until, { timeout: 20000 }).catch(() => (shown = false));
    ok(shown, `${name}: ${until} shows`);
    const alive = await Promise.race([page.evaluate(() => true), sleep(5000).then(() => false)]);
    ok(alive, `${name}: page stays responsive`);
    if (shown && then) await then(page);
    const heap = await heapMB();
    ok(heap < 150, `${name}: heap ${heap.toFixed(0)} MB`);
    ok(!bag.length, `${name}: no page errors${bag.length ? `: ${bag.slice(0, 3).join(' | ')}` : ''}`);
    return await dump(page);
  } finally {
    await ctx.close();
  }
}

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '-d', DIST, '--bind', '127.0.0.1'], { stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch();
  try {
    const base = await buildState(browser);
    const duel = JSON.parse(base['edison.duel.active.v1']);
    const run = JSON.parse(base['edison.events.active.v1']);
    ok(duel.live === true && typeof duel.build === 'string', 'the saved duel is live and stamped with the build');
    const withDuel = (f) => {
      const d = JSON.parse(JSON.stringify(duel));
      f(d);
      return { ...base, 'edison.duel.active.v1': JSON.stringify(d) };
    };
    const atRestore = (page) => page.evaluate(() => localStorage.getItem('edison.duel.restoring.v1'));

    // A. older build, moves intact: resumes into the duel (the replay is only guarded, not thrown away)
    await scenario(browser, 'A older build, intact', withDuel((d) => delete d.build), {
      hash: '#/title',
      tapResume: true,
      until: '.duel-root:not(.is-restoring)',
      then: async (page) => {
        ok(!(await page.locator('.inter--restore').count()), 'A: no restore failure');
        const d = await page.evaluate(() => JSON.parse(localStorage.getItem('edison.duel.active.v1')));
        ok(d && typeof d.build === 'string', 'A: the record is re-stamped with this build');
      },
    });

    // B. older build, moves no longer replay: told so, the game starts over
    await scenario(
      browser,
      'B older build, drifted',
      withDuel((d) => {
        delete d.build;
        d.game.log[1].h = 'drifted';
      }),
      {
        hash: '#/title',
        tapResume: true,
        until: '.inter--restore [data-restore="older"]',
        then: async (page) => {
          await page.locator('.inter--restore button', { hasText: 'Start this game again' }).click();
          await page.waitForSelector('.duel-root', { timeout: 20000 });
          const d = await page.evaluate(() => JSON.parse(localStorage.getItem('edison.duel.active.v1')));
          ok(d && d.game && d.game.seed !== duel.game.seed, 'B: the game restarts with a new seed (the old moves are dropped)');
        },
      },
    );

    // C. the last restore never finished (the page died during it): no second replay
    const mark = JSON.stringify({ key: duel.tag.key, index: duel.game.index, seed: duel.game.seed, at: Date.now() - 5000 });
    await scenario(browser, 'C interrupted restore', { ...base, 'edison.duel.restoring.v1': mark }, {
      hash: '#/title',
      tapResume: true,
      until: '.inter--restore [data-restore="interrupted"]',
      then: async (page) => {
        ok(!(await atRestore(page)), 'C: the mark is cleared');
        await page.locator('.inter--restore button', { hasText: 'Start this game again' }).click();
        await page.waitForSelector('.duel-root', { timeout: 20000 });
        const d = await page.evaluate(() => JSON.parse(localStorage.getItem('edison.duel.active.v1')));
        ok(d && d.game && d.game.seed !== duel.game.seed && d.game.index === 0, 'C: game 1 starts over');
      },
    });

    // D. the app died while the event was opening or pairing: recovery, then Try again opens it
    const crashed = JSON.stringify({ scope: `events:${run.id}`, what: 'pairing round 2', at: Date.now() - 5000 });
    const noDuel = { ...base };
    delete noDuel['edison.duel.active.v1'];
    await scenario(browser, 'D crashed while pairing', { ...noDuel, 'edison.crashguard.v1': crashed }, {
      hash: '#/events?view=run',
      until: '[data-test=event-recovery]',
      then: async (page) => {
        ok(/pairing round 2/.test(await page.locator('[data-test=event-recovery]').innerText()), 'D: says what was running');
        await page.locator('button.cta', { hasText: 'Try again' }).click();
        await page.waitForSelector('.ev-run', { timeout: 10000 });
        ok(true, 'D: Try again opens the event');
      },
    });

    // E. a damaged event save: no Try again, Abandon clears it
    // (the duel was left with "Leave and save", so the app opens where it was instead of on Home)
    const damaged = { ...withDuel((d) => (d.live = false)), 'edison.events.active.v1': JSON.stringify({ ...run, topCut: 12 }) };
    const after = await scenario(browser, 'E damaged save', damaged, {
      hash: '#/events?view=run',
      until: '[data-test=event-recovery]',
      then: async (page) => {
        ok(!(await page.locator('button.cta', { hasText: 'Try again' }).count()), 'E: no Try again for a damaged save');
        await page.locator('[data-test=event-abandon]').click();
        await page.locator('.modal button', { hasText: 'Abandon' }).click();
        await page.waitForFunction(() => !localStorage.getItem('edison.events.active.v1'), null, { timeout: 5000 });
        ok(!/view=run/.test(page.url()), 'E: back on the Events hub');
      },
    });
    ok(!after['edison.events.active.v1'] && !after['edison.duel.active.v1'], 'E: the event and its saved duel are gone');

    // F. the app was killed while on the event screen (the open mark is still there): it opens on Home,
    // says so, and turns music off and official card scans off for this launch only (the setting stays on: the mats,
    // sleeves and cards are official art, and losing it for good left everything on the drawn art)
    const killed = { ...withDuel((d) => (d.live = false)), 'edison.boot.v1': JSON.stringify({ hash: '#/events?view=run', at: Date.now() }) };
    killed['edison.settings.v1'] = JSON.stringify({ ...JSON.parse(killed['edison.settings.v1']), music: true, officialImages: true });
    await scenario(browser, 'F killed on screen', killed, {
      hash: '#/events?view=run',
      until: '.ui-toast',
      then: async (page) => {
        ok(/#\/title/.test(page.url()), `F: opens on Home (${page.url()})`);
        ok(/closed unexpectedly/.test(await page.locator('.ui-toast').first().textContent()), 'F: says the app closed unexpectedly');
        const st = await page.evaluate(() => JSON.parse(localStorage.getItem('edison.settings.v1')));
        ok(st.music === false, 'F: music is off');
        ok(st.officialImages === true, 'F: the official images setting stays on (paused for this launch only)');
        ok(/until you reopen/.test(await page.locator('.ui-toast').first().textContent()), 'F: says card images come back on reopen');
        ok(!!(await page.locator('.home-resume--duel').count()), 'F: the duel can still be resumed from Home');
      },
    });
  } catch (e) {
    ok(false, `run: ${String(e).split('\n')[0]}`);
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log(`Events recovery e2e: ${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
