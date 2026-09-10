'use client';

import { useEffect, useState } from 'react';
import { portalURL } from '@water-erp/config';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowTrack, FlowBackdrop, type StageData } from '@/components/flow-stage';

/* 采购全流程 —— 与系统「项目管理」九阶段（apps/web/src/lib/types/project-management.ts 的
   PROJECT_WORKFLOW_STAGES_ALL）一字不差；各阶段描述对应系统真实功能（AI 文件解析、
   供应商智能选取、评标专家库抽取、:3007 在线开评标、哈希归档）。
   五种采购方式（谈判/竞价/询比/邀请招标/直接采购）按 METHOD_STAGE_TEMPLATES 各自裁剪。 */
const STAGES: StageData[] = [
  { no: '01', en: 'DEMAND', title: '采购需求', color: '#7ec8e3', desc: '申请部门上传采购需求申请表，AI 自动解析文件内容、提炼立项事由与供方要求，归集生成需求台账。', roles: ['申请部门', 'AI 辅助'] },
  { no: '02', en: 'INITIATION', title: '采购立项', color: '#a3d9a5', desc: '填报预算金额、采购方式与采购类别，上传采购立项申请表，审批流转全程留痕可追溯。', roles: ['申请部门', '采购中心'] },
  { no: '03', en: 'DOCUMENT', title: '采购文件', color: '#c4b5e3', desc: '在线编制招标/采购文件，AI 辅助生成条款并校验合规，同步编制评分标准与得分点。', roles: ['采购中心'] },
  { no: '04', en: 'INVITATION', title: '供应商邀请', color: '#7dd3d6', desc: 'AI 按业务标签从供应商库智能选取候选供应商，逐家发送邀请通知，供应商 24 小时内回执确认参加。', roles: ['采购中心', 'AI 辅助'] },
  { no: '05', en: 'ANNOUNCEMENT', title: '采购公告公示', color: '#f9c7a1', desc: '信息发布中心发布招标公告，同步公共门户与供应商门户，供应商在线获取采购商机。', roles: ['采购中心'] },
  { no: '06', en: 'SELECTION', title: '专家抽取', color: '#f5a3b7', desc: '按专业配额从评标专家库随机抽取正选与候补专家，自动发送通知并确认出席开标。', roles: ['采购中心', '评审专家'] },
  { no: '07', en: 'EVALUATION', title: '开标评标', color: '#b0c4f0', desc: '开评标管理端在线开标：远程解密、唱标、异议处理；评审专家独立打分，AI 辅助评标与澄清答疑。', roles: ['开标主持', '评审专家'] },
  { no: '08', en: 'AWARD', title: '定标', color: '#f7d48b', desc: '汇总评分生成评标结果与排名，完成定标审批，推送中标通知书并由中标供应商在线签收。', roles: ['采购中心'] },
  { no: '09', en: 'CONTRACT', title: '合同', color: '#9fd9d3', desc: '签订合同并跟踪履约，全流程资料完整归档，哈希校验与监管追溯保障档案真实可信。', roles: ['采购中心', '申请部门'] },
];

export default function ProcurementPortalPage() {
  // 采购管理端入口：直连 :3005 登录页（与首页「采购管理端」卡片同款口径）。
  // portalURL SSR 阶段无 window → 返回 localhost，须等客户端挂载后再取值，
  // 否则局域网设备经 192.168.x 访问时链接会错指 localhost。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const WEB_URL = process.env.NEXT_PUBLIC_WEB_PORTAL_URL ?? portalURL('web', '/login?forceLogin=1');

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
          <img src="/assets/logo.png" alt="四川省水利发展集团有限公司" className="flow-hero-brand-logo" />
          <strong className="flow-hero-brand-name">四川省水利发展集团有限公司</strong>
          <small className="flow-hero-brand-sub">SICHUAN WATER DEVELOPMENT GROUP CO.,LTD.</small>
        </div>
      </section>

      <div className="flow-pipe-shell flow-rise-4">
        <div className="flow-pipe-shell-head">
          <h2>采购全流程图谱</h2>
          <span className="text-[13px] text-[#7d8798]">与系统「项目管理」九阶段一致 · 谈判/竞价/询比/邀请招标/直接采购按方式裁剪阶段</span>
        </div>
        <FlowTrack stages={STAGES} accent="brand" />
      </div>

      <div className="flow-cta flow-rise-4">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <h3>开启阳光采购</h3>
            <p>登录采购管理平台，发起项目、编制文件、组织开评标。</p>
          </div>
          <a href={mounted ? WEB_URL : '#'} className="flow-cta-btn no-underline text-white">
            登录采购管理平台
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-cta-arrow"><path d="M9 18l6-6-6-6"/></svg>
          </a>
        </div>
      </div>
    </div>
  );
}
