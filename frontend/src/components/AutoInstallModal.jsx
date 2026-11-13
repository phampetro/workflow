import React, { useState, useEffect, useRef } from 'react'
import { Modal, Button, Input, Tag, Progress, Spin, Empty, Alert } from 'antd'
import { PackagePlus, Plus, Play } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { scanPackages, autoInstallPackages, getInstallStatus } from '../api/client'

/**
 * Modal "Tự động cài thư viện":
 *  scan → review (xem/sửa danh sách) → installing (stream log) → done.
 * Trong lúc cài, chặn đóng modal (đợi cài xong mới cho dùng).
 */
export default function AutoInstallModal({ projectId, open, onClose, onDone }) {
  const { t } = useTranslation()
  const [phase, setPhase] = useState('scan')   // scan | review | installing | done
  const [items, setItems] = useState([])       // [{package, reasons:[{kind, block, workflow}], installed}]
  const [workflowCount, setWorkflowCount] = useState(0)
  // venv chưa có / hỏng → luôn cho bấm cài (kể cả 0 gói) để dựng lại môi trường
  const [venvBroken, setVenvBroken] = useState(false)
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
    setPhase('scan'); setVenvBroken(false); setLog([]); setError(null); setProgress({ done: 0, total: 0 }); setCustom('')
    scanPackages(projectId)
      .then(res => {
        const its = Array.isArray(res.data?.packages) ? res.data.packages : []
        setItems(its)
        setWorkflowCount(res.data?.workflow_count ?? 0)
        setVenvBroken(res.data?.venv_ok === false)
        // Mặc định chỉ chọn cài những gói CÒN THIẾU (chưa có trong venv)
        setSelected(its.filter(i => !i.installed).map(i => i.package))
        setPhase('review')
      })
      .catch(err => { toast.error(t('autoInstall.scanError', { message: err.message })); setPhase('review'); setItems([]); setSelected([]) })
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [open, projectId])

  useEffect(() => { logEndRef.current?.scrollIntoView({ block: 'end' }) }, [log])

  const removePkg = (p) => setSelected(prev => prev.filter(x => x !== p))

  // Lý do backend trả dạng có cấu trúc → dịch tại FE (khối nào, của workflow nào cần gói này)
  const reasonText = (p) => {
    const reasons = items.find(i => i.package === p)?.reasons
    if (!Array.isArray(reasons) || reasons.length === 0) return t('autoInstall.customAddedReason')
    return reasons
      .map(r => typeof r === 'string' ? r : t(`autoInstall.reason_${r.kind}`, { block: r.block, workflow: r.workflow }))
      .join(' · ')
  }
  const addCustom = () => {
    const v = custom.trim()
    if (v && !selected.includes(v)) setSelected(prev => [...prev, v])
    setCustom('')
  }

  const startInstall = async () => {
    if (selected.length === 0 && !venvBroken) { toast.error(t('autoInstall.noPackagesToInstall')); return }
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
            if (s.status === 'done') { toast.success(t('autoInstall.installSuccess')); onDone?.() }
          }
        } catch { /* mạng lỗi tạm */ }
      }, 800)
    } catch (err) {
      toast.error(t('autoInstall.startInstallError', { message: err.message }))
      setPhase('review')
    }
  }

  const installing = phase === 'installing'
  const pct = progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : (phase === 'done' && !error ? 100 : 0)   // chỉ tạo lại venv (0 gói)
  const canInstall = selected.length > 0 || venvBroken

  return (
    <Modal
      open={open}
      title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PackagePlus size={18} color="var(--accent-primary)" /> {t('autoInstall.title')}</span>}
      onCancel={installing ? undefined : onClose}
      mask={{ closable: !installing }}
      closable={!installing}
      keyboard={!installing}
      width={620}
      footer={
        phase === 'review' ? (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="primary" icon={<Play size={15} />} onClick={startInstall} disabled={!canInstall}>
              {selected.length === 0 ? t('autoInstall.rebuildVenvBtn') : t('autoInstall.installBtn', { count: selected.length })}
            </Button>
          </>
        ) : phase === 'done' ? (
          <Button type="primary" onClick={onClose}>{t('common.close')}</Button>
        ) : null
      }
    >
      {phase === 'scan' && (
        <div style={{ textAlign: 'center', padding: '2rem 0' }}>
          <Spin /> <div style={{ marginTop: 12, color: 'var(--text-secondary)' }}>{t('autoInstall.scanningText')}</div>
        </div>
      )}

      {phase === 'review' && (() => {
        const installedItems = items.filter(i => i.installed)
        return (
          <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
              <b>{t('autoInstall.scannedSummary', { count: workflowCount })}</b>{' '}
              {t('autoInstall.reviewDescPrefix')} <b>Python</b> {t('autoInstall.reviewDescSuffix')} <code>import</code> {t('autoInstall.reviewDescEnd')}
            </p>

            {venvBroken && (
              <Alert type="warning" showIcon title={t('autoInstall.venvBrokenAlert')} style={{ marginBottom: 12 }} />
            )}

            {selected.length === 0 ? (
              venvBroken ? null : installedItems.length > 0
                ? <Alert type="success" showIcon title={t('autoInstall.allInstalledAlert')} style={{ marginBottom: 12 }} />
                : <Empty description={t('autoInstall.noPackagesFound')} />
            ) : (
              <>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                  {t('autoInstall.needToInstallLabel', { count: selected.length })}
                </div>
                {/* Lý do hiện NGAY dưới từng gói (không giấu trong tooltip — không dựa vào hover) */}
                <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                  {selected.map(p => (
                    <li key={p} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <Tag color="orange" closable onClose={(e) => { e.preventDefault(); removePkg(p) }}
                        closeIcon={<span aria-label={t('autoInstall.removePkgAria', { name: p })}>×</span>}
                        style={{ padding: '2px 8px', fontSize: '0.8rem', flexShrink: 0, marginInlineEnd: 0 }}>
                        {p}
                      </Tag>
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{reasonText(p)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {installedItems.length > 0 && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
                {t('autoInstall.alreadyInstalledLabel', { count: installedItems.length, list: installedItems.map(i => i.package).join(', ') })}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                placeholder={t('autoInstall.addManualPlaceholder')}
                value={custom}
                onChange={e => setCustom(e.target.value)}
                onPressEnter={addCustom}
                size="small"
              />
              <Button icon={<Plus size={14} />} onClick={addCustom} size="small">{t('autoInstall.addBtn')}</Button>
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
              {error ? `⚠ ${error}` : t('autoInstall.doneSuccess')}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
