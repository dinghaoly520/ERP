// 异步状态
export { useAsyncState } from './async';
export type { AsyncStatus, UseAsyncStateOptions, UseAsyncStateResult } from './async';

// 四态容器 + 行内错误
export { StateBoundary, InlineError } from './state-boundary';
export type { StateBoundaryProps } from './state-boundary';

// 乐观更新 + 撤销 + 自动保存
export { useUndoableAction, useAutoSave } from './optimistic';
export type {
  UndoableActionOptions,
  UndoableExecuteParams,
  AutoSaveOptions,
  AutoSaveStatus,
} from './optimistic';

// 无障碍基元
export { useFocusTrap, useDismissable, useGlobalHotkey } from './a11y';
export { LiveRegion } from './a11y-components';

// 错误兜底
export { ErrorBoundary, PageErrorFallback } from './error-boundary';
export { GlobalErrorHandler } from './global-error-handler';

// 骨架系统
export {
  LineSkeleton,
  TableSkeleton,
  CardGridSkeleton,
} from './skeletons';

// 基础 hooks
export {
  useCountUp,
  useDataChanged,
} from './hooks';

// 基础组件
export {
  EmptyState,
  AnimatedBadge,
  StaggerContainer,
  StaggerItem,
} from './components';
