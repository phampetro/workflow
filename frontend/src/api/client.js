import axios from 'axios'
import useStore from '../store/useStore'

const api = axios.create({
  baseURL: 'http://localhost:8000',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Interceptor: tự động đính kèm X-User-Id từ store
api.interceptors.request.use((config) => {
  const user = useStore.getState().currentUser
  if (user?.id) {
    config.headers['X-User-Id'] = user.id
  }
  return config
})

// Interceptor log lỗi
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.error || err.message || 'Lỗi kết nối'
    console.error('[API Error]', err.config?.url, msg)
    return Promise.reject(new Error(msg))
  }
)

// ── Users ──────────────────────────────────────────────────
export const getUsers        = ()           => api.get('/api/users')
export const createUser      = (data)       => api.post('/api/users', data)
export const deleteUser      = (id)         => api.delete(`/api/users/${id}`)
export const activateUser    = (id)         => api.post(`/api/users/${id}/activate`)
export const getUserStats    = (id)         => api.get(`/api/users/${id}/stats`)

// ── Dashboard ─────────────────────────────────────────────
export const getDashboardStats = ()         => api.get('/api/dashboard/stats')

// ── Projects ──────────────────────────────────────────────
export const getProjects       = ()           => api.get('/api/projects')
export const getProject        = (id)         => api.get(`/api/projects/${id}`)
export const createProject     = (data)       => api.post('/api/projects', data)
export const updateProject     = (id, data)   => api.put(`/api/projects/${id}`, data)
export const deleteProject     = (id)         => api.delete(`/api/projects/${id}`)
export const reorderProjects   = (items)      => api.put('/api/projects/reorder', items)

// ── Packages ──────────────────────────────────────────────
export const getPackages       = (projectId)  => api.get(`/api/projects/${projectId}/packages`)
export const installPackage    = (projectId, pkg) => api.post(`/api/projects/${projectId}/packages/install`, { package: pkg })
export const uninstallPackage  = (projectId, pkg) => api.post(`/api/projects/${projectId}/packages/uninstall`, { package: pkg })
export const initVenv          = (projectId)  => api.post(`/api/projects/${projectId}/venv/init`)

// ── Workflows ─────────────────────────────────────────────
export const getWorkflows      = (projectId)  => api.get(`/api/projects/${projectId}/workflows`)
export const createWorkflow    = (projectId, data) => api.post(`/api/projects/${projectId}/workflows`, data)
export const getWorkflow       = (id)         => api.get(`/api/workflows/${id}`)
export const updateWorkflow    = (id, data)   => api.put(`/api/workflows/${id}`, data)
export const getWorkflowInput  = (id)         => api.get(`/api/workflows/${id}/input`)
export const updateWorkflowInput = (id, data) => api.put(`/api/workflows/${id}/input`, data)
export const getWorkflowFiles    = (id)         => api.get(`/api/workflows/${id}/files`)
export const getFileColumns      = (id, filename, headerRow) => api.get(`/api/workflows/${id}/file-columns?filename=${encodeURIComponent(filename)}&header_row=${headerRow}`)
export const getFileColumnValues = (id, filename, colName, headerRow) => api.get(`/api/workflows/${id}/file-column-values?filename=${encodeURIComponent(filename)}&col_name=${encodeURIComponent(colName)}&header_row=${headerRow}`)
export const uploadWorkflowFile  = (id, formData) => api.post(`/api/workflows/${id}/files`, formData, { headers: { 'Content-Type': 'multipart/form-data' }})
export const deleteWorkflowFile  = (id, filename) => api.delete(`/api/workflows/${id}/files/${filename}`)
export const openWorkflowFile    = (id, filename) => api.get(`/api/workflows/${id}/files/${filename}/open`)
export const getWorkflowOutputFiles = (id) => api.get(`/api/workflows/${id}/output-files`)
export const deleteWorkflowOutputFile = (id, filename) => api.delete(`/api/workflows/${id}/output-files/${filename}`)
export const openWorkflowOutputFile = (id, filename) => api.get(`/api/workflows/${id}/output-files/${filename}/open`)
export const deleteWorkflow    = (id)         => api.delete(`/api/workflows/${id}`)
export const runWorkflow       = (id)         => api.post(`/api/workflows/${id}/run`)
export const stopWorkflow      = (id)         => api.post(`/api/workflows/${id}/stop`)
export const reorderWorkflows  = (projectId, items) => api.put(`/api/projects/${projectId}/workflows/reorder`, items)

// ── Run History ───────────────────────────────────────────
export const getRunHistory     = (workflowId, limit = 20) => api.get(`/api/workflows/${workflowId}/runs?limit=${limit}`)
export const getRun            = (runId)      => api.get(`/api/runs/${runId}`)

// ── Schedules ─────────────────────────────────────────────
export const getSchedules      = (workflowId) => api.get(`/api/workflows/${workflowId}/schedules`)
export const createSchedule    = (workflowId, data) => api.post(`/api/workflows/${workflowId}/schedules`, data)
export const updateSchedule    = (id, data)   => api.put(`/api/schedules/${id}`, data)
export const deleteSchedule    = (id)         => api.delete(`/api/schedules/${id}`)
export const toggleSchedule    = (id)         => api.patch(`/api/schedules/${id}/toggle`)

// ── SSE Log Streaming ─────────────────────────────────────
export const createLogStream = (runId, onMessage, onError) => {
  const url = `http://localhost:8000/api/runs/${runId}/logs/stream`
  const es = new EventSource(url)
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.type !== 'connected' && data.type !== 'ping') {
        onMessage(data)
      }
    } catch (_) {}
  }
  es.onerror = (err) => {
    if (onError) onError(err)
    es.close()
  }
  return () => es.close()
}

// ── Health ────────────────────────────────────────────────
export const checkHealth = () => api.get('/health')

export default api
