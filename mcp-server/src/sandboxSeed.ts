import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSandboxCredentials } from './paypal/liveClient.js';
import { SEED_TAG_PREFIX, seedCustomId } from './paypal/seedTags.js';
import { PayPalApiError, type LedgerSegment } from './paypal/types.js';
import { WpAbilityClient } from './wpClient.js';

/**
 * `npm run sandbox:seed`: creates the small amount of REAL PayPal sandbox data the judge demo needs.
 * It is idempotent and tagged, so reruns never duplicate. Sources are in docs/FACTS_PAYPAL_SANDBOX.md.
 *
 *   - 3 captured orders (Orders v2, intent CAPTURE, payment_source.card with a PayPal sandbox test card).
 *     Tag: purchase_units[0].invoice_id = TW-DEMO-CAP-0n. PayPal makes invoice_id unique per merchant by
 *     default, so a rerun cannot create a second copy. custom_id carries the segment/customer/product.
 *   - 1 invoice (Invoicing v2) TW-DEMO-INV-01. It is found again via search-invoices, then created and
 *     sent with send_to_recipient=false (the invoice becomes payable; PayPal emails nobody).
 *   - optional `--link-woo 136[,137]`: for each Woo order, one capture for exactly the order total
 *     (tag TW-DEMO-WOO-<id>-<cents>). It is linked to the order through the audited
 *     `paypal-audit-record` ability, so "Refund order 136" in the voice flow refunds a real sandbox
 *     capture.
 * If the sandbox business account cannot take card payments (PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING),
 * it falls back to buyer-approval orders: it prints each approve link; you approve as your sandbox
 * personal account and rerun this command, which then captures them.
 * A manifest of PayPal ids (no secrets) is kept at ~/.config/tillwise/paypal-sandbox-seed.json.
 * Exit codes: 0 ok (possibly with approvals pending), 1 a step failed, 2 no credentials (no network call made).
 */
export const SANDBOX_HOST = 'api-m.sandbox.paypal.com';
export const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.config', 'tillwise', 'paypal-sandbox.env');
export const DEFAULT_MANIFEST_PATH = join(homedir(), '.config', 'tillwise', 'paypal-sandbox-seed.json');
/** A PayPal sandbox test card ("Test card numbers", developer.paypal.com/tools/sandbox/card-testing). It is not a real card. */
export const SANDBOX_TEST_CARD = { number: '4012000033330026', expiry: '2030-12', security_code: '123', name: 'Tillwise Demo Buyer' } as const;
const CARD_NOT_AVAILABLE = new Set(['PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING', 'CARD_TYPE_NOT_SUPPORTED', 'CURRENCY_NOT_SUPPORTED_FOR_CARD_TYPE', 'PAYMENT_SOURCE_INFO_CANNOT_BE_VERIFIED', 'NOT_ENABLED_FOR_CARD_PROCESSING']);

export type SeedCaptureSpec = { tag: string; customer: string; segment: LedgerSegment; product: string; value: string };
export const SEED_CAPTURES: SeedCaptureSpec[] = [
  { tag: `${SEED_TAG_PREFIX}CAP-01`, customer: 'Aoife Byrne', segment: 'Retail', product: 'Stoneware Mug Set', value: '24.00' },
  { tag: `${SEED_TAG_PREFIX}CAP-02`, customer: 'Cork Office Co', segment: 'Wholesale', product: 'Desk Organiser', value: '64.50' },
  { tag: `${SEED_TAG_PREFIX}CAP-03`, customer: 'Mugs & Candles Club', segment: 'Subscription', product: 'Monthly Candle Box', value: '18.00' },
];
export const SEED_INVOICE = { tag: `${SEED_TAG_PREFIX}INV-01`, business_name: 'Galway Gift House', email: 'orders@galwaygift.example.test', item: 'Gift Hamper', quantity: '4', unit_value: '45.00' };

