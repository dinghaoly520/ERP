<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Document,
  ShoppingCart,
  User,
  UserFilled,
  ArrowRight
} from '@element-plus/icons-vue'

const router = useRouter()

// 公告标签
const activeNoticeTab = ref('tender')

// 公告数据
const tenderNotices = ref([
  {
    id: 1,
    tag: '招标公告',
    date: '2026-05-18',
    badge: '重要',
    title: '2026年度水利工程物资集中采购招标公告',
    desc: '本项目为四川水发集团2026年度水利工程物资集中采购，采购内容包括钢管、阀门、水泵等主要设备物资...',
    projectNo: 'SWSW-2026-0518',
    deadline: '2026-05-28 17:00'
  },
  { id: 2, date: '05-16', title: '智慧水务信息化系统建设项目招标公告' },
  { id: 3, date: '05-12', title: '升钟水库灌区续建配套与节水改造工程招标' },
  { id: 4, date: '05-06', title: '武都引水工程机电设备维护服务招标公告' }
])

const resultNotices = ref([
  {
    id: 1,
    tag: '中标公示',
    date: '2026-05-17',
    title: '亭子口水利枢纽加固工程中标公示',
    desc: '经评标委员会评审，确定四川川水建设工程有限公司为中标单位，中标金额1.26亿元...',
    winner: '四川川水建设工程有限公司',
    amount: '1.26亿元'
  },
  { id: 2, date: '05-13', title: '紫坪铺水库大坝安全监测设备采购中标公示' },
  { id: 3, date: '05-10', title: '川水大厦电梯设备采购中标公示' },
  { id: 4, date: '05-08', title: '办公家具集中采购中标公示' }
])

// 功能入口
const features = [
  { title: '采购管理入口', icon: 'file', desc: '立项申请、项目管理、招标文件', path: '/procurement' },
  { title: '电子商城入口', icon: 'cart', desc: '集中采购、员工内购、商家入驻', path: '/mall' },
  { title: '供应商入口', icon: 'share', desc: '供应商注册、供应商库、评价', path: '/supplier' },
  { title: '专家入口', icon: 'users', desc: '专家库、专家抽取、专家评价', path: '/expert' }
]

// 合作理念
const principles = [
  { title: '阳光透明', desc: '公开公平公正，流程全程可追溯', icon: 'sun' },
  { title: '合规高效', desc: '规范业务流程，提升采购效率', icon: 'shield' },
  { title: '互信共赢', desc: '阳光透明合作，互信互利共赢', icon: 'heart' },
  { title: '价值创造', desc: '优化资源配置，创造更大价值', icon: 'star' }
]
</script>

