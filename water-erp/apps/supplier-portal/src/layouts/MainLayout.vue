<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSupplierStore } from '@/stores/supplier'
import { useSupplierMenu } from '@/composables/useSupplierMenu'
import { useNotificationStore } from '@/stores/notification'
import { ElMessage, ElMessageBox } from 'element-plus'
import { supplierApi } from '@/api/supplier'
import {
  HomeFilled, OfficeBuilding, EditPen,
  Document, DocumentChecked, Bell, ChatDotRound,
  Fold, Expand, SwitchButton, User, Lock,
  Goods, Connection, Box, ArrowDown,
  Close, View, Hide,
} from '@element-plus/icons-vue'
import BackToTop from '@/components/BackToTop.vue'
import dayjs from 'dayjs'

const router = useRouter()
const route = useRoute()

// Breadcrumbs
const breadcrumbs = computed(() => {
  const crumbs: { label: string; path?: string }[] = []
  const matched = route.matched.filter(r => r.meta?.breadcrumb || r.name)
  for (const r of matched) {
    const label = (r.meta?.breadcrumb as string) || (r.meta?.title as string) || ''
    if (label) crumbs.push({ label, path: r.path !== route.path ? r.path : undefined })
  }
  return crumbs
})
const authStore = useAuthStore()
const notifStore = useNotificationStore()
const supplierStore = useSupplierStore()

const isCollapse = ref(false)
const mobileDrawer = ref(false)
const isMobile = ref(false)
const pwdDialog = ref(false)
const pwdLoading = ref(false)
const pwdShow = ref({ old: false, newPwd: false, confirm: false })
// 关闭即重置（对齐原 el-dialog 的 destroy-on-close 行为）
watch(pwdDialog, (open) => { if (!open) { pwdForm.value = { old: '', newPwd: '', confirm: '' }; pwdShow.value = { old: false, newPwd: false, confirm: false } } })
const pwdForm = ref({ old: '', newPwd: '', confirm: '' })

function checkMobile() {
  isMobile.value = window.innerWidth < 768
  if (isMobile.value) isCollapse.value = true
}
checkMobile()
window.addEventListener('resize', checkMobile)

// Poll unread count every 30s
onMounted(() => {
  notifStore.fetchUnreadCount()
  supplierStore.fetchStatus()  // 获取公司全称，用于顶部栏显示
  const timer = setInterval(() => notifStore.fetchUnreadCount(), 30_000)
  onBeforeUnmount(() => clearInterval(timer))
})

// X-1：菜单权限由集中 composable 驱动（当前基于 isTemporary 布尔，扩展为权限矩阵时只需改 useSupplierMenu）
const { menuItems } = useSupplierMenu()

const activeMenu = computed(() => route.path)
const userInitial = computed(() => (supplierStore.status?.name?.charAt(0) || authStore.displayName?.charAt(0) || 'S'))

// 顶部栏/标题栏统一显示公司全称（非个人姓名）
const companyDisplayName = computed(() => supplierStore.status?.name || authStore.displayName || '')

const notifPopover = ref(false)
const recentNotifs = computed(() => notifStore.notifications.slice(0, 5))

async function handleNotifOpen() {
  notifPopover.value = true
  await notifStore.fetchNotifications(1, 5)
}

function goToNotif(n: any) {
  notifPopover.value = false
  if (n.link) {
    // 通知 link 可能是完整 URL（如 http://localhost:3004/rsvp?t=xxx），Vue Router push 只接受路径
    const url = new URL(n.link, window.location.origin)
    router.push(url.pathname + url.search + url.hash)
  }
  if (!n.isRead) notifStore.markAsRead(n.id)
}

async function handleLogout() {
  await ElMessageBox.confirm('确定要退出登录吗？', '提示', { type: 'warning' })
  await authStore.logout()
}

function handleCommand(cmd: string) {
  if (cmd === 'profile') router.push('/profile')
  else if (cmd === 'password') pwdDialog.value = true
}

// 弹窗底部动态提示：实时校验三段输入（与 ChangeRequest dlg-hint 同交互模式）
const pwdReady = computed(() =>
  pwdForm.value.old.trim().length > 0 &&
  pwdForm.value.newPwd.length >= 6 &&
  pwdForm.value.confirm === pwdForm.value.newPwd)
