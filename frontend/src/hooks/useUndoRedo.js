import { useCallback, useState } from 'react';

const MAX_HISTORY = 50;

export default function useUndoRedo() {
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  // Hàm tạo bản sao chép sâu của nodes và edges
  const cloneState = (nodes, edges) => {
    return {
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges))
    };
  };

  const takeSnapshot = useCallback((nodes, edges) => {
    setPast((prev) => {
      // Nếu trạng thái cuối cùng giống hệt thì bỏ qua (so sánh JSON string)
      if (prev.length > 0) {
        const lastState = prev[prev.length - 1];
        if (JSON.stringify(lastState.nodes) === JSON.stringify(nodes) && JSON.stringify(lastState.edges) === JSON.stringify(edges)) {
          return prev;
        }
      }

      const newPast = [...prev, cloneState(nodes, edges)];
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
    
    return previous; // Trả về để update canvas
  }, [past]);

  const redo = useCallback((currentNodes, currentEdges) => {
    if (future.length === 0) return null;
    
    const next = future[0];
    const newFuture = future.slice(1);
    
    setFuture(newFuture);
    setPast((prev) => [...prev, cloneState(currentNodes, currentEdges)]);
    
    return next; // Trả về để update canvas
  }, [future]);

  return { takeSnapshot, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
