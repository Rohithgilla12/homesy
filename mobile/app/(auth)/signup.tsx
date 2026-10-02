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

export default function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const signIn = useSession((s) => s.signIn);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    const cleanName = name.trim();
    const cleanEmail = email.trim();

    if (!cleanName) {
      Alert.alert('Name required', 'Please enter your name.');
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      Alert.alert('Valid email required', 'Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Password too short', 'Password must be at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      const { token, user } = await api.signup({
        email: cleanEmail,
        password,
        display_name: cleanName,
      });
      await signIn(token, user);
      router.replace('/');
    } catch (e: any) {
      Alert.alert('Could not sign up', e.message || 'Something went wrong.');
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
            <Title>Create account</Title>
            <Muted>Join Homesy to organize every household you belong to.</Muted>
          </View>

          <Input
            placeholder="Your name (e.g. Rohith)"
            value={name}
            onChangeText={setName}
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
          <Input
            ref={emailRef}
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
            placeholder="Password (8+ characters)"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={password}
            onChangeText={setPassword}
            returnKeyType="done"
            onSubmitEditing={submit}
          />

          <Button title="Create account" onPress={submit} loading={busy} />

          <Link href="/login" style={{ marginTop: space(2), textAlign: 'center' }}>
            <Muted>Already have an account? Sign in</Muted>
          </Link>
        </ScrollView>
      </Screen>
    </KeyboardAvoidingView>
  );
}
