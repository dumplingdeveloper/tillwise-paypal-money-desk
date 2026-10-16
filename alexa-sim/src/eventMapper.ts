import type { SessionEvent } from '@github/copilot-sdk';

export type UiEvent = { type: string; data: Record<string, unknown> };

export function sanitizePlainText(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`+/g, '')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .trim();
}

export function hasToolRequests(message: unknown): boolean {
  const event = message && typeof message === 'object' ? message as Record<string, unknown> : {};
  const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : event;
  const direct = data.toolRequests || data.tool_requests || data.toolCalls || data.tool_calls;
  return Array.isArray(direct) ? direct.length > 0 : Boolean(direct);
}

export function assistantText(message: unknown): string {
  const event = message && typeof message === 'object' ? message as Record<string, unknown> : {};
  const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : event;
  return sanitizePlainText(String(data.content || data.text || data.message || ''));
}

export function mapSessionEvent(event: SessionEvent): UiEvent | null {
  switch (event.type) {
    case 'user.message':
      return { type: 'user_transcript', data: { text: (event.data as { content?: string }).content || '' } };
    case 'assistant.message_delta':
      return { type: 'assistant_delta', data: { text: (event.data as { deltaContent?: string }).deltaContent || '' } };
    case 'assistant.message': {
      const text = assistantText(event.data);
      return hasToolRequests(event.data) && text ? { type: 'interim', data: { text } } : null;
    }
    case 'tool.execution_start': {
      const d = event.data as { toolCallId: string; toolName: string; mcpToolName?: string; arguments?: unknown };
      return { type: 'tool_start', data: { id: d.toolCallId, name: d.mcpToolName || d.toolName, arguments: d.arguments } };
    }
    case 'tool.execution_complete': {
      const d = event.data as { toolCallId: string; success: boolean; result?: { structuredContent?: unknown; content?: string }; error?: { message?: string }; toolDescription?: unknown };
      return { type: 'tool_end', data: { id: d.toolCallId, success: d.success, structuredContent: d.result?.structuredContent, text: d.result?.content, error: d.error?.message } };
    }
    case 'session.skills_loaded':
      return { type: 'skills_loaded', data: { skills: (event.data as { skills?: unknown[] }).skills || [] } };
    case 'session.mcp_servers_loaded':
      return { type: 'mcp_servers_loaded', data: event.data as unknown as Record<string, unknown> };
    case 'mcp.tools.list_changed':
      return { type: 'mcp_tools_changed', data: event.data as unknown as Record<string, unknown> };
    case 'assistant.usage':
      return { type: 'usage', data: event.data as unknown as Record<string, unknown> };
    default:
      return null;
  }
}
