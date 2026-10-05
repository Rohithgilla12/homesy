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
          <View style={s.field}>
            {date ? (
              <DateTimePicker value={date} mode="date" display="compact" onChange={handle} accentColor={color.accent} />
            ) : (
              <Pressable onPress={() => onChange(toIsoDate(new Date()))} accessibilityLabel={`${label}: pick a date`}>
                <Text tone="muted">Pick a date</Text>
              </Pressable>
            )}
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
    backgroundColor: color.surface, borderWidth: 1, borderColor: color.line, borderRadius: radius.md,
  },
});
