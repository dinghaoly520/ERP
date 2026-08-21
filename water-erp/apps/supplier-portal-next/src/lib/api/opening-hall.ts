import { api, qs } from "../api";

export const openingHallApi = {
  checkIn(projectId: string) {
    return api.post<any>(`/opening-hall/${projectId}/check-in`);
  },
  presence(projectId: string) {
    return api.get<any>(`/opening-hall/${projectId}/presence`);
  },
  send(projectId: string, body: { roomType: "PUBLIC" | "PRIVATE"; supplierId?: string; content: string }) {
    return api.post<any>(`/opening-hall/${projectId}/messages`, body);
  },
  messages(projectId: string, params: { roomType: "PUBLIC" | "PRIVATE"; supplierId?: string; cursor?: string; limit?: number }) {
    return api.get<any>(`/opening-hall/${projectId}/messages${qs(params)}`);
  },
  unread(projectId: string) {
    return api.get<any>(`/opening-hall/${projectId}/unread`);
  },
  markRead(projectId: string, roomKey: string, lastMessageId?: string) {
    return api.post<any>(`/opening-hall/${projectId}/read`, { roomKey, ...(lastMessageId ? { lastMessageId } : {}) });
  },
};
