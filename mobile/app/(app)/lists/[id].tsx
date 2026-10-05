import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, RefreshControl, StyleSheet, Switch, TextInput, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn, FadeOut, LinearTransition, useReducedMotion, useAnimatedReaction, useAnimatedStyle, useSharedValue, withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { api } from '@/api/client';
import type { ListItem } from '@/api/types';
import { isFreshFromOthers } from '@/lib/activity';
import { friendlyError } from '@/lib/errors';
import { useActiveHome } from '@/store/home';
import { useSession } from '@/store/session';
import {
  AnimatedCheck, Button, Card, Chip, EmptyState, Icon, IconButton, Input, LiveRow, Pill, Screen, Sheet, StrikeText, Text,
  color, haptic, motion, radius, space, status, type as typo,
  useManualRefresh,
} from '@/ui';

const TICK_MS = 340; // let the check draw and the strike sweep before the row moves to Done
const SWIPE_COMMIT = 0.35;

export default function ListDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const homeId = useActiveHome((s) => s.activeHomeId);
  const me = useSession((s) => s.user);
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [showQty, setShowQty] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [ticking, setTicking] = useState<Set<string>>(new Set());

  const [editing, setEditing] = useState<ListItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editDone, setEditDone] = useState(false);

  const key = ['items', id];
  const { data: items = [], refetch, isSuccess } = useQuery({ queryKey: key, queryFn: () => api.items(id) });
  const { refreshing, onRefresh } = useManualRefresh(refetch);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['lists', homeId] });
  };

  // Ids present on first load or added by me never get the live highlight; only later arrivals from others do.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (isSuccess) {
    if (!seen.current) seen.current = new Set(items.map((i) => i.id));
    for (const it of items) if (!seen.current.has(it.id) && isFreshFromOthers(it.created_by, me?.id)) fresh.add(it.id);
  }
  useEffect(() => { if (seen.current) items.forEach((i) => seen.current!.add(i.id)); }, [items]);

  const add = useMutation({
    mutationFn: () => api.createItem(id, { title: title.trim(), qty: qty.trim() || undefined, note: note.trim() || undefined }),
    onSuccess: (created) => {
      seen.current?.add(created.id);
      setTitle(''); setQty(''); setNote(''); setShowQty(false); setShowNote(false);
      invalidate();
    },
    onError: (e) => Alert.alert('Could not add item', friendlyError(e, 'generic')),
  });
  const toggle = useMutation({
    mutationFn: (it: ListItem) => api.updateItem(it.id, { done: !it.done }),
    onMutate: async (it) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ListItem[]>(key);
      qc.setQueryData<ListItem[]>(key, (old = []) => old.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: invalidate,
  });
  const edit = useMutation({
    mutationFn: () => api.updateItem(editing!.id, { title: editTitle.trim(), qty: editQty.trim(), note: editNote.trim(), done: editDone }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: (e) => Alert.alert('Could not update item', friendlyError(e, 'generic')),
  });
  const remove = useMutation({
    mutationFn: (itemId: string) => api.deleteItem(itemId),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: (e) => Alert.alert('Could not delete item', friendlyError(e, 'generic')),
  });
  const clearDone = useMutation({
    mutationFn: () => api.clearCompleted(id),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not clear completed', friendlyError(e, 'generic')),
  });

  const tick = (it: ListItem) => {
    if (it.done) { toggle.mutate(it); return; }
    setTicking((s) => new Set(s).add(it.id));
    setTimeout(() => {
      toggle.mutate(it);
      setTicking((s) => { const n = new Set(s); n.delete(it.id); return n; });
    }, TICK_MS);
  };
  const confirmDelete = (it: ListItem) => Alert.alert('Delete item?', `Delete "${it.title}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(it.id) },
  ]);
  const openEdit = (it: ListItem) => {
    setEditing(it); setEditTitle(it.title); setEditQty(it.qty ?? ''); setEditNote(it.note ?? ''); setEditDone(it.done);
  };

  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const submitAdd = () => { if (title.trim()) add.mutate(); };
  // Rows mount and move with layout animations; under Reduce Motion they snap instead. Reanimated's own
  // reduce-motion handling parks a late-mounted row at its entering state, so the props are left off entirely.
  const reduce = useReducedMotion();
  const rowAnim = (delay: number) => reduce ? {} : {
    layout: LinearTransition.duration(220).easing(motion.sheetIn.easing),
    entering: FadeIn.duration(180).delay(delay),
    exiting: FadeOut.duration(160),
  };

  return (
    <>
      <Stack.Screen
        options={{
          // The display title below the header is the name; a nav-bar title would show it twice.
          title: '',
          headerRight: () => (done.length > 0 ? (
            <Button
              title={`Clear done (${done.length})`}
              variant="ghost"
              size="sm"
              onPress={() => Alert.alert('Clear completed items?', `Remove all ${done.length} completed item(s)?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Clear completed', style: 'destructive', onPress: () => clearDone.mutate() },
              ])}
            />
          ) : null),
        }}
      />
      <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accent} />}>
        <View>
          <Text variant="display" style={{ fontSize: 30, lineHeight: 36 }}>{name ?? 'List'}</Text>
          <Text tone="muted">{open.length} to get</Text>
        </View>

        <Card padded={false} style={{ padding: space(2), gap: space(2) }}>
          <View style={s.composer}>
            {/* The one raw TextInput: an inline composer has no room for Input's visible label. */}
            <TextInput
              accessibilityLabel="Add an item"
              placeholder="Add an item"
              placeholderTextColor={color.muted}
              value={title}
              onChangeText={setTitle}
              onSubmitEditing={submitAdd}
              returnKeyType="done"
              style={s.composerInput}
            />
            <IconButton icon="add" label="Add item" variant="filled" onPress={submitAdd} />
          </View>
          <View style={{ flexDirection: 'row', gap: space(2), paddingHorizontal: space(2) }}>
            <Chip label="+ Quantity" selected={showQty} onPress={() => setShowQty((v) => !v)} />
            <Chip label="+ Note" selected={showNote} onPress={() => setShowNote((v) => !v)} />
          </View>
          {showQty ? <View style={{ paddingHorizontal: space(2) }}><Input label="Quantity" placeholder="e.g. 2 pcs, 1 kg" value={qty} onChangeText={setQty} /></View> : null}
          {showNote ? <View style={{ paddingHorizontal: space(2), paddingBottom: space(2) }}><Input label="Note" placeholder="e.g. brand, specific store, instructions" value={note} onChangeText={setNote} /></View> : null}
        </Card>

        {items.length === 0 ? (
          <EmptyState icon="list.grocery" title="No items in this list" body="Add your first item using the box above." />
        ) : null}

        {open.length > 0 ? (
          <Card padded={false} style={{ overflow: 'hidden' }}>
            {open.map((it, i) => (
              <Animated.View key={it.id} {...rowAnim(0)}>
                <LiveRow fresh={fresh.has(it.id)}>
                  <SwipeRow onComplete={() => tick(it)} onDelete={() => confirmDelete(it)} last={i === open.length - 1}>
                    <AnimatedCheck checked={ticking.has(it.id)} onPress={() => tick(it)} label={`Tick off ${it.title}`} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5), flexWrap: 'wrap' }}>
                        <StrikeText struck={ticking.has(it.id)}>{it.title}</StrikeText>
                        {it.qty ? <Pill label={it.qty} tone="neutral" /> : null}
                      </View>
                      {it.note ? <Text variant="label" tone="muted">{it.note}</Text> : null}
                    </View>
                    <IconButton icon="edit" label={`Edit ${it.title}`} onPress={() => openEdit(it)} />
                  </SwipeRow>
                </LiveRow>
              </Animated.View>
            ))}
          </Card>
        ) : null}

        {done.length > 0 ? (
          <>
            <Text variant="caption" tone="muted" style={{ marginLeft: space(1) }}>Done · {done.length}</Text>
            <Card padded={false} style={{ overflow: 'hidden', backgroundColor: color.surfaceSunk }}>
              {done.map((it, i) => (
                <Animated.View key={it.id} {...rowAnim(60)}>
                  <View style={[s.row, i === done.length - 1 && s.rowLast]}>
                    <AnimatedCheck checked onPress={() => tick(it)} label={`Bring back ${it.title}`} />
                    <View style={{ flex: 1 }}><StrikeText struck variant="body">{it.title}</StrikeText></View>
                    <IconButton icon="edit" label={`Edit ${it.title}`} onPress={() => openEdit(it)} />
                  </View>
                </Animated.View>
              ))}
            </Card>
          </>
        ) : null}
      </Screen>

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title="Edit item">
        <Input label="Title" value={editTitle} onChangeText={setEditTitle} />
        <Input label="Quantity (optional)" placeholder="e.g. 2 cartons, 500g" value={editQty} onChangeText={setEditQty} />
        <Input label="Note (optional)" placeholder="e.g. brand, store details" value={editNote} onChangeText={setEditNote} multiline />
        <View style={s.switchRow}>
          <Text variant="headline">Completed</Text>
          <Switch value={editDone} onValueChange={setEditDone} trackColor={{ true: color.accent }} accessibilityLabel="Completed" />
        </View>
        <Button title="Save changes" fullWidth loading={edit.isPending} disabled={!editTitle.trim()} onPress={() => { if (editTitle.trim()) edit.mutate(); }} />
        <Button title="Delete item" variant="danger" fullWidth onPress={() => editing && confirmDelete(editing)} />
      </Sheet>
    </>
  );
}

