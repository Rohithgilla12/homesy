import { Image, View } from 'react-native';
import { avatarTint } from '@/lib/color';
import { Text } from './Text';

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

export function Avatar({ userId, name, size = 36, uri }: { userId: string; name: string; size?: number; uri?: string | null }) {
  const t = avatarTint(userId);
  if (uri) {
    return <Image source={{ uri }} accessible accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg }} />;
  }
  return (
    <View
      accessible
      accessibilityLabel={name}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text variant="label" color={t.fg} style={{ textAlign: 'center' }}>
        {initials(name)}
      </Text>
    </View>
  );
}
