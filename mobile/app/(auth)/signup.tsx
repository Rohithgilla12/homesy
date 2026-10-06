import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import type { TextInput } from 'react-native';
import { api } from '@/api/client';
import { friendlyError } from '@/lib/errors';
import { useSession } from '@/store/session';
import { AuthShell, Button, Input, Text, space } from '@/ui';

export default function Signup() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = useSession((s) => s.signIn);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  async function submit() {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName) return setError('Please enter your name.');
    if (!cleanEmail || !cleanEmail.includes('@')) return setError('Please enter a valid email address.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    setError(null);
    setBusy(true);
    try {
      const { token, user } = await api.signup({ email: cleanEmail, password, display_name: cleanName });
      await signIn(token, user);
    } catch (e) {
      setError(friendlyError(e, 'signup'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create account" subtitle="Join Homesy to organise every household you belong to.">
      <Input label="Your name" placeholder="e.g. Rohith" value={name} onChangeText={setName} autoComplete="name" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} />
      <Input
        ref={emailRef}
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
        autoComplete="new-password"
        returnKeyType="done"
        onSubmitEditing={submit}
      />
      {error ? <Text variant="label" tone="danger">{error}</Text> : null}
      <Button title="Create account" onPress={submit} loading={busy} fullWidth style={{ marginTop: space(2) }} />
      <Text tone="muted" style={{ textAlign: 'center', marginTop: space(2) }}>
        Already have an account?{' '}
        <Link href="/login" asChild>
          <Text tone="accentInk" style={{ textDecorationLine: 'none' }}>Sign in</Text>
        </Link>
      </Text>
    </AuthShell>
  );
}
