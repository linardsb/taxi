import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, Text } from 'react-native';
import { PLACES_KEY, clearSavedPlaces } from './saved-places-store';
import { SavedPlacesProvider, useSavedPlaces } from './use-saved-places';

const POINT = {
  location: { lat: 56.9496, lng: 24.1052 },
  address: 'Brīvības iela 45, Rīga',
};
const OTHER_POINT = {
  location: { lat: 56.9469, lng: 24.1206 },
  address: 'Stacijas laukums 1, Rīga',
};

function Probe() {
  const { places, loading, save, remove } = useSavedPlaces();
  return (
    <>
      <Text>{loading ? 'loading' : `count:${places.length}`}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="save"
        onPress={() => void save('Mājas', POINT, 'place-1')}
      >
        <Text>save</Text>
      </Pressable>
      {/* A second, DIFFERENT address: `saveSavedPlace` replaces a row whose
          `point.address` already exists, so two saves of one address are one
          row by design and cannot show the lost-write. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="save-other"
        onPress={() => void save('Darbs', OTHER_POINT, 'place-2')}
      >
        <Text>save-other</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="remove"
        onPress={() => void remove(places[0]?.id ?? '')}
      >
        <Text>remove</Text>
      </Pressable>
      {places.map((p) => (
        <Text key={p.id}>{`${p.label}|${p.placeId ?? ''}`}</Text>
      ))}
    </>
  );
}

const renderProbe = () =>
  render(
    <SavedPlacesProvider>
      <Probe />
    </SavedPlacesProvider>,
  );

describe('SavedPlacesProvider', () => {
  beforeEach(() => clearSavedPlaces());

  it('loads once on mount and holds what it saved (expected)', async () => {
    await renderProbe();
    await screen.findByText('count:0');

    await userEvent.press(screen.getByRole('button', { name: 'save' }));

    await screen.findByText('count:1');
    // The place id survives, so a re-resolve of this saved place is free.
    expect(screen.getByText('Mājas|place-1')).toBeTruthy();
  });

  it('removes one (edge)', async () => {
    await renderProbe();
    await screen.findByText('count:0');
    await userEvent.press(screen.getByRole('button', { name: 'save' }));
    await screen.findByText('count:1');

    await userEvent.press(screen.getByRole('button', { name: 'remove' }));

    await waitFor(() => expect(screen.getByText('count:0')).toBeTruthy());
  });

  it('keeps BOTH of two saves fired before the first commits (failure — L8)', async () => {
    await renderProbe();
    await screen.findByText('count:0');

    // Both fired before either `setPlaces` commits. Closing over `places` made
    // both reads see the same array, and the second overwrote the first in
    // AsyncStorage.
    const first = screen.getByRole('button', { name: 'save' });
    const second = screen.getByRole('button', { name: 'save-other' });
    await act(async () => {
      fireEvent.press(first);
      fireEvent.press(second);
    });

    await waitFor(() => expect(screen.getByText('count:2')).toBeTruthy());
    // In the STORE, not just in React state — the overwrite happened on disk.
    const stored = JSON.parse(
      (await AsyncStorage.getItem(PLACES_KEY)) ?? '[]',
    ) as unknown[];
    expect(stored).toHaveLength(2);
  });

  it('comes up empty rather than stuck when the stored blob is corrupt (failure — E12)', async () => {
    await AsyncStorage.setItem(PLACES_KEY, '{not json');

    await renderProbe();

    // `loading` must resolve: a corrupt blob that left the provider loading
    // forever would hide the saved-places section on every launch, and there is
    // nothing here a rider cannot re-enter.
    await screen.findByText('count:0');
    expect(await AsyncStorage.getItem(PLACES_KEY)).toBeNull();
  });
});
