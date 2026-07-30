import api from './index'

/** 后端 /api/upload 返回的文件资产 */
export interface FileAssetResponse {
  id: string
  key: string
  /** 鉴权代理下载路径，如 /api/upload/files/<id> */
  url: string
  originalName: string
  mimeType: string
  size: number
  category: string
  sha256: string
  createdAt: string
}

/**
 * 上传文件到后端（落 MinIO + 写元数据）。
 * 复用全局 axios 实例（带 cookie、X-Portal: supplier、统一错误提示）。
 */
export function uploadFile(
  file: File,
  category = 'qualification',
  onProgress?: (pct: number) => void,
  clientEncrypted = false,
  plaintextSha256?: string,
): Promise<FileAssetResponse> {
  const fd = new FormData()
  fd.append('file', file)
  const params = new URLSearchParams({ category })
  if (clientEncrypted) params.set('clientEncrypted', 'true')
  if (plaintextSha256) params.set('plaintextSha256', plaintextSha256)
  return api.post(`/upload?${params.toString()}`, fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
    onUploadProgress: onProgress ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)) } : undefined,
  })
}
