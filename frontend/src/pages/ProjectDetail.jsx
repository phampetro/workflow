import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { ArrowLeft, Play, Clock, Workflow, Package, Trash2, Terminal, CheckCircle, XCircle, Loader, Download, RefreshCw, AlertCircle, Plus, MoreVertical, Settings, Copy, Upload, History, Calendar, Search, LayoutGrid, List } from 'lucide-react'
import { getWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, runWorkflow, stopWorkflow, getPackages, installPackage, uninstallPackage, getRunHistory, deleteRunHistory, initVenv, reorderWorkflows, duplicateWorkflow, importWorkflow, getProject, API_BASE } from '../api/client'
import AutoInstallModal from '../components/AutoInstallModal'
import WorkflowHistoryPanel from '../components/WorkflowHistoryPanel'
import SchedulerPanel from '../components/SchedulerPanel'
import LogViewer from '../components/LogViewer'
import { isFeatureDisabled } from '../config/blockRules'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Modal, Form, Input, Button, Table, Tag, Popconfirm, Typography, Space, Tooltip, Spin, Empty, Dropdown, Statistic, Row, Col, App, Switch, Drawer } from 'antd'
const { Text, Title } = Typography
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import useStore from '../store/useStore'
import SidePanel from '../components/SidePanel'

const COLORS = ['#6c63ff','#00d4aa','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16']

const STATUS_CONFIG = {
  running:   { label: 'Đang chạy', color: 'processing' },
  success:   { label: 'Thành công', color: 'success' },
  scheduled: { label: 'Lên lịch',  color: 'warning' },
  error:     { label: 'Lỗi',       color: 'error' },
  idle:      { label: 'Chờ',       color: 'default' },
  pending:   { label: 'Chờ',       color: 'default' },
  stopped:   { label: 'Đã dừng',   color: 'default' },
}

