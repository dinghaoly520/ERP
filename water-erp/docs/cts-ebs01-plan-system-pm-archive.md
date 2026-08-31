# CTS-EBS01 合规计划 · 系统/项目管理/流程/归档专项

> 范围：仅管理系统侧。线上交易链（公告/发标/投标/开标/评标/定标/异议/保证金）不在本计划，见 cts-ebs01-remediation-plan.md。
> UI 原则：:3005 侧栏固定不动，全部新界面进现有面板（PMI 详情页签 / 数据库页 / 供应商管理页 / 专家管理页）。

## W1 项目与招标项目管理（A-36~40、A-46）

**现状锚点**：PMI（ProcurementProject，status + PROJECT_WORKFLOW_STAGES 阶段流 + LOCKED_STAGES 锁定）→ BidProject（projectManagementItemId 挂 PMI，round 多轮）；创建人隔离 + 公司隔离已有。

| 措施 | 落点 | 对应检测点 |
|---|---|---|
| PMI 加递交/受理留痕：submittedAt/By、approvedAt/By 四字段 + submit/approve 端点；立项阶段完成时自动写入 | project-management 模块增量 | A-36/37「递交」 |
| 三级结构声明：PMI=项目、同 PMI 多 BidProject=招标项目/标段；BidProject 加 sectionNo/sectionName 展示字段（轻量标段化，不建新表） | schema + PMI 详情关联列表 | A-38/39/40 |
| 关联信息查看核验：PMI 详情已聚合 workspace/bid 列表，补时间轴（见 W3-A-204） | 核验+补 | A-46 |

## W2 任务计划与团队（A-47~49）

**现状锚点**：work-arrangements 是个人工作台视角（非项目计划）；assignedHostUserId 已有单点指派。

1. **A-47 项目计划实体**：新 `ProjectPlanItem`（PMI 关联、工作内容/责任人/起止节点/权重/状态）；UI 进 :3005 PMI 详情「计划」页签；与 work-arrangements 打通（计划条目可生成工作安排）
2. **A-49 计划审核闭环（★★★）**：ProjectPlanItem 聚合状态 draft→submitted→approved/rejected + 审核人/时间留痕；驳回可改再提（复用 supplier 审核的状态模式）
3. **A-48 团队分工（★★）**：新 `ProjectTeamMember`（PMI、userId、role：负责人/技术/商务/监督、duty）；主持人指派已有，并入团队视图

## W3 信息资源库（A-202~226）

### 招标项目库（A-202~204）
- A-202 查询 ✓（projects 列表）
- **A-204 项目时间轴**：PMI 详情加统一时间轴视图（PMI 阶段时间 + BidProject deadline/openTime/公示/归档时点聚合）
- **A-203 标段-中标关联查询**：数据库页（/dashboard）加「项目-中标结果」联查视图（winner 在 BidSupplier/WIN_NOTICE）

### 投标人库（A-212~216）
- A-212 查询 ✓、creditCode @unique ✓、normalizedName 查重 ✓
- **A-213 奖惩考评**：SupplierPerformance 扩展 reward/punishment 类型条目（或加 SupplierRewardPunishment 表——推荐扩展现有表）
- **A-214 统计分析**：数据库页加供应商统计卡（注册趋势/中标率/履约达成）
- **A-215 黑名单管理流**：BLACKLIST status + disableReason/eliminatedAt 已有 → 补拉黑审批+原因必填+解除+全程 operationLog 留痕，入口在供应商管理页
- **A-216 职业资格人员**：SupplierContact 加 personnelType（法人/项目经理/持证人员）+ 证书字段

### 专家库（A-217~224）
- A-217 CRUD ✓、A-220 随机抽取 ✓、A-221 考评数据 ✓（ExpertEvaluation/ExpertMemo，补管理界面）
- **A-218/222 状态机与留痕**：ExpertProfile 加 status（待审核/在库/暂停/退库）+ verifiedBy/verifiedAt（现仅 availability + retiredAt）
- **A-219 回避单位列表**：建 ExpertAvoidOrg（或 system-config 配置），抽取时 employer 匹配拦截
- A-223 自荐：**决策项**（做 expert-portal 自荐表单，或豁免声明）
- A-224 推荐入库：外部推送 → 豁免/外部依赖

