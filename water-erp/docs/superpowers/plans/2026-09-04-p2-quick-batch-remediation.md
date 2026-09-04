# P2 快批（审查遗留修复）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地《P1 全量代码审查报告》遗留的 8 簇中的 6 簇 18 个小项（A 清除语义 / B A-152 边角 / C A-105 健壮性 / D 测试补强 / G 一致性 / H1-H3 UI 小项 + E2 category 白名单），使 P1 整改代码达到「零已知遗留」状态。

**Architecture:** 全部为窄改：DTO 放行 null（`@ValidateIf` 模式）、service 条件展开 null-aware、marker 调序、三写事务化、纯前端小项。**零 schema 迁移、零 API 破坏**（对外错误码字面量一律不变）。E1（e2e 套件专项）、H4/H5（色板令牌+375px 回归）、F（巨型 service 拆分）**不在本批**——独立排期。

**Tech Stack:** NestJS 11 + class-validator / Next.js 16（:3005 web、:3006 expert-portal、:3004 supplier-portal、:3007 bid-portal）。

**Spec:** `docs/P1审查问题修复方案-2026-09-04.md`（每项的完整 rationale/影响面/风险在该 spec；冲突时以 spec 为准）。行号锚点取自 a274d1be..22b0e6ff（其后仅文档提交，无代码漂移）。

**范围外（本计划一概不碰）：** E1 bid.e2e 套件 19 红专项；E3 并行会话 WIP 7 红（流程项）；H4 阶段色板令牌化 + H5 375px 走查（含浏览器回归，独立批）；F 巨型 service 四步拆分（独立重构波）。

## Global Constraints

- **API 兼容铁律**：所有对外错误码字面量不变（G1 只做内部常量收口）；DTO 新增 null 入参为增强语义，既有调用方行为不变。
- **whitelist 剥落**：DTO 每字段必有装饰器；null 语义用 `@ValidateIf((o, v) => v !== null)` 模式（null 跳过校验、非 null 走原校验）。
- **监督日志 riskFlag** 统一 `'高风险'`/`'无'`；新代码 `.catch` 一律 `logger?.warn?.`（不再引入静默吞）。
- **并行会话**：工作区常驻对方 WIP——只 add 明确文件、禁 `git add -A`、不 push。
- **验证命令**：`pnpm --filter api test -- <spec>` + `pnpm --filter api lint`；前端 `pnpm --filter <app> exec tsc --noEmit`。
- **提交纪律**：每任务一提交；前缀 `fix(p2-quick):`（新能力语义用 `feat(p2-quick):`）+ 末行 `Co-Authored-By: Claude Code <noreply@anthropic.com>`。
- TDD：凡有 spec 的任务先红后绿；测试断言钉生产形状。

---

### Task 1: A 簇后端——档案/分工字段 null 清除语义

**Files:**
- Modify: `apps/api/src/expert/dto/expert-admin-misc.dto.ts:38-41`（UpdateExpertProfileDto 两字段）
- Modify: `apps/api/src/bid/dto/committee-assignment.dto.ts`（CommitteeAssignmentItemDto 两字段）
- Modify: `apps/api/src/expert/expert-admin.service.ts:996`（分工 service 白名单守卫放行 null）、`:1007`（data 展开 null-aware）
- Test: `apps/api/src/expert/expert-admin.service.spec.ts`（+4 用例）

**Interfaces:**
- Produces: 档案/分工两对字段支持「显式 null=清除、undefined=不动」；`{ regionCode: null }` PUT 落库 NULL。T2 前端消费。

- [ ] **Step 1: TDD 四用例先红**（`expert-admin.service.spec.ts` 对应 describe 内，mock 风格随现场）：

