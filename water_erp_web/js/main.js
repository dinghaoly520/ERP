const icons = {
  shield:'<svg viewBox="0 0 36 36"><path d="M18 3.8 29 8v8.2c0 7.4-4.5 13-11 16-6.5-3-11-8.6-11-16V8l11-4.2Z"/><path d="m14.1 18.2 2.8 2.8 5.8-6.2"/></svg>',
  bolt:'<svg viewBox="0 0 36 36"><path d="M20.5 3 7.5 20h9L15.5 33 28.5 15h-9l1-12Z"/><path d="M7.5 20h9"/></svg>',
  layers:'<svg viewBox="0 0 36 36"><path d="M18 4 32 11 18 18 4 11 18 4Z"/><path d="M4 18l14 7 14-7"/><path d="M4 25l14 7 14-7"/></svg>',
  safe:'<svg viewBox="0 0 36 36"><path d="M18 3.8 30 8.5v8.7c0 7.5-5 12.7-12 15-7-2.3-12-7.5-12-15V8.5l12-4.7Z"/><path d="M12.6 17.8h10.8M18 12.3v10.9"/></svg>',
  file:'<svg viewBox="0 0 36 36"><path d="M9 4.5h13l5 5V31H9V4.5Z"/><path d="M22 4.5v6h6"/><path d="M13 17h10M13 22h10M13 27h6"/></svg>',
  cart:'<svg viewBox="0 0 36 36"><path d="M4.8 7.5h4.4l3 14.7h14.4l3.8-10.8H11"/><path d="M14 29.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4ZM26 29.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"/></svg>',
  users:'<svg viewBox="0 0 36 36"><path d="M13.6 16a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"/><path d="M23 13.8a4 4 0 1 0 0-7.8"/><path d="M4.8 29c.8-6.2 4-9 8.8-9s8 2.8 8.8 9H4.8Z"/><path d="M21.8 20.6c4.6.4 7.3 3.1 8 8.4"/></svg>',
  clock:'<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="13"/><path d="M18 10v8l6 3"/></svg>',
  database:'<svg viewBox="0 0 36 36"><ellipse cx="18" cy="8" rx="11" ry="4.5"/><path d="M7 8v10c0 2.5 4.9 4.5 11 4.5s11-2 11-4.5V8"/><path d="M7 18v10c0 2.5 4.9 4.5 11 4.5s11-2 11-4.5V18"/></svg>',
  share:'<svg viewBox="0 0 36 36"><path d="M12 21a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM26 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM26 32a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="m15.4 14.8 7.2-4.6M15.4 19.2l7.2 4.6"/></svg>',
  heart:'<svg viewBox="0 0 36 36"><path d="M18 31S6 23.7 6 13.8A6.8 6.8 0 0 1 18 9.5a6.8 6.8 0 0 1 12 4.3C30 23.7 18 31 18 31Z"/></svg>',
  cloud:'<svg viewBox="0 0 36 36"><path d="M12 28H26.5a6.4 6.4 0 0 0 .3-12.8 9.5 9.5 0 0 0-18.2 3.6A4.9 4.9 0 0 0 12 28Z"/><path d="m15.5 19 2.8-2.8 2.8 2.8M18.3 16.2v8"/></svg>',
  sun:'<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="7"/><path d="M18 4v4M18 28v4M4 18h4M28 18h4M7.5 7.5l2.8 2.8M25.7 25.7l2.8 2.8M7.5 28.5l2.8-2.8M25.7 10.3l2.8-2.8"/></svg>',
  star:'<svg viewBox="0 0 36 36"><path d="M18 3l4.2 8.6 9.4 1.4-6.8 6.6 1.6 9.4L18 24.2l-8.4 4.8 1.6-9.4-6.8-6.6 9.4-1.4L18 3Z"/></svg>',
  box:'<svg viewBox="0 0 36 36"><path d="M18 3 4 10v16l14 7 14-7V10L18 3Z"/><path d="M4 10l14 7 14-7"/><path d="M18 17v16"/></svg>',
  cpu:'<svg viewBox="0 0 36 36"><rect x="8" y="8" width="20" height="20" rx="2"/><path d="M14 4v4M22 4v4M14 28v4M22 28v4M4 14h4M4 22h4M28 14h4M28 22h4"/></svg>',
  clipboard:'<svg viewBox="0 0 36 36"><path d="M12 6h12v3H12V6Z"/><path d="M9 8.5h18V32H9V8.5Z"/><path d="M13 16h10M13 21h10M13 26h7"/></svg>',
  link:'<svg viewBox="0 0 36 36"><path d="M15 21a5 5 0 0 0 7 0l6-6a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M21 15a5 5 0 0 0-7 0l-6 6a5 5 0 0 0 7 7l1.5-1.5"/></svg>'
};