const pwdHint = computed(() => {
  const { old, newPwd, confirm } = pwdForm.value
  if (!old.trim()) return { text: '请先输入原密码', cls: '' }
  if (newPwd.length === 0) return { text: '请设置新密码', cls: '' }
  if (newPwd.length < 6) return { text: `新密码还差 ${6 - newPwd.length} 位`, cls: '' }
  if (confirm !== newPwd) return { text: '两次输入的密码不一致', cls: '' }
  return { text: '已准备好提交', cls: 'ok' }
})

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
  <div class="sp-layout">
    <!-- Header -->
    <header class="sp-header">
      <div class="sp-header-left">
        <button class="sp-brand" @click="router.push('/dashboard')">
          <img src="/logo.png" alt="智慧水发 · 蜀水云采" class="sp-brand-logo" />
          <strong class="sp-brand-title">智慧水发 · 蜀水云采</strong>
        </button>
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

        <!-- User pill with dropdown -->
        <el-dropdown @command="handleCommand" trigger="click">
          <div class="sp-user-pill">
            <span class="sp-user-avatar">{{ userInitial }}</span>
            <span class="sp-user-name">{{ companyDisplayName }}</span>
            <el-icon class="sp-user-arrow"><ArrowDown /></el-icon>
          </div>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="profile">
                <el-icon><User /></el-icon>企业信息
              </el-dropdown-item>
              <el-dropdown-item command="password">
                <el-icon><Lock /></el-icon>修改密码
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <!-- Logout button -->
        <button class="sp-logout-btn" @click="handleLogout">退出登录</button>
      </div>
    </header>

      <!-- Breadcrumb -->
      <div class="sp-breadcrumb" v-if="breadcrumbs.length > 1">
        <template v-for="(crumb, i) in breadcrumbs" :key="i">
          <router-link v-if="crumb.path" :to="crumb.path" class="sp-breadcrumb-link">{{ crumb.label }}</router-link>
          <span v-else class="sp-breadcrumb-current">{{ crumb.label }}</span>
          <span v-if="i < breadcrumbs.length - 1" class="sp-breadcrumb-sep">/</span>
        </template>
      </div>

    <!-- Body: sidebar + content -->
    <div class="sp-body">
      <!-- Sidebar -->
      <aside class="sp-sidebar" :class="{ collapsed: isCollapse }">
        <nav class="sp-nav">
          <template v-for="(item, idx) in menuItems" :key="idx">
            <!-- Section divider -->
            <div v-if="item.divider && !isCollapse" class="sp-nav-section">
              <span>{{ item.label }}</span>
            </div>
            <div v-else-if="item.divider && isCollapse" class="sp-nav-section-dot" />

            <!-- Nav item -->
            <button
              v-else
              class="sp-nav-item"
              :class="{ active: activeMenu === item.path }"
              @click="handleMenuSelect(item.path!)"
            >
              <span v-if="activeMenu === item.path" class="sp-nav-active-bar" />
              <el-icon class="sp-nav-icon"><component :is="item.icon" /></el-icon>
              <span v-show="!isCollapse" class="sp-nav-text">
                <span class="sp-nav-title">{{ item.title }}</span>
                <span v-if="item.desc" class="sp-nav-desc">{{ item.desc }}</span>
              </span>
              <el-badge
                v-if="item.badge && notifStore.unreadCount > 0 && isCollapse"
                :value="notifStore.unreadCount"
                :max="99"
                class="sp-nav-badge"
              />
            </button>
          </template>
        </nav>

        <!-- Collapse toggle -->
        <button class="sp-collapse-toggle" @click="isCollapse = !isCollapse">
          <el-icon :size="16"><component :is="isCollapse ? Expand : Fold" /></el-icon>
        </button>
      </aside>

      <!-- Main content -->
      <main class="sp-content">
        <RouterView v-slot="{ Component }">
          <transition name="sp-route" mode="out-in">
            <component :is="Component" />
          </transition>
        </RouterView>
      </main>
    </div>

    <!-- Mobile fab -->
    <div v-if="isMobile && !mobileDrawer" class="mobile-fab" @click="mobileDrawer = true">
      <el-icon :size="22"><Fold /></el-icon>
    </div>

    <!-- Mobile navigation drawer (P0/P1: FAB was a dead button before) -->
    <el-drawer v-model="mobileDrawer" direction="ltr" size="272px" :with-header="false" class="sp-mobile-drawer">
      <nav class="sp-nav">
        <template v-for="(item, idx) in menuItems" :key="'m' + idx">
          <div v-if="item.divider" class="sp-nav-section"><span>{{ item.label }}</span></div>
          <button v-else class="sp-nav-item" :class="{ active: activeMenu === item.path }" @click="handleMenuSelect(item.path!)">
            <span v-if="activeMenu === item.path" class="sp-nav-active-bar" />
            <el-icon class="sp-nav-icon"><component :is="item.icon" /></el-icon>
            <span class="sp-nav-text">
              <span class="sp-nav-title">{{ item.title }}</span>
              <span v-if="item.desc" class="sp-nav-desc">{{ item.desc }}</span>
            </span>
          </button>
        </template>
      </nav>
    </el-drawer>

    <!-- Change password dialog — cgzxui neumorphic (ChangeRequest dlg 同款) -->
    <Teleport to="body"><Transition name="pdlg"><div v-if="pwdDialog" class="pwd-ov" @click.self="pwdDialog = false"><div class="pwd-pn">
      <div class="pwd-h">
        <div class="pwd-hl">
          <div class="pwd-hi"><el-icon :size="20"><Lock /></el-icon></div>
          <div>
            <h2 class="pwd-t">修改密码</h2>
            <p class="pwd-sub">修改后下次登录使用新密码</p>
          </div>
        </div>
        <button class="pwd-x" @click="pwdDialog = false"><el-icon :size="18"><Close /></el-icon></button>
      </div>
      <div class="pwd-b">
        <div class="pwd-f">
          <label>原密码 <i>*</i></label>
          <div class="pwd-iw">
            <input class="pwd-inp" v-model="pwdForm.old" :type="pwdShow.old ? 'text' : 'password'" placeholder="请输入当前密码" autocomplete="current-password" />
            <button type="button" class="pwd-eye" :class="{ on: pwdShow.old }" @click="pwdShow.old = !pwdShow.old" tabindex="-1">
              <el-icon :size="15"><component :is="pwdShow.old ? View : Hide" /></el-icon>
            </button>
          </div>
        </div>
        <div class="pwd-f">
          <label>新密码 <i>*</i></label>
          <div class="pwd-iw">
            <input class="pwd-inp" v-model="pwdForm.newPwd" :type="pwdShow.newPwd ? 'text' : 'password'" placeholder="不少于6位，建议字母+数字组合" autocomplete="new-password" />
            <button type="button" class="pwd-eye" :class="{ on: pwdShow.newPwd }" @click="pwdShow.newPwd = !pwdShow.newPwd" tabindex="-1">
              <el-icon :size="15"><component :is="pwdShow.newPwd ? View : Hide" /></el-icon>
            </button>
          </div>
        </div>
        <div class="pwd-f">
          <label>确认新密码 <i>*</i></label>
          <div class="pwd-iw">
            <input class="pwd-inp" v-model="pwdForm.confirm" :type="pwdShow.confirm ? 'text' : 'password'" placeholder="请再次输入新密码" autocomplete="new-password" @keyup.enter="handleChangePassword" />
            <button type="button" class="pwd-eye" :class="{ on: pwdShow.confirm }" @click="pwdShow.confirm = !pwdShow.confirm" tabindex="-1">
              <el-icon :size="15"><component :is="pwdShow.confirm ? View : Hide" /></el-icon>
            </button>
          </div>
        </div>
      </div>
      <div class="pwd-ft">
        <span class="pwd-hint" :class="pwdHint.cls">{{ pwdHint.text }}</span>
        <div class="pwd-acts">
          <button class="neu-btn-soft" @click="pwdDialog = false">取消</button>
          <button class="neu-btn-primary" :disabled="!pwdReady || pwdLoading" @click="handleChangePassword">
            <span v-if="pwdLoading">提交中…</span><template v-else><el-icon :size="15"><Lock /></el-icon>确认修改</template>
          </button>
        </div>
      </div>
    </div></div></Transition></Teleport>
    <BackToTop />
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════
   Shell Layout — matching apps/web AppShell design
   ═══════════════════════════════════════════════════════ */

