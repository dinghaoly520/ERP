// 信息公告页面交互脚本

// 公告数据
const noticeData = {
  1: {
    type: 'tender',
    typeName: '招标公告',
    title: '四川水发集团2026年度水利工程物资集中采购招标公告',
    date: '2026-05-18',
    projectNo: 'SWSW-2026-0518',
    deadline: '2026-05-28 17:00',
    content: `
      <h4>一、项目概况</h4>
      <p>本项目为四川水发集团2026年度水利工程物资集中采购，采购内容包括钢管、阀门、水泵等主要设备物资，预算金额约2.8亿元。</p>
      <h4>二、采购内容</h4>
      <ul>
        <li>钢管：螺旋焊管、直缝焊管，规格DN200-DN2000，约15000吨</li>
        <li>阀门：闸阀、蝶阀、球阀，规格DN100-DN1200，约2800台</li>
        <li>水泵：离心泵、轴流泵，流量100-5000m³/h，约120台</li>
        <li>其他配套设备及配件</li>
      </ul>
      <h4>三、投标人资格要求</h4>
      <ul>
        <li>具有独立法人资格，营业执照经营范围包含相关产品</li>
        <li>具有履行合同所必需的设备和专业技术能力</li>
        <li>近三年具有类似项目业绩</li>
        <li>财务状况良好，无不良信用记录</li>
      </ul>
      <h4>四、报名及获取招标文件</h4>
      <p>请于2026年5月28日17:00前在平台完成报名并下载招标文件。</p>
    `
  },
  2: {
    type: 'result',
    typeName: '中标公示',
    title: '亭子口水利枢纽加固工程中标公示',
    date: '2026-05-17',
    projectNo: 'TZK-2026-0412',
    content: `
      <h4>一、项目信息</h4>
      <p>项目名称：亭子口水利枢纽加固工程<br/>
      项目编号：TZK-2026-0412<br/>
      招标方式：公开招标</p>
      <h4>二、评标结果</h4>
      <p>经评标委员会评审，确定中标单位如下：</p>
      <ul>
        <li>中标单位：四川川水建设工程有限公司</li>
        <li>中标金额：1.26亿元</li>
        <li>工期：730日历天</li>
        <li>质量要求：合格</li>
      </ul>
      <h4>三、公示时间</h4>
      <p>公示期为2026年5月17日至2026年5月21日，共5个工作日。</p>
      <p>如有异议，请在公示期内以书面形式向招标人提出。</p>
    `
  },
  3: {
    type: 'tender',
    typeName: '招标公告',
    title: '智慧水务信息化系统建设项目招标公告',
    date: '2026-05-16',
    projectNo: 'ZHSW-2026-0510',
    deadline: '2026-05-30 17:00',
    content: `
      <h4>一、项目概况</h4>
      <p>建设覆盖全省灌区的智慧水务管理平台，实现水资源调度、工程运行、水质监测等功能的数字化管理。</p>
      <h4>二、建设内容</h4>
      <ul>
        <li>智慧水务综合管理平台开发</li>
        <li>水资源调度决策支持系统</li>
        <li>工程运行监控系统</li>
        <li>水质监测预警系统</li>
        <li>移动应用APP开发</li>
      </ul>
      <h4>三、预算金额</h4>
      <p>项目预算：4800万元</p>
    `
  },
  4: {
    type: 'policy',
    typeName: '政策法规',
    title: '关于进一步规范水利工程招标投标活动的通知',
    date: '2026-05-15',
    content: `
      <h4>各有关单位：</h4>
      <p>根据水利部最新规定，现就进一步规范水利工程招标投标活动有关事项通知如下：</p>
      <h4>一、严格招标程序</h4>
      <p>依法必须招标的水利工程建设项目，应当严格按照法定程序开展招标投标活动，不得规避招标、虚假招标。</p>
      <h4>二、规范评标活动</h4>
      <p>评标委员会应当严格按照招标文件规定的评标标准和方法进行评审，不得擅自改变评标标准和方法。</p>
      <h4>三、加强监督管理</h4>
      <p>各级水行政主管部门要加强对水利工程招标投标活动的监督检查，依法查处违法违规行为。</p>
    `
  },
  5: {
    type: 'notice',
    typeName: '平台通知',
    title: '平台系统升级维护通知',
    date: '2026-05-14',
    content: `
      <h4>尊敬的用户：</h4>
      <p>为提升系统性能和用户体验，平台将于2026年5月20日00:00-06:00进行系统升级维护。</p>
      <h4>维护内容</h4>
      <ul>
        <li>系统核心功能优化升级</li>
        <li>数据库性能优化</li>
        <li>安全漏洞修复</li>
        <li>用户界面优化</li>
      </ul>
      <h4>注意事项</h4>
      <p>维护期间，平台将暂停服务，请各用户提前做好相关安排。如有紧急事项，请联系客服热线：400-888-8888。</p>
    `
  },
  6: {
    type: 'result',
    typeName: '中标公示',
    title: '紫坪铺水库大坝安全监测设备采购中标公示',
    date: '2026-05-13',
    projectNo: 'ZPP-2026-0408',
    content: `
      <h4>一、项目信息</h4>
      <p>项目名称：紫坪铺水库大坝安全监测设备采购<br/>
      项目编号：ZPP-2026-0408</p>
      <h4>二、中标结果</h4>
      <ul>
        <li>中标单位：成都华西物资供应有限公司</li>
        <li>中标金额：3580万元</li>
        <li>交货期：合同签订后90日内</li>
      </ul>
    `
  },
  7: {
    type: 'tender',
    typeName: '招标公告',
    title: '升钟水库灌区续建配套与节水改造工程招标',
    date: '2026-05-12',
    projectNo: 'SZ-2026-0505',
    deadline: '2026-05-26 17:00',
    content: `
      <h4>一、项目概况</h4>
      <p>本项目主要建设内容包括渠道防渗衬砌、渠系建筑物改造、量测水设施建设等。</p>
      <h4>二、工程规模</h4>
      <ul>
        <li>渠道防渗衬砌：总长45公里</li>
        <li>渠系建筑物改造：渡槽8座、涵洞12座、分水闸15座</li>
        <li>量测水设施：80处</li>
      </ul>
      <h4>三、预算金额</h4>
      <p>项目预算：8500万元</p>
    `
  },
  8: {
    type: 'policy',
    typeName: '政策法规',
    title: '四川省水利工程建设项目电子招标投标实施细则',
    date: '2026-05-10',
    content: `
      <h4>第一章 总则</h4>
      <p>第一条 为规范水利工程建设项目电子招标投标活动，提高招标投标效率，根据《中华人民共和国招标投标法》等法律法规，结合本省实际，制定本细则。</p>
      <p>第二条 本省行政区域内依法必须招标的水利工程建设项目，采用电子招标投标方式的，适用本细则。</p>
      <h4>第二章 电子招标</h4>
      <p>第三条 招标人应当通过电子招标投标交易平台发布招标公告、发售招标文件。</p>
    `
  },
  9: {
    type: 'notice',
    typeName: '平台通知',
    title: '关于开展供应商资质年度审核的通知',
    date: '2026-05-08',
    content: `
      <h4>各供应商：</h4>
      <p>根据平台管理规定，现启动2026年度供应商资质审核工作，请各供应商于6月30日前完成资质更新。</p>
      <h4>审核内容</h4>
      <ul>
        <li>营业执照有效性核验</li>
        <li>资质证书更新</li>
        <li>业绩信息补充</li>
        <li>联系方式确认</li>
      </ul>
      <h4>注意事项</h4>
      <p>未按时完成资质审核的供应商，将暂停其参与投标资格。如有疑问，请联系客服。</p>
    `
  },
  10: {
    type: 'tender',
    typeName: '招标公告',
    title: '武都引水工程机电设备维护服务招标公告',
    date: '2026-05-06',
    projectNo: 'WD-2026-0428',
    deadline: '2026-05-20 17:00',
    content: `
      <h4>一、项目概况</h4>
      <p>采购武都引水工程主要机电设备年度维护服务，包括水泵机组、闸门启闭机等设备维护。</p>
      <h4>二、服务内容</h4>
      <ul>
        <li>水泵机组维护：12台套</li>
        <li>闸门启闭机维护：28台套</li>
        <li>电气设备维护</li>
        <li>年度检修服务</li>
      </ul>
      <h4>三、预算金额</h4>
      <p>项目预算：1200万元/年</p>
    `
  }
};

