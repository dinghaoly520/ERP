# 公告回收站体系（隐藏/下架/恢复）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** :3005 公告发布中心以「隐藏/下架」取代删除、右上角回收站（查看 + 恢复、无清空），全 UI 不再有任何公告硬删除入口。

**Architecture:** 后端 `AnnouncementStatus` 枚举扩 `HIDDEN/OFFLINE` 两值（唯一一次 DB 迁移），三个新服务方法 + 三个 POST 端点，回收信息（原状态/动作/时间/操作人）合并进 `metadata.recycle`；`list()` 默认排除回收态、支持逗号分隔 status 查询回收站内容。前端复用既有 Modal/neu-table 体系，新回收站组件以 `status=HIDDEN,OFFLINE` 拉取，详情用大 Modal 内嵌 iframe 加载正常详情页 `/notice/{id}`。

**Tech Stack:** NestJS + Prisma(Postgres) + jest；Next.js App Router + sonner + lucide-react + neu-* 设计类。

**Spec:** `docs/superpowers/specs/2026-09-26-announcement-recycle-bin-design.md`

## Global Constraints

- 所有用户可见文案中文；代码注释密度/风格随既有文件（中文业务注释 + 日期拍板注记）。
- 公开门户/供应商门户零改动（publicList 仅出 PUBLISHED、getPublic 拒绝非 PUBLISHED）。
- `DELETE /announcements/:id` 后端保留，UI 全面停用——**任何页面不得再出现"删除"公告按钮**。
- ⚠️ `apps/api/src/announcement/announcement.service.ts` 工作区有用户在飞行 WIP（`notifySuppliersOnPublish` 降噪，行 523–686 区域）。**本文件提交必须 stash 隔离**（见 Task 2 Step 6），不得把用户 WIP 提进功能提交。
- 提交一律 `git add <明确文件>`，禁止 `git add -A`（工作区有他人未提交文件）。
- 构建坑位（memory）：api 增量编译常假成功 → 改后端必须 `rm -rf dist` 全量 build；`prisma generate` 前置于任何 api 编译；改后端 curl 冒烟前须重启 :4001（脱离式，防 orphan/端口冲突）。
- :3005 视觉验证按 memory 配方：playwright 绝对路径 require + 系统 Chrome；登录口令漂移以 memory 快照为准（admin@2026 优先，qyt1234/123456 兜底）。

---

### Task 1: DB 枚举扩值 + Prisma 客户端

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（enum AnnouncementStatus，约 1771–1775 行）
- Create: `apps/api/prisma/migrations/20260926090000_announcement_recycle_statuses/migration.sql`

**Interfaces:**
- Produces: Prisma 类型 `AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'HIDDEN' | 'OFFLINE'`（后续所有任务的编译前提）

- [ ] **Step 1: 改 schema 枚举**

`apps/api/prisma/schema.prisma` 中：

```prisma
enum AnnouncementStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
  HIDDEN   // 2026-09-26 回收站：隐藏（任意状态可入）
  OFFLINE  // 2026-09-26 回收站：下架（仅已发布可下架）
}
```

- [ ] **Step 2: 手工建迁移 SQL（dev 库有迁移漂移史，`migrate dev` 会触发 reset 提示，走手工 + deploy）**

创建 `apps/api/prisma/migrations/20260926090000_announcement_recycle_statuses/migration.sql`：

```sql
-- 2026-09-26 公告回收站体系：状态枚举扩值（隐藏/下架）
ALTER TYPE "AnnouncementStatus" ADD VALUE 'HIDDEN';
ALTER TYPE "AnnouncementStatus" ADD VALUE 'OFFLINE';
```

- [ ] **Step 3: 生成客户端 + 应用迁移**

```bash
cd /Users/qihao/ERP2/ERP/water-erp
pnpm db:generate                                  # prisma generate（api filter）
pnpm --filter api exec prisma migrate deploy      # 应用新迁移（不触发 reset 提示）
pnpm --filter api exec prisma migrate status      # 确认无 failed / pending
```

Expected: generate 成功；deploy 输出包含 `announcing migration announcement_recycle_statuses`；status 显示 `Database schema is up to date!`
若 deploy 报 `ALTER TYPE ... cannot run inside a transaction block`（PG<12）：直接 psql 执行两条 ALTER TYPE，然后 `pnpm --filter api exec prisma migrate resolve --applied 20260926090000_announcement_recycle_statuses`。

