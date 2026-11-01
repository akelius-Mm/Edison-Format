// Performance check (Playwright, Chromium): iPhone 13 emulation (390x844), CPU throttled 4x through CDP
// so it roughly matches a phone. Run it against the production build:
//   npm run build && python3 -m http.server -d dist 5301 &
//   NODE_PATH=$(npm root -g) node scripts/perf-check.cjs http://localhost:5301/ /tmp/perf-after.json [--compare /tmp/perf-before.json] [--shots /tmp/perf-shots]
// It measures:
//  - duel pacing: every animation the duel plays (FxDirector), the AI's pacing waits and the idle gaps
//    between steps, over a human-vs-AI duel where a scripted "human" makes simple choices
//    (the page sets window.__fxTrace, which src/ui/duel/fx.ts and human.ts fill in)
//  - tap latency: tap down (CDP touch event) to the first visual change (pressed state, DOM change)
//  - screen transitions: hash change to the new screen painted and the main thread free again
//  - long tasks (PerformanceObserver 'longtask') and frame timing (rAF deltas) during the duel,
//    pack opening and scrolling the Binder and Database
// The result is written as JSON; with --compare it also prints a before/after table.
const { chromium, devices } = (() => {
  try {
    return require('playwright');
  } catch {
    return require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
  }
})();
const fs = require('fs');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const BASE = pos[0] || 'http://localhost:5301/';
const OUT = pos[1] || require('os').tmpdir() + '/edison-perf.json';
const COMPARE = opt('--compare');
const SHOTS = opt('--shots');
const AI_TURNS = Number(opt('--ai-turns') || 4);
const ONLY = (opt('--only') || 'duel,taps,screens,scroll,packs').split(',');
const CPU = Number(opt('--cpu') || 4);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
const log = (...a) => console.log(...a);

// ------------------------------------------------------------------ in-page instrumentation
const INIT = () => {
  // Seeded Math.random so the duel's seed (and with it the whole game) is the same on every run.
  let s = 0x2f6b1d3 >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const P = (window.__perf = { longtasks: [], frames: [], sampling: false });
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.longtasks.push({ t: e.startTime, d: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* unsupported */
  }
  let last = 0;
  const tick = (t) => {
    if (P.sampling && last) P.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__fxTrace = [];
};

async function newPage(browser, viewport) {
  const iphone = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  if (viewport) iphone.viewport = viewport;
  const ctx = await browser.newContext(iphone);
  await ctx.addInitScript(INIT);
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
    // default animation speed: whatever the app ships with
    localStorage.setItem('edison.settings.v1', JSON.stringify({ sound: false, music: false, haptics: false, confirmEndTurn: false, officialImages: false }));
    localStorage.setItem('edison.settings.musicOn.v1', 'true');
    localStorage.setItem('edison.settings.firstDraw.v1', 'true');
    localStorage.setItem('edison.hint.hold', '1');
    localStorage.setItem(
      'edison.duelSetup.v1',
      JSON.stringify({ myDeck: 'premade:blackwings', oppDeck: 'premade:lightsworn', persona: { name: 'Rei Mori', avatar: 'a1', difficulty: 'normal' }, bestOf: 1 }),
    );
  });
  await page.reload();
  await page.waitForSelector('.screen');
  // the app loads its sound samples 1.5 s after launch (once per launch): keep that out of the numbers
  await page.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  return { ctx, page, cdp };
}

const startSampling = (page) =>
  page.evaluate(() => {
    window.__perf.frames = [];
    window.__perf.longtasks = [];
    window.__perf.sampling = true;
    window.__perf.t0 = performance.now();
  });
