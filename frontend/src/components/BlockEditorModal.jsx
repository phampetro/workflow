import React, { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { getWorkflowFiles, getWorkflowOutputFiles, getFileColumns, getFileColumnValues, getListenerStatus, streamAiCodegen, getDatabaseTables, getDatabaseColumns, getDbConnections, getGoogleSheetsColumns, startBrowserRecording, stopBrowserRecording, createRecordingStream } from '../api/client'
import { Code2, Info, Box, Mail, TableProperties, Database, MessageCircle, Globe, Plus, Trash2, GripVertical, Paperclip, Radio as RadioIcon, Sparkles, Send, Check, X, Square, Terminal, RefreshCw, FileSpreadsheet, Circle, Video, ShieldAlert } from 'lucide-react'
import { Drawer, Form, Input, InputNumber, Button, Space, Typography, Tag, Divider, Select, AutoComplete, Radio, Switch, Table, Tooltip, Alert, Row, Col } from 'antd'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import useStore from '../store/useStore'
import { BLOCK_TYPES } from './BlockNode'

const { Text, Title } = Typography

const FileSelectionTable = ({ value = [], onChange, files = [], loading = false }) => {
  const { t } = useTranslation()
  return (
    <Table
      size="small"
      rowKey="name"
      columns={[{ title: t('blockEditor.fileSelectTableCol'), dataIndex: 'name' }]}
      dataSource={files}
      pagination={false}
      loading={loading}
      scroll={{ y: 200 }}
      rowSelection={{
        selectedRowKeys: value,
        onChange: (selectedRowKeys) => onChange(selectedRowKeys),
        preserveSelectedRowKeys: true,
      }}
      onRow={(record) => ({
        onClick: () => {
          const isSelected = value.includes(record.name)
          const newKeys = isSelected 
            ? value.filter(k => k !== record.name)
            : [...value, record.name]
          onChange(newKeys)
        },
        style: { cursor: 'pointer' }
      })}
      style={{ border: '1px solid var(--border-default)', borderRadius: 6, width: '100%' }}
    />
  )
}

const BLOCK_TEMPLATES = {
  python: {
    default: `# Block: Python Script
# Biến 'input_data' chứa output từ block trước
# Gán kết quả vào biến 'output_data'

import json

# === Code của bạn ===
output_data = input_data
print("Block hoàn thành!")
`,
    http: `import requests

url = "https://api.example.com/data"
response = requests.get(url, timeout=30)
response.raise_for_status()

output_data = response.json()
print(f"✓ Fetched {len(output_data)} items")
`,
    pandas: `import pandas as pd

df = pd.DataFrame(input_data)
df = df.dropna()
df = df.reset_index(drop=True)

output_data = df.to_dict(orient='records')
print(f"✓ Processed {len(output_data)} rows")
`,
    sql: `import sqlite3
import json

conn = sqlite3.connect("data.db")
cursor = conn.cursor()

cursor.execute("SELECT * FROM table_name LIMIT 100")
rows = cursor.fetchall()
columns = [desc[0] for desc in cursor.description]

output_data = [dict(zip(columns, row)) for row in rows]
conn.close()
print(f"✓ Queried {len(output_data)} rows")
`,
  }
}

const getTemplateOptions = (t) => [
  { key: 'default', label: t('blockEditor.templateDefault') },
  { key: 'http', label: 'HTTP Request' },
  { key: 'pandas', label: 'Pandas DataFrame' },
  { key: 'sql', label: 'SQLite Query' },
]

const DEFAULT_SQL_QUERY = `-- Nhập câu lệnh SQL của bạn tại đây
-- Kết quả trả về: {"file_name": "tên file Excel đã xuất"}
SELECT * FROM my_table;
`

// Tên biến phải khớp cú pháp {{ten_bien}} của backend (regex \w+) và dùng được
// làm key trong code Python (input_data['ten_bien']) → không cho khoảng trắng,
// dấu câu, chữ có dấu, và không bắt đầu bằng số.
const VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const getVarNameRule = (t) => ({
  validator: (_, value) => {
    if (!value) return Promise.resolve()
    if (VAR_NAME_PATTERN.test(String(value))) return Promise.resolve()
    return Promise.reject(new Error(t('blockEditor.varNameInvalid')))
  },
})

// Câu giải thích dùng chung cho mọi ô đặt tên biến output
const getVarNameHint = (t) =>
  `${t('blockEditor.varNameHintPrefix')} {{ten_bien}} ${t('blockEditor.varNameHintMiddle')} input_data['ten_bien'] ${t('blockEditor.varNameHintSuffix')}`

// ─── Action definitions ──────────────────────────────────────────────────────

const getBrowserActions = (t) => [
  { group: t('browserStep.groupNav'), actions: [
    { value: 'navigate',      label: t('browserStep.actionNavigate'),     params: ['url'], needsSelector: false },
    { value: 'go_back',       label: t('browserStep.actionGoBack'),       params: [], needsSelector: false },
    { value: 'go_forward',    label: t('browserStep.actionGoForward'),    params: [], needsSelector: false },
    { value: 'reload',        label: t('browserStep.actionReload'),       params: [], needsSelector: false },
    { value: 'wait_for_load', label: t('browserStep.actionWaitForLoad'),  params: [], needsSelector: false },
  ]},
  { group: t('browserStep.groupInteract'), actions: [
    { value: 'click',         label: t('browserStep.actionClick'),        params: [], needsSelector: true },
    { value: 'double_click',  label: t('browserStep.actionDoubleClick'),  params: [], needsSelector: true },
    { value: 'right_click',   label: t('browserStep.actionRightClick'),   params: [], needsSelector: true },
    { value: 'hover',         label: t('browserStep.actionHover'),        params: [], needsSelector: true },
    { value: 'scroll_to',     label: t('browserStep.actionScrollTo'),     params: [], needsSelector: true },
    { value: 'scroll_page',   label: t('browserStep.actionScrollPage'),   params: ['direction'], needsSelector: false },
  ]},
  { group: t('browserStep.groupInput'), actions: [
    { value: 'fill',          label: t('browserStep.actionFill'),         params: ['text'], needsSelector: true },
    { value: 'type_slowly',   label: t('browserStep.actionTypeSlowly'),   params: ['text'], needsSelector: true },
    { value: 'clear',         label: t('browserStep.actionClear'),        params: [], needsSelector: true },
    { value: 'press_key',     label: t('browserStep.actionPressKey'),     params: ['key'], needsSelector: true },
  ]},
  { group: t('browserStep.groupFormSelect'), actions: [
    { value: 'select_option', label: t('browserStep.actionSelectOption'), params: ['option'], needsSelector: true },
    { value: 'check',         label: t('browserStep.actionCheck'),        params: [], needsSelector: true },
    { value: 'uncheck',       label: t('browserStep.actionUncheck'),      params: [], needsSelector: true },
  ]},
  { group: t('browserStep.groupDownload'), actions: [
    { value: 'click_and_download', label: t('browserStep.actionClickAndDownload'), params: ['key_name'], needsSelector: true },
  ]},
  { group: t('browserStep.groupModalDialog'), actions: [
    { value: 'wait_for_selector', label: t('browserStep.actionWaitForSelector'), params: [], needsSelector: true },
    { value: 'accept_dialog', label: t('browserStep.actionAcceptDialog'), params: [], needsSelector: false },
    { value: 'dismiss_dialog',label: t('browserStep.actionDismissDialog'), params: [], needsSelector: false },
  ]},
  { group: t('browserStep.groupGetData'), actions: [
    { value: 'get_text',      label: t('browserStep.actionGetText'),      params: ['key_name'], needsSelector: true },
    { value: 'get_attribute', label: t('browserStep.actionGetAttribute'), params: ['attribute', 'key_name'], needsSelector: true },
    { value: 'get_all_text',  label: t('browserStep.actionGetAllText'),   params: ['key_name'], needsSelector: true },
    { value: 'get_url',       label: t('browserStep.actionGetUrl'),       params: ['key_name'], needsSelector: false },
    { value: 'screenshot',    label: t('browserStep.actionScreenshot'),   params: ['key_name'], needsSelector: false },
    { value: 'evaluate_js',   label: t('browserStep.actionEvaluateJs'),   params: ['js_code', 'key_name'], needsSelector: false },
  ]},
  { group: t('browserStep.groupWait'), actions: [
    { value: 'wait',          label: t('browserStep.actionWait'),         params: ['seconds'], needsSelector: false },
    { value: 'wait_for_url',  label: t('browserStep.actionWaitForUrl'),   params: ['url_pattern'], needsSelector: false },
  ]},
]

const SCROLL_DIR_OPTIONS = ['down', 'up', 'bottom', 'top']
const KEY_OPTIONS = ['Enter', 'Tab', 'Escape', 'Space', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F5']

const STEP_COLORS = {
  navigate: '#0ea5e9', go_back: '#0ea5e9', go_forward: '#0ea5e9', reload: '#0ea5e9', wait_for_load: '#0ea5e9',
  click: '#8b5cf6', double_click: '#8b5cf6', right_click: '#8b5cf6', hover: '#8b5cf6', scroll_to: '#8b5cf6', scroll_page: '#8b5cf6',
  fill: '#10b981', type_slowly: '#10b981', clear: '#10b981', press_key: '#10b981',
  select_option: '#f59e0b', check: '#f59e0b', uncheck: '#f59e0b',
  click_and_download: '#0ea5e9',
  wait_for_selector: '#ec4899', accept_dialog: '#ec4899', dismiss_dialog: '#ec4899',
  get_text: '#06b6d4', get_attribute: '#06b6d4', get_all_text: '#06b6d4', get_url: '#06b6d4', screenshot: '#06b6d4', evaluate_js: '#06b6d4',
  wait: '#f97316', wait_for_url: '#f97316',
}

const BrowserStepEditorPanel = ({ steps, onChange, workflowId }) => {
  const { t } = useTranslation()
  const BROWSER_ACTIONS = getBrowserActions(t)
  const ACTION_MAP = {}
  BROWSER_ACTIONS.forEach(g => g.actions.forEach(a => { ACTION_MAP[a.value] = a }))
  const [expandedIdx, setExpandedIdx] = useState(null)

  const dragItem = React.useRef(null)
  const dragOverItem = React.useRef(null)

  // ── Ghi thao tác (Recorder) ──
  const [recording, setRecording] = useState(false)
  const [starting, setStarting] = useState(false)
  const [showUrlPrompt, setShowUrlPrompt] = useState(false)
  const [recUrl, setRecUrl] = useState('')
  const [recCount, setRecCount] = useState(0)
  const stepsBeforeRef = React.useRef([])
  const liveRef = React.useRef([])
  const stopStreamRef = React.useRef(null)
  const recordingRef = React.useRef(false)

  const finishRecordingUI = () => {
    recordingRef.current = false
    setRecording(false)
    setStarting(false)
    if (stopStreamRef.current) { stopStreamRef.current(); stopStreamRef.current = null }
  }

  const applyLive = () => onChange([...stepsBeforeRef.current, ...liveRef.current])

  const beginRecording = async () => {
    if (!workflowId) { toast.error(t('browserStep.saveBeforeRecord')); return }
    let url = recUrl.trim()
    if (!url) { toast.error(t('browserStep.enterUrlToRecord')); return }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url

    setStarting(true)
    try {
      // Tạo phiên ghi trước (mở trình duyệt), rồi mới mở SSE để nhận step.
      await startBrowserRecording(workflowId, url)
      stepsBeforeRef.current = Array.isArray(steps) ? steps : []
      liveRef.current = []
      recordingRef.current = true
      setRecCount(0)
      setRecording(true)
      setShowUrlPrompt(false)
      stopStreamRef.current = createRecordingStream(workflowId, {
        onStep: (s) => { liveRef.current = [...liveRef.current, s]; setRecCount(liveRef.current.length); applyLive() },
        onReplaceLast: (s) => { liveRef.current = [...liveRef.current.slice(0, -1), s]; setRecCount(liveRef.current.length); applyLive() },
        onDone: (finalSteps) => {
          if (Array.isArray(finalSteps)) onChange([...stepsBeforeRef.current, ...finalSteps])
          finishRecordingUI()
          toast.success(t('browserStep.recordStoppedToast'))
        },
        onError: (e) => { toast.error(t('browserStep.recordErrorToast', { message: e.message })); finishRecordingUI() },
      })
      toast.success(t('browserStep.recordOpenedToast'))
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message || t('browserStep.recordOpenFailedToast'))
      finishRecordingUI()
    } finally {
      setStarting(false)
    }
  }

  const stopRecording = async () => {
    try { await stopBrowserRecording(workflowId) } catch (_) {}
    // onDone từ SSE sẽ dọn UI; phòng khi SSE lỗi, dọn sau 2s.
    setTimeout(() => { if (recordingRef.current) finishRecordingUI() }, 2500)
  }

  // Dọn dẹp khi đóng panel/modal: dừng phiên ghi nếu còn.
  useEffect(() => () => {
    if (recordingRef.current) {
      if (stopStreamRef.current) { try { stopStreamRef.current() } catch (_) {} }
      if (workflowId) stopBrowserRecording(workflowId).catch(() => {})
    }
  }, [])

  const addStep = () => {
    const newStep = { action: 'navigate', selector: '', value: '', key_name: 'result', note: '', continue_on_error: false }
    onChange([...steps, newStep])
    setExpandedIdx(steps.length)
  }

  const removeStep = (i) => {
    const newSteps = steps.filter((_, idx) => idx !== i)
    onChange(newSteps)
    if (expandedIdx === i) setExpandedIdx(null)
  }

  const updateStep = (i, field, val) => {
    const newSteps = steps.map((s, idx) => {
      if (idx !== i) return s
      const next = { ...s, [field]: val }
      // Sửa tay sang selector khác các selector dự phòng do recorder ghi (selectors[])
      // thì chuỗi dự phòng cũ không còn hợp lệ nữa — xoá để backend dùng đúng giá trị
      // vừa sửa (khớp với điều kiện ở browser_executor.py: chỉ dùng fallback nếu
      // selector hiện tại vẫn nằm trong danh sách đã ghi).
      if (field === 'selector' && Array.isArray(s.selectors) && !s.selectors.includes(val)) {
        delete next.selectors
      }
      return next
    })
    onChange(newSteps)
  }

  const handleDragStart = (e, index) => {
    dragItem.current = index
    e.dataTransfer.effectAllowed = 'move'
    // Ẩn nội dung khi đang kéo cho gọn
    if (expandedIdx === index) setExpandedIdx(null)
  }

  const handleDragEnter = (e, index) => {
    e.preventDefault()
    dragOverItem.current = index
  }

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return
    if (dragItem.current !== dragOverItem.current) {
      const newSteps = [...steps]
      const draggedContent = newSteps[dragItem.current]
      newSteps.splice(dragItem.current, 1)
      newSteps.splice(dragOverItem.current, 0, draggedContent)
      onChange(newSteps)
      setExpandedIdx(null)
    }
    dragItem.current = null
    dragOverItem.current = null
  }

  const inputStyle = { width: '100%', fontSize: '0.8rem', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'var(--bg-base)', color: 'var(--text-primary)', outline: 'none', fontFamily: 'var(--font-mono)' }
  const labelStyle = { fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 2, display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', overflow: 'hidden', minHeight: 0 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Globe size={16} color="#0ea5e9" />
          <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
            {t('browserStep.stepListTitle', { count: steps.length })}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {!recording ? (
            <button
              type="button"
              onClick={() => setShowUrlPrompt(v => !v)}
              disabled={starting}
              aria-label={t('browserStep.recordAria')}
              title={t('browserStep.recordTooltip')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border-default)', background: showUrlPrompt ? 'var(--bg-hover)' : 'var(--bg-surface)', color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.82rem', cursor: starting ? 'wait' : 'pointer', opacity: starting ? 0.6 : 1 }}
            >
              <Circle size={13} fill="#ef4444" color="#ef4444" /> {t('browserStep.recordBtn')}
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              aria-label={t('browserStep.stopRecordAria')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}
            >
              <Square size={13} fill="#fff" /> {t('browserStep.stopRecordBtn')}
            </button>
          )}
          <button
            type="button"
            onClick={addStep}
            aria-label={t('browserStep.addStepAria')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}
          >
            <Plus size={14} /> {t('browserStep.addStepBtn')}
          </button>
        </div>
      </div>

      {/* Ô nhập URL để bắt đầu ghi */}
      {showUrlPrompt && !recording && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder={t('browserStep.urlPromptPlaceholder')}
            value={recUrl}
            autoFocus
            onChange={e => setRecUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') beginRecording() }}
          />
          <button
            type="button"
            onClick={beginRecording}
            disabled={starting}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: starting ? 'wait' : 'pointer', whiteSpace: 'nowrap', opacity: starting ? 0.7 : 1 }}
          >
            <Video size={14} /> {starting ? t('browserStep.startingRecord') : t('browserStep.startRecordBtn')}
          </button>
        </div>
      )}

      {/* Banner khi đang ghi */}
      {recording && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: 'color-mix(in srgb, #ef4444 12%, transparent)', borderBottom: '1px solid #ef444455', flexShrink: 0 }}>
          <span className="pyflow-rec-dot" style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {t('browserStep.recordingBanner', { count: recCount })}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {t('browserStep.recordingHint')}
          </span>
        </div>
      )}

      {/* Steps list */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
            <Globe size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: '0.9rem', marginBottom: 6 }}>{t('browserStep.noStepsTitle')}</div>
            <div style={{ fontSize: '0.8rem' }}>{t('browserStep.noStepsHintPrefix')} <strong>+ {t('browserStep.addStepBtn')}</strong> {t('browserStep.noStepsHintSuffix')}</div>
          </div>
        )}

        {steps.map((step, i) => {
          const actionDef = ACTION_MAP[step.action] || {}
          const isExpanded = expandedIdx === i
          const accentColor = STEP_COLORS[step.action] || '#6c63ff'
          const actionLabel = actionDef.label || step.action

          return (
            <div 
              key={i} 
              draggable
              onDragStart={(e) => handleDragStart(e, i)}
              onDragEnter={(e) => handleDragEnter(e, i)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={handleDragEnd}
              style={{ flexShrink: 0, borderRadius: 10, border: `1px solid ${isExpanded ? accentColor : 'var(--border-default)'}`, background: 'var(--bg-surface)', overflow: 'hidden', transition: 'border-color 0.2s', boxShadow: isExpanded ? `0 0 0 2px ${accentColor}22` : 'none', cursor: isExpanded ? 'default' : 'grab' }}
            >
              {/* Step header */}
              <div
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', background: isExpanded ? `color-mix(in srgb, ${accentColor} 8%, transparent)` : 'transparent', userSelect: 'none' }}
                onClick={() => setExpandedIdx(isExpanded ? null : i)}
              >
                <div style={{ width: 20, height: 20, borderRadius: '50%', background: accentColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }}>{i + 1}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: accentColor }}>{actionLabel}</span>
                    {step.selector && <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.72rem', background: 'var(--bg-base)', padding: '1px 5px', borderRadius: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{step.selector}</span>}
                    {(step.value || (step.action === 'press_key' ? 'Enter' : '')) && <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>= "{step.value || (step.action === 'press_key' ? 'Enter' : '')}"</span>}
                  </div>
                  {step.note && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>{step.note}</div>}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeStep(i) }} style={{ width: 22, height: 22, border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }} title={t('browserStep.deleteStepAria')}><Trash2 size={12} /></button>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, cursor: 'grab', color: 'var(--text-muted)' }} title={t('browserStep.dragToReorder')}><GripVertical size={14} /></div>
                </div>
              </div>

              {/* Step body */}
              {isExpanded && (
                <div style={{ padding: '12px', borderTop: `1px solid ${accentColor}33`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Action type */}
                  <div>
                    <label style={labelStyle}>{t('browserStep.actionTypeLabel')}</label>
                    <select value={step.action} onChange={e => updateStep(i, 'action', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                      {BROWSER_ACTIONS.map(g => (
                        <optgroup key={g.group} label={g.group}>
                          {g.actions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  {/* Selector */}
                  {actionDef.needsSelector && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.selectorLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.selectorPlaceholder')} value={step.selector || ''} onChange={e => updateStep(i, 'selector', e.target.value)} />
                      {Array.isArray(step.selectors) && step.selectors.length > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: '0.7rem', color: 'var(--accent-success)' }} title={step.selectors.join('\n')}>
                          <ShieldAlert size={12} /> {t('browserStep.fallbackSelectors', { count: step.selectors.length })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Value / URL / Text */}
                  {['navigate', 'go_to', 'wait_for_url'].includes(step.action) && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.urlLabel')}</label>
                      <input style={inputStyle} placeholder="https://example.com" value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                    </div>
                  )}

                  {['fill', 'type_slowly'].includes(step.action) && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.fillContentLabel')} {'{{key}}'})</label>
                      <input style={inputStyle} placeholder={`${t('browserStep.fillPlaceholderPrefix')} {{username}}`} value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                      {step.is_password && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: '0.7rem', color: 'var(--accent-warning)' }}>
                          <ShieldAlert size={12} /> {t('browserStep.passwordFieldHint')} {'{{biến}}'}.
                        </div>
                      )}
                    </div>
                  )}

                  {step.action === 'press_key' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.keyLabel')}</label>
                      <select value={step.value || 'Enter'} onChange={e => updateStep(i, 'value', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        {KEY_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                  )}

                  {step.action === 'select_option' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.optionValueLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.optionValuePlaceholder')} value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                    </div>
                  )}

                  {step.action === 'scroll_page' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.scrollDirLabel')}</label>
                      <select value={step.value || 'down'} onChange={e => updateStep(i, 'value', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        {SCROLL_DIR_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        <option value="500">500px</option>
                        <option value="1000">1000px</option>
                      </select>
                    </div>
                  )}

                  {step.action === 'wait' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.waitSecondsLabel')}</label>
                      <input type="number" style={inputStyle} placeholder="VD: 2" value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} min="0.1" step="0.5" />
                    </div>
                  )}

                  {step.action === 'wait_for_selector' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.waitForLabel')}</label>
                      <select value={step.state || 'visible'} onChange={e => updateStep(i, 'state', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="visible">{t('browserStep.stateVisible')}</option>
                        <option value="hidden">{t('browserStep.stateHidden')}</option>
                        <option value="attached">{t('browserStep.stateAttached')}</option>
                        <option value="detached">{t('browserStep.stateDetached')}</option>
                      </select>
                    </div>
                  )}

                  {step.action === 'get_attribute' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.attributeNameLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.attributePlaceholder')} value={step.attribute || ''} onChange={e => updateStep(i, 'attribute', e.target.value)} />
                    </div>
                  )}

                  {step.action === 'evaluate_js' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.jsExprLabel')}</label>
                      <textarea style={{ ...inputStyle, height: 64, resize: 'vertical', fontFamily: 'monospace' }} placeholder={t('browserStep.jsExprPlaceholder')} value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                    </div>
                  )}

                  {step.action === 'click_and_download' && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.downloadFileNameLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.downloadFileNamePlaceholder')} value={step.file_name || ''} onChange={e => updateStep(i, 'file_name', e.target.value)} />
                    </div>
                  )}

                  {/* Key name for data collection */}
                  {['get_text', 'get_attribute', 'get_all_text', 'get_url', 'screenshot', 'evaluate_js', 'click_and_download'].includes(step.action) && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.keyNameLabel')}</label>
                      <input style={inputStyle} placeholder={t('browserStep.keyNamePlaceholder')} value={step.key_name || 'result'} onChange={e => updateStep(i, 'key_name', e.target.value)} />
                    </div>
                  )}

                  {/* Timeout */}
                  {actionDef.needsSelector && (
                    <div>
                      <label style={labelStyle}>{t('browserStep.timeoutLabel')}</label>
                      <input type="number" style={inputStyle} placeholder="20000" value={step.timeout || ''} onChange={e => updateStep(i, 'timeout', e.target.value)} min="1000" step="1000" />
                    </div>
                  )}

                  {/* Note */}
                  <div>
                    <label style={labelStyle}>{t('browserStep.noteLabel')}</label>
                    <input style={inputStyle} placeholder={t('browserStep.notePlaceholder')} value={step.note || ''} onChange={e => updateStep(i, 'note', e.target.value)} />
                  </div>

                  {/* Continue on error */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" id={`coe-${i}`} checked={step.continue_on_error || false} onChange={e => updateStep(i, 'continue_on_error', e.target.checked)} style={{ cursor: 'pointer' }} />
                    <label htmlFor={`coe-${i}`} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>{t('browserStep.continueOnError')}</label>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer hint */}
      <Alert title={<span>{t('browserStep.footerHintPrefix')} <Text code>{'{{key}}'}</Text> {t('browserStep.footerHintSuffix')} <Text code>input_data</Text></span>}
        type="info"
        showIcon
        style={{ margin: '8px 16px', borderRadius: 8 }}
      />
    </div>
  )
}

