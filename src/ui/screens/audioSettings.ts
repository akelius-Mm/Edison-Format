// Settings → Audio extras: "Now playing" with Skip, the built-in track switches, "Your music"
// (files from the device for the Menu, Duel and Pinch playlists) and the Audio credits sheet.
import { AUDIO_CREDITS } from '../audio/credits';
import { type NowPlaying, music } from '../audio/music';
import { MUSIC_SLOTS, MUSIC_TRACKS, type MusicSlot, decodeAudio } from '../audio/samples';
import { MAX_USER_TRACKS, MAX_USER_TRACK_BYTES, USER_SLOTS, addUserTrack, removeUserTrack, userTracks } from '../audio/userMusic';
import { getSettings, updateSettings } from '../settings';
import { iosGroup, iosNav, iosRow } from './components';
import { clear, h, modal, toast, toggle } from './dom';

const SLOT_LABEL: Record<MusicSlot, string> = { menu: 'Menu', duel: 'Duel', pinch: 'Pinch' };
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ---------------------------------------------------------------- now playing
/** "Now playing: title · artist" with a Skip button; follows the music as it changes. */
export function nowPlayingRow() {
  const desc = h('span', { class: 'ym-desc np-desc' }, 'Nothing playing');
  const skip = h('button', { type: 'button', class: 'ios-inline-btn np-skip', disabled: true, 'aria-label': 'Skip to the next track' }, 'Skip');
  const row = iosRow('Now playing', desc, skip, { cls: 'np-row' });
  const paint = (np: NowPlaying | null) => {
    clear(desc);
    if (np) desc.append(h('span', { class: 'ym-name' }, np.title), ` · ${np.artist}`);
    else desc.append(getSettings().music ? 'Starts with your first tap' : 'Music is off');
    skip.disabled = !np?.canSkip;
  };
  skip.addEventListener('click', () => music.skip());
  paint(music.nowPlaying());
  const off = music.onNowPlaying((np) => {
    if (row.dataset.mounted && !row.isConnected) return void off();
    paint(np);
  });
  requestAnimationFrame(() => (row.dataset.mounted = '1'));
  return row;
}

// ---------------------------------------------------------------- built-in tracks
function builtInSummary() {
  const off = new Set(getSettings().musicOff ?? []);
  return `${MUSIC_TRACKS.filter((t) => !off.has(t.id)).length} of ${MUSIC_TRACKS.length}`;
}

/** Switches for the built-in tracks of each playlist (at least one stays on per slot). */
export function showBuiltInTracks(onDone?: () => void) {
  const groups = MUSIC_SLOTS.map((slot) =>
    iosGroup(
      `${SLOT_LABEL[slot]} playlist`,
      MUSIC_TRACKS.filter((t) => t.slot === slot).map((t) => {
        const on = !(getSettings().musicOff ?? []).includes(t.id);
        const tg = toggle(
          on,
          (v) => {
            const off = new Set(getSettings().musicOff ?? []);
            if (v) off.delete(t.id);
            else off.add(t.id);
            const left = MUSIC_TRACKS.filter((x) => x.slot === slot && !off.has(x.id));
            if (!left.length) {
              toast(`Keep at least one ${SLOT_LABEL[slot]} track on.`, 'error');
              (tg.querySelector('input') as HTMLInputElement).checked = true;
              return;
            }
            updateSettings({ musicOff: [...off] });
          },
          `${t.title} by ${t.artist}`,
        );
        return iosRow(t.title, t.artist, tg);
      }),
    ),
  );
  modal('Built-in tracks', h('div', { class: 'credits-list bt-list' }, h('p', { class: 'credits-intro' }, 'Choose which built-in lo-fi tracks can play. Each playlist shuffles the tracks that are on. Your music, when added, plays instead.'), groups), [{ label: 'Done', variant: 'primary' }], {
    onClose: onDone,
  });
}

export function builtInTracksRow() {
  const row = iosNav('Built-in tracks', () => showBuiltInTracks(() => detail && (detail.textContent = builtInSummary())), { icon: 'list', detail: builtInSummary() });
  const detail = row.querySelector('.ios-detail');
  return row;
}

