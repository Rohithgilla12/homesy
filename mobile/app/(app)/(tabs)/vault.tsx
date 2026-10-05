import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Switch, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { api } from '@/api/client';
import { VAULT_CATEGORY_LABEL, type VaultCategory, type VaultEntry } from '@/api/types';
import { friendlyError } from '@/lib/errors';
import { useActiveHome } from '@/store/home';
import {
  BlurReveal, Button, Card, Chip, EmptyState, Icon, IconButton, Input, Pill, Pressable, Screen, Sheet, Text,
  category, color, radius, space, status,
  useManualRefresh,
} from '@/ui';

const CATEGORIES = Object.keys(VAULT_CATEGORY_LABEL) as VaultCategory[];
const REMASK_MS = 30_000;

/** Escapes the characters the WIFI: QR payload format reserves (\ ; , : "). */
const escapeWifi = (v: string) => v.replace(/([\\;,:"])/g, '\\$1');

const isWifiEntry = (e: VaultEntry) => {
  const l = e.label.toLowerCase();
  return l.includes('wifi') || l.includes('wi-fi') || (e.category === 'access' && ['network', 'internet', 'router', 'pass'].some((w) => l.includes(w)));
};

type EntryActions = {
  reveal: (id: string) => void; copy: (e: VaultEntry) => void; edit: (e: VaultEntry) => void;
  pin: (e: VaultEntry) => void; wifi: (e: VaultEntry) => void; remove: (e: VaultEntry) => void;
};

/** One vault entry. Module-level so a screen re-render (typing in a sheet, a reveal) updates rows instead of remounting them. */
function EntryRow({ e, last, revealed, copied, actions }: { e: VaultEntry; last: boolean; revealed: boolean; copied: boolean; actions: EntryActions }) {
  const w = isWifiEntry(e);
  const tint = category.vault[w ? 'wifi' : e.category] ?? category.vault.other;
  return (
    <Pressable
      accessibilityRole="none"
      onLongPress={() => Alert.alert(e.label, undefined, [
        { text: 'Edit', onPress: () => actions.edit(e) },
        { text: e.pinned ? 'Unpin' : 'Pin to top', onPress: () => actions.pin(e) },
        { text: 'Copy value', onPress: () => actions.copy(e) },
        ...(w ? [{ text: 'Show Wi-Fi QR code', onPress: () => actions.wifi(e) }] : []),
        { text: 'Delete', style: 'destructive' as const, onPress: () => actions.remove(e) },
        { text: 'Cancel', style: 'cancel' as const },
      ])}
      style={[s.entry, last && s.entryLast]}
    >
      <View style={[s.tile, { backgroundColor: tint.bg }]}><Icon name={w ? 'vault.wifi' : `vault.${e.category}`} tint={tint.fg} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: space(1) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5), flexWrap: 'wrap' }}>
          <Text variant="headline">{e.label}</Text>
          {e.pinned ? <Pill label="Pinned" tone="neutral" icon="pin" /> : null}
          {e.is_secret ? <Pill label="Hidden" tone="neutral" /> : null}
        </View>
        {e.is_secret ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2), flexWrap: 'wrap' }}>
            <BlurReveal masked="••••••••••" secret={e.value} revealed={revealed} drainMs={REMASK_MS} />
            <Button title={revealed ? 'Hide' : 'Show'} icon={revealed ? 'hide' : 'reveal'} size="sm" variant="ghost" onPress={() => actions.reveal(e.id)} />
          </View>
        ) : (
          <Text selectable>{e.value}</Text>
        )}
        {w ? (
          <View style={{ flexDirection: 'row', gap: space(2), marginTop: space(1) }}>
            <Button title="QR code" icon="qr" size="sm" variant="secondary" onPress={() => actions.wifi(e)} />
            <Button title={copied ? 'Copied' : 'Copy'} icon={copied ? 'copied' : 'copy'} size="sm" variant="secondary" onPress={() => actions.copy(e)} />
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: space(1) }}>
        {!w ? <IconButton icon={copied ? 'copied' : 'copy'} label={`Copy ${e.label}`} tint={copied ? status.ok : undefined} onPress={() => actions.copy(e)} /> : null}
        <IconButton icon="edit" label={`Edit ${e.label}`} onPress={() => actions.edit(e)} />
      </View>
    </Pressable>
  );
}

