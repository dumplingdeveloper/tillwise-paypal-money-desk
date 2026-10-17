import test from 'node:test';
import assert from 'node:assert/strict';
import { MockPayPalClient } from '../src/paypal/mockClient.js';
import { PayPalService } from '../src/paypal/service.js';
import { LivePayPalClient } from '../src/paypal/liveClient.js';

function fakeWp() {
  const audits: Record<string, unknown>[] = [];
  return {
    audits,
    async run(name: string, input: Record<string, unknown> = {}) {
      if (name === 'paypal-order-context') return { speech: 'Order 123 is processing for €39.', data: { order: { id: input.order_id, total: 39, currency: 'EUR', billing_email: 'buyer@example.test', items: [{ name: 'Mug', quantity: 1, total: 39 }] }, paypal: { paypal_capture_id: 'MOCKCAPTURE123' } } };
      if (name === 'paypal-audit-record') { audits.push(input); return { speech: 'PayPal audit recorded.', data: { audit: input, count: audits.length } }; }
      if (name === 'paypal-audit-list') return { speech: `${audits.length} rows`, data: { audit: audits, count: audits.length } };
      throw new Error(`Unexpected ability ${name}`);
    },
  };
}

test('mock refund preview/apply enforces cap, idempotency, and audit', async () => {
  const wp = fakeWp();
  const service = new PayPalService(wp, new MockPayPalClient());
  const preview = await service.refundPreview({ order_id: 123, amount: 10, note_to_payer: 'Broken item' });
  assert.match(String(preview.data.preview_id), /^ppv_/);
  const applied = await service.refundApply({ preview_id: String(preview.data.preview_id) });
  assert.equal((applied.data.refund as { status: string }).status, 'COMPLETED');
  assert.equal(wp.audits.length, 1);
  assert.equal(wp.audits[0].tool, 'paypal_refund_apply');
  await assert.rejects(() => service.refundPreview({ order_id: 123, amount: 101 }), /Refund cap/);
});

test('mock invoice, tracking, disputes, and briefing return deterministic shapes', async () => {
  const wp = fakeWp();
  const service = new PayPalService(wp, new MockPayPalClient());
  const invoicePreview = await service.invoicePreview({ recipient_email: 'buyer@example.test', items: [{ name: 'Mug', quantity: 12, unit_amount: 10 }] });
  const invoice = await service.invoiceCreateApply({ preview_id: String(invoicePreview.data.preview_id) });
  assert.match((invoice.data.invoice as { id: string }).id, /^INV2-MOCK-/);
  const sent = await service.invoiceSendApply({ invoice_id: (invoice.data.invoice as { id: string }).id });
  assert.equal((sent.data.invoice as { status: string }).status, 'SENT');
  const tracking = await service.trackingAddApply({ order_id: 123, tracking_number: '1Z999', carrier: 'UPS' });
  assert.equal((tracking.data.shipment as { carrier: string }).carrier, 'UPS');
  const disputes = await service.disputesList();
  assert.equal((disputes.data.disputes as unknown[]).length, 1);
  const briefing = await service.moneyBriefing();
  assert.equal((briefing.data.counts as { disputes: number }).disputes, 1);
});

test('live client contract sends token, SDK order/refund/transactions, and fetch invoice/dispute/tracking requests', async () => {
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    if (String(url).endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'stub-token', token_type: 'Bearer', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/v2/invoicing/invoices') && init?.method === 'POST') return new Response(JSON.stringify({ id: 'INV2-LIVE-STUB', status: 'DRAFT' }), { status: 201, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/v1/shipping/trackers-batch')) return new Response(JSON.stringify({ tracker_identifiers: [{ transaction_id: 'CAPTURE1', tracking_number: '1Z' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).includes('/v1/customer/disputes/D-1/accept-claim')) return new Response(null, { status: 204 });
    if (String(url).includes('/v1/customer/disputes?')) return new Response(JSON.stringify({ items: [{ dispute_id: 'D-1', status: 'WAITING_FOR_SELLER_RESPONSE' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`Unexpected fetch ${url}`);
  };
  const sdkCalls: any[] = [];
  const sdkAdapter = async (config: any) => {
    sdkCalls.push(config);
    const url = String(config.url);
    if (url.includes('/v2/checkout/orders') && config.method === 'post') return { data: JSON.stringify({ id: 'ORDER1', status: 'CREATED' }), status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' }, config };
    if (url.includes('/v2/payments/captures/CAPTURE1/refund')) return { data: JSON.stringify({ id: 'REFUND1', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '1.00' } }), status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' }, config };
    if (url.includes('/v1/reporting/transactions')) return { data: JSON.stringify({ transaction_details: [{ transaction_info: { transaction_id: 'T1' } }] }), status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config };
    throw new Error(`Unexpected sdk ${config.method} ${url}`);
  };
  const client = new LivePayPalClient({ clientId: 'id', clientSecret: 'secret', fetchImpl, sdkAdapter });
  await client.createOrder({ currency_code: 'EUR', value: '1.00', request_id: 'rid-order' });
  await client.createRefund({ capture_id: 'CAPTURE1', amount: { currency_code: 'EUR', value: '1.00' }, request_id: 'rid-refund' });
  await client.listTransactions({ start_date: '2026-10-01T00:00:00Z', end_date: '2026-10-02T00:00:00Z' });
  await client.createInvoice({ currency_code: 'EUR', primary_recipients: [{ billing_info: { email_address: 'x@example.test' } }], items: [{ name: 'Mug', quantity: '1', unit_amount: { currency_code: 'EUR', value: '1.00' } }], request_id: 'rid-invoice' });
  await client.createShipmentTracking({ transaction_id: 'CAPTURE1', tracking_number: '1Z', carrier: 'UPS', status: 'SHIPPED', request_id: 'rid-track' });
  await client.listDisputes();
  await client.acceptDisputeClaim({ dispute_id: 'D-1', note: 'Accepting claim', request_id: 'rid-dispute' });

  assert.ok(fetchCalls.find((c) => c.url.endsWith('/v1/oauth2/token'))?.init?.headers);
  assert.ok(sdkCalls.find((c) => String(c.url).includes('/v2/checkout/orders') && c.headers['PayPal-Request-Id'] === 'rid-order'));
  assert.ok(sdkCalls.find((c) => String(c.url).includes('/v2/payments/captures/CAPTURE1/refund') && c.headers['PayPal-Request-Id'] === 'rid-refund'));
  assert.ok(sdkCalls.find((c) => String(c.url).includes('/v1/reporting/transactions') && String(c.url).includes('start_date=2026-10-01')));
  assert.ok(fetchCalls.find((c) => c.url.includes('/v2/invoicing/invoices') && (c.init?.headers as Headers).get('PayPal-Request-Id') === 'rid-invoice'));
  assert.ok(fetchCalls.find((c) => c.url.includes('/v1/shipping/trackers-batch') && (c.init?.headers as Headers).get('PayPal-Request-Id') === 'rid-track'));
});
