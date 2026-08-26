# CTS-EBS01-2016 合规完善任务计划

> 依据《电子招标投标系统交易平台认证技术规范》（CTS-EBS01-2016）对标结论制定。
> 目标路线：先补齐一星（★）硬缺口 → 二星（★★）无纸化 → 三星（★★★）优化项与外部依赖并行推进。
> 总则：每项验收 = 单元 spec + 重启 :4001 后 curl 矩阵 + :3005/:3020 实机截图（Swhi-CGZX-01/abc123）。

## P0 一星硬缺口（立即开工，无外部依赖）

### P0-1 业务规则硬控制引擎（附录 B ★ 项）
**检测点**：B-002~006/009/011/012/018/020/021/026/027/028/031/033/047
**现状**：`opening-deadline.util.ts` 已示范「校验→BadRequestException(code)」模式；`stage-compliance-rules.ts` 与 tender-review `rule-executor` 均为提示词级/文件审查级，无交易环节硬拦截；`Announcement` 发布时 publicityEnd 3 日公示已自动计算（announcement.service.ts:240）。
**措施**：
1. 新建 `apps/api/src/compliance/` 模块：
   - `compliance-rules.ts`：声明式规则表 `{ id:'B-004', hook:'announcement.publish', severity:'block'|'warn', validate(ctx) }`
   - `compliance.guard.ts`：`assertCompliance(hook, ctx)` 统一入口，失败抛 `BadRequestException({error, code:'COMPLIANCE_<ID>'})`
   - 豁免留痕复用 audit 模块（operationLog 记录 override 人/时间/理由），不建新表
2. 挂点（既有 service 方法首部插入 assert）：
   - `announcement.service.ts` 发布：B-004（发售开始→开标 ≥20 日，依法必招项目）、B-009（发售期 ≥5 日）、B-002（平台地址字段非空）
   - `bid.service.ts` open/complete-opening：B-018（有效递交 <3 阻断，引导 abort → round+1 = B-033 重新招标）
   - `bid.service.ts` start-evaluation：B-020/021（委员会 ≥5 单数、技术经济专家 ≥2/3、采购人代表 ≤1/3；水利工程 ≥7）
   - evaluation-results/generate：B-026（候选人 ≤3 且排序）
   - award-letter/deliver：B-027（国有资金须第一名）、B-028（publicityEnd 已满）
   - 邀请发出：B-006（SupplierInvitation ≥3 家）
   - BidClarification 创建/答复：B-011（提问限截止 10 日前）、B-012（澄清限 15 日前）
3. Prisma：`BidProject` 加 `mandatoryTender Boolean`（依法必招标识，必招才 block、非必招 warn）；`Announcement` 加 `platformUrl`（B-002）
4. 前端 :3005：tender-write/projects 表单加天数实时提示（提示不拦截）
**验收**：compliance-rules.spec.ts 逐条 + curl 矩阵验证 block/warn/override 三态。

### P0-2 投标人异议流程（A-195/196、B-030/031）
**现状**：`ExpertDispute` 已有「跨端创建→采购端裁决」工单模式可作蓝本；`pause/resume` 端点已有（bid.controller.ts:247/252）。
**措施**：
1. Prisma 新模型 `TenderObjection`：projectId、supplierId、subjectType(announcement|tender_document|opening|prequalification|evaluation_result)、content、attachments、status(open|answered|overdue_closed)、deadlineAt、answer、answeredBy/At、raisedAt
2. 新模块 `apps/api/src/objection/`（结构照抄 expert 工单）
3. `assertObjectionWindow()`：B-030 四类时限（超期返回提示、不阻断登记）
4. 联动：open 异议 → 自动调既有 pause；答复 → resume（B-031 答复前暂停）
5. scheduler 加每日 @Cron：超 3 日未答复 → notification 通知 admin/leader
6. 前端：supplier-portal-next `(main)/objections`（入口在 my-bids 详情+公告详情）；:3005 projects 详情「异议处理」区块；public-portal 公示页引导入口
**验收**：发起→自动暂停→答复→恢复全链路 spec + 三端截图。

### P0-3 保证金退还闭环（A-105、B-047）
**现状**：BidSupplier.bondStatus/bidBondAssetId 已有；开标面板已展示 bondStatus。
**措施**：
1. `BidSupplier` 加：bondRefundedAt、bondRefundAmount、bondInterestAmount、bondRefundMethod、bondRefundOperatorId
2. `POST bid/projects/:id/suppliers/:supplierId/refund-bond` + 批量退未中标人
3. A-104 符合性校验增强：开标面板按 bondAmount/形式/到账时间三列判定
4. scheduler 每日：WIN_NOTICE PUBLISHED +N 日未退 → 预警 admin/leader（临时以归档日计 N 起点点，P2-10 后换 contract.signedAt）
5. 前端：:3005 归档/开标面板退还操作列；supplier 端 my-bids 退还状态
**验收**：spec + curl（含批量）。

