export interface ChatResponse {
  conversationId: string;
  answer: string;
  cards: AssistantCard[];
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

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cards?: AssistantCard[];
  timestamp: string;
}
