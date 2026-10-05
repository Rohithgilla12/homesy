import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { haptic } from '../haptics';
import { color, status } from '../tokens';

const COLORS = [color.accent, status.ok, status.warn, '#F2B544', status.danger, '#6B3FC4', color.accentInk];
const BURST_MS = 1100;

type Bit = { dx: number; dy: number; rot: number; w: number; h: number; c: string; delay: number };

function makeBits(seed: number): Bit[] {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return Array.from({ length: 24 }, (_, i) => {
    const a = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.1;
    const r = 90 + rnd() * 110;
    return { dx: Math.cos(a) * r, dy: Math.sin(a) * r, rot: (rnd() - 0.5) * 720, w: 6 + rnd() * 3, h: 9 + rnd() * 5, c: COLORS[i % COLORS.length], delay: rnd() * 70 };
  });
}

function Particle({ b }: { b: Bit }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withDelay(b.delay, withTiming(1, { duration: 950, easing: Easing.bezier(0.2, 0.7, 0.4, 1) })); }, []);
  const style = useAnimatedStyle(() => ({
    opacity: t.value < 0.6 ? 1 : 1 - (t.value - 0.6) / 0.4,
    transform: [
      { translateX: b.dx * t.value },
      { translateY: b.dy * t.value + 220 * t.value * t.value },
      { rotate: `${b.rot * t.value}deg` },
    ],
  }));
  return <Animated.View style={[s.bit, { width: b.w, height: b.h, backgroundColor: b.c }, style]} />;
}

/**
 * One-off celebration burst (MotionConfetti prototype). Fires only when `fire` changes after mount, so a
 * counter that persists in a store does not replay the burst when the overlay remounts (sign-out, leaving
 * the last home). Particles unmount once the burst has settled.
 */
export function Confetti({ fire }: { fire: number }) {
  const reduce = useReducedMotion();
  const handled = useRef(fire);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    if (fire === handled.current) return;
    handled.current = fire;
    haptic.success();
    setBurst(fire);
    const t = setTimeout(() => setBurst(0), BURST_MS);
    return () => clearTimeout(t);
  }, [fire]);
  const bits = useMemo(() => makeBits(burst || 1), [burst]);
  if (!burst || reduce) return null;
  return (
    <View key={burst} pointerEvents="none" style={s.origin}>
      {bits.map((b, i) => <Particle key={`${burst}-${i}`} b={b} />)}
    </View>
  );
}

const s = StyleSheet.create({
  origin: { position: 'absolute', left: '50%', top: '40%', width: 0, height: 0, zIndex: 10 },
  bit: { position: 'absolute', borderRadius: 2 },
});
