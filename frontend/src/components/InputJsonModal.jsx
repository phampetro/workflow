import React, { useState, useEffect } from 'react'
import { Drawer, Button, message, Tabs, Table, Upload, Space, Popconfirm, Tag, Card } from 'antd'
import Editor from '@monaco-editor/react'
import { updateWorkflowInput, getWorkflowFiles, uploadWorkflowFile, deleteWorkflowFile, getWorkflowOutputFiles, deleteWorkflowOutputFile, openWorkflowFile, openWorkflowOutputFile } from '../api/client'
import { UploadCloud, Trash2, FileText, Eye, Download, FolderOpen } from 'lucide-react'
import useStore from '../store/useStore'

const { Dragger } = Upload

export default function InputJsonModal({ open, onClose, workflowId, initialData }) {
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

  useEffect(() => {
    if (open) {
      setJsonText(JSON.stringify(initialData || {}, null, 2))
      setActiveTab('json')
      loadFiles()
    }
  }, [open, initialData])

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
    a.href = `http://localhost:8000/api/workflows/${workflowId}/${isOutput ? 'output-files' : 'files'}/${encodeURIComponent(filename)}/download?download=1`
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
    if (activeTab === 'files' || activeTab === 'output') {
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
      render: (size) => <Tag bordered={false} style={{ margin: 0 }}>{formatBytes(size)}</Tag>
    },
    {
      title: '',
      key: 'action',
      width: 120,
      align: 'center',
      render: (_, record) => (
        <Space size={4}>
          <Button type="text" size="small" icon={<Eye size={14} />} onClick={() => handleView(record.name, isOutput)} />
          <Button type="text" size="small" icon={<Download size={14} />} onClick={() => handleDownload(record.name, isOutput)} />
          <Popconfirm title="Xóa tệp?" onConfirm={() => isOutput ? handleDeleteOutFile(record.name) : handleDeleteFile(record.name)}>
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} />
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
              <Button size="small" icon={<Download size={14} />} onClick={() => handleBatchDownload(false)}>Tải</Button>
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
              <Button size="small" icon={<Download size={14} />} onClick={() => handleBatchDownload(true)}>Tải</Button>
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
    }
  ]

  return (
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
  )
}
