// End-to-end check for Friends Locals: four iPhone 13 browser contexts run a whole tournament over a
// local PeerJS server (the `peer` dev dependency, in-process) against the built app.
//
//  1. Hana creates the tournament; Gus, Mei and Rio join from the share link (two of them) and the
//     code field (one); each registers a premade deck and taps Ready; Hana starts it.
//  2. Three Swiss rounds with the AI playing every seat (?netbot=…): each phone sits down at its
//     table by itself, every result is verified on Hana's phone, Hana pairs each round from the
//     Organiser tab. All four phones must agree on the standings, and the ceremony shows a champion.
//  3. A player whose match is over watches a match still being played (spectator board, both
//     hands hidden).
//  4. A player reloads mid-match and the match resumes (Home's "Duel in progress" card, or the
//     event picking it back up) and finishes.
//  5. Screenshots, portrait 390×844 and landscape 844×390: lobby, pairings, standings, spectating,
//     ceremony. No horizontal scroll; no console errors anywhere (blocked card art excepted).
//
// Usage (after `npm run build`; Playwright is not a project dependency):
//   node scripts/friends-locals-e2e.cjs [outDir]
const { chromium, devices } = require('playwright');
const { PeerServer } = require('peer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'edison-friends-locals-shots');
fs.mkdirSync(OUT, { recursive: true });
const DIST = path.join(__dirname, '..', 'dist');
const APP_PORT = 8183;
const PEER_PORT = 9193;
const BASE = `http://127.0.0.1:${APP_PORT}/`;
const PEER = `127.0.0.1:${PEER_PORT}/edison`;

const errors = [];
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function staticServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4' };
  return http
    .createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, BASE).pathname);
      let f = path.join(DIST, p === '/' ? 'index.html' : p);
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
      res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    })
    .listen(APP_PORT, '127.0.0.1');
}

async function phone(browser, name, deck, opts = {}) {
  const iphone = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  const ctx = await browser.newContext(iphone);
  await ctx.addInitScript(
    ({ name, deck }) => {
      if (localStorage.getItem('e2e.init')) return;
      localStorage.setItem('e2e.init', '1');
      localStorage.setItem('edison.settings.v1', JSON.stringify({ playerName: name, animationSpeed: 0, sound: false, music: false, haptics: false, confirmEndTurn: false, officialImages: false }));
      localStorage.setItem('edison.settings.musicOn.v1', 'true');
      localStorage.setItem('edison.settings.firstDraw.v1', 'true');
      localStorage.setItem('edison.hint.hold', '1');
      localStorage.setItem('edison.friendsLocals.prefs.v1', JSON.stringify({ deck: `premade:${deck}` }));
    },
    { name, deck },
  );
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR|ygoprodeck|yugipedia|ERR_TUNNEL|ERR_PROXY/i.test(t)) return;
    errors.push(`[${name}] ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e}`));
  const q = `?peer=${encodeURIComponent(PEER)}&netbot=${opts.bot ?? 'normal'}${opts.pace ? `&netpace=${opts.pace}` : ''}`;
  return { ctx, page, name, q };
}

const url = (p, hash) => `${BASE}${p.q}#/${hash}`;
const L = (p, expr, arg) => p.page.evaluate(expr, arg);

async function shot(p, file, landscape = false) {
  if (landscape) await p.page.setViewportSize({ width: 844, height: 390 });
  await sleep(350);
  await p.page.screenshot({ path: path.join(OUT, file) });
  const wide = await p.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);
  ok(!wide, `${file}: no horizontal scroll`);
  if (landscape) {
    await p.page.setViewportSize({ width: 390, height: 844 });
    await sleep(200);
  }
}

async function tab(p, label) {
  await p.page.locator('.fl-tabs .seg-btn', { hasText: label }).first().click();
  await sleep(150);
}

/** Every result of the current round is in (on the organiser's phone). */
const roundDone = (p) => L(p, () => { const h = window.__edisonLocals?.host; return !!h && h.roundComplete(); });

