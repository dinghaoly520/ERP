import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '@/api/auth'
import router from '@/router'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<any>(null)
  const loading = ref(false)

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
    try {
      const res = await authApi.login({ username, password }) as any
      if (res.access_token || res) {
        await init()
        return true
      }
      return false
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

  return { user, loading, isLoggedIn, isSupplier, displayName, init, login, register, logout }
})
