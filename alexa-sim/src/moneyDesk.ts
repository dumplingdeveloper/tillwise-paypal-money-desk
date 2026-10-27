import type { PayPalReadClient } from './paypalMcp.js';

type Row = Record<string, string | number | boolean | null>;
export type LedgerTables = { captures: Row[]; refunds: Row[]; recent_refunds: Row[]; invoices: Row[]; receivables: Row[]; disputes: Row[]; tracking: Row[]; sandbox_activity: Row[] };
export type SandboxApp = { shared_public_default: boolean; label: string } | null;
export type RecentWindow = { start: string; end: string; days: number; label: string };
export type MoneyDeskLedger = LedgerTables & { mode: string; paypal_mode: string; sandbox_app: SandboxApp; generated_at: string; anchor_date: string; currency: string; counts: Record<string, number>; recent_window: RecentWindow | null; notes?: string[] };

type FieldDef = { id: string; name?: string; description?: string; format: string; formatOptions?: Record<string, unknown>; hide?: boolean };
export type StudioSourceDef = { id: string; name: string; description: string; fields: FieldDef[] };

const EUR = { format: 'currencyFormat', formatOptions: { format: '€#,##0.00' } };
const text = (id: string, description: string, name?: string): FieldDef => ({ id, description, format: 'textFormat', ...(name ? { name } : {}) });
const euro = (id: string, description: string, name?: string): FieldDef => ({ id, description, ...EUR, ...(name ? { name } : {}) });
const int = (id: string, description: string, name?: string): FieldDef => ({ id, description, format: 'integerFormat', ...(name ? { name } : {}) });
const date = (id: string, description: string, name?: string): FieldDef => ({ id, description, format: 'dateFormat', ...(name ? { name } : {}) });

const REFUND_FIELDS: FieldDef[] = [
  text('refund_id', 'PayPal refund id', 'Refund ID'), text('capture_id', 'Refunded capture id', 'Capture ID'), int('order_id', 'WooCommerce order number', 'Order'), date('date', 'Refund date', 'Date'),
  text('customer', 'Customer name', 'Customer'), text('segment', 'Customer segment', 'Segment'), text('product', 'Product that was refunded', 'Product'), euro('amount', 'Refunded amount in EUR', 'Refund amount'), text('reason', 'Refund reason', 'Reason'), text('status', 'Refund status', 'Status'),
];

