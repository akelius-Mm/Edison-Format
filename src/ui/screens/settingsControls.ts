// Settings rows shared by the Settings screen and the in-duel Settings sheet (duel flag menu → Settings).
// Every control saves through updateSettings(), so a change applies at once wherever it is made: the duel
// listens with onSettingsChange (sound, volume, animation speed, card images, duel log, swipe up to play), music.ts follows
// music and volume, and response prompts, haptics and end-of-turn confirmation are read when they are used.
// Settings are local to this device: changing them never touches an online game.
import { haptic } from '../haptics';
import { getSettings, updateSettings } from '../settings';
import { iosGroup, iosRow } from './components';
import { h, modal, segmented, toggle } from './dom';
import './guide.css';

const set = updateSettings;

const SPEEDS: { value: number; label: string }[] = [
  { value: 0, label: 'Instant' },
  { value: 0.5, label: 'Fast' },
  { value: 1, label: 'Normal' },
  { value: 1.5, label: 'Relaxed' },
  { value: 2, label: 'Slow' },
];

export function animationSpeedRow() {
  const cur = getSettings().animationSpeed;
  const nearest = SPEEDS.reduce((a, b) => (Math.abs(b.value - cur) < Math.abs(a.value - cur) ? b : a)).value;
  return iosRow('Animation speed', null, segmented(SPEEDS, nearest, (v) => set({ animationSpeed: v }), 'Animation speed'), { stack: true });
}

export function responsePromptsRow() {
  return iosRow(
    'Response prompts',
    'Smart asks only when you have a relevant card. Always stops at every chance to respond.',
    segmented<'smart' | 'always'>(
      [
        { value: 'smart', label: 'Smart' },
        { value: 'always', label: 'Always' },
      ],
      getSettings().responsePrompts,
      (v) => set({ responsePrompts: v }),
      'Response prompts',
    ),
    { stack: true },
  );
}

export const confirmEndTurnRow = () => iosRow('Confirm end of turn', 'Ask when you still have plays.', toggle(getSettings().confirmEndTurn, (v) => set({ confirmEndTurn: v }), 'Confirm end of turn'));
export const swipeToPlayRow = () =>
  iosRow('Swipe up to play', 'Drag a card from your hand up onto the field to play it.', toggle(getSettings().swipeToPlay, (v) => set({ swipeToPlay: v }), 'Swipe up to play'));
export const showLogRow = () => iosRow('Show duel log', null, toggle(getSettings().showLog, (v) => set({ showLog: v }), 'Show duel log'));

export const OFFICIAL_IMAGES_FOOT = 'Loads card artwork from the YGOPRODeck database when online. Card art is © its owners; generated art is used when it is unavailable.';
export const officialImagesRow = () => iosRow('Official card images', null, toggle(getSettings().officialImages, (v) => set({ officialImages: v }), 'Load official card images'));

export const soundRow = () => iosRow('Sound effects', null, toggle(getSettings().sound, (v) => set({ sound: v }), 'Sound effects'));
export const musicRow = () => iosRow('Music', null, toggle(getSettings().music, (v) => set({ music: v }), 'Music'));
export const hapticsRow = () =>
  iosRow(
    'Haptics',
    'Taps you can feel for plays, damage and results.',
    toggle(
      getSettings().haptics,
      (v) => {
        set({ haptics: v });
        if (v) haptic('selection');
      },
      'Haptics',
    ),
  );

export function volumeRow() {
  const v0 = getSettings().volume;
  const vol = h('input', { type: 'range', class: 'ios-range', min: '0', max: '1', step: '0.05', value: String(v0), 'aria-label': 'Volume' });
  const out = h('span', { class: 'ios-detail' }, `${Math.round(v0 * 100)}%`);
  const paint = () => vol.style.setProperty('--v', `${Number(vol.value) * 100}%`);
  paint();
  vol.addEventListener('input', () => {
    set({ volume: Number(vol.value) });
    out.textContent = `${Math.round(Number(vol.value) * 100)}%`;
    paint();
  });
  return iosRow('Volume', null, h('div', { class: 'ios-range-wrap' }, vol, out), { stack: true });
}

let sheetOpen = false;

/**
 * The duel's Settings sheet: opens over the duel (no route change, the duel keeps running underneath and an
 * online game is never paused). `spectator` leaves out what only matters to a player.
 */
export function openDuelSettings(opts: { spectator?: boolean } = {}) {
  if (sheetOpen) return;
  sheetOpen = true;
  const body = h(
    'div',
    { class: 'duel-settings', 'data-test': 'duel-settings' },
    iosGroup('Duel', [animationSpeedRow(), ...(opts.spectator ? [] : [responsePromptsRow(), confirmEndTurnRow(), swipeToPlayRow()]), showLogRow()]),
    iosGroup('Audio', [soundRow(), musicRow(), volumeRow(), hapticsRow()]),
    iosGroup('Display', [officialImagesRow()], OFFICIAL_IMAGES_FOOT),
    h('p', { class: 'duel-settings-note' }, 'Changes apply right away and are saved on this device. Nothing here is sent to your opponent.'),
  );
  modal('Settings', body, [{ label: 'Done', variant: 'primary' }], { cls: 'duel-settings-modal', onClose: () => (sheetOpen = false) });
}
