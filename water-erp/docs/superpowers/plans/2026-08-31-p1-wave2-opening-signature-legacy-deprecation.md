# P1 波2（签名批）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地审计 §P1 波2 三件：A-114 开标记录确认 SM2 电子签名（schema 迁移+后端签名通道+双端前端+e2e）、A-90 方案 a（投递页旧轨 UI 退役为绑盾引导，API/flag 原样保留）、种子绑盾脚本（演示可用性）。

**Architecture:** A-114 完全复用已三次验收的签名范式（canonical → U盾签名 → SM2 验签 → Json 归档），单端点双语义（确认+补签）；A-90 只动前端分支不动 API；种子脚本读盾槽文件直写 SupplierCert+sm2PublicKey。

**Tech Stack:** NestJS 11 + Prisma 迁移 / @water-erp/ukey canonicalJson / sm-crypto（e2e 内签名）/ Next.js 16（:3004 sp-*、:3007 cgzxui）。

**Spec:** `docs/superpowers/specs/2026-08-31-p1-wave2-opening-confirm-signature-legacy-deprecation-design.md`（冲突以 spec 为准）。

## Global Constraints

- **schema.prisma 高危共享**：改后提交前必须 `cd apps/api && npx prisma validate`；迁移走非交互三步（`migrate dev --create-only` → `prisma db execute --file` → `migrate resolve --applied`）→ `prisma generate`。共享 dev DB **永不** `migrate reset`。
- **whitelist 剥落**：新 DTO 每字段必有装饰器（`OpeningConfirmDto.signature @IsString() @MaxLength(512)`）。
- **签名语义**：canonical 只含不可变字段；验签失败 400 `OPENING_CONFIRM_SIGNATURE_INVALID`；未绑盾 400 `SM2_PUBLIC_KEY_MISSING`（两错误码均照抄回执通道文案风格）。
- **API 层旧轨不动**：`submitBid` 旧轨分支、`BID_DUAL_ENVELOPE`、CI 旧轨 e2e 一概不碰（T6 只改前端）。
- 下载/路由链接禁 `rel="noreferrer"`；新路由必须落在既有 @Roles 作用域内（新端点挂在 supplier-portal 控制器既有作用域内）。
- 提交纪律：每任务一提交、只 add 明确文件、不 push；api build 从 workspace 根 `pnpm --filter api build`。
- 每任务验证：`pnpm --filter api test -- <spec>` + `pnpm --filter api lint`；前端 `pnpm --filter <app> exec tsc --noEmit`。

---

### Task 1: Schema 迁移——BidOpeningRecord 签名归档列

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（BidOpeningRecord 模型，~line 538 `confirmedAt` 后）
- Create: `apps/api/prisma/migrations/<timestamp>_opening_confirm_signature/migration.sql`

**Interfaces:**
- Produces: `BidOpeningRecord.confirmSignature Json?`、`BidOpeningRecord.confirmSignedAt DateTime?`（Task 2/4/5 消费）。

- [ ] **Step 1: schema 编辑**——`confirmedAt DateTime?` 之后插入：

```prisma
  confirmSignature Json?      // A-114：供应商确认开标记录的 SM2/SM3 电子签名归档 {payload, signature, algorithm, verifiedAt}
  confirmSignedAt DateTime?   // A-114：签名（或补签）时间
```

- [ ] **Step 2: 校验与迁移**：
```bash
cd apps/api && npx prisma validate
npx prisma migrate dev --create-only --name opening_confirm_signature
# 生成 SQL 审阅：应恰为两列 ALTER TABLE "BidOpeningRecord" ADD COLUMN（Json?/DateTime? 均可空，无默认值）
npx prisma db execute --file prisma/migrations/<生成目录>/migration.sql
npx prisma migrate resolve --applied <生成目录名>
npx prisma generate
npx prisma migrate status   # 确认无 pending 且无 drift 告警
```
（若 migrate status 报既有刻意偏离，勿动——只确认本次迁移 applied。）

- [ ] **Step 3: 提交**：
```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/<目录>/
git commit -m "feat(p1-wave2): A-114 schema——BidOpeningRecord 增 confirmSignature(Json?)/confirmSignedAt(DateTime?)（开标确认电子签名归档列）"
```

