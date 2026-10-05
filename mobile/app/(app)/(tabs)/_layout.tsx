import { Tabs } from 'expo-router';
import { AppHeader, TabBar } from '@/ui';

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ header: () => <AppHeader /> }}>
      <Tabs.Screen name="index" options={{ title: 'Lists' }} />
      <Tabs.Screen name="bills" options={{ title: 'Bills' }} />
      <Tabs.Screen name="vault" options={{ title: 'Vault' }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity' }} />
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
    </Tabs>
  );
}
