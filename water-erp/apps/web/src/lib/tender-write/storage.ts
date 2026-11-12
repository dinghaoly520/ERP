import type {
  TableData,
  TenderDocumentType,
  TenderDraftRecord,
  TenderDraftsState,
} from "@/lib/types/tender-write";
import { createEmptyTenderDrafts } from "@/lib/tender-write/templates";
import { parseQuotationTextToTable, tableHasDataRows } from "@/lib/tender-write/quotation-table-text";

const SELECTED_TYPE_KEY = "tender-write:selected-type:v1";
const DRAFTS_KEY = "tender-write:drafts:v1";
const SESSION_ID_KEY = "tender-write:session-id:v1";

/**
 * 2026-10-28 二轮隔离：项目草稿缓存键按轮后缀（R1 沿用旧键=存量不迁移不丢），
 * 与服务器 (projectId, round) 同构——编写弹窗/公告向导/邀请预填统一取键。
 */
export function tenderDraftStorageKey(projectId: string, round: number): string {
  return round > 1
    ? `tender-write:project-drafts:v1:${projectId}:R${round}`
    : `tender-write:project-drafts:v1:${projectId}`;
}

export function createTenderWriteSessionId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
}

export function beginTenderWriteSession(sessionId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const previousSessionId = window.localStorage.getItem(SESSION_ID_KEY);
  if (previousSessionId && previousSessionId !== sessionId) {
    window.localStorage.removeItem(SELECTED_TYPE_KEY);
    window.localStorage.removeItem(DRAFTS_KEY);
  }
  window.localStorage.setItem(SESSION_ID_KEY, sessionId);
}

/**
 * 草稿形状清洗（2026-10-30 加载稳健性）：字符串字段里意外混入的 number/boolean
 * 归一为字符串；结构化字段（报价表/评分行）原样保留（编辑器侧自防）；其余畸形值
 * （对象/数组/函数混入字符串键）直接丢弃——由空默认兜底，防 .trim()/渲染崩溃。
 */
const STRUCTURED_DRAFT_FIELDS = new Set(['quotationLetterTable', 'scoringItems']);

/**
 * 报价表模式归一化（2026-11-12 用户裁定「优先默认使用表格」，所有草稿恢复路径统一收口）：
 * - 字符串实为 Tab 表格行（旧批量通道写入的错形残留——文字模式下文字框暴露表格制式）
 *   → 收敛表格模式；表格无数据行时用残留文本转表（表格内容归表格）
 * - 未设模式 → 默认表格；真文字（无 Tab 的叙述性内容）保文字模式（内容保护，不吞存量）
 * - 显式表格 / 文字+真段落 → 不扰动；幂等（归一化后的草稿再过一遍不变）
 */
function normalizeQuotationMode(out: Record<string, unknown>): void {
  if (!('quotationLetter' in out) && !('quotationLetterTable' in out)) return;
  const q = typeof out.quotationLetter === 'string' ? out.quotationLetter : '';
  const type = out.quotationLetterType;
  if (q.includes('\t')) {
    out.quotationLetterType = 'table';
    const tbl = out.quotationLetterTable as TableData | undefined;
    if (!tbl || !tableHasDataRows(tbl)) {
      const parsed = parseQuotationTextToTable(q);
      if (parsed) out.quotationLetterTable = parsed;
    }
  } else if (type !== 'text' && type !== 'table') {
    out.quotationLetterType = q.trim() ? 'text' : 'table';
  }
}

export function sanitizeTenderDraft(
  draft: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!draft || typeof draft !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (v == null) continue;
    if (typeof v === 'string') {
      // 字段级兜底：供应商名称不可能是长文本（公司名普遍 <40 字）——历史污染值
      // （2026-10-30 直采实录）超长即清空，让用户再进入时脏值自动消失重选
      if (k === 'supplierName' && v.trim().length > 40) continue;
      out[k] = v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = String(v);
    } else if (STRUCTURED_DRAFT_FIELDS.has(k) && typeof v === 'object') {
      out[k] = v;
    }
    // 其余畸形值丢弃
  }
  normalizeQuotationMode(out);
  return out;
}

export function sanitizeTenderDraftsState<T extends TenderDraftsState>(drafts: T): T {
  const out = { ...drafts };
  for (const key of Object.keys(out) as Array<keyof TenderDraftsState>) {
    out[key] = sanitizeTenderDraft(drafts[key] as Record<string, unknown>) as never;
  }
  return out;
}

export function readTenderWriteState(): {
  selectedType: TenderDocumentType | null;
  drafts: TenderDraftsState;
} {
  if (typeof window === "undefined") {
    return { selectedType: null, drafts: createEmptyTenderDrafts() };
  }

  try {
    const selectedType = window.localStorage.getItem(
      SELECTED_TYPE_KEY,
    ) as TenderDocumentType | null;
    const draftsRaw = window.localStorage.getItem(DRAFTS_KEY);
    const drafts = draftsRaw
      ? sanitizeTenderDraftsState({
          ...createEmptyTenderDrafts(),
          ...(JSON.parse(draftsRaw) as TenderDraftsState),
        })
      : createEmptyTenderDrafts();

    return { selectedType, drafts };
  } catch {
    return { selectedType: null, drafts: createEmptyTenderDrafts() };
  }
}

export function writeTenderWriteState(payload: {
  selectedType: TenderDocumentType | null;
  drafts: TenderDraftsState;
}) {
  if (typeof window === "undefined") {
    return;
  }

  if (!payload.selectedType) {
    return;
  }

  window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(payload.drafts));
  window.localStorage.setItem(SELECTED_TYPE_KEY, payload.selectedType);
}

export function resetTenderDraftByType(
  drafts: TenderDraftsState,
  type: TenderDocumentType,
): TenderDraftsState {
  const emptyDrafts = createEmptyTenderDrafts();
  return {
    ...drafts,
    [type]: emptyDrafts[type] as TenderDraftRecord,
  };
}
