import type {
  PostponeWorkArrangementReminderPayload,
  WorkArrangementDailyPlan,
  WorkArrangementItem,
  WorkArrangementNote,
  WorkArrangementRecurrence,
  WorkArrangementScope,
  WorkArrangementStatus,
  WorkArrangementSummary,
  WorkArrangementTemplate,
  WorkArrangementType,
  WorkArrangementUrgency,
} from '@/lib/types/work-arrangements';

// Use relative /api path to leverage Next.js rewrites for cookie handling
const API_BASE = '/api';

function parseErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    const normalized = error.message.trim().toLowerCase();
    if (normalized === 'internal server error') {
      return '服务处理失败，请稍后重试。';
    }
    return error.message;
  }

  return '请求失败，请稍后重试。';
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallbackMessage = '请求失败，请稍后重试。';
    const contentType = response.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      try {
        const body = (await response.json()) as { message?: string | string[] };
        const message = Array.isArray(body.message) ? body.message[0] : body.message;
        throw new Error(message || fallbackMessage);
      } catch (error) {
        throw new Error(parseErrorMessage(error) || fallbackMessage);
      }
    }

    const text = (await response.text()).trim();
    throw new Error(parseErrorMessage(new Error(text)) || fallbackMessage);
  }

  return response.json() as Promise<T>;
}

export type WorkArrangementQuery = {
  keyword?: string;
  status?: WorkArrangementStatus | '';
  type?: WorkArrangementType | '';
  urgency?: WorkArrangementUrgency | '';
  scope?: WorkArrangementScope;
  date?: string;
  projectManagementItemId?: string;
  includeCompleted?: boolean;
  reminderState?: 'UPCOMING' | 'DUE_NOW' | 'OVERDUE';
};

export type WorkArrangementPayload = {
  title: string;
  description?: string;
  type: WorkArrangementType;
  urgency: WorkArrangementUrgency;
  status?: WorkArrangementStatus;
  dueAt?: string | null;
  reminderAt?: string | null;
  estimatedMinutes?: number | null;
  isAllDay?: boolean;
  customTags?: string[];
  recurrence?: WorkArrangementRecurrence;
  projectManagementItemId?: string | null;
  templateId?: string | null;
  dependencyIds?: string[];
  completionSummary?: string | null;
  reflectionSummary?: string | null;
};

export type WorkArrangementTemplatePayload = {
  name: string;
  title: string;
  description?: string;
  type: WorkArrangementType;
  urgency: WorkArrangementUrgency;
  estimatedMinutes?: number | null;
  isAllDay?: boolean;
  customTags?: string[];
  recurrence?: WorkArrangementRecurrence;
};

export async function fetchWorkArrangements(query: WorkArrangementQuery = {}) {
  const params = new URLSearchParams();
  if (query.keyword) params.set('keyword', query.keyword);
  if (query.status) params.set('status', query.status);
  if (query.type) params.set('type', query.type);
  if (query.urgency) params.set('urgency', query.urgency);
  if (query.scope) params.set('scope', query.scope);
  if (query.date) params.set('date', query.date);
  if (query.projectManagementItemId) {
    params.set('projectManagementItemId', query.projectManagementItemId);
  }
  if (query.includeCompleted) params.set('includeCompleted', 'true');
  if (query.reminderState) params.set('reminderState', query.reminderState);

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/work-arrangements${suffix}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<WorkArrangementItem[]>(response);
}

export async function fetchWorkArrangementDailyPlan(date?: string) {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  const response = await fetch(`${API_BASE}/work-arrangements/daily-plan${suffix}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<WorkArrangementDailyPlan>(response);
}

export async function refreshWorkArrangementDailyPlan(date?: string) {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  const response = await fetch(`${API_BASE}/work-arrangements/daily-plan/refresh${suffix}`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<WorkArrangementDailyPlan>(response);
}

export async function fetchWorkArrangementGreeting() {
  const response = await fetch(`${API_BASE}/work-arrangements/greeting`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<{ greeting: string }>(response);
}

export async function fetchWorkArrangementSummary(date?: string) {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  const response = await fetch(`${API_BASE}/work-arrangements/summary${suffix}`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<WorkArrangementSummary>(response);
}

export async function createWorkArrangement(payload: WorkArrangementPayload) {
  const response = await fetch(`${API_BASE}/work-arrangements`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse<WorkArrangementItem>(response);
}

export async function updateWorkArrangement(id: string, payload: Partial<WorkArrangementPayload>) {
  const response = await fetch(`${API_BASE}/work-arrangements/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse<WorkArrangementItem>(response);
}

export async function postponeWorkArrangementReminder(
  id: string,
  payload: PostponeWorkArrangementReminderPayload,
) {
  const response = await fetch(`${API_BASE}/work-arrangements/${id}/postpone-reminder`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse<WorkArrangementItem>(response);
}

export async function deleteWorkArrangement(id: string) {
  const response = await fetch(`${API_BASE}/work-arrangements/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  return parseJsonResponse<{ success: true }>(response);
}

export async function addWorkArrangementNote(
  id: string,
  payload: { type: 'PROGRESS' | 'INSIGHT'; content: string },
) {
  const response = await fetch(`${API_BASE}/work-arrangements/${id}/notes`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse<WorkArrangementNote>(response);
}

export async function fetchWorkArrangementTemplates() {
  const response = await fetch(`${API_BASE}/work-arrangements/templates`, {
    credentials: 'include',
    cache: 'no-store',
  });

  return parseJsonResponse<WorkArrangementTemplate[]>(response);
}

export async function createWorkArrangementTemplate(
  payload: WorkArrangementTemplatePayload,
) {
  const response = await fetch(`${API_BASE}/work-arrangements/templates`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse<WorkArrangementTemplate>(response);
}

export async function updateWorkArrangementTemplate(
  id: string,
  payload: Partial<WorkArrangementTemplatePayload>,
) {
  const response = await fetch(`${API_BASE}/work-arrangements/templates/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return parseJsonResponse<WorkArrangementTemplate>(response);
}

export async function deleteWorkArrangementTemplate(id: string) {
  const response = await fetch(`${API_BASE}/work-arrangements/templates/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  return parseJsonResponse<{ success: true }>(response);
}

export type WorkPortrait = {
  narrative: string;
  metrics: {
    totalApprovals: number;
    avgResponseHours: number;
    completionStreak: number;
    peakDay: string;
    peakPeriod: string;
  };
  domainFocus: { label: string; pct: number }[];
};

export async function fetchWorkPortrait(): Promise<WorkPortrait> {
  const response = await fetch('/api/work-arrangements/portrait', {
    credentials: 'include',
    cache: 'no-store',
  });
  return parseJsonResponse<WorkPortrait>(response);
}
