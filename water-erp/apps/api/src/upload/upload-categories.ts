/**
 * FileAsset.category 允许值白名单。
 *
 * 背景（2026-08 审计）：schema 中 `FileAsset.category` 是自由字符串（无枚举约束），
 * Swagger 只记载 5 类，但实际代码/前端共使用 14+ 个值——文档与实现漂移。
 * 收敛策略：先在代码侧（controller 入口）做白名单校验，不动 DB（避免迁移漂移风险）；
 * 将来若上 Prisma enum，此常量即迁移源。
 *
 * 值清单来源（2026-08-14 全量盘点）：
 *   - DB 实际数据：bid_document / bid_opening_handover / general
 *   - 后端代码：announcement / procurement_document / bid_sign_packet /
 *     sign_packet_signature_page / bid_evaluation_handover /
 *     bid_evaluation_sign_handover / expert_memo_ink / expert_sign_scan
 *   - 前端：qualification / commercial / technical
 *   - Swagger 文档（保留）：profile
 */
export const UPLOAD_CATEGORIES = new Set<string>([
  'general',                        // 默认兜底
  'qualification',                  // 供应商资质文件
  'bid_document',                   // 投标文件
  'announcement',                   // 公告附件
  'profile',                        // 个人/企业资料（Swagger 文档保留）
  'commercial',                     // 商务标（供应商分部上传）
  'technical',                      // 技术标（供应商分部上传）
  'procurement_document',           // 采购文件（documentAcquireTime 流程）
  'bid_opening_handover',           // 开标文件包（:3007 完成开标回传 :3005）
  'bid_evaluation_handover',        // 评标回流包
  'bid_evaluation_sign_handover',   // 评标签字回流包
  'bid_sign_packet',                // 评标签字包 PDF
  'sign_packet_signature_page',     // 签字页
  'expert_memo_ink',                // 专家手写备忘扫描
  'expert_sign_scan',               // 专家签字扫描件
]);