- [ ] **Step 4: 提交**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20260926090000_announcement_recycle_statuses/
git commit -m "feat(announcement): 状态枚举扩 HIDDEN/OFFLINE（回收站体系）"
```

---

### Task 2: 后端 service 回收站方法 + list 排除（TDD）

**Files:**
- Modify: `apps/api/src/announcement/announcement.service.ts`（`list()` 约 193 行起；新方法插在 `confirmWinnerNotice` 之后约 640 行处）
- Test: `apps/api/src/announcement/announcement.service.spec.ts`（文件末尾追加 describe）

**Interfaces:**
- Consumes: Task 1 的枚举值
- Produces（Task 3 依赖，签名务必一致）:
  - `service.hide(id: string, operator?: RecycleOperator): Promise<Announcement>`
  - `service.offline(id: string, operator?: RecycleOperator): Promise<Announcement>`
  - `service.restore(id: string, operator?: RecycleOperator): Promise<Announcement>`
  - `export type RecycleOperator = { operatorId?: string; operatorName?: string; ipAddress?: string; userAgent?: string }`
  - 错误码：`ALREADY_IN_RECYCLE` / `NOT_PUBLISHED_FOR_OFFLINE` / `NOT_IN_RECYCLE`（均 ConflictException 409）、`NOT_FOUND`（404）

- [ ] **Step 1: 先写失败测试**——`announcement.service.spec.ts` 末尾追加：

```typescript
describe('AnnouncementService — 回收站体系（隐藏/下架/恢复，2026-09-26）', () => {
  let service: AnnouncementService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      announcement: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn(), findMany: jest.fn() },
      announcementHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnnouncementAiService, useValue: {} },
      ],
    }).compile();
    service = module.get(AnnouncementService);
  });

  const op = { operatorId: 'u1', operatorName: '张三' };

  it('hide：任意状态 → HIDDEN，metadata.recycle 记录原状态且保留其余键，历史记 HIDE', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'DRAFT', metadata: { foo: 1 } });
    prisma.announcement.update.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'HIDDEN' });
    await expect(service.hide('a1', op)).resolves.toMatchObject({ status: 'HIDDEN' });
    const arg = prisma.announcement.update.mock.calls[0][0];
    expect(arg.data.status).toBe('HIDDEN');
    expect(arg.data.metadata).toMatchObject({ foo: 1, recycle: { from: 'DRAFT', action: 'HIDDEN' } });
    expect(prisma.announcementHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'HIDE', announcementId: 'a1' }),
    }));
  });

  it('hide：已在回收站 → 409 ALREADY_IN_RECYCLE，零写入', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'HIDDEN', metadata: {} });
    await expect(service.hide('a1', op)).rejects.toMatchObject({ response: { code: 'ALREADY_IN_RECYCLE' } });
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });

  it('offline：已发布 → OFFLINE，recycle.from=PUBLISHED，历史记 OFFLINE', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'BID_NOTICE', status: 'PUBLISHED', metadata: null });
    prisma.announcement.update.mockResolvedValue({ id: 'a1', title: 't', type: 'BID_NOTICE', status: 'OFFLINE' });
    await expect(service.offline('a1', op)).resolves.toMatchObject({ status: 'OFFLINE' });
    const arg = prisma.announcement.update.mock.calls[0][0];
    expect(arg.data.metadata.recycle).toMatchObject({ from: 'PUBLISHED', action: 'OFFLINE' });
    expect(prisma.announcementHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'OFFLINE' }),
    }));
  });

  it('offline：非已发布 → 409 NOT_PUBLISHED_FOR_OFFLINE，零写入', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'DRAFT', metadata: null });
    await expect(service.offline('a1', op)).rejects.toMatchObject({ response: { code: 'NOT_PUBLISHED_FOR_OFFLINE' } });
    expect(prisma.announcement.update).not.toHaveBeenCalled();
  });

  it('restore：按 metadata.recycle.from 恢复并清除 recycle 键，历史记 RESTORE', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'OFFLINE', metadata: { recycle: { from: 'PUBLISHED', action: 'OFFLINE', at: 'x' }, foo: 2 } });
    prisma.announcement.update.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'PUBLISHED' });
    await expect(service.restore('a1', op)).resolves.toMatchObject({ status: 'PUBLISHED' });
    const arg = prisma.announcement.update.mock.calls[0][0];
    expect(arg.data.status).toBe('PUBLISHED');
    expect(arg.data.metadata).toEqual({ foo: 2 });
    expect(prisma.announcementHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'RESTORE' }),
    }));
  });

  it('restore：from 缺失/非法 → 兜底 DRAFT', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'HIDDEN', metadata: null });
    prisma.announcement.update.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'DRAFT' });
    await expect(service.restore('a1', op)).resolves.toMatchObject({ status: 'DRAFT' });
  });

  it('restore：不在回收站 → 409 NOT_IN_RECYCLE', async () => {
    prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', title: 't', type: 'POLICY', status: 'PUBLISHED', metadata: null });
    await expect(service.restore('a1', op)).rejects.toMatchObject({ response: { code: 'NOT_IN_RECYCLE' } });
  });

  it('list：无 status 默认排除回收态；HIDDEN,OFFLINE 逗号查询只出回收站；单值不受影响', async () => {
    prisma.announcement.count.mockResolvedValue(0);
    prisma.announcement.findMany.mockResolvedValue([]);
    await service.list({});
    expect(prisma.announcement.findMany.mock.calls[0][0].where.status).toEqual({ notIn: ['HIDDEN', 'OFFLINE'] });
    await service.list({ status: 'HIDDEN,OFFLINE' });
    expect(prisma.announcement.findMany.mock.calls[1][0].where.status).toEqual({ in: ['HIDDEN', 'OFFLINE'] });
    await service.list({ status: 'PUBLISHED' });
    expect(prisma.announcement.findMany.mock.calls[2][0].where.status).toBe('PUBLISHED');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter api exec jest announcement.service.spec.ts 2>&1 | tail -20
```
Expected: 新 describe 全红（`service.hide is not a function` 等），既有 describe 保持绿。

- [ ] **Step 3: 实现**——service 两处修改：

(a) `list()` 中 `if (params.status) where.status = params.status;` 替换为：

```typescript
    if (params.status) {
      // 2026-09-26 回收站体系：status 支持逗号分隔（回收站传 HIDDEN,OFFLINE），与 type 逗号语义一致
      const statuses = params.status.split(',').map((s: string) => s.trim()).filter(Boolean);
      where.status = statuses.length > 1 ? { in: statuses } : params.status;
    } else {
      // 2026-09-26 回收站体系：默认排除回收站内容（隐藏/下架只在回收站可见，公开端本就只出 PUBLISHED）
      where.status = { notIn: ['HIDDEN', 'OFFLINE'] };
    }
```

(b) `confirmWinnerNotice` 方法之后插入（`RecycleOperator` 类型放 class 外、文件内任意 import 之后）：

```typescript
/** 回收站操作人上下文（与 confirmWinnerNotice 的 operator 同构，2026-09-26） */
export type RecycleOperator = { operatorId?: string; operatorName?: string; ipAddress?: string; userAgent?: string };

// —— class AnnouncementService 内 ——

  /* ── 回收站体系（2026-09-26）：隐藏/下架/恢复，UI 不再提供删除 ── */

  /** 隐藏：任意状态 → HIDDEN，进回收站（主列表与公开门户均不可见） */
  async hide(id: string, operator: RecycleOperator = {}) {
    return this.applyRecycle(id, 'HIDDEN', operator);
  }

  /** 下架：仅已发布可下架 → OFFLINE，进回收站（撤下公开门户） */
  async offline(id: string, operator: RecycleOperator = {}) {
    return this.applyRecycle(id, 'OFFLINE', operator);
  }

  /** 隐藏/下架共用落地：状态流转 + metadata.recycle 留痕（原状态/动作/时间/操作人）+ 历史动作 */
  private async applyRecycle(id: string, target: 'HIDDEN' | 'OFFLINE', operator: RecycleOperator) {
    const ann = await this.prisma.announcement.findUnique({ where: { id } });
    if (!ann) throw new NotFoundException({ error: '公告不存在', code: 'NOT_FOUND' });
    if (ann.status === 'HIDDEN' || ann.status === 'OFFLINE') {
      throw new ConflictException({ error: '该公告已在回收站中，请先恢复后再操作', code: 'ALREADY_IN_RECYCLE' });
    }
    if (target === 'OFFLINE' && ann.status !== 'PUBLISHED') {
      throw new ConflictException({ error: '仅「已发布」的公告可下架，草稿/已公示请用隐藏', code: 'NOT_PUBLISHED_FOR_OFFLINE' });
    }
    // 合并写入：保留其余 metadata 键（编辑页整存 metadata 时 recycle 随行）
    const meta = { ...((ann.metadata as Record<string, any>) ?? {}) };
    meta.recycle = { from: ann.status, action: target, at: new Date().toISOString(), by: operator.operatorName ?? null };
    const result = await this.prisma.announcement.update({ where: { id }, data: { status: target, metadata: meta as any } });
    await this.prisma.announcementHistory.create({
      data: {
        announcementId: id, action: target === 'HIDDEN' ? 'HIDE' : 'OFFLINE',
        title: result.title, type: result.type, status: result.status, changedFields: ['status'],
        operatorId: operator.operatorId ?? null, operatorName: operator.operatorName ?? null,
        ipAddress: operator.ipAddress ?? null, userAgent: operator.userAgent ?? null,
      },
    }).catch(e => this.logger.warn(`回收站留痕写入失败（不阻塞）: ${(e as Error).message}`));
    this.logger.log(`公告 ${id} 已${target === 'HIDDEN' ? '隐藏' : '下架'}进回收站（原状态 ${ann.status}）`);
    return result;
  }

  /** 恢复：按 metadata.recycle.from 还原状态并清除回收标记（缺失/非法兜底 DRAFT） */
  async restore(id: string, operator: RecycleOperator = {}) {
    const ann = await this.prisma.announcement.findUnique({ where: { id } });
    if (!ann) throw new NotFoundException({ error: '公告不存在', code: 'NOT_FOUND' });
    if (ann.status !== 'HIDDEN' && ann.status !== 'OFFLINE') {
      throw new ConflictException({ error: '该公告不在回收站中', code: 'NOT_IN_RECYCLE' });
    }
    const meta = (ann.metadata as Record<string, any>) ?? {};
    const from = ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(meta.recycle?.from) ? meta.recycle.from : 'DRAFT';
    const { recycle: _dropped, ...rest } = meta;
    const result = await this.prisma.announcement.update({ where: { id }, data: { status: from, metadata: rest as any } });
    await this.prisma.announcementHistory.create({
      data: {
        announcementId: id, action: 'RESTORE', title: result.title, type: result.type, status: result.status,
        changedFields: ['status'],
        operatorId: operator.operatorId ?? null, operatorName: operator.operatorName ?? null,
        ipAddress: operator.ipAddress ?? null, userAgent: operator.userAgent ?? null,
      },
    }).catch(e => this.logger.warn(`回收站恢复留痕写入失败（不阻塞）: ${(e as Error).message}`));
    this.logger.log(`公告 ${id} 已从回收站恢复为 ${from}`);
    return result;
  }
```

（`NotFoundException`/`ConflictException` 已在文件 import——`remove()` 在用。）

- [ ] **Step 4: 跑测试确认全绿**

```bash
pnpm --filter api exec jest announcement.service.spec.ts 2>&1 | tail -8
```
Expected: 全部 PASS（含既有 P0-4 删除闸门 describe）。

- [ ] **Step 5: 全量构建验证（增量假成功坑）**

```bash
rm -rf apps/api/dist && pnpm --filter api build
```
Expected: 编译零错误。

- [ ] **Step 6: stash 隔离提交（⚠️ 该文件含用户在飞行 WIP）**

```bash
git stash push -m "user-wip-notify-suppliers" -- apps/api/src/announcement/announcement.service.ts
git add apps/api/src/announcement/announcement.service.ts apps/api/src/announcement/announcement.service.spec.ts
git commit -m "feat(announcement): 回收站体系 service——hide/offline/restore + list 默认排除回收态"
git stash pop    # 用户 WIP 回到工作区（区域不相交，应无冲突；若有冲突：stash 内容为准保留两侧，人工确认）
git status --short -- apps/api/src/announcement/announcement.service.ts   # 应仍显示 M（WIP 回来了）
```

---

### Task 3: 后端 controller 三端点 + 冒烟

**Files:**
- Modify: `apps/api/src/announcement/announcement.controller.ts`（插在 `confirmWinner` 之后约 407 行）

**Interfaces:**
- Consumes: Task 2 的 `service.hide/offline/restore(id, RecycleOperator)`
- Produces（Task 4 依赖）:
  - `POST /announcements/:id/hide` → `Announcement`
  - `POST /announcements/:id/offline` → `Announcement`
  - `POST /announcements/:id/restore` → `Announcement`
  - 角色门：`@Roles('admin', 'bid_host', 'leader', 'staff')`（与 update 一致）

- [ ] **Step 1: 实现端点**（`confirmWinner` 方法后插入）：

```typescript
  // ─── 回收站（2026-09-26：隐藏/下架/恢复取代删除，UI 不再提供删除入口）───

  @Post(':id/hide')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '隐藏公告（任意状态 → 回收站）' })
  async hide(@Param('id') id: string, @Request() req: any) {
    await this.assertAnnouncementScope(id, req.user);
    return this.announcementService.hide(id, this.recycleOperator(req));
  }

  @Post(':id/offline')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '下架公告（仅已发布 → 回收站）' })
  async offline(@Param('id') id: string, @Request() req: any) {
    await this.assertAnnouncementScope(id, req.user);
    return this.announcementService.offline(id, this.recycleOperator(req));
  }

  @Post(':id/restore')
  @Roles('admin', 'bid_host', 'leader', 'staff')
  @ApiOperation({ summary: '从回收站恢复（还原隐藏/下架前状态）' })
  async restore(@Param('id') id: string, @Request() req: any) {
    await this.assertAnnouncementScope(id, req.user);
    return this.announcementService.restore(id, this.recycleOperator(req));
  }

  /** 回收站操作人上下文（controller 侧统一取 req） */
  private recycleOperator(req: any) {
    return {
      operatorId: req.user.sub,
      operatorName: req.user.username,
      ipAddress: this.clientIp(req),
      userAgent: req.headers?.['user-agent'],
    };
  }
