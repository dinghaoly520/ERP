# 临时需求方代表账号设计（专家抽取手动录入）

日期：2026-11-05
状态：已实施并全链实测（提交 15cac065 + 5639b3e8）

## 需求（用户裁定）

专家抽取的「需求方代表」配置除库内选择外，允许手动录入库外人员（姓名/身份证号/手机号）；该人员以临时专家账号登录 :3006 参与评标，功能与正式专家完全一致；**仅本项目存续期间可登录**——项目结束、归档、流标、终止、废标或重抽换人后不再允许登录。

## 账号模型

- `User.isTempExpert`（迁移 20261105000000）标记临时账号；`role='bid_expert'`
- username=身份证号（人员自知、全局唯一）；初始口令=身份证号（bcrypt，库内专家口令同口径），由 :3005 录入人电话告知
- ExpertProfile 最小档案：specialty（默认「综合」）、phone/idNumber 国密密封（sealPii）、`availability='停用'`、entryStatus='ACTIVE'、notes 留痕
- **`availability='停用'` 的三重效果**：不入抽取候选池、不入需求方代表目录（两处均过滤「可用」）；confirmExtraction 资格复核对其豁免（5639b3e8——原硬闸会整组拒绝 EXPERT_INELIGIBLE）
- 专家库列表按 `isTempExpert: false` 过滤，不污染库统计口径

## 生效链（临时语义核心）

```
录入建号（无绑定，登录被拒）
   └─ 确认抽取写 BidExpert（isPurchaserRepresentative）⇒ 可登录 :3006
        └─ 项目 stage → ARCHIVED/ABORTED（归档/流标/终止联动/废标）或重抽 deleteMany 换人
           ⇒ 无「未终态项目绑定」⇒ 登录拒绝 + 已登录会话下一请求即时 401
```

- **登录双闸**：auth.service.login 校验 + AuthGuard 每请求复核（仅 isTempExpert 账号付一次 `bidExpert.count`，普通用户零开销）；失效码 `TEMP_ACCOUNT_EXPIRED`
- 判定谓词：`bidExpert.count({ userId, project: { stage: { notIn: ['ARCHIVED','ABORTED'] } } }) > 0`
- **第三入口同闸（2026-11-05 审计补）**：`/auth/expert-transfer/claim`（平板工位迁移密码重证）不走 login——claimExpertTransferLocked 内同谓词复核，90s 票据窗口内项目终态即 401 并烧票；:3006 前端 on401 对 TEMP_ACCOUNT_EXPIRED/PASSWORD_CHANGED 增设遮罩（原落入兜底静默跳登录，文案丢失）

## 端点与 UI

- `POST /expert-admin/demand-rep/external`：建号/幂等复用（身份证号撞库内专家 → 409 ID_OCCUPIED_BY_EXPERT 引导库内指定）；审计 DEMAND_REP_EXTERNAL_CREATE
- :3005 指定代表区「手动录入」弹窗（姓名/身份证/手机号必填）；已选 chips 带「临时」徽标；toast 说明凭据规则
- :3006 侧栏品牌下「临时账号 · 仅本项目可用」标注；/auth/me 透出 isTempExpert（shared User 类型同步）

## 已知边界（设计接受）

- 多项目绑定：API 直调把临时 userId 加进其他项目则任一存活即可登录——操作者为信任角色（leader/staff/admin），审计留痕兜底
- 项目终态后临时 User 永久留存（登录被拒即封），不做自动清理——量级小，后续治理项
- :3006 个人信息页对临时账号显示 username=身份证号——本人自视本人证件号，必要（登录名即身份证号）
- OperationLog 记录录入请求体（含身份证/手机号）——与 createExpert 既有口径一致

## 实测记录（2026-11-05）

建号 ✓ → 未入组登录 401 ✓ → 正式 confirmExtraction（append，走资格复核）成功 ✓ → 登录 200 ✓ → 带会话过 AuthGuard 200 ✓ → 解绑后旧会话即时 401 ✓ → 再登录 401 ✓（测试数据已清理）
