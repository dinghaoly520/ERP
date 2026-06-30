import { useEffect, useState } from 'react';
import { X, Star, Trash2, Copy, Check } from 'lucide-react';
import type { TenderFieldKey } from '@/lib/types/tender-write';
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

  if (!isOpen) return null;

  const favoriteSamples = samples.filter((s) => s.isFavorite);
  const otherSamples = samples.filter((s) => !s.isFavorite);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 backdrop-blur-md bg-white/10"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-[min(480px,90vw)] flex-col rounded-[24px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,255,0.96))] shadow-[0_24px_54px_rgba(59,89,143,0.16)]">
        <header className="flex items-center justify-between border-b border-white/60 px-5 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgba(94,126,189,0.76)]">
              样本库
            </div>
            <h3 className="mt-1 text-sm font-semibold text-[color:var(--foreground)]">
              {fieldLabel}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[color:var(--muted-foreground)] transition-colors hover:bg-white/60 hover:text-[color:var(--foreground)]"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-[color:var(--muted-foreground)]">
              加载中...
            </div>
          ) : samples.length === 0 ? (
            <div className="rounded-[18px] border border-white/60 bg-white/50 px-4 py-8 text-center text-sm text-[color:var(--muted-foreground)]">
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
        </div>
      </div>
    </div>
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
    <div className="group rounded-[14px] border border-white/60 bg-white/70 p-3 transition-all hover:border-white/80 hover:bg-white/90">
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
            className="rounded p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-white/60 hover:text-[rgba(234,188,110,1)]"
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
            className="rounded p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-white/60 hover:text-[color:var(--foreground)]"
          >
            {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1 text-[color:var(--muted-foreground)] transition-colors hover:bg-white/60 hover:text-[rgba(199,108,83,1)]"
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