### 价格库（A-225~226）
- A-225 ✓（catalog+ContractPrice+PriceAlert）；**A-226 统计报表**：分类均价/价格走势，进数据库页

### 豁免（D-2）
A-205~211 招标人/代理机构信息库 —— 自建平台定位声明豁免。

## W4 存档归档（A-200/201 + 电子档案 2.1.18）

**现状锚点**：BidArchiveItem（ownerRole 分类 + hashDigest + fileHashes 指纹链 + ArchiveStatus）+ 归档签字闸门 + archive-summary + operation-log 全局拦截器。

1. **A-200 档案查阅台**：:3005 新增跨项目档案检索面板（项目/类别/时间/关键词；admin/leader + 本公司范围）——现 archive-summary 是单项目视角
2. **A-201 档案管理**：档案号编目规则（项目号-类别-序号）、目录清单 DOCX 导出（复用 project-management/docx 转换器）、整包下载
3. **电子档案四性**：真实性=hashDigest/integrity-stamp ✓、完整性=fileHashes ✓、可用性=归档格式长期可读（PDF/DOCX）声明、安全性=权限+encryptionKeyId → 出「四性检测报告」模板，随归档自动生成
4. **移交清单**：归档完成时自动生成移交清单 DOCX
5. **保存期限**：SystemConfig 配置（短期/长期/永久），scheduler 到期提醒（不自动删除）

## W5 系统与非功能（A-25~33、4.5~4.12）

### 注册与账号（A-25~33）
- A-25 协议：register 页核验协议勾选 + 协议版本号留痕（ AgreementVersion 记录）
- A-26/27/28 唯一性与留痕 ✓（creditCode @unique、SupplierApprovalRecord）
- **A-30/31 状态机锁**：核验 supplier-portal 资料更新端点——PENDING 待验证期间必须禁改；验证通过后修改须重新走审核（改 supplier 模块 update 路径加 status 校验）
- A-33 机构状态控权 ✓（BLACKLIST/停用拦截业务）

### 非功能自声明（4.7~4.12）
| 项 | 素材（现成） | 待补 |
|---|---|---|
| 4.7 性能 | docs/ops-scaling.md | 一次压测记录 |
| 4.8 安全 | audit + operation-log + RBAC 7 角色 + 公司隔离 + 加解密体系 | 安全自查报告；核补口令策略/会话超时 |
| 4.9 可靠性 | db-backup.md + bid-backup 模块 | 备份演练规程 + 一次演练记录 |
| 4.10 易用性 | — | 自声明文本 |
| 4.11 运行环境 | docker-compose | 环境清单表 |
| 4.12 文档 | docs/ + ACCOUNTS.md | 用户/运维/部署三册手册 |

### 数据项与接口（4.5/4.6，为对接做准备）
- 代码侧先做**数据项导出**：按《检测技术规范》5.3/5.4 清单出 JSON schema + 导出端点（新 `public-platform/` adapter，stub 落盘）
- 正式数据交互证明 = 公共服务平台联调（外部依赖，商务线）

## 节奏与决策项

```
W1+W2（~2 周）→ W4（~1 周）→ W3（界面多，~2 周可穿插）→ W5 文档线贯穿
```
决策项：① 标段三级结构按声明映射（默认）还是要真包件业务；② 专家自荐做还是豁免；③ 奖惩记录扩展 SupplierPerformance（推荐）还是新表。

---

## 执行进度

### ✅ W1-1 PMI 递交/受理留痕（2026-08-24 完成）
- 迁移：`20260824184000_pmi_submission_review`（定点迁移，存量漂移禁用 migrate dev）
- Schema：ProjectManagementItem + reviewStatus/submittedAt/By/reviewedAt/By/reviewComment；User 反向关系 ProjectSubmittedBy/ProjectReviewedBy
- API：POST :id/submit-review、POST :id/review（ReviewSubmissionDto）；PmiOwnershipGuard 放行 leader 的 /review 路径
- 校验：重复递交/角色/自审分离/驳回理由 四道闸；单测 submission-review.spec.ts 9/9
- UI：列表卡片+详情页状态徽章（待审核/审核通过/已驳回）、详情页「递交审核/审核通过/驳回(带理由)」操作
- curl 矩阵：7 步全过（含留痕姓名回读：申报=CTS临时测试 受理=采购中心管理员）
- 备注：leader 在 1C 隔离下只见本人项目，实际受理由 admin 承担（服务端保留 leader 能力）

