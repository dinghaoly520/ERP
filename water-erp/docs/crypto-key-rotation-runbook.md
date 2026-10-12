# 密钥轮转 Runbook（密文体系运维手册）

> 生成背景：2026-10-12 密文设计评估（P1-2/P1-3/P2-7/P2-8 项落地配套）。
> 适用范围：`apps/api` 全部密钥。**信封轨（envelope-crypto）、供应商传标、开评标、CA 相关密文设计于 2026-10-12 用户裁定暂不改动**——本文如实记录其现状约束，不提供尚未实现的轮转能力。

## 0. 密钥清单与轮转能力总表

| 密钥 | 用途 | 密文自描述 | 轮转能力 | 守卫 |
|---|---|---|---|---|
| `FIELD_ENC_SECRET`（+`_OLD`） | PII 国密字段（`sm1:`） | ✅ keyId 内嵌 | ✅ 双钥读窗口 | 生产缺失/<32 拒绝启动；dev 回退钥无条件告警 |
| `KMS_SECRET` | 信封 DEK 包裹 + 招标文件 + 通用上传密封 | ❌ 无 keyId | ⚠️ 大爆炸式（见 §2） | 生产缺失拒绝启动（2026-10-12 起） |
| `PASSWORD_VIEW_SECRET` | 供应商密码副本保险柜 | ❌ 无版本 | ❌ 轮转=副本全不可读 | 无（静默降级为纯 bcrypt） |
| `JWT_SECRET` | 会话令牌签名 | ❌ 无 kid | ⚠️ 换钥=全会话失效 | 生产缺失/<32 拒绝启动 |
| `ADMIN_KEYSTORE_DIR`（目录） | 管理方外层信封 SM2 私钥（每证一文件） | ✅ 按 cert.id 定位 | ✅ 生成即轮转（旧证私钥保留） | 无启动守卫（bootstrap 自愈） |
| `SUPERVISION_KEYSTORE_DIR` | 监督推送平台签名私钥 | 单文件 | ⚠️ 手工 | 无 |

---

## 1. FIELD_ENC_SECRET（PII 国密轨）——标准轮转流程

`sm1:` 密文内嵌 keyId（主密钥 HMAC-SM3 短指纹），读端按 keyId 在 `[active, OLD]` 中选钥。轮转分五步，**第 4 步是硬性的，跳过即查重静默失效**：

1. **预备**：确认当前 active keyId（脚本输出或 `fieldKeyId(secret)`）；跑一次 `npx tsx apps/api/scripts/recompute-pii-blind-index.ts`（dry-run）确认当前零待重算（基线干净）。
2. **配置**：`.env` 中设 `FIELD_ENC_SECRET_OLD=<旧钥>`，再将 `FIELD_ENC_SECRET=<新钥>`（顺序不可反——先有 OLD 再换新）。重启 API。
3. **验证读路径**：任一管理端浏览页（账号列表/专家库）能正常显示掩码手机号；`npx jest sm-field-crypto` 通过。
4. **【硬性】重算盲索引**：`npx tsx apps/api/scripts/recompute-pii-blind-index.ts`（dry-run 审阅）→ `--execute`。
   - 原因：盲索引只用 active 钥派生，换钥后存量 `User.phoneIdx` / `Supplier.legalPersonIdCardIdx` / `SupplierContact.idCardIdx` 失配 → **重复手机号可注册、法人身份证可重复入库，且无报错**。
   - 完成判据：重跑 dry-run 零待重算、零失败。
5. **收尾**：观察一个业务周期后移除 `FIELD_ENC_SECRET_OLD`（移除前旧密文须已全部重封或确认不再读——当前系统**无存量重封工具**，旧密文依赖 OLD 钥长期可读，故 OLD 建议保留至下一轮轮转）。

> 写侧说明：新写入行自动用新钥密封；存量行保持旧钥密文（读端兼容），无需迁移。

## 2. KMS_SECRET（信封/招标文件/通用上传密封轨）——现状约束

**当前无轮转能力**：`wrapKey`/`sealField` 产物不含 keyId，读端无法区分新旧钥。轮转只能是「大爆炸式」：

1. 维护窗口内停写（投标投递/招标文件上传/通用上传全停）；
2. 配置新钥；
3. 全量迁移：逐条 `unwrapKey(旧)` → `wrapKey(新)` 重写 `SupplierBidSubmission.*SealedKey`、`BidDocument.decryptKey`、`FileAsset.sealedKey`；
4. 迁移工具**尚未编写**（2026-10-12 评估 P1-2 建议的 `v2:` keyId 格式经用户裁定暂不实施——涉信封轨设计）。

**运维口径**：把 KMS_SECRET 视为「与数据同生命周期的静态密钥」——泄露应对以全量重封应急演练为准，而非例行轮转。

## 3. JWT_SECRET

换钥 = 所有会话立即失效（五门户全部重新登录）。安排低峰窗口，换钥后观察 `SESSION_REPLACED` 告警量归零。无 kid 机制，新旧 token 不可共存——一次性切换。

## 4. PASSWORD_VIEW_SECRET

轮转 = 全部供应商密码副本静默不可读（`decryptPasswordVault` 失败返 null，降级为纯 bcrypt——功能不炸，admin 查看密码失效）。**无版本化，无轮转路径**；且「可恢复密码副本」本身是已记录的产品决策弱化项（`password-vault.util.ts` 头注释），建议列 roadmap 退出。

## 5. ADMIN_KEYSTORE_DIR / SUPERVISION_KEYSTORE_DIR（文件密钥库）

- **永不删除**：轮转（`POST /api/bid/admin-cert/generate`）只置旧证 `active:false`，旧私钥文件必须保留至其覆盖的提交全部归档——按 `envelope.adminCertId` 定位。
- **必须纳入备份**：不在 DB/MinIO 备份内，丢失 = 历史信封外层永久不可解（全量 PLATFORM 归因失败）。
- 写盘失败自愈：`generate()` 会回滚 `active:false`，不会出现库内 active 证书有公钥无私钥。

## 6. 每次轮转后的验证清单

```bash
cd apps/api
npx jest sm-field-crypto upload.service --silent   # 加解密单元
npx tsx scripts/recompute-pii-blind-index.ts       # 盲索引 dry-run 应零待重算
# 浏览页抽查：账号列表手机号掩码可见；专家画像「明文」揭示可用
# 投标链路抽查：供应商回看投标文件可下载（涉 KMS 时）
```

## 7. 红线（再强调）

1. 换 `FIELD_ENC_SECRET` 不跑盲索引重算 = 查重静默失效——这是本手册唯一「跳过即产生数据完整性漏洞」的步骤。
2. `ADMIN_KEYSTORE_DIR`、`.data/supervision/` 不在 DB/MinIO 备份内——备份策略必须单独覆盖，保留期 ≥ 业务归档期。
3. 生产守卫三件套（JWT ≥32 / FIELD_ENC ≥32 / KMS 非空）依赖 `NODE_ENV=production` 正确设置——部署清单须含该项检查；dev 回退钥激活时启动日志有无条件告警，监控应对 `sm-field-crypto] FIELD_ENC_SECRET 未配置` 建告警项。
