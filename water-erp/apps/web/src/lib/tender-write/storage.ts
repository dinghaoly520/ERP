import type {
  TableData,
  TenderDocumentType,
  TenderDraftRecord,
  TenderDraftsState,
} from "@/lib/types/tender-write";
import { createEmptyTenderDrafts } from "@/lib/tender-write/templates";
import { parseQuotationTextToTable, tableHasDataRows } from "@/lib/tender-write/quotation-table-text";
import { createDraftPusher } from "@/lib/api/drafts";

const SELECTED_TYPE_KEY = "tender-write:selected-type:v1";
const DRAFTS_KEY = "tender-write:drafts:v1";
const SESSION_ID_KEY = "tender-write:session-id:v1";

/** 独立工作台全局草稿·服务端草稿键（账号维度，跨设备续作，2026-11-24） */
const GLOBAL_SERVER_DRAFT_KEY = "tender-write-global:v1";
const globalDraftPusher = createDraftPusher(GLOBAL_SERVER_DRAFT_KEY);

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
    // _savedAt 是本机同步时间戳（跨设备合并用），不进工作台状态
    const parsed = (draftsRaw ? JSON.parse(draftsRaw) : {}) as TenderDraftsState & { _savedAt?: number };
    delete parsed._savedAt;
    const drafts = draftsRaw
      ? sanitizeTenderDraftsState({
          ...createEmptyTenderDrafts(),
          ...parsed,
        })
      : createEmptyTenderDrafts();

    return { selectedType, drafts };
  } catch {
    return { selectedType: null, drafts: createEmptyTenderDrafts() };
  }
}

export function writeTenderWriteState(
  payload: {
    selectedType: TenderDocumentType | null;
    drafts: TenderDraftsState;
  },
  opts?: { sync?: boolean },
) {
  if (typeof window === "undefined") {
    return;
  }

  if (!payload.selectedType) {
    return;
  }

  const savedAt = Date.now();
  window.localStorage.setItem(DRAFTS_KEY, JSON.stringify({ ...payload.drafts, _savedAt: savedAt }));
  window.localStorage.setItem(SELECTED_TYPE_KEY, payload.selectedType);
  // 双写服务端草稿（账号维度）：换设备登录同账号时工作台草稿完整可见；
  // sync:false 供打开时的跨设备合并未落定前只写本机（防预填空草稿以新时间戳覆盖服务端旧草稿）
  if (opts?.sync !== false) {
    globalDraftPusher.push({ selectedType: payload.selectedType, drafts: payload.drafts, savedAt });
  }
}

/** 供跨设备合并读本机原始快照（合并为 selectedType+drafts+savedAt 单串；无任何缓存返回 null） */
export function tenderWriteLocalSyncRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const draftsRaw = window.localStorage.getItem(DRAFTS_KEY);
    const selectedType = window.localStorage.getItem(SELECTED_TYPE_KEY);
    if (!draftsRaw && !selectedType) return null;
    const parsed = draftsRaw ? (JSON.parse(draftsRaw) as Record<string, unknown>) : {};
    const { _savedAt, ...drafts } = parsed;
    return JSON.stringify({ selectedType, drafts, savedAt: Number(_savedAt ?? 0) });
  } catch {
    return null;
  }
}

/** 合并胜者回写本机两键（selected-type / drafts 带 _savedAt），供跨设备同步采用服务端快照时调用 */
export function applyTenderWriteSyncRaw(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as {
      selectedType?: string | null;
      drafts?: Record<string, unknown>;
      savedAt?: number;
    };
    if (parsed.drafts && typeof parsed.drafts === "object") {
      window.localStorage.setItem(DRAFTS_KEY, JSON.stringify({ ...parsed.drafts, _savedAt: parsed.savedAt ?? 0 }));
    }
    if (parsed.selectedType) window.localStorage.setItem(SELECTED_TYPE_KEY, parsed.selectedType);
    return Number(parsed.savedAt ?? 0);
  } catch {
    return 0;
  }
}

/** 本机当前同步时间戳（无缓存返回 0）——合并应用前重读，防 fetch 窗口内的用户新编辑被旧远端覆盖 */
export function tenderWriteLocalSavedAt(): number {
  if (typeof window === "undefined") return 0;
  try {
    const draftsRaw = window.localStorage.getItem(DRAFTS_KEY);
    if (!draftsRaw) return 0;
    return Number((JSON.parse(draftsRaw) as { _savedAt?: number })._savedAt ?? 0);
  } catch {
    return 0;
  }
}

export const TENDER_WRITE_GLOBAL_DRAFT_SERVER_KEY = GLOBAL_SERVER_DRAFT_KEY;

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
