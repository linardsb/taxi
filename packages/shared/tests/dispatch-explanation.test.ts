import { describe, expect, it } from 'vitest';
import {
  dispatchExplanationSchema,
  explainAssignment,
  type ExplainAssignmentInput,
} from '../src/dispatch-explanation';
import { formatMessage } from '../src/format-message';

const input = (
  overrides: Partial<ExplainAssignmentInput> = {},
): ExplainAssignmentInput => ({
  strategy: 'geozone_queue',
  zoneName: 'Āgenskalns',
  queuePosition: 1,
  secondsInZone: 2_820, // 47 min
  etaSeconds: 240,
  ...overrides,
});

describe('explainAssignment', () => {
  it('composes the queue sentence Dina and the driver both read (expected)', () => {
    const explanation = explainAssignment(input());

    expect(explanation.key).toBe('explain.geozone_queue');
    expect(formatMessage('lv', explanation.key, explanation.params)).toBe(
      'Āgenskalns rinda #1 · zonā 47 min · 4 min attālumā',
    );
  });

  it('composes the auto-match sentence without a queue clause (expected)', () => {
    const explanation = explainAssignment(
      input({ strategy: 'auto_match', zoneName: null, queuePosition: null }),
    );

    expect(formatMessage('lv', explanation.key, explanation.params)).toBe(
      'Tuvākais · 4 min attālumā',
    );
  });

  it('states an override as a choice, never as a distance claim (expected)', () => {
    const explanation = explainAssignment(input({ strategy: 'dispatcher' }));

    expect(explanation.params).toEqual({});
    expect(formatMessage('lv', explanation.key, explanation.params)).toBe(
      'Dispečera izvēle',
    );
  });

  it('renders the SAME sentence in every language it ships (expected)', () => {
    const explanation = explainAssignment(input());

    // The identity the whole module exists for is per-language, not per-word:
    // whichever language the driver picked, they see the same facts Dina does.
    for (const lang of ['lv', 'ru', 'en'] as const) {
      const rendered = formatMessage(lang, explanation.key, explanation.params);
      expect(rendered).toContain('Āgenskalns');
      expect(rendered).toContain('1');
      expect(rendered).toContain('47');
      expect(rendered).toContain('4');
      // No placeholder survived — a visible `{zone}` means a param went missing.
      expect(rendered).not.toMatch(/\{\w+\}/);
    }
  });

  it('rounds a sub-minute ETA up to 1, never down to 0 (edge)', () => {
    const explanation = explainAssignment(
      input({ strategy: 'auto_match', etaSeconds: 40 }),
    );

    expect(explanation.params.eta).toBe(1);
  });

  it('floors time-in-zone, so a driver who just arrived reads 0 (edge)', () => {
    const justArrived = explainAssignment(input({ secondsInZone: 59 }));
    expect(justArrived.params.minutes).toBe(0);

    // And an unknown join timestamp reads the same, deliberately: it
    // under-claims tenure rather than inventing it.
    const unknown = explainAssignment(input({ secondsInZone: null }));
    expect(unknown.params.minutes).toBe(0);
  });

  it('says only the ETA when queue mode ran but the rank is unknown (failure)', () => {
    const explanation = explainAssignment(input({ queuePosition: null }));

    // Emphatically NOT «Tuvākais» — no distance ranking ran, and claiming one
    // would explain the assignment with a reason that did not happen.
    expect(explanation.key).toBe('explain.eta_only');
    expect(formatMessage('lv', explanation.key, explanation.params)).toBe(
      '4 min attālumā',
    );
  });

  it('degrades the same way when the zone has left the catalog (failure)', () => {
    const explanation = explainAssignment(input({ zoneName: null }));

    expect(explanation.key).toBe('explain.eta_only');
  });
});

describe('dispatchExplanationSchema', () => {
  it('accepts what explainAssignment produces (expected)', () => {
    expect(() =>
      dispatchExplanationSchema.parse(explainAssignment(input())),
    ).not.toThrow();
  });

  it('rejects an explanation with no key (failure)', () => {
    expect(() =>
      dispatchExplanationSchema.parse({ key: '', params: {} }),
    ).toThrow();
  });
});
