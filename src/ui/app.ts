// Application shell: registers every screen with the router and boots the app.
import { clear } from './screens/dom';
import { frame, registerRoute, startRouter, type ScreenFactory } from './screens/nav';
import { titleScreen } from './screens/title';

const placeholder = (title: string): ScreenFactory => () => ({ el: frame(title, {}, 'Coming soon') });

export function startApp(root: HTMLElement) {
  registerRoute('title', titleScreen);
  for (const r of ['duel', 'tournament', 'deck-builder', 'database', 'exhibition', 'customize', 'settings', 'rules']) registerRoute(r, placeholder(r));
  clear(root);
  startRouter(root);
}