.sp-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  box-sizing: border-box;
  padding: 0 12px 12px;
  gap: 12px;
  /* 透明：让 App.vue 根的 .flow-glow 水彩光晕直接透出（cgzxui 唯一色彩源）。
     旧的非规范蓝色 radial-gradient + blur 会遮蔽 flow-glow，已移除。 */
  background: transparent;
  color: #18243a;
}

/* ─── Header ─── */
/* :3002 public-portal flow-header 风格：全宽贴顶玻璃条，不浮起，简洁克制 */
.sp-header {
  position: sticky;
  top: 0;
  z-index: 50;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 72px;
  padding: 0 24px;
  /* 半透明底 + blur + 底部 hairline 由 cgzxui.css SHELL OVERRIDE 统一 */
}

.sp-header-left,
.sp-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* Brand */
.sp-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.sp-brand-logo {
  height: 40px;
  width: auto;
  object-fit: contain;
}

.sp-brand-title {
  display: block;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.10em;
  font-family: "SimHei", "黑体", sans-serif;
  background: linear-gradient(to right, #1a2332, #2563EB, #0891b2, #18a56c);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  background-size: 200% auto;
  animation: spBrandShift 6s ease infinite;
}
@keyframes spBrandShift {
  0% { background-position: 0% center; }
  50% { background-position: 100% center; }
  100% { background-position: 0% center; }
}

/* Header icon button */
.sp-header-icon {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #5a6d8a;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.18s ease;
  border: 1px solid #e5ecf4;
  background: #f8fbff;
}

.sp-header-icon:hover {
  color: #064ea2;
  border-color: #bfdbfe;
  background: #eff6ff;
}

/* User pill */
.sp-user-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 12px 4px 4px;
  border-radius: 12px;
  transition: background 0.18s ease;
  border: 1px solid #e5ecf4;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 47, 87, 0.04);
}

