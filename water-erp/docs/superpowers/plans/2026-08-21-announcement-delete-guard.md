# 进行中项目公告删除禁令 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻断删除公告级联销毁进行中项目数据（P0-4）——SUBMIT/OPENING/EVALUATING 阶段删除 → 409 `BID_IN_PROGRESS`（零副作用引导），DOWNLOAD/ARCHIVED/无关联删除行为不变。

**Architecture:** announcement.service remove() 内三态闸门（事务前抛 409）；测试锁定四类行为；CLAUDE.md 一句话文档。

**Tech Stack:** NestJS 11 + Prisma（API）。

**Spec:** `water-erp/docs/superpowers/specs/2026-08-21-announcement-delete-guard-design.md`

## Global Constraints

- 错误形状：`ConflictException({ error, code })`；单测 `.rejects.toMatchObject({ response: { code } })`。
- 不主动 push；commit 前查分支；验证 `pnpm --filter api test -- announcement`。
- CLAUDE.md 修改走 Bash。

---

### Task 1: 闸门 + 测试

**Files:**
- Modify: `water-erp/apps/api/src/announcement/announcement.service.ts`（remove() ~:400-430 区域）
- Test: `water-erp/apps/api/src/announcement/announcement.service.spec.ts`（新 describe「P0-4 删除闸门」）

**Interfaces:**
- Consumes: 无新依赖（prisma/minio mock 沿用 spec 既有骨架）。
- Produces: remove() 对 SUBMIT/OPENING/EVALUATING 关联项目 → 409 `BID_IN_PROGRESS`（事务前，零副作用）；其余路径行为不变。

- [ ] **Step 1: 失败测试**

```ts
describe('P0-4 删除闸门（进行中项目禁删公告）', () => {
  const inFlightStages = ['SUBMIT', 'OPENING', 'EVALUATING'] as const;
  for (const stage of inFlightStages) {
    it(`${stage} 项目删公告 → 409 BID_IN_PROGRESS 且零销毁副作用`, async () => {
      prisma.announcement.findUnique.mockResolvedValue({ id: 'a1', relatedProjectCode: 'X', type: 'BID_NOTICE' });
      prisma.bidProject.findUnique.mockResolvedValue({ id: 'p1', projectCode: 'X', stage, riskNote: '' });
      await expect(service.remove('a1')).rejects.toMatchObject({ response: { code: 'BID_IN_PROGRESS' } });
      // 零副作用：五个 deleteMany / removeObject / announcement.delete 均未调
      for (const key of ['bidOpeningSession', 'bidOpeningRecord', 'bidScoreRecord', 'bidEvaluationResult', 'bidInvalidBid']) {
        expect(prisma[key].deleteMany).not.toHaveBeenCalled();
      }
      expect(minioClient.removeObject).not.toHaveBeenCalled();
      expect(prisma.announcement.delete).not.toHaveBeenCalled();
    });
  }
  it('DOWNLOAD 项目删公告 → 维持级联复位（回归）', async () => { /* 既有行为：stageReset 分支照走，断言 bidOpeningSession.deleteMany 被调（若既有用例已覆盖则此例只保绿，报告说明） */ });
  it('ARCHIVED 项目删公告 → 可删且不级联（回归）', async () => { /* 断言 announcement.delete 被调、deleteMany 零调用 */ });
  it('无关联项目删公告 → 可删', async () => { /* relatedProjectCode null → 删除照旧 */ });
});
```

- [ ] **Step 2: RED**（新 describe 三阶段用例红）
- [ ] **Step 3: 实现**（remove() 内 `if (project)` 块：先 `const blocked = ['SUBMIT','OPENING','EVALUATING'].includes(project.stage)`，blocked → `throw new ConflictException({ error: '该项目已进入投标/开标/评标流程，公告不可删除——请先完成流标或归档后再删除公告', code: 'BID_IN_PROGRESS' })`；置于现有 `$transaction` 之前；stageReset 判定保持不变）
- [ ] **Step 4: GREEN + 回归** `pnpm --filter api test -- announcement` 全绿 + `pnpm --filter api test` 全量一次
- [ ] **Step 5: Commit** `feat(announcement): 进行中项目公告删除禁令（SUBMIT+ → 409 BID_IN_PROGRESS，零副作用引导）`

### Task 2: 文档 + 验收

- [ ] **Step 1: CLAUDE.md（Bash）**：§Announcement 段或运维段追加一句「公告删除规则：关联项目进入 SUBMIT 及以后（SUBMIT/OPENING/EVALUATING）→ 409 `BID_IN_PROGRESS`，须先流标/归档（P0-4，办法第49条不得损毁）；DOWNLOAD 可删并级联复位、ARCHIVED 仅解关联。」
- [ ] **Step 2: 冒烟**（dev 库 API 或 worktree :4002）：取/建一个 SUBMIT 项目删其公告 → 409；对 DOWNLOAD 公告 → 200 且级联复位；报告贴证据（若 dev 库无合适 SUBMIT 项目，用既有演示项目或标注跳过）。
- [ ] **Step 3: spec 状态**：已实施（已写）确认。
- [ ] **Step 4: Commit** `docs: P0-4 公告删除规则文档`

---

## Self-Review 记录

1. **Spec 覆盖**：§2 闸门→T1；§3 测试→T1；§4 文档→T2；§5 验收→T2。无缺口。
2. **占位符**：无 TBD；回归用例允许「若既有覆盖则保绿」注明。
3. **一致性**：`BID_IN_PROGRESS` 码与文案三处一致；闸门位置（事务前）在 Step 3 明示。
