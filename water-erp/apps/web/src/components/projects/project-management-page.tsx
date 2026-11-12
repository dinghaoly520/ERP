"use client";

import { AlertCircle, AlertTriangle, Ban, CheckCircle2, ClipboardCopy, FileX2, FolderOpen, Loader2, Plus, Search, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  deleteProjectPermanently,
  fetchDeletionRecords,
  fetchProjectManagementList,
  terminateProject,
} from '@/lib/api/project-management';
import type { AuthUser } from '@/lib/api/auth';
import { fetchCurrentUser } from '@/lib/api/auth';
import type { ProjectDeletionRecord, ProjectManagementItem } from '@/lib/types/project-management';
import { CreateProjectDialog } from './create-project-dialog';
import { ProjectCard } from './project-card';
import { ProjectDetailPanel } from './project-detail-panel';
import { DeletionRecordList } from './deletion-record-list';
import { useAssistant } from "@/components/assistant/assistant-provider";
import { isGroupedCompanyView, CompanySelect, readInitialCompanyId } from "@/components/company/company-select";
import { CompanySectionHeader, buildCompanyCounts, useCompanyName } from "@/components/company/company-tag";

export function ProjectManagementPage() {
  const [items, setItems] = useState<ProjectManagementItem[]>([]);
  const [archivedItems, setArchivedItems] = useState<ProjectManagementItem[]>([]);
  const [terminatedItems, setTerminatedItems] = useState<ProjectManagementItem[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'archived' | 'terminated'>('active');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  // 已终止区（spec 2026-11-12 §9 二次收口）：移除记录弹层 + 卡片移除确认
  const [deletionRecords, setDeletionRecords] = useState<ProjectDeletionRecord[]>([]);
  const [cleanupTarget, setCleanupTarget] = useState<ProjectManagementItem | null>(null);
  const [showRecordsModal, setShowRecordsModal] = useState(false);
  const [sortBy, setSortBy] = useState<'createdAt' | 'updatedAt' | 'budgetAmount' | 'title'>('updatedAt');
  // 级联筛选：filterType 选维度，filterValue 选值
  const [filterType, setFilterType] = useState<'method' | 'department' | 'operator'>('method');
  const [filterValue, setFilterValue] = useState<string>('');
  const [portalReady, setPortalReady] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const { setPageContext } = useAssistant();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [autoBidConfirm, setAutoBidConfirm] = useState(false);
  // admin 公司视图（公司级数据隔离）：右上选择器（URL ?companyId= + localStorage 记忆）；
  // 全部=按公司分组展示（CompanySectionHeader 主标题 + 组内条目），单公司=该公司标题
  const [companyId, setCompanyId] = useState('all');

  const loadItems = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [activeItems, archived, terminated, records] = await Promise.all([
        fetchProjectManagementList('ACTIVE', companyId),
        fetchProjectManagementList('ARCHIVED', companyId),
        fetchProjectManagementList('TERMINATED', companyId),
        fetchDeletionRecords(companyId),
      ]);
      setItems(activeItems);
      setArchivedItems(archived);
      setTerminatedItems(terminated);
      setDeletionRecords(records);
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

  // 详情面板是 #app-main 内 absolute inset-0 的覆盖层：开面板须把滚动容器归零
  //（否则面板从视口外开始）；关面板要回到开之前的列表位置——先存 scrollTop 再清零，
  // 关闭时还原。ref 存且仅在「未保存」时写入，防 id→id 直切详情时把原位置覆盖成 0。
  const savedScrollTopRef = useRef<number | null>(null);
  useEffect(() => {
    const scrollContainer = document.querySelector('[data-app-shell-scroll="true"]');
    if (!(scrollContainer instanceof HTMLElement)) return;

    if (selectedItemId) {
      if (savedScrollTopRef.current === null) {
        savedScrollTopRef.current = scrollContainer.scrollTop;
      }
      scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
      scrollContainer.style.overflowY = 'hidden';
    } else {
      scrollContainer.style.overflowY = '';
      if (savedScrollTopRef.current !== null) {
        scrollContainer.scrollTop = savedScrollTopRef.current;
        savedScrollTopRef.current = null;
      }
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

  // 移除记录（仅关键词过滤，deletedAt 倒序由后端定）
  const filteredRecords = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return deletionRecords;
    return deletionRecords.filter((r) =>
      [r.title, r.requesterName, r.requesterDepartment, r.projectCode ?? ''].join(' ').toLowerCase().includes(normalized),
    );
  }, [deletionRecords, keyword]);

  // admin 全部公司视图：按公司分组（计数降序、未归属沉底）；单公司视图用选择器公司名
  const companyViewAll = currentUser?.role === 'admin' && isGroupedCompanyView(companyId);
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

  /** 是否可管理（修改/终止/移除）：仅项目创建人（2026-10-10 读写分级）。
   *  leader 本公司 / admin 全量为只读视野——列表可见但操作按钮不渲染（后端 PmiOwnershipGuard 同口径硬闸）。 */
  const canModifyProject = (project: { createdById?: string | null }) => {
    if (!currentUser) return false;
    return project.createdById === currentUser.id;
  };

  const handleTerminate = async (projectId: string, reason: string, notify: 'none' | 'accepted') => {
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

  // 项目移除（spec 2026-11-12 §9 裁定 #4）：已终止卡片「移除」→ 立即彻底删除 + 移除记录
  const handleRemoveProject = async (projectId: string) => {
    setRemovingId(projectId);
    setErrorMessage(null);
    try {
      await deleteProjectPermanently(projectId);
      await loadItems();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '移除项目失败。');
    } finally {
      setRemovingId(null);
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
                  <div className="page-hero__sub">管理采购项目从立项到归档的全过程</div>
                </div>
              </div>
              <div className="page-hero__right">
                {/* 计数口径=本公司进行中项目数（2026-11-10 用户裁定：项目管理页误落默认
                    账号口径显示「办公/专家」）；零项目公司随 CompanySelect 过滤不进下拉 */}
                <CompanySelect value={companyId} onChange={setCompanyId} countMode="projectsActive" />
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
            {/* hairline 下横线（cgzxui 规定：标题行与下方内容之间必有分割线） */}
            <div className="page-hero__divider" />
          </div>

          {/* 搜索 + 状态/排序/筛选行——独立工具行（2026-11-06 用户裁定移出标题栏，与采购台账/通知中心同款设计） */}
          <div className="flex flex-wrap items-center gap-3">
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
          ) : displayItems.length === 0 ? (
            <div className="wb-panel p-4">
              <div className="flex flex-col items-center justify-center py-12">
                <div className="text-[0.9rem] font-semibold text-[rgba(96,139,239,0.4)]">暂无项目</div>
              </div>
            </div>
          ) : activeTab === 'terminated' ? (
            /* 已终止区（spec 2026-11-12 §9 终版）：单一数据=终止的项目；卡片可开只读详情；
               创建人可「移除」=立即彻底删除+移除记录；节头右侧「移除记录」按钮弹层 */
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-bold tracking-[0.02em] text-[color:var(--foreground)]">已终止项目</h3>
                  <span className="neu-segment-count">{displayItems.length}</span>
                  <span className="text-xs text-[color:var(--muted-foreground)]">业务结局留痕，只读可查</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRecordsModal(true)}
                  className="neu-btn-soft !h-8 !text-xs"
                >
                  <FileX2 size={14} />
                  移除记录{deletionRecords.length > 0 ? `（${deletionRecords.length}）` : ''}
                </button>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                {displayItems.map((item) => (
                  <ProjectCard
                    key={item.id}
                    item={item}
                    variant="terminated"
                    cornerAction={
                      canModifyProject(item) ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCleanupTarget(item);
                          }}
                          disabled={removingId === item.id}
                          className="neu-btn-soft is-danger !h-7 !px-2.5 !text-[11px]"
                        >
                          {removingId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          {removingId === item.id ? '移除中...' : '移除'}
                        </button>
                      ) : undefined
                    }
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
          ) : companyViewAll ? (
            <div className="space-y-5">
              {companyGroups.map((g) => (
                <section key={g.name}>
                  <CompanySectionHeader name={g.name} count={g.items.length} />
                  <div className="mt-3 grid gap-4 xl:grid-cols-2">
                    {g.items.map((item) => (
                      <ProjectCard
                        key={item.id}
                        item={item}
                        variant={activeTab === 'archived' ? 'archived' : 'active'}
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
              <div className="grid gap-4 xl:grid-cols-2">
                {displayItems.map((item) => (
                  <ProjectCard
                    key={item.id}
                    item={item}
                    variant={activeTab === 'archived' ? 'archived' : 'active'}
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

      {/* 已终止卡「移除」确认（spec §9 裁定 #4：立即彻底删除+移除记录，弹窗规范 A 版） */}
      {cleanupTarget ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-md"
            onClick={() => {
              if (!removingId) setCleanupTarget(null);
            }}
          />
          <div className="relative w-full max-w-[600px] overflow-hidden wb-modal-shell">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,rgba(209,88,88,0.95),rgba(234,191,106,0.72),rgba(121,162,239,0.35))]" />
            <div className="px-6 py-6">
              <div className="flex items-start gap-4">
                <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-[18px] border border-[color-mix(in_oklch,var(--danger)_24%,transparent)] bg-[color-mix(in_oklch,var(--danger)_11%,transparent)] text-[color:var(--danger)]">
                  <AlertTriangle size={24} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="inline-flex rounded-full bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-[color:var(--danger)]">
                    不可恢复操作
                  </div>
                  <h3 className="mt-3 font-[family-name:var(--font-display)] text-[1.28rem] font-semibold tracking-[-0.05em] text-[color:var(--foreground)]">
                    移除「{cleanupTarget.title}」？
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--muted-foreground)]">
                    移除后项目内容将全部清除（附件、阶段资料、台账轮次），不可恢复；仅保留一条移除记录供追溯。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCleanupTarget(null)}
                  disabled={Boolean(removingId)}
                  className="neu-btn-xs"
                  aria-label="取消移除"
                >
                  <X size={17} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
              <button type="button" onClick={() => setCleanupTarget(null)} disabled={Boolean(removingId)} className="neu-btn-soft !h-9 !text-xs">
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = cleanupTarget;
                  setCleanupTarget(null);
                  if (target) void handleRemoveProject(target.id);
                }}
                disabled={Boolean(removingId)}
                className="neu-btn-soft is-danger !h-9 !text-xs"
              >
                <Trash2 size={16} />
                确认移除
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 移除记录弹层（spec §9：按钮入口，只读行——数据已清、记录永存） */}
      {showRecordsModal ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-md"
            onClick={() => setShowRecordsModal(false)}
          />
          <div className="relative flex h-[min(720px,calc(100dvh-3rem))] w-full max-w-[min(820px,92vw)] flex-col overflow-hidden wb-modal-shell">
            <div className="absolute inset-x-0 top-0 h-1.5 bg-[linear-gradient(90deg,rgba(209,88,88,0.6),rgba(234,191,106,0.45),rgba(121,162,239,0.3))]" />
            <div className="flex items-start justify-between gap-4 px-6 py-5" style={{ borderBottom: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
              <div className="min-w-0">
                <h3 className="font-[family-name:var(--font-display)] text-[1.28rem] font-semibold tracking-[-0.05em] text-[color:var(--foreground)]">
                  已移除的项目{deletionRecords.length > 0 ? `（${deletionRecords.length}）` : ''}
                </h3>
              </div>
              <button type="button" onClick={() => setShowRecordsModal(false)} className="neu-btn-xs" aria-label="关闭移除记录">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {deletionRecords.length === 0 ? (
                <div className="wb-panel flex items-center justify-center px-5 py-10 text-sm leading-6 text-[color:var(--muted-foreground)]">
                  暂无移除记录。在已终止项目卡片上点「移除」并确认后，会在此留下记录。
                </div>
              ) : (
                <DeletionRecordList records={filteredRecords} showHeader={false} />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* 浮动新建按钮（.fab-create：类化浅染底，替代旧内联蓝色渐变） */}
      <button
        type="button"
        onClick={() => setShowCreateDialog(true)}
        className="fab-create"
        title="新建项目"
        aria-label="新建项目"
      >
        <Plus size={24} strokeWidth={2} />
      </button>
    </>
  );
}
