# RolesGuard 默认拒绝 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RolesGuard 无 `@Roles`/`@Public`/`@AnyRole` 的路由默认 403——消除约 20 controller / ~298 handler 的越权面（supplier 可读预算/审计/管理端点），每处访问成为明示决策；先标注后翻转，全程单测 + CI 两 job 全绿。

**Architecture:** 新增 `@AnyRole()` 装饰器（认证边界语义）+ RolesGuard 默认分支翻转（403 `NO_ROLE_CONFIGURED`）+ 运行时元数据扫描脚本（tsx，MetadataScanner 遍历 AppModule 全路由，替代静态 grep 的假阳/假阴）+ 逐 controller 标注（前端调用面 grep 反推角色集）+ CI e2e 追加 guard 抽查（supplier 打管理端点必 403）。

**Tech Stack:** NestJS 11（Reflector/SetMetadata）；tsx 脚本；pnpm workspace。

**Spec:** `water-erp/docs/superpowers/specs/2026-08-26-roles-guard-default-deny-design.md`（§3 设计/§5 风险为权威）

## Global Constraints

- **顺序铁律**：Task 1-2（基础设施）→ Task 3-N（标注批次，每批全绿）→ Task N+1（翻转，最后执行）。翻转前任何时刻守卫行为与现状一致。
- **归类依据优先级**：前端调用点 grep（各门户 `src/` 目录对该路由的 fetch/api 调用）> 模块语义 > 存疑保守（先具体角色集，跑 e2e 后再放宽）。
- **禁止**：本计划不动自定义 Guard（ProcurementGuard/OwnerGuard）与 service 层 ownership 校验；不动 `@Public` 覆盖逻辑；不动 AuthGuard。
- 验证命令：全量单测 `pnpm --filter api test`；扫描脚本 `npx tsx scripts/list-uncovered-routes.ts`（apps/api 下）；前端消费 grep 在 worktree 的 `apps/<portal>/src` 内。
- commit 前查分支；不主动 push；TS import 约定（无 esModuleInterop）。
- 翻转后（Task 8）必须跑 CI 全两 job（push 触发或 gh workflow dispatch）确认绿，才算完成。

---

### Task 1: `@AnyRole()` 装饰器 + RolesGuard 翻转（含单测，翻转代码就位但**不生效**——默认分支仍是放行）

**说明**：守卫的默认拒绝分支与 `@AnyRole` 支持一次性写好并全测，但默认分支保留旧行为（`return true`），加 TODO 标记 Task 8 才翻转——避免中途态大红。

**Files:**
- Create: `apps/api/src/common/decorators/any-role.decorator.ts`
- Create: `apps/api/src/common/guards/roles.guard.spec.ts`（无既有 spec，新建）
- Modify: `apps/api/src/common/guards/roles.guard.ts`
- Modify: `apps/api/src/common/common.module.ts`（若装饰器无需注册则跳过——SetMetadata 无需 module 变更）

**Interfaces:**
- Produces: `AnyRole()` 装饰器（`ANY_ROLE_KEY = 'any_role'`）；RolesGuard 识别 `ANY_ROLE_KEY` 元数据；错误码 `NO_ROLE_CONFIGURED`（Task 8 起生效）。

- [ ] **Step 1: 失败测试**（`roles.guard.spec.ts`）——直接构造 Reflector mock（`getAllAndOverride` 按 key 返回），不 boot Nest：

```ts
import { RolesGuard } from './roles.guard';

describe('RolesGuard — 默认拒绝语义', () => {
  let guard: RolesGuard;
  let reflector: any;
  const ctx = (user?: { sub: string; role: string }) => ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => 'h',
    getClass: () => class {},
  });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as any);
  });
  const meta = ({ pub, any, roles }: { pub?: boolean; any?: boolean; roles?: string[] }) =>
    reflector.getAllAndOverride.mockImplementation((_k: string) =>
      _k === 'isPublic' ? pub : _k === 'any_role' ? any : _k === 'roles' ? roles : undefined);

  it('@AnyRole + 已登录 user → 放行', () => {
    meta({ any: true });
    expect(guard.canActivate(ctx({ sub: 'u1', role: 'supplier' } as any))).toBe(true);
  });
  it('@AnyRole + 无 user → 403 UNAUTHORIZED', () => {
    meta({ any: true });
    expect(() => guard.canActivate(ctx(undefined as any))).toThrowError();
  });
  it('@Roles 匹配 → 放行（回归）', () => {
    meta({ roles: ['staff'] });
    expect(guard.canActivate(ctx({ sub: 'u1', role: 'staff' } as any))).toBe(true);
  });
  it('@Roles 不匹配 → 403 FORBIDDEN（回归）', () => {
    meta({ roles: ['staff'] });
    expect(() => guard.canActivate(ctx({ sub: 'u1', role: 'supplier' } as any))).toThrowError();
  });
});
```

