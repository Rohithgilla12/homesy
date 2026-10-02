import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { api } from '@/api/client';
import type { ListItem } from '@/api/types';
import { useActiveHome } from '@/store/home';
import { Button, Card, Input, Muted, Row, Screen } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

export default function ListDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const homeId = useActiveHome((s) => s.activeHomeId);
  const qc = useQueryClient();

  // Add Item form state
  const [title, setTitle] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [showExtra, setShowExtra] = useState(false);

  // Edit Item modal state
  const [editingItem, setEditingItem] = useState<ListItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editDone, setEditDone] = useState(false);

  const key = ['items', id];
  const { data: items = [], refetch, isRefetching } = useQuery({
    queryKey: key,
    queryFn: () => api.items(id),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['lists', homeId] });
  };

  const addMutation = useMutation({
    mutationFn: () =>
      api.createItem(id, {
        title: title.trim(),
        qty: qty.trim() || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      setTitle('');
      setQty('');
      setNote('');
      setShowExtra(false);
      invalidate();
    },
    onError: (e: Error) => Alert.alert('Could not add item', e.message),
  });

  // Optimistic toggle: flip locally, reconcile on settle
  const toggleMutation = useMutation({
    mutationFn: (it: ListItem) => api.updateItem(it.id, { done: !it.done }),
    onMutate: async (it) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ListItem[]>(key);
      qc.setQueryData<ListItem[]>(key, (old = []) =>
        old.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x))
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: invalidate,
  });

  const editMutation = useMutation({
    mutationFn: () =>
      api.updateItem(editingItem!.id, {
        title: editTitle.trim(),
        qty: editQty.trim(),
        note: editNote.trim(),
        done: editDone,
      }),
    onSuccess: () => {
      setEditingItem(null);
      invalidate();
    },
    onError: (e: Error) => Alert.alert('Could not update item', e.message),
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => api.deleteItem(itemId),
    onSuccess: () => {
      setEditingItem(null);
      invalidate();
    },
    onError: (e: Error) => Alert.alert('Could not delete item', e.message),
  });

  const clearCompletedMutation = useMutation({
    mutationFn: () => api.clearCompleted(id),
    onSuccess: (data) => {
      invalidate();
      Alert.alert('Cleared', `Removed ${data.deleted} completed item(s).`);
    },
    onError: (e: Error) => Alert.alert('Could not clear completed', e.message),
  });

  const openEditModal = (item: ListItem) => {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditQty(item.qty ?? '');
    setEditNote(item.note ?? '');
    setEditDone(item.done);
  };

  const activeItems = items.filter((i) => !i.done);
  const completedItems = items.filter((i) => i.done);

  const confirmClearCompleted = () => {
    if (completedItems.length === 0) return;
    Alert.alert(
      'Clear completed items?',
      `Are you sure you want to remove all ${completedItems.length} completed item(s)?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear completed',
          style: 'destructive',
          onPress: () => clearCompletedMutation.mutate(),
        },
      ]
    );
  };

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: name ?? 'List',
          headerTitle: name ?? 'List',
          headerRight: () =>
            completedItems.length > 0 ? (
              <Pressable
                onPress={confirmClearCompleted}
                style={{ paddingHorizontal: space(1), paddingVertical: space(0.5) }}
              >
                <Text style={{ color: colors.accent, fontWeight: '600', fontSize: 14 }}>
                  Clear ({completedItems.length})
                </Text>
              </Pressable>
            ) : null,
        }}
      />

      {/* Add Item Box */}
      <Card style={{ marginBottom: space(1.5) }}>
        <Row style={{ gap: space(1) }}>
          <Input
            placeholder="Add an item..."
            value={title}
            onChangeText={setTitle}
            style={{ flex: 1, marginBottom: 0 }}
            onSubmitEditing={() => title.trim() && addMutation.mutate()}
            returnKeyType="done"
          />
          <Pressable
            onPress={() => setShowExtra(!showExtra)}
            style={[s.extraToggle, showExtra && s.extraToggleActive]}
          >
            <Text style={[s.extraToggleText, showExtra && s.extraToggleTextActive]}>
              {showExtra ? 'Less' : '+ Note/Qty'}
            </Text>
          </Pressable>
        </Row>

        {showExtra && (
          <View style={{ marginTop: space(1), gap: space(0.75) }}>
            <Row style={{ gap: space(1) }}>
              <Input
                placeholder="Qty / units (e.g. 2 pcs, 1 kg)"
                value={qty}
                onChangeText={setQty}
                style={{ flex: 1, marginBottom: 0 }}
              />
            </Row>
            <Input
              placeholder="Note (e.g. brand, specific store, instructions)"
              value={note}
              onChangeText={setNote}
              style={{ marginBottom: 0 }}
            />
          </View>
        )}

        <Button
          title="Add item"
          onPress={() => title.trim() && addMutation.mutate()}
          loading={addMutation.isPending}
          style={{ marginTop: space(1) }}
        />
      </Card>

      {/* Items List */}
      <FlatList
        data={[...activeItems, ...completedItems]}
        keyExtractor={(i) => i.id}
        refreshing={isRefetching}
        onRefresh={refetch}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: space(1), paddingBottom: space(4) }}
        ListEmptyComponent={
          <Card style={{ alignItems: 'center', paddingVertical: space(3) }}>
            <Text style={{ fontSize: 32, marginBottom: space(1) }}>🛒</Text>
            <Text style={s.emptyTitle}>No items in this list</Text>
            <Muted>Add your first item using the box above.</Muted>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => toggleMutation.mutate(item)}
            onLongPress={() =>
              Alert.alert(item.title, 'What would you like to do?', [
                { text: 'Edit', onPress: () => openEditModal(item) },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: () => removeMutation.mutate(item.id),
                },
                { text: 'Cancel', style: 'cancel' },
              ])
            }
            style={[s.itemCard, item.done && s.itemDone]}
          >
            {/* Checkbox */}
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                toggleMutation.mutate(item);
              }}
              style={s.checkTouch}
            >
              <Text style={[s.check, item.done && s.checkDone]}>
                {item.done ? '☑' : '☐'}
              </Text>
            </Pressable>

            {/* Content */}
            <View style={{ flex: 1 }}>
              <Row style={{ flexWrap: 'wrap', gap: space(0.5) }}>
                <Text style={[s.itemTitle, item.done && s.itemTitleDone]}>
                  {item.title}
                </Text>
                {item.qty ? <Text style={s.qtyBadge}>{item.qty}</Text> : null}
              </Row>
              {item.note ? <Text style={s.itemNote}>{item.note}</Text> : null}
            </View>

            {/* Edit button */}
            <Pressable
              onPress={(e) => {
                e.stopPropagation();
                openEditModal(item);
              }}
              style={s.editAction}
            >
              <Text style={s.editActionText}>✎</Text>
            </Pressable>
          </Pressable>
        )}
      />

      {/* Edit Item Modal */}
      <Modal
        visible={!!editingItem}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingItem(null)}
      >
        <Pressable style={s.backdrop} onPress={() => setEditingItem(null)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>Edit Item</Text>

            <Muted>Title</Muted>
            <Input
              placeholder="Title"
              value={editTitle}
              onChangeText={setEditTitle}
            />

            <Muted>Quantity (optional)</Muted>
            <Input
              placeholder="e.g. 2 cartons, 500g"
              value={editQty}
              onChangeText={setEditQty}
            />

            <Muted>Note (optional)</Muted>
            <Input
              placeholder="e.g. brand, store details"
              value={editNote}
              onChangeText={setEditNote}
              multiline
            />

            <Row style={{ justifyContent: 'space-between', paddingVertical: space(0.5) }}>
              <Muted>Completed</Muted>
              <Switch
                value={editDone}
                onValueChange={setEditDone}
                trackColor={{ true: colors.accent }}
              />
            </Row>

            <Button
              title="Save changes"
              onPress={() => editTitle.trim() && editMutation.mutate()}
              loading={editMutation.isPending}
            />

            <Button
              title="Delete item"
              variant="danger"
              onPress={() =>
                Alert.alert('Delete item?', `Delete "${editingItem?.title}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => removeMutation.mutate(editingItem!.id),
                  },
                ])
              }
              loading={removeMutation.isPending}
            />

            <Button title="Cancel" variant="ghost" onPress={() => setEditingItem(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  extraToggle: {
    paddingHorizontal: space(1.25),
    paddingVertical: space(1.5),
    backgroundColor: colors.card,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
    alignItems: 'center',
  },
  extraToggleActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  extraToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  extraToggleTextActive: {
    color: colors.accent,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1.25),
    backgroundColor: colors.card,
    padding: space(1.5),
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.line,
  },
  itemDone: {
    opacity: 0.6,
    backgroundColor: '#F9F8F6',
  },
  checkTouch: {
    padding: space(0.25),
  },
  check: {
    fontSize: 22,
    color: colors.muted,
  },
  checkDone: {
    color: colors.accent,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  itemTitleDone: {
    textDecorationLine: 'line-through',
    color: colors.muted,
  },
  itemNote: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  qtyBadge: {
    backgroundColor: colors.accentSoft,
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: space(0.75),
    paddingVertical: space(0.25),
    borderRadius: 999,
  },
  editAction: {
    padding: space(1),
  },
  editActionText: {
    fontSize: 18,
    color: colors.muted,
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
    marginBottom: space(0.5),
  },
});
