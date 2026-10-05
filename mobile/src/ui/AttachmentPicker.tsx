import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { pickContentType, resolveSize, sizeLimitFor, uploadAttachment, uploadKindAllows, type PickedFile } from '@/api/attachments';
import type { Attachment, AttachmentKind } from '@/api/types';
import { friendlyError } from '@/lib/errors';
import { useFeatures } from '@/store/features';
import { sizeLabel } from './AttachmentThumb';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { color, radius, space } from './tokens';

/**
 * Dashed "Add photo" chip that runs the camera, photo library or (when allowed) the PDF picker, uploads the
 * result and reports the ready attachment. Renders nothing while the API has no storage configured.
 */
export function AttachmentPicker({ homeId, kind, onUploaded, allowPdf = false, label }: {
  homeId: string; kind: AttachmentKind; onUploaded: (a: Attachment) => void; allowPdf?: boolean; label?: string;
}) {
  const enabled = useFeatures((f) => f.attachments);
  const [progress, setProgress] = useState<number | null>(null);
  if (!enabled) return null;
  const title = label ?? (allowPdf ? 'Add photo or PDF' : 'Add photo');

  const upload = async (file: PickedFile) => {
    if (!uploadKindAllows(kind, file.contentType)) return Alert.alert('Unsupported file', 'Choose a photo (JPEG, PNG, WebP, HEIC)' + (allowPdf ? ' or a PDF.' : '.'));
    if (file.sizeBytes > sizeLimitFor(file.contentType)) return Alert.alert('File too large', `Keep it under ${sizeLabel(sizeLimitFor(file.contentType))}.`);
    setProgress(0);
    try {
      onUploaded(await uploadAttachment(homeId, kind, file, setProgress));
    } catch (e) {
      Alert.alert('Upload failed', friendlyError(e, 'generic'));
    } finally {
      setProgress(null);
    }
  };

  const fromImage = async (res: ImagePicker.ImagePickerResult) => {
    const a = res.assets?.[0];
    if (res.canceled || !a) return;
    const contentType = pickContentType(a.fileName ?? a.uri, a.mimeType ?? undefined);
    if (!contentType) return Alert.alert('Unsupported file', 'Choose a JPEG, PNG, WebP or HEIC photo.');
    upload({ uri: a.uri, contentType, sizeBytes: await resolveSize(a.uri, a.fileSize), width: a.width, height: a.height });
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera is off', 'Allow the camera for Homesy in Settings to take a photo.');
    fromImage(await ImagePicker.launchCameraAsync({ quality: 1 }));
  };
  const choosePhoto = async () => fromImage(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }));
  const choosePdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    const a = res.assets?.[0];
    if (res.canceled || !a) return;
    upload({ uri: a.uri, contentType: 'application/pdf', sizeBytes: await resolveSize(a.uri, a.size) });
  };

  const choose = () => Alert.alert(title, undefined, [
    { text: 'Take photo', onPress: takePhoto },
    { text: 'Choose photo', onPress: choosePhoto },
    ...(allowPdf ? [{ text: 'Choose PDF', onPress: choosePdf }] : []),
    { text: 'Cancel', style: 'cancel' as const },
  ]);

  const uploading = progress !== null;
  return (
    <Pressable
      onPress={choose}
      disabled={uploading}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy: uploading }}
      style={s.chip}
    >
      <Icon name="camera" size={16} tint={color.ink2} />
      <Text variant="label" tone="ink2">{uploading ? `Uploading ${Math.round((progress ?? 0) * 100)}%` : title}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space(1.5),
    borderWidth: 1, borderStyle: 'dashed', borderColor: color.lineStrong, borderRadius: radius.full,
    paddingVertical: space(1.5), paddingHorizontal: space(3),
  },
});
