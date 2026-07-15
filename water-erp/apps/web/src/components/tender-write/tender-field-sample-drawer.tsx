import { useEffect, useState } from 'react';
import { Star, Trash2, Copy, Check } from 'lucide-react';
import type { TenderFieldKey } from '@/lib/types/tender-write';
import { Modal } from '@/components/workbench';
import {
  fetchFieldSamples,
  toggleFieldSampleFavorite,
  deleteFieldSample,
  type TenderFieldSample,
} from '@/lib/api/tender-sample';

export function TenderFieldSampleDialog({
  isOpen,
  fieldKey,
  fieldLabel,
  onSelect,
  onClose,
}: {
  isOpen: boolean;
  fieldKey: TenderFieldKey;
  fieldLabel: string;
  onSelect: (content: string) => void;
  onClose: () => void;
}) {
  const [samples, setSamples] = useState<TenderFieldSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && fieldKey) {
      setLoading(true);
      fetchFieldSamples(fieldKey)
        .then(setSamples)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [isOpen, fieldKey]);

  const handleToggleFavorite = async (id: string) => {
    try {
      const updated = await toggleFieldSampleFavorite(id);
      setSamples((prev) =>
        prev.map((s) => (s.id === id ? updated : s)),
      );
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFieldSample(id);
      setSamples((prev) => prev.filter((s) => s.id !== id));
    } catch (error) {
      console.error('Failed to delete sample:', error);
    }
  };

  const handleCopy = async (sample: TenderFieldSample) => {
    await navigator.clipboard.writeText(sample.content);
    setCopiedId(sample.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSelect = (content: string) => {
    onSelect(content);
    onClose();
  };

  const favoriteSamples = samples.filter((s) => s.isFavorite);
  const otherSamples = samples.filter((s) => !s.isFavorite);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="样本库"
      description={fieldLabel}
      size="md"
    >
      {loading ? (
        <div className="flex items-center justify-center py-8 text-sm text-[color:var(--muted-foreground)]">
          加载中...
        </div>
      ) : samples.length === 0 ? (
        <div className="wb-panel flex items-center justify-center px-4 py-8 text-center text-sm text-[color:var(--muted-foreground)]">
          暂无样本记录
          <p className="mt-2 text-xs">
            点击字段右侧的收藏按钮保存内容到样本库
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {favoriteSamples.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(234,188,110,0.92)]">
                已收藏
              </div>
              <div className="space-y-2">
                {favoriteSamples.map((sample) => (
                  <SampleCard
                    key={sample.id}
                    sample={sample}
                    isCopied={copiedId === sample.id}
                    onToggleFavorite={() => handleToggleFavorite(sample.id)}
                    onDelete={() => handleDelete(sample.id)}
                    onCopy={() => handleCopy(sample)}
                    onSelect={() => handleSelect(sample.content)}
                  />
                ))}
              </div>
            </div>
          )}

          {otherSamples.length > 0 && (
            <div>
              {favoriteSamples.length > 0 && (
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[rgba(94,126,189,0.76)]">
                  历史记录
                </div>
              )}
              <div className="space-y-2">
                {otherSamples.map((sample) => (
                  <SampleCard
                    key={sample.id}
                    sample={sample}
                    isCopied={copiedId === sample.id}
                    onToggleFavorite={() => handleToggleFavorite(sample.id)}
                    onDelete={() => handleDelete(sample.id)}
                    onCopy={() => handleCopy(sample)}
                    onSelect={() => handleSelect(sample.content)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function SampleCard({
  sample,
  isCopied,
  onToggleFavorite,
  onDelete,
  onCopy,
  onSelect,
}: {
  sample: TenderFieldSample;
  isCopied: boolean;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onSelect: () => void;
}) {
  return (
    <div className="group neu-card-static !rounded-[14px] p-3">
      <div className="flex items-start justify-between gap-2">
        <p
          className="max-h-[80px] min-w-0 flex-1 cursor-pointer overflow-y-auto text-sm leading-6 text-[color:var(--foreground)]"
          onClick={onSelect}
        >
          {sample.content}
        </p>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            type="button"
            onClick={onToggleFavorite}
            className="rounded p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[rgba(234,188,110,1)]"
          >
            <Star
              size={14}
              className={
                sample.isFavorite
                  ? 'fill-[rgba(234,188,110,1)] text-[rgba(234,188,110,1)]'
                  : ''
              }
            />
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="rounded p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[color:var(--foreground)]"
          >
            {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0_/_0.4)] hover:text-[rgba(199,108,83,1)]"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-[color:var(--muted-foreground)]">
        <span>
          {sample.sourceType === 'ai_generated' ? 'AI 生成' : '手动输入'}
        </span>
        <span>·</span>
        <span>{new Date(sample.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}