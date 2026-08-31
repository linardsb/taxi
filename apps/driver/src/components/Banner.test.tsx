import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { Banner } from './Banner';
import { TextField } from './TextField';

describe('Banner / TextField announcements', () => {
  it('on iOS a banner announces its text outright — VoiceOver has no live regions (expected)', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();

    await render(<Banner tone="danger" text="Something failed" />);

    expect(announce).toHaveBeenCalledWith('Something failed');
    announce.mockRestore();
  });

  it('on Android only the live region speaks — announcing too read every banner twice under TalkBack (edge — review F28)', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
    const os = jest.replaceProperty(Platform, 'OS', 'android');

    await render(<Banner tone="danger" text="Something failed" />);

    expect(announce).not.toHaveBeenCalled();
    os.restore();
    announce.mockRestore();
  });

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
