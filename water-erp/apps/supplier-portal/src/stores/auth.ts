import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '@/api/auth'
import router from '@/router'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<any>(null)
  const loading = ref(false)
  // 登录被「待审核/停用」拦截时存放专用码，供登录页引导「查询审核进度」，而非泛报密码错误。
  const pendingInfo = ref<{ code: string } | null>(null)

  const isLoggedIn = computed(() => !!user.value)
  const isSupplier = computed(() => user.value?.role === 'supplier')
  const displayName = computed(() => user.value?.displayName || user.value?.username || '')

  async function init() {
    const cached = localStorage.getItem('supplier_user')
    if (cached) {
      try { user.value = JSON.parse(cached) } catch {}
    }
    try {
      const me = await authApi.getMe() as any
      user.value = me
      localStorage.setItem('supplier_user', JSON.stringify(me))
    } catch {
      user.value = null
      localStorage.removeItem('supplier_user')
    }
  }

  async function login(username: string, password: string) {
    loading.value = true
    pendingInfo.value = null
    try {
      const res = await authApi.login({ username, password }) as any
      if (res.access_token || res) {
        await init()
        return 'ok'
      }
      return 'invalid'
    } catch (e: any) {
      // 后端对「密码正确但 isActive:false」返回 401 + code=ACCOUNT_PENDING。
      // 返回 'pending' 让登录页只显示「查询审核进度」面板，而不误报「用户名或密码错误」。
      const code = e?.response?.data?.code
      if (code === 'ACCOUNT_PENDING') {
        pendingInfo.value = { code }
        return 'pending'
      }
      if (code === 'TEMPORARY_EXPIRED') {
        pendingInfo.value = { code }
        return 'expired'
      }
      return 'invalid'
    } finally {
      loading.value = false
    }
  }

  async function register(data: any) {
    loading.value = true
    try {
      await authApi.register(data)
      // After register, auto-login
      await login(data.username, data.password)
      return true
    } catch {
      return false
    } finally {
      loading.value = false
    }
  }

  async function logout() {
    await authApi.logout()
    user.value = null
    localStorage.removeItem('supplier_user')
    router.push('/login')
  }

  return { user, loading, pendingInfo, isLoggedIn, isSupplier, displayName, init, login, register, logout }
})
