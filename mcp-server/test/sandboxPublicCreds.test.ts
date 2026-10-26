import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPublicCredentials, parsePublicCredsArgs, postmanRawUrl, savePublicSandboxCredentials } from '../src/sandboxPublicCreds.js';
import { readSandboxCredentials } from '../src/paypal/liveClient.js';

// Offline: a local stub stands in for raw.githubusercontent.com. The values below are fakes.
const FAKE_ID = 'FAKEpublicClientIdForTests_0123456789';
const FAKE_SECRET = 'FAKEpublicSecretForTests-9876543210';
const NOTE = '< PayPal Public Collection comes with following default public set of credentials stored at the Collection level. \nYou may choose to override these values via environment level variables.';
const collection = { info: { name: 'PayPal Public API Collection' }, variable: [{ key: 'PLEASE NOTE -->', value: NOTE }, { key: 'base_url', value: 'https://api-m.sandbox.paypal.com' }, { key: 'client_id', value: FAKE_ID }, { key: 'client_secret', value: FAKE_SECRET }] };

async function stub(body: unknown, status = 200) {
  let hits = 0;
  const server = http.createServer((_req, res) => { hits += 1; res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/Collections/PayPal_Public_APIs.json`, hits: () => hits, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test('public sandbox creds: extracts the collection variables and PayPal\'s note', () => {
  const creds = extractPublicCredentials(collection);
  assert.equal(creds.clientId, FAKE_ID);
  assert.equal(creds.clientSecret, FAKE_SECRET);
  assert.match(creds.note, /^PayPal Public Collection comes with following default public set of credentials/);
  assert.throws(() => extractPublicCredentials({ variable: [{ key: 'client_id', value: '{{client_id}}' }] }), /missing or not credential-shaped/);
  assert.throws(() => extractPublicCredentials({}), /not a Postman collection/);
  assert.equal(postmanRawUrl(), 'https://raw.githubusercontent.com/paypal/postman-collections/7f7240ab2d9417a55bf9c68355bf33bf64b1665c/Collections/PayPal_Public_APIs.json');
  assert.deepEqual(parsePublicCredsArgs(['--force', '--ref=main']), { force: true, ref: 'main' });
  assert.throws(() => parsePublicCredsArgs(['--ref=../../x y']), /--ref/);
});

test('public sandbox creds: writes a mode-600 env file the server can read, never prints the values', async () => {
  const server = await stub(collection);
  const dir = mkdtempSync(join(tmpdir(), 'tw-pubcreds-'));
  const out = join(dir, 'cfg', 'paypal-sandbox.env');
  const lines: string[] = [];
  try {
    const code = await savePublicSandboxCredentials({ url: server.url, out, log: (l) => lines.push(l), now: () => new Date('2026-10-26T12:00:00Z') });
    assert.equal(code, 0);
    assert.equal(server.hits(), 1);
    assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.deepEqual(readSandboxCredentials(out), { clientId: FAKE_ID, clientSecret: FAKE_SECRET });
    const source = readFileSync(join(dir, 'cfg', 'paypal-sandbox.SOURCE.txt'), 'utf8');
    assert.match(source, /File: Collections\/PayPal_Public_APIs\.json/);
    assert.match(source, /SHARED sandbox app/);
    const printed = lines.join('\n');
    assert.match(printed, /client_id 37 chars, client_secret 35 chars; values not shown/);
    for (const text of [printed, source]) {
      assert.ok(!text.includes(FAKE_ID), 'client id must not be printed or put in the provenance file');
      assert.ok(!text.includes(FAKE_SECRET), 'secret must not be printed or put in the provenance file');
    }
  } finally {
    await server.close();
  }
});

test('public sandbox creds: an existing env file is kept and no network call is made without --force', async () => {
  const server = await stub(collection);
  const dir = mkdtempSync(join(tmpdir(), 'tw-pubcreds-'));
  const out = join(dir, 'paypal-sandbox.env');
  writeFileSync(out, 'PAYPAL_CLIENT_ID=ownAppIdOwnAppId12345\nPAYPAL_CLIENT_SECRET=ownAppSecretOwnApp12345\n', { mode: 0o600 });
  const lines: string[] = [];
  try {
    assert.equal(await savePublicSandboxCredentials({ url: server.url, out, log: (l) => lines.push(l) }), 3);
    assert.equal(server.hits(), 0);
    assert.match(readFileSync(out, 'utf8'), /ownAppIdOwnAppId12345/);
    assert.match(lines.join('\n'), /already exists; nothing changed \(no network call\)/);
    assert.equal(await savePublicSandboxCredentials({ url: server.url, out, force: true, log: () => {} }), 0);
    assert.deepEqual(readSandboxCredentials(out), { clientId: FAKE_ID, clientSecret: FAKE_SECRET });
  } finally {
    await server.close();
  }
});

test('public sandbox creds: refuses other hosts and reports HTTP errors without writing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tw-pubcreds-'));
  const out = join(dir, 'paypal-sandbox.env');
  const lines: string[] = [];
  assert.equal(await savePublicSandboxCredentials({ url: 'https://evil.example.com/x.json', out, log: (l) => lines.push(l) }), 1);
  assert.match(lines.join('\n'), /refusing to download credentials from evil\.example\.com/);
  const server = await stub({ message: 'nope' }, 404);
  try {
    assert.equal(await savePublicSandboxCredentials({ url: server.url, out, log: (l) => lines.push(l) }), 1);
    assert.match(lines.at(-1) || '', /HTTP 404/);
    assert.equal(existsSync(out), false);
  } finally {
    await server.close();
  }
});