```

- [ ] **Step 2: 全量构建**

```bash
rm -rf apps/api/dist && pnpm --filter api build
```
Expected: 零错误。

- [ ] **Step 3: 重启 :4001（脱离式，防 orphan/端口冲突）**

```bash
lsof -ti :4001 | xargs kill 2>/dev/null; sleep 1
cd /Users/qihao/ERP2/ERP/water-erp && nohup pnpm --filter api start:dev > /tmp/api-dev.log 2>&1 & disown
sleep 12 && grep -E "Nest application successfully started|error" /tmp/api-dev.log | tail -3
```

- [ ] **Step 4: curl 冒烟（login 口令漂移以 memory 为准：admin@2026 优先，qyt1234/123456 兜底）**

```bash
# 登录（X-Portal 头；Bearer 不通）
curl -s -X POST http://localhost:4001/api/auth/login -H 'Content-Type: application/json' \
  -H 'X-Portal: web' -d '{"username":"admin","password":"admin@2026"}' -c /tmp/rb-cookie.txt | head -c 300

# 建冒烟公告（草稿）→ 隐藏 → 回收站查询 → 恢复 → 再隐藏（留在回收站供 Task 9 截图）
AID=$(curl -s -X POST http://localhost:4001/api/announcements -b /tmp/rb-cookie.txt \
  -H 'Content-Type: application/json' \
  -d '{"title":"回收站冒烟-勿动-2026-09-26","content":"recycle smoke","type":"PLATFORM"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "AID=$AID"
curl -s -X POST http://localhost:4001/api/announcements/$AID/hide -b /tmp/rb-cookie.txt | python3 -m json.tool | grep -E '"status"|recycle' 
curl -s "http://localhost:4001/api/announcements?status=HIDDEN,OFFLINE&pageSize=5" -b /tmp/rb-cookie.txt | python3 -c 'import sys,json;d=json.load(sys.stdin);print("recycle total:",d["total"])'
curl -s -X POST http://localhost:4001/api/announcements/$AID/restore -b /tmp/rb-cookie.txt | python3 -m json.tool | grep '"status"'
curl -s -X POST http://localhost:4001/api/announcements/$AID/hide -b /tmp/rb-cookie.txt > /dev/null && echo "left-in-recycle OK"
# 主列表默认不含回收态：
curl -s "http://localhost:4001/api/announcements?pageSize=1" -b /tmp/rb-cookie.txt | python3 -c 'import sys,json;print("first-item-status:",json.load(sys.stdin)["items"][0]["status"])'
```
Expected: hide 后 status=HIDDEN 且 metadata.recycle.from=DRAFT；recycle total ≥1；restore 后 status=DRAFT；主列表首条 status 不是 HIDDEN/OFFLINE。

- [ ] **Step 5: 提交**（controller 无用户 WIP，正常提交）

```bash
git add apps/api/src/announcement/announcement.controller.ts
git commit -m "feat(announcement): 回收站三端点 hide/offline/restore（角色与公司隔离同 update）"
```

---

### Task 4: web API 客户端（类型 + 三函数）

**Files:**
- Modify: `apps/web/src/lib/api/announcement.ts`

**Interfaces:**
- Consumes: Task 3 的三个 POST 端点
- Produces（Task 5/6/7/8 依赖）:
  - `AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'HIDDEN' | 'OFFLINE'`
  - `interface AnnouncementRecycleInfo { from: AnnouncementStatus; action: 'HIDDEN' | 'OFFLINE'; at: string; by?: string | null }`
  - `hideAnnouncement(id: string): Promise<AnnouncementListItem>`
  - `offlineAnnouncement(id: string): Promise<AnnouncementListItem>`
  - `restoreAnnouncement(id: string): Promise<AnnouncementListItem>`
  - `AnnouncementHistoryAction` 增 `'HIDE' | 'OFFLINE' | 'RESTORE'`

- [ ] **Step 1: 修改四处**：

(a) 第 5 行状态类型替换：

```typescript
export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' | 'HIDDEN' | 'OFFLINE';
```

(b) `AnnouncementListItem` 接口内、`metadata` 字段注释下方补：

```typescript
  /** 回收站留痕（隐藏/下架时后端合并写入；恢复后清除） */
  metadata?: Record<string, any> & { recycle?: { from: AnnouncementStatus; action: 'HIDDEN' | 'OFFLINE'; at: string; by?: string | null } };
```

（若交叉类型报错则保持 `Record<string, any>` 原样，另加独立接口 `AnnouncementRecycleInfo` 于文件顶部类型区，回收站组件内自行断言——二选一，以编译通过为准。）

(c) `AnnouncementHistoryAction` 替换为：

```typescript
export type AnnouncementHistoryAction = 'CREATE' | 'PUBLISH' | 'UPDATE' | 'UNPUBLISH' | 'ARCHIVE' | 'DELETE' | 'HIDE' | 'OFFLINE' | 'RESTORE';
```

(d) `deleteAnnouncement` 函数之后插入：

```typescript
/* ── 回收站（2026-09-26：隐藏/下架/恢复取代删除）── */

export function hideAnnouncement(id: string) {
  return api.post<AnnouncementListItem>(`/announcements/${id}/hide`, {});
}

export function offlineAnnouncement(id: string) {
  return api.post<AnnouncementListItem>(`/announcements/${id}/offline`, {});
}

export function restoreAnnouncement(id: string) {
  return api.post<AnnouncementListItem>(`/announcements/${id}/restore`, {});
}
```

- [ ] **Step 2: 类型面自检**（改宽联合类型可能暴露 Record 穷举缺口）

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web exec tsc --noEmit 2>&1 | grep -E "notice|announcement" | head -20
```
Expected: 本功能相关文件零错误（存量红按 memory「web next build 红是非 expert 存量类型错误」豁免；若 `Record<AnnouncementStatus,...>` 报缺键 → Task 6/7 的 statusMeta/statusLabel 补齐后自然消除）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/lib/api/announcement.ts
git commit -m "feat(web): 公告 API 客户端——HIDDEN/OFFLINE 状态与 hide/offline/restore"
```

---

### Task 5: 回收站 Modal 组件（新文件）

**Files:**
- Create: `apps/web/src/components/notice/announcement-recycle-modal.tsx`

**Interfaces:**
- Consumes: Task 4 的 `listAnnouncements({ status: 'HIDDEN,OFFLINE' })` / `restoreAnnouncement`；`@/components/workbench` 的 `Modal/StatusBadge/TableSkeleton`（Modal props: `open/onClose/title/description/children/footer/size`，size 含 `'2xl':1080/'4xl':1600`）
- Produces（Task 6 依赖）: `export function AnnouncementRecycleModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void })`（onChanged 在恢复成功后由父级刷新主列表）

- [ ] **Step 1: 写组件**（整文件）：

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Modal, StatusBadge, TableSkeleton } from '@/components/workbench';
import {
  listAnnouncements, restoreAnnouncement,
  type AnnouncementListItem, type AnnouncementStatus,
} from '@/lib/api/announcement';
import { toast } from 'sonner';
import { EyeOff, PackageX, RotateCcw, FileText, ExternalLink, Trash2 } from 'lucide-react';

const PAGE_SIZE = 15;

const FROM_STATUS_LABELS: Partial<Record<AnnouncementStatus, string>> = {
  DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已公示',
};

const TYPE_LABELS: Record<string, string> = {
  BID_NOTICE: '采购公告', ADDENDUM: '补遗公告', PREQUAL_NOTICE: '资格预审公告',
  PRE_WIN_NOTICE: '中标公告', WIN_NOTICE: '成交公告', CONTRACT_NOTICE: '合同公告',
  PERFORMANCE_NOTICE: '履行结果公告', POLICY: '政策法规', PLATFORM: '平台通知',
  FAILED_BID_NOTICE: '流标公告', WIN_BID_NOTICE: '中标公告',
};

/**
 * 回收站（2026-09-26）：隐藏/下架的公告进入此处；可查看详情（原详情页 iframe 弹窗）与恢复；
 * 不提供清空——UI 无任何公告永久删除入口（后端 DELETE 保留但停用）。
 */
export function AnnouncementRecycleModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ total: number; items: AnnouncementListItem[] }>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<{ id: string; title: string } | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await listAnnouncements({ status: 'HIDDEN,OFFLINE', page: p, pageSize: PAGE_SIZE });
      setData({ total: res.total, items: res.items });
      setPage(p);
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(1); }, [load]);

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  const restore = async (a: AnnouncementListItem) => {
    try {
      await restoreAnnouncement(a.id);
      toast.success(`已恢复「${a.title}」`);
      await load(1);
      onChanged();
    } catch (e: any) { toast.error(e?.message || '恢复失败'); }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={<span className="flex items-center gap-2"><Trash2 size={16} className="text-[var(--accent)]" /> 回收站</span>}
        description="隐藏与下架的公告进入回收站，可查看详情或恢复；回收站不提供清空操作"
        size="2xl"
        footer={
          <div className="flex w-full items-center justify-between">
            <span className="text-xs text-[var(--muted-foreground)]">共 {data.total} 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex items-center gap-2">
              <button disabled={loading || page <= 1} onClick={() => load(page - 1)} className="neu-btn-xs disabled:opacity-40">上一页</button>
              <button disabled={loading || page >= totalPages} onClick={() => load(page + 1)} className="neu-btn-xs disabled:opacity-40">下一页</button>
              <button onClick={onClose} className="neu-btn-soft">关闭</button>
            </div>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[680px]">
            <thead>
              <tr>
                <th>标题</th>
                <th>类型</th>
                <th>原因 / 原状态</th>
                <th>进入时间</th>
                <th>操作人</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={6} rows={4} />
              ) : data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12">
                    <div className="flex flex-col items-center gap-2">
                      <FileText size={20} className="text-[var(--muted-foreground)]" />
                      <p className="text-sm text-[var(--muted-foreground)]">回收站为空——隐藏或下架的公告会出现在这里</p>
                    </div>
                  </td>
                </tr>
              ) : data.items.map(a => {
                const rc = a.metadata?.recycle;
                const offline = a.status === 'OFFLINE';
                return (
                  <tr key={a.id}>
                    <td>
                      <div className="text-sm font-bold text-[var(--foreground)]">{a.title}</div>
                      {a.relatedProjectCode && <div className="text-[11px] text-[var(--muted-foreground)]">{a.relatedProjectCode}</div>}
                    </td>
                    <td><StatusBadge tone="gray">{TYPE_LABELS[a.type] ?? '公告'}</StatusBadge></td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge tone={offline ? 'orange' : 'gray'}>
                          {offline
                            ? <span className="inline-flex items-center gap-1"><PackageX size={11} /> 下架</span>
                            : <span className="inline-flex items-center gap-1"><EyeOff size={11} /> 隐藏</span>}
                        </StatusBadge>
                        <span className="text-[11px] text-[var(--muted-foreground)]">原状态：{FROM_STATUS_LABELS[rc?.from ?? 'DRAFT'] ?? '草稿'}</span>
                      </div>
                    </td>
                    <td className="text-xs tabular-nums text-[var(--muted-foreground)]">{rc?.at ? new Date(rc.at).toLocaleString('zh-CN') : '—'}</td>
                    <td className="text-xs text-[var(--muted-foreground)]">{rc?.by ?? '—'}</td>
                    <td>
                      <div className="flex flex-wrap justify-center gap-1.5">
                        <button onClick={() => setView({ id: a.id, title: a.title })} className="neu-btn-xs"><ExternalLink size={12} /> 查看</button>
                        <button onClick={() => restore(a)} className="neu-btn-xs is-success"><RotateCcw size={12} /> 恢复</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* 详情窗口：以正常公告详情页（/notice/[id]）原样加载 */}
      {view && (
        <Modal
          open
          onClose={() => setView(null)}
          title={<span className="flex items-center gap-2"><FileText size={16} className="text-[var(--accent)]" /> {view.title}</span>}
          description="公告详情（回收站内查看；恢复请回到回收站列表）"
          size="4xl"
        >
          <iframe src={`/notice/${view.id}`} title={view.title} className="h-[74vh] w-full rounded-[12px] border-0 bg-white" />
        </Modal>
      )}
    </>
  );
}
```