### P0-4 国家授时与统一时钟（A-97/98）
**措施**：
1. `GET /api/time` 返回服务器时间；docker-compose 注释要求宿主机 NTP（chrony）
2. 各端 `useServerClock()` hook（30s 校准本地漂移）：supplier submit 页倒计时、opening-hall 大厅、:3005 开标面板统一替换
3. 声明材料写明截止判定以服务器 NTP 时钟为准
**验收**：本地时钟偏移 → 倒计时不受影响。

## P1 一星收尾（小项）

- **P1-5** 开标记录供应商可见（A-114）：supplier-portal my-bids 加只读 openingRecords（脱敏无评委）；supplier-portal 模块加只读端点
- **P1-6** 澄清回执（A-86）：BidDocumentAccess 加 `receiptConfirmedAt` + supplier 端确认按钮（不建新表）
- **P1-7** 招标异常类型化（A-197~199）：abort 入参加 abortReason(terminate|retender|reevaluate|switch_method)；switch_method 在项目管理项登记非招标成交结果
- **P1-8** 评委保密核验（A-134）：核查 /bid/projects/:id/experts @Roles 仅 host/admin/leader；e2e 断言 supplier 端不回评委姓名
- **P1-9** 公告规范文本（B-002/005）：公告模板加平台地址（域名取 system-config）；对照国家标准文本调整章节

## P2 二星（★★）

- **P2-10** 合同模块（A-180~183/185/186）：新 `TenderContract`（projectId、supplierId、amount、signStatus、双方 UKey 签名快照、验证人/时间）；:3005 projects 详情合同区块；履约复用 SupplierPerformance；B-047 起算点切换为 contract.signedAt
- **P2-11** 踏勘现场（A-77~79）：SiteVisitNotice/SiteVisitRecord + 通知已下载供应商（查 BidDocumentAccess）
- **P2-12** 评委分工（A-132）：BidExpert 加 duty 字段 + 编辑 UI
- **P2-13** 资格预审（决策项）：A-71~76/116~128/158~162/176~179 + B-035~46。如做：PrequalProject 挂 BidProject，加密递交/开启/评分组件全复用 bid 域，公告加 PREQUAL_NOTICE 类型；工作量 ≈ bid 域 1/3。**先要业务决策**
- **P2-14** 资源库界面（A-202~226）：黑名单管理（Supplier BLACKLIST 审批流+公示）、价格库统计报表、SupplierContact 加 personnelType（职业资格人员）
- **P2-15** 计划审核闭环（A-49）：work-arrangements 加 submit→approve 状态
- **P2-16** 版式文件（A-89）：convertOfficeToPdf 已产 PDF（属版式文件），自声明采用 PDF 满足；检测明确要求 OFD 再引商业组件

## P3 三星/外部依赖（立即并行启动商务，代码可先行部分）

- **P3-17** 公共服务平台对接（4.5/4.6 + 全部推送点）：新建 `apps/api/src/public-platform/` adapter（接口抽象+stub 落盘），按《检测技术规范》5.3/5.4 整理数据项导出 schema；**发函省级公共服务平台排联调——认证关键路径**
- **P3-18** 真 CA（A-12/13）：ukey adapter 接口已抽象（Mock → CA 机构 SDK 平移）；先做证书 DN 与注册名称一致性校验 + 有效期到期提醒（scheduler，A-13）；实体 UKey/签章走商务采购
- **P3-19** 费用管理登记面（A-187~192 降级版）：`FeeRecord`（文件费/保证金/交易服务费/履约保证金/代理费/专家费/图纸押金）线下缴费登记+凭证+退还登记；网上支付（A-193/194）待支付渠道商务落定
- **P3-20** 远程异地评标：A-156 评委评标时间窗登录限制可先做（expert 登录校验 openTime~evaluationDeadline 窗口）；A-154 视频监控/A-155 MAC 锁待硬件方案
- **P3-21** AI 增强（A-149/150）：AiConcordanceResult 围串标分析已有；补 ScoreDelta 打分离群分析报表
- **P3-22** 三星暂缓池：开标记录模板（A-115）、委托合同（A-42~44）、评委考核推送专家库（A-135）、工程量清单导入（A-64）

## D 文档与声明（贯穿）

- **D-1** 六项自声明（4.7~4.12 性能/安全/可靠/易用/运行环境/文档）：素材=audit+operationLog+公司隔离+加解密+docker-compose+bid-backup
- **D-2** 豁免声明：A-01~24、A-41、A-205~211（自建平台定位）
- **D-3** 管理制度：操作监控/变更管理/业务连续性/安全审计/日志定期审核（3.2.4 持续性符合）
- **D-4** 试运行：尽快选定 3 个真实项目全流程留痕（2-6 个月计时窗口，越早启动越好）

## 依赖关系与节奏

```
P0（并行4项，~2-3周） ─→ P1（小项，~1周） ─→ P2（按业务优先级排）
P3-17/P3-18 商务线立即启动（决定认证成败，周期以月计）
D-4 试运行项目选定随 P0 完成即启动计时
P2-10 落地后：B-047 起算点从归档日切换为合同签订日
```
