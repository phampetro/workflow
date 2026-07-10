import React, { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Play, Clock, Workflow, Package, Trash2, Terminal, CheckCircle, XCircle, Loader, Download, RefreshCw, AlertCircle, Plus, MoreVertical, Settings, Copy } from 'lucide-react'
import { getWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, runWorkflow, stopWorkflow, getPackages, installPackage, uninstallPackage, getRunHistory, initVenv, reorderWorkflows, duplicateWorkflow } from '../api/client'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import SortableCard from '../components/SortableCard'
import { Modal, Form, Input, Button, Tabs, Table, Tag, Popconfirm, Typography, Divider, Space, Card, Alert, Tooltip, Spin, Empty, Dropdown } from 'antd'
import toast from 'react-hot-toast'

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

export default function ProjectDetail({ project, onBack, onOpenWorkflow }) {
  const [activeTab, setActiveTab] = useState('workflows')
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
  const [runningWf, setRunningWf] = useState(null)
  const [initingVenv, setInitingVenv] = useState(false)

  const proj = project || {}

  const loadWorkflows = useCallback(async () => {
    if (!proj.id) return
    setLoading(true)
    try {
      const res = await getWorkflows(proj.id)
      setWorkflows(res.data || [])
    } catch (e) {
      toast.error('Lỗi tải workflows: ' + e.message)
    } finally {
      setLoading(false)
    }
  }, [proj.id])

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
  useEffect(() => { if (activeTab === 'packages') loadPackages() }, [activeTab, loadPackages])
  useEffect(() => { if (activeTab === 'history') loadHistory() }, [activeTab, loadHistory])

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
    if (!wf.graph_json) {
      toast.warning('Workflow chưa có nội dung. Vui lòng thêm blocks trước khi chạy.')
      return
    }
    setRunningWf(wf.id)
    try {
      await runWorkflow(wf.id)
      toast.success(`Đã kích hoạt chạy ${wf.name}`)
      setTimeout(() => setRunningWf(null), 3000)
    } catch (err) {
      toast.error('Lỗi chạy workflow: ' + err.message)
      setRunningWf(null)
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
      proj.venv_ready = 1
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
    { title: 'STT', key: 'index', width: 60, align: 'center', render: (_, __, index) => index + 1 },
    { title: 'Package', dataIndex: 'name', key: 'name', render: text => <strong style={{color: 'var(--accent-secondary)'}}>{text}</strong> },
    { title: 'Version', dataIndex: 'version', key: 'version', width: 150, align: 'center', render: text => <Tag>{text}</Tag> },
    { title: 'Hành động', key: 'action', width: 120, align: 'center', render: (_, record) => (
      <Popconfirm title="Gỡ package này?" onConfirm={() => handleUninstall(record.name)}>
        <Button size="small" type="text" danger icon={<Trash2 size="0.875rem" />} />
      </Popconfirm>
    )}
  ]

  const historyColumns = [
    { title: 'STT', key: 'index', width: 60, align: 'center', render: (_, __, index) => index + 1 },
    { title: 'Workflow', key: 'workflow', render: (_, r) => <strong style={{color: 'var(--accent-secondary)'}}>{workflows.find(w => w.id === r.workflow_id)?.name || r.workflow_id}</strong> },
    { title: 'Trạng thái', dataIndex: 'status', key: 'status', align: 'center', render: s => <Tag color={STATUS_CONFIG[s]?.color || 'default'}>{STATUS_CONFIG[s]?.label || s}</Tag> },
    { title: 'Kích hoạt bởi', key: 'trigger', align: 'center', render: (_, r) => {
      const type = r.triggered_by?.startsWith('schedule:') ? 'Lịch hẹn' : 'Thủ công'
      return <span style={{ fontSize: '0.85rem' }}>{type}: {formatDate(r.started_at)}</span>
    } },
    { title: 'Thời gian chạy', dataIndex: 'duration_ms', key: 'duration', align: 'center', render: ms => formatDuration(ms) },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>
      {/* Header */}
      <div className="section-header" style={{ height: 'var(--navbar-height)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2.5rem', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', margin: 0, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <Button 
            type="text" 
            onClick={onBack} 
            icon={<ArrowLeft size="1rem" />}
            style={{ color: 'var(--text-secondary)' }}
          >
            Quay lại
          </Button>
          <div style={{ width: 1, height: '1.25rem', background: 'var(--border-default)' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: '0.75rem', height: '0.75rem', borderRadius: '50%', background: proj.color || 'var(--accent-primary)', boxShadow: `0 0 10px ${proj.color || 'var(--accent-primary)'}` }} />
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {proj.name}
              <span style={{ color: 'var(--border-subtle)' }}>|</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 400 }}>{proj.description || 'Chưa có mô tả'}</span>
            </h2>
          </div>
        </div>
        <Space>
          {!proj.venv_ready && (
            <Button 
              onClick={handleInitVenv} 
              loading={initingVenv} 
            >
              Khởi tạo Venv
            </Button>
          )}
          <Button 
            type="primary" 
            icon={<Plus size="1rem" />} 
            onClick={() => setIsWfModalOpen(true)}
          >
            Workflow mới
          </Button>
        </Space>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '0.75rem 2.5rem', overflowY: 'auto' }}>
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab}
          size="small"
          tabBarGutter={24}
          items={[
            {
              key: 'workflows',
              label: <span style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Workflow size="0.875rem"/>Workflows ({workflows.length})</span>,
              children: (
                <Spin spinning={loading}>
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={workflows.map(w => w.id)} strategy={rectSortingStrategy}>
                      <div className="grid-workflows" style={{ marginTop: '1.5rem' }}>
                        {workflows.map((wf) => {
                          const wColor = wf.color || 'var(--accent-primary)'
                          return (
                          <SortableCard key={wf.id} id={wf.id}>
                            <div 
                        onClick={() => onOpenWorkflow(wf)}
                        className="project-row"
                        style={{ '--project-color': wColor }}
                      >
                        {/* Row 1: Logo, Name & Desc, Options */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem', marginBottom: '1.25rem' }}>
                          <div style={{ 
                            width: '2.75rem', height: '2.75rem', borderRadius: '0.625rem', 
                            background: `color-mix(in srgb, ${wColor} 15%, transparent)`, 
                            color: wColor, display: 'flex', alignItems: 'center', justifyContent: 'center', 
                            flexShrink: 0, border: `1px solid color-mix(in srgb, ${wColor} 30%, transparent)`
                          }}>
                            <Workflow size="1.375rem" strokeWidth={2} />
                          </div>
                          
                          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <Tooltip title={wf.name} placement="top" mouseEnterDelay={0.5}>
                              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {wf.name}
                              </h3>
                            </Tooltip>
                            <Tooltip title={wf.description || 'Chưa có mô tả'} placement="top" mouseEnterDelay={0.5}>
                              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {wf.description || 'Chưa có mô tả'}
                              </p>
                            </Tooltip>
                          </div>
                          
                          <Dropdown menu={{ items: [
                            { key: 'edit', label: 'Cài đặt', icon: <Settings size="0.938rem"/>, onClick: (e) => { e.domEvent.stopPropagation(); handleEditWf(wf); } },
                            { key: 'duplicate', label: 'Sao chép', icon: <Copy size="0.938rem"/>, onClick: (e) => { e.domEvent.stopPropagation(); handleDuplicateWorkflow(wf.id); } },
                            { type: 'divider' },
                            { key: 'delete', label: 'Xóa Workflow', icon: <Trash2 size="0.938rem"/>, danger: true, onClick: (e) => { e.domEvent.stopPropagation(); handleDeleteWorkflow(wf.id); } }
                          ]}} trigger={['click']} placement="bottomRight">
                            <Button className="project-menu-btn" type="text" icon={<MoreVertical size="1rem"/>} onClick={e => e.stopPropagation()} />
                          </Dropdown>
                        </div>

                        {/* Row 2: Time, WF Count, Status */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.8rem', borderTop: '1px solid var(--border-default)', paddingTop: '0.875rem' }}>
                          <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'center' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Clock size="0.812rem" /> {formatDate(wf.updated_at)}</span>
                          </div>
                          
                          <Button 
                            type={runningWf === wf.id ? 'default' : 'primary'} 
                            icon={runningWf === wf.id ? <Loader size="0.875rem" className="spinning"/> : <Play size="0.875rem" />}
                            onClick={(e) => handleRunWorkflow(wf, e)}
                            disabled={deletingWf === wf.id}
                            style={{ borderRadius: 6, fontWeight: 500 }}
                          >
                            {runningWf === wf.id ? 'Đang chạy' : 'Chạy'}
                          </Button>
                        </div>
                      </div>
                    </SortableCard>
                          )
                        })}
                  </div>
                </SortableContext>
              </DndContext>
                </Spin>
              )
            },
            {
              key: 'packages',
              label: <span style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}><Package size="0.875rem"/>Packages</span>,
              children: (
                <div style={{ maxWidth: 800, marginTop: 16 }}>
                  {!proj.venv_ready && (
                    <Alert message="Venv chưa sẵn sàng. Nhấn 'Khởi tạo Venv' ở góc trên bên phải để bắt đầu." type="warning" showIcon style={{ marginBottom: 24 }} />
                  )}
                  <Space.Compact size="small" style={{ width: '100%', marginBottom: 16 }}>
                    <Input 
                      size="small"
                      placeholder="Tên package, VD: pandas, scikit-learn..." 
                      value={pkgInput} 
                      onChange={e => setPkgInput(e.target.value)}
                      onPressEnter={handleInstall}
                    />
                    <Button size="small" type="primary" icon={<Download size="0.75rem" />} onClick={handleInstall} loading={installingPkg} disabled={!pkgInput.trim()}>
                      Cài đặt
                    </Button>
                    <Button size="small" icon={<RefreshCw size="0.75rem" />} onClick={loadPackages} loading={pkgLoading} />
                  </Space.Compact>
                  <Table 
                    dataSource={packages} 
                    columns={pkgColumns} 
                    rowKey="name" 
                    loading={pkgLoading}
                    pagination={{ pageSize: 10, size: 'small' }}
                    bordered
                    size="small"
                  />
                </div>
              )
            },
            {
              key: 'history',
              label: <span style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}><Terminal size="0.875rem"/>Lịch sử chạy</span>,
              children: (
                <div style={{ marginTop: 16 }}>
                  <div className="section-header">
                    <h3 className="section-title">Lịch sử chạy gần đây</h3>
                    <Button size="small" icon={<RefreshCw size="0.75rem"/>} onClick={loadHistory} loading={histLoading}>Làm mới</Button>
                  </div>
                  <Table 
                    dataSource={runHistory} 
                    columns={historyColumns} 
                    rowKey="id" 
                    loading={histLoading}
                    pagination={{ pageSize: 10, size: 'small' }}
                    bordered
                    size="small"
                  />
                </div>
              )
            }
          ]}
        />
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

      <style>{`
        .spinning { animation:spin .8s linear infinite; }
        @keyframes spin { 100% { transform:rotate(360deg); } }
      `}</style>
    </div>
  )
}
