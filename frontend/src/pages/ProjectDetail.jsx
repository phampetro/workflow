import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, Play, Clock, Workflow, Package, Trash2, Terminal, CheckCircle, XCircle, Loader, Download, RefreshCw, AlertCircle, Plus, MoreVertical, Settings, Copy, Upload, History } from 'lucide-react'
import { getWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, runWorkflow, stopWorkflow, getPackages, installPackage, uninstallPackage, getRunHistory, initVenv, reorderWorkflows, duplicateWorkflow, importWorkflow } from '../api/client'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Modal, Form, Input, Button, Table, Tag, Popconfirm, Typography, Divider, Space, Card, Alert, Tooltip, Spin, Empty, Dropdown, Badge, Statistic, Row, Col, message } from 'antd'
const { Text, Title } = Typography
import toast from 'react-hot-toast'
import useStore from '../store/useStore'

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

export default function ProjectDetail({ project, onBack, onOpenWorkflow, onProjectUpdate }) {
  const [workflows, setWorkflows] = useState([])
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
  const [initingVenv, setInitingVenv] = useState(false)

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
      toast.error('Lỗi tải workflows: ' + e.message)
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
      toast.error('Lỗi tải packages: ' + e.message)
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
      toast.error('Lỗi tải lịch sử: ' + e.message)
    } finally {
      setHistLoading(false)
    }
  }, [proj.id, workflows])

  useEffect(() => { loadWorkflows() }, [loadWorkflows])

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
        toast.success('Cập nhật workflow thành công!')
      } else {
        const res = await createWorkflow(proj.id, {
          name: values.name.trim(),
          description: values.description?.trim() || null,
          color: selectedWfColor,
        })
        setWorkflows((prev) => [res.data, ...prev])
        toast.success('Đã tạo workflow mới')
      }
      handleCloseWfModal()
    } catch (e) {
      toast.error((editingWf ? 'Lỗi cập nhật' : 'Lỗi tạo') + ' workflow: ' + e.message)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteWorkflow = (id) => {
    Modal.confirm({
      title: 'Xóa Workflow',
      content: 'Bạn có chắc muốn xóa workflow này không?',
      okText: 'Xóa',
      okType: 'danger',
      cancelText: 'Hủy',
      onOk: async () => {
        setDeletingWf(id)
        try {
          await deleteWorkflow(id)
          setWorkflows((prev) => prev.filter((w) => w.id !== id))
          toast.success('Đã xóa workflow')
        } catch (e) {
          toast.error('Lỗi xóa workflow: ' + e.message)
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
      toast.success('Đã sao chép workflow')
    } catch (e) {
      toast.error('Lỗi sao chép workflow: ' + e.message)
    }
  }

  const handleExportWorkflow = (wf) => {
    window.location.href = `http://localhost:7000/api/workflows/${wf.id}/export`
    toast.success(`Đang tải xuống workflow ${wf.name}...`)
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
      toast.success('Import workflow thành công!')
    } catch (err) {
      toast.error('Lỗi import workflow: ' + err.message)
    } finally {
      setImportingWf(false)
      if (wfFileInputRef.current) wfFileInputRef.current.value = ''
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return
    const oldIndex = workflows.findIndex(w => w.id === active.id)
    const newIndex = workflows.findIndex(w => w.id === over.id)
    const reordered = arrayMove(workflows, oldIndex, newIndex)
    setWorkflows(reordered)
    try {
      await reorderWorkflows(proj.id, reordered.map((w, i) => ({ id: w.id, sort_order: i })))
    } catch {
      toast.error('Lỗi lưu thứ tự workflow')
    }
  }

  const handleRunWorkflow = async (wf, e) => {
    e.stopPropagation()
    if (isWfRunning(wf.id)) return // chặn double-click
    if (!wf.graph_json) {
      toast('Workflow chưa có nội dung. Vui lòng thêm blocks trước khi chạy.', { icon: '⚠️' })
      return
    }
    try {
      const res = await runWorkflow(wf.id)
      const run_id = res.data?.run_id
      if (run_id) {
        useStore.getState().clearLogs(run_id)
        useStore.getState().setActiveRun(wf.id, run_id)
      }
      toast.success(`Đã kích hoạt chạy ${wf.name}`)
    } catch (err) {
      toast.error('Lỗi chạy workflow: ' + err.message)
      useStore.getState().clearActiveRun(wf.id)
    }
  }

  const handleStopWorkflow = async (wf, e) => {
    e.stopPropagation()
    if (!isWfRunning(wf.id)) return
    try {
      await stopWorkflow(wf.id)
      toast.success(`Đã gửi lệnh dừng ${wf.name}`)
    } catch (err) {
      toast.error('Lỗi dừng workflow: ' + err.message)
    }
  }

  const handleInstall = async () => {
    if (!pkgInput.trim() || installingPkg) return
    setInstallingPkg(true)
    try {
      await installPackage(proj.id, pkgInput.trim())
      setPkgInput('')
      toast.success(`Đã cài đặt package ${pkgInput.trim()}`)
      await loadPackages()
    } catch (e) {
      toast.error('Lỗi cài package: ' + e.message)
    } finally {
      setInstallingPkg(false)
    }
  }

  const handleUninstall = async (pkgName) => {
    try {
      await uninstallPackage(proj.id, pkgName)
      setPackages((prev) => prev.filter((p) => p.name !== pkgName))
      toast.success(`Đã gỡ ${pkgName}`)
    } catch (e) {
      toast.error('Lỗi gỡ package: ' + e.message)
    }
  }

  const handleInitVenv = async () => {
    setInitingVenv(true)
    try {
      await initVenv(proj.id)
      toast.success('Khởi tạo Venv thành công!')
      // Trigger parent to refresh project data
      if (onProjectUpdate) onProjectUpdate({ ...proj, venv_ready: true })
      await loadPackages()
    } catch (e) {
      toast.error('Lỗi tạo venv: ' + e.message)
    } finally {
      setInitingVenv(false)
    }
  }

  const formatDate = (iso) => {
    if (!iso) return '-'
    try {
      const d = new Date(iso)
      const diff = Date.now() - d.getTime()
      if (diff <= 5 * 60 * 1000) {
        if (diff < 60000) return 'Vừa xong'
        return `${Math.floor(diff / 60000)} phút trước`
      }
      const time = d.toLocaleTimeString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const date = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
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
    { title: 'STT', key: 'index', width: 60, align: 'center', render: (_, __, index) => <Text type="secondary" style={{ fontSize: '0.8rem' }}>{index + 1}</Text> },
    { title: 'Package', dataIndex: 'name', key: 'name', render: text => <Text strong style={{ fontSize: '0.875rem' }}>{text}</Text> },
    {
      title: 'Phiên bản', dataIndex: 'version', key: 'version', width: 140, align: 'center',
      render: text => <Text style={{ fontSize: '0.8125rem', color: 'var(--text-primary)' }}>{text || '-'}</Text>
    },
    { title: 'Thao tác', key: 'action', width: 80, align: 'center', render: (_, record) => (
      <Popconfirm
        title="Gỡ package này?"
        description="Package sẽ bị xóa khỏi môi trường."
        onConfirm={() => handleUninstall(record.name)}
        okText="Gỡ"
        cancelText="Hủy"
        okButtonProps={{ danger: true }}
      >
        <Button type="text" size="small" danger icon={<Trash2 size="0.875rem" />} style={{ height: 22, padding: '0 6px', lineHeight: 1 }} aria-label="Gỡ package" />
      </Popconfirm>
    )}
  ]

  const historyColumns = [
    { title: 'STT', key: 'index', width: 50, align: 'center', render: (_, __, index) => <Text type="secondary" style={{ fontSize: '0.8rem' }}>{index + 1}</Text> },
    { title: 'Workflow', key: 'workflow', render: (_, r) => <Text strong style={{ fontSize: '0.875rem' }}>{workflows.find(w => w.id === r.workflow_id)?.name || r.workflow_id}</Text> },
    {
      title: 'Trạng thái', dataIndex: 'status', key: 'status', align: 'center',
      render: s => {
        const statusMap = {
          running: { color: 'processing', text: 'Đang chạy', icon: <Loader size="0.75rem" className="spinning" /> },
          success: { color: 'success', text: 'Thành công', icon: <CheckCircle size="0.75rem" /> },
          error: { color: 'error', text: 'Lỗi', icon: <XCircle size="0.75rem" /> },
          scheduled: { color: 'warning', text: 'Đã lên lịch', icon: <Clock size="0.75rem" /> },
          idle: { color: 'default', text: 'Chờ', icon: null },
          pending: { color: 'default', text: 'Chờ', icon: null },
          stopped: { color: 'default', text: 'Đã dừng', icon: null },
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
      title: 'Kích hoạt bởi', key: 'trigger', align: 'center',
      render: (_, r) => {
        const type = r.triggered_by?.startsWith('schedule:') ? 'Lịch hẹn' : 'Thủ công'
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
      title: 'Thời gian chạy', dataIndex: 'duration_ms', key: 'duration', align: 'center',
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
      <div className="section-header" style={{ height: 'var(--navbar-height)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2.5rem', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', margin: 0, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Button 
            type="text" 
            onClick={onBack} 
            icon={<ArrowLeft size="0.875rem" />}
            style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            Quay lại
          </Button>
          <div style={{ width: 1, height: '1.125rem', background: 'var(--border-default)' }} />
          <Button
            type="primary"
            icon={<Plus size="0.875rem" />}
            onClick={() => setIsWfModalOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            Workflow mới
          </Button>
          <input type="file" accept=".zip" style={{ display: 'none' }} ref={wfFileInputRef} onChange={handleWfFileChange} />
          <Button
            type="default"
            icon={<Upload size="0.875rem" />}
            onClick={handleImportWfClick}
            loading={importingWf}
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            Import
          </Button>
          <div style={{ width: 1, height: '1.125rem', background: 'var(--border-default)' }} />
          <Button
            type="default"
            icon={<Package size="0.875rem" />}
            onClick={() => { loadPackages(); setPackagesModalOpen(true); }}
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            Packages
          </Button>
          <Button
            type="default"
            icon={<History size="0.875rem" />}
            onClick={() => { loadHistory(); setHistoryModalOpen(true); }}
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.375rem' }}
          >
            Lịch sử
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
              loading={initingVenv}
              style={{ fontWeight: 500 }}
            >
              Khởi tạo Venv
            </Button>
          )}
        </Space>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '0.75rem 2.5rem', overflowY: 'auto' }}>
        <Spin spinning={loading}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={workflows.map(w => w.id)} strategy={rectSortingStrategy}>
              <div className="grid-workflows" style={{ marginTop: '1.5rem' }}>
                {workflows.length === 0 ? (
                  <Empty 
                    image={Empty.PRESENTED_IMAGE_SIMPLE} 
                    description={
                      <span style={{ color: 'var(--text-muted)' }}>
                        Chưa có workflow nào. Nhấn <strong>Workflow mới</strong> để tạo.
                      </span>
                    }
                    style={{ gridColumn: '1 / -1', padding: '3rem' }}
                  />
                ) : workflows.map((wf) => {
                  const wColor = wf.color || 'var(--accent-primary)'
                  return (
                    <WorkflowCard
                      key={wf.id}
                      workflow={wf}
                      color={wColor}
                      onOpen={() => onOpenWorkflow(wf)}
                      onEdit={() => handleEditWf(wf)}
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

      {/* Modal */}
      <Modal
        title={
          <Space>
            <div style={{ width:26, height:26, background:`linear-gradient(135deg,${selectedWfColor},${selectedWfColor}99)`, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', color:'white' }}>
              {editingWf ? <Settings size="0.875rem" /> : <Plus size="0.875rem" />}
            </div>
            {editingWf ? 'Chỉnh sửa Workflow' : 'Tạo Workflow Mới'}
          </Space>
        }
        open={isWfModalOpen}
        onCancel={handleCloseWfModal}
        footer={null}
        destroyOnHidden
      >
        <Form form={wfForm} layout="vertical" onFinish={handleSubmitWf} style={{ marginTop: 24 }}>
          <Form.Item name="name" label="Tên Workflow" rules={[{ required: true, message: 'Nhập tên workflow' }]}>
            <Input placeholder="VD: Fetch Data" autoFocus />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea placeholder="Mô tả công việc của workflow..." rows={3} />
          </Form.Item>
          <Form.Item label="Màu sắc">
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
            <Button onClick={handleCloseWfModal}>Hủy</Button>
            <Button type="primary" htmlType="submit" loading={creating}>
              {editingWf ? 'Lưu thay đổi' : 'Tạo mới'}
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
                <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>Quản lý Packages</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.3 }}>Python Environment</div>
              </div>
            </div>

            {/* Input + nút Cài đặt — nằm trong title, ngang hàng icon */}
            <Space.Compact style={{ width: 320, flexShrink: 0, marginLeft: 'auto' }} onKeyDown={(e) => e.stopPropagation()}>
              <Input
                placeholder="Cài package, ví dụ: pandas"
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
                Cài đặt
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
            <Title level={5} style={{ margin: '0 0 0.5rem', color: 'var(--text-primary)' }}>Python Environment chưa sẵn sàng</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: '1.5rem' }}>
              Cần khởi tạo Virtual Environment trước khi quản lý packages.
            </Text>
            <Button type="primary" danger icon={<Terminal size="0.875rem" />} onClick={handleInitVenv} loading={initingVenv}>
              Khởi tạo Venv
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
                      title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tổng packages</span>}
                      value={packages.length}
                      styles={{ content: { fontSize: '1.5rem', color: 'var(--text-primary)' } }}
                      prefix={<Package size="1rem" style={{ marginRight: 8, opacity: 0.6 }} />}
                    />
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ textAlign: 'center' }}>
                    <Statistic
                      title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Môi trường</span>}
                      value="Active"
                      styles={{ content: { fontSize: '1.5rem', color: 'var(--accent-success)' } }}
                      prefix={<CheckCircle size="1rem" style={{ marginRight: 8, opacity: 0.6 }} />}
                    />
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ textAlign: 'center' }}>
                    <Statistic
                      title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Python</span>}
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
                  Đã cài đặt {packages.length} package{packages.length !== 1 ? 's' : ''}
                </Text>
                <Button
                  type="text"
                  size="small"
                  icon={<RefreshCw size="0.75rem" />}
                  onClick={() => loadPackages()}
                  loading={pkgLoading}
                  style={{ color: 'var(--text-muted)' }}
                >
                  Làm mới
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
                  showTotal: (total) => `${total} packages`,
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
              <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Lịch sử chạy</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>Run History</div>
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
                  title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tổng lần chạy</span>}
                  value={runHistory.length}
                  styles={{ content: { fontSize: '1.5rem', color: 'var(--accent-secondary)' } }}
                  prefix={<History size="1rem" style={{ marginRight: 8, opacity: 0.6, color: 'var(--accent-secondary)' }} />}
                />
              </div>
            </Col>
            <Col span={8}>
              <div style={{ textAlign: 'center' }}>
                <Statistic
                  title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Thành công</span>}
                  value={runHistory.filter(r => r.status === 'success').length}
                  styles={{ content: { fontSize: '1.5rem', color: 'var(--accent-success)' } }}
                  prefix={<CheckCircle size="1rem" style={{ marginRight: 8, opacity: 0.6 }} />}
                />
              </div>
            </Col>
            <Col span={8}>
              <div style={{ textAlign: 'center' }}>
                <Statistic
                  title={<span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Lỗi</span>}
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
              {runHistory.length} bản ghi
            </Text>
            <Button
              type="text"
              size="small"
              icon={<RefreshCw size="0.75rem" />}
              onClick={() => loadHistory()}
              loading={histLoading}
              style={{ color: 'var(--text-muted)' }}
            >
              Làm mới
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
              showTotal: (total) => `${total} bản ghi`,
            }}
            size="small"
            style={{ marginTop: 8 }}
          />
        </div>
      </Modal>

    </div>
  )
}