```ts
it('A1：regionCode 传 null → update data 含 regionCode: null（清除）', async () => {
  await service.updateProfile('u1', { regionCode: null } as any);
  expect(prisma.expertProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({
    update: expect.objectContaining({ regionCode: null }),
  }));
});
it('A1：regionCode 缺省（undefined）→ data 不含键（不动）', async () => {
  await service.updateProfile('u1', { title: '高工' } as any);
  const update = prisma.expertProfile.upsert.mock.calls[0][0].update;
  expect(update).not.toHaveProperty('regionCode');
});
it('A2：分工传 null → update data 含 reviewGroup: null；白名单守卫放行 null', async () => {
  prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1', expertRole: '正选' }]);
  await service.setCommitteeAssignment('p1', { assignments: [{ userId: 'u1', reviewGroup: null }] } as any);
  expect(prisma.bidExpert.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ reviewGroup: null }),
  }));
});
it('A2：分工非法值仍 400（null 不在拒绝面）', async () => {
  prisma.bidExpert.findMany.mockResolvedValue([{ userId: 'u1', expertRole: '正选' }]);
  await expect(service.setCommitteeAssignment('p1', { assignments: [{ userId: 'u1', reviewGroup: 'A组' }] } as any))
    .rejects.toMatchObject({ response: { code: 'INVALID_COMMITTEE_VALUE' } });
});
```

跑 `pnpm --filter api test -- expert-admin.service` 确认红（第 1/3 例：现 null 被 `??`/条件挡）。

- [ ] **Step 2: DTO 两文件放行 null**：

`expert-admin-misc.dto.ts`（:38/:41 两字段整体替换）：

```ts
  /** A-129 行政区域代码；null=清除（显式置空），undefined=不动 */
  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @IsString() @MaxLength(6) @Matches(/^\d{6}$/, { message: 'regionCode 须为 6 位行政区划代码' })
  regionCode?: string | null;

  /** A-129 库内等级；null=清除 */
  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @IsIn(['A', 'B', 'C', 'D', 'E'])
  expertLevel?: 'A' | 'B' | 'C' | 'D' | 'E' | null;
```

`committee-assignment.dto.ts` 两字段同款（`@IsIn` 原值集不变 + `| null` + `@ValidateIf`），注释「null=清除」。

- [ ] **Step 3: service 两处**：
  - `expert-admin.service.ts` 档案 upsert 的 update 分支（:389-390）——**不改**（`dto.regionCode !== undefined && { regionCode: dto.regionCode }` 已天然 null-aware：null 时 `!== undefined` 成立、写 NULL）；create 分支 `regionCode: dto.regionCode` 同样兼容。核对即可。
  - `:1007` 分工 data：`{ reviewGroup: a.reviewGroup ?? undefined, dutyRole: a.dutyRole ?? undefined }` → `{ reviewGroup: a.reviewGroup === undefined ? undefined : a.reviewGroup, dutyRole: a.dutyRole === undefined ? undefined : a.dutyRole }`。
  - `:996` 守卫：白名单判断处对 null 放行（`if (v !== null && v !== undefined && !ALLOWED.includes(v)) throw`——以现场守卫写法融入，保持原错误码/文案）。

- [ ] **Step 4: 跑绿 + lint** → 提交：

```bash
git add apps/api/src/expert/dto/expert-admin-misc.dto.ts apps/api/src/bid/dto/committee-assignment.dto.ts apps/api/src/expert/expert-admin.service.ts apps/api/src/expert/expert-admin.service.spec.ts
git commit -m "feat(p2-quick): A 簇后端——档案区域/等级与评委分工支持 null 显式清除（DTO @ValidateIf 放行 + 分工守卫/展开 null-aware），undefined=不动语义不变"
```

---

### Task 2: A 簇前端——:3005 清除交互

**Files:**
- Modify: `apps/web/src/app/(main)/expert/[id]/page.tsx`（编辑表单提交组装：regionCode/expertLevel 空→null）
- Modify: `apps/web/src/app/(main)/expert/extract/page.tsx`（步骤5 两 select 增「清除」选项 + 提示行文案）

**Interfaces:**
- Consumes: Task 1 null 语义。

- [ ] **Step 1: 档案编辑表单**——提交组装处两字段改为 `regionCode: form.regionCode.trim() || null` / `expertLevel: form.expertLevel || null`（原 `|| undefined`）；label 旁加小字「清空保存即清除」。
- [ ] **Step 2: 步骤5 分工 select**——两 select 增 option `value="__CLEAR__"` label「清除」（置于「不设置」后）；提交组装映射 `__CLEAR__ → null`、空串 → 不含键；表下提示行文案改：「『不设置』＝本次不提交该项（保留现值）；『清除』＝置空已保存分工」。
- [ ] **Step 3: 验证**：`pnpm --filter web exec tsc --noEmit` exit 0 → 提交：

