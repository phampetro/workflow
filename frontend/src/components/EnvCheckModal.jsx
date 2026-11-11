import React, { useState, useEffect, useCallback } from 'react'
import { Modal, Button, Spin, Alert, Typography } from 'antd'
import { Stethoscope, CheckCircle2, AlertTriangle, XCircle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { systemApi } from '../api/client'

const { Text } = Typography

// Mỗi trạng thái có ICON + NHÃN CHỮ riêng — không dùng màu làm tín hiệu duy nhất.
const STATUS_META = {
  ok: { Icon: CheckCircle2, color: 'var(--accent-success)' },
  warn: { Icon: AlertTriangle, color: 'var(--accent-warning)' },
  error: { Icon: XCircle, color: 'var(--accent-danger)' },
}

// Số mục backend kiểm (python, odbc, chromium, venvs) — giữ chỗ trước khi có kết quả
// để modal không nhảy chiều cao (CLS).
const ITEM_COUNT = 4

function EnvItem({ item, t }) {
  const meta = STATUS_META[item.status] || STATUS_META.error
  const { Icon } = meta
  const params = item.params || {}
  return (
    <li className="env-item">
      <Icon size={18} color={meta.color} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="env-item-head">
          <span className="env-item-title">{t(`envCheck.${item.code}.title`)}</span>
          {/* Chữ nhãn dùng --text-primary, chỉ VIỀN mang màu trạng thái: --accent-danger
              trên --bg-elevated ở theme tối chỉ đạt 4,43:1 (< 4,5). */}
          <span className="env-badge" style={{ borderColor: meta.color }}>
            {t(`envCheck.status.${item.status}`)}
          </span>
        </div>
        {/* Màu chữ lấy từ token CSS của dự án, KHÔNG dùng type="secondary" của antd —
            màu đó chỉ đạt 2,3:1 trên --bg-elevated ở theme sáng. */}
        <p className="env-item-desc">{t(`envCheck.${item.code}.${item.status}`, params)}</p>
        {params.detail && (
          <p className="env-item-desc">{t('envCheck.detail', { detail: params.detail })}</p>
        )}
        {params.path && item.status !== 'error' && (
          <Text code className="env-item-path">{params.path}</Text>
        )}
      </div>
    </li>
  )
}

export default function EnvCheckModal({ open, onClose }) {
  const { t } = useTranslation()
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const runCheck = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await systemApi.envCheck()
      // Backend bản cũ chưa có endpoint này vẫn trả 200 + index.html (route SPA bắt
      // mọi đường dẫn) → phải kiểm đúng dạng, nếu không modal hiện trống trơn.
      if (!Array.isArray(data?.items)) throw new Error('bad response')
      setItems(data.items)
    } catch {
      setItems(null)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // Mỗi lần mở là kiểm lại — trạng thái máy có thể đã đổi (vừa cài driver, vừa tạo lại venv).
  useEffect(() => {
    if (open) runCheck()
  }, [open, runCheck])

  return (
    <Modal
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Stethoscope size={18} color="var(--accent-primary)" aria-hidden="true" />
          <span style={{ fontWeight: 600 }}>{t('envCheck.title')}</span>
        </span>
      }
      open={open}
      onCancel={onClose}
      width={560}
      footer={
        <Button
          icon={<RefreshCw size={14} aria-hidden="true" />}
          onClick={runCheck}
          loading={loading}
          disabled={loading}
        >
          {t('envCheck.recheck')}
        </Button>
      }
    >
      <p className="env-intro">{t('envCheck.intro')}</p>

      {failed && <Alert type="error" showIcon title={t('envCheck.loadError')} style={{ marginBottom: 12 }} />}

      {(items || loading) && (
        <Spin spinning={loading}>
          <ul className="env-list" aria-busy={loading} aria-live="polite">
            {items
              ? items.map((item) => <EnvItem key={item.code} item={item} t={t} />)
              : Array.from({ length: ITEM_COUNT }, (_, i) => <li key={i} className="env-item env-item-placeholder" />)}
          </ul>
        </Spin>
      )}
    </Modal>
  )
}
