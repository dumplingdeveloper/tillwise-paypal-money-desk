import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startHttpServer } from '../src/server.js';

function request(port: string, headers: Record<string, string> = {}) {
  return new Promise<{status: number; body: string}>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'security-test', version: '0.1.0' } } }));
  });
}

test('DNS rebinding protection rejects non-allowed Host and Origin', { timeout: 30000 }, async () => {
  const port = String(3500 + Math.floor(Math.random() * 100));
  const started = await startHttpServer({ MCP_HOST: '127.0.0.1', MCP_PORT: port, WP_BASE_URL: 'http://127.0.0.1:8098', WP_USERNAME: 'x', WP_APPLICATION_PASSWORD: 'x' });
  try {
    assert.equal((await request(port, { Host: 'evil.example' })).status, 403);
    assert.equal((await request(port, { Origin: 'http://evil.example' })).status, 403);
  } finally {
    await new Promise<void>((resolve) => started.httpServer.close(() => resolve()));
    await started.mcp.close();
  }
});

test('optional bearer token rejects missing or wrong tokens', { timeout: 30000 }, async () => {
  const port = String(3600 + Math.floor(Math.random() * 100));
  const started = await startHttpServer({ MCP_HOST: '127.0.0.1', MCP_PORT: port, MCP_AUTH_TOKEN: 'secret', WP_BASE_URL: 'http://127.0.0.1:8098', WP_USERNAME: 'x', WP_APPLICATION_PASSWORD: 'x' });
  try {
    assert.equal((await request(port)).status, 401);
    assert.equal((await request(port, { authorization: 'Bearer wrong' })).status, 401);
  } finally {
    await new Promise<void>((resolve) => started.httpServer.close(() => resolve()));
    await started.mcp.close();
  }
});