.sp-user-pill:hover {
  background: #f8fbff;
  border-color: #bfdbfe;
}

.sp-user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #064ea2, #0b63ce);
  color: #fff;
  font-size: 12px;
  font-weight: 900;
  flex-shrink: 0;
}

.sp-user-name {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 800;
  color: #18243a;
}

.sp-user-arrow {
  color: #8a96aa;
  font-size: 12px;
}

/* Logout button */
.sp-logout-btn {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 12px;
  border: 1px solid #d5e0ef;
  background: #fff;
  color: #5a6d8a;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.sp-logout-btn:hover {
  border-color: #e74c3c;
  color: #e74c3c;
}

/* ─── Breadcrumb ─── */
.sp-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border-radius: 12px;
  background: oklch(0.99 0.004 258 / 0.55);
  font-size: 13px;
  flex-shrink: 0;
}
.sp-breadcrumb-link {
  color: var(--sp-gray-400);
  font-weight: 600;
  transition: color 0.15s;
}
.sp-breadcrumb-link:hover { color: var(--sp-primary); }
.sp-breadcrumb-current {
  color: var(--sp-gray-700);
  font-weight: 800;
}
.sp-breadcrumb-sep {
  color: var(--sp-gray-300);
  font-size: 11px;
}

/* ─── Body ─── */
.sp-body {
  display: flex;
  gap: 12px;
  flex: 1;
  overflow: hidden;
}

/* ─── Sidebar ─── */
.sp-sidebar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 272px;
  margin: 0;
  overflow: hidden;
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.50);
  background: rgba(255, 255, 255, 0.74);
  backdrop-filter: blur(18px) saturate(1.2);
  -webkit-backdrop-filter: blur(18px) saturate(1.2);
  box-shadow: 0 18px 60px rgba(15, 47, 87, 0.10);
  transition: width 0.2s ease;
  position: relative;
}
.sp-sidebar::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.44;
  border-radius: 24px;
  background-image:
    radial-gradient(ellipse at 10% 6%,  rgba(168, 139, 250, 0.20), transparent 55%),
    radial-gradient(ellipse at 85% 12%, rgba(192, 132, 252, 0.12), transparent 55%),
    radial-gradient(ellipse at 40% 90%, rgba(91, 33, 182, 0.07),  transparent 55%);
  animation: glass-glow-drift 18s ease-in-out infinite;
}
.sp-sidebar:hover::before { opacity: 0.58; }
.sp-sidebar > * { position: relative; z-index: 1; }

.sp-sidebar.collapsed {
  width: 68px;
}

/* Nav */
.sp-nav {
  flex: 1;
  overflow-y: auto;
  padding: 12px 8px;
}

.sp-nav::-webkit-scrollbar {
  width: 0;
}

