import type { PermissionHandler, PermissionRequest, PermissionRequestResult } from '@github/copilot-sdk';
import { MCP_SERVER_KEY } from './config.js';

export const AUTO_APPROVED_TOOLS = new Set(['store_briefing','sales_summary','low_stock','price_change_preview','price_change_history','guardrails_get']);
export const HUMAN_GATED_TOOLS = new Set(['price_change_apply','price_change_undo','guardrails_update']);
export const ALLOWED_SKILLS = new Set(['woocommerce-daily-briefing', 'woocommerce-safe-price-changes']);

export function classifyConfirmationReply(text: string): 'yes' | 'no' | 'unknown' {
  const value = text.trim().toLowerCase().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ');
  if (/^(yes|yes please|yeah|yeah go ahead|yep|sure|sure thing|ok|okay|do it|go ahead|confirm|apply)( please)?$/.test(value)) return 'yes';
  if (/^(no|nope|no thanks|no thank you|don't|do not|cancel|stop|deny|not now)$/.test(value)) return 'no';
  return 'unknown';
}

export type ConfirmationView = { question: string; summary?: string; card?: Record<string, unknown> };
export type PendingConfirmation = { id: string; toolName: string; arguments: unknown; message: string; summary?: string; card?: Record<string, unknown>; resolve: (approved: boolean) => void; createdAt: number; timer: NodeJS.Timeout };

export class ConfirmationBroker {
  private pending = new Map<string, PendingConfirmation>();
  constructor(private readonly emit: (event: unknown) => void = () => {}, private readonly timeoutMs = 120_000) {}

  request(toolName: string, args: unknown, view?: ConfirmationView): Promise<boolean> {
    const id = crypto.randomUUID();
    const message = view?.question || `Do you want me to ${toolName.replace(/_/g, ' ')}?`;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.decide(id, false, 'timeout'), this.timeoutMs);
      const pending = { id, toolName, arguments: args, message, summary: view?.summary, card: view?.card, resolve, createdAt: Date.now(), timer };
      this.pending.set(id, pending);
      this.emit({ type: 'permission', data: { id, toolName, arguments: args, message, summary: view?.summary, card: view?.card, timeoutMs: this.timeoutMs } });
    });
  }

  decide(id: string, approved: boolean, reason: 'owner' | 'timeout' = 'owner'): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(approved);
    this.emit({ type: 'permission_resolved', data: { id, approved, reason } });
    return true;
  }

  firstPending(): Omit<PendingConfirmation, 'resolve' | 'timer'> | undefined {
    const pending = this.pending.values().next().value as PendingConfirmation | undefined;
    if (!pending) return undefined;
    const { resolve: _resolve, timer: _timer, ...rest } = pending;
    return rest;
  }

  list(): Omit<PendingConfirmation, 'resolve' | 'timer'>[] {
    return [...this.pending.values()].map(({ resolve: _resolve, timer: _timer, ...rest }) => rest);
  }
}

export function normalizeToolName(toolName?: string): string | undefined {
  if (!toolName) return undefined;
  const unprefixed = toolName.startsWith(`${MCP_SERVER_KEY}-`) ? toolName.slice(MCP_SERVER_KEY.length + 1) : toolName;
  return unprefixed.replace(/-/g, '_');
}

export function extractMcpTool(request: PermissionRequest): { serverName?: string; toolName?: string; args?: unknown; kind: string } {
  const req = request as PermissionRequest & { kind: string; serverName?: string; toolName?: string; name?: string; args?: unknown; arguments?: unknown };
  return { kind: req.kind, serverName: req.serverName, toolName: normalizeToolName(req.toolName || req.name), args: req.args || req.arguments };
}

function skillNameFromArgs(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  return String(record.skill || record.name || record.skillName || record.commandName || '');
}

export function decidePermission(request: PermissionRequest, approvedByHuman?: boolean): PermissionRequestResult {
  const { kind, serverName, toolName, args } = extractMcpTool(request);
  if (toolName === 'skill') {
    const skill = skillNameFromArgs(args);
    return !skill || ALLOWED_SKILLS.has(skill)
      ? { kind: 'approve-once' }
      : { kind: 'reject', feedback: 'Only the Tillwise Agent Skills may be loaded in this simulator.' };
  }
  if (kind !== 'mcp' || serverName !== MCP_SERVER_KEY || !toolName) return { kind: 'reject', feedback: 'Only Tillwise MCP tools are allowed in this simulator.' };
  if (AUTO_APPROVED_TOOLS.has(toolName)) return { kind: 'approve-once' };
  if (HUMAN_GATED_TOOLS.has(toolName)) return approvedByHuman ? { kind: 'approve-once', approvedInteractively: true } : { kind: 'reject', feedback: 'The owner did not confirm this store-changing action. Do not claim anything was changed.' };
  return { kind: 'reject', feedback: 'This MCP tool is not on the simulator allow-list.' };
}

export function createPermissionHandler(broker: ConfirmationBroker, describe?: (toolName: string, args: unknown) => ConfirmationView | undefined): PermissionHandler {
  return async (request) => {
    const { kind, serverName, toolName, args } = extractMcpTool(request);
    if (kind === 'mcp' && serverName === MCP_SERVER_KEY && toolName && HUMAN_GATED_TOOLS.has(toolName)) {
      const approved = await broker.request(toolName, args, describe?.(toolName, args));
      return decidePermission(request, approved);
    }
    return decidePermission(request);
  };
}