### ✅ W1-2 标段（包）字段（2026-08-24 完成）
- 迁移：`20260824191500_bid_section_fields`（定点）；BidProject + sectionNo/sectionName
- UpdateBidProjectDto + updateProject 透传；实测 PATCH 200 回读 SG-01/第一标段
- 三级映射声明：PMI=项目、BidProject=招标项目/标段、ProcurementRound=重新招标轮次（写入 D-2 声明素材）

### ✅ W1-3 A-46 关联信息查看（核验通过）
- PMI 详情聚合 workspace/bid-project（GET :id/bid-project，开标确认面板宿主）——已存在，无需改动

**W1 遗留到 W2 一并做**：sectionNo 在开标确认面板/工作台的展示位（随 W2 计划页签统一做 UI）

### ✅ W2 任务计划与团队（2026-08-24 完成，A-47~49）
- 迁移：`20260824193000_project_plan_team`（定点）；新模型 ProjectPlanItem / ProjectTeamMember
- 新模块 `apps/api/src/project-plan/`：计划条目 CRUD + **整包报审/受理**（submitPlans/reviewPlans，双人留痕+自审分离+驳回理由，复用 A-36/37 模式）；团队增删改；`GET /project-plan/users` 候选人端点
- 锁定规则：SUBMITTED/APPROVED 条目禁改禁删（PLAN_LOCKED）——已通过条目调整后须重新报审
- UI：详情页 hero 下新增「任务计划与团队」区块（project-plan-section.tsx）：条目+状态徽章、报审/受理/驳回(理由)按钮、团队角色徽章；侧栏未动
- 验证：单测 10/10；curl 矩阵全绿（含 DUPLICATE_MEMBER/PLAN_LOCKED/REJECT_REASON_REQUIRED）；UI 实机 5 张截图（添加→报审→受理→团队）
- 修正记录：责任人/成员数据源从 /bid/hosts 换为模块自带 /project-plan/users（hosts 面向主持人过窄）

### ✅ W4 存档归档（2026-08-25 完成——盘点为主，基座已由 2026-08-24 会话落地）
**盘点结论**（DA/T 103-2024 基座，8 文件/11 端点）：
- 卷台账（A-200）：GET /archive/items 组合查询（导出状态/项目状态/关键词）+ 操作审计链（username/role/method/时间）
- 四性检测：check/check-latest（10 项细则，实测 7 过 3 失=未走完流程的正常缺料）
- ASIP 导出/包下载（A-201 编目目录在包内「其他」目录承载）+ 移交接收登记表纸电关联（登记表打印→签章→扫描回传）
- 保管期限 retention（永久/Y30/Y10）+ 范围表 35 条（附录B 全量种子）
- scheduler：scanArchiveDeadlines 到期预警（次年 3/31 移交要求）+ 通知链接直达
- UI：/archive 页面（427 行）+ 侧栏入口
**本次增量**：projects 页头加「归档管理」第二入口（Link，便于从项目管理直达）
**验证**：curl 全绿（台账1卷/四性201/retention200/审计链含实时PATCH记录/范围表35条）+ 实机截图 2 张（入口/台账页）；retention 测试值已还原

