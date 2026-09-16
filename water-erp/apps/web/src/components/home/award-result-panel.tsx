'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trophy, List, Building2, CalendarClock, FileText, Users, ShieldCheck, ClipboardList, Check, ExternalLink } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { fetchProjectManagementList } from '@/lib/api/project-management';
import { fmtAcquireTime } from '@/lib/utils/format-acquire-time';
import {
  PROJECT_WORKFLOW_STAGES_ALL,
  PROJECT_STAGE_STATUS_LABELS,
  PROJECT_MANAGEMENT_STATUS_LABELS,
} from '@/lib/types/project-management';
import type { ProjectManagementItem, ProjectManagementStage } from '@/lib/types/project-management';

/** 主面板只展示最近 N 行，其余经「显示全部」弹窗查看 */
const PREVIEW_ROWS = 5;

/** 阶段枚举 → 中文（界面不允许出现英文枚举值；未识别时兜底原值防数据漂移） */
const STAGE_LABELS: Record<string, string> = Object.fromEntries(
  PROJECT_WORKFLOW_STAGES_ALL.map((s) => [s.key, s.label]),
);

/** 阶段语义色：定标=进行中（accent）、合同=已完成（success）、其余默认中性 */
function stageTone(stage: string): 'accent' | 'success' | 'neutral' {
  if (stage === 'CONTRACT') return 'success';
  if (stage === 'AWARD_DECISION') return 'accent';
  return 'neutral';
}

/** 展示阶段：已归档项目（status=ARCHIVED）语义上是流程终结，统一显示「已归档」而非末段阶段名 */
function displayStage(i: Pick<ProjectManagementItem, 'currentStage' | 'status'>): string {
  if (i.status === 'ARCHIVED') return '已归档';
  return STAGE_LABELS[i.currentStage] ?? i.currentStage;
}

const TONE_CLS: Record<string, string> = {
  accent: 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]',
  success: 'bg-[color-mix(in_oklch,var(--success)_14%,transparent)] text-[var(--success)]',
  neutral: 'bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] text-[var(--muted-foreground)]',
};

const fmtAmount = (v: number | null | undefined) =>
  v != null ? Number(v).toLocaleString('zh-CN') : '—';

/** ISO 串（YYYY-MM-DDTHH:mm…）取日期部分；中文区间等自由文本原样保留，空值兜底 */
const fmtDate = (v: string | null | undefined) => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  return v;
};

/** 采购文件获取时间归一化（共享工具）：统一为「2026年9月7日9:00-2026年9月8日15:00」 */


