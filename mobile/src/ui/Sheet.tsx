import { BlurView } from 'expo-blur';
import { Children, useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable as RNPressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { Text } from './Text';
import { color, motion, radius, space } from './tokens';

const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 110; // pt/s, i.e. 0.11 pt/ms — a flick dismisses regardless of distance

/**
 * Bottom sheet: drawer-curve slide, drag or flick to dismiss, blurred backdrop on iOS.
 * The Modal stays mounted until the exit animation finishes so closing is never abrupt.
 */
export function Sheet({ visible, onClose, title, children, blur = true }: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  blur?: boolean;
}) {
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const [panelH, setPanelH] = useState(screenH * 0.6);
  const y = useSharedValue(screenH);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      backdrop.value = withTiming(1, { duration: motion.fade.duration });
      y.value = reduce ? 0 : withTiming(0, motion.sheetIn);
    } else {
      backdrop.value = withTiming(0, { duration: motion.sheetOut.duration });
      const done = () => setMounted(false);
      if (reduce) { y.value = 0; setTimeout(done, motion.sheetOut.duration); return; }
      y.value = withTiming(panelH, motion.sheetOut, (finished) => { if (finished) scheduleOnRN(done); });
    }
  }, [visible, mounted]);

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      y.value = e.translationY > 0 ? e.translationY : e.translationY / 4;
    })
    .onEnd((e) => {
      if (e.translationY > panelH * DISMISS_FRACTION || e.velocityY > DISMISS_VELOCITY) {
        scheduleOnRN(onClose);
      } else {
        y.value = withSpring(0, motion.spring);
      }
    });

  const panelStyle = useAnimatedStyle(() => (reduce
    ? { opacity: backdrop.value }
    : { transform: [{ translateY: Math.max(-24, y.value) }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          {blur && Platform.OS === 'ios' ? <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} /> : null}
          <RNPressable style={[StyleSheet.absoluteFill, s.scrim]} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        </Animated.View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.bottom} pointerEvents="box-none">
          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}
              style={[s.panel, { paddingBottom: insets.bottom + space(4) }, panelStyle]}
              accessibilityViewIsModal
            >
              <View style={s.handle} />
              {title ? <Text variant="title" style={{ marginBottom: space(1) }}>{title}</Text> : null}
              <View style={s.content}>
                {Children.toArray(children).map((child, i) => (
                  i < 5 && !reduce
                    ? <Animated.View key={i} entering={FadeInDown.duration(220).delay(i * 40)}>{child}</Animated.View>
                    : <View key={i}>{child}</View>
                ))}
              </View>
            </Animated.View>
          </GestureDetector>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim: { backgroundColor: color.scrim },
  bottom: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    backgroundColor: color.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space(5),
    paddingTop: space(2),
    maxHeight: '92%',
  },
  handle: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: color.line, marginBottom: space(3) },
  content: { gap: space(3) },
});