/** Studio table/field metadata for the ledger. Descriptions are AI-facing (AG Studio passes them to the agent via the schema). */
export const MONEY_DESK_SOURCES: StudioSourceDef[] = [
  { id: 'captures', name: 'PayPal captures', description: 'One row per completed PayPal capture (money received). Revenue = sum of gross.', fields: [
    text('capture_id', 'PayPal capture id', 'Capture ID'), int('order_id', 'WooCommerce order number', 'Order'), date('date', 'Capture date', 'Date'),
    text('customer', 'Payer / customer name', 'Customer'), text('segment', 'Customer segment: Retail, Wholesale or Subscription', 'Segment'),
    text('product', 'Product sold in this order', 'Product'), euro('gross', 'Gross amount captured in EUR (revenue)', 'Gross'), euro('fee', 'PayPal fee in EUR', 'Fee'), euro('net', 'Net amount after fee in EUR', 'Net'), text('status', 'Capture status', 'Status'),
  ] },
  { id: 'refunds', name: 'PayPal refunds', description: 'One row per PayPal refund issued against a capture. Refund rate = refunded amount / captured gross for the same period.', fields: REFUND_FIELDS },
  { id: 'recent_refunds', name: 'PayPal refunds · last 14 ledger days', description: 'The refunds rows dated in the last 14 days of the ledger (the dates are filled in when the ledger loads).', fields: REFUND_FIELDS },
  { id: 'invoices', name: 'PayPal invoices', description: 'PayPal invoices. Money still owed = amount_due on invoices with status SENT, UNPAID or PARTIALLY_PAID; overdue when past due_date. DRAFT and PAID owe nothing.', fields: [
    text('invoice_id', 'PayPal invoice id', 'Invoice ID'), text('invoice_number', 'Invoice number', 'Invoice #'), text('customer', 'Billed customer', 'Customer'), text('segment', 'Customer segment', 'Segment'),
    text('recipient_email', 'Recipient email', 'Email'), text('status', 'PayPal invoice status: DRAFT, SENT, UNPAID, PARTIALLY_PAID, PAID', 'Status'), date('issue_date', 'Issue date', 'Issued'), date('due_date', 'Payment due date', 'Due'),
    euro('amount', 'Invoice total in EUR', 'Total'), euro('amount_paid', 'Amount already paid in EUR', 'Paid'), euro('amount_due', 'Amount still owed in EUR', 'Amount due'), int('days_overdue', 'Days past the due date (0 if not overdue)', 'Days overdue'),
    { id: 'overdue', description: 'True when unpaid and past the due date', format: 'booleanFormat', name: 'Overdue' },
    { id: 'outstanding', description: 'True only when money is still owed on this invoice (SENT, UNPAID or PARTIALLY_PAID with amount_due > 0). DRAFT and PAID are false.', format: 'booleanFormat', name: 'Outstanding' },
  ] },
  { id: 'receivables', name: 'Who still owes us (open invoices)', description: 'Only the PayPal invoices with money still owed (outstanding = true in paypal_ledger_export): no DRAFT, PAID or fully paid rows. Use this table for "who still owes us", unpaid, receivables or overdue lists.', fields: [
    text('invoice_number', 'Invoice number', 'Invoice #'), text('customer', 'Customer who still owes money', 'Customer'), text('segment', 'Customer segment', 'Segment'),
    text('status', 'PayPal invoice status: SENT, UNPAID or PARTIALLY_PAID', 'Status'), date('issue_date', 'Issue date', 'Issued'), date('due_date', 'Payment due date', 'Due'),
    euro('amount', 'Invoice total in EUR', 'Total'), euro('amount_due', 'Amount still owed in EUR', 'Amount due'), int('days_overdue', 'Days past the due date (0 if not yet due)', 'Days overdue'),
  ] },
  { id: 'disputes', name: 'PayPal disputes', description: 'PayPal disputes. Disputes WAITING_FOR_SELLER_RESPONSE must be answered before seller_response_due_date.', fields: [
    text('dispute_id', 'PayPal dispute id', 'Dispute ID'), int('order_id', 'WooCommerce order number', 'Order'), text('customer', 'Customer name', 'Customer'), text('segment', 'Customer segment', 'Segment'),
    text('reason', 'PayPal dispute reason', 'Reason'), text('status', 'Dispute status', 'Status'), euro('amount', 'Disputed amount in EUR', 'Amount'), date('created_date', 'Date opened', 'Opened'),
    { id: 'seller_response_due_date', description: 'Deadline for the seller response', format: 'dateTimeFormat', name: 'Response due' }, int('days_to_respond', 'Whole days left to respond', 'Days to respond'),
  ] },
  { id: 'sandbox_activity', name: 'Real PayPal sandbox · created by Tillwise', description: 'REAL PayPal sandbox objects (api-m.sandbox.paypal.com) that Tillwise created: seed captures, refunds (including voice-flow refunds) and the seed invoice, read live by id. Present only when PayPal runs in sandbox mode. All other tables are the mock ledger (demo data).', fields: [
    text('kind', 'capture, refund or invoice', 'Kind'), text('paypal_id', 'PayPal capture, refund or invoice id', 'PayPal ID'), int('order_id', 'WooCommerce order number, when linked', 'Woo order'),
    { id: 'created_at', description: 'When PayPal created it (UTC)', format: 'dateTimeFormat', name: 'Created (UTC)' }, text('customer', 'Customer (fictional sandbox name)', 'Customer'), text('product', 'Product', 'Product'),
    euro('amount', 'Amount in EUR', 'Amount'), euro('fee', 'PayPal fee in EUR (captures)', 'PayPal fee'), text('status', 'PayPal status, e.g. COMPLETED, PARTIALLY_REFUNDED, UNPAID', 'Status'), text('tag', 'Tillwise tag (invoice_id / custom_id) on the PayPal object', 'Tag'),
  ] },
  { id: 'tracking', name: 'PayPal shipment tracking', description: 'Shipment tracking attached to PayPal captures.', fields: [
    text('tracking_id', 'PayPal tracker id', 'Tracker ID'), int('order_id', 'WooCommerce order number', 'Order'), text('customer', 'Customer name', 'Customer'),
    text('carrier', 'Carrier', 'Carrier'), text('tracking_number', 'Tracking number', 'Tracking #'), text('status', 'Shipment status', 'Status'), date('shipped_date', 'Ship date', 'Shipped'),
  ] },
];

/** Days in the recent_refunds view: twice paypal_refund_anomaly's default 7-day window, like its daily series. */
export const RECENT_REFUND_DAYS = 14;

const DAY_MS = 86_400_000;
const dayLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

