#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

function readEnv(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}
const repoEnv = readEnv(new URL('../.env', import.meta.url));
const sandboxEnv = readEnv(join(homedir(), '.config', 'tillwise', 'paypal-sandbox.env'));
const mode = sandboxEnv.PAYPAL_CLIENT_ID && sandboxEnv.PAYPAL_CLIENT_SECRET ? 'live' : 'mock';

async function callAbility(name, input = {}) {
  const base = repoEnv.WP_BASE_URL || 'http://127.0.0.1:8098';
  const user = repoEnv.WP_USERNAME || 'shopmanager';
  const pass = repoEnv.WP_APPLICATION_PASSWORD || '';
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const response = await fetch(`${base}/wp-json/wp-abilities/v1/abilities/tillwise-store/${name}/run`, { method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ input }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name} failed ${response.status}: ${text}`);
  return JSON.parse(text);
}

if (mode === 'mock') {
  const seeded = await callAbility('paypal-seed-demo');
  console.log(JSON.stringify({ mode, seeded: seeded.data }, null, 2));
} else {
  console.log(JSON.stringify({ mode, live: 'UNVERIFIED: credentials are present; browserless card order seeding is intentionally not attempted until sandbox cards/capabilities are verified.' }, null, 2));
}
