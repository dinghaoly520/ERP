'use client';

import { FileText, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { ensureBidProject, type BidProjectDetail, type BidProjectRef } from '@/lib/api/bid';
import { ScoreStandardEditor } from './score-standard/score-standard-editor';
import { EvaluationBasisFields } from './price-config-card';
import { SectionCard } from './section-card';

type Props = {
  project: ProjectManagementItem;
  /** 该 03 行（采购文件步骤）所属轮次——多轮再次采购各轮独立 */
  round: number;
  /** 只读解析出的该轮 BidProject 概要；null=未关联（空态指引）。
   *  绝不在此触发懒创建：ScoreStandardEditor 在 bidProject 为空时会走
   *  ensureBidProject 兜底建 SUBMIT 项目——未关联时必须整卡降级为空态。 */
  bidProject: BidProjectRef | null;
  /** GET /bid/projects/:id 详情（未拉到时回退 ref 只读兜底，同面板原行为） */
  detail: BidProjectDetail | null;
  /** 价格类评分项数量（undefined=数据未就绪不提示；0=提示公式暂不参与计分） */
  priceItemCount?: number;
  onChanged: () => void;
};

/**
 * 评分标准与评标办法卡（2026-09-24 方案 v2：自开标确认面板迁至项目管理 03「采购文件」）。
 * 三子块与锁定判定零改动沿用现状；空态按采购方式给指引（谈判采购走邀请分支，
 * 其余走公告+关联本项目——不关联的直建发布会另建独立项目，本项目仍无关联）。
 */
export function ScoreStandardCard({ project, round, bidProject, detail, priceItemCount, onChanged }: Props) {
  const [creating, setCreating] = useState(false);

  /** 显式创建开评标项目（用户点击=明确意图，非展示层误建）：本阶段即可配置评分标准；
   *  04 公告发布/邀请时 syncBidProject 会关联同一 BP（不双建）；不创建也不影响完成本阶段（方案 E） */
  async function createAndConfigure() {
    setCreating(true);
    try {
      await ensureBidProject(project.id, round);
      toast.success('开评标项目已创建，可开始配置评分标准与评标办法');
      onChanged(); // 触发抽屉级重拉 → 卡片进入可配置态
    } catch (e: any) {
      toast.error(e?.message || '创建开评标项目失败');
    } finally {
      setCreating(false);
    }
  }

  return (
    <SectionCard
      icon={<FileText size={14} />}
      title={`评分标准与评标办法${round > 1 ? `（第 ${round} 轮）` : ''}`}
      accent="var(--stage-evaluation)"
      accentSoft="var(--stage-evaluation-soft)"
    >
      {!bidProject ? (
        <div className="space-y-3">
          <p className="text-xs leading-6 text-[var(--muted-foreground)]">
            尚未关联开评标项目——评分标准与评标办法依托开评标项目配置。现在创建即可在本阶段完成配置；也可在本阶段完成后，经「{project.procurementMethod === '谈判采购' ? '供应商邀请' : '采购公告公示'}」步骤{project.procurementMethod === '谈判采购' ? '发送邀请' : '发布公告'}时自动创建（启动评标前系统将强制校验配置完整）。
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              className="neu-btn-primary !h-[34px] !text-xs"
              onClick={() => void createAndConfigure()}
              disabled={creating}
            >
              {creating ? (<><Loader2 size={14} className="animate-spin" />创建中…</>) : '创建开评标项目并开始配置'}
            </button>
          </div>
        </div>
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
            />
          </div>
          {/* ③ 价格分公式参数——已于 2026-09-26 表单化并入①（原裸 JSON 高级区撤销） */}
        </div>
      )}
    </SectionCard>
  );
}
