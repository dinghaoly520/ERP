// 异步状态
export { useAsyncState } from './async';
export type { AsyncStatus, UseAsyncStateOptions, UseAsyncStateResult } from './async';

// 四态容器 + 行内错误
export { StateBoundary, InlineError } from './state-boundary';
export type { StateBoundaryProps } from './state-boundary';

// 乐观更新 + 撤销 + 自动保存
export { useOptimisticToggle, useUndoableAction, useAutoSave } from './optimistic';
export type {
  OptimisticToggleOptions,
  UndoableActionOptions,
  UndoableExecuteParams,
  AutoSaveOptions,
  AutoSaveStatus,
} from './optimistic';

// 无障碍基元
export { useFocusTrap, useDismissable, useReducedMotion, useGlobalHotkey, useRovingIndex } from './a11y';
export { LiveRegion, Tooltip } from './a11y-components';

// 错误兜底 + 重试
export { ErrorBoundary, PageErrorFallback, withRetry, isRetryableError } from './error-boundary';
export { GlobalErrorHandler } from './global-error-handler';

// 骨架系统
export {
  BlockSkeleton,
  LineSkeleton,
  CircleSkeleton,
  TableSkeleton,
  CardGridSkeleton,
  StatCardSkeleton,
  DetailSkeleton,
  BudgetLineSkeleton,
} from './skeletons';

// 基础 hooks
export {
  useCountUp,
  useTypewriter,
  useStaggeredEntrance,
  useScrollAwareHeader,
  useDataChanged,
} from './hooks';

// 基础组件
export {
  Skeleton,
  EmptyState,
  AnimatedBadge,
  PageTransition,
  StaggerContainer,
  StaggerItem,
  MiniProgressBar,
} from './components';
