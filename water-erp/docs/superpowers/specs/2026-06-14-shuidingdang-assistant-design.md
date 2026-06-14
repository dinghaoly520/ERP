# 水叮当智能助手设计方案

日期：2026-06-14

## 1. 背景与目标

在 `water-erp` monorepo 中新增独立门户 `apps/assistant`，作为“水叮当智能助手”的专用入口。该助手面向董事长使用，不做账号体系与权限体系，默认拥有最高业务视角；但涉及数据修改的动作仍必须通过确认机制，避免误操作。

产品目标：

- 以 GPT / DeepSeek 式中央搜索框作为入口，用户可以自然语言提问。
- 助手理解智慧水发·招采 ERP 的全部门户、模块、流程、角色和业务数据。
- 能查询、分析、总结、绘图，并能通过受控工具准备和执行数据操作。
- 前端视觉参考 `/Users/qihao/Desktop/Paper` 项目的轻玻璃化、蓝青系、智能写作工作台气质，同时适配 ERP 的工业精密设计 DNA。

## 2. 产品定位

“水叮当智能助手”是董事长级全局智能入口，不是普通后台页面。它应帮助董事长快速了解系统整体态势、业务风险、项目进展、供应商画像、商城经营情况，并能生成汇报材料或执行受控业务动作。

典型问题：

- “最近有哪些招采项目存在风险？”
- “统计本季度采购金额和节约率，画趋势图。”
- “把待审批供应商按风险排序。”
- “帮我归纳今天需要关注的开评标事项。”
- “准备一份集团招采运行情况汇报提纲。”

## 3. 总体架构

采用“后端集中式 Agent + 工具层”方案。

```text
董事长输入问题
  ↓
apps/assistant 前端调用 /api/assistant/chat
  ↓
apps/api Assistant Agent
  ↓
系统知识 + 业务工具 + DeepSeek provider
  ↓
查询 / 分析 / 生成操作预案
  ↓
返回文本 + 图表 + 表格 + 引用 + 待确认动作
  ↓
前端聊天区与右侧分析画布展示
```

### 3.1 前端：`apps/assistant`

职责：

- 展示 GPT 式中央指挥台首页。
- 展示聊天工作台、流式/加载状态、历史消息。
- 渲染文本回答、指标卡、图表卡、表格卡、引用来源、操作预案卡。
- 在需要时展开右侧分析画布。
- 对中高风险操作展示确认 UI。

建议端口：`3008`。

### 3.2 后端：`apps/api/src/assistant`

职责：

- 统一调用模型 provider，第一版使用 DeepSeek。
- 注入 ERP 系统知识。
- 按工具调用真实业务数据。
- 返回结构化响应，避免前端解析不稳定文本。
- 对业务操作执行“预案 → 确认 → 执行 → 记录日志”。
- 持久化会话、消息和操作日志。

## 4. 页面与交互设计

### 4.1 首页初始态

采用“中央指挥台”布局：

1. 顶部品牌识别：`水叮当智能助手 / SHUIDINGDANG AI`。
2. 主标题：`董事长，今天想了解什么？`
3. 居中大输入框：支持自然语言输入。
4. 快捷能力入口：
   - 董事长驾驶舱
   - 全系统数据问答
   - 招采风险扫描
   - 供应商画像
   - 商城经营分析
   - 业务操作助手
   - 汇报材料生成
   - 今日重点事项

### 4.2 对话工作台态

用户发送第一条问题后，页面进入工作台状态：

- 中间为聊天流，显示用户问题和助手回答。
- 回答可包含关键结论、表格、图表、引用来源和操作预案。
- 右侧分析画布按需滑出，用于展示当前问题关联的指标、趋势图、明细和预案。

### 4.3 操作确认态

当用户要求“修改、审批、归档、发布、禁用、退回”等数据操作时：

1. 助手先生成操作预案。
2. 前端展示操作对象、字段变化、影响范围、风险等级和确认按钮。
3. 用户确认后调用后端确认接口。
4. 后端执行并返回结果与日志编号。

## 5. 后端智能体设计

### 5.1 模型 Provider

定义可插拔模型接口：

```text
AssistantModelProvider
  ├─ DeepSeekProvider
  └─ FutureProvider...
```

第一版使用 DeepSeek，环境变量建议：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

模型密钥只保存在后端，前端不直接调用模型 API。

