import { ContractController } from './contract.controller';
import { ContractService } from './contract.service';
import { Prisma } from '@prisma/client';
import { SupplierPortalController } from '../supplier-portal/supplier-portal.controller';
import { SupplierPortalService } from '../supplier-portal/supplier-portal.service';

describe('ContractService — 合同履约资产与状态安全', () => {
  const ACTOR = { userId: 'user-1', username: '经办人' };
  const SCOPED_ACTOR = { ...ACTOR, companyId: 'company-a' };
  const CONTRACT_UPDATED_AT = new Date('2026-09-03T08:00:00.000Z');
  const FULFILLMENT_UPDATED_AT = new Date('2026-09-03T08:01:00.000Z');

  const contractRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'contract-1',
    status: 'performing',
    projectCode: 'P-1',
    supplierId: 'supplier-1',
    supplierName: '供应商甲',
    signedAssetId: 'signed-asset',
    consistencyResult: { consistent: true, issues: [] },
    fulfillments: [],
    updatedAt: CONTRACT_UPDATED_AT,
    ...overrides,
  });

  const fulfillmentRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'fulfillment-1',
    contractId: 'contract-1',
    type: 'delivery',
    status: 'pending',
    proofAssetId: null,
    updatedAt: FULFILLMENT_UPDATED_AT,
    contract: {
      id: 'contract-1', status: 'performing', supplierId: 'supplier-1', signedAssetId: 'signed-asset',
    },
    ...overrides,
  });

  const createSubject = () => {
    const currentContract = contractRecord({ status: 'signed' });
    const currentFulfillment = fulfillmentRecord();
    const prisma: any = {
      fileAsset: {
        findFirst: jest.fn().mockResolvedValue({ id: 'asset-1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      contract: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(currentContract),
        update: jest.fn().mockResolvedValue({ id: 'contract-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contractFulfillment: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => (
          where?.id === 'fulfillment-1' ? Promise.resolve(currentFulfillment) : Promise.resolve(null)
        )),
        findUnique: jest.fn().mockResolvedValue({ ...currentFulfillment, status: 'done', proofAssetId: 'asset-1' }),
        update: jest.fn().mockResolvedValue({ id: 'fulfillment-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'acceptance-1', proofAssetId: 'asset-1' }),
      },
      awardLetterDelivery: { findFirst: jest.fn().mockResolvedValue(null) },
      announcement: {
        findFirst: jest.fn().mockResolvedValue({ id: 'ann-1' }),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    prisma.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(prisma));

    const subject = Object.create(ContractService.prototype) as ContractService;
    (subject as any).prisma = prisma;
    (subject as any).get = jest.fn().mockResolvedValue(currentContract);
    return { subject, prisma };
  };

  it.each([
    ['sign', async (subject: ContractService) => (subject as any).sign('contract-1', { signedAssetId: 'asset-bad' }, ACTOR)],
    ['fulfillment', async (subject: ContractService) => (subject as any).updateFulfillment('contract-1', 'fulfillment-1', { proofAssetId: 'asset-bad' }, ACTOR)],
    ['acceptance', async (subject: ContractService) => (subject as any).accept('contract-1', { proofAssetId: 'asset-bad', publishNotice: false }, ACTOR)],
  ])('%s 拒绝非当前操作者上传或非合同分类的资产引用', async (_name, invoke) => {
    const { subject, prisma } = createSubject();
    prisma.fileAsset.findFirst.mockResolvedValue(null);

    await expect(invoke(subject)).rejects.toMatchObject({ response: { code: 'CONTRACT_ASSET_INVALID' } });
    expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith({
      where: { id: 'asset-bad', category: 'contract_document', uploaderId: ACTOR.userId },
      select: { id: true },
    });
  });

  it('拒绝把已用于其他供应商合同的资产串挂到当前合同', async () => {
    const { subject, prisma } = createSubject();
    prisma.contract.findFirst.mockResolvedValue({ id: 'contract-other', supplierId: 'supplier-other' });

    await expect((subject as any).sign(
      'contract-1', { signedAssetId: 'asset-1' }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'CONTRACT_ASSET_ALREADY_BOUND' } });

    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: {
        id: { not: 'contract-1' },
        OR: [{ draftAssetId: 'asset-1' }, { signedAssetId: 'asset-1' }],
      },
      select: { id: true, supplierId: true },
    });
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('拒绝把已用于其他合同履约节点的证明资产串挂到当前合同', async () => {
    const { subject, prisma } = createSubject();
    prisma.contractFulfillment.findFirst.mockImplementation(({ where }: any) => {
      if (where?.proofAssetId === 'asset-1') {
        return Promise.resolve({ id: 'fulfillment-other', contractId: 'contract-other' });
      }
      return Promise.resolve(fulfillmentRecord());
    });

    await expect((subject as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { proofAssetId: 'asset-1' }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'CONTRACT_ASSET_ALREADY_BOUND' } });
    expect(prisma.contractFulfillment.updateMany).not.toHaveBeenCalled();
  });

  it('拒绝把已用于定向成交通知书的资产改挂到合同证据链', async () => {
    const { subject, prisma } = createSubject();
    prisma.awardLetterDelivery.findFirst.mockResolvedValue({
      id: 'delivery-other', supplierId: 'bid-supplier-other',
    });

    await expect((subject as any).sign(
      'contract-1', { signedAssetId: 'asset-1' }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'CONTRACT_ASSET_ALREADY_BOUND' } });

    expect(prisma.awardLetterDelivery.findFirst).toHaveBeenCalledWith({
      where: { letterAssetId: 'asset-1' },
      select: { id: true, supplierId: true },
    });
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('标记履约节点完成时必须已有或同时提交证明', async () => {
    const { subject, prisma } = createSubject();

    await expect((subject as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { status: 'done' }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'FULFILLMENT_PROOF_REQUIRED' } });

    expect(prisma.contractFulfillment.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('存量节点的旧凭证不是 contract_document 时不可据此标记完成', async () => {
    const { subject, prisma } = createSubject();
    prisma.contractFulfillment.findFirst.mockResolvedValue(fulfillmentRecord({
      proofAssetId: 'legacy-wrong-category',
    }));
    prisma.fileAsset.findFirst.mockResolvedValue(null);

    await expect((subject as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { status: 'done' }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'CONTRACT_ASSET_INVALID' } });
    expect(prisma.contractFulfillment.updateMany).not.toHaveBeenCalled();
  });

  it('同时提交证明完成履约节点时使用状态与版本条件更新并写审计', async () => {
    const { subject, prisma } = createSubject();

    await expect((subject as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { status: 'done', proofAssetId: 'asset-1' }, ACTOR,
    )).resolves.toMatchObject({ id: 'fulfillment-1', status: 'done', proofAssetId: 'asset-1' });

    expect(prisma.contractFulfillment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'fulfillment-1',
        contractId: 'contract-1',
        status: { not: 'done' },
        updatedAt: FULFILLMENT_UPDATED_AT,
        contract: { status: { in: ['signed', 'performing'] } },
      },
      data: expect.objectContaining({
        status: 'done', proofAssetId: 'asset-1', doneDate: expect.any(Date),
      }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ACTOR.userId,
        action: 'CONTRACT_FULFILLMENT_UPDATED',
        resourceType: 'ContractFulfillment',
        resourceId: 'fulfillment-1',
        details: expect.objectContaining({ contractId: 'contract-1', proofAssetId: 'asset-1' }),
      }),
    });
  });

  it.each(['accepted', 'terminated'])('%s 合同禁止再修改履约节点', async (status) => {
    const { subject, prisma } = createSubject();
    prisma.contractFulfillment.findFirst.mockResolvedValue(fulfillmentRecord({
      contract: { id: 'contract-1', status, supplierId: 'supplier-1', signedAssetId: 'signed-asset' },
    }));

    await expect((subject as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { note: '试图修改' }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'CONTRACT_CLOSED' } });
    expect(prisma.contractFulfillment.updateMany).not.toHaveBeenCalled();
  });

  it('已完成履约节点禁止覆盖凭证或修改内容', async () => {
    const { subject, prisma } = createSubject();
    prisma.contractFulfillment.findFirst.mockResolvedValue(fulfillmentRecord({
      status: 'done', proofAssetId: 'asset-old',
    }));

    await expect((subject as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { proofAssetId: 'asset-new', note: '覆盖' }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'FULFILLMENT_LOCKED' } });
    expect(prisma.fileAsset.findFirst).not.toHaveBeenCalled();
    expect(prisma.contractFulfillment.updateMany).not.toHaveBeenCalled();
  });

  it.each(['drafting', 'internal_review'])('%s 合同不可修改履约节点', async (status) => {
    const { subject, prisma } = createSubject();
    prisma.contractFulfillment.findFirst.mockResolvedValue(fulfillmentRecord({
      contract: { id: 'contract-1', status, supplierId: 'supplier-1', signedAssetId: 'signed-asset' },
    }));

    await expect((subject as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { note: '试图绕过签署阶段' }, SCOPED_ACTOR,
    )).rejects.toMatchObject({ response: { code: 'BAD_STATUS' } });
    expect(prisma.contractFulfillment.updateMany).not.toHaveBeenCalled();
  });

  it('履约节点初查和条件更新均带公司范围', async () => {
    const { subject, prisma } = createSubject();

    await (subject as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { note: '公司内更新' }, SCOPED_ACTOR,
    );

    expect(prisma.contractFulfillment.findFirst).toHaveBeenNthCalledWith(1, {
      where: {
        id: 'fulfillment-1',
        contractId: 'contract-1',
        contract: { companyId: 'company-a' },
      },
      include: {
        contract: { select: { id: true, status: true, supplierId: true, signedAssetId: true } },
      },
    });
    expect(prisma.contractFulfillment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        contract: { companyId: 'company-a', status: { in: ['signed', 'performing'] } },
      }),
    }));
  });

  it('条件更新未命中且节点已被并发完成时返回稳定锁定错误且不写审计', async () => {
    const { subject, prisma } = createSubject();
    prisma.contractFulfillment.updateMany.mockResolvedValue({ count: 0 });
    prisma.contractFulfillment.findFirst
      .mockResolvedValueOnce(fulfillmentRecord({ proofAssetId: 'asset-existing' }))
      .mockResolvedValueOnce(fulfillmentRecord({ status: 'done', proofAssetId: 'asset-existing' }));

    await expect((subject as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { status: 'done' }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'FULFILLMENT_LOCKED' } });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('验收办结缺少本次验收证明且无已完成有证的验收节点时拒绝', async () => {
    const { subject, prisma } = createSubject();

    await expect((subject as any).accept(
      'contract-1', { publishNotice: false }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'ACCEPTANCE_PROOF_REQUIRED' } });
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('已有完成且有证明的验收节点时可条件办结并写审计', async () => {
    const { subject, prisma } = createSubject();
    const acceptance = fulfillmentRecord({
      id: 'acceptance-existing', type: 'acceptance', status: 'done', proofAssetId: 'acceptance-proof',
    });
    (subject as any).get.mockResolvedValue(contractRecord({ fulfillments: [acceptance] }));
    prisma.contract.findUnique.mockResolvedValue(contractRecord({ status: 'accepted', fulfillments: [acceptance] }));

    await expect((subject as any).accept(
      'contract-1', { publishNotice: false }, ACTOR,
    )).resolves.toMatchObject({ contract: { status: 'accepted' }, announcementId: null });

    expect(prisma.contract.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'contract-1',
        status: { in: ['signed', 'performing'] },
        updatedAt: CONTRACT_UPDATED_AT,
      },
      data: { status: 'accepted' },
    });
    expect(prisma.contractFulfillment.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ACTOR.userId,
        action: 'CONTRACT_ACCEPTED',
        resourceType: 'Contract',
        resourceId: 'contract-1',
        details: expect.objectContaining({
          acceptanceFulfillmentId: 'acceptance-existing', proofAssetId: 'acceptance-proof',
        }),
      }),
    });
  });

  it('存量已完成验收节点的凭证分类不合法时不可办结', async () => {
    const { subject, prisma } = createSubject();
    const acceptance = fulfillmentRecord({
      id: 'acceptance-existing', type: 'acceptance', status: 'done', proofAssetId: 'legacy-wrong-category',
    });
    (subject as any).get.mockResolvedValue(contractRecord({ fulfillments: [acceptance] }));
    prisma.fileAsset.findFirst.mockResolvedValue(null);

    await expect((subject as any).accept(
      'contract-1', { publishNotice: false }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'CONTRACT_ASSET_INVALID' } });
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('验收办结同时提交证明时生成有证验收节点', async () => {
    const { subject, prisma } = createSubject();
    prisma.contract.findUnique.mockResolvedValue(contractRecord({ status: 'accepted' }));

    await expect((subject as any).accept(
      'contract-1', { proofAssetId: 'asset-1', publishNotice: false }, ACTOR,
    )).resolves.toMatchObject({ contract: { status: 'accepted' }, announcementId: null });

    expect(prisma.contractFulfillment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contractId: 'contract-1', type: 'acceptance', status: 'done', proofAssetId: 'asset-1',
      }),
    });
  });

  it.each([
    ['addFulfillment', async (subject: ContractService) => (subject as any).addFulfillment(
      'contract-1', { type: 'delivery', title: '到货' }, ACTOR,
    )],
    ['updateFulfillment', async (subject: ContractService) => (subject as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { note: '尝试更新' }, ACTOR,
    )],
    ['accept', async (subject: ContractService) => (subject as any).accept(
      'contract-1', { proofAssetId: 'asset-1', publishNotice: false }, ACTOR,
    )],
  ])('存量 %s 路径遇到无签署件合同时拒绝继续流转', async (_name, invoke) => {
    const { subject, prisma } = createSubject();
    (subject as any).get.mockResolvedValue(contractRecord({ status: 'signed', signedAssetId: null }));
    prisma.contractFulfillment.findFirst.mockResolvedValue(fulfillmentRecord({
      contract: {
        id: 'contract-1', status: 'performing', supplierId: 'supplier-1', signedAssetId: null,
      },
    }));

    await expect(invoke(subject)).rejects.toMatchObject({ response: { code: 'SIGNED_ASSET_REQUIRED' } });
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
    expect(prisma.contractFulfillment.updateMany).not.toHaveBeenCalled();
  });

  it('已完成验收节点存在时禁止用新凭证覆盖', async () => {
    const { subject, prisma } = createSubject();
    const acceptance = fulfillmentRecord({
      id: 'acceptance-existing', type: 'acceptance', status: 'done', proofAssetId: 'acceptance-proof',
    });
    (subject as any).get.mockResolvedValue(contractRecord({ fulfillments: [acceptance] }));

    await expect((subject as any).accept(
      'contract-1', { proofAssetId: 'asset-new', publishNotice: false }, ACTOR,
    )).rejects.toMatchObject({ response: { code: 'FULFILLMENT_LOCKED' } });
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
    expect(prisma.fileAsset.findFirst).not.toHaveBeenCalled();
  });

  it('签署版资产通过条件更新登记并记录操作者审计', async () => {
    const { subject, prisma } = createSubject();
    (subject as any).get.mockResolvedValue(contractRecord({ status: 'signed' }));
    prisma.contract.findUnique.mockResolvedValue(contractRecord({ status: 'signed', signedAssetId: 'asset-1' }));

    await (subject as any).sign('contract-1', { signedAssetId: 'asset-1' }, ACTOR);

    expect(prisma.contract.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'contract-1',
        status: { in: ['approved_for_signing', 'signed'] },
        updatedAt: CONTRACT_UPDATED_AT,
      },
      data: expect.objectContaining({ status: 'signed', signedAssetId: 'asset-1' }),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: ACTOR.userId,
        action: 'CONTRACT_SIGNED',
        resourceType: 'Contract',
        resourceId: 'contract-1',
      }),
    });
  });

  it('内审通过只转待签署，不写入签署时间或伪造已签署状态', async () => {
    const { subject, prisma } = createSubject();
    (subject as any).get.mockResolvedValue(contractRecord({ status: 'internal_review', signedAssetId: null }));

    await (subject as any).review('contract-1', { approved: true }, ACTOR);

    expect(prisma.contract.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'contract-1', status: 'internal_review', updatedAt: CONTRACT_UPDATED_AT,
      },
      data: expect.objectContaining({
        status: 'approved_for_signing', signedAt: null,
      }),
    });
  });

  it.each([
    ['approved_for_signing', null],
    ['signed', null],
  ])('%s 合同无旧签署件且本次未提交时拒绝登记签署', async (status, signedAssetId) => {
    const { subject, prisma } = createSubject();
    (subject as any).get.mockResolvedValue(contractRecord({ status, signedAssetId }));

    await expect((subject as any).sign('contract-1', {}, ACTOR))
      .rejects.toMatchObject({ response: { code: 'SIGNED_ASSET_REQUIRED' } });
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it('待签署合同上传有效签署件后才可 CAS 转已签署', async () => {
    const { subject, prisma } = createSubject();
    (subject as any).get.mockResolvedValue(contractRecord({
      status: 'approved_for_signing', signedAssetId: null,
    }));

    await (subject as any).sign('contract-1', { signedAssetId: 'asset-1' }, ACTOR);

    expect(prisma.contract.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['approved_for_signing', 'signed'] },
      }),
      data: expect.objectContaining({ status: 'signed', signedAssetId: 'asset-1' }),
    }));
  });

  it('签署查询与 CAS 更新均限定当前公司', async () => {
    const { subject, prisma } = createSubject();
    delete (subject as any).get;
    prisma.contract.findFirst.mockImplementation(({ where }: any) => (
      where?.id === 'contract-1'
        ? Promise.resolve(contractRecord({ status: 'signed' }))
        : Promise.resolve(null)
    ));
    prisma.contract.findUnique.mockResolvedValue(contractRecord({ status: 'signed' }));

    await (subject as any).sign('contract-1', { signedAssetId: 'asset-1' }, SCOPED_ACTOR);

    expect(prisma.contract.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'contract-1', companyId: 'company-a' },
    }));
    expect(prisma.contract.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'contract-1', companyId: 'company-a' }),
    }));
  });

  describe('登记履约节点的原子状态迁移', () => {
    it.each(['drafting', 'internal_review', 'accepted', 'terminated'])(
      '%s 合同不可登记履约节点',
      async (status) => {
        const { subject, prisma } = createSubject();
        (subject as any).get.mockResolvedValue(contractRecord({ status }));

        await expect((subject as any).addFulfillment(
          'contract-1', { type: 'delivery', title: '到货' }, SCOPED_ACTOR,
        )).rejects.toMatchObject({ response: { code: status === 'accepted' || status === 'terminated' ? 'CONTRACT_CLOSED' : 'BAD_STATUS' } });
        expect(prisma.contractFulfillment.create).not.toHaveBeenCalled();
      },
    );

    it('签署合同仅在同一串行化事务中 CAS 转履行中并创建节点', async () => {
      const { subject, prisma } = createSubject();
      (subject as any).get.mockResolvedValue(contractRecord({ status: 'signed' }));
      prisma.contractFulfillment.create.mockResolvedValue({ id: 'fulfillment-new', contractId: 'contract-1' });

      await expect((subject as any).addFulfillment(
        'contract-1', { type: 'delivery', title: '到货' }, SCOPED_ACTOR,
      )).resolves.toMatchObject({ id: 'fulfillment-new' });

      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(prisma.contract.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'contract-1',
          companyId: 'company-a',
          status: { in: ['signed', 'performing'] },
          updatedAt: CONTRACT_UPDATED_AT,
        },
        data: { status: 'performing' },
      });
      expect(prisma.contractFulfillment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ contractId: 'contract-1', type: 'delivery', title: '到货' }),
      });
    });

    it('startPerforming 仅用签署状态、版本及公司范围条件转换', async () => {
      const { subject, prisma } = createSubject();
      (subject as any).get.mockResolvedValue(contractRecord({ status: 'signed' }));
      prisma.contract.findFirst.mockResolvedValue(contractRecord({ status: 'performing' }));

      await expect((subject as any).startPerforming('contract-1', { companyId: 'company-a' }))
        .resolves.toMatchObject({ status: 'performing' });

      expect(prisma.contract.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'contract-1', companyId: 'company-a', status: 'signed', updatedAt: CONTRACT_UPDATED_AT,
        },
        data: { status: 'performing' },
      });
    });
  });

  it('已验收合同不可再终止，终止操作使用状态和版本 CAS', async () => {
    const { subject, prisma } = createSubject();
    (subject as any).get.mockResolvedValue(contractRecord({ status: 'accepted' }));

    await expect((subject as any).terminate('contract-1', '试图终止', SCOPED_ACTOR))
      .rejects.toMatchObject({ response: { code: 'CONTRACT_CLOSED' } });
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['sign', async (subject: ContractService) => (subject as any).sign(
      'contract-b', { signedAssetId: 'asset-1' }, SCOPED_ACTOR,
    )],
    ['add', async (subject: ContractService) => (subject as any).addFulfillment(
      'contract-b', { type: 'delivery', title: '到货' }, SCOPED_ACTOR,
    )],
    ['accept', async (subject: ContractService) => (subject as any).accept(
      'contract-b', { proofAssetId: 'asset-1', publishNotice: false }, SCOPED_ACTOR,
    )],
  ])('跨公司 %s 不可进入资产校验或业务写入', async (_name, invoke) => {
    const { subject, prisma } = createSubject();
    delete (subject as any).get;
    prisma.contract.findFirst.mockResolvedValue(null);

    await expect(invoke(subject)).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    expect(prisma.fileAsset.findFirst).not.toHaveBeenCalled();
    expect(prisma.contract.updateMany).not.toHaveBeenCalled();
    expect(prisma.contractFulfillment.create).not.toHaveBeenCalled();
  });

  it('跨公司履约节点不可修改', async () => {
    const { subject, prisma } = createSubject();
    prisma.contractFulfillment.findFirst.mockResolvedValue(null);

    await expect((subject as any).updateFulfillment(
      'contract-b', 'fulfillment-b', { note: '试图跨公司修改' }, SCOPED_ACTOR,
    )).rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    expect(prisma.contractFulfillment.updateMany).not.toHaveBeenCalled();
  });
});

