import React, { useState, useEffect, useRef } from 'react'
import { Terminal, Download } from 'lucide-react'
import { createLogStream } from '../api/client'
import { Drawer, Button, Space, Typography, Tag, Empty } from 'antd'

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

  useEffect(() => {
    if (!runId) return

    const cleanup = createLogStream(
      runId,
      (data) => {
        setLogs((prev) => [...prev, { time: data.time || new Date().toLocaleTimeString(), level: data.level, msg: data.message }])
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
  }, [logs, autoScroll])

  const handleScroll = (e) => {
    const el = e.target
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  const downloadLogs = () => {
    const content = logs.map(l => `[${l.time}] ${l.msg}`).join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `workflow_log_${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Drawer
      title={
        <Space>
          <Terminal size={16} color="var(--accent-secondary)" />
          <span>Output Logs</span>
          {isRunning && (
            <Tag color="processing" icon={<span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor', marginRight: 6, animation: 'pulse 1.5s infinite' }}/>}>
              Live
            </Tag>
          )}
        </Space>
      }
      placement="bottom"
      height={300}
      onClose={onClose}
      open={true}
      mask={false}
      extra={
        <Button size="small" type="text" icon={<Download size={14} />} onClick={downloadLogs}>
          Tải Log
        </Button>
      }
      styles={{ 
        header: { padding: '12px 24px', borderBottom: '1px solid #3c3c3c', background: '#252526', color: '#e5e5e5' }, 
        body: { padding: '12px 24px', background: '#1e1e1e', overflowY: 'auto', fontFamily: 'var(--font-mono)' },
        mask: { background: 'transparent' }
      }}
    >
      <div onScroll={handleScroll} style={{ height: '100%' }}>
        {logs.length === 0 && (
          <Empty 
            image={<Terminal size={32} opacity={0.2} color="#fff" />}
            description={<span style={{ color: '#888' }}>Chờ output...</span>}
            style={{ marginTop: 40 }}
          />
        )}
        {logs.map((log, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, lineHeight: 1.7, fontSize: '0.8rem' }}>
            <span style={{ color: '#888', flexShrink: 0, userSelect: 'none' }}>[{log.time}]</span>
            <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all', ...LEVEL_STYLES[log.level] }}>
              {log.msg}
            </span>
          </div>
        ))}
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
