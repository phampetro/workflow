import React, { memo, useState, useEffect } from 'react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { Play, Code2, GitBranch, Flag, Zap, Settings, Trash2, CheckCircle, XCircle, Loader, Timer, Send, Database, Table, Files, Mail, TableProperties, Globe, Radio, Copy, Repeat, AlertTriangle, Terminal, FileSpreadsheet, Hourglass } from 'lucide-react'
const BLOCK_TYPES = {
  start: {
    label: 'Start',
    icon: <Zap size="0.875rem" />,
    color: '#00d4aa',
    gradient: 'linear-gradient(135deg, #00d4aa, #0891b2)',
    description: 'Điểm bắt đầu workflow',
  },
  error_trigger: {
    label: 'Bắt Lỗi',
    icon: <AlertTriangle size="0.875rem" />,
    color: '#ef4444',
    gradient: 'linear-gradient(135deg, #ef4444, #b91c1c)',
    description: 'Tự động kích hoạt khi có khối lỗi',
  },
  python: {
    label: 'Python Block',
    icon: <Code2 size="0.875rem" />,
    color: '#6c63ff',
    gradient: 'linear-gradient(135deg, #6c63ff, #8b5cf6)',
    description: 'Chạy đoạn code Python',
  },
  condition: {
    label: 'Condition',
    icon: <GitBranch size="0.875rem" />,
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    description: 'Rẽ nhánh theo điều kiện',
  },
  loop: {
    label: 'Vòng Lặp',
    icon: <Repeat size="0.875rem" />,
    color: '#ec4899',
    gradient: 'linear-gradient(135deg, #ec4899, #be185d)',
    description: 'Lặp lại theo số lần/điều kiện',
  },
  delay: {
    label: 'Delay',
    icon: <Timer size="0.875rem" />,
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6, #c084fc)',
    description: 'Dừng chờ theo số giây',
  },
  queue: {
    label: 'Xếp hàng',
    icon: <Hourglass size="0.875rem" />,
    color: '#64748b',
    gradient: 'linear-gradient(135deg, #64748b, #475569)',
    description: 'Chờ các nhánh khác xong rồi chạy tiếp 1 lần',
  },
  telegram: {
    label: 'Telegram',
    icon: <Send size="0.875rem" />,
    color: '#0088cc',
    gradient: 'linear-gradient(135deg, #0088cc, #33aadd)',
    description: 'Gửi tin nhắn Telegram',
  },
  telegram_listener: {
    label: 'TG Listener',
    icon: <Radio size="0.875rem" />,
    color: '#0088cc',
    gradient: 'linear-gradient(135deg, #00bfff, #0088cc)',
    description: 'Lắng nghe lệnh Telegram',
  },
  email: {
    label: 'Email',
    icon: <Mail size="0.875rem" />,
    color: '#f43f5e',
    gradient: 'linear-gradient(135deg, #f43f5e, #e11d48)',
    description: 'Gửi Email tự động',
  },
  end: {
    label: 'End',
    icon: <Flag size="0.875rem" />,
    color: '#ef4444',
    gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
    description: 'Kết thúc workflow',
  },
  sql_to_excel: {
    label: 'SQL to Excel',
    icon: <Table size="0.875rem" />,
    color: '#059669',
    gradient: 'linear-gradient(135deg, #059669, #047857)',
    description: 'Xuất kết quả SQL ra Excel',
  },
  excel_to_sql: {
    label: 'Excel to SQL',
    icon: <TableProperties size="0.875rem" />,
    color: '#0284c7',
    gradient: 'linear-gradient(135deg, #0284c7, #0369a1)',
    description: 'Đọc Excel & ghi bảng DB',
  },
  google_sheets_read: {
    label: 'Google Sheets',
    icon: <TableProperties size="0.875rem" />,
    color: '#0f9d58',
    gradient: 'linear-gradient(135deg, #0f9d58, #0b8043)',
    description: 'Đọc dữ liệu từ Google Sheet (Public Link)',
  },
  excel_read: {
    label: 'Đọc Excel',
    icon: <FileSpreadsheet size="0.875rem" />,
    color: '#217346',
    gradient: 'linear-gradient(135deg, #217346, #185c37)',
    description: 'Đọc file Excel/CSV thành mảng dữ liệu',
  },
  run_sql_exec: {
    label: 'Chạy Hàm SQL (EXEC)',
    icon: <Terminal size="0.875rem" />,
    color: '#14b8a6',
    gradient: 'linear-gradient(135deg, #14b8a6, #0f766e)',
    description: 'Thực thi hàm/thủ tục SQL và lấy kết quả trả về',
  },
  merge_excel: {
    label: 'Merge Excel',
    icon: <Files size="0.875rem" />,
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    description: 'Ghép nhiều file Excel thành 1',
  },
  pivot_excel: {
    label: 'Pivot Excel',
    icon: <TableProperties size="0.875rem" />,
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    description: 'Tổng hợp dữ liệu (Pivot)',
  },
  browser: {
    label: 'Trình Duyệt',
    icon: <Globe size="0.875rem" />,
    color: '#0ea5e9',
    gradient: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
    description: 'Tự động hóa trình duyệt web',
  },
  delete_files: {
    label: 'Xóa Tập Tin',
    icon: <Trash2 size="0.875rem" />,
    color: '#f43f5e',
    gradient: 'linear-gradient(135deg, #f43f5e, #e11d48)',
    description: 'Xóa tập tin Input/Output',
  },
}

