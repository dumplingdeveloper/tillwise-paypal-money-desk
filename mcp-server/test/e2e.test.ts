import { createServer as createNetServer, type AddressInfo } from 'node:net';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../src/server.js';

function loadEnv() {
  const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
  const path = join(root, 'mcp-server', '.env');
  const env: Record<string, string> = {};
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) env[match[1]] = match[2];
    }
  }
  return { root, env };
}

function wpEval(root: string, code: string): string {
  return execFileSync('docker', ['compose', 'exec', '-T', 'cli', 'wp', 'eval', code, '--allow-root'], { cwd: root, encoding: 'utf8', timeout: 20000 }).trim();
}

async function wcRegularPrice(env: Record<string, string>, productId: number): Promise<number> {
  const token = Buffer.from(`${env.WP_USERNAME}:${env.WP_APPLICATION_PASSWORD}`).toString('base64');
  const response = await fetch(`${env.WP_BASE_URL}/wp-json/wc/v3/products/${productId}`, { headers: { authorization: `Basic ${token}` } });
  assert.equal(response.status, 200);
  const product = await response.json() as { regular_price: string };
  return Number(product.regular_price);
}

async function freePort(): Promise<string> {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return String(port);
}

test('MCP live preview apply undo flow negotiates 2025-11-25', { timeout: 120000 }, async () => {
  const { root, env } = loadEnv();
  if (!env.WP_APPLICATION_PASSWORD) throw new Error('Run scripts/seed-local.sh before npm test so mcp-server/.env exists.');
  // A free ephemeral port (3338 + random collided with a running MCP server on 3338/3339/3348).
  const port = await freePort();
  const started = await startHttpServer({ ...process.env, ...env, MCP_PORT: port, MCP_HOST: '127.0.0.1' });
  try {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    const client = new Client({ name: 'tillwise-e2e', version: '0.1.0' }, { capabilities: {} });
    await client.connect(transport);
    console.log(`Negotiated protocol version: ${transport.protocolVersion}`);
    assert.equal(transport.protocolVersion, '2025-11-25');

    console.log('E2E: listing tools');
    const tools = await client.listTools();
    const byName = new Map(tools.tools.map((tool) => [tool.name, tool]));
    assert.equal(byName.get('sales_summary')?.annotations?.readOnlyHint, true);
    assert.equal(byName.get('price_change_apply')?.annotations?.destructiveHint, true);
    assert.ok(byName.get('price_change_preview')?.inputSchema);
    assert.ok(byName.get('price_change_preview')?.outputSchema);
    assert.equal(byName.get('paypal_money_briefing')?.annotations?.readOnlyHint, true);
    assert.equal(byName.get('paypal_refund_apply')?.annotations?.destructiveHint, true);
    assert.ok(byName.get('paypal_refund_preview')?.inputSchema);
    assert.ok(byName.get('paypal_refund_apply')?.outputSchema);

    const paypalBriefing = await client.callTool({ name: 'paypal_money_briefing', arguments: {} });
    assert.equal((paypalBriefing.structuredContent as { data: { mode: string } }).data.mode, 'mock');

    console.log('E2E: resolving product');
    const productId = Number(wpEval(root, "$p=get_posts(array('post_type'=>'product','title'=>'Midnight Espresso Mug','post_status'=>'any','numberposts'=>1,'fields'=>'ids')); echo $p[0];"));
    const original = await wcRegularPrice(env, productId);

    console.log('E2E: preview');
    const preview = await client.callTool({ name: 'price_change_preview', arguments: { target: { product_ids: [productId] }, change_type: 'percent_decrease', amount: 10, price_field: 'regular' } });
    const previewContent = preview.structuredContent as { data: { preview_id: string; changes: Array<{ new: number }> } };
    assert.equal(await wcRegularPrice(env, productId), original);

    console.log('E2E: apply');
    const apply = await client.callTool({ name: 'price_change_apply', arguments: { preview_id: previewContent.data.preview_id } });
    const applyContent = apply.structuredContent as { data: { history_id: string; applied_count: number } };
    assert.equal(applyContent.data.applied_count, 1);
    assert.equal(await wcRegularPrice(env, productId), previewContent.data.changes[0].new);

    console.log('E2E: undo');
    const undo = await client.callTool({ name: 'price_change_undo', arguments: { history_id: applyContent.data.history_id } });
    const undoContent = undo.structuredContent as { data: { restored_count: number } };
    assert.equal(undoContent.data.restored_count, 1);
    assert.equal(await wcRegularPrice(env, productId), original);

    await client.close();
  } finally {
    await new Promise<void>((resolve) => started.httpServer.close(() => resolve()));
    await started.mcp.close();
  }
});
