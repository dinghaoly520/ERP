'use client';

import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, ChevronUp, Save, Trash2 } from 'lucide-react';
import { Modal } from '@/components/workbench';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import {
  WORK_ARRANGEMENT_RECURRENCE_OPTIONS,
  WORK_ARRANGEMENT_STATUS_OPTIONS,
  WORK_ARRANGEMENT_TYPE_OPTIONS,
  WORK_ARRANGEMENT_URGENCY_OPTIONS,
  type WorkArrangementRecurrence,
  type WorkArrangementStatus,
  type WorkArrangementType,
  type WorkArrangementUrgency,
} from '@/lib/types/work-arrangements';
import type { WorkArrangementEditorState as EditorState } from '@/lib/work-arrangements/editor';

type WorkTaskEditorDrawerProps = {
  open: boolean;
  creating: boolean;
  saving: boolean;
  selectedItemTitle: string | null;
  editor: EditorState;
  projects: ProjectManagementItem[];
  onClose: () => void;
  onSave: () => void;
  onDelete: () => void;
  onChange: Dispatch<SetStateAction<EditorState>>;
};

/** 分节标题：小标 + 提示 + 1px 发丝线（.impeccable 分节语汇，打破整列堆叠的拥挤感） */
function EditorSection({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0 text-xs font-semibold tracking-wide text-[color:var(--accent)]">{title}</span>
      {hint ? <span className="shrink-0 text-[10px] text-[color:var(--muted-foreground)]">{hint}</span> : null}
      <span className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}

export function WorkTaskEditorDrawer({
  open,
  creating,
  saving,
  selectedItemTitle,
  editor,
  projects,
  onClose,
  onSave,
  onDelete,
  onChange,
}: WorkTaskEditorDrawerProps) {
  // 收尾沉淀（完成摘要/心得反思）：编辑已有任务默认展开、新建默认收起；
  // 每次重新打开按 creating 重置（组件常驻挂载，state 不会自行复位）
  const [wrapUpOpen, setWrapUpOpen] = useState(!creating);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setWrapUpOpen(!creating);
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={creating ? '新建工作安排' : selectedItemTitle ?? '编辑工作'}
      description={creating ? '填写以下信息创建新的工作安排' : '修改工作安排的详细信息'}
      size="lg"
      footer={
        <>
          {!creating ? (
            <button type="button" onClick={onDelete} disabled={saving} className="neu-btn-soft is-danger h-[38px]"><Trash2 size={16} />删除</button>
          ) : null}
          <button type="button" onClick={onClose} disabled={saving} className="neu-btn-soft h-[38px]">取消</button>
          <button type="button" onClick={onSave} disabled={saving || !editor.title.trim()} className="neu-btn-primary !h-[38px]"><Save size={16} />{saving ? '保存中...' : creating ? '创建工作' : '保存修改'}</button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <EditorSection title="基本信息" />

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid min-w-0 gap-2 text-sm text-[color:var(--foreground)]">
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
          <label className="grid min-w-0 gap-2 text-sm text-[color:var(--foreground)]">
            <span className="font-medium">项目关联</span>
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
                  {project.projectCode ? `${project.title}（${project.projectCode}）` : project.title}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              名称 + 项目编号；列表按项目归属隔离（本人 / 本公司可见范围）
            </span>
          </label>
        </div>

        <EditorSection title="任务说明" />
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

        <EditorSection title="分类与状态" />
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid min-w-0 gap-2 text-sm text-[color:var(--foreground)]">
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
          <label className="grid min-w-0 gap-2 text-sm text-[color:var(--foreground)]">
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
          <label className="grid min-w-0 gap-2 text-sm text-[color:var(--foreground)]">
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
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-[color:var(--muted-foreground)]">
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
        </div>

        <EditorSection title="时间安排" />
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid min-w-0 gap-2 text-sm text-[color:var(--foreground)]">
            <span className="font-medium">截止时间</span>
            <input
              type="datetime-local"
              value={editor.dueAt}
              onChange={(event) =>
                onChange((current) => ({ ...current, dueAt: event.target.value }))
              }
              className="workbench-input min-w-0"
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
              className="workbench-input min-w-0"
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
              className="workbench-input min-w-0"
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
              className="workbench-input min-w-0"
            >
              {WORK_ARRANGEMENT_RECURRENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 收尾沉淀：完成阶段的字段，新建时默认收起（2026-10-21 拥挤度治理） */}
        <button
          type="button"
          onClick={() => setWrapUpOpen((v) => !v)}
          className="flex w-full items-center gap-3 text-left"
        >
          <span className="shrink-0 text-xs font-semibold tracking-wide text-[color:var(--accent)]">收尾沉淀</span>
          <span className="shrink-0 text-[10px] text-[color:var(--muted-foreground)]">完成任务时填写，可留空</span>
          <span className="h-px flex-1 bg-[var(--border)]" />
          {wrapUpOpen ? (
            <ChevronUp size={14} className="shrink-0 text-[color:var(--muted-foreground)]" />
          ) : (
            <ChevronDown size={14} className="shrink-0 text-[color:var(--muted-foreground)]" />
          )}
        </button>

        {wrapUpOpen && (
          <div className="flex flex-col gap-4">
            <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">完成摘要</span>
              <textarea
                value={editor.completionSummary}
                onChange={(event) =>
                  onChange((current) => ({ ...current, completionSummary: event.target.value }))
                }
                rows={2}
                placeholder="完成任务时填写：成果与结论（标记完成时引导填写）"
                className="neu-input text-sm"
              />
            </label>

            <label className="grid gap-2 text-sm text-[color:var(--foreground)]">
              <span className="font-medium">心得反思</span>
              <textarea
                value={editor.reflectionSummary}
                onChange={(event) =>
                  onChange((current) => ({ ...current, reflectionSummary: event.target.value }))
                }
                rows={2}
                placeholder="可复用的经验、踩过的坑"
                className="neu-input text-sm"
              />
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
}
