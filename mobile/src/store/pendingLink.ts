import { create } from 'zustand';
import { postAuthTarget } from '@/lib/links';

/**
 * A deep link opened while signed out (an invite, a list). The root layout records it before redirecting to
 * sign in, and after sign-in redirects there instead of Lists. The root layout is the only place that
 * navigates on sign-in, so there is no race with the auth screens.
 */
export const usePendingLink = create<{ path: string | null; remember: (path: string) => void; target: () => string; clear: () => void }>((set, get) => ({
  path: null,
  remember: (path) => {
    const p = postAuthTarget(path);
    if (p) set({ path: p });
  },
  target: () => get().path ?? '/',
  clear: () => set({ path: null }),
}));
