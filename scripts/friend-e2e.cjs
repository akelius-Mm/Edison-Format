// End-to-end check for "Play a friend": two iPhone 13 browser contexts play each other over a
// local PeerJS server (the `peer` dev dependency, started in-process) against the built app.
//
//  1. Five matches with different premade matchups (one Bo3): create a room, join it from the
//     share link, both ready, the AI plays each phone's seat (?netbot=…) to the end, and both
//     phones must hold the identical final state (LP, every zone, winner) for every game.
//  2. A forced disconnect mid-game (no reconnect for 4 s): "Reconnecting…", then it finishes in step.
//  3. A Bo3 where the guest sides on the siding screen (one swap) and the sided list reaches the host.
//  4. The guest, then the host, reloads mid-duel, resumes from Home's "Duel in progress" card and
//     finishes in step.
//  5. Screenshots of the landing, lobby and "Opponent is thinking…" chip, portrait and landscape.
//  No console errors anywhere (blocked card-art requests excepted).
//
// Usage (after `npm run build`; Playwright is not a project dependency):
//   npm run test:friend-e2e -- [outDir]     (ONLY=<label part> runs a subset; ONLY=shots the screenshots)
const { chromium, devices } = require('playwright');
const { PeerServer } = require('peer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'edison-friend-shots');
fs.mkdirSync(OUT, { recursive: true });
const DIST = path.join(__dirname, '..', 'dist');
const APP_PORT = 8181;
const PEER_PORT = 9191;
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
    ({ name, deck, bestOf }) => {
      if (localStorage.getItem('e2e.init')) return;
      localStorage.setItem('e2e.init', '1');
      localStorage.setItem('edison.settings.v1', JSON.stringify({ playerName: name, animationSpeed: 0, sound: false, music: false, haptics: false, confirmEndTurn: false, officialImages: false }));
      localStorage.setItem('edison.settings.musicOn.v1', 'true');
      localStorage.setItem('edison.settings.firstDraw.v1', 'true');
      localStorage.setItem('edison.hint.hold', '1');
      localStorage.setItem('edison.friend.v1', JSON.stringify({ deck: `premade:${deck}`, bestOf }));
    },
    { name, deck, bestOf: opts.bestOf ?? 1 },
  );
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR|ygoprodeck|yugipedia|ERR_TUNNEL|ERR_PROXY/i.test(t)) return;
    errors.push(`[${name}] ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e}`));
  const q = `?peer=${encodeURIComponent(PEER)}${opts.bot === false ? '' : `&netbot=${opts.bot ?? 'normal'}`}${opts.pace ? `&netpace=${opts.pace}` : ''}${opts.side ? '&netside=1' : ''}`;
  return { ctx, page, name, q };
}

const url = (p, hash) => `${BASE}${p.q}#/${hash}`;

async function createAndJoin(host, guest) {
  await host.page.goto(url(host, 'friend'));
  await host.page.click('[data-test=create-room]');
  const codeEl = host.page.locator('[data-test=room-code]');
  await codeEl.waitFor({ timeout: 20000 });
  const code = (await codeEl.textContent()).trim();
  await guest.page.goto(url(guest, `friend?join=${code}`));
  await guest.page.locator('[data-test=room-code]').waitFor({ timeout: 20000 });
  await host.page.waitForFunction(() => document.querySelector('.fr-status')?.classList.contains('is-connected'), null, { timeout: 30000 });
  await guest.page.waitForFunction(() => document.querySelector('.fr-status')?.classList.contains('is-connected'), null, { timeout: 30000 });
  return code;
}

async function readyBoth(host, guest) {
  for (const p of [host, guest]) {
    const b = p.page.locator('[data-test=ready]');
    await b.waitFor();
    await p.page.waitForFunction(() => !document.querySelector('[data-test=ready]')?.hasAttribute('disabled'), null, { timeout: 10000 });
    await b.click();
  }
  await host.page.waitForSelector('.duel-root', { timeout: 20000 });
  await guest.page.waitForSelector('.duel-root', { timeout: 20000 });
}

const net = (p, expr) => p.page.evaluate(expr);
const decisions = (p) => net(p, () => { const c = window.__edisonNet?.room.current; return c ? c.logs[0].length + c.logs[1].length : 0; });

