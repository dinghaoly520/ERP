import { SupplierPortalService } from './supplier-portal.service';

describe('SupplierPortalService — clarification notification lifecycle', () => {
  it('resolves only the replying supplier actionable notification after a successful reply', async () => {
    const clarification = {
      id: 'clar-1', projectId: 'project-1', type: 'clarification', supplierId: 'supplier-1',
      status: '待回复', replySignature: null,
    };
    const prisma = {
      bidClarification: {
        findFirst: jest.fn().mockResolvedValue(clarification),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ ...clarification, status: '已回复', replySignature: { algorithm: 'SM2/SM3' } }),
      },
      bidProject: { findUnique: jest.fn().mockResolvedValue({ stage: 'EVALUATING' }) },
      supplierCert: { findFirst: jest.fn().mockResolvedValue({ certSn: 'cert-1', publicKey: 'pub' }) },
    };
    const notificationService = {
      resolveActionableForUser: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const subject = Object.create(SupplierPortalService.prototype) as SupplierPortalService;
    Object.assign(subject as object, {
      prisma,
      signatureService: { verify: jest.fn().mockReturnValue(true) },
      notificationService,
      gateway: undefined,
    });

    await subject.submitClarificationReply(
      'project-1',
      'clar-1',
      'supplier-1',
      { sub: 'user-1', name: '供应商经办人' },
      { reply: '已按要求完成澄清答复', certSn: 'cert-1', signature: 'signature', attachmentIds: [] },
    );

    expect(notificationService.resolveActionableForUser).toHaveBeenCalledWith(
      'user-1',
      'BID_CLARIFICATION_CREATED',
      '/bids/project-1/clarifications',
    );
  });
});
