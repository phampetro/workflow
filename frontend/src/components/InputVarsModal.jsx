import React, { useState, useEffect, useMemo } from 'react'
import { Modal, Form, Input, InputNumber, DatePicker, Button, Space } from 'antd'
import { FormInput, Clock } from 'lucide-react'
import dayjs from 'dayjs'
import toast from 'react-hot-toast'
import { submitRunInput } from '../api/client'

/**
 * Modal nhập biến cho khối input_vars.
 * - Đếm ngược lấy mốc từ backend (spec.remaining_seconds), đồng bộ lại mỗi lần poll.
 * - Ngày hiển thị DD/MM/YYYY, gửi về backend dạng YYYY-MM-DD (chuẩn SQL).
 * - Hết giờ: backend tự báo lỗi khối; modal chỉ tự đóng.
 */
export default function InputVarsModal({ runId, spec, onDone }) {
  const fields = spec?.fields || []
  const [values, setValues] = useState({})
  const [remaining, setRemaining] = useState(spec?.remaining_seconds ?? 0)
  const [submitting, setSubmitting] = useState(false)

  // Khởi tạo giá trị mặc định khi mở (theo block_id)
  useEffect(() => {
    const init = {}
    for (const f of fields) {
      if (f.type === 'date') init[f.name] = f.defaultValue ? dayjs(f.defaultValue) : null
      else if (f.type === 'number') init[f.name] = f.defaultValue !== '' && f.defaultValue != null ? Number(f.defaultValue) : null
      else init[f.name] = f.defaultValue ?? ''
    }
    setValues(init)
  }, [spec?.block_id])

  // Đồng bộ đếm ngược theo backend mỗi lần spec cập nhật (poll ~1.5s)
  useEffect(() => {
    setRemaining(spec?.remaining_seconds ?? 0)
  }, [spec?.remaining_seconds])

  // Tick giảm mỗi giây; chạm 0 → đóng (backend sẽ báo lỗi khối)
  useEffect(() => {
    if (remaining <= 0) { onDone?.(); return }
    const t = setInterval(() => setRemaining(r => (r <= 1 ? 0 : r - 1)), 1000)
    return () => clearInterval(t)
  }, [remaining, onDone])

  const mmss = useMemo(() => {
    const m = Math.floor(remaining / 60), s = remaining % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }, [remaining])

  const setVal = (name, v) => setValues(prev => ({ ...prev, [name]: v }))

  const handleSubmit = async () => {
    // Kiểm bắt buộc
    for (const f of fields) {
      if (f.required) {
        const v = values[f.name]
        const empty = v == null || v === '' || (f.type === 'date' && !v)
        if (empty) { toast.error(`Vui lòng nhập "${f.label || f.name}"`); return }
      }
    }
    // Chuẩn hoá payload: date → YYYY-MM-DD, number → số, còn lại → chuỗi
    const payload = {}
    for (const f of fields) {
      const v = values[f.name]
      if (f.type === 'date') payload[f.name] = v ? dayjs(v).format('YYYY-MM-DD') : ''
      else if (f.type === 'number') payload[f.name] = (v == null || v === '') ? '' : Number(v)
      else payload[f.name] = v ?? ''
    }
    setSubmitting(true)
    try {
      await submitRunInput(runId, payload)
      toast.success('Đã gửi dữ liệu nhập')
      onDone?.()
    } catch (err) {
      toast.error(err.message || 'Gửi thất bại (có thể đã hết thời gian)')
      onDone?.()
    }
  }

  const urgent = remaining <= 10

  return (
    <Modal
      open
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      title={
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space><FormInput size={18} color="#f97316" /><span style={{ fontWeight: 600 }}>{spec?.label || 'Nhập biến đầu vào'}</span></Space>
          <Space size={4} style={{ color: urgent ? 'var(--accent-danger)' : 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
            <Clock size={15} /> {mmss}
          </Space>
        </Space>
      }
      footer={
        <Button type="primary" loading={submitting} onClick={handleSubmit}>Gửi</Button>
      }
    >
      <Form layout="vertical" style={{ marginTop: 8 }}>
        {fields.map((f) => (
          <Form.Item
            key={f.name}
            label={<span>{f.label || f.name} {f.required && <span style={{ color: 'var(--accent-danger)' }}>*</span>}</span>}
            required={f.required}
            style={{ marginBottom: 14 }}
          >
            {f.type === 'number' ? (
              <InputNumber style={{ width: '100%' }} value={values[f.name]} placeholder={f.placeholder}
                onChange={(v) => setVal(f.name, v)} />
            ) : f.type === 'date' ? (
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" value={values[f.name] || null}
                onChange={(v) => setVal(f.name, v)} placeholder="Chọn ngày" />
            ) : (
              <Input value={values[f.name]} placeholder={f.placeholder}
                onChange={(e) => setVal(f.name, e.target.value)}
                onPressEnter={handleSubmit} />
            )}
          </Form.Item>
        ))}
      </Form>
    </Modal>
  )
}
