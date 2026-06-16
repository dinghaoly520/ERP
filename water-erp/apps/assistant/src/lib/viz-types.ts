export interface VizDeclaration {
  kind: 'distribution' | 'composition' | 'trend' | 'ranking' | 'comparison';
  category?: string;
  value: string;
  timeField?: string;
  seriesField?: string;
  topN?: number;
}
