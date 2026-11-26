# 设计：其余门户审计首批修复（七处）

> **状态**：已批准（2026-11-24），按 1 → 3 → 5 → 2 → 4 → 6 → 7 逐处出实施计划。
> **来源**：`docs/审查报告-其余门户与模块漏洞审计-2026-11-23.md` 第一节「先修这七处」。报告基线 `90df55299`；本设计对照的代码是 `cf661d075`——七处涉及的文件里只有公告模块（`announcement.service.ts`、`announcement.controller.ts`、`scheduler.service.ts` 及 :3005 的公告页与发布向导）在基线后被改过，行号有漂移，问题都在。
> **并行会话**：写本设计期间，另一会话在公告模块上连续提交了 `83ee4e6c0`、`cf661d075`。开工每一处之前先看 `git status`，对方有未提交改动时不碰工作区；公告模块的文件是重叠面。
> **用户裁定（2026-11-24）**：① 清空名单遇到在途或历史绑定即拒绝；② 密码重置批准后沿用申请人填的新密码；③ 七处按 1 → 3 → 5 → 2 → 4 → 6 → 7 做；④ 密码审批全由 admin 管理，不按目标账号分路（见 3.6）。
> 下文路径省略 `apps/api/src/` 前缀的，均在该目录下。

## 1. 要达成什么

封住报告七处对应的发现：8 条 P0 全部，P1 约 30 条，另有同根的 P2 / P3。每处能单独上线、单独回滚。

**本批不做**

- 报告里不在七处内的条目：O9-1（HTML 转 docx 死循环）、K2-1（演示账号）、Q7-3（基础设施缺省口令）、K3-1（移动端受限令牌）、13 项待裁定（含 O7-4）。
- 镜像与网关层加固：LibreOffice 以非 root 运行、CSP 收紧、CI 禁用 `execSync` 的 lint 闸。
- 下载密码（`metadata.downloadPassword`）的落库加密——本批只保证它不出公开端。

**怎样算失败**

- 合法流程被误拦：建项目带附件、发布向导「引用采购文件」、重进抽取页补拉联系方式、审批人日常审批、历史归档目录取件。
- 存量数据读不出来：按原始标题命名的历史归档目录、存量附件、存量审查任务、存量未审的重置申请。
- 为了堵洞，又新引入一处「信客户端」。

## 2. 三条通用做法

1. **客户端只拿记录 id。** 存储键、落盘路径、文件类型、大小、上传人一律以服务端记录为准，不再从请求里收（第 2、3、5 处）。
2. **落盘路径只出自一个解析函数。** 键先过白名单（前缀、字符集、拒 `..` 与绝对路径），再 resolve，再比对前缀（第 1、2 处）。
3. **归属判定只有一个来源。** 把现有守卫里的判定抽成可显式调用的函数，路由守卫做它的薄包装；项目 id 在请求体或查询串里的端点显式调用（第 7 处，第 4 处复用）。

## 3. 逐处设计

### 3.1 第 1 处：文件名不进 shell

封 P1-1、P1-2（P0）、P1-3（P1）。

**现状**

- `common/office-to-pdf.util.ts:47-57`：扩展名取上传文件名最后一个点之后的部分，拼进 `libreoffice` 的 `execSync` 字符串。
- 六个调用点：`upload/upload.service.ts:172`、`announcement/bid-document.service.ts:51、151`、`tender-write/tender-write.service.ts:299`、`bid/bid-sign-packet.service.ts:637`、`bid/opening-sign.service.ts:94`。
- `bid-document.service.ts:130-156`（发布招标文件「引用采购文件」）另有一面：源键取自公告 `metadata.selectedTenderObjectKey`，先按任意键读对象存储，失败再 `readFile(resolve(cwd,'uploads',键))`，两步都不校验。读到的东西会被加密成「公开范围」的招标文件。
- 仓库里已有同类转换的安全写法：`expert/expert.service.ts:1308-1330`（固定临时名、数组参数）。

**取舍**

- 同步 `execFileSync` 数组参数：封得住注入，改动最小；但同步调用在请求线程里最长阻塞 60 秒（P1-3），任何供应商上传一个大 Word 就能卡住整个 API。
- **异步加数组参数（选它）**：注入与阻塞一起解决。代价是要自己限并发——今天的 `execSync` 把全进程的转换意外串行化了，改异步后不再有这层意外保护。
- LibreOffice 以 root 解析不可信文档不在此处处理（镜像层，另案）。

**设计**

1. `convertOfficeToPdf` 改为异步，返回 `Promise<ConversionResult | null>`。
   - 扩展名只可能是 `doc`、`docx` 两个常量：声明类型是 docx 系取 `docx`，是 doc 系取 `doc`；声明类型不是 Office 类型时，只有文件名以 `.docx` / `.doc` 结尾才转换，其余返回 `null`。
   - 临时文件名固定为 `input.<扩展名>`。子进程用 `execFile` 数组参数，不经 shell。每次转换用独立的 LibreOffice 配置目录（`-env:UserInstallation=file://<临时目录>/profile`）。
   - 进程内并发上限 2。两个槽都忙时最多等 5 秒，仍拿不到槽就返回 `null`，不排长队；单次转换时限维持 60 秒不变。
   - 不排长队的原因：:3005 代理对 `/api/upload` 用的是 15 秒默认超时（`apps/web/src/proxy.ts` 的慢路径清单里没有它），等久了代理先报超时，而 API 仍在转换并存盘。这是既有状况，不是本批引入的，本批不扩面处理。
   - 返回 `null` 时各调用方的既有语义不变：通用上传、招标文件、文档编写导出、签字包存原文件；开标记录签字页抛 400 `PDF_CONVERT_FAILED`（`bid/opening-sign.service.ts:94-95`）。
   - 返回的展示文件名沿用现行为（`.doc` / `.docx` 换 `.pdf`），不再参与任何路径或命令。
