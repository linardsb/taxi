import { splitFare } from '@taxi/shared';
import type { DbTx } from '../../common/db/db.module';
import type { LedgerRepository } from './ledger.repository';
import { LedgerService, type PostRideSettlementInput } from './ledger.service';
import type { LedgerOwnerType } from './settlement-entries';

const RIDE_ID = 'r0000000-0000-4000-8000-000000000001';
const RIDER_ID = '5a5a5a5a-1111-4222-8333-444444444444';
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';

/** The service never touches it — every write goes through the fake repository. */
const TX = {} as DbTx;

interface InsertedEntry {
  accountId: string;
  entryType: string;
  amountCents: number;
}

/**
 * A plain recording object, not a mocking framework: this spec is about WHAT the
 * service composes (six rows, one transaction id, one balance delta, a stable
 * account order), and a hand-rolled fake states that more directly.
 */
class FakeLedgerRepository {
  readonly resolved: { ownerType: LedgerOwnerType; ownerId: string | null }[] =
    [];
  readonly inserts: {
    transactionId: string;
    rideId: string;
    rows: InsertedEntry[];
  }[] = [];
  readonly deltas: { driverId: string; deltaCents: number }[] = [];
  /** Set to make `accountFor` reject, standing in for a lost connection. */
  failAccountFor: Error | null = null;

  accountFor(
    _tx: DbTx,
    ownerType: LedgerOwnerType,
    ownerId: string | null,
  ): Promise<string> {
    if (this.failAccountFor) return Promise.reject(this.failAccountFor);
    this.resolved.push({ ownerType, ownerId });
    return Promise.resolve(`acct_${ownerType}_${ownerId ?? 'platform'}`);
  }

  insertEntries(
    _tx: DbTx,
    transactionId: string,
    rideId: string,
    rows: InsertedEntry[],
  ): Promise<void> {
    this.inserts.push({ transactionId, rideId, rows });
    return Promise.resolve();
  }

  applyDriverBalanceDelta(
    _tx: DbTx,
    driverId: string,
    deltaCents: number,
  ): Promise<void> {
    this.deltas.push({ driverId, deltaCents });
    return Promise.resolve();
  }
}

const build = () => {
  const repository = new FakeLedgerRepository();
  return {
    repository,
    service: new LedgerService(repository as unknown as LedgerRepository),
  };
};

const input = (
  paymentMethod: 'cash' | 'card',
  totalCents = 1_000,
): PostRideSettlementInput => ({
  rideId: RIDE_ID,
  paymentMethod,
  riderId: RIDER_ID,
  driverId: DRIVER_ID,
  split: splitFare(totalCents, { pct: 15, source: 'platform_base' }),
});

describe('LedgerService.postRideSettlement', () => {
  it('inserts six entries under one transaction id and credits the driver (expected)', async () => {
    const { service, repository } = build();

    const posted = await service.postRideSettlement(TX, input('card'));

    expect(repository.inserts).toHaveLength(1);
    const insert = repository.inserts[0]!;
    expect(insert.rows).toHaveLength(6);
    expect(insert.rideId).toBe(RIDE_ID);
    expect(insert.transactionId).toBe(posted.transactionId);
    // ONE transaction id for the whole set — the double-entry pairing key.
    expect(new Set(repository.inserts.map((i) => i.transactionId)).size).toBe(
      1,
    );
    expect(insert.rows.reduce((acc, r) => acc + r.amountCents, 0)).toBe(0);

    expect(repository.deltas).toEqual([
      { driverId: DRIVER_ID, deltaCents: 850 },
    ]);
    expect(posted.balanceDeltaCents).toBe(850);
  });

  it('debits the commission on a cash ride instead of crediting the net (edge)', async () => {
    const { service, repository } = build();

    const posted = await service.postRideSettlement(TX, input('cash'));

    expect(repository.inserts[0]!.rows).toHaveLength(6);
    expect(posted.balanceDeltaCents).toBe(-150);
    expect(repository.deltas).toEqual([
      { driverId: DRIVER_ID, deltaCents: -150 },
    ]);
  });

  it('resolves accounts platform → rider → driver, each exactly once (edge)', async () => {
    // The order is FIXED so two concurrent settlements take the same row locks
    // in the same sequence: they block, they do not deadlock.
    const { service, repository } = build();

    await service.postRideSettlement(TX, input('card'));

    expect(repository.resolved).toEqual([
      { ownerType: 'platform', ownerId: null },
      { ownerType: 'rider', ownerId: RIDER_ID },
      { ownerType: 'driver', ownerId: DRIVER_ID },
    ]);
  });

  it('writes nothing when an account cannot be resolved (failure)', async () => {
    // The caller's transaction rolls the rest back; what matters here is that
    // the service does not press on and apply a balance delta with no entries.
    const { service, repository } = build();
    repository.failAccountFor = new Error('connection terminated');

    await expect(service.postRideSettlement(TX, input('card'))).rejects.toThrow(
      'connection terminated',
    );

    expect(repository.inserts).toEqual([]);
    expect(repository.deltas).toEqual([]);
  });
});
