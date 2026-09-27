import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { TextField } from './TextField';

/** Mirrors `TextField.tsx` — these cases lived in `Banner.test.tsx`, where a reader grepping the mirrored path found nothing (review F49). */
describe('TextField error hints', () => {
  it("a field error is the input's hint, so a refocus reads it (edge)", async () => {
    await render(<TextField label="Plate" error="Invalid plate" />);

    expect(screen.getByLabelText('Plate').props.accessibilityHint).toBe(
      'Invalid plate',
    );
  });

  it("the hint returns to the caller's once the error clears (edge — review F29)", async () => {
    const view = await render(
      <TextField
        label="Plate"
        error="Invalid plate"
        accessibilityHint="hint"
      />,
    );
    expect(screen.getByLabelText('Plate').props.accessibilityHint).toBe(
      'Invalid plate',
    );

    await view.rerender(
      <TextField label="Plate" error={null} accessibilityHint="hint" />,
    );
    expect(screen.getByLabelText('Plate').props.accessibilityHint).toBe('hint');
  });
});

describe('TextField naming (#280)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('the input is labelled by the visible label, which stays its own stop (expected)', async () => {
    await render(<TextField label="Plate" />);

    const label = screen.getByText('Plate');
    expect(label.props.nativeID).toBeTruthy();
    expect(screen.getByLabelText('Plate').props.accessibilityLabelledBy).toBe(
      label.props.nativeID,
    );
  });

  it('on Android the input carries no accessibilityLabel, so the name is not read twice (edge — #280)', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await render(<TextField label="Plate" />);

    const input = screen.getByLabelText('Plate');
    expect(input.props.accessibilityLabel).toBeUndefined();
    expect(input.props.accessibilityLabelledBy).toBe(
      screen.getByText('Plate').props.nativeID,
    );
  });
});

// #279: a live region on the error never reached TalkBack (#259 R11), so a
// new error is announced outright, named by its field.
describe('TextField error announcements (#279)', () => {
  let announce: jest.SpyInstance;
  beforeEach(() => {
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
  });
  afterEach(() => announce.mockRestore());

  it('speaks «label. error» once when an error appears, with no live region (expected)', async () => {
    const view = await render(<TextField label="Plate" />);
    await view.rerender(<TextField label="Plate" error="Invalid plate" />);
    await view.rerender(<TextField label="Plate" error="Invalid plate" />);

    expect(announce.mock.calls).toEqual([['Plate. Invalid plate']]);
    expect(
      screen.getByText('Invalid plate').props.accessibilityLiveRegion,
    ).toBeUndefined();
  });

  it('speaks a changed error again, but not its clearing (edge)', async () => {
    const view = await render(
      <TextField label="Plate" error="Invalid plate" />,
    );
    await view.rerender(<TextField label="Plate" error="Plate taken" />);
    await view.rerender(<TextField label="Plate" error={null} />);

    expect(announce.mock.calls).toEqual([['Plate. Plate taken']]);
  });

  it('stays silent with no error (failure)', async () => {
    const view = await render(<TextField label="Plate" />);
    await view.rerender(<TextField label="Plate" error={null} />);
    expect(announce).not.toHaveBeenCalled();
  });
});
