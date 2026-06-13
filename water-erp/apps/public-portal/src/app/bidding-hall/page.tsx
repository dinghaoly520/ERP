'use client';

import { useRouter } from 'next/navigation';
import { FlowHeader } from '@/components/flow-header';
import { FlowRiver } from '@/components/flow-river';
import { FlowTrack, FlowBackdrop, type StageData } from '@/components/flow-stage';

const STAGES: StageData[] = [
  {
    no: '01', en: 'REGISTER · 注册入库', title: '供应商注册入库',
    desc: '提交企业资质与营业执照，平台审核通过后正式入驻供应商库，获得投标资格。',
    roles: ['供应商', '平台审核'],
  },
  {
    no: '02', en: 'DISCOVER · 发现商机', title: '获取采购信息',
    desc: '浏览招标公告，订阅关注的关键词与品类，第一时间获取匹配的采购商机推送。',
    roles: ['供应商'],
  },
  {
    no: '03', en: 'QUALIFY · 资格确认', title: '资格条件确认',
    desc: '对照公告中的资格条件自检，确认满足后下载招标文件，研读技术与商务要求。',
    roles: ['供应商'],
  },
  {
    no: '04', en: 'COMPOSE · 编制投标', title: '投标文件编制',
    desc: '按要求编制技术与商务投标文件，使用 CA 数字证书进行加密与电子签章。',
    roles: ['供应商', 'CA 签章'],
  },
  {
    no: '05', en: 'SUBMIT · 递交投标', title: '在线递交投标',
    desc: '在投标截止前在线递交加密投标文件，系统实时回执确认，逾期自动锁定。',
    roles: ['供应商'],
  },
  {
    no: '06', en: 'ATTEND · 参与开标', title: '远程参与开标',
    desc: '开标时远程在线参与，见证投标文件解密与唱标过程，确认开标结果。',
    roles: ['供应商', '开标主持'],
  },
  {
    no: '07', en: 'CLARIFY · 澄清答疑', title: '响应澄清答疑',
    desc: '评标过程中响应专家提出的澄清、说明与补正要求，及时补充材料。',
    roles: ['供应商', '评审专家'],
  },
  {
    no: '08', en: 'RESULT · 结果查询', title: '中标结果查询',
    desc: '查看中标公示，无论中标与否均收到结果通知，未中标可申请退还保证金。',
    roles: ['供应商'],
  },
];

export default function BiddingHallPage() {
  const router = useRouter();
  return (
    <div className="flow-page">
      <FlowBackdrop />

      <FlowHeader label="BIDDING · 供应商投标" />

      {/* ════ Hero ════ */}
      <section className="flow-hero">
        <span className="flow-eyebrow">四川水发 · 供应商投标全流程</span>
        <h1 className="flow-title">八步投标 · 公平公正<br />全程电子化 · 阳光透明</h1>
        <p className="flow-sub">
          从注册入库到结果查询，供应商在一个平台上完成投标全流程。电子编标、加密递交、
          远程开标 —— 让每一位供应商都能公平参与、阳光投标。
        </p>
        <div className="mt-12">
          <FlowRiver accent="water" />
        </div>
      </section>

      {/* ════ Metrics ════ */}
      <div className="flow-metrics">
        {[
          { num: '8', suffix: '步', label: '标准化投标流程' },
          { num: '0', suffix: '跑腿', label: '全程线上零跑动' },
          { num: 'CA', suffix: '', label: '数字证书加密签章' },
          { num: '∞', suffix: '', label: '商机订阅实时推送' },
        ].map((m) => (
          <div key={m.label} className="flow-metric">
            <span className="flow-metric-num">{m.num}<em>{m.suffix}</em></span>
            <span className="flow-metric-label">{m.label}</span>
          </div>
        ))}
      </div>

      {/* ════ 横向流程图谱 ════ */}
      <div className="flow-section-head">
        <h2>供应商投标全流程图谱</h2>
        <p>SWIPE / SCROLL / DRAG · 横向拖拽浏览八大步骤</p>
      </div>

      <FlowTrack stages={STAGES} accent="water" />

      {/* ════ CTA ════ */}
      <div className="flow-cta">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div className="max-w-xl">
            <h3>成为水发供应商</h3>
            <p>注册入驻供应商库，即可参与水发集团全量采购项目的投标。已有账号？直接登录投标。</p>
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
