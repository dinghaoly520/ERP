'use client';

import { createContext, useContext } from 'react';
import type { KnowledgeBase, ReviewTask } from '@/lib/types/tender-review';
import type { TodayStats } from '@/lib/api/review';

export type TenderReviewTab = 'review' | 'files' | 'rules' | 'reports';

export interface TenderReviewLoadingState {
  kbs: boolean;
  tasks: boolean;
  rules: boolean;
}

export interface TenderReviewErrorState {
  kbs: string | null;
  tasks: string | null;
  rules: string | null;
}

export interface TenderReviewContextValue {
  // State
  selectedKbId: string | null;
  activeTab: TenderReviewTab;
  knowledgeBases: KnowledgeBase[];
  runningTasks: ReviewTask[];
  recentReviews: ReviewTask[];
  stats: TodayStats;
  selectedReportTask: ReviewTask | null;

  // Actions
  setSelectedKbId: (id: string | null) => void;
  setActiveTab: (tab: TenderReviewTab) => void;
  setSelectedReportTask: (task: ReviewTask | null) => void;
  refreshKnowledgeBases: () => Promise<void>;
  refreshTasks: () => Promise<void>;

  // Loading & Error states
  loading: TenderReviewLoadingState;
  error: TenderReviewErrorState;

  /** 当前登录用户（用于知识库属主判断：ownerId === currentUser.id 或 role==='admin' 可维护） */
  currentUser: { id: string; role: string } | null;

  /** 项目管理流程回调：当审查中所有问题确认后，点击「审查结束」时触发。 */
  onReviewComplete: ((task: ReviewTask) => Promise<void>) | null;
}

export const TenderReviewContext = createContext<TenderReviewContextValue | null>(null);

export function useTenderReview() {
  const ctx = useContext(TenderReviewContext);
  if (!ctx) {
    throw new Error('useTenderReview must be used within TenderReviewProvider');
  }
  return ctx;
}