/* Section divider */
.sp-nav-section {
  padding: 16px 12px 6px;
  color: #8a96aa;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.sp-nav-section-dot {
  height: 8px;
}

/* Nav item */
.sp-nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  margin-bottom: 4px;
  border: none;
  border-radius: 16px;
  background: transparent;
  color: #5a6d8a;
  text-align: left;
  cursor: pointer;
  transition: all 0.18s ease;
  font-size: 14px;
}

.sp-nav-item:hover {
  background: #eff6ff;
  color: #064ea2;
}

.sp-nav-item.active {
  background: linear-gradient(90deg, #064ea2, #0b63ce);
  color: #fff;
  box-shadow: 0 12px 28px rgba(6, 78, 162, 0.24);
}

.sp-nav-active-bar {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 24px;
  border-radius: 0 3px 3px 0;
  background: #67e8f9;
}

.sp-nav-icon {
  flex-shrink: 0;
  font-size: 18px;
}

.sp-sidebar.collapsed .sp-nav-icon {
  font-size: 20px;
}

.sp-nav-text {
  flex: 1;
  min-width: 0;
}

.sp-nav-title {
  display: block;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.sp-nav-desc {
  display: block;
  margin-top: 1px;
  font-size: 11px;
  opacity: 0.7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sp-nav-item.active .sp-nav-desc {
  opacity: 0.75;
}

.sp-nav-badge {
  position: absolute;
  top: 6px;
  right: 6px;
}

.sp-nav-badge :deep(.el-badge__content) {
  font-size: 10px;
}

/* Collapse toggle */
.sp-collapse-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  margin: 8px;
  border-radius: 16px;
  border: 1px solid #e5ecf4;
  background: #f8fbff;
  color: #5a6d8a;
  cursor: pointer;
  transition: all 0.18s ease;
}

.sp-collapse-toggle:hover {
  border-color: #bfdbfe;
  color: #064ea2;
}

/* ─── Content ─── */
.sp-content {
  position: relative;
  z-index: 0;
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 24px;
  /* 透明：透出 App.vue 根的 .flow-glow 水彩光晕（cgzxui 唯一色彩源）。
     内容卡片自带玻璃/渐变底，不依赖内容区背景。 */
  background: transparent;
}
/* ─── Notification popover ─── */
.sp-notif-popover {
  margin: -12px;
  max-height: 420px;
  overflow: auto;
}

.sp-notif-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #dbe7f3;
}

.sp-notif-title {
  font-weight: 900;
  font-size: 15px;
}

.sp-notif-empty {
  padding: 40px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}

.sp-notif-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}

.sp-notif-item:hover {
  background: #f8fafc;
}

.sp-notif-item.unread {
  background: #f0f7ff;
}

.sp-notif-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #0756a5;
  margin-top: 6px;
  flex-shrink: 0;
}

.sp-notif-content {
  flex: 1;
  min-width: 0;
}

