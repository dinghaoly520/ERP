# 专家评标「评标室口令 + 评标窗口隔离」设计

日期：2026-09-20
状态：**待审核**（方案 A + 同时段冲突治理合并稿）
前置：单设备登录已上线（946e128a，后登顶替语义）；专家口令=档案 idNumber（演示统一 18个1）

## 1. 背景与问题

1. **冒名登录残余缺口**：单设备互踢是「后登顶替」——冒名者登录反而把真专家踢下线，双方反复互踢（拉锯战），等效对真专家做拒绝服务；且若冒名者先登录、真专家离屏，冒名者独占会话。口令泄露时技术无法区分真假，唯一裁定层=现场主持人——系统职责是**让冒用企图立刻暴露并拦在工作区外**，而非静默对抗。
2. **同时段多标无约束**（2026-09-20 审计实锤）：
   - `expert.service.ts:229` listProjects 返回全部 OPENING/EVALUATING 记录，门户可同屏两「进行中」；
   - 抽取候选（`expert-extraction.service.ts:62`）无在评排除——L79 include 了其他项目派单但**从未使用**（死代码遗迹）；
   - `availability='占用'` 全库无自动写入（纯手工标记，无生命周期）；
   - `signIn`（`expert.service.ts:414`）无跨项目检查——同日两标可同时段双活跃。
3. **合规口径（用户裁定）**：同时段冲突不允许；**同日不同时段允许**（一天评两标合法）。

## 2. 核心概念：评标窗口（单一定义，四处复用）

```
评标窗口开 ⇔ BidExpert.signedIn=true && reportConfirmed=false && project.stage ∈ {OPENING, EVALUATING}
```

- 开于**签到**、闭于**本人确认评审报告**——不以 ARCHIVED 为界（完整归档是 :3005 文书收尾，签字闭环+回流可能滞后数小时，以它为界会把同日第二标误杀）。
- 工位锁定（闸4）、运行时闸（闸2）、展示收口（闸3）、抽取硬闸（闸1）全部使用同一窗口定义，避免多处口径漂移。

## 3. 方案总览：四闸一密一告警

```
冒名者登录 ──► 闸4 工位锁定：开窗期新登录 409 拒绝（踢不动真专家）
                └─► 告警：拒绝即监督日志高风险 + admin 通知 + :3007 矩阵徽章
冒名者已持有会话 ──► 密 评标室口令：无口令进不了工作区（文档/评分/报告全锁）
                    └─► 爆破 3 次锁 10 分钟 + 高风险告警（现场即暴露）
同日双标排期 ──► 闸1 抽取硬闸（开窗专家不出现在候选池）+ 闸2 运行时闸（签到/启动评标拦截漂移）
真专家换设备 ──► 阀门：主持人矩阵「解除登录锁定」（理由必填+留痕）；本人确认报告自动解锁
展示层 ──► 闸3：已确认报告的卡片移「已完结待归档」，同屏两个"进行中"消失
```

## 4. 机制细节

### 闸 1 · 抽取硬闸（`expert-extraction.service.ts`）

候选查询（L62）where 增加：

```prisma
BidExpert: { none: { reportConfirmed: false, project: { stage: { in: ['OPENING', 'EVALUATING'] } } } }
```

- 同时**删除 L79 死 include**（`bidExperts: { where: { projectId: { not: projectId } } }`——从未使用的遗迹）。
- **同日预告（信息级，不阻断）**：候选若已有派单项目的 `openTime` 与本项目同日 → 候选对象标注 `sameDayConflict: true`，进 LLM 上下文与抽取结果展示，供主持人权衡（合规允许同日，只提示时段安排风险）。
- `availability` 字段不动（保留管理端手工停用语义），不引入占用状态机——窗口即占用，派生不自存。

### 闸 2 · 运行时闸（防「计划不冲突、执行漂移」）

| 端点 | 行为 |
|---|---|
| `signIn`（expert.service:414，签到=开窗动作本身） | **硬阻断**：该用户在其他项目有开窗 → 409 `EXPERT_WINDOW_CONFLICT`（错误体带冲突项目名/编号） |
| `startEvaluation`（bid.service:1970，幂等早退 L1979 之后插入） | **硬阻断**：本项目任一专家存在跨项目开窗 → 409 + 冲突名单（未开窗才准启动） |
| `startOpeningInternal`（bid.service:1533） | **不阻断，warn**：开标时刻公告既定、专家尚未签到，冲突可在启动评标前化解——监督日志 warn + admin 通知给化解窗口 |

### 密 · 评标室口令（roomCode）

**数据**（挂 BidProject，评标期生命周期，非开标会话）：

