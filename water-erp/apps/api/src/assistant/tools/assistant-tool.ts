export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  cards?: Array<
    | {
        type: 'metric' | 'table';
        title: string;
        [key: string]: unknown;
      }
    | {
        type: 'chart';
        title: string;
        chartType: 'bar' | 'line' | 'pie' | 'hbar' | 'grouped_bar';
        option: Record<string, unknown>;
        caption?: string;
      }
  >;
  citations?: Array<{
    type: string;
    title: string;
    entityId: string;
  }>;
}

/** 可视化声明 —— 数据工具附带，告诉映射器如何画图 */
export interface VizDeclaration {
  kind: 'distribution' | 'composition' | 'trend' | 'ranking' | 'comparison';
  /** 分类/实体字段名（distribution / ranking / comparison） */
  category?: string;
  /** 数值字段名 */
  value: string;
  /** 时间字段名（trend） */
  timeField?: string;
  /** 分组字段名（comparison） */
  seriesField?: string;
  /** 排名只取前 N（ranking） */
  topN?: number;
}

export interface AssistantTool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
