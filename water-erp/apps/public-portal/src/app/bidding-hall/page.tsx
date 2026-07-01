'use client';

import { useRouter } from 'next/navigation';
import { UnifiedHeader } from '@/components/unified-header';
import { FlowTrack, FlowBackdrop, type StageData } from '@/components/flow-stage';

const STAGES: StageData[] = [
  { no: '01', en: 'REGISTER', title: '注册入库', color: '#7ec8e3', desc: '提交企业资质与营业执照，平台审核通过后正式入驻供应商库，获得投标资格。', roles: ['供应商', '平台审核'] },
  { no: '02', en: 'DISCOVER', title: '查看可投标项目', color: '#a3d9a5', desc: '浏览招标公告，订阅关键词与品类，第一时间获取匹配的采购商机推送。', roles: ['供应商'] },
  { no: '03', en: 'QUALIFY', title: '资格确认', color: '#7dd3d6', desc: '对照公告资格条件自检，确认满足后下载招标文件，研读技术与商务要求。', roles: ['供应商'] },
  { no: '04', en: 'COMPOSE', title: '编制投标', color: '#c4b5e3', desc: '按要求编制技术、商务投标文件，使用 CA 数字证书加密与电子签章。', roles: ['供应商', 'CA 签章'] },
  { no: '05', en: 'SUBMIT', title: '在线递交', color: '#f9c7a1', desc: '在截止前在线递交加密投标文件，系统实时回执确认，逾期自动锁定。', roles: ['供应商'] },
  { no: '06', en: 'ATTEND', title: '参与开标', color: '#f5a3b7', desc: '远程在线见证投标文件解密与唱标过程，确认开标记录。', roles: ['供应商', '开标主持'] },
  { no: '07', en: 'CLARIFY', title: '澄清答疑', color: '#b0c4f0', desc: '评标过程中响应专家提出的澄清、说明与补正要求，及时补充材料。', roles: ['供应商', '评审专家'] },
  { no: '08', en: 'RESULT', title: '结果查询', color: '#9fd9d3', desc: '查看中标公示，收到结果通知，未中标可申请退还保证金。', roles: ['供应商'] },
];

export default function BiddingHallPage() {
  const router = useRouter();

  return (
    <div className="flow-page">
      <FlowBackdrop />
      <UnifiedHeader announcements={[]} onLoginClick={() => {}} onRegisterClick={() => {}} />

      <div className="px-[clamp(28px,4vw,72px)] pt-3">
        <a href="/" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-[#c5d3e8] text-[13px] font-semibold text-[#5a6d8a] bg-white hover:text-[#064ea2] hover:border-[#064ea2] hover:bg-[#f0f5fb] transition-all duration-200 active:scale-[0.97] w-fit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          返回首页
        </a>
      </div>

      <section className="flow-hero-brand">
        <div className="flow-hero-brand-left flow-rise-1" style={{ gridColumn: '1 / -1' }}>
          <img src="/assets/logo.png" alt="四川水发集团" className="flow-hero-brand-logo" />
          <strong className="flow-hero-brand-name">四川水发集团</strong>
          <small className="flow-hero-brand-sub">Sichuan Water Development Group</small>
        </div>
      </section>

      <div className="flow-pipe-shell flow-rise-4">
        <div className="flow-pipe-shell-head">
          <h2>供应商投标全流程图谱</h2>
        </div>
        <FlowTrack stages={STAGES} accent="water" />
      </div>

      <div className="flow-cta flow-rise-4">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div>
            <h3>成为水发供应商</h3>
            <p>注册入驻供应商库，参与水发集团全量采购项目投标。</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={() => router.push('/register')} className="flow-cta-btn">
              立即注册供应商
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="8" x2="13" y2="8"/><polyline points="9 4 13 8 9 12"/></svg>
            </button>
            <button onClick={() => router.push('/login')} className="flow-cta-btn ghost">已有账号 · 登录投标</button>
          </div>
        </div>
      </div>
    </div>
  );
}
