import { api } from "../api";

export const awardLetterApi = {
  list() {
    return api.get<any[]>("/supplier-portal/award-letters");
  },
  sign(id: string) {
    return api.post<any>(`/supplier-portal/award-letters/${id}/sign`, {});
  },
  markReceived(id: string) {
    return api.post<any>(`/supplier-portal/award-letters/${id}/received`, {});
  },
};
