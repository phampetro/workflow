import React, { useState } from 'react'
import { Button, Input, App } from 'antd'
import { ShieldCheck, Copy, KeyRound, AlertTriangle } from 'lucide-react'
import { activateLicense } from '../api/client'

/**
 * Màn khóa kích hoạt — chỉ hiển thị khi license enforced=true và chưa hợp lệ.
 * Khách xem "mã máy" (vân tay), gửi cho nhà cung cấp để nhận key, dán vào rồi kích hoạt.
 */
export default function LicenseGate({ status, onActivated }) {
  const { message } = App.useApp()
  const [key, setKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const machine = status?.machine || '—'
  const expired = status?.activated && !status?.valid

  const copyMachine = async () => {
    try {
      await navigator.clipboard.writeText(machine)
      message.success('Đã copy mã máy')
    } catch {
      message.error('Không copy được, hãy chọn và copy thủ công')
    }
  }

  const handleActivate = async () => {
    if (!key.trim()) return
    setLoading(true)
    setError(null)
    try {
      await activateLicense(key.trim())
      message.success('Kích hoạt thành công!')
      setTimeout(() => (onActivated ? onActivated() : window.location.reload()), 600)
    } catch (err) {
      setError(err.message || 'Kích hoạt thất bại')
      setLoading(false)
    }
  }

  return (
    <div className="license-gate">
      <div className="license-card">
        <div className="license-icon" aria-hidden="true">
          <ShieldCheck size={30} />
        </div>
        <h1 className="license-title">Kích hoạt PyFlow Studio</h1>
        <p className="license-sub">
          Phần mềm cần được kích hoạt bằng key bản quyền để sử dụng.
        </p>

        {expired && (
          <div className="license-warn" role="alert">
            <AlertTriangle size={16} />
            <span>{status?.reason || 'License đã hết hạn — vui lòng nhập key gia hạn.'}</span>
          </div>
        )}

        <div className="license-field">
          <label className="license-label">Mã máy của bạn</label>
          <div className="license-machine">
            <code>{machine}</code>
            <Button size="small" icon={<Copy size={14} />} onClick={copyMachine} aria-label="Copy mã máy">
              Copy
            </Button>
          </div>
          <p className="license-hint">
            Gửi mã máy này cho nhà cung cấp để nhận key kích hoạt / gia hạn.
          </p>
        </div>

        <div className="license-field">
          <label className="license-label" htmlFor="license-key">Key kích hoạt</label>
          <Input.TextArea
            id="license-key"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(null); }}
            placeholder="Dán key (PF1.xxxx.yyyy) vào đây"
            autoSize={{ minRows: 3, maxRows: 5 }}
            spellCheck={false}
            status={error ? 'error' : ''}
          />
          {error && <div className="license-error-text">{error}</div>}
        </div>

        <Button
          type="primary"
          block
          size="large"
          icon={<KeyRound size={16} />}
          loading={loading}
          disabled={!key.trim()}
          onClick={handleActivate}
        >
          Kích hoạt
        </Button>
      </div>

      <style>{`
        .license-gate {
          position: fixed; inset: 0; z-index: 1000;
          display: flex; align-items: center; justify-content: center;
          background: var(--bg-base); padding: 1.5rem;
        }
        .license-card {
          width: 100%; max-width: 26rem;
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-md);
          padding: 2rem 1.75rem;
          text-align: center;
        }
        .license-icon {
          width: 56px; height: 56px; margin: 0 auto 1rem;
          display: flex; align-items: center; justify-content: center;
          border-radius: 16px;
          background: var(--accent-primary); color: #fff;
        }
        .license-title { font-size: 1.25rem; font-weight: 700; color: var(--text-primary); margin: 0 0 0.375rem; }
        .license-sub { font-size: 0.85rem; color: var(--text-secondary); margin: 0 0 1.25rem; line-height: 1.5; }
        .license-warn {
          display: flex; align-items: center; gap: 0.5rem;
          text-align: left; font-size: 0.8rem; line-height: 1.4;
          background: rgba(245,158,11,0.12); color: var(--accent-warning);
          border: 1px solid rgba(245,158,11,0.3);
          border-radius: var(--radius-sm); padding: 0.625rem 0.75rem; margin-bottom: 1.25rem;
        }
        .license-warn svg { flex-shrink: 0; }
        .license-field { text-align: left; margin-bottom: 1rem; }
        .license-label { display: block; font-size: 0.78rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.375rem; }
        .license-machine {
          display: flex; align-items: center; gap: 0.5rem;
          background: var(--bg-elevated); border: 1px solid var(--border-default);
          border-radius: var(--radius-sm); padding: 0.5rem 0.625rem;
        }
        .license-machine code {
          flex: 1; font-family: var(--font-mono, monospace); font-size: 0.8rem;
          color: var(--text-primary); overflow-wrap: anywhere; user-select: all;
        }
        .license-hint { font-size: 0.72rem; color: var(--text-muted); margin: 0.375rem 0 0; line-height: 1.4; }
        .license-error-text { color: var(--accent-danger); font-size: 0.8rem; margin-top: 0.375rem; }
      `}</style>
    </div>
  )
}
