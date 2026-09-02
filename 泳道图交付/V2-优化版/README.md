# 智慧水发·招采 ERP 泳道图 V2（领导 / 专家汇报完整版）

本目录交付 18 张独立的 4800 × 2700 高分辨率泳道图，同时提供可继续编辑的 SVG 和直接用于汇报的 PNG。V2 不是精简版：原有业务节点、业务连线、异常支路和系统映射全部保留，并在其上增加了可连续讲述的主线骨架、编号检查点、明确的判断结果和异常回归说明。

- [18 图总览](contact-sheet.png)
- [V1 / V2 对照页](comparison-sheet.png)
- [交付清单与尺寸信息](manifest.json)
- [已确认的 V2 设计说明](V2-逻辑与视觉优化设计说明.md)
- [V1 原版目录](../README.md)——V1 已完整保留，未被覆盖或删除

## 一、推荐汇报方式

领导汇报建议先展示 G00 总览，用 01–10 编号沿粗蓝主线讲清“需求—立项—文件—投标—开标—评审—定标—合同—归档”的闭环；再按议题下钻专项图。专家汇报可在同一图面继续解释细蓝支路、琥珀判断、红色异常与紫色回归，无需切换到另一套精简图。

- 25% 缩放：适合整页投屏、介绍阶段和跨角色主线。
- 50% 缩放：适合逐检查点讲解，并能看清主要分支标签。
- 100% 缩放：适合专家审阅异常回归、成果证据和系统边界。
- 建议汇报顺序：G00 → B01 → C01/C02 → D01/D02 → E01/E02 → F01/F02/F03 → G01/G02/G03；H、I 模块按专题插入。

## 二、图面语义

| 代码 | 图形语义 | 汇报口径 |
|---|---|---|
| M | 主线里程碑 | 粗蓝连接线和 01–10 编号构成连续叙事骨架 |
| S | 支撑动作 | 保留系统自动、人工协同和跨角色辅助步骤 |
| D | 关键判断 | 菱形节点；分支使用业务结果，不再只写“是 / 否” |
| E | 异常 / 回归 | 红色虚线；节点内注明回归点或终态处置 |
| O | 输出物 / 留痕 | 折角文档节点；对应证据、签字包、报告或归档材料 |

所有连接线位于节点之后，主线最粗，支撑线较细，异常与回归使用不同颜色及虚线规则。阶段宽度按真实业务密度分配，避免复杂阶段拥挤、简单阶段空泛。

## 三、模块视觉识别

18 张图共享冰灰纸面、工程细线、直角路由和低饱和专业配色；模块只做中度变化，不会出现完全相同或彼此割裂的两种极端。

| 模块 | 主题 | 视觉签名 |
|---|---|---|
| A | 平台入口与治理 | 权限闸门刻度 |
| B | 采购协同与项目管理 | 阶段里程碑时间轴 |
| C | 采购文件与信息公开 | 文档版本与批注角标 |
| D | 供应商全生命周期 | 生命周期状态节点 |
| E | 投标与开标 | 双信封 / 安全协议轮廓 |
| F | 专家与评标 | 稀疏评分矩阵 |
| G | 定标、合同与归档 | 证据链校验刻度 |
| H | 集中采购与框架协议 | 目录树层级括线 |
| I | 智能化与决策 | 数据流节点脉络 |

## 四、18 张独立图件

| 编号 | 功能板块 / 图件 | PNG（汇报） | SVG（编辑） |
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

## 五、V1 到 V2 的主要改进

| 方面 | V1 | V2 |
|---|---|---|
| 讲述顺序 | 依赖观看者自行寻找路径 | 6–10 个编号检查点构成稳定主线 |
| 判断表达 | 部分节点只写“是 / 否”或单出口菱形 | 判断使用业务结果；单结果选择器改为动作节点 |
| 异常处理 | 异常分支存在但回归关系不总是显式 | 每个异常均给出回归目标或终态处置 |
| 信息层级 | 节点色块较强，主次容易竞争 | 白底低饱和节点，粗主线优先，支路仍完整保留 |
| 模块风格 | 统一多彩卡片体系 | 工业蓝图母版 + 九类克制的模块视觉签名 |
| 交付用途 | 工作底稿和方案展示 | 同时支持领导讲述与专家逐项审阅 |

## 六、文件说明

- `png/`：18 张 4800 × 2700 PNG，直接插入 PowerPoint、Word 或大屏。
- `svg/`：18 张同尺寸矢量图，可在 Illustrator、Figma、Inkscape 或浏览器继续编辑。
- `contact-sheet.png`：3 列 × 6 行全集总览，用于选图和快速核查。
- `comparison-sheet.png`：G00、E02、F02、G03 四组 V1/V2 对照。
- `manifest.json`：图件编号、模块、标题、尺寸、节点数、检查点数与文件路径。

本目录为 V2 优化版独立交付；V1 全部文件继续保留在相邻目录中，便于追溯、审查和版本对照。
