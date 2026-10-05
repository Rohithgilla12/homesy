import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { color } from '@/ui';

// No header here, so nothing else keeps content clear of the status bar and home indicator.
export default function AuthLayout() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.bg }} edges={['top', 'bottom']}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />
    </SafeAreaView>
  );
}
