# 评标专家人脸核验设计（本地比对 + 分级降级 + 现场补救）

> ⚠️ **本 spec 已最终否决（2026-09-18 用户裁定：不采用人脸识别）**：最终方案 = 主持人现场人证 + 工位绑定免密登录，见 `2026-09-18-expert-identity-verification-design.md`。本文仅作技术评估与开源选型研究**存档**（供未来监管环境变化时参考），重新启用属新决策，不设自动激活通道。D1 结论已并入最终方案，D2/D4 随本文归档，D3 已撤销。

> **日期**: 2026-09-18
> **状态**: ~~D1/D2/D4 已定案（2026-09-18 用户裁定），D3 阈值与上线策略待定（详见 §11.1）~~ → 已替代（见上）；**注意**：同日 `4d224c65` 已删除专家端短信验证链路，本文降级通道设计已随之修订（不再依赖短信）
> **关联文档**: `docs/鉴权门户边界与硬编码假功能复核清单-2026-08-14.md`（D2 假人脸）、`docs/在线招投标系统功能差距分析-2026-09-16.md`（A-154~157 远程异地评标/音视频）、`docs/superpowers/specs/2026-08-13-expert-paper-signing-design.md`（签字包/回流包证据体系）、`CLAUDE.md` 分工 v3
> **法规依据**: 《评标专家和评标专家库管理办法》（发改委等 2024 年第 26 号令，2025-01-01 施行）第七条（电子系统宜具备采集人脸等生物特征信息功能）、第二十一条（可依托人脸验证门禁、定位轨迹等技术手段防止请托）；国办发〔2024〕21 号（推广远程异地评标）；《个人信息保护法》第 28/29 条（敏感个人信息：单独同意、目的限定）

---

## 1. 背景与现状

**现状**（2026-09-18 分析定稿）：全系统无任何生物特征比对。专家身份核验实际强度 = 账号密码：

- `signin-camera.tsx` 拍照留痕**不比对**、可跳过（`d8201314` 假人脸 → `995795fa` D2 诚实化整改的产物）；
- ~~`expert.service.ts:427` 的 `phoneVerified` 闸门恒真~~ → **已随 `4d224c65`（2026-09-18）拆除**：专家短信链路（`verification` 的 `expert_sign_in` 端点 + signIn 的 phoneVerified 403）整体删除，`BidExpert.phoneVerified` 列暂留 schema 待本设计一并处置（§6.2）；
- 签到照片/IP/UA 落库 `signInMeta` 但 :3007 只显示布尔「已签到」（`evaluation-view.tsx:568,640`），证据存而不示；
- `globals.css:907` `face-scan-line` 死动画残留。

**驱动因素**：26 号令两条直接点名；远程异地评标（A-154~157）上线后「评标的人 = 被抽中的人」只能靠人脸+定位自证；供应商侧已有 CA 双信封强身份，专家侧按既定方向免 CA，人脸是专家侧唯一可行的「本人性」技术证据。

## 2. 目标与非目标

**目标**：
1. 专家签到引入**本地 1:1 人脸比对**（现场采集 vs 专家库底照），数据不外发；
2. 底照**自助注册**（:3006）+ 单独同意 + 可撤回（个保法 §28/29）；
3. 失败**分级补救**：环境性失败可降级（拍照留痕 + 主持人审批【D2 已定】，或人工核验），全程留痕；本人性存疑**不是补救对象**，走拒签+异常处置；
4. 核验证据贯穿：:3007 状态矩阵 → 监督日志 → 评标签字包/回流包（延续「纸面证据自含」原则）；
5. 灰度可退：`FACE_VERIFY_MODE=off|observe|enforce` 三态开关（仿 `BID_DUAL_ENVELOPE` flag 先例）。

**非目标**：
- 不做音视频会议/远程异地评标本体（A-154~157 另行立项，本 spec 预留联动点）；
- 不做 1:N 检索（黑名单找人）、不做供应商/主持人人脸（先专家单一角色）；
- 不对接公安一所 CTID/省专家库统一身份（L2，另行立项）;
- 不做移动端 App（浏览器 getUserMedia 为准）。

