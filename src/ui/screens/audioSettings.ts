// Settings → "Your music" (pick a file from the device for the Menu, Duel and Pinch slots) and
// the Audio credits sheet.
import { AUDIO_CREDITS, MUSIC_CREDITS } from '../audio/credits';
import { music } from '../audio/music';
import type { MusicSlot } from '../audio/samples';
import { decodeAudio } from '../audio/samples';
import { MAX_USER_TRACK_BYTES, USER_SLOTS, removeUserTrack, setUserTrack, userTrackInfo } from '../audio/userMusic';
import { iosGroup, iosRow } from './components';
import { clear, h, modal, toast } from './dom';

const SLOT_LABEL: Record<MusicSlot, string> = { menu: 'Menu', duel: 'Duel', pinch: 'Pinch' };
const BUILT_IN: Record<MusicSlot, string> = {
  menu: MUSIC_CREDITS[0].title.replace(/ \(.*/, ''),
  duel: MUSIC_CREDITS[1].title.replace(/ \(.*/, ''),
  pinch: MUSIC_CREDITS[2].title.replace(/ \(.*/, ''),
};

const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function slotRow(slot: MusicSlot) {
  const desc = h('span', { class: 'ym-desc' }, `Built-in: ${BUILT_IN[slot]}`);
  const input = h('input', { type: 'file', accept: 'audio/*', class: 'sr-only', tabindex: '-1', 'aria-hidden': 'true', 'data-slot': slot });
  const choose = h('button', { type: 'button', class: 'ios-inline-btn', 'aria-label': `Choose a file for ${SLOT_LABEL[slot]}` }, 'Choose');
  const remove = h('button', { type: 'button', class: 'ios-inline-btn ym-remove', 'aria-label': `Remove the ${SLOT_LABEL[slot]} file`, hidden: true }, 'Remove');
  let busy = false;

  const paint = async () => {
    const info = (await userTrackInfo())[slot];
    clear(desc);
    if (info) {
      desc.append(h('span', { class: 'ym-name' }, info.name), ` · ${mb(info.size)}`);
      remove.hidden = false;
      choose.textContent = 'Change';
    } else {
      desc.append(`Built-in: ${BUILT_IN[slot]}`);
      remove.hidden = true;
      choose.textContent = 'Choose';
    }
  };

  choose.addEventListener('click', () => {
    if (busy) return;
    input.value = '';
    input.click();
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file || busy) return;
    if (file.size > MAX_USER_TRACK_BYTES) {
      toast(`That file is ${mb(file.size)}. Pick one under ${mb(MAX_USER_TRACK_BYTES)}.`, 'error', 4000);
      return;
    }
    busy = true;
    choose.disabled = true;
    clear(desc);
    desc.append('Checking the file…');
    try {
      const bytes = await file.arrayBuffer();
      let buf: AudioBuffer;
      try {
        buf = await decodeAudio(bytes.slice(0));
      } catch {
        throw new Error("This file can't be played on this device. Try an MP3 or M4A file.");
      }
      if (buf.duration < 2) throw new Error('That file is too short to loop. Pick a song.');
      await setUserTrack(slot, file);
      music.primeUser(slot, buf);
      toast(`${SLOT_LABEL[slot]} music set to "${file.name}".`, 'success');
    } catch (e) {
      toast((e as Error)?.message || 'Could not save that file.', 'error', 4200);
    } finally {
      busy = false;
      choose.disabled = false;
      await paint();
    }
  });
  remove.addEventListener('click', async () => {
    try {
      await removeUserTrack(slot);
      toast(`${SLOT_LABEL[slot]} uses the built-in music again.`, 'success');
    } catch {
      toast('Could not remove the file.', 'error');
    }
    await paint();
  });
  void paint();
  return iosRow(SLOT_LABEL[slot], desc, h('div', { class: 'ym-ctl' }, choose, remove, input), { cls: 'ym-row' });
}

/** The "Your music" group: three slots with Choose / Remove. */
export function yourMusicGroup() {
  return iosGroup(
    'Your music',
    USER_SLOTS.map(slotRow),
    'Play your own audio files instead of the built-in tracks, for example music you own from the show. Files stay on this device and are never uploaded. Each one loops with a crossfade. Pinch plays when either duelist is at 2000 LP or less.',
  );
}

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
