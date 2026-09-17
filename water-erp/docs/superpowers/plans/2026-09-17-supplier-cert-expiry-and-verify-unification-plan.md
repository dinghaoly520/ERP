# 供应商证书有效期（A-13）与验签口径统一 实施计划（2026-09-17）

> **问题来源**：在线招投标功能差距分析（`docs/在线招投标系统功能差距分析-2026-09-16.md` §一#2）+ 2026-09-17 供应商签名链代码审查。
> **基线**：main @ 1a2c3812（2026-09-17；工作区含他人未提交 tender-write.template.ts/format-acquire-time.ts 改动——与本文文件集不重叠，实施期每提交前复核 git status）。
>
> **范围**：两个代码可解的问题——
> **A. SupplierCert 无有效期字段**（真 CA 就绪阻塞 + CTS A-13 到期提醒缺位）
> **B. 回执/开标确认验签公钥口径未统一**（仍走 `Supplier.sm2PublicKey` 旧列，主链已收紧到 ACTIVE SupplierCert）

---

## 一、现状（代码实证索引）

| 事实 | 位置 |
|------|------|
| 供应商侧已有 5 条 SM2 签名链（投递信封/回执/开标确认/澄清答复/补传重签），链路完整 | `supplier-portal.service.ts` / `dual-envelope-core.ts` |
| 主链（投递/补传）验签已收紧：ACTIVE SupplierCert，不回退旧列（注释自认 revoke 不清旧列的弱点） | `supplier-portal.service.ts:1777-1788`、`:2172-2186` |
| 回执三端点仍验 `Supplier.sm2PublicKey` | `:535-544`（guard）、`:573-575`（sign）、`:600-605`（re-verify）；路由 `supplier-portal.controller.ts:57/64/71` |
| 开标确认仍验 `Supplier.sm2PublicKey` | `loadOpeningConfirmContext :3025-3029`、`confirmOpening :3088`；canonical/strip `opening-confirm-signature.util.ts` |
| `bindCert` 事务内回填旧列 `Supplier.sm2PublicKey` | `:713` |
| **bindCert 已保证一证一 ACTIVE**（绑定前旧 ACTIVE 全部 REVOKED） | `:745-748` |
| SupplierCert 无有效期列；mock `CertInfo` 无 validity 字段 | `schema.prisma`；`packages/ukey/src/types.ts` |
| mock 介质生成点 / 透视图（只透传 4 字段） | `packages/ukey/src/mock-ukey.ts:99-111`（createCertificate）、`:236-238`（publicView） |
| mock 中间件（:17999）：盾证书生成 / 列表响应映射 | `services/ukey-middleware/src/shield.mjs:98-107`、`server.mjs:72`；运行实例为 systemd portable，须重启才产出带有效期的**新**证书 |
| vendor 适配层列表映射丢弃额外字段 | `packages/ukey/src/vendor-ukey.ts:430-436` |
| 通知/调度先例：`notification.create({userId,...dto})`、`buildExpiryNotification` 纯函数出 spec | `scheduler.service.ts:58-76`、`scheduler.service.spec.ts` |
| FE bind 调用与 api 签名 | `apps/supplier-portal-next/src/app/(main)/profile/ukey/page.tsx:206`、`lib/api/supplier.ts:47` |

## 二、设计决策

**D1（v2，用户裁定 2026-09-17）：mock 证书自带 60 天有效期。** 证书**生成时**stamp：`notBefore=生成时刻`、`notAfter=生成时刻+60d`——`CertInfo` 增可选 `notBefore/notAfter`（ISO），`MockUKeyAdapter.createCertificate` 与中间件 `shield.mjs` 生成时写入，`vendor-ukey.ts`/`server.mjs` 列表透传，FE bind 时随公开信息上送 `expiresAt`。**向后兼容**：存量介质/存量盾文件/运行中的旧中间件实例无该字段 → bind 不传 → 落库 null=长期（永不过期）；:17999 systemd 实例重启后仅对**新生成**证书带有效期（演示盾 SHD-B14EF038 存量证书不受影响）。有效期随介质持久化（导入/导出随 certsJson 走）。
**D2 过期只在「时点闸门」生效。** 绑定时（拒绝绑定已过期证书）与投递/补传验签时（拒绝过期证书签署**新**签名）拦截；**历史签名复验不因证书嗣后过期/撤销而失效**——签名有效性以签署时点为准（电子签名法语义），复验可靠性由 D4 快照承担。
**D3 到期提醒 30/7 天两档、一次性。** `SupplierCert.expiryNotifyStage Int @default(0)`（0/1/2）确定性去重；每日 `15 8 * * *` cron（避开既有 8:00/9:00 槽）；通知 type `CERT_EXPIRY_REMINDER`、link `/profile/ukey`；已过期且 stage<2 补发「已过期」通知后静默。每证书最多 2 条。
**D4 签时快照存档。** `receiptSignature`/`confirmSignature` Json 签署时**增存** `certSn`+`certPublicKey`；复验优先快照 → 存量（无快照）回退 `Supplier.sm2PublicKey`。零迁移兼容；「换绑后复验 SM2_PUBLIC_KEY_MISSING」盲区就此消失。
**D5 验签公钥统一 ACTIVE SupplierCert。** 回执 guard/验签、开标确认 context/验签改查本供应商唯一 ACTIVE 证书（一证一 ACTIVE 由 bindCert 保证）。旧列保留 bindCert 回填（旧轨 `:1716` + D4 回退仍读），加 @deprecated 注释。**收紧副作用已知**：revoke 后未换绑期间无法签回执/确认（原旧列可过）——错误码保持 `SM2_PUBLIC_KEY_MISSING`（FE 分支依赖），文案给绑定指引。
**D6 新错误码。** `CERT_EXPIRED`（投递/补传闸）、`BIND_CERT_EXPIRED`（绑定闸）、`INVALID_VALIDITY`（有效期区间非法）。

