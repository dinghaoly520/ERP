// 核验矩阵单测 —— 2026-09-18 身份核验设计 §4.5（spec 2026-09-18-expert-identity-verification-design.md）
import { BidService } from './bid.service';

describe('BidService.getExpertVerification（核验矩阵）', () => {
  let svc: any;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      bidExpert: { findMany: jest.fn() },
      bidSupervisionLog: { findMany: jest.fn().mockResolvedValue([]) },
      // 2026-09-22 会话设备快照（getExpertVerification 读 user.findMany）——既有夹具滞后补齐
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
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

    // 已婉拒专家不进核验矩阵（2026-10-27 用户口径：婉拒=名册除名，:3007 不出现）
    expect(prisma.bidExpert.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { projectId: 'proj-1', invitationStatus: { not: 'declined' } } }));
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

  it('闭环修复：异常状态折叠——最后一条是登记=生效（anomaly 非空）、是撤销=已更正（anomaly null）', async () => {
    prisma.bidExpert.findMany.mockResolvedValue([
      {
        id: 'e1', expertName: '刘苡池', major: '水利', expertRole: '正选', isLead: false, isPurchaserRepresentative: false,
        signedIn: false, signInIp: null, signInMeta: null,
        identityVerified: false, identityVerifiedByName: null, identityDocType: null,
      },
      {
        id: 'e2', expertName: '老专家', major: '造价', expertRole: '候补', isLead: false, isPurchaserRepresentative: false,
        signedIn: false, signInIp: null, signInMeta: null,
        identityVerified: false, identityVerifiedByName: null, identityDocType: null,
      },
    ]);
    prisma.bidSupervisionLog.findMany.mockResolvedValue([
      { time: new Date('2026-09-20T10:00:00Z'), action: '核验异常', target: '刘苡池', result: '人证不符（登记人：陈源远）' },
      { time: new Date('2026-09-20T10:30:00Z'), action: '核验异常撤销', target: '刘苡池', result: '撤销异常登记（原因：复核为误会；操作人：陈源远）' },
      { time: new Date('2026-09-20T11:00:00Z'), action: '核验异常', target: '老专家', result: '到场异常' },
    ]);
    const r = await svc.getExpertVerification('proj-1');
    expect(r.experts[0].anomaly).toBeNull(); // 已撤销
    expect(r.experts[1].anomaly).toMatchObject({ result: '到场异常' }); // 生效中
  });
});

