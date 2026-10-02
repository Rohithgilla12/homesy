import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { api } from '@/api/client';
import { useActiveHome } from '@/store/home';
import { useSession } from '@/store/session';
import { Button, Card, Input, Muted, Row, Screen, Title } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

const EMOJI_OPTIONS = ['🏠', '🏡', '🏢', '🏖️', '🛋️', '🌴', '⛺', '🏰'];

export default function HomeScreen() {
  const qc = useQueryClient();
  const { activeHomeId, setActiveHome } = useActiveHome();
  const { user, signOut } = useSession();

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🏠');
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);

  // Notice modal state
  const [noticeModalVisible, setNoticeModalVisible] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeContent, setNoticeContent] = useState('');
  const [noticePriority, setNoticePriority] = useState<'normal' | 'urgent'>('normal');

  const { data: homes = [] } = useQuery({ queryKey: ['homes'], queryFn: api.homes });
  const { data: detail } = useQuery({
    queryKey: ['home', activeHomeId],
    queryFn: () => api.home(activeHomeId!),
    enabled: !!activeHomeId,
  });

  const { data: notices = [] } = useQuery({
    queryKey: ['bulletin', activeHomeId],
    queryFn: () => api.bulletin(activeHomeId!),
    enabled: !!activeHomeId,
  });

  const createNoticeMutation = useMutation({
    mutationFn: () =>
      api.createNotice(activeHomeId!, {
        title: noticeTitle.trim(),
        content: noticeContent.trim(),
        priority: noticePriority,
      }),
    onSuccess: () => {
      setNoticeTitle('');
      setNoticeContent('');
      setNoticePriority('normal');
      setNoticeModalVisible(false);
      qc.invalidateQueries({ queryKey: ['bulletin', activeHomeId] });
      qc.invalidateQueries({ queryKey: ['activity', activeHomeId] });
    },
    onError: (e: Error) => Alert.alert('Could not post notice', e.message),
  });

  const deleteNoticeMutation = useMutation({
    mutationFn: (id: string) => api.deleteNotice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulletin', activeHomeId] });
      qc.invalidateQueries({ queryKey: ['activity', activeHomeId] });
    },
    onError: (e: Error) => Alert.alert('Could not delete notice', e.message),
  });

  const afterChange = (id: string) => {
    qc.invalidateQueries({ queryKey: ['homes'] });
    setActiveHome(id);
    setName('');
    setCode('');
  };

  const create = useMutation({
    mutationFn: () => api.createHome({ name: name.trim(), emoji }),
    onSuccess: (h) => afterChange(h.id),
    onError: (e: Error) => Alert.alert('Could not create home', e.message),
  });

  const join = useMutation({
    mutationFn: () => api.joinHome(code.trim().toUpperCase()),
    onSuccess: (h) => afterChange(h.id),
    onError: () => Alert.alert('Invalid code', 'Check the 6-character code and try again.'),
  });

  const leave = useMutation({
    mutationFn: () => api.leaveHome(activeHomeId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['homes'] });
      // Switch to another home if available
      const remaining = homes.filter((h) => h.id !== activeHomeId);
      setActiveHome(remaining.length > 0 ? remaining[0].id : null);
    },
    onError: (e: Error) => Alert.alert('Could not leave home', e.message),
  });

  const copyCode = async (inviteCode: string) => {
    await Clipboard.setStringAsync(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const shareCode = (homeName: string, inviteCode: string) => {
    Share.share({
      message: `Join "${homeName}" on Homesy with invite code: ${inviteCode}`,
    });
  };

  const onboarding = homes.length === 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <Screen>
        <ScrollView
          contentContainerStyle={{ gap: space(2), paddingBottom: space(6) }}
          showsVerticalScrollIndicator={false}
        >
          {onboarding ? (
            <View style={{ marginBottom: space(1) }}>
              <Title>Welcome, {user?.display_name} 👋</Title>
              <Muted>
                Start with the home you're in right now. You can add your parents' place,
                the flat you rent, anywhere — each home has its own lists, details, and members.
              </Muted>
            </View>
          ) : null}

          {/* Active Home Details & Fridge Whiteboard */}
          {detail && !onboarding && (
            <>
              {/* House Noticeboard / Fridge Whiteboard */}
              <Card style={s.noticeboardCard}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: space(1) }}>
                  <Row style={{ gap: space(0.5), alignItems: 'center' }}>
                    <Text style={{ fontSize: 20 }}>📌</Text>
                    <Text style={s.noticeboardTitle}>Fridge Whiteboard</Text>
                  </Row>
                  <Button
                    title="+ Post note"
                    variant="ghost"
                    onPress={() => setNoticeModalVisible(true)}
                  />
                </Row>

                {notices.length === 0 ? (
                  <View style={s.emptyNoticeBox}>
                    <Text style={s.emptyNoticeText}>No active notes on the whiteboard</Text>
                    <Muted style={{ fontSize: 12 }}>
                      Post urgent updates (e.g. "Water tanker arriving at 3 PM", "Maid on leave").
                    </Muted>
                  </View>
                ) : (
                  <View style={{ gap: space(0.75) }}>
                    {notices.map((n) => {
                      const isUrgent = n.priority === 'urgent';
                      return (
                        <View
                          key={n.id}
                          style={[s.noticeItem, isUrgent ? s.noticeUrgent : s.noticeNormal]}
                        >
                          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <View style={{ flex: 1, marginRight: space(1) }}>
                              <Row style={{ gap: space(0.75), alignItems: 'center' }}>
                                <Text style={[s.noticeItemTitle, isUrgent && s.noticeUrgentTitle]}>
                                  {n.title}
                                </Text>
                                {isUrgent ? (
                                  <View style={s.urgentBadge}>
                                    <Text style={s.urgentBadgeText}>URGENT</Text>
                                  </View>
                                ) : null}
                              </Row>
                              <Text style={s.noticeContent}>{n.content}</Text>
                            </View>

                            <Pressable
                              onPress={() =>
                                Alert.alert('Delete note?', `Remove "${n.title}" from the whiteboard?`, [
                                  { text: 'Cancel', style: 'cancel' },
                                  {
                                    text: 'Delete',
                                    style: 'destructive',
                                    onPress: () => deleteNoticeMutation.mutate(n.id),
                                  },
                                ])
                              }
                              style={s.deleteNoticeBtn}
                            >
                              <Text style={s.deleteNoticeText}>✕</Text>
                            </Pressable>
                          </Row>
                        </View>
                      );
                    })}
                  </View>
                )}
              </Card>

              {/* Home Overview Card */}
              <Card style={{ gap: space(1.5) }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={s.homeName}>
                  {detail.emoji} {detail.name}
                </Text>
              </Row>

              {/* Invite Code Box */}
              <View style={s.inviteBox}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Muted>Household Invite Code</Muted>
                    <Pressable onPress={() => copyCode(detail.invite_code)}>
                      <Text style={s.code} selectable>
                        {detail.invite_code}
                      </Text>
                    </Pressable>
                  </View>
                  <Row style={{ gap: space(0.75) }}>
                    <Button
                      title={copied ? 'Copied! ✓' : 'Copy'}
                      variant="ghost"
                      onPress={() => copyCode(detail.invite_code)}
                    />
                    <Button
                      title="Share"
                      variant="ghost"
                      onPress={() => shareCode(detail.name, detail.invite_code)}
                    />
                  </Row>
                </Row>
                <Text style={s.inviteHint}>Share this 6-character code with roommates or family</Text>
              </View>

              {/* Members Section */}
              <View style={{ marginTop: space(1) }}>
                <Text style={s.sectionHeader}>Members ({detail.members.length})</Text>
                <View style={{ gap: space(0.75), marginTop: space(0.75) }}>
                  {detail.members.map((m) => {
                    const isMe = m.user_id === user?.id;
                    return (
                      <Row
                        key={m.user_id}
                        style={{
                          justifyContent: 'space-between',
                          paddingVertical: space(0.75),
                          borderBottomWidth: 1,
                          borderBottomColor: colors.line,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Row style={{ gap: space(0.75) }}>
                            <Text style={s.member}>
                              {m.display_name}
                            </Text>
                            {isMe ? <Text style={s.youBadge}>you</Text> : null}
                          </Row>
                          <Muted>{m.email}</Muted>
                        </View>
                        <View style={[s.roleBadge, m.role === 'owner' ? s.roleOwner : s.roleMember]}>
                          <Text
                            style={[
                              s.roleText,
                              m.role === 'owner' ? s.roleTextOwner : s.roleTextMember,
                            ]}
                          >
                            {m.role}
                          </Text>
                        </View>
                      </Row>
                    );
                  })}
                </View>
              </View>

              {/* Leave Home */}
              <View style={{ marginTop: space(1) }}>
                <Button
                  title="Leave this home"
                  variant="danger"
                  onPress={() =>
                    Alert.alert('Leave home?', `Are you sure you want to leave "${detail.name}"?`, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Leave',
                        style: 'destructive',
                        onPress: () => leave.mutate(),
                      },
                    ])
                  }
                  loading={leave.isPending}
                />
              </View>
            </Card>
            </>
          )}

          {/* Create Home Card */}
          <Card style={{ gap: space(1) }}>
            <Text style={s.cardTitle}>
              {onboarding ? 'Create your first home' : 'Add another home'}
            </Text>
            <Muted>Create a separate space with its own grocery, laundry, and to-do lists.</Muted>

            <View style={{ marginVertical: space(0.5) }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Row style={{ gap: space(0.75) }}>
                  {EMOJI_OPTIONS.map((e) => (
                    <Pressable
                      key={e}
                      onPress={() => setEmoji(e)}
                      style={[s.emojiChip, emoji === e && s.emojiChipActive]}
                    >
                      <Text style={s.emojiText}>{e}</Text>
                    </Pressable>
                  ))}
                </Row>
              </ScrollView>
            </View>

            <Input
              placeholder="e.g. Parents' house, Bangalore flat"
              value={name}
              onChangeText={setName}
            />
            <Button
              title="Create home"
              onPress={() => name.trim() && create.mutate()}
              loading={create.isPending}
            />
          </Card>

          {/* Join with Code Card */}
          <Card style={{ gap: space(1) }}>
            <Text style={s.cardTitle}>Join a home with an invite code</Text>
            <Muted>Enter the 6-character code from a household member.</Muted>
            <Input
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              value={code}
              onChangeText={setCode}
              style={s.joinInput}
            />
            <Button
              title="Join home"
              onPress={() => code.trim().length === 6 && join.mutate()}
              loading={join.isPending}
            />
          </Card>

          {/* Account & Sign out */}
          <Card style={{ gap: space(1) }}>
            <Text style={s.cardTitle}>Account</Text>
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Text style={s.accountName}>{user?.display_name}</Text>
                <Muted>{user?.email}</Muted>
              </View>
            </Row>
            <Button
              title="Sign out"
              variant="ghost"
              onPress={() =>
                Alert.alert('Sign out', 'Are you sure you want to sign out?', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign out', style: 'destructive', onPress: signOut },
                ])
              }
            />
          </Card>
        </ScrollView>

        {/* Post Notice Modal */}
        <Modal
          visible={noticeModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setNoticeModalVisible(false)}
        >
          <Pressable style={s.backdrop} onPress={() => setNoticeModalVisible(false)}>
            <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
              <Text style={s.sheetTitle}>Post Note on Fridge Whiteboard</Text>
              <Muted>Leave a note for everyone in the household.</Muted>

              <Muted style={{ marginTop: space(0.5) }}>Title</Muted>
              <Input
                placeholder="e.g. Water tanker arriving at 3 PM, Maid on leave"
                value={noticeTitle}
                onChangeText={setNoticeTitle}
              />

              <Muted>Content / Details</Muted>
              <Input
                placeholder="e.g. Please make sure buckets are filled and balconies are cleared."
                value={noticeContent}
                onChangeText={setNoticeContent}
                multiline
                numberOfLines={3}
                style={{ minHeight: 70, textAlignVertical: 'top' }}
              />

              <Row style={{ justifyContent: 'space-between', alignItems: 'center', paddingVertical: space(0.5) }}>
                <View>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>
                    Mark as Urgent
                  </Text>
                  <Muted style={{ fontSize: 12 }}>
                    Highlights note in red at the top of the whiteboard
                  </Muted>
                </View>
                <Switch
                  value={noticePriority === 'urgent'}
                  onValueChange={(val) => setNoticePriority(val ? 'urgent' : 'normal')}
                  trackColor={{ true: '#EF4444' }}
                />
              </Row>

              <Button
                title="Post note"
                onPress={() => noticeTitle.trim() && noticeContent.trim() && createNoticeMutation.mutate()}
                loading={createNoticeMutation.isPending}
                style={{ marginTop: space(1) }}
              />
              <Button title="Cancel" variant="ghost" onPress={() => setNoticeModalVisible(false)} />
            </Pressable>
          </Pressable>
        </Modal>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  homeName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.ink,
  },
  inviteBox: {
    backgroundColor: colors.accentSoft,
    padding: space(1.5),
    borderRadius: radius,
    borderWidth: 1,
    borderColor: '#F8C8B3',
  },
  code: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 4,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
    marginTop: space(0.25),
  },
  inviteHint: {
    fontSize: 12,
    color: colors.muted,
    marginTop: space(0.5),
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
  },
  member: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  youBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: space(0.75),
    paddingVertical: space(0.25),
    borderRadius: 999,
  },
  roleBadge: {
    paddingHorizontal: space(1),
    paddingVertical: space(0.25),
    borderRadius: 999,
  },
  roleOwner: {
    backgroundColor: '#FEF3C7',
  },
  roleMember: {
    backgroundColor: '#F3F4F6',
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  roleTextOwner: {
    color: '#92400E',
  },
  roleTextMember: {
    color: '#4B5563',
  },
  accountName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
  },
  joinInput: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 3,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
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
  emojiText: {
    fontSize: 22,
  },
  noticeboardCard: {
    backgroundColor: '#FEFDF8',
    borderColor: '#F3ECE0',
    borderWidth: 1,
    padding: space(1.5),
  },
  noticeboardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
  },
  emptyNoticeBox: {
    paddingVertical: space(1),
    alignItems: 'center',
    gap: space(0.25),
  },
  emptyNoticeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
  },
  noticeItem: {
    padding: space(1.25),
    borderRadius: radius,
    borderWidth: 1,
  },
  noticeNormal: {
    backgroundColor: '#F9F8F6',
    borderColor: colors.line,
  },
  noticeUrgent: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
  },
  noticeItemTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
  },
  noticeUrgentTitle: {
    color: '#991B1B',
  },
  urgentBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: space(0.75),
    paddingVertical: 2,
    borderRadius: 4,
  },
  urgentBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  noticeContent: {
    fontSize: 13,
    color: colors.muted,
    marginTop: space(0.25),
    lineHeight: 18,
  },
  deleteNoticeBtn: {
    padding: space(0.5),
  },
  deleteNoticeText: {
    fontSize: 14,
    color: colors.muted,
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
