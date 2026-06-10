<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useRoute } from 'vue-router'
import {
  HomeFilled,
  Document,
  DocumentChecked,
  UserFilled,
  User,
  ShoppingCart,
  Bell,
  InfoFilled,
  DataLine,
  Fold,
  Expand,
  SwitchButton,
  Setting
} from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()

// 侧边栏折叠
const isCollapse = ref(false)

// 导航菜单
const navItems = [
  { path: '/home', title: '首页', icon: HomeFilled },
  {
    path: '/procurement',
    title: '采购管理',
    icon: Document,
    children: [
      { path: '/procurement', title: '个人中心' },
      { path: '/procurement/approval', title: '立项申请' },
      { path: '/procurement/database', title: '数据库与数据分析' },
      { path: '/procurement/project', title: '项目管理与归档' },
      { path: '/procurement/write', title: '招标文件编写' },
      { path: '/procurement/review', title: '招标文件审查' }
    ]
  },
  {
    path: '/bid',
    title: '开评标管理',
    icon: DocumentChecked,
    children: [
      { path: '/bid', title: '总览驾驶舱' },
      { path: '/bid/submit', title: '供应商端' },
      { path: '/bid/open', title: '开标主持端' },
      { path: '/bid/evaluate', title: '专家评标端' },
      { path: '/bid/supervise', title: '监督端' },
      { path: '/bid/archive', title: '归档端' }
    ]
  },
  {
    path: '/expert',
    title: '专家管理',
    icon: UserFilled,
    children: [
      { path: '/expert', title: '专家库' },
      { path: '/expert/extract', title: '专家抽取' },
      { path: '/expert/notify', title: '通知确认' },
      { path: '/expert/evaluate', title: '专家评价' }
    ]
  },
  {
    path: '/supplier',
    title: '供应商管理',
    icon: User,
    children: [
      { path: '/supplier', title: '供应商中心' },
      { path: '/supplier/register', title: '供应商注册' },
      { path: '/supplier/pool', title: '供应商库' },
      { path: '/supplier/evaluate', title: '供应商评价' }
    ]
  },
  {
    path: '/mall',
    title: '电子商城',
    icon: ShoppingCart,
    children: [
      { path: '/mall', title: '集中采购' },
      { path: '/mall/employee', title: '员工内购' },
      { path: '/mall/join', title: '商家入驻' },
      { path: '/mall/manage', title: '商家管理' },
      { path: '/mall/welfare', title: '员工福利' }
    ]
  },
  {
    path: '/notice',
    title: '信息公告',
    icon: Bell,
    children: [
      { path: '/notice', title: '招标公告' },
      { path: '/notice/result', title: '中标公示' },
      { path: '/notice/policy', title: '政策法规' },
      { path: '/notice/notify', title: '平台通知' }
    ]
  },
  { path: '/about', title: '关于我们', icon: InfoFilled }
]

// 管理后台菜单（需登录）
const adminItems = [
  { path: '/dashboard', title: '管理工作台', icon: DataLine }
]

// 当前激活菜单
const activeMenu = computed(() => {
  const path = route.path
  // 处理嵌套路由
  if (path.startsWith('/procurement')) return '/procurement'
  if (path.startsWith('/bid')) return '/bid'
  if (path.startsWith('/expert')) return '/expert'
  if (path.startsWith('/supplier')) return '/supplier'
  if (path.startsWith('/mall')) return '/mall'
  if (path.startsWith('/notice')) return '/notice'
  if (path.startsWith('/evaluation')) return '/evaluation'
  if (path.startsWith('/dashboard')) return '/dashboard'
  return path
})

// 用户状态
const isLoggedIn = ref(false)
const userName = ref('')

// 登录/注册模态框
const modalVisible = ref(false)
const modalType = ref('login')
const loginForm = ref({
  account: '',
  password: '',
  companyName: ''
})

const openModal = (type) => {
  modalType.value = type
  modalVisible.value = true
}

const closeModal = () => {
  modalVisible.value = false
  loginForm.value = { account: '', password: '', companyName: '' }
}

const submitForm = () => {
  isLoggedIn.value = true
  userName.value = modalType.value === 'login' ? '管理员' : loginForm.value.companyName
  router.push('/dashboard')
  closeModal()
}

const handleLogout = () => {
  isLoggedIn.value = false
  userName.value = ''
  router.push('/home')
}

const handleCommand = (command) => {
  if (command === 'logout') handleLogout()
  else if (command === 'dashboard') router.push('/dashboard')
}
</script>

