"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Bell, Inbox, MessageSquareWarning, Plus, TriangleAlert } from "lucide-react";
import { objectionApi, type SupplierObjection } from "@/lib/api/objection";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton, SpDialog, SpInput, SpSelect, SpTextarea } from "@/components/ui";
import { toast } from "sonner";
import "@/styles/pages/objections.css";

/** C6（GB/T 43711 4.2.2）：供应商对采购文件、资格预审结果、采购结果的异议在线提交与答复查看。 */
const PHASE_LABEL: Record<string, string> = {
  document: "采购文件",
  prequalification: "资格预审",
  result: "采购结果",
};
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  open: { label: "待答复", cls: "st-open" },
  answered: { label: "已答复", cls: "st-answered" },
  complaint: { label: "已转投诉", cls: "st-complaint" },
  closed: { label: "已办结", cls: "st-closed" },
};

export default function ObjectionsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [items, setItems] = useState<SupplierObjection[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ phase: "result", projectCode: "", title: "", content: "" });

  const fetchList = async () => {
    setItems(await objectionApi.listMine());
  };

  useEffect(() => {
    (async () => {
      try { await fetchList(); } catch { setError(true); } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = async () => {
    setError(false); setLoading(true);
    try { await fetchList(); } catch { setError(true); } finally { setLoading(false); }
  };

  const submit = async () => {
    if (!form.title.trim() || !form.content.trim()) { toast.error("请填写异议标题与具体内容"); return; }
    if (!form.projectCode.trim()) { toast.error("请填写异议对象的项目编号（见公告）"); return; }
    setBusy(true);
    try {
      await objectionApi.create(form);
      toast.success("异议已提交，采购人将在线答复");
      setDialogOpen(false);
      setForm({ phase: "result", projectCode: "", title: "", content: "" });
      await fetchList();
    } catch {
      /* 全局 toast 已提示 */
    } finally { setBusy(false); }
  };

  if (error && !loading) {
    return (
      <>
        <SpPageHero icon={MessageSquareWarning} title="异议与投诉" sub="对采购文件、资格预审结果、采购结果提出异议" />
        <div className="sp-error-block">
          <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">数据加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton onClick={retry}>重试</SpButton>
        </div>
      </>
    );
  }

  return (
    <>
      <SpPageHero
        icon={MessageSquareWarning}
        title="异议与投诉"
        sub="对采购文件、资格预审结果、采购结果有异议的，按公告约定在线提出（GB/T 43711 4.2.2）"
        actions={<SpButton variant="primary" onClick={() => setDialogOpen(true)}><Plus size={15} /> 提出异议</SpButton>}
      />

      {loading ? (
        <LoadingBlock text="正在加载异议记录…" />
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} title="暂无异议记录" desc="如对采购文件、资格预审结果或采购结果有异议，可点击右上角「提出异议」在线提交" />
      ) : (
        <div className="obj-list">
          {items.map(o => (
            <div key={o.id} className="obj-card">
              <div className="obj-head">
                <span className={`obj-status ${STATUS_LABEL[o.status]?.cls ?? ""}`}>{STATUS_LABEL[o.status]?.label ?? o.status}</span>
                <span className="obj-phase">{PHASE_LABEL[o.phase] ?? o.phase}</span>
                <span className="obj-code">{o.projectCode || "—"}</span>
                <span className="obj-date">{dayjs(o.createdAt).format("YYYY-MM-DD HH:mm")}</span>
              </div>
              <div className="obj-title">{o.title}</div>
              <p className="obj-content">{o.content}</p>
              {o.answer && (
                <div className="obj-answer">
                  <span className="obj-answer-label">采购人答复（{o.answeredByName ?? "—"} · {o.answeredAt ? dayjs(o.answeredAt).format("YYYY-MM-DD") : "—"}）</span>
                  <p>{o.answer}</p>
                </div>
              )}
              {o.escalationNote && (
                <div className="obj-escalation">
                  <span className="obj-answer-label">投诉处理记录</span>
                  <p>{o.escalationNote}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <SpDialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="提出异议" width={520}>
        <div className="obj-form">
          <label className="obj-field">
            <span>异议类型</span>
            <SpSelect value={form.phase} onChange={e => setForm({ ...form, phase: e.target.value })}>
              <option value="document">采购文件</option>
              <option value="prequalification">资格预审结果</option>
              <option value="result">采购结果</option>
            </SpSelect>
          </label>
          <label className="obj-field">
            <span>项目编号（见公告）</span>
            <SpInput value={form.projectCode} onChange={e => setForm({ ...form, projectCode: e.target.value })} placeholder="例如 CG-2026-001" />
          </label>
          <label className="obj-field">
            <span>异议标题</span>
            <SpInput value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="简要说明异议事项" />
          </label>
          <label className="obj-field">
            <span>具体内容与理由</span>
            <SpTextarea rows={5} value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} placeholder="请说明事实、依据及请求" />
          </label>
          <div className="obj-form-actions">
            <SpButton onClick={() => setDialogOpen(false)}>取消</SpButton>
            <SpButton variant="primary" onClick={submit} disabled={busy}>{busy ? "提交中…" : "提交异议"}</SpButton>
          </div>
        </div>
      </SpDialog>
    </>
  );
}
