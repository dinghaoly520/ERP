'use client';

import {
  BarChart3,
  Search,
  AlertTriangle,
  Users,
  ShoppingBag,
  Settings,
  FileText,
  Calendar,
} from 'lucide-react';

const ACTIONS = [
  {
    icon: BarChart3,
    label: '董事长驾驶舱',
    prompt: '给我系统全局驾驶舱概览',
  },
  {
    icon: Search,
    label: '全系统数据问答',
    prompt: '当前系统有哪些异常需要关注？',
  },
  {
    icon: AlertTriangle,
    label: '招采风险扫描',
    prompt: '扫描所有招采项目的风险情况',
  },
  {
    icon: Users,
    label: '供应商画像',
    prompt: '帮我分析供应商整体情况和风险排行',
  },
  {
    icon: ShoppingBag,
    label: '商城经营分析',
    prompt: '汇总电子商城的经营数据和价格走势',
  },
  {
    icon: Settings,
    label: '业务操作助手',
    prompt: '列出所有待审核的供应商，帮我处理',
  },
  {
    icon: FileText,
    label: '汇报材料生成',
    prompt: '准备一份集团招采运行情况汇报提纲',
  },
  {
    icon: Calendar,
    label: '今日重点事项',
    prompt: '今天有哪些需要关注的开评标和审批事项？',
  },
];

export function QuickActions({ onSend }: { onSend: (msg: string) => void }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {ACTIONS.map((a) => (
        <button
          key={a.label}
          onClick={() => onSend(a.prompt)}
          className="flex flex-col items-center gap-2 p-4 rounded-xl border transition cursor-pointer hover:shadow-md"
          style={{
            borderColor: 'var(--glass-border)',
            background: 'var(--glass-bg)',
          }}
        >
          <a.icon
            size={22}
            style={{ color: 'oklch(0.48_0.15_258)' }}
            strokeWidth={1.5}
          />
          <span
            className="text-xs font-medium"
            style={{ color: 'var(--color-text)' }}
          >
            {a.label}
          </span>
        </button>
      ))}
    </div>
  );
}
