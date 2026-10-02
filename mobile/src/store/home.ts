import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

/** Which home the user is "in" right now. Persisted so the app reopens where you left it. */
type ActiveHome = {
  activeHomeId: string | null;
  setActiveHome: (id: string | null) => void;
  hydrate: () => Promise<void>;
};

const KEY = 'homesy.activeHome';

export const useActiveHome = create<ActiveHome>((set) => ({
  activeHomeId: null,
  setActiveHome: (id) => {
    set({ activeHomeId: id });
    if (id) SecureStore.setItemAsync(KEY, id); else SecureStore.deleteItemAsync(KEY);
  },
  hydrate: async () => {
    const id = await SecureStore.getItemAsync(KEY);
    set({ activeHomeId: id });
  },
}));
