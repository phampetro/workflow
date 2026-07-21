import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  ReactFlow, Background, Controls, MiniMap, Panel,
  addEdge, useNodesState, useEdgesState, BackgroundVariant,
  MarkerType, ReactFlowProvider, useReactFlow
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import BlockNode, { BLOCK_TYPES } from '../components/BlockNode'
import DeleteEdge from '../components/DeleteEdge'
import BlockEditorModal from '../components/BlockEditorModal'
import LogViewer from '../components/LogViewer'
import SchedulerPanel from '../components/SchedulerPanel'
import WorkflowHistoryPanel from '../components/WorkflowHistoryPanel'
import InputJsonModal from '../components/InputJsonModal'
import {
  ArrowLeft, Play, Square, Calendar, Terminal, History,
  Save, Loader, CheckCircle, AlertCircle, Database, Table, Files, RefreshCw, Trash2
} from 'lucide-react'
import { Button, Drawer, Space, Input, Popconfirm, Tag, App } from 'antd'
import toast from 'react-hot-toast'
import { getWorkflow, updateWorkflow, runWorkflow, stopWorkflow, getWorkflowInput, getRunHistory, deleteRunHistory } from '../api/client'
import useStore from '../store/useStore'
import useUndoRedo from '../hooks/useUndoRedo'

const nodeTypes = { block: BlockNode }
const edgeTypes = { custom: DeleteEdge }

const BLOCK_GROUPS = [
  { title: 'Bắt đầu - Kết thúc', items: ['start', 'end'] },
  { title: 'Rẽ nhánh', items: ['condition', 'loop', 'delay'] },
  { title: 'Python Code', items: ['python'] },
  { title: 'Tự động hóa Web', items: ['browser'] },
  { title: 'Xử lý Dữ liệu', items: ['merge_excel', 'pivot_excel'] },
  { title: 'Cơ sở dữ liệu', items: ['sql_to_excel', 'excel_to_sql', 'run_sql_exec'] },
  { title: 'Gửi tin nhắn', items: ['telegram', 'telegram_listener', 'email'] },
  { title: 'Hệ thống', items: ['error_trigger', 'delete_files'] }
];

const DEFAULT_GRAPH = {
  nodes: [
    { id: 'start-1', type: 'block', position: { x: 50, y: 150 },  data: { type: 'start', label: 'Bắt đầu', description: 'Khởi động workflow' } },
    { id: 'end-1',   type: 'block', position: { x: 500, y: 150 }, data: { type: 'end',   label: 'Hoàn thành', description: 'Workflow kết thúc' } },
  ],
  edges: [],
}

const EDGE_STYLE = { stroke: '#0d9488', strokeWidth: 2 }

let nodeIdCounter = 100

