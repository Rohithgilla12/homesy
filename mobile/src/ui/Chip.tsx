import { StyleSheet } from 'react-native';
import { haptic } from './haptics';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { color, radius } from './tokens';

export function Chip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: IconName }) {
  const fg = selected ? color.onAccent : color.ink2;
  return (
    <Pressable
      onPress={() => { haptic.selection(); onPress(); }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[s.chip, selected && s.on]}
    >
      {icon ? <Icon name={icon} size={16} tint={fg} /> : null}
      <Text variant="label" color={fg}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 14,
    borderRadius: radius.full, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface,
  },
  on: { backgroundColor: color.ink, borderColor: color.ink },
});
