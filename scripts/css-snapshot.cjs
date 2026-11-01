// CSS regression oracle: records the computed style of every element (and its ::before/::after/::marker/
// ::placeholder) plus a screenshot, on every route of scripts/routes-e2e.cjs (empty profile and saved
// progress), at 390×844 (iPhone 13 portrait), 844×390 (landscape) and 1280×800 (desktop), and on a duel
// board (in the app, and in the /duel-dev.html harness on the Vite dev server). A second mode compares two
// snapshots: every element whose computed style differs (property, before, after) and every screenshot
// whose pixels differ. Use it to prove a stylesheet refactor changes nothing.
//
// Usage (Playwright is not a project dependency; it is found globally):
//   npx vite build
//   npm run test:css-snapshot -- snap <dir> [--progress <dir-or-file>]   take a snapshot into <dir>
//   npm run test:css-snapshot -- compare <dirA> <dirB>                    report differences (exit 1 if any)
// The saved-progress profile is built by driving the app (as routes-e2e does) and stored as
// <dir>/progress.json; pass `--progress <baseline dir>` to later runs so both sides start from the
// same storage. ONLY=<route part> limits the routes, VIEWPORTS=portrait,desktop limits the viewports,
// JOBS=<n> sets the parallel pages (default 4).
//
// Determinism: card art and every other non-local request is blocked, Math.random and crypto random are
// seeded, the clock starts at a fixed time, Web Audio is off, animations are off in Settings, every
// scroller is put back at the top, and while styles are read an injected style turns CSS animations and
// transitions off (the declared animation-* and transition-* values are then read again without it, so
// changes to them still show).
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
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = {
  portrait: { viewport: { width: 390, height: 844 }, mobile: true },
  landscape: { viewport: { width: 844, height: 390 }, mobile: true },
  desktop: { viewport: { width: 1280, height: 800 }, mobile: false },
};
const SETTINGS = { animationSpeed: 0, music: false, sound: false };
const FIXED_TIME = new Date('2026-03-01T12:00:00Z');
const DEV_PORT = 5199;

const NO_MOTION = `*, *::before, *::after, *::marker, *::placeholder { animation: none !important; transition: none !important; caret-color: transparent !important; }`;

// ------------------------------------------------------------------ determinism

async function newContext(browser, vp, storage) {
  const v = VIEWPORTS[vp];
  let opts;
  if (v.mobile) {
    opts = { ...devices['iPhone 13'], viewport: v.viewport };
    delete opts.defaultBrowserType;
  } else opts = { viewport: v.viewport, deviceScaleFactor: 1 };
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block', reducedMotion: 'no-preference', colorScheme: 'dark' });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.clock.install({ time: FIXED_TIME });
  await ctx.addInitScript(() => {
    // seeded random (mulberry32), the same sequence on every load
    let s = 0x2f6b9a1;
    const rnd = () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    Math.random = rnd;
    // no Web Audio: whether music starts depends on decode timing
    try {
      delete window.AudioContext;
      delete window.webkitAudioContext;
      window.AudioContext = undefined;
    } catch {}
    try {
      crypto.getRandomValues = (a) => {
        for (let i = 0; i < a.length; i++) a[i] = Math.floor(rnd() * 2 ** 32);
        return a;
      };
      let n = 0;
      crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    } catch {}
  });
  if (storage) {
    await ctx.addInitScript((st) => {
      if (sessionStorage.getItem('snap.seeded')) return;
      sessionStorage.setItem('snap.seeded', '1');
      localStorage.clear();
      for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v);
    }, storage);
  }
  return ctx;
}

function withSettings(storage) {
  let cur = {};
  try {
    cur = JSON.parse(storage['edison.settings.v1'] || '{}');
  } catch {}
  return { ...storage, 'edison.settings.v1': JSON.stringify({ ...cur, ...SETTINGS }) };
}

/** Wait until the DOM has been quiet for `quiet` ms (or `max` ms passed), then two frames. */
async function settle(page, quiet = 500, max = 8000) {
  await page.waitForLoadState('load').catch(() => {});
  await page.evaluate(
    ([quiet, max]) =>
      new Promise((done) => {
        let last = performance.now();
        const t0 = last;
        const mo = new MutationObserver(() => (last = performance.now()));
        mo.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        const tick = () => {
          const now = performance.now();
          if (now - last >= quiet || now - t0 >= max) {
            mo.disconnect();
            return void (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => requestAnimationFrame(() => requestAnimationFrame(() => done())));
          }
          setTimeout(tick, 50);
        };
        tick();
      }),
    [quiet, max],
  );
}