2. 六个调用点加 `await`；相关单测里对它的桩改成可 `await` 的值。
3. `upload.service.ts` 的 `generateKey`：扩展名须匹配 `^[a-z0-9]{1,8}$`，否则取 `bin`。今天扩展名也取自上传文件名并进对象存储键。
4. `bid-document.service.ts` 的 `attachFromObject`：
   - 源键须以 `project-management/` 开头并过键字符集校验。校验器从 `announcement/dto/attach-from-object.dto.ts` 的正则抽到共用位置，两处同源。
   - 读取统一走 `readAttachmentBuffer`（本地读取有越界拦截，对象存储回退限前缀，见 3.2）。删掉「按任意键读对象存储」和裸 `readFile` 两步。
   - **不合规时的表现**：`attachFromObject` 抛 400，但它的三个调用点（`announcement.service.ts` 的 create、update 含定时发布、`syncChangeDocument`）都是尽力而为——捕获后只打警告。所以结果是公告照常发布、不产生招标文件。本批不在发布入口另加预检：那要动公告服务的三处入口，而该文件正被另一会话修改。警告日志带上错误码，便于发现篡改。

**验收**

- 单测：文件名在最后一个点之后带反引号、`$()`、分号、引号载荷，声明类型 msword——转换后标记文件不存在，子进程参数是数组，临时名是 `input.doc`。
- 单测：同时发起 5 个转换，任一时刻在跑的不超过 2 个；两个槽都被占满 5 秒以上时，后来的调用拿到 `null`。
- e2e：发布招标文件时 `metadata.selectedTenderObjectKey` 指向 `../.env`、绝对路径或非 `project-management/` 前缀——公告发布成功但没有招标文件，被指向的文件内容不出现在任何可下载对象里，日志有带错误码的警告。
- tsc 与现有 `upload.service.spec.ts`、`bid-document.service.spec.ts` 通过。

**留给实施**：并发上限与等槽时间是常量还是 env；`expert.service.ts` 的同类实现是否改为复用（默认不动）。

**另案**：发布入口对 `selectedTenderObjectKey` 做前置校验并回 400；`/api/upload` 加进 :3005 代理的慢路径清单。

### 3.2 第 2 处：建项目附件改为服务端登记

封 N3-1、N3-2、N5-1（P0）；N5-3、N9-1（P1）；N3-3、N15-1（P2）；N3-4（P3）。顺带封 N5-2（归档取件按标题找目录）。

**现状**

- 合法流程：`POST /project-management/extract-initiation`、`extract-demand`（`project-management.service.ts:1630、3518`）收文件，`persistUploadedFile` 以服务端生成的键落本地磁盘并写对象存储副本，把 `{fileName, objectKey, mimeType, fileSize, uploadedById}` 返回给前端，**不建数据库行**。
- 建项目 `createFromInitiation`（`:1403`）把前端回传的 `initiationAttachments[]` / `demandAttachments[]` 原样写进 `Attachment`（`:1572、1599`）。DTO（`dto/create-project-from-initiation.dto.ts:14-55`）五个字段只校验非空。
- 读取面：`ensureAttachmentLocal`（`:7935-7942`）对 `resolve(cwd,'uploads',键)` 只做 `stat`；删除面：`:6634、6668、8039` 直接 `unlink` 同款路径；对象存储回退 `common/attachment-object-store.ts:34-47` 按原始键取对象。`readAttachmentBuffer` 自带本地越界拦截（母版 I-1 修复），但绕过它的路径没有。
- 归档：`generateArchiveFiles`（`:4885` 起）用 `project.title` 当目录名（`createUniqueProjectDir :5072`）、用 `att.fileName` 当目的文件名（`:5042`）；取件 `serveArchiveFile`（`:6422`）同样直接拼。归档包导出 `archive/archive-export.service.ts:121-123` 的条目名也没洗。
- 开发库 79 条 `Attachment` 键全是 `project-management/` 前缀，其中 1 条未挂项目。生产库没查。

**取舍**

- 只校验键格式、不改接口：改动最小，能挡路径穿越；但证明不了「这个键是发给这个人的」，文件名、类型、大小仍是客户端说了算。
- **暂存行（选它）**：上传解析时就登记属主，建项目只认 id。不加表、不加列（`Attachment.projectManagementItemId` 本来可空），顺带让「解析后没建项目」的孤儿文件可以被清理。
- Redis 暂存或签名令牌：也能绑定属主，但引入新的失败点或新的密钥用途，没有额外好处。

**设计**

1. **上传即登记。** `extractInitiationFromUploadedFile` / `extractDemandFromUploadedFile` 在 `persistUploadedFile` 之后创建一条 `Attachment` 行：`projectManagementItemId`、`projectManagementStageId` 为空，`attachmentType='SUPPORTING_MATERIAL'`，`fileName`、`objectKey` 取落盘结果，`mimeType` 取内容识别结果（识别不出取声明类型），`fileSize` 取实际字节数，`uploadedById` 取登录人。返回的 `attachment` 对象带 `id`。
2. **建项目只认 id。**
   - DTO 的 `InitiationAttachmentDto`、`DemandAttachmentDto` 换成引用型 `{ attachmentId }`；`CreateProjectFromInitiationDto.createdById` 删除（控制器 `:165` 已用登录人覆盖）。
   - `createFromInitiation` 在事务内逐条认领：`UPDATE … WHERE id = ? AND projectManagementItemId IS NULL AND uploadedById = 登录人`，命中 0 行即 400 `ATTACHMENT_NOT_CLAIMABLE`，整体回滚。文件名、键、类型、大小、上传人一律取行内值。
   - 前端：`apps/web/src/components/projects/create-project-dialog.tsx:415-417` 与 `apps/web/src/lib/api/project-management.ts`，提交时映射成 `{ attachmentId }`。
