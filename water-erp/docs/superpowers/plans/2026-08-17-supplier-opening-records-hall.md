# 供应商大厅唱标记录公开 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 供应商开标大厅新增「唱标记录（全部投标人）」实时表——自 OPENING 阶段起，本项目全体投标人可见各家唱标信息（名称/报价/工期/质量/保证金/状态）。

**Architecture:** 后端在 supplier-portal 模块新增列表端点（成员门控 + 阶段门控 + 字段脱敏），复用既有 WS 事件 `opening:record:updated`（已在 project 房间广播、payload 已含 amount 里程碑数据）触发前端 refresh；前端在 OpeningHall.vue 左侧新增 Element Plus 表格卡片，本司行高亮。**WS/后端广播零改动**。

**Tech Stack:** NestJS 11 + Prisma（后端）；Vue 3 + Element Plus（供应商门户）。

**Spec:** 本计划即需求载体（无独立 spec 文档）。合规依据：《电子招标投标办法》第30条——解密全部完成后应当向所有投标人公布投标人名称、投标价格和招标文件规定的其他内容；《招标投标法》第36条——当众宣读（唱标）全部投标文件主要内容。

## Global Constraints

- 唱标记录自 **OPENING 阶段起**（OPENING/EVALUATING/ARCHIVED）向本项目投标人公开；开标前（DOWNLOAD/SUBMIT）**不得**返回任何记录（投标保密）。
- 成员门控与 WS `join:project` 对齐（bid.gateway.ts `handleJoinProject`：supplier 须是 `bidSupplier` 成员）——非本项目投标人 403。
- **脱敏口径**：不下发 `objectionReason` / `handleResult` / `handledBy` / `handledAt`（异议裁决过程属主持端信息）；`confirmStatus`（确认/异议状态）为大厅公开状态，保留。
- 供应商门户错误形状统一 `{ error, code }`（`BadRequestException` / `ForbiddenException`），单测断言用 `.rejects.toMatchObject({ response: { code: '...' } })`。
- `SupplierPortalController` 类级 `@Roles('supplier')` 已覆盖新端点，**无需**额外装饰器；`getSupplierId(req.user.sub)` 解析供应商 ID。
- 前端 WS 处理器 `onOpeningRecordUpdated` 已存在（OpeningHall.vue:125），收到事件即 `refresh()`——新列表随 refresh 一并更新，**不改** WS 任何代码。
- 供应商门户无 lint/typecheck 脚本，验证用 `npx vue-tsc --noEmit`（不可用则 `pnpm --filter supplier-portal build`）。

## 设计决策（待审核确认）

1. **「边录边公开」**：主持端逐家录入唱标（upsert），供应商大厅表实时显示已录入的行（离线开标本就是逐家当众宣读，语义一致）。若要求「全部录入完统一公布」需后端加发布开关，复杂度明显上升，本方案不采用。
2. **排序**：`createdAt asc`（唱标录入先后，与主持端「开标记录」表同源同序）。
3. **本司高亮**：列表下发 `bidSupplierId`，前端与 `getMyOpeningRecord`（本司记录）返回的 `bidSupplierId` 比对打「本司」tag。

---

### Task 1: 后端——供应商侧唱标记录列表端点（TDD）

**Files:**
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（在 `getMyOpeningRecord` 之后，约 :1184 处新增方法）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（在 `opening-record` GET 路由之后，约 :247 处新增路由）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（新增 describe 块）

**Interfaces:**
- Consumes: 无（第一个任务）
- Produces: `GET /api/supplier-portal/bid-submissions/:projectId/opening-records`
  - 200 → `Array<{ id: string; bidSupplierId: string | null; supplierName: string; amount: string; period: string; qualityTarget: string; bondStatus: string; decryptResult: string; confirmStatus: string; confirmedAt: string | null }>`（`createdAt asc`）
  - 403 `NOT_PROJECT_MEMBER` — 请求者非本项目投标人
  - 400 `OPENING_NOT_STARTED` — 项目 stage ∉ {OPENING, EVALUATING, ARCHIVED}
  - 400 `NOT_FOUND` — 项目不存在
  - Service 方法签名：`listOpeningRecords(supplierId: string, projectId: string)`

