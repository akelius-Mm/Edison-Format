// Application shell: registers every screen with the router and boots the app.
import { clear } from './screens/dom';
import { duelSetupScreen, exhibitionScreen } from './screens/duelSetup';
import { frame, registerRoute, startRouter, type ScreenFactory } from './screens/nav';
import { titleScreen } from './screens/title';

const placeholder = (title: string): ScreenFactory => () => ({ el: frame(title, {}, 'Coming soon') });

export function startApp(root: HTMLElement) {
  registerRoute('title', titleScreen);
  registerRoute('duel', duelSetupScreen);
  registerRoute('exhibition', exhibitionScreen);
  for (const r of ['tournament', 'deck-builder', 'database', 'customize', 'settings', 'rules']) registerRoute(r, placeholder(r));
  clear(root);
  startRouter(root);
}
