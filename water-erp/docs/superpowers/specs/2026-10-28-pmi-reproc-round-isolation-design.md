# PMI 流标再采·第二轮隔离与重新生成（2026-10-28）

## 背景

流标重启（再采）后，PMI（项目管理）第二轮的四个步骤（采购文件/公告/专家抽取/供应商邀请）仍携带第一轮内容：编写/公告向导预填第一轮草稿、步骤分析混轮展示、专家抽取完成闸数到第一轮专家、基本信息（开标时间/采购文件获取时间）残留第一轮值。

用户裁定（2026-10-28 对话）：
- 流标多发生在开标前后，开标时间必然变化——新一轮须**重新生成**，以新的需求/立项为底；
- 第一轮内容**不隐式带入**，仅提供显式「参考上一轮」入口（A 方案），且轮次敏感项（开标/获取时间）即使参考带入也置空强制重填；
- 基本信息按轮读取（方案一）：开启第二轮时 PMI 轮次敏感字段清空，历史值快照到旧轮 BidProject，点历史轮仍可看旧值；保留集=流标决策向导 Step2 确认的基本信息。

## 现状模型

- PMI 恒定，`currentRound` 字段；`ProjectManagementStage` 按 `(pmiId, stageKey, round)` 唯一。
- 两条重启路径：PMI 侧 `reproc`（决策向导主路径：basicInfo 差异更新 + 删旧轮尾部阶段 + 建新轮阶段行，**不建 BidProject**——步骤进入时 `ensureBidProject` 懒建）；BidProject 侧 `reopenFromAborted`（旧路径：直接建 round+1 新项目行）。两路径均不清 PMI 的 `bidOpeningTime`/`documentAcquireTime`。
- `ensureBidProject(pmiId, round?)` 默认 `currentRound` ✅；但 `project-management.service` 另有 8 处裸 `findFirst({ where: { projectManagementItemId } })` 不分轮；`analyzeProjectStep` 未传轮次；`EXPERT_SELECTION` 完成闸（updateStage 内）数任意轮专家。
- 采购文件草稿 localStorage 键 `tender-write:project-drafts:v1:{pmiId}` 按 PMI 键（不分轮）；公告向导开标时间预填链 `readTenderDraftOpening` 读同一键。

## 设计（方案甲）

### 1. 数据模型

`BidProject` 新增两 nullable 列：
- `roundOpeningTime DateTime?` — 该轮 PMI 层「开标时间」历史快照
- `roundDocAcquireTime DateTime?` — 该轮 PMI 层「采购文件获取时间」历史快照

PMI `bidOpeningTime`/`documentAcquireTime` 语义收窄为**当前轮值**（轮次切换即清空）。

### 2. 重启收口：snapshotAndClearRoundTimes

私有方法（project-management.service），事务内：
1. 取当前 PMI 两字段值；若该轮 BidProject 存在 → 写入两快照列；
2. PMI 两字段置 null。

调用点：`reproc` 事务内；`bid.service.reopenFromAborted`（建新项目行后，同口径内联调用——经 PMI 侧导出或复制同逻辑，避免跨模块事务耦合，采用：bid.service 直接 prisma 双写，与主路径行为一致）。

决策向导 Step2 的 basicInfo 字段集不含这两字段，不受影响。

### 3. 后端读端分轮收口

- `resolveRoundBidProject(pmiId, round?)`：round 缺省=currentRound；替换 8 处裸查（687/1584/3658/3736/3946/5147/5235 等——已分轮的保持不动）。
- `analyzeProjectStep`（PMI 步骤分析端点）增加 `round` 查询参数；各 stage 分支按该轮解析 BidProject；前端传 `selectedStage.round`。
- `EXPERT_SELECTION` 完成闸：按 `stage.round` 解析项目后数 `bidExpert`。

### 4. 前端基本信息按轮切换

详情面板基本信息卡：
- 当前轮：读 PMI 字段（可编辑，空显示待填占位）；
- 历史轮：读该轮 BidProject 快照列（只读，空显示「—」）。数据源：bp 引用接口带上两快照列。

### 5. 草稿键轮次化 + 存量兼容

- 键改 `tender-write:project-drafts:v1:{pmiId}:R{n}`；
- 读：`R{n}` 新键 miss 且 n===1 → 回退旧键（存量不丢）；写：始终写新键；
- `readTenderDraftOpening`（公告向导预填链）同步按当前轮取键。

### 6. 「参考上一轮」入口（A 方案）

- 采购文件编写弹窗 + 公告向导：`currentRound≥2` 且上一轮草稿存在时，头部显示「参考上一轮」按钮；
- 点击：以上一轮草稿为底稿带入编辑器；**开标时间/获取时间字段置空**强制重填；
- 不点击：按第二轮 PMI 信息全新生成（生成链本就以 PMI 为底）。

## 测试

- 后端 spec：reproc 快照+清空；reopenFromAborted 同口径；EXPERT_SELECTION 闸分轮（R1 有专家 R2 无 → 拦）；resolver 缺省 currentRound。
- 前端：storage 键轮次化 R1 兼容。

## 避让与关联

- `announcement.service.ts` 曾在并行会话工作区（公告指针 round 感知已提交）——本次公告侧仅动前端向导与 project-management 域。
- 不改 `ensureBidProject` 语义（已正确）。