3. **单一解析函数。** `common/attachment-object-store.ts` 新增：
   - `resolveLocalAttachmentPath(objectKey)`：键须匹配 `^(project-management|tender-doc-versions|uploads)/` 且字符集合法、不含 `..` 段、不以 `/` 开头、不含反斜杠；再 resolve 到 `uploads/` 下并比对前缀。违规一律 400 `INVALID_OBJECT_KEY`。
   - `removeAttachmentFiles(objectKey)`：本地删除经上面的解析器；对象存储删除只对白名单前缀生效。
   - `readAttachmentBuffer` 的本地读取与对象存储回退改用它。
   - `project-management.service.ts` 的 `:6634、6668、7936、8039、8400、8403` 六处裸 `resolve(process.cwd(),'uploads',…)` 全部替换。
   - 白名单含 `uploads/` 是因为非招标成交登记（`bid/non-tender-deal.service.ts:77`）把通用上传的文件挂成了定标附件。
4. **归档清洗。**
   - `safeDirSegment(title)`：去掉路径分隔符与控制字符、首尾点与空白；结果为空或仍是 `..` 时回退项目编号；限长 120 字符。目录名继续用项目标题，不改成编号——归档人员按标题找目录。
   - `safeFileName(name)`：取 basename，同款清洗，保留扩展名。
   - 写入侧（`generateArchiveFiles`）与读取侧（`getArchiveDetail` 的候选目录、`serveArchiveFile`）共用。读取侧的候选目录同时试「原标题」与「清洗后标题」，兼容按原标题命名的存量目录。
   - `serveArchiveFile` 改为按归档钩子定位目录（把 `getArchiveDetail` 里的定位逻辑抽成一个函数）。
   - `archive-export.service.ts:121-123` 的条目名过 `safeFileName`。
5. **附件类型按内容识别。** `getAttachmentFile`（`:7959`）返回前用 3.5 的 `detectMimeByMagic` 识别；控制器 `:467-468` 只对 PDF 与图片用 inline，其余 `attachment` 加 `application/octet-stream`；响应恒带 `X-Content-Type-Options: nosniff`。
6. **清理。** `scheduler` 增一个定时任务：删除超过 7 天仍未挂项目的暂存行及其本地文件、对象存储副本。

**验收**

- e2e：用接口直接建项目，附件位置带 `/proc/self/environ`、`../探针`、`knowledge/x` 三种键或别人的暂存 id——全部 400；`extract-initiation` 返回里不含可伪造的入库路径；读附件、删附件后探针文件原样存在。
- 单测加 e2e：标题 `../../x`、附件名 `a/../../b`——归档目录与归档包条目名都落在归档根目录内；按原标题命名的存量归档目录仍能取件。
- 页面走查：新建项目带需求表与立项表、流标重采对话框（`abort-restart-dialog.tsx`，它只用解析结果、不建项目）。
- `common/attachment-object-store.spec.ts` 补白名单与越界用例。

**留给实施**：认领的 SQL 写法（`updateMany` 返回计数或事务内 `SELECT … FOR UPDATE`）；清理任务的执行时刻。

### 3.3 第 3 处：文档审查只收上传记录 id

封 O1-1（P0）、O1-2（P1）。

**现状**

- `POST /tender-review/review/upload`（`tender-review/tender-review.controller.ts:464-488`）把文件存到 `review/<时间戳>_<原始文件名>`，把 `objectKey` 原样返回，不建属主记录。
- `POST /tender-review/review/execute`（`:490-533`）裸收 `objectKey` 存入 `ReviewTask`。之后的下载（`:994`）、备份 `<键>.original`（`:825-843`）、覆盖写（`:846-880`）、回滚（`:885-974`）都作用于这个键。`storage/storage.service.ts` 对键没有任何限制。

**取舍**

- 只加 `review/` 前缀校验：改动最小，但别人上传的文件仍可被引用（键含时间戳与文件名，可猜）。
- **登记为文件记录（选它）**：与通用上传同一套属主模型，不加表。`FileAsset` 已有 `uploaderId`。
- 新建专用表：多一次迁移，没有额外收益。

**设计**

1. `review/upload`：
   - 对象键改为 `review/<yyyy-MM-dd>/<16 字节随机>.<扩展名>`，不再带用户原始文件名。
   - 建 `FileAsset`：`category='tender_review_source'`，`uploaderId` 取登录人，`mimeType` 限 pdf / docx / doc / txt 四种声明类型，`size`、`sha256` 实算。
   - 响应新增 `fileId`，保留 `documentName`、`content`、`contentLength`，**不再返回 `objectKey`**。
2. `ExecuteReviewDto`：删 `objectKey`，加可选的 `fileId`。服务端按 `fileId` 取 `FileAsset`，要求类目是 `tender_review_source` 且 `uploaderId` 是本人（admin 例外）；任务的 `objectKey` 取资产行里的键。不带 `fileId` 即纯文本审查，`objectKey` 为空串。
3. 前缀底线：审查模块内所有 `storage.*` 调用前过 `assertReviewObjectKey`（`^review/` 开头、字符集合法、不含 `..`）。`storage.service.ts` 加通用底线：键非空、不含 `..` 段、不以 `/` 开头、不含反斜杠。
4. 可下载范围不扩大：`UPLOAD_CATEGORIES` 加入新类目；`upload.service.ts` 的 `canAccessFile` 加分支——该类目仅上传者本人与 admin 可下。不加这条，登记成 `FileAsset` 反而会让它落进内部角色的兜底放行。
5. 前端：`apps/web/src/lib/api/review.ts:21-53`、`components/tender-review/review-workspace-content.tsx:75`、`project-review-flow.tsx:146`、`lib/types/tender-review.ts`，改为传 `fileId`。
6. 存量任务的键形如 `review/<时间戳>_<文件名>`，仍满足前缀，不迁移。

