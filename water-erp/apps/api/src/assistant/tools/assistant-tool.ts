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

/** 工具执行上下文（2026-10-22 :3011 P1）：认证用户带公司归属；companyIds 仅 admin 经
 *  ChatDto.context 采纳（非 admin 由服务端忽略，防伪造）。匿名访客 ctx = {} */
export interface AssistantToolCtx {
  user?: { sub: string; role: string; companyId: string | null };
  companyIds?: string[];
}

export interface AssistantTool {
  name: string;
  description: string;
  execute(args: Record<string, unknown>, ctx?: AssistantToolCtx): Promise<ToolResult>;
}
