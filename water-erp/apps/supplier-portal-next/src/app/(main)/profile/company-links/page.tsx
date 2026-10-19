"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, ClipboardList, Plus } from "lucide-react";
import { toast } from "sonner";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  CompanyLinkApplyDialog,
  CompanyLinkProgressDialog,
  countPending,
} from "@/components/shell/company-links-dialog";
import { supplierCompanyLinksApi, type CompanyLinkView } from "@/lib/api/supplier";

const STATUS_LABEL: Record<CompanyLinkView["status"], string> = {
  PENDING: "审批中",
  APPROVED: "已在库",
  REJECTED: "未通过",
  DISABLED: "已停用",
};
/** 状态 → sp-status 色档（globals.css，与个人中心企业状态同语言） */
const STATUS_TONE: Record<CompanyLinkView["status"], string> = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  DISABLED: "disabled",
};

/** 公司着色调板（2026-10-19 用户裁定：各公司卡片轻微色彩区分，非纯色覆盖）——
 *  六档低饱和 oklch 色调（蓝/水青/紫/赭/绿/青蓝），经 --card-color 驱动图标井+渐变轻染+角部光晕；
 *  状态胶囊（sp-status）保持语义色，不参与公司着色。 */
const CARD_TONES = [
  "oklch(0.62 0.11 258)",
  "oklch(0.6 0.1 175)",
  "oklch(0.62 0.1 300)",
  "oklch(0.64 0.11 30)",
  "oklch(0.63 0.1 145)",
  "oklch(0.63 0.1 220)",
] as const;

/** 公司名 → 确定性色调（同名恒色、异名大概率异色） */
function companyTone(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 997;
  return CARD_TONES[h % CARD_TONES.length];
}

/**
 * 公司归属管理（多公司归属 2026-10-16）：正文只展示目前归属的公司（已在库/已停用）；
 * 「申请加入公司」「审核进度」为标题栏右侧按钮（同「企业信息 · 申请资料变更」模式）。
 * 申请走该公司 STAFF/LEADER/ADMIN 三级审批；唯一通道=供应商自主申请。
 */
export default function CompanyLinksPage() {
  const [links, setLinks] = useState<CompanyLinkView[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyOpen, setApplyOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [prefillCompany, setPrefillCompany] = useState<string | undefined>(undefined);

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

  const pendingCount = countPending(links);
  // 正文 = 目前归属的公司（已在库/已停用）；审批中/未通过在「审核进度」窗查看
  const affiliations = links.filter((l) => l.status === "APPROVED" || l.status === "DISABLED");

  return (
    <>
      <SpPageHero
        icon={Building2}
        title="公司归属管理"
        sub="贵司可加入多家公司的供应商库，接收其采购邀请；申请将经该公司初审/复审/终审三级审批"
        actions={(
          // 相邻双按钮一律包 neu-btn-group（cgzxui：primary 44px 与 soft 38px 统一为 38px 等高）
          <span className="neu-btn-group">
            <SpButton variant="primary" water icon={Plus} onClick={() => { setPrefillCompany(undefined); setApplyOpen(true); }}>
              申请加入公司
            </SpButton>
            <SpButton icon={ClipboardList} onClick={() => setProgressOpen(true)}>
              审核进度{pendingCount > 0 ? `（${pendingCount}）` : ""}
            </SpButton>
          </span>
        )}
      />

      {/* 目前归属的公司 */}
      <section className="mt-6 space-y-3">
        {loading ? (
          <LoadingBlock text="正在加载归属记录…" />
        ) : affiliations.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="尚无归属公司"
            desc="点击右上「申请加入公司」，经该公司三级审批后入库"
          />
        ) : (
          affiliations.map((l) => (
            // --card-color 为 CSS 变量传递（cgzxui 唯一允许的内联 style 通道，同 flow-chip）
            <article
              key={l.id}
              className="clq-aff-card"
              style={{ "--card-color": companyTone(l.companyName) } as React.CSSProperties}
            >
              <div className="clq-aff-well" aria-hidden="true">
                <Building2 size={16} strokeWidth={1.8} />
              </div>
              <div className="clq-aff-body">
                <header className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.companyName}</span>
                    {l.isPrimary && <span className="clq-tag">主归属</span>}
                  </div>
                  <span className={cn("sp-status whitespace-nowrap", STATUS_TONE[l.status])}>
                    {STATUS_LABEL[l.status]}
                  </span>
                </header>
                {l.status === "DISABLED" && (
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                    该公司已将贵司在其库内停用，请联系该公司恢复
                  </p>
                )}
                {l.appliedAt && (
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">入库时间：{l.appliedAt.slice(0, 10)}</p>
                )}
              </div>
            </article>
          ))
        )}
      </section>

      {/* 申请加入公司（标题栏按钮弹出；重新申请由审核进度窗预填） */}
      <CompanyLinkApplyDialog
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        initialCompany={prefillCompany}
        onApplied={() => {
          void reload();
          setProgressOpen(true); // 提交后直跳审核进度，即时看到三级进度
        }}
      />
      {/* 审核进度（审批中三级进度 + 未通过原因/重新申请） */}
      <CompanyLinkProgressDialog
        open={progressOpen}
        onClose={() => setProgressOpen(false)}
        links={links}
        onReapply={(companyName) => {
          setProgressOpen(false);
          setPrefillCompany(companyName);
          setApplyOpen(true);
        }}
      />
    </>
  );
}
