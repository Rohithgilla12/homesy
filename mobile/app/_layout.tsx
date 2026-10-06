import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { Redirect, Slot, usePathname } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFeatures } from '@/store/features';
import { usePendingLink } from '@/store/pendingLink';
import { useActiveHome } from '@/store/home';
import { useSession } from '@/store/session';
import { ColdStart } from '@/ui/motion';
import { color } from '@/ui/tokens';

// Keep the native splash up until the session and fonts are ready, so nothing paints in a fallback font.
SplashScreen.preventAutoHideAsync().catch(() => {});
// The roof-drawing flourish plays once per process, not on every remount.
let coldStartPlayed = false;

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

  const [fontsLoaded, fontError] = useFonts({ BricolageGrotesque_700Bold, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_500Medium });
  const ready = hydrated && (fontsLoaded || !!fontError);
  const [showColdStart, setShowColdStart] = useState(!coldStartPlayed);

  useEffect(() => { hydrate(); hydrateHome(); useFeatures.getState().load(); }, []);
  useEffect(() => { if (fontError) console.warn('font load failed', fontError); }, [fontError]);
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);

  if (!ready) return null;
  const inAuth = path.startsWith('/login') || path.startsWith('/signup');
  if (!token && !inAuth) {
    usePendingLink.getState().remember(path);
    return <Redirect href="/login" />;
  }
  if (token && inAuth) return <Redirect href="/" />;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={qc}>
          <StatusBar style="dark" />
          <Slot />
          {showColdStart ? <ColdStart onDone={() => { coldStartPlayed = true; setShowColdStart(false); }} /> : null}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
