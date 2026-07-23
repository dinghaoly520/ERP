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
          path: 'evaluations',
          name: 'Evaluations',
          component: () => import('@/views/evaluation/EvaluationList.vue'),
          meta: { title: '评价记录', icon: 'Star' },
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
router.beforeEach(async (to, _from, next) => {
  const authStore = useAuthStore()

  // Initialize auth state on first navigation
  if (!authStore.user && localStorage.getItem('supplier_user')) {
    await authStore.init()
  }

  if (to.meta.guest) {
    // Public homepage quick-entry uses forceLogin=1 so users must re-enter
    // credentials even if this portal already has a cached session.
    if (to.query.forceLogin === '1') return next()

    // Guest pages — redirect to dashboard if already logged in
    if (authStore.isLoggedIn) return next('/dashboard')
    return next()
  }

  // Protected pages — redirect to login if not authenticated
  if (!authStore.isLoggedIn) return next('/login')

  next()
})

export default router
