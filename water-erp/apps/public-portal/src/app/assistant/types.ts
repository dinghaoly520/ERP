export type PublicAssistantExpression = 'normal' | 'thinking' | 'serious';

export type PublicAssistantRole = 'user' | 'assistant';

export interface PublicAssistantMessage {
  id: string;
  role: PublicAssistantRole;
  content: string;
}

/** 公告摘要 —— 作为 AI 上下文传入 */
export interface AnnouncementContextItem {
  id: string;
  type: string;
  title: string;
  date: string;
  urgent: boolean;
  code?: string;
}

/** 传递给 AI 的上下文 */
export interface PublicAssistantContext {
  /** 最近公告摘要列表 */
  recentAnnouncements: AnnouncementContextItem[];
  /** 当前页面用户可能在浏览的内容 */
  currentPage?: string;
  /** 用户当前搜索词（如有） */
  searchQuery?: string;
}