describe('ContractService — 线上成交合同绑定真实供应商', () => {
  const PROJECT = {
    id: 'bid-project-1',
    projectCode: 'BID-20260903-001',
    projectManagementItemId: 'pmi-1',
    companyId: 'company-a',
  };
  const WINNER = {
    supplierId: 'bid-supplier-1',
    supplierName: '供应商甲',
  };
  const REAL_SUPPLIER = {
    id: 'bid-supplier-1',
    supplierId: 'supplier-real-1',
    supplierName: '供应商甲',
    supplier: { id: 'supplier-real-1', name: '供应商甲' },
  };

  const createSubject = () => {
    let createdContract: any;
    const prisma: any = {
      projectManagementItem: {
        findFirst: jest.fn().mockResolvedValue({ id: 'pmi-1', companyId: 'company-a' }),
      },
      bidProject: { findFirst: jest.fn().mockResolvedValue(PROJECT) },
      bidEvaluationResult: { findFirst: jest.fn().mockResolvedValue(WINNER) },
      awardLetterDelivery: { findFirst: jest.fn().mockResolvedValue(null) },
      bidSupplier: { findFirst: jest.fn().mockResolvedValue(REAL_SUPPLIER) },
      supplier: {
        findUnique: jest.fn().mockResolvedValue({ id: 'supplier-real-1', name: '供应商甲' }),
      },
      contract: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          createdContract = { id: 'contract-1', status: 'drafting', ...data, fulfillments: [] };
          return Promise.resolve(createdContract);
        }),
        findMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(
          createdContract?.supplierId === where.supplierId ? [createdContract] : [],
        )),
      },
    };
    const subject = Object.create(ContractService.prototype) as ContractService;
    (subject as any).prisma = prisma;
    (subject as any).nextContractCode = jest.fn().mockResolvedValue('HT-202609-0001');
    return { subject, prisma, getCreated: () => createdContract };
  };

  it('PMI 线上中标链自动解析 BidSupplier 关联的 Supplier.id', async () => {
    const { subject, prisma } = createSubject();

    await expect(subject.create({
      projectCode: 'PMI-001',
      projectManagementItemId: 'pmi-1',
      supplierName: '供应商甲',
    }, { companyId: 'company-a', companyName: '采购人甲' })).resolves.toMatchObject({
      projectId: 'bid-project-1',
      supplierId: 'supplier-real-1',
      supplierName: '供应商甲',
    });

    expect(prisma.projectManagementItem.findFirst).toHaveBeenCalledWith({
      where: { id: 'pmi-1', companyId: 'company-a' },
      select: { id: true },
    });
    expect(prisma.bidProject.findFirst).toHaveBeenCalledWith({
      where: { projectManagementItemId: 'pmi-1', companyId: 'company-a' },
      orderBy: [{ round: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, projectCode: true, projectManagementItemId: true, companyId: true },
    });
    expect(prisma.bidSupplier.findFirst).toHaveBeenCalledWith({
      where: { id: 'bid-supplier-1', projectId: 'bid-project-1' },
      select: {
        id: true,
        supplierId: true,
        supplierName: true,
        supplier: { select: { id: true, name: true } },
      },
    });
  });

  it.each([
    [{ supplierId: 'supplier-other', supplierName: '供应商甲' }, 'CONTRACT_SUPPLIER_MISMATCH'],
    [{ supplierId: 'supplier-real-1', supplierName: '供应商乙' }, 'CONTRACT_SUPPLIER_MISMATCH'],
  ])('线上项目拒绝伪造的供应商 ID 或名称 %j', async (supplierInput, code) => {
    const { subject, prisma } = createSubject();

    await expect(subject.create({
      projectCode: 'PMI-001',
      projectManagementItemId: 'pmi-1',
      ...supplierInput,
    }, { companyId: 'company-a' })).rejects.toMatchObject({ response: { code } });
    expect(prisma.contract.create).not.toHaveBeenCalled();
  });

  it('评审结果缺失时可从已交付的成交通知书解析真实供应商', async () => {
    const { subject, prisma } = createSubject();
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(null);
    prisma.awardLetterDelivery.findFirst.mockResolvedValue({
      supplierId: 'bid-supplier-1', supplierName: '供应商甲', deliveredAt: new Date(),
    });

    await expect(subject.create({
      projectCode: 'PMI-001', projectManagementItemId: 'pmi-1', supplierName: '供应商甲',
    }, { companyId: 'company-a' })).resolves.toMatchObject({ supplierId: 'supplier-real-1' });
    expect(prisma.awardLetterDelivery.findFirst).toHaveBeenCalledWith({
      where: { projectId: 'bid-project-1', deliveredAt: { not: null } },
      orderBy: { deliveredAt: 'desc' },
      select: { supplierId: true, supplierName: true },
    });
  });

  it('评审结果与已交付通知书指向不同 BidSupplier 时拒绝建立合同', async () => {
    const { subject, prisma } = createSubject();
    prisma.awardLetterDelivery.findFirst.mockResolvedValue({
      supplierId: 'bid-supplier-other', supplierName: '供应商乙', deliveredAt: new Date(),
    });

    await expect(subject.create({
      projectCode: 'PMI-001', projectManagementItemId: 'pmi-1', supplierName: '供应商甲',
    }, { companyId: 'company-a' })).rejects.toMatchObject({
      response: { code: 'CONTRACT_AWARD_CONFLICT' },
    });
    expect(prisma.bidSupplier.findFirst).not.toHaveBeenCalled();
    expect(prisma.contract.create).not.toHaveBeenCalled();
  });

  it('线上成交人未关联真实 Supplier 时拒绝退化为 offline id', async () => {
    const { subject, prisma } = createSubject();
    prisma.bidSupplier.findFirst.mockResolvedValue({ ...REAL_SUPPLIER, supplierId: null, supplier: null });

    await expect(subject.create({
      projectCode: 'PMI-001', projectManagementItemId: 'pmi-1', supplierName: '供应商甲',
    }, { companyId: 'company-a' })).rejects.toMatchObject({
      response: { code: 'CONTRACT_SUPPLIER_UNLINKED' },
    });
    expect(prisma.contract.create).not.toHaveBeenCalled();
  });

  it('存在线上项目但尚无中标或通知书时不得提前生成 offline 合同', async () => {
    const { subject, prisma } = createSubject();
    prisma.bidEvaluationResult.findFirst.mockResolvedValue(null);
    prisma.awardLetterDelivery.findFirst.mockResolvedValue(null);

    await expect(subject.create({
      projectCode: 'PMI-001', projectManagementItemId: 'pmi-1', supplierName: '供应商甲',
    }, { companyId: 'company-a' })).rejects.toMatchObject({
      response: { code: 'CONTRACT_AWARD_NOT_FOUND' },
    });
    expect(prisma.contract.create).not.toHaveBeenCalled();
  });

  it('明确无线上 BidProject 的本公司台账项才允许线下合同', async () => {
    const { subject, prisma } = createSubject();
    prisma.bidProject.findFirst.mockResolvedValue(null);

    await expect(subject.create({
      projectCode: 'OFFLINE-001', projectManagementItemId: 'pmi-1', supplierName: '线下供应商',
    }, { companyId: 'company-a' })).resolves.toMatchObject({
      projectId: null,
      supplierId: expect.stringMatching(/^offline-/),
    });
    expect(prisma.bidEvaluationResult.findFirst).not.toHaveBeenCalled();
  });

  it('伪造跨公司 PMI 不得被当作线下项目绕过', async () => {
    const { subject, prisma } = createSubject();
    prisma.projectManagementItem.findFirst.mockResolvedValue(null);

    await expect(subject.create({
      projectCode: 'FOREIGN-001', projectManagementItemId: 'pmi-company-b', supplierName: '供应商甲',
    }, { companyId: 'company-a' })).rejects.toMatchObject({ response: { code: 'PROJECT_NOT_FOUND' } });
    expect(prisma.bidProject.findFirst).not.toHaveBeenCalled();
    expect(prisma.contract.create).not.toHaveBeenCalled();
  });

  it('显式 projectId 不属于当前公司/PMI 时不得持久化悬空关联', async () => {
    const { subject, prisma } = createSubject();
    prisma.bidProject.findFirst.mockResolvedValue(null);

    await expect(subject.create({
      projectId: 'bid-project-company-b',
      projectCode: 'PMI-001',
      projectManagementItemId: 'pmi-1',
      supplierName: '供应商甲',
    }, { companyId: 'company-a' })).rejects.toMatchObject({ response: { code: 'PROJECT_NOT_FOUND' } });
    expect(prisma.bidProject.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'bid-project-company-b', projectManagementItemId: 'pmi-1', companyId: 'company-a',
      },
    }));
    expect(prisma.contract.create).not.toHaveBeenCalled();
  });

  it('3005 创建的线上合同可被同一 Supplier.id 的 3004 列表与履约证明链发现', async () => {
    const { subject } = createSubject();
    const created = await subject.create({
      projectCode: 'PMI-001', projectManagementItemId: 'pmi-1', supplierName: '供应商甲',
    }, { companyId: 'company-a' });
    const signedContract = {
      ...created,
      status: 'signed',
      signedAssetId: 'signed-file',
      fulfillments: [{ id: 'fulfillment-1', contractId: created.id, status: 'pending', proofAssetId: null }],
    };
    const portalPrisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'supplier-real-1' }) },
      contract: {
        findMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(
          where.supplierId === signedContract.supplierId ? [signedContract] : [],
        )),
        findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(
          where.id === signedContract.id && where.supplierId === signedContract.supplierId
            ? signedContract
            : null,
        )),
      },
      contractFulfillment: {
        findFirst: jest.fn().mockResolvedValue(signedContract.fulfillments[0]),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ ...signedContract.fulfillments[0], proofAssetId: 'proof-1' }),
      },
      fileAsset: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'proof-1', uploaderId: 'supplier-user-1', category: 'contract_document',
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    portalPrisma.$transaction = jest.fn(async (callback: (tx: any) => unknown) => callback(portalPrisma));

    const controller = Object.create(SupplierPortalController.prototype) as SupplierPortalController;
    (controller as any).prisma = portalPrisma;
    await expect((controller as any).myContracts({ user: { sub: 'supplier-user-1' } }))
      .resolves.toEqual([signedContract]);
    expect(portalPrisma.contract.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        supplierId: 'supplier-real-1',
        status: { in: ['approved_for_signing', 'signed', 'performing', 'accepted', 'terminated'] },
      },
    }));

    const portalService = Object.create(SupplierPortalService.prototype) as SupplierPortalService;
    (portalService as any).prisma = portalPrisma;
    await expect((portalService as any).attachContractFulfillmentProof(
      'supplier-user-1', created.id, 'fulfillment-1', 'proof-1',
    )).resolves.toMatchObject({ proofAssetId: 'proof-1' });
    expect(portalPrisma.contract.findFirst).toHaveBeenCalledWith({
      where: { id: created.id, supplierId: 'supplier-real-1' },
      select: { id: true, status: true, signedAssetId: true },
    });
  });
});

