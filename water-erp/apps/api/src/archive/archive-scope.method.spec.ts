// apps/api/src/archive/archive-scope.method.spec.ts
import { ARCHIVE_SCOPE_SEED } from './archive-scope.seed';
import { ArchiveScopeService, scopeItemAppliesToMethod } from './archive-scope.service';

/**
 * bug#84（2026-11-12）：归档范围按采购方式条件化锁定 spec。
 * 旧行为（红）：谈判/询比等项目套 DA/T103 招标全量 35 项——「招标公告 缺件」「招标文件 缺件」
 * 等招标专属文书误导展示（czy 10-20 实录：谈判项目 SWHI-TP-2026102003）。
 * 邀请招标/公开招标保留法定名「招标文件」（2026-11-03 裁定 #3）；非招标方式对应
 * 「采购公告/采购邀请书/采购文件」（谈判发公告、直接采购走邀请——2026-11-12 流程互换裁定）。
 */

describe('scopeItemAppliesToMethod · 方式适用矩阵', () => {
  it('招标专属文书对非招标方式不适用', () => {
    for (const name of ['招标公告', '招标文件', '投标邀请书', '资格预审公告', '招标文件澄清与修改']) {
      expect(scopeItemAppliesToMethod(name, '谈判采购')).toBe(false);
      expect(scopeItemAppliesToMethod(name, '询比采购')).toBe(false);
      expect(scopeItemAppliesToMethod(name, '竞价采购')).toBe(false);
    }
    expect(scopeItemAppliesToMethod('采购邀请书', '谈判采购')).toBe(false);
    expect(scopeItemAppliesToMethod('采购公告', '邀请招标')).toBe(false);
    expect(scopeItemAppliesToMethod('采购文件', '邀请招标')).toBe(false);
  });

  it('招标方式保留法定名——招标文件/投标邀请书对邀请招标适用；公开招标得招标公告', () => {
    expect(scopeItemAppliesToMethod('招标文件', '邀请招标')).toBe(true);
    expect(scopeItemAppliesToMethod('招标文件', '公开招标')).toBe(true);
    expect(scopeItemAppliesToMethod('投标邀请书', '邀请招标')).toBe(true);
    expect(scopeItemAppliesToMethod('招标公告', '公开招标')).toBe(true);
    expect(scopeItemAppliesToMethod('招标公告', '邀请招标')).toBe(false); // 邀请招标不发公告
  });

  it('非招标方式各得其所——谈判/询比/竞价发采购公告，直接采购走采购邀请书', () => {
    for (const m of ['谈判采购', '询比采购', '竞价采购']) {
      expect(scopeItemAppliesToMethod('采购公告', m)).toBe(true);
      expect(scopeItemAppliesToMethod('采购文件', m)).toBe(true);
      expect(scopeItemAppliesToMethod('采购邀请书', m)).toBe(false);
    }
    expect(scopeItemAppliesToMethod('采购邀请书', '直接采购')).toBe(true);
    expect(scopeItemAppliesToMethod('采购文件', '直接采购')).toBe(true);
    expect(scopeItemAppliesToMethod('采购公告', '直接采购')).toBe(false); // 直接采购走邀请不发公告
  });

  it('通用项（未入矩阵）与空方式全适用——存量数据兜底', () => {
    expect(scopeItemAppliesToMethod('投标文件', '谈判采购')).toBe(true);
    expect(scopeItemAppliesToMethod('评标报告', '直接采购')).toBe(true);
    expect(scopeItemAppliesToMethod('招标方案', null)).toBe(true);
    expect(scopeItemAppliesToMethod('招标公告', undefined)).toBe(true);
  });

  it('矩阵与 seed 条目对齐——矩阵键必是 seed materialName；新增采购三件在 seed 内', () => {
    const seedNames = new Set(ARCHIVE_SCOPE_SEED.map((s) => s.materialName));
    for (const m of ['采购公告', '采购邀请书', '采购文件']) expect(seedNames.has(m)).toBe(true);
    // 矩阵里的每个键都能在 seed 找到（防名字漂移后过滤失效）
    const matrixKeys = [
      '招标公告', '资格预审公告', '投标邀请书', '招标文件', '资格预审文件', '现场踏勘通知',
      '招标文件澄清与修改', '资格预审申请文件', '资格审查委员会组建文件', '通过资格预审申请人名单',
      '未通过资格预审申请人名单', '资格预审通过通知书', '资格预审结果通知书',
      '采购公告', '采购邀请书', '采购文件',
    ];
    for (const k of matrixKeys) expect(seedNames.has(k)).toBe(true);
  });
});

