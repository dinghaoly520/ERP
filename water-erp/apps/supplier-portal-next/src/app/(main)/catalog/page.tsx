"use client";

/**
 * 集中采购目录（脱敏浏览）— 移植自 Vue supplier-portal/src/views/catalog/CatalogList.vue
 * 脱敏规则：浏览接口仅返回品类信息（编码/名称/规格/分类/单位/区域），页面不渲染任何价格。
 * 操作列按供货状态流转：
 *  - 无准入且无进行中申请 → 「申请供货」（JOIN_EXISTING）
 *  - 已准入且无进行中申请 → 「改报价」（UPDATE_QUOTE）
 *  - 有进行中申请（PENDING/COUNTERED/RETURNED）→ 「审核中」标签
 *  - 其余（已准入）→ 「已准入」标签
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CircleX,
  LayoutGrid,
  Loader2,
  Search,
} from "lucide-react";;
import { SpButton, SpInput } from "@/components/ui";
import { SpPageHero } from "@/components/sp-page-hero";
import { catalogApi } from "@/lib/api/catalog";
import {
  ApplicationDialog,
  type CatalogApplication,
  type CatalogItem,
  type CatalogSupply,
  type CategoryNode,
  type DialogMode,
} from "@/components/catalog/application-dialog";
import "@/styles/pages/catalog.css";
import "@/styles/pages/shared.css"; // 卡片三件套/骨架屏基座（2026-09-02 去重抽出，跨页共用）

const IN_PROGRESS = ["PENDING", "COUNTERED", "RETURNED"];

export default function CatalogListPage() {
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState(false);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const [myApplications, setMyApplications] = useState<CatalogApplication[]>([]);
  const [mySupply, setMySupply] = useState<CatalogSupply[]>([]);
  // B4-4（2026-09-30）：默认组随 categoryTree 自适应——此前硬编码「工程材料」，组名调整或
  // 新部署无此组时首屏「暂无匹配」且侧栏无高亮，无法自愈
  const [selectedGroup, setSelectedGroup] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("JOIN_EXISTING");
  const [dialogItem, setDialogItem] = useState<CatalogItem | null>(null);

  async function loadAll() {
    setLoading(true); setError(false);
    try {
      const [tree, apps, supply] = await Promise.all([
        catalogApi.listCategories(), catalogApi.listApplications(), catalogApi.listSupply(),
      ]);
      setCategoryTree(tree as CategoryNode[]);
      setMyApplications(apps as CatalogApplication[]);
      setMySupply(supply as CatalogSupply[]);
      // 首次进入默认选首个分组（与侧栏高亮一致）；有查询串则不预设。
      // B4-4 加固：setSelectedGroup 是异步的，紧随 loadItems() 读的是旧闭包（""）会误拉
      // 「全部」而非首个分组——须把派生出的默认组显式传入，保证首屏列表与侧栏高亮一致
      const defaultGroup = selectedGroup === "" && Array.isArray(tree) && tree.length > 0 && !search ? tree[0].group : selectedGroup;
      setSelectedGroup(defaultGroup);
      await loadItems({ group: defaultGroup, category: "", search });
    } catch { setError(true); }
    finally { setLoading(false); setFirstLoad(false); }
  }

  // B4-4（2026-09-30）：竞态守卫 + 加载态——快速点组别/类别时旧结果晚归会覆盖新筛选，
  // 且此前无加载反馈（列表闪变）。序号守卫与通知/公告页同款。
  const loadSeqRef = useRef(0);
  const [itemsLoading, setItemsLoading] = useState(false);
  async function loadItems(ovr?: { group?: string; category?: string; search?: string }) {
    const seq = ++loadSeqRef.current;
    const group = ovr?.group ?? selectedGroup;
    const category = ovr?.category ?? selectedCategory;
    const q = ovr?.search ?? search;
    setItemsLoading(true);
    try {
      const list = await catalogApi.listItems({
        group: group || undefined,
        category: category || undefined,
        search: q.trim() || undefined,
      });
      if (seq !== loadSeqRef.current) return;
      setItems(list as CatalogItem[]);
    } catch {
      if (seq !== loadSeqRef.current) return;
      setError(true);
    } finally {
      if (seq === loadSeqRef.current) setItemsLoading(false);
    }
  }

  function retryLoad() { loadAll(); }
  function onSearch() { loadItems(); }

  function selectGroup(g: string) {
    const next = selectedGroup === g ? "" : g;
    setSelectedGroup(next); setSelectedCategory("");
    loadItems({ group: next, category: "", search });
  }
  function selectCategory(c: string) {
    const next = selectedCategory === c ? "" : c;
    setSelectedCategory(next);
    loadItems({ category: next, search });
  }
  function resetFilters() {
    setSelectedGroup(""); setSelectedCategory(""); setSearch("");
    loadItems({ group: "", category: "", search: "" });
  }

  function itemStatus(item: CatalogItem) {
    // 供货关系三态（2026-09-30 第二轮审计 B1-6）：listSupply 返回全部状态行，而后端
    // JOIN_EXISTING 对任何已存在供货行 400 ALREADY_SUPPLYING、UPDATE_QUOTE 仅 ACTIVE
    // 放行——非 ACTIVE 行既不能重新申请也不能改价，须显式提示「停用」，而非伪装成
    // 「已准入」（点改报价必 400）或放开申请入口（点申请同样 400）。
    const supply = mySupply.find((s) => s.catalogItemId === item.id);
    const active = supply?.status === "ACTIVE" ? supply : undefined;
    const inProgress = myApplications.find((a) => a.catalogItemId === item.id && IN_PROGRESS.includes(a.status));
    return {
      hasActiveSupply: !!active,
      supplySuspended: !!supply && !active,
      inProgress,
      canApplyJoin: !supply && !inProgress,
      canUpdateQuote: !!active && !inProgress,
    };
  }
  function openJoin(item: CatalogItem) { setDialogMode("JOIN_EXISTING"); setDialogItem(item); setDialogVisible(true); }
  function openUpdate(item: CatalogItem) { setDialogMode("UPDATE_QUOTE"); setDialogItem(item); setDialogVisible(true); }
  function openNewItem() { setDialogMode("NEW_ITEM"); setDialogItem(null); setDialogVisible(true); }

  useEffect(() => { loadAll(); }, []);

  return (
    <div className="page-container cat-page-root">
      {loading && firstLoad ? (
        <div className="skel-wrap">
          <div className="skel-hero">
            <span className="sp-skel h-[13px] w-[120px]" />
            <span className="sp-skel mt-3 h-6 w-[240px]" />
            <span className="sp-skel mt-2.5 h-3.5 w-[360px]" />
          </div>
          <div className="skel-cat">
            <div className="skel-sidebar">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="sp-skel mb-1 h-8 w-full" />
              ))}
            </div>
            <div className="skel-main">
              <span className="sp-skel mb-3 h-9 w-full" />
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="sp-skel mb-1 h-10 w-full" />
              ))}
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="sp-error-block">
          <div className="sp-error-icon"><AlertTriangle size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">数据加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton variant="primary" onClick={retryLoad}>重新加载</SpButton>
        </div>
      ) : (
        <div className="cat-loading-host">
          {loading && (
            <div className="cat-loading-mask"><Loader2 size={22} strokeWidth={1.75} /></div>
          )}
          <SpPageHero icon={LayoutGrid} title="集中采购目录" sub="集中采购品目与价格信息浏览">
            <div className="page-hero__stat"><strong>{items.length}</strong><span>当前筛选条目</span></div>
            <div className="page-hero__stat"><strong>{categoryTree.length}</strong><span>品类大组</span></div>
          </SpPageHero>

          <div className="catalog-layout">
            <aside className="cat-sidebar">
              <div className="cat-sidebar-title">品类导航</div>
              <div className="cat-tree">
                {categoryTree.map((node) => (
                  <div key={node.group} className="cat-node">
                    <div
                      className={`cat-group${selectedGroup === node.group ? " active" : ""}`}
                      onClick={() => selectGroup(node.group)}
                    >
                      <span>{node.group}</span>
                      <span className="cat-count">{node.itemCount}</span>
                    </div>
                    {selectedGroup === node.group && (
                      <div className="cat-sub">
                        {node.categories.map((c) => (
                          <div
                            key={c}
                            className={`cat-leaf${selectedCategory === c ? " active" : ""}`}
                            onClick={() => selectCategory(c)}
                          >
                            {c}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </aside>

            <section className="cat-main">
              <div className="cat-toolbar neu-card">
                <div className="cat-search">
                  <Search size={15} strokeWidth={1.75} className="cat-search__icon" />
                  <SpInput
                    placeholder="搜索物资 / 规格 / 编码"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") onSearch(); }}
                  />
                  {search && (
                    <button
                      type="button" className="cat-search__clear" aria-label="清空"
                      onClick={() => { setSearch(""); loadItems({ group: selectedGroup, category: selectedCategory, search: "" }); }}
                    >
                      <CircleX size={14} strokeWidth={1.75} />
                    </button>
                  )}
                </div>
                <SpButton variant="primary" onClick={onSearch}>搜索</SpButton>
                <SpButton onClick={resetFilters}>重置</SpButton>
                <div className="cat-spacer" />
                <SpButton variant="primary" onClick={openNewItem}>新增品类申请</SpButton>
              </div>

              <div className="cat-filter-bar">
                <span className="cat-filter-label">当前筛选：</span>
                <span className="cat-filter-body">
                  {selectedGroup || selectedCategory || search ? (
                    <span className="cat-tag cat-tag--primary cat-filter-tag">
                      {[selectedGroup, selectedCategory, search].filter(Boolean).join(" / ")}
                      <button type="button" className="cat-tag__close" aria-label="关闭" onClick={resetFilters}>
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    </span>
                  ) : (
                    <span className="cat-filter-none">全部品类</span>
                  )}
                </span>
                <span className="cat-result-count">共 {items.length} 项</span>
              </div>

              <div className="cat-grid">
                {items.map((row) => {
                  const st = itemStatus(row);
                  const badge = st.inProgress
                    ? { label: "审核中", cls: "pending" }
                    : st.hasActiveSupply
                      ? { label: "已准入", cls: "approved" }
                      : st.supplySuspended
                        ? { label: "供货已停用", cls: "returned" }
                        : { label: "未准入", cls: "disabled" };
                  return (
                    <article key={row.id} className="cat-card">
                      <div className="cat-card-top">
                        <div className="cat-card-code">{row.code}</div>
                        <span className={`sp-status ${badge.cls}`}>{badge.label}</span>
                      </div>
                      <div className="cat-card-name">{row.name}</div>
                      {row.specification && <div className="cat-card-spec">{row.specification}</div>}
                      <div className="cat-card-chips">
                        {row.category && <span className="cat-chip">{row.category}</span>}
                        {row.unit && <span className="cat-chip">{row.unit}</span>}
                        {row.region && <span className="cat-chip">{row.region}</span>}
                      </div>
                      <div className="cat-card-foot">
                        {st.canApplyJoin ? (
                          <button type="button" className="cat-btn cat-btn--primary" onClick={() => openJoin(row)}>申请供货</button>
                        ) : st.canUpdateQuote ? (
                          <button type="button" className="cat-btn cat-btn--default" onClick={() => openUpdate(row)}>改报价</button>
                        ) : st.inProgress ? (
                          <Link href="/catalog-applications" className="cat-card-link">
                            查看进度<ArrowRight size={13} strokeWidth={1.75} />
                          </Link>
                        ) : st.supplySuspended ? (
                          <span className="text-[11px] text-[var(--muted-foreground)]">供货关系已停用，请联系采购管理员</span>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                {items.length === 0 && (
                  <div className="cat-grid-empty">
                    <div className="cat-empty">暂无匹配的目录条目</div>
                  </div>
                )}
              </div>
            </section>
          </div>
          <ApplicationDialog
            open={dialogVisible} onClose={() => setDialogVisible(false)}
            mode={dialogMode} item={dialogItem} onSuccess={loadAll}
          />
        </div>
      )}
    </div>
  );
}
