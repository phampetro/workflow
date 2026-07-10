import React, { useState, useEffect, useCallback } from 'react'
import { Plus, FolderOpen, Clock, Trash2, Settings, ChevronRight, Workflow, RefreshCw, WifiOff, MoreVertical, Box, Database, Globe, Layout, Server, Sparkles, Terminal, Activity, Code, Cloud, Cpu, FileText, Layers, Rocket, Shield, Target, Zap, Folder, HardDrive, Monitor } from 'lucide-react'
import { getProjects, createProject, updateProject, deleteProject, checkHealth, getDashboardStats, reorderProjects } from '../api/client'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import SortableCard from '../components/SortableCard'
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
          message="Backend chưa khởi động"
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
          icon={<WifiOff size={24} />}
          action={
            <Button size="small" type="primary" onClick={() => checkBackend().then(ok => ok && loadData())}>
              <RefreshCw size={14} style={{ marginRight: 6 }} /> Thử lại
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div style={{ padding: '28px 36px', overflowY: 'auto', height: '100%' }}>
      {/* Greeting */}
      <div style={{ marginBottom: 24 }}>
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

      {/* Error state */}
      {error && (
        <Alert message={error} type="error" showIcon style={{ marginBottom: 20 }}
          action={<Button size="small" onClick={loadData}>Thử lại</Button>}
        />
      )}

      {/* Projects Grid */}
      <Spin spinning={loading}>
        {!loading && projects.length === 0 && !error ? (
          <Empty
            description={<span>Chưa có project nào. Tạo project đầu tiên để bắt đầu xây dựng workflow</span>}
            style={{ margin: '60px 0' }}
          >
            <Button type="primary" onClick={() => setIsModalOpen(true)} icon={<Plus size={14} />}>Tạo Project</Button>
          </Empty>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={projects.map(p => p.id)} strategy={rectSortingStrategy}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 20 }}>
                {projects.map((project) => (
                  <SortableCard key={project.id} id={project.id}>
                    <ProjectCard
                      project={project}
                      onOpen={() => onOpenProject?.(project)}
                      onEdit={() => handleEdit(project)}
                      onDelete={() => handleDelete(project.id)}
                    />
                  </SortableCard>
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
              {editingProject ? <Settings size={14} /> : <Plus size={14} />}
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
                    <IconComponent size={18} />
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
        .spinning { animation: spin .8s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .project-row:hover {
          border-color: var(--border-accent) !important;
          background: var(--bg-hover) !important;
        }
        .btn-delete { opacity: 0.3; transition: all 0.2s; }
        .project-row:hover .btn-delete { opacity: 1; }
        .project-menu-btn { transition: all 0.2s; border-radius: 4px; }
        .project-menu-btn:hover { background: var(--bg-surface); }
      `}</style>
    </div>
  )
}

function ProjectCard({ project, onOpen, onEdit, onDelete }) {
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

  let statusText = 'Đang tạo venv'
  let statusColor = 'warning'
  
  if (project.running_count > 0) {
    statusText = 'Đang chạy'
    statusColor = 'processing'
  } else if (project.venv_ready) {
    if (project.workflow_count === 0) {
      statusText = 'Sẵn sàng'
      statusColor = 'success'
    } else {
      statusText = 'Sẵn sàng'
      statusColor = 'success'
    }
  }

  const IconComponent = ICONS[project.icon] || Box

  const items = [
    { key: 'edit', label: 'Chỉnh sửa', icon: <Settings size={14} />, onClick: (e) => { e.domEvent.stopPropagation(); onEdit(); } },
    { type: 'divider' },
    { key: 'delete', label: 'Xóa Project', icon: <Trash2 size={14} />, danger: true, onClick: (e) => { e.domEvent.stopPropagation(); onDelete(); } },
  ]

  return (
    <div 
      onClick={onOpen}
      className="project-row"
      style={{ 
        display: 'flex', 
        flexDirection: 'column',
        padding: '16px', 
        background: 'var(--bg-elevated)', 
        border: '1px solid var(--border-default)', 
        borderTop: `4px solid ${project.color || 'var(--accent-primary)'}`,
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative',
        height: '100%',
        justifyContent: 'space-between'
      }}
    >
      {/* Row 1: Logo, Name & Desc, Options */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: `${project.color || '#6c63ff'}22`, color: project.color || '#6c63ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <IconComponent size={20} />
        </div>
        
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, marginTop: -2 }}>
          <Tooltip title={project.name} placement="top" mouseEnterDelay={0.5}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project.name}
            </h3>
          </Tooltip>
          <Tooltip title={project.description || 'Chưa có mô tả'} placement="top" mouseEnterDelay={0.5}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project.description || 'Chưa có mô tả'}
            </p>
          </Tooltip>
        </div>
        
        <Dropdown menu={{ items }} trigger={['click']}>
          <Button 
            type="text" 
            icon={<MoreVertical size={16} />} 
            onClick={e => e.stopPropagation()}
            className="project-menu-btn"
            style={{ padding: 4, height: 'auto', color: 'var(--text-muted)' }}
          />
        </Dropdown>
      </div>

      {/* Row 2: Time, WF Count, Status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.75rem', borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> {formatDate(project.updated_at || project.created_at)}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Workflow size={12} /> {project.workflow_count || 0} WF</span>
        </div>
        
        <Tag color={statusColor} style={{ margin: 0, border: 'none', padding: '0 6px', fontSize: '0.65rem', lineHeight: '18px' }}>
          {statusText}
        </Tag>
      </div>
    </div>
  )
}
