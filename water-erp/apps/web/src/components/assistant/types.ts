// ---- Conversation ----

export type Conversation = {
  id: string;
  title: string;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

export type AssistantCard =
  | { type: 'table'; title: string; columns: Array<{ key: string; label: string }>; rows: unknown[]; viz?: VizDeclaration }
  | { type: 'chart'; title: string; chartType: string; option: Record<string, unknown>; caption?: string }
  | { type: 'metric'; title: string; value: string; trend?: string };

export type VizDeclaration = {
  kind: string;
  category?: string;
  value: string;
  timeField?: string;
  seriesField?: string;
  topN?: number;
};

export type AssistantCitation = {
  type: string;
  title: string;
  entityId: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolCalls: unknown;
  toolResult: unknown;
  actions: AssistantAction[] | null;
  cards?: AssistantCard[] | null;
  citations?: AssistantCitation[] | null;
  createdAt: string;
};

// ---- Actions returned by tools ----

export type AssistantAction =
  | { type: 'navigate'; label: string; path: string }
  | { type: 'chart'; chartType: string; title: string; labels: string[]; values: number[]; subtitle?: string; cards?: Array<{ label: string; value: string | number; unit?: string; trend?: string }> }
  | { type: 'suggestions'; items: string[] };

// ---- SSE events ----

export type SseTokenEvent = { content: string };
export type SseToolCallEvent = { tool: string; args: Record<string, unknown> };
export type SseToolResultEvent = { tool: string; result: unknown; success: boolean };
export type SseActionEvent = AssistantAction;
export type SseDoneEvent = { message_id: string };
export type SseErrorEvent = { message: string };

// ---- Context ----

export type AssistantPageContext = {
  currentPage: string;
  currentModule: string;
  selectedItemId?: string;
  selectedItemType?: string;
  selectedItemData?: Record<string, unknown>;
  userRole?: string;
};

// ---- Chat state ----

export type ChatState = {
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingContent: string;
  streamingActions: AssistantAction[];
  error: string | null;
};
