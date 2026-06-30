export type SupplierStatus = 'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'DISABLED' | 'BLACKLIST';

export type ChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Supplier {
  id: string;
  userId: string;
  name: string;
  creditCode: string | null;
  enterpriseType: string;
  legalPerson: string;
  registeredAddress: string;
  businessScope: string;
  status: SupplierStatus;
  classificationId?: string;
  rejectReason?: string;
  returnReason?: string;
  createdAt: string;
  updatedAt: string;
  classification?: SupplierClassification;
  contacts?: SupplierContact[];
  qualifications?: SupplierQualification[];
  evaluations?: SupplierEvaluation[];
  changeRecords?: SupplierChangeRecord[];
  _count?: { evaluations: number };
}

export interface SupplierContact {
  id: string;
  supplierId: string;
  name: string;
  phone: string;
  email?: string;
  isPrimary: boolean;
}

export interface SupplierQualification {
  id: string;
  supplierId: string;
  type: string;
  name: string;
  fileUrl: string;
  validFrom?: string;
  validTo?: string;
  status: string;
}

export interface SupplierClassification {
  id: string;
  name: string;
  code: string;
  description?: string;
  _count?: { suppliers: number };
}

export interface SupplierEvaluation {
  id: string;
  supplierId: string;
  projectId?: string;
  evaluatorId: string;
  score: number;
  level: string;
  completenessScore: number;
  responsivenessScore: number;
  cooperationScore: number;
  complianceScore: number;
  overallScore: number;
  comment?: string;
  createdAt: string;
  evaluator?: { id: string; displayName: string };
}

export interface SupplierChangeRecord {
  id: string;
  supplierId: string;
  fieldName: string;
  fieldLabel: string;
  oldValue?: string;
  newValue?: string;
  reason?: string;
  status: ChangeStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  rejectReason?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  link?: string;
  createdAt: string;
}

export interface SupplierListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: Supplier[];
}

export interface SupplierStats {
  total: number;
  pending: number;
  approved: number;
  disabled: number;
  blacklist: number;
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