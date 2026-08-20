"use client";

/**
 * 供货申请弹窗 — 移植自 Vue supplier-portal/src/views/catalog/ApplicationDialog.vue
 * 四种模式：NEW_ITEM 新增品类 / JOIN_EXISTING 申请供货 / UPDATE_QUOTE 改报价 / edit 重新提交。
 * 保留全部业务规则：
 *  - 报价必填且 > 0（「请填写有效报价」）
 *  - 新增品类（NEW_ITEM 或 edit+type=NEW_ITEM）必填：物资名称 / 组别 / 分类 / 单位
 *  - UPDATE_QUOTE 提交前二次确认（¥ 两位小数）
 *  - 表单有改动时关闭需确认（「有未保存的填写内容，确定放弃吗？」）
 *  - 组别切换会清空已选分类；分类下拉在未选组别前禁用
 *  - edit 模式走 updateApplication（携带 type），其余走 createApplication（携带 catalogItemId）
 *  - 资质说明 300 字计数；含税/含运费默认 true / false
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { catalogApi } from "@/lib/api/catalog";
import "@/styles/pages/catalog.css";

export type DialogMode = "NEW_ITEM" | "JOIN_EXISTING" | "UPDATE_QUOTE" | "edit";

/** 目录条目（脱敏浏览：无价格字段） */
export interface CatalogItem {
  id: string;
  code?: string;
  name?: string;
  specification?: string | null;
  unit?: string | null;
  category?: string | null;
  region?: string | null;
}

export interface CatalogApplication {
  id: string;
  type: string;
  status: string;
  catalogItemId?: string;
  proposedName?: string | null;
  proposedSpec?: string | null;
  proposedCategory?: string | null;
  proposedGroup?: string | null;
  proposedUnit?: string | null;
  quotedPrice?: number | string | null;
  deliveryPeriod?: string | null;
  region?: string | null;
  minOrder?: string | null;
  taxIncluded?: boolean | null;
  freightIncluded?: boolean | null;
  qualificationNote?: string | null;
  counterPrice?: number | string | null;
  counterNote?: string | null;
  rejectReason?: string | null;
  reviewerNote?: string | null;
  createdAt?: string;
  catalogItem?: { id?: string; code?: string; name?: string; specification?: string | null; unit?: string | null } | null;
}

export interface CatalogSupply {
  id: string;
  catalogItemId: string;
  status: string;
  quotedPrice: number | string;
  catalogItem?: { id?: string; code?: string; name?: string; specification?: string | null; unit?: string | null } | null;
  deliveryPeriod?: string | null;
  region?: string | null;
  minOrder?: string | null;
  updatedAt?: string;
}

/** 品类导航节点（/supplier-portal/catalog/categories） */
export interface CategoryNode {
  group: string;
  categories: string[];
  itemCount?: number;
}

interface DialogForm {
  proposedName: string;
  proposedSpec: string;
  proposedCategory: string;
  proposedGroup: string;
  proposedUnit: string;
  quotedPrice: string;
  deliveryPeriod: string;
  region: string;
  minOrder: string;
  taxIncluded: boolean;
  freightIncluded: boolean;
  qualificationNote: string;
}

const TITLE_MAP: Record<string, string> = {
  NEW_ITEM: "新增品类", JOIN_EXISTING: "申请供货", UPDATE_QUOTE: "改报价", edit: "重新提交",
};

function emptyForm(): DialogForm {
  return {
    proposedName: "", proposedSpec: "", proposedCategory: "", proposedGroup: "", proposedUnit: "",
    quotedPrice: "", deliveryPeriod: "", region: "", minOrder: "",
    taxIncluded: true, freightIncluded: false, qualificationNote: "",
  };
}

function formFromApplication(a: CatalogApplication): DialogForm {
  return {
    proposedName: a.proposedName ?? "",
    proposedSpec: a.proposedSpec ?? "",
    proposedCategory: a.proposedCategory ?? "",
    proposedGroup: a.proposedGroup ?? "",
    proposedUnit: a.proposedUnit ?? "",
    quotedPrice: a.quotedPrice != null ? String(a.quotedPrice) : "",
    deliveryPeriod: a.deliveryPeriod ?? "",
    region: a.region ?? "",
    minOrder: a.minOrder ?? "",
    taxIncluded: a.taxIncluded ?? true,
    freightIncluded: a.freightIncluded ?? false,
    qualificationNote: a.qualificationNote ?? "",
  };
}

