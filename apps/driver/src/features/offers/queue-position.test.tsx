import { render, screen } from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import { AccessibilityInfo } from 'react-native';
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

  it('renders nothing before the first driver:queue (failure)', async () => {
    await render(<QueuePosition queue={null} />);
    expect(screen.queryByTestId('queue-position')).toBeNull();
  });
});

// #279: a live region never reached TalkBack (#259 R11), so a new rank is
// announced outright.
describe('QueuePosition announcements (#279)', () => {
  let announce: jest.SpyInstance;
  beforeEach(() => {
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
  });
  afterEach(() => announce.mockRestore());

  const label = (position: number, size: number) =>
    t('driver.queue.position', { position, size, zone: 'rix' });

  it('speaks the first rank and each change once, with no live region (expected)', async () => {
    const view = await render(<QueuePosition queue={null} />);
    await view.rerender(<QueuePosition queue={event(1, 3)} />);
    await view.rerender(<QueuePosition queue={event(2, 3)} />);
    await view.rerender(<QueuePosition queue={event(2, 3)} />);

    expect(announce.mock.calls).toEqual([[label(1, 3)], [label(2, 3)]]);
    expect(
      screen.getByTestId('queue-position').props.accessibilityLiveRegion,
    ).toBeUndefined();
  });

  it('stays silent on mount with a rank already there (edge)', async () => {
    await render(<QueuePosition queue={event(2, 3)} />);
    expect(announce).not.toHaveBeenCalled();
  });

  it('stays silent while another screen is on top, and does not replay it after (failure)', async () => {
    const view = await render(<QueuePosition queue={event(1, 3)} />);
    await view.rerender(<QueuePosition queue={event(2, 3)} announce={false} />);
    await view.rerender(<QueuePosition queue={event(2, 3)} />);

    expect(announce).not.toHaveBeenCalled();
    expect(screen.getByTestId('queue-position')).toHaveTextContent(label(2, 3));
  });
});
