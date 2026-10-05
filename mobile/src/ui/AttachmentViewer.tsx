import { useEffect } from 'react';
import { Image, Modal, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Attachment } from '@/api/types';
import { IconButton } from './IconButton';
import { color, motion, space } from './tokens';

/** Full-screen photo on an ink backdrop. Fades in and out; snaps under Reduce Motion. */
export function AttachmentViewer({ attachment, visible, onClose }: { attachment: Attachment; visible: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const insets = useSafeAreaInsets();
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = reduce ? (visible ? 1 : 0) : withTiming(visible ? 1 : 0, { duration: motion.fade.duration });
  }, [visible]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!visible) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[s.backdrop, fade]}>
        <Image source={{ uri: attachment.url }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="Photo" />
        <View style={[s.close, { top: insets.top + space(2) }]}>
          <IconButton icon="close" label="Close photo" variant="filled" onPress={onClose} />
        </View>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: color.ink },
  close: { position: 'absolute', right: space(4) },
});
