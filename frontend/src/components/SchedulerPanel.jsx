import React, { useState, useEffect } from 'react'
import { Calendar, Trash2, Clock, Edit2, Info } from 'lucide-react'
import { getSchedules, createSchedule, updateSchedule, deleteSchedule as apiDeleteSchedule, toggleSchedule as apiToggleSchedule, getUsers } from '../api/client'
import { Drawer, Form, Input, TimePicker, DatePicker, Select, Button, Switch, Tag, Typography, Space, Popconfirm, Table, Radio, InputNumber, Empty, Alert } from 'antd'
import toast from 'react-hot-toast'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import useStore from '../store/useStore'

const { Text } = Typography

const getDayOptions = (t) => [
  { label: t('schedulerPanel.dayMon'), value: 'mon' },
  { label: t('schedulerPanel.dayTue'), value: 'tue' },
  { label: t('schedulerPanel.dayWed'), value: 'wed' },
  { label: t('schedulerPanel.dayThu'), value: 'thu' },
  { label: t('schedulerPanel.dayFri'), value: 'fri' },
  { label: t('schedulerPanel.daySat'), value: 'sat' },
  { label: t('schedulerPanel.daySun'), value: 'sun' }
]

// Sinh chuỗi mô tả lịch từ cron_expr (JSON) — dùng để hiển thị LIVE dưới tên
// lịch trong bảng, và làm nhãn mặc định khi người dùng để trống "Tên ghi nhớ"
// lúc tạo lịch mới.
function parseCron(cron, t) {
  const dayMap = getDayOptions(t).reduce((acc, curr) => ({ ...acc, [curr.value]: curr.label }), {})
  try {
    if (cron && typeof cron === 'string' && cron.startsWith('{')) {
      const config = JSON.parse(cron)
      const time = config.hour && config.minute ? `${config.hour.padStart(2, '0')}:${config.minute.padStart(2, '0')}` : t('schedulerPanel.hourlyFallback')
      let str = ''
      if (config.schedule_type === 'month') {
        str = t('schedulerPanel.monthlyPattern', { day: config.day_of_month || 1, time })
      } else {
        const days = config.days && config.days.length > 0 ? config.days.map(d => dayMap[d] || d).join(', ') : t('schedulerPanel.dailyAllDays')
        str = t('schedulerPanel.weeklyPattern', { days, time })
      }
      return str
    }
    return t('schedulerPanel.customSchedule')
  } catch {
    return t('schedulerPanel.customSchedule')
  }
}

