# 四川 CA 接入：前端 UI、后端接口与数据契约复核版

日期：2026-10-12。主方案：[四川 CA 接入方案](2026-10-10-scca-integration-design.md)。本附录与主方案共同构成设计交付，尚未实施。权威资料仍为 `四川CA/sccm-JAY`，Word 仅供参考，不接入 PDF/OFD 电子签章。

本轮以工作区产品代码为准，Git HEAD 为 `3a1b040fea70f302163a9101c80d2be4a66f0e38`；`apps/api/src/main.ts` 等既有未提交改动一并按现状阅读，未修改这些文件。路径与行号用于定位本轮代码，后续实现应按函数名再次核对。未把历史方案中的“已具备”当作事实，也未把本轮审查当作实盾验收。

## 1 审核结论与使用规则

架构保留：Windows 浏览器 → 本机 CA 客户端/U盾；Linux NestJS → 开发包协议的 CA 网关。前端不持有 AppSecret，ERP 不接收 PIN 或 U盾私钥。管理方文件外层继续使用服务器持有的 SM2 私钥，不能宣传为管理方硬件 CA。

本轮将方案补到页面状态、具体文件/函数、请求字段、数据库约束、并发更新、异步任务、部署与用例层级。新增发现包括取消后续提交、解绑绕过换绑门禁、User 与 Supplier 状态不一致、双证与旧缓存冲突、开标任务超时接管、草稿明文旁路、备份历史覆盖等。具体证据见后续分域章节。

全文中的“新增”“改为”“必须”均指待实施设计；不能将定义了 DTO/状态机解释为代码已经存在。第 2 节固定跨模块共同契约，后续分域章节细化落点；任何改动必须同步契约、实现与用例。厂商相关未知项是启用条件，不通过试错回退协议来掩盖。

路径缩写：仓库根为 `/home/asus/桌面/ERP/water-erp`；`S` 为 `apps/supplier-portal-next/src`，`E` 为 `apps/expert-portal/src`，`A` 为 `apps/api/src`。主方案第 9 节仍是业务开放阶段，本附录不新增产品发布或生产执行授权。

## 2 固定的跨模块契约

### 2.1 类型、能力与状态

- 证书协议分类固定 `credentialScheme='legacy-raw-sm2' | 'scca-pkcs7'`；`certSource=mock/x509` 只描述旧数据来源。存在 DER 不代表已完成 SCCA 绑定。
- P7 签名及供应商密钥包装的格式标识统一为 `scca-pkcs7-base64`；管理方包装为 `sm2-c1c3c2-hex`。格式由服务端业务政策确定，客户端不得自选旧格式绕过 CA。
- 新增 `GET /api/ca/capabilities`，登录后返回当前主体的 `provider/credentialScheme/caCredentialRevision/activeBinding/allowedActions/allowedEnvelopeVersions/disabledReasons`。页面从该投影决定可用操作，服务器执行时重新判断；不再以 `Supplier.sm2PublicKey` 的有无决定 v3 能力。
- 匿名登录入口能力用 `GET /api/auth/ca/config`：仅返回门户支持状态、公开客户端说明及受审核的安装资源链接，不含凭据、账户信息或任意客户端可改的网关 URL。服务器按允许的门户/来源生成响应。
- 当前证书关系、设备在线、PIN 解锁、CA 可信状态是四个独立事实。页面必须分别显示；本机连接失败不能确诊“未安装”，只能显示“未连接，请检查安装、启动与连接权限”。
- 绑定与用户身份的并发版本使用主体 `caCredentialRevision`，独立于单条历史绑定；每次首次绑定、更换、解绑、紧急停用递增。供应商落在 Supplier.caCredentialRevision，专家落在 User.caCredentialRevision，默认0、单调递增；能力服务按主体统一投影。所有新签名上下文固定该版本，单条绑定的 bindingRevision 只是建立时快照。
- 业务服务端 operation 状态固定 `PREPARED → PAYLOAD_READY → VERIFYING → COMMITTED`，失败分 `FAILED/EXPIRED/CANCELLED`。`unknown` 仅是前端尚未确认结果的状态；服务端不得用 UNKNOWN 作为已提交结果。
- 普通业务查询 `GET /api/ca/operations/:operationId`，要求登录和主体/门户归属；返回状态、业务版本、结果与 evidenceId，不返回 PIN、凭据证明或原始敏感业务数据。认证用登录 challenge 独立处理，不用该 GET 取得 JWT。
- 登录响应丢失使用新增 `POST /api/auth/ca/result`（{challengeId}）恢复：精确来源校验后仅读取对应门户 cookie，忽略旧 X-Supplier-Token/X-Web-Token；检查该 cookie 的当前 SID、账号资格及 sessionMeta.caLoginChallengeId 与本次挑战匹配。匹配才返回原会话的登录响应（含用于恢复本标签的 access_token），不再轮换 SID；前端调用 rememberSupplierSession 等原登录收尾。不匹配/无 cookie 则显示结果未确认并允许新挑战，不能把另一标签或旧会话的 /auth/me 成功当作本次登录成功。绑定 ca-challenge 同时创建并返回独立 operationId，将 challengeId 与持久 CaOperation 关联；绑定提交仍凭 challengeId 验证签名，已登录用户按 operationId 查询最终结果，两种 ID 不互代。

### 2.2 业务动作与签名输入

| 动作 | 签署上下文至少覆盖 | 最终写入的比较条件 |
|---|---|---|
| CA 登录 | `LOGONDATA:` + purpose、门户、challengeId、随机量、到期、签名指纹 | 原子挑战、浏览器绑定；锁内账号/主体/绑定资格、专家工位规则 |
| 绑定/换绑 | 主体、旧 activeBindingId、caCredentialRevision、双证指纹、action、近期证明关联 | 主体锁、资格版本、在途依赖、全局证书归属、唯一 ACTIVE |
| 投递/重投 | submissionId、base/targetRevision、projectId、supplierId、envelopeHash、purpose、operationId | 提交 revision、资格版本、截止及参与资格、资产与对象版本 |
| 补传 | 上述版本、目标 role、旧 envelopeHash、新 envelopeHash | 原角色明文锚点不变、其它角色及 sealedFields 完全不变、补传许可 |
| 回执 | submissionId/revision、envelopeHash、serverSubmittedAt、receiptNo、主体/项目 | 该版本已被正式接收；同版本回执幂等 |
| 解密提交 | 包版本、提交版本、openingSessionId/sessionRevision、各角色明文摘要/长度、fieldsCommit | 当前执行 fence、窗口/暂停/阶段、历史接收证书与当前签名资格 |
| 开标确认 | recordId/recordRevision、提交/开标会话版本、openingRecordHash（ERP快照含金额/单位/币种和全部唱标字段） | 当前记录、确认/异议状态、项目阶段及权限 |
| 评标澄清 | clarificationId/revision、正文摘要、排序去重的附件 ID/内容摘要、主体/项目 | 问题仍可回复、内容/附件未变、主体资格及问题版本 |
| 专家报告 | signPacketId/revision、文件摘要、专家/项目、purpose | 当前签字包版本、本人签署资格及工位会话 |

业务原文由服务端冻结后返回 `CaSignContext={operationId,purpose,canonical,encoding:'UTF-8',canonicalSha256,expiresAt,bindingId,signingFingerprint,businessVersion}`。业务提交统一带 `{operationId,signatureFormat:'scca-pkcs7-base64',signP7}` 及该业务必要的暂存资产引用；不接收自由 `toSign`。登录和绑定沿其 challengeId 契约，不混用 operationId。

撤回仍是现有账号权限操作，本期不增加 U盾签名要求，但必须校验 expectedRevision、参与主体锁，并使旧业务上下文失效。不能把它误列入强制 P7 动作。

### 2.3 文件、字段与密钥的准确边界

`dual-v3` 的文件角色固定为 `technical/business/coverLetter/bond`。每角色对应一个正式文件资产；当前完整/拆分模式的映射在前端和服务端共用，完整标书沿现有 `technical` 映射，其它角色按实际声明。v3 首期每角色至多一个正式文件；当前 UI 已有限制每类一个的逻辑，必须保持并在确认页列明实际签署文件；服务器新增拒绝多于一个、full/split 混用、other 与 coverLetter 冲突的校验，不能继续静默取第一个。旧记录仍按其原提交范围读取，不伪称旧附件都被签署。

文件每项独立保存 assetId、明文/内层/外层 SHA-256 与字节数、供应商 P7 包和管理方 SM2 包。`kadmin` 自带 adminCertId，不能从顶层统一推断历史管理钥。密钥内容统一为 `UTF8(canonicalJson({k:keyHex,iv:ivHex}))`，各值为 32 位小写 hex。P7 输入再做 Base64，原始 SM2 输入做 hex；禁止混淆文本与原始字节。

唱标 `sealedFields` 保持供应商**单层** SM4 密封，固定含 cipherFormat/cipher/cipherSha256/cipherBytes/kself，不增加管理方 kadmin。`fields` 明确为 `{price,amountUnit:'万元',currency:'CNY',deliveryPeriod,qualityCommitment}`；密封明文为 `canonicalJson({fields,nonce})`，cipherSha256 对 hex 解码的密文字节，信封顶层 fieldsCommit 为 `sha256(UTF8(canonicalJson(fields)+':'+nonce))`。nonce 为浏览器CSPRNG生成的16随机字节，在揭示前只存在于密封内容及当前操作内存中。v3删除旧公开 fieldsSha256：可预测的工期/质量加可枚举报价不能用无盐明文摘要保护；不通过加一个可见salt继续暴露。

**封标前草稿也适用保密边界。** 当前 `S/.../submit/page.tsx:679/693` 将 form 和 clientDeks 送入保存草稿，`A/supplier-portal/supplier-portal.service.ts:94/2262` 由服务器 KMS 处理报价，服务器已经看到明文。v3 草稿、prepare、signing-payload、submit DTO 全部拒绝报价/工期/质量明文字段和 clientDeks，不能仅在最终投递时删除 bidPrice。

- 字段规范化与价格预览在浏览器共享 schema 完成；prepare 不接收也不返回明文报价。开标揭示后服务器再验证相同字段 schema、单位和承诺。
- 新增独立 `SupplierBidDraftV3`（主体/项目唯一、draftRevision、文件候选引用、sealedFields、fieldsCommit、接收加密指纹、updatedAt），与正式 SubmissionVersion 分离。现有草稿 URL 按显式 `draftFormat='scca-draft-v1'` 分派，保存密封草稿不代表完成签名或正式投递。
- 云端草稿恢复要用原加密证书解包，并在客户端重算fieldsCommit比对草稿承诺，UI 明确告知；不能以当前 ACTIVE 证书覆盖原接收指纹。未解锁时显示密封字段，允许取消恢复，不能假装空报价保存覆盖旧值。
- CA 路径本地持久化只保存密封内容与公开引用，按用户/供应商/项目/格式/绑定版本隔离；不把 PIN、DEK、明文nonce、无盐唱标摘要或揭示后的字段写入 localStorage。成功、退出和切账号时清内存敏感值；旧 localStorage 不作为 CA 授权或正式证据来源。
- 从既有草稿转为 v3 必须先展示其曾经采用的存储方式，再显式重封为新草稿；不能追溯声称旧报价从未被服务器接收。

### 2.4 固定 API 组织与复用边界

认证、绑定、自检的具体新路由见第 4 节。业务上下文创建固定为 `POST /api/supplier-portal/bid-submissions/:projectId/operations/prepare`，动作白名单为 submit/reupload/decrypt-upload/receipt/opening-confirm；专家和澄清由各自已有 payload/提交路径接入相同 `CaOperationService`，不建立任意原文通用验签入口。

提交类 prepare 分配 submissionId/baseRevision/targetRevision/operationId，随后 `POST .../operations/:operationId/signing-payload` 接收最终候选信封，严格校验后冻结 canonical。非提交类基于当前权威数据在 prepare/payload 时直接冻结原文。每份冻结原文都以数据库中不可变对象或内容摘要为依据。

v3 加密文件先走新增 `POST /api/supplier-portal/bid-submissions/:projectId/encrypted-assets` 暂存，返回 fileAssetId、outerSha256、outerBytes、暂存到期与主体归属。新投递和补传均使用这一入口；既有 submit/reupload-dual URL 保留 legacy 分支，v3 使用 JSON body 引用已验证暂存资产，不能再次上传另一份与签名不一致的 file。旧 multipart 分支保持原约定，DTO/内容类型与明确的协议标识须相互一致。

