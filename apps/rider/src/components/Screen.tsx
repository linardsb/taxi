import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@taxi/shared';

/**
 * Every screen's frame: safe area, the theme's background, one padding.
 * `scroll` (default) keeps a form reachable above the keyboard; the home
 * screen turns it off so the toggle stays where the thumb expects it.
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
