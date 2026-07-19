import React, { useState, useEffect } from 'react'
import { Calendar, Trash2, Clock, Edit2 } from 'lucide-react'
import { getSchedules, createSchedule, updateSchedule, deleteSchedule as apiDeleteSchedule, toggleSchedule as apiToggleSchedule } from '../api/client'
import { Drawer, Form, Input, TimePicker, DatePicker, Select, Button, Switch, Tag, Typography, Space, Popconfirm, Table, Radio, InputNumber, Card, Empty } from 'antd'
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
  { label: 'CN', value: 'sun' }
]
const DAY_MAP = DAY_OPTIONS.reduce((acc, curr) => ({ ...acc, [curr.value]: curr.label }), {})

function parseCron(cron) {
  try {
    if (cron && typeof cron === 'string' && cron.startsWith('{')) {
      const config = JSON.parse(cron)
      const time = config.hour && config.minute ? `${config.hour.padStart(2, '0')}:${config.minute.padStart(2, '0')}` : 'mỗi giờ'
      let str = ''
      if (config.schedule_type === 'month') {
        str = `Ngày ${config.day_of_month || 1} / tháng lúc ${time}`
      } else {
        const days = config.days && config.days.length > 0 ? config.days.map(d => DAY_MAP[d] || d).join(', ') : 'Hàng ngày'
        str = `${days} lúc ${time}`
      }
      return str
    }
    return 'Lịch tùy chỉnh'
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
  const scheduleType = Form.useWatch('schedule_type', form)

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
          schedule_type: config.schedule_type || 'week',
          day_of_month: config.day_of_month || 1,
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
      schedule_type: values.schedule_type,
      day_of_month: values.day_of_month,
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
    if (!iso) return <Text type="secondary" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>Chưa xếp lịch</Text>
    const d = new Date(iso)
    return <Text style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
      {d.toLocaleString('vi-VN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
    </Text>
  }

  const columns = [
    {
      title: 'STT',
      key: 'stt',
      width: 50,
      align: 'center',
      render: (_, __, index) => <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{index + 1}</span>
    },
    {
      title: 'Tên ghi nhớ',
      dataIndex: 'label',
      key: 'label',
      render: (text, record) => (
        <div>
          <div style={{ fontWeight: 500, opacity: record.enabled ? 1 : 0.5 }}>{text}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{parseCron(record.cron_expr)}</div>
        </div>
      )
    },
    {
      title: 'Chạy tiếp',
      dataIndex: 'next_run_at',
      key: 'next_run_at',
      width: 130,
      align: 'center',
      render: formatNextRun
    },
    {
      title: 'Bật',
      key: 'status',
      width: 70,
      align: 'center',
      render: (_, record) => (
        <Switch size="small" checked={record.enabled} onChange={(checked) => toggleSchedule(record.id, checked)} />
      )
    },
    {
      title: 'Thao tác',
      key: 'action',
      width: 90,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" type="text" icon={<Edit2 size={14} />} onClick={() => openEdit(record)} />
          <Popconfirm title="Xóa lịch này?" onConfirm={() => deleteSchedule(record.id)}>
            <Button size="small" type="text" danger icon={<Trash2 size={14} />} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <Drawer
      title={
        <Space>
          <Calendar size={16} color="var(--accent-warning)" />
          <span style={{ fontWeight: 600 }}>{showAdd ? (editingSchedule ? 'Chỉnh sửa lịch' : 'Thêm lịch mới') : 'Lịch chạy'}</span>
          <Tag bordered={false} style={{ margin: 0 }}>{workflow?.name}</Tag>
        </Space>
      }
      extra={
        !showAdd ? (
          <Button size="small" type="primary" icon={<Clock size={14} />} onClick={() => { setEditingSchedule(null); form.resetFields(); setShowAdd(true); }}>
            Thêm mới
          </Button>
        ) : (
          <Button size="small" onClick={() => { setShowAdd(false); setEditingSchedule(null); }}>
            Quay lại
          </Button>
        )
      }
      open={true}
      onClose={onClose}
      maskClosable={false}
      destroyOnClose
      size="large"
      placement="right"
      styles={{ body: { padding: 16 } }}
    >
      {!showAdd ? (
        <Table 
          dataSource={schedules}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="small"
          sticky={{ offsetHeader: 0 }}
          scroll={{ y: 'calc(100vh - 160px)' }}
          locale={{ emptyText: <Empty description="Chưa có lịch nào. Thêm lịch để tự động chạy workflow." image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      ) : (
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={{ schedule_type: 'week', day_of_month: 1, days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: dayjs('08:00', 'HH:mm') }}
          >
            <Form.Item name="schedule_type" label="Kiểu lặp lại">
              <Radio.Group optionType="button" buttonStyle="solid" size="small">
                <Radio.Button value="week">Theo tuần</Radio.Button>
                <Radio.Button value="month">Theo tháng</Radio.Button>
              </Radio.Group>
            </Form.Item>

            <Form.Item name="time" label="Giờ chạy" rules={[{ required: true, message: 'Vui lòng chọn giờ' }]}>
              <TimePicker format="HH:mm" style={{ width: '100%' }} />
            </Form.Item>

            {scheduleType === 'month' ? (
              <Form.Item name="day_of_month" label="Ngày trong tháng" rules={[{ required: true, message: 'Nhập ngày' }]}>
                <InputNumber min={1} max={31} style={{ width: '100%' }} placeholder="VD: 1" />
              </Form.Item>
            ) : (
              <Form.Item name="days" label="Các ngày trong tuần" rules={[{ required: true, message: 'Chọn ít nhất 1 ngày' }]}>
                <Select mode="multiple" options={DAY_OPTIONS} placeholder="Chọn ngày" />
              </Form.Item>
            )}

            <Form.Item name="dateRange" label="Thời gian áp dụng">
              <DatePicker.RangePicker style={{ width: '100%' }} format="DD/MM/YYYY" placeholder={['Bắt đầu', 'Kết thúc']} />
            </Form.Item>

            <Form.Item name="label" label="Tên ghi nhớ" rules={[{ required: true, message: 'Nhập tên' }]}>
              <Input placeholder="VD: Chạy buổi sáng" />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
              <Space>
                <Button htmlType="submit" type="primary" loading={creating}>
                  {editingSchedule ? 'Lưu thay đổi' : 'Thêm lịch'}
                </Button>
                <Button onClick={() => { setShowAdd(false); setEditingSchedule(null); }}>
                  Hủy
                </Button>
              </Space>
            </Form.Item>
          </Form>
      )}
    </Drawer>
  )
}
