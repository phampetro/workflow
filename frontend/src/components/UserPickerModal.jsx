import React, { useState, useEffect } from 'react'
import { User, Plus, Trash2, LogIn, FolderOpen, Workflow, Clock, CheckCircle } from 'lucide-react'
import { Modal, Button, Input, Spin, Empty } from 'antd'
import { getUsers, createUser, deleteUser, activateUser, getUserStats } from '../api/client'
import toast from 'react-hot-toast'
import useStore from '../store/useStore'

/**
 * Modal chọn / tạo người dùng.
 * Props:
 *   open          boolean
 *   onClose       fn()            — đóng modal
 *   onSelect      fn(user)        — callback khi chọn user thành công
 *   allowClose    boolean         — có cho phép bấm X không (false khi chưa có user nào)
 */
export default function UserPickerModal({ open, onClose, onSelect, allowClose = true }) {
  const currentUser = useStore((s) => s.currentUser)
  const [users, setUsers] = useState([])
  const [userStats, setUserStats] = useState({}) // { [userId]: { project_count, workflow_count, schedule_count } }
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [activating, setActivating] = useState(null)

  const loadUsers = async () => {
    setLoading(true)
    try {
      const res = await getUsers()
      const list = res.data || []
      setUsers(list)

      // Load stats cho tất cả users song song
      const statsResults = await Promise.allSettled(
        list.map((u) => getUserStats(u.id).then((r) => ({ id: u.id, stats: r.data })))
      )
      const statsMap = {}
      for (const r of statsResults) {
        if (r.status === 'fulfilled') {
          statsMap[r.value.id] = r.value.stats
        }
      }
      setUserStats(statsMap)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) loadUsers()
  }, [open])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await createUser({ name })
      const newUser = res.data
      setUsers((prev) => [...prev, newUser])
      setUserStats((prev) => ({ ...prev, [newUser.id]: { project_count: 0, workflow_count: 0, schedule_count: 0 } }))
      setNewName('')
      setShowInput(false)
      toast.success(`Đã tạo người dùng "${name}"`)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setCreating(false)
    }
  }

  const handleSelect = async (user) => {
    if (activating) return
    setActivating(user.id)
    try {
      const res = await activateUser(user.id)
      const loaded = res.data?.schedules_loaded ?? 0
      onSelect(user)
      toast.success(
        <div>
          <div style={{ fontWeight: 600 }}>Xin chào, {user.name}! 👋</div>
          {loaded > 0
            ? <div style={{ fontSize: '0.8rem', opacity: 0.85 }}>{loaded} lịch chạy đã được kích hoạt</div>
            : <div style={{ fontSize: '0.8rem', opacity: 0.85 }}>Không gian làm việc riêng của bạn đã sẵn sàng</div>
          }
        </div>,
        { duration: 4000 }
      )
    } catch (e) {
      toast.error('Lỗi kích hoạt người dùng: ' + e.message)
    } finally {
      setActivating(null)
    }
  }

  const handleDelete = async (e, user) => {
    e.stopPropagation()
    Modal.confirm({
      title: `Xóa "${user.name}"?`,
      content: 'Tất cả projects, workflows và lịch chạy của người dùng này sẽ bị xóa vĩnh viễn.',
      okText: 'Xóa',
      okType: 'danger',
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          await deleteUser(user.id)
          setUsers((prev) => prev.filter((u) => u.id !== user.id))
          setUserStats((prev) => {
            const next = { ...prev }
            delete next[user.id]
            return next
          })
          toast.success(`Đã xóa "${user.name}"`)
        } catch (e) {
          toast.error(e.message)
        }
      },
    })
  }

  return (
    <Modal
      open={open}
      onCancel={allowClose ? onClose : undefined}
      closable={allowClose}
      mask={{ closable: allowClose }}
      footer={null}
      width={460}
      centered
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32,
            background: 'linear-gradient(135deg, var(--accent-primary), #8b5cf6)',
            borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff'
          }}>
            <User size="1rem" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Chọn người dùng</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              Mỗi người dùng có không gian làm việc và lịch chạy riêng biệt
            </div>
          </div>
        </div>
      }
    >
      <Spin spinning={loading}>
        {!loading && users.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Chưa có người dùng nào — hãy tạo người dùng đầu tiên!"
            style={{ margin: '24px 0 16px 0' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, marginTop: 8 }}>
            {users.map((user) => {
              const isActive = currentUser?.id === user.id
              const isActivating = activating === user.id
              const stats = userStats[user.id]

              return (
                <div
                  key={user.id}
                  onClick={() => !isActivating && !isActive && handleSelect(user)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 10,
                    border: isActive
                      ? '2px solid var(--accent-primary)'
                      : '1px solid var(--border-default)',
                    background: isActive
                      ? 'color-mix(in srgb, var(--accent-primary) 8%, var(--bg-elevated))'
                      : 'var(--bg-elevated)',
                    cursor: isActive ? 'default' : (isActivating ? 'wait' : 'pointer'),
                    transition: 'all 0.18s ease',
                    position: 'relative',
                  }}
                  className="user-item"
                >
                  {/* Avatar */}
                  <div style={{
                    width: 42, height: 42, borderRadius: '50%',
                    background: isActive
                      ? 'linear-gradient(135deg, var(--accent-primary), #8b5cf6)'
                      : 'var(--bg-surface)',
                    border: isActive ? '2px solid var(--accent-primary)' : '2px solid var(--border-default)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: '1.1rem',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                    flexShrink: 0,
                    boxShadow: isActive ? '0 2px 12px color-mix(in srgb, var(--accent-primary) 40%, transparent)' : 'none',
                    transition: 'all 0.18s',
                  }}>
                    {user.name.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                        {user.name}
                      </span>
                      {isActive && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3,
                          fontSize: '0.7rem', fontWeight: 600,
                          color: 'var(--accent-primary)',
                          background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)',
                          padding: '1px 7px', borderRadius: 99,
                          border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)',
                        }}>
                          <CheckCircle size="0.562rem" style={{ flexShrink: 0 }} />
                          Đang dùng
                        </span>
                      )}
                    </div>
                    {/* Stats badges */}
                    {stats ? (
                      <div style={{ display: 'flex', gap: 10, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <FolderOpen size="0.688rem" style={{ color: '#a78bfa' }} />
                          {stats.project_count} project
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Workflow size="0.688rem" style={{ color: '#2dd4bf' }} />
                          {stats.workflow_count} workflow
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock size="0.688rem" style={{ color: '#f59e0b' }} />
                          {stats.schedule_count} lịch
                        </span>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Đang tải...</div>
                    )}
                  </div>

                  {/* Actions */}
                  {isActivating ? (
                    <Spin size="small" />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      {!isActive && (
                        <LogIn size="0.938rem" style={{ color: 'var(--text-muted)' }} />
                      )}
                      <button
                        onClick={(e) => handleDelete(e, user)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-muted)', padding: '4px', borderRadius: 6,
                          display: 'flex', alignItems: 'center',
                          transition: 'color 0.15s, background 0.15s',
                        }}
                        title="Xóa người dùng"
                        className="user-delete-btn"
                      >
                        <Trash2 size="0.875rem" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Spin>

      {/* Tạo user mới */}
      {showInput ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <Input
            placeholder="Nhập tên người dùng..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onPressEnter={handleCreate}
            autoFocus
            size="middle"
          />
          <Button type="primary" loading={creating} onClick={handleCreate} disabled={!newName.trim()}>
            Tạo
          </Button>
          <Button onClick={() => { setShowInput(false); setNewName('') }}>Hủy</Button>
        </div>
      ) : (
        <Button
          type="dashed"
          block
          icon={<Plus size="0.875rem" />}
          onClick={() => setShowInput(true)}
          style={{ marginTop: 4 }}
        >
          Thêm người dùng mới
        </Button>
      )}

      <style>{`
        .user-item:hover:not([style*="cursor: default"]) {
          border-color: var(--accent-primary) !important;
          background: color-mix(in srgb, var(--accent-primary) 5%, var(--bg-elevated)) !important;
        }
        .user-delete-btn:hover { color: #ef4444 !important; background: #ef444415 !important; }
      `}</style>
    </Modal>
  )
}