// ---------------------------------------------------------------- your music
function slotBlock(slot: MusicSlot) {
  const wrap = h('div', { class: 'ym-slot', 'data-slot': slot });
  const input = h('input', { type: 'file', accept: 'audio/*', multiple: true, class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', 'data-slot': slot });
  const add = h('button', { type: 'button', class: 'ios-inline-btn ym-add', 'aria-label': `Add files to the ${SLOT_LABEL[slot]} playlist` }, 'Add');
  const head = h('span', { class: 'ym-desc' }, '');
  let busy = false;

  const paint = async () => {
    const mine = (await userTracks()).filter((t) => t.slot === slot);
    const builtIn = MUSIC_TRACKS.filter((t) => t.slot === slot).length;
    clear(head);
    head.append(mine.length ? `Your files (${mine.length})` : `Built-in playlist (${builtIn} tracks)`);
    add.disabled = busy || mine.length >= MAX_USER_TRACKS;
    clear(wrap);
    wrap.append(
      iosRow(SLOT_LABEL[slot], head, h('div', { class: 'ym-ctl' }, add, input), { cls: 'ym-row' }),
      ...mine.map((t) => {
        const rm = h('button', { type: 'button', class: 'ios-inline-btn ym-remove', 'aria-label': `Remove ${t.name}` }, 'Remove');
        rm.addEventListener('click', async () => {
          try {
            await removeUserTrack(t.id);
          } catch {
            toast('Could not remove the file.', 'error');
          }
          await paint();
        });
        return iosRow(h('span', { class: 'ym-file-name' }, t.name), mb(t.size), rm, { cls: 'ym-file' });
      }),
    );
  };

  add.addEventListener('click', () => {
    if (busy) return;
    input.value = '';
    input.click();
  });
  input.addEventListener('change', async () => {
    const files = [...(input.files ?? [])];
    if (!files.length || busy) return;
    busy = true;
    clear(head);
    head.append(files.length > 1 ? `Checking ${files.length} files…` : 'Checking the file…');
    add.disabled = true;
    let added = 0;
    for (const file of files) {
      try {
        if ((await userTracks()).filter((t) => t.slot === slot).length >= MAX_USER_TRACKS) throw new Error(`A playlist holds up to ${MAX_USER_TRACKS} files.`);
        if (file.size > MAX_USER_TRACK_BYTES) throw new Error(`"${file.name}" is ${mb(file.size)}. Pick files under ${mb(MAX_USER_TRACK_BYTES)}.`);
        const bytes = await file.arrayBuffer();
        let buf: AudioBuffer;
        try {
          buf = await decodeAudio(bytes.slice(0));
        } catch {
          throw new Error(`"${file.name}" can't be played on this device. Try MP3 or M4A.`);
        }
        if (buf.duration < 2) throw new Error(`"${file.name}" is too short to play.`);
        const id = await addUserTrack(slot, file, file.name, bytes);
        music.primeUser(id, buf);
        added++;
      } catch (e) {
        toast((e as Error)?.message || 'Could not save that file.', 'error', 4200);
      }
    }
    if (added) toast(added === 1 ? `Added to the ${SLOT_LABEL[slot]} playlist.` : `${added} files added to the ${SLOT_LABEL[slot]} playlist.`, 'success');
    busy = false;
    await paint();
  });
  void paint();
  return wrap;
}

/** The "Your music" group: a playlist of your own files for each slot. */
export function yourMusicGroup() {
  return iosGroup(
    'Your music',
    USER_SLOTS.map(slotBlock),
    'Add your own audio files, for example music you own from the show. A slot with files plays them as a shuffled playlist instead of the built-in tracks. Files stay on this device and are never uploaded. Pinch plays when either duelist is at 2000 LP or less.',
  );
}

// ---------------------------------------------------------------- credits
/** The Audio credits sheet. */
export function showAudioCredits() {
  const list = h(
    'div',
    { class: 'credits-list' },
    h(
      'p',
      { class: 'credits-intro' },
      'All recorded music and sound effects in this app are CC0 (public domain): free to use, change and share, no attribution required. We credit the authors anyway. Nothing here is from the anime or from Konami. Music you add under Your music stays on your device.',
    ),
    AUDIO_CREDITS.map((c) =>
      h(
        'article',
        { class: 'credit' },
        h('div', { class: 'credit-use' }, c.use),
        h('div', { class: 'credit-title' }, c.title),
        h(
          'div',
          { class: 'credit-meta' },
          `by ${c.author} · `,
          h('a', { href: c.licenseUrl, target: '_blank', rel: 'noopener' }, c.license),
          ' · ',
          h('a', { href: c.page, target: '_blank', rel: 'noopener' }, 'original'),
        ),
        h('div', { class: 'credit-edit' }, c.edits),
        h(
          'details',
          { class: 'credit-src' },
          h('summary', null, `Files and sources (${c.files.length})`),
          h('div', { class: 'credit-files' }, 'In the app: ', c.files.map((f, i) => [i ? ', ' : '', h('code', null, f)])),
          h(
            'ul',
            null,
            c.sources.map((u) => h('li', null, h('a', { href: u, target: '_blank', rel: 'noopener' }, decodeURIComponent(u.split('/').pop() ?? u)))),
          ),
        ),
      ),
    ),
  );
  modal('Audio credits', list, [{ label: 'Done', variant: 'primary' }], { wide: true, cls: 'credits-modal' });
}
