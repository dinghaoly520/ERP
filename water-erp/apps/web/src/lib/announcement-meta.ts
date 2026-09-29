/**
 * 公告类型/状态中文映射——web 门户唯一源（2026-09-29 R5：此前 4 份拷贝分驻
 * notice 列表/详情/notice-view/回收站，任一处加新枚举值即漂移）。
 * 类型文案与 @water-erp/shared ANNOUNCEMENT_TYPE_LABELS 同源（2026-09-09 拍板口径）；
 * 色调与状态文案为本门户展示层口径。
 */
import { ANNOUNCEMENT_TYPE_LABELS } from '@water-erp/shared';
import type { AnnouncementType, AnnouncementStatus } from '@/lib/api/announcement';

export const ANN_TYPE_LABEL: Record<AnnouncementType, string> =
  ANNOUNCEMENT_TYPE_LABELS as Record<AnnouncementType, string>;

export const ANN_TYPE_TONE: Record<AnnouncementType, 'blue' | 'green' | 'orange' | 'gray'> = {
  BID_NOTICE: 'blue', ADDENDUM: 'orange', PREQUAL_NOTICE: 'blue', PRE_WIN_NOTICE: 'green',
  WIN_NOTICE: 'green', CONTRACT_NOTICE: 'blue', PERFORMANCE_NOTICE: 'green',
  POLICY: 'orange', PLATFORM: 'gray', FAILED_BID_NOTICE: 'orange', WIN_BID_NOTICE: 'green',
};

export const ANN_STATUS_LABEL: Record<AnnouncementStatus, string> = {
  DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已下线', // v2（2026-09-26）：公示期满=已下线
  HIDDEN: '已隐藏', // 回收站态：主列表默认排除
  OFFLINE: '已下架',
};

export const ANN_STATUS_TONE: Record<AnnouncementStatus, 'green' | 'gray'> = {
  DRAFT: 'gray', PUBLISHED: 'green', ARCHIVED: 'gray', HIDDEN: 'gray', OFFLINE: 'gray',
};
