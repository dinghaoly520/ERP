# 双信封新轨·生产启用前清单（2026-08 双信封落地）

> 2026-10-20 自 CLAUDE.md 外移（瘦身），CLAUDE.md 保留要点速查与本文件指针。

- **ADMIN_KEYSTORE_DIR 必须纳入备份**：管理方外层私钥文件不在 DB/MinIO 备份内；丢失=对应历史信封外层永久不可解（全量 PLATFORM 归因）。生产对应加密机/HSM。
- **.data/supervision/ 必须纳入备份**：监督推送平台签名私钥（A-153），与 ADMIN_KEYSTORE_DIR 同级；缺省 `SUPERVISION_KEYSTORE_DIR`。
- **供应商门户须 https（或 localhost）**：`@water-erp/ukey`/WebCrypto（crypto.subtle）要求 secure context，局域网 http 直连会挂。
- **clean-legacy-plaintext --execute 前**：先 dry-run 审阅清单；旧轨服务端密封资产的回看下载已支持 sealedPath 流式解密（streamFile，2026-08-21），执行后供应商回看/staff/专家下载不受影响。
- **BID_DUAL_ENVELOPE=false 应急语义**：仅 API 侧放行旧轨 clientDeks——门户旧轨表单已下线（2026-09-29 口径修正），回退须公告通知投标人+管理员线下引导（DUAL_DISABLED 文案已改应急指引）。
- **管理方密钥轮转**：`POST /api/bid/admin-cert/generate` 置旧证 inactive；历史信封按 `envelope.adminCertId` 定位旧私钥（keystore 目录每证一文件，保留至其覆盖提交全部归档）。
- **供应商证书有效期与验签口径（2026-09-17）**：`SupplierCert.notBefore/expiresAt`（null=长期——mock 存量介质/旧中间件实例证书）；mock 新证书发行即带 60 天有效期（D1v2 裁定）。时点闸门=绑定（`BIND_CERT_EXPIRED`）与投递/补传验签（`CERT_EXPIRED`，findActiveUnexpiredCert）；**历史签名复验不因嗣后过期/撤销失效**——走签时快照（receiptSignature/confirmSignature 增 certSn/certPublicKey，存量无快照回退 `Supplier.sm2PublicKey` 旧列，旧列 @deprecated 仅回填+回退读）；回执/开标确认验签统一 ACTIVE SupplierCert（findActiveCertForSigning）。到期提醒=Scheduler `scanSupplierCertExpiry`（每日 08:15，30/7 天两档+过期补发，expiryNotifyStage 幂等）。
