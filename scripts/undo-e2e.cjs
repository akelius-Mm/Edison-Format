// Playwright check of Undo for misclicks in a Duel vs AI (iPhone 13 viewport, Chromium), against the
// built app served by `python3 -m http.server -d dist <port>`.
//  - no Undo button before the first play
//  - Normal Summon a monster from hand: Undo appears (when nothing fair-breaking happened: if the AI
//    was asked to respond, the duel is restarted and tried again)
//  - tap Undo: the board equals the board before the summon (card back in hand), "Undone" toast,
//    the saved duel's decision log lost the summon, and the summon can be made again
//  - after ending the turn (the AI has played), no Undo
// Usage: node scripts/undo-e2e.cjs http://localhost:5181/ /tmp/undo-shots   (VIEW=desktop|landscape for other layouts)
const { chromium, devices } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
  }
})();
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:5181/';
const OUT = process.argv[3] || require('os').tmpdir() + '/edison-undo-shots';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

async function newPage(browser) {
  const iphone = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  // VIEW=desktop / VIEW=landscape check the other layouts
  const view = process.env.VIEW === 'desktop' ? { viewport: { width: 1280, height: 800 } } : process.env.VIEW === 'landscape' ? { ...iphone, viewport: { width: 844, height: 390 } } : iphone;
  const ctx = await browser.newContext(view);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR|ygoprodeck|ERR_TUNNEL|ERR_PROXY/i.test(t)) return;
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('edison.settings.v1', JSON.stringify({ animationSpeed: 0.15, sound: false, confirmEndTurn: false }));
    localStorage.setItem('edison.hint.hold', '1');
    localStorage.setItem(
      'edison.duelSetup.v1',
      JSON.stringify({ myDeck: 'premade:blackwings', oppDeck: 'premade:lightsworn', persona: { name: 'Rei Mori', avatar: 'a1', difficulty: 'easy' }, bestOf: 1 }),
    );
  });
  return { ctx, page };
}

async function startVsAI(page) {
  await page.goto(BASE + '#/duel');
  await page.locator('.flow-step-btn').nth(1).click();
  await page.locator('button.cta', { hasText: 'Duel' }).last().click();
  await page.waitForSelector('.duel-root');
}

const sig = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.duel-root:not(.is-undo-cover)');
    if (!root) return null;
    const cards = [...root.querySelectorAll('.dc[data-uid]')]
      .filter((e) => !e.classList.contains('dc-ghost'))
      .map((e) => {
        const zone = e.closest('[data-p]');
        return [zone?.className.split(' ')[0] ?? '', zone?.dataset.p ?? '', e.dataset.place, e.classList.contains('is-def') ? 'def' : '', e.classList.contains('is-set') ? 'set' : '', (e.textContent || '').trim().slice(0, 60)].join('|');
      })
      .sort();
    const lp = [...root.querySelectorAll('.pp-lp')].map((e) => e.textContent);
    const phase = root.querySelector('.phasebar-turn')?.textContent ?? '';
    const cur = root.querySelector('.ph.is-current')?.dataset.phase ?? '';
    return { lp, phase, cur, cards };
  });

const isAwaiting = (page) => page.evaluate(() => !!document.querySelector('.duel-root:not(.is-undo-cover).awaiting-action'));
const openPrompt = (page) =>
  page.evaluate(() => {
    const l = [...document.querySelectorAll('.duel-root .dlg-layer.is-open')].find((x) => !x.classList.contains('dlg--leave'));
    return l ? l.querySelector('.dlg-title')?.textContent ?? '?' : null;
  });
const undoVisible = (page) => page.evaluate(() => {
  const b = document.querySelector('.duel-root:not(.is-undo-cover) [data-test="undo"]');
  return !!b && !b.hidden && b.getBoundingClientRect().width > 0;
});
const savedLog = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('edison.duel.active.v1') || 'null')?.game?.log?.length ?? -1);

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
  const opt = layer.locator('button.pos-opt, button.opt, .dlg-body button');
  if (await opt.count()) await opt.first().click({ timeout: 1000 }).catch(() => {});
  await page.locator('.duel-root .dlg-layer.is-open .dlg-actions .btn:not([disabled])').first().click({ timeout: 1000 }).catch(() => {});
}

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

