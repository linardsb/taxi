import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL's auto-cleanup only fires when the runner exposes a GLOBAL afterEach.
// This repo runs vitest without `globals: true` (house style: explicit
// imports), so cleanup must be wired by hand — otherwise every render leaks
// into the next test and getByRole starts finding multiple elements.
afterEach(cleanup);
