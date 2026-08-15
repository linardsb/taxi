/**
 * The API origin the BROWSER talks to — REST and the socket handshake alike.
 * `NEXT_PUBLIC_*` is inlined at build time (which is why the root turbo.json
 * lists it on the `build` task: without that, CI would cache a bundle baked
 * with one origin and serve it under another).
 *
 * Direct browser→API on purpose, unlike the tracking page's same-origin proxy:
 * WebSockets don't ride Next rewrites reliably, and hiding the origin buys
 * nothing once the client holds a JWT anyway (see the #18 plan's NOTES).
 */
export const apiUrl = (): string =>
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