- [x] **Step 1: 写失败测试**

在 `supplier-portal.service.spec.ts` 末尾（describe 内）新增：

```ts
describe('listOpeningRecords（大厅公开视图）', () => {
  const mockRecords = [
    { id: 'r-1', bidSupplierId: 'bs-1', supplierName: '四川川水建设工程有限公司', amount: '4200000', period: '120 日历天', qualityTarget: '合格', bondStatus: '已缴纳', decryptResult: '解密成功', confirmStatus: '待供应商确认', confirmedAt: null, objectionReason: null, handleResult: null, handledBy: null, createdAt: new Date('2026-08-17T09:00:00Z') },
    { id: 'r-2', bidSupplierId: 'bs-2', supplierName: '成都华建地质工程科技有限公司', amount: '3980000', period: '110 日历天', qualityTarget: '优良', bondStatus: '保函有效', decryptResult: '解密成功', confirmStatus: '供应商已确认', confirmedAt: new Date('2026-08-17T09:05:00Z'), objectionReason: '异议已处理', handleResult: '维持原记录', handledBy: 'user-host', createdAt: new Date('2026-08-17T09:02:00Z') },
  ];

  it('OPENING 阶段返回全部记录（createdAt 升序）且剥离异议过程字段', async () => {
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'OPENING' });
    prisma.bidOpeningRecord.findMany.mockResolvedValue(mockRecords);

    const result = await service.listOpeningRecords('supplier-1', 'project-1');

    expect(prisma.bidOpeningRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'project-1' }, orderBy: { createdAt: 'asc' } }),
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ supplierName: '四川川水建设工程有限公司', amount: '4200000' });
    expect(result[1]).not.toHaveProperty('objectionReason');
    expect(result[1]).not.toHaveProperty('handleResult');
    expect(result[1]).not.toHaveProperty('handledBy');
    expect(result[1]).not.toHaveProperty('handledAt');
    expect(result[1].confirmStatus).toBe('供应商已确认');
  });

  it('EVALUATING/ARCHIVED 阶段同样可见（唱标信息开标后属公开信息）', async () => {
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'ARCHIVED' });
    prisma.bidOpeningRecord.findMany.mockResolvedValue(mockRecords);

    await expect(service.listOpeningRecords('supplier-1', 'project-1')).resolves.toHaveLength(2);
  });

  it('开标前（SUBMIT）→ 400 OPENING_NOT_STARTED', async () => {
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
    prisma.bidProject.findUnique.mockResolvedValue({ stage: 'SUBMIT' });

    await expect(service.listOpeningRecords('supplier-1', 'project-1'))
      .rejects.toMatchObject({ response: { code: 'OPENING_NOT_STARTED' } });
    expect(prisma.bidOpeningRecord.findMany).not.toHaveBeenCalled();
  });

  it('非本项目投标人 → 403 NOT_PROJECT_MEMBER', async () => {
    prisma.bidSupplier.findFirst.mockResolvedValue(null);

    await expect(service.listOpeningRecords('supplier-1', 'project-1'))
      .rejects.toMatchObject({ response: { code: 'NOT_PROJECT_MEMBER' } });
    expect(prisma.bidOpeningRecord.findMany).not.toHaveBeenCalled();
  });

  it('项目不存在 → 400 NOT_FOUND', async () => {
    prisma.bidSupplier.findFirst.mockResolvedValue({ id: 'bs-1' });
    prisma.bidProject.findUnique.mockResolvedValue(null);

    await expect(service.listOpeningRecords('supplier-1', 'project-1'))
      .rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
  });
});
```

注意：`prisma.bidOpeningRecord.findMany` 在 `beforeEach` mock 中已存在（spec :85），无需新增 mock 键；若该用例前其他用例 mock 了 `findMany`，每个 it 内自行 `mockResolvedValue` 覆盖。

- [x] **Step 2: 运行测试确认失败**