解密后的明文仍走已有 decrypt-upload multipart，四个 file_* 字段与签署摘要一一匹配；不传 DEK。Multipart 的签名/信封等字段用专门 DTO 和限额校验，不能依赖 TypeScript inline 类型。所有新 DTO 精确验证必需字段与未知字段，不让 ValidationPipe 静默删掉关键 proof 后回落旧轨。

用户点击取消时：尚未提交的动作取消并清 pending；业务 HTTP 已发出则显示“结果待确认”，仅查询结果，不宣称服务器已撤回。服务端只允许 PREPARED/PAYLOAD_READY 且未被领取的 operation 原子取消，已 VERIFYING 的取消请求不保证撤销业务。

### 2.5 大小、时限与错误契约

以下是实施初始上限，阶段 0 用真实样本验证；若需要调整，在首次启用前同步全部端，不作为厂商已证明的最大值。

| 内容 | 初始约束 | 执行位置 |
|---|---|---|
| 单张 DER 证书 | 解码后 ≤64KiB，Base64 长度 ≤87384 字符 | DTO 及解析前严格 Base64 校验 |
| P7 签名 | Base64 ≤256KiB 字符，解码后 ≤192KiB | 登录/绑定/业务/自检统一常量 |
| 单个 P7 密钥包 | Base64 ≤64KiB 字符，解码后 ≤48KiB | 信封与开标包严格解析 |
| 信封 JSON | UTF-8 ≤1MiB | DTO、multipart field、准备服务 |
| CA/业务 JSON 请求 | ≤2MiB，另有上述字段限制 | 路由限额；不靠全局 HTTP_BODY_LIMIT=10mb 代替 |
| 单文件明文 | ≤50MiB | 文件选择、上传元数据、揭示上传 |
| 单文件外层密文 | ≤50MiB+32B；核对两次 PKCS#7 长度公式 | 新上传与补传 Multer/服务层 |
| 解密上传 | 至多4文件，各≤50MiB；明文字节总和≤200MiB；请求总量≤205MiB | 反代、Next、Multer/请求总量限制 |
| multipart | files≤4、文本fields≤8、parts≤12、单字段≤1MiB；额外按具体端点缩小 | 每个 interceptor，超限在解析前拒绝 |
| 字段密封件明文 | UTF-8 ≤16KiB，仍受价格/工期/质量字段各自限制 | 浏览器及揭示验证 |
| 挑战 / 近期凭据证明 | 120秒 / 300秒，过期重新签署；互不代用 | Redis 原子状态 |
| 单次 CA HTTP 调用 | 初始3秒连接、8秒调用总预算；无自动重试 | SccaGatewayClient，区别 JAR 的3秒读/连接默认 |
| CA验证阶段 / 普通CA JSON | 多次CA调用合计≤18秒 / API≤25秒 / 前端≥30秒 | 所有必需状态验证共用总预算 |
| 文件操作 | 上传/存储预算单独设置，不能沿用15秒；初始客户端上限180秒 | AbortSignal + operation结果恢复；生产压测后固定 |

原始 SDK 不带请求关联 ID，单页面共享一条受控队列；本机交互等待时间和云端 HTTP 时间分别计量。PIN 剩余次数只来自本机明确返回，不能从网关错误推算。解密租约采用独立 heartbeat/fence，详见第 5 节；租约结束不等于旧任务已经停止。

HTTP 错误沿用 `{statusCode,code,error,timestamp,path}`，新增受控 `details` 白名单：operationId、currentRevision、retryAfterSeconds、affectedItems、allowedActions、expectedFingerprint。PIN 错误细节只在前端本机错误对象中使用。`HttpExceptionFilter` 当前仅透传 itemIds/items，必须同步修改；普通日志不记录完整 details 中的敏感身份或待签内容。

`COMMITTED` 重试返回相同 operation 的既有结果且不再次调用 CA；未提交的认证 challenge 不复用。第一次请求超时不等于业务失败，前端先查结果。不同输入复用 operationId 返回409；409后重新拉取上下文并显式签署，不能自动替换数据重试。

### 2.6 数据约束与执行隔离的选定实现

保留 SupplierCert/ExpertCert 作为历史绑定表，新增 CaCertificate 与 **CaSigningCertificateClaim**，本期不再并行引入另一套 CaBinding 父表。Claim 以 certificateId 唯一，owner 为 supplierId/expertUserId 恰好一个（真实 FK + CHECK）；分别持有可空 supplierBindingId/expertBindingId FK，并检查与 owner 类型一致。增加复合外键：Claim的(supplierBindingId,supplierId,certificateId)引用SupplierCert的(id,supplierId,signingCaCertificateId)，专家同理引用(id,userId,signingCaCertificateId)，目标表补对应唯一约束，禁止主体/绑定/签名证书错配。活动时恰好一个绑定引用、解绑后两个引用均null，历史主体归属仍保留；关系删除RESTRICT。绑定、解绑和 Claim 状态在同一事务内修改。解绑仅清活动引用并保留历史归属，本期禁止自助跨主体转移，不以同名或同公钥推定关联。

每个主体最多一条 ACTIVE 绑定使用 PostgreSQL 部分唯一索引；主体的 `caCredentialRevision` 与 User/主体行锁保护换绑和所有新增签名依赖。统一锁顺序为 User → Supplier/专家主体 → 当前绑定/Claim → Submission/业务对象，避免不同流程反向取锁；事务冲突必须回滚且不能先发成功通知。

新增最小业务模型：CaOperation（主体、purpose、payloadHash、版本、状态、结果）、SubmissionVersion（不可变正式快照）、DecryptExecution（提交版本/phase唯一槽、attemptId、fence、leaseUntil）、CaEvidence/验证记录、CaExpiryReminder、事务 outbox、SupplierBidDraftV3。精确字段及旧模型迁移见第 4、5 节。数据库中记录的操作结果负责恢复，Redis 挑战不承担唯一的持久结果存储。

开标会话、唱标记录、澄清及专家签字包需要自身 revision/sourceRevision，不能用 submissionRevision 替代所有对象版本。版本变化后旧证据保留为历史；当前读端不得将旧确认、旧报价或旧AI结论拼进新提交。

## 3 前端 UI 与页面交互

### 3.1 代码发现与对应改造

1. **P1：取消必须撤销页面业务续跑，不能仅取消 WSS 命令。** S/app/(main)/bids/[id]/submit/page.tsx:764 设置 pendingSubmitRef，652 解锁完成立即 doSubmit，而 1135、1142 取消只关闭弹窗；澄清页 :149/175/342/349、回执详情 :336/362/901/908、opening-hall :254/280/692/699 同模式。已有方案的 transport generation 不能单独撤销已经完成 WSS、仍在等绑定查询/业务 prepare 的调用。新增页面 actionId/AbortSignal、每个 await 后校验 actionId；关闭/切项目/换账号/换 provider/卸载使 actionId 失效，清 PIN、pending 与会话引用。业务 POST 已发出后取消不承诺撤回，进入“结果待确认”，查询 operationId 后刷新权威结果，禁止提示“已取消且未提交”。
2. **P1：首次绑定资格、近期凭据验证缺少可消费的 UI/API 契约。** S/profile/ukey/page.tsx:221-227 直接 PoP，391-398 仅判断已绑定，没有业务资格/重认证步骤；A/supplier-portal/supplier-portal.controller.ts:175-190 仅取 supplierId，service.ts:813-817 只取 id/name。方案已提出资格与近期验证，但没有定义资格结果、禁用原因、挑战前顺序和临时供应商规则。应增加绑定资格预检/prepare，返回允许动作、稳定原因码、主体标识、近期证明状态、在途任务清单；明确正式/临时/待审/冻结/过期账号各自能否“查看、自检、绑定、签业务”，不能简单用 profile.status 一次前端判断替代。先通过近期账号验证，再签绑定挑战；执行端事务重查资格及证明，失败保留旧绑定。
3. **P1：CA 绑定写入后投标页仍可能认为未绑定，旧缓存又会把别人的证书带入。** S/submit/page.tsx:224 dualReady 只读 profile.sm2PublicKey，364/442 用该公钥封装；611 将加密公钥与签名公钥强制相等，不适用于双证；641 吞绑定查询失败后 643 回退全局 supplier_ukey_bound。S/profile/ukey/page.tsx:36、63-73 缓存无账号/provider 作用域，回执/澄清/开标也重复裸序列号回退。方案既要求不覆盖旧 sm2PublicKey，必须同时定义新业务能力投影（activeBinding+allowedEnvelopeVersions），双证各自匹配，CA 业务不得读 legacy 缓存授权。缓存加用户/供应商/provider/schemaVersion/caCredentialRevision，换绑及跨标签通知仅用于触发重新拉取；服务端查询失败显示“绑定状态未知”，不降级“未绑定”或使用旧缓存继续签。
4. **P1：专家现有错误状态会把查询失败当作需创建证书，真实 CA 无可到达的绑定入口。** E/app/(app)/evaluate/[id]/page.tsx:1159-1162 将 getExpertCert 网络失败变 need-cert，1194-1195 遇真盾指示拔盾/关闭驱动，1217-1219 没绑定时取最后一张；E/components/evaluate/report-step.tsx:144/154 仍“创建平台软证书并签署”。E/app/(app)/profile/page.tsx:10-49 仅资料，无证书管理。方案不能仅写“共用 provider”：个人中心新增 CA 卡与绑定向导，报告页未绑定跳向该入口并携 returnTo；绑定查询 error 独立于 none，保留重试；无适配证书显示“插入已绑定证书”，不取最后一张、不提示创建/拔盾。report state 还要区分本人 P7 已签、纸质登记、不可签、查询失败。
5. **P2：回执补签已有入口，但 revision 和未知结果会让入口/徽标错误。** S/app/(main)/bids/[id]/page.tsx:735/739/762 用单个 receiptSignature 隐藏补签；S/my-bids/page.tsx:279-285 同样仅布尔徽标；S/lib/api/supplier.ts:113-127 没 revision，verify 只有 signed/verified/reason。S/submit/page.tsx:785-806 投递成功后回执失败仍跳列表。要把 currentRevision、receiptStatus、receiptEvidenceId、canSignReceipt 与历史回执列表纳入读端；当前版本缺签时明确“标书已递交，回执待签”，列表按钮定位详情回执卡。签署超时先查结果，成功只补回执，不重投标书。旧版本签名不得满足新版本徽标；历史记录只读按所选 revision 核验。
6. **P2：真实证书会被错误隐藏，发行者显示也会错误。** S/utils/ukey-cert-match.ts:15-16 将 Subject.O 标为“签发机构”，25-27 用归一企业名 includes 判“本企业”；S/profile/ukey/page.tsx:116/366-405 直接隐藏不匹配证书；自检弹窗 :130-131 无匹配默认选第一张。应从解析证书的 issuer 字段显示发行者，Subject 只显示持有人；用 fingerprint 作 key。枚举阶段显示“尚未核验归属”，用途/算法不符保留禁用行和原因，不能拿 DN 名称猜归属或默认替人选双证。后端验证成功才标“与本账号主体一致”，并分别展示签名证书、加密证书及配对结果。

### 3.2 页面与状态契约

以下为待实施契约；类型名是前端视图模型，HTTP 字段以第 2、4、5 节为准。现存 URL 可保留，但新增写入必须显式区分 legacy/CA，不通过缺字段推断成功。

#### 共用视图模型与操作约定

