// Settings ("More" tab): shortcuts to the other modes, then iOS-style grouped settings.
import type { Difficulty } from '../../ai/ai';
import { clearOfficialArtCache } from '../cards/officialArt';
import { DEFAULT_SETTINGS, getSettings, updateSettings, type Settings } from '../settings';
import { builtInTracksRow, nowPlayingRow, showAudioCredits, yourMusicGroup } from './audioSettings';
import { iosAction, iosGroup, iosNav, iosRow } from './components';
import { packsDraftSettingsGroup } from './draftSetup';
import { confirmDialog, h, segmented, toast, toggle } from './dom';
import { frame, go, type Screen } from './nav';
import { getProfile, resetAllData } from './store';
import { loadActiveTournament, currentRoundLabel } from '../../tournament/tournament';
// Play a friend: connection server (advanced).
import { onlineSettingsGroup } from './friend';
import { openReportSheet } from './report';
import { openRulesNotes } from './rulesNotes';
import { editName, playerName } from './playerName';
import { OFFICIAL_IMAGES_FOOT, animationSpeedRow, confirmEndTurnRow, swipeToPlayRow, hapticsRow, musicRow, officialImagesRow, responsePromptsRow, showLogRow, soundRow, volumeRow } from './settingsControls';

export function settingsScreen(): Screen {
  const s = getSettings();
  const set = (patch: Partial<Settings>) => updateSettings(patch);

  const p = getProfile();
  const active = loadActiveTournament();
  const games = p.games.w + p.games.l + p.games.d;

  const nameDetail = h('span', null, playerName());
  const nameNav = iosNav('Your name', () => void editName().then((n) => n && (nameDetail.textContent = n)), { icon: 'edit', detail: nameDetail });
  nameNav.dataset.test = 'settings-name';

  const el = frame(
    'Settings',
    { cls: 'settings-screen' },
    iosGroup('Profile', [nameNav], 'Friends see this name when you play online.'),
    iosGroup('More', [
      iosNav('Tournament', () => go('tournament'), { icon: 'trophy', detail: active ? currentRoundLabel(active) : undefined }),
      iosNav('Watch AI vs AI', () => go('exhibition'), { icon: 'eye' }),
      iosNav('Card Database', () => go('database'), { icon: 'search' }),
      iosNav('Sleeves & Playmat', () => go('customize'), { icon: 'palette' }),
      iosNav('How to Play & Banlist', () => go('rules'), { icon: 'book' }),
      iosNav('Rules updates', () => openRulesNotes(), { icon: 'scroll' }),
    ]),
    packsDraftSettingsGroup(),
    iosGroup(
      'Gameplay',
      [
        animationSpeedRow(),
        responsePromptsRow(),
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
        confirmEndTurnRow(),
        swipeToPlayRow(),
        showLogRow(),
      ],
    ),
    iosGroup(
      'Display',
      [officialImagesRow()],
      OFFICIAL_IMAGES_FOOT,
    ),
    iosGroup('Audio', [
      soundRow(),
      hapticsRow(),
      musicRow(),
      volumeRow(),
      nowPlayingRow(),
      builtInTracksRow(),
      iosNav('Audio credits', showAudioCredits, { icon: 'music' }),
    ]),
    yourMusicGroup(),
    onlineSettingsGroup(),
    iosGroup(
      'Help',
      [iosNav('Guide', () => go('guide'), { icon: 'info', detail: 'How the app works' }), iosNav('Report a problem', () => openReportSheet(), { icon: 'warn' })],
      'The Guide explains the app, where its rules come from and what to do when a card plays wrong. Report a problem makes a report with what went wrong (and the duel, to replay it) to share or copy. Nothing is sent automatically.',
    ),
    iosGroup(
      'Data',
      [
        iosAction('Restore default settings', async () => {
          if (!(await confirmDialog('Restore defaults', 'Reset all settings to their defaults? Your name, decks and stats are kept.', 'Restore'))) return;
          const keep = getSettings();
          updateSettings({ ...DEFAULT_SETTINGS, playerName: keep.playerName, nameChosen: keep.nameChosen, avatar: keep.avatar, sleeve: keep.sleeve, playmat: keep.playmat });
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
