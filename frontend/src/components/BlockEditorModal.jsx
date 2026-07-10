import React, { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { getWorkflowFiles, getFileColumns, getFileColumnValues } from '../api/client'
import { Code2, Info, Box, Mail, TableProperties } from 'lucide-react'
import { Drawer, Form, Input, InputNumber, Button, Space, Typography, Tag, Divider, Select, AutoComplete, message, Radio, Switch, Table } from 'antd'
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

export default function BlockEditorModal({ node, open, onClose, onSave, inputKeys = [], workflowId }) {
  const theme = useStore(state => state.theme)
  const [form] = Form.useForm()
  const [code, setCode] = useState(node.data.code || BLOCK_TEMPLATES.python.default)
  const [sqlCode, setSqlCode] = useState(node.data.sqlQuery || DEFAULT_SQL_QUERY)
  const [activeTemplate, setActiveTemplate] = useState('default')
  
  const [availableFiles, setAvailableFiles] = useState([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [mergeAllInput, setMergeAllInput] = useState(node.data.mergeAllInput !== false) // default ON
  const [mergeFileSource, setMergeFileSource] = useState(node.data.mergeFileSource || 'input') // 'input' | 'output'
  
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
  const isTelegram = node.data.type === 'telegram'
  const isEmail = node.data.type === 'email'
  const isDatabase = node.data.type === 'database'
  const isSqlToExcel = node.data.type === 'sql_to_excel'
  const isMergeExcel = node.data.type === 'merge_excel'
  const isPivotExcel = node.data.type === 'pivot_excel'

  const hasCodeEditor = isPython || isSqlToExcel
  const hasRightPanel = hasCodeEditor || isEmail || isPivotExcel || isMergeExcel

  const autoCompleteOptions = inputKeys.map(k => ({ value: k }))

  useEffect(() => {
    if ((isMergeExcel || isEmail || isPivotExcel) && open && workflowId) {
      const fetchFiles = async () => {
        setLoadingFiles(true)
        try {
          const res = await getWorkflowFiles(workflowId)
          let files = res.data || []
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
  }, [isMergeExcel, open, workflowId])

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
        ...(isMergeExcel ? { mergeAllInput, mergeFileSource } : {})
      })
      message.success('Đã lưu cấu hình khối!')
    } catch (e) {
      console.log('Validate failed:', e)
    }
  }

  const applyTemplate = (key) => {
    setCode(BLOCK_TEMPLATES.python[key])
    setActiveTemplate(key)
  }

  return (
    <Drawer
      title={<Space><Code2 size={18} color="var(--accent-primary)" /> Chỉnh sửa Block</Space>}
      width={hasRightPanel ? '75vw' : 360}
      onClose={onClose}
      open={true}
      maskClosable={false}
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
        style={{ display: 'flex', width: '100%', height: '100%' }}
        initialValues={{
            label: node.data.label || '',
            description: node.data.description || '',
            condVariable: node.data.condVariable || '',
            condOperator: node.data.condOperator || '==',
            condValue: node.data.condValue || '',
            delaySeconds: node.data.delaySeconds || 3,
            telegramBotToken: node.data.telegramBotToken || '',
            telegramChatId: node.data.telegramChatId || '',
            telegramMessage: node.data.telegramMessage || '',
            telegramParseMode: node.data.telegramParseMode || 'HTML',
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
            mailTo: node.data.mailTo || '',
            mailCc: node.data.mailCc || '',
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
          }}
        >
          <div style={{ width: hasRightPanel ? 360 : '100%', padding: 24, borderRight: hasRightPanel ? '1px solid var(--border-default)' : 'none', overflowY: 'auto' }}>
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
              <Form.Item name="condVariable" label="Biến so sánh" rules={[{ required: true, message: 'Nhập tên biến' }]}>
                <Input placeholder="VD: status" />
              </Form.Item>
              <Form.Item name="condOperator" label="Toán tử">
                <Select>
                  <Select.Option value="==">Bằng (==)</Select.Option>
                  <Select.Option value="!=">Khác (!=)</Select.Option>
                  <Select.Option value=">">Lớn hơn (&gt;)</Select.Option>
                  <Select.Option value="<">Nhỏ hơn (&lt;)</Select.Option>
                  <Select.Option value=">=">Lớn hơn/Bằng (&gt;=)</Select.Option>
                  <Select.Option value="<=">Nhỏ hơn/Bằng (&lt;=)</Select.Option>
                  <Select.Option value="contains">Chứa (contains)</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="condValue" label="Giá trị mốc" rules={[{ required: true, message: 'Nhập giá trị' }]}>
                <Input placeholder="VD: success" />
              </Form.Item>
              <div style={{ background: 'var(--bg-card)', padding: '8px 12px', borderRadius: 6, fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 24, border: '1px solid var(--border-default)' }}>
                <Box size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
                Biến so sánh là các key (trường dữ liệu) nằm trong gói <b>output_data</b> được truyền từ khối liền trước nó.
              </div>
            </>
          )}

          {isDelay && (
            <Form.Item label="Thời gian chờ (giây)" name="delaySeconds" rules={[{ required: true, message: 'Nhập số giây' }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          )}

          {isTelegram && (
            <>
              <Form.Item label="Bot Token" name="telegramBotToken" rules={[{ required: true, message: 'Nhập Bot Token' }]}>
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập mã hoặc chọn biến" allowClear />
              </Form.Item>
              <Form.Item label="ID Người nhận / Nhóm" name="telegramChatId" rules={[{ required: true, message: 'Nhập Chat ID' }]}>
                <AutoComplete options={autoCompleteOptions} placeholder="Nhập ID hoặc chọn biến" allowClear />
              </Form.Item>
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
            <Form.Item name="excelFileName" label="Tên file Excel kết quả" rules={[{ required: true, message: 'Nhập tên file' }]}>
              <Input placeholder="VD: bao_cao_thang.xlsx" />
            </Form.Item>
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
              <Text strong style={{ display: 'block', marginBottom: 12 }}><Box size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }}/> Biến có sẵn</Text>
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

      {/* Code Editor Panel or Email/Pivot Right Panel */}
      {hasRightPanel && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: theme === 'light' ? '#fff' : '#1e1e1e', overflowY: 'auto' }}>
          {isEmail ? (
            <div style={{ padding: 24, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
                <Mail size={20} color="var(--accent-primary)" />
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Nội dung Email</h3>
              </div>
              <Form.Item label="Người nhận (To)" name="mailTo" rules={[{ required: true, message: 'Vui lòng nhập Email người nhận' }]}>
                <Input placeholder="Nhập Email (có thể dùng biến {email})" />
              </Form.Item>
              <Form.Item label="Người nhận (CC)" name="mailCc">
                <Input placeholder="Nhập Email CC (ngăn cách bởi dấu phẩy)" />
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
                      const inputFiles = availableFiles.filter(f => f.source === 'input')
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
                      files={availableFiles.filter(f => f.source === mergeFileSource)}
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
                  ) : availableFiles.filter(f => f.source === 'input').length === 0 ? (
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Chưa có file nào trong thư mục Input.</div>
                  ) : (
                    availableFiles.filter(f => f.source === 'input').map((f, i) => (
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
                <TableProperties size={20} color="var(--accent-primary)" />
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
          ) : (
            <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: theme === 'light' ? '#f5f5f5' : '#252526', borderBottom: theme === 'light' ? '1px solid #d9d9d9' : '1px solid #3c3c3c' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: theme === 'light' ? '#333' : '#e5e5e5' }}>
              {isPython ? 'Python Code' : 'SQL Query'}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
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
