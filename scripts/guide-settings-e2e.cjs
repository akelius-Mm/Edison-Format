// Guide screen and the in-duel Settings sheet (Playwright, Chromium, iPhone 13 portrait 390×844) against the built
// app served by `python3 -m http.server -d dist`.
//
//  1. Home shows "Guide · How the app works" under the banlist row; it opens the `guide` route, which has its six
//     sections, the rule-source links and the banlist counts. The section links scroll inside the page (the URL stays
//     #/guide). Settings → Help → Guide and How to Play's guide row open it too.
//  2. Duel vs AI: flag button → Settings opens a sheet over the duel (no route change). Response prompts, animation
//     speed and the duel log change at once, are saved, and survive a reload; Done returns to the same duel.
//  3. Watch AI vs AI (spectator): flag button → Settings opens the sheet (without the player-only rows).
//  Every screen: no horizontal scroll, no console errors (blocked card-art requests excepted).
//  ("Play a friend" mid-duel is covered by scripts/friend-e2e.cjs, match "settings mid-duel".)
//
// Usage (after `npm run build`; Playwright is not a project dependency):
//   npm run test:guide-e2e -- [outDir]
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

const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'edison-guide-shots');
fs.mkdirSync(OUT, { recursive: true });
const DIST = path.join(__dirname, '..', 'dist');
const APP_PORT = 8484;
const BASE = `http://127.0.0.1:${APP_PORT}/`;
const VIEW = { width: 390, height: 844 };
const IGNORED = /Failed to load resource|net::ERR|ygoprodeck|yugipedia|ERR_TUNNEL|ERR_PROXY|ERR_CONNECTION/i;

let failures = 0;
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
  return cond;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name, fullPage = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });

const SEED = { animationSpeed: 1, sound: false, music: false, haptics: false, confirmEndTurn: false, officialImages: false, responsePrompts: 'smart', showLog: true };

