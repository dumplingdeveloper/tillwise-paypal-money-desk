import { PayPalApiError, type AcceptDisputeInput, type CreateInvoiceInput, type CreateOrderInput, type CreateRefundInput, type CreateShipmentInput, type ListTransactionsInput, type PayPalClient, type PayPalDispute, type PayPalInvoice, type PayPalOrder, type PayPalRefund, type PayPalShipment, type PayPalTransaction, type SendInvoiceInput } from './types.js';

function amount(value: string, currency_code = 'EUR') { return { currency_code, value }; }
function error(message: string, issue = 'INVALID_REQUEST', status = 400): never {
  throw new PayPalApiError({ name: 'UNPROCESSABLE_ENTITY', message, debug_id: `MOCK-${issue}`, details: [{ issue, description: message }] }, status);
}
function requireField(value: unknown, name: string) { if (value === undefined || value === null || value === '') error(`Missing required field: ${name}`, 'MISSING_REQUIRED_PARAMETER'); }

export class MockPayPalClient implements PayPalClient {
  readonly mode = 'mock' as const;
  private idempotency = new Map<string, unknown>();
  private refunds = new Map<string, PayPalRefund>();
  private invoices = new Map<string, PayPalInvoice>();
  private shipments = new Map<string, PayPalShipment>();
  private disputes = new Map<string, PayPalDispute>();
  private transactions: PayPalTransaction[] = [];
  private next = 1000;

  constructor() {
    this.disputes.set('PP-D-MOCK-1', { dispute_id: 'PP-D-MOCK-1', status: 'WAITING_FOR_SELLER_RESPONSE', dispute_state: 'REQUIRED_ACTION', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', dispute_amount: amount('18.00'), update_time: '2026-10-15T10:00:00Z' });
    this.transactions = [
      { transaction_info: { transaction_id: 'MOCKCAPTURE1001', transaction_event_code: 'T0006', transaction_status: 'S', transaction_amount: amount('39.00'), transaction_updated_date: '2026-10-16T09:00:00Z' } },
      { transaction_info: { transaction_id: 'MOCK-INVOICE-PAID-1', transaction_event_code: 'T1107', transaction_status: 'S', transaction_amount: amount('72.00'), transaction_updated_date: '2026-10-15T12:00:00Z' } },
    ];
  }

  private once<T>(requestId: string, create: () => T): T {
    requireField(requestId, 'PayPal-Request-Id');
    if (this.idempotency.has(requestId)) return this.idempotency.get(requestId) as T;
    const value = create();
    this.idempotency.set(requestId, value);
    return value;
  }

  async createRefund(input: CreateRefundInput): Promise<PayPalRefund> {
    requireField(input.capture_id, 'capture_id');
    return this.once(input.request_id, () => {
      const refund: PayPalRefund = { id: `MOCK-RFND-${++this.next}`, status: 'COMPLETED', capture_id: input.capture_id, amount: input.amount || amount('39.00') };
      this.refunds.set(refund.id, refund);
      this.transactions.unshift({ transaction_info: { transaction_id: refund.id, transaction_event_code: 'T1107', transaction_status: 'S', transaction_amount: { ...refund.amount, value: `-${refund.amount.value}` }, transaction_updated_date: new Date().toISOString() } });
      return refund;
    });
  }

  async createInvoice(input: CreateInvoiceInput): Promise<PayPalInvoice> {
    requireField(input.currency_code, 'currency_code'); requireField(input.primary_recipients?.length, 'primary_recipients'); requireField(input.items?.length, 'items');
    return this.once(input.request_id, () => {
      const invoice: PayPalInvoice = { id: `INV2-MOCK-${++this.next}`, status: 'DRAFT', detail: { currency_code: input.currency_code, invoice_number: input.invoice_number } };
      this.invoices.set(invoice.id, invoice);
      return invoice;
    });
  }

  async sendInvoice(input: SendInvoiceInput): Promise<PayPalInvoice> {
    requireField(input.invoice_id, 'invoice_id');
    return this.once(input.request_id, () => {
      const invoice = this.invoices.get(input.invoice_id) || { id: input.invoice_id, status: 'DRAFT' };
      const sent = { ...invoice, status: 'SENT', href: `https://www.sandbox.paypal.com/invoice/p/#${input.invoice_id}` };
      this.invoices.set(sent.id, sent);
      return sent;
    });
  }

  async createShipmentTracking(input: CreateShipmentInput): Promise<PayPalShipment> {
    requireField(input.transaction_id, 'transaction_id'); requireField(input.status, 'status');
    if (input.tracking_number) requireField(input.carrier, 'carrier');
    return this.once(input.request_id, () => {
      const shipment = { id: `${input.transaction_id}-${input.tracking_number || 'NO_TRACKING'}`, status: input.status, transaction_id: input.transaction_id, tracking_number: input.tracking_number, carrier: input.carrier };
      this.shipments.set(shipment.id, shipment);
      return shipment;
    });
  }

  async listDisputes(): Promise<PayPalDispute[]> { return [...this.disputes.values()]; }
  async getDispute(dispute_id: string): Promise<PayPalDispute> { const d = this.disputes.get(dispute_id); if (!d) error('Dispute not found', 'RESOURCE_NOT_FOUND', 404); return d; }
  async acceptDisputeClaim(input: AcceptDisputeInput): Promise<{ dispute_id: string; status: string }> {
    requireField(input.dispute_id, 'dispute_id'); requireField(input.note, 'note');
    return this.once(input.request_id, () => { const d = this.disputes.get(input.dispute_id); if (!d) error('Dispute not found', 'RESOURCE_NOT_FOUND', 404); d.status = 'RESOLVED'; d.dispute_state = 'RESOLVED'; return { dispute_id: input.dispute_id, status: 'RESOLVED' }; });
  }
  async listTransactions(_input: ListTransactionsInput): Promise<PayPalTransaction[]> { return this.transactions; }
  async createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    requireField(input.currency_code, 'currency_code'); requireField(input.value, 'value');
    return this.once(input.request_id, () => ({ id: `MOCK-ORDER-${++this.next}`, status: 'CREATED', purchase_units: [{ amount: { currency_code: input.currency_code, value: input.value }, invoice_id: input.invoice_id, custom_id: input.custom_id }] }));
  }
  async captureOrder(input: { id: string; request_id: string }): Promise<PayPalOrder> {
    requireField(input.id, 'id');
    return this.once(input.request_id, () => ({ id: input.id, status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: `MOCKCAPTURE${++this.next}`, status: 'COMPLETED', amount: amount('10.00') }] } }] }));
  }
}