```bash
cd water-erp && pnpm --filter api test -- supplier-portal.service.spec
```

Expected: 5 个新用例 FAIL（`service.listOpeningRecords is not a function`）。

- [x] **Step 3: 实现 service 方法**

`supplier-portal.service.ts`，紧跟 `getMyOpeningRecord`（:1184）之后插入：

```ts
  /**
   * 唱标记录列表（大厅公开视图，供应商侧）：
   * 自 OPENING 阶段起向本项目全体投标人公开各家唱标信息
   * （《电子招标投标办法》第30条：解密完成后向所有投标人公布名称/价格等唱标内容）。
   * 脱敏：异议原因/处理结果/操作人留痕（objectionReason/handleResult/handledBy/handledAt）
   * 属主持端裁决过程信息，不下发；confirmStatus 为大厅公开状态，保留。
   * 成员门控与 WS join:project 对齐（bid.gateway.ts）——非本项目投标人不得查看。
   */
  async listOpeningRecords(supplierId: string, projectId: string) {
    const member = await this.prisma.bidSupplier.findFirst({
      where: { projectId, supplierId },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenException({ error: '仅本项目投标人可查看开标记录', code: 'NOT_PROJECT_MEMBER' });
    }
    const project = await this.prisma.bidProject.findUnique({
      where: { id: projectId },
      select: { stage: true },
    });
    if (!project) throw new BadRequestException({ error: '项目不存在', code: 'NOT_FOUND' });
    if (!['OPENING', 'EVALUATING', 'ARCHIVED'].includes(project.stage)) {
      throw new BadRequestException({ error: '开标尚未开始，唱标记录暂不可见', code: 'OPENING_NOT_STARTED' });
    }
    return this.prisma.bidOpeningRecord.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        bidSupplierId: true,
        supplierName: true,
        amount: true,
        period: true,
        qualityTarget: true,
        bondStatus: true,
        decryptResult: true,
        confirmStatus: true,
        confirmedAt: true,
      },
    });
  }
```

（`ForbiddenException` 已在该文件 import 中，:1；无需新增 import。）

- [x] **Step 4: 实现 controller 路由**

`supplier-portal.controller.ts`，紧跟 `getMyOpeningRecord` 路由（:243-247）之后插入：

```ts
  @Get('bid-submissions/:projectId/opening-records')
  async listOpeningRecords(@Request() req: any, @Param('projectId') projectId: string) {
    const supplierId = await this.getSupplierId(req.user.sub);
    return this.portalService.listOpeningRecords(supplierId, projectId);
  }
```

（类级 `@Roles('supplier')` 已覆盖；Swagger 装饰器可选——同文件其他路由多数无 @ApiOperation，保持一致不加。）

- [x] **Step 5: 运行测试确认通过**

```bash
cd water-erp && pnpm --filter api test -- supplier-portal.service.spec
```

Expected: 全部 PASS（含既有用例无回归）。

- [x] **Step 6: Commit**

```bash
git add apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.controller.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts
git commit -m "feat(supplier-portal): 唱标记录列表端点——OPENING 起向本项目投标人公开各家唱标信息（脱敏）"
```

---

### Task 2: 前端——供应商大厅「唱标记录（全部投标人）」实时表

**Files:**
- Modify: `apps/supplier-portal/src/api/supplier.ts`（在 `getOpeningRecord` :74-76 之后新增）
- Modify: `apps/supplier-portal/src/views/bid/OpeningHall.vue`

**Interfaces:**
- Consumes: Task 1 的 `GET /api/supplier-portal/bid-submissions/:projectId/opening-records`（axios 拦截器已解包 `response.data`，返回值即数组）
- Produces: 大厅左侧新卡片（`records` ref + el-table），WS `opening:record:updated` → `refresh()` 自动带动

- [x] **Step 1: 新增 API 函数**

`apps/supplier-portal/src/api/supplier.ts`，紧跟 `getOpeningRecord`（:74-76）之后：

