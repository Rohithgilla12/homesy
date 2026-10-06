import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { Stack, router } from 'expo-router';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
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

  const [fontsLoaded, fontError] = useFonts({ BricolageGrotesque_700Bold, Geist_400Regular, Geist_500Medium, Geist_600SemiBold, GeistMono_500Medium });
  const ready = hydrated && (fontsLoaded || !!fontError);
  const [showColdStart, setShowColdStart] = useState(!coldStartPlayed);

  useEffect(() => { hydrate(); hydrateHome(); useFeatures.getState().load(); }, []);
  useEffect(() => { if (fontError) console.warn('font load failed', fontError); }, [fontError]);
  useEffect(() => { if (ready) SplashScreen.hideAsync().catch(() => {}); }, [ready]);
  // A link opened while signed out is remembered from the URL itself: the router's pathname is mid-redirect at
  // that point (it reads "/join" without the code). Each URL is remembered once, so signing out later does not
  // replay an old invite.
  const url = Linking.useURL();
  const handledUrl = useRef<string | null>(null);
  useEffect(() => {
    if (!url || !hydrated || token || handledUrl.current === url) return;
    handledUrl.current = url;
    const { path: linkPath } = Linking.parse(url);
    if (linkPath) usePendingLink.getState().remember(`/${linkPath.replace(/^\/+/, '')}`);
  }, [url, hydrated, token]);

  // Just signed in with a remembered link: go there. Without one, the protected stack below lands on Lists.
  const wasSignedIn = useRef(!!token);
  useEffect(() => {
    const signedInNow = !!token;
    if (ready && signedInNow && !wasSignedIn.current && usePendingLink.getState().path) {
      const target = usePendingLink.getState().target();
      usePendingLink.getState().clear();
      router.replace(target as never);
    }
    wasSignedIn.current = signedInNow;
  }, [ready, token]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={qc}>
          <StatusBar style="dark" />
          {/* Auth is enforced by protected routes, so the root navigator stays mounted across sign-in and sign-out
              (returning a <Redirect> from here looped between /login and / when a deep link arrived signed out). */}
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
            <Stack.Protected guard={!!token}>
              <Stack.Screen name="(app)" />
            </Stack.Protected>
            <Stack.Protected guard={!token}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
          </Stack>
          {showColdStart ? <ColdStart onDone={() => { coldStartPlayed = true; setShowColdStart(false); }} /> : null}
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
