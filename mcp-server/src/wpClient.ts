export type AbilityResult = { speech: string; data: Record<string, unknown> };

const READONLY_ABILITIES = new Set(['store-briefing', 'sales-summary', 'low-stock', 'price-change-preview', 'price-change-history', 'guardrails-get', 'paypal-order-context', 'paypal-audit-list']);

function appendInput(searchParams: URLSearchParams, prefix: string, value: unknown) {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendInput(searchParams, `${prefix}[${index}]`, item));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      appendInput(searchParams, `${prefix}[${key}]`, child);
    }
    return;
  }
  searchParams.append(prefix, String(value));
}

export class WpAbilityClient {
  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly applicationPassword: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async run(ability: string, input: Record<string, unknown> = {}): Promise<AbilityResult> {
    const url = new URL(`/wp-json/wp-abilities/v1/abilities/tillwise-store/${ability}/run`, this.baseUrl);
    const token = Buffer.from(`${this.username}:${this.applicationPassword}`).toString('base64');
    const method = READONLY_ABILITIES.has(ability) ? 'GET' : 'POST';
    const headers: Record<string, string> = { authorization: `Basic ${token}`, accept: 'application/json' };
    const init: RequestInit = { method, headers };
    if (method === 'GET') {
      if (Object.keys(input).length > 0) appendInput(url.searchParams, 'input', input);
    } else {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify({ input });
    }
    const response = await this.fetchImpl(url, init);
    const text = await response.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { speech: text, data: {} }; }
    if (!response.ok) {
      const message = typeof payload === 'object' && payload && 'message' in payload ? String((payload as {message?: unknown}).message) : response.statusText;
      throw new Error(`WordPress ability ${ability} failed (${response.status}): ${message}`);
    }
    if (!payload || typeof payload !== 'object' || !('speech' in payload)) {
      throw new Error(`WordPress ability ${ability} returned an invalid response`);
    }
    return payload as AbilityResult;
  }
}
