export type BridgeEvent = { type: string; [key: string]: unknown };
export type BridgeInput = { messages: Array<{ role: string; content?: string; toolCallId?: string }>; prompt?: string };
export type BridgePlanner = (prompt: string, signal?: AbortSignal) => Promise<{ tool?: { name: string; args: Record<string, unknown> }; text?: string }>;

export async function* runBridgeRound(input: BridgeInput, planner: BridgePlanner, signal?: AbortSignal): AsyncIterable<BridgeEvent> {
  try {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const toolResult = input.messages.find((message) => message.role === 'tool');
    const messageId = `msg-${Date.now()}`;
    if (toolResult) {
      yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' };
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: `Done: ${toolResult.content || 'Studio tool completed'}` };
      yield { type: 'TEXT_MESSAGE_END', messageId };
      return;
    }
    const plan = await planner(input.prompt || input.messages.at(-1)?.content || '', signal);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (plan.tool) {
      const toolCallId = `call-${Date.now()}`;
      yield { type: 'TOOL_CALL_START', toolCallId, toolCallName: plan.tool.name };
      yield { type: 'TOOL_CALL_ARGS', toolCallId, delta: JSON.stringify(plan.tool.args) };
      yield { type: 'TOOL_CALL_END', toolCallId };
      return;
    }
    yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' };
    for (const chunk of (plan.text || 'No Studio change requested.').match(/.{1,32}/g) || []) yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: chunk };
    yield { type: 'TEXT_MESSAGE_END', messageId };
  } catch (error) {
    yield { type: 'RUN_ERROR', message: error instanceof Error ? error.message : String(error) };
  }
}
