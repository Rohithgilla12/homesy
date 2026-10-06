import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import { friendlyError } from '@/lib/errors';
import { joinCodeFrom } from '@/lib/links';
import { useActiveHome } from '@/store/home';
import { Button, Card, Icon, Text, color, space } from '@/ui';

/** Target of homesy://join/<CODE>: confirms before joining, since a link can come from anyone. */
export default function JoinFromLink() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = joinCodeFrom(params.code);
  const qc = useQueryClient();
  const setActiveHome = useActiveHome((s) => s.setActiveHome);
  const [error, setError] = useState<string | null>(null);

  const join = useMutation({
    mutationFn: () => api.joinHome(code!),
    onSuccess: (h) => {
      setActiveHome(h.id);
      qc.invalidateQueries({ queryKey: ['homes'] });
      router.replace('/home');
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 404 ? 'That invite code no longer works.' : friendlyError(e, 'generic')),
  });
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <View style={s.body}>
        <View style={s.mark}><Icon name="tab.home" size={28} tint={color.onAccent} /></View>
        {code ? (
          <>
            <Text variant="display" style={{ marginTop: space(5) }}>Join a home</Text>
            <Text tone="muted" style={{ marginTop: space(2) }}>Someone shared an invite with you. Joining shows you their lists, bills and vault.</Text>
            <Card style={{ marginTop: space(6), alignItems: 'center', gap: space(1) }}>
              <Text variant="caption" tone="muted">Invite code</Text>
              <Text variant="mono" color={color.accentInk} style={{ fontSize: 28, lineHeight: 34, letterSpacing: 6 }}>{code}</Text>
            </Card>
            {error ? <Text variant="label" tone="danger" style={{ marginTop: space(3) }}>{error}</Text> : null}
            <View style={{ gap: space(3), marginTop: space(6) }}>
              <Button title="Join home" fullWidth loading={join.isPending} onPress={() => { setError(null); join.mutate(); }} />
              <Button title="Not now" variant="ghost" fullWidth onPress={leave} />
            </View>
          </>
        ) : (
          <>
            <Text variant="display" style={{ marginTop: space(5) }}>This link doesn't work</Text>
            <Text tone="muted" style={{ marginTop: space(2) }}>Invite codes are 6 letters and numbers. Ask for a fresh invite, or type the code on the Home tab.</Text>
            <Button title="Go to Homesy" fullWidth onPress={() => router.replace('/')} style={{ marginTop: space(6) }} />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  body: { flex: 1, justifyContent: 'center', padding: space(6) },
  mark: { width: 56, height: 56, borderRadius: 16, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center' },
});
