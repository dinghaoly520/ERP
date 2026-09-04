import { api } from "../api";

export interface AwardLetterAsset {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface AwardLetterDelivery {
  id: string;
  projectId: string;
  project: {
    id: string;
    name: string;
    projectCode: string;
  };
  supplierName: string;
  content: {
    winnerName?: string;
    winnerPrice?: string | number;
    projectName?: string;
  } | null;
  letterAssetId: string | null;
  letterAsset: AwardLetterAsset | null;
  receiptNo: string;
  deliveredAt: string | null;
  receivedAt: string | null;
  signedAt: string | null;
  signedBy: string | null;
  createdAt: string;
}

export function awardLetterFileUrl(assetId: string | null): string | null {
  return assetId ? `/api/upload/files/${encodeURIComponent(assetId)}` : null;
}

export function canSignAwardLetter(
  letter: Pick<AwardLetterDelivery, "deliveredAt" | "receivedAt" | "signedAt" | "letterAssetId">,
): boolean {
  return Boolean(letter.deliveredAt && letter.receivedAt && letter.letterAssetId && !letter.signedAt);
}

export function awardLetterProjectLabel(
  letter: Pick<AwardLetterDelivery, "project">,
): string {
  return `${letter.project.name}（${letter.project.projectCode}）`;
}

export function awardLetterVersionBody(letterAssetId: string, deliveredAt: string) {
  return { letterAssetId, deliveredAt };
}

export function prioritizeAwardLetters<T extends { id: string }>(
  letters: T[],
  deliveryId: string | null | undefined,
): T[] {
  if (!deliveryId) return letters;
  const targetIndex = letters.findIndex((letter) => letter.id === deliveryId);
  if (targetIndex <= 0) return letters;
  return [letters[targetIndex], ...letters.slice(0, targetIndex), ...letters.slice(targetIndex + 1)];
}

export const awardLetterApi = {
  list() {
    return api.get<AwardLetterDelivery[]>("/supplier-portal/award-letters");
  },
  sign(id: string, letterAssetId: string, deliveredAt: string) {
    return api.post<AwardLetterDelivery>(
      `/supplier-portal/award-letters/${id}/sign`,
      awardLetterVersionBody(letterAssetId, deliveredAt),
    );
  },
  markReceived(id: string, letterAssetId: string, deliveredAt: string) {
    return api.post<{ received: true; receivedAt: string; receiptNo: string }>(
      `/supplier-portal/award-letters/${id}/received`,
      awardLetterVersionBody(letterAssetId, deliveredAt),
    );
  },
};