## 3. 门户分工（承接分工 v3）

| 门户 | 角色 | 落点 |
|---|---|---|
| **:3006** | 注册 + 识别执行 | 向导第 1 步升级（SigninCamera → 取帧+比对+活体）；个人中心「人脸底照」自助注册/更新/撤回 |
| **:3005** | 主数据 + 评标前准备 + 审计 | 专家管理中心身份核验管理区（状态/禁用/重置/查看底照，admin only）；抽取底照校验；开标确认面板底照就绪率；策略开关 |
| **:3007** | 现场监控 + 补救处置 | 核验状态矩阵、降级审批、人工核验登记、核验异常处置（联动替换/流标）、监督视图核验事件 |

**原则**：:3005 不新增顶级导航页（近期方向是收敛入口，`f58cbdcd` 先例）；管理能力折进 `/expert` 专家管理中心既有 tab + 开标确认面板既有区块。

## 4. 总体架构

```
:3006 专家门户                NestJS API (:4001)                识别后端
┌──────────────┐   ①取帧+活体   ┌──────────────────┐  ③1:1 比对  ┌─────────────────┐
│ 向导第1步     │ ────────────▶ │ face-verify 模块  │ ──────────▶ │ FaceProvider    │
│ SigninCamera │   (multipart) │ (新 Nest 模块)     │  (HTTP)     │ CompreFace 容器 │
└──────────────┘               │  · enroll/verify  │             │ 或 SeetaFace6   │
                               │  · FaceProvider   │             │ 或 mock         │
:3007 主持端 ──降级/人工核验──▶ │  · 三态模式闸      │             └─────────────────┘
:3005 管理端 ──底照管理──────▶ │  · FaceEnrollment  │   ②活体旁路   ┌─────────────────┐
                               └──────────────────┘ ──────────▶  │ liveness sidecar│
                                      │ Prisma                    │ (MiniFASNet 系) │
                                      ▼                           └─────────────────┘
                               FaceEnrollment / BidExpert 核验字段 / FileAsset(底照,受限)
```

- **`face-verify` Nest 模块**（`apps/api/src/face-verify/`）：FaceProvider 接口（`detect/embed/verify`）+ `compreface.provider.ts` / `seeta.provider.ts` / `mock.provider.ts` 三实现，`FACE_PROVIDER` env 选择（仿 `sms-provider.ts` 多实现先例）；
- **识别后端独立进程**：CompreFace 走 docker-compose 独立服务（自带 REST）；SeetaFace6 备选则包一层 FastAPI（仿 `services/ocr/` 的 start.sh venv 模式，端口参数化支持多副本）；
- **liveness sidecar**（P1.5）：MiniFASNet 系静默活体，FastAPI 微服务（`services/face-liveness/`），`LIVENESS_SERVICE_URL` env；P1 无活体（单帧比对，降级路径兜底照片打印攻击风险）；
- **嵌入向量存储**：`FaceEnrollment.embedding`（BLOB/JSON）存 ERP 库为 source of truth，比对时由 API 转交 provider（CompreFace 用其内部 face collection 时另行同步——见 §11 D4 待定）；
- **CPU 推理**：本机无独显，全链路 CPU（ONNX Runtime / OpenVINO——本机已装 Intel oneAPI 2026，OpenVINO 可作加速项）；比对延迟目标 < 2s/人。

## 5. 数据模型（Prisma 增量）

