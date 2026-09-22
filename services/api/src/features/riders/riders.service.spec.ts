import type { RidersRepository } from './riders.repository';
import { RidersService } from './riders.service';

const RIDER_ID = '99999999-8888-4777-8666-555555555555';
const TOKEN = 'ExponentPushToken[rider0000000000000]';

function build() {
  const writes: { riderId: string; token: string | null }[] = [];
  const repository = {
    setPushToken: (riderId: string, token: string | null) => {
      writes.push({ riderId, token });
      return Promise.resolve();
    },
  } as unknown as RidersRepository;
  return { service: new RidersService(repository), writes };
}

describe('RidersService push token (#17)', () => {
  it('registers the token against the id it was given (expected)', async () => {
    const { service, writes } = build();

    await service.setPushToken(RIDER_ID, TOKEN);

    expect(writes).toEqual([{ riderId: RIDER_ID, token: TOKEN }]);
  });

  it('clears by writing NULL, not by deleting a row (edge)', async () => {
    // The `users` row outlives the token — a rider who signs out still has an
    // account, rides and a ledger history.
    const { service, writes } = build();

    await service.clearPushToken(RIDER_ID);

    expect(writes).toEqual([{ riderId: RIDER_ID, token: null }]);
  });

  it('re-registering the same token is an ordinary write, not a special case (edge)', async () => {
    // Every signed-in app start calls this. If it ever grows a read-first
    // branch, that read is a race: two starts can both miss and both write.
    const { service, writes } = build();

    await service.setPushToken(RIDER_ID, TOKEN);
    await service.setPushToken(RIDER_ID, TOKEN);

    expect(writes).toHaveLength(2);
    expect(writes.every((w) => w.token === TOKEN)).toBe(true);
  });
});
