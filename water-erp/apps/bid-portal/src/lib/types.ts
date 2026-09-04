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
export type BidProjectDetail = Omit<SharedBidProjectDetail, 'openingSession' | 'experts' | 'scoreItems' | 'openingRecords'> & {
  openingSession?: NonNullable<SharedBidProjectDetail['openingSession']> & {
    handoverAt?: string | null;
    handoverAssetId?: string | null;
  };
  /** A-114（2026-08-31）：开标记录确认签名摘要——getProject/listOpeningRecords 剥壳后
   *  confirmSignature 为 {algorithm, verifiedAt} | null（完整签名仅供应商本人视图与开标文件包保留）。
   *  shared 的内联 openingRecords 类型暂未含该字段，:3007 侧本地补齐（同 openingSession handoverAt 模式）。 */
  openingRecords: (SharedBidProjectDetail['openingRecords'][number] & {
    confirmSignature?: { algorithm?: string; verifiedAt?: string | null } | null;
  })[];
  /** E2: 评标截止时间（供移植的评标管理块倒计时用；后端 GET /bid/projects/:id 对两端返回同数据） */
  evaluationDeadline?: string | null;
  /** N4: 法定最少投标家数（直接采购=1，其余=3）——后端 getProject 下发，dispute-block 流标建议按采购方式取数 */
  minBidders?: number;
  /** A-102/104（2026-09-01）：BidProject 标量列随详情全量下发（getProject include 全标量，不在 bid_host
   *  去敏清单）——保证金到账台账面板按 bondRequired 渲染、比对徽标按 bondAmount 取数。
   *  bondAmount 为 Prisma Decimal，JSON 序列化为字符串，消费侧统一 Number()。 */
  bondRequired?: boolean;
  bondAmount?: number | string | null;
  /** F9（2026-08-28）：BidProject 列随详情下发（getProject 全标量）——生成闸门镜像需组长末签状态 */
  leaderCoSigned?: boolean;
  /** F9（2026-08-28）：getProject include 的报价轮次（谈判项目生成闸门：≥1 轮且全部 closed；sealed_auction 豁免） */
  bidRounds?: Array<{ id: string; roundNo: number; status: string }>;
  /** D2: 专家异议工单（getProject include，:3007 裁决用；与 :3005 同形状） */
  expertDisputes?: Array<{
    id: string; expertName: string; type: string; // scoring | procedure | other
    title: string; content: string; status: string; // open | resolved | rejected
    response?: string | null; createdAt: string;
    resolvedAt?: string | null; resolvedBy?: string | null;
  }>;
  experts: (SharedBidExpert & {
    expertRole?: string; // EXPERT_ROLE.REGULAR | EXPERT_ROLE.ALTERNATE（Prisma BidExpert.expertRole）
    /** F9（2026-08-28）：邀请状态（BidExpert 标量列随详情全量下发）——启动评标委员会闸门按已确认正选计数 */
    invitationStatus?: string; // invited | confirmed | declined
    /** A-132（2026-09-03）：评委分工（BidExpert 标量列随详情全量下发）——专家状态卡展示 分组·职责；
     *  配置入口在 :3005 步骤5（PUT /expert-admin/projects/:id/committee/assignment） */
    reviewGroup?: string | null; // 技术组 | 商务组 | 综合组
    dutyRole?: string | null; // 主审 | 复核 | 成员
    /** 方案 A（角色分层实名）：评标期间后端下发的稳定编号（专家 1/2/…），评分矩阵/偏差/批注用；
     *  组织卡片用 expertName（特权角色为实名）。全部确认后不再下发。 */
    anonLabel?: string;
    scoreRecords: ExpertScoreRecordInfo[];
  })[];
  scoreItems: (Omit<SharedBidScoreItem, 'category'> & { category: ScoreCategory })[];
};
