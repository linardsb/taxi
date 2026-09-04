import { render } from '@testing-library/react-native';
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

  it('on Android only the live region speaks — announcing too read every banner twice under TalkBack (edge)', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    // `restoreMocks` is not set for this app, so a `Platform.OS` left as
    // `'android'` by a failed expect turned one real failure into a cascade
    // in every case after it (review F49).
    try {
      await render(<Banner tone="danger" text="Something failed" />);

      expect(announce).not.toHaveBeenCalled();
    } finally {
      os.restore();
      announce.mockRestore();
    }
  });
});
