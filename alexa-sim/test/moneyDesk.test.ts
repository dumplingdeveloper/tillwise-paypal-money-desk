import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentWidgets, demoMoneyDeskRows } from '../src/moneyDesk.js';

test('money desk fixtures produce three agent-built custom widgets without mutation tools', () => {
  const rows = demoMoneyDeskRows();
  const widgets = buildAgentWidgets(rows);
  assert.equal(widgets.length, 3);
  assert.deepEqual(widgets.map((widget) => widget.type), ['refundRateTile', 'unpaidInvoiceScoreboard', 'disputeDeadlineCountdown']);
  assert.equal(widgets.every((widget) => widget.status === 'pass'), true);
  assert.equal(JSON.stringify(widgets).includes('apply'), false);
});
