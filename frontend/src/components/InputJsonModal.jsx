import React, { useState, useEffect } from 'react'
import { Drawer, Button, message, Tabs, Table, Upload, Space, Popconfirm } from 'antd'
import Editor from '@monaco-editor/react'
import { updateWorkflowInput, getWorkflowFiles, uploadWorkflowFile, deleteWorkflowFile, getWorkflowOutputFiles, deleteWorkflowOutputFile, openWorkflowFile, openWorkflowOutputFile } from '../api/client'
import { UploadCloud, Trash2, FileText, Eye, Download } from 'lucide-react'
import useStore from '../store/useStore'

const { Dragger } = Upload

export default function InputJsonModal({ open, onClose, workflowId, initialData }) {
  const theme = useStore(state => state.theme)
  const [jsonText, setJsonText] = useState('{}')
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('json')

  // File management states
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

  const getFileUrl = (filename, isOutput, download) => {
    const type = isOutput ? 'output-files' : 'files'
    return `http://localhost:8000/api/workflows/${workflowId}/${type}/${encodeURIComponent(filename)}/download${download ? '?download=1' : ''}`
  }

  const handleView = async (filename, isOutput) => {
    try {
      if (isOutput) {
        await openWorkflowOutputFile(workflowId, filename)
      } else {
        await openWorkflowFile(workflowId, filename)
      }
      message.success('Đã mở tệp trên máy tính!')
    } catch (e) {
      message.error('Lỗi mở tệp: ' + e.message)
    }
  }

  const handleDownload = (filename, isOutput) => {
    const a = document.createElement('a')
    a.href = getFileUrl(filename, isOutput, true)
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
      message.success('Đã lưu cấu hình biến môi trường!')
      onClose(parsed) // pass updated data back
    } catch (e) {
      message.error('Lỗi định dạng JSON: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    if (activeTab === 'files' || activeTab === 'output') {
      onClose(initialData) // return original json data unchanged when closing from files tab

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
    if (!+bytes) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
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
          <FileText size={16} color="var(--accent-primary)" />
          <span style={{ color: 'var(--text-primary)' }}>{text}</span>
        </Space>
      )
    },
    {
      title: 'Kích thước',
      dataIndex: 'size',
      key: 'size',
      render: (size) => <span style={{ color: 'var(--text-muted)' }}>{formatBytes(size)}</span>
    },
    {
      title: 'Hành động',
      key: 'action',
      render: (_, record) => (
        <Space>
          <Button type="text" icon={<Eye size={16} />} onClick={() => handleView(record.name, isOutput)} title="Xem" />
          <Button type="text" icon={<Download size={16} />} onClick={() => handleDownload(record.name, isOutput)} title="Tải xuống" />
          <Popconfirm
            title="Bạn có chắc chắn muốn xóa tệp này?"
            onConfirm={() => isOutput ? handleDeleteOutFile(record.name) : handleDeleteFile(record.name)}
            okText="Xóa"
            cancelText="Hủy"
          >
            <Button type="text" danger icon={<Trash2 size={16} />} title="Xóa" />
          </Popconfirm>
        </Space>
      )
    }
  ]

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileText size={18} color="var(--accent-primary)" /> 
          <span>Dữ liệu Workflow</span>
        </div>
      }
      open={open}
      onClose={handleClose}
      maskClosable={false}
      width="50vw"
      placement="right"
      bodyStyle={{ padding: 16 }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {activeTab === 'json' ? (
            <>
              <Button key="cancel" onClick={handleClose}>Hủy</Button>
              <Button key="save" type="primary" loading={saving} onClick={handleSaveJson}>Lưu lại</Button>
            </>
          ) : (
            <Button key="close" type="primary" onClick={handleClose}>Đóng</Button>
          )}
        </div>
      }
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'json',
            label: 'Biến môi trường (JSON)',
            children: (
              <>
                <div style={{ marginBottom: 10, color: 'var(--text-muted)' }}>
                  Khai báo các biến để sử dụng trong Workflow.
                </div>
                <div style={{ height: 'calc(100vh - 270px)', border: '1px solid var(--border-default)', borderRadius: '6px', overflow: 'hidden' }}>
                  <Editor
                    height="100%"
                    defaultLanguage="json"
                    value={jsonText}
                    theme={theme === 'light' ? 'light' : 'vs-dark'}
                    onChange={val => setJsonText(val || '')}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      formatOnPaste: true,
                      scrollBeyondLastLine: false
                    }}
                  />
                </div>
              </>
            )
          },
          {
            key: 'files',
            label: 'Tệp đính kèm',
            children: (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ color: 'var(--text-muted)' }}>
                    Tải lên các tệp (Excel, CSV, txt...) để xử lý trong Workflow.
                  </div>
                  {selectedInputRowKeys.length > 0 && (
                    <Space>
                      <Button size="small" type="primary" icon={<Download size={14} />} onClick={() => handleBatchDownload(false)}>Tải {selectedInputRowKeys.length} tệp</Button>
                      <Popconfirm title={`Xóa ${selectedInputRowKeys.length} tệp đã chọn?`} onConfirm={() => handleBatchDelete(false)}>
                        <Button size="small" danger icon={<Trash2 size={14} />}>Xóa {selectedInputRowKeys.length} tệp</Button>
                      </Popconfirm>
                    </Space>
                  )}
                </div>
                <Dragger {...uploadProps} style={{ marginBottom: 16, background: 'var(--bg-elevated)', borderColor: 'var(--border-default)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '12px 0' }}>
                    <UploadCloud size={28} color="var(--accent-primary)" />
                    <span style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>Nhấp hoặc kéo thả tệp vào đây để tải lên</span>
                  </div>
                </Dragger>
                <Table
                  rowSelection={{
                    selectedRowKeys: selectedInputRowKeys,
                    onChange: setSelectedInputRowKeys,
                  }}
                  dataSource={files}
                  columns={getColumns(false)}
                  rowKey="name"
                  size="small"
                  pagination={false}
                  loading={loadingFiles}
                  locale={{ emptyText: 'Chưa có tệp nào' }}
                />
              </>
            )
          },
          {
            key: 'output',
            label: 'Kết quả đầu ra',
            children: (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ color: 'var(--text-muted)' }}>
                    Các tệp kết quả được tạo ra sau khi chạy Workflow.
                  </div>
                  {selectedOutputRowKeys.length > 0 && (
                    <Space>
                      <Button size="small" type="primary" icon={<Download size={14} />} onClick={() => handleBatchDownload(true)}>Tải {selectedOutputRowKeys.length} tệp</Button>
                      <Popconfirm title={`Xóa ${selectedOutputRowKeys.length} tệp kết quả?`} onConfirm={() => handleBatchDelete(true)}>
                        <Button size="small" danger icon={<Trash2 size={14} />}>Xóa {selectedOutputRowKeys.length} tệp</Button>
                      </Popconfirm>
                    </Space>
                  )}
                </div>
                <Table
                  rowSelection={{
                    selectedRowKeys: selectedOutputRowKeys,
                    onChange: setSelectedOutputRowKeys,
                  }}
                  dataSource={outFiles}
                  columns={getColumns(true)}
                  rowKey="name"
                  size="small"
                  pagination={false}
                  loading={loadingOutFiles}
                  locale={{ emptyText: 'Chưa có tệp kết quả nào' }}
                />
              </>
            )
          }
        ]}
      />
    </Drawer>
  )
}
