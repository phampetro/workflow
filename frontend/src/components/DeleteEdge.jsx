import React, { useState } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow } from '@xyflow/react'
import { X } from 'lucide-react'

// Đường THẲNG nối lần lượt các điểm (polyline)
function straightPath(pts) {
  return 'M ' + pts.map((p) => `${p.x},${p.y}`).join(' L ')
}

// Khoảng cách từ điểm p tới đoạn thẳng a–b (để tìm đoạn gần nhất khi chèn điểm)
function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export default function DeleteEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  style = {}, markerEnd, data, selected,
}) {
  const { screenToFlowPosition } = useReactFlow()
  const waypoints = data?.waypoints || []
  const [drag, setDrag] = useState(null)  // {idx, x, y} khi đang kéo 1 điểm

  const wps = drag ? waypoints.map((w, i) => (i === drag.idx ? { x: drag.x, y: drag.y } : w)) : waypoints
  const allPts = [{ x: sourceX, y: sourceY }, ...wps, { x: targetX, y: targetY }]

  // getBezierPath chỉ dùng để lấy vị trí giữa cạnh cho nút xóa; đường vẽ luôn THẲNG
  const [, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const path = straightPath(allPts)   // thẳng: nguồn → các điểm → đích

  const commit = (newWps) => data?.onWaypointsChange?.(id, newWps)

  const addPoint = (e) => {
    e.stopPropagation()
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    let bestIdx = 0, best = Infinity
    for (let i = 0; i < allPts.length - 1; i++) {
      const dd = distToSeg(pos, allPts[i], allPts[i + 1])
      if (dd < best) { best = dd; bestIdx = i }
    }
    const next = [...waypoints]
    next.splice(bestIdx, 0, { x: pos.x, y: pos.y })   // chèn vào đoạn gần nhất
    commit(next)
  }

  const pointerDown = (i, e) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDrag({ idx: i, x: waypoints[i].x, y: waypoints[i].y })
  }
  const pointerMove = (e) => {
    if (!drag) return
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY })
    setDrag((d) => (d ? { ...d, x: pos.x, y: pos.y } : d))
  }
  const pointerUp = () => {
    if (!drag) return
    const next = waypoints.map((w, i) => (i === drag.idx ? { x: drag.x, y: drag.y } : w))
    setDrag(null)
    commit(next)
  }
  const removePoint = (i, e) => { e.stopPropagation(); commit(waypoints.filter((_, idx) => idx !== i)) }

  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />

      {/* Chỉ hiện công cụ chỉnh khi cạnh được chọn */}
      {selected && (
        <path d={path} fill="none" strokeWidth={18}
          style={{ pointerEvents: 'stroke', stroke: 'transparent', cursor: 'copy' }}
          onDoubleClick={addPoint} className="nopan" />
      )}

      <EdgeLabelRenderer>
        {selected && wps.map((w, i) => (
          <div
            key={i}
            className="edge-waypoint nodrag nopan"
            style={{ transform: `translate(-50%,-50%) translate(${w.x}px,${w.y}px)` }}
            onPointerDown={(e) => pointerDown(i, e)}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onDoubleClick={(e) => removePoint(i, e)}
            title="Kéo để uốn đường · double-click để xóa điểm"
          />
        ))}

        {selected && (
          <div
            className="nodrag nopan"
            style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all', zIndex: 1000 }}
          >
            <button
              className="edge-delete-btn"
              title="Xóa kết nối"
              aria-label="Xóa kết nối"
              onClick={(e) => { e.stopPropagation(); data?.onDelete?.(id) }}
            >
              <X size="0.75rem" />
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}