const stopSampling = (page) =>
  page.evaluate(() => {
    const P = window.__perf;
    P.sampling = false;
    const f = P.frames.slice();
    const lt = P.longtasks.filter((x) => x.t >= P.t0);
    const dur = performance.now() - P.t0;
    const sorted = [...f].sort((a, b) => a - b);
    const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
    return {
      seconds: +(dur / 1000).toFixed(1),
      frames: f.length,
      fps: +(f.length / (dur / 1000)).toFixed(1),
      p95FrameMs: +pct(0.95).toFixed(1),
      jankFrames: f.filter((d) => d > 34).length,
      jankPct: f.length ? +((100 * f.filter((d) => d > 34).length) / f.length).toFixed(1) : 0,
      longTasks: lt.length,
      longTaskMs: Math.round(lt.reduce((a, x) => a + x.d, 0)),
      maxLongTaskMs: Math.round(lt.reduce((a, x) => Math.max(a, x.d), 0)),
      longTasksPerMin: +((lt.length / dur) * 60000).toFixed(1),
    };
  });

// ------------------------------------------------------------------ duel helpers (as in resume-e2e.cjs)
const isAwaiting = (page) => page.evaluate(() => !!document.querySelector('.duel-root.awaiting-action'));
const openPrompt = (page) =>
  page.evaluate(() => {
    const l = [...document.querySelectorAll('.duel-root .dlg-layer.is-open')].find((x) => !x.classList.contains('dlg--leave'));
    return l ? l.querySelector('.dlg-title')?.textContent ?? '?' : null;
  });
async function answerPrompt(page) {
  const layer = page.locator('.duel-root .dlg-layer.is-open:not(.dlg--leave)').last();
  if (!(await layer.count())) return false;
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
async function untilMyAction(page, ms = 240000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.locator('.result.is-open').count()) return 'over';
    if (await isAwaiting(page)) return 'action';
    if (await openPrompt(page)) await answerPrompt(page);
    await page.waitForTimeout(80);
  }
  throw new Error('timed out waiting for my action');
}
/** One move: summon / set a monster or play a card from hand if possible, attack once, else end the turn. */
async function oneMove(page, st) {
  if (!st.played) {
    const hand = page.locator('.duel-root .dc.can-act[data-place="hand"]');
    const n = await hand.count();
    for (let i = 0; i < n; i++) {
      await hand.nth(i).click();
      const item = page.locator('.ctx-menu .ctx-item', { hasText: /Normal Summon|^Set|Activate/ });
      if (await item.count()) {
        await item.first().click();
        st.played = true;
        return 'card';
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.locator('.zoom-close, .zoom-backdrop').first().click({ timeout: 300 }).catch(() => {});
    }
    st.played = true;
  }
  const end = page.locator('.duel-root .btn--end:not([disabled])');
  if (await end.count()) {
    await end.first().click();
    st.played = false;
    return 'end';
  }
  return 'none';
}

function analyseTrace(trace, me) {
  trace.sort((a, b) => a.t0 - b.t0);
  const fx = trace.filter((x) => x.k === 'fx');
  const turns = fx.filter((x) => x.type === 'turn');
  const out = { aiTurns: [], fxByType: {}, gaps: [] };
  for (const f of fx) {
    const d = f.t1 - f.t0;
    const e = (out.fxByType[f.type] ??= { n: 0, total: 0, max: 0 });
    e.n++;
    e.total += d;
    e.max = Math.max(e.max, d);
  }
  for (const e of Object.values(out.fxByType)) e.avg = Math.round(e.total / e.n);
  // gaps: stretches where nothing animates and nothing waits on the player
  const busy = trace.filter((x) => x.k === 'fx' || x.k === 'human').map((x) => [x.t0, x.t1]);
  busy.sort((a, b) => a[0] - b[0]);
  const paces = trace.filter((x) => x.k === 'pace');
  let cur = busy.length ? busy[0][1] : 0;
  for (let i = 1; i < busy.length; i++) {
    const [s, e] = busy[i];
    if (s > cur) {
      const pace = paces.filter((p) => p.t0 >= cur - 1 && p.t1 <= s + 1).reduce((a, p) => a + (p.t1 - p.t0), 0);
      const next = trace.find((x) => (x.k === 'fx' || x.k === 'human') && x.t0 === s);
      out.gaps.push({ at: cur, ms: s - cur, pace: Math.round(pace), before: next ? `${next.k}:${next.type}` : '?' });
    }
    cur = Math.max(cur, e);
  }
  const humanAll = trace.filter((x) => x.k === 'human');
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.player === me) continue;
    const end = turns[i + 1]?.t0;
    if (end == null) continue;
    const inT = (x) => x.t0 >= t.t0 && x.t0 < end;
    const human = humanAll.filter(inT).reduce((a, x) => a + (x.t1 - x.t0), 0);
    const fxs = fx.filter(inT);
    const fxMs = fxs.reduce((a, x) => a + (x.t1 - x.t0), 0);
    const pace = paces.filter(inT).reduce((a, x) => a + (x.t1 - x.t0), 0);
    const gaps = out.gaps.filter((g) => g.at >= t.t0 && g.at < end);
    const by = {};
    for (const x of fxs) by[x.type] = (by[x.type] ?? 0) + (x.t1 - x.t0);
    out.aiTurns.push({
      wall: Math.round(end - t.t0 - human),
      fx: Math.round(fxMs),
      pace: Math.round(pace),
      other: Math.round(end - t.t0 - human - fxMs - pace),
      steps: fxs.length,
      gapsOver120: gaps.filter((g) => g.ms > 120).length,
      top: Object.entries(by)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([k, v]) => `${k} ${Math.round(v)}`),
    });
  }
  return out;
}

