#!/usr/bin/env python3

import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from public_kr_historical_common import write_jsonl  # noqa: E402


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    with TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        data_dir = root / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        candle_rows = []
        universe_rows = []
        for date_key in ["2023-07-10", "2023-07-11", "2023-07-12"]:
            for symbol in ["000001", "000002"]:
                candle_rows.append(
                    {"symbol": symbol, "dateKey": date_key, "open": 10, "high": 11, "low": 9, "close": 10, "volume": 1000}
                )
                universe_rows.append(
                    {"symbol": symbol, "tradingDateKey": date_key, "avgTradingValue20d": 10000, "marketCapKrw": 100000}
                )
        write_jsonl(data_dir / "candle_daily.jsonl", candle_rows)
        write_jsonl(data_dir / "universe_daily.jsonl", universe_rows)
        write_jsonl(data_dir / "nontrading_symbol_daily.jsonl", [])
        write_jsonl(
            data_dir / "historical_symbol_lifecycle.jsonl",
            [
                {
                    "symbol": "000001",
                    "name": "A",
                    "marketCode": "STK",
                    "type": "COMMON",
                    "listedFrom": "2020-01-01",
                    "delistedOn": None,
                    "source": "fixture",
                },
                {
                    "symbol": "000002",
                    "name": "B",
                    "marketCode": "KSQ",
                    "type": "COMMON",
                    "listedFrom": "2020-01-01",
                    "delistedOn": None,
                    "source": "fixture",
                },
            ],
        )
        write_jsonl(
            data_dir / "historical_shares_intervals.jsonl",
            [
                {"symbol": "000001", "effectiveFrom": "2020-01-01", "effectiveTo": "2025-12-31", "sharesOutstanding": 1000},
                {"symbol": "000002", "effectiveFrom": "2020-01-01", "effectiveTo": "2025-12-31", "sharesOutstanding": 1000},
            ],
        )

        out_path = root / "readiness.json"
        subprocess.run(
            [
                sys.executable,
                str(ROOT / "tools" / "build_tp12_year2hit_data_readiness_summary.py"),
                "--data-dir",
                str(data_dir),
                "--from",
                "2023-07-10",
                "--to",
                "2023-07-12",
                "--min-latest-common-date",
                "2023-07-12",
                "--required-date",
                "2023-07-11",
                "--lifecycle-path",
                str(data_dir / "historical_symbol_lifecycle.jsonl"),
                "--shares-path",
                str(data_dir / "historical_shares_intervals.jsonl"),
                "--out",
                str(out_path),
            ],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        )
        payload = load_json(out_path)
        assert payload["status"] == "passed", payload
        assert payload["latestCommonDate"] == "2023-07-12", payload
        assert payload["requiredDateLifecycleShareStatuses"][0]["missingShareSymbolCount"] == 0, payload

    print("ok smoke_tp12_year2hit_data_readiness")


if __name__ == "__main__":
    main()
