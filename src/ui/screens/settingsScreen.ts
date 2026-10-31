// Settings ("More" tab): shortcuts to the other modes, then iOS-style grouped settings.
import type { Difficulty } from '../../ai/ai';
import { clearOfficialArtCache } from '../cards/officialArt';
import { DEFAULT_SETTINGS, getSettings, updateSettings, type Settings } from '../settings';
import { backupFileName, createBackup, describeBackup, parseBackup, restoreBackup } from '../backup';
import { BUILD } from '../diag';
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
        iosAction('Back up progress', () => void backUpProgress()),
        iosAction('Restore from backup', () => void restoreFromBackup()),
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
      `${games} game${games === 1 ? '' : 's'} played · ${p.tournaments.length} tournament${p.tournaments.length === 1 ? '' : 's'} · ${Object.keys(p.decks).length} deck${Object.keys(p.decks).length === 1 ? '' : 's'} with stats. Everything is stored on this device: back it up to keep your decks and cards safe if the browser clears its data, or to move them to another phone.`,
    ),
  );
  return { el };
}

/** Saves every deck, card, stat and setting as one .json file: the share sheet on phones ("Save to Files"), a download elsewhere. */
async function backUpProgress() {
  const b = createBackup(localStorage, BUILD);
  const name = backupFileName(b);
  const json = JSON.stringify(b);
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title: 'Edison backup', files: [file] });
      toast('Backup saved.', 'success');
      return;
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return; // the share sheet was closed
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast(`Backup downloaded: ${name}`, 'success', 3200);
}

function restoreFromBackup() {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const b = parseBackup(await file.text());
      const { decks, cards, games } = describeBackup(b);
      const made = b.createdAt ? new Date(b.createdAt).toLocaleDateString() : 'an unknown date';
      const msg = `This backup from ${made} has ${decks} deck${decks === 1 ? '' : 's'}, ${cards} card${cards === 1 ? '' : 's'} in the collection and ${games} game${games === 1 ? '' : 's'} played. It replaces everything on this device. Continue?`;
      if (!(await confirmDialog('Restore from backup', msg, 'Restore', true))) return;
      restoreBackup(localStorage, b);
    } catch (e) {
      toast((e as Error).message, 'error', 4000);
      return;
    }
    toast('Backup restored.', 'success');
    setTimeout(() => location.replace(location.pathname + '#/title'), 300);
    setTimeout(() => location.reload(), 350);
  };
  input.click();
}
