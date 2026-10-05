// errors.ts
type Context = 'signin' | 'signup' | 'generic';

export function friendlyError(err: unknown, context: Context): string {
  if (err instanceof TypeError) return "Can't reach Homesy. Check your connection.";
  const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : NaN;
  const message = err instanceof Error ? err.message : '';
  if (status === 401 && context === 'signin') return 'Wrong email or password';
  if (status === 409 && context === 'signup') return 'An account with this email already exists';
  if (status >= 500) return 'Something went wrong on our side. Try again.';
  if (message) return message;
  return 'Something went wrong.';
}