```bash
git add "apps/web/src/app/(main)/expert/[id]/page.tsx" "apps/web/src/app/(main)/expert/extract/page.tsx"
git commit -m "feat(p2-quick): A 簇前端——档案编辑空值改提交 null（清空即清除）+ 步骤5 分工增「清除」选项与文案双语义"
```

---

### Task 3: B1——bindCert CN 名源集合匹配

**Files:**
- Modify: `apps/api/src/expert/expert.service.ts:2452-2458`
- Modify: `apps/expert-portal/src/components/evaluate/report-step.tsx`（创建证书 label 改主名源）
- Test: `apps/api/src/expert/expert.service.spec.ts`（+3 用例）

**Interfaces:**
- Produces: CN 校验集合 = `[displayName||username, ...该 userId 的 BidExpert.expertName 去重别名(take 20)]` 归一匹配任一即过。

- [ ] **Step 1: TDD 三用例先红**（bindCert describe 内）：displayName 匹配 ✓（既有）；displayName 不匹配但 bidExpert 别名匹配 → 通过且事务执行；两者皆不匹配 → 400 `CERT_DN_MISMATCH`（mock `bidExpert.findMany` 分别返回别名行/空数组）。
- [ ] **Step 2: 实现**（:2454 起替换校验块，spec 有完整代码——`docs/P1审查问题修复方案-2026-09-04.md` B1 节 verbatim）：

```ts
const expertName = user?.displayName || user?.username || '';
// B1：名源集合——displayName/username + 历史评委名（历史证书不因改名作废）
const aliasNames = await this.prisma.bidExpert.findMany({
  where: { userId }, select: { expertName: true }, distinct: ['expertName'], take: 20,
}).then(rows => rows.map(r => r.expertName)).catch(() => [] as string[]);
const cn = extractDnCn(certDn);
const norm = normalizeExpertCn;
const matched = !!cn && [expertName, ...aliasNames].some(n => n && norm(cn) === norm(n));
if (!matched) throw new BadRequestException({ error: '证书主体(CN)与专家姓名不一致', code: 'CERT_DN_MISMATCH' });
```

- [ ] **Step 3: 前端 label 对齐**——report-step 创建证书的 `createCertificate(label)` 参数改用 `myExpertRecord.userDisplayName || expertName`（以现场 props/字段名为准，grep `createCertificate` 定位；若无 userDisplayName 可用则保持 expertName 并在注释说明后端别名兜底已覆盖）。
- [ ] **Step 4: 绿+lint+expert-portal tsc** → 提交：

```bash
git add apps/api/src/expert/expert.service.ts apps/api/src/expert/expert.service.spec.ts apps/expert-portal/src/components/evaluate/report-step.tsx
git commit -m "fix(p2-quick): B1 bindCert CN 名源集合匹配——displayName/username + 历史 BidExpert.expertName 别名任一归一命中（历史证书不因改名作废），门户创建 label 对齐主名源"
```

---

### Task 4: B2+B3——专家门户签署流态固化与 toast 映射

**Files:**
- Modify: `apps/expert-portal/src/components/evaluate/report-step.tsx`（创建/签名两段拆分 + 错误映射表）

**Interfaces:**
- Consumes: T12（波4）既有 doEsignWith/ExpPinDialog 结构。

- [ ] **Step 1: 态固化**——`createAndBind(pin)` 成功后 `setEsign(prev => ({ ...prev, state: 'ready', hasCert: true }))` 再续跑签名；签名/提交失败路径**不得**把 state 回落 need-cert（现失败后停留 need-cert 导致重试换证 churn）。重试入口 = ready 态「电子签署」直路复用已绑证书。
- [ ] **Step 2: toast 映射表补两行**：

```ts
SM2_PUBLIC_KEY_INVALID: '证书公钥格式无效，请重新创建证书',
CERT_SN_EXISTS: '该证书序列号已被绑定，请勿重复绑定（或先在 U盾管理解绑）',
```

