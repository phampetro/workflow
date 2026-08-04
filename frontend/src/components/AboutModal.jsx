import React, { useState, useEffect } from 'react'
import { Modal, Space, Typography, Button, Spin, Alert, message } from 'antd'
import { ShieldCheck, Info, Zap, Mail, Send, Tag, Clock, DownloadCloud, CheckCircle } from 'lucide-react'
import { APP_INFO } from '../config/appInfo'
import { systemApi, checkHealth, getLicenseStatus } from '../api/client'
import dayjs from 'dayjs'

const { Text } = Typography

function InfoRow({ icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      <div style={{ color: 'var(--text-muted)', display: 'flex' }}>{icon}</div>
      <Text style={{ color: 'var(--text-muted)', minWidth: 90 }}>{label}</Text>
      <Text style={{ fontWeight: 500 }}>{value}</Text>
    </div>
  )
}

export default function AboutModal({ open, onClose, licenseStatus }) {
  const [sysInfo, setSysInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateStatus, setUpdateStatus] = useState(null) // null, 'available', 'latest', 'updating'
  const [updateMsg, setUpdateMsg] = useState('')

  // licenseStatus từ prop chỉ được App fetch MỘT LẦN lúc bootstrap. Sau khi cập
  // nhật, backend restart (process mới, có thể khác cờ enforce) nhưng trang không
  // tải lại nên prop đứng im → bảng hiện sai tới khi người dùng F5. Vì vậy modal
  // tự fetch lại mỗi lần mở.
  const [lic, setLic] = useState(licenseStatus)
  const [licLoading, setLicLoading] = useState(false)
  const [licUnknown, setLicUnknown] = useState(false)

  useEffect(() => { setLic(licenseStatus) }, [licenseStatus])

  useEffect(() => {
    if (open) {
      loadSystemInfo()
      refreshLicense()
      setUpdateStatus(null)
      setUpdateMsg('')
    }
  }, [open])

  const refreshLicense = async () => {
    setLicLoading(true)
    try {
      const res = await getLicenseStatus()
      if (res?.data) {
        setLic(res.data)
        setLicUnknown(false)
      } else {
        setLicUnknown(true)
      }
    } catch {
      // Backend chưa sống lại (VD vừa cập nhật xong). KHÔNG được coi là bản phát
      // triển: App.jsx lúc bootstrap lỗi mạng cũng rơi về {enforced:false} nên
      // trạng thái này không phân biệt được với bản dev thật.
      setLicUnknown(true)
    } finally {
      setLicLoading(false)
    }
  }

  const loadSystemInfo = async () => {
    setLoading(true)
    try {
      const data = await systemApi.getInfo()
      setSysInfo(data)
    } catch (error) {
      console.error("Lỗi tải thông tin hệ thống:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true)
    setUpdateStatus(null)
    try {
      const res = await systemApi.checkUpdate()
      if (res.error === "GIT_NOT_FOUND") {
        setUpdateStatus('error')
        setUpdateMsg(res.message)
      } else if (res.hasUpdate) {
        setUpdateStatus('available')
        setUpdateMsg(res.message)
      } else {
        setUpdateStatus('latest')
        setUpdateMsg(res.message)
      }
    } catch (err) {
      message.error("Không thể kiểm tra bản cập nhật.")
    } finally {
      setCheckingUpdate(false)
    }
  }

  const handleUpdate = async () => {
    setUpdateStatus('updating')
    setUpdateMsg("Hệ thống đang tải code mới và sẽ tự động khởi động lại trong giây lát...")
    try {
      await systemApi.update()
      
      // Chờ backend CŨ chết trước, RỒI mới chờ backend MỚI sống lại.
      // Trước đây chỉ chờ health OK rồi reload ngay — nhưng lúc đó backend cũ
      // thường vẫn còn sống (updater.bat đợi ~2s mới giải nén, start.vbs kill
      // port 8000 sau đó nữa) → trang tải lại quá sớm và đọc trạng thái của
      // process sắp bị kill, nên bảng Bản quyền/Version hiện số cũ tới khi F5.
      let sawDown = false
      let waited = 0
      const MAX_WAIT_MS = 120000
      const pingInterval = setInterval(async () => {
        waited += 2000
        try {
          await checkHealth()
          // Hết thời gian chờ mà backend chưa hề chết → có thể cập nhật thất bại
          // (VD giải nén không ghi đè được exe đang chạy). Vẫn reload để người
          // dùng không bị kẹt ở màn "đang cập nhật".
          if (sawDown || waited >= MAX_WAIT_MS) {
            clearInterval(pingInterval)
            message.success("Cập nhật thành công!")
            window.location.reload()
          }
        } catch (e) {
          sawDown = true // backend cũ đã tắt, giờ chờ backend mới
        }
      }, 2000)
    } catch (err) {
      message.error("Lỗi khi gửi lệnh cập nhật.")
      setUpdateStatus(null)
    }
  }

  const currentVersion = sysInfo?.version || APP_INFO.version
  const currentUpdatedAt = sysInfo?.updatedAt || APP_INFO.updatedAt

  return (
    <Modal
      title={
        <Space>
          <Info size={20} color="var(--accent-primary)" />
          <span style={{ fontWeight: 600 }}>Thông tin</span>
        </Space>
      }
      open={open}
      onCancel={updateStatus === 'updating' ? undefined : onClose}
      footer={null}
      width={420}
      closable={updateStatus !== 'updating'}
      mask={{ closable: updateStatus !== 'updating' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0 20px' }}>
        <div className="brand-icon" style={{ width: 44, height: 44 }}>
          <Zap size="1.5rem" strokeWidth={2.5} />
        </div>
        <div>
          <Text style={{ fontSize: '1.15rem', fontWeight: 700, display: 'block' }}>{APP_INFO.name}</Text>
          <Text style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Nền tảng tự động hóa workflow</Text>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border-default)', paddingTop: 8, paddingBottom: 16 }}>
        <InfoRow icon={<Tag size={14} />} label="Tác giả" value={APP_INFO.author} />
        <InfoRow icon={<Mail size={14} />} label="Liên hệ" value={APP_INFO.email} />
        <InfoRow icon={<Send size={14} />} label="Telegram" value={APP_INFO.telegram} />
        
        {lic && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
            <div style={{ color: 'var(--text-muted)', display: 'flex' }}><ShieldCheck size={14} /></div>
            <Text style={{ color: 'var(--text-muted)', minWidth: 90 }}>Bản quyền</Text>
            {/* Thứ tự điều kiện có chủ ý — đừng đảo:
                1. Có key hợp lệ  → "Đã kích hoạt" (đúng cho cả bản đóng gói lẫn source).
                2. packaged HOẶC enforced → "Chưa kích hoạt hoặc hết hạn".
                   - `packaged`: bản đã đóng gói TUYỆT ĐỐI không được hiện "Bản phát
                     triển" — cờ ENFORCE nằm ở launcher (start.vbs), nếu app bật
                     không qua launcher thì enforced=False và khách sẽ đọc thành
                     "Bản phát triển (Mở khóa)" màu xanh rồi hiểu nhầm.
                   - `enforced`: chạy từ source mà bật cờ để test thì app ĐANG bị
                     khóa thật, hiện "Bản phát triển" cũng là sai.
                3. Còn lại (source + không enforce) → đúng là bản phát triển. */}
            {licLoading ? (
              <Spin size="small" />
            ) : licUnknown ? (
              // Không gọi được API → KHÔNG suy ra là bản phát triển. Hay gặp ngay
              // sau khi cập nhật: backend cũ vừa bị kill, backend mới chưa serve.
              <Text style={{ fontWeight: 500, color: 'var(--text-muted)' }}>
                Chưa xác định được (backend chưa phản hồi)
              </Text>
            ) : lic.activated && lic.valid ? (
              <Text style={{ fontWeight: 500, color: 'var(--accent-success)' }}>
                Đã kích hoạt {lic.expiry ? `(Hết hạn: ${dayjs(lic.expiry).format('DD/MM/YYYY')})` : '(Vĩnh viễn)'}
              </Text>
            ) : (lic.packaged || lic.enforced) ? (
              <Text style={{ fontWeight: 500, color: 'var(--accent-danger)' }}>
                Chưa kích hoạt hoặc hết hạn
              </Text>
            ) : (
              <Text style={{ fontWeight: 500, color: 'var(--accent-success)' }}>Bản phát triển (Mở khóa)</Text>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <div style={{ color: 'var(--text-muted)', display: 'flex' }}><Tag size={14} /></div>
          <Text style={{ color: 'var(--text-muted)', minWidth: 90 }}>Version</Text>
          {loading ? <Spin size="small" /> : <Text style={{ fontWeight: 500, color: 'var(--accent-primary)' }}>{currentVersion}</Text>}
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <div style={{ color: 'var(--text-muted)', display: 'flex' }}><Clock size={14} /></div>
          <Text style={{ color: 'var(--text-muted)', minWidth: 90 }}>Cập nhật</Text>
          {loading ? <Spin size="small" /> : <Text style={{ fontWeight: 500 }}>{currentUpdatedAt}</Text>}
        </div>
      </div>

      <div style={{ padding: '8px 0', textAlign: 'center', marginTop: 8 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Button 
            type="primary" 
            icon={<DownloadCloud size={16} />} 
            onClick={handleCheckUpdate}
            loading={checkingUpdate}
            disabled={updateStatus === 'updating'}
            style={{ minWidth: 160 }}
          >
            Kiểm tra cập nhật
          </Button>

          {updateStatus === 'latest' && (
            <Alert title={updateMsg} type="success" showIcon icon={<CheckCircle size={14}/>} style={{ fontSize: '0.85rem', justifyContent: 'center' }} />
          )}

          {updateStatus === 'available' && (
            <Alert
              title={updateMsg}
              type="info"
              showIcon
              style={{ fontSize: '0.85rem', justifyContent: 'center' }}
              action={
                <Button size="small" type="primary" onClick={handleUpdate}>
                  Cập nhật ngay
                </Button>
              }
            />
          )}

          {updateStatus === 'error' && (
            <Alert
              title={updateMsg}
              type="error"
              showIcon
              style={{ fontSize: '0.85rem', justifyContent: 'center' }}
            />
          )}

          {updateStatus === 'updating' && (
            <Alert
              title={<Space><Spin size="small"/> {updateMsg}</Space>}
              type="warning"
              style={{ fontSize: '0.85rem', justifyContent: 'center' }}
            />
          )}
        </Space>
      </div>
    </Modal>
  )
}