async function waitMatchOver(p, ms = 120000, other) {
  await p.page.waitForFunction(() => window.__edisonNet && window.__edisonNet.outcome() && !window.__edisonNet.inMatch, null, { timeout: ms, polling: 250 }).catch(async (e) => {
    for (const q of [p, other].filter(Boolean)) {
      const dump = await q.page.evaluate(() => {
        const n = window.__edisonNet;
        const r = n?.room;
        return { status: n?.status, inMatch: n?.inMatch, games: r?.match?.games.map((g) => ({ i: g.index, d: g.decks.map((x) => !!x), first: g.first, end: g.end, logs: g.logs.map((l) => l.length), turn: g.turn })), html: document.querySelector('.duel-host')?.innerText.slice(0, 300) };
      });
      console.log(q.name, JSON.stringify(dump));
      await q.page.screenshot({ path: path.join(OUT, `debug-${q.name}.png`) });
    }
    throw e;
  });
}

async function compareGames(label, host, guest) {
  const rh = await net(host, () => window.__edisonNet.results());
  const rg = await net(guest, () => window.__edisonNet.results());
  ok(JSON.stringify(rh) === JSON.stringify(rg), `${label}: both phones agree on results ${JSON.stringify(rh.map((r) => [r.winner, r.reason, r.turns]))}`);
  for (let g = 0; g < rh.length; g++) {
    const a = await host.page.evaluate((g) => window.__edisonNet.state(g), g);
    const b = await guest.page.evaluate((g) => window.__edisonNet.state(g), g);
    if (!a || !b) continue; // a game before a reload is only on one phone's screen
    const same = JSON.stringify(a) === JSON.stringify(b);
    ok(same, `${label} game ${g + 1}: identical final state (LP ${a.players.map((p) => p.lp).join('/')}, winner ${a.winner}, turn ${a.turn})`);
    if (!same) console.log(JSON.stringify(a).slice(0, 400), '\n', JSON.stringify(b).slice(0, 400));
  }
}

