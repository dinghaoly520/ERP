export const WORK_ARRANGEMENT_TYPE_OPTIONS = [
  { value: 'APPROVAL', label: '审批' },
  { value: 'FOLLOW_UP', label: '跟进' },
  { value: 'WRITING', label: '写作' },
  { value: 'COMMUNICATION', label: '沟通' },
  { value: 'REVIEW', label: '审查' },
  { value: 'ARCHIVE', label: '归档' },
  { value: 'RESEARCH', label: '研究' },
  { value: 'MEETING', label: '会议' },
  { value: 'OTHER', label: '其他' },
] as const;

export const WORK_ARRANGEMENT_URGENCY_OPTIONS = [
  { value: 'LOW', label: '低' },
  { value: 'MEDIUM', label: '中' },
  { value: 'HIGH', label: '高' },
  { value: 'CRITICAL', label: '紧急' },
] as const;

export const WORK_ARRANGEMENT_STATUS_OPTIONS = [
  { value: 'TODO', label: '待处理' },
  { value: 'IN_PROGRESS', label: '进行中' },
  { value: 'BLOCKED', label: '受阻' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'CANCELLED', label: '已取消' },
] as const;

export const WORK_ARRANGEMENT_RECURRENCE_OPTIONS = [
  { value: 'NONE', label: '不重复' },
  { value: 'DAILY', label: '每天' },
  { value: 'WEEKDAYS', label: '工作日' },
  { value: 'WEEKLY', label: '每周' },
  { value: 'MONTHLY', label: '每月' },
] as const;

export type WorkArrangementType =
  (typeof WORK_ARRANGEMENT_TYPE_OPTIONS)[number]['value'];
export type WorkArrangementUrgency =
  (typeof WORK_ARRANGEMENT_URGENCY_OPTIONS)[number]['value'];
export type WorkArrangementStatus =
  (typeof WORK_ARRANGEMENT_STATUS_OPTIONS)[number]['value'];
export type WorkArrangementRecurrence =
  (typeof WORK_ARRANGEMENT_RECURRENCE_OPTIONS)[number]['value'];
export type WorkArrangementScope = 'ALL' | 'TODAY' | 'WEEK';
export type WorkArrangementNoteType = 'PROGRESS' | 'INSIGHT';

export type WorkArrangementProjectLink = {
  id: string;
  title: string;
  currentStage: string;
  status: string;
  visibility?: {
    showTitle: boolean;
    showStatus: boolean;
    showDueAt: boolean;
    showOwner: boolean;
  };
};

export type WorkArrangementDependency = {
  id: string;
  title: string;
  status: WorkArrangementStatus;
};

export type WorkArrangementNote = {
  id: string;
  type: WorkArrangementNoteType;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkArrangementTemplate = {
  id: string;
  name: string;
  title: string;
  description: string | null;
  type: WorkArrangementType;
  urgency: WorkArrangementUrgency;
  estimatedMinutes: number | null;
  isAllDay: boolean;
  customTags: string[];
  recurrence: WorkArrangementRecurrence;
  createdAt: string;
  updatedAt: string;
};

export type WorkArrangementItem = {
  id: string;
  title: string;
  description: string | null;
  type: WorkArrangementType;
  urgency: WorkArrangementUrgency;
  status: WorkArrangementStatus;
  dueAt: string | null;
  reminderAt: string | null;
  estimatedMinutes: number | null;
  isAllDay: boolean;
  customTags: string[];
  recurrence: WorkArrangementRecurrence;
  completionSummary: string | null;
  reflectionSummary: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  notes: WorkArrangementNote[];
  template: WorkArrangementTemplate | null;
  projectManagementItem: WorkArrangementProjectLink | null;
  dependencies: WorkArrangementDependency[];
};

export type WorkArrangementDailyPlan = {
  date: string;
  headerGreeting: string;
  namePraise: string;
  dailyGreeting: string;
  riskSummary: string;
  aiSuggestion: string;
  overview: string;
  focusItems: Array<{
    id: string;
    title: string;
    reason: string;
    priorityRank: number;
  }>;
  timeBlocks: Array<{
    label: string;
    start: string;
    end: string;
    focus: string;
    taskIds: string[];
  }>;
  riskAlerts: string[];
  completionAdvice: string;
  projectBrief: string;
};

export type WorkArrangementReminderState =
  | 'NONE'
  | 'UPCOMING'
  | 'DUE_NOW'
  | 'OVERDUE';

export type WorkArrangementWorkbenchOverview = {
  todoCount: number;
  inProgressCount: number;
  dueTodayCount: number;
  riskCount: number;
  overview: string;
};

export type WorkArrangementTaskFlowGroupKey =
  | 'FOCUS'
  | 'IN_PROGRESS'
  | 'TODO'
  | 'BLOCKED'
  | 'TODAY'
  | 'WEEK'
  | 'ALL';

export type WorkArrangementTaskFlowGroup = {
  key: WorkArrangementTaskFlowGroupKey;
  title: string;
  count: number;
  items: WorkArrangementItem[];
};

export type WorkArrangementWorkbenchSignal =
  | { type: 'SUMMARY'; filter: 'DUE_TODAY' | 'RISK' | 'IN_PROGRESS' | 'TODO' }
  | { type: 'FOCUS_ITEM'; taskId: string }
  | { type: 'TIME_BLOCK'; taskIds: string[] }
  | { type: 'RISK_ALERT'; taskIds: string[] };

export type WorkArrangementSummary = {
  todoCount: number;
  inProgressCount: number;
  dueTodayCount: number;
  riskCount: number;
};

export type PostponeWorkArrangementReminderPayload = {
  preset: 'PLUS_30_MINUTES' | 'THIS_AFTERNOON' | 'TOMORROW_MORNING' | 'CUSTOM';
  targetAt?: string;
};

export const WORK_ARRANGEMENT_TYPE_LABELS: Record<
  WorkArrangementType,
  string
> = Object.fromEntries(
  WORK_ARRANGEMENT_TYPE_OPTIONS.map((item) => [item.value, item.label]),
) as Record<WorkArrangementType, string>;

export const WORK_ARRANGEMENT_URGENCY_LABELS: Record<
  WorkArrangementUrgency,
  string
> = Object.fromEntries(
  WORK_ARRANGEMENT_URGENCY_OPTIONS.map((item) => [item.value, item.label]),
) as Record<WorkArrangementUrgency, string>;

export const WORK_ARRANGEMENT_STATUS_LABELS: Record<
  WorkArrangementStatus,
  string
> = Object.fromEntries(
  WORK_ARRANGEMENT_STATUS_OPTIONS.map((item) => [item.value, item.label]),
) as Record<WorkArrangementStatus, string>;

export const WORK_ARRANGEMENT_RECURRENCE_LABELS: Record<
  WorkArrangementRecurrence,
  string
> = Object.fromEntries(
  WORK_ARRANGEMENT_RECURRENCE_OPTIONS.map((item) => [item.value, item.label]),
) as Record<WorkArrangementRecurrence, string>;
