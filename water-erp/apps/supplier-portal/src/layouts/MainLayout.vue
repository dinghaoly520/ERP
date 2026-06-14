<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useNotificationStore } from '@/stores/notification'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import {
  HomeFilled, Stamp, OfficeBuilding, Medal, Phone, EditPen,
  Document, DocumentChecked, Bell, ChatDotRound, Star,
  Fold, Expand, SwitchButton, User, Lock, ArrowDown,
  Goods, Connection, Box,
} from '@element-plus/icons-vue'
import dayjs from 'dayjs'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const notifStore = useNotificationStore()

const isCollapse = ref(false)
const mobileDrawer = ref(false)
const isMobile = ref(false)
const pwdDialog = ref(false)
const pwdLoading = ref(false)
const pwdForm = ref({ old: '', newPwd: '', confirm: '' })

function checkMobile() {
  isMobile.value = window.innerWidth < 768
  if (isMobile.value) isCollapse.value = true
}
checkMobile()
window.addEventListener('resize', checkMobile)

const menuItems = [
  { path: '/dashboard', title: '业务工作台', icon: HomeFilled, desc: '状态与待办总览' },
  { divider: true, label: '投标中心' },
  { path: '/bids', title: '招标机会', icon: Document, desc: '发现可参与项目' },
  { path: '/my-bids', title: '投标进展', icon: DocumentChecked, desc: '跟踪已投项目' },
  { divider: true, label: '供货合作' },
  { path: '/catalog', title: '采购目录', icon: Goods, desc: '浏览品类并申请供货' },
  { path: '/catalog-applications', title: '供货申请', icon: Connection, desc: '申请进度与议价' },
  { path: '/supply', title: '我的供货', icon: Box, desc: '已准入品类与报价' },
  { divider: true, label: '企业档案' },
  { path: '/onboarding', title: '入驻状态', icon: Stamp, desc: '审核与补正进度' },
  { path: '/profile', title: '企业信息', icon: OfficeBuilding, desc: '主体资料维护' },
  { path: '/qualifications', title: '资质与证照', icon: Medal, desc: '证照有效期管理' },
  { path: '/contacts', title: '联系人', icon: Phone, desc: '业务联系人维护' },
  { path: '/change-records', title: '资料变更申请', icon: EditPen, desc: '变更审核记录' },
  { divider: true, label: '信息中心' },
  { path: '/announcements', title: '公告公示', icon: Bell, desc: '公告与政策' },
  { path: '/notifications', title: '消息通知', icon: ChatDotRound, badge: true, desc: '平台消息' },
  { path: '/evaluations', title: '履约评价', icon: Star, desc: '评价记录' },
]

const activeMenu = computed(() => route.path)
const activeMenuItem = computed(() => menuItems.find((item: any) => item.path === route.path))

const notifPopover = ref(false)
const recentNotifs = computed(() => notifStore.notifications.slice(0, 5))

async function handleNotifOpen() {
  notifPopover.value = true
  await notifStore.fetchNotifications(1, 5)
}

function goToNotif(n: any) {
  notifPopover.value = false
  if (n.link) router.push(n.link)
  if (!n.isRead) notifStore.markAsRead(n.id)
}

async function handleLogout() {
  await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' })
  await authStore.logout()
}

function handleCommand(cmd: string) {
  if (cmd === 'logout') handleLogout()
  else if (cmd === 'profile') router.push('/profile')
  else if (cmd === 'password') pwdDialog.value = true
}

async function handleChangePassword() {
  if (pwdForm.value.newPwd !== pwdForm.value.confirm) { ElMessage.warning('两次密码不一致'); return }
  if (pwdForm.value.newPwd.length < 6) { ElMessage.warning('密码不少于6位'); return }
  pwdLoading.value = true
  try {
    await supplierApi.changePassword(pwdForm.value.old, pwdForm.value.newPwd)
    ElMessage.success('密码修改成功')
    pwdDialog.value = false
    pwdForm.value = { old: '', newPwd: '', confirm: '' }
  } catch { ElMessage.error('密码修改失败') }
  finally { pwdLoading.value = false }
}

