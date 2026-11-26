# 第 3 处：文档审查只收上传记录 id — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让文档审查模块只能操作「审查模块自己上传登记的文件」，客户端不再能指定对象存储键去读写任意对象。

**Architecture:** 上传审查文档时登记一条 `FileAsset`（新类目 `tender_review_source`，属主是登录人），对象键由服务端生成；执行审查只收这条记录的 `fileId`，键由服务端反查。审查模块每次读写存储前，先断言键落在 `review/` 命名空间内；`StorageService` 加一道所有模块共用的键底线。新类目在通用下载里只对上传者本人与 admin 开放。

**Tech Stack:** NestJS 11、Prisma、MinIO（经 `StorageService`）、jest（ts-jest）、supertest（e2e）、Next.js 16 / React 19（:3005 工作台）。

**Spec:** `docs/superpowers/specs/2026-11-24-other-portals-audit-batch1-remediation-design.md`（3.3 节；通用做法见第 2 节）。

## Global Constraints

- 模块：`apps/api/src/tender-review/`。模块内没有服务层，审查流程都写在 `tender-review.controller.ts` 里——本计划沿用这个结构，不另起服务类。
- 对象键只可能是 `review/` 命名空间下的普通相对键；审查模块传给 `StorageService` 的每一个键在用之前都要过守卫。违规一律 400 `INVALID_REVIEW_OBJECT_KEY`。
- `StorageService` 的 `upload` / `download` / `delete` / `getPresignedUrl` 四个方法对键设底线：非空字符串、不以 `/` 开头、不含反斜杠与控制字符、没有空段或 `.` / `..` 段。违规一律 400 `INVALID_OBJECT_KEY`。
- 新的审查上传对象键固定为 `review/<yyyy-MM-dd>/<32 位十六进制随机>.<扩展名>`，不含任何用户提供的字符。
- 审查源文件的类型只认四种：pdf、docx、doc、txt。声明 MIME 不在四种之内时按文件名后缀推断；两者都不是四种之一就拒绝。
- 执行审查时 `fileId` 可选。不带 `fileId` 是纯文本审查，任务的 `objectKey` 为空串。
- `fileId` 指向的记录「不存在」「类目不是审查源文件」「键不在审查命名空间」三种情况回同一个 400 `REVIEW_FILE_INVALID`——不泄露别的资产是否存在。存在且类目正确但不是本人上传（admin 例外）→ 403 `REVIEW_FILE_FORBIDDEN`。
- 审查源文件不做服务端密封（保持现状：明文存 MinIO）。做成密封要让任务侧的下载与改写都变成解密感知的，不在本处范围。
- 路由的角色标注不变：文档审查端点都是 `@Roles('leader', 'admin', 'staff')`。新增端点没有。
- 客户端请求体里多余的键会被全局 `ValidationPipe({ whitelist: true })` 剥掉，所以请求体继续带旧的 `objectKey` 字段不会报错，只会被忽略。
- 单测与类型检查不经 pnpm（`pnpm test` 会触发自动 install 且失败）：在 `water-erp/apps/api` 下用 `./node_modules/.bin/jest <pattern>` 与 `./node_modules/.bin/tsc --noEmit --incremental false`；:3005 的类型检查在 `water-erp/apps/web` 下用 `./node_modules/.bin/tsc --noEmit`。每条命令开头用绝对路径 `cd`。
- 隔离 e2e：文档审查的 e2e 会在测试进程里启动整个应用，只能对着隔离环境跑（库 `water_erp_e2e`、Redis 6390、桶 `water-erp-e2e`，私有挂载命名空间里用 e2e 专用 env 覆盖 `apps/api/.env`）。完整做法与坑见记忆 `local-e2e-isolated-harness-seed-gotchas`；在隔离 worktree 里跑时 Prisma 客户端读的是主工作区路径的 `.env`，那个路径也要在同一个命名空间里盖掉（记忆 `parallel-wip-isolated-worktree` 第 12 条）。
- 提交：只 `git add` 本任务列出的文件，禁 `git add -A` / `git add .`；不 push；提交前 `git branch --show-current` 与 `git status --short` 确认分支正确、没有卷入他人改动；提交信息前缀 `fix(audit-b1):`，末尾带 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- 主工作区有别的会话的未提交改动时，不在主工作区动手：在 `.worktrees/` 下建隔离工作区完成开发与测试，等主工作区干净后快进合回（记忆 `parallel-wip-isolated-worktree`）。
- CLAUDE.md 只能用脚本改（仓库的守卫会拦 Edit 与 Write），并单独提交。
- 不改 `expert.service.ts`、`knowledge` 模块、`StorageService` 的各调用方签名。

## Review Focus

1. 存量任务的对象键是旧格式 `review/<时间戳>_<原始文件名>`，文件名里可能有中文、空格、括号、`#`——新的守卫不能把它们误拒，接受建议、下载都要照常可用。（Task 1）
2. 审查任务没有关联文件（纯文本审查，`objectKey` 为空串）——接受或拒绝建议只记状态、不碰存储；下载报「任务未关联文档文件」，与现在一致。（Task 1）
3. 有人经通用上传接口上传、把类目标成审查源文件：这种记录的键不在审查命名空间。拿它的 `fileId` 执行审查要当场 400，而不是建出一个后续文件操作必然失败的任务。（Task 3）
4. 接受建议时文件操作被守卫拒绝——这个请求本身不能 500：问题状态照常落库，`modificationApplied` 不置真。（Task 1）
5. admin 用别人上传的 `fileId` 发起审查——任务的属主是 admin（发起人），之后的改写与下载按任务属主判权。（Task 3）

---

### Task 1: 对象键守卫与存储层底线

先堵「用」的这一面：不管任务里的键是怎么写进来的，只要不在审查命名空间内，读、写、删一律拒绝。这一步做完，执行接口即使还收着 `objectKey`，也碰不到 `review/` 以外的任何对象。

**Files:**
- Create: `water-erp/apps/api/src/tender-review/review-source-file.util.ts`
- Create: `water-erp/apps/api/src/tender-review/review-source-file.util.spec.ts`
- Modify: `water-erp/apps/api/src/storage/storage.service.ts`（全文 57 行）
- Create: `water-erp/apps/api/src/storage/storage.service.spec.ts`
- Modify: `water-erp/apps/api/src/tender-review/tender-review.controller.ts:824-1010`（`backupKey`、`ensureOriginalBackup`、`applyModificationToFile`、`applyManualCommentToFile`、`rebuildDocxFromAccepted`、`downloadModifiedDocument`）
- Test: `water-erp/apps/api/src/tender-review/tender-review.controller.spec.ts`

**Interfaces:**
- Produces（Task 2、3 与控制器都用）：
  ```ts
  /** 审查源文件在 FileAsset.category 里的类目名 */
  export const REVIEW_SOURCE_CATEGORY = 'tender_review_source';

  /** 是否审查模块自己的对象键：review/ 命名空间下的普通相对键 */
  export function isReviewObjectKey(key: unknown): key is string;

  /** 取出任务的对象键供存储操作使用；不在审查命名空间内 → 400 INVALID_REVIEW_OBJECT_KEY */
  export function assertReviewObjectKey(key: unknown): string;
  ```
- Produces（全库共用）：
  ```ts
  // storage/storage.service.ts
  /** 存储层键底线；违规 → 400 INVALID_OBJECT_KEY */
  export function assertStorableObjectKey(key: unknown): string;
  ```

- [ ] **Step 1: 写失败的测试（守卫的纯函数）** —— 新建 `review-source-file.util.spec.ts`

```ts
import {
  assertReviewObjectKey,
  isReviewObjectKey,
  REVIEW_SOURCE_CATEGORY,
} from './review-source-file.util';

describe('isReviewObjectKey / assertReviewObjectKey（审计第 3 处）', () => {
  it('审查命名空间下的相对键通过——含新格式与存量格式', () => {
    expect(isReviewObjectKey('review/2026-11-25/0123456789abcdef0123456789abcdef.docx')).toBe(true);
    // 存量任务的键带用户原始文件名：中文、空格、括号、# 都有
    expect(isReviewObjectKey('review/1732452000000_采购文件（终版） #2.docx')).toBe(true);
    expect(isReviewObjectKey('review/e2e-test')).toBe(true);
    expect(isReviewObjectKey('review/e2e-test.original')).toBe(true);
  });

  it.each([
    ['../.env', '路径穿越'],
    ['/etc/passwd', '绝对路径'],
    ['knowledge/abc/规则.docx', '别的模块的命名空间'],
    ['sealed-backup/k', '密封备份'],
    ['review/../x', '命名空间内的 .. 段'],
    ['review/./x', '. 段'],
    ['review//x', '空段'],
    ['review/x/', '以斜杠结尾'],
    ['review/a\\b', '反斜杠'],
    ['review/a\nb', '控制字符'],
    ['review', '没有命名空间后的部分'],
    ['', '空串'],
    [null, 'null'],
    [123, '非字符串'],
  ])('%s 不通过（%s）', (bad, _reason) => {
    expect(isReviewObjectKey(bad)).toBe(false);
  });

  it('assertReviewObjectKey：合法键原样返回，非法键抛 400 INVALID_REVIEW_OBJECT_KEY', () => {
    expect(assertReviewObjectKey('review/e2e-test')).toBe('review/e2e-test');
    let thrown: unknown;
    try {
      assertReviewObjectKey('../.env');
    } catch (err) {
      thrown = err;
    }
    // jest 的 toThrow 只比对消息或类名，比对响应体要接住异常再看
    expect(thrown).toMatchObject({ status: 400, response: { code: 'INVALID_REVIEW_OBJECT_KEY' } });
  });

  it('类目名是固定常量', () => {
    expect(REVIEW_SOURCE_CATEGORY).toBe('tender_review_source');
  });
});
```

