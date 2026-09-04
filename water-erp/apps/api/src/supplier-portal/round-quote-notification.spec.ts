import { BidService } from '../bid/bid.service';
import { SupplierPortalController } from './supplier-portal.controller';

describe('round quote notification lifecycle', () => {
  it('resolves only the submitting supplier round task after a successful quote', async () => {
    const prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'supplier-1' }) },
      bidSupplier: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'bid-supplier-1',
          supplierId: 'supplier-1',
          bidValidity: 'valid',
        }),
      },
      bidRound: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'round-1',
          projectId: 'project-1',
          status: 'open',
          deadline: null,
          eligibleSupplierIds: ['bid-supplier-1'],
        }),
      },
      bidQuote: { create: jest.fn().mockResolvedValue({ id: 'quote-1' }) },
    };
    const notificationService = {
      resolveActionableForUser: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const controller = Object.create(SupplierPortalController.prototype) as SupplierPortalController;
    Object.assign(controller as object, { prisma, notificationService });

    await controller.submitQuote(
      { user: { sub: 'user-1' } },
      'project-1',
      'round-1',
      { bidSupplierId: 'bid-supplier-1', quotePrice: 123 },
    );

    expect(notificationService.resolveActionableForUser).toHaveBeenCalledWith(
      'user-1',
      'BID_ROUND_OPEN',
      '/bids/project-1/round-quote',
    );
  });

  it('resolves remaining round tasks when the buyer seals the round', async () => {
    const prisma = {
      bidRound: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'round-1', projectId: 'project-1', roundNo: 1, status: 'open',
        }),
        update: jest.fn().mockResolvedValue({ id: 'round-1', status: 'sealed' }),
      },
    };
    const notificationService = {
      resolveActionable: jest.fn().mockResolvedValue({ count: 2 }),
    };
    const service = Object.create(BidService.prototype) as BidService;
    Object.assign(service as object, { prisma, notificationService, gateway: undefined });

    await service.sealRound('project-1', 'round-1', 'buyer-1');

    expect(notificationService.resolveActionable).toHaveBeenCalledWith(
      'BID_ROUND_OPEN',
      '/bids/project-1/round-quote',
    );
  });
});
