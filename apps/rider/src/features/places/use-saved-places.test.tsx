import {
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
