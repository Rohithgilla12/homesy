import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { api } from '@/api/client';
import type { Activity } from '@/api/types';
import { activitySentence, groupByDay, isFreshFromOthers } from '@/lib/activity';
import { relativeTime } from '@/lib/format';
import { useActiveHome } from '@/store/home';
import { useSession } from '@/store/session';
import { Card, EmptyState, Icon, type IconName, LiveRow, Screen, Text, color, radius, space, status, useManualRefresh } from '@/ui';

function iconFor(a: Activity): { name: IconName; bg: string; fg: string } {
  switch (a.resource_type) {
    case 'bill':
      return a.action === 'paid' ? { name: 'paid', bg: status.okSoft, fg: status.ok } : { name: 'bill.electricity', bg: status.warnSoft, fg: status.warn };
    case 'notice':
      return { name: 'pin', bg: status.dangerSoft, fg: status.danger };
    case 'vault':
      return { name: 'tab.vault', bg: color.surfaceSunk, fg: color.ink2 };
    case 'member':
      return { name: 'members', bg: color.surfaceSunk, fg: color.ink2 };
    default:
      return a.action === 'completed'
        ? { name: 'check', bg: color.accentSoft, fg: color.accent }
        : { name: 'list.grocery', bg: color.accentSoft, fg: color.accent };
  }
}

function LiveBadge() {
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (!reduce) o.value = withRepeat(withTiming(0.35, { duration: 1000 }), -1, true);
  }, [reduce]);
  const dot = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <View style={s.live} accessible accessibilityLabel="Live updates on">
      <Animated.View style={[s.dot, dot]} />
      <Text variant="label" tone="ok">Live</Text>
    </View>
  );
}

export default function ActivityScreen() {
  const homeId = useActiveHome((s) => s.activeHomeId);
  const me = useSession((s) => s.user);

  const { data: home } = useQuery({ queryKey: ['home', homeId], queryFn: () => api.home(homeId!), enabled: !!homeId });
  const { data: activities = [], refetch, isSuccess } = useQuery({
    queryKey: ['activity', homeId],
    queryFn: () => api.activity(homeId!, 50),
    enabled: !!homeId,
  });

  const { refreshing, onRefresh } = useManualRefresh(refetch);

  // Rows present on first load never highlight; only later arrivals from other members do.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (isSuccess) {
    if (!seen.current) seen.current = new Set(activities.map((a) => a.id));
    for (const a of activities) if (!seen.current.has(a.id) && isFreshFromOthers(a.actor_id, me?.id)) fresh.add(a.id);
  }
  useEffect(() => { if (seen.current) activities.forEach((a) => seen.current!.add(a.id)); }, [activities]);

  const nameOf = (id: string) => home?.members.find((m) => m.user_id === id)?.display_name ?? 'Household member';
  const now = new Date();
  const sections = groupByDay(activities, now).map((g) => ({ title: g.title, data: [g.rows] }));

  return (
    <Screen>
      <SectionList
        sections={sections}
        keyExtractor={(rows) => rows[0].id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accent} />}
        contentContainerStyle={{ paddingTop: space(2), paddingBottom: space(8) }}
        ListHeaderComponent={
          <View style={s.header}>
            <Text variant="display" style={{ flex: 1 }}>Activity</Text>
            <LiveBadge />
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="tab.activity" title="No activity yet" body="Actions like adding list items, posting notes, or paying bills will appear here." />
        }
        renderSectionHeader={({ section }) => (
          <Text variant="caption" tone="muted" style={{ marginLeft: space(1), marginTop: space(4), marginBottom: space(2) }}>{section.title}</Text>
        )}
        renderItem={({ item: rows }) => (
          <Card padded={false}>
            {rows.map((a, i) => {
              const ic = iconFor(a);
              const { actor, text } = activitySentence(nameOf(a.actor_id), a.description);
              return (
                <LiveRow key={a.id} fresh={fresh.has(a.id)}>
                  <View style={[s.row, i === rows.length - 1 && s.rowLast]}>
                    <View style={[s.iconDot, { backgroundColor: ic.bg }]}><Icon name={ic.name} size={17} tint={ic.fg} /></View>
                    <Text style={{ flex: 1 }}>
                      <Text variant="headline" style={{ fontSize: 15, lineHeight: 22 }}>{actor}</Text> {text}
                    </Text>
                    <Text variant="label" tone="muted" style={{ fontSize: 12.5, fontVariant: ['tabular-nums'] }}>{relativeTime(a.created_at, now)}</Text>
                  </View>
                </LiveRow>
              );
            })}
          </Card>
        )}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 3, paddingHorizontal: 10, borderRadius: radius.full, backgroundColor: status.okSoft },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: status.ok },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3), paddingHorizontal: space(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  rowLast: { borderBottomWidth: 0 },
  iconDot: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});