export default function ProjectDetail({ project, onBack, onOpenWorkflow, onProjectUpdate, panelVisible, isSmallScreen }) {
  // Modal.confirm TĨNH không đọc được context của ConfigProvider: dialog xác nhận
  // hiện ra với style antd mặc định (xanh dương, bo góc khác, cao khác) lệch hẳn
  // phần còn lại của app, mất luôn locale vi_VN, và antd v6 in warning
  // "Static function can not consume context like dynamic theme" ra console.
  const { modal } = App.useApp()
  const { t, i18n } = useTranslation()

  const [workflows, setWorkflows] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  // Chế độ xem (thẻ/danh sách) — lưu theo user trong DB (giống Language), không
  // phải localStorage, để đổi máy/trình duyệt vẫn giữ đúng lựa chọn.
  const viewMode = useStore((s) => s.workflowViewMode)
  const setViewMode = useStore((s) => s.setWorkflowViewMode)
  const [packages, setPackages] = useState([])
  const [runHistory, setRunHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [pkgLoading, setPkgLoading] = useState(false)
  const [histLoading, setHistLoading] = useState(false)
  
  const [pkgInput, setPkgInput] = useState('')
  const [installingPkg, setInstallingPkg] = useState(false)
  
  const [isWfModalOpen, setIsWfModalOpen] = useState(false)
  const [wfForm] = Form.useForm()
  const [creating, setCreating] = useState(false)
  const [selectedWfColor, setSelectedWfColor] = useState('#6c63ff')
  const [editingWf, setEditingWf] = useState(null)
  
  const [deletingWf, setDeletingWf] = useState(null)
  // Lịch sử/Lịch chạy mở trực tiếp từ menu "..." ngoài danh sách workflow — cùng
  // component với bên trong canvas (WorkflowHistoryPanel/SchedulerPanel/LogViewer),
  // để người dùng không cần mở hẳn editor chỉ để xem lại lịch sử hay đặt lịch.
  const [historyWf, setHistoryWf] = useState(null)
  const [schedulerWf, setSchedulerWf] = useState(null)
  const [viewingLogRunId, setViewingLogRunId] = useState(null)
  const historyPanelRef = useRef(null)
  const [initingVenv, setInitingVenv] = useState(false)
  // Venv đang được tạo NGẦM ở backend (từ lúc create/import project) — để nút hiện
  // "đang tạo" thay vì trông idle khiến user bấm nhiều lần.
  const [venvCreating, setVenvCreating] = useState(false)
  const [showAutoInstall, setShowAutoInstall] = useState(false)

  // Modal states for Packages and History
  const [packagesModalOpen, setPackagesModalOpen] = useState(false)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)

  // Đọc trạng thái đang chạy từ Zustand (nguồn sự thật duy nhất)
  const activeRuns = useStore((s) => s.activeRuns)
  // Chỉ dùng Zustand, không dùng running_count từ server (có thể stale)
  const isWfRunning = (wfId) => !!activeRuns[wfId]

  const proj = project || {}

  const loadWorkflows = useCallback(async () => {
    if (!proj.id) return
    try {
      const res = await getWorkflows(proj.id)
      const wfList = res.data || []
      setWorkflows(wfList)

      // Đồng bộ Zustand từ server:
      // - Server nói wf đang chạy nhưng Zustand chưa biết → lấy run_id
      // - Server nói không chạy nhưng Zustand vẫn giữ → clear
      const store = useStore.getState()
      for (const wf of wfList) {
        const isActiveInZustand = !!store.activeRuns[wf.id]
        const isRunningOnServer = wf.is_running

        if (isRunningOnServer && !isActiveInZustand && wf.running_run_id) {
          store.setActiveRun(wf.id, wf.running_run_id)
        } else if (!isRunningOnServer && isActiveInZustand) {
          store.clearActiveRun(wf.id)
        }
      }
    } catch (e) {
      toast.error(t('projectDetail.loadWorkflowsError', { message: e.message }))
    } finally {
      setLoading(false)
    }
  }, [proj.id])

  // Auto-refresh khi có wf đang chạy (theo Zustand hoặc server)
  useEffect(() => {
    const hasRunning = Object.keys(activeRuns).length > 0 || workflows.some(w => w.running_count > 0)
    if (!hasRunning) return
    const timer = setInterval(() => {
      loadWorkflows()
    }, 3000)
    return () => clearInterval(timer)
  }, [workflows, activeRuns, loadWorkflows])

  const loadPackages = useCallback(async () => {
    if (!proj.id) return
    setPkgLoading(true)
    try {
      const res = await getPackages(proj.id)
      setPackages(res.data || [])
    } catch (e) {
      toast.error(t('projectDetail.loadPackagesError', { message: e.message }))
    } finally {
      setPkgLoading(false)
    }
  }, [proj.id])

  const loadHistory = useCallback(async () => {
    if (!proj.id || workflows.length === 0) return
    setHistLoading(true)
    try {
      const allRuns = await Promise.all(
        workflows.map((wf) => getRunHistory(wf.id, 5).then(r => r.data).catch(() => []))
      )
      const flat = allRuns.flat().sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
      setRunHistory(flat.slice(0, 30))
    } catch (e) {
      toast.error(t('projectDetail.loadHistoryError', { message: e.message }))
    } finally {
      setHistLoading(false)
    }
  }, [proj.id, workflows])

  useEffect(() => { loadWorkflows() }, [loadWorkflows])

  // Lọc theo tên/mô tả — chỉ có ý nghĩa kéo-thả sắp xếp khi đang hiện ĐỦ danh
  // sách (không lọc), nên khi có searchQuery vẫn tính index theo mảng đầy đủ ở
  // handleDragEnd, còn kéo-thả bị tắt (xem prop dragDisabled của WorkflowCard).
  const isSearching = searchQuery.trim().length > 0
  const filteredWorkflows = useMemo(() => {
    if (!isSearching) return workflows
    const q = searchQuery.trim().toLowerCase()
    return workflows.filter((w) =>
      w.name?.toLowerCase().includes(q) || w.description?.toLowerCase().includes(q)
    )
  }, [workflows, searchQuery, isSearching])

  const handleCloseWfModal = () => {
    setIsWfModalOpen(false)
    setEditingWf(null)
    wfForm.resetFields()
    setSelectedWfColor('#6c63ff')
  }

  const handleEditWf = (wf) => {
    setEditingWf(wf)
    wfForm.setFieldsValue({ name: wf.name, description: wf.description })
    setSelectedWfColor(wf.color || '#6c63ff')
    setIsWfModalOpen(true)
  }

  const handleDeleteWfHistory = async () => {
    if (!historyWf?.id) return
    try {
      await deleteRunHistory(historyWf.id)
      toast.success(t('workflowEditor.historyDeleted'))
      historyPanelRef.current?.loadHistory()
    } catch (e) {
      toast.error(t('workflowEditor.historyDeleteError', { message: e.message }))
    }
  }

  const handleSubmitWf = async (values) => {
    setCreating(true)
    try {
      if (editingWf) {
        const payload = {
          name: values.name.trim(),
          description: values.description?.trim() || null,
          color: selectedWfColor,
        }
        await updateWorkflow(editingWf.id, payload)
        // Dùng trực tiếp payload + selectedWfColor, không phụ thuộc res.data
        setWorkflows((prev) => prev.map(w => w.id === editingWf.id
          ? { ...w, ...payload }
          : w
        ))
        toast.success(t('projectDetail.updateWorkflowSuccess'))
      } else {
        const res = await createWorkflow(proj.id, {
          name: values.name.trim(),
          description: values.description?.trim() || null,
          color: selectedWfColor,
        })
        setWorkflows((prev) => [res.data, ...prev])
        toast.success(t('projectDetail.createWorkflowSuccess'))
      }
      handleCloseWfModal()
    } catch (e) {
      toast.error(editingWf
        ? t('projectDetail.updateWorkflowError', { message: e.message })
        : t('projectDetail.createWorkflowError', { message: e.message }))
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteWorkflow = (id) => {
    modal.confirm({
      title: t('projectDetail.deleteWorkflowTitle'),
      content: t('projectDetail.deleteWorkflowContent'),
      okText: t('common.delete'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        setDeletingWf(id)
        try {
          await deleteWorkflow(id)
          setWorkflows((prev) => prev.filter((w) => w.id !== id))
          toast.success(t('projectDetail.deleteWorkflowSuccess'))
        } catch (e) {
          toast.error(t('projectDetail.deleteWorkflowError', { message: e.message }))
        } finally {
          setDeletingWf(null)
        }
      }
    })
  }

  const handleDuplicateWorkflow = async (id) => {
    try {
      const res = await duplicateWorkflow(id)
      setWorkflows((prev) => [res.data, ...prev])
      toast.success(t('projectDetail.duplicateSuccess'))
    } catch (e) {
      toast.error(t('projectDetail.duplicateError', { message: e.message }))
    }
  }

  const handleExportWorkflow = (wf) => {
    window.location.href = `${API_BASE}/api/workflows/${wf.id}/export`
    toast.success(t('projectDetail.exportingWorkflow', { name: wf.name }))
  }

  const wfFileInputRef = useRef(null)
  const [importingWf, setImportingWf] = useState(false)

  const handleImportWfClick = () => {
    wfFileInputRef.current?.click()
  }

  const handleWfFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    setImportingWf(true)
    const formData = new FormData()
    formData.append('file', file)
    
    try {
      const res = await importWorkflow(proj.id, formData)
      setWorkflows((prev) => [res.data, ...prev])
      toast.success(t('projectDetail.importSuccess'))
    } catch (err) {
      toast.error(t('projectDetail.importError', { message: err.message }))
    } finally {
      setImportingWf(false)
      if (wfFileInputRef.current) wfFileInputRef.current.value = ''
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = async ({ active, over }) => {
    if (isSearching) return // sắp xếp theo index của danh sách ĐÃ LỌC sẽ ra sort_order sai
    if (!over || active.id === over.id) return
    const oldIndex = workflows.findIndex(w => w.id === active.id)
    const newIndex = workflows.findIndex(w => w.id === over.id)
    const reordered = arrayMove(workflows, oldIndex, newIndex)
    setWorkflows(reordered)
    try {
      await reorderWorkflows(proj.id, reordered.map((w, i) => ({ id: w.id, sort_order: i })))
    } catch {
      toast.error(t('projectDetail.reorderError'))
    }
  }

  const handleRunWorkflow = async (wf, e) => {
    e.stopPropagation()
    if (isWfRunning(wf.id)) return // chặn double-click
    if (!wf.graph_json) {
      toast(t('projectDetail.noGraphWarning'), { icon: '⚠️' })
      return
    }
    try {
      const res = await runWorkflow(wf.id)
      const run_id = res.data?.run_id
      if (run_id) {
        useStore.getState().clearLogs(run_id)
        useStore.getState().setActiveRun(wf.id, run_id)
      }
      toast.success(t('projectDetail.runActivated', { name: wf.name }))
    } catch (err) {
      toast.error(t('projectDetail.runError', { message: err.message }))
      useStore.getState().clearActiveRun(wf.id)
    }
  }

  const handleStopWorkflow = async (wf, e) => {
    e.stopPropagation()
    if (!isWfRunning(wf.id)) return
    try {
      await stopWorkflow(wf.id)
      toast.success(t('projectDetail.stopSent', { name: wf.name }))
    } catch (err) {
      toast.error(t('projectDetail.stopError', { message: err.message }))
    }
  }

  const handleInstall = async () => {
    if (!pkgInput.trim() || installingPkg) return
    setInstallingPkg(true)
    try {
      await installPackage(proj.id, pkgInput.trim())
      setPkgInput('')
      toast.success(t('projectDetail.installSuccess', { name: pkgInput.trim() }))
      await loadPackages()
    } catch (e) {
      toast.error(t('projectDetail.installError', { message: e.message }))
    } finally {
      setInstallingPkg(false)
    }
  }

  const handleUninstall = async (pkgName) => {
    try {
      await uninstallPackage(proj.id, pkgName)
      setPackages((prev) => prev.filter((p) => p.name !== pkgName))
      toast.success(t('projectDetail.uninstallSuccess', { name: pkgName }))
    } catch (e) {
      toast.error(t('projectDetail.uninstallError', { message: e.message }))
    }
  }

  const handleInitVenv = async () => {
    if (initingVenv || venvCreating) return   // đang tạo rồi → chặn bấm trùng
    setInitingVenv(true)
    try {
      const res = await initVenv(proj.id)
      const st = res?.data?.status
      if (st === 'creating') {
        // Venv đang được tạo ngầm (từ import/create) — để poll tự cập nhật khi xong
        setVenvCreating(true)
        toast(t('projectDetail.venvCreatingToast'), { icon: '⏳' })
      } else {
        toast.success(t('projectDetail.venvInitSuccess'))
        if (onProjectUpdate) onProjectUpdate({ ...proj, venv_ready: true })
        await loadPackages()
      }
    } catch (e) {
      toast.error(t('projectDetail.venvInitError', { message: e.message }))
    } finally {
      setInitingVenv(false)
    }
  }

  // Poll trạng thái venv khi CHƯA sẵn sàng: bắt được lúc backend tạo ngầm (create/import)
  // xong, và phản ánh cờ "đang tạo" để nút hiện loading thay vì trông idle.
  useEffect(() => {
    if (proj?.venv_ready) { setVenvCreating(false); return }
    let cancelled = false
    const poll = async () => {
      try {
        const res = await getProject(proj.id)
        if (cancelled) return
        const p = res.data
        setVenvCreating(!!p.venv_creating)
        if (p.venv_ready) {
          if (onProjectUpdate) onProjectUpdate({ ...proj, venv_ready: true })
          loadPackages()
        }
      } catch { /* mạng lỗi tạm — lần sau thử lại */ }
    }
    poll()
    const t = setInterval(poll, 2500)
    return () => { cancelled = true; clearInterval(t) }
  }, [proj?.id, proj?.venv_ready])

  const dateLocale = i18n.language === 'en' ? 'en-US' : 'vi-VN'
  const formatDate = (iso) => {
    if (!iso) return '-'
    try {
      const d = new Date(iso)
      const diff = Date.now() - d.getTime()
      if (diff <= 5 * 60 * 1000) {
        if (diff < 60000) return t('projectDetail.justNow')
        return t('projectDetail.minutesAgo', { count: Math.floor(diff / 60000) })
      }
      const time = d.toLocaleTimeString(dateLocale, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const date = d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit', year: 'numeric' })
      return `${time} ${date}`
    } catch { return iso }
  }

  const formatDuration = (ms) => {
    if (!ms) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  }

  const pkgColumns = [
    { title: t('projectDetail.colIndex'), key: 'index', width: 60, align: 'center', render: (_, __, index) => <Text type="secondary" style={{ fontSize: '0.8rem' }}>{index + 1}</Text> },
    { title: t('projectDetail.colPackage'), dataIndex: 'name', key: 'name', render: text => <Text strong style={{ fontSize: '0.875rem' }}>{text}</Text> },
    {
      title: t('projectDetail.colVersion'), dataIndex: 'version', key: 'version', width: 140, align: 'center',
      render: text => <Text style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{text || '-'}</Text>
    },
    { title: t('projectDetail.colAction'), key: 'action', width: 80, align: 'center', render: (_, record) => (
      <Popconfirm
        title={t('projectDetail.uninstallConfirmTitle')}
        description={t('projectDetail.uninstallConfirmDesc')}
        onConfirm={() => handleUninstall(record.name)}
        okText={t('projectDetail.uninstallOk')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: true }}
      >
        <Button type="text" size="small" danger icon={<Trash2 size="0.875rem" />} style={{ height: 22, padding: '0 6px', lineHeight: 1 }} aria-label={t('projectDetail.uninstallAria')} />
      </Popconfirm>
    )}
  ]

  const historyColumns = [
    { title: t('projectDetail.colIndex'), key: 'index', width: 50, align: 'center', render: (_, __, index) => <Text type="secondary" style={{ fontSize: '0.8rem' }}>{index + 1}</Text> },
    { title: t('projectDetail.colWorkflow'), key: 'workflow', render: (_, r) => <Text strong style={{ fontSize: '0.875rem' }}>{workflows.find(w => w.id === r.workflow_id)?.name || r.workflow_id}</Text> },
    {
      title: t('projectDetail.colStatus'), dataIndex: 'status', key: 'status', align: 'center',
      render: s => {
        const statusMap = {
          running: { color: 'processing', text: t('projectDetail.historyStatusRunning'), icon: <Loader size="0.75rem" className="spinning" /> },
          success: { color: 'success', text: t('projectDetail.historyStatusSuccess'), icon: <CheckCircle size="0.75rem" /> },
          error: { color: 'error', text: t('projectDetail.historyStatusError'), icon: <XCircle size="0.75rem" /> },
          scheduled: { color: 'warning', text: t('projectDetail.historyStatusScheduled'), icon: <Clock size="0.75rem" /> },
          idle: { color: 'default', text: t('projectDetail.historyStatusIdle'), icon: null },
          pending: { color: 'default', text: t('projectDetail.historyStatusIdle'), icon: null },
          stopped: { color: 'default', text: t('projectDetail.historyStatusStopped'), icon: null },
        }
        const cfg = statusMap[s] || statusMap.idle
        return (
          <Tag color={cfg.color} icon={cfg.icon} style={{ margin: '0 auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {cfg.text}
          </Tag>
        )
      }
    },
    {
      title: t('projectDetail.colTrigger'), key: 'trigger', align: 'center',
      render: (_, r) => {
        const type = r.triggered_by?.startsWith('schedule:') ? t('projectDetail.triggerSchedule') : t('projectDetail.triggerManual')
        const icon = r.triggered_by?.startsWith('schedule:') ? <Clock size="0.75rem" /> : <Play size="0.75rem" />
        return (
          <Text type="secondary" style={{ fontSize: '0.8rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {icon} {type}: {formatDate(r.started_at)}
            </span>
          </Text>
        )
      }
    },
    {
      title: t('projectDetail.colDuration'), dataIndex: 'duration_ms', key: 'duration', align: 'center',
      render: ms => (
        <Text type="secondary" style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>
          {formatDuration(ms)}
        </Text>
      )
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>
      {/* Header */}
      <div className="section-header" style={{ height: 'var(--navbar-height)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1rem', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', margin: 0, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Button
            type="text"
            onClick={onBack}
            icon={<ArrowLeft size="0.875rem" />}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            {t('projectDetail.back')}
          </Button>
          <div style={{ width: 1, height: '1.125rem', background: 'var(--border-default)' }} />
          <Button
            type="primary"
            icon={<Plus size="0.875rem" />}
            onClick={() => setIsWfModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            {t('projectDetail.newWorkflow')}
          </Button>
          <input type="file" accept=".zip" style={{ display: 'none' }} ref={wfFileInputRef} onChange={handleWfFileChange} />
          <Button
            type="default"
            icon={<Upload size="0.875rem" />}
            onClick={handleImportWfClick}
            loading={importingWf}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            {t('projectDetail.import')}
          </Button>
          <div style={{ width: 1, height: '1.125rem', background: 'var(--border-default)' }} />
          <Tooltip title={(initingVenv || venvCreating) ? t('projectDetail.creatingEnvTooltip') : ''}>
            <Button
              type="default"
              icon={<Package size="0.875rem" />}
              onClick={() => { loadPackages(); setPackagesModalOpen(true); }}
              disabled={initingVenv || venvCreating}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            >
              {t('projectDetail.packages')}
            </Button>
          </Tooltip>
          <Button
            type="default"
            icon={<History size="0.875rem" />}
            onClick={() => { loadHistory(); setHistoryModalOpen(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            {t('projectDetail.history')}
          </Button>
          <div style={{ width: 1, height: '1.125rem', background: 'var(--border-default)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: proj.color || 'var(--accent-primary)', boxShadow: `0 0 6px ${proj.color || 'var(--accent-primary)'}` }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>{proj.name}</span>
            {proj.description && (
              <>
                <span style={{ color: 'var(--border-subtle)' }}>|</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proj.description}</span>
              </>
            )}
          </div>
        </div>
        <Space>
          {!proj.venv_ready && (
            <Button
              danger
              icon={<Terminal size="0.875rem" />}
              onClick={handleInitVenv}
              loading={initingVenv || venvCreating}
              disabled={initingVenv || venvCreating}
              style={{ fontWeight: 500 }}
            >
              {(initingVenv || venvCreating) ? t('projectDetail.creatingEnv') : t('projectDetail.initVenv')}
            </Button>
          )}
          <Button
            icon={<Package size="0.875rem" />}
            onClick={() => setShowAutoInstall(true)}
            disabled={initingVenv || venvCreating}
          >
            {t('projectDetail.autoInstall')}
          </Button>
        </Space>
      </div>

      {/* Toolbar phụ — tìm kiếm + chế độ xem, canh lề trái */}
      <div style={{ height: 'var(--toolbar-height)', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0 1rem', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <Input
          allowClear
          prefix={<Search size="0.875rem" style={{ color: 'var(--text-muted)' }} />}
          placeholder={t('projectDetail.searchPlaceholder')}
          aria-label={t('projectDetail.searchAria')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: 320 }}
        />
        <div style={{ width: 1, height: '1.25rem', background: 'var(--border-default)' }} />
        <Tooltip title={viewMode === 'list' ? t('projectDetail.viewGrid') : t('projectDetail.viewList')}>
          <Switch
            aria-label={t('projectDetail.viewModeAria')}
            checked={viewMode === 'list'}
            onChange={(checked) => setViewMode(checked ? 'list' : 'grid')}
            checkedChildren={<span className="ant-switch-icon-wrap"><List size="0.75rem" /></span>}
            unCheckedChildren={<span className="ant-switch-icon-wrap"><LayoutGrid size="0.75rem" /></span>}
          />
        </Tooltip>
      </div>

      {/* Content — panel 1/3 chỉ chia cột từ đây trở xuống, không kéo lên header/toolbar.
          Padding ngang 1rem khớp đúng với thanh tìm kiếm/header phía trên (bằng đúng
          gap giữa content-panel), để mép card thẳng hàng với mép ô Input. */}
      <div style={{ flex: 1, display: 'flex', gap: '1rem', overflow: 'hidden', padding: '0.875rem 1rem', background: 'var(--bg-base)' }}>
        <div style={{ flex: panelVisible ? '1 1 67%' : '1 1 100%', minWidth: 0, overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-lg, 16px)',
            border: '1px solid var(--border-default)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{ flex: 1, padding: '1rem 1.75rem', overflowY: 'auto' }}>
              <Spin spinning={loading}>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={filteredWorkflows.map(w => w.id)} strategy={rectSortingStrategy}>
                    <div className={viewMode === 'list' ? 'list-workflows' : 'grid-workflows'} style={{ marginTop: '0.5rem' }}>
                      {workflows.length === 0 ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={
                            <span style={{ color: 'var(--text-muted)' }}>
                              {t('projectDetail.emptyWorkflowsPrefix')} <strong>{t('projectDetail.newWorkflow')}</strong> {t('projectDetail.emptyWorkflowsSuffix')}
                            </span>
                          }
                          style={{ gridColumn: '1 / -1', padding: '3rem' }}
                        />
                      ) : filteredWorkflows.length === 0 ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={
                            <span style={{ color: 'var(--text-muted)' }}>
                              {t('projectDetail.searchNoResults', { query: searchQuery.trim() })}
                            </span>
                          }
                          style={{ gridColumn: '1 / -1', padding: '3rem' }}
                        />
                      ) : filteredWorkflows.map((wf) => {
                        const wColor = wf.color || 'var(--accent-primary)'
                        return (
                          <WorkflowCard
                            key={wf.id}
                            workflow={wf}
                            color={wColor}
                            listView={viewMode === 'list'}
                            dragDisabled={isSearching}
                            onOpen={() => onOpenWorkflow(wf)}
                            onEdit={() => handleEditWf(wf)}
                            onHistory={() => setHistoryWf(wf)}
                            onSchedule={() => setSchedulerWf(wf)}
                            onDuplicate={() => handleDuplicateWorkflow(wf.id)}
                            onExport={() => handleExportWorkflow(wf)}
                            onDelete={() => handleDeleteWorkflow(wf.id)}
                            isRunning={isWfRunning(wf.id)}
                            onRun={(e) => handleRunWorkflow(wf, e)}
                            onStop={(e) => handleStopWorkflow(wf, e)}
                          />
                        )
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </Spin>
            </div>
          </div>
        </div>

        {/* Panel 1/3 bên phải — bắt đầu từ dưới toolbar, không kéo lên ngang header */}
        {panelVisible && (
          <div style={{
            flex: '0 0 33%',
            maxWidth: 420,
            minWidth: 320,
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-lg, 16px)',
            border: '1px solid var(--border-default)',
            boxShadow: 'var(--shadow-sm)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <SidePanel active={!isSmallScreen} />
          </div>
        )}
      </div>

      {/* Modal */}
      <Modal
        title={
          <Space>
            <div style={{ width:26, height:26, background:`linear-gradient(135deg,${selectedWfColor},${selectedWfColor}99)`, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', color:'white' }}>
              {editingWf ? <Settings size="0.875rem" /> : <Plus size="0.875rem" />}
            </div>
            {editingWf ? t('projectDetail.editWorkflow') : t('projectDetail.newWorkflowModalTitle')}
          </Space>
        }
        open={isWfModalOpen}
        onCancel={handleCloseWfModal}
        footer={null}
        destroyOnHidden
      >
        <Form form={wfForm} layout="vertical" onFinish={handleSubmitWf} style={{ marginTop: 24 }}>
          <Form.Item name="name" label={t('projectDetail.nameLabel')} rules={[{ required: true, message: t('projectDetail.nameRequired') }]}>
            <Input placeholder={t('projectDetail.namePlaceholder')} autoFocus />
          </Form.Item>
          <Form.Item name="description" label={t('projectDetail.descLabel')}>
            <Input.TextArea placeholder={t('projectDetail.descPlaceholder')} rows={3} />
          </Form.Item>
          <Form.Item label={t('projectDetail.colorLabel')}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {COLORS.map((c) => (
                <div
                  key={c}
                  onClick={() => setSelectedWfColor(c)}
                  style={{
                    width: 30, height: 30, borderRadius: '50%', background: c,
                    cursor: 'pointer', border: selectedWfColor === c ? '3px solid var(--bg-surface)' : '2px solid transparent',
                    boxShadow: selectedWfColor === c ? `0 0 0 2px ${c}, 0 4px 12px ${c}88` : 'none',
                    transform: selectedWfColor === c ? 'scale(1.1)' : 'scale(1)',
                    transition: 'all 0.2s', opacity: selectedWfColor === c ? 1 : 0.5
                  }}
                />
              ))}
            </div>
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
            <Button onClick={handleCloseWfModal}>{t('common.cancel')}</Button>
            <Button type="primary" htmlType="submit" loading={creating}>
              {editingWf ? t('projectDetail.saveChanges') : t('projectDetail.createNew')}
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Packages Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingRight: 36, width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexShrink: 0 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: 'var(--premium-gradient-2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'white', boxShadow: 'var(--shadow-md)', flexShrink: 0
              }}>
                <Package size="1.125rem" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{t('projectDetail.packagesTitle')}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.3 }}>{t('projectDetail.packagesSubtitle')}</div>
              </div>
            </div>

            {/* Input + nút Cài đặt — nằm trong title, ngang hàng icon */}
            <Space.Compact style={{ width: 320, flexShrink: 0, marginLeft: 'auto' }} onKeyDown={(e) => e.stopPropagation()}>
              <Input
                placeholder={t('projectDetail.installPlaceholder')}
                value={pkgInput}
                onChange={e => setPkgInput(e.target.value)}
                onPressEnter={handleInstall}
                size="small"
                style={{ fontSize: '0.8125rem' }}
              />
              <Button
                size="small"
                type="primary"
                icon={<Download size="0.75rem" />}
                onClick={handleInstall}
                loading={installingPkg}
                disabled={!pkgInput.trim()}
                style={{
                  fontWeight: 500,
                  background: 'var(--premium-gradient-1)',
                  border: 'none',
                  color: '#fff',
                  boxShadow: 'var(--shadow-sm)'
                }}
              >
                {t('projectDetail.installBtn')}
              </Button>
            </Space.Compact>
          </div>
        }
        open={packagesModalOpen}
        onCancel={() => setPackagesModalOpen(false)}
        footer={null}
        width={800}
        destroyOnHidden
        styles={{ body: { padding: '0 0 16px 0' } }}
      >
        {!proj.venv_ready ? (
          <div style={{ padding: '3rem 2rem', textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: 16, background: 'var(--accent-warning-bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem'
            }}>
              <Terminal size="2rem" style={{ color: 'var(--accent-warning)' }} />
            </div>
            <Title level={5} style={{ margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>{t('projectDetail.venvNotReadyTitle')}</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: '1.5rem' }}>
              {t('projectDetail.venvNotReadyDesc')}
            </Text>
            <Button type="primary" danger icon={<Terminal size="0.875rem" />} onClick={handleInitVenv} loading={initingVenv || venvCreating} disabled={initingVenv || venvCreating}>
              {(initingVenv || venvCreating) ? t('projectDetail.creatingEnv') : t('projectDetail.initVenv')}
            </Button>
          </div>
        ) : (
          <>
            {/* Stats Row */}
            <div style={{ padding: '16px 24px', background: 'var(--bg-base)', borderBottom: '1px solid var(--border-subtle)', margin: '0 -0px' }}>
              <Row gutter={24} justify="space-between">
                <Col span={8}>
                  <div style={{ textAlign: 'center' }}>
                    <Statistic
                      title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('projectDetail.totalPackages')}</span>}
                      value={packages.length}
                      styles={{ content: { fontSize: '1.5rem', color: 'var(--text-primary)' } }}
                      prefix={<Package size="1rem" style={{ marginRight: 8, opacity: 0.6 }} />}
                    />
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ textAlign: 'center' }}>
                    <Statistic
                      title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('projectDetail.environment')}</span>}
                      value="Active"
                      styles={{ content: { fontSize: '1.5rem', color: 'var(--accent-success)' } }}
                      prefix={<CheckCircle size="1rem" style={{ marginRight: 8, opacity: 0.6 }} />}
                    />
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ textAlign: 'center' }}>
                    <Statistic
                      title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('projectDetail.python')}</span>}
                      value="3.x"
                      styles={{ content: { fontSize: '1.5rem', color: 'var(--accent-primary)' } }}
                      prefix={<Terminal size="1rem" style={{ marginRight: 8, opacity: 0.6 }} />}
                    />
                  </div>
                </Col>
              </Row>
            </div>

            {/* Table Section */}
            <div style={{ padding: '16px 24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Text type="secondary" style={{ fontSize: '0.8rem' }}>
                  {t('projectDetail.installedCount', { count: packages.length })}
                </Text>
                <Button
                  type="text"
                  size="small"
                  icon={<RefreshCw size="0.75rem" />}
                  onClick={() => loadPackages()}
                  loading={pkgLoading}
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t('projectDetail.refresh')}
                </Button>
              </div>

              <Table
                dataSource={packages}
                columns={pkgColumns}
                rowKey="name"
                loading={pkgLoading}
                pagination={{
                  pageSize: 10,
                  showSizeChanger: false,
                  showTotal: (total) => t('projectDetail.packagesTotal', { count: total }),
                }}
                size="small"
                style={{ marginTop: 8 }}
              />
            </div>
          </>
        )}
      </Modal>

      {/* History Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'var(--premium-gradient-1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', boxShadow: 'var(--shadow-md)'
            }}>
              <History size="1.125rem" />
            </div>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{t('projectDetail.historyTitle')}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>{t('projectDetail.historySubtitle')}</div>
            </div>
          </div>
        }
        open={historyModalOpen}
        onCancel={() => setHistoryModalOpen(false)}
        footer={null}
        width={800}
        destroyOnHidden
        styles={{ body: { padding: '0 0 16px 0' } }}
      >
        {/* Stats Row */}
        <div style={{ padding: '16px 24px', background: 'var(--bg-base)', borderBottom: '1px solid var(--border-subtle)', margin: '0 -0px' }}>
          <Row gutter={24} justify="space-between">
            <Col span={8}>
              <div style={{ textAlign: 'center' }}>
                <Statistic
                  title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('projectDetail.totalRuns')}</span>}
                  value={runHistory.length}
                  styles={{ content: { fontSize: '1.5rem', color: 'var(--accent-secondary)' } }}
                  prefix={<History size="1rem" style={{ marginRight: 8, opacity: 0.6, color: 'var(--accent-secondary)' }} />}
                />
              </div>
            </Col>
            <Col span={8}>
              <div style={{ textAlign: 'center' }}>
                <Statistic
                  title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('projectDetail.success')}</span>}
                  value={runHistory.filter(r => r.status === 'success').length}
                  styles={{ content: { fontSize: '1.5rem', color: 'var(--accent-success)' } }}
                  prefix={<CheckCircle size="1rem" style={{ marginRight: 8, opacity: 0.6 }} />}
                />
              </div>
            </Col>
            <Col span={8}>
              <div style={{ textAlign: 'center' }}>
                <Statistic
                  title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('projectDetail.errorLabel')}</span>}
                  value={runHistory.filter(r => r.status === 'error').length}
                  styles={{ content: { fontSize: '1.5rem', color: 'var(--accent-danger)' } }}
                  prefix={<XCircle size="1rem" style={{ marginRight: 8, opacity: 0.6 }} />}
                />
              </div>
            </Col>
          </Row>
        </div>

        {/* Table Section */}
        <div style={{ padding: '16px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text type="secondary" style={{ fontSize: '0.8rem' }}>
              {t('projectDetail.recordsCount', { count: runHistory.length })}
            </Text>
            <Button
              type="text"
              size="small"
              icon={<RefreshCw size="0.75rem" />}
              onClick={() => loadHistory()}
              loading={histLoading}
              style={{ color: 'var(--text-muted)' }}
            >
              {t('projectDetail.refresh')}
            </Button>
          </div>

          <Table
            dataSource={runHistory}
            columns={historyColumns}
            rowKey="id"
            loading={histLoading}
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (total) => t('projectDetail.recordsTotal', { count: total }),
            }}
            size="small"
            style={{ marginTop: 8 }}
          />
        </div>
      </Modal>

      <AutoInstallModal
        projectId={proj.id}
        open={showAutoInstall}
        onClose={() => setShowAutoInstall(false)}
        onDone={() => { if (onProjectUpdate) onProjectUpdate({ ...proj, venv_ready: true }); loadPackages(); }}
      />

      {/* Lịch sử chạy của 1 workflow cụ thể — cùng component với bên trong canvas,
          mở trực tiếp từ menu "..." để không phải vào hẳn editor. */}
      <Drawer
        title={
          <Space>
            <History size={16} color="var(--accent-warning)" />
            <span style={{ fontWeight: 600 }}>{t('workflowEditor.historyDrawerTitle')}</span>
            <Tag variant="filled" style={{ margin: 0 }}>{historyWf?.name}</Tag>
          </Space>
        }
        placement="right"
        size="large"
        onClose={() => setHistoryWf(null)}
        open={!!historyWf}
        styles={{ body: { padding: 16 } }}
        extra={
          <Space>
            <Button type="default" icon={<RefreshCw size={14} />} size="small" onClick={() => historyPanelRef.current?.loadHistory()}>
              {t('workflowEditor.refresh')}
            </Button>
            <Popconfirm title={t('workflowEditor.deleteAllHistoryConfirm')} onConfirm={handleDeleteWfHistory} okText={t('common.delete')} cancelText={t('common.cancel')} placement="bottomRight">
              <Button type="primary" danger icon={<Trash2 size={14} />} size="small">
                {t('workflowEditor.deleteHistoryBtn')}
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <WorkflowHistoryPanel
          ref={historyPanelRef}
          workflowId={historyWf?.id}
          onViewLog={(runId) => {
            setViewingLogRunId(runId)
            setHistoryWf(null)
          }}
        />
      </Drawer>

      {schedulerWf && (
        <SchedulerPanel workflow={schedulerWf} onClose={() => setSchedulerWf(null)} />
      )}

      {viewingLogRunId && (
        <LogViewer
          runId={viewingLogRunId}
          isRunning={false}
          streamedRunId={null}
          onClose={() => setViewingLogRunId(null)}
          onFinished={() => {}}
        />
      )}
    </div>
  )
}

// WorkflowCard component với drag-drop tích hợp
function WorkflowCard({ workflow, color, listView, dragDisabled, onOpen, onEdit, onHistory, onSchedule, onDuplicate, onExport, onDelete, isRunning, onRun, onStop }) {
  const { t, i18n } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workflow.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 10 : 'auto',
  }

  // Luật: workflow có khối interactive (chờ người nhập) không được đặt lịch —
  // cùng rule với nút "Lịch chạy" trong canvas (WorkflowEditor.jsx), tính lại ở
  // đây vì menu này mở trực tiếp từ danh sách, không đi qua canvas.
  const schedulerDisabled = useMemo(() => {
    try {
      const graph = JSON.parse(workflow.graph_json || '{}')
      return isFeatureDisabled(graph.nodes || [], 'scheduler')
    } catch {
      return false
    }
  }, [workflow.graph_json])

  const formatDate = (iso) => {
    if (!iso) return '-'
    try {
      const d = new Date(iso)
      const locale = i18n.language === 'en' ? 'en-US' : 'vi-VN'
      return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return iso }
  }

  // Trạng thái: đang chạy > lỗi gần đây > sẵn sàng (chưa chạy) > thành công
  const lastStatus = workflow.last_run_status
  let statusBadge = null
  if (isRunning) {
    statusBadge = { text: t('projectDetail.cardStatusRunning'), color: 'var(--accent-secondary)', bg: 'var(--accent-secondary-bg)', dot: <Loader size="0.75rem" className="spinning"/> }
  } else if (lastStatus === 'error') {
    statusBadge = { text: t('projectDetail.cardStatusRecentError'), color: 'var(--accent-danger)', bg: 'var(--accent-danger-bg)', dot: <XCircle size="0.75rem"/> }
  } else if (lastStatus === 'success') {
    statusBadge = { text: t('projectDetail.cardStatusSuccess'), color: 'var(--accent-success)', bg: 'var(--accent-success-bg)', dot: <CheckCircle size="0.75rem"/> }
  } else if (lastStatus === 'stopped') {
    statusBadge = { text: t('projectDetail.cardStatusStopped'), color: 'var(--accent-warning)', bg: 'var(--accent-warning-bg)', dot: <AlertCircle size="0.75rem"/> }
  } else {
    statusBadge = { text: t('projectDetail.cardStatusReady'), color: 'var(--text-muted)', bg: 'var(--accent-muted-bg)', dot: <CheckCircle size="0.75rem"/> }
  }

  const items = [
    { key: 'edit', label: t('projectDetail.cardMenuSettings'), icon: <Settings size="0.938rem"/>, onClick: (e) => { e.domEvent.stopPropagation(); onEdit(); } },
    { key: 'history', label: t('projectDetail.cardMenuHistory'), icon: <History size="0.938rem"/>, onClick: (e) => { e.domEvent.stopPropagation(); onHistory(); } },
    {
      key: 'schedule',
      label: t('projectDetail.cardMenuSchedule'),
      icon: <Calendar size="0.938rem"/>,
      onClick: (e) => {
        e.domEvent.stopPropagation()
        if (schedulerDisabled) {
          toast.error(t('workflowEditor.schedulerDisabledTooltip'))
          return
        }
        onSchedule()
      },
    },
    { type: 'divider' },
    { key: 'duplicate', label: t('projectDetail.cardMenuDuplicate'), icon: <Copy size="0.938rem"/>, onClick: (e) => { e.domEvent.stopPropagation(); onDuplicate(); } },
    { key: 'export', label: t('projectDetail.cardMenuExport'), icon: <Download size="0.938rem"/>, onClick: (e) => { e.domEvent.stopPropagation(); onExport(); } },
    { type: 'divider' },
    { key: 'delete', label: t('projectDetail.cardMenuDelete'), icon: <Trash2 size="0.938rem"/>, danger: true, onClick: (e) => { e.domEvent.stopPropagation(); onDelete(); } }
  ]

  const rootProps = {
    ref: setNodeRef,
    style: { ...style, '--wf-color': color },
    ...(dragDisabled ? {} : attributes),
    ...(dragDisabled ? {} : listeners),
    onClick: onOpen,
    // Cùng lý do với thẻ project ở Dashboard: <div> thuần không nhận Tab/Enter
    // nên bàn phím không mở được workflow nào.
    role: 'button',
    tabIndex: 0,
    'aria-label': t('projectDetail.cardOpenAria', { name: workflow.name }),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(e) }
    },
  }

  if (listView) {
    return (
      <div {...rootProps} className="workflow-row workflow-row--list">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <div style={{
            width: '2.25rem', height: '2.25rem', borderRadius: '0.5rem', flexShrink: 0,
            background: `color-mix(in srgb, ${color} 15%, transparent)`,
            color: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`
          }}>
            <Workflow size="1.125rem" strokeWidth={2} />
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '0.625rem' }}>
            <Tooltip title={workflow.name} placement="top" mouseEnterDelay={0.5}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%', flexShrink: 0 }}>
                {workflow.name}
              </span>
            </Tooltip>
            <Tooltip title={workflow.description || t('projectDetail.cardNoDescription')} placement="top" mouseEnterDelay={0.5}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {workflow.description || t('projectDetail.cardNoDescription')}
              </span>
            </Tooltip>
          </div>

          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>
            <Clock size="0.75rem" style={{ flexShrink: 0 }} />
            {formatDate(workflow.updated_at)}
          </span>

          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0,
            padding: '0.15rem 0.5rem', borderRadius: 10,
            background: statusBadge.bg, color: statusBadge.color,
            fontSize: '0.7rem', fontWeight: 500, whiteSpace: 'nowrap'
          }}>
            {statusBadge.dot}
            <span style={{ transform: 'translateY(1px)' }}>{statusBadge.text}</span>
          </span>

          <Button
            size="small"
            type={isRunning ? 'default' : 'primary'}
            icon={isRunning ? <Loader size="0.8rem" className="spinning"/> : <Play size="0.8rem" />}
            onClick={(e) => { e.stopPropagation(); isRunning ? onStop(e) : onRun(e); }}
            danger={isRunning}
            style={{ borderRadius: 6, fontWeight: 500, flexShrink: 0 }}
          >
            {isRunning ? t('projectDetail.cardStop') : t('projectDetail.cardRun')}
          </Button>

          <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
            <Button className="project-menu-btn" type="text" size="small" icon={<MoreVertical size="1rem"/>} onClick={e => e.stopPropagation()} aria-label={t('projectDetail.cardMenuAria')} style={{ flexShrink: 0 }} />
          </Dropdown>
        </div>
      </div>
    )
  }

  return (
    <div {...rootProps} className="workflow-row">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem' }}>
        <div style={{
          width: '2.75rem', height: '2.75rem', borderRadius: '0.625rem',
          background: `color-mix(in srgb, ${color} 15%, transparent)`,
          color: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`
        }}>
          <Workflow size="1.375rem" strokeWidth={2} />
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <Tooltip title={workflow.name} placement="top" mouseEnterDelay={0.5}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {workflow.name}
            </h3>
          </Tooltip>
          <Tooltip title={workflow.description || t('projectDetail.cardNoDescription')} placement="top" mouseEnterDelay={0.5}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {workflow.description || t('projectDetail.cardNoDescription')}
            </p>
          </Tooltip>
        </div>

        <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
          <Button className="project-menu-btn" type="text" icon={<MoreVertical size="1rem"/>} onClick={e => e.stopPropagation()} aria-label={t('projectDetail.cardMenuAria')} />
        </Dropdown>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center',
        borderTop: '1px solid var(--border-default)', paddingTop: '0.875rem', marginTop: '0.5rem',
        gap: '0.75rem'
      }}>
        {/* Cột 1: date trên, badge dưới — canh giữa */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem', flex: 1, minWidth: 0 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1 }}>
            <Clock size="0.75rem" style={{ flexShrink: 0 }} />
            <span>{formatDate(workflow.updated_at)}</span>
          </span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
            padding: '0.15rem 0.5rem', borderRadius: 10,
            background: statusBadge.bg, color: statusBadge.color,
            fontSize: '0.7rem', fontWeight: 500, whiteSpace: 'nowrap'
          }}>
            {statusBadge.dot}
            <span style={{ transform: 'translateY(1px)' }}>{statusBadge.text}</span>
          </span>
        </div>

        {/* Cột 2: nút chạy/dừng — canh giữa */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
          <Button
            type={isRunning ? 'default' : 'primary'}
            icon={isRunning ? <Loader size="0.875rem" className="spinning"/> : <Play size="0.875rem" />}
            onClick={(e) => { e.stopPropagation(); isRunning ? onStop(e) : onRun(e); }}
            danger={isRunning}
            style={{ borderRadius: 6, fontWeight: 500 }}
          >
            {isRunning ? t('projectDetail.cardStop') : t('projectDetail.cardRun')}
          </Button>
        </div>
      </div>
    </div>
  )
}
