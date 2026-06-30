import { normalizeApiBaseUrl, parseJsonResponse } from './auth';

const API_BASE = normalizeApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);

export type UserSettings = {
  id: string;
  userId: string;
  theme: 'light' | 'dark' | 'system';
  defaultHomePage: 'dashboard' | 'procurements' | 'projects' | 'work-arrangements';
  compactMode: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpdateUserSettingsInput = {
  theme?: 'light' | 'dark' | 'system';
  defaultHomePage?: 'dashboard' | 'procurements' | 'projects' | 'work-arrangements';
  compactMode?: boolean;
};

export async function fetchUserSettings(): Promise<UserSettings> {
  const response = await fetch(`${API_BASE}/user-settings`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<UserSettings>(response);
}

export async function updateUserSettings(
  input: UpdateUserSettingsInput,
): Promise<UserSettings> {
  const response = await fetch(`${API_BASE}/user-settings`, {
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

// Default home page options
export const HOME_PAGE_OPTIONS = [
  { value: 'dashboard', label: '数据库' },
  { value: 'procurements', label: '采购台账' },
  { value: 'projects', label: '项目管理' },
  { value: 'work-arrangements', label: '工作安排' },
] as const;
