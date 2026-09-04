import { isUploadCategoryAllowedForRole } from './upload-categories';

describe('upload category role policy', () => {
  it('allows supplier-owned business uploads', () => {
    for (const category of ['qualification', 'profile', 'bid_document', 'clarification_reply', 'contract_document']) {
      expect(isUploadCategoryAllowedForRole(category, 'supplier')).toBe(true);
    }
  });

  it('prevents suppliers from forging system evidence categories', () => {
    for (const category of ['bid_sign_packet', 'supervision_push_packet', 'bid_decrypted', 'performance_report']) {
      expect(isUploadCategoryAllowedForRole(category, 'supplier')).toBe(false);
    }
  });

  it('allows internal procurement roles to upload registered categories', () => {
    expect(isUploadCategoryAllowedForRole('announcement', 'admin')).toBe(true);
    expect(isUploadCategoryAllowedForRole('procurement_document', 'staff')).toBe(true);
    expect(isUploadCategoryAllowedForRole('made_up_category', 'admin')).toBe(false);
  });
});