function WorkflowEditorInner({ workflow, project, onBack }) {
  const { message, modal } = App.useApp()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [editingNode, setEditingNode] = useState(null)
  const [showLogs, setShowLogs] = useState(false)
  const [showScheduler, setShowScheduler] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [searchBlock, setSearchBlock] = useState('')
  const [showInputModal, setShowInputModal] = useState(false)
  const [inputData, setInputData] = useState({})
  const [inputKeys, setInputKeys] = useState([])
  const [saveStatus, setSaveStatus] = useState('saved')
  const historyPanelRef = useRef(null)

  const { takeSnapshot, undo, redo, canUndo, canRedo } = useUndoRedo()

  const currentRunId = useStore((s) => s.activeRuns[workflow?.id] || null)
  const isRunning = !!currentRunId
  const [viewingRunId, setViewingRunId] = useState(null)

  useEffect(() => {
    if (currentRunId) {
      setViewingRunId(currentRunId)
    }
  }, [currentRunId])

  const [wfData, setWfData] = useState(workflow)
  const [checkingStatus, setCheckingStatus] = useState(true)
  const saveTimer = useRef(null)
  const reactFlowWrapper = useRef(null)
  const { screenToFlowPosition, fitView } = useReactFlow()

  // Refs giữ state mới nhất để các callback (đặc biệt là closure gắn vào edge)
  // không bao giờ đọc phải state cũ (stale closure)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])
  // Chỉ cho phép auto-save/snapshot sau khi graph đã tải xong từ server
  const graphLoadedRef = useRef(false)
  // ETag: server updated_at của lần load/save gần nhất - gửi kèm để BE phát hiện
  // "người khác đã lưu trong lúc bạn đang sửa" và trả 409.
  const expectedUpdatedAtRef = useRef(null)
  const conflictDialogOpenRef = useRef(false)

  const proj  = project  || { name: 'Project', color: '#0d9488' }

  useEffect(() => {
    if (!workflow?.id) return
    getWorkflow(workflow.id).then((res) => {
      const wf = res.data
      setWfData(wf)
      expectedUpdatedAtRef.current = wf.updated_at || null
      if (wf.graph_json) {
        try {
          const graph = JSON.parse(wf.graph_json)
          const loadedNodes = (graph.nodes || []).map(n => ({
            ...n,
            data: { ...n.data, onEdit: undefined, onDelete: undefined },
          }))
          // Remove duplicate nodes by ID (keep first occurrence)
          const seenIds = new Set()
          const uniqueNodes = loadedNodes.filter(n => {
            if (seenIds.has(n.id)) return false
            seenIds.add(n.id)
            return true
          })
          const loadedEdges = (graph.edges || []).map(e => {
            const cleanEdge = { ...e, type: 'custom' }
            cleanEdge.markerEnd = { type: MarkerType.ArrowClosed, color: '#0d9488' }
            return cleanEdge
          })
          // Remove duplicate edges
          const seenEdgeIds = new Set()
          const uniqueEdges = loadedEdges.filter(e => {
            const edgeId = `${e.source}-${e.target}-${e.sourceHandle || 'default'}-${e.targetHandle || 'default'}`
            if (seenEdgeIds.has(edgeId)) return false
            seenEdgeIds.add(edgeId)
            return true
          })
          // Sync nodeIdCounter lên cao hơn ID lớn nhất đang có để tránh tạo ID trùng
          uniqueNodes.forEach(n => {
            const parts = n.id.split('-')
            const num = parseInt(parts[parts.length - 1], 10)
            if (!isNaN(num) && num >= nodeIdCounter) nodeIdCounter = num + 1
          })
          setNodes(uniqueNodes)
          setEdges(uniqueEdges)
          graphLoadedRef.current = true
          setTimeout(() => fitView({ padding: 0.2, duration: 800 }), 100)
        } catch { setNodesFromDefault() }
      } else {
        setNodesFromDefault()
      }
    }).catch(e => {
      toast.error('Lỗi tải workflow: ' + e.message)
    })

    getWorkflowInput(workflow.id).then((res) => {
      setInputData(res.data)
      setInputKeys(Object.keys(res.data || {}))
    }).catch(() => {})

    // Khôi phục trạng thái đang chạy hoặc xem log cũ (khi user vào màn hình)
    getRunHistory(workflow.id, 5).then(res => {
      const runs = res.data || []
      const runningRun = runs.find(r => r.status === 'running')
      const latestRun = runs[0]

      if (runningRun) {
        setViewingRunId(runningRun.id)
        useStore.getState().setActiveRun(workflow.id, runningRun.id)
        setShowLogs(true)
      } else if (latestRun) {
        setViewingRunId(latestRun.id)
        useStore.getState().clearActiveRun(workflow.id)
      }
    }).catch(() => {}).finally(() => setCheckingStatus(false))
  }, [workflow?.id])

  const handleDeleteHistory = async () => {
    try {
      await deleteRunHistory(wfData?.id)
      message.success('Đã xóa lịch sử chạy')
      historyPanelRef.current?.loadHistory()
    } catch (err) {
      toast.error('Lỗi xóa lịch sử: ' + err.message)
    }
  }

  const setNodesFromDefault = () => {
    setNodes(DEFAULT_GRAPH.nodes)
    setEdges(DEFAULT_GRAPH.edges)
    graphLoadedRef.current = true
    setTimeout(() => fitView({ padding: 0.2, duration: 800 }), 100)
  }

  const triggerAutoSave = useCallback(() => {
    // Chỉ lưu sau khi graph đã tải từ server — chống HMR/remount làm state rỗng đè lên database.
    // Dữ liệu lưu được đọc từ ref TẠI THỜI ĐIỂM timer chạy nên luôn là state mới nhất.
    if (!graphLoadedRef.current) return

    setSaveStatus('unsaved')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveGraph(nodesRef.current, edgesRef.current)
    }, 1500)
  }, [wfData?.id])

  const handleUndo = useCallback(() => {
    const previous = undo(nodesRef.current, edgesRef.current);
    if (previous) {
      setNodes(previous.nodes);
      setEdges(previous.edges);
      setTimeout(() => triggerAutoSave(), 0);
    }
  }, [undo, setNodes, setEdges, triggerAutoSave]);

  const handleRedo = useCallback(() => {
    const next = redo(nodesRef.current, edgesRef.current);
    if (next) {
      setNodes(next.nodes);
      setEdges(next.edges);
      setTimeout(() => triggerAutoSave(), 0);
    }
  }, [redo, setNodes, setEdges, triggerAutoSave]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Không undo nếu đang gõ chữ trong form
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
        return;
      }
      
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedo();
        } else {
          e.preventDefault();
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  const saveGraph = useCallback(async (currentNodes, currentEdges, { force = false } = {}) => {
    if (!wfData?.id) return
    setSaveStatus('saving')
    const graph = {
      nodes: currentNodes.map(n => {
        const cleanData = { ...n.data }
        delete cleanData.onDelete
        delete cleanData.onEdit
        delete cleanData.onDuplicate
        return {
          id: n.id,
          type: n.type,
          position: n.position,
          data: cleanData,
        }
      }),
      edges: currentEdges,
    }
    const payload = { graph_json: JSON.stringify(graph) }
    if (!force && expectedUpdatedAtRef.current) {
      payload.expected_updated_at = expectedUpdatedAtRef.current
    }
    try {
      const res = await updateWorkflow(wfData.id, payload)
      expectedUpdatedAtRef.current = res.data?.updated_at || expectedUpdatedAtRef.current
      setSaveStatus('saved')
    } catch (err) {
      // BE trả 409 khi FE gửi expected_updated_at khác giá trị hiện tại - có người khác đã lưu
      const detail = err?.response?.data?.detail || err?.response?.data
      const isConflict = err?.response?.status === 409 || detail?.error === 'conflict'
      if (isConflict && !force) {
        setSaveStatus('error')
        if (conflictDialogOpenRef.current) return
        conflictDialogOpenRef.current = true
        modal.confirm({
          title: 'Xung đột khi lưu',
          content: 'Ai đó (hoặc tab khác của bạn) đã lưu workflow này trong lúc bạn đang sửa. Chọn Tải lại để lấy bản mới nhất (mất thay đổi hiện tại), hoặc Ghi đè để đè lên bản trên server.',
          okText: 'Tải lại',
          cancelText: 'Ghi đè',
          onOk: () => {
            conflictDialogOpenRef.current = false
            window.location.reload()
          },
          onCancel: () => {
            conflictDialogOpenRef.current = false
            expectedUpdatedAtRef.current = detail?.server_updated_at || null
            saveGraph(currentNodes, currentEdges, { force: true })
          },
        })
      } else {
        setSaveStatus('error')
      }
    }
  }, [wfData?.id, modal])

  const handleNodesChange = useCallback((changes) => {
    // Xóa bằng phím Delete/Backspace cũng phải vào lịch sử undo
    if (changes.some(c => c.type === 'remove')) {
      takeSnapshot(nodesRef.current, edgesRef.current)
    }
    onNodesChange(changes)
    // Chỉ lưu khi có thay đổi thực sự (bỏ qua select để không ghi đè vô nghĩa)
    if (changes.some(c => c.type !== 'select')) {
      triggerAutoSave()
    }
  }, [onNodesChange, triggerAutoSave, takeSnapshot])

  const handleEdgesChange = useCallback((changes) => {
    if (changes.some(c => c.type === 'remove')) {
      takeSnapshot(nodesRef.current, edgesRef.current)
    }
    onEdgesChange(changes)
    if (changes.some(c => c.type !== 'select')) {
      triggerAutoSave()
    }
  }, [onEdgesChange, triggerAutoSave, takeSnapshot])

  const handleManualSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveGraph(nodes, edges)
  }

  const handleDeleteEdge = useCallback((edgeId) => {
    // Đọc từ ref để không bao giờ snapshot/lưu state cũ, dù closure này được gắn từ lâu
    takeSnapshot(nodesRef.current, edgesRef.current)
    setEdges(eds => eds.filter(e => e.id !== edgeId))
    triggerAutoSave()
  }, [triggerAutoSave, takeSnapshot])

  const onConnect = useCallback(
    (params) => {
      takeSnapshot(nodesRef.current, edgesRef.current)
      setEdges(eds => addEdge({
        ...params, animated: true,
        type: 'custom',
        style: EDGE_STYLE,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#0d9488' },
      }, eds))
      triggerAutoSave()
    },
    [triggerAutoSave, takeSnapshot]
  )

  const openEditor = (nodeId) => {
    const node = nodes.find((n) => n.id === nodeId)
    if (node) setEditingNode(node)
  }

  const deleteNode = (nodeId) => {
    takeSnapshot(nodesRef.current, edgesRef.current)
    setNodes(nds => nds.filter((n) => n.id !== nodeId))
    setEdges(eds => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
    triggerAutoSave()
  }

  const duplicateNode = (nodeId) => {
    takeSnapshot(nodesRef.current, edgesRef.current)
    setNodes(prev => {
      const original = prev.find((n) => n.id === nodeId)
      if (!original) return prev
      const newId = `${original.data.type}-${++nodeIdCounter}`
      const newNode = {
        ...original,
        id: newId,
        position: { x: original.position.x + 40, y: original.position.y + 80 },
        selected: false,
        data: { ...original.data, onEdit: undefined, onDelete: undefined, onDuplicate: undefined },
      }
      return [...prev, newNode]
    })
    triggerAutoSave()
  }

  const handleSaveBlock = (nodeId, data) => {
    takeSnapshot(nodes, edges)
    const newNodes = nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
    )
    setNodes(newNodes)
    setEditingNode(null)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveGraph(newNodes, edges)
  }

  const handleUpdateNode = async (nodeId, data) => {
    takeSnapshot(nodes, edges)
    const newNodes = nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
    )
    setNodes(newNodes)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    return saveGraph(newNodes, edges)
  }

  const handleRun = async () => {
    if (!wfData?.id) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    await saveGraph(nodes, edges)

    setShowLogs(true)
    try {
      const res = await runWorkflow(wfData.id)
      const run_id = res.data.run_id
      useStore.getState().clearLogs(run_id)
      useStore.getState().setActiveRun(wfData.id, run_id)
      toast.success('Đã kích hoạt chạy workflow!')
    } catch (e) {
      toast.error('Lỗi chạy workflow: ' + e.message)
      useStore.getState().clearActiveRun(wfData.id)
    }
  }

  const handleStop = async () => {
    if (wfData?.id) {
      // Không clear activeRun ngay - đợi khối cuối chạy nốt và log "⏹ Đã dừng" bay về
      // (handleRunFinished sẽ clear). Trước đây clear luôn khiến nút chuyển "Chạy" trong
      // khi block cuối còn xử lý vài trăm ms.
      await stopWorkflow(wfData.id).catch(() => {})
    }
  }

  const handleRunFinished = useCallback((finishedRunId) => {
    const currentActiveRun = useStore.getState().activeRuns[wfData?.id];
    if (wfData?.id && currentActiveRun === finishedRunId) {
      useStore.getState().clearActiveRun(wfData.id)
      message.success('Chạy Workflow hoàn tất!')
    }
  }, [wfData?.id])

  // Drag and drop support
  const onDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event) => {
      event.preventDefault()
      const type = event.dataTransfer.getData('application/reactflow')
      // Guard: bỏ qua nếu không phải block type hợp lệ từ palette (tránh nhầm với drag node nội bộ)
      if (!type || !BLOCK_TYPES[type]) return

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      
      const id = `${type}-${++nodeIdCounter}`
      const newNode = {
        id,
        type: 'block',
        position,
        data: {
          type,
          label: BLOCK_TYPES[type].label,
          description: BLOCK_TYPES[type].description,
          code: type === 'python' ? '# Viết code Python của bạn\noutput_data = input_data\nprint("Done!")' : undefined,
          condition: type === 'condition' ? 'input_data is not None' : undefined,
          delaySeconds: type === 'delay' ? 3 : undefined,
          telegramMessage: type === 'telegram' ? 'Xin chào, đây là tin nhắn từ Workflow!\nDữ liệu: {input_data}' : undefined,
          telegramParseMode: type === 'telegram' ? 'HTML' : undefined,
          telegramAttachments: type === 'telegram' ? [] : undefined,
          telegramAction: type === 'telegram' ? 'send' : undefined,
          telegramListenerCommands: type === 'telegram_listener' ? [
            { command: '/hi', reply: 'Xin chào! 👋', runWorkflow: false }
          ] : undefined,
          steps: type === 'browser' ? [] : undefined,
          debugMode: type === 'browser' ? false : undefined,
          sqlCommand: type === 'run_sql_exec' ? '' : undefined,
          sqlExecDbConfigKey: type === 'run_sql_exec' ? '' : undefined,
        },
      }

      setNodes(nds => [...nds, newNode])
      triggerAutoSave()
    },
    [screenToFlowPosition, triggerAutoSave]
  )

  const nodesWithCb = nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      onEdit: () => openEditor(n.id),
      onDelete: () => deleteNode(n.id),
      onDuplicate: () => duplicateNode(n.id),
    },
  }))

  // Rebind onDelete mỗi render (giống nodesWithCb) — edge không bao giờ giữ closure cũ,
  // và undo/redo (deep-clone làm mất function) cũng không làm chết nút xóa edge
  const edgesWithCb = edges.map((e) => ({
    ...e,
    data: { ...e.data, onDelete: handleDeleteEdge },
  }))

  const SaveIcon = saveStatus === 'saving' ? Loader
    : saveStatus === 'saved' ? CheckCircle
    : saveStatus === 'error' ? AlertCircle
    : null

  return (
    <div className="workflow-editor">
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <Button type="text" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <ArrowLeft size="0.875rem" /> Quay lại
          </Button>
          <div className="toolbar-sep" />
          <div className="toolbar-info" style={{ overflow: 'hidden' }}>
            <div className="toolbar-dot" style={{ background: proj.color, flexShrink: 0 }} />
            <span className="text-secondary text-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '9.375rem' }}>{proj.name}</span>
            <span className="text-muted" style={{ flexShrink: 0 }}>/</span>
            <span className="font-semibold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '12.5rem' }}>{wfData?.name || 'Workflow'}</span>
          </div>
        </div>

        <div className="toolbar-center">
          {/* Palette moved to sidebar */}
        </div>

        <div className="toolbar-right">
          <div className="save-status">
            {SaveIcon && <SaveIcon size="0.875rem" className={saveStatus === 'saving' ? 'spinning' : ''} />}
            <span style={{ whiteSpace: 'nowrap' }}>{saveStatus === 'saving' ? 'Đang lưu...' : saveStatus === 'saved' ? 'Đã lưu' : saveStatus === 'error' ? 'Lỗi lưu' : 'Chưa lưu'}</span>
          </div>
          <Space>
            <Button icon={<Database size="0.875rem" />} onClick={() => setShowInputModal(true)}>Dữ liệu Workflow</Button>
            <Button icon={<History size="0.875rem" />} onClick={() => setShowHistory(true)}>Lịch sử</Button>
            <Button icon={<Calendar size="0.875rem" />} onClick={() => setShowScheduler(true)}>Lịch chạy</Button>
            <Button
              icon={<Terminal size="0.875rem" />}
              onClick={() => setShowLogs(!showLogs)}
              style={showLogs ? {
                background: 'var(--accent-primary)',
                color: '#fff',
                borderColor: 'var(--accent-primary)',
              } : {}}
            >Logs</Button>
            <Button icon={<Save size="0.875rem" />} onClick={handleManualSave} disabled={saveStatus === 'saving'}>Lưu</Button>
            {isRunning ? (
              <Button danger icon={<Square size="0.875rem" />} onClick={handleStop}>Dừng</Button>
            ) : (
              <Button type="primary" icon={<Play size="0.875rem" />} onClick={handleRun} disabled={!wfData?.id || checkingStatus}>
                {checkingStatus ? 'Đang tải...' : 'Chạy'}
              </Button>
            )}
          </Space>
        </div>
      </div>

      <div className="editor-body">
        {/* Left Sidebar Palette */}
        <div className="sidebar-palette">
          <div className="palette-title">Khối chức năng</div>
          <div className="palette-desc">Kéo thả vào vùng vẽ</div>
          <div style={{ padding: '0 0.75rem 0.5rem 0.75rem' }}>
            <Input 
              placeholder="Tìm khối..." 
              value={searchBlock}
              onChange={e => setSearchBlock(e.target.value)}
              size="small"
              allowClear
            />
          </div>
          <div className="palette-list">
            {BLOCK_GROUPS.map(group => {
              const groupItems = group.items.filter(key => {
                const bt = BLOCK_TYPES[key];
                return bt && (bt.label.toLowerCase().includes(searchBlock.toLowerCase()) || (bt.description && bt.description.toLowerCase().includes(searchBlock.toLowerCase())));
              });
              
              if (groupItems.length === 0) return null;
              
              return (
                <div key={group.title} className="palette-group">
                  <div className="palette-group-title">{group.title}</div>
                  {groupItems.map(key => {
                    const bt = BLOCK_TYPES[key];
                    return (
                      <div
                        key={key}
                        className="palette-item"
                        onDragStart={(event) => onDragStart(event, key)}
                        draggable
                        style={{ borderLeftColor: bt.color }}
                      >
                        <div className="palette-icon" style={{ color: bt.color }}>{bt.icon}</div>
                        <div className="palette-info">
                          <div className="palette-label">{bt.label}</div>
                          <div className="palette-desc-text">{bt.description}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Canvas Area */}
        <div className="canvas-area" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodesWithCb}
            edges={edgesWithCb}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onDrop={(e) => {
              takeSnapshot(nodesRef.current, edgesRef.current)
              onDrop(e)
            }}
            onDragOver={onDragOver}
            onNodeDragStart={() => takeSnapshot(nodesRef.current, edgesRef.current)}
            onNodeDoubleClick={(e, node) => openEditor(node.id)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            defaultEdgeOptions={{
              animated: true, type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed, color: '#0d9488' },
            }}
            style={{ background: 'transparent' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.04)" />
            <Controls style={{ background:'var(--bg-elevated)', border:'1px solid var(--border-default)', borderRadius:10 }} />
            <MiniMap
              style={{ background:'var(--bg-elevated)', border:'1px solid var(--border-default)', borderRadius:10 }}
              nodeColor={(n) => {
                if (!n?.data?.type) return '#6c63ff'
                return BLOCK_TYPES[n.data.type]?.color || '#6c63ff'
              }}
              maskColor="rgba(0,0,0,0.6)"
            />
          </ReactFlow>
        </div>

        {showLogs && (
          <LogViewer
            runId={viewingRunId}
            isRunning={isRunning}
            onClose={() => setShowLogs(false)}
            onFinished={handleRunFinished}
          />
        )}
      </div>

      <Drawer
        title={
          <Space>
            <History size={16} color="var(--accent-warning)" />
            <span style={{ fontWeight: 600 }}>Lịch sử chạy</span>
            <Tag variant="filled" style={{ margin: 0 }}>{wfData?.name}</Tag>
          </Space>
        }
        placement="right"
        size="large"
        onClose={() => setShowHistory(false)}
        open={showHistory}
        styles={{ body: { padding: 16 } }}
        extra={
          <Space>
            <Button type="default" icon={<RefreshCw size={14} />} size="small" onClick={() => historyPanelRef.current?.loadHistory()}>
              Làm mới
            </Button>
            <Popconfirm title="Xóa toàn bộ lịch sử chạy?" onConfirm={handleDeleteHistory} okText="Xóa" cancelText="Hủy" placement="bottomRight">
              <Button type="primary" danger icon={<Trash2 size={14} />} size="small">
                Xóa lịch sử
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <WorkflowHistoryPanel 
          ref={historyPanelRef}
          workflowId={wfData?.id} 
          onViewLog={(runId) => {
            setViewingRunId(runId)
            setShowHistory(false)
            setShowLogs(true)
          }}
        />
      </Drawer>

      {editingNode && (
        <BlockEditorModal
          node={editingNode}
          open={!!editingNode}
          onClose={() => setEditingNode(null)}
          onSave={handleSaveBlock}
          onUpdate={handleUpdateNode}
          inputKeys={inputKeys}
          workflowId={wfData?.id}
          projectId={project?.id}
        />
      )}

      <InputJsonModal
        open={showInputModal}
        onClose={(updatedData) => {
          setShowInputModal(false)
          if (updatedData) {
            setInputData(updatedData)
            setInputKeys(Object.keys(updatedData))
          }
        }}
        workflowId={wfData?.id}
        projectId={project?.id}
        initialData={inputData}
      />

      {showScheduler && (
        <SchedulerPanel workflow={wfData} onClose={() => setShowScheduler(false)} />
      )}

      <style>{`
        .workflow-editor { display: flex; flex-direction: column; height: 100%; overflow: hidden; background: var(--bg-base); }
        .editor-toolbar { 
          display: flex; align-items: center; justify-content: space-between; 
          padding: 0 var(--space-6); height: var(--navbar-height); 
          background: var(--bg-surface); 
          border-bottom: 1px solid var(--border-default); 
          flex-shrink: 0; gap: var(--space-4); 
          box-shadow: var(--shadow-sm);
          z-index: 10;
        }
        .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: var(--space-3); flex: 1; }
        .toolbar-right { justify-content: flex-end; }
        .toolbar-sep { width: 1px; height: 1.25rem; background: var(--border-default); }
        .toolbar-info { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
        .toolbar-dot { width: 0.625rem; height: 0.625rem; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
        
        .editor-body { flex: 1; display: flex; overflow: hidden; position: relative; }
        
        /* Sidebar Palette Styles */
        .sidebar-palette {
          width: 17.5rem;
          background: var(--bg-surface);
          border-right: 1px solid var(--border-default);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          flex-shrink: 0;
          z-index: 5;
        }
        .palette-title {
          font-weight: 600;
          font-size: 1.05rem;
          padding: 1.25rem 1.25rem 0.25rem 1.25rem;
          color: var(--text-primary);
        }
        .palette-desc {
          font-size: 0.8rem;
          color: var(--text-muted);
          padding: 0 1.25rem 1rem 1.25rem;
        }
        .palette-list {
          padding: 1rem 1.25rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .palette-group {
          display: flex;
          flex-direction: column;
          gap: 0.625rem;
        }
        .palette-group-title {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding-left: 0.125rem;
        }
        .palette-item {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.75rem;
          background: var(--bg-elevated);
          border: 1px solid var(--border-default);
          border-left-width: 0.25rem;
          border-radius: var(--radius-md);
          cursor: grab;
          transition: all var(--transition-fast);
        }
        .palette-item:hover {
          background: var(--bg-hover);
          transform: translateY(-2px);
          box-shadow: var(--shadow-sm);
          border-right-color: var(--border-accent);
          border-top-color: var(--border-accent);
          border-bottom-color: var(--border-accent);
        }
        .palette-item:active {
          cursor: grabbing;
        }
        .palette-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-surface);
          padding: 0.375rem;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-default);
        }
        .palette-info {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          overflow: hidden;
        }
        .palette-label {
          font-weight: 600;
          font-size: 0.85rem;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .palette-desc-text {
          font-size: 0.75rem;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .canvas-area { flex: 1; background: var(--bg-base); position: relative; min-width: 400px; min-height: 300px; }
        
        .save-status { display: flex; align-items: center; gap: 0.375rem; font-size: 0.8rem; font-weight: 500; color: var(--text-muted); padding: 0 0.75rem; }
        .save-status svg { color: var(--accent-success); }

        .spinning { animation: spin 1s linear infinite; }

        .edge-delete-btn { width: 1.5rem; height: 1.5rem; background: var(--bg-surface); border: 1px solid var(--accent-danger); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--accent-danger); transition: all 0.2s; box-shadow: var(--shadow-sm); }
        .edge-delete-btn:hover { background: var(--accent-danger); color: white; transform: scale(1.15); box-shadow: 0 4px 12px rgba(239,68,68,0.4); }

        .react-flow__controls button { background: var(--bg-surface) !important; color: var(--text-secondary) !important; border: none !important; border-bottom: 1px solid var(--border-default) !important; transition: all 0.2s; }
        .react-flow__controls button:hover { background: var(--bg-hover) !important; color: var(--text-primary) !important; }
        .react-flow__controls svg path { fill: currentColor !important; }
        .react-flow__edge-path { stroke-width: 2 !important; }
        .react-flow__node { overflow: visible !important; }
      `}</style>
    </div>
  )
}

export default function WorkflowEditor(props) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner {...props} />
    </ReactFlowProvider>
  )
}
