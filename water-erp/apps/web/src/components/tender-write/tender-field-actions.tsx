import { useState } from 'react';
import { BookOpen, MapPin, Search, ShieldAlert, ShieldCheck, Sparkles, Star, UserCheck, Users } from 'lucide-react';
import type { TenderFieldKey } from '@/lib/types/tender-write';

// Fields that should not show favorite/sample/AI actions
const FIELDS_WITHOUT_ACTIONS: Set<string> = new Set([
  'coverDate',
  'projectBudget',
  'documentPrice',
  'contactName',
  'contactEmail',
  'contactPhone',
  // 监督信息/地点地址（2026-10-09）：非 AI/样本语义，操作入口只有「监督人」多选按钮
  'supervisionDepartment',
  'supervisionAddress',
  'supervisionContact',
  'supervisionPhone',
  'bidOpeningPlace',
  'contactAddress',
]);

// Fields that should hide actions when type is "date"
// （projectDuration 已改纯文字填写，2026-09-11 移除）
const FIELDS_HIDE_WHEN_DATE: Set<string> = new Set([
  'submissionAndNegotiationTime',
]);

function ActionTooltip({ children }: { children: string }) {
  return (
    <span className="tender-tooltip absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-[color:var(--foreground)] px-2 py-1 text-[10px] text-white shadow-lg">
      {children}
    </span>
  );
}

