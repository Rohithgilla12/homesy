import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { api } from '@/api/client';
import {
  VAULT_CATEGORY_LABEL,
  type VaultCategory,
  type VaultEntry,
} from '@/api/types';
import { useActiveHome } from '@/store/home';
import { Button, Card, Input, Muted, Row, Screen, Title } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

const CATEGORIES = Object.keys(VAULT_CATEGORY_LABEL) as VaultCategory[];

export default function VaultScreen() {
  const homeId = useActiveHome((s) => s.activeHomeId);
  const qc = useQueryClient();
  const key = ['vault', homeId];

  const { data: homeDetail } = useQuery({
    queryKey: ['home', homeId],
    queryFn: () => api.home(homeId!),
    enabled: !!homeId,
  });

  const { data: entries = [], refetch, isRefetching } = useQuery({
    queryKey: key,
    queryFn: () => api.vault(homeId!),
    enabled: !!homeId,
  });

  // Filter state: 'all' or specific VaultCategory
  const [selectedFilter, setSelectedFilter] = useState<'all' | VaultCategory>('all');
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Wi-Fi QR Fast Connect modal state
  const [wifiModalEntry, setWifiModalEntry] = useState<VaultEntry | null>(null);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPasswordCopied, setWifiPasswordCopied] = useState(false);

  // Add modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addCategory, setAddCategory] = useState<VaultCategory>('access');
  const [addLabel, setAddLabel] = useState('');
  const [addValue, setAddValue] = useState('');
  const [addSecret, setAddSecret] = useState(false);
  const [addPinned, setAddPinned] = useState(false);

  // Edit modal state
  const [editingEntry, setEditingEntry] = useState<VaultEntry | null>(null);
  const [editCategory, setEditCategory] = useState<VaultCategory>('other');
  const [editLabel, setEditLabel] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editSecret, setEditSecret] = useState(false);
  const [editPinned, setEditPinned] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const createMutation = useMutation({
    mutationFn: () =>
      api.createVault(homeId!, {
        category: addCategory,
        label: addLabel.trim(),
        value: addValue.trim(),
        is_secret: addSecret,
        pinned: addPinned,
      }),
    onSuccess: () => {
      setAddModalOpen(false);
      setAddLabel('');
      setAddValue('');
      setAddSecret(false);
      setAddPinned(false);
      invalidate();
    },
    onError: (e: Error) => Alert.alert('Could not save detail', e.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      api.updateVault(editingEntry!.id, {
        category: editCategory,
        label: editLabel.trim(),
        value: editValue.trim(),
        is_secret: editSecret,
        pinned: editPinned,
      }),
    onSuccess: () => {
      setEditingEntry(null);
      invalidate();
    },
    onError: (e: Error) => Alert.alert('Could not update detail', e.message),
  });

  const pinToggleMutation = useMutation({
    mutationFn: (e: VaultEntry) => api.updateVault(e.id, { pinned: !e.pinned }),
    onSettled: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (entryId: string) => api.deleteVault(entryId),
    onSuccess: () => {
      setEditingEntry(null);
      invalidate();
    },
    onError: (e: Error) => Alert.alert('Could not delete', e.message),
  });

  const handleCopy = async (entry: VaultEntry) => {
    await Clipboard.setStringAsync(entry.value);
    setCopiedId(entry.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openEditModal = (entry: VaultEntry) => {
    setEditingEntry(entry);
    setEditCategory(entry.category);
    setEditLabel(entry.label);
    setEditValue(entry.value);
    setEditSecret(entry.is_secret);
    setEditPinned(entry.pinned);
  };

  // Filter entries based on selected category
  const filteredEntries =
    selectedFilter === 'all'
      ? entries
      : entries.filter((e) => e.category === selectedFilter);

  const pinnedEntries = filteredEntries.filter((e) => e.pinned);
  const unpinnedEntries = filteredEntries.filter((e) => !e.pinned);

  // Group unpinned entries by category
  const groupedCategories = CATEGORIES.map((c) => ({
    category: c,
    items: unpinnedEntries.filter((e) => e.category === c),
  })).filter((g) => g.items.length > 0);

  const isWifiEntry = (entry: VaultEntry) => {
    const lbl = entry.label.toLowerCase();
    return (
      lbl.includes('wifi') ||
      lbl.includes('wi-fi') ||
      (entry.category === 'access' &&
        (lbl.includes('network') ||
          lbl.includes('internet') ||
          lbl.includes('router') ||
          lbl.includes('pass')))
    );
  };

  const openWifiQrModal = (entry: VaultEntry) => {
    setWifiModalEntry(entry);
    setWifiPasswordCopied(false);
    const cleaned = entry.label
      .replace(/wi-?fi/gi, '')
      .replace(/password/gi, '')
      .replace(/credentials/gi, '')
      .replace(/code/gi, '')
      .replace(/pass/gi, '')
      .trim();
    const defaultSsid = cleaned || `${homeDetail?.name || 'Home'} Wi-Fi`;
    setWifiSsid(defaultSsid);
  };

  const EntryCard = ({ entry }: { entry: VaultEntry }) => {
    const isMasked = entry.is_secret && !revealed[entry.id];
    const isCopied = copiedId === entry.id;
    const isWifi = isWifiEntry(entry);

    return (
      <Pressable
        onPress={() => entry.is_secret && setRevealed((r) => ({ ...r, [entry.id]: !r[entry.id] }))}
        onLongPress={() =>
          Alert.alert(entry.label, undefined, [
            { text: 'Edit', onPress: () => openEditModal(entry) },
            {
              text: entry.pinned ? 'Unpin' : 'Pin to top',
              onPress: () => pinToggleMutation.mutate(entry),
            },
            {
              text: 'Copy value',
              onPress: () => handleCopy(entry),
            },
            ...(isWifi
              ? [{ text: 'Show Wi-Fi QR Code', onPress: () => openWifiQrModal(entry) }]
              : []),
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => removeMutation.mutate(entry.id),
            },
            { text: 'Cancel', style: 'cancel' },
          ])
        }
        style={s.entryCard}
      >
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Row style={{ gap: space(0.75), alignItems: 'center' }}>
              <Text style={s.entryLabel}>{entry.label}</Text>
              {entry.pinned ? <Text style={s.pinnedIcon}>📌</Text> : null}
              {entry.is_secret ? (
                <View style={s.secretBadge}>
                  <Text style={s.secretBadgeText}>Secret</Text>
                </View>
              ) : null}
            </Row>

            <Pressable
              onPress={() =>
                entry.is_secret && setRevealed((r) => ({ ...r, [entry.id]: !r[entry.id] }))
              }
              style={{ marginTop: space(0.5) }}
            >
              <Text
                style={[s.entryValue, isMasked && s.entryValueMasked]}
                selectable={!isMasked}
              >
                {isMasked ? '••••••••  (tap to reveal)' : entry.value}
              </Text>
            </Pressable>

            {isWifi && (
              <View style={s.wifiQuickBox}>
                <Row style={{ gap: space(1), alignItems: 'center', marginTop: space(0.75) }}>
                  <Pressable
                    onPress={() => openWifiQrModal(entry)}
                    style={s.wifiQrActionBtn}
                  >
                    <Row style={{ gap: 4, alignItems: 'center' }}>
                      <Text style={{ fontSize: 13 }}>📶</Text>
                      <Text style={s.wifiQrActionText}>Show Wi-Fi QR Code</Text>
                    </Row>
                  </Pressable>
                  <Pressable
                    onPress={() => handleCopy(entry)}
                    style={s.wifiCopyActionBtn}
                  >
                    <Text style={s.wifiCopyActionText}>
                      {isCopied ? '✓ Copied!' : 'Copy Password'}
                    </Text>
                  </Pressable>
                </Row>
              </View>
            )}
          </View>

          <Row style={{ gap: space(0.5), alignItems: 'center' }}>
            <Pressable onPress={() => handleCopy(entry)} style={s.iconBtn}>
              <Text style={s.iconBtnText}>{isCopied ? '✓' : '⧉'}</Text>
            </Pressable>
            <Pressable onPress={() => openEditModal(entry)} style={s.iconBtn}>
              <Text style={s.iconBtnText}>✎</Text>
            </Pressable>
          </Row>
        </Row>
      </Pressable>
    );
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: space(1) }}>
        <View>
          <Title>Vault</Title>
          <Muted>Shared Wi-Fi, gate codes, bills, and contacts</Muted>
        </View>
        <Pressable onPress={() => setAddModalOpen(true)} style={s.addBtn}>
          <Text style={s.addBtnText}>+ Add detail</Text>
        </Pressable>
      </Row>

      {/* Category Filter Chips Bar */}
      <View style={{ marginBottom: space(1.5) }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row style={{ gap: space(0.75) }}>
            <Pressable
              onPress={() => setSelectedFilter('all')}
              style={[s.filterChip, selectedFilter === 'all' && s.filterChipActive]}
            >
              <Text
                style={[s.filterChipText, selectedFilter === 'all' && s.filterChipTextActive]}
              >
                All
              </Text>
            </Pressable>
            {CATEGORIES.map((cat) => (
              <Pressable
                key={cat}
                onPress={() => setSelectedFilter(cat)}
                style={[s.filterChip, selectedFilter === cat && s.filterChipActive]}
              >
                <Text
                  style={[
                    s.filterChipText,
                    selectedFilter === cat && s.filterChipTextActive,
                  ]}
                >
                  {VAULT_CATEGORY_LABEL[cat]}
                </Text>
              </Pressable>
            ))}
          </Row>
        </ScrollView>
      </View>

      {/* Vault Entries */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: space(2), paddingBottom: space(5) }}
      >
        {/* Pinned section */}
        {pinnedEntries.length > 0 && (
          <View>
            <Text style={s.sectionHeader}>Pinned details 📌</Text>
            <Card style={{ gap: space(1) }}>
              {pinnedEntries.map((e) => (
                <EntryCard key={e.id} entry={e} />
              ))}
            </Card>
          </View>
        )}

        {/* Grouped by category if viewing All or showing filtered items */}
        {selectedFilter === 'all' ? (
          groupedCategories.map(({ category, items }) => (
            <View key={category}>
              <Text style={s.sectionHeader}>{VAULT_CATEGORY_LABEL[category]}</Text>
              <Card style={{ gap: space(1) }}>
                {items.map((e) => (
                  <EntryCard key={e.id} entry={e} />
                ))}
              </Card>
            </View>
          ))
        ) : (
          unpinnedEntries.length > 0 && (
            <View>
              <Text style={s.sectionHeader}>{VAULT_CATEGORY_LABEL[selectedFilter]}</Text>
              <Card style={{ gap: space(1) }}>
                {unpinnedEntries.map((e) => (
                  <EntryCard key={e.id} entry={e} />
                ))}
              </Card>
            </View>
          )
        )}

        {/* Empty state */}
        {filteredEntries.length === 0 && (
          <Card style={{ alignItems: 'center', paddingVertical: space(3) }}>
            <Text style={{ fontSize: 32, marginBottom: space(1) }}>🔐</Text>
            <Text style={s.emptyTitle}>No details in this section</Text>
            <Muted>Keep track of Wi-Fi passwords, maintenance contacts, and locker keys.</Muted>
            <Button
              title="+ Add house detail"
              onPress={() => setAddModalOpen(true)}
              style={{ marginTop: space(2) }}
            />
          </Card>
        )}
      </ScrollView>

      {/* Add Entry Modal */}
      <Modal
        visible={addModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddModalOpen(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setAddModalOpen(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>Add household detail</Text>
            <Muted>Store details everyone in the home frequently asks for.</Muted>

            <View style={{ marginVertical: space(1) }}>
              <Muted>Category</Muted>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space(0.5) }}>
                <Row style={{ gap: space(0.75) }}>
                  {CATEGORIES.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => setAddCategory(c)}
                      style={[s.categoryChip, addCategory === c && s.categoryChipActive]}
                    >
                      <Text
                        style={[
                          s.categoryChipText,
                          addCategory === c && s.categoryChipTextActive,
                        ]}
                      >
                        {VAULT_CATEGORY_LABEL[c]}
                      </Text>
                    </Pressable>
                  ))}
                </Row>
              </ScrollView>
            </View>

            <Input
              placeholder="Label — e.g. Wi-Fi Password, Maid Contact, Spare Key"
              value={addLabel}
              onChangeText={setAddLabel}
            />

            <Input
              placeholder="Value — e.g. SecretPassword123, +91 9876543210"
              value={addValue}
              onChangeText={setAddValue}
              multiline={!addSecret}
            />

            <Row style={{ justifyContent: 'space-between', paddingVertical: space(0.5) }}>
              <View>
                <Text style={s.switchLabel}>Secret (Masked)</Text>
                <Muted>Hidden behind tap-to-reveal mask</Muted>
              </View>
              <Switch
                value={addSecret}
                onValueChange={setAddSecret}
                trackColor={{ true: colors.accent }}
              />
            </Row>

            <Row style={{ justifyContent: 'space-between', paddingVertical: space(0.5) }}>
              <View>
                <Text style={s.switchLabel}>Pin to top</Text>
                <Muted>Always show in the Pinned section</Muted>
              </View>
              <Switch
                value={addPinned}
                onValueChange={setAddPinned}
                trackColor={{ true: colors.accent }}
              />
            </Row>

            <Button
              title="Save detail"
              onPress={() => addLabel.trim() && addValue.trim() && createMutation.mutate()}
              loading={createMutation.isPending}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setAddModalOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit Entry Modal */}
      <Modal
        visible={!!editingEntry}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingEntry(null)}
      >
        <Pressable style={s.backdrop} onPress={() => setEditingEntry(null)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>Edit detail</Text>

            <View style={{ marginVertical: space(1) }}>
              <Muted>Category</Muted>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space(0.5) }}>
                <Row style={{ gap: space(0.75) }}>
                  {CATEGORIES.map((c) => (
                    <Pressable
                      key={c}
                      onPress={() => setEditCategory(c)}
                      style={[s.categoryChip, editCategory === c && s.categoryChipActive]}
                    >
                      <Text
                        style={[
                          s.categoryChipText,
                          editCategory === c && s.categoryChipTextActive,
                        ]}
                      >
                        {VAULT_CATEGORY_LABEL[c]}
                      </Text>
                    </Pressable>
                  ))}
                </Row>
              </ScrollView>
            </View>

            <Muted>Label</Muted>
            <Input
              placeholder="Label"
              value={editLabel}
              onChangeText={setEditLabel}
            />

            <Muted>Value</Muted>
            <Input
              placeholder="Value"
              value={editValue}
              onChangeText={setEditValue}
              multiline={!editSecret}
            />

            <Row style={{ justifyContent: 'space-between', paddingVertical: space(0.5) }}>
              <Text style={s.switchLabel}>Secret (Masked)</Text>
              <Switch
                value={editSecret}
                onValueChange={setEditSecret}
                trackColor={{ true: colors.accent }}
              />
            </Row>

            <Row style={{ justifyContent: 'space-between', paddingVertical: space(0.5) }}>
              <Text style={s.switchLabel}>Pin to top</Text>
              <Switch
                value={editPinned}
                onValueChange={setEditPinned}
                trackColor={{ true: colors.accent }}
              />
            </Row>

            <Button
              title="Save changes"
              onPress={() => editLabel.trim() && editValue.trim() && updateMutation.mutate()}
              loading={updateMutation.isPending}
            />

            <Button
              title="Delete detail"
              variant="danger"
              onPress={() =>
                Alert.alert('Delete detail?', `Delete "${editingEntry?.label}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => removeMutation.mutate(editingEntry!.id),
                  },
                ])
              }
              loading={removeMutation.isPending}
            />

            <Button title="Cancel" variant="ghost" onPress={() => setEditingEntry(null)} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Wi-Fi QR Code & Fast Connect Modal */}
      <Modal
        visible={!!wifiModalEntry}
        transparent
        animationType="slide"
        onRequestClose={() => setWifiModalEntry(null)}
      >
        <Pressable style={s.backdrop} onPress={() => setWifiModalEntry(null)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: space(0.5) }}>
                <Row style={{ gap: space(0.75), alignItems: 'center' }}>
                  <Text style={{ fontSize: 24 }}>📶</Text>
                  <Text style={s.sheetTitle}>Wi-Fi Fast Connect</Text>
                </Row>
                <Pressable onPress={() => setWifiModalEntry(null)} style={{ padding: space(0.5) }}>
                  <Text style={{ fontSize: 18, color: colors.muted }}>✕</Text>
                </Pressable>
              </Row>

              <Muted style={{ marginBottom: space(1) }}>
                Point any iPhone or Android camera at this QR code to join automatically without typing the password!
              </Muted>

              {/* QR Code Container */}
              <View style={s.qrContainer}>
                {wifiModalEntry && (
                  <Image
                    source={{
                      uri: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=12&data=${encodeURIComponent(
                        `WIFI:T:WPA;S:${wifiSsid};P:${wifiModalEntry.value};;`
                      )}`,
                    }}
                    style={s.qrImage}
                    resizeMode="contain"
                  />
                )}
                <Text style={s.qrHint}>📸 Scan with phone camera to connect</Text>
              </View>

              {/* Wi-Fi Details Card */}
              <View style={s.wifiDetailsCard}>
                <Muted style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                  NETWORK NAME (SSID)
                </Muted>
                <Input
                  value={wifiSsid}
                  onChangeText={setWifiSsid}
                  placeholder="Network SSID"
                  style={{ marginTop: 4, marginBottom: space(1) }}
                />

                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1, marginRight: space(1) }}>
                    <Muted style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                      PASSWORD
                    </Muted>
                    <Text style={s.wifiPasswordText} selectable>
                      {wifiModalEntry?.value}
                    </Text>
                  </View>
                  <Pressable
                    onPress={async () => {
                      if (!wifiModalEntry) return;
                      await Clipboard.setStringAsync(wifiModalEntry.value);
                      setWifiPasswordCopied(true);
                      setTimeout(() => setWifiPasswordCopied(false), 2000);
                    }}
                    style={[s.wifiModalCopyBtn, wifiPasswordCopied && s.wifiModalCopyBtnActive]}
                  >
                    <Text style={[s.wifiModalCopyText, wifiPasswordCopied && s.wifiModalCopyTextActive]}>
                      {wifiPasswordCopied ? '✓ Copied' : '⧉ Copy'}
                    </Text>
                  </Pressable>
                </Row>
              </View>

              <Button
                title={wifiPasswordCopied ? '✓ Password Copied to Clipboard' : '⧉ Copy Wi-Fi Password'}
                onPress={async () => {
                  if (!wifiModalEntry) return;
                  await Clipboard.setStringAsync(wifiModalEntry.value);
                  setWifiPasswordCopied(true);
                  setTimeout(() => setWifiPasswordCopied(false), 2000);
                }}
                style={{ marginTop: space(1.5), backgroundColor: colors.accent }}
              />

              <Button
                title="Close"
                variant="ghost"
                onPress={() => setWifiModalEntry(null)}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  addBtn: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: space(1.5),
    paddingVertical: space(0.75),
    borderRadius: radius,
  },
  addBtnText: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 14,
  },
  filterChip: {
    paddingHorizontal: space(1.5),
    paddingVertical: space(0.75),
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  filterChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: space(0.75),
  },
  entryCard: {
    paddingVertical: space(1.25),
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  entryLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pinnedIcon: {
    fontSize: 14,
  },
  secretBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: space(0.75),
    paddingVertical: 2,
    borderRadius: 4,
  },
  secretBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400E',
  },
  entryValue: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink,
  },
  entryValueMasked: {
    color: colors.accent,
    letterSpacing: 1,
  },
  iconBtn: {
    padding: space(0.75),
    backgroundColor: '#F9F8F6',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  iconBtnText: {
    fontSize: 15,
    color: colors.ink,
    fontWeight: '600',
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: space(0.5),
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    padding: space(2.5),
    borderTopLeftRadius: radius * 1.5,
    borderTopRightRadius: radius * 1.5,
    gap: space(1),
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
  },
  categoryChip: {
    paddingHorizontal: space(1.25),
    paddingVertical: space(0.75),
    borderRadius: radius,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  categoryChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  categoryChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  categoryChipTextActive: {
    color: colors.accent,
  },
  wifiQuickBox: {
    marginTop: space(0.75),
  },
  wifiQrActionBtn: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: space(1.25),
    paddingVertical: space(0.5),
    borderRadius: 8,
  },
  wifiQrActionText: {
    color: '#4338CA',
    fontWeight: '700',
    fontSize: 12,
  },
  wifiCopyActionBtn: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space(1),
    paddingVertical: space(0.5),
    borderRadius: 8,
  },
  wifiCopyActionText: {
    color: colors.ink,
    fontWeight: '600',
    fontSize: 12,
  },
  qrContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    padding: space(2),
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.line,
    marginVertical: space(1),
  },
  qrImage: {
    width: 220,
    height: 220,
    borderRadius: 8,
  },
  qrHint: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
    marginTop: space(1),
  },
  wifiDetailsCard: {
    backgroundColor: '#F9F8F6',
    padding: space(1.5),
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: space(1),
  },
  wifiPasswordText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  wifiModalCopyBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space(1.25),
    paddingVertical: space(0.6),
    borderRadius: 8,
  },
  wifiModalCopyBtnActive: {
    backgroundColor: '#DEF7EC',
    borderColor: '#31C48D',
  },
  wifiModalCopyText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.ink,
  },
  wifiModalCopyTextActive: {
    color: '#03543F',
  },
});
