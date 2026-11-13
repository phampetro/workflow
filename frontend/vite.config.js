import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

// Lấy thời điểm commit git gần nhất của repo (không riêng thư mục frontend) làm
// "Cập nhật" hiển thị ở modal Thông tin - tự động phản ánh lần sửa code gần nhất,
// không cần vào appInfo.js sửa tay mỗi lần đổi code. Chỉ đọc lại giá trị này khi
// dev server khởi động lại / khi build lại (không sống trong lúc dev server đang chạy).
function getLastUpdatedAt() {
  try {
    // -c safe.directory: thư mục repo thuộc user Windows cũ (SID khác) thì git chặn
    // mọi lệnh ("dubious ownership") → ngày cập nhật thành Unknown. Cùng cách với
    // backend/routers/system.py và tools/build_release.py; không sửa git config global.
    const repoRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
    const iso = execSync(`git -c "safe.directory=${repoRoot}" log -1 --format=%cI`, { cwd: process.cwd() }).toString().trim()
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
  server: {
    // Đổi khỏi 5173 mặc định vì port đó dùng chung với mọi dự án Vite khác trên máy
    // - dễ đụng khi mở nhiều dự án cùng lúc. 9000 ít va chạm hơn nhiều.
    port: 9000,
    strictPort: true,
  },
  define: {
    __APP_UPDATED_AT__: JSON.stringify(getLastUpdatedAt()),
  },
})
