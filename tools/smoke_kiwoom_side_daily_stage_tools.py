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

import backfill_kiwoom_side_daily as backfill_mod  # noqa: E402
import merge_kiwoom_side_daily_stage as merge_mod  # noqa: E402
import qc_kiwoom_side_daily_stage as qc_mod  # noqa: E402
from public_kr_historical_common import iter_jsonl, write_jsonl  # noqa: E402


DATASET_ROWS = {
    "investor_daily": {
        "111111": [
            {"dt": "20240105", "ind_invsr": "10"},
            {"dt": "20240104", "ind_invsr": "9"},
            {"dt": "20240103", "ind_invsr": "8"},
        ],
        "222222": [
            {"dt": "20240105", "ind_invsr": "7"},
            {"dt": "20240104", "ind_invsr": "6"},
        ],
    },
    "program_daily": {
        "111111": [
            {"dt": "20240105", "prm_netprps_amt": "1000"},
            {"dt": "20240104", "prm_netprps_amt": "900"},
            {"dt": "20240103", "prm_netprps_amt": "800"},
        ],
        "222222": [
            {"dt": "20240105", "prm_netprps_amt": "700"},
            {"dt": "20240104", "prm_netprps_amt": "600"},
        ],
    },
    "trade_strength_daily": {
        "111111": [
            {"dt": "20240105", "cntr_str": "111.1"},
            {"dt": "20240104", "cntr_str": "109.4"},
            {"dt": "20240103", "cntr_str": "107.7"},
        ],
        "222222": [
            {"dt": "20240105", "cntr_str": "106.1"},
            {"dt": "20240104", "cntr_str": "105.4"},
        ],
    },
}


class FakeKiwoomRestClient:
    def __init__(self, **kwargs):
        pass

    def _page(self, dataset, symbol, next_key):
        rows = list(DATASET_ROWS[dataset][symbol])
        if str(next_key or "").strip() == "page-2":
            return {"rows": rows[2:], "contYn": "", "nextKey": ""}
        return {
            "rows": rows[:2],
            "contYn": "Y" if len(rows) > 2 else "",
            "nextKey": "page-2" if len(rows) > 2 else "",
        }

    def fetch_investor_daily(self, *, symbol, next_key=None, **kwargs):
        return self._page("investor_daily", symbol, next_key)

    def fetch_program_daily(self, *, symbol, next_key=None, **kwargs):
        return self._page("program_daily", symbol, next_key)

    def fetch_trade_strength_daily(self, *, symbol, next_key=None, **kwargs):
        return self._page("trade_strength_daily", symbol, next_key)


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


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main():
    original_parse_args = backfill_mod.parse_args
    original_client = backfill_mod.KiwoomRestClient
    try:
        with TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            manifest_path = root / "manifest.jsonl"
            data_dir = root / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            write_jsonl(manifest_path, build_manifest_rows())
            backfill_mod.KiwoomRestClient = FakeKiwoomRestClient
            for dataset in ("investor_daily", "program_daily", "trade_strength_daily"):
                stage_root = root / f"stage-{dataset}"
                summary_out = stage_root / "summary.json"
                backfill_mod.parse_args = lambda dataset=dataset, stage_root=stage_root, summary_out=summary_out: SimpleNamespace(
                    dataset=dataset,
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
                )
                backfill_mod.main()
                original_qc_parse_args = qc_mod.parse_args
                qc_mod.parse_args = lambda: SimpleNamespace(stage_root=str(stage_root))
                try:
                    qc_mod.main()
                finally:
                    qc_mod.parse_args = original_qc_parse_args
                original_merge_parse_args = merge_mod.parse_args
                merge_mod.parse_args = lambda dataset=dataset, stage_root=stage_root: SimpleNamespace(
                    stage_root=[str(stage_root)],
                    dataset=dataset,
                    data_dir=str(data_dir),
                    backup_root=str(root / "backups"),
                    lock_path=str(root / f"{dataset}.lock"),
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
                canonical_path = data_dir / "intraday_side" / f"{dataset}.jsonl"
                canonical_rows = list(iter_jsonl(canonical_path))
                if len(canonical_rows) != 5:
                    raise AssertionError((dataset, canonical_rows))
                if canonical_rows[0]["dateKey"] != "2024-01-03":
                    raise AssertionError((dataset, canonical_rows[0]))
                if canonical_rows[-1]["symbol"] != "222222":
                    raise AssertionError((dataset, canonical_rows[-1]))
            run_script = (ROOT / "tools" / "run_kiwoom_side_daily_backfill.sh").read_text(encoding="utf-8")
            env_loader = (ROOT / "tools" / "load_kiwoom_rest_env.sh").read_text(encoding="utf-8")
            if 'source tools/load_kiwoom_rest_env.sh' not in run_script:
                raise AssertionError("run_kiwoom_side_daily_backfill.sh must source load_kiwoom_rest_env.sh")
            if 'KIWOOM_APP_KEY' not in env_loader or 'KIWOOM_SECRET_KEY' not in env_loader:
                raise AssertionError("load_kiwoom_rest_env.sh must enforce both Kiwoom REST secrets")
    finally:
        backfill_mod.parse_args = original_parse_args
        backfill_mod.KiwoomRestClient = original_client

    print("ok smoke_kiwoom_side_daily_stage_tools")


if __name__ == "__main__":
    main()
