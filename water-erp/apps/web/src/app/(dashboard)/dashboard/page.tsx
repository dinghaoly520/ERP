'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@/lib/types';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setUser);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#18243a] mb-2">欢迎回来，{user?.displayName || '...'}</h1>
      <p className="text-[#5a6d8a] mb-8">智慧水发招采ERP系统管理后台</p>
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: '开评标管理', desc: '在线开标、专家评审、监督归档', path: '/bid', color: 'from-blue-600 to-blue-800' },
          { label: '采购管理', desc: '立项申请、项目管理、招标文件', path: '/procurement', color: 'from-cyan-600 to-cyan-800' },
          { label: '专家管理', desc: '专家库、专家抽取、专家评价', path: '/expert', color: 'from-purple-600 to-purple-800' },
          { label: '供应商管理', desc: '注册审核、供应商库、评价', path: '/supplier', color: 'from-green-600 to-green-800' },
          { label: '电子商城', desc: '集中采购、员工内购、商家入驻', path: '/mall', color: 'from-orange-500 to-orange-700' },
          { label: '信息公告', desc: '招标公告、中标公示、政策法规', path: '/notice', color: 'from-teal-600 to-teal-800' },
          { label: '评价管理', desc: '评价列表、发起评价、统计', path: '/evaluation', color: 'from-pink-600 to-pink-800' },
          { label: '关于我们', desc: '平台介绍、联系方式', path: '/about', color: 'from-gray-600 to-gray-800' },
        ].map(item => (
          <button key={item.path} onClick={() => router.push(item.path)}
            className="bg-white rounded-xl p-6 border border-[#e8f0fa] hover:shadow-lg hover:-translate-y-1 transition-all text-left">
            <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${item.color} mb-4`} />
            <h3 className="font-bold text-[#18243a] mb-1">{item.label}</h3>
            <p className="text-xs text-[#5a6d8a]">{item.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
