import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '@/api/client';
import { useActiveHome } from '@/store/home';
import { Button, Input, Muted, Row } from './primitives';
import { colors, radius, space } from './theme';

const EMOJI_OPTIONS = ['🏠', '🏡', '🏢', '🏖️', '🛋️', '🌴', '⛺', '🏰'];

/**
 * Header pill showing the active home; tap to switch or create/join homes.
 */
export function HomeSwitcher() {
  const qc = useQueryClient();
  const { data: homes = [] } = useQuery({ queryKey: ['homes'], queryFn: api.homes });
  const { activeHomeId, setActiveHome } = useActiveHome();

  const [openSwitcher, setOpenSwitcher] = useState(false);
  const [openCreate, setOpenCreate] = useState(false);
  const [openJoin, setOpenJoin] = useState(false);

  // Form states
  const [createName, setCreateName] = useState('');
  const [createEmoji, setCreateEmoji] = useState('🏠');
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    if (homes.length && !homes.some((h) => h.id === activeHomeId)) {
      setActiveHome(homes[0].id);
    }
  }, [homes, activeHomeId, setActiveHome]);

  const createMutation = useMutation({
    mutationFn: () => api.createHome({ name: createName.trim(), emoji: createEmoji }),
    onSuccess: (newHome) => {
      qc.invalidateQueries({ queryKey: ['homes'] });
      setActiveHome(newHome.id);
      setCreateName('');
      setCreateEmoji('🏠');
      setOpenCreate(false);
      setOpenSwitcher(false);
    },
    onError: (e: Error) => Alert.alert('Could not create home', e.message),
  });

  const joinMutation = useMutation({
    mutationFn: () => api.joinHome(joinCode.trim().toUpperCase()),
    onSuccess: (joinedHome) => {
      qc.invalidateQueries({ queryKey: ['homes'] });
      setActiveHome(joinedHome.id);
      setJoinCode('');
      setOpenJoin(false);
      setOpenSwitcher(false);
    },
    onError: () => Alert.alert('Invalid code', 'Please check the 6-character code and try again.'),
  });

  const active = homes.find((h) => h.id === activeHomeId);
  if (!active) return null;

  return (
    <>
      <Pressable onPress={() => setOpenSwitcher(true)} style={s.pill}>
        <Text style={s.pillText} numberOfLines={1}>
          {active.emoji} {active.name} ▾
        </Text>
      </Pressable>

      {/* Switcher Modal / Sheet */}
      <Modal
        visible={openSwitcher}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenSwitcher(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setOpenSwitcher(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Row style={{ justifyContent: 'space-between', marginBottom: space(1) }}>
              <Text style={s.sheetTitle}>Your homes</Text>
              <Pressable onPress={() => setOpenSwitcher(false)}>
                <Text style={s.closeText}>Done</Text>
              </Pressable>
            </Row>

            <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: space(1) }}>
              {homes.map((h) => {
                const isSelected = h.id === activeHomeId;
                return (
                  <Pressable
                    key={h.id}
                    onPress={() => {
                      setActiveHome(h.id);
                      setOpenSwitcher(false);
                    }}
                    style={[s.option, isSelected && s.optionActive]}
                  >
                    <Row style={{ justifyContent: 'space-between' }}>
                      <Text style={s.optionText}>
                        {h.emoji}  {h.name}
                      </Text>
                      {isSelected ? <Text style={s.checkmark}>✓</Text> : null}
                    </Row>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={s.divider} />

            <Row style={{ gap: space(1) }}>
              <Pressable
                style={[s.actionBtn, { flex: 1 }]}
                onPress={() => {
                  setOpenSwitcher(false);
                  setOpenCreate(true);
                }}
              >
                <Text style={s.actionBtnText}>+ Create home</Text>
              </Pressable>
              <Pressable
                style={[s.actionBtn, { flex: 1 }]}
                onPress={() => {
                  setOpenSwitcher(false);
                  setOpenJoin(true);
                }}
              >
                <Text style={s.actionBtnText}>+ Join with code</Text>
              </Pressable>
            </Row>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Create Home Modal */}
      <Modal
        visible={openCreate}
        transparent
        animationType="slide"
        onRequestClose={() => setOpenCreate(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setOpenCreate(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>Create a new home</Text>
            <Muted>Choose an icon and a name for this household.</Muted>

            <View style={{ marginVertical: space(1.5) }}>
              <Muted>Icon</Muted>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space(0.5) }}>
                <Row style={{ gap: space(1) }}>
                  {EMOJI_OPTIONS.map((e) => (
                    <Pressable
                      key={e}
                      onPress={() => setCreateEmoji(e)}
                      style={[s.emojiChip, createEmoji === e && s.emojiChipActive]}
                    >
                      <Text style={s.emojiChipText}>{e}</Text>
                    </Pressable>
                  ))}
                </Row>
              </ScrollView>
            </View>

            <Input
              placeholder="e.g. Bangalore Flat, Mom's House"
              value={createName}
              onChangeText={setCreateName}
              autoFocus
            />

            <Button
              title="Create home"
              onPress={() => createName.trim() && createMutation.mutate()}
              loading={createMutation.isPending}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setOpenCreate(false)} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Join Home Modal */}
      <Modal
        visible={openJoin}
        transparent
        animationType="slide"
        onRequestClose={() => setOpenJoin(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setOpenJoin(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>Join an existing home</Text>
            <Muted>Ask someone in the household for their 6-character invite code.</Muted>

            <Input
              placeholder="e.g. 7X3K9M"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              value={joinCode}
              onChangeText={setJoinCode}
              style={s.codeInput}
              autoFocus
            />

            <Button
              title="Join home"
              onPress={() => joinCode.trim().length === 6 && joinMutation.mutate()}
              loading={joinMutation.isPending}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setOpenJoin(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  pill: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: space(1.5),
    paddingVertical: space(0.75),
    borderRadius: 999,
    maxWidth: 240,
  },
  pillText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 15,
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
  closeText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 16,
  },
  option: {
    padding: space(1.5),
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  optionActive: {
    borderColor: colors.accent,
    backgroundColor: '#FFF8F4',
  },
  optionText: {
    fontSize: 16,
    color: colors.ink,
    fontWeight: '500',
  },
  checkmark: {
    fontSize: 16,
    color: colors.accent,
    fontWeight: '700',
  },
  divider: {
    height: 1,
    backgroundColor: colors.line,
    marginVertical: space(1),
  },
  actionBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius,
    padding: space(1.25),
    alignItems: 'center',
  },
  actionBtnText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 14,
  },
  emojiChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  emojiChipText: {
    fontSize: 20,
  },
  codeInput: {
    fontSize: 22,
    letterSpacing: 4,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginTop: space(1.5),
    fontWeight: '700',
  },
});
