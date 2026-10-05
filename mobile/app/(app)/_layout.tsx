import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import { useHomeEvents } from '@/api/events';
import { useActiveHome } from '@/store/home';
import { color, font } from '@/ui/tokens';
import Onboarding from './(tabs)/home';

export default function AppLayout() {
  const { data: homes, isLoading } = useQuery({ queryKey: ['homes'], queryFn: api.homes });
  const activeHomeId = useActiveHome((s) => s.activeHomeId);

  // Realtime SSE sync: invalidates caches on changes while viewing active home
  useHomeEvents(activeHomeId);

  if (isLoading) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: color.bg }}><ActivityIndicator color={color.accent} /></View>;
  // No homes yet → the Home screen doubles as onboarding (create or join). It renders without a
  // header or tab bar, so it needs its own safe-area padding.
  if (homes && homes.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }} edges={['top', 'bottom']}>
        <Onboarding />
      </SafeAreaView>
    );
  }

  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: color.bg }, headerShadowVisible: false, headerTintColor: color.accentInk, headerTitleStyle: { fontFamily: font.semibold, color: color.ink } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="lists/[id]" options={{ headerBackTitle: 'Lists' }} />
    </Stack>
  );
}