**验收**

- e2e：`execute` 带 `fileId` 指向别人的审查上传、或指向其他类目的资产——403 / 400；任务对象键因此不可能指向模块外。
- e2e：给他司对象的 `objectKey`（直调旧字段）——被 DTO 白名单剥掉，任务无文件。
- 单测：`assertReviewObjectKey` 对 `../`、绝对路径、其他前缀一律拒。
- tsc 与 `tender-review.controller.spec.ts`、`upload.service.spec.ts`、`upload-categories.spec.ts` 通过。

**留给实施**：`FileAsset` 是否对该类目做服务端密封（现状是明文存 `review/`，默认保持）。

### 3.4 第 4 处：专家库的破坏性动作与留痕

封 M3-1（P0）；M1-1、M4-1、M5-2（P1）；M4-3（P2）。

**现状**

- 清空名单（`expert/expert-admin.service.ts:3781`）的注释与界面都写「评审记录保留」，但删用户行会级联删 `"BidExpert".userId`（开发库外键删除规则为 Cascade），工作位及挂在下面的评分链一起没。
- 「从种子导入」（`expert-admin.controller.ts:505-510`，服务 `:925-1003`）读的是废弃快照 `User.json` / `ExpertProfile.json`，全程无审计；前端没有调用方，只在 `apps/web/src/proxy.ts:44` 的路径白名单里出现。
- 批量画像 `POST /expert-admin/extract/profiles`（`expert-extraction.service.ts:838`）收任意 userId，返回明文手机，无留痕。
- 录入专家的口令链 `dto.password || dto.idNumber || 'expert@2026'`（`:705`），证号可空。

**取舍：清空名单遇到上过项目的专家**

- **有绑定即拒绝（用户选定）**：清空只对从没上过项目的专家生效，上过项目的走「退库」。不动表。
- 删账号、留评标记录：要把工作位的专家列改可空并让所有读评分记录的地方容忍「专家已删」，面很大。
- 不删账号、标记为已清除：各导入入口都要加「同名复活」逻辑。

**设计**

1. **清空名单。** 挡闸从「绑定开标 / 评标中项目」扩为「存在任一未婉拒（`invitationStatus != 'declined'`）的工作位绑定，不论项目阶段，含已归档与流标」。命中即 409 `EXPERT_HAS_REVIEW_HISTORY`，文案点名前 3 人并指引改用退库。确认词、勾选集校验、审计断链、`ReviewTask` 清理、整体回滚都不变。前端弹窗说明与成功提示（`apps/web/src/app/(main)/expert/repository/page.tsx:155`）同步。
2. **种子导入下线。** 删端点、服务方法、`proxy.ts` 白名单项。
3. **批量画像。**
   - 请求体改为 `{ projectId, userIds }`，`projectId` 必填并过项目归属断言（3.7 的函数）。
   - 逐人判定：在本项目工作位名单内，或属操作人公司视野（admin 不限）——返回明文电话并写一条 `SensitiveAccessLog`（字段 phone）；其余人照常返回五项指标，但电话是掩码，不留痕。
   - 之所以不是「只许本项目名单」：前端重进抽取页时还会给需求方代表补拉联系方式（`apps/web/src/app/(main)/expert/extract/page.tsx:1435-1441`），而需求方代表在确认抽取前不在名单里；临时代表建号时的公司归属取自其单位名（`:858-870`），按公司判也盖不住。掩码是给这条路径留的退路。
   - 前端 `apps/web/src/lib/api/expert.ts:207` 与调用处带上 `projectId`。
4. **证号必填。** `CreateExpertDto.idNumber` 改必填，格式 `^(\d{15}|\d{17}[\dXx])$`；口令链去掉 `expert@2026` 回退；CSV 导入缺证号的行进错误清单、不入库；DTO 与代码注释里的回退说明同步。专家口令等于身份证号是有意设计，不动。
5. **存量核对脚本。** 交付一个只读脚本：离线比对库内专家账号口令是否等于 `expert@2026`，只输出计数。生产部署后跑一次。

**验收**

- 单测（`expert-admin.clear-roster.spec.ts`）：专家有已归档项目的 `confirmed` 工作位——拒绝；只有 `declined` 绑定——放行且工作位行被删；在评项目——仍拒绝。
- e2e：`import-from-seed`——404。
- e2e：他公司 staff 调 `extract/profiles`——403；本公司项目带名单外专家——该人电话为掩码且无留痕；名单内专家——明文且有留痕。
- e2e：录入专家不带证号——400；CSV 导入缺证号行被拒。
- 页面走查：抽取向导重进（含需求方代表）。

**留给实施**：18 位证号是否做校验位校验（默认不做，只做格式）。

### 3.5 第 5 处：公告附件与公开投影

封 I4-1（P0）；I3-1、I5-1（P1）；I3-2（P2）。

**现状**

