import test from 'node:test';
import assert from 'node:assert/strict';
import { MockPayPalClient } from '../src/paypal/mockClient.js';
import { PayPalService } from '../src/paypal/service.js';
import { LivePayPalClient } from '../src/paypal/liveClient.js';
import { PayPalApiError, type PayPalClient } from '../src/paypal/types.js';

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

const paypalFailure = new PayPalApiError({ name: 'UNPROCESSABLE_ENTITY', message: 'fixture failure', debug_id: 'DBG-FAIL', details: [{ issue: 'FIXTURE', description: 'forced failure' }] }, 422);
class FailingPayPalClient extends MockPayPalClient {
  constructor(private readonly failMethod: string) { super(); }
  override async createInvoice(input: never) { if (this.failMethod === 'createInvoice') throw paypalFailure; return super.createInvoice(input); }
  override async sendInvoice(input: never) { if (this.failMethod === 'sendInvoice') throw paypalFailure; return super.sendInvoice(input); }
  override async createShipmentTracking(input: never) { if (this.failMethod === 'tracking') throw paypalFailure; return super.createShipmentTracking(input); }
  override async acceptDisputeClaim(input: never) { if (this.failMethod === 'acceptDispute') throw paypalFailure; return super.acceptDisputeClaim(input); }
}

function headerValue(headers: unknown, name: string): string | null {
  if (headers instanceof Headers) return headers.get(name);
  const record = headers as Record<string, string | undefined> | undefined;
  if (!record) return null;
  const found = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
  return found ? String(record[found]) : null;
}

test('mock refund preview/apply enforces cap, distinct request ids, ttl, single use, and audit', async () => {
  const wp = fakeWp();
  let now = 1_000;
  const service = new PayPalService(wp, new MockPayPalClient(), { previewTtlMs: 100, now: () => now });
  const preview1 = await service.refundPreview({ order_id: 123, amount: 5, note_to_payer: 'Partial refund' });
  const preview2 = await service.refundPreview({ order_id: 123, amount: 5, note_to_payer: 'Partial refund' });
  assert.match(String(preview1.data.preview_id), /^ppv_[0-9a-f-]{36}$/);
  assert.notEqual(preview1.data.preview_id, preview2.data.preview_id);
  assert.equal(preview1.data.preview_hash, preview2.data.preview_hash);
  const applied1 = await service.refundApply({ preview_id: String(preview1.data.preview_id) });
  const applied2 = await service.refundApply({ preview_id: String(preview2.data.preview_id) });
  assert.notEqual(applied1.data.request_id, applied2.data.request_id);
  assert.notEqual((applied1.data.refund as { id: string }).id, (applied2.data.refund as { id: string }).id);
  assert.equal(wp.audits.length, 2);
  await assert.rejects(() => service.refundApply({ preview_id: String(preview1.data.preview_id) }), /Preview id was not found/);
  const expiring = await service.refundPreview({ order_id: 123, amount: 5 });
  now += 101;
  await assert.rejects(() => service.refundApply({ preview_id: String(expiring.data.preview_id) }), /Preview expired/);
  await assert.rejects(() => service.refundPreview({ order_id: 123, amount: 101 }), /Refund cap/);
});

test('mock invoice, tracking, dispute preview/apply, and briefing return deterministic shapes', async () => {
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
  assert.equal((disputes.data.disputes as unknown[]).length, 3);
  const disputePreview = await service.disputeAcceptClaimPreview({ dispute_id: 'PP-D-MOCK-1', note: 'Accept claim' });
  assert.equal(disputePreview.data.amount, '18.00');
  const accepted = await service.disputeAcceptClaimApply({ preview_id: String(disputePreview.data.preview_id) });
  assert.equal((accepted.data.result as { status: string }).status, 'RESOLVED');
  const briefing = await service.moneyBriefing();
  assert.equal((briefing.data.counts as { disputes: number }).disputes, 3);
});

test('dispute accept preview refuses over cap', async () => {
  const client = new MockPayPalClient();
  client.getDispute = async () => ({ dispute_id: 'D-HIGH', status: 'WAITING_FOR_SELLER_RESPONSE', reason: 'NOT_AS_DESCRIBED', dispute_amount: { currency_code: 'EUR', value: '101.00' } });
  const service = new PayPalService(fakeWp(), client);
  await assert.rejects(() => service.disputeAcceptClaimPreview({ dispute_id: 'D-HIGH' }), /Dispute accept cap/);
});

