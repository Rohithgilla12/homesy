import type { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { color, radius, space } from './tokens';

// Derived from Tabs itself so we only depend on expo-router's public API.
type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Lists', icon: 'tab.lists' },
  bills: { label: 'Bills', icon: 'tab.bills' },
  vault: { label: 'Vault', icon: 'tab.vault' },
  activity: { label: 'Activity', icon: 'tab.activity' },
  home: { label: 'Home', icon: 'tab.home' },
};

/** Custom tab bar: soft pill behind the active icon, readable labels, no switch animation (seen too often). */
export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, space(2)) }]} accessibilityRole="tablist">
      {state.routes.map((route, i) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const selected = state.index === i;
        const tint = selected ? color.accentInk : color.muted;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.label}
            onPress={() => {
              const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!selected && !e.defaultPrevented) navigation.navigate(route.name);
            }}
            style={s.tab}
          >
            <View style={[s.pill, selected && s.pillOn]}>
              <Icon name={tab.icon} size={22} tint={tint} />
            </View>
            <Text variant="label" color={tint} style={{ textAlign: 'center' }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: color.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, paddingTop: 6, paddingHorizontal: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  pill: { width: 52, height: 30, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: color.accentSoft },
});
