export type Money = { currency_code: string; value: string };
export type PayPalErrorEnvelope = { name: string; message: string; debug_id: string; details?: Array<{ issue?: string; description?: string }> };

export class PayPalApiError extends Error {
  constructor(public readonly envelope: PayPalErrorEnvelope, public readonly status = 500) {
    super(`${envelope.name}: ${envelope.message}`);
  }
}

export type PayPalRefund = { id: string; status: string; amount: Money; capture_id: string; debug_id?: string };
export type PayPalInvoice = { id: string; status: string; detail?: Record<string, unknown>; href?: string };
export type PayPalShipment = { id: string; status: string; transaction_id: string; tracking_number?: string; carrier?: string };
export type PayPalDispute = { dispute_id: string; status: string; dispute_state?: string; reason?: string; dispute_amount?: Money; update_time?: string };
export type PayPalTransaction = { transaction_info: { transaction_id: string; transaction_event_code?: string; transaction_status?: string; transaction_amount?: Money; transaction_updated_date?: string } };
export type PayPalOrder = { id: string; status: string; purchase_units?: Array<Record<string, unknown>>; links?: Array<Record<string, unknown>> };

export type CreateRefundInput = { capture_id: string; amount?: Money; invoice_id?: string; note_to_payer?: string; request_id: string };
export type CreateInvoiceInput = { invoice_number?: string; currency_code: string; primary_recipients: Array<Record<string, unknown>>; items: Array<Record<string, unknown>>; note?: string; request_id: string };
export type SendInvoiceInput = { invoice_id: string; note?: string; send_to_recipient?: boolean; request_id: string };
export type CreateShipmentInput = { transaction_id: string; tracking_number?: string; status: string; carrier?: string; request_id: string };
export type AcceptDisputeInput = { dispute_id: string; note: string; request_id: string };
export type ListTransactionsInput = { start_date: string; end_date: string; transaction_id?: string; page_size?: number; page?: number };
export type CreateOrderInput = { currency_code: string; value: string; invoice_id?: string; custom_id?: string; request_id: string; payment_source?: Record<string, unknown> };

export interface PayPalClient {
  mode: 'mock' | 'sandbox';
  createRefund(input: CreateRefundInput): Promise<PayPalRefund>;
  createInvoice(input: CreateInvoiceInput): Promise<PayPalInvoice>;
  sendInvoice(input: SendInvoiceInput): Promise<PayPalInvoice>;
  createShipmentTracking(input: CreateShipmentInput): Promise<PayPalShipment>;
  listDisputes(input?: { page_size?: number; page?: number }): Promise<PayPalDispute[]>;
  getDispute(dispute_id: string): Promise<PayPalDispute>;
  acceptDisputeClaim(input: AcceptDisputeInput): Promise<{ dispute_id: string; status: string }>;
  listTransactions(input: ListTransactionsInput): Promise<PayPalTransaction[]>;
  createOrder(input: CreateOrderInput): Promise<PayPalOrder>;
  captureOrder(input: { id: string; request_id: string }): Promise<PayPalOrder>;
}
