'use client';

import { useRouter } from 'next/navigation';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowTrack, FlowBackdrop, type StageData } from '@/components/flow-stage';

const STAGES: StageData[] = [
  { no: '01', en: 'DEMAND', title: '需求申报', color: '#7ec8e3', desc: '在线提交采购需求，明确品目、预算与实施时间，系统自动归集生成需求台账。', roles: ['需求部门', '归口管理'] },
  { no: '02', en: 'BUDGET', title: '预算审批', color: '#a3d9a5', desc: '归口管理与财务联合审核预算来源与金额合理性，全程留痕可追溯。', roles: ['归口管理', '财务部'] },
  { no: '03', en: 'METHOD', title: '方式选定', color: '#c4b5e3', desc: '依据金额与性质，系统智能推荐采购方式：公开招标、邀请招标、谈判采购、询价或单一来源。', roles: ['采购管理'] },
  { no: '04', en: 'DOCUMENT', title: '文件编制', color: '#7dd3d6', desc: '在线编制采购文件与评审标准，AI 辅助生成条款，模板复用、一键校验合规。', roles: ['采购管理', 'AI 辅助'] },
  { no: '05', en: 'PUBLISH', title: '公告发布', color: '#f9c7a1', desc: '一键发布采购公告，同步推送供应商库与公共门户，定向触达合格供应商。', roles: ['采购管理'] },
  { no: '06', en: 'OPENING', title: '在线开标', color: '#f5a3b7', desc: '电子开标、远程解密，全程音视频留痕，主持人与监督人在线见证。', roles: ['开标主持', '监督人'] },
  { no: '07', en: 'EVALUATION', title: '专家评审', color: '#b0c4f0', desc: '专家在线独立打分，AI 异常检测实时预警围标串标、报价异常。', roles: ['评审专家', 'AI 检测'] },
  { no: '08', en: 'AWARD', title: '定标公示', color: '#f7d48b', desc: '确定中标候选人并发布公示，公示期内接受异议，无异议后定标。', roles: ['采购管理', '定标委员会'] },
  { no: '09', en: 'ARCHIVE', title: '合同归档', color: '#9fd9d3', desc: '在线签订合同，履约跟踪、验收评价闭环，电子归档与供应商信用归集。', roles: ['采购管理', '合同管理'] },
];

export default function ProcurementPortalPage() {
  const router = useRouter();

  return (
    <div className="flow-page">
      <FlowBackdrop />
      <UnifiedHeader announcements={[]} onLoginClick={() => {}} onRegisterClick={() => {}} />

      <div className="relative z-10 px-[clamp(28px,4vw,72px)] pt-3">
        <a href="/" className="flow-back">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-back-arrow"><path d="M15 18l-6-6 6-6"/></svg>
          返回首页
        </a>
      </div>

      <section className="flow-hero-brand">
        <div className="flow-hero-brand-left flow-rise-1" style={{ gridColumn: '1 / -1' }}>
          <img src="/assets/logo.png" alt="四川水发集团" className="flow-hero-brand-logo" />
          <strong className="flow-hero-brand-name">四川水发集团</strong>
          <small className="flow-hero-brand-sub">SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.</small>
        </div>
      </section>

      <div className="flow-pipe-shell flow-rise-4">
        <div className="flow-pipe-shell-head">
          <h2>采购全流程图谱</h2>
        </div>
        <FlowTrack stages={STAGES} accent="brand" />
      </div>

      <div className="flow-cta flow-rise-4">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <h3>开启阳光采购</h3>
            <p>登录采购管理平台，发起项目、编制文件、组织开评标。</p>
          </div>
          <button onClick={() => router.push('/login')} className="flow-cta-btn">
            登录采购管理平台
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="8" x2="13" y2="8"/><polyline points="9 4 13 8 9 12"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
