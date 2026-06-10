// 供应商中心页面交互脚本

// 标签切换
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.dataset.tab;

    // 更新按钮状态
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // 更新面板显示
    tabPanels.forEach(panel => {
      panel.classList.toggle('active', panel.id === targetTab);
    });
  });
});

// FAQ手风琴
const faqItems = document.querySelectorAll('.faq-item');

faqItems.forEach(item => {
  const question = item.querySelector('.faq-question');
  question.addEventListener('click', () => {
    // 关闭其他打开的项
    faqItems.forEach(other => {
      if (other !== item && other.classList.contains('open')) {
        other.classList.remove('open');
      }
    });
    // 切换当前项
    item.classList.toggle('open');
  });
});

// 数字计数动画
const countEls = [...document.querySelectorAll('.stat-item [data-count]')];
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

const statsSection = document.querySelector('.supplier-stats');
if (statsSection) counterObserver.observe(statsSection);

// 快捷面板显示/隐藏
const quickPanel = document.querySelector('.quick-panel');
window.addEventListener('scroll', () => {
  quickPanel?.classList.toggle('visible', window.scrollY > 260);
}, { passive: true });

// 返回顶部
document.getElementById('backTop')?.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// 模态框功能（复用首页逻辑）
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
  const first = modal.querySelector('input, select, textarea, button');
  if (first) setTimeout(() => first.focus(), 40);
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

// 入驻/登录模态框
const accountTemplate = type => `
  <h3>${type === 'login' ? '供应商登录' : '供应商注册'}</h3>
  <p>${type === 'login' ? '登录供应商平台，管理投标项目、合同履约等业务。' : '注册成为平台供应商，参与四川水发集团招标采购项目。'}</p>
  <form class="modal-form" id="demoForm">
    <label>账号<input required placeholder="请输入账号/手机号" /></label>
    <label>密码<input required type="password" placeholder="请输入密码" /></label>
    ${type === 'register' ? '<label>企业名称<input required placeholder="请输入企业名称" /></label><label>统一社会信用代码<input required placeholder="请输入统一社会信用代码" /></label>' : ''}
    <div class="modal-actions">
      <button class="btn btn-solid" type="submit">${type === 'login' ? '登录' : '提交注册'}</button>
      <button class="btn btn-outline" type="button" data-close>取消</button>
    </div>
  </form>
`;

const consultTemplate = () => `
  <h3>咨询客服</h3>
  <p>如有入驻或使用问题，欢迎联系客服咨询。</p>
  <div class="consult-info" style="margin-top: 20px;">
    <div style="display: grid; gap: 16px;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 20px;">📞</span>
        <div><strong>客服热线</strong><br/><span style="color: #064ea2; font-weight: 700;">400-888-8888</span></div>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 20px;">📧</span>
        <div><strong>邮箱</strong><br/><span style="color: #064ea2;">supplier@scwater.com</span></div>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 20px;">⏰</span>
        <div><strong>服务时间</strong><br/><span>工作日 9:00 - 18:00</span></div>
      </div>
    </div>
  </div>
  <div class="modal-actions">
    <button class="btn btn-solid" data-close>我知道了</button>
  </div>
`;

document.querySelectorAll('[data-open]').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const type = btn.dataset.open;

    if (type === 'login' || type === 'register') {
      openModal(accountTemplate(type));
    } else if (type === 'consult') {
      openModal(consultTemplate());
    }

    const form = document.getElementById('demoForm');
    form?.addEventListener('submit', ev => {
      ev.preventDefault();
      closeModal();
      toast('已提交本地演示数据，真实系统可在此接入接口。');
    });
  });
});

// 功能卡片点击
document.querySelectorAll('.function-card').forEach(card => {
  card.addEventListener('click', () => {
    const title = card.querySelector('h3').textContent;
    toast(`${title}功能模块已加入演示入口`);
  });

  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      card.click();
    }
  });
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

document.querySelectorAll('.function-card, .case-card, .category-card, .help-item').forEach(el => {
  el.classList.add('reveal');
  revealObserver.observe(el);
});
