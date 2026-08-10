import { Logger } from '@nestjs/common';
import type { Db } from '@taxi/db';
import type {
  PaymentChargeRequest,
  PaymentChargeResult,
  PaymentFailureReason,
  PaymentsProvider,
  PaymentMethodType,
  Ride,
  RideStatus,
} from '@taxi/shared';
import type { DbTx } from '../../common/db/db.module';
import type { LedgerService } from '../ledger';
import type { RidesRepository, RideTransitionService } from '../rides';
import { settlementIdempotencyKey } from './settlement.policy';
import type {
  SettlableRide,
  SettlementRepository,
} from './settlement.repository';
import { SettlementService } from './settlement.service';

const RIDE_ID = 'r0000000-0000-4000-8000-000000000001';
const RIDER_ID = '5a5a5a5a-1111-4222-8333-444444444444';
const DRIVER_ID = 'd0000000-0000-4000-8000-000000000001';
const OTHER_DRIVER_ID = 'd0000000-0000-4000-8000-000000000009';
const DISPATCHER_ID = 'a0000000-0000-4000-8000-000000000001';

const settlable = (over: Partial<SettlableRide> = {}): SettlableRide => ({
  id: RIDE_ID,
  orderId: '10000000-0000-4000-8000-000000000001',
  status: 'completed',
  riderId: RIDER_ID,
  driverId: DRIVER_ID,
  paymentMethod: 'card',
  totalCents: 1_000,
  commissionPct: 15,
  commissionSource: 'platform_base',
  commissionCents: 150,
  driverNetCents: 850,
  riderCustomerRef: 'cus_test_123',
  riderInstrumentRef: 'pm_test_456',
  ...over,
});

class FakePaymentsProvider implements PaymentsProvider {
  readonly calls: PaymentChargeRequest[] = [];
  private nextFailure: PaymentFailureReason | null = null;

  failNext(reason: PaymentFailureReason): void {
    this.nextFailure = reason;
  }

  charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    this.calls.push(request);
    if (this.nextFailure) {
      const reason = this.nextFailure;
      this.nextFailure = null;
      return Promise.resolve({
        ok: false,
        reason,
        providerRef: null,
        message: `fake ${reason}`,
      });
    }
    return Promise.resolve({
      ok: true,
      providerRef: `pi_test_${this.calls.length}`,
    });
  }
}

const build = (
  ride: SettlableRide | undefined,
  options: { transitionWins?: boolean; postThrows?: Error } = {},
) => {
  const payments = new FakePaymentsProvider();
  const posted: unknown[] = [];
  const paymentRefs: string[] = [];
  let transactionsOpened = 0;

  const settlements = {
    findSettlable: () => Promise.resolve(ride),
    writePaymentRef: (_tx: DbTx, _rideId: string, providerRef: string) => {
      paymentRefs.push(providerRef);
      return Promise.resolve();
    },
  } as unknown as SettlementRepository;

  const ledger = {
    postRideSettlement: (_tx: DbTx, input: unknown) => {
      if (options.postThrows) return Promise.reject(options.postThrows);
      posted.push(input);
      return Promise.resolve({
        transactionId: 'txn_1',
        balanceDeltaCents: 850,
      });
    },
  } as unknown as LedgerService;

  const transitions = {
    transitionInTx: () =>
      Promise.resolve(
        options.transitionWins === false
          ? undefined
          : {
              id: RIDE_ID,
              orderId: '10000000-0000-4000-8000-000000000001',
              status: 'settled' as RideStatus,
              riderId: RIDER_ID,
              driverId: DRIVER_ID,
              geozoneId: null,
              createdAt: new Date(),
            },
      ),
    emitStatus: jest.fn(),
  } as unknown as RideTransitionService;

  // Carries `quote` and `split` because `readRide` runs
  // `assertRideSplitConsistent`, which compares their totals — a thinner fixture
  // would make this spec crash on a check the real repository always satisfies.
  const settledRide = {
    id: RIDE_ID,
    status: 'settled',
    quote: { totalCents: ride?.totalCents ?? 1_000 },
    split: { totalCents: ride?.totalCents ?? 1_000 },
  } as unknown as Ride;

  const rides = {
    findWithQuote: () =>
      Promise.resolve({ ride: settledRide, quote: settledRide.quote }),
  } as unknown as RidesRepository;

  // The callback runs directly: this spec is about the ORDER of operations, and
  // whether a real transaction commits is the integration spec's question.
  const db = {
    transaction: <T>(fn: (tx: DbTx) => Promise<T>) => {
      transactionsOpened += 1;
      return fn({} as DbTx);
    },
  } as unknown as Db;

  return {
    payments,
    posted,
    paymentRefs,
    transactionsOpened: () => transactionsOpened,
    service: new SettlementService(
      db,
      settlements,
      ledger,
      transitions,
      rides,
      payments,
    ),
  };
};

