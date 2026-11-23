"use client";

import { useEffect, useMemo, useState } from "react";
import { LEVEL_LABEL, LIFECYCLE_LABELS, lifecycleLabelOf, STAGE_COLOR, STAGE_LABEL } from "@water-erp/shared";
import { BottomSheet } from "./bottom-sheet";
import { Chip } from "./chip";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";
import { barFill } from "@/lib/bar-style";
import {
  fetchExpertDetail,
  fetchExpertEvaluations,
  fetchExpertViolations,
  type ExpertDetail,
  type ExpertEvaluation,
  type ExpertViolation,
  type ExpertListItem,
} from "@/lib/api/expert";

/**
 * 专家详情弹层（2026-11-23 用户裁定：对齐 :3005 expert/[id] 的信息量）——
 * 四区 Chip 切换：基本信息（职业资格/身份与联系/工作归属/综合评价）、关键节点（入库/项目分配/
 * 履职评价/违规记录合并时间轴，同 :3005 大事记）、评价历史、评审项目（邀请信用 + 分配行）。
 * 数据源同为 /expert-admin/:id（+ /evaluations、/violations），PII 管理端默认掩码直显；
 * 专家画像/AI 采纳率/风险预警/通知偏好四 tab 为 :3005 操作面，移动端只读不载。
 * 调用方以 key=专家 id 挂载——切换专家自然重置状态，effect 内不做同步 setState。
 */

type Tab = "info" | "timeline" | "evaluations" | "projects";
const TABS: { key: Tab; label: string }[] = [
  { key: "info", label: "基本信息" },
  { key: "timeline", label: "关键节点" },
  { key: "evaluations", label: "评价历史" },
  { key: "projects", label: "评审项目" },
];

/* 日期本地时区格式化（禁 UTC 切片——凌晨落库会差一天） */
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("zh-CN") : "—");
const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const TONE_TEXT: Record<string, string> = {
  green: "var(--success)",
  blue: "var(--accent)",
  orange: "var(--warning)",
  red: "var(--danger)",
  gray: "var(--muted-foreground)",
};
type Tone = keyof typeof TONE_TEXT;
const levelTone = (g?: string | null): Tone => (g === "A" ? "green" : g === "B" ? "blue" : g === "E" ? "red" : g === "C" || g === "D" ? "orange" : "gray");

/** 库况六态 → tone（与 :3005 stateBadgeOf 同映射） */
function lifecycleBadgeOf(d: ExpertDetail): { label: string; tone: Tone } | null {
  const label = lifecycleLabelOf(d.expertProfile ?? {}, d.busyState ?? "");
  if (!label) return null;
  const tone: Tone =
    label === LIFECYCLE_LABELS.idle ? "green"
    : label === LIFECYCLE_LABELS.evaluating ? "orange"
    : label === LIFECYCLE_LABELS.assigned ? "blue"
    : label === LIFECYCLE_LABELS.alternate ? "blue"
    : "gray";
  return { label, tone };
}

function Badge({ tone, children, solid }: { tone: Tone; children: React.ReactNode; solid?: boolean }) {
  const c = TONE_TEXT[tone];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold"
      style={solid ? { background: c, color: "oklch(1 0 0)" } : { background: `color-mix(in oklch, ${c} 12%, transparent)`, color: c }}
    >
      {children}
    </span>
  );
}

/* 紧凑定义项：label 小字 + 值（空值淡化显 —），与 :3005 InfoField 同语义 */
function Field({ label, value, mono, full }: { label: string; value?: React.ReactNode; mono?: boolean; full?: boolean }) {
  const empty = value == null || (typeof value === "string" && !value.trim());
  return (
    <div className={`min-w-0 ${full ? "col-span-full" : ""}`}>
      <div className="text-[11px] font-semibold text-[var(--muted-foreground)]">{label}</div>
      <div className={`mt-0.5 break-words text-[14px] leading-snug tabular-nums ${mono ? "font-mono tracking-tight" : "font-semibold"} ${empty ? "font-normal text-[var(--muted-foreground)]" : "text-[var(--foreground)]"}`}>
        {empty ? "—" : value}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] m-tile px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="shrink-0 text-[11px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]">{title}</span>
        <span className="h-px min-w-0 flex-1 bg-[color-mix(in_oklch,var(--muted-foreground)_14%,transparent)]" />
      </div>
      {children}
    </div>
  );
}

