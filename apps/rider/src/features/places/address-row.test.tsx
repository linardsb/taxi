import { render, screen, userEvent } from '@testing-library/react-native';
import { AddressRow } from './address-row';

describe('AddressRow', () => {
  it('reads as ONE utterance, not two (expected — a11y property 4)', async () => {
    await render(
      <AddressRow
        primaryText="Brīvības iela 45"
        secondaryText="Rīga, Latvija"
        onPress={jest.fn()}
      />,
    );

    // Twelve rows announcing twenty-four times is twice the audio cost for no
    // information (evidence §1.2).
    expect(
      screen.getByRole('button', { name: 'Brīvības iela 45, Rīga, Latvija' }),
    ).toBeTruthy();
  });

  it('omits the comma when there is no disambiguator (edge)', async () => {
    await render(<AddressRow primaryText="Mājas" onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Mājas' })).toBeTruthy();
  });

  it('is tappable and at least 44 px tall (failure — the touch-target floor)', async () => {
    const onPress = jest.fn();
    await render(<AddressRow primaryText="Mājas" onPress={onPress} />);

    const row = screen.getByRole('button', { name: 'Mājas' });
    await userEvent.press(row);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(row).toHaveStyle({ minHeight: 44 });
  });
});
