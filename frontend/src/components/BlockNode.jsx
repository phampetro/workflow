import React, { memo, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Play, Code2, GitBranch, Flag, Zap, Settings, Trash2, CheckCircle, XCircle, Loader, Timer, Send, Database, Table, Files, Mail, TableProperties } from 'lucide-react'

const BLOCK_TYPES = {
  start: {
    label: 'Start',
    icon: <Zap size={14} />,
    color: '#00d4aa',
    gradient: 'linear-gradient(135deg, #00d4aa, #0891b2)',
    description: 'Điểm bắt đầu workflow',
  },
  python: {
    label: 'Python Block',
    icon: <Code2 size={14} />,
    color: '#6c63ff',
    gradient: 'linear-gradient(135deg, #6c63ff, #8b5cf6)',
    description: 'Chạy đoạn code Python',
  },
  condition: {
    label: 'Condition',
    icon: <GitBranch size={14} />,
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    description: 'Rẽ nhánh theo điều kiện',
  },
  delay: {
    label: 'Delay',
    icon: <Timer size={14} />,
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6, #c084fc)',
    description: 'Dừng chờ theo số giây',
  },
  telegram: {
    label: 'Telegram',
    icon: <Send size={14} />,
    color: '#0088cc',
    gradient: 'linear-gradient(135deg, #0088cc, #33aadd)',
    description: 'Gửi tin nhắn Telegram',
  },
  email: {
    label: 'Email',
    icon: <Mail size={14} />,
    color: '#f43f5e',
    gradient: 'linear-gradient(135deg, #f43f5e, #e11d48)',
    description: 'Gửi Email tự động',
  },
  end: {
    label: 'End',
    icon: <Flag size={14} />,
    color: '#ef4444',
    gradient: 'linear-gradient(135deg, #ef4444, #dc2626)',
    description: 'Kết thúc workflow',
  },
  database: {
    label: 'Database',
    icon: <Database size={14} />,
    color: '#10b981',
    gradient: 'linear-gradient(135deg, #10b981, #059669)',
    description: 'Kết nối Cơ sở dữ liệu',
  },
  sql_to_excel: {
    label: 'SQL to Excel',
    icon: <Table size={14} />,
    color: '#059669',
    gradient: 'linear-gradient(135deg, #059669, #047857)',
    description: 'Xuất kết quả SQL ra Excel',
  },
  merge_excel: {
    label: 'Merge Excel',
    icon: <Files size={14} />,
    color: '#8b5cf6',
    gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    description: 'Ghép nhiều file Excel thành 1',
  },
  pivot_excel: {
    label: 'Pivot Excel',
    icon: <TableProperties size={14} />,
    color: '#f59e0b',
    gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
    description: 'Tổng hợp dữ liệu (Pivot)',
  },
}

const STATUS_STYLES = {
  idle:    { border: 'var(--border-default)', glow: 'none' },
  running: { border: '#22c55e', glow: '0 0 16px rgba(34,197,94,0.4)' },
  success: { border: '#22c55e', glow: '0 0 8px rgba(34,197,94,0.2)' },
  error:   { border: '#ef4444', glow: '0 0 16px rgba(239,68,68,0.4)' },
}