type TimelineEvent = { time: string; type: string; title: string; detail: string; tone: Tone };

export function ExpertDetailSheet({
  expertId,
  baseline,
  onClose,
}: {
  expertId: string | null;
  /** 列表行（开层瞬间先用它渲染抬头，详情到达后覆盖） */
  baseline?: ExpertListItem;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ExpertDetail | null>(null);
  const [evaluations, setEvaluations] = useState<ExpertEvaluation[]>([]);
  const [violations, setViolations] = useState<ExpertViolation[]>([]);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<Tab>("info");

  useEffect(() => {
    if (!expertId) return;
    let active = true;
    Promise.all([
      fetchExpertDetail(expertId),
      fetchExpertEvaluations(expertId).catch(() => [] as ExpertEvaluation[]),
      fetchExpertViolations(expertId).catch(() => [] as ExpertViolation[]),
    ])
      .then(([d, ev, vio]) => {
        if (!active) return;
        setDetail(d);
        setEvaluations(ev);
        setViolations(vio);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [expertId]);

  /* 列表行 profile 是详情 profile 的结构子集（字段同名同型），加载期直接按详情类型读、缺项即 undefined */
  const p = (detail?.expertProfile ?? baseline?.expertProfile ?? null) as ExpertDetail["expertProfile"] | null;
  const name = detail?.displayName ?? baseline?.displayName ?? "";
  const expertNo = detail?.expertNo;
  const lifecycle = detail ? lifecycleBadgeOf(detail) : null;

  /* 关键节点：入库 / 项目分配 / 履职评价 / 违规记录 合并倒序（同 :3005 大事记口径） */
  const timeline = useMemo<TimelineEvent[]>(() => {
    if (!detail) return [];
    const events: TimelineEvent[] = [
      { time: detail.createdAt, type: "入库", title: "加入专家库", detail: p?.specialty ? `以「${p.specialty}」专业入库` : "入库", tone: "blue" },
    ];
    for (const a of detail.assignments) {
      events.push({
        time: a.project.openTime || detail.createdAt,
        type: "项目分配",
        title: `参与评审「${a.project.name}」`,
        detail: `专业 ${a.major || "—"} · ${STAGE_LABEL[a.project.stage] || a.project.stage} · 进度 ${a.progress}% · 得分 ${Number(a.totalScore)}`,
        tone: a.progress >= 100 ? "green" : "orange",
      });
    }
    for (const ev of evaluations) {
      events.push({
        time: ev.createdAt,
        type: "履职评价",
        title: `${LEVEL_LABEL[ev.overallGrade] || ev.overallGrade}级`,
        detail: `出勤 ${ev.attendanceGrade || "—"} / 质量 ${ev.qualityGrade || "—"} / 廉洁 ${ev.disciplineGrade || "—"} · 评价人 ${ev.evaluator?.displayName || "—"}`,
        tone: levelTone(ev.overallGrade),
      });
    }
    for (const v of violations) {
      const d = v.details || {};
      events.push({
        time: v.createdAt,
        type: "违规记录",
        title: d.type || "违规",
        detail: `${d.detail || ""}${d.detail ? " · " : ""}${d.severity === "danger" ? "严重" : "警告"} · 记录人 ${v.user?.displayName || "系统"}`,
        tone: d.severity === "danger" ? "red" : "orange",
      });
    }
    return events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [detail, evaluations, violations, p]);

  const inv = detail?.invitationSummary;

  return (
    <BottomSheet
      open={!!expertId}
      onClose={onClose}
      title={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {name}
          {expertNo ? (
            <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--muted-foreground)_9%,transparent)] px-1.5 py-0.5 font-mono text-[12px] font-medium tracking-wide text-[var(--muted-foreground)]">
              {expertNo}
            </span>
          ) : null}
        </span>
      }
    >
      {error ? (
        <EmptyState text="专家详情加载失败，请关闭后重试" />
      ) : !detail ? (
        <>
          {/* 抬头先用列表行占位，避免开层空白 */}
          {p ? (
            <div className="mb-3 text-[13px] text-[var(--muted-foreground)]">{[p.specialty, p.title, p.employer, p.education].filter(Boolean).join(" · ")}</div>
          ) : null}
          <Skeleton lines={6} height={44} />
        </>
      ) : (
        <div className="space-y-3">
          {/* 抬头：专业 · 职称 · 单位 · 学历 + 入库/库况/账户 */}
          <div>
            <div className="text-[13px] leading-relaxed text-[var(--muted-foreground)]">
              {[p?.specialty, p?.title, p?.employer, p?.education].filter(Boolean).join(" · ") || "—"}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="rounded-[8px] bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] px-2 py-1 font-semibold tabular-nums text-[var(--muted-foreground)]">
                入库 {fmtDate(p?.verifiedAt ?? detail.createdAt)}
              </span>
              {lifecycle ? <Badge tone={lifecycle.tone}>{lifecycle.label}</Badge> : null}
              <Badge tone={detail.isActive ? "green" : "gray"}>{detail.isActive ? "账户正常" : "账户已停用"}</Badge>
              {(detail.statistics?.totalProjects ?? 0) > 0 ? <Badge tone="blue">{detail.statistics.totalProjects} 个评审项目</Badge> : null}
            </div>
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none]">
            {TABS.map((t) => (
              <Chip key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
                {t.label}
                {t.key === "timeline" && timeline.length ? ` ${timeline.length}` : ""}
                {t.key === "evaluations" && evaluations.length ? ` ${evaluations.length}` : ""}
                {t.key === "projects" && detail.assignments.length ? ` ${detail.assignments.length}` : ""}
              </Chip>
            ))}
          </div>

          {tab === "info" ? (
            <div className="space-y-2.5">
              <Group title="职业资格">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <Field label="专业领域" value={p?.specialty} />
                  <Field label="职称" value={p?.title} />
                  <Field label="执业资格" value={p?.qualifications} />
                  <Field label="学历" value={p?.education} />
                  <Field label="执业资格编号" value={p?.licenseNo} mono />
                  <Field label="行政区域代码" value={p?.regionCode} mono />
                  <Field label="库内等级" value={p?.expertLevel ? `${p.expertLevel} 级` : undefined} />
                  <div>
                    <div className="text-[11px] font-semibold text-[var(--muted-foreground)]">库况状态</div>
                    <div className="mt-1">{lifecycle ? <Badge tone={lifecycle.tone}>{lifecycle.label}</Badge> : <span className="text-[14px] text-[var(--muted-foreground)]">—</span>}</div>
                  </div>
                </div>
              </Group>

              <Group title="身份与联系">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                  <Field label="姓名" value={detail.displayName} />
                  <Field label="身份证号" value={p?.idNumber} mono />
                  <Field label="民族" value={p?.ethnicity} />
                  <Field label="手机号码" value={p?.phone} mono />
                  <Field label="邮箱" value={detail.email} />
                  <div>
                    <div className="text-[11px] font-semibold text-[var(--muted-foreground)]">账户状态</div>
                    <div className="mt-1">
                      <Badge tone={detail.isActive ? "green" : "gray"}>{detail.isActive ? "正常" : "已停用"}</Badge>
                    </div>
                  </div>
                </div>
              </Group>

              <Group title="工作归属">
                <div className="grid grid-cols-1 gap-y-2.5 sm:grid-cols-2 sm:gap-x-3">
                  <Field label="工作单位" value={p?.employer} full />
                  <Field label="所属部门" value={detail.department?.name} />
                  <Field label="登录账号" value={detail.username} mono />
                </div>
              </Group>

              <Group title="综合评价">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--muted-foreground)]">{p?.aiEvaluatedAt ? `AI 生成 · ${fmtDate(p.aiEvaluatedAt)} 更新` : "AI 聚合履职数据 · 每月 1 日刷新"}</span>
                </div>
                <p className={`mt-1.5 text-[14px] leading-relaxed ${p?.aiEvaluation ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>{p?.aiEvaluation || "暂无"}</p>
                {p?.notes ? <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted-foreground)]">备注：{p.notes}</p> : null}
              </Group>
            </div>
          ) : null}

          {tab === "timeline" ? (
            timeline.length ? (
              <div className="relative space-y-4 pl-5">
                <span aria-hidden className="absolute left-[5px] top-1 bottom-1 w-px bg-[color-mix(in_oklch,var(--muted-foreground)_18%,transparent)]" />
                {timeline.map((ev, i) => (
                  <div key={i} className="relative">
                    <span
                      aria-hidden
                      className="absolute left-[-1.6rem] top-1.5 h-2.5 w-2.5 rounded-full"
                      style={{ background: TONE_TEXT[ev.tone], boxShadow: `0 0 0 3px color-mix(in oklch, ${TONE_TEXT[ev.tone]} 18%, transparent)` }}
                    />
                    <div className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{fmtDateTime(ev.time)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={ev.tone}>{ev.type}</Badge>
                      <span className="min-w-0 text-[14px] font-bold leading-snug text-[var(--foreground)]">{ev.title}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted-foreground)]">{ev.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无关键节点" />
            )
          ) : null}

          {tab === "evaluations" ? (
            evaluations.length ? (
              <div className="space-y-2">
                {evaluations.map((ev) => (
                  <div key={ev.id} className="rounded-[12px] m-tile px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] tabular-nums text-[var(--muted-foreground)]">{fmtDate(ev.createdAt)}</span>
                      <Badge tone={levelTone(ev.overallGrade)} solid>
                        {ev.overallGrade} · {LEVEL_LABEL[ev.overallGrade] || ev.overallGrade}
                      </Badge>
                      <span className="ml-auto min-w-0 truncate text-[12px] text-[var(--muted-foreground)]">评价人 {ev.evaluator?.displayName || "—"}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px]">
                      {([["出勤", ev.attendanceGrade], ["质量", ev.qualityGrade], ["廉洁", ev.disciplineGrade]] as [string, string][]).map(([k, g]) => (
                        <span key={k} className="rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_7%,transparent)] px-2 py-0.5 text-[var(--muted-foreground)]">
                          {k} <span className="font-mono font-bold" style={{ color: TONE_TEXT[levelTone(g)] }}>{g || "—"}</span>
                        </span>
                      ))}
                    </div>
                    {(() => {
                      const evd = (ev.evidence ?? {}) as Record<string, string>;
                      const evdText = (["attendanceGrade", "qualityGrade", "disciplineGrade"] as const)
                        .map((k) => (evd[k] || "").trim() ? `${k === "attendanceGrade" ? "出勤" : k === "qualityGrade" ? "质量" : "廉洁"}：${evd[k].trim()}` : "")
                        .filter(Boolean)
                        .join("；");
                      const full = [ev.comment, evdText].filter(Boolean).join(" ｜ ");
                      return full ? <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--foreground)]">{full}</p> : null;
                    })()}
                    {ev.reviewReason ? <p className="mt-1 text-[11px] text-[var(--warning)]">复评事由：{ev.reviewReason}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无评价记录" />
            )
          ) : null}

          {tab === "projects" ? (
            detail.assignments.length ? (
              <div className="space-y-2.5">
                {inv && inv.invited > 0 ? (
                  <Group title="邀请信用">
                    {(inv.consecutiveDeclined ?? 0) >= 3 ? (
                      <div className="mb-2 rounded-[10px] bg-[color-mix(in_oklch,var(--danger)_7%,transparent)] px-3 py-2 text-[12px] leading-relaxed text-[var(--foreground)]">
                        已连续 {inv.consecutiveDeclined} 次婉拒评审邀请（阈值 3 次），请复核参评意愿
                      </div>
                    ) : null}
                    <div className="grid grid-cols-5 gap-1.5 text-center">
                      {([
                        ["累计受邀", inv.invited, false],
                        ["确认参加", inv.confirmed, false],
                        ["婉拒/弃权", inv.declined, false],
                        ["中途毁约", inv.overrideAfterConfirm, inv.overrideAfterConfirm > 0],
                        ["连续拒绝", inv.consecutiveDeclined, inv.consecutiveDeclined >= 3],
                      ] as [string, number, boolean][]).map(([label, value, alert]) => (
                        <div key={label} className="rounded-[8px] px-1 py-1.5" style={{ background: alert ? `color-mix(in oklch, var(--danger) 8%, transparent)` : "oklch(1 0 0 / 0.45)" }}>
                          <div className="text-[10px] font-medium leading-tight text-[var(--muted-foreground)]">{label}</div>
                          <div className="mt-0.5 text-[15px] font-black tabular-nums" style={{ color: alert ? "var(--danger)" : "var(--foreground)" }}>{value}</div>
                        </div>
                      ))}
                    </div>
                    {inv.breachEvents?.length ? (
                      <div className="mt-2 space-y-1">
                        {inv.breachEvents.map((b, i) => (
                          <div key={i} className="rounded-[8px] bg-[color-mix(in_oklch,var(--danger)_5%,transparent)] px-2.5 py-1.5 text-[11px] leading-relaxed">
                            <span className="font-semibold text-[var(--foreground)]">{b.projectName || "（项目已清理）"}</span>
                            <span className="ml-1.5 tabular-nums text-[var(--muted-foreground)]">{fmtDate(b.at)}</span>
                            {b.actorName ? <span className="ml-1.5 text-[var(--muted-foreground)]">操作人 {b.actorName}</span> : null}
                            {b.reason ? <div className="text-[var(--danger)]">理由：{b.reason}</div> : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </Group>
                ) : null}

                {detail.assignments.map((a) => {
                  const stageColor = STAGE_COLOR[a.project.stage] || "var(--muted-foreground)";
                  const inviteLabel = a.invitationStatus === "pending" ? "待确认" : a.invitationStatus === "confirmed" ? "已确认" : a.invitationStatus === "declined" ? "已拒绝" : null;
                  return (
                    <div key={a.id} className="rounded-[12px] m-tile px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[14px] font-bold text-[var(--foreground)]">{a.project.name}</div>
                          <div className="mt-0.5 truncate text-[12px] tabular-nums text-[var(--muted-foreground)]">
                            {a.project.projectCode} · {a.project.procurementMethod}
                            {a.project.openTime ? ` · 开标 ${fmtDate(a.project.openTime)}` : ""}
                          </div>
                        </div>
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: stageColor, background: `color-mix(in oklch, ${stageColor} 10%, transparent)` }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: stageColor }} />
                          {STAGE_LABEL[a.project.stage] || a.project.stage}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {a.isLead ? <Badge tone="blue">组长</Badge> : null}
                        {inviteLabel ? <Badge tone={a.invitationStatus === "confirmed" ? "green" : a.invitationStatus === "declined" ? "red" : "blue"}>{inviteLabel}</Badge> : null}
                        <span className="text-[var(--muted-foreground)]">专业 <span className="font-semibold text-[var(--foreground)]">{a.major || "—"}</span></span>
                        <span className="text-[var(--muted-foreground)]">签到 <span className={`font-semibold ${a.signedIn ? "text-[var(--success)]" : "text-[var(--foreground)]"}`}>{a.signedIn ? "已签到" : "未签到"}</span></span>
                        <span className="text-[var(--muted-foreground)]">回避 <span className={`font-semibold ${a.avoidanceConfirmed ? "text-[var(--success)]" : "text-[var(--foreground)]"}`}>{a.avoidanceConfirmed ? "已确认" : "未确认"}</span></span>
                        <span className="text-[var(--muted-foreground)]">总分 <span className="font-semibold tabular-nums text-[var(--foreground)]">{Number(a.totalScore)}</span></span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                        <span className="w-8 shrink-0 text-right font-bold tabular-nums text-[var(--foreground)]">{a.progress}%</span>
                        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)]">
                          <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${a.progress}%`, background: barFill(stageColor) }} />
                        </span>
                        <span className="shrink-0 tabular-nums">{a.scoreRecords?.length ?? 0} 条评分</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState text="暂无评审项目记录" />
            )
          ) : null}
        </div>
      )}
    </BottomSheet>
  );
}
