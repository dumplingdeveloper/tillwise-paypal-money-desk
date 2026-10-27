import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockPayPalClient } from '../src/paypal/mockClient.js';
import { PayPalService } from '../src/paypal/service.js';
import { disputeIsOwned, loadSandboxActivity, PAYPAL_PUBLIC_DEFAULT_APP_ID, readSeedManifest } from '../src/paypal/sandboxActivity.js';
import type { PayPalClient, PayPalDispute, PayPalInvoice, PayPalOrder } from '../src/paypal/types.js';

// Shapes copied from the real sandbox responses of 2026-10-26 (docs/FACTS_PAYPAL_SANDBOX.md §9), ids shortened.
const ORDER: PayPalOrder & Record<string, unknown> = {
  id: 'ORDER-CAP01', status: 'COMPLETED', create_time: '2026-10-26T13:36:26Z',
  purchase_units: [{
    invoice_id: 'TW-DEMO-RUN123-CAP-01', custom_id: 'tillwise-demo;seg=Retail;cust=Aoife Byrne;prod=Stoneware Mug Set',
    payments: {
      captures: [{ id: 'CAP01', status: 'PARTIALLY_REFUNDED', amount: { currency_code: 'EUR', value: '24.00' }, create_time: '2026-10-26T13:36:26Z', seller_receivable_breakdown: { gross_amount: { currency_code: 'EUR', value: '24.00' }, paypal_fee: { currency_code: 'EUR', value: '1.37' }, net_amount: { currency_code: 'EUR', value: '22.63' } } }],
      refunds: [{ id: 'REF01', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '6.00' }, custom_id: 'TW-DEMO-RUN123-REF-01', note_to_payer: 'Partial refund: one mug arrived chipped (Tillwise sandbox demo).', create_time: '2026-10-26T06:36:36-07:00' }],
    },
  }],
};
const WOO_ORDER: PayPalOrder & Record<string, unknown> = {
  id: 'ORDER-WOO', status: 'COMPLETED', purchase_units: [{ custom_id: 'tillwise-demo;seg=Retail;cust=Woo order 416;prod=Thank You Gift Box', payments: { captures: [{ id: 'CAPWOO', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '31.00' }, create_time: '2026-10-26T14:00:00Z' }] } }],
};
const INVOICE: PayPalInvoice = { id: 'INV2-AAAA', status: 'UNPAID', detail: { invoice_number: 'TW-DEMO-RUN123-INV-01', metadata: { create_time: '2026-10-26T13:36:40Z' } }, primary_recipients: [{ billing_info: { business_name: 'Galway Gift House', email_address: 'galway-gift-house@example.com' } }], amount: { currency_code: 'EUR', value: '180.00' }, due_amount: { currency_code: 'EUR', value: '180.00' } };
const MANIFEST = { run_tag: 'RUN123', captures: { 'TW-DEMO-RUN123-CAP-01': { order_id: 'ORDER-CAP01', capture_id: 'CAP01' }, 'TW-DEMO-RUN123-WOO-416-3100': { order_id: 'ORDER-WOO', capture_id: 'CAPWOO', woo_order_id: 416, linked: true } }, invoices: { 'TW-DEMO-RUN123-INV-01': { invoice_id: 'INV2-AAAA' } } };
const OURS: PayPalDispute & Record<string, unknown> = { dispute_id: 'PP-D-OURS', status: 'WAITING_FOR_SELLER_RESPONSE', dispute_amount: { currency_code: 'EUR', value: '24.00' }, disputed_transactions: [{ seller_transaction_id: 'CAP01' }] };
const THEIRS: PayPalDispute & Record<string, unknown> = { dispute_id: 'PP-D-THEIRS', status: 'WAITING_FOR_SELLER_RESPONSE', dispute_amount: { currency_code: 'USD', value: '10.00' }, disputed_transactions: [{ seller_transaction_id: 'SOMEONE-ELSE' }] };

