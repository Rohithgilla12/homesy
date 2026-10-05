import { StyleSheet } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { color, radius } from './tokens';

export function IconButton({
  icon, label, onPress, variant = 'plain', tint, size = 18,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  variant?: 'plain' | 'outlined' | 'filled';
  tint?: string;
  size?: number;
}) {
  const fg = tint ?? (variant === 'filled' ? color.onAccent : color.ink2);
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={[s.base, variant === 'outlined' && s.outlined, variant === 'filled' && s.filled]}
    >
      <Icon name={icon} size={size} tint={fg} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  outlined: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  filled: { backgroundColor: color.accent },
});
