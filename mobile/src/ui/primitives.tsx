import React, { forwardRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewProps,
  ViewStyle,
} from 'react-native';
import { colors, radius, space } from './theme';

export function Screen({ style, ...p }: ViewProps) {
  return <View style={[s.screen, style]} {...p} />;
}

export function Card({ style, ...p }: ViewProps) {
  return <View style={[s.card, style]} {...p} />;
}

export function Title({ children }: { children: React.ReactNode }) {
  return <Text style={s.title}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: any }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}

export const Input = forwardRef<TextInput, TextInputProps>((p, ref) => {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.muted}
      style={[s.input, p.style]}
      {...p}
    />
  );
});
Input.displayName = 'Input';

export function Button({
  title,
  onPress,
  loading,
  variant = 'primary',
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const bg =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
      ? colors.danger
      : 'transparent';
  const fg = variant === 'ghost' ? colors.accent : '#fff';
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[s.btnText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Row({ style, ...p }: ViewProps) {
  return <View style={[s.row, style]} {...p} />;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: space(2) },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius,
    padding: space(2),
    borderWidth: 1,
    borderColor: colors.line,
  },
  title: { fontSize: 28, fontWeight: '700', color: colors.ink, marginBottom: space(1) },
  muted: { color: colors.muted, fontSize: 14 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius,
    padding: space(1.5),
    fontSize: 16,
    color: colors.ink,
    marginBottom: space(1),
  },
  btn: {
    borderRadius: radius,
    padding: space(1.75),
    alignItems: 'center',
    marginTop: space(1),
  },
  btnText: { fontWeight: '600', fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
});
