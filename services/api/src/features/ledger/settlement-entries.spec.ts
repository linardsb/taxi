import { splitFare, type FareSplit } from '@taxi/shared';
import {
  buildSettlementEntries,
  driverBalanceDelta,
  type LedgerEntryDraft,
  type SettlementInput,
} from './settlement-entries';

const RIDER_ID = '5a5a5a5a-1111-4222-8333-444444444444';
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';

/**
 * Built with `splitFare`, never by hand — that way every fixture is itself proof
 * the split is legal (it parses through `fareSplitSchema`'s no-cent-leak
 * refinement on the way out).
 */
const split = (totalCents: number, pct = 15): FareSplit =>
  splitFare(totalCents, { pct, source: 'platform_base' });

const input = (
  paymentMethod: 'cash' | 'card',
  totalCents = 1_000,
  pct = 15,
): SettlementInput => ({
  paymentMethod,
  riderId: RIDER_ID,
  driverId: DRIVER_ID,
  split: split(totalCents, pct),
});

const sumOf = (entries: LedgerEntryDraft[]): number =>
  entries.reduce((acc, e) => acc + e.amountCents, 0);

const forOwner = (entries: LedgerEntryDraft[], ownerType: string) =>
  entries.filter((e) => e.ownerType === ownerType);

describe('buildSettlementEntries', () => {
  it('posts a card ride as six entries: rider 0, driver +net, platform −net (expected)', () => {
    const entries = buildSettlementEntries(input('card'));

    expect(entries).toHaveLength(6);
    expect(sumOf(entries)).toBe(0);
    // The rider is a BALANCE, not a spend log — this is the property the
    // `card_settlement` pair (and its enum value) exists to buy.
    expect(sumOf(forOwner(entries, 'rider'))).toBe(0);
    expect(sumOf(forOwner(entries, 'driver'))).toBe(850);
    // Contra: the platform is the negated sum of everyone else's claims.
    expect(sumOf(forOwner(entries, 'platform'))).toBe(-850);
    // Revenue is the per-entry-type read, not the account's aggregate.
    expect(
      sumOf(
        entries.filter(
          (e) => e.ownerType === 'platform' && e.entryType === 'commission',
        ),
      ),
    ).toBe(150);
    expect(entries.every((e) => Number.isInteger(e.amountCents))).toBe(true);
    // The platform is the only owner with no id.
    expect(entries.filter((e) => e.ownerId === null)).toHaveLength(2);
  });

  it('posts a cash ride as six entries: rider 0, driver −commission (expected)', () => {
    const entries = buildSettlementEntries(input('cash'));

    expect(entries).toHaveLength(6);
    expect(sumOf(entries)).toBe(0);
    expect(sumOf(forOwner(entries, 'rider'))).toBe(0);
    // The driver already holds the passenger's €10, so all that is left between
    // them and the platform is the commission they owe.
    expect(sumOf(forOwner(entries, 'driver'))).toBe(-150);
    expect(sumOf(forOwner(entries, 'platform'))).toBe(150);
  });

  it('differs between cash and card in exactly one pair — the collection (expected)', () => {
    // THE structural property: a reconciliation read can ignore the payment
    // method entirely, because everything except who collected is identical.
    const strip = (entries: LedgerEntryDraft[]) =>
      entries.filter((e) => !e.entryType.endsWith('_settlement'));

    const card = buildSettlementEntries(input('card'));
    const cash = buildSettlementEntries(input('cash'));

    expect(strip(card)).toEqual(strip(cash));
    expect(strip(card)).toHaveLength(4);

    const collection = (entries: LedgerEntryDraft[]) =>
      entries.filter((e) => e.entryType.endsWith('_settlement'));
    expect(
      collection(card)
        .map((e) => e.ownerType)
        .sort(),
    ).toEqual(['platform', 'rider']);
    expect(
      collection(cash)
        .map((e) => e.ownerType)
        .sort(),
    ).toEqual(['driver', 'rider']);
  });

  it('writes the commission rows as ZERO rather than skipping them at 0% (edge)', () => {
    // The evidenced S6-7 pilot. A written zero proves the commission was
    // computed, and keeps the entry shape identical for every ride.
    const entries = buildSettlementEntries(input('card', 1_000, 0));

    const commission = entries.filter((e) => e.entryType === 'commission');
    expect(commission).toHaveLength(2);
    expect(commission.every((e) => e.amountCents === 0)).toBe(true);
    expect(entries).toHaveLength(6);
    expect(sumOf(entries)).toBe(0);
    expect(sumOf(forOwner(entries, 'driver'))).toBe(1_000);
  });

  it('stays exact on a fare whose commission rounds (edge)', () => {
    // 15% of 999 is 149.85 → 150, so the net is 849 BY SUBTRACTION. Nothing
    // leaks, because `splitFare` derives the net rather than rounding it too.
    const entries = buildSettlementEntries(input('cash', 999));

    expect(sumOf(entries)).toBe(0);
    expect(sumOf(forOwner(entries, 'rider'))).toBe(0);
    expect(sumOf(forOwner(entries, 'driver'))).toBe(-150);
  });

  it.each([
    [1, 'card'],
    [7, 'cash'],
    [350, 'card'],
    [999, 'cash'],
    [1_000, 'card'],
    [12_345, 'cash'],
    [1_000_000, 'card'],
  ] as const)(
    'balances to zero and nets the rider to zero for %i cents on %s (failure/invariant)',
    (totalCents, method) => {
      const entries = buildSettlementEntries(input(method, totalCents));

      expect(sumOf(entries)).toBe(0);
      expect(sumOf(forOwner(entries, 'rider'))).toBe(0);
    },
  );
});

describe('driverBalanceDelta', () => {
  it('equals driverNetCents on card and −commissionCents on cash (failure/invariant)', () => {
    // This is what makes `drivers.balance_cents == SUM(driver entries)` true by
    // construction rather than by two agreeing implementations.
    const card = input('card');
    const cash = input('cash');

    expect(driverBalanceDelta(buildSettlementEntries(card), DRIVER_ID)).toBe(
      card.split.driverNetCents,
    );
    expect(driverBalanceDelta(buildSettlementEntries(cash), DRIVER_ID)).toBe(
      -cash.split.commissionCents,
    );
  });

  it('ignores rows belonging to another driver (edge)', () => {
    const entries = buildSettlementEntries(input('card'));

    expect(
      driverBalanceDelta(entries, 'd0000000-0000-4000-8000-000000000009'),
    ).toBe(0);
  });
});
