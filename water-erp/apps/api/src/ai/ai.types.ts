export interface ComplianceItem {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

export interface RiskItem {
  level: 'info' | 'warning' | 'success' | 'danger';
  category: string;
  content: string;
  confidence: number;
}

export interface ScoreSuggestion {
  category: string;
  name: string;
  suggestedScore: number;
  minScore: number;
  maxScore: number;
  reason: string;
  confidence: number;
}

export interface OverallScore {
  score: number;
  level: string;
  breakdown: {
    compliance: { weight: number; score: number };
    risk: { weight: number; score: number };
    scoring: { weight: number; score: number };
  };
}

export interface AiAnalysisResult {
  supplierName: string;
  generatedAt: string;
  model: string;
  overall: OverallScore;
  complianceCheck: { overall: string; score: number; items: ComplianceItem[] };
  riskAnalysis: RiskItem[];
  scoreSuggestion: ScoreSuggestion[];
  keyPoints: string[];
}
