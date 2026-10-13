import React, { memo, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { NodeResizer, NodeToolbar, Position } from '@xyflow/react'
import { Copy, GripHorizontal, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NodeActionsContext } from './BlockNode'
import './NoteNode.css'

// Khối "Ghi chú": tờ giấy dán trên canvas, KHÔNG có cổng nối nên không bao giờ chạy
// (backend duyệt từ khối Start theo đường nối). Màu lấy từ --note-<màu>-* (index.css).
export const NOTE_COLORS = ['yellow', 'blue', 'green', 'pink', 'gray']
const NOTE_SIZES = [
  { key: 'sm', i18n: 'noteNode.sizeSmall',  font: '0.7rem' },
  { key: 'md', i18n: 'noteNode.sizeMedium', font: '0.85rem' },
  { key: 'lg', i18n: 'noteNode.sizeLarge',  font: '1.05rem' },
]
// Gõ vào state cục bộ rồi mới đẩy lên editor: đẩy từng phím sẽ re-render + autosave cả canvas.
const COMMIT_DELAY = 600

const NoteNode = memo(({ id, data, selected }) => {
  const { t } = useTranslation()
  const actions = useContext(NodeActionsContext)
  const color = NOTE_COLORS.includes(data.noteColor) ? data.noteColor : 'yellow'
  const size = NOTE_SIZES.some(s => s.key === data.noteSize) ? data.noteSize : 'md'

  const [text, setText] = useState(data.text || '')
  const areaRef = useRef(null)
  const timerRef = useRef(null)
  const latestRef = useRef(data.text || '')      // nội dung mới nhất đang gõ
  const committedRef = useRef(data.text || '')   // nội dung đã đẩy lên editor
  const editingRef = useRef(false)               // đang gõ → không để thay đổi từ ngoài ghi đè
  const snapshotDoneRef = useRef(false)          // 1 phiên gõ = 1 mục undo
  committedRef.current = data.text || ''

  // Đồng bộ khi data.text đổi từ ngoài (undo/redo...) — CHỈ khi không đang gõ,
  // nếu không, lần commit giữa chừng sẽ ghi đè các ký tự người dùng vừa gõ tiếp.
  useEffect(() => {
    if (!editingRef.current) {
      setText(data.text || '')
      latestRef.current = data.text || ''
    }
  }, [data.text])

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (latestRef.current === committedRef.current) return
    actions?.onNoteChange(id, { text: latestRef.current }, { snapshot: !snapshotDoneRef.current })
    snapshotDoneRef.current = true
  }, [actions, id])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // Vừa kéo từ palette ra (đang được chọn, còn trống) → đặt con trỏ sẵn để gõ luôn
  useEffect(() => {
    if (selected && !data.text) areaRef.current?.focus({ preventScroll: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleChange = (e) => {
    setText(e.target.value)
    latestRef.current = e.target.value
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, COMMIT_DELAY)
  }

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={160}
        minHeight={90}
        handleClassName="note-resizer-handle"
        lineClassName="note-resizer-line"
        onResizeStart={() => actions?.onSnapshot?.()}
      />
      <NodeToolbar isVisible={selected} position={Position.Top} align="start" offset={8}>
        <div className="note-toolbar nodrag nopan" role="toolbar" aria-label={t('noteNode.toolbar')}>
          {NOTE_COLORS.map(c => (
            <button
              key={c}
              type="button"
              className="note-swatch"
              data-color={c}
              aria-label={t(`noteNode.color.${c}`)}
              title={t(`noteNode.color.${c}`)}
              aria-pressed={c === color}
              onClick={() => actions?.onNoteChange(id, { noteColor: c })}
            />
          ))}
          <span className="note-toolbar-sep" aria-hidden="true" />
          {NOTE_SIZES.map(s => (
            <button
              key={s.key}
              type="button"
              className="note-tool-btn"
              style={{ fontSize: s.font }}
              aria-label={t(s.i18n)}
              title={t(s.i18n)}
              aria-pressed={s.key === size}
              onClick={() => actions?.onNoteChange(id, { noteSize: s.key })}
            >A</button>
          ))}
          <span className="note-toolbar-sep" aria-hidden="true" />
          <button type="button" className="note-tool-btn" aria-label={t('noteNode.duplicate')} title={t('noteNode.duplicate')} onClick={() => actions?.onDuplicate(id)}>
            <Copy size={14} />
          </button>
          <button type="button" className="note-tool-btn note-tool-danger" aria-label={t('noteNode.delete')} title={t('noteNode.delete')} onClick={() => actions?.onDelete(id)}>
            <Trash2 size={14} />
          </button>
        </div>
      </NodeToolbar>

      <div className={`note-node note-size-${size}${selected ? ' selected' : ''}`} data-color={color}>
        {/* Thanh trên cùng là chỗ để KÉO DI CHUYỂN (phần thân là ô gõ nên nodrag) */}
        <div className="note-node-header" title={t('noteNode.dragHandle')}>
          <GripHorizontal size={14} aria-hidden="true" />
        </div>
        <textarea
          ref={areaRef}
          className="note-node-text nodrag nowheel nopan"
          value={text}
          placeholder={t('noteNode.placeholder')}
          aria-label={t('noteNode.ariaLabel')}
          spellCheck={false}
          onChange={handleChange}
          onFocus={() => { editingRef.current = true; snapshotDoneRef.current = false }}
          onBlur={() => { editingRef.current = false; flush() }}
          onKeyDown={(e) => { if (e.key === 'Escape') e.currentTarget.blur() }}
        />
      </div>
    </>
  )
})

export default NoteNode