- [ ] **Step 2: 写失败的测试（存储层底线）** —— 新建 `storage.service.spec.ts`

```ts
jest.mock('../upload/minio.client', () => ({
  MINIO_BUCKET: 'water-erp-test',
  minioClient: {
    bucketExists: jest.fn().mockResolvedValue(true),
    putObject: jest.fn().mockResolvedValue({}),
    // 真实的 download 会监听流事件：桩必须是会吐数据并结束的可读流，否则用例挂到超时
    getObject: jest.fn().mockImplementation(() => {
      const { Readable } = require('stream');
      return Promise.resolve(Readable.from([Buffer.from('%PDF-1.4')]));
    }),
    removeObject: jest.fn().mockResolvedValue({}),
    presignedGetObject: jest.fn().mockResolvedValue('https://x'),
  },
}));

import { StorageService } from './storage.service';
import { minioClient } from '../upload/minio.client';

const putObject = minioClient.putObject as jest.Mock;
const getObject = minioClient.getObject as jest.Mock;
const removeObject = minioClient.removeObject as jest.Mock;
const presignedGetObject = minioClient.presignedGetObject as jest.Mock;

describe('StorageService — 键底线（审计第 3 处）', () => {
  let service: StorageService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageService();
  });

  it.each(['../sealed-backup/k', '/etc/passwd', 'review/../x', 'a\\b', 'a/b/', '', 'x\u0000y'])(
    '键 %j 不合法：四个方法都抛 400 INVALID_OBJECT_KEY，且不碰对象存储',
    async (badKey) => {
      const code = { response: { code: 'INVALID_OBJECT_KEY' } };
      await expect(service.upload(badKey, Buffer.from('x'), 'text/plain')).rejects.toMatchObject(code);
      await expect(service.download(badKey)).rejects.toMatchObject(code);
      await expect(service.delete(badKey)).rejects.toMatchObject(code);
      await expect(service.getPresignedUrl(badKey)).rejects.toMatchObject(code);
      expect(putObject).not.toHaveBeenCalled();
      expect(getObject).not.toHaveBeenCalled();
      expect(removeObject).not.toHaveBeenCalled();
      expect(presignedGetObject).not.toHaveBeenCalled();
    },
  );

  it('合法键原样交给对象存储', async () => {
    const buf = Buffer.from('%PDF-1.4');
    await service.upload('review/2026-11-25/abc.pdf', buf, 'application/pdf');
    expect(putObject).toHaveBeenCalledWith('water-erp-test', 'review/2026-11-25/abc.pdf', buf, buf.length, { 'Content-Type': 'application/pdf' });
    const downloaded = await service.download('review/2026-11-25/abc.pdf');
    expect(downloaded.toString()).toBe('%PDF-1.4');
    expect(getObject).toHaveBeenCalledWith('water-erp-test', 'review/2026-11-25/abc.pdf');
    await service.delete('review/2026-11-25/abc.pdf');
    expect(removeObject).toHaveBeenCalledWith('water-erp-test', 'review/2026-11-25/abc.pdf');
  });
});
```

- [ ] **Step 3: 写失败的测试（控制器在用键之前过守卫）** —— 在 `tender-review.controller.spec.ts` 文件末尾追加。先在该文件顶部的 `buildController` 旁边加一个构造函数：

```ts
/** 第 3 处用：需要真实的 storage / parser 桩（构造函数第 2、3 个参数） */
function buildControllerWith(prisma: any, storage: any = {}, parser: any = {}) {
  const controller = new TenderReviewController(
    prisma, storage, parser, {} as any, {} as any, {} as any,
    {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  jest.spyOn(controller as any, 'runReview').mockResolvedValue(undefined);
  jest.spyOn((controller as any).logger, 'error').mockImplementation(() => undefined);
  jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => undefined);
  return controller;
}
```

```ts
describe('TenderReviewController — 审查任务的对象键守卫（审计第 3 处）', () => {
  const BAD_KEYS = ['../.env', '/etc/passwd', 'knowledge/x.docx', 'sealed-backup/k', 'review/../x'];

  const taskWith = (objectKey: string) => ({ id: 't1', objectKey, documentName: 'd.docx', userId: 'u1' });

  it.each(BAD_KEYS)('任务键 %s：下载、改写、批注、重建、备份一律 400 INVALID_REVIEW_OBJECT_KEY，不触任何存储调用', async (badKey) => {
    const storage = { upload: jest.fn(), download: jest.fn(), delete: jest.fn() };
    const controller = buildControllerWith({ reviewTask: { findUnique: jest.fn().mockResolvedValue(taskWith(badKey)) } }, storage);
    const task = taskWith(badKey);
    const code = { response: { code: 'INVALID_REVIEW_OBJECT_KEY' } };

    await expect((controller as any).downloadModifiedDocument('t1', USER, { setHeader: jest.fn(), send: jest.fn() })).rejects.toMatchObject(code);
    await expect((controller as any).applyModificationToFile(task, { originalText: 'a', replacementText: 'b', operation: 'replace' })).rejects.toMatchObject(code);
    await expect((controller as any).applyManualCommentToFile(task, '锚文本', '批注')).rejects.toMatchObject(code);
    await expect((controller as any).rebuildDocxFromAccepted(task, 0)).rejects.toMatchObject(code);
    await expect((controller as any).ensureOriginalBackup(task)).rejects.toMatchObject(code);

    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('存量格式的键照常可用：下载读的就是任务键', async () => {
    const legacyKey = 'review/1732452000000_采购文件（终版） #2.docx';
    const bytes = Buffer.from('PK\u0003\u0004 旧任务文件');
    const storage = { download: jest.fn().mockResolvedValue(bytes), upload: jest.fn(), delete: jest.fn() };
    const controller = buildControllerWith({ reviewTask: { findUnique: jest.fn().mockResolvedValue(taskWith(legacyKey)) } }, storage);
    const res = { setHeader: jest.fn(), send: jest.fn() };

    await (controller as any).downloadModifiedDocument('t1', USER, res);

    expect(storage.download).toHaveBeenCalledWith(legacyKey);
    expect(res.send).toHaveBeenCalledWith(bytes);
  });

  it('没有关联文件的任务（纯文本审查）：接受建议只落状态，不碰存储', async () => {
    const storage = { upload: jest.fn(), download: jest.fn(), delete: jest.fn() };
    const prisma: any = {
      reviewTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't1', objectKey: '', userId: 'u1',
          results: { criticalIssues: [{ ruleId: 'r1', suggestion: '把「甲方」改为「采购人」', status: 'pending', modificationApplied: false }], warnings: [], passedChecks: [] },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const controller = buildControllerWith(prisma, storage);

    await controller.resolveIssue('t1', { issueIndex: 0, action: 'accept' }, USER);

    // 既有行为（不在本次修复范围）：没有文件时改写函数提前返回、不抛错，调用方照样把
    // modificationApplied 置真。这里只保护两件事——状态照常落库、不碰任何存储。
    const saved = prisma.reviewTask.update.mock.calls[0][0].data.results;
    expect(saved.criticalIssues[0].status).toBe('accepted');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('任务键越界时接受建议：请求照常完成（不抛错），问题状态落库、modificationApplied 不置真', async () => {
    const storage = { upload: jest.fn(), download: jest.fn().mockRejectedValue(new Error('不该走到这里')), delete: jest.fn() };
    const prisma: any = {
      reviewTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: 't1', objectKey: '../.env', userId: 'u1',
          results: { criticalIssues: [{ ruleId: 'r1', suggestion: '把「甲方」改为「采购人」', status: 'pending', modificationApplied: false }], warnings: [], passedChecks: [] },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const controller = buildControllerWith(prisma, storage);

    await expect(controller.resolveIssue('t1', { issueIndex: 0, action: 'accept' }, USER)).resolves.toBeDefined();

    const saved = prisma.reviewTask.update.mock.calls[0][0].data.results;
    expect(saved.criticalIssues[0].status).toBe('accepted');
    expect(saved.criticalIssues[0].modificationApplied).toBe(false);
    expect(storage.download).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: 跑测试确认失败**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && ./node_modules/.bin/jest review-source-file storage.service tender-review.controller`
