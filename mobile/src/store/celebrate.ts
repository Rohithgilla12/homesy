import { create } from 'zustand';

/**
 * App-wide celebration signal. The confetti overlay lives in the app layout so a burst survives the
 * screen that triggered it unmounting (creating the first home swaps onboarding for the tabs).
 */
type Celebrate = { count: number; fire: () => void };

export const useCelebrate = create<Celebrate>((set) => ({
  count: 0,
  fire: () => set((s) => ({ count: s.count + 1 })),
}));
