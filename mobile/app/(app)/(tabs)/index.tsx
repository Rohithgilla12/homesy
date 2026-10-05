import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { api } from '@/api/client';
import type { ListKind } from '@/api/types';
import { friendlyError } from '@/lib/errors';
import { useActiveHome } from '@/store/home';
import {
  Button, Card, Chip, EmptyState, Icon, Input, Pill, Screen, Sheet, Text, category, color, radius, space, useRoofRefresh,
} from '@/ui';

const KINDS: { kind: ListKind; label: string; caption: string; placeholder: string }[] = [
  { kind: 'grocery', label: 'Groceries', caption: 'Grocery list', placeholder: 'e.g. Weekly Groceries' },
  { kind: 'laundry', label: 'Laundry', caption: 'Laundry list', placeholder: 'e.g. Dry Cleaning' },
  { kind: 'todo', label: 'To-do', caption: 'To-do list', placeholder: 'e.g. Weekend Chores' },
  { kind: 'custom', label: 'Custom', caption: 'Custom list', placeholder: 'e.g. Diwali Shopping' },
];
const kindInfo = (k: ListKind) => KINDS.find((x) => x.kind === k) ?? KINDS[3];

export default function ListsScreen() {
  const homeId = useActiveHome((s) => s.activeHomeId);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ListKind>('custom');
  const [name, setName] = useState('');

  const { data: lists = [], refetch, isRefetching } = useQuery({ queryKey: ['lists', homeId], queryFn: () => api.lists(homeId!), enabled: !!homeId });
  const { onScroll, refreshControl, indicator } = useRoofRefresh({ refreshing: isRefetching, onRefresh: refetch });

  const create = useMutation({
    mutationFn: () => api.createList(homeId!, { kind, name: name.trim() }),
    onSuccess: () => {
      setName(''); setKind('custom'); setOpen(false);
      qc.invalidateQueries({ queryKey: ['lists', homeId] });
    },
    onError: (e) => Alert.alert('Could not create list', friendlyError(e, 'generic')),
  });

  const totalOpen = lists.reduce((n, l) => n + l.open_count, 0);
  const openSheet = (k: ListKind = 'custom') => { setKind(k); setName(''); setOpen(true); };

  return (
    <Screen>
      {indicator}
      <Animated.FlatList
        data={lists}
        keyExtractor={(l) => l.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={refreshControl}
        contentContainerStyle={{ gap: space(2.5), paddingTop: space(2), paddingBottom: space(8) }}
        ListHeaderComponent={
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text variant="display">Lists</Text>
              <Text tone="muted">{lists.length} {lists.length === 1 ? 'list' : 'lists'} · {totalOpen} open {totalOpen === 1 ? 'item' : 'items'}</Text>
            </View>
            <Button title="New list" icon="add" size="sm" variant="secondary" onPress={() => openSheet()} />
          </View>
        }
        ListEmptyComponent={
          <EmptyState icon="list.custom" title="No lists in this home yet" body="Create a grocery, laundry, or to-do list to get started." actionLabel="Create a list" onAction={() => openSheet()} />
        }
        renderItem={({ item }) => {
          const tint = category.list[item.kind] ?? category.list.custom;
          return (
            <Card
              onPress={() => router.push({ pathname: '/lists/[id]', params: { id: item.id, name: item.name } })}
              accessibilityLabel={`${item.name}, ${item.open_count} open`}
              style={s.row}
            >
              <View style={[s.tile, { backgroundColor: tint.bg }]}><Icon name={`list.${item.kind}`} tint={tint.fg} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="headline" numberOfLines={1}>{item.name}</Text>
                <Text variant="label" tone="muted">{kindInfo(item.kind).caption}</Text>
              </View>
              <Pill label={item.open_count > 0 ? `${item.open_count} open` : 'All done'} tone={item.open_count > 0 ? 'accent' : 'neutral'} />
              <Icon name="chevronRight" size={18} tint={color.muted} />
            </Card>
          );
        }}
      />

      <Sheet visible={open} onClose={() => setOpen(false)} title="New list">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          {KINDS.map((k) => <Chip key={k.kind} label={k.label} icon={`list.${k.kind}`} selected={kind === k.kind} onPress={() => setKind(k.kind)} />)}
        </View>
        <Input label="Name" placeholder={kindInfo(kind).placeholder} value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={() => name.trim() && create.mutate()} />
        <Button title="Create list" fullWidth loading={create.isPending} onPress={() => { if (name.trim()) create.mutate(); }} />
      </Sheet>
    </Screen>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space(3), marginBottom: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: 14 },
  tile: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
