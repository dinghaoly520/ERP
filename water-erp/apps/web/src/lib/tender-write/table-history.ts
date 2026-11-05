import type { TableData } from "../types/tender-write";

/** 撤回栈深度上限：表格最大 20×10，快照很小，30 步足够覆盖一轮编辑会话。 */
export const TABLE_HISTORY_LIMIT = 30;

/** 内容编辑（打字）发生的格坐标——用于把同一格的连续输入合并为一步撤回。 */
export type TableEditCell = { r: number; c: number };

export type TableHistoryState = {
  /** 各步改动前的快照，栈顶 = 最近一步。 */
  history: TableData[];
  /** 上一次压栈对应的编辑格；结构操作（合并/拆分/行列增删/对齐/粘贴）后为 null。 */
  lastEditCell: TableEditCell | null;
};

export function createTableHistoryState(): TableHistoryState {
  return { history: [], lastEditCell: null };
}

/**
 * 记录一次改动前的快照。
 * - 结构操作（editCell=null）恒新压一步；
 * - 同一格的连续内容编辑只压第一步（打字合并），换格或结构操作后重新压；
 * - 超出上限时丢弃最旧快照。
 */
export function recordTableEdit(
  state: TableHistoryState,
  snapshot: TableData,
  editCell: TableEditCell | null,
): TableHistoryState {
  if (
    editCell &&
    state.lastEditCell &&
    editCell.r === state.lastEditCell.r &&
    editCell.c === state.lastEditCell.c
  ) {
    return { ...state, lastEditCell: editCell };
  }
  const history = [...state.history, snapshot];
  if (history.length > TABLE_HISTORY_LIMIT) {
    history.splice(0, history.length - TABLE_HISTORY_LIMIT);
  }
  return { history, lastEditCell: editCell };
}

/** 弹出最近一步快照；空栈返回 snapshot=null 且状态不变。撤回后重置打字合并标记。 */
export function popTableHistory(
  state: TableHistoryState,
): { state: TableHistoryState; snapshot: TableData | null } {
  if (state.history.length === 0) {
    return { state, snapshot: null };
  }
  const history = [...state.history];
  const snapshot = history.pop()!;
  return { state: { history, lastEditCell: null }, snapshot };
}
