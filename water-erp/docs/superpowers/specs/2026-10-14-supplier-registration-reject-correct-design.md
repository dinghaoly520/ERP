# 供应商注册：驳回清洗（数据最小化）与退回补正回填 — 设计

- **日期**：2026-10-14
- **状态**：已批准（用户四项裁定：留壳释放信用码 / 快照最小化 / 短信 token 回填 / 手机号释放为预防性不变量）
- **范围**：:3004 供应商门户注册轨（正式注册）；API `apps/api/src/supplier`；:3005 审核端展示口径随之变化但不改审核操作
- **范围外**：临时供应商（邀请码轨）的**重开**仍走既有邀请码链路（清洗共享 purge 路径）；已入库供应商的资料变更审批流程不动

## 1. 背景与问题

1. **退回补正（RETURNED）是死循环**：注册创建的账号 `isActive=false`，审核通过前无法登录 → 供应商改不了资料；现有 `POST /suppliers/:id/resubmit` 要求登录态且不改数据，够不着；重新注册被 `DUPLICATE_CREDIT_CODE` 拦住。登录页公开查询能看到退回原因，但**没有任何途径实际补正**。
2. **驳回（REJECTED）数据全保留**：Supplier 业务字段（含法人/联系人/银行账号 PII 密文列）、子表、MinIO 附件、`SupplierApprovalRecord.snapshot` 完整资料副本全部留存，与数据最小化要求相悖。
3. **手机号占用**：唯一占用校验在管理端注册（`auth.service.register` ①REGISTRATION_PENDING / ②PHONE_EXISTS，② 不限角色且要求 isActive）。供应商轨本身无手机号占用校验；正式注册的 User 行不存手机号，临时注册存 `phone/phoneIdx` 但 `isActive=false` 现状也拦不住任何注册。

## 2. 决策记录（用户裁定）

| # | 问题 | 裁定 |
|---|------|------|
| 1 | 驳回后能否重新注册 | **留壳 + 释放信用代码**：清洗全部业务字段，保留最小壳（name/creditCode/status/rejectReason/审批留痕），壳重开可再注册 |
| 2 | 审批快照里的完整资料副本 | **同步最小化**（驳回时重写该供应商全部 SupplierApprovalRecord.snapshot） |
| 3 | 公开注册页回填的身份证明 | **短信验证码 → 一次性补正 token**（复用 Verification 模块 token 轨） |
| 4 | 手机号释放 | **预防性不变量**（B）：驳回清洗连手机号一起清；RETURNED 保留手机号但任何占用校验不得视为占用；管理端 ② 收紧为 internal_user |

## 3. 设计一：驳回清洗（reject 时数据最小化）

`SupplierService.reject()` 在现有乐观锁 claim 成功后，同一事务内执行清洗：

| 层 | 动作 |
|---|------|
| Supplier 业务字段 | 置 null：`logoUrl/organizationCode(冗余列同清)/country/region/registeredCapital/industry/companyEmail/companyWebsite/establishedDate/companyProfile/legalPersonIdCard/legalPersonPhone/legalPersonIdCardIdx/detailedAddress/classificationId/urgedAt`；置 `''`（NOT NULL 文本列）：`enterpriseType/legalPerson/registeredAddress/businessScope`；`tags` 置 `[]` |
| 保留壳字段 | `id/userId/supplierNo/name/normalizedName/creditCode/subjectCode/status=REJECTED/rejectReason/reviewStage/companyId/companyName/isTemporary/temporaryExpiresAt/createdAt/updatedAt` |
| 子表 | 删除该供应商全部 `contacts/qualifications/bankAccounts/performances/classificationLinks` 行 |
| User 行 | `displayName/email/phone/phoneIdx/passwordHash/passwordVault` 置 null（passwordHash=null 使登录天然拒绝，auth 无需改动）；行保留（壳 FK + FileAsset 归属） |
| 附件 | 删除 `uploaderId=该 user` 且 `category ∈ {qualification, general}` 的 FileAsset 行 + MinIO 对象；审批人意见附件（reviewer 上传）不受影响 |
| 审批快照 | 该供应商**全部** SupplierApprovalRecord 的 snapshot 重写为 `{purged:true, purgedAt, name, creditCode, supplierNo, action, stage, reason}`；schema 注释「不可删减、不可修改」改为「驳回即最小化」例外口径 |
| 审计 | 现有 SUPPLIER_REJECTED 审计 payload 增加 `purged:true` |

无需 schema 迁移（全部为置空/删行；FileAsset/MinIO 走现有删除通道）。

## 4. 设计二：壳重开（被驳回公司重新注册）

- `register()` 信用代码命中时按状态分流：`REJECTED` → **壳重开**（复用原 Supplier+User 行原位覆盖：写入全部新字段、设新密码与 displayName/email、status→PENDING、reviewStage→'STAFF'、rejectReason→null、urgedAt→null、isTemporary→false；supplierNo 不变，审批留痕链在同一行延续）；`PENDING/RETURNED` → 维持 `DUPLICATE_CREDIT_CODE`。
- 壳重开同样走正式注册的短信实名核验、营业执照必传、附件归属校验（claim 逻辑复用，owner=既有 userId）。
- 法人/联系人身份证查重：壳盲索引已清洗不会自撞；撞别家仍拦（`DUPLICATE_LEGAL_ID_CARD`/`DUPLICATE_CONTACT_ID_CARD`）。
- `checkDuplicate` 返回值增加 `creditCodeStatus`（null / 'PENDING' / 'RETURNED' / 'REJECTED' / 'APPROVED'…）：REJECTED 不再算阻塞性重复，前端据此提示「可重新注册」。