// ------------------------------------------------------------------ capture

/** Runs in the page: computed styles of every element, deduplicated into a table. */
function collectInPage(noMotionCss) {
  const st = document.createElement('style');
  st.id = '__snap_no_motion';
  st.textContent = noMotionCss;
  document.head.appendChild(st);
  // custom properties declared anywhere in the stylesheets
  const custom = new Set();
  const scan = (rules) => {
    for (const r of rules) {
      if (r.style) for (let i = 0; i < r.style.length; i++) if (r.style[i].startsWith('--')) custom.add(r.style[i]);
      if (r.cssRules) scan(r.cssRules);
    }
  };
  for (const sh of document.styleSheets) {
    try {
      scan(sh.cssRules);
    } catch {}
  }
  const props = [...getComputedStyle(document.documentElement)].filter((p) => !p.startsWith('--')).concat([...custom].sort());
  const motionIdx = props.map((p, i) => (/^(animation|transition)/.test(p) ? i : -1)).filter((i) => i >= 0);
  const table = [];
  const ids = new Map();
  const idOf = (vals) => {
    const key = vals.join('\u0001');
    let id = ids.get(key);
    if (id === undefined) {
      id = table.length;
      ids.set(key, id);
      table.push(vals);
    }
    return id;
  };
  const read = (el, pseudo) => {
    const cs = getComputedStyle(el, pseudo);
    return props.map((p) => cs.getPropertyValue(p));
  };
  const items = []; // [path, pseudo|null, el]
  const walk = (el, p) => {
    if (el.id === '__snap_no_motion') return;
    items.push([p, null, el]);
    const tag = el.tagName.toLowerCase();
    for (const ps of ['::before', '::after']) {
      const c = getComputedStyle(el, ps).content;
      if (c && c !== 'none' && c !== 'normal') items.push([p + ps, ps, el]);
    }
    if (tag === 'li' || tag === 'summary') items.push([p + '::marker', '::marker', el]);
    if (tag === 'input' || tag === 'textarea') items.push([p + '::placeholder', '::placeholder', el]);
    let i = 0;
    for (const c of el.children) {
      const ct = c.tagName.toLowerCase();
      const cls = typeof c.className === 'string' && c.className.trim() ? '.' + c.className.trim().split(/\s+/)[0] : '';
      walk(c, `${p}>${ct}${cls}:${i++}`);
    }
  };
  walk(document.documentElement, 'html');
  const vals = items.map(([, ps, el]) => read(el, ps));
  // declared animation/transition values, without the injected style
  st.remove();
  for (let k = 0; k < items.length; k++) {
    const cs = getComputedStyle(items[k][2], items[k][1]);
    for (const i of motionIdx) vals[k][i] = cs.getPropertyValue(props[i]);
  }
  document.head.appendChild(st);
  const elements = items.map(([p], k) => [p, idOf(vals[k])]);
  return { props, table, elements, html: document.documentElement.outerHTML, scroll: [scrollX, scrollY] };
}

async function capture(page, dir, key) {
  await settle(page);
  // scroll positions depend on timing (scrollIntoView during the screen's entry transform): start every
  // scroller at the top
  const scrolled = await page.evaluate(() => {
    let n = 0;
    for (const e of document.querySelectorAll('*')) if (e.scrollTop || e.scrollLeft) (e.scrollTop = 0), (e.scrollLeft = 0), n++;
    if (scrollX || scrollY) (scrollTo(0, 0), n++);
    return n;
  });
  if (scrolled) await settle(page, 300, 3000);
  const data = await page.evaluate(collectInPage, NO_MOTION);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const { html, ...rest } = data;
  fs.writeFileSync(path.join(dir, key + '.json.gz'), zlib.gzipSync(JSON.stringify(rest)));
  fs.writeFileSync(path.join(dir, key + '.html.gz'), zlib.gzipSync(html));
  fs.writeFileSync(path.join(dir, key + '.png'), png);
  return data.elements.length;
}

const keyOf = (...parts) => parts.join('__').replace(/[^a-z0-9_.-]+/gi, '_');

// ------------------------------------------------------------------ snapshot mode

