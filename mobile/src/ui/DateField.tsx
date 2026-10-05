import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { shortDate } from '@/lib/format';
import { IconButton } from './IconButton';
import { Pressable } from './Pressable';
import { Text } from './Text';
import { color, radius, space } from './tokens';

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar date as YYYY-MM-DD; the API stores due dates as a SQL `date`. */
export const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIsoDate = (v: string) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };

export function DateField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const date = value ? fromIsoDate(value) : null;
  const handle = (_e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS !== 'ios') setOpen(false);
    if (d) onChange(toIsoDate(d));
  };

  return (
    <View style={s.wrap}>
      <Text variant="label" tone="ink2">{label}</Text>
      <View style={s.row}>
        {Platform.OS === 'ios' ? (
          // The compact picker draws its own grey pill, which overflows a narrow field. Show our own
          // text and lay the picker over it, nearly invisible, so a tap still opens the native calendar.
          <View style={s.field} accessible accessibilityLabel={`${label}: ${date ? shortDate(date) : 'pick a date'}`}>
            <Text tone={date ? 'ink' : 'muted'}>{date ? shortDate(date) : 'Pick a date'}</Text>
            <DateTimePicker value={date ?? new Date()} mode="date" display="compact" onChange={handle} accentColor={color.accent} style={s.overlay} />
          </View>
        ) : (
          <Pressable onPress={() => setOpen(true)} style={s.field} accessibilityLabel={`${label}: ${date ? shortDate(date) : 'pick a date'}`}>
            <Text tone={date ? 'ink' : 'muted'}>{date ? shortDate(date) : 'Pick a date'}</Text>
          </Pressable>
        )}
        {date ? <IconButton icon="close" label={`Clear ${label}`} onPress={() => onChange(null)} /> : null}
      </View>
      {open && Platform.OS !== 'ios' ? <DateTimePicker value={date ?? new Date()} mode="date" onChange={handle} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: space(1.5) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  field: {
    flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'flex-start', paddingHorizontal: 14,
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: radius.md, overflow: 'hidden',
  },
  overlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, width: '100%', opacity: 0.02 },
});