- [ ] **Step 3: 验证**：`pnpm --filter expert-portal exec tsc --noEmit`；手动路径说明写 report（创建→签名失败→按钮应保持「电子签署」）。提交：

```bash
git add apps/expert-portal/src/components/evaluate/report-step.tsx
git commit -m "fix(p2-quick): B2+B3 签署流 bind 成功即固化 ready 态（杜绝重试换证 churn）+ 补 SM2_PUBLIC_KEY_INVALID/CERT_SN_EXISTS toast 文案"
```

---

### Task 5: C1+D1——定标钩子 marker 调序（含 pending=0 用例）

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:5950-5975`
- Test: `apps/api/src/bid/bid.service.spec.ts`（+2 用例 + 既有联动用例断言翻转）

**Interfaces:**
- 语义：`sendToRole` 成功 → 才 upsert marker；失败 → 不占坑 + `logger?.warn?.`（日调度 `bond_return_reminded:*` 第二通道既有兜底不动）。

- [ ] **Step 1: TDD**——新增「pending=0 → 不 sendToRole 不写 marker」（两 mock 零调用断言）；既有「联动 sendToRole+marker」用例改为「marker 在 sendToRole resolve 后写入」（断言顺序或 sendToRole mock resolve 后 marker upsert 被调）；新增「sendToRole reject → marker 未写入 + warn」。先红。
- [ ] **Step 2: 实现**（块内调序，spec B/C1 节 verbatim）：

```ts
if (pending.length > 0) {
  const names = pending.slice(0, 5).map(s => s.supplierName).join('、');
  try {
    await this.notificationService.sendToRole('staff', {
      type: 'SYSTEM',
      title: '响应担保待逐家退还提醒',
      content: `${project.name}已发出中标通知书，尚有 ${pending.length} 家未中标供应商的响应担保未登记退还（实施条例第57条：合同签订后5日内退还）：${names}${pending.length > 5 ? '…' : ''}。请在项目管理-合同面板逐家登记退还。`,
    });
    await this.prisma.systemConfig.upsert({
      where: { key: markerKey },
      update: { value: new Date().toISOString() },
      create: { key: markerKey, value: new Date().toISOString() },
    });
  } catch (e) {
    this.logger?.warn?.(`A-105 定标提醒发送失败 project=${projectId}: ${String(e)}`);
  }
}
```

（`findUnique` 短路幂等保留在外层不变；`logger` 以该 service 现有 logger 字段为准——若无则 `console.warn` 并 report 说明。）
- [ ] **Step 3: 绿+lint** → 提交：

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(p2-quick): C1+D1 定标提醒发送成功才写 marker（失败 warn 不占坑，日调度兜底）+ pending=0 无副作用用例"
```

---

### Task 6: C2——逐家退还三写事务化

**Files:**
- Modify: `apps/api/src/bid/bid.service.ts:5788-5830`（markSupplierBondReturned）
- Test: `apps/api/src/bid/bid.service.spec.ts`（既有三写用例改造）

**Interfaces:**
- Produces: 三写（bidSupplier.update / bidOpeningRecord.updateMany / bidSupervisionLog.create）单事务；返回 `{ success: true }` 不变（:3005 只消费 success——已核实）。

- [ ] **Step 1: 用例改造先红**——既有「退还三写断言」用例的 mock 从裸 prisma 断言改为事务直通（`$transaction: cb => cb(prisma)` 惯例下断言不变即绿；若该用例断言裸调用顺序则改为断 tx 调用）。
- [ ] **Step 2: 实现**（spec C2 节 verbatim——`$transaction(async tx => { ...三写... })`，监督日志 `.catch(() => {})` **改** `.catch(e => this.logger?.warn?.(...))` 随 G 簇口径；成功路径返回 `{ success: true }`）。
- [ ] **Step 3: 绿+lint** → 提交：

```bash
git add apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "fix(p2-quick): C2 逐家退还三写事务化（bidSupplier+开标记录+监督日志原子）+ 监督日志 catch 改 warn 留痕"
```

