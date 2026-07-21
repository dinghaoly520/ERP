"use client";

import { useState, useEffect } from 'react';
import { Info, Loader2, X } from 'lucide-react';
import { fetchProcurements } from '@/lib/api/procurements';
import { fetchReferenceBudget } from '@/lib/api/ai';
import { PROCUREMENT_METHODS } from '@/lib/types/project-management';

const PROCUREMENT_CATEGORY_OPTIONS = [
  '生产技术类采购',
  'EPC项目采购',
  'EPC管理采购',
  '公用集中采购',
  '科技研发类采购',
  '信息化采购',
  '其他',
] as const;

type HistoricalProject = {
  projectName: string;
  procurementMethod: string;
  departmentName: string;
  budgetAmount: number;
  awardAmount: number | null;
  procurementDate: string | null;
};

export type InitiationFieldValues = {
  requesterName: string;
  requesterDepartment: string;
  procurementTitle: string;
  procurementMethod: string;
  procurementCategory: string;
  budgetAmount: number;
  projectReason: string;
  supplierRequirements: string;
  initiationDate?: string;
};

export function InitiationFieldForm({
  values,
  onChange,
}: {
  values: InitiationFieldValues;
  onChange: (next: InitiationFieldValues) => void;
}) {
  const [referenceBudget, setReferenceBudget] = useState<number | null>(null);
  const [referenceReasoning, setReferenceReasoning] = useState<string>('');
  const [referenceProjects, setReferenceProjects] = useState<HistoricalProject[]>([]);
  const [loadingReference, setLoadingReference] = useState(false);
  const [showReferencePopover, setShowReferencePopover] = useState(false);

  // Fetch reference budget when project title changes
  useEffect(() => {
    const fetchReference = async () => {
      if (!values.procurementTitle || values.procurementTitle.length < 3) {
        setReferenceBudget(null);
        setReferenceReasoning('');
        setReferenceProjects([]);
        return;
      }

      setLoadingReference(true);
      try {
        // First, search for similar historical projects
        const procurementsRes = await fetchProcurements({
          page: 1,
          pageSize: 20,
          searchKeyword: values.procurementTitle,
        });

        const historicalProjects: HistoricalProject[] = procurementsRes.data.map((item) => ({
          projectName: item.projectName,
          procurementMethod: item.procurementMethod,
          departmentName: item.departmentName,
          budgetAmount: Number(item.controlAmount ?? item.budgetAmount ?? 0),
          awardAmount: item.awardAmount ? Number(item.awardAmount) : null,
          procurementDate: item.procurementDate,
        }));

        setReferenceProjects(historicalProjects);

        // If no historical projects found, don't call AI - show "暂无参考"
        if (historicalProjects.length === 0) {
          setReferenceBudget(null);
          setReferenceReasoning('暂无参考');
          return;
        }

        // Then, call AI to generate reference budget
        const aiResult = await fetchReferenceBudget({
          projectTitle: values.procurementTitle,
          procurementMethod: values.procurementMethod,
          procurementCategory: values.procurementCategory,
          requesterDepartment: values.requesterDepartment,
          projectReason: values.projectReason,
          historicalProjects,
        });

        setReferenceBudget(aiResult.referenceBudget);
        setReferenceReasoning(aiResult.reasoning);
      } catch (err) {
        console.error('Failed to fetch reference budget:', err);
        setReferenceBudget(null);
        setReferenceReasoning('');
      } finally {
        setLoadingReference(false);
      }
    };

    // Debounce the fetch
    const timeoutId = setTimeout(() => {
      void fetchReference();
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [values.procurementTitle, values.procurementMethod, values.procurementCategory, values.requesterDepartment, values.projectReason]);

  const formatAmount = (amount: number | null) => {
    if (!amount) return '-';
    return amount >= 10000 ? `${(amount / 10000).toFixed(2)}万` : `${amount.toLocaleString('zh-CN')}元`;
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span>需求申请人</span>
        <input
          value={values.requesterName}
          onChange={(event) =>
            onChange({ ...values, requesterName: event.target.value })
          }
          className="workbench-input w-full"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span>需求部门</span>
        <input
          value={values.requesterDepartment}
          onChange={(event) =>
            onChange({ ...values, requesterDepartment: event.target.value })
          }
          className="workbench-input w-full"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)] md:col-span-2">
        <span>申请采购事项名称</span>
        <input
          value={values.procurementTitle}
          onChange={(event) =>
            onChange({ ...values, procurementTitle: event.target.value })
          }
          className="workbench-input w-full"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span className={values.procurementMethod ? '' : 'text-[color:var(--danger)]'}>
          采购方式{values.procurementMethod ? '' : '（需人工选择）'}
        </span>
        <select
          value={values.procurementMethod}
          onChange={(event) =>
            onChange({ ...values, procurementMethod: event.target.value })
          }
          className={[
            'workbench-input w-full',
            values.procurementMethod ? '' : 'is-invalid text-[color:var(--danger)]',
          ].join(' ')}
        >
          <option value="">请选择采购方式</option>
          {PROCUREMENT_METHODS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span>采购类别</span>
        <select
          value={values.procurementCategory}
          onChange={(event) =>
            onChange({ ...values, procurementCategory: event.target.value })
          }
          className="workbench-input w-full"
        >
          <option value="">请选择采购类别</option>
          {PROCUREMENT_CATEGORY_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span>预算金额</span>
        <input
          type="number"
          value={values.budgetAmount}
          onChange={(event) =>
            onChange({ ...values, budgetAmount: Number(event.target.value) })
          }
          className="workbench-input w-full"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span>立项时间</span>
        <input
          type="text"
          value={values.initiationDate || '未识别'}
          readOnly
          className="workbench-input w-full text-[color:var(--muted-foreground)]"
        />
      </label>
      {/* 参考预算 */}
      <div className="relative md:col-span-2">
        <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
          <span className="flex items-center gap-2">
            参考预算
            <Info size={14} className="text-[color:var(--muted-foreground)]" />
            <span className="text-[11px] text-[color:var(--muted-foreground)]">（基于历史相似项目AI分析）</span>
          </span>
          <button
            type="button"
            onClick={() => setShowReferencePopover(!showReferencePopover)}
            className="neu-opt relative w-full px-4 py-3 text-left"
          >
            {loadingReference ? (
              <span className="flex items-center gap-2 text-[color:var(--muted-foreground)]">
                <Loader2 size={14} className="animate-spin" />
                正在分析历史数据...
              </span>
            ) : referenceBudget !== null ? (
              <span className="text-[color:var(--accent-strong,var(--accent))] font-semibold">
                {formatAmount(referenceBudget)}
                {referenceReasoning && (
                  <span className="ml-2 text-[11px] font-normal text-[color:var(--muted-foreground)]">
                    — {referenceReasoning}
                  </span>
                )}
              </span>
            ) : referenceReasoning === '暂无参考' ? (
              <span className="text-[color:var(--muted-foreground)]">
                暂无参考
              </span>
            ) : (
              <span className="text-[color:var(--muted-foreground)]">
                请输入项目名称后获取参考预算
              </span>
            )}
          </button>
        </label>

        {/* 参考项目列表弹窗 */}
        {showReferencePopover && referenceProjects.length > 0 && (
          <div className="neu-surface absolute z-50 mt-2 w-full max-w-full overflow-hidden">
            <div className="flex items-center justify-between border-b border-[oklch(0.6_0.04_258_/_0.12)] px-4 py-3">
              <span className="text-sm font-semibold text-[color:var(--foreground)]">
                参考历史项目（{referenceProjects.length}个）
              </span>
              <button
                type="button"
                onClick={() => setShowReferencePopover(false)}
                className="neu-opt h-7 w-7 grid place-items-center"
              >
                <X size={14} />
              </button>
            </div>
            <div className="max-h-[280px] overflow-y-auto p-3">
              <div className="space-y-2">
                {referenceProjects.map((project, index) => (
                  <div
                    key={index}
                    className="neu-surface px-3 py-2.5 text-sm"
                  >
                    <div className="font-medium text-[color:var(--foreground)] line-clamp-1">
                      {project.projectName}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[color:var(--muted-foreground)]">
                      <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5">
                        {project.procurementMethod}
                      </span>
                      <span>{project.departmentName}</span>
                      <span className="text-[var(--success)]">
                        成交: {formatAmount(project.awardAmount)}
                      </span>
                      <span className="text-[color:var(--muted-foreground)]">
                        预算: {formatAmount(project.budgetAmount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)] md:col-span-2">
        <span>申请立项事由</span>
        <textarea
          value={values.projectReason}
          onChange={(event) =>
            onChange({ ...values, projectReason: event.target.value })
          }
          className="neu-input text-sm min-h-[120px]"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)] md:col-span-2">
        <span>对供方的主要要求</span>
        <textarea
          value={values.supplierRequirements}
          onChange={(event) =>
            onChange({ ...values, supplierRequirements: event.target.value })
          }
          className="neu-input text-sm min-h-[120px]"
        />
      </label>
    </div>
  );
}