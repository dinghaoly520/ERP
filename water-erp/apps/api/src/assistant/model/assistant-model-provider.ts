export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ModelResponse {
  text: string;
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

export abstract class AssistantModelProvider {
  abstract chat(
    messages: ChatMessage[],
    options?: {
      temperature?: number;
      maxTokens?: number;
      tools?: Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      }>;
    },
  ): Promise<ModelResponse>;
}
