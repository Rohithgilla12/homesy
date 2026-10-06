import { Link, router } from 'expo-router';
import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { api } from '@/api/client';
import { friendlyError } from '@/lib/errors';
import { usePendingLink } from '@/store/pendingLink';
import { useSession } from '@/store/session';
import { AuthShell, Button, Input, Text, space } from '@/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = useSession((s) => s.signIn);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setError('Please enter your email address.');
    if (!password) return setError('Please enter your password.');
    setError(null);
    setBusy(true);
    try {
      const { token, user } = await api.login({ email: cleanEmail, password });
      await signIn(token, user);
      router.replace(usePendingLink.getState().consume() as never);
    } catch (e) {
      setError(friendlyError(e, 'signin'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Homesy" subtitle="Every home you belong to, in one place.">
      <Input
        label="Email"
        placeholder="you@example.com"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <Input
        ref={passwordRef}
        label="Password"
        placeholder="At least 8 characters"
        value={password}
        onChangeText={setPassword}
        secureToggle
        autoComplete="password"
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      {error ? <Text variant="label" tone="danger">{error}</Text> : null}
      <Button title="Sign in" onPress={submit} loading={busy} fullWidth style={{ marginTop: space(2) }} />
      <Text tone="muted" style={{ textAlign: 'center', marginTop: space(2) }}>
        New here?{' '}
        <Link href="/signup" asChild>
          <Text tone="accentInk" style={{ textDecorationLine: 'none' }}>Create an account</Text>
        </Link>
      </Text>
    </AuthShell>
  );
}
