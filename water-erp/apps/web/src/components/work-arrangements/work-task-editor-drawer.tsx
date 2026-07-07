'use client';

import type { Dispatch, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { X, Save, Trash2 } from 'lucide-react';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import {
  WORK_ARRANGEMENT_RECURRENCE_LABELS,
  WORK_ARRANGEMENT_RECURRENCE_OPTIONS,
  WORK_ARRANGEMENT_STATUS_OPTIONS,
  WORK_ARRANGEMENT_TYPE_OPTIONS,
  WORK_ARRANGEMENT_URGENCY_OPTIONS,
  type WorkArrangementItem,
  type WorkArrangementRecurrence,
  type WorkArrangementStatus,
  type WorkArrangementType,
  type WorkArrangementUrgency,
} from '@/lib/types/work-arrangements';

type EditorState = {
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
  dependencyIds: string[];
  completionSummary: string;
  reflectionSummary: string;
};

type WorkTaskEditorDrawerProps = {
  open: boolean;
  creating: boolean;
  saving: boolean;
  selectedItemTitle: string | null;
  editor: EditorState;
  projects: ProjectManagementItem[];
  availableDependencies: WorkArrangementItem[];
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onChange: Dispatch<SetStateAction<EditorState>>;
};

export function WorkTaskEditorDrawer({
  open,
  creating,
  saving,
  selectedItemTitle,
  editor,
  projects,
  availableDependencies,
  onClose,
  onSave,
  onDelete,
  onChange,
}: WorkTaskEditorDrawerProps) {
  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop with blur effect */}
      <div
        className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-[min(672px,92vw)] max-h-[90vh] overflow-y-auto rounded-[20px] bg-[var(--background)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-4">
          <div>
            <h2 id="editor-title" className="text-lg font-semibold text-balance text-[color:var(--foreground)]">
              {creating ? '新建工作安排' : selectedItemTitle ?? '编辑工作'}
            </h2>
            <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
              {creating ? '填写以下信息创建新的工作安排' : '修改工作安排的详细信息'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="neu-btn-xs"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">标题 *</span>
              <input
                value={editor.title}
                onChange={(event) =>
                  onChange((current) => ({ ...current, title: event.target.value }))
                }
                placeholder="输入工作标题"
                className="workbench-input"
              />
            </label>
            <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">关联项目</span>
              <select
                value={editor.projectManagementItemId}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    projectManagementItemId: event.target.value,
                  }))
                }
                className="workbench-input"
              >
                <option value="">不关联具体项目</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
            <span className="font-medium">任务说明</span>
            <textarea
              value={editor.description}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={3}
              placeholder="详细描述这项工作的内容"
              className="neu-input text-sm"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">类型</span>
              <select
                value={editor.type}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    type: event.target.value as WorkArrangementType,
                  }))
                }
                className="workbench-input"
              >
                {WORK_ARRANGEMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">紧急程度</span>
              <select
                value={editor.urgency}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    urgency: event.target.value as WorkArrangementUrgency,
                  }))
                }
                className="workbench-input"
              >
                {WORK_ARRANGEMENT_URGENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">状态</span>
              <select
                value={editor.status}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    status: event.target.value as WorkArrangementStatus,
                  }))
                }
                className="workbench-input"
              >
                {WORK_ARRANGEMENT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid min-w-0 gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">截止时间</span>
              <input
                type="datetime-local"
                value={editor.dueAt}
                onChange={(event) =>
                  onChange((current) => ({ ...current, dueAt: event.target.value }))
                }
                className="workbench-input flex-1 min-w-0"
              />
            </label>
            <label className="grid min-w-0 gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">提醒时间</span>
              <input
                type="datetime-local"
                value={editor.reminderAt}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    reminderAt: event.target.value,
                  }))
                }
                className="workbench-input flex-1 min-w-0"
              />
            </label>
            <label className="grid min-w-0 gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">预计耗时（分钟）</span>
              <input
                type="number"
                min="0"
                value={editor.estimatedMinutes}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    estimatedMinutes: event.target.value,
                  }))
                }
                className="workbench-input flex-1 min-w-0"
              />
            </label>
            <label className="grid min-w-0 gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">重复规则</span>
              <select
                value={editor.recurrence}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    recurrence: event.target.value as WorkArrangementRecurrence,
                  }))
                }
                className="workbench-input flex-1 min-w-0"
              >
                {WORK_ARRANGEMENT_RECURRENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={editor.isAllDay}
                onChange={(event) =>
                  onChange((current) => ({
                    ...current,
                    isAllDay: event.target.checked,
                  }))
                }
              />
              视为全天事项
            </label>
            <div className="text-xs text-[color:var(--muted-foreground)]">
              当前重复：{WORK_ARRANGEMENT_RECURRENCE_LABELS[editor.recurrence]}
            </div>
          </div>

          <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
            <span className="font-medium">标签</span>
            <input
              value={editor.customTags}
              onChange={(event) =>
                onChange((current) => ({ ...current, customTags: event.target.value }))
              }
              placeholder="用逗号分隔，例如：招标文件，今日重点"
              className="workbench-input"
            />
          </label>
        </div>

        {/* Footer */}
        <hr className="wb-section-rule" />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {!creating ? (
            <button type="button" onClick={onDelete} disabled={saving} className="neu-btn-soft is-danger h-[38px]"><Trash2 size={16} />删除</button>
          ) : null}
          <button type="button" onClick={onClose} disabled={saving} className="neu-btn-soft h-[38px]">取消</button>
          <button type="button" onClick={onSave} disabled={saving || !editor.title.trim()} className="neu-btn-primary !h-[38px]"><Save size={16} />{saving ? '保存中...' : creating ? '创建工作' : '保存修改'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}