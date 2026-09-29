import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Check, Plus, FolderOpen, Clock, Trash2, Settings, Workflow, RefreshCw, WifiOff, MoreVertical, Box, Database, Globe, Layout, Server, Sparkles, Terminal, Activity, Code, Cloud, Cpu, FileText, Layers, Rocket, Shield, Target, Zap, Folder, HardDrive, Monitor, Download, Search, LayoutGrid, List } from 'lucide-react'
import { getProjects, createProject, updateProject, deleteProject, checkHealth, getDashboardStats, reorderProjects, API_BASE } from '../api/client'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button, Modal, Form, Input, Dropdown, Spin, Tag, Space, Alert, Tooltip, App, Switch, Empty } from 'antd'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import useStore from '../store/useStore'
import SidePanel from '../components/SidePanel'

const COLORS = ['#6c63ff','#00d4aa','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16']
const ICONS = {
  Box, Database, Globe, Layout, Server, Sparkles, Terminal, Activity,
  Code, Cloud, Cpu, FileText, Layers, Rocket, Shield, Target, Zap, Folder, HardDrive, Monitor
}

export default function Dashboard({ onOpenProject, refreshTick, openCreateModal, onCloseCreateModal, onStatsChange, currentUser, panelVisible, isSmallScreen }) {
  // Modal.confirm TĨNH không đọc được context của ConfigProvider: dialog xác nhận
  // hiện ra với style antd mặc định (xanh dương, bo góc khác, cao khác) lệch hẳn
  // phần còn lại của app, mất luôn locale vi_VN, và antd v6 in warning
  // "Static function can not consume context like dynamic theme" ra console.
  const { modal } = App.useApp()
  const { t } = useTranslation()

  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [backendOnline, setBackendOnline] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  // Chế độ xem (thẻ/danh sách) — lưu theo user trong DB, độc lập với workflowViewMode
  // của ProjectDetail vì đây là 2 danh sách khác nhau (project vs workflow).
  const viewMode = useStore((s) => s.projectViewMode)
  const setViewMode = useStore((s) => s.setProjectViewMode)

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
        toast.success(t('dashboard.updateSuccess'))
      } else {
        const res = await createProject({
          name: values.name.trim(),
          description: values.description?.trim() || null,
          color: selectedColor,
          icon: selectedIcon,
        })
        setProjects((prev) => [res.data, ...prev])
        toast.success(t('dashboard.createSuccess'))
      }
      handleModalClose()
    } catch (e) {
      toast.error(t('dashboard.genericError', { message: e.message }))
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
    modal.confirm({
      title: t('dashboard.deleteTitle'),
      content: t('dashboard.deleteContent'),
      okText: t('dashboard.deletePermanently'),
      okType: 'danger',
      cancelText: t('common.cancel'),
      onOk: async () => {
        try {
          await deleteProject(id)
          toast.success(t('dashboard.deleteSuccess'))
          // Reload toàn bộ để cập nhật cả stats trên Navbar
          loadData()
        } catch (e) {
          toast.error(t('dashboard.deleteError', { message: e.message }))
        }
      }
    })
  }

  const handleExport = (project) => {
    window.location.href = `${API_BASE}/api/projects/${project.id}/export`
    toast.success(t('dashboard.exporting', { name: project.name }))
  }

  // Lọc theo tên/mô tả — cùng cách với ProjectDetail: chỉ có ý nghĩa kéo-thả sắp
  // xếp khi đang hiện ĐỦ danh sách (không lọc).
  const isSearching = searchQuery.trim().length > 0
  const filteredProjects = useMemo(() => {
    if (!isSearching) return projects
    const q = searchQuery.trim().toLowerCase()
    return projects.filter((p) =>
      p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
    )
  }, [projects, searchQuery, isSearching])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = async ({ active, over }) => {
    if (isSearching) return // sắp xếp theo index của danh sách ĐÃ LỌC sẽ ra sort_order sai
    if (!over || active.id === over.id) return
    const oldIndex = projects.findIndex(p => p.id === active.id)
    const newIndex = projects.findIndex(p => p.id === over.id)
    const reordered = arrayMove(projects, oldIndex, newIndex)
    setProjects(reordered)
    try {
      await reorderProjects(reordered.map((p, i) => ({ id: p.id, sort_order: i })))
    } catch {
      toast.error(t('dashboard.reorderError'))
    }
  }

  if (backendOnline === false) {
    return (
      <div style={{ padding: 40 }}>
        <Alert
          title={t('dashboard.backendOfflineTitle')}
          description={
            <div>
              {t('dashboard.backendOfflineDesc')}
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
              <RefreshCw size="0.875rem" style={{ marginRight: 6 }} /> {t('dashboard.retry')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>
      {/* Header — đồng bộ height/padding/background với header của ProjectDetail */}
      <div className="section-header" style={{ height: 'var(--navbar-height)', display: 'flex', alignItems: 'center', padding: '0 1rem', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', margin: 0, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.625rem', minWidth: 0 }}>
          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            {currentUser ? t('dashboard.greetingUser', { name: currentUser.name }) : t('dashboard.greetingGuest')}
          </span>
          <span style={{ color: 'var(--border-subtle)' }}>|</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {currentUser
              ? t('dashboard.subtitleUser', { count: projects.length })
              : t('dashboard.subtitleGuest', { count: projects.length })
            }
          </span>
        </div>
      </div>

      {/* Toolbar — tìm kiếm + chế độ xem, cùng kích thước/vị trí với toolbar của ProjectDetail */}
      <div style={{ height: 'var(--toolbar-height)', display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0 1rem', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <Input
          allowClear
          prefix={<Search size="0.875rem" style={{ color: 'var(--text-muted)' }} />}
          placeholder={t('dashboard.searchPlaceholder')}
          aria-label={t('dashboard.searchAria')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: 320 }}
        />
        <div style={{ width: 1, height: '1.25rem', background: 'var(--border-default)' }} />
        <Tooltip title={viewMode === 'list' ? t('dashboard.viewGrid') : t('dashboard.viewList')}>
          <Switch
            aria-label={t('dashboard.viewModeAria')}
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
              {error && (
                <Alert title={error} type="error" showIcon style={{ marginBottom: 20 }}
                  action={<Button size="small" onClick={loadData}>{t('dashboard.retry')}</Button>}
                />
              )}

              <Spin spinning={loading}>
                {!loading && projects.length === 0 && !error ? (
                  <div className="empty-state">
                    <FolderOpen className="empty-state-icon" />
                    <div>
                      <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 600 }}>{t('dashboard.emptyTitle')}</h3>
                      <p style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>{t('dashboard.emptyDesc')}</p>
                    </div>
                    <Button type="primary" onClick={() => setIsModalOpen(true)} icon={<Plus size="1rem" />} size="large" style={{ marginTop: '0.5rem' }}>
                      {t('dashboard.createProject')}
                    </Button>
                  </div>
                ) : filteredProjects.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span style={{ color: 'var(--text-muted)' }}>{t('dashboard.searchNoResults', { query: searchQuery.trim() })}</span>}
                    style={{ padding: '3rem' }}
                  />
                ) : (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={filteredProjects.map(p => p.id)} strategy={rectSortingStrategy}>
                      <div className={viewMode === 'list' ? 'list-projects' : 'grid-projects'} style={{ marginTop: '0.5rem' }}>
                        {filteredProjects.map((project) => (
                          <ProjectCard
                            key={project.id}
                            project={project}
                            listView={viewMode === 'list'}
                            dragDisabled={isSearching}
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

      {/* Create Modal */}
      <Modal
        title={
          <Space>
            <div style={{ width:26, height:26, background:'var(--premium-gradient-1)', borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', color:'white' }}>
              {editingProject ? <Settings size="0.875rem" /> : <Plus size="0.875rem" />}
            </div>
            {editingProject ? t('dashboard.editProject') : t('dashboard.newProject')}
          </Space>
        }
        open={isModalOpen}
        onCancel={handleModalClose}
        footer={null}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit} style={{ marginTop: 24 }}>
          <Form.Item name="name" label={t('dashboard.nameLabel')} rules={[{ required: true, message: t('dashboard.nameRequired') }]}>
            <Input placeholder={t('dashboard.namePlaceholder')} size="large" autoFocus />
          </Form.Item>
          <Form.Item name="description" label={t('dashboard.descLabel')}>
            <Input.TextArea placeholder={t('dashboard.descPlaceholder')} rows={3} />
          </Form.Item>
          <Form.Item label={t('dashboard.iconLabel')}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {Object.keys(ICONS).map((iconName) => {
                const IconComponent = ICONS[iconName]
                const isSelected = selectedIcon === iconName
                return (
                  // <button> chứ không <div>: bản cũ không có role/tabIndex/onKeyDown
                  // nên người dùng bàn phím KHÔNG chọn được biểu tượng, tức không tạo
                  // nổi project; screen reader thì đọc ra một <div> rỗng.
                  <button
                    key={iconName}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={t('dashboard.iconAria', { name: iconName })}
                    onClick={() => setSelectedIcon(iconName)}
                    style={{
                      width: 36, height: 36, borderRadius: 8,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', background: isSelected ? `${selectedColor}22` : 'var(--bg-base)',
                      border: isSelected ? `2px solid ${selectedColor}` : '2px solid transparent',
                      color: isSelected ? selectedColor : 'var(--text-secondary)',
                      transition: 'all 0.2s', padding: 0,
                    }}
                  >
                    <IconComponent size="1.125rem" />
                  </button>
                )
              })}
            </div>
          </Form.Item>
          <Form.Item label={t('dashboard.colorLabel')}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {COLORS.map((c) => (
                // Trạng thái "đang chọn" trước đây chỉ báo bằng MÀU + scale + opacity —
                // người mù màu không phân biệt được ô nào đang chọn (Priority 1:
                // không dùng màu làm tín hiệu duy nhất). Thêm dấu ✓ và aria-pressed.
                <button
                  key={c}
                  type="button"
                  aria-pressed={selectedColor === c}
                  aria-label={t('dashboard.colorAria', { color: c })}
                  onClick={() => setSelectedColor(c)}
                  style={{
                    width: 30, height: 30, borderRadius: '50%', background: c,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                    cursor: 'pointer', border: selectedColor === c ? '3px solid var(--bg-surface)' : '2px solid transparent',
                    boxShadow: selectedColor === c ? `0 0 0 2px ${c}, 0 4px 12px ${c}88` : 'none',
                    transform: selectedColor === c ? 'scale(1.1)' : 'scale(1)',
                    transition: 'all 0.2s', opacity: selectedColor === c ? 1 : 0.5
                  }}
                >
                  {selectedColor === c && <Check size="1rem" color="#fff" strokeWidth={3} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 28 }}>
            <Button onClick={handleModalClose}>{t('common.cancel')}</Button>
            <Button type="primary" htmlType="submit" loading={creating}>
              {editingProject ? t('dashboard.saveChanges') : t('dashboard.createProject')}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  )
}

function ProjectCard({ project, listView, dragDisabled, onOpen, onEdit, onExport, onDelete }) {
  const { t, i18n } = useTranslation()
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

  const locale = i18n.language === 'en' ? 'en-US' : 'vi-VN'
  const formatDate = (iso) => {
    if (!iso) return '-'
    try {
      const d = new Date(iso)
      const diff = Date.now() - d.getTime()
      if (diff <= 5 * 60 * 1000) {
        if (diff < 60000) return t('dashboard.justNow')
        return t('dashboard.minutesAgo', { count: Math.floor(diff / 60000) })
      }
      const time = d.toLocaleTimeString(locale, { hour12: false, hour: '2-digit', minute: '2-digit' })
      const date = d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
      return `${time} ${date}`
    } catch { return iso }
  }

  let statusText = t('dashboard.statusCreatingVenv')
  let statusColor = 'warning'

  // Ưu tiên: đang chạy > lỗi gần đây > đã có venv > đang tạo venv
  if (project.running_count > 0) {
    statusText = t('dashboard.statusRunning')
    statusColor = 'processing'
  } else if (project.last_run_status === 'error') {
    statusText = t('dashboard.statusRecentError')
    statusColor = 'error'
  } else if (project.venv_ready) {
    statusText = t('dashboard.statusVenvReady')
    statusColor = 'success'
  }

  const IconComponent = ICONS[project.icon] || Box
  const pColor = project.color || 'var(--accent-primary)'

  const items = [
    { key: 'edit', label: t('dashboard.menuSettings'), icon: <Settings size="0.938rem" />, onClick: (e) => { e.domEvent.stopPropagation(); onEdit(); } },
    { key: 'export', label: t('dashboard.menuExport'), icon: <Download size="0.938rem" />, onClick: (e) => { e.domEvent.stopPropagation(); onExport(); } },
    { type: 'divider' },
    { key: 'delete', label: t('dashboard.menuDelete'), icon: <Trash2 size="0.938rem" />, danger: true, onClick: (e) => { e.domEvent.stopPropagation(); onDelete(); } },
  ]

  const rootProps = {
    ref: setNodeRef,
    style: { ...style, '--proj-color': pColor },
    ...(dragDisabled ? {} : attributes),
    ...(dragDisabled ? {} : listeners),
    onClick: onOpen,
    // Thẻ project là <div> nên bàn phím không mở được project nào — với người
    // chỉ dùng bàn phím thì app coi như không dùng được. role/tabIndex/onKeyDown
    // biến nó thành điểm dừng Tab hợp lệ và nhận Enter/Space như một nút.
    role: 'button',
    tabIndex: 0,
    'aria-label': t('dashboard.openProjectAria', { name: project.name }),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(e) }
    },
  }

  if (listView) {
    return (
      <div {...rootProps} className="project-row project-row--list">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <div style={{
            width: '2.25rem', height: '2.25rem', borderRadius: '0.5rem', flexShrink: 0,
            background: `color-mix(in srgb, ${pColor} 15%, transparent)`,
            color: pColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid color-mix(in srgb, ${pColor} 30%, transparent)`
          }}>
            <IconComponent size="1.125rem" strokeWidth={2} />
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '0.625rem' }}>
            <Tooltip title={project.name} placement="top" mouseEnterDelay={0.5}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%', flexShrink: 0 }}>
                {project.name}
              </span>
            </Tooltip>
            <Tooltip title={project.description || t('dashboard.noDescription')} placement="top" mouseEnterDelay={0.5}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {project.description || t('dashboard.noDescription')}
              </span>
            </Tooltip>
          </div>

          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>
            <Clock size="0.75rem" style={{ flexShrink: 0 }} />
            {formatDate(project.updated_at || project.created_at)}
          </span>

          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-muted)', fontSize: '0.75rem', flexShrink: 0 }}>
            <Workflow size="0.75rem" style={{ flexShrink: 0 }} />
            {project.workflow_count || 0}
          </span>

          <Tag color={statusColor} style={{ margin: 0, borderRadius: '0.375rem', border: 'none', padding: '0.125rem 0.5rem', fontSize: '0.75rem', fontWeight: 500, flexShrink: 0 }}>
            {statusText}
          </Tag>

          <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
            <Button
              type="text"
              size="small"
              icon={<MoreVertical size="1rem" />}
              aria-label={t('dashboard.projectMenuAria')}
              onClick={e => e.stopPropagation()}
              className="project-menu-btn"
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
            />
          </Dropdown>
        </div>
      </div>
    )
  }

  return (
    <div {...rootProps} className="project-row">

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
          <Tooltip title={project.description || t('dashboard.noDescription')} placement="top" mouseEnterDelay={0.5}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project.description || t('dashboard.noDescription')}
            </p>
          </Tooltip>
        </div>

        <Dropdown menu={{ items }} trigger={['click']}>
          <Button
            type="text"
            icon={<MoreVertical size="1.125rem" />}
            aria-label={t('dashboard.projectMenuAria')}
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