<template>
  <div class="home-page">
    <!-- Hero区域 - 保持原有设计 -->
    <section class="hero" id="platform">
      <div class="hero-bg"><div class="hero-bg-image"></div></div>
      <div class="hero-content">
        <p class="eyebrow">数字采购 · 阳光交易 · 协同共享</p>
        <h1>智慧水发 · ERP系统</h1>
        <p class="hero-subtitle">阳光透明 · 合规高效 · 互信共赢 · 价值创造</p>
        <p class="hero-copy">
          打造公开、公平、公正的电子化招标采购平台，<br/>
          为四川水发集团高质量发展提供坚实数字化支撑。
        </p>
        <div class="hero-buttons">
          <button class="btn btn-solid" @click="router.push('/procurement')">我要采购 <span>→</span></button>
          <button class="btn btn-outline" @click="router.push('/supplier')">我要投标 <span>→</span></button>
        </div>
      </div>
    </section>

    <!-- 功能入口 - 保持原有设计 -->
    <section class="assurance">
      <div class="assurance-inner">
        <a class="assurance-item" @click="router.push('/procurement')">
          <div class="line-icon" data-icon="file"></div>
          <div><strong>采购管理入口</strong><span>立项申请、项目管理、招标文件</span></div>
        </a>
        <a class="assurance-item" @click="router.push('/mall')">
          <div class="line-icon" data-icon="cart"></div>
          <div><strong>电子商城入口</strong><span>集中采购、员工内购、商家入驻</span></div>
        </a>
        <a class="assurance-item" @click="router.push('/supplier')">
          <div class="line-icon" data-icon="share"></div>
          <div><strong>供应商入口</strong><span>供应商注册、供应商库、评价</span></div>
        </a>
        <a class="assurance-item" @click="router.push('/expert')">
          <div class="line-icon" data-icon="users"></div>
          <div><strong>专家入口</strong><span>专家库、专家抽取、专家评价</span></div>
        </a>
      </div>
    </section>

    <!-- 公告信息 -->
    <section class="notice-section" id="notice">
      <div class="notice-wrapper">
        <div class="notice-header">
          <div class="notice-tabs">
            <button :class="['notice-tab', { active: activeNoticeTab === 'tender' }]" @click="activeNoticeTab = 'tender'">招标公告</button>
            <button :class="['notice-tab', { active: activeNoticeTab === 'result' }]" @click="activeNoticeTab = 'result'">中标公示</button>
          </div>
          <router-link to="/notice" class="notice-more">全部公告 →</router-link>
        </div>
        <div class="notice-content">
          <!-- 招标公告 -->
          <div v-show="activeNoticeTab === 'tender'" class="notice-panel active" id="tender">
            <div class="notice-featured">
              <div class="featured-main">
                <div class="featured-meta">
                  <span class="meta-tag tender">招标公告</span>
                  <span class="meta-date">{{ tenderNotices[0].date }}</span>
                  <span class="meta-badge" v-if="tenderNotices[0].badge">{{ tenderNotices[0].badge }}</span>
                </div>
                <h3 class="featured-title">{{ tenderNotices[0].title }}</h3>
                <p class="featured-desc">{{ tenderNotices[0].desc }}</p>
                <div class="featured-info">
                  <span class="info-item"><i>项目编号</i>{{ tenderNotices[0].projectNo }}</span>
                  <span class="info-item"><i>报名截止</i><em>{{ tenderNotices[0].deadline }}</em></span>
                </div>
              </div>
              <a href="#" class="featured-btn">查看详情 →</a>
            </div>
            <div class="notice-list">
              <a href="#" class="notice-row" v-for="notice in tenderNotices.slice(1)" :key="notice.id">
                <span class="row-date">{{ notice.date }}</span>
                <span class="row-title">{{ notice.title }}</span>
                <span class="row-arrow">→</span>
              </a>
            </div>
          </div>
          <!-- 中标公示 -->
          <div v-show="activeNoticeTab === 'result'" class="notice-panel" id="result">
            <div class="notice-featured result">
              <div class="featured-main">
                <div class="featured-meta">
                  <span class="meta-tag result">中标公示</span>
                  <span class="meta-date">{{ resultNotices[0].date }}</span>
                </div>
                <h3 class="featured-title">{{ resultNotices[0].title }}</h3>
                <p class="featured-desc">{{ resultNotices[0].desc }}</p>
                <div class="featured-info">
                  <span class="info-item"><i>中标单位</i>{{ resultNotices[0].winner }}</span>
                  <span class="info-item"><i>中标金额</i><em>{{ resultNotices[0].amount }}</em></span>
                </div>
              </div>
              <a href="#" class="featured-btn success">查看详情 →</a>
            </div>
            <div class="notice-list">
              <a href="#" class="notice-row" v-for="notice in resultNotices.slice(1)" :key="notice.id">
                <span class="row-date">{{ notice.date }}</span>
                <span class="row-title">{{ notice.title }}</span>
                <span class="row-arrow">→</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 合作理念 -->
    <section class="cooperation" id="about">
      <div class="section-head cooperation-title">
        <h2>携手水发　共创阳光招采新未来</h2>
      </div>
      <div class="cooperation-grid">
        <article><div class="line-icon" data-icon="sun"></div><div><strong>阳光透明</strong><span>公开公平公正，流程全程可追溯</span></div></article>
        <article><div class="line-icon" data-icon="shield"></div><div><strong>合规高效</strong><span>规范业务流程，提升采购效率</span></div></article>
        <article><div class="line-icon" data-icon="heart"></div><div><strong>互信共赢</strong><span>阳光透明合作，互信互利共赢</span></div></article>
        <article><div class="line-icon" data-icon="star"></div><div><strong>价值创造</strong><span>优化资源配置，创造更大价值</span></div></article>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 保持原有首页样式 */
.hero {
  position: relative;
  min-height: clamp(430px, 32vw, 560px);
  overflow: hidden;
  background: #eaf4ff;
}

.hero-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  background: linear-gradient(90deg, rgba(246, 250, 255, .95) 0%, rgba(246, 250, 255, .88) 28%, rgba(246, 250, 255, .55) 58%, rgba(246, 250, 255, .25) 100%), linear-gradient(180deg, rgba(255, 255, 255, .15) 0%, rgba(232, 243, 255, .55) 100%);
}

.hero-bg-image {
  position: absolute;
  inset: 0;
  background: url('../../assets/bg-hydro-hero-1.png') center center/cover no-repeat;
}

.hero::before {
  content: "";
  position: absolute;
  left: -8%;
  right: -8%;
  bottom: clamp(-60px, -4vw, -28px);
  height: clamp(80px, 8vw, 140px);
  background: #fff;
  border-radius: 50% 50% 0 0/76% 76% 0 0;
  z-index: 1;
}

