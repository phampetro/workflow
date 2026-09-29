import React, { useState, useEffect, useCallback } from 'react'
import { Empty, Tag, Tooltip, Button, Spin } from 'antd'
import { RefreshCw, Cpu, Activity } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { getSystemHardware } from '../api/client'

// Panel 1/3 bên phải, dùng chung cho Dashboard lẫn ProjectDetail (App.jsx render
// 1 lần duy nhất bên ngoài 2 trang đó) — nội dung để trống cho chức năng bổ sung
// sau, đáy panel là widget CPU/RAM. Tự polling khi `active` (đang hiện, dù dạng
// inline hay Drawer) để không gọi API khi panel đang ẩn.
export default function SidePanel({ active }) {
  const { t } = useTranslation()
  const [hardware, setHardware] = useState(null)
  const [hwLoading, setHwLoading] = useState(false)
  const [hwError, setHwError] = useState(null)

  const loadHardware = useCallback(async (showLoading = false) => {
    if (showLoading) setHwLoading(true)
    try {
      setHwError(null)
      const res = await getSystemHardware()
      const data = res?.data || res
      if (data && data.cpu) {
        setHardware(data)
      } else {
        setHwError('Dữ liệu không khớp: ' + JSON.stringify(data || res).slice(0, 120))
      }
    } catch (err) {
      console.error('[Hardware Error]', err)
      setHwError(err.message || String(err))
      if (showLoading) {
        toast.error(err.message || 'Lỗi tải thông tin phần cứng')
      }
    } finally {
      if (showLoading) setHwLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active) return
    loadHardware(true)
    const timer = setInterval(() => {
      loadHardware(false)
    }, 3000)
    return () => clearInterval(timer)
  }, [active, loadHardware])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Vùng nội dung chính của panel (để trống cho chức năng bổ sung sau) */}
      <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>{t('projectDetail.sidePanelEmpty')}</span>}
          style={{ margin: 0 }}
        />
      </div>

      {/* Thẻ phần cứng CPU & RAM hiển thị ở đáy panel */}
      <div style={{
        padding: '0.75rem 0.875rem',
        borderTop: '1px solid var(--border-default)',
        background: 'var(--bg-base)',
        flexShrink: 0,
        borderRadius: '0 0 var(--radius-lg, 16px) var(--radius-lg, 16px)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', padding: '0 0.125rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Activity size="0.8125rem" style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
              {t('projectDetail.hardwareTitle')}
            </span>
          </div>
          <Tooltip title={t('projectDetail.refreshHardware')}>
            <Button
              type="text"
              size="small"
              icon={<RefreshCw size="0.75rem" className={hwLoading ? 'spinning' : ''} />}
              onClick={() => loadHardware(true)}
              style={{ color: 'var(--text-muted)', width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            />
          </Tooltip>
        </div>
        {hardware && hardware.cpu ? (
          <div style={{
            padding: '0.75rem 0.875rem',
            background: 'var(--bg-surface)',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'stretch',
            gap: '0.75rem',
            boxShadow: 'var(--shadow-sm)'
          }}>
            {/* Cột trái: CPU */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <Cpu size="0.875rem" style={{ color: 'var(--accent-primary)' }} />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>CPU</span>
                </div>
                <Tag
                  color={hardware.cpu.percent > 85 ? 'error' : hardware.cpu.percent > 60 ? 'warning' : 'processing'}
                  style={{ margin: 0, fontSize: '0.6875rem', padding: '0 4px', lineHeight: '18px', fontWeight: 600, borderRadius: 4 }}
                >
                  {hardware.cpu.percent}%
                </Tag>
              </div>

              <div
                style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                title={hardware.cpu.name}
              >
                {hardware.cpu.name || 'Processor'}
              </div>

              <div style={{ fontSize: '0.7188rem', color: 'var(--text-muted)' }}>
                {hardware.cpu.physical_cores} {t('projectDetail.coresSuffix')} · {hardware.cpu.logical_cores} {t('projectDetail.threadsSuffix')}
              </div>

              {/* Tiêu thụ của PyFlow App */}
              <div style={{
                marginTop: '0.125rem',
                paddingTop: '0.25rem',
                borderTop: '1px dashed var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.7188rem',
                color: 'var(--text-secondary)'
              }}>
                <span>{t('projectDetail.appUsage')}:</span>
                <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                  {hardware.app?.cpu_percent ?? 0}%
                </span>
              </div>
            </div>

            {/* Vạch ngăn cách giữa CPU và RAM */}
            <div style={{ width: 1, background: 'var(--border-default)', alignSelf: 'stretch', margin: '2px 0' }} />

            {/* Cột phải: RAM */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <Activity size="0.875rem" style={{ color: '#00d4aa' }} />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>RAM</span>
                </div>
                <Tag
                  color={hardware.memory?.percent > 85 ? 'error' : hardware.memory?.percent > 70 ? 'warning' : 'success'}
                  style={{ margin: 0, fontSize: '0.6875rem', padding: '0 4px', lineHeight: '18px', fontWeight: 600, borderRadius: 4 }}
                >
                  {hardware.memory?.percent ?? 0}%
                </Tag>
              </div>

              <div style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {hardware.memory?.used_gb ?? '-'} / {hardware.memory?.total_gb ?? '-'} <span style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--text-secondary)' }}>GB</span>
              </div>

              <div style={{ fontSize: '0.7188rem', color: 'var(--text-muted)' }}>
                {t('projectDetail.ramFree')}: <span style={{ color: '#10b981', fontWeight: 500 }}>{hardware.memory?.free_gb ?? '-'} GB</span>
              </div>

              {/* Tiêu thụ của PyFlow App (đơn vị MB) */}
              <div style={{
                marginTop: '0.125rem',
                paddingTop: '0.25rem',
                borderTop: '1px dashed var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.7188rem',
                color: 'var(--text-secondary)'
              }}>
                <span>{t('projectDetail.appUsage')}:</span>
                <span style={{ fontWeight: 600, color: '#00d4aa' }}>
                  {hardware.app?.memory_mb ?? 0} MB
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div style={{
            padding: '0.625rem 0.875rem',
            background: 'var(--bg-surface)',
            borderRadius: 8,
            border: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
              <Spin size="small" spinning={hwLoading} />
              <span style={{ fontSize: '0.75rem', color: hwError ? '#ef4444' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={hwError || ''}>
                {hwError ? hwError : (hwLoading ? t('projectDetail.hardwareLoading', { defaultValue: 'Đang tải thông số...' }) : t('projectDetail.hardwareLoadFailed', { defaultValue: 'Chưa có dữ liệu phần cứng' }))}
              </span>
            </div>
            <Button size="small" type="text" icon={<RefreshCw size="0.75rem" className={hwLoading ? 'spinning' : ''} />} onClick={() => loadHardware(true)}>
              {t('projectDetail.refreshHardware', { defaultValue: 'Thử lại' })}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
