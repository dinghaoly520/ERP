# 端到端测试问题清单（草稿）— 2026-08-17

测试项目：竞价采购公告 — 引大济岷工程千隧ZK10和千隧ZK12钻孔施工技术服务（BID-1786934256839 / JJ-2026081702）
测试路径：:3005 项目+公告直建 → :3004 三家投递 → :3005 开标确认 → :3007 开标大厅 → :3007 启动评标+AI → :3007 澄清/异议 → :3006 专家评标（进行中停止）

## 已确认问题（按严重度）

### P1 · AI 投标分析失败（已临时修复）
- 现象：启动评标后 AI 任务 TENDER_PROCESSING 两次失败（11:57-12:01），LlmService 报「LLM 返回内容无法解析为 JSON 格式」，任务 FAILED。
- 根因：`apps/api/.env` DEEPSEEK_MODEL=deepseek-v4-flash 对 tender-extractor 的 chatJson 提示词返回非 JSON。
- 临时修复：改为 deepseek-chat 并重启独立 worker（kill 564112/564113 → nohup 重启），:3007「重新分析」重触发后正常进入 ANALYZING / 逐家分析。
- 建议：a) 评估 deepseek-v4-flash 的 JSON 输出能力或给 tender-extractor 换提示词/加 markdown 代码块容错；b) chatJson 失败重试后应显式置 FAILED 并提示（已做），但前端 AI 卡片应直接给出可操作的「重新分析」按钮（已验证有）。

### P1 · 「引用采购文件」发布不生成加密 BidDocument（招标文件断链）
- 现象：公告发布向导勾选「引用采购文件 1 份」后，BidDocument 表无记录，招标文件仅以普通 AnnouncementAttachment 存在。导致：AI 提取得分点报 TENDER_NOT_READY（AI 提取按钮无任何可见反馈）、供应商端无加密招标文件。
- 根因：`announcement-publish-wizard.tsx` ensureTenderAttached → `attachFromObject`（/attachments/from-object 普通附件），而 meta.selectedTenderObjectKey 后端无人消费。
- 绕过：:3005 公告详情页编辑态手动「加密上传」招标文件（docx→pdf 转换 450KB，AES-256）后，AI 提取与供应商端下载均恢复。
- 建议：发布向导应直接走 POST /announcements/:id/bid-document 创建加密 BidDocument。

### P1 · 专家通知 0/5 失败（消息空 400）
- 现象：专家抽取向导「发送通知并邀请确认」5 次 POST /expert-admin/extract/notify 全 400；UI 显示「通知部分成功：成功 0 名，失败 5 名」。
- 根因：DTO ExtractionNotifyDto.message @IsNotEmpty，前端在话术未生成时提交 message:""。
- 绕过：回上一步点「AI 生成」填充话术后重发成功（UI 状态变「已通知」）。
- 建议：前端发送前校验 message 非空（或服务端允许空 message 走默认模板——service 已有默认文案逻辑但被 DTO 拦截）。

### P2 · 评分标准发布校验与「价格分按报价公式」提示矛盾
- 现象：价格评审项 maxScore>0 且无得分点时，发布按钮报「每个打分项至少 1 个得分点」，但行内提示「价格分按报价公式,无需提取得分点」；AI 提取（E5）也跳过 PRICE。三者口径不一致，用户只能手工加占位得分点。
- 建议：发布校验对 PRICE 项豁免（价格公式引擎在评标时计算），或统一文案。

### P2 · 唱标录入报价单位预填疑义
- 现象：唱标对话框「报价（元）」预填供应商提交值「148.5」（万元），单位不换算；需人工改为 1485000。三家均如此。
- 建议：预填时按供应商 bidPrice 单位换算或标注单位。

### P2 · 会场交流「在场名单（0）」与实况不符
- 现象：供应商已在开标大厅在线且成功收发公聊，:3007 ExchangeDrawer 显示「在场名单（0）·暂无供应商在线」。

### P3 · 监督时间线重复条目
- 现象：开标异议处理在时间线出现两条相同记录（11:51:32 ×2）。

### P3 · 专家抽取向导「已通知」状态与实际不符
- 现象：第一轮发送失败（0/5）后，UI 步骤 3 即显示「已通知」；第二轮成功前状态已翻转，无重试语义区分。

