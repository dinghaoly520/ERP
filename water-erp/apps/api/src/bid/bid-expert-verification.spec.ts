// 核验矩阵单测 —— 2026-09-18 身份核验设计 §4.5（spec 2026-09-18-expert-identity-verification-design.md）
import { BidService } from './bid.service';

describe('BidService.getExpertVerification（核验矩阵）', () => {
  let svc: any;
  let prisma: any;

  beforeEach(() => {
    prisma = { bidExpert: { findMany: jest.fn() } };
    const instance: any = Object.create(BidService.prototype);
    instance.prisma = prisma;
    svc = instance;
  });

  it('meta 字段平铺输出：时间/method/遮挡结论/照片 id；旧数据（无 meta）各字段为 null', async () => {
    prisma.bidExpert.findMany.mockResolvedValue([
      {
        id: 'e1', expertName: '刘苡池', major: '水利', expertRole: '正选', isLead: true, isPurchaserRepresentative: false,
        signedIn: true, signInIp: '10.0.0.8',
        signInMeta: { method: 'self_password_photo', timestamp: '2026-09-18T09:12:00.000Z', occlusion: 'passed', photoAssetId: 'fa-1', ip: '10.0.0.8' },
        identityVerified: false, identityVerifiedByName: null, identityDocType: null,
      },
      {
        id: 'e2', expertName: '老专家', major: '造价', expertRole: '候补', isLead: false, isPurchaserRepresentative: false,
        signedIn: false, signInIp: null, signInMeta: null,
        identityVerified: false, identityVerifiedByName: null, identityDocType: null,
      },
    ]);

    const r = await svc.getExpertVerification('proj-1');

    expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'proj-1' } }));
    expect(r.mode).toBe('self'); // 无 env 时默认 self
    expect(r.experts[0]).toMatchObject({
      signedIn: true, signedInAt: '2026-09-18T09:12:00.000Z', method: 'self_password_photo',
      occlusion: 'passed', photoAssetId: 'fa-1', signInIp: '10.0.0.8',
    });
    expect(r.experts[1]).toMatchObject({
      signedIn: false, signedInAt: null, method: null, occlusion: null, photoAssetId: null,
    });
  });

  it('off 态签到（无照片）→ method=off_mode、photoAssetId=null', async () => {
    process.env.EXPERT_IDENTITY_VERIFY = 'off';
    try {
      prisma.bidExpert.findMany.mockResolvedValue([
        {
          id: 'e1', expertName: '刘苡池', major: '水利', expertRole: '正选', isLead: false, isPurchaserRepresentative: false,
          signedIn: true, signInIp: '10.0.0.8',
          signInMeta: { method: 'off_mode', timestamp: '2026-09-18T09:12:00.000Z' },
          identityVerified: false, identityVerifiedByName: null, identityDocType: null,
        },
      ]);
      const r = await svc.getExpertVerification('proj-1');
      expect(r.mode).toBe('off');
      expect(r.experts[0]).toMatchObject({ method: 'off_mode', photoAssetId: null });
    } finally {
      delete process.env.EXPERT_IDENTITY_VERIFY;
    }
  });
});

// R9 主持人手动确认（2026-09-20 spec §4.6）——摄像头故障等现场降级
describe('BidService.manualConfirmExpertVerification（R9）', () => {
  let svc: any;
  let prisma: any;
  const ACTOR = { id: 'host-1', username: '陈源远' };

  const REGULAR_UNSIGNED = { id: 'e1', expertName: '刘苡池', expertRole: '正选', signedIn: false };

  beforeEach(() => {
    prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING' }) },
      bidExpert: {
        findFirst: jest.fn().mockResolvedValue(REGULAR_UNSIGNED),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ displayName: '陈源远' }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const instance: any = Object.create(BidService.prototype);
    instance.prisma = prisma;
    svc = instance;
  });

  it('未签到正选 → 确认成功：signedIn + meta.method=manual_confirm + 监督日志（身份核验降级·关注）', async () => {
    const r = await svc.manualConfirmExpertVerification('proj-1', 'e1', ACTOR, { reason: '摄像头故障', docType: '身份证' });

    expect(r.ok).toBe(true);
    expect(prisma.bidExpert.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({
        signedIn: true,
        signInIp: null,
        signInMeta: expect.objectContaining({
          method: 'manual_confirm', confirmedByName: '陈源远', reason: '摄像头故障', docType: '身份证',
        }),
      }),
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'proj-1', role: '评审专家', target: '刘苡池',
        action: '身份核验降级',
        result: expect.stringContaining('摄像头故障'),
        riskFlag: '关注',
      }),
    });
  });

  it('已签到 → 幂等（不重复写、不重复记监督日志）', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ ...REGULAR_UNSIGNED, signedIn: true });
    const r = await svc.manualConfirmExpertVerification('proj-1', 'e1', ACTOR, { reason: '摄像头故障' });
    expect(r.already).toBe(true);
    expect(prisma.bidExpert.update).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('候补 → 403 SUBSTITUTE_EXPERT', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ ...REGULAR_UNSIGNED, expertRole: '候补' });
    await expect(svc.manualConfirmExpertVerification('proj-1', 'e1', ACTOR, { reason: 'x' }))
      .rejects.toMatchObject({ response: { code: 'SUBSTITUTE_EXPERT' } });
  });

  it('阶段不符 → 403 PROJECT_NOT_ACTIVE', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
    await expect(svc.manualConfirmExpertVerification('proj-1', 'e1', ACTOR, { reason: 'x' }))
      .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_ACTIVE' } });
  });

  it('专家不在项目 → 403 NOT_PROJECT_EXPERT', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue(null);
    await expect(svc.manualConfirmExpertVerification('proj-1', 'e9', ACTOR, { reason: 'x' }))
      .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_EXPERT' } });
  });
});

