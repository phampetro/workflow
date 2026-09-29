import { create } from 'zustand'
import i18n from '../i18n'
import { updateUserLanguage, updateUserWorkflowViewMode, updateUserProjectViewMode, updateUserSidePanelOpen } from '../api/client'

// Khôi phục user từ localStorage nếu có
const _savedUser = (() => {
  try { return JSON.parse(localStorage.getItem('pyflow_current_user')) } catch { return null }
})()

// Áp ngay ngôn ngữ của user đã lưu trước khi React render lần đầu, tránh nháy
// UI tiếng Việt rồi mới đổi sang tiếng Anh (i18next mặc định 'vi').
if (_savedUser?.language && _savedUser.language !== i18n.language) {
  i18n.changeLanguage(_savedUser.language)
}

// Kênh đồng bộ trạng thái RUN giữa các tab cùng origin - trước đây nút Chạy/Dừng
// chỉ đồng bộ khi cả 2 tab đang mở Drawer Logs (nhờ SSE). Tab đóng Drawer sẽ hiển
// thị nút sai cho tới khi F5. BroadcastChannel là cùng-origin, không phụ thuộc backend.
const _runsChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('pyflow_active_runs')
  : null

const useStore = create((set, get) => ({
  // --- Users ---
  currentUser: _savedUser,   // { id, name, created_at, language, workflow_view_mode } | null
  setCurrentUser: (user) => {
    if (user) {
      localStorage.setItem('pyflow_current_user', JSON.stringify(user))
      i18n.changeLanguage(user.language || 'vi')
    } else {
      localStorage.removeItem('pyflow_current_user')
    }
    set({
      currentUser: user,
      language: user?.language || 'vi',
      workflowViewMode: user?.workflow_view_mode || 'grid',
      projectViewMode: user?.project_view_mode || 'grid',
      sidePanelOpen: user?.side_panel_open !== false,
    })
  },

  // --- Language (lưu theo user trong DB, không phải theo trình duyệt) ---
  language: _savedUser?.language || 'vi',
  setLanguage: (language) => {
    i18n.changeLanguage(language)
    set((state) => {
      const user = state.currentUser
      if (!user) return { language }
      const updatedUser = { ...user, language }
      localStorage.setItem('pyflow_current_user', JSON.stringify(updatedUser))
      // Ghi xuống DB — không chờ kết quả để đổi ngôn ngữ trên UI ngay lập tức;
      // lỗi mạng chỉ làm mất phần lưu, không làm mất hiệu ứng đổi ngôn ngữ.
      updateUserLanguage(user.id, language).catch(() => {})
      return { language, currentUser: updatedUser }
    })
  },

  // --- Chế độ xem workflow (thẻ/danh sách) — cùng cách với Language: lưu theo
  // user trong DB, không phải localStorage, để đổi máy/trình duyệt vẫn đúng ý. ---
  workflowViewMode: _savedUser?.workflow_view_mode || 'grid',
  setWorkflowViewMode: (workflowViewMode) => {
    set((state) => {
      const user = state.currentUser
      if (!user) return { workflowViewMode }
      const updatedUser = { ...user, workflow_view_mode: workflowViewMode }
      localStorage.setItem('pyflow_current_user', JSON.stringify(updatedUser))
      updateUserWorkflowViewMode(user.id, workflowViewMode).catch(() => {})
      return { workflowViewMode, currentUser: updatedUser }
    })
  },

  // --- Chế độ xem danh sách project (thẻ/danh sách) ở Dashboard — độc lập với
  // workflowViewMode vì là 2 danh sách khác nhau, cùng cách lưu (theo user trong DB). ---
  projectViewMode: _savedUser?.project_view_mode || 'grid',
  setProjectViewMode: (projectViewMode) => {
    set((state) => {
      const user = state.currentUser
      if (!user) return { projectViewMode }
      const updatedUser = { ...user, project_view_mode: projectViewMode }
      localStorage.setItem('pyflow_current_user', JSON.stringify(updatedUser))
      updateUserProjectViewMode(user.id, projectViewMode).catch(() => {})
      return { projectViewMode, currentUser: updatedUser }
    })
  },

  // --- Đóng/mở panel 1/3 bên phải — DÙNG CHUNG cho Dashboard lẫn ProjectDetail
  // (không còn riêng màn hình workflow nữa), theo user trong DB. ---
  sidePanelOpen: _savedUser?.side_panel_open !== false,
  setSidePanelOpen: (sidePanelOpen) => {
    set((state) => {
      const user = state.currentUser
      if (!user) return { sidePanelOpen }
      const updatedUser = { ...user, side_panel_open: sidePanelOpen }
      localStorage.setItem('pyflow_current_user', JSON.stringify(updatedUser))
      updateUserSidePanelOpen(user.id, sidePanelOpen).catch(() => {})
      return { sidePanelOpen, currentUser: updatedUser }
    })
  },

  // --- Projects ---
  projects: [],
  selectedProject: null,

  setProjects: (projects) => set({ projects }),
  setSelectedProject: (project) => set({ selectedProject: project }),

  addProject: (project) => set((state) => ({
    projects: [...state.projects, project],
  })),

  updateProject: (id, updates) => set((state) => ({
    projects: state.projects.map((p) => p.id === id ? { ...p, ...updates } : p),
    selectedProject: state.selectedProject?.id === id
      ? { ...state.selectedProject, ...updates }
      : state.selectedProject,
  })),

  removeProject: (id) => set((state) => ({
    projects: state.projects.filter((p) => p.id !== id),
    selectedProject: state.selectedProject?.id === id ? null : state.selectedProject,
  })),

  // --- Workflows ---
  workflows: [],
  selectedWorkflow: null,

  setWorkflows: (workflows) => set({ workflows }),
  setSelectedWorkflow: (workflow) => set({ selectedWorkflow: workflow }),

  addWorkflow: (workflow) => set((state) => ({
    workflows: [...state.workflows, workflow],
  })),

  updateWorkflow: (id, updates) => set((state) => ({
    workflows: state.workflows.map((w) => w.id === id ? { ...w, ...updates } : w),
    selectedWorkflow: state.selectedWorkflow?.id === id
      ? { ...state.selectedWorkflow, ...updates }
      : state.selectedWorkflow,
  })),

  removeWorkflow: (id) => set((state) => ({
    workflows: state.workflows.filter((w) => w.id !== id),
    selectedWorkflow: state.selectedWorkflow?.id === id ? null : state.selectedWorkflow,
  })),

  // --- Run Logs ---
  runLogs: {},
  activeRuns: {},

  appendLog: (runId, line) => set((state) => {
    const existing = state.runLogs[runId] || []
    // Dedup: kiểm tra dòng cuối xem giống hoàn toàn chưa
    const last = existing[existing.length - 1]
    if (last && last.time === line.time && last.msg === line.msg) {
      return state // không thêm dòng trung
    }
    return {
      runLogs: {
        ...state.runLogs,
        [runId]: [...existing, line],
      }
    }
  }),

  clearLogs: (runId) => set((state) => {
    const next = { ...state.runLogs }
    delete next[runId]
    return { runLogs: next }
  }),

  setActiveRun: (workflowId, runId, _fromChannel = false) => {
    set((state) => ({
      activeRuns: { ...state.activeRuns, [workflowId]: runId },
    }))
    if (!_fromChannel && _runsChannel) {
      try { _runsChannel.postMessage({ type: 'set', workflowId, runId }) } catch {}
    }
  },

  clearActiveRun: (workflowId, _fromChannel = false) => {
    set((state) => {
      const next = { ...state.activeRuns }
      delete next[workflowId]
      return { activeRuns: next }
    })
    if (!_fromChannel && _runsChannel) {
      try { _runsChannel.postMessage({ type: 'clear', workflowId }) } catch {}
    }
  },

  // --- UI State ---
  theme: localStorage.getItem('pyflow_theme') || 'light',
  setTheme: (theme) => {
    localStorage.setItem('pyflow_theme', theme)
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
    set({ theme })
  },

  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  notifications: [],
  addNotification: (notif) => set((state) => ({
    notifications: [...state.notifications, { id: Date.now(), ...notif }],
  })),
  removeNotification: (id) => set((state) => ({
    notifications: state.notifications.filter((n) => n.id !== id),
  })),
}))

// Nhận thay đổi từ tab khác và cập nhật store cục bộ (không phát lại để tránh loop)
if (_runsChannel) {
  _runsChannel.onmessage = (ev) => {
    const msg = ev.data || {}
    if (!msg.workflowId) return
    const s = useStore.getState()
    if (msg.type === 'set') s.setActiveRun(msg.workflowId, msg.runId, true)
    else if (msg.type === 'clear') s.clearActiveRun(msg.workflowId, true)
  }
}

export default useStore
