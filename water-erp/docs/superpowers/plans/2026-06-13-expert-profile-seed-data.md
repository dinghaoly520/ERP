# Expert Profile Seed Data Implementation Plan

> ⚠️ **端口变更提示（2026-06-15 端口重分配）：** 本计划编写时 web/采购管理端端口为 3004；重分配后 web 已改为 **3005**（见 `packages/config/src/ports.ts`）。文中 `:3004/expert` 等链接请视为如今的 `:3005/expert`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full expert profile dataset for 13 expert directions × 5 experts each (65 total, one cost/造价 group only) and update `http://localhost:3004/expert` so the admin portal can browse, filter, and inspect the generated expert pool for later random extraction.

**Architecture:** Extend the existing `User(role=bid_expert)` expert model with a one-to-one `ExpertProfile` table instead of overloading `BidExpert`, because `BidExpert` represents project assignments. Seed creates realistic profile records linked to expert users, `ExpertAdminService` returns profile fields through `/api/expert-admin`, and the Next.js web expert pages render the enriched profile data while preserving existing assignment statistics.

**Tech Stack:** NestJS 11, Prisma, PostgreSQL, Jest, Next.js 16 App Router, React 19, Tailwind CSS v4, pnpm workspace under `water-erp/`.

---

## Scope Notes

- User confirmed there should be **only one** `造价专业专家` group.
- Expert directions to generate:
  1. 职工代表专业专家
  2. 设备专业专家
  3. 造价专业专家
  4. 财资专业专家
  5. 测绘专业专家
  6. 工程设计院专业专家
  7. 施工/EPC专业专家
  8. 地质专业专家
  9. 人力资源专家
  10. 审计法务专家
  11. 安全环保专家
  12. 市场营销专家
  13. 机电专家
- Generate 5 experts per direction = **65 experts**.
- Existing demo experts (`wangjg`, `liuxm`, `chenzq`) remain valid. They can be given profile records or left as legacy examples, but `/expert` must not break when a user has no profile.

## File Structure

- Modify: `apps/api/prisma/schema.prisma`
  - Add `ExpertProfile` model.
  - Add `expertProfile` relation to `User`.
- Create: `apps/api/prisma/migrations/<timestamp>_add_expert_profiles/migration.sql`
  - SQL for `ExpertProfile` table and indexes.
- Modify: `apps/api/prisma/seed.ts`
  - Add deterministic expert profile seed data.
  - Upsert 65 expert users and profiles.
- Modify: `apps/api/src/expert/expert-admin.service.ts`
  - Include `expertProfile` in list/detail queries.
  - Add filters for category/status/level/search.
- Modify: `apps/api/src/expert/expert-admin.service.spec.ts`
  - Update tests for profile inclusion and filters.
- Modify: `apps/web/src/app/(dashboard)/expert/page.tsx`
  - Add typed profile fields, filters, stats, profile-rich cards.
- Modify: `apps/web/src/app/(dashboard)/expert/[id]/page.tsx`
  - Add profile-rich detail sections.

---

### Task 1: Add ExpertProfile schema and migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/202606130001_add_expert_profiles/migration.sql`

- [ ] **Step 1: Update Prisma schema**

In `apps/api/prisma/schema.prisma`, add this relation field inside `model User` after `bidExperts          BidExpert[]`:

```prisma
  expertProfile       ExpertProfile?
```

Then add this model after `model User` and before the `// ── 开评标 ──` comment:

```prisma
model ExpertProfile {
  id                    String   @id @default(cuid())
  userId                String   @unique
  category              String
  gender                String
  birthYear             Int
  phone                 String
  organization          String
  position              String
  professionalTitle     String
  education             String
  graduationSchool      String
  qualification         String
  yearsOfExperience     Int
  specialties           String[]
  representativeProjects String[]
  expertLevel           String
  performanceScore      Decimal  @default("0") @db.Decimal(4, 1)
  availableForDraw      Boolean  @default(true)
  avoidanceUnits        String[]
  region                String
  registeredAt          DateTime
  remarks               String?
  user                  User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([category])
  @@index([expertLevel])
  @@index([availableForDraw])
}
```

- [ ] **Step 2: Create migration SQL**

Create `apps/api/prisma/migrations/202606130001_add_expert_profiles/migration.sql` with:

```sql
-- CreateTable
CREATE TABLE "ExpertProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "birthYear" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "professionalTitle" TEXT NOT NULL,
    "education" TEXT NOT NULL,
    "graduationSchool" TEXT NOT NULL,
    "qualification" TEXT NOT NULL,
    "yearsOfExperience" INTEGER NOT NULL,
    "specialties" TEXT[],
    "representativeProjects" TEXT[],
    "expertLevel" TEXT NOT NULL,
    "performanceScore" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "availableForDraw" BOOLEAN NOT NULL DEFAULT true,
    "avoidanceUnits" TEXT[],
    "region" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpertProfile_userId_key" ON "ExpertProfile"("userId");

-- CreateIndex
CREATE INDEX "ExpertProfile_category_idx" ON "ExpertProfile"("category");

-- CreateIndex
CREATE INDEX "ExpertProfile_expertLevel_idx" ON "ExpertProfile"("expertLevel");

-- CreateIndex
CREATE INDEX "ExpertProfile_availableForDraw_idx" ON "ExpertProfile"("availableForDraw");

-- AddForeignKey
ALTER TABLE "ExpertProfile" ADD CONSTRAINT "ExpertProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate Prisma client**

Run from `water-erp/`:

```bash
pnpm db:generate
```

Expected: Prisma Client generation succeeds with no schema errors.

- [ ] **Step 4: Commit schema task**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/202606130001_add_expert_profiles/migration.sql
git commit -m "feat(api): add expert profile schema"
```