type Json = Record<string, any>;
export type SeedManifest = { host: string; currency: string; captures: Record<string, { order_id: string; status: string; capture_id?: string; capture_status?: string; amount: string; approve_url?: string; woo_order_id?: number; linked?: boolean }>; invoices: Record<string, { invoice_id: string; status: string }>; updated_at?: string };
export type SeedStep = { step: string; ok: boolean; detail: string; status?: number; debug_id?: string; pending?: boolean };
export type SeedResult = { exitCode: 0 | 1 | 2; host: string; steps: SeedStep[]; manifest?: SeedManifest; startedAt: string; finishedAt: string };

/** Minimal REST client for the seed: OAuth client-credentials plus JSON calls. Only the sandbox host is allowed, or loopback when a test asks for it. */
export class SandboxRest {
  private token?: { value: string; expiresAt: number };
  readonly baseUrl: string;
  constructor(private readonly opts: { clientId: string; clientSecret: string; baseUrl?: string; fetchImpl?: typeof fetch; allowLoopbackForTests?: boolean }) {
    this.baseUrl = (opts.baseUrl || `https://${SANDBOX_HOST}`).replace(/\/$/, '');
    const url = new URL(this.baseUrl);
    const loopback = opts.allowLoopbackForTests && url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
    if (!loopback && !(url.protocol === 'https:' && url.hostname === SANDBOX_HOST)) throw new Error(`sandbox:seed only talks to https://${SANDBOX_HOST}; refusing ${url.host}.`);
  }
  private get fetchImpl() { return this.opts.fetchImpl || fetch; }
  async accessToken(): Promise<{ expires_in_s: number }> {
    if (!this.token || this.token.expiresAt - Date.now() < 60_000) {
      const auth = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
      const response = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, { method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'grant_type=client_credentials' });
      const json = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
      if (!response.ok || !json.access_token) throw new PayPalApiError({ name: json.error ? String(json.error).toUpperCase() : 'OAUTH_ERROR', message: json.error_description || 'PayPal OAuth failed', debug_id: response.headers.get('paypal-debug-id') || 'oauth' }, response.status);
      this.token = { value: json.access_token, expiresAt: Date.now() + Math.max(60, Number(json.expires_in || 300)) * 1000 };
    }
    return { expires_in_s: Math.round((this.token.expiresAt - Date.now()) / 1000) };
  }
  async call<T = Json>(method: string, path: string, body?: unknown, extra: { requestId?: string; prefer?: string } = {}): Promise<{ status: number; json: T }> {
    await this.accessToken();
    const headers: Record<string, string> = { authorization: `Bearer ${this.token!.value}`, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (extra.requestId) headers['PayPal-Request-Id'] = extra.requestId;
    if (extra.prefer) headers.Prefer = extra.prefer;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json: Json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text.slice(0, 200) }; }
    if (!response.ok) {
      const issue = Array.isArray(json.details) && json.details[0]?.issue ? String(json.details[0].issue) : '';
      throw new PayPalApiError({ name: issue || String(json.name || 'PAYPAL_HTTP_ERROR'), message: String(json.message || response.statusText || 'PayPal API error') + (issue && json.name ? ` (${json.name})` : ''), debug_id: String(json.debug_id || response.headers.get('paypal-debug-id') || 'unknown'), details: json.details }, response.status);
    }
    return { status: response.status, json: json as T };
  }
}

function readWpEnv(env: Record<string, string | undefined>, envFile: string): { baseUrl: string; username: string; password: string } | null {
  const merged: Record<string, string | undefined> = {};
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (match) merged[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
  Object.assign(merged, Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith('WP_'))));
  return merged.WP_APPLICATION_PASSWORD ? { baseUrl: merged.WP_BASE_URL || 'http://127.0.0.1:8098', username: merged.WP_USERNAME || 'shopmanager', password: merged.WP_APPLICATION_PASSWORD } : null;
}

