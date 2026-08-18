import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL's auto-cleanup only fires when the runner exposes a GLOBAL afterEach.
// This repo runs vitest without `globals: true` (house style: explicit
// imports), so cleanup must be wired by hand — otherwise every render leaks
// into the next test and getByRole starts finding multiple elements.
afterEach(cleanup);

// jsdom implements no layout, so it ships no `scrollIntoView` at all — calling
// it throws rather than doing nothing. The driver picker calls it to keep the
// active option visible (#120 review M7); stubbed here so a real call is a
// no-op in tests instead of an error, the same shape as the RTL wiring above.
//
// Guarded because this same setup file loads for the route-handler tests, which
// run in the `node` environment where there is no `Element` to patch.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}