```prisma
// 专家底照注册（1:1 ExpertProfile，敏感数据——见 §9）
model FaceEnrollment {
  id                  String    @id @default(cuid())
  userId              String    @unique
  status              String    @default("ACTIVE") // ACTIVE | DISABLED(管理员禁用) | REVOKED(本人撤回)
  baselinePhotoAssetId String?  // FileAsset category=expert_face_baseline；REVOKED 时置空并删对象
  embedding           Bytes?    // 特征向量（512d float32）；REVOKED 时置空
  consentAt           DateTime  // 单独同意时间（非注册流程隐私政策勾选，独立弹窗）
  consentVersion      String    // 同意书版本
  enrolledAt          DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  disabledReason      String?   // 管理员禁用事由
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// BidExpert 增列（显式落列，不埋 JSON——金额单位教训）
model BidExpert {
  // ... 现有字段
  faceVerifyStatus    String?   // FACE_PASS | DEGRADED_PHOTO | MANUAL_HOST | FACE_FAIL | null(未走到)
  faceVerifyMethod    String?   // human | degrade | manual
  faceVerifiedAt      DateTime?
  faceDegradedReason  String?   // 降级/人工核验事由（签字包证据）
  faceSimScore        Float?    // 比对相似度（observe 模式统计用）
}
```

- `signInMeta` 继续扩充（照片 assetId、活体结论、provider 版本、耗时）作诊断明细；**报表/签字包读端只读显式列**；
- 迁移注意：与并行会话共享 `schema.prisma` 高危文件——按协作约定在对方工作区干净时改 + 提交内附迁移 + `npx prisma validate`；
- FileAsset 新类目 `expert_face_baseline`：**必须可删**（与 `bid_decrypted` 永不可删相反——撤回同意是法定义务）；下载授权收紧为本人 + admin（admin 查看需落操作日志）。

## 6. 核心流程

### 6.1 底照注册（:3006 个人中心，随时可做，非强制前置）

```
专家登录 :3006 → 个人中心「人脸底照」卡片
  → 独立同意弹窗（目的/存储/撤回说明，版本化）→ 同意落 consentAt/consentVersion
  → 摄像头取帧（3 帧）→ 上传 → face-verify 模块：检测人脸 → 质量校验（正脸/亮度/分辨率）
  → 生成 embedding → FaceEnrollment upsert（旧底照对象删除）
  → 状态徽章「已注册·YYYY-MM-DD」；撤回按钮 → 状态 REVOKED + 删照片 + 删向量（不可逆，需二次确认）
```

**拒绝注册不阻塞评审**（observe 模式下无底照走原链路）；enforce 模式下抽取时校验（§6.5）。

### 6.2 签到核验（:3006 向导第 1 步）

```
SigninCamera 升级：取景 → 检测到人脸 → 采帧（P1.5 加静默活体判定）
  → POST /face-verify/attendance { projectId, frames }
  → 服务端：模式闸 → 底照加载 → provider 1:1 → 相似度 ≥ 阈值？
     ├─ enforce: PASS → 签发 faceTicket（一次性，绑定 user+project+result，60s 有效）
     │            → 前端携 ticket 调既有 POST /expert/.../sign-in（原闸门不变，ticket 校验通过即 faceVerifyStatus=FACE_PASS）
     ├─ enforce: FAIL/无底照/服务宕机 → 前端进入补救分流（§6.3/§6.4），不得本地静默放行
     └─ observe: 只记 faceSimScore + 结论，不拦截（阈值调优期，§11 D3）
```

- 原有拍照留痕保留（无论核验方式，照片都是证据附件）；
- `phoneVerified` 列处置：`4d224c65` 已删闸门与短信链路，本设计 P1 迁移**删除该列**（历史签到数据本就无真实核验语义，无迁移价值；`expert-extraction.service.ts` 同步去除直写 true 的残留赋值）。核验状态唯一权威字段 = `faceVerifyStatus`；

### 6.3 降级核验（环境性失败 → :3007 主持人审批 + :3006 执行）【D2 已定：主持人单方审批】

