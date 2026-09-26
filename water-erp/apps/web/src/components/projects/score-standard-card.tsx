'use client';

import { FileText, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ProjectManagementAttachment, ProjectManagementItem } from '@/lib/types/project-management';
import { ensureBidProject, type BidProjectDetail, type BidProjectRef } from '@/lib/api/bid';
import { ScoreStandardEditor } from './score-standard/score-standard-editor';
import { EvaluationBasisFields } from './price-config-card';
import { SectionCard } from './section-card';

type Props = {
  project: ProjectManagementItem;
  /** 该 03 行（采购文件步骤）所属轮次——多轮再次采购各轮独立 */
  round: number;
  /** 只读解析出的该轮 BidProject 概要；null=未关联（触发挂载副作用进入即绑定）。
   *  prop 本身仍来自只读 bid-project-refs（父级展示/轮询链不懒创建）；ensure 触发点只在本卡
   *  挂载副作用与重试——面板由「评分标准」按钮显式打开=明确配置意图，非展示层静默懒建。 */
  bidProject: BidProjectRef | null;
  /** GET /bid/projects/:id 详情（未拉到时回退 ref 只读兜底，同面板原行为） */
  detail: BidProjectDetail | null;
  /** 价格类评分项数量（undefined=数据未就绪不提示；0=提示公式暂不参与计分） */
  priceItemCount?: number;
  /** AI 提取源（2026-09-26 双入口分流）：显式对象=03 完成向导（固定正式盖章版 OCR）；
   *  undefined=「评分标准」按钮面板（自动解析，多文件时弹选择器由用户指定）。 */
  extractSource?: { attachmentId: string; fileName: string } | null;
  /** 该轮「采购文件」步骤附件（extractSource 未定时作提取源候选） */
  tenderCandidates?: ProjectManagementAttachment[];
  onChanged: () => void;
};

/**
 * 评分标准与评标办法卡（2026-09-24 自开标确认面板迁至 03「采购文件」；2026-09-26 进入即绑定）。
 * 三子块与锁定判定零改动沿用现状；该轮无 BP 时打开面板即 ensure 建关联并直接进入配置态
 * （原空态长文+「创建开评标项目并开始配置」二跳已撤，用户裁定 03 本阶段直接绑定即配；
 * 04 公告发布/邀请 syncBidProject 关联同一 BP 不双建，保留为未开面板者的兜底路径）。
 */
export function ScoreStandardCard({ project, round, bidProject, detail, priceItemCount, extractSource, tenderCandidates, onChanged }: Props) {
  const [linkError, setLinkError] = useState<string | null>(null);
  /** 防同轮重复触发（StrictMode 双挂载）；换轮=面板经 null 态重挂载，新实例 ref 清零 */
  const attemptedRoundRef = useRef<number | null>(null);

  /** 尾段保护：该轮开标评标已完成却仍无 BP（遗留/归档数据，未走过 04 公告 ensure 链）——
   *  不自动建，避免给已完结项目凭空造 SUBMIT 幽灵 BP；正常流程 04 发布公告/邀请时
   *  syncBidProject 已建同一 BP，此分支只兜历史数据。 */
  const roundEvaluated = (project.stages ?? []).some(
    (s) => s.stageKey === 'BID_EVALUATION' && (s.round ?? 1) === round && s.status === 'COMPLETED',
  );

  async function linkNow() {
    setLinkError(null);
    try {
      await ensureBidProject(project.id, round); // 幂等：(itemId, round) 查重
      toast.success('已创建并关联开评标项目，可开始配置评分标准与评标办法');
      onChanged(); // 触发抽屉级重拉 refs → bidProject 落地前由 loading 分支兜住（防空文闪现）
    } catch (e: any) {
      setLinkError(e?.message || '关联开评标项目失败');
    }
  }

  useEffect(() => {
    if (bidProject || roundEvaluated || attemptedRoundRef.current === round) return;
    attemptedRoundRef.current = round;
    void linkNow();
    // 故意不在 cleanup 里取消在途请求：StrictMode 双挂载/面板中途关闭时 toast 与 onChanged
    // 仍应落地（onChanged 只驱动父级重拉，幂等无害；unmount 后 setState 为 no-op）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidProject, roundEvaluated, round]);

  return (
    <SectionCard
      icon={<FileText size={14} />}
      title={`评分标准与评标办法${round > 1 ? `（第 ${round} 轮）` : ''}`}
      accent="var(--stage-evaluation)"
      accentSoft="var(--stage-evaluation-soft)"
    >
      {!bidProject ? (
        roundEvaluated ? (
          <p className="text-xs leading-6 text-[var(--muted-foreground)]">
            该轮开标评标已完成，但未关联开评标项目（历史数据）。为避免产生不一致数据，此处不再自动创建；如需补建请经公告/邀请发布流程关联。
          </p>
        ) : linkError ? (
          <div className="space-y-3">
            <p className="text-xs leading-6 text-[var(--muted-foreground)]">关联开评标项目失败：{linkError}</p>
            <div className="flex justify-end">
              <button type="button" className="neu-btn-primary !h-[34px] !text-xs" onClick={() => void linkNow()}>
                重试
              </button>
            </div>
          </div>
        ) : (
          // 含 ensure 已成功、等父级重拉 refs 落 prop 的窗口——统一显示关联中
          <p className="flex items-center gap-2 text-xs leading-6 text-[var(--muted-foreground)]">
            <Loader2 size={14} className="animate-spin" />
            正在关联开评标项目…
          </p>
        )
      ) : (
        <div className="space-y-4">
          {/* ① 评标口径：评标办法 + 最高限价 + 价格分计算方式（2026-09-26 公式表单化并入本块；EVALUATING 起锁定） */}
          <div>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
              评标办法与最高限价
            </h4>
            <EvaluationBasisFields detail={detail ?? bidProject} onChanged={onChanged} priceItemCount={priceItemCount} />
          </div>
          {/* ② 评分项与得分点（OPENING 起锁定；发布后开标前仍可改，改即作废发布） */}
          <hr className="wb-section-rule" />
          <div>
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
              评分项与得分点
            </h4>
            <ScoreStandardEditor
              project={project}
              round={round}
              bidProject={bidProject}
              onChanged={onChanged}
              variant="embedded"
              extractSource={extractSource}
              tenderCandidates={tenderCandidates}
            />
          </div>
          {/* ③ 价格分公式参数——已于 2026-09-26 表单化并入①（原裸 JSON 高级区撤销） */}
        </div>
      )}
    </SectionCard>
  );
}
