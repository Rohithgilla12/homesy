import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { color, motion } from '../tokens';

/**
 * Wraps a row that arrived live from another member: rises in, then a blue tint dissolves (MotionLive prototype).
 * The rise is a shared value rather than an `entering` animation: list rows already mount with one, and a nested
 * entering animation never leaves its start state on Fabric, which left the row invisible.
 */
export function LiveRow({ fresh, children }: { fresh: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  const rise = useSharedValue(fresh && !reduce ? 0 : 1);
  const glow = useSharedValue(fresh ? 1 : 0);

  useEffect(() => {
    if (!fresh) return;
    rise.value = withTiming(1, { duration: 220, easing: motion.easeOut });
    glow.value = withDelay(220, withTiming(0, { duration: 1500 }));
  }, [fresh]);

  const riseStyle = useAnimatedStyle(() => ({ opacity: rise.value, transform: [{ translateY: 6 * (1 - rise.value) }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  if (!fresh) return <View>{children}</View>;

  return (
    <Animated.View style={riseStyle}>
      {children}
      {/* Above the row, because swipeable rows paint an opaque surface; multiply keeps the text black under the tint. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color.accentSoft, mixBlendMode: 'multiply' }, glowStyle]} />
    </Animated.View>
  );
}
