import React, { useState, useEffect, useRef } from 'react'
import { Modal, Button, Input, Tag, Progress, Spin, Empty, Tooltip, Alert } from 'antd'
import { PackagePlus, Plus, X, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import { scanPackages, autoInstallPackages, getInstallStatus } from '../api/client'

/**
 * Modal "Tự động cài thư viện":
 *  scan → review (xem/sửa danh sách) → installing (stream log) → done.
 * Trong lúc cài, chặn đóng modal (đợi cài xong mới cho dùng).
 */
export default function AutoInstallModal({ projectId, open, onClose, onDone }) {
  const [phase, setPhase] = useState('scan')   // scan | review | installing | done
  const [items, setItems] = useState([])       // [{package, reasons}]
  const [selected, setSelected] = useState([]) // [package string]
  const [custom, setCustom] = useState('')
  const [log, setLog] = useState([])
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [error, setError] = useState(null)
  const pollRef = useRef(null)
  const logEndRef = useRef(null)

  // Mở modal → quét
  useEffect(() => {
    if (!open) return
    setPhase('scan'); setLog([]); setError(null); setProgress({ done: 0, total: 0 }); setCustom('')
    scanPackages(projectId)
      .then(res => {
        const its = res.data?.packages || []
        setItems(its)
        // Mặc định chỉ chọn cài những gói CÒN THIẾU (chưa có trong venv)
        setSelected(its.filter(i => !i.installed).map(i => i.package))
        setPhase('review')
      })
      .catch(err => { toast.error('Lỗi quét: ' + err.message); setPhase('review'); setItems([]); setSelected([]) })
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [open, projectId])

  useEffect(() => { logEndRef.current?.scrollIntoView({ block: 'end' }) }, [log])

  const removePkg = (p) => setSelected(prev => prev.filter(x => x !== p))
  const addCustom = () => {
    const v = custom.trim()
    if (v && !selected.includes(v)) setSelected(prev => [...prev, v])
    setCustom('')
  }

  const startInstall = async () => {
    if (selected.length === 0) { toast.error('Chưa có package nào để cài'); return }
    setPhase('installing'); setLog([]); setError(null); setProgress({ done: 0, total: selected.length })
    try {
      await autoInstallPackages(projectId, selected)
      pollRef.current = setInterval(async () => {
        try {
          const res = await getInstallStatus(projectId)
          const s = res.data
          setLog(s.log || [])
          setProgress({ done: s.done || 0, total: s.total || selected.length })
          if (s.status === 'done' || s.status === 'error') {
            clearInterval(pollRef.current); pollRef.current = null
            setError(s.error || null)
            setPhase('done')
            if (s.status === 'done') { toast.success('Cài thư viện xong!'); onDone?.() }
          }
        } catch { /* mạng lỗi tạm */ }
      }, 800)
    } catch (err) {
      toast.error('Lỗi bắt đầu cài: ' + err.message)
      setPhase('review')
    }
  }

  const installing = phase === 'installing'
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Modal
      open={open}
      title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PackagePlus size={18} color="var(--accent-primary)" /> Tự động cài thư viện</span>}
      onCancel={installing ? undefined : onClose}
      mask={{ closable: !installing }}
      closable={!installing}
      keyboard={!installing}
      width={620}
      footer={
        phase === 'review' ? (
          <>
            <Button onClick={onClose}>Hủy</Button>
            <Button type="primary" icon={<Play size={15} />} onClick={startInstall} disabled={selected.length === 0}>
              Cài {selected.length} thư viện
            </Button>
          </>
        ) : phase === 'done' ? (
          <Button type="primary" onClick={onClose}>Đóng</Button>
        ) : null
      }
    >
      {phase === 'scan' && (
        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
          <Spin /> <div style={{ marginTop: 12, color: 'var(--text-secondary)' }}>Đang quét workflow để tìm thư viện cần thiết…</div>
        </div>
      )}

      {phase === 'review' && (() => {
        const installedItems = items.filter(i => i.installed)
        return (
          <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
              Đã quét mọi workflow của project (lọc trùng, chỉ chọn gói còn thiếu). Thư viện từ khối <b>Python</b> là dự đoán từ <code>import</code> — bạn có thể bớt/thêm trước khi cài.
            </p>

            {selected.length === 0 ? (
              installedItems.length > 0
                ? <Alert type="success" showIcon message="Tất cả thư viện cần thiết đã được cài đủ." style={{ marginBottom: 12 }} />
                : <Empty description="Không phát hiện thư viện nào cần cài" />
            ) : (
              <>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  Cần cài ({selected.length}):
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {selected.map(p => {
                    const reason = items.find(i => i.package === p)?.reasons?.join('; ') || 'Bạn tự thêm'
                    return (
                      <Tooltip key={p} title={reason}>
                        <Tag color="orange" closable onClose={(e) => { e.preventDefault(); removePkg(p) }} style={{ padding: '4px 8px', fontSize: '0.8rem' }}>
                          {p}
                        </Tag>
                      </Tooltip>
                    )
                  })}
                </div>
              </>
            )}

            {installedItems.length > 0 && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
                ✓ Đã có sẵn trong môi trường ({installedItems.length}): {installedItems.map(i => i.package).join(', ')}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                placeholder="Thêm thư viện thủ công (vd: requests)"
                value={custom}
                onChange={e => setCustom(e.target.value)}
                onPressEnter={addCustom}
                size="small"
              />
              <Button icon={<Plus size={14} />} onClick={addCustom} size="small">Thêm</Button>
            </div>
          </div>
        )
      })()}

      {(installing || phase === 'done') && (
        <div>
          <Progress percent={pct} status={error ? 'exception' : (phase === 'done' ? 'success' : 'active')}
            format={() => `${progress.done}/${progress.total}`} />
          <div style={{
            marginTop: 12, background: 'var(--bg-base)', border: '1px solid var(--border-default)',
            borderRadius: 8, padding: 10, height: 260, overflowY: 'auto',
            fontFamily: 'var(--font-mono, monospace)', fontSize: '0.75rem', lineHeight: 1.5,
            color: 'var(--text-secondary)', whiteSpace: 'pre-wrap',
          }}>
            {log.map((l, i) => <div key={i}>{l}</div>)}
            <div ref={logEndRef} />
          </div>
          {phase === 'done' && (
            <div style={{ marginTop: 10, fontWeight: 600, color: error ? 'var(--accent-danger)' : 'var(--accent-success)' }}>
              {error ? `⚠ ${error}` : '🎉 Hoàn tất — môi trường đã sẵn sàng.'}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
