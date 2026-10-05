import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { Text, type TextVariant } from '../Text';
import { color, motion } from '../tokens';

/** Text whose strike-through sweeps left to right once it is struck (MotionCheck prototype). */
export function StrikeText({ children, struck, variant = 'headline' }: { children: string; struck: boolean; variant?: TextVariant }) {
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  const p = useSharedValue(struck ? 1 : 0);

  useEffect(() => {
    const to = struck ? 1 : 0;
    p.value = reduce ? to : withDelay(struck ? 120 : 0, withTiming(to, { duration: 160, easing: motion.easeOut }));
  }, [struck]);

  const line = useAnimatedStyle(() => ({ transform: [{ scaleX: p.value }] }));

  return (
    <View style={s.wrap}>
      <Text variant={variant} tone={struck ? 'muted' : 'ink'} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>{children}</Text>
      <Animated.View pointerEvents="none" style={[s.line, { width }, line]} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignSelf: 'flex-start', justifyContent: 'center' },
  line: { position: 'absolute', left: 0, height: 1.5, borderRadius: 1, backgroundColor: color.muted, transformOrigin: 'left' },
});