| 字段 | 说明 |
|---|---|
| `BidProject.roomCode String?` | 8 位随机（去混淆字符集，无 0/O/1/I） |
| `BidProject.roomCodeAt DateTime?` | 生成/轮换时间（版本戳） |
| `BidExpert.roomVerifiedAt DateTime?` | 本人通过校验时间；**`roomVerifiedAt >= roomCodeAt` 即有效**——轮换自动全员失效重验，无需清列 |
| `BidExpert.roomAttempts Int @default(0)` | 连续错误计数（成功清零） |
| `BidExpert.roomLockedUntil DateTime?` | 爆破锁定截止 |

**生成与轮换**：
- `startEvaluation` 时自动生成（新项目默认启用）；
- :3007 矩阵对**任意在评项目**提供「生成/轮换评标室口令」（存量 EVALUATING 项目如 hero 演示项目，主持人一键启用——**roomCode 为空 = 闸门不生效 = 存量/演示零破坏**）；
- `archiveAll` 完整归档时置 `roomCode=null`（防历史泄漏），`roomVerifiedAt` 保留作审计。

**校验**（新端点 `POST /expert/projects/:id/room-code/verify`，bid_expert + 本项目成员）：
- 正确 → 写 `roomVerifiedAt=now`，清 attempts；
- 错误 → attempts+1；**连续 3 次锁 10 分钟**（lockedUntil），锁内校验直接 409 `ROOM_CODE_LOCKED`；
- 每次失败/锁定 → 监督日志 `riskFlag='高风险'` + admin 通知 + 矩阵徽章。

**执行点**（expert.service 新 helper `assertRoomUnlocked(project, expertRow)`，在下列方法入口调用）：
- 阶段=EVALUATING **且** project.roomCode 非空 **且** 未验 → 401 `ROOM_CODE_REQUIRED`；
- 覆盖：解密标书文档（`documents/:supplierId`）、AI 辅助数据、评分草稿/提交、报价历史、澄清件、报告确认；
- 放行：`tender-document` 招标原文（开标前物料）、签到流程（口令生成晚于签到——评标室口令管「评标」，不管「开标」）。

### 闸 4 · 工位锁定（终结拉锯战）

**登录链**（`auth.controller.ts` 登录端点，`cookiePortal === 'expert'` 分支、`rotatePortalSession` 之前）：

```
role=bid_expert && 存在开窗 && User.webSessionId 非空
  → 409 ACCOUNT_EVALUATING「评标期间账号已锁定，如需更换设备请联系主持人解除」
```

- **拒绝而非顶替**——真专家的会话不可被踢，冒名者每次尝试都失败并告警；
- 开窗但 `webSessionId` 为空（已被主持人释放）→ 正常放行（重新建立会话）；
- **与已上线互踢的关系**：评标**外**（无窗）维持现状后登顶替（自助换设备）；评标**中**=先占锁定。`SESSION_REPLACED` 遮罩/心跳机制不变（冻结、评标外踢人仍复用）；
- `login` 热路径成本：仅 bid_expert 角色增加一次聚合查询（开窗检查），其他角色零开销。

**释放阀门**：
1. 主持人矩阵「解除登录锁定」（新端点 `POST /bid/projects/:id/expert-verification/:expertId/release-login-lock`，@Roles bid_host/admin，reason 必填≤200）= 清 `User.webSessionId` + 监督日志「登录锁定解除」；旧会话随 sid 判空自然失效，专家重新登录即恢复；
2. 本人确认评审报告 → 窗口闭合 → 自动解锁（同日第二标正常登录）；
3. **不做**心跳宽限自动解锁——现场模型主持人可及，少一个状态机（决策记录）。

### 闸 3 · 展示收口（:3006 首页）

- 「进行中评审」卡片条件收紧：`stage ∈ {OPENING, EVALUATING} && !(signedIn && reportConfirmed)`；
- 已 `reportConfirmed` 未归档 → 新分组「已完结待归档」（卡片置灰、仍可进只读回看）；
- 展示是表象治理，安全边界靠闸 1/2/4。

### 告警通道（统一）

冲突阻断 / 登录锁定拒绝 / 口令错误 / 口令爆破锁定 → 四路齐发：
`BidSupervisionLog(riskFlag='高风险')` + NotificationService 站内通知全部 admin + :3007 评标管理矩阵高风险徽章（复用既有 onChanged/30s 轮询刷新）+ 操作日志自然留痕。

## 5. 前端改动

