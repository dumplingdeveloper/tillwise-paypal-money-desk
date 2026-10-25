import type { PayPalLedger, LedgerCapture, LedgerDispute, LedgerInvoice, LedgerRefund, LedgerTracking } from './types.js';

const DAY = 86_400_000;
export const LEDGER_DAYS = 45;
export const REFUND_SPIKE_DAYS = 7;

type Customer = { name: string; email: string; segment: 'Retail' | 'Wholesale' | 'Subscription' };
const CUSTOMERS: Customer[] = [
  { name: 'Aoife Byrne', email: 'aoife.byrne@example.test', segment: 'Retail' },
  { name: 'Niamh Walsh', email: 'niamh.walsh@example.test', segment: 'Retail' },
  { name: 'Conor Kelly', email: 'conor.kelly@example.test', segment: 'Retail' },
  { name: 'Sean Murphy', email: 'sean.murphy@example.test', segment: 'Retail' },
  { name: 'Ciara Doyle', email: 'ciara.doyle@example.test', segment: 'Retail' },
  { name: 'Dublin Pantry Ltd', email: 'accounts@dublinpantry.example.test', segment: 'Wholesale' },
  { name: 'Cork Office Co', email: 'ap@corkoffice.example.test', segment: 'Wholesale' },
  { name: 'Galway Gift House', email: 'orders@galwaygift.example.test', segment: 'Wholesale' },
  { name: 'Mugs & Candles Club', email: 'club@mugsandcandles.example.test', segment: 'Subscription' },
  { name: 'Kilkenny Workspace Co', email: 'billing@kilkennyworkspace.example.test', segment: 'Subscription' },
];
const REFUND_REASONS = ['Damaged in transit', 'Wrong size', 'Changed mind', 'Late delivery', 'Duplicate order'];
const PRODUCTS: Record<Customer['segment'], string[]> = {
  Retail: ['Stoneware Mug Set', 'Soy Candle Trio', 'Notebook Bundle'],
  Wholesale: ['Stoneware Mug Set', 'Gift Hamper', 'Desk Organiser'],
  Subscription: ['Monthly Candle Box', 'Desk Refresh Box'],
};
/** The mock spike has one cause, so a drill-down by product or reason can find it in the data. */
export const SPIKE_PRODUCT = 'Stoneware Mug Set';
export const SPIKE_REASON = 'Damaged in transit';
const BASELINE_REFUND_RATE = 0.08;

/** Mulberry32: tiny deterministic PRNG so the same anchor day always yields the same ledger. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const money = (n: number) => Math.round(n * 100) / 100;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoTime = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Deterministic PayPal-shaped ledger for mock mode. Dates are relative to the UTC day of `anchor`
 * so "this week" and "this month" questions always have data; amounts and customers come from a
 * fixed-seed PRNG so a given anchor day always produces identical rows.
 */
