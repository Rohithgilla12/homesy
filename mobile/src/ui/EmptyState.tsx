import { View } from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { color, radius, space } from './tokens';

export function EmptyState({ icon, title, body, actionLabel, onAction }: {
  icon: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card style={{ alignItems: 'center', gap: space(2), paddingVertical: space(8) }}>
      <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: color.surfaceSunk, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={24} tint={color.ink2} />
      </View>
      <Text variant="headline" style={{ textAlign: 'center', marginTop: space(1) }}>{title}</Text>
      <Text tone="muted" style={{ textAlign: 'center' }}>{body}</Text>
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} style={{ marginTop: space(3) }} /> : null}
    </Card>
  );
}