describe('ArchiveScopeService.snapshot · 按方式过滤（集成）', () => {
  function makeService(pmi: { procurementMethod: string | null }) {
    const prisma: any = {
      archiveScopeItem: {
        count: jest.fn().mockResolvedValue(999), // 快路径（跳过 upsert 播种）
        findUnique: jest.fn().mockResolvedValue(null), // syncFileCategories 无行可同步
        findMany: jest.fn().mockResolvedValue(
          ARCHIVE_SCOPE_SEED.map((s, i) => ({
            id: `asi-${i}`, code: s.code, stage: s.stage, materialName: s.materialName,
            sourceType: s.sourceType, stageKeys: s.stageKeys ?? [], fileCategories: s.fileCategories ?? [],
            isRequired: s.isRequired ?? false, sortOrder: i,
          })),
        ),
      },
      projectManagementItem: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'pmi1', title: '测试', projectCode: 'T-1', procurementMethod: pmi.procurementMethod,
          requesterName: '测试', requesterDepartment: '采购中心', awardedSupplier: null,
          stages: [], bidProjects: [],
        }),
      },
      archiveMetadata: { upsert: jest.fn() },
    };
    return { prisma, svc: new ArchiveScopeService(prisma) };
  }

  it('谈判项目：无「招标公告/招标文件」行，有「采购公告/采购文件」行', async () => {
    const { svc } = makeService({ procurementMethod: '谈判采购' });
    const r = await svc.snapshot('pmi1', { enrichMeta: false });
    const names = r.rows.map((x) => x.materialName);
    expect(names).not.toContain('招标公告');
    expect(names).not.toContain('招标文件');
    expect(names).toContain('采购公告');
    expect(names).toContain('采购文件');
  });

  it('邀请招标项目：保留法定名「招标文件」与「投标邀请书」，无采购侧条目', async () => {
    const { svc } = makeService({ procurementMethod: '邀请招标' });
    const r = await svc.snapshot('pmi1', { enrichMeta: false });
    const names = r.rows.map((x) => x.materialName);
    expect(names).toContain('招标文件');
    expect(names).toContain('投标邀请书');
    expect(names).not.toContain('采购文件');
    expect(names).not.toContain('采购公告');
  });

  it('直接采购项目：得「采购邀请书/采购文件」，无公告类与招标类', async () => {
    const { svc } = makeService({ procurementMethod: '直接采购' });
    const r = await svc.snapshot('pmi1', { enrichMeta: false });
    const names = r.rows.map((x) => x.materialName);
    expect(names).toContain('采购邀请书');
    expect(names).toContain('采购文件');
    expect(names).not.toContain('采购公告');
    expect(names).not.toContain('招标文件');
  });
});

describe('ArchiveScopeService.checkStageGate · 闸门同口径过滤', () => {
  function makeService(pmi: { procurementMethod: string | null }) {
    // 镜像 TENDER_DOCUMENT / PUBLIC_ANNOUNCEMENT 阶段的真实必选行集（评审 B1：防 mock 工件失真）
    const requiredRows = [
      { code: '2.1', materialName: '招标公告', sourceType: 'attachment', isRequired: true },
      { code: '2N.1', materialName: '采购公告', sourceType: 'attachment', isRequired: true },
      { code: '2.4', materialName: '招标文件', sourceType: 'attachment', isRequired: true },
      { code: '2N.3', materialName: '采购文件', sourceType: 'attachment', isRequired: true },
    ];
    const prisma: any = {
      archiveScopeItem: { count: jest.fn().mockResolvedValue(999), findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue(requiredRows) },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue({ procurementMethod: pmi.procurementMethod }) },
      attachment: { count: jest.fn().mockResolvedValue(0) },
    };
    return { prisma, svc: new ArchiveScopeService(prisma) };
  }

  it('谈判项目 TENDER_DOCUMENT 阶段闸门：提示「采购文件」而非「招标文件」缺件', async () => {
    const { svc } = makeService({ procurementMethod: '谈判采购' });
    const missing = await svc.checkStageGate('pmi1', 'TENDER_DOCUMENT');
    expect(missing.some((m) => m.includes('2N.3 采购文件'))).toBe(true);
    expect(missing.some((m) => m.includes('2.4 招标文件'))).toBe(false);
  });

  it('公开招标项目：闸门提示法定名「招标公告」；邀请招标不发公告（流程互换裁定）不提示', async () => {
    const pub = makeService({ procurementMethod: '公开招标' });
    const missingPub = await pub.svc.checkStageGate('pmi1', 'PUBLIC_ANNOUNCEMENT');
    expect(missingPub.some((m) => m.includes('招标公告'))).toBe(true);
    expect(missingPub.some((m) => m.includes('采购公告'))).toBe(false);

    const inv = makeService({ procurementMethod: '邀请招标' });
    const missingInv = await inv.svc.checkStageGate('pmi1', 'PUBLIC_ANNOUNCEMENT');
    expect(missingInv.some((m) => m.includes('招标公告'))).toBe(false);
    expect(missingInv.some((m) => m.includes('采购公告'))).toBe(false);
  });
});
