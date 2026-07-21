import React, { useState, useEffect, useCallback } from 'react'
import { Plus, FolderOpen, Clock, Trash2, Settings, ChevronRight, Workflow, RefreshCw, WifiOff, MoreVertical, Box, Database, Globe, Layout, Server, Sparkles, Terminal, Activity, Code, Cloud, Cpu, FileText, Layers, Rocket, Shield, Target, Zap, Folder, HardDrive, Monitor, Download, GripVertical } from 'lucide-react'
import { getProjects, createProject, updateProject, deleteProject, checkHealth, getDashboardStats, reorderProjects } from '../api/client'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button, Modal, Form, Input, Card, Dropdown, Spin, Empty, Tag, Space, Alert, Tooltip } from 'antd'
import toast from 'react-hot-toast'

const COLORS = ['#6c63ff','#00d4aa','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16']
const ICONS = {
  Box, Database, Globe, Layout, Server, Sparkles, Terminal, Activity,
  Code, Cloud, Cpu, FileText, Layers, Rocket, Shield, Target, Zap, Folder, HardDrive, Monitor
}

export default function Dashboard({ onOpenProject, refreshTick, openCreateModal, onCloseCreateModal, onStatsChange, currentUser }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [backendOnline, setBackendOnline] = useState(null)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState(null)
  const [form] = Form.useForm()
  const [creating, setCreating] = useState(false)
  const [selectedColor, setSelectedColor] = useState('#6c63ff')
  const [selectedIcon, setSelectedIcon] = useState('Box')

  // Sync external open trigger from Navbar button
  useEffect(() => {
    if (openCreateModal) {
      setIsModalOpen(true)
    }
  }, [openCreateModal])

  const handleModalClose = () => {
    setIsModalOpen(false)
    setEditingProject(null)
    form.resetFields()
    setSelectedColor('#6c63ff')
    setSelectedIcon('Box')
    onCloseCreateModal?.()
  }

  const checkBackend = useCallback(async () => {
    try {
      await checkHealth()
      setBackendOnline(true)
      return true
    } catch {
      setBackendOnline(false)
      return false
    }
  }, [])

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [resProj, resStats] = await Promise.all([getProjects(), getDashboardStats()])
      const newProjects = resProj.data || []
      setProjects(newProjects)
      const s = resStats.data?.data || null
      onStatsChange?.(s)
      return newProjects
    } catch (e) {
      setError(e.message)
      return []
    } finally {
      if (!silent) setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Initial load
  const isFirstLoad = React.useRef(true)
  useEffect(() => {
    checkBackend().then((online) => {
      if (online) loadData()
      else setLoading(false)
    })
  }, [])

  // Reload khi đổi user (bỏ qua lần mount đầu)
  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false
      return
    }
    if (backendOnline && currentUser) {
      loadData()
    }
  }, [currentUser])

  // Reload on refreshTick from Navbar
  useEffect(() => {
    if (refreshTick > 0 && backendOnline) {
      loadData()
    }
  }, [refreshTick])

  // Auto-refresh khi có project đang chạy
  useEffect(() => {
    if (!backendOnline) return
    const hasRunning = projects.some(p => p.running_count > 0)
    if (!hasRunning) return
    const timer = setInterval(() => {
      loadData(true) // silent = không show loading spinner
    }, 5000)
    return () => clearInterval(timer)
  }, [projects, backendOnline, loadData])

  const handleSubmit = async (values) => {
    setCreating(true)
    try {
      if (editingProject) {
        const res = await updateProject(editingProject.id, {
          name: values.name.trim(),
          description: values.description?.trim() || null,
          color: selectedColor,
          icon: selectedIcon,
        })
        setProjects((prev) => prev.map(p => p.id === editingProject.id ? { ...p, ...res.data } : p))
        toast.success('Cập nhật project thành công!')
      } else {
        const res = await createProject({
          name: values.name.trim(),
          description: values.description?.trim() || null,
          color: selectedColor,
          icon: selectedIcon,
        })
        setProjects((prev) => [res.data, ...prev])
        toast.success('Tạo project thành công!')
      }
      handleModalClose()
    } catch (e) {
      toast.error('Lỗi: ' + e.message)
    } finally {
      setCreating(false)
    }
  }

  const handleEdit = (project) => {
    setEditingProject(project)
    form.setFieldsValue({ name: project.name, description: project.description })
    setSelectedColor(project.color || '#6c63ff')
    setSelectedIcon(project.icon || 'Box')
    setIsModalOpen(true)
  }

  const handleDelete = (id) => {
    Modal.confirm({
      title: 'Xóa Project',
      content: 'Bạn có chắc muốn xóa project này? Tất cả workflows, lịch chạy và virtual environment sẽ bị xóa vĩnh viễn.',
      okText: 'Xóa vĩnh viễn',
      okType: 'danger',
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          await deleteProject(id)
          toast.success('Đã xóa project!')
          // Reload toàn bộ để cập nhật cả stats trên Navbar
          loadData()
        } catch (e) {
          toast.error('Lỗi xóa project: ' + e.message)
        }
      }
    })
  }

  const handleExport = (project) => {
    window.location.href = `http://localhost:7000/api/projects/${project.id}/export`
    toast.success(`Đang tải xuống project ${project.name}...`)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return
    const oldIndex = projects.findIndex(p => p.id === active.id)
    const newIndex = projects.findIndex(p => p.id === over.id)
    const reordered = arrayMove(projects, oldIndex, newIndex)
    setProjects(reordered)
    try {
      await reorderProjects(reordered.map((p, i) => ({ id: p.id, sort_order: i })))
    } catch {
      toast.error('Lỗi lưu thứ tự')
    }
  }

  if (backendOnline === false) {
    return (
      <div style={{ padding: 40 }}>
        <Alert
          title="Backend chưa khởi động"
          description={
            <div>
              Chạy lệnh sau để khởi động backend:
              <pre style={{ marginTop: 8, padding: '8px 12px', background: 'var(--bg-base)', borderRadius: 8 }}>
                cd backend &amp;&amp; .venv\Scripts\python main.py
              </pre>
            </div>
          }
          type="error"
          showIcon
          icon={<WifiOff size="1.5rem" />}
          action={
            <Button size="small" type="primary" onClick={() => checkBackend().then(ok => ok && loadData())}>
              <RefreshCw size="0.875rem" style={{ marginRight: 6 }} /> Thử lại
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div style={{ padding: '2rem 2.5rem', overflowY: 'auto', height: '100%' }}>
      {/* Greeting */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            {currentUser ? `Xin chào, ${currentUser.name}! 👋` : 'Workspace'}
          </h2>
          <p style={{ color: 'var(--text-muted)', margin: '3px 0 0 0', fontSize: '0.83rem' }}>
            {currentUser
              ? `Bạn có ${projects.length} project${projects.length !== 1 ? 's' : ''} — chúc bạn làm việc hiệu quả!`
              : `${projects.length} project${projects.length !== 1 ? 's' : ''} — Quản lý tất cả workflows của bạn`
            }
          </p>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <Alert title={error} type="error" showIcon style={{ marginBottom: 20 }}
          action={<Button size="small" onClick={loadData}>Thử lại</Button>}
        />
      )}

      {/* Projects Grid */}
      <Spin spinning={loading}>
        {!loading && projects.length === 0 && !error ? (
          <div className="empty-state">
            <FolderOpen className="empty-state-icon" />
            <div>
              <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 600 }}>Chưa có dự án nào</h3>
              <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>Bắt đầu bằng cách tạo một project mới để chứa các workflows.</p>
            </div>
            <Button type="primary" onClick={() => setIsModalOpen(true)} icon={<Plus size="1rem" />} size="large" style={{ marginTop: '0.5rem' }}>
              Tạo Project
            </Button>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={projects.map(p => p.id)} strategy={rectSortingStrategy}>
              <div className="grid-projects">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={() => onOpenProject?.(project)}
                    onEdit={() => handleEdit(project)}
                    onExport={() => handleExport(project)}
                    onDelete={() => handleDelete(project.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </Spin>

      {/* Create Modal */}
      <Modal
        title={
          <Space>
            <div style={{ width:26, height:26, background:'linear-gradient(135deg,var(--accent-primary),#8b5cf6)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', color:'white' }}>
              {editingProject ? <Settings size="0.875rem" /> : <Plus size="0.875rem" />}
            </div>
            {editingProject ? 'Chỉnh sửa Project' : 'Tạo Project Mới'}
          </Space>
        }
        open={isModalOpen}
        onCancel={handleModalClose}
        footer={null}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 24 }}>
          <Form.Item name="name" label="Tên Project" rules={[{ required: true, message: 'Vui lòng nhập tên project!' }]}>
            <Input placeholder="VD: Data ETL Pipeline" size="large" autoFocus />
          </Form.Item>
          <Form.Item name="description" label="Mô tả">
            <Input.TextArea placeholder="Mô tả ngắn về project..." rows={3} />
          </Form.Item>
          <Form.Item label="Biểu tượng">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.keys(ICONS).map((iconName) => {
                const IconComponent = ICONS[iconName]
                const isSelected = selectedIcon === iconName
                return (
                  <div
                    key={iconName}
                    onClick={() => setSelectedIcon(iconName)}
                    style={{
                      width: 36, height: 36, borderRadius: 8,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', background: isSelected ? `${selectedColor}22` : 'var(--bg-base)',
                      border: isSelected ? `2px solid ${selectedColor}` : '2px solid transparent',
                      color: isSelected ? selectedColor : 'var(--text-secondary)',
                      transition: 'all 0.2s',
                    }}
                  >
                    <IconComponent size="1.125rem" />
                  </div>
                )
              })}
            </div>
          </Form.Item>
          <Form.Item label="Màu sắc">
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {COLORS.map((c) => (
                <div
                  key={c}
                  onClick={() => setSelectedColor(c)}
                  style={{
                    width: 30, height: 30, borderRadius: '50%', background: c,
                    cursor: 'pointer', border: selectedColor === c ? '3px solid var(--bg-surface)' : '2px solid transparent',
                    boxShadow: selectedColor === c ? `0 0 0 2px ${c}, 0 4px 12px ${c}88` : 'none',
                    transform: selectedColor === c ? 'scale(1.1)' : 'scale(1)',
                    transition: 'all 0.2s', opacity: selectedColor === c ? 1 : 0.5
                  }}
                />
              ))}
            </div>
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 28 }}>
            <Button onClick={handleModalClose}>Hủy</Button>
            <Button type="primary" htmlType="submit" loading={creating}>
              {editingProject ? 'Lưu thay đổi' : 'Tạo Project'}
            </Button>
          </div>
        </Form>
      </Modal>

      <style>{`
        .spinning { animation: spin 1.2s linear infinite; }
      `}</style>
    </div>
  )
}