```ts
  // 唱标记录列表（大厅公开视图：自 OPENING 起向全体投标人公开各家唱标信息）
  getOpeningRecords(projectId: string) {
    return api.get(`/supplier-portal/bid-submissions/${projectId}/opening-records`)
  },
```

- [x] **Step 2: OpeningHall.vue script——新增 records 状态并接入 refresh**

`:16-27` 区域，`const record = ref<any>(null)` 之后新增：

```ts
const records = ref<any[]>([])
```

`refresh()`（:30-45）改为三路并发：

```ts
async function refresh() {
  // supplier-portal 的 axios 拦截器已解包 response.data（src/api/index.ts），返回值即响应体
  try {
    const [p, r, list] = await Promise.all([
      bidApi.getProject(projectId),
      supplierApi.getOpeningRecord(projectId).catch(() => null),
      // 开标前端点返回 400 OPENING_NOT_STARTED——捕获后置空列表，页面不报错
      supplierApi.getOpeningRecords(projectId).catch(() => null),
    ])
    project.value = p
    record.value = r
    records.value = list ?? []
    loadError.value = false
  } catch (e: any) {
    // 失败保留上次成功数据，仅置标志；首屏（project 为空）时由错误态 + 重试展示
    loadError.value = true
    loadErrorMsg.value = e?.response?.data?.error || e?.message || '加载开标大厅数据失败'
  }
}
```

WS 处理器**不动**——`onOpeningRecordUpdated: () => refresh()`（:125）现在会同时刷新本司记录与新列表。

- [x] **Step 3: OpeningHall.vue template——左侧新增记录表卡片**

`.left` 区块（:138-168）原 el-card 之后、`</div>`（`.left` 结束）之前追加：

```vue
      <el-card shadow="never" class="records-card">
        <template #header>
          <div class="head">
            <span>唱标记录（全部投标人）</span>
            <span class="online">{{ records.length }} 条</span>
          </div>
        </template>
        <el-table :data="records" size="small" empty-text="暂无唱标记录（开标后实时展示）">
          <el-table-column label="供应商" min-width="150">
            <template #default="{ row }">
              <span>{{ row.supplierName }}</span>
              <el-tag v-if="row.bidSupplierId === record?.bidSupplierId" size="small" type="info" class="self-tag">本司</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="amount" label="报价（元）" min-width="110" />
          <el-table-column prop="period" label="工期" min-width="100" />
          <el-table-column prop="qualityTarget" label="质量目标" min-width="110" />
          <el-table-column prop="bondStatus" label="保证金" min-width="90" />
          <el-table-column prop="confirmStatus" label="状态" min-width="110" />
        </el-table>
      </el-card>
```

样式区（`<style scoped>`）追加：

```css
.records-card { margin-top: 16px; }
.self-tag { margin-left: 6px; }
```

（`.head` / `.online` 复用既有类——`.online` 已带 `margin-left: auto`。）

- [x] **Step 4: 类型检查 / 构建验证**

```bash
cd water-erp/apps/supplier-portal && npx vue-tsc --noEmit
```

（若 `vue-tsc` 未安装则改跑 `cd water-erp && pnpm --filter supplier-portal build`，两者取其一即可，Expected: 0 error。）

- [x] **Step 5: 浏览器验证（真实链路）**

前置：`pnpm infra:up`、API :4001、供应商门户 :3004、开评标 :3007 均在运行；找一个 OPENING 阶段且已录入至少 2 家唱标的项目（现成：`y4i6qam1jqhggwpx0djg0kbn`，1 条记录）。

1. 供应商账号（如 `重庆蜀通岩土工程有限公司 / supplier@2026`）登录 :3004，进入该项目开标大厅：
   - 左侧新卡片「唱标记录（全部投标人）」出现，行数与主持端开标记录一致；本司行显示「本司」tag
   - 状态列如实显示「待供应商确认 / 供应商已确认」等
2. 另一浏览器用 `陈源远 / 陈源远@2026` 登录 :3007 进入该项目，对**另一家**供应商录入唱标：
   - 供应商端大厅**无需刷新**，新行在 1-2 秒内出现（WS `opening:record:updated` → refresh）
