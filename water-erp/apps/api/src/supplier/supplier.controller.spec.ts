import { SupplierController } from './supplier.controller';

/**
 * 补正回填公开端点契约锁定（2026-10-14 启动冒烟修复）：
 * GET register/correction/draft 是四个 correction 端点里唯一的 GET——无 DTO 可依赖
 * （@Query 直取），缺参若放行到 service 会先撞 verificationService.assertRegistrationSession
 * 的 hashToken(undefined)（crypto TypeError → 500 INTERNAL_ERROR），必须在 controller 层
 * 拦成 400 MISSING_CORRECTION_PARAMS。风格对齐同文件 getRegisterStatusPublic/urgeReview。
 * 直实例化（非 Test.createTestingModule）——对齐 company.controller.spec.ts 模式。
 */

describe('SupplierController 补正回填公开端点（correction/draft 缺参 500→400 守卫）', () => {
  function makeController() {
    const supplierService = { getCorrectionDraft: jest.fn().mockResolvedValue({}) };
    const ctrl = new SupplierController(supplierService as never, {} as never, {} as never);
    return { ctrl, supplierService };
  }

  it('token/name/creditCode 任一缺失 → 400 MISSING_CORRECTION_PARAMS，不透传 service', async () => {
    const { ctrl, supplierService } = makeController();

    await expect(ctrl.getCorrectionDraft(undefined, '测试公司', '91510000MA62K5XX0X'))
      .rejects.toMatchObject({ response: { code: 'MISSING_CORRECTION_PARAMS' } });
    await expect(ctrl.getCorrectionDraft('corr-token-1', '', '91510000MA62K5XX0X'))
      .rejects.toMatchObject({ response: { code: 'MISSING_CORRECTION_PARAMS' } });
    await expect(ctrl.getCorrectionDraft('corr-token-1', '测试公司'))
      .rejects.toMatchObject({ response: { code: 'MISSING_CORRECTION_PARAMS' } });
    // 裸 GET /register/correction/draft（冒烟实测 500 的场景）：三参全缺
    await expect(ctrl.getCorrectionDraft(undefined, undefined, undefined))
      .rejects.toMatchObject({ response: { code: 'MISSING_CORRECTION_PARAMS' } });

    expect(supplierService.getCorrectionDraft).not.toHaveBeenCalled();
  });

  it('参数齐全 → 透传 service.getCorrectionDraft', async () => {
    const { ctrl, supplierService } = makeController();

    await ctrl.getCorrectionDraft('corr-token-1', '测试公司', '91510000MA62K5XX0X');

    expect(supplierService.getCorrectionDraft).toHaveBeenCalledWith('corr-token-1', '测试公司', '91510000MA62K5XX0X');
  });
});