```
失败原因 ∈ {摄像头不可用 | 底照过旧/质量差 | 比对服务 5xx | 光线极端 | 相似度低于降级线但高于拒签线}
  → :3006 提示「申请降级核验」→ WS 通知 :3007 工作区
  → :3007 主持人核验分流：
     ├─ 建议重试/换设备（无审批）
     ├─ 降级·拍照留痕：主持人单方批准（D2 裁定；监督人确认非必需）→ :3006 收到降级码
     │    → 专家重走拍照留痕 + 主持人确认现场身份 → signIn(faceVerifyStatus=DEGRADED_PHOTO)
     └─ 人工核验：专家出示身份证，主持人现场人证比对 + 登记（经办人/证件类型）
          → POST /bid/.../manual-verify → faceVerifyStatus=MANUAL_HOST
  → 全部降级写 BidSupervisionLog（action=身份核验降级，含事由/经办；监督人字段有则记）
```

> **短信通道不再重建**：原设计降级路径复用 `verification/send-code`，该链路已于同日 `4d224c65` 删除；降级语义简化为「拍照留痕 + 主持人审批 + 监督日志」，人工核验（身份证人证比对）为第二通道。理由：短信只能证明「持有手机号」，不能证明「人在现场」——现场场景下主持人目视 + 拍照的证据强度反而更高，且少一套基建。

**护栏**（D2 单方审批下尤其重要）：每项目降级次数在状态矩阵置顶显示；降级理由必填；签字包全量披露核验方式（§6.6）——防补救通道架空核验；`FACE_VERIFY_MODE=off`（应急）时整体走原链路但需 :3005 管理员开启并事后审计（仿 `BID_DUAL_ENVELOPE=false` 应急语义）。

### 6.4 核验异常（本人性存疑 → 处置而非补救）

```
比对分数显著低 / 活体失败 / 现场人证明显不符
  → :3007 拒签（POST /bid/.../reject-verification）
  → BidSupervisionLog 异常事件 + 监督视图时间线 + WS 广播
  → 处置联动（**D1 已定：替换动作仅归 :3007**）：
     评标中替换 = :3007 新增动作（写监督日志 + 通知 :3005 台账同步）；
     :3005 不新增任何在途替换入口（既有评标前「正选候补替换」面板维持原状，属分工 v3 评标前准备）；
     不可替换（候补耗尽）→ 异议裁决/流标既有路径
```

### 6.5 :3005 评标前准备联动

- **抽取校验**：`expert-extraction` 抽取结果页标注底照状态（未注册专家在 enforce 模式给出警告/按策略过滤；observe 不拦）；
- **开标确认面板**「专家确认」区块增一行：`人脸底照就绪 4/5`（未就绪名单悬停可见），与既有正选候补替换同区；
- **专家管理中心**：专家列表加核验列（未注册/有效/已禁用/已撤回）；详情抽屉可查看底照（admin only，查看即记日志）、禁用（事由必填）、重置（通知专家重新注册）；**无「替人录入」能力**（同意必须本人，§9）。

### 6.6 签字包 / 回流包证据

- 个人评分确认表增「身份核验」行：`人脸核验通过（相似度 xx）` / `降级核验·拍照+主持人审批（事由）` / `人工核验（经办：主持人）`；
- 签字包监督附件增「核验记录表」（全专家 × 方式 × 时间 × 经办）；回流包 JSON 同步核验摘要；
- 归档闸门不变（签字闭环 + 回流已生成），核验记录仅作证据不设新闸门。

## 7. API 设计（摘要）