describe('ContractService — 查询富化履约证明元数据', () => {
  const row = {
    id: 'contract-1',
    signedAssetId: 'asset-signed',
    fulfillments: [
      { id: 'fulfillment-1', proofAssetId: 'asset-1' },
      { id: 'fulfillment-2', proofAssetId: null },
    ],
  };
  const asset = {
    id: 'asset-1',
    originalName: '验收报告.pdf',
    size: 2048,
    sha256: 'abc123',
    mimeType: 'application/pdf',
    createdAt: new Date('2026-09-03T09:00:00.000Z'),
  };
  const signedAsset = {
    id: 'asset-signed',
    originalName: '合同签署版.pdf',
    size: 4096,
    sha256: 'signed123',
    mimeType: 'application/pdf',
    createdAt: new Date('2026-09-03T08:00:00.000Z'),
  };

  const createSubject = () => {
    const prisma: any = {
      contract: {
        findMany: jest.fn().mockResolvedValue([row]),
        findFirst: jest.fn().mockResolvedValue(row),
        findUnique: jest.fn().mockResolvedValue(row),
      },
      fileAsset: { findMany: jest.fn().mockResolvedValue([asset, signedAsset]) },
    };
    const subject = Object.create(ContractService.prototype) as ContractService;
    (subject as any).prisma = prisma;
    return { subject, prisma };
  };

  it('list 与 by-project 批量返回 proofAsset 元数据且无证明时为 null', async () => {
    const { subject, prisma } = createSubject();

    const listed = await subject.list({});
    const byProject = await subject.listByProject({ projectCode: 'P-1' });

    for (const result of [listed, byProject]) {
      expect(result[0].signedAsset).toEqual(signedAsset);
      expect(result[0].fulfillments).toEqual([
        expect.objectContaining({ id: 'fulfillment-1', proofAsset: asset }),
        expect.objectContaining({ id: 'fulfillment-2', proofAsset: null }),
      ]);
    }
    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['asset-1', 'asset-signed'] } },
      select: {
        id: true, originalName: true, size: true, sha256: true, mimeType: true, createdAt: true,
      },
    });
  });

  it('get 返回 proofAsset 元数据', async () => {
    const { subject, prisma } = createSubject();

    await expect((subject as any).get('contract-1', { companyId: 'company-a' })).resolves.toEqual(expect.objectContaining({
      signedAsset,
      fulfillments: [
        expect.objectContaining({ id: 'fulfillment-1', proofAsset: asset }),
        expect.objectContaining({ id: 'fulfillment-2', proofAsset: null }),
      ],
    }));
    expect(prisma.contract.findFirst).toHaveBeenCalledWith({
      where: { id: 'contract-1', companyId: 'company-a' },
      include: { fulfillments: { orderBy: { createdAt: 'desc' } } },
    });
  });

  it('list 与 by-project 在数据库查询阶段限定公司', async () => {
    const { subject, prisma } = createSubject();

    await subject.list({ status: 'signed', companyId: 'company-a' });
    await subject.listByProject({ projectCode: 'P-1', companyId: 'company-a' } as any);

    expect(prisma.contract.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { status: 'signed', companyId: 'company-a' },
    }));
    expect(prisma.contract.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { projectCode: 'P-1', companyId: 'company-a' },
    }));
  });

  it('列表可按内审通过待签署状态筛选', async () => {
    const { subject, prisma } = createSubject();

    await subject.list({ status: 'approved_for_signing', companyId: 'company-a' });

    expect(prisma.contract.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'approved_for_signing', companyId: 'company-a' },
    }));
  });

  it('跨公司 id 详情不返回合同及 proofAsset 元数据', async () => {
    const { subject, prisma } = createSubject();
    prisma.contract.findFirst.mockResolvedValue(null);

    await expect((subject as any).get('contract-b', { companyId: 'company-a' }))
      .rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    expect(prisma.fileAsset.findMany).not.toHaveBeenCalled();
  });
});

