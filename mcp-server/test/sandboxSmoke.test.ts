import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSandboxSmoke, type SmokeClient } from '../src/sandboxSmoke.js';
import { PayPalApiError } from '../src/paypal/types.js';

// Offline: no network. The real run is `npm run sandbox:smoke` once ~/.config/tillwise/paypal-sandbox.env exists.
const FAKE_ID = 'FAKEclientIdForTestsOnly123';
const FAKE_SECRET = 'FAKEsecretForTestsOnly456';

function credsFile() {
  const dir = mkdtempSync(join(tmpdir(), 'tw-smoke-'));
  const path = join(dir, 'paypal-sandbox.env');
  writeFileSync(path, `PAYPAL_CLIENT_ID=${FAKE_ID}\nPAYPAL_CLIENT_SECRET=${FAKE_SECRET}\n`);
  return { dir, path };
}

test('sandbox smoke exits 2 with a clear "no credentials" message and calls nothing', async () => {
  const lines: string[] = [];
  let made = 0;
  const result = await runSandboxSmoke({ credentialsPath: join(tmpdir(), 'tw-does-not-exist', 'paypal-sandbox.env'), log: (l) => lines.push(l), makeClient: () => { made += 1; throw new Error('must not be called'); } });
  assert.equal(result.exitCode, 2);
  assert.equal(made, 0);
  assert.deepEqual(result.steps, []);
  assert.match(lines[0], /^PayPal sandbox smoke: NO CREDENTIALS/);
  assert.ok(lines.some((l) => l.includes('npm run sandbox:smoke')));
});

test('sandbox smoke runs reads + one draft invoice, cleans it up, and never prints the credentials', async () => {
  const { dir, path } = credsFile();
  const calls: string[] = [];
  const client: SmokeClient = {
    async oauthProbe() { calls.push('oauth'); return { expires_in_s: 32400 }; },
    async listTransactions(input) { calls.push(`tx ${input.start_date}..${input.end_date}`); return []; },
    async listDisputes() { calls.push('disputes'); return [{ dispute_id: 'PP-D-1', status: 'WAITING_FOR_SELLER_RESPONSE' }]; },
    async createInvoice(input) { calls.push(`create ${input.invoice_number}`); return { id: 'INV2-TEST', status: 'DRAFT' }; },
    async getInvoice(id) { calls.push(`get ${id}`); return { id, status: 'DRAFT' }; },
    async deleteDraftInvoice(id) { calls.push(`delete ${id}`); },
  };
  const lines: string[] = [];
  const evidencePath = join(dir, 'evidence.json');
  const result = await runSandboxSmoke({ credentialsPath: path, log: (l) => lines.push(l), makeClient: (c) => { assert.equal(c.clientId, FAKE_ID); return client; }, now: () => new Date('2026-10-25T12:00:00Z'), evidencePath });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.steps.map((s) => s.step), ['oauth token', 'transactions (last 24 hours)', 'disputes', 'create draft invoice (not sent)', 'read invoice back', 'delete draft invoice']);
  assert.deepEqual(calls, ['oauth', 'tx 2026-10-24T12:00:00Z..2026-10-25T12:00:00Z', 'disputes', 'create TW-SMOKE-20261025120000', 'get INV2-TEST', 'delete INV2-TEST']);
  const everything = lines.join('\n') + readFileSync(evidencePath, 'utf8');
  assert.equal(everything.includes(FAKE_ID), false);
  assert.equal(everything.includes(FAKE_SECRET), false);
  assert.match(lines.at(-2)!, /Summary: 6\/6 steps ok/);
});

test('sandbox smoke reports PayPal errors with debug_id, redacts credentials and exits 1', async () => {
  const { path } = credsFile();
  const client = {
    async oauthProbe() { throw new PayPalApiError({ name: 'OAUTH_ERROR', message: `Client Authentication failed for ${FAKE_ID}`, debug_id: 'dbg-123' }, 401); },
  } as unknown as SmokeClient;
  const lines: string[] = [];
  const result = await runSandboxSmoke({ credentialsPath: path, log: (l) => lines.push(l), makeClient: () => client });
  assert.equal(result.exitCode, 1);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].status, 401);
  assert.equal(result.steps[0].debug_id, 'dbg-123');
  assert.equal(lines.join('\n').includes(FAKE_ID), false);
  assert.match(lines.join('\n'), /OAUTH_ERROR: Client Authentication failed for <redacted> \[HTTP 401\] debug_id=dbg-123/);
});
