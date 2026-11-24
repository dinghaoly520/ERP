# 补正变更清单（退回补正快照自动比对）— 设计

**日期**：2026-11-24
**状态**：已批准（用户裁定：方案 A·快照自动比对，设计五节定稿）

## 1. 问题

退回补正链路现状：退回侧有退回原因（必填）+ 佐证附件，告诉供应商要改什么；但补正侧是
**整表重报**（`CorrectionSubmitDto` 即完整注册表单，无补正说明字段），审批侧重提后看到的
是**当前全量表单** + 审核进度留痕——没有任何「本次改了什么」的标识，审批人只能凭记忆或
旧留痕人工比对。

**原料已具备**：每次审批动作（含退回）落 `SupplierApprovalRecord`，`snapshot` 为退回时点
完整申请快照（主档 + 联系人/资质/银行/业绩逐段，PII 出口即掩码形态）。退回时点快照 vs
重提后表单可自动逐字段比对，客观生成变更清单——不依赖供应商自觉，无法漏报谎报，
staff/leader/admin 三级续审人人可看。

## 2. 触发口径

- **基准轮** = 该供应商最近一条 `RETURNED` 审批留痕的快照。
- **展示条件** = 存在基准轮 且 当前 `status ∈ {RETURNED, PENDING}`（本轮注册流程尚未
  终局）：
  - `status=PENDING`（已重提、回原级续审）→ 清单非空，展示；
  - `status=RETURNED`（未重提）→ 当前表单即退回时表单，无变化可列（sections 空）；
  - 续审链中间级（staff 重提后已通过 → leader/admin 续审）状态仍 PENDING，**清单持续
    可见**——三级人人可看，不随中间级通过而消失；
  - 终局态（APPROVED/REJECTED/DISABLED/BLACKLIST）→ 周期闭合，不再展示（留痕仍在
    审批历史中可查）。
- 多轮退回：每轮自动取最近一次 RETURNED 快照为新基准。
- 首次注册（从无退回）→ 无基准轮，不展示。

## 3. 后端

### 3.1 diff 纯函数 `correction-diff.util.ts`（apps/api/src/supplier/）

输入旧快照（RETURNED 留痕存档）与新快照（`buildApprovalSnapshot` 现算），输出分节变更
清单，**只含有变化的项**：

```ts
{
  sections: Array<{
    key: 'main' | 'account' | 'contacts' | 'qualifications' | 'bankAccounts' | 'performances';
    label: string;               // 企业信息 / 登录账号 / 联系人 / 资质证照 / 银行账户 / 主体业绩
    items: Array<{
      kind: 'modified' | 'added' | 'removed';
      rowLabel: string;          // 子表行标识（「主要联系人 唐小燕」「营业执照」）；主档=字段名
      fieldLabel?: string;       // 子表行内具体字段；主档项无此层
      oldValue?: string;
      newValue?: string;
      fileReplaced?: boolean;    // 资质证照/Logo 文件替换
    }>;
  }>;
}
```

- **主档字段集**：name / enterpriseType / legalPerson / legalPersonIdCard /
  legalPersonPhone / registeredAddress / detailedAddress / businessScope / country /
  region / registeredCapital / industry / companyEmail / companyWebsite /
  organizationCode / companyId+companyName（归属公司）/ establishedDate / tags（数组按
  「、」并列展示）/ logoUrl（变化 → fileReplaced）。creditCode/supplierNo 锁定不可改，
  跳过。
- **子表行匹配键**：联系人 = isPrimary+name；资质 = type+name；银行 = accountNo（掩码
  形态）；业绩 = projectName。匹配不到 → added/removed。行内逐标量字段比对，变化的字段
  各生成一条 item。
- **PII**：快照两侧均已是掩码形态（`buildApprovalSnapshot` 出口脱敏），直接比对掩码值，
  展示同口径。
- **旧快照缺键跳过**：旧快照缺某键（含本次新增的 companyId/companyName/establishedDate
  存量）→ 该字段不参与比对，不误报。

### 3.2 快照补字段

`buildApprovalSnapshot` 增补 `companyId` / `companyName` / `establishedDate`（补正可改
归属公司（F2），现快照缺失；成立日期同理）。additive，不影响既有消费端。

### 3.3 端点 `GET /supplier/:id/correction-diff`

- `@Roles('admin','leader','staff')`（对齐 `:id/approval-history`）。
- 响应：`{ hasRound: boolean, returnedAt?: ISO, returnReason?: string|null, sections?: [...] }`。
  - 无基准轮或终局态 → `hasRound=false`；
  - RETURNED 未重提 → `hasRound=true, sections=[]`；
  - `returnReason` 取 **RETURNED 留痕记录的 reason**（非 `Supplier.returnReason` 列——
    缺陷 approve 曾清空该列，留痕记录才是权威）。
- 即时计算不落库；供应商不存在 → 404。

## 4. 前端（:3005 两处）

- 详情页 `supplier/[id]/page.tsx`：审核进度块旁新增「本次补正变更」折叠区块（默认展开），
  逐行「字段名：旧值 → 新值」；修改=高亮箭头行、新增=「新增」徽标、删除=「删除」徽标、
  文件替换=「文件已更换」标记。仅 `sections` 非空渲染。
- 审批中心 `review-center-modal.tsx`：选中面板同款区块（与补正只读提示/退回原因同屏）。
- 文案禁机制词（快照/自动比对等实现表达不出现），无英文眉题。

## 5. 边界

- `recordApproval` 快照构建失败则整条留痕不写 → 有 RETURNED 留痕必有快照，无降级分支。
- 补正改名：身份锚为 creditCode，主档 name 变更列为普通字段变更（旧行匹配不受影响）。
- 旧数据（2026-09-29 分级审批前的退回留痕无 stage）不影响 diff——基准只认快照。
- diff 只读即时计算，无写路径、无并发面。

## 6. 测试（TDD）

- `correction-diff.util.spec.ts`：主档字段改/未改只列变化项；子表行增/删/改；资质文件
  替换 fileReplaced；tags 多值并列；旧快照缺键跳过；掩码 PII 比对；无变化输出空 sections。
- 端点/服务用例：无 RETURNED 留痕 → hasRound=false；RETURNED 未重提 → sections=[]；
  重提后 PENDING → 非空；终局 APPROVED/REJECTED → hasRound=false；returnReason 取留痕
  记录 reason。
- e2e 不加（单测覆盖）。

## 7. 不在本次范围

- 供应商自填「补正说明」（方案 B，可后续独立加）。
- :3004 供应商侧「我改了什么」回显。
- 审批中心列表行内变更徽标（仅在详情页/审批弹窗展示）。