export function TenderFieldActions({
  fieldKey,
  currentValue,
  isFavorite,
  isGenerating,
  isContactField,
  isSupervisionContactField,
  isPlaceField,
  isSupervisionProfileField,
  fieldTypeValue,
  onSampleOpen,
  onFavoriteToggle,
  onAiGenerate,
  onContactOpen,
  onSupervisorOpen,
  onPlaceOpen,
  onSupervisionProfileOpen,
  onSupplierSelect,
  aiOverride,
}: {
  fieldKey: TenderFieldKey;
  currentValue: string;
  isFavorite: boolean;
  isGenerating: boolean;
  isContactField?: boolean;
  /** 监督人字段（supervisionContact）专属：显示「监督人」多选按钮（2026-10-09） */
  isSupervisionContactField?: boolean;
  /** 开标地点字段专属：从公司维护地点条目选择（2026-10-10） */
  isPlaceField?: boolean;
  /** 监督部门字段专属：整块改选公司监督方案（2026-10-10） */
  isSupervisionProfileField?: boolean;
  fieldTypeValue?: string; // For composite fields: "date", "text", or "table"
  onSampleOpen: () => void;
  onFavoriteToggle: () => void;
  onAiGenerate: () => void;
  onContactOpen?: () => void;
  /** 打开联系人选择器（多选模式）填监督人 */
  onSupervisorOpen?: () => void;
  /** 打开公司维护的开标地点条目选择器 */
  onPlaceOpen?: () => void;
  /** 打开公司维护的监督方案条目选择器（整块填充监督四字段） */
  onSupervisionProfileOpen?: () => void;
  onSupplierSelect?: () => void;
  /** AI 按钮语义覆写（如「拟定供应商名称」的核对供应商——不做内容优化） */
  aiOverride?: { title: string; label: string; onClick: () => void; busy?: boolean };
}) {
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  // Check if this field should hide favorite/sample/AI actions
  const hideActions = FIELDS_WITHOUT_ACTIONS.has(fieldKey) ||
    (FIELDS_HIDE_WHEN_DATE.has(fieldKey) && fieldTypeValue === 'date');

  // Table type: show actions but disable AI
  const isTableType = fieldTypeValue === 'table';

  const bindTooltip = (key: string) => ({
    onMouseEnter: () => setShowTooltip(key),
    onMouseLeave: () => setShowTooltip(null),
    onFocus: () => setShowTooltip(key),
    onBlur: () => setShowTooltip(null),
  });

  return (
    <div className="flex items-center gap-1.5">
      {/* 联系人按钮（2026-10-10 与监督人按钮同款设计：图标+文字标签） */}
      {isContactField && onContactOpen && (
        <button
          type="button"
          onClick={onContactOpen}
          aria-label="选择联系人"
          title="选择联系人"
          {...bindTooltip('contact')}
          className="tender-action-chip tender-action-chip--primary !text-[11px] !px-2 !py-1 text-[rgba(76,111,189,1)]"
        >
          <Users size={14} className="text-[rgba(76,111,189,1)]" />
          联系人
          {showTooltip === 'contact' && <ActionTooltip>选择联系人</ActionTooltip>}
        </button>
      )}

      {/* 开标地点（2026-10-10）：从公司维护的地点条目中单选 */}
      {isPlaceField && onPlaceOpen && (
        <button
          type="button"
          onClick={onPlaceOpen}
          aria-label="选择开标地点"
          title="从公司维护的开标地点条目中选择"
          {...bindTooltip('place')}
          className="tender-action-chip tender-action-chip--primary !text-[11px] !px-2 !py-1 text-[rgba(76,111,189,1)]"
        >
          <MapPin size={14} className="text-[rgba(76,111,189,1)]" />
          地点
          {showTooltip === 'place' && <ActionTooltip>地点条目选择</ActionTooltip>}
        </button>
      )}

      {/* 监督方案（2026-10-10）：整块改选公司维护的监督方案条目 */}
      {isSupervisionProfileField && onSupervisionProfileOpen && (
        <button
          type="button"
          onClick={onSupervisionProfileOpen}
          aria-label="选择监督方案"
          title="整块带入公司维护的监督方案（部门/地址/监督人/电话）"
          {...bindTooltip('supervisionProfile')}
          className="tender-action-chip tender-action-chip--primary !text-[11px] !px-2 !py-1 text-[rgba(76,111,189,1)]"
        >
          <ShieldAlert size={14} className="text-[rgba(76,111,189,1)]" />
          监督方案
          {showTooltip === 'supervisionProfile' && <ActionTooltip>整块带入监督方案</ActionTooltip>}
        </button>
      )}

      {/* 监督人多选（2026-10-09）：公告监督块「联系人」行——从本公司联系人多选，顿号拼接 */}
      {isSupervisionContactField && onSupervisorOpen && (
        <button
          type="button"
          onClick={onSupervisorOpen}
          aria-label="选择监督人"
          title="从本公司联系人中多选监督人"
          {...bindTooltip('supervisor')}
          className="tender-action-chip tender-action-chip--primary !text-[11px] !px-2 !py-1 text-[rgba(76,111,189,1)]"
        >
          <UserCheck size={14} className="text-[rgba(76,111,189,1)]" />
          监督人
          {showTooltip === 'supervisor' && <ActionTooltip>监督人多选</ActionTooltip>}
        </button>
      )}

      {onSupplierSelect && (
        <button
          type="button"
          onClick={onSupplierSelect}
          aria-label="供应商抽选"
          title="AI 分析项目需求，智能推荐匹配供应商"
          {...bindTooltip('supplier')}
          className="tender-action-chip tender-action-chip--primary !text-[11px] !px-2 !py-1 text-[rgba(76,111,189,1)]"
        >
          <Search size={14} className="text-[rgba(76,111,189,1)]" />
          {showTooltip === 'supplier' && <ActionTooltip>供应商抽选</ActionTooltip>}
        </button>
      )}

      {!hideActions && (
        <>
          <button
            type="button"
            onClick={onFavoriteToggle}
            aria-label={isFavorite ? '取消收藏' : '收藏'}
            title={isFavorite ? '取消收藏' : '收藏'}
            {...bindTooltip('favorite')}
            className={`tender-action-chip ${isFavorite ? 'tender-action-chip--active' : ''}`}
          >
            <Star
              size={14}
              className={
                isFavorite
                  ? 'fill-[rgba(234,188,110,1)] text-[rgba(234,188,110,1)]'
                  : 'text-[color:var(--muted-foreground)]'
              }
            />
            {showTooltip === 'favorite' && (
              <ActionTooltip>{isFavorite ? '取消收藏' : '收藏'}</ActionTooltip>
            )}
          </button>

          <button
            type="button"
            onClick={onSampleOpen}
            aria-label="打开样本库"
            title="打开样本库"
            {...bindTooltip('sample')}
            className="tender-action-chip"
          >
            <BookOpen size={14} />
            {showTooltip === 'sample' && <ActionTooltip>样本库</ActionTooltip>}
          </button>

          {aiOverride ? (
            <button
              type="button"
              onClick={aiOverride.onClick}
              disabled={aiOverride.busy}
              aria-label={aiOverride.title}
              title={aiOverride.title}
              {...bindTooltip('ai')}
              className={`tender-action-chip tender-action-chip--primary ${aiOverride.busy ? 'tender-status-badge--pulse' : ''} !text-[11px] !px-2 !py-1`}
            >
              <ShieldCheck
                size={14}
                className={aiOverride.busy ? 'text-[rgba(96,139,239,1)]' : 'text-[rgba(76,111,189,1)]'}
              />
              {showTooltip === 'ai' && <ActionTooltip>{aiOverride.label}</ActionTooltip>}
            </button>
          ) : (
          <button
            type="button"
            onClick={onAiGenerate}
            disabled={isGenerating || isTableType}
            aria-label={isTableType ? '表格不支持AI优化' : currentValue.trim() ? 'AI 优化' : 'AI 生成'}
            title={isTableType ? '表格不支持AI优化' : currentValue.trim() ? 'AI 优化' : 'AI 生成'}
            {...bindTooltip('ai')}
            className={`tender-action-chip tender-action-chip--primary ${isGenerating ? 'tender-status-badge--pulse' : ''} !text-[11px] !px-2 !py-1`}
          >
            <Sparkles
              size={14}
              style={isGenerating ? {
                animation: 'colorCycle 1.5s ease-in-out infinite',
              } : undefined}
              className={
                isGenerating
                  ? 'text-[rgba(96,139,239,1)]'
                  : isTableType
                    ? 'text-[color:var(--muted-foreground)] opacity-50'
                    : 'text-[rgba(76,111,189,1)]'
              }
            />
            {showTooltip === 'ai' && (
              <ActionTooltip>
                {isTableType ? '表格不支持AI优化' : (currentValue.trim() ? 'AI 优化' : 'AI 生成')}
              </ActionTooltip>
            )}
          </button>
          )}
        </>
      )}
    </div>
  );
}
