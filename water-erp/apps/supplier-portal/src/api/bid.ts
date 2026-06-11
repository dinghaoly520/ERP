import api from './index'

export const bidApi = {
  listProjects(params?: { page?: number; pageSize?: number }) {
    return api.get('/bid/projects', { params })
  },
  getProject(id: string) {
    return api.get(`/bid/projects/${id}`)
  },
  listSuppliers(projectId: string) {
    return api.get(`/bid/projects/${projectId}/suppliers`)
  },
  listClarifications(projectId: string) {
    return api.get(`/bid/projects/${projectId}/clarifications`)
  },
}
