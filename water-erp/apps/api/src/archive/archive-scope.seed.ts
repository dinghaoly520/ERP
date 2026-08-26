import { PrismaService } from '../prisma/prisma.service';

/**
 * DA/T 103-2024 附录 B「招标投标电子文件归档范围参考表」全量种子（35 项）。
 * 三源映射：
 *  - attachment：PMI 阶段附件（实际类型均为 SUPPORTING_MATERIAL，语义靠 stageKeys 承载）
 *  - fileAsset：开评标回流件（FileAsset.category，经 BidProject 关联定位）
 *  - manual：人工补传（归档质检页补传到对应阶段，SUPPORTING_MATERIAL）
 *  - generated：系统生成（导出时自动产出，如审批留痕）
 * isRequired=true 仅对「系统内可闭环判定」的项设置（闸门/检测阻断）；
 * 外部来源项（资格预审/保证金/投诉等）标 false，缺件提示不阻断。
 */
export const ARCHIVE_SCOPE_SEED: Array<{
  code: string;
  stage: string;
  materialName: string;
  sourceType: 'attachment' | 'fileAsset' | 'manual' | 'generated';
  attachmentTypes?: string[];
  stageKeys?: string[];
  fileCategories?: string[];
  isRequired?: boolean;
  keepByTenderer?: boolean;
  keepByBidder?: boolean;
  keepByAgency?: boolean;
}> = [
  // ── 1 策划阶段 ──
  { code: '1.1', stage: '策划', materialName: '招标方案', sourceType: 'manual', stageKeys: ['INITIATION'] },
  { code: '1.2', stage: '策划', materialName: '招标项目信息', sourceType: 'generated', stageKeys: ['INITIATION'], isRequired: true, keepByAgency: true },
  { code: '1.3', stage: '策划', materialName: '招标代理合同', sourceType: 'manual', stageKeys: ['INITIATION'] },
  // ── 2 招标阶段 ──
  { code: '2.1', stage: '招标', materialName: '招标公告', sourceType: 'attachment', stageKeys: ['PUBLIC_ANNOUNCEMENT'], isRequired: true, keepByAgency: true },
  { code: '2.2', stage: '招标', materialName: '资格预审公告', sourceType: 'manual', stageKeys: ['PUBLIC_ANNOUNCEMENT'] },
  { code: '2.3', stage: '招标', materialName: '投标邀请书', sourceType: 'attachment', stageKeys: ['SUPPLIER_INVITATION'], keepByBidder: true, keepByAgency: true },
  { code: '2.4', stage: '招标', materialName: '招标文件', sourceType: 'attachment', stageKeys: ['TENDER_DOCUMENT'], isRequired: true, keepByBidder: true, keepByAgency: true },
  { code: '2.5', stage: '招标', materialName: '资格预审文件', sourceType: 'manual', stageKeys: ['TENDER_DOCUMENT'], keepByAgency: true },
  { code: '2.6', stage: '招标', materialName: '现场踏勘通知', sourceType: 'manual', stageKeys: ['TENDER_DOCUMENT'], keepByBidder: true, keepByAgency: true },
  { code: '2.7', stage: '招标', materialName: '招标文件澄清与修改', sourceType: 'manual', stageKeys: ['TENDER_DOCUMENT'], keepByBidder: true, keepByAgency: true },
  { code: '2.8', stage: '招标', materialName: '资格预审申请文件', sourceType: 'manual', stageKeys: ['TENDER_DOCUMENT'], keepByBidder: true, keepByAgency: true },
  { code: '2.9', stage: '招标', materialName: '资格审查委员会组建文件', sourceType: 'manual', stageKeys: ['EXPERT_SELECTION'] },
  { code: '2.10', stage: '招标', materialName: '通过资格预审申请人名单', sourceType: 'manual', stageKeys: ['EXPERT_SELECTION'] },
  { code: '2.11', stage: '招标', materialName: '未通过资格预审申请人名单', sourceType: 'manual', stageKeys: ['EXPERT_SELECTION'] },
  { code: '2.12', stage: '招标', materialName: '资格预审通过通知书', sourceType: 'manual', stageKeys: ['EXPERT_SELECTION'], keepByBidder: true, keepByAgency: true },
  { code: '2.13', stage: '招标', materialName: '资格预审结果通知书', sourceType: 'manual', stageKeys: ['EXPERT_SELECTION'], keepByBidder: true, keepByAgency: true },
  // ── 3 投标阶段 ──
  { code: '3.1', stage: '投标', materialName: '投标文件', sourceType: 'fileAsset', fileCategories: ['bid_decrypted'], isRequired: false, keepByBidder: true, keepByAgency: true },
  { code: '3.2', stage: '投标', materialName: '投标保证金凭证', sourceType: 'manual', stageKeys: ['BID_EVALUATION'], keepByBidder: true, keepByAgency: true },
  { code: '3.3', stage: '投标', materialName: '投标回执文件', sourceType: 'manual', stageKeys: ['BID_EVALUATION'], keepByBidder: true, keepByAgency: true },
  // ── 4 开标阶段 ──
  { code: '4.1', stage: '开标', materialName: '开标过程记录', sourceType: 'fileAsset', fileCategories: ['bid_opening_handover'], isRequired: false, keepByAgency: true },
  { code: '4.2', stage: '开标', materialName: '评审委员会名单', sourceType: 'manual', stageKeys: ['EXPERT_SELECTION'] },
  // ── 5 评标阶段 ──
  { code: '5.1', stage: '评标', materialName: '评标标准', sourceType: 'manual', stageKeys: ['BID_EVALUATION'], keepByBidder: true, keepByAgency: true },
  { code: '5.2', stage: '评标', materialName: '评标澄清文件', sourceType: 'manual', stageKeys: ['BID_EVALUATION'], keepByAgency: true },
  { code: '5.3', stage: '评标', materialName: '评标过程照片', sourceType: 'manual', stageKeys: ['BID_EVALUATION'] },
  { code: '5.4', stage: '评标', materialName: '评标过程录音录像', sourceType: 'manual', stageKeys: ['BID_EVALUATION'] },
  { code: '5.5', stage: '评标', materialName: '评标报告', sourceType: 'fileAsset', fileCategories: ['bid_evaluation_handover'], isRequired: false, keepByAgency: true },
  // ── 6 中标（定标）阶段 ──
  { code: '6.1', stage: '中标', materialName: '中标候选人公示及中标结果公告', sourceType: 'attachment', stageKeys: ['PUBLIC_ANNOUNCEMENT'], keepByAgency: true },
  { code: '6.2', stage: '中标', materialName: '中标通知书', sourceType: 'attachment', stageKeys: ['AWARD_DECISION'], isRequired: true, keepByBidder: true, keepByAgency: true },
  { code: '6.3', stage: '中标', materialName: '合同', sourceType: 'attachment', stageKeys: ['CONTRACT'], isRequired: true, keepByBidder: true, keepByAgency: true },
  // ── 7 其他阶段 ──
  { code: '7.1', stage: '其他', materialName: '异常情况信息表', sourceType: 'manual' },
  { code: '7.2', stage: '其他', materialName: '流程审批记录', sourceType: 'generated', isRequired: true },
  { code: '7.3', stage: '其他', materialName: '相关异议文件', sourceType: 'manual' },
  { code: '7.4', stage: '其他', materialName: '招标人答复文件', sourceType: 'manual', keepByAgency: true },
  { code: '7.5', stage: '其他', materialName: '投诉文件', sourceType: 'manual' },
  { code: '7.6', stage: '其他', materialName: '行政监督文件', sourceType: 'manual' },
];