---

### Task 2: Add expert profile API service tests

**Files:**
- Modify: `apps/api/src/expert/expert-admin.service.spec.ts`

- [ ] **Step 1: Update Prisma mock**

In `beforeEach`, keep the existing mock shape:

```ts
prisma = {
  user: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  bidExpert: {
    findMany: jest.fn(),
  },
};
```

No `expertProfile` model mock is needed because the service will read profiles through the `user` relation.

- [ ] **Step 2: Replace the list test with profile expectations**

Replace the first `listExperts` test with:

```ts
it('应返回专家列表含档案与评审统计', async () => {
  prisma.user.findMany.mockResolvedValue([
    {
      id: 'u1',
      displayName: '王建国',
      email: 'wang@test.com',
      department: { id: 'd1', name: '工程部' },
      expertProfile: {
        category: '设备专业专家',
        professionalTitle: '高级工程师',
        expertLevel: 'A',
        performanceScore: 96.5,
        availableForDraw: true,
        yearsOfExperience: 18,
      },
      bidExperts: [
        { id: 'e1', progress: 80, major: '设备专业专家', project: { name: '测试项目', stage: 'EVALUATING' } },
      ],
    },
    {
      id: 'u2',
      displayName: '刘晓梅',
      email: 'liu@test.com',
      department: null,
      expertProfile: null,
      bidExperts: [],
    },
  ]);

  const result = await service.listExperts();
  expect(result).toHaveLength(2);
  expect(result[0].expertProfile.category).toBe('设备专业专家');
  expect(prisma.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { role: 'bid_expert', isActive: true },
      select: expect.objectContaining({ expertProfile: expect.any(Object) }),
    }),
  );
});
```

- [ ] **Step 3: Replace the search test with combined filters test**

Replace the current `应支持搜索` test with:

```ts
it('应支持姓名、专业方向、等级和可抽取状态筛选', async () => {
  prisma.user.findMany.mockResolvedValue([]);

  await service.listExperts({
    search: '王',
    category: '设备专业专家',
    expertLevel: 'A',
    availableForDraw: 'true',
  });

  expect(prisma.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        role: 'bid_expert',
        isActive: true,
        displayName: { contains: '王', mode: 'insensitive' },
        expertProfile: {
          is: {
            category: '设备专业专家',
            expertLevel: 'A',
            availableForDraw: true,
          },
        },
      }),
    }),
  );
});
```

- [ ] **Step 4: Update detail test fixture**

Replace this line in the detail test:

```ts
prisma.user.findUnique.mockResolvedValue({ id: 'u1', displayName: '王建国', username: 'wangjg' });
```

with:

```ts
prisma.user.findUnique.mockResolvedValue({
  id: 'u1',
  displayName: '王建国',
  username: 'wangjg',
  expertProfile: {
    category: '设备专业专家',
    organization: '四川水发设计咨询有限公司',
    expertLevel: 'A',
    availableForDraw: true,
  },
});
```

Add this assertion after the statistics assertions:

```ts
expect(result.expertProfile.category).toBe('设备专业专家');
```

- [ ] **Step 5: Run test to verify it fails before service update**

Run from `water-erp/`:

```bash
pnpm --filter api test -- expert-admin.service.spec.ts
```

Expected: FAIL because `listExperts` still accepts a string and does not select `expertProfile`.

---

### Task 3: Implement expert profile API fields and filters

**Files:**
- Modify: `apps/api/src/expert/expert-admin.service.ts`
- Test: `apps/api/src/expert/expert-admin.service.spec.ts`

- [ ] **Step 1: Add query type**

At the top of `apps/api/src/expert/expert-admin.service.ts`, after imports, add:

```ts
interface ExpertListQuery {
  search?: string;
  category?: string;
  expertLevel?: string;
  availableForDraw?: string;
}
```

- [ ] **Step 2: Replace `listExperts` implementation**

Replace the current `listExperts(search?: string)` method with:

