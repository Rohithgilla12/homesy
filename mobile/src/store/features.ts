import { create } from 'zustand';
import { api } from '@/api/client';

/** Server capabilities fetched once per session; upload affordances stay hidden until the API says storage is on. */
export const useFeatures = create<{ attachments: boolean; loaded: boolean; load: () => Promise<void> }>((set) => ({
  attachments: false,
  loaded: false,
  load: async () => {
    try {
      const c = await api.config();
      set({ attachments: c.attachments, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
