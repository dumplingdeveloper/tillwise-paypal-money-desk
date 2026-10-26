import test from 'node:test';
import assert from 'node:assert/strict';
import http, { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPayPalCallLog } from '../src/paypal/callLog.js';

test('PayPal call log counts fetch and node:http requests, keeps no query string, headers or bodies', async () => {
  const server = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const path = join(mkdtempSync(join(tmpdir(), 'tw-calllog-')), 'calls.jsonl');
  assert.equal(installPayPalCallLog({ path, source: 'unit', hosts: ['127.0.0.1'] }), true);
  assert.equal(installPayPalCallLog({ path, source: 'unit-again', hosts: ['127.0.0.1'] }), false, 'installs once per process');
  const secret = 'SECRET-TOKEN-should-never-be-logged';
  await (await fetch(`http://127.0.0.1:${port}/v2/checkout/orders?token=${secret}`, { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: secret })).text();
  await new Promise<void>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: `/v1/reporting/transactions?start_date=x&auth=${secret}`, method: 'GET', headers: { authorization: `Bearer ${secret}` } }, (res) => { res.resume(); res.on('end', () => resolve()); });
    req.on('error', reject); req.end();
  });
  await (await fetch('http://localhost:9/ignored').catch(() => ({ text: async () => '' }))).text();
  server.close();
  const raw = readFileSync(path, 'utf8');
  assert.ok(!raw.includes(secret), 'the secret never reaches the log');
  const rows = raw.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(rows.map((r) => [r.via, r.method, r.host, r.path, r.source]), [
    ['fetch', 'POST', '127.0.0.1', '/v2/checkout/orders', 'unit'],
    ['node:http', 'GET', '127.0.0.1', '/v1/reporting/transactions', 'unit'],
  ]);
});
