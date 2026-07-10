import React, { useState, useEffect } from 'react'
import { Calendar, Trash2, Clock, Edit2 } from 'lucide-react'
import { getSchedules, createSchedule, updateSchedule, deleteSchedule as apiDeleteSchedule, toggleSchedule as apiToggleSchedule } from '../api/client'
import { Drawer, Form, Input, TimePicker, DatePicker, Select, Button, Switch, Tag, Typography, Space, Popconfirm, Table } from 'antd'
import toast from 'react-hot-toast'
import dayjs from 'dayjs'

const { Text } = Typography

const DAY_OPTIONS = [
  { label: 'Thứ 2', value: 'mon' },
  { label: 'Thứ 3', value: 'tue' },
  { label: 'Thứ 4', value: 'wed' },
  { label: 'Thứ 5', value: 'thu' },
  { label: 'Thứ 6', value: 'fri' },
  { label: 'Thứ 7', value: 'sat' },
  { label: 'Chủ nhật', value: 'sun' }
]
const DAY_MAP = DAY_OPTIONS.reduce((acc, curr) => ({ ...acc, [curr.value]: curr.label }), {})

function parseCron(cron) {
  try {
    if (cron && typeof cron === 'string' && cron.startsWith('{')) {
      const config = JSON.parse(cron)
      const days = config.days && config.days.length > 0 ? config.days.map(d => DAY_MAP[d] || d).join(', ') : 'Hàng ngày'
      const time = config.hour && config.minute ? `${config.hour.padStart(2, '0')}:${config.minute.padStart(2, '0')}` : 'mỗi giờ'
      let str = `Lặp lại ${days} lúc ${time}`
      if (config.start_date) str += ` (từ ${config.start_date})`
      if (config.end_date) str += ` (đến ${config.end_date})`
      return str
    }
    const parts = cron.split(' ')
    if (parts.length !== 5) return 'Cron không hợp lệ'
    const [min, hour, dom, mon, dow] = parts
    const days = dow === '*' ? 'Hàng ngày' : `Thứ ${dow}`
    const time = `${hour === '*' ? 'mỗi giờ' : hour.padStart(2, '0') + ':' + min.padStart(2, '0')}`
    return `${days} lúc ${time}`
  } catch {
    return 'Lịch tùy chỉnh'
  }
}