export function buildMockLedger(anchor: number = Date.now()): PayPalLedger {
  const today = Math.floor(anchor / DAY) * DAY;
  const rand = prng(20261112);
  const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
  const captures: LedgerCapture[] = [];
  let orderId = 100;
  for (let daysAgo = LEDGER_DAYS - 1; daysAgo >= 0; daysAgo--) {
    const perDay = 5 + Math.floor(rand() * 5);
    for (let i = 0; i < perDay; i++) {
      const customer = pick(CUSTOMERS);
      const product = pick(PRODUCTS[customer.segment]);
      const base = customer.segment === 'Wholesale' ? 140 + rand() * 260 : customer.segment === 'Subscription' ? 29 + rand() * 16 : 14 + rand() * 60;
      const gross = money(base);
      const fee = money(gross * 0.029 + 0.35);
      const at = today - daysAgo * DAY + (9 + i * 3) * 3_600_000 + Math.floor(rand() * 50) * 60_000;
      orderId++;
      if (at > anchor) continue;
      captures.push({ capture_id: `MOCKCAPTURE${orderId}`, order_id: orderId, date: isoDate(at), captured_at: isoTime(at), customer: customer.name, segment: customer.segment, product, gross, fee, net: money(gross - fee), currency: 'EUR', status: 'COMPLETED' });
    }
  }

  const refunds: LedgerRefund[] = [];
  let refundSeq = 5000;
  const spikeStart = today - (REFUND_SPIKE_DAYS - 1) * DAY;
  captures.forEach((capture) => {
    const capturedAt = Date.parse(capture.captured_at);
    // The spike: Stoneware Mug Sets captured in the last ~9 days arrive broken (a bad courier batch) and
    // ~85% of them are refunded as "Damaged in transit". Everything else keeps a ~8% baseline spread over
    // every product and reason, so a day-by-day chart shows ordinary refunds before and during the spike.
    const spikeHit = capturedAt >= spikeStart - 2 * DAY && capture.product === SPIKE_PRODUCT;
    const roll = rand();
    if (!(spikeHit ? roll < 0.85 : roll < BASELINE_REFUND_RATE)) return;
    let refundedAt = capturedAt + (1 + Math.floor(rand() * 2)) * DAY;
    if (refundedAt > anchor) refundedAt = capturedAt + Math.floor((anchor - capturedAt) / 2);
    const partial = rand() < 0.3;
    const reason = spikeHit ? SPIKE_REASON : pick(REFUND_REASONS);
    refunds.push({ refund_id: `MOCK-RFND-${++refundSeq}`, capture_id: capture.capture_id, order_id: capture.order_id, date: isoDate(refundedAt), refunded_at: isoTime(refundedAt), customer: capture.customer, segment: capture.segment, product: capture.product, amount: money(partial ? capture.gross / 2 : capture.gross), currency: 'EUR', reason, status: 'COMPLETED' });
  });

  const invoiceRow = (seq: number, customer: Customer, status: LedgerInvoice['status'], issuedDaysAgo: number, termDays: number, amount: number, paid: number): LedgerInvoice => {
    const issue = today - issuedDaysAgo * DAY;
    const due = issue + termDays * DAY;
    const unpaid = status === 'SENT' || status === 'UNPAID' || status === 'PARTIALLY_PAID';
    // Drafts have not been billed yet, so nothing is owed on them.
    const amountDue = unpaid ? money(amount - paid) : 0;
    const daysOverdue = unpaid && due < today ? Math.round((today - due) / DAY) : 0;
    return { invoice_id: `INV2-MOCK-${seq}`, invoice_number: `TW-${seq}`, customer: customer.name, segment: customer.segment, recipient_email: customer.email, status, issue_date: isoDate(issue), due_date: isoDate(due), amount, amount_paid: paid, amount_due: amountDue, currency: 'EUR', days_overdue: daysOverdue, overdue: daysOverdue > 0, outstanding: amountDue > 0 };
  };
  const byName = (name: string) => CUSTOMERS.find((c) => c.name === name)!;
  const invoices: LedgerInvoice[] = [
    invoiceRow(7001, byName('Dublin Pantry Ltd'), 'SENT', 4, 14, 480, 0),
    invoiceRow(7002, byName('Cork Office Co'), 'SENT', 25, 14, 220, 0),
    invoiceRow(7003, byName('Galway Gift House'), 'PARTIALLY_PAID', 40, 30, 650, 250),
    invoiceRow(7004, byName('Dublin Pantry Ltd'), 'PAID', 30, 14, 310, 310),
    invoiceRow(7005, byName('Kilkenny Workspace Co'), 'DRAFT', 1, 14, 145, 0),
    invoiceRow(7006, byName('Mugs & Candles Club'), 'UNPAID', 18, 7, 96, 0),
  ];

  const disputeRow = (id: string, capture: LedgerCapture, reason: string, status: string, state: string, openedDaysAgo: number, respondInDays: number | null, amount?: number): LedgerDispute => {
    const created = today - openedDaysAgo * DAY + 10 * 3_600_000;
    const dueMs = respondInDays === null ? null : today + respondInDays * DAY + 23 * 3_600_000;
    return { dispute_id: id, capture_id: capture.capture_id, order_id: capture.order_id, customer: capture.customer, segment: capture.segment, reason, status, dispute_state: state, amount: amount ?? capture.gross, currency: 'EUR', created_date: isoDate(created), seller_response_due_date: dueMs === null ? null : isoTime(dueMs), days_to_respond: respondInDays };
  };
  const retail = captures.filter((c) => c.segment === 'Retail');
  const wholesale = captures.filter((c) => c.segment === 'Wholesale');
  const disputes: LedgerDispute[] = [
    disputeRow('PP-D-MOCK-1', retail[retail.length - 6], 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'WAITING_FOR_SELLER_RESPONSE', 'REQUIRED_ACTION', 3, 2, 18),
    disputeRow('PP-D-MOCK-2', wholesale[wholesale.length - 3], 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', 'WAITING_FOR_SELLER_RESPONSE', 'REQUIRED_ACTION', 6, 5),
    disputeRow('PP-D-MOCK-3', retail[retail.length - 15], 'UNAUTHORISED', 'UNDER_REVIEW', 'UNDER_PAYPAL_REVIEW', 12, null),
  ];

  const carriers = ['AN_POST', 'DHL', 'UPS', 'DPD'];
  const tracking: LedgerTracking[] = captures.slice(-8).map((capture, i) => {
    const shipped = Date.parse(capture.captured_at) + DAY;
    const status = shipped > today ? 'ON_HOLD' : i % 3 === 0 ? 'DELIVERED' : 'SHIPPED';
    const carrier = carriers[i % carriers.length];
    return { tracking_id: `${capture.capture_id}-TRK${i + 1}`, capture_id: capture.capture_id, order_id: capture.order_id, customer: capture.customer, carrier, tracking_number: `${carrier.slice(0, 2)}${String(910000 + (capture.order_id ?? 0) * 7)}IE`, status, shipped_date: isoDate(Math.min(shipped, today)) };
  });

  return { mode: 'mock', generated_at: isoTime(anchor), anchor_date: isoDate(today), currency: 'EUR', captures, refunds, invoices, disputes, tracking };
}