test('mutation failures audit FAILED rows with PayPal debug ids', async () => {
  for (const [method, run] of [
    ['createInvoice', async (service: PayPalService) => { const p = await service.invoicePreview({ recipient_email: 'buyer@example.test', items: [{ name: 'Mug', quantity: 1, unit_amount: 10 }] }); await service.invoiceCreateApply({ preview_id: String(p.data.preview_id) }); }],
    ['sendInvoice', async (service: PayPalService) => { await service.invoiceSendApply({ invoice_id: 'INV2-FAIL' }); }],
    ['tracking', async (service: PayPalService) => { await service.trackingAddApply({ order_id: 123, tracking_number: '1Z', carrier: 'UPS' }); }],
    ['acceptDispute', async (service: PayPalService) => { const p = await service.disputeAcceptClaimPreview({ dispute_id: 'PP-D-MOCK-1' }); await service.disputeAcceptClaimApply({ preview_id: String(p.data.preview_id) }); }],
  ] as const) {
    const wp = fakeWp();
    const service = new PayPalService(wp, new FailingPayPalClient(method));
    await assert.rejects(() => run(service), /UNPROCESSABLE_ENTITY/);
    assert.equal(wp.audits.at(-1)?.status, 'FAILED', method);
    assert.equal(wp.audits.at(-1)?.debug_id, 'DBG-FAIL', method);
  }
});

test('live client hard-refuses non-sandbox hosts and exposes sandbox mode', () => {
  assert.equal(new LivePayPalClient({ clientId: 'id', clientSecret: 'secret' }).mode, 'sandbox');
  assert.throws(() => new LivePayPalClient({ clientId: 'id', clientSecret: 'secret', baseUrl: 'https://api-m.paypal.com' }), /only supports the PayPal sandbox host/);
});

test('live client contract sends cached bearer token and required headers on SDK and fetch calls', async () => {
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
    if (url.includes('/v1/reporting/transactions')) return { data: JSON.stringify({ transaction_details: [{ transaction_info: { transaction_id: 'T1', transaction_event_code: 'T0006', transaction_status: 'S', transaction_amount: { currency_code: 'EUR', value: '24.00' }, transaction_updated_date: '2026-10-01T10:00:00+0000', invoice_id: 'TW-DEMO-CAP-01', custom_field: 'tillwise-demo;seg=Retail;cust=Aoife Byrne;prod=Stoneware Mug Set' } }] }), status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, config };
    throw new Error(`Unexpected sdk ${config.method} ${url}`);
  };
  const client = new LivePayPalClient({ clientId: 'id', clientSecret: 'secret', fetchImpl, sdkAdapter });
  await client.createOrder({ currency_code: 'EUR', value: '1.00', request_id: 'rid-order' });
  await client.createRefund({ capture_id: 'CAPTURE1', amount: { currency_code: 'EUR', value: '1.00' }, request_id: 'rid-refund' });
  const transactions = await client.listTransactions({ start_date: '2026-10-01T00:00:00Z', end_date: '2026-10-02T00:00:00Z' });
  // The SDK deserialises to camelCase models; the client must hand back PayPal's snake_case wire names.
  assert.deepEqual(transactions[0].transaction_info, { transaction_id: 'T1', transaction_event_code: 'T0006', transaction_status: 'S', transaction_amount: { currency_code: 'EUR', value: '24.00' }, transaction_updated_date: '2026-10-01T10:00:00+0000', transaction_initiation_date: undefined, paypal_reference_id: undefined, invoice_id: 'TW-DEMO-CAP-01', custom_field: 'tillwise-demo;seg=Retail;cust=Aoife Byrne;prod=Stoneware Mug Set' });
  await client.createInvoice({ currency_code: 'EUR', primary_recipients: [{ billing_info: { email_address: 'x@example.test' } }], items: [{ name: 'Mug', quantity: '1', unit_amount: { currency_code: 'EUR', value: '1.00' } }], request_id: 'rid-invoice' });
  await client.createShipmentTracking({ transaction_id: 'CAPTURE1', tracking_number: '1Z', carrier: 'UPS', status: 'SHIPPED', request_id: 'rid-track' });
  await client.listDisputes();
  await client.acceptDisputeClaim({ dispute_id: 'D-1', note: 'Accepting claim', request_id: 'rid-dispute' });

  assert.equal(fetchCalls.filter((c) => c.url.endsWith('/v1/oauth2/token')).length, 1);
  const nonTokenFetch = fetchCalls.filter((c) => !c.url.endsWith('/v1/oauth2/token'));
  for (const call of nonTokenFetch) assert.equal(headerValue(call.init?.headers, 'authorization'), 'Bearer stub-token', call.url);
  for (const call of sdkCalls) assert.equal(headerValue(call.headers, 'authorization'), 'Bearer stub-token', call.url);
  assert.ok(sdkCalls.find((c) => String(c.url).includes('/v2/checkout/orders') && c.headers['PayPal-Request-Id'] === 'rid-order' && headerValue(c.headers, 'Prefer') === 'return=representation'));
  assert.ok(sdkCalls.find((c) => String(c.url).includes('/v2/payments/captures/CAPTURE1/refund') && c.headers['PayPal-Request-Id'] === 'rid-refund' && headerValue(c.headers, 'Prefer') === 'return=representation'));
  assert.ok(sdkCalls.find((c) => String(c.url).includes('/v1/reporting/transactions') && String(c.url).includes('start_date=2026-10-01')));
  const invoice = fetchCalls.find((c) => c.url.includes('/v2/invoicing/invoices') && !c.url.includes('/send'));
  assert.equal(headerValue(invoice?.init?.headers, 'PayPal-Request-Id'), 'rid-invoice');
  assert.equal(headerValue(invoice?.init?.headers, 'content-type'), 'application/json');
  assert.equal(headerValue(invoice?.init?.headers, 'Prefer'), 'return=representation');
  const tracking = fetchCalls.find((c) => c.url.includes('/v1/shipping/trackers-batch'));
  assert.equal(headerValue(tracking?.init?.headers, 'PayPal-Request-Id'), 'rid-track');
  assert.equal(headerValue(tracking?.init?.headers, 'content-type'), 'application/json');
  const accept = fetchCalls.find((c) => c.url.includes('/v1/customer/disputes/D-1/accept-claim'));
  assert.equal(accept?.init?.method, 'POST');
  assert.equal(headerValue(accept?.init?.headers, 'PayPal-Request-Id'), 'rid-dispute');
  assert.equal(headerValue(accept?.init?.headers, 'content-type'), 'application/json');
});

