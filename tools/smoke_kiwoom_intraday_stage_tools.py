#!/usr/bin/env python3

import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import backfill_kiwoom_intraday_1m as backfill_mod  # noqa: E402
import merge_kiwoom_intraday_stage as merge_mod  # noqa: E402
import qc_kiwoom_intraday_1m_stage as qc_mod  # noqa: E402
from public_kr_historical_common import iter_jsonl, write_jsonl  # noqa: E402


DATASET_ROWS = {
    "111111": [
        {"cntr_tm": "20240105153500", "open_pric": "+111", "high_pric": "+111", "low_pric": "+111", "cur_prc": "+111", "trde_qty": "5"},
        {"cntr_tm": "20240105090100", "open_pric": "-110", "high_pric": "-112", "low_pric": "-109", "cur_prc": "-111", "trde_qty": "10"},
        {"cntr_tm": "20240105090000", "open_pric": "-100", "high_pric": "-111", "low_pric": "-99", "cur_prc": "-110", "trde_qty": "20"},
        {"cntr_tm": "20240104090100", "open_pric": "-109", "high_pric": "-111", "low_pric": "-108", "cur_prc": "-110", "trde_qty": "10"},
        {"cntr_tm": "20240104090000", "open_pric": "-100", "high_pric": "-109", "low_pric": "-98", "cur_prc": "-109", "trde_qty": "20"},
        {"cntr_tm": "20240103090100", "open_pric": "-108", "high_pric": "-110", "low_pric": "-107", "cur_prc": "-109", "trde_qty": "10"},
        {"cntr_tm": "20240103090000", "open_pric": "-100", "high_pric": "-108", "low_pric": "-97", "cur_prc": "-108", "trde_qty": "20"},
    ],
    "222222": [
        {"cur_prc": "", "trde_qty": "", "cntr_tm": "", "open_pric": "", "high_pric": "", "low_pric": ""},
        {"cntr_tm": "20240105090100", "open_pric": "-210", "high_pric": "-212", "low_pric": "-209", "cur_prc": "-211", "trde_qty": "10"},
        {"cntr_tm": "20240105090000", "open_pric": "-200", "high_pric": "-211", "low_pric": "-199", "cur_prc": "-210", "trde_qty": "20"},
        {"cntr_tm": "20240104090100", "open_pric": "-209", "high_pric": "-211", "low_pric": "-208", "cur_prc": "-210", "trde_qty": "10"},
        {"cntr_tm": "20240104090000", "open_pric": "-200", "high_pric": "-209", "low_pric": "-198", "cur_prc": "-209", "trde_qty": "20"},
    ],
}


class FakeKiwoomRestClient:
    def __init__(self, **kwargs):
        self._rate_limit_hit_count = 0

    def fetch_minute_chart(self, *, symbol, next_key=None, **kwargs):
        rows = list(DATASET_ROWS[symbol])
        if str(next_key or "").strip() == "page-2":
            return {"rows": rows[4:], "contYn": "", "nextKey": ""}
        return {
            "rows": rows[:4],
            "contYn": "Y" if len(rows) > 4 else "",
            "nextKey": "page-2" if len(rows) > 4 else "",
        }

    def get_rate_limit_hit_count(self, *, reset=False):
        count = self._rate_limit_hit_count
        if reset:
            self._rate_limit_hit_count = 0
        return count


def build_manifest_rows():
    return [
        {
            "requestId": "2024-01-04::111111::same_day_high8",
            "symbol": "111111",
            "decisionDateKey": "2024-01-04",
            "windowDateKeys": ["2024-01-03", "2024-01-04", "2024-01-05"],
        },
        {
            "requestId": "2024-01-04::222222::same_day_high8",
            "symbol": "222222",
            "decisionDateKey": "2024-01-04",
            "windowDateKeys": ["2024-01-04", "2024-01-05"],
        },
    ]