| 端点 | 门户 | 角色 | 说明 |
|---|---|---|---|
| `POST /face/enroll` | :3006 | bid_expert | 底照注册（frames + consentVersion）|
| `POST /face/enroll/revoke` | :3006 | bid_expert | 撤回：删照片+向量，REVOKED |
| `GET /face/enroll` | :3006 | bid_expert | 本人状态 |
| `POST /face-verify/attendance` | :3006 | bid_expert | 签到比对 → faceTicket / 失败分流 |
| `POST /expert/projects/:id/sign-in` | :3006 | bid_expert | 既有端点扩展：faceTicket / degradeToken 入参 |
| `GET /bid/projects/:id/expert-verification` | :3007 | admin/bid_host/leader/staff | 状态矩阵（含降级计数、底照就绪、相似度 observe 值）|
| `POST /bid/projects/:id/expert-verification/:expertId/degrade` | :3007 | 主持人 | 降级审批（单方，D2）→ degradeToken |
| `POST /bid/projects/:id/expert-verification/:expertId/manual-verify` | :3007 | 主持人 | 人工核验登记（证件比对留痕）|
| `POST /bid/projects/:id/expert-verification/:expertId/reject` | :3007 | 主持人 | 核验异常 → 异常事件+处置联动 |
| `POST /bid/projects/:id/expert-verification/:expertId/replace` | :3007 | 主持人 | 评标中替换（D1：正选↔候补，写监督日志+通知 :3005）|
| `GET /face-admin/enrollments?status=` | :3005 | admin | 底照台账（无照片本体）|
| `GET /face-admin/enrollments/:id/photo` | :3005 | admin | 查看底照（记日志）|
| `POST /face-admin/enrollments/:id/disable`·`reset` | :3005 | admin | 禁用（事由）/重置（通知重注册）|

- 所有新路由按 RolesGuard 默认拒绝要求显式 `@Roles`；curl 调试带 `X-Portal`；
- `POST /face/enroll`、`/face-verify/attendance` 加 `@Throttle`（仿 login 10/min）；
- 操作日志排除表加核验轮询端点（若前端轮询矩阵）。

## 8. 开源选型与许可证评估（2026-09-18 联网核实）

**最大陷阱：代码开源 ≠ 预训练权重可商用。**

| 方案 | 代码许可 | 权重/商用 | 1:1 比对 | 活体 | 形态 | 评估 |
|---|---|---|---|---|---|---|
| **InsightFace** | MIT（可商用） | **预训练权重（buffalo_l/ArcFace）仅研究用途**，商用需购官方授权 | ✅ SOTA | ❌ | Python/ONNX | 精度天花板；dev 可用，生产要么买授权要么自训权重 |
| **CompreFace**（Exadel） | Apache-2.0 | 社区版免费商用（镜像内置权重） | ✅ REST verify | 社区版无（企业版付费） | Docker REST | **推荐主轨**：天然微服务、docker-compose 一键、管理界面现成；liveness 需自补 |
| **OpenCV SFace**（FaceRecognizerSF） | OpenCV Apache-2.0 | **SFace 权重条款需采购时核实**（opencv_zoo 部分模型 CC BY-NC） | ✅ | ❌ | C++/Python 极轻 | CPU 友好、依赖最少；精度中上 |
| **DeepFace**（serengil） | MIT（包装层） | 被包装后端模型许可各异 | ✅ verify API 现成 | ❌ | Python | 适合原型验证；生产不建议直依赖 |
| **SeetaFace6**（中科视拓） | 2020 宣布开放商业版 | 商用免费（条款采购时复核） | ✅ | ✅ **含活体** | C++ SDK | 国产备选；活体一体化是亮点；需自包 FastAPI |
| **Silent-Face-Anti-Spoofing / MiniFASNet**（minivision-ai） | 开源 | 同左 | —（活体专用） | ✅ 静默活体 | Python | 活体补丁，与任一识别方案组合；2026 活体基准评测仍在榜 |
| 商业云 API（百度/腾讯/阿里/Face++） | 商业合同 | ✅ | ✅ | ✅ 强（含公安权威源人证） | 云 | **数据外发**，违反本项目 L1「不外发」前提；留作 L2 CTID 路径 |

**推荐组合**：
- **主轨（P1）**：CompreFace 社区版容器（1:1 verify REST）+ 本项目 `face-verify` 模块 FaceProvider 适配；
- **P1.5**：MiniFASNet 系静默活体 sidecar（防照片打印攻击；CompreFace 社区版无活体）；
- **备选切换**：FaceProvider 接口下可换 SeetaFace6（要活体一体化/国产化要求时）或 InsightFace 商业授权（要 SOTA 精度时）；
- **阈值起点**：CompreFace 默认阈值起步，observe 模式跑真实分布后定稿（§11 D3）。

## 9. 合规与安全（个保法敏感个人信息）

