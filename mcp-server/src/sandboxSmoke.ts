import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LivePayPalClient, readSandboxCredentials } from './paypal/liveClient.js';
import type { PayPalDispute, PayPalInvoice, PayPalTransaction } from './paypal/types.js';

/**
 * `npm run sandbox:smoke` — one command to prove the live PayPal path once sandbox credentials exist.
 *
 * Reads ~/.config/tillwise/paypal-sandbox.env (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET; see submission/save-paypal-sandbox-creds.sh),
 * then against https://api-m.sandbox.paypal.com only:
 *   1. OAuth client-credentials token            (read)
 *   2. Transaction Search, last 30 days          (read)
 *   3. Disputes list                             (read)
 *   4. Create ONE draft invoice, never sent      (the single safe write)
 *   5. Read that invoice back, expect DRAFT      (read)
 *   6. Delete that draft again (unless --keep-draft)
 * Prints a summary without secrets: no client id, secret or token is ever printed or written.
 * Exit codes: 0 all steps ok, 1 a step failed, 2 no credentials (nothing was called).
 */
export type SmokeClient = Pick<LivePayPalClient, 'oauthProbe' | 'listTransactions' | 'listDisputes' | 'createInvoice' | 'getInvoice' | 'deleteDraftInvoice'>;
export type SmokeStep = { step: string; ok: boolean; ms: number; detail: string; debug_id?: string; status?: number };
export type SmokeResult = { exitCode: 0 | 1 | 2; host: string; steps: SmokeStep[]; startedAt: string; finishedAt: string };

export const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.config', 'tillwise', 'paypal-sandbox.env');
const HOST = 'api-m.sandbox.paypal.com';

function isoSeconds(date: Date) { return date.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

export async function runSandboxSmoke(options: {
  credentialsPath?: string;
  log?: (line: string) => void;
  makeClient?: (creds: { clientId: string; clientSecret: string }) => SmokeClient;
  keepDraft?: boolean;
  now?: () => Date;
  evidencePath?: string | null;
} = {}): Promise<SmokeResult> {
  const log = options.log || ((line: string) => console.log(line));
  const now = options.now || (() => new Date());
  const startedAt = now().toISOString();
  const credentialsPath = options.credentialsPath || DEFAULT_CREDENTIALS_PATH;
  const creds = readSandboxCredentials(credentialsPath);
  if (!creds) {
    log(`PayPal sandbox smoke: NO CREDENTIALS — ${credentialsPath.replace(homedir(), '~')} is missing or lacks PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET.`);
    log('Nothing was called. Create sandbox REST app credentials at developer.paypal.com (Apps & Credentials → Sandbox), then run');
    log('  ./submission/save-paypal-sandbox-creds.sh   # writes that file with mode 600, never echoes the secret');
    log('  cd mcp-server && npm run sandbox:smoke');
    return { exitCode: 2, host: HOST, steps: [], startedAt, finishedAt: now().toISOString() };
  }
  const secrets = [creds.clientId, creds.clientSecret].filter((value) => value.length >= 4);
  const redact = (text: string) => secrets.reduce((out, secret) => out.split(secret).join('<redacted>'), text);
  const client = options.makeClient ? options.makeClient(creds) : new LivePayPalClient(creds);
  const steps: SmokeStep[] = [];

  async function step<T>(name: string, run: () => Promise<T>, describe: (value: T) => string): Promise<T | undefined> {
    const started = Date.now();
    try {
      const value = await run();
      const entry: SmokeStep = { step: name, ok: true, ms: Date.now() - started, detail: redact(describe(value)) };
      steps.push(entry);
      log(`  ✔ ${name} (${entry.ms} ms): ${entry.detail}`);
      return value;
    } catch (error) {
      const e = error as { message?: string; status?: number; envelope?: { name?: string; debug_id?: string } };
      const entry: SmokeStep = { step: name, ok: false, ms: Date.now() - started, detail: redact(e.message || String(error)), debug_id: e.envelope?.debug_id, status: e.status };
      steps.push(entry);
      log(`  ✖ ${name} (${entry.ms} ms): ${entry.detail}${entry.status ? ` [HTTP ${entry.status}]` : ''}${entry.debug_id ? ` debug_id=${entry.debug_id}` : ''}`);
      return undefined;
    }
  }

  log(`PayPal sandbox smoke against https://${HOST} (credentials file found; values not shown)`);
  const token = await step('oauth token', () => client.oauthProbe(), (t) => `access token issued, expires in ${t.expires_in_s}s`);
  if (token) {
    const end = now();
    const start = new Date(end.getTime() - 30 * 86_400_000);
    await step('transactions (last 30 days)', () => client.listTransactions({ start_date: isoSeconds(start), end_date: isoSeconds(end), page_size: 20 }), (rows: PayPalTransaction[]) => `${rows.length} transaction(s)`);
    await step('disputes', () => client.listDisputes({ page_size: 5 }), (rows: PayPalDispute[]) => `${rows.length} dispute(s)${rows.length ? `: ${rows.map((d) => d.status).join(', ')}` : ''}`);
    const stamp = isoSeconds(now()).replace(/[-:TZ]/g, '').slice(0, 14);
    const invoice = await step('create draft invoice (not sent)', () => client.createInvoice({
      invoice_number: `TW-SMOKE-${stamp}`,
      currency_code: 'EUR',
      primary_recipients: [],
      items: [{ name: 'Tillwise sandbox smoke test (draft, never sent)', quantity: '1', unit_amount: { currency_code: 'EUR', value: '1.00' } }],
      note: 'Created by tillwise mcp-server sandbox smoke; deleted again unless --keep-draft.',
      request_id: randomUUID(),
    }), (inv: PayPalInvoice) => `invoice ${inv.id} status ${inv.status}`);
    if (invoice?.id) {
      await step('read invoice back', async () => {
        const back = await client.getInvoice(invoice.id);
        if (back.status !== 'DRAFT') throw new Error(`expected DRAFT, got ${back.status}`);
        return back;
      }, (inv) => `invoice ${inv.id} status ${inv.status}`);
      if (!options.keepDraft) await step('delete draft invoice', () => client.deleteDraftInvoice(invoice.id), () => `draft ${invoice.id} deleted`);
    }
  }
  const failed = steps.filter((s) => !s.ok).length;
  const result: SmokeResult = { exitCode: failed || !token ? 1 : 0, host: HOST, steps, startedAt, finishedAt: now().toISOString() };
  log(`Summary: ${steps.length - failed}/${steps.length} steps ok against ${HOST}${failed ? ` — ${failed} failed` : ''}.`);
  if (options.evidencePath) {
    mkdirSync(dirname(options.evidencePath), { recursive: true });
    writeFileSync(options.evidencePath, `${redact(JSON.stringify({ generatedBy: 'mcp-server/src/sandboxSmoke.ts', ...result }, null, 2))}\n`);
    log(`Evidence: ${options.evidencePath}`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  runSandboxSmoke({ keepDraft: process.argv.includes('--keep-draft'), evidencePath: join(repoRoot, 'docs', 'evidence', 'paypal-sandbox-smoke.json') })
    .then((result) => { process.exitCode = result.exitCode; })
    .catch((error) => { console.error(`PayPal sandbox smoke crashed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
}
