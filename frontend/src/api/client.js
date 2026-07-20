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
  (res) => {
    // 204 No Content -> trả về rỗng, không lỗi
    if (res.status === 204) return res
    return res
  },
  (err) => {
    const msg = err.response?.data?.error || err.response?.data?.detail || err.message || 'Lỗi kết nối'
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
export const reorderProjects   = (items)      => api.put('/api/projects/reorder/items', items)
export const importProject     = (formData)   => api.post('/api/projects/import', formData, { headers: { 'Content-Type': 'multipart/form-data' }})
// Note: exportProject and exportWorkflow will be handled directly via browser URL download

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
export const duplicateWorkflow = (id)         => api.post(`/api/workflows/${id}/duplicate`)
export const importWorkflow    = (projectId, formData) => api.post(`/api/projects/${projectId}/workflows/import`, formData, { headers: { 'Content-Type': 'multipart/form-data' }})
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

// ── Telegram Listener ─────────────────────────────────────
// Listener chỉ bật/tắt theo nút Chạy/Dừng của workflow (xem BlockEditorModal), đây chỉ để đọc trạng thái.
export const getListenerStatus   = (wfId) => api.get(`/api/workflows/${wfId}/listener/status`)

// ── Run History ───────────────────────────────────────────
export const getRunHistory     = (workflowId, limit = 20) => api.get(`/api/workflows/${workflowId}/runs?limit=${limit}`)
export const deleteRunHistory  = (workflowId) => api.delete(`/api/workflows/${workflowId}/runs`)
export const getRun            = (runId)      => api.get(`/api/runs/${runId}`)

// ── Schedules ─────────────────────────────────────────────
export const getSchedules      = (workflowId) => api.get(`/api/workflows/${workflowId}/schedules`)
export const createSchedule    = (workflowId, data) => api.post(`/api/workflows/${workflowId}/schedules`, data)
export const updateSchedule    = (id, data)   => api.put(`/api/schedules/${id}`, data)
export const deleteSchedule    = (id)         => api.delete(`/api/schedules/${id}`)
export const toggleSchedule    = (id)         => api.patch(`/api/schedules/${id}/toggle`)

// ── SSE Log Streaming ─────────────────────────────────────
export const createLogStream = (runId, onMessage, onError, offset = 0) => {
  const url = `${api.defaults.baseURL}/api/runs/${runId}/logs/stream?offset=${offset}`
  const es = new EventSource(url)
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data)
      // Backend sends: { run_id, block_id, level, message, time }
      // Only process if it has the expected fields
      if (data.run_id && data.message) {
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

// ── Database ────────────────────────────────────────────────
export const getDatabaseTables = (config) => api.post('/api/database/tables', config)
export const getDatabaseColumns = (payload) => api.post('/api/database/columns', payload)
export const getDbConnections = (workflowId) => api.get('/api/database/connections', { params: { workflow_id: workflowId } })
export const createDbConnection = (data) => api.post('/api/database/connections', data)
export const updateDbConnection = (id, data) => api.put(`/api/database/connections/${id}`, data)
export const deleteDbConnection = (id) => api.delete(`/api/database/connections/${id}`)

// ── AI Code Assistant ─────────────────────────────────────
export const getAiSettings   = ()      => api.get('/api/ai/settings')
export const saveAiSettings  = (data)  => api.put('/api/ai/settings', data)
export const testAiSettings  = ()      => api.post('/api/ai/test')

// Stream sinh code qua fetch + ReadableStream (POST body lớn, không dùng EventSource).
// Trả về hàm cancel() để dừng giữa chừng.
export const streamAiCodegen = (payload, { onToken, onDone, onError } = {}) => {
  const controller = new AbortController()
  ;(async () => {
    try {
      const res = await fetch(`${api.defaults.baseURL}/api/ai/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      if (!res.ok) {
        let msg = `HTTP ${res.status}`
        try { const j = await res.json(); msg = j.detail || msg } catch (_) {}
        onError?.(new Error(msg))
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // Tách theo khung SSE "\n\n"
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = frame.split('\n').find(l => l.startsWith('data:'))
          if (!line) continue
          try {
            const data = JSON.parse(line.slice(5).trim())
            if (data.token) onToken?.(data.token)
            else if (data.error) { onError?.(new Error(data.error)); return }
            else if (data.done) { onDone?.(); return }
          } catch (_) {}
        }
      }
      onDone?.()
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(err)
    }
  })()
  return () => controller.abort()
}

// ── Health ────────────────────────────────────────────────
export const checkHealth = () => api.get('/health')

// 🔸 System (Update & Version) 🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸🔸
export const systemApi = {
  getInfo: () => api.get('/api/system/info').then(res => res.data),
  checkUpdate: () => api.get('/api/system/check-update').then(res => res.data),
  update: () => api.post('/api/system/update').then(res => res.data)
}

export default api
