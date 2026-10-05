import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  interpolateColor, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { haptic } from '../haptics';
import { Pressable } from '../Pressable';
import { color, motion } from '../tokens';

const APath = Animated.createAnimatedComponent(Path);
const CHECK_LEN = 21; // length of "m5 12 5 5 9-10" in the 24 viewBox

/** Tick circle: fills with a spring pop, then the check stroke draws itself (MotionCheck prototype). */
export function AnimatedCheck({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
  const reduce = useReducedMotion();
  const fill = useSharedValue(checked ? 1 : 0);
  const scale = useSharedValue(1);
  const draw = useSharedValue(checked ? 0 : CHECK_LEN);

  useEffect(() => {
    if (checked) {
      fill.value = withTiming(1, { duration: 120 });
      if (!reduce) scale.value = withSequence(withTiming(0.78, { duration: 0 }), withSpring(1, motion.spring));
      draw.value = reduce ? 0 : withDelay(60, withTiming(0, { duration: 180, easing: motion.easeOut }));
    } else {
      fill.value = withTiming(0, { duration: 120 });
      draw.value = CHECK_LEN;
    }
  }, [checked]);

  const circle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(fill.value, [0, 1], [color.surface, color.accent]),
    borderColor: interpolateColor(fill.value, [0, 1], [color.lineStrong, color.accent]),
    transform: [{ scale: scale.value }],
  }));
  const stroke = useAnimatedProps(() => ({ strokeDashoffset: draw.value }));

  return (
    <Pressable
      onPress={() => { if (!checked) haptic.light(); onPress(); }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={s.hit}
    >
      <Animated.View style={[s.circle, circle]}>
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <APath d="m5 12 5 5 9-10" fill="none" stroke={color.onAccent} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={CHECK_LEN} animatedProps={stroke} />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  hit: { padding: 9, margin: -9 },
  circle: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.75, alignItems: 'center', justifyContent: 'center' },
});
