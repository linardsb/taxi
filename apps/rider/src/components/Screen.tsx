import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@taxi/shared';

/**
 * Every screen's frame: safe area, the theme's background, one padding.
 * `scroll` (default) keeps a form reachable above the keyboard; `/book` and
 * `/book/address` turn it off because each owns its own scrolling region and
 * has to keep the Book button, or the results list, where the thumb expects it.
 */
export function Screen({
  children,
  scroll = true,
}: {
  children: ReactNode;
  scroll?: boolean;
}) {
  const body = <View style={styles.body}>{children}</View>;
  return (
    <SafeAreaView style={styles.safe}>
      {scroll ? (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1 },
  body: { flex: 1, padding: spacing.md, gap: spacing.md },
});