---

### Task 2: 后端——确认签名通道（canonical util + payload 端点 + confirmOpening 改造 + 剥壳）

**Files:**
- Create: `apps/api/src/supplier-portal/opening-confirm-signature.util.ts` + 同名 `.spec.ts`
- Modify: `apps/api/src/supplier-portal/supplier-portal.service.ts`（`confirmOpening` 改造 + 新 `getOpeningConfirmPayload` + `getMyOpeningRecord` 保持完整）
- Modify: `apps/api/src/supplier-portal/supplier-portal.controller.ts`（+payload 路由；confirm 路由接 DTO）
- Create: `apps/api/src/supplier-portal/dto/opening-confirm.dto.ts`
- Modify: `apps/api/src/bid/bid.service.ts`（`getProject` openingRecords 剥壳、`listOpeningRecords` 剥壳；`buildOpeningHandoverPackage` 保留完整签名——核对即可，本任务不改它）
- Test: `apps/api/src/supplier-portal/supplier-portal.service.spec.ts`（扩展 confirmOpening 用例）

**Interfaces:**
- Consumes: `canonicalJson`（`@water-erp/ukey`，`packages/ukey/src/canonical.ts`）；`SignatureService.verify(canonical, signature, publicKey)`；`Supplier.sm2PublicKey`。
- Produces: `buildOpeningConfirmCanonical(input: OpeningConfirmCanonicalInput): string`；`GET bid-submissions/:projectId/opening-confirm-payload`；`POST bid-submissions/:projectId/opening-confirm` body `{signature}`。

- [ ] **Step 1: TDD 写 util spec**（先红）：

```ts
import { buildOpeningConfirmCanonical } from './opening-confirm-signature.util';

describe('buildOpeningConfirmCanonical（A-114）', () => {
  const base = {
    projectId: 'p1', supplierId: 's1', bidSupplierId: 'bs1', recordId: 'r1',
    supplierName: '四川水发建设有限公司',
    amount: '980.00 万元', period: '120 日历天', qualityTarget: '合格',
    bondStatus: '已缴纳', decryptResult: 'SUCCESS',
  };
  it('键排序稳定且含 purpose 与唱标快照', () => {
    const a = buildOpeningConfirmCanonical({ ...base, purpose: 'confirm' });
    const b = buildOpeningConfirmCanonical({ ...base, purpose: 'confirm' });
    expect(a).toBe(b);
    expect(a).toContain('"purpose":"confirm"');
    expect(a).toContain('"openingRecord":{');
    expect(a.indexOf('amount') < a.indexOf('bondStatus')).toBe(true); // 递归排序
  });
  it('confirm 与 resign 的 canonical 不同（防交叉使用）', () => {
    expect(buildOpeningConfirmCanonical({ ...base, purpose: 'confirm' }))
      .not.toBe(buildOpeningConfirmCanonical({ ...base, purpose: 'resign' }));
  });
});
```

- [ ] **Step 2: 实现 util**：

```ts
import { canonicalJson } from '@water-erp/ukey';

/** A-114：开标记录确认签名 canonical 输入（全部不可变字段——杜绝验证期漂移）。 */
export interface OpeningConfirmCanonicalInput {
  purpose: 'confirm' | 'resign'; // 首次确认 | 已确认记录补签
  projectId: string;
  supplierId: string;
  bidSupplierId: string | null;
  recordId: string;
  supplierName: string;
  amount: string;
  period: string;
  qualityTarget: string;
  bondStatus: string;
  decryptResult: string;
}

export function buildOpeningConfirmCanonical(input: OpeningConfirmCanonicalInput): string {
  return canonicalJson({
    v: 1,
    purpose: input.purpose,
    projectId: input.projectId,
    supplierId: input.supplierId,
    bidSupplierId: input.bidSupplierId,
    recordId: input.recordId,
    supplierName: input.supplierName,
    openingRecord: {
      amount: input.amount,
      period: input.period,
      qualityTarget: input.qualityTarget,
      bondStatus: input.bondStatus,
      decryptResult: input.decryptResult,
    },
  });
}

/** 主持端/唱标总表视图剥壳：完整签名 → 摘要（本人视图与开标文件包保留完整证据）。 */
export function stripOpeningConfirmSignature(record: { confirmSignature: unknown }) {
  const sig = record.confirmSignature as { algorithm?: string; verifiedAt?: string } | null;
  return sig ? { algorithm: sig.algorithm ?? 'SM2/SM3', verifiedAt: sig.verifiedAt ?? null } : null;
}
```

