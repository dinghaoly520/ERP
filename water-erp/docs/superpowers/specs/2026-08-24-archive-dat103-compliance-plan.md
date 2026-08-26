# DA/T 103-2024 合规完善计划（归档域）

日期：2026-08-24
范围：**系统、项目管理、流程、归档**。排除线上招投标执行（:3007 开标大厅/解密/在线评标）、CA 电子签章（维持线下双套即合规）、OFD/PDF-A 版式转换、档案系统在线对接（后评估）。
主线：以 `ProjectManagementItem`（PMI）为一卷单元（规范 §9.2「一个标段一卷」），`ProjectManagementStage`（8 阶段）为卷内组合文件单元；开评标回流件（`FileAsset`：开标文件包/评标回流包/签字包）作为接收件纳入归档范围。

## 依据与现状

| 规范条款 | 系统现状 |
|---------|---------|
| §4.1 全程管理/前端控制 | PMI 8 阶段状态机 + 阶段推进最小校验（P1-12） |
| §8.1 归档时点 | `AWARD_DECISION`（中标通知书）/`CONTRACT`（合同）阶段即终结节点 |
| §8.5 保留≥3年 | 未显式化 |
| A.1g 审计 | OperationLog（分区/脱敏）+ AuditLog |
| §9.2 卷内分阶段 | `ProjectManagementStage.stageOrder` + `Attachment.projectManagementStageId` |
| 完整性基础 | `AttachmentVersion.originalHash`、`FileAsset.sha256` |
| 导出件 | 开标文件包（JSON+SHA-256）、评标回流包、签字包、DOCX 转换器 |
| 缺口 | 归档范围表、档案元数据（DA/T 46 M22/M28/M32/M33）、ASIP 离线包、四性检测、归档管理页、时限提醒 |

## 任务清单

### 板块一 系统层（S1–S2）
- **S1 保留策略**：RECYCLED 物理删除加 ≥3 年闸；`archiveHook='ASIP_EXPORTED'` 后禁物理删。
- **S2 归档审计视图**：OperationLog 按 `/api/archive` 过滤的查询（前端页内嵌）。

### 板块二 项目管理与流程（P1–P3）
- **P1 阶段闸门**：`updateStage` 完成前按范围表检查必备材料（替换 P1-12 硬编码三条为范围表驱动，保留原语义）；缺件 409 列明细；支持显式豁免（note 留痕）。
- **P2 归档时点挂钩**：上传 `CONTRACT`/`AWARD_NOTICE` 附件 → 判定流程终结 → 通知归档责任人（Notification resolvedAt 闭环：归档导出完成后自动消）。
- **P3 审批留痕件**：导出器聚合 PMI 阶段流转 + 审批意见 + OperationLog 摘录 → 生成 DOCX 附件（`SUPPORTING_MATERIAL`），随 ASIP「其他」目录。

### 板块三 归档核心（C1–C5）
- **C1 归档范围表** `ArchiveScopeItem`：附录 B 36 项；三源映射 `attachment`（AttachmentType+stageKey）/`fileAsset`（回流件 category）/`manual`（补传）/`generated`（P3）。
- **C2 档案元数据** `ArchiveMetadata`（1:1 Attachment，回流件同样建记录）：M22 题名/M28 人名/M32 责任者/M33 形成时间；自动 enricher + 质检页补录。
- **C3 卷状态**：PMI 加 `retentionPeriod`（PERMANENT/Y30/Y10）`archiveExportedAt` `archivePackageKey`；文件级 `archivedAt` 放 ArchiveMetadata；组合查询端点（A.2e）；取消标记重归（A.2d）。
- **C4 ASIP 导出**：附录 D 结构 zip（说明文件.TXT + 项目管理/01–09 阶段目录 + 其他/移交清单、元数据.json、固化验证信息、审批留痕、登记表）；`POST /api/archive/items/:pmiId/export-asip`（检测通过才放行）；jszip 组包回存 MinIO。
- **C5 四性检测** `ArchiveCheckResult`：完整性=逐件 sha256 重算 + 范围齐全；可用性=mime 白名单+可达+非空；安全性=加密态核验；真实性（弱）=版本链+操作日志。不合格退回通知。

