import React, { useState, useEffect, useCallback } from 'react'
import Navbar from './components/Navbar'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import WorkflowEditor from './pages/WorkflowEditor'
import UserPickerModal from './components/UserPickerModal'
import { Toaster } from 'react-hot-toast'
import { ConfigProvider, theme as antdTheme, Spin } from 'antd'
import viVN from 'antd/locale/vi_VN'
import 'dayjs/locale/vi'
import dayjs from 'dayjs'
import useStore from './store/useStore'
import { checkHealth, getUsers, getDashboardStats } from './api/client'

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

  // ── Sync Theme ──────────────
  useEffect(() => {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light')
    else document.documentElement.removeAttribute('data-theme')
  }, [theme])

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
    if (view === VIEWS.DASHBOARD && currentUser) {
      loadStats()
    }
  }, [view, refreshTick, currentUser])

  const handleUserSelected = (user) => {
    setCurrentUser(user)
    setShowUserPicker(false)
    setNoUsersExist(false)
    setRefreshTick((t) => t + 1)
  }

  const handleNavRefresh = () => {
    setRefreshTick((t) => t + 1)
    loadStats()
  }

  const openProject = (project) => {
    setSelectedProject(project)
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
          colorPrimary: '#6c63ff',
          fontFamily: 'var(--font-sans)',
        },
      }}
    >
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
              background: 'linear-gradient(135deg, var(--accent-primary), #8b5cf6)',
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

        {bootstrapDone && (
          <>
            {/* Navbar */}
            {view !== VIEWS.EDITOR && (
              <Navbar
                title={view === VIEWS.PROJECT ? selectedProject?.name : null}
                subtitle={view === VIEWS.PROJECT ? `${selectedProject?.workflows_count || 0} workflows` : null}
                onLogoClick={() => { setView(VIEWS.DASHBOARD); setSelectedProject(null) }}
                isDashboard={view === VIEWS.DASHBOARD}
                stats={view === VIEWS.DASHBOARD ? stats : null}
                loading={statsLoading}
                onRefresh={handleNavRefresh}
                onCreateProject={() => setOpenCreateModal(true)}
                onSwitchUser={() => setShowUserPicker(true)}
              />
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
    </ConfigProvider>
  )
}