## 5. 设计三：退回补正回填

**身份链**：公司名 + 信用代码精确匹配 RETURNED 申请 → 短信发到注册时验证过的主联系人手机（掩码显示）→ 验证码换发一次性补正 token（复用 `VerificationService.verifyAndStartRegistrationSession`，30 分钟注册会话同款）→ 凭 token 拉资料回填 → 补正提交时消费 token。每个请求同时校验：token 内手机 == 该申请主联系人手机（盲索引比对）且 name/creditCode 匹配。token 不单独标识供应商。

**新增公开端点**（`supplier.controller.ts`，@Public + @Throttle 与 register 同级）：

```
POST /suppliers/register/correction/request  {name, creditCode}
  → 匹配 RETURNED 申请 → sendRegistrationCode(主联系人手机, scene='supplier_registration')
  → 返回 {maskedPhone}；未匹配/非 RETURNED 返回 {maskedPhone: null}（同形 200；枚举面与既有 status/public 查询一致）
POST /suppliers/register/correction/verify   {name, creditCode, code}
  → verifyAndStartRegistrationSession(主联系人手机, code) → {correctionToken}
GET  /suppliers/register/correction/draft?token&name&creditCode
  → 校验链 → RegisterSupplierDto 形状完整资料（PII 解封回填，本人场景符合 PII 出口口径）
    + {returnReason, reviewStage}
POST /suppliers/register/correction/submit   {token, name, creditCode, dto}
  → 校验链 + consumeRegistrationSession → 原位更新（见下）
```

**补正提交（原位更新）**：
- `creditCode`/username 锁定不可改；其余字段（含公司名，同步 normalizedName）可改。
- 子表删旧建新；被替换的旧附件（owner=该 user、category∈{qualification,general}、不在新 dto 引用集内）FileAsset+MinIO 清理；新附件走注册同款归属校验并 claim。
- `status RETURNED→PENDING` 用条件 `updateMany` 乐观锁；**reviewStage 保留**（回到被退回的那一级）。
- 审计 `SUPPLIER_RESUBMITTED`（note=补正提交）；`notifyStageApprovers(stage)` 通知该级审批人。
- 补正模式不做第二次短信实名核验（token 已证手机控制权）；主联系人手机可改，改动后下次补正短信发新号。

**注册页交互**（`apps/supplier-portal-next/src/app/register/page.tsx`）：
- 基本信息步公司名输入 debounce 调既有 `GET /suppliers/register/status/public?name=`：status=RETURNED → 黄色横幅「检测到贵司有退回补正中的申请」+ **退回原因全文** + 「进入补正」按钮 → 内嵌验证码小步（掩码手机 + 发码 + 输码）→ 回填全部六步（映射复用 `acceptRecovery` 逻辑，密码留空）+ 每步顶部常驻补正原因条 + 提交钮文案「补正后重新提交」。同名多家时提示继续填信用代码精确匹配。
- status=REJECTED → 横幅「曾有被驳回申请（资料已按数据最小化清除），可重新注册」，正常走注册、提交时壳重开。
- 补正模式覆盖本机 localStorage 草稿（toast 告知）。
- 登录页进度查询 RETURNED 结果处加「前往注册页补正」链接（`/register`）。

## 6. 设计四：手机号释放不变量（预防性）

- **驳回 = 彻底释放**：purge 清 User.phone/phoneIdx + 全部联系人行（含手机号密文）——手机号在系统内无任何残留占用。
- **RETURNED 不占用**：手机号保留（补正短信依赖），但任何占用校验不得将其视为占用。现状无校验会拦；补回归测试锁死。
- **管理端 ② 收紧**：`PHONE_EXISTS` 查询从「任意角色 isActive」改为 `role:'internal_user'`（与 ① 同口径）——供应商（正式/临时）的手机号永不拦管理端注册。
- 不变量测试：REJECTED/RETURNED 供应商的手机号 + 正式注册 + 临时注册 + 管理端注册四轨均不报手机号占用。

## 7. 错误处理与安全

- 防枚举：correction/request 对未匹配/REJECTED/APPROVED 返回同形响应；发码有冷却与 IP 限流（Verification 现有机制）。
- 并发：补正提交与审批并发靠 status 条件 updateMany 乐观锁（与 return/resubmit 同款）；token 二次消费报错；验证后改手机号/验证码 → 会话作废（注册页既有防陈旧逻辑同款）。
- draft/submit 的 PII 解封为本人数据出口（owner 场景），与 profile 页口径一致；快照最小化后审批历史页仍可见操作/理由/审批人/时间，但无资料详情。
- 清洗后 :3005 详情页显示空资料 + 驳回原因（属预期展示口径）。

## 8. 测试计划

- **单测**（co-located spec）：
  - purge：逐字段断言置空/子表清空/附件删除/快照最小化/User 五列清空+登录拒绝；
  - 壳重开：原位复用（id/supplierNo 不变、审批留痕延续、rejectReason 清空）、盲索引不自撞、PENDING/RETURNED 仍拦；
  - correction 四端点：happy path + 错手机/错名/错码/token 复用/状态守卫（非 RETURNED 拒绝）；
  - checkDuplicate 状态感知；
  - 手机号不变量：四轨注册同号不占。
- **e2e**（`test/supplier.e2e-spec.ts` 模式）：注册→退回→补正回填→重提→驳回→壳重开全链。