// TAB-SYNC-01（2026-11-12 spec §9.3）：核验矩阵平板配对可见性——registry 并行查+降级铁律
describe('BidService.getExpertVerification（TAB-SYNC-01 平板配对可见性）', () => {
  let svc: any;
  let prisma: any;
  let registry: { getActive: jest.Mock };

  const EXPERT_ROW = (id: string) => ({
    id, expertName: `专家${id}`, major: '水利', expertRole: '正选', isLead: false, isPurchaserRepresentative: false,
    signedIn: true, signInIp: null, signInMeta: null,
    identityVerified: false, identityVerifiedByName: null, identityDocType: null,
    transferPhotoPendingAt: null, transferPhotoExemptAt: null, transferPhotoExemptByName: null,
  });

  beforeEach(() => {
    prisma = {
      bidExpert: { findMany: jest.fn().mockResolvedValue([EXPERT_ROW('e1'), EXPERT_ROW('e2')]) },
      bidSupervisionLog: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    registry = { getActive: jest.fn() };
    const instance: any = Object.create(BidService.prototype);
    instance.prisma = prisma;
    instance.pairingRegistry = registry;
    svc = instance;
  });

  it('活跃配对 → tabletPaired 携带设备摘要/配对时间（pairingId 不外泄）；未配对专家为 null', async () => {
    registry.getActive.mockImplementation(async (expertId: string) =>
      expertId === 'e1'
        ? { pairingId: 'jti-1', device: { uaSummary: 'Safari·iPadOS', ip: '10.0.0.9' }, pairedAt: 1760000000000 }
        : null);

    const r = await svc.getExpertVerification('proj-1');

    // 登记键 expertId= BidExpert.id（claimExpertPairing 入键口径）
    expect(registry.getActive).toHaveBeenCalledWith('e1', 'proj-1');
    expect(registry.getActive).toHaveBeenCalledWith('e2', 'proj-1');
    expect(r.experts[0].tabletPaired).toEqual({
      device: { uaSummary: 'Safari·iPadOS', ip: '10.0.0.9' }, pairedAt: 1760000000000,
    });
    expect(r.experts[0].tabletPaired).not.toHaveProperty('pairingId');
    expect(r.experts[1].tabletPaired).toBeNull();
  });

  it('registry 抛错（Redis 不可用）→ 降级 tabletPaired=null，核验矩阵不受连坐', async () => {
    registry.getActive.mockRejectedValue(new Error('Redis down'));
    const r = await svc.getExpertVerification('proj-1');
    expect(r.experts.map((e: any) => e.tabletPaired)).toEqual([null, null]);
  });

  it('registry 未注入（单测直构/独立 worker）→ 同样降级 null', async () => {
    const bare: any = Object.create(BidService.prototype);
    bare.prisma = prisma;
    const r = await bare.getExpertVerification('proj-1');
    expect(r.experts.every((e: any) => e.tabletPaired === null)).toBe(true);
  });
});

// TAB-SYNC-01（2026-11-12）：主持人豁免端点随配对制由旧「迁移」名改为「配对」名——
// 监督日志文案同步迁移→配对
describe('BidService.confirmPairingPhotoExemption（豁免端点改名回归）', () => {
  let svc: any;
  let prisma: any;
  const ACTOR = { id: 'host-1', username: '陈源远' };

  beforeEach(() => {
    prisma = {
      bidExpert: {
        findFirst: jest.fn().mockResolvedValue({ id: 'e1', expertName: '刘苡池', transferPhotoPendingAt: new Date() }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ displayName: '陈源远' }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const instance: any = Object.create(BidService.prototype);
    instance.prisma = prisma;
    svc = instance;
  });

  it('豁免成功 → 监督日志 配对留档照豁免（不再写迁移文案）', async () => {
    const r = await svc.confirmPairingPhotoExemption('proj-1', 'e1', ACTOR, '平板无摄像头');
    expect(r.ok).toBe(true);
    expect(prisma.bidExpert.update).toHaveBeenCalledWith({
      where: { id: 'e1' },
      data: expect.objectContaining({ transferPhotoExemptAt: expect.any(Date), transferPhotoExemptByName: '陈源远' }),
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'proj-1', role: '主持人', target: '刘苡池',
        action: '配对留档照豁免',
        result: expect.stringContaining('平板无摄像头'),
        riskFlag: '中',
      }),
    });
  });

  it('理由必填 → 400 REASON_REQUIRED', async () => {
    await expect(svc.confirmPairingPhotoExemption('proj-1', 'e1', ACTOR, '  '))
      .rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('专家不在项目 → 403 NOT_PROJECT_EXPERT', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue(null);
    await expect(svc.confirmPairingPhotoExemption('proj-1', 'e9', ACTOR, 'x'))
      .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_EXPERT' } });
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
    // FE-3 后端（2026-09-24 全链审计）：手动确认签到补广播 WS 里程碑 signed_in
    instance.gateway = { notifyExpertPresence: jest.fn() };
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
    // FE-3：此前写 signedIn 零 WS 事件——:3005 专家签到态不实时刷新；现广播 signed_in
    expect(svc.gateway.notifyExpertPresence).toHaveBeenCalledWith('proj-1', expect.objectContaining({
      expertId: 'e1', expertName: '刘苡池', milestone: 'signed_in', progressPercent: 0,
    }));
  });

  it('已签到 → 幂等（不重复写、不重复记监督日志、不重复广播）', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ ...REGULAR_UNSIGNED, signedIn: true });
    const r = await svc.manualConfirmExpertVerification('proj-1', 'e1', ACTOR, { reason: '摄像头故障' });
    expect(r.already).toBe(true);
    expect(prisma.bidExpert.update).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    expect(svc.gateway.notifyExpertPresence).not.toHaveBeenCalled();
  });

  it('候补 → 403 SUBSTITUTE_EXPERT', async () => {
    prisma.bidExpert.findFirst.mockResolvedValue({ ...REGULAR_UNSIGNED, expertRole: '候补' });
    await expect(svc.manualConfirmExpertVerification('proj-1', 'e1', ACTOR, { reason: 'x' }))
      .rejects.toMatchObject({ response: { code: 'SUBSTITUTE_EXPERT' } });
  });

  it('启动评标前（DOWNLOAD/OPENING）→ 403 EVALUATION_NOT_STARTED（2026-10-21 收紧）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'DOWNLOAD' });
    await expect(svc.manualConfirmExpertVerification('proj-1', 'e1', ACTOR, { reason: 'x' }))
      .rejects.toMatchObject({ response: { code: 'EVALUATION_NOT_STARTED' } });
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    await expect(svc.manualConfirmExpertVerification('proj-1', 'e1', ACTOR, { reason: 'x' }))
      .rejects.toMatchObject({ response: { code: 'EVALUATION_NOT_STARTED' } });
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
      bidSupervisionLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
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

  it('闭环修复：存在未撤销异常 → 幂等 already（不重复写高风险记录）', async () => {
    prisma.bidSupervisionLog.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.action === '核验异常' ? { time: new Date('2026-09-20T10:00:00Z') } : null));
    const r = await svc.rejectExpertVerification('proj-1', 'e1', ACTOR, { type: '人证不符' });
    expect(r.already).toBe(true);
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('闭环修复：已撤销后再登记 → 写新记录（撤销晚于登记）', async () => {
    prisma.bidSupervisionLog.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.action === '核验异常'
        ? { time: new Date('2026-09-20T10:00:00Z') }
        : { time: new Date('2026-09-20T10:30:00Z') }));
    await svc.rejectExpertVerification('proj-1', 'e1', ACTOR, { type: '人证不符' });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: '核验异常', riskFlag: '高风险' }),
    });
  });
});

