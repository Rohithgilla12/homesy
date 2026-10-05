import type { ReactElement, ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type RefreshControlProps, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { color, space } from './tokens';

type Layout = Pick<ViewStyle, 'gap' | 'justifyContent' | 'alignItems' | 'paddingTop' | 'paddingBottom'>;

/**
 * Page container. Tab screens get their insets from the header and tab bar, so edges default to none;
 * header-less screens (auth, onboarding) pass ['top', 'bottom'].
 */
export function Screen({ children, scroll = false, edges = [], contentStyle, refreshControl }: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  contentStyle?: Layout;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  return (
    <SafeAreaView edges={edges} style={s.root}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[s.content, s.scrollContent, contentStyle]}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[s.root, s.content, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space(4) },
  scrollContent: { paddingTop: space(2), paddingBottom: space(10), gap: space(3) },
});
