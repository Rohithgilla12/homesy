import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import { useHomeEvents } from '@/api/events';
import { useCelebrate } from '@/store/celebrate';
import { useActiveHome } from '@/store/home';
import { Confetti } from '@/ui/motion/Confetti';
import { color, font } from '@/ui/tokens';
import Onboarding from './(tabs)/home';

export default function AppLayout() {
  const { data: homes, isLoading } = useQuery({ queryKey: ['homes'], queryFn: api.homes });
  const activeHomeId = useActiveHome((s) => s.activeHomeId);
  const celebrate = useCelebrate((s) => s.count);

  // Realtime SSE sync: invalidates caches on changes while viewing active home
  useHomeEvents(activeHomeId);

  // The confetti overlay is a sibling of both branches so it never remounts when onboarding hands over to the
  // tabs, and a burst fired on the last onboarding frame still plays out.
  let body;
  if (isLoading) {
    body = <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator color={color.accent} /></View>;
  } else if (homes && homes.length === 0) {
    // No homes yet → the Home screen doubles as onboarding (create or join). It renders without a
    // header or tab bar, so it needs its own safe-area padding.
    body = (
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <Onboarding />
      </SafeAreaView>
    );
  } else {
    body = (
      <Stack screenOptions={{ headerStyle: { backgroundColor: color.bg }, headerShadowVisible: false, headerTintColor: color.accentInk, headerTitleStyle: { fontFamily: font.semibold, color: color.ink } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="lists/[id]" options={{ headerBackTitle: 'Lists' }} />
      </Stack>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      {body}
      <Confetti fire={celebrate} />
    </View>
  );
}
