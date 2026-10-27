// The player name: what friends see at an online table (Play a friend, Friends Locals). Edited in
// Settings, on the Profile (tap the name) and in Sleeves & Playmat; online play asks for it first
// while it is still the default and was never confirmed.
import { NAME_MAX, cleanName } from '../../net/protocol';
import { getSettings, updateSettings } from '../settings';
import { h, promptDialog, toast } from './dom';

export const DEFAULT_NAME = 'Duelist';

/** The saved name, cleaned (the default when none is set). */
export function playerName(): string {
  return cleanName(getSettings().playerName) || DEFAULT_NAME;
}

/** Save a typed name (cleaned). The saved name, or null when nothing usable was typed. */
export function saveName(raw: string): string | null {
  const name = cleanName(raw);
  if (!name) return null;
  const s = getSettings();
  if (name !== s.playerName || !s.nameChosen) updateSettings({ playerName: name, nameChosen: true });
  return name;
}

/** Ask for a name (prefilled with the current one) and save it. Null when cancelled. */
export async function editName(title = 'Your name', hint = `Up to ${NAME_MAX} characters. Friends see it at the table and in Friends Locals.`): Promise<string | null> {
  for (;;) {
    const raw = await promptDialog(title, 'Name', playerName(), 'Save', { maxLength: NAME_MAX, hint, test: 'name-input' });
    if (raw == null) return null;
    const name = saveName(raw);
    if (name) return name;
    toast('A name needs at least one letter or number.', 'error');
  }
}

/** Before going online: never picked a name? Ask for one first (keeping "Duelist" is fine). False when cancelled. */
export async function ensureName(): Promise<boolean> {
  const s = getSettings();
  if (s.nameChosen || playerName() !== DEFAULT_NAME) return true;
  return (await editName('What should friends call you?', `Shown at the table, in pairings and standings. Up to ${NAME_MAX} characters; change it any time in Settings.`)) != null;
}

/** "Playing as Alex · Change" for the online landings. */
export function nameChip(onChange?: (name: string) => void): HTMLElement {
  const b = h('b', null, playerName());
  return h(
    'button',
    {
      type: 'button',
      class: 'fr-name-chip',
      'data-test': 'name-chip',
      onclick: async () => {
        const n = await editName();
        if (n == null) return;
        b.textContent = n;
        onChange?.(n);
      },
    },
    h('span', null, 'Playing as '),
    b,
    h('span', { class: 'fr-name-edit' }, ' · Change'),
  );
}