### ✅ W3a 投标人信息库（2026-08-25 完成，A-213/215/216 + 核验 A-212/214/204）
- 迁移：`20260825100000_supplier_repository_fields`（定点）：SupplierPerformance + recordType/recordNote/effectiveDate；SupplierContact + personnelType/certTitle
- API（supplier 模块 5 端点）：blacklist/unblacklist（原因必填+审核完结才可拉黑+乐观锁+供应商通知，role=admin/leader）、records 录入/列表（奖惩复用 SupplierPerformance）、contacts/:contactId/personnel 标注
- UI（供应商详情页）：黑名单改走专用端点（带校验/通知）；**新增 BLACKLIST 状态「解除黑名单」入口**（原先只有拉黑无解除）；联系人 tab +人员类别/执业证书两列+标注工具条；新增「奖惩记录」tab（列表+录入表单）
- 核验已满足项：A-212 查询✓（repository 页）、A-214 统计✓（supplier/dashboard 洞察卡）、A-204 时间轴✓（project-stage-timeline 含各阶段 completedAt）
- 验证：curl 12 步全绿（403 角色拦截/REASON_REQUIRED/ALREADY_BLACKLISTED/解除恢复/奖惩校验/人员标注回读）+ UI 实机 4 截图（联系人/奖惩录入/拉黑后/解除后，解除后 DB 状态实测回 APPROVED）；数据已还原
- 待办（W3b）：A-203 项目-中标联查视图（dashboard 页）；三星项：ExpertProfile 状态机+审核留痕（A-218/222）、回避单位列表（A-219）、价格库统计报表（A-226）

### ✅ W3b 联查视图 + 专家库状态机（2026-08-25 完成，A-203/A-218/222 + 核验 A-217/219/220/221）
- A-203（★）：数据库页新增「项目中标结果」面板（award-result-panel.tsx：编号/名称/方式/中标供应商/合同金额/阶段，过滤 awardedSupplier）
- A-218/222（★★★）：迁移 `20260825140000_expert_profile_status`（定点）：ExpertProfile + entryStatus(PENDING/ACTIVE/SUSPENDED/RETIRED)/statusNote/verifiedById/verifiedAt，存量 ACTIVE、retiredAt 非空者标 RETIRED
- API：PATCH expert-admin/:id/status（admin/leader；退库必填事由、审核入库记 verifiedBy/At 留痕、退库联动账号停用、恢复联动重激活）；抽取过滤 3 处联动 entryStatus==='ACTIVE'
- UI：专家库 repository 页 +「入库状态」列（四态徽章）+ 状态操作按钮（审核入库/暂停/退库/恢复，prompt 事由）
- 核验已满足：A-217 录入✓（POST expert-admin）、A-219 回避✓（抽取过滤 employer 比对，expert-admin.service:1019 区）、A-220 随机抽取✓、A-221 考评✓（履职评价+evaluations/stats）
- 验证：curl 矩阵（403/退库无事由 400/暂停/恢复留痕/退库联动停用/恢复重激活）+ UI 实机 3 截图（A-203 表含中标人、状态列、UI 暂停→恢复 DB 实测 ACTIVE）；临时数据全还原
- 修复记录：DTO 'RETIVED' typo、恢复时账号未联动重激活——均由 curl 矩阵暴露并修复复验
- W3 剩余（三星可缓）：A-226 价格库统计报表；A-223 自荐（决策项）

**W3 主体完成。剩余：W5 非功能自声明素材（文档线）。**

### ✅ W5 自声明素材包（2026-08-25 完成）
- 核验通过无需开发：A-25 协议勾选（register 页已有）、A-30/31 待验证禁改（supplier-portal.service.ts:410「仅已入库可提交变更」）、A-33 状态控权
- 产出 `docs/cts-ebs01-self-declaration/` 10 篇：六项自声明素材（4.7~4.12，代码事实映射+待办清单）、D-2 豁免声明（含三级结构映射/PDF 版式声明）、D-3 管理制度映射、4.5/4.6 数据项对接准备、D-4 试运行安排
- 申报前硬待办（已列入各文件）：一次压测记录、一次恢复演练记录、三册手册、口令复杂度核验、省平台商务发函

**—— 系统/项目管理/流程/归档专项（W1~W5）全部完成 ——**

### ✅ 申报前硬待办清零（2026-08-25）
- 口令强度策略：统一校验器（≥8 位含字母数字）应用于注册×3 + 改密，弱口令实测 400
- **修复昨日遗留 7 个编译错误**（tsc 默认报错仍产 JS + 管道退出码检查漏洞所致）：含 sendToUser 两参调用真 bug（黑名单通知此前实际未发出）——已修复并实测通知写入 DB；构建门禁改 tsc --noEmit
- 压测记录实测入档（4.7 附录：≤50 并发 p95<60ms，100 并发现拐点）；限流改为 THROTTLE_LIMIT 可配置（默认 120/分不变）
- 恢复演练实测入档（4.9 附录：131 表 0 错误，RTO 参考 ≤30min）
- 三册手册落档 docs/manuals/（部署/运维/用户）
- 剩余唯一非代码事项：省公共服务平台商务发函 + 选 3 个真实项目启试运行计时