- [ ] **Step 2: 自检**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep "recycle-modal" | head
```
Expected: 无输出（无错误）。

- [ ] **Step 3: 提交**

```bash
git add apps/web/src/components/notice/announcement-recycle-modal.tsx
git commit -m "feat(web): 公告回收站弹窗——查看(iframe 详情)+恢复，无清空"
```

---

### Task 6: 列表页接线（行操作/批量栏/右上角入口/去删除）

**Files:**
- Modify: `apps/web/src/app/(main)/notice/page.tsx`

**Interfaces:**
- Consumes: Task 4 的 `hideAnnouncement/offlineAnnouncement`、Task 5 的 `AnnouncementRecycleModal`
- Produces: 用户可见行为——行级 `隐藏`(全部行)/`下架`(仅 PUBLISHED 行)；批量 `发布/下线/下架/隐藏`；hero 右上 `回收站` 按钮

- [ ] **Step 1: imports 改动**——(a) api import 行去掉 `deleteAnnouncement`、加 `hideAnnouncement, offlineAnnouncement`；(b) lucide import 加 `EyeOff, PackageX`（`Trash2` 保留给回收站按钮）；(c) 文件底部历史 Modal import 行旁加：

```tsx
import { AnnouncementRecycleModal } from '@/components/notice/announcement-recycle-modal';
```

- [ ] **Step 2: statusMeta 补两态**（编译必需；主列表本就看不到这两态，仅供类型穷举）：

```typescript
const statusMeta: Record<AnnouncementStatus, { label: string; tone: 'green' | 'gray' }> = {
  DRAFT: { label: '草稿', tone: 'gray' },
  PUBLISHED: { label: '已发布', tone: 'green' },
  ARCHIVED: { label: '已公示', tone: 'gray' },
  HIDDEN: { label: '已隐藏', tone: 'gray' },
  OFFLINE: { label: '已下架', tone: 'gray' },
};
```

- [ ] **Step 3: 状态与入口**——(a) `showAllHistories` state 旁加 `const [showRecycle, setShowRecycle] = useState(false);`；(b) page-hero__right 里「公告历史」按钮之后插入：

```tsx
            <button onClick={() => setShowRecycle(true)} className="neu-btn-soft">
              <Trash2 size={15} /> 回收站
            </button>
