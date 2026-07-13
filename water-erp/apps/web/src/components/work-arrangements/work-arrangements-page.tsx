"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WorkbenchOverview } from "@/components/work-arrangements/workbench-overview";
import { SchedulePanel } from "@/components/work-arrangements/schedule-panel";
import { TaskNotificationCenter } from "@/components/work-arrangements/task-notification-center";
import { TaskDetailModal } from "@/components/work-arrangements/task-detail-modal";
import type { PlannedItem } from "@/components/work-arrangements/ai-planning-panel";
import { WorkTaskEditorDrawer } from "@/components/work-arrangements/work-task-editor-drawer";
import { HistoryDrawer } from "@/components/work-arrangements/history-drawer";
import { ReminderBanner } from "@/components/work-arrangements/reminder-banner";
import { fetchCurrentUser, type AuthUser } from "@/lib/api/auth";
import { fetchProjectManagementList } from "@/lib/api/project-management";
import {
  addWorkArrangementNote,
  createWorkArrangement,
  deleteWorkArrangement,
  fetchWorkArrangementDailyPlan,
  fetchWorkArrangements,
  refreshWorkArrangementDailyPlan,
  postponeWorkArrangementReminder,
  type WorkArrangementPayload,
  type WorkArrangementQuery,
  updateWorkArrangement,
} from "@/lib/api/work-arrangements";
import type { ProjectManagementItem } from "@/lib/types/project-management";
import {
  type WorkArrangementDailyPlan,
  type WorkArrangementItem,
  type WorkArrangementNoteType,
  type WorkArrangementRecurrence,
  type WorkArrangementStatus,
  type WorkArrangementType,
  type WorkArrangementUrgency,
} from "@/lib/types/work-arrangements";
import {
  buildWorkbenchOverview,
  deriveReminderState,
} from "@/lib/work-arrangements/workbench";
import {
  requestNotificationPermission,
  sendBrowserNotification,
  type ReminderInfo,
} from "@/lib/work-arrangements/reminder";
import { ArrowUpRight, Plus } from "lucide-react";
import Link from "next/link";

// Module-level cache for workspace data — persists across same-session page navigation
type WorkspaceCache = {
  user: AuthUser | null;
  items: WorkArrangementItem[];
  projects: ProjectManagementItem[];
  dailyPlan: WorkArrangementDailyPlan | null;
  lastFetchedAt: number;
};

const workspaceCache: WorkspaceCache = {
  user: null,
  items: [],
  projects: [],
  dailyPlan: null,
  lastFetchedAt: 0,
};

// Cache validity: 5 minutes
const CACHE_VALIDITY_MS = 5 * 60 * 1000;

function isCacheValid(): boolean {
  return workspaceCache.lastFetchedAt > 0 &&
    Date.now() - workspaceCache.lastFetchedAt < CACHE_VALIDITY_MS;
}

export function clearWorkspaceCache() {
  workspaceCache.user = null;
  workspaceCache.items = [];
  workspaceCache.projects = [];
  workspaceCache.dailyPlan = null;
  workspaceCache.lastFetchedAt = 0;
}

// ── localStorage-backed dailyPlan cache — persists across sessions ──
const DAILY_PLAN_STORAGE_KEY = 'workspace:daily-plan';
const DAILY_PLAN_STORAGE_TTL = 12 * 60 * 60 * 1000; // 12 hours

interface StoredDailyPlan {
  userId: string;
  plan: WorkArrangementDailyPlan;
  savedAt: number;
}

function saveDailyPlanToStorage(userId: string, plan: WorkArrangementDailyPlan): void {
  try {
    const data: StoredDailyPlan = { userId, plan, savedAt: Date.now() };
    localStorage.setItem(DAILY_PLAN_STORAGE_KEY, JSON.stringify(data));
  } catch { /* quota exceeded or private browsing — silently ignore */ }
}

