import { useState } from 'react';
import { BookOpen, Sparkles, Star, Users } from 'lucide-react';
import type { TenderFieldKey } from '@/lib/types/tender-write';

// Fields that should not show favorite/sample/AI actions
const FIELDS_WITHOUT_ACTIONS: Set<string> = new Set([
  'coverDate',
  'projectBudget',
  'documentPrice',
  'contactName',
  'contactEmail',
  'contactPhone',
]);

// Fields that should hide actions when type is "date"
const FIELDS_HIDE_WHEN_DATE: Set<string> = new Set([
  'projectDuration',
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
  fieldTypeValue,
  onSampleOpen,
  onFavoriteToggle,
  onAiGenerate,
  onContactOpen,
}: {
  fieldKey: TenderFieldKey;
  currentValue: string;
  isFavorite: boolean;
  isGenerating: boolean;
  isContactField?: boolean;
  fieldTypeValue?: string; // For composite fields: "date", "text", or "table"
  onSampleOpen: () => void;
  onFavoriteToggle: () => void;
  onAiGenerate: () => void;
  onContactOpen?: () => void;
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
      {isContactField && onContactOpen && (
        <button
          type="button"
          onClick={onContactOpen}
          aria-label="选择联系人"
          title="选择联系人"
          {...bindTooltip('contact')}
          className="tender-action-chip text-[rgba(96,139,239,1)]"
        >
          <Users size={14} />
          {showTooltip === 'contact' && <ActionTooltip>联系人</ActionTooltip>}
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
        </>
      )}
    </div>
  );
}