### 5.2 系统知识层

后端维护结构化系统知识，第一版可放在 `assistant/knowledge/system-knowledge.ts`。内容包括：

- 系统名称与定位。
- 所有门户与端口。
- 主要业务模块：采购、招标、供应商、专家、公告、通知、上传、商城、AI 审查。
- 核心流程：采购立项 → 审批 → 发起招标 → 下载 → 投标 → 开标 → 评标 → 归档。
- 常见状态、角色、术语和风险解释。

### 5.3 工具层

模型不直接访问数据库，而是通过可控工具获得数据或准备操作。

首批工具分组：

- 全局工具：系统概览、今日重点事项、待办/风险聚合、跨模块搜索。
- 采购工具：项目列表、项目详情、状态分布、金额/预算/节约率、待审批和异常项目。
- 招标工具：项目阶段、报名/投标、开评标、归档、专家评分、澄清、监督日志、异常分析。
- 供应商工具：状态、分类、资质、评价、风险画像、待审核排序、退回/禁用等操作预案。
- 专家工具：专家池统计、专业方向分布、参与项目、评分行为和异常评分提示。
- 公告与通知工具：公告查询、发布状态统计、公告摘要、通知重点。
- 商城工具：商品、订单、供应商、采购需求、价格走势和结构分析的基础能力。

### 5.4 操作工具与风险控制

操作按风险分级：

- 低风险：生成摘要、生成建议、标记关注。
- 中风险：修改字段、退回供应商、更新公告草稿。
- 高风险：审批通过、禁用供应商、归档项目、发布公告、删除数据。

中高风险操作必须先生成 `AssistantActionLog` 的 pending 记录，经确认接口确认后才执行。

## 6. API 设计

### 6.1 发送对话

```http
POST /api/assistant/chat
```

请求：

```ts
{
  conversationId?: string
  message: string
  context?: {
    activeCanvasId?: string
    selectedEntity?: {
      type: 'procurement' | 'bid' | 'supplier' | 'expert' | 'announcement' | 'mall'
      id: string
    }
  }
}
```

响应：

```ts
{
  conversationId: string
  answer: string
  cards: AssistantCard[]
  citations: AssistantCitation[]
  pendingActions: AssistantActionPlan[]
}
```

### 6.2 会话历史

```http
GET /api/assistant/conversations
GET /api/assistant/conversations/:id
```

### 6.3 确认与取消操作

```http
POST /api/assistant/actions/:id/confirm
POST /api/assistant/actions/:id/cancel
```

确认响应：

```ts
{
  status: 'success' | 'failed'
  message: string
  auditId: string
}
```

## 7. 数据模型

新增 Prisma 模型：

```prisma
model AssistantConversation {
  id        String   @id @default(cuid())
  title     String?
  messages  AssistantMessage[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model AssistantMessage {
  id             String   @id @default(cuid())
  conversationId String
  role           String
  content        String
  cardsJson      Json?
  citationsJson  Json?
  createdAt      DateTime @default(now())

  conversation AssistantConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
}

model AssistantActionLog {
  id             String   @id @default(cuid())
  conversationId String?
  actionType     String
  status         String
  targetType     String?
  targetId       String?
  payloadJson    Json
  resultJson     Json?
  riskLevel      String
  createdAt      DateTime @default(now())
  confirmedAt    DateTime?
  executedAt     DateTime?
}
```

第一版不绑定 `userId`，后续如果接入权限体系再补充。

## 8. 前端结构

建议文件结构：

```text
apps/assistant/
  package.json
  next.config.ts
  src/app/
    layout.tsx
    page.tsx
  src/components/
    assistant-home.tsx
    chat-workspace.tsx
    prompt-box.tsx
    quick-actions.tsx
    message-list.tsx
    assistant-card.tsx
    analysis-canvas.tsx
    action-plan-card.tsx
  src/lib/
    api.ts
    types.ts
  src/styles/
    globals.css
```

卡片类型：

```ts
type AssistantCard =
  | { type: 'metric'; title: string; value: string; trend?: string }
  | { type: 'chart'; title: string; chartType: 'line' | 'bar' | 'pie'; data: unknown }
  | { type: 'table'; title: string; columns: Column[]; rows: unknown[] }
  | { type: 'actionPlan'; title: string; riskLevel: string; changes: unknown[] }
```

