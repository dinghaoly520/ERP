"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkbenchOverview } from "@/components/work-arrangements/workbench-overview";
import { SchedulePanel } from "@/components/work-arrangements/schedule-panel";
import { TaskDetailPanel } from "@/components/work-arrangements/task-detail-panel";
import { AiAssistPanel } from "@/components/work-arrangements/ai-assist-panel";
import { WorkTaskEditorDrawer } from "@/components/work-arrangements/work-task-editor-drawer";
import { fetchCurrentUser, type AuthUser } from "@/lib/api/auth";
import { fetchProjectManagementList } from "@/lib/api/project-management";
import {
  addWorkArrangementNote,
  createWorkArrangement,
  deleteWorkArrangement,
  fetchWorkArrangementDailyPlan,
  fetchWorkArrangements,
  updateWorkArrangement,
  type WorkArrangementPayload,
} from "@/lib/api/work-arrangements";
import type { ProjectManagementItem } from "@/lib/types/project-management";
import {
  type WorkArrangementDailyPlan,
  type WorkArrangementItem,
  type WorkArrangementNoteType,
  type WorkArrangementRecurrence,
  type WorkArrangementReminderState,
  type WorkArrangementStatus,
  type WorkArrangementType,
  type WorkArrangementUrgency,
} from "@/lib/types/work-arrangements";
import {
  buildWorkbenchOverview,
  deriveReminderState,
} from "@/lib/work-arrangements/workbench";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

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

const DEFAULT_EDITOR_STATE: EditorState = {
  title: "",
  description: "",
  type: "FOLLOW_UP",
  urgency: "MEDIUM",
  status: "TODO",
  dueAt: "",
  reminderAt: "",
  estimatedMinutes: "",
  isAllDay: true,
  customTags: "",
  recurrence: "NONE",
  projectManagementItemId: "",
  dependencyIds: [],
  completionSummary: "",
  reflectionSummary: "",
};

function blankEditor(projectManagementItemId = "") {
  return { ...DEFAULT_EDITOR_STATE, projectManagementItemId };
}

function formatDateInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function editorFromTask(task: WorkArrangementItem): EditorState {
  return {
    title: task.title,
    description: task.description ?? "",
    type: task.type,
    urgency: task.urgency,
    status: task.status,
    dueAt: formatDateInputValue(task.dueAt),
    reminderAt: formatDateInputValue(task.reminderAt),
    estimatedMinutes: task.estimatedMinutes === null ? "" : String(task.estimatedMinutes),
    isAllDay: task.isAllDay,
    customTags: task.customTags.join("，"),
    recurrence: task.recurrence,
    projectManagementItemId: task.projectManagementItem?.id ?? "",
    dependencyIds: task.dependencies.map((d) => d.id),
    completionSummary: task.completionSummary ?? "",
    reflectionSummary: task.reflectionSummary ?? "",
  };
}

function payloadFromEditor(editor: EditorState): WorkArrangementPayload {
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
    customTags: editor.customTags.split(/[，,]/).map((t) => t.trim()).filter(Boolean),
    recurrence: editor.recurrence,
    projectManagementItemId: editor.projectManagementItemId || null,
    dependencyIds: editor.dependencyIds,
    completionSummary: editor.completionSummary.trim() || null,
    reflectionSummary: editor.reflectionSummary.trim() || null,
  };
}

