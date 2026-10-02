import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { Redirect, Slot, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useActiveHome } from '@/store/home';
import { useSession } from '@/store/session';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      retry: 1,
    },
  },
});

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'HOMESY_QUERY_CACHE',
});

persistQueryClient({
  queryClient: qc,
  persister: asyncStoragePersister,
  maxAge: 1000 * 60 * 60 * 24, // 24 hours
});

export default function Root() {
  const { hydrated, hydrate, token } = useSession();
  const hydrateHome = useActiveHome((s) => s.hydrate);
  const path = usePathname();

  useEffect(() => { hydrate(); hydrateHome(); }, []);

  if (!hydrated) {
    return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  }
  const inAuth = path.startsWith('/login') || path.startsWith('/signup');
  if (!token && !inAuth) return <Redirect href="/login" />;
  if (token && inAuth) return <Redirect href="/" />;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <StatusBar style="dark" />
        <Slot />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
