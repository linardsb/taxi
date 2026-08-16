import { formatMessage } from '@taxi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertsPanel } from './alerts-panel';
import type { BoardAlert } from './board-state';

const unclaimedAlert: BoardAlert = {
  id: 'unclaimed:r1:2026-08-15T12:00:00.000Z:90',
  kind: 'unclaimed',
  rideId: 'r1',
  address: 'Brīvības 1',
  at: '2026-08-15T12:00:00.000Z',
};
const smsAlert: BoardAlert = {
  id: 'sms_failed:r2:2026-08-15T12:01:00.000Z',
  kind: 'sms_failed',
  rideId: 'r2',
  smsKind: 'booking_confirmed',
  at: '2026-08-15T12:01:00.000Z',
};

/** Structural Web-Audio stub — jsdom ships no AudioContext at all. */
const oscillator = { connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
class FakeAudioContext {
  currentTime = 0;
  createOscillator() {
    return { ...oscillator, frequency: { value: 0 } };
  }
  createGain() {
    return { connect: vi.fn(), gain: { value: 0 } };
  }
  destination = {};
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AlertsPanel', () => {
  it('renders action-required alerts as list rows, newest first (expected)', () => {
    render(<AlertsPanel alerts={[smsAlert, unclaimedAlert]} ack={vi.fn()} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(
      formatMessage('lv', 'console.sms_kind_booking_confirmed'),
    );
    expect(rows[1]).toHaveTextContent('Brīvības 1');
    expect(rows[1]).toHaveTextContent(
      formatMessage('lv', 'console.alert_unclaimed'),
    );
  });

  it('announces through ONE live region wrapping a real list (expected)', () => {
    render(<AlertsPanel alerts={[smsAlert, unclaimedAlert]} ack={vi.fn()} />);

    // role="alert" per <li> would override each row's implicit listitem role,
    // leaving a <ul> with no list children and N assertive regions.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('acknowledge fires with the alert id — one click (expected)', () => {
    const ack = vi.fn();
    render(<AlertsPanel alerts={[unclaimedAlert]} ack={ack} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: formatMessage('lv', 'console.alert_ack'),
      }),
    );
    expect(ack).toHaveBeenCalledWith(unclaimedAlert.id);
  });

  it('beeps only after the mute toggle is switched on — the unlock gesture (edge)', () => {
    const { rerender } = render(<AlertsPanel alerts={[]} ack={vi.fn()} />);

    // Muted (default): a new alert arrives silently.
    rerender(<AlertsPanel alerts={[unclaimedAlert]} ack={vi.fn()} />);
    expect(oscillator.start).not.toHaveBeenCalled();

    const toggle = screen.getByRole('button', {
      name: formatMessage('lv', 'console.alerts_muted'),
    });
    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', {
        name: formatMessage('lv', 'console.alerts_unmuted'),
      }),
    ).toHaveAttribute('aria-pressed', 'true');

    // Unmuted: the NEXT new alert beeps.
    rerender(
      <AlertsPanel alerts={[smsAlert, unclaimedAlert]} ack={vi.fn()} />,
    );
    expect(oscillator.start).toHaveBeenCalledTimes(1);
  });

  it('stays silent when an alert is acknowledged while unmuted (edge)', () => {
    // Acking the top alert makes alerts[0] the one UNDERNEATH. Keyed on "is
    // this a different newest id?", that reads as new and beeps for an alarm
    // already on screen and already seen — N−1 spurious beeps to clear N.
    const { rerender } = render(
      <AlertsPanel alerts={[smsAlert, unclaimedAlert]} ack={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: formatMessage('lv', 'console.alerts_muted'),
      }),
    );
    expect(oscillator.start).not.toHaveBeenCalled(); // both already seen

    // Ack the newest → the older one surfaces to the top.
    rerender(<AlertsPanel alerts={[unclaimedAlert]} ack={vi.fn()} />);
    expect(oscillator.start).not.toHaveBeenCalled();

    // …and clearing the last one is silent too.
    rerender(<AlertsPanel alerts={[]} ack={vi.fn()} />);
    expect(oscillator.start).not.toHaveBeenCalled();
  });

  it('beeps again for a genuinely new alert after an acknowledge (edge)', () => {
    const { rerender } = render(
      <AlertsPanel alerts={[unclaimedAlert]} ack={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: formatMessage('lv', 'console.alerts_muted'),
      }),
    );
    rerender(<AlertsPanel alerts={[]} ack={vi.fn()} />); // acked
    expect(oscillator.start).not.toHaveBeenCalled();

    // Suppressing the ack must not suppress the next real alarm.
    rerender(<AlertsPanel alerts={[smsAlert]} ack={vi.fn()} />);
    expect(oscillator.start).toHaveBeenCalledTimes(1);
  });

  it('shows no alert rows at all when the list is empty — no noise (failure)', () => {
    render(<AlertsPanel alerts={[]} ack={vi.fn()} />);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