/** CTS-EBS01 A-203：标段（包）与中标信息关联查询（项目 → 中标供应商/合同金额 明细） */
export function AwardResultPanel() {
  const [items, setItems] = useState<ProjectManagementItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [detail, setDetail] = useState<ProjectManagementItem | null>(null);

  useEffect(() => {
    fetchProjectManagementList()
      .then((all) => setItems(all.filter((i) => i.awardedSupplier)))
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, []);

  const preview = useMemo(() => (items ?? []).slice(0, PREVIEW_ROWS), [items]);
  const overflow = (items?.length ?? 0) > PREVIEW_ROWS;

  return (
    <section className="wb-panel mb-3">
      <div className="wb-panel-header">
        <span className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.01em] text-[color:var(--foreground)]">
          <Trophy size={15} className="text-[color:var(--accent)]" />
          项目中标结果
          <span className="text-[10px] font-normal text-[color:var(--muted-foreground)]">CTS A-203 · 标段与中标信息关联</span>
        </span>
        <span className="flex items-center gap-2">
          {items && <span className="text-[11px] text-[color:var(--muted-foreground)]">共 {items.length} 项已定标</span>}
          {overflow && (
            <button onClick={() => setAllOpen(true)} className="neu-btn-xs">
              <List size={12} /> 显示全部
            </button>
          )}
        </span>
      </div>
      {error ? (
        <p className="px-5 py-8 text-center text-xs text-[color:var(--danger)]">{error}</p>
      ) : items === null ? (
        <p className="px-5 py-8 text-center text-xs text-[color:var(--muted-foreground)]">加载中…</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-[color:var(--muted-foreground)]">暂无已定标项目</p>
      ) : (
        <>
          <div className="neu-table-card mt-3">
            <div className="overflow-x-auto">
              <AwardTable items={preview} onSelect={setDetail} />
            </div>
          </div>
          {overflow && (
            <p className="px-1.5 pt-2 text-[11px] text-[color:var(--muted-foreground)]">
              仅展示最近 {PREVIEW_ROWS} 项，点击「显示全部」或任一行查看更多
            </p>
          )}
        </>
      )}

      {/* ── 全部中标结果弹窗 ── */}
      <Modal
        open={allOpen}
        onClose={() => setAllOpen(false)}
        closeOnEsc={!detail}
        size="2xl"
        title={
          <span className="flex items-center gap-2">
            <Trophy size={17} className="text-[color:var(--accent)]" />
            全部项目中标结果
          </span>
        }
        description={`CTS A-203 · 标段与中标信息关联 · 共 ${items?.length ?? 0} 项已定标 · 点击任一行查看详情`}
      >
        <div className="neu-table-card">
          <div className="overflow-x-auto">
            <AwardTable items={items ?? []} onSelect={setDetail} />
          </div>
        </div>
      </Modal>

      {/* ── 单项中标详情弹窗（叠于「显示全部」之上） ── */}
      <AwardDetailModal item={detail} onClose={() => setDetail(null)} />
    </section>
  );
}

