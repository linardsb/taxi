import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type AccessibilityState,
} from 'react-native';
import { colors, fontSize, radius, spacing } from '@taxi/shared';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Renders a spinner and disables — the button IS the loading state. */
  loading?: boolean;
  /** The home toggle is a `switch` with `checked`; everything else a button. */
  accessibilityRole?: 'button' | 'switch';
  accessibilityState?: AccessibilityState;
  /** `lg` is the 56 px toggle; `md` is the 44 px minimum everywhere else. */
  size?: 'md' | 'lg';
  testID?: string;
}

/**
 * The one pressable. ≥44 px, labelled, its state announced, and a visible
 * focus ring (a 2 px `colors.accent` outline) for keyboard/switch access.
 * Border widths are the only literals here — they are not theme tokens
 * (logged in .claude/references/ui-decisions.md).
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityRole = 'button',
  accessibilityState,
  size = 'md',
  testID,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  // RN's Pressable style callback carries `pressed` only; focus is tracked
  // by hand so keyboard/switch access gets the same ring on every platform.
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityState={{
        disabled: isDisabled,
        busy: loading,
        ...accessibilityState,
      }}
      disabled={isDisabled}
      onPress={onPress}
      focusable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.base,
        variants[variant],
        size === 'lg' && styles.lg,
        pressed && styles.pressed,
        focused && styles.focused,
        isDisabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelColors[variant]} />
      ) : (
        <Text style={[styles.label, { color: labelColors[variant] }]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const labelColors: Record<ButtonVariant, string> = {
  primary: colors.accentFg,
  secondary: colors.fg,
  danger: colors.accentFg,
};

const variants = StyleSheet.create({
  primary: { backgroundColor: colors.accent },
  secondary: {
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  danger: { backgroundColor: colors.danger },
});

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lg: { minHeight: 56 },
  label: { fontSize: fontSize.md, fontWeight: '600' },
  pressed: { opacity: 0.85 },
  focused: { borderWidth: 2, borderColor: colors.accent },
  disabled: { opacity: 0.5 },
});
