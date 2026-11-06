'use client';

import { Eye, Clock } from 'lucide-react';

// 纯逻辑层拆至 publish-config.ts（2026-10-29：.tsx 无法被 Node 原生 type-stripping 测试加载）；
// 此处重导出，既有消费方 `@/components/notice/publish-config-section` 导入路径不变。
export type { Visibility, ScheduleMode, PublishConfig } from './publish-config';
export { DEFAULT_PUBLISH_CONFIG, configFromMetadata, configToMetadata } from './publish-config';
import type { PublishConfig } from './publish-config';

/* ════════════ 组件 ════════════ */

export function PublishConfigSection({
  config,
  onChange,
  legacyRestricted = false,
}: {
  config: PublishConfig;
  onChange: (next: PublishConfig) => void;
  /** 编辑存量「部分供应商可见」公告时提示：保存后转为全部可见（选项已删，2026-11-06 用户裁定） */
  legacyRestricted?: boolean;
}) {
  const update = (patch: Partial<PublishConfig>) => onChange({ ...config, ...patch });

  return (
    <div className="space-y-4">
      {/* 可见范围：固定全部可见（2026-11-06 用户裁定删除「部分供应商可见」选项——
          定向发布走项目管理「公告制作与发布」向导，公告发布中心不再提供；本组件随删
          RESTRICTED 分段与供应商选择器，configToMetadata 对 PUBLIC 恒清 restrictedSupplierIds） */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">
          <Eye size={12} />可见范围
        </label>
        <div className="text-sm font-bold text-[var(--foreground)]">全部可见</div>
        <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
          所有已启用供应商均可在供应商门户及首页查看此公告
        </p>
        {legacyRestricted && (
          <p className="mt-1 text-[11px] font-semibold text-[var(--warning,var(--accent))]">
            此公告原为「部分供应商可见」，保存后将转为全部可见
          </p>
        )}
      </div>

      <div className="rounded-lg bg-[color-mix(in_oklch,var(--surface)_60%,transparent)] px-3 py-px" style={{ boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.3)' }} />

      {/* 通知设置已删（2026-10-16 用户裁定）：发布时恒按可见范围向供应商发站内通知（meta.notifyOnPublish 钉 true，见 configToMetadata） */}

      {/* 发布时间 */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">
          <Clock size={12} />发布时间
        </label>
        <div className="neu-tab-bar inline-flex">
          <button
            type="button"
            onClick={() => update({ scheduleMode: 'immediate' })}
            className={`neu-tab px-4 py-1.5 text-xs font-bold ${config.scheduleMode === 'immediate' ? 'is-active' : ''}`}
          >
            立即发布
          </button>
          <button
            type="button"
            onClick={() => update({ scheduleMode: 'scheduled' })}
            className={`neu-tab px-4 py-1.5 text-xs font-bold ${config.scheduleMode === 'scheduled' ? 'is-active' : ''}`}
          >
            定时发布
          </button>
        </div>
        {config.scheduleMode === 'scheduled' && (
          <div className="mt-2">
            <input
              type="datetime-local"
              value={config.scheduledPublishDate}
              onChange={(e) => update({ scheduledPublishDate: e.target.value })}
              className="neu-input text-sm"
            />
            <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
              到达设定时间后系统自动发布并发送通知（精确到分钟）
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