const STATUS_STYLES = {
  idle:    { border: 'var(--border-default)', glow: 'none' },
  running: { border: '#22c55e', glow: '0 0 16px rgba(34,197,94,0.4)' },
  success: { border: '#22c55e', glow: '0 0 8px rgba(34,197,94,0.2)' },
  error:   { border: '#ef4444', glow: '0 0 16px rgba(239,68,68,0.4)' },
}

const BlockNode = memo(({ id, data, selected }) => {
  const type = BLOCK_TYPES[data.type] || BLOCK_TYPES.python
  const runStatus = data.runStatus || 'idle'
  const style = STATUS_STYLES[runStatus] || STATUS_STYLES.idle

  const hasSource = data.type !== 'end'
  const hasTarget = data.type !== 'start' && data.type !== 'error_trigger'

  const inPos = data.inPosition || 'left'
  const outPos = data.outPosition || 'right'
  const loopPos = data.loopPosition || 'right'
  const donePos = data.donePosition || 'right'
  const isOutVertical = outPos === 'top' || outPos === 'bottom'
  const isLoopVertical = loopPos === 'top' || loopPos === 'bottom'
  const isDoneVertical = donePos === 'top' || donePos === 'bottom'

  // React Flow cache vị trí handle theo lần đo đầu tiên; khi số lượng/vị trí
  // handle đổi (đổi cổng IN/OUT, đổi loại block) phải báo lại để nó đo lại,
  // nếu không cạnh nối vẫn tồn tại trong dữ liệu nhưng vẽ sai/mất trên canvas.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, inPos, outPos, loopPos, donePos, hasSource, hasTarget, data.type, updateNodeInternals])

  return (
    <div
      className={`block-node ${selected ? 'selected' : ''} status-${runStatus}`}
      style={{
        '--block-color': type.color,
        borderColor: selected ? type.color : style.border,
        boxShadow: selected
          ? `0 0 0 2px ${type.color}44, ${style.glow}`
          : style.glow,
      }}
    >
      {/* Target Handle */}
      {hasTarget && (
        <Handle
          type="target"
          position={inPos}
          className="block-handle block-handle-target"
          style={{ background: type.color }}
        />
      )}

      {/* Header */}
      <div className="block-header" style={{ background: type.gradient }}>
        <div className="block-type-icon">{type.icon}</div>
        <span className="block-type-label">{type.label}</span>
        <div className="block-status-icon">
          {runStatus === 'running' && <Loader size="0.75rem" className="spinning" />}
          {runStatus === 'success' && <CheckCircle size="0.75rem" color="white" />}
          {runStatus === 'error' && <XCircle size="0.75rem" color="white" />}
        </div>
      </div>

      {/* Body */}
      <div className="block-body">
        <div className="block-name">{data.label || `${type.label} Block`}</div>
        {data.type === 'delay' ? (
          <div className="block-desc" style={{ color: 'var(--accent-warning)', fontWeight: 600 }}>
            Dừng chờ {data.delaySeconds || 3} giây
          </div>
        ) : data.type === 'sql_to_excel' ? (
          <div className="block-desc" style={{ color: 'var(--accent-success)', fontWeight: 600 }}>
            {data.excelFileName || 'export.xlsx'}
          </div>
        ) : data.type === 'merge_excel' ? (
          <div className="block-desc" style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
            {data.excelFileName || 'merged.xlsx'}
          </div>
        ) : data.type === 'browser' ? (
          <div className="block-desc" style={{ color: '#0ea5e9', fontWeight: 600 }}>
            {data.debugMode ? '🔍 Debug Mode' : '🤖'} {data.steps?.length || 0} bước
          </div>
        ) : (
          <div className="block-desc">
            {data.description || type.description}
          </div>
        )}



        {data.type === 'condition' && (
          <div className="block-condition">
            <span className="condition-label">if</span>
            <code>
              {(() => {
                const conds = data.conditions || [{
                  condVariable: data.condVariable,
                  condOperator: data.condOperator || '==',
                  condValue: data.condValue
                }];
                if (!conds[0]?.condVariable) return '? == ?';
                if (conds.length === 1) return `${conds[0].condVariable} ${conds[0].condOperator} ${conds[0].condValue}`;
                return `${conds.length} conditions (${data.logicalOperator || 'AND'})`;
              })()}
            </code>
          </div>
        )}

        {data.type === 'loop' && (
          <div className="block-condition" style={{ borderColor: 'rgba(236, 72, 153, 0.2)' }}>
            <span className="condition-label" style={{ color: '#ec4899' }}>loop</span>
            <code style={{ background: 'rgba(236, 72, 153, 0.1)', color: '#ec4899', borderColor: 'rgba(236, 72, 153, 0.2)' }}>
              {(() => {
                const mode = data.loopMode || 'count';
                if (mode === 'count') return `${data.loopCount || 0} lần`;
                if (mode === 'array') return `Mảng: ${data.loopArrayVar || 'sheets_data'}`;
                const conds = data.conditions || [];
                if (!conds[0]?.condVariable) return '? == ?';
                if (conds.length === 1) return `${conds[0].condVariable} ${conds[0].condOperator} ${conds[0].condValue}`;
                return `${conds.length} conditions (${data.logicalOperator || 'AND'})`;
              })()}
            </code>
          </div>
        )}
      </div>

      {/* Actions - always visible */}
      <div className="block-actions">
        <button
          className="block-action-btn"
          onClick={() => data.onEdit?.()}
          title="Chỉnh sửa"
        >
          <Settings size="0.875rem" />
        </button>
        <button
          className="block-action-btn"
          onClick={(e) => { e.stopPropagation(); data.onDuplicate?.() }}
          title="Sao chép khối"
          style={{ color: 'var(--accent-primary)' }}
        >
          <Copy size="0.875rem" />
        </button>
        <button
          className="block-action-btn danger"
          onClick={() => data.onDelete?.()}
          title="Xóa"
        >
          <Trash2 size="0.875rem" />
        </button>
      </div>

      {/* Source Handle */}
      {hasSource && (
        <>
          {data.type !== 'condition' && data.type !== 'loop' && (
            <Handle
              type="source"
              position={outPos}
              id="default"
              className="block-handle block-handle-source"
              style={{ background: type.color }}
              title="Cổng ra (OUT)"
            />
          )}
          {data.type === 'condition' && (
            <>
              <Handle
                type="source"
                position={loopPos}
                id="true"
                style={{
                  ...(isLoopVertical ? { left: '30%' } : { top: '30%' }),
                  background: '#22c55e'
                }}
                className="block-handle block-handle-source"
              />
              <Handle
                type="source"
                position={donePos}
                id="false"
                style={{
                  ...(isDoneVertical ? { left: '70%' } : { top: '70%' }),
                  background: '#ef4444'
                }}
                className="block-handle block-handle-source"
              />
            </>
          )}
          {data.type === 'loop' && (
            <>
              <Handle
                type="source"
                position={loopPos}
                id="loop"
                style={{
                  ...(isLoopVertical ? { left: '30%' } : { top: '30%' }),
                  background: '#f59e0b'
                }}
                className="block-handle block-handle-source"
                title="Lặp lại (LOOP)"
              />
              <Handle
                type="source"
                position={outPos}
                id="true"
                style={{
                  background: '#22c55e'
                }}
                className="block-handle block-handle-source"
                title="Đúng điều kiện (TRUE)"
              />
              <Handle
                type="source"
                position={donePos}
                id="endloop"
                style={{
                  ...(isDoneVertical ? { left: '70%' } : { top: '70%' }),
                  background: '#ef4444'
                }}
                className="block-handle block-handle-source"
                title="Kết thúc lặp (ENDLOOP)"
              />
            </>
          )}
        </>
      )}

      <style>{`
        .block-node {
          background: var(--bg-surface);
          border: 1px solid var(--border-default);
          border-radius: var(--radius-md);
          min-width: 120px;
          max-width: 160px;
          transition: all var(--transition-fast);
          position: relative;
          overflow: visible;
          box-shadow: var(--shadow-sm);
        }

        .block-node:hover {
          transform: translateY(-2px);
          box-shadow: 0 0 0 2px var(--block-color), var(--shadow-md);
        }

        .block-header {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 8px;
          border-radius: calc(var(--radius-md) - 1px) calc(var(--radius-md) - 1px) 0 0;
          box-shadow: inset 0 -1px 0 rgba(0,0,0,0.1);
        }

        .block-type-icon {
          display: flex;
          align-items: center;
          color: rgba(255,255,255,0.9);
        }

        .block-type-label {
          font-size: 0.65rem;
          font-weight: 700;
          color: white;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          flex: 1;
        }

        .block-status-icon {
          color: white;
          display: flex;
          align-items: center;
        }
        .block-type-icon svg, .block-status-icon svg {
          width: 14px;
          height: 14px;
        }

        .block-body {
          padding: 8px;
          border-radius: 0 0 11px 11px;
          background: var(--bg-surface);
        }

        .block-name {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 2px;
          line-height: 1.2;
        }

        .block-desc {
          font-size: 0.65rem;
          color: var(--text-muted);
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .block-condition {
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .condition-label {
          font-size: 0.6rem;
          font-weight: 700;
          color: var(--accent-warning);
          text-transform: uppercase;
        }

        .block-condition code {
          font-size: 0.6rem;
          background: rgba(245,158,11,0.1);
          color: var(--accent-warning);
          border: 1px solid rgba(245,158,11,0.2);
          padding: 2px 4px;
          border-radius: var(--radius-sm);
        }

        .block-actions {
          position: absolute;
          top: -34px;
          right: 0;
          display: flex;
          flex-direction: row;
          gap: 6px;
          opacity: 0;
          pointer-events: none;
          transform: translateY(10px);
          transition: all var(--transition-fast);
          z-index: 100;
        }

        .block-node:hover .block-actions,
        .block-node.selected .block-actions {
          opacity: 1;
          pointer-events: auto;
          transform: translateY(0);
        }

        .block-action-btn {
          width: 26px;
          height: 26px;
          border-radius: var(--radius-sm);
          border: 1px solid var(--border-default);
          background: var(--bg-surface);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all var(--transition-fast);
          box-shadow: var(--shadow-sm);
        }

        .block-action-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
          border-color: var(--border-accent);
        }

        .block-action-btn.danger:hover {
          background: rgba(239,68,68,0.1);
          color: var(--accent-danger);
          border-color: rgba(239,68,68,0.3);
        }
        .block-action-btn svg {
          width: 14px;
          height: 14px;
        }

        .block-handle {
          width: 10px !important;
          height: 10px !important;
          border: 2px solid var(--bg-surface) !important;
          border-radius: 50% !important;
          transition: transform var(--transition-fast) !important;
          z-index: 10 !important;
          box-shadow: 0 0 0 1px rgba(0,0,0,0.1);
        }

        .block-handle:hover {
          transform: scale(1.4) !important;
        }

        .spinning {
          animation: spin 1s linear infinite;
        }

        .status-running { animation: breathe 2s ease-in-out infinite; }

        @keyframes breathe {
          0%, 100% { box-shadow: 0 0 8px rgba(34,197,94,0.3); }
          50% { box-shadow: 0 0 20px rgba(34,197,94,0.6); }
        }
      `}</style>
    </div>
  )
})

BlockNode.displayName = 'BlockNode'

export { BLOCK_TYPES }
export default BlockNode
