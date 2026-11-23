"use client";

import { useEffect, useMemo, useState } from "react";
import { LEVEL_LABEL, STAGE_COLOR, STAGE_LABEL } from "@water-erp/shared";
import { BottomSheet } from "./bottom-sheet";
import { Chip } from "./chip";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";
import { Badge, Field, Group, Timeline, TONE_TEXT, fmtDate, toneOfLevel, type TimelineEvent, type Tone } from "./detail-primitives";
import { normalizeEnterpriseType } from "@/lib/enterprise-type";
import {
  SUPPLIER_STATUS_LABELS,
  fetchSupplierBidProjects,
  fetchSupplierDetail,
  fetchSupplierEvaluations,
  fetchSupplierTimeline,
  type SupplierBidProject,
  type SupplierDetail,
  type SupplierEvaluation,
  type SupplierItem,
  type SupplierTimelineEvent,
} from "@/lib/api/supplier";

/**
 * 供应商详情弹层（2026-11-23 用户裁定：对齐 :3005 supplier/[id] 的信息量）——
 * 五区 Chip 切换：基本信息（企业信息/联系方式/联系人/业务标签/银行账户/主体业绩）、关键节点
 * （注册/审核/状态变更/绩效评价/参与项目合并时间轴，同 :3005 画像与动态）、资质材料、参与情况、履约评价。
 * 数据源 /supplier/:id（+ /timeline、/evaluations、/evaluation-projects），PII 管理端默认掩码直显；
 * 邀请回执为 :3005 操作面不载。调用方以 key=供应商 id 挂载——切换自然重置状态。
 */

type Tab = "info" | "timeline" | "qualifications" | "participation" | "evaluations";
const TABS: { key: Tab; label: string }[] = [
  { key: "info", label: "基本信息" },
  { key: "timeline", label: "关键节点" },
  { key: "qualifications", label: "资质材料" },
  { key: "participation", label: "参与情况" },
  { key: "evaluations", label: "履约评价" },
];

const STATUS_TONE: Record<string, Tone> = { APPROVED: "green", PENDING: "blue", RETURNED: "orange", REJECTED: "red", DISABLED: "gray", BLACKLIST: "red" };

/* 时间线事件类型 → 展示名/tone（与 :3005 SupplierTimeline 同语义） */
const TIMELINE_TONE: Record<string, Tone> = {
  register: "blue",
  SUPPLIER_APPROVED: "green",
  SUPPLIER_REJECTED: "red",
  SUPPLIER_RETURNED: "orange",
  SUPPLIER_DISABLED: "gray",
  SUPPLIER_BLACKLIST: "red",
  SUPPLIER_RESTORED: "green",
  SUPPLIER_RESUBMITTED: "blue",
  SUPPLIER_REACTIVATED: "green",
  SUPPLIER_CHANGE_APPROVED: "green",
  SUPPLIER_CHANGE_REJECTED: "red",
  SUPPLIER_CONVERTED_REGULAR: "green",
  SUPPLIER_TAGS_UPDATED: "gray",
  evaluation: "gold",
  SUPPLIER_EVALUATION_CREATED: "gold",
  bid: "blue",
};

/** 资质有效期判定（与 :3005 资质材料同口径：null=长期；<0 已过期；<90d 即将到期） */
function validityOf(validTo?: string | null): { label: string; tone: Tone } {
  if (!validTo) return { label: "长期有效", tone: "green" };
  const diff = (new Date(validTo).getTime() - Date.now()) / 86_400_000;
  if (diff < 0) return { label: "已过期", tone: "red" };
  if (diff < 90) return { label: "即将到期", tone: "orange" };
  return { label: "有效", tone: "green" };
}

const maskAccount = (no?: string | null) => (no ? (no.length > 8 ? `${no.slice(0, 4)} **** ${no.slice(-4)}` : no) : "—");

