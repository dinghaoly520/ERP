'use client';

/** 水叮当知识库管理面板（2026-11-03 设计 §5.2）：我的知识库（可维护）与共享知识库
 *  （只读检索）两组；建库（名称+可见性 仅自己/所有人）；上传 pdf/doc/docx/txt/md
 *  ≤50MB。2026-11-06 解析异步化：上传收件即回（202），行上展示解析状态徽章
 *  （解析中页进度/失败可重试/未索引=嵌入降级待重建），面板开着且有解析中文件时 5s 轮询。 */
import { useEffect, useRef, useState } from 'react';
import { BookOpen, FileUp, Loader2, Plus, RefreshCw, RotateCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/workbench';
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeFile,
  fetchAssistantKnowledge,
  reindexKnowledgeBase,
  retryKnowledgeFile,
  uploadKnowledgeFileWithStatus,
  type KbCard,
  type KbFile,
} from '@/lib/api/knowledge';

const MAX_SIZE = 50 * 1024 * 1024;
const ACCEPT = '.pdf,.doc,.docx,.txt,.md';

/** 解析状态徽章（2026-11-06 异步化）：PARSING=页进度、FAILED=可重试、READY+未索引=待重建 */
function FileStatusChip({ f }: { f: KbFile }) {
  if (f.status === 'PARSING') {
    return (
      <span
        className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px] tabular-nums"
        style={{ background: 'color-mix(in oklch, var(--accent) 14%, transparent)', color: 'var(--accent)' }}
      >
        {f.totalPages ? `解析中 ${f.processedPages ?? 0}/${f.totalPages} 页` : '解析中…'}
      </span>
    );
  }
  if (f.status === 'FAILED') {
    return (
      <span
        className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px]"
        style={{ background: 'color-mix(in oklch, var(--danger) 12%, transparent)', color: 'var(--danger)' }}
        title={f.error ?? undefined}
      >
        解析失败
      </span>
    );
  }
  if (f.status === 'READY' && f.indexed === false) {
    return (
      <span
        className="shrink-0 rounded-[6px] px-1.5 py-0.5 text-[10px]"
        style={{ background: 'color-mix(in oklch, var(--warning) 12%, transparent)', color: 'var(--warning)' }}
        title="嵌入服务未运行，文件已入库；恢复后请点「重建索引」"
      >
        未索引
      </span>
    );
  }
  return null;
}