document.querySelectorAll('.line-icon').forEach(el => {
  const name = el.dataset.icon;
  if (icons[name]) el.innerHTML = icons[name];
});

const navLinks = [...document.querySelectorAll('.nav-link')];
// 只跟踪真正的页面区块（section），排除指向内部元素的链接
const validSections = ['#top', '#platform', '#services', '#notice', '#about'];
const sections = validSections.map(id => document.querySelector(id)).filter(Boolean);
const setActive = () => {
  const y = window.scrollY + 130;
  // 当滚动距离小于100时，默认显示首页
  if (window.scrollY < 100) {
    navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === '#top'));
    return;
  }
  let current = '#top';
  sections.forEach(sec => { if (sec.offsetTop <= y) current = '#' + sec.id; });
  navLinks.forEach(link => link.classList.toggle('active', link.getAttribute('href') === current));
};
// 页面加载时先确保首页激活
navLinks.forEach(link => link.classList.remove('active'));
document.querySelector('.nav-link[href="#top"]')?.classList.add('active');
// 滚动监听
window.addEventListener('scroll', setActive, {passive:true});

const menu = document.querySelector('.menu-toggle');
const nav = document.querySelector('.top-nav');
menu?.addEventListener('click', () => nav.classList.toggle('open'));
navLinks.forEach(link => link.addEventListener('click', function(e) {
    nav.classList.remove('open');
    navLinks.forEach(l => l.classList.remove('active'));
    this.classList.add('active');
    const target = document.querySelector(this.getAttribute('href'));
    if(target){
      e.preventDefault();
      target.scrollIntoView({behavior:'smooth', block:'start'});
    }
  }));

// hero dynamic background carousel
const hero = document.querySelector('.hero');
const heroBgImage = document.querySelector('.hero-bg-image');
const heroImages = [
  { src:'./assets/bg-hydro-hero-1.png' },
  { src:'./assets/bg-hydro-hero-2.png' },
  { src:'./assets/bg-hydro-hero-3.png' },
  { src:'./assets/bg-hydro-hero-4.png' },
  { src:'./assets/bg-hydro-hero-5.png' },
  { src:'./assets/bg-hydro-hero-6.png' }
];
heroImages.forEach(item => { const img = new Image(); img.src = item.src; });
let heroIndex = 0;
let heroTimer = null;
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
if(hero && heroBgImage){
  const switcher = document.createElement('div');
  switcher.className = 'hero-switcher';
  switcher.setAttribute('aria-label','水利工程背景切换');
  const dots = heroImages.map((_, index) => {
    const dot = document.createElement('button');
    dot.className = 'hero-dot';
    dot.type = 'button';
    dot.setAttribute('aria-label', `切换背景 ${index + 1}`);
    dot.addEventListener('click', () => {
      setHeroBg(index, true);
      restartHeroTimer();
    });
    switcher.appendChild(dot);
    return dot;
  });
  hero.appendChild(switcher);

  function setHeroBg(index, userAction = false){
    heroIndex = (index + heroImages.length) % heroImages.length;
    dots.forEach((dot, i) => dot.classList.toggle('active', i === heroIndex));
    if(!reduceMotion && !userAction) heroBgImage.classList.add('is-changing');
    heroBgImage.style.backgroundImage = `url("${heroImages[heroIndex].src}")`;
    window.setTimeout(() => heroBgImage.classList.remove('is-changing'), 520);
  }
  function restartHeroTimer(){
    if(reduceMotion) return;
    clearInterval(heroTimer);
    heroTimer = setInterval(() => setHeroBg(heroIndex + 1), 3500);
  }
  hero.addEventListener('mouseenter', () => clearInterval(heroTimer));
  hero.addEventListener('mouseleave', restartHeroTimer);
  setHeroBg(0, false);
  restartHeroTimer();
}

