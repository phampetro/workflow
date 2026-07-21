import React, { useState, useEffect } from 'react'
import { Drawer, Button, Tabs, Table, Upload, Space, Popconfirm, Tag, Card, Modal, Form, Input, Select, App } from 'antd'
import Editor from '@monaco-editor/react'
import { updateWorkflowInput, getWorkflowFiles, uploadWorkflowFile, deleteWorkflowFile, getWorkflowOutputFiles, deleteWorkflowOutputFile, openWorkflowFile, openWorkflowOutputFile, getDbConnections, createDbConnection, updateDbConnection, deleteDbConnection, getDatabaseTables } from '../api/client'
import { UploadCloud, Trash2, FileText, Eye, Download, FolderOpen, Database, Plug, Pencil } from 'lucide-react'
import useStore from '../store/useStore'

const { Dragger } = Upload

export default function InputJsonModal({ open, onClose, workflowId, projectId, initialData }) {
  const { message } = App.useApp()
  const theme = useStore(state => state.theme)
  const [jsonText, setJsonText] = useState('{}')
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('json')

  const [files, setFiles] = useState([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [outFiles, setOutFiles] = useState([])
  const [loadingOutFiles, setLoadingOutFiles] = useState(false)

  const [selectedInputRowKeys, setSelectedInputRowKeys] = useState([])
  const [selectedOutputRowKeys, setSelectedOutputRowKeys] = useState([])

  const [dbConnections, setDbConnections] = useState([])
  const [loadingDbConnections, setLoadingDbConnections] = useState(false)
  const [dbConnModalOpen, setDbConnModalOpen] = useState(false)
  const [editingConnection, setEditingConnection] = useState(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [savingConnection, setSavingConnection] = useState(false)
  const [dbConnForm] = Form.useForm()

  useEffect(() => {
    if (open) {
      setJsonText(JSON.stringify(initialData || {}, null, 2))
      setActiveTab('json')
      loadFiles()
      loadDbConnections()
    }
  }, [open, initialData])

  const loadDbConnections = async () => {
    if (!workflowId) return
    setLoadingDbConnections(true)
    try {
      const res = await getDbConnections(workflowId)
      setDbConnections(res.data || [])
    } catch (e) {
      message.error('Lỗi tải danh sách kết nối: ' + e.message)
    } finally {
      setLoadingDbConnections(false)
    }
  }

  const openDbConnModal = (connection) => {
    setEditingConnection(connection || null)
    dbConnForm.setFieldsValue(connection || { db_type: 'sqlserver', label: '', host: '', port: '', username: '', password: '', dbname: '' })
    setDbConnModalOpen(true)
  }

  const handleTestConnection = async () => {
    try {
      const values = await dbConnForm.validateFields()
      setTestingConnection(true)
      await getDatabaseTables({
        project_id: projectId,
        db_type: values.db_type,
        server: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        dbname: values.dbname,
      })
      message.success('Kết nối thành công!')
    } catch (e) {
      if (e.errorFields) return
      message.error('Kết nối thất bại: ' + (e.response?.data?.detail || e.message))
    } finally {
      setTestingConnection(false)
    }
  }

  const handleSaveConnection = async () => {
    try {
      const values = await dbConnForm.validateFields()
      setSavingConnection(true)
      if (editingConnection?.id) {
        await updateDbConnection(editingConnection.id, { ...values, workflow_id: workflowId })
      } else {
        await createDbConnection({ ...values, workflow_id: workflowId })
      }
      message.success('Đã lưu kết nối!')
      setDbConnModalOpen(false)
      loadDbConnections()
    } catch (e) {
      if (e.errorFields) return
      message.error('Lỗi khi lưu: ' + (e.response?.data?.detail || e.message))
    } finally {
      setSavingConnection(false)
    }
  }

  const handleDeleteConnection = async (id) => {
    try {
      await deleteDbConnection(id)
      message.success('Đã xoá kết nối')
      loadDbConnections()
    } catch (e) {
      message.error('Lỗi khi xoá: ' + e.message)
    }
  }

  const loadFiles = async () => {
    if (!workflowId) return
    setLoadingFiles(true)
    setLoadingOutFiles(true)
    try {
      const [resIn, resOut] = await Promise.all([
        getWorkflowFiles(workflowId).catch(() => ({ data: [] })),
        getWorkflowOutputFiles(workflowId).catch(() => ({ data: [] }))
      ])

      const inputFiles = (resIn.data || []).filter(f => f.source !== 'output')
      setFiles(inputFiles)
      setOutFiles(resOut.data || [])
    } catch (e) {
      message.error('Lỗi tải danh sách tệp: ' + e.message)
    } finally {
      setLoadingFiles(false)
      setLoadingOutFiles(false)
    }
  }

  const handleDeleteFile = async (filename) => {
    try {
      await deleteWorkflowFile(workflowId, filename)
      message.success('Đã xóa tệp: ' + filename)
      loadFiles()
    } catch (e) {
      message.error('Lỗi khi xóa tệp: ' + e.message)
    }
  }

  const handleDeleteOutFile = async (filename) => {
    try {
      await deleteWorkflowOutputFile(workflowId, filename)
      message.success('Đã xóa tệp: ' + filename)
      loadFiles()
    } catch (e) {
      message.error('Lỗi khi xóa tệp: ' + e.message)
    }
  }

  const handleBatchDelete = async (isOutput) => {
    const keys = isOutput ? selectedOutputRowKeys : selectedInputRowKeys;
    if (keys.length === 0) return;
    try {
      for (const key of keys) {
        if (isOutput) await deleteWorkflowOutputFile(workflowId, key);
        else await deleteWorkflowFile(workflowId, key);
      }
      message.success(`Đã xóa ${keys.length} tệp`);
      if (isOutput) setSelectedOutputRowKeys([]);
      else setSelectedInputRowKeys([]);
      loadFiles();
    } catch (e) {
      message.error('Lỗi khi xóa: ' + e.message);
    }
  }

  const handleBatchDownload = async (isOutput) => {
    const keys = isOutput ? selectedOutputRowKeys : selectedInputRowKeys;
    if (keys.length === 0) return;
    for (const key of keys) {
      handleDownload(key, isOutput);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const handleView = async (filename, isOutput) => {
    try {
      if (isOutput) {
        await openWorkflowOutputFile(workflowId, filename)
      } else {
        await openWorkflowFile(workflowId, filename)
      }
      message.success('Đã mở tệp!')
    } catch (e) {
      message.error('Lỗi mở tệp: ' + e.message)
    }
  }

  const handleDownload = (filename, isOutput) => {
    const a = document.createElement('a')
    a.href = `http://localhost:7000/api/workflows/${workflowId}/${isOutput ? 'output-files' : 'files'}/${encodeURIComponent(filename)}/download?download=1`
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleSaveJson = async () => {
    try {
      const parsed = JSON.parse(jsonText)
      setSaving(true)
      await updateWorkflowInput(workflowId, parsed)
      message.success('Đã lưu cấu hình!')
      onClose(parsed)
    } catch (e) {
      message.error('Lỗi JSON: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (activeTab === 'files' || activeTab === 'output' || activeTab === 'database') {
      onClose(initialData)
    } else {
      onClose()
    }
  }

  const uploadProps = {
    name: 'file',
    multiple: true,
    customRequest: async ({ file, onSuccess, onError }) => {
      const formData = new FormData()
      formData.append('file', file)
      try {
        await uploadWorkflowFile(workflowId, formData)
        onSuccess("ok")
        message.success(`${file.name} tải lên thành công.`)
        loadFiles()
      } catch (e) {
        onError(e)
        message.error(`${file.name} tải lên thất bại.`)
      }
    },
    showUploadList: false
  }

  const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 B'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
  }

  const getColumns = (isOutput) => [
    {
      title: 'Tên tệp',
      dataIndex: 'name',
      key: 'name',
      render: (text) => (
        <Space>
          <FileText size={14} color="var(--accent-primary)" />
          <span>{text}</span>
        </Space>
      )
    },
    {
      title: 'Kích thước',
      dataIndex: 'size',
      key: 'size',
      width: 100,
      render: (size) => <Tag variant="filled" style={{ margin: 0 }}>{formatBytes(size)}</Tag>
    },
    {
      title: '',
      key: 'action',
      width: 120,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Button type="text" size="small" icon={<Eye size={14} />} onClick={() => handleView(record.name, isOutput)} aria-label="Xem trước tệp" />
          <Button type="text" size="small" icon={<Download size={14} />} onClick={() => handleDownload(record.name, isOutput)} aria-label="Tải tệp về máy" />
          <Popconfirm title="Xóa tệp?" onConfirm={() => isOutput ? handleDeleteOutFile(record.name) : handleDeleteFile(record.name)}>
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} aria-label="Xóa tệp" />
          </Popconfirm>
        </Space>
      )
    }
  ]

  const tabItems = [
    {
      key: 'json',
      label: 'Biến môi trường',
      children: (
        <div>
          <p style={{ margin: '0 0 12px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Khai báo biến JSON để sử dụng trong Workflow.
          </p>
          <div style={{ height: 'calc(100vh - 300px)', border: '1px solid var(--border-default)', borderRadius: 8, overflow: 'hidden' }}>
            <Editor
              height="100%"
              defaultLanguage="json"
              value={jsonText}
              theme={theme === 'light' ? 'light' : 'vs-dark'}
              onChange={val => setJsonText(val || '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                formatOnPaste: true,
                scrollBeyondLastLine: false
              }}
            />
          </div>
        </div>
      )
    },
    {
      key: 'files',
      label: (
        <Space>
          <FolderOpen size={14} />
          Tệp đính kèm ({files.length})
        </Space>
      ),
      children: (
        <div>
          {selectedInputRowKeys.length > 0 && (
            <Space style={{ marginBottom: 12 }}>
              <Tag>{selectedInputRowKeys.length} tệp chọn</Tag>
              <Button size="small" icon={<Download size={14} />} onClick={() => handleBatchDownload(false)}>Tải xuống</Button>
              <Button size="small" danger icon={<Trash2 size={14} />} onClick={() => handleBatchDelete(false)}>Xóa</Button>
            </Space>
          )}
          <Dragger {...uploadProps} style={{ marginBottom: 12 }}>
            <p style={{ margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <UploadCloud size={24} color="var(--accent-primary)" />
              <span>Kéo thả hoặc nhấp để tải tệp lên</span>
            </p>
          </Dragger>
          <Table
            rowSelection={{ selectedRowKeys: selectedInputRowKeys, onChange: setSelectedInputRowKeys }}
            dataSource={files}
            columns={getColumns(false)}
            rowKey="name"
            size="small"
            pagination={false}
            loading={loadingFiles}
            locale={{ emptyText: 'Chưa có tệp nào' }}
          />
        </div>
      )
    },
    {
      key: 'output',
      label: (
        <Space>
          <Download size={14} />
          Kết quả ({outFiles.length})
        </Space>
      ),
      children: (
        <div>
          {selectedOutputRowKeys.length > 0 && (
            <Space style={{ marginBottom: 12 }}>
              <Tag>{selectedOutputRowKeys.length} tệp chọn</Tag>
              <Button size="small" icon={<Download size={14} />} onClick={() => handleBatchDownload(true)}>Tải xuống</Button>
              <Button size="small" danger icon={<Trash2 size={14} />} onClick={() => handleBatchDelete(true)}>Xóa</Button>
            </Space>
          )}
          <Table
            rowSelection={{ selectedRowKeys: selectedOutputRowKeys, onChange: setSelectedOutputRowKeys }}
            dataSource={outFiles}
            columns={getColumns(true)}
            rowKey="name"
            size="small"
            pagination={false}
            loading={loadingOutFiles}
            locale={{ emptyText: 'Chưa có tệp kết quả' }}
          />
        </div>
      )
    },
    {
      key: 'database',
      label: (
        <Space>
          <Database size={14} />
          Database ({dbConnections.length})
        </Space>
      ),
      children: (
        <div>
          <Button type="primary" icon={<Plug size={14} />} style={{ marginBottom: 12 }} onClick={() => openDbConnModal(null)}>
            Thêm kết nối
          </Button>
          <Table
            dataSource={dbConnections}
            rowKey="id"
            size="small"
            pagination={false}
            loading={loadingDbConnections}
            locale={{ emptyText: 'Chưa có kết nối nào' }}
            columns={[
              { title: 'Tên', dataIndex: 'label' },
              { title: 'Loại DB', dataIndex: 'db_type' },
              { title: 'Host', dataIndex: 'host' },
              { title: 'Database', dataIndex: 'dbname' },
              {
                title: '',
                key: 'action',
                width: 90,
                align: 'center',
                render: (_, record) => (
                  <Space size={4}>
                    <Button type="text" size="small" icon={<Pencil size={14} />} onClick={() => openDbConnModal(record)} aria-label="Sửa kết nối Database" />
                    <Popconfirm title="Xoá kết nối?" onConfirm={() => handleDeleteConnection(record.id)}>
                      <Button type="text" size="small" danger icon={<Trash2 size={14} />} aria-label="Xoá kết nối Database" />
                    </Popconfirm>
                  </Space>
                )
              }
            ]}
          />
        </div>
      )
    }
  ]

  return (
    <>
    <Drawer
      title={
        <Space>
          <FileText size={16} color="var(--accent-primary)" />
          <span style={{ fontWeight: 600 }}>Dữ liệu Workflow</span>
        </Space>
      }
      open={open}
      onClose={handleClose}
      size="large"
      placement="right"
      styles={{ body: { padding: 16 } }}
      extra={
        activeTab === 'json' ? (
          <Space>
            <Button onClick={handleClose}>Hủy</Button>
            <Button type="primary" loading={saving} onClick={handleSaveJson}>Lưu</Button>
          </Space>
        ) : (
          <Button type="primary" onClick={handleClose}>Đóng</Button>
        )
      }
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Drawer>

    <Modal
      title={editingConnection?.id ? 'Sửa kết nối Database' : 'Thêm kết nối Database'}
      open={dbConnModalOpen}
      onCancel={() => setDbConnModalOpen(false)}
      footer={[
        <Button key="test" onClick={handleTestConnection} loading={testingConnection}>Test kết nối</Button>,
        <Button key="cancel" onClick={() => setDbConnModalOpen(false)}>Hủy</Button>,
        <Button key="save" type="primary" onClick={handleSaveConnection} loading={savingConnection}>Lưu</Button>,
      ]}
      destroyOnHidden
    >
      <Form form={dbConnForm} layout="vertical">
        <Form.Item name="label" label="Tên kết nối" rules={[{ required: true, message: 'Nhập tên kết nối' }]}>
          <Input placeholder="VD: DMS Report Server" />
        </Form.Item>
        <Form.Item name="db_type" label="Loại Database" rules={[{ required: true }]}>
          <Select>
            <Select.Option value="postgresql">PostgreSQL</Select.Option>
            <Select.Option value="mysql">MySQL</Select.Option>
            <Select.Option value="sqlite">SQLite</Select.Option>
            <Select.Option value="sqlserver">SQL Server</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="host" label="Host">
          <Input placeholder="VD: 118.69.76.220 hoặc localhost" />
        </Form.Item>
        <Form.Item name="port" label="Port">
          <Input placeholder="VD: 1433" />
        </Form.Item>
        <Form.Item name="username" label="User">
          <Input placeholder="Tên đăng nhập" />
        </Form.Item>
        <Form.Item name="password" label="Password">
          <Input.Password placeholder="Mật khẩu" />
        </Form.Item>
        <Form.Item name="dbname" label="Tên Database">
          <Input placeholder="VD: DMS_Report" />
        </Form.Item>
      </Form>
    </Modal>
    </>
  )
}
