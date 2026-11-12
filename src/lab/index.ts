// The Lab's experimental look: a physical table and heavier, louder feedback. Loaded only in the Lab build
// (src/lab/flag.ts). Materials are drawn in code (gradients and SVG noise); the few painted
// backdrops in src/lab/art are small WebP files that lab.css loads one screen at a time.
import './lab.css';

document.documentElement.classList.add('lab');
