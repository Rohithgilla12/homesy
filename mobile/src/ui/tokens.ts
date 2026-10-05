import { Easing } from 'react-native-reanimated';

export const color = {
  bg: '#F6F5F1', surface: '#FFFFFF', surfaceSunk: '#F0EEE8', ink: '#15171C', ink2: '#3B3F47', muted: '#5F646E',
  line: '#E6E3DC', lineStrong: '#A8ACB4', accent: '#2747C9', accentSoft: '#E9EDFB', accentInk: '#1F3AA8', scrim: 'rgba(21,23,28,0.4)', onAccent: '#FFFFFF',
} as const;

export const status = {
  warn: '#A14B07', warnSoft: '#FDF1DC', warnInk: '#7A3A06',
  ok: '#157F3C', okSoft: '#E3F6E9', okInk: '#11652F',
  danger: '#B42318', dangerSoft: '#FDE7E5', dangerInk: '#7E1910',
} as const;

type Tint = { bg: string; fg: string };
export const category: {
  list: Record<'grocery' | 'laundry' | 'todo' | 'custom', Tint>;
  bill: Record<'electricity' | 'internet' | 'water' | 'gas' | 'maintenance' | 'maid' | 'other', Tint>;
  vault: Record<'utilities' | 'contacts' | 'access' | 'documents' | 'other' | 'wifi', Tint>;
} = {
  list: {
    grocery: { bg: '#E9EDFB', fg: '#2747C9' }, laundry: { bg: '#EEF4F1', fg: '#2F6B57' },
    todo: { bg: '#F3EEFB', fg: '#6B3FC4' }, custom: { bg: '#FDF1DC', fg: '#A14B07' },
  },
  bill: {
    electricity: { bg: '#FDF1DC', fg: '#A14B07' }, internet: { bg: '#E7EFFA', fg: '#245C9E' }, water: { bg: '#E2F3F6', fg: '#0F6A7A' },
    gas: { bg: '#FCE9E4', fg: '#A3381B' }, maintenance: { bg: '#F3EEFB', fg: '#6B3FC4' }, maid: { bg: '#FBEAF3', fg: '#9C2F6A' },
    other: { bg: '#F0EEE8', fg: '#3B3F47' },
  },
  vault: {
    utilities: { bg: '#FDF1DC', fg: '#A14B07' }, contacts: { bg: '#EEF4F1', fg: '#2F6B57' }, access: { bg: '#FDF1DC', fg: '#8A4307' },
    documents: { bg: '#E9EDFB', fg: '#1F3AA8' }, other: { bg: '#F0EEE8', fg: '#3B3F47' }, wifi: { bg: '#E9EDFB', fg: '#2747C9' },
  },
};

export const font = {
  display: 'BricolageGrotesque_700Bold',
  regular: 'Geist_400Regular', medium: 'Geist_500Medium', semibold: 'Geist_600SemiBold',
  mono: 'GeistMono_500Medium',
} as const;

export const type = {
  display: { fontFamily: font.display, fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  title: { fontFamily: font.display, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  headline: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: font.regular, fontSize: 15, lineHeight: 22 },
  label: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: font.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.48, textTransform: 'uppercase' as const },
  mono: { fontFamily: font.mono, fontSize: 15, lineHeight: 22 },
} as const;

export const space = (n: number) => n * 4;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, full: 999 } as const;

export const motion = {
  press: { scale: 0.97, duration: 160, easing: Easing.bezier(0.23, 1, 0.32, 1) },
  sheetIn: { duration: 320, easing: Easing.bezier(0.32, 0.72, 0, 1) },
  sheetOut: { duration: 200, easing: Easing.bezier(0.32, 0.72, 0, 1) },
  fade: { duration: 180 },
  spring: { damping: 14, stiffness: 220 },
  easeOut: Easing.bezier(0.23, 1, 0.32, 1),
} as const;
