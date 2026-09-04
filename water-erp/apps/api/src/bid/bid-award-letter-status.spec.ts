import { BidService } from './bid.service';

describe('BidService — award-letter status projection', () => {
  it('returns delivery timeline, receipt identity, signer and attachment metadata to procurement', async () => {
    const deliveredAt = new Date('2026-09-03T01:00:00.000Z');
    const receivedAt = new Date('2026-09-03T01:05:00.000Z');
    const signedAt = new Date('2026-09-03T01:10:00.000Z');
    const prisma = {
      awardLetterDelivery: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'delivery-abc123', projectId: 'project-1', supplierId: 'bid-supplier-1',
          supplierName: '供应商甲', letterAssetId: 'asset-1', deliveredAt, receivedAt,
          signedAt, signedBy: 'user-1', createdAt: deliveredAt,
        }]),
      },
      fileAsset: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'asset-1', originalName: '中标通知书.pdf', mimeType: 'application/pdf',
          size: 2048, sha256: 'a'.repeat(64), createdAt: deliveredAt,
        }]),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'user-1', username: 'supplier1', displayName: '张三',
        }]),
      },
    };
    const service = Object.create(BidService.prototype) as BidService;
    Object.assign(service as object, { prisma });

    const result = await service.getAwardLetterStatus('project-1');

    expect(result).toEqual([expect.objectContaining({
      id: 'delivery-abc123',
      receiptNo: expect.stringMatching(/^AL-/),
      signedByName: '张三',
      letterAsset: expect.objectContaining({ id: 'asset-1', originalName: '中标通知书.pdf', sha256: 'a'.repeat(64) }),
    })]);
    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['asset-1'] } },
    }));
  });
});
