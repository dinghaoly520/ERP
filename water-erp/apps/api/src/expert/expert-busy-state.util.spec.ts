import {
  deriveBusySets,
  busyStateLabel,
  busyStateOf,
  deriveBusyCounts,
  lifecycleStateOf,
  BusyRow,
} from './expert-busy-state.util';

/** 库况四态唯一算法源（2026-11-19 ⑵收口）——本套锁定优先级链/降级/分母口径/钳 0 防线。 */
describe('expert-busy-state.util', () => {
  describe('deriveBusySets：优先级链 正在评标＞正选在途＞候补待命', () => {
    it('同人正选+候补双身份只计正选（assigned+alternate 不超 union）', () => {
      const rows: BusyRow[] = [
        { userId: 'e1', expertRole: '正选', project: { stage: 'SUBMIT' } },
        { userId: 'e1', expertRole: '候补', project: { stage: 'OPENING' } },
      ];
      const s = deriveBusySets(rows);
      expect(s.assigned.has('e1')).toBe(true);
      expect(s.alternate.has('e1')).toBe(false); // 正选降级候补
      expect(s.union.size).toBe(1);
    });

    it('同人正在评标 supersede 正选/候补（多在途行只数一次且归最高位）', () => {
      const rows: BusyRow[] = [
        { userId: 'e2', expertRole: '正选', project: { stage: 'EVALUATING' } },
        { userId: 'e2', expertRole: '候补', project: { stage: 'SUBMIT' } },
      ];
      const s = deriveBusySets(rows);
      expect(s.evaluating.has('e2')).toBe(true);
      expect(s.assigned.has('e2')).toBe(false);
      expect(s.alternate.has('e2')).toBe(false);
    });

    it('无在途行 → 三集皆空', () => {
      const s = deriveBusySets([]);
      expect(s.union.size).toBe(0);
      expect(busyStateLabel('anyone', s)).toBe('空闲');
    });
  });

  describe('busyStateOf：单专家四态标签（终局阶段行内部过滤）', () => {
    it('ARCHIVED/ABORTED 行不占状态——终局后回到空闲', () => {
      expect(busyStateOf([
        { expertRole: '正选', project: { stage: 'ARCHIVED' } },
        { expertRole: '候补', project: { stage: 'ABORTED' } },
      ])).toBe('空闲');
    });

    it('在途正选 → 已被抽取；在途候补 → 候补待命；评标 → 正在评标', () => {
      expect(busyStateOf([{ expertRole: '正选', project: { stage: 'DOWNLOAD' } }])).toBe('已被抽取');
      expect(busyStateOf([{ expertRole: '候补', project: { stage: 'OPENING' } }])).toBe('候补待命');
      expect(busyStateOf([{ expertRole: '候补', project: { stage: 'EVALUATING' } }])).toBe('正在评标');
    });
  });

  describe('deriveBusyCounts：分母停用排除 + 两侧同人口 + idle 钳 0', () => {
    const mkPrisma = (opts: {
      availabilityGroups: Array<{ availability: string; _count: number }>;
      busyRows: BusyRow[];
    }) => ({
      expertProfile: {
        groupBy: jest.fn().mockImplementation(({ where }: { where?: { availability?: { not?: string } } }) =>
          Promise.resolve(
            where?.availability?.not
              ? opts.availabilityGroups.filter((g) => g.availability !== where.availability!.not)
              : opts.availabilityGroups,
          ),
        ),
      },
      bidExpert: {
        findMany: jest.fn().mockResolvedValue(opts.busyRows),
      },
    });

    it('停用组不入分母；idle = 非停用人口 − 在途并集；busy 四值互斥', async () => {
      const prisma = mkPrisma({
        availabilityGroups: [
          { availability: '可用', _count: 4 },
          { availability: '占用', _count: 2 },
          { availability: '停用', _count: 3 }, // 临时需求方代表——不虚增空闲
        ],
        busyRows: [
          { userId: 'e1', expertRole: '正选', project: { stage: 'SUBMIT' } },
          { userId: 'e2', expertRole: '候补', project: { stage: 'EVALUATING' } },
        ],
      });
      const r = await deriveBusyCounts(prisma as never, { role: 'bid_expert' });
      expect(r.inLibraryActive).toBe(6);
      expect(r.idle).toBe(4);
      expect(r.occupied).toBe(2);
      expect(r).toMatchObject({ assigned: 1, evaluating: 1, alternate: 0 });
    });

    it('在途人数超分母 → idle 钳 0 不出负（Math.max 防线）', async () => {
      const prisma = mkPrisma({
        availabilityGroups: [{ availability: '可用', _count: 1 }],
        busyRows: [
          { userId: 'e1', expertRole: '正选', project: { stage: 'SUBMIT' } },
          { userId: 'e2', expertRole: '候补', project: { stage: 'OPENING' } },
        ],
      });
      const r = await deriveBusyCounts(prisma as never, {});
      expect(r.idle).toBe(0);
      expect(r.occupied).toBe(2);
    });

    it('在途查询两侧同人口过滤（userWhere 透传 + expertProfile 挂 ACTIVE/非停用）', async () => {
      const prisma = mkPrisma({ availabilityGroups: [], busyRows: [] });
      await deriveBusyCounts(prisma as never, { role: 'bid_expert', isActive: true, companyId: 'co-1' });
      const call = (prisma.bidExpert.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.invitationStatus).toEqual({ not: 'declined' });
      expect(call.where.project.stage.in).toEqual(['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING']);
      expect(call.where.user).toMatchObject({
        role: 'bid_expert',
        isActive: true,
        companyId: 'co-1',
        expertProfile: { entryStatus: 'ACTIVE', availability: { not: '停用' } },
      });
      const gCall = (prisma.expertProfile.groupBy as jest.Mock).mock.calls[0][0];
      expect(gCall.where).toMatchObject({
        entryStatus: 'ACTIVE',
        availability: { not: '停用' },
        user: { role: 'bid_expert', isActive: true, companyId: 'co-1' },
      });
    });
  });
});

