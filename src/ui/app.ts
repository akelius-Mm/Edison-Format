// Application shell: registers every screen with the router and boots the app.
import { pauseOfficialArtThisLaunch } from './cards/officialArt';
import { clear } from './screens/dom';
import { databaseScreen } from './screens/database';
import { customizeScreen } from './screens/customize';
import { deckBuilderScreen } from './screens/deckBuilder';
import { draftScreen } from './screens/draft';
import { binderScreen } from './screens/binder';
import { packsScreen } from './screens/packs';
import { shopScreen, tradeScreen } from './screens/shop';
import { duelSetupScreen, exhibitionScreen } from './screens/duelSetup';
import { registerRoute, startRouter } from './screens/nav';
import { rulesScreen } from './screens/rules';
import { guideScreen } from './screens/guide';
import { settingsScreen } from './screens/settingsScreen';
import { collectionScreen, titleScreen } from './screens/title';
import { tournamentScreen } from './screens/tournament';
import { mountTabBar } from './screens/tabbar';
import { loadActiveDuel } from './duel/resume';
import { bootGuard } from './crashGuard';
import { getSettings, updateSettings } from './settings';
import { toast } from './screens/dom';
// Play a friend (online, room codes).
import { friendScreen } from './screens/friend';
// Friends Locals (a Swiss tournament between friends' phones).
import { friendLocalsScreen, restoreFriendsLocals } from './screens/friendLocals';

export function startApp(root: HTMLElement) {
  registerRoute('title', titleScreen);
  registerRoute('play', titleScreen);
  registerRoute('collection', collectionScreen);
  registerRoute('duel', duelSetupScreen);
  registerRoute('exhibition', exhibitionScreen);
  registerRoute('deck-builder', deckBuilderScreen);
  registerRoute('database', databaseScreen);
  registerRoute('customize', customizeScreen);
  registerRoute('settings', settingsScreen);
  registerRoute('rules', rulesScreen);
  registerRoute('guide', guideScreen);
  registerRoute('tournament', tournamentScreen);
  registerRoute('draft', draftScreen);
  registerRoute('packs', packsScreen);
  registerRoute('binder', binderScreen);
  registerRoute('shop', shopScreen);
  registerRoute('trade', tradeScreen);
  registerRoute('friend', friendScreen);
  registerRoute('friend-locals', friendLocalsScreen);
  clear(root);
  // The app was killed while on screen last time (iPhone: "A problem repeatedly occurred", nearly
  // always memory). Open on Home instead of the screen that died, and turn off the two biggest memory
  // users (music, official card scans) so the same screen does not die again the same way. Card images are
  // off for this launch only: the mats, sleeves and cards are official art, and switching the setting off for
  // good left everything on the drawn art until the player found the toggle.
  const crashed = bootGuard();
  if (crashed) {
    const s = getSettings();
    const lighter = s.music || s.officialImages;
    if (s.music) updateSettings({ music: false });
    if (s.officialImages) pauseOfficialArtThisLaunch();
    if (!/^#?\/?(title)?$/.test(location.hash) && !location.hash.startsWith('#/friend?join=') && !location.hash.startsWith('#/friend-locals?join=')) history.replaceState(null, '', '#/title');
    setTimeout(
      () =>
        toast(
          lighter ? 'The app closed unexpectedly last time. To save memory, music is off (Settings turns it back on) and card images are off until you reopen the app.' : 'The app closed unexpectedly last time, so it opened on Home.',
          'info',
          6500,
        ),
      600,
    );
  }
  // The app was closed in the middle of a duel (iOS kills home-screen apps in the background):
  // open on Home, where the "Duel in progress" card resumes it.
  // (A friend's invite link still opens the join screen.)
  if (loadActiveDuel()?.live && !/^#?\/?(title)?$/.test(location.hash) && !location.hash.startsWith('#/friend?join=') && !location.hash.startsWith('#/friend-locals?join=')) history.replaceState(null, '', '#/title');
  startRouter(root);
  mountTabBar();
  // a Friends Locals event in progress reconnects in the background (the organiser's phone runs it)
  restoreFriendsLocals();
}
