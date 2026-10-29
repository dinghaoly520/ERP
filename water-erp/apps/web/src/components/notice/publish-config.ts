/**
 * 发布配置的纯逻辑层（2026-10-29 拆分）：类型/默认值/metadata 互转从组件 .tsx 拆出——
 * .tsx 无法被 Node 原生 type-stripping 测试加载（tsx 转换缺 JSX），纯 .ts 可直测。
 * 消费方仍从 publish-config-section（.tsx 重导出）导入，路径不变。
 */

export type Visibility = 'PUBLIC' | 'RESTRICTED';
export type ScheduleMode = 'immediate' | 'scheduled';

export interface PublishConfig {
  visibility: Visibility;
  restrictedSupplierIds: string[];
  notifyOnPublish: boolean;
  scheduleMode: ScheduleMode;
  scheduledPublishDate: string; // ISO datetime-local format: 2026-08-04T12:00
}

export const DEFAULT_PUBLISH_CONFIG: PublishConfig = {
  visibility: 'PUBLIC',
  restrictedSupplierIds: [],
  notifyOnPublish: true,
  scheduleMode: 'immediate',
  scheduledPublishDate: '',
};

/** 从公告 metadata 恢复发布配置 */
export function configFromMetadata(meta: Record<string, any> | null | undefined): PublishConfig {
  if (!meta) return { ...DEFAULT_PUBLISH_CONFIG };
  return {
    visibility: meta.visibility === 'RESTRICTED' ? 'RESTRICTED' : 'PUBLIC',
    restrictedSupplierIds: Array.isArray(meta.restrictedSupplierIds) ? meta.restrictedSupplierIds : [],
    notifyOnPublish: meta.notifyOnPublish !== false,
    scheduleMode: meta.scheduledPublishDate ? 'scheduled' : 'immediate',
    scheduledPublishDate: meta.scheduledPublishDate ? meta.scheduledPublishDate.slice(0, 16) : '',
  };
}

/** 将发布配置写入 metadata（供 create/update payload 使用）。
 *  定时语义（2026-10-29 用户裁定，审计 D）：只要配置区仍处于「定时发布」且有值，
 *  「保存草稿」同样保留定时——此前无条件剥除，改个错别字点保存草稿就静默拆弹，
 *  到点不发的症状与「定时发布失效」原投诉同形。取消定时 = 切回「立即发布」再保存
 *  （走 delete 分支）。2026-10-16「点保存草稿公告自动发布」bug 不会复发：默认配置
 *  恒为 immediate，纯草稿不带定时键；从 metadata 恢复的定时态本就是用户此前明确设定。
 *  调用方在保存草稿且定时保留时须 toast 提示「定时发布仍生效」，让保留是被听见的。 */
export function configToMetadata(
  config: PublishConfig,
  base: Record<string, any> = {},
  _opts: { draft?: boolean } = {},
): Record<string, any> {
  const meta: Record<string, any> = { ...base };
  meta.visibility = config.visibility;
  if (config.visibility === 'RESTRICTED') {
    meta.restrictedSupplierIds = config.restrictedSupplierIds;
  } else {
    delete meta.restrictedSupplierIds;
  }
  // 通知设置 UI 已删（2026-10-16）：恒按可见范围通知，meta 钉 true 保持后端既有默认语义
  meta.notifyOnPublish = true;
  if (config.scheduleMode === 'scheduled' && config.scheduledPublishDate) {
    meta.scheduledPublishDate = config.scheduledPublishDate;
  } else {
    delete meta.scheduledPublishDate;
  }
  return meta;
}
