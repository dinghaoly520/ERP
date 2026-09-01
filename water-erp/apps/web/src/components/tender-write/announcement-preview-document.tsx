import { useLayoutEffect, useRef, useState } from "react";
import type {
  AnnouncementCategory,
  InvitedBiddingAnnouncementDraft,
  SingleSourceAnnouncementDraft,
  FailedBidAnnouncementDraft,
  WinningBidAnnouncementDraft,
  AnnouncementDraft,
  AnnouncementFieldKey,
} from "../../lib/types/announcement";
import type { TenderDocumentType } from "../../lib/types/tender-write";

const CHINESE_NUMBERS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const CHINESE_TENS = ["", "十", "二十", "三十"];

function numberToChinese(num: number): string {
  if (num < 10) return CHINESE_NUMBERS[num];
  const tens = Math.floor(num / 10);
  const ones = num % 10;
  if (ones === 0) return CHINESE_TENS[tens];
  return CHINESE_TENS[tens] + CHINESE_NUMBERS[ones];
}

function formatDateToChinese(dateString: string): string {
  if (!dateString?.trim()) return dateString;

  if (/^\d{4}-\d{2}$/.test(dateString)) {
    const [yearStr, monthStr] = dateString.split("-");
    const month = parseInt(monthStr, 10);
    return `${yearStr}年${month}月`;
  }

  // Handle datetime-local format: "2026-05-05T10:30" → "2026年5月5日10:30"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dateString)) {
    const [datePart, timePart] = dateString.split("T");
    const [yearStr, monthStr, dayStr] = datePart.split("-");
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    return `${yearStr}年${month}月${day}日${timePart}`;
  }

  let date: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    date = new Date(dateString);
  } else if (/^\d{4}\.\d{2}\.\d{2}$/.test(dateString)) {
    const parts = dateString.split(".");
    date = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
  } else if (/^\d{4}年\d{1,2}月\d{1,2}日/.test(dateString)) {
    return dateString;
  } else {
    date = new Date(dateString);
  }

  if (isNaN(date.getTime())) return dateString;

  const yearStr = date.getFullYear().toString();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${yearStr}年${month}月${day}日`;
}

function formatMultilineText(text: string): string {
  if (!text || !text.trim()) return text;
  let result = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  result = result.replace(/(\(\d+\))/g, '\n$1');
  result = result.replace(/(\d+\.\s)/g, '\n$1');
  result = result.replace(/([①②③④⑤⑥⑦⑧⑨⑩]+)/g, '\n  $1');
  result = result.replace(/^\n/, '');
  result = result.replace(/\n+/g, '\n');
  return result.trim();
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
  fieldKey?: AnnouncementFieldKey;
  onValueChange?: (fieldKey: AnnouncementFieldKey, value: string) => void;
}) {
  const isEmpty = typeof value !== "string" || !value.trim();
  const elementRef = useRef<HTMLSpanElement | null>(null);
  const isComposingRef = useRef(false);
  const isFocusedRef = useRef(false);
  const [frozen, setFrozen] = useState<string | null>(null);

  const displayValue = multiline ? formatMultilineText(value) : value;
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
        id={`announcement-preview-field-${fieldKey}`}
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
        className={`tender-preview-editable outline-none rounded-[4px] px-1 -mx-1 hover:bg-[rgba(96,139,239,0.08)] focus:bg-[rgba(96,139,239,0.12)] transition-colors cursor-text ${multiline ? 'whitespace-pre-wrap block' : ''} ${isEmpty && frozen === null ? 'tender-preview-placeholder min-w-[4rem] inline-block' : 'text-blue-600'}`}
      >
        {shouldRenderChildren ? childrenText : null}
      </span>
    );
  }

  if (isEmpty) {
    return (
      <span
        id={fieldKey ? `announcement-preview-field-${fieldKey}` : undefined}
        className="tender-preview-placeholder rounded-[10px] px-2 py-1 transition-all duration-200"
      >
        {placeholder}
      </span>
    );
  }

  return (
    <span
      id={fieldKey ? `announcement-preview-field-${fieldKey}` : undefined}
      className={`text-blue-600 ${multiline ? "whitespace-pre-wrap" : ""}`}
    >
      {displayValue}
    </span>
  );
}

// ─── 邀请招标/竞价采购公告预览 ───

function InvitedOrInternalBiddingAnnouncementPreview({
  draft,
  tenderType,
  onValueChange,
}: {
  draft: InvitedBiddingAnnouncementDraft;
  tenderType: TenderDocumentType;
  onValueChange?: (fieldKey: AnnouncementFieldKey, value: string) => void;
}) {
  const PV = (value: string, placeholder: string, fieldKey: AnnouncementFieldKey, multiline = false) => (
    <PreviewValue value={value} placeholder={placeholder} fieldKey={fieldKey} multiline={multiline} onValueChange={onValueChange} />
  );

  const docLabel =
    tenderType === "INQUIRY_PURCHASE"
      ? "询比采购公告"
      : tenderType === "INVITED_BIDDING"
        ? "邀请招标公告"
        : "竞价采购公告";

  return (
    <div className="mx-auto max-w-[72ch] space-y-5">
      {/* 标题 */}
      <div className="text-center">
        <div className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
          {PV(draft.projectName, "{{项目名称}}", "projectName")}采购
        </div>
        <div className="mt-2 text-lg font-semibold tracking-[0.06em] text-[rgba(80,102,146,0.92)]">
          {docLabel}
        </div>
      </div>

      <div className="text-[0.92rem] leading-8 text-[color:var(--foreground)]">
        <p className="indent-8">
          四川水发勘测设计研究有限公司采用
          {tenderType === "INQUIRY_PURCHASE"
            ? "询比采购"
            : tenderType === "INVITED_BIDDING"
              ? "邀请招标"
              : "竞价采购"}
          方式对
          {PV(draft.projectName, "{{项目名称}}", "projectName")}进行采购，现公示如下：
        </p>
      </div>

      {/* 一、项目信息 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          一、项目信息
        </div>
        <div className="mt-2 space-y-1 text-[0.92rem] leading-8">
          <p>采 购 人：四川水发勘测设计研究有限公司</p>
          <p>
            项目名称：{PV(draft.projectName, "{{项目名称}}", "projectName")}采购
          </p>
        </div>
      </div>

      {/* 二、采购的货物或者服务的要求 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          二、采购的货物或者服务的要求
        </div>
        <div className="mt-2 space-y-1 text-[0.92rem] leading-8">
          <p>
            1、采购内容包括：{PV(draft.projectOverview, "{{项目概况和采购内容}}", "projectOverview", true)}
          </p>
          <p>
            2、最高限价：人民币
            {PV(draft.maxPriceChinese, "{{最高限价（大写）}}", "maxPriceChinese")}整（¥
            {PV(draft.maxPriceNumeric, "{{最高限价（小写）}}", "maxPriceNumeric")}）（含税价）。
          </p>
          {(draft as Record<string, string>).scheduleRequirementsType === "have" && (
            <p>
              3、工期及进度要求：{PV(draft.scheduleRequirements, "{{工期及进度要求}}", "scheduleRequirements", true)}
            </p>
          )}
        </div>
      </div>

      {/* 三、报名方式及条件 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          三、报名方式及条件
        </div>
        <div className="mt-2 text-[0.92rem] leading-8">
          {PV(draft.registrationMethod, "{{报名方式及条件}}", "registrationMethod", true)}
        </div>
      </div>

      {/* 四、公示期限 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          四、公示期限
        </div>
        <div className="mt-2 text-[0.92rem] leading-8">
          本公告有效期从
          {PV(formatDateToChinese(draft.announcementStart), "{{公示期限（起）}}", "announcementStart")}至
          {PV(formatDateToChinese(draft.announcementEnd), "{{公示期限（止）}}", "announcementEnd")}。
        </div>
      </div>

      {/* 五、开标时间及地点 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          五、开标时间及地点
        </div>
        <div className="mt-2 space-y-1 text-[0.92rem] leading-8">
          <p>
            开标时间：{PV(formatDateToChinese(draft.bidOpeningTime), "{{开标时间}}", "bidOpeningTime")}。
          </p>
          <p>开标地点：四川省成都市双流区红莲街三段383号四川省水利发展集团有限公司B座采购中心</p>
        </div>
      </div>

      {/* 六、联系方式 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          六、联系方式
        </div>
        <div className="mt-2 space-y-1 text-[0.92rem] leading-8">
          <p>采购人：四川水发勘测设计研究有限公司</p>
          <p>联系人：{PV(draft.contactName, "{{联系人}}", "contactName")}</p>
          <p>联系电话：{PV(draft.contactPhone, "{{联系电话}}", "contactPhone")}</p>
          <p>电子邮箱：{PV(draft.contactEmail, "{{联系邮箱}}", "contactEmail")}</p>
        </div>
      </div>

      {/* 七、监督举报 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          七、监督举报
        </div>
        <div className="mt-2 space-y-1 text-[0.92rem] leading-8">
          <p>监督部门：四川水发勘测设计研究有限公司纪检监察部</p>
          <p>地址：四川省成都市双流区红莲街三段383号四川省水利发展集团有限公司B座9楼</p>
          <p>联系人：王先生、徐先生</p>
          <p>监督电话：028-81753276</p>
        </div>
      </div>

      {/* 落款 */}
      <div className="flex justify-between pt-4 text-[0.92rem] leading-8">
        <div>四川水发勘测设计研究有限公司</div>
        <div>{PV(formatDateToChinese(draft.signatureDate), "{{落款日期}}", "signatureDate")}</div>
      </div>
    </div>
  );
}

// ─── 直接采购公告预览 ───

function SingleSourceAnnouncementPreview({
  draft,
  onValueChange,
}: {
  draft: SingleSourceAnnouncementDraft;
  onValueChange?: (fieldKey: AnnouncementFieldKey, value: string) => void;
}) {
  const PV = (value: string, placeholder: string, fieldKey: AnnouncementFieldKey, multiline = false) => (
    <PreviewValue value={value} placeholder={placeholder} fieldKey={fieldKey} multiline={multiline} onValueChange={onValueChange} />
  );

  return (
    <div className="mx-auto max-w-[72ch] space-y-5">
      {/* 标题 */}
      <div className="text-center">
        <div className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
          {PV(draft.projectName, "{{项目名称}}", "projectName")}直接采购公告
        </div>
      </div>

      {/* 一、项目信息 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          一、项目信息
        </div>
        <div className="mt-2 space-y-1 text-[0.92rem] leading-8">
          <p>采购人： 四川水发勘测设计研究有限公司</p>
          <p>项目名称：{PV(draft.projectName, "{{项目名称}}", "projectName")}</p>
        </div>
      </div>

      {/* 二、项目概况 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          二、项目概况
        </div>
        <div className="mt-2 space-y-1 text-[0.92rem] leading-8">
          <p>{PV(draft.projectOverview, "{{项目概况和采购内容}}", "projectOverview", true)}</p>
          <p>
            拟采购货物预算金额：人民币
            {PV(draft.maxPriceChinese, "{{预算金额（大写）}}", "maxPriceChinese")}整（¥
            {PV(draft.maxPriceNumeric, "{{预算金额（小写）}}", "maxPriceNumeric")}）（含税价）。
          </p>
        </div>
      </div>

      {/* 三、论证意见 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          三、论证意见
        </div>
        <div className="mt-2 text-[0.92rem] leading-8">
          {PV(draft.argumentOpinion, "{{论证意见}}", "argumentOpinion", true)}
        </div>
      </div>

      {/* 四、拟定供应商信息 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          四、拟定供应商信息
        </div>
        <div className="mt-2 space-y-1 text-[0.92rem] leading-8">
          <p>拟定供应商名称：{PV(draft.supplierName, "{{供应商名称}}", "supplierName")}</p>
          <p>拟定供应商地址：{PV(draft.supplierAddress, "{{供应商地址}}", "supplierAddress")}</p>
        </div>
      </div>

      {/* 五、公示期限 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          五、公示期限
        </div>
        <div className="mt-2 text-[0.92rem] leading-8">
          {PV(formatDateToChinese(draft.announcementStart), "{{公示期限（起）}}", "announcementStart")}至
          {PV(formatDateToChinese(draft.announcementEnd), "{{公示期限（止）}}", "announcementEnd")}（
          {PV(draft.announcementDays, "{{天数}}", "announcementDays")}个工作日）任何供应商、单位或个人对采用单一来源采购方式公示有异议的，请于公示期间以书面形式向采购人反映。
        </div>
      </div>

      {/* 六、采购时间及地点 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          六、采购时间及地点
        </div>
        <div className="mt-2 space-y-1 text-[0.92rem] leading-8">
          <p>
            采购时间：{PV(formatDateToChinese(draft.procurementTime), "{{采购时间}}", "procurementTime")}
          </p>
          <p>采购地点：四川省成都市双流区红莲街三段383号四川省水利发展集团有限公司B座3楼采购中心</p>
        </div>
      </div>

      {/* 七、监督举报 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[rgba(95,126,188,0.7)]">
          七、监督举报
        </div>
        <div className="mt-2 space-y-1 text-[0.92rem] leading-8">
          <p>四川水发勘测设计研究有限公司纪检监察部</p>
          <p>地址：四川省成都市双流区红莲街三段383号四川省水利发展集团有限公司B座9楼</p>
          <p>联系人：王先生</p>
          <p>监督电话：028-81753276</p>
        </div>
      </div>

      {/* 落款 */}
      <div className="flex justify-between pt-4 text-[0.92rem] leading-8">
        <div>四川水发勘测设计研究有限公司</div>
        <div>{PV(formatDateToChinese(draft.signatureDate), "{{落款日期}}", "signatureDate")}</div>
      </div>
    </div>
  );
}

// ─── 流标公告预览 ───

function FailedBidAnnouncementPreview({
  draft,
  onValueChange,
}: {
  draft: FailedBidAnnouncementDraft;
  onValueChange?: (fieldKey: AnnouncementFieldKey, value: string) => void;
}) {
  const PV = (value: string, placeholder: string, fieldKey: AnnouncementFieldKey, multiline = false) => (
    <PreviewValue value={value} placeholder={placeholder} fieldKey={fieldKey} multiline={multiline} onValueChange={onValueChange} />
  );

  return (
    <div className="mx-auto max-w-[72ch] space-y-5">
      {/* 标题 */}
      <div className="text-center">
        <div className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
          {PV(draft.projectName, "{{项目名称}}", "projectName")}流标公示
        </div>
      </div>

      <div className="space-y-4 text-[0.92rem] leading-8">
        {/* 一 */}
        <p>
          一、项目名称：{PV(draft.projectName, "{{项目名称}}", "projectName")}
        </p>

        {/* 二 */}
        <div>
          <p>二、项目简要说明：</p>
          <p>{PV(draft.projectBriefDescription, "{{项目简要说明}}", "projectBriefDescription", true)}</p>
        </div>

        {/* 三 */}
        <div>
          <p>
            三、开标时间：{PV(formatDateToChinese(draft.bidOpeningTime), "{{开标时间}}", "bidOpeningTime")}
          </p>
          <p>
            {"    "}开标地点：四川省成都市双流区红莲街三段383号四川省水利发展集团有限公司B座3楼采购中心
          </p>
        </div>

        {/* 四 */}
        <div>
          <p>四、开标结果公示信息</p>
          <p>{PV(draft.resultInfo, "{{开标结果公示信息}}", "resultInfo", true)}</p>
        </div>

        {/* 五 */}
        <p>五、公示期限：1日</p>

        {/* 六 */}
        <div>
          <p>六、监督举报</p>
          <p>四川水发勘测设计研究有限公司纪检监察部</p>
          <p>地址：四川省成都市双流区红莲街三段383号四川省水利发展集团有限公司B座9楼</p>
          <p>联系人：王先生、徐先生</p>
          <p>监督电话：028-81753276</p>
        </div>
      </div>

      {/* 落款 */}
      <div className="flex justify-between pt-4 text-[0.92rem] leading-8">
        <div>四川水发勘测设计研究有限公司</div>
        <div>{PV(formatDateToChinese(draft.signatureDate), "{{落款日期}}", "signatureDate")}</div>
      </div>
    </div>
  );
}

// ─── 中标公告预览 ───

function WinningBidAnnouncementPreview({
  draft,
  onValueChange,
}: {
  draft: WinningBidAnnouncementDraft;
  onValueChange?: (fieldKey: AnnouncementFieldKey, value: string) => void;
}) {
  const PV = (value: string, placeholder: string, fieldKey: AnnouncementFieldKey, multiline = false) => (
    <PreviewValue value={value} placeholder={placeholder} fieldKey={fieldKey} multiline={multiline} onValueChange={onValueChange} />
  );

  // Build dynamic bidder rows from draft
  const rankLabels = ["第一名", "第二名", "第三名", "第四名", "第五名", "第六名", "第七名", "第八名", "第九名", "第十名"];
  const bidderRows: Array<{ name: string; price: string; label: string }> = [];
  const draftAny = draft as Record<string, string>;
  for (let i = 1; i <= 20; i++) {
    const name = draftAny[`bidder${i}Name`] ?? "";
    const price = draftAny[`bidder${i}Price`] ?? "";
    if (name.trim() || price.trim()) {
      bidderRows.push({ name, price, label: rankLabels[i - 1] ?? `第${i}名` });
    }
  }

  const hasBidders = bidderRows.length > 0;
  const remark = (draft as Record<string, string>).bidder1Remark ?? "";

  return (
    <div className="mx-auto max-w-[72ch] space-y-5">
      {/* 标题 */}
      <div className="text-center">
        <div className="text-xl font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
          {PV(draft.projectName, "{{项目名称}}", "projectName")}采购
        </div>
        <div className="mt-2 text-lg font-semibold tracking-[0.06em] text-[rgba(80,102,146,0.92)]">
          中标公告
        </div>
      </div>

      <div className="space-y-4 text-[0.92rem] leading-8">
        {/* 一 */}
        <p>
          一、项目名称：{PV(draft.projectName, "{{项目名称}}", "projectName")}
        </p>

        {/* 二 */}
        <div>
          <p>二、项目简要说明：</p>
          <p>{PV(draft.projectBriefDescription, "{{项目简要说明}}", "projectBriefDescription", true)}</p>
        </div>

        {/* 三 */}
        <p>
          三、采购限价：
          <br />
          最高限价人民币{PV((draft as Record<string, string>).maxPriceChinese ?? "", "{{最高限价（大写）}}", "maxPriceChinese" as AnnouncementFieldKey)}（¥
          {PV(draft.maxPrice, "{{最高限价（小写）}}", "maxPrice")}）（含税价）。
        </p>

        {/* 四 */}
        <div>
          <p>
            四、开标时间：{PV(formatDateToChinese(draft.bidOpeningTime), "{{开标时间}}", "bidOpeningTime")}
          </p>
          <p>开标地点：四川省成都市双流区红莲街三段383号四川省水利发展集团有限公司B座3楼采购中心</p>
        </div>

        {/* 五、中标候选人 */}
        <div>
          <p>五、中标候选人公示信息</p>
          <p>
            {PV(draft.projectName, "{{项目名称}}", "projectName")}按规定招标流程进行了开标、评标、定标，现将本次项目的中标结果公告如下：
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse border border-[rgba(200,210,230,0.6)]">
              <thead>
                <tr className="bg-[rgba(240,245,255,0.5)]">
                  <th className="border border-[rgba(200,210,230,0.6)] px-3 py-2 text-center text-sm">
                    中标候选人排序
                  </th>
                  <th className="border border-[rgba(200,210,230,0.6)] px-3 py-2 text-center text-sm">
                    中标候选人名称
                  </th>
                  <th className="border border-[rgba(200,210,230,0.6)] px-3 py-2 text-center text-sm">
                    投标人报价（元）
                  </th>
                  <th className="border border-[rgba(200,210,230,0.6)] px-3 py-2 text-center text-sm">
                    备注
                  </th>
                </tr>
              </thead>
              <tbody>
                {(hasBidders ? bidderRows : [
                  { name: "", price: "", label: "第一名" },
                  { name: "", price: "", label: "第二名" },
                  { name: "", price: "", label: "第三名" },
                ]).map((bidder, idx, arr) => (
                  <tr key={bidder.label}>
                    <td className="border border-[rgba(200,210,230,0.6)] px-3 py-2 text-center text-sm">
                      {bidder.label}
                    </td>
                    <td className="border border-[rgba(200,210,230,0.6)] px-3 py-2 text-center text-sm">
                      {PV(
                        bidder.name,
                        `{{投标单位${idx + 1}}}`,
                        `bidder${idx + 1}Name` as AnnouncementFieldKey,
                      )}
                    </td>
                    <td className="border border-[rgba(200,210,230,0.6)] px-3 py-2 text-center text-sm">
                      {PV(
                        bidder.price,
                        `{{报价${idx + 1}}}`,
                        `bidder${idx + 1}Price` as AnnouncementFieldKey,
                      )}
                    </td>
                    {/* Merged remark cell — only render on first row */}
                    {idx === 0 && (
                      <td
                        className="border border-[rgba(200,210,230,0.6)] px-3 py-2 text-center text-sm align-middle"
                        rowSpan={arr.length}
                      >
                        {PV(remark, "{{备注}}", "bidder1Remark")}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 六、中标结果 */}
        {hasBidders && draft.bidder1Name.trim() && (
          <div className="mt-4">
            <p>六、中标结果公示信息</p>
            <p>现将本次项目的中标结果公示如下：</p>
            <p>
              {PV(draft.projectName, "{{项目名称}}", "projectName")}的中标单位为
              {draft.bidder1Name}，中标金额为人民币
              {draft.bidder1Price}（¥{draft.bidder1Price}）（含税价）。
            </p>
          </div>
        )}

        {/* 七 */}
        <p>七、中标候选人公示期限：1日</p>

        {/* 八 */}
        <div>
          <p>八、监督举报</p>
          <p>四川水发勘测设计研究有限公司</p>
          <p>地址：成都市天府新区红莲街383号B栋9楼</p>
          <p>联系人：王先生、徐先生</p>
          <p>监督电话：028-81753276</p>
        </div>
      </div>

      {/* 落款 */}
      <div className="flex justify-between pt-4 text-[0.92rem] leading-8">
        <div>四川水发勘测设计研究有限公司</div>
        <div>{PV(formatDateToChinese(draft.signatureDate), "{{落款日期}}", "signatureDate")}</div>
      </div>
    </div>
  );
}

// ─── 主入口 ───

export function AnnouncementPreviewDocument({
  tenderType,
  category,
  draft,
  onValueChange,
}: {
  tenderType: TenderDocumentType;
  category: AnnouncementCategory;
  draft: AnnouncementDraft;
  onValueChange?: (fieldKey: AnnouncementFieldKey, value: string) => void;
}) {
  if (category === "procurement_document") {
    if (tenderType === "SINGLE_SOURCE") {
      return (
        <SingleSourceAnnouncementPreview
          draft={draft as SingleSourceAnnouncementDraft}
          onValueChange={onValueChange}
        />
      );
    }
    return (
      <InvitedOrInternalBiddingAnnouncementPreview
        draft={draft as InvitedBiddingAnnouncementDraft}
        tenderType={tenderType}
        onValueChange={onValueChange}
      />
    );
  }

  if (category === "failed_bid") {
    return (
      <FailedBidAnnouncementPreview
        draft={draft as FailedBidAnnouncementDraft}
        onValueChange={onValueChange}
      />
    );
  }

  if (category === "winning_bid") {
    return (
      <WinningBidAnnouncementPreview
        draft={draft as WinningBidAnnouncementDraft}
        onValueChange={onValueChange}
      />
    );
  }

  return null;
}
