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
import { useAnnounceChange } from './use-announce-change';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Catalog copy, already formatted. Rendered in `colors.danger`, announced with the label. */
  error?: string | null;
  ref?: Ref<TextInput>;
}

/**
 * Label + input + error, the theme's only text input. The label is the
 * accessible name and the error its hint, so a refocused input reads both.
 * A new error is also announced as «label. error» on both platforms: a live
 * region does not reach TalkBack on this stack (#279), and one submit can
 * fail several fields with the same catalog string, so the label says which.
 * The focus state is a `colors.accent` border (visible focus, every plan's
 * rule). The label stays its own screen-reader stop. On Android the input is
 * labelled BY it (`labelFor`): an EditText holding text drops its own
 * `accessibilityLabel` from TalkBack's reading, and carrying both reads the
 * name twice (#280, S8). iOS has no `accessibilityLabelledBy`, so there the
 * input carries the label.
 */
export function TextField({ label, error, ref, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const labelId = useId();
  useAnnounceChange(error ? `${label}. ${error}` : null);
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
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
