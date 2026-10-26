import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseSeedCustomId } from './seedTags.js';
import type { PayPalDispute, PayPalInvoice, PayPalOrder } from './types.js';

/**
 * Live rows for the objects Tillwise itself created in the PayPal sandbox (seed captures, their refunds, voice-flow
 * refunds on linked Woo orders, the seed invoice). They are read by id, never by search:
 * - PayPal's public default sandbox app is SHARED, so Transaction Search returns other people's traffic
 *   (377 rows in 24 h on 2026-10-26; 30 days → RESULTSET_TOO_LARGE) and has no invoice_id/custom_id filter;
 * - search rows appear up to 3 h late, while GET /v2/checkout/orders/{id} returns captures AND refunds at once.
 * The ids come from the seed manifest written by `npm run sandbox:seed` (ids only, no secrets).
 */
export const DEFAULT_SEED_MANIFEST_PATH = join(homedir(), '.config', 'tillwise', 'paypal-sandbox-seed.json');

export type SeedManifestLike = {
  run_tag?: string;
  captures?: Record<string, { order_id?: string; capture_id?: string; capture_status?: string; woo_order_id?: number; linked?: boolean }>;
  invoices?: Record<string, { invoice_id?: string }>;
};

export type SandboxActivityRow = {
  kind: 'capture' | 'refund' | 'invoice';
  paypal_id: string;
  paypal_order_id: string | null;
  capture_id: string | null;
  order_id: number | null;
  date: string;
  created_at: string;
  tag: string;
  customer: string;
  product: string;
  amount: number;
  fee: number | null;
  currency: string;
  status: string;
  note: string;
};

export type SandboxActivity = { run_tag: string | null; rows: SandboxActivityRow[]; owned_capture_ids: string[]; errors: string[]; read_at: string };

export type ActivityClient = { getOrder(id: string): Promise<PayPalOrder>; getInvoice(id: string): Promise<PayPalInvoice> };

export function readSeedManifest(path = process.env.TILLWISE_PAYPAL_SEED_MANIFEST || DEFAULT_SEED_MANIFEST_PATH): SeedManifestLike | null {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as SeedManifestLike; } catch { return null; }
}

const num = (value: unknown) => { const n = Number((value as { value?: string } | undefined)?.value ?? NaN); return Number.isFinite(n) ? n : 0; };
const cur = (value: unknown) => String((value as { currency_code?: string } | undefined)?.currency_code || 'EUR');

export async function loadSandboxActivity(client: ActivityClient, manifest: SeedManifestLike | null, now = () => new Date()): Promise<SandboxActivity> {
  const rows: SandboxActivityRow[] = [];
  const owned = new Set<string>();
  const errors: string[] = [];
  for (const [tag, entry] of Object.entries(manifest?.captures || {})) {
    if (!entry.order_id) continue;
    try {
      const order = await client.getOrder(entry.order_id) as PayPalOrder & { purchase_units?: Array<Record<string, any>> };
      const unit = order.purchase_units?.[0] || {};
      const who = parseSeedCustomId(unit.custom_id) || { customer: 'Unknown', product: 'Unknown', segment: 'Unknown' };
      const wooOrder = typeof entry.woo_order_id === 'number' ? entry.woo_order_id : null;
      for (const capture of (unit.payments?.captures || []) as Array<Record<string, any>>) {
        owned.add(String(capture.id));
        const at = String(capture.create_time || order.create_time || '');
        rows.push({ kind: 'capture', paypal_id: String(capture.id), paypal_order_id: order.id, capture_id: String(capture.id), order_id: wooOrder, date: at.slice(0, 10), created_at: at, tag, customer: who.customer, product: who.product, amount: num(capture.amount), fee: capture.seller_receivable_breakdown?.paypal_fee ? num(capture.seller_receivable_breakdown.paypal_fee) : null, currency: cur(capture.amount), status: String(capture.status || ''), note: '' });
      }
      const firstCapture = (unit.payments?.captures || [])[0]?.id;
      for (const refund of (unit.payments?.refunds || []) as Array<Record<string, any>>) {
        const at = String(refund.create_time || '');
        rows.push({ kind: 'refund', paypal_id: String(refund.id), paypal_order_id: order.id, capture_id: firstCapture ? String(firstCapture) : null, order_id: wooOrder, date: at ? new Date(at).toISOString().slice(0, 10) : '', created_at: at ? new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z') : '', tag: String(refund.custom_id || tag), customer: who.customer, product: who.product, amount: num(refund.amount), fee: null, currency: cur(refund.amount), status: String(refund.status || ''), note: String(refund.note_to_payer || '') });
      }
    } catch (error) {
      errors.push(`${tag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const [tag, entry] of Object.entries(manifest?.invoices || {})) {
    if (!entry.invoice_id) continue;
    try {
      const invoice = await client.getInvoice(entry.invoice_id);
      const billing = ((invoice.primary_recipients || [])[0] as { billing_info?: { business_name?: string } } | undefined)?.billing_info || {};
      const detail = (invoice.detail || {}) as { invoice_date?: string; metadata?: { create_time?: string } };
      const at = String(detail.metadata?.create_time || detail.invoice_date || '');
      rows.push({ kind: 'invoice', paypal_id: invoice.id, paypal_order_id: null, capture_id: null, order_id: null, date: at.slice(0, 10), created_at: at, tag, customer: billing.business_name || 'Unknown', product: '', amount: num(invoice.amount), fee: null, currency: cur(invoice.amount), status: String(invoice.status || ''), note: invoice.due_amount ? `due ${invoice.due_amount.currency_code} ${invoice.due_amount.value}` : '' });
    } catch (error) {
      errors.push(`${tag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { run_tag: manifest?.run_tag || null, rows, owned_capture_ids: [...owned], errors, read_at: now().toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

/** A dispute is ours only if it names one of our captures; everything else on the shared sandbox app belongs to someone else. */
export function disputeIsOwned(dispute: PayPalDispute & { disputed_transactions?: Array<{ seller_transaction_id?: string }> }, ownedCaptureIds: Iterable<string>): boolean {
  const owned = new Set(ownedCaptureIds);
  return (dispute.disputed_transactions || []).some((t) => t.seller_transaction_id && owned.has(t.seller_transaction_id));
}

/**
 * app_id of the default public sandbox credentials in PayPal's official Postman collections
 * (github.com/paypal/postman-collections, Collections/PayPal_Public_APIs.json, variables client_id/client_secret),
 * as returned by POST /v1/oauth2/token on 2026-10-26. Used only to label the UI honestly as a SHARED app.
 */
export const PAYPAL_PUBLIC_DEFAULT_APP_ID = 'APP-80W284485P519543T';
export function sandboxAppLabel(appId: string | null): { shared_public_default: boolean; label: string } {
  return appId === PAYPAL_PUBLIC_DEFAULT_APP_ID
    ? { shared_public_default: true, label: "PayPal's public default sandbox app (shared)" }
    : { shared_public_default: false, label: 'your own PayPal sandbox app' };
}