### ✅ 逻辑审查修复（2026-08-27，审查报告 4 项 P0/P1 全闭环）
1. **专家退库恢复链修复**：confirmRetire 同步 entryStatus=RETIRED（两退库路径收敛）；恢复以 retiredAt 兜底判断，联动还原 availability='可用' + 账号激活——实测两路径退库→恢复后「可被抽取=true」
2. **专家录入默认待审核**：手工录入/批量导入 entryStatus=PENDING，「审核入库」后 verifiedBy/At 首次入库留痕（A-218 闭环）
3. **计划通过条目解死锁**：APPROVED 条目可调整（UI 加调整按钮），调整即降回 DRAFT 清审核留痕重新报审（A-07/A-49 语义）；SUBMITTED 仍锁定
4. **PMI 递交生命周期闸**：API 收口——非 ACTIVE（已归档/回收）项目递交报 INVALID_LIFECYCLE
- 测试 21/21 过（含新增生命周期闸/降级用例）；修复过程顺带发现并消除"旧进程持旧 dist"的验证陷阱（重启后须核对进程启动时间）
- 待拍板项（未动）：#5 PMI 待审锁定字段范围、#6 立项通过→采购文件硬联动、#7 中标结果从交易链自动回写

### ✅ 拍板项落地（2026-08-27，#5/#6/#7）
- **#5（拍板：不锁定）**：PMI 待审期间字段保持可修改——自建平台审核定位为留痕制，不对标 A-06 严格锁止（差异口径已记入 D-2 声明素材）
- **#6（立项硬闸）**：updateStage 完成 INITIATION 须 reviewStatus=APPROVED（INITIATION_NOT_APPROVED）——「立项批准后才能采购」从 AI 提示升级为硬控制；小采购（无立项阶段）与已越过该阶段的存量不受影响。spec 4 用例 + 实机造数验证（未审核 400 → 通过后 200 过闸，现场已还原）
- **#7（定标自动回写）**：deliverAwardLetter 发出中标通知书后，经 PMI.bidProjects 反查宿主台账并回写 awardedSupplier（幂等：值一致跳过；失败不阻断通知书；手工值仍可兜底）——A-203 联查视图数据源由双头手工维护转为交易链自动同步。spec 1 用例（不一致回写/一致跳过）
- 回归：bid.service 350 + 专项 76 = **426/426 全过**；tsc 0 错误；服务已重启（进程时间核对）

**—— 逻辑审查 4+3 项全部闭环，专项无遗留代码待办 ——**

### ✅ 走查缺陷修复（2026-08-27 下午，步骤检查错位 + 时间轴 A-204 数据错乱）

**① 步骤检查跨步骤错位覆盖（:3005 项目详情）**
- 现象：「采购需求」步骤下出现「审批合规/文件审批流程 警告」——该检查项属于「采购文件」步骤（后端各阶段规则与缓存本就正确，DB 核对无误）。
- 根因（前端 `project-detail-panel.tsx`）：LLM 步骤检查耗时可达数分钟；用户在等待期间切换步骤后，**在途旧响应无条件 `setComplianceAudit` 覆盖新步骤的展示**（实测该项目「采购文件」审查跑 3 分钟，期间切回「采购需求」即被覆盖）。
- 修复：`runComplianceAudit`/`loadAnalysis`/`loadStepAnalysis`/上传后分析回填统一加**迟到响应守卫**（seq ref：响应到达时序号过期则只入缓存不动展示；`handleStageAttachmentChanged` 的闭包快照 `isCurrentStage` 换实时 ref 判定）。
- 验证：实机复现原场景（采购文件「重新检查」长请求中立即切回采购需求，240s 轮询）→ 全程无跨步骤覆盖；tsc 0 错误。

