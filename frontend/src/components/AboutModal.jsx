import React, { useState, useEffect } from 'react'
import { Modal, Space, Typography, Button, Spin, Alert, message } from 'antd'
import { Info, Zap, Mail, Send, Tag, Clock, DownloadCloud, CheckCircle } from 'lucide-react'
import { APP_INFO } from '../config/appInfo'
import { systemApi, checkHealth } from '../api/client'

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

export default function AboutModal({ open, onClose }) {
  const [sysInfo, setSysInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateStatus, setUpdateStatus] = useState(null) // null, 'available', 'latest', 'updating'
  const [updateMsg, setUpdateMsg] = useState('')

  useEffect(() => {
    if (open) {
      loadSystemInfo()
      setUpdateStatus(null)
      setUpdateMsg('')
    }
  }, [open])

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
      if (res.hasUpdate) {
        setUpdateStatus('available')
      } else {
        setUpdateStatus('latest')
      }
      setUpdateMsg(res.message)
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
      
      // Ping liên tục để chờ Backend sống lại
      const pingInterval = setInterval(async () => {
        try {
          await checkHealth()
          clearInterval(pingInterval)
          message.success("Cập nhật thành công!")
          window.location.reload() // Tự tải lại trang khi sống lại
        } catch (e) {
          // Backend chưa sống, tiếp tục ping
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
      maskClosable={updateStatus !== 'updating'}
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
            <Alert message={updateMsg} type="success" showIcon icon={<CheckCircle size={14}/>} style={{ fontSize: '0.85rem', justifyContent: 'center' }} />
          )}

          {updateStatus === 'available' && (
            <Alert 
              message={updateMsg} 
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

          {updateStatus === 'updating' && (
            <Alert 
              message={<Space><Spin size="small"/> {updateMsg}</Space>} 
              type="warning" 
              style={{ fontSize: '0.85rem', justifyContent: 'center' }}
            />
          )}
        </Space>
      </div>
    </Modal>
  )
}
