import { useEffect } from 'react';
import { RefreshControl, StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation, useAnimatedProps, useAnimatedReaction, useAnimatedScrollHandler, useAnimatedStyle, useReducedMotion, useSharedValue,
  withRepeat, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';
import { haptic } from '../haptics';
import { color } from '../tokens';

const APath = Animated.createAnimatedComponent(Path);
const THRESHOLD = 80;
const ROOF = { d: 'M3 10.5 12 3l9 7.5', len: 23.5, from: 0, to: 0.45 };
const WALLS = { d: 'M5 9.5V21h14V9.5', len: 37, from: 0.3, to: 0.75 };
const DOOR = { d: 'M10 21v-6h4v6', len: 16, from: 0.65, to: 0.95 };

function segment(progress: number, from: number, to: number) {
  'worklet';
  return Math.max(0, Math.min(1, (progress - from) / (to - from)));
}

/**
 * Branded pull-to-refresh: the house mark draws itself as you pull and breathes while loading
 * (MotionPull prototype). Native RefreshControl supplies the mechanics with its spinner hidden.
 */
export function useRoofRefresh({ refreshing, onRefresh }: { refreshing: boolean; onRefresh: () => void }) {
  const reduce = useReducedMotion();
  const pull = useSharedValue(0);
  const armed = useSharedValue(false);
  const breathe = useSharedValue(1);

  const onScroll = useAnimatedScrollHandler((e) => {
    pull.value = Math.max(0, -e.contentOffset.y) / THRESHOLD;
  });

  useAnimatedReaction(() => pull.value >= 0.7, (isArmed, was) => {
    if (isArmed && !was && !armed.value) { armed.value = true; scheduleOnRN(haptic.light); }
    if (!isArmed && pull.value < 0.05) armed.value = false;
  });

  useEffect(() => {
    if (refreshing && !reduce) {
      breathe.value = withRepeat(withSequence(withTiming(1.08, { duration: 450 }), withTiming(1, { duration: 450 })), -1);
    } else {
      cancelAnimation(breathe);
      breathe.value = withTiming(1, { duration: 150 });
    }
  }, [refreshing]);

  const progress = () => {
    'worklet';
    return refreshing ? 1 : pull.value;
  };
  const roof = useAnimatedProps(() => ({ strokeDashoffset: ROOF.len * (1 - segment(progress(), ROOF.from, ROOF.to)) }));
  const walls = useAnimatedProps(() => ({ strokeDashoffset: WALLS.len * (1 - segment(progress(), WALLS.from, WALLS.to)) }));
  const door = useAnimatedProps(() => ({ strokeDashoffset: DOOR.len * (1 - segment(progress(), DOOR.from, DOOR.to)) }));
  const wrap = useAnimatedStyle(() => ({
    opacity: refreshing ? 1 : Math.min(1, pull.value * 3),
    transform: [{ scale: breathe.value }],
  }));

  const indicator = (
    <Animated.View pointerEvents="none" style={[s.indicator, wrap]}>
      <Svg width={34} height={34} viewBox="0 0 24 24">
        {[{ seg: ROOF, props: roof }, { seg: WALLS, props: walls }, { seg: DOOR, props: door }].map(({ seg, props }) => (
          <APath key={seg.d} d={seg.d} fill="none" stroke={color.accent} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={seg.len} animatedProps={props} />
        ))}
      </Svg>
    </Animated.View>
  );

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="transparent" colors={['transparent']} />;

  return { onScroll, refreshControl, indicator };
}

const s = StyleSheet.create({
  indicator: { position: 'absolute', top: 14, left: 0, right: 0, alignItems: 'center', zIndex: 1 },
});
