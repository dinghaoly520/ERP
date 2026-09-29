import { api } from "../api";
import { UPLOAD_BASE } from "./upload";

/* ═══ 双信封 v2 供应商解密包（T17，§5.3）═══
   - GET opening-package：C_inner 下载凭证 + kselfByRole + sealedFields + 窗口状态。
     轮询场景传 silent 避免 400 每 10s 弹全局 toast（业务码由开标大厅卡片消化）。
   - POST decrypt-upload：multipart 四角色明文 + fieldsJson + nonce；双闸失败返回 200
     且 decryptStatus='DANGER'（非 HTTP 错误），调用方须检查返回值。
   - POST reupload-dual：解密异常恢复——客户端双层重封的新 C_outer + 整体新 envelope
     （SUP-P1-02，2026-09-29 接线；服务端四重防改价闸见 reuploadDualEnvelope）。 */

/** 裸 fetch 非 2xx 归一：取响应体 error 文案抛 Error（挂 status/data 供 catch 呈现）。
 *  SUP-P2-02：此前 decryptUpload 不查 res.ok——窗口关闭/401/quorum 等 4xx 的 JSON
 *  被当成功数据返回，卡片把它渲染成「完整性校验未通过」专用话术，误导归因。 */
async function throwIfNotOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  let body: Record<string, unknown> = {};
  try { body = await res.json(); } catch { /* 非 JSON（如 404 HTML）用兜底文案 */ }
  const err = new Error(String(body.error ?? fallback)) as Error & {
    status: number; data: Record<string, unknown>;
  };
  err.status = res.status;
  err.data = body;
  throw err;
}

export interface OpeningPackageFile {
  role: "technical" | "business" | "coverLetter" | "bond";
  assetId: string;
  downloadUrl: string;
  /** C_inner 密文 SHA-256（密封核验锚点：下载后本地重算比对） */
  ciphertextSha256: string;
}

export interface OpeningPackage {
  windowEnd: string;
  paused: boolean;
  files: OpeningPackageFile[];
  kselfByRole: Record<string, string>;
  /** 唱标字段密封件：cipher=SM4(canonicalJson({fields,nonce}))，kself=SM2 包裹 DEK_F */
  sealedFields: { cipher: string; kself: string; fieldsSha256: string };
}

export function getOpeningPackage(projectId: string): Promise<any> {
  return api.get<any>(`/supplier-portal/bid-submissions/${projectId}/opening-package`, { silent: true });
}

/** 解密明文上传（四角色 multipart + fieldsJson/nonce）；返回 BidSupplier 终局行（decryptStatus 判定成败） */
export async function decryptUpload(projectId: string, form: FormData): Promise<any> {
  // 勿手设 Content-Type：浏览器对 FormData 自动补 multipart/form-data; boundary=…，
  // 手动设置会丢掉 boundary，服务端 multer 报 "Multipart: Boundary not found"（迁移引入的回归）。
  // 开发环境直连 API origin（同 upload.ts 口径：Next dev 代理对 1.5MB+ 请求体截断）。
  // SUP-P2-01：不再剥 /api 前缀——UPLOAD_BASE==="/api"（同源部署）时去掉前缀会打到
  // Next 自身路由 404 HTML；直连 origin 与同源 /api 两种形态下完整拼接均正确。
  const res = await fetch(`${UPLOAD_BASE}/supplier-portal/bid-submissions/${projectId}/decrypt-upload`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Portal": "supplier" },
    body: form,
  });
  await throwIfNotOk(res, "解密上传失败");
  return res.json();
}

/** SUP-P1-02：解密异常恢复——重新密封补传。multipart：file=新 C_outer（客户端双层
 *  加密产物）+ role/envelope(JSON string)/signature；服务端 SHA-256 明文锚点闸 +
 *  fieldsCommit 冻结 + 验签链 + 多角色保全（reuploadDualEnvelope）。 */
export async function reuploadDual(projectId: string, form: FormData): Promise<unknown> {
  const res = await fetch(`${UPLOAD_BASE}/supplier-portal/bid-submissions/${projectId}/reupload-dual`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Portal": "supplier" },
    body: form,
  });
  await throwIfNotOk(res, "重新密封补传失败");
  return res.json();
}
