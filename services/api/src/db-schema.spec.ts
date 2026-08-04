import { createDb, geozones, platformConfig, rides } from '@taxi/db';

// Compile-time importability is the real assertion (#6): the api can consume
// @taxi/db's types without any NestJS wiring (that arrives in #7).
describe('@taxi/db import smoke', () => {
  it('exposes the core tables and the client factory', () => {
    expect(rides).toBeDefined();
    expect(geozones).toBeDefined();
    expect(platformConfig).toBeDefined();
    expect(createDb).toBeDefined();
  });
});
