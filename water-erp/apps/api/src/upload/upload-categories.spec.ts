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

  it('审查源文件类目已登记；供应商与专家不能经通用上传伪造', () => {
    expect(UPLOAD_CATEGORIES.has('tender_review_source')).toBe(true);
    expect(isUploadCategoryAllowedForRole('tender_review_source', 'supplier')).toBe(false);
    expect(isUploadCategoryAllowedForRole('tender_review_source', 'bid_expert')).toBe(false);
  });
});