const PositionSelector = ({ value, onChange }) => {
  const { t } = useTranslation()
  const btnStyle = (pos) => ({
    width: 48,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    background: value === pos ? 'var(--accent-primary)' : 'transparent',
    color: value === pos ? '#fff' : 'var(--text-secondary)',
    border: `1px solid ${value === pos ? 'var(--accent-primary)' : 'var(--border-default)'}`,
    borderRadius: 6,
    transition: 'all 0.2s',
    fontSize: '0.75rem',
    userSelect: 'none'
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '48px 48px 48px', gridTemplateRows: '28px 28px 28px', gap: '4px' }}>
      <div style={{ gridColumn: 2, gridRow: 1 }} onClick={() => onChange('top')}>
        <div style={btnStyle('top')}>{t('browserStep.posTop')}</div>
      </div>
      <div style={{ gridColumn: 1, gridRow: 2 }} onClick={() => onChange('left')}>
        <div style={btnStyle('left')}>{t('browserStep.posLeft')}</div>
      </div>
      <div style={{ gridColumn: 3, gridRow: 2 }} onClick={() => onChange('right')}>
        <div style={btnStyle('right')}>{t('browserStep.posRight')}</div>
      </div>
      <div style={{ gridColumn: 2, gridRow: 3 }} onClick={() => onChange('bottom')}>
        <div style={btnStyle('bottom')}>{t('browserStep.posBottom')}</div>
      </div>
    </div>
  );
};

