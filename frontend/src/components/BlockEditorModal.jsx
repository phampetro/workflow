import React, { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { getWorkflowFiles, getWorkflowOutputFiles, getFileColumns, getFileColumnValues, getListenerStatus, streamAiCodegen, getDatabaseTables, getDatabaseColumns, getDbConnections } from '../api/client'
import { Code2, Info, Box, Mail, TableProperties, Database, MessageCircle, Globe, Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Paperclip, Radio as RadioIcon, Flag, Sparkles, Send, Check, X, Square, Terminal } from 'lucide-react'
import { Drawer, Form, Input, InputNumber, Button, Space, Typography, Tag, Divider, Select, AutoComplete, Radio, Switch, Table, Tooltip, Alert, Row, Col, Checkbox } from 'antd'
import toast from 'react-hot-toast'
import useStore from '../store/useStore'
import { BLOCK_TYPES } from './BlockNode'

const { Text, Title } = Typography

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
-- Kết quả trả về: {"file_name": "tên file Excel đã xuất"}
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
    { value: 'press_key',     label: 'Nhấn phím',         params: ['key'], needsSelector: true },
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
                    {(step.value || (step.action === 'press_key' ? 'Enter' : '')) && <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 80 }}>= "{step.value || (step.action === 'press_key' ? 'Enter' : '')}"</span>}
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

                  {step.action === 'wait_for_selector' && (
                    <div>
                      <label style={labelStyle}>Chờ phần tử...</label>
                      <select value={step.state || 'visible'} onChange={e => updateStep(i, 'state', e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                        <option value="visible">Xuất hiện (VD: dữ liệu/kết quả đã load xong)</option>
                        <option value="hidden">Biến mất (VD: spinner/loading tắt đi)</option>
                        <option value="attached">Được thêm vào DOM</option>
                        <option value="detached">Bị xóa khỏi DOM</option>
                      </select>
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
      <Alert title={<span>Dùng <Text code>{'{{key}}'}</Text> trong trường value để chèn dữ liệu từ <Text code>input_data</Text></span>}
        type="info"
        showIcon
        style={{ margin: '8px 16px', borderRadius: 8 }}
      />
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

export default function BlockEditorModal({ node, open, onClose, onSave, onUpdate, inputKeys = [], workflowId, projectId }) {
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
  // Không áp dụng cho Browser: mỗi bước đã có key_name riêng để tự đặt tên field,
  // và outputVarName chỉ bọc được nguyên object (không truy cập được từng field con
  // qua {{...}}), nên không giải quyết đúng vấn đề trùng tên cho khối nhiều field này.
  // Các khối trả về >1 giá trị (Telegram, Telegram Listener, Excel to SQL, Chạy Hàm SQL EXEC)
  // có field đặt tên biến riêng cho từng giá trị, không dùng field chung này.
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
        code: isPython ? code : sqlCode,
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
          toast.error("Lỗi AI: " + err.message);
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
    if ((isMergeExcel || isEmail || isPivotExcel || isExcelToSql) && open && workflowId) {
      const fetchFiles = async () => {
        setLoadingFiles(true)
        try {
          const [inRes, outRes] = await Promise.all([
            getWorkflowFiles(workflowId).catch(() => ({ data: [] })),
            getWorkflowOutputFiles(workflowId).catch(() => ({ data: [] }))
          ])
          let files = [...(inRes.data || []), ...(outRes.data || [])]
          if (isMergeExcel || isPivotExcel || isExcelToSql) {
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
  }, [isMergeExcel, isEmail, isPivotExcel, isExcelToSql, open, workflowId])

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
      throw new Error("Vui lòng chọn Kết nối Database");
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
    <Form.Item name={fieldName} label="Kết nối Database" rules={[{ required: true, message: 'Chọn kết nối Database' }]} style={{ marginBottom: 16 }}>
      <Select
        loading={loadingDbConnections}
        placeholder="Chọn kết nối đã lưu (Dữ liệu Workflow → tab Database)"
        options={dbConnections.map(c => ({ value: c.id, label: c.label }))}
        notFoundContent={loadingDbConnections ? 'Đang tải...' : 'Chưa có kết nối nào — thêm ở tab Database trong Dữ liệu Workflow'}
      />
    </Form.Item>
  );

  const renderVarNameField = (fieldName, label, tooltip, placeholder, style) => (
    <Form.Item
      name={fieldName}
      label={
        <Space size={4}>
          {label}
          <Tooltip title={tooltip}>
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
      toast.success('Kiểm tra connect thành công! Đã tải danh sách bảng');
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setLoadingSchema(false);
    }
  }

  const fetchDbColumns = async () => {
    if (!workflowId || !excelToSqlTableName) {
      toast.error('Vui lòng nhập hoặc chọn bảng đích');
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
           toast.error('Lỗi đọc file Excel: ' + e.message);
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
      
      toast.success('Đã tải cấu trúc bảng và file');
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
        ...(isPython ? { code } : {}),
        ...(isSqlToExcel ? { sqlQuery: sqlCode } : {}),
        ...(isMergeExcel ? { mergeAllInput, mergeFileSource } : {}),
        ...(isBrowser ? { steps: browserSteps } : {}),
        ...(isTelegramListener ? { telegramListenerCommands: listenerCommands } : {}),
        ...(isExcelToSql ? { excelToSqlMapping } : {}),
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

  const getDrawerWidth = () => {
    const type = node.data.type
    // Mẫu 1: 1/3 màn hình
    if (['start', 'end', 'condition', 'delay', 'delete_files', 'error_trigger'].includes(type)) return '33vw'
    // Mẫu 2: 1/2 màn hình
    if (['run_sql_exec', 'loop'].includes(type)) return '50vw'
    // Mẫu 3: 3/4 màn hình
    return '75vw'
  }

  const drawerWidthStr = getDrawerWidth()
  const leftPanelWidth = hasRightPanel ? (drawerWidthStr === '50vw' ? '50%' : '33.333%') : '100%'

  return (
    <Drawer
      title={<Space>{isBrowser ? <Globe size="1.125rem" color="#0ea5e9" /> : <Code2 size="1.125rem" color="var(--accent-primary)" />} Chỉnh sửa Block</Space>}
      size={drawerWidthStr}
      onClose={onClose}
      open={true}
      maskClosable={false}
      keyboard={false}
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
        autoComplete="off"
        style={{ display: 'flex', flex: 1, minHeight: 0, width: '100%', height: '100%', background: 'var(--bg-base)' }}
        initialValues={{
            label: node.data.label || '',
            description: node.data.description || '',
            outputVarName: node.data.outputVarName || ((node.data.type === 'merge_excel' || node.data.type === 'pivot_excel' || node.data.type === 'sql_to_excel') ? 'file_name' : ''),
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
            excelFileName: node.data.excelFileName || (isMergeExcel ? 'merged.xlsx' : isPivotExcel ? 'pivot.xlsx' : isSqlToExcel ? 'sqltoexcel.xlsx' : 'export.xlsx'),
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
          }}
        >
          <div style={{ width: leftPanelWidth, height: '100%', minHeight: 0, padding: 24, background: 'var(--bg-surface)', borderRight: hasRightPanel ? '1px solid var(--border-default)' : 'none', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
            <Form.Item name="inPosition" label={<span>Cổng vào (IN) <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background: BLOCK_TYPES[node.data.type]?.color || 'var(--text-secondary)', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
              <PositionSelector />
            </Form.Item>
            
            {!isLoop && !isCondition && (
              <Form.Item name="outPosition" label={<span>Cổng ra (OUT) <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background: BLOCK_TYPES[node.data.type]?.color || 'var(--text-secondary)', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                <PositionSelector />
              </Form.Item>
            )}

            {isCondition && (
              <>
                <Form.Item name="loopPosition" label={<span>Cổng True <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#22c55e', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                  <PositionSelector />
                </Form.Item>
                <Form.Item name="donePosition" label={<span>Cổng False <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#ef4444', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                  <PositionSelector />
                </Form.Item>
              </>
            )}

            {isLoop && (
              <>
                <Form.Item name="outPosition" label={<span>Cổng Đúng (TRUE) <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#22c55e', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                  <PositionSelector />
                </Form.Item>
                <Form.Item name="loopPosition" label={<span>Cổng Lặp (LOOP) <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#f59e0b', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                  <PositionSelector />
                </Form.Item>
                <Form.Item name="donePosition" label={<span>Cổng Kết thúc (ENDLOOP) <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:'#ef4444', marginLeft:4}}></span></span>} style={{ marginBottom: 0 }}>
                  <PositionSelector />
                </Form.Item>
              </>
            )}
          </div>

          <Form.Item name="label" label="Tên Block" rules={[{ required: true, message: 'Nhập tên block' }]}>
            <Input placeholder="Tên hiển thị trên canvas" />
          </Form.Item>

          <Form.Item name="description" label="Mô tả">
            <Input.TextArea placeholder="Mô tả ngắn về block này" rows={2} />
          </Form.Item>



          {isLoop && (
            <>
              <Alert title="Điều kiện ĐÚNG sẽ thoát (rẽ nhánh TRUE). Điều kiện SAI sẽ lặp (rẽ nhánh LOOP). Hết lượt cho phép (rẽ nhánh ENDLOOP)." 
                type="info" 
                showIcon 
                style={{ marginBottom: 16 }} 
              />
              <Alert title={<span>Khi chạy vòng lặp, khối này tự động xuất ra biến <Text code>{`{{loop_iteration}}`}</Text> (số đếm vòng lặp hiện tại: 1, 2, 3...) để các khối sau sử dụng.</span>} type="success" showIcon style={{ marginBottom: 16 }} />
              <Form.Item name="loopMode" label="Chế độ lặp">
                <Select>
                  <Select.Option value="count">Lặp theo số lần cố định</Select.Option>
                  <Select.Option value="condition">Lặp theo điều kiện biến</Select.Option>
                </Select>
              </Form.Item>
              {loopMode === 'count' && (
                <Form.Item name="loopCount" label="Số lần lặp" rules={[{ required: true, message: 'Nhập số lần lặp' }]}>
                  <InputNumber min={1} max={2000} style={{ width: '100%' }} placeholder="Ví dụ: 5" />
                </Form.Item>
              )}
              {loopMode === 'condition' && (
                <Form.Item
                  name="loopMaxCount"
                  label="Số lần lặp tối đa"
                  tooltip="Giới hạn an toàn - nếu điều kiện mãi không đúng, vòng lặp sẽ tự dừng (đi nhánh ENDLOOP) sau đúng số lần này, tránh lặp vô hạn."
                  rules={[{ required: true, message: 'Nhập số lần lặp tối đa' }]}
                >
                  <InputNumber min={1} max={5000} style={{ width: '100%' }} placeholder="Ví dụ: 50" />
                </Form.Item>
              )}
              <Form.Item name="loopDelay" label="Thời gian chờ mỗi lần lặp (giây)">
                <InputNumber min={0} step={0.5} style={{ width: '100%' }} placeholder="Ví dụ: 1" />
              </Form.Item>
            </>
          )}

          {(isCondition || (isLoop && loopMode === 'condition')) && (
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
              <Alert title={<span>Biến so sánh là các key (trường dữ liệu) nằm trong gói <b>output_data</b> được truyền từ khối liền trước nó.</span>} type="info" showIcon style={{ marginBottom: 24 }} />
            </>
          )}

          {isDelay && (
            <Form.Item label="Thời gian chờ (giây)" name="delaySeconds" rules={[{ required: true, message: 'Nhập số giây' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          )}

          {isEnd && (
            <Alert title="Khi workflow chạy đến khối này, nó sẽ kết thúc." type="info" showIcon style={{ marginBottom: 16 }} />
          )}

          {isErrorTrigger && (
            <Alert 
              description={
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span>Khi có bất kỳ khối nào bị lỗi, khối này sẽ được kích hoạt.</span>
                  <span>Cung cấp 4 biến để các khối sau sử dụng:</span>
                  <ul style={{ paddingLeft: '20px', margin: 0 }}>
                    <li><Text code>{`{{status}}`}</Text>: Luôn là "error"</li>
                    <li><Text code>{`{{error_detail}}`}</Text>: Chi tiết mã lỗi báo về</li>
                    <li><Text code>{`{{failed_block}}`}</Text>: Tên của khối bị lỗi</li>
                    <li><Text code>{`{{failed_block_id}}`}</Text>: ID của khối bị lỗi</li>
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
                <Form.Item label="Message ID" name="telegramMessageId" rules={[{ required: true, message: 'Nhập Message ID' }]} tooltip="Dùng biến {{message_id}} từ block Telegram trước đó.">
                  <AutoComplete options={[{ value: '{{message_id}}' }, ...autoCompleteOptions]} placeholder="{{message_id}} hoặc nhập số" allowClear />
                </Form.Item>
              )}

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
                  <Form.Item label="Đính kèm File" name="telegramAttachments">
                    <Select mode="tags" loading={loadingTelegramFiles} placeholder="Chọn file có sẵn hoặc gõ tên file và Enter" style={{ width: '100%' }}>
                      {telegramFiles.map(f => (
                        <Select.Option key={f.name || f} value={f.name || f}>{f.name || f}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Alert title="Chọn file từ thư mục Output hoặc gõ tên file (VD: bao_cao.xlsx) rồi bấm Enter." type="info" showIcon style={{ marginBottom: 16 }} />
                </>
              )}
              <Divider style={{ margin: '16px 0 12px' }} />
              <Alert
                description={<span>Khi chạy thành công, khối này luôn có sẵn <Text code>{`{{chat_id}}`}</Text> và <Text code>{`{{sent_message_id}}`}</Text> cho khối sau (nếu dữ liệu đầu vào chưa từng là object, sẽ có thêm <Text code>{`{{message_id}}`}</Text> giống <Text code>{`{{sent_message_id}}`}</Text>). Muốn dùng tên riêng (tránh bị khối Telegram khác ghi đè), đặt tên ở 2 ô bên dưới.</span>}
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              {renderVarNameField('telegramSentMessageIdVarName', 'Lưu sent_message_id vào biến', 'Mặc định trùng tên biến trả về ({{sent_message_id}}). Nếu workflow có nhiều khối Telegram và muốn tránh bị ghi đè, đổi thành tên riêng.', 'VD: sent_message_id', { marginBottom: 12 })}
              {renderVarNameField('telegramChatIdVarName', 'Lưu chat_id vào biến', 'Mặc định trùng tên biến trả về ({{chat_id}}). Nếu workflow có nhiều khối Telegram và muốn tránh bị ghi đè, đổi thành tên riêng.', 'VD: chat_id', { marginBottom: 16 })}
            </>
          )}

          {isTelegramListener && (
            <>
              <Form.Item label="Bot Token" name="telegramListenerToken" rules={[{ required: true, message: 'Nhập Bot Token' }]}>
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập mã hoặc chọn biến" allowClear />
              </Form.Item>
              <Alert title="Cấu hình các lệnh ở bảng bên phải. Bấm nút Chạy của workflow để bot bắt đầu lắng nghe." type="info" showIcon style={{ marginBottom: 16 }} />
              <Alert
                description={<span>Khi có tin nhắn khớp lệnh, khối này luôn có sẵn <Text code>{`{{chat_id}}`}</Text>, <Text code>{`{{message_id}}`}</Text>, <Text code>{`{{text}}`}</Text>, <Text code>{`{{sender_name}}`}</Text>. Muốn dùng tên riêng, đặt tên ở các ô bên dưới.</span>}
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              {renderVarNameField('telegramListenerChatIdVarName', 'Lưu chat_id vào biến', 'Mặc định trùng tên biến trả về ({{chat_id}}). Đổi tên riêng nếu muốn tránh nhầm lẫn với khối khác.', 'VD: chat_id', { marginBottom: 12 })}
              {renderVarNameField('telegramListenerMessageIdVarName', 'Lưu message_id vào biến', 'Mặc định trùng tên biến trả về ({{message_id}}). Đổi tên riêng nếu muốn tránh nhầm lẫn với khối khác.', 'VD: message_id', { marginBottom: 12 })}
              {renderVarNameField('telegramListenerTextVarName', 'Lưu text vào biến', 'Mặc định trùng tên biến trả về ({{text}}). Đổi tên riêng nếu muốn tránh nhầm lẫn với khối khác.', 'VD: text', { marginBottom: 12 })}
              {renderVarNameField('telegramListenerSenderNameVarName', 'Lưu sender_name vào biến', 'Mặc định trùng tên biến trả về ({{sender_name}}). Đổi tên riêng nếu muốn tránh nhầm lẫn với khối khác.', 'VD: sender_name', { marginBottom: 16 })}
            </>
          )}

          {isSqlToExcel && (
            <>
              {renderDbConnectionField('sqlToExcelSavedConnectionId')}
              <Form.Item name="excelFileName" label="Tên file Excel kết quả" rules={[{ required: true, message: 'Nhập tên file' }]}>
                <Input placeholder="VD: sqltoexcel.xlsx" />
              </Form.Item>
            </>
          )}

          {isRunSqlExec && (
            <>
              {renderDbConnectionField('sqlExecSavedConnectionId')}
              {renderVarNameField('sqlExecResultVarName', 'Lưu kết quả (rows) vào biến', 'Mặc định trùng tên biến trả về ({{result}}, dạng danh sách object). Nếu workflow có nhiều khối Chạy Hàm SQL và muốn tránh bị ghi đè, đổi thành tên riêng.', 'VD: result', { marginBottom: 12 })}
              {renderVarNameField('sqlExecRowCountVarName', 'Lưu số dòng vào biến', 'Mặc định trùng tên biến trả về ({{row_count}}). Nếu workflow có nhiều khối Chạy Hàm SQL và muốn tránh bị ghi đè, đổi thành tên riêng.', 'VD: row_count', { marginBottom: 16 })}
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
              <Form.Item name="pivotHeaderRow" label="Dòng chứa Tiêu đề (Header)" rules={[{ required: true, message: 'Nhập vị trí dòng tiêu đề' }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="VD: 1" />
              </Form.Item>
              <Alert title="Gõ 1 nếu tiêu đề nằm ở dòng đầu tiên." type="info" showIcon style={{ marginBottom: 16 }} />
              <Form.Item name="excelFileName" label="Tên file Excel kết quả" rules={[{ required: true, message: 'Nhập tên file' }]}>
                <Input placeholder="VD: pivot.xlsx" />
              </Form.Item>
            </>
          )}

          {isEmail && (
            <>
              <Form.Item label="Nền tảng Email" name="mailProvider">
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
                  <Select.Option value="gmail" style={{ fontSize: '0.85rem' }}>Gmail</Select.Option>
                  <Select.Option value="outlook" style={{ fontSize: '0.85rem' }}>Outlook / Hotmail</Select.Option>
                  <Select.Option value="custom" style={{ fontSize: '0.85rem' }}>Tùy chỉnh (Custom SMTP)</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item label="Host (Máy chủ SMTP)" name="mailHost" rules={[{ required: true, message: 'Vui lòng nhập Host' }]}>
                <Input placeholder="VD: smtp.gmail.com" />
              </Form.Item>
              <Form.Item label="Port" name="mailPort" rules={[{ required: true, message: 'Vui lòng nhập Port' }]}>
                <InputNumber style={{ width: '100%' }} placeholder="VD: 465 hoặc 587" />
              </Form.Item>
              {/* Dummy fields chống Chrome autofill */}
              <input type="email" style={{ width: 0, height: 0, padding: 0, margin: 0, border: 0, position: 'absolute' }} tabIndex={-1} autoComplete="off" />
              <input type="password" style={{ width: 0, height: 0, padding: 0, margin: 0, border: 0, position: 'absolute' }} tabIndex={-1} autoComplete="new-password" />
              <Form.Item label="Tài khoản (Email gửi)" name="mailUser" rules={[{ required: true, message: 'Vui lòng nhập Email' }]}>
                <Input placeholder="Nhập Email người gửi" autoComplete="new-password" />
              </Form.Item>
              <Form.Item label="Mật khẩu Ứng dụng" name="mailPass" rules={[{ required: true, message: 'Vui lòng nhập Mật khẩu' }]}>
                <Input.Password placeholder="Nhập mật khẩu ứng dụng (App Password)" autoComplete="new-password" />
              </Form.Item>
            </>
          )}
        

          {isDeleteFiles && (
            <>
              <Divider style={{ margin: '24px 0' }} />
              <Form.Item name="delete_input" valuePropName="checked" label="Thư mục Input">
                <Switch checkedChildren="Xóa" unCheckedChildren="Giữ lại" />
              </Form.Item>
              <Alert title="Xóa toàn bộ tập tin trong thư mục dữ liệu đầu vào (Không xóa file input.json)" type="info" showIcon style={{ marginBottom: 16 }} />
              <Form.Item name="delete_output" valuePropName="checked" label="Thư mục Output">
                <Switch checkedChildren="Xóa" unCheckedChildren="Giữ lại" />
              </Form.Item>
              <Alert title="Xóa toàn bộ tập tin trong thư mục kết quả đầu ra" type="info" showIcon style={{ marginBottom: 16 }} />
            </>
          )}

          {isBrowser && (
            <>
              <Divider style={{ margin: '24px 0' }} />
              <Form.Item name="debugMode" label="Chế độ Debug" valuePropName="checked">
                <Switch checkedChildren="Headed" unCheckedChildren="Headless" />
              </Form.Item>
              <Alert title={<span style={{ fontSize: '0.85rem' }}>Bật để hiển thị cửa sổ trình duyệt khi chạy</span>} type="info" showIcon style={{ marginBottom: 16, padding: '8px 12px' }} />
              <Alert title={<span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Hướng dẫn Selector</span>}
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
                  <Tag color="gold" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>INPUT_DIR</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Thư mục chứa file đầu vào (đã tải lên ở Dữ liệu Workflow)</div>
                </div>
                <div>
                  <Tag color="default" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>workflow_id</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>ID của workflow hiện tại</div>
                </div>
                <div>
                  <Tag color="default" style={{ fontFamily: 'var(--font-mono)', marginBottom: 4 }}>block_id</Tag>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>ID của khối Python này</div>
                </div>
              </div>
            </div>
          </>
        )}

        {isExcelToSql && (
          <>
            <Divider style={{ margin: '24px 0' }} />
            <Title level={5} style={{ margin: '0 0 16px 0' }}><Database size="1rem" style={{ display: 'inline', marginRight: 8, verticalAlign: -2 }}/> Cấu hình Nguồn</Title>
            {renderDbConnectionField('excelToSqlSavedConnectionId')}
            <Form.Item name="excelToSqlInputFile" label="Nguồn file Excel" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
              <AutoComplete placeholder="Chọn file hoặc nhập biến (VD: {{ten}})" options={availableFiles.map(f => ({ value: f.name }))} />
            </Form.Item>
            <Form.Item name="excelToSqlHeaderRow" label="Dòng tiêu đề (vd: 1 hoặc 3,4)" style={{ marginBottom: 16 }}>
              <Input placeholder="Mặc định: 1" />
            </Form.Item>
            <Button type="primary" block onClick={fetchDbTables} loading={loadingSchema}>
              Kiểm tra connect & Lấy bảng
            </Button>
            <Divider style={{ margin: '24px 0' }} />
            {renderVarNameField('excelToSqlRowsVarName', 'Lưu số dòng đã import vào biến', 'Mặc định trùng tên biến trả về ({{rows_inserted}}). Nếu workflow có nhiều khối Excel to SQL và muốn tránh bị ghi đè, đổi thành tên riêng.', 'VD: rows_inserted', { marginBottom: 12 })}
            {renderVarNameField('excelToSqlTableVarName', 'Lưu tên bảng đích vào biến', 'Mặc định trùng tên biến trả về ({{table}}). Nếu workflow có nhiều khối Excel to SQL và muốn tránh bị ghi đè, đổi thành tên riêng.', 'VD: table', { marginBottom: 16 })}
          </>
        )}

        {hasOutputVarField && (
          <>
            <Divider style={{ margin: '24px 0' }} />
            <Form.Item
              name="outputVarName"
              label={
                <Space size={4}>
                  Lưu tên file kết quả vào biến
                  <Tooltip title="Mặc định trùng tên biến trả về ({{file_name}}). Nếu workflow có nhiều khối cùng loại và muốn tránh bị ghi đè, đổi thành tên riêng.">
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
                  <Title level={4} style={{ margin: 0 }}>Bảng đích & Mapping</Title>
                </div>
                
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 16, border: '1px solid var(--border-default)', flex: 1, overflowY: 'auto' }}>
                  {(dbTables.length > 0 || (node.data && node.data.excelToSqlTableName)) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                      <Form.Item name="excelToSqlTableName" label="Tên bảng (Table Name)" rules={[{ required: true }]} style={{ marginBottom: 12 }}>
                        <Select
                          showSearch
                          filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                          placeholder="Chọn hoặc tìm kiếm tên bảng..."
                          options={
                            dbTables.length > 0
                              ? dbTables.map(t => ({label: t, value: t}))
                              : (node.data.excelToSqlTableName ? [{ label: node.data.excelToSqlTableName, value: node.data.excelToSqlTableName }] : [])
                          }
                        />
                      </Form.Item>
                      
                      <Form.Item name="excelToSqlImportMode" label="Chế độ ghi" style={{ marginBottom: 12 }}>
                        <Select options={[
                          { label: 'Thêm vào cuối (Append)', value: 'append' },
                          { label: 'Xoá và chèn lại (Truncate)', value: 'truncate' }
                        ]} />
                      </Form.Item>

                      <Button type="primary" onClick={fetchDbColumns} loading={loadingSchema} style={{ width: '100%', marginBottom: 12 }}>
                        Lấy cấu trúc Cột & File
                      </Button>

                      {dbColumns.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <Text strong>Bảng ghép cột (Mapping):</Text>
                          <Table
                            size="small"
                            pagination={false}
                            rowKey="name"
                            dataSource={dbColumns}
                            columns={[
                              { title: 'Cột SQL', dataIndex: 'name', render: t => <Text code>{t}</Text> },
                              { title: 'Kiểu DB', dataIndex: 'type', render: t => <Text type="secondary">{t}</Text> },
                              { 
                                title: 'Cột Excel tương ứng', 
                                dataIndex: 'name',
                                render: (sqlCol) => (
                                  <Select
                                    style={{ width: '100%' }}
                                    allowClear
                                    showSearch
                                    filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                                    placeholder="[ Bỏ qua / NULL ]"
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
                      <Text type="secondary">Vui lòng <strong>Kiểm tra connect</strong> ở cột bên trái trước để cấu hình Mapping.</Text>
                    </div>
                  )}
                </div>
              </div>
            ) : isRunSqlExec ? (
              <div style={{ padding: 24, flex: 1, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                  <Terminal size="1.5rem" color="#14b8a6" />
                  <Title level={4} style={{ margin: 0 }}>Câu lệnh SQL / EXEC</Title>
                </div>
                <Form.Item name="sqlCommand" rules={[{ required: true, message: 'Nhập câu lệnh cần thực thi' }]} style={{ flex: 1, marginBottom: 0, display: 'flex', flexDirection: 'column' }}>
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
                  <Title level={4} style={{ margin: 0 }}>Danh sách lệnh</Title>
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

              <Divider style={{ margin: '24px 0' }} />
              <Alert title={<span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Hướng dẫn cơ bản</span>}
                description={
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <div>• <b>Lệnh</b>: Nhập lệnh bắt đầu bằng <Text code style={{ fontSize: '0.75rem' }}>/</Text> (vd: <Text code style={{ fontSize: '0.75rem' }}>/start</Text>). Nhập <Text code style={{ fontSize: '0.75rem' }}>*</Text> hoặc để trống để bắt <b>mọi tin nhắn</b>.</div>
                    <div>• <b>Reply</b>: Bot trả lời ngay, không chạy workflow</div>
                    <div>• <b>WF</b>: Bot trả lời + chạy các block phía sau</div>
                    <div>• Dữ liệu truyền vào workflow: <Text code style={{ fontSize: '0.75rem' }}>{'{chat_id}'}</Text>, <Text code style={{ fontSize: '0.75rem' }}>{'{message_id}'}</Text>, <Text code style={{ fontSize: '0.75rem' }}>{'{text}'}</Text>, <Text code style={{ fontSize: '0.75rem' }}>{'{sender_name}'}</Text> (không có <Text code style={{ fontSize: '0.75rem' }}>{'{command}'}</Text> — tên lệnh chỉ dùng nội bộ để định tuyến, không truyền vào biến)</div>
                  </div>
                }
                type="info"
                showIcon
                style={{ marginBottom: 16, padding: '8px 12px' }}
              />

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <MessageCircle size="1.5rem" color="var(--accent-primary)" />
                <Title level={4} style={{ margin: 0 }}>Nội dung tin nhắn gửi đi</Title>
              </div>
              <Form.Item name="telegramMessage" rules={[{ required: true, message: 'Nhập nội dung tin nhắn' }]}>
                <Input.TextArea rows={12} placeholder="Nhập nội dung tin nhắn gửi đi... (có thể dùng biến {{biến_toàn_cục}})" style={{ fontFamily: 'monospace' }} />
              </Form.Item>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 16 }}>
                <Title level={5} style={{ margin: 0 }}>Hướng dẫn Định dạng Telegram ({telegramParseMode || 'HTML'})</Title>
              </div>
              
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: 16, border: '1px solid var(--border-default)', marginBottom: 24, overflowX: 'auto' }}>
                {(!telegramParseMode || telegramParseMode === 'None') ? (
                  <Alert title="Chế độ định dạng đang tắt"
                    description={
                      <Text>
                        Tin nhắn sẽ hiển thị văn bản thuần túy (Raw Text).<br/>
                        Hãy chọn HTML hoặc MarkdownV2 để sử dụng các tính năng in đậm, in nghiêng, chèn link,...
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
                <Title level={5} style={{ margin: 0 }}>Nội dung Email</Title>
              </div>
              <Form.Item
                label="Người nhận (To)"
                name="mailTo"
                rules={[{ required: true, message: 'Vui lòng nhập Email người nhận' }]}
              >
                <Select mode="tags" open={false} tokenSeparators={[',']} placeholder="Nhập Email rồi bấm Enter..." />
              </Form.Item>
              <Alert title="Gõ Email (hoặc biến {email}) rồi bấm Enter để thêm - có thể thêm nhiều người nhận" type="info" showIcon style={{ marginBottom: 16 }} />
              <Form.Item
                label="Người nhận (CC)"
                name="mailCc"
              >
                <Select mode="tags" open={false} tokenSeparators={[',']} placeholder="Nhập Email CC rồi bấm Enter..." />
              </Form.Item>
              <Alert title="Gõ Email rồi bấm Enter để thêm - có thể thêm nhiều người nhận" type="info" showIcon style={{ marginBottom: 16 }} />
              <Form.Item label="Tiêu đề Email (Subject)" name="mailSubject" rules={[{ required: true, message: 'Vui lòng nhập Tiêu đề' }]}>
                <Input placeholder="Nhập tiêu đề (Hỗ trợ định dạng biến {name})" />
              </Form.Item>
              <Form.Item label="Nội dung Email (Body)" name="mailBody">
                <Input.TextArea rows={12} placeholder="Nhập nội dung thư (Hỗ trợ định dạng biến {name})" style={{ fontFamily: 'var(--font-mono)' }} />
              </Form.Item>
              <Form.Item label="Đính kèm File" name="mailAttachments">
                <Select mode="tags" loading={loadingFiles} placeholder="Chọn file có sẵn hoặc gõ tên file / {biến} và Enter" style={{ width: '100%' }}>
                  {availableFiles.map(f => (
                    <Select.Option key={f.name} value={f.name}>{f.name}</Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Alert title="Mẹo: Gõ tên file bất kỳ (VD: merged.xlsx, bao_cao.pdf) và bấm phím Enter. Hệ thống sẽ tự động tìm file đó ở thư mục Đầu vào hoặc Đầu ra khi chạy." type="info" showIcon style={{ marginBottom: 16 }} />
            </div>
          ) : isMergeExcel ? (
            <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <Title level={5} style={{ margin: 0 }}>Chọn file cần ghép</Title>
              </div>

              {/* Toggle chọn tất cả Input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border-default)' }}>
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
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Chọn tất cả file đầu vào (Input)</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Tự động ghép tất cả file trong thư mục Input theo thứ tự tên</div>
                </div>
              </div>

              {/* Nếu tắt → Hiện 2 tab chọn nguồn */}
              {!mergeAllInput && (
                <>
                  <Radio.Group 
                    value={mergeFileSource} 
                    onChange={e => setMergeFileSource(e.target.value)} 
                    style={{ marginBottom: 14 }}
                    buttonStyle="solid"
                    size="small"
                  >
                    <Radio.Button value="input">File Đầu vào (Input)</Radio.Button>
                    <Radio.Button value="output">File Đầu ra (Output)</Radio.Button>
                  </Radio.Group>

                  <Alert title={<span style={{ fontSize: '0.85rem' }}><b>Ghi chú:</b> File đầu tiên được chọn sẽ giữ nguyên dòng tiêu đề (Header). Các file theo sau sẽ bị bỏ dòng tiêu đề khi ghép để dữ liệu liên tục.</span>} type="info" showIcon style={{ marginBottom: 16, padding: '8px 12px' }} />

                  <Form.Item
                    name="selectedFiles"
                    label="Thứ tự các file cần ghép"
                    rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 file' }]}
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
                <div style={{ marginTop: 16 }}>
                  {loadingFiles ? (
                    <Alert title="Đang tải..." type="info" showIcon />
                  ) : availableFiles.filter(f => f.type === 'input').length === 0 ? (
                    <Alert title="Chưa có file nào trong thư mục Input." type="warning" showIcon />
                  ) : (
                    <div style={{ background: 'rgba(14, 165, 233, 0.05)', border: '1px solid rgba(14, 165, 233, 0.2)', padding: '10px 14px', borderRadius: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0ea5e9', fontWeight: 600, fontSize: '0.85rem' }}>
                        <Info size={14} /> File sẽ được ghép (tất cả Input):
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8, fontSize: '0.8rem' }}>
                        {availableFiles.filter(f => f.type === 'input').map((f, i) => (
                          <div key={f.name} style={{ display: 'flex', gap: 8 }}>
                            <span style={{ color: 'var(--accent-primary)', fontWeight: 600, minWidth: 20 }}>{i + 1}.</span>
                            <span style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : isPivotExcel ? (
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
                <TableProperties size="1.25rem" color="var(--accent-primary)" />
                <Title level={5} style={{ margin: 0 }}>Cấu hình PivotTable</Title>
              </div>

              {columnError && (
                <Alert title={columnError} type="warning" showIcon style={{ marginBottom: 16 }} />
              )}
              
              <Form.Item label="Trường Dòng (Rows)" name="pivotIndex">
                <Select mode="tags" loading={loadingColumns} placeholder="Click để chọn cột hoặc gõ chữ cái A, B, C... và Enter">
                  {availableColumns.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                </Select>
              </Form.Item>
              <Alert title="Hỗ trợ tên cột hoặc chữ cái A,B,C... (VD: Khu Vực, A, B)" type="info" showIcon style={{ marginBottom: 16 }} />
              
              <Form.Item label="Trường Cột (Columns)" name="pivotColumns">
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
              <Alert title="Hỗ trợ tên cột hoặc chữ cái A,B,C... (VD: Nhóm Hàng, C)" type="info" showIcon style={{ marginBottom: 16 }} />
              
              <Form.Item label="Trường Giá trị (Values)" name="pivotValues" rules={[{ required: true, message: 'Nhập ít nhất 1 trường Giá trị' }]}>
                <Select mode="tags" loading={loadingColumns} placeholder="Click để chọn cột hoặc gõ chữ cái A, B, C... và Enter">
                  {availableColumns.map(c => <Select.Option key={c} value={c}>{c}</Select.Option>)}
                </Select>
              </Form.Item>
              <Alert title="Hỗ trợ tên cột hoặc chữ cái A,B,C... (VD: Sản Lượng, D)" type="info" showIcon style={{ marginBottom: 16 }} />

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

              <Divider style={{ margin: '24px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Title level={5} style={{ margin: 0 }}>Cấu hình Sắp xếp (Nâng cao)</Title>
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
                    <>
                      <Form.Item label="Thứ tự Tùy chỉnh (Kéo thả hoặc nhập tay)" name="pivotSortCustom">
                        <Select mode="tags" loading={loadingCustomSort} placeholder={loadingCustomSort ? "Đang quét dữ liệu..." : "Nhập hoặc kéo thả thứ tự..."}>
                          {customSortValues.map(v => <Select.Option key={v} value={v}>{v}</Select.Option>)}
                        </Select>
                      </Form.Item>
                      <Alert title="Hệ thống tự quét dữ liệu trong file. Bạn có thể xóa/sắp xếp lại các thẻ để định hình thứ tự." type="info" showIcon style={{ marginBottom: 16 }} />
                    </>
                  )}
                </div>
              )}
            </div>
          ) : isBrowser ? (
            <BrowserStepEditorPanel steps={browserSteps} onChange={setBrowserSteps} />
          ) : (
            <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-default)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {isPython ? 'Python Code' : 'SQL Query'}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                <Sparkles size={12} color="var(--accent-primary)" />
                Ctrl+I: AI viết code
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
              height="100%"
              language={isPython ? "python" : "sql"}
              theme={theme === 'light' ? "light" : "vs-dark"}
              value={isPython ? code : sqlCode}
              onChange={(value) => isPython ? setCode(value) : setSqlCode(value)}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, handleAiPromptOpen);
              }}
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
                    placeholder="VD: Viết hàm đọc file Excel và lọc các dòng bị trống..."
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    onKeyDown={handleAiKeyDown}
                    autoSize={{ minRows: 1, maxRows: 3 }}
                    bordered={false}
                    disabled={aiGenerating}
                    style={{ flex: 1, padding: '4px 0', boxShadow: 'none', background: 'transparent' }}
                  />
                  <Button 
                    type="text" 
                    icon={aiGenerating ? <Square size={16} /> : <Send size={16} />} 
                    onClick={aiGenerating ? closeAiPrompt : handleAiSubmit}
                    style={{ marginLeft: 8, flexShrink: 0, color: aiGenerating ? '#ff4d4f' : 'var(--accent-primary)' }}
                  />
                </div>

                {/* Preview area */}
                {aiGeneratedCode && (
                  <div style={{ padding: '8px 12px', background: 'var(--bg-surface)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      Preview (Nhấn Enter để chèn, Esc để huỷ)
                    </div>
                    <div style={{ 
                      maxHeight: 200, 
                      overflowY: 'auto', 
                      background: 'var(--bg-base)', 
                      padding: 8, 
                      borderRadius: 4,
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '0.8rem',
                      whiteSpace: 'pre-wrap',
                      border: '1px solid var(--border-default)'
                    }}>
                      {aiGeneratedCode}
                      {aiGenerating && <span style={{ display: 'inline-block', width: 4, height: 12, background: 'var(--accent-primary)', animation: 'blink 1s step-end infinite', marginLeft: 2 }} />}
                    </div>
                    
                    {!aiGenerating && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                        <Button size="small" icon={<X size={14} />} onClick={closeAiPrompt}>Huỷ bỏ</Button>
                        <Button size="small" type="primary" icon={<Check size={14} />} onClick={acceptAiCode}>Chấp nhận</Button>
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

