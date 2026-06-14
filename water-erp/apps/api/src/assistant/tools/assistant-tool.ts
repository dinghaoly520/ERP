export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  cards?: Array<{
    type: 'metric' | 'chart' | 'table';
    title: string;
    [key: string]: unknown;
  }>;
  citations?: Array<{
    type: string;
    title: string;
    entityId: string;
  }>;
}

export interface AssistantTool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
