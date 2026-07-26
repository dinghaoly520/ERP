"use client";

import { Check, AlertTriangle } from 'lucide-react';
import type { DemandFields } from '@/lib/api/project-management';
import { PROCUREMENT_METHODS, PROCUREMENT_CATEGORY_OPTIONS } from '@/lib/types/project-management';

type InitiationValues = {
  requesterName: string;
  requesterDepartment: string;
  procurementTitle: string;
  projectReason: string;
  supplierRequirements: string;
  budgetAmount: number;
  procurementCategory: string;
  procurementMethod: string;
};

type FieldComparisonTableProps = {
  demandFields: DemandFields;
  initiationFields: InitiationValues;
  finalValues: InitiationValues;
  onFinalValueChange: (field: keyof InitiationValues, value: string | number) => void;
};

const FIELD_LABELS: Record<keyof InitiationValues, string> = {
  requesterName: '需求申请人',
  requesterDepartment: '需求部门',
  procurementTitle: '申请采购事项名称',
  projectReason: '申请立项事由',
  supplierRequirements: '对供方的主要要求',
  budgetAmount: '采购预算价格',
  procurementCategory: '采购类别',
  procurementMethod: '采购方式',
};

const SELECT_FIELDS = ['procurementCategory', 'procurementMethod'] as const;

const PROCUREMENT_METHOD_OPTIONS = [...PROCUREMENT_METHODS];


export function FieldComparisonTable({
  demandFields,
  initiationFields,
  finalValues,
  onFinalValueChange,
}: FieldComparisonTableProps) {
  const fieldsToCompare: Array<keyof InitiationValues> = [
    'requesterName',
    'requesterDepartment',
    'procurementTitle',
    'projectReason',
    'supplierRequirements',
    'budgetAmount',
    'procurementCategory',
  ];

  const formatValue = (value: string | number | boolean | undefined): string => {
    if (value === undefined || value === null || value === '') return '(空)';
    return String(value);
  };

  const isMatch = (field: keyof InitiationValues): boolean => {
    const demandValue = demandFields[field as keyof DemandFields];
    const initiationValue = initiationFields[field];
    if (typeof demandValue === 'number' && typeof initiationValue === 'number') {
      return demandValue === initiationValue;
    }
    return formatValue(demandValue) === formatValue(initiationValue);
  };

  const isSelectField = (field: keyof InitiationValues): boolean => {
    return SELECT_FIELDS.includes(field as typeof SELECT_FIELDS[number]);
  };

  const getOptions = (field: keyof InitiationValues): string[] => {
    if (field === 'procurementMethod') return PROCUREMENT_METHOD_OPTIONS;
    if (field === 'procurementCategory') return PROCUREMENT_CATEGORY_OPTIONS;
    return [];
  };

  return (
    <div className="rounded-[16px] border border-white/60 bg-white/50 overflow-hidden">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto_1fr] gap-2 border-b border-white/40 bg-white/30 px-4 py-3 text-sm font-medium text-[color:var(--foreground)]">
        <div>字段</div>
        <div>采购需求表</div>
        <div>采购立项申请表</div>
        <div></div>
        <div>最终值</div>
      </div>
      <div className="divide-y divide-white/40">
        {fieldsToCompare.map((field) => {
          const matched = isMatch(field);
          const label = FIELD_LABELS[field];
          const demandValue = demandFields[field as keyof DemandFields];
          const initiationValue = initiationFields[field];

          return (
            <div
              key={field}
              className="grid grid-cols-[1fr_1fr_1fr_auto_1fr] gap-2 px-4 py-3 text-sm"
            >
              <div className="font-medium text-[color:var(--foreground)]">
                {label}
              </div>
              <div className="text-[color:var(--muted-foreground)]">
                {formatValue(demandValue)}
              </div>
              <div className="text-[color:var(--muted-foreground)]">
                {formatValue(initiationValue)}
              </div>
              <div className="flex items-center justify-center">
                {matched ? (
                  <Check size={16} className="text-[rgba(92,181,150,1)]" />
                ) : (
                  <AlertTriangle size={16} className="text-[rgba(215,89,89,1)]" />
                )}
              </div>
              <div>
                {isSelectField(field) ? (
                  <select
                    value={finalValues[field] as string}
                    onChange={(e) => onFinalValueChange(field, e.target.value)}
                    className={[
                      'w-full rounded-[8px] px-2 py-1.5',
                      matched
                        ? 'border border-[rgba(92,181,150,0.4)] bg-[rgba(92,181,150,0.04)]'
                        : 'border border-[rgba(215,89,89,0.36)] bg-[rgba(255,245,245,0.92)]',
                    ].join(' ')}
                  >
                    <option value="">请选择</option>
                    {getOptions(field).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : field === 'budgetAmount' ? (
                  <input
                    type="number"
                    value={finalValues[field]}
                    onChange={(e) => onFinalValueChange(field, Number(e.target.value))}
                    className={[
                      'w-full rounded-[8px] px-2 py-1.5',
                      matched
                        ? 'border border-[rgba(92,181,150,0.4)] bg-[rgba(92,181,150,0.04)]'
                        : 'border border-[rgba(215,89,89,0.36)] bg-[rgba(255,245,245,0.92)]',
                    ].join(' ')}
                  />
                ) : (
                  <input
                    type="text"
                    value={finalValues[field]}
                    onChange={(e) => onFinalValueChange(field, e.target.value)}
                    className={[
                      'w-full rounded-[8px] px-2 py-1.5',
                      matched
                        ? 'border border-[rgba(92,181,150,0.4)] bg-[rgba(92,181,150,0.04)]'
                        : 'border border-[rgba(215,89,89,0.36)] bg-[rgba(255,245,245,0.92)]',
                    ].join(' ')}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