Expected: FAIL。两个新文件报模块或导出不存在；控制器的五条守卫用例里，存储桩被以越界键调用（`downloadModifiedDocument` 不抛 `INVALID_REVIEW_OBJECT_KEY`；越界键那条「接受建议」会去下载 `.env`，抛出「不该走到这里」）。只有「没有关联文件」那条现在就通过——它是回归保护。

- [ ] **Step 5: 实现 `review-source-file.util.ts`（本任务只做守卫两个函数与类目常量）**

`isReviewObjectKey(key)`：`typeof key === 'string'`，以 `review/` 开头，去掉前缀后按 `/` 切段，每一段都非空、不为 `.`、不为 `..`；整个键不含反斜杠与控制字符（`\u0000-\u001f`、`\u007f`）。除前缀外不限制字符集——存量键带用户原始文件名。`assertReviewObjectKey`：不合法抛 `BadRequestException({ error: '非法的审查文件键', code: 'INVALID_REVIEW_OBJECT_KEY' })`，合法返回该键。

- [ ] **Step 6: 实现 `StorageService` 键底线**

在 `storage.service.ts` 导出 `assertStorableObjectKey(key: unknown): string`，规则按全局约束：非空字符串、不以 `/` 开头、不含反斜杠与控制字符、按 `/` 切段后每段非空且不为 `.` / `..`；违规抛 `BadRequestException({ error: '非法的对象存储键', code: 'INVALID_OBJECT_KEY' })`。`upload`、`download`、`delete`、`getPresignedUrl` 四个方法第一行调用它。

- [ ] **Step 7: 控制器在用键之前过守卫**

在 `tender-review.controller.ts` 加两个私有方法：

```ts
  /** 任务的文件键：取出来之前先过审查命名空间守卫——存量任务或旧入口写进来的越界键在这里被拒 */
  private reviewFileKey(task: { objectKey: string }): string {
    return assertReviewObjectKey(task.objectKey);
  }

  private backupKey(task: { objectKey: string }): string {
    return `${this.reviewFileKey(task)}.original`;
  }
```

`ensureOriginalBackup`、`applyModificationToFile`、`applyManualCommentToFile`、`rebuildDocxFromAccepted` 四个方法：保留开头的 `if (!task.objectKey) return;`，其后写 `const key = this.reviewFileKey(task);`，方法体里所有传给 `this.storage` 的 `task.objectKey` 换成 `key`。`downloadModifiedDocument`：保留 `if (!task.objectKey) throw …`，其后 `const key = this.reviewFileKey(task);`，下载用 `key`。

- [ ] **Step 8: 跑测试确认通过**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && ./node_modules/.bin/jest review-source-file storage.service tender-review.controller`
Expected: PASS，新增用例全绿，既有用例不变。

- [ ] **Step 9: 类型检查与全量单测（存储底线是全库共用的，要看别的模块有没有被误拦）**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && ./node_modules/.bin/tsc --noEmit --incremental false && ./node_modules/.bin/jest`
Expected: tsc 退出码 0；全量单测全绿。若有别的模块的单测因为底线被拦，先判断那条测试传的键是不是真实调用方会产生的形态：是就按「计划与代码不符」记录并把该形态并入 `assertStorableObjectKey` 的允许范围，不是就改测试的桩。

- [ ] **Step 10: 提交**

```bash
cd /home/asus/桌面/ERP && git branch --show-current && git status --short
git add water-erp/apps/api/src/tender-review/review-source-file.util.ts \
        water-erp/apps/api/src/tender-review/review-source-file.util.spec.ts \
        water-erp/apps/api/src/storage/storage.service.ts \
        water-erp/apps/api/src/storage/storage.service.spec.ts \
        water-erp/apps/api/src/tender-review/tender-review.controller.ts \
        water-erp/apps/api/src/tender-review/tender-review.controller.spec.ts
git diff --cached --stat
git commit -m "fix(audit-b1): 第 3 处——审查模块用键前过命名空间守卫·StorageService 加键底线（封 O1-1 的使用面）" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Expected: 暂存区只有这六个文件。

---

### Task 2: 上传即登记为文件记录

**Files:**
- Modify: `water-erp/apps/api/src/tender-review/review-source-file.util.ts`
- Modify: `water-erp/apps/api/src/tender-review/review-source-file.util.spec.ts`
- Modify: `water-erp/apps/api/src/tender-review/tender-review.controller.ts:466-488`（`uploadDocument`）
- Test: `water-erp/apps/api/src/tender-review/tender-review.controller.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `REVIEW_SOURCE_CATEGORY`、`assertReviewObjectKey`。
- Produces（Task 3 与控制器用）：
  ```ts
  /** 审查文档的四种类型：对象键扩展名与登记用的 MIME。声明 MIME 不在四种之内时按文件名后缀推断。 */
  export function resolveReviewSourceType(mimeType: string, fileName: string): { mime: string; ext: string } | null;

  /** 新上传的对象键：review/<yyyy-MM-dd>/<32 位十六进制随机>.<扩展名> */
  export function buildReviewSourceKey(ext: string): string;
  ```
- 控制器方法签名变为 `uploadDocument(@UploadedFile() file: Express.Multer.File, @CurrentUser() user: AuthenticatedUser | undefined)`，返回 `{ fileId: string; documentName: string; content: string; contentLength: number }`。

- [ ] **Step 1: 写失败的测试（类型推断与键生成）** —— 追加到 `review-source-file.util.spec.ts` 的 import 与文件末尾

```ts
describe('resolveReviewSourceType / buildReviewSourceKey（审计第 3 处）', () => {
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  it.each([
    ['application/pdf', '任意名字', 'application/pdf', 'pdf'],
    [DOCX, '任意名字', DOCX, 'docx'],
    ['application/msword', 'x.bin', 'application/msword', 'doc'],
    ['text/plain', 'x', 'text/plain', 'txt'],
    // 浏览器偶发把 Word 上报成通用类型或空串：按后缀推断
    ['application/octet-stream', '采购文件.DOCX', DOCX, 'docx'],
    ['', '旧件.doc', 'application/msword', 'doc'],
  ])('%s + %s → %s / .%s', (mime, name, wantMime, wantExt) => {
    expect(resolveReviewSourceType(mime, name)).toEqual({ mime: wantMime, ext: wantExt });
  });

  it.each([
    ['application/zip', 'a.zip'],
    ['application/octet-stream', 'a.exe'],
    ['image/png', 'a.png'],
    ['application/octet-stream', '没有后缀'],
  ])('%s + %s → null（四种之外）', (mime, name) => {
    expect(resolveReviewSourceType(mime, name)).toBeNull();
  });

  it('对象键：命名空间、日期、32 位随机、扩展名；不含任何用户提供的字符', () => {
    const key = buildReviewSourceKey('docx');
    expect(key).toMatch(/^review\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.docx$/);
    expect(buildReviewSourceKey('pdf')).not.toBe(key); // 随机部分每次不同，FileAsset.key 唯一约束不撞
  });
});
```

- [ ] **Step 2: 写失败的测试（上传登记）** —— 追加到 `tender-review.controller.spec.ts` 文件末尾

