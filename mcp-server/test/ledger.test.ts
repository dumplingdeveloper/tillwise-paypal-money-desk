import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMockLedger, REFUND_SPIKE_DAYS, SPIKE_PRODUCT, SPIKE_REASON } from '../src/paypal/mockLedger.js';
import { explainRefundAnomaly } from '../src/paypal/refundAnomaly.js';
import { MockPayPalClient } from '../src/paypal/mockClient.js';
import { PayPalService } from '../src/paypal/service.js';
import { createServer } from '../src/server.js';

const ANCHOR = Date.parse('2026-10-17T18:00:00Z');
const DAY = 86_400_000;

function fakeWp() {
  return { async run(name: string) { if (name === 'paypal-audit-list') return { speech: '0 rows', data: { audit: [], count: 0 } }; throw new Error(`Unexpected ability ${name}`); } };
}

test('mock ledger is deterministic for a given anchor', () => {
  assert.deepEqual(buildMockLedger(ANCHOR), buildMockLedger(ANCHOR));
});

test('mock ledger has 30+ days of captures across 3+ segments, never in the future', () => {
  const ledger = buildMockLedger(ANCHOR);
  const days = new Set(ledger.captures.map((c) => c.date));
  assert.ok(days.size >= 30, `capture days ${days.size}`);
  assert.ok(new Set(ledger.captures.map((c) => c.segment)).size >= 3);
  assert.ok(ledger.captures.every((c) => Date.parse(c.captured_at) <= ANCHOR));
  assert.ok(ledger.refunds.every((r) => Date.parse(r.refunded_at) <= ANCHOR));
  assert.ok(ledger.captures.every((c) => Math.abs(c.gross - c.fee - c.net) < 0.011));
});

test('mock ledger has a clear refund spike in the last 7 days', () => {
  const ledger = buildMockLedger(ANCHOR);
  const spikeStart = new Date(Math.floor(ANCHOR / DAY) * DAY - (REFUND_SPIKE_DAYS - 1) * DAY).toISOString().slice(0, 10);
  const rate = (inWindow: (date: string) => boolean) => {
    const captured = ledger.captures.filter((c) => inWindow(c.date)).reduce((s, c) => s + c.gross, 0);
    const refunded = ledger.refunds.filter((r) => inWindow(r.date)).reduce((s, r) => s + r.amount, 0);
    return refunded / captured;
  };
  const recent = rate((d) => d >= spikeStart);
  const baseline = rate((d) => d < spikeStart);
  assert.ok(recent > baseline * 3, `recent ${recent.toFixed(3)} baseline ${baseline.toFixed(3)}`);
  assert.ok(ledger.refunds.filter((r) => r.date >= spikeStart).length >= 5);
});

test('mock ledger has invoices across statuses, disputes with due dates, and tracking rows', () => {
  const ledger = buildMockLedger(ANCHOR);
  assert.ok(ledger.invoices.length >= 4);
  const statuses = new Set(ledger.invoices.map((i) => i.status));
  for (const status of ['DRAFT', 'SENT', 'PAID']) assert.ok(statuses.has(status as never), status);
  assert.ok(ledger.invoices.some((i) => i.overdue && i.days_overdue > 0 && i.amount_due > 0));
  assert.ok(ledger.invoices.filter((i) => i.status !== 'DRAFT').every((i) => Math.abs(i.amount - i.amount_paid - i.amount_due) < 0.011));
  assert.ok(ledger.invoices.filter((i) => i.status === 'DRAFT' || i.status === 'PAID').every((i) => i.amount_due === 0));
  const awaiting = ledger.disputes.filter((d) => d.seller_response_due_date);
  assert.ok(awaiting.length >= 2);
  assert.ok(awaiting.every((d) => Date.parse(d.seller_response_due_date!) > ANCHOR));
  assert.ok(ledger.tracking.length >= 4);
});

test('mock client transactions and disputes agree with the ledger', async () => {
  const client = new MockPayPalClient({ now: () => ANCHOR });
  const ledger = client.ledger();
  const all = await client.listTransactions({ start_date: '2000-01-01T00:00:00Z', end_date: '2100-01-01T00:00:00Z', page_size: 1000 });
  assert.equal(all.length, ledger.captures.length + ledger.refunds.length);
  assert.deepEqual((await client.listDisputes()).map((d) => d.dispute_id).sort(), ledger.disputes.map((d) => d.dispute_id).sort());
  assert.equal((await client.listTransactions({ start_date: '2000-01-01T00:00:00Z', end_date: '2100-01-01T00:00:00Z', page_size: 20 })).length, 20);
});

