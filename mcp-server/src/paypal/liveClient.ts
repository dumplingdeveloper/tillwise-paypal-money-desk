import { Client, Environment, OrdersController, PaymentsController, TransactionSearchController, type OAuthToken } from '@paypal/paypal-server-sdk';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { PayPalApiError, type AcceptDisputeInput, type CreateInvoiceInput, type CreateOrderInput, type CreateRefundInput, type CreateShipmentInput, type ListTransactionsInput, type PayPalClient, type PayPalDispute, type PayPalInvoice, type PayPalOrder, type PayPalRefund, type PayPalShipment, type PayPalTransaction, type SendInvoiceInput } from './types.js';

type LiveOptions = { clientId: string; clientSecret: string; sandbox?: boolean; fetchImpl?: typeof fetch; sdkAdapter?: unknown };
type Token = { accessToken: string; expiresAt: number };

export function readSandboxCredentials(path = join(homedir(), '.config', 'tillwise', 'paypal-sandbox.env')): { clientId: string; clientSecret: string } | null {
  if (!existsSync(path)) return null;
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET ? { clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET } : null;
}

export class LivePayPalClient implements PayPalClient {
  readonly mode = 'live' as const;
  private readonly fetchImpl: typeof fetch;
  private token?: Token;
  private readonly baseUrl: string;
  private readonly sdkClient: Client;
  private readonly orders: OrdersController;
  private readonly payments: PaymentsController;
  private readonly txns: TransactionSearchController;