// WorkflowCard component với drag-drop tích hợp
function WorkflowCard({ workflow, color, onOpen, onEdit, onDuplicate, onExport, onDelete, isRunning, onRun, onStop }) {
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

  const formatDate = (iso) => {
    if (!iso) return '-'
    try {
      const d = new Date(iso)
      return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return iso }
  }

  // Trạng thái: đang chạy > lỗi gần đây > sẵn sàng (chưa chạy) > thành công
  const lastStatus = workflow.last_run_status
  let statusBadge = null
  if (isRunning) {
    statusBadge = { text: 'Đang chạy', color: 'var(--accent-secondary)', bg: 'var(--accent-secondary-bg)', dot: <Loader size="0.75rem" className="spinning"/> }
  } else if (lastStatus === 'error') {
    statusBadge = { text: 'Lỗi gần đây', color: 'var(--accent-danger)', bg: 'var(--accent-danger-bg)', dot: <XCircle size="0.75rem"/> }
  } else if (lastStatus === 'success') {
    statusBadge = { text: 'Thành công', color: 'var(--accent-success)', bg: 'var(--accent-success-bg)', dot: <CheckCircle size="0.75rem"/> }
  } else if (lastStatus === 'stopped') {
    statusBadge = { text: 'Đã dừng', color: 'var(--accent-warning)', bg: 'var(--accent-warning-bg)', dot: <AlertCircle size="0.75rem"/> }
  } else {
    statusBadge = { text: 'Sẵn sàng', color: 'var(--text-muted)', bg: 'var(--accent-muted-bg)', dot: <CheckCircle size="0.75rem"/> }
  }

  const items = [
    { key: 'edit', label: 'Cài đặt', icon: <Settings size="0.938rem"/>, onClick: (e) => { e.domEvent.stopPropagation(); onEdit(); } },
    { key: 'duplicate', label: 'Sao chép', icon: <Copy size="0.938rem"/>, onClick: (e) => { e.domEvent.stopPropagation(); onDuplicate(); } },
    { key: 'export', label: 'Export ZIP', icon: <Download size="0.938rem"/>, onClick: (e) => { e.domEvent.stopPropagation(); onExport(); } },
    { type: 'divider' },
    { key: 'delete', label: 'Xóa Workflow', icon: <Trash2 size="0.938rem"/>, danger: true, onClick: (e) => { e.domEvent.stopPropagation(); onDelete(); } }
  ]

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, '--wf-color': color }}
      className="workflow-row"
      {...attributes}
      {...listeners}
      onClick={onOpen}
    >
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
          <Tooltip title={workflow.description || 'Chưa có mô tả'} placement="top" mouseEnterDelay={0.5}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {workflow.description || 'Chưa có mô tả'}
            </p>
          </Tooltip>
        </div>

        <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
          <Button className="project-menu-btn" type="text" icon={<MoreVertical size="1rem"/>} onClick={e => e.stopPropagation()} aria-label="Mở menu thao tác Workflow" />
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
            {isRunning ? 'Dừng' : 'Chạy'}
          </Button>
        </div>
      </div>
    </div>
  )
}
