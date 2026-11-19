import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantTool, AssistantToolCtx, ToolResult } from './assistant-tool';
import { toolCompanyWhere } from './company-filter';
import { deriveBusyCounts, busyStateOf, IN_FLIGHT_STAGES, BusyStateLabel } from '../../expert/expert-busy-state.util';

@Injectable()
export class ExpertTool implements AssistantTool {
  name = 'expert';
  description =
    '查询专家库统计/列表/专业方向分布/库况状态/条件检索专家。args: { action: "stats"|"list"|"by_specialty"|"search", specialty?, title?, employer?, keyword?, availability?, limit? }——stats=多维度结构（专业/部门或公司/职称/评审负荷四分布+总览：leader/staff 单公司视野=部门维度、admin/总数据=公司维度），「专家分布/专家库结构」类问题用 stats 并覆盖全部维度。用户用自然语言找专家（如"找3个做过水利的高工"）时，用 action:"search"，把专业填 specialty、职称填 title、单位填 employer、姓名填 keyword、按当前库况筛人填 availability="空闲"（也可填"正在评标"/"已被抽取"/"候补待命"；"可用"视同"空闲"）——库况按在途项目实时派生，非档案登记值。';

  constructor(private readonly prisma: PrismaService) {}

  async execute(args: Record<string, unknown> = {}, ctx?: AssistantToolCtx): Promise<ToolResult> {
    const action = (args.action as string) || 'stats';
    const specialty = args.specialty as string | undefined;
    const limit = (args.limit as number) || 10;
    // 专家归属不在 ExpertProfile 本表，落 User.companyId（2026-09-24）——过滤经 user 关系嵌套
    const companyWhere = toolCompanyWhere(ctx);

    // 条件检索（自然语言查专家库的落点）：各条件可组合，contains 模糊匹配
    if (action === 'search') {
      const kw = args.keyword as string | undefined;
      const title = args.title as string | undefined;
      const employer = args.employer as string | undefined;
      const availability = args.availability as string | undefined;
      // E4（2026-11-19 第一波）：availability 参数改派生语义——DB 侧不再按镜像列过滤（镜像「可用」
      // 虚含在途专家、与同卡状态列自相矛盾）。「可用」（旧词）视同「空闲」；其余按四态标签匹配；
      // 未知值不过滤（宁多勿漏，LLM 填错词时仍返回全量行由状态列自证）。
      const stateFilter: BusyStateLabel | undefined =
        availability === '可用' || availability === '空闲' ? '空闲'
        : availability === '正在评标' || availability === '已被抽取' || availability === '候补待命' ? availability
        : undefined;
      const where: Record<string, unknown> = {};
      if (specialty) where.specialty = { contains: specialty };
      if (title) where.title = { contains: title };
      if (employer) where.employer = { contains: employer };
      const userWhere: Record<string, unknown> = { ...companyWhere };
      if (kw) userWhere.displayName = { contains: kw };
      if (Object.keys(userWhere).length > 0) where.user = userWhere;
      const experts = await this.prisma.expertProfile.findMany({
        // 派生态为行级后过滤：take 放大补偿截断（过滤后仍截 limit 呈现）
        where, take: stateFilter ? Math.min(limit * 3, 60) : limit, orderBy: { createdAt: 'desc' },
        select: {
          id: true, specialty: true, title: true,
          employer: true,
          user: {
            select: {
              displayName: true,
              // 在途指派（四态派生用）：declined/终局项目行查询侧过滤
              bidExperts: {
                where: { invitationStatus: { not: 'declined' }, project: { stage: { in: [...IN_FLIGHT_STAGES] } } },
                select: { expertRole: true, project: { select: { stage: true } } },
              },
            },
          },
        },
      });
      const enriched = experts.map((e) => ({ e, state: busyStateOf(e.user?.bidExperts ?? []) }));
      const shown = (stateFilter ? enriched.filter((x) => x.state === stateFilter) : enriched).slice(0, limit);
      return {
        success: true,
        cards: [{
          type: 'table',
          title: `符合条件的专家（${shown.length} 名）`,
          columns: [
            { key: 'name', label: '姓名' },
            { key: 'specialty', label: '专业' },
            { key: 'title', label: '职称' },
            { key: 'employer', label: '单位' },
            { key: 'state', label: '状态' },
          ],
          rows: shown.map(({ e, state }) => ({
            name: e.user?.displayName ?? '-',
            specialty: e.specialty,
            title: e.title ?? '-',
            employer: e.employer ?? '-',
            // 状态=四态派生（2026-11-19 ⑵收口）：不再喂 availability 镜像原文（在途专家会被误标「可用」）
            state,
          })),
        }],
      };
    }

    if (action === 'by_specialty') {
      const grouped = await this.prisma.expertProfile.groupBy({
        by: ['specialty'],
        where: { user: companyWhere },
        _count: true,
      });
      grouped.sort((a, b) => b._count - a._count);
      const expTotal = grouped.reduce((s, r) => s + r._count, 0);
      return {
        success: true,
        cards: [{
          type: 'table',
          title: '专家专业方向分布',
          columns: [
            { key: 'specialty', label: '专业方向' },
            { key: 'count', label: '人数' },
            { key: 'pct', label: '占比' },
          ],
          rows: grouped.map((g) => ({
            specialty: g.specialty,
            count: g._count,
            pct: expTotal > 0 ? ((g._count / expTotal) * 100).toFixed(1) + '%' : '-',
          })),
          viz: { kind: 'distribution', category: 'specialty', value: 'count' },
        }],
      };
    }

    if (action === 'stats') {
      /* 多维度结构（2026-11-04 用户裁定：「分布」类问题是多结构数据——专业之外还有
       * 归属公司/职称/评审负荷等维度，只报单一维度=片面）。公司维度在 admin/
       * :3011 总数据口径下跨公司，是结构性重点。 */
      const [total, busyCounts, bySpecialty, profiles, activeAssigns] = await Promise.all([
        this.prisma.expertProfile.count({ where: { user: companyWhere } }),
        // 库况四态派生（2026-11-19 审查⑵收口）：可用=库内可抽取人口−在途并集，expert-busy-state.util
        // 单源（与 :3005 统计/大屏同口径）——availability 镜像「占用」零写入者恒 0、「可用」虚含在途专家
        deriveBusyCounts(this.prisma, { role: 'bid_expert', isActive: true, ...companyWhere }),
        this.prisma.expertProfile.groupBy({
          by: ['specialty'], where: { user: companyWhere }, _count: true,
        }),
        // 公司/职称维度：groupBy 不能穿关系（company 在 User 侧），取轻量行集内存分组；
        // User.company=公司名展示快照（String，关系字段是 companyRef）——直接用快照名。
        // where as never：CompanyWhere 片段非完整 UserWhere，严格重载会窄化 select 类型
        this.prisma.expertProfile.findMany({
          where: { user: companyWhere } as never,
          select: { title: true, user: { select: { company: true, department: { select: { name: true } } } } },
        }),
        // 评审负荷（在途评审任务）：availability「占用」是登记字段，可能滞后——
        // 以 BidExpert 挂在未归档项目上的实际指派数为准（同 expert-admin 负荷口径）
        this.prisma.bidExpert.findMany({
          where: { project: { stage: { not: 'ARCHIVED' } }, user: { role: 'bid_expert', isActive: true, ...companyWhere } },
          select: { userId: true },
        }),
      ]);
      bySpecialty.sort((a, b) => b._count - a._count);
      const expTotal = bySpecialty.reduce((s, r) => s + r._count, 0);
      const pctOf = (n: number) => (expTotal > 0 ? ((n / expTotal) * 100).toFixed(1) + '%' : '-');

      /* 维度随视野裁剪（2026-11-04 用户裁定）：leader/staff 单公司视野下「归属公司分布」
       * 恒 100% 一家公司=废话——换「所属部门分布」（ExpertProfile 无部门，落
       * User.department）；admin/:3011 总数据口径才分析公司（跨公司结构是重点） */
      const scoped = Object.keys(companyWhere).length > 0;
      const dimMap = new Map<string, number>();
      for (const p of profiles) {
        const name = scoped
          ? (p.user?.department?.name || '未分配部门')
          : (p.user?.company || '未归属');
        dimMap.set(name, (dimMap.get(name) ?? 0) + 1);
      }
      const byCompany = Array.from(dimMap.entries()).sort((a, b) => b[1] - a[1]);
      // 职称分布（null → 未登记）
      const titleMap = new Map<string, number>();
      for (const p of profiles) {
        const name = p.title?.trim() || '未登记';
        titleMap.set(name, (titleMap.get(name) ?? 0) + 1);
      }
      const byTitle = Array.from(titleMap.entries()).sort((a, b) => b[1] - a[1]);
      // 负荷分布（同 getLoadDistribution 阈值：≥4 过载 / ≥3 繁忙 / 其余正常 / 未指派 空闲）
      const assignCount = new Map<string, number>();
      for (const a of activeAssigns) assignCount.set(a.userId, (assignCount.get(a.userId) ?? 0) + 1);
      const load = { 空闲: 0, 正常: 0, 繁忙: 0, 过载: 0 } as Record<string, number>;
      for (const c of assignCount.values()) {
        if (c >= 4) load['过载']++;
        else if (c >= 3) load['繁忙']++;
        else load['正常']++;
      }
      load['空闲'] = Math.max(0, total - assignCount.size);
      const loadRows = Object.entries(load).filter(([, v]) => v > 0);

      return {
        success: true,
        cards: [
          {
            type: 'metric', title: '专家资源概览',
            metrics: [
              { label: '专家总数', value: String(total) },
              { label: '可用', value: String(busyCounts.idle) },
              { label: '在途评审中', value: String(assignCount.size) },
            ],
          },
          {
            type: 'table', title: '专业方向分布',
            columns: [
              { key: 'specialty', label: '专业方向' },
              { key: 'count', label: '人数' },
              { key: 'pct', label: '占比' },
            ],
            rows: bySpecialty.map((s) => ({
              specialty: s.specialty,
              count: s._count,
              pct: pctOf(s._count),
            })),
            viz: { kind: 'distribution', category: 'specialty', value: 'count' },
          },
          {
            type: 'table',
            title: scoped ? '所属部门分布' : '归属公司分布',
            columns: [
              { key: 'company', label: scoped ? '所属部门' : '归属公司' },
              { key: 'count', label: '人数' },
              { key: 'pct', label: '占比' },
            ],
            rows: byCompany.map(([company, count]) => ({ company, count, pct: pctOf(count) })),
            viz: { kind: 'distribution', category: 'company', value: 'count' },
          },
          {
            type: 'table', title: '职称分布',
            columns: [
              { key: 'title', label: '职称' },
              { key: 'count', label: '人数' },
              { key: 'pct', label: '占比' },
            ],
            rows: byTitle.map(([title, count]) => ({ title, count, pct: pctOf(count) })),
            viz: { kind: 'distribution', category: 'title', value: 'count' },
          },
          {
            type: 'table', title: '评审负荷分布（在途指派）',
            columns: [
              { key: 'load', label: '负荷档' },
              { key: 'count', label: '人数' },
            ],
            rows: loadRows.map(([l, count]) => ({ load: l, count })),
            viz: { kind: 'distribution', category: 'load', value: 'count' },
          },
        ],
        /* 交叉提示给第二轮 LLM：口径直述（原「占用（登记）」镜像指标已删——零写入者恒 0） */
        data: {
          note: `可用=库内可抽取人口−在途并集（与 :3005 统计/大屏同口径，停用档案不计）；在途评审中=按未归档项目实际指派统计（负荷口径）。`,
        },
      };
    }

    // list（出卡——此前裸 data 无卡）
    const where = { user: companyWhere, ...(specialty ? { specialty } : {}) };
    const experts = await this.prisma.expertProfile.findMany({
      where, take: limit, orderBy: { createdAt: 'desc' },
      select: {
        id: true, specialty: true, title: true,
        employer: true,
        user: {
          select: {
            displayName: true,
            // 在途指派（四态派生用）：declined/终局项目行查询侧过滤
            bidExperts: {
              where: { invitationStatus: { not: 'declined' }, project: { stage: { in: [...IN_FLIGHT_STAGES] } } },
              select: { expertRole: true, project: { select: { stage: true } } },
            },
          },
        },
      },
    });
    // data 面显式投影（不外泄嵌套 bidExperts 原始行给第二轮 LLM）；状态=四态派生（2026-11-19 ⑵收口）
    const projected = experts.map((e) => ({
      name: e.user?.displayName ?? '-',
      specialty: e.specialty,
      title: e.title ?? '-',
      employer: e.employer ?? '-',
      state: busyStateOf(e.user?.bidExperts ?? []),
    }));
    return {
      success: true,
      data: projected,
      cards: [{
        type: 'table',
        title: `专家清单（${experts.length} 名）`,
        columns: [
          { key: 'name', label: '姓名' },
          { key: 'specialty', label: '专业' },
          { key: 'title', label: '职称' },
          { key: 'state', label: '状态' },
        ],
        rows: projected,
      }],
    };
  }
}
