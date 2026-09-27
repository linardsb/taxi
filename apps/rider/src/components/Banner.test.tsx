import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import { Banner } from './Banner';

describe('Banner announcements', () => {
  it('on iOS a banner announces its text outright — VoiceOver has no live regions (expected)', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
    try {
      await render(<Banner tone="danger" text="Something failed" />);

      expect(announce).toHaveBeenCalledWith('Something failed');
    } finally {
      announce.mockRestore();
    }
  });

  it('on Android the banner announces its text once — the live region never reached TalkBack (#259 R11)', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    // `restoreMocks` is not set for this app, so a `Platform.OS` left as
    // `'android'` by a failed expect turned one real failure into a cascade
    // in every case after it (review F49).
    try {
      await render(<Banner tone="danger" text="Something failed" />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('Something failed');
    } finally {
      os.restore();
      announce.mockRestore();
    }
  });

  it.each(['ios', 'android'] as const)(
    'announce={false} stays silent on %s — the caller has its own announcer (edge)',
    async (platform) => {
      const announce = jest
        .spyOn(AccessibilityInfo, 'announceForAccessibility')
        .mockImplementation();
      const os = jest.replaceProperty(Platform, 'OS', platform);
      try {
        await render(
          <Banner tone="info" text="Quiet" announce={false} testID="b" />,
        );

        expect(screen.getByText('Quiet')).toBeOnTheScreen();
        expect(announce).not.toHaveBeenCalled();
      } finally {
        os.restore();
        announce.mockRestore();
      }
    },
  );

  it('carries no accessibilityLiveRegion — a second Android speaker if RN ever wires it', async () => {
    await render(<Banner tone="info" text="Hello" testID="b" />);

    expect(
      screen.getByTestId('b').props.accessibilityLiveRegion,
    ).toBeUndefined();
  });
});