```

- [ ] **Step 4: runBatch 重写**（`'delete'` 分支移除，加 `hide/offline`；下架仅对选中里的 PUBLISHED 生效）：

```typescript
  const runBatch = async (action: 'publish' | 'archive' | 'hide' | 'offline') => {
    if (selectedIds.size === 0) return;
    const label = action === 'publish' ? '发布' : action === 'archive' ? '下线' : action === 'hide' ? '隐藏' : '下架';
    // 2026-09-26 回收站体系：下架仅对「已发布」生效（草稿/已公示无"架"可下）
    const target = action === 'offline'
      ? data.items.filter(i => selectedIds.has(i.id) && i.status === 'PUBLISHED').map(i => i.id)
      : Array.from(selectedIds);
    if (target.length === 0) { toast.error('选中项中没有已发布的公告，无需下架'); return; }
    if (action !== 'publish' && !(await confirm({ message: `确认${label}选中的 ${target.length} 条信息？操作后进入回收站，可在右上角回收站中恢复。` }))) return;
    clearSelection();
    const results = await Promise.allSettled(target.map(id =>
      action === 'hide' ? hideAnnouncement(id)
      : action === 'offline' ? offlineAnnouncement(id)
      : updateAnnouncement(id, { status: action === 'publish' ? 'PUBLISHED' : 'ARCHIVED' })
    ));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.length - ok;
    if (fail === 0) toast.success(`${label}成功 ${ok} 条`);
    else if (ok === 0) toast.error(`${label}失败 ${fail} 条`);
    else toast(`${label}完成：成功 ${ok} / 失败 ${fail}`);
    load();
  };