// 筛选功能
const filterBtns = document.querySelectorAll('.filter-btn');
const noticeCards = document.querySelectorAll('.notice-card');
const searchInput = document.getElementById('noticeSearch');
const searchBtn = document.querySelector('.search-btn');

function filterNotices() {
  const activeFilter = document.querySelector('.filter-btn.active').dataset.type;
  const searchText = searchInput.value.toLowerCase().trim();

  noticeCards.forEach(card => {
    const cardType = card.dataset.type;
    const cardTitle = card.querySelector('h3').textContent.toLowerCase();
    const cardContent = card.querySelector('p').textContent.toLowerCase();

    const typeMatch = activeFilter === 'all' || cardType === activeFilter;
    const searchMatch = !searchText || cardTitle.includes(searchText) || cardContent.includes(searchText);

    card.style.display = (typeMatch && searchMatch) ? '' : 'none';
  });
}

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterNotices();
  });
});

searchBtn?.addEventListener('click', filterNotices);
searchInput?.addEventListener('keypress', e => {
  if (e.key === 'Enter') filterNotices();
});

// 模态框功能
const modal = document.getElementById('modal');
const modalContent = document.getElementById('modalContent');

const closeModal = () => {
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
};

const openModal = html => {
  modalContent.innerHTML = html;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
};