---

### Task 7: D2+D3——测试补强与精度

**Files:**
- Test: `apps/api/src/scheduler/scheduler.service.spec.ts`（+1 名单拼装断言）
- Test: `apps/api/src/expert/expert-admin.service.spec.ts`（A 簇「未填不过滤」用例②改 `not.toHaveProperty`）
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts` + `bid.service.ts` + `bid.service.spec.ts`（A-89 文案常量化）

**Interfaces:**
- Produces: `export const BID_FILE_MUST_BE_PDF_MSG = '投标文件（${role}）必须为 PDF 版式文件（版式转换口径）——请转换后重新加密上传'`——service 与 spec 共用（两处字面量改模板引用；前端 toast 文案不动）。

- [ ] **Step 1: 调度名单断言**——`remindBondReturns` 用例补：两项目各 3 未退家 → 提醒 content 含去重后 slice(0,5) 名单与「…」边界（构造 6+ 家触发省略号分支）。
- [ ] **Step 2: 精度两处**——`expect(where).not.toHaveProperty('regionCode')`；A-89 用例 `toBe(BID_FILE_MUST_BE_PDF_MSG.replace('${role}','technical'))` 全字。
- [ ] **Step 3: 绿+lint** → 提交：

```bash
git add apps/api/src/scheduler/scheduler.service.spec.ts apps/api/src/expert/expert-admin.service.spec.ts apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/bid/bid.service.ts apps/api/src/bid/bid.service.spec.ts
git commit -m "test(p2-quick): D2+D3 调度名单拼装断言 + 未填断键改 not.toHaveProperty + A-89 文案常量化全字断言"
```

---

### Task 8: G1+G2+G3——一致性三小项

**Files:**
- Create: `apps/api/src/common/error-codes.ts`
- Modify: `apps/api/src/expert/expert.service.ts` / `apps/api/src/supplier-portal/supplier-portal.service.ts`（公钥错误码改引常量）
- Modify: 监督日志静默位 5 处 `.catch(() => {})` → warn（grep `bidSupervisionLog.create` 全库新代码位：A-105 钩子域/台账登记/报告附注/分工设置/逐家——以 grep 结果为准逐处）
- Modify: `apps/api/src/bid/dto/report-notes.dto.ts`（删 `@ArrayMinSize(0)` 与对应 import）

**Interfaces:**
- Produces: `export const ERR_PUBLIC_KEY_INVALID = 'SM2_PUBLIC_KEY_INVALID';`（对外字面量以专家侧为基准；供应商侧 service throw 处改引常量，**其响应码字面量若与常量不同则保留原字面量并加常量别名注释**——先 grep 供应商侧实际字面量再定，report 说明）。

- [ ] **Step 1: 常量文件 + 两处引用**；**Step 2: 5 处 warn**（模式 `e => this.logger?.warn?.('监督日志写入失败(action=xxx): ' + String(e))`）；**Step 3: 删无操作装饰器**；**Step 4: 全量相关 spec 绿 + lint** → 提交：

```bash
git add apps/api/src/common/error-codes.ts apps/api/src/expert/expert.service.ts apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/bid/dto/report-notes.dto.ts <grep 出的其余 5 处文件>
git commit -m "chore(p2-quick): G 簇——公钥错误码常量单一来源 + 监督日志 catch 统一 warn 留痕 + 删 @ArrayMinSize(0) 无操作装饰器"
```

---

### Task 9: H1+H2+H3——UI 三小项

**Files:**
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/page.tsx:220-226`（loadTenderReq 错误态）+ `:567` 区（空态文案分支）
- Modify: `apps/bid-portal/src/components/workspace/signing-tab.tsx:248`（附注按钮 busy）
- Modify: `apps/web/src/components/contracts/contract-stage-modal.tsx`（BondReturnBlock 重试钮 busy）

**Interfaces:**
- H1: `trError` state——catch 置 true / 成功置 false；空态文案 `trError ? '获取失败，请点击重新获取重试' : '解析中或尚未生成——可先下载招标文件查阅原文'`。
- H2: 附注按钮 `disabled={busy || generating}`（与生成/重新生成按钮同源变量——以现场变量名为准）。
- H3: 重试钮 `disabled={busy}`。

