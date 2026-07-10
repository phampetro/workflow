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
  const storeLogs = useStore(s => s.runLogs[runId] || [])
  const appendLog = useStore(s => s.appendLog)
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef(null)
  const logContainerRef = useRef(null)

  useEffect(() => {
    if (!runId) return

    const cleanup = createLogStream(
      runId,
      (data) => {
        appendLog(runId, { time: data.time || new Date().toLocaleTimeString(), level: data.level, msg: data.message })
        if (data.message && (data.message.includes('✅ Workflow hoàn thành') || data.message.includes('❌ Workflow thất bại') || data.message.includes('⏹ Đã dừng'))) {
          if (onFinished) onFinished()
        }
      },
      (err) => {
        console.error('SSE Error:', err)
        if (onFinished) onFinished()
      }
    )

    return () => cleanup()
  }, [runId])

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [storeLogs, autoScroll])

  const handleScroll = (e) => {
    const el = e.target
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  const exportLogs = () => {
    const content = storeLogs.map(l => `[${l.time}] [${l.level.toUpperCase()}] ${l.msg}`).join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `run_${runId}_logs.txt`
    a.click()
  }

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <Space>
            <Terminal size="1.125rem" color="var(--accent-primary)" /> 
            <span>Tiến trình chạy {runId && <Text type="secondary" style={{ fontSize: '0.8rem', marginLeft: 4 }}>#{runId.substring(0,6)}</Text>}</span>
          </Space>
          <div style={{ display: 'flex', gap: 8, marginRight: 24 }}>
            {isRunning && (
              <Tag color="processing" style={{ borderRadius: 12, border: 'none', background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)', color: 'var(--accent-primary)', fontWeight: 500 }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--accent-primary)', marginRight: 6, animation: 'pulse 1.5s infinite' }} />
                Đang chạy
              </Tag>
            )}
            <Button size="small" type="text" icon={<Download size="1rem" />} onClick={exportLogs} disabled={!storeLogs.length} style={{ color: 'var(--text-secondary)' }}>
              Lưu Log
            </Button>
          </div>
        </div>
      }
      placement="bottom"
      height="45vh"
      onClose={onClose}
      open={true}
      mask={false}
      styles={{ 
        body: { padding: 0, background: '#1e1e1e', display: 'flex', flexDirection: 'column' },
        header: { background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', padding: '12px 20px' }
      }}
    >
      <div 
        ref={logContainerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: '13px', lineHeight: 1.6 }}
      >
        {storeLogs.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span style={{ color: '#888' }}>Chưa có log nào...</span>} style={{ margin: '40px 0' }} />
        ) : (
          storeLogs.map((log, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, lineHeight: 1.7, fontSize: '0.8rem' }}>
              <span style={{ color: '#888', flexShrink: 0, userSelect: 'none' }}>[{log.time}]</span>
              <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all', ...LEVEL_STYLES[log.level] }}>
                {log.msg}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
    </Drawer>
  )
}
