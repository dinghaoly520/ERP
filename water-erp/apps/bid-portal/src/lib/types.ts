/* Re-exports from @water-erp/shared — single source of type truth */
import type { BidProjectDetail as SharedBidProjectDetail } from '@water-erp/shared';

export type {
  User, BidProject, BidSupplier, BidExpert, BidScoreItem,
  BidSupervisionLog, BidSupervisionAnnotation, BidArchiveItem, BidClarification,
  ExpertStatistics, ExpertProject, ExpertProjectDetail,
  DecryptedDocuments, AssistData, EvaluationReport,
  Supplier, SupplierContact, SupplierQualification,
  SupplierClassification, SupplierEvaluation, SupplierChangeRecord,
  SupplierListResponse, Notification, Announcement,
} from '@water-erp/shared';

/* T16：评分类别枚举（Prisma ScoreCategory，scoreItems.category 序列化后的字符串联合）。
   shared 的 BidScoreItem.category 声明为宽 string，只读评标视图的通过性类别判定需要窄联合。 */
export type ScoreCategory = 'QUALIFICATION' | 'RESPONSIVE' | 'BUSINESS' | 'TECHNICAL' | 'PRICE';

/* T16：专家评分记录（Prisma BidScoreRecord，getProject 的 experts include scoreRecords 返回）。
   score 为 Decimal，JSON 序列化为字符串，消费侧统一 Number()。 */
export interface ExpertScoreRecordInfo {
  id: string;
  scoreItemId: string;
  supplierId: string;
  score: number; // Decimal → 序列化字符串，组件以 Number() 消费
  /** 通过性审查（资格/响应性）：是否通过 */
  passed?: boolean | null;
  reason?: string | null;
}

type SharedBidExpert = SharedBidProjectDetail['experts'][number];
type SharedBidScoreItem = SharedBidProjectDetail['scoreItems'][number];

/* T8：openingSession 移交字段本地扩展（T1 为 BidOpeningSession 新增 handoverAt / handoverAssetId 两列）。
   shared 的内联 openingSession 类型暂未含这两字段，:3007 侧先本地补齐，供大厅「交回 :3005」横幅（T9）消费。
   T16：experts / scoreItems 本地扩展 —— GET /bid/projects/:id 返回 Prisma 原形：experts 带
   scoreRecords 与 expertRole（正选/候补），scoreItems.category 为 ScoreCategory 枚举。shared 的内联
   类型缺这些字段，:3007 侧本地补齐（与 :3005 apps/web BidProjectExpertInfo 同形状；后端对两端返回同数据），
   供只读评标管理视图（T16）消费。 */
export type BidProjectDetail = Omit<SharedBidProjectDetail, 'openingSession' | 'experts' | 'scoreItems'> & {
  openingSession?: NonNullable<SharedBidProjectDetail['openingSession']> & {
    handoverAt?: string | null;
    handoverAssetId?: string | null;
  };
  /** E2: 评标截止时间（供移植的评标管理块倒计时用；后端 GET /bid/projects/:id 对两端返回同数据） */
  evaluationDeadline?: string | null;
  /** D2: 专家异议工单（getProject include，:3007 裁决用；与 :3005 同形状） */
  expertDisputes?: Array<{
    id: string; expertName: string; type: string; // scoring | procedure | other
    title: string; content: string; status: string; // open | resolved | rejected
    response?: string | null; createdAt: string;
    resolvedAt?: string | null; resolvedBy?: string | null;
  }>;
  experts: (SharedBidExpert & {
    expertRole?: string; // EXPERT_ROLE.REGULAR | EXPERT_ROLE.ALTERNATE（Prisma BidExpert.expertRole）
    scoreRecords: ExpertScoreRecordInfo[];
  })[];
  scoreItems: (Omit<SharedBidScoreItem, 'category'> & { category: ScoreCategory })[];
};
