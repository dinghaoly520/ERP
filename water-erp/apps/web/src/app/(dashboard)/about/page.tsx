'use client';

export default function AboutPage() {
  return (
    <div>
      {/* 横幅 */}
      <div className="bg-gradient-to-r from-[#042a58] via-[#064ea2] to-[#39a8ff] rounded-2xl p-8 mb-6 text-white relative overflow-hidden">
        <div className="absolute right-0 top-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
        <div className="relative">
          <h1 className="text-2xl font-bold mb-2">关于智慧水发 · 招采ERP</h1>
          <p className="text-white/70 text-sm">全流程电子化招标采购管理平台</p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_380px] gap-6">
        {/* 左侧 */}
        <div className="space-y-6">
          {/* 平台简介 */}
          <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-6">
            <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-4">平台简介</h2>
            <div className="text-sm text-[oklch(0.55_0.01_264)] leading-relaxed space-y-3">
              <p>
                <strong className="text-[oklch(0.18_0.012_265)]">智慧水发采购管理工作台</strong>是面向水利行业采购管理场景的数字化业务平台，
                聚焦信息发布、供应商管理、专家管理三大核心能力。
              </p>
              <p>
                平台严格按照《中华人民共和国招标投标法》、《政府采购法》及其实施条例设计开发，
                确保招标采购活动的公开、公平、公正。通过数字化手段提升采购效率，降低采购成本，
                强化合规管理，实现招标采购全流程的透明化、规范化和智能化。
              </p>
              <p>
                平台已通过国家信息安全等级保护认证，采用多重加密和安全防护措施，
                确保招投标数据的安全性和完整性。
              </p>
            </div>
          </div>

          {/* 核心功能 */}
          <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-6">
            <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-4">核心功能模块</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: '📢', title: '信息发布中心', desc: '采购公告、成交公示、政策制度和通知公告统一发布' },
                { icon: '🏢', title: '供应商管理中心', desc: '注册审核、供应商库、评价体系和异常管理' },
                { icon: '👨‍💼', title: '专家管理中心', desc: '专家库、抽取分配、回避关系和履职评价' },
                { icon: '🔔', title: '待办工作台', desc: '聚合发布、供应商、专家事项，统一办理' },
                { icon: '🔍', title: '风险预警', desc: '异常供应商、发布异常、专家履职风险提醒' },
                { icon: '📊', title: '数据总览', desc: '三大中心关键指标与最近动态实时汇总' },
                { icon: '🔒', title: '权限控制', desc: '按角色控制入口、按钮与关键业务操作' },
                { icon: '📜', title: '操作留痕', desc: '重要操作记录可追溯，支撑合规管理' },
              ].map(item => (
                <div key={item.title} className="bg-[oklch(0.992_0.003_264)] rounded-lg p-4 border border-[oklch(0.91_0.006_264)]">
                  <div className="text-xl mb-2">{item.icon}</div>
                  <h3 className="text-sm font-bold text-[oklch(0.18_0.012_265)] mb-1">{item.title}</h3>
                  <p className="text-xs text-[oklch(0.55_0.01_264)]">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>

          {/* 平台特色 */}
          <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-6">
            <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-4">平台特色</h2>
            <div className="grid grid-cols-3 gap-4">
              {[
                { icon: '🔒', title: '安全合规', desc: '关键操作留痕，符合采购管理合规要求' },
                { icon: '⚡', title: '高效便捷', desc: '待办驱动，缩短业务处理周期' },
                { icon: '📊', title: '数据驱动', desc: '实时数据统计，辅助管理决策' },
                { icon: '🌐', title: '统一入口', desc: '三大中心能力集中在采购管理端办理' },
                { icon: '🤖', title: '智能辅助', desc: 'AI辅助信息分析与风险识别' },
                { icon: '📜', title: '全程留痕', desc: '所有重要操作可追溯，保障规范透明' },
              ].map(item => (
                <div key={item.title} className="text-center p-4">
                  <div className="text-3xl mb-3">{item.icon}</div>
                  <h3 className="text-sm font-bold text-[oklch(0.18_0.012_265)] mb-1">{item.title}</h3>
                  <p className="text-xs text-[oklch(0.55_0.01_264)]">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 右侧 */}
        <div className="space-y-4">
          {/* 联系方式 */}
          <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-6">
            <h2 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-4">联系我们</h2>
            <div className="space-y-4">
              {[
                { icon: '🏢', label: '单位名称', value: '四川省水利发展集团有限责任公司' },
                { icon: '📍', label: '地址', value: '四川省成都市高新区天府大道北段1700号' },
                { icon: '📞', label: '电话', value: '028-8888-6666' },
                { icon: '📧', label: '邮箱', value: 'erp@scwater.com' },
                { icon: '🕐', label: '工作时间', value: '周一至周五 9:00 - 17:30' },
                { icon: '🌐', label: '官网', value: 'www.scwater.com' },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-3">
                  <span className="text-lg">{item.icon}</span>
                  <div>
                    <p className="text-xs text-[oklch(0.55_0.01_264)]">{item.label}</p>
                    <p className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 技术支持 */}
          <div className="bg-gradient-to-br from-[#f8fbff] to-[#eef6ff] rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
            <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-3">🛠 技术支持</h3>
            <div className="space-y-3 text-sm text-[oklch(0.55_0.01_264)]">
              <div className="flex justify-between"><span>平台版本</span><span className="font-semibold text-[oklch(0.18_0.012_265)]">v2.0.0</span></div>
              <div className="flex justify-between"><span>技术架构</span><span className="font-semibold text-[oklch(0.18_0.012_265)]">NestJS + Next.js</span></div>
              <div className="flex justify-between"><span>数据库</span><span className="font-semibold text-[oklch(0.18_0.012_265)]">PostgreSQL</span></div>
              <div className="flex justify-between"><span>安全等级</span><span className="font-semibold text-[#11a874]">等保三级</span></div>
            </div>
          </div>

          {/* 法律声明 */}
          <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
            <h3 className="font-bold text-[oklch(0.18_0.012_265)] mb-3">📜 法律声明</h3>
            <p className="text-xs text-[oklch(0.55_0.01_264)] leading-relaxed">
              本平台所有招标采购信息均受法律保护。任何单位和个人不得以任何形式复制、传播或用于商业目的。
              平台保留对违规行为的追诉权。使用本平台即表示您同意遵守相关法律法规和平台使用条款。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