- `CaUiContext`：`provider`、`userId`、`supplierId|expertId`、`caCredentialRevision`、`allowedActions[]`、`allowedEnvelopeVersions[]`。
- `device`：`unsupported|idle|connecting|ready|disconnected|error`；附 `observedAt`、已证实驱动版本、错误码。未知版本显示“未提供”。
- `localCertificates[]`：`fingerprint`、`purpose`、`containerRef`、`subject`、`issuer`、`serialHex`、`notBefore/notAfter`、支持能力。
- `binding`：`loading|none|active|revoked|error`；`activeBindingId`、`provider`、签名/加密证书投影、绑定修订号与历史记录。
- `trust`：`notChecked|checking|valid|expired|revoked|unsupported|unavailable`，附来源/检查时间；`unavailable` 不是 invalid。
- `operation`（页面状态）：`idle|preparing|awaitingPin|localRunning|serverVerifying|committing|succeeded|cancelled|failed|unknown`。
- 不把“驱动在线”显示成“CA 服务在线”；不把“已解锁”显示成“已绑定/证书有效”；历史证书能解密不代表允许新签。
- 共用证书选择器先枚举再选择；有唯一服务端绑定指纹时可预选，多个匹配容器让用户选；无匹配禁签，提供重新枚举。
- PIN 对所选容器一次尝试；空值/忙碌禁按钮；PIN 错误仅显式重试，剩余次数仅 SDK 明确提供时展示。断开WSS或清本页面PIN不代表驱动/全机已登出；未证实厂商退出行为前只显示“本页面连接已断开”，不承诺锁定其它标签或门户。
- 所有业务表单展示本次动作、项目/文档版本、当前签名证书简要身份；取消保留正文/附件/草稿，清 PIN 和挂起动作。
- `actionId`（浏览器）与 `operationId`（服务器）分开；换项目/换账号/取消使旧 actionId 的所有迟到回包失效。
- serverVerifying/committing 超时为 unknown；提供“查询提交结果”，查询确认未提交后才允许新 prepare、新签，不盲目重试签名。
- 供应商共享会话模块继续使用本标签 X-Supplier-Token；跨标签换绑广播只含公开主体/修订，不共享 PIN、adapter、token。
- 每次新操作重新查服务端能力和绑定；枚举缓存、storage 事件、focus 刷新仅改善反馈，不代替最终事务校验。
- `CaSignContext`：`operationId`、`purpose`、`canonical`、`encoding:"UTF-8"`、`canonicalSha256`、`expiresAt`、`bindingId`、`signingFingerprint`、`businessVersion`。
- CA 写入：`operationId`、`signatureFormat:"scca-pkcs7-base64", signP7`，业务目标/版本由 prepare 固定，不接受任意 canonical。
- 成功：`operationId`、`status:"COMMITTED"`、`businessId`、`businessVersion`、`evidenceId`、`serverAcceptedAt`，以及业务最终态。
- 失败：`code`、`message`、`retryable`、`operationId?`、`details?`；前端按 code 做唯一提示，不与全局 API toast 重复。
- HTTP `details` 统一为第2.5节白名单：资格 `allowedActions/affectedItems`，证书 `expectedFingerprint`，并发 `currentRevision`，恢复 `operationId/retryAfterSeconds`。其余展示从受保护能力/操作响应构建；PIN `retriesRemaining` 仅来自本机适配器，不进入HTTP详情。
- 全局异常过滤器要保留这些受控 details；不能继续只透传 itemIds/items，导致 UI 丢掉阻塞清单。
- HTTP client 支持 AbortSignal；postForm 透传取消且使用文件超时；CA JSON 超时与后端有界超时一致，不能固定 15 秒后直接认定失败。
- 登录请求识别覆盖 `/auth/ca/config`、`/auth/ca/challenge`、`/auth/ca/login`、`/auth/ca/result`，错误交登录 UI，不跳会话失效或把挑战错误吞成账号密码错误；result 专用请求与服务端均忽略旧标签token，只核门户cookie。

#### 页面映射表

| 页面/准确落点 | 用户操作与按钮 | 服务端契约/完成条件 | 历史与恢复 |
|---|---|---|---|
| S/app/(main)/profile/ukey/page.tsx:76、119、199、221 | 顶部四块拆成本机状态、当前绑定、签名证书、加密证书；“读取证书”不先索 PIN；“绑定/换绑”按资格启禁 | 扩展 listMyCerts 为版本化投影；新增资格/prepare 与近期凭据验证；绑定结果返回权威整组绑定 | 列表失败保留 error；历史行查看证书用途/旧业务依赖；解绑不等于删除解密私钥 |
| 同页 handleBind :221、handleRevoke :254 | 向导：资格检查→选择签名/加密证书→核对主体/用途→近期账号验证→挑战→PIN/PoP→确认结果 | prepare 固定主体与双证指纹；commit 消费近期证明和挑战并复查；阻塞清单带业务链接 | 业务POST前取消不换绑；POST后取消进入结果待确认，按operationId查询绑定结果；删除旧的“绑定成功再 revoke 查询”二次写入模式；换绑被挡保留原证 |
| S/components/profile/ca-selftest-dialog.tsx:92、135、155 | 名称改“CA 连接与加解密自检”；显示本机连接/签名/云端验证/证书状态/加密往返/SM4 分项 | purpose=self-test 专用挑战与验签；加密往返独立选加密证书；能力不支持显示 skipped+原因 | 自检通过仅代表所列链路；不提示“可用于投标”；关闭使回调失效，重开建立新测试批次 |
| S/app/login/page.tsx:92；S/lib/auth-context.tsx | 密码/CA 两个明确入口；CA 选择证书→挑战→PIN→签名→服务端登录；忙碌不能切方式 | 新 challenge/login 走共同会话完成处理、token 写入和角色路由；返回同类业务限制码 | 保留安全 redirect、待审/冻结提示、临时账号续期入口；证书未绑定提示先密码登录绑定；无自动密码降级 |
| S/app/(main)/bids/[id]/submit/page.tsx:224、602、632、760 | capability 决定 v3 投递；展示加密接收证书与签名证书；加密/上传/取上下文/签署/验证/正式接收分阶段 | prepare 返回 submissionId/baseRevision/targetRevision/operationId；commit CAS 后才显示正式递交 | 文件缓存按主体+项目+format+caCredentialRevision；旧 v2 条目不可改标 v3；取消不清草稿；冲突拉新状态并重签 |
| submit 同页 :785-806 | 正式递交后单独“签署本版本回执”，可取消，页面明确标书已成功 | receipt prepare/commit 带 submissionId+revision；签署成功更新 receiptStatus | 回执失败不再次 submit；结果待确认先查询；返回“我的投标”可看到待签入口 |
| S/app/(main)/my-bids/page.tsx:279-285、296 | 本版本回执徽标+“补签回执”链接，历史版本查看；v3 金额状态用统一版本判定 | 列表返回 currentRevision/currentReceiptStatus/canSignReceipt 及显式 amountUnit | 不能将任意旧 receiptSignature 视为当前已签；withdraw 后保留历史，只按服务端动作标记启按钮 |
| S/app/(main)/bids/[id]/page.tsx:333、370、734 | 回执卡显示提交版本、回执版本、签署状态；详情锚点供列表/提示跳转 | 取原文/签回执/复核接口均指定 revision；统一证据投影代替任意 JSON | 分开展示存档时验签、当前复核、当前证书状态；CA 不可达显示复核未完成，历史证据不改写 |
| S/components/opening-decrypt-card.tsx:111、166、188 | 先加载本次包版本→核验密文→按接收指纹选历史加密证书→解包→恢复明文→当前签名证书证明→上传 | OpeningPackage 增 submissionId/revision/openingSessionId/envelopeVersion/envelopeDigest；各文件与 sealedFields 自带 keyPackage.format/recipientFingerprint | 不用 profile.sm2PublicKey 选历史盾；签名与解密容器分别选择；错盾指向旧证书，不诱导换绑解决旧密文 |
| 同解密卡 :119-123、202-211、238-253 | 等待外层/窗口未开/暂停/窗口关闭/证书缺失/核验失败分别状态；缺密封验证不启上传 | 数据包缓存键含 revision+envelopeDigest，不能仅 assetId；验证/上传结果同版本 | revision 变化立即清 inner cache、seal results、revealedFields；旧异步下载不得覆盖新版本；SUCCESS+证据通过才成功 |
| 同解密卡 :270-311、397-424 | “重新密封补传”仅 allowedActions.reupload 启用；展示允许角色及保留报价说明 | 返回 reuploadAllowed/roles/reason；prepare 固定原版本；仅目标条目重封，整个新信封 P7 签署 | 保留全部 sealedFields 和未改角色的接收指纹；补传成功清旧缓存，等待主持重解外层；网关失败保留文件选择 |
| S/app/(main)/my-bids/[projectId]/opening-hall/page.tsx:250、288、390 | 解密成功后展示“核对并签署开标记录”；已确认缺证据才“补签确认”；暂停/记录变化禁旧操作 | prepare 绑定 openingSessionId、recordRevision、submissionRevision；commit 复查阶段、暂停、记录版本 | 记录变化提示重新核对并重签，不能签新内容沿用旧签名；历史确认显示旧证据，仍需当前版本证据才入评标 |
| S/app/(main)/my-bids/[projectId]/opening-confirm/page.tsx:11 | 保留旧地址重定向大厅 | 无需另做一套 CA 页面/API | 深链接参数带来的项目上下文仍由大厅校验 |
| S/app/(main)/bids/[id]/clarifications/page.tsx:143、184；S/lib/api/bid.ts:112 | 答复/附件上传完→服务端原文→确认→CA 签署；签署期间冻结所签正文/附件 | prepare 固定 clarificationId/revision、reply 摘要、attachmentIds+hash、operationId；提交 proof 替换裸 certSn/signature | 取消保留草稿；切另一问题使旧 actionId 失效；问题更新/已答复返回冲突；错误重试不创建重复答复 |
| S/components/tender-clarification-card.tsx:70、139-152 | 保留招标文件下载与下载回执 | 这是下载确认，不是评标澄清 P7 签名端点 | 不因都叫“澄清/回执”将现有非 CA 下载回执错误纳入签名 |
| E/app/(app)/profile/page.tsx:26 | 增个人 CA 卡、绑定向导、历史证书；从报告未绑定态跳来 | getExpertCert 返回 active/none/error 及 CA 证书投影；新增近期验证+个人身份可信映射+PoP | 不从姓名猜账号；不在报告签署途中创建软件证书；Windows 提供入口，平板解释返回桌面步骤 |
| E/app/login/page.tsx:76 | 专家 tab 增 CA 登录，保留管理员密码 tab；显示设备支持说明 | 共用 CA challenge/login，但门户 expert 及角色约束；复用现有 returnTo、SID/工位认证 | Windows→平板→Windows 流程沿用主持解锁与重新认证；平板不开移动 CA 功能 |
| E/app/(app)/evaluate/[id]/page.tsx:1147-1238；E/components/evaluate/report-step.tsx:135 | 状态细分 loading/error/need-binding/wait-packet/ready/signing/electronic-signed/paper-registered/not-signable | 专门读签署状态，不用 payload 接口异常猜；prepare 固定 signPacketId/hash/revision；CA proof 提交 | 网络失败不变未绑；签字包重生成旧操作失效并重签；查到电子签署成功后显示证据摘要 |
| E/components/exp-pin-dialog.tsx:33、51、63 | 复用选证/解锁视图；SDK 取消映射为 cancelled；busy 不可关闭不能当作取消机制 | 本地命令须可终止 generation；已发业务请求仍按 operationId 确认 | 关闭、错误、成功均清 PIN；不在仍挂起的后端请求结束前允许另一份重复签署 |

#### 状态转换与错误恢复

| 触发 | 操作终态 | 页面保留 | 下一步 |
|---|---|---|---|
| 不支持 Windows 客户端/未装驱动/WSS 信任失败 | failed(local) | 业务草稿、云端绑定 | 给对应排查项和重新检测；不能当“无证书” |
| 无盾/拔盾/容器消失 | failed(local) | 待签业务原文引用，清解锁态 | 插回后重新枚举、核对指纹、取新上下文 |
| PIN 错误 | failed(pin) | 所选证书，清 PIN | 只允许用户显式重试；锁定则联系 CA |
| 用户取消尚未 POST | cancelled | 草稿/附件、绑定不变 | 清 pending、PIN 与旧 action；新点击重新 prepare |
| 挑战过期/已消费 | failed(context) | 表单 | 重新拉挑战并显式签名，不重复送旧 P7 |
| 资格阻塞/在途依赖 | failed(eligibility) | 原绑定 | 清单带项目和业务动作入口，解决后刷新 |
| 云端不可达/请求超时 | unknown 或 failed(unavailable) | 本机状态仍在线、现存绑定 | 先查 operationId；确定失败才手动重试 |
| 当前版本/证书绑定已变 | failed(conflict) | 用户输入、历史证据 | 拉新权威快照，重新核对、重签；必要时重新密封 |
| 解密上传 HTTP 200/DANGER | failed(integrity) | 校验原因、归因状态 | 不提示成功、不启确认；按服务端许可补传/主持重置 |
| 服务器已成功但响应丢失 | succeeded(recovered) | 返回该版本结果 | 不重新签/重复投递；刷新对应列表徽标 |

### 3.3 UI 验收矩阵

