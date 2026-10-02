import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { api } from '@/api/client';
import { useSession } from '@/store/session';
import { Button, Input, Muted, Screen, Title } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const signIn = useSession((s) => s.signIn);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      Alert.alert('Email required', 'Please enter your email address.');
      return;
    }
    if (!password) {
      Alert.alert('Password required', 'Please enter your password.');
      return;
    }

    setBusy(true);
    try {
      const { token, user } = await api.login({ email: cleanEmail, password });
      await signIn(token, user);
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Could not sign in', e.message || 'Invalid credentials.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <Screen style={{ justifyContent: 'center' }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ marginBottom: space(3) }}>
            <Title>Homesy</Title>
            <Muted>Every home you belong to, in one place.</Muted>
          </View>

          <Input
            placeholder="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <Input
            ref={passwordRef}
            placeholder="Password"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={password}
            onChangeText={setPassword}
            returnKeyType="done"
            onSubmitEditing={submit}
          />

          <Button title="Sign in" onPress={submit} loading={busy} />

          <Link href="/signup" style={{ marginTop: space(2), textAlign: 'center' }}>
            <Muted>New here? Create an account</Muted>
          </Link>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
