import { isDirectProcurementMethod } from '@water-erp/shared';

/**
 * 采购公告要素完整性检查（GB/T 43711—2024 7.2.2.5 / 7.2.4.5）。
 * 警告不阻断：缺失要素返回清单，由前端在发布前弹出确认，放行时在操作历史留痕。
 * 输入与 create/update 的 canonical metadata 键对齐
 * （projectCode/method/budget/scope/qualification/deadline/openTime/downloadDeadline/contact）。
 */

export interface BidNoticeChecklistInput {
  title?: string | null;
  content?: string | null;
  metadata?: Record<string, any> | null;
  relatedProjectCode?: string | null;
}

export interface ChecklistWarning {
  /** 规范要素名 */
  item: string;
  /** 对应规范条款 */
  clause: string;
  message: string;
}

export function checkBidNoticeElements(input: BidNoticeChecklistInput): ChecklistWarning[] {
  const warnings: ChecklistWarning[] = [];
  const meta = (input.metadata ?? {}) as Record<string, any>;
  const content = input.content ?? '';
  const title = input.title ?? '';

  // 1. 采购项目名称和编码（7.2.2.5）
  if (!title.trim() || !(meta.projectCode || input.relatedProjectCode)) {
    warnings.push({ item: '项目名称和编码', clause: '7.2.2.5', message: '缺少项目编号（metadata.projectCode 或 relatedProjectCode）' });
  }

  // 2. 采购交易方式（7.2.2.5）
  if (!meta.method) {
    warnings.push({ item: '采购交易方式', clause: '7.2.2.5', message: '未填写采购交易方式（metadata.method）' });
  }

  // 3. 供应商资格条件（7.2.2.5；直接采购类无投标竞争，向导有意省略，跳过）
  if (!isDirectProcurementMethod(meta.method) && !meta.qualification && !/资格|资质/.test(content)) {
    warnings.push({ item: '供应商资格条件', clause: '7.2.2.5', message: '未填写供应商资格条件（metadata.qualification）' });
  }

  // 4. 采购文件获取方法（7.2.2.5）
  if (!meta.downloadDeadline && !/获取|下载/.test(content)) {
    warnings.push({ item: '采购文件获取方法', clause: '7.2.2.5', message: '未说明采购文件获取/下载方式或时限' });
  }

  // 5. 响应文件递交截止时间（竞价采购为报价开始时间）（7.2.2.5）
  if (!meta.deadline) {
    warnings.push({ item: '递交截止时间', clause: '7.2.2.5', message: '未填写响应文件递交截止/竞价开始时间（metadata.deadline）' });
  }

  // 6. 异议渠道（7.2.2.5 / 4.1.4.1）
  if (!meta.objection && !/异议/.test(content)) {
    warnings.push({ item: '异议渠道', clause: '7.2.2.5', message: '公告未载明供应商提出异议的渠道和方式' });
  }

  // 7. 采购人签章（7.2.2.5；公告模板页脚一般含章，正文/元数据均无则提示）
  if (!/章|签章|盖章/.test(content) && !meta.contact) {
    warnings.push({ item: '采购人签名签章', clause: '7.2.2.5', message: '未检出签章或联系方式（metadata.contact）' });
  }

  // 8. 直接采购方式理由（7.2.2.3：公布选择理由及拟邀请供应商）
  if (isDirectProcurementMethod(meta.method) && !meta.directSourcingReason && !/论证|唯一|理由/.test(content)) {
    warnings.push({ item: '直接采购理由', clause: '7.2.2.3', message: '直接采购项目须公布采购方式选择理由及拟邀请供应商（metadata.directSourcingReason）' });
  }

  return warnings;
}
