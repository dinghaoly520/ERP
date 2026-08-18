'use client';
import { useState } from 'react';
import { ShieldCheck, ClipboardCheck, ShieldAlert, CheckCircle, XCircle, Star, ChevronDown } from 'lucide-react';
import type { AssistData, RequirementResponse } from '@water-erp/shared';

const RISK_BADGE: Record<string, { label: string; c: string }> = {
  high: { label: '高风险', c: 'var(--danger)' },
  medium: { label: '中风险', c: 'var(--warning)' },
  low: { label: '低风险', c: 'var(--success)' },
};

const UNMET_PREVIEW = 4;

export function GateLayer({ assistData }: { assistData: AssistData }) {
  const [showAllQual, setShowAllQual] = useState(false);
  const [showAllStarred, setShowAllStarred] = useState(false);

  const qualOk = assistData.qualificationStatus === '通过';
  const qualFail = assistData.qualificationStatus === '不通过';
  const responsiveOk = assistData.starredResponse?.allMet === true;
  const responsiveFail = assistData.starredResponse?.allMet === false;
  const allOk = qualOk && responsiveOk;
  const anyFail = qualFail || responsiveFail;

  // 资格条款证据（requirementResponses 里 category=qualification）
  const qualResps = (assistData.requirementResponses ?? []).filter((r) => r.category === 'qualification');
  const tally = (arr: RequirementResponse[], status: RequirementResponse['status']) => arr.filter((r) => r.status === status).length;
  const unmetQual = qualResps.filter((r) => r.status === 'unmet' || r.status === 'not_found');
  const shownUnmetQual = showAllQual ? unmetQual : unmetQual.slice(0, UNMET_PREVIEW);

  const starredUnmet = assistData.starredResponse?.unmet ?? [];
  const shownStarredUnmet = showAllStarred ? starredUnmet : starredUnmet.slice(0, UNMET_PREVIEW);

  // 资格不通过的 [自动] 说明（原来自 overallComment）
  const qualAutoNote = qualFail
    ? (assistData.overallComment ?? '').split('\n').find((l) => l.includes('[自动]'))
    : null;

  const bandCls = anyFail
    ? 'exp-alert'
    : allOk ? 'exp-alert exp-alert--success' : 'exp-alert exp-alert--warn';

  const riskBadge = assistData.riskLevel ? RISK_BADGE[assistData.riskLevel] : null;

  return (
    <section>
      <div className={`${bandCls} flex items-center gap-3 !px-4 !py-3`}>
        <span className="!text-sm !font-bold">合规门</span>
        <Verdict ok={qualOk} fail={qualFail} label="资格审查" icon={<ShieldCheck size={13} />} />
        <Verdict ok={responsiveOk} fail={responsiveFail} label="响应性" icon={<ClipboardCheck size={13} />} />
        {riskBadge && (
          <span className="exp-pill ml-auto" style={{ '--c': riskBadge.c } as React.CSSProperties}>
            {riskBadge.label}
          </span>
        )}
      </div>

      {/* 阻断条归位（原浮在头条下） */}
      {qualFail && (
        <div className="exp-alert mt-2 flex items-start gap-2.5 !px-4 !py-2.5">
          <ShieldAlert size={15} className="mt-0.5 shrink-0" />
          <div className="!text-xs">
            <span className="font-semibold">资格审查不通过 · AI 自动判定</span>
            <p className="mt-0.5 opacity-80">{qualAutoNote ?? '存在资质一致性冲突或★实质性条款未响应，建议重点核实资格材料。'}</p>
          </div>
        </div>
      )}

      {/* 资格条款证据（亮出 B'） */}
      {qualResps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-4 text-[11px] text-[var(--muted-foreground)]">
          <span>资格条款：满足 {tally(qualResps,'met')} · 部分 {tally(qualResps,'partial')} · 不满足 {tally(qualResps,'unmet')} · 未提及 {tally(qualResps,'not_found')}</span>
        </div>
      )}
      {unmetQual.length > 0 && (
        <div className="mt-1.5 px-4">
          <ul className="space-y-1">
            {shownUnmetQual.map((r,i) => (
              <li key={i} className="flex items-start gap-1 text-[11px] text-[var(--danger)]">
                <XCircle size={11} className="mt-0.5 shrink-0" />
                <span className="truncate" title={r.excerpt}>{r.excerpt || '（条款原文未提取，请核对招标文件）'}{r.location ? `（第${r.location.page}页）` : ''}</span>
              </li>
            ))}
          </ul>
          {unmetQual.length > UNMET_PREVIEW && (
            <ExpandButton open={showAllQual} onClick={() => setShowAllQual(v => !v)} total={unmetQual.length} />
          )}
        </div>
      )}

      {/* 响应性 unmet（starredResponse） */}
      {responsiveFail && starredUnmet.length > 0 && (
        <div className="mt-1.5 px-4">
          <ul className="space-y-1">
            {shownStarredUnmet.map((u,i) => (
              <li key={i} className="flex items-start gap-1 text-[11px]">
                <Star size={11} className="mt-0.5 shrink-0 fill-[var(--warning)] text-[var(--warning)]" />
                <span className="truncate text-[oklch(0.52_0.13_70)]" title={u}>{u}</span>
              </li>
            ))}
          </ul>
          {starredUnmet.length > UNMET_PREVIEW && (
            <ExpandButton open={showAllStarred} onClick={() => setShowAllStarred(v => !v)} total={starredUnmet.length} />
          )}
        </div>
      )}
    </section>
  );
}

function ExpandButton({ open, onClick, total }: { open: boolean; onClick: () => void; total: number }) {
  return (
    <button onClick={onClick} className="mt-1 inline-flex items-center gap-0.5 text-[11px] text-[var(--accent-strong)] hover:underline">
      <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      {open ? '收起' : `展开全部 ${total} 项`}
    </button>
  );
}

function Verdict({ ok, fail, label, icon }: { ok: boolean; fail: boolean; label: string; icon: React.ReactNode }) {
  const c = ok ? 'var(--success)' : fail ? 'var(--danger)' : 'var(--warning)';
  return (
    <span className="exp-pill !gap-1 !px-2 !py-0.5 !text-xs" style={{ '--c': c } as React.CSSProperties}>
      {icon}
      {label}
      {ok ? <CheckCircle size={11}/> : fail ? <XCircle size={11}/> : null}
    </span>
  );
}
