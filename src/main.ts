import './ui/app.css';
import './ui/screens/screens.css';
import { startApp } from './ui/app';
import { music } from './ui/audio/music';
import { loadSfxSamples } from './ui/audio/samples';
import { startUpdater } from './ui/updater';
import './ui/home.css';
// last: rules that must win over the screens' own stylesheets by order
import './ui/overrides.css';
import { installPressFeedback } from './ui/press';
import { installErrorCapture } from './ui/diag';
import { installErrorToast } from './ui/screens/report';

// first: errors from here on are kept for "Report a problem"
installErrorCapture();
installErrorToast();

installPressFeedback();
startApp(document.getElementById('app')!);
// Menu theme in the app shell; it starts on the first tap (iOS needs a gesture to unlock audio).
music.setScene('menu');
// Sound-effect samples (about 300 KB) load in the background so the first duel already has them.
setTimeout(() => void loadSfxSamples(), 1500);

// Installable app: offline service worker plus automatic updates (hosted site only).
startUpdater();
