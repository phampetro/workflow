import { useCallback, useState } from 'react';

const MAX_HISTORY = 50;

// structuredClone là API native của trình duyệt (Chrome 98+, hỗ trợ ở mọi bản mà
// React 19 chạy được), nhanh hơn hẳn JSON.parse(JSON.stringify(...)) vì không phải
// dựng chuỗi trung gian. Fallback về JSON cho môi trường không có nó.
const deepClone = (value) => {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // node/edge có chứa giá trị không clone được (hàm, DOM node...) thì rơi về JSON
    }
  }
  return JSON.parse(JSON.stringify(value));
};

const cloneState = (nodes, edges) => ({
  nodes: deepClone(nodes),
  edges: deepClone(edges),
});

// So sánh NÔNG thay cho JSON.stringify cả graph.
//
// Bản cũ chạy tới 4 lần JSON.stringify + 2 lần JSON.parse trên toàn bộ graph cho
// MỖI snapshot, mà takeSnapshot được gọi ngay ở onNodeDragStart. Với workflow 40
// khối (mỗi khối Python có trường `code` vài KB → graph ~200KB), đó là 10-30ms
// chặn main thread đúng frame đầu tiên của thao tác kéo — cảm giác "dính chuột".
//
// React Flow tạo object node MỚI mỗi lần đổi (immutable update), nên so sánh
// reference từng phần tử là đủ chính xác cho mục đích khử trùng lặp snapshot.
const sameGraph = (a, b, nodes, edges) => {
  if (a.length !== nodes.length || b.length !== edges.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== nodes[i]) return false;
  }
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== edges[i]) return false;
  }
  return true;
};

export default function useUndoRedo() {
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  const takeSnapshot = useCallback((nodes, edges) => {
    setPast((prev) => {
      // Bỏ qua nếu không có gì đổi so với snapshot gần nhất
      if (prev.length > 0) {
        const last = prev[prev.length - 1];
        if (sameGraph(last.rawNodes, last.rawEdges, nodes, edges)) {
          return prev;
        }
      }

      const snap = cloneState(nodes, edges);
      // Giữ kèm mảng GỐC (không clone) chỉ để so sánh reference ở lần sau —
      // không dùng để khôi phục, nên không sợ bị mutate ngược.
      snap.rawNodes = nodes;
      snap.rawEdges = edges;

      const newPast = [...prev, snap];
      if (newPast.length > MAX_HISTORY) {
        newPast.shift(); // Giữ lại tối đa MAX_HISTORY phần tử
      }
      return newPast;
    });

    // Mỗi khi có hành động mới, tương lai (redo) sẽ bị xóa
    setFuture([]);
  }, []);

  const undo = useCallback((currentNodes, currentEdges) => {
    if (past.length === 0) return null;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    setPast(newPast);
    setFuture((prev) => [cloneState(currentNodes, currentEdges), ...prev]);

    return { nodes: previous.nodes, edges: previous.edges };
  }, [past]);

  const redo = useCallback((currentNodes, currentEdges) => {
    if (future.length === 0) return null;

    const next = future[0];
    const newFuture = future.slice(1);

    setFuture(newFuture);
    setPast((prev) => [...prev, cloneState(currentNodes, currentEdges)]);

    return { nodes: next.nodes, edges: next.edges };
  }, [future]);

  return { takeSnapshot, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
