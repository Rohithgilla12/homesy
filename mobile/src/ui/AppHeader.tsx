import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import { useActiveHome } from '@/store/home';
import { useSession } from '@/store/session';
import { Avatar } from './Avatar';
import { HomeSwitcherSheet } from './HomeSwitcherSheet';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { color, radius, space } from './tokens';

/** Tabs header: active-home switcher pill on the left, the signed-in user's avatar on the right. */
export function AppHeader() {
  const insets = useSafeAreaInsets();
  const { data: homes = [] } = useQuery({ queryKey: ['homes'], queryFn: api.homes });
  const { activeHomeId, setActiveHome } = useActiveHome();
  const user = useSession((s) => s.user);
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me, enabled: !!user });
  const [open, setOpen] = useState(false);
  const active = homes.find((h) => h.id === activeHomeId) ?? homes[0];

  // A left or deleted home can't stay active; fall back to the first one (carried over from HomeSwitcher).
  useEffect(() => {
    if (homes.length && !homes.some((h) => h.id === activeHomeId)) setActiveHome(homes[0].id);
  }, [homes, activeHomeId, setActiveHome]);

  return (
    <View style={[s.bar, { paddingTop: insets.top }]}>
      {active ? (
        <Pressable onPress={() => setOpen(true)} accessibilityLabel={`Current home: ${active.name}. Switch home`} style={s.pill}>
          <View style={s.emoji}><Text variant="label">{active.emoji}</Text></View>
          <Text variant="headline" style={{ flexShrink: 1 }} numberOfLines={1}>{active.name}</Text>
          <Icon name="chevronDown" size={16} tint={color.muted} />
        </Pressable>
      ) : <View />}
      {user ? <Avatar userId={user.id} name={user.display_name} uri={me?.avatar?.url} /> : null}
      <HomeSwitcherSheet visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  bar: { backgroundColor: color.bg, paddingHorizontal: space(4), paddingBottom: space(2), minHeight: 56, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space(2), maxWidth: '75%', backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: radius.full, paddingVertical: 5, paddingLeft: 5, paddingRight: space(3) },
  emoji: { width: 28, height: 28, borderRadius: 14, backgroundColor: color.accentSoft, alignItems: 'center', justifyContent: 'center' },
});