.hero::after {
  content: "";
  position: absolute;
  left: -8%;
  right: -8%;
  bottom: clamp(-60px, -4vw, -28px);
  height: clamp(80px, 8vw, 140px);
  background: transparent;
  border-top: clamp(4px, .5vw, 8px) solid #0b59ad;
  border-right: clamp(4px, .6vw, 10px) solid #18a56c;
  border-radius: 50% 50% 0 0/76% 76% 0 0;
  z-index: 2;
}

.hero-content {
  position: relative;
  z-index: 4;
  max-width: 1360px;
  margin: 0 auto;
  padding: clamp(60px, 5vw, 90px) 0 clamp(60px, 5vw, 80px);
}

.eyebrow {
  display: none;
  margin: 0 0 12px;
  color: #1262b5;
  font-weight: 700;
  letter-spacing: .18em;
}

.hero h1 {
  margin: 0 0 18px;
  color: #063f82;
  font-size: clamp(34px, 3.3vw, 48px);
  line-height: 1.1;
  letter-spacing: .08em;
  font-weight: 900;
}

.hero-subtitle {
  margin: 0 0 28px;
  color: #05417e;
  font-size: clamp(18px, 1.8vw, 24px);
  font-weight: 700;
  letter-spacing: .05em;
}

.hero-copy {
  margin: 0 0 28px;
  color: #49576b;
  font-size: 15px;
  line-height: 2;
  font-weight: 600;
}

.hero-buttons {
  display: flex;
  gap: 28px;
}

.hero-buttons .btn {
  min-width: 140px;
  height: 46px;
  white-space: nowrap;
}

.btn {
  height: 40px;
  min-width: 88px;
  padding: 0 24px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  transition: transform .25s, box-shadow .25s, background .25s, border .25s, color .25s;
  font-weight: 700;
  cursor: pointer;
  border: 0;
}

.btn-solid {
  background: #064ea2;
  color: #fff;
  box-shadow: 0 12px 22px rgba(2, 60, 137, .16);
}

.btn-solid:hover {
  background: #043f88;
  transform: translateY(-2px);
  box-shadow: 0 16px 26px rgba(2, 60, 137, .24);
}

.btn-outline {
  border: 1px solid #9fb5cf;
  color: #073a78;
  background: rgba(255, 255, 255, .58);
}

.btn-outline:hover {
  border-color: #064ea2;
  color: #fff;
  background: #064ea2;
  transform: translateY(-2px);
}

/* 功能入口 */
.assurance {
  position: relative;
  z-index: 5;
  background: #fff;
  min-height: 104px;
  display: flex;
  align-items: center;
  box-shadow: 0 2px 0 rgba(4, 65, 137, .02);
}

.assurance-inner {
  max-width: 1040px;
  width: 100%;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
}

.assurance-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 72px;
  position: relative;
  transition: all .25s ease;
  cursor: pointer;
}

.assurance-item:hover {
  background: #f5f9fd;
}

.assurance-item:not(:last-child)::after {
  content: "";
  position: absolute;
  right: 0;
  top: 22px;
  bottom: 22px;
  width: 1px;
  background: #e0e8f2;
}

.assurance-item strong {
  display: block;
  font-size: 15px;
  font-weight: 800;
  color: #1c2941;
  margin-bottom: 7px;
}

.assurance-item span {
  font-size: 12px;
  color: #69758b;
  font-weight: 600;
}

.line-icon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #064ea2;
  flex: 0 0 auto;
}

