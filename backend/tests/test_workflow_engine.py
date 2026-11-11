"""Khoá hành vi vòng lặp workflow (execute_workflow_thread) — chạy thật, không mock vòng lặp.

Mỗi test ứng với một quy tắc đã từng là bug thật (xem comment trong executor_blocks
và block_handlers). Đổi hành vi nào ở đây là đổi kết quả workflow đang chạy của khách.
"""
import threading
import time

from conftest import graph
from services import executor_blocks as eb


def test_linear_success(engine):
    engine.python_behaviors["py"] = lambda inp, env: (True, {"x": 1}, None)
    status, err = engine.run(graph(
        [("s", "start", {}), ("py", "python", {"code": "x"}), ("e", "end", {})],
        [("s", "py"), ("py", "e")],
    ))
    assert status == "success" and err is None
    assert len(engine.called("py")) == 1
    assert any(ev == "workflow_done" for *_, ev in engine.logs)


def test_end_block_stops_flow(engine):
    status, _ = engine.run(graph(
        [("s", "start", {}), ("e", "end", {}), ("py", "python", {"code": "x"})],
        [("s", "e"), ("e", "py")],
    ))
    assert status == "success"
    assert engine.called("py") == []


def test_python_without_code_does_not_propagate(engine):
    status, _ = engine.run(graph(
        [("s", "start", {}), ("empty", "python", {"code": "  "}), ("py", "python", {"code": "x"})],
        [("s", "empty"), ("empty", "py")],
    ))
    assert status == "success"
    assert engine.called("py") == []


def test_condition_branches_on_current_input(engine):
    engine.python_behaviors["src"] = lambda inp, env: (True, {"n": "5"}, None)
    cond = {"logicalOperator": "AND",
            "conditions": [{"condVariable": "n", "condOperator": ">", "condValue": "3"}]}
    status, _ = engine.run(graph(
        [("s", "start", {}), ("src", "python", {"code": "x"}), ("c", "condition", cond),
         ("yes", "python", {"code": "x"}), ("no", "python", {"code": "x"})],
        [("s", "src"), ("src", "c"), ("c", "yes", "true"), ("c", "no", "false")],
    ))
    assert status == "success"
    assert len(engine.called("yes")) == 1
    assert engine.called("no") == []


def test_condition_without_conditions_stops_branch(engine):
    status, _ = engine.run(graph(
        [("s", "start", {}), ("c", "condition", {"conditions": []}),
         ("yes", "python", {"code": "x"})],
        [("s", "c"), ("c", "yes", "true")],
    ))
    assert status == "success"
    assert engine.called("yes") == []


def test_loop_count_runs_body_exact_times(engine):
    status, _ = engine.run(graph(
        [("s", "start", {}), ("body", "python", {"code": "x"}),
         ("l", "loop", {"loopMode": "count", "loopCount": 3}), ("done", "python", {"code": "x"})],
        [("s", "body"), ("body", "l"), ("l", "body", "loop"), ("l", "done", "endloop")],
    ))
    assert status == "success"
    assert len(engine.called("body")) == 3
    assert len(engine.called("done")) == 1
    assert engine.called("done")[0][1]["loop_iteration"] == 3


def test_excel_read_then_loop_array_with_custom_item_names(engine):
    (engine.input_dir / "data.csv").write_text("Ma KH ,Ten\nK1,An\nK2,Binh\n", encoding="utf-8")
    engine.write_input_json({"fname": "data.csv"})
    status, _ = engine.run(graph(
        [("s", "start", {}),
         ("read", "excel_read", {"excelReadFile": "{{fname}}", "outputVarName": "rows",
                                 "rowCountVarName": "so_dong",
                                 "columnMappings": {"Ma KH": "ma_kh"}}),
         ("l", "loop", {"loopMode": "array", "loopArrayVar": "{{rows}}"}),
         ("body", "python", {"code": "x"}),
         ("done", "python", {"code": "x"})],
        [("s", "read"), ("read", "l"), ("l", "body", "loop"), ("body", "l"),
         ("l", "done", "endloop")],
    ))
    assert status == "success"
    body = engine.called("body")
    assert [c[1]["ma_kh"] for c in body] == ["K1", "K2"]
    assert [c[1]["Ten"] for c in body] == ["An", "Binh"]
    # biến vào workflow_env đúng TÊN đặt trên UI
    assert body[0][2]["so_dong"] == 2
    assert body[0][2]["ma_kh"] == "K1"


def test_loop_condition_mode_respects_max_retries(engine):
    status, _ = engine.run(graph(
        [("s", "start", {}), ("body", "python", {"code": "x"}),
         ("l", "loop", {"loopMode": "condition", "loopMaxCount": 2, "conditions": [
             {"condVariable": "never", "condOperator": "==", "condValue": "yes"}]}),
         ("ok", "python", {"code": "x"}), ("give_up", "python", {"code": "x"})],
        [("s", "body"), ("body", "l"), ("l", "body", "loop"), ("l", "ok", "true"),
         ("l", "give_up", "endloop")],
    ))
    assert status == "success"
    assert len(engine.called("body")) == 3   # lần đầu + 2 lần quay lại
    assert engine.called("ok") == []
    assert len(engine.called("give_up")) == 1


