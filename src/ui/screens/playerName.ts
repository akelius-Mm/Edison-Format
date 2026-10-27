// The player name: what friends see at an online table (Play a friend, Friends Locals). Edited on
// the Profile screen (tap the name); online play asks for it first while it is still the default.
import { NAME_MAX, cleanName } from '../../net/tourneyProtocol';
import { getSettings, updateSettings } from '../settings';
import { promptDialog, toast } from './dom';

export const DEFAULT_NAME = 'Duelist';

/** The saved name, cleaned (the default when none is set). */
export function playerName(): string {
  return cleanName(getSettings().playerName) || DEFAULT_NAME;
}

/** Ask for a name (prefilled with the current one) and save it. Null when cancelled. */
export async function editName(title = 'Your name', hint = `Up to ${NAME_MAX} characters. Your friends see it at the table.`): Promise<string | null> {
  const raw = await promptDialog(title, 'Name', playerName(), 'Save', { maxLength: NAME_MAX, hint, test: 'name-input' });
  if (raw == null) return null;
  const name = cleanName(raw);
  if (!name) {
    toast('A name needs at least one letter.', 'error');
    return null;
  }
  if (name !== getSettings().playerName) updateSettings({ playerName: name });
  return name;
}

/** Before going online: still called "Duelist"? Ask for a name first (keeping it is fine). False when cancelled. */
export async function ensureName(): Promise<boolean> {
  if (playerName() !== DEFAULT_NAME) return true;
  return (await editName('What should friends call you?', `Shown at the table and in the standings. Up to ${NAME_MAX} characters; you can change it on your Profile.`)) != null;
}
