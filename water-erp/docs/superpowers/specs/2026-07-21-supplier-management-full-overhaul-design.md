# 供应商管理板块全方位加固与升级 — 设计文档

- 日期：2026-07-21
- 范围：`apps/web`(:3005) 供应商管理 8 页+详情+组件、`apps/api/src/supplier*`、`apps/supplier-portal`(:3004)、相关 AI 服务
- 交付节奏：**一次性全量交付**（单一 spec，内部按 A→B→C→D 顺序实现与回归）
- UI 基准：:3005 完全遵循 `cgzxui` skill；:3004（Vue+Element Plus）不在 cgzxui 体系内，仅做可用性修复，不强行套 cgzxui

## 背景与决策

审查（四路并行代码审查 + admin/leader 双账号真实接口实测 + 9 页真实渲染截图）确认：视觉优秀、主链路真实，但含上线阻断级缺陷。三项产品/行为决策已拍板：

1. **注册闭环**＝状态查询+拦截提示：复用后端已有公开端点 `GET /supplier/register/status`，登录页/注册成功页可凭信用代码或手机号查审核进度；登录拦截到 `isActive:false` 用户时返回专用码，前端提示"待审核+查询进度"，不再泛报"密码错误"。不动 schema 的 isActive 语义。
2. **AI 边界**＝两档全做：稳妥核心 + 进取档（RAG 答疑、违约风险预测）。进取档先核查 knowledge 语料 / 评价时序数据是否就位：就位实做，不足则接好管线 + 诚实降级，**绝不造假数据/假语料**。
3. **analyzeBid**＝摘除"AI"名义，hash 模拟逻辑改名为"规则预检"，UI 明确标注非 AI 结论。

## 原则

- 后端先于前端（前端依赖新端点）。
- 每个修复带"行为契约 + 回归法"。
- 全程零 mock；错误三态（loading/empty/error）齐全。
- cgzxui 红牌：禁内联 `style`（仅留文档允许的 hairline 内联与 CSS 变量传递）、禁 `bg-white`/`rounded-full` 按钮/`shadow-lg|2xl`/块级表面 `border`。

## 工作流 A — 安全与正确性（上线阻断）

| # | 修复 | 落点 / 行为契约 |
|---|------|----------------|
| A1 | `X` 未导入崩溃 | `selection-history-dialog.tsx` lucide 导入补 `X`（已做） |
| A2 | 选取历史/分享死链 | `ai.controller.ts` 新增 `GET selection-history`、`GET selection-history/:id/shortlist`、`PATCH selection-history/:id`、`DELETE selection-history/:id`、`POST supplier-selection/share-shortlist`；复用已存在 service（含 `shareShortlist`），补 DTO + 归属守卫（创建者/admin）。实现期核实存储模型 |
| A3 | leader/staff 403 | `procurement.guard.ts` 角色集改 `Set(['admin','procurement_staff','leader','staff'])`（已做） |
| A4 | 注册闭环 | `auth.service` 登录命中 `isActive:false` 返回专用 code（如 `ACCOUNT_PENDING`）；前端登录页接 `register/status` 查询并提示；注册成功页加进度查询入口 |
| A5 | 注册资质假上传 | `Register.vue` 改走真实 `api/upload`（MinIO），存返回 URL |
| A6 | 登录硬编码账号 | 删 `Login.vue` 预填凭证（已做） |
| A7 | 评标假 AI | `analyzeBid` 去 AI 名义→"规则预检"，UI 标注非 AI |
| A8 | 自评刷分越权 | `createEvaluation` 加角色+归属校验：supplier 不得评自己/越权评他企 |
| A9 | 密码哈希泄漏 | 注册/登录响应 select 白名单剔除 `passwordHash` |

## 工作流 B — 数据完整性与健壮性

