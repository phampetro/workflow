import { create } from 'zustand'

// Khôi phục user từ localStorage nếu có
const _savedUser = (() => {
  try { return JSON.parse(localStorage.getItem('pyflow_current_user')) } catch { return null }
})()

const useStore = create((set, get) => ({
  // --- Users ---
  currentUser: _savedUser,   // { id, name, created_at } | null
  setCurrentUser: (user) => {
    if (user) localStorage.setItem('pyflow_current_user', JSON.stringify(user))
    else localStorage.removeItem('pyflow_current_user')
    set({ currentUser: user })
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

  appendLog: (runId, line) => set((state) => ({
    runLogs: {
      ...state.runLogs,
      [runId]: [...(state.runLogs[runId] || []), line],
    },
  })),

  clearLogs: (runId) => set((state) => {
    const next = { ...state.runLogs }
    delete next[runId]
    return { runLogs: next }
  }),

  setActiveRun: (workflowId, runId) => set((state) => ({
    activeRuns: { ...state.activeRuns, [workflowId]: runId },
  })),

  clearActiveRun: (workflowId) => set((state) => {
    const next = { ...state.activeRuns }
    delete next[workflowId]
    return { activeRuns: next }
  }),

  // --- UI State ---
  theme: localStorage.getItem('pyflow_theme') || 'light',
  setTheme: (theme) => {
    localStorage.setItem('pyflow_theme', theme)
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
    set({ theme })
  },

  uiSize: localStorage.getItem('pyflow_uiSize') || 'medium',
  setUiSize: (uiSize) => {
    localStorage.setItem('pyflow_uiSize', uiSize)
    document.documentElement.setAttribute('data-size', uiSize)
    set({ uiSize })
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

export default useStore