| 场景 | 必须观察到的界面及数据结果 |
|---|---|
| 绑定页账号为待审/冻结/临时过期；临时有效账号 | 各按确定的业务政策返回资格；拒绝的绑定按钮有准确原因；绕 UI 提交同样拒绝；临时有效规则明确，不能一律当 APPROVED 正式账号 |
| 首次绑定、换绑、近期验证过期、在途旧签任务 | 独立账号验证步骤可执行；过期重做；阻塞清单可点击；原 ACTIVE 绑定完整保留 |
| 双证 Subject 名称不同、同发行者同序号展示、跨发行者同序号 | 不凭 CN 隐藏；签名/加密证书分卡；issuer 来自 issuer；指纹区分，无错误“签发机构” |
| 设备在线但 CA 云端断网 | 本机仍在线；云端不可用单独显示；不提示拔盾/重新安装，不允许假验签通过 |
| selftest 本机成功/云验签失败/加密证用途不符 | 分项结果准确；无“全部通过可投标”越权宣称；不创建绑定或会话 |
| 全局旧 supplier_ukey_bound 来自另一账号 | 不用于 CA 选证/加密；绑定查询失败禁止签署，显示 unknown/error |
| 多标签换绑/撤回重投、同门户换账号、跨门户同机用盾 | 当前操作旧 revision/actionId 失效；不能将旧签名套到新业务；其他门户状态不误称已退出 |
| PIN 弹窗关闭/ESC/遮罩取消后 WSS/绑定查询迟到 | 不提交投标、回执、开标确认或澄清；PIN/pending 清空；草稿保留 |
| POST 发出后用户取消/请求超时，服务端实际成功 | 显示结果待确认→恢复成功；没有重复提交/重复证据，没有假“已撤回” |
| 新 CA 绑定保留 legacy sm2PublicKey 空值或旧值 | 新业务仍按 activeBinding 能力启用 v3；不会跳“请先绑定”或用旧公钥加密 |
| 签名证书与加密证书不同公钥 | 投递正常；不触发旧 changed 公钥比较；每个密钥包记实际接收指纹 |
| 提交成功、回执取消/云故障、刷新/重进我的投标 | 显示本版本已递交且待签；补签直达详情卡；不要求重新上传标书 |
| v1 回执已签→撤回/重投 v2→v2 回执未签 | 只 v1 历史已签，当前徽标待签；补签/核验明确 revision |
| 过期历史加密证书仍在盾，当前签名证书已换 | 使用旧加密指纹开包、当前有效签名证明提交；无“请先换绑旧证”误导 |
| opening 包同 assetId 但 revision/envelopeDigest 变化 | 旧缓存和迟到 seal 结果丢弃；新版本重新校验，不上传旧结果 |
| 文件 hash 失败/下载不可用/HTTP200 DANGER | 三者区分；不把不可用算通过；提交签名或完整性任一不通过不能成功 |
| 单角色补传、另一角色/报价密封件引用历史证书 | UI 告知仍需历史盾；保留 sealedFields；仅许可角色可补传，成功重新等待外层 |
| 大厅已解密但未确认、确认过程中主持更新记录/暂停 | 仍提示确认待办；旧 canonical 被拒，重新核对；完成后可进入评标 |
| 澄清签名中切换问题/编辑附件/关闭弹窗 | 旧动作不落到新问题；保留原问题草稿；服务端按准备时摘要/版本拒绝变更 |
| 专家证书查询 503、未绑定、盾不匹配 | 分别 error/need-binding/missing-local；不“创建软证书”，不选最后一张 |
| 专家电子签署成功/纸质登记/签字包重生成 | 三态独立；新包必须重新签；页面不以 NOT_SIGNABLE 统称已签 |
| Windows 专家登录→平板迁移→返回 Windows 签署 | 旧 SID 不继续使用；主持解锁后重新认证，正确返回报告并签署；平板无假 CA 入口 |
| CA 匿名登录 401/挑战过期/续期/深链 | 由登录页显示准确错误，无全局登录循环；安全深链、临时续期与原会话约束一致 |

边界：Word/PDF/OFD 签章不在本次范围；不改变招标文件下载回执、采购邀请 RSVP 或中标通知确认的既有非 CA 语义。本文件所有“新增”均为待实施设计，Windows 真盾、云端响应及多标签互操作仍须实测。


## 4 认证、证书与数据迁移

### 4.1 代码发现与对应改造

1. **匿名会话仍缺 cookie/代理契约。** `auth.controller.ts:26–35` 登录 cookie 为 host-only、path=/；`auth/portal-cookie.ts:62–64` 信任 x-portal，供应商 `proxy.ts:50` 仅缺省补头；`proxy.ts:64–74` 用 Headers.forEach+set 透传响应。CA 挑战需专属按门户命名的匿名cookie与固定path；成功时登录cookie和清挑战cookie必须分别透传。portal声明不能承担来源证明。现main.ts:81–93仅CORS，app.module.ts:135–138无CSRF Guard，不能称已有完整CSRF。
2. **Supplier.status不是User状态的冗余副本。** `auth.service.ts:164–178`只查User启用/冻结及临时到期；`auth.guard.ts:51–58`也只查User；`supplier/supplier.service.ts:2334–2351`黑名单新入口仅改Supplier.status，而1660段旧入口才停用User。CA资格必须在发挑战、绑定事务、签发会话前分别核验关联Supplier=APPROVED及临时期限，不能认为沿用AuthGuard已覆盖。schema.prisma:1336用BLACKLIST，不是BLACKLISTED。
3. **仅在换绑加入门禁可被解绑绕过。** `supplier-portal.service.ts:979–990`先REVOKED再统计，且所谓pendingSubmissions只按certSn计全部记录，未限项目阶段；旧行无ACTIVE仍可随后走首次绑定。需让首次绑定、换绑、解绑、legacy→CA、CA→legacy共用按主体历史业务扫描门禁并锁主体，提交侧使用相同锁/版本规则。异常挂失另行停用，不能由普通解绑假装“无依赖”。
4. **两张绑定表约束不足且历史复用会改写证据身份。** schema.prisma:3717/3818仅各表certSn唯一，3733/3826没有ACTIVE部分唯一；两种不同证书同时绑定可各自成功。现supplier-portal.service.ts:839–854与expert.service.ts:2851–2857重激活原行并改写公钥/DN。新增全局签名证书主体占用表及每主体ACTIVE部分唯一；“无关联主体”明确为不同supplierId或不同专家userId，首期无跨角色共享例外，不能用同名/同公钥合并。
5. **x509是证书编码来源，不能当SCCA协议分类。** supplier-portal.service.ts:719–771把rawCert分支全部送raw-SM2 PoP；certSource='x509'后仍只取SM2 publicKey。原有真实DER行不等于P7行。迁移必须新增credentialScheme/proofFormat；现mock、x509均保留legacy-raw-sm2，不批量提为scca-pkcs7。专家目前仅姓名比对，无PoP（expert.service.ts:2814–2839），个人证书必须另走可信个人标识，不能复制此条件。
6. **“统一登录收尾”须包含网络期间变化与并发会话。** auth.controller.ts:164–190的专家seat检查与auth.service.ts:522–529的轮换是分离查询/写；CA远程耗时放大窗口。最终需锁User/主体、复查ACTIVE绑定/状态/资格，再完成seat检查与sid轮换；被拒不能轮换旧SID。schema.prisma:46–72和登录路径无mustChangePassword要求，不能编造CA登录强制改密现状；注册未审核及临时过期继续拒绝，账号无密码时首次绑定的近期账号凭据流程应显式不可用。

### 4.2 认证、绑定与数据库契约

#### A. 身份与会话条件
1. 首期CA登录仅支持supplier与bid_expert两类显式绑定账号，门户枚举仅supplier/expert；不接受客户端任意role、userId、supplierId决定身份。
2. 用户资格统一函数读取User.id/role/isActive/isFrozen/passwordChangedAt/webSessionId；供应商另读Supplier.status/creditCode/isTemporary/temporaryExpiresAt。
3. CA供应商登录与新增绑定要求Supplier.status=APPROVED，User启用且未冻结，临时期限未到；creditCode缺失不能绑定企业证书。
4. 既有密码登录可服务审核查询/补正，不因CA新增资格检查擅自删掉原有注册流程；CA没有自动注册、激活、转正能力。
5. 专家绑定从可信CA个人标识匹配ExpertProfile的受保护身份数据；缺失可信标识则本期不启用该证书绑定，不能假定现项目已有人工CA核验流程。姓名和历史评委别名不足以授权。
6. 新CA登录沿用现有专家工位锁及首登联系方式确认等页面流程，不自行添加“强制改密”规则；当前代码无该字段/门禁。
7. 绑定、换绑、解绑都要近期密码重证；无passwordHash账号返回REAUTH_UNAVAILABLE，引导既有账号恢复，不用CA自身签名替代首次账号归属证明。
8. 认证前后均不信任客户端账号或企业名称；只有通过网关的签名证书与数据库有效绑定共同决定账户。
9. User停用/冻结、passwordChangedAt变化、当前sid替换，均使未完成的绑定/解绑凭据证明失效。
10. 既有AuthGuard继续校验isActive/isFrozen/passwordChangedAt/sid；CA资格服务补足Supplier业务状态，不把它变成每次页面访问都查CA。

#### B. 接口与公开响应
11. 新增POST /api/auth/ca/challenge，@Public，DTO {provider:'scca',signCertDerBase64}，门户取服务端可信入口上下文。
12. 后端严格DER解析、取SHA256指纹并构造原文；此处不因为客户端自报证书就返回账户是否存在。
13. 返回 {challengeId,toSign,encoding:'UTF-8',signatureFormat:'scca-pkcs7-base64',expiresAt}，不返回账户、企业私密标识或绑定存在性。
14. toSign为保存的完整LOGONDATA:规范化上下文，包含version/purpose/portal/challengeId/nonce/expiresAt/signFingerprint；网关不再拼前缀。
15. 新增POST /api/auth/ca/login，@Public，DTO {challengeId,signP7}，只允许签已保存原文；无需第二份自由文本toSign。
16. 成功响应保持当前登录形状 {access_token,role,username}，同样写portal cookie；供应商必须rememberSupplierSession，专家复用现登录后续跳转。
17. 客户端API将/auth/ca/config、/auth/ca/challenge、/auth/ca/login、/auth/ca/result列入认证请求集合，401就地展示，不触发已登录会话过期重定向。POST /api/auth/ca/result DTO仅{challengeId}，用专用cookie认证（不走优先读取标签token的常规AuthGuard），仍校验精确来源、门户、当前SID/账号资格及sessionMeta.caLoginChallengeId；成功返回原会话登录形状，不轮换SID，错误不返回另一个挑战或账号的信息。
18. CA登录401不泄漏证书是否已绑定；原文验证通过后才给ACCOUNT_PENDING/ACCOUNT_FROZEN/TEMPORARY_EXPIRED等适用提示。
19. 新增POST /api/auth/ca/reauth，AuthGuard+Roles(supplier,bid_expert)+来源检查；DTO {password,action,targetBindingId?,expectedActiveBindingId?,signCertDerBase64?,encryptionCertDerBase64?}。
20. action仅bind/replace/revoke；主体从req.user映射，服务端从DER和目标记录算operationDigest，不能接受客户端裸digest代替核对。
21. reauth返回 {credentialProofId,operationDigest,expiresAt}，有效300秒，绑定userId/sid/portal/action/两证指纹/目标绑定及密码变更版本。
22. 绑定挑战新增POST /api/supplier-portal/profile/cert/ca-challenge；专家对应POST /api/expert/cert/ca-challenge。
23. DTO {credentialProofId}，服务端取proof中已固定的操作参数，创建持久CaOperation并关联challengeId，返回挑战通用结构和独立operationId；purpose为bind/replace且签名覆盖双证与绑定主体。后续提交按challengeId定位原文与operation，操作结果查询按operationId验证主体/门户归属。
24. 扩展既有POST /api/supplier-portal/profile/cert及POST /api/expert/cert为显式discriminated DTO；CA分支 {credentialScheme:'scca-pkcs7',challengeId,signP7,credentialProofId}。
25. Legacy分支只可在后端允许legacy写入的主体/环境使用；不能由客户端切signatureFormat绕过已切CA的账号策略。
26. 成功返回 {cert:CaBindingView,evidenceId}；主体/指纹/证书信息从保存上下文读取，提交不能更换待绑定证书。
27. CA解绑使用新增POST /api/supplier-portal/profile/cert/:id/revoke，DTO {credentialProofId}，要求proof.action=revoke且targetBindingId=:id。旧DELETE仅接受legacy绑定，JSON DTO同样消费{credentialProofId}（action=revoke且目标绑定匹配），并执行同一主体在途门禁；前端HTTP包装同步支持DELETE body，不把proof放URL。不得借旧端点撤CA绑定。专家新增POST /api/expert/cert/:id/revoke，规则相同。
28. 专家若增加解绑入口，使用同一凭据和历史保留规则；现仅get/post cert，不能文档宣称已支持delete。
29. 自检新增POST /api/ca/self-test/challenge及POST /api/ca/self-test/verify，AuthGuard+Roles(supplier,bid_expert)，前者固定所选签名指纹，后者仅challengeId/signP7。
30. 自检返回 {localResult?,gatewayResult,certificateStatus,verifiedAt,evidenceId?}，不建绑定、不签JWT；加解密往返结果是独立客户端测试值，不宣称服务端PoP。
31. CA绑定公开视图含kind:'ca'/provider/bindingId/status/boundAt/revokedAt/signingCertificate/encryptionCertificate?，证书投影含id/fingerprint/subjectDisplay/issuerDisplay/serialHex/notBefore/notAfter/usage/algorithm。
32. Legacy公开视图kind:'legacy'包含原certSn/certDn/publicKey/alg/certSource及历史有效期；调用者先收窄kind，禁止用空旧字段渲染“永久”。
33. 常规列表不返回DER、CA原始返回体及身份证号；授权的证书下载/证据读取另走明确端点。
34. 所有新body均使用class-validator DTO；现供应商绑定inline类型不受运行时字段校验，应一起替换。
35. 全部证书、P7、JSON大小使用第2.5节统一常量；阶段0样本验证后同步调整，不各入口分别定义上限。
36. Base64采用严格字符/填充/解码后字节上限检查，不只使用Buffer.from宽松解码；不全局抬高10MB请求体来支持P7。
37. 错误形状沿HttpExceptionFilter {statusCode,error,code,...}，扩展白名单details，包含operationId/retryAfterSeconds/affectedItems等明确结构。
38. CERT_DEPENDENCIES_PENDING返回409与details.affectedItems[{projectId,submissionId?,action,reason}]；不得暴露他人主体业务。
39. CA_VERIFY_UNAVAILABLE返回503，CA_CHALLENGE_EXPIRED/USED返回409，CA_CERT_MISMATCH返回400，CA_BINDING_CHANGED返回409，来源错误403，限流429。
40. 错误详情须经filter白名单，不能在service抛字段却被过滤器吞掉；前端依据code/details渲染。

