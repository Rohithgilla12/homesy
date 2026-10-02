import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '@/api/client';
import { LIST_KIND_ICON, type ListKind } from '@/api/types';
import { useActiveHome } from '@/store/home';
import { Button, Card, Input, Muted, Row, Screen, Title } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

const LIST_KINDS: { kind: ListKind; label: string; icon: string }[] = [
  { kind: 'grocery', label: 'Groceries', icon: '🛒' },
  { kind: 'laundry', label: 'Laundry', icon: '🧺' },
  { kind: 'todo', label: 'To-do', icon: '✅' },
  { kind: 'custom', label: 'Custom', icon: '📝' },
];

export default function ListsScreen() {
  const homeId = useActiveHome((s) => s.activeHomeId);
  const qc = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedKind, setSelectedKind] = useState<ListKind>('custom');
  const [listName, setListName] = useState('');

  const { data: lists = [], refetch, isRefetching } = useQuery({
    queryKey: ['lists', homeId],
    queryFn: () => api.lists(homeId!),
    enabled: !!homeId,
  });

  const create = useMutation({
    mutationFn: () =>
      api.createList(homeId!, {
        kind: selectedKind,
        name: listName.trim(),
      }),
    onSuccess: () => {
      setListName('');
      setSelectedKind('custom');
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['lists', homeId] });
    },
    onError: (e: Error) => Alert.alert('Could not create list', e.message),
  });

  const handleOpenCreateModal = (kind: ListKind = 'custom') => {
    setSelectedKind(kind);
    setListName('');
    setModalOpen(true);
  };

  return (
    <Screen>
      <FlatList
        data={lists}
        keyExtractor={(l) => l.id}
        refreshing={isRefetching}
        onRefresh={refetch}
        contentContainerStyle={{ gap: space(1.25), paddingBottom: space(4) }}
        ListHeaderComponent={
          <Row style={{ justifyContent: 'space-between', marginBottom: space(1) }}>
            <View>
              <Title>Lists</Title>
              <Muted>Shared household checklists and tasks</Muted>
            </View>
            <Pressable
              onPress={() => handleOpenCreateModal('custom')}
              style={s.addBtn}
            >
              <Text style={s.addBtnText}>+ New list</Text>
            </Pressable>
          </Row>
        }
        renderItem={({ item }) => (
          <Link
            href={{ pathname: '/lists/[id]', params: { id: item.id, name: item.name } }}
            asChild
          >
            <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}>
              <Card style={s.listCard}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row style={{ gap: space(1.5), flex: 1 }}>
                    <Text style={s.icon}>{LIST_KIND_ICON[item.kind] ?? '📝'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.name} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Muted style={s.kindLabel}>
                        {item.kind.toUpperCase()}
                      </Muted>
                    </View>
                  </Row>
                  <View style={[s.badge, item.open_count > 0 && s.badgeActive]}>
                    <Text style={[s.count, item.open_count > 0 && s.countActive]}>
                      {item.open_count} open
                    </Text>
                  </View>
                </Row>
              </Card>
            </Pressable>
          </Link>
        )}
        ListEmptyComponent={
          <Card style={{ alignItems: 'center', paddingVertical: space(3) }}>
            <Text style={{ fontSize: 32, marginBottom: space(1) }}>📋</Text>
            <Text style={s.emptyTitle}>No lists in this home yet</Text>
            <Muted>Create a grocery, laundry, or to-do list to get started.</Muted>
            <Button
              title="Create a list"
              onPress={() => handleOpenCreateModal('custom')}
              style={{ marginTop: space(2) }}
            />
          </Card>
        }
      />

      {/* Create List Modal */}
      <Modal
        visible={modalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setModalOpen(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setModalOpen(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>Create new list</Text>
            <Muted>Select list category and give it a title.</Muted>

            <View style={{ marginVertical: space(1) }}>
              <Muted>Type</Muted>
              <Row style={{ flexWrap: 'wrap', gap: space(1), marginTop: space(0.5) }}>
                {LIST_KINDS.map((k) => (
                  <Pressable
                    key={k.kind}
                    onPress={() => setSelectedKind(k.kind)}
                    style={[s.kindChip, selectedKind === k.kind && s.kindChipActive]}
                  >
                    <Text style={s.kindChipText}>
                      {k.icon} {k.label}
                    </Text>
                  </Pressable>
                ))}
              </Row>
            </View>

            <Input
              placeholder={
                selectedKind === 'grocery'
                  ? 'e.g. Weekly Groceries'
                  : selectedKind === 'laundry'
                  ? 'e.g. Dry Cleaning'
                  : selectedKind === 'todo'
                  ? 'e.g. Weekend Chores'
                  : 'e.g. Diwali Shopping'
              }
              value={listName}
              onChangeText={setListName}
              autoFocus
            />

            <Button
              title="Create list"
              onPress={() => listName.trim() && create.mutate()}
              loading={create.isPending}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setModalOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  listCard: {
    paddingVertical: space(1.75),
    paddingHorizontal: space(2),
  },
  icon: {
    fontSize: 26,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.ink,
  },
  kindLabel: {
    fontSize: 11,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  badge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: space(1.25),
    paddingVertical: space(0.5),
    borderRadius: 999,
  },
  badgeActive: {
    backgroundColor: colors.accentSoft,
  },
  count: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  countActive: {
    color: colors.accent,
  },
  addBtn: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: space(1.5),
    paddingVertical: space(0.75),
    borderRadius: radius,
  },
  addBtnText: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: space(0.5),
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    padding: space(2.5),
    borderTopLeftRadius: radius * 1.5,
    borderTopRightRadius: radius * 1.5,
    gap: space(1),
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
  },
  kindChip: {
    paddingHorizontal: space(1.5),
    paddingVertical: space(0.75),
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  kindChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  kindChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
});
