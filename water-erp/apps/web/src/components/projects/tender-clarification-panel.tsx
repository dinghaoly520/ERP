'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileQuestion, Loader2, RefreshCw } from 'lucide-react';
import { ensureBidProject } from '@/lib/api/bid';
import {
  answerClarification, createClarificationDoc, deleteClarificationDoc, getClarifications,
  publishClarificationDoc, type ClarificationWorkbench,
} from '@/lib/api/tender-clarification';

/**
 * W1 招标文件澄清与修改工作台（CTS A-80~A-86）：挂在 PMI 详情。
 * 问答答复（A-81）+ 版本化澄清文件草稿/发布（A-82/83，B-012）+ 回执名单（A-86）。
 * 供应商提问走 :3004；此处是采购中心侧。
 */
export function TenderClarificationPanel({ pmiId }: { pmiId: string }) {
  const [bidProjectId, setBidProjectId] = useState<string | null>(null);
  const [data, setData] = useState<ClarificationWorkbench | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!bidProjectId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getClarifications(bidProjectId));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [bidProjectId]);

  useEffect(() => {
    let alive = true;
    ensureBidProject(pmiId)
      .then(bp => { if (alive) setBidProjectId(bp.id); })
      .catch(e => { if (alive) { setError((e as Error).message); setLoading(false); } });
    return () => { alive = false; };
  }, [pmiId]);

  useEffect(() => { if (bidProjectId) void reload(); }, [bidProjectId, reload]);

  const doAnswer = async (qid: string) => {
    const answer = (answerDraft[qid] ?? '').trim();
    if (!answer || !bidProjectId) return;
    setBusy(true);
    try {
      await answerClarification(bidProjectId, qid, answer);
      setAnswerDraft({ ...answerDraft, [qid]: '' });
      await reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const doCreate = async () => {
    if (title.trim().length < 2 || !bidProjectId) return;
    setBusy(true);
    try {
      await createClarificationDoc(bidProjectId, { title: title.trim() });
      setTitle('');
      await reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const doPublish = async (docId: string) => {
    if (!bidProjectId) return;
    setBusy(true);
    try {
      await publishClarificationDoc(bidProjectId, docId);
      await reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const doDelete = async (docId: string) => {
    if (!bidProjectId) return;
    setBusy(true);
    try {
      await deleteClarificationDoc(bidProjectId, docId);
      await reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <section className="wb-panel p-4 space-y-4">
      <header className="flex items-center justify-between border-b border-black/5 pb-2.5">
        <div className="flex items-center gap-2">
          <FileQuestion size={15} className="text-black/60" />
          <h3 className="text-sm font-semibold tracking-wide">澄清与修改（CTS A-80~86）</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">
            提问 {data?.questions.length ?? 0} · 澄清文件 {data?.docs.length ?? 0}
          </span>
          <button onClick={() => void reload()} className="neu-btn-xs" title="刷新">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}

      <div className="space-y-2.5">
        {(data?.questions ?? []).map(q => (
          <div key={q.id} className="rounded-xl bg-[color-mix(in_oklch,var(--foreground)_4%,transparent)] p-3 space-y-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-medium">{q.supplierName}</span>
              <span className="text-[var(--muted-foreground)]">{new Date(q.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
            </div>
            <p className="text-sm">{q.question}</p>
            {q.answer ? (
              <p className="border-l-2 border-black/10 pl-2 text-sm text-[var(--foreground)]/70">答复：{q.answer}</p>
            ) : (
              <div className="flex gap-1.5">
                <input
                  className="workbench-input flex-1 text-sm" placeholder="答复内容…"
                  value={answerDraft[q.id] ?? ''}
                  onChange={e => setAnswerDraft({ ...answerDraft, [q.id]: e.target.value })}
                />
                <button className="neu-btn-xs" disabled={busy} onClick={() => void doAnswer(q.id)}>答复</button>
              </div>
            )}
          </div>
        ))}
        {data && data.questions.length === 0 && !loading && (
          <p className="text-xs text-[var(--muted-foreground)]">暂无澄清提问（供应商经 :3004「澄清与修改」提交）</p>
        )}
      </div>

      <div className="space-y-2.5 border-t border-black/5 pt-3">
        <div className="flex gap-1.5">
          <input
            className="workbench-input flex-1 text-sm"
            placeholder="澄清文件标题（发布最迟投标截止前 15 日）"
            value={title} onChange={e => setTitle(e.target.value)}
          />
          <button className="neu-btn-xs" disabled={busy || title.trim().length < 2} onClick={() => void doCreate()}>新建草稿</button>
        </div>
        {(data?.docs ?? []).map(d => (
          <div key={d.id} className="rounded-xl bg-[color-mix(in_oklch,var(--foreground)_4%,transparent)] p-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">第 {d.version} 次 · {d.title}</span>
              <div className="flex items-center gap-1.5">
                {d.status === '已发布' ? (
                  <span className="text-xs text-emerald-700">已发布 · 回执 {d.receipts.length}</span>
                ) : (
                  <>
                    <button className="neu-btn-xs is-danger" disabled={busy} onClick={() => void doDelete(d.id)}>删除</button>
                    <button className="neu-btn-xs" disabled={busy} onClick={() => void doPublish(d.id)}>发布</button>
                  </>
                )}
              </div>
            </div>
            {d.content && <p className="text-xs text-[var(--muted-foreground)] line-clamp-2">{d.content}</p>}
            {d.status === '已发布' && d.receipts.length > 0 && (
              <p className="text-[11px] text-[var(--muted-foreground)]">
                已回执：{d.receipts.map(r => `${r.supplierName}（${new Date(r.receiptedAt).toLocaleDateString('zh-CN')}）`).join('、')}
              </p>
            )}
          </div>
        ))}
        {busy && <p className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]"><Loader2 size={12} className="animate-spin" /> 处理中…</p>}
      </div>
    </section>
  );
}