export async function runSandboxSeed(options: {
  credentialsPath?: string;
  manifestPath?: string;
  log?: (line: string) => void;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  allowLoopbackForTests?: boolean;
  currency?: string;
  linkWoo?: number[];
  wp?: Pick<WpAbilityClient, 'run'> | null;
  evidencePath?: string | null;
  now?: () => Date;
} = {}): Promise<SeedResult> {
  const log = options.log || ((line: string) => console.log(line));
  const now = options.now || (() => new Date());
  const startedAt = now().toISOString();
  const credentialsPath = options.credentialsPath || DEFAULT_CREDENTIALS_PATH;
  const creds = readSandboxCredentials(credentialsPath);
  if (!creds) {
    log(`PayPal sandbox seed: NO CREDENTIALS — ${credentialsPath.replace(homedir(), '~')} is missing or lacks PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.`);
    log('Nothing was called. Create a sandbox REST app at developer.paypal.com (Apps & Credentials → Sandbox), then run');
    log('  ./scripts/save-paypal-sandbox-creds.sh   # writes that file with mode 600, never echoes the secret');
    log('  cd mcp-server && npm run sandbox:seed');
    return { exitCode: 2, host: SANDBOX_HOST, steps: [], startedAt, finishedAt: now().toISOString() };
  }
  const secrets = [creds.clientId, creds.clientSecret].filter((value) => value.length >= 4);
  const redact = (text: string) => secrets.reduce((out, secret) => out.split(secret).join('<redacted>'), text);
  const api = new SandboxRest({ ...creds, baseUrl: options.baseUrl, fetchImpl: options.fetchImpl, allowLoopbackForTests: options.allowLoopbackForTests });
  const currency = options.currency || 'EUR';
  // Request ids are scoped to the app (a hash, never the id itself) so two judges' apps never share a key.
  const scope = createHash('sha256').update(creds.clientId).digest('hex').slice(0, 10);
  const requestId = (tag: string, what: string) => `tillwise-seed-${scope}-${tag}-${what}`;
  const manifestPath = options.manifestPath || DEFAULT_MANIFEST_PATH;
  let manifest: SeedManifest = { host: SANDBOX_HOST, currency, captures: {}, invoices: {} };
  if (existsSync(manifestPath)) {
    try { manifest = { ...manifest, ...JSON.parse(readFileSync(manifestPath, 'utf8')) as SeedManifest }; } catch { log(`  ! manifest ${manifestPath} is not valid JSON; starting a new one (PayPal's invoice_id/invoice_number tags still prevent duplicates).`); }
  }
  const saveManifest = () => {
    manifest.updated_at = now().toISOString();
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${redact(JSON.stringify(manifest, null, 2))}\n`);
    try { chmodSync(manifestPath, 0o600); } catch { /* best effort */ }
  };
  const steps: SeedStep[] = [];
  const record = (entry: SeedStep) => {
    entry.detail = redact(entry.detail);
    steps.push(entry);
    log(`  ${entry.ok ? (entry.pending ? '…' : '✔') : '✖'} ${entry.step}: ${entry.detail}${entry.status ? ` [HTTP ${entry.status}]` : ''}${entry.debug_id ? ` debug_id=${entry.debug_id}` : ''}`);
  };
  const fail = (step: string, error: unknown) => {
    const e = error as { message?: string; status?: number; envelope?: { debug_id?: string } };
    record({ step, ok: false, detail: e.message || String(error), status: e.status, debug_id: e.envelope?.debug_id });
  };

  const captureOf = (order: Json) => (order.purchase_units?.[0]?.payments?.captures || [])[0] as Json | undefined;
  const linkOf = (order: Json, rel: string) => (order.links || []).find((l: Json) => l.rel === rel)?.href as string | undefined;

  async function captureIfApproved(spec: SeedCaptureSpec, orderId: string): Promise<'captured' | 'pending' | 'exists'> {
    const { json: order } = await api.call('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
    const entry = manifest.captures[spec.tag];
    if (order.status === 'COMPLETED') {
      const capture = captureOf(order);
      Object.assign(entry, { status: 'COMPLETED', capture_id: capture?.id, capture_status: capture?.status });
      return 'exists';
    }
    if (order.status === 'APPROVED') {
      const { json: captured } = await api.call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {}, { requestId: requestId(spec.tag, 'capture'), prefer: 'return=representation' });
      const capture = captureOf(captured);
      Object.assign(entry, { status: String(captured.status), capture_id: capture?.id, capture_status: capture?.status, approve_url: undefined });
      return 'captured';
    }
    entry.status = String(order.status);
    entry.approve_url = linkOf(order, 'payer-action') || linkOf(order, 'approve') || entry.approve_url;
    return 'pending';
  }

  async function ensureCapture(spec: SeedCaptureSpec, label: string) {
    const existing = manifest.captures[spec.tag];
    try {
      if (existing?.order_id) {
        const outcome = await captureIfApproved(spec, existing.order_id);
        const entry = manifest.captures[spec.tag];
        if (outcome === 'pending') record({ step: label, ok: true, pending: true, detail: `order ${entry.order_id} is ${entry.status}: approve it as your sandbox personal account at ${entry.approve_url || '(no link returned)'}, then rerun npm run sandbox:seed` });
        else record({ step: label, ok: true, detail: `${outcome === 'exists' ? 'already captured' : 'captured now'}: order ${entry.order_id}, capture ${entry.capture_id} ${entry.capture_status} ${currency} ${spec.value}` });
        return;
      }
      const purchaseUnit = { reference_id: spec.tag, invoice_id: spec.tag, custom_id: seedCustomId(spec), description: `${spec.product} (Tillwise sandbox demo)`, amount: { currency_code: currency, value: spec.value } };
      let order: Json;
      let via = 'card';
      try {
        // Orders v2: "PayPal-Request-Id … is mandatory for all single-step create order calls (E.g. Create Order Request with payment source information like Card…)".
        ({ json: order } = await api.call('POST', '/v2/checkout/orders', { intent: 'CAPTURE', purchase_units: [purchaseUnit], payment_source: { card: { ...SANDBOX_TEST_CARD, billing_address: { country_code: 'IE' } } } }, { requestId: requestId(spec.tag, 'card'), prefer: 'return=representation' }));
      } catch (error) {
        if (!(error instanceof PayPalApiError) || !CARD_NOT_AVAILABLE.has(error.envelope.name)) throw error;
        via = 'buyer-approval';
        log(`    card payments are not enabled for this sandbox business account (${error.envelope.name}); falling back to a buyer-approval order`);
        ({ json: order } = await api.call('POST', '/v2/checkout/orders', { intent: 'CAPTURE', purchase_units: [purchaseUnit], payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', return_url: 'https://example.com/tillwise-sandbox-seed/approved', cancel_url: 'https://example.com/tillwise-sandbox-seed/cancelled' } } } }, { requestId: requestId(spec.tag, 'paypal'), prefer: 'return=representation' }));
      }
      manifest.captures[spec.tag] = { order_id: String(order.id), status: String(order.status), amount: spec.value };
      saveManifest();
      if (order.status === 'COMPLETED') {
        const capture = captureOf(order);
        Object.assign(manifest.captures[spec.tag], { capture_id: capture?.id, capture_status: capture?.status });
        record({ step: label, ok: capture?.status === 'COMPLETED', detail: `created via ${via}: order ${order.id}, capture ${capture?.id} ${capture?.status} ${currency} ${spec.value}` });
      } else {
        const outcome = await captureIfApproved(spec, String(order.id));
        const entry = manifest.captures[spec.tag];
        if (outcome === 'pending') record({ step: label, ok: true, pending: true, detail: `created via ${via}: order ${order.id} is ${entry.status}; approve it as your sandbox personal account at ${entry.approve_url || '(no link returned)'}, then rerun npm run sandbox:seed` });
        else record({ step: label, ok: entry.capture_status === 'COMPLETED', detail: `created via ${via} and captured: order ${order.id}, capture ${entry.capture_id} ${entry.capture_status} ${currency} ${spec.value}` });
      }
    } catch (error) {
      if (error instanceof PayPalApiError && error.envelope.name === 'DUPLICATE_INVOICE_ID') {
        record({ step: label, ok: true, detail: `tag ${spec.tag} already exists in this PayPal account (DUPLICATE_INVOICE_ID); not created again. Its ids are not in this machine's manifest.` });
        return;
      }
      fail(label, error);
    } finally {
      saveManifest();
    }
  }

  async function ensureInvoice() {
    const label = `invoice ${SEED_INVOICE.tag}`;
    try {
      const { json: found } = await api.call('POST', '/v2/invoicing/search-invoices?page=1&page_size=5&total_required=false', { invoice_number: SEED_INVOICE.tag });
      let invoice = (found.items || []).find((item: Json) => item.detail?.invoice_number === SEED_INVOICE.tag) as Json | undefined;
      let created = false;
      if (!invoice) {
        const due = new Date(now().getTime() + 14 * 86400_000).toISOString().slice(0, 10);
        const { json } = await api.call('POST', '/v2/invoicing/invoices', {
          detail: { invoice_number: SEED_INVOICE.tag, currency_code: currency, note: 'Tillwise sandbox demo invoice (created by npm run sandbox:seed).', payment_term: { due_date: due } },
          primary_recipients: [{ billing_info: { business_name: SEED_INVOICE.business_name, email_address: SEED_INVOICE.email } }],
          items: [{ name: SEED_INVOICE.item, quantity: SEED_INVOICE.quantity, unit_amount: { currency_code: currency, value: SEED_INVOICE.unit_value } }],
        }, { requestId: requestId(SEED_INVOICE.tag, 'create'), prefer: 'return=representation' });
        invoice = json.id ? json : { id: String(json.href || '').split('/').pop(), status: 'DRAFT' };
        created = true;
      }
      const id = String(invoice!.id);
      let status = String(invoice!.status);
      if (status === 'DRAFT') {
        await api.call('POST', `/v2/invoicing/invoices/${encodeURIComponent(id)}/send`, { send_to_recipient: false, send_to_invoicer: false }, { requestId: requestId(SEED_INVOICE.tag, 'send') });
        status = String((await api.call('GET', `/v2/invoicing/invoices/${encodeURIComponent(id)}`)).json.status);
      }
      manifest.invoices[SEED_INVOICE.tag] = { invoice_id: id, status };
      record({ step: label, ok: status !== 'DRAFT', detail: `${created ? 'created' : 'already exists'}: ${id} status ${status} (${currency} ${(Number(SEED_INVOICE.unit_value) * Number(SEED_INVOICE.quantity)).toFixed(2)}, sent with send_to_recipient=false)` });
    } catch (error) {
      fail(label, error);
    } finally {
      saveManifest();
    }
  }

  async function linkWooOrder(orderId: number, wp: Pick<WpAbilityClient, 'run'>) {
    const label = `link Woo order ${orderId}`;
    try {
      const context = (await wp.run('paypal-order-context', { order_id: orderId })).data as { order: { total: number; currency: string; items?: Array<{ name: string }> }; paypal: { paypal_capture_id?: string } };
      const value = Number(context.order.total).toFixed(2);
      const spec: SeedCaptureSpec = { tag: `${SEED_TAG_PREFIX}WOO-${orderId}-${Math.round(Number(value) * 100)}`, customer: `Woo order ${orderId}`, segment: 'Retail', product: (context.order.items || []).map((i) => i.name).join(' + ').slice(0, 60) || 'Woo order', value };
      if (context.order.currency && context.order.currency !== currency) throw new Error(`Woo order ${orderId} is in ${context.order.currency}, the seed currency is ${currency}`);
      await ensureCapture(spec, `capture for Woo order ${orderId}`);
      const entry = manifest.captures[spec.tag];
      if (!entry?.capture_id || entry.capture_status !== 'COMPLETED') { record({ step: label, ok: true, pending: true, detail: 'no completed sandbox capture yet; rerun after approval to link it' }); return; }
      if (context.paypal.paypal_capture_id === entry.capture_id) { record({ step: label, ok: true, detail: `already linked to capture ${entry.capture_id}` }); return; }
      await wp.run('paypal-audit-record', { tool: 'paypal_sandbox_seed', woo_order_id: orderId, paypal_order_id: entry.order_id, paypal_capture_id: entry.capture_id, paypal_object_id: entry.capture_id, amount: Number(value), currency, idempotency_key: requestId(spec.tag, 'link'), status: 'LINKED', summary: `sandbox:seed linked PayPal sandbox capture ${entry.capture_id} (${currency} ${value})` });
      Object.assign(entry, { woo_order_id: orderId, linked: true });
      record({ step: label, ok: true, detail: `Woo order ${orderId} now points at sandbox capture ${entry.capture_id} (${currency} ${value}); audited as paypal_sandbox_seed` });
    } catch (error) {
      fail(label, error);
    } finally {
      saveManifest();
    }
  }

  log(`PayPal sandbox seed against ${api.baseUrl} (credentials file found; values not shown)`);
  try {
    const token = await api.accessToken();
    record({ step: 'oauth token', ok: true, detail: `access token issued, expires in ${token.expires_in_s}s` });
  } catch (error) {
    fail('oauth token', error);
  }
  if (steps[0]?.ok) {
    for (const spec of SEED_CAPTURES) await ensureCapture(spec, `capture ${spec.tag} (${spec.segment}, ${spec.customer})`);
    await ensureInvoice();
    if (options.linkWoo?.length) {
      const wp = options.wp ?? null;
      if (!wp) record({ step: 'link Woo orders', ok: false, detail: 'no WordPress credentials: run ./scripts/seed-local.sh (writes mcp-server/.env) or set WP_BASE_URL / WP_USERNAME / WP_APPLICATION_PASSWORD' });
      else for (const id of options.linkWoo) await linkWooOrder(id, wp);
    }
  }
  const failed = steps.filter((s) => !s.ok).length;
  const pending = steps.filter((s) => s.pending).length;
  const result: SeedResult = { exitCode: failed || !steps[0]?.ok ? 1 : 0, host: SANDBOX_HOST, steps, manifest, startedAt, finishedAt: now().toISOString() };
  log(`Summary: ${steps.length - failed}/${steps.length} steps ok against ${SANDBOX_HOST}${failed ? ` — ${failed} failed` : ''}${pending ? ` — ${pending} waiting for sandbox buyer approval` : ''}. Manifest: ${manifestPath.replace(homedir(), '~')}`);
  if (steps[0]?.ok) log('Note: PayPal says "It takes a maximum of three hours for executed transactions to appear in the list transactions call", so the Money Desk (PAYPAL_MODE=sandbox) may show new captures only later.');
  if (options.evidencePath) {
    mkdirSync(dirname(options.evidencePath), { recursive: true });
    writeFileSync(options.evidencePath, `${redact(JSON.stringify({ generatedBy: 'mcp-server/src/sandboxSeed.ts', ...result }, null, 2))}\n`);
    log(`Evidence: ${options.evidencePath}`);
  }
  return result;
}

