# 敏感字段国密加密存储设计（等保三级 + 密评整改）

日期：2026-10-09 · 分支：`feat/gm-field-encryption` · 状态：已确认（口头评审通过，存量数据清除、不迁移）

## 背景与目标

等保 2.0 三级测评 + 商用密码应用安全性评估（GM/T 0054）整改：系统中评标专家身份证号/手机号、供应商法人身份证号/联系人身份证号/银行账号等敏感个人信息与重要业务数据**明文入库**，不满足「安全计算环境—数据保密性」测评项。

改造深度（用户裁定）：**落库加密 + API 出口默认脱敏 + 解密访问审计** 三层齐全。

关键裁定：

| 维度 | 决定 |
|---|---|
| 驱动 | 等保三级 + 密评（密评强制国密） |
| 算法 | SM4-CBC + HMAC-SM3（Encrypt-then-MAC，GB/T 36624 可鉴别加密）；盲索引 HMAC-SM3 |
| 落点 | 应用层字段级加密（扩展 `field-crypto` 模式；pgcrypto 无 SM4、TDE 防不了拖库，均否决） |
| 存量 | **不迁移、不沿用**：种子重建，全新数据走密封写入 |
| 范围边界（2026-10-09 用户裁定） | **bidPrice 与在线评标域一律不动**：AES 版 `field-crypto`（bidPrice 密封）保持现状，与国密 `sm-field-crypto` 并存；本期只做供应商信息、专家信息、账号信息的 PII 加密 |

## 密码方案

新建 `apps/api/src/common/crypto/sm-field-crypto.ts`（与 AES 版 `field-crypto.ts` 并存——后者继续服务 bidPrice 密封，不迁移）：

- 加密：SM4-CBC（随机 16B IV，PKCS7）——Node 原生 `sm4-cbc`（本机已验证可用；`sm4-gcm` 不可用）
- 完整性：HMAC-SM3（EtM，覆盖 `iv‖ciphertext`，32B tag）
- 密文格式：`sm1:<keyId>:<base64(iv16‖ct‖mac32)>`——内嵌 keyId，轮转就绪；未知 keyId 抛明确错误
- 密钥派生：`KDF = HMAC-SM3(master, label)`，三把用途独立钥：
  - `sm-field/enc/v1`（SM4 128bit）、`sm-field/mac/v1`、`sm-field/index/v1`
- 盲索引：`blindIndex(plain)` = HMAC-SM3 hex（64 字符，确定性、不可逆），供等值查询

主密钥 `FIELD_ENC_SECRET`（生产守卫对齐 `getJwtSecret()`：缺失/<32 字符拒绝启动），与 `KMS_SECRET`（投标信封）、`PASSWORD_VIEW_SECRET`（密码保险柜）分类分离。`FIELD_ENC_SECRET_OLD` 留轮转接口（本轮不实现轮转任务）。

## 加密字段清单

| 模型 | 字段 | 脱敏规则（出口默认） |
|---|---|---|
| `ExpertProfile` | `idNumber` | 前4后4：`5110**********123X` |
| `ExpertProfile` | `phone` | `138****5678` |
| `ExpertProfile` | `licenseNo` | 前4后4（≤8 位全 `*`） |
| `Supplier` | `legalPersonIdCard` | 同身份证 |
| `Supplier` | `legalPersonPhone` | 同手机 |
| `SupplierContact` | `idCard` | 同身份证 |
| `SupplierContact` | `phone` | 同手机 |
| `SupplierContact` | `email` | 本地首字符+`***`+@域名 |
| `SupplierBankAccount` | `accountNo` | 前4后4 |
| `SupplierBankAccount` | `accountName` | 明文保留（户名多为企业名，公示场合本就可见） |
| `User` | `email`、`phone` | 同上（email/手机） |

不加密：姓名（业务高频展示、非密评口径内的鉴别数据）、`creditCode`（登录名，须参与查询）、`BidExpert` 核验字段（已最小化不存号码）。

## 盲索引（保等值查询）

三处应用层唯一性校验改走索引列（schema 无 `@unique` 硬约束，只加列）：

- `User.phoneIdx` ← `auth.service.ts` 手机号占用校验（internal_user 注册）
- `Supplier.legalPersonIdCardIdx` ← 法人身份证唯一性校验
- `SupplierContact.idCardIdx` ← 联系人身份证冲突校验（含 `in` 查询）

## 访问控制与审计

- **本人自视明文**：专家 `getProfile`、供应商门户自己资料/银行账户——明文回显、不审计（本人数据本人可见）
- **管理端默认脱敏**：专家库/供应商库列表、详情、CSV 导出一律掩码
- **明文揭示**：新端点 `POST /expert/admin/experts/:userId/reveal`、`POST /supplier/admin/:id/reveal`（body `{entity, targetId?, field}`），`@Roles('admin')`；写 `SensitiveAccessLog`（actor/entity/targetId/field/ip/createdAt）
- **内部链路**（通知发短信取手机号、AI 分析取数据）服务层透明解密，非人视不审计
- 前端（apps/web）专家详情/供应商详情加「查看明文」按钮（masked 默认）

## Schema 变更（迁移 `20261009000000_gm_field_encryption`）

- `User.phoneIdx String?`、`Supplier.legalPersonIdCardIdx String?`、`SupplierContact.idCardIdx String?`（均加普通索引）
- 新模型 `SensitiveAccessLog`（id/actorUserId/actorName/entity/targetId/field/ip/createdAt，actor+createdAt 索引）
- 加密字段本身**不改类型**（Prisma String→TEXT，`sm1:` blob 无长度压力）

## 种子与测试

- `ExpertProfile.json` 等 PII 字段**合成化**（脚本生成确定性假手机号/身份证号；仓库不再持有真实 PII——git 历史中的旧值不回改，风险已知悉）
- seed 加载走密封写入（含三个盲索引列回填）；`pnpm db:seed` 重建后库内全密文
- 单测：`sm-field-crypto.spec.ts`（roundtrip/防篡改/未知 keyId/盲索引确定性/用途钥隔离）、`pii-mask.spec.ts`、受影响服务 spec（注册唯一性走 idx）
- CI：`.env` 写入步骤补 `FIELD_ENC_SECRET`；validate 全量单测 + e2e 种子链路自动覆盖

## 风险与边界

- Node/OpenSSL 各发行版 SM4 支持差异：本机与 CI 镜像已验证 `sm4-cbc`/`sm3`/HMAC-SM3 可用；若生产镜像缺 SM4（罕见，OpenSSL 1.1.1+ 标配），启动守卫会在自检时暴露
- git 历史仍含旧真实 PII（`ExpertProfile.json`）——本轮不重写历史；如需彻底清除另行裁定
- 密钥丢失 = 数据不可恢复（无迁移路径），`FIELD_ENC_SECRET` 必须纳入密钥备份策略（与 `ADMIN_KEYSTORE_DIR` 同级要求）