describe('SupplierPortalController — 供应商合同发布边界', () => {
  it('仅返回待签署及后续状态，并在 Prisma select 层排除采购人内部字段', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'supplier-real-1' }) },
      contract: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const controller = Object.create(SupplierPortalController.prototype) as SupplierPortalController;
    (controller as any).prisma = prisma;

    await (controller as any).myContracts({ user: { sub: 'supplier-user-1' } });

    expect(prisma.contract.findMany).toHaveBeenCalledTimes(1);
    const query = prisma.contract.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      supplierId: 'supplier-real-1',
      status: { in: ['approved_for_signing', 'signed', 'performing', 'accepted', 'terminated'] },
    });
    expect(query.select).toEqual(expect.objectContaining({
      id: true,
      contractCode: true,
      projectCode: true,
      contractType: true,
      status: true,
      amount: true,
      signedAt: true,
      signedAssetId: true,
      createdAt: true,
      fulfillments: expect.any(Object),
    }));
    for (const internalField of ['reviewNote', 'consistencyResult', 'keyTerms', 'draftAssetId']) {
      expect(query.select).not.toHaveProperty(internalField);
    }
  });

  it('待签署存量脏数据即使已有 signedAssetId 也不向供应商泄露签署件', async () => {
    const prisma: any = {
      supplier: { findUnique: jest.fn().mockResolvedValue({ id: 'supplier-real-1' }) },
      contract: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'legacy-contract',
          contractCode: 'HT-LEGACY',
          projectCode: 'P-1',
          contractType: 'standard',
          status: 'approved_for_signing',
          amount: null,
          signedAt: null,
          signedAssetId: 'legacy-signed-file',
          createdAt: new Date(),
          fulfillments: [{ id: 'legacy-internal-node', proofAssetId: 'legacy-proof' }],
        }]),
      },
    };
    const controller = Object.create(SupplierPortalController.prototype) as SupplierPortalController;
    (controller as any).prisma = prisma;

    const [contract] = await (controller as any).myContracts({ user: { sub: 'supplier-user-1' } });

    expect(contract).toMatchObject({
      status: 'approved_for_signing', signedAt: null, signedAssetId: null, fulfillments: [],
    });
  });
});