- 按文件 id 挂附件（`announcement/announcement-attachment.service.ts:32`）只查资产存在；删除（`:109`）会连源文件对象与 `FileAsset` 行一起删。
- 合法的挂载流程只有一条：`/upload?category=announcement` 上传后按 id 挂（`announcement-publish-wizard.tsx:1081`、`notice/[id]/page.tsx:804`、`notice/new`）。
- 「引用采购文件」（`:47`）已有源前缀白名单与越界拦截，但 `mimeType`、`size` 取自请求。
- 公开端 `stripForPublic`（`announcement.service.ts:700`）只剥 `bidDocument`，其余列与整个 `metadata` 原样返回，其中包括下载密码、阳光推送结果、回收快照。
- 下载（`:183`）按行内类型 inline 渲染。公告类目的扩展白名单（`upload/attachment-rules.ts`）不含 html / svg，所以伪造只能走「白名单扩展名加自报类型加 HTML 内容」这一条；全局 CSP 允许内联脚本。

**取舍：挂载接口怎么收**

- **收编（选它）**：只收公告类目、本人上传、未被引用的资产，资产归这条挂载独有，删除时可以安全地删对象。
- 一律复制：源上传变成孤儿，多一次对象复制；合法流程里源上传本来就是为这条挂载传的，没有共享。
- 只加类目校验、删除仍不动源：最省事，但删除附件销毁源文件的问题还在。

**设计**

1. `add` 增加操作人入参。资产须同时满足：`category === 'announcement'`、`uploaderId` 是操作人、未被任何 `announcementAttachments` / `bidDocuments` / `chatMessages` / `expertMemos` / `archiveMeta` 引用。不满足即 400 `ATTACHMENT_ASSET_NOT_ADOPTABLE`。
2. `remove`：只有 `category === 'announcement'` 且删掉本挂载后无其他引用时，才删对象与 `FileAsset` 行；否则只解挂。存量共享型附件因此只会解挂，对象留在对象存储里。
3. **按内容识别类型。** `upload/file-content-policy.ts` 新增 `detectMimeByMagic(buffer)`，覆盖 pdf / png / jpeg / gif / webp / doc / docx / xls / xlsx / zip，识别不出返回 `null`。
   - `attachFromObject`：忽略入参 `mimeType`，取识别结果；识别不出或不在安全集则存 `application/octet-stream`；`size` 取实际字节数；存储键扩展名随识别结果。
   - `stream`：先取对象头 4KB 识别。只有 pdf / png / jpeg / gif / webp 用 inline，其余 `attachment` 加 `application/octet-stream`；恒带 `nosniff`。在下载时识别而不在入库时订正，是为了覆盖存量附件且不需要跑脚本。
4. **公开投影改白名单。** `stripForPublic` 换成 `projectForPublic`，`publicList`、`getPublic`、`supplierList`、`titleOnlyStub` 全部走它。
   - 顶层只出：`id`、`title`、`type`、`status`、`summary`、`content`、`aiSummary`、`publishDate`、`publicityEnd`、`viewCount`、`relatedProjectCode`、`companyName`、`isTop`、`createdAt`、`attachments`（只含 `id`、`title`、`fileAsset{id, originalName, size, mimeType}`），以及壳字段 `titleOnly`、`offlinedReason`。这份清单来自两个门户实际读取的 14 个顶层字段。
   - `metadata` 只出两个门户实际用到的键。已知有 `visibility`、`deadline`、`objectionContact`；其余在实施时逐页盘点 :3002 与 :3004 后写进单测。
   - `supplierList` 另加的 `visibility` 保留。
   - 管理端接口不受影响。

**验收**

- e2e：`add` 传非公告类目、他人上传、已被引用的资产——400；`remove` 后源资产仍可下载；「引用采购文件」出来的附件可被匿名下载。
- 单测加 curl：`from-object` 传 `text/html`——响应类型不是 `text/html` 且是附件下载。
- e2e：带下载密码、阳光推送配置、回收快照的公告——匿名详情与列表里没有这些键。
- 页面走查：:3002 公告列表与详情、:3004 公告中心各公告类型（中标公告的候选人、流标公告等按类型展示的字段）。
- `announcement-attachment.service.spec.ts`、`announcement.service.spec.ts` 更新后通过。

**留给实施**：`metadata` 键的最终清单；`titleOnlyStub` 是否需要单独的精简投影。

### 3.6 第 6 处：账号与审批

封 P6-1、P6-2、J3-1、P5-1、P5-2（P1）；P6-3、P5-3（P2）。

**现状**

- 忘记密码（`auth/password-requests.service.ts:96-124`）：验证码按调用方自填的 `applicantContact` 核销，与账号无关。
- 内部审批（`auth/password-requests.controller.ts:83-150`）对 admin 与 leader 开放，不查审批人是不是申请人，也不查目标账号。leader 给 admin 的账号提一条重置、用自己的手机收码、自己批掉，就改掉了 admin 的口令。
- 两个审批入口不对称：供应商入口有 `assertSupplierScope`（`:310`），内部入口没有对应的守卫。
- `AuthGuard`（`auth/auth.guard.ts:56-59、96`）回查只取启用、冻结、临时账号、会话、改密时间，角色直接用令牌里的。
- 口令副本（`auth/password-vault.util.ts`）注释写「仅供应商」，实际对内部账号也写；是否生效取决于 `PASSWORD_VIEW_SECRET` 是否配置，生产待核。
- 删账号（`auth/account-admin.controller.ts:490-507`）靠外键报错兜底，而 `AuditLog.userId` 是级联删除。
- 资料变更申请任何登录角色都能提（`@AnyRole`），包括供应商与专家账号。供应商申请人的通知按 2026-09-26 的分流发给归属公司的 leader 与 staff，但链接指向 admin 专属的 `/admin/accounts`，审批中心聚合里这三类申请也只出给 admin——实际一直由 admin 审。
- **用户裁定（2026-11-24）**：密码审批全由 admin 管理，维持这一现状。代码注释里「供应商申请人的资料变更归归属公司管理账号审」的分流不再作为审批权依据。