#### C. 浏览器、Redis和来源边界
41. 匿名挑战cookie命名ca_browser_supplier/ca_browser_expert，256位随机，httpOnly、host-only、sameSite=lax、生产secure。
42. cookie显式path=/api/auth/ca/，maxAge建议10分钟；签名挑战120秒。后端仅保存browserCookie的SHA256，不把cookie值送入待签文本或JSON。
43. 登录成功写token_supplier/token_expert仍path=/，并以原path清匿名cookie；退出清登录cookie的既有路径规则不变。
44. Next代理逐条保留所有Set-Cookie头，不能以forEach/set合并；测试覆盖登录cookie+匿名cookie删除同时返回。
45. cookie不区分端口，故按门户命名不可省；跨子域则按当前host设置，禁止随意增加父域Domain。
46. CA认证/绑定/自检JSON写请求要求application/json和精确允许的Origin；业务multipart保留正确Content-Type并执行同一来源检查。浏览器写入不接受无Origin/Origin:null，CLI联调使用隔离测试配置。只读公开GET /auth/ca/config可无Origin，按校验后的Host/可信代理入口确定门户，仍不信任任意x-portal且不返回秘密。
47. sameSite与CORS不替代来源校验；可信代理覆盖x-portal并传受控入口信息，API直连不能凭自报头取得另一门户资格。
48. 登录用途校验匿名cookie哈希+入口origin+portal；绑定/自检用途校验userId+当前sid+portal；IP仅审计和限流，不作为唯一会话绑定。
49. Redis key隔离ca:challenge:v1:{id}、ca:credential-proof:v1:{id}；记录purpose/state/expiry/browserHash或userId/sid/portal/certFingerprints/exactToSign/operationDigest。
50. 登录挑战只有READY→CLAIMED→CONSUMED，Lua先比对用途与会话再原子抢占；不同流程不能互用同id。
51. 已CLAIMED的认证挑战不再次调用CA；失败、超时、进程中断不恢复READY。先确认是否已有成功会话/绑定结果，确未完成再获取新挑战并重新签名。持久业务operation的结果查询按第2节。
52. Redis不可用返回503，不得回落进程内map或放行；TTL删除只清理，不能充当并发控制。
53. 登录/绑定会话只在通过全部检查后写入；HTTP响应丢失不得复用同挑战重复轮换sid。
54. 凭据proof与绑定challenge在同Redis原子操作内校验并领取，失败同样失效；业务事务失败需要重新签署新上下文。
55. 限流建议challenge按IP+browser 10次/分钟，login按IP+browser 5次/分钟，result按IP+门户cookie哈希10次/分钟（无cookie亦按IP计数），reauth按user+sid 5次/5分钟，自检按user 5次/分钟。
56. 昂贵网关调用另设每用户/匿名会话并发1与全局并发上限；现Throttler默认进程内120/分钟不保证多实例共享限额。
57. CA新增限额用Redis跨实例计数，失败和未绑定尝试也计数；转发IP只信任部署中明确代理跳数。

#### D. 状态写入、换证与并发
58. CaVerificationService输出 {certificateFingerprint,verified:true,identity,trustChecks,checkedAt,validUntil,gatewayRequestId,protocolVersion,evidenceRef}，不暴露secret或鉴权字符串。
59. 网关耗时过程在数据库事务外；完成后事务重新读取User、主体、ACTIVE绑定和状态版本。
60. 登录完成事务按第2.6节顺序锁User及所需主体/绑定行；专家seat窗口检查及sid轮换在同序列化边界内，两个并发新登录不能都通过“尚无sid”的窗口。成功CA登录将sessionMeta.caLoginChallengeId随新SID同一次写入，保留现有设备快照字段；其它登录/换SID清除此旧关联。/auth/ca/result只恢复此当前SID的对应挑战结果，既有成功JWT响应可按同SID重新签发但不能轮换或恢复已替换SID。
61. 供应商登录前再核APPROVED/临时期限/绑定ACTIVE/证书有效期；冻结或解绑发生于验签等待期间必须拒绝。
62. 绑定、换绑、解绑事务锁主体与当前绑定；比较expectedActiveBindingId，冲突409，不把别人刚绑定的新证撤掉。
63. 在途依赖扫描按主体及历史绑定/提交快照读取，覆盖投递、补传、待签回执、开标确认、澄清；不只扫描当前ACTIVE证书。
64. 所有会新增上述依赖的业务提交与换证使用相同主体锁或资格版本CAS，消除“检查完无任务→并发投标→撤旧证”的窗口。
65. 普通解绑与首次CA启用均受相同在途门禁；直接调用旧delete/旧raw绑定接口也必须经过门禁。
66. 紧急遗失/泄露不走受在途门禁限制的普通解绑。首期由平台管理按现有账号冻结/停用能力立即阻止新登录与业务签署，并记录受影响业务；账号冻结可用 `auth/account-admin.controller.ts` 的现有路径，资格检查必须覆盖。CA机构吊销另按厂商流程办理，两者不混称。本期不承诺恢复旧私钥；后续解冻/换绑须先解决身份和在途异常，不因解除冻结自动换证。
67. 每次CA绑定/换绑创建新历史绑定行，旧行仅ACTIVE→REVOKED加revokedAt/reason/actor，不改证书引用、boundAt或旧证内容。
68. 数据库提交同写绑定、全局证书占用、证据索引、审计；不可先撤旧证再调CA，CA失败时旧绑定保持。
69. 绑定状态REVOKED含义只是ERP资格结束；CA吊销状态独立记录，历史解密资格由提交快照与异常策略决定。
70. 解绑后不要求立即结束全部普通页面会话，但所有新CA业务签名资格立即失效；既有密码会话沿现有ERP规则处理。

#### E. 最小数据模型及迁移约束
71. CaCertificate至少{id,provider,derBase64,sha256Fingerprint,issuerNameDerHash,issuerDisplay,serialHex,subjectDisplay,spkiAlgorithmOid,curveOid?,spkiSha256,keyUsage,extendedKeyUsage,notBefore,notAfter,createdAt}。
72. sha256Fingerprint全局唯一并使用固定小写64hex；DER不可变；notBefore<notAfter；serialHex按无符号整数去前导零并统一大小写（原始序列号字节另保留）。
73. issuerNameDerHash+serialHex用于查冲突，待证书链确认issuer证书/AuthorityKeyIdentifier后做发行者身份交叉核验；不使用展示DN字符串或裸serial全局唯一。
74. 同公钥可出现在续期/多用途证书，spkiSha256只建普通索引，不加全局唯一，也不凭相同公钥视为同一证书/同一主体。
75. CaCertificate不设单一usage枚举排斥合法多用途；用途由解析结果加厂商策略判定，绑定关系分别明确signing/encryption角色。
76. SupplierCert新增credentialScheme、signingCaCertificateId?、encryptionCaCertificateId?、bindingRevision、createdBy、revocationReason?；ExpertCert同签名字段。另给Supplier及User增加非负caCredentialRevision（供应商取前者、专家取后者），每次资格变更在同事务递增；bindingRevision记录建立时值，不能代替主体在解绑后仍存在的版本。
77. 检查约束：legacy行旧certSn/publicKey必有且CA引用空；CA行签名引用必有，供应商加密引用必有，旧certSn/publicKey等可空。
78. 原certSource保留mock/x509，仅表示旧声明/DER来源；新credentialScheme='legacy-raw-sm2'或'scca-pkcs7'决定协议，禁止只看rawCert存在判断。
79. PostgreSQL部分唯一索引保证SupplierCert(supplierId) WHERE bindingStatus='ACTIVE'、ExpertCert(userId)同规则；迁移SQL显式维护，不假定普通@@index能保证。
80. 新增CaSigningCertificateClaim全局占用表，采用第2.6节固定的certificateId、owner与分别有外键的supplierBindingId/expertBindingId；保存claimedAt、releaseAt及revision，主体归属保留。
81. exactly-one-owner检查使supplierId/expertUserId二者恰好一个；跨表统一服务在同事务更新claim与binding，防止同证跨两角色同时授权。
82. 本期固定为现两张历史绑定表加全局Claim，不另建CaBinding父表。原表各自的unique不能替代全局归属约束。
83. 首期同证只归单一supplierId或专家userId；即便名称或公钥一致也不自动认定“关联”；跨主体转移只能另走明确人工流程。
84. CaVerificationRecord至少{id,challengeId?,requestId,provider,protocolVersion,purpose,actorUserId?,subjectType,subjectId?,bindingId?,certFingerprint,operationDigest,toSignSha256,p7Sha256,result,statusSource,checkedAt,validUntil,evidenceAssetId,createdAt}。
85. requestId唯一；签名成功证据受权限控制保存exactToSign/UTF8编码/P7/DER链/验证范围，业务索引记录不可变引用；结果不覆盖历史成功记录。
86. CaCertificateIdentity记录可信标识种类/来源/issuer命名空间/受保护值或盲索引及验证记录，企业信用代码与个人证件号分别处理，不能只存displayName。
87. CaExpiryReminder至少{bindingId,certificateId,usage,stage,notifiedAt}，唯一(bindingId,certificateId,usage,stage)，写提醒与通知采用事务或outbox去重。
88. scheduler按双证各自notAfter、用途分页扫描，覆盖500条之后记录；历史解绑证书不再发新增资格提醒。
89. 迁移第一步统计同主体多ACTIVE、重复DER跨表、同issuer/serial但DER不同；输出冲突清单，不自动合并或任意撤一个。
90. 现所有SupplierCert/ExpertCert先标legacy-raw-sm2，包括certSource=x509；旧certSn、公钥、boundAt、状态与Supplier.sm2PublicKey保持原值。
91. 可为可解析旧DER建立CaCertificate去重事实记录，但不回填用于CA授权的绑定引用，不授予SCCA登录资格、双证配对或可信身份；原业务仍按legacy投影。
92. 先上线加表/引用及只读兼容，完成全部DTO/前端投影/scheduler/历史验签分派；后放宽旧列，再允许CA写入。
93. 保留legacy旧certSn原有唯一性；new CA行不占旧serial命名空间。原legacy同号复用逻辑仅用于历史legacy，CA分支必须新建行。
94. 不可用新CA公钥覆盖Supplier.sm2PublicKey；历史v2引用原certSn与归属，v3指绑定ID与指纹。
95. 有新CA行后禁止回滚为旧schema/旧API读取；回滚开关只禁新写，保留CA和v3读能力。