// button ripple
window.addEventListener('pointerdown', ev => {
  const btn = ev.target.closest('.btn');
  if(!btn) return;
  const rect = btn.getBoundingClientRect();
  btn.style.setProperty('--x', `${ev.clientX - rect.left}px`);
  btn.style.setProperty('--y', `${ev.clientY - rect.top}px`);
  btn.classList.add('ripple');
  setTimeout(() => btn.classList.remove('ripple'), 220);
});

// counters
const countEls = [...document.querySelectorAll('[data-count]')];
let counted = false;
const counterObserver = new IntersectionObserver(entries => {
  if(counted || !entries.some(e => e.isIntersecting)) return;
  counted = true;
  countEls.forEach(el => {
    const target = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const decimal = Number(el.dataset.decimal || 0);
    const duration = 1450 + Math.random()*450;
    const start = performance.now();
    const tick = now => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1-p, 3);
      let value = target * eased;
      if(decimal){ value = (value / Math.pow(10, decimal)).toFixed(decimal); }
      else value = Math.round(value).toLocaleString('zh-CN');
      el.textContent = value + suffix;
      if(p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}, {threshold:.35});
const metrics = document.querySelector('.metrics');
if(metrics) counterObserver.observe(metrics);

const serviceData = {
  '招标采购': ['项目立项与公告发布','供应商报名与资格预审','开标评标全过程留痕','中标结果公示与归档'],
  '采购商城': ['目录化商品采购','供应商报价比价','订单流转与收货确认','采购成本看板分析'],
  '供应商管理': ['在线注册与资质审核','信用档案自动沉淀','绩效考核与分级管理','黑白名单风险预警'],
  '合同管理': ['合同模板与审批流','电子签署与履约跟踪','变更、验收、付款节点管理','合同台账与到期提醒'],
  '数据服务': ['招采经营数据驾驶舱','多维统计与趋势分析','异常指标预警提醒','报表导出与共享协同']
};

const modal = document.getElementById('modal');
const modalContent = document.getElementById('modalContent');
const closeModal = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden','true'); document.body.style.overflow=''; };
const openModal = html => {
  modalContent.innerHTML = html;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden','false');
  document.body.style.overflow='hidden';
  const first = modal.querySelector('input,select,textarea,button');
  if(first) setTimeout(() => first.focus(), 40);
};
modal.addEventListener('click', e => { if(e.target.matches('[data-close]')) closeModal(); });
window.addEventListener('keydown', e => { if(e.key === 'Escape' && modal.classList.contains('show')) closeModal(); });

const toast = msg => {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
};

document.querySelectorAll('.service-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const rx = ((e.clientY - r.top) / r.height - .5) * -4;
    const ry = ((e.clientX - r.left) / r.width - .5) * 4;
    card.style.transform = `translateY(-8px) rotateX(${rx}deg) rotateY(${ry}deg)`;
  });
  card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  const openService = () => {
    const name = card.dataset.service;
    const list = serviceData[name].map(item => `<li>${item}</li>`).join('');
    openModal(`<h3>${name}</h3><p>围绕集团招采业务场景，提供标准化、可追溯、可协同的线上服务能力。</p><ul class="service-detail">${list}</ul><div class="steps"><span>申请</span><span>审核</span><span>办理</span><span>归档</span></div><div class="modal-actions"><button class="btn btn-solid" id="enterModule">进入模块</button><button class="btn btn-outline" data-close>稍后了解</button></div>`);
    document.getElementById('enterModule')?.addEventListener('click', () => toast(`${name}模块已加入演示入口`));
  };
  card.addEventListener('click', openService);
  card.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openService(); } });
});

