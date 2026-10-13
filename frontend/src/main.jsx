// Overlay báo lỗi JS — CHỈ chạy ở chế độ phát triển.
// Bản cũ luôn bật và phủ kín 100vw×100vh không có nút đóng, nên bất kỳ lỗi
// không nghiêm trọng nào (ResizeObserver loop, lỗi async của Monaco, lỗi do
// extension của người dùng) cũng che sạch app và phải F5 mới dùng tiếp được —
// mỗi lỗi lại chồng thêm một lớp div nữa. Ngoài ra `innerHTML` với thông điệp
// chưa escape là đường chèn HTML thẳng vào DOM.
if (import.meta.env.DEV) {
  window.onerror = function (msg, url, lineNo, columnNo, error) {
    // "ResizeObserver loop completed with undelivered notifications" (và bản cũ
    // "...loop limit exceeded") là cảnh báo LÀNH TÍNH của trình duyệt: ResizeObserver chưa
    // giao hết thông báo trong một khung hình. React Flow bắn ra mỗi khi kéo giãn khối
    // Ghi chú (NodeResizer đổi kích thước → bộ đo node chạy lại ngay trong khung đó).
    // Không có lỗi thật nào đứng sau, nên bỏ qua thay vì hiện overlay đỏ.
    if (typeof msg === 'string' && msg.startsWith('ResizeObserver loop')) return true

    const box = document.createElement('div')
    box.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'max-width:min(560px,92vw)',
      'max-height:50vh', 'overflow:auto', 'z-index:99999', 'padding:12px 14px',
      'border-radius:8px', 'background:#7f1d1d', 'color:#fff',
      'font:12px/1.5 ui-monospace,monospace', 'white-space:pre-wrap',
      'box-shadow:0 8px 24px rgba(0,0,0,.4)',
    ].join(';')

    const close = document.createElement('button')
    close.textContent = 'Đóng'
    close.setAttribute('aria-label', 'Đóng thông báo lỗi')
    close.style.cssText = 'float:right;margin-left:8px;cursor:pointer;background:#fff;color:#7f1d1d;border:0;border-radius:4px;padding:2px 8px;font-weight:600'
    close.onclick = () => box.remove()

    const title = document.createElement('strong')
    title.textContent = 'Lỗi JavaScript (chỉ hiện ở bản dev)'

    const body = document.createElement('pre')
    body.style.cssText = 'margin:8px 0 0;white-space:pre-wrap'
    // textContent: không diễn giải HTML trong thông điệp lỗi
    body.textContent = `${msg}\n${(error && error.stack) || ''}`

    box.append(close, title, body)
    document.body.appendChild(box)
    return false
  }
}

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