1. **单独同意**：底照注册前独立弹窗（目的=评标身份核验、存储内容、撤回路径、保存期限），版本化落库；**不得**混入注册流程隐私政策一并勾选；
2. **撤回权（删除义务）**：revoke 即删照片对象 + 向量 + 置空引用，不可逆；FileAsset `expert_face_baseline` 类目必须支持物理删除（与三类目硬保护相反）；
3. **最小可见**：底照仅本人 + admin（查看记日志）；:3007 主持端只看到核验**结论与相似度**，**看不到底照本体**（防止比对过程变成底照扩散点）；签到现场照片按既有 `expert_signin_photo` 权限走；
4. **存储安全**：向量与照片存 MinIO/PG，访问全走授权端点（无直链）；备份策略覆盖（同 ADMIN_KEYSTORE_DIR 清单惯例补入）；
5. **目的限定**：底照/向量仅用于评标身份核验，禁止复用于考勤、画像等其他用途（写死在代码注释与同意书）；
6. **不外发**：全链路本地（云 API 方案被排除的原因）；liveness/比对日志只存结论与分数，不落原始帧（帧即用即弃，仅留签到照片一张）；
7. **算法备案**：企业内部身份核验场景当前不属强制备案范围；若后续面向公众服务或接入省级平台再评估；
8. **降级审计**：每次降级/人工核验都是「本人性证据弱化事件」——BidSupervisionLog 强制留痕 + 签字包披露，防止补救通道架空核验（采集了敏感数据却形同虚设 = 合规负资产）。

## 10. 演示轨（mock）

- `FACE_PROVIDER=mock`（API env）：`verify()` 按约定返回（如上传非空帧即 PASS；帧文件名含 `fail` 强制 FAIL），UI 顶部显式「演示模式·未启用真实比对」横幅；
- 仿 :17999 mock U盾中间件先例：演示能力显式标注、生产剥离；mock 轨**不得**伪造「比对通过」文案进入签字包——签字包标注「演示模式」；
- 演示账号沿用 `expert@2026` 体系，无需新种子。

## 11. 决策点

| # | 决策 | 结论（2026-09-18 用户裁定） |
|---|---|---|
| **D1** ✅ | 评标中冒名替换归属 | **仅归 :3007**：新增「评标中替换」动作（写监督日志 + 通知 :3005）；:3005 不新增在途替换入口，既有评标前替换面板维持原状 |
| **D2** ✅ | 降级审批链 | **主持人单方审批**：降级理由必填 + 监督日志自动留痕 + 签字包披露（护栏见 §6.3）；短信通道不重建（`4d224c65` 已删链路） |
| **D3** ⏳ | 阈值与上线策略 | **待定**——详见 §11.1；待确认：observe 时长/样本量、enforce 初期偏严 or 偏宽、阈值是否做调参界面 |
| **D4** ✅ | 向量存储位置 | **存 ERP 库**（source of truth）：比对时 API 取底照帧+现场帧调 provider `/verify`；CompreFace face collection 不启用（无双写漂移），性能不足再议 |

### 11.1 D3 详解：阈值与上线策略

**双阈值而非单阈值**——相似度分数要映射到三种处置，一条线不够：

```
相似度 s
  s ≥ T1            → 自动通过（FACE_PASS）
  T2 ≤ s < T1       → 环境性存疑：重试 → 降级（拍照+主持人审批，D2）→ 人工核验
  s < T2            → 本人性存疑：推 :3007 主持人研判（并排展示现场照与结论），
                      由主持人定性「重试 / 降级 / 拒签」——不做全自动拒签
```

**为什么不能抄文献数值**：绝对分数无跨模型意义——CompreFace（Facenet 系）与 InsightFace（ArcFace）的「同人」分布完全不同。T1/T2 必须在本系统「底照（注册环境）× 现场帧（签到环境）」的真实分布上标定，这是 observe 模式存在的根本原因。

