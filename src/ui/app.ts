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
import { mountTabBar } from './screens/tabbar';
import { loadActiveDuel } from './duel/resume';

export function startApp(root: HTMLElement) {
  registerRoute('title', titleScreen);
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
  clear(root);
  // The app was closed in the middle of a duel (iOS kills home-screen apps in the background):
  // open on Home, where the "Duel in progress" card resumes it.
  if (loadActiveDuel()?.live && !/^#?\/?(title)?$/.test(location.hash)) history.replaceState(null, '', '#/title');
  startRouter(root);
  mountTabBar();
}