def test_interpolation_is_single_pass(engine):
    """Giá trị chứa {{secret}} KHÔNG được nội suy tiếp (chống rò mật khẩu input.json)."""
    engine.write_input_json({"secret": "S3CRET", "a": "{{secret}}"})
    status, err = engine.run(graph(
        [("s", "start", {}), ("read", "excel_read", {"excelReadFile": "{{a}}"})],
        [("s", "read")],
    ))
    assert status == "error"
    assert "{{secret}}" in err
    assert "S3CRET" not in engine.log_text()


def test_input_json_with_comments_and_trailing_commas(engine):
    (engine.input_dir / "input.json").write_text(
        '{\n // ghi chú\n "url": "http://x//y", /* khối */ "n": 1,\n}', encoding="utf-8")
    engine.run(graph([("s", "start", {}), ("py", "python", {"code": "x"})], [("s", "py")]))
    env = engine.called("py")[0][2]
    assert env["url"] == "http://x//y" and env["n"] == 1


def test_error_trigger_receives_payload_and_run_is_error(engine):
    status, err = engine.run(graph(
        [("s", "start", {}), ("tg", "telegram", {"telegramBotToken": "", "telegramChatId": ""}),
         ("after", "python", {"code": "x"}),
         ("et", "error_trigger", {}), ("handler", "python", {"code": "x"})],
        [("s", "tg"), ("tg", "after"), ("et", "handler")],
    ))
    assert status == "error"
    assert "Bot Token" in err
    assert engine.called("after") == []
    payload = engine.called("handler")[0][1]
    assert payload["status"] == "error"
    assert payload["failed_block"] == "tg"
    assert payload["failed_block_id"] == "tg"


def test_python_failure_without_error_trigger(engine):
    engine.python_behaviors["py"] = lambda inp, env: (False, None, "boom")
    status, err = engine.run(graph(
        [("s", "start", {}), ("py", "python", {"code": "x"}), ("next", "python", {"code": "x"})],
        [("s", "py"), ("py", "next")],
    ))
    assert status == "error" and err == "boom"
    assert engine.called("next") == []


def test_python_stopped_is_not_error(engine):
    engine.python_behaviors["py"] = lambda inp, env: (False, None, "stopped")
    status, _ = engine.run(graph(
        [("s", "start", {}), ("py", "python", {"code": "x"}),
         ("et", "error_trigger", {}), ("handler", "python", {"code": "x"})],
        [("s", "py"), ("et", "handler")],
    ))
    assert status == "stopped"
    assert engine.called("handler") == []


def test_unsupported_block_warns_and_continues(engine):
    status, _ = engine.run(graph(
        [("s", "start", {}), ("old", "database", {}), ("py", "python", {"code": "x"})],
        [("s", "old"), ("old", "py")],
    ))
    assert status == "success"
    assert len(engine.called("py")) == 1
    assert any(lv == "warning" and bid == "old" for bid, lv, _, _ in engine.logs)


def test_queue_waits_for_parallel_branches_and_runs_once(engine):
    status, _ = engine.run(graph(
        [("s", "start", {}), ("a", "python", {"code": "x"}), ("b", "python", {"code": "x"}),
         ("a2", "python", {"code": "x"}), ("q", "queue", {}), ("last", "python", {"code": "x"})],
        [("s", "a"), ("s", "b"), ("a", "a2"), ("a2", "q"), ("b", "q"), ("q", "last")],
    ))
    assert status == "success"
    order = [c[0] for c in engine.python_calls]
    # Đã có 2 lượt vào queue (từ a2 và b) → "last" chạy 2 lần nhưng đều SAU các nhánh.
    assert order.index("last") > order.index("a2")
    assert order.index("last") > order.index("b")


def test_no_start_block_is_error(engine):
    status, err = engine.run(graph([("py", "python", {"code": "x"})], []))
    assert status == "error" and err == "Missing Start block"


def test_input_vars_waits_for_user_values(engine):
    def submitter(run_id, stop_event):
        def _go():
            for _ in range(100):
                if eb.get_pending_input(run_id):
                    eb.submit_input(run_id, {"ten": "Lan"})
                    return
                time.sleep(0.05)
        threading.Thread(target=_go, daemon=True).start()

    status, _ = engine.run(graph(
        [("s", "start", {}),
         ("iv", "input_vars", {"inputTimeout": 10, "inputFields": [{"name": "ten"}]}),
         ("py", "python", {"code": "x"})],
        [("s", "iv"), ("iv", "py")],
    ), before_start=submitter)
    assert status == "success"
    call = engine.called("py")[0]
    assert call[1]["ten"] == "Lan" and call[2]["ten"] == "Lan"


