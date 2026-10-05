import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { color, font, radius, space, status, type as typo } from './tokens';

type Layout = Pick<ViewStyle, 'flex' | 'marginTop' | 'marginBottom' | 'alignSelf'>;

/**
 * Labelled text field. Callers cannot pass `style`, so the base look can't be replaced
 * (the old Input spread caller props after its own style and lost the border on six fields).
 */
export const Input = forwardRef<TextInput, Omit<TextInputProps, 'style'> & {
  label: string;
  error?: string | null;
  hint?: string;
  variant?: 'default' | 'code';
  containerStyle?: Layout;
}>(function Input({ label, error, hint, variant = 'default', containerStyle, onFocus, onBlur, ...p }, ref) {
  const [focused, setFocused] = useState(false);
  const code = variant === 'code';
  return (
    <View style={[s.wrap, containerStyle]}>
      <Text variant="label" tone="ink2">{label}</Text>
      <View style={[s.halo, focused && s.haloOn, !!error && s.haloError]}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={color.muted}
          {...(code ? { autoCapitalize: 'characters' as const, autoCorrect: false, maxLength: 6 } : null)}
          {...p}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={[s.field, code && s.code, focused && s.fieldOn, !!error && s.fieldError, p.multiline && s.multiline]}
        />
      </View>
      {error ? <Text variant="label" tone="danger">{error}</Text> : hint ? <Text variant="label" tone="muted">{hint}</Text> : null}
    </View>
  );
});

const s = StyleSheet.create({
  wrap: { gap: space(1.5) },
  halo: { borderRadius: radius.md + 3, borderWidth: 3, borderColor: 'transparent', margin: -3 },
  haloOn: { borderColor: color.accentSoft },
  haloError: { borderColor: status.dangerSoft },
  field: {
    ...typo.body,
    fontSize: 16,
    color: color.ink,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.md,
    paddingVertical: space(3),
    paddingHorizontal: 14,
    minHeight: 48,
  },
  fieldOn: { borderColor: color.accent },
  fieldError: { borderColor: status.danger },
  code: { fontFamily: font.mono, fontSize: 22, lineHeight: 28, letterSpacing: 4, textAlign: 'center' },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
});
