import { useEffect, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { color, motion } from '../tokens';

/**
 * Wraps a row that arrived live from another member: rises in, then a blue tint dissolves (MotionLive prototype).
 * The element tree is the same whether or not the row is fresh, so flipping `fresh` never remounts the children
 * (which would cut the glow and reset an in-flight tick). The rise is a shared value rather than an `entering`
 * animation: list rows already mount with one, and a nested entering animation never leaves its start state.
 */
export function LiveRow({ fresh, children }: { fresh: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  const rise = useSharedValue(1);
  const glow = useSharedValue(0);

  // `fresh` usually flips on after the row has rendered once, so the start states are set here, not at mount.
  useEffect(() => {
    if (!fresh) return;
    if (!reduce) { rise.value = 0; rise.value = withTiming(1, { duration: 220, easing: motion.easeOut }); }
    glow.value = 1;
    glow.value = withDelay(220, withTiming(0, { duration: 1500 }));
  }, [fresh]);

  const riseStyle = useAnimatedStyle(() => ({ opacity: rise.value, transform: [{ translateY: 6 * (1 - rise.value) }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View style={riseStyle}>
      {children}
      {/* Above the row, because swipeable rows paint an opaque surface; multiply keeps the text black under the tint. */}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color.accentSoft, mixBlendMode: 'multiply' }, glowStyle]} />
    </Animated.View>
  );
}
