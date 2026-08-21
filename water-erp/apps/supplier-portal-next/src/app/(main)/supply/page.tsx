"use client";

/**
 * 我的供货关系 — 移植自 Vue supplier-portal/src/views/catalog/MySupply.vue
 * 已通过审核的目录品类供货关系与当前报价。保留全部业务规则：
 *  - 本地搜索（名称/编码/规格，忽略大小写）+ 客户端分页（每页 8 条）
 *  - ACTIVE 状态卡片显示「申请改报价」（UPDATE_QUOTE 弹窗，仅报价/交期/区域/起订等字段）
 *  - 非 ACTIVE 显示「已停用」标签且无操作
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { AlertTriangle, CircleX, Loader2, PackageSearch, PackageX, Search, Truck } from "lucide-react";
import { SpButton, SpInput, SpPagination } from "@/components/ui";
import { SpPageHero } from "@/components/sp-page-hero";
import { catalogApi } from "@/lib/api/catalog";
import {
  ApplicationDialog,
  type CatalogItem,
  type CatalogSupply,
} from "@/components/catalog/application-dialog";
import "@/styles/pages/catalog.css";

const PAGE_SIZE = 8;

export default function MySupplyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [supply, setSupply] = useState<CatalogSupply[]>([]);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogItem, setDialogItem] = useState<CatalogItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const filteredSupply = !searchQuery.trim()
    ? supply
    : (() => {
        const q = searchQuery.toLowerCase();
        return supply.filter((s) =>
          s.catalogItem?.name?.toLowerCase().includes(q) ||
          s.catalogItem?.code?.toLowerCase().includes(q) ||
          s.catalogItem?.specification?.toLowerCase().includes(q),
        );
      })();
  const totalFiltered = filteredSupply.length;
  const pagedSupply = filteredSupply.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const activeCount = supply.filter((s) => s.status === "ACTIVE").length;

  function onSearchChange() { setCurrentPage(1); }

  async function load() {
    setLoading(true); setError(false);
    try { setSupply(await catalogApi.listSupply() as CatalogSupply[]); }
    catch { setError(true); }
    finally { setLoading(false); }
  }
  function retryLoad() { load(); }

  function openUpdate(s: CatalogSupply) {
    setDialogItem({
      id: s.catalogItemId,
      name: s.catalogItem!.name,
      code: s.catalogItem!.code,
      specification: s.catalogItem!.specification,
      unit: s.catalogItem!.unit,
    });
    setDialogVisible(true);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="page-container supply-page-root">
      {error ? (
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
          <SpPageHero icon={Truck} title="我的供货关系" sub="已通过审核的目录品类供货关系与当前报价。">
            <div className="page-hero__stat"><strong>{supply.length}</strong><span>供货关系</span></div>
            <div className="page-hero__stat"><strong>{activeCount}</strong><span>供货中</span></div>
          </SpPageHero>

          {/* Search */}
          {supply.length > 0 && (
            <div className="neu-card supply-filter">
              <div className="cat-search">
                <Search size={15} strokeWidth={1.75} className="cat-search__icon" />
                <SpInput
                  placeholder="搜索名称、编码或规格..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); onSearchChange(); }}
                />
                {searchQuery && (
                  <button
                    type="button" className="cat-search__clear" aria-label="清空"
                    onClick={() => { setSearchQuery(""); onSearchChange(); }}
                  >
                    <CircleX size={14} strokeWidth={1.75} />
                  </button>
                )}
              </div>
              <span className="supply-filter-count">共 {totalFiltered} 条</span>
            </div>
          )}

          {filteredSupply.length === 0 && !loading && supply.length > 0 ? (
            <div className="sp-empty supply-empty">
              <div className="sp-empty-icon"><PackageSearch size={22} strokeWidth={1.75} /></div>
              <div className="sp-empty-text">未找到匹配的供货</div>
              <div className="sp-empty-desc">尝试其他关键词</div>
            </div>
          ) : supply.length === 0 && !loading ? (
            <div className="sp-empty supply-empty">
              <div className="sp-empty-icon"><PackageX size={22} strokeWidth={1.75} /></div>
              <div className="sp-empty-text">暂无供货关系</div>
              <div className="sp-empty-desc">前往「集中采购目录」申请供货</div>
              <SpButton variant="primary" onClick={() => router.push("/catalog")}>浏览采购目录</SpButton>
            </div>
          ) : (
            <div className="supply-grid">
              {pagedSupply.map((s) => (
                <div key={s.id} className="supply-card">
                  <div className="supply-card-head">
                    <div>
                      <div className="supply-code">{s.catalogItem!.code}</div>
                      <div className="supply-name">{s.catalogItem!.name}</div>
                      <div className="supply-spec">{s.catalogItem!.specification}</div>
                    </div>
                    <span className={`sp-status ${s.status === "ACTIVE" ? "approved" : "disabled"}`}>
                      {s.status === "ACTIVE" ? "供货中" : "已停用"}
                    </span>
                  </div>
                  <div className="supply-card-body">
                    <div className="supply-price">
                      <span className="supply-price-label">当前报价</span>
                      <span className="supply-price-value">
                        &yen;{Number(s.quotedPrice).toLocaleString()}<small> / {s.catalogItem!.unit}</small>
                      </span>
                    </div>
                    <div className="supply-meta">
                      {s.deliveryPeriod && <span>交期 {s.deliveryPeriod}</span>}
                      {s.region && <span> &middot; {s.region}</span>}
                      {s.minOrder && <span> &middot; 起订 {s.minOrder}</span>}
                    </div>
                    <div className="supply-time">更新于 {dayjs(s.updatedAt).format("YYYY-MM-DD")}</div>
                  </div>
                  {s.status === "ACTIVE" && (
                    <div className="supply-card-foot">
                      <button type="button" className="cat-btn cat-btn--primary cat-btn--plain" onClick={() => openUpdate(s)}>申请改报价</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {totalFiltered > PAGE_SIZE && (
            <div className="supply-pager">
              <SpPagination page={currentPage} pageSize={PAGE_SIZE} total={totalFiltered} onChange={setCurrentPage} />
            </div>
          )}
          <ApplicationDialog
            open={dialogVisible} onClose={() => setDialogVisible(false)}
            mode="UPDATE_QUOTE" item={dialogItem} onSuccess={load}
          />
        </div>
      )}
    </div>
  );
}