## 三、任务分解（每任务一提交，`feat(supplier-cert):`）

- **T1 schema+迁移**：SupplierCert += `notBefore DateTime?`、`expiresAt DateTime?`、`expiryNotifyStage Int @default(0)`、`@@index([bindingStatus, expiresAt])`。非交互迁移：`migrate dev --create-only` → 审 SQL → `migrate deploy` → `validate`+`generate`；提交前 `migrate status` 干净。
- **T2 mock 有效期（D1v2）**：`packages/ukey/src/types.ts` CertInfo += notBefore?/notAfter?；`mock-ukey.ts` createCertificate stamp +60d、publicView 透传；`vendor-ukey.ts` listCertificates 透传；`services/ukey-middleware/src/shield.mjs` 生成带 +60d、`server.mjs` 列表返回；`pnpm --filter @water-erp/ukey build`；mw 单测跑通。
- **T3 bindCert 有效期**：controller body += `notBefore?/expiresAt?`；service 校验（ISO 可解析、expiresAt>now 否则 `BIND_CERT_EXPIRED`、notBefore≤expiresAt 否则 `INVALID_VALIDITY`）并随 create/update 落库（同号复用置回 ACTIVE 分支同步更新）；FE `lib/api/supplier.ts:47` 签名 += 可选字段，ukey page bind 调用透传 `cert.notAfter/notBefore`。
- **T4 投递/补传过期闸**：service 抽 `findActiveUnexpiredCert(supplierId, certSn)`（ACTIVE 但过期 → 400 `CERT_EXPIRED`；不存在 → null 走既有 `SM2_SIGNATURE_INVALID`）；替换 submitBid `:1780` 与 reupload `:2179` 两处 lookup。
- **T5 A-13 cron**：`buildCertExpiryNotification` 纯函数（两态文案：即将到期/已过期）+ `@Cron('15 8 * * *') scanSupplierCertExpiry`（扫 ACTIVE+expiresAt 非空，stage 推进 1/2，`notification.create`）；spec 仿 `buildExpiryNotification` 既有手法。
- **T6 U盾管理页有效期展示**：服务端行（listMyCerts 全列自动带出）+本地介质行（CertInfo.notAfter）展示有效期：null=「长期（旧介质）」、≤30d 黄标、≤7d/过期红标。
- **T7 回执口径统一**：`assertReceiptSm2PublicKey` → `findActiveCertForSigning`（ACTIVE SupplierCert，码保持 `SM2_PUBLIC_KEY_MISSING`）；sign 验签用 cert.publicKey 并存快照；verify 快照优先→旧列回退。
- **T8 开标确认口径统一**：`loadOpeningConfirmContext` 改取 ACTIVE 证书；confirmOpening 验签用 cert.publicKey、confirmSignature 增快照；`stripOpeningConfirmSignature` 透出 certSn。
- **T9 测试**：`supplier-portal.service.spec.ts` += bindCert 三校验分支 / CERT_EXPIRED 闸 / 回执 ACTIVE+快照+revoke 后复验仍真 / 存量无快照回退；`scheduler.service.spec.ts` += buildCertExpiryNotification 两态 + scan stage 推进幂等；回归全量 `pnpm --filter api test`。
- **T10 文档与记忆**：CLAUDE.md 双信封清单补一行；gap 分析 §一#2 A-13 状态更新；memory 落地要点。

## 四、明确不做
真 CA SDK/`AdminEncryptionCert` 有效期（HSM 生命周期另议）/可视印章/旧轨签名⑤补全/信封签名一键复验端点。

## 五、风险与并行会话
- schema.prisma 共享高危：每提交前 `git status` 复核（他人 tender-write/format-acquire 改动在案）；迁移随提交；`prisma validate` 必跑；
- **他人会话正在 supplier-portal CA/U盾前端活跃**（近三条提交：CA自检弹窗/provider 注册表）——T3/T6 动 `profile/ukey/page.tsx` 前须重核该文件是否被并发编辑，冲突则后置并报告；
- mw 运行实例重启运维：`dev:ukey-mw` 源码改后 systemd 实例按 memory `mock-ukey-middleware-runtime` 流程重启（portable 重建），未重启=新证书仍无有效期（不报错，仅退化 D1 原语义）；
- D5 收紧过渡影响与 D3 通知膨胀：见决策注（stage 幂等，每证书≤2 条）。

## 六、验收
1. `pnpm --filter api test`/`lint` 全绿；`prisma validate`+`migrate status` 干净；ukey 包 build 后 `dual-selfcheck` 仍过；
2. 链路：U盾管理页生成新 mock 证书（+60d）→ 绑定 → listMyCerts 见有效期；SQL 置 `expiresAt=now()-1d` → 新投递被 `CERT_EXPIRED` 拦、既有回执 `receipt-verify` 仍 `verified=true`；
3. 回执签署 → `revokeCert` → `receipt-verify` 仍 `verified=true`（快照生效）；
4. cron 手动触发（或置 expiresAt=now()+3d 等窗口）→ 供应商门户出现 `CERT_EXPIRY_REMINDER`，二次执行不重复。