test('paypal_ledger_export is a read-only MCP tool that returns the ledger', async () => {
  const server = createServer(fakeWp(), { PAYPAL_MODE: 'mock' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'ledger-test', version: '0.0.0' });
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'paypal_ledger_export');
    assert.ok(tool);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    const result = await client.callTool({ name: 'paypal_ledger_export', arguments: { days: 31 } });
    const data = (result.structuredContent as { data: { mode: string; captures: unknown[]; counts: Record<string, number> } }).data;
    assert.equal(data.mode, 'mock');
    assert.ok(data.counts.captures > 0 && data.counts.refunds > 0 && data.counts.invoices >= 4 && data.counts.disputes >= 2 && data.counts.tracking > 0);
    assert.equal(data.captures.length, data.counts.captures);
  } finally {
    await client.close();
    await server.close();
  }
});

test('ledger export reflects an applied mock refund', async () => {
  const wp = { audits: [] as unknown[], async run(name: string, input: Record<string, unknown> = {}) {
    if (name === 'paypal-order-context') return { speech: '', data: { order: { id: input.order_id, total: 20, currency: 'EUR' }, paypal: { paypal_capture_id: 'MOCKCAPTURE101' } } };
    if (name === 'paypal-audit-record') { this.audits.push(input); return { speech: '', data: {} }; }
    throw new Error(name);
  } };
  const service = new PayPalService(wp, new MockPayPalClient());
  const before = (await service.ledgerExport({})).data as { counts: { refunds: number } };
  const preview = await service.refundPreview({ order_id: 101, amount: 5 });
  await service.refundApply({ preview_id: String(preview.data.preview_id) });
  const after = (await service.ledgerExport({})).data as { counts: { refunds: number } };
  assert.equal(after.counts.refunds, before.counts.refunds + 1);
});

test('the refund spike has one cause in the data: one product, one reason', () => {
  // Check every hour of two different days so the story does not depend on when the demo runs.
  for (const base of [ANCHOR, Date.parse('2026-11-12T00:30:00Z')]) {
    for (let hour = 0; hour < 24; hour += 3) {
      const ledger = buildMockLedger(base + hour * 3_600_000);
      assert.ok(ledger.captures.every((c) => c.product) && ledger.refunds.every((r) => r.product));
      const anomaly = explainRefundAnomaly(ledger, REFUND_SPIKE_DAYS);
      const label = `${new Date(base + hour * 3_600_000).toISOString()}: ${anomaly.headline}`;
      assert.ok(anomaly.spike && anomaly.window_rate > anomaly.baseline_rate * 3, label);
      assert.equal(anomaly.breakdowns.product[0].key, SPIKE_PRODUCT, label);
      assert.equal(anomaly.breakdowns.reason[0].key, SPIKE_REASON, label);
      assert.ok(anomaly.breakdowns.product[0].share_of_window_refunds >= 0.6, label);
      assert.deepEqual(anomaly.top_driver?.key, SPIKE_PRODUCT, label);
    }
  }
});

test('refund anomaly figures add up to the ledger rows they summarise', () => {
  const ledger = buildMockLedger(ANCHOR);
  const anomaly = explainRefundAnomaly(ledger, 7);
  assert.equal(anomaly.window.end, ledger.anchor_date);
  const windowRefunds = ledger.refunds.filter((r) => r.date >= anomaly.window.start);
  const total = Math.round(windowRefunds.reduce((t, r) => t + r.amount, 0) * 100) / 100;
  assert.equal(anomaly.window_refunded, total);
  for (const dimension of ['reason', 'product', 'segment'] as const) {
    const rows = anomaly.breakdowns[dimension];
    assert.equal(rows.reduce((t, r) => t + r.refunds, 0), windowRefunds.length, dimension);
    assert.ok(Math.abs(rows.reduce((t, r) => t + r.refunded, 0) - total) < 0.05, dimension);
  }
  const captured = ledger.captures.filter((c) => c.date >= anomaly.window.start).reduce((t, c) => t + c.gross, 0);
  assert.ok(Math.abs(anomaly.window_rate - total / captured) < 1e-3);
  assert.ok(anomaly.headline.includes(anomaly.formatted.window_rate) && anomaly.headline.includes(anomaly.formatted.baseline_rate));
});

test('paypal_refund_anomaly is a read-only MCP tool', async () => {
  const server = createServer(fakeWp(), { PAYPAL_MODE: 'mock' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'anomaly-test', version: '0.0.0' });
  await client.connect(clientTransport);
  try {
    const tool = (await client.listTools()).tools.find((t) => t.name === 'paypal_refund_anomaly');
    assert.ok(tool);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    const result = await client.callTool({ name: 'paypal_refund_anomaly', arguments: { window_days: 7 } });
    const data = (result.structuredContent as { data: { window_days: number; breakdowns: { product: Array<{ key: string }> } } }).data;
    assert.equal(data.window_days, 7);
    assert.equal(data.breakdowns.product[0].key, SPIKE_PRODUCT);
  } finally {
    await client.close();
    await server.close();
  }
});
