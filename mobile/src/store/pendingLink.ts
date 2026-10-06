import { create } from 'zustand';
import { postAuthTarget } from '@/lib/links';

/**
 * A deep link opened while signed out (an invite, a list). The root layout records it before redirecting
 * to sign in, and the auth screens consume it so the person lands where the link pointed.
 */
export const usePendingLink = create<{ path: string | null; remember: (path: string) => void; consume: () => string }>((set, get) => ({
  path: null,
  remember: (path) => set({ path: postAuthTarget(path) }),
  consume: () => {
    const target = get().path ?? '/';
    set({ path: null });
    return target;
  },
}));