/** Swipe right to complete, left to delete; a flick commits even if short, with a haptic tick at the threshold. */
function SwipeRow({ children, onComplete, onDelete, last }: { children: React.ReactNode; onComplete: () => void; onDelete: () => void; last: boolean }) {
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  const limit = width * SWIPE_COMMIT;

  useAnimatedReaction(() => Math.abs(x.value) >= limit, (past, was) => { if (past && !was) scheduleOnRN(haptic.selection); });

  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      const max = width * 0.6;
      x.value = Math.abs(e.translationX) > max ? Math.sign(e.translationX) * (max + (Math.abs(e.translationX) - max) / 4) : e.translationX;
    })
    .onEnd((e) => {
      if (x.value > limit || e.velocityX > 110 * 6) scheduleOnRN(onComplete);
      else if (x.value < -limit || e.velocityX < -110 * 6) scheduleOnRN(onDelete);
      x.value = withSpring(0, motion.spring);
    });

  const front = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const doneUnder = useAnimatedStyle(() => ({ opacity: x.value > 0 ? Math.min(1, x.value / limit) : 0 }));
  const delUnder = useAnimatedStyle(() => ({ opacity: x.value < 0 ? Math.min(1, -x.value / limit) : 0 }));

  return (
    <View>
      <Animated.View style={[StyleSheet.absoluteFill, s.under, { backgroundColor: color.accent, justifyContent: 'flex-start' }, doneUnder]}>
        <Icon name="check" tint={color.onAccent} /><Text variant="label" tone="onAccent">Done</Text>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, s.under, { backgroundColor: status.danger, justifyContent: 'flex-end' }, delUnder]}>
        <Text variant="label" tone="onAccent">Delete</Text><Icon name="delete" tint={color.onAccent} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[s.row, last && s.rowLast, { backgroundColor: color.surface }, front]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const s = StyleSheet.create({
  composer: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  composerInput: { ...typo.body, fontSize: 16, color: color.ink, flex: 1, paddingHorizontal: space(2), paddingVertical: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2), paddingLeft: space(4), paddingRight: space(1), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  rowLast: { borderBottomWidth: 0 },
  under: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(5), borderRadius: radius.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
