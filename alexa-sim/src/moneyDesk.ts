export type MoneyDeskRow = {
  id: string;
  kind: 'capture' | 'refund' | 'invoice' | 'dispute' | 'tracking' | 'audit';
  customer: string;
  segment: 'Retail' | 'Wholesale' | 'At risk';
  amount: number;
  currency: string;
  status: string;
  orderId?: number;
  paypalObjectId: string;
  ageDays: number;
  dueDays?: number;
  updatedAt: string;
};

export type MoneyDeskWidget = { id: string; type: string; title: string; prompt: string; status: 'pass' | 'fail'; summary: string };

export function demoMoneyDeskRows(now = new Date('2026-10-17T12:00:00+01:00')): MoneyDeskRow[] {
  const day = 86_400_000;
  const iso = (daysAgo: number) => new Date(now.getTime() - daysAgo * day).toISOString();
  return [
    { id: 'txn-1001', kind: 'capture', customer: 'Aoife Retail', segment: 'Retail', amount: 39, currency: 'EUR', status: 'COMPLETED', orderId: 136, paypalObjectId: 'MOCKCAPTURE136', ageDays: 1, updatedAt: iso(1) },
    { id: 'rfnd-1002', kind: 'refund', customer: 'Aoife Retail', segment: 'Retail', amount: -5, currency: 'EUR', status: 'COMPLETED', orderId: 136, paypalObjectId: 'MOCK-RFND-1002', ageDays: 0, updatedAt: iso(0) },
    { id: 'inv-1003', kind: 'invoice', customer: 'Dublin Pantry', segment: 'Wholesale', amount: 480, currency: 'EUR', status: 'SENT', paypalObjectId: 'INV2-MOCK-1003', ageDays: 4, dueDays: 6, updatedAt: iso(4) },
    { id: 'inv-1004', kind: 'invoice', customer: 'Cork Office Co', segment: 'Wholesale', amount: 220, currency: 'EUR', status: 'OVERDUE', paypalObjectId: 'INV2-MOCK-1004', ageDays: 11, dueDays: -1, updatedAt: iso(11) },
    { id: 'disp-1005', kind: 'dispute', customer: 'Liam Buyer', segment: 'At risk', amount: -18, currency: 'EUR', status: 'WAITING_FOR_SELLER_RESPONSE', orderId: 122, paypalObjectId: 'PP-D-MOCK-1', ageDays: 2, dueDays: 5, updatedAt: iso(2) },
    { id: 'track-1006', kind: 'tracking', customer: 'Nora Retail', segment: 'Retail', amount: 0, currency: 'EUR', status: 'SHIPPED', orderId: 135, paypalObjectId: 'MOCKCAPTURE135-1Z999', ageDays: 0, updatedAt: iso(0) },
  ];
}

export function buildAgentWidgets(rows: MoneyDeskRow[]): MoneyDeskWidget[] {
  const refunds = rows.filter((row) => row.kind === 'refund');
  const captures = rows.filter((row) => row.kind === 'capture');
  const overdue = rows.filter((row) => row.kind === 'invoice' && row.status === 'OVERDUE');
  const disputes = rows.filter((row) => row.kind === 'dispute');
  const refundRate = captures.length ? Math.round((refunds.length / captures.length) * 100) : 0;
  return [
    { id: 'refund-rate', type: 'refundRateTile', title: 'Refund-rate tile', prompt: 'Show refund rate and suspicious refund pressure.', status: 'pass', summary: `${refundRate}% refund-rate from ${refunds.length} refund and ${captures.length} capture rows.` },
    { id: 'who-owes', type: 'unpaidInvoiceScoreboard', title: 'Who still owes', prompt: 'Build a friendly scoreboard of unpaid invoices.', status: 'pass', summary: `${overdue.length} overdue invoice customer: ${overdue.map((row) => row.customer).join(', ') || 'none'}.` },
    { id: 'dispute-deadline', type: 'disputeDeadlineCountdown', title: 'Dispute deadline countdown', prompt: 'Highlight dispute response deadlines.', status: 'pass', summary: `${disputes.length} open dispute needing seller response.` },
  ];
}
