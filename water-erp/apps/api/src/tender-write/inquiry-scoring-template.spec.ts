import { readFileSync } from 'fs';
import * as path from 'path';
import * as JSZip from 'jszip';
import {
  buildInquiryPurchaseReplacementPlan,
  renderTemplateXml,
  INQUIRY_PURCHASE_TEMPLATE_FILE,
} from './tender-write.template';
import { buildTenantPlaceholderReplacements } from './tenant-tokens';
import type { InquiryPurchaseAnswers, ScoringItem } from './tender-write.types';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

async function loadTemplateXml(): Promise<string> {
  const buf = readFileSync(path.resolve(PROJECT_ROOT, INQUIRY_PURCHASE_TEMPLATE_FILE));
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}

/** 剥标签取全文后提取 {{...}}（占位符经 mergeSplitPlaceholders 后均单 run，剥标签足够） */
function extractPlaceholders(xml: string): string[] {
  const text = xml.replace(/<[^>]+>/g, '');
  return [...text.matchAll(/\{\{[^}]{1,60}\}\}/g)].map((m) => m[0]);
}

/** 跨 run 定位「六、综合评分法评审标准」标题后的评分表 XML 段 */
function scoringTableRegion(xml: string): string | null {
  const pRe = /<w:p\b[\s\S]*?<\/w:p>/g;
  let m: RegExpExecArray | null;
  let headingEnd = -1;
  while ((m = pRe.exec(xml)) !== null) {
    const plain = [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((x) => x[1])
      .join('');
    if (/六、\s*综合评分法评审标准/.test(plain)) {
      headingEnd = m.index + m[0].length;
      break;
    }
  }
  if (headingEnd < 0) return null;
  const tblStart = xml.indexOf('<w:tbl', headingEnd);
  const tblEnd = xml.indexOf('</w:tbl>', tblStart);
  if (tblStart < 0 || tblEnd < 0) return null;
  return xml.substring(tblStart, tblEnd);
}

function fixture(
  overrides: Partial<InquiryPurchaseAnswers> = {},
): InquiryPurchaseAnswers {
  return {
    projectName: '测试询比项目',
    coverDate: '2026-10',
    projectOverview: '概况内容',
    procurementContent: '采购内容',
    maxPrice: '350000',
    submissionRequirements: '成果要求',
    submissionRequirementsType: 'have',
    qualificationRequirements: '特定资质要求内容',
    consortiumForm: '联合体要求',
    consortiumFormType: 'reject',
    documentAcquireTime: '2026年11月2日09:00至2026年11月5日15:00',
    documentPrice: '0',
    responseSubmissionTime: '2026年11月10日14:00',
    bidOpeningPlace: '开标室',
    contactAddress: '成都市',
    contactName: '张三',
    contactPhone: '13800000000',
    contactEmail: 'a@b.c',
    responseDepositType: 'none',
    responseDepositAmount: '',
    responseDepositForm: '',
    responseDepositBankInfo: '',
    responseDepositOtherForm: '',
    responseDepositOtherRequirement: '/',
    responseDepositNonRefundType: 'none',
    responseDepositNonRefundContent: '',
    performanceDepositType: 'collect',
    performanceDepositAmount: '50000',
    performanceDepositForm: 'bank_guarantee',
    performanceDepositOtherForm: '',
    contractSubcontracting: '',
    contractSubcontractingType: 'none',
    siteSurvey: '/',
    copyCount: '4',
    businessRequirements: '商务要求',
    technicalRequirements: '技术要求',
    quotationLetterType: 'table',
    quotationLetter: '',
    scoringItems: [],
    ...overrides,
  } as InquiryPurchaseAnswers;
}

const tenantPlan = buildTenantPlaceholderReplacements('四川水发建设有限公司', {
  department: '纪检监察部',
  address: '监督地址',
  contact: '李四',
  phone: '028-12345678',
});

const items: ScoringItem[] = [
  {
    id: 'a',
    factor: '价格部分',
    score: '30',
    criteria: '报价得分=（评审基准价/评审报价）×30\n四舍五入保留两位小数',
    note: '/',
  },
  {
    id: 'b',
    factor: '技术部分',
    score: '40',
    criteria: '技术参数完全响应得满分\n一般偏离一项扣2分',
    note: '/',
  },
  {
    id: 'c',
    factor: '商务部分',
    score: '30',
    criteria: '业绩每一项得5分',
    note: '以合同复印件为准',
  },
];

describe('询比采购文件模板 v2（综合评分法评审标准）', () => {
  it('畸形评分行不抛异常（DTO answers 内部字段零校验的防御约定）', () => {
    expect(() =>
      buildInquiryPurchaseReplacementPlan(
        fixture({
          scoringItems: [
            { factor: '价格' } as ScoringItem,
            'not-an-object' as unknown as ScoringItem,
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('后端闸门：询比空评分行导出 400 SCORING_NOT_FILLED（审查流/API 直调兜底）', async () => {
    const { TenderWriteService } = await import('./tender-write.service');
    const svc = new TenderWriteService(
      {} as never,
      {} as never,
      { user: { findUnique: async () => null } } as never,
    );
    await expect(
      svc.exportDocument({
        documentType: 'INQUIRY_PURCHASE',
        answers: fixture({ scoringItems: [] }),
      } as never),
    ).rejects.toMatchObject({ status: 400, response: { code: 'SCORING_NOT_FILLED' } });
  });

  it('占位符全覆盖：替换计划+租户替换后零残留', async () => {
    const xml = await loadTemplateXml();
    const rendered = renderTemplateXml(xml, [
      ...buildInquiryPurchaseReplacementPlan(fixture()),
      ...tenantPlan,
    ]);
    expect(extractPlaceholders(rendered)).toEqual([]);
  });

  it('注入评分行：3 行数据+合计 100，空模板行被替换', async () => {
    const xml = await loadTemplateXml();
    const rendered = renderTemplateXml(xml, [
      ...buildInquiryPurchaseReplacementPlan(fixture({ scoringItems: items })),
      ...tenantPlan,
    ]);
    const region = scoringTableRegion(rendered);
    if (!region) throw new Error('scoring table region not found');
    const trCount = (region.match(/<w:tr[ >]/g) ?? []).length;
    expect(trCount).toBe(5); // 表头 + 3 数据行 + 合计
    const text = region.replace(/<[^>]+>/g, '');
    for (const expected of [
      '价格部分',
      '技术部分',
      '商务部分',
      '评审基准价',
      '以合同复印件为准',
      '合计',
      '100',
    ]) {
      expect(text).toContain(expected);
    }
    // 多行评分标准 → <w:br/> 断行存在
    expect(region).toContain('<w:br/>');
  });

  it('空评分行不注入：表格结构原样（宽容兜底）', async () => {
    const xml = await loadTemplateXml();
    const rendered = renderTemplateXml(xml, [
      ...buildInquiryPurchaseReplacementPlan(fixture({ scoringItems: [] })),
      ...tenantPlan,
    ]);
    const region = scoringTableRegion(rendered);
    if (!region) throw new Error('scoring table region not found');
    const trCount = (region.match(/<w:tr[ >]/g) ?? []).length;
    expect(trCount).toBe(5); // 模板原样：表头+3空行+合计
    expect(region.replace(/<[^>]+>/g, '')).not.toContain('价格部分');
  });
});