#### F. 网关和日志
96. SccaGatewayClient固定api/signature/verifyPkcs7，UTF8表单字段opType/requestId/signedData/toSign；鉴权HMAC-SHA1原文排序/跳空/值连接按主方案。
97. opType服务端固定映射，登录为登录签名；requestId后端生成；signedData取P7；toSign取保存精确原文，禁止从请求提供的toSign重建。
98. HTTP2xx、result_code成功和body.certBase64有效同时满足还不够，需确认原文验签及签名证书指纹相同、所需状态检查全部通过。
99. 如果响应没有requestId回显，不虚构该字段；关联靠本次HTTP调用的本地requestId及不可变证据，实际响应有则严格比对。
100. CA单次与组合调用、API和前端预算按第2.5节；多个证书状态查询共享预算，不能逐次叠加到前端已超时之后。
101. 超时或未知状态不重试同挑战；厂商requestId幂等未确认前禁止自动重试网关，提示重新发起。
102. PIN不进ERP DTO；日志中password/PIN/signP7/DER/rawCert/credentialProofId/nonce/toSign、Cookie/Authorization/登录access_token及网关鉴权头不记录正文。
103. operation-log自动记录req.body必须对所有CA与扩展绑定路径专用投影脱敏；普通日志只记操作ID、哈希、主体内部ID、结果码、耗时。
104. 证据存储与正常日志分离：确需保留完整P7/DER/原文只进受权限与保留策略管理的证据对象，错误日志也不dump网关原包。
105. 审计动作CA_CHALLENGE_CREATED/CA_LOGIN_SUCCESS/CA_LOGIN_FAILED/CA_BIND/CA_REPLACE/CA_REVOKE/CA_SELF_TEST需记录门户、操作者、绑定、证据、IP/UA及失败类别。
106. 失败审计不保存密码、匿名cookie、凭据proof和敏感身份；生产错误向用户只给约定code/details，不暴露网关secret或证书个人数据。

### 4.3 认证验收矩阵

| 层 | 场景 | 必须断言 |
|---|---|---|
| 会话 | 两门户/两标签、匿名cookie缺失/错path/过期、两个Set-Cookie | 每门户隔离；完整往返；登录cookie与删除cookie均生效 |
| 来源 | 同站不同端口伪造portal、外站JSON/simple POST、无Origin | 校验入口来源；不能靠x-portal越权或启动登录CSRF |
| 原子性 | challenge并发2次/超时/Redis失联/跨purpose | 最多一次CA调用与一次会话轮换，失联拒绝 |
| 账号 | User活跃+Supplier BLACKLIST、禁用、未审、临时到期、无creditCode | 明确业务资格拒绝，不因User.isActive放过 |
| 会话竞态 | 网关等待时冻结/解绑/改密/换SID；专家同时两设备登录 | 事务复核拒绝过时结果；锁内seat检查只允许合规会话 |
| 凭据 | proof跨用户/跨sid/改证书/改动作/过期/重用、无密码账号 | 绑定上下文不可变，不能套用旧proof |
| 迁移 | 原x509 DER行、mock行、重复ACTIVE、CA新行nullable | legacy语义保持，冲突先报；公开投影/提醒不读空公钥 |
| 唯一性 | 同主体绑两把盾、同证并发跨供应商/专家、不同issuer同serial、同key续期 | ACTIVE和全局占用约束生效；无错误serial/SPKI全局唯一 |
| 在途 | 先解绑再绑定、CA换legacy、撤旧后新任务竞态、历史归档 | 同门禁拒绝与事务回滚；只列仍需签署业务，不用总记录数代替 |
| 专家 | 同名不同人、身份缺失、工位锁、平板迁移后Windows重登 | 姓名不能授权；锁和迁移会话规则保持 |
| 协议 | 固定中文/&/+/换行HMAC向量、前缀一次、错toSign/错证书、未知状态 | SDK等价、准确原文、未知不当有效；无虚构响应字段 |
| 运行 | P7边界与超限、多实例限流、日志脱敏、提醒>500行及双证不同到期 | 有界资源、无敏感正文、双证独立通知且不漏分页 |


## 5 投递、开标、证据与后台任务

### 5.1 代码发现与对应改造

| 项 | 当前代码与触发 | 后果及需补的设计 |
|---|---|---|
| 1 解密接管缺少执行者隔离 | `apps/api/src/bid/bid-decrypt.service.ts:168/188/218/236/251` 用时间戳抢占、60秒接管，产物固定为 `bid-inner/project/supplier/role.inner`；供应商 `supplier-portal.service.ts:2715/2729/2785/2804` 同类逻辑，终局不校验领取者 | 同一revision的慢请求被接管后仍可写终局；只加revision CAS不能区分同版本两个attempt。补传后再剥外层还会向固定key再次create，碰FileAsset.key唯一约束。必须增加attempt fencing及不可变对象键；不得把RUNNING/skipped当完成。 |
| 2 重投/补传没有完整失效集合 | `supplier-portal.service.ts:2182/2220` 重投只换提交字段；`:2502/2515` 补传仅清outerDecryptedAt/innerAssets和BidSupplier解密态；`:3095` 撤回只改投递态 | packageFetchedAt、decryptedAssets/decryptedPrice、旧回执、开标确认及归因仍可能归属旧版本。已有“推进revision”没有规定跨表衍生状态如何失效，读端易拼出新密文+旧明文/确认。 |
| 3 密封件结构与角色约束仍不闭合 | `packages/ukey/src/types.ts:1/10` fields是单层且不含kadmin；`bid-decrypt.service.ts:160` 所有角色只用顶层adminCertId；`supplier-portal.service.ts:1991` 只做声明→信封单向校验；`:2337` 拒bond补传，但前端 `src/app/(main)/bids/[id]/submit/page.tsx:437` 已双层加密bond | v3单角色换管理钥后，其余旧角色必须用各自旧adminCertId；sealedFields不能套文件“双层”描述。额外角色/未绑定asset的条目可能到开标才失败；bond损坏缺恢复路。需明确typed wire schema和四角色统一策略。 |
| 4 上传和DTO限额并不一致 | `upload.controller.ts:89/103` 50MiB密文限制与自由query；`upload.service.ts:128/157` plaintextSha256可选；`supplier-portal.controller.ts:507/512/551/561` 补传/解密用匿名body且只限每文件；`dto/bid-submission.dto.ts:51` envelope:any、签名4096；`dto/opening-confirm.dto.ts:6`及`clarification-reply.dto.ts:29`签名512 | P7无法通用透传；50MiB明文经两层CBC至少多17、最多32字节，前端可选却服务端拒收；四文件请求最多约200MiB且缺总量约束。需明确传输限额、严格解码、白名单DTO及摘要语义。 |
| 5 已签原文尚不能完整证明业务事实 | `supplier-portal.service.ts:569/570` 回执的filesCommit实际取fieldsCommit，receivedAt用草稿createdAt；`opening-confirm-signature.util.ts:29` 只签amount不签amountUnit；`supplier-portal.service.ts:2705` fields只验证是对象；`:3341` 确认最终写入无记录版本/状态条件，`:4118` 澄清只校验待回复 | 回执未指向文件信封、接收时间失真；同一金额数字换单位后旧签名仍过；签名期间主持人修改唱标/供应商异议/项目归档可与旧校验结果竞争。需各动作canonical v2及跨表提交闸。 |
| 6 历史证据及后台补偿仍可失配 | `bid-backup/bid-backup.service.ts:135/159/212/226` 备份按供应商+项目+角色upsert，巡检仅三角色，补备依赖旧sealedKey且不读envelopeVersion；`bid/bid.service.ts:1187/5232` 归档取当前提交；`ai-bid-analysis/queues/bidder.processor.ts:30/101/111/149/307` 分次读文件/结构数据后按结果id写回 | 重投覆盖历史备份索引；bond缺备份无法补齐；v3 wrappedDek可能被补备误标旧cryptoVersion；AI可组合不同版本文件与唱标并保存。仅“升级worker”不足，应冻结输入快照并将版本写入结果、证据manifest和任务。 |
| 7 无盐唱标摘要抵消隐藏随机数承诺 | `S/utils/dual-envelope-core.ts:139/147` 的sealedFields.fieldsSha256公开sha256(canonicalJson(fields))，同份信封另有带nonce的fieldsCommit | 当工期/质量等可预测时可离线枚举报价。v3删除公开fieldsSha256，只保留密文摘要与隐藏随机数承诺，nonce与fields一起密封；草稿和metadata同样约束，旧v2不追溯改写。 |

### 5.2 业务与数据契约

#### A. dual-v3结构与规范字节

以下字段名为固定设计契约；v2读取保持原样，禁止依据对象形状猜版本。
- `version='dual-v3'`，`canonicalVersion='erp-json-v1'`，`provider='scca'`。
- `context={projectId,supplierId,submissionId,revision,signingBindingId,signingCertFingerprint}`；全部来自服务端准备上下文。
- `files`只能包含technical/business/coverLetter/bond四种role；每项必须对应一个本次声明且有权限的assetId，反向也必须成立。
- 每个文件项：`{assetId,plainSha256,plainBytes,innerSha256,innerBytes,outerSha256,outerBytes,kself,kadmin}`。
- `kself={format:'scca-pkcs7-base64',recipientCertFingerprint,value}`；fingerprint指加密证书。
- `kadmin={format:'sm2-c1c3c2-hex',adminCertId,value}`；主持端按每项ID读取历史管理钥，不能再只读取顶层ID一次。
- 新投递的各kadmin必须符合当前允许接收的管理钥策略；单角色补传只要求被替换角色用当前允许管理钥，其余逐字保留。
- `sealedFields={cipherFormat:'sm4-cbc-pkcs7-hex',cipher,cipherSha256,cipherBytes,kself}`，只有供应商层、没有kadmin和outerSha256；密封明文固定为UTF-8 canonicalJson({fields,nonce})。v3 schema拒绝额外fieldsSha256，不能复制v2无盐唱标摘要。
- cipherSha256只对hex解码的密文字节计算；开标前不上传或公开唱标明文的无盐摘要（含草稿/资产metadata/日志/网关原文）。旧v2按原字段与已签字节验证，明确不为旧数据补作保密保证。
- 两种密钥包装内部均是UTF-8 `canonicalJson({k:keyHex,iv:ivHex})`；k/iv各32位小写hex；P7的Base64不是hex。
- 文件SM4保持CBC/PKCS#7；strict hex/Base64解码、对象精确字段、长度及用途校验在分派前完成。
- v3 fields固定为`{price,amountUnit:'万元',currency:'CNY',deliveryPeriod,qualityCommitment}`；price为非负规范十进制字符串，禁止指数、逗号、单位后缀、NaN及浮点换算。
- price范围沿用业务12位整数/最多4位小数；由浏览器调用共享schema规范化、预览并密封，prepare不接收/返回报价明文；服务端开标揭示时验证，签完后不再trim、补字段或换单位。
- nonce为浏览器CSPRNG生成的16随机字节，编码小写hex（32字符）；新草稿或新投递密封重新生成，受限补传逐字保留；不是挑战operation nonce，禁止混用。nonce随fields一起加密，不放公开信封或开标前ERP请求。
- 信封顶层必有`fieldsCommit=sha256(UTF8(canonicalJson(fields)+':'+nonce))`，随整个信封签入envelopeHash；揭示时先验证已签cipher摘要/长度，再校验fields/nonce形状及重算commit。不能以新增无盐字段摘要替代该承诺。 客户端草稿恢复及opening-decrypt-card.tsx:231的v3分支改验commit，解密上传后服务器再独立复核；v2仍走原校验。
- JSON规则为递归键排序、数组顺序保留、UTF-8；v3拒绝未知字段/undefined/非字符串金额，不进行隐式Unicode或换行重写。
- bondRequired=true时bond为必需密封角色，与其它角色共享补传、解密、备份和恢复；false时本次不接收bond角色/asset声明。
- 旧轨bond仍按旧明文语义；这些角色不是证书的signing/encryption用途，也不是用户权限角色。

#### B. 上传及DTO的有界契约

- 新增`EncryptedBidUploadDto`：`projectId,role,format:'dual-v3-outer',plainSha256,plainBytes`必填；服务端实算outerSha256/outerBytes后返回不可变暂存asset。
- v3专用上传不依赖泛化`clientEncrypted=true`；category由端点决定为投标密文，校验主体/项目归属，并限制暂存有效期。
- 保留50MiB明文上限，v3外层上传允许最多50MiB+32B；验证两层长度关系：innerBytes=16*(floor(plainBytes/16)+1)，outerBytes=innerBytes+16。
- 补传与初传共享同一限额；解密上传单文件50MiB、最多4文件，明确总量200MiB及multipart开销余量、files/parts/fields/fieldSize上限。
- P7、信封和业务JSON上限统一使用第2.5节；阶段0实样确认后同步DTO、Multer、Next代理及反代。
- 严格验证Base64文本及解码大小，拒绝多余非Base64字符；大小限制在解析P7前执行；不通过全局10MiB body限制替代字段限额。当前安装busboy的`lib/types/multipart.js:251`默认fieldSize=1MiB，files/fields/parts无限；必须显式设定。供应商`next.config.ts:11`已有500MiB代理上限，仍应以应用总量政策为准。
- `SubmitBidV3Dto/ReuploadDualV3Dto/DecryptUploadV3Dto/ReceiptSignV2Dto/OpeningConfirmV2Dto/ClarificationReplyV2Dto`明确signatureFormat、operationId、revision等字段，均有装饰器。
- JSON信封使用嵌套schema精确校验；multipart的envelope/fieldsJson先限字节再parse再同schema校验，拒绝重复角色和多余文件。
- 明文上传不调用普通upload中的Office自动转换；摘要必须保持原提交字节。已有PDF版式要求是文件规则，与本期不做PDF/OFD电子签章是两件事。

