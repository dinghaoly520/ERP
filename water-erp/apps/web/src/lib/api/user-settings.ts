import { normalizeApiBaseUrl, parseJsonResponse } from './auth';
import { apiFetch } from './api-fetch';
import {
  ClipboardList, Database, BookOpen, Workflow, FolderKanban, FileEdit, FileSearch,
  Megaphone, MessagesSquare, Bell, Building2, UserCheck,
} from 'lucide-react';

const API_BASE = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

export type NotificationPrefs = Record<string, boolean>;

/** 落地页候选键（与后端 DTO IsIn、login-routing HOME_PAGE_ROUTES 三处同口径） */
export type HomePageKey =
  | 'dashboard' | 'procurements' | 'progress' | 'projects' | 'work-arrangements'
  | 'tender-write' | 'tender-review' | 'notice' | 'clar-notice' | 'notifications'
  | 'supplier' | 'expert';

export type UserSettings = {
  id: string;
  userId: string;
  theme: 'light' | 'dark' | 'system';
  defaultHomePage: HomePageKey;
  compactMode: boolean;
  notificationPrefs?: NotificationPrefs | null;
  defaultReviewKbId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateUserSettingsInput = {
  theme?: 'light' | 'dark' | 'system';
  defaultHomePage?: HomePageKey;
  compactMode?: boolean;
  notificationPrefs?: Record<string, boolean>;
};

export async function fetchUserSettings(): Promise<UserSettings> {
  const response = await apiFetch(`${API_BASE}/user-settings`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<UserSettings>(response);
}

export async function updateUserSettings(
  input: UpdateUserSettingsInput,
): Promise<UserSettings> {
  const response = await apiFetch(`${API_BASE}/user-settings`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  return parseJsonResponse<UserSettings>(response);
}

// Theme options for display
export const THEME_OPTIONS = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'system', label: '跟随系统' },
] as const;

// 登录后落地页选项（2026-11-09 扩全候选=工作台全部一级业务页；标签与侧栏 app-shell 同名）
export const HOME_PAGE_OPTIONS: ReadonlyArray<{ value: HomePageKey; label: string; desc: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }> = [
  { value: 'work-arrangements', label: '工作台', desc: '日常任务与工作安排', icon: ClipboardList },
  { value: 'dashboard', label: '数据库', desc: '供应商/专家/项目检索总览', icon: Database },
  { value: 'procurements', label: '采购台账', desc: '采购轮次台账与统计', icon: BookOpen },
  { value: 'progress', label: '采购进度', desc: '项目九阶段进度总览', icon: Workflow },
  { value: 'projects', label: '项目管理', desc: '采购项目全流程管理', icon: FolderKanban },
  { value: 'tender-write', label: '采购文件编写', desc: '采购文件起草与 AI 辅助', icon: FileEdit },
  { value: 'tender-review', label: '采购文件审查', desc: '文件审查与合规检查', icon: FileSearch },
  { value: 'notice', label: '公告发布中心', desc: '公告起草与发布管理', icon: Megaphone },
  { value: 'clar-notice', label: '澄清说明', desc: '澄清通知的发布管理', icon: MessagesSquare },
  { value: 'notifications', label: '通知管理', desc: '站内通知与待办处理', icon: Bell },
  { value: 'supplier', label: '供应商管理', desc: '入库审批与供应商库', icon: Building2 },
  { value: 'expert', label: '专家管理', desc: '专家库与抽取评价', icon: UserCheck },
];
