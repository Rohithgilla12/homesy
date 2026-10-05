import { useRef } from 'react';
import { Image, StyleSheet, type StyleProp, type ImageStyle } from 'react-native';
import { color, radius } from './tokens';

/** Wide photo strip (home cover). A load error means the presigned URL expired: `onExpired` fires once per mount. */
export function CoverImage({ uri, onExpired, style }: { uri: string; onExpired?: () => void; style?: StyleProp<ImageStyle> }) {
  const refreshed = useRef(false);
  return (
    <Image
      testID="cover-image"
      source={{ uri }}
      accessibilityLabel="Home cover photo"
      style={[s.cover, style]}
      onError={() => {
        if (refreshed.current) return;
        refreshed.current = true;
        onExpired?.();
      }}
    />
  );
}

const s = StyleSheet.create({
  cover: { height: 140, borderRadius: radius.lg, backgroundColor: color.surfaceSunk },
});