```ts
describe('TenderReviewController.uploadDocument — 上传即登记为文件记录（审计第 3 处）', () => {
  it('登记一条审查源文件：键不含用户文件名、属主是登录人；响应给 fileId，不再给 objectKey', async () => {
    const prisma: any = { fileAsset: { create: jest.fn().mockResolvedValue({ id: 'fa-1' }) } };
    const storage = { upload: jest.fn().mockResolvedValue(undefined) };
    const parser = { parse: jest.fn().mockResolvedValue('正文') };
    const controller = buildControllerWith(prisma, storage, parser);
    const buffer = Buffer.from('%PDF-1.4 x');
    // 文件名带反引号与 shell 载荷：此前它被原样拼进对象键
    const file = { buffer, mimetype: 'application/pdf', originalname: 'a.`>poc-marker`.pdf', size: buffer.length } as any;

    const out = await controller.uploadDocument(file, USER);

    expect(out).toEqual({ fileId: 'fa-1', documentName: 'a.`>poc-marker`.pdf', content: '正文', contentLength: 2 });
    expect(out).not.toHaveProperty('objectKey');

    expect(storage.upload).toHaveBeenCalledTimes(1);
    const [storedKey] = storage.upload.mock.calls[0];
    expect(storedKey).toMatch(/^review\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.pdf$/);
    expect(prisma.fileAsset.create).toHaveBeenCalledWith({
      data: {
        key: storedKey,
        originalName: 'a.`>poc-marker`.pdf',
        mimeType: 'application/pdf',
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        category: 'tender_review_source',
        uploaderId: 'u1',
      },
    });
  });

  it('声明类型不是四种但后缀是 → 登记为后缀对应的类型', async () => {
    const prisma: any = { fileAsset: { create: jest.fn().mockResolvedValue({ id: 'fa-2' }) } };
    const storage = { upload: jest.fn().mockResolvedValue(undefined) };
    const controller = buildControllerWith(prisma, storage, { parse: jest.fn().mockResolvedValue('') });
    await controller.uploadDocument(
      { buffer: Buffer.from('x'), mimetype: 'application/octet-stream', originalname: '采购文件.docx', size: 1 } as any,
      USER,
    );
    expect(prisma.fileAsset.create.mock.calls[0][0].data.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(storage.upload.mock.calls[0][0]).toMatch(/\.docx$/);
  });

  it('类型与后缀都不是四种之一 → 400，不落存储也不建记录', async () => {
    const prisma: any = { fileAsset: { create: jest.fn() } };
    const storage = { upload: jest.fn() };
    const controller = buildControllerWith(prisma, storage, { parse: jest.fn() });
    await expect(
      controller.uploadDocument({ buffer: Buffer.from('x'), mimetype: 'application/zip', originalname: 'a.zip', size: 1 } as any, USER),
    ).rejects.toMatchObject({ response: { code: 'REVIEW_FILE_TYPE_INVALID' } });
    expect(storage.upload).not.toHaveBeenCalled();
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });

  it('对象已落存储但登记记录失败 → 删掉刚上传的对象（不留孤儿），错误原样抛出', async () => {
    const prisma: any = { fileAsset: { create: jest.fn().mockRejectedValue(new Error('db down')) } };
    const storage = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
    const controller = buildControllerWith(prisma, storage, { parse: jest.fn().mockResolvedValue('') });

    await expect(
      controller.uploadDocument({ buffer: Buffer.from('%PDF-1.4'), mimetype: 'application/pdf', originalname: 'a.pdf', size: 8 } as any, USER),
    ).rejects.toThrow('db down');

    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(storage.upload.mock.calls[0][0]);
  });
});
```

在该文件顶部的 import 里加上 `import { createHash } from 'crypto';`。

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && ./node_modules/.bin/jest review-source-file tender-review.controller`
Expected: FAIL。`resolveReviewSourceType`、`buildReviewSourceKey` 未导出；`uploadDocument` 现在返回 `objectKey` 而没有 `fileId`，也不建 `FileAsset`，三条上传用例都失败。

- [ ] **Step 4: 实现类型推断与键生成**

`resolveReviewSourceType`：声明 MIME 等于四种之一 → `{ mime, ext }`；否则取文件名最后一个小数点之后的部分（小写）等于 `pdf` / `docx` / `doc` / `txt` 之一 → 对应的 `{ mime, ext }`；否则 `null`。`buildReviewSourceKey(ext)`：`review/<今天 yyyy-MM-dd>/<randomBytes(16).toString('hex')>.<ext>`。

- [ ] **Step 5: 改 `uploadDocument`**

签名加 `@CurrentUser() user: AuthenticatedUser | undefined`。`fileName` 归一之后（`normalizeMultipartFilename`）：

1. `const type = resolveReviewSourceType(file.mimetype, fileName)`；为 `null` 抛 `BadRequestException({ error: '仅支持 PDF、DOCX、DOC、TXT 格式文件', code: 'REVIEW_FILE_TYPE_INVALID' })`。
2. `const content = await this.parser.parse(file.buffer, file.mimetype, fileName)`（不变）。
3. `const objectKey = assertReviewObjectKey(buildReviewSourceKey(type.ext))`；`await this.storage.upload(objectKey, file.buffer, type.mime)`。
4. `await this.prisma.fileAsset.create({ data: { key: objectKey, originalName: fileName, mimeType: type.mime, size: file.buffer.length, sha256: createHash('sha256').update(file.buffer).digest('hex'), category: REVIEW_SOURCE_CATEGORY, uploaderId: user?.sub } })`。登记失败时先 `await this.storage.delete(objectKey).catch(() => undefined)`（不留没有属主记录的孤儿对象），再把错误原样抛出。
5. 返回 `{ fileId: asset.id, documentName: fileName, content, contentLength: content.length }`。

文件头补 `import * as crypto from 'crypto'` 与 `REVIEW_SOURCE_CATEGORY`、`assertReviewObjectKey`、`buildReviewSourceKey`、`resolveReviewSourceType` 的 import。

- [ ] **Step 6: 跑测试确认通过**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && ./node_modules/.bin/jest review-source-file tender-review.controller`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
cd /home/asus/桌面/ERP && git branch --show-current && git status --short
git add water-erp/apps/api/src/tender-review/review-source-file.util.ts \
        water-erp/apps/api/src/tender-review/review-source-file.util.spec.ts \
        water-erp/apps/api/src/tender-review/tender-review.controller.ts \
        water-erp/apps/api/src/tender-review/tender-review.controller.spec.ts
git diff --cached --stat
git commit -m "fix(audit-b1): 第 3 处——审查文档上传即登记为文件记录（服务端生成键·属主=登录人），响应只给 fileId" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Expected: 暂存区只有这四个文件。

---

### Task 3: 执行审查只收上传记录 id，新类目只对本人与 admin 可下

这一步做完，执行接口不再有「客户端指定存储键」这回事。

