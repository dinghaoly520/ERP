"use client";

import { AlertCircle, Ban, CheckCircle2, ClipboardCopy, FolderOpen, Plus, Recycle, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  deleteProjectPermanently,
  fetchProjectManagementList,
  moveProjectToRecycleBin,
  restoreProjectFromRecycleBin,
  terminateProject,
} from '@/lib/api/project-management';
import type { AuthUser } from '@/lib/api/auth';
import { fetchCurrentUser } from '@/lib/api/auth';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { CreateProjectDialog } from './create-project-dialog';
import { ProjectCard } from './project-card';
import { ProjectDetailPanel } from './project-detail-panel';
import { RecycleBinDrawer } from './recycle-bin-drawer';
import { useAssistant } from "@/components/assistant/assistant-provider";
import { CompanySelect, readInitialCompanyId } from "@/components/company/company-select";
import { CompanySectionHeader, buildCompanyCounts, useCompanyName } from "@/components/company/company-tag";

export function ProjectManagementPage() {
  const [items, setItems] = useState<ProjectManagementItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<ProjectManagementItem[]>([]);
  const [terminatedItems, setTerminatedItems] = useState<ProjectManagementItem[]>([]);
  const [recycledItems, setRecycledItems] = useState<ProjectManagementItem[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'archived' | 'terminated'>('active');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [drawerErrorMessage, setDrawerErrorMessage] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt' | 'budgetAmount' | 'title'>('updatedAt');
  // 级联筛选：filterType 选维度，filterValue 选值
  const [filterType, setFilterType] = useState<'method' | 'department' | 'operator'>('method');
  const [filterValue, setFilterValue] = useState<string>('');
  const [portalReady, setPortalReady] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const { setPageContext } = useAssistant();
  const [recycleActionId, setRecycleActionId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [autoBidConfirm, setAutoBidConfirm] = useState(false);
  // admin 公司视图（公司级数据隔离）：右上选择器（URL ?companyId= + localStorage 记忆）；
  // 全部=按公司分组展示（CompanySectionHeader 主标题 + 组内条目），单公司=该公司标题
  const [companyId, setCompanyId] = useState('all');

  const loadItems = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [activeItems, archived, terminated, recycled] = await Promise.all([
        fetchProjectManagementList('ACTIVE', companyId),
        fetchProjectManagementList('ARCHIVED', companyId),
        fetchProjectManagementList('TERMINATED', companyId),
        fetchProjectManagementList('RECYCLED', companyId),
      ]);
      setItems(activeItems);
      setArchivedItems(archived);
      setTerminatedItems(terminated);
      setRecycledItems(recycled);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '加载项目失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const initial = readInitialCompanyId();
    if (initial !== 'all') setCompanyId(initial);
    fetchCurrentUser().then(setCurrentUser).catch(() => {/* ignore */});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // 深链：?projectId= 来自工作台招标类任务通知（种子/运行时通知 link 带 projectId），
  // 列表就绪后自动打开该项目详情面板，使"通知所指项目"与"点进去看到的"一致。
  // 在 effect 内读 window.location.search（仅客户端执行），避免 useSearchParams 的 Suspense 约束。
  useEffect(() => {
    if (loading) return;
    const pid = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('projectId') : null;
    if (!pid) return;
    // 三态集合查找：台账「项目详情」可从已归档/已终止项目深链进来，不能只查进行中
    const target = items.find((i) => i.id === pid)
      ?? archivedItems.find((i) => i.id === pid)
      ?? terminatedItems.find((i) => i.id === pid);
    if (target) {
      setSelectedItemId(target.id);
      setAutoBidConfirm(new URLSearchParams(window.location.search).get('panel') === 'bid-confirm');
      setPageContext({
        selectedItemId: target.id,
        selectedItemType: 'project',
        selectedItemData: {
          title: target.title,
          currentStage: target.currentStage,
          status: target.status,
          requesterDepartment: target.requesterDepartment,
        },
      });
    }
  }, [loading, items, archivedItems, terminatedItems]);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    const scrollContainer = document.querySelector('[data-app-shell-scroll="true"]');
    if (!(scrollContainer instanceof HTMLElement)) return;

    if (selectedItemId) {
      scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
      scrollContainer.style.overflowY = 'hidden';
    } else {
      scrollContainer.style.overflowY = '';
    }
    return () => { scrollContainer.style.overflowY = ''; };
  }, [selectedItemId]);

  // Derived: unique departments + methods for filter dropdowns
  const departments = useMemo(() => {
    const set = new Set(items.map(i => i.requesterDepartment).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  const methods = useMemo(() => {
    const set = new Set(items.map(i => i.procurementMethod).filter(Boolean));
    return Array.from(set).sort();
  }, [items]);

  // 当前 tab 的数据源（active/archived/terminated）
  const sourceItems = activeTab === 'archived' ? archivedItems : activeTab === 'terminated' ? terminatedItems : items;

  const operators = useMemo(() => {
    const source = sourceItems;
    const set = new Set(source.map(i => i.createdByName).filter(Boolean));
    return Array.from(set).sort();
  }, [sourceItems]);

  // 级联筛选：根据选中的维度提供可选项
  const filterOptions = useMemo(() => {
    const source = sourceItems;
    if (filterType === 'method') return Array.from(new Set(source.map(i => i.procurementMethod).filter(Boolean))).sort();
    if (filterType === 'department') return Array.from(new Set(source.map(i => i.requesterDepartment).filter(Boolean))).sort();
    return Array.from(new Set(source.map(i => i.createdByName).filter(Boolean))).sort();
  }, [filterType, sourceItems]);

  const filteredItems = useMemo(() => {
    const source = sourceItems;
    let result = [...source];

    // Text search
    const normalized = keyword.trim().toLowerCase();
    if (normalized) {
      result = result.filter((item) =>
        [item.title, item.requesterName, item.requesterDepartment, item.projectCode ?? '', item.contractNumber ?? '']
          .join(' ')
          .toLowerCase()
          .includes(normalized),
      );
    }

    // 级联筛选
    if (filterValue) {
      if (filterType === 'method') result = result.filter(i => i.procurementMethod === filterValue);
      else if (filterType === 'department') result = result.filter(i => i.requesterDepartment === filterValue);
      else if (filterType === 'operator') result = result.filter(i => i.createdByName === filterValue);
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'budgetAmount':
          return (b.budgetAmount ?? 0) - (a.budgetAmount ?? 0);
        case 'title':
          return (a.title ?? '').localeCompare(b.title ?? '', 'zh-CN');
        case 'createdAt':
          return new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime();
        case 'updatedAt':
        default:
          return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
      }
    });

    return result;
  }, [activeTab, sourceItems, keyword, sortBy, filterType, filterValue]);

  // admin 全部公司视图：按公司分组（计数降序、未归属沉底）；单公司视图用选择器公司名
  const companyViewAll = currentUser?.role === 'admin' && companyId === 'all';
  const selectedCompanyName = useCompanyName(companyId);
  const companyGroups = useMemo(() => {
    if (!companyViewAll) return [];
    return buildCompanyCounts(filteredItems.map((i) => ({ company: i.companyName }))).map((g) => ({
      ...g,
      items: filteredItems.filter((i) => ((i.companyName ?? '').trim() || '未归属') === g.name),
    }));
  }, [companyViewAll, filteredItems]);
  const displayItems = filteredItems;

  // 已完成（归档）/已终止项目同样可打开详情（只读）——selectedItem 须在三个集合中查找
  const selectedItem = items.find((item) => item.id === selectedItemId)
    ?? archivedItems.find((item) => item.id === selectedItemId)
    ?? terminatedItems.find((item) => item.id === selectedItemId)
    ?? null;

  /** Whether the current user is allowed to modify (recycle/restore/delete) a given project */
  const canModifyProject = (project: { createdById?: string | null }) => {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    if (project.createdById === currentUser.id) return true;
    return false;
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

  const handleTerminate = async (projectId: string, reason: string, notify: 'none' | 'accepted' | 'all') => {
    setErrorMessage(null);
    const result = await terminateProject(projectId, reason, notify);
    if (result?.notifiedCount) {
      toast.success(`项目已终止，已通知 ${result.notifiedCount} 家供应商`);
    }
    if (selectedItemId === projectId) {
      setSelectedItemId(null);
    }
    await loadItems();
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
                <CompanySelect value={companyId} onChange={setCompanyId} />
                {/* 归档记录入口已收敛至「采购台账」（2026-09-02 拍板）；/archive 页保留供归档待办通知直达 */}
                <button
                  type="button"
                  onClick={() => setShowRecycleBin(true)}
                  className="neu-btn-soft is-danger"
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
                  className="neu-btn-soft"
                >
                  <Plus size={16} />
                  新建项目
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
              <div className="relative w-[280px] shrink-0">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted-foreground)] z-10" />
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="按项目名 / 申请人 / 部门搜索"
                  className="neu-input neu-input-sm !pl-9"
                />
                {keyword && (
                  <button onClick={() => setKeyword('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[rgba(96,139,239,0.1)] text-[color:var(--muted-foreground)] z-10">
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div className="neu-segment" role="group" aria-label="项目状态" data-count="3" data-index={activeTab === 'active' ? '0' : activeTab === 'archived' ? '1' : '2'}>
                  <span className="neu-segment-thumb" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => setActiveTab('active')}
                    className="neu-segment-btn"
                    aria-pressed={activeTab === 'active'}
                  >
                    进行中
                    {items.length > 0 && <span className="neu-segment-count">{items.length}</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('archived')}
                    className="neu-segment-btn"
                    aria-pressed={activeTab === 'archived'}
                  >
                    <CheckCircle2 size={13} className="inline mr-1" />
                    已完成
                    {archivedItems.length > 0 && <span className="neu-segment-count">{archivedItems.length}</span>}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('terminated')}
                    className="neu-segment-btn"
                    aria-pressed={activeTab === 'terminated'}
                  >
                    <Ban size={13} className="inline mr-1" />
                    已终止
                    {terminatedItems.length > 0 && <span className="neu-segment-count">{terminatedItems.length}</span>}
                  </button>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">排序</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                  className="workbench-input workbench-input-sm !w-auto min-w-[110px]"
                >
                  <option value="updatedAt">最近更新</option>
                  <option value="createdAt">最近创建</option>
                  <option value="budgetAmount">预算金额</option>
                  <option value="title">项目名称</option>
                </select>
                <span className="ml-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">筛选</span>
                <select
                  value={filterType}
                  onChange={(e) => { setFilterType(e.target.value as typeof filterType); setFilterValue(''); }}
                  className="workbench-input workbench-input-sm !w-auto min-w-[100px]"
                >
                  <option value="method">采购方式</option>
                  <option value="department">申请部门</option>
                  <option value="operator">经办人</option>
                </select>
                <select
                  value={filterValue}
                  onChange={(e) => setFilterValue(e.target.value)}
                  className="workbench-input workbench-input-sm !w-auto min-w-[130px]"
                >
                  <option value="">全部</option>
                  {filterOptions.map((v) => <option key={v} value={v ?? ''}>{v}</option>)}
                </select>
              </div>
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
          ) : null}
          {companyViewAll ? (
            <div className="space-y-5">
              {companyGroups.map((g) => (
                <section key={g.name}>
                  <CompanySectionHeader name={g.name} count={g.items.length} />
                  <div className="mt-3 grid gap-4 xl:grid-cols-2">
                    {g.items.map((item) => (
                      <ProjectCard
                        key={item.id}
                        item={item}
                        variant={activeTab === 'archived' ? 'archived' : activeTab === 'terminated' ? 'terminated' : 'active'}
                        onOpen={() => {
                          setSelectedItemId(item.id);
                          setPageContext({
                            selectedItemId: item.id,
                            selectedItemType: 'project',
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
                </section>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {currentUser?.role === 'admin' && selectedCompanyName && (
                <CompanySectionHeader name={selectedCompanyName} count={filteredItems.length} />
              )}
              {displayItems.length === 0 ? (
            <div className="wb-panel p-10 flex items-center justify-center">
              <span className="text-sm text-[color:var(--muted-foreground)]">{activeTab === 'active' ? '当前没有进行中的项目。' : activeTab === 'terminated' ? '当前没有已终止的项目。' : '当前没有已完成的项目。'}</span>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {displayItems.map((item) => (
                <ProjectCard
                  key={item.id}
                  item={item}
                  variant={activeTab === 'archived' ? 'archived' : activeTab === 'terminated' ? 'terminated' : 'active'}
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
          )}
        </div>

      </div>

      {portalReady && selectedItem
        ? createPortal(
            <ProjectDetailPanel
              item={selectedItem}
              onClose={() => {
                setSelectedItemId(null);
                setPageContext({ selectedItemId: undefined, selectedItemType: undefined, selectedItemData: undefined });
                setAutoBidConfirm(false);
              }}
              onUpdated={() => loadItems()}
              onMoveToRecycleBin={handleMoveToRecycleBin}
              onTerminate={handleTerminate}
              canModify={canModifyProject(selectedItem)}
              currentUsername={currentUser?.username}
              currentUserRole={currentUser?.role}
              autoOpenBidConfirm={autoBidConfirm}
            />,
            document.getElementById('app-main') || document.body,
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

      {/* 浮动新建按钮 */}
      <button
        type="button"
        onClick={() => setShowCreateDialog(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-110 hover:shadow-xl active:scale-95"
        style={{
          background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))',
          boxShadow: '0 4px 16px oklch(0.4 0.1 258 / 0.3), 0 0 0 1px oklch(1 0 0 / 0.2)',
        }}
        title="新建项目"
      >
        <Plus size={24} className="text-white" />
      </button>
    </>
  );
}
