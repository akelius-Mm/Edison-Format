// Lab only: mark where the painted art goes. These set a data attribute and nothing else; lab.css maps each
// one to its image (src/lab/art), so the browser fetches a picture only when its element is on screen. In the
// normal build LAB is false and both calls do nothing.
import { REGULARS } from '../locals/regulars';
import { LAB } from './flag';

/** A regular's portrait, wherever their initials would be shown (matched by name). */
export function labPortrait(el: HTMLElement, name: string) {
  if (!LAB) return;
  const r = REGULARS.find((x) => x.name === name);
  if (r) el.dataset.regular = r.id;
}

/** The venue behind an event's header: 'locals', 'regional', 'sjc' or 'nationals'. */
export function labVenue(el: HTMLElement, kind: string) {
  if (LAB) el.dataset.venue = kind;
}
