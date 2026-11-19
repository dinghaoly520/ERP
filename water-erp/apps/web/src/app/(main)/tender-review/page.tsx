'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { FileSearch, FileText, Database } from 'lucide-react';
import { TenderReviewProvider } from '@/components/tender-review/tender-review-provider';
import { useTenderReview } from '@/components/tender-review/use-tender-review';
import TenderReviewWorkspace from '@/components/tender-review/tender-review-workspace';

const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** hero 右侧统计徽标已删（2026-11-19 用户裁定）：「进行中 N」胶囊移除——
 *  底部 TaskQueueBar 已有更齐全的进行中任务展示。 */
import ReportContextBar from '@/components/tender-review/report-context-bar';
import KbContextBar from '@/components/tender-review/kb-context-bar';

/** hero 右区（2026-11-18）：视图按钮组——报告详情打开时保持不变，
 *  上下文条改挂 hero 第二行（HeroContextRow）。 */
function HeroRight() {
  return (
    <div className="page-hero__right">
      <HeroTabButtons />
    </div>
  );
}

/** hero 第二行（2026-11-18 二次裁定；2026-11-19 扩为统一下钻上下文位）：
 *  报告详情 → ReportContextBar（返回+文件名+导出）；知识库下钻（文件/规则管理子页）→
 *  KbContextBar（返回+库身份+子页互切）；均落在 hairline 下——即 /tender-write
 *  「谈判采购/竞价采购/邀请招标」类型切换位；未下钻时渲染标准 page-hero__divider 收尾。 */
function HeroContextRow() {
  const {
    activeTab,
    selectedReportTask,
    setSelectedReportTask,
    refreshTasks,
    selectedKbId,
    knowledgeBases,
    setActiveTab,
  } = useTenderReview();
  // 知识库下钻子页：返回 + 库身份 + 文件/规则互切（2026-11-19）
  const kb = knowledgeBases.find((k) => k.id === selectedKbId);
  if ((activeTab === 'files' || activeTab === 'rules') && kb) {
    return (
      <div className="mt-3 pt-2" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
        <KbContextBar
          kb={kb}
          activeView={activeTab}
          onView={setActiveTab}
          onBack={() => setActiveTab('kb')}
        />
      </div>
    );
  }
  if (!(activeTab === 'reports' && selectedReportTask)) {
    return <div className="page-hero__divider" />;
  }
  return (
    <div className="mt-3 pt-2" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
      <ReportContextBar
        task={selectedReportTask}
        onBack={() => {
          setSelectedReportTask(null);
          void refreshTasks();
        }}
      />
    </div>
  );
}

/** hero 右上视图按钮组（2026-11-18 用户裁定）：审查执行/审查报告/知识库 三钮，
 *  对齐 /tender-write「导入识别/公告/通知书」同款 neu-btn-soft+图标形态；激活钮 is-primary 白瓷。
 *  「知识库」为中心管理视图入口（文件/规则管理为其下级上下文视图，激活时知识库钮保持高亮——
 *  点按即回知识库列表）。取代早前 segment 方案（同日二次裁定）。 */
function HeroTabButtons() {
  const { activeTab, setActiveTab } = useTenderReview();
  const kbActive = activeTab === 'kb' || activeTab === 'files' || activeTab === 'rules';
  const btn = (active: boolean) =>
    `neu-btn-soft ${active ? 'is-primary pointer-events-none' : ''}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => setActiveTab('review')} className={btn(activeTab === 'review')}>
        <FileSearch size={14} />审查执行
      </button>
      <button type="button" onClick={() => setActiveTab('reports')} className={btn(activeTab === 'reports')}>
        <FileText size={14} />审查报告
      </button>
      <button type="button" onClick={() => setActiveTab('kb')} className={btn(kbActive)}>
        <Database size={14} />知识库
      </button>
    </div>
  );
}

export default function TenderReviewPage() {
  const reducedMotion = useReducedMotion() ?? false;

  const fadeIn = (index: number) => {
    if (reducedMotion) return { initial: {}, animate: {}, transition: { duration: 0 } };
    return {
      initial: { opacity: 0, y: 16 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.4, delay: index * 0.08, ease: easeOutQuint },
    };
  };

  return (
    <TenderReviewProvider>
      <motion.div {...fadeIn(0)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="page-hero mb-5 !rounded-[16px] shrink-0">
          <div className="page-hero__row">
            <div className="page-hero__left">
              <div className="page-hero__icon">
                <FileSearch size={17} strokeWidth={1.9} />
              </div>
              <div>
                <div className="page-hero__title">采购文件审查</div>
                <div className="page-hero__sub">上传采购文件，自动比对合规规则并生成审查意见</div>
              </div>
            </div>
            <HeroRight />
          </div>
          {/* 第二行：报告详情上下文条（tender-write 类型切换位）/ 未开详情时标准 hairline */}
          <HeroContextRow />
        </div>
        <TenderReviewWorkspace />
      </motion.div>
    </TenderReviewProvider>
  );
}