function handleMenuSelect(path: string) {
  if (isMobile.value) mobileDrawer.value = false
  router.push(path)
}

notifStore.fetchUnreadCount()
</script>

<template>
  <el-container class="sp-layout">
    <!-- Sidebar -->
    <el-aside :width="isCollapse ? '68px' : '256px'" class="sp-sidebar">
      <div class="sp-sidebar-logo" @click="router.push('/dashboard')">
        <img src="/logo.jpg" alt="四川水发集团" class="sp-logo-img" />
        <transition name="sp-fade">
          <div v-show="!isCollapse" class="sp-logo-text">
            <span class="sp-logo-title">四川水发集团</span>
            <span class="sp-logo-sub">供应商业务门户</span>
          </div>
        </transition>
      </div>

      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        :collapse-transition="false"
        background-color="transparent"
        text-color="#5a6d8a"
        active-text-color="#064ea2"
        class="sp-sidebar-menu"
        router
      >
        <template v-for="(item, idx) in menuItems" :key="idx">
          <div v-if="item.divider" class="sp-menu-section" v-show="!isCollapse">
            <span>{{ item.label }}</span>
          </div>
          <div v-else class="sp-menu-section-dot" v-show="isCollapse" />
          <el-menu-item v-if="item.path" :index="item.path" class="sp-menu-item">
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>
              <span>{{ item.title }}</span>
              <el-badge v-if="item.badge && notifStore.unreadCount > 0" :value="notifStore.unreadCount" :max="99" class="sp-menu-badge" />
            </template>
          </el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <!-- Main content -->
    <el-container class="sp-main">
      <!-- Top bar -->
      <el-header class="sp-header" height="68px">
        <div class="sp-header-left">
          <div class="sp-collapse-btn" @click="isCollapse = !isCollapse">
            <el-icon :size="16"><component :is="isCollapse ? Expand : Fold" /></el-icon>
          </div>
          <div class="sp-header-title-wrap">
            <div class="sp-header-title">{{ activeMenuItem?.title || route.meta?.title || '供应商门户' }}</div>
          </div>
        </div>

        <div class="sp-header-right">
          <!-- Notification bell -->
          <el-popover
            v-model:visible="notifPopover"
            placement="bottom-end"
            :width="360"
            trigger="click"
            @show="handleNotifOpen"
          >
            <template #reference>
              <el-badge :value="notifStore.unreadCount" :max="99" :hidden="notifStore.unreadCount === 0">
                <div class="sp-header-icon">
                  <el-icon :size="18"><Bell /></el-icon>
                </div>
              </el-badge>
            </template>
            <div class="sp-notif-popover">
              <div class="sp-notif-header">
                <span class="sp-notif-title">消息通知</span>
                <el-button link type="primary" size="small" @click="notifStore.markAllAsRead(); notifStore.fetchUnreadCount()">
                  全部已读
                </el-button>
              </div>
              <div v-if="recentNotifs.length === 0" class="sp-notif-empty">暂无消息</div>
              <div
                v-for="n in recentNotifs"
                :key="n.id"
                class="sp-notif-item"
                :class="{ unread: !n.isRead }"
                @click="goToNotif(n)"
              >
                <div class="sp-notif-dot" v-if="!n.isRead"></div>
                <div class="sp-notif-content">
                  <div class="sp-notif-item-title">{{ n.title }}</div>
                  <div class="sp-notif-item-desc">{{ n.content }}</div>
                  <div class="sp-notif-item-time">{{ dayjs(n.createdAt).format('MM-DD HH:mm') }}</div>
                </div>
              </div>
              <div class="sp-notif-footer" @click="router.push('/notifications'); notifPopover = false">
                查看全部消息
              </div>
            </div>
          </el-popover>

          <!-- User dropdown -->
          <el-dropdown @command="handleCommand" trigger="click">
            <div class="sp-user-bar">
              <el-avatar :size="34" :style="{ background: 'linear-gradient(135deg, #064ea2, #0b63ce)', fontWeight: 700, fontSize: '14px' }">
                {{ authStore.displayName?.charAt(0) || 'S' }}
              </el-avatar>
              <span class="sp-user-name">{{ authStore.displayName }}</span>
              <el-icon><ArrowDown /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">
                  <el-icon><User /></el-icon>企业信息
                </el-dropdown-item>
                <el-dropdown-item command="password">
                  <el-icon><Lock /></el-icon>修改密码
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided>
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- Page content -->
      <el-main class="sp-content">
        <RouterView v-slot="{ Component }">
          <transition name="sp-route" mode="out-in">
            <component :is="Component" />
          </transition>
        </RouterView>
      </el-main>
    </el-container>

    <!-- Mobile overlay -->
    <div v-if="isMobile && !mobileDrawer" class="mobile-fab" @click="mobileDrawer = true">
      <el-icon :size="22"><Fold /></el-icon>
    </div>

    <!-- Change password dialog -->
    <el-dialog v-model="pwdDialog" title="修改密码" width="420px" destroy-on-close>
      <el-form :model="pwdForm" label-width="90px" size="large">
        <el-form-item label="原密码"><el-input v-model="pwdForm.old" type="password" placeholder="请输入当前密码" show-password /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="pwdForm.newPwd" type="password" placeholder="不少于6位" show-password /></el-form-item>
        <el-form-item label="确认密码"><el-input v-model="pwdForm.confirm" type="password" placeholder="请再次输入新密码" show-password /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdDialog = false">取消</el-button>
        <el-button type="primary" :loading="pwdLoading" @click="handleChangePassword">确认修改</el-button>
      </template>
    </el-dialog>
  </el-container>
