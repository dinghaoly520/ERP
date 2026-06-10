// 电子商城页面交互脚本

// 数字计数动画
const countEls = [...document.querySelectorAll('.mall-stats [data-count]')];
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

const statsSection = document.querySelector('.mall-stats');
if (statsSection) counterObserver.observe(statsSection);

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

const toast = msg => {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
};

// 进入商城/登录/注册模态框
const mallEnterTemplate = () => `
  <h3>进入蜀水云采</h3>
  <p>请选择您的身份进入商城</p>
  <div style="display: grid; gap: 12px; margin-top: 20px;">
    <button class="btn btn-solid" style="width: 100%; background: #11a874;" onclick="alert('采购人入口 - 演示')">采购人入口</button>
    <button class="btn btn-solid" style="width: 100%; background: #11a874;" onclick="alert('供应商入口 - 演示')">供应商入口</button>
  </div>
  <div class="modal-actions">
    <button class="btn btn-outline" data-close>关闭</button>
  </div>
`;

const accountTemplate = type => `
  <h3>${type === 'login' ? '用户登录' : '立即注册'}</h3>
  <p>${type === 'login' ? '登录蜀水云采，开始便捷采购。' : '注册成为蜀水云采用户，体验一站式采购服务。'}</p>
  <form class="modal-form" id="demoForm">
    <label>账号<input required placeholder="请输入账号/手机号" /></label>
    <label>密码<input required type="password" placeholder="请输入密码" /></label>
    ${type === 'register' ? '<label>企业名称<input required placeholder="请输入企业名称" /></label>' : ''}
    <div class="modal-actions">
      <button class="btn btn-solid" type="submit" style="background: #11a874;">${type === 'login' ? '登录' : '提交注册'}</button>
      <button class="btn btn-outline" type="button" data-close>取消</button>
    </div>
  </form>
`;

const consultTemplate = () => `
  <h3>联系咨询</h3>
  <p>如需了解更多商城信息，欢迎联系我们。</p>
  <div class="consult-info" style="margin-top: 20px;">
    <div style="display: grid; gap: 16px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 20px;">📞</span>
        <div><strong>咨询热线</strong><br/><span style="color: #11a874; font-weight: 700;">400-888-8888</span></div>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 20px;">📧</span>
        <div><strong>邮箱</strong><br/><span>mall@scwater.com</span></div>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 20px;">⏰</span>
        <div><strong>服务时间</strong><br/><span>周一至周五 9:00 - 18:00</span></div>
      </div>
    </div>
  </div>
  <div class="modal-actions">
    <button class="btn btn-solid" data-close style="background: #11a874;">我知道了</button>
  </div>
`;

document.querySelectorAll('[data-open]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const type = btn.dataset.open;

    if (type === 'mall-enter') {
      openModal(mallEnterTemplate());
    } else if (type === 'login' || type === 'register') {
      openModal(accountTemplate(type));
    } else if (type === 'consult') {
      openModal(consultTemplate());
    }

    const form = document.getElementById('demoForm');
    form?.addEventListener('submit', ev => {
      ev.preventDefault();
      closeModal();
      toast('已提交本地演示数据。');
    });
  });
});

// 商品分类点击
document.querySelectorAll('.category-card').forEach(card => {
  card.addEventListener('click', () => {
    const category = card.dataset.category;
    toast(`${card.querySelector('h3').textContent} - 演示入口`);
  });
});

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

document.querySelectorAll('.feature-item, .category-card, .advantage-block, .process-step, .stat-item').forEach(el => {
  el.classList.add('reveal');
  revealObserver.observe(el);
});