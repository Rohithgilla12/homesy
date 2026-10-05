import { BlurView } from 'expo-blur';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { haptic } from '../haptics';
import { Text } from '../Text';
import { color } from '../tokens';

/**
 * Secret value that un-blurs into view instead of swapping text (MotionReveal prototype). With `drainMs`,
 * a thin bar under the value drains over that time, showing when the value will mask itself again.
 */
export function BlurReveal({ secret, masked, revealed, drainMs }: { secret: string; masked: string; revealed: boolean; drainMs?: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(revealed ? 1 : 0);
  const drain = useSharedValue(revealed ? 1 : 0);

  useEffect(() => {
    if (revealed) haptic.selection();
    p.value = withTiming(revealed ? 1 : 0, { duration: reduce ? 120 : 200 });
    if (!drainMs) return;
    cancelAnimation(drain);
    drain.value = revealed ? 1 : 0;
    if (revealed) drain.value = withTiming(0, { duration: drainMs, easing: Easing.linear });
  }, [revealed]);
  const drainStyle = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ scaleX: drain.value }] }));

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
      {drainMs ? <Animated.View style={[s.drain, drainStyle]} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  stack: { alignSelf: 'flex-start', minWidth: 120 },
  drain: { height: 3, borderRadius: 2, backgroundColor: color.accent, marginTop: 2, transformOrigin: 'left' },
});
