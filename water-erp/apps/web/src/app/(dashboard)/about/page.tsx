'use client';

import { PageHero, SectionCard, MetricCard } from '@/components/workbench';
import { Shield, Zap, FileText, Globe, Clock, Info as InfoIcon } from 'lucide-react';

const FEATURES = [
  { icon: FileText, title: '信息发布中心', desc: '采购公告、成交公示、政策制度和通知公告统一发布' },
  { icon: Shield, title: '供应商管理中心', desc: '注册审核、供应商库、评价体系和异常管理' },
  { icon: Zap, title: '专家管理中心', desc: '专家库、抽取分配、回避关系和履职评价' },
  { icon: Globe, title: '统一入口', desc: '三大中心能力集中在采购管理端办理' },
  { icon: Clock, title: '操作留痕', desc: '重要操作记录可追溯，支撑合规管理' },
  { icon: InfoIcon, title: '权限控制', desc: '按角色控制入口、按钮与关键业务操作' },
];

export default function AboutPage() {
  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="系统信息"
        title="关于智慧水发 · 招采ERP"
        description="全流程电子化招标采购管理平台。按《中华人民共和国招标投标法》、《政府采购法》及实施条例设计开发，确保招标采购活动公开、公平、公正。"
        tone="blue"
        icon={<InfoIcon size={14} />}
      />

      <SectionCard title="核心功能模块">
        <div className="grid grid-cols-2 gap-4">
          {FEATURES.map(item => (
            <div key={item.title} className="rounded-xl border border-[#dce6f3] bg-[#f8fafc] p-4">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#eff6ff] text-[#064ea2]">
                <item.icon size={16} strokeWidth={1.7} />
              </div>
              <h3 className="text-sm font-bold text-[#18243a] mb-1">{item.title}</h3>
              <p className="text-xs text-[#5a6d8a]">{item.desc}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="联系我们">
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: '单位名称', value: '四川省水利发展集团有限责任公司' },
            { label: '地址', value: '四川省成都市高新区天府大道北段1700号' },
            { label: '电话', value: '028-8888-6666' },
            { label: '邮箱', value: 'erp@scwater.com' },
            { label: '工作时间', value: '周一至周五 9:00 - 17:30' },
            { label: '官网', value: 'www.scwater.com' },
          ].map(item => (
            <div key={item.label} className="rounded-xl border border-[#dce6f3] bg-[#f8fafc] px-4 py-3">
              <p className="text-xs text-[#5a6d8a]">{item.label}</p>
              <p className="mt-1 text-sm font-semibold text-[#18243a]">{item.value}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="技术信息">
        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard label="平台版本" value="v2.0.0" tone="blue" />
          <MetricCard label="技术架构" value="NestJS + Next.js" tone="cyan" />
          <MetricCard label="数据库" value="PostgreSQL" tone="purple" />
          <MetricCard label="安全等级" value="等保三级" tone="green" />
        </div>
      </SectionCard>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 text-xs leading-relaxed text-[#5a6d8a]">
        本平台所有招标采购信息均受法律保护。任何单位和个人不得以任何形式复制、传播或用于商业目的。平台保留对违规行为的追诉权。使用本平台即表示您同意遵守相关法律法规和平台使用条款。
      </div>
    </div>
  );
}
