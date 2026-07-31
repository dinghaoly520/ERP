import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/auth/Login.vue'),
      meta: { guest: true },
    },
    {
      path: '/register',
      name: 'Register',
      component: () => import('@/views/auth/Register.vue'),
      meta: { guest: true },
    },
    {
      path: '/register-temporary',
      name: 'RegisterTemporary',
      component: () => import('@/views/auth/RegisterTemporary.vue'),
      meta: { guest: true },
    },
    {
      // 采购邀请回执（RSVP）：公开页，登录与否均可访问（供应商常从短信/邮件点开，未必登录）。
      path: '/rsvp',
      name: 'Rsvp',
      component: () => import('@/views/rsvp/Rsvp.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      component: () => import('@/layouts/MainLayout.vue'),
      redirect: '/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'Dashboard',
          component: () => import('@/views/dashboard/Dashboard.vue'),
          meta: { title: '工作台', icon: 'HomeFilled' },
        },
        {
          path: 'profile',
          name: 'Profile',
          component: () => import('@/views/profile/CompanyInfo.vue'),
          meta: { title: '企业信息', icon: 'OfficeBuilding' },
        },
        {
          path: 'change-records',
          name: 'ChangeRecords',
          component: () => import('@/views/profile/ChangeRequest.vue'),
          meta: { title: '申请记录', icon: 'EditPen' },
        },
        {
          path: 'bids',
          name: 'BidList',
          component: () => import('@/views/bid/BidList.vue'),
          meta: { title: '招标信息', icon: 'Document' },
        },
        {
          path: 'catalog',
          name: 'CatalogList',
          component: () => import('@/views/catalog/CatalogList.vue'),
          meta: { title: '采购目录', icon: 'Goods' },
        },
        {
          path: 'catalog-applications',
          name: 'CatalogApplications',
          component: () => import('@/views/catalog/MyApplications.vue'),
          meta: { title: '供货申请' },
        },
        {
          path: 'supply',
          name: 'MySupply',
          component: () => import('@/views/catalog/MySupply.vue'),
          meta: { title: '我的供货' },
        },
        {
          path: 'bids/:id',
          name: 'BidDetail',
          component: () => import('@/views/bid/BidDetail.vue'),
          meta: { title: '招标详情' },
        },
        {
          path: 'bids/:id/submit',
          name: 'BidSubmit',
          component: () => import('@/views/bid/BidSubmit.vue'),
          meta: { title: '提交标书' },
        },
        {
          path: 'my-bids',
          name: 'MyBids',
          component: () => import('@/views/bid/MyBids.vue'),
          meta: { title: '我的投标', icon: 'DocumentChecked' },
        },
        {
          path: 'my-bids/:projectId/opening-confirm',
          name: 'OpeningConfirm',
          component: () => import('@/views/bid/OpeningConfirm.vue'),
          meta: { title: '开标确认' },
        },
        {
          path: 'my-bids/:projectId/opening-hall',
          name: 'OpeningHall',
          component: () => import('@/views/bid/OpeningHall.vue'),
          meta: { title: '在线开标大厅' },
        },
        {
          path: 'bids/:id/round-quote',
          name: 'RoundQuote',
          component: () => import('@/views/bid/RoundQuote.vue'),
          meta: { title: '多轮报价' },
        },
        {
          path: 'announcements',
          name: 'Announcements',
          component: () => import('@/views/announcement/AnnouncementList.vue'),
          meta: { title: '信息公告', icon: 'Bell' },
        },
        {
          path: 'announcements/:id',
          name: 'AnnouncementDetail',
          component: () => import('@/views/announcement/AnnouncementDetail.vue'),
          meta: { title: '公告详情' },
        },
        {
          path: 'notifications',
          name: 'Notifications',
          component: () => import('@/views/notification/NotificationList.vue'),
          meta: { title: '消息中心', icon: 'ChatDotRound' },
        },
        {
          path: 'award-letters',
          name: 'AwardLetters',
          component: () => import('@/views/award-letter/AwardLetterList.vue'),
          meta: { title: '中标通知书', icon: 'Trophy' },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('@/views/error/NotFound.vue'),
    },
  ],
})

// Navigation guard
router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  // 公开页（如回执 /rsvp）：登录与否都直接放行
  if (to.meta.public) return true

  // 首次导航：localStorage 有缓存但 store 未初始化时，恢复会话
  if (!authStore.user && localStorage.getItem('supplier_user')) {
    await authStore.init().catch(() => {})
  }

  if (to.meta.guest) {
    if (to.query.forceLogin === '1') return true
    if (authStore.isLoggedIn) return '/dashboard'
    return true
  }

  // 受保护页 — 未登录跳登录页
  if (!authStore.isLoggedIn) return '/login'

  return true
})

export default router
