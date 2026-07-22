import axios from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 15000,
})

// 标记请求来源门户，后端据此读取对应门户的独立登录 cookie
api.defaults.headers.common['X-Portal'] = 'supplier'

// Response interceptor
api.interceptors.response.use(
  (response) => response.config.responseType === 'blob' ? response : response.data,
  (error) => {
    const status = error.response?.status
    const data = error.response?.data

    if (status === 401) {
      // 登录请求（含「密码正确但待审核/停用」返回的 ACCOUNT_PENDING）由 auth store 处理，
      // 这里不弹「登录已过期」、不跳转，避免在登录页给出误导性提示。
      const code = data?.code
      const isLoginReq = /(^|\/)auth\/login$/.test(String(error.config?.url || ''))
      if (code === 'ACCOUNT_PENDING' || isLoginReq) {
        return Promise.reject(error)
      }
      // 已登录态过期：清本地缓存并回到登录页
      localStorage.removeItem('supplier_user')
      if (router.currentRoute.value.path !== '/login') {
        ElMessage.warning('登录已过期，请重新登录')
        router.push('/login')
      }
    } else if (status === 403) {
      ElMessage.error(data?.error || '无权访问')
    } else if (status === 400) {
      ElMessage.error(data?.error || '请求参数错误')
    } else if (status >= 500) {
      ElMessage.error('服务器错误，请稍后重试')
    }

    return Promise.reject(error)
  },
)

export default api