function fakeLive(calls: string[] = []): PayPalClient {
  const base = new MockPayPalClient();
  return Object.assign(Object.create(base) as PayPalClient, {
    mode: 'sandbox' as const,
    ledger: undefined,
    async getOrder(id: string) { calls.push(`order ${id}`); return id === 'ORDER-WOO' ? WOO_ORDER : ORDER; },
    async getInvoice(id: string) { calls.push(`invoice ${id}`); return INVOICE; },
    async appId() { return PAYPAL_PUBLIC_DEFAULT_APP_ID; },
    async listDisputes() { calls.push('disputes'); return [OURS, THEIRS]; },
    async getDispute(id: string) { calls.push(`dispute ${id}`); return id === OURS.dispute_id ? OURS : THEIRS; },
    async createRefund(input: { capture_id: string; amount?: { currency_code: string; value: string } }) { calls.push(`refund ${input.capture_id}`); return { id: 'REFNEW', status: 'COMPLETED', amount: input.amount!, capture_id: input.capture_id }; },
  });
}
function fakeWp(captureId: string | undefined) {
  const audits: Record<string, unknown>[] = [];
  return { audits, async run(name: string, input: Record<string, unknown> = {}) {
    if (name === 'paypal-order-context') return { speech: '', data: { order: { id: input.order_id, total: 31, currency: 'EUR' }, paypal: { paypal_capture_id: captureId } } };
    if (name === 'paypal-audit-record') { audits.push(input); return { speech: 'ok', data: { count: audits.length } }; }
    if (name === 'paypal-audit-list') return { speech: '', data: { audit: audits } };
    throw new Error(name);
  } };
}
const activityFrom = (client: PayPalClient) => () => loadSandboxActivity({ getOrder: client.getOrder!.bind(client), getInvoice: client.getInvoice!.bind(client) }, MANIFEST, () => new Date('2026-10-26T14:05:00Z'));

test('sandbox activity: captures, refunds and the invoice are read by id and keep real fees, tags and statuses', async () => {
  const calls: string[] = [];
  const activity = await activityFrom(fakeLive(calls))();
  assert.deepEqual(calls, ['order ORDER-CAP01', 'order ORDER-WOO', 'invoice INV2-AAAA'], 'one GET per object; no search');
  const byId = Object.fromEntries(activity.rows.map((r) => [r.paypal_id, r]));
  assert.deepEqual({ kind: byId.CAP01.kind, amount: byId.CAP01.amount, fee: byId.CAP01.fee, status: byId.CAP01.status, customer: byId.CAP01.customer, product: byId.CAP01.product }, { kind: 'capture', amount: 24, fee: 1.37, status: 'PARTIALLY_REFUNDED', customer: 'Aoife Byrne', product: 'Stoneware Mug Set' });
  assert.deepEqual({ kind: byId.REF01.kind, amount: byId.REF01.amount, capture: byId.REF01.capture_id, date: byId.REF01.date, at: byId.REF01.created_at, tag: byId.REF01.tag }, { kind: 'refund', amount: 6, capture: 'CAP01', date: '2026-10-26', at: '2026-10-26T13:36:36Z', tag: 'TW-DEMO-RUN123-REF-01' });
  assert.equal(byId.CAPWOO.order_id, 416);
  assert.deepEqual({ kind: byId['INV2-AAAA'].kind, amount: byId['INV2-AAAA'].amount, status: byId['INV2-AAAA'].status, customer: byId['INV2-AAAA'].customer }, { kind: 'invoice', amount: 180, status: 'UNPAID', customer: 'Galway Gift House' });
  assert.deepEqual(activity.owned_capture_ids.sort(), ['CAP01', 'CAPWOO']);
  assert.equal(disputeIsOwned(OURS, activity.owned_capture_ids), true);
  assert.equal(disputeIsOwned(THEIRS, activity.owned_capture_ids), false);
});

test('sandbox mode: ledger export = labelled mock analytics + live sandbox_activity; mode fields say which is which', async () => {
  const live = fakeLive();
  const service = new PayPalService(fakeWp('CAPWOO'), live, { analytics: new MockPayPalClient(), activity: activityFrom(live) });
  const out = await service.ledgerExport({ days: 45 });
  const data = out.data as Record<string, any>;
  assert.equal(data.mode, 'mock', 'the analytics tables are the mock ledger and say so');
  assert.equal(data.ledger_source, 'mock');
  assert.equal(data.paypal_mode, 'sandbox', 'money moves in the live sandbox');
  assert.ok(data.captures.length > 50, 'mock analytics rows');
  assert.equal(data.sandbox_activity.length, 4);
  assert.equal(data.counts.sandbox_activity, 4);
  assert.deepEqual(data.sandbox_activity_meta.sandbox_app, { shared_public_default: true, label: "PayPal's public default sandbox app (shared)" });
  assert.match(data.notes.at(-1), /LIVE sandbox .*labelled mock ledger \(demo data, not PayPal\)/);
  const anomaly = (await service.refundAnomaly({})).data as Record<string, any>;
  assert.equal(anomaly.mode, 'mock', 'the anomaly drill-down stays on the mock ledger');
});

test('mock mode: ledger export reports paypal_mode mock and no sandbox activity', async () => {
  const service = new PayPalService(fakeWp('MOCKCAPTURE1'), new MockPayPalClient());
  const data = (await service.ledgerExport({})).data as Record<string, any>;
  assert.equal(data.paypal_mode, 'mock');
  assert.deepEqual(data.sandbox_activity, []);
  assert.equal(data.sandbox_activity_meta, null);
});