const BlockNode = memo(({ data, selected }) => {
  const type = BLOCK_TYPES[data.type] || BLOCK_TYPES.python
  const runStatus = data.runStatus || 'idle'
  const style = STATUS_STYLES[runStatus] || STATUS_STYLES.idle

  const hasSource = data.type !== 'end'
  const hasTarget = data.type !== 'start'

  const inPos = data.inPosition || 'left'
  const outPos = data.outPosition || 'right'
  const isOutVertical = outPos === 'top' || outPos === 'bottom'

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
          {runStatus === 'running' && <Loader size={12} className="spinning" />}
          {runStatus === 'success' && <CheckCircle size={12} color="white" />}
          {runStatus === 'error' && <XCircle size={12} color="white" />}
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
          <div className="block-desc" style={{ color: '#059669', fontWeight: 600 }}>
            {data.excelFileName || 'export.xlsx'}
          </div>
        ) : data.type === 'merge_excel' ? (
          <div className="block-desc" style={{ color: '#8b5cf6', fontWeight: 600 }}>
            {data.excelFileName || 'merged.xlsx'}
          </div>
        ) : (
          <div className="block-desc">
            {data.description || type.description}
          </div>
        )}



        {data.type === 'condition' && (
          <div className="block-condition">
            <span className="condition-label">if</span>
            <code>{data.condVariable || '?'} {data.condOperator || '=='} {data.condValue || '?'}</code>
          </div>
        )}
      </div>

      {/* Actions (show on hover via CSS) */}
      <div className="block-actions">
        <button
          className="block-action-btn"
          onClick={() => data.onEdit?.()}
          title="Chỉnh sửa"
        >
          <Settings size={14} />
        </button>
        <button
          className="block-action-btn danger"
          onClick={() => data.onDelete?.()}
          title="Xóa"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Source Handle */}
      {hasSource && (
        <>
          {data.type !== 'condition' && (
            <Handle
              type="source"
              position={outPos}
              id="default"
              className="block-handle block-handle-source"
              style={{ background: type.color }}
            />
          )}
          {data.type === 'condition' && (
            <>
              <Handle
                type="source"
                position={outPos}
                id="true"
                style={{
                  ...(isOutVertical ? { left: '30%' } : { top: '30%' }),
                  background: '#22c55e'
                }}
                className="block-handle block-handle-source"
              />
              <Handle
                type="source"
                position={outPos}
                id="false"
                style={{
                  ...(isOutVertical ? { left: '70%' } : { top: '70%' }),
                  background: '#ef4444'
                }}
                className="block-handle block-handle-source"
              />
            </>
          )}
        </>
      )}

      <style>{`
        .block-node {
          background: var(--bg-elevated);
          border: 1.5px solid var(--border-default);
          border-radius: 6px;
          min-width: 100px;
          max-width: 140px;
          transition: all 0.2s ease;
          position: relative;
          overflow: visible;
        }

        .block-node:hover .block-actions {
          opacity: 1;
        }

        .block-header {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          border-radius: 5px 5px 0 0;
        }

        .block-type-icon {
          display: flex;
          align-items: center;
          color: rgba(255,255,255,0.9);
        }

        .block-type-label {
          font-size: 6px;
          font-weight: 700;
          color: rgba(255,255,255,0.95);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          flex: 1;
        }

        .block-status-icon {
          color: white;
          display: flex;
          align-items: center;
        }
        .block-type-icon svg, .block-status-icon svg {
          width: 12px;
          height: 12px;
        }

        .block-body {
          padding: 4px 6px 6px;
        }

        .block-name {
          font-size: 7px;
          font-weight: 700;
          color: var(--text-primary);
          margin-bottom: 2px;
          line-height: 1.1;
        }

        .block-desc {
          font-size: 6px;
          color: var(--text-muted);
          line-height: 1.1;
        }



        .block-condition {
          margin-top: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .condition-label {
          font-size: 6px;
          font-weight: 700;
          color: var(--accent-warning);
          text-transform: uppercase;
        }

        .block-condition code {
          font-size: 6px;
          background: rgba(245,158,11,0.1);
          color: var(--accent-warning);
          border: 1px solid rgba(245,158,11,0.2);
          padding: 1px 4px;
          border-radius: 4px;
        }

        .block-actions {
          position: absolute;
          top: -28px;
          right: 0;
          display: flex;
          flex-direction: row;
          gap: 4px;
          opacity: 0;
          transition: opacity 0.15s ease;
        }

        .block-action-btn {
          width: 20px;
          height: 20px;
          border-radius: 4px;
          border: 1px solid var(--border-default);
          background: var(--bg-elevated);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .block-action-btn:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
          border-color: var(--border-accent);
        }

        .block-action-btn.danger:hover {
          background: rgba(239,68,68,0.15);
          color: var(--accent-danger);
          border-color: rgba(239,68,68,0.3);
        }
        .block-action-btn svg {
          width: 12px;
          height: 12px;
        }

        .block-handle {
          width: 8px !important;
          height: 8px !important;
          border: 1.5px solid var(--bg-elevated) !important;
          border-radius: 50% !important;
          transition: transform 0.15s ease !important;
          z-index: 10 !important;
        }

        .block-handle:hover {
          transform: scale(1.3) !important;
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