/** Normal Summon the first monster in hand that offers it; returns its face text or null. */
async function normalSummon(page) {
  const hand = page.locator('.duel-root .dc.can-act[data-place="hand"]');
  const n = await hand.count();
  for (let i = 0; i < n; i++) {
    const text = ((await hand.nth(i).textContent()) || '').trim().slice(0, 60);
    const label = text.split('\n')[0].trim();
    await hand.nth(i).click();
    const item = page.locator('.ctx-menu .ctx-item', { hasText: /^Normal Summon/ });
    if (await item.count()) {
      await item.first().click();
      return { text, label };
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('.zoom-close, .zoom-backdrop').first().click({ timeout: 300 }).catch(() => {});
  }
  return null;
}

(async () => {
  const browser = await chromium.launch();
  const { page } = await newPage(browser);
  let done = false;
  for (let attempt = 1; attempt <= 8 && !done; attempt++) {
    await startVsAI(page);
    if ((await untilMyAction(page)) !== 'action') continue;
    await page.waitForTimeout(500);
    if (attempt === 1) ok(!(await undoVisible(page)), 'no Undo before the first play');
    const before = await sig(page);
    const logBefore = await savedLog(page);
    await page.screenshot({ path: `${OUT}/1-before-summon.png` });
    const picked = await normalSummon(page);
    if (!picked) {
      console.log(`attempt ${attempt}: no monster to Normal Summon, new duel`);
      await restart(page);
      continue;
    }
    const name = picked.label;
    if ((await untilMyAction(page)) !== 'action') continue;
    await page.waitForTimeout(500);
    const summoned = await sig(page);
    const logSummoned = await savedLog(page);
    if (!(await undoVisible(page))) {
      console.log(`attempt ${attempt}: Undo not offered after summoning ${name} (the AI was asked / something was revealed), new duel`);
      await restart(page);
      continue;
    }
    await page.screenshot({ path: `${OUT}/2-after-summon-undo-visible.png` });
    ok(JSON.stringify(summoned) !== JSON.stringify(before), `summoned ${name}`);
    ok(logSummoned > logBefore, `saved log grew ${logBefore} -> ${logSummoned}`);
    const t0 = Date.now();
    await page.locator('.duel-root:not(.is-undo-cover) [data-test="undo"]').click();
    await page.waitForFunction(() => !document.querySelector('.duel-root.is-undo-cover') && document.querySelector('.duel-root.awaiting-action'), null, { timeout: 10000 });
    const ms = Date.now() - t0;
    const toastSeen = await page.evaluate(() => [...document.querySelectorAll('.duel-root .toast')].some((t) => /Undone/.test(t.textContent || '')));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/3-after-undo.png` });
    const after = await sig(page);
    ok(JSON.stringify(after) === JSON.stringify(before), `board after Undo equals the board before the summon (${before.cards.length} cards) in ${ms} ms`);
    if (JSON.stringify(after) !== JSON.stringify(before)) console.log(JSON.stringify(before), '\n', JSON.stringify(after));
    ok(after.cards.some((c) => c.includes('|hand|') && c.endsWith(picked.text)), `${name} is back in hand`);
    ok(toastSeen, '"Undone" toast');
    ok((await page.locator('.duel-root').count()) === 1, 'one duel board on screen');
    ok((await savedLog(page)) === logBefore, `saved log back to ${logBefore} decisions`);
    ok(!(await undoVisible(page)) || logBefore > 0, 'Undo hidden when nothing earlier is undoable (or an earlier play is)');
    // the summon is available again
    const again = await normalSummon(page);
    ok(again && again.label === name, `can Normal Summon ${name} again`);
    await untilMyAction(page);
    await page.waitForTimeout(400);
    // a second play on top of a logged one: Set a Spell/Trap, Undo replays the summon underneath
    const st = await setSpellTrap(page);
    if (st) {
      await untilMyAction(page);
      await page.waitForTimeout(400);
      const logSet = await savedLog(page);
      const mid = await sig(page);
      if (await undoVisible(page)) {
        await page.locator('.duel-root:not(.is-undo-cover) [data-test="undo"]').click();
        await page.waitForFunction(() => !document.querySelector('.duel-root.is-undo-cover') && document.querySelector('.duel-root.awaiting-action'), null, { timeout: 10000 });
        await page.waitForTimeout(300);
        const back = await sig(page);
        ok(back.cards.some((c) => c.includes('|mzone|') && c.endsWith(picked.text)), `undo of the Set keeps the summoned ${name} on the field`);
        ok(back.cards.some((c) => c.includes('|hand|') && c.endsWith(st)), `the Set card is back in hand`);
        ok((await savedLog(page)) === logSet - 1 && logSet - 1 > 0, `saved log ${logSet} -> ${logSet - 1} (replayed instantly)`);
        ok(JSON.stringify(back) !== JSON.stringify(mid), 'board changed back');
        await page.screenshot({ path: `${OUT}/3b-after-second-undo.png` });
      } else console.log('(Undo not offered after the Set: skipped the second undo)');
    }
    // end the turn: once the AI has played, nothing can be undone
    for (let k = 0; k < 4; k++) {
      const end = page.locator('.duel-root .btn--end:not([disabled])');
      if (await end.count()) {
        await end.first().click();
        break;
      }
      const battle = page.locator('.duel-root .btn--phase:not([disabled])').last();
      await battle.click().catch(() => {});
      await untilMyAction(page);
    }
    if ((await untilMyAction(page)) === 'action') {
      await page.waitForTimeout(400);
      ok(!(await undoVisible(page)), 'no Undo at the start of my next turn');
      await page.screenshot({ path: `${OUT}/4-next-turn-no-undo.png` });
    }
    done = true;
  }
  ok(done, 'an undoable summon happened within 8 duels');
  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})();

/** Set the first Spell/Trap in hand that offers it; returns its face text or null. */
async function setSpellTrap(page) {
  const hand = page.locator('.duel-root .dc.can-act[data-place="hand"]');
  const n = await hand.count();
  for (let i = 0; i < n; i++) {
    const text = ((await hand.nth(i).textContent()) || '').trim().slice(0, 60);
    await hand.nth(i).click();
    const item = page.locator('.ctx-menu .ctx-item', { hasText: /^Set/ });
    if ((await item.count()) && !/ATK\//.test(text)) {
      await item.first().click();
      return text;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('.zoom-close, .zoom-backdrop').first().click({ timeout: 300 }).catch(() => {});
  }
  return null;
}

/** Concede the current duel and get back to the setup screen. */
async function restart(page) {
  await page.evaluate(() => localStorage.removeItem('edison.duel.active.v1'));
  await page.goto(BASE + '#/title');
  await page.reload();
  await page.evaluate(() => localStorage.removeItem('edison.duel.active.v1'));
}