#### C. 新API与前端状态（待实施）

| API/动作 | 请求/返回必须包含 | 业务效果 |
|---|---|---|
| `POST bid-submissions/:projectId/operations/prepare` | action=submit/reupload/decrypt-upload/receipt/opening-confirm；baseRevision、候选asset/role或recordRevision；返回operationId、服务端固定context、expiresAt | 仅准备，不改变正式业务状态；提交类先上传再取得context组装最终信封。 |
| `POST .../operations/:operationId/signing-payload` | 仅submit/reupload提交最终envelope；返回canonical文本/UTF-8摘要、signatureFormat及签名证书指纹。receipt/opening-confirm/decrypt-upload在prepare冻结；澄清/专家走各自payload | 校验候选资产/角色/业务范围后冻结原文；同operation不能换原文，确保浏览器签的就是服务端保存字节。 |
| 现有submit/reupload-dual/receipt-signature/opening-confirm/decrypt-upload端点的新分支 | operationId、signatureFormat、signP7；提交/补传引用已固定暂存asset，解密另带各file_*、fieldsJson、nonce；版本由operation固定，不接受任意toSign | CA验证在事务外；最终事务重新检查业务状态、资格、版本、租约，原子更新证据和结果。 |
| `GET /api/ca/operations/:operationId` | 返回PREPARED/PAYLOAD_READY/VERIFYING/COMMITTED/FAILED/EXPIRED/CANCELLED，业务结果revision/evidenceId/状态 | 请求超时后查结果；同operation同输入重发返回已提交结果，异输入409；不要盲目重新签署一次已成功业务。 |
| `GET .../opening-package` v3 | submissionId、revision、openingSessionId/sessionRevision、packageId、每role的inner asset/digest/length/kself、sealedFields | 客户端必须匹配历史加密证书；重新取包/版本改变时清缓存；密文下载与提交均固定版本。 |
| 现有主持端 decrypt-outer 路由（以 bid.controller.ts 声明为准） | expectedRevision（单家）或批量返回逐家revision/operation状态 | PROCESSING不能显示解密成功；READY才发包，FAILED提供可重试/需处理原因。 |
| 澄清reply-payload/reply v2 | clarificationRevision、operationId、reply digest、去重排序的attachmentId/hash、signingCertFingerprint | 不把整篇澄清明文发送CA：签服务器构造的上下文摘要；详细内容进入ERP不可变证据。 |

- 业务回执canonical固定`purpose='submission-receipt',submissionId,revision,envelopeHash,serverSubmittedAt,receiptNo,projectId,supplierId`，不得再用fieldsCommit冒充文件摘要或createdAt冒充接收时间。
- 开标确认在ERP内冻结包含amount/amountUnit/currency及全部唱标字段的完整记录快照；canonical只含purpose、recordId/recordRevision、submissionId/revision、openingSessionId/sessionRevision及openingRecordHash，不向CA发送报价明文。用户在ERP中核对完整快照，字段/单位变化会改变hash并要求重签。
- 澄清与确认的最终写入必须CAS其自身recordRevision/clarificationRevision，并重新核对项目阶段；submission revision本身不足以覆盖主持人编辑或异议变化。
- 解密证明绑定openingSessionId/sessionRevision、submission/revision、每role明文摘要/长度、fieldsCommit及当前签名证书；nonce揭示留在ERP，不发CA。
- 提交成功但回执签署失败：显示“投递成功，回执待签”，补签固定该成功revision；解密成功但确认未签：显示“待确认”，不得提前进入评标。

#### D. 并发、失败和清理

- 新增业务operation持久表；Redis挑战负责一次性证明，不承担数据库提交结果的唯一存储。
- 解外层/解明文分别使用`submissionId+revision+phase`唯一执行槽，领取生成attemptId及递增fence，带leaseUntil/heartbeat；不能把@updatedAt当专用心跳。
- CA超时或存储超时不会自动成为内容篡改DANGER；分为可重试技术失败、明确验签/完整性失败、业务版本冲突，界面说明处理路径。
- 60秒接管后旧attempt的成功、失败、释放锁、监督日志、通知都必须校验fence，不能覆盖新attempt；各角色输出写入带revision/attempt的独立对象键。
- 终局事务同时检查lease/fence、提交revision、sessionRevision和阶段/暂停/窗口；外部调用期间截止或暂停不以早先prepare结果放行。
- “重试返回SUCCESS”只针对已提交的同operation和同摘要；不同解密输入不得因已成功而被当作合法重复。
- 提交/补传/撤回的最终事务记录新revision，仅使依赖旧版本且未提交的operation及旧package使用资格失效；COMMITTED结果保留查询和相同请求幂等返回，禁止再次执行。读端按返回revision区分历史与当前，旧成功不代表新版本完成。只读历史证据仍可按历史revision访问。
- 新当前版本清空outerDecryptedAt、packageFetchedAt、innerAssets、decryptedAssets、decryptedPrice，重置BidSupplier解密/确认/归因及相应时间；旧值移入版本快照。
- 开标记录和确认签名关联sourceRevision；产生新版本时旧记录只保留历史，不继续显示为当前已确认。补传不删除原证据。
- 补传成功后对该新revision重新剥外层、揭示全部角色/唱标字段、重新确认；未改角色和sealedFields仍逐字相等。
- MinIO与DB不共享事务：先写attempt暂存对象、实算摘要，DB仅引用完整ready对象；commit失败只回收该attempt且无历史引用的对象。
- 发布通知/AI启动/autoHandoverIfDone改为事务outbox，事件携带revision及operationId；消费幂等，崩溃可补发，旧revision事件只作历史审计。
- 前端在prepare后冻结候选文件和金额；409版本冲突须重取上下文重签；网络未知只查operation结果，不再次自动触发U盾/PIN。

#### E. 模块/函数落点与历史证据

| 文件/函数 | 必须落实的改造 |
|---|---|
| `packages/ukey/src/types.ts/canonical.ts/sm-crypto-layer.ts` | v2/v3判别联合、严格解析、v3 canonical规则、字段和密钥包格式；管理层raw SM2与供应商P7分别分派。 |
| 供应商`utils/dual-envelope-core.ts`、`utils/dual-envelope.ts`及submit/page | prepare后组装含asset/版本的完整信封，SCCA加密证书封装四role和fields；缓存按revision/provider/证书分区。 |
| `supplier-portal.service.ts` submitBid/reuploadDualEnvelope/withdrawSubmission | 资产与角色双向校验，operation+CAS+跨表失效+证据快照；不复用可变FileAsset.sealedPath作为历史版本事实源。 |
| 同服务 getOpeningPackage/decryptUpload | 固定版本包、strict fields/nonce、P7解密证明、attempt租约与短事务终局；同operation查询和重试语义。 |
| 同服务 getReceiptPayloadFor/signSubmissionReceipt/confirmOpening/submitClarificationReply | 新canonical及各自对象版本，CaVerificationService，证据引用及动作幂等；历史分派按保存签名格式。 |
| `bid/bid-decrypt.service.ts` decryptOuter/decryptOuterOne | 每角色历史admin钥、fence、状态型响应、带版本/attempt的对象键；失败不能覆盖当前成功。 |
| `upload.controller/service.ts`及supplier DTO/controller | 专用上传metadata、摘要与字节大小、所有multipart严格DTO、P7有界限制、不可变暂存绑定。 |
| `bid-backup/bid-backup.service.ts` stageBackup/persistBackup/verify/reconcileMissing | 改按submissionId+revision+role唯一；四role巡检；从版本信封读wrappedDek及cryptoVersion；补传必须新建备份关联。 |
| `bid/bid.service.ts`开标文件包、ensureArchiveItems/archiveAll/exportArchive | 每个版本的信封、P7、证书、原文、验证结果、各层摘要、回执、开标证明/确认、澄清引用进入CA evidence manifest并入fileHashes；归档查manifest而非只查当前行。 |
| AI plaintext-fetcher/system-data-aggregator/BidderProcessor及独立worker | 入队冻结submissionRevision、openingRecordRevision、明文assetId/hash及单位；所有读/写带快照与fence；过期任务标STALE，不发布为当前评分。 |
| Prisma | SubmissionVersion、CaOperation、DecryptExecution执行槽、CaEvidence、Outbox及各对象revision/sourceRevision；文件和备份删除保护查询历史引用。 |

### 5.3 投标与开标验收矩阵

| 场景 | 必须结果 |
|---|---|
| 同revision解密超过60秒被接管，旧请求后成功或后失败 | 只有当前fence可终结；旧对象不覆盖、旧通知不发布，最终证据指同一attempt。 |
| 外层成功→异常补传→再次外层成功 | 无固定key唯一冲突；新内层asset独立，旧inner和明文仍可按历史版本核验。 |
| submit/withdraw/reupload并发、确认与异议/主持编辑并发 | 仅一个相同基准版本成功；失败方不改当前状态/证据/文件引用。 |
| 上传50MiB明文、50MiB+1明文；四角色含bond | 前者加32B外层可投递，后者前后端一致拒绝；总量/字段超限在解析前拒绝。 |
| bond必需/非必需；漏角色、多角色、asset角色互换 | 精确验证政策；bond异常能补传与补备，非必需不得偷偷加入。 |
| 管理钥轮换后只补传technical | technical用新管理钥，其余用各自历史钥；sealedFields及其供应商历史接收证书不变。 |
| P7超过旧512/4096但低于新上限；非法Base64及超上限 | 合法样本贯通所有动作；格式错/超限明确拒绝，不掉入raw SM2。 |
| 金额单位被改、price指数/前导零/超精度、nonce畸形、fields多字段 | 已签单位变动失效；非规范数据在密封/prepare或揭示前一致拒绝，v2读取不被新规则重解释。 |
| 固定工期/质量、枚举报价；检查所有开标前请求/DB/日志 | v3无fieldsSha256等无盐明文摘要、无公开nonce；相同fields每次重新密封产生不同commit/cipher，篡改fields或nonce揭示失败；旧v2保密限制明确。 |
| 回执先建草稿后提交、撤回重投、回执签署超时重试 | 使用权威提交时间及正确revision信封hash；已提交结果查询可恢复；旧回执不代表新投递。 |
| CA验证成功但DB失败/DB成功但响应丢失/存储半途失败 | 前者未完成且可重新准备；第二种同operation返回既有结果；第三种只清本attempt未引用对象，不误判伪造。 |
| 备份首次失败后定时补备、重投、bond恢复、归档导出后验hash | 正确v3格式及四role补齐，旧备份不被upsert覆盖；manifest完整且删除保护覆盖历史对象。 |
| AI读技术标后版本/唱标变更，迟到worker写结果 | 全程同一冻结快照；过期结果不冒充当前结论；API与所有worker均用新读规则。 |

## 6 横切代码、配置与运维

### 6.1 不能遗漏的代码范围

