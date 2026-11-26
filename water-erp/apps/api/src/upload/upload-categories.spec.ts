import { isUploadCategoryAllowedForRole, UPLOAD_CATEGORIES } from './upload-categories';

describe('upload category role policy', () => {
  it('allows supplier-owned business uploads', () => {
    for (const category of ['qualification', 'profile', 'bid_document', 'clarification_reply', 'contract_document']) {
      expect(isUploadCategoryAllowedForRole(category, 'supplier')).toBe(true);
    }
  });

  it('prevents suppliers from forging system evidence categories', () => {
    for (const category of ['bid_sign_packet', 'supervision_push_packet', 'bid_decrypted', 'performance_report', 'ai_bid_report']) {
      expect(isUploadCategoryAllowedForRole(category, 'supplier')).toBe(false);
    }
  });

  it('allows internal procurement roles to upload registered categories', () => {
    expect(isUploadCategoryAllowedForRole('announcement', 'admin')).toBe(true);
    expect(isUploadCategoryAllowedForRole('procurement_document', 'staff')).toBe(true);
    expect(isUploadCategoryAllowedForRole('made_up_category', 'admin')).toBe(false);
  });

  // 审计第 3 处跟进（2026-11-26）：审查源文件只能经 POST /tender-review/review/upload 登记——键由服务端生成、落在
  // review/ 命名空间。经通用上传口登出来的记录键在 uploads/ 下，执行审查不认（键不在命名空间），清理也不认（不是审查
  // 上传口登记的），是一条永远清不掉的孤儿。
  it('审查源文件类目（含待清状态）不进通用上传白名单：任何角色都不能经通用上传登记', () => {
    for (const category of ['tender_review_source', 'tender_review_source_purging']) {
      expect(UPLOAD_CATEGORIES.has(category)).toBe(false);
      for (const role of ['supplier', 'bid_expert', 'staff', 'leader', 'admin', 'bid_host']) {
        expect(isUploadCategoryAllowedForRole(category, role)).toBe(false);
      }
    }
  });
});
