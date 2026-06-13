'use client';

import { useRouter } from 'next/navigation';
import { FlowHeader } from '@/components/flow-header';
import { FlowRiver } from '@/components/flow-river';
import { FlowTrack, FlowBackdrop, type StageData } from '@/components/flow-stage';

const STAGES: StageData[] = [
  {
    no: '01', en: 'DEMAND · 需求申报', title: '采购需求申报',
    desc: '业务单位在线提交采购需求，明确采购品目、预算金额与实施时间，系统自动归集并生成需求台账。',
    roles: ['需求部门', '归口管理'],
  },
  {
    no: '02', en: 'BUDGET · 预算审批', title: '预算审核批准',
    desc: '归口管理部门与财务部门对预算来源、金额合理性进行联合审核，全程留痕、可追溯。',
    roles: ['归口管理', '财务部'],
  },
  {
    no: '03', en: 'METHOD · 方式确定', title: '采购方式选定',
    desc: '依据项目金额与性质，系统智能推荐采购方式 —— 公开招标、邀请招标、竞争性谈判、询价或单一来源。',
    roles: ['采购管理'],
  },
  {
    no: '04', en: 'DOCUMENT · 文件编制', title: '采购文件编制',
    desc: '在线编制采购文件与评审标准，AI 辅助生成条款与评分细则，模板复用、一键校验合规性。',
    roles: ['采购管理', 'AI 辅助'],
  },
  {
    no: '05', en: 'PUBLISH · 公告发布', title: '招标公告发布',
    desc: '平台一键发布招标公告，同步推送至供应商库与公共门户，定向触达合格供应商。',
    roles: ['采购管理'],
  },
  {
    no: '06', en: 'OPENING · 在线开标', title: '远程在线开标',
    desc: '电子开标、投标文件远程解密，开标过程全程音视频留痕，主持人、监督人在线见证。',
    roles: ['开标主持', '监督人'],
  },
  {
    no: '07', en: 'EVALUATION · 专家评审', title: '专家在线评审',
    desc: '评审专家在线独立打分，AI 异常检测实时预警围标串标、报价异常，确保评审公平公正。',
    roles: ['评审专家', 'AI 检测'],
  },
  {
    no: '08', en: 'AWARD · 定标公示', title: '定标结果公示',
    desc: '确定中标候选人并发布中标结果公示，公示期内接受异议与质疑，公示无异议后定标。',
    roles: ['采购管理', '定标委员会'],
  },
  {
    no: '09', en: 'ARCHIVE · 合同归档', title: '合同签订归档',
    desc: '在线签订采购合同，履约过程跟踪、验收评价闭环，电子归档与供应商信用归集。',
    roles: ['采购管理', '合同管理'],
  },
];

export default function ProcurementPortalPage() {
  const router = useRouter();
  return (
    <div className="flow-page">
      <FlowBackdrop />

      <FlowHeader label="PROCUREMENT · 采购管理" />

      {/* ════ Hero ════ */}
      <section className="flow-hero">
        <span className="flow-eyebrow">四川水发 · 采购全流程</span>
        <h1 className="flow-title">九阶流程 · 阳光采购<br />全程在线 · 合规高效</h1>
        <p className="flow-sub">
          从需求申报到合同归档，智慧水发·蜀水云采构建覆盖采购全生命周期的数字化流程。
          每一个环节在线流转、数据留痕、智能辅助，让采购更阳光、更高效、更合规。
        </p>
        <div className="mt-12">
          <FlowRiver accent="brand" />
        </div>
      </section>

      {/* ════ Metrics ════ */}
      <div className="flow-metrics">
        {[
          { num: '9', suffix: '阶', label: '标准化采购流程' },
          { num: '5', suffix: '种', label: '法定采购方式' },
          { num: '100', suffix: '%', label: '全流程在线留痕' },
          { num: '24', suffix: 'h', label: 'AI 智能辅助响应' },
        ].map((m) => (
          <div key={m.label} className="flow-metric">
            <span className="flow-metric-num">{m.num}<em>{m.suffix}</em></span>
            <span className="flow-metric-label">{m.label}</span>
          </div>
        ))}
      </div>

      {/* ════ 横向流程图谱 ════ */}
      <div className="flow-section-head">
        <h2>采购全流程图谱</h2>
        <p>SWIPE / SCROLL / DRAG · 横向拖拽浏览九大环节</p>
      </div>

      <FlowTrack stages={STAGES} accent="brand" />

      {/* ════ CTA ════ */}
      <div className="flow-cta">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div className="max-w-xl">
            <h3>开启阳光采购</h3>
            <p>采购管理人员登录后即可进入采购管理平台，发起项目、编制文件、组织开评标。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => router.push('/login')} className="flow-cta-btn">
              登录采购管理平台
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="8" x2="13" y2="8"/><polyline points="9 4 13 8 9 12"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