describe('ContractController — 合同关键动作透传 actor 与公司范围', () => {
  const request = { user: { sub: 'user-1', username: '经办人', role: 'staff' } };
  const companyScope = {
    resolveScope: jest.fn().mockResolvedValue({ all: false, companyId: 'company-a' }),
    filter: jest.fn().mockReturnValue({ companyId: 'company-a' }),
  };

  beforeEach(() => jest.clearAllMocks());

  it('list/by-project/get 均在查询层透传公司范围', async () => {
    const service = {
      list: jest.fn().mockResolvedValue([]),
      listByProject: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue({}),
    };
    const controller = new ContractController(service as any, companyScope as any);

    await (controller as any).list(request, 'signed', 'ABC', 'company-forged');
    await (controller as any).byProject(request, 'pmi-1', undefined, 'company-forged');
    await (controller as any).get('contract-1', request);

    expect(companyScope.resolveScope).toHaveBeenCalledWith(request.user, 'company-forged');
    expect(service.list).toHaveBeenCalledWith({ status: 'signed', q: 'ABC', companyId: 'company-a' });
    expect(service.listByProject).toHaveBeenCalledWith({
      projectManagementItemId: 'pmi-1', projectCode: undefined, companyId: 'company-a',
    });
    expect(service.get).toHaveBeenCalledWith('contract-1', { companyId: 'company-a' });
  });

  it('sign/updateFulfillment/accept 均透传当前登录操作者及公司范围', async () => {
    const service = {
      sign: jest.fn().mockResolvedValue({}),
      updateFulfillment: jest.fn().mockResolvedValue({}),
      accept: jest.fn().mockResolvedValue({}),
    };
    const controller = new ContractController(service as any, companyScope as any);
    const actor = { userId: 'user-1', username: '经办人', companyId: 'company-a' };

    await (controller as any).sign('contract-1', { signedAssetId: 'asset-1' }, request);
    await (controller as any).updateFulfillment(
      'contract-1', 'fulfillment-1', { status: 'done', proofAssetId: 'asset-1' }, request,
    );
    await (controller as any).accept('contract-1', { proofAssetId: 'asset-1' }, request);

    expect(service.sign).toHaveBeenCalledWith('contract-1', { signedAssetId: 'asset-1' }, actor);
    expect(service.updateFulfillment).toHaveBeenCalledWith(
      'contract-1', 'fulfillment-1', { status: 'done', proofAssetId: 'asset-1' }, actor,
    );
    expect(service.accept).toHaveBeenCalledWith('contract-1', { proofAssetId: 'asset-1' }, actor);
  });

  it('登记履约节点由单一 service 事务原子完成，不先盲更新状态', async () => {
    const service = {
      startPerforming: jest.fn(),
      addFulfillment: jest.fn().mockResolvedValue({}),
    };
    const controller = new ContractController(service as any, companyScope as any);

    await (controller as any).addFulfillment(
      'contract-1', { type: 'delivery', title: '到货' }, request,
    );

    expect(service.startPerforming).not.toHaveBeenCalled();
    expect(service.addFulfillment).toHaveBeenCalledWith(
      'contract-1', { type: 'delivery', title: '到货' },
      { userId: 'user-1', username: '经办人', companyId: 'company-a' },
    );
  });

  it('一致性、内审、公告、草稿和终止端点也不能绕过公司范围', async () => {
    const service = {
      runConsistency: jest.fn().mockResolvedValue({}),
      submitReview: jest.fn().mockResolvedValue({}),
      review: jest.fn().mockResolvedValue({}),
      publishContractNotice: jest.fn().mockResolvedValue({}),
      generateDraftDocx: jest.fn().mockResolvedValue({}),
      terminate: jest.fn().mockResolvedValue({}),
    };
    const controller = new ContractController(service as any, companyScope as any);
    const actor = { userId: 'user-1', username: '经办人', companyId: 'company-a' };

    await (controller as any).consistency('contract-1', request);
    await (controller as any).submitReview('contract-1', request);
    await (controller as any).review('contract-1', { approved: true }, request);
    await (controller as any).contractNotice('contract-1', request);
    await (controller as any).draftDocx('contract-1', request);
    await (controller as any).terminate('contract-1', { reason: '协商终止' }, request);

    expect(service.runConsistency).toHaveBeenCalledWith('contract-1', { companyId: 'company-a' });
    expect(service.submitReview).toHaveBeenCalledWith('contract-1', actor);
    expect(service.review).toHaveBeenCalledWith('contract-1', { approved: true }, actor);
    expect(service.publishContractNotice).toHaveBeenCalledWith('contract-1', { companyId: 'company-a' });
    expect(service.generateDraftDocx).toHaveBeenCalledWith('contract-1', 'user-1', { companyId: 'company-a' });
    expect(service.terminate).toHaveBeenCalledWith('contract-1', '协商终止', actor);
  });
});
