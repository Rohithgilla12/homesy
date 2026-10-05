import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { haptic } from '../haptics';
import { Icon } from '../Icon';
import { Text } from '../Text';
import { color, motion, radius, space, status } from '../tokens';

/** The official "paid" seal: shield springs in, one ring pulse, text rises (MotionPaid prototype). */
export function PaidStamp({ by, when, refText }: { by: string; when: string; refText?: string | null }) {
  const reduce = useReducedMotion();
  const seal = useSharedValue(reduce ? 1 : 0);
  const ring = useSharedValue(0);
  const text = useSharedValue(reduce ? 1 : 0);

  useEffect(() => {
    haptic.success();
    if (reduce) return;
    seal.value = withSpring(1, motion.spring);
    ring.value = withDelay(140, withTiming(1, { duration: 650, easing: motion.easeOut }));
    text.value = withDelay(160, withTiming(1, { duration: 260, easing: motion.easeOut }));
  }, []);

  const sealStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, seal.value * 1.5),
    transform: [{ scale: 0.4 + 0.6 * seal.value }, { rotate: `${-14 * (1 - seal.value)}deg` }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: reduce ? 0 : 0.7 * (1 - ring.value),
    transform: [{ scale: 0.7 + 1.2 * ring.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({ opacity: text.value, transform: [{ translateY: 5 * (1 - text.value) }] }));

  return (
    <View style={s.box} accessible accessibilityLabel={`Paid by ${by}, ${when}. Don't pay again.`}>
      <View style={s.seal}>
        <Animated.View style={[s.ring, ringStyle]} />
        <Animated.View style={sealStyle}><Icon name="paid" size={22} tint={status.ok} /></Animated.View>
      </View>
      <Animated.View style={[s.copy, textStyle]}>
        <Text variant="headline" tone="ok">Paid — don't pay again</Text>
        <Text variant="label" tone="ok">{[by, when, refText].filter(Boolean).join(' · ')}</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: status.okSoft, borderRadius: radius.md, padding: space(3), flexDirection: 'row', alignItems: 'center', gap: space(3) },
  seal: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: status.ok },
  copy: { flex: 1 },
});
