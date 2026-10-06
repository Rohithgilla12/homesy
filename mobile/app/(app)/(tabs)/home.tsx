import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Switch, View } from 'react-native';
import { api } from '@/api/client';
import { friendlyError } from '@/lib/errors';
import { inviteLink } from '@/lib/links';
import { useCelebrate } from '@/store/celebrate';
import { useActiveHome } from '@/store/home';
import { useSession } from '@/store/session';
import {
  AttachmentPicker, Avatar, Button, Card, Chip, CoverImage, HOME_EMOJI, IconButton, Input, Pill, Screen, Sheet, Text, color, radius, space, status,
} from '@/ui';

export default function HomeScreen() {
  const qc = useQueryClient();
  const { activeHomeId, setActiveHome } = useActiveHome();
  const { user, signOut } = useSession();

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(HOME_EMOJI[0]);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const celebrate = useCelebrate((s) => s.fire);

  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeContent, setNoticeContent] = useState('');
  const [urgent, setUrgent] = useState(false);

  const { data: homes = [] } = useQuery({ queryKey: ['homes'], queryFn: api.homes });
  const { data: detail } = useQuery({ queryKey: ['home', activeHomeId], queryFn: () => api.home(activeHomeId!), enabled: !!activeHomeId });
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });
  const isOwner = !!detail?.members.some((m) => m.user_id === user?.id && m.role === 'owner');
  const refreshMe = () => { qc.invalidateQueries({ queryKey: ['me'] }); qc.invalidateQueries({ queryKey: ['home', activeHomeId] }); };
  const setAvatar = useMutation({
    mutationFn: (avatar_id: string | null) => api.updateMe({ avatar_id }),
    onSuccess: refreshMe,
    onError: (e) => Alert.alert('Could not update photo', friendlyError(e, 'generic')),
  });
  const setCover = useMutation({
    mutationFn: (cover_id: string | null) => api.updateHome(activeHomeId!, { cover_id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['home', activeHomeId] }); qc.invalidateQueries({ queryKey: ['homes'] }); },
    onError: (e) => Alert.alert('Could not update cover photo', friendlyError(e, 'generic')),
  });
  const { data: notices = [] } = useQuery({ queryKey: ['bulletin', activeHomeId], queryFn: () => api.bulletin(activeHomeId!), enabled: !!activeHomeId });

  // Celebrate when someone joins a home you own (member count grows via the live SSE invalidation).
  const memberCount = useRef<{ home: string | null; n: number }>({ home: null, n: 0 });
  useEffect(() => {
    if (!detail) return;
    const n = detail.members.length;
    const prev = memberCount.current;
    const iOwn = detail.members.some((m) => m.user_id === user?.id && m.role === 'owner');
    if (prev.home === detail.id && n > prev.n && iOwn) celebrate();
    memberCount.current = { home: detail.id, n };
  }, [detail, user?.id]);

  const createNotice = useMutation({
    mutationFn: () => api.createNotice(activeHomeId!, { title: noticeTitle.trim(), content: noticeContent.trim(), priority: urgent ? 'urgent' : 'normal' }),
    onSuccess: () => {
      setNoticeTitle(''); setNoticeContent(''); setUrgent(false); setNoticeOpen(false);
      qc.invalidateQueries({ queryKey: ['bulletin', activeHomeId] });
      qc.invalidateQueries({ queryKey: ['activity', activeHomeId] });
    },
    onError: (e) => Alert.alert('Could not post note', friendlyError(e, 'generic')),
  });
  const deleteNotice = useMutation({
    mutationFn: (id: string) => api.deleteNotice(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulletin', activeHomeId] });
      qc.invalidateQueries({ queryKey: ['activity', activeHomeId] });
    },
    onError: (e) => Alert.alert('Could not delete note', friendlyError(e, 'generic')),
  });

  const onboarding = homes.length === 0;
  const afterChange = (id: string) => {
    qc.invalidateQueries({ queryKey: ['homes'] });
    setActiveHome(id);
    setName(''); setCode(''); setFormError(null);
  };
  const create = useMutation({
    mutationFn: () => api.createHome({ name: name.trim(), emoji }),
    onSuccess: (h) => { if (onboarding) celebrate(); afterChange(h.id); },
    onError: (e) => setFormError(friendlyError(e, 'generic')),
  });
  const join = useMutation({
    mutationFn: () => api.joinHome(code.trim().toUpperCase()),
    onSuccess: (h) => afterChange(h.id),
    onError: () => setFormError('Check the 6-character code and try again.'),
  });
  const leave = useMutation({
    mutationFn: () => api.leaveHome(activeHomeId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['homes'] });
      const remaining = homes.filter((h) => h.id !== activeHomeId);
      setActiveHome(remaining.length > 0 ? remaining[0].id : null);
    },
    onError: (e) => Alert.alert('Could not leave home', friendlyError(e, 'generic')),
  });

  const copyCode = async (inviteCode: string) => {
    await Clipboard.setStringAsync(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const createCard = (
    <Card style={{ gap: space(3) }}>
      <Text variant="title">{onboarding ? 'Create your first home' : 'Add another home'}</Text>
      <Text tone="muted">A separate space with its own grocery, laundry and to-do lists.</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
        {HOME_EMOJI.map((e) => <Chip key={e} label={e} selected={emoji === e} onPress={() => setEmoji(e)} />)}
      </ScrollView>
      <Input label="Home name" placeholder="e.g. Parents' house, Bangalore flat" value={name} onChangeText={setName} />
      <Button title="Create home" loading={create.isPending} onPress={() => { setFormError(null); if (name.trim()) create.mutate(); }} />
    </Card>
  );
  const joinCard = (
    <Card style={{ gap: space(3) }}>
      <Text variant="title">Join with an invite code</Text>
      <Text tone="muted">Enter the 6-character code from a household member.</Text>
      <Input label="Invite code" variant="code" placeholder="ABC123" value={code} onChangeText={setCode} />
      <Button title="Join home" variant="secondary" loading={join.isPending} onPress={() => { setFormError(null); if (code.trim().length === 6) join.mutate(); }} />
    </Card>
  );
  const accountCard = (
    <Card style={{ gap: space(1) }}>
      <Text variant="title">Account</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(3), marginTop: space(2) }}>
        {user ? <Avatar userId={user.id} name={user.display_name} size={56} uri={me?.avatar?.url} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="headline">{user?.display_name}</Text>
          <Text tone="muted">{user?.email}</Text>
        </View>
      </View>
      {activeHomeId ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
          <AttachmentPicker homeId={activeHomeId} kind="avatar" label={me?.avatar ? 'Change photo' : 'Add photo'} onUploaded={(a) => setAvatar.mutate(a.id)} />
          {me?.avatar ? <Button title="Remove photo" variant="ghost" size="sm" onPress={() => setAvatar.mutate(null)} /> : null}
        </View>
      ) : null}
      <Button
        title="Sign out"
        icon="signOut"
        variant="ghost"
        style={{ alignSelf: 'flex-start', marginTop: space(2) }}
        onPress={() => Alert.alert('Sign out', 'Are you sure you want to sign out?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Sign out', style: 'destructive', onPress: signOut },
        ])}
      />
    </Card>
  );

  if (onboarding) {
    return (
      <Screen scroll>
        <Text variant="display" style={{ marginTop: space(4) }}>Welcome, {user?.display_name?.split(' ')[0] ?? 'there'}</Text>
        <Text tone="muted">
          Start with the home you're in right now. You can add your parents' place, the flat you rent, anywhere — each home has its own lists, details, and members.
        </Text>
        {formError ? <Text variant="label" tone="danger">{formError}</Text> : null}
        {createCard}
        {joinCard}
        {accountCard}
      </Screen>
    );
  }

  return (
    <>
      <Screen scroll>
        {detail?.cover ? <CoverImage uri={detail.cover.url} onExpired={() => qc.invalidateQueries({ queryKey: ['home', activeHomeId] })} /> : null}
        <View style={s.rowBetween}>
          <Text variant="display" style={{ flex: 1 }}>{detail ? detail.name : ' '}</Text>
        </View>
        {detail && isOwner ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
            <AttachmentPicker homeId={detail.id} kind="home_cover" label={detail.cover ? 'Change cover photo' : 'Add cover photo'} onUploaded={(a) => setCover.mutate(a.id)} />
            {detail.cover ? <Button title="Remove cover" variant="ghost" size="sm" onPress={() => setCover.mutate(null)} /> : null}
          </View>
        ) : null}

        <Card style={{ gap: space(3), backgroundColor: color.surface }}>
          <View style={s.rowBetween}>
            <Text variant="title">Fridge whiteboard</Text>
            <Button title="Note" icon="add" size="sm" variant="secondary" onPress={() => setNoticeOpen(true)} />
          </View>
          {notices.length === 0 ? (
            <Text tone="muted">No notes yet. Post urgent updates like "Water tanker arriving at 3 PM" or "Maid on leave".</Text>
          ) : (
            notices.map((n) => {
              const isUrgent = n.priority === 'urgent';
              return (
                <View key={n.id} style={[s.note, isUrgent && s.noteUrgent]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
                      {isUrgent ? <Pill label="Urgent" tone="danger" solid /> : null}
                      <Text variant="headline" color={isUrgent ? status.dangerInk : undefined}>{n.title}</Text>
                    </View>
                    {n.content ? <Text variant="label" tone={isUrgent ? 'danger' : 'muted'}>{n.content}</Text> : null}
                  </View>
                  <IconButton
                    icon="close"
                    label={`Delete note ${n.title}`}
                    onPress={() => Alert.alert('Delete note?', `Remove "${n.title}" from the whiteboard?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => deleteNotice.mutate(n.id) },
                    ])}
                  />
                </View>
              );
            })
          )}
        </Card>

        {detail ? (
          <Card style={{ gap: space(2) }}>
            <Text variant="caption" tone="muted">Invite code</Text>
            <View style={s.rowBetween}>
              <Text variant="mono" tone="accentInk" style={{ letterSpacing: 6, fontSize: 28, lineHeight: 34, fontVariant: ['tabular-nums'] }} selectable>
                {detail.invite_code}
              </Text>
              <View style={{ flexDirection: 'row', gap: space(2) }}>
                <Button title={copied ? 'Copied' : 'Copy'} icon={copied ? 'copied' : 'copy'} size="sm" variant="secondary" onPress={() => copyCode(detail.invite_code)} />
                <Button
                  title="Share"
                  icon="share"
                  size="sm"
                  onPress={() => Share.share({ message: `Join "${detail.name}" on Homesy: ${inviteLink(detail.invite_code)}\nOr enter invite code ${detail.invite_code} on the Home tab.` })}
                />
              </View>
            </View>
            <Text variant="label" tone="muted">Anyone with this code can join this home.</Text>
          </Card>
        ) : null}

        {detail ? (
          <Card padded={false} style={{ paddingHorizontal: space(4), paddingVertical: space(1) }}>
            <Text variant="caption" tone="muted" style={{ marginTop: space(3), marginBottom: space(1) }}>Members · {detail.members.length}</Text>
            {detail.members.map((m, i) => (
              <View key={m.user_id} style={[s.member, i === detail.members.length - 1 && { borderBottomWidth: 0 }]}>
                <Avatar userId={m.user_id} name={m.display_name} uri={m.avatar?.url} />
                <View style={{ flex: 1 }}>
                  <Text variant="headline">
                    {m.display_name}
                    {m.user_id === user?.id ? <Text tone="muted"> (you)</Text> : null}
                  </Text>
                  <Text variant="label" tone="muted">{m.email}</Text>
                </View>
                <Pill label={m.role === 'owner' ? 'Owner' : 'Member'} tone={m.role === 'owner' ? 'accent' : 'neutral'} />
              </View>
            ))}
          </Card>
        ) : null}

        {createCard}
        {joinCard}
        {formError ? <Text variant="label" tone="danger">{formError}</Text> : null}
        {accountCard}

        {detail ? (
          <Button
            title="Leave this home"
            variant="danger"
            fullWidth
            loading={leave.isPending}
            onPress={() => Alert.alert('Leave home?', `Are you sure you want to leave "${detail.name}"?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Leave', style: 'destructive', onPress: () => leave.mutate() },
            ])}
          />
        ) : null}
      </Screen>

      <Sheet visible={noticeOpen} onClose={() => setNoticeOpen(false)} title="Post a note">
        <Text tone="muted">Leave a note for everyone in the household.</Text>
        <Input label="Title" placeholder="e.g. Water tanker arriving at 3 PM" value={noticeTitle} onChangeText={setNoticeTitle} />
        <Input label="Details" placeholder="e.g. Please fill the buckets and clear the balcony." value={noticeContent} onChangeText={setNoticeContent} multiline />
        <View style={s.rowBetween}>
          <View style={{ flex: 1, paddingRight: space(3) }}>
            <Text variant="headline">Urgent</Text>
            <Text variant="label" tone="muted">Highlights the note in red at the top of the whiteboard</Text>
          </View>
          <Switch value={urgent} onValueChange={setUrgent} trackColor={{ true: status.danger }} accessibilityLabel="Mark as urgent" />
        </View>
        <Button title="Post note" fullWidth loading={createNotice.isPending} onPress={() => { if (noticeTitle.trim()) createNotice.mutate(); }} />
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(2) },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space(2), backgroundColor: color.surfaceSunk, borderRadius: radius.md, padding: space(3) },
  noteUrgent: { backgroundColor: status.dangerSoft },
  member: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
});