async function measureDuel(browser, res) {
  const { ctx, page } = await newPage(browser);
  await page.evaluate(() => (location.hash = '#/duel'));
  await page.locator('.flow-step-btn').nth(1).click();
  await page.locator('button.cta', { hasText: 'Duel' }).last().click();
  await page.waitForSelector('.duel-root');
  await startSampling(page);
  const st = { played: false };
  const t0 = Date.now();
  let aiTurns = 0;
  let over = false;
  let tapHurry = null;
  while (Date.now() - t0 < 420000) {
    const s = await untilMyAction(page);
    if (s === 'over') {
      over = true;
      break;
    }
    aiTurns = await page.evaluate((me) => window.__fxTrace.filter((x) => x.k === 'fx' && x.type === 'turn' && x.player !== me).length, 0);
    if (aiTurns > AI_TURNS) break;
    const r = await oneMove(page, st);
    if (r === 'none') await page.waitForTimeout(200);
  }
  const frames = await stopSampling(page);
  const trace = await page.evaluate(() => window.__fxTrace);
  const me = await page.evaluate(() => (document.querySelector('.side-me')?.dataset.p ? Number(document.querySelector('.side-me').dataset.p) : 0));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/duel-portrait.png` });
  // Duel-board tap latency (hand card -> menu, End Turn button)
  const taps = {};
  if (!over && (await isAwaiting(page))) {
    taps['duel: hand card'] = await tapLatency(page, '.duel-root .hand-me .dc');
    await page.keyboard.press('Escape').catch(() => {});
    await page.mouse.click(5, 400).catch(() => {});
    await page.waitForTimeout(300);
    taps['duel: phase button'] = await tapLatency(page, '.duel-root .phasebar button:not([disabled]), .duel-root .btn--end:not([disabled])', { noRelease: true });
    // tap-to-hurry and fast-forward (only when the build has them)
    if (await page.locator('.duel-ff').count()) tapHurry = await measureHurry(page, me).catch((e) => ({ error: String(e) }));
  }
  await ctx.close();
  const a = analyseTrace(trace, me);
  const allFx = trace.filter((x) => x.k === 'fx');
  const animMs = allFx.filter((x) => x.t1 - x.t0 > 20).map((x) => x.t1 - x.t0);
  const gapsSorted = [...a.gaps].sort((x, y) => y.ms - x.ms);
  res.duel = {
    aiTurnsMeasured: a.aiTurns.length,
    aiTurnAvgMs: Math.round(a.aiTurns.reduce((s, t) => s + t.wall, 0) / Math.max(1, a.aiTurns.length)),
    aiTurnMedianMs: median(a.aiTurns.map((t) => t.wall)),
    aiTurnFxShare: Math.round((100 * a.aiTurns.reduce((s, t) => s + t.fx, 0)) / Math.max(1, a.aiTurns.reduce((s, t) => s + t.wall, 0))),
    aiTurnPaceShare: Math.round((100 * a.aiTurns.reduce((s, t) => s + t.pace, 0)) / Math.max(1, a.aiTurns.reduce((s, t) => s + t.wall, 0))),
    aiTurns: a.aiTurns,
    animCount: animMs.length,
    animAvgMs: Math.round(animMs.reduce((s, x) => s + x, 0) / Math.max(1, animMs.length)),
    animMedianMs: median(animMs),
    animOver600: animMs.filter((x) => x > 600).length,
    fxByType: Object.fromEntries(Object.entries(a.fxByType).map(([k, v]) => [k, { n: v.n, avg: v.avg, max: Math.round(v.max) }])),
    gapsOver120: a.gaps.filter((g) => g.ms > 120).length,
    gapTotalMs: Math.round(a.gaps.reduce((s, g) => s + g.ms, 0)),
    biggestGaps: gapsSorted.slice(0, 6).map((g) => ({ ms: Math.round(g.ms), pace: g.pace, before: g.before })),
    frames,
    taps,
    fastForward: tapHurry,
  };
  log('duel', JSON.stringify(res.duel, null, 1));
}

/**
 * 1) End the turn and tap the board a few times during the AI's turn: how long after each tap the
 *    step that was animating finishes. 2) Next AI turn: hold the fast-forward button throughout.
 */
async function measureHurry(page, me) {
  const out = {};
  const endTurn = async () => {
    const end = page.locator('.duel-root .btn--end:not([disabled])');
    if (!(await end.count())) return false;
    await end.first().click();
    return true;
  };
  // --- tap-to-hurry
  await page.evaluate(() => {
    window.__fxTrace.length = 0;
    window.__taps = [];
    // window capture runs before the board's own handlers (microtasks run between listeners, so a
    // later listener would already see the next step started)
    window.addEventListener('pointerdown', (e) => e.target.closest?.('.duel-center') && window.__taps.push(performance.now()), true);
  });
  if (!(await endTurn())) return null;
  const cdp = await page.context().newCDPSession(page);
  const box = await page.locator('.duel-center').boundingBox();
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(i ? 450 : 700);
    if (await isAwaiting(page)) break;
    if (await openPrompt(page)) await answerPrompt(page);
    const x = box.x + box.width * 0.3;
    const y = box.y + box.height * 0.5;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await cdp.detach();
  if ((await untilMyAction(page).catch(() => 'timeout')) !== 'action') return out;
  const { trace, taps } = await page.evaluate(() => ({ trace: window.__fxTrace.slice(), taps: window.__taps.slice() }));
  const hits = [];
  for (const t of taps) {
    const f = trace.find((x) => x.k === 'fx' && x.t0 <= t && x.t1 >= t);
    if (f) hits.push({ type: f.type, finishedAfterTapMs: Math.round(f.t1 - t), ranBeforeTapMs: Math.round(t - f.t0) });
  }
  out.tapToHurry = { taps: taps.length, hitAnimation: hits.length, avgFinishAfterTapMs: hits.length ? Math.round(hits.reduce((s, h) => s + h.finishedAfterTapMs, 0) / hits.length) : null, hits };
  // --- fast-forward held through the next AI turn
  await page.evaluate(() => (window.__fxTrace.length = 0));
  if (!(await endTurn())) return out;
  const ff = page.locator('.duel-ff');
  // (the End Phase may ask me to discard first)
  for (let t0 = Date.now(); !(await ff.isVisible()); ) {
    if (Date.now() - t0 > 20000) throw new Error('fast-forward button never showed');
    if (await openPrompt(page)) await answerPrompt(page);
    await page.waitForTimeout(50);
  }
  const b = await ff.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  const r = await untilMyAction(page).catch(() => 'timeout');
  await page.mouse.up();
  const tr = await page.evaluate(() => window.__fxTrace.slice());
  const a = analyseTrace(tr, me);
  // the duel may end during this turn: then the turn runs to its last step
  const start = tr.find((x) => x.k === 'fx' && x.type === 'turn' && x.player !== me);
  const fxIn = start ? tr.filter((x) => x.k === 'fx' && x.t0 >= start.t0) : [];
  const humanIn = start ? tr.filter((x) => x.k === 'human' && x.t0 >= start.t0).reduce((s, x) => s + (x.t1 - x.t0), 0) : 0;
  const wall = a.aiTurns[0]?.wall ?? (fxIn.length ? Math.round(fxIn[fxIn.length - 1].t1 - start.t0 - humanIn) : null);
  out.fastForward = { result: r, aiTurnMs: wall, steps: a.aiTurns[0]?.steps ?? fxIn.length, ffStillOnAfter: await page.evaluate(() => document.querySelector('.duel-root').classList.contains('is-ff')) };
  return out;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)]);
}

// ------------------------------------------------------------------ tap latency
/**
 * Touch down on the element (CDP), hold 120 ms, release. The page times touch-down to the first
 * animation frame whose styles (on the target or its ancestors) or DOM differ from before the tap.
 */
async function tapLatency(page, selector, o = {}) {
  const loc = page.locator(selector).first();
  if (!(await loc.count())) return null;
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  if (!box) return null;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 20);
  await page.evaluate(
    ({ x, y }) => {
      const t = document.elementFromPoint(x, y);
      const chain = [];
      for (let e = t, i = 0; e && i < 5; e = e.parentElement, i++) chain.push(e);
      const props = ['transform', 'scale', 'opacity', 'background-color', 'background-image', 'box-shadow', 'filter', 'color', 'border-color', 'outline-style'];
      const snap = () => chain.map((e) => props.map((p) => getComputedStyle(e).getPropertyValue(p)).join('|')).join('#');
      const before = snap();
      let mutated = false;
      const mo = new MutationObserver(() => (mutated = true));
      mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      window.__tap = new Promise((resolve) => {
        let t0 = 0;
        const down = (ev) => {
          t0 = ev.timeStamp || performance.now();
          const loop = (ts) => {
            const changed = mutated || snap() !== before;
            if (changed) {
              mo.disconnect();
              return resolve({ ms: Math.round(performance.now() - t0), via: mutated ? 'dom' : 'style' });
            }
            if (performance.now() - t0 > 800) {
              mo.disconnect();
              return resolve({ ms: 800, via: 'none' });
            }
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        };
        window.addEventListener('pointerdown', down, { once: true, capture: true });
      });
    },
    { x, y },
  );
  await page.touchscreen; // touch emulation is on (iPhone 13 device)
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(120);
  if (!o.noRelease) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const r = await page.evaluate(() => window.__tap);
  if (o.noRelease) await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await cdp.detach();
  return r;
}

const TAPS = [
  ['title', 'home: tab bar', '.tabbar .tab:not(.on)'],
  ['title', 'home: tile', '.home-tile'],
  ['title', 'home: CTA', '.home-cta'],
  ['collection', 'collection: tile', '.home-tile'],
  ['settings', 'settings: segmented', '.seg-btn:not(.on)'],
  ['settings', 'settings: list row', '.ios-row--nav'],
  ['database', 'database: card', '.cb-row, .cb-cell'],
  ['database', 'database: chip', '.cb-kind.chip'],
  ['binder', 'binder: card cell', '.bd-cell'],
  ['packs', 'packs: primary button', '.ps-actions .ui-btn-primary'],
  ['draft', 'draft: preset', '.dr-preset:not(.on)'],
  ['events', 'events: row', '.ios-row--nav'],
];

async function measureTaps(browser, res) {
  const { ctx, page } = await newPage(browser);
  res.taps = {};
  for (const [route, label, sel] of TAPS) {
    await page.evaluate((r) => (location.hash = '#/' + r), route);
    await page.waitForTimeout(900);
    const r = await tapLatency(page, `.screen:not(.screen-leave) ${sel}, body > .tabbar ${sel}`.replace('.screen:not(.screen-leave) .tabbar', '.tabbar'));
    res.taps[label] = r;
    await page.evaluate(() => document.querySelectorAll('.modal-backdrop, .zoom').forEach((e) => e.remove()));
    await page.keyboard.press('Escape').catch(() => {});
  }
  await ctx.close();
  log('taps', JSON.stringify(res.taps));
}

// ------------------------------------------------------------------ screen transitions
const SCREENS = [
  ['Home', 'title'],
  ['Duel hub', 'play'],
  ['Draft', 'draft'],
  ['Deck Builder', 'deck-builder'],
  ['Packs', 'packs'],
  ['Binder', 'binder'],
  ['Events', 'events'],
  ['Settings', 'settings'],
  ['Database', 'database'],
];

async function measureScreens(browser, res) {
  const { ctx, page } = await newPage(browser);
  res.screens = {};
  for (let round = 0; round < 3; round++) {
    for (const [label, route] of SCREENS) {
      // from another screen to this one
      await page.evaluate((r) => (location.hash = r === 'settings' ? '#/play' : '#/settings'), route);
      await page.waitForTimeout(700);
      const r = await page.evaluate(async (route) => {
        const old = [...document.querySelectorAll('.screen:not(.screen-leave)')].pop();
        const lt0 = window.__perf.longtasks.length;
        const t0 = performance.now();
        location.hash = '#/' + route;
        // the new screen is mounted from the hashchange task
        await new Promise((r) => {
          const check = () => {
            const s = [...document.querySelectorAll('.screen:not(.screen-leave)')].pop();
            if (s && s !== old) r();
            else setTimeout(check, 0);
          };
          check();
        });
        const tMount = performance.now() - t0;
        // painted: the frame after mount
        await new Promise((r) => requestAnimationFrame(() => r()));
        const tPaint = performance.now() - t0;
        // interactive: a task can run again after that frame (main thread free)
        await new Promise((r) => {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => r();
          requestAnimationFrame(() => ch.port2.postMessage(0));
        });
        const tReady = performance.now() - t0;
        const s = [...document.querySelectorAll('.screen:not(.screen-leave)')].pop();
        const cs = getComputedStyle(s);
        const durs = cs.transitionDuration.split(',').map((x) => parseFloat(x) * (x.includes('ms') ? 1 : 1000));
        await new Promise((r) => setTimeout(r, 500));
        const lts = window.__perf.longtasks.slice(lt0).filter((x) => x.t >= t0);
        // settled: the new screen is painted AND no long task (deferred building) is still holding the main thread
        const settled = Math.max(tReady, ...lts.map((x) => x.t + x.d - t0));
        return { mount: Math.round(tMount), paint: Math.round(tPaint), ready: Math.round(tReady), settled: Math.round(settled), transition: Math.max(0, ...durs), longTasks: lts.length, maxLongTask: Math.round(Math.max(0, ...lts.map((x) => x.d))) };
      }, route);
      (res.screens[label] ??= []).push(r);
    }
  }
  for (const k of Object.keys(res.screens)) {
    const xs = res.screens[k];
    res.screens[k] = {
      ready: median(xs.map((x) => x.ready)),
      settled: median(xs.map((x) => x.settled)),
      coldSettled: xs[0].settled,
      paint: median(xs.map((x) => x.paint)),
      transition: xs[0].transition,
      longTasks: median(xs.map((x) => x.longTasks)),
      maxLongTask: Math.max(...xs.map((x) => x.maxLongTask)),
    };
  }
  await ctx.close();
  log('screens', JSON.stringify(res.screens));
}

// ------------------------------------------------------------------ scrolling and pack opening
async function measureScroll(browser, res) {
  const { ctx, page } = await newPage(browser);
  res.scroll = {};
  for (const [label, route] of [
    ['Binder', 'binder'],
    ['Database', 'database'],
    ['Deck Builder', 'deck-builder'],
  ]) {
    await page.evaluate((r) => (location.hash = '#/' + r), route);
    await page.waitForTimeout(1200);
    await page.mouse.move(195, 600);
    await startSampling(page);
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(0, i < 40 ? 120 : -180);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(400);
    res.scroll[label] = await stopSampling(page);
    res.scroll[label].images = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('.screen:not(.screen-leave) img')];
      return { total: imgs.length, lazy: imgs.filter((i) => i.loading === 'lazy').length, asyncDecode: imgs.filter((i) => i.decoding === 'async').length };
    });
  }
  await ctx.close();
  log('scroll', JSON.stringify(res.scroll));
}

async function measurePacks(browser, res) {
  const { ctx, page } = await newPage(browser);
  await page.evaluate(() => (location.hash = '#/packs'));
  await page.waitForTimeout(1200);
  const open = page.locator('.ps-actions .ui-btn-primary').first();
  if (!(await open.count())) {
    res.packs = null;
    return ctx.close();
  }
  await startSampling(page);
  await open.click();
  await page.waitForSelector('.po-pack', { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.locator('.po-pack').click({ force: true });
  await page.waitForSelector('.po-card', { timeout: 5000 });
  await page.waitForTimeout(1000);
  await page.locator('.po-reveal').click({ force: true }).catch(() => {});
  await page.waitForTimeout(3500);
  res.packs = await stopSampling(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/packs-open.png` });
  await ctx.close();
  log('packs', JSON.stringify(res.packs));
}