（翻转测试「三者皆无 → 403 NO_ROLE_CONFIGURED」在 Task 8 补——Task 1 阶段该行为还是放行，写了必红。）

- [ ] **Step 2: RED 确认**（AnyRole key 未被识别 → 用例 1 红）
- [ ] **Step 3: 实现**——`any-role.decorator.ts`（SetMetadata）+ 守卫加 `ANY_ROLE_KEY` 分支（默认分支留 `return true` + `// TODO(Task 8): 翻转为 NO_ROLE_CONFIGURED 拒绝`）
- [ ] **Step 4: GREEN + 全量单测**
- [ ] **Step 5: Commit** `feat(common): @AnyRole 装饰器与守卫支持（默认翻转就位待启用）`

### Task 2: 运行时元数据扫描脚本

**Files:**
- Create: `apps/api/scripts/list-uncovered-routes.ts`

**Interfaces:**
- Produces: `npx tsx scripts/list-uncovered-routes.ts [--json out.json]`——实例化 `AppModule`（`NestFactory.create(AppModule, { logger: false })` 后立即 close），用 `app.getHttpAdapter().getInstance()` 取路由表（Express 底层 `router.stack`），对每条路由经 `Reflector.getAllAndOverride` 读三 key 元数据（需要从 guard 侧导出 key 常量或重复定义——实现时选导出），输出无覆盖路由清单（method/path/controller.handler/建议动作）+ 汇总计数；`--json` 输出机器可读版供后续比对。
- 不连外部服务：Prisma/Redis/MinIO 连接失败需容忍（`AppModule` 初始化若强依赖会挂——实测确认，若挂则降级为「按 controller 文件静态扫描但用 decorator 元数据 key 匹配」的二档实现，输出同格式）。

- [ ] **Step 1: 实现** → **Step 2: 跑出基线清单**（保存 `tmp-uncovered-baseline.json`，dry 输出贴报告：期望 ~298 条，与静态扫描差异需解释）→ **Step 3: Commit** `feat(scripts): 无角色覆盖路由扫描脚本（运行时元数据）`

### Task 3-N: 逐 controller 标注（5 个批次，每批一个 Task）

**通用流程（每批相同，以批内每个 controller 为单位）：**
1. 对批内每个 controller：grep 六个门户（`apps/{web,expert-portal,bid-portal,supplier-portal,mall,public-portal}/src`）对该路由前缀的消费点，记录消费角色（按门户角色集推断：:3005→staff/leader/admin、:3006→bid_expert、:3004→supplier、:3003→mall、:3007→admin/bid_host/leader/staff）；
2. 按归类规则（spec §3.4）写 `@Roles(...)` / `@AnyRole()` / `@Public`——**类级优先**（controller 内全部路由同角色时），混装时方法级；
3. 跑该 controller 相关 spec（如有）+ 全量单测；
4. 更新 `tmp-uncovered-baseline.json`（扫描脚本重跑，本批应清零）。

**批次划分**（按风险从高到低，每批 Task 边界 = 可独立审查的语义组）：

**Task 3: 高敏感批（账号与审计面）**——`auth/auth.controller.ts`（15 条裸路由：register/companies/users approve|reject 等）、`auth/account-admin.controller.ts`、`auth/password-requests.controller.ts`（12 条）、`operation-log/operation-log.controller.ts`（4 条）、`audit/`（若有裸路由）、`system-config`（2 条）。
- [ ] 标注 + 测试 + 扫描清零 + Commit `feat(api): 高敏感 controller 角色标注（auth/operation-log/system-config）`