### 板块四 归档运营（D1–D3）
- **D1 归档管理页** `/archive`（:3005 资源管理分组）：卷列表 + 质检视图（勾稽/补传/元数据/检测明细/重归档）+ 审计视图。
- **D2 时限提醒**：Scheduler cron 扫描「终结满 N 天未导出」→ `ARCHIVE_TRANSFER_DUE`（次年 3.31 前）/`ARCHIVE_OVERDUE`（6.30 前）通知。
- **D3 纸电关联**：移交接收登记表打印→签章→回扫登记 `SUPPORTING_MATERIAL` + 与 ASIP 包互链。

## 排期
```
迭代一（基座）  C1 → C2 → C3   纯数据层
迭代二（流程）  P1 → P2 → P3   闸门/时点/留痕件
迭代三（交付）  C4 → C5 → D1   ASIP/检测/页面
迭代四（运营）  S1 → S2 → D2 → D3
```
代码侵入面：PMI 加 3 列、`updateStage` 闸门段、`uploadStageAttachment` 尾钩，其余全部新建 `apps/api/src/archive/` + `apps/web/src/app/(main)/archive/`。

## 状态跟踪
- [x] 迭代一 C1/C2/C3（2026-08-24 落地）：ArchiveScopeItem 35 项种子、ArchiveMetadata 自动捕获（M22/M28/M32/M33）、PMI 保管期限/导出时间/包键三列；定点迁移 20260824120000_archive_dat103_core
- [x] 迭代二 P1/P2/P3（2026-08-24 落地）：阶段闸门（updateStage 按范围表检查，替代 P1-12 硬编码）、合同/定标件上传→ARCHIVE_READY 待办（导出完成自动 resolve）、审批留痕 JSON 生成器
- [x] 迭代三 C4/C5/D1（2026-08-24 落地）：ASIP 导出（附录 D 结构实测验证）+ 四性检测（完整性-范围/哈希、可用性-格式/可读）+ /archive 归档管理页（卷台账/质检弹窗/检测/导出/下载）
- [x] 迭代四 S1/S2/D2/D3（2026-08-24 落地）：
  - S1 保留策略双闸（deletePermanently）：已导出 ASIP 禁删 + 回收不足 3 年禁删（§8.5）
  - S2 归档审计视图：GET /items/:pmiId/audit（OperationLog 按路径过滤），质检弹窗内嵌最近操作
  - D2 时限提醒：每日 05:00 cron 扫描「终结未导出」分两级（270 天 ARCHIVE_TRANSFER_DUE→staff+leader / 365 天 ARCHIVE_OVERDUE→leader+admin），幂等；阈值 env 可配（ARCHIVE_TRANSFER_DUE_DAYS / ARCHIVE_OVERDUE_DAYS）
  - D3 纸电关联：PMI.archiveRegistrationKey + 登记表扫描件上传/下载端点 + 质检弹窗回传 UI（A.1h）

### 已知设计取舍（实现时定稿）
- 范围表 manual 源未指定阶段的项目（异议/投诉等"其他"类）不自动匹配，保持 MISSING 待人工补传确认
- 阶段适配：范围项限定阶段在本项目不存在（如邀请采购无公告阶段）→ 不适用不阻断
- 审批留痕件为机器可读 JSON（档案系统解析友好）；人读版式件由移交清单承载
- 四性"真实性"为弱对齐（sha256 + 版本链 + OperationLog），CA 签章维持线下双套
- 检测对 generated 必选项放行（导出流程自动产出，导出成功即视为归集）

### 验证记录（2026-08-24）
- 范围表 35 项 ✓；真实项目快照勾稽 ✓（缺件精确识别：招标文件/中标通知书/合同）
- 缺件导出被 400 拦截（ARCHIVE_SCOPE_INCOMPLETE）✓；检测 FAILED 拦截 ✓
- 补件后检测 PASSED → ASIP 导出 ✓（zip 结构对照附录 D 逐项一致：说明文件.TXT/阶段组合目录/其他五件/指纹）
- P2：真实上传 CONTRACT 附件 → ARCHIVE_READY 通知 3 秒内发出（link 直达质检弹窗）✓
- S1：刚回收项目物理删除被 3 年闸拒（「余 36 个月」）；已导出项目被 ASIP 闸拒 ✓
- S2：审计端点返回 11 条归档操作日志（检测/导出/下载/登记全覆盖）✓
- D2：280 天/400 天测试卷分级收到 TRANSFER_DUE/OVERDUE；重跑零新增（幂等）✓
- D3：登记表扫描件上传→MinIO→回读一致→下载回读一致 ✓