// R5 撤销异常登记（2026-09-20 闭环修复）——误报可更正，不删原记录
describe('BidService.retractExpertVerification（R5 撤销异常）', () => {
  let svc: any;
  let prisma: any;
  const ACTOR = { id: 'host-1', username: '陈源远' };

  beforeEach(() => {
    prisma = {
      bidExpert: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', expertName: '刘苡池' }) },
      user: { findUnique: jest.fn().mockResolvedValue({ displayName: '陈源远' }) },
      bidSupervisionLog: {
        findFirst: jest.fn().mockImplementation(({ where }: any) =>
          Promise.resolve(where.action === '核验异常' ? { time: new Date('2026-09-20T10:00:00Z') } : null)),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const instance: any = Object.create(BidService.prototype);
    instance.prisma = prisma;
    svc = instance;
  });

  it('有生效异常 → 写更正日志（核验异常撤销·关注，含原因/操作人）', async () => {
    const r = await svc.retractExpertVerification('proj-1', 'e1', ACTOR, { reason: '复核为误会' });
    expect(r.ok).toBe(true);
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: '核验异常撤销', riskFlag: '关注',
        result: expect.stringContaining('复核为误会'),
      }),
    });
  });

  it('无异常登记 → 幂等 already', async () => {
    prisma.bidSupervisionLog.findFirst.mockResolvedValue(null);
    const r = await svc.retractExpertVerification('proj-1', 'e1', ACTOR, { reason: 'x' });
    expect(r.already).toBe(true);
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('已撤销（撤销晚于登记）→ 幂等 already', async () => {
    prisma.bidSupervisionLog.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.action === '核验异常'
        ? { time: new Date('2026-09-20T10:00:00Z') }
        : { time: new Date('2026-09-20T10:30:00Z') }));
    const r = await svc.retractExpertVerification('proj-1', 'e1', ACTOR, { reason: 'x' });
    expect(r.already).toBe(true);
  });
});

// P3 host 态核验登记/撤销（2026-09-20 spec §4.2）
describe('BidService.verify/unverifyExpertIdentity（P3 host 态）', () => {
  let svc: any;
  let prisma: any;
  const ACTOR = { id: 'host-1', username: '陈源远' };

  beforeEach(() => {
    prisma = {
      // 2026-10-21 收紧：核验登记/撤销须 EVALUATING（启动前 OPENING 一律 403）
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING' }) },
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