async function phone(browser, errors) {
  const iphone = { ...devices['iPhone 13'] };
  delete iphone.defaultBrowserType;
  const ctx = await browser.newContext({ ...iphone, viewport: VIEW });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await ctx.addInitScript((s) => {
    if (localStorage.getItem('e2e.init')) return;
    localStorage.setItem('e2e.init', '1');
    localStorage.setItem('edison.settings.v1', JSON.stringify({ playerName: 'Tester', nameChosen: true, ...s }));
    localStorage.setItem('edison.settings.musicOn.v1', 'true');
    localStorage.setItem('edison.settings.firstDraw.v1', 'true');
    localStorage.setItem('edison.hint.hold', '1');
  }, SEED);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error' || IGNORED.test(m.text())) return;
    errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`));
  return { ctx, page };
}

/** Horizontal overflow of the page in px (0 when none). */
const overflow = (page) => page.evaluate(() => Math.max(document.scrollingElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('edison.settings.v1') || '{}'));
const live = '.screen:not(.screen-leave)';

async function guide(page) {
  await page.goto(BASE + '#/title');
  const row = page.locator(`${live} [data-test=home-guide]`);
  await row.waitFor({ timeout: 15000 });
  ok(/Guide · How the app works/.test(await row.innerText()), 'home: the Guide row reads "Guide · How the app works"');
  const order = await page.evaluate(() => {
    const ban = document.querySelector('[data-test=home-banlist]')?.closest('section');
    const g = document.querySelector('[data-test=home-guide]')?.closest('section');
    return !!ban && !!g && ban.nextElementSibling === g;
  });
  ok(order, 'home: the Guide row sits right under the banlist row');
  await row.scrollIntoViewIfNeeded();
  await sleep(300);
  await shot(page, 'home-guide-row');
  await row.click();
  await page.waitForFunction(() => location.hash === '#/guide' && !!document.querySelector('.guide-screen:not(.screen-leave)'));
  await sleep(400);
  ok(true, 'home: the Guide row opens #/guide');

  const info = await page.evaluate(() => {
    const s = document.querySelector('.guide-screen:not(.screen-leave)');
    return {
      sections: [...s.querySelectorAll('.gd-section .gd-h')].map((e) => e.textContent),
      links: [...s.querySelectorAll('.gd-section a')].map((a) => a.href),
      text: s.innerText,
      bg: getComputedStyle(s.querySelector('.gd-section')).backgroundColor,
      color: getComputedStyle(s.querySelector('.gd-section p, .gd-section li')).color,
    };
  });
  ok(JSON.stringify(info.sections) === JSON.stringify(['Getting around', 'In a duel', 'Playing friends', 'Where the rules come from', 'Card pictures', 'Something looks wrong?']), `guide: six sections (${info.sections.join(' / ')})`);
  for (const u of ['https://edisonrul.ing/', 'https://www.edisonformat.com/rulebook.html', 'https://www.edisonformat.com/edison-rule-differences.html', 'https://www.edisonformat.com/functional-errata.html', 'https://www.edisonformat.com/banlist.html'])
    ok(info.links.includes(u), `guide: links ${u}`);
  ok(/43 Forbidden, 70 Limited, 19 Semi-Limited/.test(info.text), 'guide: banlist counts 43 / 70 / 19');
  ok(/Official card images/.test(info.text) && /Response prompts/.test(info.text) && /Report a problem/.test(info.text) && /Restart match/.test(info.text) && /Rematch/.test(info.text), 'guide: names the app\'s own labels');
  ok(info.bg !== 'rgba(0, 0, 0, 0)' && info.color !== 'rgb(0, 0, 0)', `guide: themed (section ${info.bg}, text ${info.color})`);
  ok((await overflow(page)) <= 1, 'guide: no horizontal scroll');
  await shot(page, 'guide-top');
  await shot(page, 'guide-full', true);

  // section links scroll in code; the route stays #/guide
  await page.locator(`${live} .gd-toc-btn[data-target=online]`).click();
  await sleep(900);
  const pos = await page.evaluate(() => {
    const t = document.querySelector('.guide-screen:not(.screen-leave) [data-section=online]').getBoundingClientRect().top;
    const se = document.body.scrollHeight > document.scrollingElement.scrollHeight ? document.body : document.scrollingElement;
    return { top: Math.round(t), hash: location.hash, bottom: se.scrollTop + se.clientHeight >= se.scrollHeight - 2 };
  });
  // the section comes to the top, or the page is scrolled as far as it goes
  ok(pos.hash === '#/guide' && pos.top >= 0 && (pos.top < 140 || (pos.bottom && pos.top < 400)), `guide: "Playing friends" link scrolls to the section (top ${pos.top}px, hash ${pos.hash})`);
  await shot(page, 'guide-playing-friends');
  // the in-app banlist link
  await page.locator(`${live} .gd-link`, { hasText: 'Banlist' }).click();
  await page.waitForFunction(() => location.hash === '#/rules?tab=banlist');
  ok(true, 'guide: the banlist link opens How to Play → Banlist');

  // deep link to a section
  await page.goto(BASE + '#/guide?section=wrong');
  await page.waitForSelector('.guide-screen');
  await sleep(700);
  const deep = await page.evaluate(() => {
    const se = document.body.scrollHeight > document.scrollingElement.scrollHeight ? document.body : document.scrollingElement;
    return se.scrollTop > 0 && se.scrollTop + se.clientHeight >= se.scrollHeight - 2 ? Math.round(document.querySelector('.guide-screen:not(.screen-leave) [data-section=wrong]').getBoundingClientRect().top) : -1;
  });
  ok(deep >= 0 && deep < 500, `guide: #/guide?section=wrong opens at that section (top ${deep}px)`);

  // Settings → Help → Guide
  await page.goto(BASE + '#/settings');
  const sg = page.locator(`${live} .ios-row--nav`, { hasText: 'Guide' });
  await sg.scrollIntoViewIfNeeded();
  await sleep(200);
  await shot(page, 'settings-guide-row');
  await sg.click();
  await page.waitForFunction(() => location.hash === '#/guide');
  ok(true, 'settings: Help → Guide opens the guide');
  // How to Play → guide row
  await page.goto(BASE + '#/rules');
  const rg = page.locator(`${live} [data-test=home-guide]`);
  await rg.scrollIntoViewIfNeeded();
  ok((await overflow(page)) <= 1, 'how to play: no horizontal scroll with the guide row');
  await shot(page, 'rules-guide-row');
  await rg.click();
  await page.waitForFunction(() => location.hash === '#/guide');
  ok(true, 'how to play: the guide row opens the guide');
}

async function openSheet(page) {
  await page.locator('.duel-root .icon-btn--danger').click();
  await page.locator('.dlg--leave button', { hasText: 'Settings' }).click();
  const sheet = page.locator('[data-test=duel-settings]');
  await sheet.waitFor({ timeout: 5000 });
  await sleep(300);
  return sheet;
}

