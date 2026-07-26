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

/* T8：openingSession 移交字段本地扩展（T1 为 BidOpeningSession 新增 handoverAt / handoverAssetId 两列）。
   shared 的内联 openingSession 类型暂未含这两字段，:3007 侧先本地补齐，供大厅「交回 :3005」横幅（T9）消费。 */
export type BidProjectDetail = Omit<SharedBidProjectDetail, 'openingSession'> & {
  openingSession?: NonNullable<SharedBidProjectDetail['openingSession']> & {
    handoverAt?: string | null;
    handoverAssetId?: string | null;
  };
};
