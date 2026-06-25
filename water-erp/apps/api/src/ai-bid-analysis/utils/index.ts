// apps/api/src/ai-bid-analysis/utils/index.ts
export * from './file-processor';
export * from './price-statistics';
export * from './text-similarity';
export * from './retry';
export * from './neutralize';

/**
 * Generate a deterministic integer seed from an arbitrary string (e.g. task ID).
 * Uses a simple DJB2 hash so the same ID always produces the same seed.
 */
export function deterministicSeed(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}