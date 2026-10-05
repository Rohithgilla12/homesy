import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Pressable } from './Pressable';
import { color, radius, space } from './tokens';

type Layout = Pick<ViewStyle, 'flex' | 'gap' | 'flexDirection' | 'alignItems' | 'justifyContent' | 'marginTop' | 'marginBottom' | 'padding' | 'paddingVertical' | 'paddingHorizontal' | 'backgroundColor' | 'borderColor' | 'overflow'>;

export function Card({ children, onPress, padded = true, style, accessibilityLabel }: {
  children: ReactNode;
  onPress?: () => void;
  padded?: boolean;
  style?: Layout;
  accessibilityLabel?: string;
}) {
  const body = [s.card, padded && s.padded, style];
  if (onPress) {
    return <Pressable onPress={onPress} accessibilityLabel={accessibilityLabel} style={body}>{children}</Pressable>;
  }
  return <View style={body}>{children}</View>;
}

const s = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.lg,
    shadowColor: color.ink,
    shadowOpacity: 0.04,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  padded: { padding: space(4) },
});
