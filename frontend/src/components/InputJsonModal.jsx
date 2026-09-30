import React, { useState, useEffect } from 'react'
import { Drawer, Button, Tabs, Table, Upload, Space, Popconfirm, Tag, Modal, Form, Input, Select, Alert, App } from 'antd'
import Editor from '@monaco-editor/react'
import { updateWorkflowInput, getWorkflowFiles, uploadWorkflowFile, deleteWorkflowFile, getWorkflowOutputFiles, deleteWorkflowOutputFile, openWorkflowFile, openWorkflowOutputFile, openWorkflowFilesFolder, openWorkflowOutputFolder, getDbConnections, createDbConnection, updateDbConnection, deleteDbConnection, getDatabaseTables, API_BASE } from '../api/client'
import { UploadCloud, Trash2, FileText, Eye, Download, FolderOpen, Database, Plug, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useStore from '../store/useStore'

const { Dragger } = Upload

// Bảng ảo hoá (virtual) bắt buộc scroll.y là số px cụ thể, không nhận được chuỗi
// CSS như 'calc(100vh - Npx)' — nếu không thì antd không tính được đang cuộn tới
// đâu để biết render đúng dòng nào.
// Từng thử đo chiều cao thật bằng ref + ResizeObserver (đo vùng chứa bảng còn lại
// sau toolbar/Dragger) nhưng antd Tabs giữ DOM của mọi tab dù ẩn/hiện khiến việc
// đo bị kẹt sai giá trị ban đầu không tự sửa lại được dù đã thử requestAnimationFrame
// + theo dõi resize. Đổi sang tính toán trực tiếp từ window.innerHeight — không
// chính xác tuyệt đối từng px nhưng ổn định và vẫn tự co giãn theo cửa sổ.
function useViewportHeight() {
  const [height, setHeight] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800))
  useEffect(() => {
    const onResize = () => setHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return height
}

// Cho phép người dùng viết comment // và /* */ để chú thích biến khi soạn JSON,
// vì JSON.parse chuẩn không hỗ trợ nên phải bóc comment (giữ nguyên nội dung trong chuỗi "...")
// trước khi parse thật. Comment chỉ có tác dụng lúc soạn, không được lưu lại cùng dữ liệu.
function stripJsonComments(text) {
  return text.replace(/("(?:\\.|[^"\\])*")|(\/\/.*)|(\/\*[\s\S]*?\*\/)/g, (match, str) => str || '')
}

function stripTrailingCommas(text) {
  return text.replace(/,(\s*[}\]])/g, '$1')
}

