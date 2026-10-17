import { createHash, randomUUID } from 'node:crypto';
import { WpAbilityClient, type AbilityResult } from '../wpClient.js';
import { MockPayPalClient } from './mockClient.js';
import { LivePayPalClient, readSandboxCredentials } from './liveClient.js';
import { PayPalApiError, type PayPalClient, type PayPalLedger } from './types.js';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value: unknown) { return createHash('sha256').update(stable(value)).digest('hex'); }
function moneyValue(value: number) { return value.toFixed(2); }
function isoDaysAgo(days: number) { const d = new Date(Date.now() - days * 86400_000); return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

type Preview = { id: string; hash: string; kind: string; payload: Record<string, unknown>; createdAt: number };
type ServiceOptions = { previewTtlMs?: number; now?: () => number };

type OrderContext = { order: { id: number; total: number; currency: string; billing_email?: string; items?: Array<{ name: string; quantity: number; total: number }> }; paypal: { paypal_capture_id?: string; paypal_order_id?: string; paypal_invoice_id?: string } };

export class PayPalService {
  private previews = new Map<string, Preview>();
  private readonly previewTtlMs: number;
  private readonly now: () => number;
  constructor(private readonly wp: Pick<WpAbilityClient, 'run'>, private readonly client: PayPalClient, options: ServiceOptions = {}) {
    this.previewTtlMs = options.previewTtlMs ?? 10 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  static fromEnv(wp: Pick<WpAbilityClient, 'run'>, env: Record<string, string | undefined> = process.env) {
    const creds = readSandboxCredentials();
    const mode = env.PAYPAL_MODE || (creds ? 'sandbox' : 'mock');
    if (mode !== 'mock' && mode !== 'sandbox') throw new Error('PAYPAL_MODE must be mock or sandbox.');
    if (mode === 'sandbox' && !creds) throw new Error('PAYPAL_MODE=sandbox requires ~/.config/tillwise/paypal-sandbox.env.');
    return new PayPalService(wp, mode === 'sandbox' && creds ? new LivePayPalClient(creds) : new MockPayPalClient());
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
    const transactions = await this.client.listTransactions({ start_date: isoDaysAgo(30), end_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), page_size: 20, page: 1 });
    const disputes = await this.client.listDisputes({ page_size: 10, page: 1 });
    const refundCount = transactions.filter((t) => String(t.transaction_info.transaction_event_code || '').startsWith('T11')).length;
    return { speech: `PayPal money briefing: ${transactions.length} recent transactions, ${disputes.length} open disputes, and ${refundCount} refund-like records.`, data: { mode: this.client.mode, transactions, disputes, audit: audit.data.audit || [], counts: { transactions: transactions.length, disputes: disputes.length, refund_like: refundCount } } };
  }

  async ledgerExport(input: { days?: number } = {}): Promise<AbilityResult> {
    const days = Math.min(Math.max(Math.floor(input.days ?? 45), 1), 90);
    const ledger = this.client.ledger ? this.client.ledger() : await this.sandboxLedger(days);
    const since = new Date(this.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
    const data: PayPalLedger = { ...ledger, captures: ledger.captures.filter((c) => c.date >= since), refunds: ledger.refunds.filter((r) => r.date >= since) };
    const counts = { captures: data.captures.length, refunds: data.refunds.length, invoices: data.invoices.length, disputes: data.disputes.length, tracking: data.tracking.length };
    return { speech: `PayPal ledger export (${data.mode}) for the last ${days} days: ${counts.captures} captures, ${counts.refunds} refunds, ${counts.invoices} invoices, ${counts.disputes} disputes, ${counts.tracking} tracking rows.`, data: { ...data, days, counts } as unknown as Record<string, unknown> };
  }

  private async sandboxLedger(days: number): Promise<PayPalLedger> {
    const end = new Date(this.now()); const start = new Date(this.now() - days * 86400_000);
    const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const transactions = await this.client.listTransactions({ start_date: fmt(start), end_date: fmt(end), page_size: 500, page: 1 });
    const disputes = await this.client.listDisputes({ page_size: 50, page: 1 });
    const captures = transactions.filter((t) => t.transaction_info.transaction_event_code === 'T0006').map((t) => { const at = String(t.transaction_info.transaction_updated_date || ''); const gross = Number(t.transaction_info.transaction_amount?.value || 0); return { capture_id: t.transaction_info.transaction_id, order_id: null, date: at.slice(0, 10), captured_at: at, customer: 'Unknown', segment: 'Unknown' as const, gross, fee: 0, net: gross, currency: t.transaction_info.transaction_amount?.currency_code || 'EUR', status: t.transaction_info.transaction_status || '' }; });
    const refunds = transactions.filter((t) => String(t.transaction_info.transaction_event_code || '').startsWith('T11')).map((t) => { const at = String(t.transaction_info.transaction_updated_date || ''); return { refund_id: t.transaction_info.transaction_id, capture_id: null, order_id: null, date: at.slice(0, 10), refunded_at: at, customer: 'Unknown', segment: 'Unknown' as const, amount: Math.abs(Number(t.transaction_info.transaction_amount?.value || 0)), currency: t.transaction_info.transaction_amount?.currency_code || 'EUR', reason: '', status: t.transaction_info.transaction_status || '' }; });
    const disputeRows = disputes.map((d) => ({ dispute_id: d.dispute_id, capture_id: null, order_id: null, customer: 'Unknown', segment: 'Unknown' as const, reason: d.reason || '', status: d.status, dispute_state: d.dispute_state || '', amount: Number(d.dispute_amount?.value || 0), currency: d.dispute_amount?.currency_code || 'EUR', created_date: String(d.create_time || d.update_time || '').slice(0, 10), seller_response_due_date: d.seller_response_due_date || null, days_to_respond: d.seller_response_due_date ? Math.ceil((Date.parse(d.seller_response_due_date) - this.now()) / 86400_000) : null }));
    return { mode: 'sandbox', generated_at: fmt(end), anchor_date: fmt(end).slice(0, 10), currency: 'EUR', captures, refunds, invoices: [], disputes: disputeRows, tracking: [], notes: ['Sandbox mode: invoices and tracking are not listed by this build; customer segments are unknown.'] };
  }

  async refundPreview(input: { order_id: number; amount?: number; note_to_payer?: string }): Promise<AbilityResult> {
    const ctx = await this.orderContext(input.order_id);
    const refundAmount = Number(input.amount ?? ctx.order.total);
    if (refundAmount > 100) throw new Error('Refund cap is €100 per confirmation. This request was refused before preview.');
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

  async disputesList(): Promise<AbilityResult> { const disputes = await this.client.listDisputes({ page_size: 10, page: 1 }); return { speech: `${disputes.length} PayPal disputes found.`, data: { disputes } }; }
  async disputeGet(input: { dispute_id: string }): Promise<AbilityResult> { const dispute = await this.client.getDispute(input.dispute_id); return { speech: `Dispute ${input.dispute_id} is ${dispute.status}.`, data: { dispute } }; }
  async disputeAcceptClaimPreview(input: { dispute_id: string; note?: string }): Promise<AbilityResult> {
    const dispute = await this.client.getDispute(input.dispute_id);
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