describe('lifecycleStateOf（E5/E7 2026-11-19：池外呈现态单源——已退库＞已停用＞四态）', () => {
  const inflight = [{ expertRole: '正选' as const, project: { stage: 'SUBMIT' as const } }];

  it('RETIRED 优先（退库正门并存形态：RETIRED+停用 → 已退库）', () => {
    expect(lifecycleStateOf({ entryStatus: 'RETIRED', availability: '停用' }, inflight)).toBe('已退库');
  });
  it('停用-ACTIVE（临时需求代表等）+ 在途绑定 → 已停用（不冒充已被抽取）', () => {
    expect(lifecycleStateOf({ entryStatus: 'ACTIVE', availability: '停用' }, inflight)).toBe('已停用');
  });
  it('ACTIVE+非停用 → 四态穿透（SUBMIT 正选在途 → 已被抽取）', () => {
    expect(lifecycleStateOf({ entryStatus: 'ACTIVE', availability: '可用' }, inflight)).toBe('已被抽取');
    expect(lifecycleStateOf({ entryStatus: 'ACTIVE', availability: '可用' }, [])).toBe('空闲');
  });
  it('字段缺省（旧行形态/mock 未带）→ 落四态（与 busyStateOf 等价，不崩）', () => {
    expect(lifecycleStateOf({}, [])).toBe('空闲');
    expect(lifecycleStateOf({ entryStatus: null, availability: null }, inflight)).toBe('已被抽取');
  });
});

describe('deriveBusyCounts E10 入口守卫（userWhere 禁传 expertProfile——spread 覆盖陷阱双闸）', () => {
  // 本地工厂（mkPrisma 作用域在上一个 describe 内，此处自建轻量版——守卫用例只需断言零查询）
  const mkGuardPrisma = () => ({
    expertProfile: { groupBy: jest.fn().mockResolvedValue([]) },
    bidExpert: { findMany: jest.fn().mockResolvedValue([]) },
  });

  it('传 expertProfile 键 → 抛 EXPERT_PROFILE_KEY_FORBIDDEN，且入口即炸零查询（消息文案是引导面一并锁）', async () => {
    const prisma = mkGuardPrisma();
    // 参数类型已 Omit<…,'expertProfile'>——类型只拦字面量直写，spread/动态构造/as 断言全绕过，
    // 故须 cast 构造恶意入参；运行时守卫正是为这些类型盲区存在的第二道闸
    const malicious = { role: 'bid_expert', expertProfile: { specialty: '水文' } } as never;
    await expect(deriveBusyCounts(prisma as never, malicious)).rejects.toThrow(/EXPERT_PROFILE_KEY_FORBIDDEN|单源|扩展本函数/);
    expect(prisma.expertProfile.groupBy).not.toHaveBeenCalled(); // 入口守卫（非查询后校验）
    expect(prisma.bidExpert.findMany).not.toHaveBeenCalled();
  });

  it('null 是有语义的 Prisma 过滤（关系为空）——同样拒绝（!== undefined 判据，truthy 会放行 null 造病理态）', async () => {
    const prisma = mkGuardPrisma();
    const maliciousNull = { role: 'bid_expert', expertProfile: null } as never;
    await expect(deriveBusyCounts(prisma as never, maliciousNull)).rejects.toThrow('EXPERT_PROFILE_KEY_FORBIDDEN');
  });

  it('Omit 类型闸测试锁（评审低置信加固）：字面量直传 expertProfile 编译期即拒——@ts-expect-error 回退 Omit 后变「未使用指令」红', async () => {
    const prisma = mkGuardPrisma();
    // 不加 as never：类型层由 Omit 拦（ts-jest 开诊断）；运行时守卫接住 cast 绕过者——双闸各锁各的
    // @ts-expect-error Omit<UserWhereInput,'expertProfile'> 不含 expertProfile 键——回退 Omit 本行不再报错、此指令变 unused 即红
    await expect(deriveBusyCounts(prisma as never, { role: 'bid_expert', expertProfile: { specialty: '水文' } })).rejects.toThrow('EXPERT_PROFILE_KEY_FORBIDDEN');
  });

  it('显式 undefined 与键缺席等价（无操作形态放行）', async () => {
    const prisma = mkGuardPrisma();
    prisma.expertProfile.groupBy.mockResolvedValue([{ availability: '可用', _count: 3 }]);
    const r = await deriveBusyCounts(prisma as never, { role: 'bid_expert', expertProfile: undefined } as never);
    expect(r.inLibraryActive).toBe(3);
  });
});
