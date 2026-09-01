import { render, screen } from '@testing-library/react-native';
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
