import { BlurView } from 'expo-blur';
import { Children, useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable as RNPressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
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
 * The panel shrinks to the space left above the keyboard and its content scrolls, so the focused
 * field on a tall form (Add bill) stays reachable on small phones.
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
  const scrollY = useSharedValue(0);
  const dragFromTop = useSharedValue(true);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      backdrop.value = withTiming(1, { duration: motion.fade.duration });
      y.value = reduce ? 0 : withTiming(0, motion.sheetIn);
      return;
    }
    backdrop.value = withTiming(0, { duration: motion.sheetOut.duration });
    const done = () => setMounted(false);
    if (reduce) {
      y.value = 0;
      const t = setTimeout(done, motion.sheetOut.duration);
      return () => clearTimeout(t);
    }
    y.value = withTiming(panelH, motion.sheetOut, (finished) => { if (finished) scheduleOnRN(done); });
  }, [visible, mounted]);

  // The content ScrollView owns vertical drags unless it is at the top, where a downward drag moves the sheet.
  const scroll = Gesture.Native();
  const pan = Gesture.Pan()
    .simultaneousWithExternalGesture(scroll)
    .activeOffsetY([-12, 12])
    .onBegin(() => { dragFromTop.value = scrollY.value <= 0; })
    .onUpdate((e) => {
      if (dragFromTop.value) y.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (dragFromTop.value && (e.translationY > panelH * DISMISS_FRACTION || e.velocityY > DISMISS_VELOCITY)) {
        scheduleOnRN(onClose);
      } else {
        y.value = withSpring(0, motion.spring);
      }
    });

  const panelStyle = useAnimatedStyle(() => (reduce
    ? { opacity: backdrop.value }
    : { transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          {blur && Platform.OS === 'ios' ? <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFill} /> : null}
          <RNPressable style={[StyleSheet.absoluteFill, s.scrim]} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button" />
        </Animated.View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[s.bottom, { paddingTop: insets.top + space(8) }]} pointerEvents="box-none">
          <GestureDetector gesture={pan}>
            <Animated.View
              onLayout={(e) => setPanelH(e.nativeEvent.layout.height)}
              style={[s.panel, { paddingBottom: insets.bottom + space(4) }, panelStyle]}
              accessibilityViewIsModal
              onAccessibilityEscape={onClose}
            >
              <View style={s.handle} />
              {title ? <Text variant="title" style={{ marginBottom: space(1) }}>{title}</Text> : null}
              <GestureDetector gesture={scroll}>
                <ScrollView
                  style={s.scroll}
                  contentContainerStyle={s.content}
                  bounces={false}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  scrollEventThrottle={16}
                  onScroll={(e) => { scrollY.value = e.nativeEvent.contentOffset.y; }}
                >
                  {Children.toArray(children).map((child, i) => (
                    i < 5 && !reduce
                      ? <Animated.View key={i} entering={FadeInDown.duration(220).delay(i * 40)}>{child}</Animated.View>
                      : <View key={i}>{child}</View>
                  ))}
                </ScrollView>
              </GestureDetector>
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
    flexShrink: 1,
  },
  handle: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: color.line, marginBottom: space(3) },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: space(3) },
});
