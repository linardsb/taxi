import { render, screen } from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import { QueuePosition } from './queue-position';

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

const event = (position: number, size: number) => ({
  driverId: 'd0000000-0000-4000-8000-000000000001',
  geozoneId: '00000000-0000-4000-8000-000000000102',
  geozoneSlug: 'rix',
  position,
  size,
  at: '2026-09-04T10:00:00.000Z',
});

describe('QueuePosition (#15)', () => {
  it('renders the store`s 1-based rank verbatim — never +1 (expected)', async () => {
    await render(<QueuePosition queue={event(1, 3)} />);
    expect(
      screen.getByText(
        t('driver.queue.position', { position: 1, size: 3, zone: 'rix' }),
      ),
    ).toBeTruthy();
  });

  it('is a polite live region, so a demotion is announced without stealing focus (edge)', async () => {
    await render(<QueuePosition queue={event(2, 3)} />);
    expect(
      screen.getByTestId('queue-position').props.accessibilityLiveRegion,
    ).toBe('polite');
  });

  it('renders nothing before the first driver:queue (failure)', async () => {
    await render(<QueuePosition queue={null} />);
    expect(screen.queryByTestId('queue-position')).toBeNull();
  });
});
