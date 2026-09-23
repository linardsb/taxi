import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { NO_EARNINGS } from './earnings-body';
import { EarningsCard } from './earnings-card';

const BODY = 'Norēķināts šodien: €7.66 · Braucieni: 1';

// #262: the card sits inside home's grouping `Pressable`, so a live region on
// it never reached the accessibility tree. It announces a new number itself.
describe('EarningsCard announcements (#262)', () => {
  let announce: jest.SpyInstance;
  beforeEach(() => {
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
  });
  afterEach(() => announce.mockRestore());

  it('speaks the number once when the spinner turns into it (expected)', async () => {
    const view = await render(<EarningsCard body={null} />);
    expect(announce).not.toHaveBeenCalled();

    await view.rerender(<EarningsCard body={BODY} />);
    await view.rerender(<EarningsCard body={BODY} />);

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(BODY);
    expect(screen.getByTestId('earnings').props.accessibilityLiveRegion).toBe(
      undefined,
    );
  });

  it('stays silent on mount with a number already there (edge)', async () => {
    await render(<EarningsCard body={BODY} />);
    expect(announce).not.toHaveBeenCalled();
  });

  it('does not announce the «—» of a failed first load (failure)', async () => {
    const view = await render(<EarningsCard body={null} />);
    await view.rerender(<EarningsCard body={NO_EARNINGS} />);
    expect(announce).not.toHaveBeenCalled();
  });
});
