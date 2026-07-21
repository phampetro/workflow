import React, { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import { Table, Tag, Button, Spin, Empty, Card, Space } from 'antd'
import { getRunHistory } from '../api/client'
import { RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_CONFIG = {
  running:   { label: 'Đang chạy', color: 'processing' },
  success:   { label: 'Thành công', color: 'success' },
  scheduled: { label: 'Lên lịch',  color: 'warning' },
  error:     { label: 'Lỗi',       color: 'error' },
  idle:      { label: 'Chờ',       color: 'default' },
  pending:   { label: 'Chờ',       color: 'default' },
}

const WorkflowHistoryPanel = forwardRef(({ workflowId, onViewLog }, ref) => {
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

  useImperativeHandle(ref, () => ({
    loadHistory,
    loading
  }))

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

  const getTriggerLabel = (t) => {
    if (!t || t === 'manual') return <Tag variant="filled" style={{ margin: 0 }}>Thủ công</Tag>
    if (t.startsWith('schedule:')) return <Tag color="warning" variant="filled" style={{ margin: 0 }}>Lịch hẹn</Tag>
    return <Tag variant="filled" style={{ margin: 0 }}>{t}</Tag>
  }

  const columns = [
    {
      title: 'STT',
      key: 'stt',
      width: 50,
      align: 'center',
      render: (_, __, index) => <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{index + 1}</span>
    },
    {
      title: 'Thời gian',
      dataIndex: 'started_at',
      key: 'started_at',
      width: 160,
      render: (t) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{formatDate(t)}</span>
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      align: 'center',
      render: (s) => {
        const c = STATUS_CONFIG[s] || { label: s, color: 'default' }
        return <Tag color={c.color} variant="filled" style={{ margin: 0 }}>{c.label}</Tag>
      }
    },
    {
      title: 'Thời gian chạy',
      dataIndex: 'duration_ms',
      key: 'duration_ms',
      width: 100,
      align: 'center',
      render: (d) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{formatDuration(d)}</span>
    },
    {
      title: 'Kích hoạt bởi',
      dataIndex: 'triggered_by',
      key: 'triggered_by',
      width: 100,
      align: 'center',
      render: getTriggerLabel
    },
    {
      title: 'Thao tác',
      key: 'action',
      align: 'center',
      width: 90,
      render: (_, record) => (
        <Button size="small" type="link" onClick={() => onViewLog?.(record.id)}>
          Xem Log
        </Button>
      )
    }
  ]

  return (
    <Table 
      dataSource={history} 
      columns={columns} 
      rowKey="id" 
      loading={loading}
      pagination={false}
      size="small"
      sticky={{ offsetHeader: 0 }}
      scroll={{ y: 'calc(100vh - 160px)' }}
      locale={{ emptyText: <Empty description="Chưa có lượt chạy nào" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
    />
  )
})

export default WorkflowHistoryPanel
