import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { color, status, type as typo } from './tokens';

const tones = {
  ink: color.ink, ink2: color.ink2, muted: color.muted, accent: color.accent, accentInk: color.accentInk,
  warn: status.warnInk, ok: status.okInk, danger: status.danger, onAccent: color.onAccent,
} as const;
type Layout = Pick<TextStyle, 'margin' | 'marginTop' | 'marginBottom' | 'marginLeft' | 'marginRight' | 'marginHorizontal' | 'marginVertical' | 'textAlign' | 'flex' | 'flexShrink' | 'alignSelf' | 'textDecorationLine' | 'fontVariant' | 'letterSpacing' | 'fontSize' | 'lineHeight'>;

export type TextVariant = keyof typeof typo;
/** `color` overrides `tone` for tinted surfaces (pills, category tiles); pass a token value, never a literal. */
export function Text({ variant = 'body', tone = 'ink', color, style, ...p }: Omit<TextProps, 'style'> & { variant?: TextVariant; tone?: keyof typeof tones; color?: string; style?: Layout }) {
  return <RNText {...p} style={[typo[variant], { color: color ?? tones[tone] }, style]} />;
}