.line-icon svg {
  width: 100%;
  height: 100%;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 公告区域 */
.notice-section {
  padding: 40px 0;
  background: linear-gradient(180deg, #f8fbff 0%, #fff 100%);
}

.notice-wrapper {
  max-width: 1360px;
  margin: 0 auto;
}

.notice-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.notice-tabs {
  display: flex;
  gap: 10px;
}

.notice-tab {
  padding: 10px 24px;
  font-size: 14px;
  font-weight: 700;
  color: #5a6d8a;
  background: #fff;
  border: 1px solid #e0eaf5;
  border-radius: 8px;
  transition: all .25s ease;
  cursor: pointer;
}

.notice-tab:hover {
  color: #064ea2;
  border-color: #b8d4f5;
}

.notice-tab.active {
  color: #fff;
  background: linear-gradient(135deg, #0e62d0, #39a8ff);
  border-color: transparent;
}

.notice-more {
  font-size: 13px;
  color: #064ea2;
  font-weight: 600;
  cursor: pointer;
}

.notice-more:hover {
  text-decoration: underline;
}

.notice-panel {
  display: none;
  animation: fadeIn .3s ease;
}

.notice-panel.active {
  display: block;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.notice-featured {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #e8f0fa;
  position: relative;
  margin-bottom: 16px;
}

.notice-featured::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(180deg, #064ea2, #39a8ff);
  border-radius: 4px 0 0 4px;
}

.notice-featured.result::before {
  background: linear-gradient(180deg, #11a874, #2dd4a0);
}

.featured-main {
  flex: 1;
}

.featured-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.meta-tag {
  font-size: 11px;
  font-weight: 800;
  padding: 4px 12px;
  border-radius: 4px;
}

.meta-tag.tender {
  color: #064ea2;
  background: #e8f2ff;
}

.meta-tag.result {
  color: #11a874;
  background: #e8fff0;
}

.meta-date {
  font-size: 12px;
  color: #8a9aaa;
  font-weight: 600;
}

.meta-badge {
  font-size: 11px;
  font-weight: 800;
  padding: 4px 10px;
  border-radius: 4px;
  color: #f5a623;
  background: #fff8e8;
}

.featured-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 800;
  color: #1a2a44;
  line-height: 1.4;
}

.featured-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: #5a6d8a;
  line-height: 1.6;
}

.featured-info {
  display: flex;
  gap: 20px;
}

.info-item {
  font-size: 12px;
  color: #6a7a8a;
}

.info-item i {
  font-style: normal;
  color: #8a9aaa;
  margin-right: 6px;
}

.info-item em {
  font-style: normal;
  color: #064ea2;
  font-weight: 700;
}

.notice-featured.result .info-item em {
  color: #11a874;
}

.featured-btn {
  padding: 10px 20px;
  font-size: 13px;
  font-weight: 700;
  color: #064ea2;
  background: #f0f6fd;
  border-radius: 6px;
  transition: all .2s ease;
  cursor: pointer;
}

.featured-btn:hover {
  background: #064ea2;
  color: #fff;
}

.featured-btn.success {
  color: #11a874;
  background: #e8fff0;
}

.featured-btn.success:hover {
  background: #11a874;
  color: #fff;
}

.notice-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.notice-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #e8f0fa;
  transition: all .2s ease;
  cursor: pointer;
}

.notice-row:hover {
  border-color: #b8d4f5;
  box-shadow: 0 2px 8px rgba(6, 78, 162, .06);
}

.row-date {
  font-size: 12px;
  color: #064ea2;
  font-weight: 700;
  min-width: 44px;
  padding: 4px 10px;
  background: #f0f6fd;
  border-radius: 4px;
  text-align: center;
}

.row-title {
  flex: 1;
  font-size: 14px;
  color: #3a4a5a;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-arrow {
  color: #b8d4f5;
  font-size: 14px;
  transition: color .2s ease;
}

.notice-row:hover .row-arrow {
  color: #064ea2;
}

/* 合作理念 */
.cooperation {
  position: relative;
  background: linear-gradient(180deg, #eef6fb, #e9f3fa);
  min-height: 120px;
  padding-bottom: 24px;
  overflow: hidden;
}

.cooperation::before {
  content: "";
  position: absolute;
  inset: 0;
  background: url('../../assets/bg-waterworks-bottom.png') center bottom/cover no-repeat;
  opacity: .78;
}

.cooperation-title {
  padding-top: 20px;
}

.cooperation-title h2 {
  font-size: 18px;
  letter-spacing: .05em;
  font-weight: 900;
  color: #111a2d;
}

.cooperation-grid {
  position: relative;
  z-index: 2;
  max-width: 1360px;
  margin: 16px auto 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: clamp(14px, 1.5vw, 24px);
}

.cooperation-grid article {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  border-right: 1px solid rgba(91, 119, 147, .20);
}

.cooperation-grid article:last-child {
  border-right: 0;
}

.cooperation-grid strong {
  display: block;
  font-size: 14px;
  font-weight: 900;
  margin-bottom: 5px;
}

.cooperation-grid span {
  font-size: 11px;
  color: #536174;
  font-weight: 600;
}

@media (max-width: 1024px) {
  .hero h1 {
    font-size: 32px;
  }

  .hero-subtitle {
    font-size: 18px;
  }

  .assurance-inner {
    grid-template-columns: repeat(2, 1fr);
  }

  .assurance-item:nth-child(2)::after {
    display: none;
  }

  .cooperation-grid {
    grid-template-columns: 1fr;
  }

  .cooperation-grid article {
    border-right: 0;
  }
}

@media (max-width: 768px) {
  .hero-buttons {
    gap: 12px;
    flex-wrap: wrap;
  }

  .hero-buttons .btn {
    min-width: 132px;
    white-space: nowrap;
  }

  .assurance-inner {
    grid-template-columns: 1fr;
  }

  .assurance-item::after {
    display: none !important;
  }

  .notice-tabs {
    flex-wrap: wrap;
  }

  .notice-tab {
    padding: 8px 16px;
    font-size: 13px;
  }

  .notice-featured {
    flex-direction: column;
    align-items: flex-start;
  }

  .featured-btn {
    width: 100%;
    text-align: center;
  }
}
</style>