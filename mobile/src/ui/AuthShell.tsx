import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Icon } from './Icon';
import { Text } from './Text';
import { color, space } from './tokens';

/** Shared sign-in / sign-up frame: brand mark, title, subtitle, then the form. Safe areas come from the (auth) layout. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    // Both platforms: edge-to-edge Android no longer resizes the window for the keyboard, so without this the
    // password field sat under it.
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <View style={s.mark}><Icon name="tab.home" size={28} tint={color.onAccent} /></View>
        <Text variant="display" style={{ marginTop: space(5) }}>{title}</Text>
        <Text tone="muted" style={{ marginTop: space(2), marginBottom: space(8) }}>{subtitle}</Text>
        <View style={{ gap: space(4) }}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { flexGrow: 1, justifyContent: 'center', padding: space(6) },
  mark: { width: 56, height: 56, borderRadius: 16, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' },
});