**取舍：重置批准后的口令**

- **沿用申请人填的新密码（用户选定）**：验证码发到预留手机之后，只有账号本人能发起，审批人不经手口令。CLAUDE.md 里「一次性临时密码」那句改成与实现一致。
- 服务端生成一次性临时密码给审批人：审批人要电话转告，最好还要配首登强制改密。

**设计**

1. **重置的身份证明。**
   - 新公开端点 `POST /auth/password-reset-code`，体 `{ username }`，限流 5 次/分/IP。按 2026-11-23 的资格口径找账号，取预留手机，发验证码（场景 `password_reset`，Redis 键绑定账号 id，5 分钟有效，按账号 60 秒冷却加每日上限）。
   - 预留手机：内部账号取 `User.phone`；专家账号取专家档案里的手机，取不到回退账号手机（与揭示端点同一顺序）；供应商账号取主联系人手机，取不到回退 `User.phone`。没有预留手机的账号不发码。
   - 无论是否命中，响应都是同一个 200，不命中不发短信——防账号枚举。
   - `POST /auth/password-reset-requests` 的体改为 `{ username, verificationCode, newPassword }`，服务端按账号核销验证码。存量未审申请照常可审。
   - 前端：`apps/web/src/components/login/forgot-password-dialog.tsx`、`apps/supplier-portal-next/src/components/auth/password-reset-request-dialog.tsx` 与两处 `lib/api/auth.ts`，去掉「联系手机」输入。
2. **审批口径：全部由 admin 审**（用户裁定，维持现状）。
   - 管理端 `auth/password-requests.controller.ts` 下的九个端点（三类申请各有列表、批准、拒绝）装饰器收为 `@Roles('admin')`。改密、重置、资料变更三类申请，不论目标账号是内部、专家还是供应商，都只有 admin 能审。
   - admin 不能审自己账号的申请，403 `SELF_APPROVAL_FORBIDDEN`。
   - 供应商管理中心的重置入口 `/supplier/password-reset-requests/*` 不动审批角色（2026-09-03 裁定：staff、leader 日常处理），只加公司校验——供应商主归属或 `APPROVED` / `DISABLED` 的公司关联在审批人公司内，admin 不限；列表同口径过滤。
   - 管理端入口遇到供应商账号的重置申请——403 `NOT_INTERNAL_REQUEST`，与供应商入口已有的守卫对称。
   - 列表与审批中心聚合不需要按审批人过滤，因为只有 admin 能调。
   - 批准与拒绝一律写 `AuditLog`。通知收件人不变。
3. **会话角色。** `AuthGuard` 回查时多取 `role`，`req.user` 用库内角色覆盖令牌里的；端口角色校验也用它。公司不用管——公司隔离引擎每次都查库。
4. **口令副本只给供应商。** 所有写入点只在目标账号是 supplier 时写 `passwordVault`；审批通过时把非供应商账号的副本置空；`GET /auth/admin/accounts/:id/password` 限供应商账号。交付一个 dry-run 默认的订正脚本，清掉内部账号的存量副本。
5. **删账号。** 事务内先查业务数据（供应商档案、专家档案、工作位、创建的采购项目与台账轮次、发布的公告、上传的文件、被指派主持的项目、审批记录等，实施时按模型关系列全）。有则 409 `ACCOUNT_HAS_DATA`；无则先把该账号的 `AuditLog.userId` 置空，再删。
6. **账号管理写动作落审计。** 建号、改资料 / 角色 / 公司、重置口令、冻结、解冻、删除各写一条 `AuditLog`。
7. **`PATCH /auth/me`。** 邮箱、手机走密封与盲索引，与账号管理编辑同口径。

**验收**

- e2e：leader 或 staff 访问三个管理端的列表、批准、拒绝——一律 403，不论目标账号是什么角色；admin 批自己账号的申请——403。
- e2e：供应商管理中心的重置入口，staff 批他司供应商的重置——403；批本司的——200。
- e2e：给 admin 账号提重置，验证码发到操作人自己的手机——核销失败；发码端点对存在的账号与不存在的账号响应一致；专家账号的码发到档案手机。
- 单测：令牌角色与库内不一致——以库内为准。
- e2e：删除有审计记录的测试账号——审计行的用户被置空而条数不变；删除有业务数据的账号——409。
- e2e：重置申请 → 审批 → 新密码可登录，供应商与内部账号各一条。
- `password-requests.spec.ts`、`account-admin.controller.spec.ts` 更新后通过。

**已知代价**：只有一个 admin 时，该 admin 本人忘记密码无法自助重置，要由另一个 admin 审批或走账号管理重置。

**留给实施**：每日发码上限的数值；业务数据检查的表清单；存量重置申请在审批面板上的展示。

### 3.7 第 7 处：项目与公司归属

封 M6-1 至 M6-5、N1-1、N2-1、L7-1 至 L7-4、L8-2、O7-1 至 O7-3、O8-1、O8-2、P3-1、P11-1、P11-2（约 17 条 P1 及同根的 P2），并入 N4-1。O7-4 待裁定，不动。

**现状**

- 两个现成的公司守卫（`bid/bid-company-scope.guard.ts`、`project-management/pmi-ownership.guard.ts`）都只认路径参数 `:id`。漏网端点的项目 id 多在请求体、查询串或别的参数名里（`:projectId`、`:bidProjectId`、`:projectCode`）。
- 开发库 56 个投标项目里 26 个没有 `companyId`。现有口径下这类项目只有 admin 和被指派主持人能过守卫。生产库没查。

**取舍**

- 再挂一批路由守卫：盖不住请求体与查询串里的 id。
- **抽成函数，守卫做薄包装（选它）**：一条判定，两种用法。

