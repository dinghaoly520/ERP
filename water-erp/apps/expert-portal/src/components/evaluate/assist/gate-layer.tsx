'use client';
import { ShieldCheck, ClipboardCheck, ShieldAlert, CheckCircle, XCircle, Star } from 'lucide-react';
import type { AssistData, RequirementResponse } from '@water-erp/shared';

export function GateLayer({ assistData }: { assistData: AssistData }) {
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

  // 资格不通过的 [自动] 说明（原来自 overallComment）
  const qualAutoNote = qualFail
    ? (assistData.overallComment ?? '').split('\n').find((l) => l.includes('[自动]'))
    : null;

  const bandCls = anyFail
    ? 'bg-red-50/80 border-red-200 text-red-700'
    : allOk ? 'bg-emerald-50/80 border-emerald-200 text-emerald-700' : 'bg-amber-50/80 border-amber-200 text-amber-700';

  return (
    <section>
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${bandCls}`}>
        <span className="text-sm font-bold">合规门</span>
        <Verdict ok={qualOk} fail={qualFail} label="资格审查" icon={<ShieldCheck size={13} />} />
        <Verdict ok={responsiveOk} fail={responsiveFail} label="响应性" icon={<ClipboardCheck size={13} />} />
      </div>

      {/* 阻断条归位（原浮在头条下） */}
      {qualFail && (
        <div className="flex items-start gap-2.5 px-4 py-2.5 mt-2 rounded-xl border border-red-200 bg-red-50/80">
          <ShieldAlert size={15} className="text-red-500 shrink-0 mt-0.5" />
          <div className="text-xs text-red-700">
            <span className="font-semibold">资格审查不通过 · AI 自动判定</span>
            <p className="mt-0.5 text-red-600/90">{qualAutoNote ?? '存在资质一致性冲突或★实质性条款未响应，建议重点核实资格材料。'}</p>
          </div>
        </div>
      )}

      {/* 资格条款证据（亮出 B'） */}
      {qualResps.length > 0 && (
        <div className="mt-2 text-[11px] text-[oklch(0.45_0.01_264)] flex flex-wrap gap-x-4 gap-y-1 px-4">
          <span>资格条款：满足 {tally(qualResps,'met')} · 部分 {tally(qualResps,'partial')} · 不满足 {tally(qualResps,'unmet')} · 未提及 {tally(qualResps,'not_found')}</span>
        </div>
      )}
      {unmetQual.length > 0 && (
        <ul className="mt-1.5 space-y-1 px-4">
          {unmetQual.slice(0,4).map((r,i) => (
            <li key={i} className="text-[11px] text-red-700 flex items-start gap-1">
              <XCircle size={11} className="mt-0.5 shrink-0" />
              <span className="truncate" title={r.excerpt}>{r.excerpt || r.requirementId}{r.location ? `（第${r.location.page}页）` : ''}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 响应性 unmet（starredResponse） */}
      {responsiveFail && assistData.starredResponse?.unmet && assistData.starredResponse.unmet.length > 0 && (
        <ul className="mt-1.5 space-y-1 px-4">
          {assistData.starredResponse.unmet.slice(0,4).map((u,i) => (
            <li key={i} className="text-[11px] text-amber-700 flex items-start gap-1">
              <Star size={11} className="mt-0.5 shrink-0 fill-amber-400 text-amber-500" />
              <span className="truncate" title={u}>{u}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Verdict({ ok, fail, label, icon }: { ok: boolean; fail: boolean; label: string; icon: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full
      ${ok ? 'bg-emerald-100 text-emerald-700' : fail ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
      {icon}
      {label}
      {ok ? <CheckCircle size={11}/> : fail ? <XCircle size={11}/> : null}
    </span>
  );
}