| 路径（仓库相对路径） | 具体工作与验收 |
|---|---|
| `packages/ukey/src/types.ts`、`canonical.ts`、`index.ts` | 导出判别联合、公共 schema/规范化、CaSignContext 与 v3 类型；旧 v2 字节保持不变；浏览器/API使用同一构建产物 |
| `packages/ukey/src/scca-ukey.ts`、`scca-transport.ts`（新增） | 控制 connect/enumerate/unlock/sign/wrap/unwrap/close；每次 await 校验连接代次；保持厂商 action/参数编码，禁递归PIN及自动重放 |
| `packages/ukey/src/ca-selftest.ts` | legacy与SCCA自检分别实现，云验签通过由后端结果决定；不得截取P7交raw-SM2验签 |
| `packages/client/src/index.ts`、`S/lib/api.ts`、`E/lib/api.ts` | 支持signal、超时及取消错误；postForm透传选项；识别CA登录请求；统一受控details，不因全局toast吞掉业务恢复提示 |
| `S/proxy.ts`、`S/next.config.ts`、专家对应配置 | 匿名客户端bundle可载入，精确来源/门户，全部Set-Cookie逐条透传；开发端口与生产域名分别验证 |
| `S/utils/ukey-factory.ts`、`use-ukey-health.ts`、`use-ukey-presence.ts`、`ukey-pop-bind.ts`、`ukey-cert-match.ts` | provider统一配置与单页面传输实例、先枚举再PIN、真实issuer/用途、无DN猜归属、关闭裸序列号缓存授权回退 |
| `A/ca/ca.module.ts`、`ca.controller.ts`、`scca-gateway.client.ts`、`ca-verification.service.ts`、`ca-challenge.service.ts`、`ca-evidence.service.ts`、`ca-operation.service.ts`、`ca-eligibility.service.ts`（新增） | 固定协议、挑战/操作结果分离、资格检查、可信身份/双证、持久证据；禁止一个“万能验签接口”接受任意用户原文 |
| `A/auth/auth.controller.ts`、`auth.service.ts`、`auth.guard.ts`、`portal-cookie.ts` | 共用登录收尾、锁内资格/SID/工位规则；新增匿名挑战cookie和近期凭据；不改变原密码登录可用的审核/补正路径 |
| `A/supplier-portal/supplier-portal.controller.ts`、`dto/*`、`supplier-portal.service.ts` | 各新/扩展契约有运行时schema；bind/revoke/草稿/submit/receipt/clarification/opening均严格分派；保持所属供应商检查 |
| `A/expert/expert.controller.ts`、`expert.service.ts`、`dto/*` | CA绑定与报告P7接口、个人可信身份；报告读状态与取payload分开；既有纸质登记保持独立 |
| `A/common/filters/http-exception.filter.ts`、`operation-log/log-entry.util.ts`、`sanitize.util.ts` | 新details白名单；CA及扩展业务路径按白名单摘要记录body，异常路径同样脱敏，禁止日志保留P7携带的原文/个人证件号 |
| `A/scheduler/scheduler.service.ts` | 双证到期分页扫描及提醒去重；操作/暂存对象回收必须先查历史引用，不误删长存证据 |
| `A/common/crypto/x509/*` | 元数据解析支持样本中的叶证书及链算法形态、算法参数、KeyUsage/EKU与身份OID；不能将现有65字节SM2解析器当通用X.509实现；厂商状态不足时启用被阻断 |
| `A/common/crypto/admin-keystore.service.ts` | 每角色按ID读取历史钥；生产启动/发布前检查活动及在途历史钥可读；多API实例具有一致的受控密钥挂载，缺钥不得静默生成替代钥继续处理旧件 |
| `A/app.module.ts`、`main.ts`、配置模板 | 注册CaModule、来源/限流/日志/请求限额；当前工作区main.ts另有用户改动，实现时最小合并，不覆盖 |
| `A/bid-backup/*`、`bid/*`、`archive/*`、`ai-bid-analysis/*` | 按第5节版本化输入、证据manifest和outbox消费；所有旧格式分支列入检查，不只更新服务端主入口 |

主方案已有网络限制：Linux 服务端主动出站到 CA；本机 WSS 不经服务器代理。检查 HTTPS 页面实际收到的 CSP/来源配置，不能因为 API 的 Helmet 允许 wss 就假定门户页面已经允许。生产本机端口仅依客户端使用条件开放，ERP 不要求服务器监听 36171。

### 6.2 配置与运行状态

以下为拟新增配置名，不在文档写真实值：`CA_PROVIDER`、`SCCA_GATEWAY_BASE_URL`、`SCCA_APP_ID`、`SCCA_APP_SECRET`、`CA_ALLOWED_ORIGINS`、`CA_LOGIN_ENABLED`、`CA_BINDING_ENABLED`、`CA_SUPPLIER_V3_ENABLED`、`CA_EXPERT_ENABLED`、`CA_PILOT_SUBJECT_IDS`、`CA_GATEWAY_MAX_CONCURRENCY` 及第2.5节限额/超时配置。只有公开能力接口可把经过筛选的可用状态传给浏览器；不得使用 NEXT_PUBLIC 前缀暴露凭据。

生产启用时验证：配置协议为开发包协议、地址HTTPS且在固定白名单、必需凭据齐全、所选算法和链/状态验证策略完整、数据库/Redis/MinIO及管理方钥可用、关闭演示自动回退。CA上游暂时不可用则readiness对CA能力报降级，相关新CA动作失败；不能把普通ERP页面全部变成不可访问，也不能把503误记为证书伪造。

供应商/专家CA业务的provider由服务端配置和主体能力决定；生产不展示自制盾选项让用户绕过。保留历史legacy解密能力不等于允许CA主体重新写legacy。关闭 `CA_SUPPLIER_V3_ENABLED` 只禁止新v3提交，已经存在的v3包、历史解密/证据读能力继续可用。

管理方密钥是本方案的真实恢复依赖。数据库备份脚本 `scripts/db-backup.sh` 只备份 PostgreSQL，不包含 MinIO、管理方 keystore 或配置。发布前制定并演练关联备份：数据库版本快照/证据索引 + MinIO原始密文/证据对象 + 历史管理方私钥 + 必要解密配置；恢复完成后用实际历史包核对，而非只确认 SQL 导入成功。供应商 U盾私钥不纳入 ERP 备份，不承诺可导出恢复。

后台记录至少包括按purpose的调用次数/耗时/失败码、证书状态查询失败、operation未完成、解密租约接管、备份补偿失败、陈旧AI结果、双证到期提醒。普通日志只记内部ID/摘要/结果；证据原文存受权限控制的对象，不通过运维日志导出。

### 6.3 发布顺序与回退

1. 在数据库副本盘点：重复ACTIVE、跨主体同证、旧x509、旧序列号、当前未开标/待签业务、四角色资产、现存备份与历史管理钥；冲突输出清单，禁止自动合并。
2. 增量迁移建新表/索引/版本字段并回填明确的legacy标识，依项目部署手册处理现存Prisma漂移；不在生产裸跑migrate dev或seed。
3. 部署兼容API、全部worker、全部读端及前端；开启新公开投影但禁CA写入；验证legacy登录、绑定列表、回执复验、v2投递/解密不变。
4. 在隔离账号开启绑定/登录/自检，完成协议等价、浏览器来源、双证归属及实盾验证。
5. 全部供应商动作、密封草稿、签名证据、备份/归档、并发恢复及AI读端验收后，才允许指定账号新v3投递；切换前门禁检查仍生效。
6. 专家个人证书样本/身份验证和Windows工位往返验收后再开专家签署；专家读v3标书必须在前一步已经完成。
7. 回退仅关闭新增写入能力，保留新表、类型读端、已签证据和解密能力；恢复备份或删除对象另属明确运维操作，不能把回滚代码当作可无损恢复全部业务。

## 7 验证方法与关闭条件

### 7.1 实施时必须新增或扩展的验证

| 层级 | 文件/测试落点 | 核心证明 |
|---|---|---|
| 协议/字节 | 拟新增 `A/ca/scca-gateway.client.spec.ts`、`packages/ukey`对应编码测试 | 字段排序/HMAC/UTF-8/Base64、原文前缀一次、错误原文拒绝、非法/超限输入、固定P7格式 |
| 设备交互 | 拟新增 `scca-transport`和适配器测试 | 无请求ID时排队、PIN一次尝试、generation取消、迟到响应、多证选择、无自动fallback |
| 身份/模型 | CA资格/绑定/challenge测试；已有auth/supplier/expert测试扩展 | 原子消费、cookie/来源、冻结与Supplier黑名单、唯一约束、解绑绕过、legacy/x509迁移、跨角色占用 |
| 投标/开标 | 已有 `supplier-portal.service.spec.ts`、`bid-decrypt`与dual-envelope测试；新增v3分支 | 四角色、密封草稿、三层摘要、revision/CAS、fence、签后状态变化、回执/确认单位与时间 |
| UI交互 | S已有`components/__tests__/opening-decrypt-card-error-state.test.tsx`及新增管理/登录/签名流程测试 | 按第3节矩阵实际触发取消、迟到Promise、unknown恢复、多标签缓存隔离、双证切换，不用仅匹配源码字符串代替行为测试 |
| 端到端 | 扩展 `apps/api/test/auth.e2e-spec.ts`、`opening-hall.e2e-spec.ts`、`clarification-reply.e2e-spec.ts`、`sealed-bid-backup.e2e-spec.ts`、`sign-packet.e2e-spec.ts` | 从账户到归档的完整路径，真实数据库唯一性/事务及跨实例Redis竞争；测试环境与正式数据隔离 |
| worker/恢复 | backup reconcile、AI processor/outbox测试及恢复演练 | 崩溃补偿、历史版本不覆盖、旧fence不发布、200MiB操作与资源上限、多实例钥一致 |
| Windows实盾 | 人工/自动化联调记录，记录客户端与浏览器版本、盾/证书指纹、用例结果 | 两把盾、双证、签名与P7封装、错误PIN、拔盾、TLS/权限、多标签、多门户、过期/吊销等效样本 |

构建时先按 package.json 重建 `@water-erp/ukey`、`@water-erp/shared`、`@water-erp/config`，如改 `@water-erp/client` 同步重建。随后构建 API 和受影响门户。仅运行 TypeScript 检查不能证明浏览器SSR加载、Cookie代理或实盾正常；完整跑通既有raw-SM2测试也不能证明P7协议兼容。

第3、4、5节的验收表是必须记录结果的清单。另补四项本轮横切用例：①v3保存草稿和准备请求抓包/数据库/日志中无明文price与clientDeks；②完整/拆分混传及角色冲突拒绝；③同时返回多个Set-Cookie确实落入浏览器；④数据库+对象+管理钥关联恢复后，新旧版本均能按预期解密与核验证据。

### 7.2 仍须厂商或实盾证明的条件

| 条件 | 所需证据 | 未满足时 |
|---|---|---|
| 测试/生产凭据与项目授权 | 开发包同协议可用凭据、生产HTTPS地址及允许调用范围 | 可写适配代码，相关环境不能启用 |
| `verifyPkcs7`准确原文和签名者语义 | 同P7+错误toSign必拒；返回证书与实际签名者一致；多签名/异常P7不会被含糊接受 | 不发登录会话、不接受业务签名 |
| 证书链、用途、状态、身份及双证配对 | 实际证书链/算法OID、可信身份字段与来源、过期/吊销/冻结样例或正式契约；certValidate覆盖边界 | 缺失项不能由NullRevocationChecker或空信任库代替，生产资格阻断 |
| 固定P7方法与加密封装互操作 | 示例SOFE_SignPKCS7Message flag0、实际算法满足策略、中文/换行/Unicode、密钥包往返 | 不自动更换API/flag，不宣称“P7就是SM2” |
| Windows客户端运行方式 | 安装/启动、支持浏览器版本、WSS信任与连接权限、是否共享登录态、可验证退出行为 | UI仅显示已观测能力，不虚构TTL、剩余次数或“全机已锁定” |
| 老证书与换盾 | 续期是否保留加密私钥、到期加密证书的实际解密能力及异常处理 | 不承诺旧标书必可解，切换前展示依赖并阻止不安全换绑 |

当前资料足以继续设计和实现适配层，不足以仅靠阅读证明以上运行条件。可信时间戳本期仍是“未提供”；当前验签、历史签署有效性、服务器记录时间分开描述。任何签名复核不能因为CA暂时不可用就把历史证据标为伪造。

### 7.3 本轮实际完成的检查

本轮检查的是源代码、DTO/schema、SDK约定与现有设计的一致性，并由三条独立审查覆盖UI、认证、投标开标。已用Python与Node分别核对同一虚构凭据HMAC-SHA1向量（包含中文、&、+、换行、空值），两端结果均为716b074d8034e83924c4bbc8fd08575260e22784；同时核对两次PKCS#7填充在0/1/15/16/17字节及50MiB边界的长度公式。同时用虚构报价103、固定工期30天/质量合格，在100至110候选中复现旧无盐摘要唯一匹配，确认其枚举风险；新承诺的两个不同隐藏nonce得到不同摘要。上述为本地协议/数学检查，不调用厂商、不证明测试凭据可用，也不替代密码实现审计。

本轮没有运行产品端到端测试、启动门户做像素验收、迁移数据库或连接Windows盾；没有修改产品代码。文档格式/链接及契约交叉校验通过，也不能宣称系统已经通过上述验收。开始实现以后，应逐条记录自动化与实盾结果；只有对应阶段清单全部通过或明确限制该功能不开放，才能关闭该阶段。