async function snap(dir, progressArg) {
  const R = require('./routes-e2e.cjs');
  const ONLY = process.env.ONLY || '';
  const routes = R.ROUTES.filter((r) => !ONLY || r.includes(ONLY));
  const vps = (process.env.VIEWPORTS || 'portrait,landscape,desktop').split(',');
  const JOBS = Number(process.env.JOBS || 4);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(R.DIST, 'index.html'))) throw new Error('Build first: npx vite build');
  const server = spawn('python3', ['-m', 'http.server', String(R.APP_PORT), '--bind', '127.0.0.1', '-d', R.DIST], { stdio: 'ignore' });
  const { PeerServer } = require('peer');
  const peer = PeerServer({ port: R.PEER_PORT, host: '127.0.0.1', path: '/edison' });
  const dev = spawn(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--port', String(DEV_PORT), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--font-render-hinting=none', '--disable-lcd-text'] });
  const t0 = Date.now();
  let failures = 0;
  try {
    await sleep(800);
    // saved progress: reuse a baseline's, or build it by driving the app (deterministically)
    let progress;
    const pf = progressArg && (fs.statSync(progressArg).isDirectory() ? path.join(progressArg, 'progress.json') : progressArg);
    if (pf) progress = JSON.parse(fs.readFileSync(pf, 'utf8'));
    else {
      // buildProgress makes its own context; give it a browser whose contexts are deterministic
      const shim = { newContext: async () => newContext(browser, 'portrait', null) };
      progress = await R.buildProgress(shim);
    }
    fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(progress, null, 1));

    const jobs = [];
    for (const vp of vps) {
      for (const [state, storage] of [
        ['empty', withSettings({})],
        ['saved', withSettings(progress)],
      ]) {
        for (const r of routes) jobs.push({ key: keyOf(vp, state, r), vp, storage, run: (page) => page.goto(R.BASE + '#/' + r) });
      }
      if (!ONLY || 'duel-board'.includes(ONLY)) {
        // a duel board in the app: pick the first deck, wait until it is your turn to act
        jobs.push({
          key: keyOf(vp, 'empty', 'duel-board'),
          vp,
          storage: withSettings({ 'edison.hint.hold': '1' }),
          run: async (page) => {
            await page.goto(R.BASE + '#/duel');
            await R.pickDecks(page);
            await page.waitForSelector('.duel-root.awaiting-action', { timeout: 60000 });
          },
        });
        // the dev harness (Vite dev server): you go first, seed 7, easy AI; snapshot at your first decision
        jobs.push({
          key: keyOf(vp, 'dev', 'duel-dev'),
          vp,
          storage: withSettings({ 'edison.hint.hold': '1' }),
          run: async (page) => {
            await page.goto(`http://127.0.0.1:${DEV_PORT}/duel-dev.html?first=0&seed=7&ai=easy`, { timeout: 60000 });
            await page.waitForSelector('.duel-root.awaiting-action', { timeout: 60000 });
          },
        });
      }
    }
    // the dev server compiles on first request: warm it up
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${DEV_PORT}/duel-dev.html`);
        if (res.ok) break;
      } catch {}
      await sleep(500);
    }
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const ctx = await newContext(browser, job.vp, job.storage);
        const page = await ctx.newPage();
        const errs = [];
        page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
        try {
          await job.run(page);
          const n = await capture(page, dir, job.key);
          done++;
          if (process.env.VERBOSE) console.log(`  ${job.key}: ${n} elements${errs.length ? ` (page errors: ${errs.join(' | ')})` : ''}`);
        } catch (e) {
          failures++;
          console.log(`FAIL ${job.key}: ${String(e).split('\n')[0]}`);
        }
        await ctx.close();
      }
    };
    await Promise.all(Array.from({ length: JOBS }, worker));
    console.log(`css-snapshot: ${done}/${jobs.length} pages captured into ${dir}, ${failures} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } finally {
    await browser.close();
    server.kill();
    dev.kill();
    peer.close?.();
  }
  return failures;
}

// ------------------------------------------------------------------ compare mode

function load(dir, key) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, key + '.json.gz'))).toString());
}

async function pixelDiff(browser, a, b) {
  const page = await browser.newPage();
  const r = await page.evaluate(
    async ([a, b]) => {
      const img = (src) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = 'data:image/png;base64,' + src;
        });
      const [ia, ib] = await Promise.all([img(a), img(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: `${ia.width}×${ia.height} vs ${ib.width}×${ib.height}`, n: -1 };
      const px = (i) => {
        const c = document.createElement('canvas');
        c.width = i.width;
        c.height = i.height;
        const g = c.getContext('2d');
        g.drawImage(i, 0, 0);
        return g.getImageData(0, 0, i.width, i.height).data;
      };
      const da = px(ia);
      const db = px(ib);
      let n = 0;
      let max = 0;
      for (let k = 0; k < da.length; k += 4) {
        const d = Math.max(Math.abs(da[k] - db[k]), Math.abs(da[k + 1] - db[k + 1]), Math.abs(da[k + 2] - db[k + 2]), Math.abs(da[k + 3] - db[k + 3]));
        if (d) {
          n++;
          if (d > max) max = d;
        }
      }
      return { n, max };
    },
    [a.toString('base64'), b.toString('base64')],
  );
  await page.close();
  return r;
}