def test_stop_during_delay(engine):
    def stopper(run_id, stop_event):
        threading.Timer(0.8, stop_event.set).start()

    status, _ = engine.run(graph(
        [("s", "start", {}), ("d", "delay", {"delaySeconds": 5}), ("py", "python", {"code": "x"})],
        [("s", "d"), ("d", "py")],
    ), before_start=stopper)
    assert status == "stopped"
    assert engine.called("py") == []


def test_excel_to_sql_renames_output_vars(engine):
    conn = engine.add_db_connection()
    engine.python_behaviors["imp"] = lambda inp, env: (True, {"rows_inserted": 5, "table": "dbo.t"}, None)
    status, _ = engine.run(graph(
        [("s", "start", {}),
         ("imp", "excel_to_sql", {"excelToSqlInputFile": "a.xlsx", "excelToSqlTableName": "dbo.t",
                                  "excelToSqlSavedConnectionId": conn,
                                  "excelToSqlRowsVarName": "so_dong"}),
         ("py", "python", {"code": "x"})],
        [("s", "imp"), ("imp", "py")],
    ))
    assert status == "success"
    inp = engine.called("py")[0][1]
    assert inp["so_dong"] == 5 and "rows_inserted" not in inp
    assert inp["table"] == "dbo.t"
    # script sinh ra nhúng tên bảng qua !r
    assert "table_name = 'dbo.t'" in engine.called("imp")[0][3]


def test_excel_to_sql_rejects_injected_table_name(engine):
    conn = engine.add_db_connection()
    engine.write_input_json({"tbl": "x]; DROP TABLE don_hang; --"})
    status, err = engine.run(graph(
        [("s", "start", {}),
         ("imp", "excel_to_sql", {"excelToSqlInputFile": "a.xlsx", "excelToSqlTableName": "{{tbl}}",
                                  "excelToSqlSavedConnectionId": conn})],
        [("s", "imp")],
    ))
    assert status == "error" and "không hợp lệ" in err
    assert engine.called("imp") == []


def test_sql_to_excel_embeds_query_safely(engine):
    conn = engine.add_db_connection()
    engine.write_input_json({"q": 'x"""; import os; z="""'})
    engine.python_behaviors["sq"] = lambda inp, env: (True, {"file_name": "out.xlsx"}, None)
    status, _ = engine.run(graph(
        [("s", "start", {}),
         ("sq", "sql_to_excel", {"sqlQuery": "SELECT '{{q}}'", "sqlToExcelSavedConnectionId": conn,
                                 "excelFileName": "../../pyflow.db", "outputVarName": "f"}),
         ("py", "python", {"code": "x"})],
        [("s", "sq"), ("sq", "py")],
    ))
    assert status == "success"
    code = engine.called("sq")[0][3]
    expected = "SELECT 'x\"\"\"; import os; z=\"\"\"'"
    assert f"sql_query = {expected!r}" in code       # nhúng qua !r, không thoát chuỗi được
    assert "out_file = 'pyflow.db'" in code          # safe_filename bỏ ../
    assert engine.called("py")[0][1]["f"] == "out.xlsx"


def test_run_sql_exec_timeout_is_passed(engine, monkeypatch):
    conn = engine.add_db_connection()
    seen = {}
    orig = engine._fake_python

    def spy(*a, **kw):
        seen["timeout"] = kw.get("timeout")
        return orig(*a, **kw)
    monkeypatch.setattr(eb, "run_python_block_sync", spy)
    engine.python_behaviors["ex"] = lambda inp, env: (True, {"result": [], "row_count": 0}, None)
    status, _ = engine.run(graph(
        [("s", "start", {}),
         ("ex", "run_sql_exec", {"sqlCommand": "EXEC p", "sqlExecSavedConnectionId": conn,
                                 "sqlExecTimeout": "0"})],
        [("s", "ex")],
    ))
    assert status == "success" and seen["timeout"] == 0


def test_delete_files_keeps_input_json(engine):
    engine.write_input_json({"a": 1})
    (engine.input_dir / "x.csv").write_text("1")
    out = engine.wf_dir / "output"
    out.mkdir()
    (out / "r.xlsx").write_text("1")
    status, _ = engine.run(graph(
        [("s", "start", {}), ("d", "delete_files", {"delete_input": True, "delete_output": True})],
        [("s", "d")],
    ))
    assert status == "success"
    assert (engine.input_dir / "input.json").exists()
    assert not (engine.input_dir / "x.csv").exists()
    assert not (out / "r.xlsx").exists()


def test_infinite_loop_guard(engine):
    status, err = engine.run(graph(
        [("s", "start", {}), ("a", "python", {"code": "x"})],
        [("s", "a"), ("a", "a")],
    ))
    assert status == "error" and "lặp vô hạn" in err
