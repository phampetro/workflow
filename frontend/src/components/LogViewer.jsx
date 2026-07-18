import React, { useState, useEffect, useRef } from 'react'
import { Terminal, Download } from 'lucide-react'
import { createLogStream } from '../api/client'
import { Drawer, Button, Typography, Tag, Empty, Space } from 'antd'
import useStore from '../store/useStore'

const { Text } = Typography

const LEVEL_CONFIG = {
  info:    { color: '#a1a1aa', bg: 'transparent' },
  success: { color: '#4ade80', bg: 'rgba(74,222,128,0.1)' },
  warning: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
  error:   { color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
}

export default function LogViewer({ runId, isRunning, onClose, onFinished }) {
  const [logs, setLogs] = useState([])
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef(null)
  const logContainerRef = useRef(null)

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

        if (data.message && (
          data.message.includes('✅ Workflow hoàn thành') ||
          data.message.includes('❌ Workflow thất bại') ||
          data.message.includes('❌ Lỗi hệ thống khi chạy workflow') ||
          data.message.includes('⏹ Đã dừng')
        )) {
          if (onFinished) onFinished()
        }
      },
      (err) => { console.error('SSE Error:', err) },
      cached.length
    )

    return () => cleanup()
  }, [runId])

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
        <Space>
          <Terminal size={16} color="var(--accent-primary)" />
          <span style={{ fontWeight: 600 }}>Tiến trình chạy</span>
          {runId && (
            <Tag bordered={false} style={{ margin: 0, fontFamily: 'var(--font-mono)', background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
              #{runId}
            </Tag>
          )}
          {isRunning && (
            <Tag color="processing" style={{ margin: 0 }}>Đang chạy</Tag>
          )}
        </Space>
      }
      placement="bottom"
      height="42vh"
      onClose={onClose}
      open={true}
      mask={false}
      styles={{
        body: { padding: 0, background: '#0d1117', display: 'flex', flexDirection: 'column' },
        header: { background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', padding: '12px 20px' }
      }}
      extra={
        <Button
          icon={<Download size={14} />}
          size="small"
          onClick={exportLogs}
          disabled={!logs.length}
        >
          Lưu Log
        </Button>
      }
    >
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: '13px', lineHeight: 1.7 }}
      >
        {logs.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: '#888' }}>Chưa có log nào...</span>}
            style={{ margin: '40px 0' }}
          />
        ) : (
          logs.map((log, i) => {
            const cfg = LEVEL_CONFIG[log.level] || LEVEL_CONFIG.info
            return (
              <div key={i} style={{ display: 'flex', gap: 12, lineHeight: 1.7, fontSize: '0.8rem' }}>
                <span style={{ color: '#666', flexShrink: 0, userSelect: 'none' }}>[{log.time}]</span>
                <Tag
                  style={{
                    margin: 0,
                    padding: '0 4px',
                    fontSize: '10px',
                    background: cfg.bg,
                    color: cfg.color,
                    border: 'none',
                    flexShrink: 0
                  }}
                >
                  {log.level?.toUpperCase()}
                </Tag>
                <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: cfg.color }}>
                  {log.msg}
                </span>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>
    </Drawer>
  )
}
