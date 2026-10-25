import './ui/app.css';
import './ui/screens/screens.css';
import { startApp } from './ui/app';
import './ui/clean.css';

startApp(document.getElementById('app')!);

// Installable app: register the offline service worker on the hosted site only.
if ('serviceWorker' in navigator && location.protocol === 'https:' && !location.hostname.endsWith('claude.ai')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* offline support unavailable; the app still works online */
    });
  });
}
