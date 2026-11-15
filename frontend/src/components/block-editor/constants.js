// Hằng số + quy tắc dùng chung cho form cấu hình khối (BlockEditorModal và các form con).

export const DEFAULT_PYTHON_CODE = `# Block: Python Script
# Biến 'input_data' chứa output từ block trước
# Gán kết quả vào biến 'output_data'

import json

# === Code của bạn ===
output_data = input_data
print("Block hoàn thành!")
`

export const DEFAULT_SQL_QUERY = `-- Nhập câu lệnh SQL của bạn tại đây
-- Kết quả trả về: {"file_name": "tên file Excel đã xuất"}
SELECT * FROM my_table;
`

// Tên biến phải khớp cú pháp {{ten_bien}} của backend (regex \w+) và dùng được
// làm key trong code Python (input_data['ten_bien']) → không cho khoảng trắng,
// dấu câu, chữ có dấu, và không bắt đầu bằng số.
export const VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
export const getVarNameRule = (t) => ({
  validator: (_, value) => {
    if (!value) return Promise.resolve()
    if (VAR_NAME_PATTERN.test(String(value))) return Promise.resolve()
    return Promise.reject(new Error(t('blockEditor.varNameInvalid')))
  },
})

// Câu giải thích dùng chung cho mọi ô đặt tên biến output
export const getVarNameHint = (t) =>
  `${t('blockEditor.varNameHintPrefix')} {{ten_bien}} ${t('blockEditor.varNameHintMiddle')} input_data['ten_bien'] ${t('blockEditor.varNameHintSuffix')}`
