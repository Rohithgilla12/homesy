import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { api } from '@/api/client';
import { friendlyError } from '@/lib/errors';
import { useActiveHome } from '@/store/home';
import { Button } from './Button';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { Input } from './Input';
import { Pressable } from './Pressable';
import { Sheet } from './Sheet';
import { Text } from './Text';
import { color, radius, space } from './tokens';

export const HOME_EMOJI = ['🏠', '🏡', '🏢', '🏖️', '🛋️', '🌴', '⛺', '🏰'];

/** Switch between homes, or create/join one, in a single sheet. */
export function HomeSwitcherSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: homes = [] } = useQuery({ queryKey: ['homes'], queryFn: api.homes });
  const { activeHomeId, setActiveHome } = useActiveHome();
  const [view, setView] = useState<'list' | 'create' | 'join'>('list');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(HOME_EMOJI[0]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!visible) { setView('list'); setError(null); } }, [visible]);

  const done = (homeId: string) => {
    qc.invalidateQueries({ queryKey: ['homes'] });
    setActiveHome(homeId);
    setName(''); setEmoji(HOME_EMOJI[0]); setCode('');
    onClose();
  };

  const create = useMutation({
    mutationFn: () => api.createHome({ name: name.trim(), emoji }),
    onSuccess: (h) => done(h.id),
    onError: (e) => setError(friendlyError(e, 'generic')),
  });
  const join = useMutation({
    mutationFn: () => api.joinHome(code.trim().toUpperCase()),
    onSuccess: (h) => done(h.id),
    onError: () => setError('Check the 6-character code and try again.'),
  });

  const title = view === 'list' ? 'Your homes' : view === 'create' ? 'Create a home' : 'Join a home';

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {view === 'list' ? (
        <View style={{ gap: space(3) }}>
          <ScrollView style={{ maxHeight: 300 }} contentContainerStyle={{ gap: space(2) }}>
            {homes.map((h) => {
              const selected = h.id === activeHomeId;
              return (
                <Pressable
                  key={h.id}
                  accessibilityState={{ selected }}
                  onPress={() => { setActiveHome(h.id); onClose(); }}
                  style={[s.home, selected && s.homeOn]}
                >
                  <View style={s.emoji}><Text variant="title">{h.emoji}</Text></View>
                  <Text variant="headline" style={{ flex: 1 }}>{h.name}</Text>
                  {selected ? <Icon name="check" size={20} tint={color.accent} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: space(2) }}>
            <Button title="Create home" icon="add" variant="secondary" size="sm" onPress={() => setView('create')} style={{ flex: 1 }} />
            <Button title="Join with code" variant="secondary" size="sm" onPress={() => setView('join')} style={{ flex: 1 }} />
          </View>
        </View>
      ) : view === 'create' ? (
        <View style={{ gap: space(3) }}>
          <Text tone="muted">Pick an icon and a name for this household.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
            {HOME_EMOJI.map((e) => <Chip key={e} label={e} selected={emoji === e} onPress={() => setEmoji(e)} />)}
          </ScrollView>
          <Input label="Home name" placeholder="e.g. Bangalore Flat, Mom's House" value={name} onChangeText={setName} error={error} />
          <Button title="Create home" fullWidth loading={create.isPending} onPress={() => { setError(null); if (name.trim()) create.mutate(); }} />
          <Button title="Back" variant="ghost" onPress={() => setView('list')} />
        </View>
      ) : (
        <View style={{ gap: space(3) }}>
          <Text tone="muted">Ask someone in the household for their 6-character invite code.</Text>
          <Input label="Invite code" variant="code" placeholder="7X3K9M" value={code} onChangeText={setCode} error={error} />
          <Button title="Join home" fullWidth loading={join.isPending} onPress={() => { setError(null); if (code.trim().length === 6) join.mutate(); }} />
          <Button title="Back" variant="ghost" onPress={() => setView('list')} />
        </View>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  home: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(3), borderRadius: radius.lg, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface },
  homeOn: { borderColor: color.accent, backgroundColor: color.accentSoft },
  emoji: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' },
});
