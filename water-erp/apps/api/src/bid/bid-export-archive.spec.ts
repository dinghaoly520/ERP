import { Test, TestingModule } from '@nestjs/testing';
import { BidService } from './bid.service';
import { BidOpeningRecordService } from './bid-opening-record.service';
import { BidScoreStandardService } from './bid-score-standard.service';
import { GbCodeService } from '../common/gb-code.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { ClarificationAiService } from './clarification-ai.service';
import { BidGateway } from './bid.gateway';
import { ScoreStandardValidator } from './score-standard-validator.service';
import { StorageService } from '../storage/storage.service';
import { PriceFormulaService } from './price-formula.service';
import { AdminKeyService } from '../common/crypto/admin-keystore.service';
import { DualEnvelopeService } from '../common/crypto/dual-envelope.service';
import { SignatureService } from '../common/crypto/signature.service';

/* P2-2（2026-09-09）：归档包导出的评标期匿名化——与 listScores/getProject 同口径，
   防止导出通道成为 EXPERT_SCORE_ANONYMIZED_DURING_EVAL 的旁路。 */

function makePrismaMock() {
  return {
    bidProject: { findUnique: jest.fn() },
    openingHallMessage: { findMany: jest.fn().mockResolvedValue([]) },
    supplierBidSubmission: { findMany: jest.fn().mockResolvedValue([]) },
    workTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
    aiBidAnalysisTask: { findUnique: jest.fn().mockResolvedValue(null) },
    bidSupplier: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
}

async function buildService(prisma: any) {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      BidService,
      BidOpeningRecordService,
      BidScoreStandardService,
      { provide: PrismaService, useValue: prisma },
      { provide: GbCodeService, useValue: { allocateProjectCode: async () => 'GB-TEST', allocateProcureCode: async () => 'GB-PROC-TEST' } },
      { provide: NotificationService, useValue: { sendToRole: jest.fn().mockResolvedValue(undefined) } },
      { provide: ScoreStandardValidator, useValue: { assertScoreStandardComplete: jest.fn().mockResolvedValue(undefined) } },
      { provide: PriceFormulaService, useValue: { calculate: jest.fn().mockReturnValue(new Map()), getOverCeilingSuppliers: jest.fn().mockReturnValue([]) } },
      { provide: ClarificationAiService, useValue: {} },
      { provide: BidGateway, useValue: {} },
      { provide: StorageService, useValue: { upload: jest.fn().mockResolvedValue(undefined) } },
      { provide: 'BullQueue_tender-processing', useValue: {} },
      { provide: AdminKeyService, useValue: { readPrivateKey: jest.fn(), getActiveCert: jest.fn(), ensureBootstrap: jest.fn(), generate: jest.fn() } },
      { provide: DualEnvelopeService, useValue: { verifySignature: jest.fn(), assertEnvelopeIntact: jest.fn(), decryptOuterFile: jest.fn(), verifyFieldsCommit: jest.fn() } },
      { provide: SignatureService, useValue: { verify: jest.fn().mockReturnValue(false) } },
    ],
  }).compile();
  return moduleRef.get(BidService);
}

const EXPERTS = [
  {
    id: 'e1', expertName: '张评审', expertRole: '正选', reportConfirmed: false, major: '技术',
    scoreRecords: [{ supplierId: 'bs1', score: 8, reason: 'ok', scoreItem: { name: '技术方案' } }],
  },
];

describe('exportArchivePackage — P2-2 评标期匿名化（防导出旁路）', () => {
  afterEach(() => { delete process.env.EXPERT_SCORE_ANONYMIZED_DURING_EVAL; });

  const mkProject = (stage: string) => ({
    id: 'p1', projectCode: 'GK-1', name: 'P', stage, procurementMethod: '公开招标', budget: 1,
    scope: null, qualification: null, contact: null,
    suppliers: [{ supplierName: '甲公司', downloadStatus: 'x', submitStatus: '已提交', encryptStatus: 'x', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' }],
    openingSession: null, openingRecords: [],
    experts: EXPERTS,
    scoreItems: [], clarifications: [], supervisionLogs: [], archiveItems: [], evaluationResults: [],
  });

  it('EVALUATING 且专家未全员确认 → JSON expertScores 以「专家 N」脱敏，实名不出现在包内', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue(mkProject('EVALUATING'));
    const pkg = await svc.exportArchivePackage('p1', 'json', 'full') as any;
    expect(pkg.sections.expertScores[0].expertName).toBe('专家 1');
    expect(JSON.stringify(pkg)).not.toContain('张评审');
  });

  it('EVALUATING → CSV 专家列同样脱敏', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue(mkProject('EVALUATING'));
    const csv = await svc.exportArchivePackage('p1', 'csv', 'full') as string;
    expect(csv).toContain('专家 1');
    expect(csv).not.toContain('张评审');
  });

  it('ARCHIVED（或全员已确认）→ 实名保留（归档证据文件口径回归）', async () => {
    const prisma = makePrismaMock();
    const svc = await buildService(prisma);
    prisma.bidProject.findUnique.mockResolvedValue(mkProject('ARCHIVED'));
    const pkg = await svc.exportArchivePackage('p1', 'json', 'full') as any;
    expect(pkg.sections.expertScores[0].expertName).toBe('张评审');
  });
});
