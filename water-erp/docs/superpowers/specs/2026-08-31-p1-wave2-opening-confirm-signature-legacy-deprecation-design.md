# P1 波2 设计：开标记录确认电子签名（A-114）+ 旧轨 UI 退役（A-90 方案 a）+ 种子绑盾

- **依据**：审计报告 §P1（A-114/A-90 行）+ 2026-08-31 会话确认的波2 方案（A-114 主件、A-90 走「UI 弃旧轨 API 留应急」、种子供应商发盾绑定）
- **范式**：完全复用已验收三次的签名通道范式（A-143 澄清答复 / A-101 投标回执）：服务端重建 canonical → 前端 U盾签名 → 服务端 SM2/SM3 验签 → Json 归档

## 一、A-114 投标人对开标记录确认的电子签名

### 1. Schema（1 个迁移）

`BidOpeningRecord` 新增：
- `confirmSignature Json?` —— 归档 `{ payload, signature, algorithm:'SM2/SM3', verifiedAt }`（与 `SupplierBidSubmission.receiptSignature` 同构）
- `confirmSignedAt DateTime?`

### 2. Canonical 负载（只含不可变字段，杜绝验证期漂移）

```
{ v:1, purpose:'confirm'|'resign', projectId, supplierId, bidSupplierId, recordId, supplierName,
  openingRecord:{ amount, period, qualityTarget, bondStatus, decryptResult } }
```
- `purpose` 区分首次确认与补签，防交叉使用
- 不含 confirmedAt/builtAt 等易变字段；`canonicalJson`（@water-erp/ukey，递归排序键）

### 3. 端点（单端点双语义）

- `GET /supplier-portal/bid-submissions/:projectId/opening-confirm-payload` → `{ payload, canonical }`；服务端以 DB 为准重建；可用条件 = 记录待确认 **或**（已确认且未签名，供补签）
- `POST /supplier-portal/bid-submissions/:projectId/opening-confirm` body `{ signature }`（**签名必填**，whitelist 注意装饰器）：
  - 门控沿用现状：OPENING 阶段 + 本人记录 + 解密 SUCCESS
  - 记录态：`['待供应商确认','待确认']` → 确认+签名；`供应商已确认 && 无签名` → **补签**（只回填签名，不改状态，幂等：已签直接返回）
  - 验签：`Supplier.sm2PublicKey`（未绑盾 400 `SM2_PUBLIC_KEY_MISSING`）；失败 400 `OPENING_CONFIRM_SIGNATURE_INVALID`
  - 事务：确认路径写 confirmStatus/confirmedAt/confirmSignature/confirmSignedAt + 监督日志「确认唱标信息（电子签名）」；补签路径只写签名 + 日志「补签开标确认电子签名」
  - WS `opening:confirmed` 与 `autoHandoverIfDone` 仅确认路径触发（补签不动）

### 4. 视图剥壳矩阵

| 视图 | confirmSignature 呈现 |
|---|---|
| `getMyOpeningRecord`（本人） | 完整（同回执本人可见） |
| `getProject` 详情 / `listOpeningRecords`（主持端、唱标总表） | 摘要 `{algorithm, verifiedAt}` |
| 开标文件包（证据件） | **完整保留**（证据链） |

### 5. 前端

- 供应商 `my-bids/[projectId]/opening-hall/page.tsx`：`window.confirm` 原生弹窗 → SpDialog（确认说明 + PIN 输入）；链路 GET payload → openUkey → `adapter.sign(certSn, canonical)` → POST；certSn 解析与错误码映射照抄 clarifications 页；已签名态显示「已电子签名（SM2/SM3 · 验签时间）」；已确认未签名显示「补签」入口
- 主持端 :3007 `opening-hall.tsx` 确认列：CONFIRMED 行加「已电子签名/未签名」小徽标（数据源 = 剥壳摘要）

### 6. e2e 改造

`opening-hall.e2e-spec.ts:436` 现无 body 直调 → 改为：测试内 sm-crypto 生成密钥对、更新 sup1 `sm2PublicKey`、按 util 重建 canonical 签名后 POST；补一条「签名错误 400」用例。

## 二、A-90 方案 a：旧轨 UI 退役（API 保留）

- **UI**：`submit/page.tsx` 的 `!dualReady` 分支（旧轨上传/投递区，:801 起）整体替换为「绑盾引导卡」——说明双信封为唯一投递通道 + 跳转 U盾管理页按钮；checklist :698 文案同步；`dualReady` 内部分支不动（内部死分支保留，与 API 对齐）
- **API/flag 不动**：`submitBid` 旧轨分支、`BID_DUAL_ENVELOPE` 应急回退语义、CI 旧轨 13 项 e2e 全部原样
- **审计口径升级**：A-90 由「部分符合+说明」升级为「符合——唯一交互通道具备完整加密+签名+防篡改；旧轨仅存 API 应急通道」
- 附带收益：旧轨「代解密授权勾选缺失→UI 递交 400」死路随 UI 退役自然消解（不修）

## 三、种子绑盾（演示可用性）

- `apps/api/scripts/bind-ukey-slots.ts`：扫描 `UKEY_SLOT_DIR`（默认 `~/.shuidi-ukey/slots/*.ukey`，格式见 `services/ukey-middleware/src/shield.mjs`）→ 按 CN=企业名匹配 Supplier → 幂等 upsert `SupplierCert(ACTIVE)` + 回填 `sm2PublicKey`；输出绑定清单（含未匹配槽位告警）
- 发盾：`node services/ukey-middleware/src/cli.mjs issue --cn <企业名>`（演示常客：中科院成都信息技术股份有限公司、四川省通信产业服务有限公司、重庆蜀通岩土工程有限公司、竞价项目三家地质大队）
- 用法与盾-供应商对应表记入 `ACCOUNTS.md`

## 四、验收清单

1. 单测（canonical util + confirmOpening 分支 + 剥壳）与 e2e（签名确认 + 错签 400）绿；全量单测/lint/tsc/build 绿
2. `npx prisma validate` + 迁移三步（create-only → db execute → resolve）+ `prisma generate`
3. 浏览器：供应商签名确认开标记录全链（真盾）→ :3007 徽标；未绑盾供应商投递页只见引导卡；种子脚本绑定后多家可新轨投递
4. 审计报告 A-90/A-114 注记 + 勘误头波2 行