/** The last RECENT_REFUND_DAYS days up to the last capture/refund date (the same anchor as paypal_refund_anomaly). */
export function recentWindow(data: Record<string, unknown>, days = RECENT_REFUND_DAYS): RecentWindow | null {
  const dates = (['captures', 'refunds'] as const).flatMap((k) => (Array.isArray(data[k]) ? (data[k] as Row[]) : []).map((r) => String(r.date ?? ''))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const end = dates.at(-1);
  if (!end) return null;
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return { start, end, days, label: `${dayLabel(start)} – ${dayLabel(end)}` };
}

/** Studio sources for this ledger: the static definitions, with the exact recent_refunds dates in its AI-facing description. */
export function moneyDeskSources(ledger: Pick<MoneyDeskLedger, 'recent_window'> & Partial<Pick<MoneyDeskLedger, 'paypal_mode'>>): StudioSourceDef[] {
  const w = ledger.recent_window;
  return MONEY_DESK_SOURCES.filter((source) => source.id !== 'sandbox_activity' || ledger.paypal_mode === 'sandbox').map((source) => source.id !== 'recent_refunds' || !w ? source : {
    ...source,
    name: `PayPal refunds · last ${w.days} days (${w.label})`,
    description: `The same rows as refunds, already limited to the last ${w.days} ledger days: ${w.label} (${w.start} to ${w.end}), the same days as the daily series of paypal_refund_anomaly. Use this table for refunds per day over the last ${w.days} days (e.g. recent_refunds.date::day stacked by recent_refunds.reason): no date filter is needed, and the title should name these dates.`,
  });
}

function pickRows(rows: unknown, fields: FieldDef[]): Row[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => Object.fromEntries(fields.map((f) => [f.id, (row as Row)[f.id] ?? null])));
}

/** Projects the MCP `paypal_ledger_export` payload onto the Studio tables. No rows are invented here. */
export function ledgerToTables(data: Record<string, unknown>): MoneyDeskLedger {
  // receivables is a view of the exported invoices, filtered on the MCP tool's own `outstanding` flag.
  // recent_refunds is the exported refunds dated in the last RECENT_REFUND_DAYS ledger days.
  const recent = recentWindow(data);
  const exported = {
    ...data,
    receivables: Array.isArray(data.invoices) ? (data.invoices as Row[]).filter((row) => row.outstanding === true) : [],
    recent_refunds: recent && Array.isArray(data.refunds) ? (data.refunds as Row[]).filter((row) => String(row.date) >= recent.start && String(row.date) <= recent.end) : [],
  };
  const tables = Object.fromEntries(MONEY_DESK_SOURCES.map((source) => [source.id, pickRows(exported[source.id as keyof typeof exported], source.fields)])) as LedgerTables;
  const meta = (data.sandbox_activity_meta || null) as { sandbox_app?: SandboxApp } | null;
  return { ...tables, mode: String(data.mode || 'unknown'), paypal_mode: String(data.paypal_mode || data.mode || 'unknown'), sandbox_app: meta?.sandbox_app || null, generated_at: String(data.generated_at || ''), anchor_date: String(data.anchor_date || ''), currency: String(data.currency || 'EUR'), counts: (data.counts as Record<string, number>) || {}, recent_window: recent, ...(Array.isArray(data.notes) ? { notes: data.notes as string[] } : {}) };
}

export async function loadMoneyDeskLedger(client: PayPalReadClient, days = 45) {
  const result = await client.callReadOnly('paypal_ledger_export', { days });
  return { ledger: ledgerToTables(result.data), source: { tool: 'paypal_ledger_export', via: 'mcp', speech: result.speech } };
}

/** Honest on-screen wording for where the PayPal data comes from (voice sim badge). */
export function paypalModeLabel(mode: string, app: SandboxApp = null) {
  if (mode === 'sandbox') return `PayPal: REAL sandbox · api-m.sandbox.paypal.com${app ? ` · ${app.label}` : ''}`;
  if (mode === 'mock') return 'PayPal: mock mode · demo data, not a PayPal account';
  return `PayPal: ${mode || 'unknown'} mode`;
}

export async function loadPayPalMode(client: PayPalReadClient) {
  const result = await client.callReadOnly('paypal_ledger_export', { days: 1 });
  const data = result.data as { mode?: unknown; paypal_mode?: unknown; sandbox_activity_meta?: { sandbox_app?: SandboxApp } | null };
  const mode = String(data.paypal_mode || data.mode || 'unknown');
  return { mode, label: paypalModeLabel(mode, data.sandbox_activity_meta?.sandbox_app || null), source: 'paypal_ledger_export', ledger: String(data.mode || 'unknown') };
}
