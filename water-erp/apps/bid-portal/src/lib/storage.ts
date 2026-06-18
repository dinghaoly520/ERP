const RECENT_KEY = 'bid-recent-projects';
const MAX_RECENT = 5;

export interface RecentProject {
  id: string;
  projectCode: string;
  name: string;
  accessedAt: number; // Date.now()
}

export function getRecentProjects(): RecentProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RecentProject[];
  } catch {
    return [];
  }
}

export function addRecentProject(project: Omit<RecentProject, 'accessedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const list = getRecentProjects();
    const idx = list.findIndex(p => p.id === project.id);
    const entry: RecentProject = { ...project, accessedAt: Date.now() };
    if (idx >= 0) {
      list[idx] = entry;
    } else {
      list.unshift(entry);
    }
    // 截断至 MAX_RECENT
    const trimmed = list.slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
  } catch { /* localStorage 不可用时静默失败 */ }
}

export function removeRecentProject(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const list = getRecentProjects().filter(p => p.id !== id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* 静默失败 */ }
}
