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
  Save, Loader, CheckCircle, AlertCircle, Database, Table, Files
} from 'lucide-react'
import { Button, Drawer, Space, Input, message } from 'antd'
import toast from 'react-hot-toast'
import { getWorkflow, updateWorkflow, runWorkflow, stopWorkflow, getWorkflowInput } from '../api/client'

const nodeTypes = { block: BlockNode }
const edgeTypes = { custom: DeleteEdge }

const BLOCK_GROUPS = [
  { title: 'Bắt đầu - Kết thúc', items: ['start', 'end'] },
  { title: 'Rẽ nhánh', items: ['condition', 'delay'] },
  { title: 'Python Code', items: ['python'] },
  { title: 'Xử lý Dữ liệu', items: ['merge_excel', 'pivot_excel'] },
  { title: 'Cơ sở dữ liệu', items: ['database', 'sql_to_excel'] },
  { title: 'Gửi tin nhắn', items: ['telegram', 'email'] }
];

const DEFAULT_GRAPH = {
  nodes: [
    { id: 'start-1', type: 'block', position: { x: 50, y: 150 },  data: { type: 'start', label: 'Bắt đầu', description: 'Khởi động workflow' } },
    { id: 'end-1',   type: 'block', position: { x: 500, y: 150 }, data: { type: 'end',   label: 'Hoàn thành', description: 'Workflow kết thúc' } },
  ],
  edges: [],
}

const EDGE_STYLE = { stroke: '#6c63ff', strokeWidth: 2 }

let nodeIdCounter = 100

