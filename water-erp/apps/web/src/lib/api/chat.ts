'use client';

import { io, type Socket } from 'socket.io-client';
import { gatewayWsUrl } from '@water-erp/config';
import { api } from '../api';

// ── 类型 ──

export interface ChatUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  avatar: string | null;
  company: string | null;
  department: { id: string; name: string } | null;
  isOnline: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  type: 'text' | 'image' | 'file';
  content: string;
  fileAssetId: string | null;
  fileUrl: string | null;
  fileMime: string | null;
  fileSize: number | null;
  readAt: string | null;
  createdAt: string;
}

export type ChatMessageType = 'text' | 'image' | 'file';

export interface SendMessageInput {
  receiverId: string;
  type: ChatMessageType;
  content: string;
  fileAssetId?: string | null;
  fileUrl?: string | null;
  fileMime?: string | null;
  fileSize?: number | null;
}

export interface UploadedFile {
  id: string;
  key: string;
  url: string;
  originalName: string;
  size: number;
  mimeType: string;
}

// ── HTTP ──

export function fetchChatUsers(): Promise<ChatUser[]> {
  return api.get<ChatUser[]>('/chat/users');
}

export function fetchMessages(
  peerId: string,
  before?: string,
  limit = 30,
): Promise<ChatMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  return api.get<ChatMessage[]>(`/chat/messages/${encodeURIComponent(peerId)}?${params.toString()}`);
}

export function markRead(peerId: string): Promise<{ updated: number }> {
  return api.post<{ updated: number }>(`/chat/messages/${encodeURIComponent(peerId)}/read`, {});
}

/** 上传图片/文件到 /api/upload（general 分类），返回 fileAsset 元数据 */
export function uploadChatFile(file: File): Promise<UploadedFile> {
  const fd = new FormData();
  fd.append('file', file);
  return api.postForm<UploadedFile>('/upload?category=general', fd);
}

// ── WebSocket ──

/**
 * WebSocket 不能走 Next.js 的 /api rewrite（只代理 HTTP）。
 * 2026-11-03 统一走 gatewayWsUrl('/chat')（域名模式=同源，门户侧 nginx 反代
 * /socket.io/ → API 端口——前后端分离拓扑下 api 子域对浏览器不可达；端口/IP
 * 模式=直连当前主机:4001）。NEXT_PUBLIC_CHAT_WS_URL 覆盖仍保留（chat 专属，无劫持问题）。
 */
function chatWsUrl(): string {
  const env = process.env.NEXT_PUBLIC_CHAT_WS_URL;
  return env ? `${env.replace(/\/+$/, '')}/chat` : gatewayWsUrl('/chat');
}

let socket: Socket | null = null;

/** 单例 socket（namespace /chat）。带自动重连、cookie 凭证。 */
export function getChatSocket(): Socket {
  if (socket) return socket;
  socket = io(chatWsUrl(), { forceNew: true,
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });
  return socket;
}

