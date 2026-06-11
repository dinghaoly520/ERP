import { defineStore } from 'pinia'
import { ref } from 'vue'
import { bidApi } from '@/api/bid'

export const useBidStore = defineStore('bid', () => {
  const projects = ref<any[]>([])
  const currentProject = ref<any>(null)
  const total = ref(0)
  const loading = ref(false)

  async function fetchProjects(page = 1, pageSize = 20) {
    loading.value = true
    try {
      const res = await bidApi.listProjects({ page, pageSize }) as any
      projects.value = Array.isArray(res) ? res : res.items || []
      total.value = res.total || projects.value.length
    } finally {
      loading.value = false
    }
  }

  async function fetchProject(id: string) {
    loading.value = true
    try {
      currentProject.value = await bidApi.getProject(id)
    } finally {
      loading.value = false
    }
  }

  return { projects, currentProject, total, loading, fetchProjects, fetchProject }
})
