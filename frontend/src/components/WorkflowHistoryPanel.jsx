import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { Table, Tag, Button, Empty } from 'antd'
import { getRunHistory } from '../api/client'
import {  } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

const getStatusConfig = (t) => ({
  running:   { label: t('workflowHistoryPanel.statusRunning'), color: 'processing' },
  success:   { label: t('workflowHistoryPanel.statusSuccess'), color: 'success' },
  scheduled: { label: t('workflowHistoryPanel.statusScheduled'), color: 'warning' },
  error:     { label: t('workflowHistoryPanel.statusError'), color: 'error' },
  idle:      { label: t('workflowHistoryPanel.statusIdle'), color: 'default' },
  pending:   { label: t('workflowHistoryPanel.statusIdle'), color: 'default' },
})

const WorkflowHistoryPanel = forwardRef(({ workflowId, onViewLog }, ref) => {
  const { t, i18n } = useTranslation()
  const STATUS_CONFIG = getStatusConfig(t)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)

  // Tăng mỗi lần đổi workflow / gọi lại. Response về sau khi giá trị này đã đổi
  // là response CŨ → bỏ qua. Không có nó thì đổi workflow nhanh (A → B) mà
  // response của A về sau response của B sẽ hiển thị LỊCH SỬ CỦA A dưới tiêu đề
  // của B, và setState còn chạy sau khi Drawer đã đóng.
  const reqIdRef = useRef(0)

  const loadHistory = async () => {
    if (!workflowId) return
    const myReq = ++reqIdRef.current
    setLoading(true)
    try {
      const res = await getRunHistory(workflowId, 50)
      if (myReq !== reqIdRef.current) return      // đã có request mới hơn
      setHistory(res.data)
    } catch (e) {
      if (myReq === reqIdRef.current) toast.error(t('workflowHistoryPanel.loadError', { message: e.message }))
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
    // Huỷ hiệu lực request đang bay khi đổi workflow hoặc unmount
    return () => { reqIdRef.current++ }
  }, [workflowId])

  useImperativeHandle(ref, () => ({
    loadHistory,
    loading
  }))

  const dateLocale = i18n.language === 'en' ? 'en-US' : 'vi-VN'
  const formatDate = (iso) => {
    if (!iso) return '-'
    try {
      const d = new Date(iso)
      const time = d.toLocaleTimeString(dateLocale, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const date = d.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit', year: 'numeric' })
      return `${time} ${date}`
    } catch { return iso }
  }

  const formatDuration = (ms) => {
    if (ms == null) return '-'
    if (ms < 1000) return `${Math.round(ms)}ms`
    return `${(ms/1000).toFixed(1)}s`
  }

  const getTriggerLabel = (trig) => {
    if (!trig || trig === 'manual') return <Tag variant="filled" style={{ margin: 0 }}>{t('workflowHistoryPanel.triggerManual')}</Tag>
    if (trig.startsWith('schedule:')) return <Tag color="warning" variant="filled" style={{ margin: 0 }}>{t('workflowHistoryPanel.triggerSchedule')}</Tag>
    return <Tag variant="filled" style={{ margin: 0 }}>{trig}</Tag>
  }

  const columns = [
    {
      title: t('workflowHistoryPanel.colIndex'),
      key: 'stt',
      width: 50,
      align: 'center',
      render: (_, __, index) => <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{index + 1}</span>
    },
    {
      title: t('workflowHistoryPanel.colTime'),
      dataIndex: 'started_at',
      key: 'started_at',
      width: 160,
      render: (val) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{formatDate(val)}</span>
    },
    {
      title: t('workflowHistoryPanel.colStatus'),
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
      title: t('workflowHistoryPanel.colDuration'),
      dataIndex: 'duration_ms',
      key: 'duration_ms',
      width: 100,
      align: 'center',
      render: (d) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{formatDuration(d)}</span>
    },
    {
      title: t('workflowHistoryPanel.colTrigger'),
      dataIndex: 'triggered_by',
      key: 'triggered_by',
      width: 100,
      align: 'center',
      render: getTriggerLabel
    },
    {
      title: t('workflowHistoryPanel.colAction'),
      key: 'action',
      align: 'center',
      width: 90,
      render: (_, record) => (
        <Button size="small" type="link" onClick={() => onViewLog?.(record.id)}>
          {t('workflowHistoryPanel.viewLog')}
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
      locale={{ emptyText: <Empty description={t('workflowHistoryPanel.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
    />
  )
})

export default WorkflowHistoryPanel
