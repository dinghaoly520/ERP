'use client';

import { io, type Socket } from 'socket.io-client';
import { PORTS } from '@water-erp/config';
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

export interface Conversation {
  peerId: string;
  peer: {
    id: string;
    displayName: string;
    role: string;
    avatar: string | null;
    department: { name: string } | null;
  };
  lastMessage: {
    id: string;
    type: string;
    content: string;
    senderId: string;
    createdAt: string;
  } | null;
  unreadCount: number;
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

export function fetchConversations(): Promise<Conversation[]> {
  return api.get<Conversation[]>('/chat/conversations');
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
 * WebSocket 不能走 Next.js 的 /api rewrite（只代理 HTTP），必须直连 API 端口。
 * 生产环境用 NEXT_PUBLIC_CHAT_WS_URL 覆盖；本地从 window.location.hostname + API 端口推导。
 */
function resolveWsBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_CHAT_WS_URL;
  if (env) return env.replace(/\/+$/, '');
  if (typeof window === 'undefined') return `http://localhost:${PORTS.api}`;
  return `${window.location.protocol}//${window.location.hostname}:${PORTS.api}`;
}

let socket: Socket | null = null;

/** 单例 socket（namespace /chat）。带自动重连、cookie 凭证。 */
export function getChatSocket(): Socket {
  if (socket) return socket;
  socket = io(`${resolveWsBaseUrl()}/chat`, {
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

/** 测试/重置时用（普通使用不需要调） */
export function __resetChatSocketForTest() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
