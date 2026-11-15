// PostToolUse hook (Edit/Write): sửa file locale xong là kiểm JSON ngay.
// Dấu ngoặc kép cong (" ") gõ nhầm vào vị trí key làm hỏng ÂM THẦM cả file, kéo
// theo lỗi Vite HMR ở file khác không liên quan — rất khó truy ngược (CLAUDE.md).
// Exit 2 + stderr → Claude Code chặn lại và đưa lỗi cho Claude sửa.
const fs = require('fs')
let input = ''
process.stdin.on('data', (c) => { input += c })
process.stdin.on('end', () => {
  let file
  try { file = JSON.parse(input)?.tool_input?.file_path } catch { process.exit(0) }
  if (!file || !/[\/]i18n[\/]locales[\/][^\/]+\.json$/.test(file)) process.exit(0)
  try {
    JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    process.stderr.write(`File locale không còn là JSON hợp lệ: ${file}\n${e.message}\n`)
    process.exit(2)
  }
})