export default function InputJsonModal({ open, onClose, workflowId, projectId, initialData }) {
  const { message, modal } = App.useApp()
  const { t } = useTranslation()
  const theme = useStore(state => state.theme)
  const [jsonText, setJsonText] = useState('{}')
  const [savedJsonText, setSavedJsonText] = useState('{}')
  // Lý do backend không parse được input.json (null = file hợp lệ)
  const [parseError, setParseError] = useState(null)
  const jsonEditorRef = React.useRef(null)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('json')
  // Cùng ngân sách chiều cao calc(100vh - 300px) mà tab "Biến môi trường" đã dùng
  // cho khung Editor, trừ thêm phần cố định của từng tab (toolbar, và riêng tab
  // Tệp đính kèm có thêm khung kéo-thả) để bảng luôn vừa khít phần còn lại.
  const viewportHeight = useViewportHeight()
  const tabHeightBudget = viewportHeight - 300
  const outputTableHeight = Math.max(200, tabHeightBudget - 44)
  const filesTableHeight = Math.max(200, tabHeightBudget - 44 - 132)

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
      const rawText = initialData?.__raw_text__
      let text = ''
      if (rawText !== undefined) {
        text = rawText
      } else {
        const cleanData = { ...(initialData || {}) }
        delete cleanData.__raw_text__
        delete cleanData.__parse_error__
        text = JSON.stringify(cleanData, null, 2)
      }
      setJsonText(text)
      setSavedJsonText(text)
      // Backend trả __parse_error__ khi input.json có cú pháp sai. Phải hiện
      // nguyên văn nội dung cũ + lý do, KHÔNG được hiện editor trống: người dùng
      // sẽ tưởng biến bị mất, gõ lại vài biến rồi Lưu và ghi đè mất sạch token
      // Telegram / mật khẩu đang có trong file.
      setParseError(initialData?.__parse_error__ || null)
      if (jsonEditorRef.current) {
        jsonEditorRef.current.setValue(text)
      }
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
      message.error(t('inputJsonModal.loadConnectionsError', { message: e.message }))
    } finally {
      setLoadingDbConnections(false)
    }
  }

  const openDbConnModal = (connection) => {
    setEditingConnection(connection || null)
    // API không trả password về nữa (tránh lộ mật khẩu DB qua DevTools/cache), nên
    // ô mật khẩu luôn mở ra trống. Để trống khi Lưu = backend giữ nguyên mật khẩu cũ.
    dbConnForm.setFieldsValue(
      connection
        ? { ...connection, password: '' }
        : { db_type: 'sqlserver', label: '', host: '', port: '', username: '', password: '', dbname: '' }
    )
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
        // Ô mật khẩu để trống khi đang sửa kết nối đã lưu → backend lấy mật khẩu
        // đang lưu để test, khỏi bắt gõ lại chỉ để bấm Test.
        saved_connection_id: editingConnection?.id,
      })
      message.success(t('inputJsonModal.testConnectionSuccess'))
    } catch (e) {
      if (e.errorFields) return
      message.error(t('inputJsonModal.testConnectionError', { message: e.response?.data?.detail || e.message }))
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
      message.success(t('inputJsonModal.saveConnectionSuccess'))
      setDbConnModalOpen(false)
      loadDbConnections()
    } catch (e) {
      if (e.errorFields) return
      message.error(t('inputJsonModal.saveConnectionError', { message: e.response?.data?.detail || e.message }))
    } finally {
      setSavingConnection(false)
    }
  }

  const handleDeleteConnection = async (id) => {
    try {
      await deleteDbConnection(id)
      message.success(t('inputJsonModal.deleteConnectionSuccess'))
      loadDbConnections()
    } catch (e) {
      message.error(t('inputJsonModal.deleteConnectionError', { message: e.message }))
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
      message.error(t('inputJsonModal.loadFilesError', { message: e.message }))
    } finally {
      setLoadingFiles(false)
      setLoadingOutFiles(false)
    }
  }

  const handleDeleteFile = async (filename) => {
    try {
      await deleteWorkflowFile(workflowId, filename)
      message.success(t('inputJsonModal.deleteFileSuccess', { name: filename }))
      loadFiles()
    } catch (e) {
      message.error(t('inputJsonModal.deleteFileError', { message: e.message }))
    }
  }

  const handleDeleteOutFile = async (filename) => {
    try {
      await deleteWorkflowOutputFile(workflowId, filename)
      message.success(t('inputJsonModal.deleteFileSuccess', { name: filename }))
      loadFiles()
    } catch (e) {
      message.error(t('inputJsonModal.deleteFileError', { message: e.message }))
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
      message.success(t('inputJsonModal.batchDeleteSuccess', { count: keys.length }));
      if (isOutput) setSelectedOutputRowKeys([]);
      else setSelectedInputRowKeys([]);
      loadFiles();
    } catch (e) {
      message.error(t('inputJsonModal.batchDeleteError', { message: e.message }));
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
      message.success(t('inputJsonModal.viewFileSuccess'))
    } catch (e) {
      message.error(t('inputJsonModal.viewFileError', { message: e.message }))
    }
  }

  const handleOpenFolder = async (isOutput) => {
    try {
      if (isOutput) {
        await openWorkflowOutputFolder(workflowId)
      } else {
        await openWorkflowFilesFolder(workflowId)
      }
    } catch (e) {
      message.error(t('inputJsonModal.openFolderError', { message: e.message }))
    }
  }

  const handleDownload = (filename, isOutput) => {
    const a = document.createElement('a')
    a.href = `${API_BASE}/api/workflows/${workflowId}/${isOutput ? 'output-files' : 'files'}/${encodeURIComponent(filename)}/download?download=1`
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleSaveJson = async () => {
    try {
      const currentText = jsonEditorRef.current ? jsonEditorRef.current.getValue() : jsonText
      const parsed = JSON.parse(stripTrailingCommas(stripJsonComments(currentText)))
      setSaving(true)
      await updateWorkflowInput(workflowId, { raw_text: currentText })
      message.success(t('inputJsonModal.saveJsonSuccess'))
      setSavedJsonText(currentText)
      setJsonText(currentText)
      setParseError(null)   // file đã hợp lệ trở lại → gỡ banner cảnh báo
      onClose({ ...parsed, __raw_text__: currentText })
    } catch (e) {
      message.error(t('inputJsonModal.saveJsonError', { message: e.message }))
    } finally {
      setSaving(false)
    }
  }

  const closeWithoutSaving = () => {
    if (activeTab === 'files' || activeTab === 'output' || activeTab === 'database') {
      onClose(initialData)
    } else {
      onClose()
    }
  }

  // Đóng bằng nút X, bấm ra ngoài hay phím Esc trước đây đều âm thầm bỏ qua thay đổi
  // chưa lưu ở tab JSON (chỉ nút "Lưu" mới thực sự ghi xuống) — hỏi lại để tránh mất dữ liệu.
  const handleClose = () => {
    const currentText = jsonEditorRef.current ? jsonEditorRef.current.getValue() : jsonText
    if (activeTab === 'json' && currentText !== savedJsonText) {
      modal.confirm({
        title: t('inputJsonModal.unsavedChangesTitle'),
        content: t('inputJsonModal.unsavedChangesContent'),
        okText: t('inputJsonModal.closeDiscard'),
        cancelText: t('inputJsonModal.backToEdit'),
        okButtonProps: { danger: true },
        onOk: closeWithoutSaving,
      })
      return
    }
    closeWithoutSaving()
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
        message.success(t('inputJsonModal.uploadSuccess', { name: file.name }))
        loadFiles()
      } catch (e) {
        onError(e)
        message.error(t('inputJsonModal.uploadError', { name: file.name }))
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
      title: t('inputJsonModal.colFileName'),
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
      title: t('inputJsonModal.colFileSize'),
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
          <Button type="text" size="small" icon={<Eye size={14} />} onClick={() => handleView(record.name, isOutput)} aria-label={t('inputJsonModal.previewFileAria')} />
          <Button type="text" size="small" icon={<Download size={14} />} onClick={() => handleDownload(record.name, isOutput)} aria-label={t('inputJsonModal.downloadFileAria')} />
          <Popconfirm title={t('inputJsonModal.deleteFileConfirm')} onConfirm={() => isOutput ? handleDeleteOutFile(record.name) : handleDeleteFile(record.name)}>
            <Button type="text" size="small" danger icon={<Trash2 size={14} />} aria-label={t('inputJsonModal.deleteFileAria')} />
          </Popconfirm>
        </Space>
      )
    }
  ]

  const tabItems = [
    {
      key: 'json',
      label: t('inputJsonModal.envVarsTab'),
      children: (
        <div>
          <p style={{ margin: '0 0 12px 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            {t('inputJsonModal.envVarsDesc')}
          </p>
          {parseError && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              title={t('inputJsonModal.jsonSyntaxErrorTitle')}
              description={t('inputJsonModal.jsonSyntaxErrorDesc', { error: parseError })}
            />
          )}
          <div style={{ height: 'calc(100vh - 300px)', border: '1px solid var(--border-default)', borderRadius: 8, overflow: 'hidden' }}>
            <Editor
              height="100%"
              defaultLanguage="json"
              defaultValue={jsonText}
              theme={theme === 'light' ? 'light' : 'vs-dark'}
              onMount={(editor, monaco) => {
                jsonEditorRef.current = editor
                // Cho phép comment // và /* */, dấu phẩy cuối khi soạn — không bị gạch đỏ báo lỗi
                // (Lưu vẫn parse đúng nhờ stripJsonComments/stripTrailingCommas ở handleSaveJson)
                monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                  validate: true,
                  allowComments: true,
                  comments: 'ignore',
                  trailingCommas: 'ignore',
                })
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                formatOnPaste: true,
                scrollBeyondLastLine: false,
                // Tắt gợi ý tự động — JSON key/value không cần IntelliSense, nhưng khung gợi ý
                // lại hay tranh chấp phím (Enter/Tab) với lúc gõ bình thường, gây thiếu khoảng cách.
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                wordBasedSuggestions: 'off',
                acceptSuggestionOnEnter: 'off',
                tabCompletion: 'off',
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
          {t('inputJsonModal.attachedFilesTab', { count: files.length })}
        </Space>
      ),
      children: (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            {selectedInputRowKeys.length > 0 ? (
              <Space>
                <Tag>{t('inputJsonModal.filesSelectedTag', { count: selectedInputRowKeys.length })}</Tag>
                <Button size="small" icon={<Download size={14} />} onClick={() => handleBatchDownload(false)}>{t('inputJsonModal.downloadBtn')}</Button>
                <Button size="small" danger icon={<Trash2 size={14} />} onClick={() => handleBatchDelete(false)}>{t('common.delete')}</Button>
              </Space>
            ) : <div />}
            <Button size="small" icon={<FolderOpen size={14} />} onClick={() => handleOpenFolder(false)}>
              {t('inputJsonModal.openFolderBtn')}
            </Button>
          </div>
          <Dragger {...uploadProps} style={{ marginBottom: 12 }}>
            <p style={{ margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <UploadCloud size={24} color="var(--accent-primary)" />
              <span>{t('inputJsonModal.dragDropUpload')}</span>
            </p>
          </Dragger>
          <Table
            rowSelection={{ selectedRowKeys: selectedInputRowKeys, onChange: setSelectedInputRowKeys, columnWidth: 48 }}
            dataSource={files}
            columns={getColumns(false)}
            rowKey="name"
            size="small"
            pagination={false}
            loading={loadingFiles}
            locale={{ emptyText: t('inputJsonModal.noFilesYet') }}
            // Ảo hoá hàng — workflow nào trả về hàng trăm tệp kết quả thì render hết
            // 1 lần làm treo UI vài giây (đã gặp thật với wf 310 tệp). virtual + scroll.y
            // bắt buộc đi cùng nhau để antd chỉ render đúng số hàng đang lọt khung nhìn.
            // scroll.y tính từ window.innerHeight (useViewportHeight) — tự co giãn
            // theo cửa sổ thay vì 1 số cố định.
            virtual
            scroll={{ y: filesTableHeight }}
          />
        </div>
      )
    },
    {
      key: 'output',
      label: (
        <Space>
          <Download size={14} />
          {t('inputJsonModal.resultsTab', { count: outFiles.length })}
        </Space>
      ),
      children: (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            {selectedOutputRowKeys.length > 0 ? (
              <Space>
                <Tag>{t('inputJsonModal.filesSelectedTag', { count: selectedOutputRowKeys.length })}</Tag>
                <Button size="small" icon={<Download size={14} />} onClick={() => handleBatchDownload(true)}>{t('inputJsonModal.downloadBtn')}</Button>
                <Button size="small" danger icon={<Trash2 size={14} />} onClick={() => handleBatchDelete(true)}>{t('common.delete')}</Button>
              </Space>
            ) : <div />}
            <Button size="small" icon={<FolderOpen size={14} />} onClick={() => handleOpenFolder(true)}>
              {t('inputJsonModal.openFolderBtn')}
            </Button>
          </div>
          <Table
            rowSelection={{ selectedRowKeys: selectedOutputRowKeys, onChange: setSelectedOutputRowKeys, columnWidth: 48 }}
            dataSource={outFiles}
            columns={getColumns(true)}
            rowKey="name"
            size="small"
            pagination={false}
            loading={loadingOutFiles}
            locale={{ emptyText: t('inputJsonModal.noOutputFilesYet') }}
            virtual
            scroll={{ y: outputTableHeight }}
          />
        </div>
      )
    },
    {
      key: 'database',
      label: (
        <Space>
          <Database size={14} />
          {t('inputJsonModal.databaseTab', { count: dbConnections.length })}
        </Space>
      ),
      children: (
        <div>
          <Button type="primary" icon={<Plug size={14} />} style={{ marginBottom: 12 }} onClick={() => openDbConnModal(null)}>
            {t('inputJsonModal.addConnectionBtn')}
          </Button>
          <Table
            dataSource={dbConnections}
            rowKey="id"
            size="small"
            pagination={false}
            loading={loadingDbConnections}
            locale={{ emptyText: t('inputJsonModal.noConnectionsYet') }}
            columns={[
              { title: t('inputJsonModal.colName'), dataIndex: 'label' },
              { title: t('inputJsonModal.colDbType'), dataIndex: 'db_type' },
              { title: t('inputJsonModal.colHost'), dataIndex: 'host' },
              { title: t('inputJsonModal.colDatabase'), dataIndex: 'dbname' },
              {
                title: '',
                key: 'action',
                width: 90,
                align: 'center',
                render: (_, record) => (
                  <Space size={4}>
                    <Button type="text" size="small" icon={<Pencil size={14} />} onClick={() => openDbConnModal(record)} aria-label={t('inputJsonModal.editConnectionAria')} />
                    <Popconfirm title={t('inputJsonModal.deleteConnectionConfirm')} onConfirm={() => handleDeleteConnection(record.id)}>
                      <Button type="text" size="small" danger icon={<Trash2 size={14} />} aria-label={t('inputJsonModal.deleteConnectionAria')} />
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
          <span style={{ fontWeight: 600 }}>{t('inputJsonModal.drawerTitle')}</span>
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
            <Button onClick={handleClose}>{t('common.cancel')}</Button>
            <Button type="primary" loading={saving} onClick={handleSaveJson}>{t('common.save')}</Button>
          </Space>
        ) : (
          <Button type="primary" onClick={handleClose}>{t('common.close')}</Button>
        )
      }
    >
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Drawer>

    <Modal
      title={editingConnection?.id ? t('inputJsonModal.editConnectionTitle') : t('inputJsonModal.addConnectionTitle')}
      open={dbConnModalOpen}
      onCancel={() => setDbConnModalOpen(false)}
      footer={[
        <Button key="test" onClick={handleTestConnection} loading={testingConnection}>{t('inputJsonModal.testConnectionBtn')}</Button>,
        <Button key="cancel" onClick={() => setDbConnModalOpen(false)}>{t('common.cancel')}</Button>,
        <Button key="save" type="primary" onClick={handleSaveConnection} loading={savingConnection}>{t('common.save')}</Button>,
      ]}
      destroyOnHidden
    >
      <Form form={dbConnForm} layout="vertical">
        <Form.Item name="label" label={t('inputJsonModal.connectionNameLabel')} rules={[{ required: true, message: t('inputJsonModal.connectionNameRequired') }]}>
          <Input placeholder={t('inputJsonModal.connectionNamePlaceholder')} />
        </Form.Item>
        <Form.Item name="db_type" label={t('inputJsonModal.dbTypeLabel')} rules={[{ required: true }]}>
          <Select>
            <Select.Option value="postgresql">PostgreSQL</Select.Option>
            <Select.Option value="mysql">MySQL</Select.Option>
            <Select.Option value="sqlite">SQLite</Select.Option>
            <Select.Option value="sqlserver">SQL Server</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="host" label={t('inputJsonModal.hostLabel')}>
          <Input placeholder={t('inputJsonModal.hostPlaceholder')} />
        </Form.Item>
        <Form.Item name="port" label={t('inputJsonModal.portLabel')}>
          <Input placeholder={t('inputJsonModal.portPlaceholder')} />
        </Form.Item>
        <Form.Item name="username" label={t('inputJsonModal.userLabel')}>
          <Input placeholder={t('inputJsonModal.userPlaceholder')} />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('inputJsonModal.passwordLabel')}
          extra={editingConnection?.has_password
            ? t('inputJsonModal.passwordExtraHasPassword')
            : undefined}
        >
          <Input.Password placeholder={editingConnection?.has_password ? t('inputJsonModal.passwordPlaceholderKeep') : t('inputJsonModal.passwordPlaceholderNew')} />
        </Form.Item>
        <Form.Item name="dbname" label={t('inputJsonModal.dbNameLabel')}>
          <Input placeholder={t('inputJsonModal.dbNamePlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
    </>
  )
}
