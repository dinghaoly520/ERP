"use client";

import { AlertCircle, FolderOpen, Recycle } from 'lucide-react';
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
          {/* Page Hero: title + search + actions */}
          <div className="page-hero">
            <div className="page-hero__row">
              <div className="page-hero__left">
                <div className="page-hero__icon">
                  <FolderOpen size={17} />
                </div>
                <div>
                  <div className="page-hero__title">项目管理</div>
                  <div className="page-hero__sub">项目全生命周期管理与追踪</div>
                </div>
              </div>
              <div className="page-hero__right">
                <span className="page-hero__stat page-hero__stat--info">
                  共 {items.length} 项
                </span>
                <button
                  type="button"
                  onClick={() => setShowRecycleBin(true)}
                  className="neu-btn-soft"
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
                  className="neu-btn-primary"
                >
                  新建项目
                </button>
              </div>
            </div>
            <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "0.5rem" }}>
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="按项目名 / 申请人 / 部门搜索"
                className="neu-input max-w-[480px]"
              />
            </div>
          </div>

          {errorMessage ? (
            <div className="wb-panel p-4" style={{ border: "1px solid color-mix(in oklch, var(--danger) 22%, transparent)" }}>
              <div className="flex items-center gap-2.5 text-sm text-[color:var(--danger)]">
                <AlertCircle size={16} />
                {errorMessage}
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="wb-panel p-6 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-[rgba(96,139,239,0.3)] border-t-[rgba(96,139,239,1)]" />
                <span className="text-sm text-[color:var(--muted-foreground)]">正在加载项目...</span>
              </div>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="wb-panel p-10 flex items-center justify-center">
              <span className="text-sm text-[color:var(--muted-foreground)]">当前没有进行中的项目。</span>
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