```ts
  /** 专家库列表（User role=bid_expert + ExpertProfile 档案 + 关联 BidExpert 统计） */
  async listExperts(query: ExpertListQuery = {}) {
    const { search, category, expertLevel, availableForDraw } = query;
    const profileFilters: Record<string, unknown> = {};

    if (category) profileFilters.category = category;
    if (expertLevel) profileFilters.expertLevel = expertLevel;
    if (availableForDraw === 'true') profileFilters.availableForDraw = true;
    if (availableForDraw === 'false') profileFilters.availableForDraw = false;

    return this.prisma.user.findMany({
      where: {
        role: 'bid_expert',
        isActive: true,
        ...(search && { displayName: { contains: search, mode: 'insensitive' as const } }),
        ...(Object.keys(profileFilters).length > 0 && { expertProfile: { is: profileFilters } }),
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        department: { select: { id: true, name: true } },
        expertProfile: {
          select: {
            category: true,
            gender: true,
            birthYear: true,
            phone: true,
            organization: true,
            position: true,
            professionalTitle: true,
            education: true,
            graduationSchool: true,
            qualification: true,
            yearsOfExperience: true,
            specialties: true,
            representativeProjects: true,
            expertLevel: true,
            performanceScore: true,
            availableForDraw: true,
            avoidanceUnits: true,
            region: true,
            registeredAt: true,
            remarks: true,
          },
        },
        bidExperts: {
          select: {
            id: true,
            expertName: true,
            major: true,
            progress: true,
            signedIn: true,
            avoidanceConfirmed: true,
            totalScore: true,
            project: { select: { id: true, name: true, stage: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { displayName: 'asc' },
    });
  }
```

- [ ] **Step 3: Include profile in `getExpert` user select**

Inside `getExpert`, add this `expertProfile` select in the `prisma.user.findUnique` select object after `department`:

```ts
        expertProfile: {
          select: {
            category: true,
            gender: true,
            birthYear: true,
            phone: true,
            organization: true,
            position: true,
            professionalTitle: true,
            education: true,
            graduationSchool: true,
            qualification: true,
            yearsOfExperience: true,
            specialties: true,
            representativeProjects: true,
            expertLevel: true,
            performanceScore: true,
            availableForDraw: true,
            avoidanceUnits: true,
            region: true,
            registeredAt: true,
            remarks: true,
          },
        },
```

- [ ] **Step 4: Update controller signature**

Modify `apps/api/src/expert/expert-admin.controller.ts` imports and method signature.

Replace:

```ts
  listExperts(@Query('search') search?: string) {
    return this.expertAdminService.listExperts(search);
  }
```

with:

```ts
  listExperts(
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('expertLevel') expertLevel?: string,
    @Query('availableForDraw') availableForDraw?: string,
  ) {
    return this.expertAdminService.listExperts({ search, category, expertLevel, availableForDraw });
  }
```

- [ ] **Step 5: Run API unit test**

Run from `water-erp/`:

```bash
pnpm --filter api test -- expert-admin.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit API task**

```bash
git add apps/api/src/expert/expert-admin.service.ts apps/api/src/expert/expert-admin.controller.ts apps/api/src/expert/expert-admin.service.spec.ts
git commit -m "feat(api): expose expert profile filters"
```

---

### Task 4: Seed 65 expert users and profiles

**Files:**
- Modify: `apps/api/prisma/seed.ts`

- [ ] **Step 1: Add seed helper types and data**

In `apps/api/prisma/seed.ts`, after the content builder helper functions and before `async function main()`, add:

```ts
type ExpertProfileSeed = {
  username: string;
  displayName: string;
  category: string;
  gender: string;
  birthYear: number;
  phone: string;
  organization: string;
  position: string;
  professionalTitle: string;
  education: string;
  graduationSchool: string;
  qualification: string;
  yearsOfExperience: number;
  specialties: string[];
  representativeProjects: string[];
  expertLevel: string;
  performanceScore: number;
  availableForDraw: boolean;
  avoidanceUnits: string[];
  region: string;
  registeredAt: Date;
  remarks: string;
};

