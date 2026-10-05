import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { color, radius, status } from './tokens';

export type PillTone = 'accent' | 'neutral' | 'warn' | 'ok' | 'danger';

const tones: Record<PillTone, { bg: string; fg: string }> = {
  accent: { bg: color.accentSoft, fg: color.accentInk },
  neutral: { bg: color.surfaceSunk, fg: color.ink2 },
  warn: { bg: status.warnSoft, fg: status.warn },
  ok: { bg: status.okSoft, fg: status.okInk },
  danger: { bg: status.dangerSoft, fg: status.danger },
};

/** `solid` inverts the pill (filled tone colour, white text), e.g. the "Urgent" tag. */
export function Pill({ label, tone = 'accent', icon, solid = false }: { label: string; tone?: PillTone; icon?: IconName; solid?: boolean }) {
  const t = tones[tone];
  const fg = solid ? color.onAccent : t.fg;
  return (
    <View style={[s.pill, { backgroundColor: solid ? t.fg : t.bg }]}>
      {icon ? <Icon name={icon} size={14} tint={fg} /> : null}
      <Text variant="label" color={fg} style={{ fontVariant: ['tabular-nums'] }}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 10, borderRadius: radius.full, alignSelf: 'flex-start' },
});