function WorkflowEditorInner({ workflow, project, onBack }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [editingNode, setEditingNode] = useState(null)
  const [showLogs, setShowLogs] = useState(false)
  const [showScheduler, setShowScheduler] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [searchBlock, setSearchBlock] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [showInputModal, setShowInputModal] = useState(false)
  const [inputData, setInputData] = useState({})
  const [inputKeys, setInputKeys] = useState([])
  const [currentRunId, setCurrentRunId] = useState(null)
  const [saveStatus, setSaveStatus] = useState('saved')
  const [wfData, setWfData] = useState(workflow)
  const saveTimer = useRef(null)
  const reactFlowWrapper = useRef(null)
  const { screenToFlowPosition } = useReactFlow()

  const proj  = project  || { name: 'Project', color: '#6c63ff' }

  useEffect(() => {
    if (!workflow?.id) return
    getWorkflow(workflow.id).then((res) => {
      const wf = res.data
      setWfData(wf)
      if (wf.graph_json) {
        try {
          const graph = JSON.parse(wf.graph_json)
          const loadedNodes = (graph.nodes || []).map(n => ({
            ...n,
            data: { ...n.data, onEdit: undefined, onDelete: undefined },
          }))
          const loadedEdges = (graph.edges || []).map(e => {
            const cleanEdge = { ...e, type: 'custom' }
            cleanEdge.markerEnd = { type: MarkerType.ArrowClosed, color: '#6c63ff' }
            cleanEdge.data = { ...cleanEdge.data, onDelete: handleDeleteEdge }
            return cleanEdge
          })
          setNodes(loadedNodes)
          setEdges(loadedEdges)
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
  }, [workflow?.id])

  const setNodesFromDefault = () => {
    setNodes(DEFAULT_GRAPH.nodes)
    setEdges(DEFAULT_GRAPH.edges)
  }

  const triggerAutoSave = useCallback((newNodes, newEdges) => {
    setSaveStatus('unsaved')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveGraph(newNodes, newEdges)
    }, 1500)
  }, [wfData?.id])

  const saveGraph = useCallback(async (currentNodes, currentEdges) => {
    if (!wfData?.id) return
    setSaveStatus('saving')
    try {
      const graph = {
        nodes: currentNodes.map(n => {
          const cleanData = { ...n.data }
          delete cleanData.onDelete
          delete cleanData.onEdit
          return {
            id: n.id,
            type: n.type,
            position: n.position,
            data: cleanData,
          }
        }),
        edges: currentEdges,
      }
      await updateWorkflow(wfData.id, { graph_json: JSON.stringify(graph) })
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }, [wfData?.id])

  const handleNodesChange = useCallback((changes) => {
    onNodesChange(changes)
    setNodes(nds => {
      triggerAutoSave(nds, edges)
      return nds
    })
  }, [onNodesChange, edges, triggerAutoSave])

  const handleEdgesChange = useCallback((changes) => {
    onEdgesChange(changes)
    setEdges(eds => {
      triggerAutoSave(nodes, eds)
      return eds
    })
  }, [onEdgesChange, nodes, triggerAutoSave])

  const handleManualSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveGraph(nodes, edges)
  }

  const handleDeleteEdge = useCallback((edgeId) => {
    setEdges(eds => {
      const newEdges = eds.filter(e => e.id !== edgeId)
      triggerAutoSave(nodes, newEdges)
      return newEdges
    })
  }, [nodes, triggerAutoSave])

  const onConnect = useCallback(
    (params) => {
      const newEdges = addEdge({
        ...params, animated: true,
        type: 'custom',
        style: EDGE_STYLE,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#6c63ff' },
        data: { onDelete: handleDeleteEdge },
      }, edges)
      setEdges(newEdges)
      triggerAutoSave(nodes, newEdges)
    },
    [edges, nodes, triggerAutoSave, handleDeleteEdge]
  )

  const openEditor = (nodeId) => {
    const node = nodes.find((n) => n.id === nodeId)
    if (node) setEditingNode(node)
  }

  const deleteNode = (nodeId) => {
    const newNodes = nodes.filter((n) => n.id !== nodeId)
    const newEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
    setNodes(newNodes)
    setEdges(newEdges)
    triggerAutoSave(newNodes, newEdges)
  }

  const handleSaveBlock = (nodeId, data) => {
    const newNodes = nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
    )
    setNodes(newNodes)
    setEditingNode(null)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveGraph(newNodes, edges)
  }

  const handleRun = async () => {
    if (!wfData?.id) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    await saveGraph(nodes, edges)

    setIsRunning(true)
    setShowLogs(true)
    try {
      const res = await runWorkflow(wfData.id)
      setCurrentRunId(res.data.run_id)
      toast.success('Đã kích hoạt chạy workflow!')
    } catch (e) {
      toast.error('Lỗi chạy workflow: ' + e.message)
      setIsRunning(false)
    }
  }

  const handleStop = async () => {
    if (wfData?.id) {
      await stopWorkflow(wfData.id).catch(() => {})
    }
    setIsRunning(false)
  }

  const handleRunFinished = useCallback(() => {
    setIsRunning(false)
    setCurrentRunId(null)
    message.success('Chạy Workflow hoàn tất!')
  }, [])

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
      if (typeof type === 'undefined' || !type) return

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
          dbType: type === 'database' ? 'postgresql' : undefined,
          dbHost: type === 'database' ? 'localhost' : undefined,
          dbPort: type === 'database' ? 5432 : undefined,
        },
      }

      const newNodes = [...nodes, newNode]
      setNodes(newNodes)
      triggerAutoSave(newNodes, edges)
    },
    [nodes, edges, screenToFlowPosition, triggerAutoSave]
  )

  const nodesWithCb = nodes.map((n) => ({
    ...n,
    data: {
      ...n.data,
      onEdit: () => openEditor(n.id),
      onDelete: () => deleteNode(n.id),
    },
  }))

  const SaveIcon = saveStatus === 'saving' ? Loader
    : saveStatus === 'saved' ? CheckCircle
    : saveStatus === 'error' ? AlertCircle
    : null

  return (
    <div className="workflow-editor">
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <Button size="small" type="text" onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ArrowLeft size={14} /> Quay lại
          </Button>
          <div className="toolbar-sep" />
          <div className="toolbar-info" style={{ overflow: 'hidden' }}>
            <div className="toolbar-dot" style={{ background: proj.color, flexShrink: 0 }} />
            <span className="text-secondary text-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{proj.name}</span>
            <span className="text-muted" style={{ flexShrink: 0 }}>/</span>
            <span className="font-semibold" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{wfData?.name || 'Workflow'}</span>
          </div>
        </div>

        <div className="toolbar-center">
          {/* Palette moved to sidebar */}
        </div>

        <div className="toolbar-right">
          <div className="save-status">
            {SaveIcon && <SaveIcon size={14} className={saveStatus === 'saving' ? 'spinning' : ''} />}
            <span>{saveStatus === 'saving' ? 'Đang lưu...' : saveStatus === 'saved' ? 'Đã lưu' : saveStatus === 'error' ? 'Lỗi lưu' : 'Chưa lưu'}</span>
          </div>
          <Space>
            <Button size="small" icon={<Database size={14} />} onClick={() => setShowInputModal(true)}>Dữ liệu Workflow</Button>
            <Button size="small" icon={<History size={14} />} onClick={() => setShowHistory(true)}>Lịch sử</Button>
            <Button size="small" icon={<Calendar size={14} />} onClick={() => setShowScheduler(true)}>Lịch chạy</Button>
            <Button size="small" icon={<Terminal size={14} />} onClick={() => setShowLogs(!showLogs)} type={showLogs ? 'primary' : 'default'} ghost={showLogs}>Logs</Button>
            <Button size="small" icon={<Save size={14} />} onClick={handleManualSave} disabled={saveStatus === 'saving'}>Lưu</Button>
            {isRunning ? (
              <Button size="small" danger icon={<Square size={14} />} onClick={handleStop}>Dừng</Button>
            ) : (
              <Button size="small" type="primary" icon={<Play size={14} />} onClick={handleRun} disabled={!wfData?.id}>Chạy</Button>
            )}
          </Space>
        </div>
      </div>

      <div className="editor-body">
        {/* Left Sidebar Palette */}
        <div className="sidebar-palette">
          <div className="palette-title">Khối chức năng</div>
          <div className="palette-desc">Kéo thả vào vùng vẽ</div>
          <div style={{ padding: '0 12px 8px 12px' }}>
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
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeDoubleClick={(e, node) => openEditor(node.id)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            defaultEdgeOptions={{
              animated: true, type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed, color: '#6c63ff' },
            }}
            style={{ background: 'transparent' }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255,255,255,0.04)" />
            <Controls style={{ background:'var(--bg-elevated)', border:'1px solid var(--border-default)', borderRadius:10 }} />
            <MiniMap
              style={{ background:'var(--bg-elevated)', border:'1px solid var(--border-default)', borderRadius:10 }}
              nodeColor={(n) => BLOCK_TYPES[n.data?.type]?.color || '#6c63ff'}
              maskColor="rgba(0,0,0,0.6)"
            />
          </ReactFlow>
        </div>

        {showLogs && (
          <LogViewer
            runId={currentRunId}
            isRunning={isRunning}
            onClose={() => setShowLogs(false)}
            onFinished={handleRunFinished}
          />
        )}
      </div>

      <Drawer
        title="Lịch sử chạy Workflow"
        placement="right"
        width="50vw"
        onClose={() => setShowHistory(false)}
        open={showHistory}
        bodyStyle={{ padding: 16 }}
      >
        <WorkflowHistoryPanel workflowId={wfData?.id} />
      </Drawer>

      {editingNode && (
        <BlockEditorModal
          node={editingNode}
          open={!!editingNode}
          onClose={() => setEditingNode(null)}
          onSave={handleSaveBlock}
          inputKeys={inputKeys}
          workflowId={wfData?.id}
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
        initialData={inputData}
      />

      {showScheduler && (
        <SchedulerPanel workflow={wfData} onClose={() => setShowScheduler(false)} />
      )}

      <style>{`
        .workflow-editor { display:flex; flex-direction:column; height:100%; overflow:hidden; }
        .editor-toolbar { display:flex; align-items:center; justify-content:space-between; padding:0 var(--space-4); height:52px; background:var(--bg-surface); border-bottom:1px solid var(--border-default); flex-shrink:0; gap:var(--space-4); }
        .toolbar-left, .toolbar-right { display:flex; align-items:center; gap:var(--space-2); flex:1; }
        .toolbar-right { justify-content:flex-end; }
        .toolbar-sep { width:1px; height:18px; background:var(--border-default); }
        .toolbar-info { display:flex; align-items:center; gap:6px; font-size:.875rem; }
        .toolbar-dot { width:8px; height:8px; border-radius:50%; }
        
        .editor-body { flex:1; display:flex; overflow:hidden; }
        
        /* Sidebar Palette Styles */
        .sidebar-palette {
          width: 260px;
          background: var(--bg-surface);
          border-right: 1px solid var(--border-default);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          flex-shrink: 0;
        }
        .palette-title {
          font-weight: 600;
          padding: 16px 16px 4px 16px;
          color: var(--text-primary);
        }
        .palette-desc {
          font-size: 0.75rem;
          color: var(--text-muted);
          padding: 0 16px 16px 16px;
          border-bottom: 1px solid var(--border-subtle);
        }
        .palette-list {
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .palette-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .palette-group-title {
          font-size: 0.7rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding-left: 4px;
        }
        .palette-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: var(--bg-elevated);
          border: 1px solid var(--border-default);
          border-left-width: 4px;
          border-radius: 8px;
          cursor: grab;
          transition: all 0.2s;
        }
        .palette-item:hover {
          background: var(--bg-hover);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .palette-item:active {
          cursor: grabbing;
        }
        .palette-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-base);
          padding: 4px;
          border-radius: 6px;
        }
        .palette-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          overflow: hidden;
        }
        .palette-label {
          font-weight: 500;
          font-size: 0.75rem;
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .palette-desc-text {
          font-size: 0.65rem;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .canvas-area { flex:1; background:var(--bg-base); position:relative; }
        
        .save-status { display:flex; align-items:center; gap:5px; font-size:.75rem; color:var(--text-muted); padding:0 8px; }
        .save-status svg { color:var(--accent-success); }

        .spinning { animation:spin .8s linear infinite; }

        .edge-delete-btn { width: 20px; height: 20px; background: var(--bg-surface); border: 1px solid var(--accent-danger); border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--accent-danger); transition: all 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .edge-delete-btn:hover { background: var(--accent-danger); color: white; transform: scale(1.1); box-shadow: 0 4px 8px rgba(239,68,68,0.4); }

        .react-flow__controls button { background:var(--bg-elevated) !important; color:var(--text-secondary) !important; border:none !important; border-bottom:1px solid var(--border-default) !important; }
        .react-flow__controls button:hover { background:var(--bg-hover) !important; color:var(--text-primary) !important; }
        .react-flow__controls svg path { fill:currentColor !important; }
        .react-flow__edge-path { stroke-width:2 !important; }
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
