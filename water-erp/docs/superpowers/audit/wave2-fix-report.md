# Wave 2 存证波修复报告

- **日期**：2026-07-25
- **分支**：feat/bid-opening-hall-impl
- **范围**：`docs/superpowers/audit/2026-07-24-iteration1-audit-fixlist.md` S2/S3/S4/S5/S6
- **方法**：TDD 先红后绿（先写失败用例 → 实现 → 转绿）

## 改动点

### S4+S5 — 消息改纯文本存储 + 空消息拒绝（`apps/api/src/opening-hall/opening-hall.service.ts`）

- **:38-45** sendMessage 头部：`dto.content.trim()` → 空则 `BadRequestException({ code: 'MESSAGE_EMPTY' })`（S5：DTO `@IsNotEmpty` 只挡空串，纯空白 `'   '` 在此拒绝；且在任何 DB 访问/广播之前）
- **:45** 码点安全截断 `[...content].slice(0, 2000).join('')`——按码点迭代，不切断 emoji 代理对（旧 `.slice(0, 2000)` 按 UTF-16 码元切）；超长主拦截仍在 DTO `@MaxLength(2000)`，此为防御纵深
- **:84** 落库 `content: clipped`；**删除 :5 的 `sanitizeHtmlContent` import**（公告 dto 仍用该 util，util 文件保留）——大厅与异议原因/澄清等文本字段口径一致：原文落库，渲染侧转义（Vue `{{ }}` / React `{}`）

### S6 — 分页输入校验 + 复合游标（`opening-hall.service.ts`）

- **:116** `limit` 健壮化：`Number.isFinite` → 非有限值（NaN/Infinity/undefined）回落 50，再夹取 [1,100]
- **:117-129** cursor 校验：解析 `<ISO>|<id>`（`indexOf('|')` 切分，兼容 id 理论含 `|`），`new Date(iso)` 非法 → `BadRequestException({ code: 'INVALID_CURSOR' })`（旧实现让 Invalid Date 进 Prisma → 500）
- **:140-144** 翻页条件改复合：`OR: [{ createdAt: { lt } }, { createdAt: { equals }, id: { lt: cursorId } }]`；旧格式游标（无 `|`）cursorId='' → `id < ''` 恒不命中 → 退化纯时间分支（向后兼容）
- **:146** `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`；**:149-150** `nextCursor = ${ISO}|${id}`

### S3 — CSV 归档补大厅消息（`apps/api/src/bid/bid.service.ts`）

- **:2051-2064** CSV 增 `=== 开标大厅消息 ===` 段（置于澄清答疑与哈希摘要之间，与 JSON sections 顺序对齐）：列 时间/类型(公聊·私聊)/供应商/发送者角色(主持人·供应商·系统)/发送者/内容；复用既有 `esc`（双引号包裹 + 内部双引号加倍 → 内容含逗号/换行/引号均合法）
- 数据源复用已查出的 `hallMessages` + `hallSupplierNames`（JSON 分支原 findMany 本就在两分支之前，未重复查询）；`:2114` JSON 分支 `hallMessages` 改引用共享的 `hallSection`

### S2 — 归档哈希链覆盖存证 sections（`bid.service.ts`）

- **:2** 新增 `import * as crypto from 'crypto'`
- **:1995-2012** `sha256Json = v => sha256(JSON.stringify(v), utf8)`（与 `bid-archive.digest.ts` 同款算法/编码）；对 `hallSection` / `project.supervisionLogs` / `project.clarifications`（与 sections 完全相同的数组引用）分别算摘要 → `sectionDigests`；`sectionsRoot = sha256Json(sectionDigests)`
- **:2125-2126** JSON `hashChain` 增 `sectionDigests` + `sectionsRoot`
- **:2072-2076** CSV 本有哈希链摘要段（创世哈希 + 逐项链），同步追加 4 行存证摘要（核对结论：CSV 以文本行形式承载 hashChain，故同步加而非不加）
- **:1995-1999 注释**信任模型：与 archiveItems 链同为"导出包内防局部篡改"；整包真伪由导出时捕获/签章环节保证（既有设计边界，未扩展）

## RED → GREEN 证据

**单测（`opening-hall.service.spec.ts`，:82-175）**

- RED：基线 19 绿 → 改用例后 `8 failed, 18 passed`（S4 原文保留 / S4 emoji 截断 / S5 空白 / S6 非法 cursor / S6 NaN limit / S6 复合 where / S6 旧游标兼容 / S6 同毫秒续取）
- GREEN：实现后 `26 passed`
- 用例要点：既有消毒用例改断言 `报价 <100> 万元 & 工期` 与 `<script>x</script>` 原样落库；`'   '` → MESSAGE_EMPTY 且 create/broadcast 零调用；`'字'×1999 + '💥'` → `[...stored].length ≤ 2000`、`/\p{Surrogate}/u` 不匹配、emoji 完整；同毫秒 mock 两页验证 m1 不被旧纯时间游标丢失

**E2E（`test/opening-hall.e2e-spec.ts`）**

- RED：归档存证用例 `hashChain.sectionDigests` = undefined（`1 failed, 19 passed`）
- GREEN：实现 S2/S3 后 `20 passed`
- 新增/改写用例：历史分页改复合游标翻页（连发 5 条 + limit=2 循环翻页：页内升序、跨页 id 不重、页间时间不晚于前页最旧、nextCursor 含 `|`、与 DB 全量条数一致）；S6 `cursor=abc` → 400 INVALID_CURSOR、`limit=abc` → 200；S4/S5 空白 400 + `报价 <100> 万元 & 工期` DB 原文；归档存证（公聊+私聊各一进 sections，node crypto 复算三个 sectionDigests 与 sectionsRoot 全等，篡改后失配，CSV 含大厅消息段及两条探针）

## 测试结果

| 命令 | 结果 |
|---|---|
| `pnpm --filter api test -- opening-hall.service.spec` | 26/26 ✅ |
| `pnpm --filter api test:e2e -- opening-hall` | 20/20 ✅ |
| `pnpm --filter api test`（全量） | 82 suites / 856 tests ✅ 无新失败 |
| `pnpm --filter api test:e2e -- bid`（回归） | 3 suites / 25 tests ✅ |
| `pnpm --filter api build` | 干净 ✅ |

## 遗留

- 归档 `hallMessages.findMany` 无分页（P2，大会内存/时延风险）——清单 P2 组，未动
- 消息模型 `type` 字段恒 TEXT、无撤回语义（§5.1）——迭代二项
- CSV 存证摘要为裸十六进制行、与 JSON 同为"包内防篡改"，整包签章/捕获仍属导出环节设计边界（S2 注释已说明）
- S8 host 角色范围、Wave 3-5 其余条目不在本波