modal.addEventListener('click', e => {
  if (e.target.matches('[data-close]')) closeModal();
});

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modal.classList.contains('show')) closeModal();
});

// 公告详情
document.querySelectorAll('.notice-action').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.id;
    const data = noticeData[id];
    if (!data) return;

    const typeClass = data.type;
    const html = `
      <div class="notice-detail-header">
        <span class="notice-type ${typeClass}">${data.typeName}</span>
        <h3>${data.title}</h3>
        <div class="notice-detail-meta">
          <span>发布日期：${data.date}</span>
          ${data.projectNo ? `<span>项目编号：${data.projectNo}</span>` : ''}
          ${data.deadline ? `<span>报名截止：${data.deadline}</span>` : ''}
        </div>
      </div>
      <div class="notice-detail-body">
        ${data.content}
      </div>
      <div class="notice-detail-footer">
        <button class="btn btn-outline" data-close>关闭</button>
        ${data.type === 'tender' ? '<button class="btn btn-solid" onclick="alert(\'已加入投标报名演示\')">立即报名</button>' : ''}
      </div>
    `;
    openModal(html);
  });
});

// 数字计数动画
const countEls = [...document.querySelectorAll('.notice-stats [data-count]')];
let counted = false;

const counterObserver = new IntersectionObserver(entries => {
  if (counted || !entries.some(e => e.isIntersecting)) return;
  counted = true;

  countEls.forEach(el => {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const decimal = Number(el.dataset.decimal || 0);
    const duration = 1450 + Math.random() * 450;
    const start = performance.now();

    const tick = now => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      let value = target * eased;

      if (decimal) {
        value = (value / Math.pow(10, decimal)).toFixed(decimal);
      } else {
        value = Math.round(value).toLocaleString('zh-CN');
      }

      el.textContent = value + suffix;

      if (p < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });
}, { threshold: .35 });

const statsSection = document.querySelector('.notice-stats');
if (statsSection) counterObserver.observe(statsSection);

// 快捷面板
const quickPanel = document.querySelector('.quick-panel');
window.addEventListener('scroll', () => {
  quickPanel?.classList.toggle('visible', window.scrollY > 260);
}, { passive: true });

document.getElementById('backTop')?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// 滚动显示动画
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: .12 });

document.querySelectorAll('.notice-card').forEach(el => {
  el.classList.add('reveal');
  revealObserver.observe(el);
});