export default function BlockEditorModal({ node, open, onClose, onSave, onUpdate, inputKeys = [], workflowId, projectId }) {
  const { t } = useTranslation()
  const VAR_NAME_RULE = getVarNameRule(t)
  const VAR_NAME_HINT = getVarNameHint(t)
  const theme = useStore(state => state.theme)
  const [form] = Form.useForm()
  const [code, setCode] = useState(node.data.code || BLOCK_TEMPLATES.python.default)
  const [sqlCode, setSqlCode] = useState(node.data.sqlQuery || DEFAULT_SQL_QUERY)
  const [activeTemplate, setActiveTemplate] = useState('default')
  
  const [availableFiles, setAvailableFiles] = useState([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  // Merge Excel: 3 chế độ chọn nguồn file — 'all_input' | 'all_output' | 'custom'
  const [mergeMode, setMergeMode] = useState(
    node.data.mergeMode || (node.data.mergeAllInput === false ? 'custom' : 'all_input')
  )
  const [telegramFiles, setTelegramFiles] = useState([])
  const [loadingTelegramFiles, setLoadingTelegramFiles] = useState(false)
  const [listenerCommands, setListenerCommands] = useState(node.data.telegramListenerCommands || [{ command: '/hi', description: 'Gửi lời chào', reply: 'Xin chào! 👋', runWorkflow: false }])
  const [inputFields, setInputFields] = useState(node.data.inputFields || [{ name: 'bien_1', label: 'Nhập giá trị', type: 'text', required: true, defaultValue: '' }])
  const [listenerRunning, setListenerRunning] = useState(false)
  const dragCmdItem = React.useRef(null)
  const dragCmdOverItem = React.useRef(null)

  const handleCmdDragStart = (e, index) => {
    dragCmdItem.current = index
    e.dataTransfer.effectAllowed = 'move'
  }
  const handleCmdDragEnter = (e, index) => {
    e.preventDefault()
    dragCmdOverItem.current = index
  }
  const handleCmdDragEnd = () => {
    if (dragCmdItem.current === null || dragCmdOverItem.current === null) return
    if (dragCmdItem.current !== dragCmdOverItem.current) {
      const reordered = [...listenerCommands]
      const [dragged] = reordered.splice(dragCmdItem.current, 1)
      reordered.splice(dragCmdOverItem.current, 0, dragged)
      setListenerCommands(reordered)
    }
    dragCmdItem.current = null
    dragCmdOverItem.current = null
  }

  const telegramParseMode = Form.useWatch('telegramParseMode', form)
  const telegramAction = Form.useWatch('telegramAction', form)
  const pivotInputFiles = Form.useWatch('pivotInputFiles', form)
  const pivotInputFile = pivotInputFiles?.[0] || ''
  const pivotHeaderRow = Form.useWatch('pivotHeaderRow', form)
  const pivotEnableSort = Form.useWatch('pivotEnableSort', form)
  const pivotSortColumn = Form.useWatch('pivotSortColumn', form)
  const pivotSortOrder = Form.useWatch('pivotSortOrder', form)
  
  const pivotIndex = Form.useWatch('pivotIndex', form) || []
  const pivotColumns = Form.useWatch('pivotColumns', form) || []
  const loopMode = Form.useWatch('loopMode', form)
  const sortableColumns = [...new Set([...pivotColumns])]
  
  const [availableColumns, setAvailableColumns] = useState([])
  const [columnError, setColumnError] = useState('')
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [customSortValues, setCustomSortValues] = useState([])
  const [loadingCustomSort, setLoadingCustomSort] = useState(false)

  const isPython = node.data.type === 'python'
  const isCondition = node.data.type === 'condition'
  const isDelay = node.data.type === 'delay'
  const isQueue = node.data.type === 'queue'
  const isLoop = node.data.type === 'loop'
  const isEnd = node.data.type === 'end'
  const isErrorTrigger = node.data.type === 'error_trigger'
  const isTelegram = node.data.type === 'telegram'
  const isTelegramListener = node.data.type === 'telegram_listener'
  const isEmail = node.data.type === 'email'
  const isSqlToExcel = node.data.type === 'sql_to_excel'
  const isMergeExcel = node.data.type === 'merge_excel'
  const isPivotExcel = node.data.type === 'pivot_excel'
  const isBrowser = node.data.type === 'browser'
  const isDeleteFiles = node.data.type === 'delete_files'
  const isExcelToSql = node.data.type === 'excel_to_sql'
  const isRunSqlExec = node.data.type === 'run_sql_exec'
  const isGoogleSheets = node.data.type === 'google_sheets_read'
  const isExcelRead = node.data.type === 'excel_read'
  const isInputVars = node.data.type === 'input_vars'
  const hasOutputVarField = isSqlToExcel || isMergeExcel || isPivotExcel

  // Excel to SQL states
  const [dbTables, setDbTables] = useState([])
  const [dbColumns, setDbColumns] = useState([])
  const [excelColumns, setExcelColumns] = useState([])
  const [loadingSchema, setLoadingSchema] = useState(false)
  const [excelToSqlMapping, setExcelToSqlMapping] = useState(node.data.excelToSqlMapping || {})

  // Danh sách kết nối Database đã lưu (dùng chung cho sql_to_excel/excel_to_sql/run_sql_exec)
  const [dbConnections, setDbConnections] = useState([])
  const [loadingDbConnections, setLoadingDbConnections] = useState(false)

  const excelToSqlInputFile = Form.useWatch('excelToSqlInputFile', form)
  const excelToSqlHeaderRow = Form.useWatch('excelToSqlHeaderRow', form)
  const excelToSqlSavedConnectionId = Form.useWatch('excelToSqlSavedConnectionId', form)
  const excelToSqlTableName = Form.useWatch('excelToSqlTableName', form)

  // Browser steps state
  const [browserSteps, setBrowserSteps] = useState(node.data.steps || [])
  const [expandedStep, setExpandedStep] = useState(null)

  // Google Sheets state
  const [googleSheetsCols, setGoogleSheetsCols] = useState(node.data.googleSheetsCols || [])
  const [googleSheetsMappings, setGoogleSheetsMappings] = useState(node.data.columnMappings || {})
  const [loadingGoogleSheetsCols, setLoadingGoogleSheetsCols] = useState(false)

  // Excel Read state
  const [excelReadCols, setExcelReadCols] = useState(node.data.excelReadCols || [])
  const [excelReadMappings, setExcelReadMappings] = useState(node.data.columnMappings || {})
  const [loadingExcelReadCols, setLoadingExcelReadCols] = useState(false)

  const handleFetchExcelReadColumns = async () => {
    const file = form.getFieldValue('excelReadFile')
    const header_row = form.getFieldValue('excelReadHeaderRow') || 1
    if (!file) {
      toast.error(t('blockEditor.selectExcelFileFirst'))
      return
    }
    if (file.includes('{{')) {
      toast.error(`${t('blockEditor.cannotLoadColsWithVarPrefix')} {{...}} ${t('blockEditor.cannotLoadColsWithVarSuffix')}`)
      return
    }
    setLoadingExcelReadCols(true)
    try {
      // API nhận header_row theo pandas (0-indexed), user nhập theo Excel (1-indexed) → trừ 1
      const backendHeader = String(Math.max(0, (parseInt(header_row, 10) || 1) - 1))
      const res = await getFileColumns(workflowId, file, backendHeader)
      const cols = (res.data?.columns || []).map(c => String(c))
      setExcelReadCols(cols)
      toast.success(t('blockEditor.foundColumnsCount', { count: cols.length }))
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message)
    } finally {
      setLoadingExcelReadCols(false)
    }
  }

  const handleFetchGoogleSheetsColumns = async () => {
    const url = form.getFieldValue('googleSheetsUrl')
    const sheet_name = form.getFieldValue('googleSheetsSheetName')
    const header_row = form.getFieldValue('googleSheetsHeaderRow') || 1
    if (!url) {
      toast.error(t('blockEditor.enterGoogleSheetLink'))
      return
    }
    setLoadingGoogleSheetsCols(true)
    try {
      const res = await getGoogleSheetsColumns({ url, sheet_name, header_row })
      const cols = res.data?.columns || []
      setGoogleSheetsCols(cols)
      toast.success(t('blockEditor.foundColumnsCount', { count: cols.length }))
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message)
    } finally {
      setLoadingGoogleSheetsCols(false)
    }
  }

  // AI Assistant states
  const [aiPromptVisible, setAiPromptVisible] = useState(false)
  const [aiPromptPosition, setAiPromptPosition] = useState({ top: 0, left: 0 })
  const [aiInstruction, setAiInstruction] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiGeneratedCode, setAiGeneratedCode] = useState('')
  const [aiSelection, setAiSelection] = useState(null)
  
  const editorRef = React.useRef(null)
  const monacoRef = React.useRef(null)
  const aiCancelFn = React.useRef(null)

  const handleAiPromptOpen = () => {
    if (!editorRef.current || !monacoRef.current) return;
    const editor = editorRef.current;
    
    const position = editor.getPosition();
    const selection = editor.getSelection();
    
    if (!selection.isEmpty()) {
      setAiSelection(selection);
    } else {
      setAiSelection(null);
    }

    const scrolledPos = editor.getScrolledVisiblePosition(position);
    if (scrolledPos) {
      setAiPromptPosition({
        top: Math.min(scrolledPos.top + 30, window.innerHeight - 200),
        left: Math.min(scrolledPos.left + 20, window.innerWidth - 400)
      });
    }

    setAiInstruction('');
    setAiGeneratedCode('');
    setAiPromptVisible(true);
  };

  const closeAiPrompt = () => {
    setAiPromptVisible(false);
    setAiInstruction('');
    setAiGeneratedCode('');
    setAiSelection(null);
    if (aiCancelFn.current) {
      aiCancelFn.current();
      aiCancelFn.current = null;
    }
    setAiGenerating(false);
    if (editorRef.current) editorRef.current.focus();
  };

  const handleAiSubmit = async () => {
    if (!aiInstruction.trim() || aiGenerating) return;
    
    const editor = editorRef.current;
    if (!editor) return;

    let selectedText = '';
    if (aiSelection) {
      selectedText = editor.getModel().getValueInRange(aiSelection);
    }

    setAiGenerating(true);
    setAiGeneratedCode('');

    try {
      const cancel = streamAiCodegen({
        instruction: aiInstruction,
        code: editorRef.current ? editorRef.current.getValue() : (isPython ? code : sqlCode),
        selection: selectedText,
        language: isPython ? 'python' : 'sql'
      }, {
        onToken: (token) => {
          setAiGeneratedCode(prev => prev + token);
        },
        onDone: () => {
          setAiGenerating(false);
          aiCancelFn.current = null;
        },
        onError: (err) => {
          toast.error(t('blockEditor.aiError', { message: err.message }));
          setAiGenerating(false);
          aiCancelFn.current = null;
        }
      });
      aiCancelFn.current = cancel;
    } catch (err) {
      setAiGenerating(false);
    }
  };

  const acceptAiCode = () => {
    if (!aiGeneratedCode) return;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    let range;
    if (aiSelection) {
      range = aiSelection;
    } else {
      const pos = editor.getPosition();
      range = new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
    }

    editor.executeEdits("ai-assistant", [{
      range: range,
      text: aiGeneratedCode,
      forceMoveMarkers: true
    }]);

    if (isPython) {
      setCode(editor.getValue());
    } else {
      setSqlCode(editor.getValue());
    }
    
    closeAiPrompt();
  };

  const handleAiKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeAiPrompt();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (aiGeneratedCode && !aiGenerating) {
        acceptAiCode();
      } else if (!aiGenerating && aiInstruction.trim()) {
        handleAiSubmit();
      }
    }
  };

  const hasCodeEditor = isPython || isSqlToExcel
  const hasRightPanel = hasCodeEditor || isEmail || isPivotExcel || isMergeExcel || isTelegram || isTelegramListener || isBrowser || isExcelToSql || isRunSqlExec

  const autoCompleteOptions = inputKeys.map(k => ({ value: k }))

  useEffect(() => {
    if ((isMergeExcel || isEmail || isPivotExcel || isExcelToSql || isExcelRead) && open && workflowId) {
      const fetchFiles = async () => {
        setLoadingFiles(true)
        try {
          const [inRes, outRes] = await Promise.all([
            getWorkflowFiles(workflowId).catch(() => ({ data: [] })),
            getWorkflowOutputFiles(workflowId).catch(() => ({ data: [] }))
          ])
          let files = [...(inRes.data || []), ...(outRes.data || [])]
          if (isMergeExcel || isPivotExcel || isExcelToSql || isExcelRead) {
            files = files.filter(f => f.name.endsWith('.xlsx') || f.name.endsWith('.csv'))
          }
          setAvailableFiles(files)
        } catch (e) {
          console.error(e)
        } finally {
          setLoadingFiles(false)
        }
      }
      fetchFiles()
    }
  }, [isMergeExcel, isEmail, isPivotExcel, isExcelToSql, isExcelRead, open, workflowId])

  // Fetch danh sách kết nối Database đã lưu (cho các khối cần chọn kết nối)
  useEffect(() => {
    if ((isSqlToExcel || isExcelToSql || isRunSqlExec) && open && workflowId) {
      setLoadingDbConnections(true)
      getDbConnections(workflowId)
        .then(res => setDbConnections(res.data || []))
        .catch(() => setDbConnections([]))
        .finally(() => setLoadingDbConnections(false))
    }
  }, [isSqlToExcel, isExcelToSql, isRunSqlExec, open, workflowId])

  // Reset form & đồng bộ dữ liệu khi mở modal hoặc đổi node
  useEffect(() => {
    if (open) {
      form.resetFields()
      setGoogleSheetsCols(node.data.googleSheetsCols || [])
      setGoogleSheetsMappings(node.data.columnMappings || {})
      setExcelReadCols(node.data.excelReadCols || [])
      setExcelReadMappings(node.data.columnMappings || {})
    }
  }, [open, node.id])

  // Fetch output files cho Telegram attachment
  useEffect(() => {
    if (isTelegram && open && workflowId) {
      const fetchTelegramFiles = async () => {
        setLoadingTelegramFiles(true)
        try {
          const res = await getWorkflowOutputFiles(workflowId)
          setTelegramFiles(res.data || [])
        } catch (e) {
          console.error(e)
        } finally {
          setLoadingTelegramFiles(false)
        }
      }
      fetchTelegramFiles()
    }
  }, [isTelegram, open, workflowId])

  // Đồng bộ nội dung code cho Editor khi đổi block
  useEffect(() => {
    if (open) {
      const initialCode = node.data.code || BLOCK_TEMPLATES.python.default
      const initialSql = node.data.sqlQuery || DEFAULT_SQL_QUERY
      setCode(initialCode)
      setSqlCode(initialSql)
      if (editorRef.current) {
        editorRef.current.setValue(isPython ? initialCode : initialSql)
      }
    }
  }, [open, node.id, isPython])

  // Fetch + poll listener status mỗi 5s
  useEffect(() => {
    if (!isTelegramListener || !open || !workflowId) return

    const fetchStatus = () => {
      getListenerStatus(workflowId).then(res => {
        setListenerRunning(res.data?.status === 'running')
      }).catch(() => {})
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [isTelegramListener, open, workflowId])

  useEffect(() => {
    if (isPivotExcel && open && workflowId && pivotInputFile) {
      const fetchColumns = async () => {
        setLoadingColumns(true)
        setColumnError('')
        try {
          const res = await getFileColumns(workflowId, pivotInputFile, pivotHeaderRow || 1)
          if (Array.isArray(res.data?.columns)) {
            const cols = res.data.columns
            setAvailableColumns(cols)
            
            // Auto clear invalid fields
            const currentIdx = form.getFieldValue('pivotIndex') || []
            const currentCol = form.getFieldValue('pivotColumns') || []
            const currentVal = form.getFieldValue('pivotValues') || []
            const currentSortCol = form.getFieldValue('pivotSortColumn')
            
            const newIdx = currentIdx.filter(c => cols.includes(c))
            const newCol = currentCol.filter(c => cols.includes(c))
            const newVal = currentVal.filter(c => cols.includes(c))
            
            const updates = {}
            if (newIdx.length !== currentIdx.length) updates.pivotIndex = newIdx
            if (newCol.length !== currentCol.length) updates.pivotColumns = newCol
            if (newVal.length !== currentVal.length) updates.pivotValues = newVal
            
            if (currentSortCol && (!cols.includes(currentSortCol) || !newCol.includes(currentSortCol))) {
              updates.pivotSortColumn = undefined
              updates.pivotSortCustom = []
            }
            
            if (Object.keys(updates).length > 0) {
              form.setFieldsValue(updates)
            }
          } else {
            setColumnError(t('blockEditor.noColumnsFound'))
            setAvailableColumns([])
          }
        } catch (e) {
          setColumnError(t('blockEditor.fileNotExistManualCol'))
          setAvailableColumns([])
        } finally {
          setLoadingColumns(false)
        }
      }
      
      const timer = setTimeout(() => { fetchColumns() }, 300)
      return () => clearTimeout(timer)
    } else {
      setAvailableColumns([])
      setColumnError('')
    }
  }, [isPivotExcel, open, workflowId, pivotInputFile, pivotHeaderRow])

  useEffect(() => {
    if (isPivotExcel && open && workflowId && pivotEnableSort && pivotSortColumn && pivotSortOrder === 'custom' && pivotInputFile) {
      const fetchCustomSortValues = async () => {
        setLoadingCustomSort(true)
        try {
          const res = await getFileColumnValues(workflowId, pivotInputFile, pivotSortColumn, pivotHeaderRow || 1)
          if (Array.isArray(res.data?.values)) {
            setCustomSortValues(res.data.values)
            // Cập nhật giá trị vào form nếu đang trống
            const currentCustom = form.getFieldValue('pivotSortCustom')
            if (!currentCustom || currentCustom.length === 0) {
              form.setFieldsValue({ pivotSortCustom: res.data.values })
            }
          }
        } catch (e) {
          console.error(e)
        } finally {
          setLoadingCustomSort(false)
        }
      }
      const timer = setTimeout(() => { fetchCustomSortValues() }, 300)
      return () => clearTimeout(timer)
    } else {
      setCustomSortValues([])
    }
  }, [isPivotExcel, open, workflowId, pivotEnableSort, pivotSortColumn, pivotSortOrder, pivotInputFile, pivotHeaderRow])


  const getSelectedDbConfig = (connectionId) => {
    const conn = dbConnections.find(c => c.id === connectionId);
    if (!conn) {
      throw new Error(t('blockEditor.selectDbConnection'));
    }
    return {
      project_id: projectId,
      db_type: conn.db_type,
      server: conn.host,
      port: conn.port,
      dbname: conn.dbname,
      username: conn.username,
      password: conn.password,
    };
  };

  const renderDbConnectionField = (fieldName) => (
    <Form.Item name={fieldName} label={t('blockEditor.dbConnectionLabel')} rules={[{ required: true, message: t('blockEditor.dbConnectionRequired') }]} style={{ marginBottom: 16 }}>
      <Select
        loading={loadingDbConnections}
        placeholder={t('blockEditor.dbConnectionPlaceholder')}
        options={dbConnections.map(c => ({ value: c.id, label: c.label }))}
        notFoundContent={loadingDbConnections ? t('blockEditor.dbConnectionLoading') : t('blockEditor.dbConnectionEmpty')}
      />
    </Form.Item>
  );

  const renderVarNameField = (fieldName, label, tooltip, placeholder, style) => (
    <Form.Item
      name={fieldName}
      rules={[VAR_NAME_RULE]}
      label={
        <Space size={4}>
          {label}
          <Tooltip title={`${tooltip} ${VAR_NAME_HINT}`}>
            <Info size={14} style={{ cursor: 'help', color: 'var(--text-muted)' }} />
          </Tooltip>
        </Space>
      }
      style={style}
    >
      <Input placeholder={placeholder} />
    </Form.Item>
  );

  const fetchDbTables = async () => {
    if (!workflowId) return;
    setLoadingSchema(true);
    try {
      const dbConfig = getSelectedDbConfig(excelToSqlSavedConnectionId);
      const res = await getDatabaseTables(dbConfig);
      setDbTables(res.data?.tables || []);
      toast.success(t('blockEditor.dbConnectTestSuccess'));
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setLoadingSchema(false);
    }
  }

  const fetchDbColumns = async () => {
    if (!workflowId || !excelToSqlTableName) {
      toast.error(t('blockEditor.enterOrSelectTargetTable'));
      return;
    }
    setLoadingSchema(true);
    try {
      const dbConfig = getSelectedDbConfig(excelToSqlSavedConnectionId);

      const colRes = await getDatabaseColumns({ config: dbConfig, table_name: excelToSqlTableName });
      const cols = colRes.data?.columns || [];
      setDbColumns(cols);
      
      let excCols = [];
      if (excelToSqlInputFile) {
        try {
          // API nhận header_row theo pandas (0-indexed), user nhập theo Excel (1-indexed) → trừ 1
          const headerRowStr = String(excelToSqlHeaderRow || '1');
          const headerParts = headerRowStr.replace(/-/g, ',').split(',').map(s => {
            const val = parseInt(s.trim(), 10) - 1;
            return isNaN(val) ? -1 : val;
          }).filter(n => n >= 0);
          const backendHeader = headerParts.length > 0 ? headerParts.join(',') : '0';
          const excRes = await getFileColumns(workflowId, excelToSqlInputFile, backendHeader);
          excCols = excRes.data?.columns || [];
          setExcelColumns(excCols);
        } catch(e) {
           toast.error(t('blockEditor.readExcelError', { message: e.message }));
        }
      }
      
      setExcelToSqlMapping(prev => {
        const newMap = { ...prev };
        cols.forEach(c => {
          if (newMap[c.name] === undefined) {
             newMap[c.name] = null;
          }
        });
        return newMap;
      });
      
      toast.success(t('blockEditor.loadedSchemaSuccess'));
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setLoadingSchema(false);
    }
  }

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      onSave(node.id, {
        ...values,
        ...(isGoogleSheets ? { googleSheetsCols, columnMappings: googleSheetsMappings } : {}),
        ...(isExcelRead ? { excelReadCols, columnMappings: excelReadMappings } : {}),
        ...(isPython ? { code: editorRef.current ? editorRef.current.getValue() : code } : {}),
        ...(isSqlToExcel ? { sqlQuery: editorRef.current ? editorRef.current.getValue() : sqlCode } : {}),
        ...(isMergeExcel ? { mergeMode } : {}),
        ...(isBrowser ? { steps: browserSteps } : {}),
        ...(isTelegramListener ? { telegramListenerCommands: listenerCommands } : {}),
        ...(isInputVars ? { inputFields } : {}),
        ...(isExcelToSql ? { excelToSqlMapping } : {}),
        ...(isEmail ? {
          mailTo: (values.mailTo || []).join(','),
          mailCc: (values.mailCc || []).join(','),
        } : {}),
      })
      toast.success(t('blockEditor.saveBlockSuccess'))
    } catch (e) {
      // validation error already surfaced via form fields
    }
  }

  // Helpers cho danh sách biến của khối "Biến đầu vào"
  const updateInputField = (idx, key, val) =>
    setInputFields(prev => prev.map((f, i) => i === idx ? { ...f, [key]: val } : f))
  const removeInputField = (idx) =>
    setInputFields(prev => prev.filter((_, i) => i !== idx))
  const addInputField = () =>
    setInputFields(prev => [...prev, { name: `bien_${prev.length + 1}`, label: '', type: 'text', required: false, defaultValue: '' }])

  const applyTemplate = (key) => {
    const newCode = BLOCK_TEMPLATES.python[key];
    if (editorRef.current) {
      editorRef.current.setValue(newCode);
    }
    setCode(newCode);
    setActiveTemplate(key);
  }

  const getDrawerWidth = () => {
    const type = node.data.type
    // Mẫu 1: 1/3 màn hình
    if (['start', 'end', 'condition', 'delay', 'delete_files', 'error_trigger', 'queue'].includes(type)) return '33vw'
    // Mẫu 2: 1/2 màn hình
    if (['run_sql_exec', 'loop', 'google_sheets_read', 'excel_read', 'input_vars'].includes(type)) return '50vw'
    // Mẫu 3: 3/4 màn hình
    return '75vw'
  }

  const drawerWidthStr = getDrawerWidth()
  const leftPanelWidth = hasRightPanel ? (drawerWidthStr === '50vw' ? '50%' : '33.333%') : '100%'

  return (
    <Drawer
      title={<Space>{isBrowser ? <Globe size="1.125rem" color="#0ea5e9" /> : <Code2 size="1.125rem" color="var(--accent-primary)" />} {t('blockEditor.editBlockTitle')}</Space>}
      size={drawerWidthStr}
      onClose={onClose}
      open={true}
      mask={{ closable: false }}
      keyboard={false}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" onClick={handleSave}>{t('common.save')}</Button>
        </Space>
      }
      styles={{ body: { padding: 0, display: 'flex', overflow: 'hidden' } }}
    >
      {/* Settings Panel */}
      <Form
        form={form}
        layout="vertical"
        autoComplete="off"
        style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%', height: '100%', background: 'var(--bg-base)' }}
        initialValues={{
            label: node.data.label || '',
            description: node.data.description || '',
            outputVarName: node.data.outputVarName || (
              node.data.type === 'merge_excel' ? 'merged_excel'
              : (node.data.type === 'pivot_excel' || node.data.type === 'sql_to_excel') ? 'file_name'
              : (node.data.type === 'google_sheets_read' || node.data.type === 'excel_read') ? 'sheets_data'
              : ''
            ),
            ...((node.data.type === 'condition' || node.data.type === 'loop') ? (() => {
              let logicalOp = node.data.logicalOperator || 'AND';
              let conditions = node.data.conditions;
              if (!conditions || conditions.length === 0) {
                conditions = [{
                  condVariable: node.data.condVariable || '',
                  condOperator: node.data.condOperator || '==',
                  condValue: node.data.condValue || ''
                }];
              }
              return { logicalOperator: logicalOp, conditions: conditions };
            })() : {
                condVariable: node.data.condVariable || '',
                condOperator: node.data.condOperator || '==',
                condValue: node.data.condValue || '',
            }),
            delaySeconds: node.data.delaySeconds || 3,
            inputTimeout: node.data.inputTimeout || 120,
            loopMode: node.data.loopMode || 'count',
            loopCount: node.data.loopCount || 5,
            loopMaxCount: node.data.loopMaxCount || 50,
            loopDelay: node.data.loopDelay ?? 0,
            telegramBotToken: node.data.telegramBotToken || '',
            telegramChatId: node.data.telegramChatId || '',
            telegramMessage: node.data.telegramMessage || '',
            telegramParseMode: node.data.telegramParseMode || 'HTML',
            telegramAttachments: node.data.telegramAttachments || [],
            telegramAction: node.data.telegramAction || 'send',
            telegramMessageId: node.data.telegramMessageId || '',
            telegramListenerToken: node.data.telegramListenerToken || '',
            delete_input: node.data.delete_input || false,
            delete_output: node.data.delete_output || false,
            excelFileName: node.data.excelFileName || (isMergeExcel ? 'merged_excel.xlsx' : isPivotExcel ? 'pivot.xlsx' : isSqlToExcel ? 'sqltoexcel.xlsx' : 'export.xlsx'),
            headerRows: node.data.headerRows || 3,
            selectedFiles: node.data.selectedFiles || [],
            mailProvider: node.data.mailProvider || 'custom',
            mailHost: node.data.mailHost || '',
            mailPort: node.data.mailPort || 465,
            mailUser: node.data.mailUser || '',
            mailPass: node.data.mailPass || '',
            mailTo: node.data.mailTo ? node.data.mailTo.split(',').map(s => s.trim()).filter(Boolean) : [],
            mailCc: node.data.mailCc ? node.data.mailCc.split(',').map(s => s.trim()).filter(Boolean) : [],
            mailSubject: node.data.mailSubject || '',
            mailBody: node.data.mailBody || '',
            mailAttachments: node.data.mailAttachments || [],
            pivotInputFiles: node.data.pivotInputFiles || [],
            pivotHeaderRow: node.data.pivotHeaderRow !== undefined ? node.data.pivotHeaderRow : 1,
            pivotIndex: node.data.pivotIndex ? (Array.isArray(node.data.pivotIndex) ? node.data.pivotIndex : node.data.pivotIndex.split(',').map(s=>s.trim()).filter(Boolean)) : [],
            pivotColumns: node.data.pivotColumns ? (Array.isArray(node.data.pivotColumns) ? node.data.pivotColumns : node.data.pivotColumns.split(',').map(s=>s.trim()).filter(Boolean)) : [],
            pivotValues: node.data.pivotValues ? (Array.isArray(node.data.pivotValues) ? node.data.pivotValues : node.data.pivotValues.split(',').map(s=>s.trim()).filter(Boolean)) : [],
            pivotAgg: node.data.pivotAgg || 'sum',
            pivotFillNa: node.data.pivotFillNa !== undefined ? node.data.pivotFillNa : true,
            pivotGrandTotal: node.data.pivotGrandTotal !== undefined ? node.data.pivotGrandTotal : true,
            pivotEnableSort: node.data.pivotEnableSort || false,
            pivotSortColumn: node.data.pivotSortColumn || '',
            pivotSortOrder: node.data.pivotSortOrder || 'asc',
            pivotSortCustom: node.data.pivotSortCustom || [],
            inPosition: node.data.inPosition || 'left',
            outPosition: node.data.outPosition || 'right',
            loopPosition: node.data.loopPosition || (isLoop ? 'bottom' : 'right'),
            donePosition: node.data.donePosition || (isLoop ? 'bottom' : 'right'),
            debugMode: node.data.debugMode || false,
            excelToSqlInputFile: node.data.excelToSqlInputFile || '',
            excelToSqlHeaderRow: node.data.excelToSqlHeaderRow || '1',
            excelToSqlTableName: node.data.excelToSqlTableName || '',
            excelToSqlImportMode: node.data.excelToSqlImportMode || 'append',
            excelToSqlRowsVarName: node.data.excelToSqlRowsVarName || (isExcelToSql ? 'rows_inserted' : ''),
            excelToSqlTableVarName: node.data.excelToSqlTableVarName || (isExcelToSql ? 'table' : ''),
            sqlExecResultVarName: node.data.sqlExecResultVarName || (isRunSqlExec ? 'result' : ''),
            sqlExecRowCountVarName: node.data.sqlExecRowCountVarName || (isRunSqlExec ? 'row_count' : ''),
            telegramSentMessageIdVarName: node.data.telegramSentMessageIdVarName || (isTelegram ? 'sent_message_id' : ''),
            telegramChatIdVarName: node.data.telegramChatIdVarName || (isTelegram ? 'chat_id' : ''),
            telegramListenerChatIdVarName: node.data.telegramListenerChatIdVarName || (isTelegramListener ? 'chat_id' : ''),
            telegramListenerMessageIdVarName: node.data.telegramListenerMessageIdVarName || (isTelegramListener ? 'message_id' : ''),
            telegramListenerTextVarName: node.data.telegramListenerTextVarName || (isTelegramListener ? 'text' : ''),
            telegramListenerSenderNameVarName: node.data.telegramListenerSenderNameVarName || (isTelegramListener ? 'sender_name' : ''),
            excelToSqlSavedConnectionId: node.data.excelToSqlSavedConnectionId || undefined,
            sqlToExcelSavedConnectionId: node.data.sqlToExcelSavedConnectionId || undefined,
            sqlExecSavedConnectionId: node.data.sqlExecSavedConnectionId || undefined,
            sqlCommand: node.data.sqlCommand || '',
            sqlExecTimeout: node.data.sqlExecTimeout ?? 7200,
            googleSheetsUrl: node.data.googleSheetsUrl || '',
            googleSheetsSheetName: node.data.googleSheetsSheetName || 'Sheet1',
            googleSheetsHeaderRow: node.data.googleSheetsHeaderRow !== undefined ? node.data.googleSheetsHeaderRow : 1,
            excelReadFile: node.data.excelReadFile || '',
            excelReadSheetName: node.data.excelReadSheetName || '',
            excelReadHeaderRow: node.data.excelReadHeaderRow !== undefined ? node.data.excelReadHeaderRow : 1,
            rowCountVarName: node.data.rowCountVarName || 'sheets_rows',
            loopArrayVar: node.data.loopArrayVar || 'sheets_data',
            loopItemVar: node.data.loopItemVar || 'item',
          }}
        >
          <div style={{ width: leftPanelWidth, height: '100%', minHeight: 0, padding: 24, background: 'var(--bg-surface)', borderRight: hasRightPanel ? '1px solid var(--border-default)' : 'none', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
            <Form.Item name="inPosition" label={<span>{t('blockEditor.portIn')} <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background: BLOCK_TYPES[node.data.type]?.color || 'var(--text-secondary)', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
              <PositionSelector />
            </Form.Item>

            {!isLoop && !isCondition && (
              <Form.Item name="outPosition" label={<span>{t('blockEditor.portOut')} <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background: BLOCK_TYPES[node.data.type]?.color || 'var(--text-secondary)', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                <PositionSelector />
              </Form.Item>
            )}

            {isCondition && (
              <>
                <Form.Item name="loopPosition" label={<span>{t('blockEditor.portTrue')} <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#22c55e', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                  <PositionSelector />
                </Form.Item>
                <Form.Item name="donePosition" label={<span>{t('blockEditor.portFalse')} <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#ef4444', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                  <PositionSelector />
                </Form.Item>
              </>
            )}

            {isLoop && (
              <>
                <Form.Item name="outPosition" label={<span>{t('blockEditor.portLoopTrue')} <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#22c55e', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                  <PositionSelector />
                </Form.Item>
                <Form.Item name="loopPosition" label={<span>{t('blockEditor.portLoop')} <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#f59e0b', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                  <PositionSelector />
                </Form.Item>
                <Form.Item name="donePosition" label={<span>{t('blockEditor.portEndloop')} <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#ef4444', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                  <PositionSelector />
                </Form.Item>
              </>
            )}
          </div>

          <Form.Item name="label" label={t('blockEditor.blockNameLabel')} rules={[{ required: true, message: t('blockEditor.blockNameRequired') }]}>
            <Input placeholder={t('blockEditor.blockNamePlaceholder')} />
          </Form.Item>

          <Form.Item name="description" label={t('blockEditor.blockDescLabel')}>
            <Input.TextArea placeholder={t('blockEditor.blockDescPlaceholder')} rows={2} />
          </Form.Item>



          {isLoop && (
            <>
              <Alert title={t('blockEditor.loopExitHint')}
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              <Alert title={<span>{t('blockEditor.loopIterationHintPrefix')} <Text code>{`{{loop_iteration}}`}</Text> {t('blockEditor.loopIterationHintSuffix')}</span>} type="success" showIcon style={{ marginBottom: 16 }} />
              <Form.Item name="loopMode" label={t('blockEditor.loopModeLabel')}>
                <Select>
                  <Select.Option value="count">{t('blockEditor.loopModeCount')}</Select.Option>
                  <Select.Option value="condition">{t('blockEditor.loopModeCondition')}</Select.Option>
                  <Select.Option value="array">{t('blockEditor.loopModeArray')}</Select.Option>
                </Select>
              </Form.Item>
              {loopMode === 'count' && (
                <Form.Item name="loopCount" label={t('blockEditor.loopCountLabel')} rules={[{ required: true, message: t('blockEditor.loopCountRequired') }]}>
                  <InputNumber min={1} max={2000} style={{ width: '100%' }} placeholder={t('blockEditor.loopCountPlaceholder')} />
                </Form.Item>
              )}
              {loopMode === 'array' && (
                <Form.Item name="loopArrayVar" label={t('blockEditor.loopArrayVarLabel')} rules={[{ required: true, message: t('blockEditor.loopArrayVarRequired') }]} tooltip={t('blockEditor.loopArrayVarTooltip')}>
                  <AutoComplete options={autoCompleteOptions} placeholder="sheets_data" allowClear />
                </Form.Item>
              )}
              {loopMode === 'condition' && (
                <Form.Item
                  name="loopMaxCount"
                  label={t('blockEditor.loopMaxCountLabel')}
                  tooltip={t('blockEditor.loopMaxCountTooltip')}
                  rules={[{ required: true, message: t('blockEditor.loopMaxCountRequired') }]}
                >
                  <InputNumber min={1} max={5000} style={{ width: '100%' }} placeholder={t('blockEditor.loopMaxCountPlaceholder')} />
                </Form.Item>
              )}
              <Form.Item name="loopDelay" label={t('blockEditor.loopDelayLabel')}>
                <InputNumber min={0} step={0.5} style={{ width: '100%' }} placeholder={t('blockEditor.loopDelayPlaceholder')} />
              </Form.Item>
            </>
          )}

          {(isCondition || (isLoop && loopMode === 'condition')) && (
            <>
              <Form.Item name="logicalOperator" label={t('blockEditor.logicalOperatorLabel')} tooltip={t('blockEditor.logicalOperatorTooltip')}>
                <Select>
                  <Select.Option value="AND">{t('blockEditor.logicalOpAnd')}</Select.Option>
                  <Select.Option value="OR">{t('blockEditor.logicalOpOr')}</Select.Option>
                </Select>
              </Form.Item>

              <Form.List name="conditions">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <div key={key} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-start' }}>
                        <Form.Item
                          {...restField}
                          name={[name, 'condVariable']}
                          style={{ flex: 1, marginBottom: 0 }}
                          rules={[{ required: true, message: t('blockEditor.condVarRequired') }]}
                        >
                          <Input placeholder={t('blockEditor.condVarPlaceholder')} />
                        </Form.Item>

                        <Form.Item
                          {...restField}
                          name={[name, 'condOperator']}
                          style={{ width: 120, marginBottom: 0 }}
                        >
                          <Select>
                            <Select.Option value="==">==</Select.Option>
                            <Select.Option value="!=">!=</Select.Option>
                            <Select.Option value=">">&gt;</Select.Option>
                            <Select.Option value="<">&lt;</Select.Option>
                            <Select.Option value=">=">&gt;=</Select.Option>
                            <Select.Option value="<=">&lt;=</Select.Option>
                            <Select.Option value="contains">{t('blockEditor.condOpContains')}</Select.Option>
                          </Select>
                        </Form.Item>

                        <Form.Item
                          {...restField}
                          name={[name, 'condValue']}
                          style={{ flex: 1, marginBottom: 0 }}
                        >
                          <Input placeholder={t('blockEditor.condValuePlaceholder')} />
                        </Form.Item>

                        <Button
                          type="text"
                          danger
                          icon={<Trash2 size={16} />}
                          onClick={() => remove(name)}
                          style={{ marginTop: 4 }}
                          aria-label={t('blockEditor.removeConditionAria')}
                        />
                      </div>
                    ))}
                    <Form.Item>
                      <Button type="dashed" onClick={() => add({ condOperator: '==' })} block icon={<Plus size={16} />}>
                        {t('blockEditor.addConditionBtn')}
                      </Button>
                    </Form.Item>
                  </>
                )}
              </Form.List>
              <Alert title={<span>{t('blockEditor.condSourceHintPrefix')} <b>output_data</b> {t('blockEditor.condSourceHintSuffix')}</span>} type="info" showIcon style={{ marginBottom: 24 }} />
            </>
          )}

          {isDelay && (
            <Form.Item label={t('blockEditor.delayWaitLabel')} name="delaySeconds" rules={[{ required: true, message: t('blockEditor.delaySecondsRequired') }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          )}

          {isInputVars && (
            <>
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                description={t('blockEditor.inputVarsWarning')}
              />
              <Form.Item
                label={t('blockEditor.inputTimeoutLabel')}
                name="inputTimeout"
                rules={[{ required: true, message: t('blockEditor.delaySecondsRequired') }]}
                extra={t('blockEditor.inputTimeoutExtra')}
              >
                <InputNumber min={5} max={3600} style={{ width: '100%' }} />
              </Form.Item>

              <Divider style={{ margin: '8px 0 16px' }}>{t('blockEditor.varListDivider')}</Divider>

              {inputFields.map((f, idx) => (
                <div key={idx} style={{ border: '1px solid var(--border-default)', borderRadius: 8, padding: 12, marginBottom: 10, background: 'var(--bg-surface)' }}>
                  <Row gutter={8} align="middle">
                    <Col span={8}>
                      <Input
                        placeholder={t('blockEditor.varNamePlaceholder')}
                        value={f.name}
                        onChange={(e) => updateInputField(idx, 'name', e.target.value.replace(/[^\w]/g, '_'))}
                        addonBefore="{{ }}"
                      />
                    </Col>
                    <Col span={9}>
                      <Input
                        placeholder={t('blockEditor.varLabelPlaceholder')}
                        value={f.label}
                        onChange={(e) => updateInputField(idx, 'label', e.target.value)}
                      />
                    </Col>
                    <Col span={5}>
                      <Select
                        style={{ width: '100%' }}
                        value={f.type || 'text'}
                        onChange={(v) => updateInputField(idx, 'type', v)}
                        options={[
                          { value: 'text', label: t('blockEditor.varTypeText') },
                          { value: 'number', label: t('blockEditor.varTypeNumber') },
                          { value: 'date', label: t('blockEditor.varTypeDate') },
                        ]}
                      />
                    </Col>
                    <Col span={2} style={{ textAlign: 'right' }}>
                      <Button danger type="text" icon={<Trash2 size={16} />} aria-label={t('blockEditor.removeVarAria')}
                        onClick={() => removeInputField(idx)} disabled={inputFields.length <= 1} />
                    </Col>
                  </Row>
                  <Row gutter={8} align="middle" style={{ marginTop: 8 }}>
                    <Col span={17}>
                      <Input
                        placeholder={t('blockEditor.defaultValuePlaceholder')}
                        value={f.defaultValue}
                        onChange={(e) => updateInputField(idx, 'defaultValue', e.target.value)}
                      />
                    </Col>
                    <Col span={7} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Switch checked={!!f.required} onChange={(v) => updateInputField(idx, 'required', v)} size="small" />
                      <span className="text-secondary text-sm">{t('blockEditor.requiredLabel')}</span>
                    </Col>
                  </Row>
                </div>
              ))}

              <Button type="dashed" block icon={<Plus size={16} />} onClick={addInputField}>{t('blockEditor.addVarBtn')}</Button>
            </>
          )}

          {isEnd && (
            <Alert title={t('blockEditor.endBlockHint')} type="info" showIcon style={{ marginBottom: 16 }} />
          )}

          {isQueue && (
            <Alert
              title={t('blockEditor.queueTitle')}
              description={t('blockEditor.queueDesc')}
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          {isErrorTrigger && (
            <Alert
              description={
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span>{t('blockEditor.errorTriggerDesc1')}</span>
                  <span>{t('blockEditor.errorTriggerDesc2')}</span>
                  <ul style={{ paddingLeft: '20px', margin: 0 }}>
                    <li><Text code>{`{{status}}`}</Text>: {t('blockEditor.errorVarStatus')}</li>
                    <li><Text code>{`{{error_detail}}`}</Text>: {t('blockEditor.errorVarDetail')}</li>
                    <li><Text code>{`{{failed_block}}`}</Text>: {t('blockEditor.errorVarFailedBlock')}</li>
                    <li><Text code>{`{{failed_block_id}}`}</Text>: {t('blockEditor.errorVarFailedBlockId')}</li>
                  </ul>
                </div>
              }
              type="error" 
              showIcon 
              style={{ marginBottom: 16 }} 
            />
          )}

          {isTelegram && (
            <>
              <Form.Item label={t('blockEditor.telegramActionLabel')} name="telegramAction">
                <Select>
                  <Select.Option value="send">{t('blockEditor.telegramActionSend')}</Select.Option>
                  <Select.Option value="edit">{t('blockEditor.telegramActionEdit')}</Select.Option>
                  <Select.Option value="reply">{t('blockEditor.telegramActionReply')}</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item label={t('blockEditor.botTokenLabel')} name="telegramBotToken" rules={[{ required: true, message: t('blockEditor.botTokenRequired') }]}>
                <AutoComplete options={autoCompleteOptions} placeholder={t('blockEditor.botTokenPlaceholder')} allowClear />
              </Form.Item>
              <Form.Item label={t('blockEditor.chatIdLabel')} name="telegramChatId" rules={[{ required: true, message: t('blockEditor.chatIdRequired') }]}>
                <AutoComplete options={autoCompleteOptions} placeholder={t('blockEditor.chatIdPlaceholder')} allowClear />
              </Form.Item>
              {(telegramAction === 'edit' || telegramAction === 'reply') && (
                <Form.Item label={t('blockEditor.messageIdLabel')} name="telegramMessageId" rules={[{ required: true, message: t('blockEditor.messageIdRequired') }]} tooltip={`${t('blockEditor.messageIdTooltipPrefix')} {{message_id}} ${t('blockEditor.messageIdTooltipSuffix')}`}>
                  <AutoComplete options={[{ value: '{{message_id}}' }, ...autoCompleteOptions]} placeholder={`{{message_id}} ${t('blockEditor.messageIdPlaceholderSuffix')}`} allowClear />
                </Form.Item>
              )}

              <Form.Item label={t('blockEditor.parseModeLabel')} name="telegramParseMode">
                <Select>
                  <Select.Option value="HTML">HTML</Select.Option>
                  <Select.Option value="MarkdownV2">Markdown V2</Select.Option>
                  <Select.Option value="">{t('blockEditor.parseModeNone')}</Select.Option>
                </Select>
              </Form.Item>
              {telegramAction !== 'edit' && (
                <>
                  <Divider style={{ margin: '16px 0 12px' }}>
                    <Space><Paperclip size="0.875rem" /> {t('blockEditor.attachFileDivider')}</Space>
                  </Divider>
                  <Form.Item label={t('blockEditor.attachFileLabel')} name="telegramAttachments">
                    <Select mode="tags" loading={loadingTelegramFiles} placeholder={t('blockEditor.attachFilePlaceholder')} style={{ width: '100%' }}>
                      {telegramFiles.map(f => (
                        <Select.Option key={f.name || f} value={f.name || f}>{f.name || f}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Alert title={t('blockEditor.attachFileHint')} type="info" showIcon style={{ marginBottom: 16 }} />
                </>
              )}
              <Divider style={{ margin: '16px 0 12px' }} />
              <Alert
                description={<span>{t('blockEditor.telegramVarsPart1')} <Text code>{`{{chat_id}}`}</Text> {t('blockEditor.telegramVarsPart2')} <Text code>{`{{sent_message_id}}`}</Text> {t('blockEditor.telegramVarsPart3')} <Text code>{`{{message_id}}`}</Text> {t('blockEditor.telegramVarsPart4')} <Text code>{`{{sent_message_id}}`}</Text>{t('blockEditor.telegramVarsPart5')}</span>}
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              {renderVarNameField('telegramSentMessageIdVarName', t('blockEditor.saveSentMsgIdLabel'), `${t('blockEditor.outputVarHintPrefix')}{{sent_message_id}}). ${t('blockEditor.multiBlockHintTelegram')}`, 'VD: sent_message_id', { marginBottom: 12 })}
              {renderVarNameField('telegramChatIdVarName', t('blockEditor.saveChatIdLabel'), `${t('blockEditor.outputVarHintPrefix')}{{chat_id}}). ${t('blockEditor.multiBlockHintTelegram')}`, 'VD: chat_id', { marginBottom: 16 })}
            </>
          )}

          {isTelegramListener && (
            <>
              <Form.Item label={t('blockEditor.botTokenLabel')} name="telegramListenerToken" rules={[{ required: true, message: t('blockEditor.botTokenRequired') }]}>
                <AutoComplete options={autoCompleteOptions} placeholder={t('blockEditor.botTokenPlaceholder')} allowClear />
              </Form.Item>
              <Alert title={t('blockEditor.listenerBotTokenAlert')} type="info" showIcon style={{ marginBottom: 16 }} />
              <Alert
                description={<span>{t('blockEditor.listenerVarsPart1')} <Text code>{`{{chat_id}}`}</Text>, <Text code>{`{{message_id}}`}</Text>, <Text code>{`{{text}}`}</Text>, <Text code>{`{{sender_name}}`}</Text>{t('blockEditor.listenerVarsPart2')}</span>}
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              {renderVarNameField('telegramListenerChatIdVarName', t('blockEditor.saveChatIdLabel'), `${t('blockEditor.outputVarHintPrefix')}{{chat_id}}). ${t('blockEditor.multiBlockHintListener')}`, 'VD: chat_id', { marginBottom: 12 })}
              {renderVarNameField('telegramListenerMessageIdVarName', t('blockEditor.saveMessageIdLabel'), `${t('blockEditor.outputVarHintPrefix')}{{message_id}}). ${t('blockEditor.multiBlockHintListener')}`, 'VD: message_id', { marginBottom: 12 })}
              {renderVarNameField('telegramListenerTextVarName', t('blockEditor.saveTextLabel'), `${t('blockEditor.outputVarHintPrefix')}{{text}}). ${t('blockEditor.multiBlockHintListener')}`, 'VD: text', { marginBottom: 12 })}
              {renderVarNameField('telegramListenerSenderNameVarName', t('blockEditor.saveSenderNameLabel'), `${t('blockEditor.outputVarHintPrefix')}{{sender_name}}). ${t('blockEditor.multiBlockHintListener')}`, 'VD: sender_name', { marginBottom: 16 })}
            </>
          )}

          {isSqlToExcel && (
            <>
              {renderDbConnectionField('sqlToExcelSavedConnectionId')}
              <Form.Item name="excelFileName" label={t('blockEditor.excelResultFileNameLabel')} rules={[{ required: true, message: t('blockEditor.excelResultFileNameRequired') }]}>
                <Input placeholder={t('blockEditor.sqlToExcelFilePlaceholder')} />
              </Form.Item>
            </>
          )}

          {isRunSqlExec && (
            <>
              {renderDbConnectionField('sqlExecSavedConnectionId')}
              {renderVarNameField('sqlExecResultVarName', t('blockEditor.saveResultLabel'), `${t('blockEditor.outputVarHintPrefix')}{{result}}${t('blockEditor.resultListNote')}). ${t('blockEditor.multiBlockHintSqlExec')}`, 'VD: result', { marginBottom: 12 })}
              {renderVarNameField('sqlExecRowCountVarName', t('blockEditor.saveRowCountLabel'), `${t('blockEditor.outputVarHintPrefix')}{{row_count}}). ${t('blockEditor.multiBlockHintSqlExec')}`, 'VD: row_count', { marginBottom: 16 })}
              <Form.Item
                label={t('blockEditor.runSqlTimeoutLabel')}
                name="sqlExecTimeout"
                extra={
                  // Màu mặc định của .ant-form-item-extra là --text-muted → chỉ 2.56:1
                  // trên nền trắng (dưới ngưỡng 4.5:1). Dùng --text-secondary: 7.58:1
                  // (light) và 6.96:1 (dark).
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {t('blockEditor.runSqlTimeoutExtra')}
                  </span>
                }
                style={{ marginBottom: 16 }}
              >
                <InputNumber min={0} max={604800} step={600} style={{ width: '100%' }} placeholder="7200" />
              </Form.Item>
            </>
          )}

          {isMergeExcel && (
            <>
              <Form.Item name="headerRows" label={t('blockEditor.headerRowsLabel')} rules={[{ required: true, message: t('blockEditor.headerRowsRequired') }]}>
                <InputNumber min={0} style={{ width: '100%' }} placeholder={t('blockEditor.headerRowsPlaceholder')} />
              </Form.Item>
              <Form.Item name="excelFileName" label={t('blockEditor.excelResultFileNameLabel')} rules={[{ required: true, message: t('blockEditor.excelResultFileNameRequired') }]}>
                <Input placeholder={t('blockEditor.mergedFilePlaceholder')} />
              </Form.Item>
            </>
          )}

          {isPivotExcel && (
            <>
              <Form.Item name="pivotInputFiles" label={t('blockEditor.pivotFilesLabel')} rules={[{ required: true, message: t('blockEditor.pivotFilesRequired') }]}>
                <Select mode="tags" loading={loadingFiles} placeholder={t('blockEditor.pivotFilesPlaceholder')} style={{ width: '100%' }}>
                  {availableFiles.map(f => (
                    <Select.Option key={f.name} value={f.name}>{f.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item name="pivotHeaderRow" label={t('blockEditor.pivotHeaderRowLabel')} rules={[{ required: true, message: t('blockEditor.pivotHeaderRowRequired') }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder={t('blockEditor.pivotHeaderRowPlaceholder')} />
              </Form.Item>
              <Alert title={t('blockEditor.pivotHeaderHint')} type="info" showIcon style={{ marginBottom: 16 }} />
              <Form.Item name="excelFileName" label={t('blockEditor.excelResultFileNameLabel')} rules={[{ required: true, message: t('blockEditor.excelResultFileNameRequired') }]}>
                <Input placeholder={t('blockEditor.pivotFilePlaceholder')} />
              </Form.Item>
            </>
          )}

          {isEmail && (
            <>
              <Form.Item label={t('blockEditor.emailProviderLabel')} name="mailProvider">
                <Select
                  style={{ fontSize: '0.85rem' }}
                  popupClassName="small-text-dropdown"
                  onChange={(val) => {
                    if (val === 'gmail') {
                      form.setFieldsValue({ mailHost: 'smtp.gmail.com', mailPort: 465 })
                    } else if (val === 'outlook') {
                      form.setFieldsValue({ mailHost: 'smtp.office365.com', mailPort: 587 })
                    }
                  }}
                >
                  <Select.Option value="gmail" style={{ fontSize: '0.85rem' }}>{t('blockEditor.emailProviderGmail')}</Select.Option>
                  <Select.Option value="outlook" style={{ fontSize: '0.85rem' }}>{t('blockEditor.emailProviderOutlook')}</Select.Option>
                  <Select.Option value="custom" style={{ fontSize: '0.85rem' }}>{t('blockEditor.emailProviderCustom')}</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item label={t('blockEditor.smtpHostLabel')} name="mailHost" rules={[{ required: true, message: t('blockEditor.smtpHostRequired') }]}>
                <Input placeholder={t('blockEditor.smtpHostPlaceholder')} />
              </Form.Item>
              <Form.Item label={t('blockEditor.smtpPortLabel')} name="mailPort" rules={[{ required: true, message: t('blockEditor.smtpPortRequired') }]}>
                <InputNumber style={{ width: '100%' }} placeholder={t('blockEditor.smtpPortPlaceholder')} />
              </Form.Item>
              {/* Dummy fields chống Chrome autofill */}
              <input type="email" style={{ width: 0, height: 0, padding: 0, margin: 0, border: 0, position: 'absolute' }} tabIndex={-1} autoComplete="off" />
              <input type="password" style={{ width: 0, height: 0, padding: 0, margin: 0, border: 0, position: 'absolute' }} tabIndex={-1} autoComplete="new-password" />
              <Form.Item label={t('blockEditor.mailUserLabel')} name="mailUser" rules={[{ required: true, message: t('blockEditor.mailUserRequired') }]}>
                <Input placeholder={t('blockEditor.mailUserPlaceholder')} autoComplete="new-password" />
              </Form.Item>
              <Form.Item label={t('blockEditor.mailPassLabel')} name="mailPass" rules={[{ required: true, message: t('blockEditor.mailPassRequired') }]}>
                <Input.Password placeholder={t('blockEditor.mailPassPlaceholder')} autoComplete="new-password" />
              </Form.Item>
            </>
          )}


          {isDeleteFiles && (
            <>
              <Divider style={{ margin: '24px 0' }} />
              <Form.Item name="delete_input" valuePropName="checked" label={t('blockEditor.deleteInputLabel')}>
                <Switch checkedChildren={t('blockEditor.switchDelete')} unCheckedChildren={t('blockEditor.switchKeep')} />
              </Form.Item>
              <Alert title={t('blockEditor.deleteInputHint')} type="info" showIcon style={{ marginBottom: 16 }} />
              <Form.Item name="delete_output" valuePropName="checked" label={t('blockEditor.deleteOutputLabel')}>
                <Switch checkedChildren={t('blockEditor.switchDelete')} unCheckedChildren={t('blockEditor.switchKeep')} />
              </Form.Item>
              <Alert title={t('blockEditor.deleteOutputHint')} type="info" showIcon style={{ marginBottom: 16 }} />
            </>
          )}

          {isGoogleSheets && (
            <>
              <Divider style={{ margin: '24px 0' }} />
              <Title level={5} style={{ margin: '0 0 16px 0' }}><TableProperties size="1rem" style={{ display: 'inline', marginRight: 8, verticalAlign: -2, color: '#0f9d58' }}/> {t('blockEditor.googleSheetsConfigTitle')}</Title>
              <Form.Item label="Link Google Sheet (Public Share)" name="googleSheetsUrl" rules={[{ required: true, message: 'Nhập Link Google Sheet' }]}>
                <Input placeholder="https://docs.google.com/spreadsheets/d/.../edit" />
              </Form.Item>
              <Form.Item label={t('blockEditor.sheetNameLabel')} name="googleSheetsSheetName" tooltip={t('blockEditor.sheetNameTooltip')}>
                <Input placeholder="Sheet1" />
              </Form.Item>
              <Form.Item label={t('blockEditor.headerRowLabel')} name="googleSheetsHeaderRow" tooltip={t('blockEditor.headerRowTooltip')}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="1" />
              </Form.Item>
              <Form.Item label={t('blockEditor.outputArrayVarLabel')} name="outputVarName" rules={[{ required: true, message: t('blockEditor.outputArrayVarRequired') }, VAR_NAME_RULE]} tooltip={`${t('blockEditor.outputArrayVarTooltipPrefix')} ${VAR_NAME_HINT} ${t('blockEditor.outputArrayVarTooltipSuffix')}`}>
                <Input placeholder="sheets_data" />
              </Form.Item>
              <Form.Item label={t('blockEditor.saveRowCountLabel')} name="rowCountVarName" rules={[VAR_NAME_RULE]} tooltip={`${t('blockEditor.rowCountTooltipPrefix')} ${VAR_NAME_HINT}`}>
                <Input placeholder="sheets_rows" />
              </Form.Item>

              <Divider style={{ margin: '16px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Space>
                  <TableProperties size={16} />
                  <Text strong style={{ fontSize: '0.85rem' }}>{t('blockEditor.colMappingTitle')}</Text>
                </Space>
                <Button type="primary" size="small" icon={<RefreshCw size={14} />} style={{ background: '#0f9d58', borderColor: '#0f9d58', color: '#ffffff', fontWeight: 500 }} loading={loadingGoogleSheetsCols} onClick={handleFetchGoogleSheetsColumns}>
                  {t('blockEditor.loadColsBtn')}
                </Button>
              </div>

              {googleSheetsCols.length > 0 ? (
                <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, border: '1px solid var(--border-default)', marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: '0.8rem', display: 'block', marginBottom: 8 }}>
                    {t('blockEditor.colMappingHint')}
                  </Text>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {googleSheetsCols.map(col => (
                      <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tag color="green" style={{ minWidth: 110, margin: 0, textAlign: 'center' }}>{col}</Tag>
                        <span style={{ color: 'var(--text-muted)' }}>➔</span>
                        <Input
                          size="small"
                          placeholder={col}
                          value={googleSheetsMappings[col] || ''}
                          onChange={e => {
                            const val = e.target.value;
                            setGoogleSheetsMappings(prev => ({ ...prev, [col]: val }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Alert title={t('blockEditor.googleSheetsLoadColsAlert')} type="info" showIcon style={{ marginBottom: 16 }} />
              )}
            </>
          )}

          {isExcelRead && (
            <>
              <Divider style={{ margin: '24px 0' }} />
              <Title level={5} style={{ margin: '0 0 16px 0' }}><FileSpreadsheet size="1rem" style={{ display: 'inline', marginRight: 8, verticalAlign: -2, color: '#217346' }}/> {t('blockEditor.excelReadConfigTitle')}</Title>
              <Form.Item label={t('blockEditor.excelReadSourceLabel')} name="excelReadFile" rules={[{ required: true, message: t('blockEditor.excelReadSourceRequired') }]} tooltip={`${t('blockEditor.excelReadSourceTooltipPrefix')} {{ten_file}}`}>
                <AutoComplete
                  placeholder={t('blockEditor.excelReadSourcePlaceholder')}
                  options={availableFiles.map(f => ({ value: f.name, label: `${f.name} (${f.type})` }))}
                  filterOption={(input, option) => (option?.value || '').toLowerCase().includes(input.toLowerCase())}
                  allowClear
                />
              </Form.Item>
              <Form.Item label={t('blockEditor.sheetNameLabel')} name="excelReadSheetName" tooltip={t('blockEditor.excelReadSheetTooltip')}>
                <Input placeholder={t('blockEditor.excelReadSheetPlaceholder')} />
              </Form.Item>
              <Form.Item label={t('blockEditor.headerRowLabel')} name="excelReadHeaderRow" tooltip={t('blockEditor.headerRowTooltip')}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="1" />
              </Form.Item>
              <Form.Item label={t('blockEditor.outputArrayVarLabel')} name="outputVarName" rules={[{ required: true, message: t('blockEditor.outputArrayVarRequired') }, VAR_NAME_RULE]} tooltip={`${t('blockEditor.outputArrayVarTooltipPrefix')} ${VAR_NAME_HINT} ${t('blockEditor.outputArrayVarTooltipSuffix')}`}>
                <Input placeholder="sheets_data" />
              </Form.Item>
              <Form.Item label={t('blockEditor.saveRowCountLabel')} name="rowCountVarName" rules={[VAR_NAME_RULE]} tooltip={`${t('blockEditor.rowCountTooltipPrefix')} ${VAR_NAME_HINT}`}>
                <Input placeholder="sheets_rows" />
              </Form.Item>

              <Divider style={{ margin: '16px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Space>
                  <TableProperties size={16} />
                  <Text strong style={{ fontSize: '0.85rem' }}>{t('blockEditor.colMappingTitle')}</Text>
                </Space>
                <Button type="primary" size="small" icon={<RefreshCw size={14} />} style={{ background: '#217346', borderColor: '#217346', color: '#ffffff', fontWeight: 500 }} loading={loadingExcelReadCols} onClick={handleFetchExcelReadColumns}>
                  {t('blockEditor.loadColsBtn')}
                </Button>
              </div>

              {excelReadCols.length > 0 ? (
                <div style={{ background: 'var(--bg-elevated)', padding: 12, borderRadius: 8, border: '1px solid var(--border-default)', marginBottom: 16 }}>
                  <Text type="secondary" style={{ fontSize: '0.8rem', display: 'block', marginBottom: 8 }}>
                    {t('blockEditor.colMappingHint')}
                  </Text>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {excelReadCols.map(col => (
                      <div key={col} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tag color="green" style={{ minWidth: 110, margin: 0, textAlign: 'center' }}>{col}</Tag>
                        <span style={{ color: 'var(--text-muted)' }}>➔</span>
                        <Input
                          size="small"
                          placeholder={col}
                          value={excelReadMappings[col] || ''}
                          onChange={e => {
                            const val = e.target.value;
                            setExcelReadMappings(prev => ({ ...prev, [col]: val }));
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <Alert title={<span>{t('blockEditor.excelReadLoadColsAlertPrefix')} {'{{...}}'} {t('blockEditor.excelReadLoadColsAlertSuffix')}</span>} type="info" showIcon style={{ marginBottom: 16 }} />
              )}
            </>
          )}
          {isBrowser && (
            <>
              <Divider style={{ margin: '24px 0' }} />
              <Form.Item name="debugMode" label={t('blockEditor.browserDebugModeLabel')} valuePropName="checked">
                <Switch checkedChildren="Headed" unCheckedChildren="Headless" />
              </Form.Item>
              <Alert title={<span style={{ fontSize: '0.85rem' }}>{t('blockEditor.browserDebugAlert')}</span>} type="info" showIcon style={{ marginBottom: 16, padding: '8px 12px' }} />
              <Alert title={<span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('blockEditor.selectorGuideTitle')}</span>}
                description={
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <div>• CSS: <Text code style={{ fontSize: '0.75rem' }}>#login-btn</Text>, <Text code style={{ fontSize: '0.75rem' }}>.btn-submit</Text></div>
                    <div>• XPath: <Text code style={{ fontSize: '0.75rem' }}>//button[@type='submit']</Text></div>
                    <div>• Text: <Text code style={{ fontSize: '0.75rem' }}>text=Đăng nhập</Text></div>
                    <div>• Label: <Text code style={{ fontSize: '0.75rem' }}>label=Tên đăng nhập</Text></div>
                  </div>
                }
                type="info"
                showIcon
                style={{ marginBottom: 16, padding: '8px 12px' }}
              />
            </>
          )}

          {isPython && (
          <>
            <Divider style={{ margin: '24px 0' }} />
            
            <div>
              <Text strong style={{ display: 'block', marginBottom: 12 }}><Box size="0.875rem" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }}/> {t('blockEditor.pythonAvailableVarsTitle')}</Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <Tag color="geekblue" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>input_data</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('blockEditor.pyVarInputDesc')}</div>
                </div>
                <div>
                  <Tag color="purple" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>output_data</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('blockEditor.pyVarOutputDesc')}</div>
                </div>
                <div>
                  <Tag color="cyan" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>OUTPUT_DIR</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('blockEditor.pyVarOutputDirDesc')}</div>
                </div>
                <div>
                  <Tag color="gold" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>INPUT_DIR</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('blockEditor.pyVarInputDirDesc')}</div>
                </div>
                <div>
                  <Tag color="default" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>workflow_id</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('blockEditor.pyVarWorkflowIdDesc')}</div>
                </div>
                <div>
                  <Tag color="default" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>block_id</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('blockEditor.pyVarBlockIdDesc')}</div>
                </div>
              </div>
            </div>
          </>
        )}

        {isExcelToSql && (
          <>
            <Divider style={{ margin: '24px 0' }} />
            <Title level={5} style={{ margin: '0 0 16px 0' }}><Database size="1rem" style={{ display: 'inline', marginRight: 8, verticalAlign: -2 }}/> {t('blockEditor.excelToSqlSourceTitle')}</Title>
            {renderDbConnectionField('excelToSqlSavedConnectionId')}
            <Form.Item name="excelToSqlInputFile" label={t('blockEditor.excelToSqlSourceFileLabel')} rules={[{ required: true }]} style={{ marginBottom: 12 }}>
              <AutoComplete placeholder={t('blockEditor.excelToSqlSourceFilePlaceholder')} options={availableFiles.map(f => ({ value: f.name }))} />
            </Form.Item>
            <Form.Item name="excelToSqlHeaderRow" label={t('blockEditor.excelToSqlHeaderLabel')} style={{ marginBottom: 16 }}>
              <Input placeholder={t('blockEditor.excelToSqlHeaderPlaceholder')} />
            </Form.Item>
            <Button type="primary" block onClick={fetchDbTables} loading={loadingSchema}>
              {t('blockEditor.checkConnectBtn')}
            </Button>
            <Divider style={{ margin: '24px 0' }} />
            {renderVarNameField('excelToSqlRowsVarName', t('blockEditor.saveRowsInsertedLabel'), `${t('blockEditor.outputVarHintPrefix')}{{rows_inserted}}). ${t('blockEditor.multiBlockHintExcelToSql')}`, 'VD: rows_inserted', { marginBottom: 12 })}
            {renderVarNameField('excelToSqlTableVarName', t('blockEditor.saveTableNameLabel'), `${t('blockEditor.outputVarHintPrefix')}{{table}}). ${t('blockEditor.multiBlockHintExcelToSql')}`, 'VD: table', { marginBottom: 16 })}
          </>
        )}

        {hasOutputVarField && (
          <>
            <Divider style={{ margin: '24px 0' }} />
            <Form.Item
              name="outputVarName"
              rules={[VAR_NAME_RULE]}
              label={
                <Space size={4}>
                  {t('blockEditor.outputVarFileNameLabel')}
                  <Tooltip title={`${t('blockEditor.outputVarHintPrefix')}{{file_name}}). ${t('blockEditor.multiBlockHintGeneric')} ${VAR_NAME_HINT}`}>
                    <Info size={14} style={{ cursor: 'help', color: 'var(--text-muted)' }} />
                  </Tooltip>
                </Space>
              }
            >
              <Input placeholder="VD: file_name" />
            </Form.Item>
          </>
        )}
      </div>

      {/* Code Editor Panel or Email/Pivot/Database Right Panel */}
        {hasRightPanel && (
          <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', minWidth: 0, minHeight: 0, overflowY: isBrowser ? 'hidden' : 'auto' }}>
            {isExcelToSql ? (
              <div style={{ padding: 24, flex: 1, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <Database size="1.5rem" color="#0ea5e9" />
                  <Title level={4} style={{ margin: 0 }}>{t('blockEditor.excelToSqlRightTitle')}</Title>
                </div>

                <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 16, border: '1px solid var(--border-default)', flex: 1, overflowY: 'auto' }}>
                  {(dbTables.length > 0 || (node.data && node.data.excelToSqlTableName)) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                      <Form.Item name="excelToSqlTableName" label={t('blockEditor.tableNameLabel')} rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                        <Select
                          showSearch
                          filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                          placeholder={t('blockEditor.tableNamePlaceholder')}
                          options={
                            dbTables.length > 0
                              ? dbTables.map(t => ({label: t, value: t}))
                              : (node.data.excelToSqlTableName ? [{ label: node.data.excelToSqlTableName, value: node.data.excelToSqlTableName }] : [])
                          }
                        />
                      </Form.Item>

                      <Form.Item name="excelToSqlImportMode" label={t('blockEditor.writeModeLabel')} style={{ marginBottom: 12 }}>
                        <Select options={[
                          { label: t('blockEditor.writeModeAppend'), value: 'append' },
                          { label: t('blockEditor.writeModeTruncate'), value: 'truncate' }
                        ]} />
                      </Form.Item>

                      <Button type="primary" onClick={fetchDbColumns} loading={loadingSchema} style={{ width: '100%', marginBottom: 12 }}>
                        {t('blockEditor.getColumnsBtn')}
                      </Button>

                      {dbColumns.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <Text strong>{t('blockEditor.columnMappingTableTitle')}</Text>
                          <Table
                            size="small"
                            pagination={false}
                            rowKey="name"
                            dataSource={dbColumns}
                            columns={[
                              { title: t('blockEditor.colSqlCol'), dataIndex: 'name', render: t => <Text code>{t}</Text> },
                              { title: t('blockEditor.colDbType'), dataIndex: 'type', render: t => <Text type="secondary">{t}</Text> },
                              {
                                title: t('blockEditor.colExcelMatch'),
                                dataIndex: 'name',
                                render: (sqlCol) => (
                                  <Select
                                    style={{ width: '100%' }}
                                    allowClear
                                    showSearch
                                    filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                    placeholder={t('blockEditor.skipNullPlaceholder')}
                                    value={excelToSqlMapping[sqlCol]}
                                    onChange={(val) => setExcelToSqlMapping(prev => ({...prev, [sqlCol]: val}))}
                                    options={excelColumns.map(c => ({label: c, value: c}))}
                                  />
                                )
                              }
                            ]}
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', textAlign: 'center' }}>
                      <Database size={48} color="var(--border-strong)" style={{ marginBottom: 16, opacity: 0.5 }} />
                      <Text type="secondary">{t('blockEditor.checkConnectFirstHintPrefix')} <strong>{t('blockEditor.checkConnectFirstHintStrong')}</strong> {t('blockEditor.checkConnectFirstHintSuffix')}</Text>
                    </div>
                  )}
                </div>
              </div>
            ) : isRunSqlExec ? (
              <div style={{ padding: 24, flex: 1, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <Terminal size="1.5rem" color="#14b8a6" />
                  <Title level={4} style={{ margin: 0 }}>{t('blockEditor.sqlExecCmdTitle')}</Title>
                </div>
                <Form.Item name="sqlCommand" rules={[{ required: true, message: t('blockEditor.sqlExecCmdRequired') }]} style={{ flex: 1, marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
                  <Input.TextArea
                    placeholder={'VD: EXEC ten_ham\nhoặc: EXEC ten_ham @tham_so = {{bien}}'}
                    style={{ fontFamily: 'var(--font-mono)', flex: 1, minHeight: '100%', resize: 'none' }}
                  />
                </Form.Item>
              </div>
            ) : isTelegramListener ? (
            <div style={{ padding: 24, flex: 1, background: 'var(--bg-base)', overflowY: 'auto' }}>
              {/* Header + Status (chỉ hiển thị - Listener bật/tắt theo nút Chạy/Dừng của workflow) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <RadioIcon size="1.25rem" color="var(--accent-primary)" />
                  <Title level={4} style={{ margin: 0 }}>{t('blockEditor.listenerCmdListTitle')}</Title>
                </div>
                <div style={{
                  background: listenerRunning ? '#10b98120' : 'var(--bg-elevated)',
                  border: `1px solid ${listenerRunning ? '#10b98150' : 'var(--border-default)'}`,
                  borderRadius: 8, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <span
                    className={listenerRunning ? 'pyflow-pulse' : undefined}
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: listenerRunning ? 'var(--accent-success)' : 'var(--text-muted)',
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ color: listenerRunning ? '#10b981' : 'var(--text-muted)', fontWeight: 500, fontSize: '0.9rem' }}>
                    {listenerRunning ? t('blockEditor.listenerRunningStatus') : t('blockEditor.listenerStoppedStatus')}
                  </span>
                </div>
              </div>

              {/* Commands Table */}
              {listenerCommands.map((cmd, idx) => (
                <div
                  key={idx}
                  draggable
                  onDragStart={(e) => handleCmdDragStart(e, idx)}
                  onDragEnter={(e) => handleCmdDragEnter(e, idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnd={handleCmdDragEnd}
                  style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 14, marginBottom: 10, border: '1px solid var(--border-default)' }}
                >
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, cursor: 'grab', color: 'var(--text-muted)', flexShrink: 0 }} title={t('blockEditor.dragReorderTooltip')}>
                      <GripVertical size={14} />
                    </div>
                    <Input
                      value={cmd.command}
                      onChange={e => { const c = [...listenerCommands]; c[idx] = { ...c[idx], command: e.target.value }; setListenerCommands(c) }}
                      placeholder={t('blockEditor.commandPlaceholder')}
                      style={{ width: 120 }}
                    />
                    <Input
                      value={cmd.description}
                      onChange={e => { const c = [...listenerCommands]; c[idx] = { ...c[idx], description: e.target.value }; setListenerCommands(c) }}
                      placeholder={t('blockEditor.cmdDescPlaceholder')}
                      style={{ flex: 1 }}
                    />
                    <div style={{ flex: 1 }} />
                    <Tooltip title={cmd.runWorkflow ? t('blockEditor.runWorkflowTooltip') : t('blockEditor.replyOnlyTooltip')}>
                      <Switch
                        size="small"
                        checked={cmd.runWorkflow}
                        onChange={v => { const c = [...listenerCommands]; c[idx] = { ...c[idx], runWorkflow: v }; setListenerCommands(c) }}
                        checkedChildren="WF"
                        unCheckedChildren="Reply"
                      />
                    </Tooltip>
                    {listenerCommands.length > 1 && (
                      <Button size="small" type="text" danger icon={<Trash2 size="0.8rem" />} onClick={() => setListenerCommands(listenerCommands.filter((_, i) => i !== idx))} aria-label={t('blockEditor.deleteListenerCmdAria')} />
                    )}
                  </div>
                  {!cmd.runWorkflow && (
                    <Input.TextArea
                      value={cmd.reply}
                      onChange={e => { const c = [...listenerCommands]; c[idx] = { ...c[idx], reply: e.target.value }; setListenerCommands(c) }}
                      placeholder={t('blockEditor.replyTemplatePlaceholder')}
                      rows={2}
                      style={{ fontSize: '0.9rem' }}
                    />
                  )}
                </div>
              ))}

              <Button type="dashed" block icon={<Plus size="0.875rem" />} onClick={() => setListenerCommands([...listenerCommands, { command: '', description: '', reply: '', runWorkflow: false }])}>
                {t('blockEditor.addCommandBtn')}
              </Button>

              <Divider style={{ margin: '24px 0' }} />
              <Alert title={<span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('blockEditor.basicGuideTitle')}</span>}
                description={
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <div>• <b>{t('blockEditor.guideCommandLabel')}</b>: {t('blockEditor.guideCommandPrefix')} <Text code style={{ fontSize: '0.75rem' }}>/</Text> {t('blockEditor.guideCommandExample')} <Text code style={{ fontSize: '0.75rem' }}>/start</Text>{t('blockEditor.guideCommandMiddle')} <Text code style={{ fontSize: '0.75rem' }}>*</Text> {t('blockEditor.guideCommandCatchAll')} <b>{t('blockEditor.guideCommandAllMessages')}</b>.</div>
                    <div>• <b>{t('blockEditor.guideReplyLabel')}</b>: {t('blockEditor.guideReplyText')}</div>
                    <div>• <b>{t('blockEditor.guideWfLabel')}</b>: {t('blockEditor.guideWfText')}</div>
                    <div>• {t('blockEditor.guideDataPrefix')} <Text code style={{ fontSize: '0.75rem' }}>{'{chat_id}'}</Text>, <Text code style={{ fontSize: '0.75rem' }}>{'{message_id}'}</Text>, <Text code style={{ fontSize: '0.75rem' }}>{'{text}'}</Text>, <Text code style={{ fontSize: '0.75rem' }}>{'{sender_name}'}</Text> {t('blockEditor.guideDataSuffix', { command: '{command}' })}</div>
                  </div>
                }
                type="info"
                showIcon
                style={{ marginBottom: 16, padding: '8px 12px' }}
              />

              <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 16, border: '1px solid var(--border-default)', overflowX: 'auto' }}>
                <div style={{ marginBottom: 12, fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('blockEditor.listenerSyntaxTitle')}</div>
                <Table
                  size="small"
                  pagination={false}
                  columns={[
                    { title: t('blockEditor.tableFuncCol'), dataIndex: 'func', key: 'func', width: '25%' },
                    { title: t('blockEditor.tableHtmlSyntaxCol'), dataIndex: 'syntax', key: 'syntax', render: t => <code style={{ color: 'var(--accent-primary)', background: 'rgba(0,0,0,0.04)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{t}</code> },
                    { title: t('blockEditor.tableResultCol'), dataIndex: 'result', key: 'result', width: '35%' }
                  ]}
                  dataSource={[
                    { key: 1, func: t('blockEditor.fnBold'), syntax: '<b>text</b>', result: <strong style={{ fontWeight: 'bold' }}>{t('blockEditor.resBoldText')}</strong> },
                    { key: 2, func: t('blockEditor.fnItalic'), syntax: '<i>text</i>', result: <em style={{ fontStyle: 'italic' }}>{t('blockEditor.resItalicText')}</em> },
                    { key: 3, func: t('blockEditor.fnUnderline'), syntax: '<u>text</u>', result: <u style={{ textDecoration: 'underline' }}>{t('blockEditor.resUnderlineText')}</u> },
                    { key: 4, func: t('blockEditor.fnStrike'), syntax: '<s>text</s>', result: <del style={{ textDecoration: 'line-through' }}>{t('blockEditor.resStrikeText')}</del> },
                    { key: 5, func: t('blockEditor.fnLink'), syntax: '<a href="http://example.com/">Link name</a>', result: <a href="#">{t('blockEditor.resLinkClickable')}</a> },
                    { key: 6, func: t('blockEditor.fnInlineCode'), syntax: '<code>text</code>', result: <code style={{ background: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: 4, fontFamily: 'monospace' }}>{t('blockEditor.resInlineCodeCopy')}</code> },
                    { key: 7, func: t('blockEditor.fnCodeBlock'), syntax: '<pre>text</pre>', result: t('blockEditor.resCodeBlockGray') },
                    { key: 8, func: t('blockEditor.fnQuote'), syntax: '<blockquote>text</blockquote>', result: t('blockEditor.resQuoteIndent') },
                    { key: 9, func: t('blockEditor.fnSpoiler'), syntax: '<tg-spoiler>text</tg-spoiler>', result: t('blockEditor.resSpoilerBlur') },
                  ]}
                />
              </div>
            </div>
          ) : isTelegram ? (
            <div style={{ padding: 24, flex: 1, background: 'var(--bg-base)', overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <MessageCircle size="1.5rem" color="var(--accent-primary)" />
                <Title level={4} style={{ margin: 0 }}>{t('blockEditor.telegramMsgContentTitle')}</Title>
              </div>
              <Form.Item name="telegramMessage" rules={[{ required: true, message: t('blockEditor.telegramMsgRequired') }]}>
                <Input.TextArea rows={12} placeholder={t('blockEditor.telegramMsgPlaceholder', { bien_toan_cuc: '{{bien_toan_cuc}}' })} style={{ fontFamily: 'monospace' }} />
              </Form.Item>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 16 }}>
                <Title level={5} style={{ margin: 0 }}>{t('blockEditor.telegramFormatGuideTitle', { mode: telegramParseMode || 'HTML' })}</Title>
              </div>

              <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 16, border: '1px solid var(--border-default)', marginBottom: 24, overflowX: 'auto' }}>
                {(!telegramParseMode || telegramParseMode === 'None') ? (
                  <Alert title={t('blockEditor.formatOffTitle')}
                    description={
                      <Text>
                        {t('blockEditor.formatOffDescLine1')}<br/>
                        {t('blockEditor.formatOffDescLine2')}
                      </Text>
                    }
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                ) : (
                  <Table
                    size="small"
                    pagination={false}
                    columns={[
                      { title: t('blockEditor.tableFuncCol'), dataIndex: 'func', key: 'func', width: '22%' },
                      { title: telegramParseMode === 'MarkdownV2' ? t('blockEditor.tableMarkdownSyntaxCol') : t('blockEditor.tableHtmlSyntaxCol'), dataIndex: 'syntax', key: 'syntax', render: t => <code style={{ color: 'var(--accent-primary)', background: 'rgba(0,0,0,0.04)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{t}</code> },
                      { title: t('blockEditor.tableResultCol'), dataIndex: 'result', key: 'result', width: '38%' }
                    ]}
                    dataSource={telegramParseMode === 'MarkdownV2' ? [
                      { key: 1, func: t('blockEditor.fnBold'), syntax: '*text*', result: <strong style={{ fontWeight: 'bold' }}>{t('blockEditor.resBoldText')}</strong> },
                      { key: 2, func: t('blockEditor.fnItalic'), syntax: '_text_', result: <em style={{ fontStyle: 'italic' }}>{t('blockEditor.resItalicText')}</em> },
                      { key: 3, func: t('blockEditor.fnUnderline'), syntax: '__text__', result: <u style={{ textDecoration: 'underline' }}>{t('blockEditor.resUnderlineText')}</u> },
                      { key: 4, func: t('blockEditor.fnStrike'), syntax: '~text~', result: <del style={{ textDecoration: 'line-through' }}>{t('blockEditor.resStrikeText')}</del> },
                      { key: 5, func: t('blockEditor.fnLink'), syntax: '[Link name](http://example.com/)', result: <a href="#">{t('blockEditor.resLinkClickable')}</a> },
                      { key: 6, func: t('blockEditor.fnMention'), syntax: '[User Name](tg://user?id=123456789)', result: <a href="#">{t('blockEditor.resMentionClick')}</a> },
                      { key: 7, func: t('blockEditor.fnInlineCode'), syntax: '`text`', result: <code style={{ background: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: 4, fontFamily: 'monospace' }}>{t('blockEditor.resInlineCodeCopy')}</code> },
                      { key: 8, func: t('blockEditor.fnCodeBlock'), syntax: '```\ntext\n```', result: t('blockEditor.resCodeBlockGray') },
                      { key: 9, func: t('blockEditor.fnCodeBlockLang'), syntax: '```python\nprint("Hello")\n```', result: t('blockEditor.resCodeBlockHighlight') },
                      { key: 10, func: t('blockEditor.fnQuote'), syntax: '>text', result: t('blockEditor.resQuoteIndent') },
                      { key: 11, func: t('blockEditor.fnSpoiler'), syntax: '||text||', result: t('blockEditor.resSpoilerBlur') },
                    ] : [
                      { key: 1, func: t('blockEditor.fnBold'), syntax: '<b>text</b>', result: <strong style={{ fontWeight: 'bold' }}>{t('blockEditor.resBoldText')}</strong> },
                      { key: 2, func: t('blockEditor.fnItalic'), syntax: '<i>text</i>', result: <em style={{ fontStyle: 'italic' }}>{t('blockEditor.resItalicText')}</em> },
                      { key: 3, func: t('blockEditor.fnUnderline'), syntax: '<u>text</u>', result: <u style={{ textDecoration: 'underline' }}>{t('blockEditor.resUnderlineText')}</u> },
                      { key: 4, func: t('blockEditor.fnStrike'), syntax: '<s>text</s>', result: <del style={{ textDecoration: 'line-through' }}>{t('blockEditor.resStrikeText')}</del> },
                      { key: 5, func: t('blockEditor.fnBoldItalic'), syntax: '<b><i>text</i></b>', result: <strong><em>{t('blockEditor.resBoldText')}</em></strong> },
                      { key: 6, func: t('blockEditor.fnLink'), syntax: '<a href="http://example.com/">Link name</a>', result: <a href="#">{t('blockEditor.resLinkClickable')}</a> },
                      { key: 7, func: t('blockEditor.fnMention'), syntax: '<a href="tg://user?id=123456789">User Name</a>', result: <a href="#">{t('blockEditor.resMentionClick')}</a> },
                      { key: 8, func: t('blockEditor.fnInlineCode'), syntax: '<code>text</code>', result: <code style={{ background: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: 4, fontFamily: 'monospace' }}>{t('blockEditor.resInlineCodeCopy')}</code> },
                      { key: 9, func: t('blockEditor.fnCodeBlock'), syntax: '<pre>text</pre>', result: t('blockEditor.resCodeBlockGray') },
                      { key: 10, func: t('blockEditor.fnCodeBlockLang'), syntax: '<pre><code class="language-python">print("Hello")</code></pre>', result: t('blockEditor.resCodeBlockHighlight') },
                      { key: 11, func: t('blockEditor.fnQuote'), syntax: '<blockquote>text</blockquote>', result: t('blockEditor.resQuoteIndent') },
                      { key: 12, func: t('blockEditor.fnSpoiler'), syntax: '<tg-spoiler>text</tg-spoiler>', result: t('blockEditor.resSpoilerBlur') },
                    ]}
                  />
                )}
              </div>
            </div>
          ) : isEmail ? (
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
                <Mail size="1.25rem" color="var(--accent-primary)" />
                <Title level={5} style={{ margin: 0 }}>{t('blockEditor.emailContentTitle')}</Title>
              </div>
              <Form.Item
                label={t('blockEditor.mailToLabel')}
                name="mailTo"
                rules={[{ required: true, message: t('blockEditor.mailToRequired') }]}
              >
                <Select mode="tags" open={false} tokenSeparators={[',']} placeholder={t('blockEditor.mailToPlaceholder')} />
              </Form.Item>
              <Alert title={t('blockEditor.mailToHint', { email: '{email}' })} type="info" showIcon style={{ marginBottom: 16 }} />
              <Form.Item
                label={t('blockEditor.mailCcLabel')}
                name="mailCc"
              >
                <Select mode="tags" open={false} tokenSeparators={[',']} placeholder={t('blockEditor.mailCcPlaceholder')} />
              </Form.Item>
              <Alert title={t('blockEditor.mailCcHint')} type="info" showIcon style={{ marginBottom: 16 }} />
              <Form.Item label={t('blockEditor.mailSubjectLabel')} name="mailSubject" rules={[{ required: true, message: t('blockEditor.mailSubjectRequired') }]}>
                <Input placeholder={t('blockEditor.mailSubjectPlaceholder', { name: '{name}' })} />
              </Form.Item>
              <Form.Item label={t('blockEditor.mailBodyLabel')} name="mailBody">
                <Input.TextArea rows={12} placeholder={t('blockEditor.mailBodyPlaceholder', { name: '{name}' })} style={{ fontFamily: 'var(--font-mono)' }} />
              </Form.Item>
              <Form.Item label={t('blockEditor.mailAttachLabel')} name="mailAttachments">
                <Select mode="tags" loading={loadingFiles} placeholder={t('blockEditor.mailAttachPlaceholder', { bien: '{bien}' })} style={{ width: '100%' }}>
                  {availableFiles.map(f => (
                    <Select.Option key={f.name} value={f.name}>{f.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Alert title={t('blockEditor.mailAttachHint')} type="info" showIcon style={{ marginBottom: 16 }} />
            </div>
          ) : isMergeExcel ? (
            <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Title level={5} style={{ margin: 0 }}>{t('blockEditor.mergeChooseFilesTitle')}</Title>
              </div>

              {/* 3 chế độ nguồn file: tất cả Input / tất cả Output / Tùy chọn */}
              <Radio.Group
                value={mergeMode}
                onChange={e => {
                  const m = e.target.value
                  setMergeMode(m)
                  if (m === 'all_input') {
                    form.setFieldsValue({ selectedFiles: availableFiles.filter(f => f.type === 'input').map(f => f.name) })
                  } else if (m === 'all_output') {
                    form.setFieldsValue({ selectedFiles: availableFiles.filter(f => f.type === 'output').map(f => f.name) })
                  }
                }}
                buttonStyle="solid"
                style={{ marginBottom: 16 }}
              >
                <Radio.Button value="all_input">{t('blockEditor.mergeAllInput')}</Radio.Button>
                <Radio.Button value="all_output">{t('blockEditor.mergeAllOutput')}</Radio.Button>
                <Radio.Button value="custom">{t('blockEditor.mergeCustom')}</Radio.Button>
              </Radio.Group>

              <Alert title={<span style={{ fontSize: '0.85rem' }}><b>{t('blockEditor.mergeNoteLabel')}</b> {t('blockEditor.mergeNoteText')}</span>} type="info" showIcon style={{ marginBottom: 16, padding: '8px 12px' }} />

              {/* Tùy chọn: multi-select từ cả 2 thư mục, hoặc nhập biến {{...}} */}
              {mergeMode === 'custom' && (
                <Form.Item
                  name="selectedFiles"
                  label={<span>{t('blockEditor.mergeCustomLabel')} {'{{...}}'}</span>}
                  rules={[{ required: true, message: t('blockEditor.mergeCustomRequired') }]}
                  extra={t('blockEditor.mergeCustomExtra')}
                >
                  <Select
                    mode="tags"
                    placeholder={t('blockEditor.mergeCustomPlaceholder')}
                    loading={loadingFiles}
                    options={availableFiles.map(f => ({ value: f.name, label: `${f.name} (${f.type === 'output' ? 'Output' : 'Input'})` }))}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              )}

              {/* Tất cả Input/Output → chỉ preview danh sách */}
              {(mergeMode === 'all_input' || mergeMode === 'all_output') && (() => {
                const folder = mergeMode === 'all_input' ? 'input' : 'output'
                const folderLabel = mergeMode === 'all_input' ? 'Input' : 'Output'
                const files = availableFiles.filter(f => f.type === folder)
                return (
                  <div style={{ marginTop: 8 }}>
                    {loadingFiles ? (
                      <Alert title={t('blockEditor.mergeLoadingFiles')} type="info" showIcon />
                    ) : files.length === 0 ? (
                      <Alert title={t('blockEditor.mergeNoFilesInFolder', { folder: folderLabel })} type="warning" showIcon />
                    ) : (
                      <div style={{ background: 'rgba(14, 165, 233, 0.05)', border: '1px solid rgba(14, 165, 233, 0.2)', padding: '10px 14px', borderRadius: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0ea5e9', fontWeight: 600, fontSize: '0.85rem' }}>
                          <Info size={14} /> {t('blockEditor.mergeFilesToMerge', { folder: folderLabel })}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, fontSize: '0.8rem' }}>
                          {files.map((f, i) => (
                            <div key={f.name} style={{ display: 'flex', gap: 8 }}>
                              <span style={{ color: 'var(--accent-primary)', fontWeight: 600, minWidth: 20 }}>{i + 1}.</span>
                              <span style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          ) : isPivotExcel ? (
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
                <TableProperties size="1.25rem" color="var(--accent-primary)" />
                <Title level={5} style={{ margin: 0 }}>{t('blockEditor.pivotConfigTitle')}</Title>
              </div>

              {columnError && (
                <Alert title={columnError} type="warning" showIcon style={{ marginBottom: 16 }} />
              )}

              <Form.Item label={t('blockEditor.pivotRowsLabel')} name="pivotIndex">
                <Select mode="tags" loading={loadingColumns} placeholder={t('blockEditor.pivotColSelectPlaceholder')}>
                  {availableColumns.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                </Select>
              </Form.Item>
              <Alert title={t('blockEditor.pivotRowsHint')} type="info" showIcon style={{ marginBottom: 16 }} />

              <Form.Item label={t('blockEditor.pivotColumnsLabel')} name="pivotColumns">
                <Select
                  mode="tags"
                  loading={loadingColumns}
                  placeholder={t('blockEditor.pivotColSelectPlaceholder')}
                  onChange={(val) => {
                    const currentSort = form.getFieldValue('pivotSortColumn')
                    if (currentSort && (!val || !val.includes(currentSort))) {
                      form.setFieldsValue({ pivotSortColumn: undefined, pivotSortCustom: [] })
                    }
                  }}
                >
                  {availableColumns.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                </Select>
              </Form.Item>
              <Alert title={t('blockEditor.pivotColumnsHint')} type="info" showIcon style={{ marginBottom: 16 }} />

              <Form.Item label={t('blockEditor.pivotValuesLabel')} name="pivotValues" rules={[{ required: true, message: t('blockEditor.pivotValuesRequired') }]}>
                <Select mode="tags" loading={loadingColumns} placeholder={t('blockEditor.pivotColSelectPlaceholder')}>
                  {availableColumns.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                </Select>
              </Form.Item>
              <Alert title={t('blockEditor.pivotValuesHint')} type="info" showIcon style={{ marginBottom: 16 }} />

              <Form.Item label={t('blockEditor.pivotAggLabel')} name="pivotAgg">
                <Select>
                  <Select.Option value="sum">{t('blockEditor.pivotAggSum')}</Select.Option>
                  <Select.Option value="mean">{t('blockEditor.pivotAggMean')}</Select.Option>
                  <Select.Option value="count">{t('blockEditor.pivotAggCount')}</Select.Option>
                  <Select.Option value="max">{t('blockEditor.pivotAggMax')}</Select.Option>
                  <Select.Option value="min">{t('blockEditor.pivotAggMin')}</Select.Option>
                </Select>
              </Form.Item>

              <div style={{ display: 'flex', gap: 24 }}>
                <Form.Item label={t('blockEditor.pivotFillNaLabel')} name="pivotFillNa" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label={t('blockEditor.pivotGrandTotalLabel')} name="pivotGrandTotal" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </div>

              <Divider style={{ margin: '24px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Title level={5} style={{ margin: 0 }}>{t('blockEditor.pivotSortConfigTitle')}</Title>
                <Form.Item name="pivotEnableSort" valuePropName="checked" style={{ margin: 0 }}>
                  <Switch size="small" />
                </Form.Item>
              </div>

              {pivotEnableSort && (
                <div style={{ background: 'rgba(0,0,0,0.02)', padding: 16, borderRadius: 8, border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <Form.Item label={t('blockEditor.pivotSortColumnLabel')} name="pivotSortColumn" style={{ flex: 1 }} rules={[{ required: true, message: t('blockEditor.pivotSortColumnRequired') }]}>
                      <Select placeholder={t('blockEditor.pivotSortColumnPlaceholder')}>
                        {sortableColumns.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                      </Select>
                    </Form.Item>
                    <Form.Item label={t('blockEditor.pivotSortOrderLabel')} name="pivotSortOrder" style={{ flex: 1 }}>
                      <Select>
                        <Select.Option value="asc">{t('blockEditor.pivotSortAsc')}</Select.Option>
                        <Select.Option value="desc">{t('blockEditor.pivotSortDesc')}</Select.Option>
                        <Select.Option value="custom">{t('blockEditor.pivotSortCustomOpt')}</Select.Option>
                      </Select>
                    </Form.Item>
                  </div>

                  {pivotSortOrder === 'custom' && (
                    <>
                      <Form.Item label={t('blockEditor.pivotSortCustomLabel')} name="pivotSortCustom">
                        <Select mode="tags" loading={loadingCustomSort} placeholder={loadingCustomSort ? t('blockEditor.pivotSortCustomScanning') : t('blockEditor.pivotSortCustomPlaceholder')}>
                          {customSortValues.map(v => <Select.Option key={v} value={v}>{v}</Select.Option>)}
                        </Select>
                      </Form.Item>
                      <Alert title={t('blockEditor.pivotSortCustomHint')} type="info" showIcon style={{ marginBottom: 16 }} />
                    </>
                  )}
                </div>
              )}
            </div>
          ) : isBrowser ? (
            <BrowserStepEditorPanel steps={browserSteps} onChange={setBrowserSteps} workflowId={workflowId} />
          ) : (
            <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {isPython ? 'Python Code' : 'SQL Query'}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                <Sparkles size={12} color="var(--accent-primary)" />
                {t('blockEditor.codeEditorAiHint')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', boxShadow: 'inset 0 0 2px rgba(0,0,0,0.2)' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', boxShadow: 'inset 0 0 2px rgba(0,0,0,0.2)' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', boxShadow: 'inset 0 0 2px rgba(0,0,0,0.2)' }} />
            </div>
          </div>
          <div style={{ flex: 1, background: 'var(--bg-base)', position: 'relative' }}>
            <Editor
              key={node.id}
              height="100%"
              language={isPython ? "python" : "sql"}
              theme={theme === 'light' ? "light" : "vs-dark"}
              defaultValue={isPython ? code : sqlCode}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, handleAiPromptOpen);
              }}
              options={{
                fontSize: 13,
                fontFamily: "'Fira Code', 'JetBrains Mono', monospace",
                fontLigatures: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: 'on',
                glyphMargin: false,
                folding: true,
                lineDecorationsWidth: 8,
                padding: { top: 12, bottom: 12 },
                renderLineHighlight: 'line',
                wordWrap: 'on',
                automaticLayout: true,
                tabSize: 4,
                insertSpaces: true,
                bracketPairColorization: { enabled: true },
                // Khối này chỉ viết 1 đoạn script ngắn, không có language server thật nên gợi ý
                // tự động không có giá trị — lại hay tranh chấp phím (Enter/Tab) với lúc gõ
                // bình thường, gây cảm giác gõ bị giật/thiếu khoảng cách. Tắt hẳn cho gõ tự nhiên.
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                wordBasedSuggestions: 'off',
                parameterHints: { enabled: false },
                acceptSuggestionOnEnter: 'off',
                tabCompletion: 'off',
              }}
            />

            {/* Khung nhập AI Prompt */}
            {aiPromptVisible && (
              <div 
                style={{ 
                  position: 'absolute', 
                  top: aiPromptPosition.top, 
                  left: aiPromptPosition.left, 
                  zIndex: 1000,
                  width: 450,
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--accent-primary)',
                  borderRadius: 8,
                  boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden'
                }}
              >
                {/* Input area */}
                <div style={{ display: 'flex', padding: '8px 12px', borderBottom: aiGeneratedCode ? '1px solid var(--border-default)' : 'none', alignItems: 'center' }}>
                  <Sparkles size={16} color="var(--accent-primary)" style={{ marginRight: 8, flexShrink: 0 }} />
                  <Input.TextArea
                    autoFocus
                    placeholder={t('blockEditor.aiPromptPlaceholder')}
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    onKeyDown={handleAiKeyDown}
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    variant="borderless"
                    disabled={aiGenerating}
                    style={{ flex: 1, padding: '4px 0', boxShadow: 'none', background: 'transparent' }}
                  />
                  <Button
                    type="text"
                    icon={aiGenerating ? <Square size={16} /> : <Send size={16} />}
                    onClick={aiGenerating ? closeAiPrompt : handleAiSubmit}
                    style={{ marginLeft: 8, flexShrink: 0, color: aiGenerating ? 'var(--accent-danger)' : 'var(--accent-primary)' }}
                    aria-label={aiGenerating ? t('blockEditor.aiStopAria') : t('blockEditor.aiSendAria')}
                  />
                </div>

                {/* Preview area */}
                {aiGeneratedCode && (
                  <div style={{ padding: '8px 12px', background: 'var(--bg-surface)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      {t('blockEditor.aiPreviewHint')}
                    </div>
                    <div style={{ 
                      maxHeight: 200, 
                      overflowY: 'auto', 
                      background: 'var(--bg-base)', 
                      padding: 8, 
                      borderRadius: 4,
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.8rem',
                      whiteSpace: 'pre-wrap',
                      border: '1px solid var(--border-default)'
                    }}>
                      {aiGeneratedCode}
                      {aiGenerating && <span className="pyflow-caret" style={{ display: 'inline-block', width: 4, height: 12, background: 'var(--accent-primary)', marginLeft: 2 }} />}
                    </div>
                    
                    {!aiGenerating && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                        <Button size="small" icon={<X size={14} />} onClick={closeAiPrompt}>{t('blockEditor.aiCancelBtn')}</Button>
                        <Button size="small" type="primary" icon={<Check size={14} />} onClick={acceptAiCode}>{t('blockEditor.aiAcceptBtn')}</Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            </div>
            </>
          )}
        </div>
      )}
      </Form>
    </Drawer>
  )
}

