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

export interface SupplierRecommendation {
  supplierId: string;
  name: string;
  classification?: string;
  matchScore: number;
  reason: string;
  legalPerson?: string;
  enterpriseType?: string;
  contacts?: { name: string; phone: string; isPrimary: boolean }[];
}

export interface SupplierSelectionResult {
  requirement: string;
  engine: 'deepseek' | 'rules';
  model: string;
  candidatePool: number;
  summary: string;
  recommendations: SupplierRecommendation[];
  generatedAt: string;
}
