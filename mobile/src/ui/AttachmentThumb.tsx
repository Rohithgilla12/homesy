import { useRef, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import type { Attachment } from '@/api/types';
import { AttachmentViewer } from './AttachmentViewer';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { color, radius, space } from './tokens';

export function sizeLabel(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Square tile for an attachment: the photo itself, or a document glyph for PDFs (which open in the system
 * viewer). An image load error means the presigned URL expired, so `onExpired` fires once and the owning
 * screen refetches for fresh URLs.
 */
export function AttachmentThumb({ attachment, size = 72, onRemove, onExpired }: {
  attachment: Attachment; size?: number; onRemove?: () => void; onExpired?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const refreshed = useRef(false);
  const isPdf = attachment.content_type === 'application/pdf';
  const label = isPdf ? `PDF document, ${sizeLabel(attachment.size_bytes)}` : `Photo, ${sizeLabel(attachment.size_bytes)}`;
  return (
    <>
      <Pressable
        onPress={() => (isPdf ? Linking.openURL(attachment.url) : setOpen(true))}
        onLongPress={onRemove}
        accessibilityLabel={label}
        accessibilityHint={onRemove ? 'Long press to remove' : undefined}
        style={[s.tile, { width: size, height: size }]}
      >
        {isPdf ? (
          <View style={s.doc}>
            <Icon name="document" tint={color.ink2} />
            <Text variant="caption" tone="muted">PDF</Text>
          </View>
        ) : (
          <Image
            testID="attachment-image"
            source={{ uri: attachment.url }}
            style={StyleSheet.absoluteFill}
            onError={() => {
              if (refreshed.current) return;
              refreshed.current = true;
              onExpired?.();
            }}
          />
        )}
      </Pressable>
      {open && !isPdf ? <AttachmentViewer attachment={attachment} visible onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const s = StyleSheet.create({
  tile: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: color.surfaceSunk, borderWidth: 1, borderColor: color.line },
  doc: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(1) },
});