### P3 · 公告直建 PMI 阶段链 UI 断裂
- 现象：N16 补记 1-5 COMPLETED 但 EXPERT_SELECTION 仍 NOT_STARTED，详情区 step6「待解锁」、step7「尚未解锁」，无法从流程卡推进；开标确认面板只能靠深链 `?panel=bid-confirm` 打开（面板本身可用，供应商/专家/评分标准/开标决策均正常）。
- 建议：N16 直建补记时把 EXPERT_SELECTION 一并置 IN_PROGRESS（currentStage=BID_EVALUATION 与阶段记录口径不一致）。

### P3 · 直建项目产生第二个 PMI（JJ-2026081702），手动项目 JJ-2026081701 成为孤儿
- 现象：从手动项目详情发布公告时，公告直建逻辑新建 PMI（1702）并关联 BidProject；手动项目 1701 无 BidProject，仍留在列表（当前阶段「专家抽取」）。用户视角「项目 A 里发公告生出项目 B」。
- 建议：直建时应回填/复用发起项目（若其尚无 BidProject）。

### P3 · 供应商邀请通知 toast 计数 ×2
- 现象：候选 3 家，「一键通知」toast 显示「已通知 6 家供应商」。

### P3 · 公告模板占位符未替换
- 现象：供应商端公告详情显示 `{{最高限价1}}`、`{{公示期限1}}`、`{{开标时间}}`、`请填写工期及进度要求`、`电子邮箱：请填写联系邮箱` 等未渲染占位。
- 关联：发布向导 Step1 的工期/联系邮箱为「待补充」，发布前未强制补全。

### P3 · 供应商邀请名单未回填 PMI 详情区
- 现象：邀请向导确认 3 家后，详情区「参与的供应商」仍「待补充」，步骤分析「尚未完成供应商邀请」；但开标确认面板却能显示 3 家（编辑 3 家）——两处数据源不同步。

### P3 · 专家抽取向导候补未落 BidExpert 表
- 现象：候补抽取 4 人（雷丛菜/马苏轶/张涛/王静雅）「确认并通知候补专家」后，BidExpert 表无 expertRole=候补 记录；Notification 表亦无候补通知。

### P4 · 公告直建后供应商端项目编号显示 JJ-2026081701（手动 PMI 号）而 BidProject 关联 PMI 为 1702
- 现象：供应商详情「项目编号 JJ-2026081701」+「PMI JJ-2026081702」并置，口径不一。

### P4 · AI 提取耗时与无反馈
- 现象：BidDocument 就绪后 AI 提取得分点耗时约 80s 才弹窗；未就绪时无任何提示（静默失败）。建议 loading 态 + 失败 toast。

### P4 · 唱标后供应商「确认」列状态跳变
- 现象：第十二地质大队提出异议未确认，异议被处理后解密列表「确认」列直接显示「已确认」，与开标记录「异议已处理」状态并存，来源未明示。

### P4 · 会场交流在场名单计数、通知计数、监督重复条目等均为小口径问题，建议随修。

## AI 投标分析（最终验证 ✅）
- 重触发后：TENDER_PROCESSING → ANALYZING → 3 家 COMPLETED（3 ok, 0 failed，12:22:43），综合报告 + DOCX 生成（fileId=cmswq9vfa0008uu0kg48zbmhb，MinIO）。
- :3007 AI 卡片「3/3 家 分析完成」；:3006 辅助评标展示 AI 总分/风险/合规门/资格条款/证据链哈希/OCR 结构化数据。
- 观察：a) 三家 riskLevel 均 high、总分 41/42/42（同档偏严，建议核对风险阈值/评分尺度）；b) AI 提取第四地质大队报价 1,538,998 元、工期 90 日历天，与唱标 1,498,000 元/70 日不一致（AI 可能错取限价或响应有效期字段，需核对提取口径）。

## 最终状态（停止点）
- stage=EVALUATING；评分标准已发布（5 项 100 分，25 个 AI 提取得分点 + 2 手工）；3 家供应商 submitted；5 正选专家 confirmed，2 已签到；李自繁 2/3 家供应商打分草稿（96/100×2，未提交）；BidEvaluationResult=0（未生成评标结果）；评标签字 tab 未解锁；开标文件包已回传 :3005「资料已接收·下载」。符合「专家正在评标」停止点。

