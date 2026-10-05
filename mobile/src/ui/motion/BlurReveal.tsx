import { BlurView } from 'expo-blur';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { haptic } from '../haptics';
import { Text } from '../Text';
import { color } from '../tokens';

/** Secret value that un-blurs into view instead of swapping text (MotionReveal prototype). */
export function BlurReveal({ secret, masked, revealed }: { secret: string; masked: string; revealed: boolean }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(revealed ? 1 : 0);

  useEffect(() => {
    if (revealed) haptic.selection();
    p.value = withTiming(revealed ? 1 : 0, { duration: reduce ? 120 : 200 });
  }, [revealed]);

  const valueStyle = useAnimatedStyle(() => ({ opacity: p.value }));
  const maskStyle = useAnimatedStyle(() => ({ opacity: 1 - p.value }));
  const blurStyle = useAnimatedStyle(() => ({ opacity: reduce ? 0 : 1 - p.value }));

  return (
    <View style={s.stack} accessibilityLiveRegion="polite" accessibilityLabel={revealed ? secret : 'Hidden value'}>
      <Animated.View style={valueStyle}>
        <Text variant="mono" selectable>{secret}</Text>
      </Animated.View>
      {Platform.OS === 'ios' ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, blurStyle]}>
          <BlurView intensity={30} tint="light" style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, maskStyle]}>
        <Text variant="mono" color={color.accentInk} style={{ textAlign: 'left' }}>{masked}</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  stack: { alignSelf: 'flex-start', minWidth: 120 },
});
