// Settings screen.
import type { Difficulty } from '../../ai/ai';
import { clearOfficialArtCache } from '../cards/officialArt';
import { DEFAULT_SETTINGS, getSettings, updateSettings, type Settings } from '../settings';
import { button, confirmDialog, h, segmented, toast, toggle } from './dom';
import { frame, go, type Screen } from './nav';
import { getProfile, resetAllData } from './store';

export function settingsScreen(): Screen {
  const s = getSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);

  const row = (label: string, desc: string, control: Node) =>
    h('div', { class: 'set-row' }, h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, label), h('div', { class: 'set-desc' }, desc)), h('div', { class: 'set-control' }, control));

  const speeds: { value: number; label: string }[] = [
    { value: 0, label: 'Instant' },
    { value: 0.5, label: 'Fast' },
    { value: 1, label: 'Normal' },
    { value: 1.5, label: 'Relaxed' },
    { value: 2, label: 'Slow' },
  ];
  const nearest = speeds.reduce((a, b) => (Math.abs(b.value - s.animationSpeed) < Math.abs(a.value - s.animationSpeed) ? b : a)).value;

  const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(s.volume), 'aria-label': 'Volume' });
  const volOut = h('span', { class: 'set-val' }, `${Math.round(s.volume * 100)}%`);
  vol.addEventListener('input', () => {
    set({ volume: Number(vol.value) });
    volOut.textContent = `${Math.round(Number(vol.value) * 100)}%`;
  });

  const p = getProfile();
  const group = (title: string, ...rows: Node[]) => h('section', { class: 'set-group' }, h('div', { class: 'section-title' }, h('h2', null, title)), ...rows);

  const el = frame(
    'Settings',
    { subtitle: 'Changes are saved automatically', cls: 'settings' },
    h(
      'div',
      { class: 'set-layout' },
      group(
        'Gameplay',
        row(
          'Animation speed',
          'How quickly cards move and effects resolve during duels.',
          segmented(speeds, nearest, (v) => set({ animationSpeed: v }), 'Animation speed'),
        ),
        row(
          'Response prompts',
          'Smart asks you to respond only when you have a relevant card; Always stops at every opportunity.',
          segmented<'smart' | 'always'>(
            [
              { value: 'smart', label: 'Smart' },
              { value: 'always', label: 'Always' },
            ],
            s.responsePrompts,
            (v) => set({ responsePrompts: v }),
            'Response prompts',
          ),
        ),
        row(
          'Default AI difficulty',
          'Used for new opponents in Duel vs AI.',
          segmented<Difficulty>(
            [
              { value: 'easy', label: 'Easy' },
              { value: 'normal', label: 'Normal' },
              { value: 'hard', label: 'Hard' },
            ],
            s.defaultDifficulty,
            (v) => set({ defaultDifficulty: v }),
            'Default AI difficulty',
          ),
        ),
        row('First player skips draw', 'Edison-era rule: the player going first does not draw on their first turn.', toggle(s.skipFirstDraw, (v) => set({ skipFirstDraw: v }), 'First player skips draw')),
        row('Confirm end of turn', 'Ask before ending your turn with cards you could still use.', toggle(s.confirmEndTurn, (v) => set({ confirmEndTurn: v }), 'Confirm end of turn')),
        row('Show duel log', 'Display the running log of actions beside the field.', toggle(s.showLog, (v) => set({ showLog: v }), 'Show duel log')),
      ),
      group(
        'Display',
        row(
          'Load official card images',
          'Shows official card artwork loaded from the YGOPRODeck card database when online. Card art is © its owners. Falls back to generated art when unavailable.',
          toggle(s.officialImages, (v) => set({ officialImages: v }), 'Load official card images'),
        ),
      ),
      group(
        'Audio',
        row('Sound effects', 'Card, chain and damage sounds.', toggle(s.sound, (v) => set({ sound: v }), 'Sound effects')),
        row('Music', 'Ambient background music during duels.', toggle(s.music, (v) => set({ music: v }), 'Music')),
        row('Volume', 'Master volume.', h('div', { class: 'set-range' }, vol, volOut)),
      ),
      group(
        'Data',
        row(
          'Profile',
          `${p.games.w + p.games.l + p.games.d} games played · ${p.tournaments.length} tournaments · ${Object.keys(p.decks).length} decks with stats`,
          button('Customize', () => go('customize'), { variant: 'ghost', small: true, icon: 'palette' }),
        ),
        row(
          'Restore defaults',
          'Reset every setting on this page (keeps decks and stats).',
          button(
            'Restore',
            async () => {
              if (!(await confirmDialog('Restore defaults', 'Reset all settings to their defaults? Your name, avatar, decks and stats are kept.', 'Restore'))) return;
              const keep = getSettings();
              updateSettings({ ...DEFAULT_SETTINGS, playerName: keep.playerName, avatar: keep.avatar, sleeve: keep.sleeve, playmat: keep.playmat });
              toast('Settings restored.', 'success');
              go('settings', { r: String(Date.now()) }, { replace: true });
            },
            { variant: 'ghost', small: true, icon: 'refresh' },
          ),
        ),
        row(
          'Reset all data',
          'Delete every saved deck, statistic, tournament and setting on this device.',
          button(
            'Reset data',
            async () => {
              if (!(await confirmDialog('Reset all data', 'This permanently deletes your decks, stats, tournaments and settings. Continue?', 'Delete everything', true))) return;
              clearOfficialArtCache();
              resetAllData();
              toast('All data has been reset.', 'success');
              setTimeout(() => location.replace(location.pathname + '#/title'), 300);
              setTimeout(() => location.reload(), 350);
            },
            { variant: 'danger', small: true, icon: 'trash' },
          ),
        ),
      ),
    ),
  );
  return { el };
}