图表第一版使用规范化数据结构，不让模型直接输出任意 ECharts 配置。

## 9. 后端结构

建议文件结构：

```text
apps/api/src/assistant/
  assistant.module.ts
  assistant.controller.ts
  assistant.service.ts
  dto/
    chat.dto.ts
    confirm-action.dto.ts
  model/
    assistant-model-provider.ts
    deepseek.provider.ts
  knowledge/
    system-knowledge.ts
  tools/
    assistant-tool.ts
    tool-registry.ts
    global-overview.tool.ts
    procurement.tool.ts
    bid.tool.ts
    supplier.tool.ts
    expert.tool.ts
    announcement.tool.ts
    notification.tool.ts
    mall.tool.ts
  actions/
    action-planner.service.ts
    action-executor.service.ts
  serializers/
    assistant-card.serializer.ts
```

## 10. 错误处理

前端：

- 模型超时：显示“水叮当正在整理数据，请稍后重试”。
- 工具失败：说明具体数据源暂不可用。
- 空数据：显示空状态，不展示假数据。
- 操作失败：展示失败原因和建议下一步。
- 操作未确认：不执行，只保留预案。

后端：

- 模型失败：返回统一错误格式。
- 工具异常：尽量局部降级，除非该工具是回答必须项。
- 数据操作：使用事务。
- 高风险动作：没有确认记录不执行。
- 模型输出解析失败：降级为纯文本回答。

## 11. 测试策略

API 单元测试：

- 会话创建与消息持久化。
- 工具返回结构化卡片。
- 操作预案不直接执行。
- confirm 后才执行。
- 模型 provider 可 mock。
- 工具异常时返回可理解错误。

API E2E：

- `POST /api/assistant/chat` 返回会话 ID。
- 查询系统概览能返回真实 seed 数据。
- 操作确认接口能更新数据并写日志。
- 取消操作不会修改数据。

前端验证：

- 首页中央指挥台布局。
- 发送消息后进入对话态。
- 图表、表格、指标和操作预案卡片渲染。
- 操作预案确认/取消。
- 错误与空状态。
- 构建通过。

## 12. 第一版范围

必须实现：

- `apps/assistant` 独立门户，端口 `3008`。
- 共享配置增加 assistant 端口和 URL。
- 根命令增加 `dev:assistant`、`build:assistant`。
- `/api/assistant/*` 接口。
- DeepSeek provider 抽象。
- 系统知识与首批业务工具。
- 操作预案、确认、取消和日志。
- 会话与消息持久化。

暂不实现：

- 登录、账号、权限体系。
- Word/PDF 报告导出。
- 语音输入。
- 多模型 UI 切换。
- 任意 SQL 查询。
- 任意数据库直改。
- 供应商/专家/商城端复用入口。

## 13. 验收标准

功能验收：

- 打开 `http://localhost:3008` 能看到“水叮当智能助手”中央指挥台首页。
- 输入“汇总当前系统招采运行情况”后，助手返回文字摘要、至少 3 个指标卡、至少 1 个图表卡和引用来源。
- 输入“列出供应商风险最高的前 5 个”能返回真实 seed 数据。
- 输入“把某个供应商标记为退回”时，不直接执行，而是生成操作预案。
- 点击确认后，后端执行并写入日志。
- 历史会话可查询。
- DeepSeek 不可用时，页面显示明确错误，不出现假数据。
- `pnpm build:assistant` 和 `pnpm --filter api test` 通过。

设计验收：

- 页面不像传统后台，保持 Paper 的轻盈智能感。
- 组件细节遵循 ERP 的工业精密风格：1px 分割线、蓝青/冰蓝层次、克制动效、非 emoji 图标、清晰的数据密度。
- 初始态聚焦搜索框，对话态按需展开分析画布。

## 14. 风险与控制

1. 全量覆盖过大  
   通过工具注册分层控制，先让所有模块有基础查询，再逐步增强复杂分析。

2. 模型误操作数据  
   模型只能生成预案，执行必须走后端确认接口。

3. 图表数据不稳定  
   后端工具返回规范化 chart data，前端负责渲染。

4. 无账号但具备高权限能力  
   默认董事长专用入口，仍记录会话与操作日志，高风险动作必须确认。

5. 前端风格冲突  
   首页吸收 Paper 的轻玻璃智能感，组件细节遵循 ERP 的工业精密设计 DNA。