export function ApplicationDialog({
  open, onClose, mode, item, application, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  mode: DialogMode;
  item?: CatalogItem | null;
  application?: CatalogApplication | null;
  onSuccess: () => void;
}) {
  const title = TITLE_MAP[mode] ?? mode;

  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [form, setForm] = useState<DialogForm>(emptyForm);

  /* 弹窗进出场动画状态（对应 Vue <Teleport> + <Transition name="app-dlg">） */
  const [leaving, setLeaving] = useState(false);
  const wasOpen = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
      setLeaving(false);
    } else if (wasOpen.current) {
      setLeaving(true);
      leaveTimer.current = setTimeout(() => setLeaving(false), 160);
    }
    return () => { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } };
  }, [open]);

  /* 打开时重置表单；NEW_ITEM 且品类树未加载时拉取（失败静默） */
  useEffect(() => {
    if (!open) return;
    setFormDirty(false);
    setForm(mode === "edit" && application ? formFromApplication(application) : emptyForm());
    if (mode === "NEW_ITEM" && categoryTree.length === 0) {
      catalogApi.listCategories()
        .then((tree) => setCategoryTree(tree as CategoryNode[]))
        .catch(() => { /* ignore */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const show = open || leaving;

  const isNewItem = mode === "NEW_ITEM" || (mode === "edit" && application?.type === "NEW_ITEM");
  const groupOptions = categoryTree.map((c) => c.group);
  const categoriesOf = (group: string) => categoryTree.find((c) => c.group === group)?.categories || [];

  const set = <K extends keyof DialogForm>(key: K, value: DialogForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFormDirty(true);
  };

  /* 有未保存内容时关闭需确认（ElMessageBox.confirm → window.confirm） */
  function requestClose() {
    if (formDirty && !window.confirm("有未保存的填写内容，确定放弃吗？")) return;
    onClose();
  }

  async function handleSubmit() {
    const price = form.quotedPrice;
    if (price === "" || price == null || Number(price) <= 0) { toast.warning("请填写有效报价"); return; }
    if (isNewItem) {
      if (!form.proposedName.trim()) { toast.warning("请填写物资名称"); return; }
      if (!form.proposedGroup) { toast.warning("请选择组别"); return; }
      if (!form.proposedCategory) { toast.warning("请选择分类"); return; }
      if (!form.proposedUnit.trim()) { toast.warning("请填写单位"); return; }
    }
    if (mode === "UPDATE_QUOTE") {
      if (!window.confirm(`确认将报价修改为 ¥${Number(price).toFixed(2)}？`)) return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        quotedPrice: Number(price),
        deliveryPeriod: form.deliveryPeriod || undefined,
        region: form.region || undefined,
        minOrder: form.minOrder || undefined,
        taxIncluded: form.taxIncluded,
        freightIncluded: form.freightIncluded,
        qualificationNote: form.qualificationNote || undefined,
      };
      if (isNewItem) {
        payload.proposedName = form.proposedName.trim();
        payload.proposedSpec = form.proposedSpec.trim() || undefined;
        payload.proposedCategory = form.proposedCategory;
        payload.proposedGroup = form.proposedGroup;
        payload.proposedUnit = form.proposedUnit.trim();
      }
      if (mode === "edit") {
        await catalogApi.updateApplication(application!.id, { ...payload, type: application!.type });
        toast.success("已重新提交申请");
      } else {
        await catalogApi.createApplication({ type: mode, catalogItemId: item?.id, ...payload });
        toast.success("申请已提交，等待管理员审核");
      }
      setFormDirty(false);
      onClose();
      onSuccess();
    } catch { /* 全局拦截器已 toast */ }
    finally { setSubmitting(false); }
  }

  if (!show || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn("app-dlg-overlay", leaving ? "app-dlg-leave-active" : "app-dlg-enter-active")}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className="app-dlg-panel">
        {/* Title bar */}
        <div className="app-dlg-head">
          <h2 className="app-dlg-title">{title}</h2>
          <button type="button" className="app-dlg-close" aria-label="关闭" onClick={requestClose}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="app-dlg-body">
          {/* Target item info (JOIN/UPDATE) */}
          {item && mode !== "NEW_ITEM" && mode !== "edit" && (
            <div className="app-dlg-item-badge">
              <span className="app-dlg-item-code">{item.code}</span>
              <span className="app-dlg-item-sep">·</span>
              <span className="app-dlg-item-name">{item.name}</span>
              <span className="app-dlg-item-spec">{item.specification}</span>
              <span className="app-dlg-item-unit">{item.unit}</span>
            </div>
          )}
          {mode === "edit" && application?.catalogItem && (
            <div className="app-dlg-item-badge">
              <span className="app-dlg-item-code">{application.catalogItem.code}</span>
              <span className="app-dlg-item-name">{application.catalogItem.name}</span>
            </div>
          )}

          {/* Countered warning */}
          {mode === "edit" && application?.status === "COUNTERED" && application.counterPrice && (
            <div className="app-dlg-countered">
              <AlertTriangle size={14} strokeWidth={1.75} />
              管理员议价 <strong>¥{application.counterPrice}</strong>，可直接修改报价后重新提交
            </div>
          )}

          {/* ────── Form ────── */}
          <div className="app-dlg-form">
            {/* New item fields */}
            {isNewItem && (
              <>
                <div className="app-dlg-field">
                  <label className="app-dlg-label">物资名称 <i>*</i></label>
                  <input
                    className="app-dlg-input" placeholder="如：玻璃钢夹砂管" maxLength={60}
                    value={form.proposedName} onChange={(e) => set("proposedName", e.target.value)}
                  />
                </div>
                <div className="app-dlg-field">
                  <label className="app-dlg-label">规格型号</label>
                  <input
                    className="app-dlg-input" placeholder="如：DN500，SN10" maxLength={120}
                    value={form.proposedSpec} onChange={(e) => set("proposedSpec", e.target.value)}
                  />
                </div>
                <div className="app-dlg-row">
                  <div className="app-dlg-field">
                    <label className="app-dlg-label">组别 <i>*</i></label>
                    <select
                      className="app-dlg-select" value={form.proposedGroup}
                      onChange={(e) => {
                        const g = e.target.value;
                        setForm((f) => ({ ...f, proposedGroup: g, proposedCategory: "" }));
                        setFormDirty(true);
                      }}
                    >
                      <option value="" disabled>选择组别</option>
                      {groupOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <div className="app-dlg-field">
                    <label className="app-dlg-label">分类 <i>*</i></label>
                    <select
                      className="app-dlg-select" value={form.proposedCategory} disabled={!form.proposedGroup}
                      onChange={(e) => set("proposedCategory", e.target.value)}
                    >
                      <option value="" disabled>选择分类</option>
                      {categoriesOf(form.proposedGroup).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="app-dlg-field">
                  <label className="app-dlg-label">单位 <i>*</i></label>
                  <input
                    className="app-dlg-input app-dlg-unit" placeholder="如：米 / 吨 / 套" maxLength={10}
                    value={form.proposedUnit} onChange={(e) => set("proposedUnit", e.target.value)}
                  />
                </div>
              </>
            )}

            {/* Price — always shown */}
            <div className="app-dlg-field">
              <label className="app-dlg-label">
                {mode === "UPDATE_QUOTE" ? "新报价" : "报价"} <i>*</i>
                {item ? <span className="app-dlg-label-hint"> / {item.unit}</span>
                  : form.proposedUnit ? <span className="app-dlg-label-hint"> / {form.proposedUnit}</span> : null}
              </label>
              <div className="app-dlg-price-input">
                <span className="app-dlg-currency">¥</span>
                <input
                  className="app-dlg-input" type="number" placeholder="0.00" min={0} step={0.01}
                  value={form.quotedPrice} onChange={(e) => set("quotedPrice", e.target.value)}
                />
              </div>
            </div>

            <div className="app-dlg-row">
              <div className="app-dlg-field">
                <label className="app-dlg-label">交货周期</label>
                <input
                  className="app-dlg-input" placeholder="如：7个工作日" maxLength={20}
                  value={form.deliveryPeriod} onChange={(e) => set("deliveryPeriod", e.target.value)}
                />
              </div>
              <div className="app-dlg-field">
                <label className="app-dlg-label">适用区域</label>
                <input
                  className="app-dlg-input" placeholder="如：成都 / 全省" maxLength={20}
                  value={form.region} onChange={(e) => set("region", e.target.value)}
                />
              </div>
            </div>
            <div className="app-dlg-row">
              <div className="app-dlg-field">
                <label className="app-dlg-label">最小起订</label>
                <input
                  className="app-dlg-input" placeholder="如：1吨 / 50米" maxLength={20}
                  value={form.minOrder} onChange={(e) => set("minOrder", e.target.value)}
                />
              </div>
              <div className="app-dlg-field">
                <label className="app-dlg-label">含税 &amp; 运费</label>
                <div className="app-dlg-checks">
                  <label className="app-dlg-check">
                    <input type="checkbox" checked={form.taxIncluded} onChange={(e) => set("taxIncluded", e.target.checked)} />
                    <span>含税</span>
                  </label>
                  <label className="app-dlg-check">
                    <input type="checkbox" checked={form.freightIncluded} onChange={(e) => set("freightIncluded", e.target.checked)} />
                    <span>含运费</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="app-dlg-field">
              <label className="app-dlg-label">资质说明</label>
              <textarea
                className="app-dlg-input app-dlg-textarea" rows={3} maxLength={300}
                placeholder="资质优势、代理授权、库存产能等，便于管理员审核"
                value={form.qualificationNote} onChange={(e) => set("qualificationNote", e.target.value)}
              />
              <span className="app-dlg-charcount">{form.qualificationNote.length} / 300</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="app-dlg-foot">
          <div className="neu-btn-group">
            <button type="button" className="neu-btn-soft" onClick={requestClose}>取消</button>
            <button type="button" className="neu-btn-primary" disabled={submitting} onClick={handleSubmit}>
              {submitting ? "提交中..." : (mode === "edit" ? "重新提交" : "提交申请")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