```

批量栏按钮区（`selectedCount > 0` 内）替换为：

```tsx
            <button onClick={() => runBatch('publish')} className="neu-btn-xs is-success"><Send size={13} /> 发布</button>
            <button onClick={() => runBatch('archive')} className="neu-btn-xs is-warning"><Archive size={13} /> 下线</button>
            <button onClick={() => runBatch('offline')} className="neu-btn-xs is-warning"><PackageX size={13} /> 下架</button>
            <button onClick={() => runBatch('hide')} className="neu-btn-xs is-danger"><EyeOff size={13} /> 隐藏</button>
            <button onClick={clearSelection} className="neu-btn-xs"><X size={13} /> 取消选择</button>
```

- [ ] **Step 5: 删除整段 `remove` 函数**（含 4 秒撤销乐观逻辑），替换为两个行级 handler（放在 `remove` 原位置）：

```typescript
  /* ── 回收站体系（2026-09-26）：行级隐藏/下架，删除入口移除 ── */
  const hideRow = async (a: AnnouncementListItem) => {
    if (!(await confirm({ message: `确认隐藏「${a.title}」？隐藏后进入回收站，可在右上角回收站中恢复。` }))) return;
    try { await hideAnnouncement(a.id); toast.success(`已隐藏「${a.title}」，可在回收站中恢复`); load(); }
    catch (e: any) { toast.error(e?.message || '隐藏失败'); }
  };

  const takeOffline = async (a: AnnouncementListItem) => {
    if (!(await confirm({ message: `确认下架「${a.title}」？下架后公开门户不再可见，进入回收站，可在回收站中恢复。` }))) return;
    try { await offlineAnnouncement(a.id); toast.success(`已下架「${a.title}」，可在回收站中恢复`); load(); }
    catch (e: any) { toast.error(e?.message || '下架失败'); }
  };
