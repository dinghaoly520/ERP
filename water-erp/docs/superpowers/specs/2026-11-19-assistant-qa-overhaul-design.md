# 水叮当 AI 问答全面改造（2026-11-19）

## 审计结论（七项不合理）

1. **提示词打架（总根源）**：SYSTEM_KNOWLEDGE 强制「总-分-结」（每段数据锚定、结尾「下一步建议动作」），与 2026-11-19 新增的「不复述/不被问不建议」正面冲突；数字引用规则三处三种表述。
2. **多轮卡片失忆**：history 只回放正文，cardsJson 不进模型上下文——追问「第三名是谁」无据。
3. **工具参数三不统一**：limit 有无/命名（limit vs topN）/钳制（1-20、1-10、无）各工具各搞各的。
4. **stripEnglish 误伤**：DeepSeek 删光、ISO9001→"9001"、小写缩写全删；白名单无单测。
5. **前端缺件**：:3011/:3008 无复制/重新生成/停止/反馈；:3005 追问按钮未移植。
6. **「给董事长」硬编码**：direct 路径对 :3008 匿名访客也称董事长。
7. **直派路径遗留**：「请调用 X 工具」前端零调用方，仅 e2e 在用——保留并标注遗留。

## 用户裁定（2026-11-19）

- **推翻「总-分-结」，改直答式**；保留集中度/拐点等洞察原则。
- P1 纳入**点踩反馈落库**；流式输出另立项。

## 改造项

### 1 · 回答规范统一重写（单一规范源）

- `system-knowledge.ts`「回答格式规范」重写为**直答式**：
  - 第一段直接回答所问（含 1-2 个关键数字）；需要展开才展开，无固定段数模板
  - 删「每段开头用一个具体数据锚定」「【结】下一步建议动作」
  - 数字引用统一口径：卡片已呈现的明细不复述；正文点名数字 ≤2-3 个；同一数字全文一次；单位照抄卡片
  - 合并 service 重要规则里的散规则（数量跟随/不归因/不推广/未被问不建议）进规范本体
- service 层两轮提示词共用同一 `WRITING_RULES` 常量（normal 第二轮「严格写作要求」与 direct 第二轮同源），消除两路径质量不对称
- 「给董事长」→ 角色中性表述（「面向用户」）

### 2 · 多轮卡片记忆

- chat() 组装 history 时：assistant 消息带 cardsJson → 附加紧凑摘要（每卡 title + 前 3 行键值；仅最近 2 条带卡消息；单条摘要 ≤400 字），标记为「（上轮数据卡：…）」
- 纯文本追加进该条 content（不改存储、不改回放渲染）

### 3 · 工具参数规范化

- 所有清单/排行类 action 统一 `limit`：钳 1-20、默认 10（cockpit savings 保持 1-10 缺省 5 的既有口径不动）
- `supplier.top` 的 `topN` 改名 `limit`（旧参兼容）
- description 统一格式：`args: { action: "…", …, limit? }`，limit 语义一句话
- 涉及：announcement(list)、bid(list/risks/active)、notification(list)、expert(list/search/by_specialty)、supplier(list/pending/top)

### 4 · stripEnglish 加固 + 单测

- 白名单补：字母数字混合标识（ISO9001、A4、PM2.5、380V、kV/kW/mm/km/kg）、小写文件扩展名（pdf/docx…）、常见缩写（API、CA、APP、OK、ID、IP、OA）
- 新增 `strip-english.spec.ts` 锁定：SWHI-TP-2026102003、GB/T 43711、U盾、ISO9001、A4纸、PM2.5、380V、小写 pdf、DeepSeek（普通英文词仍剥——技术名词由提示词层避免，清洗只兜残留）

### 5 · :3011 聊天四件套

- **复制**：答案卡右上复制钮（mobile 自建 `lib/copy-to-clipboard.ts` 副本，execCommand 降级）
- **重新生成**：助手答案尾部「重新生成」chip——重发同题（服务端新增消息，非覆盖）
- **停止**：发送中发送键变停止钮（AbortController；`@water-erp/client` api 传 signal；中断后不落库半截回答——沿用请求取消=事务放弃语义）
- **追问按钮**：移植 :3005 FollowUpButtons 思路——数据类回答尾部给 2-3 个上下文追问 chip（前端本地生成，不新增后端）

### 6 · 点踩反馈落库

- Prisma 模型 `AssistantFeedback`：id / userId? / guestKey? / conversationId / messageId / rating(UP|DOWN) / comment? / createdAt；唯一约束 (messageId, userId|guestKey) 防重复提交（同消息可改评：upsert 覆盖）
- 端点：`POST /assistant/feedback`（AnyRole；属主校验同会话隔离）；`GET /assistant/feedback/mine`（前端回显）
- 前端：:3011 答案卡尾部 👍/👎（lucide ThumbsUp/ThumbsDown），点踩可选弹一句可选补充（留 P2，先只落 rating）
- 迁移：`prisma migrate dev --create-only` → `db execute` → `resolve --applied`（本库漂移口径）

### 不做（明确出界）

- 流式输出（SSE）——另立项
- function calling 替代文本 TOOL_CALL——另立项评估
- :3008 前端改造——本次仅后端受益（规范/记忆/清洗/参数），:3008 四件套待后续对齐

## 验收

1. 单测：strip-english.spec、assistant.service.spec（规范重写后同步）、受影响工具 spec 全绿
2. e2e 手测（leader）：「节资排行前三」直答式无建议段；追问「第三名节约多少」能答（卡片记忆生效）；「公告列表给我 3 条」limit 生效
3. :3011：复制/重新生成/停止/追问四件套真机走通；点踩落库可查
4. tsc/lint 全绿；mobile-cockpit e2e 不回归