function ProjectCard({ project, onOpen, onEdit, onExport, onDelete }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id })

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
      const diff = Date.now() - d.getTime()
      if (diff <= 5 * 60 * 1000) {
        if (diff < 60000) return 'Vừa xong'
        return `${Math.floor(diff / 60000)} phút trước`
      }
      const time = d.toLocaleTimeString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit' })
      const date = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      return `${time} ${date}`
    } catch { return iso }
  }

  let statusText = 'Đang tạo venv'
  let statusColor = 'warning'

  // Ưu tiên: đang chạy > lỗi gần đây > đã có venv > đang tạo venv
  if (project.running_count > 0) {
    statusText = 'Đang chạy'
    statusColor = 'processing'
  } else if (project.last_run_status === 'error') {
    statusText = 'Lỗi gần đây'
    statusColor = 'error'
  } else if (project.venv_ready) {
    statusText = 'Đã có venv'
    statusColor = 'success'
  }

  const IconComponent = ICONS[project.icon] || Box
  const pColor = project.color || 'var(--accent-primary)'

  const items = [
    { key: 'edit', label: 'Cài đặt', icon: <Settings size="0.938rem" />, onClick: (e) => { e.domEvent.stopPropagation(); onEdit(); } },
    { key: 'export', label: 'Export ZIP', icon: <Download size="0.938rem" />, onClick: (e) => { e.domEvent.stopPropagation(); onExport(); } },
    { type: 'divider' },
    { key: 'delete', label: 'Xóa Project', icon: <Trash2 size="0.938rem" />, danger: true, onClick: (e) => { e.domEvent.stopPropagation(); onDelete(); } },
  ]

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, '--proj-color': pColor }}
      className="project-row"
      {...attributes}
      {...listeners}
      onClick={onOpen}
    >

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem', paddingLeft: '1.25rem' }}>
        <div style={{
          width: '2.75rem', height: '2.75rem', borderRadius: '0.625rem',
          background: `color-mix(in srgb, ${pColor} 15%, transparent)`,
          color: pColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, border: `1px solid color-mix(in srgb, ${pColor} 30%, transparent)`
        }}>
          <IconComponent size="1.375rem" strokeWidth={2} />
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <Tooltip title={project.name} placement="top" mouseEnterDelay={0.5}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project.name}
            </h3>
          </Tooltip>
          <Tooltip title={project.description || 'Chưa có mô tả'} placement="top" mouseEnterDelay={0.5}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project.description || 'Chưa có mô tả'}
            </p>
          </Tooltip>
        </div>

        <Dropdown menu={{ items }} trigger={['click']}>
          <Button
            type="text"
            icon={<MoreVertical size="1.125rem" />}
            onClick={e => e.stopPropagation()}
            className="project-menu-btn"
            style={{ color: 'var(--text-muted)' }}
          />
        </Dropdown>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.8rem', borderTop: '1px solid var(--border-default)', paddingTop: '0.875rem', marginTop: '0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Clock size="0.812rem" /> {formatDate(project.updated_at || project.created_at)}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}><Workflow size="0.812rem" /> {project.workflow_count || 0}</span>
        </div>

        <Tag color={statusColor} style={{ margin: 0, borderRadius: '0.375rem', border: 'none', padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 500 }}>
          {statusText}
        </Tag>
      </div>
    </div>
  )
}

