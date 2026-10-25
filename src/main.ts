import './ui/app.css';
import './ui/screens/screens.css';
import { startApp } from './ui/app';
import { startUpdater } from './ui/updater';
import './ui/clean.css';
import './ui/home.css';

startApp(document.getElementById('app')!);

// Installable app: offline service worker plus automatic updates (hosted site only).
startUpdater();
