import { readFileSync } from 'fs';
import * as path from 'path';
import * as JSZip from 'jszip';
import {
  PUBLIC_BIDDING_TEMPLATE_FILE,
  PUBLIC_BIDDING_ANNOUNCEMENT_TEMPLATE_FILE,
  buildInternalBiddingReplacementPlan,
  buildInvitedBiddingAnnouncementPlan,
  buildCoverProjectCodeReplacements,
  renderTemplateXml,
} from './tender-write.template';
import { buildTenantPlaceholderReplacements } from './tenant-tokens';
import type { InternalBiddingAnswers } from './tender-write.types';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** 公开招标两模板（2026-11-20）：克隆自邀请招标版、招标人口吻；占位符集合与邀请招标
 *  完全一致（替换计划引擎零改动复用）——本 spec 锁三件事：占位符全覆盖、口吻改写、
 *  服务分发（PUBLIC_BIDDING 采购公告走公开招标公告模板）。 */

async function loadTemplateXml(file: string): Promise<string> {
  const buf = readFileSync(path.resolve(PROJECT_ROOT, file));
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}

/** 剥标签取全文后提取 {{...}}（占位符经 mergeSplitPlaceholders 后均单 run，剥标签足够） */
function extractPlaceholders(xml: string): string[] {
  const text = xml.replace(/<[^>]+>/g, '');
  return [...text.matchAll(/\{\{[^}]{1,60}\}\}/g)].map((m) => m[0]);
}

function templateText(xml: string): string {
  return xml.replace(/<[^>]+>/g, '');
}

/** 邀请招标同款问卷满填夹具（buildInternalBiddingReplacementPlan 消费） */
function internalFixture(): InternalBiddingAnswers {
  return {
    projectName: '公开招标测试项目',
    coverDate: '2026-11',
    projectOverview: '项目概况内容',
    procurementContent: '招标内容',
    maxPrice: '1000元',
    qualificationRequirements: '特定资质要求',
    consortiumForm: '',
    consortiumFormType: 'reject',
    documentPrice: '0元',
    responseSubmissionTime: '2026-11-25',
    contactName: '张三',
    contactPhone: '13800000000',
    contactEmail: 'test@example.com',
    responseDepositType: 'none',
    responseDepositAmount: '',
    responseDepositForm: 'cash',
    responseDepositBankInfo: '',
    responseDepositOtherForm: '',
    responseDepositOtherRequirement: '',
    responseDepositOtherRequirementType: 'none',
    responseDepositNonRefundType: 'none',
    responseDepositNonRefundContent: '',
    performanceDepositType: 'none',
    performanceDepositAmount: '',
    performanceDepositForm: 'cash',
    performanceDepositOtherForm: '',
    evaluationMethod: '综合评分法',
    contractSubcontracting: '',
    contractSubcontractingType: 'none',
    siteSurvey: '',
    siteSurveyType: 'none',
    copyCount: '1',
    evaluationCommitteeCount: '5',
    businessRequirements: '商务要求',
    technicalRequirements: '技术要求',
    submissionRequirements: '',
    submissionRequirementsType: 'none',
    quotationLetterType: 'text',
    quotationLetter: '',
  } as InternalBiddingAnswers;
}

function announcementFixture(): Record<string, string> {
  return {
    projectName: '公开招标公告测试项目',
    projectOverview: '招标内容概述',
    maxPriceChinese: '壹万元',
    maxPriceNumeric: '10000',
    registrationMethod: '在供应商门户注册后报名',
    announcementStart: '2026年11月20日',
    announcementEnd: '2026年11月27日',
    bidOpeningTime: '2026年12月10日',
    openingLocation: '开标室',
    contactName: '张三',
    contactPhone: '13800000000',
    contactEmail: 'test@example.com',
    signatureDate: '2026年11月20日',
  };
}