export function parseSeedArgs(argv: string[]): { linkWoo: number[]; currency?: string } {
  const linkWoo: number[] = [];
  let currency: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[i + 1];
    if (arg.startsWith('--link-woo')) {
      if (!arg.includes('=')) i += 1;
      for (const part of String(value || '').split(',')) { const n = Number(part.trim()); if (Number.isInteger(n) && n > 0) linkWoo.push(n); else throw new Error(`--link-woo expects Woo order ids, got "${part}"`); }
    } else if (arg.startsWith('--currency')) {
      if (!arg.includes('=')) i += 1;
      if (!/^[A-Z]{3}$/.test(String(value))) throw new Error(`--currency expects a 3-letter code, got "${value}"`);
      currency = String(value);
    }
  }
  return { linkWoo, currency };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..', '..');
  try {
    const args = parseSeedArgs(process.argv.slice(2));
    const wpEnv = args.linkWoo.length ? readWpEnv(process.env, join(repoRoot, 'mcp-server', '.env')) : null;
    runSandboxSeed({ ...args, wp: wpEnv ? new WpAbilityClient(wpEnv.baseUrl, wpEnv.username, wpEnv.password) : null, evidencePath: join(repoRoot, 'docs', 'evidence', 'paypal-sandbox-seed.json') })
      .then((result) => { process.exitCode = result.exitCode; })
      .catch((error) => { console.error(`PayPal sandbox seed crashed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
