// Settings ("More" tab): shortcuts to the other modes, then iOS-style grouped settings.
import type { Difficulty } from '../../ai/ai';
import { clearOfficialArtCache } from '../cards/officialArt';
import { DEFAULT_SETTINGS, getSettings, updateSettings, type Settings } from '../settings';
import { builtInTracksRow, nowPlayingRow, showAudioCredits, yourMusicGroup } from './audioSettings';
import { haptic } from '../haptics';
import { iosAction, iosGroup, iosNav, iosRow } from './components';
import { packsDraftSettingsGroup } from './draftSetup';
import { confirmDialog, h, segmented, toast, toggle } from './dom';
import { frame, go, type Screen } from './nav';
import { getProfile, resetAllData } from './store';
import { loadActiveTournament, currentRoundLabel } from '../../tournament/tournament';
// Play a friend: connection server (advanced).
import { onlineSettingsGroup } from './friend';
import { openReportSheet } from './report';

export function settingsScreen(): Screen {
  const s = getSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);

  const speeds: { value: number; label: string }[] = [
    { value: 0, label: 'Instant' },
    { value: 0.5, label: 'Fast' },
    { value: 1, label: 'Normal' },
    { value: 1.5, label: 'Relaxed' },
    { value: 2, label: 'Slow' },
  ];
  const nearest = speeds.reduce((a, b) => (Math.abs(b.value - s.animationSpeed) < Math.abs(a.value - s.animationSpeed) ? b : a)).value;

  const vol = h('input', { type: 'range', class: 'ios-range', min: '0', max: '1', step: '0.05', value: String(s.volume), 'aria-label': 'Volume' });
  const volOut = h('span', { class: 'ios-detail' }, `${Math.round(s.volume * 100)}%`);
  const paintVol = () => vol.style.setProperty('--v', `${Number(vol.value) * 100}%`);
  paintVol();
  vol.addEventListener('input', () => {
    set({ volume: Number(vol.value) });
    volOut.textContent = `${Math.round(Number(vol.value) * 100)}%`;
    paintVol();
  });

  const p = getProfile();
  const active = loadActiveTournament();
  const games = p.games.w + p.games.l + p.games.d;

  const el = frame(
    'Settings',
    { cls: 'settings-screen' },
    iosGroup('More', [
      iosNav('Tournament', () => go('tournament'), { icon: 'trophy', detail: active ? currentRoundLabel(active) : undefined }),
      iosNav('Watch AI vs AI', () => go('exhibition'), { icon: 'eye' }),
      iosNav('Card Database', () => go('database'), { icon: 'search' }),
      iosNav('Sleeves & Playmat', () => go('customize'), { icon: 'palette' }),
      iosNav('How to Play & Banlist', () => go('rules'), { icon: 'book' }),
    ]),
    packsDraftSettingsGroup(),
    iosGroup(
      'Gameplay',
      [
        iosRow('Animation speed', null, segmented(speeds, nearest, (v) => set({ animationSpeed: v }), 'Animation speed'), { stack: true }),
        iosRow(
          'Response prompts',
          'Smart asks only when you have a relevant card. Always stops at every chance to respond.',
          segmented<'smart' | 'always'>(
            [
              { value: 'smart', label: 'Smart' },
              { value: 'always', label: 'Always' },
            ],
            s.responsePrompts,
            (v) => set({ responsePrompts: v }),
            'Response prompts',
          ),
          { stack: true },
        ),
        iosRow(
          'Default AI difficulty',
          null,
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
          { stack: true },
        ),
        iosRow('First player skips draw', 'Modern rule. Off in Edison: the player going first draws on turn 1.', toggle(s.skipFirstDraw, (v) => set({ skipFirstDraw: v }), 'First player skips draw')),
        iosRow('Side decking in best-of-3', 'Swap cards with your Side Deck between games. Off keeps both decks as they are.', toggle(s.sideDecking, (v) => set({ sideDecking: v }), 'Side decking in best-of-3')),
        iosRow('Confirm end of turn', 'Ask when you still have plays.', toggle(s.confirmEndTurn, (v) => set({ confirmEndTurn: v }), 'Confirm end of turn')),
        iosRow('Show duel log', null, toggle(s.showLog, (v) => set({ showLog: v }), 'Show duel log')),
      ],
    ),
    iosGroup(
      'Display',
      [iosRow('Official card images', null, toggle(s.officialImages, (v) => set({ officialImages: v }), 'Load official card images'))],
      'Loads card artwork from the YGOPRODeck database when online. Card art is © its owners; generated art is used when it is unavailable.',
    ),
    iosGroup('Audio', [
      iosRow('Sound effects', null, toggle(s.sound, (v) => set({ sound: v }), 'Sound effects')),
      iosRow(
        'Haptics',
        'Taps you can feel for plays, damage and results.',
        toggle(
          s.haptics,
          (v) => {
            set({ haptics: v });
            if (v) haptic('selection');
          },
          'Haptics',
        ),
      ),
      iosRow('Music', null, toggle(s.music, (v) => set({ music: v }), 'Music')),
      iosRow('Volume', null, h('div', { class: 'ios-range-wrap' }, vol, volOut), { stack: true }),
      nowPlayingRow(),
      builtInTracksRow(),
      iosNav('Audio credits', showAudioCredits, { icon: 'music' }),
    ]),
    yourMusicGroup(),
    onlineSettingsGroup(),
    iosGroup(
      'Help',
      [iosNav('Report a problem', () => openReportSheet(), { icon: 'warn' })],
      'Makes a report with what went wrong (and the duel, to replay it) to share or copy. Nothing is sent automatically.',
    ),
    iosGroup(
      'Data',
      [
        iosAction('Restore default settings', async () => {
          if (!(await confirmDialog('Restore defaults', 'Reset all settings to their defaults? Your name, decks and stats are kept.', 'Restore'))) return;
          const keep = getSettings();
          updateSettings({ ...DEFAULT_SETTINGS, playerName: keep.playerName, avatar: keep.avatar, sleeve: keep.sleeve, playmat: keep.playmat });
          toast('Settings restored.', 'success');
          go('settings', { r: String(Date.now()) }, { replace: true });
        }),
        iosAction(
          'Reset all data',
          async () => {
            if (!(await confirmDialog('Reset all data', 'This permanently deletes your decks, stats, tournaments and settings. Continue?', 'Delete everything', true))) return;
            clearOfficialArtCache();
            resetAllData();
            toast('All data has been reset.', 'success');
            setTimeout(() => location.replace(location.pathname + '#/title'), 300);
            setTimeout(() => location.reload(), 350);
          },
          true,
        ),
      ],
      `${games} game${games === 1 ? '' : 's'} played · ${p.tournaments.length} tournament${p.tournaments.length === 1 ? '' : 's'} · ${Object.keys(p.decks).length} deck${Object.keys(p.decks).length === 1 ? '' : 's'} with stats. Everything is stored on this device.`,
    ),
  );
  return { el };
}
