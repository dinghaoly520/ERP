import type {
  TenderDocumentType,
  TenderDraftRecord,
  TenderDraftsState,
} from "@/lib/types/tender-write";
import { createEmptyTenderDrafts } from "@/lib/tender-write/templates";

const SELECTED_TYPE_KEY = "tender-write:selected-type:v1";
const DRAFTS_KEY = "tender-write:drafts:v1";
const SESSION_ID_KEY = "tender-write:session-id:v1";

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
      ? ({
          ...createEmptyTenderDrafts(),
          ...JSON.parse(draftsRaw),
        } as TenderDraftsState)
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