3. 主持人重录一家已录唱的供应商 → 供应商端该行金额即时更新
4. 供应商提出异议 → 主持端处理后 → 供应商端该行状态更新；确认列表行**不含**异议原因/处理结果文本
5. 反向验证：用一个**未参投**该项目的供应商账号访问 `GET /api/supplier-portal/bid-submissions/y4i6qam1jqhggwpx0djg0kbn/opening-records`（带 `token_supplier` cookie + `X-Portal: supplier`）→ 403 `NOT_PROJECT_MEMBER`

Expected: 全部符合；其中第 4 步「状态更新」依赖异议闭环（若现场环境不便可跳过，改由 Task 1 单测覆盖字段脱敏）。

- [x] **Step 6: Commit**

```bash
git add apps/supplier-portal/src/api/supplier.ts apps/supplier-portal/src/views/bid/OpeningHall.vue
git commit -m "feat(supplier-portal): 开标大厅新增唱标记录总表（全部投标人，WS 实时刷新，本司高亮）"
```

---

## Self-Review

**1. Spec coverage:** 用户要求两项——后端端点（Task 1）与前端实时表（Task 2）均覆盖；WS 已就绪无需改动（计划内显式说明）。「解密全部完成后公布」的严格口径以「边录边公开」决策呈现，已列入设计决策待审核。

**2. Placeholder scan:** 所有代码块为完整可粘贴内容；无 TBD/待补。

**3. Type consistency:** `listOpeningRecords` 命名、参数顺序（supplierId, projectId）、`select` 字段集在 service/controller/spec/前端消费（`bidSupplierId` 高亮、`confirmStatus` 状态列）各处一致；`records` ref 与模板绑定名一致。

---

## 执行记录（2026-08-18 完成）

- 提交：`50a47211`（Task 1 后端端点）、`bea302f0`（Task 2 前端总表），均在 main。
- **偏差 1（Task 1 测试）**：计划的 `result[1]).not.toHaveProperty('objectionReason'...)` 断言在 jest mock 下不可行——mock 原样返回含字段的对象，Prisma `select` 过滤不被模拟。改为断言 `findMany` 调用的 `select` 白名单不含 `objectionReason/handleResult/handledBy/handledAt` 且含 `confirmStatus`（脱敏契约即 select，spec 内已注释）。
- **偏差 2（Task 2 模板）**：计划「复用 `.head`/`.online`」基于旧版头结构——本会话早些时候已把第一卡头部重构为纵向 `.head`（项目名/在场徽标两行），`.online` 类已不存在。记录卡改用自包含 `.records-head`（flex 两端对齐）+ `.records-count`（等宽数字灰色小字），样式与设计系统一致。
- **验证**：单测 55/55（service spec）；`pnpm --filter supplier-portal build` 通过（vue-tsc 未安装）。真实链路（curl + CDP 无头 Chrome，chrome-devtools MCP 当会话已失效）：
  - 成员（华建/四大队）200 两条记录、createdAt 升序、白名单字段无异议过程字段 ✓
  - 非本项目投标人（蜀通）403 NOT_PROJECT_MEMBER ✓（另注：当前种子该项目的投标人为 四大队/十二大队/华建——早前会话后 `db:seed` 已重灌，蜀通不再是本项目成员）
  - 主持人重录四大队 1420000→1435000，公开列表即时更新 ✓
  - WS 实时：node socket.io-client 以华建 token 连 `/bid` 命名空间 join:project 后，主持人录入唱标 1 秒内收到 `opening:record:updated`（payload 带 Supplier.id、唱标金额，无密封报价）✓
  - 页面 DOM：记录卡标题「唱标记录（全部投标人）· 2 条」、两行数据、本司行带「本司」tag ✓（截图存 /tmp/hall.png|jpg，当会话 Read 不支持图片渲染）
  - 400 OPENING_NOT_STARTED 未做现场验证：当前种子无「成员 × 开标前阶段」项目组合，由单测覆盖；异议闭环状态更新（Step 4）同理由单测覆盖，按计划备注跳过。
