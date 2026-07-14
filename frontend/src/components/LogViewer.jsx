import React, { useState, useEffect, useRef } from 'react'
import { Terminal, Download } from 'lucide-react'
import { createLogStream } from '../api/client'
import { Drawer, Button, Space, Typography, Tag, Empty } from 'antd'
import useStore from '../store/useStore'

const { Text } = Typography

const LEVEL_STYLES = {
  info:    { color: '#e5e5e5' },
  success: { color: '#4ade80' },
  warning: { color: '#fbbf24' },
  error:   { color: '#ff5f57' },
}

export default function LogViewer({ runId, isRunning, onClose, onFinished }) {
  const [logs, setLogs] = useState([])
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef(null)
  const logContainerRef = useRef(null)

  // Reset logs khi runId thay đổi
  useEffect(() => {
    if (!runId) {
      setLogs([])
      return
    }

    // Bước 1: Hiển thị log đã có trong bộ nhớ Zustand (nếu có)
    // Bộ nhớ này chỉ tồn tại trong phiên trình duyệt hiện tại (không persist)
    const cached = useStore.getState().runLogs[runId] || []
    setLogs([...cached])

    // Bước 2: Kết nối SSE chỉ lấy phần mới chưa có trong cache
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

        if (data.message && (
          data.message.includes('✅ Workflow hoàn thành') ||
          data.message.includes('❌ Workflow thất bại') ||
          data.message.includes('⏹ Đã dừng')
        )) {
          if (onFinished) onFinished()
        }
      },
      (err) => { console.error('SSE Error:', err) },
      cached.length  // offset: chỉ lấy những dòng backend có nhưng Zustand chưa có
    )

    return () => cleanup()
  }, [runId])

  // Auto scroll xuống cuối khi có log mới
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs.length, autoScroll])

  const handleScroll = (e) => {
    const el = e.target
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minHeight: 32 }}>
          {/* Left: title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Terminal size={16} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
              Tiến trình chạy
            </span>
            {runId && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', background: 'var(--bg-base)', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--border-default)' }}>
                #{runId}
              </span>
            )}
          </div>

          {/* Right: status + actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 24 }}>
            {isRunning && (
              <div className="status-pill running">
                <span className="pulse-dot" />
                Đang chạy
              </div>
            )}
            <button
              onClick={exportLogs}
              disabled={!logs.length}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 10px', borderRadius: 6, cursor: logs.length ? 'pointer' : 'not-allowed',
                background: 'transparent', border: '1px solid var(--border-default)',
                color: logs.length ? 'var(--text-secondary)' : 'var(--text-muted)',
                fontSize: '0.78rem', fontWeight: 500, lineHeight: 1,
                transition: 'all 0.15s',
                opacity: logs.length ? 1 : 0.4,
              }}
            >
              <Download size={13} />
              Lưu Log
            </button>
          </div>
        </div>
      }
      placement="bottom"
      height="42vh"
      onClose={onClose}
      open={true}
      mask={false}
      styles={{
        body: { padding: 0, background: '#0d1117', display: 'flex', flexDirection: 'column' },
        header: {
          background: 'var(--bg-elevated)',
          borderBottom: '1px solid var(--border-default)',
          padding: '10px 20px',
        }
      }}
    >
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: '13px', lineHeight: 1.6 }}
      >
        {logs.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: '#888' }}>Chưa có log nào...</span>}
            style={{ margin: '40px 0' }}
          />
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, lineHeight: 1.7, fontSize: '0.8rem' }}>
              <span style={{ color: '#888', flexShrink: 0, userSelect: 'none' }}>[{log.time}]</span>
              <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all', ...(LEVEL_STYLES[log.level] || LEVEL_STYLES.info) }}>
                {log.msg}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </Drawer>
  )
}
