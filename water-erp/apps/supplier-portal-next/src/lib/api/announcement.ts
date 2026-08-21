import { api, qs, ApiError } from "../api";

export const announcementApi = {
  publicList(params?: { type?: string; search?: string; page?: number; pageSize?: number }) {
    return api.get<any>(`/announcements/public${qs(params)}`);
  },
  getPublic(id: string) {
    return api.get<any>(`/announcements/public/${id}`);
  },
  // 招标文件（供应商视角：权限/付费/下载）
  getBidDocument(announcementId: string) {
    return api.get<any>(`/supplier-portal/bid-documents/${announcementId}`);
  },
  payBidDocument(announcementId: string, paymentRef?: string) {
    return api.post<any>(`/supplier-portal/bid-documents/${announcementId}/pay`, { paymentRef });
  },
  // 下载（cookie 鉴权 + 服务端解密），返回 blob
  async downloadBidDocument(announcementId: string, password?: string): Promise<{ blob: Blob; fileName: string }> {
    const res = await api.raw(
      `/supplier-portal/bid-documents/${announcementId}/download${qs({ password })}`,
      { silent: true },
    );
    if (!res.ok) {
      let message = "下载失败";
      try {
        const data = await res.clone().json();
        if (data?.error) message = String(data.error);
      } catch { /* 非 JSON 错误体 */ }
      throw new ApiError(res.status, "DOWNLOAD_FAILED", message);
    }
    const disposition = res.headers.get("content-disposition") || "";
    const m = disposition.match(/filename="?([^"]+)"?/);
    return {
      blob: await res.blob(),
      fileName: m ? decodeURIComponent(m[1]) : "招标文件",
    };
  },
};
