import { useState, type Ref } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { colors, fontSize, radius, spacing } from '@taxi/shared';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Catalog copy, already formatted. Rendered in `colors.danger` and announced. */
  error?: string | null;
  ref?: Ref<TextInput>;
}

/**
 * Label + input + error, the theme's only text input. The label is also the
 * accessible name; the focus state is a `colors.accent` border (visible
 * focus, every plan's rule).
 */
export function TextField({ label, error, ref, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.fgMuted}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          styles.input,
          focused && styles.focused,
          Boolean(error) && styles.errored,
        ]}
      />
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { fontSize: fontSize.sm, color: colors.fgMuted },
  input: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    color: colors.fg,
    fontSize: fontSize.md,
  },
  focused: { borderWidth: 2, borderColor: colors.accent },
  errored: { borderColor: colors.danger },
  error: { fontSize: fontSize.sm, color: colors.danger },
});