export default function SchedulerPanel({ workflow, onClose }) {
  const { t, i18n } = useTranslation()
  const DAY_OPTIONS = getDayOptions(t)
  const [schedules, setSchedules] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editingSchedule, setEditingSchedule] = useState(null)
  const [form] = Form.useForm()
  const scheduleType = Form.useWatch('schedule_type', form)
  const currentUser = useStore((s) => s.currentUser)
  // Chỉ hiện banner cảnh báo multi-user khi thực sự có >1 người dùng trong hệ thống -
  // với 1 user duy nhất thì mặc định luôn active, không có gì để cảnh báo.
  const [totalUsers, setTotalUsers] = useState(1)

  useEffect(() => {
    if (workflow?.id) {
      getSchedules(workflow.id)
        .then(res => setSchedules(res.data || []))
        .catch(e => toast.error(t('schedulerPanel.loadError', { message: e.message })))
        .finally(() => setLoading(false))
    } else {
      // loading khởi tạo là true; không có else thì mở Drawer khi workflow chưa
      // sẵn sàng sẽ để <Table loading> quay MÃI MÃI, không có gì gỡ được.
      setLoading(false)
    }
    getUsers()
      .then(res => setTotalUsers((res.data || []).length))
      .catch(() => {})
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
      label: values.label || parseCron(cronPayload, t),
      enabled: true
    }

    try {
      if (editingSchedule) {
        const res = await updateSchedule(editingSchedule, payload)
        setSchedules(schedules.map(s => s.id === editingSchedule ? res.data : s))
        toast.success(t('schedulerPanel.updateSuccess'))
      } else {
        const res = await createSchedule(workflow.id, payload)
        setSchedules([...schedules, res.data])
        toast.success(t('schedulerPanel.createSuccess'))
      }
      setShowAdd(false)
      setEditingSchedule(null)
      form.resetFields()
    } catch (e) {
      toast.error(editingSchedule
        ? t('schedulerPanel.submitErrorUpdate', { message: e.message })
        : t('schedulerPanel.submitErrorCreate', { message: e.message }))
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
      toast.success(res.data.enabled ? t('schedulerPanel.toggleOn') : t('schedulerPanel.toggleOff'))
    } catch (e) {
      toast.error(t('schedulerPanel.toggleError', { message: e.message }))
    }
  }

  const deleteSchedule = async (id) => {
    try {
      await apiDeleteSchedule(id)
      setSchedules(schedules.filter(s => s.id !== id))
      toast.success(t('schedulerPanel.deleteSuccess'))
    } catch (e) {
      toast.error(t('schedulerPanel.deleteError', { message: e.message }))
    }
  }

  const dateLocale = i18n.language === 'en' ? 'en-US' : 'vi-VN'
  const formatNextRun = (iso) => {
    if (!iso) return <Text type="secondary" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{t('schedulerPanel.notScheduled')}</Text>
    const d = new Date(iso)
    return <Text style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
      {d.toLocaleString(dateLocale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
    </Text>
  }

  const columns = [
    {
      title: t('schedulerPanel.colIndex'),
      key: 'stt',
      width: 50,
      align: 'center',
      render: (_, __, index) => <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{index + 1}</span>
    },
    {
      title: t('schedulerPanel.colName'),
      dataIndex: 'label',
      key: 'label',
      render: (text, record) => (
        <div>
          <div style={{ fontWeight: 500, opacity: record.enabled ? 1 : 0.5 }}>{text}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{parseCron(record.cron_expr, t)}</div>
        </div>
      )
    },
    {
      title: t('schedulerPanel.colNextRun'),
      dataIndex: 'next_run_at',
      key: 'next_run_at',
      width: 130,
      align: 'center',
      render: formatNextRun
    },
    {
      title: t('schedulerPanel.colEnabled'),
      key: 'status',
      width: 70,
      align: 'center',
      render: (_, record) => (
        <Switch size="small" checked={record.enabled} onChange={(checked) => toggleSchedule(record.id, checked)} />
      )
    },
    {
      title: t('schedulerPanel.colAction'),
      key: 'action',
      width: 90,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" type="text" icon={<Edit2 size={14} />} onClick={() => openEdit(record)} aria-label={t('schedulerPanel.editAria')} />
          <Popconfirm title={t('schedulerPanel.deleteConfirm')} onConfirm={() => deleteSchedule(record.id)}>
            <Button size="small" type="text" danger icon={<Trash2 size={14} />} aria-label={t('schedulerPanel.deleteAria')} />
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
          <span style={{ fontWeight: 600 }}>{showAdd ? (editingSchedule ? t('schedulerPanel.editTitle') : t('schedulerPanel.addTitle')) : t('schedulerPanel.panelTitle')}</span>
          <Tag variant="filled" style={{ margin: 0 }}>{workflow?.name}</Tag>
        </Space>
      }
      extra={
        !showAdd ? (
          <Button size="small" type="primary" icon={<Clock size={14} />} onClick={() => { setEditingSchedule(null); form.resetFields(); setShowAdd(true); }}>
            {t('schedulerPanel.addNew')}
          </Button>
        ) : (
          <Button size="small" onClick={() => { setShowAdd(false); setEditingSchedule(null); }}>
            {t('schedulerPanel.back')}
          </Button>
        )
      }
      open={true}
      onClose={onClose}
      mask={{ closable: false }}
      destroyOnHidden
      size="large"
      placement="right"
      styles={{ body: { padding: 16 } }}
    >
      {!showAdd ? (
        <>
          {totalUsers > 1 && (
            <Alert
              type="info"
              showIcon
              icon={<Info size={16} />}
              style={{ marginBottom: 12 }}
              title={
                <span>
                  {t('schedulerPanel.multiUserWarningPrefix')} <b>{currentUser?.name || t('schedulerPanel.currentUserFallback')}</b> {t('schedulerPanel.multiUserWarningSuffix')}
                </span>
              }
            />
          )}
          <Table
            dataSource={schedules}
            columns={columns}
            rowKey="id"
            loading={loading}
            pagination={false}
            size="small"
            sticky={{ offsetHeader: 0 }}
            scroll={{ y: 'calc(100vh - 160px)' }}
            locale={{ emptyText: <Empty description={t('schedulerPanel.emptyTable')} image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </>
      ) : (
          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            initialValues={{ schedule_type: 'week', day_of_month: 1, days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: dayjs('08:00', 'HH:mm') }}
          >
            <Form.Item name="schedule_type" label={t('schedulerPanel.scheduleTypeLabel')}>
              <Radio.Group optionType="button" buttonStyle="solid" size="small">
                <Radio.Button value="week">{t('schedulerPanel.weekly')}</Radio.Button>
                <Radio.Button value="month">{t('schedulerPanel.monthly')}</Radio.Button>
              </Radio.Group>
            </Form.Item>

            <Form.Item name="time" label={t('schedulerPanel.timeLabel')} rules={[{ required: true, message: t('schedulerPanel.timeRequired') }]}>
              <TimePicker format="HH:mm" style={{ width: '100%' }} />
            </Form.Item>

            {scheduleType === 'month' ? (
              <Form.Item name="day_of_month" label={t('schedulerPanel.dayOfMonthLabel')} rules={[{ required: true, message: t('schedulerPanel.dayOfMonthRequired') }]}>
                <InputNumber min={1} max={31} style={{ width: '100%' }} placeholder={t('schedulerPanel.dayOfMonthPlaceholder')} />
              </Form.Item>
            ) : (
              <Form.Item name="days" label={t('schedulerPanel.weekDaysLabel')} rules={[{ required: true, message: t('schedulerPanel.weekDaysRequired') }]}>
                <Select mode="multiple" options={DAY_OPTIONS} placeholder={t('schedulerPanel.weekDaysPlaceholder')} />
              </Form.Item>
            )}

            <Form.Item name="dateRange" label={t('schedulerPanel.dateRangeLabel')}>
              <DatePicker.RangePicker style={{ width: '100%' }} format="DD/MM/YYYY" placeholder={[t('schedulerPanel.dateRangeStart'), t('schedulerPanel.dateRangeEnd')]} />
            </Form.Item>

            <Form.Item name="label" label={t('schedulerPanel.nameLabel')} rules={[{ required: true, message: t('schedulerPanel.nameRequired') }]}>
              <Input placeholder={t('schedulerPanel.namePlaceholder')} />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0, marginTop: 24 }}>
              <Space>
                <Button htmlType="submit" type="primary" loading={creating}>
                  {editingSchedule ? t('schedulerPanel.saveChanges') : t('schedulerPanel.addSchedule')}
                </Button>
                <Button onClick={() => { setShowAdd(false); setEditingSchedule(null); }}>
                  {t('common.cancel')}
                </Button>
              </Space>
            </Form.Item>
          </Form>
      )}
    </Drawer>
  )
}
