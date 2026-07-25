"""
Luật tương thích khối — "luật sân chơi" (nguồn sự thật phía backend).

⚠️ GIỮ ĐỒNG BỘ với frontend/src/config/blockRules.js.

Mở rộng: khối mới chỉ cần gắn tag vào BLOCK_CAPS; luật viết theo TAG.
"""
import json

# Tag năng lực của từng loại khối
BLOCK_CAPS = {
    "input_vars": {"interactive": True},       # chờ người nhập giữa chừng
    "telegram_listener": {"listener": True},   # chạy nền chờ tin nhắn
}

# Bảng luật (xem giải thích ở file FE)
WF_RULES = [
    {"when": "interactive", "forbid_tag": "listener",
     "msg": 'Khối "Biến đầu vào" (chờ người nhập) không dùng chung với Telegram Listener trong cùng một workflow.'},
    {"when": "interactive", "disables_feature": "scheduler",
     "msg": 'Workflow có khối "Biến đầu vào" (chờ người nhập) nên không thể đặt lịch chạy tự động.'},
]


def _nodes_from_graph(graph_json):
    if not graph_json:
        return []
    try:
        g = json.loads(graph_json) if isinstance(graph_json, str) else graph_json
        return g.get("nodes", []) or []
    except Exception:
        return []


def _collect_tags(nodes):
    tags = set()
    for n in nodes or []:
        btype = (n.get("data") or {}).get("type")
        caps = BLOCK_CAPS.get(btype)
        if caps:
            for k, v in caps.items():
                if v:
                    tags.add(k)
    return tags


def validate_workflow(graph_json):
    """Trả {"ok": bool, "violations": [msg...], "disabled_features": set()}."""
    tags = _collect_tags(_nodes_from_graph(graph_json))
    violations, disabled = [], set()
    for r in WF_RULES:
        if r["when"] not in tags:
            continue
        if r.get("forbid_tag") and r["forbid_tag"] in tags:
            violations.append(r["msg"])
        if r.get("disables_feature"):
            disabled.add(r["disables_feature"])
    return {"ok": len(violations) == 0, "violations": violations, "disabled_features": disabled}


def is_feature_disabled(graph_json, feature):
    return feature in validate_workflow(graph_json)["disabled_features"]