/** 幂等播种：按 code upsert（模块启动时调用，规范内容固定无需后台管理） */
export async function ensureArchiveScopeSeeded(prisma: PrismaService): Promise<void> {
  const existing = await prisma.archiveScopeItem.count();
  if (existing >= ARCHIVE_SCOPE_SEED.length) return;
  for (let i = 0; i < ARCHIVE_SCOPE_SEED.length; i++) {
    const s = ARCHIVE_SCOPE_SEED[i];
    await prisma.archiveScopeItem.upsert({
      where: { code: s.code },
      create: {
        code: s.code,
        stage: s.stage,
        materialName: s.materialName,
        sourceType: s.sourceType,
        attachmentTypes: s.attachmentTypes ?? [],
        stageKeys: s.stageKeys ?? [],
        fileCategories: s.fileCategories ?? [],
        isRequired: s.isRequired ?? false,
        keepByTenderer: s.keepByTenderer ?? true,
        keepByBidder: s.keepByBidder ?? false,
        keepByAgency: s.keepByAgency ?? false,
        sortOrder: i,
      },
      update: {
        stage: s.stage,
        materialName: s.materialName,
        sourceType: s.sourceType,
        attachmentTypes: s.attachmentTypes ?? [],
        stageKeys: s.stageKeys ?? [],
        fileCategories: s.fileCategories ?? [],
        isRequired: s.isRequired ?? false,
        sortOrder: i,
      },
    });
  }
}
