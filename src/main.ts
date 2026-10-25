import './ui/app.css';
import './ui/screens/screens.css';
import { startApp } from './ui/app';
import { music } from './ui/audio/music';
import { loadSfxSamples } from './ui/audio/samples';
import { startUpdater } from './ui/updater';
import './ui/clean.css';
import './ui/home.css';
import './ui/polish.css';
import './ui/motion.css';
import { installPressFeedback } from './ui/press';

installPressFeedback();
startApp(document.getElementById('app')!);
// Menu theme in the app shell; it starts on the first tap (iOS needs a gesture to unlock audio).
music.setScene('menu');
// Sound-effect samples (about 300 KB) load in the background so the first duel already has them.
setTimeout(() => void loadSfxSamples(), 1500);

// Installable app: offline service worker plus automatic updates (hosted site only).
startUpdater();