const formTemplate = type => {
  const isTender = type === 'tender';
  return `<h3>${isTender ? '我要投标' : '我要采购'}</h3>
  <p>${isTender ? '填写投标意向，系统将根据项目类型推送匹配公告与办理提醒。' : '提交采购需求，平台将自动生成流程建议并关联供应商资源。'}</p>
  <form class="modal-form" id="demoForm">
    <label>${isTender ? '供应商名称' : '需求部门'}<input required placeholder="请输入${isTender ? '供应商名称' : '部门名称'}" /></label>
    <label>${isTender ? '关注项目类型' : '采购品类'}<select required><option value="">请选择</option><option>工程建设</option><option>物资采购</option><option>服务采购</option><option>信息化项目</option></select></label>
    <label>${isTender ? '联系人手机号' : '预算金额'}<input required placeholder="${isTender ? '请输入手机号' : '请输入预算金额'}" /></label>
    <label>备注说明<textarea placeholder="请输入补充说明"></textarea></label>
    <div class="modal-actions"><button class="btn btn-solid" type="submit">提交演示</button><button class="btn btn-outline" type="button" data-close>取消</button></div>
  </form>`;
};
const accountTemplate = type => `<h3>${type === 'login' ? '用户登录' : '供应商注册'}</h3><p>${type === 'login' ? '本地演示页不连接真实账号系统，可查看交互样式。' : '注册流程包含基础信息、资质上传、平台审核、入驻启用四步。'}</p><form class="modal-form" id="demoForm"><label>账号<input required placeholder="请输入账号/手机号" /></label><label>密码<input required type="password" placeholder="请输入密码" /></label>${type === 'register' ? '<label>单位名称<input required placeholder="请输入单位名称" /></label>' : ''}<div class="modal-actions"><button class="btn btn-solid" type="submit">${type === 'login' ? '登录演示' : '提交注册'}</button><button class="btn btn-outline" type="button" data-close>取消</button></div></form>`;

document.querySelectorAll('[data-open]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const type = btn.dataset.open;
    if(type === 'procure' || type === 'tender') openModal(formTemplate(type));
    if(type === 'login' || type === 'register') openModal(accountTemplate(type));
    const form = document.getElementById('demoForm');
    form?.addEventListener('submit', ev => {
      ev.preventDefault();
      closeModal();
      toast('已提交本地演示数据，真实系统可在此接入接口。');
    });
  });
});

const quick = document.querySelector('.quick-panel');
window.addEventListener('scroll', () => quick.classList.toggle('visible', window.scrollY > 260), {passive:true});
document.getElementById('backTop')?.addEventListener('click', () => window.scrollTo({top:0, behavior:'smooth'}));

// notice tabs switching
document.querySelectorAll('.notice-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const targetId = tab.dataset.tab;
    document.querySelectorAll('.notice-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.notice-panel').forEach(panel => {
      panel.classList.toggle('active', panel.id === targetId);
    });
  });
});

// subtle reveal animation, kept opacity-only so card hover/tilt remains available
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if(entry.isIntersecting){
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, {threshold:.12});
document.querySelectorAll('.service-card,.cooperation-grid article,.metric-card').forEach(el => {
  el.classList.add('reveal');
  revealObserver.observe(el);
});
const style = document.createElement('style');
style.textContent = '.reveal{opacity:0;transition:opacity .55s ease, transform .3s ease, box-shadow .3s ease, border .3s ease}.reveal.is-visible{opacity:1}';
document.head.appendChild(style);