describe('公开招标模板（克隆邀请招标·招标人口吻）', () => {
  it('文件模板：邀请招标替换计划+租户替换+封面编号后零占位符残留', async () => {
    const xml = await loadTemplateXml(PUBLIC_BIDDING_TEMPLATE_FILE);
    const rendered = renderTemplateXml(xml, [
      ...buildInternalBiddingReplacementPlan(internalFixture()),
      ...buildTenantPlaceholderReplacements('四川水发建设有限公司', {
        department: '监督部',
        address: '成都市',
        contact: '李四',
        phone: '13900000000',
      }),
      ...buildCoverProjectCodeReplacements('SW-GK-2026112001'),
    ]);
    expect(extractPlaceholders(rendered)).toEqual([]);
  });

  it('公告模板：邀请招标公告替换计划+租户替换后零占位符残留', async () => {
    const xml = await loadTemplateXml(PUBLIC_BIDDING_ANNOUNCEMENT_TEMPLATE_FILE);
    const rendered = renderTemplateXml(xml, [
      ...buildInvitedBiddingAnnouncementPlan(announcementFixture()),
      ...buildTenantPlaceholderReplacements('四川水发建设有限公司', {
        department: '监督部',
        address: '成都市',
        contact: '李四',
        phone: '13900000000',
      }),
    ]);
    expect(extractPlaceholders(rendered)).toEqual([]);
  });

  it('招标人口吻：公告模板已改写（招标公告/公开招标方式/招标人），无邀请招标与采购人残留', async () => {
    const text = templateText(await loadTemplateXml(PUBLIC_BIDDING_ANNOUNCEMENT_TEMPLATE_FILE));
    expect(text).toContain('招标公告');
    expect(text).toContain('采用公开招标方式对');
    expect(text).toContain('进行招标，现公告如下');
    expect(text).toContain('招 标 人');
    expect(text).not.toContain('邀请招标');
    expect(text).not.toMatch(/采\s*购\s*人(?!名称)/);
  });

  it('文件模板口吻：封面「招标文件」、第一章「招标公告」、免责声明公开招标口径', async () => {
    const text = templateText(await loadTemplateXml(PUBLIC_BIDDING_TEMPLATE_FILE));
    expect(text).toContain('招标文件{{采购人名称}}');
    expect(text).toContain('第一章  招标公告');
    expect(text).toContain('采用公开招标方式进行招标');
    expect(text).toContain('并非《招标投标法》层面的公开招标');
    expect(text).not.toContain('邀请招标');
  });

  it('服务分发：PUBLIC_BIDDING 采购公告导出走公开招标公告模板（不被 INVITED_NO_PROCUREMENT_NOTICE 拦）', async () => {
    const { TenderWriteService } = await import('./tender-write.service');
    const svc = new TenderWriteService(
      {} as never,
      {} as never,
      { user: { findUnique: async () => null } } as never,
    );
    const r = await svc.exportAnnouncement({
      tenderType: 'PUBLIC_BIDDING',
      category: 'procurement_document',
      draft: announcementFixture(),
      projectCode: 'SW-GK-2026112001',
    } as never);
    expect(r.fileName).toContain('招标公告');
    const text = templateText(
      (await JSZip.loadAsync(r.buffer).then((z) => z.file('word/document.xml')!.async('string'))),
    );
    expect(text).toContain('采用公开招标方式对');
    expect(extractPlaceholders(text)).toEqual([]);
  });

  it('服务分发：PUBLIC_BIDDING 文件导出走公开招标文件模板、名称「招标文件」', async () => {
    const { TenderWriteService } = await import('./tender-write.service');
    const svc = new TenderWriteService(
      {} as never,
      {} as never,
      { user: { findUnique: async () => null } } as never,
    );
    const r = await svc.exportDocument({
      documentType: 'PUBLIC_BIDDING',
      answers: internalFixture() as unknown as Record<string, unknown>,
      projectCode: 'SW-GK-2026112001',
    } as never);
    expect(r.fileName).toContain('招标文件');
    expect(extractPlaceholders(
      templateText(await JSZip.loadAsync(r.buffer).then((z) => z.file('word/document.xml')!.async('string'))),
    )).toEqual([]);
  });
});
