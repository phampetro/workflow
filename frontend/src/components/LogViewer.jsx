import React, { useState, useEffect, useRef } from 'react'
import { Terminal, Download, ArrowDown } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { createLogStream } from '../api/client'
import { Drawer, Button, Typography, Tag, Empty, Space } from 'antd'
import useStore from '../store/useStore'

const { Text } = Typography

// Bảng màu tham chiếu CSS variables trong index.css (--log-*). Mỗi variable đã có
// biến thể riêng cho light/dark - khi user đổi theme, log tự cập nhật màu, không cần
// đọc theme trong JS. Đảm bảo tương phản 4.5:1 trên cả 2 nền.
const LEVEL_CONFIG = {
  info:    { color: 'var(--log-info)',    bg: 'var(--log-info-bg)' },
  success: { color: 'var(--log-success)', bg: 'var(--log-success-bg)' },
  warning: { color: 'var(--log-warning)', bg: 'var(--log-warning-bg)' },
  error:   { color: 'var(--log-error)',   bg: 'var(--log-error-bg)' },
}

function LogRow({ log }) {
  const cfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info
  return (
    <div style={{ display: 'flex', gap: 12, lineHeight: 1.7, fontSize: '0.8rem', padding: '0 16px' }}>
      <span style={{ color: 'var(--log-timestamp)', flexShrink: 0, userSelect: 'none' }}>[{log.time}]</span>
      <Tag
        style={{
          margin: 0,
          padding: '0 4px',
          fontSize: '10px',
          background: cfg.bg,
          color: cfg.color,
          border: 'none',
          flexShrink: 0,
        }}
      >
        {log.level?.toUpperCase()}
      </Tag>
      <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: cfg.color }}>
        {log.msg}
      </span>
    </div>
  )
}

export default function LogViewer({ runId, isRunning, onClose, onFinished }) {
  const [logs, setLogs] = useState([])
  const [autoScroll, setAutoScroll] = useState(true)
  const virtuosoRef = useRef(null)

  useEffect(() => {
    if (!runId) {
      setLogs([])
      return
    }

    const cached = useStore.getState().runLogs[runId] || []
    setLogs([...cached])

    const cleanup = createLogStream(
      runId,
      (data) => {
        const entry = {
          time: data.time || new Date().toLocaleTimeString(),
          level: data.level || 'info',
          msg: data.message || ''
        }
        setLogs(prev => [...prev, entry])
        useStore.getState().appendLog(runId, entry)

        // Các chuỗi này phải khớp CHÍNH XÁC log BE phát ở cuối execute_workflow_thread
        // (services/executor_blocks.py cuối file). Trước đây match "✅ Hoàn thành workflow"
        // không khớp bất cứ log nào -> onFinished không được gọi ở case success.
        if (data.message && (
          data.message.includes('✅ Workflow hoàn thành') ||
          data.message.includes('❌ Lỗi hệ thống khi chạy workflow') ||
          data.message.includes('⏹ Đã dừng')
        )) {
          if (onFinished) onFinished(runId)
        }
      },
      (err) => { console.error('SSE Error:', err) },
      cached.length
    )

    return () => cleanup()
  }, [runId])

  const jumpToBottom = () => {
    setAutoScroll(true)
    if (virtuosoRef.current && logs.length > 0) {
      virtuosoRef.current.scrollToIndex({ index: logs.length - 1, behavior: 'auto' })
    }
  }

  const exportLogs = () => {
    const content = logs.map(l => `[${l.time}] [${(l.level || 'info').toUpperCase()}] ${l.msg}`).join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `run_${runId}_logs.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Drawer
      title={
        <Space>
          <Terminal size={16} color="var(--accent-primary)" />
          <span style={{ fontWeight: 600 }}>Tiến trình chạy</span>
          {runId && (
            <Tag variant="filled" style={{ margin: 0, fontFamily: 'var(--font-mono)', background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
              #{runId}
            </Tag>
          )}
          {isRunning && (
            <Tag color="processing" style={{ margin: 0 }}>Đang chạy</Tag>
          )}
        </Space>
      }
      placement="bottom"
      size="42vh"
      onClose={onClose}
      open={true}
      mask={false}
      styles={{
        body: { padding: 0, background: 'var(--log-bg)', display: 'flex', flexDirection: 'column' },
        header: { background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', padding: '12px 20px' }
      }}
      extra={
        <Button
          icon={<Download size={14} />}
          size="small"
          onClick={exportLogs}
          disabled={!logs.length}
          aria-label="Lưu log ra file"
        >
          Lưu Log
        </Button>
      }
    >
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {logs.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: 'var(--log-empty)' }}>Chưa có log nào...</span>}
            style={{ margin: '40px 0' }}
          />
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={logs}
            itemContent={(index, log) => <LogRow log={log} />}
            style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '13px' }}
            // Bám đáy khi có log mới nhưng chỉ khi user chưa cuộn lên xem log cũ -
            // Virtuoso tự xử lý atBottom via callback, thay được toàn bộ hack
            // programmaticScroll/threshold cũ.
            followOutput={autoScroll ? 'auto' : false}
            atBottomStateChange={(atBottom) => setAutoScroll(atBottom)}
            atBottomThreshold={80}
            increaseViewportBy={{ top: 200, bottom: 200 }}
            initialTopMostItemIndex={Math.max(0, logs.length - 1)}
          />
        )}

        {/* Nút nổi hiện khi user rời khỏi đáy (đang xem log cũ) - click về đáy + bật lại auto-scroll */}
        {!autoScroll && logs.length > 0 && (
          <Button
            type="primary"
            size="small"
            icon={<ArrowDown size={14} />}
            onClick={jumpToBottom}
            aria-label="Cuộn xuống xem log mới nhất"
            style={{
              position: 'absolute',
              bottom: 16,
              left: '50%',
              transform: 'translateX(-50%)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
              zIndex: 10,
            }}
          >
            Xem log mới nhất
          </Button>
        )}
      </div>
    </Drawer>
  )
}
