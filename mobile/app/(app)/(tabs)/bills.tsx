import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { api } from '@/api/client';
import { BILL_CATEGORY_CONFIG, type BillCategory, type HouseholdBill } from '@/api/types';
import { friendlyError } from '@/lib/errors';
import { formatRupees, relativeDue, shortDate } from '@/lib/format';
import { useActiveHome } from '@/store/home';
import { useSession } from '@/store/session';
import {
  Button, Card, Chip, CountUp, DateField, EmptyState, Icon, IconButton, Input, PaidStamp, Pill, Pressable, Screen, Sheet, Text,
  category, color, radius, space, status, useRoofRefresh,
} from '@/ui';

const CATEGORIES: BillCategory[] = ['electricity', 'internet', 'water', 'gas', 'maintenance', 'maid', 'other'];
const catKey = (c: string): BillCategory => (CATEGORIES.includes(c as BillCategory) ? (c as BillCategory) : 'other');
const monthLabel = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const parseAmount = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };

export default function BillsScreen() {
  const qc = useQueryClient();
  const homeId = useActiveHome((s) => s.activeHomeId);
  const me = useSession((s) => s.user);
  const [filter, setFilter] = useState<'all' | 'due' | 'paid'>('all');
  const [copied, setCopied] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [aCat, setACat] = useState<BillCategory>('electricity');
  const [aTitle, setATitle] = useState('');
  const [aAmount, setAAmount] = useState('');
  const [aDue, setADue] = useState<string | null>(null);
  const [aAccount, setAAccount] = useState('');
  const [aPeriod, setAPeriod] = useState(monthLabel(new Date()));
  const [aNotes, setANotes] = useState('');
  const [aError, setAError] = useState<string | null>(null);

  const [payBill, setPayBill] = useState<HouseholdBill | null>(null);
  const [payer, setPayer] = useState<string | null>(null);
  const [payRef, setPayRef] = useState('Paid via UPI / GPay');

  const [moreBill, setMoreBill] = useState<HouseholdBill | null>(null);
  const [cycleBill, setCycleBill] = useState<HouseholdBill | null>(null);
  const [cPeriod, setCPeriod] = useState('');
  const [cAmount, setCAmount] = useState('');
  const [cDue, setCDue] = useState<string | null>(null);
  const [cError, setCError] = useState<string | null>(null);

  const { data: home } = useQuery({ queryKey: ['home', homeId], queryFn: () => api.home(homeId!), enabled: !!homeId });
  const { data: bills = [], refetch, isRefetching } = useQuery({ queryKey: ['bills', homeId], queryFn: () => api.bills(homeId!), enabled: !!homeId });
  const { onScroll, refreshControl, indicator } = useRoofRefresh({ refreshing: isRefetching, onRefresh: refetch });
  const members = home?.members ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bills', homeId] });
    qc.invalidateQueries({ queryKey: ['activity', homeId] });
  };

  const create = useMutation({
    mutationFn: () => api.createBill(homeId!, {
      title: aTitle.trim(), category: aCat, amount_cents: parseAmount(aAmount) ?? undefined,
      account_number: aAccount.trim() || undefined, due_date: aDue ?? undefined, billing_period: aPeriod.trim(), notes: aNotes.trim() || undefined,
    }),
    onSuccess: () => {
      setAddOpen(false); setATitle(''); setAAmount(''); setADue(null); setAAccount(''); setANotes(''); setAError(null);
      invalidate();
    },
    onError: (e) => setAError(friendlyError(e, 'generic')),
  });
  const pay = useMutation({
    mutationFn: (b: HouseholdBill) => api.payBill(b.id, { paid_by: payer ?? undefined, payment_ref: payRef.trim() || undefined }),
    onSuccess: (_d, b) => { setJustPaid(b.id); setPayBill(null); invalidate(); },
    onError: (e) => Alert.alert('Could not mark as paid', friendlyError(e, 'generic')),
  });
  const unpay = useMutation({
    mutationFn: (id: string) => api.unpayBill(id),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not undo the payment', friendlyError(e, 'generic')),
  });
  const nextCycle = useMutation({
    mutationFn: (b: HouseholdBill) => api.newCycleBill(b.id, { billing_period: cPeriod.trim(), due_date: cDue ?? undefined, amount_cents: parseAmount(cAmount) ?? undefined }),
    onSuccess: () => { setCycleBill(null); setCError(null); invalidate(); },
    onError: (e) => setCError(friendlyError(e, 'generic')),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteBill(id),
    onSuccess: invalidate,
    onError: (e) => Alert.alert('Could not delete bill', friendlyError(e, 'generic')),
  });

  const unpaid = useMemo(() => bills.filter((b) => !b.is_paid), [bills]);
  const paid = useMemo(() => bills.filter((b) => b.is_paid), [bills]);
  const shown = filter === 'due' ? unpaid : filter === 'paid' ? paid : bills;
  const totalDue = unpaid.reduce((n, b) => n + (b.amount_cents ?? 0), 0);

  const payerName = (b: HouseholdBill) => {
    if (!b.paid_by) return 'Someone';
    if (b.paid_by === me?.id) return 'You';
    return members.find((m) => m.user_id === b.paid_by)?.display_name ?? b.paid_by_name ?? 'Flatmate';
  };
  const copy = async (b: HouseholdBill) => {
    if (!b.account_number) return;
    await Clipboard.setStringAsync(b.account_number);
    setCopied(b.id);
    setTimeout(() => setCopied(null), 2000);
  };
  const openPay = (b: HouseholdBill) => { setPayBill(b); setPayer(me?.id ?? null); setPayRef('Paid via UPI / GPay'); };
  const openCycle = (b: HouseholdBill) => {
    const now = new Date();
    setCycleBill(b);
    setCPeriod(monthLabel(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
    setCAmount(b.amount_cents === null ? '' : String(b.amount_cents / 100));
    setCDue(b.due_date);
    setCError(null);
  };
  const submitAdd = () => {
    if (!aTitle.trim()) return setAError('Please enter a title.');
    if (parseAmount(aAmount) === null) return setAError('Please enter a valid amount.');
    if (!aPeriod.trim()) return setAError('Please enter a billing period.');
    setAError(null);
    create.mutate();
  };

  return (
    <Screen>
      {indicator}
      <Animated.FlatList
        data={shown}
        keyExtractor={(b) => b.id}
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={refreshControl}
        contentContainerStyle={{ gap: space(3), paddingTop: space(2), paddingBottom: space(10) }}
        ListHeaderComponent={
          <View style={{ gap: space(3) }}>
            <View style={s.header}>
              <Text variant="display">Bills</Text>
              <Button title="Add bill" icon="add" size="sm" onPress={() => setAddOpen(true)} />
            </View>
            {bills.length > 0 ? (
              unpaid.length > 0 ? (
                <View style={[s.banner, { backgroundColor: status.warnSoft }]}>
                  <View style={s.bannerIcon}><Icon name="due" tint={status.warn} /></View>
                  <View style={{ flex: 1 }}>
                    <Text variant="headline" color={status.warnInk}>{unpaid.length} {unpaid.length === 1 ? 'bill' : 'bills'} due this month</Text>
                    <Text variant="label" color={status.warnInk}>Pay in your utility app, then mark it paid so nobody pays twice.</Text>
                  </View>
                  <CountUp value={totalDue} format={formatRupees} color={status.warnInk} />
                </View>
              ) : (
                <View style={[s.banner, { backgroundColor: status.okSoft }]}>
                  <View style={s.bannerIcon}><Icon name="paid" tint={status.ok} /></View>
                  <View style={{ flex: 1 }}>
                    <Text variant="headline" tone="ok">All bills paid</Text>
                    <Text variant="label" tone="ok">Nobody needs to pay anything right now.</Text>
                  </View>
                </View>
              )
            ) : null}
            {bills.length > 0 ? (
              <View style={{ flexDirection: 'row', gap: space(2) }}>
                <Chip label={`All ${bills.length}`} selected={filter === 'all'} onPress={() => setFilter('all')} />
                <Chip label={`Due ${unpaid.length}`} selected={filter === 'due'} onPress={() => setFilter('due')} />
                <Chip label={`Paid ${paid.length}`} selected={filter === 'paid'} onPress={() => setFilter('paid')} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="bill.electricity"
            title={bills.length === 0 ? 'No household bills yet' : filter === 'due' ? 'Nothing due' : 'No paid bills yet'}
            body="Track electricity, Wi-Fi, water, piped gas, and society maintenance so nobody pays twice."
            actionLabel={bills.length === 0 ? 'Add your first bill' : undefined}
            onAction={bills.length === 0 ? () => setAddOpen(true) : undefined}
          />
        }
        renderItem={({ item: b }) => {
          const cat = catKey(b.category);
          const tint = category.bill[cat];
          const due = relativeDue(b.due_date, new Date());
          return (
            <Card style={{ gap: space(3) }}>
              <View style={s.billTop}>
                <View style={[s.tile, { backgroundColor: tint.bg }]}><Icon name={`bill.${cat}`} tint={tint.fg} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="headline" numberOfLines={1}>{b.title}</Text>
                  <Text variant="label" tone="muted" numberOfLines={1}>{BILL_CATEGORY_CONFIG[cat].label} · {b.billing_period}</Text>
                </View>
                <Text variant="headline" tone={b.is_paid ? 'muted' : 'ink'} style={{ fontSize: 20, lineHeight: 26, fontVariant: ['tabular-nums'] }}>{formatRupees(b.amount_cents)}</Text>
              </View>

              {!b.is_paid ? (
                due ? <Pill label={due.label} tone={due.tone} icon="due" /> : <Pill label={`Unpaid for ${b.billing_period}`} tone="warn" icon="due" />
              ) : null}

              {b.account_number ? (
                <View style={s.account}>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption" tone="muted">Consumer ID</Text>
                    <Text variant="mono" selectable>{b.account_number}</Text>
                  </View>
                  <IconButton icon={copied === b.id ? 'copied' : 'copy'} label="Copy consumer ID" tint={copied === b.id ? status.ok : undefined} onPress={() => copy(b)} />
                </View>
              ) : null}

              {b.notes ? <Text variant="label" tone="muted">{b.notes}</Text> : null}

              {b.is_paid ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                  <View style={{ flex: 1 }}>
                    <PaidStamp by={payerName(b)} when={b.paid_at ? shortDate(new Date(b.paid_at)) : 'recently'} refText={b.payment_ref} animate={justPaid === b.id} />
                  </View>
                  <IconButton icon="more" label={`More options for ${b.title}`} variant="outlined" onPress={() => setMoreBill(b)} />
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
                  <Button title="Mark as paid" onPress={() => openPay(b)} style={{ flex: 1 }} />
                  <IconButton icon="more" label={`More options for ${b.title}`} variant="outlined" onPress={() => setMoreBill(b)} />
                </View>
              )}
            </Card>
          );
        }}
      />

      <Sheet visible={addOpen} onClose={() => setAddOpen(false)} title="Add a bill">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
          {CATEGORIES.map((c) => <Chip key={c} label={BILL_CATEGORY_CONFIG[c].label} icon={`bill.${c}`} selected={aCat === c} onPress={() => setACat(c)} />)}
        </ScrollView>
        <Input label="Title" placeholder="e.g. Electricity (BESCOM), Airtel Fiber" value={aTitle} onChangeText={setATitle} />
        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <Input label="Amount (₹)" placeholder="1850" keyboardType="decimal-pad" value={aAmount} onChangeText={setAAmount} containerStyle={{ flex: 1 }} />
          <View style={{ flex: 1 }}><DateField label="Due date" value={aDue} onChange={setADue} /></View>
        </View>
        <Input label="Consumer / account ID" placeholder="e.g. 102938491" value={aAccount} onChangeText={setAAccount} />
        <Input label="Billing period" placeholder="e.g. October 2026" value={aPeriod} onChangeText={setAPeriod} />
        <View style={{ gap: space(3) }}>
          <Input label="Notes" placeholder="e.g. Auto-pay off, pay before 5 PM" value={aNotes} onChangeText={setANotes} error={aError} />
          <Button title="Add bill" fullWidth loading={create.isPending} onPress={submitAdd} />
        </View>
      </Sheet>

      <Sheet visible={!!payBill} onClose={() => setPayBill(null)} title="Confirm payment">
        {payBill ? (
          <View style={s.paySummary}>
            <Text variant="headline" tone="ok">{payBill.title}</Text>
            <Text variant="display" color={status.okInk} style={{ fontSize: 26, lineHeight: 32, fontVariant: ['tabular-nums'] }}>{formatRupees(payBill.amount_cents)}</Text>
            {payBill.account_number ? <Text variant="label" tone="ok">Consumer ID {payBill.account_number}</Text> : null}
          </View>
        ) : null}
        <View style={{ gap: space(2) }}>
          <Text variant="label" tone="ink2">Who paid?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
            {members.map((m) => (
              <Chip key={m.user_id} label={m.user_id === me?.id ? 'You' : m.display_name} selected={(payer ?? me?.id) === m.user_id} onPress={() => setPayer(m.user_id)} />
            ))}
          </ScrollView>
        </View>
        <Input label="Payment reference" placeholder="e.g. UPI ref 102948, NetBanking" value={payRef} onChangeText={setPayRef} />
        <Button title="Confirm, mark as paid" fullWidth loading={pay.isPending} onPress={() => payBill && pay.mutate(payBill)} />
      </Sheet>

      <Sheet visible={!!moreBill} onClose={() => setMoreBill(null)} title={moreBill?.title}>
        <MoreRow icon="nextCycle" label="Start next cycle" onPress={() => { const b = moreBill!; setMoreBill(null); openCycle(b); }} />
        {moreBill?.is_paid ? (
          <MoreRow
            icon="undo"
            label="Undo payment"
            onPress={() => {
              const b = moreBill!; setMoreBill(null);
              Alert.alert('Mark as unpaid?', `Revert "${b.title}" back to pending payment?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Mark unpaid', style: 'destructive', onPress: () => unpay.mutate(b.id) },
              ]);
            }}
          />
        ) : null}
        <MoreRow
          icon="delete"
          label="Delete bill"
          danger
          onPress={() => {
            const b = moreBill!; setMoreBill(null);
            Alert.alert('Delete bill?', `Delete "${b.title}"?`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(b.id) },
            ]);
          }}
        />
      </Sheet>

      <Sheet visible={!!cycleBill} onClose={() => setCycleBill(null)} title="Start next cycle">
        <Text tone="muted">Roll over "{cycleBill?.title}" for the next billing cycle.</Text>
        <Input label="Billing period" placeholder="e.g. November 2026" value={cPeriod} onChangeText={setCPeriod} />
        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <Input label="Amount (₹)" placeholder="1850" keyboardType="decimal-pad" value={cAmount} onChangeText={setCAmount} containerStyle={{ flex: 1 }} />
          <View style={{ flex: 1 }}><DateField label="Due date" value={cDue} onChange={setCDue} /></View>
        </View>
        {cError ? <Text variant="label" tone="danger">{cError}</Text> : null}
        <Button
          title="Start next cycle"
          fullWidth
          loading={nextCycle.isPending}
          onPress={() => { if (!cPeriod.trim()) return setCError('Please enter the next billing period.'); if (cycleBill) nextCycle.mutate(cycleBill); }}
        />
      </Sheet>
    </Screen>
  );
}

function MoreRow({ icon, label, onPress, danger = false }: { icon: 'nextCycle' | 'undo' | 'delete'; label: string; onPress: () => void; danger?: boolean }) {
  const fg = danger ? status.danger : color.ink;
  return (
    <Pressable onPress={onPress} style={s.moreRow}>
      <Icon name={icon} tint={fg} />
      <Text variant="headline" color={fg}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(4), borderRadius: radius.lg },
  bannerIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', opacity: 0.85 },
  billTop: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  tile: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  account: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.bg, borderRadius: radius.md, paddingLeft: space(3), paddingVertical: space(1) },
  paySummary: { backgroundColor: status.okSoft, borderRadius: radius.lg, padding: space(4), gap: 2 },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(3), paddingHorizontal: space(1) },
});
