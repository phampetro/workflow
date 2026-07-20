import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'

// Lấy thời điểm commit git gần nhất của repo (không riêng thư mục frontend) làm
// "Cập nhật" hiển thị ở modal Thông tin - tự động phản ánh lần sửa code gần nhất,
// không cần vào appInfo.js sửa tay mỗi lần đổi code. Chỉ đọc lại giá trị này khi
// dev server khởi động lại / khi build lại (không sống trong lúc dev server đang chạy).
function getLastUpdatedAt() {
  try {
    const iso = execSync('git log -1 --format=%cI', { cwd: process.cwd() }).toString().trim()
    const d = new Date(iso)
    const pad = (n) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch {
    return null
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    __APP_UPDATED_AT__: JSON.stringify(getLastUpdatedAt()),
  },
})
