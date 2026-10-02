import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import type { User } from '@/api/types';

type Session = {
  token: string | null;
  user: User | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
};

const KEY = 'homesy.session';

export const useSession = create<Session>((set) => ({
  token: null,
  user: null,
  hydrated: false,
  hydrate: async () => {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) {
      const { token, user } = JSON.parse(raw);
      set({ token, user });
    }
    set({ hydrated: true });
  },
  signIn: async (token, user) => {
    await SecureStore.setItemAsync(KEY, JSON.stringify({ token, user }));
    set({ token, user });
  },
  signOut: async () => {
    await SecureStore.deleteItemAsync(KEY);
    set({ token: null, user: null });
  },
}));
