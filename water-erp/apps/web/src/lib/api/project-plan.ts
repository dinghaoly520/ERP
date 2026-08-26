// CTS-EBS01 A-47~49：任务计划与项目团队 API 客户端

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

export type PlanStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export type ProjectPlanRow = {
  id: string;
  content: string;
  ownerUserId?: string | null;
  ownerName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  sortOrder: number;
  status: PlanStatus;
  submittedByName?: string | null;
  reviewedByName?: string | null;
  reviewComment?: string | null;
};

export type ProjectTeamRow = {
  id: string;
  userId: string;
  memberName: string;
  role: string;
  duty?: string | null;
};

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(data?.error || `请求失败（${response.status}）`);
}

const req = async <T>(path: string, method: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${API_BASE}/project-plan${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseJsonResponse<T>(response);
};

export const fetchPlans = (itemId: string) => req<ProjectPlanRow[]>(`/${itemId}/plans`, 'GET');
export const createPlan = (itemId: string, body: { content: string; ownerUserId?: string; startDate?: string; endDate?: string; sortOrder?: number }) =>
  req<ProjectPlanRow>(`/${itemId}/plans`, 'POST', body);
export const updatePlan = (itemId: string, planId: string, body: { content?: string; ownerUserId?: string; startDate?: string; endDate?: string; sortOrder?: number }) =>
  req<ProjectPlanRow>(`/${itemId}/plans/${planId}`, 'PATCH', body);
export const deletePlan = (itemId: string, planId: string) => req<{ ok: boolean }>(`/${itemId}/plans/${planId}`, 'DELETE');
export const submitPlans = (itemId: string) => req<{ submitted: number }>(`/${itemId}/plans/submit`, 'POST');
export const reviewPlans = (itemId: string, body: { approve: boolean; comment?: string }) =>
  req<{ reviewed: number; approved: boolean }>(`/${itemId}/plans/review`, 'POST', body);

export const fetchPlanUsers = () =>
  req<Array<{ id: string; username: string; displayName: string }>>('/users', 'GET');

export const fetchTeam = (itemId: string) => req<ProjectTeamRow[]>(`/${itemId}/team`, 'GET');
export const addTeamMember = (itemId: string, body: { userId: string; role: string; duty?: string }) =>
  req<unknown>(`/${itemId}/team`, 'POST', body);
export const updateTeamMember = (itemId: string, memberId: string, body: { role?: string; duty?: string }) =>
  req<unknown>(`/${itemId}/team/${memberId}`, 'PATCH', body);
export const removeTeamMember = (itemId: string, memberId: string) => req<{ ok: boolean }>(`/${itemId}/team/${memberId}`, 'DELETE');
