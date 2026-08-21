import { toast } from "sonner";

/** 后端 /api/upload 返回的文件资产 */
export interface FileAssetResponse {
  id: string;
  key: string;
  /** 鉴权代理下载路径，如 /api/upload/files/<id> */
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
  category: string;
  sha256: string;
  createdAt: string;
}

/**
 * 上传文件到后端（落 MinIO + 写元数据）。
 * 用 XMLHttpRequest 以保留上传进度回调（fetch 无原生 upload progress）；
 * 错误提示与全局 API 层一致（400/5xx/网络）。
 */
export function uploadFile(
  file: File,
  category = "qualification",
  onProgress?: (pct: number) => void,
  clientEncrypted = false,
  plaintextSha256?: string,
): Promise<FileAssetResponse> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    const params = new URLSearchParams({ category });
    if (clientEncrypted) params.set("clientEncrypted", "true");
    if (plaintextSha256) params.set("plaintextSha256", plaintextSha256);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload?${params.toString()}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Portal", "supplier");
    xhr.timeout = 120000;

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }

    const failToast = (message: string) => toast.error(message);

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as FileAssetResponse);
        } catch (e) {
          reject(e);
        }
        return;
      }
      let message = "请求失败";
      try {
        const data = JSON.parse(xhr.responseText);
        if (data?.error) message = String(data.error);
      } catch { /* 非 JSON 错误体 */ }
      if (xhr.status === 400) failToast(message || "请求参数错误");
      else if (xhr.status >= 500) failToast("服务器错误，请稍后重试");
      else failToast(message);
      reject(new Error(message));
    };
    xhr.onerror = () => {
      failToast("网络异常或请求超时，请检查网络");
      reject(new Error("网络异常或请求超时"));
    };
    xhr.ontimeout = () => {
      failToast("网络异常或请求超时，请检查网络");
      reject(new Error("上传超时"));
    };

    xhr.send(fd);
  });
}
