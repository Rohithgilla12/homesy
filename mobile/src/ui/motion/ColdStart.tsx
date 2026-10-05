import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { color, motion } from '../tokens';

const APath = Animated.createAnimatedComponent(Path);
const ROOF_LEN = 23.5;

/** Cold-start flourish: the house roof draws, then the overlay fades into the app (≤ 600 ms). */
export function ColdStart({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  const draw = useSharedValue(ROOF_LEN);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (reduce) { onDone(); return; }
    draw.value = withTiming(0, { duration: 400, easing: motion.easeOut });
    fade.value = withDelay(400, withTiming(0, { duration: 200 }, (finished) => { if (finished) scheduleOnRN(onDone); }));
  }, []);

  const roof = useAnimatedProps(() => ({ strokeDashoffset: draw.value }));
  const overlay = useAnimatedStyle(() => ({ opacity: fade.value }));
  if (reduce) return null;

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.overlay, overlay]}>
      <Svg width={72} height={72} viewBox="0 0 24 24">
        <APath d="M3 10.5 12 3l9 7.5" fill="none" stroke={color.accent} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={ROOF_LEN} animatedProps={roof} />
        <Path d="M5 9.5V21h14V9.5" fill="none" stroke={color.accent} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M10 21v-6h4v6" fill="none" stroke={color.accent} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  overlay: { backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center', zIndex: 100 },
});
