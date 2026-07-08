'use client';

import { Check, AlertTriangle } from 'lucide-react';
import type { EvaluationReport } from '@/lib/types';
import { CATEGORY_LABEL, CATEGORY_COLOR, isPassFailCategory } from '@water-erp/shared';

interface ReportStepProps {
  report: EvaluationReport | null;
  busy: boolean;
  onConfirmReport: () => void;
}

export function ReportStep({ report, busy, onConfirmReport }: ReportStepProps) {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-[oklch(0.18_0.012_265)]">评审报告</h2>
          <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">查看评审结果汇总，确认后不可修改</p>
        </div>
        {report?.canConfirm && (
          <button onClick={onConfirmReport} disabled={busy}
            className="px-6 py-2.5 bg-emerald-500 text-white rounded-lg font-semibold hover:bg-emerald-600 transition disabled:opacity-50">
            {busy ? '确认中...' : <span className="inline-flex items-center gap-1.5"><Check size={14} strokeWidth={2.5} />确认评审报告</span>}
          </button>
        )}
      </div>

      {report ? (
        <div className="space-y-6">
          <div className="bg-[#064ea2] text-white rounded-xl p-6">
            <h3 className="text-xl font-bold mb-2">{report.projectName}</h3>
            <div className="flex items-center gap-6 text-sm text-white/80">
              <span>项目编号：{report.projectCode}</span>
              <span>评审专家：{report.expertName}</span>
              <span>完成度：{report.expertProgress}%</span>
            </div>
          </div>

          {report.supplierScores.map((ss, i) => (
            <div key={i} className="glass-card glass-card-blue rounded-xl overflow-hidden">
              <div className="flex items-center justify-between p-5 border-b border-[oklch(0.91_0.006_264)]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#064ea2] to-[#0b63ce] flex items-center justify-center text-white font-bold text-sm">{i + 1}</div>
                  <h3 className="font-bold text-[oklch(0.18_0.012_265)]">{ss.supplierName}</h3>
                  {ss.perSupplierComplete && <span className="text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded font-semibold">评分完整</span>}
                </div>
                <div className="text-2xl font-bold text-[#064ea2]">{ss.totalScore} <span className="text-sm text-[oklch(0.55_0.01_264)] font-normal">分</span></div>
              </div>
              {Object.entries(ss.categoryScores).length > 0 && (
                <div className="p-5 grid grid-cols-3 gap-3">
                  {Object.entries(ss.categoryScores).map(([cat, data]) => {
                    const passFail = isPassFailCategory(cat);
                    const firstPassed = data.items[0]?.passed;
                    return (
                      <div key={cat} className="bg-blue-50 rounded-lg p-3" style={{ borderLeft: `2px solid ${CATEGORY_COLOR[cat] || '#064ea2'}` }}>
                        <div className="text-xs font-semibold mb-1" style={{ color: CATEGORY_COLOR[cat] || '#064ea2' }}>{CATEGORY_LABEL[cat] || cat}</div>
                        {passFail ? (
                          <div className={`text-lg font-bold ${firstPassed === false ? 'text-[#e74c3c]' : 'text-[#11a874]'}`}>
                            {firstPassed === false ? '不通过' : '通过'}
                          </div>
                        ) : (
                          <div className="text-lg font-bold text-[oklch(0.18_0.012_265)]">{data.total} <span className="text-xs text-[oklch(0.55_0.01_264)] font-normal">/ {data.max}</span></div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {!report.overallComplete && (
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 flex items-center gap-3">
              <span className="text-xl"><AlertTriangle size={14} strokeWidth={1.5} /></span>
              <p className="text-sm text-amber-600">请先完成所有供应商的评分后再确认报告</p>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-12 text-[oklch(0.55_0.01_264)]">加载报告数据...</div>
      )}
    </div>
  );
}
