'use client';

const stats = [
  { label: '待审批申请', value: '0', note: '供应商入口未开放' },
  { label: '本月通过', value: '0', note: '未来审批流统计' },
  { label: '本月驳回', value: '0', note: '未来审批流统计' },
  { label: '平均处理时长', value: '--', note: '功能建设中' },
];

export default function PriceApprovalPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-[#064ea2]">电子商城管理</p>
        <h1 className="mt-1 text-2xl font-black text-[#18243a]">价格审批</h1>
        <p className="mt-2 text-sm text-[#5a6d8a]">供应商报价调整和新增名录申请的未来审批入口。本轮先展示管理型占位，不接入真实申请数据。</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {stats.map(item => (
          <div key={item.label} className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold text-[#5a6d8a]">{item.label}</div>
            <div className="mt-3 text-3xl font-black text-[#123a6e]">{item.value}</div>
            <div className="mt-2 text-xs text-[#8a99ad]">{item.note}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <select disabled className="rounded-xl border border-[#d5e0ef] bg-[#f8fafc] px-3 py-2 text-sm text-[#8a99ad]"><option>全部申请类型</option></select>
          <select disabled className="rounded-xl border border-[#d5e0ef] bg-[#f8fafc] px-3 py-2 text-sm text-[#8a99ad]"><option>全部状态</option></select>
          <input disabled placeholder="搜索供应商/目录" className="rounded-xl border border-[#d5e0ef] bg-[#f8fafc] px-3 py-2 text-sm" />
          <button disabled className="rounded-xl bg-[#d5e0ef] px-4 py-2 text-sm font-bold text-[#8a99ad]">查询</button>
        </div>
      </div>

      <div className="rounded-2xl border border-dashed border-[#b8c7dc] bg-white p-10 text-center shadow-sm">
        <div className="text-lg font-black text-[#18243a]">供应商端申请入口尚未开放</div>
        <p className="mt-2 text-sm text-[#5a6d8a]">未来流程：供应商提交 → 采购中心初审 → 价格生效 → 商城同步。</p>
        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {['供应商提交', '采购中心初审', '价格生效', '商城同步'].map((step, index) => (
            <div key={step} className="rounded-xl bg-[#f3f7fc] p-4 text-sm font-bold text-[#123a6e]">
              {index + 1}. {step}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
