'use client';

import { useEffect, useState } from 'react';
import { portalURL } from '@water-erp/config';
import { STAGE_LABEL, STAGE_COLOR } from '@water-erp/shared';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowTrack, FlowBackdrop, type StageData } from '@/components/flow-stage';

/* 投标全流程 —— 中段五步直接取系统投标项目阶段机的权威定义
   （@water-erp/shared STAGE_LABEL/STAGE_COLOR：文件下载→加密投递→在线开标→专家评标→资料归档），
   首尾衔接供应商门户真实能力：注册审核入库（用户名=统一社会信用代码）、邀请回执确认（24h 链接）、
   双信封加密投递（技术标/商务标/投标函/保证金，截标=开标前24小时）、中标通知书在线签收。 */
const STAGES: StageData[] = [
  { no: '01', en: 'REGISTER', title: '注册入库', color: '#7ec8e3', desc: '供应商门户在线注册：填报企业信息、资质证书与联系人（用户名即统一社会信用代码），平台审核通过后正式入库。', roles: ['供应商', '平台审核'] },
  { no: '02', en: 'DISCOVER', title: '获取商机', color: '#a3d9a5', desc: '浏览公共门户与供应商门户的招标公告；受邀供应商收到通知与回执链接，24 小时内确认是否参加。', roles: ['供应商'] },
  { no: '03', en: 'DOWNLOAD', title: STAGE_LABEL.DOWNLOAD, color: STAGE_COLOR.DOWNLOAD, desc: '供应商门户在线下载采购文件，研读资格条件、技术与商务要求，做好投标准备。', roles: ['供应商'] },
  { no: '04', en: 'SUBMIT', title: STAGE_LABEL.SUBMIT, color: STAGE_COLOR.SUBMIT, desc: '双信封加密投递技术标、商务标、投标函与保证金四类文件；投标截止为开标前 24 小时，逾期自动锁定。', roles: ['供应商'] },
  { no: '05', en: 'OPENING', title: STAGE_LABEL.OPENING, color: STAGE_COLOR.OPENING, desc: '远程在线见证投标文件解密与唱标过程，可对开标记录提出异议，由开标主持人在线处理。', roles: ['供应商', '开标主持'] },
  { no: '06', en: 'EVALUATING', title: STAGE_LABEL.EVALUATING, color: STAGE_COLOR.EVALUATING, desc: '评审专家按资格审查、响应性、商务、技术、价格五类独立打分，供应商在线响应澄清答疑要求。', roles: ['评审专家', '供应商'] },
  { no: '07', en: 'RESULT', title: '结果查询', color: '#f7d48b', desc: '评标结果与中标通知书在供应商门户查询，中标供应商在线签收中标通知书。', roles: ['供应商'] },
  { no: '08', en: 'ARCHIVED', title: STAGE_LABEL.ARCHIVED, color: STAGE_COLOR.ARCHIVED, desc: '项目资料完整归档，履约情况计入供应商信用档案，作为后续选取与评价依据。', roles: ['采购中心', '供应商'] },
];

export default function BiddingHallPage() {
  // 供应商端入口：直连 :3004 登录/注册页（与首页「供应商端」卡片同款口径）。
  // portalURL SSR 阶段无 window → 返回 localhost，须等客户端挂载后再取值。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const SUPPLIER_LOGIN_URL = process.env.NEXT_PUBLIC_SUPPLIER_PORTAL_URL ?? portalURL('supplier', '/login?forceLogin=1');
  const SUPPLIER_REGISTER_URL = portalURL('supplier', '/register');

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
          <h2>供应商投标全流程图谱</h2>
          <span className="text-[13px] text-[#7d8798]">中段与系统投标项目阶段机一致：文件下载 → 加密投递 → 在线开标 → 专家评标 → 资料归档</span>
        </div>
        <FlowTrack stages={STAGES} accent="water" />
      </div>

      <div className="flow-cta flow-rise-4">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <h3>成为水发供应商</h3>
            <p>注册入驻供应商库，参与四川省水利发展集团有限公司全量采购项目投标。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href={mounted ? SUPPLIER_REGISTER_URL : '#'} className="flow-cta-btn no-underline text-white">
              立即注册供应商
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flow-cta-arrow"><path d="M9 18l6-6-6-6"/></svg>
            </a>
            <a href={mounted ? SUPPLIER_LOGIN_URL : '#'} className="flow-cta-btn ghost no-underline">已有账号 · 登录投标</a>
          </div>
        </div>
      </div>
    </div>
  );
}