**为什么 observe 起步**（两类错误的代价不对称）：
- T1 偏高 → 现场误拦：高龄专家、逆光、廉价摄像头、底照陈旧都会压低真人对分数；误拦代价 = 开标现场排队 + 主持人高频降级 → **补救通道架空核验**（合规负资产）；
- T1 偏低 → 冒名通过：功能形同虚设；
- 两害相权：D2 已定降级 1 分钟可走通（误拦成本低），enforce 启动时 **T1 应偏严**——宁误拦可补救，不放过冒名。这是降级通道的战略意义。

**observe 期收集什么**（`BidExpert.faceSimScore` 落库 + 后台聚合）：
- 真人对分布（同人多次签到/跨项目）：P1/P5/均值——T1 取「FRR ≈ 3%」分位；
- 低分样本的定性结局（实际走了重试/降级/人工）——用于定 T2；
- 活体误杀率（P1.5 上线后）与比对延迟（性能验收输入）。

**observe 退出条件（建议）**：≥30 次真实人脸比对（非种子演示）且跨 ≥3 个真实项目——或时间兜底 4 周，先到为准；样本不足不进 enforce。

**enforce 后运维**：每季度复核阈值（底照 >2 年或显著容貌变化提示重录）；T2 触发永远人工研判不自动拒签（26 号令定位人脸为**辅助**验证手段，定性权在人）；observe 可随时回切（回切写监督日志）。

**待确认三件事**：① observe 时长/样本量是否接受建议值；② enforce 初期 T1 偏严（本 spec 建议）还是偏宽（先保现场体验）；③ 阈值先 env 常量（建议）还是直接做 :3005 调参界面。

## 12. 测试与验收

- **单测**：模式闸三分支（off/observe/enforce）、faceTicket 一次性/过期、phoneVerified 列删除迁移回归（`expert-extraction.service.ts` 直写 true 残留清理——历史坑注释在案）、降级审批权限矩阵（D2 主持人单方）、revoke 删数据幂等；
- **e2e**：注册→observe 签到→enforce 签到→降级拍照→人工核验→拒签→签字包含核验行（新 e2e 套件 `face`，登录用种子专家）；
- **浏览器 QA**：:3006 向导取景交互（无摄像头降级 UI）、:3007 矩阵与审批、:3005 底照台账（chrome-devtools 流程，参照 expert-portal-visual-qa 记忆）;
- **性能**：CPU 上 1:1 比对 + 活体 < 2s/人；签到并发 5 专家不排队雪崩（Throttle 校准）；
- **验收对标**：26 号令功能清单式自检（采集生物特征能力✓、核验留痕✓、防请托技术手段✓）。

## 13. 实施批次

| 批次 | 内容 | 规模 |
|---|---|---|
| **P0 前置**（独立小批，无敏感数据）：删 face-scan-line 死动画；:3007 展示 signInMeta 照片/IP/UA；签到照片入签字包；phoneVerified 决断**已由 `4d224c65` 完成**（闸门+短信已删），剩余列删除归 P1 迁移 | 0.5~1d |
| **P1**：FaceEnrollment 迁移 + **phoneVerified 列删除** + face-verify 模块 + CompreFace 容器 + :3006 注册/签到比对（observe）+ :3005 台账/抽取校验/就绪率 | 3~5d |
| **P1.5**：liveness sidecar + enforce 灰度（§11.1 定标的 T1/T2）+ :3007 降级/人工核验/异常处置 + 评标中替换（D1） | 3~5d |
| **P2**（另行立项）：远程异地评标音视频联动、CTID/省平台对接、定位轨迹 | — |

## 14. 开放问题

1. CompreFace 社区版镜像内权重的最新分发条款（采购/上线前复核 GitHub README 与镜像 label）；
2. 集团/省水利厅对远程异地评标的落地时间表（决定 P2 优先级）；
3. 专家 U盾（供应商侧有）是否未来也承担专家身份——若引入则人脸降级为辅助证据，影响 enforce 策略权重；
4. `signInMeta` 历史数据无核验字段的兼容口径（签字包读端 null 渲染「未记录」）。
