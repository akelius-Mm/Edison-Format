import './ui/app.css';
import './ui/screens/screens.css';
import { startApp } from './ui/app';
import './ui/clean.css';
import './ui/home.css';
import './ui/polish.css';

startApp(document.getElementById('app')!);

// Installable app: register the offline service worker on the hosted site only.
if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.endsWith('claude.ai')) {
  window.addEventListener('load', () => {
    // When a new version takes over, reload once so the latest build shows.
    let reloaded = false;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support unavailable; the app still works online */
    });
  });
}