**Task 4: 管理与业务面批**——`ai/ai.controller.ts`（23）、`catalog/catalog.controller.ts`（42，注意 admin/* 与公共读分离）、`tender-review/tender-review.controller.ts`（16，rules 已有部分方法级 Roles、补齐）、`procurement/`（9）+ `procurements/`（9）、`budget/`、`search/`（1）。
- [ ] 同上流程 + Commit

**Task 5: 专家与开评标面批**——`expert/expert-admin.controller.ts`（48）、`expert/expert.controller.ts`（若有裸路由）、`bid/bid-sign-packet.controller.ts`（7）、`opening-hall/opening-hall.controller.ts`（7，注意 supplier/expert/host 三角色混用）。
- [ ] 同上 + Commit

**Task 6: 供应商与联系人面批**——`supplier/supplier.controller.ts`（60）、`supplier/rsvp.controller.ts`（1）、`contacts/contacts.controller.ts`（6）、`verification/verification.controller.ts`（4，确认方法级 Roles 是否已覆盖——静态扫描假阳项）。
- [ ] 同上 + Commit

**Task 7: 通用与杂项批**——`assistant/`（8，水叮当无登录场景→逐条判断 @Public vs @AnyRole）、`app.controller.ts`（2→@Public）、`notification/`、`dashboard/`、`badge/`、`progress/`、`work-arrangements/`、`alerts/`、`chat/`、`project-management/`、`company/`、`imports/`、`knowledge/`、`tender-write/`、`tender-sample/`、`tender-history/`、`upload/`（已有 AUTHENTICATED_ROLES 类级——确认覆盖完整性）。
- [ ] 同上 + Commit `feat(api): 全量 controller 角色标注完成（扫描清单清零）`

### Task 8: 翻转默认分支 + e2e 抽查 + CI 验证

**Files:**
- Modify: `apps/api/src/common/guards/roles.guard.ts`（删 TODO 注释，默认分支改 403 `NO_ROLE_CONFIGURED`）
- Modify: `apps/api/src/common/guards/roles.guard.spec.ts`（补「三者皆无 → 403 NO_ROLE_CONFIGURED」用例）
- Modify: `.github/workflows/ci.yml`（e2e job 追加 guard 抽查步骤）

- [ ] **Step 1: 补守卫翻转用例（先红后绿）**——删默认放行、改抛 `NO_ROLE_CONFIGURED`；全量单测（此步应全绿——Task 3-7 已清零裸路由；任何红 = 漏标注，回补对应 controller）
- [ ] **Step 2: 扫描脚本终验**——输出空清单
- [ ] **Step 3: CI e2e 追加 guard 抽查**——e2e job 在新轨 e2e 之后加一步：supplier token `GET /operation-log/archive` 与 `POST /catalog/admin/items` → 断言 403；admin token 同端点正常
- [ ] **Step 4: 本地全套**（单测 + 扫描 + 若可行手动 e2e）→ Commit `feat(api): RolesGuard 默认拒绝生效（安全 P0 收口）` + push 触发 CI
- [ ] **Step 5: CI 两 job 全绿确认**（`gh run watch`）——绿了才算完成

### Task 9: 文档收尾

- [ ] **Step 1: CLAUDE.md（Bash 追加）**——鉴权段补：默认拒绝语义、`@AnyRole` 定位（认证边界非授权）、`NO_ROLE_CONFIGURED` 排障提示、扫描脚本用法
- [ ] **Step 2: spec 状态改「已实施」** → **Step 3: Commit** `docs: RolesGuard 默认拒绝落地文档`

---

## Self-Review 记录

1. **Spec 覆盖**：§3.1→Task 1；§3.2→Task 1+8；§3.3→Task 2；§3.4→Task 3-7（批次=归类执行）；§3.5→Task 8；§3.6→Task 9；§4 测试→Task 1/8；§5 风险 1-2→归类保守+放宽策略已入 Global Constraints。无缺口。
2. **占位符扫描**：无 TBD；Task 3-7 的「通用流程」是共享程序定义于 Task 3 之前，各批 Task 引用执行——不算占位。
3. **类型一致性**：`ANY_ROLE_KEY = 'any_role'`（decorator 与 guard 与脚本三处一致，Task 1 导出）；错误码 `NO_ROLE_CONFIGURED` 与 spec §3.2 逐字；脚本输出格式在 Task 2 Interfaces 固定。
4. **已知取舍**：Task 2 若 AppModule boot 挂（外部依赖）降级静态实现——输出格式不变，语义略降（假阳需人工核对），报告如实记录。