- B1 筛选失效：`listByCompleteness` 真应用 `enterpriseTypes/dateFrom/dateTo/evalLevel/qualificationStatus`。
- B2 OwnerGuard 过宽：非 supplier 不再一律放行，按端点限定角色。
- B3 详情/列表归属：`GET :id`、`/list` 对 supplier 角色加"仅本企业"。
- B4 内联 body 上 DTO：`notify`(channels 枚举+上限)、`setSupplierClassifications`(id 校验)、portal `updateContact`(替 `Partial`)。
- B5 越权状态码：`addQualification` 越权抛 `ForbiddenException`。
- B6 状态枚举校验：`PATCH :id/status` 用 `IsEnum`；停用原因改独立字段（核实 schema，无则清晰复用，不再错写 returnReason）。
- B7 submitBid 事务化：`$transaction` 包裹，失败回滚 sealed 文件；重复提交捕获唯一约束→409。
- B8 并发双审：`approve/rejectChange` 改 `updateMany where status=PENDING` 条件更新，affected=0 即冲突。
- B9 选取第5步：补后端确认同步端点 或 删误导文案（实现期定）。
- B10 详情文件上传：`fileUrl:'#'` 改真实 MinIO URL。
- B11 资质预警"已处理"持久化：入库（核实/新增 ack 模型），弃 sessionStorage。
- B12 停用/黑名单断头：补恢复/解禁端点+入口；淘汰与手动停用可区分标记。
- B13 错误三态：repository/approval/dashboard 的 `catch(()=>{})` 改 error 态 UI（参照 qualification-alerts）。

## 工作流 C — AI 深化（两档）

稳妥核心：
- C1 LLM 收口：selection/dashboardSummary/assistant 三处直连改走 `LlmService`，统一超时+AbortController。
- C2 缓存：画像/评价分析加 Redis 缓存，key=`supplierId+updatedAt+评价数` hash，评价/资质事件失效，照搬 `ai-bid-analysis/cache.service`。
- C3 选取 prompt 候选行补"均分/最佳等级/在建项目数"。
- C4 比选报告自动生成：compare-panel 加"生成比选报告"→LLM 出对比矩阵+结论+未中选理由，可归档。
- C5 驾驶舱统计改服务端查库（堵前端篡改面）。
- C6 客户端 `deriveInsights` 改名"供应结构分析（规则）"。

进取档（先核查前置）：
- C7 RAG 答疑：核查 knowledge 语料，足则接 `EmbeddingService+vector-search` 做供应商端"先自动答、疑难转人工"，不足则接管线+降级转人工。
- C8 履约违约风险预测：核查评价时序，足则对 D 级/连续低分预测违约概率+LLM 风险叙事+预警，不足则规则特征+诚实置信度。

## 工作流 D — :3005 UI cgzxui 纠偏

- 红牌扫描 8 页+4 组件，清违规内联/`bg-white`/`rounded-full`/`shadow-*`/块级 `border`。
- 每页三层结构：`.page-hero` → 工具栏卡片 → `.neu-table-card`+`.neu-table`。
- 按钮三态完整；卡片无外侧框线；补 `prefers-reduced-motion`。
- 修列表操作列按钮换行；选取向导第1步空白补引导；评价页去默认 80 分预填。
- 回归：红牌自检 + 9 页截图目视。
- :3004 仅修：忘记密码死链、401 拦截器重置 store、注册第三步联系人校验。

## 横切

- Schema：预计新增/确认 ack 模型(B11)、`disableReason`(B6)、SelectionHistory 存储(A2)；实现期对照 `schema.prisma`，必要时非交互 migration。
- 测试：补 `supplier` e2e（leader=200、自评被拒、筛选生效、状态枚举非法→400、并发双审仅一成功）；AI 缓存命中单测。
- 统一回归：admin+leader 双账号 + `X-Portal` 头 + 截图——leader 访问 timeline/documents/communications=200；selection-history=200；伪 evalLevel 返回数下降；9 页截图确认 cgzxui。

## 实现顺序

A→B→C→D。D 依赖 A/B 新组件结构；C 独立可与 B 尾段并行。
