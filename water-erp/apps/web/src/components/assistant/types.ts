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
  /* metrics 数组形状（cockpit summary 卡）：2026-11-04 审查——旧单值 value 形状保留兼容 */
  | { type: 'metric'; title: string; value: string; trend?: string; metrics?: Array<{ label: string; value: string }> };

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
  role: 'user' | 'assistant';
  content: string;
  cards?: AssistantCard[] | null;
  createdAt: string;
};

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
  error: string | null;
};
