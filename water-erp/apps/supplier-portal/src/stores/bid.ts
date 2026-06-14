import { defineStore } from 'pinia'
import { ref } from 'vue'
import { bidApi } from '@/api/bid'

export const useBidStore = defineStore('bid', () => {
  const projects = ref<any[]>([])
  const currentProject = ref<any>(null)
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchProjects(page = 1, pageSize = 20) {
    loading.value = true
    error.value = null
    try {
      const res = await bidApi.listProjects({ page, pageSize }) as any
      projects.value = Array.isArray(res) ? res : res.items || []
      total.value = res.total || projects.value.length
    } catch (e: any) {
      error.value = e?.response?.data?.error || e?.message || '加载招标项目失败'
    } finally {
      loading.value = false
    }
  }

  async function fetchProject(id: string) {
    loading.value = true
    error.value = null
    try {
      currentProject.value = await bidApi.getProject(id)
    } catch (e: any) {
      error.value = e?.response?.data?.error || e?.message || '加载项目详情失败'
    } finally {
      loading.value = false
    }
  }

  return { projects, currentProject, total, loading, error, fetchProjects, fetchProject }
})
