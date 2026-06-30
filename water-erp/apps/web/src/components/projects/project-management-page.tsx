"use client";

import { Recycle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  deleteProjectPermanently,
  fetchProjectManagementList,
  moveProjectToRecycleBin,
  restoreProjectFromRecycleBin,
} from '@/lib/api/project-management';
import type { AuthUser } from '@/lib/api/auth';
import { fetchCurrentUser } from '@/lib/api/auth';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { CreateProjectDialog } from './create-project-dialog';
import { ProjectCard } from './project-card';
import { ProjectDetailPanel } from './project-detail-panel';
import { RecycleBinDrawer } from './recycle-bin-drawer';
import { useAssistant } from "@/components/assistant/assistant-provider";

export function ProjectManagementPage() {
  const [items, setItems] = useState<ProjectManagementItem[]>([]);
  const [recycledItems, setRecycledItems] = useState<ProjectManagementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [drawerErrorMessage, setDrawerErrorMessage] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const detailHostRef = useRef<HTMLDivElement | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const { setPageContext } = useAssistant();
  const [recycleActionId, setRecycleActionId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const loadItems = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [activeItems, recycled] = await Promise.all([
        fetchProjectManagementList('ACTIVE'),
        fetchProjectManagementList('RECYCLED'),
      ]);
      setItems(activeItems);
      setRecycledItems(recycled);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '加载项目失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
    fetchCurrentUser().then(setCurrentUser).catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!selectedItemId) {
      return;
    }

    const scrollContainer = detailHostRef.current?.closest('[data-app-shell-scroll="true"]');
    if (scrollContainer instanceof HTMLElement) {
      scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [selectedItemId]);

  const filteredItems = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) {
      return items;
    }

    return items.filter((item) =>
      [item.title, item.requesterName, item.requesterDepartment]
        .join(' ')
        .toLowerCase()
        .includes(normalized),
    );
  }, [items, keyword]);

  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;

  /** Whether the current user is allowed to modify (recycle/restore/delete) a given project */
  const canModifyProject = (project: { createdById?: string | null }) => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return project.createdById === currentUser.id;
  };

  const handleMoveToRecycleBin = async (projectId: string) => {
    setErrorMessage(null);
    try {
      await moveProjectToRecycleBin(projectId);
      if (selectedItemId === projectId) {
        setSelectedItemId(null);
      }
      await loadItems();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '移至回收站失败。');
    }
  };

  const handleRestore = async (projectId: string) => {
    setRecycleActionId(projectId);
    setDrawerErrorMessage(null);
    try {
      await restoreProjectFromRecycleBin(projectId);
      await loadItems();
    } catch (error) {
      setDrawerErrorMessage(error instanceof Error ? error.message : '恢复项目失败。');
    } finally {
      setRecycleActionId(null);
    }
  };

  const handleDeletePermanently = async (projectId: string) => {
    setRecycleActionId(projectId);
    setDrawerErrorMessage(null);
    try {
      await deleteProjectPermanently(projectId);
      await loadItems();
    } catch (error) {
      setDrawerErrorMessage(error instanceof Error ? error.message : '彻底删除失败。');
    } finally {
      setRecycleActionId(null);
    }
  };

  const handleDeleteAllPermanently = async () => {
    if (recycledItems.length === 0) return;

    setRecycleActionId('__all__');
    setDrawerErrorMessage(null);
    try {
      await Promise.all(recycledItems.map((item) => deleteProjectPermanently(item.id)));
      await loadItems();
    } catch (error) {
      setDrawerErrorMessage(error instanceof Error ? error.message : '一键删除失败。');
      throw error;
    } finally {
      setRecycleActionId(null);
    }
  };

  return (
    <>
      <div className="relative min-h-full">
        <div className="space-y-4">
          <div className="rounded-[24px] border border-white/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(245,249,255,0.78))] px-5 py-4 shadow-[0_20px_42px_rgba(59,89,143,0.08)]">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-1 flex-col gap-3 sm:flex-row">
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="按项目名 / 申请人 / 部门搜索"
                  className="w-full rounded-[18px] border border-white/62 bg-white/78 px-4 py-3 text-sm text-[color:var(--foreground)] outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setShowRecycleBin(true)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/72 bg-white/82 px-4 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-white"
                >
                  <Recycle size={16} />
                  回收站
                  {recycledItems.length ? (
                    <span className="rounded-full bg-[rgba(234,191,106,0.16)] px-2 py-0.5 text-[11px] text-[color:var(--warning)]">
                      {recycledItems.length}
                    </span>
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateDialog(true)}
                  className="password-dialog__button password-dialog__button--primary"
                >
                  新建项目
                </button>
              </div>
            </div>
          </div>

          {errorMessage ? (
            <div className="rounded-[20px] border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-4 py-3 text-sm text-[color:var(--danger)]">
              {errorMessage}
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-[24px] border border-white/60 bg-white/70 px-6 py-10 text-sm text-[color:var(--muted-foreground)]">
              正在加载项目...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="rounded-[24px] border border-white/60 bg-white/70 px-6 py-10 text-sm text-[color:var(--muted-foreground)]">
              当前没有进行中的项目。
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {filteredItems.map((item) => (
                <ProjectCard
                  key={item.id}
                  item={item}
                  onOpen={() => {
                    setSelectedItemId(item.id);
                    setPageContext({
                      selectedItemId: item.id,
                      selectedItemType: "project",
                      selectedItemData: {
                        title: item.title,
                        currentStage: item.currentStage,
                        status: item.status,
                        requesterDepartment: item.requesterDepartment,
                      },
                    });
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div
          ref={detailHostRef}
          className={selectedItem ? 'absolute inset-0 z-[70]' : 'hidden'}
        />
      </div>

      {portalReady && selectedItem && detailHostRef.current
        ? createPortal(
            <ProjectDetailPanel
              item={selectedItem}
              onClose={() => {
                setSelectedItemId(null);
                setPageContext({ selectedItemId: undefined, selectedItemType: undefined, selectedItemData: undefined });
              }}
              onUpdated={() => loadItems()}
              onMoveToRecycleBin={handleMoveToRecycleBin}
              canModify={canModifyProject(selectedItem)}
              currentUsername={currentUser?.username}
            />,
            detailHostRef.current,
          )
        : null}

      <CreateProjectDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={(newItemId) => {
          void loadItems().then(() => {
            setSelectedItemId(newItemId);
          });
        }}
      />

      <RecycleBinDrawer
        isOpen={showRecycleBin}
        items={recycledItems}
        submittingId={recycleActionId}
        errorMessage={drawerErrorMessage}
        canModify={canModifyProject}
        onClose={() => {
          setShowRecycleBin(false);
          setDrawerErrorMessage(null);
        }}
        onRestore={handleRestore}
        onDelete={handleDeletePermanently}
        onDeleteAll={handleDeleteAllPermanently}
        onDismissError={() => setDrawerErrorMessage(null)}
      />
    </>
  );
}
