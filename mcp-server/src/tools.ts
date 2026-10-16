import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WpAbilityClient, type AbilityResult } from './wpClient.js';

const outputSchema = z.object({
  speech: z.string(),
  data: z.record(z.string(), z.unknown()),
});

const targetSchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  product_ids: z.array(z.number().int()).optional(),
  limit: z.number().int().positive().optional(),
});

const previewInput = z.object({
  target: targetSchema,
  change_type: z.enum(['percent_decrease', 'percent_increase', 'fixed_decrease', 'fixed_increase', 'set_price']),
  amount: z.number(),
  price_field: z.enum(['regular', 'sale']).optional(),
  sale_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  rounding: z.enum(['decimals', 'nearest_99']).optional(),
});

function toolResult(result: AbilityResult) {
  return {
    content: [{ type: 'text' as const, text: result.speech }],
    structuredContent: result,
  };
}

export function registerTillwiseTools(server: McpServer, wp: Pick<WpAbilityClient, 'run'>) {
  server.registerTool('store_briefing', {
    title: 'Store briefing',
    description: 'Brief the owner on today sales, same-weekday comparison, waiting orders, low stock, and sales ending soon.',
    inputSchema: z.object({}),
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => toolResult(await wp.run('store-briefing', {})));

  server.registerTool('sales_summary', {
    title: 'Sales summary',
    description: 'Summarize WooCommerce sales for today, yesterday, last 7 days, or this month.',
    inputSchema: z.object({ period: z.enum(['today', 'yesterday', 'last_7_days', 'this_month']).default('today') }),
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (args) => toolResult(await wp.run('sales-summary', args)));

  server.registerTool('low_stock', {
    title: 'Low stock',
    description: 'List products that are at or below their WooCommerce low-stock threshold.',
    inputSchema: z.object({}),
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => toolResult(await wp.run('low-stock', {})));

  server.registerTool('price_change_preview', {
    title: 'Price change preview',
    description: 'Preview a guarded price change and store the exact proposed writes on the server.',
    inputSchema: previewInput,
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
  }, async (args) => toolResult(await wp.run('price-change-preview', args)));

  server.registerTool('price_change_apply', {
    title: 'Apply price change',
    description: 'Apply exactly a valid server-side preview id, skipping products that changed since preview.',
    inputSchema: z.object({ preview_id: z.string().min(1) }),
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async (args) => toolResult(await wp.run('price-change-apply', args)));

  server.registerTool('price_change_undo', {
    title: 'Undo price change',
    description: 'Undo a persisted price-change history item with conflict detection.',
    inputSchema: z.object({ history_id: z.string().min(1) }),
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  }, async (args) => toolResult(await wp.run('price-change-undo', args)));

  server.registerTool('price_change_history', {
    title: 'Price change history',
    description: 'Read persisted applied price-change history.',
    inputSchema: z.object({}),
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => toolResult(await wp.run('price-change-history', {})));

  server.registerTool('guardrails_get', {
    title: 'Get guardrails',
    description: 'Read persistent server-enforced owner guardrails for price changes.',
    inputSchema: z.object({}),
    outputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async () => toolResult(await wp.run('guardrails-get', {})));

  server.registerTool('guardrails_update', {
    title: 'Update guardrails',
    description: 'Update persistent server-enforced owner guardrails for price changes.',
    inputSchema: z.object({
      min_price: z.number().nonnegative().optional(),
      max_discount_percent: z.number().min(0).max(100).optional(),
      max_items_per_preview: z.number().int().positive().max(500).optional(),
      allow_regular_price_increase: z.boolean().optional(),
    }),
    outputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  }, async (args) => toolResult(await wp.run('guardrails-update', args)));
}
