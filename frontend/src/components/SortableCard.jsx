import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/**
 * SortableCard — wrapper generic cho bất kỳ card nào cần kéo thả.
 * Truyền id (string) và children vào. Tự handle drag handles, overlay.
 */
export default function SortableCard({ id, children, className = '' }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    zIndex: isDragging ? 10 : 'auto',
    position: 'relative',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`sortable-card ${isDragging ? 'dragging' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
