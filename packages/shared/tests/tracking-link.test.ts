import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../src/enums';
import {
  TRACKING_PATH_BY_LANGUAGE,
  trackingLink,
  trackingLinkHost,
} from '../src/tracking-link';

const TOKEN = 't'.repeat(16); // the minted length: randomBytes(12), 12 ÷ 3 × 4

describe('trackingLink', () => {
  it('renders host/<lang path>/<token> for every language (expected)', () => {
    expect(trackingLink('https://sakta.lv', TOKEN, 'lv')).toBe(
      `sakta.lv/t/${TOKEN}`,
    );
    expect(trackingLink('https://sakta.lv', TOKEN, 'ru')).toBe(
      `sakta.lv/r/${TOKEN}`,
    );
    expect(trackingLink('https://sakta.lv', TOKEN, 'en')).toBe(
      `sakta.lv/e/${TOKEN}`,
    );
  });

  it('collapses a trailing slash on the base URL (edge)', () => {
    expect(trackingLink('https://sakta.lv/', TOKEN, 'lv')).toBe(
      `sakta.lv/t/${TOKEN}`,
    );
  });

  it('strips an http:// base too, not just https:// (edge)', () => {
    expect(trackingLink('http://localhost:3000', TOKEN, 'ru')).toBe(
      `localhost:3000/r/${TOKEN}`,
    );
  });

  it('emits neither a scheme nor a ?lang= query (failure)', () => {
    for (const language of LANGUAGES) {
      const link = trackingLink('https://sakta.lv', TOKEN, language);
      expect(link, language).not.toContain('http');
      expect(link, language).not.toContain('?lang=');
      expect(link, language).not.toContain('?');
    }
  });

  it('keeps every language path to exactly one distinct character (failure)', () => {
    // The budget's `path` term is 3 characters — `/`, this, `/`. A two-letter
    // path puts RU driver_assigned at 71 against a 70-character segment.
    const paths = Object.values(TRACKING_PATH_BY_LANGUAGE);
    for (const path of paths) expect(path, path).toHaveLength(1);
    expect(new Set(paths).size).toBe(LANGUAGES.length);
  });

  it('renders at host + 1 + 1 + 1 + token, as the budget assumes (expected)', () => {
    const host = 'x'.repeat(10);
    const link = trackingLink(`https://${host}`, TOKEN, 'ru');
    expect(link).toHaveLength(host.length + 1 + 1 + 1 + TOKEN.length);
  });
});

describe('trackingLinkHost', () => {
  it('strips the scheme and every trailing slash (expected)', () => {
    expect(trackingLinkHost('https://sakta.lv')).toBe('sakta.lv');
    expect(trackingLinkHost('http://sakta.lv/')).toBe('sakta.lv');
    expect(trackingLinkHost('https://sakta.lv///')).toBe('sakta.lv');
    // A configured path prefix SURVIVES — it is what the SMS pays for, and
    // `new URL(baseUrl).host` would drop it unbudgeted.
    expect(trackingLinkHost('https://sakta.lv/app/')).toBe('sakta.lv/app');
  });

  it('empties out rather than under-trimming an all-slash tail (edge)', () => {
    // The trailing-slash strip is a hand-written loop, not a regex (see the
    // function's docblock). These are its boundaries: an exhausted string
    // must stop the loop at 0, not read `charCodeAt(-1)` forever.
    expect(trackingLinkHost('https://')).toBe('');
    expect(trackingLinkHost('///')).toBe('');
    expect(trackingLinkHost('')).toBe('');
  });

  it('runs in linear time on a slash run (failure — ReDoS, CodeQL alert #1)', () => {
    // `js/polynomial-redos` on PR #245. The `.replace(/\/+$/, '')` this
    // replaced backtracks quadratically — but ONLY on this input shape: the
    // slashes must be followed by a NON-slash, so every start position
    // consumes the whole run and then fails at `$`. A run that reaches the end
    // of the string matches on the engine's first try and is fast even on the
    // old code, which is why the trailing-`x` here is load-bearing and not
    // decoration.
    //
    // `observed` on node 20, old body vs this one, same inputs:
    //   n = 10k   86.9 ms  vs 0.104 ms
    //   n = 40k    1.39 s  vs 0.010 ms
    //   n = 80k    5.60 s  vs 0.008 ms
    //   n = 100k   8.75 s  vs 0.012 ms   ← the case below
    // So the old body fails this bound by 35× and blows vitest's 5 s default
    // timeout as well. The loop's own WORST measured case is not this one but
    // 100k REAL trailing slashes, which it walks in 2.23 ms (`observed`; the
    // regex did that in 0.121 ms — the loop is linear, not uniformly faster).
    // 250 ms is ~112× headroom over that worst case, so this cannot flake on a
    // slow runner without the linear property genuinely being gone.
    const input = `https://a${'/'.repeat(100_000)}x`;

    const started = performance.now();
    const host = trackingLinkHost(input);
    const elapsed = performance.now() - started;

    // Nothing is trimmed — the run does not reach the end — so the output is
    // the input minus its 8-character scheme.
    expect(host).toHaveLength(input.length - 'https://'.length);
    expect(host.endsWith('x')).toBe(true);
    expect(elapsed, `${elapsed.toFixed(1)} ms`).toBeLessThan(250);
  });
});