## 环境问题
- OCR 与 procurement 系统共用 :8100 单 worker，42.7MB/160 页 PDF 批处理排队明显（首个 PDF OCR 约 15 分钟），AI 逐家分析总耗时约 20 分钟（观察中）。

## P1 修复记录（2026-08-17 已修）
### P1a · chatJson 按 DeepSeek 官方 JSON mode 规范加固（api-docs.deepseek.com/guides/json_mode）
- 根因确认：deepseek-v4-flash 是**思考模型**——`reasoning_content` 非空、`message.content` 偶发为空（官方已知问题），旧代码只读 content → 空串解析失败（worker 日志 raw content 为空）。
- 修复（apps/api/src/local-ai/llm.service.ts）：
  1. deepseekRequest 解析 `reasoning_content` 与 `finish_reason`；content 空且 reasoning 非空时回退取后者；
  2. chatJson 系统提示追加 "Return only valid JSON, no Markdown fences, no extra text."；
  3. 空 content / finish_reason=length 截断 → 抛 retryable 错误走 withRetry 重试；
  4. parseJson 围栏剥离容忍任意位置 + 首 `{` 尾 `}` 截取兜底。
- 验证：v4-flash 冒烟一次通过（HTTP 200, finish_reason=stop, 合法 JSON + reasoning_content 并存）；74/74 单测通过；.env DEEPSEEK_MODEL 已切回 deepseek-v4-flash；独立 worker 已用新构建重启。

### P1b · 「引用采购文件」自动生成加密 BidDocument
- 修复：
  1. `bid-document.service.ts` 新增 `attachFromObject()`（从 MinIO 对象读取源文件 → docx 转 PDF → 加密 → FileAsset + BidDocument，与 upload 同链）；
  2. `announcement.service.ts` create() 在 BID_NOTICE 发布时消费 `metadata.selectedTenderObjectKey` 调用 attachFromObject（失败仅告警不阻塞发布）；syncBidProject 两个分支均回填 bidProjectId；
  3. 发布向导补传 `selectedTenderFileName`/`selectedTenderMimeType`。
- 验证：tsc 通过、announcement 单测 10/10。（端到端可在下次新建项目时验证——现有项目已用手动补传方式修复。）

### P1c · 专家通知空 message 400
- 修复：ExtractionNotifyDto.message 改 @IsOptional（service 已有默认文案兜底 `message || 您已被选为…`）；sendExtractionNotify 签名同步 `message?: string`。

## 通过项（关键路径）
- :3005 手动建项目（AI 解析采购文件自动提取项目概况 ✅）
- 公告发布向导（模板渲染/限价大写/结构化字段）✅
- N16 公告直建 BidProject + 自动补最小 PMI（projectReason 标注）✅
- :3004 三家供应商下载（BidDocument 补挂后可见）+ 加密投递（48.6MB 大文件）✅
- :3005 主持人指派（陈源远 bid_host）✅
- 专家智能抽取 6 步（AI 配额/随机抽取/AI 定组长/代确认/候补）✅（通知环节除外）
- 评分标准：应用模板 + AI 提取得分点 25 项 + 发布 ✅
- 按时开标 → OPENING ✅
- :3007 开标大厅：组建会话/单条+批量解密 3/3/唱标 3/3/供应商签到确认 3/3/开标异议提出→处理/会场公聊双向/监督视图时间线/完成开标·移交（文件包 JSON+回传 :3005「资料已接收·下载」）✅
- :3007 启动评标 → EVALUATING，专家匿名编号、评标时限 72h ✅
- 澄清答疑：发起→供应商侧可见→书面来函回复记录→已回复 ✅
- 专家异议：专家 :3006 提交→:3007 裁决（采纳并回复）✅
- :3006 专家：签到拍照留痕降级（无摄像头直接签到）/保密/纪律/AI 声明/回避声明/标书获取（3 家已解密）/辅助评标降级提示/条款核对/打分草稿（李自繁 2 家 96/100 草稿，未提交）✅
- 评分期间专家匿名（专家 1-5）✅
- 监督时间线全程留痕 ✅