// ------------------------------------------------------------------ report
function table(before, after) {
  const rows = [];
  const add = (label, b, a, unit = 'ms') => rows.push([label, b == null ? '-' : `${b}${unit}`, a == null ? '-' : `${a}${unit}`]);
  const d = (r, f) => {
    try {
      return f(r);
    } catch {
      return null;
    }
  };
  for (const r of [before, after]) void r;
  add('AI turn (avg wall, excl. player waits)', d(before, (r) => r.duel.aiTurnAvgMs), d(after, (r) => r.duel.aiTurnAvgMs));
  add('AI turn (median)', d(before, (r) => r.duel.aiTurnMedianMs), d(after, (r) => r.duel.aiTurnMedianMs));
  add('  share in animations', d(before, (r) => r.duel.aiTurnFxShare), d(after, (r) => r.duel.aiTurnFxShare), '%');
  add('  share in AI pacing waits', d(before, (r) => r.duel.aiTurnPaceShare), d(after, (r) => r.duel.aiTurnPaceShare), '%');
  add('Animation step avg', d(before, (r) => r.duel.animAvgMs), d(after, (r) => r.duel.animAvgMs));
  add('Animation step median', d(before, (r) => r.duel.animMedianMs), d(after, (r) => r.duel.animMedianMs));
  add('Animation steps > 600 ms', d(before, (r) => r.duel.animOver600), d(after, (r) => r.duel.animOver600), '');
  add('Gaps > 120 ms (whole duel)', d(before, (r) => r.duel.gapsOver120), d(after, (r) => r.duel.gapsOver120), '');
  add('Biggest gap', d(before, (r) => r.duel.biggestGaps[0].ms), d(after, (r) => r.duel.biggestGaps[0].ms));
  for (const t of ['turn', 'phase', 'draw', 'summon', 'activate', 'attack', 'damage', 'destroy', 'resolve', 'target'])
    add(`  fx ${t} (avg)`, d(before, (r) => r.duel.fxByType[t].avg), d(after, (r) => r.duel.fxByType[t].avg));
  add('Duel long tasks / min', d(before, (r) => r.duel.frames.longTasksPerMin), d(after, (r) => r.duel.frames.longTasksPerMin), '');
  add('Duel janky frames (>34 ms)', d(before, (r) => r.duel.frames.jankPct), d(after, (r) => r.duel.frames.jankPct), '%');
  const taps = new Set([...Object.keys(before?.taps ?? {}), ...Object.keys(after?.taps ?? {}), ...Object.keys(before?.duel?.taps ?? {}), ...Object.keys(after?.duel?.taps ?? {})]);
  for (const k of taps) {
    const f = (r) => {
      const x = r.taps?.[k] ?? r.duel?.taps?.[k];
      return x ? `${x.ms} (${x.via})` : null;
    };
    add(`Tap: ${k}`, d(before, f), d(after, f), '');
  }
  for (const [label] of SCREENS)
    add(`Open ${label} (settled warm / cold / transition)`, d(before, (r) => `${r.screens[label].settled} / ${r.screens[label].coldSettled} / ${r.screens[label].transition}`), d(after, (r) => `${r.screens[label].settled} / ${r.screens[label].coldSettled} / ${r.screens[label].transition}`));
  for (const k of ['Binder', 'Database', 'Deck Builder']) {
    add(`Scroll ${k}: long tasks`, d(before, (r) => `${r.scroll[k].longTasks} (max ${r.scroll[k].maxLongTaskMs})`), d(after, (r) => `${r.scroll[k].longTasks} (max ${r.scroll[k].maxLongTaskMs})`), '');
    add(`Scroll ${k}: janky frames`, d(before, (r) => r.scroll[k].jankPct), d(after, (r) => r.scroll[k].jankPct), '%');
  }
  add('Tap-to-hurry: step ends after tap', d(before, (r) => r.duel.fastForward.tapToHurry.avgFinishAfterTapMs), d(after, (r) => r.duel.fastForward.tapToHurry.avgFinishAfterTapMs));
  add('AI turn with fast-forward held', d(before, (r) => r.duel.fastForward.fastForward.aiTurnMs), d(after, (r) => r.duel.fastForward.fastForward.aiTurnMs));
  add('Pack opening: long tasks', d(before, (r) => `${r.packs.longTasks} (max ${r.packs.maxLongTaskMs})`), d(after, (r) => `${r.packs.longTasks} (max ${r.packs.maxLongTaskMs})`), '');
  add('Pack opening: janky frames', d(before, (r) => r.packs.jankPct), d(after, (r) => r.packs.jankPct), '%');
  const w = [Math.max(...rows.map((r) => r[0].length)), Math.max(6, ...rows.map((r) => r[1].length)), Math.max(5, ...rows.map((r) => r[2].length))];
  const line = (r) => `| ${r[0].padEnd(w[0])} | ${r[1].padStart(w[1])} | ${r[2].padStart(w[2])} |`;
  return [line(['Metric', 'Before', 'After']), `|${'-'.repeat(w[0] + 2)}|${'-'.repeat(w[1] + 2)}|${'-'.repeat(w[2] + 2)}|`, ...rows.map(line)].join('\n');
}

(async () => {
  const browser = await chromium.launch();
  const res = { base: BASE, cpu: CPU, at: new Date().toISOString() };
  if (ONLY.includes('screens')) await measureScreens(browser, res);
  if (ONLY.includes('taps')) await measureTaps(browser, res);
  if (ONLY.includes('scroll')) await measureScroll(browser, res);
  if (ONLY.includes('packs')) await measurePacks(browser, res);
  if (ONLY.includes('duel')) await measureDuel(browser, res);
  await browser.close();
  res.errors = errors.slice(0, 10);
  fs.writeFileSync(OUT, JSON.stringify(res, null, 2));
  log(`wrote ${OUT}${errors.length ? ` (${errors.length} console errors)` : ''}`);
  if (COMPARE) console.log('\n' + table(JSON.parse(fs.readFileSync(COMPARE, 'utf8')), res));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
