"use client";

const PROCUREMENT_CATEGORY_OPTIONS = [
  '生产技术类采购',
  'EPC项目采购',
  'EPC管理采购',
  '公用集中采购',
  '科技研发类采购',
  '信息化采购',
  '其他',
] as const;

type DemandFieldValues = {
  requesterName: string;
  requesterDepartment: string;
  procurementTitle: string;
  projectReason: string;
  supplierRequirements: string;
  budgetAmount: number;
  procurementCategory: string;
  procurementMethod: string;
 所属项目: string;
  合同及编号: string;
};

export function DemandFieldForm({
  values,
  onChange,
}: {
  values: DemandFieldValues;
  onChange: (next: DemandFieldValues) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span>需求申请人</span>
        <input
          value={values.requesterName}
          onChange={(event) =>
            onChange({ ...values, requesterName: event.target.value })
          }
          className="rounded-[16px] border border-white/60 bg-white/78 px-4 py-3"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span>需求部门</span>
        <input
          value={values.requesterDepartment}
          onChange={(event) =>
            onChange({ ...values, requesterDepartment: event.target.value })
          }
          className="rounded-[16px] border border-white/60 bg-white/78 px-4 py-3"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)] md:col-span-2">
        <span>申请采购事项名称</span>
        <input
          value={values.procurementTitle}
          onChange={(event) =>
            onChange({ ...values, procurementTitle: event.target.value })
          }
          className="rounded-[16px] border border-white/60 bg-white/78 px-4 py-3"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span>所属项目</span>
        <input
          value={values.所属项目}
          onChange={(event) =>
            onChange({ ...values, 所属项目: event.target.value })
          }
          className="rounded-[16px] border border-white/60 bg-white/78 px-4 py-3"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span>合同及编号</span>
        <input
          value={values.合同及编号}
          onChange={(event) =>
            onChange({ ...values, 合同及编号: event.target.value })
          }
          className="rounded-[16px] border border-white/60 bg-white/78 px-4 py-3"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
        <span>采购类别</span>
        <select
          value={values.procurementCategory}
          onChange={(event) =>
            onChange({ ...values, procurementCategory: event.target.value })
          }
          className="rounded-[16px] border border-white/60 bg-white/78 px-4 py-3"
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
          className="rounded-[16px] border border-white/60 bg-white/78 px-4 py-3"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)] md:col-span-2">
        <span>申请立项事由/情况说明</span>
        <textarea
          value={values.projectReason}
          onChange={(event) =>
            onChange({ ...values, projectReason: event.target.value })
          }
          className="min-h-[120px] rounded-[16px] border border-white/60 bg-white/78 px-4 py-3"
        />
      </label>
      <label className="grid gap-2 text-sm text-[color:var(--foreground)] md:col-span-2">
        <span>对供方的主要要求</span>
        <textarea
          value={values.supplierRequirements}
          onChange={(event) =>
            onChange({ ...values, supplierRequirements: event.target.value })
          }
          className="min-h-[120px] rounded-[16px] border border-white/60 bg-white/78 px-4 py-3"
        />
      </label>
    </div>
  );
}