- [ ] **Step 3: DTO + 控制器**——`dto/opening-confirm.dto.ts`：

```ts
import { IsString, MaxLength } from 'class-validator';

/** A-114：开标记录确认/补签的 U盾 SM2 签名（对服务端重建 canonical 签名） */
export class OpeningConfirmDto {
  @IsString()
  @MaxLength(512)
  signature!: string;
}
```

控制器（紧邻既有 opening-confirm 路由）：

```ts
/** W-A114：取开标确认待签负载（记录待确认，或已确认未签名供补签） */
@Get('bid-submissions/:projectId/opening-confirm-payload')
async getOpeningConfirmPayload(@Request() req: any, @Param('projectId') projectId: string) {
  const supplierId = await this.getSupplierId(req.user.sub);
  return this.portalService.getOpeningConfirmPayload(supplierId, projectId);
}
```

既有 `@Post('bid-submissions/:projectId/opening-confirm')` 签名加 `@Body() dto: OpeningConfirmDto`，传 `dto.signature`。

- [ ] **Step 4: service 改造**（confirmOpening :2290 起 + 新 getOpeningConfirmPayload）。语义要点（完整替换原方法体）：
  1. 抽私有 `loadOpeningConfirmContext(supplierId, projectId)`：project（须 OPENING）+ bidSupplier（本人，decryptStatus SUCCESS）+ record（findFirst projectId+bidSupplierId）+ supplier.sm2PublicKey（缺失 400 SM2_PUBLIC_KEY_MISSING）。
  2. `getOpeningConfirmPayload`：context 可用条件 = record.confirmStatus ∈ {待供应商确认, 待确认}（purpose='confirm'）或 === '供应商已确认' 且无 confirmSignature（purpose='resign'）；其余 400 `RECORD_NOT_CONFIRMABLE`。返回 `{ payload: JSON.parse(canonical), canonical }`。
  3. `confirmOpening(supplierId, projectId, signature)`：按 purpose 分支——
     - confirm：原事务（updateMany confirmStatus/confirmedAt + bidSupplier CONFIRMED + 监督日志 action `'确认唱标信息（电子签名）'`）+ 追加写 confirmSignature/confirmSignedAt；WS `notifyOpeningConfirmed` 与 `autoHandoverIfDone` 保留。
     - resign：不进状态机；`update`（唯一键 projectId+bidSupplierId）仅写 confirmSignature/confirmSignedAt + 监督日志 `'补签开标确认电子签名'`；无 WS、无 autoHandover；幂等（已签名直接 `{ success: true, alreadySigned: true }`）。
     - 两分支验签前置：recompute canonical → `signatureService.verify` 不通过 400 `OPENING_CONFIRM_SIGNATURE_INVALID`。
  4. 归档形状 `{ payload: JSON.parse(canonical), signature, algorithm: 'SM2/SM3', verifiedAt: new Date().toISOString() }`。
- [ ] **Step 5: 剥壳接线**——`bid.service.ts`：`getProject`（include `openingRecords: true`，在 A-100 排序块附近）对 `project.openingRecords` map `confirmSignature: stripOpeningConfirmSignature(r)`；`listOpeningRecords` 同剥。`buildOpeningHandoverPackage` 核对（应含完整记录）——不改。
- [ ] **Step 6: service spec 扩展**（沿用文件既有 mock 风格；`signatureService.verify` mock）：确认路径成功（状态+签名+日志三写）/ 签名错误 400 / 未绑盾 400 / 已确认无签名补签成功且不改状态 / 补签幂等 / 记录不可确认 400。
- [ ] **Step 7: 验证 + 提交**：`pnpm --filter api test -- opening-confirm-signature supplier-portal.service` + 全量 + lint。提交：
```bash
git add apps/api/src/supplier-portal/opening-confirm-signature.util.ts apps/api/src/supplier-portal/opening-confirm-signature.util.spec.ts apps/api/src/supplier-portal/dto/opening-confirm.dto.ts apps/api/src/supplier-portal/supplier-portal.controller.ts apps/api/src/supplier-portal/supplier-portal.service.ts apps/api/src/supplier-portal/supplier-portal.service.spec.ts apps/api/src/bid/bid.service.ts
git commit -m "feat(p1-wave2): A-114 开标记录确认 SM2 电子签名通道——canonical util（purpose 防交叉）+ payload 端点 + confirmOpening 单端点双语义（确认/补签，验签前置）+ 主持端/唱标总表剥壳（本人与文件包保留完整证据）"
```