<template>
  <el-container class="layout-container">
    <!-- 侧边栏 -->
    <el-aside :width="isCollapse ? '64px' : '220px'" class="layout-aside">
      <div class="logo" @click="router.push('/home')">
        <img src="/assets/logo.jpg" alt="四川水发集团" class="logo-img" />
        <span v-show="!isCollapse" class="logo-text">智慧水发 · ERP系统</span>
      </div>

      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        :collapse-transition="false"
        background-color="#042a58"
        text-color="rgba(255,255,255,0.7)"
        active-text-color="#fff"
        class="layout-menu"
        router
      >
        <!-- 公开页面 -->
        <template v-for="item in navItems" :key="item.path">
          <el-sub-menu v-if="item.children" :index="item.path">
            <template #title>
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.title }}</span>
            </template>
            <el-menu-item v-for="child in item.children" :key="child.path" :index="child.path">
              {{ child.title }}
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.title }}</span>
          </el-menu-item>
        </template>

        <!-- 分隔线 -->
        <div class="menu-divider" v-if="isLoggedIn"></div>

        <!-- 管理后台（仅登录后显示） -->
        <template v-if="isLoggedIn">
          <el-menu-item v-for="item in adminItems" :key="item.path" :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.title }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <!-- 主内容区 -->
    <el-container class="layout-main">
      <!-- 顶部栏 -->
      <el-header class="layout-header">
        <div class="header-left">
          <el-icon class="collapse-btn" @click="isCollapse = !isCollapse">
            <component :is="isCollapse ? Expand : Fold" />
          </el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/home' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="route.meta?.title">{{ route.meta.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <template v-if="isLoggedIn">
            <el-dropdown @command="handleCommand">
              <div class="user-info">
                <el-avatar :size="32" icon="UserFilled" />
                <span class="user-name">{{ userName }}</span>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="dashboard">
                    <el-icon><DataLine /></el-icon>管理后台
                  </el-dropdown-item>
                  <el-dropdown-item command="logout" divided>
                    <el-icon><SwitchButton /></el-icon>退出登录
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <template v-else>
            <el-button link @click="openModal('login')">登录</el-button>
            <el-button type="primary" size="small" @click="openModal('register')">注册</el-button>
          </template>
        </div>
      </el-header>

      <!-- 内容区 -->
      <el-main class="layout-content">
        <RouterView v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </RouterView>
      </el-main>
    </el-container>

    <!-- 登录/注册模态框 -->
    <el-dialog v-model="modalVisible" :title="modalType === 'login' ? '用户登录' : '供应商注册'" width="400px">
      <el-form :model="loginForm" label-width="80px">
        <el-form-item label="账号">
          <el-input v-model="loginForm.account" placeholder="请输入账号/手机号" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="loginForm.password" type="password" placeholder="请输入密码" />
        </el-form-item>
        <el-form-item v-if="modalType === 'register'" label="企业名称">
          <el-input v-model="loginForm.companyName" placeholder="请输入企业名称" />
        </el-form-item>
        <el-form-item v-if="modalType === 'register'" label="信用代码">
          <el-input placeholder="请输入统一社会信用代码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeModal">取消</el-button>
        <el-button type="primary" @click="submitForm">{{ modalType === 'login' ? '登录' : '注册' }}</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<style scoped>
.layout-container {
  height: 100vh;
  overflow: hidden;
}

.layout-aside {
  background: linear-gradient(180deg, #042a58 0%, #064ea2 100%);
  transition: width 0.3s ease;
  overflow: hidden;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  cursor: pointer;
}

.logo-img {
  width: 36px;
  height: 36px;
  border-radius: 4px;
  object-fit: cover;
}

.logo-text {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
}

.layout-menu {
  border-right: none;
  height: calc(100vh - 60px);
  overflow-y: auto;
}

.layout-menu:not(.el-menu--collapse) {
  width: 220px;
}

.layout-menu :deep(.el-menu-item),
.layout-menu :deep(.el-sub-menu__title) {
  height: 48px;
  line-height: 48px;
}

.layout-menu :deep(.el-menu-item:hover),
.layout-menu :deep(.el-sub-menu__title:hover) {
  background-color: rgba(255, 255, 255, 0.1) !important;
}

.layout-menu :deep(.el-menu-item.is-active) {
  background: linear-gradient(90deg, rgba(14, 98, 208, 0.8), transparent) !important;
  border-left: 3px solid #39a8ff;
}

.menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 10px 20px;
}

.layout-main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.layout-header {
  height: 60px;
  background: #fff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.collapse-btn {
  font-size: 20px;
  cursor: pointer;
  color: #536078;
  transition: color 0.2s;
}

.collapse-btn:hover {
  color: #064ea2;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}

.user-info:hover {
  background: #f5f9fd;
}

.user-name {
  font-size: 14px;
  font-weight: 600;
  color: #18243a;
}

.layout-content {
  background: #f6f9fd;
  overflow-y: auto;
  padding: 0;
}

/* 路由过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>