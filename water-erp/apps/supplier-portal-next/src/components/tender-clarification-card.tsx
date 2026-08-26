"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileQuestion, RefreshCw } from "lucide-react";
import { bidApi } from "@/lib/api/bid";

/**
 * W1 澄清与修改（CTS A-80~A-86，供应商侧）：
 * 就招标文件提问（A-80，截止前 10 日）+ 澄清/修改文件下载（A-85，下载即回执 A-86）。
 * 问答全体供应商可见（澄清不涉密）；文件仅已获取招标文件者可下载。
 */
export function TenderClarificationCard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof bidApi.listTenderClarifications>> | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      setData(await bidApi.listTenderClarifications(projectId));
    } catch {
      setData({ questions: [], docs: [] });
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const ask = async () => {
    if (question.trim().length < 5) return;
    setBusy(true);
    try {
      await bidApi.askTenderClarification(projectId, question.trim());
      setQuestion("");
      toast.success("澄清提问已提交");
      await reload();
    } catch (e: unknown) {
      toast.error((e as Error)?.message || "提交失败");
    } finally {
      setBusy(false);
    }
  };

  const download = async (docId: string) => {
    setBusy(true);
    try {
      const r = await bidApi.downloadTenderClarificationDoc(projectId, docId);
      if (r.fileUrl) window.open(r.fileUrl, "_blank");
      toast.success("下载成功，已递交回执");
      await reload();
    } catch (e: unknown) {
      toast.error((e as Error)?.message || "下载失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="neu-card bottom-card">
      <div className="bc-hd flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5">
          <FileQuestion size={14} /> 澄清与修改（就招标文件提问 / 澄清文件下载）
        </span>
        <button onClick={() => void reload()} className="text-[var(--muted-foreground)] hover:opacity-70" title="刷新">
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="就招标文件提出澄清问题（最迟投标截止前 10 日；须已获取招标文件）"
          className="w-full resize-none rounded-[14px] border border-[color-mix(in_oklch,var(--foreground)_10%,transparent)] bg-[var(--surface)] p-3 text-[13px] outline-none focus:border-[var(--accent)]"
        />
        <div className="flex justify-end">
          <button
            onClick={() => void ask()}
            disabled={busy || question.trim().length < 5}
            className="rounded-[10px] bg-[var(--accent)] px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          >
            提交提问
          </button>
        </div>
      </div>

      {data && data.questions.length > 0 && (
        <div className="cq-list mt-3">
          {data.questions.map((q) => (
            <div key={q.id} className="cq-item">
              <div className="cq-head">
                <span className="b-tag b-tag--info">{q.supplierName}</span>
                <span className="cq-time">{new Date(q.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
              </div>
              <div className="cq-text">{q.question}</div>
              {q.answer ? (
                <div className="cq-reply"><span className="b-tag b-tag--success">答复</span><span>{q.answer}</span></div>
              ) : (
                <div className="cq-reply text-[var(--muted-foreground)]">待答复</div>
              )}
            </div>
          ))}
        </div>
      )}

      {data && data.docs.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="cq-desc font-medium">澄清与修改文件（下载即回执）</p>
          {data.docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 rounded-[12px] bg-[var(--surface)] px-3 py-2">
              <span className="text-[13px]">
                第 {d.version} 次 · {d.title}
              </span>
              <div className="flex items-center gap-2">
                {d.receipt && <span className="b-tag b-tag--success">已回执</span>}
                <button
                  onClick={() => void download(d.id)}
                  disabled={busy}
                  className="rounded-[10px] border border-[color-mix(in_oklch,var(--accent)_35%,transparent)] px-3 py-1 text-xs text-[var(--accent)] disabled:opacity-50"
                >
                  {d.receipt ? "重新下载" : "下载并回执"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data && data.questions.length === 0 && data.docs.length === 0 && (
        <div className="bc-empty mt-2">暂无澄清记录</div>
      )}
    </div>
  );
}
