import { useId, useState, type Ref } from 'react';
import {
  Platform,
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
 * Label + input + error, the theme's only text input. The label is the
 * accessible name and the error its hint — `accessibilityLiveRegion` is
 * Android-only, and a refocused input reads only its label to VoiceOver;
 * the focus state is a `colors.accent` border (visible focus, every plan's
 * rule). The label stays its own screen-reader stop. On Android the input is
 * labelled BY it (`labelFor`): an EditText holding text drops its own
 * `accessibilityLabel` from TalkBack's reading, and carrying both reads the
 * name twice (#280, S8). iOS has no `accessibilityLabelledBy`, so there the
 * input carries the label.
 */
export function TextField({ label, error, ref, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const labelId = useId();
  return (
    <View style={styles.wrap}>
      <Text style={styles.label} nativeID={labelId}>
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={Platform.OS === 'ios' ? label : undefined}
        accessibilityLabelledBy={labelId}
        placeholderTextColor={colors.fgMuted}
        {...rest}
        accessibilityHint={error ?? rest.accessibilityHint}
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