// R5 核验异常登记（2026-09-20 spec §4.4）
describe('BidService.rejectExpertVerification（R5 异常登记）', () => {
  let svc: any;
  let prisma: any;
  const ACTOR = { id: 'host-1', username: '陈源远' };

  beforeEach(() => {
    prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING' }) },
      bidExpert: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', expertName: '刘苡池' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ displayName: '陈源远' }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const instance: any = Object.create(BidService.prototype);
    instance.prisma = prisma;
    svc = instance;
  });

  it('登记成功 → 监督日志 核验异常·高风险（含类型/说明/登记人）', async () => {
    const r = await svc.rejectExpertVerification('proj-1', 'e1', ACTOR, { type: '人证不符', note: '证件照片与本人不符' });
    expect(r.ok).toBe(true);
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'proj-1', role: '评审专家', target: '刘苡池',
        action: '核验异常',
        result: expect.stringContaining('人证不符：证件照片与本人不符（登记人：陈源远）'),
        riskFlag: '高风险',
      }),
    });
  });

  it('阶段不符 → 403 PROJECT_NOT_ACTIVE', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });
    await expect(svc.rejectExpertVerification('proj-1', 'e1', ACTOR, { type: '照片异常' }))
      .rejects.toMatchObject({ response: { code: 'PROJECT_NOT_ACTIVE' } });
  });
});

// P3 host 态核验登记/撤销（2026-09-20 spec §4.2）
describe('BidService.verify/unverifyExpertIdentity（P3 host 态）', () => {
  let svc: any;
  let prisma: any;
  const ACTOR = { id: 'host-1', username: '陈源远' };

  beforeEach(() => {
    prisma = {
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'OPENING' }) },
      bidExpert: {
        findFirst: jest.fn().mockResolvedValue({ id: 'e1', expertName: '刘苡池', expertRole: '正选', identityVerified: false, signedIn: false }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ displayName: '陈源远' }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const instance: any = Object.create(BidService.prototype);
    instance.prisma = prisma;
    svc = instance;
  });

  it('核验登记 → identity 列写入（含核验人快照）+ 监督日志 身份核验登记', async () => {
    const r = await svc.verifyExpertIdentity('proj-1', 'e1', ACTOR, { docType: '身份证', note: '现场核对无误' });
    expect(r.ok).toBe(true);
    expect(prisma.bidExpert.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({
        identityVerified: true,
        identityVerifiedByName: '陈源远',
        identityDocType: '身份证',
      }),
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: '身份核验登记', target: '刘苡池' }),
    });
  });

  it('撤销误登记（未签到）→ 清列 + 监督日志 身份核验撤销·关注', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e1', expertName: '刘苡池', identityVerified: true, signedIn: false });
    await svc.unverifyExpertIdentity('proj-1', 'e1', ACTOR, { reason: '登记错人' });
    expect(prisma.bidExpert.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({
        identityVerified: false, identityVerifiedByName: null, identityDocType: null,
        identityNote: expect.stringContaining('登记错人'),
      }),
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: '身份核验撤销', riskFlag: '关注' }),
    });
  });

  it('已签到 → 撤销 409 VERIFY_LOCKED（防证据回退）', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e1', expertName: '刘苡池', identityVerified: true, signedIn: true });
    await expect(svc.unverifyExpertIdentity('proj-1', 'e1', ACTOR, { reason: 'x' }))
      .rejects.toMatchObject({ response: { code: 'VERIFY_LOCKED' } });
    expect(prisma.bidExpert.update).not.toHaveBeenCalled();
  });

  it('未登记 → 撤销幂等（already:true，不写日志）', async () => {
    const r = await svc.unverifyExpertIdentity('proj-1', 'e1', ACTOR, { reason: 'x' });
    expect(r.already).toBe(true);
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('候补 → 登记 403 SUBSTITUTE_EXPERT', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ id: 'e2', expertName: '候补甲', expertRole: '候补', identityVerified: false, signedIn: false });
    await expect(svc.verifyExpertIdentity('proj-1', 'e2', ACTOR, { docType: '身份证' }))
      .rejects.toMatchObject({ response: { code: 'SUBSTITUTE_EXPERT' } });
  });
});