export function WorkArrangementsPageChairman({
  initialProjectManagementItemId,
}: {
  initialProjectManagementItemId: string;
}) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [allItems, setAllItems] = useState<WorkArrangementItem[]>([]);
  const [projects, setProjects] = useState<ProjectManagementItem[]>([]);
  const [dailyPlan, setDailyPlan] = useState<WorkArrangementDailyPlan | null>(null);
  const [refreshingPlan, setRefreshingPlan] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Task editor state
  const [editor, setEditor] = useState<EditorState>(() => blankEditor(initialProjectManagementItemId));
  const [creating, setCreating] = useState(false);
  const [showFullEditor, setShowFullEditor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteType, setNoteType] = useState<WorkArrangementNoteType>("PROGRESS");

  const linkedProject = useMemo(
    () =>
      initialProjectManagementItemId
        ? projects.find((p) => p.id === initialProjectManagementItemId) ?? null
        : null,
    [initialProjectManagementItemId, projects],
  );

  const tasksForSelectedDate = useMemo(
    () =>
      allItems.filter((item) => {
        if (!item.dueAt) return false;
        if (item.status === 'COMPLETED' || item.status === 'CANCELLED') return false;
        const dueDate = new Date(item.dueAt);
        const selEnd = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 1);
        return dueDate < selEnd;
      }),
    [allItems, selectedDate],
  );

  const unscheduledItems = useMemo(
    () => allItems.filter((item) => !item.dueAt),
    [allItems],
  );

  const selectedItem = useMemo(
    () => allItems.find((item) => item.id === selectedItemId) ?? null,
    [allItems, selectedItemId],
  );

  const selectedReminderState = useMemo(
    () => (selectedItem ? deriveReminderState(selectedItem, new Date()) : null),
    [selectedItem],
  );

  const workbenchSummary = useMemo(
    () => buildWorkbenchOverview(allItems, dailyPlan, new Date()),
    [allItems, dailyPlan],
  );

  // ─── Data fetching ────────────────────────────────────────────────

  const loadWorkspace = async () => {
    try {
      const [user, itemsRes, projectsRes, planRes] = await Promise.all([
        fetchCurrentUser(),
        fetchWorkArrangements({}),
        fetchProjectManagementList(),
        fetchWorkArrangementDailyPlan(),
      ]);
      setCurrentUser(user);
      setAllItems(itemsRes);
      setProjects(projectsRes);
      setDailyPlan(planRes);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载数据失败。");
    }
  };

  useEffect(() => {
    void loadWorkspace();
  }, []);

  const refreshTasksOnly = async () => {
    try {
      const items = await fetchWorkArrangements({});
      setAllItems(items);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "刷新任务失败。");
    }
  };

  const handleRefreshPlan = async () => {
    setRefreshingPlan(true);
    try {
      const plan = await fetchWorkArrangementDailyPlan();
      setDailyPlan(plan);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "刷新简报失败。");
    } finally {
      setRefreshingPlan(false);
    }
  };

  const handleSelectTask = (id: string) => {
    const nextId = selectedItemId === id ? null : id;
    setSelectedItemId(nextId);
    if (nextId) {
      const task = allItems.find((item) => item.id === nextId);
      if (task) setEditor(editorFromTask(task));
    }
  };

  const handleOpenEditor = () => {
    if (selectedItem) setEditor(editorFromTask(selectedItem));
    setShowFullEditor(true);
  };

  const handleCreateNew = () => {
    setEditor({
      ...blankEditor(initialProjectManagementItemId),
      dueAt: selectedDate.toISOString().slice(0, 16),
    });
    setCreating(true);
  };

  const handleSave = async () => {
    if (!editor.title.trim()) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      const payload = payloadFromEditor(editor);
      if (creating) {
        await createWorkArrangement(payload);
        setCreating(false);
      } else {
        await updateWorkArrangement(selectedItemId!, payload);
        setShowFullEditor(false);
      }
      await refreshTasksOnly();
      await handleRefreshPlan();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedItemId) return;
    setSaving(true);
    try {
      await deleteWorkArrangement(selectedItemId);
      setSelectedItemId(null);
      setShowFullEditor(false);
      await refreshTasksOnly();
      await handleRefreshPlan();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除失败。");
    } finally {
      setSaving(false);
    }
  };

  const handleAddNote = async () => {
    if (!selectedItemId || !noteDraft.trim()) return;
    setNoteSubmitting(true);
    try {
      await addWorkArrangementNote(selectedItemId, { type: noteType, content: noteDraft.trim() });
      setNoteDraft("");
      await refreshTasksOnly();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "添加备注失败。");
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleQuickStatusUpdate = async (status: WorkArrangementStatus) => {
    if (!selectedItemId) return;
    try {
      await updateWorkArrangement(selectedItemId, { status });
      await refreshTasksOnly();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "更新状态失败。");
    }
  };

  return (
    <>
    <div className="flex min-h-full flex-col gap-4">
      <WorkbenchOverview
        currentUser={currentUser ?? { id: '', username: 'Swhi-CGZX-00', displayName: '尊敬的张宏董事长', role: 'admin', createdAt: null, lastLoginAt: null } as AuthUser}
        dailyPlan={dailyPlan}
      />

      {linkedProject ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[18px] border border-[rgba(96,139,239,0.25)] bg-[rgba(96,139,239,0.08)] px-4 py-3 text-sm text-[color:var(--foreground)]">
          <span className="rounded-[10px] bg-[rgba(96,139,239,0.12)] px-3 py-1 text-xs font-semibold text-[color:var(--accent)]">
            项目关联视图
          </span>
          <span>当前仅展示与"{linkedProject.title}"关联的工作安排。</span>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-[color:var(--accent)]"
          >
            返回项目管理
            <ArrowUpRight size={14} />
          </Link>
        </div>
      ) : null}

      <div className="relative flex min-h-0 gap-4 items-start">
        <div className="w-[calc(40%-0.5rem)] shrink-0 hidden xl:block" aria-hidden />
        <div className="absolute left-0 top-0 bottom-0 w-[calc(40%-0.5rem)] hidden xl:block">
          <SchedulePanel selectedDate={selectedDate} items={allItems} tasksForSelectedDate={tasksForSelectedDate} unscheduledItems={unscheduledItems} selectedItemId={selectedItemId} highlightedTaskIds={[]} onDateSelect={setSelectedDate} onSelectTask={handleSelectTask} onCreateNew={handleCreateNew} />
        </div>
        <div className="w-full xl:hidden">
          <SchedulePanel selectedDate={selectedDate} items={allItems} tasksForSelectedDate={tasksForSelectedDate} unscheduledItems={unscheduledItems} selectedItemId={selectedItemId} highlightedTaskIds={[]} onDateSelect={setSelectedDate} onSelectTask={handleSelectTask} onCreateNew={handleCreateNew} />
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <TaskDetailPanel item={selectedItem} reminderState={selectedReminderState ?? ('NONE' as WorkArrangementReminderState)} noteType={noteType} noteDraft={noteDraft} noteSubmitting={noteSubmitting} showNotesPanel={!!selectedItem} onStart={() => void handleQuickStatusUpdate("IN_PROGRESS")} onComplete={() => void handleQuickStatusUpdate("COMPLETED")} onBlock={() => void handleQuickStatusUpdate("BLOCKED")} onUnblock={() => void handleQuickStatusUpdate("TODO")} onCancel={() => void handleQuickStatusUpdate("CANCELLED")} onPostponeReminder={async () => {}} onOpenFullEditor={handleOpenEditor} onOpenNotes={() => { if (selectedItem) { setNoteDraft(""); setNoteType("PROGRESS"); } }} onNoteTypeChange={setNoteType} onNoteDraftChange={setNoteDraft} onSubmitNote={() => void handleAddNote()} />
          <AiAssistPanel dailyPlan={dailyPlan} refreshingPlan={refreshingPlan} isChairman={true} showProjectBrief={false} onSelectTimeBlock={() => {}} onRefreshPlan={handleRefreshPlan} onShowHistory={() => {}} />
        </div>
      </div>

      {errorMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-[16px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg">
          {errorMessage}
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="ml-3 text-red-400 hover:text-red-600"
          >
            ✕
          </button>
        </div>
      )}
    </div>

      {/* Modal - rendered at root level to avoid CSS containment issues */}
      <WorkTaskEditorDrawer
        open={creating || showFullEditor}
        creating={creating}
        saving={saving}
        selectedItemTitle={selectedItem?.title ?? null}
        editor={editor}
        projects={projects}
        availableDependencies={allItems}
        onClose={() => { setCreating(false); setShowFullEditor(false); }}
        onSave={() => void handleSave()}
        onDelete={() => void handleDelete()}
        onChange={setEditor}
      />
    </>
  );
}