**设计**

1. **归属断言单源。** 在 `CompanyScopeService` 上新增：
   - `assertBidProjectScope(projectId, user, portal)`：判定逻辑从 `BidCompanyScopeGuard` 原样搬过来——admin 放行；:3007 门户下被指派主持人放行；其余内部角色要求 `BidProject.companyId` 等于本人公司；无归属项目同现口径。守卫改为调用它，并支持用元数据指定参数名（缺省 `id`）。
   - `assertPmiReadable(itemId, user)`：读判定取自 `PmiOwnershipGuard`（创建人、admin、本公司 leader）。守卫与归档读端点共用。
   - `assertSupplierScope(supplierId, user)`：判定取自 `SupplierScopeGuard`（主归属或 `APPROVED` / `DISABLED` 的公司关联）。
   - `assertProcurementRoundScope(roundId, user)`。
2. **端点与断言。** 下表是本批要盖的端点。每条在出实施计划前都要回代码核对 id 的位置与现有校验。

| 模块 | 端点 | 断言 |
|---|---|---|
| 专家管理 | `extract/confirm`、`extract/leader`、`extract/ai-leader`、`extract/notify`、`extract/analyze-project`、`extract/retrospect`、`projects/:id/committee/assignment`、`projects/:projectId/rsvp-links`、`projects/:id/expert-extract-stamp`、`invitations/:projectId`、`projects/:projectId/extraction-export`、`invitations/:projectId/:userId/proxy-mark`、`evaluation-projects/:pid` | 投标项目归属 |
| 专家管理 | `extract/notify` 的 `expertIds` | 须在本项目工作位名单内；加条数上限 |
| 专家管理 | `extract/history` | 列表按项目公司过滤；`pageSize` 设上限 |
| 专家管理 | `extract/custom-project` | 自建项目落操作人公司快照 |
| 专家管理 | `GET :id`（专家详情） | `assignments` 只回操作人公司视野内的项目 |
| 专家管理 | `rsvp-links`、`expert-extract-stamp` 等写动作 | 补 `AuditLog` |
| 项目管理 | 五个附件读端点与 `save-paragraphs`、`save-attachment-html`、`replace-attachment-text`、`attachment/:attachmentId/versions` | 附件须属路径里的 `:id` 项目 |
| 项目管理 | `archive/:procurementRoundId`、`archive-file/…` | 轮次 → 采购项目 → `assertPmiReadable` |
| 项目管理 | 列表 `GET /project-management` | `include` 改 `select`，不带出 `createdBy`、`terminatedBy` 整行（N4-1） |
| 供应商 | `POST negotiation-config` | 投标项目归属 |
| 供应商 | `PATCH contacts/:contactId/personnel`、`POST :id/documents`、`DELETE :id/documents/:docId` | 供应商归属 |
| 供应商 | `GET participation-export/:bidProjectId` | 投标项目归属 |
| 供应商 | `GET changes/pending` | 列表按供应商归属过滤 |
| 供应商回执 | `list`、`manual-mark`、`mark-notified` | 投标项目归属 |
| 供应商回执 | `history` | 供应商归属 |
| AI | `projects/:projectId/anomalies`、`risk-scores`、`invitation-letter/generate`、`export` | 投标项目归属；后两者角色去掉 bid_expert |
| AI | 选取历史五端点 | 见下 |
| 公告 | `project/:projectCode/participants` | 经项目编号定位公告后走 `assertAnnouncementScope` |
| 公告 | `:id/history`、`histories/all` | 公告范围；后者按公司过滤 |
| 下载 | `canAccessFile` 的内部角色兜底（`upload.service.ts:490-511` 的 `return true`） | 见下 |
| 监督推送 | `projects/:id/*` 四端点 | 投标项目归属（守卫，参数名 `id`） |
| 平台推送 | `pending`、`preview`、`dispatch`、`export`、`status` | 条目回源到项目后按公司过滤 |

3. **两处需要单独说明的。**
   - 选取历史（O7-2）：`SupplierSelectionHistory` 没有属主列。本批加可空的 `createdById`（一次加列迁移），新建时落操作人；读取限本人与 admin，存量行仅 admin 可见。不这样做就只能把五个端点整个收给 admin，调用方会丢自己的历史。
   - 通用下载（P3-1）：内部角色的兜底放行改为归属判定。按下面的顺序定性，命中即止，与前面合同引用判定「有引用链就以引用链为准」的既有做法一致。
     1. 证据类与系统生成类资产：走已有的显式分支，不动。
     2. 资产被投标提交引用：走已有的项目规则，bid_host 限被指派的项目。
     3. 其余资产按上传人定性：
        - 上传人是供应商账号：该供应商须在请求人视野内（`assertSupplierScope` 的口径）。
        - 上传人是内部账号且有归属公司：资产归该公司，本公司内部角色可下。
        - 上传人没有归属公司：上传人是 admin 的视为平台件，内部角色可下；否则仅 admin 可下。
        - 没有上传人：仅 admin 可下。
     - 各条里的「admin 可下」指请求人是 admin。
   - 两个由此定下的边角：跨公司指派的主持人为项目上传的非证据类文件，归主持人自己的公司，项目公司的 staff 下不了；admin 上传的文件不因 admin 没有归属公司而变成只有 admin 能下。
   - 这块最容易误拦，实施时要沿资质审核、开评标、归档三条真实链路各走一遍。
4. **无归属项目。** 断言对无 `companyId` 的投标项目沿用现口径，会让这类项目对 staff 与 leader 变成 403。交付一个 dry-run 默认的回填脚本（经 `projectManagementItemId` → 采购项目的公司，回退到创建人公司），部署前先查生产无归属项目数。

**验收**

