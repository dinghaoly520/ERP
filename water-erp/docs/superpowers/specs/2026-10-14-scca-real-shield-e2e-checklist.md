# SCCA 真盾端到端验证清单（dual-v3 全链）

**目标**：用 Windows 测试机 + 真实 SCCA 盾，把 dual-v3 投标链（投递→回执→开标解密→确认→澄清→补传→归档证据）完整跑通一遍。此前全链验证基于 Fake 验签服务（密码学由真 P7 fixtures 单测覆盖）——本清单是**真盾密码学路径**的首次端到端实证。

**范围外**（不在此清单）：专家端签名（阶段3）、CA 登录（阶段1 已真盾实测过，本清单作为前置步重验）、生产部署形态。

---

## 0. 前置条件

| 项 | 要求 |
|---|---|
| Windows 测试机 | SCCA 证书助手已启动（任务栏图标；WSS `wss://localhost:36171` 可达） |
| 测试盾 | 插入 USB，证书助手能枚举出**双证**（签名证 + 加密证） |
| 本机服务 | :4001 API、:3004 供应商门户、:3007 开评标端、:3005 工作台 在跑（`pnpm dev`） |
| 开关 | `apps/api/.env` 已有 `CA_SUPPLIER_V3_ENABLED=true`（供应商门户 capabilities 投影含 dual-v3） |
| 浏览器 | Windows 用 Chrome/Edge 访问 `http://<本机IP>:3004`（局域网访问已配，见 lan-access-config memory；**必须允许 localhost:36171 的本地证书助手连接**） |
| 账号 | 种子供应商「四川水发建设有限公司 / supplier@2026」（或任意 APPROVED 供应商） |

**PIN 纪律**（全程）：PIN 只经页面密码框输入；绝不写进任何截图说明/日志/聊天记录；盾 PIN 连续错误会锁死（锁死后需持卡人现场解锁）。

---

## 操作卡 0：绑定（真盾 → 供应商账号）

> 前提：该账号当前无 ACTIVE SCCA 绑定（业务数据清空后需要重绑）。若 `证书与U盾` 页已显示 SCCA 绑定状态则跳过本卡。

1. 登录 :3004（账号密码登录）→ 侧栏「信息维护 → 证书与U盾」
2. 页内 SCCA CA 绑定向导：探测 → 枚举双证 → 选证 → 输入 PIN → 盾签名挑战（PoP）→ 提交绑定
3. **判据**：页面显示绑定成功，证书 SN 与盾内一致；刷新后仍显示已绑定（持久化）
4. **异常**：`证书主体(CN)与注册企业名称不一致` → 该盾的企业名与账号不符，换对应账号；`证书已过期` → 换发新证后重试

---

## 操作卡 A：投递链（主路径）

**准备**：我在 :3005 创建一个演示项目（SUBMIT 阶段、公开招标、含招标文件与公告、邀请该供应商）——操作前先告诉我开工，我现场备项目。

1. **项目页投递卡**：登录 :3004 → 项目机会 → 目标项目 → 页内出现「SCCA CA 投标投递（双层信封）」卡片
   - 判据：四角色文件槽（技术标必选）+ 报价（万元）+ 工期 + 质量承诺 + U盾 PIN；未填满按钮禁用
2. **加密并递交**：选技术标 PDF（任意 >100B 的 PDF）→ 报价 `153.95` → 工期 `90 日历天` → 质量承诺 `合格` → PIN → 点「加密并递交」
   - 流程：双层加密+暂存上传 → prepare → signing-payload → **盾 signP7Attached（真 P7）** → submit v3
   - **判据**：完成态「投标文件已递交（dual-v3 双信封 + 盾 P7 签名）」；本机我核对：`SupplierBidSubmission.envelopeVersion='dual-v3'`+revision=1+`BidSupplier.submitStatus='已提交'`+`SubmissionVersion` 行+`BidFileBackup` 行（cryptoVersion='dual-envelope-v3'）
   - **采集**：浏览器 Console 无报错；告诉我完成时间点
3. **异常路径**：`WSS 连接失败：证书助手未安装/未启动/被浏览器拦截` → 检查证书助手+浏览器权限后**同页重试**（失败态表单已解锁，这是设计行为）；`P7 验签失败: CA_FINGERPRINT_MISMATCH` → 换证重绑或告诉我（网关侧指纹问题，需采集 P7 样本）

---

## 操作卡 B：开标解密链

**准备**：我在 :3007 走主持端流程（组建会话/解密窗口），:3005 确认按时开标——同样开工前告诉我。

1. **主持端解外层**：:3007 开标大厅 → 「解外层」（v3 家）
   - **判据**：外层解密成功提示；供应商端开标大厅出现「SCCA CA 开标解密（双层信封内层）」卡片（本机我核对 `outerDecryptedAt`+`innerAssets`+`DecryptExecution` 槽 SUCCESS）
