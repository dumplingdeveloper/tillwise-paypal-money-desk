import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolSet } from '@github/copilot-sdk';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PROJECT_ROOT = resolve(ROOT, '..');
export const SKILLS_DIR = resolve(PROJECT_ROOT, 'skills');
export const PUBLIC_DIR = resolve(PROJECT_ROOT, 'alexa-sim', 'public');
export const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'alexa-sim', 'screenshots');

export const MCP_SERVER_KEY = 'tillwise';
export const MCP_TOOLS = [
  'store_briefing',
  'sales_summary',
  'low_stock',
  'price_change_preview',
  'price_change_apply',
  'price_change_undo',
  'price_change_history',
  'guardrails_get',
  'guardrails_update',
  'paypal_money_briefing',
  'paypal_refund_preview',
  'paypal_refund_apply',
  'paypal_invoice_create_preview',
  'paypal_invoice_create_apply',
  'paypal_invoice_send_apply',
  'paypal_tracking_add_apply',
  'paypal_disputes_list',
  'paypal_dispute_get',
  'paypal_dispute_accept_claim_preview',
  'paypal_dispute_accept_claim_apply',
  'paypal_guardrail_refusal',
] as const;
export type McpToolName = typeof MCP_TOOLS[number];
export const RUNTIME_MCP_TOOLS = MCP_TOOLS.map((name) => `${MCP_SERVER_KEY}-${name}`);
export const MCP_ALLOWLIST = RUNTIME_MCP_TOOLS.map((name) => `mcp:${name}`);
export const BUILTIN_ALLOWLIST = ['builtin:skill'] as const;
export const TOOL_ALLOWLIST = [...MCP_ALLOWLIST, ...BUILTIN_ALLOWLIST];

export function buildToolSet(): ToolSet {
  const set = new ToolSet();
  for (const tool of RUNTIME_MCP_TOOLS) set.addMcp(tool);
  set.addBuiltIn('skill');
  return set;
}

export function readEnvFile(path: string): Record<string, string> {
  try {
    const text = readFileSync(path, 'utf8');
    return Object.fromEntries(text.split(/\r?\n/).map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((match) => [match![1], match![2]]));
  } catch {
    return {};
  }
}
