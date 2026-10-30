# :3004 成交履约——自存档案样式统一 + 履约资产转主体业绩（设计）

日期：2026-10-30 · 门户：供应商门户 `apps/supplier-portal-next`（:3004）

## 背景与用户裁定

- 板块：成交履约 → 我的合同（/contracts）/ 框架协议（/frameworks）→ 企业自存档案 tab（`OwnArchivesPanel`）。
- 问题①（样式）：上传合同/框架协议档案弹窗内输入框形态不统一——一个弹窗混四种视觉体系。
- 问题②（联动）：用户要求板块更实用、更强联动。已否决的方向：
  - 中标通知书→合同一键登记（定标与合同是两个环节，不得跨环节直连）；
  - 到期提醒推送（无意义，不做）。
  - 采纳方向：**履约资产 → 主体业绩一键转入**（锚定合同环节本身；合同在 :3005 为上传式流程——登记编号/金额+上传签署件+履行台账，设计不得假设「系统内写合同」的结构化文本）。

## A. 样式统一

### 根因

`own-archives-panel.tsx` 弹窗表单容器是 `.oa-form`，而 5 个文本框类名 `reg-inp` 的样式全挂在 `.reg-form` 祖先作用域（globals.css `.reg-form .reg-inp`，register2.css:632 注释记载的同一陷阱）→ 文本框退化成**裸原生控件**；日期框 SpDateInput（workbench-input 40px 内凹）与备注 SpTextarea（neu-input）是另两套；附件区 oa-* 芯片第四形态。

### 改法

- 5 个文本框（名称/编号/对方单位/金额/标的简述）`<input class="reg-inp">` → `SpInput`（neu-input 族），与 SpDateInput/SpTextarea 归一为同一输入族（`.neu-input/.workbench-input` 共享基础规格：内凹、同圆角、同聚焦环）。
- 标签 `reg-label` / 容器 `reg-item` 为无作用域全局类，不受影响，保留。
- 附件芯片（oa-file-chip / oa-add-file）是展示/动作形态，非输入框，不动。
- 改动面：`own-archives-panel.tsx`（~5 行 + import）；零新增 CSS。

## B. 履约资产 → 主体业绩一键转入

### 数据事实

- 业绩行结构（`Supplier.performances`，注册 2.0/资料变更同构）：`{ projectName, clientName, contractAmount, signDate, description, proofFiles: [{name, url}] }`。
- 业绩修改走既有变更申请审批链：`POST /supplier-portal/change-requests`，fieldName=`performances`（白名单内，newValue=整表 JSON 替换），:3005 审批中心批准后生效；同字段已有 PENDING 时后端 400 `DUPLICATE_PENDING_CHANGE`。
- 自存档案 files 形态 `{name,url}` 与业绩 proofFiles 同构。
- 平台合同履行台账前端仅见 `proofAssetId`（无文件名元数据）→ 后端 `listContracts` 需补 include。

### 新组件 `performance-transfer-dialog`

两个入口：

1. **自存档案卡**（own-archives-panel，「转入业绩」按钮仅 `category=contract` 时渲染——框架协议类卡片不显示）：
   预填 projectName=title、clientName=counterparty、contractAmount=amount、signDate=signDate、description=scope/note、proofFiles=files。
2. **平台合同履行台账**（contracts/page.tsx）`status=done 且有 proofAssetId` 的节点「转入业绩」：
   预填 projectName=节点标题、clientName=合同归属公司、contractAmount=合同金额、signDate=节点完成日期、proofFiles=[proofAsset]。

弹窗内容：预填行可编辑（项目名称/客户/合同金额/签订日期/说明）+ 证明文件列表（只读展示）+ 变更原因（默认「履约档案转入：{projectName}」，可改）。

### 提交逻辑（复用既有通道，零新端点）

1. `GET /supplier-portal/profile` 拉当前 performances（提交时即时拉取，防陈旧覆盖）；
2. 追加新行 → `POST /supplier-portal/change-requests`（fieldName=performances，fieldLabel=主体业绩，newValue=JSON.stringify(全表)，reason）；
3. 成功 toast「已提交业绩变更申请，待采购中心审批」；捕获 `DUPLICATE_PENDING_CHANGE` 转友好提示「已有待审批的业绩变更申请，请等待审核结果后再提交」。

### 后端小改

`listContracts`（supplier-portal.service.ts）fulfillments 查询补 include `proofAsset { id, url, originalName }`；前端 `SpContractFulfillment` 类型补 `proofAsset?: { id, url, originalName } | null`。证明 url 用 asset.url（与上传件一致），name 用 originalName。

### 边界

- 框架协议（category=framework）卡片不放「转入业绩」入口（入围资格≠履约业绩，用户裁定的流程边界）；入口仅出现在 /contracts 页的企业自存档案卡与平台合同履行台账两处。
- 不新造数据模型、不加审批旁路：一切经 performances 变更申请。

## 测试

- 后端：`listContracts` 补 include 后跑 supplier-portal 既有相关 spec（合同域）；无行为变更断言需求（纯 select 扩展）。
- 前端：`pnpm --filter supplier-portal-next` tsc 通过；转业绩弹窗提交路径复用既有 change-requests API（后端已有 DTO/白名单/去重测试覆盖）。
- 样式：人工核验弹窗四类控件形态归一（截图比对）。

## 不做清单（用户否决/裁定）

- 中标通知书→合同登记联动（跨环节）。
- 到期提醒推送（通知中心/首页待办）——用户裁定无意义。
- 框架协议页转业绩入口。