export default function VaultScreen() {
  const homeId = useActiveHome((s) => s.activeHomeId);
  const qc = useQueryClient();
  const key = ['vault', homeId];

  const { data: home } = useQuery({ queryKey: ['home', homeId], queryFn: () => api.home(homeId!), enabled: !!homeId });
  const { data: entries = [], refetch } = useQuery({ queryKey: key, queryFn: () => api.vault(homeId!), enabled: !!homeId });
  const { refreshing, onRefresh } = useManualRefresh(refetch);

  const [filter, setFilter] = useState<'all' | VaultCategory>('all');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  const [wifi, setWifi] = useState<VaultEntry | null>(null);
  const [ssid, setSsid] = useState('');
  const [wifiCopied, setWifiCopied] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [aCat, setACat] = useState<VaultCategory>('access');
  const [aLabel, setALabel] = useState('');
  const [aValue, setAValue] = useState('');
  const [aSecret, setASecret] = useState(false);
  const [aPinned, setAPinned] = useState(false);

  const [editing, setEditing] = useState<VaultEntry | null>(null);
  const [eCat, setECat] = useState<VaultCategory>('other');
  const [eLabel, setELabel] = useState('');
  const [eValue, setEValue] = useState('');
  const [eSecret, setESecret] = useState(false);
  const [ePinned, setEPinned] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const create = useMutation({
    mutationFn: () => api.createVault(homeId!, { category: aCat, label: aLabel.trim(), value: aValue.trim(), is_secret: aSecret, pinned: aPinned }),
    onSuccess: () => { setAddOpen(false); setALabel(''); setAValue(''); setASecret(false); setAPinned(false); invalidate(); },
    onError: (e) => Alert.alert('Could not save detail', friendlyError(e, 'generic')),
  });
  const update = useMutation({
    mutationFn: () => api.updateVault(editing!.id, { category: eCat, label: eLabel.trim(), value: eValue.trim(), is_secret: eSecret, pinned: ePinned }),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: (e) => Alert.alert('Could not update detail', friendlyError(e, 'generic')),
  });
  const togglePin = useMutation({ mutationFn: (e: VaultEntry) => api.updateVault(e.id, { pinned: !e.pinned }), onSettled: invalidate });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteVault(id),
    onSuccess: () => { setEditing(null); invalidate(); },
    onError: (e) => Alert.alert('Could not delete', friendlyError(e, 'generic')),
  });

  const reveal = (id: string) => {
    clearTimeout(timers.current[id]);
    setRevealed((r) => {
      const n = new Set(r);
      if (n.has(id)) { n.delete(id); return n; }
      n.add(id);
      timers.current[id] = setTimeout(() => setRevealed((x) => { const y = new Set(x); y.delete(id); return y; }), REMASK_MS);
      return n;
    });
  };
  const copy = async (e: VaultEntry) => {
    await Clipboard.setStringAsync(e.value);
    setCopied(e.id);
    setTimeout(() => setCopied(null), 2000);
  };
  const openEdit = (e: VaultEntry) => { setEditing(e); setECat(e.category); setELabel(e.label); setEValue(e.value); setESecret(e.is_secret); setEPinned(e.pinned); };
  const openWifi = (e: VaultEntry) => {
    setWifi(e); setWifiCopied(false);
    const cleaned = e.label.replace(/wi-?fi/gi, '').replace(/password/gi, '').replace(/credentials/gi, '').replace(/code/gi, '').replace(/pass/gi, '').trim();
    setSsid(cleaned || `${home?.name || 'Home'} Wi-Fi`);
  };
  const copyWifi = async () => {
    if (!wifi) return;
    await Clipboard.setStringAsync(wifi.value);
    setWifiCopied(true);
    setTimeout(() => setWifiCopied(false), 2000);
  };
  const confirmDelete = (e: VaultEntry) => Alert.alert('Delete detail?', `Delete "${e.label}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(e.id) },
  ]);

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.category === filter);
  const pinned = filtered.filter((e) => e.pinned);
  const groups = CATEGORIES.map((c) => ({ c, items: filtered.filter((e) => !e.pinned && e.category === c) })).filter((g) => g.items.length);

  const rowActions: EntryActions = { reveal, copy, edit: openEdit, pin: (e) => togglePin.mutate(e), wifi: openWifi, remove: confirmDelete };
  const section = (title: string, items: VaultEntry[]) => (
    <View key={title} style={{ gap: space(2) }}>
      <Text variant="caption" tone="muted" style={{ marginLeft: space(1) }}>{title}</Text>
      <Card padded={false}>
        {items.map((e, i) => <EntryRow key={e.id} e={e} last={i === items.length - 1} revealed={revealed.has(e.id)} copied={copied === e.id} actions={rowActions} />)}
      </Card>
    </View>
  );

  const categoryChips = (value: VaultCategory, set: (c: VaultCategory) => void) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
      {CATEGORIES.map((c) => <Chip key={c} label={VAULT_CATEGORY_LABEL[c]} icon={`vault.${c}`} selected={value === c} onPress={() => set(c)} />)}
    </ScrollView>
  );
  const switchRow = (label: string, hint: string | null, value: boolean, set: (v: boolean) => void) => (
    <View style={s.switchRow}>
      <View style={{ flex: 1, paddingRight: space(3) }}>
        <Text variant="headline">{label}</Text>
        {hint ? <Text variant="label" tone="muted">{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={set} trackColor={{ true: color.accent }} accessibilityLabel={label} />
    </View>
  );

  return (
    <>
      <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={color.accent} />}>
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text variant="display">Vault</Text>
            <Text tone="muted">Wi-Fi, codes and contacts for this home</Text>
          </View>
          <IconButton icon="add" label="Add detail" variant="filled" onPress={() => setAddOpen(true)} />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
          <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} />
          {CATEGORIES.map((c) => <Chip key={c} label={VAULT_CATEGORY_LABEL[c]} selected={filter === c} onPress={() => setFilter(c)} />)}
        </ScrollView>

        {filtered.length === 0 ? (
          <EmptyState icon="tab.vault" title="Nothing here yet" body="Keep track of Wi-Fi passwords, maintenance contacts, and locker keys." actionLabel="Add a detail" onAction={() => setAddOpen(true)} />
        ) : null}
        {pinned.length ? section('Pinned', pinned) : null}
        {groups.map((g) => section(VAULT_CATEGORY_LABEL[g.c], g.items))}
      </Screen>

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add a detail">
        {categoryChips(aCat, setACat)}
        <Input label="Label" placeholder="e.g. Wi-Fi password, Maid contact, Spare key" value={aLabel} onChangeText={setALabel} />
        <Input label="Value" placeholder="e.g. +91 98765 43210" value={aValue} onChangeText={setAValue} multiline={!aSecret} secureTextEntry={aSecret} />
        {switchRow('Hidden', 'Masked until someone taps Show', aSecret, setASecret)}
        <View style={{ gap: space(3) }}>
          {switchRow('Pin to top', 'Always shown in Pinned', aPinned, setAPinned)}
          <Button title="Save" fullWidth loading={create.isPending} onPress={() => { if (aLabel.trim() && aValue.trim()) create.mutate(); }} />
        </View>
      </Sheet>

      <Sheet visible={!!editing} onClose={() => setEditing(null)} title="Edit detail">
        {categoryChips(eCat, setECat)}
        <Input label="Label" value={eLabel} onChangeText={setELabel} />
        <Input label="Value" value={eValue} onChangeText={setEValue} secureTextEntry={eSecret} />
        {switchRow('Hidden', null, eSecret, setESecret)}
        <View style={{ gap: space(3) }}>
          {switchRow('Pin to top', null, ePinned, setEPinned)}
          <Button title="Save changes" fullWidth loading={update.isPending} onPress={() => update.mutate()} />
          <Button title="Delete detail" variant="danger" fullWidth onPress={() => editing && confirmDelete(editing)} />
        </View>
      </Sheet>

      <Sheet visible={!!wifi} onClose={() => setWifi(null)} title="Wi-Fi fast connect">
        <Text tone="muted">Point any iPhone or Android camera at this code to join without typing the password.</Text>
        <Card style={{ alignItems: 'center', gap: space(2) }}>
          {wifi ? (
            // Rendered on-device: the payload contains the Wi-Fi password, so it must never go to a remote QR service.
            <QRCode value={`WIFI:T:WPA;S:${escapeWifi(ssid)};P:${escapeWifi(wifi.value)};;`} size={220} quietZone={12} color={color.ink} backgroundColor={color.surface} />
          ) : null}
          <Text variant="label" tone="muted">Scan with the phone camera to connect</Text>
        </Card>
        <Input label="Network name (SSID)" value={ssid} onChangeText={setSsid} />
        <View style={s.passwordRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text variant="caption" tone="muted">Password</Text>
            <Text variant="mono" selectable>{wifi?.value}</Text>
          </View>
          <IconButton icon={wifiCopied ? 'copied' : 'copy'} label="Copy Wi-Fi password" tint={wifiCopied ? status.ok : undefined} onPress={copyWifi} />
        </View>
        <Button title={wifiCopied ? 'Password copied' : 'Copy Wi-Fi password'} icon={wifiCopied ? 'copied' : 'copy'} fullWidth onPress={copyWifi} />
      </Sheet>
    </>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space(3) },
  entry: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3), padding: space(4), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  entryLast: { borderBottomWidth: 0 },
  tile: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), backgroundColor: color.surfaceSunk, borderRadius: radius.md, paddingVertical: space(2), paddingLeft: space(3), paddingRight: space(2) },
});