const ONLY = process.env.ONLY || '';
async function match(browser, label, deckA, deckB, opts = {}) {
  if (ONLY && !label.includes(ONLY)) return;
  const host = await phone(browser, 'Hana', deckA, { bestOf: opts.bestOf, pace: opts.pace });
  const guest = await phone(browser, 'Gus', deckB, { pace: opts.pace, side: opts.side });
  const t0 = Date.now();
  const code = await createAndJoin(host, guest);
  await readyBoth(host, guest);
  const seed = await net(host, () => window.__edisonNet.room.match.start.seed);
  if (opts.side) {
    // the guest sides on the siding screen between games 1 and 2: swap one card, then Done
    await guest.page.waitForSelector('.sd-done', { timeout: 120000 });
    await guest.page.screenshot({ path: path.join(OUT, 'siding-online-portrait.png') });
    await guest.page.locator('.sd-sec--main .sd-tile').first().click();
    await guest.page.locator('.sd-sec--side .sd-tile.can').first().click();
    await guest.page.click('.sd-done');
    const sided = await host.page.waitForFunction(() => { const g = window.__edisonNet.room.match?.games[1]; return g && g.decks[1] ? g.decks[1].main.join() !== window.__edisonNet.room.match.games[0].decks[1].main.join() : null; }, null, { timeout: 20000 });
    ok(await sided.jsonValue(), 'the guest\'s sided deck reached the host for game 2');
    // a game 3 sides with no further changes
    await guest.page.evaluate(() => setInterval(() => document.querySelector('.sd-done')?.click(), 300));
  }
  if (opts.midGame) {
    await host.page.waitForFunction(() => { const c = window.__edisonNet?.room.current; return c && c.logs[0].length + c.logs[1].length > 30; }, null, { timeout: 120000, polling: 100 });
    await opts.midGame(host, guest);
  }
  await waitMatchOver(host, 120000, guest);
  await waitMatchOver(guest, 120000, host);
  console.log(`  ${label}: room ${code}, seed ${seed}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await compareGames(label, host, guest);
  // the after-match screen offers a rematch on both phones
  ok((await host.page.locator('[data-test=rematch]').count()) === 1 && (await guest.page.locator('[data-test=rematch]').count()) === 1, `${label}: rematch offered on both phones`);
  await host.ctx.close();
  await guest.ctx.close();
}

async function screenshots(browser) {
  // the host plays by hand (no bot), so the guest's phone waits and shows the chip
  const host = await phone(browser, 'Hana', 'blackwings', { bot: false });
  const guest = await phone(browser, 'Gus', 'lightsworn');
  await host.page.goto(url(host, 'friend'));
  await host.page.waitForSelector('[data-test=create-room]');
  await host.page.screenshot({ path: path.join(OUT, 'friend-landing-portrait.png') });
  await host.page.click('[data-test=join-room]');
  await host.page.fill('[data-test=join-code]', 'kqtm4825');
  await host.page.screenshot({ path: path.join(OUT, 'friend-join-portrait.png') });
  ok((await host.page.inputValue('[data-test=join-code]')) === 'KQTM-4825', 'code entry formats as KQTM-4825');
  await host.page.goto(url(host, 'play'));
  await host.page.waitForSelector('.play-tiles--friend');
  await sleep(600);
  await host.page.locator('.play-tiles--friend').scrollIntoViewIfNeeded();
  await host.page.screenshot({ path: path.join(OUT, 'duel-hub-portrait.png') });
  ok((await host.page.locator('.tabbar .tab.on').textContent()).includes('Duel'), 'Duel tab highlighted on the hub');
  await host.page.goto(url(host, 'friend'));
  ok((await host.page.locator('.tabbar .tab.on').textContent()).includes('Duel'), 'Duel tab highlighted on the friend screen');
  const code = await createAndJoin(host, guest);
  void code;
  await host.page.screenshot({ path: path.join(OUT, 'lobby-host-portrait.png') });
  await guest.page.screenshot({ path: path.join(OUT, 'lobby-guest-portrait.png') });
  await guest.page.locator('.fr-leave').scrollIntoViewIfNeeded();
  await guest.page.screenshot({ path: path.join(OUT, 'lobby-guest-portrait-scrolled.png') });
  for (const p of [host, guest]) await p.page.setViewportSize({ width: 844, height: 390 });
  await host.page.screenshot({ path: path.join(OUT, 'lobby-host-landscape.png') });
  await guest.page.screenshot({ path: path.join(OUT, 'lobby-guest-landscape.png') });
  for (const p of [host, guest]) await p.page.setViewportSize({ width: 390, height: 844 });
  // no horizontal scroll in the lobby
  const wide = await host.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1 || document.body.scrollWidth > window.innerWidth + 1);
  ok(!wide, 'lobby has no horizontal scroll at 390 px');
  await readyBoth(host, guest);
  // wait until the guest is waiting for the human host
  await guest.page.waitForSelector('.fr-chip.is-on', { timeout: 60000 });
  ok(true, 'guest shows "Opponent is thinking…" while the host decides');
  await guest.page.screenshot({ path: path.join(OUT, 'duel-waiting-chip-portrait.png') });
  await host.page.screenshot({ path: path.join(OUT, 'duel-host-portrait.png') });
  for (const p of [host, guest]) await p.page.setViewportSize({ width: 844, height: 390 });
  await sleep(500);
  await guest.page.screenshot({ path: path.join(OUT, 'duel-waiting-chip-landscape.png') });
  // a dropped connection shows "Reconnecting…" on the board
  await guest.page.evaluate(() => window.__edisonNet.drop(6000));
  await guest.page.waitForSelector('.fr-offline', { timeout: 15000 });
  ok(true, '"Reconnecting…" banner appears on the board after a drop');
  await guest.page.screenshot({ path: path.join(OUT, 'duel-reconnecting-landscape.png') });
  for (const p of [host, guest]) await p.page.setViewportSize({ width: 390, height: 844 });
  await sleep(300);
  await guest.page.screenshot({ path: path.join(OUT, 'duel-reconnecting-portrait.png') });
  await guest.page.waitForSelector('.fr-offline', { state: 'detached', timeout: 30000 });
  ok(true, 'banner goes away once reconnected');
  // the host concedes: the guest's game ends with the friend's concession
  await host.page.click('.duel-root .icon-btn--danger');
  await host.page.locator('.dlg-layer.is-open button[data-hotkey=Enter]').click();
  await guest.page.waitForFunction(() => /conceded/i.test(document.querySelector('.result-reason')?.textContent ?? '') || (window.__edisonNet && window.__edisonNet.outcome()), null, { timeout: 20000 });
  ok(true, 'host concede ends the game on the guest phone');
  await host.page.locator('.result-continue').click().catch(() => {});
  await host.page.waitForSelector('[data-test=rematch]', { timeout: 20000 });
  await host.page.screenshot({ path: path.join(OUT, 'after-match-portrait.png') });
  await host.ctx.close();
  await guest.ctx.close();
}

(async () => {
  const app = staticServer();
  const peer = PeerServer({ port: PEER_PORT, host: '127.0.0.1', path: '/edison' });
  await sleep(500);
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const t0 = Date.now();
  try {
    if (!ONLY || ONLY === 'shots') await screenshots(browser);
    const matchups = [
      ['blackwings', 'lightsworn', 1],
      ['zombies', 'gladiator-beasts', 3],
      ['tele-dad', 'x-sabers', 1],
      ['frog-monarchs', 'quickdraw-plant', 1],
      ['hero-beat', 'zombies', 1],
    ];
    for (const [a, b, bestOf] of matchups) await match(browser, `${a} vs ${b} (Bo${bestOf})`, a, b, { bestOf });
    await match(browser, 'Bo3 with siding', 'x-sabers', 'blackwings', { bestOf: 3, side: true });
    await match(browser, 'disconnect mid-game', 'lightsworn', 'blackwings', {
      pace: 20,
      midGame: async (host, guest) => {
        await guest.page.evaluate(() => window.__edisonNet.drop(4000));
        await guest.page.waitForFunction(() => window.__edisonNet.status !== 'connected', null, { timeout: 5000 });
        ok(true, 'guest notices the drop');
        await guest.page.waitForFunction(() => window.__edisonNet.status === 'connected', null, { timeout: 30000 });
        await host.page.waitForFunction(() => window.__edisonNet.status === 'connected', null, { timeout: 30000 });
        ok(true, 'both phones reconnect after the drop');
      },
    });
    await match(browser, 'guest reload mid-duel', 'gladiator-beasts', 'tele-dad', {
      pace: 40,
      midGame: async (host, guest) => {
        const before = await decisions(guest);
        await guest.page.reload();
        // the app reopens on Home with the "Duel in progress" card
        const card = guest.page.locator('.home-resume--duel');
        await card.waitFor({ timeout: 15000 }).catch(async (e) => {
          console.log('debug', await guest.page.evaluate(() => ({ hash: location.hash, saved: (localStorage.getItem('edison.duel.active.v1') || '').slice(0, 300) })));
          await guest.page.screenshot({ path: path.join(OUT, 'debug-reload.png') });
          throw e;
        });
        ok((await card.textContent()).includes('Play a friend'), 'Home shows the online duel in progress');
        await card.click();
        await guest.page.waitForSelector('.duel-root', { timeout: 20000 });
        await guest.page.waitForFunction((n) => { const c = window.__edisonNet?.room.current; return c && c.logs[0].length + c.logs[1].length > n; }, before, { timeout: 60000 });
        ok(true, `guest resumed after a reload (had ${before} decisions) and play continues`);
      },
    });
    await match(browser, 'host reload mid-duel', 'blackwings', 'zombies', {
      pace: 40,
      midGame: async (host, guest) => {
        const before = await decisions(host);
        await host.page.reload();
        // the app reopens on Home with the "Duel in progress" card
        const card = host.page.locator('.home-resume--duel');
        await card.waitFor({ timeout: 15000 }).catch(async (e) => {
          console.log('debug', await host.page.evaluate(() => ({ hash: location.hash, saved: (localStorage.getItem('edison.duel.active.v1') || '').slice(0, 300) })));
          await host.page.screenshot({ path: path.join(OUT, 'debug-reload.png') });
          throw e;
        });
        ok((await card.textContent()).includes('Play a friend'), 'Home shows the online duel in progress');
        await card.click();
        await host.page.waitForSelector('.duel-root', { timeout: 20000 });
        await host.page.waitForFunction((n) => { const c = window.__edisonNet?.room.current; return c && c.logs[0].length + c.logs[1].length > n; }, before, { timeout: 60000 });
        ok(true, `host resumed after a reload (had ${before} decisions) and play continues`);
      },
    });
  } catch (e) {
    failures++;
    console.log('FAIL', e.stack || e);
  } finally {
    await browser.close();
    app.close();
    peer.close?.();
  }
  ok(errors.length === 0, `no console errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
  console.log(`friend-e2e: ${failures} failure${failures === 1 ? '' : 's'}, ${((Date.now() - t0) / 1000).toFixed(0)}s, screenshots in ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