async function retryCase(status: number) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: `token-${calls.filter((c) => c.endsWith('/v1/oauth2/token')).length}`, expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (calls.filter((c) => c.includes('/v2/invoicing/invoices')).length === 1) return new Response(JSON.stringify({ name: 'RETRY_ME', message: 'retry', debug_id: `DBG-${status}` }), { status, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ id: `INV-${status}`, status: 'DRAFT' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const client = new LivePayPalClient({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const invoice = await client.createInvoice({ currency_code: 'EUR', primary_recipients: [{ billing_info: { email_address: 'x@example.test' } }], items: [{ name: 'Mug' }], request_id: `rid-${status}` });
  return { calls, invoice };
}

test('live fetch path retries 401 with token refresh, 429, and 5xx', async () => {
  const r401 = await retryCase(401);
  assert.equal(r401.invoice.id, 'INV-401');
  assert.equal(r401.calls.filter((c) => c.endsWith('/v1/oauth2/token')).length, 2);
  const r429 = await retryCase(429);
  assert.equal(r429.invoice.id, 'INV-429');
  assert.equal(r429.calls.filter((c) => c.endsWith('/v1/oauth2/token')).length, 1);
  const r500 = await retryCase(500);
  assert.equal(r500.invoice.id, 'INV-500');
  assert.equal(r500.calls.filter((c) => c.endsWith('/v1/oauth2/token')).length, 1);
});

test('live client parses PayPal error envelopes on fetch and SDK paths', async () => {
  const fetchClient = new LivePayPalClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: async (url) => {
    if (String(url).endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'stub-token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ name: 'FETCH_FAIL', message: 'fetch failed', debug_id: 'DBG-FETCH', details: [{ issue: 'BAD_FETCH' }] }), { status: 422, headers: { 'content-type': 'application/json' } });
  } });
  await assert.rejects(() => fetchClient.getDispute('D-ERR'), (err) => err instanceof PayPalApiError && err.envelope.name === 'FETCH_FAIL' && err.envelope.debug_id === 'DBG-FETCH' && err.envelope.details?.[0].issue === 'BAD_FETCH');

  const sdkClient = new LivePayPalClient({ clientId: 'id', clientSecret: 'secret', fetchImpl: async () => new Response(JSON.stringify({ access_token: 'stub-token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } }), sdkAdapter: async () => { throw { statusCode: 422, body: JSON.stringify({ name: 'SDK_FAIL', message: 'sdk failed', debug_id: 'DBG-SDK', details: [{ issue: 'BAD_SDK' }] }) }; } });
  await assert.rejects(() => sdkClient.createRefund({ capture_id: 'CAPTURE1', amount: { currency_code: 'EUR', value: '1.00' }, request_id: 'rid-sdk-fail' }), (err) => err instanceof PayPalApiError && err.envelope.name === 'SDK_FAIL' && err.envelope.debug_id === 'DBG-SDK' && err.envelope.details?.[0].issue === 'BAD_SDK');
});


test('sandbox ledger: 31-day Transaction Search chunks, seed tags -> segment/customer/product, refunds joined to captures, invoices mapped', async () => {
  const now = Date.parse('2026-10-26T12:00:00Z');
  const searches: Array<{ start: string; end: string }> = [];
  const client = new MockPayPalClient() as unknown as PayPalClient & Record<string, unknown>;
  delete (client as { ledger?: unknown }).ledger;
  Object.assign(client, {
    mode: 'sandbox',
    ledger: undefined,
    async listTransactions(input: { start_date: string; end_date: string }) {
      searches.push({ start: input.start_date, end: input.end_date });
      if (searches.length > 1) return [];
      return [
        { transaction_info: { transaction_id: 'CAP-1', transaction_event_code: 'T0006', transaction_status: 'S', transaction_amount: { currency_code: 'EUR', value: '24.00' }, transaction_updated_date: '2026-10-25T10:00:00+0000', custom_field: 'tillwise-demo;seg=Retail;cust=Aoife Byrne;prod=Stoneware Mug Set' } },
        { transaction_info: { transaction_id: 'CAP-2', transaction_event_code: 'T0005', transaction_status: 'S', transaction_amount: { currency_code: 'EUR', value: '64.50' }, transaction_updated_date: '2026-10-25T11:00:00+0000' } },
        { transaction_info: { transaction_id: 'RF-1', transaction_event_code: 'T1107', transaction_status: 'S', transaction_amount: { currency_code: 'EUR', value: '-24.00' }, transaction_updated_date: '2026-10-26T09:00:00+0000', paypal_reference_id: 'CAP-1' } },
        { transaction_info: { transaction_id: 'HOLD-1', transaction_event_code: 'T1110', transaction_amount: { currency_code: 'EUR', value: '-5.00' }, transaction_updated_date: '2026-10-26T09:00:00+0000' } },
      ];
    },
    async listDisputes() { return []; },
    async listInvoices() { return [{ id: 'INV2-1', status: 'UNPAID', detail: { invoice_number: 'TW-DEMO-INV-01', invoice_date: '2026-10-01', payment_term: { due_date: '2026-10-15' } }, primary_recipients: [{ billing_info: { business_name: 'Galway Gift House', email_address: 'orders@galwaygift.example.test' } }], amount: { currency_code: 'EUR', value: '180.00' }, due_amount: { currency_code: 'EUR', value: '180.00' } }]; },
  });
  const service = new PayPalService(fakeWp(), client, { now: () => now });
  const ledger = (await service.ledgerExport({ days: 45 })).data as any;
  assert.equal(ledger.mode, 'sandbox');
  assert.equal(searches.length, 2);
  for (const range of searches) assert.ok(Date.parse(range.end) - Date.parse(range.start) <= 31 * 86400_000, JSON.stringify(range));
  assert.deepEqual(ledger.captures.map((c: any) => [c.capture_id, c.segment, c.customer, c.product, c.gross]), [['CAP-1', 'Retail', 'Aoife Byrne', 'Stoneware Mug Set', 24], ['CAP-2', 'Unknown', 'Unknown', 'Unknown', 64.5]]);
  assert.deepEqual(ledger.refunds.map((r: any) => [r.refund_id, r.capture_id, r.segment, r.product, r.amount]), [['RF-1', 'CAP-1', 'Retail', 'Stoneware Mug Set', 24]]);
  assert.deepEqual(ledger.invoices.map((i: any) => [i.invoice_number, i.customer, i.status, i.amount_due, i.days_overdue, i.overdue]), [['TW-DEMO-INV-01', 'Galway Gift House', 'UNPAID', 180, 11, true]]);
  assert.ok(ledger.notes.some((n: string) => n.startsWith('Live PayPal sandbox')));
});