const settle = (service: SettlementService) =>
  service.settle({ rideId: RIDE_ID, actor: 'driver', actorId: DRIVER_ID });

describe('SettlementService.settle', () => {
  // The two `write_failed` cases spy on `Logger.prototype`, which is global. An
  // IN-BODY restore would leak the spy into every test below on the first failed
  // assertion — the throw jumps past the `mockRestore()` line below it — and
  // turn one red test into a cascade that hides it. `afterEach` runs either way,
  // which is the whole reason the restore lives here and not in the tests.
  afterEach(() => jest.restoreAllMocks());

  it('charges a card ride exactly once with a ride-derived key, then posts (expected)', async () => {
    const { service, payments, posted, paymentRefs } = build(settlable());

    await settle(service);

    // "Charged exactly once" is what this ticket is really about — a response
    // assertion alone would pass while double-charging.
    expect(payments.calls).toHaveLength(1);
    expect(payments.calls[0]).toMatchObject({
      idempotencyKey: settlementIdempotencyKey(RIDE_ID),
      amountCents: 1_000,
      currency: 'EUR',
      customerRef: 'cus_test_123',
      instrumentRef: 'pm_test_456',
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      rideId: RIDE_ID,
      riderId: RIDER_ID,
      driverId: DRIVER_ID,
      paymentMethod: 'card',
    });
    expect(paymentRefs).toEqual(['pi_test_1']);
  });

  it('never calls the provider for a cash ride but still posts the ledger (expected)', async () => {
    // The whole reason the cash/card branch lives ABOVE the seam: the driver
    // already took the money at the kerb, so there is nothing to charge.
    const { service, payments, posted, paymentRefs } = build(
      settlable({ paymentMethod: 'cash' }),
    );

    await settle(service);

    expect(payments.calls).toEqual([]);
    expect(posted).toHaveLength(1);
    expect(paymentRefs).toEqual([]); // nothing to reference
  });

  it('answers 201 for an already-settled ride without charging or posting (edge)', async () => {
    const { service, payments, posted, transactionsOpened } = build(
      settlable({ status: 'settled' }),
    );

    await expect(settle(service)).resolves.toMatchObject({
      ride: { status: 'settled' },
    });
    expect(payments.calls).toEqual([]);
    expect(posted).toEqual([]);
    expect(transactionsOpened()).toBe(0);
  });

  it('answers 201 when it loses the transition race, posting nothing (edge)', async () => {
    // The loser's charge and the winner's charge are the SAME PaymentIntent
    // (one derived key), so 201-with-the-settled-ride is true, not a papered-over
    // conflict. A 409 here would make a retrying driver app treat success as failure.
    const { service, payments, posted } = build(settlable(), {
      transitionWins: false,
    });

    await expect(settle(service)).resolves.toMatchObject({
      ride: { status: 'settled' },
    });
    expect(posted).toEqual([]);
    // The charge already happened before the transaction — what must NOT happen
    // is a second one after losing.
    expect(payments.calls).toHaveLength(1);
  });

  it('skips the provider on a zero-amount card ride but still posts (edge)', async () => {
    // Stripe rejects zero-amount intents, and there is nothing to collect.
    const { service, payments, posted } = build(
      settlable({ totalCents: 0, commissionCents: 0, driverNetCents: 0 }),
    );

    await settle(service);

    expect(payments.calls).toEqual([]);
    expect(posted).toHaveLength(1);
  });

  it.each(['balance', 'corporate'] as PaymentMethodType[])(
    'refuses %s with 409 payment_method_unsupported, provider untouched (edge)',
    async (paymentMethod) => {
      const { service, payments, posted, transactionsOpened } = build(
        settlable({ paymentMethod }),
      );
      const logged = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await expect(settle(service)).rejects.toThrow(
        'payment_method_unsupported',
      );
      expect(payments.calls).toEqual([]);
      expect(posted).toEqual([]);
      // Refused ABOVE the charge, so there is nothing to roll back. Narrowing
      // inside the transaction instead would fail closed only after the money
      // had already moved — the `write_failed` hazard, manufactured on purpose.
      expect(transactionsOpened()).toBe(0);
      // The refusal names the ride and the reason (#70) — without this line the
      // reconciliation query surfaces the stuck ride and nothing says why.
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'payment.settlement.refused',
          rideId: RIDE_ID,
          paymentMethod,
          cause: 'payment_method_unsupported',
        }),
      );
    },
  );

  it.each([
    ['customer', { riderCustomerRef: null }],
    ['instrument', { riderInstrumentRef: null }],
  ])(
    'refuses a card ride whose rider has no %s ref, provider untouched (failure)',
    async (_label, over) => {
      const { service, payments, posted } = build(settlable(over));
      const logged = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      await expect(settle(service)).rejects.toThrow(
        'payment_instrument_missing',
      );
      expect(payments.calls).toEqual([]);
      expect(posted).toEqual([]);
      // The expected outcome for every card ride until #17 enrolls riders — the
      // common case of the diagnosis gap #70 closes, not a corner.
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'payment.settlement.refused',
          rideId: RIDE_ID,
          paymentMethod: 'card',
          cause: 'payment_instrument_missing',
        }),
      );
    },
  );

  it('answers 402 on a decline, writing nothing and opening no transaction (failure)', async () => {
    // The charge runs BEFORE the transaction precisely so a failure leaves no
    // residue: no ledger entries, no status change, nothing to roll back.
    const { service, payments, posted, transactionsOpened } =
      build(settlable());
    payments.failNext('declined');

    await expect(settle(service)).rejects.toMatchObject({ status: 402 });
    expect(posted).toEqual([]);
    expect(transactionsOpened()).toBe(0);
  });

  it('answers 502 on a provider error, writing nothing (failure)', async () => {
    const { service, payments, posted, transactionsOpened } =
      build(settlable());
    payments.failNext('provider_error');

    await expect(settle(service)).rejects.toMatchObject({ status: 502 });
    expect(posted).toEqual([]);
    expect(transactionsOpened()).toBe(0);
  });

  it('refuses a ride that is not completed (failure)', async () => {
    const { service, payments } = build(settlable({ status: 'in_progress' }));

    await expect(settle(service)).rejects.toThrow('ride_not_completed');
    expect(payments.calls).toEqual([]);
  });

  it('throws loudly on a completed ride with a missing split column (failure)', async () => {
    // A data bug, not a case to handle: #11 writes all five columns in the same
    // transaction as `in_progress → completed`.
    const { service, payments } = build(settlable({ commissionCents: null }));

    await expect(settle(service)).rejects.toThrow(
      /missing a driver or part of the settled split/,
    );
    expect(payments.calls).toEqual([]);
  });

  it('forbids a driver settling someone else’s ride, allows a dispatcher (failure)', async () => {
    const { service } = build(settlable({ driverId: OTHER_DRIVER_ID }));

    await expect(
      service.settle({ rideId: RIDE_ID, actor: 'driver', actorId: DRIVER_ID }),
    ).rejects.toThrow('ride_not_yours');

    // The override is what makes a stuck ride recoverable by the person on the
    // phone with the driver — the same reasoning as `cancel`.
    const { service: asDispatcher, payments } = build(
      settlable({ driverId: OTHER_DRIVER_ID }),
    );
    await expect(
      asDispatcher.settle({
        rideId: RIDE_ID,
        actor: 'dispatcher',
        actorId: DISPATCHER_ID,
      }),
    ).resolves.toBeDefined();
    expect(payments.calls).toHaveLength(1);
  });

  it('logs write_failed naming the ride AND the PaymentIntent when the write rolls back (failure)', async () => {
    // THE ONLY PATH WHERE THE CHARGE WAS OBSERVED TO SUCCEED AND THE WRITE DID
    // NOT — a charge that times out AFTER Stripe took the money also succeeded
    // and also wrote nothing; we just never saw it (`settlement.service.ts`).
    // Here `payment_provider_ref` rolls back to NULL and the ride reads
    // `completed` as if nothing happened — while the rider's money sits at
    // Stripe.
    // `charge_failed` cannot cover this (the charge SUCCEEDED) and `settled`
    // never runs, so without this line no log anywhere names the ride and the
    // intent together, and reconciliation cannot tell "charged, then rolled
    // back" from "never charged" without opening the dashboard.
    const { service, payments } = build(settlable(), {
      postThrows: new Error('connection terminated mid-transaction'),
    });
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(settle(service)).rejects.toThrow(
      'connection terminated mid-transaction',
    );

    // Rethrown unchanged — this log makes the loss visible, it does not swallow it.
    expect(payments.calls).toHaveLength(1);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment.settlement.write_failed',
        rideId: RIDE_ID,
        driverId: DRIVER_ID,
        riderId: RIDER_ID,
        paymentMethod: 'card',
        totalCents: 1_000,
        // The handle that makes the stranded money findable.
        providerRef: 'pi_test_1',
        message: 'connection terminated mid-transaction',
      }),
    );
  });

  it('logs write_failed with a null providerRef when a CASH write rolls back (edge)', async () => {
    // The line still fires where no money is stranded, and the null ref is
    // itself the signal that nothing is: a cash rollback costs nothing, so
    // reconciliation can skip it without opening Stripe.
    const { service, payments } = build(settlable({ paymentMethod: 'cash' }), {
      postThrows: new Error('deadlock detected'),
    });
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(settle(service)).rejects.toThrow('deadlock detected');

    expect(payments.calls).toEqual([]);
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment.settlement.write_failed',
        rideId: RIDE_ID,
        paymentMethod: 'cash',
        providerRef: null,
      }),
    );
  });

  it('answers 404 for a ride that does not exist (failure)', async () => {
    const { service, payments } = build(undefined);

    await expect(settle(service)).rejects.toThrow('ride_not_found');
    expect(payments.calls).toEqual([]);
  });
});
