import { Pressable as RNPressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { motion } from './tokens';

const APressable = Animated.createAnimatedComponent(RNPressable);

export function Pressable({ style, onPressIn, onPressOut, hitSlop = 8, accessibilityRole = 'button', ...p }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <APressable
      {...p}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      onPressIn={(e) => { if (!reduce) s.value = withTiming(motion.press.scale, { duration: motion.press.duration, easing: motion.press.easing }); onPressIn?.(e); }}
      onPressOut={(e) => { s.value = withTiming(1, { duration: motion.press.duration, easing: motion.press.easing }); onPressOut?.(e); }}
      style={[style, anim]}
    />
  );
}