</template>

<style scoped>
.sp-layout {
  height: 100vh;
  overflow: hidden;
  background: var(--sp-bg);
}

.sp-sidebar {
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid #dbe6f3;
  box-shadow: 0 18px 60px rgba(15, 47, 87, 0.08);
  border-radius: 0 24px 24px 0;
  margin: 12px 0 12px 0;
  transition: width 0.25s var(--sp-ease);
}

.sp-sidebar::-webkit-scrollbar { width: 0; }

.sp-sidebar-logo {
  height: 68px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 10px;
  border-bottom: 1px solid #edf3fb;
  cursor: pointer;
  flex-shrink: 0;
}

.sp-logo-img {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid #dbeafe;
}

.sp-logo-text { display: flex; flex-direction: column; min-width: 0; }
.sp-logo-title { color: #123a6e; font-size: 14px; font-weight: 900; line-height: 1.2; letter-spacing: 0.06em; font-family: "SimHei","黑体",sans-serif; }
.sp-logo-sub { margin-top: 2px; color: #8a96aa; font-size: 11px; line-height: 1.2; font-weight: 600; }

.sp-sidebar-menu {
  border-right: none !important;
  flex: 1;
  padding: 10px 8px 18px;
  background: transparent !important;
}

.sp-sidebar-menu:not(.el-menu--collapse) { width: 256px; }

.sp-menu-section {
  padding: 18px 12px 7px;
  color: #8a96aa;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.sp-menu-section-dot { height: 12px; }

.sp-menu-item {
  height: 42px !important;
  line-height: 42px !important;
  margin: 3px 0;
  border-radius: 14px !important;
  color: #5a6d8a !important;
  transition: all 0.18s var(--sp-ease);
}

.sp-menu-item:hover { background: #eff6ff !important; color: #064ea2 !important; }
.sp-menu-item.is-active {
  background: linear-gradient(90deg, #064ea2, #0b63ce) !important;
  color: #fff !important;
  box-shadow: 0 12px 28px rgba(6, 78, 162, 0.22);
}
.sp-menu-badge :deep(.el-badge__content) { font-size: 10px; }

.sp-main { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }

.sp-header {
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 28px;
  z-index: 10;
  background: rgba(255, 255, 255, 0.86);
  border-bottom: 1px solid #dbe6f3;
  box-shadow: 0 6px 24px rgba(4, 42, 88, 0.04);
  backdrop-filter: blur(16px);
}

.sp-header-left,
.sp-header-right { display: flex; align-items: center; gap: 14px; }

.sp-collapse-btn,
.sp-header-icon {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #5a6d8a;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.18s var(--sp-ease);
  border: 1px solid #e5ecf4;
  background: #f8fbff;
}

.sp-collapse-btn:hover,
.sp-header-icon:hover { color: #064ea2; border-color: #bfdbfe; background: #eff6ff; }

.sp-header-title-wrap { display: flex; flex-direction: column; }
.sp-header-title { color: #0f2f57; font-size: 16px; font-weight: 900; line-height: 1.2; }

.sp-user-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  transition: background 0.18s var(--sp-ease);
  border: 1px solid #e5ecf4;
  background: #fff;
}

.sp-user-bar:hover { background: #f8fbff; border-color: #bfdbfe; }
.sp-user-name { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 800; color: #18243a; }

.sp-notif-popover { margin: -12px; max-height: 420px; overflow: auto; }
.sp-notif-header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--sp-border); }
.sp-notif-title { font-weight: 900; font-size: 15px; }
.sp-notif-empty { padding: 40px; text-align: center; color: var(--sp-gray-400); font-size: 13px; }
.sp-notif-item { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; cursor: pointer; transition: background 0.15s; position: relative; }
.sp-notif-item:hover { background: var(--sp-gray-50); }
.sp-notif-item.unread { background: #f0f7ff; }
.sp-notif-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sp-primary); margin-top: 6px; flex-shrink: 0; }
.sp-notif-content { flex: 1; min-width: 0; }
.sp-notif-item-title { font-weight: 700; font-size: 13px; color: var(--sp-gray-900); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sp-notif-item-desc { font-size: 12px; color: var(--sp-gray-500); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-notif-item-time { font-size: 11px; color: var(--sp-gray-400); margin-top: 4px; }
.sp-notif-footer { text-align: center; padding: 12px; border-top: 1px solid var(--sp-border); color: var(--sp-primary); font-size: 13px; font-weight: 800; cursor: pointer; transition: background 0.15s; }
.sp-notif-footer:hover { background: var(--sp-primary-lighter); }

.sp-content {
  background: radial-gradient(circle at 8% 0%, rgba(6, 78, 162, 0.08), transparent 30%),
              radial-gradient(circle at 88% 8%, rgba(22, 132, 216, 0.06), transparent 26%),
              linear-gradient(180deg, #f7fbff 0%, #f8fafc 100%);
  background-image:
    linear-gradient(rgba(6, 78, 162, 0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(6, 78, 162, 0.025) 1px, transparent 1px);
  background-size: 28px 28px;
  overflow-y: auto;
  padding: 0;
}

.mobile-fab { position: fixed; bottom: 24px; left: 24px; width: 48px; height: 48px; border-radius: 50%; background: var(--sp-primary); color: #fff; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 16px rgba(10, 94, 184, 0.4); cursor: pointer; z-index: 100; transition: transform 0.2s; }
.mobile-fab:hover { transform: scale(1.1); }

.sp-route-enter-active,
.sp-route-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.sp-route-enter-from { opacity: 0; transform: translateY(6px); }
.sp-route-leave-to { opacity: 0; transform: translateY(-4px); }
.sp-fade-enter-active,
.sp-fade-leave-active { transition: opacity 0.2s; }
.sp-fade-enter-from,
.sp-fade-leave-to { opacity: 0; }

@media (max-width: 768px) {
  .sp-sidebar { display: none; }
  .sp-header { padding: 0 14px; }
  .sp-user-name { display: none; }
}
</style>
