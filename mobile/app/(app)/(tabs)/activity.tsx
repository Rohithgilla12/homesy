import { useQuery } from '@tanstack/react-query';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { api } from '@/api/client';
import type { Activity } from '@/api/types';
import { useActiveHome } from '@/store/home';
import { Card, Muted, Row, Screen } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

export default function ActivityScreen() {
  const homeId = useActiveHome((s) => s.activeHomeId);

  const { data: homeDetail } = useQuery({
    queryKey: ['home', homeId],
    queryFn: () => api.home(homeId!),
    enabled: !!homeId,
  });

  const {
    data: activities = [],
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['activity', homeId],
    queryFn: () => api.activity(homeId!, 50),
    enabled: !!homeId,
  });

  const members = homeDetail?.members ?? [];

  const getActorName = (actorId: string) => {
    const m = members.find((mem) => mem.user_id === actorId);
    return m?.display_name ?? 'Household member';
  };

  const getActionIcon = (action: string, resourceType: string) => {
    if (resourceType === 'notice') return '📌';
    if (resourceType === 'bill') return '⚡';
    if (resourceType === 'expense') return '💳';
    if (resourceType === 'vault') return '🔐';
    if (resourceType === 'member') return '👥';
    if (action === 'completed') return '✅';
    if (action === 'cleared_completed') return '🧹';
    if (action === 'created' && resourceType === 'list') return '📝';
    if (action === 'deleted') return '🗑️';
    return '🛒';
  };

  const formatRelativeTime = (isoString: string) => {
    const diff = Date.now() - new Date(isoString).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(isoString).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <Screen>
      <View style={{ marginBottom: space(1.5) }}>
        <Text style={s.pageTitle}>Household Activity</Text>
        <Muted>Real-time timeline of what's happening in this home.</Muted>
      </View>

      <FlatList
        data={activities}
        keyExtractor={(item) => item.id}
        refreshing={isRefetching}
        onRefresh={refetch}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: space(1), paddingBottom: space(4) }}
        ListEmptyComponent={
          <Card style={{ alignItems: 'center', paddingVertical: space(3) }}>
            <Text style={{ fontSize: 32, marginBottom: space(1) }}>⚡</Text>
            <Text style={s.emptyTitle}>No activity yet</Text>
            <Muted>Actions like adding list items, posting notes, or logging expenses will appear here.</Muted>
          </Card>
        }
        renderItem={({ item }) => {
          const actorName = getActorName(item.actor_id);
          const icon = getActionIcon(item.action, item.resource_type);
          const time = formatRelativeTime(item.created_at);

          return (
            <Card style={s.activityCard}>
              <Row style={{ gap: space(1.25), alignItems: 'center' }}>
                <View style={s.iconCircle}>
                  <Text style={s.iconText}>{icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.description}>
                    <Text style={s.actorName}>{actorName} </Text>
                    {item.description}
                  </Text>
                  <Muted style={s.timeText}>{time}</Muted>
                </View>
              </Row>
            </Card>
          );
        }}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  pageTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.ink,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: space(0.5),
  },
  activityCard: {
    padding: space(1.5),
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 20,
  },
  description: {
    fontSize: 15,
    color: colors.ink,
    lineHeight: 20,
  },
  actorName: {
    fontWeight: '700',
    color: colors.ink,
  },
  timeText: {
    fontSize: 12,
    marginTop: space(0.25),
  },
});
