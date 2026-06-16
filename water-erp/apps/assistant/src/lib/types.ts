export interface ChatResponse {
  conversationId: string;
  answer: string;
  cards: AssistantCard[];
  citations: AssistantCitation[];
  pendingActions: ActionPlan[];
}

export type AssistantCard =
  | { type: 'metric'; title: string; value: string; trend?: string }
  | {
      type: 'chart';
      title: string;
      chartType: 'bar' | 'line' | 'pie' | 'hbar' | 'grouped_bar';
      option: Record<string, unknown>;
      caption?: string;
    }
  | {
      type: 'table';
      title: string;
      columns: Array<{ key: string; label: string }>;
      rows: unknown[];
      viz?: import('./viz-types').VizDeclaration;
    }
  | {
      type: 'actionPlan';
      title: string;
      riskLevel: string;
      actionId: string;
      changes: unknown[];
    };

export interface AssistantCitation {
  type: string;
  title: string;
  entityId: string;
  route?: string;
}

export interface ActionPlan {
  actionId: string;
  actionType: string;
  riskLevel: string;
  targetType: string;
  targetId: string;
  summary: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cards?: AssistantCard[];
  citations?: AssistantCitation[];
  pendingActions?: ActionPlan[];
  timestamp: string;
}