**② 时间轴（A-204）开标/截止/获取时间错乱**
- 现象：立项 3/18 · 开标 3/18 · 投标截止 8/28 · 采购文件获取「未登记」。
- 根因（时序错位，两个）：(a) BidProject 懒创建（14:03）早于采购文件 AI 提取（14:32）——创建时 `bidOpeningTime` 尚未提取 → openTime 落 fallback=立项日、deadline 落兜底 now+24h，此后**永不回填**；(b) `documentAcquireTime` 存 AI 提取的中文区间文本（「2026年03月23日09:00至…」），timeline 用 `new Date()` 解析失败 → 显示「未登记」。
- 修复：
  - 上传采购文件（TENDER_DOCUMENT 附件）即同步 `documentAcquireTime`（为空才写，上传时刻、中文格式；AI 提取到精确时段后覆盖）——2026-08-27 用户拍板；
  - AI 提取 `bidOpeningTime` 成功后**回填对齐同轮 BidProject**（仅 DOWNLOAD/SUBMIT 未开标前）：openTime=提取值、deadline=openTime−24h（复用 P0-2 口径 `BID_DEADLINE_BEFORE_OPENING_MS`）；
  - `timeline.service` 的字符串时间解析换 `parseFlexibleDate`（中文格式 + 区间文本取起点）。
- 存量数据修正：该项目 BidProject openTime 3/18→3/23 14:00、deadline→3/22 14:00（对齐提取值−24h）。
- 验证：timeline 端点与 :3005 实机截图均显示 立项 3/18 · 截止 3/22 · 获取 3/23 · 开标 3/23；上传同步经实机验证（NULL→「2026年08月27日14:58」）后测试附件已删、原值已还原。timeline spec 5/5。
- ⚠️ 提交说明：`project-management.service.ts`/`project-detail-panel.ts` 混有并行会话（回收站限时 M1 等）未提交改动，本批改动未单独提交，待对方提交后一并处理。

**③ 时间轴展示精度（2026-08-27 追加，用户反馈）**
- 采购文件获取是**时段**：`TimelineNode` 增加 `timeEnd`，`parseDateRange` 解析区间文本（"2026年03月23日09:00至2026年03月26日15:00"）取起止；前端显示"2026/3/23 09:00–3/26 15:00"（同日只补时分、同年省终点年）。上传同步写入的单点值 → 无终点、显示单点。
- 有时刻语义的节点一律带时分（投标截止/开标 14:00）；纯 00:00（立项日）只显日期。
- **时区口径修复**：Prisma `timestamp without time zone` 裸值被驱动按 UTC epoch 读出，`toISOString()` 直转会让前端（本地解析）+8h——立项 00:00 显成 08:00、开标 14:00 显成 22:00（旧版只显日期恰好未跨天而掩盖）。新增 `toIsoFromBare`（裸值按本地折算），五处 Prisma Date 节点统一；与 parseFlexibleDate/parseDateRange 的本地构造口径一致。spec 断言改为时区无关写法。
- 实机验证（:3005）：立项 2026/3/18 · 截止 2026/3/22 14:00 · 获取 2026/3/23 09:00–3/26 15:00 · 开标 2026/3/23 14:00；timeline spec 6/6、tsc 0。

**④ 步骤检查区块从 :3005 项目详情移除（2026-08-27，用户拍板）**
- 删除 `project-detail-panel.tsx` 中每个步骤下的"步骤检查"UI（标题/重新检查按钮/审查总结/逐项结果）及其全部支撑代码（compliance state/缓存/runComplianceAudit/上传·删文件后的合规刷新/`auditStageCompliance` 引用）；同时移除今晨为它加的迟到响应守卫（已无消费者）。
- 保留：后端 `POST /project-management/:id/audit-compliance` 端点、阶段合规规则（含 /admin/compliance-rules 配置页）、"文件分析/步骤分析"区块、时间轴（A-204）。
- 验证：实机两个类型步骤（采购需求/供应商邀请）均无"步骤检查"且页面无破损、无 pageerror；tsc 0（仅并行会话 business-tag-review 的 dayjs 缺依赖报错，与本批无关）。
