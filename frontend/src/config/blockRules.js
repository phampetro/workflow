/**
 * Luật tương thích khối — "luật sân chơi".
 *
 * ⚠️ GIỮ ĐỒNG BỘ với backend/services/block_rules.py (BE là nguồn sự thật; file
 * này chỉ để chặn thao tác + hiển thị lý do cho người dùng ở FE).
 *
 * Cách mở rộng: thêm khối mới chỉ cần gắn tag năng lực vào BLOCK_CAPS; luật viết
 * theo TAG nên không phải sửa từng cặp khối.
 */

// Tag năng lực của từng loại khối
export const BLOCK_CAPS = {
  input_vars: { interactive: true },      // chờ người nhập giữa chừng
  telegram_listener: { listener: true },  // chạy nền chờ tin nhắn
}

// Bảng luật ràng buộc theo tag
//  - when: tag điều kiện có mặt trong workflow
//  - forbidTag: nếu đồng thời có tag này → xung khắc (không cho cùng workflow)
//  - disablesFeature: tính năng bị tắt cho workflow đó (vd 'scheduler')
export const WF_RULES = [
  {
    when: 'interactive', forbidTag: 'listener',
    msg: 'Khối "Biến đầu vào" (chờ người nhập) không dùng chung với Telegram Listener trong cùng một workflow.',
  },
  {
    when: 'interactive', disablesFeature: 'scheduler',
    msg: 'Workflow có khối "Biến đầu vào" (chờ người nhập) nên không thể đặt lịch chạy tự động.',
  },
]

// Tập tag đang hiện diện trong danh sách node
function collectTags(nodes) {
  const tags = new Set()
  for (const n of nodes || []) {
    const caps = BLOCK_CAPS[n?.data?.type]
    if (caps) for (const k of Object.keys(caps)) if (caps[k]) tags.add(k)
  }
  return tags
}

// Kiểm 1 workflow → { ok, violations:[{msg}], disabledFeatures:Set<string> }
export function validateWorkflow(nodes) {
  const tags = collectTags(nodes)
  const violations = []
  const disabledFeatures = new Set()
  for (const rule of WF_RULES) {
    if (!tags.has(rule.when)) continue
    if (rule.forbidTag && tags.has(rule.forbidTag)) violations.push({ msg: rule.msg })
    if (rule.disablesFeature) disabledFeatures.add(rule.disablesFeature)
  }
  return { ok: violations.length === 0, violations, disabledFeatures }
}

// Có được phép THÊM khối newType vào graph hiện tại không → { ok, msg }
export function canAddBlock(nodes, newType) {
  const existing = collectTags(nodes)
  const newCaps = BLOCK_CAPS[newType] || {}
  const newTags = Object.keys(newCaps).filter(k => newCaps[k])
  for (const rule of WF_RULES) {
    if (!rule.forbidTag) continue
    const addWhen = newTags.includes(rule.when) && existing.has(rule.forbidTag)
    const addForbid = newTags.includes(rule.forbidTag) && existing.has(rule.when)
    if (addWhen || addForbid) return { ok: false, msg: rule.msg }
  }
  return { ok: true }
}

export function isFeatureDisabled(nodes, feature) {
  return validateWorkflow(nodes).disabledFeatures.has(feature)
}
