import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  COMPETITIVE_NEGOTIATION_SECTIONS,
  createEmptyCompetitiveNegotiationDraft,
  createEmptySingleSourceDraft,
  SINGLE_SOURCE_SECTIONS,
  TENDER_DOCUMENT_TYPES,
} from '../../lib/tender-write/templates';
import {
  buildTenderSectionProgress,
  getAdjacentTenderSectionKey,
} from '../../lib/tender-write/progress';
import { TenderWriteWorkspace } from './tender-write-workspace';

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

const draft = createEmptyCompetitiveNegotiationDraft();
const progress = buildTenderSectionProgress(
  COMPETITIVE_NEGOTIATION_SECTIONS,
  draft,
  COMPETITIVE_NEGOTIATION_SECTIONS[0].key,
);

draft.projectName = '示例项目';
draft.coverDate = '2026-05-11';
draft.projectOverview = '项目概况';

const updatedProgress = buildTenderSectionProgress(
  COMPETITIVE_NEGOTIATION_SECTIONS,
  draft,
  COMPETITIVE_NEGOTIATION_SECTIONS[1].key,
);

assert(progress.length === COMPETITIVE_NEGOTIATION_SECTIONS.length, '进度结果数量应与章节数量一致');
assert(progress[0]?.state === 'active-missing', '首章节默认应为当前且存在缺失项');
assert(updatedProgress[0]?.state === 'completed', '封面章节填满后应显示已完成');
assert(updatedProgress[1]?.state === 'active-missing', '第二章节应成为当前缺失状态');
assert(
  getAdjacentTenderSectionKey(COMPETITIVE_NEGOTIATION_SECTIONS, COMPETITIVE_NEGOTIATION_SECTIONS[0].key, 1) ===
    COMPETITIVE_NEGOTIATION_SECTIONS[1].key,
  '下一章节定位不正确',
);
assert(
  COMPETITIVE_NEGOTIATION_SECTIONS.map((section) => section.key).join(',') ===
    'cover,invitation,summary,supplier,contract',
  '预览锚点顺序必须与章节顺序一致',
);

const completedItems = updatedProgress.filter((item) => item.state === 'completed');
assert(completedItems.length === 1, '当前草稿下应只有一个章节被判定为已完成');

draft.paymentRequirement = '分阶段付款';
draft.acceptanceCriteria = '按成果验收';
draft.paymentProgress = '提交后 30 日内付款';

const workspaceHtml = renderToStaticMarkup(
  <TenderWriteWorkspace
    draft={draft}
    selectedMeta={TENDER_DOCUMENT_TYPES[0]}
    activeSectionKey="contract"
    onSectionSelect={() => {}}
    onChange={() => {}}
  />,
);

assert(workspaceHtml.includes('data-tender-panel="nav"'), '左侧导航面板标记缺失');
assert(workspaceHtml.includes('data-tender-panel="editor"'), '中间编辑面板标记缺失');
assert(workspaceHtml.includes('data-tender-panel="preview"'), '右侧预览面板标记缺失');
assert(workspaceHtml.includes('采购内容与合同条款'), '中间编辑列未切换到当前章节');
assert(workspaceHtml.includes('当前定位：采购内容与合同条款'), '右侧预览未同步当前章节定位');

const singleSourceMeta = TENDER_DOCUMENT_TYPES.find(
  (item) => item.type === 'SINGLE_SOURCE',
);
const singleSourceDraft = createEmptySingleSourceDraft();
const singleSourceProgress = buildTenderSectionProgress(
  SINGLE_SOURCE_SECTIONS,
  singleSourceDraft,
  SINGLE_SOURCE_SECTIONS[0].key,
);

assert(singleSourceMeta?.label === '单源直接采购', 'SINGLE_SOURCE 前端显示名应为单源直接采购');
assert(singleSourceMeta?.availability === 'ready', 'SINGLE_SOURCE 应标记为可用');
assert(
  SINGLE_SOURCE_SECTIONS.map((section) => section.key).join(',') ===
    'cover,invitation,terms,procurement,contract,response',
  '单源直接采购章节顺序不正确',
);
assert(singleSourceProgress.length === SINGLE_SOURCE_SECTIONS.length, '单源直接采购进度数量应与章节数量一致');
assert(singleSourceDraft.contractText === '', '单源直接采购空草稿应初始化合同文本字段');

console.log('tender-write-workspace-check:ok');
