import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { color } from '../tokens';

/** Wraps a row that arrived live from another member: rises in, then a blue tint dissolves (MotionLive prototype). */
export function LiveRow({ fresh, children }: { fresh: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  const glow = useSharedValue(fresh ? 1 : 0);

  useEffect(() => {
    if (fresh) glow.value = withDelay(220, withTiming(0, { duration: 1500 }));
  }, [fresh]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  if (!fresh) return <View>{children}</View>;

  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.duration(220)}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color.accentSoft }, glowStyle]} />
      {children}
    </Animated.View>
  );
}