```

行操作 `<td onClick={e => e.stopPropagation()}>` 内按钮组替换为：

```tsx
                      <div className="flex flex-wrap justify-center gap-1.5">
                        {a.type === 'BID_NOTICE' && <button onClick={() => setPartAnn(a)} className="neu-btn-xs is-success">投标情况</button>}
                        <button onClick={() => setHistoryAnnId(a.id)} className="neu-btn-xs"><HistoryIcon size={12} /> 历史</button>
                        {a.status === 'PUBLISHED' && (
                          <button onClick={() => takeOffline(a)} className="neu-btn-xs is-warning"><PackageX size={12} /> 下架</button>
                        )}
                        <button onClick={() => hideRow(a)} className="neu-btn-xs is-danger"><EyeOff size={12} /> 隐藏</button>
                      </div>
```

- [ ] **Step 6: 底部挂回收站弹窗**（`{showAllHistories && ...}` 行后）：

```tsx
      {showRecycle && <AnnouncementRecycleModal onClose={() => setShowRecycle(false)} onChanged={load} />}
```

- [ ] **Step 7: 自检 + 提交**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep "(main)/notice/page" | head
git add "apps/web/src/app/(main)/notice/page.tsx"
git commit -m "feat(web): 公告列表——行级隐藏/下架取代删除，批量栏同步，右上角回收站入口"
```

---

### Task 7: 详情页改造（删除→隐藏、回收态只读）

**Files:**
- Modify: `apps/web/src/app/(main)/notice/[id]/page.tsx`

**Interfaces:**
- Consumes: Task 4 的 `hideAnnouncement`
- Produces: 详情页操作区 = `编辑`(回收态隐藏) + `隐藏`(回收态禁用)；iframe 弹窗加载时天然适配

- [ ] **Step 1: imports**——(a) `deleteAnnouncement` → `hideAnnouncement`；(b) lucide import：`Trash2` → `EyeOff`（先 grep 确认 Trash2 在本文件仅 169 行按钮用：`grep -n "Trash2" "apps/web/src/app/(main)/notice/[id]/page.tsx"`）。

- [ ] **Step 2: 状态映射补齐**（28–33 行）：

```typescript
const statusTone: Record<AnnouncementStatus, 'green' | 'gray'> = {
  DRAFT: 'gray', PUBLISHED: 'green', ARCHIVED: 'gray', HIDDEN: 'gray', OFFLINE: 'gray',
};
const statusLabel: Record<AnnouncementStatus, string> = {
  DRAFT: '草稿', PUBLISHED: '已发布', ARCHIVED: '已归档', HIDDEN: '已隐藏', OFFLINE: '已下架',
};
```

- [ ] **Step 3: handleDelete → handleHide**（105–110 行整体替换）：

