import { useLayoutEffect, useRef, useState } from 'react';
import type {
  CompetitiveNegotiationDraft,
  InquiryPurchaseDraft,
  ReadyTenderDocumentType,
  ReadyTenderDraft,
  SingleSourceDraft,
  InternalBiddingDraft,
  TenderSectionKey,
  TenderFieldKey,
} from '../../lib/types/tender-write';
import type { TableData, TableCell } from './quotation-table-editor';

const CHINESE_NUMBERS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CHINESE_TENS = ['', '十', '二十', '三十'];

function numberToChinese(num: number): string {
  if (num < 10) {
    return CHINESE_NUMBERS[num];
  }
  const tens = Math.floor(num / 10);
  const ones = num % 10;
  if (ones === 0) {
    return CHINESE_TENS[tens];
  }
  return CHINESE_TENS[tens] + CHINESE_NUMBERS[ones];
}

function formatDateToChinese(dateString: string): string {
  if (!dateString || !dateString.trim()) {
    return dateString;
  }

  // Handle YYYY-MM format (cover date, month only)
  if (/^\d{4}-\d{2}$/.test(dateString)) {
    const [yearStr, monthStr] = dateString.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const chineseYear = yearStr.split('').map(d => CHINESE_NUMBERS[parseInt(d, 10)]).join('');
    const chineseMonth = numberToChinese(month);

    return `${chineseYear}年${chineseMonth}月`;
  }

  let date: Date;

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    date = new Date(dateString);
  } else if (/^\d{4}\.\d{2}\.\d{2}$/.test(dateString)) {
    const parts = dateString.split('.');
    date = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
  } else if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(dateString)) {
    return dateString;
  } else {
    date = new Date(dateString);
  }

  if (isNaN(date.getTime())) {
    return dateString;
  }

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const yearStr = year.toString();
  const chineseYear = yearStr.split('').map(d => CHINESE_NUMBERS[parseInt(d, 10)]).join('');
  const chineseMonth = numberToChinese(month);
  const chineseDay = numberToChinese(day);

  return `${chineseYear}年${chineseMonth}月${chineseDay}日`;
}

function normalizeSubmissionRequirements(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  return /^5[.．]\s*提交成果要求[:：]/.test(trimmed)
    ? trimmed
    : `5.提交成果要求：${trimmed}`;
}