function loadDailyPlanFromStorage(
  userId: string,
  cacheDate: string,
): WorkArrangementDailyPlan | null {
  try {
    const raw = localStorage.getItem(DAILY_PLAN_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as StoredDailyPlan;
    // Must belong to current user, be for today, and not expired
    if (data.userId !== userId) return null;
    if (data.plan.date !== cacheDate) return null;
    if (Date.now() - data.savedAt > DAILY_PLAN_STORAGE_TTL) return null;
    return data.plan;
  } catch {
    return null;
  }
}

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

function formatDateInputValue(value: string | null) {
  if (!value) {
    return "";
  }

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
    estimatedMinutes:
      task.estimatedMinutes === null ? "" : String(task.estimatedMinutes),
    isAllDay: task.isAllDay,
    customTags: task.customTags.join("，"),
    recurrence: task.recurrence,
    projectManagementItemId: task.projectManagementItem?.id ?? "",
    dependencyIds: task.dependencies.map((dependency) => dependency.id),
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
    estimatedMinutes: editor.estimatedMinutes
      ? Number(editor.estimatedMinutes)
      : null,
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

function blankEditor(projectManagementItemId = "") {
  return {
    ...DEFAULT_EDITOR_STATE,
    projectManagementItemId,
  };
}

export function WorkArrangementsPage({
  initialProjectManagementItemId = "",
}: {
  initialProjectManagementItemId?: string;
}) {
  const linkedProjectId = initialProjectManagementItemId;

  // Initialize state from cache if available
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => workspaceCache.user);
  const [allItems, setAllItems] = useState<WorkArrangementItem[]>(() => workspaceCache.items);
  const [projects, setProjects] = useState<ProjectManagementItem[]>(() => workspaceCache.projects);
  // Init from localStorage first (instant), then module cache, then null
  const [dailyPlan, setDailyPlan] = useState<WorkArrangementDailyPlan | null>(() => {
    if (workspaceCache.dailyPlan) return workspaceCache.dailyPlan;
    // Fallback: try localStorage for an instant render while AI loads
    if (workspaceCache.user) {
      const today = new Date().toISOString().slice(0, 10);
      return loadDailyPlanFromStorage(workspaceCache.user.id, today);
    }
    return null;
  });
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [selectedItemId, setSelectedItemId] = useState<string | null>(() =>
    workspaceCache.items[0]?.id ?? null
  );
  const [editor, setEditor] = useState<EditorState>(() =>
    workspaceCache.items[0] ? editorFromTask(workspaceCache.items[0]) : blankEditor(linkedProjectId)
  );
  const [creating, setCreating] = useState(false);
  const lastSelectedIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingPlan, setRefreshingPlan] = useState(false);
  const [saving, setSaving] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteType, setNoteType] = useState<WorkArrangementNoteType>("PROGRESS");
  const [highlightedTaskIds, setHighlightedTaskIds] = useState<string[]>([]);
  const [showFullEditor, setShowFullEditor] = useState(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [activeReminders, setActiveReminders] = useState<ReminderInfo[]>([]);

  const linkedProject =
    projects.find((project) => project.id === linkedProjectId) ?? null;

  // Tasks for the selected date — includes undone tasks from prior days
  const tasksForSelectedDate = useMemo(() => {
    const dayStart = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    return allItems.filter(item => {
      if (!item.dueAt) return false;
      if (item.status === 'COMPLETED' || item.status === 'CANCELLED') return false;
      const due = new Date(item.dueAt).getTime();
      // 当日任务 + 过期末完成任务
      return due < dayEnd.getTime();
    });
  }, [allItems, selectedDate]);

  // Tasks without due dates
  const unscheduledItems = useMemo(() => {
    return allItems.filter(item => !item.dueAt);
  }, [allItems]);

  const selectedItem =
    allItems.find((item) => item.id === selectedItemId) ?? null;

  const workbenchSummary = useMemo(
    () => buildWorkbenchOverview(allItems, dailyPlan, new Date()),
    [allItems, dailyPlan],
  );

  const selectedReminderState = selectedItem
    ? deriveReminderState(selectedItem, new Date())
    : 'NONE';

  const availableDependencies = useMemo(
    () =>
      allItems.filter((item) =>
        creating ? true : item.id !== selectedItemId,
      ),
    [creating, allItems, selectedItemId],
  );

  const buildQuery = (): WorkArrangementQuery => ({
    scope: 'ALL',
    includeCompleted: true,
    projectManagementItemId: linkedProjectId || undefined,
  });

  const syncEditorToTask = (task: WorkArrangementItem | null) => {
    if (!task) {
      setEditor(blankEditor(linkedProjectId));
      // 不自动设置 creating = true，只有用户主动点击"新建"时才打开抽屉
      return;
    }

    setEditor(editorFromTask(task));
    setCreating(false);
  };

  const loadDailyPlan = async () => {
    try {
      setRefreshingPlan(true);
      // 使用 POST /refresh 端点强制触发 AI 重新生成 + 更新 DB 缓存
      const nextPlan = await refreshWorkArrangementDailyPlan();
      workspaceCache.dailyPlan = nextPlan;
      setDailyPlan(nextPlan);
      // Persist to localStorage for future instant loads
      const userId = workspaceCache.user?.id;
      if (userId) saveDailyPlanToStorage(userId, nextPlan);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载 AI 建议失败。");
    } finally {
      setRefreshingPlan(false);
    }
  };

  // 轻量级刷新：只更新任务列表，不刷新 AI 排程（用于编辑、状态变更等操作）
  const refreshTasksOnly = async (preserveSelection = true) => {
    try {
      const tasks = await fetchWorkArrangements(buildQuery());
      workspaceCache.items = tasks;
      workspaceCache.lastFetchedAt = Date.now();
      setAllItems(tasks);

      if (preserveSelection && selectedItemId && tasks.some((task) => task.id === selectedItemId)) {
        setSelectedItemId(selectedItemId);
        syncEditorToTask(tasks.find((task) => task.id === selectedItemId) ?? null);
      } else {
        const nextSelectedId = tasks[0]?.id ?? null;
        setSelectedItemId(nextSelectedId);
        syncEditorToTask(tasks.find((task) => task.id === nextSelectedId) ?? null);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "刷新任务列表失败。");
    }
  };

  // 完整刷新：包含 AI 排程（用于新建、删除、手动刷新）
  const loadWorkspace = async (preserveSelection = true, forceRefresh = false) => {
    // Always verify current user matches cached user; invalidate on mismatch
    if (!forceRefresh && isCacheValid() && workspaceCache.items.length > 0) {
      try {
        const currentUser = await fetchCurrentUser();
        if (workspaceCache.user && workspaceCache.user.id !== currentUser.id) {
          workspaceCache.lastFetchedAt = 0;
        } else {
          setCurrentUser(currentUser);
          return;
        }
      } catch {
        // If we can't verify, proceed with full load
      }
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      // 核心数据（用户、任务、项目）与 AI 排程分开加载，
      // 避免 AI 服务不可用时阻塞整个工作台。
      const [user, tasks, nextProjects] = await Promise.all([
        fetchCurrentUser(),
        fetchWorkArrangements(buildQuery()),
        fetchProjectManagementList("ACTIVE"),
      ]);

      // Update cache (without dailyPlan for now)
      workspaceCache.user = user;
      workspaceCache.items = tasks;
      workspaceCache.projects = nextProjects;
      workspaceCache.lastFetchedAt = Date.now();

      setCurrentUser(user);
      setAllItems(tasks);
      setProjects(nextProjects);

      const nextSelectedId =
        preserveSelection &&
        selectedItemId &&
        tasks.some((task) => task.id === selectedItemId)
          ? selectedItemId
          : tasks[0]?.id ?? null;

      setSelectedItemId(nextSelectedId);
      syncEditorToTask(tasks.find((task) => task.id === nextSelectedId) ?? null);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载工作安排失败。");
    } finally {
      setLoading(false);
    }

    // AI 排程独立加载，失败不影响核心功能
    try {
      const nextPlan = await fetchWorkArrangementDailyPlan();
      workspaceCache.dailyPlan = nextPlan;
      setDailyPlan(nextPlan);
      // Persist to localStorage so future page loads show greeting instantly
      const userId = workspaceCache.user?.id;
      if (userId) saveDailyPlanToStorage(userId, nextPlan);
    } catch {
      // AI 排程加载失败不显示错误，WorkbenchOverview 组件会独立重试
    }
  };

  // Hydrate dailyPlan from localStorage once user is known (handles case where
  // module cache was valid so loadWorkspace returned early without AI fetch)
  useEffect(() => {
    if (dailyPlan || !currentUser) return;
    const today = new Date().toISOString().slice(0, 10);
    const cached = loadDailyPlanFromStorage(currentUser.id, today);
    if (cached) {
      workspaceCache.dailyPlan = cached;
      setDailyPlan(cached);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  useEffect(() => {
    void loadWorkspace(false, false); // Use cache if available
    // 请求浏览器通知权限
    void requestNotificationPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    linkedProjectId,
  ]); // Only reload when linkedProjectId changes

  // 后台静默刷新每日计划（页面打开后滞后执行，不阻塞首屏渲染）
  useEffect(() => {
    if (!currentUser) return;
    const timer = setTimeout(() => {
      void refreshWorkArrangementDailyPlan()
        .then((fresh) => {
          if (fresh) {
            workspaceCache.dailyPlan = fresh;
            setDailyPlan(fresh);
            saveDailyPlanToStorage(currentUser.id, fresh);
          }
        })
        .catch(() => { /* 静默失败，不影响用户体验 */ });
    }, 3000); // 延迟 3 秒，确保首屏渲染完成
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // 提醒检查：每分钟检查一次即将到期的任务
  useEffect(() => {
    const checkReminders = () => {
      const now = new Date();
      const newReminders: ReminderInfo[] = [];

      for (const item of allItems) {
        // 跳过已完成或已取消的任务
        if (item.status === 'COMPLETED' || item.status === 'CANCELLED') continue;
        // 没有设置提醒时间
        if (!item.reminderAt) continue;

        const reminderTime = new Date(item.reminderAt).getTime();
        const nowTime = now.getTime();
        const diffSeconds = (reminderTime - nowTime) / 1000;

        // 提醒时间在未来 60 秒内，或已过但不超过 5 分钟
        if (diffSeconds <= 60 && diffSeconds > -300) {
          const reminderState = deriveReminderState(item, now);
          newReminders.push({
            taskId: item.id,
            taskTitle: item.title,
            reminderState,
            dueAt: item.dueAt,
          });
        }
      }

      if (newReminders.length > 0) {
        setActiveReminders(prev => {
          // 合并新提醒，避免重复
          const existingIds = new Set(prev.map(r => r.taskId));
          const merged = [...prev];
          for (const r of newReminders) {
            if (!existingIds.has(r.taskId)) {
              merged.push(r);
              // 发送浏览器通知
              const message = r.reminderState === 'UPCOMING'
                ? '即将到达提醒时间'
                : r.reminderState === 'DUE_NOW'
                  ? '提醒时间已到'
                  : '提醒已超时';
              sendBrowserNotification(
                `任务提醒：${r.taskTitle}`,
                message,
                () => handleSelectTask(r.taskId)
              );
            }
          }
          return merged;
        });
      }
    };

    // 立即检查一次
    checkReminders();

    // 每分钟检查一次
    const interval = setInterval(checkReminders, 60 * 1000);
    return () => clearInterval(interval);
  }, [allItems]);

  useEffect(() => {
    if (selectedItem) {
      setEditor(editorFromTask(selectedItem));
      setCreating(false);
    } else if (!creating) {
      setEditor(blankEditor(linkedProjectId));
    }
  }, [creating, linkedProjectId, selectedItem]);

  const handleCreateNew = () => {
    // 记住当前选中任务，关窗时恢复
    lastSelectedIdRef.current = selectedItemId;
    setSelectedItemId(null);
    setNoteDraft("");
    setCreating(true);
    setEditor({
      ...blankEditor(linkedProjectId),
      dueAt: selectedDate.toISOString().slice(0, 16),
      isAllDay: false,
    });
  };

  const handleSelectTask = (taskId: string) => {
    setSelectedItemId(taskId);
    setNoteDraft("");
    setCreating(false);
    setShowTaskModal(true);
  };

  const handleSave = async () => {
    if (!editor.title.trim()) {
      setErrorMessage("请先填写工作标题。");
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    try {
      if (creating) {
        const created = await createWorkArrangement(payloadFromEditor(editor));
        await loadWorkspace(false, true); // 新建任务：完整刷新（含 AI 排程）
        setSelectedItemId(created.id);
        setCreating(false);
      } else if (selectedItemId) {
        await updateWorkArrangement(selectedItemId, payloadFromEditor(editor));
        await refreshTasksOnly(); // 编辑任务：轻量级刷新（不含 AI）
        setSelectedItemId(selectedItemId);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "保存工作安排失败。");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedItemId) {
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    try {
      await deleteWorkArrangement(selectedItemId);
      setSelectedItemId(null);
      await loadWorkspace(false, true); // 删除任务：完整刷新（含 AI 排程）
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "删除工作安排失败。");
    } finally {
      setSaving(false);
    }
  };

  const handleAddNote = async () => {
    if (!selectedItemId || !noteDraft.trim()) {
      return;
    }

    setNoteSubmitting(true);
    setErrorMessage(null);
    try {
      await addWorkArrangementNote(selectedItemId, {
        type: noteType,
        content: noteDraft.trim(),
      });
      setNoteDraft("");
      await refreshTasksOnly(); // 添加记录：轻量级刷新
      setSelectedItemId(selectedItemId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "添加记录失败。");
    } finally {
      setNoteSubmitting(false);
    }
  };

  const handleQuickStatusUpdate = async (status: WorkArrangementStatus) => {
    if (!selectedItemId) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      await updateWorkArrangement(selectedItemId, { status });
      await refreshTasksOnly(); // 状态变更：轻量级刷新（不含 AI）
      setSelectedItemId(selectedItemId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '更新工作状态失败。');
    } finally {
      setSaving(false);
    }
  };

  const handleUnblock = async () => {
    if (!selectedItemId) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      await updateWorkArrangement(selectedItemId, { status: 'IN_PROGRESS' });
      await refreshTasksOnly();
      setSelectedItemId(selectedItemId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '恢复任务失败。');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedItemId) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      await updateWorkArrangement(selectedItemId, { status: 'CANCELLED' });
      await refreshTasksOnly();
      setSelectedItemId(selectedItemId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '取消任务失败。');
    } finally {
      setSaving(false);
    }
  };

  const handlePostponeReminder = async () => {
    if (!selectedItemId) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      await postponeWorkArrangementReminder(selectedItemId, {
        preset: 'PLUS_30_MINUTES',
      });
      await refreshTasksOnly(); // 延后提醒：轻量级刷新
      setSelectedItemId(selectedItemId);
      // 从活动提醒中移除
      setActiveReminders(prev => prev.filter(r => r.taskId !== selectedItemId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '延后提醒失败。');
    } finally {
      setSaving(false);
    }
  };

  const handleAddToCalendar = async (plannedItems: PlannedItem[]) => {
    setSaving(true);
    setErrorMessage(null);
    let createdCount = 0;
    try {
      for (const item of plannedItems) {
        const now = new Date();
        const startHour = 10 + Math.floor(createdCount * 0.5);
        const startMinute = (createdCount * 30) % 60;
        const blockStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          startHour,
          startMinute,
        );
        const blockEnd = new Date(
          blockStart.getTime() + item.estimatedMinutes * 60 * 1000,
        );
        await createWorkArrangement({
          title: `[待办] ${item.title}`,
          description: item.notificationId
            ? `关联通知: ${item.notificationId}`
            : undefined,
          type: 'FOLLOW_UP',
          urgency: 'HIGH',
          status: 'TODO',
          dueAt: blockEnd.toISOString(),
          reminderAt: blockStart.toISOString(),
          estimatedMinutes: item.estimatedMinutes,
          isAllDay: false,
          customTags: ['AI安排'],
          recurrence: 'NONE',
          projectManagementItemId: null,
          dependencyIds: [],
          completionSummary: null,
          reflectionSummary: null,
        });
        createdCount++;
      }
      const { toast } = await import('sonner');
      toast.success(`已添加 ${createdCount} 个事项到今日日程`);
      await loadWorkspace(false, true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '添加日程失败。');
    } finally {
      setSaving(false);
    }
  };

  // 处理提醒 Banner 的操作
  const handleReminderView = (taskId: string) => {
    handleSelectTask(taskId);
    setActiveReminders(prev => prev.filter(r => r.taskId !== taskId));
  };

  const handleReminderPostpone = async (taskId: string) => {
    setSaving(true);
    setErrorMessage(null);
    try {
      await postponeWorkArrangementReminder(taskId, {
        preset: 'PLUS_30_MINUTES',
      });
      await refreshTasksOnly();
      setActiveReminders(prev => prev.filter(r => r.taskId !== taskId));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '延后提醒失败。');
    } finally {
      setSaving(false);
    }
  };

  const handleReminderDismiss = () => {
    setActiveReminders([]);
  };

  const loadReminderSubset = async (
    reminderState: 'UPCOMING' | 'DUE_NOW' | 'OVERDUE',
  ) => {
    try {
      const subset = await fetchWorkArrangements({
        ...buildQuery(),
        reminderState,
      });
      setHighlightedTaskIds(subset.map((item) => item.id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '加载提醒任务失败。');
    }
  };

  return (
    <>
      {/* 提醒 Banner */}
      <ReminderBanner
        reminders={activeReminders}
        onDismiss={handleReminderDismiss}
        onView={handleReminderView}
        onPostpone={handleReminderPostpone}
      />

      <div className="flex flex-col gap-4">
        {/* 顶部概览 */}
        <WorkbenchOverview
          currentUser={currentUser}
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
          {/* 左列占位 */}
          <div className="w-[calc(40%-0.5rem)] shrink-0 hidden xl:block" aria-hidden />
          {/* 左列 absolute — 高度严格等于右列 */}
          <div className="absolute left-0 top-0 bottom-0 w-[calc(40%-0.5rem)] hidden xl:block">
            <SchedulePanel selectedDate={selectedDate} items={allItems} tasksForSelectedDate={tasksForSelectedDate} unscheduledItems={unscheduledItems} selectedItemId={selectedItemId} highlightedTaskIds={highlightedTaskIds} onDateSelect={setSelectedDate} onSelectTask={handleSelectTask} onCreateNew={handleCreateNew}/>
          </div>
          {/* 移动端左列全宽 */}
          <div className="w-full xl:hidden">
            <SchedulePanel selectedDate={selectedDate} items={allItems} tasksForSelectedDate={tasksForSelectedDate} unscheduledItems={unscheduledItems} selectedItemId={selectedItemId} highlightedTaskIds={highlightedTaskIds} onDateSelect={setSelectedDate} onSelectTask={handleSelectTask} onCreateNew={handleCreateNew}/>
          </div>
          {/* 右列 — 自然高度 */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <TaskNotificationCenter
              dailyPlan={dailyPlan}
              refreshingPlan={refreshingPlan}
              onRefreshPlan={() => void loadDailyPlan()}
              onAddToCalendar={handleAddToCalendar}
              onShowHistory={() => setShowHistoryDrawer(true)}
            />
          </div>
        </div>

        {errorMessage ? (
          <div className="flex items-center justify-between px-4 py-3 text-sm text-[color:var(--danger)]">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage("")}
              className="ml-2 shrink-0 text-[color:var(--danger)] opacity-60 hover:opacity-100"
            >
              关闭
            </button>
          </div>
        ) : null}
      </div>

      {/* Modal - rendered at root level to avoid CSS containment issues */}
      <WorkTaskEditorDrawer
        open={showFullEditor || creating}
        creating={creating}
        saving={saving}
        selectedItemTitle={selectedItem?.title ?? null}
        editor={editor}
        projects={projects}
        availableDependencies={availableDependencies}
        onClose={() => {
          setShowFullEditor(false);
          if (creating && lastSelectedIdRef.current) {
            setSelectedItemId(lastSelectedIdRef.current);
          }
          setCreating(false);
        }}
        onSave={() => void handleSave()}
        onDelete={() => void handleDelete()}
        onChange={setEditor}
      />

      {/* 任务详情弹窗 */}
      <TaskDetailModal
        open={showTaskModal}
        item={selectedItem}
        reminderState={selectedReminderState}
        noteType={noteType}
        noteDraft={noteDraft}
        noteSubmitting={noteSubmitting}
        onClose={() => {
          setShowTaskModal(false);
          refreshTasksOnly(true);
        }}
        onStart={() => void handleQuickStatusUpdate('IN_PROGRESS')}
        onComplete={() => void handleQuickStatusUpdate('COMPLETED')}
        onBlock={() => void handleQuickStatusUpdate('BLOCKED')}
        onUnblock={() => void handleUnblock()}
        onCancel={() => void handleCancel()}
        onPostponeReminder={() => void handlePostponeReminder()}
        onOpenFullEditor={() => {
          setShowTaskModal(false);
          setShowFullEditor(true);
        }}
        onNoteTypeChange={setNoteType}
        onNoteDraftChange={setNoteDraft}
        onSubmitNote={() => void handleAddNote()}
      />

      {/* 历史记录抽屉 */}
      <HistoryDrawer
        open={showHistoryDrawer}
        items={allItems}
        onClose={() => setShowHistoryDrawer(false)}
        onSelectTask={(taskId) => {
          handleSelectTask(taskId);
        }}
      />
    </>
  );
}
