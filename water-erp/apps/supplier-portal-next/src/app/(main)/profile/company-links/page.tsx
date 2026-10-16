"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { UnitSearchSelect } from "@/components/registration/unit-search-select";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { supplierCompanyLinksApi, type CompanyLinkView } from "@/lib/api/supplier";
// UnitSearchSelect 的 neumorphic 触发器样式（uss-shadow-*）在 register2.css——须随组件引入
import "@/styles/pages/register2.css";

const STATUS_LABEL: Record<CompanyLinkView["status"], string> = {
  PENDING: "审批中",
  APPROVED: "已在库",
  REJECTED: "未通过",
  DISABLED: "已停用",
};
const STAGE_LABEL: Record<string, string> = { STAFF: "初审", LEADER: "复审", ADMIN: "终审" };

/** 状态 → sp-status 色档（globals.css，与个人中心企业状态同语言） */
const STATUS_TONE: Record<CompanyLinkView["status"], string> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  DISABLED: "disabled",
};

/**
 * 公司归属管理（多公司归属 2026-10-16）：供应商自主申请加入多家公司的供应商库，
 * 申请经该公司 STAFF/LEADER/ADMIN 三级审批；唯一通道=本页申请（注册/导入不再直接归属）。
 */
export default function CompanyLinksPage() {
  const [links, setLinks] = useState<CompanyLinkView[]>([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 挂载/申请后拉取（与 dashboard 页 `void load()` 同款；set-state-in-effect 警告为全库既有容忍项）
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setLinks(await supplierCompanyLinksApi.my());
    } catch {
      toast.error("归属列表加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function apply() {
    if (!company) {
      toast.warning("请选择要加入的公司");
      return;
    }
    setSubmitting(true);
    try {
      // UnitSearchSelect 按名称选择（62 家名单）；DTO companyId/companyName 二选一——
      // 传名称，后端只读解析不建档（重复申请/已加入等错误码由后端裁决，此处透出其 message）
      await supplierCompanyLinksApi.apply({ companyName: company, note: note.trim() || undefined });
      toast.success("申请已提交，等待该公司初审/复审/终审三级审批");
      setCompany("");
      setNote("");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <SpPageHero
        icon={Building2}
        title="公司归属管理"
        sub="贵司可加入多家公司的供应商库，接收其采购邀请；申请将经该公司初审/复审/终审三级审批"
      />

      {/* 申请加入 */}
      <section className="mt-4 rounded-2xl border border-black/5 bg-white p-5">
        <h2 className="text-sm font-medium">申请加入公司</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <UnitSearchSelect value={company} onChange={setCompany} />
          {/* 与 UnitSearchSelect 触发器同规格（52px 内凹），同行两列等高 */}
          <input
            className="uss-shadow-sunk w-full"
            style={{ height: 52, borderRadius: 14, padding: "0 16px", border: "none", outline: "none", fontSize: 15, background: "var(--surface, oklch(0.965 0.012 252))", color: "var(--reg-ink, #1e293b)" }}
            placeholder="申请说明（选填，如：希望参与贵司水务项目）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
          />
        </div>
        <div className="mt-4">
          <SpButton variant="primary" onClick={() => void apply()} disabled={submitting || !company}>
            {submitting ? "提交中…" : "提交申请"}
          </SpButton>
        </div>
      </section>

      {/* 归属列表 */}
      <section className="mt-6 space-y-3">
        {loading ? (
          <LoadingBlock text="正在加载归属记录…" />
        ) : links.length === 0 ? (
          <EmptyState icon={Building2} title="尚无公司归属记录" desc="通过上方「申请加入公司」加入该公司的供应商库" />
        ) : (
          links.map((l) => (
            <article key={l.id} className="rounded-2xl border border-black/5 bg-white p-4">
              <header className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{l.companyName}</span>
                  {l.isPrimary && (
                    <span className="rounded bg-black/5 px-1.5 py-0.5 text-xs text-[var(--muted-foreground)]">主归属</span>
                  )}
                </div>
                <span
                  className={cn("sp-status whitespace-nowrap", STATUS_TONE[l.status])}
                >
                  {STATUS_LABEL[l.status]}
                  {l.status === "PENDING" && l.reviewStage && STAGE_LABEL[l.reviewStage]
                    ? `（${STAGE_LABEL[l.reviewStage]}）`
                    : ""}
                </span>
              </header>
              {l.note && <p className="mt-1 text-sm text-[var(--muted-foreground)]">说明：{l.note}</p>}
              {l.status === "REJECTED" && l.rejectReason && (
                <p className="mt-1 text-sm text-[var(--danger)]">原因：{l.rejectReason}</p>
              )}
              {l.status === "REJECTED" && (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  重新提交申请时在上方选择同一公司即可（原申请记录复用）
                </p>
              )}
              {l.appliedAt && (
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">申请时间：{l.appliedAt.slice(0, 10)}</p>
              )}
            </article>
          ))
        )}
      </section>
    </>
  );
}
