import { api } from "../api";
import { UPLOAD_BASE } from "./upload";

/* ═══ 双信封 v2 供应商解密包（T17，§5.3）═══
   - GET opening-package：C_inner 下载凭证 + kselfByRole + sealedFields + 窗口状态。
     轮询场景传 silent 避免 400 每 10s 弹全局 toast（业务码由开标大厅卡片消化）。
   - POST decrypt-upload：multipart 四角色明文 + fieldsJson + nonce；双闸失败返回 200
     且 decryptStatus='DANGER'（非 HTTP 错误），调用方须检查返回值。 */

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
  const base = UPLOAD_BASE === "/api" ? "" : UPLOAD_BASE;
  const res = await fetch(`${base}/supplier-portal/bid-submissions/${projectId}/decrypt-upload`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Portal": "supplier" },
    body: form,
  });
  return res.json();
}