export default function SchedulerPanel({ workflow, onClose }) {
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [form] = Form.useForm()

  useEffect(() => {
    if (workflow?.id) {
      getSchedules(workflow.id)
        .then(res => setSchedules(res.data || []))
        .catch(e => toast.error('Lỗi tải lịch: ' + e.message))
        .finally(() => setLoading(false))
    }
  }, [workflow?.id])

  const openEdit = (schedule) => {
    try {
      if (schedule.cron_expr && schedule.cron_expr.startsWith('{')) {
        const config = JSON.parse(schedule.cron_expr)
        form.setFieldsValue({
          time: dayjs(`${config.hour}:${config.minute}`, 'HH:mm'),
          days: config.days,
          dateRange: config.start_date && config.end_date ? [dayjs(config.start_date), dayjs(config.end_date)] : undefined,
          label: schedule.label
        })
      }
    } catch (e) {
      console.error("Lỗi parse cấu hình lịch:", e)
    }
    setEditingSchedule(schedule.id)
    setShowAdd(true)
  }

  const handleSubmit = async (values) => {
    setCreating(true)
    const time = values.time.format('HH:mm')
    const [hour, minute] = time.split(':')
    const cronPayload = JSON.stringify({
      hour,
      minute,
      days: values.days,
      start_date: values.dateRange?.[0] ? values.dateRange[0].format('YYYY-MM-DD') : undefined,
      end_date: values.dateRange?.[1] ? values.dateRange[1].format('YYYY-MM-DD') : undefined
    })

    const payload = {
      cron_expr: cronPayload,
      label: values.label || parseCron(cronPayload),
      enabled: true
    }

    try {
      if (editingSchedule) {
        const res = await updateSchedule(editingSchedule, payload)
        setSchedules(schedules.map(s => s.id === editingSchedule ? res.data : s))
        toast.success('Đã cập nhật lịch chạy')
      } else {
        const res = await createSchedule(workflow.id, payload)
        setSchedules([...schedules, res.data])
        toast.success('Đã thêm lịch chạy mới')
      }
      setShowAdd(false)
      setEditingSchedule(null)
      form.resetFields()
    } catch (e) {
      toast.error(`Lỗi ${editingSchedule ? 'cập nhật' : 'tạo'} lịch: ` + e.message)
    } finally {
      setCreating(false)
    }
  }

  const toggleSchedule = async (id, checked) => {
    try {
      const res = await apiToggleSchedule(id)
      setSchedules(schedules.map(s => 
        s.id === id ? { ...s, enabled: res.data.enabled, next_run_at: res.data.next_run_at } : s
      ))
      toast.success(`Đã ${res.data.enabled ? 'bật' : 'tắt'} lịch chạy`)
    } catch (e) {
      toast.error('Lỗi: ' + e.message)
    }
  }

  const deleteSchedule = async (id) => {
    try {
      await apiDeleteSchedule(id)
      setSchedules(schedules.filter(s => s.id !== id))
      toast.success('Đã xóa lịch chạy')
    } catch (e) {
      toast.error('Lỗi xóa lịch: ' + e.message)
    }
  }

  const formatNextRun = (iso) => {
    if (!iso) return 'Chưa xếp lịch'
    const d = new Date(iso)
    return d.toLocaleString('vi-VN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }

  const columns = [
    {
      title: 'Tên ghi nhớ',
      dataIndex: 'label',
      key: 'label',
      render: (text, record) => (
        <span style={{ opacity: record.enabled ? 1 : 0.5, fontWeight: 500 }}>{text}</span>
      )
    },
    {
      title: 'Lần chạy tiếp theo',
      dataIndex: 'next_run_at',
      key: 'next_run_at',
      render: (text, record) => (
        <Text type={record.enabled ? 'warning' : 'secondary'} strong>
          {formatNextRun(text)}
        </Text>
      )
    },
    {
      title: 'Trạng thái',
      key: 'status',
      width: 100,
      render: (_, record) => (
        <Switch size="small" checked={record.enabled} onChange={(checked) => toggleSchedule(record.id, checked)} />
      )
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Space size="small">
          <Button size="small" type="text" icon={<Edit2 size="0.875rem" />} onClick={() => openEdit(record)} />
          <Popconfirm title="Xóa lịch này?" onConfirm={() => deleteSchedule(record.id)}>
            <Button size="small" type="text" danger icon={<Trash2 size="0.875rem" />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          <Calendar size="1.125rem" color="var(--accent-warning)" style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Lịch chạy — {workflow?.name}
          </span>
        </div>
      }
      open={true}
      onClose={onClose}
      maskClosable={false}
      destroyOnClose
      width="50vw"
      placement="right"
      bodyStyle={{ padding: 16 }}
    >
      <div>
        {!showAdd && (
          <>
            <div className="section-header">
              <h3 className="section-title">Danh sách lịch hẹn</h3>
              <Button size="small" type="primary" onClick={() => { setEditingSchedule(null); form.resetFields(); setShowAdd(true); }}>
                + Thêm mới
              </Button>
            </div>
            <Table 
              dataSource={schedules}
              columns={columns}
              rowKey="id"
              loading={loading}
              pagination={false}
              size="small"
              bordered
              locale={{ emptyText: 'Chưa có lịch nào. Thêm lịch để tự động chạy workflow.' }}
            />
          </>
        )}

        {showAdd && (
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: dayjs('08:00', 'HH:mm') }}
            style={{ background: 'var(--bg-elevated)', padding: 24, borderRadius: 8, border: '1px solid var(--border-default)' }}
          >
            <h4 style={{ margin: '0 0 16px 0' }}>{editingSchedule ? 'Chỉnh sửa lịch hẹn' : 'Thêm lịch mới'}</h4>
            
            <Form.Item name="time" label="Giờ chạy" rules={[{ required: true, message: 'Vui lòng chọn giờ chạy' }]}>
              <TimePicker format="HH:mm" style={{ width: '100%' }} />
            </Form.Item>

            <Form.Item name="days" label="Lặp lại vào các ngày" rules={[{ required: true, message: 'Chọn ít nhất 1 ngày' }]}>
              <Select mode="multiple" options={DAY_OPTIONS} placeholder="Chọn ngày lặp lại" />
            </Form.Item>

            <Form.Item name="dateRange" label="Thời gian áp dụng" rules={[{ required: true, message: 'Vui lòng chọn thời gian áp dụng' }]}>
              <DatePicker.RangePicker style={{ width: '100%' }} format="DD/MM/YYYY" placeholder={['Ngày bắt đầu', 'Ngày kết thúc']} />
            </Form.Item>

            <Form.Item name="label" label="Tên ghi nhớ" rules={[{ required: true, message: 'Vui lòng nhập tên ghi nhớ' }]}>
              <Input placeholder="VD: Chạy buổi sáng hàng ngày" />
            </Form.Item>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
              <Button onClick={() => { setShowAdd(false); setEditingSchedule(null); }}>Hủy</Button>
              <Button type="primary" htmlType="submit" loading={creating}>{editingSchedule ? 'Lưu thay đổi' : 'Thêm lịch'}</Button>
            </div>
          </Form>
        )}
      </div>
    </Drawer>
  )
}
