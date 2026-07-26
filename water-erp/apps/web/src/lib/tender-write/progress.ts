import type {
  ReadyTenderDraft,
  TenderSectionConfig,
  TenderSectionKey,
  TenderSectionProgress,
} from '@/lib/types/tender-write';

export function buildTenderSectionProgress(
  sections: TenderSectionConfig[],
  draft: ReadyTenderDraft,
  activeSectionKey: TenderSectionKey,
): TenderSectionProgress[] {
  return sections.map((section) => {
    const filledFields = section.fields.filter((field) => {
      const value = draft[field.key as keyof ReadyTenderDraft];

      // 响应保证金选择"不收取"时，所有响应保证金相关字段一律视为已填写
      // （select/composite/toggle 字段会在下方分支被短路，必须在此提前返回）
      if (
        [
          'responseDepositAmount',
          'responseDepositForm',
          'responseDepositBankInfo',
          'responseDepositOtherForm',
          'responseDepositOtherRequirement',
          'responseDepositNonRefundType',
          'responseDepositNonRefundContent',
        ].includes(field.key)
      ) {
        const depositType = draft['responseDepositType' as keyof ReadyTenderDraft] as string;
        if (depositType === 'none') {
          return true;
        }
      }

      // 履约保证金选择"不收取"时，所有履约保证金相关字段一律视为已填写
      if (
        [
          'performanceDepositAmount',
          'performanceDepositForm',
          'performanceDepositOtherForm',
        ].includes(field.key)
      ) {
        const depositType = draft['performanceDepositType' as keyof ReadyTenderDraft] as string;
        if (depositType === 'none') {
          return true;
        }
      }

      // For select fields, check if value matches any option
      if (field.select) {
        return field.select.options.some(opt => opt.value === value);
      }

      // For quotationType fields, check if type is selected and content is filled
      if (field.quotationType) {
        const typeKey = 'quotationLetterType';
        const typeValue = draft[typeKey as keyof ReadyTenderDraft] as string;
        // 默认为 text 模式（与 tender-section-editor.tsx 保持一致）
        const effectiveType = typeValue || 'text';
        if (effectiveType === 'text') {
          return typeof value === 'string' && value.trim().length > 0;
        }
        if (effectiveType === 'table') {
          // Check if table has any content
          const tableData = draft['quotationLetterTable' as keyof ReadyTenderDraft] as { cells: { content: string }[][] } | undefined;
          if (!tableData || !tableData.cells) return false;
          // Check if any cell has content
          return tableData.cells.some(row => row.some(cell => cell.content?.trim().length > 0));
        }
        return false;
      }

      // For composite fields, check if type is selected and if it makes the field optional
      if (field.composite) {
        const typeValue = draft[field.composite.typeKey as keyof ReadyTenderDraft] as string;

        // If type is not selected, field is not filled
        if (!typeValue) {
          return false;
        }

        // For contractSubcontracting: if type is "none" (不允许), field is considered filled
        if (field.key === 'contractSubcontracting') {
          if (typeValue === 'none') {
            return true;
          }
          // If type is "allow", need to check if content is filled
          if (typeValue === 'allow') {
            return typeof value === 'string' && value.trim().length > 0;
          }
          return false;
        }

        // For consortiumForm: if type is "reject" (不接受), field is considered filled
        if (field.key === 'consortiumForm') {
          if (typeValue === 'reject') {
            return true;
          }
          // If type is "accept", need to check if content is filled
          if (typeValue === 'accept') {
            return typeof value === 'string' && value.trim().length > 0;
          }
          return false;
        }

        // For submissionRequirements: if type is "none" (无), field is considered filled
        if (field.key === 'submissionRequirements') {
          if (typeValue === 'none') {
            return true;
          }
          // If type is "have", need to check if content is filled
          if (typeValue === 'have') {
            return typeof value === 'string' && value.trim().length > 0;
          }
          return false;
        }

        // For responseDepositType composite: if type is "none", field is considered filled
        if (field.composite.typeKey === 'responseDepositType' && typeValue === 'none') {
          return true;
        }

        // For responseDepositOtherRequirementType: if type is "none", field is considered filled
        if (field.composite.typeKey === 'responseDepositOtherRequirementType' && typeValue === 'none') {
          return true;
        }
      }

      // For response deposit related fields - only check after type is explicitly selected
      if (['responseDepositAmount', 'responseDepositForm', 'responseDepositBankInfo',
           'responseDepositOtherForm', 'responseDepositOtherRequirement',
           'responseDepositNonRefundType', 'responseDepositNonRefundContent'].includes(field.key)) {
        const depositType = draft['responseDepositType' as keyof ReadyTenderDraft] as string;

        // If deposit type is not selected yet (empty), these fields are not filled
        if (!depositType) {
          return false;
        }

        if (depositType === 'none') {
          return true; // Consider as filled when not collecting response deposit
        }
        // For bank info - only required when form is cash
        if (field.key === 'responseDepositBankInfo') {
          const formType = draft['responseDepositForm' as keyof ReadyTenderDraft] as string;
          if (!formType) {
            return false; // Form not selected yet
          }
          if (formType !== 'cash') {
            return true;
          }
        }
        // For other form - only required when form is other
        if (field.key === 'responseDepositOtherForm') {
          const formType = draft['responseDepositForm' as keyof ReadyTenderDraft] as string;
          if (!formType) {
            return false; // Form not selected yet
          }
          if (formType !== 'other') {
            return true;
          }
        }
        // For other requirement - only required when type is have
        if (field.key === 'responseDepositOtherRequirement') {
          const reqType = draft['responseDepositOtherRequirementType' as keyof ReadyTenderDraft] as string;
          if (!reqType) {
            return false; // Requirement type not selected yet
          }
          if (reqType !== 'have') {
            return true;
          }
        }
        // For non-refund content - only required when type is have and collecting deposit
        if (field.key === 'responseDepositNonRefundContent') {
          const nonRefundType = draft['responseDepositNonRefundType' as keyof ReadyTenderDraft] as string;
          if (!nonRefundType) {
            return false; // Non-refund type not selected yet
          }
          if (nonRefundType !== 'have') {
            return true;
          }
        }
      }

      // For performance deposit related fields - only check after type is explicitly selected
      if (['performanceDepositAmount', 'performanceDepositForm', 'performanceDepositOtherForm'].includes(field.key)) {
        const depositType = draft['performanceDepositType' as keyof ReadyTenderDraft] as string;

        // If deposit type is not selected yet (empty), these fields are not filled
        if (!depositType) {
          return false;
        }

        if (depositType === 'none') {
          return true; // Consider as filled when not collecting performance deposit
        }
        // For other form - only required when form is other
        if (field.key === 'performanceDepositOtherForm') {
          const formType = draft['performanceDepositForm' as keyof ReadyTenderDraft] as string;
          if (!formType) {
            return false; // Form not selected yet
          }
          if (formType !== 'other') {
            return true;
          }
        }
      }

      // For toggle fields with typeKey (like siteSurvey)
      if (field.toggle && field.typeKey) {
        const typeValue = draft[field.typeKey as keyof ReadyTenderDraft] as string;
        // If type is not selected yet (empty), field is not filled
        if (!typeValue || typeValue === '') {
          return false;
        }
        // If type is 'yes' or 'no', the field is considered filled (user made a choice)
        return true;
      }

      // For toggle fields without typeKey (like siteSurvey)
      if (field.toggle) {
        // Check if this field has a typeKey
        const hasTypeKey = 'typeKey' in field && field.typeKey;
        if (!hasTypeKey) {
          // Check if value matches yesValue or noValue
          const toggleConfig = field.toggle as { yesLabel: string; noLabel: string; yesValue: string; noValue?: string };
          const isYes = value === toggleConfig.yesValue;
          const isNo = toggleConfig.noValue !== undefined && value === toggleConfig.noValue;
          return isYes || isNo;
        }
      }

      // For copyCount - it has a default value that gets auto-filled
      if (field.key === 'copyCount') {
        const copyCount = draft['copyCount' as keyof ReadyTenderDraft] as string;
        // If maxPrice is set, copyCount is auto-calculated
        const maxPrice = draft['maxPrice' as keyof ReadyTenderDraft] as string;
        if (maxPrice && maxPrice.trim()) {
          return true; // Auto-calculated based on maxPrice
        }
        return copyCount && copyCount.trim().length > 0;
      }

      return typeof value === 'string' && value.trim().length > 0;
    }).length;
    const totalFields = section.fields.length;
    const missingFields = totalFields - filledFields;
    const isActive = section.key === activeSectionKey;

    return {
      key: section.key,
      title: section.title,
      description: section.description,
      totalFields,
      filledFields,
      missingFields,
      state: isActive
        ? missingFields === 0
          ? 'active-complete'
          : 'active-missing'
        : missingFields === totalFields
          ? 'idle'
          : missingFields === 0
            ? 'completed'
            : 'missing',
    };
  });
}

export function getAdjacentTenderSectionKey(
  sections: TenderSectionConfig[],
  currentKey: TenderSectionKey,
  direction: -1 | 1,
): TenderSectionKey {
  const currentIndex = sections.findIndex((section) => section.key === currentKey);
  const nextIndex = Math.min(
    sections.length - 1,
    Math.max(0, currentIndex + direction),
  );
  return sections[nextIndex].key;
}
