# 智慧水发·招采 ERP 系统泳道图交付索引

本目录按《系统功能板块与泳道图规划》交付 1 张平台总览图和 17 张专项图，共 18 张。每张图均为独立横版成图，PNG 尺寸为 **4800 × 2700 px**（16:9）；同名 SVG 保留文本与图形结构，可继续编辑或无损放大。

- 业务与图面规划：[功能板块与泳道图规划.md](功能板块与泳道图规划.md)
- 绘制实施计划：[绘制实施计划.md](绘制实施计划.md)
- 机器可读清单：[manifest.json](manifest.json)
- 质检总览：[contact-sheet.png](contact-sheet.png)（仅用于快速浏览，不替代单图）

## 单图下载

| ID | 功能板块 / 图名 | 高分辨率 PNG | 可编辑 SVG |
|---|---|---|---|
| G00 | 平台采购全生命周期总览 | [PNG](png/G00-platform-procurement-lifecycle-overview.png) | [SVG](svg/G00-platform-procurement-lifecycle-overview.svg) |
| A01 | 统一登录、账号企业与权限治理 | [PNG](png/A01-identity-account-company-permission-governance.png) | [SVG](svg/A01-identity-account-company-permission-governance.svg) |
| B01 | 采购需求、立项、计划、团队与工作协同 | [PNG](png/B01-demand-initiation-plan-team-collaboration.png) | [SVG](svg/B01-demand-initiation-plan-team-collaboration.svg) |
| C01 | 采购文件编制、AI 辅助与合规审查 | [PNG](png/C01-tender-document-ai-compliance-review.png) | [SVG](svg/C01-tender-document-ai-compliance-review.svg) |
| C02 | 公告发布、补遗澄清与采购文件获取 | [PNG](png/C02-announcement-addendum-document-access.png) | [SVG](svg/C02-announcement-addendum-document-access.svg) |
| D01 | 供应商注册准入、档案变更与动态管理 | [PNG](png/D01-supplier-admission-profile-lifecycle.png) | [SVG](svg/D01-supplier-admission-profile-lifecycle.svg) |
| D02 | 供应商选取、邀请回执与资格预审 | [PNG](png/D02-supplier-selection-invitation-prequalification.png) | [SVG](svg/D02-supplier-selection-invitation-prequalification.svg) |
| E01 | U 盾双信封投标、提交回执与撤回 | [PNG](png/E01-ukey-dual-envelope-bid-submission.png) | [SVG](svg/E01-ukey-dual-envelope-bid-submission.svg) |
| E02 | 在线开标、供应商确认、异议与多轮报价 | [PNG](png/E02-online-opening-confirmation-objection-multi-round.png) | [SVG](svg/E02-online-opening-confirmation-objection-multi-round.svg) |
| F01 | 专家入库、抽取、邀请、回避与替补 | [PNG](png/F01-expert-pool-draw-invite-recusal-substitute.png) | [SVG](svg/F01-expert-pool-draw-invite-recusal-substitute.svg) |
| F02 | 专家独立评审与 AI 辅助 | [PNG](png/F02-independent-expert-evaluation-ai-assistance.png) | [SVG](svg/F02-independent-expert-evaluation-ai-assistance.svg) |
| F03 | 委员会议事、澄清、结果生成与评标签字 | [PNG](png/F03-committee-deliberation-clarification-result-signing.png) | [SVG](svg/F03-committee-deliberation-clarification-result-signing.svg) |
| G01 | 定标、公示、异议投诉与成交通知书 | [PNG](png/G01-award-publicity-objection-award-letter.png) | [SVG](svg/G01-award-publicity-objection-award-letter.svg) |
| G02 | 合同编制、审查、签署、履约验收与供应商评价 | [PNG](png/G02-contract-review-sign-performance-evaluation.png) | [SVG](svg/G02-contract-review-sign-performance-evaluation.svg) |
| G03 | 材料归集、四性检测、ASIP 导出、监管推送与长期保管 | [PNG](png/G03-archive-four-natures-asip-regulatory-push.png) | [SVG](svg/G03-archive-four-natures-asip-regulatory-push.svg) |
| H01 | 集中目录治理、供应商供货、预算清单与采购立项 | [PNG](png/H01-catalog-supply-budget-procurement-initiation.png) | [SVG](svg/H01-catalog-supply-budget-procurement-initiation.svg) |
| H02 | 框架协议一阶段入围与二阶段订单 | [PNG](png/H02-framework-agreement-two-stage-order.png) | [SVG](svg/H02-framework-agreement-two-stage-order.svg) |
| I01 | 水叮当助手、业务分析、预警与驾驶舱 | [PNG](png/I01-assistant-analysis-alert-dashboard.png) | [SVG](svg/I01-assistant-analysis-alert-dashboard.svg) |

## 图面语义

| 颜色 | 含义 |
|---|---|
| 深蓝 | 采购方或普通业务操作 |
| 青蓝 | 平台自动处理、接口与实时服务 |
| 绿色 | 供应商侧操作 |
| 紫色 | 专家作业、AI 与智能辅助 |
| 橙色 | 审核、监督和人工判断 |
| 红色 | 异常、阻断、退回和风险分支 |
| 灰色 | 归档、日志、文件存储与外部系统 |

图形中，圆角矩形表示活动，菱形表示判断，折角文档表示关键产物，红色虚线节点表示异常或阻断；紫色虚线连接表示退回或重试。

## 使用与再生成

- 汇报或文档插图优先使用 PNG；大幅打印、二次排版或文案调整优先使用 SVG。
- SVG 使用苹方、微软雅黑、思源黑体等中文字体回退栈。跨平台打开时，如字体外观变化，可在编辑器内统一替换字体。
- 本文件夹为独立交付副本；源数据、渲染器和自动测试保留在项目的 `codex/swimlane-diagrams` 分支中。
