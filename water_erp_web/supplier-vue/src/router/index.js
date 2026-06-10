import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Layout',
    component: () => import('@/views/Layout.vue'),
    redirect: '/home',
    children: [
      // 首页
      {
        path: 'home',
        name: 'Home',
        component: () => import('@/views/Home.vue'),
        meta: { title: '首页', icon: 'HomeFilled' }
      },
      // 采购管理
      {
        path: 'procurement',
        name: 'Procurement',
        component: () => import('@/views/procurement/Index.vue'),
        meta: { title: '采购管理', icon: 'Document' }
      },
      // 开评标管理
      {
        path: 'bid',
        name: 'Bid',
        component: () => import('@/views/bid/Index.vue'),
        meta: { title: '开评标管理', icon: 'DocumentChecked' }
      },
      {
        path: 'bid/submit',
        name: 'BidSubmit',
        component: () => import('@/views/bid/Submit.vue'),
        meta: { title: '供应商端', icon: 'Upload' }
      },
      {
        path: 'bid/open',
        name: 'BidOpen',
        component: () => import('@/views/bid/Open.vue'),
        meta: { title: '开标主持端', icon: 'FolderOpened' }
      },
      {
        path: 'bid/evaluate',
        name: 'BidEvaluate',
        component: () => import('@/views/bid/Evaluate.vue'),
        meta: { title: '专家评标端', icon: 'UserFilled' }
      },
      {
        path: 'bid/supervise',
        name: 'BidSupervise',
        component: () => import('@/views/bid/Supervise.vue'),
        meta: { title: '监督端', icon: 'View' }
      },
      {
        path: 'bid/archive',
        name: 'BidArchive',
        component: () => import('@/views/bid/Archive.vue'),
        meta: { title: '归档端', icon: 'Box' }
      },
      // 专家管理
      {
        path: 'expert',
        name: 'Expert',
        component: () => import('@/views/expert/Index.vue'),
        meta: { title: '专家管理', icon: 'UserFilled' }
      },
      // 供应商管理
      {
        path: 'supplier',
        name: 'Supplier',
        component: () => import('@/views/supplier/Index.vue'),
        meta: { title: '供应商管理', icon: 'User' },
        children: [
          {
            path: '',
            name: 'SupplierHome',
            component: () => import('@/views/supplier/Home.vue'),
            meta: { title: '供应商中心' }
          },
          {
            path: 'register',
            name: 'SupplierRegister',
            component: () => import('@/views/supplier/Register.vue'),
            meta: { title: '供应商注册' }
          },
          {
            path: 'status',
            name: 'SupplierStatus',
            component: () => import('@/views/supplier/Status.vue'),
            meta: { title: '注册状态' }
          },
          {
            path: 'pool',
            name: 'SupplierPool',
            component: () => import('@/views/supplier/List.vue'),
            meta: { title: '供应商库' }
          },
          {
            path: 'detail/:id',
            name: 'SupplierDetail',
            component: () => import('@/views/supplier/Detail.vue'),
            meta: { title: '供应商详情' }
          },
          {
            path: 'audit/:id',
            name: 'SupplierAuditDetail',
            component: () => import('@/views/supplier/Audit.vue'),
            meta: { title: '供应商审核' }
          },
          {
            path: 'change/:id',
            name: 'SupplierChangeDetail',
            component: () => import('@/views/supplier/Change.vue'),
            meta: { title: '信息变更申请' }
          }
        ]
      },
      // 电子商城
      {
        path: 'mall',
        name: 'Mall',
        component: () => import('@/views/mall/Index.vue'),
        meta: { title: '电子商城', icon: 'ShoppingCart' }
      },
      // 信息公告
      {
        path: 'notice',
        name: 'Notice',
        component: () => import('@/views/notice/Index.vue'),
        meta: { title: '信息公告', icon: 'Bell' }
      },
      // 关于我们
      {
        path: 'about',
        name: 'About',
        component: () => import('@/views/About.vue'),
        meta: { title: '关于我们', icon: 'InfoFilled' }
      },
      // 工作台（管理后台入口）
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: '管理工作台', icon: 'DataLine', requiresAuth: true }
      },
      // 评价管理（后台）
      {
        path: 'evaluation',
        name: 'Evaluation',
        component: () => import('@/views/evaluation/Index.vue'),
        meta: { title: '评价管理', icon: 'Star', requiresAuth: true },
        children: [
          {
            path: '',
            name: 'EvaluationList',
            component: () => import('@/views/evaluation/List.vue'),
            meta: { title: '评价列表' }
          },
          {
            path: 'create',
            name: 'EvaluationCreate',
            component: () => import('@/views/evaluation/Create.vue'),
            meta: { title: '发起评价' }
          },
          {
            path: 'detail/:id',
            name: 'EvaluationDetail',
            component: () => import('@/views/evaluation/Detail.vue'),
            meta: { title: '评价详情' }
          },
          {
            path: 'statistics',
            name: 'EvaluationStatistics',
            component: () => import('@/views/evaluation/Statistics.vue'),
            meta: { title: '评价统计' }
          },
          {
            path: 'abnormal',
            name: 'AbnormalRecord',
            component: () => import('@/views/evaluation/Abnormal.vue'),
            meta: { title: '异常记录' }
          },
          {
            path: 'config',
            name: 'EvaluationConfig',
            component: () => import('@/views/evaluation/Config.vue'),
            meta: { title: '指标配置' }
          }
        ]
      }
    ]
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

export default router