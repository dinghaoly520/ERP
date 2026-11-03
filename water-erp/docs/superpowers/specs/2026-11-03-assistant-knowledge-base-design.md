# 水叮当知识库（:3005）——用户上传资料 RAG 赋能 设计文档

日期：2026-11-03 ｜ 状态：已评审（用户批准）

## 1. 背景与目标

:3005 水叮当助手目前仅用静态系统知识与数据工具回答，无法引用用户自有的制度文件、
项目资料等。本设计为 :3005 水叮当新增「知识库」能力：

- 头部右上角「知识库」按钮 → 管理面板，用户上传自己的资料（pdf/doc/docx/txt/md）
- 上传可见性两档：**仅自己**（默认）/ **所有人**（:3005 全体登录用户可检索）
- 对话**自动检索**（RAG）：提问时从「自己的 ∪ 共享的」知识库检索最相关片段注入
  上下文，回答引用并标注来源文件

范围限定：**仅 :3005 水叮当面**（chat-panel）；:3008 匿名助手与 :3011 移动端不入本版。

## 2. 方案选型

**采用：复用现有 Knowledge 模块**（`apps/api/src/knowledge/`）——知识库 CRUD、
文件上传/解析（pdf-parse/mammoth，支持 pdf/doc/docx/txt/md）、文本分块、pgvector
向量库、向量检索服务（`VectorSearchService`）全部现成，`KnowledgeBase` 模型
（`ownerId` 归属 + `isShared` 共享）与两档可见性语义完全对齐，**零表结构改动**。
招标文件审查（tender-review）与本功能共用同一套基础设施与嵌入服务（vLLM bge-m3）。

否决：独立「个人资料」表（重复建设管线）；纯附件挂载（长文档爆上下文、无检索语义）。

## 3. 数据与权限

- `KnowledgeBase.ownerId` = 创建者；`isShared=false`（仅自己）/ `true`（所有人）
- 维护权（建库/传文件/删文件/重建索引/删库）：**创建者 + admin**（沿用 `assertEditable`）
- 检索权：自己的库 ∪ `isShared=true` 的库；**他人私有库绝不进入检索集**（`OR: [{ ownerId: me }, { isShared: true }]`）
- 上传入口开放给 :3005 全部内部角色（leader/staff/admin/bid_host——与水叮当数据
  工具的 INTERNAL_ROLES 口径一致）；匿名访客（:3008）无本功能

## 4. 后端改动

### 4.1 对话 RAG 注入（核心新增，assistant.service）

`chat()` 认证用户提问路径中、调用 LLM 之前：

1. 检索集 = 用户自己的（ACTIVE）库 ∪ isShared=true（ACTIVE）库；为空 → 跳过
2. `EmbeddingService.embed([question])` → 各库 `VectorSearchService.search(question, kbId, topK=5)`
   （跨库取并集后按相似度取前 5）
3. 命中片段拼入 LLM 上下文：「【用户知识库资料——回答时优先参考，引用时注明来源文件】
   [文件名] 片段内容…」；回答末尾附「参考知识库：文件A、文件B」
4. **降级铁律**：无库/无命中/嵌入或检索抛错（含 vLLM 未启动 503）→ 静默按普通流程
   回答，对话**永不**因 RAG 失败而报错；仅 warn 日志留痕

注入点选择：`handleNormalChat` 与知识问答路径共用的 LLM 请求组装处（统一一处，
避免三条 tool 路径各自接入）。

### 4.2 上传嵌入失败降级（knowledge.service 小改）

现状：上传管线中 `embedding.embed` 失败 → 整体抛「文本嵌入失败」。改为：

- 文件照常存 MinIO、解析、分块；`KnowledgeFile` 与 `DocumentChunk` 照建
  （`embedding` 列为空——向量列 nullable）
- 响应携带 `indexed: false` + 提示「已保存；嵌入服务未运行，恢复后请在知识库面板
  点『重建索引』」（reindex 端点已有）
- 检索天然不命中无向量分块，无脏数据风险

### 4.3 聚合查询端点（新增，knowledge.controller）

`GET /knowledge/assistant-overview` → `{ mine: [{id,name,isShared,files:[{id,fileName,fileSize,chunkCount,createdAt}],fileCount}], shared: [同构] }`
（按 ownerId / isShared 分组；仅 ACTIVE；@AnyRole 登录即可，写操作仍走既有端点与
`assertEditable` 闸）。前端管理面板单请求取数。

## 5. 前端改动（apps/web）

### 5.1 入口按钮

`components/assistant/chat-panel.tsx` 头部（full 模式「新对话/收为小窗」按钮组旁）
新增「知识库」按钮（BookOpen 图标，`asst-page-header-btn` 同款）；mini 小窗不放入口。

### 5.2 知识库管理面板（新组件 assistant/knowledge-panel.tsx）

- 两分组：我的知识库 / 共享知识库（共享组只读——检索可见，维护按钮仅本人库显示）
- 建库：名称 + 可见性单选（仅自己 / 所有人）
- 库卡：文件列表（名称/大小/分块数/时间）、上传（accept .pdf,.doc,.docx,.txt,.md，
  ≤50MB，`neu-drop-zone` 拖放样式）、删除文件、重建索引、删除库（二次确认）
- 上传响应 `indexed:false` → toast 提示嵌入服务未运行
- 样式：cgzxui（neu-table-card / neu-btn / workbench-input / wb-section-rule）

## 6. 错误处理汇总

| 场景 | 行为 |
|---|---|
| 对话时 vLLM/向量库异常 | 静默降级普通回答，warn 日志 |
| 上传时嵌入失败 | 存件不索引，`indexed:false` + 提示重建索引 |
| 上传解析失败（损坏文件） | 400「文档解析失败」（原行为） |
| 超大小/类型不符 | 前端拦截 + 后端 FileInterceptor 限 50MB |
| 删库/删文件 | 二次确认；DocumentChunk 级联（既有 onDelete: Cascade） |

## 7. 测试

- 后端单测：chat 注入（有库命中→上下文含片段与来源标注；他人私有库不入检索集；
  嵌入抛错→降级不阻塞且不抛出）；上传嵌入失败降级（文件/分块落库、indexed:false）；
  assistant-overview 分组与权限
- 前端：tsc + 组件渲染冒烟（按钮存在、面板分组）
- 手工验收路径：vLLM 启动后上传→提问引用；vLLM 停机上传→提示重建→启动后 reindex→可检索

## 8. 里程碑外（不做）

:3008/:3011 入口；知识库内全文搜索；共享范围按公司细分（当前「所有人」=平台级，
系资料主主动公开，与业务数据公司隔离口径不冲突）；对话中临时关闭某库。