(async () => {
  const app = staticServer();
  const peer = PeerServer({ port: PEER_PORT, host: '127.0.0.1', path: '/edison' });
  await sleep(500);
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const t0 = Date.now();
  const phones = [];
  let monitorStop = () => {};
  try {
    const hana = await phone(browser, 'Hana', 'blackwings', { pace: 60 });
    const gus = await phone(browser, 'Gus', 'lightsworn', { pace: 60 });
    const mei = await phone(browser, 'Mei', 'zombies', { pace: 60 });
    const rio = await phone(browser, 'Rio', 'x-sabers', { pace: 60 });
    phones.push(hana, gus, mei, rio);
    // log every phone's link to the organiser as it changes
    const last = {};
    const monitor = setInterval(async () => {
      for (const p of phones) {
        const st = await p.page.evaluate(() => window.__edisonLocals?.client?.status ?? null).catch(() => null);
        if (st && last[p.name] !== st) {
          if (last[p.name]) console.log(`  ${p.name}: link ${last[p.name]} → ${st} at ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          last[p.name] = st;
        }
      }
    }, 500);
    monitorStop = () => clearInterval(monitor);

    // ---------------------------------------------------------------- create and join
    await hana.page.goto(url(hana, 'friend'));
    await hana.page.click('[data-test=friends-locals]');
    await hana.page.waitForSelector('[data-test=fl-create]');
    ok((await hana.page.locator('.tabbar .tab.on').textContent()).includes('Duel'), 'Duel tab highlighted on Friends Locals');
    await shot(hana, 'fl-landing-portrait.png');
    await hana.page.click('[data-test=fl-create]');
    const codeEl = hana.page.locator('[data-test=fl-code]');
    await codeEl.waitFor({ timeout: 20000 });
    const code = (await codeEl.textContent()).trim();
    ok(/^[A-Z]{4}-\d{4}$/.test(code), `tournament code ${code}`);
    await gus.page.goto(url(gus, `friend-locals?join=${code}`));
    await mei.page.goto(url(mei, `friend-locals?join=${code}`));
    await rio.page.goto(url(rio, 'friend-locals'));
    await rio.page.click('[data-test=fl-join]');
    await rio.page.fill('[data-test=fl-join-code]', code.toLowerCase().replace('-', ' '));
    await rio.page.keyboard.press('Enter');
    for (const p of [gus, mei, rio]) await p.page.waitForSelector('[data-test=fl-players]', { timeout: 30000 });
    await hana.page.waitForFunction(() => window.__edisonLocals?.view?.players.length === 4, null, { timeout: 30000 });
    ok(true, 'three friends joined the lobby');
    for (const p of [gus, mei, rio]) {
      await p.page.waitForFunction(() => !document.querySelector('[data-test=fl-ready]')?.hasAttribute('disabled'), null, { timeout: 15000 });
      await p.page.click('[data-test=fl-ready]');
    }
    await hana.page.click('[data-test=fl-ready]');
    await hana.page.waitForSelector('[data-test=fl-start]', { timeout: 20000 });
    await shot(hana, 'fl-lobby-organiser-portrait.png');
    await shot(gus, 'fl-lobby-player-portrait.png');
    await shot(hana, 'fl-lobby-organiser-landscape.png', true);
    await shot(gus, 'fl-lobby-player-landscape.png', true);
    const regs = await L(hana, () => window.__edisonLocals.view.players.map((p) => `${p.name}:${p.deckName}:${p.ready}`));
    ok(regs.length === 4 && regs.every((r) => r.endsWith(':true') && !r.includes(':null:')), `decks registered and ready: ${regs.join(', ')}`);
    await hana.page.click('[data-test=fl-start]');
    for (const p of phones) await p.page.waitForFunction(() => window.__edisonLocals?.view?.phase === 'swiss', null, { timeout: 20000 });
    ok(true, 'tournament started on every phone');

    // ---------------------------------------------------------------- three Swiss rounds
    let watched = false;
    let reloaded = false;
    for (let round = 1; round <= 3; round++) {
      // pairings, before the duels cover the screen
      if (round === 1) {
        await rio.page.waitForSelector('[data-test=fl-pairings]', { timeout: 20000 }).catch(() => {});
        await rio.page.screenshot({ path: path.join(OUT, 'fl-pairings-portrait.png') }).catch(() => {});
      }
      const tRound = Date.now();
      // reload one player mid-match in round 2
      if (round === 2 && !reloaded) {
        await mei.page.waitForFunction(() => window.__edisonLocals?.playing && (window.__edisonNet?.room.current?.logs[0].length ?? 0) + (window.__edisonNet?.room.current?.logs[1].length ?? 0) > 20, null, { timeout: 120000, polling: 100 });
        const before = await L(mei, () => { const c = window.__edisonNet.room.current; return c.logs[0].length + c.logs[1].length; });
        console.log('  before reload', await L(mei, () => ({ rounds: window.__edisonLocals.view.rounds.length, saved: JSON.parse(localStorage.getItem('edison.friendsLocals.active.v1') || 'null')?.client?.view?.rounds.length, rev: window.__edisonLocals.view.rev })));
        await mei.page.reload();
        // Home's card, or the event resuming the match by itself
        const resumed = await Promise.race([
          mei.page.waitForSelector('.home-resume--duel', { timeout: 20000 }).then(async (card) => {
            ok((await card.textContent()).includes('Friends Locals'), 'Home shows the Friends Locals duel in progress');
            await card.click().catch(() => {});
            return 'card';
          }),
          mei.page.waitForFunction(() => window.__edisonLocals?.playing, null, { timeout: 20000 }).then(() => 'auto'),
        ]).catch(() => null);
        ok(!!resumed, `Mei's match came back after a reload (${resumed})`);
        await mei.page.waitForFunction((n) => { const c = window.__edisonNet?.room?.current; return (c && c.logs[0].length + c.logs[1].length > n) || window.__edisonLocals?.client?.reportPending(window.__edisonLocals.client.myMatch()?.id); }, before, { timeout: 120000 });
        ok(true, `Mei resumed (had ${before} decisions) and play continues`);
        reloaded = true;
      }
      // a player who is done watches a table still playing
      while (!(await roundDone(hana))) {
        if (Date.now() - tRound > 300000) throw new Error(`round ${round} timed out`);
        if (!watched) {
          for (const p of phones) {
            const target = await L(p, () => {
              const l = window.__edisonLocals;
              const v = l?.view;
              if (!v || l.playing || l.watching) return null;
              const me = l.client.me.clientId;
              const mine = l.client.myMatch();
              if (mine && mine.result == null && !l.client.reportPending(mine.id)) return null;
              const r = v.rounds[v.rounds.length - 1];
              const m = r.find((x) => x.result == null && x.b && x.a !== me && x.b !== me && x.reported.length === 0);
              return m ? m.id : null;
            });
            if (!target) continue;
            await L(p, (mid) => window.__edisonLocals.watch(mid), target);
            const live = await p.page.waitForSelector('.fl-watching', { timeout: 20000 }).then(() => true).catch(() => false);
            if (!live) continue;
            await p.page.waitForFunction(() => !document.querySelector('.duel-restoring'), null, { timeout: 30000 }).catch(() => {});
            await p.page.screenshot({ path: path.join(OUT, 'fl-spectating-portrait.png') });
            await p.page.setViewportSize({ width: 844, height: 390 });
            await sleep(400);
            await p.page.screenshot({ path: path.join(OUT, 'fl-spectating-landscape.png') });
            await p.page.setViewportSize({ width: 390, height: 844 });
            const chip = await L(p, () => document.querySelector('.fl-watch-chip')?.textContent ?? '');
            ok(/Watching/.test(chip), `spectator board says what is being watched (${chip})`);
            const seen = await L(p, () => {
              const root = document.querySelector('.fl-watching');
              const hands = [...(root?.querySelectorAll('.hand .dc') ?? [])];
              return { spec: !!root?.classList.contains('is-spectator'), cards: hands.length, backs: hands.filter((e) => e.querySelector('.yc--back')).length };
            });
            ok(seen.spec && seen.cards > 0 && seen.backs === seen.cards, `${p.name} watches a live table on a spectator board; both hands hidden (${seen.backs}/${seen.cards} face down)`);
            const n1 = await L(p, () => window.__edisonLocals.watchEntries);
            await sleep(1500);
            const n2 = await L(p, () => window.__edisonLocals.watchEntries);
            ok(n1 > 0, `spectator receives the decision stream (${n1} decisions${n2 ? `, then ${n2}` : ', then the match ended'})`);
            await L(p, () => window.__edisonLocals.stopWatching());
            watched = true;
            break;
          }
        }
        await sleep(400);
      }
      ok(true, `round ${round}: every result in and verified (${((Date.now() - tRound) / 1000).toFixed(0)}s)`);
      const hows = await L(hana, () => window.__edisonLocals.view.rounds[window.__edisonLocals.view.rounds.length - 1].map((m) => m.how));
      ok(hows.every((x) => x === 'verified' || x === 'concede' || x === 'bye'), `round ${round} results verified by replay: ${hows.join(', ')}`);
      // standings on a player's phone
      await gus.page.waitForFunction((r) => window.__edisonLocals.view.rounds.length === r && window.__edisonLocals.view.rounds[r - 1].every((m) => m.result != null), round, { timeout: 30000 });
      if (round === 1) {
        await gus.page.waitForFunction(() => !window.__edisonLocals.playing, null, { timeout: 30000 });
        await sleep(600);
        await tab(gus, 'Standings');
        await shot(gus, 'fl-standings-portrait.png');
        await shot(gus, 'fl-standings-landscape.png', true);
        await tab(gus, 'Round');
        await tab(hana, 'Organiser');
        await shot(hana, 'fl-organiser-portrait.png');
      }
      // the organiser pairs the next round (or posts the final standings)
      await tab(hana, 'Organiser');
      await hana.page.waitForFunction(() => !document.querySelector('[data-test=fl-pair]')?.hasAttribute('disabled'), null, { timeout: 20000 });
      await hana.page.click('[data-test=fl-pair]');
      if (round < 3) for (const p of phones) await p.page.waitForFunction((r) => window.__edisonLocals?.view?.rounds.length === r + 1, round, { timeout: 30000 });
    }
    ok(watched, 'a player watched a live match');
    ok(reloaded, 'a player reloaded mid-match');

    // ---------------------------------------------------------------- final standings and ceremony
    for (const p of phones) await p.page.waitForFunction(() => window.__edisonLocals?.view?.phase === 'done', null, { timeout: 30000 });
    const finals = await Promise.all(phones.map((p) => L(p, () => JSON.stringify(window.__edisonLocals.view.placements))));
    ok(finals.every((f) => f === finals[0]), `every phone has the same final placements ${finals[0]}`);
    const st = await Promise.all(phones.map((p) => L(p, () => JSON.stringify(window.__edisonLocals.standings().map((s) => [s.id, s.mp, s.w, s.l, s.d])))));
    ok(st.every((s) => s === st[0]), 'every phone shows the same standings');
    const pts = JSON.parse(st[0]);
    ok(pts.reduce((a, s) => a + s[2], 0) === 6 - pts.reduce((a, s) => a + s[4], 0) / 2, `six matches played: ${pts.map((s) => `${s[1]}pts`).join(' ')}`);
    for (const p of phones) await p.page.waitForFunction(() => window.__edisonLocals && !window.__edisonLocals.playing && !document.body.classList.contains('in-duel'), null, { timeout: 30000 });
    await tab(rio, 'Prizes');
    await rio.page.waitForSelector('[data-test=fl-ceremony]', { timeout: 10000 });
    const champ = await L(rio, () => document.querySelector('.lx-cer-champ b')?.textContent);
    ok(!!champ, `ceremony shows the champion: ${champ}`);
    await shot(rio, 'fl-ceremony-portrait.png');
    await shot(rio, 'fl-ceremony-landscape.png', true);
    await tab(hana, 'Prizes');
    await shot(hana, 'fl-ceremony-organiser-portrait.png');
    await tab(hana, 'Standings');
    await shot(hana, 'fl-final-standings-portrait.png');
    const hist = await Promise.all(phones.map((p) => L(p, () => JSON.parse(localStorage.getItem('edison.friendsLocals.history.v1') || '[]').length)));
    ok(hist.every((n) => n === 1), `every phone recorded the event in its history (${hist.join(',')})`);
    const h2h = await L(gus, () => Object.keys(JSON.parse(localStorage.getItem('edison.friends.h2h.v1') || '{}')).length);
    ok(h2h >= 2, `head-to-head records updated from the event's matches (${h2h} friends)`);
    // Done returns to the landing with the event in the history
    await rio.page.click('.fl-done');
    await rio.page.waitForSelector('.fl-hist', { timeout: 10000 });
    ok(true, 'the finished event shows in the history list');
    await shot(rio, 'fl-history-portrait.png');
  } catch (e) {
    failures++;
    console.log('FAIL', e.stack || e);
    for (const p of phones) {
      const dump = await p.page.evaluate(() => ({ hash: location.hash, view: window.__edisonLocals?.view && { phase: window.__edisonLocals.view.phase, rounds: window.__edisonLocals.view.rounds.map((r) => r.map((m) => `${m.id}:${m.result}:${m.reported.join('+')}:${m.dispute?.reason ?? ''}`)) }, playing: window.__edisonLocals?.playing, connected: window.__edisonLocals?.connected, status: window.__edisonLocals?.client?.status, saved: JSON.parse(localStorage.getItem('edison.friendsLocals.active.v1') || 'null')?.client?.view?.rev, rev: window.__edisonLocals?.view?.rev })).catch(() => null);
      console.log(p.name, JSON.stringify(dump));
      await p.page.screenshot({ path: path.join(OUT, `debug-${p.name}.png`) }).catch(() => {});
    }
  } finally {
    monitorStop();
    await browser.close();
    app.close();
    peer.close?.();
  }
  ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 6).join(' | ')}` : ''}`);
  console.log(`friends-locals-e2e: ${failures} failure${failures === 1 ? '' : 's'}, ${((Date.now() - t0) / 1000).toFixed(0)}s, screenshots in ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
