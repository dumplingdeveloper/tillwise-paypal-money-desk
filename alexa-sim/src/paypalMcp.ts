import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** The only PayPal MCP tools the Money Desk (page data and Studio agent) may call. None of them moves money. */
export const READ_ONLY_PAYPAL_TOOLS = ['paypal_ledger_export', 'paypal_refund_anomaly', 'paypal_money_briefing', 'paypal_disputes_list', 'paypal_dispute_get'] as const;
export type ReadOnlyPayPalTool = typeof READ_ONLY_PAYPAL_TOOLS[number];

export type McpToolInfo = { name: string; description?: string; inputSchema?: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };
export type PayPalReadClient = {
  callReadOnly(name: string, args?: Record<string, unknown>): Promise<{ speech: string; data: Record<string, unknown> }>;
  listReadOnlyTools(): Promise<McpToolInfo[]>;
  close(): Promise<void>;
};

/** A tool-level error reported by the MCP server (not a transport failure); never retried. */
export class McpToolError extends Error {}

export function isReadOnlyPayPalTool(name: string): name is ReadOnlyPayPalTool {
  return (READ_ONLY_PAYPAL_TOOLS as readonly string[]).includes(name);
}

/**
 * MCP client for the Tillwise MCP server (mcp-server/, default http://127.0.0.1:3338/mcp).
 * It refuses any tool outside READ_ONLY_PAYPAL_TOOLS, and also refuses a listed tool unless the
 * server itself annotates it readOnlyHint: true.
 */
export class PayPalMcpReadClient implements PayPalReadClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private tools: McpToolInfo[] | null = null;

  /** url/token default to MCP_URL / MCP_AUTH_TOKEN, read at connect time (after .env files are loaded). */
  constructor(private readonly options: { url?: string; token?: string } = {}) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        const headers: Record<string, string> = {};
        const token = this.options.token ?? process.env.MCP_AUTH_TOKEN;
        if (token) headers.authorization = `Bearer ${token}`;
        const client = new Client({ name: 'tillwise-money-desk', version: '0.1.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL(this.options.url || process.env.MCP_URL || 'http://127.0.0.1:3338/mcp'), { requestInit: { headers } }));
        this.client = client;
        return client;
      })().finally(() => { this.connecting = null; });
    }
    return this.connecting;
  }

  async listReadOnlyTools(): Promise<McpToolInfo[]> {
    if (!this.tools) {
      const client = await this.connect();
      const { tools } = await client.listTools();
      this.tools = (tools as McpToolInfo[]).filter((tool) => isReadOnlyPayPalTool(tool.name) && tool.annotations?.readOnlyHint === true);
    }
    return this.tools;
  }

  async callReadOnly(name: string, args: Record<string, unknown> = {}) {
    if (!isReadOnlyPayPalTool(name)) throw new Error(`Refused: ${name} is not a read-only PayPal tool.`);
    try {
      return await this.callOnce(name, args);
    } catch (error) {
      if (error instanceof McpToolError || /^Refused:/.test((error as Error).message)) throw error;
      // The MCP server may have restarted (stale session) or been briefly unreachable: reconnect once, then give up.
      await this.close();
      return this.callOnce(name, args);
    }
  }

  private async callOnce(name: string, args: Record<string, unknown>) {
    const tools = await this.listReadOnlyTools();
    if (!tools.some((tool) => tool.name === name)) throw new Error(`Refused: MCP server does not advertise ${name} as readOnlyHint.`);
    const client = await this.connect();
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      const text = Array.isArray(result.content) ? result.content.map((c) => (c as { text?: string }).text || '').join(' ') : '';
      throw new McpToolError(`MCP ${name} failed: ${text || 'unknown error'}`);
    }
    const structured = result.structuredContent as { speech?: string; data?: Record<string, unknown> } | undefined;
    return { speech: String(structured?.speech || ''), data: structured?.data || {} };
  }

  async close() {
    const client = this.client;
    this.client = null; this.tools = null;
    if (client) await client.close().catch(() => {});
  }
}