```typescript
  const handleHide = async () => {
    if (!ann || !(await confirm({ message: `确认隐藏「${ann.title}」？隐藏后进入回收站，可在公告发布中心右上角回收站中恢复。` }))) return;
    hideAnnouncement(ann.id)
      .then(() => { toast.success("已隐藏，可在回收站中恢复"); router.push("/notice"); })
      .catch((e: any) => toast.error(e?.message || "隐藏失败"));
  };
```

- [ ] **Step 4: 操作区按钮**（`!editing` 分支替换）：

```tsx
              {!editing ? (
                <>
                  {/* 回收态（HIDDEN/OFFLINE）只读：编辑隐藏、禁用隐藏按钮——恢复只走回收站，避免编辑态状态下拉绕过体系 */}
                  {ann.status !== 'HIDDEN' && ann.status !== 'OFFLINE' && (
                    <button onClick={() => setEditing(true)} className="neu-btn-soft"><Pencil size={14} /> 编辑</button>
                  )}
                  <button
                    onClick={handleHide}
                    className="neu-btn-soft is-danger"
                    disabled={ann.status === 'HIDDEN' || ann.status === 'OFFLINE'}
                  ><EyeOff size={14} /> 隐藏</button>
                </>
              ) : (
                <button onClick={() => setEditing(false)} className="neu-btn-soft"><X size={14} /> 取消编辑</button>
              )}
```

- [ ] **Step 5: 自检 + 提交**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep "notice/\[id\]" | head
git add "apps/web/src/app/(main)/notice/[id]/page.tsx"
git commit -m "feat(web): 公告详情——删除改隐藏、回收态只读（配合回收站 iframe 查看）"
```

---

### Task 8: 历史弹窗补三个动作

**Files:**
- Modify: `apps/web/src/components/notice/announcement-history-modal.tsx`

**Interfaces:**
- Consumes: Task 4 的 `AnnouncementHistoryAction` 联合（`Record<AnnouncementHistoryAction,...>` 穷举缺口由此补齐）

- [ ] **Step 1: ACTION_META（12–19 行）追加三项**（DELETE 保留——历史存量记录仍需展示）：

```typescript
  HIDE: { label: "隐藏", icon: EyeOff, cls: "text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)]" },
  OFFLINE: { label: "下架", icon: PackageX, cls: "text-[rgba(176,134,55,0.96)] bg-[rgba(233,194,111,0.14)]" },
  RESTORE: { label: "恢复", icon: RotateCcw, cls: "text-[rgba(42,140,110,0.92)] bg-[rgba(92,181,150,0.12)]" },
```

lucide import 行补 `EyeOff, PackageX, RotateCcw`。

- [ ] **Step 2: 自检 + 提交**

```bash
pnpm --filter web exec tsc --noEmit 2>&1 | grep "history-modal" | head
git add apps/web/src/components/notice/announcement-history-modal.tsx
git commit -m "feat(web): 公告历史弹窗——HIDE/OFFLINE/RESTORE 动作展示与筛选"
```

---

### Task 9: 视觉验证（:3005 实机截图）

**Files:**
- 无代码改动；产出截图到 `/tmp/recycle-shots/`（不入库，memory：本地产物不入库）

**Interfaces:**
- Consumes: 全部前序任务

- [ ] **Step 1: 确认 :3005 dev 在跑**（不在则脱离式启动 `pnpm --filter web dev`；memory：勿对运行中 next 执行 `rm -rf .next`）

- [ ] **Step 2: playwright 截图脚本**（绝对路径 require + 系统 Chrome，登录 X-Portal；口令漂移以 memory 快照为准，admin@2026 优先、qyt1234/123456 兜底）。核心流程：
  1. 登录 → `/notice` → 全页截图 `01-list.png`（验证：行操作=投标情况/历史/下架(仅发布行)/隐藏，右上角有回收站按钮，无删除按钮）
  2. 勾选 2 条 → 批量栏截图 `02-batch.png`（发布/下线/下架/隐藏/取消，无删除）
  3. 对一条已发布公告点「下架」→ 确认 → 截图 `03-after-offline.png`（行消失 + toast）
  4. 点「回收站」→ 截图 `04-recycle.png`（含 Task 3 留下的冒烟条目；原因徽标/原状态/进入时间/操作人；无清空按钮）
  5. 「查看」→ iframe 详情截图 `05-detail-iframe.png`（正常详情页渲染；无编辑按钮、隐藏按钮禁用）
  6. 「恢复」→ 截图 `06-restored.png`（回收站条目消失）+ 回主列表确认该公告回来 `07-back-in-list.png`
  7. 顺带验证 `公告历史` 弹窗出现 隐藏/下架/恢复 动作 `08-history.png`

- [ ] **Step 3: 结果汇总**——截图路径列表 + 每张一句话结论交用户；后端既有单测回归声明（`pnpm --filter api exec jest announcement.service.spec.ts` 输出尾部）。

---

## Self-Review 结论

- **Spec 覆盖**：语义表→T2/T3；枚举迁移→T1；三端点+list→T2/T3；API 客户端→T4；回收站 Modal 无清空→T5；行操作/批量/右上角→T6；详情页删→隐+回收态只读→T7；历史动作→T8；验证→T9。门户零改动已在 T1–T3 设计中免除。
- **占位符扫描**：无 TBD/TODO；所有代码块完整可粘贴。
- **类型一致性**：`RecycleOperator`（T2 定义、T3 构造）、`hide/offline/restore` 路径与角色（T3↔T4）、`AnnouncementRecycleModal({onClose,onChanged})`（T5↔T6）均对齐；statusMeta/statusLabel/ACTION_META 穷举在 T4 改宽联合后由 T6/T7/T8 补齐，顺序上 T4 的 tsc 检查预期这三处报缺键（已在 T4 Step 2 注明，属中间态）。