def build_daily_rows():
    return [
        {"symbol": "111111", "dateKey": "2024-01-03", "open": 100, "high": 110, "low": 97, "close": 109, "volume": 30},
        {"symbol": "111111", "dateKey": "2024-01-04", "open": 100, "high": 111, "low": 98, "close": 110, "volume": 30},
        {"symbol": "111111", "dateKey": "2024-01-05", "open": 100, "high": 112, "low": 99, "close": 111, "volume": 30},
        {"symbol": "222222", "dateKey": "2024-01-04", "open": 200, "high": 211, "low": 198, "close": 210, "volume": 30},
        {"symbol": "222222", "dateKey": "2024-01-05", "open": 200, "high": 212, "low": 199, "close": 211, "volume": 30},
    ]


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    original_parse_args = backfill_mod.parse_args
    original_client = backfill_mod.KiwoomRestClient
    try:
        with TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            manifest_path = root / "manifest.jsonl"
            candle_path = root / "candle_daily.jsonl"
            data_dir = root / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            write_jsonl(manifest_path, build_manifest_rows())
            write_jsonl(candle_path, build_daily_rows())
            backfill_mod.KiwoomRestClient = FakeKiwoomRestClient
            stage_root = root / "stage-minute"
            summary_out = stage_root / "summary.json"
            backfill_mod.parse_args = lambda: SimpleNamespace(
                manifest_path=str(manifest_path),
                stage_root=str(stage_root),
                summary_out=str(summary_out),
                decision_from="",
                decision_to="",
                symbol_shard_index=None,
                symbol_shard_count=None,
                overwrite_stage=False,
                run_id="smoke",
                worker_id="smoke",
                max_workers=1,
                max_pages_per_symbol=8,
                trace_root="",
                base_url="https://api.kiwoom.com",
                retries=1,
                sleep_ms=1,
                min_interval_ms=0,
                cooldown_429_ms=0,
                crawl_anchor_date="2024-01-05",
                candle_path=str(candle_path),
            )
            backfill_mod.main()
            original_qc_parse_args = qc_mod.parse_args
            qc_mod.parse_args = lambda: SimpleNamespace(stage_root=str(stage_root), candle_path=str(candle_path))
            try:
                qc_mod.main()
            finally:
                qc_mod.parse_args = original_qc_parse_args
            original_merge_parse_args = merge_mod.parse_args
            merge_mod.parse_args = lambda: SimpleNamespace(
                stage_root=[str(stage_root)],
                data_dir=str(data_dir),
                backup_root=str(root / "backups"),
                lock_path=str(root / "merge.lock"),
                merge_journal=str(root / "merge_journal.jsonl"),
            )
            try:
                merge_mod.main()
            finally:
                merge_mod.parse_args = original_merge_parse_args
            summary = read_json(summary_out)
            qc_summary = read_json(stage_root / "qc_summary.json")
            if summary.get("status") != "completed":
                raise AssertionError(summary)
            if qc_summary.get("status") != "passed":
                raise AssertionError(qc_summary)
            symbol_results = list(iter_jsonl(stage_root / "symbol_results.jsonl"))
            result_map = {row["symbol"]: row for row in symbol_results}
            if int(result_map["111111"]["outOfSessionRowCount"]) != 1:
                raise AssertionError(symbol_results)
            if int(result_map["222222"]["placeholderRowCount"]) != 1:
                raise AssertionError(symbol_results)
            if int(qc_summary.get("sessionBoundsViolationCount") or 0) != 0:
                raise AssertionError(qc_summary)
            presence_rows = list(iter_jsonl(data_dir / "intraday_1m_presence_daily.jsonl"))
            if len(presence_rows) != 5:
                raise AssertionError(presence_rows)
            date_rows = list(iter_jsonl(data_dir / "intraday_1m" / "date=2024-01-05" / "part-000.jsonl"))
            if len(date_rows) != 4:
                raise AssertionError(date_rows)
            if date_rows[0]["tsKst"] != "2024-01-05T09:00:00+09:00":
                raise AssertionError(date_rows)
            if date_rows[1]["tsKst"] != "2024-01-05T09:01:00+09:00":
                raise AssertionError(date_rows)
            by_symbol_ts = {
                (row["symbol"], row["tsKst"]): row
                for row in date_rows
            }
            if by_symbol_ts[("111111", "2024-01-05T09:00:00+09:00")]["open"] != 100:
                raise AssertionError(date_rows)
            if by_symbol_ts[("111111", "2024-01-05T09:00:00+09:00")]["close"] != 110:
                raise AssertionError(date_rows)
            if by_symbol_ts[("222222", "2024-01-05T09:00:00+09:00")]["open"] != 200:
                raise AssertionError(date_rows)
            if by_symbol_ts[("222222", "2024-01-05T09:00:00+09:00")]["close"] != 210:
                raise AssertionError(date_rows)
            if not any(
                row["symbol"] == "111111"
                and row["tradingDateKey"] == "2024-01-05"
                and row["firstTsKst"] == "2024-01-05T09:00:00+09:00"
                and row["lastTsKst"] == "2024-01-05T09:01:00+09:00"
                for row in presence_rows
            ):
                raise AssertionError(presence_rows)
            if date_rows[0]["tsKst"] >= date_rows[1]["tsKst"] and date_rows[0]["symbol"] == date_rows[1]["symbol"]:
                raise AssertionError(date_rows)
            run_script = (ROOT / "tools" / "run_kiwoom_intraday_1m_backfill.sh").read_text(encoding="utf-8")
            env_loader = (ROOT / "tools" / "load_kiwoom_rest_env.sh").read_text(encoding="utf-8")
            if 'source tools/load_kiwoom_rest_env.sh' not in run_script:
                raise AssertionError("run_kiwoom_intraday_1m_backfill.sh must source load_kiwoom_rest_env.sh")
            if 'KIWOOM_APP_KEY' not in env_loader or 'KIWOOM_SECRET_KEY' not in env_loader:
                raise AssertionError("load_kiwoom_rest_env.sh must enforce both Kiwoom REST secrets")
    finally:
        backfill_mod.parse_args = original_parse_args
        backfill_mod.KiwoomRestClient = original_client

    print("ok smoke_kiwoom_intraday_stage_tools")


if __name__ == "__main__":
    main()