export function KnowledgePanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [mine, setMine] = useState<KbCard[]>([]);
  const [shared, setShared] = useState<KbCard[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newShared, setNewShared] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0); // 上传字节进度（2026-11-06）
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadKbRef = useRef<string | null>(null);

  // silent=true 供 5s 轮询静默刷新（不动 loading 态防面板闪烁，2026-11-06 同 tender-review 实录）
  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetchAssistantKnowledge();
      setMine(r.mine);
      setShared(r.shared);
    } catch (e) {
      if (!silent) toast.error(e instanceof Error ? e.message : '知识库加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => { if (open) void load(); }, [open]);

  // 解析异步化（2026-11-06）：面板开着且存在解析中文件 → 5s 轮询刷新；无则停
  const hasParsing = [...mine, ...shared].some(kb => kb.files.some(f => f.status === 'PARSING'));
  useEffect(() => {
    if (!open || !hasParsing) return;
    const timer = setInterval(() => { void load(true); }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasParsing]);

  const handleCreate = async () => {
    if (!newName.trim()) { toast.error('请填写知识库名称'); return; }
    setCreating(true);
    try {
      await createKnowledgeBase({ name: newName.trim(), isShared: newShared, domain: 'assistant' });
      toast.success('知识库已创建，可上传资料');
      setNewName('');
      setNewShared(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleUpload = async (kbId: string, file: File) => {
    if (file.size > MAX_SIZE) { toast.error('文件超过 50MB 上限'); return; }
    setBusyId(kbId);
    setUploadPct(0);
    try {
      const r = await uploadKnowledgeFileWithStatus(kbId, file, {
        onProgress: (l, t) => setUploadPct(t > 0 ? Math.round((l / t) * 100) : 0),
      });
      if (r.deduplicated) {
        toast.info(`《${file.name}》已在库中（${r.status === 'PARSING' ? '解析中' : '已入库'}），未重复上传`);
      } else {
        toast.success(`《${file.name}》已上传，后台解析中`);
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleRetry = async (kbId: string, f: KbFile) => {
    setBusyId(kbId);
    try {
      await retryKnowledgeFile(kbId, f.id);
      toast.success('已重新入队解析');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重试失败');
    } finally {
      setBusyId(null);
    }
  };

  const renderCard = (kb: KbCard, editable: boolean) => (
    <div key={kb.id} className="neu-table-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <BookOpen size={15} className="text-[var(--accent)] shrink-0" />
          <span className="text-sm font-bold text-[color:var(--foreground)] truncate">{kb.name}</span>
          <span className="neu-tab-count shrink-0">{kb.isShared ? '所有人可用' : '仅自己'}</span>
          {!editable && <span className="text-[10px] text-[var(--muted-foreground)] shrink-0">来自 {kb.ownerName} · 只读</span>}
        </div>
        {editable && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="neu-btn-xs gap-1"
              onClick={() => { uploadKbRef.current = kb.id; fileInputRef.current?.click(); }}
              disabled={busyId === kb.id}
            >
              {busyId === kb.id ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />}{busyId === kb.id ? (uploadPct > 0 ? `上传中 ${uploadPct}%` : '上传中') : '上传'}
            </button>
            <button
              type="button"
              className="neu-btn-xs gap-1"
              title="嵌入服务恢复后补建向量索引"
              onClick={async () => {
                setBusyId(kb.id);
                try { await reindexKnowledgeBase(kb.id); toast.success('索引已重建'); await load(); }
                catch (e) { toast.error(e instanceof Error ? e.message : '重建失败'); }
                finally { setBusyId(null); }
              }}
            >
              <RefreshCw size={13} />重建索引
            </button>
            <button
              type="button"
              className="neu-btn-xs is-danger gap-1"
              onClick={async () => {
                if (!window.confirm(`确认删除知识库「${kb.name}」及其全部文件？`)) return;
                setBusyId(kb.id);
                try { await deleteKnowledgeBase(kb.id); toast.success('已删除'); await load(); }
                catch (e) { toast.error(e instanceof Error ? e.message : '删除失败'); }
                finally { setBusyId(null); }
              }}
            >
              <Trash2 size={13} />删除
            </button>
          </div>
        )}
      </div>
      {kb.files.length === 0 ? (
        <p className="text-xs text-[var(--muted-foreground)]">暂无文件{editable ? '，点「上传」添加资料' : ''}</p>
      ) : (
        <div className="space-y-1.5">
          {kb.files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-xs"
              style={{ background: 'color-mix(in oklch, var(--surface) 65%, transparent)' }}
            >
              <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--foreground)]">{f.fileName}</span>
              <FileStatusChip f={f} />
              <span className="tabular-nums text-[var(--muted-foreground)]">{(f.fileSize / 1024).toFixed(0)}KB · {f.chunkCount} 块</span>
              {editable && f.status === 'FAILED' && (
                <button
                  type="button"
                  className="neu-btn-xs"
                  title={f.error ? `失败原因：${f.error}（点击重试）` : '重新解析'}
                  onClick={() => void handleRetry(kb.id, f)}
                >
                  <RotateCw size={12} />重试
                </button>
              )}
              {editable && (
                <button
                  type="button"
                  className="neu-btn-xs is-danger"
                  title="删除文件"
                  onClick={async () => {
                    if (!window.confirm(`确认删除《${f.fileName}》？`)) return;
                    setBusyId(kb.id);
                    try { await deleteKnowledgeFile(kb.id, f.id); toast.success('已删除'); await load(); }
                    catch (e) { toast.error(e instanceof Error ? e.message : '删除失败'); }
                    finally { setBusyId(null); }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} size="md">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f && uploadKbRef.current) void handleUpload(uploadKbRef.current, f);
        }}
      />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-bold text-[color:var(--foreground)]">知识库</h3>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">上传自己的资料，水叮当回答时自动检索引用；「所有人可用」的库全体用户可检索</p>
        </div>
      </div>

      {/* 新建 */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新知识库名称（如：采购管理制度）"
          className="workbench-input flex-1 min-w-[200px] text-sm"
        />
        <select
          value={newShared ? 'shared' : 'private'}
          onChange={(e) => setNewShared(e.target.value === 'shared')}
          className="workbench-input w-[130px] text-sm"
        >
          <option value="private">仅自己</option>
          <option value="shared">所有人</option>
        </select>
        <button type="button" className="neu-btn-soft gap-1" disabled={creating} onClick={() => void handleCreate()}>
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}新建
        </button>
      </div>

      <div className="wb-section-rule" />

      {loading ? (
        <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">
          <Loader2 size={16} className="inline animate-spin mr-2" />加载中…
        </div>
      ) : (
        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">我的知识库（{mine.length}）</p>
            <div className="space-y-3">{mine.map((kb) => renderCard(kb, true))}</div>
            {mine.length === 0 && <p className="text-xs text-[var(--muted-foreground)]">还没有知识库，先新建一个再上传资料</p>}
          </div>
          {shared.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">共享知识库（{shared.length}）</p>
              <div className="space-y-3">{shared.map((kb) => renderCard(kb, false))}</div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
