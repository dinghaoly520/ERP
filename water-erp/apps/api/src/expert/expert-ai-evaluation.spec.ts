import {
  collectExpertFacts,
  buildEvaluationPrompt,
  hasServiceRecord,
  refreshAllExpertAiEvaluations,
} from './expert-ai-evaluation';

/** E5（2026-11-19 第二波）：AI 综合评价的「当前状态」池外优先——已退库/已停用 ＞ 四态派生。
 *  退库专家与停用临时代表（refreshAll 刻意全量遍历、详情仍可看）不再被月度批注
 *  冒充「空闲」，其旧 BidExpert 行挂在活项目上时也不再冒充「正在评标」。
 *  纯函数文件——mock 最小 prisma 形状直调，不依赖 Nest TestingModule。 */

const membershipsInFlight = [
  {
    isLead: false,
    expertRole: '正选',
    invitationStatus: 'confirmed',
    signedIn: true,
    createdAt: new Date('2026-11-01'),
    project: { name: '活项目A', stage: 'EVALUATING' },
  },
];

function makePrisma(overrides: {
  entryStatus?: string;
  availability?: string;
  memberships?: unknown[];
  evaluations?: unknown[];
  invitationLogs?: unknown[];
} = {}) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        displayName: '王退库',
        expertProfile: {
          specialty: '水文',
          title: '高工',
          education: '本科',
          expertLevel: 'B',
          entryStatus: overrides.entryStatus ?? 'ACTIVE',
          availability: overrides.availability ?? '可用',
        },
      }),
      // refreshAll 全量遍历（含 RETIRED——「退库专家详情仍可看」刻意口径）
      findMany: jest.fn().mockResolvedValue([{ id: 'u1' }]),
    },
    bidExpert: {
      findMany: jest.fn().mockResolvedValue(overrides.memberships ?? membershipsInFlight),
    },
    expertEvaluation: {
      findMany: jest.fn().mockResolvedValue(
        overrides.evaluations ?? [{ overallGrade: 'A', comment: '表现优秀', createdAt: new Date('2026-11-02') }],
      ),
    },
    expertInvitationLog: {
      findMany: jest.fn().mockResolvedValue(overrides.invitationLogs ?? []),
    },
    expertProfile: {
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('collectExpertFacts：lifecycleState 池外优先（E5）', () => {
  it('RETIRED 专家 + 在途行 → 已退库（不冒充「正在评标」——票面主场景）', async () => {
    const facts = await collectExpertFacts(makePrisma({ entryStatus: 'RETIRED' }), 'u1');
    expect(facts!.lifecycleState).toBe('已退库');
    const prompt = buildEvaluationPrompt(facts!);
    expect(prompt.user).toContain('当前状态：已退库');
    expect(prompt.user).not.toContain('正在评标');
  });

  it('停用-ACTIVE（临时需求方代表）+ 在途行 → 已停用', async () => {
    const facts = await collectExpertFacts(makePrisma({ availability: '停用' }), 'u1');
    expect(facts!.lifecycleState).toBe('已停用');
    expect(buildEvaluationPrompt(facts!).user).toContain('当前状态：已停用');
    expect(buildEvaluationPrompt(facts!).user).not.toContain('正在评标');
  });

  it('RETIRED + 无在途行 → 已退库（不冒充「空闲」）', async () => {
    const facts = await collectExpertFacts(makePrisma({ entryStatus: 'RETIRED', memberships: [] }), 'u1');
    expect(facts!.lifecycleState).toBe('已退库');
    expect(buildEvaluationPrompt(facts!).user).not.toMatch(/当前状态：空闲/);
  });

  it('回归：ACTIVE+非停用 + EVALUATING 在途 → 正在评标（四态括注保留）', async () => {
    const facts = await collectExpertFacts(makePrisma(), 'u1');
    expect(facts!.lifecycleState).toBe('正在评标');
    const prompt = buildEvaluationPrompt(facts!);
    expect(prompt.user).toContain('当前状态：正在评标');
    expect(prompt.user).toContain('四态：正在评标/已被抽取/候补待命/空闲');
  });

  it('回归：ACTIVE+非停用 + 无在途 → 空闲', async () => {
    const facts = await collectExpertFacts(makePrisma({ memberships: [] }), 'u1');
    expect(facts!.lifecycleState).toBe('空闲');
  });

  it('hasServiceRecord：仅有参评记录即算有据（退库专家历史档案仍生成批注）', async () => {
    const facts = await collectExpertFacts(makePrisma({ entryStatus: 'RETIRED' }), 'u1');
    expect(hasServiceRecord(facts!)).toBe(true);
  });
});

describe('refreshAllExpertAiEvaluations：退库专家走池外状态 prompt（E5 端到端）', () => {
  it('全量遍历含 RETIRED——LLM 收到的 prompt 含「已退库」且落库', async () => {
    const prisma = makePrisma({ entryStatus: 'RETIRED' });
    const llm = { chat: jest.fn().mockResolvedValue('该专家已退出专家库，历史参评记录显示履职良好。') };
    const stats = await refreshAllExpertAiEvaluations(prisma, llm);
    expect(stats).toEqual({ total: 1, generated: 1, skipped: 0 });
    const userPrompt = llm.chat.mock.calls[0][1];
    expect(userPrompt).toContain('当前状态：已退库');
    expect(userPrompt).not.toContain('当前状态：空闲');
    expect(prisma.expertProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1' },
      data: expect.objectContaining({ aiEvaluation: expect.stringContaining('退出专家库') }),
    }));
  });
});