- [ ] **Step 1-3: 三处小改** → 各自 app `exec tsc --noEmit` exit 0 → 提交：

```bash
git add "apps/supplier-portal-next/src/app/(main)/bids/[id]/page.tsx" apps/bid-portal/src/components/workspace/signing-tab.tsx apps/web/src/components/contracts/contract-stage-modal.tsx
git commit -m "fix(p2-quick): H1-H3 要点卡错误态与解析空态分离 + 附注按钮随生成 busy 禁用 + 合同弹窗重试钮 busy 禁用"
```

---

### Task 10: E2——METADATA_SCHEMA 白名单补 category（死分支复活）

**Files:**
- Modify: `apps/api/src/announcement/announcement.service.ts`（METADATA_SCHEMA 定义处 + `:650` 分支 + `:703-706` rawCategory 注释更新）
- Test: `apps/api/src/announcement/announcement.service.spec.ts`（+2 用例）

**Interfaces:**
- Produces: `category: ['failed_bid', 'publicity']` 枚举白名单键；`:650` 分支读 `meta.category`（rawCategory 双读保留一轮，注释注明下清理批移除）。

- [ ] **Step 1: TDD 两用例先红**——白名单化后 `category=failed_bid` 公告 → `:650` 分支可达（syncBidProject 置 ABORTED 路径断言）；`category='hacker'` 非法值 → validateMetadata 剥落（meta.category undefined）。
- [ ] **Step 2: 实现**——METADATA_SCHEMA 增枚举键（以现场 schema 结构为准：值为允许值数组或 boolean 透传标记——若现 schema 是 `key: true` 透传风格则加校验函数；report 说明所选形态）；`:650` 改 `meta.category === 'failed_bid'`（原样，因白名单化后 meta.category 可达）；`:705` rawCategory 行注释改「过渡双读：白名单化前的存量数据兜底，下清理批移除」。
- [ ] **Step 3: 绿+lint** → 提交：

```bash
git add apps/api/src/announcement/announcement.service.ts apps/api/src/announcement/announcement.service.spec.ts
git commit -m "fix(p2-quick): E2 METADATA_SCHEMA 白名单补 category 枚举——failed_bid 死分支复活（双读过渡一轮）"
```

---

### Task 11: 收尾——全量验证

- [ ] `pnpm --filter api test`（相关套件全绿；全量套件中 project-management 7 败=并行 WIP 预存，不计）
- [ ] `pnpm --filter api lint` 0 error + `pnpm --filter api build` 成功
- [ ] 四前端 `exec tsc --noEmit` 全 0
- [ ] 浏览器抽验（控制者）：①:3005 档案编辑清空区域保存→详情页回 '—'/重新打开表单为空；②步骤5 分工「清除」→报告名单列回 '—'；③专家门户创建证书→（可模拟签名失败）→按钮保持「电子签署」；④要点卡断 api（devtools offline 或改 URL）→「获取失败」文案
- [ ] 无审计注记任务（本批非检测项整改；spec 文档不回写）

## 验收清单

1. Task 1-10 全部「实现→评审→通过」；2. 上四项验证命令；3. 浏览器抽验四点。

## 任务间依赖

T1→T2（null 语义前端消费）；T3/T4 独立（B 簇后/前）；T5/T6 同文件 bid.service.ts + spec 串行；T7 依赖 T1（精度改造其用例）与 T5/T6（同 spec 文件）→ 严格串行按序；T8/T9/T10 独立。执行顺序 1→11 严格串行（T5/T6/T7 共享 spec 文件防互踩）。

## 风险与回归点

- T1 null 语义：确认无既有调用方传 null（grep 前端组装——A 簇原实现空值全 undefined）；T2 后浏览器验收覆盖清除往返。
- T3 别名查询进 bindCert 事务前只读——不进事务，失败 catch 空数组（保守退回单名校验）。
- T5 通知书重推场景：pending 变化重发提醒符合语义（spec 已论证）。
- T10 白名单扩列：validateMetadata 单测全覆盖现键集，新增键只增不剥。
