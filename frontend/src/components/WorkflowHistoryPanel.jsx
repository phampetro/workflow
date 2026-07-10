import React, { useState, useEffect } from 'react'
import { Table, Tag, Button, Spin, Empty } from 'antd'
import { getRunHistory } from '../api/client'
import { Clock, RefreshCw, CheckCircle, XCircle, Loader } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_CONFIG = {
  running:   { label: 'Đang chạy', color: 'processing', icon: <Loader size={12} className="spinning" /> },
  success:   { label: 'Thành công', color: 'success', icon: <CheckCircle size={12} /> },
  scheduled: { label: 'Lên lịch',  color: 'warning' },
  error:     { label: 'Lỗi',       color: 'error', icon: <XCircle size={12} /> },
  idle:      { label: 'Chờ',       color: 'default' },
  pending:   { label: 'Chờ',       color: 'default' },
}

export default function WorkflowHistoryPanel({ workflowId }) {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)

  const loadHistory = async () => {
    if (!workflowId) return
    setLoading(true)
    try {
      const res = await getRunHistory(workflowId, 50)
      setHistory(res.data)
    } catch (e) {
      toast.error('Lỗi tải lịch sử: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [workflowId])

  const formatDate = (iso) => {
    if (!iso) return '-'
    try {
      const d = new Date(iso)
      const time = d.toLocaleTimeString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const date = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      return `${time} ${date}`
    } catch { return iso }
  }

  const formatDuration = (ms) => {
    if (ms == null) return '-'
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms/1000).toFixed(1)}s`
  }

  const columns = [
    {
      title: 'Thời gian',
      dataIndex: 'started_at',
      key: 'started_at',
      render: (t) => <span style={{ fontSize: '0.85rem' }}>{formatDate(t)}</span>
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      render: (s) => {
        const c = STATUS_CONFIG[s] || { label: s, color: 'default' }
        return (
          <Tag color={c.color} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {c.icon} {c.label}
          </Tag>
        )
      }
    },
    {
      title: 'Thời gian chạy',
      dataIndex: 'duration_ms',
      key: 'duration_ms',
      render: (d) => <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatDuration(d)}</span>
    },
    {
      title: 'Kích hoạt bởi',
      dataIndex: 'triggered_by',
      key: 'triggered_by',
      render: (t) => {
        if (!t || t === 'manual') return <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Thủ công</span>
        if (t.startsWith('schedule:')) return <span style={{ fontSize: '0.8rem', color: 'var(--accent-warning)' }}>Lịch hẹn</span>
        return <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t}</span>
      }
    }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="section-header">
        <h3 className="section-title">Lịch sử chạy gần đây</h3>
        <Button icon={<RefreshCw size={14} />} onClick={loadHistory} size="small" loading={loading}>
          Làm mới
        </Button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <Table 
          dataSource={history} 
          columns={columns} 
          rowKey="id" 
          loading={loading}
          pagination={false}
          size="small"
          locale={{ emptyText: <Empty description="Chưa có lượt chạy nào" /> }}
        />
      </div>
      <style>{`
        .spinning { animation: spin 1s linear infinite; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