/* ════════════ 中标结果表（主面板 + 全部弹窗共用） ════════════ */
function AwardTable({ items, onSelect }: { items: ProjectManagementItem[]; onSelect: (i: ProjectManagementItem) => void }) {
  return (
    <table className="neu-table w-full min-w-[860px] text-center">
      <thead>
        <tr>
          <th>项目编号</th>
          <th>项目名称</th>
          <th>采购方式</th>
          <th>中标供应商</th>
          <th>合同金额（元）</th>
          <th>当前阶段</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => {
          const archived = i.status === 'ARCHIVED';
          const tone = archived ? 'success' : stageTone(i.currentStage);
          return (
            <tr key={i.id} className="row-clickable cursor-pointer" onClick={() => onSelect(i)}>
              <td className="font-mono text-xs text-[color:var(--accent)]">{i.projectCode ?? '—'}</td>
              <td className="font-semibold text-[color:var(--foreground)]">{i.title}</td>
              <td className="text-[color:var(--muted-foreground)]">{i.procurementMethod}</td>
              <td className="font-semibold text-[color:var(--foreground)]">{i.awardedSupplier}</td>
              <td className="font-mono text-xs tabular-nums text-[color:var(--foreground)]">{fmtAmount(i.contractAmount)}</td>
              <td>
                <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${TONE_CLS[tone]}`}>
                  {displayStage(i)}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ════════════ 单项中标详情弹窗 ════════════ */
function AwardDetailModal({ item, onClose }: { item: ProjectManagementItem | null; onClose: () => void }) {
  const router = useRouter();
  if (!item) return null;

  const budget = item.budgetAmount ?? null;
  const contract = item.contractAmount ?? null;
  const savings = budget != null && contract != null && budget > contract ? budget - contract : null;
  const savingsRate = savings != null && budget ? savings / budget : null;

  const kpis = [
    { label: '预算金额（元）', value: fmtAmount(budget) },
    { label: '合同金额（元）', value: fmtAmount(contract), strong: true },
    { label: '节约资金（元）', value: fmtAmount(savings) },
    { label: '节资率', value: savingsRate != null ? `${(savingsRate * 100).toFixed(1)}%` : '—' },
  ];

  const facts: { label: string; value: string | null | undefined }[] = [
    { label: '申请部门', value: item.requesterDepartment },
    { label: '申请人', value: item.requesterName },
    { label: '采购类别', value: item.procurementCategory },
    { label: '立项日期', value: fmtDate(item.initiationDate) },
    { label: '采购文件获取', value: fmtAcquireTime(item.documentAcquireTime) },
    { label: '开标时间', value: fmtDate(item.bidOpeningTime) },
    { label: '归档时间', value: fmtDate(item.archivedAt) },
    { label: '合同编号', value: item.contractNumber ?? item.demandContractNumber },
    { label: '实施人', value: item.createdByName },
    { label: '项目状态', value: item.status ? PROJECT_MANAGEMENT_STATUS_LABELS[item.status] : null },
  ];

  const texts: { icon: typeof FileText; label: string; value: string | null | undefined }[] = [
    { icon: FileText, label: '项目概述', value: item.projectOverview },
    { icon: ClipboardList, label: '采购理由', value: item.projectReason },
    { icon: Users, label: '供应商要求', value: item.supplierRequirements },
    { icon: ShieldCheck, label: '风险防范措施', value: item.riskMeasures },
    { icon: CalendarClock, label: '采购活动时间安排', value: item.activitySchedule },
    { icon: Users, label: '受邀供应商', value: item.invitedSuppliers },
    { icon: Users, label: '专家信息', value: item.expertInfo },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <Trophy size={17} className="text-[color:var(--accent)]" />
          中标详情 · {item.projectCode ?? item.title}
        </span>
      }
      description={`${item.procurementMethod} · ${displayStage(item)}${item.status === 'ARCHIVED' ? ' · 采购流程已终结' : ' 阶段'}`}
      footer={
        <button className="neu-btn-primary" onClick={() => router.push(`/projects?projectId=${item.id}`)}>
          <ExternalLink size={14} /> 前往项目工作台
        </button>
      }
    >
      {/* 项目名称 + 中标供应商 */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="min-w-0">
          <p className="text-[15px] font-bold leading-snug text-[color:var(--foreground)]">{item.title}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-[color:var(--muted-foreground)]">
            <Building2 size={13} />
            <span className="font-semibold text-[color:var(--foreground)]">{item.awardedSupplier}</span>
            <span>· 中标供应商</span>
          </p>
        </div>
      </div>

      {/* 关键金额 */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="kpi-card flex flex-col gap-1 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">{k.label}</span>
            <span className={`font-mono tabular-nums leading-none ${k.strong ? 'text-[1.35rem] font-black text-[color:var(--accent)]' : 'text-[1.15rem] font-bold text-[color:var(--foreground)]'}`}>
              {k.value}
            </span>
          </div>
        ))}
      </div>

      {/* 项目要素 */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-[10px] font-medium text-[color:var(--muted-foreground)]">{f.label}</dt>
            <dd className="break-words text-xs font-semibold leading-snug text-[color:var(--foreground)]">{f.value ?? '—'}</dd>
          </div>
        ))}
      </div>

      {/* 阶段时间线（已归档项目不标「当前」节点——流程已终结） */}
      <StageTimeline
        stages={item.stages}
        currentStage={item.status === 'ARCHIVED' ? null : item.currentStage}
        currentRound={item.currentRound ?? 1}
      />

      {/* 文本块 */}
      {texts.filter((t) => t.value?.trim()).map((t) => (
        <div key={t.label} className="rounded-[14px] bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)] px-4 py-3">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-[color:var(--muted-foreground)]">
            <t.icon size={13} /> {t.label}
          </p>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[color:var(--foreground)]">{t.value}</p>
        </div>
      ))}
    </Modal>
  );
}

/* ════════════ 阶段时间线（分步进度条：节点 + 连接线 + 完成日期） ════════════ */
function StageTimeline({ stages, currentStage, currentRound }: { stages: ProjectManagementStage[]; currentStage: string | null; currentRound: number }) {
  const rounds = useMemo(() => [...new Set(stages.map((s) => s.round ?? 1))].sort((a, b) => a - b), [stages]);
  return (
    <div className="rounded-[14px] bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)] px-4 py-3.5">
      <p className="mb-3 text-[11px] font-bold text-[color:var(--muted-foreground)]">采购流程阶段{rounds.length > 1 ? `（共 ${rounds.length} 轮，当前第 ${currentRound} 轮）` : ''}</p>
      {rounds.map((r) => {
        const roundStages = [...stages].filter((s) => (s.round ?? 1) === r).sort((a, b) => a.stageOrder - b.stageOrder);
        return (
          <div key={r} className="mb-3 last:mb-0">
            {rounds.length > 1 && <p className="mb-2 text-[10px] font-semibold text-[color:var(--muted-foreground)]">第 {r} 轮</p>}
            <div className="overflow-x-auto">
              <div className="flex min-w-[560px] items-start">
                {roundStages.map((s, i) => {
                  const isCurrent = s.stageKey === currentStage && (s.round ?? 1) === currentRound;
                  const done = s.status === 'COMPLETED';
                  // 节点：已完成=实心绿+对勾；当前=实心蓝+光环；未开始=浅灰凹点
                  const nodeCls = done
                    ? 'bg-[var(--success)] text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.3),2px_2px_4px_oklch(0.55_0.03_258/0.12)]'
                    : s.status === 'IN_PROGRESS'
                      ? 'bg-[var(--accent)] text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.3),2px_2px_4px_oklch(0.55_0.03_258/0.12)]'
                      : 'bg-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)] text-[color:var(--muted-foreground)]';
                  return (
                    <div key={s.id} className="relative min-w-0 flex-1">
                      {/* 连接线：上一节点中心 → 当前节点中心（left-[-50%]+w-full = 恰好跨两格圆心），前一步已完成=绿色实线，否则浅灰细线 */}
                      {i > 0 && (
                        <span
                          aria-hidden
                          className={`absolute left-[-50%] top-[10px] h-[2px] w-full rounded-full ${
                            roundStages[i - 1].status === 'COMPLETED'
                              ? 'bg-[color-mix(in_oklch,var(--success)_55%,transparent)]'
                              : 'bg-[color-mix(in_oklch,var(--muted-foreground)_22%,transparent)]'
                          }`}
                        />
                      )}
                      <div className="relative z-10 flex flex-col items-center gap-1.5 px-0.5">
                        <span
                          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full ${nodeCls} ${isCurrent ? 'ring-[3px] ring-[color-mix(in_oklch,var(--accent)_25%,transparent)]' : ''}`}
                          title={`${s.stageName} · ${PROJECT_STAGE_STATUS_LABELS[s.status]}${s.completedAt ? ` · 完成 ${fmtDate(s.completedAt) ?? ''}` : ''}`}
                        >
                          {done ? <Check size={13} strokeWidth={2.6} /> : s.status === 'IN_PROGRESS' ? <span className="h-[7px] w-[7px] rounded-full bg-white shadow-[0_0_0_2.5px_color-mix(in_oklch,var(--accent)_40%,transparent)]" /> : <span className="h-[6px] w-[6px] rounded-full bg-current opacity-60" />}
                        </span>
                        <span
                          className={`text-center text-[11px] leading-tight ${
                            isCurrent ? 'font-bold text-[var(--accent)]' : done ? 'font-semibold text-[color:var(--foreground)]' : 'font-medium text-[color:var(--muted-foreground)]'
                          }`}
                        >
                          {s.stageName}
                        </span>
                        <span className="h-[13px] text-center font-mono text-[9px] leading-[13px] tabular-nums text-[color:var(--muted-foreground)] opacity-75">
                          {done && s.completedAt ? fmtDate(s.completedAt) : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
