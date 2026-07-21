import React, { useState, useEffect, useCallback, useRef } from 'react'
import Navbar from './components/Navbar'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import WorkflowEditor from './pages/WorkflowEditor'
import UserPickerModal from './components/UserPickerModal'
import AiSettingsModal from './components/AiSettingsModal'
import AboutModal from './components/AboutModal'
import { Toaster } from 'react-hot-toast'
import { ConfigProvider, theme as antdTheme, Spin, App as AntApp } from 'antd'
import viVN from 'antd/locale/vi_VN'
import 'dayjs/locale/vi'
import dayjs from 'dayjs'
import useStore from './store/useStore'
import { checkHealth, getUsers, getDashboardStats, importProject } from './api/client'
import toast from 'react-hot-toast'

dayjs.locale('vi')

const VIEWS = {
  DASHBOARD: 'dashboard',
  PROJECT: 'project',
  EDITOR: 'editor',
}

export default function App() {
  const theme = useStore((state) => state.theme)
  const currentUser = useStore((state) => state.currentUser)
  const setCurrentUser = useStore((state) => state.setCurrentUser)

  const [view, setView] = useState(VIEWS.DASHBOARD)
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedWorkflow, setSelectedWorkflow] = useState(null)

  // Bootstrap state
  const [bootstrapDone, setBootstrapDone] = useState(false)
  const [backendOnline, setBackendOnline] = useState(true)
  const [showUserPicker, setShowUserPicker] = useState(false)
  const [noUsersExist, setNoUsersExist] = useState(false)

  // Shared stats for Navbar
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [openCreateModal, setOpenCreateModal] = useState(false)
  const [openAiSettings, setOpenAiSettings] = useState(false)
  const [openAbout, setOpenAbout] = useState(false)

  // Import state
  const importInputRef = useRef(null)
  const [importing, setImporting] = useState(false)

  // ── Sync Theme ─────────────────────────────
  useEffect(() => {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
  }, [theme])

  // ── Import Handler ─────────────────────────
  const handleImportClick = () => {
    importInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setImporting(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      await importProject(formData)
      toast.success('Import project thành công!')
      setRefreshTick((t) => t + 1)
    } catch (err) {
      toast.error('Lỗi import: ' + err.message)
    } finally {
      setImporting(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  // ── Bootstrap: check backend + user selection ──────────────
  useEffect(() => {
    const bootstrap = async () => {
      try {
        await checkHealth()
        setBackendOnline(true)
      } catch {
        setBackendOnline(false)
        setBootstrapDone(true)
        return
      }

      // Check users
      try {
        const res = await getUsers()
        const users = res.data || []
        if (users.length === 0) {
          // Chưa có user nào → bắt buộc tạo
          setNoUsersExist(true)
          setShowUserPicker(true)
        } else if (!currentUser) {
          // Có user nhưng chưa chọn
          setShowUserPicker(true)
        }
        // else: đã có currentUser từ localStorage → vào thẳng
      } catch {
        // Nếu lỗi, vẫn cho vào nhưng không có user
      }

      setBootstrapDone(true)
    }
    bootstrap()
  }, [])

  const loadStats = useCallback(async () => {
    if (!currentUser) return
    setStatsLoading(true)
    try {
      const res = await getDashboardStats()
      setStats(res.data?.data || null)
    } catch {
      // ignore
    } finally {
      setStatsLoading(false)
    }
  }, [currentUser])

  useEffect(() => {
    if (!currentUser) return
    loadStats()

    // Background polling for real-time stats (lightweight, every 10s if tab is active)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        getDashboardStats()
          .then(res => setStats(res.data?.data || null))
          .catch(() => {})
      }
    }, 10000)

    return () => clearInterval(timer)
  }, [currentUser, refreshTick])

  const handleUserSelected = (user) => {
    setCurrentUser(user)
    setShowUserPicker(false)
    setNoUsersExist(false)
    setRefreshTick((t) => t + 1)
    
    // Reset view to dashboard when switching users
    setSelectedProject(null)
    setSelectedWorkflow(null)
    setView(VIEWS.DASHBOARD)
  }

  const handleNavRefresh = () => {
    setRefreshTick((t) => t + 1)
    loadStats()
  }

  const openProject = async (project) => {
    // Fetch lại project để lấy workflows_count mới nhất
    try {
      const res = await fetch(`http://localhost:7000/api/projects/${project.id}`, {
        headers: { 'X-User-Id': currentUser?.id }
      })
      const updatedProject = await res.json()
      setSelectedProject(updatedProject)
    } catch {
      setSelectedProject(project)
    }
    setView(VIEWS.PROJECT)
  }

  const openWorkflow = (workflow) => {
    setSelectedWorkflow(workflow)
    setView(VIEWS.EDITOR)
  }

  const goBack = () => {
    if (view === VIEWS.EDITOR) {
      setView(VIEWS.PROJECT)
    } else if (view === VIEWS.PROJECT) {
      setSelectedProject(null)
      setView(VIEWS.DASHBOARD)
    }
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <ConfigProvider
      locale={viVN}
      theme={{
        algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#0d9488',
          fontFamily: 'var(--font-sans)',
          borderRadius: 8,
          borderRadiusSM: 6,
          borderRadiusLG: 12,
          controlHeight: 36,
          controlHeightSM: 30,
          controlHeightLG: 44,
          fontSize: 14,
          fontSizeSM: 12,
          fontSizeLG: 16,
          colorBgBase: theme === 'dark' ? '#09090b' : '#f8fafc',
          colorBgContainer: theme === 'dark' ? '#18181b' : '#ffffff',
          colorBgElevated: theme === 'dark' ? '#27272a' : '#ffffff',
          controlItemBgHover: theme === 'dark' ? '#3f3f46' : '#f1f5f9',
          controlItemBgActive: theme === 'dark' ? '#52525b' : '#e2e8f0',
          colorBorder: theme === 'dark' ? '#27272a' : '#e2e8f0',
          colorText: theme === 'dark' ? '#f4f4f5' : '#0f172a',
          colorTextSecondary: theme === 'dark' ? '#d4d4d8' : '#475569',
          colorTextTertiary: theme === 'dark' ? '#a1a1aa' : '#94a3b8',
        },
        components: {
          Button: {
            fontWeight: 500,
            defaultShadow: 'none',
            primaryShadow: 'none',
            dangerShadow: 'none',
          },
          Input: {
            activeShadow: '0 0 0 2px rgba(13, 148, 136, 0.25)',
            errorActiveShadow: '0 0 0 2px rgba(239, 68, 68, 0.25)',
          },
          Select: {
            activeShadow: '0 0 0 2px rgba(13, 148, 136, 0.25)',
          },
          Table: {
            headerBorderRadius: 8,
          },
          Select: { controlHeight: 30 },
          Input: { controlHeight: 30 },
          Button: { controlHeight: 30 },
          Table: { cellHeight: 40 },
          Pagination: { itemSize: 28 },
          Menu: {
            itemHeight: 36,
            iconSize: 14,
            horizontalItemHoverBg: 'transparent',
          },
          Dropdown: {
            controlHeight: 36,
          },
        }
      }}
    >
      <AntApp>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: '10px',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.875rem',
            },
          }}
        />

        {/* Loading bootstrap */}
        {!bootstrapDone && (
          <div style={{
            position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 16,
            background: 'var(--bg-base)', zIndex: 9999,
          }}>
            <div style={{
              width: 48, height: 48,
              background: 'var(--premium-gradient-2)',
              borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontSize: '1.5rem' }}>⚡</span>
            </div>
            <Spin size="large" />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Đang khởi động PyFlow Studio…</p>
          </div>
        )}

        {/* User Picker Modal */}
        <UserPickerModal
          open={showUserPicker}
          onClose={() => !noUsersExist && setShowUserPicker(false)}
          onSelect={handleUserSelected}
          allowClose={!noUsersExist}
        />

        <AiSettingsModal
          open={openAiSettings}
          onClose={() => setOpenAiSettings(false)}
        />

        <AboutModal
          open={openAbout}
          onClose={() => setOpenAbout(false)}
        />

        {bootstrapDone && (
          <>
            {/* Navbar */}
            {view !== VIEWS.EDITOR && (
              <>
                <input
                  type="file"
                  accept=".zip"
                  style={{ display: 'none' }}
                  ref={importInputRef}
                  onChange={handleFileChange}
                />
                <Navbar
                  title={view === VIEWS.PROJECT ? selectedProject?.name : null}
                  subtitle={view === VIEWS.PROJECT ? `${selectedProject?.workflows_count || 0} workflows` : null}
                  onLogoClick={() => { setView(VIEWS.DASHBOARD); setSelectedProject(null) }}
                  isDashboard={view === VIEWS.DASHBOARD}
                  stats={stats}
                  loading={statsLoading}
                  onRefresh={handleNavRefresh}
                  onCreateProject={() => setOpenCreateModal(true)}
                  onImport={handleImportClick}
                  onSwitchUser={() => setShowUserPicker(true)}
                  onOpenAiSettings={() => setOpenAiSettings(true)}
                  onOpenAbout={() => setOpenAbout(true)}
                />
              </>
            )}

            {/* Main Content */}
            <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {view === VIEWS.DASHBOARD && (
                <Dashboard
                  onOpenProject={openProject}
                  refreshTick={refreshTick}
                  openCreateModal={openCreateModal}
                  onCloseCreateModal={() => setOpenCreateModal(false)}
                  onStatsChange={setStats}
                  currentUser={currentUser}
                />
              )}
              {view === VIEWS.PROJECT && (
                <ProjectDetail
                  project={selectedProject}
                  onBack={goBack}
                  onOpenWorkflow={openWorkflow}
                  onProjectUpdate={(updated) => {
                    setSelectedProject(updated)
                  }}
                />
              )}
              {view === VIEWS.EDITOR && (
                <WorkflowEditor
                  workflow={selectedWorkflow}
                  project={selectedProject}
                  onBack={goBack}
                />
              )}
            </main>
          </>
        )}
      </div>
      </AntApp>
    </ConfigProvider>
  )
}
