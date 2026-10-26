import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSeedArgs, runSandboxSeed, SandboxRest, SEED_CAPTURES, SEED_INVOICE, SEED_REFUND, seedTag } from '../src/sandboxSeed.js';

const RUN = 'T3STAB';
const TAGS = SEED_CAPTURES.map((s) => seedTag(RUN, s.key));
const INVOICE_TAG = seedTag(RUN, SEED_INVOICE.key);
import { parseSeedCustomId } from '../src/paypal/seedTags.js';

// Offline: a local HTTP stub plays api-m.sandbox.paypal.com. The real run is `npm run sandbox:seed` with credentials.
const FAKE_ID = 'FAKEseedClientIdOnlyForTests789';
const FAKE_SECRET = 'FAKEseedSecretOnlyForTests012';

type Hit = { method: string; path: string; headers: IncomingMessage['headers']; body: any };
type StubOptions = { cardEnabled?: boolean; duplicateInvoiceIds?: Set<string> };

async function startStub(options: StubOptions = {}) {
  const hits: Hit[] = [];
  const orders = new Map<string, any>();
  const invoices = new Map<string, any>();
  const usedInvoiceIds = new Set<string>(options.duplicateInvoiceIds || []);
  let seq = 0;
  const send = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'paypal-debug-id': `dbg-${status}` }); res.end(body === undefined ? '' : JSON.stringify(body)); };
  const unprocessable = (res: ServerResponse, issue: string) => send(res, 422, { name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', debug_id: `dbg-${issue}`, details: [{ issue }] });
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://stub');
      let body: any = raw;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { /* form body */ }
      hits.push({ method: req.method || '', path: url.pathname + url.search, headers: req.headers, body });
      const auth = String(req.headers.authorization || '');
      if (url.pathname === '/v1/oauth2/token') {
        const expected = `Basic ${Buffer.from(`${FAKE_ID}:${FAKE_SECRET}`).toString('base64')}`;
        return auth === expected ? send(res, 200, { access_token: 'stub-access-token', token_type: 'Bearer', expires_in: 32400 }) : send(res, 401, { error: 'invalid_client', error_description: 'Client Authentication failed' });
      }
      if (auth !== 'Bearer stub-access-token') return send(res, 401, { name: 'AUTHENTICATION_FAILURE', message: 'bad token' });
      if (req.method === 'POST' && url.pathname === '/v2/checkout/orders') {
        if (!req.headers['paypal-request-id']) return send(res, 400, { name: 'INVALID_REQUEST', message: 'PayPal-Request-Id required' });
        const unit = body.purchase_units[0];
        if (usedInvoiceIds.has(unit.invoice_id)) return unprocessable(res, 'DUPLICATE_INVOICE_ID');
        const id = `ORDER-${++seq}`;
        if (body.payment_source.card) {
          if (!options.cardEnabled) return unprocessable(res, 'PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING');
          usedInvoiceIds.add(unit.invoice_id);
          const order = { id, status: 'COMPLETED', purchase_units: [{ ...unit, payments: { captures: [{ id: `CAP-${seq}`, status: 'COMPLETED', amount: unit.amount }] } }], links: [] };
          orders.set(id, order);
          return send(res, 201, order);
        }
        usedInvoiceIds.add(unit.invoice_id);
        const order = { id, status: 'PAYER_ACTION_REQUIRED', purchase_units: [unit], links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
        orders.set(id, order);
        return send(res, 200, order);
      }
      const orderMatch = url.pathname.match(/^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/);
      if (orderMatch) {
        const order = orders.get(orderMatch[1]);
        if (!order) return send(res, 404, { name: 'RESOURCE_NOT_FOUND', message: 'order' });
        if (orderMatch[2]) {
          if (order.status !== 'APPROVED') return unprocessable(res, 'ORDER_NOT_APPROVED');
          order.status = 'COMPLETED';
          order.purchase_units[0].payments = { captures: [{ id: `CAP-${order.id}`, status: 'COMPLETED', amount: order.purchase_units[0].amount }] };
          return send(res, 201, order);
        }
        return send(res, 200, order);
      }
      if (req.method === 'POST' && url.pathname === '/v2/invoicing/search-invoices') {
        return send(res, 200, { items: [...invoices.values()].filter((inv) => inv.detail.invoice_number === body.invoice_number) });
      }
      if (req.method === 'POST' && url.pathname === '/v2/invoicing/invoices') {
        const id = `INV2-STUB-${++seq}`;
        const invoice = { id, status: 'DRAFT', ...body };
        invoices.set(id, invoice);
        return send(res, 201, invoice);
      }
      const invoiceMatch = url.pathname.match(/^\/v2\/invoicing\/invoices\/([^/]+)(\/send)?$/);
      if (invoiceMatch) {
        const invoice = invoices.get(invoiceMatch[1]);
        if (!invoice) return send(res, 404, { name: 'RESOURCE_NOT_FOUND', message: 'invoice' });
        if (invoiceMatch[2]) { invoice.status = body.send_to_recipient === false ? 'UNPAID' : 'SENT'; return send(res, 200, { href: `/v2/invoicing/invoices/${invoice.id}` }); }
        return send(res, 200, invoice);
      }
      const refundMatch = url.pathname.match(/^\/v2\/payments\/captures\/([^/]+)\/refund$/);
      if (req.method === 'POST' && refundMatch) {
        if (!req.headers['paypal-request-id']) return send(res, 400, { name: 'INVALID_REQUEST', message: 'PayPal-Request-Id required' });
        return send(res, 201, { id: `REF-${++seq}`, status: 'COMPLETED', amount: body.amount, custom_id: body.custom_id });
      }
      return send(res, 404, { name: 'NOT_STUBBED', message: `${req.method} ${url.pathname}` });
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  const address = server.address() as { port: number };
  return { baseUrl: `http://127.0.0.1:${address.port}`, hits, orders, invoices, close: () => new Promise<void>((done) => server.close(() => done())) };
}

function workspace(withCreds = true) {
  const dir = mkdtempSync(join(tmpdir(), 'tw-seed-'));
  const credentialsPath = join(dir, 'paypal-sandbox.env');
  if (withCreds) writeFileSync(credentialsPath, `PAYPAL_CLIENT_ID=${FAKE_ID}\nPAYPAL_CLIENT_SECRET=${FAKE_SECRET}\n`);
  return { dir, credentialsPath, manifestPath: join(dir, 'paypal-sandbox-seed.json'), evidencePath: join(dir, 'evidence.json') };
}

function assertNoSecrets(text: string) {
  assert.equal(text.includes(FAKE_ID), false, 'client id leaked');
  assert.equal(text.includes(FAKE_SECRET), false, 'client secret leaked');
  assert.equal(text.includes('stub-access-token'), false, 'access token leaked');
}

test('sandbox seed without credentials exits 2 with NO CREDENTIALS and makes no network call', async () => {
  const stub = await startStub({ cardEnabled: true });
  const ws = workspace(false);
  let fetched = 0;
  const lines: string[] = [];
  try {
    const result = await runSandboxSeed({ credentialsPath: ws.credentialsPath, manifestPath: ws.manifestPath, baseUrl: stub.baseUrl, allowLoopbackForTests: true, runTag: RUN, fetchImpl: async (...args) => { fetched += 1; return fetch(...args); }, log: (l) => lines.push(l) });
    assert.equal(result.exitCode, 2);
    assert.equal(fetched, 0);
    assert.equal(stub.hits.length, 0);
    assert.match(lines[0], /^PayPal sandbox seed: NO CREDENTIALS/);
    assert.ok(lines.some((l) => l.includes('npm run sandbox:seed')));
  } finally { await stub.close(); }
});

test('sandbox:seed CLI exits 2 with NO CREDENTIALS when the creds file is missing', () => {
  const home = mkdtempSync(join(tmpdir(), 'tw-seed-home-'));
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sandboxSeed.js');
  const run = spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stdout, /PayPal sandbox seed: NO CREDENTIALS/);
});

test('sandbox seed creates 3 tagged card captures + 1 sent invoice, is idempotent on rerun, and never prints secrets', async () => {
  const stub = await startStub({ cardEnabled: true });
  const ws = workspace();
  const lines: string[] = [];
  try {
    const first = await runSandboxSeed({ credentialsPath: ws.credentialsPath, manifestPath: ws.manifestPath, evidencePath: ws.evidencePath, baseUrl: stub.baseUrl, allowLoopbackForTests: true, runTag: RUN, log: (l) => lines.push(l), now: () => new Date('2026-10-26T09:00:00Z') });
    assert.equal(first.exitCode, 0, lines.join('\n'));
    const creates = stub.hits.filter((h) => h.method === 'POST' && h.path === '/v2/checkout/orders');
    assert.equal(creates.length, 3);
    for (const [i, hit] of creates.entries()) {
      const spec = { ...SEED_CAPTURES[i], tag: TAGS[i] };
      assert.equal(hit.body.intent, 'CAPTURE');
      assert.equal(hit.body.purchase_units[0].invoice_id, spec.tag);
      assert.deepEqual(parseSeedCustomId(hit.body.purchase_units[0].custom_id), { segment: spec.segment, customer: spec.customer, product: spec.product });
      assert.equal(hit.body.purchase_units[0].amount.value, spec.value);
      assert.equal(hit.body.payment_source.card.number, '4012000033330026');
      assert.match(String(hit.headers['paypal-request-id']), new RegExp(`^tillwise-seed-[0-9a-f]{10}-${spec.tag}-card$`));
      assert.equal(hit.headers.prefer, 'return=representation');
    }
    const invoiceCreate = stub.hits.find((h) => h.method === 'POST' && h.path === '/v2/invoicing/invoices');
    assert.equal(invoiceCreate?.body.detail.invoice_number, INVOICE_TAG);
    assert.match(invoiceCreate?.body.primary_recipients[0].billing_info.email_address, /@example\.com$/);
    const refundHit = stub.hits.find((h) => h.method === 'POST' && h.path.endsWith('/refund'));
    assert.equal(refundHit?.path, `/v2/payments/captures/CAP-1/refund`, 'the partial refund goes to CAP-01');
    assert.deepEqual(refundHit?.body.amount, { currency_code: 'EUR', value: SEED_REFUND.value });
    assert.equal(refundHit?.body.custom_id, seedTag(RUN, SEED_REFUND.key));
    const sendHit = stub.hits.find((h) => h.path.endsWith('/send'));
    assert.deepEqual(sendHit?.body, { send_to_recipient: false, send_to_invoicer: false });
    const manifest = JSON.parse(readFileSync(ws.manifestPath, 'utf8'));
    assert.deepEqual(Object.keys(manifest.captures), TAGS);
    assert.equal(manifest.run_tag, RUN);
    assert.equal(manifest.refunds[seedTag(RUN, SEED_REFUND.key)].status, 'COMPLETED');
    assert.ok(Object.values(manifest.captures).every((c: any) => c.capture_status === 'COMPLETED' && /^CAP-/.test(c.capture_id)));
    assert.equal(manifest.invoices[INVOICE_TAG].status, 'UNPAID');

    const before = stub.hits.length;
    const second = await runSandboxSeed({ credentialsPath: ws.credentialsPath, manifestPath: ws.manifestPath, baseUrl: stub.baseUrl, allowLoopbackForTests: true, runTag: RUN, log: (l) => lines.push(l) });
    assert.equal(second.exitCode, 0);
    const rerunHits = stub.hits.slice(before);
    assert.equal(rerunHits.filter((h) => h.method === 'POST' && (h.path === '/v2/checkout/orders' || h.path === '/v2/invoicing/invoices' || h.path.endsWith('/send') || h.path.endsWith('/capture') || h.path.endsWith('/refund'))).length, 0, 'rerun must not create, send, capture or refund anything');
    assert.equal(stub.orders.size, 3);
    assert.equal(stub.invoices.size, 1);
    assert.ok(second.steps.filter((s) => s.step.startsWith('capture')).every((s) => s.detail.startsWith('already captured')));
    assert.match(second.steps.find((s) => s.step.startsWith('invoice'))!.detail, /^already exists/);

    assertNoSecrets(lines.join('\n') + readFileSync(ws.manifestPath, 'utf8') + readFileSync(ws.evidencePath, 'utf8'));
  } finally { await stub.close(); }
});

test('sandbox seed without a manifest treats DUPLICATE_INVOICE_ID as "already exists", not as a failure', async () => {
  const stub = await startStub({ cardEnabled: true, duplicateInvoiceIds: new Set(TAGS) });
  const ws = workspace();
  const lines: string[] = [];
  try {
    const result = await runSandboxSeed({ credentialsPath: ws.credentialsPath, manifestPath: ws.manifestPath, baseUrl: stub.baseUrl, allowLoopbackForTests: true, runTag: RUN, log: (l) => lines.push(l) });
    assert.equal(result.exitCode, 0, lines.join('\n'));
    assert.equal(stub.orders.size, 0);
    assert.equal(result.steps.filter((s) => /DUPLICATE_INVOICE_ID/.test(s.detail)).length, 3);
  } finally { await stub.close(); }
});

test('sandbox seed falls back to buyer approval when card processing is not enabled, then captures on rerun', async () => {
  const stub = await startStub({ cardEnabled: false });
  const ws = workspace();
  const lines: string[] = [];
  try {
    const first = await runSandboxSeed({ credentialsPath: ws.credentialsPath, manifestPath: ws.manifestPath, baseUrl: stub.baseUrl, allowLoopbackForTests: true, runTag: RUN, log: (l) => lines.push(l) });
    assert.equal(first.exitCode, 0, lines.join('\n'));
    assert.equal(first.steps.filter((s) => s.pending).length, 4, '3 captures wait for approval, so the refund on CAP-01 waits too');
    assert.ok(lines.some((l) => l.includes('PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING')));
    assert.ok(lines.some((l) => l.includes('https://www.sandbox.paypal.com/checkoutnow?token=')));
    assert.match(lines.at(-2)!, /4 waiting for sandbox buyer approval/);
    // The judge approves the orders as the sandbox personal account; simulate that on the stub.
    for (const order of stub.orders.values()) order.status = 'APPROVED';
    const second = await runSandboxSeed({ credentialsPath: ws.credentialsPath, manifestPath: ws.manifestPath, baseUrl: stub.baseUrl, allowLoopbackForTests: true, runTag: RUN, log: (l) => lines.push(l) });
    assert.equal(second.exitCode, 0);
    assert.equal(stub.hits.filter((h) => h.path.endsWith('/capture')).length, 3);
    assert.ok(stub.hits.filter((h) => h.path.endsWith('/capture')).every((h) => /-capture$/.test(String(h.headers['paypal-request-id']))));
    const manifest = JSON.parse(readFileSync(ws.manifestPath, 'utf8'));
    assert.ok(Object.values(manifest.captures).every((c: any) => c.capture_status === 'COMPLETED'));
    assertNoSecrets(lines.join('\n'));
  } finally { await stub.close(); }
});

test('sandbox seed --link-woo creates a capture for the exact order total and links it through the audited ability', async () => {
  const stub = await startStub({ cardEnabled: true });
  const ws = workspace();
  const wpCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  const wp = { async run(name: string, input: Record<string, unknown> = {}) {
    wpCalls.push({ name, input });
    if (name === 'paypal-order-context') return { speech: '', data: { order: { id: input.order_id, total: 39, currency: 'EUR', items: [{ name: 'Soy Candle Trio', quantity: 1, total: 39 }] }, paypal: { paypal_capture_id: 'MOCKCAPTURE136' } } };
    if (name === 'paypal-audit-record') return { speech: 'PayPal audit recorded.', data: { count: 1 } };
    throw new Error(`unexpected ability ${name}`);
  } };
  const lines: string[] = [];
  try {
    const result = await runSandboxSeed({ credentialsPath: ws.credentialsPath, manifestPath: ws.manifestPath, baseUrl: stub.baseUrl, allowLoopbackForTests: true, runTag: RUN, linkWoo: [136], wp, log: (l) => lines.push(l) });
    assert.equal(result.exitCode, 0, lines.join('\n'));
    const wooCreate = stub.hits.find((h) => h.method === 'POST' && h.path === '/v2/checkout/orders' && h.body.purchase_units[0].invoice_id === 'TW-DEMO-T3STAB-WOO-136-3900');
    assert.equal(wooCreate?.body.purchase_units[0].amount.value, '39.00');
    const audit = wpCalls.find((c) => c.name === 'paypal-audit-record');
    const manifest = JSON.parse(readFileSync(ws.manifestPath, 'utf8'));
    const entry = manifest.captures['TW-DEMO-T3STAB-WOO-136-3900'];
    assert.equal(audit?.input.tool, 'paypal_sandbox_seed');
    assert.equal(audit?.input.woo_order_id, 136);
    assert.equal(audit?.input.paypal_capture_id, entry.capture_id);
    assert.equal(entry.linked, true);
  } finally { await stub.close(); }
});

test('sandbox seed refuses non-sandbox hosts and parses its arguments strictly', () => {
  assert.throws(() => new SandboxRest({ clientId: 'a', clientSecret: 'b', baseUrl: 'https://api-m.paypal.com' }), /only talks to https:\/\/api-m\.sandbox\.paypal\.com/);
  assert.throws(() => new SandboxRest({ clientId: 'a', clientSecret: 'b', baseUrl: 'http://127.0.0.1:9' }), /refusing/);
  assert.deepEqual(parseSeedArgs(['--link-woo', '136,137', '--currency=USD']), { linkWoo: [136, 137], currency: 'USD' });
  assert.throws(() => parseSeedArgs(['--link-woo', 'abc']), /expects Woo order ids/);
});

test('sandbox seed gives every install its own run tag, so the shared public sandbox app never sees our tags twice', async () => {
  const stub = await startStub({ cardEnabled: true });
  const a = workspace(); const b = workspace();
  try {
    await runSandboxSeed({ credentialsPath: a.credentialsPath, manifestPath: a.manifestPath, baseUrl: stub.baseUrl, allowLoopbackForTests: true, log: () => {} });
    await runSandboxSeed({ credentialsPath: b.credentialsPath, manifestPath: b.manifestPath, baseUrl: stub.baseUrl, allowLoopbackForTests: true, log: () => {} });
    const runA = JSON.parse(readFileSync(a.manifestPath, 'utf8')).run_tag; const runB = JSON.parse(readFileSync(b.manifestPath, 'utf8')).run_tag;
    assert.match(runA, /^[A-Z2-9]{6}$/); assert.notEqual(runA, runB);
    const tags = stub.hits.filter((h) => h.method === 'POST' && h.path === '/v2/checkout/orders').map((h) => h.body.purchase_units[0].invoice_id);
    assert.equal(tags.length, 6); assert.equal(new Set(tags).size, 6);
    assert.ok(tags.every((t: string) => /^TW-DEMO-[A-Z2-9]{6}-CAP-0[123]$/.test(t)));
    assert.ok(seedTag(runA, SEED_INVOICE.key).length <= 25, 'invoice_number max length is 25');
  } finally { await stub.close(); }
});
