import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { api } from '@/api/client';
import { useHomeEvents } from '@/api/events';
import { useActiveHome } from '@/store/home';
import { colors } from '@/ui/theme';
import Onboarding from './(tabs)/home';

export default function AppLayout() {
  const { data: homes, isLoading } = useQuery({ queryKey: ['homes'], queryFn: api.homes });
  const activeHomeId = useActiveHome((s) => s.activeHomeId);

  // Realtime SSE sync: invalidates caches on changes while viewing active home
  useHomeEvents(activeHomeId);

  if (isLoading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  // No homes yet → the Home screen doubles as onboarding (create or join).
  if (homes && homes.length === 0) return <Onboarding />;

  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false, headerTintColor: colors.accent }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="lists/[id]" options={{ headerBackTitle: 'Lists' }} />
    </Stack>
  );
}