const expertCategorySeeds = [
  {
    category: '职工代表专业专家',
    names: ['周明华', '罗春燕', '邓启明', '唐玉兰', '蒋海峰'],
    title: '高级政工师',
    qualification: '企业民主管理评审专家',
    specialties: ['职工权益保护', '劳动关系协调', '民主评议', '工会监督'],
    projects: ['集团职代会提案评审', '薪酬制度民主评议', '基层班组建设评价'],
  },
  {
    category: '设备专业专家',
    names: ['何志强', '高瑞林', '田晓峰', '彭雪梅', '秦立军'],
    title: '高级工程师',
    qualification: '注册设备监理师',
    specialties: ['泵站设备', '阀门选型', '自动化监控', '设备验收'],
    projects: ['都江堰灌区泵站设备采购评审', '水厂加压泵节能改造论证', '闸门启闭机更新项目评审'],
  },
  {
    category: '造价专业专家',
    names: ['宋雅琴', '曾建平', '马丽娟', '郭维东', '袁小蓉'],
    title: '高级工程师',
    qualification: '一级注册造价工程师',
    specialties: ['工程量清单审核', '最高限价编制', '投标报价分析', '变更签证审核'],
    projects: ['农村供水管网材料采购限价审核', '渠道清淤工程清单复核', '水库除险加固投资评审'],
  },
  {
    category: '财资专业专家',
    names: ['熊志远', '廖红梅', '白建国', '范婷婷', '雷旭东'],
    title: '高级会计师',
    qualification: '注册会计师',
    specialties: ['资金计划', '财务测算', '融资方案', '资产评估'],
    projects: ['水务资产盘点评审', '专项债资金使用绩效评价', '供水项目财务测算评审'],
  },
  {
    category: '测绘专业专家',
    names: ['韩子昂', '邹敏', '魏长龙', '冯丽娜', '叶青松'],
    title: '高级工程师',
    qualification: '注册测绘师',
    specialties: ['地形测量', '管线探测', '变形监测', '无人机航测'],
    projects: ['水库大坝位移监测方案评审', '灌区管线测绘成果验收', '河道清淤断面复测'],
  },
  {
    category: '工程设计院专业专家',
    names: ['沈国梁', '余慧敏', '曹远航', '夏雨薇', '任泽民'],
    title: '正高级工程师',
    qualification: '注册土木工程师（水利水电）',
    specialties: ['水利工程设计', '初步设计审查', '施工图复核', '技术方案比选'],
    projects: ['武引水库除险加固设计审查', '灌区现代化改造方案评审', '水源工程可研技术评估'],
  },
  {
    category: '施工/EPC专业专家',
    names: ['杜成林', '谢文博', '钟敏华', '贺建军', '梁思远'],
    title: '高级工程师',
    qualification: '一级建造师（水利水电工程）',
    specialties: ['施工组织设计', 'EPC总承包管理', '进度控制', '质量验收'],
    projects: ['渠道生态修复施工评审', '泵站改造EPC方案论证', '水利工程施工总承包评标'],
  },
  {
    category: '地质专业专家',
    names: ['潘德辉', '崔若兰', '苏建明', '孔令川', '赖雨辰'],
    title: '高级工程师',
    qualification: '注册岩土工程师',
    specialties: ['工程地质勘察', '边坡稳定', '岩土试验', '地质灾害评估'],
    projects: ['水库库岸稳定性评估', '输水隧洞地质勘察审查', '边坡治理方案评审'],
  },
  {
    category: '人力资源专家',
    names: ['尹秋月', '程浩然', '陆佳宁', '傅明哲', '施晓琳'],
    title: '高级人力资源管理师',
    qualification: '企业人力资源管理师一级',
    specialties: ['岗位体系', '绩效考核', '薪酬激励', '人才盘点'],
    projects: ['集团岗位价值评估', '技能人才评价体系建设', '绩效考核制度优化评审'],
  },
  {
    category: '审计法务专家',
    names: ['谭正清', '方若曦', '孟立新', '常安琪', '石文涛'],
    title: '高级审计师',
    qualification: '法律职业资格A证',
    specialties: ['合同合规审查', '采购审计', '内控评价', '争议处理'],
    projects: ['采购合同示范文本审查', '供应商履约审计', '招标过程合规专项检查'],
  },
  {
    category: '安全环保专家',
    names: ['汪庆华', '龙嘉怡', '毛新宇', '郝文静', '段志鹏'],
    title: '高级工程师',
    qualification: '注册安全工程师',
    specialties: ['安全生产标准化', '环保验收', '水保措施', '应急预案'],
    projects: ['水利工程安全文明施工评审', '生态流量监测环保验收', '防汛物资储备安全评价'],
  },
  {
    category: '市场营销专家',
    names: ['邱晓东', '顾婷婷', '贾明轩', '梅雪', '戴晨阳'],
    title: '高级经济师',
    qualification: '市场营销高级职业经理人',
    specialties: ['市场调研', '客户策略', '品牌推广', '渠道管理'],
    projects: ['供水服务品牌提升方案评审', '采购商城品类运营评估', '涉水产品市场调研审查'],
  },
  {
    category: '机电专家',
    names: ['万成刚', '钱晓蕾', '丁博文', '黎海燕', '邵俊杰'],
    title: '高级工程师',
    qualification: '注册电气工程师',
    specialties: ['电气自动化', '机电安装', '变频控制', '供配电系统'],
    projects: ['泵站变频节能改造评审', '水厂自动加药系统机电审查', '闸站供配电系统验收'],
  },
] as const;

