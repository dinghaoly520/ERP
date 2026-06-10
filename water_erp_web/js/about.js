// 关于我们页面交互脚本

// 表单提交
const contactForm = document.getElementById('contactForm');
const toast = msg => {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
};

contactForm?.addEventListener('submit', e => {
  e.preventDefault();
  toast('留言已提交，我们将尽快回复您！');
  contactForm.reset();
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

// 登录/注册模态框
const accountTemplate = type => `
  <h3>${type === 'login' ? '用户登录' : '供应商注册'}</h3>
  <p>${type === 'login' ? '登录平台，查看更多信息。' : '注册成为平台供应商，参与招标采购项目。'}</p>
  <form class="modal-form" id="demoForm">
    <label>账号<input required placeholder="请输入账号/手机号" /></label>
    <label>密码<input required type="password" placeholder="请输入密码" /></label>
    ${type === 'register' ? '<label>企业名称<input required placeholder="请输入企业名称" /></label>' : ''}
    <div class="modal-actions">
      <button class="btn btn-solid" type="submit">${type === 'login' ? '登录' : '提交注册'}</button>
      <button class="btn btn-outline" type="button" data-close>取消</button>
    </div>
  </form>
`;

document.querySelectorAll('[data-open]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const type = btn.dataset.open;
    if (type === 'login' || type === 'register') {
      openModal(accountTemplate(type));
    }
    const form = document.getElementById('demoForm');
    form?.addEventListener('submit', ev => {
      ev.preventDefault();
      closeModal();
      toast('已提交本地演示数据。');
    });
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

document.querySelectorAll('.intro-stat, .timeline-item, .culture-card, .org-node, .contact-item').forEach(el => {
  el.classList.add('reveal');
  revealObserver.observe(el);
});