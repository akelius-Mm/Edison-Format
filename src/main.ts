import './ui/app.css';
import './ui/screens/screens.css';
import { startApp } from './ui/app';
import { music } from './ui/audio/music';
import { startUpdater } from './ui/updater';
import './ui/clean.css';
import './ui/home.css';
import './ui/polish.css';

startApp(document.getElementById('app')!);
// Menu theme in the app shell; it starts on the first tap (iOS needs a gesture to unlock audio).
music.setScene('menu');

// Installable app: offline service worker plus automatic updates (hosted site only).
startUpdater();
