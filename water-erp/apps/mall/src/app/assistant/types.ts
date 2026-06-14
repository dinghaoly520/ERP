export type MallAssistantExpression = 'normal' | 'thinking' | 'serious';

export type MallAssistantRole = 'user' | 'assistant';

export interface MallAssistantMessage {
  id: string;
  role: MallAssistantRole;
  content: string;
}

export interface MallAssistantContextItem {
  code: string;
  name: string;
  specification: string;
  category: string;
  referencePrice: number;
  unit: string;
  priceRange: string;
  averagePrice: number;
  supplier: string;
  priceSource: string;
  region: string;
  validUntil: string | null;
  status: string;
  changeRate: number;
}

export interface MallAssistantBudgetLine {
  code: string;
  name: string;
  qty: number;
  unit: string;
  referencePrice: number;
}

export interface MallAssistantSelectedItem extends MallAssistantContextItem {
  id: string;
  supplierType: string;
  minOrder: string;
  remark: string | null;
}

export interface MallAssistantContext {
  totalItems: number;
  currentFilters: {
    category: string;
    region: string;
    status: string;
    source: string;
    search: string;
  };
  riskSummary: {
    safe: number;
    inquiry: number;
    expiring: number;
    review: number;
  };
  visibleItems: MallAssistantContextItem[];
  budget: MallAssistantBudgetLine[];
  selectedItem?: MallAssistantSelectedItem | null;
}