function buildExpertProfileSeeds(): ExpertProfileSeed[] {
  const schools = ['四川大学', '西南交通大学', '河海大学', '重庆大学', '成都理工大学'];
  const organizations = ['四川水发设计咨询有限公司', '四川省水利规划研究中心', '成都水务工程咨询院', '四川水发建设管理有限公司', '西南水利技术服务中心'];
  const regions = ['成都', '绵阳', '德阳', '南充', '宜宾'];
  const levels = ['A', 'A', 'B', 'B', 'C'];

  return expertCategorySeeds.flatMap((group, groupIndex) => group.names.map((name, index) => ({
    username: `expert_${String(groupIndex + 1).padStart(2, '0')}_${String(index + 1).padStart(2, '0')}`,
    displayName: name,
    category: group.category,
    gender: index % 2 === 0 ? '男' : '女',
    birthYear: 1972 + ((groupIndex + index) % 18),
    phone: `138${String(26000000 + groupIndex * 1000 + index * 37).padStart(8, '0')}`,
    organization: organizations[(groupIndex + index) % organizations.length],
    position: index % 2 === 0 ? '技术负责人' : '专业负责人',
    professionalTitle: group.title,
    education: index === 0 ? '博士研究生' : index < 4 ? '硕士研究生' : '大学本科',
    graduationSchool: schools[(groupIndex + index) % schools.length],
    qualification: group.qualification,
    yearsOfExperience: 12 + ((groupIndex * 2 + index) % 18),
    specialties: group.specialties,
    representativeProjects: group.projects,
    expertLevel: levels[index],
    performanceScore: 88 + ((groupIndex + index) % 10) + (index === 0 ? 0.8 : 0.3),
    availableForDraw: !(index === 4 && groupIndex % 3 === 0),
    avoidanceUnits: index % 3 === 0 ? ['四川川水建设工程有限公司'] : index % 3 === 1 ? ['成都华西物资供应有限公司'] : [],
    region: regions[(groupIndex + index) % regions.length],
    registeredAt: new Date(`2026-${String((groupIndex % 6) + 1).padStart(2, '0')}-${String(index + 10).padStart(2, '0')}T09:00:00`),
    remarks: `${group.category}模拟专家，用于专家库筛选、抽取和演示。`,
  })));
}
```

- [ ] **Step 2: Add seed execution after the three existing expert users**

After the `expertChenzq` upsert block and before `const project = await prisma.bidProject.create({`, add:

```ts
  const expertProfileSeeds = buildExpertProfileSeeds();
  for (const expertSeed of expertProfileSeeds) {
    const user = await prisma.user.upsert({
      where: { username: expertSeed.username },
      update: {
        displayName: expertSeed.displayName,
        role: 'bid_expert',
        isActive: true,
        departmentId: dept.id,
        email: `${expertSeed.username}@expert.water-erp.local`,
      },
      create: {
        username: expertSeed.username,
        displayName: expertSeed.displayName,
        passwordHash: hashSync(`${expertSeed.username}@2026`, 10),
        role: 'bid_expert',
        isActive: true,
        departmentId: dept.id,
        email: `${expertSeed.username}@expert.water-erp.local`,
      },
    });

    await prisma.expertProfile.upsert({
      where: { userId: user.id },
      update: {
        category: expertSeed.category,
        gender: expertSeed.gender,
        birthYear: expertSeed.birthYear,
        phone: expertSeed.phone,
        organization: expertSeed.organization,
        position: expertSeed.position,
        professionalTitle: expertSeed.professionalTitle,
        education: expertSeed.education,
        graduationSchool: expertSeed.graduationSchool,
        qualification: expertSeed.qualification,
        yearsOfExperience: expertSeed.yearsOfExperience,
        specialties: expertSeed.specialties,
        representativeProjects: expertSeed.representativeProjects,
        expertLevel: expertSeed.expertLevel,
        performanceScore: expertSeed.performanceScore,
        availableForDraw: expertSeed.availableForDraw,
        avoidanceUnits: expertSeed.avoidanceUnits,
        region: expertSeed.region,
        registeredAt: expertSeed.registeredAt,
        remarks: expertSeed.remarks,
      },
      create: {
        userId: user.id,
        category: expertSeed.category,
        gender: expertSeed.gender,
        birthYear: expertSeed.birthYear,
        phone: expertSeed.phone,
        organization: expertSeed.organization,
        position: expertSeed.position,
        professionalTitle: expertSeed.professionalTitle,
        education: expertSeed.education,
        graduationSchool: expertSeed.graduationSchool,
        qualification: expertSeed.qualification,
        yearsOfExperience: expertSeed.yearsOfExperience,
        specialties: expertSeed.specialties,
        representativeProjects: expertSeed.representativeProjects,
        expertLevel: expertSeed.expertLevel,
        performanceScore: expertSeed.performanceScore,
        availableForDraw: expertSeed.availableForDraw,
        avoidanceUnits: expertSeed.avoidanceUnits,
        region: expertSeed.region,
        registeredAt: expertSeed.registeredAt,
        remarks: expertSeed.remarks,
      },
    });
  }

  console.log(`Seeded: ${expertProfileSeeds.length} expert profiles`);
```

- [ ] **Step 3: Run TypeScript build check for API**

Run from `water-erp/`:

```bash
pnpm build:api
```

Expected: PASS. If Prisma client has not been regenerated after Task 1, run `pnpm db:generate` first.

- [ ] **Step 4: Commit seed task**

```bash
git add apps/api/prisma/seed.ts
git commit -m "feat(seed): add expert profile pool"
```

---

### Task 5: Update `/expert` list page UI

**Files:**
- Modify: `apps/web/src/app/(dashboard)/expert/page.tsx`

- [ ] **Step 1: Replace page interfaces**

At the top of `apps/web/src/app/(dashboard)/expert/page.tsx`, replace the existing `Expert` interface block with:

```tsx
interface ExpertAssignment {
  id: string;
  expertName: string;
  major: string;
  progress: number;
  signedIn: boolean;
  totalScore: number;
  project: { id: string; name: string; stage: string };
}

interface ExpertProfile {
  category: string;
  gender: string;
  birthYear: number;
  phone: string;
  organization: string;
  position: string;
  professionalTitle: string;
  education: string;
  graduationSchool: string;
  qualification: string;
  yearsOfExperience: number;
  specialties: string[];
  representativeProjects: string[];
  expertLevel: string;
  performanceScore: number | string;
  availableForDraw: boolean;
  avoidanceUnits: string[];
  region: string;
  registeredAt: string;
  remarks: string | null;
}

interface Expert {
  id: string;
  displayName: string;
  email: string | null;
  department: { id: string; name: string } | null;
  expertProfile: ExpertProfile | null;
  bidExperts: ExpertAssignment[];
}

const expertCategories = [
  '职工代表专业专家',
  '设备专业专家',
  '造价专业专家',
  '财资专业专家',
  '测绘专业专家',
  '工程设计院专业专家',
  '施工/EPC专业专家',
  '地质专业专家',
  '人力资源专家',
  '审计法务专家',
  '安全环保专家',
  '市场营销专家',
  '机电专家',
];
```

- [ ] **Step 2: Add filter state**

Inside `ExpertPage`, after `const [search, setSearch] = useState('');`, add:

```tsx
  const [category, setCategory] = useState('');
  const [expertLevel, setExpertLevel] = useState('');
  const [availableForDraw, setAvailableForDraw] = useState('');
```

- [ ] **Step 3: Replace `loadExperts` query builder**

Replace the current `loadExperts` function with:

```tsx
  function loadExperts() {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    if (expertLevel) params.set('expertLevel', expertLevel);
    if (availableForDraw) params.set('availableForDraw', availableForDraw);
    const query = params.toString() ? `?${params.toString()}` : '';

    api.get<Expert[]>(`/expert-admin${query}`)
      .then(setExperts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
```

- [ ] **Step 4: Add computed stats before return**

Before `return (`, add:

```tsx
  const profiledExperts = experts.filter(expert => expert.expertProfile);
  const availableExperts = profiledExperts.filter(expert => expert.expertProfile?.availableForDraw);
  const categoryCount = new Set(profiledExperts.map(expert => expert.expertProfile?.category).filter(Boolean)).size;
  const averageScore = profiledExperts.length
    ? (profiledExperts.reduce((sum, expert) => sum + Number(expert.expertProfile?.performanceScore || 0), 0) / profiledExperts.length).toFixed(1)
    : '0.0';
```

- [ ] **Step 5: Replace search block with filters**

Replace the JSX block labeled `{/* 搜索 */}` with:

```tsx
      {/* 搜索与筛选 */}
      <div className="bg-white rounded-xl border border-[#e5ecf4] p-4 mb-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <input
            type="text"
            placeholder="搜索专家姓名..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadExperts()}
            className="px-4 py-2.5 rounded-lg border border-[oklch(0.91_0.006_264)] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#064ea2]/20 focus:border-[#064ea2]"
          />
          <select value={category} onChange={e => setCategory(e.target.value)} className="px-4 py-2.5 rounded-lg border border-[oklch(0.91_0.006_264)] bg-white text-sm">
            <option value="">全部专业方向</option>
            {expertCategories.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={expertLevel} onChange={e => setExpertLevel(e.target.value)} className="px-4 py-2.5 rounded-lg border border-[oklch(0.91_0.006_264)] bg-white text-sm">
            <option value="">全部等级</option>
            <option value="A">A 级专家</option>
            <option value="B">B 级专家</option>
            <option value="C">C 级专家</option>
          </select>
          <select value={availableForDraw} onChange={e => setAvailableForDraw(e.target.value)} className="px-4 py-2.5 rounded-lg border border-[oklch(0.91_0.006_264)] bg-white text-sm">
            <option value="">全部抽取状态</option>
            <option value="true">可抽取</option>
            <option value="false">暂不可抽取</option>
          </select>
          <button
            onClick={loadExperts}
            className="px-5 py-2.5 bg-[#064ea2] text-white rounded-lg text-sm font-semibold hover:bg-[#053f85] transition"
          >
            查询专家
          </button>
        </div>
      </div>
```

- [ ] **Step 6: Replace statistics grid**

Replace the 3-card statistics grid with:

```tsx
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">专家总数</p>
          <p className="text-3xl font-bold text-[#064ea2]">{experts.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">可抽取专家</p>
          <p className="text-3xl font-bold text-[#11a874]">{availableExperts.length}</p>
        </div>
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">专业方向</p>
          <p className="text-3xl font-bold text-[#7c3aed]">{categoryCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">平均履职评分</p>
          <p className="text-3xl font-bold text-[#f5a623]">{averageScore}</p>
        </div>
      </div>
```

- [ ] **Step 7: Replace card body inside `experts.map`**

Inside `experts.map(expert => {`, add after `completedProjects`:

```tsx
            const profile = expert.expertProfile;
            const majorLabels = profile ? [profile.category, profile.professionalTitle] : majors;
```

Then replace `{majors.slice(0, 2).map(m => (` with:

```tsx
                    {majorLabels.slice(0, 2).map(m => (
```

Replace the bottom 3-column info grid with:

```tsx
                <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                  <div className="rounded-lg bg-[#f8fafc] px-3 py-2">
                    <span className="text-[#8a96aa]">单位/地区</span>
                    <div className="mt-1 font-semibold text-[#18243a]">{profile ? `${profile.organization} · ${profile.region}` : '未建档'}</div>
                  </div>
                  <div className="rounded-lg bg-[#f8fafc] px-3 py-2">
                    <span className="text-[#8a96aa]">资格/年限</span>
                    <div className="mt-1 font-semibold text-[#064ea2]">{profile ? `${profile.qualification} · ${profile.yearsOfExperience}年` : '—'}</div>
                  </div>
                  <div className="rounded-lg bg-[#f8fafc] px-3 py-2">
                    <span className="text-[#8a96aa]">等级/评分</span>
                    <div className="mt-1 font-semibold text-[#7c3aed]">{profile ? `${profile.expertLevel}级 · ${Number(profile.performanceScore).toFixed(1)}` : '—'}</div>
                  </div>
                  <div className="rounded-lg bg-[#f8fafc] px-3 py-2">
                    <span className="text-[#8a96aa]">抽取状态</span>
                    <div className={`mt-1 font-semibold ${profile?.availableForDraw ? 'text-[#11a874]' : 'text-[#f5a623]'}`}>
                      {profile ? (profile.availableForDraw ? '可抽取' : '暂不可抽取') : '未建档'}
                    </div>
                  </div>
                </div>
                {profile && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {profile.specialties.slice(0, 4).map(item => (
                      <span key={item} className="rounded-full border border-[#dbe7f3] bg-[#f8fbff] px-2 py-0.5 text-xs text-[#5a6d8a]">{item}</span>
                    ))}
                  </div>
                )}
```

- [ ] **Step 8: Run web type/build check**

Run from `water-erp/`:

```bash
pnpm build:web
```

Expected: PASS.

- [ ] **Step 9: Commit list UI task**

```bash
git add "apps/web/src/app/(dashboard)/expert/page.tsx"
git commit -m "feat(web): show expert profile list"
```

---

### Task 6: Update expert detail page UI

**Files:**
- Modify: `apps/web/src/app/(dashboard)/expert/[id]/page.tsx`

- [ ] **Step 1: Add `ExpertProfile` interface**

After `interface Assignment`, add:

```tsx
interface ExpertProfile {
  category: string;
  gender: string;
  birthYear: number;
  phone: string;
  organization: string;
  position: string;
  professionalTitle: string;
  education: string;
  graduationSchool: string;
  qualification: string;
  yearsOfExperience: number;
  specialties: string[];
  representativeProjects: string[];
  expertLevel: string;
  performanceScore: number | string;
  availableForDraw: boolean;
  avoidanceUnits: string[];
  region: string;
  registeredAt: string;
  remarks: string | null;
}
```

Add this property to `interface ExpertDetail` after `department`:

```tsx
  expertProfile: ExpertProfile | null;
```

- [ ] **Step 2: Add profile constant before return**

Before `return (`, add:

```tsx
  const profile = expert.expertProfile;
```

- [ ] **Step 3: Replace basic info grid**

Replace the `{/* 基本信息 */}` card with:

```tsx
      {/* 基本信息 */}
      <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-6 mb-6">
        <div className="grid grid-cols-4 gap-6">
          <div>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">用户名</p>
            <p className="font-semibold text-[oklch(0.18_0.012_265)]">{expert.username}</p>
          </div>
          <div>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">邮箱</p>
            <p className="font-semibold text-[oklch(0.18_0.012_265)]">{expert.email || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">所属部门</p>
            <p className="font-semibold text-[oklch(0.18_0.012_265)]">{expert.department?.name || '未分配'}</p>
          </div>
          <div>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">注册时间</p>
            <p className="font-semibold text-[oklch(0.18_0.012_265)]">{new Date(expert.createdAt).toLocaleDateString('zh-CN')}</p>
          </div>
        </div>
      </div>

      {profile && (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-6 mb-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)]">专家档案</h2>
              <p className="text-sm text-[oklch(0.55_0.01_264)]">{profile.category} · {profile.organization}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${profile.availableForDraw ? 'bg-[#11a87418] text-[#11a874]' : 'bg-[#f5a62318] text-[#b7791f]'}`}>
              {profile.availableForDraw ? '可抽取' : '暂不可抽取'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-6">
            <div><p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">性别/出生年</p><p className="font-semibold text-[#18243a]">{profile.gender} · {profile.birthYear}</p></div>
            <div><p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">联系电话</p><p className="font-semibold text-[#18243a]">{profile.phone}</p></div>
            <div><p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">职务/职称</p><p className="font-semibold text-[#18243a]">{profile.position} · {profile.professionalTitle}</p></div>
            <div><p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">专家等级/评分</p><p className="font-semibold text-[#7c3aed]">{profile.expertLevel}级 · {Number(profile.performanceScore).toFixed(1)}</p></div>
            <div><p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">学历/院校</p><p className="font-semibold text-[#18243a]">{profile.education} · {profile.graduationSchool}</p></div>
            <div><p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">执业资格</p><p className="font-semibold text-[#064ea2]">{profile.qualification}</p></div>
            <div><p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">从业年限</p><p className="font-semibold text-[#18243a]">{profile.yearsOfExperience} 年</p></div>
            <div><p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">地区/入库时间</p><p className="font-semibold text-[#18243a]">{profile.region} · {new Date(profile.registeredAt).toLocaleDateString('zh-CN')}</p></div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-4">
            <div className="rounded-xl bg-[#f8fafc] p-4">
              <p className="mb-2 text-xs font-semibold text-[#5a6d8a]">擅长领域</p>
              <div className="flex flex-wrap gap-2">{profile.specialties.map(item => <span key={item} className="rounded-full bg-white border border-[#dbe7f3] px-2 py-1 text-xs text-[#18243a]">{item}</span>)}</div>
            </div>
            <div className="rounded-xl bg-[#f8fafc] p-4">
              <p className="mb-2 text-xs font-semibold text-[#5a6d8a]">代表项目</p>
              <ul className="space-y-1 text-xs text-[#18243a]">{profile.representativeProjects.map(item => <li key={item}>• {item}</li>)}</ul>
            </div>
            <div className="rounded-xl bg-[#f8fafc] p-4">
              <p className="mb-2 text-xs font-semibold text-[#5a6d8a]">回避单位</p>
              {profile.avoidanceUnits.length > 0 ? <ul className="space-y-1 text-xs text-[#b7791f]">{profile.avoidanceUnits.map(item => <li key={item}>• {item}</li>)}</ul> : <p className="text-xs text-[#11a874]">暂无回避单位</p>}
            </div>
          </div>
          {profile.remarks && <p className="mt-4 text-sm text-[#5a6d8a]">备注：{profile.remarks}</p>}
        </div>
      )}
```

- [ ] **Step 4: Replace emoji status in assignment card**

In the assignment list, replace:

```tsx
<span>签到：{a.signedIn ? '✅ 已签到' : '❌ 未签到'}</span>
<span>回避确认：{a.avoidanceConfirmed ? '✅ 已确认' : '❌ 未确认'}</span>
```

with:

```tsx
<span>签到：{a.signedIn ? '已签到' : '未签到'}</span>
<span>回避确认：{a.avoidanceConfirmed ? '已确认' : '未确认'}</span>
```

- [ ] **Step 5: Run web build**

Run from `water-erp/`:

```bash
pnpm build:web
```

Expected: PASS.

- [ ] **Step 6: Commit detail UI task**

```bash
git add "apps/web/src/app/(dashboard)/expert/[id]/page.tsx"
git commit -m "feat(web): show expert profile detail"
```

---

### Task 7: Apply migration, seed data, and verify end-to-end

**Files:**
- No source edits expected unless verification finds a real issue.

- [ ] **Step 1: Apply database migration**

Run from `water-erp/`:

```bash
pnpm db:migrate
```

Expected: migration applies. If non-interactive Prisma migrate blocks, use:

```bash
$env:PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION='1'; pnpm db:migrate
```

If using Bash instead of PowerShell:

```bash
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 pnpm db:migrate
```

- [ ] **Step 2: Seed expert data**

Run from `water-erp/`:

```bash
pnpm db:seed
```

Expected output includes:

```text
Seeded: 65 expert profiles
```

- [ ] **Step 3: Run API tests**

Run:

```bash
pnpm --filter api test -- expert-admin.service.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run API build**

Run:

```bash
pnpm build:api
```

Expected: PASS.

- [ ] **Step 5: Run web build**

Run:

```bash
pnpm build:web
```

Expected: PASS.

- [ ] **Step 6: Manual browser verification**

Start services if not already running:

```bash
pnpm dev:api
pnpm dev:web
```

Open:

```text
http://localhost:3004/expert
```

Verify:

- Expert total includes the new 65 expert users plus any existing bid expert users.
- Professional direction filter includes exactly one `造价专业专家` option.
- Filtering by `设备专业专家` returns 5 seeded experts.
- Filtering by `造价专业专家` returns 5 seeded experts.
- Each seeded expert card shows organization, qualification, years, level, score, draw status, and specialties.
- Clicking a seeded expert opens detail page with full profile fields and project history section.

- [ ] **Step 7: Commit verification fixes if needed**

Only if verification required source changes:

```bash
git add <changed-files>
git commit -m "fix: stabilize expert profile verification"
```

---

## Self-Review

- Spec coverage: The plan covers the one-造价-group correction, 13 directions × 5 experts, full profile persistence, API exposure, list/detail UI, tests, migration, seed, and manual verification.
- Placeholder scan: No TBD/TODO/implement later placeholders are present.
- Type consistency: `ExpertProfile` field names are consistent across Prisma schema, seed, API selects, and frontend interfaces.
- Risk note: Existing `db:seed` uses many upserts and creates some project data with fixed unique codes. If local DB already contains `BID-2026-0518`, seed may fail at the existing project create before or after expert profile seeding depending on current DB state. If that happens in local dev, reset the dev DB or adapt the existing project seed to upsert in a separate follow-up task.