async function compare(a, b) {
  const keys = (d) => new Set(fs.readdirSync(d).filter((f) => f.endsWith('.json.gz')).map((f) => f.slice(0, -8)));
  const ka = keys(a);
  const kb = keys(b);
  let diffs = 0;
  let elemDiffs = 0;
  let propDiffs = 0;
  let pixelPages = 0;
  const lines = [];
  for (const k of ka) if (!kb.has(k)) (diffs++, lines.push(`missing in ${b}: ${k}`));
  for (const k of kb) if (!ka.has(k)) (diffs++, lines.push(`missing in ${a}: ${k}`));
  const browser = await chromium.launch();
  let totalElems = 0;
  try {
    for (const k of [...ka].filter((k) => kb.has(k)).sort()) {
      const A = load(a, k);
      const B = load(b, k);
      totalElems += A.elements.length;
      const mb = new Map(B.elements.map(([p, id]) => [p, id]));
      const ma = new Map(A.elements.map(([p, id]) => [p, id]));
      const out = [];
      for (const [p] of A.elements) if (!mb.has(p)) out.push(`  element only in A: ${p}`);
      for (const [p] of B.elements) if (!ma.has(p)) out.push(`  element only in B: ${p}`);
      const bIdx = new Map(B.props.map((p, i) => [p, i]));
      const allProps = new Set([...A.props, ...B.props]);
      const aIdx = new Map(A.props.map((p, i) => [p, i]));
      for (const [p, ida] of A.elements) {
        if (!mb.has(p)) continue;
        const va = A.table[ida];
        const vb = B.table[mb.get(p)];
        let changed = false;
        for (const prop of allProps) {
          const x = aIdx.has(prop) ? va[aIdx.get(prop)] : '(absent)';
          const y = bIdx.has(prop) ? vb[bIdx.get(prop)] : '(absent)';
          if (x === y) continue;
          // a custom property only declared on one side and unset on the other is not a change
          if (prop.startsWith('--') && ((x === '(absent)' && y === '') || (y === '(absent)' && x === ''))) continue;
          changed = true;
          propDiffs++;
          out.push(`  ${p} ${prop}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
        }
        if (changed) elemDiffs++;
      }
      const pa = fs.readFileSync(path.join(a, k + '.png'));
      const pb = fs.readFileSync(path.join(b, k + '.png'));
      if (!pa.equals(pb)) {
        const r = await pixelDiff(browser, pa, pb);
        if (r.n) {
          pixelPages++;
          out.push(r.size ? `  screenshot size ${r.size}` : `  screenshot: ${r.n} pixels differ (max channel delta ${r.max})`);
        }
      }
      if (out.length) {
        diffs++;
        lines.push(`${k}:`, ...out.slice(0, Number(process.env.MAX_LINES || 200)));
        if (out.length > Number(process.env.MAX_LINES || 200)) lines.push(`  ... ${out.length - Number(process.env.MAX_LINES || 200)} more`);
      }
    }
  } finally {
    await browser.close();
  }
  for (const l of lines) console.log(l);
  console.log(`css-snapshot compare: ${ka.size} pages, ${totalElems} elements; ${diffs} pages differ, ${elemDiffs} elements with ${propDiffs} property differences, ${pixelPages} screenshots differ`);
  return diffs;
}

// ------------------------------------------------------------------ main

(async () => {
  const [mode, ...args] = process.argv.slice(2);
  let rc = 0;
  try {
    if (mode === 'snap' && args[0]) {
      const pi = args.indexOf('--progress');
      rc = (await snap(path.resolve(args[0]), pi >= 0 ? path.resolve(args[pi + 1]) : null)) ? 1 : 0;
    } else if (mode === 'compare' && args[1]) rc = (await compare(path.resolve(args[0]), path.resolve(args[1]))) ? 1 : 0;
    else {
      console.log('usage: css-snapshot.cjs snap <dir> [--progress <dir|file>] | compare <dirA> <dirB>');
      rc = 2;
    }
  } catch (e) {
    console.log('FAIL', e.stack || e);
    rc = 1;
  }
  process.exit(rc);
})();