- e2e：他公司 staff 调上表任一项目级端点——403；本公司——200。
- e2e：他司附件 id 配自己的项目——404；他司轮次 id——403。
- e2e：leader 读项目列表，响应串里没有 `passwordHash`、`passwordVault`、`webSessionId`、`sessionMeta`。
- e2e：他公司 staff 读他司资质扫描件——403；bid_expert 调生成通知——403。
- 页面走查：资质审核、开评标全过程、归档取件、专家抽取向导、供应商中心。

**留给实施**：逐端点的现有校验核对与最终清单；守卫参数名元数据的写法；回填脚本的来源优先级。

## 4. 顺序与提交

按 1 → 3 → 5 → 2 → 4 → 6 → 7，每处单独出实施计划、单独提交，必要时在处内按任务再切。提交信息前缀 `fix(audit-b1):`。第 1 处先做：它是八条 P0 里唯一供应商与专家也能触发的，改动也最小。

第 7 处依赖第 4 处（批量画像用到项目归属断言），所以排最后。

**验收环境**：凡是要把公告置为已发布的用例（第 1、5 处都有），一律在隔离的 e2e 环境里跑，不在开发实时库上发。2026-11-24 有一回验证脚本测拒绝路径时把前提改掉了，结果真实发布、发出 474 条通知并直建了项目。

## 5. 部署与数据核对

**部署前只读核对（生产）**

1. `Attachment` 里键不在三个白名单前缀内的行数——应为 0。
2. `BidProject` 里 `companyId` 为空的行数——不为 0 时先跑回填脚本。
3. 专家账号口令等于 `expert@2026` 的账号数（脚本，只出计数）。
4. 内部账号带 `passwordVault` 的行数——订正脚本处理。
5. `PASSWORD_VIEW_SECRET` 是否配置。

**随批交付的脚本**（全部 dry-run 默认）：投标项目公司回填、内部账号口令副本订正、专家口令核对。

**必须同批部署**：API、ai-bid worker（共用的 `attachment-object-store` 改了）、:3005（第 2、3、4 处改了接口契约）、:3004 登录页（第 6 处）。

## 6. 文档同步

- CLAUDE.md：删「`POST /expert-admin/import-from-seed` 同读该名单」；「重置批准生成一次性临时密码」改为与实现一致；专家清空名单的挡闸口径。
- 审查模板第 5 节：新增三条裁定（清空名单有绑定即拒；重置批准后沿用申请人口令；密码审批一律由 admin 审）。
- 报告第七节的文档漂移清单对应条目销账。

## 7. 已知残留与风险

- LibreOffice 仍以解析不可信文档的方式运行，非 root 化另案。
- 只有一个 admin 时，本人忘记密码无法自助重置。
- 无归属的投标项目在回填前对 staff 与 leader 是 403。
- 存量共享型公告附件删除后只解挂，对象留在对象存储里。
- 专家群发通知文案里的回执链接仍由操作人粘贴，本批只收了名单与条数。
- 第 7 处选取历史需要一次加列迁移，走金仓的手写迁移流程。
- 供应商的改密与资料变更申请，通知仍按 2026-09-26 的分流发给归属公司的 leader 与 staff，而审批权只在 admin——收到通知的人要转请 admin 处理。按裁定本批不改通知。
- 「引用采购文件」的键不合规时是「照常发布、没有招标文件」，不是 400。

## 附：相对讨论稿的修正

回代码复核后，对聊天里那版讨论稿做了这些改动：

1. 第 1 处补上「引用采购文件」的任意读（P1-2 后半），讨论稿只在最初的清单里提过。另外明确：改异步后要限并发。
2. 第 4 处批量画像从「只许本项目名单」改成「名单内或本公司给明文，其余给掩码」——原方案会打断重进抽取页给需求方代表补拉联系方式的流程。
3. 第 6 处资料变更审批不能一刀切收 admin：供应商与专家账号也在提申请。改为按目标账号分口径。
4. 第 6 处守卫回查只需要覆盖角色，公司隔离引擎本来每次查库。
5. 第 6 处两个审批入口的不对称一并收口。
6. 第 7 处发现开发库近半投标项目没有公司归属，补了回填脚本与部署前核对。
7. 第 3 处新类目若不在通用下载里单独设闸，登记成文件记录反而会扩大可下载范围。
8. 第 7 处选取历史模型没有属主列，需要加列。

**独立复核之后的修正**（一个没看过讨论稿的复核者，站在「要照着出实施计划」的角度读文档，提了 6 条，回代码核实后如下）：

9. 第 1 处等槽时间从 120 秒改成 5 秒。:3005 代理对 `/api/upload` 是 15 秒超时，长排队会先在代理层超时，而 API 仍在转换并存盘。
10. 第 1 处「引用采购文件」的键不合规时，表现改为「照常发布、没有招标文件」。校验加在 `attachFromObject` 里，而它的三个调用点都是尽力而为、捕获后只打警告；要拿到 400 得在公告服务的三个入口另加预检，该文件正被另一会话修改，列为另案。
11. 第 6 处审批口径原先写成「控制器收为 admin」，与「供应商账号的申请 leader 可批」在同一个端点上互相排斥，供应商的改密申请还会变得无人能批。复核后一度改成按目标账号分两路；随后用户裁定密码审批全由 admin 管理，3.6 已按裁定改成单一口径。发码手机对专家取档案优先这一条保留。
12. 第 7 处通用下载兜底原先并列了三条判定，没说是与、或还是先后。写明顺序，并定下 admin 上传的无归属资产按平台件处理。
13. 复核时工作区里压着另一会话的未提交改动，现已提交为 `cf661d075`。文档基线随之更新，并写明开工前先看 `git status`。
