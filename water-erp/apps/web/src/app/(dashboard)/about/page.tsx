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
                <strong className="text-[oklch(0.18_0.012_265)]">智慧水发招采ERP系统</strong>是面向水利行业的全流程电子化招标采购管理平台，
                涵盖项目管理、招标公告、在线开标、专家评标、供应商管理、监督审计等核心业务。
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
                { icon: '⚖️', title: '开评标管理', desc: '在线开标、专家评标、监督归档全流程管理' },
                { icon: '📋', title: '采购管理', desc: '立项审批、招标文件编写与审查' },
                { icon: '🏢', title: '供应商管理', desc: '注册审核、资质管理、评价体系' },
                { icon: '👨‍💼', title: '专家工作台', desc: '身份核验、独立评审、AI辅助评标' },
                { icon: '📢', title: '信息公告', desc: '招标公告、中标公示、政策法规发布' },
                { icon: '⭐', title: '评价管理', desc: '供应商评价、统计分析、等级划分' },
                { icon: '🔍', title: '监督审计', desc: '全程留痕、风险预警、合规审计' },
                { icon: '🔒', title: '安全管理', desc: '数据加密、权限控制、操作审计' },
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
                { icon: '🔒', title: '安全合规', desc: '全流程加密，符合国家招投标法规要求' },
                { icon: '⚡', title: '高效便捷', desc: '电子化流程，缩短采购周期50%以上' },
                { icon: '📊', title: '数据驱动', desc: '实时数据统计，辅助管理决策' },
                { icon: '🌐', title: '全线上化', desc: '无需线下操作，全流程线上完成' },
                { icon: '🤖', title: '智能辅助', desc: 'AI辅助评标，提升评审效率与质量' },
                { icon: '📜', title: '全程留痕', desc: '所有操作可追溯，保障公平公正' },
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