| 端 | 文件 | 内容 |
|---|---|---|
| :3006 | `evaluate/[id]/page.tsx` | 工作区门页：`stage=EVALUATING && 有口令 && 未验` → 口令输入卡（neu 风格，8 位输入 + 错误提示 + 锁定倒计时）；验证通过进向导；口令轮换后（roomCodeAt 变化）下次数据加载自动回门页 |
| :3006 | `(app)/page.tsx` | 进行中/已完结待归档分组 |
| :3006 | `login/page.tsx` | 409 `ACCOUNT_EVALUATING` 以表单内错误呈现（登录未成功，不适用遮罩） |
| :3007 | `components/workspace/evaluation-view.tsx` | 主持人区：评标室口令展示（大字可读）+ 生成/轮换按钮；专家行：解除登录锁定按钮（理由弹窗，样式复用手动确认弹窗）；高风险徽章（冲突/爆破） |

## 6. 测试计划

**e2e（jest，沿用自建用户/项目模式）**：
1. 闸1：专家在项目 A 开窗 → 项目 B 抽取候选不含该专家；
2. 闸2：signIn 跨项目开窗 409（错误体含冲突项目名）；startEvaluation 阻断含名单；startOpening 仅 warn 日志；
3. 密：无 roomCode 放行（存量兼容）；正确通过；错 3 次锁 10 分钟（409 ROOM_CODE_LOCKED）；轮换后 roomVerifiedAt 失效重验；
4. 闸4：开窗期登录 409 ACCOUNT_EVALUATING；release-login-lock 后放行；无窗互踢回归（既有 expert 互踢 e2e 不破）；
5. 闸3：reportConfirmed 卡片分组（API 层断言 listProjects 返回，前端逻辑简单信任）。

**单测**：窗口判定函数、口令字符集/生成、attempts/lock 计数、assertRoomUnlocked 分支。

**回归**：api tsc + 全量单测 + auth/operation-log/ai-bid e2e；schema 校验（`prisma validate`，协作规则：迁移与 schema 同 commit）。

## 7. 决策记录

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 同时段窗口边界 | 签到起 → 报告确认止（非 ARCHIVED） | 归档是文书收尾会滞后，以它为界误杀同日第二标 |
| 2 | 口令生效条件 | roomCode 非空才启用闸门 | 存量/演示项目零破坏；启用权在主持人（现场裁量） |
| 3 | 口令生成点 | 启动评标自动 + 矩阵可轮换 | 新流程默认安全；在评存量可补开 |
| 4 | 工位锁定语义 | 开窗=先占拒绝，无窗=后登顶替 | 终结拉锯战 DoS；保留评标外自助换设备 |
| 5 | 解锁阀门 | 主持人按钮 + 报告确认自动；不做心跳宽限 | 现场主持人可及，少一个状态机 |
| 6 | 防爆破 | 3 错锁 10 分钟 + 高风险告警 | 冒用企图当场暴露给主持人 |
| 7 | startOpening 冲突 | warn 不阻断 | 开标时刻公告既定，冲突可在启动评标前化解 |
| 8 | availability | 不做自动占用状态机 | 窗口即占用（派生不自存），避免状态漂移 |
| 9 | 招标原文 | 口令闸放行 | 开标前物料，评标室口令只管「评标」 |
| 10 | swapExpertRole 进场复查（P2-4 2026-09-21） | 候补→正选前查跨项目窗口，开窗 409 | 与闸1同口径；派单在开标前、开窗可能在派单后 |
| 11 | signIn 并发 TOCTOU（P2-5 2026-09-21） | 预检（冲突优先于照片闸，原行为）+ 事务内权威复查（User 行锁 FOR UPDATE）与写入原子化 | 双检消竞态，单一入口双开窗不可能 |
| 12 | ABORTED 阶段口令闸（P2-6 2026-09-21） | 流标后闸门保持；verify 允许 ABORTED（未验者可补验）；rotate 仍限 EVALUATING | 评标终止后物料不裸奔，已验专家访问不受影响 |

## 8. 边界与风险

- `schema.prisma` 为并行会话高危共享文件——编辑前确认对方工作区干净，迁移与 schema 同 commit（协作规则 3/6）；
- roomCode 在 :3007 的可见性限 bid_host/admin（leader/staff 看矩阵但不看口令明文——按现行矩阵权限收敛，待实施时核对 `getExpertVerification` 返回分叉）；
- `login` 热路径新增查询仅 bid_expert 分支；`signIn`/`startEvaluation` 各一次聚合查询，量级=项目专家数（≤7），可忽略；
- 演示口径：hero 项目（EVALUATING、无口令）行为完全不变；演示评标室口令时主持人在矩阵一键生成；
- WS 不新增事件：门页/徽章靠既有 30s 轮询 + 数据加载时序（与 P2 处置闭环同口径）。
