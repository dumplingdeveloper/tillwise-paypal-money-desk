import { subscribe } from 'node:diagnostics_channel';
import { appendFileSync } from 'node:fs';

/**
 * Counts every HTTP request this process sends to the PayPal sandbox, whether it goes through fetch (undici) or
 * through @paypal/paypal-server-sdk (axios → node:http). Set TILLWISE_PAYPAL_CALL_LOG=/path/file.jsonl to append one
 * line per request: time, method, host, path WITHOUT the query string, and a source label. Headers and bodies are
 * never read, so tokens and secrets cannot end up in the log. The responses go to a sibling file (`<name>.responses.jsonl`):
 * HTTP status and PayPal's `paypal-debug-id` response header only, so the request log stays one line per call.
 */
export const PAYPAL_SANDBOX_HOST = 'api-m.sandbox.paypal.com';
let installed = false;

export function installPayPalCallLog(options: { path?: string; source?: string; hosts?: string[] } = {}): boolean {
  const path = options.path ?? process.env.TILLWISE_PAYPAL_CALL_LOG;
  if (!path || installed) return false;
  installed = true;
  const hosts = new Set(options.hosts ?? [PAYPAL_SANDBOX_HOST]);
  const source = options.source ?? process.env.TILLWISE_PAYPAL_CALL_SOURCE ?? 'unknown';
  const write = (via: string, method: string, host: string, rawPath: string) => {
    const bare = host.replace(/:\d+$/, '');
    if (!hosts.has(bare) && !hosts.has(host)) return;
    try { appendFileSync(path, `${JSON.stringify({ t: new Date().toISOString(), source, via, method, host: bare, path: rawPath.split('?')[0] })}\n`); } catch { /* counting must never break a call */ }
  };
  const responsePath = path.replace(/\.jsonl$/, '') + '.responses.jsonl';
  const writeResponse = (via: string, method: string, host: string, rawPath: string, status: number, debugId: string) => {
    const bare = host.replace(/:\d+$/, '');
    if (!hosts.has(bare) && !hosts.has(host)) return;
    try { appendFileSync(responsePath, `${JSON.stringify({ t: new Date().toISOString(), source, via, method, host: bare, path: rawPath.split('?')[0], status, debug_id: debugId })}\n`); } catch { /* never break a call */ }
  };
  subscribe('undici:request:headers', (message) => {
    const { request, response } = message as { request?: { origin?: string | URL; method?: string; path?: string }; response?: { statusCode?: number; headers?: Array<Buffer | string> } };
    if (!request?.origin || !response) return;
    let debugId = '';
    const headers = response.headers || [];
    for (let i = 0; i + 1 < headers.length; i += 2) if (String(headers[i]).toLowerCase() === 'paypal-debug-id') debugId = String(headers[i + 1]);
    writeResponse('fetch', String(request.method || 'GET'), new URL(String(request.origin)).host, String(request.path || '/'), Number(response.statusCode || 0), debugId);
  });
  subscribe('http.client.response.finish', (message) => {
    const { request, response } = message as { request?: { method?: string; host?: string; path?: string }; response?: { statusCode?: number; headers?: Record<string, unknown> } };
    if (!request || !response) return;
    writeResponse('node:http', String(request.method || 'GET'), String(request.host || ''), String(request.path || '/'), Number(response.statusCode || 0), String(response.headers?.['paypal-debug-id'] || ''));
  });
  subscribe('undici:request:create', (message) => {
    const request = (message as { request?: { origin?: string | URL; method?: string; path?: string } }).request;
    if (!request?.origin) return;
    write('fetch', String(request.method || 'GET'), new URL(String(request.origin)).host, String(request.path || '/'));
  });
  subscribe('http.client.request.start', (message) => {
    const request = (message as { request?: { method?: string; host?: string; path?: string; getHeader?: (name: string) => unknown } }).request;
    if (!request) return;
    write('node:http', String(request.method || 'GET'), String(request.host || request.getHeader?.('host') || ''), String(request.path || '/'));
  });
  return true;
}