  constructor(private readonly options: LiveOptions) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.baseUrl = options.sandbox === false ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    this.sdkClient = new Client({
      environment: options.sandbox === false ? Environment.Production : Environment.Sandbox,
      timeout: 30_000,
      clientCredentialsAuthCredentials: {
        oAuthClientId: options.clientId,
        oAuthClientSecret: options.clientSecret,
        oAuthTokenProvider: async () => this.sdkToken(),
        oAuthClockSkew: 60,
      },
      unstable_httpClientOptions: options.sdkAdapter ? { adapter: options.sdkAdapter } : undefined,
      httpClientOptions: { retryConfig: { maxNumberOfRetries: 2, maximumRetryWaitTime: 10, retryInterval: 1, httpStatusCodesToRetry: [408, 429, 500, 502, 503, 504], httpMethodsToRetry: ['GET', 'POST', 'PUT'] } },
    });
    this.orders = new OrdersController(this.sdkClient);
    this.payments = new PaymentsController(this.sdkClient);
    this.txns = new TransactionSearchController(this.sdkClient);
  }

  private async sdkToken(): Promise<OAuthToken> {
    const token = await this.getAccessToken();
    return { accessToken: token.accessToken, tokenType: 'Bearer', expiry: BigInt(Math.floor(token.expiresAt / 1000)) };
  }

  private async getAccessToken(): Promise<Token> {
    if (this.token && this.token.expiresAt - Date.now() > 60_000) return this.token;
    const auth = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64');
    const response = await this.fetchImpl(`${this.baseUrl}/v1/oauth2/token`, { method: 'POST', headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: 'grant_type=client_credentials' });
    const json = await response.json() as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !json.access_token) throw new PayPalApiError({ name: 'OAUTH_ERROR', message: json.error_description || 'PayPal OAuth failed', debug_id: response.headers.get('paypal-debug-id') || 'oauth' }, response.status);
    this.token = { accessToken: json.access_token, expiresAt: Date.now() + Math.max(60, Number(json.expires_in || 300)) * 1000 };
    return this.token;
  }

  private async paypalFetch<T>(path: string, init: RequestInit & { requestId?: string } = {}, attempt = 0): Promise<T> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers || {});
    headers.set('authorization', `Bearer ${token.accessToken}`);
    headers.set('accept', 'application/json');
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (init.requestId) headers.set('PayPal-Request-Id', init.requestId);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    if ((response.status === 401 || response.status === 429 || response.status >= 500) && attempt < 2) {
      if (response.status === 401) this.token = undefined;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      return this.paypalFetch<T>(path, init, attempt + 1);
    }
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const envelope = json?.name ? json : { name: 'PAYPAL_HTTP_ERROR', message: response.statusText || 'PayPal API error', debug_id: response.headers.get('paypal-debug-id') || 'unknown' };
      throw new PayPalApiError(envelope, response.status);
    }
    return json as T;
  }

  private async sdkCall<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      const maybe = err as { statusCode?: number; status?: number; result?: unknown; body?: unknown; message?: string; headers?: Record<string, string> };
      let envelope = maybe.result as Record<string, unknown> | undefined;
      if (!envelope && typeof maybe.body === 'string') {
        try { envelope = JSON.parse(maybe.body) as Record<string, unknown>; } catch { envelope = undefined; }
      }
      const debugId = envelope?.debug_id || envelope?.debugId || maybe.headers?.['paypal-debug-id'];
      throw new PayPalApiError({
        name: String(envelope?.name || 'PAYPAL_SDK_ERROR'),
        message: String(envelope?.message || maybe.message || 'PayPal SDK call failed'),
        debug_id: debugId ? String(debugId) : 'unknown',
        details: envelope?.details as never,
      }, Number(maybe.statusCode || maybe.status || 500));
    }
  }

  async createRefund(input: CreateRefundInput): Promise<PayPalRefund> {
    const sdkAmount = input.amount ? { currencyCode: input.amount.currency_code, value: input.amount.value } : undefined;
    const response = await this.sdkCall(() => this.payments.refundCapturedPayment({ captureId: input.capture_id, paypalRequestId: input.request_id, prefer: 'return=representation', body: { amount: sdkAmount, invoiceId: input.invoice_id, noteToPayer: input.note_to_payer } as never }));
    const result = response.result as Record<string, unknown>;
    const resultAmount = result.amount as { currencyCode?: string; currency_code?: string; value?: string } | undefined;
    return { id: String(result.id), status: String(result.status || 'UNKNOWN'), amount: { currency_code: String(resultAmount?.currency_code || resultAmount?.currencyCode || input.amount?.currency_code || 'EUR'), value: String(resultAmount?.value || input.amount?.value || '0.00') }, capture_id: input.capture_id };
  }

  async createInvoice(input: CreateInvoiceInput): Promise<PayPalInvoice> {
    return this.paypalFetch<PayPalInvoice>('/v2/invoicing/invoices', { method: 'POST', requestId: input.request_id, headers: { Prefer: 'return=representation' }, body: JSON.stringify({ detail: { currency_code: input.currency_code, invoice_number: input.invoice_number, note: input.note }, primary_recipients: input.primary_recipients, items: input.items }) });
  }
  async sendInvoice(input: SendInvoiceInput): Promise<PayPalInvoice> {
    return this.paypalFetch<PayPalInvoice>(`/v2/invoicing/invoices/${encodeURIComponent(input.invoice_id)}/send`, { method: 'POST', requestId: input.request_id, body: JSON.stringify({ note: input.note, send_to_recipient: input.send_to_recipient ?? true }) });
  }
  async createShipmentTracking(input: CreateShipmentInput): Promise<PayPalShipment> {
    const body = { trackers: [{ transaction_id: input.transaction_id, tracking_number: input.tracking_number, status: input.status, carrier: input.carrier }] };
    const response = await this.paypalFetch<{ tracker_identifiers?: Array<{ transaction_id?: string; tracking_number?: string; links?: unknown[] }> }>('/v1/shipping/trackers-batch', { method: 'POST', requestId: input.request_id, body: JSON.stringify(body) });
    return { id: `${input.transaction_id}-${input.tracking_number || 'NO_TRACKING'}`, status: input.status, transaction_id: input.transaction_id, tracking_number: input.tracking_number, carrier: input.carrier, ...response.tracker_identifiers?.[0] };
  }
  async listDisputes(input: { page_size?: number; page?: number } = {}): Promise<PayPalDispute[]> {
    const params = new URLSearchParams(); if (input.page_size) params.set('page_size', String(input.page_size)); if (input.page) params.set('page', String(input.page));
    const response = await this.paypalFetch<{ items?: PayPalDispute[] }>(`/v1/customer/disputes?${params}`);
    return response.items || [];
  }
  async getDispute(dispute_id: string): Promise<PayPalDispute> { return this.paypalFetch<PayPalDispute>(`/v1/customer/disputes/${encodeURIComponent(dispute_id)}`); }
  async acceptDisputeClaim(input: AcceptDisputeInput): Promise<{ dispute_id: string; status: string }> {
    await this.paypalFetch(`/v1/customer/disputes/${encodeURIComponent(input.dispute_id)}/accept-claim`, { method: 'POST', requestId: input.request_id, body: JSON.stringify({ note: input.note }) });
    return { dispute_id: input.dispute_id, status: 'ACCEPTED' };
  }
  async listTransactions(input: ListTransactionsInput): Promise<PayPalTransaction[]> {
    const response = await this.sdkCall(() => this.txns.searchTransactions({ startDate: input.start_date, endDate: input.end_date, transactionId: input.transaction_id, pageSize: input.page_size, page: input.page }));
    return ((response.result as Record<string, unknown>).transactionDetails as PayPalTransaction[]) || ((response.result as Record<string, unknown>).transaction_details as PayPalTransaction[]) || [];
  }
  async createOrder(input: CreateOrderInput): Promise<PayPalOrder> {
    const response = await this.sdkCall(() => this.orders.createOrder({ paypalRequestId: input.request_id, prefer: 'return=representation', body: { intent: 'CAPTURE', purchaseUnits: [{ invoiceId: input.invoice_id, customId: input.custom_id, amount: { currencyCode: input.currency_code, value: input.value } }], paymentSource: input.payment_source } as never }));
    return response.result as PayPalOrder;
  }
  async captureOrder(input: { id: string; request_id: string }): Promise<PayPalOrder> {
    const response = await this.sdkCall(() => this.orders.captureOrder({ id: input.id, paypalRequestId: input.request_id, prefer: 'return=representation' }));
    return response.result as PayPalOrder;
  }
}
