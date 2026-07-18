import React, { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { getWorkflowFiles, getWorkflowOutputFiles, getFileColumns, getFileColumnValues, getListenerStatus } from '../api/client'
import { Code2, Info, Box, Mail, TableProperties, Database, MessageCircle, Globe, Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Paperclip, Radio as RadioIcon, Flag } from 'lucide-react'
import { Drawer, Form, Input, InputNumber, Button, Space, Typography, Tag, Divider, Select, AutoComplete, Radio, Switch, Table, Tooltip } from 'antd'
import toast from 'react-hot-toast'
import useStore from '../store/useStore'

const { Text } = Typography

const FileSelectionTable = ({ value = [], onChange, files = [], loading = false }) => {
  return (
    <Table
      size="small"
      rowKey="name"
      columns={[{ title: 'Tên file (Nhấp vào dòng để chọn)', dataIndex: 'name' }]}
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

const TEMPLATE_OPTIONS = [
  { key: 'default', label: 'Mặc định' },
  { key: 'http', label: 'HTTP Request' },
  { key: 'pandas', label: 'Pandas DataFrame' },
  { key: 'sql', label: 'SQLite Query' },
]

const DEFAULT_SQL_QUERY = `-- Nhập câu lệnh SQL của bạn tại đây
-- Biến output_data sẽ tự động chứa {"status": "success", "file_path": "..."}
SELECT * FROM my_table;
`

// ─── Action definitions ──────────────────────────────────────────────────────

const BROWSER_ACTIONS = [
  { group: '🌐 Điều hướng', actions: [
    { value: 'navigate',      label: 'Mở URL',            params: ['url'], needsSelector: false },
    { value: 'go_back',       label: 'Quay lại',          params: [], needsSelector: false },
    { value: 'go_forward',    label: 'Tiến tới',          params: [], needsSelector: false },
    { value: 'reload',        label: 'Tải lại trang',     params: [], needsSelector: false },
    { value: 'wait_for_load', label: 'Chờ trang tải',     params: [], needsSelector: false },
  ]},
  { group: '🖱️ Tương tác', actions: [
    { value: 'click',         label: 'Click',             params: [], needsSelector: true },
    { value: 'double_click',  label: 'Double Click',      params: [], needsSelector: true },
    { value: 'right_click',   label: 'Right Click',       params: [], needsSelector: true },
    { value: 'hover',         label: 'Hover',             params: [], needsSelector: true },
    { value: 'scroll_to',     label: 'Cuộn đến phần tử', params: [], needsSelector: true },
    { value: 'scroll_page',   label: 'Cuộn trang',        params: ['direction'], needsSelector: false },
  ]},
  { group: '⌨️ Nhập liệu', actions: [
    { value: 'fill',          label: 'Nhập văn bản',      params: ['text'], needsSelector: true },
    { value: 'type_slowly',   label: 'Gõ từng ký tự',    params: ['text'], needsSelector: true },
    { value: 'clear',         label: 'Xóa nội dung',      params: [], needsSelector: true },
    { value: 'press_key',     label: 'Nhấn phím',         params: ['key'], needsSelector: false },
  ]},
  { group: '📋 Form & Select', actions: [
    { value: 'select_option', label: 'Chọn dropdown',     params: ['option'], needsSelector: true },
    { value: 'check',         label: 'Tick checkbox',     params: [], needsSelector: true },
    { value: 'uncheck',       label: 'Bỏ tick checkbox',  params: [], needsSelector: true },
  ]},
  { group: '📥 Tải xuống', actions: [
    { value: 'click_and_download', label: 'Click & Tải file', params: ['key_name'], needsSelector: true },
  ]},
  { group: '🪟 Modal & Dialog', actions: [
    { value: 'wait_for_selector', label: 'Chờ phần tử', params: [], needsSelector: true },
    { value: 'accept_dialog', label: 'Chấp nhận Dialog', params: [], needsSelector: false },
    { value: 'dismiss_dialog',label: 'Đóng Dialog',      params: [], needsSelector: false },
  ]},
  { group: '📝 Lấy dữ liệu', actions: [
    { value: 'get_text',      label: 'Lấy Text',          params: ['key_name'], needsSelector: true },
    { value: 'get_attribute', label: 'Lấy Attribute',     params: ['attribute', 'key_name'], needsSelector: true },
    { value: 'get_all_text',  label: 'Lấy tất cả Text',  params: ['key_name'], needsSelector: true },
    { value: 'get_url',       label: 'Lấy URL hiện tại', params: ['key_name'], needsSelector: false },
    { value: 'screenshot',    label: 'Chụp màn hình',     params: ['key_name'], needsSelector: false },
    { value: 'evaluate_js',   label: 'Chạy JavaScript',  params: ['js_code', 'key_name'], needsSelector: false },
  ]},
  { group: '⏱️ Chờ đợi', actions: [
    { value: 'wait',          label: 'Dừng chờ (giây)',  params: ['seconds'], needsSelector: false },
    { value: 'wait_for_url',  label: 'Chờ URL thay đổi', params: ['url_pattern'], needsSelector: false },
  ]},
]

const ACTION_MAP = {}
BROWSER_ACTIONS.forEach(g => g.actions.forEach(a => { ACTION_MAP[a.value] = a }))

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

const BrowserStepEditorPanel = ({ steps, onChange }) => {
  const [expandedIdx, setExpandedIdx] = useState(null)

  const dragItem = React.useRef(null)
  const dragOverItem = React.useRef(null)

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
    const newSteps = steps.map((s, idx) => idx === i ? { ...s, [field]: val } : s)
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
            Danh sách bước ({steps.length})
          </span>
        </div>
        <button
          type="button"
          onClick={addStep}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #0ea5e9, #6366f1)', color: '#fff', fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer' }}
        >
          <Plus size={14} /> Thêm bước
        </button>
      </div>

      {/* Steps list */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 16px', color: 'var(--text-muted)' }}>
            <Globe size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: '0.9rem', marginBottom: 6 }}>Chưa có bước nào</div>
            <div style={{ fontSize: '0.8rem' }}>Nhấn <strong>+ Thêm bước</strong> để bắt đầu</div>
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
                    {step.value && <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>= "{step.value}"</span>}
                  </div>
                  {step.note && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 1 }}>{step.note}</div>}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeStep(i) }} style={{ width: 22, height: 22, border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }} title="Xóa bước"><Trash2 size={12} /></button>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, cursor: 'grab', color: 'var(--text-muted)' }} title="Kéo thả để sắp xếp"><GripVertical size={14} /></div>
                </div>
              </div>

              {/* Step body */}
              {isExpanded && (
                <div style={{ padding: '12px', borderTop: `1px solid ${accentColor}33`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {/* Action type */}
                  <div>
                    <label style={labelStyle}>Loại hành động</label>
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
                      <label style={labelStyle}>Selector (CSS / XPath / text=...)</label>
                      <input style={inputStyle} placeholder="VD: #login-btn, .submit, text=Đăng nhập" value={step.selector || ''} onChange={e => updateStep(i, 'selector', e.target.value)} />
                    </div>
                  )}

                  {/* Value / URL / Text */}
                  {['navigate', 'go_to', 'wait_for_url'].includes(step.action) && (
                    <div>
                      <label style={labelStyle}>URL</label>
                      <input style={inputStyle} placeholder="https://example.com" value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                    </div>
                  )}

                  {['fill', 'type_slowly'].includes(step.action) && (
                    <div>
                      <label style={labelStyle}>Nội dung nhập (hỗ trợ {'{{key}}'})</label>
                      <input style={inputStyle} placeholder="VD: hello world hoặc {{username}}" value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                    </div>
                  )}

                  {step.action === 'press_key' && (
                    <div>
                      <label style={labelStyle}>Phím</label>
                      <select value={step.value || 'Enter'} onChange={e => updateStep(i, 'value', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        {KEY_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </div>
                  )}

                  {step.action === 'select_option' && (
                    <div>
                      <label style={labelStyle}>Giá trị / Label option</label>
                      <input style={inputStyle} placeholder="VD: Hà Nội hoặc 0 (chỉ số)" value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                    </div>
                  )}

                  {step.action === 'scroll_page' && (
                    <div>
                      <label style={labelStyle}>Hướng cuộn</label>
                      <select value={step.value || 'down'} onChange={e => updateStep(i, 'value', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        {SCROLL_DIR_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                        <option value="500">500px</option>
                        <option value="1000">1000px</option>
                      </select>
                    </div>
                  )}

                  {step.action === 'wait' && (
                    <div>
                      <label style={labelStyle}>Thời gian (giây)</label>
                      <input type="number" style={inputStyle} placeholder="VD: 2" value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} min="0.1" step="0.5" />
                    </div>
                  )}

                  {step.action === 'get_attribute' && (
                    <div>
                      <label style={labelStyle}>Tên attribute</label>
                      <input style={inputStyle} placeholder="VD: href, value, src, data-id" value={step.attribute || ''} onChange={e => updateStep(i, 'attribute', e.target.value)} />
                    </div>
                  )}

                  {step.action === 'evaluate_js' && (
                    <div>
                      <label style={labelStyle}>JavaScript expression</label>
                      <textarea style={{ ...inputStyle, height: 64, resize: 'vertical', fontFamily: 'monospace' }} placeholder="VD: document.title" value={step.value || ''} onChange={e => updateStep(i, 'value', e.target.value)} />
                    </div>
                  )}

                  {step.action === 'click_and_download' && (
                    <div>
                      <label style={labelStyle}>Tên file lưu lại (Tùy chọn)</label>
                      <input style={inputStyle} placeholder="VD: bao_cao_thang (Hệ thống sẽ tự động thêm đuôi file gốc)" value={step.file_name || ''} onChange={e => updateStep(i, 'file_name', e.target.value)} />
                    </div>
                  )}

                  {/* Key name for data collection */}
                  {['get_text', 'get_attribute', 'get_all_text', 'get_url', 'screenshot', 'evaluate_js', 'click_and_download'].includes(step.action) && (
                    <div>
                      <label style={labelStyle}>Lưu vào key (output_data key)</label>
                      <input style={inputStyle} placeholder="VD: title, url, content" value={step.key_name || 'result'} onChange={e => updateStep(i, 'key_name', e.target.value)} />
                    </div>
                  )}

                  {/* Timeout */}
                  {actionDef.needsSelector && (
                    <div>
                      <label style={labelStyle}>Timeout (ms, mặc định 10000)</label>
                      <input type="number" style={inputStyle} placeholder="10000" value={step.timeout || ''} onChange={e => updateStep(i, 'timeout', e.target.value)} min="1000" step="1000" />
                    </div>
                  )}

                  {/* Note */}
                  <div>
                    <label style={labelStyle}>Ghi chú (hiển thị trong log)</label>
                    <input style={inputStyle} placeholder="VD: Click nút Đăng nhập" value={step.note || ''} onChange={e => updateStep(i, 'note', e.target.value)} />
                  </div>

                  {/* Continue on error */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" id={`coe-${i}`} checked={step.continue_on_error || false} onChange={e => updateStep(i, 'continue_on_error', e.target.checked)} style={{ cursor: 'pointer' }} />
                    <label htmlFor={`coe-${i}`} style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>Bỏ qua lỗi và tiếp tục (continue_on_error)</label>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer hint */}
      <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-default)', background: 'var(--bg-elevated)', fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
        💡 Dùng <code style={{ background: 'rgba(14,165,233,0.12)', padding: '1px 5px', borderRadius: 4, color: '#0ea5e9' }}>{'{{key}}'}</code> trong trường value để chèn dữ liệu từ <code>input_data</code>
      </div>
    </div>
  )
}

const PositionSelector = ({ value, onChange }) => {
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
        <div style={btnStyle('top')}>Trên</div>
      </div>
      <div style={{ gridColumn: 1, gridRow: 2 }} onClick={() => onChange('left')}>
        <div style={btnStyle('left')}>Trái</div>
      </div>
      <div style={{ gridColumn: 3, gridRow: 2 }} onClick={() => onChange('right')}>
        <div style={btnStyle('right')}>Phải</div>
      </div>
      <div style={{ gridColumn: 2, gridRow: 3 }} onClick={() => onChange('bottom')}>
        <div style={btnStyle('bottom')}>Dưới</div>
      </div>
    </div>
  );
};

export default function BlockEditorModal({ node, open, onClose, onSave, onUpdate, inputKeys = [], workflowId }) {
  const theme = useStore(state => state.theme)
  const [form] = Form.useForm()
  const [code, setCode] = useState(node.data.code || BLOCK_TEMPLATES.python.default)
  const [sqlCode, setSqlCode] = useState(node.data.sqlQuery || DEFAULT_SQL_QUERY)
  const [activeTemplate, setActiveTemplate] = useState('default')
  
  const [availableFiles, setAvailableFiles] = useState([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [mergeAllInput, setMergeAllInput] = useState(node.data.mergeAllInput !== false) // default ON
  const [mergeFileSource, setMergeFileSource] = useState(node.data.mergeFileSource || 'input') // 'input' | 'output'
  const [telegramFiles, setTelegramFiles] = useState([])
  const [loadingTelegramFiles, setLoadingTelegramFiles] = useState(false)
  const [listenerCommands, setListenerCommands] = useState(node.data.telegramListenerCommands || [{ command: '/hi', description: 'Gửi lời chào', reply: 'Xin chào! 👋', runWorkflow: false }])
  const [listenerRunning, setListenerRunning] = useState(false)

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
  const sortableColumns = [...new Set([...pivotColumns])]
  
  const [availableColumns, setAvailableColumns] = useState([])
  const [columnError, setColumnError] = useState('')
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [customSortValues, setCustomSortValues] = useState([])
  const [loadingCustomSort, setLoadingCustomSort] = useState(false)

  const isPython = node.data.type === 'python'
  const isCondition = node.data.type === 'condition'
  const isDelay = node.data.type === 'delay'
  const isEnd = node.data.type === 'end'
  const isTelegram = node.data.type === 'telegram'
  const isTelegramListener = node.data.type === 'telegram_listener'
  const isEmail = node.data.type === 'email'
  const isDatabase = node.data.type === 'database'
  const isSqlToExcel = node.data.type === 'sql_to_excel'
  const isMergeExcel = node.data.type === 'merge_excel'
  const isPivotExcel = node.data.type === 'pivot_excel'
  const isBrowser = node.data.type === 'browser'

  // Browser steps state
  const [browserSteps, setBrowserSteps] = useState(node.data.steps || [])
  const [expandedStep, setExpandedStep] = useState(null)

  const hasCodeEditor = isPython || isSqlToExcel
  const hasRightPanel = hasCodeEditor || isEmail || isPivotExcel || isMergeExcel || isDatabase || isTelegram || isTelegramListener || isBrowser

  const autoCompleteOptions = inputKeys.map(k => ({ value: k }))

  useEffect(() => {
    if ((isMergeExcel || isEmail || isPivotExcel) && open && workflowId) {
      const fetchFiles = async () => {
        setLoadingFiles(true)
        try {
          const [inRes, outRes] = await Promise.all([
            getWorkflowFiles(workflowId).catch(() => ({ data: [] })),
            getWorkflowOutputFiles(workflowId).catch(() => ({ data: [] }))
          ])
          let files = [...(inRes.data || []), ...(outRes.data || [])]
          if (isMergeExcel || isPivotExcel) {
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
  }, [isMergeExcel, isEmail, isPivotExcel, open, workflowId])

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
          if (Array.isArray(res.data)) {
            const cols = res.data
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
            setColumnError('Không lấy được danh sách cột.')
            setAvailableColumns([])
          }
        } catch (e) {
          setColumnError('File chưa tồn tại, vui lòng tự nhập chữ cái cột (A, B, C...).')
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
          if (Array.isArray(res.data)) {
            setCustomSortValues(res.data)
            // Cập nhật giá trị vào form nếu đang trống
            const currentCustom = form.getFieldValue('pivotSortCustom')
            if (!currentCustom || currentCustom.length === 0) {
              form.setFieldsValue({ pivotSortCustom: res.data })
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


  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      onSave(node.id, {
        ...values,
        ...(isPython ? { code } : {}),
        ...(isSqlToExcel ? { sqlQuery: sqlCode } : {}),
        ...(isMergeExcel ? { mergeAllInput, mergeFileSource } : {}),
        ...(isBrowser ? { steps: browserSteps } : {}),
        ...(isTelegramListener ? { telegramListenerCommands: listenerCommands } : {}),
        ...(isEmail ? {
          mailTo: (values.mailTo || []).join(','),
          mailCc: (values.mailCc || []).join(','),
        } : {}),
      })
      toast.success('Đã lưu cấu hình khối!')
    } catch (e) {
      // validation error already surfaced via form fields
    }
  }

  const applyTemplate = (key) => {
    setCode(BLOCK_TEMPLATES.python[key])
    setActiveTemplate(key)
  }

  return (
    <Drawer
      title={<Space>{isBrowser ? <Globe size="1.125rem" color="#0ea5e9" /> : <Code2 size="1.125rem" color="var(--accent-primary)" />} Chỉnh sửa Block</Space>}
      width="50vw"
      onClose={onClose}
      open={true}
      mask={{ closable: false }}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="primary" onClick={handleSave}>Lưu</Button>
        </Space>
      }
      styles={{ body: { padding: 0, display: 'flex', overflow: 'hidden' } }}
    >
      {/* Settings Panel */}
      <Form
        form={form}
        layout="vertical"
        style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%', height: '100%', background: 'var(--bg-base)' }}
        initialValues={{
            label: node.data.label || '',
            description: node.data.description || '',
            ...(node.data.type === 'condition' ? (() => {
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
            telegramBotToken: node.data.telegramBotToken || '',
            telegramChatId: node.data.telegramChatId || '',
            telegramMessage: node.data.telegramMessage || '',
            telegramParseMode: node.data.telegramParseMode || 'HTML',
            telegramAttachments: node.data.telegramAttachments || [],
            telegramAction: node.data.telegramAction || 'send',
            telegramMessageId: node.data.telegramMessageId || '',
            telegramListenerToken: node.data.telegramListenerToken || '',
            dbType: node.data.dbType || 'postgresql',
            dbHost: node.data.dbHost || '',
            dbPort: node.data.dbPort || '',
            dbUser: node.data.dbUser || '',
            dbPassword: node.data.dbPassword || '',
            dbName: node.data.dbName || '',
            excelFileName: node.data.excelFileName || (isMergeExcel ? 'merged.xlsx' : 'export.xlsx'),
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
            debugMode: node.data.debugMode || false,
          }}
        >
          <div style={{ width: hasRightPanel ? 360 : '100%', height: '100%', minHeight: 0, padding: 24, background: 'var(--bg-surface)', borderRight: hasRightPanel ? '1px solid var(--border-default)' : 'none', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
            <Form.Item name="inPosition" label="Cổng vào (IN)" style={{ marginBottom: 0 }}>
              <PositionSelector />
            </Form.Item>
            
            <Form.Item name="outPosition" label="Cổng ra (OUT)" style={{ marginBottom: 0 }}>
              <PositionSelector />
            </Form.Item>
          </div>

          <Form.Item name="label" label="Tên Block" rules={[{ required: true, message: 'Nhập tên block' }]}>
            <Input placeholder="Tên hiển thị trên canvas" />
          </Form.Item>

          <Form.Item name="description" label="Mô tả">
            <Input.TextArea placeholder="Mô tả ngắn về block này" rows={2} />
          </Form.Item>

          {isCondition && (
            <>
              <Form.Item name="logicalOperator" label="Toán tử Logic" tooltip="Cách kết hợp khi có nhiều điều kiện">
                <Select>
                  <Select.Option value="AND">Tất cả đều đúng (AND)</Select.Option>
                  <Select.Option value="OR">Ít nhất một cái đúng (OR)</Select.Option>
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
                          rules={[{ required: true, message: 'Nhập biến' }]}
                        >
                          <Input placeholder="Biến (VD: npp)" />
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
                            <Select.Option value="contains">chứa</Select.Option>
                          </Select>
                        </Form.Item>

                        <Form.Item
                          {...restField}
                          name={[name, 'condValue']}
                          style={{ flex: 1, marginBottom: 0 }}
                        >
                          <Input placeholder="Giá trị" />
                        </Form.Item>

                        <Button
                          type="text"
                          danger
                          icon={<Trash2 size={16} />}
                          onClick={() => remove(name)}
                          style={{ marginTop: 4 }}
                        />
                      </div>
                    ))}
                    <Form.Item>
                      <Button type="dashed" onClick={() => add({ condOperator: '==' })} block icon={<Plus size={16} />}>
                        Thêm điều kiện
                      </Button>
                    </Form.Item>
                  </>
                )}
              </Form.List>
              <div style={{ background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 6, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 24, border: '1px solid var(--border-default)' }}>
                <Box size="0.875rem" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
                Biến so sánh là các key (trường dữ liệu) nằm trong gói <b>output_data</b> được truyền từ khối liền trước nó.
              </div>
            </>
          )}

          {isDelay && (
            <Form.Item label="Thời gian chờ (giây)" name="delaySeconds" rules={[{ required: true, message: 'Nhập số giây' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          )}

          {isEnd && (
            <div style={{ background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 6, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16, border: '1px solid var(--border-default)' }}>
              <Flag size="0.875rem" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
              Khi workflow chạy đến khối này, nó sẽ kết thúc.
            </div>
          )}

          {isTelegram && (
            <>
              <Form.Item label="Chế độ" name="telegramAction">
                <Select>
                  <Select.Option value="send">📤 Gửi mới</Select.Option>
                  <Select.Option value="edit">✏️ Sửa tin nhắn</Select.Option>
                  <Select.Option value="reply">↩️ Trả lời tin nhắn</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item label="Bot Token" name="telegramBotToken" rules={[{ required: true, message: 'Nhập Bot Token' }]}>
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập mã hoặc chọn biến" allowClear />
              </Form.Item>
              <Form.Item label="ID Người nhận / Nhóm" name="telegramChatId" rules={[{ required: true, message: 'Nhập Chat ID' }]}>
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập ID hoặc chọn biến" allowClear />
              </Form.Item>
              {(telegramAction === 'edit' || telegramAction === 'reply') && (
                <Form.Item label="Message ID" name="telegramMessageId" rules={[{ required: true, message: 'Nhập Message ID' }]} tooltip="Dùng biến {message_id} từ block Telegram trước đó.">
                  <AutoComplete options={[{ value: '{message_id}' }, ...autoCompleteOptions]} placeholder="{message_id} hoặc nhập số" allowClear />
                </Form.Item>
              )}
              <Form.Item label="Nội dung tin nhắn" name="telegramMessage" rules={[{ required: true, message: 'Nhập nội dung' }]} tooltip="Gõ {{TEN_BIEN}} để chèn dữ liệu cấu hình.">
                <Input.TextArea rows={4} placeholder="Nội dung tin nhắn..." />
              </Form.Item>
              <Form.Item label="Định dạng văn bản (Parse Mode)" name="telegramParseMode">
                <Select>
                  <Select.Option value="HTML">HTML</Select.Option>
                  <Select.Option value="MarkdownV2">Markdown V2</Select.Option>
                  <Select.Option value="">Không có</Select.Option>
                </Select>
              </Form.Item>
              {telegramAction !== 'edit' && (
                <>
                  <Divider style={{ margin: '16px 0 12px' }}>
                    <Space><Paperclip size="0.875rem" /> Đính kèm tập tin</Space>
                  </Divider>
                  <Form.Item label="Đính kèm File" name="telegramAttachments" extra="Chọn file từ thư mục Output hoặc gõ tên file (VD: bao_cao.xlsx) rồi bấm Enter.">
                    <Select mode="tags" loading={loadingTelegramFiles} placeholder="Chọn file có sẵn hoặc gõ tên file và Enter" style={{ width: '100%' }}>
                      {telegramFiles.map(f => (
                        <Select.Option key={f.name || f} value={f.name || f}>{f.name || f}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                </>
              )}
            </>
          )}

          {isTelegramListener && (
            <>
              <Form.Item label="Bot Token" name="telegramListenerToken" rules={[{ required: true, message: 'Nhập Bot Token' }]}>
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập mã hoặc chọn biến" allowClear />
              </Form.Item>
              <div style={{ background: 'var(--bg-card)', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16, border: '1px solid var(--border-default)', lineHeight: 1.6 }}>
                <RadioIcon size="0.875rem" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
                Cấu hình các lệnh ở bảng bên phải. Bấm nút Chạy của workflow để bot bắt đầu lắng nghe.
              </div>
            </>
          )}

          {isDatabase && (
            <>
              <Form.Item label="Loại Database" name="dbType" rules={[{ required: true, message: 'Chọn loại Database' }]}>
                <Select>
                  <Select.Option value="postgresql">PostgreSQL</Select.Option>
                  <Select.Option value="mysql">MySQL</Select.Option>
                  <Select.Option value="sqlite">SQLite</Select.Option>
                  <Select.Option value="sqlserver">SQL Server</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item label="Host (VD: localhost hoặc biến môi trường)" name="dbHost">
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập Host hoặc biến" allowClear />
              </Form.Item>
              <Form.Item label="Port" name="dbPort">
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập Port hoặc biến" allowClear />
              </Form.Item>
              <Form.Item label="User" name="dbUser">
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập User hoặc biến" allowClear />
              </Form.Item>
              <Form.Item label="Password" name="dbPassword">
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập Password hoặc biến" allowClear />
              </Form.Item>
              <Form.Item label="Tên Database" name="dbName">
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập tên DB hoặc biến" allowClear />
              </Form.Item>
            </>
          )}

          {isSqlToExcel && (
            <>
              <div style={{ background: '#fffbe6', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', color: '#d48806', marginBottom: 16, border: '1px solid #ffe58f', lineHeight: 1.6 }}>
                <Info size="0.875rem" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
                <b>Yêu cầu:</b> Khối này phải được nối phía sau khối <b>Cơ sở dữ liệu</b> để nhận cấu hình kết nối tự động.
              </div>
              <Form.Item name="excelFileName" label="Tên file Excel kết quả" rules={[{ required: true, message: 'Nhập tên file' }]}>
                <Input placeholder="VD: bao_cao_thang.xlsx" />
              </Form.Item>
            </>
          )}

          {isMergeExcel && (
            <>
              <Form.Item name="headerRows" label="Số dòng tiêu đề (Header)" rules={[{ required: true, message: 'Nhập số dòng tiêu đề' }]}>
                <InputNumber min={0} style={{ width: '100%' }} placeholder="VD: 3" />
              </Form.Item>
              <Form.Item name="excelFileName" label="Tên file Excel kết quả" rules={[{ required: true, message: 'Nhập tên file' }]}>
                <Input placeholder="VD: merged_report.xlsx" />
              </Form.Item>
            </>
          )}

          {isPivotExcel && (
            <>
              <Form.Item name="pivotInputFiles" label="File cần xử lý Pivot" rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 file' }]}>
                <Select mode="tags" loading={loadingFiles} placeholder="Nhấp để chọn hoặc gõ tên file..." style={{ width: '100%' }}>
                  {availableFiles.map(f => (
                    <Select.Option key={f.name} value={f.name}>{f.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item name="pivotHeaderRow" label="Dòng chứa Tiêu đề (Header)" rules={[{ required: true, message: 'Nhập vị trí dòng tiêu đề' }]} extra="Gõ 1 nếu tiêu đề nằm ở dòng đầu tiên.">
                <InputNumber min={1} style={{ width: '100%' }} placeholder="VD: 1" />
              </Form.Item>
              <Form.Item name="excelFileName" label="Tên file Excel kết quả" rules={[{ required: true, message: 'Nhập tên file' }]}>
                <Input placeholder="VD: pivot_result.xlsx" />
              </Form.Item>
            </>
          )}

          {isEmail && (
            <>
              <Form.Item label="Nền tảng Email" name="mailProvider">
                <Select
                  onChange={(val) => {
                    if (val === 'gmail') {
                      form.setFieldsValue({ mailHost: 'smtp.gmail.com', mailPort: 465 })
                    } else if (val === 'outlook') {
                      form.setFieldsValue({ mailHost: 'smtp.office365.com', mailPort: 587 })
                    }
                  }}
                >
                  <Select.Option value="gmail">Gmail</Select.Option>
                  <Select.Option value="outlook">Outlook / Hotmail</Select.Option>
                  <Select.Option value="custom">Tùy chỉnh (Custom SMTP)</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item label="Host (Máy chủ SMTP)" name="mailHost" rules={[{ required: true, message: 'Vui lòng nhập Host' }]}>
                <Input placeholder="VD: smtp.gmail.com" />
              </Form.Item>
              <Form.Item label="Port" name="mailPort" rules={[{ required: true, message: 'Vui lòng nhập Port' }]}>
                <InputNumber style={{ width: '100%' }} placeholder="VD: 465 hoặc 587" />
              </Form.Item>
              <Form.Item label="Tài khoản (Email gửi)" name="mailUser" rules={[{ required: true, message: 'Vui lòng nhập Email' }]}>
                <Input placeholder="Nhập Email người gửi" />
              </Form.Item>
              <Form.Item label="Mật khẩu Ứng dụng" name="mailPass" rules={[{ required: true, message: 'Vui lòng nhập Mật khẩu' }]}>
                <Input.Password placeholder="Nhập mật khẩu ứng dụng (App Password)" />
              </Form.Item>
            </>
          )}
        

          {isBrowser && (
            <>
              <Divider style={{ margin: '16px 0' }} />
              <Form.Item name="debugMode" label="Chế độ Debug" valuePropName="checked"
                extra="Bật để hiển thị cửa sổ trình duyệt khi chạy">
                <Switch checkedChildren="🔍 Headed" unCheckedChildren="🤖 Headless" />
              </Form.Item>
              <div style={{ background: 'color-mix(in srgb, #0ea5e9 10%, transparent)', borderRadius: 8, padding: '10px 12px', border: '1px solid color-mix(in srgb, #0ea5e9 30%, transparent)', marginBottom: 8 }}>
                <div style={{ fontSize: '0.8rem', color: '#0ea5e9', fontWeight: 600, marginBottom: 4 }}>ℹ️ Hướng dẫn Selector</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  • CSS: <code>#login-btn</code>, <code>.btn-submit</code><br />
                  • XPath: <code>//button[@type='submit']</code><br />
                  • Text: <code>text=Đăng nhập</code><br />
                  • Label: <code>label=Tên đăng nhập</code>
                </div>
              </div>
            </>
          )}

          {isPython && (
          <>
            <Divider style={{ margin: '16px 0' }} />
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Templates</Text>
              <Space wrap size={[8, 8]}>
                {TEMPLATE_OPTIONS.map(t => (
                  <Button 
                    key={t.key} 
                    size="small" 
                    type={activeTemplate === t.key ? 'primary' : 'default'}
                    ghost={activeTemplate === t.key}
                    onClick={() => applyTemplate(t.key)}
                  >
                    {t.label}
                  </Button>
                ))}
              </Space>
            </div>

            <Divider style={{ margin: '16px 0' }} />
            
            <div>
              <Text strong style={{ display: 'block', marginBottom: 12 }}><Box size="0.875rem" style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }}/> Biến có sẵn</Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <Tag color="geekblue" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>input_data</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Output từ block trước</div>
                </div>
                <div>
                  <Tag color="purple" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>output_data</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Kết quả gửi sang block sau</div>
                </div>
                <div>
                  <Tag color="cyan" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>OUTPUT_DIR</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Thư mục lưu trữ file đầu ra an toàn</div>
                </div>
                <div>
                  <Tag color="default" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>workflow_id</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>ID của workflow hiện tại</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Code Editor Panel or Email/Pivot/Database Right Panel */}
        {hasRightPanel && (
          <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', minWidth: 0, minHeight: 0, overflowY: isBrowser ? 'hidden' : 'auto' }}>
            {isDatabase ? (
            <div style={{ padding: 24, flex: 1, background: 'var(--bg-base)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <Database size="1.5rem" color="var(--accent-primary)" />
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>Tài liệu Khối Database</h2>
              </div>
              
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 16, border: '1px solid var(--border-default)', marginBottom: 24 }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1.05rem', color: 'var(--text-primary)' }}>Mô tả Output (Dữ liệu trả về)</h3>
                <p style={{ margin: '0 0 16px 0', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Khi khối này chạy thành công, nó sẽ cung cấp các biến cấu hình kết nối (được mã hóa bảo mật) sang khối tiếp theo thông qua biến hệ thống <code>input_data</code>.
                </p>
                
                <Table
                  size="small"
                  pagination={false}
                  rowKey="key"
                  columns={[
                    { title: 'Tên biến (Key)', dataIndex: 'key', width: '35%', render: t => <Text code>{t}</Text> },
                    { title: 'Mô tả', dataIndex: 'desc' }
                  ]}
                  dataSource={[
                    { key: 'db_type', desc: 'Loại database (VD: sqlserver, mysql, postgresql)' },
                    { key: 'host', desc: 'Địa chỉ máy chủ (IP/Domain)' },
                    { key: 'port', desc: 'Cổng kết nối (Port)' },
                    { key: 'db_name', desc: 'Tên cơ sở dữ liệu' },
                    { key: 'user', desc: 'Tên đăng nhập (Username)' },
                    { key: 'password', desc: 'Mật khẩu' },
                    { key: 'connection_string', desc: 'Chuỗi kết nối chuẩn SQLAlchemy' }
                  ]}
                />
              </div>
              
              <div style={{ background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', borderRadius: 8, padding: 16, border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '1.05rem', color: 'var(--accent-primary)' }}>💡 Cách kết nối ở khối Python kế tiếp</h3>
                <pre style={{ margin: 0, background: '#1e1e1e', padding: 12, borderRadius: 6, fontSize: '0.9rem', border: '1px solid rgba(255,255,255,0.1)', overflowX: 'auto' }}>
<code style={{ color: '#d4d4d4' }}>{`# Lấy thông tin cấu hình từ khối Database truyền sang
server = input_data.get("host")
port = input_data.get("port")
database = input_data.get("db_name")
user = input_data.get("user")
password = input_data.get("password")

# Cú pháp tự nối chuỗi cho SQL Server (Tránh lỗi IM002)
server_part = f"{server},{port}" if port else server
conn_str = f"DRIVER={{SQL Server}};SERVER={server_part};DATABASE={database};UID={user};PWD={{{password}}};TrustServerCertificate=yes;"
`}</code>
                </pre>
              </div>
            </div>
          ) : isTelegramListener ? (
            <div style={{ padding: 24, flex: 1, background: 'var(--bg-base)', overflowY: 'auto' }}>
              {/* Header + Status (chỉ hiển thị - Listener bật/tắt theo nút Chạy/Dừng của workflow) */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <RadioIcon size="1.25rem" color="var(--accent-primary)" />
                  <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 600 }}>Danh sách lệnh</h2>
                </div>
                <div style={{
                  background: listenerRunning ? '#10b98120' : 'var(--bg-elevated)',
                  border: `1px solid ${listenerRunning ? '#10b98150' : 'var(--border-default)'}`,
                  borderRadius: 8, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: listenerRunning ? '#10b981' : 'var(--text-muted)',
                    display: 'inline-block', animation: listenerRunning ? 'pulse 2s infinite' : 'none'
                  }} />
                  <span style={{ color: listenerRunning ? '#10b981' : 'var(--text-muted)', fontWeight: 500, fontSize: '0.9rem' }}>
                    {listenerRunning ? 'Đang lắng nghe...' : 'Chưa chạy (bấm Chạy workflow để bật)'}
                  </span>
                </div>
              </div>

              {/* Commands Table */}
              {listenerCommands.map((cmd, idx) => (
                <div key={idx} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 14, marginBottom: 10, border: '1px solid var(--border-default)' }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <Input
                      value={cmd.command}
                      onChange={e => { const c = [...listenerCommands]; c[idx] = { ...c[idx], command: e.target.value }; setListenerCommands(c) }}
                      placeholder="/lệnh hoặc *"
                      style={{ width: 120 }}
                    />
                    <Input
                      value={cmd.description}
                      onChange={e => { const c = [...listenerCommands]; c[idx] = { ...c[idx], description: e.target.value }; setListenerCommands(c) }}
                      placeholder="Mô tả lệnh (hiển thị trên app Telegram)"
                      style={{ flex: 1 }}
                    />
                    <div style={{ flex: 1 }} />
                    <Tooltip title={cmd.runWorkflow ? 'Chạy workflow tiếp' : 'Chỉ trả lời nhanh'}>
                      <Switch
                        size="small"
                        checked={cmd.runWorkflow}
                        onChange={v => { const c = [...listenerCommands]; c[idx] = { ...c[idx], runWorkflow: v }; setListenerCommands(c) }}
                        checkedChildren="WF"
                        unCheckedChildren="Reply"
                      />
                    </Tooltip>
                    {listenerCommands.length > 1 && (
                      <Button size="small" type="text" danger icon={<Trash2 size="0.8rem" />} onClick={() => setListenerCommands(listenerCommands.filter((_, i) => i !== idx))} />
                    )}
                  </div>
                  <Input.TextArea
                    value={cmd.reply}
                    onChange={e => { const c = [...listenerCommands]; c[idx] = { ...c[idx], reply: e.target.value }; setListenerCommands(c) }}
                    placeholder="Mẫu trả lời..."
                    rows={2}
                    style={{ fontSize: '0.9rem' }}
                  />
                </div>
              ))}

              <Button type="dashed" block icon={<Plus size="0.875rem" />} onClick={() => setListenerCommands([...listenerCommands, { command: '', description: '', reply: '', runWorkflow: false }])}>
                Thêm lệnh
              </Button>

              <Divider />
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.82rem', lineHeight: 1.6, marginBottom: 16 }}>
                <b>Hướng dẫn cơ bản:</b><br />
                • <b>Lệnh</b>: Nhập lệnh bắt đầu bằng <code>/</code> (vd: <code>/start</code>). Nhập <code>*</code> hoặc để trống để bắt <b>mọi tin nhắn</b>.<br />
                • <b>Reply</b>: Bot trả lời ngay, không chạy workflow<br />
                • <b>WF</b>: Bot trả lời + chạy các block phía sau<br />
                • Dữ liệu truyền vào workflow: <code>{'{command}'}</code>, <code>{'{from_name}'}</code>, <code>{'{chat_id}'}</code>, <code>{'{message_id}'}</code>, <code>{'{text}'}</code>
              </div>

              <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 16, border: '1px solid var(--border-default)', overflowX: 'auto' }}>
                <div style={{ marginBottom: 12, fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Cú pháp HTML cho mẫu Reply:</div>
                <Table
                  size="small"
                  pagination={false}
                  columns={[
                    { title: 'Chức năng', dataIndex: 'func', key: 'func', width: '25%' },
                    { title: 'Cú pháp thẻ HTML', dataIndex: 'syntax', key: 'syntax', render: t => <code style={{ color: 'var(--accent-primary)', background: 'rgba(0,0,0,0.04)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{t}</code> },
                    { title: 'Kết quả hiển thị', dataIndex: 'result', key: 'result', width: '35%' }
                  ]}
                  dataSource={[
                    { key: 1, func: 'In đậm', syntax: '<b>chữ in đậm</b>', result: <strong style={{ fontWeight: 'bold' }}>chữ in đậm</strong> },
                    { key: 2, func: 'In nghiêng', syntax: '<i>chữ in nghiêng</i>', result: <em style={{ fontStyle: 'italic' }}>chữ in nghiêng</em> },
                    { key: 3, func: 'Gạch chân', syntax: '<u>chữ gạch chân</u>', result: <u style={{ textDecoration: 'underline' }}>chữ gạch chân</u> },
                    { key: 4, func: 'Gạch ngang', syntax: '<s>gạch ngang</s>', result: <del style={{ textDecoration: 'line-through' }}>gạch ngang</del> },
                    { key: 5, func: 'Link ẩn', syntax: '<a href="http://example.com/">Tên link</a>', result: <a href="#">Tên link (Click được)</a> },
                    { key: 6, func: 'Code 1 dòng', syntax: '<code>đoạn code ngắn</code>', result: <code style={{ background: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: 4, fontFamily: 'monospace' }}>đoạn code ngắn</code> },
                    { key: 7, func: 'Khối Code', syntax: '<pre>code nhiều dòng</pre>', result: 'Khối code nền xám' },
                    { key: 8, func: 'Trích dẫn', syntax: '<blockquote>đoạn trích dẫn</blockquote>', result: 'Thanh dọc thụt lề' },
                    { key: 9, func: 'Giấu chữ', syntax: '<tg-spoiler>bí mật</tg-spoiler>', result: 'Làm mờ, bấm vào hiện' },
                  ]}
                />
              </div>
            </div>
          ) : isTelegram ? (
            <div style={{ padding: 24, flex: 1, background: 'var(--bg-base)', overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <MessageCircle size="1.5rem" color="var(--accent-primary)" />
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>Hướng dẫn Định dạng Telegram ({telegramParseMode || 'HTML'})</h2>
              </div>
              
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 16, border: '1px solid var(--border-default)', marginBottom: 24, overflowX: 'auto' }}>
                {(!telegramParseMode || telegramParseMode === 'None') ? (
                  <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    Chế độ định dạng đang tắt. Tin nhắn sẽ hiển thị văn bản thuần túy (Raw Text).<br/>
                    Hãy chọn HTML hoặc MarkdownV2 để sử dụng các tính năng in đậm, in nghiêng, chèn link,...
                  </div>
                ) : (
                  <Table
                    size="small"
                    pagination={false}
                    columns={[
                      { title: 'Chức năng', dataIndex: 'func', key: 'func', width: '22%' },
                      { title: telegramParseMode === 'MarkdownV2' ? 'Cú pháp MarkdownV2' : 'Cú pháp thẻ HTML', dataIndex: 'syntax', key: 'syntax', render: t => <code style={{ color: 'var(--accent-primary)', background: 'rgba(0,0,0,0.04)', padding: '2px 6px', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{t}</code> },
                      { title: 'Kết quả hiển thị', dataIndex: 'result', key: 'result', width: '38%' }
                    ]}
                    dataSource={telegramParseMode === 'MarkdownV2' ? [
                      { key: 1, func: 'In đậm (Bold)', syntax: '*chữ in đậm*', result: <strong style={{ fontWeight: 'bold' }}>chữ in đậm</strong> },
                      { key: 2, func: 'In nghiêng (Italic)', syntax: '_chữ in nghiêng_', result: <em style={{ fontStyle: 'italic' }}>chữ in nghiêng</em> },
                      { key: 3, func: 'Gạch chân (Underline)', syntax: '__chữ gạch chân__', result: <u style={{ textDecoration: 'underline' }}>chữ gạch chân</u> },
                      { key: 4, func: 'Gạch ngang (Strikethrough)', syntax: '~gạch ngang~', result: <del style={{ textDecoration: 'line-through' }}>gạch ngang</del> },
                      { key: 5, func: 'Chèn link ẩn (Hyperlink)', syntax: '[Tên link](http://example.com/)', result: <a href="#">Tên link (Click được)</a> },
                      { key: 6, func: 'Link tài khoản (Mention)', syntax: '[Tên User](tg://user?id=123456789)', result: <a href="#">Click vào mở profile user</a> },
                      { key: 7, func: 'Code một dòng', syntax: '`đoạn code ngắn`', result: <code style={{ background: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: 4, fontFamily: 'monospace' }}>đoạn code ngắn (Copy nhanh)</code> },
                      { key: 8, func: 'Khối Code', syntax: '```\nkhối code nhiều dòng\n```', result: 'Khối code nền xám tách biệt' },
                      { key: 9, func: 'Khối Code ngôn ngữ', syntax: '```python\nprint("Hello")\n```', result: 'Khối code highlight' },
                      { key: 10, func: 'Trích dẫn', syntax: '>đoạn trích dẫn', result: 'Hiển thị dạng thanh dọc thụt lề' },
                      { key: 11, func: 'Giấu nội dung', syntax: '||nội dung bí mật||', result: 'Bị mờ đi, bấm vào mới hiện chữ' },
                    ] : [
                      { key: 1, func: 'In đậm (Bold)', syntax: '<b>chữ in đậm</b>', result: <strong style={{ fontWeight: 'bold' }}>chữ in đậm</strong> },
                      { key: 2, func: 'In nghiêng (Italic)', syntax: '<i>chữ in nghiêng</i>', result: <em style={{ fontStyle: 'italic' }}>chữ in nghiêng</em> },
                      { key: 3, func: 'Gạch chân (Underline)', syntax: '<u>chữ gạch chân</u>', result: <u style={{ textDecoration: 'underline' }}>chữ gạch chân</u> },
                      { key: 4, func: 'Gạch ngang (Strikethrough)', syntax: '<s>gạch ngang</s>', result: <del style={{ textDecoration: 'line-through' }}>gạch ngang</del> },
                      { key: 5, func: 'In đậm + In nghiêng', syntax: '<b><i>chữ đậm nghiêng</i></b>', result: <strong><em>chữ đậm nghiêng</em></strong> },
                      { key: 6, func: 'Chèn link ẩn (Hyperlink)', syntax: '<a href="http://example.com/">Tên link</a>', result: <a href="#">Tên link (Click được)</a> },
                      { key: 7, func: 'Link tài khoản (Mention)', syntax: '<a href="tg://user?id=123456789">Tên User</a>', result: <a href="#">Click vào mở profile user</a> },
                      { key: 8, func: 'Code một dòng', syntax: '<code>đoạn code ngắn</code>', result: <code style={{ background: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: 4, fontFamily: 'monospace' }}>đoạn code ngắn (Copy nhanh)</code> },
                      { key: 9, func: 'Khối Code', syntax: '<pre>khối code nhiều dòng</pre>', result: 'Khối code nền xám tách biệt' },
                      { key: 10, func: 'Khối Code ngôn ngữ', syntax: '<pre><code class="language-python">print("Hello")</code></pre>', result: 'Khối code highlight' },
                      { key: 11, func: 'Trích dẫn', syntax: '<blockquote>đoạn trích dẫn</blockquote>', result: 'Hiển thị dạng thanh dọc thụt lề' },
                      { key: 12, func: 'Giấu nội dung', syntax: '<tg-spoiler>bí mật</tg-spoiler>', result: 'Bị mờ đi, bấm vào mới hiện chữ' },
                    ]}
                  />
                )}
              </div>
            </div>
          ) : isEmail ? (
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
                <Mail size="1.25rem" color="var(--accent-primary)" />
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Nội dung Email</h3>
              </div>
              <Form.Item
                label="Người nhận (To)"
                name="mailTo"
                rules={[{ required: true, message: 'Vui lòng nhập Email người nhận' }]}
                extra="Gõ Email (hoặc biến {email}) rồi bấm Enter để thêm - có thể thêm nhiều người nhận"
              >
                <Select mode="tags" open={false} tokenSeparators={[',']} placeholder="Nhập Email rồi bấm Enter..." />
              </Form.Item>
              <Form.Item
                label="Người nhận (CC)"
                name="mailCc"
                extra="Gõ Email rồi bấm Enter để thêm - có thể thêm nhiều người nhận"
              >
                <Select mode="tags" open={false} tokenSeparators={[',']} placeholder="Nhập Email CC rồi bấm Enter..." />
              </Form.Item>
              <Form.Item label="Tiêu đề Email (Subject)" name="mailSubject" rules={[{ required: true, message: 'Vui lòng nhập Tiêu đề' }]}>
                <Input placeholder="Nhập tiêu đề (Hỗ trợ định dạng biến {name})" />
              </Form.Item>
              <Form.Item label="Nội dung Email (Body)" name="mailBody">
                <Input.TextArea rows={12} placeholder="Nhập nội dung thư (Hỗ trợ định dạng biến {name})" style={{ fontFamily: 'var(--font-mono)' }} />
              </Form.Item>
              <Form.Item label="Đính kèm File" name="mailAttachments" extra="Mẹo: Gõ tên file bất kỳ (VD: merged.xlsx, bao_cao.pdf) và bấm phím Enter. Hệ thống sẽ tự động tìm file đó ở thư mục Đầu vào hoặc Đầu ra khi chạy.">
                <Select mode="tags" loading={loadingFiles} placeholder="Chọn file có sẵn hoặc gõ tên file / {biến} và Enter" style={{ width: '100%' }}>
                  {availableFiles.map(f => (
                    <Select.Option key={f.name} value={f.name}>{f.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </div>
          ) : isMergeExcel ? (
            <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <span style={{ fontSize: 20 }}>📂</span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Chọn file cần ghép</h3>
              </div>

              {/* Toggle chọn tất cả Input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-default)' }}>
                <Switch
                  checked={mergeAllInput}
                  onChange={(checked) => {
                    setMergeAllInput(checked)
                    if (checked) {
                      // Tự động chọn tất cả input
                      const inputFiles = availableFiles.filter(f => f.type === 'input')
                      form.setFieldsValue({ selectedFiles: inputFiles.map(f => f.name) })
                    }
                  }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Chọn tất cả file đầu vào (Input)</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Tự động ghép tất cả file trong thư mục Input theo thứ tự tên</div>
                </div>
              </div>

              {/* Nếu tắt → Hiện 2 tab chọn nguồn */}
              {!mergeAllInput && (
                <>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                    <button
                      type="button"
                      onClick={() => setMergeFileSource('input')}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 8, border: `2px solid ${mergeFileSource === 'input' ? 'var(--accent-primary)' : 'var(--border-default)'}`,
                        background: mergeFileSource === 'input' ? 'color-mix(in srgb, var(--accent-primary) 12%, transparent)' : 'var(--bg-card)',
                        color: mergeFileSource === 'input' ? 'var(--accent-primary)' : 'var(--text-primary)',
                        fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', transition: 'all 0.2s'
                      }}
                    >
                      📬 File Đầu vào (Input)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMergeFileSource('output')}
                      style={{
                        flex: 1, padding: '8px 0', borderRadius: 8, border: `2px solid ${mergeFileSource === 'output' ? '#f59e0b' : 'var(--border-default)'}`,
                        background: mergeFileSource === 'output' ? 'color-mix(in srgb, #f59e0b 12%, transparent)' : 'var(--bg-card)',
                        color: mergeFileSource === 'output' ? '#f59e0b' : 'var(--text-primary)',
                        fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem', transition: 'all 0.2s'
                      }}
                    >
                      📤 File Đầu ra (Output)
                    </button>
                  </div>

                  <Form.Item
                    name="selectedFiles"
                    label="Thứ tự các file cần ghép"
                    rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 file' }]}
                    extra="File đầu tiên được chọn sẽ giữ nguyên tiêu đề"
                  >
                    <FileSelectionTable
                      files={availableFiles.filter(f => f.type === mergeFileSource)}
                      loading={loadingFiles}
                    />
                  </Form.Item>
                </>
              )}

              {/* Khi bật all input → chỉ preview */}
              {mergeAllInput && (
                <div style={{ marginTop: 4, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-default)' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 8 }}>File sẽ được ghép (tất cả Input):</div>
                  {loadingFiles ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Đang tải...</div>
                  ) : availableFiles.filter(f => f.type === 'input').length === 0 ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Chưa có file nào trong thư mục Input.</div>
                  ) : (
                    availableFiles.filter(f => f.type === 'input').map((f, i) => (
                      <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border-default)' }}>
                        <span style={{ color: 'var(--accent-primary)', fontWeight: 700, width: 20, textAlign: 'center' }}>{i + 1}</span>
                        <span style={{ fontSize: '0.9rem' }}>{f.name}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : isPivotExcel ? (
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
                <TableProperties size="1.25rem" color="var(--accent-primary)" />
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Cấu hình PivotTable</h3>
              </div>

              {columnError && (
                <div style={{ marginBottom: 16, padding: '8px 12px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 4, color: '#d48806', fontSize: '0.9rem' }}>
                  {columnError}
                </div>
              )}
              
              <Form.Item label="Trường Dòng (Rows)" name="pivotIndex" extra="Hỗ trợ tên cột hoặc chữ cái A,B,C... (VD: Khu Vực, A, B)">
                <Select mode="tags" loading={loadingColumns} placeholder="Click để chọn cột hoặc gõ chữ cái A, B, C... và Enter">
                  {availableColumns.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                </Select>
              </Form.Item>
              
              <Form.Item label="Trường Cột (Columns)" name="pivotColumns" extra="Hỗ trợ tên cột hoặc chữ cái A,B,C... (VD: Nhóm Hàng, C)">
                <Select 
                  mode="tags" 
                  loading={loadingColumns} 
                  placeholder="Click để chọn cột hoặc gõ chữ cái A, B, C... và Enter"
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
              
              <Form.Item label="Trường Giá trị (Values)" name="pivotValues" rules={[{ required: true, message: 'Nhập ít nhất 1 trường Giá trị' }]} extra="Hỗ trợ tên cột hoặc chữ cái A,B,C... (VD: Sản Lượng, D)">
                <Select mode="tags" loading={loadingColumns} placeholder="Click để chọn cột hoặc gõ chữ cái A, B, C... và Enter">
                  {availableColumns.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                </Select>
              </Form.Item>

              <Form.Item label="Phép tính (AggFunc)" name="pivotAgg">
                <Select>
                  <Select.Option value="sum">Tổng (Sum)</Select.Option>
                  <Select.Option value="mean">Trung bình (Average)</Select.Option>
                  <Select.Option value="count">Đếm (Count)</Select.Option>
                  <Select.Option value="max">Lớn nhất (Max)</Select.Option>
                  <Select.Option value="min">Nhỏ nhất (Min)</Select.Option>
                </Select>
              </Form.Item>
              
              <div style={{ display: 'flex', gap: 24 }}>
                <Form.Item label="Điền số 0 vào ô Trống (NaN)" name="pivotFillNa" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label="Bật Tổng cộng (Grand Total)" name="pivotGrandTotal" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </div>

              <Divider style={{ margin: '16px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600 }}>Cấu hình Sắp xếp (Nâng cao)</h3>
                <Form.Item name="pivotEnableSort" valuePropName="checked" style={{ margin: 0 }}>
                  <Switch size="small" />
                </Form.Item>
              </div>

              {pivotEnableSort && (
                <div style={{ background: 'rgba(0,0,0,0.02)', padding: 16, borderRadius: 8, border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <Form.Item label="Cột cần sắp xếp" name="pivotSortColumn" style={{ flex: 1 }} rules={[{ required: true, message: 'Chọn cột để sắp xếp' }]}>
                      <Select placeholder="Chọn 1 cột đã đưa vào Trường Cột">
                        {sortableColumns.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                      </Select>
                    </Form.Item>
                    <Form.Item label="Kiểu sắp xếp" name="pivotSortOrder" style={{ flex: 1 }}>
                      <Select>
                        <Select.Option value="asc">Tăng dần (A-Z)</Select.Option>
                        <Select.Option value="desc">Giảm dần (Z-A)</Select.Option>
                        <Select.Option value="custom">Tùy chỉnh (Thủ công)</Select.Option>
                      </Select>
                    </Form.Item>
                  </div>
                  
                  {pivotSortOrder === 'custom' && (
                    <Form.Item label="Thứ tự Tùy chỉnh (Kéo thả hoặc nhập tay)" name="pivotSortCustom" extra="Hệ thống tự quét dữ liệu trong file. Bạn có thể xóa/sắp xếp lại các thẻ để định hình thứ tự.">
                      <Select mode="tags" loading={loadingCustomSort} placeholder={loadingCustomSort ? "Đang quét dữ liệu..." : "Nhập hoặc kéo thả thứ tự..."}>
                        {customSortValues.map(v => <Select.Option key={v} value={v}>{v}</Select.Option>)}
                      </Select>
                    </Form.Item>
                  )}
                </div>
              )}
            </div>
          ) : isBrowser ? (
            <BrowserStepEditorPanel steps={browserSteps} onChange={setBrowserSteps} />
          ) : (
            <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {isPython ? 'Python Code' : 'SQL Query'}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', boxShadow: 'inset 0 0 2px rgba(0,0,0,0.2)' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', boxShadow: 'inset 0 0 2px rgba(0,0,0,0.2)' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', boxShadow: 'inset 0 0 2px rgba(0,0,0,0.2)' }} />
            </div>
          </div>
          <div style={{ flex: 1, background: 'var(--bg-base)' }}>
            <Editor
              height="100%"
              language={isPython ? "python" : "sql"}
              theme={theme === 'light' ? "light" : "vs-dark"}
              value={isPython ? code : sqlCode}
              onChange={(value) => isPython ? setCode(value) : setSqlCode(value)}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
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
              }}
              />
            </div>
            </>
          )}
        </div>
      )}
      </Form>
    </Drawer>
  )
}
