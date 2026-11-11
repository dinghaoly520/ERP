import { ProjectManagementService } from './project-management.service';

/** updateExtractedInfo 收紧闸（2026-11-11 spec §2）：人工编辑唯一入口=变更流程——
 *  非 internal 调用一律 400 CHANGE_ONLY；internal=true 仅供服务端内部链路。
 *  该方法全库唯一调用方即 HTTP 端点（已核），无内部误伤。 */

const mkService = () =>
  new (ProjectManagementService as any)(...Array(12).fill({}));

describe('updateExtractedInfo — CHANGE_ONLY 闸', () => {
  it('非 internal（HTTP 人工 PATCH）→ 400 CHANGE_ONLY，文案指向变更入口', async () => {
    await expect(mkService().updateExtractedInfo('p1', { title: '新名' } as never))
      .rejects.toMatchObject({ response: { code: 'CHANGE_ONLY', error: expect.stringContaining('变更 / 补遗') } });
  });

  it('纯名单字段（专家/投标单位）→ 直改放行（2026-11-11 裁定例外，不走变更留痕）', async () => {
    await expect(mkService().updateExtractedInfo('p1', { expertInfo: '张三/岩土' } as never))
      .rejects.not.toMatchObject({ response: { code: 'CHANGE_ONLY' } });
    await expect(mkService().updateExtractedInfo('p1', { biddingUnits: '甲公司、乙公司' } as never))
      .rejects.not.toMatchObject({ response: { code: 'CHANGE_ONLY' } });
  });

  it('名单字段混入基本信息字段 → 仍拦（防借名单通道夹带）', async () => {
    await expect(mkService().updateExtractedInfo('p1', { expertInfo: '张三', title: '改名' } as never))
      .rejects.toMatchObject({ response: { code: 'CHANGE_ONLY' } });
  });

  it('internal=true（服务端内部）→ 过闸进入原逻辑（后续由 prisma mock 链路接管，此处只验不抛闸）', async () => {
    const svc = mkService();
    // 期望落到原逻辑：未配 prisma mock 时会因读取失败抛非 CHANGE_ONLY 错——闸本身未拦即通过断言
    await expect(svc.updateExtractedInfo('p1', { title: 'x', internal: true } as never))
      .rejects.not.toMatchObject({ response: { code: 'CHANGE_ONLY' } });
  });
});
