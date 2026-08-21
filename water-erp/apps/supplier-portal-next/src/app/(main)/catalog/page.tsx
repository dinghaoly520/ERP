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
import { useEffect, useState } from "react";
import { AlertTriangle, CircleX, Loader2, Search, ShoppingBag } from "lucide-react";
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

const IN_PROGRESS = ["PENDING", "COUNTERED", "RETURNED"];

export default function CatalogListPage() {
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState(false);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const [myApplications, setMyApplications] = useState<CatalogApplication[]>([]);
  const [mySupply, setMySupply] = useState<CatalogSupply[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("工程材料");
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
      await loadItems();
    } catch { setError(true); }
    finally { setLoading(false); setFirstLoad(false); }
  }

  async function loadItems(ovr?: { group?: string; category?: string; search?: string }) {
    const group = ovr?.group ?? selectedGroup;
    const category = ovr?.category ?? selectedCategory;
    const q = ovr?.search ?? search;
    try {
      const list = await catalogApi.listItems({
        group: group || undefined,
        category: category || undefined,
        search: q.trim() || undefined,
      });
      setItems(list as CatalogItem[]);
    } catch { setError(true); }
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
    const active = mySupply.find((s) => s.catalogItemId === item.id);
    const inProgress = myApplications.find((a) => a.catalogItemId === item.id && IN_PROGRESS.includes(a.status));
    return {
      hasActiveSupply: !!active,
      inProgress,
      canApplyJoin: !active && !inProgress,
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
            <span className="sp-skel" style={{ width: 120, height: 13 }} />
            <span className="sp-skel" style={{ width: 240, height: 24, marginTop: 12 }} />
            <span className="sp-skel" style={{ width: 360, height: 14, marginTop: 10 }} />
          </div>
          <div className="skel-cat">
            <div className="skel-sidebar">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="sp-skel" style={{ width: "100%", height: 32, marginBottom: 4 }} />
              ))}
            </div>
            <div className="skel-main">
              <span className="sp-skel" style={{ width: "100%", height: 36, marginBottom: 12 }} />
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className="sp-skel" style={{ width: "100%", height: 40, marginBottom: 4 }} />
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
          <SpPageHero icon={ShoppingBag} title="集中采购目录" sub="浏览集团集中采购目录品类，申请加入供货或调整报价。">
            <div className="page-hero__stat"><strong>{items.length}</strong><span>目录条目</span></div>
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

              <div className="neu-table-card cat-table-shell">
                <table className="cat-table">
                  <colgroup>
                    <col />
                    <col />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 70 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 130 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>编码 / 物资</th>
                      <th>规格型号</th>
                      <th>分类</th>
                      <th>单位</th>
                      <th>区域</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => {
                      const st = itemStatus(row);
                      return (
                        <tr key={row.id}>
                          <td>
                            <div className="cat-cell">
                              <div className="cell-code">{row.code}</div>
                              <div className="cell-name">{row.name}</div>
                            </div>
                          </td>
                          <td><div className="cat-cell cat-cell--ellipsis">{row.specification}</div></td>
                          <td>
                            <div className="cat-cell">
                              <span className="cat-tag cat-tag--small cat-tag--plain cat-tag--primary">{row.category}</span>
                            </div>
                          </td>
                          <td><div className="cat-cell">{row.unit}</div></td>
                          <td><div className="cat-cell">{row.region}</div></td>
                          <td>
                            <div className="cat-cell">
                              {st.canApplyJoin ? (
                                <button type="button" className="cat-btn cat-btn--primary" onClick={() => openJoin(row)}>申请供货</button>
                              ) : st.canUpdateQuote ? (
                                <button type="button" className="cat-btn cat-btn--default" onClick={() => openUpdate(row)}>改报价</button>
                              ) : st.inProgress ? (
                                <span className="cat-tag cat-tag--small cat-tag--plain cat-tag--warning">审核中</span>
                              ) : (
                                <span className="cat-tag cat-tag--small cat-tag--plain cat-tag--info">已准入</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {items.length === 0 && (
                      <tr><td colSpan={6}><div className="cat-empty">暂无匹配的目录条目</div></td></tr>
                    )}
                  </tbody>
                </table>
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
