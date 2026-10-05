import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';
import { Text, type TextVariant } from '../Text';

/**
 * Animates a number to its new value with an ease-out-cubic count (MotionPaid prototype).
 * Text content can't change on the UI thread, so this drives a JS frame loop for one short number.
 */
export function CountUp({ value, format, durationMs = 600, variant = 'headline', color }: {
  value: number;
  format: (n: number) => string;
  durationMs?: number;
  variant?: TextVariant;
  color?: string;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    if (reduce || from.current === value) { from.current = value; setShown(value); return; }
    const start = Date.now();
    const a = from.current;
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const e = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(a + (value - a) * e));
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <Text variant={variant} color={color} style={{ fontVariant: ['tabular-nums'] }}>{format(shown)}</Text>;
}
