// Application shell: registers every screen with the router and boots the app.
import { clear } from './screens/dom';
import { databaseScreen } from './screens/database';
import { customizeScreen } from './screens/customize';
import { deckBuilderScreen } from './screens/deckBuilder';
import { draftScreen } from './screens/draft';
import { binderScreen } from './screens/binder';
import { packsScreen } from './screens/packs';
import { duelSetupScreen, exhibitionScreen } from './screens/duelSetup';
import { registerRoute, startRouter } from './screens/nav';
import { rulesScreen } from './screens/rules';
import { settingsScreen } from './screens/settingsScreen';
import { titleScreen } from './screens/title';
import { tournamentScreen } from './screens/tournament';
import { playScreen } from './screens/play';
import { mountTabBar } from './screens/tabbar';
import { loadActiveDuel } from './duel/resume';
// Play a friend (online, room codes).
import { friendScreen } from './screens/friend';
// Friends Locals (a Swiss tournament between friends' phones).
import { friendLocalsScreen, restoreFriendsLocals } from './screens/friendLocals';

export function startApp(root: HTMLElement) {
  registerRoute('title', titleScreen);
  registerRoute('play', playScreen);
  registerRoute('duel', duelSetupScreen);
  registerRoute('exhibition', exhibitionScreen);
  registerRoute('deck-builder', deckBuilderScreen);
  registerRoute('database', databaseScreen);
  registerRoute('customize', customizeScreen);
  registerRoute('settings', settingsScreen);
  registerRoute('rules', rulesScreen);
  registerRoute('tournament', tournamentScreen);
  registerRoute('draft', draftScreen);
  registerRoute('packs', packsScreen);
  registerRoute('binder', binderScreen);
  registerRoute('friend', friendScreen);
  registerRoute('friend-locals', friendLocalsScreen);
  clear(root);
  // The app was closed in the middle of a duel (iOS kills home-screen apps in the background):
  // open on Home, where the "Duel in progress" card resumes it.
  // (A friend's invite link still opens the join screen.)
  if (loadActiveDuel()?.live && !/^#?\/?(title)?$/.test(location.hash) && !location.hash.startsWith('#/friend?join=') && !location.hash.startsWith('#/friend-locals?join=')) history.replaceState(null, '', '#/title');
  startRouter(root);
  mountTabBar();
  // a Friends Locals event in progress reconnects in the background (the organiser's phone runs it)
  restoreFriendsLocals();
}
