// True only in the Lab build (`vite build --mode lab`, published at <site>/lab/). A build-time constant: in the
// normal app every `if (LAB)` branch is removed and src/lab is never loaded. Under tsx (tests) it is false.
declare const __LAB__: boolean;
export const LAB: boolean = typeof __LAB__ === 'boolean' ? __LAB__ : false;
