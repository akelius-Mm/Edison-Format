// Application shell: registers every screen with the router and boots the app.
import { clear } from './screens/dom';
import { databaseScreen } from './screens/database';
import { customizeScreen } from './screens/customize';
import { deckBuilderScreen } from './screens/deckBuilder';
import { duelSetupScreen, exhibitionScreen } from './screens/duelSetup';
import { registerRoute, startRouter } from './screens/nav';
import { rulesScreen } from './screens/rules';
import { settingsScreen } from './screens/settingsScreen';
import { titleScreen } from './screens/title';
import { tournamentScreen } from './screens/tournament';

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
  clear(root);
  startRouter(root);
}
