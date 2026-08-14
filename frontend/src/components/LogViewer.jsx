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

// Zustand v5 so sánh snapshot bằng Object.is. Selector TUYỆT ĐỐI không được tạo
// reference mới mỗi lần gọi (VD `|| []`, `.map()`, `.filter()`): getSnapshot sẽ không
// bao giờ ổn định → React 19 re-render vô hạn → "Maximum update depth exceeded" (crash
// trắng/đen cả app). Dùng 1 hằng số rỗng dùng chung để giữ reference bất biến.
const EMPTY_LOGS = []

// Giờ không xác định được — hiện dấu gạch thay vì BỊA một giờ.
export const LOG_TIME_UNKNOWN = '--:--:--'

/**
 * Định dạng giờ của 1 dòng log từ field `time` (ISO kèm timezone) do backend gửi.
 *
 * TUYỆT ĐỐI không fallback về `new Date()`: đó chính là bug cũ. Backend từng chỉ
 * gửi `timestamp` (đồng hồ monotonic) nên `data.time` luôn undefined và mọi dòng
 * lấy giờ của trình duyệt lúc NHẬN. Khi mở log 1 run đã xong, SSE replay cả lịch
 * sử trong vài chục ms → mọi dòng mang cùng 1 giờ = lúc mở view.
 *
 * Log của các run CŨ không có field `time` (không thể khôi phục giờ thật) →
 * trả về LOG_TIME_UNKNOWN.
 */
export function formatLogTime(raw) {
  if (!raw) return LOG_TIME_UNKNOWN
  // Chỉ nhận CHUỖI ISO. Nếu lỡ nhận số (VD ai đó truyền `timestamp` monotonic
  // vào đây), `new Date(46512.34)` sẽ hiểu là epoch-ms và cho ra "08:00:46" —
  // một giờ bịa hoàn toàn. Thà hiện gạch còn hơn hiện số sai.
  if (typeof raw !== 'string') return LOG_TIME_UNKNOWN
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return LOG_TIME_UNKNOWN
  return d.toLocaleTimeString()
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

export default function LogViewer({ runId, isRunning, streamedRunId, onClose, onFinished }) {
  const logs = useStore(state => state.runLogs[runId] || EMPTY_LOGS)
  const [autoScroll, setAutoScroll] = useState(true)
  const virtuosoRef = useRef(null)

  useEffect(() => {
    if (!runId) return

    // WorkflowEditor chỉ mở stream cho ĐÚNG run nó đang bám (streamedRunId) và ghi
    // vào useStore — component này chỉ cần re-render nhờ useStore(runLogs[runId]).
    // Điều kiện cũ là `if (isRunning) return`: chỉ cần workflow có run nào đó đang
    // chạy là bỏ luôn việc mở stream, kể cả khi đang xem một run KHÁC. Workflow có
    // khối "Lệnh Telegram" chạy nhiều run song song (1 run thường trú giữ Listener +
    // mỗi lệnh runall/runscript/ngayupdate là 1 run riêng), nên mở log của run do
    // Telegram kích hoạt luôn ra "Chưa có log nào..." dù DB có đủ log.
    if (runId === streamedRunId) return

    // Mọi run khác (run cũ trong Lịch sử, hoặc run song song do Telegram kích hoạt)
    // tự mở stream riêng: backend trả toàn bộ lịch sử theo offset rồi stream tiếp,
    // nên vừa xem lại được log đã lưu vừa theo dõi realtime nếu run còn chạy.
    const cached = useStore.getState().runLogs[runId] || []
    const cleanup = createLogStream(
      runId,
      (data) => {
        const entry = {
          time: formatLogTime(data.time),
          level: data.level || 'info',
          msg: data.message || ''
        }
        useStore.getState().appendLog(runId, entry)
      },
      (err) => { console.error('SSE Error:', err) },
      cached.length
    )

    return () => cleanup()
  }, [runId, streamedRunId])

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
              #{runId.split('-')[0]}
            </Tag>
          )}
          {isRunning && (
            <Tag color="processing" style={{ margin: 0 }}>Đang chạy</Tag>
          )}
        </Space>
      }
      placement="bottom"
      size={350}
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
