import type { WorkArrangementPayload } from '@/lib/api/work-arrangements';
import type {
  WorkArrangementItem,
  WorkArrangementRecurrence,
  WorkArrangementStatus,
  WorkArrangementType,
  WorkArrangementUrgency,
} from '@/lib/types/work-arrangements';

/**
 * 工作安排编辑器表单状态与换算——普通页 / 董事长页 / 编辑抽屉三方共用
 * （2026-10-21 抽出：两页各自维护一份曾致口径漂移，抽屉又复制了类型定义）。
 */
export type WorkArrangementEditorState = {
  title: string;
  description: string;
  type: WorkArrangementType;
  urgency: WorkArrangementUrgency;
  status: WorkArrangementStatus;
  dueAt: string;
  reminderAt: string;
  estimatedMinutes: string;
  isAllDay: boolean;
  customTags: string;
  recurrence: WorkArrangementRecurrence;
  projectManagementItemId: string;
  // 「依赖任务」录入 UI 已下线（2026-10-21 用户裁定改为项目关联）——
  // 字段链路保留：编辑存量带依赖的任务时原样回传，不静默清空既有依赖
  dependencyIds: string[];
  completionSummary: string;
  reflectionSummary: string;
};

const DEFAULT_EDITOR_STATE: WorkArrangementEditorState = {
  title: '',
  description: '',
  type: 'FOLLOW_UP',
  urgency: 'MEDIUM',
  status: 'TODO',
  dueAt: '',
  reminderAt: '',
  estimatedMinutes: '',
  isAllDay: true,
  customTags: '',
  recurrence: 'NONE',
  projectManagementItemId: '',
  dependencyIds: [],
  completionSummary: '',
  reflectionSummary: '',
};

export function blankEditor(projectManagementItemId = ''): WorkArrangementEditorState {
  return { ...DEFAULT_EDITOR_STATE, projectManagementItemId };
}

/** datetime-local 输入框值：本地时区墙钟（ISO 截到分钟） */
function formatDateInputValue(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

export function editorFromTask(task: WorkArrangementItem): WorkArrangementEditorState {
  return {
    title: task.title,
    description: task.description ?? '',
    type: task.type,
    urgency: task.urgency,
    status: task.status,
    dueAt: formatDateInputValue(task.dueAt),
    reminderAt: formatDateInputValue(task.reminderAt),
    estimatedMinutes: task.estimatedMinutes === null ? '' : String(task.estimatedMinutes),
    isAllDay: task.isAllDay,
    customTags: task.customTags.join('，'),
    recurrence: task.recurrence,
    projectManagementItemId: task.projectManagementItem?.id ?? '',
    dependencyIds: task.dependencies.map((dependency) => dependency.id),
    completionSummary: task.completionSummary ?? '',
    reflectionSummary: task.reflectionSummary ?? '',
  };
}

export function payloadFromEditor(editor: WorkArrangementEditorState): WorkArrangementPayload {
  return {
    title: editor.title.trim(),
    description: editor.description.trim() || undefined,
    type: editor.type,
    urgency: editor.urgency,
    status: editor.status,
    dueAt: editor.dueAt ? new Date(editor.dueAt).toISOString() : null,
    reminderAt: editor.reminderAt ? new Date(editor.reminderAt).toISOString() : null,
    estimatedMinutes: editor.estimatedMinutes ? Number(editor.estimatedMinutes) : null,
    isAllDay: editor.isAllDay,
    customTags: editor.customTags
      .split(/[，,]/)
      .map((item) => item.trim())
      .filter(Boolean),
    recurrence: editor.recurrence,
    projectManagementItemId: editor.projectManagementItemId || null,
    dependencyIds: editor.dependencyIds,
    completionSummary: editor.completionSummary.trim() || null,
    reflectionSummary: editor.reflectionSummary.trim() || null,
  };
}
