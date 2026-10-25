import type { PayPalReadClient } from './paypalMcp.js';

type Row = Record<string, string | number | boolean | null>;
export type LedgerTables = { captures: Row[]; refunds: Row[]; invoices: Row[]; receivables: Row[]; disputes: Row[]; tracking: Row[] };
export type MoneyDeskLedger = LedgerTables & { mode: string; generated_at: string; anchor_date: string; currency: string; counts: Record<string, number>; notes?: string[] };

type FieldDef = { id: string; name?: string; description?: string; format: string; formatOptions?: Record<string, unknown>; hide?: boolean };
export type StudioSourceDef = { id: string; name: string; description: string; fields: FieldDef[] };

const EUR = { format: 'currencyFormat', formatOptions: { format: '€#,##0.00' } };
const text = (id: string, description: string, name?: string): FieldDef => ({ id, description, format: 'textFormat', ...(name ? { name } : {}) });
const euro = (id: string, description: string, name?: string): FieldDef => ({ id, description, ...EUR, ...(name ? { name } : {}) });
const int = (id: string, description: string, name?: string): FieldDef => ({ id, description, format: 'integerFormat', ...(name ? { name } : {}) });
const date = (id: string, description: string, name?: string): FieldDef => ({ id, description, format: 'dateFormat', ...(name ? { name } : {}) });

/** Studio table/field metadata for the ledger. Descriptions are AI-facing (AG Studio passes them to the agent via the schema). */
export const MONEY_DESK_SOURCES: StudioSourceDef[] = [
  { id: 'captures', name: 'PayPal captures', description: 'One row per completed PayPal capture (money received). Revenue = sum of gross.', fields: [
    text('capture_id', 'PayPal capture id', 'Capture ID'), int('order_id', 'WooCommerce order number', 'Order'), date('date', 'Capture date', 'Date'),
    text('customer', 'Payer / customer name', 'Customer'), text('segment', 'Customer segment: Retail, Wholesale or Subscription', 'Segment'),
    text('product', 'Product sold in this order', 'Product'), euro('gross', 'Gross amount captured in EUR (revenue)', 'Gross'), euro('fee', 'PayPal fee in EUR', 'Fee'), euro('net', 'Net amount after fee in EUR', 'Net'), text('status', 'Capture status', 'Status'),
  ] },
  { id: 'refunds', name: 'PayPal refunds', description: 'One row per PayPal refund issued against a capture. Refund rate = refunded amount / captured gross for the same period.', fields: [
    text('refund_id', 'PayPal refund id', 'Refund ID'), text('capture_id', 'Refunded capture id', 'Capture ID'), int('order_id', 'WooCommerce order number', 'Order'), date('date', 'Refund date', 'Date'),
    text('customer', 'Customer name', 'Customer'), text('segment', 'Customer segment', 'Segment'), text('product', 'Product that was refunded', 'Product'), euro('amount', 'Refunded amount in EUR', 'Refund amount'), text('reason', 'Refund reason', 'Reason'), text('status', 'Refund status', 'Status'),
  ] },
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
  { id: 'tracking', name: 'PayPal shipment tracking', description: 'Shipment tracking attached to PayPal captures.', fields: [
    text('tracking_id', 'PayPal tracker id', 'Tracker ID'), int('order_id', 'WooCommerce order number', 'Order'), text('customer', 'Customer name', 'Customer'),
    text('carrier', 'Carrier', 'Carrier'), text('tracking_number', 'Tracking number', 'Tracking #'), text('status', 'Shipment status', 'Status'), date('shipped_date', 'Ship date', 'Shipped'),
  ] },
];

function pickRows(rows: unknown, fields: FieldDef[]): Row[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => Object.fromEntries(fields.map((f) => [f.id, (row as Row)[f.id] ?? null])));
}

/** Projects the MCP `paypal_ledger_export` payload onto the Studio tables. No rows are invented here. */
export function ledgerToTables(data: Record<string, unknown>): MoneyDeskLedger {
  // receivables is a view of the exported invoices, filtered on the MCP tool's own `outstanding` flag.
  const exported = { ...data, receivables: Array.isArray(data.invoices) ? (data.invoices as Row[]).filter((row) => row.outstanding === true) : [] };
  const tables = Object.fromEntries(MONEY_DESK_SOURCES.map((source) => [source.id, pickRows(exported[source.id as keyof typeof exported], source.fields)])) as LedgerTables;
  return { ...tables, mode: String(data.mode || 'unknown'), generated_at: String(data.generated_at || ''), anchor_date: String(data.anchor_date || ''), currency: String(data.currency || 'EUR'), counts: (data.counts as Record<string, number>) || {}, ...(Array.isArray(data.notes) ? { notes: data.notes as string[] } : {}) };
}

export async function loadMoneyDeskLedger(client: PayPalReadClient, days = 45) {
  const result = await client.callReadOnly('paypal_ledger_export', { days });
  return { ledger: ledgerToTables(result.data), source: { tool: 'paypal_ledger_export', via: 'mcp', speech: result.speech } };
}