test('sandbox mode on a shared app: other users\' disputes are hidden and cannot be previewed or accepted', async () => {
  const calls: string[] = [];
  const live = fakeLive(calls);
  const service = new PayPalService(fakeWp('CAPWOO'), live, { analytics: new MockPayPalClient(), activity: activityFrom(live) });
  const list = await service.disputesList();
  assert.deepEqual((list.data.disputes as PayPalDispute[]).map((d) => d.dispute_id), ['PP-D-OURS']);
  assert.equal(list.data.other_users_disputes_hidden, 1);
  await assert.rejects(service.disputeAcceptClaimPreview({ dispute_id: 'PP-D-THEIRS' }), /belongs to someone else/);
  await assert.rejects(service.disputeGet({ dispute_id: 'PP-D-THEIRS' }), /belongs to someone else/);
  const ours = await service.disputeAcceptClaimPreview({ dispute_id: 'PP-D-OURS' });
  assert.equal(ours.data.dispute_id, 'PP-D-OURS');
  const briefing = await service.moneyBriefing();
  assert.deepEqual(briefing.data.counts, { captures: 2, refunds: 1, invoices: 1, disputes: 1, other_users_disputes_hidden: 1 });
  assert.match(briefing.speech, /^PayPal sandbox briefing \(live, PayPal's public default sandbox app \(shared\)\): 2 captures of EUR 55\.00, 1 refunds of EUR 6\.00/);
});

test('sandbox mode refuses a refund preview for a Woo order without a real linked capture, and refreshes activity after a refund', async () => {
  const unlinked = new PayPalService(fakeWp('MOCKCAPTURE416'), fakeLive(), { analytics: new MockPayPalClient(), activity: async () => ({ run_tag: null, rows: [], owned_capture_ids: [], errors: [], read_at: '' }) });
  await assert.rejects(unlinked.refundPreview({ order_id: 416 }), /no PayPal sandbox capture linked.*sandbox:seed -- --link-woo 416/);
  let loads = 0;
  const calls: string[] = [];
  const live = fakeLive(calls);
  const wp = fakeWp('CAPWOO');
  const service = new PayPalService(wp, live, { analytics: new MockPayPalClient(), activity: async () => { loads += 1; return activityFrom(live)(); } });
  await service.ledgerExport({});
  await service.ledgerExport({});
  assert.equal(loads, 1, 'cached between quick reads');
  const preview = await service.refundPreview({ order_id: 416 });
  assert.equal(preview.data.capture_id, 'CAPWOO');
  const applied = await service.refundApply({ preview_id: String(preview.data.preview_id) });
  assert.equal((applied.data.refund as { id: string }).id, 'REFNEW');
  assert.equal(wp.audits.at(-1)?.paypal_refund_id, 'REFNEW');
  await service.ledgerExport({});
  assert.equal(loads, 2, 'a refund invalidates the cache so the Money Desk shows it at once');
});

test('sandbox activity: a refund applied in one MCP session invalidates the cache another session reads (shared per server)', async () => {
  let loads = 0;
  const live = fakeLive([]);
  const activityShared = {};
  const activity = async () => { loads += 1; return activityFrom(live)(); };
  // One service per MCP session, as createServer builds them; a long TTL so only invalidation can force a reload.
  const voice = new PayPalService(fakeWp('CAPWOO'), live, { analytics: new MockPayPalClient(), activity, activityShared, activityTtlMs: 15 * 60_000 });
  const desk = new PayPalService(fakeWp('CAPWOO'), live, { analytics: new MockPayPalClient(), activity, activityShared, activityTtlMs: 15 * 60_000 });
  await desk.ledgerExport({});
  await voice.ledgerExport({});
  assert.equal(loads, 1, 'both sessions share one cached read');
  const preview = await voice.refundPreview({ order_id: 416 });
  await voice.refundApply({ preview_id: String(preview.data.preview_id) });
  await desk.ledgerExport({});
  assert.equal(loads, 2, 'the Money Desk session re-reads after the voice session refunded');
  await assert.rejects(desk.refundApply({ preview_id: String(preview.data.preview_id) }), 'previews stay per session');
});

test('readSeedManifest reads the seed manifest path from TILLWISE_PAYPAL_SEED_MANIFEST and tolerates a missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-manifest-'));
  const path = join(dir, 'm.json');
  assert.equal(readSeedManifest(path), null);
  writeFileSync(path, JSON.stringify(MANIFEST));
  assert.equal(readSeedManifest(path)?.run_tag, 'RUN123');
});
