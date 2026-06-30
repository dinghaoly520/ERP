import type { AiWorkspaceStageItem, AiWorkspaceStageKey } from '@/lib/types/ai-bid-analysis';

export function resolveWorkspaceStage(
  currentStage: AiWorkspaceStageKey,
  nextStage: AiWorkspaceStageKey,
  stages: AiWorkspaceStageItem[],
) {
  const currentStageEnabled = stages.some((stage) => stage.key === currentStage && stage.enabled);

  return currentStageEnabled ? currentStage : nextStage;
}