---

### Task 3: e2e——开标确认签名化改造

**Files:**
- Modify: `apps/api/test/opening-hall.e2e-spec.ts`（:436 用例改造 + 新增错签用例）

**Interfaces:**
- Consumes: `buildOpeningConfirmCanonical`（Task 2 util）；sm-crypto（api 依赖内已有，`SignatureService` 同源）；`prisma.supplier.update` 直写测试公钥。

- [ ] **Step 1: 改造确认用例**（替换 :436 附近无 body 直调）：
```ts
const { publicKey, privateKey } = require('sm-crypto').sm2.generateKeyPairHex();
await prisma.supplier.update({ where: { id: sup1Id }, data: { sm2PublicKey: publicKey } });
const payloadRes = await request(app.getHttpServer())
  .get(`/api/supplier-portal/bid-submissions/${projectId}/opening-confirm-payload`)
  .set('Cookie', sup1Cookie).set('X-Portal', 'supplier').expect(200);
const canonical: string = payloadRes.body.canonical;
const signature = require('sm-crypto').sm2.doSignature(canonical, privateKey, { hash: true, der: false });
await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${projectId}/opening-confirm`)
  .set('Cookie', sup1Cookie).set('X-Portal', 'supplier')
  .send({ signature }).expect(201);
```
（doSignature 参数须与 `SignatureService.verify` 的 doVerify 参数对齐——先读 `signature.service.ts` 的 hash/der 用法再定，不一致会导致验签失败；预期 WS `opening:confirmed` 断言保持。）
- [ ] **Step 2: 新增用例**「签名错误 → 400 OPENING_CONFIRM_SIGNATURE_INVALID」（对同 canonical 用错误私钥签名）。
- [ ] **Step 3: 跑 e2e**：`pnpm --filter api test:e2e -- opening-hall`（注意本套依赖 DB 种子态，若环境红先核是否 pre-existing）。
- [ ] **Step 4: 提交**：
```bash
git add apps/api/test/opening-hall.e2e-spec.ts
git commit -m "test(p1-wave2): A-114 e2e——开标确认签名化（测试内 sm-crypto 密钥对+canonical 签名）+ 错签 400 用例"
```

---

### Task 4: 供应商前端——开标确认签名流

**Files:**
- Modify: `apps/supplier-portal-next/src/app/(main)/my-bids/[projectId]/opening-hall/page.tsx`
- Modify: `apps/supplier-portal-next/src/lib/api/supplier.ts`（confirmOpening 加 signature 参数 + 新 getOpeningConfirmPayload 封装）

**Interfaces:**
- Consumes: Task 2 两端点；`openUkey`（`@/utils/ukey-factory`）/`UKeyAdapter`；certSn 双兜底（localStorage `supplier_ukey_bound.certSn` → 服务端 ACTIVE SupplierCert）——**全部照抄 `bids/[id]/clarifications/page.tsx` 与 `bids/[id]/page.tsx`（A-101 回执卡）既有实现**。
- Produces: 确认按钮 = PIN 弹窗签名流；已签名态展示；已确认未签名 = 补签按钮。

- [ ] **Step 1: API 封装**——`supplier.ts`：`getOpeningConfirmPayload(projectId)` GET；`confirmOpening(projectId, signature)` POST body `{signature}`。
- [ ] **Step 2: 页面改造**——`confirmRecord()`（:131 起）的 `window.confirm` 替换为 SpDialog 流（该页或邻近页既有 SpDialog 引入方式；无则从 `@/components/ui` 引）：
  1. 弹窗文案：说明即将对本开标记录（唱标信息快照）做 U盾电子签名，含 PIN 输入框与「取消/解锁并签名」。
  2. 提交：`getOpeningConfirmPayload` → `openUkey(pin)` → certSn 双兜底 → `adapter.sign(certSn, canonical)` → `confirmOpening(projectId, signature)` → toast「已确认开标记录（已电子签名）」+ refresh。
  3. 错误码映射（照抄回执卡）：SM2_PUBLIC_KEY_MISSING→「请先在 U盾管理页绑定数字证书」；OPENING_CONFIRM_SIGNATURE_INVALID→「签名验证失败，请重试」；403/400 由全局层 toast。
  4. 唱标记录卡展示：`record.confirmSignature` 存在 → 徽标「已电子签名（SM2/SM3 · {verifiedAt}）」；`confirmStatus==='供应商已确认' && !confirmSignature` → 次级按钮「补签确认（U盾）」走同一弹窗（服务端自动按 resign 语义处理）。
- [ ] **Step 3: 验证 + 提交**：`pnpm --filter supplier-portal-next exec tsc --noEmit`。提交：
```bash
git add "apps/supplier-portal-next/src/app/(main)/my-bids/[projectId]/opening-hall/page.tsx" apps/supplier-portal-next/src/lib/api/supplier.ts
git commit -m "feat(p1-wave2): A-114 供应商端开标确认签名流——PIN 弹窗替代原生 confirm、canonical U盾签名提交、已签徽标与已确认未签补签入口"
```

---

### Task 5: 主持端——确认列签名徽标

**Files:**
- Modify: `apps/bid-portal/src/components/opening-hall.tsx`（确认列，~:862 CONFIRMED 徽标处）

**Interfaces:**
- Consumes: Task 2 剥壳后的 `confirmSignature: {algorithm, verifiedAt} | null`（getProject/listOpeningRecords 载荷内已就位）。

- [ ] **Step 1:** CONFIRMED 行的确认徽标旁加小徽标：`record.confirmSignature ? '已电子签名' : '未签名'`（样式随 :253 同款 StatusBadge/cls 风格，未签名用中性灰）。数据来源确认：大厅表格行的 record 字段路径（行内 openingRecord 或独立 records 数组，以组件实际为准）。
- [ ] **Step 2: 验证 + 提交**：`pnpm --filter bid-portal exec tsc --noEmit`。提交：
```bash
git add apps/bid-portal/src/components/opening-hall.tsx
git commit -m "feat(p1-wave2): A-114 :3007 开标大厅确认列签名徽标（已电子签名/未签名，数据源=剥壳摘要）"
```

---

### Task 6: A-90 方案 a——投递页旧轨 UI 退役为绑盾引导

**Files:**
- Modify: `apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx`

**Interfaces:**
- Consumes: `profile.sm2PublicKey` → `dualReady`（:211-212 既有）；U盾管理页路由 `/profile/ukey`。
- 约束：**只改 `!dualReady` 的 UI 分支**；`dualReady=true` 分支、内部 `dualReady ?:` 三元（:336/:367/:384/:433/:735 等加密与提交逻辑）一概不动（API 对齐保留）。

- [ ] **Step 1:** `canSubmit && !dualReady` 区块（:801 起的旧轨上传/投递 UI）整体替换为「绑盾引导卡」：
  - 标题「投标须使用 U盾数字证书」；正文：双信封加密投递（双层 SM4 + SM2 证书签名 + 开标解密）为唯一投递通道，传统加密通道已停止受理；
  - 主按钮「前往绑定 U盾」→ `router.push('/profile/ukey')`；次级说明：绑定后本页自动切换为双信封投递。
  - 卡片样式沿用该页既有卡片类；卡内不渲染旧轨上传区/递交按钮。
- [ ] **Step 2:** checklist :698 `未绑定（传统加密投递）` → `未绑定（请先绑定 U盾）`；页面头部若有「传统加密」字样同步。
- [ ] **Step 3: 验证 + 提交**：`pnpm --filter supplier-portal-next exec tsc --noEmit`。提交：
```bash
git add "apps/supplier-portal-next/src/app/(main)/bids/[id]/submit/page.tsx"
git commit -m "feat(p1-wave2): A-90 方案a 投递页旧轨 UI 退役——未绑盾仅显示绑盾引导卡（双信封为唯一交互投递通道），API/应急 flag 原样保留"
```

---

### Task 7: 种子绑盾脚本 + 文档收尾

**Files:**
- Create: `apps/api/scripts/bind-ukey-slots.ts`
- Modify: `water-erp/ACCOUNTS.md`（盾-供应商对应与用法）
- Modify: `docs/附录A功能检测对照报告-投标开标评标-2026-08-28.md`（A-90/A-114 行注记 + 勘误头波2 行——参照波1 注记格式）

**Interfaces:**
- Consumes: 盾槽文件格式（读 `services/ukey-middleware/src/shield.mjs` 确定：槽文件如何存 CN/公钥/证书序列号——解析方式以该文件真实结构为准）；`UKEY_SLOT_DIR` 环境变量（默认 `~/.shuidi-ukey/slots`）。
- Produces: `npx tsx scripts/bind-ukey-slots.ts [--dry-run]`（apps/api 下运行）。

- [ ] **Step 1: 脚本**（PrismaClient 直连；幂等）：
  - 扫描槽目录 `*.ukey`，解析 {shieldId(=certSn), cn, publicKey}；
  - `supplier.findUnique({ where: { name: cn } })` 精确匹配；未匹配 → 打印告警跳过；
  - 匹配 → `supplierCert.upsert({ where: { certSn }, create: { supplierId, certSn, certDn: \`CN=${cn}\`, publicKey, alg: 'SM2' }, update: { publicKey, bindingStatus: 'ACTIVE', revokedAt: null } })` + `supplier.update({ data: { sm2PublicKey: publicKey } })`；
  - 输出绑定清单表（盾号/CN/供应商/动作）；`--dry-run` 只打印不写。
- [ ] **Step 2: ACCOUNTS.md** 追加「U盾演示绑定」小节：发盾命令（`node services/ukey-middleware/src/cli.mjs issue --cn <企业名> --pin 123456`）+ 绑定命令 + 当前盾-供应商对应表（验收时实际发盾后回填）。
- [ ] **Step 3: 审计报告注记**：A-90 行补「✅ 已整改（2026-08-31 波2，UI 退役/方案 a，提交号）」；A-114 行补「✅ 已整改（2026-08-31 波2，提交号；交换部分仍待公共服务平台对接专项）」；§一 勘误头追加波2 一行。
- [ ] **Step 4: 提交**：
```bash
git add apps/api/scripts/bind-ukey-slots.ts water-erp/ACCOUNTS.md "water-erp/docs/附录A功能检测对照报告-投标开标评标-2026-08-28.md"
git commit -m "feat(p1-wave2): 种子绑盾脚本 bind-ukey-slots（槽位 CN 匹配幂等绑定 SupplierCert+sm2PublicKey）+ ACCOUNTS.md 用法 + 审计报告 A-90/A-114 注记"
```

---

## 验收清单（全部任务完成后）

1. `pnpm --filter api test` 全量绿（新增 util spec + service spec 用例）+ `pnpm --filter api lint` 0 error + `pnpm --filter api build` 成功；`opening-hall` e2e 绿。
2. supplier-portal-next / bid-portal `exec tsc --noEmit` 均 exit 0。
3. `npx prisma validate` + `migrate status` 干净（本次迁移 applied）。
4. 浏览器验收（控制者执行）：未绑盾供应商投递页=引导卡；种子脚本绑定后 `dualReady=true`；OPENING 项目供应商签名确认全链（真盾）→ :3007 确认列「已电子签名」徽标；已确认未签记录补签。
5. 汇总报告 + 审计注记核对。

## 任务间依赖

T1 → T2 → T3/T4/T5（并行面窄，仍串行：T3 依赖 T2 端点；T4 依赖 T2；T5 依赖 T2 剥壳）；T6 独立（可与 T2 后任意点执行，固定在 T5 后）；T7 收尾。执行顺序：1→2→3→4→5→6→7。
