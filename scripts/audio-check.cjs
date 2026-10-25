// Audio checks in a real browser (Playwright Chromium, emulating an iPhone 13) against the Vite
// dev server:
//   - every recorded sample and music loop loads (HTTP 200) and decodes;
//   - music starts after the first tap (built-in recording, audible on the music bus);
//   - "Your music": a file picked in Settings is stored, plays instead of the built-in track,
//     and Remove brings the built-in track back;
//   - a duel switches to the duel track and plays recorded sound effects;
//   - sound effects and music rendered offline: levels per sound, music well below the effects;
//   - no console errors.
//
// Playwright is not a project dependency: run with it on NODE_PATH, e.g.
//   NODE_PATH=/opt/node-tools/node_modules node scripts/audio-check.cjs [test-audio-file]
// The optional file is used for "Your music" (a short tone is generated with ffmpeg otherwise).
const { chromium, devices } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 5000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}/`;
const root = path.resolve(__dirname, '..');
const fails = [];
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) fails.push(msg);
};

let generated = null;
function testFile() {
  if (process.argv[2]) return process.argv[2];
  if (generated) return generated;
  const f = (generated = path.join(os.tmpdir(), `edison-audio-check-${process.pid}.mp3`));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=8', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '96k', f]);
  return f;
}

async function waitFor(page, fn, arg, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch((e) => ({ error: String(e) }));
    if (v && !v.error) return v;
    if (Date.now() - t0 > ms) return v;
    await page.waitForTimeout(150);
  }
}

(async () => {
  // run Vite's own entry (not through npx) so killing it stops the server
  const vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite did not start')), 30000);
    vite.stdout.on('data', (d) => String(d).includes('Local') && (clearTimeout(t), res()));
  });
  const browser = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  const errors = [];
  const offsite = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = (m.location() && m.location().url) || '';
    // card artwork comes from an external image host, which may be unreachable here
    if (m.text().startsWith('Failed to load resource') && where && !where.startsWith(BASE)) offsite.push(where);
    else errors.push(m.text() + (where ? ' @ ' + where : ''));
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  const audioResponses = new Map();
  page.on('response', (r) => r.url().includes('/audio/') && audioResponses.set(r.url().replace(BASE, ''), r.status()));

  try {
    // ---------------------------------------------------------------- load + first tap
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const before = await page.evaluate(async () => {
      const core = await import('/src/ui/audio/core.ts');
      return { ctx: !!core.audioRunning() };
    });
    ok(!before.ctx, 'no audio before the first tap (iOS rule)');

    await page.tap('body', { position: { x: 30, y: 30 } });
    const playing = await waitFor(page, async () => {
      const { music } = await import('/src/ui/audio/music.ts');
      const core = await import('/src/ui/audio/core.ts');
      return core.audioRunning() && music.playing ? { playing: music.playing } : null;
    });
    ok(playing && playing.playing === 'recorded:menu', `menu music plays after the first tap (${JSON.stringify(playing)})`);

    // is it audible? tap the music bus
    const level = await page.evaluate(async () => {
      const core = await import('/src/ui/audio/core.ts');
      const ac = core.audioContext();
      const an = ac.createAnalyser();
      an.fftSize = 2048;
      core.graphFor(ac).music.connect(an);
      const d = new Float32Array(2048);
      let peak = 0;
      for (let i = 0; i < 25; i++) {
        await new Promise((r) => setTimeout(r, 100));
        an.getFloatTimeDomainData(d);
        for (const x of d) peak = Math.max(peak, Math.abs(x));
      }
      core.graphFor(ac).music.disconnect(an);
      return peak;
    });
    ok(level > 0.01, `menu music is audible on the music bus (peak ${level.toFixed(3)})`);

    // ---------------------------------------------------------------- all samples decode
    const status = await page.evaluate(async () => {
      const s = await import('/src/ui/audio/samples.ts');
      await s.loadSfxSamples();
      const m = {};
      for (const slot of ['menu', 'duel', 'pinch']) {
        try {
          const b = await s.loadMusicLoop(slot);
          m[slot] = { ok: true, dur: +b.duration.toFixed(2), ch: b.numberOfChannels, loopEnd: s.MUSIC_LOOPS[slot].loopEnd };
        } catch (e) {
          m[slot] = { ok: false, err: String(e) };
        }
      }
      return { sfx: s.sampleStatus(), music: m };
    });
    ok(status.sfx.loaded === status.sfx.total && status.sfx.failed.length === 0, `all ${status.sfx.total} sound-effect samples decoded (${status.sfx.loaded} ok, failed: ${status.sfx.failed.join(', ') || 'none'})`);
    for (const [slot, m] of Object.entries(status.music)) ok(m.ok && m.dur > m.loopEnd && m.ch === 2, `music/${slot}.m4a decodes: ${JSON.stringify(m)}`);
    const bad = [...audioResponses].filter(([, st]) => st !== 200 && st !== 304);
    ok(audioResponses.size >= status.sfx.total + 3 && bad.length === 0, `${audioResponses.size} audio requests, all 200${bad.length ? ' — bad: ' + JSON.stringify(bad) : ''}`);

    // ---------------------------------------------------------------- Your music
    await page.goto(BASE + '#/settings', { waitUntil: 'load' });
    await page.waitForSelector('input[type=file][data-slot=menu]', { state: 'attached' });
    await page.tap('.ym-row button.ios-inline-btn'); // a real tap (opens no picker headless)
    await page.setInputFiles('input[type=file][data-slot=menu]', testFile());
    const stored = await waitFor(page, async () => {
      const { userTrackInfo } = await import('/src/ui/audio/userMusic.ts');
      const { music } = await import('/src/ui/audio/music.ts');
      const info = await userTrackInfo();
      return info.menu && music.playing === 'user:menu' ? { name: info.menu.name, size: info.menu.size, playing: music.playing } : null;
    });
    ok(stored && stored.playing === 'user:menu', `Your music: file stored in IndexedDB and playing instead of the built-in menu track (${JSON.stringify(stored)})`);
    const rowText = await page.textContent('.ym-row');
    ok(rowText.includes(path.basename(testFile())) && rowText.includes('Remove'), `Your music row shows the file and a Remove button ("${rowText.trim()}")`);
    // survives a reload (IndexedDB)
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.ios-group-h');
    await page.tap('.ios-group-h'); // a tap on a plain heading unlocks audio
    const again = await waitFor(page, async () => {
      const { music } = await import('/src/ui/audio/music.ts');
      return music.playing === 'user:menu' ? { playing: music.playing } : null;
    });
    ok(!!again, 'Your music still plays after reloading the app');
    const rm = page.locator('.ym-row .ym-remove:not([hidden])').first();
    await rm.scrollIntoViewIfNeeded();
    await rm.tap();
    const removed = await waitFor(page, async () => {
      const { userTrackInfo } = await import('/src/ui/audio/userMusic.ts');
      const { music } = await import('/src/ui/audio/music.ts');
      const info = await userTrackInfo();
      return !info.menu && music.playing === 'recorded:menu' ? { playing: music.playing } : null;
    });
    ok(!!removed, 'Remove deletes the file and the built-in menu track comes back');

    // credits sheet
    await page.tap('text=Audio credits');
    await page.waitForSelector('.credits-list');
    const credits = await page.$$eval('.credit', (els) => els.length);
    ok(credits >= 10, `Audio credits sheet lists ${credits} entries`);
    await page.keyboard.press('Escape');

    // ---------------------------------------------------------------- a duel (AI vs AI)
    await page.goto(BASE + 'duel-dev.html?mode=spectate&seed=7', { waitUntil: 'load' });
    await page.tap('body', { position: { x: 30, y: 30 } });
    const duel = await waitFor(
      page,
      async () => {
        const { music } = await import('/src/ui/audio/music.ts');
        return music.playing && music.playing.endsWith(':duel') ? { playing: music.playing } : null;
      },
      null,
      20000,
    );
    ok(duel && duel.playing === 'recorded:duel', `duel music: ${JSON.stringify(duel)}`);
    await page.waitForTimeout(6000);

    // ---------------------------------------------------------------- offline levels
    const levels = await page.evaluate(async () => {
      const { Sfx } = await import('/src/ui/duel/sound.ts');
      const s = await import('/src/ui/audio/samples.ts');
      const { renderMusic, renderRecordedMusic } = await import('/src/ui/audio/music.ts');
      await s.loadSfxSamples();
      const SR = 44100;
      const measure = (buf) => {
        const L = buf.getChannelData(0);
        const R = buf.getChannelData(1);
        let peak = 0;
        let sum = 0;
        let best = 0;
        const w = Math.floor(0.05 * SR);
        let acc = 0;
        for (let i = 0; i < L.length; i++) {
          const m = Math.max(Math.abs(L[i]), Math.abs(R[i]));
          peak = Math.max(peak, m);
          const e = (L[i] * L[i] + R[i] * R[i]) / 2;
          sum += e;
          acc += e;
          if (i >= w) {
            const o = (L[i - w] * L[i - w] + R[i - w] * R[i - w]) / 2;
            acc -= o;
          }
          if (i >= w) best = Math.max(best, acc / w);
        }
        const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
        return { peak: +db(peak).toFixed(1), loud50: +(10 * Math.log10(best || 1e-12)).toFixed(1), rms: +(10 * Math.log10(sum / L.length || 1e-12)).toFixed(1) };
      };
      const out = {};
      const names = ['draw', 'set', 'flip', 'shuffle', 'summon', 'synchro', 'activate', 'resolve', 'attack', 'battle', 'damage', 'bigDamage', 'recover', 'destroy', 'phase', 'turn', 'coin', 'negate', 'target', 'win', 'lose', 'click', 'error'];
      for (const n of names) {
        const ac = new OfflineAudioContext(2, SR * 3, SR);
        const fx = new Sfx({ context: ac });
        fx.volume = 0.6;
        fx.play(n);
        out[n] = measure(await ac.startRendering());
      }
      {
        const ac = new OfflineAudioContext(2, SR * 3, SR);
        const fx = new Sfx({ context: ac });
        fx.volume = 0.6;
        fx.lpTicker(1200, false);
        out.lpTicker = measure(await ac.startRendering());
      }
      for (const slot of ['menu', 'duel', 'pinch']) {
        const ac = new OfflineAudioContext(2, SR * 20, SR);
        await renderRecordedMusic(ac, slot, { volume: 0.6, offset: 20 });
        out['music:' + slot] = measure(await ac.startRendering());
      }
      for (const [id, pinch] of [['menu', false], ['duel', false], ['duel', true]]) {
        const ac = new OfflineAudioContext(2, SR * 12, SR);
        renderMusic(ac, id, 12, { volume: 0.6, pinch });
        out[`procedural:${id}${pinch ? '+pinch' : ''}`] = measure(await ac.startRendering());
      }
      // loop seam of the built-in tracks: render across the loop point and look for a jump
      const seams = {};
      for (const slot of ['menu', 'duel', 'pinch']) {
        const lp = s.MUSIC_LOOPS[slot];
        const len = lp.loopEnd - lp.loopStart;
        const ac = new OfflineAudioContext(2, SR * 4, SR);
        await renderRecordedMusic(ac, slot, { volume: 0.6, offset: len - 2 });
        const b = await ac.startRendering();
        const d = b.getChannelData(0);
        let maxStep = 0;
        let seamStep = 0;
        const seam = Math.round(2.02 * SR); // starts 0.02 s in, 2 s before the loop point
        for (let i = 1; i < d.length; i++) {
          const st = Math.abs(d[i] - d[i - 1]);
          if (Math.abs(i - seam) < 200) seamStep = Math.max(seamStep, st);
          else maxStep = Math.max(maxStep, st);
        }
        seams[slot] = { seamStep: +seamStep.toFixed(4), elsewhereMax: +maxStep.toFixed(4) };
      }
      return { out, seams };
    });
    console.log('\nOffline render at volume 0.6 (dBFS): peak / loudest 50 ms / average');
    for (const [k, v] of Object.entries(levels.out)) console.log(`  ${k.padEnd(20)} ${String(v.peak).padStart(6)} ${String(v.loud50).padStart(7)} ${String(v.rms).padStart(7)}`);
    const L = levels.out;
    const sfxNames = Object.keys(L).filter((k) => !k.includes(':'));
    ok(sfxNames.every((k) => L[k].peak > -40 && L[k].peak <= -0.5), 'every sound effect renders, none clips');
    const heavy = ['battle', 'bigDamage', 'synchro', 'destroy', 'summon', 'damage'].map((k) => L[k].peak);
    ok(Math.max(...heavy) - Math.min(...heavy) < 9, `heavy hits within 9 dB of each other (${heavy.join(', ')})`);
    const medLoud = Math.min(...['battle', 'damage', 'summon', 'attack'].map((k) => L[k].loud50));
    for (const slot of ['menu', 'duel', 'pinch']) {
      const m = L['music:' + slot];
      ok(m.loud50 <= medLoud - 6 && m.rms <= medLoud - 10, `music ${slot} sits well below the effects (music loudest ${m.loud50}, avg ${m.rms} vs quietest medium hit ${medLoud})`);
    }
    for (const [slot, sm] of Object.entries(levels.seams)) ok(sm.seamStep <= Math.max(0.02, sm.elsewhereMax), `${slot} loop seam has no click (step ${sm.seamStep} vs ${sm.elsewhereMax} elsewhere)`);

    if (offsite.length) console.log(`(ignored ${offsite.length} failed requests to external card-image hosts, e.g. ${offsite[0]})`);
    ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
  } catch (e) {
    ok(false, 'unexpected: ' + (e && e.stack ? e.stack : e));
  } finally {
    await browser.close();
    vite.kill();
    if (generated) fs.rmSync(generated, { force: true });
  }
  console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nAll audio checks passed');
  process.exit(fails.length ? 1 : 0);
})();
