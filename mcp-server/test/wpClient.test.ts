import test from 'node:test';
import assert from 'node:assert/strict';
import { WpAbilityClient } from '../src/wpClient.js';

test('WpAbilityClient calls the WordPress abilities endpoint with Basic auth', async () => {
  let seenUrl = '';
  let seenAuth = '';
  const client = new WpAbilityClient('http://shop.test', 'manager', 'app pass', async (input, init) => {
    seenUrl = String(input);
    seenAuth = String(init?.headers && (init.headers as Record<string, string>).authorization);
    assert.equal(init?.method, 'GET');
    assert.equal(init?.body, undefined);
    return new Response(JSON.stringify({ speech: 'Done.', data: { ok: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await client.run('sales-summary', { period: 'today' });
  assert.equal(seenUrl, 'http://shop.test/wp-json/wp-abilities/v1/abilities/tillwise-store/sales-summary/run?input%5Bperiod%5D=today');
  assert.equal(seenAuth, `Basic ${Buffer.from('manager:app pass').toString('base64')}`);
  assert.equal(result.speech, 'Done.');
  assert.deepEqual(result.data, { ok: true });
});

test('WpAbilityClient surfaces WordPress errors', async () => {
  const client = new WpAbilityClient('http://shop.test', 'manager', 'app', async () => new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }));
  await assert.rejects(() => client.run('low-stock'), /Forbidden/);
});
