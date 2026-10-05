import { ActivityIndicator, StyleSheet, View, type ViewStyle } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { color, radius, space, status } from './tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const look: Record<Variant, { bg: string; fg: string; border?: string; tone: 'onAccent' | 'ink' | 'accentInk' | 'danger' }> = {
  primary: { bg: color.accent, fg: color.onAccent, tone: 'onAccent' },
  secondary: { bg: color.surface, fg: color.ink, border: color.line, tone: 'ink' },
  ghost: { bg: 'transparent', fg: color.accentInk, tone: 'accentInk' },
  danger: { bg: status.dangerSoft, fg: status.danger, tone: 'danger' },
};

export function Button({
  title, onPress, variant = 'primary', size = 'md', icon, loading = false, disabled = false, fullWidth = false, style,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: Pick<ViewStyle, 'flex' | 'alignSelf' | 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight'>;
}) {
  const l = look[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        s.base,
        size === 'sm' ? s.sm : s.md,
        { backgroundColor: l.bg, borderColor: l.border ?? 'transparent', opacity: disabled ? 0.5 : 1 },
        fullWidth && s.full,
        style,
      ]}
    >
      <View style={[s.row, loading && s.hidden]}>
        {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} tint={l.fg} /> : null}
        <Text variant={size === 'sm' ? 'label' : 'headline'} tone={l.tone}>{title}</Text>
      </View>
      {loading ? <ActivityIndicator color={l.fg} style={StyleSheet.absoluteFill} /> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: { borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  md: { paddingVertical: space(3), paddingHorizontal: space(4), borderRadius: radius.md, minHeight: 48 },
  sm: { paddingVertical: space(2), paddingHorizontal: 14, borderRadius: radius.full, minHeight: 36 },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  hidden: { opacity: 0 },
});