function renderPreviewTable(tableData: TableData) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse border border-[oklch(0.55_0.05_258_/_0.2)]" style={{ tableLayout: 'fixed' }}>
        <tbody>
          {Array.from({ length: tableData.rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: tableData.cols }).map((_, colIndex) => {
                const cell = tableData.cells[rowIndex]?.[colIndex];
                if (!cell || cell.hidden) return null;
                return (
                  <td
                    key={colIndex}
                    rowSpan={cell.rowSpan}
                    colSpan={cell.colSpan}
                    className="border border-[oklch(0.55_0.05_258_/_0.2)] px-2 py-1.5 text-sm"
                    style={{ textAlign: cell.align }}
                  >
                    {cell.content || ' '}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewValue({
  value,
  placeholder,
  multiline = false,
  fieldKey,
  onValueChange,
}: {
  value: string;
  placeholder: string;
  multiline?: boolean;
  fieldKey?: TenderFieldKey;
  onValueChange?: (fieldKey: TenderFieldKey, value: string) => void;
}) {
  const isEmpty = typeof value !== 'string' || !value.trim();
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const isComposingRef = useRef(false);
  const isFocusedRef = useRef(false);
  const [frozen, setFrozen] = useState<string | null>(null);

  const formatNumberedText = (text: string): string => {
    if (!text || !text.trim()) return text;
    let result = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    result = result.replace(/(\(\d+\))/g, '\n$1');
    result = result.replace(/(\d+\.\s)/g, '\n$1');
    result = result.replace(/([①②③④⑤⑥⑦⑧⑨⑩]+)/g, '\n  $1');
    result = result.replace(/^\n/, '');
    result = result.replace(/\n+/g, '\n');
    return result.trim();
  };

  const displayValue = multiline ? formatNumberedText(value) : value;

  // Frozen children during editing, formatted value otherwise
  const childrenText = frozen !== null ? frozen : (isEmpty ? placeholder : displayValue);

  // When empty and not editing: render no children — let CSS ::before handle the placeholder
  const shouldRenderChildren = !isEmpty || frozen !== null;

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (isFocusedRef.current) return;
    const nextText = isEmpty ? '' : displayValue;
    if (element.textContent !== nextText) {
      element.innerHTML = '';
      if (!nextText) return;
      for (const part of nextText.split('\n')) {
        element.appendChild(document.createTextNode(part));
        element.appendChild(document.createElement('br'));
      }
      const lastChild = element.lastChild;
      if (lastChild?.nodeName === 'BR') {
        element.removeChild(lastChild);
      }
    }
  }, [isEmpty, displayValue]);

  const extractText = (el: HTMLElement): string => {
    return (el.innerText || '').replace(/\r\n/g, '\n');
  };

  if (onValueChange && fieldKey) {
    return (
      <span
        ref={elementRef}
        id={`preview-field-${fieldKey}`}
        contentEditable
        suppressContentEditableWarning
        data-empty={isEmpty}
        data-placeholder={placeholder}
        onFocus={() => {
          isFocusedRef.current = true;
          setFrozen(value);
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          isComposingRef.current = false;
          onValueChange(fieldKey, extractText(e.currentTarget));
        }}
        onInput={(e) => {
          if (!isComposingRef.current) {
            onValueChange(fieldKey, extractText(e.currentTarget));
          }
        }}
        onBlur={(e) => {
          isFocusedRef.current = false;
          const rawValue = extractText(e.currentTarget);
          setFrozen(null);
          onValueChange(fieldKey, rawValue);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && multiline) {
            e.preventDefault();
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) return;
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const br = document.createElement('br');
            range.insertNode(br);
            range.setStartAfter(br);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }}
        className={`tender-preview-editable outline-none rounded-[4px] px-1 -mx-1 hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] focus:bg-[color-mix(in_oklch,var(--accent)_14%,transparent)] transition-colors cursor-text ${multiline ? 'whitespace-pre-wrap block' : ''} ${isEmpty && frozen === null ? 'tender-preview-placeholder min-w-[4rem] inline-block' : 'text-[color:var(--accent-strong)]'}`}
      >
        {shouldRenderChildren ? childrenText : null}
      </span>
    );
  }

  if (isEmpty) {
    return (
      <span id={fieldKey ? `preview-field-${fieldKey}` : undefined} className="tender-preview-placeholder rounded-[10px] px-2 py-1 transition-all duration-200">
        {placeholder}
      </span>
    );
  }

  return <span id={fieldKey ? `preview-field-${fieldKey}` : undefined} className={`text-blue-600 ${multiline ? 'whitespace-pre-wrap' : ''}`}>{displayValue}</span>;
}

function PreviewSection({
  sectionKey,
  title,
  chapterLabel,
  activeSectionKey,
  children,
  onSectionClick,
}: {
  sectionKey: TenderSectionKey;
  title: string;
  chapterLabel: string;
  activeSectionKey: TenderSectionKey;
  children: React.ReactNode;
  onSectionClick?: (key: TenderSectionKey) => void;
}) {
  const isActive = sectionKey === activeSectionKey;

  return (
    <section
      id={`preview-${sectionKey}`}
      data-section-key={sectionKey}
      onClick={() => onSectionClick?.(sectionKey)}
      className={[
        'scroll-mt-6 transition-all duration-300 cursor-pointer',
        isActive
          ? 'rounded-[10px] bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-3 py-3'
          : 'border-b border-[oklch(0.6_0.04_258_/_0.08)] px-0 pb-3 hover:bg-[oklch(1_0_0_/_0.2)]',
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
            {chapterLabel}
          </div>
          <h3 className="mt-1.5 text-xs font-semibold tracking-[-0.01em] text-[color:var(--foreground)]">
            {title}
          </h3>
        </div>
        {isActive ? (
          <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2.5 py-1 text-[10px] font-semibold text-[color:var(--accent)]">
            当前编辑
          </span>
        ) : null}
      </div>
      <div className="mt-4 space-y-4 text-sm leading-8 text-[color:var(--foreground)] tender-preview-typography">
        {children}
      </div>
    </section>
  );
}

export function TenderPreviewDocument({
  documentType,
  draft,
  activeSectionKey,
  onSectionClick,
  onValueChange,
}: {
  documentType: ReadyTenderDocumentType;
  draft: ReadyTenderDraft;
  activeSectionKey: TenderSectionKey;
  onSectionClick?: (key: TenderSectionKey) => void;
  onValueChange?: (fieldKey: TenderFieldKey, value: string) => void;
}) {
  if (documentType === 'SINGLE_SOURCE') {
    return (
      <SingleSourcePreview
        draft={draft as SingleSourceDraft}
        activeSectionKey={activeSectionKey}
        onSectionClick={onSectionClick}
        onValueChange={onValueChange}
      />
    );
  }

  if (documentType === 'INQUIRY_PURCHASE') {
    return (
      <InquiryPurchasePreview
        draft={draft as InquiryPurchaseDraft}
        activeSectionKey={activeSectionKey}
        onSectionClick={onSectionClick}
        onValueChange={onValueChange}
      />
    );
  }

  if (documentType === 'INTERNAL_BIDDING' || documentType === 'INVITED_BIDDING') {
    return (
      <InternalBiddingPreview
        isInvited={documentType === 'INVITED_BIDDING'}
        draft={draft as InternalBiddingDraft}
        activeSectionKey={activeSectionKey}
        onSectionClick={onSectionClick}
        onValueChange={onValueChange}
      />
    );
  }

  return (
    <CompetitiveNegotiationPreview
      draft={draft as CompetitiveNegotiationDraft}
      activeSectionKey={activeSectionKey}
      onSectionClick={onSectionClick}
      onValueChange={onValueChange}
    />
  );
}

function CompetitiveNegotiationPreview({
  draft,
  activeSectionKey,
  onSectionClick,
  onValueChange,
}: {
  draft: CompetitiveNegotiationDraft;
  activeSectionKey: TenderSectionKey;
  onSectionClick?: (key: TenderSectionKey) => void;
  onValueChange?: (fieldKey: TenderFieldKey, value: string) => void;
}) {
  // Helper to create PreviewValue with onValueChange
  const PV = (value: string, placeholder: string, fieldKey: TenderFieldKey, multiline = false) => (
    <PreviewValue
      value={value}
      placeholder={placeholder}
      fieldKey={fieldKey}
      multiline={multiline}
      onValueChange={onValueChange}
    />
  );

  // Get submissionRequirementsType from draft
  const submissionRequirementsType = (draft as Record<string, string>).submissionRequirementsType;

  return (
    <div className="pb-4">
      <div className="mx-auto max-w-[72ch] space-y-5">
        {/* 封面 */}
        <PreviewSection
          sectionKey="cover"
          chapterLabel="封面"
          title="谈判采购文件"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="py-8 text-center">
            <div className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
              <PreviewValue value={draft.projectName} placeholder="{{项目名称}}" fieldKey="projectName" onValueChange={onValueChange} />
            </div>
            <div className="mt-4 text-sm font-semibold tracking-[0.04em] text-[var(--muted-foreground)]">
              谈判采购文件
            </div>
            <div className="mt-6 text-sm text-[color:var(--foreground)]">
              采 购 人：四川水发勘测设计研究有限公司
            </div>
            <div className="mt-2 text-sm text-[color:var(--foreground)]">
              日　　期：<PreviewValue value={formatDateToChinese(draft.coverDate)} placeholder="{{封面时间}}" fieldKey="coverDate" onValueChange={onValueChange} />
            </div>
          </div>
        </PreviewSection>

        {/* 第一章 采购邀请 */}
        <PreviewSection
          sectionKey="invitation"
          chapterLabel="第一章"
          title="采购邀请"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              一、项目基本情况
            </div>
            <div className="mt-3 space-y-2 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>1.项目名称：<PreviewValue value={draft.projectName} placeholder="{{项目名称}}" fieldKey="projectName" onValueChange={onValueChange} /></p>
              <p>2.项目概况和采购内容：<PreviewValue value={draft.projectOverview} placeholder="{{项目概况和采购内容}}" fieldKey="projectOverview" onValueChange={onValueChange} /></p>
              <p>3.项目最高限价（含税）：最高限价<PreviewValue value={draft.maxPrice} placeholder="{{最高限价}}" fieldKey="maxPrice" onValueChange={onValueChange} />元。</p>
              <p>4.合同履行期限：双方履行完合同约定的义务后，本合同终止。</p>
              {draft.submissionRequirementsType !== 'none' && (
                <PreviewValue value={normalizeSubmissionRequirements(draft.submissionRequirements)} placeholder="{{提交成果要求}}" multiline fieldKey="submissionRequirements" onValueChange={onValueChange} />
              )}
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              二、供应商的资格要求（须同时满足）
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>1.供应商基本资格要求：</p>
              <p className="ml-4">1.1提供有效营业执照或事业单位法人证书；</p>
              <p className="ml-4">1.2未被市场监督管理机关在"国家企业信用信息公示系统"网站（www.gsxt.gov.cn）列入严重违法失信名单；</p>
              <p className="ml-4">1.3未被最高人民法院在"信用中国"网站（www.creditchina.gov.cn）列入严重失信名单；</p>
              <p className="ml-4">1.4符合法律、行政法规规定的其他条件。</p>
              <p className="mt-2">2.本项目特定资格要求：<PreviewValue value={draft.qualificationRequirements} placeholder="{{特定资格要求}}" multiline fieldKey="qualificationRequirements" onValueChange={onValueChange} />。</p>
              <p className="mt-2">3.本项目不接受被邀请的供应商以联合体形式参加谈判。</p>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              三、采购文件获取
            </div>
            <div className="mt-3 space-y-2 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>1.时　　间：<PreviewValue value={draft.documentAcquireTime} placeholder="{{文件获取时间}}" fieldKey="documentAcquireTime" onValueChange={onValueChange} />。</p>
              <p>2.方　　式：采购人以电子邮件的方式将采购文件发放给所有供应商。</p>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              四、响应文件提交、开标
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>响应文件提交截止时间、开标时间：<PreviewValue value={draft.responseDeadline} placeholder="{{响应文件提交截至时间}}" fieldKey="responseDeadline" onValueChange={onValueChange} />。</p>
              <p className="mt-2">地　　点：成都市天府新区红莲街三段383号 B栋3楼。</p>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              五、监督举报
            </div>
            <div className="mt-3 space-y-2 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>监督部门：四川水发勘测设计研究有限公司纪检监察部</p>
              <p>地　　址：四川省成都市天府新区红莲街三段383号</p>
              <p>联 系 人：王先生、徐先生</p>
              <p>电　　话：028-81753276</p>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              六、联系人及联系电话
            </div>
            <div className="mt-3 space-y-2 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>采 购 人：四川水发勘测设计研究有限公司</p>
              <p>地　　址：成都市天府新区红莲街三段383号</p>
              <p>联 系 人：<PreviewValue value={draft.contactName} placeholder="{{联系人}}" fieldKey="contactName" onValueChange={onValueChange} /></p>
              <p>电　　话：<PreviewValue value={draft.contactPhone} placeholder="{{联系电话}}" fieldKey="contactPhone" onValueChange={onValueChange} /></p>
              <p>邮　　箱：<PreviewValue value={draft.contactEmail} placeholder="{{联系邮箱}}" fieldKey="contactEmail" onValueChange={onValueChange} /></p>
            </div>
          </div>
        </PreviewSection>

        {/* 第二章 供应商须知 */}
        <PreviewSection
          sectionKey="supplier"
          chapterLabel="第二章"
          title="供应商须知"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-center font-semibold text-[color:var(--foreground)]">
              供应商须知前附表
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse border border-[oklch(0.55_0.05_258_/_0.2)]">
                <tbody>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm w-[15%]">
                      条款号
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm w-[25%]">
                      条目
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm">
                      内容
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">7.2</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">报价</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      最高限价：<PreviewValue value={draft.maxPrice} placeholder="{{最高限价}}" fieldKey="maxPrice" onValueChange={onValueChange} />元（含税）。超过最高限价的报价为无效报价。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">8</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">响应有效期</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      自响应文件提交截止日期起算90日历天。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">11.2</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">响应文件份数</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      纸质版正本一份，副本4份，1份电子文档（U盘，电子文档为响应文件正本PDF扫描件）
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">15</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">确定中标人</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      经多轮报价，最低价中标，成交候选人并列的，按照以下方式确定成交供应商：再次报价，直到确定最低报价的供应商为止。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">18.3</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">合同分包</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      本项目是否允许分包：
                      {!draft.contractSubcontractingType ? (
                        <span className="rounded-[6px] bg-[rgba(234,188,110,0.12)] px-1 text-[rgba(178,124,42,1)]">{"{{合同分包}}"}</span>
                      ) : draft.contractSubcontractingType === 'none' ? (
                        <span>☑不允许 ☐允许，具体要求：/；分包应征得采购人同意</span>
                      ) : (
                        <span>☐不允许 ☑允许，具体要求：<PreviewValue value={draft.contractSubcontracting} placeholder="{{合同分包}}" fieldKey="contractSubcontracting" onValueChange={onValueChange} />；分包应征得采购人同意</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">20.1</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">询问</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      询问的送达形式：书面报告。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm" colSpan={2}>是否组织现场踏勘</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      <PreviewValue value={draft.siteSurvey} placeholder="{{是否组织现场踏勘}}" fieldKey="siteSurvey" onValueChange={onValueChange} />
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm" colSpan={2}>联系方式</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      接受询问和异议的联系方式：
                      <br />联系部门：四川水发勘测设计研究有限公司采购中心
                      <br />联 系 人：<PreviewValue value={draft.contactName} placeholder="{{联系人}}" fieldKey="contactName" onValueChange={onValueChange} />
                      <br />联系电话：<PreviewValue value={draft.contactPhone} placeholder="{{联系电话}}" fieldKey="contactPhone" onValueChange={onValueChange} />
                      <br />通讯地址：四川省成都市天府新区红莲街三段383号
                      <br />电子邮箱：<PreviewValue value={draft.contactEmail} placeholder="{{联系邮箱}}" fieldKey="contactEmail" onValueChange={onValueChange} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-4 pt-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              3. 采购文件构成
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>3.1 采购文件包括以下部分：</p>
              <p className="ml-4">第一章 采购邀请</p>
              <p className="ml-4">第二章 供应商须知</p>
              <p className="ml-4">第三章 评审程序和评定成交的标准</p>
              <p className="ml-4">第四章 采购需求</p>
              <p className="ml-4">第五章 响应文件格式</p>
            </div>
          </div>
        </PreviewSection>

        {/* 第三章 采购需求 */}
        <PreviewSection
          sectionKey="requirements"
          chapterLabel="第三章"
          title="采购需求"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              一、采购标的概述
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <PreviewValue
                value={draft.projectOverview}
                placeholder="{{项目概述及采购内容}}"
                multiline
                fieldKey="projectOverview"
                onValueChange={onValueChange}
              />
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              二、商务要求
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <PreviewValue
                value={draft.businessRequirements}
                placeholder="{{商务要求}}"
                multiline
                fieldKey="businessRequirements"
                onValueChange={onValueChange}
              />
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              三、技术要求
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <PreviewValue
                value={draft.technicalRequirements}
                placeholder="{{技术要求}}"
                multiline
                fieldKey="technicalRequirements"
                onValueChange={onValueChange}
              />
            </div>
          </div>
        </PreviewSection>

        {/* 第五章 响应文件格式 */}
        <PreviewSection
          sectionKey="quotation"
          chapterLabel="第五章"
          title="响应文件格式"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              6. 报价表
            </div>
            <div className="mt-3 text-sm leading-7 text-[color:var(--foreground)]">
              {draft.quotationLetterType === 'table' ? (
                (() => {
                  const draftWithTable = draft as { quotationLetterTable?: TableData };
                  const tableData = draftWithTable.quotationLetterTable;
                  if (tableData && tableData.rows > 0) {
                    return renderPreviewTable(tableData);
                  }
                  return (
                    <span className="rounded-[10px] bg-[rgba(234,188,110,0.12)] px-2 py-1 text-[rgba(178,124,42,1)] transition-all duration-200">
                      {"{{报价表}}"}
                    </span>
                  );
                })()
              ) : (
                (typeof draft.quotationLetter === 'string' && draft.quotationLetter.trim()) ? (
                  <PreviewValue
                    value={draft.quotationLetter}
                    placeholder="{{报价表}}"
                    multiline
                    fieldKey="quotationLetter"
                    onValueChange={onValueChange}
                  />
                ) : (
                  <span className="rounded-[10px] bg-[rgba(234,188,110,0.12)] px-2 py-1 text-[rgba(178,124,42,1)] transition-all duration-200">
                    {"{{报价表}}"}
                  </span>
                )
              )}
            </div>
          </div>
        </PreviewSection>
      </div>
    </div>
  );
}

function SingleSourcePreview({
  draft,
  activeSectionKey,
  onSectionClick,
  onValueChange,
}: {
  draft: SingleSourceDraft;
  activeSectionKey: TenderSectionKey;
  onSectionClick?: (key: TenderSectionKey) => void;
  onValueChange?: (fieldKey: TenderFieldKey, value: string) => void;
}) {
  return (
    <div className="pb-4">
      <div className="mx-auto max-w-[72ch] space-y-5">
        {/* 封面 */}
        <PreviewSection
          sectionKey="cover"
          chapterLabel="封面"
          title="直接采购文件"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="py-8 text-center">
            <div className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
              <PreviewValue value={draft.projectName} placeholder="{{项目名称}}" fieldKey="projectName" onValueChange={onValueChange} />
            </div>
            <div className="mt-4 text-sm font-semibold tracking-[0.04em] text-[var(--muted-foreground)]">
              直接采购文件
            </div>
            <div className="mt-6 text-sm text-[color:var(--foreground)]">
              采 购 人：四川水发勘测设计研究有限公司
            </div>
            <div className="mt-2 text-sm text-[color:var(--foreground)]">
              日　　期：<PreviewValue value={formatDateToChinese(draft.coverDate)} placeholder="{{封面时间}}" fieldKey="coverDate" onValueChange={onValueChange} />
            </div>
          </div>
        </PreviewSection>

        {/* 第一部分 直接采购邀请函 */}
        <PreviewSection
          sectionKey="invitation"
          chapterLabel="第一部分"
          title="直接采购邀请函"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <p className="text-sm leading-7 text-[color:var(--foreground)]">
              <PreviewValue value={draft.supplierName} placeholder="{{供应商名称}}" fieldKey="supplierName" onValueChange={onValueChange} />：
            </p>
            <p className="mt-3 indent-8 text-sm leading-7 text-[color:var(--foreground)]">
              根据单位内部采购管理制度规定，该项目符合直接采购的适用条件。现正式向贵单位发出直接采购邀请，具体事宜如下：
            </p>
          </div>
          <div className="mt-4 pt-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              一、采购项目基本信息
            </div>
            {/* 采购项目基本信息表格 */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse border border-[oklch(0.55_0.05_258_/_0.2)]">
                <tbody>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm w-[30%]">
                      项目内容
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center font-semibold text-sm">
                      详细说明
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center text-sm">
                      项目名称
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">
                      <PreviewValue value={draft.projectName} placeholder="{{项目名称}}" fieldKey="projectName" onValueChange={onValueChange} />
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center text-sm">
                      采购内容
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">
                      详见第三部分
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center text-sm">
                      项目预算
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">
                      最高限价 <PreviewValue value={draft.projectBudget} placeholder="{{项目预算价格}}" fieldKey="projectBudget" onValueChange={onValueChange} /> 元（含税）
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center text-sm">
                      项目完成期限
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">
                      <PreviewValue value={draft.projectDuration} placeholder="{{项目完成期限}}" fieldKey="projectDuration" onValueChange={onValueChange} />
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center text-sm">
                      采购文件获取时间
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">
                      <PreviewValue value={draft.documentAcquireTime} placeholder="{{采购文件获取时间}}" fieldKey="documentAcquireTime" onValueChange={onValueChange} />
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center text-sm">
                      采购文件领取地点
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">
                      四川省成都市双流区正兴街道红莲街三段383号四川水发集团B座3楼
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center text-sm">
                      采购文件售价
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">
                      人民币 <PreviewValue value={draft.documentPrice} placeholder="{{采购文件售价}}" fieldKey="documentPrice" onValueChange={onValueChange} /> 元/份
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              二、响应文件递交和谈判的时间及地点
            </div>
            <div className="mt-3 space-y-2 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>
                1．递交和谈判时间：<PreviewValue value={draft.submissionAndNegotiationTime} placeholder="{{递交和谈判时间}}" fieldKey="submissionAndNegotiationTime" onValueChange={onValueChange} />。
              </p>
              <p>
                2．递交和谈判地点：四川省成都市双流区正兴街道红莲街三段383号四川水发集团B座3楼。响应文件必须在递交响应文件截止时间前送达谈判地点。逾期送达的响应文件不予接收。
              </p>
              <p>3．届时请参加报价的法定代表人或授权代表出席。</p>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              三、联系方式
            </div>
            <div className="mt-3 space-y-2 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>采 购 人：四川水发勘测设计研究有限公司</p>
              <p>地　　址：四川省成都市双流区正兴街道红莲街三段383号四川水发集团B座</p>
              <p>
                联 系 人：<PreviewValue value={draft.contactName} placeholder="{{联系人}}" fieldKey="contactName" onValueChange={onValueChange} />
              </p>
              <p>
                邮　　箱：<PreviewValue value={draft.contactEmail} placeholder="{{联系邮箱}}" fieldKey="contactEmail" onValueChange={onValueChange} />
              </p>
              <p>
                电　　话：<PreviewValue value={draft.contactPhone} placeholder="{{联系电话}}" fieldKey="contactPhone" onValueChange={onValueChange} />
              </p>
            </div>
          </div>
        </PreviewSection>

        {/* 第二部分 供应商须知 */}
        <PreviewSection
          sectionKey="terms"
          chapterLabel="第二部分"
          title="供应商须知"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-center font-semibold text-[color:var(--foreground)]">
              供应商须知前附表
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse border border-[oklch(0.55_0.05_258_/_0.2)]">
                <tbody>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm w-[10%]">
                      序号
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm w-[25%]">
                      条款名称
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm">
                      说明与要求
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">1</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">项目名称</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      <PreviewValue value={draft.projectName} placeholder="{{项目名称}}" fieldKey="projectName" onValueChange={onValueChange} />
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">2</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">采购人</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">四川水发勘测设计研究有限公司</td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">3</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">最高限价</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      最高限价：<PreviewValue value={draft.projectBudget} placeholder="{{项目预算价格}}" fieldKey="projectBudget" onValueChange={onValueChange} />元（含税）。超过最高限价的报价为无效报价。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">5</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">供应商询问</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      联系人：<PreviewValue value={draft.contactName} placeholder="{{联系人}}" fieldKey="contactName" onValueChange={onValueChange} />
                      <br />
                      联系电话：<PreviewValue value={draft.contactPhone} placeholder="{{联系电话}}" fieldKey="contactPhone" onValueChange={onValueChange} />
                      <br />
                      地址：四川省成都市双流区正兴街道红莲街三段 383 号四川水发集团 B 座。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">6</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">递交响应文件截止时间</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      <PreviewValue value={draft.submissionAndNegotiationTime} placeholder="{{递交和谈判时间}}" fieldKey="submissionAndNegotiationTime" onValueChange={onValueChange} />
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">7</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">谈判地点</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      四川省成都市双流区正兴街道红莲街三段 383 号四川水发集团 B 座3楼采购中心开标会议室。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">8</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">响应文件份数</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      文件要求：供应商的《响应文件》须 1 份正本和 2 份副本，且需提供响应的电子文档，每套响应文件须清楚地标明"正本"或"副本"并分别胶装装订成册。如不胶装装订，其《响应文件》将被拒绝。若正本和副本不符，以正本为准。
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="mt-4 pt-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              响应文件构成
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>供应商编写的响应文件应包括下列内容：</p>
              <p className="mt-2">①报价函及报价函附录</p>
              <p>②营业执照</p>
              <p>③法定代表人身份证明</p>
              <p>④法定代表人授权委托书</p>
              {(draft as Record<string, string>).serviceContentType === 'yes' ? (
                <p>⑤服务内容</p>
              ) : (draft as Record<string, string>).serviceContentType === undefined || (draft as Record<string, string>).serviceContentType === '' ? (
                <p>
                  <span className="rounded-[6px] bg-[rgba(234,188,110,0.12)] px-1 text-[rgba(178,124,42,1)]">
                    {"{{服务内容}}"}
                  </span>
                </p>
              ) : null}
            </div>
          </div>
        </PreviewSection>

        {/* 第三部分 采购内容及要求 */}
        <PreviewSection
          sectionKey="procurement"
          chapterLabel="第三部分"
          title="采购内容及要求"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              一、采购内容
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <PreviewValue
                value={draft.procurementContent}
                placeholder="{{采购内容}}"
                multiline
                fieldKey="procurementContent"
                onValueChange={onValueChange}
              />
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              二、采购要求
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <PreviewValue
                value={draft.procurementRequirements}
                placeholder="{{采购要求}}"
                multiline
                fieldKey="procurementRequirements"
                onValueChange={onValueChange}
              />
            </div>
          </div>
        </PreviewSection>

        {/* 第五部分 响应文件格式 */}
        <PreviewSection
          sectionKey="response"
          chapterLabel="第五部分"
          title="响应文件格式"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              一、报价函及报价函附录
            </div>
            <div className="mt-3 text-sm leading-7 text-[color:var(--foreground)]">
              {draft.quotationLetterType === 'table' ? (
                (() => {
                  const draftWithTable = draft as { quotationLetterTable?: TableData };
                  const tableData = draftWithTable.quotationLetterTable;
                  if (tableData && tableData.rows > 0) {
                    return renderPreviewTable(tableData);
                  }
                  return (
                    <span className="rounded-[10px] bg-[rgba(234,188,110,0.12)] px-2 py-1 text-[rgba(178,124,42,1)] transition-all duration-200">
                      {"{{报价表}}"}
                    </span>
                  );
                })()
              ) : (
                (typeof draft.quotationLetter === 'string' && draft.quotationLetter.trim()) ? (
                  <PreviewValue
                    value={draft.quotationLetter}
                    placeholder="{{报价表}}"
                    multiline
                    fieldKey="quotationLetter"
                    onValueChange={onValueChange}
                  />
                ) : (
                  <span className="rounded-[10px] bg-[rgba(234,188,110,0.12)] px-2 py-1 text-[rgba(178,124,42,1)] transition-all duration-200">
                    {"{{报价表}}"}
                  </span>
                )
              )}
            </div>
          </div>
        </PreviewSection>
      </div>
    </div>
  );
}

function InquiryPurchasePreview({
  draft,
  activeSectionKey,
  onSectionClick,
  onValueChange,
}: {
  draft: InquiryPurchaseDraft;
  activeSectionKey: TenderSectionKey;
  onSectionClick?: (key: TenderSectionKey) => void;
  onValueChange?: (fieldKey: TenderFieldKey, value: string) => void;
}) {
  return (
    <div className="pb-4">
      <div className="mx-auto max-w-[72ch] space-y-5">
        {/* 封面 */}
        <PreviewSection
          sectionKey="cover"
          chapterLabel="封面"
          title="询比采购文件"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="py-8 text-center">
            <div className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
              <PreviewValue value={draft.projectName} placeholder="{{项目名称}}" fieldKey="projectName" onValueChange={onValueChange} />
            </div>
            <div className="mt-4 text-sm font-semibold tracking-[0.04em] text-[var(--muted-foreground)]">
              询比采购文件
            </div>
            <div className="mt-6 text-sm text-[color:var(--foreground)]">
              采 购 人：四川水发勘测设计研究有限公司
            </div>
            <div className="mt-2 text-sm text-[color:var(--foreground)]">
              日　　期：<PreviewValue value={formatDateToChinese(draft.coverDate)} placeholder="{{封面时间}}" fieldKey="coverDate" onValueChange={onValueChange} />
            </div>
          </div>
        </PreviewSection>

        {/* 第一部分 询价须知 */}
        <PreviewSection
          sectionKey="instructions"
          chapterLabel="第一部分"
          title="询价须知"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          {/* 询价须知表格 */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-[oklch(0.55_0.05_258_/_0.2)]">
              <tbody>
                <tr>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm w-[20%]">
                    询价单位
                  </td>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">
                    四川水发勘测设计研究有限公司
                  </td>
                </tr>
                <tr>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm">
                    项目名称
                  </td>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">
                    <PreviewValue value={draft.projectName} placeholder="{{项目名称}}" fieldKey="projectName" onValueChange={onValueChange} />
                  </td>
                </tr>
                <tr>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm">
                    项目介绍
                  </td>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                    <PreviewValue value={draft.projectIntroduction} placeholder="{{项目介绍}}" multiline fieldKey="projectIntroduction" onValueChange={onValueChange} />
                  </td>
                </tr>
                <tr>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm">
                    采购内容
                  </td>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                    <PreviewValue value={draft.procurementContent} placeholder="{{采购内容}}" multiline fieldKey="procurementContent" onValueChange={onValueChange} />
                  </td>
                </tr>
                <tr>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm">
                    报价要求
                  </td>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                    报价函格式按照附件一要求
                  </td>
                </tr>
                <tr>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm">
                    需提供资料
                  </td>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                    <PreviewValue value={draft.requiredDocuments} placeholder="{{需提供的资料}}" fieldKey="requiredDocuments" onValueChange={onValueChange} />
                  </td>
                </tr>
                <tr>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm">
                    评标方法
                  </td>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                    采用最低价中标法，如遇相同报价以{draft.evaluationMethod ? draft.evaluationMethod : <span className="rounded-[6px] bg-[rgba(234,188,110,0.12)] px-1 text-[rgba(178,124,42,1)]">{"{{评标方法}}"}</span>}。
                  </td>
                </tr>
                <tr>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm">
                    限价要求
                  </td>
                  <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                    最高限价：<PreviewValue value={draft.priceLimit} placeholder="{{最高限价}}" fieldKey="priceLimit" onValueChange={onValueChange} />元（含税）。超过最高限价的报价为无效报价
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 pt-3">
            <div className="text-sm leading-7 text-[color:var(--foreground)]">
              <span className="font-semibold">一、递交报价函截止时间：</span>
              <PreviewValue value={draft.submissionDeadline} placeholder="{{递交报价函截止时间}}" fieldKey="submissionDeadline" onValueChange={onValueChange} />
              。
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-sm leading-7 text-[color:var(--foreground)]">
              <span className="font-semibold">二、递交报价函地址及联系方式</span>
            </div>
            <div className="mt-3 space-y-2 pl-4 text-sm leading-7 text-[color:var(--foreground)]">
              <p>
                地　　址：四川省成都市双流区正兴街道红莲街三段383号四川水发集团B座3楼
              </p>
              <p>
                联 系 人：<PreviewValue value={draft.contactName} placeholder="{{联系人}}" fieldKey="contactName" onValueChange={onValueChange} />
              </p>
              <p>
                邮　　箱：<PreviewValue value={draft.contactEmail} placeholder="{{联系邮箱}}" fieldKey="contactEmail" onValueChange={onValueChange} />
              </p>
              <p>
                电　　话：<PreviewValue value={draft.contactPhone} placeholder="{{联系电话}}" fieldKey="contactPhone" onValueChange={onValueChange} />
              </p>
            </div>
          </div>
        </PreviewSection>

        {/* 第二部分 附件一 报价函 */}
        <PreviewSection
          sectionKey="quotation"
          chapterLabel="附件一"
          title="报价函"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-center text-base font-semibold text-[color:var(--foreground)]">
              报价函
            </div>
            <div className="mt-4 text-sm leading-7 text-[color:var(--foreground)]">
              <p className="indent-8">四川水发勘测设计研究有限公司：</p>
              <p className="mt-3 indent-8">根据<PreviewValue value={draft.projectName} placeholder="{{项目名称}}" fieldKey="projectName" onValueChange={onValueChange} />询价文件要求，现郑重承诺如下：</p>
              <p className="mt-3 indent-8">我方已认真阅读并接受本询价文件的所有要求。</p>
              <p className="mt-3 indent-8">我方对上述承诺的内容事项真实性负责。如经查实上述承诺的内容事项存在虚假，我方愿意接受以提供虚假材料的法律责任。</p>
              <p className="mt-3 indent-8">我公司仔细研究了询价文件和项目的基本情况，根据本公司的实际情况，我方愿意以人民币（大写）　　　　　　（¥　　　　）的响应总报价（其中，增值税税率为　　　　），按合同约定履行义务。</p>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              报价表
            </div>
            <div className="mt-3 text-sm leading-7 text-[color:var(--foreground)]">
              {draft.quotationLetterType === 'table' ? (
                (() => {
                  const draftWithTable = draft as { quotationLetterTable?: TableData };
                  const tableData = draftWithTable.quotationLetterTable;
                  if (tableData && tableData.rows > 0) {
                    return renderPreviewTable(tableData);
                  }
                  return (
                    <span className="rounded-[10px] bg-[rgba(234,188,110,0.12)] px-2 py-1 text-[rgba(178,124,42,1)] transition-all duration-200">
                      {"{{报价表}}"}
                    </span>
                  );
                })()
              ) : (
                (typeof draft.quotationLetter === 'string' && draft.quotationLetter.trim()) ? (
                  <PreviewValue
                    value={draft.quotationLetter}
                    placeholder="{{报价表}}"
                    multiline
                    fieldKey="quotationLetter"
                    onValueChange={onValueChange}
                  />
                ) : (
                  <span className="rounded-[10px] bg-[rgba(234,188,110,0.12)] px-2 py-1 text-[rgba(178,124,42,1)] transition-all duration-200">
                    {"{{报价表}}"}
                  </span>
                )
              )}
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-sm leading-7 text-[color:var(--foreground)]">
              <div className="flex justify-between">
                <div>
                  <p>供 应 商：　　　　　　　　　　（盖单位章）</p>
                  <p className="mt-2">联 系 人：　　　　　　　　　　</p>
                  <p className="mt-2">电　　话：　　　　　　　　　　</p>
                </div>
                <div className="text-right">
                  <p>　　　　　　年　　　　月　　　　日</p>
                </div>
              </div>
            </div>
          </div>
        </PreviewSection>
      </div>
    </div>
  );
}

function InternalBiddingPreview({
  draft,
  activeSectionKey,
  onSectionClick,
  onValueChange,
  isInvited = false,
}: {
  draft: InternalBiddingDraft;
  activeSectionKey: TenderSectionKey;
  onSectionClick?: (key: TenderSectionKey) => void;
  onValueChange?: (fieldKey: TenderFieldKey, value: string) => void;
  isInvited?: boolean;
}) {
  // 术语映射：邀请招标 vs 竞价采购
  const T = isInvited
    ? { docTitle: '邀请招标文件', party: '投标人', file: '投标文件', chapter: '招标邀请', buyer: '招标人' }
    : { docTitle: '竞价采购文件', party: '供应商', file: '响应文件', chapter: '采购邀请', buyer: '采购人' };

  return (
    <div className="pb-4">
      <div className="mx-auto max-w-[72ch] space-y-5">
        {/* 封面 */}
        <PreviewSection
          sectionKey="cover"
          chapterLabel="封面"
          title={T.docTitle}
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="py-8 text-center">
            <div className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
              <PreviewValue value={draft.projectName} placeholder="{{项目名称}}" fieldKey="projectName" onValueChange={onValueChange} />
            </div>
            <div className="mt-4 text-sm font-semibold tracking-[0.04em] text-[var(--muted-foreground)]">
              {T.docTitle}
            </div>
            <div className="mt-6 text-sm text-[color:var(--foreground)]">
              {T.buyer}：四川水发勘测设计研究有限公司
            </div>
            <div className="mt-2 text-sm text-[color:var(--foreground)]">
              日　　期：<PreviewValue value={formatDateToChinese(draft.coverDate)} placeholder="{{封面时间}}" fieldKey="coverDate" onValueChange={onValueChange} />
            </div>
          </div>
        </PreviewSection>

        {/* 第一章 邀请/采购邀请 */}
        <PreviewSection
          sectionKey="invitation"
          chapterLabel="第一章"
          title={T.chapter}
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              一、项目基本情况
            </div>
            <div className="mt-3 space-y-2 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>1.项目名称：<PreviewValue value={draft.projectName} placeholder="{{项目名称}}" fieldKey="projectName" onValueChange={onValueChange} /></p>
              <p>2.项目概况和采购内容：<PreviewValue value={draft.projectOverview} placeholder="{{项目概况和采购内容}}" fieldKey="projectOverview" onValueChange={onValueChange} /></p>
              <p>3.项目最高限价（含税）：最高限价<PreviewValue value={draft.maxPrice} placeholder="{{最高限价}}" fieldKey="maxPrice" onValueChange={onValueChange} />元。</p>
              <p>4.合同履行期限：双方履行完合同约定的义务后，本合同终止。</p>
              {draft.submissionRequirementsType !== 'none' && (
                <PreviewValue value={normalizeSubmissionRequirements(draft.submissionRequirements)} placeholder="{{提交成果要求}}" multiline fieldKey="submissionRequirements" onValueChange={onValueChange} />
              )}
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              二、{T.party}的资格要求（须同时满足）
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>1.{T.party}基本资格要求：</p>
              <p className="ml-4">1.1 提供有效营业执照或事业单位法人证书；</p>
              <p className="ml-4">1.2 未被市场监督管理机关在"国家企业信用信息公示系统"网站（www.gsxt.gov.cn）列入严重违法失信名单；</p>
              <p className="ml-4">1.3 未被最高人民法院在"信用中国"网站（www.creditchina.gov.cn）列入严重失信名单；</p>
              <p className="ml-4">1.4 符合法律、行政法规规定的其他条件。</p>
              <p className="mt-2">2.本项目特定资格要求：<PreviewValue value={draft.qualificationRequirements} placeholder="{{特定资质要求}}" multiline fieldKey="qualificationRequirements" onValueChange={onValueChange} />。</p>
              <p className="mt-2">3.本项目{!draft.consortiumFormType ? '☐' : (draft.consortiumFormType === 'accept' ? '☑' : '☐')}接受/{!draft.consortiumFormType ? '☐' : (draft.consortiumFormType === 'reject' ? '☑' : '☐')}不接受被邀请的{T.party}以联合体形式参加响应。
              {!draft.consortiumFormType ? (
                <span><br />联合体还应满足下列要求：<span className="rounded-[6px] bg-[rgba(234,188,110,0.12)] px-1 text-[rgba(178,124,42,1)]">{"{{联合体形式}}"}</span>。</span>
              ) : draft.consortiumFormType === 'accept' ? (
                <span><br />联合体还应满足下列要求：<PreviewValue value={draft.consortiumForm} placeholder="{{联合体形式要求}}" fieldKey="consortiumForm" onValueChange={onValueChange} />。</span>
              ) : (
                <span><br />联合体还应满足下列要求：/。</span>
              )}
            </p>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              三、{T.file}获取
            </div>
            <div className="mt-3 space-y-2 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>1.时　　间：<PreviewValue value={draft.documentAcquireTime} placeholder="{{文件获取时间}}" fieldKey="documentAcquireTime" onValueChange={onValueChange} />。</p>
              <p>2.地　　点：四川省成都市双流区正兴街道红莲街三段383号四川水发集团B栋</p>
              <p>3.方　　式：邮箱发送/现场获取。</p>
              <p>4.售　　价：<PreviewValue value={draft.documentPrice} placeholder="{{采购文件售价}}" fieldKey="documentPrice" onValueChange={onValueChange} />元/份</p>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              四、{T.file}提交、开标
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>{T.file}提交截止时间、开标时间：<PreviewValue value={draft.responseSubmissionTime} placeholder="{{响应文件提交时间}}" fieldKey="responseSubmissionTime" onValueChange={onValueChange} />。</p>
              <p className="mt-2">地　　点：四川省成都市双流区正兴街道红莲街三段383号四川水发集团B栋。</p>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              五、发布公告的媒介
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              四川水发勘测设计研究有限公司官网(https://www.scswhi.com.cn/)。
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              六、监督举报
            </div>
            <div className="mt-3 space-y-2 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>监督部门：四川水发勘测设计研究有限公司纪检监察部</p>
              <p>地　　址：四川省成都市天府新区红莲街三段383号</p>
              <p>联 系 人：王先生、徐先生</p>
              <p>电　　话：028-81753276</p>
            </div>
          </div>
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              七、联系人及联系电话
            </div>
            <div className="mt-3 space-y-2 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <p>{T.buyer}：四川水发勘测设计研究有限公司</p>
              <p>地　　址：成都市天府新区红莲街三段383号</p>
              <p>联 系 人：<PreviewValue value={draft.contactName} placeholder="{{联系人}}" fieldKey="contactName" onValueChange={onValueChange} /></p>
              <p>电　　话：<PreviewValue value={draft.contactPhone} placeholder="{{联系电话}}" fieldKey="contactPhone" onValueChange={onValueChange} /></p>
              <p>邮　　箱：<PreviewValue value={draft.contactEmail} placeholder="{{联系邮箱}}" fieldKey="contactEmail" onValueChange={onValueChange} /></p>
            </div>
          </div>
        </PreviewSection>

        {/* 第二章 供应商须知 */}
        <PreviewSection
          sectionKey="supplier"
          chapterLabel="第二章"
          title={`${T.party}须知`}
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-center font-semibold text-[color:var(--foreground)]">
              {T.party}须知前附表
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse border border-[oklch(0.55_0.05_258_/_0.2)]">
                <tbody>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm w-[15%]">
                      条款号
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm w-[25%]">
                      条目
                    </td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] bg-[oklch(0.55_0.05_258_/_0.06)] px-3 py-2 text-center font-semibold text-sm">
                      内容
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">7.2</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">报价</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      最高限价：<PreviewValue value={draft.maxPrice} placeholder="{{最高限价}}" fieldKey="maxPrice" onValueChange={onValueChange} />元（含税）。超过最高限价的报价为无效报价。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">8.1</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">{T.file}保证金</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      本项目是否收取{T.file}保证金：
                      {!draft.responseDepositType ? (
                        <span className="rounded-[6px] bg-[rgba(234,188,110,0.12)] px-1 text-[rgba(178,124,42,1)]">{"{{{T.file}保证金}}"}</span>
                      ) : draft.responseDepositType === 'none' ? (
                        <span>☑不收取</span>
                      ) : (
                        <span>
                          ☐不收取
                          <br />☑收取，具体要求：
                          <br />（1）{T.file}保证金的金额：<PreviewValue value={draft.responseDepositAmount} placeholder="{{{T.file}保证金金额}}" fieldKey="responseDepositAmount" onValueChange={onValueChange} />元（小写），<PreviewValue value={draft.responseDepositAmount} placeholder="{{{T.file}保证金金额大写}}" />元（大写）。
                          <br />（2）{T.file}保证金的形式：
                          <br />{draft.responseDepositForm === 'cash' ? '☑' : '☐'}现金（电汇、银行转账、汇票、支票）
                          <br />采用现金形式的，收取{T.file}保证金的账号名称、开户银行及账号：<PreviewValue value={draft.responseDepositBankInfo} placeholder="{{账号信息}}" fieldKey="responseDepositBankInfo" onValueChange={onValueChange} />。
                          <br />{draft.responseDepositForm === 'bank_guarantee' ? '☑' : '☐'}银行保函
                          <br />{draft.responseDepositForm === 'guarantee_institution' ? '☑' : '☐'}担保机构保函
                          <br />{draft.responseDepositForm === 'insurance' ? '☑' : '☐'}保险公司保证保险
                          <br />{draft.responseDepositForm === 'other' ? '☑' : '☐'}其他：<PreviewValue value={draft.responseDepositOtherForm} placeholder="{{其他形式}}" fieldKey="responseDepositOtherForm" onValueChange={onValueChange} />
                          <br />（3）其他要求：<PreviewValue value={draft.responseDepositOtherRequirement} placeholder="{{其他要求}}" fieldKey="responseDepositOtherRequirement" onValueChange={onValueChange} />
                        </span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">9</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">{T.file}有效期</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      自{T.file}提交截止日期起算90日历天。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">12.2</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">{T.file}份数</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      纸质版正本一份，副本<PreviewValue value={draft.copyCount} placeholder="{{副本份数}}" fieldKey="copyCount" onValueChange={onValueChange} />份，1份电子文档（U盘，电子文档为{T.file}正本PDF扫描件）
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">16.1</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">确定中标人</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      最低价中标，如果两家{T.party}报价相同，且为最低价，则业绩数量丰富者中标，若业绩数量亦相同的，则由评标委员会推荐中标候选人。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">19.1</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">履约保证金</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      本项目是否收取履约保证金：
                      {!draft.performanceDepositType ? (
                        <span className="rounded-[6px] bg-[rgba(234,188,110,0.12)] px-1 text-[rgba(178,124,42,1)]">{"{{履约保证金}}"}</span>
                      ) : draft.performanceDepositType === 'none' ? (
                        <span>☑不收取</span>
                      ) : (
                        <span>
                          ☐不收取
                          <br />☑收取，具体要求：
                          <br />（1）履约保证金的金额：<PreviewValue value={draft.performanceDepositAmount} placeholder="{{履约保证金金额}}" fieldKey="performanceDepositAmount" onValueChange={onValueChange} />
                          <br />（2）履约保证金的形式：
                          <br />{draft.performanceDepositForm === 'cash' ? '☑' : '☐'}现金（电汇、银行转账、汇票、支票）
                          <br />{draft.performanceDepositForm === 'bank_guarantee' ? '☑' : '☐'}银行保函
                          <br />{draft.performanceDepositForm === 'guarantee_institution' ? '☑' : '☐'}担保机构保函
                          <br />{draft.performanceDepositForm === 'insurance' ? '☑' : '☐'}保险公司保证保险
                          <br />{draft.performanceDepositForm === 'other' ? '☑' : '☐'}其他：<PreviewValue value={draft.performanceDepositOtherForm} placeholder="{{其他形式}}" fieldKey="performanceDepositOtherForm" onValueChange={onValueChange} />
                        </span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">19.5</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">合同分包</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      本项目是否允许分包：
                      {!draft.contractSubcontractingType ? (
                        <span className="rounded-[6px] bg-[rgba(234,188,110,0.12)] px-1 text-[rgba(178,124,42,1)]">{"{{合同分包}}"}</span>
                      ) : draft.contractSubcontractingType === 'none' ? (
                        <span>☑不允许 ☐允许，具体要求：/；分包应征得{T.buyer}同意</span>
                      ) : (
                        <span>☐不允许 ☑允许，具体要求：<PreviewValue value={draft.contractSubcontracting} placeholder="{{合同分包}}" fieldKey="contractSubcontracting" onValueChange={onValueChange} />；分包应征得{T.buyer}同意</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">20.1.1</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm">询问</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      询问的送达形式：邮箱方式。
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm" colSpan={2}>是否组织现场踏勘</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      <PreviewValue value={draft.siteSurvey} placeholder="{{是否组织现场踏勘}}" fieldKey="siteSurvey" onValueChange={onValueChange} />
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-center text-sm" colSpan={2}>联系方式</td>
                    <td className="border border-[oklch(0.55_0.05_258_/_0.2)] px-3 py-2 text-sm">
                      接受询问和异议的联系方式：
                      <br />联系部门：四川水发勘测设计有限公司采购中心
                      <br />联系电话：<PreviewValue value={draft.contactPhone} placeholder="{{联系电话}}" fieldKey="contactPhone" onValueChange={onValueChange} />
                      <br />通讯地址：四川省成都市双流区正兴街道红莲街三段383号四川水发集团B栋
                      <br />电子邮箱：<PreviewValue value={draft.contactEmail} placeholder="{{联系邮箱}}" fieldKey="contactEmail" onValueChange={onValueChange} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </PreviewSection>

        {/* 第三章 评标程序和评定成交的标准 */}
        <PreviewSection
          sectionKey="evaluation"
          chapterLabel="第三章"
          title="评标程序和评定成交的标准"
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-sm leading-7 text-[color:var(--foreground)]">
              <p>1. 本项目采用的评标方法：</p>
              {!draft.evaluationMethod ? (
                <p className="ml-4 mt-2">
                  <span className="rounded-[6px] bg-[rgba(234,188,110,0.12)] px-1 text-[rgba(178,124,42,1)]">{"{{评标方法}}"}</span>
                </p>
              ) : (
                <>
                  <p className="ml-4 mt-2">
                    {draft.evaluationMethod === '综合评分法' ? '☑' : '☐'}综合评分法
                  </p>
                  <p className="ml-4 mt-1">
                    {draft.evaluationMethod === '最低评标价法' ? '☑' : '☐'}最低评标价法
                  </p>
                </>
              )}
            </div>
          </div>
        </PreviewSection>

        {/* 第四章 采购需求 */}
        <PreviewSection
          sectionKey="requirements"
          chapterLabel="第四章"
          title={isInvited ? "招标需求" : "采购需求"}
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              一、采购项目概述
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <PreviewValue
                value={draft.projectOverview}
                placeholder="{{项目概述及采购内容}}"
                multiline
                fieldKey="projectOverview"
                onValueChange={onValueChange}
              />
            </div>
          </div>
          <div className="mt-4 pt-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              二、商务要求
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <PreviewValue
                value={draft.businessRequirements}
                placeholder="{{商务要求}}"
                multiline
                fieldKey="businessRequirements"
                onValueChange={onValueChange}
              />
            </div>
          </div>
          <div className="mt-4 pt-3">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              三、技术要求
            </div>
            <div className="mt-3 pl-1 text-sm leading-7 text-[color:var(--foreground)]">
              <PreviewValue
                value={draft.technicalRequirements}
                placeholder="{{技术要求}}"
                multiline
                fieldKey="technicalRequirements"
                onValueChange={onValueChange}
              />
            </div>
          </div>
        </PreviewSection>

        {/* 第五章 响应文件格式 */}
        <PreviewSection
          sectionKey="quotation"
          chapterLabel="第五章"
          title={`${T.file}格式`}
          activeSectionKey={activeSectionKey}
          onSectionClick={onSectionClick}
        >
          <div className="tender-preview-subsection">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-foreground)]">
              6. 报价表
            </div>
            <div className="mt-3 text-sm leading-7 text-[color:var(--foreground)]">
              {draft.quotationLetterType === 'table' ? (
                (() => {
                  const draftWithTable = draft as { quotationLetterTable?: TableData };
                  const tableData = draftWithTable.quotationLetterTable;
                  if (tableData && tableData.rows > 0) {
                    return renderPreviewTable(tableData);
                  }
                  return (
                    <span className="rounded-[10px] bg-[rgba(234,188,110,0.12)] px-2 py-1 text-[rgba(178,124,42,1)] transition-all duration-200">
                      {"{{报价表}}"}
                    </span>
                  );
                })()
              ) : (
                (typeof draft.quotationLetter === 'string' && draft.quotationLetter.trim()) ? (
                  <PreviewValue
                    value={draft.quotationLetter}
                    placeholder="{{报价表}}"
                    multiline
                    fieldKey="quotationLetter"
                    onValueChange={onValueChange}
                  />
                ) : (
                  <span className="rounded-[10px] bg-[rgba(234,188,110,0.12)] px-2 py-1 text-[rgba(178,124,42,1)] transition-all duration-200">
                    {"{{报价表}}"}
                  </span>
                )
              )}
            </div>
          </div>
        </PreviewSection>
      </div>
    </div>
  );
}
