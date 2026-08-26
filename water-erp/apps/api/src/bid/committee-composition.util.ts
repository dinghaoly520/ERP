import { BadRequestException } from '@nestjs/common';

/**
 * W5（CTS-EBS01 B-020/021/022）：评标委员会组成法定校验（参数化）。
 * - B-020：成员 5 人以上单数（水利工程 7 人以上单数——B-022）；小项目底线 3 人（暂行规定第九条）
 * - B-021：技术经济专家（非采购人代表）≥ 成员总数 2/3
 * 自 bid.service 启动评标处抽出的纯函数，供水利/非水利阈值切换复用。
 */

/** 默认法定下限（B-020） */
export const MIN_COMMITTEE_DEFAULT = 5;
/** 水利工程建设项目下限（B-022，★★★） */
export const MIN_COMMITTEE_WATER = 7;
/** 小项目底线（无论类别） */
export const MIN_COMMITTEE_SMALL = 3;

/** 水利类项目识别：PMI 采购类别含「水利」或项目名命中水利关键词。 */
const WATER_NAME_RE = /水库|水电|水利|灌区|水电站|枢纽|堤防|引水/;
export function isWaterProject(
  pmi: { procurementCategory?: string | null } | null | undefined,
  projectName?: string | null,
): boolean {
  if (pmi?.procurementCategory?.includes('水利')) return true;
  return !!projectName && WATER_NAME_RE.test(projectName);
}

export interface CommitteeCounts {
  /** 已确认正选专家总数 */
  confirmed: number;
  /** 其中采购人代表数 */
  representatives: number;
}

/** 校验不合法直接抛 BadRequestException（错误码与既有口径一致）。 */
export function assertCommitteeComposition(
  counts: CommitteeCounts,
  opts: { minSize?: number; smallProjectExempt?: boolean } = {},
) {
  const minSize = opts.minSize ?? MIN_COMMITTEE_DEFAULT;
  // 小项目例外：恰为 3 人时放行（暂行规定第九条）。水利工程（B-022）按严格口径不适用例外。
  const smallExempt = opts.smallProjectExempt ?? (minSize === MIN_COMMITTEE_DEFAULT);
  const { confirmed, representatives } = counts;

  if (confirmed < MIN_COMMITTEE_SMALL) {
    throw new BadRequestException({
      error: `评标委员会已确认正选专家仅 ${confirmed} 人，依法须 ${minSize} 人以上单数（小项目不少于 ${MIN_COMMITTEE_SMALL} 人）`,
      code: 'INSUFFICIENT_COMMITTEE_SIZE',
    });
  }
  if (confirmed < minSize && !(smallExempt && confirmed === MIN_COMMITTEE_SMALL)) {
    throw new BadRequestException({
      error: `评标委员会已确认正选专家 ${confirmed} 人，本项目依法须 ${minSize} 人以上单数`,
      code: 'INSUFFICIENT_COMMITTEE_SIZE',
    });
  }
  if (confirmed % 2 === 0) {
    throw new BadRequestException({
      error: `评标委员会已确认正选专家 ${confirmed} 人，须为单数`,
      code: 'EVEN_COMMITTEE_SIZE',
    });
  }
  // B-021：评审专家（非采购人代表）≥ 2/3
  if ((confirmed - representatives) * 3 < confirmed * 2) {
    throw new BadRequestException({
      error: `评审专家（非采购人代表）${confirmed - representatives}/${confirmed} 人，依法不得少于成员总数的三分之二`,
      code: 'COMMITTEE_RATIO',
    });
  }
}
