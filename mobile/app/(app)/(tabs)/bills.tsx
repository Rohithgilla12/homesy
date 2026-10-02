import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { api } from '@/api/client';
import {
  BILL_CATEGORY_CONFIG,
  type BillCategory,
  type HouseholdBill,
} from '@/api/types';
import { useActiveHome } from '@/store/home';
import { useSession } from '@/store/session';
import { Button, Card, Input, Muted, Row, Screen } from '@/ui/primitives';
import { colors, radius, space } from '@/ui/theme';

// The backend stores due_date as a SQL `date`, so only ISO dates deserialize.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDueDate(input: string): string | undefined {
  const v = input.trim();
  if (!v) return undefined;
  if (!ISO_DATE.test(v) || Number.isNaN(new Date(v).getTime())) {
    throw new Error('Due date must be in YYYY-MM-DD format, e.g. 2026-10-15.');
  }
  return v;
}

const CATEGORIES: BillCategory[] = [
  'electricity',
  'internet',
  'water',
  'gas',
  'maintenance',
  'maid',
  'other',
];

export default function BillsScreen() {
  const qc = useQueryClient();
  const homeId = useActiveHome((s) => s.activeHomeId);
  const currentUserId = useSession((s) => s.user?.id);

  // Active filter tab: 'all' | 'unpaid' | 'paid'
  const [filterTab, setFilterTab] = useState<'all' | 'unpaid' | 'paid'>('all');

  // Copy feedback state
  const [copiedBillId, setCopiedBillId] = useState<string | null>(null);

  // Add Bill Modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addCategory, setAddCategory] = useState<BillCategory>('electricity');
  const [addAmountStr, setAddAmountStr] = useState('');
  const [addConsumerId, setAddConsumerId] = useState('');
  const [addDueDate, setAddDueDate] = useState('');
  const [addBillingPeriod, setAddBillingPeriod] = useState(
    new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  );
  const [addNotes, setAddNotes] = useState('');

  // Mark as Paid Modal state
  const [payModalBill, setPayModalBill] = useState<HouseholdBill | null>(null);
  const [paidByUserId, setPaidByUserId] = useState<string | null>(null);
  const [paymentNotes, setPaymentNotes] = useState('Paid via UPI');

  // Next Cycle Modal state
  const [nextCycleBill, setNextCycleBill] = useState<HouseholdBill | null>(null);
  const [nextCyclePeriod, setNextCyclePeriod] = useState('');
  const [nextCycleDueDate, setNextCycleDueDate] = useState('');
  const [nextCycleAmountStr, setNextCycleAmountStr] = useState('');

  // Queries
  const { data: homeDetail } = useQuery({
    queryKey: ['home', homeId],
    queryFn: () => api.home(homeId!),
    enabled: !!homeId,
  });

  const {
    data: bills = [],
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['bills', homeId],
    queryFn: () => api.bills(homeId!),
    enabled: !!homeId,
  });

  const members = homeDetail?.members ?? [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bills', homeId] });
    qc.invalidateQueries({ queryKey: ['activity', homeId] });
  };

  // Mutations
  const createMutation = useMutation({
    mutationFn: () => {
      const amount = parseFloat(addAmountStr);
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Please enter a valid amount.');
      }
      const cents = Math.round(amount * 100);
      const billingPeriod = addBillingPeriod.trim();
      if (!billingPeriod) throw new Error('Please enter a billing period.');
      return api.createBill(homeId!, {
        title: addTitle.trim(),
        category: addCategory,
        amount_cents: cents,
        account_number: addConsumerId.trim() || undefined,
        due_date: parseDueDate(addDueDate),
        billing_period: billingPeriod,
        notes: addNotes.trim() || undefined,
      });
    },
    onSuccess: () => {
      setAddModalOpen(false);
      setAddTitle('');
      setAddCategory('electricity');
      setAddAmountStr('');
      setAddConsumerId('');
      setAddDueDate('');
      setAddNotes('');
      invalidate();
    },
    onError: (e: Error) => Alert.alert('Could not add bill', e.message),
  });

  const payMutation = useMutation({
    mutationFn: ({
      billId,
      paidBy,
      notes,
    }: {
      billId: string;
      paidBy?: string;
      notes?: string;
    }) => api.payBill(billId, { paid_by: paidBy, payment_ref: notes }),
    onSuccess: () => {
      setPayModalBill(null);
      invalidate();
    },
    onError: (e: Error) => Alert.alert('Could not mark as paid', e.message),
  });

  const unpayMutation = useMutation({
    mutationFn: (billId: string) => api.unpayBill(billId),
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert('Could not revert bill', e.message),
  });

  const nextCycleMutation = useMutation({
    mutationFn: ({
      billId,
      period,
      dueDate,
      amountCents,
    }: {
      billId: string;
      period: string;
      dueDate: string;
      amountCents?: number;
    }) => {
      if (!period) throw new Error('Please enter the next billing period.');
      return api.newCycleBill(billId, {
        billing_period: period,
        due_date: parseDueDate(dueDate),
        amount_cents: amountCents,
      });
    },
    onSuccess: () => {
      setNextCycleBill(null);
      invalidate();
    },
    onError: (e: Error) => Alert.alert('Could not start next cycle', e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (billId: string) => api.deleteBill(billId),
    onSuccess: invalidate,
    onError: (e: Error) => Alert.alert('Could not delete bill', e.message),
  });

  // Derived statistics
  const unpaidBills = useMemo(() => bills.filter((b) => !b.is_paid), [bills]);
  const paidBills = useMemo(() => bills.filter((b) => b.is_paid), [bills]);

  const totalUnpaidCents = useMemo(
    () => unpaidBills.reduce((sum, b) => sum + (b.amount_cents || 0), 0),
    [unpaidBills]
  );

  const displayedBills = useMemo(() => {
    if (filterTab === 'unpaid') return unpaidBills;
    if (filterTab === 'paid') return paidBills;
    return bills;
  }, [filterTab, unpaidBills, paidBills, bills]);

  const formatCurrency = (cents: number | null) => {
    if (cents === null) return '—';
    const rupees = cents / 100;
    return `₹${rupees.toLocaleString('en-IN', {
      maximumFractionDigits: 2,
    })}`;
  };

  const handleCopyConsumerId = async (bill: HouseholdBill) => {
    const acc = bill.account_number;
    if (!acc) return;
    await Clipboard.setStringAsync(acc);
    setCopiedBillId(bill.id);
    setTimeout(() => setCopiedBillId(null), 2000);
  };

  const openPayModal = (bill: HouseholdBill) => {
    setPayModalBill(bill);
    setPaidByUserId(currentUserId || null);
    setPaymentNotes('Paid via UPI / GPay');
  };

  const openNextCycleModal = (bill: HouseholdBill) => {
    setNextCycleBill(bill);
    setNextCycleAmountStr(bill.amount_cents === null ? '' : (bill.amount_cents / 100).toString());
    // Guess next month
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    setNextCyclePeriod(
      nextMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    );
    setNextCycleDueDate(bill.due_date || '');
  };

  const getPayerName = (bill: HouseholdBill) => {
    if (!bill.paid_by) return 'Someone';
    if (bill.paid_by === currentUserId) return 'You';
    const m = members.find((mem) => mem.user_id === bill.paid_by);
    return m?.display_name || bill.paid_by_name || 'Flatmate';
  };

  return (
    <Screen>
      {/* Top Header */}
      <Row style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: space(1.5) }}>
        <View>
          <Text style={s.pageTitle}>Bills & Utilities</Text>
          <Muted>Prevent double-paying household utilities</Muted>
        </View>
        <Button
          title="+ Add bill"
          onPress={() => {
            const currentPeriod = new Date().toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            });
            setAddBillingPeriod(currentPeriod);
            setAddModalOpen(true);
          }}
          style={s.headerAddBtn}
        />
      </Row>

      {/* Household Bill Status Banner */}
      {bills.length > 0 && (
        <View style={{ marginBottom: space(1.5) }}>
          {unpaidBills.length > 0 ? (
            <Card style={s.warningBanner}>
              <Row style={{ gap: space(1.25), alignItems: 'flex-start' }}>
                <Text style={s.warningIcon}>⚠️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.warningTitle}>
                    {unpaidBills.length} {unpaidBills.length === 1 ? 'bill' : 'bills'} due this month —{' '}
                    {formatCurrency(totalUnpaidCents)} pending
                  </Text>
                  <Text style={s.warningSubtitle}>
                    Pay on your utility app & tap "Mark as Paid" to protect flatmates from paying twice.
                  </Text>
                </View>
              </Row>
            </Card>
          ) : (
            <Card style={s.protectedBanner}>
              <Row style={{ gap: space(1.25), alignItems: 'center' }}>
                <Text style={s.shieldIcon}>🛡️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.protectedTitle}>All household bills paid! No pending dues.</Text>
                  <Text style={s.protectedSubtitle}>
                    Everyone in the house is safe from double-charging and late penalties.
                  </Text>
                </View>
              </Row>
            </Card>
          )}
        </View>
      )}

      {/* Filter Tabs */}
      <View style={{ marginBottom: space(1.5) }}>
        <Row style={{ gap: space(0.75) }}>
          <Pressable
            onPress={() => setFilterTab('all')}
            style={[s.tabChip, filterTab === 'all' && s.tabChipActive]}
          >
            <Text style={[s.tabChipText, filterTab === 'all' && s.tabChipTextActive]}>
              All ({bills.length})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFilterTab('unpaid')}
            style={[s.tabChip, filterTab === 'unpaid' && s.tabChipActiveUnpaid]}
          >
            <Text style={[s.tabChipText, filterTab === 'unpaid' && s.tabChipTextActiveUnpaid]}>
              🔴 Due ({unpaidBills.length})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setFilterTab('paid')}
            style={[s.tabChip, filterTab === 'paid' && s.tabChipActivePaid]}
          >
            <Text style={[s.tabChipText, filterTab === 'paid' && s.tabChipTextActivePaid]}>
              🟢 Paid ({paidBills.length})
            </Text>
          </Pressable>
        </Row>
      </View>

      {/* Bill Cards List */}
      <FlatList
        data={displayedBills}
        keyExtractor={(item) => item.id}
        refreshing={isRefetching}
        onRefresh={refetch}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ gap: space(1.5), paddingBottom: space(5) }}
        ListEmptyComponent={
          <Card style={{ alignItems: 'center', paddingVertical: space(4) }}>
            <Text style={{ fontSize: 36, marginBottom: space(1) }}>⚡</Text>
            <Text style={s.emptyTitle}>
              {bills.length === 0
                ? 'No household bills tracked yet'
                : filterTab === 'unpaid'
                ? 'No unpaid bills due!'
                : 'No paid bills yet'}
            </Text>
            <Muted style={{ textAlign: 'center', marginHorizontal: space(2) }}>
              Track electricity, Wi-Fi, water, piped gas, and society maintenance so nobody pays twice.
            </Muted>
            {bills.length === 0 && (
              <Button
                title="+ Add first household bill"
                onPress={() => setAddModalOpen(true)}
                style={{ marginTop: space(2) }}
              />
            )}
          </Card>
        }
        renderItem={({ item }) => {
          const categoryConfig =
            BILL_CATEGORY_CONFIG[item.category as BillCategory] ||
            BILL_CATEGORY_CONFIG.other;
          const consumerNum = item.account_number;
          const isCopied = copiedBillId === item.id;
          const payerName = getPayerName(item);

          return (
            <Card style={[s.billCard, item.is_paid ? s.billCardPaid : s.billCardUnpaid]}>
              {/* Card Header: Category & Status Badge */}
              <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Row style={{ gap: space(1), alignItems: 'center', flex: 1 }}>
                  <View
                    style={[
                      s.categoryIconContainer,
                      { backgroundColor: `${categoryConfig.color}20` },
                    ]}
                  >
                    <Text style={{ fontSize: 20 }}>{categoryConfig.icon}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.billTitle}>{item.title}</Text>
                    <Row style={{ gap: space(0.75), alignItems: 'center', marginTop: 2 }}>
                      <Text style={[s.categoryLabel, { color: categoryConfig.color }]}>
                        {categoryConfig.label}
                      </Text>
                      {item.billing_period ? (
                        <>
                          <Text style={s.metaDot}>•</Text>
                          <Muted style={s.metaText}>{item.billing_period}</Muted>
                        </>
                      ) : null}
                    </Row>
                  </View>
                </Row>

                {/* Amount display */}
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.amountText}>{formatCurrency(item.amount_cents)}</Text>
                </View>
              </Row>

              {/* Status Banner inside card */}
              {item.is_paid ? (
                /* PAID STATE - HIGH PROTECTION BANNER */
                <View style={s.paidProtectionBadge}>
                  <Row style={{ gap: space(0.75), alignItems: 'center' }}>
                    <Text style={{ fontSize: 16 }}>🛡️</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.paidProtectionHeading}>
                        ALREADY PAID — DO NOT RE-PAY
                      </Text>
                      <Text style={s.paidProtectionSub}>
                        Paid by {payerName}
                        {item.paid_at
                          ? ` on ${new Date(item.paid_at).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                            })}`
                          : ''}
                        {item.payment_ref ? ` • ${item.payment_ref}` : ''}
                      </Text>
                    </View>
                  </Row>
                </View>
              ) : (
                /* UNPAID STATE - DUE DATE BANNER */
                <View style={s.unpaidDueBadge}>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Row style={{ gap: space(0.75), alignItems: 'center' }}>
                      <Text style={{ fontSize: 14 }}>🔴</Text>
                      <Text style={s.unpaidDueText}>
                        {item.due_date
                          ? `DUE on ${item.due_date}`
                          : item.billing_period
                          ? `UNPAID for ${item.billing_period}`
                          : 'PAYMENT PENDING'}
                      </Text>
                    </Row>
                    <Muted style={{ fontSize: 11, fontWeight: '600' }}>Avoid late fees</Muted>
                  </Row>
                </View>
              )}

              {/* Consumer / Account Number Section with Quick Copy */}
              {consumerNum ? (
                <View style={s.consumerBox}>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.consumerLabel}>CONSUMER / ACCOUNT ID</Text>
                      <Text style={s.consumerValue} selectable>
                        {consumerNum}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => handleCopyConsumerId(item)}
                      style={[s.copyBtn, isCopied && s.copyBtnActive]}
                    >
                      <Text style={[s.copyBtnText, isCopied && s.copyBtnTextActive]}>
                        {isCopied ? '✓ Copied!' : '⧉ Copy ID'}
                      </Text>
                    </Pressable>
                  </Row>
                </View>
              ) : null}

              {/* Notes if present */}
              {item.notes ? (
                <View style={s.notesBox}>
                  <Text style={s.notesText}>💬 {item.notes}</Text>
                </View>
              ) : null}

              {/* Action Buttons */}
              <View style={s.actionsRow}>
                {item.is_paid ? (
                  /* Paid Actions: Start next month cycle & Undo */
                  <Row style={{ justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <Button
                      title="🔄 Start next cycle"
                      onPress={() => openNextCycleModal(item)}
                      style={s.cycleBtn}
                    />
                    <Row style={{ gap: space(1) }}>
                      <Pressable
                        onPress={() =>
                          Alert.alert(
                            'Mark as Unpaid?',
                            `Revert "${item.title}" back to pending payment?`,
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Mark Unpaid',
                                style: 'destructive',
                                onPress: () => unpayMutation.mutate(item.id),
                              },
                            ]
                          )
                        }
                        style={s.undoBtn}
                      >
                        <Text style={s.undoBtnText}>↩ Undo</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          Alert.alert('Delete bill?', `Delete "${item.title}"?`, [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Delete',
                              style: 'destructive',
                              onPress: () => deleteMutation.mutate(item.id),
                            },
                          ])
                        }
                        style={s.deleteBtn}
                      >
                        <Text style={s.deleteBtnText}>✕</Text>
                      </Pressable>
                    </Row>
                  </Row>
                ) : (
                  /* Unpaid Actions: Big Prominent "✓ Mark as Paid" button */
                  <Row style={{ justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <Button
                      title="✓ Mark as Paid"
                      onPress={() => openPayModal(item)}
                      style={s.claimPayBtn}
                    />
                    <Pressable
                      onPress={() =>
                        Alert.alert('Delete bill?', `Delete "${item.title}"?`, [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => deleteMutation.mutate(item.id),
                          },
                        ])
                      }
                      style={s.deleteBtn}
                    >
                      <Text style={s.deleteBtnText}>✕</Text>
                    </Pressable>
                  </Row>
                )}
              </View>
            </Card>
          );
        }}
      />

      {/* Add Bill Modal */}
      <Modal
        visible={addModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddModalOpen(false)}
      >
        <Pressable style={s.backdrop} onPress={() => setAddModalOpen(false)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.sheetTitle}>+ Add Household Bill</Text>
              <Muted style={{ marginBottom: space(1) }}>
                Track a recurring utility so everyone knows when it's due and who paid it.
              </Muted>

              {/* Category Chips */}
              <Muted>Category</Muted>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginVertical: space(0.75) }}
              >
                <Row style={{ gap: space(0.75) }}>
                  {CATEGORIES.map((cat) => {
                    const cfg = BILL_CATEGORY_CONFIG[cat];
                    const isSelected = addCategory === cat;
                    return (
                      <Pressable
                        key={cat}
                        onPress={() => setAddCategory(cat)}
                        style={[s.categoryChip, isSelected && s.categoryChipActive]}
                      >
                        <Text style={[s.categoryChipText, isSelected && s.categoryChipTextActive]}>
                          {cfg.icon} {cfg.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </Row>
              </ScrollView>

              <Muted>Bill Title</Muted>
              <Input
                placeholder="e.g. Electricity (BESCOM), Airtel Fiber Wi-Fi"
                value={addTitle}
                onChangeText={setAddTitle}
              />

              <Row style={{ gap: space(1) }}>
                <View style={{ flex: 1 }}>
                  <Muted>Amount (₹)</Muted>
                  <Input
                    placeholder="e.g. 1850"
                    keyboardType="decimal-pad"
                    value={addAmountStr}
                    onChangeText={setAddAmountStr}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Muted>Due Date</Muted>
                  <Input
                    placeholder="YYYY-MM-DD"
                    value={addDueDate}
                    onChangeText={setAddDueDate}
                  />
                </View>
              </Row>

              <Muted>Consumer / Account ID (for fast copy)</Muted>
              <Input
                placeholder="e.g. BESCOM Consumer ID: 102938491"
                value={addConsumerId}
                onChangeText={setAddConsumerId}
              />

              <Muted>Billing Period</Muted>
              <Input
                placeholder="e.g. October 2026"
                value={addBillingPeriod}
                onChangeText={setAddBillingPeriod}
              />

              <Muted>Notes / Portal Link</Muted>
              <Input
                placeholder="e.g. Auto-pay off, pay before 5 PM to avoid penalty"
                value={addNotes}
                onChangeText={setAddNotes}
              />

              <Button
                title="Add to Household Bills"
                onPress={() => addTitle.trim() && addAmountStr.trim() && createMutation.mutate()}
                loading={createMutation.isPending}
                style={{ marginTop: space(1) }}
              />
              <Button title="Cancel" variant="ghost" onPress={() => setAddModalOpen(false)} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Mark as Paid Modal */}
      <Modal
        visible={!!payModalBill}
        transparent
        animationType="slide"
        onRequestClose={() => setPayModalBill(null)}
      >
        <Pressable style={s.backdrop} onPress={() => setPayModalBill(null)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>✓ Confirm Bill Payment</Text>
            {payModalBill && (
              <Card style={{ backgroundColor: '#F0FDF4', borderColor: '#BBF7D0', marginVertical: space(1) }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#166534' }}>
                  {payModalBill.title}
                </Text>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#14532D', marginTop: 2 }}>
                  {formatCurrency(payModalBill.amount_cents)}
                </Text>
                {payModalBill.account_number ? (
                  <Muted style={{ fontSize: 12, marginTop: 4, color: '#166534' }}>
                    Consumer ID: {payModalBill.account_number}
                  </Muted>
                ) : null}
              </Card>
            )}

            <Muted>Who paid this bill?</Muted>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: space(0.75) }}>
              <Row style={{ gap: space(0.75) }}>
                {members.map((m) => {
                  const isSelected = (paidByUserId || currentUserId) === m.user_id;
                  return (
                    <Pressable
                      key={m.user_id}
                      onPress={() => setPaidByUserId(m.user_id)}
                      style={[s.payerChip, isSelected && s.payerChipActive]}
                    >
                      <Text style={[s.payerChipText, isSelected && s.payerChipTextActive]}>
                        {m.user_id === currentUserId ? 'You' : m.display_name}
                      </Text>
                    </Pressable>
                  );
                })}
              </Row>
            </ScrollView>

            <Muted>Payment reference / notes</Muted>
            <Input
              placeholder="e.g. Paid via UPI, GPay Ref: 102948, NetBanking"
              value={paymentNotes}
              onChangeText={setPaymentNotes}
            />

            <Button
              title="Confirm & Mark as Paid 🛡️"
              onPress={() => {
                if (!payModalBill) return;
                payMutation.mutate({
                  billId: payModalBill.id,
                  paidBy: paidByUserId || currentUserId || undefined,
                  notes: paymentNotes.trim() || undefined,
                });
              }}
              loading={payMutation.isPending}
              style={{ backgroundColor: '#15803D', marginTop: space(1) }}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setPayModalBill(null)} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Start Next Cycle Modal */}
      <Modal
        visible={!!nextCycleBill}
        transparent
        animationType="slide"
        onRequestClose={() => setNextCycleBill(null)}
      >
        <Pressable style={s.backdrop} onPress={() => setNextCycleBill(null)}>
          <Pressable style={s.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={s.sheetTitle}>🔄 Start Next Cycle</Text>
            <Muted style={{ marginBottom: space(1) }}>
              Roll over "{nextCycleBill?.title}" for the next billing cycle.
            </Muted>

            <Muted>Next Billing Period</Muted>
            <Input
              placeholder="e.g. November 2026"
              value={nextCyclePeriod}
              onChangeText={setNextCyclePeriod}
            />

            <Row style={{ gap: space(1) }}>
              <View style={{ flex: 1 }}>
                <Muted>New Amount (₹)</Muted>
                <Input
                  placeholder="e.g. 1850"
                  keyboardType="decimal-pad"
                  value={nextCycleAmountStr}
                  onChangeText={setNextCycleAmountStr}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Muted>Due Date</Muted>
                <Input
                  placeholder="YYYY-MM-DD"
                  value={nextCycleDueDate}
                  onChangeText={setNextCycleDueDate}
                />
              </View>
            </Row>

            <Button
              title="Start Next Cycle"
              onPress={() => {
                if (!nextCycleBill) return;
                const amt = parseFloat(nextCycleAmountStr);
                const cents = !isNaN(amt) && amt > 0 ? Math.round(amt * 100) : undefined;
                nextCycleMutation.mutate({
                  billId: nextCycleBill.id,
                  period: nextCyclePeriod.trim(),
                  dueDate: nextCycleDueDate,
                  amountCents: cents,
                });
              }}
              loading={nextCycleMutation.isPending}
              style={{ marginTop: space(1) }}
            />
            <Button title="Cancel" variant="ghost" onPress={() => setNextCycleBill(null)} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const s = StyleSheet.create({
  pageTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.ink,
  },
  headerAddBtn: {
    paddingHorizontal: space(1.5),
    paddingVertical: space(1),
  },
  warningBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1.5,
    borderColor: '#F59E0B',
    padding: space(1.5),
  },
  warningIcon: {
    fontSize: 26,
  },
  warningTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#92400E',
    lineHeight: 20,
  },
  warningSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#B45309',
    marginTop: 2,
    lineHeight: 16,
  },
  protectedBanner: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1.5,
    borderColor: '#10B981',
    padding: space(1.5),
  },
  shieldIcon: {
    fontSize: 26,
  },
  protectedTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#065F46',
    lineHeight: 20,
  },
  protectedSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#047857',
    marginTop: 2,
    lineHeight: 16,
  },
  tabChip: {
    paddingHorizontal: space(1.5),
    paddingVertical: space(0.75),
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tabChipActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  tabChipActiveUnpaid: {
    backgroundColor: '#DC2626',
    borderColor: '#DC2626',
  },
  tabChipActivePaid: {
    backgroundColor: '#15803D',
    borderColor: '#15803D',
  },
  tabChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  tabChipTextActive: {
    color: '#FFFFFF',
  },
  tabChipTextActiveUnpaid: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  tabChipTextActivePaid: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: space(0.5),
  },
  billCard: {
    padding: space(1.5),
    borderWidth: 1.5,
    gap: space(1.25),
  },
  billCardUnpaid: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FFFFFF',
  },
  billCardPaid: {
    borderColor: '#86EFAC',
    backgroundColor: '#FAFAF9',
  },
  categoryIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.ink,
  },
  categoryLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaDot: {
    fontSize: 12,
    color: colors.muted,
  },
  metaText: {
    fontSize: 12,
    color: colors.muted,
  },
  amountText: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
  },
  paidProtectionBadge: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: radius,
    padding: space(1),
  },
  paidProtectionHeading: {
    fontSize: 13,
    fontWeight: '900',
    color: '#15803D',
    letterSpacing: 0.5,
  },
  paidProtectionSub: {
    fontSize: 12,
    fontWeight: '600',
    color: '#166534',
    marginTop: 2,
  },
  unpaidDueBadge: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: radius,
    paddingHorizontal: space(1),
    paddingVertical: space(0.75),
  },
  unpaidDueText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#B91C1C',
    letterSpacing: 0.5,
  },
  consumerBox: {
    backgroundColor: '#F5F5F4',
    borderRadius: radius,
    paddingHorizontal: space(1.25),
    paddingVertical: space(0.75),
    borderWidth: 1,
    borderColor: colors.line,
  },
  consumerLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.muted,
    letterSpacing: 0.5,
  },
  consumerValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  copyBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: space(1),
    paddingVertical: space(0.5),
    borderRadius: 8,
  },
  copyBtnActive: {
    backgroundColor: '#DEF7EC',
    borderColor: '#31C48D',
  },
  copyBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
  copyBtnTextActive: {
    color: '#03543F',
  },
  notesBox: {
    paddingHorizontal: space(0.5),
  },
  notesText: {
    fontSize: 13,
    color: colors.muted,
    fontStyle: 'italic',
  },
  actionsRow: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space(1),
    marginTop: space(0.25),
  },
  claimPayBtn: {
    backgroundColor: '#16A34A',
    paddingHorizontal: space(2),
    paddingVertical: space(1),
    borderRadius: radius,
    flex: 1,
    marginRight: space(1),
  },
  cycleBtn: {
    backgroundColor: colors.ink,
    paddingHorizontal: space(1.5),
    paddingVertical: space(0.85),
    borderRadius: radius,
  },
  undoBtn: {
    paddingHorizontal: space(1),
    paddingVertical: space(0.85),
    borderRadius: radius,
    backgroundColor: '#F5F5F4',
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  deleteBtn: {
    padding: space(0.75),
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 16,
    color: colors.muted,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    padding: space(2.5),
    borderTopLeftRadius: radius * 1.5,
    borderTopRightRadius: radius * 1.5,
    maxHeight: '90%',
    gap: space(1),
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: space(0.5),
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
    color: colors.ink,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: colors.accent,
    fontWeight: '800',
  },
  payerChip: {
    paddingHorizontal: space(1.25),
    paddingVertical: space(0.75),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  payerChipActive: {
    borderColor: '#15803D',
    backgroundColor: '#DCFCE7',
  },
  payerChipText: {
    fontSize: 13,
    color: colors.ink,
    fontWeight: '600',
  },
  payerChipTextActive: {
    color: '#15803D',
    fontWeight: '800',
  },
});