2. **供应商取包并解密**：:3004 开标大厅 → 解密卡 → PIN → 「取包并解密」
   - 流程：取包（innerAsset+kself P7）→ 下载 C_inner → **盾 unwrapKey（真 P7 解封 DEK_S）** → SM4 解密 → sealedFields 解出 fields+nonce → **盾 signP7Attached（解密证明）** → decrypt-upload
   - **判据**：解密卡完成态「开标解密完成（明文与 P7 解密证明已提交）」；大厅唱标表出现本司行「153.95 万元」；本司对比区投递报价=唱标金额
   - **采集**：告诉我解密完成时间点；若 `解密包未就绪` → 等我核对解外层状态后重试
3. **开标确认**：大厅本司行「确认」→ 盾签（canonical v2，金额不进签）→ 提交
   - **判据**：确认状态「供应商已确认」；本机我核对 `confirmSignature.algorithm='scca-pkcs7-base64'`+openingRecordHash 在签
4. **异常路径**：`ENVELOPE_MISSING`/`锚点交叉不符` → 截图+告诉我（解密产物调包类拦截，属平台侧证据，需保留现场）

---

## 操作卡 C：恢复与证据链

1. **回执 P7 强签**：:3004 项目页 → 投递回执区 → 「盾 P7 签署回执」→ PIN
   - **判据**：核验面板显示 verified（本机我核对 `receiptSignature.algorithm='scca-pkcs7-base64'`+revision 锚点）
2. **补传链（可选，异常恢复实证）**：我在 :3007 把本司解密置为异常（DANGER）→ :3004 开标大厅出现「开标期补传」卡 → 重选**同一 PDF** → PIN → 重封并补传
   - **判据**：补传完成（版本推进）；本机我核对 revision=2+解密状态重置 PENDING+备份 revision=2 行；再走一遍 B-2 解密 SUCCESS
3. **澄清答复（评标中）**：我流转到 EVALUATING 并发起寻址本司的澄清 → :3004 评标澄清答复页 → 填写答复 → 盾签 → 提交
   - **判据**：答复状态「已回复」+replyChannel=online；本机我核对 `replySignature.algorithm='scca-pkcs7-base64'`
4. **归档证据**：我走完评标/归档后核对回流包含 v3 备份行（BidFileBackup revision 维度）与签字包证据

---

## 产物收集（拷回本机）

| 产物 | 何时采集 |
|---|---|
| 浏览器 Console 截图/导出（各卡操作时） | 每步异常时必采；正常步可选 |
| 页面完成态截图（投递完成/解密完成/补传完成/确认完成） | 每卡完成时 |
| 盾错误弹窗截图 | 任何异常时 |

---

## 本机核对清单（我执行，无需你操作）

| # | 核对点 | SQL/位置 |
|---|---|---|
| 1 | 投递落库 | submission.envelopeVersion='dual-v3', revision, SubmissionVersion.envelopeHash |
| 2 | 名册翻牌 | bidSupplier.submitStatus='已提交', encryptStatus='双层信封已验签' |
| 3 | 备份固化 | bidFileBackup.cryptoVersion='dual-envelope-v3', wrappedDek 三键 |
| 4 | 解外层 | submission.outerDecryptedAt + innerAssets + decryptExecution.status='SUCCESS' |
| 5 | 解密上传 | bidOpeningRecord.amount='153.95'+amountUnit='万元', decryptedAssets |
| 6 | 确认签名 | confirmSignature.algorithm/certSn/openingRecordHash |
| 7 | 回执签名 | receiptSignature.algorithm/revision |
| 8 | 补传 | revision=2 版本链 + 状态重置 + 备份 rev2 行 |
| 9 | 澄清 | replySignature.algorithm/replySha256 |
| 10 | Outbox 消费 | outbox.bid.submitted.v3 status=SENT + 主持人通知 |
| 11 | 监督日志 | 各动作日志行（含 P7 证明留痕） |
| 12 | 金额铁律 | 全程无裸元/万元换算错位（唱标/对比区/中标通知书口径） |

---

## 通过标准

- 操作卡 A/B 全步判据达成（投递→解密→确认是**最低通过线**）
- 操作卡 C-1（回执）达成；C-2/C-3 任一达成即算恢复/证据链实证（两项都做最好）
- 本机核对 12 项全过；无未解释的 500/异常
- 全程 PIN 未泄露、盾未锁死

**异常上报协议**：任何一步卡住 → 截两张图（页面+Console）→ 停止操作 → 告诉我现象与我核对结果（不要反复重试，防盾锁死）。
