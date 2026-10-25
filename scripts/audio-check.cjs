// Audio checks in a real browser (Playwright Chromium, emulating an iPhone 13) against the Vite
// dev server:
//   - every recorded sample and music loop loads (HTTP 200) and decodes;
//   - music starts after the first tap (built-in recording, audible on the music bus);
//   - every slot is a playlist: Skip moves to another track, Now playing shows it, built-in tracks
//     can be switched off;
//   - "Your music": files picked in Settings are stored, play as the slot's playlist instead of
//     the built-in tracks, and Remove brings the built-in playlist back;
//   - the Haptics switch in Settings turns haptic feedback on and off;
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

const generated = [];
/** Two short test songs (the first can be given on the command line). */
function testFiles() {
  if (generated.length) return generated.slice(0, 2);
  for (const [i, hz] of [[1, 330], [2, 392]]) {
    const f = path.join(os.tmpdir(), `edison-audio-check-${process.pid}-${i}.mp3`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=8`, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '96k', f]);
    generated.push(f);
  }
  if (process.argv[2]) generated[0] = process.argv[2];
  return generated.slice(0, 2);
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
    const MENU = ['rec:first-snow', 'rec:snow-drift', 'rec:two-hour-delay', 'rec:chill-lofi'];
    ok(playing && MENU.includes(playing.playing), `menu playlist plays after the first tap (${JSON.stringify(playing)})`);

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

    // skip: another menu track, never the same one
    const skips = [playing.playing];
    for (let i = 0; i < 3; i++) {
      const prev = skips[skips.length - 1];
      await page.evaluate(async () => (await import('/src/ui/audio/music.ts')).music.skip());
      const nxt = await waitFor(
        page,
        async (prev) => {
          const { music } = await import('/src/ui/audio/music.ts');
          return music.playing && music.playing !== prev ? { playing: music.playing } : null;
        },
        prev,
      );
      skips.push(nxt && nxt.playing);
    }
    ok(skips.every((k) => MENU.includes(k)) && skips.every((k, i) => i === 0 || k !== skips[i - 1]), `Skip moves through the menu playlist without repeats: ${skips.join(' → ')}`);

    // ---------------------------------------------------------------- all samples decode (music: on demand)
    const status = await page.evaluate(async () => {
      const s = await import('/src/ui/audio/samples.ts');
      await s.loadSfxSamples();
      const m = {};
      for (const t of s.MUSIC_TRACKS) {
        try {
          const b = await s.loadMusicTrack(t.id);
          m[t.id] = { ok: b.duration > t.loopEnd && b.numberOfChannels === 2, dur: +b.duration.toFixed(2), loopEnd: t.loopEnd };
          s.dropMusicTrack(t.id);
        } catch (e) {
          m[t.id] = { ok: false, err: String(e) };
        }
      }
      return { sfx: s.sampleStatus(), music: m };
    });
    ok(status.sfx.loaded === status.sfx.total && status.sfx.failed.length === 0, `all ${status.sfx.total} sound-effect samples decoded (${status.sfx.loaded} ok, failed: ${status.sfx.failed.join(', ') || 'none'})`);
    for (const [id, m] of Object.entries(status.music)) ok(m.ok, `music/${id}.m4a decodes: ${JSON.stringify(m)}`);
    const bad = [...audioResponses].filter(([, st]) => st !== 200 && st !== 304);
    ok(bad.length === 0, `${audioResponses.size} audio requests, all 200${bad.length ? ' — bad: ' + JSON.stringify(bad) : ''}`);

    // ---------------------------------------------------------------- Settings: now playing, built-in tracks, haptics
    await page.goto(BASE + '#/settings', { waitUntil: 'load' });
    await page.waitForSelector('.np-row');
    await page.tap('.ios-group-h'); // a tap on a plain heading unlocks audio
    const np = await waitFor(page, () => {
      const t = document.querySelector('.np-row .ym-desc')?.textContent ?? '';
      return t.includes('·') ? { text: t, skip: !document.querySelector('.np-skip').disabled } : null;
    });
    ok(np && np.skip, `Now playing shows the track with Skip enabled (${JSON.stringify(np)})`);

    // switch off every menu track but First Snow: the playlist only plays First Snow after a skip
    await page.evaluate(async () => {
      const { updateSettings } = await import('/src/ui/settings.ts');
      updateSettings({ musicOff: ['snow-drift', 'two-hour-delay', 'chill-lofi'] });
    });
    const only = await page.evaluate(async () => (await import('/src/ui/audio/music.ts')).music.playlist('menu').map((t) => t.key));
    ok(only.length === 1 && only[0] === 'rec:first-snow', `switched-off built-in tracks leave the playlist (${only.join(', ')})`);
    await page.evaluate(async () => (await import('/src/ui/settings.ts')).updateSettings({ musicOff: [] }));

    // haptics switch
    const hap = await page.evaluate(async () => {
      const { haptic, hapticLog } = await import('/src/ui/haptics.ts');
      const { updateSettings } = await import('/src/ui/settings.ts');
      const n0 = hapticLog.length;
      haptic('medium');
      const on = hapticLog.length - n0;
      await new Promise((r) => setTimeout(r, 60));
      updateSettings({ haptics: false });
      haptic('heavy');
      const off = hapticLog.length - n0 - on;
      updateSettings({ haptics: true });
      return { on, off };
    });
    ok(hap.on === 1 && hap.off === 0, `haptics fire when on and stay quiet when off (${JSON.stringify(hap)})`);
    const hapRow = page.locator('.ios-row', { hasText: 'Haptics' }).first();
    await hapRow.scrollIntoViewIfNeeded();
    await hapRow.locator('.toggle').tap();
    const hapOff = await page.evaluate(async () => (await import('/src/ui/settings.ts')).getSettings().haptics);
    await hapRow.locator('.toggle').tap();
    const hapOn = await page.evaluate(async () => (await import('/src/ui/settings.ts')).getSettings().haptics);
    ok(hapOff === false && hapOn === true, `the Haptics switch in Settings toggles the setting (off: ${hapOff}, on: ${hapOn})`);

    // ---------------------------------------------------------------- Your music (two files → a playlist)
    await page.waitForSelector('input[type=file][data-slot=menu]', { state: 'attached' });
    await page.tap('.ym-slot[data-slot=menu] .ym-add');
    await page.setInputFiles('input[type=file][data-slot=menu]', testFiles());
    const stored = await waitFor(page, async () => {
      const { userTracks } = await import('/src/ui/audio/userMusic.ts');
      const { music } = await import('/src/ui/audio/music.ts');
      const mine = (await userTracks()).filter((t) => t.slot === 'menu');
      return mine.length === 2 && music.playing && music.playing.startsWith('user:') ? { files: mine.map((t) => t.name), playing: music.playing, np: music.nowPlaying() } : null;
    });
    ok(stored && stored.files.length === 2, `Your music: two files stored and playing as the menu playlist (${JSON.stringify(stored)})`);
    const userSkip = await page.evaluate(async () => {
      const { music } = await import('/src/ui/audio/music.ts');
      const a = music.playing;
      music.skip();
      for (let i = 0; i < 60 && music.playing === a; i++) await new Promise((r) => setTimeout(r, 100));
      return { from: a, to: music.playing };
    });
    ok(userSkip.to && userSkip.to.startsWith('user:') && userSkip.to !== userSkip.from, `Skip switches between your files (${JSON.stringify(userSkip)})`);
    const rows = await page.$$eval('.ym-slot[data-slot=menu] .ym-file', (els) => els.map((e) => e.textContent));
    ok(rows.length === 2, `Your music lists both files with Remove buttons (${JSON.stringify(rows)})`);
    // survives a reload (IndexedDB)
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.ios-group-h');
    await page.tap('.ios-group-h');
    const again = await waitFor(page, async () => {
      const { music } = await import('/src/ui/audio/music.ts');
      return music.playing && music.playing.startsWith('user:') ? { playing: music.playing } : null;
    });
    ok(!!again, 'Your music still plays after reloading the app');
    for (let i = 0; i < 2; i++) {
      const rm = page.locator('.ym-slot[data-slot=menu] .ym-remove').first();
      await rm.scrollIntoViewIfNeeded();
      await rm.tap();
      await page.waitForTimeout(300);
    }
    const removed = await waitFor(page, async () => {
      const { userTracks } = await import('/src/ui/audio/userMusic.ts');
      const { music } = await import('/src/ui/audio/music.ts');
      const mine = (await userTracks()).filter((t) => t.slot === 'menu');
      return !mine.length && music.playing && music.playing.startsWith('rec:') ? { playing: music.playing } : null;
    });
    ok(!!removed, `Remove deletes the files and the built-in menu playlist comes back (${JSON.stringify(removed)})`);

    // credits sheet
    await page.tap('text=Audio credits');
    await page.waitForSelector('.credits-list');
    const credits = await page.$$eval('.credit', (els) => els.length);
    ok(credits >= 18, `Audio credits sheet lists ${credits} entries`);
    await page.keyboard.press('Escape');

    // ---------------------------------------------------------------- a duel (AI vs AI)
    await page.goto(BASE + 'duel-dev.html?mode=spectate&seed=7', { waitUntil: 'load' });
    await page.tap('body', { position: { x: 30, y: 30 } });
    const DUEL = ['rec:funky-lofi-jam', 'rec:winter-blues', 'rec:lofi-hip-hop', 'rec:autumn'];
    const duel = await waitFor(
      page,
      async () => {
        const { music } = await import('/src/ui/audio/music.ts');
        return music.playing && music.nowPlaying()?.slot === 'duel' ? { playing: music.playing } : null;
      },
      null,
      20000,
    );
    ok(duel && DUEL.includes(duel.playing), `duel playlist: ${JSON.stringify(duel)}`);
    const pinch = await page.evaluate(async () => {
      const { music } = await import('/src/ui/audio/music.ts');
      music.setPinch(true);
      for (let i = 0; i < 80 && music.nowPlaying()?.slot !== 'pinch'; i++) await new Promise((r) => setTimeout(r, 100));
      const p = music.playing;
      music.setPinch(false);
      for (let i = 0; i < 80 && music.nowPlaying()?.slot !== 'duel'; i++) await new Promise((r) => setTimeout(r, 100));
      return { pinch: p, back: music.playing };
    });
    ok(['rec:fire-place', 'rec:a-little-shade'].includes(pinch.pinch) && pinch.back === duel.playing, `pinch switches to the pinch playlist and back to the same duel track (${JSON.stringify(pinch)})`);
    await page.waitForTimeout(4000);

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
      for (const t of s.MUSIC_TRACKS) {
        const ac = new OfflineAudioContext(2, SR * 20, SR);
        await renderRecordedMusic(ac, t.id, { volume: 0.6, offset: 20 });
        out['music:' + t.id] = measure(await ac.startRendering());
        s.dropMusicTrack(t.id);
      }
      for (const [id, pinch] of [['menu', false], ['duel', false], ['duel', true]]) {
        const ac = new OfflineAudioContext(2, SR * 12, SR);
        renderMusic(ac, id, 12, { volume: 0.6, pinch });
        out[`procedural:${id}${pinch ? '+pinch' : ''}`] = measure(await ac.startRendering());
      }
      // loop seam of the built-in tracks: render across the loop point and look for a jump (the seam
      // sits on a downbeat, so a drum hit there may be as sharp as the loudest hit elsewhere)
      const seams = {};
      for (const lp of s.MUSIC_TRACKS) {
        const slot = lp.id;
        const len = lp.loopEnd - lp.loopStart;
        const ac = new OfflineAudioContext(2, SR * 4, SR);
        await renderRecordedMusic(ac, lp.id, { volume: 0.6, offset: len - 2 });
        s.dropMusicTrack(lp.id);
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
    for (const slot of Object.keys(L).filter((k) => k.startsWith('music:')).map((k) => k.slice(6))) {
      const m = L['music:' + slot];
      ok(m.loud50 <= medLoud - 6 && m.rms <= medLoud - 10, `music ${slot} sits well below the effects (music loudest ${m.loud50}, avg ${m.rms} vs quietest medium hit ${medLoud})`);
    }
    for (const [slot, sm] of Object.entries(levels.seams)) ok(sm.seamStep <= Math.max(0.02, 1.5 * sm.elsewhereMax), `${slot} loop seam has no click (step ${sm.seamStep} vs ${sm.elsewhereMax} elsewhere)`);

    if (offsite.length) console.log(`(ignored ${offsite.length} failed requests to external card-image hosts, e.g. ${offsite[0]})`);
    ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
  } catch (e) {
    ok(false, 'unexpected: ' + (e && e.stack ? e.stack : e));
  } finally {
    await browser.close();
    vite.kill();
    for (const f of generated) if (f !== process.argv[2]) fs.rmSync(f, { force: true });
  }
  console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nAll audio checks passed');
  process.exit(fails.length ? 1 : 0);
})();
