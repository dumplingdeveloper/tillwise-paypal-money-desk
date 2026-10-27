import { createHash, randomUUID } from 'node:crypto';
import { WpAbilityClient, type AbilityResult } from '../wpClient.js';
import { MockPayPalClient } from './mockClient.js';
import { LivePayPalClient, readSandboxCredentials } from './liveClient.js';
import { explainRefundAnomaly } from './refundAnomaly.js';
import { PayPalApiError, type LedgerInvoice, type PayPalClient, type PayPalDispute, type PayPalLedger, type PayPalTransaction } from './types.js';
import { parseSeedCustomId } from './seedTags.js';
import { disputeIsOwned, loadSandboxActivity, readSeedManifest, sandboxAppLabel, type SandboxActivity } from './sandboxActivity.js';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value: unknown) { return createHash('sha256').update(stable(value)).digest('hex'); }
function moneyValue(value: number) { return value.toFixed(2); }
function isoDaysAgo(days: number) { const d = new Date(Date.now() - days * 86400_000); return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

type Preview = { id: string; hash: string; kind: string; payload: Record<string, unknown>; createdAt: number };
type ServiceOptions = {
  previewTtlMs?: number;
  now?: () => number;
  /** Sandbox mode: where the Money Desk analytics come from. Default: the labelled mock ledger (see fromEnv). */
  analytics?: Pick<PayPalClient, 'ledger'> | null;
  /** Sandbox mode: the live rows of objects Tillwise created (default: read by id via the seed manifest). */
  activity?: () => Promise<SandboxActivity>;
  activityTtlMs?: number;
};

type OrderContext = { order: { id: number; total: number; currency: string; billing_email?: string; items?: Array<{ name: string; quantity: number; total: number }> }; paypal: { paypal_capture_id?: string; paypal_order_id?: string; paypal_invoice_id?: string } };

export class PayPalService {
  private previews = new Map<string, Preview>();
  private readonly previewTtlMs: number;
  private readonly now: () => number;
  private readonly analytics: Pick<PayPalClient, 'ledger'> | null;
  private readonly activityLoader: (() => Promise<SandboxActivity>) | null;
  private readonly activityTtlMs: number;
  private activityCache?: { at: number; value: Promise<SandboxActivity> };
  constructor(private readonly wp: Pick<WpAbilityClient, 'run'>, private readonly client: PayPalClient, options: ServiceOptions = {}) {
    this.previewTtlMs = options.previewTtlMs ?? 10 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
    this.analytics = options.analytics ?? null;
    const live = client.getOrder && client.getInvoice ? { getOrder: client.getOrder.bind(client), getInvoice: client.getInvoice.bind(client) } : null;
    this.activityLoader = options.activity ?? (client.mode === 'sandbox' && live ? () => loadSandboxActivity(live, readSeedManifest()) : null);
    this.activityTtlMs = options.activityTtlMs ?? 20_000;
  }

  /** Live sandbox rows (cached briefly: the Money Desk, the badge and the agent may all ask within seconds). Null in mock mode. */
  private sandboxActivity(): Promise<SandboxActivity> | null {
    if (!this.activityLoader) return null;
    if (!this.activityCache || this.now() - this.activityCache.at > this.activityTtlMs) {
      const value = this.activityLoader();
      value.catch(() => { this.activityCache = undefined; });
      this.activityCache = { at: this.now(), value };
    }
    return this.activityCache.value;
  }
  private invalidateActivity() { this.activityCache = undefined; }
  private async sandboxApp() { return this.client.appId ? sandboxAppLabel(await this.client.appId()) : null; }
  /** On the shared sandbox app most disputes belong to other users: only disputes on our own captures are shown or acted on. */
  private async ownedDisputes(disputes: PayPalDispute[]): Promise<{ disputes: PayPalDispute[]; hidden: number }> {
    if (this.client.mode !== 'sandbox') return { disputes, hidden: 0 };
    const activity = await this.sandboxActivity();
    const owned = disputes.filter((d) => disputeIsOwned(d, activity?.owned_capture_ids || []));
    return { disputes: owned, hidden: disputes.length - owned.length };
  }

  static fromEnv(wp: Pick<WpAbilityClient, 'run'>, env: Record<string, string | undefined> = process.env) {
    const creds = readSandboxCredentials();
    const mode = env.PAYPAL_MODE || (creds ? 'sandbox' : 'mock');
    if (mode !== 'mock' && mode !== 'sandbox') throw new Error('PAYPAL_MODE must be mock or sandbox.');
    if (mode === 'sandbox' && !creds) throw new Error('PAYPAL_MODE=sandbox requires ~/.config/tillwise/paypal-sandbox.env.');
    if (mode !== 'sandbox' || !creds) return new PayPalService(wp, new MockPayPalClient());
    // Sandbox: money moves live. The analytics (refund-rate, anomaly drill-down, segments) stay on the labelled mock
    // ledger by default, because Transaction Search on a shared app is other people's traffic and lags up to 3 h.
    // PAYPAL_LEDGER=sandbox computes them from Transaction Search instead (own app only).
    const ledger = env.PAYPAL_LEDGER || 'mock';
    if (ledger !== 'mock' && ledger !== 'sandbox') throw new Error('PAYPAL_LEDGER must be mock or sandbox.');
    // TILLWISE_SANDBOX_ACTIVITY_TTL_MS: how long the by-id read of our own sandbox objects is cached (default 20 s;
    // money-moving applies invalidate it at once). Longer values spare a shared app during recordings.
    const ttl = Number(env.TILLWISE_SANDBOX_ACTIVITY_TTL_MS);
    return new PayPalService(wp, new LivePayPalClient(creds), { analytics: ledger === 'mock' ? new MockPayPalClient() : null, ...(Number.isFinite(ttl) && ttl > 0 ? { activityTtlMs: ttl } : {}) });
  }

  private preview(kind: string, payload: Record<string, unknown>): Preview {
    const digest = hash({ kind, payload });
    const id = `ppv_${randomUUID()}`;
    const preview = { id, hash: digest, kind, payload, createdAt: this.now() };
    this.previews.set(id, preview);
    return preview;
  }
  private takePreview(id: string, kind: string): Preview {
    const preview = this.previews.get(id);
    if (!preview || preview.kind !== kind) throw new Error('Preview id was not found for this PayPal action. Preview again before applying.');
    if (this.now() - preview.createdAt > this.previewTtlMs) {
      this.previews.delete(id);
      throw new Error('Preview expired. Preview again before applying this PayPal action.');
    }
    this.previews.delete(id);
    return preview;
  }
  private requestId(prefix: string, preview: Preview): string {
    return `${prefix}-${preview.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 44)}`;
  }
  private async orderContext(order_id: number): Promise<OrderContext> {
    const result = await this.wp.run('paypal-order-context', { order_id });
    return result.data as OrderContext;
  }
  private async audit(input: Record<string, unknown>) { return this.wp.run('paypal-audit-record', { id: randomUUID(), ...input }); }

  async moneyBriefing(): Promise<AbilityResult> {
    const audit = await this.wp.run('paypal-audit-list', {});
    const activityPromise = this.sandboxActivity();
    if (activityPromise) {
      const activity = await activityPromise;
      const { disputes, hidden } = await this.ownedDisputes(await this.client.listDisputes({ page_size: 50, page: 1 }));
      const by = (kind: string) => activity.rows.filter((r) => r.kind === kind);
      const total = (rows: Array<{ amount: number }>) => rows.reduce((sum, r) => sum + r.amount, 0).toFixed(2);
      const app = await this.sandboxApp();
      const counts = { captures: by('capture').length, refunds: by('refund').length, invoices: by('invoice').length, disputes: disputes.length, other_users_disputes_hidden: hidden };
      return { speech: `PayPal sandbox briefing (live, ${app?.label || 'sandbox app'}): ${counts.captures} captures of EUR ${total(by('capture'))}, ${counts.refunds} refunds of EUR ${total(by('refund'))} and ${counts.invoices} invoice created by Tillwise; ${disputes.length} disputes on them.`, data: { mode: this.client.mode, source: 'live PayPal sandbox: GET /v2/checkout/orders/{id} and GET /v2/invoicing/invoices/{id} for the objects Tillwise created', sandbox_app: app, activity: activity.rows, disputes, audit: audit.data.audit || [], counts, errors: activity.errors } };
    }
    const transactions = await this.client.listTransactions({ start_date: isoDaysAgo(30), end_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), page_size: 20, page: 1 });
    const disputes = await this.client.listDisputes({ page_size: 10, page: 1 });
    const refundCount = transactions.filter((t) => String(t.transaction_info.transaction_event_code || '').startsWith('T11')).length;
    return { speech: `PayPal money briefing: ${transactions.length} recent transactions, ${disputes.length} open disputes, and ${refundCount} refund-like records.`, data: { mode: this.client.mode, transactions, disputes, audit: audit.data.audit || [], counts: { transactions: transactions.length, disputes: disputes.length, refund_like: refundCount } } };
  }

  /**
   * The ledger rows of the last `days` days, counted back from the ledger's own anchor day (the mock ledger is built
   * once at start-up, so the wall clock may already be on the next day). Shared by the export and the anomaly tool so
   * the Money Desk tile and the tool always see identical rows.
   */
  private async windowedLedger(days: number): Promise<PayPalLedger> {
    const source = this.client.ledger ? this.client : this.analytics;
    const ledger = source?.ledger ? source.ledger() : await this.sandboxLedger(days);
    const since = new Date(Date.parse(`${ledger.anchor_date}T00:00:00Z`) - (days - 1) * 86400_000).toISOString().slice(0, 10);
    return { ...ledger, captures: ledger.captures.filter((c) => c.date >= since), refunds: ledger.refunds.filter((r) => r.date >= since) };
  }

  async ledgerExport(input: { days?: number } = {}): Promise<AbilityResult> {
    const days = Math.min(Math.max(Math.floor(input.days ?? 45), 1), 90);
    const data = await this.windowedLedger(days);
    const counts = { captures: data.captures.length, refunds: data.refunds.length, invoices: data.invoices.length, disputes: data.disputes.length, tracking: data.tracking.length };
    const speech = `PayPal ledger export (${data.mode}) for the last ${days} days: ${counts.captures} captures, ${counts.refunds} refunds, ${counts.invoices} invoices, ${counts.disputes} disputes, ${counts.tracking} tracking rows.`;
    const activityPromise = this.sandboxActivity();
    if (!activityPromise) return { speech, data: { ...data, days, counts, paypal_mode: this.client.mode, ledger_source: data.mode, sandbox_activity: [], sandbox_activity_meta: null } as unknown as Record<string, unknown> };
    const activity = await activityPromise;
    const app = await this.sandboxApp();
    const meta = { source: 'live api-m.sandbox.paypal.com: GET /v2/checkout/orders/{id} and GET /v2/invoicing/invoices/{id}, ids from npm run sandbox:seed and the voice flow', run_tag: activity.run_tag, read_at: activity.read_at, errors: activity.errors, sandbox_app: app };
    const notes = [...(data.notes || []), `PayPal mode is the LIVE sandbox (${app?.label || 'sandbox app'}): refunds and invoices move sandbox money. The ${data.mode === 'mock' ? 'captures/refunds/invoices/disputes tables above are the labelled mock ledger (demo data, not PayPal)' : 'tables above come from Transaction Search'}; sandbox_activity holds the ${activity.rows.length} live sandbox objects Tillwise created.`];
    return { speech: `${speech} Plus ${activity.rows.length} live PayPal sandbox rows created by Tillwise.`, data: { ...data, days, counts: { ...counts, sandbox_activity: activity.rows.length }, notes, paypal_mode: this.client.mode, ledger_source: data.mode, sandbox_activity: activity.rows, sandbox_activity_meta: meta } as unknown as Record<string, unknown> };
  }

  async refundAnomaly(input: { window_days?: number } = {}): Promise<AbilityResult> {
    const ledger = await this.windowedLedger(45);
    const anomaly = explainRefundAnomaly(ledger, input.window_days ?? 7);
    return { speech: anomaly.headline, data: anomaly as unknown as Record<string, unknown> };
  }

  private async sandboxLedger(days: number): Promise<PayPalLedger> {
    const end = new Date(this.now()); const start = new Date(this.now() - days * 86400_000);
    const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    // Transaction Search: "The maximum supported range is 31 days" (reporting_transactions_v1 end_date), so query in chunks.
    const transactions: PayPalTransaction[] = [];
    for (let from = start.getTime(); from < end.getTime(); from += 31 * 86400_000) {
      const to = new Date(Math.min(from + 31 * 86400_000, end.getTime()));
      transactions.push(...await this.client.listTransactions({ start_date: fmt(new Date(from)), end_date: fmt(to), page_size: 500, page: 1 }));
    }
    const disputes = await this.client.listDisputes({ page_size: 50, page: 1 });
    const invoices = this.client.listInvoices ? await this.client.listInvoices({ page_size: 100 }) : [];
    const when = (t: PayPalTransaction) => String(t.transaction_info.transaction_updated_date || t.transaction_info.transaction_initiation_date || '');
    const tags = (t: PayPalTransaction) => parseSeedCustomId(t.transaction_info.custom_field) || { segment: 'Unknown' as const, customer: 'Unknown', product: 'Unknown' };
    // T-codes (developer.paypal.com/reports/reference/t-codes): T0005 "Credit card payment", T0006 "Express Checkout payment", T1107 "Payment refund".
    const captureRows = transactions.filter((t) => t.transaction_info.transaction_event_code === 'T0005' || t.transaction_info.transaction_event_code === 'T0006');
    const captures = captureRows.map((t) => { const at = when(t); const gross = Number(t.transaction_info.transaction_amount?.value || 0); const tag = tags(t); return { capture_id: t.transaction_info.transaction_id, order_id: null, date: at.slice(0, 10), captured_at: at, customer: tag.customer, segment: tag.segment, product: tag.product, gross, fee: 0, net: gross, currency: t.transaction_info.transaction_amount?.currency_code || 'EUR', status: t.transaction_info.transaction_status || '' }; });
    const byCapture = new Map(captureRows.map((t) => [t.transaction_info.transaction_id, t]));
    const refunds = transactions.filter((t) => t.transaction_info.transaction_event_code === 'T1107').map((t) => { const at = when(t); const original = t.transaction_info.paypal_reference_id ? byCapture.get(t.transaction_info.paypal_reference_id) : undefined; const tag = original ? tags(original) : tags(t); return { refund_id: t.transaction_info.transaction_id, capture_id: original ? original.transaction_info.transaction_id : (t.transaction_info.paypal_reference_id || null), order_id: null, date: at.slice(0, 10), refunded_at: at, customer: tag.customer, segment: tag.segment, product: tag.product, amount: Math.abs(Number(t.transaction_info.transaction_amount?.value || 0)), currency: t.transaction_info.transaction_amount?.currency_code || 'EUR', reason: '', status: t.transaction_info.transaction_status || '' }; });
    const disputeRows = disputes.map((d) => ({ dispute_id: d.dispute_id, capture_id: null, order_id: null, customer: 'Unknown', segment: 'Unknown' as const, reason: d.reason || '', status: d.status, dispute_state: d.dispute_state || '', amount: Number(d.dispute_amount?.value || 0), currency: d.dispute_amount?.currency_code || 'EUR', created_date: String(d.create_time || d.update_time || '').slice(0, 10), seller_response_due_date: d.seller_response_due_date || null, days_to_respond: d.seller_response_due_date ? Math.ceil((Date.parse(d.seller_response_due_date) - this.now()) / 86400_000) : null }));
    const today = fmt(end).slice(0, 10);
    const invoiceRows = invoices.map((inv) => {
      const detail = (inv.detail || {}) as { invoice_number?: string; invoice_date?: string; payment_term?: { due_date?: string } };
      const billing = ((inv.primary_recipients || [])[0]?.billing_info || {}) as { business_name?: string; email_address?: string; name?: { full_name?: string; given_name?: string; surname?: string } };
      const amount = Number(inv.amount?.value || 0); const due = inv.due_amount ? Number(inv.due_amount.value) : (inv.status === 'PAID' || inv.status === 'MARKED_AS_PAID' ? 0 : amount);
      const dueDate = detail.payment_term?.due_date || detail.invoice_date || '';
      const daysOverdue = dueDate && due > 0 && dueDate < today ? Math.round((Date.parse(today) - Date.parse(dueDate)) / 86400_000) : 0;
      const status = (({ MARKED_AS_PAID: 'PAID', PAID_EXTERNAL: 'PAID', SCHEDULED: 'DRAFT', SHARED: 'SENT', PAYMENT_PENDING: 'UNPAID', AUTO_CANCELLED: 'CANCELLED' } as Record<string, string>)[inv.status] || inv.status) as LedgerInvoice['status'];
      return { invoice_id: inv.id, invoice_number: detail.invoice_number || '', customer: billing.business_name || billing.name?.full_name || [billing.name?.given_name, billing.name?.surname].filter(Boolean).join(' ') || billing.email_address || 'Unknown', segment: 'Unknown' as const, recipient_email: billing.email_address || '', status, issue_date: detail.invoice_date || '', due_date: dueDate, amount, amount_paid: Math.max(0, amount - due), amount_due: due, currency: inv.amount?.currency_code || 'EUR', days_overdue: daysOverdue, overdue: daysOverdue > 0, outstanding: due > 0 && ['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(status) };
    });
    return { mode: 'sandbox', generated_at: fmt(end), anchor_date: today, currency: 'EUR', captures, refunds, invoices: invoiceRows, disputes: disputeRows, tracking: [], notes: ['Live PayPal sandbox: captures/refunds from Transaction Search (PayPal: "It takes a maximum of three hours for executed transactions to appear"), invoices from Invoicing v2, disputes from Disputes v1.', 'Customer/segment/product come from tags written by npm run sandbox:seed (custom_id); other sandbox transactions show "Unknown". Refund reasons and shipment tracking are not available from these read APIs in this build.'] };
  }

  async refundPreview(input: { order_id: number; amount?: number; note_to_payer?: string }): Promise<AbilityResult> {
    const ctx = await this.orderContext(input.order_id);
    const refundAmount = Number(input.amount ?? ctx.order.total);
    if (refundAmount > 100) throw new Error('Refund cap is €100 per confirmation. This request was refused before preview.');
    if (this.client.mode === 'sandbox' && (!ctx.paypal.paypal_capture_id || ctx.paypal.paypal_capture_id.startsWith('MOCKCAPTURE'))) {
      throw new Error(`Woo order ${input.order_id} has no PayPal sandbox capture linked, so there is nothing real to refund. Run: cd mcp-server && npm run sandbox:seed -- --link-woo ${input.order_id}`);
    }
    const captureId = ctx.paypal.paypal_capture_id || `MOCKCAPTURE${input.order_id}`;
    const payload = { order_id: input.order_id, capture_id: captureId, amount: moneyValue(refundAmount), currency: ctx.order.currency || 'EUR', note_to_payer: input.note_to_payer || 'Refund from Tillwise owner agent' };
    const preview = this.preview('refund', payload);
    return { speech: `Preview ready: refund ${payload.currency} ${payload.amount} for Woo order ${input.order_id}. Say yes to move money.`, data: { preview_id: preview.id, preview_hash: preview.hash, ...payload } };
  }

  async refundApply(input: { preview_id: string }): Promise<AbilityResult> {
    const preview = this.takePreview(input.preview_id, 'refund');
    const p = preview.payload as { order_id: number; capture_id: string; amount: string; currency: string; note_to_payer: string };
    const requestId = this.requestId(`tillwise-refund-${p.order_id}`, preview);
    try {
      const refund = await this.client.createRefund({ capture_id: p.capture_id, amount: { currency_code: p.currency, value: p.amount }, note_to_payer: p.note_to_payer, request_id: requestId });
      this.invalidateActivity();
      await this.audit({ tool: 'paypal_refund_apply', woo_order_id: p.order_id, paypal_object_id: refund.id, paypal_refund_id: refund.id, paypal_capture_id: p.capture_id, amount: p.amount, currency: p.currency, idempotency_key: requestId, status: refund.status, summary: `Refunded ${p.currency} ${p.amount}` });
      return { speech: `Refund ${refund.id} completed for ${p.currency} ${p.amount}.`, data: { refund, request_id: requestId, preview_hash: preview.hash } };
    } catch (err) {
      const debug = err instanceof PayPalApiError ? err.envelope.debug_id : '';
      await this.audit({ tool: 'paypal_refund_apply', woo_order_id: p.order_id, paypal_capture_id: p.capture_id, amount: p.amount, currency: p.currency, idempotency_key: requestId, status: 'FAILED', debug_id: debug, summary: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async invoicePreview(input: { recipient_email: string; business_name?: string; items: Array<{ name: string; quantity: number; unit_amount: number }>; note?: string; currency?: string }): Promise<AbilityResult> {
    const currency = input.currency || 'EUR';
    const total = input.items.reduce((sum, item) => sum + item.quantity * item.unit_amount, 0);
    if (total > 2000) throw new Error('Invoice cap is €2,000 per confirmation. This request was refused before preview.');
    const payload = { currency, total: moneyValue(total), recipient_email: input.recipient_email, business_name: input.business_name || '', items: input.items, note: input.note || '' };
    const preview = this.preview('invoice-create', payload);
    return { speech: `Preview ready: create a PayPal invoice for ${currency} ${payload.total} to ${input.recipient_email}.`, data: { preview_id: preview.id, preview_hash: preview.hash, ...payload } };
  }

  async invoiceCreateApply(input: { preview_id: string }): Promise<AbilityResult> {
    const preview = this.takePreview(input.preview_id, 'invoice-create');
    const p = preview.payload as { currency: string; recipient_email: string; business_name: string; items: Array<{ name: string; quantity: number; unit_amount: number }>; note: string; total: string };
    const requestId = this.requestId('tillwise-invoice', preview);
    try {
      const invoice = await this.client.createInvoice({ request_id: requestId, currency_code: p.currency, note: p.note, primary_recipients: [{ billing_info: { email_address: p.recipient_email, business_name: p.business_name || undefined } }], items: p.items.map((item) => ({ name: item.name, quantity: String(item.quantity), unit_amount: { currency_code: p.currency, value: moneyValue(item.unit_amount) } })) });
      await this.audit({ tool: 'paypal_invoice_create_apply', paypal_object_id: invoice.id, paypal_invoice_id: invoice.id, amount: p.total, currency: p.currency, idempotency_key: requestId, status: invoice.status, summary: `Created invoice ${invoice.id}` });
      return { speech: `Invoice ${invoice.id} was created as ${invoice.status}.`, data: { invoice, request_id: requestId, preview_hash: preview.hash } };
    } catch (err) {
      const debug = err instanceof PayPalApiError ? err.envelope.debug_id : '';
      await this.audit({ tool: 'paypal_invoice_create_apply', amount: p.total, currency: p.currency, idempotency_key: requestId, status: 'FAILED', debug_id: debug, summary: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async invoiceSendApply(input: { invoice_id: string; note?: string }): Promise<AbilityResult> {
    const requestId = `tillwise-send-invoice-${hash(input).slice(0, 16)}`;
    try {
      const invoice = await this.client.sendInvoice({ invoice_id: input.invoice_id, note: input.note, send_to_recipient: true, request_id: requestId });
      await this.audit({ tool: 'paypal_invoice_send_apply', paypal_object_id: input.invoice_id, paypal_invoice_id: input.invoice_id, idempotency_key: requestId, status: invoice.status || 'SENT', summary: `Sent invoice ${input.invoice_id}` });
      return { speech: `Invoice ${input.invoice_id} was sent.`, data: { invoice, request_id: requestId } };
    } catch (err) {
      const debug = err instanceof PayPalApiError ? err.envelope.debug_id : '';
      await this.audit({ tool: 'paypal_invoice_send_apply', paypal_object_id: input.invoice_id, paypal_invoice_id: input.invoice_id, idempotency_key: requestId, status: 'FAILED', debug_id: debug, summary: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async trackingAddApply(input: { order_id: number; transaction_id?: string; tracking_number: string; carrier: string; status?: string }): Promise<AbilityResult> {
    const ctx = await this.orderContext(input.order_id);
    const transactionId = input.transaction_id || ctx.paypal.paypal_capture_id || `MOCKCAPTURE${input.order_id}`;
    const requestId = `tillwise-tracking-${input.order_id}-${hash(input).slice(0, 16)}`;
    try {
      const shipment = await this.client.createShipmentTracking({ transaction_id: transactionId, tracking_number: input.tracking_number, carrier: input.carrier, status: input.status || 'SHIPPED', request_id: requestId });
      await this.audit({ tool: 'paypal_tracking_add_apply', woo_order_id: input.order_id, paypal_object_id: shipment.id, paypal_tracking_id: shipment.id, paypal_capture_id: transactionId, idempotency_key: requestId, status: shipment.status, summary: `Added ${input.carrier} tracking ${input.tracking_number}` });
      return { speech: `Tracking ${input.tracking_number} was added for PayPal transaction ${transactionId}.`, data: { shipment, request_id: requestId } };
    } catch (err) {
      const debug = err instanceof PayPalApiError ? err.envelope.debug_id : '';
      await this.audit({ tool: 'paypal_tracking_add_apply', woo_order_id: input.order_id, paypal_capture_id: transactionId, idempotency_key: requestId, status: 'FAILED', debug_id: debug, summary: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async disputesList(): Promise<AbilityResult> {
    const { disputes, hidden } = await this.ownedDisputes(await this.client.listDisputes({ page_size: 10, page: 1 }));
    return { speech: `${disputes.length} PayPal disputes found.${hidden ? ` ${hidden} other disputes on the shared sandbox app belong to other users and are not shown.` : ''}`, data: { disputes, ...(hidden ? { other_users_disputes_hidden: hidden } : {}) } };
  }
  private async ownedDispute(dispute_id: string): Promise<PayPalDispute> {
    const dispute = await this.client.getDispute(dispute_id);
    if ((await this.ownedDisputes([dispute])).hidden) throw new Error(`Dispute ${dispute_id} is not on a capture Tillwise created, so on the shared PayPal sandbox app it belongs to someone else. Not shown and not acted on.`);
    return dispute;
  }
  async disputeGet(input: { dispute_id: string }): Promise<AbilityResult> { const dispute = await this.ownedDispute(input.dispute_id); return { speech: `Dispute ${input.dispute_id} is ${dispute.status}.`, data: { dispute } }; }
  async disputeAcceptClaimPreview(input: { dispute_id: string; note?: string }): Promise<AbilityResult> {
    const dispute = await this.ownedDispute(input.dispute_id);
    const amount = Number(dispute.dispute_amount?.value || 0);
    if (amount > 100) throw new Error('Dispute accept cap is €100 per confirmation. This request was refused before preview.');
    const payload = { dispute_id: input.dispute_id, amount: moneyValue(amount), currency: dispute.dispute_amount?.currency_code || 'EUR', reason: dispute.reason || '', status: dispute.status, deadline: dispute.update_time || '', note: input.note || 'Tillwise owner accepted the PayPal dispute claim.' };
    const preview = this.preview('dispute-accept', payload);
    return { speech: `Preview ready: accept PayPal dispute ${input.dispute_id} for ${payload.currency} ${payload.amount}. Say yes only if you accept PayPal may refund the customer.`, data: { preview_id: preview.id, preview_hash: preview.hash, ...payload, dispute } };
  }
  async disputeAcceptClaimApply(input: { preview_id: string }): Promise<AbilityResult> {
    const preview = this.takePreview(input.preview_id, 'dispute-accept');
    const p = preview.payload as { dispute_id: string; note: string; amount: string; currency: string };
    const requestId = this.requestId('tillwise-accept-dispute', preview);
    try {
      const result = await this.client.acceptDisputeClaim({ dispute_id: p.dispute_id, note: p.note, request_id: requestId });
      await this.audit({ tool: 'paypal_dispute_accept_claim_apply', paypal_object_id: p.dispute_id, amount: p.amount, currency: p.currency, idempotency_key: requestId, status: result.status, summary: `Accepted dispute claim ${p.dispute_id}` });
      return { speech: `Accepted liability for dispute ${p.dispute_id}. PayPal may refund the customer.`, data: { result, request_id: requestId, preview_hash: preview.hash } };
    } catch (err) {
      const debug = err instanceof PayPalApiError ? err.envelope.debug_id : '';
      await this.audit({ tool: 'paypal_dispute_accept_claim_apply', paypal_object_id: p.dispute_id, amount: p.amount, currency: p.currency, idempotency_key: requestId, status: 'FAILED', debug_id: debug, summary: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  guardrailRefusal(input: { reason?: string }): AbilityResult { return { speech: `I cannot do that PayPal money action. ${input.reason || 'Bulk, over-cap, or unpreviewed money movement is blocked by Tillwise guardrails.'}`, data: { refused: true, reason: input.reason || 'guardrail' } }; }
}
