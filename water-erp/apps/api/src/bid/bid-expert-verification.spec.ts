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