export function SupplierDetailSheet({
  supplierId,
  baseline,
  onClose,
}: {
  supplierId: string | null;
  /** 列表行（开层瞬间先用它渲染抬头，详情到达后覆盖） */
  baseline?: SupplierItem;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<SupplierDetail | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<SupplierTimelineEvent[]>([]);
  const [evaluations, setEvaluations] = useState<SupplierEvaluation[]>([]);
  const [bids, setBids] = useState<SupplierBidProject[]>([]);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("info");

  useEffect(() => {
    if (!supplierId) return;
    let active = true;
    Promise.all([
      fetchSupplierDetail(supplierId),
      fetchSupplierTimeline(supplierId).catch(() => [] as SupplierTimelineEvent[]),
      fetchSupplierEvaluations(supplierId).catch(() => [] as SupplierEvaluation[]),
      fetchSupplierBidProjects(supplierId).catch(() => [] as SupplierBidProject[]),
    ])
      .then(([d, tl, ev, bd]) => {
        if (!active) return;
        setDetail(d);
        setTimelineEvents(tl);
        setEvaluations(ev);
        setBids(bd);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [supplierId]);

  const name = detail?.name ?? baseline?.name ?? "";
  const industry = detail?.industry ?? baseline?.industry ?? null;
  const entType = normalizeEnterpriseType(detail?.enterpriseType ?? baseline?.enterpriseType);
  const region = detail?.region ?? baseline?.region ?? null;

  /* 关键节点：后端升序 → 倒序渲染（最新在前） */
  const timeline = useMemo<TimelineEvent[]>(
    () =>
      [...timelineEvents]
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .map((e) => ({ time: e.at, type: e.label, title: e.grade ? `${LEVEL_LABEL[e.grade] || e.grade}级` : e.detail, detail: e.grade ? e.detail : "", tone: TIMELINE_TONE[e.type] ?? "gray" })),
    [timelineEvents],
  );

  const quals = detail?.qualifications ?? [];
  const contacts = detail?.contacts ?? [];

  return (
    <BottomSheet
      open={!!supplierId}
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {name}
          {detail?.supplierNo ? (
            <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--muted-foreground)_9%,transparent)] px-1.5 py-0.5 font-mono text-[12px] font-medium tracking-wide text-[var(--muted-foreground)]">
              {detail.supplierNo}
            </span>
          ) : null}
        </span>
      }
    >
      {error ? (
        <EmptyState text="供应商详情加载失败，请关闭后重试" />
      ) : !detail ? (
        <>
          <div className="mb-3 text-[13px] text-[var(--muted-foreground)]">{[industry, entType, region].filter(Boolean).join(" · ") || "—"}</div>
          <Skeleton lines={6} height={44} />
        </>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-[13px] leading-relaxed text-[var(--muted-foreground)]">{[industry, entType, region].filter(Boolean).join(" · ") || "—"}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
              <Badge tone={STATUS_TONE[detail.status] ?? "gray"}>{SUPPLIER_STATUS_LABELS[detail.status] ?? detail.status}</Badge>
              {detail.isTemporary ? <Badge tone="orange">临时供应商{detail.temporaryExpiresAt ? ` · 至 ${fmtDate(detail.temporaryExpiresAt)}` : ""}</Badge> : null}
              <span className="rounded-[8px] bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] px-2 py-1 font-semibold tabular-nums text-[var(--muted-foreground)]">注册 {fmtDate(detail.createdAt)}</span>
              {detail._avgGrade ? <Badge tone={toneOfLevel(detail._avgGrade)} solid>{detail._avgGrade} · {LEVEL_LABEL[detail._avgGrade] ?? ""}</Badge> : null}
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none]">
            {TABS.map((t) => (
              <Chip key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
                {t.label}
                {t.key === "timeline" && timeline.length ? ` ${timeline.length}` : ""}
                {t.key === "qualifications" && quals.length ? ` ${quals.length}` : ""}
                {t.key === "participation" && bids.length ? ` ${bids.length}` : ""}
                {t.key === "evaluations" && evaluations.length ? ` ${evaluations.length}` : ""}
              </Chip>
            ))}
          </div>

          {tab === "info" ? (
            <div className="space-y-2.5">
              <Group title="企业信息">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <Field label="统一社会信用代码" value={detail.creditCode} mono full />
                  <Field label="机构代码" value={detail.organizationCode} mono />
                  <Field label="企业类型" value={entType} />
                  <Field label="法定代表人" value={detail.legalPerson} />
                  <Field label="注册资金" value={detail.registeredCapital} />
                  <Field label="成立日期" value={detail.establishedDate ? fmtDate(detail.establishedDate) : null} />
                  <Field label="行政区域" value={detail.region} />
                  <Field label="国别" value={detail.country} />
                  <Field label="归属公司" value={detail.companyName} full />
                </div>
              </Group>

              <Group title="联系方式">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <Field label="公司邮箱" value={detail.companyEmail} full />
                  <Field label="公司官网" value={detail.companyWebsite} full />
                  <Field label="注册地址" value={detail.registeredAddress} full />
                  <Field label="详细地址" value={detail.detailedAddress} full />
                  <Field label="主要经营业务范围" value={detail.businessScope} full />
                  <Field label="企业简介" value={detail.companyProfile} full />
                </div>
              </Group>

              <Group title={`联系人${contacts.length ? ` · ${contacts.length} 人` : ""}`}>
                {contacts.length ? (
                  <div className="space-y-1.5">
                    {contacts.map((c) => (
                      <div key={c.id} className="flex items-center gap-2 text-[14px]">
                        <span className="shrink-0 font-semibold text-[var(--foreground)]">{c.name}{c.isPrimary ? <span className="ml-1 text-[11px] font-bold text-[var(--accent)]">主</span> : null}</span>
                        <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--muted-foreground)]">{[c.position, c.phone, c.email].filter(Boolean).join(" · ") || "—"}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-[var(--muted-foreground)]">暂无联系人</div>
                )}
              </Group>

              <Group title="业务标签">
                {detail.tags?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {detail.tags.map((t, i) => (
                      <span key={i} className="rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-[12px] font-semibold text-[var(--accent)]">{t}</span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-[var(--muted-foreground)]">暂无业务标签</div>
                )}
              </Group>

              <Group title={`银行账户${detail.bankAccounts?.length ? ` · ${detail.bankAccounts.length}` : ""}`}>
                {detail.bankAccounts?.length ? (
                  <div className="space-y-1.5">
                    {detail.bankAccounts.map((b) => (
                      <div key={b.id} className="rounded-[10px] bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)] px-2.5 py-2 text-[13px]">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-semibold text-[var(--foreground)]">{b.accountName}</span>
                          {b.isDefault ? <Badge tone="green">默认账户</Badge> : null}
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-[var(--muted-foreground)]">{[b.bankName, b.bankBranch].filter(Boolean).join(" · ") || "—"}</div>
                        <div className="mt-0.5 font-mono text-[12px] tabular-nums text-[var(--foreground)]">{maskAccount(b.accountNo)}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-[var(--muted-foreground)]">暂无银行账户信息</div>
                )}
              </Group>

              <Group title={`主体业绩${detail.performances?.length ? ` · ${detail.performances.length}` : ""}`}>
                {detail.performances?.length ? (
                  <div className="space-y-1.5">
                    {detail.performances.map((p) => (
                      <div key={p.id} className="text-[13px]">
                        <div className="flex items-start justify-between gap-2">
                          <span className="min-w-0 break-words font-semibold text-[var(--foreground)]">{p.projectName}</span>
                          <span className="shrink-0 font-semibold tabular-nums text-[var(--foreground)]">{p.contractAmount || "—"}</span>
                        </div>
                        <div className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">{[p.clientName, p.signDate ? `签订 ${fmtDate(p.signDate)}` : null].filter(Boolean).join(" · ") || "—"}</div>
                        {p.description ? <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-[var(--muted-foreground)]">{p.description}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-[var(--muted-foreground)]">暂无主体业绩</div>
                )}
              </Group>
            </div>
          ) : null}

          {tab === "timeline" ? <Timeline events={timeline} empty="暂无关键节点" /> : null}

          {tab === "qualifications" ? (
            quals.length ? (
              <div className="space-y-1.5">
                {quals.map((q) => {
                  const v = validityOf(q.validTo);
                  return (
                    <div key={q.id} className="rounded-[12px] m-tile px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 break-words text-[14px] font-bold leading-snug text-[var(--foreground)]">{q.name}</span>
                        <Badge tone={v.tone}>{v.label}</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[var(--muted-foreground)]">
                        <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-1.5 py-0.5 text-[var(--accent)]">{q.type}</span>
                        <span className="tabular-nums">有效期 {q.validFrom ? fmtDate(q.validFrom) : "—"} ~ {q.validTo ? fmtDate(q.validTo) : "长期"}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState text="暂无资质材料" />
            )
          ) : null}

          {tab === "participation" ? (
            bids.length ? (
              <div className="space-y-1.5">
                {bids.map((b) => {
                  const stageColor = STAGE_COLOR[b.project.stage] || "var(--muted-foreground)";
                  const r = b.result;
                  return (
                    <div key={b.projectId} className="rounded-[12px] m-tile px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-bold text-[var(--foreground)]">{b.project.name}</div>
                          <div className="mt-0.5 truncate text-[12px] tabular-nums text-[var(--muted-foreground)]">
                            {b.project.procurementMethod}
                            {b.project.openTime ? ` · 开标 ${fmtDate(b.project.openTime)}` : ""}
                          </div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: stageColor, background: `color-mix(in oklch, ${stageColor} 10%, transparent)` }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: stageColor }} />
                          {STAGE_LABEL[b.project.stage] || b.project.stage}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-[var(--muted-foreground)]">下载 <span className="font-semibold text-[var(--foreground)]">{b.downloadStatus || "—"}</span></span>
                        <span className="text-[var(--muted-foreground)]">投递 <span className={`font-semibold ${b.submitStatus === "已提交" ? "text-[var(--success)]" : "text-[var(--foreground)]"}`}>{b.submitStatus || "—"}</span></span>
                        <span className="text-[var(--muted-foreground)]">解密 <span className="font-semibold text-[var(--foreground)]">{b.decryptStatus || "—"}</span></span>
                        {r ? (
                          <>
                            {r.disqualified ? <Badge tone="red">已废标</Badge> : r.recommended ? <Badge tone="green">第一候选人</Badge> : null}
                            {r.rank != null ? <Badge tone={r.rank === 1 ? "gold" : "blue"}>排名 {r.rank}</Badge> : null}
                            {r.bidPrice != null ? <span className="ml-auto font-bold tabular-nums text-[var(--foreground)]">报价 ¥{r.bidPrice.toLocaleString("zh-CN")}</span> : null}
                          </>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState text="暂无参评项目" />
            )
          ) : null}

          {tab === "evaluations" ? (
            evaluations.length ? (
              <div className="space-y-2">
                {evaluations.map((ev) => (
                  <div key={ev.id} className="rounded-[12px] m-tile px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] tabular-nums text-[var(--muted-foreground)]">{fmtDate(ev.createdAt)}</span>
                      <Badge tone={toneOfLevel(ev.finalGrade)} solid>
                        {ev.finalGrade} · {LEVEL_LABEL[ev.finalGrade] || ev.finalGrade}
                      </Badge>
                      <span className="ml-auto min-w-0 truncate text-[12px] text-[var(--muted-foreground)]">评价人 {ev.evaluator?.displayName || "—"}</span>
                    </div>
                    {ev.project?.name ? <div className="mt-1 truncate text-[12px] text-[var(--muted-foreground)]">关联项目：{ev.project.name}</div> : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                      {([["完整", ev.completenessGrade], ["响应", ev.responsivenessGrade], ["合作", ev.cooperationGrade], ["合规", ev.complianceGrade]] as [string, string][]).map(([k, g]) => (
                        <span key={k} className="rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_7%,transparent)] px-2 py-0.5 text-[var(--muted-foreground)]">
                          {k} <span className="font-mono font-bold" style={{ color: TONE_TEXT[toneOfLevel(g)] }}>{g || "—"}</span>
                        </span>
                      ))}
                    </div>
                    {ev.comment ? <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--foreground)]">{ev.comment}</p> : null}
                    {ev.reviewReason ? <p className="mt-1 text-[11px] text-[var(--warning)]">复评事由：{ev.reviewReason}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无履约评价" />
            )
          ) : null}
        </div>
      )}
    </BottomSheet>
  );
}
