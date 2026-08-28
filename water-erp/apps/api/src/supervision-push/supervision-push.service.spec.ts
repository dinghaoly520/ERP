// apps/api/src/supervision-push/supervision-push.service.spec.ts
// A-153：getStatus gate.reason 须返回业务中文错误文本（前端闸门提示直接展示），
// 而非 Nest HttpException 的类默认 message（如 'Conflict'）。
import { SupervisionPushService } from './supervision-push.service';

/** 直接 new（依赖全部 mock）——getStatus 只触碰 systemConfig.get / prisma 查询三处 */
function makeSvc(overrides?: {
  bidProject?: unknown;
  bidSignPacket?: unknown;
  findProject?: () => Promise<unknown>;
}) {
  const prisma = {
    bidProject: { findUnique: overrides?.findProject ?? (async () => overrides?.bidProject ?? null) },
    bidSignPacket: { findUnique: async () => overrides?.bidSignPacket ?? null },
    supervisionPushLog: { findFirst: async () => null },
  };
  const systemConfig = { get: async () => null };
  return new SupervisionPushService(
    prisma as never,
    {} as never, // StorageService（getStatus 不触达）
    systemConfig as never,
    {} as never, // BidSignPacketService（闸门未过时 buildSnapshot 不会被调用）
    {} as never, // PlatformSigningService
  );
}

describe('SupervisionPushService.getStatus gate.reason', () => {
  it('项目不存在 → 返回业务文本「项目不存在」（而非 NotFound message）', async () => {
    const st = await makeSvc().getStatus('p-nope');
    expect(st.gate.ready).toBe(false);
    expect(st.gate.reason).toBe('项目不存在');
  });

  it('签字包未生成 → 返回中文业务错误文本', async () => {
    const st = await makeSvc({ bidProject: { id: 'p1', projectCode: 'BID-1' } }).getStatus('p1');
    expect(st.gate.ready).toBe(false);
    expect(st.gate.reason).toBe('评标签字包未生成，无法推送评标报告');
  });

  it('非 HttpException（普通 Error）→ 保持 e.message 回退', async () => {
    const st = await makeSvc({
      findProject: async () => { throw new Error('数据库连接失败'); },
    }).getStatus('p1');
    expect(st.gate.ready).toBe(false);
    expect(st.gate.reason).toBe('数据库连接失败');
  });

  it('未配置时 config 给出 env 缺省值（enabled=false / timeoutMs=8000）', async () => {
    const st = await makeSvc({ bidProject: { id: 'p1' } }).getStatus('p1');
    expect(st.config.enabled).toBe(false);
    expect(st.config.timeoutMs).toBe(8000);
    expect(st.latest).toBeNull();
  });
});