**Files:**
- Modify: `water-erp/apps/api/src/tender-review/dto/review.dto.ts:4-31`（`ExecuteReviewDto`）
- Modify: `water-erp/apps/api/src/tender-review/tender-review.controller.ts`（`executeReview` 的签名与建任务之前的解析；新增私有方法 `resolveReviewSourceFile`）
- Modify: `water-erp/apps/api/src/upload/upload-categories.ts`（`UPLOAD_CATEGORIES` 加一项）
- Modify: `water-erp/apps/api/src/upload/upload.service.ts:416` 之后（`canAccessFile` 加一个分支）
- Test: `water-erp/apps/api/src/tender-review/tender-review.controller.spec.ts`
- Test: `water-erp/apps/api/src/upload/upload.service.spec.ts`
- Test: `water-erp/apps/api/src/upload/upload-categories.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `REVIEW_SOURCE_CATEGORY`、`isReviewObjectKey`。
- Produces:
  ```ts
  // ExecuteReviewDto：删 objectKey，加可选 fileId
  @ApiPropertyOptional({ description: '审查文档上传记录 id（POST /tender-review/review/upload 返回）；不带即纯文本审查' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fileId?: string;
  ```
  ```ts
  // TenderReviewController
  async executeReview(
    @Body() dto: ExecuteReviewDto,
    @Body('documentContent') documentContent: string,
    @Body('documentName') documentName: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  )
  ```

- [ ] **Step 1: 写失败的测试（执行审查）** —— 追加到 `tender-review.controller.spec.ts` 文件末尾。同时把文件里既有的三条 `executeReview` 调用从五个参数改成四个：删掉 `objectKey: 'k',` 与实参里的 `'k',`。

```ts
describe('TenderReviewController.executeReview — 只收上传记录 id（审计第 3 处）', () => {
  const KB_MOCK = { id: 'kb-1', ownerId: 'u1', isShared: true };
  const BASE = { knowledgeBaseId: 'kb-1', reviewMode: 'general' as const, documentContent: 'c', documentName: 'n.docx' };

  const arrange = (asset: unknown) => ({
    knowledgeBase: { findUnique: jest.fn().mockResolvedValue(KB_MOCK) },
    fileAsset: { findUnique: jest.fn().mockResolvedValue(asset) },
    reviewTask: { create: jest.fn().mockResolvedValue({ id: 't-1' }) },
    userSettings: { upsert: jest.fn() },
  });
  const OWN_UPLOAD = { id: 'fa-1', key: 'review/2026-11-25/0123456789abcdef0123456789abcdef.docx', category: 'tender_review_source', uploaderId: 'u1' };

  it('带 fileId：任务的 objectKey 取的是资产行里的键', async () => {
    const prisma: any = arrange(OWN_UPLOAD);
    const controller = buildControllerWith(prisma);
    await controller.executeReview({ ...BASE, fileId: 'fa-1' } as any, 'c', 'n.docx', USER);
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ objectKey: OWN_UPLOAD.key }) });
    expect(prisma.fileAsset.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'fa-1' } }));
  });

  it('不带 fileId（纯文本审查）：任务的 objectKey 是空串，不查文件记录', async () => {
    const prisma: any = arrange(null);
    const controller = buildControllerWith(prisma);
    await controller.executeReview({ ...BASE } as any, 'c', 'n.docx', USER);
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ objectKey: '' }) });
    expect(prisma.fileAsset.findUnique).not.toHaveBeenCalled();
  });

  it('fileId 是别人的上传 → 403 REVIEW_FILE_FORBIDDEN，不建任务', async () => {
    const prisma: any = arrange({ ...OWN_UPLOAD, uploaderId: 'u2' });
    const controller = buildControllerWith(prisma);
    await expect(controller.executeReview({ ...BASE, fileId: 'fa-1' } as any, 'c', 'n.docx', USER)).rejects.toMatchObject({ response: { code: 'REVIEW_FILE_FORBIDDEN' } });
    expect(prisma.reviewTask.create).not.toHaveBeenCalled();
  });

  it('admin 可以用别人的上传；任务的属主是发起审查的 admin', async () => {
    const prisma: any = arrange({ ...OWN_UPLOAD, uploaderId: 'u2' });
    const controller = buildControllerWith(prisma);
    const ADMIN = { sub: 'u-admin', role: 'admin' } as any;
    await controller.executeReview({ ...BASE, fileId: 'fa-1' } as any, 'c', 'n.docx', ADMIN);
    expect(prisma.reviewTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ objectKey: OWN_UPLOAD.key, userId: 'u-admin' }) });
  });

  it.each([
    ['记录不存在', null],
    ['类目不是审查源文件', { id: 'fa-9', key: 'uploads/2026-11-25/abc.docx', category: 'general', uploaderId: 'u1' }],
    ['类目对但键不在审查命名空间', { id: 'fa-9', key: 'uploads/2026-11-25/abc.docx', category: 'tender_review_source', uploaderId: 'u1' }],
    ['键越界', { id: 'fa-9', key: 'review/../sealed-backup/k', category: 'tender_review_source', uploaderId: 'u1' }],
  ])('%s → 400 REVIEW_FILE_INVALID，不建任务', async (_label, asset) => {
    const prisma: any = arrange(asset);
    const controller = buildControllerWith(prisma);
    await expect(controller.executeReview({ ...BASE, fileId: 'fa-9' } as any, 'c', 'n.docx', USER)).rejects.toMatchObject({ response: { code: 'REVIEW_FILE_INVALID' } });
    expect(prisma.reviewTask.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 写失败的测试（下载授权与类目登记）**

`upload.service.spec.ts` 追加到顶层 `describe('UploadService — download permission', …)` 内、`describe('合同文档内部用户公司隔离'…` 之前：

```ts
  describe('审查源文件（审计第 3 处）：只对上传者本人与 admin 开放', () => {
    const reviewSource = { ...asset, id: 'fa-review', category: 'tender_review_source', uploaderId: 'u-owner', key: 'review/2026-11-25/abc.pdf' };

    it('别的内部角色下不了——不落进内部角色的兜底放行', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(reviewSource);
      for (const other of [{ sub: 'u-company-a', role: 'staff' }, { sub: 'u-leader', role: 'leader' }, { sub: 'u-host', role: 'bid_host' }]) {
        await expect(service.streamFile('fa-review', other, res)).rejects.toMatchObject({ response: { code: 'FILE_FORBIDDEN' } });
      }
    });

    it('上传者本人与 admin 能下', async () => {
      prisma.fileAsset.findUnique.mockResolvedValue(reviewSource);
      jest.spyOn(minioClient, 'getObject').mockClear().mockResolvedValue({ pipe: jest.fn() } as any);
      await service.streamFile('fa-review', { sub: 'u-owner', role: 'staff' }, res);
      await service.streamFile('fa-review', { sub: 'u-admin', role: 'admin' }, res);
      expect(minioClient.getObject).toHaveBeenCalledTimes(2);
    });
  });
```

`upload-categories.spec.ts` 追加：

```ts
  it('审查源文件类目已登记；供应商与专家不能经通用上传伪造', () => {
    expect(UPLOAD_CATEGORIES.has('tender_review_source')).toBe(true);
    expect(isUploadCategoryAllowedForRole('tender_review_source', 'supplier')).toBe(false);
    expect(isUploadCategoryAllowedForRole('tender_review_source', 'bid_expert')).toBe(false);
  });
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && ./node_modules/.bin/jest tender-review.controller upload.service upload-categories`
Expected: FAIL。执行审查的六条里除「不带 fileId」外都失败（`fileId` 还没人解析；`objectKey` 还在 DTO 里）；下载授权的两条里「别的内部角色下不了」失败（现在会兜底放行）；类目登记那条失败。

- [ ] **Step 4: 改 DTO 与控制器**

`review.dto.ts`：删 `objectKey` 字段，加 `fileId`（见 Interfaces，import 里补 `MaxLength`）。

`tender-review.controller.ts`：`executeReview` 去掉 `@Body('objectKey') objectKey: string` 这个参数；在项目存在性校验之后、建任务之前加 `const sourceKey = await this.resolveReviewSourceFile(dto.fileId, user);`；建任务的 `objectKey` 写 `sourceKey`。新增私有方法：

```ts
  /** 按上传记录 id 解析审查用的文件：只认本人上传（admin 例外）的审查源文件记录，键必须落在审查命名空间内 */
  private async resolveReviewSourceFile(fileId: string | undefined, user: AuthenticatedUser | undefined): Promise<string> {
    if (!fileId) return '';
    const asset = await this.prisma.fileAsset.findUnique({
      where: { id: fileId },
      select: { key: true, category: true, uploaderId: true },
    });
    // 不存在、类目不对、键越界三种情况同一口径——不泄露别的资产是否存在
    if (!asset || asset.category !== REVIEW_SOURCE_CATEGORY || !isReviewObjectKey(asset.key)) {
      throw new BadRequestException({ error: '上传记录无效，请重新上传文件', code: 'REVIEW_FILE_INVALID' });
    }
    if (asset.uploaderId !== user?.sub && user?.role !== 'admin') {
      throw new ForbiddenException({ error: '无权使用该上传文件', code: 'REVIEW_FILE_FORBIDDEN' });
    }
    return asset.key;
  }
```

- [ ] **Step 5: 登记类目并收窄下载**

`upload-categories.ts` 的 `UPLOAD_CATEGORIES` 加 `'tender_review_source'`（注释写明由 `POST /tender-review/review/upload` 产生）。

`upload.service.ts` 的 `canAccessFile`：在 `if (asset.uploaderId && asset.uploaderId === user.sub) return true;`（现第 416 行）之后紧接着加：

```ts
    // 审查用源文件（文档审查上传，2026-11-25）：只归上传者本人与 admin——别让它落进下面内部角色的兜底放行
    if (asset.category === 'tender_review_source') return user.role === 'admin';
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && ./node_modules/.bin/jest tender-review upload.service upload-categories`
Expected: PASS，既有用例与新用例全绿。

- [ ] **Step 7: 类型检查**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && ./node_modules/.bin/tsc --noEmit --incremental false`
Expected: 退出码 0。

- [ ] **Step 8: 提交**

```bash
cd /home/asus/桌面/ERP && git branch --show-current && git status --short
git add water-erp/apps/api/src/tender-review/dto/review.dto.ts \
        water-erp/apps/api/src/tender-review/tender-review.controller.ts \
        water-erp/apps/api/src/tender-review/tender-review.controller.spec.ts \
        water-erp/apps/api/src/upload/upload-categories.ts \
        water-erp/apps/api/src/upload/upload-categories.spec.ts \
        water-erp/apps/api/src/upload/upload.service.ts \
        water-erp/apps/api/src/upload/upload.service.spec.ts
git diff --cached --stat
git commit -m "fix(audit-b1): 第 3 处——执行审查只收上传记录 id（属主与类目校验）·审查源文件只对本人与 admin 可下" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Expected: 暂存区只有这七个文件。

---

### Task 4: 工作台改传 fileId

接口契约变了，:3005 的两个入口要跟着改，否则上传后的审查拿不到文件。这一步必须和 Task 2、3 同批部署。

**Files:**
- Modify: `water-erp/apps/web/src/lib/api/review.ts:21-53`
- Modify: `water-erp/apps/web/src/components/tender-review/use-tender-review.ts:123-129`
- Modify: `water-erp/apps/web/src/components/tender-review/review-workspace-content.tsx:75`
- Modify: `water-erp/apps/web/src/components/tender-review/project-review-flow.tsx:148`

不改：`apps/web/src/lib/types/tender-review.ts` 的 `ReviewTask.objectKey`（服务端仍然返回它，前端只用它判断「任务有没有文件」）、`components/tender-review/report-context-bar.tsx:106`。

- [ ] **Step 1: 改 API 客户端**

`review.ts` 的 `uploadReviewDocument` 返回类型里 `objectKey: string` 换成 `fileId: string`。`executeReview` 的参数类型里 `objectKey: string` 换成 `fileId?: string`。

- [ ] **Step 2: 改两个调用处与中间的钩子**

`use-tender-review.ts` 的 `startReview` 参数类型：`objectKey: string` → `fileId?: string`。`review-workspace-content.tsx` 第 75 行 `objectKey: uploadResult.objectKey` → `fileId: uploadResult.fileId`。`project-review-flow.tsx` 第 148 行 `objectKey: uploaded.objectKey` → `fileId: uploaded.fileId`。

- [ ] **Step 3: 类型检查与残留扫描**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/web && ./node_modules/.bin/tsc --noEmit && ! grep -rn "objectKey: upload\|objectKey: uploaded\|objectKey: string;" src/lib/api/review.ts src/components/tender-review/use-tender-review.ts src/components/tender-review/review-workspace-content.tsx src/components/tender-review/project-review-flow.tsx`
Expected: tsc 退出码 0；`grep` 没有命中（命令整体退出码 0）。

- [ ] **Step 4: 提交**

```bash
cd /home/asus/桌面/ERP && git branch --show-current && git status --short
git add water-erp/apps/web/src/lib/api/review.ts \
        water-erp/apps/web/src/components/tender-review/use-tender-review.ts \
        water-erp/apps/web/src/components/tender-review/review-workspace-content.tsx \
        water-erp/apps/web/src/components/tender-review/project-review-flow.tsx
git diff --cached --stat
git commit -m "fix(audit-b1): 第 3 处——工作台审查两个入口改传上传记录 id，不再经手对象键" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Expected: 暂存区只有这四个文件。

---

### Task 5: e2e——上传登记、越权与旧字段被忽略

**Files:**
- Create: `water-erp/apps/api/test/tender-review-source-file.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2、3 的接口契约。
- Produces: 无（纯测试）。

- [ ] **Step 1: 写 e2e 用例**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

async function loginAs(app: INestApplication, username: string, password: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Portal', 'web')
    .send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

describe('文档审查上传记录（审计第 3 处）(e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staff: string[];
  let leader: string[];
  let admin: string[];
  let staffUserId: string;
  let kbId: string;
  const createdTaskIds: string[] = [];
  const createdAssetIds: string[] = [];

  const upload = (cookie: string[], filename: string) =>
    request(app.getHttpServer())
      .post('/api/tender-review/review/upload')
      .set('Cookie', cookie)
      .set('X-Portal', 'web')
      .attach('file', Buffer.from('纯文本审查正文'), { filename, contentType: 'text/plain' });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    staff = await loginAs(app, 'Swhi-CGZX-05', 'Swhi-CGZX-05@2026');
    leader = await loginAs(app, 'Swhi-CGZX-01', 'Swhi-CGZX-01@2026');
    admin = await loginAs(app, 'Swhi-CGZX-admin', 'Swhi-CGZX-admin@2026');
    staffUserId = (await prisma.user.findFirst({ where: { username: 'Swhi-CGZX-05' } }))!.id;
    kbId = (await prisma.knowledgeBase.findFirst())!.id;
  });

  afterAll(async () => {
    await prisma.reviewTask.deleteMany({ where: { id: { in: createdTaskIds } } });
    await prisma.fileAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
    await app.close();
  });

  const track = async (res: request.Response) => {
    if (res.body?.fileId) createdAssetIds.push(res.body.fileId);
    if (res.body?.taskId) createdTaskIds.push(res.body.taskId);
    return res;
  };

  it('上传即登记为本人名下的文件记录；响应不给对象键，键不含用户文件名', async () => {
    const res = await track(await upload(staff, 'e2e-审查源文件.txt'));
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('objectKey');
    expect(typeof res.body.fileId).toBe('string');

    const asset = await prisma.fileAsset.findUnique({ where: { id: res.body.fileId } });
    expect(asset?.category).toBe('tender_review_source');
    expect(asset?.uploaderId).toBe(staffUserId);
    expect(asset?.originalName).toBe('e2e-审查源文件.txt');
    expect(asset?.key).toMatch(/^review\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{32}\.txt$/);
  });

  it('带 fileId 执行审查 → 任务的 objectKey 是资产行里的键', async () => {
    const up = await track(await upload(staff, 'e2e-执行用.txt'));
    const res = await track(await request(app.getHttpServer())
      .post('/api/tender-review/review/execute')
      .set('Cookie', staff)
      .set('X-Portal', 'web')
      .send({ knowledgeBaseId: kbId, reviewMode: 'general', documentContent: '纯文本审查正文', documentName: 'e2e-执行用.txt', fileId: up.body.fileId }));
    expect(res.status).toBe(201);
    const asset = await prisma.fileAsset.findUnique({ where: { id: up.body.fileId } });
    const task = await prisma.reviewTask.findUnique({ where: { id: res.body.taskId } });
    expect(task?.objectKey).toBe(asset?.key);
  });

  it('别人的上传记录 → 403 REVIEW_FILE_FORBIDDEN，不建任务', async () => {
    const up = await track(await upload(staff, 'e2e-他人工号.txt'));
    const before = await prisma.reviewTask.count();
    const res = await request(app.getHttpServer())
      .post('/api/tender-review/review/execute')
      .set('Cookie', leader)
      .set('X-Portal', 'web')
      .send({ knowledgeBaseId: kbId, reviewMode: 'general', documentContent: 'x', documentName: 'x.txt', fileId: up.body.fileId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REVIEW_FILE_FORBIDDEN');
    expect(await prisma.reviewTask.count()).toBe(before);
  });

  it('指向别的类目的资产 → 400 REVIEW_FILE_INVALID，不建任务', async () => {
    const other = await prisma.fileAsset.create({
      data: { key: 'uploads/e2e/other-category.bin', originalName: 'o.bin', mimeType: 'application/octet-stream', size: 1, sha256: 'e2e', category: 'general', uploaderId: staffUserId },
    });
    createdAssetIds.push(other.id);
    const before = await prisma.reviewTask.count();
    const res = await request(app.getHttpServer())
      .post('/api/tender-review/review/execute')
      .set('Cookie', staff)
      .set('X-Portal', 'web')
      .send({ knowledgeBaseId: kbId, reviewMode: 'general', documentContent: 'x', documentName: 'x.txt', fileId: other.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REVIEW_FILE_INVALID');
    expect(await prisma.reviewTask.count()).toBe(before);
  });

  it('请求体继续带旧的 objectKey 字段 → 被忽略，任务 objectKey 为空串', async () => {
    const res = await track(await request(app.getHttpServer())
      .post('/api/tender-review/review/execute')
      .set('Cookie', staff)
      .set('X-Portal', 'web')
      .send({ knowledgeBaseId: kbId, reviewMode: 'general', documentContent: 'x', documentName: 'x.txt', objectKey: '../.env' }));
    expect(res.status).toBe(201);
    const task = await prisma.reviewTask.findUnique({ where: { id: res.body.taskId } });
    expect(task?.objectKey).toBe('');
  });

  it('审查源文件：别的内部角色下不了，上传者本人与 admin 能下', async () => {
    const up = await track(await upload(staff, 'e2e-下载授权.txt'));
    const denied = await request(app.getHttpServer()).get(`/api/upload/files/${up.body.fileId}`).set('Cookie', leader).set('X-Portal', 'web');
    expect(denied.status).toBe(403);
    for (const cookie of [staff, admin]) {
      const ok = await request(app.getHttpServer()).get(`/api/upload/files/${up.body.fileId}`).set('Cookie', cookie).set('X-Portal', 'web');
      expect(ok.status).toBe(200);
      expect(ok.text).toBe('纯文本审查正文');
    }
  });
});
```

执行审查会触发后台的模型调用；隔离环境没有配模型密钥，任务会以失败收场，这正是既有 `tender-review-project.e2e-spec.ts` 的情形，本套件不对任务的最终状态做断言。

- [ ] **Step 2: 在隔离环境里跑本套件**

按全局约束里的隔离做法跑：

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && <隔离包装脚本> ./node_modules/.bin/jest --config test/jest-e2e.json --forceExit tender-review-source-file`
Expected: PASS，6 个用例全绿。

- [ ] **Step 3: 回归既有的审查流 e2e 与全量**

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && <隔离包装脚本> ./node_modules/.bin/jest --config test/jest-e2e.json --forceExit tender-review-project`
Expected: PASS，6 个用例全绿（这个套件的请求体还带着旧的 `objectKey` 字段，应当被静默忽略）。

Run: `cd /home/asus/桌面/ERP/water-erp/apps/api && <隔离包装脚本> ./node_modules/.bin/jest --config test/jest-e2e.json --forceExit`
Expected: 从空库（重灌种子）起跑全量通过。已知抖动：`opening-hall` 的 WebSocket 入会竞态，失败时单独从空库重跑该套件确认能过，并在汇报里写明。若有别的套件因为 `StorageService` 的键底线失败，按 Task 1 第 9 步的办法处理。

- [ ] **Step 4: 合回后在开发环境走一遍真实链路**

合回 main 之后（开发环境的 API 会自动重启），用 :3005 的「文档审查」页：

1. 上传一个 `.docx`，发起审查；
2. 审查完成后接受一条修改建议，下载修改后的文档；
3. 确认下载得到的是 docx，库里的 `FileAsset` 行类目是 `tender_review_source`、属主是登录人。

用别的内部账号访问该文件的 `/api/upload/files/<id>` 直链，应当 403。

- [ ] **Step 5: 提交**

```bash
cd /home/asus/桌面/ERP && git branch --show-current && git status --short
git add water-erp/apps/api/test/tender-review-source-file.e2e-spec.ts
git commit -m "test(audit-b1): 第 3 处——e2e：审查上传登记、他人上传被拒、越界键不再能进任务" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Expected: 只提交这一个文件。

- [ ] **Step 6: 文档同步**

1. 在 `CLAUDE.md` 的 File Uploads 节、上一处那条引文的后面用脚本追加一段：
   > **审查源文件（2026-11-25 审计第 3 处）**：`POST /tender-review/review/upload` 把文件登记为 `FileAsset`（`category=tender_review_source`，属主=登录人，键 `review/<yyyy-MM-dd>/<32 位随机>.<扩展名>`）并只返回 `fileId`；`review/execute` 只收 `fileId`（不带即纯文本审查），不再接受对象键。审查模块每次读写存储前过 `assertReviewObjectKey`；`StorageService` 四个方法对键设底线 `INVALID_OBJECT_KEY`（非法键、越界、控制字符）；新类目在通用下载里只对上传者本人与 admin 开放——**别把它加进内部角色的兜底放行**。
2. 在本文件末尾追加「执行记录」：与计划的差异、验证结论、留给后续的事。

---

## 执行记录（2026-11-25 ～ 2026-11-26）

**执行方式**：用户选「在隔离工作区做、本会话直接做」——worktree `.worktrees/b1-cluster3`、分支 `fix/b1-cluster3`，共九个提交，已变基到 main `3a40d73f4`（`1c2b3c2a5..4cc88d57a`），2026-11-26 快进合入本地 main（未推送）；worktree 与分支已删。

| 提交 | 内容 |
|---|---|
| `1c2b3c2a5` | （一）审查模块用键前过命名空间守卫；`StorageService` 四个方法加键底线 |
| `16111feba` | （二）上传即登记 `FileAsset`，响应只给 `fileId` |
| `20d8a234d` | （三）执行审查只收 `fileId`（属主、类目、键三查）；新类目只对本人与 admin 可下 |
| `90ba31f4c` | （四）工作台两个入口改传 `fileId` |
| `e7cdea3a4` | （五）e2e |
| `106941260` | （六）删除任务时连带清理源文件（用户 11-26 追加） |
| `4c0209adc` | platform-push e2e 等待审计行（用户 11-26 追加，不属审计第 3 处） |
| `3a2a622b3` | （八）终审修复：连带清理只认登记过的审查源文件 |
| `4cc88d57a` | （九）终审建议的三条测试（钉住既有行为，产品代码未动；用户 11-26 指定） |

**与计划的差异**

1. 「没有关联文件的任务接受建议」那条用例：既有代码在无文件时也把 `modificationApplied` 置真（原有瑕疵，不是安全问题）。用例改为只保护「状态落库 + 不碰存储」，行为没动。
2. 计划外补了一条：对象已落存储但登记失败 → 删掉刚上传的对象。登记是所有权的依据，不留无主的孤儿对象。
3. 三处纯测试侧修正：`getObject` 桩改成真实可读流；`it.each` 两列表的回调补第二形参；错误码断言改 try/catch + `toMatchObject`。
4. 隔离环境改用自建的私有栈（库 `water_erp_e2e_c3`、Redis `:6391`、桶 `water-erp-e2e-c3`）——共享隔离库当时被另一会话连轮占用。
5. 用户 11-26 追加两项（「（六）连带清理」与「platform-push 等待审计行」），并定：O2-1 那组归属问题记到第 7 处；发布护栏不放宽；部署顺序先 API 后工作台。
6. 独立终审提出 Important 1，修成「（八）」。

**独立终审**（全新上下文，2026-11-26）：没有 Critical；Important 1 条，已修；Minor 7 条与若干「不予评判」项逐条裁定，没做的列在下面「留给后续」。

**验证结论**（变基到 main `3a40d73f4` 之后的最终提交 `4cc88d57a`）

- 全量单测 358 套件 5048/5048；API `tsc --noEmit` 0；工作台 `tsc --noEmit` 0。
- 私有栈空库全量 e2e：26 套件 233/233（在提交 `3a2a622b3` 上跑的；其后的「（九）」只新增测试，受影响的那个套件单跑 10/10）；运行日志里键底线报错 0 条。被排除的 `announcement-tender-source-key`（它的发布前护栏只认共享库名）在共享隔离栈上用本分支代码单跑：1/1，跑完库里无残留。
- 终审修复的用例先红后绿。e2e 那条的红是真实事故：别人的备份对象被删掉，读回时报 `The specified key does not exist`。
- 「（九）」的三条测试写完即通过，各自用「临时改坏产品代码」证明拦得住回归：去掉执行时的键命名空间判断，只有新的 e2e 失败；让存储底线按字符集收紧，只有存量键那条失败；去掉下载授权里的类目判断，供应商与专家两条连同既有的内部角色用例失败。
- 开发库只读核对（金仓 `water_erp`，只出计数不出内容）：`ReviewTask` 共 22 条——命名空间外 0、形态不认识 0、指向他人备份 0、含 `..` 0。同一键挂多个任务的 1 组（同一份文件审了多次，正常）。
- 开发环境真实链路走查（合回后，2026-11-26；无头浏览器驱动 :3005「文档审查」页，账号 `Swhi-CGZX-09`）全部通过，页面报错 0 条：
  - 上传响应只有 `fileId`、`documentName`、`content`、`contentLength` 四个字段，不含对象键；执行请求体带 `fileId`、不带 `objectKey`；
  - 审查完成后接受一条修改（`PATCH issues/resolve` 200），点「导出修订文件」得到 docx（829,733 字节，正文确为接受修改后的文本）；库里的文件记录类目是 `tender_review_source`、属主是登录人，任务的 `objectKey` 等于文件记录的键；对象存储里主对象已改写，`.original` 备份是 37,218 字节的原件；
  - 另一个内部账号（`Swhi-CGZX-10`）访问该文件的通用下载直链与任务下载端点都是 403，查看任务也是 403；
  - 删除运行中的任务（发起后 0.35 秒，单击任务队列条的「删除任务」）返回 200，任务、文件记录、对象、备份全部清掉，API 进程没有重启；
  - 上传 `.doc` 返回 201，键以 `.doc` 结尾，从上传到任务创建共 0.38 秒（小文件；大文件仍受 :3005 代理 15 秒限制）；
  - 走查产生的任务、文件记录、对象已全部清掉，两个账号已登出，开发库审查任务数回到 22。

**连带清理的规则**（CLAUDE.md 注记要带上；2026-11-26 跟进批次之后以这里为准）

- 一份上传可以被多个任务共用：任务行删掉之后按 `objectKey` 数引用，没人用才清；清 = `.original` 备份 + 主对象 + 文件记录。
- 只清登记过的审查源文件：这个键名下要有审查源文件类目（正常或待清）的记录，且键在 `review/` 命名空间内。键越界、没有记录、记录是别的类目，存储一律不碰（存量任务的键是修复前写的，那时任何内部角色都能写）。
- 清理分两步：锁住文件记录行、数引用、把记录标成「待清」（类目 `tender_review_source_purging`）→ 删对象 → 删记录。先备份后主对象。任何一步出错，记录留在待清状态，每日清理接着清；对象存储报「对象不存在」当作已删。清理任何一步出错都不影响「任务已删除」。
- 执行审查建任务与清理锁同一个文件记录行，建任务在锁内复核类目：标成待清之后不会再有任务引用到它。
- 没人用的上传（上传后没执行审查、或执行时被拒）满 24 小时由每日清理删掉。

**上线前核对**（生产库，只读；五项都应为 0，不为 0 的行人工处理后再发——第五项查出来的记录，产品内已经没有任何入口能删）

```sql
select count(*) from "ReviewTask"
 where "objectKey" <> '' and ("objectKey" is null or "objectKey" not like 'review/%');
select count(*) from "ReviewTask"
 where "objectKey" like 'review/%'
   and "objectKey" !~ '^review/[0-9]{13}_[^/]+$'
   and "objectKey" !~ '^review/[0-9]{4}-[0-9]{2}-[0-9]{2}/[a-f0-9]{32}[.](pdf|docx|doc|txt)$';
select count(*) from "ReviewTask" a
  join "ReviewTask" b on a."objectKey" = b."objectKey" || '.original'
 where a.id <> b.id;
select count(*) from "ReviewTask" where "objectKey" ~ '(^|/)\.\.(/|$)';
select count(*) from "FileAsset"
 where "category" in ('tender_review_source', 'tender_review_source_purging')
   and ("key" is null or "key" not like 'review/%');
```

语句以这里的单引号写法为准，已在开发库金仓上跑通。

**留给后续**

- 前后端同批部署，先 API 后工作台。旧的缓存前端继续发 `objectKey` 会被静默忽略，任务退化成纯文本审查。
- 第 7 处：`project-status` 按项目返回任意属主的最新任务（O2-1）等归属问题。
- 上一轮终审留下的五条次要项已在跟进批次里处理（见下一节）：截断一条是用户要求修的（「十」），其余四条用户裁定「按你的理解决定并修复」（「十一」～「十七」）。
- 审查上传端点不在 :3005 代理的慢路径清单里，`.doc` 转换可能超过 15 秒（既有现象，归入 PMI 重端点「处理中 + 自动重取」那条线）。

### 跟进批次（2026-11-26）：截断修复与四条次要项

**执行方式**：同一会话做。截断修复（「十」）先落在 main 上；其余四条在隔离工作区 `.worktrees/b1-c3-minors` 做（当时主工作区有另一会话未提交的改动），分支已变基到 main `65943dcb0`，快进合入本地 main（未推送）。

| 提交 | 内容 |
|---|---|
| `67930f993` | （十）接受修改、落批注、撤销改写之后同步文件记录的 `size`/`sha256`，通用下载不再按旧长度发 `Content-Length` |
| `9517cbac5` | （十一）清理分两步；执行审查建任务与清理都先锁文件记录行 |
| `26523d952` | （十二）每日清理：满 24 小时没人用的上传自动清，待清记录次日接着清 |
| `8e0e36bd7` | （十三）通用上传口不再收审查源文件类目；通用删除口删不了审查源文件 |
| `4e280274c` | （十四）删除在跑的任务先终止审查；审查没跑完的回写不再留未处理的拒绝 |
| `a286de5f6` | （十五）任务栏删除先弹确认框；两处删除确认说明各自后果 |
| `a32f54cd1` | （十六）终审修复：每日清理先筛「没人用」再限量；对象本来就不在当作已删 |
| `49f813371` | （十七）终审修复：在跑任务的删除确认说明源文件会一并删除；任务栏空了确认框也画完 |

**四条次要项各自怎么处理的**

1. **清理失败没有重试入口。** 清理分两步：锁住文件记录行、数引用、把记录标成「待清」→ 删 `.original` 备份与主对象 → 删记录。任何一步出错，记录留在待清状态，每日清理不看上传时间接着清。两步之间不拿着数据库事务去碰对象存储——对象存储一慢，删任务的请求会把连接池的连接按事务超时一枚枚占住。
2. **执行审查与删除任务之间的竞态。** 两边锁同一个文件记录行（`SELECT … FOR UPDATE`）。执行审查在锁内复核类目，待清的文件不会再被任务引用。
3. **上传后没建成任务的文件不清理。** 每日 03:50 清理（`scheduler/review-source-cleanup.service.ts`）：满 24 小时、没有任何任务在用的上传自动清，与 v3-staging 暂存清理同口径。
4. **删除在跑的任务不中止审查、单击无确认。** 先终止审查（与「停止任务」是同一个信号）再删任务，不是拒绝删除——任务栏上停止与删除并排，拒绝会让人多点一步；任务栏删除先过确认框。

**顺带补的两处同源缺口**（源文件登记成文件记录之后才出现）

- 通用上传口能登出一条键不在审查命名空间的「审查源文件」记录：执行审查不认、清理也不认，是一条永远清不掉的孤儿。现在这个类目不在通用上传白名单里，审查源文件只能经 `POST /tender-review/review/upload` 登记。
- 通用删除口（`DELETE /api/upload/:key`）能删掉正被任务使用的源文件：不看引用、不删备份，删完任务指向一个不存在的文件。现在 409 `FILE_PROTECTED`，清理只走审查模块。

**裁定**

- **与 spec 3.3 第 4 点的字面偏离**：spec 写「`UPLOAD_CATEGORIES` 加入新类目」，本批把这个类目移出白名单。spec 那一句的目的是「可下载范围不扩大」；移出后更严（通用上传口从此登不出这种记录），通用下载里「只对上传者本人与 admin 开放」的分支仍在。
- 通用删除口的越权检查仍在类目保护之前：不是上传者本人也不是 admin/bid_host 的照旧 403。
- 存量脏记录（类目是审查源文件、键却不在命名空间）不迁移不清理——第 3 处尚未上线，通用上传口从此登不出这种记录。上线前核对加了第五条 SQL 来证实库里为零。
- 不修「接受修改进行中时删掉任务」：完整封住要么持锁写对象、要么引入在途登记，代价大于收益；后果只是这份文件留在存储里，成为没有记录的孤儿对象（只是泄漏）。
- 终审的另外三条建议没有采纳：删除接口带回清理结果字段（清理没做完的文件次日自动清，属可接受的最终一致）；改写进行中删任务返 409（同上一条）；进程启动时对待清记录跑一次清理（启动期多一处依赖对象存储可用性的操作，代价是崩溃后的待清记录最长等到次日）。

**独立终审**（全新上下文，2026-11-26，范围 `65943dcb0..a286de5f6`）：没有 Critical。Important 4 条——每日清理先限量后过滤（被任务留住的记录攒满一批之后，没人用的上传永远清不到，而且候选为空时不打日志，是静默失效）、在跑任务的删除确认没说源文件会一并删除，这两条已修（「十六」「十七」）；CLAUDE.md 注记与真实浏览器走查按约定在合回之后做。Minor 12 条，顺手修了 4 条（都在本批改过的代码里、各一两行），其余记在下面「已知遗留」。

**验证结论**（终审修复之后的最终提交 `49f813371`）

- 全量单测 360 套件 5097/5097；API `tsc --noEmit` 0；工作台 `tsc --noEmit` 0；工作台单测 155 通过、0 失败（4 条既有跳过）；copy-lint 通过。
- 共享隔离栈空库全量 e2e：27 套件 245/245（含上一轮被排除的 `announcement-tender-source-key`）。
- 每条修复的用例都先红后绿。e2e 一级的用「临时改坏产品代码」核对过拦得住回归：建任务不加行锁、清理不留待清标记、每日清理不管待清记录、每日清理不设 24 小时门槛、通用上传白名单重新收审查源文件类目、通用删除口去掉保护、每日清理不按键筛、删任务不终止审查——各自对应用例转红后还原。
- 终审修复的那条取数缺陷，原来的单测没拦住，是因为假库忽略了 `take`/`orderBy`；假库改成照做这两个参数之后，用例先红后绿。
- 上线前核对第五条 SQL 已在开发库金仓上跑通（结果 0）。
- 开发环境真实链路走查（合回后）：（合回 main 之后做，结论见下一笔文档提交）
- 另外发现一件与本批无关的事：在 worktree 里试跑工作台的 `next build --webpack`，Next 的页面类型检查过不了——`src/app/(main)/expert/extract/page.tsx` 与 `supplier/selection/page.tsx` 各多导出了一个具名组件（`ExpertExtractPage`、`SupplierSelectionPage`，自 `04f44116c` 起就有）。dev 与 `tsc --noEmit` 不受影响；没有在主工作区复现（会动到运行中的 dev 目录）。如果生产打包用的是 `next build`，值得单独确认。

**已知遗留**

- 接受修改进行中时删掉任务：改写照样写回原键，这份文件之后没有任何记录会去清它（无记录的孤儿对象）。
- 终审留下、没有修的次要项：
  - 审查终止成功但删任务行失败：任务留在「审查中」，等僵尸清扫（最长约 35 分钟）才变成失败；
  - 行锁等待超过事务 5 秒超时，返回的是通用 500；
  - `ReviewTask.objectKey`、`FileAsset.category` 没有索引（要改 schema，留给下一个迁移窗口）；
  - 删存量任务时「没有审查源文件记录」打的是告警（预期情况，每条存量任务一次）；
  - 通用删除口 409 的文案对没人用的上传不准确（界面上走不到这条路）；
  - 清理没做完时删除接口仍只回「任务已删除」，不带清理结果；
  - 进程启动时不对待清记录跑一次清理；
  - 报告面板里的确认框（停止、删除记录，既有现象）只盖住内容面板——那个面板的入场动画停在 `transform: translateY(0)`，fixed 定位的弹窗以它为容器，不是整个视口；任务栏的确认框不受影响（所在容器没有 transform）。
- 保留的审查记录与源文件随使用量增长（任务列表只回最近 50 条，更早的在界面上删不掉）——存储问题，产品决策。
- 回滚注意：回滚到本批之前的版本之后，待清状态的记录不会被清理，旧版通用下载按类目名精确匹配，内部角色可以下载待清状态的文件；重新部署本批后自愈。本批自身对 API 与工作台没有先后约束（后端先行更稳：旧前端的删除按钮没有确认框，但终止审查与连带清理照常）。