.sp-notif-item-title {
  font-weight: 700;
  font-size: 13px;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sp-notif-item-desc {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sp-notif-item-time {
  font-size: 11px;
  color: #94a3b8;
  margin-top: 4px;
}

.sp-notif-footer {
  text-align: center;
  padding: 12px;
  border-top: 1px solid #dbe7f3;
  color: #0756a5;
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  transition: background 0.15s;
}

.sp-notif-footer:hover {
  background: #e8f4ff;
}

/* ─── Route transitions ─── */
.sp-route-enter-active,
.sp-route-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.sp-route-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.sp-route-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* ─── Mobile ─── */
.mobile-fab {
  position: fixed;
  bottom: 24px;
  left: 24px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #0756a5;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(10, 94, 184, 0.4);
  cursor: pointer;
  z-index: 100;
  transition: transform 0.2s;
}

.mobile-fab:hover {
  transform: scale(1.1);
}

@media (max-width: 768px) {
  .sp-sidebar {
    display: none;
  }

  .sp-header {
    padding: 0 14px;
  }

  .sp-user-name {
    display: none;
  }
}

/* ═══════════════════════════════════════════════════════════
   Change password dialog — cgzxui neumorphic
   规格对齐 ChangeRequest .dlg-*（同款头部图标井 / footer hint / neu 按钮）
   ═══════════════════════════════════════════════════════════ */
.pwd-ov { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 32px; background: oklch(0.35 0.06 258 / 0.28); }
.pwd-pn { position: relative; width: 420px; max-width: 100%; display: flex; flex-direction: column; overflow: hidden; border-radius: 20px; background: linear-gradient(180deg, oklch(0.995 0.008 258), oklch(0.97 0.012 258)); box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.75), 0 20px 60px oklch(0.3 0.05 258 / 0.18); }

.pwd-h { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 26px 16px; border-bottom: 1px solid var(--hairline); }
.pwd-hl { display: flex; align-items: center; gap: 14px; min-width: 0; }
.pwd-hi { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: oklch(0.985 0.005 258); color: var(--brand); box-shadow: inset 2.5px 2.5px 5px oklch(0.55 0.03 258 / 0.14), inset -2px -2px 5px oklch(1 0 0 / 0.75); flex-shrink: 0; }
.pwd-t { margin: 0; font-size: 18px; font-weight: 900; color: var(--foreground); }
.pwd-sub { margin: 3px 0 0; font-size: 12px; color: var(--muted-foreground); }
.pwd-x { width: 34px; height: 34px; border-radius: 10px; border: none; background: var(--surface); color: var(--muted-foreground); cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85); transition: all .2s ease; }
.pwd-x:hover { color: var(--brand); transform: translateY(-1px); }
.pwd-x:active { box-shadow: inset 2px 2px 5px oklch(0.55 0.03 258 / 0.15), inset -2px -2px 5px oklch(1 0 0 / 0.5); }

.pwd-b { padding: 20px 26px 6px; display: flex; flex-direction: column; gap: 16px; }
.pwd-f { display: flex; flex-direction: column; gap: 7px; }
.pwd-f label { font-size: 12.5px; font-weight: 700; color: var(--foreground); }
.pwd-f label i { color: var(--danger); font-style: normal; }
.pwd-iw { position: relative; }
.pwd-inp { width: 100%; height: 44px; padding: 0 42px 0 14px; font: inherit; font-size: 14px; color: var(--ink); background: oklch(0.99 0.004 258); border: 1px solid oklch(0.78 0.03 258 / 0.4); border-radius: 9px; outline: none; box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.1), inset -2px -2px 4px oklch(1 0 0 / 0.7); transition: all .2s ease; }
.pwd-inp::placeholder { color: oklch(0.74 0.02 258); }
.pwd-inp:focus { border-color: oklch(0.5 0.16 258 / 0.5); box-shadow: inset 2px 2px 4px oklch(0.55 0.03 258 / 0.08), inset -2px -2px 4px oklch(1 0 0 / 0.5), 0 0 0 3px oklch(0.5 0.16 258 / 0.08); }
.pwd-eye { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; border: none; border-radius: 8px; background: transparent; color: oklch(0.62 0.02 258); cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .2s ease; }
.pwd-eye:hover { color: var(--brand); background: oklch(0.5 0.16 258 / 0.06); }
.pwd-eye.on { color: var(--brand); }

.pwd-ft { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 26px; border-top: 1px solid var(--hairline); background: oklch(1 0 0 / 0.3); }
.pwd-hint { font-size: 12px; color: var(--muted-foreground); }
.pwd-hint.ok { color: var(--success); font-weight: 700; }
.pwd-acts { display: flex; align-items: center; gap: 10px; }
/* footer 内按钮统一 38px（cgzxui .neu-btn-group 规范：主次按钮等高） */
.pwd-acts .neu-btn-primary { height: 38px; font-size: 13px; padding: 0 20px; }
.pwd-acts .neu-btn-soft { height: 38px; }

/* 过渡 — 同 ChangeRequest dlg */
.pdlg-enter-active, .pdlg-leave-active { transition: opacity .22s; }
.pdlg-enter-active .pwd-pn, .pdlg-leave-active .pwd-pn { transition: transform .26s cubic-bezier(.22,.61,.36,1), opacity .22s; }
.pdlg-enter-from, .pdlg-leave-to { opacity: 0; }
.pdlg-enter-from .pwd-pn, .pdlg-leave-to .pwd-pn { transform: scale(.96) translateY(12px); opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .pwd-x, .pwd-eye, .pwd-inp { transition: none !important; }
  .pdlg-enter-active, .pdlg-leave-active,
  .pdlg-enter-active .pwd-pn, .pdlg-leave-active .pwd-pn { transition: none !important; }
}
</style>