async function aiDuel(page) {
  await page.goto(BASE + '#/duel');
  await page.locator(`${live} .dkc-box`).first().click();
  const go = page.locator(`${live} button.cta`, { hasText: 'Duel' }).last();
  await go.waitFor({ timeout: 10000 });
  await go.click();
  await page.waitForSelector('.duel-root.awaiting-action, .duel-root .dlg-layer.is-open', { timeout: 30000 });
  const hash = await page.evaluate(() => location.hash);
  const sheet = await openSheet(page);
  const labels = await sheet.locator('.ios-label').allInnerTexts();
  for (const l of ['Animation speed', 'Response prompts', 'Confirm end of turn', 'Show duel log', 'Sound effects', 'Music', 'Volume', 'Haptics', 'Official card images'])
    ok(labels.includes(l), `AI duel sheet: has "${l}"`);
  ok((await page.evaluate(() => location.hash)) === hash && (await page.locator('.duel-root').count()) === 1, 'AI duel sheet: opens over the duel (no route change)');
  ok((await overflow(page)) <= 1, 'AI duel sheet: no horizontal scroll');
  const fits = await sheet.evaluate((el) => {
    const r = el.closest('.modal').getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
  });
  ok(fits, 'AI duel sheet: the sheet fits the phone screen');
  await shot(page, 'duel-settings-sheet');

  await sheet.locator('.seg-btn', { hasText: 'Always' }).click();
  await sheet.locator('.seg-btn', { hasText: 'Fast' }).click();
  await sheet.locator('input[aria-label="Show duel log"]').evaluate((i) => i.click());
  await sheet.locator('input[aria-label=Volume]').evaluate((i) => {
    i.value = '0.3';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const s = await saved(page);
  ok(s.responsePrompts === 'always' && s.animationSpeed === 0.5 && s.showLog === false && Math.abs(s.volume - 0.3) < 1e-9, `AI duel sheet: changes saved at once (${JSON.stringify({ r: s.responsePrompts, a: s.animationSpeed, log: s.showLog, v: s.volume })})`);
  const applied = await page.evaluate(() => {
    const r = document.querySelector('.duel-root');
    return { sp: r.style.getPropertyValue('--sp'), hideLog: r.classList.contains('hide-log') };
  });
  ok(applied.sp === '0.5' && applied.hideLog, `AI duel sheet: animation speed and log apply to the running duel (--sp ${applied.sp}, hide-log ${applied.hideLog})`);
  await sheet.locator('input[aria-label="Sound effects"]').evaluate((i) => i.click());
  const soundOn = await page.evaluate(() => !document.querySelector('.duel-root .icon-btn.is-off') && JSON.parse(localStorage.getItem('edison.settings.v1')).sound === true);
  ok(soundOn, 'AI duel sheet: Sound effects updates the duel\'s sound button');
  await sheet.locator('input[aria-label="Sound effects"]').evaluate((i) => i.click());
  await shot(page, 'duel-settings-changed');
  await page.locator('.modal-foot button', { hasText: 'Done' }).click();
  await sleep(400);
  ok(!(await page.locator('.modal-backdrop:not(.out)').count()) && (await page.locator('.duel-root').count()) === 1 && (await page.evaluate(() => location.hash)) === hash, 'AI duel sheet: Done returns to the same duel');
  await shot(page, 'duel-after-settings');

  // saved across a reload: the Settings screen shows the new values
  await page.reload();
  await page.goto(BASE + '#/settings');
  await sleep(400);
  const on = await page.evaluate(() => [...document.querySelectorAll('.screen:not(.screen-leave) .seg-btn.on')].map((b) => b.textContent));
  ok(on.includes('Always') && on.includes('Fast'), `settings persist after reload (selected: ${on.join(', ')})`);
}

async function spectator(page) {
  await page.goto(BASE + '#/exhibition');
  await page.locator(`${live} button.cta`, { hasText: 'Start exhibition' }).click();
  await page.waitForSelector('.duel-root.is-spectator', { timeout: 20000 });
  await sleep(800);
  const sheet = await openSheet(page);
  const labels = await sheet.locator('.ios-label').allInnerTexts();
  ok(labels.includes('Animation speed') && labels.includes('Sound effects') && !labels.includes('Response prompts'), `spectator sheet: opens without player-only rows (${labels.join(', ')})`);
  ok((await overflow(page)) <= 1, 'spectator sheet: no horizontal scroll');
  await shot(page, 'spectator-settings-sheet');
  await page.keyboard.press('Escape');
  await sleep(400);
  ok((await page.locator('.duel-root.is-spectator').count()) === 1, 'spectator sheet: Escape closes it and the exhibition goes on');
}

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.log('Build first: npm run build');
    process.exit(1);
  }
  const server = spawn('python3', ['-m', 'http.server', String(APP_PORT), '--bind', '127.0.0.1', '-d', DIST], { stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch();
  const t0 = Date.now();
  const errors = [];
  try {
    const { ctx, page } = await phone(browser, errors);
    for (const [name, fn] of [['guide', guide], ['AI duel', aiDuel], ['spectator', spectator]]) {
      try {
        await fn(page);
      } catch (e) {
        failures++;
        console.log(`FAIL ${name}: ${e.stack || e}`);
        await shot(page, `fail-${name.replace(/\W+/g, '_')}`).catch(() => {});
      }
    }
    await ctx.close();
  } finally {
    await browser.close();
    server.kill();
  }
  ok(!errors.length, `no console errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
  console.log(`guide-settings-e2e: ${checks - failures}/${checks} checks passed, ${failures} failure${failures === 1 ? '' : 's'}, ${((Date.now() - t0) / 1000).toFixed(0)}s, screenshots in ${OUT}`);
  process.exit(failures ? 1 : 0);
})();
