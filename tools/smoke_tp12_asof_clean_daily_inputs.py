#!/usr/bin/env python3

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            fh.write("\n")


def read_jsonl(path):
    with open(path, encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def main():
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        candle_path = base / "candle_daily.jsonl"
        lifecycle_path = base / "historical_symbol_lifecycle.jsonl"
        shares_path = base / "historical_shares_intervals.jsonl"
        out_dir = base / "clean"
        summary_path = base / "summary.json"
        write_jsonl(
            candle_path,
            [
                {"symbol": "000001", "dateKey": "2020-01-02", "open": 100, "high": 110, "low": 90, "close": 105, "volume": 10},
                {"symbol": "000001", "dateKey": "2020-01-03", "open": 105, "high": 112, "low": 100, "close": 110, "volume": 20},
                {"symbol": "000002", "dateKey": "2020-01-02", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
                {"symbol": "000003", "dateKey": "2020-01-02", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
                {"symbol": "000004", "dateKey": "2020-01-02", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 1},
            ],
        )
        write_jsonl(
            lifecycle_path,
            [
                {"symbol": "000001", "listedFrom": "2019-01-01", "delistedOn": None},
                {"symbol": "000002", "listedFrom": "2020-02-01", "delistedOn": None},
                {"symbol": "000003", "listedFrom": "2019-01-01", "delistedOn": None},
            ],
        )
        write_jsonl(
            shares_path,
            [
                {"symbol": "000001", "effectiveFrom": "2019-01-01", "effectiveTo": "2020-12-31", "sharesOutstanding": 1000},
                {"symbol": "000002", "effectiveFrom": "2020-02-01", "effectiveTo": "2020-12-31", "sharesOutstanding": 1000},
            ],
        )
        subprocess.run(
            [
                sys.executable,
                str(ROOT / "tools/build_tp12_asof_clean_daily_inputs.py"),
                f"--candle-path={candle_path}",
                f"--lifecycle-path={lifecycle_path}",
                f"--shares-path={shares_path}",
                "--from=2020-01-02",
                "--to=2020-01-03",
                "--min-latest-common-date=2020-01-03",
                f"--out-dir={out_dir}",
                f"--summary-out={summary_path}",
            ],
            cwd=ROOT,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        if summary["status"] != "passed":
            raise AssertionError(summary)
        if summary["keptRowCount"] != 2:
            raise AssertionError(summary)
        if summary["droppedInactiveLifecycleRowCount"] != 1:
            raise AssertionError(summary)
        if summary["droppedMissingSharesRowCount"] != 1:
            raise AssertionError(summary)
        if summary["droppedMissingLifecycleRowCount"] != 1:
            raise AssertionError(summary)
        candles = read_jsonl(out_dir / "candle_daily.jsonl")
        universe = read_jsonl(out_dir / "universe_daily.jsonl")
        if [row["symbol"] for row in candles] != ["000001", "000001"]:
            raise AssertionError(candles)
        if universe[0]["avgTradingValue20d"] != 1050:
            raise AssertionError(universe)
        if universe[1]["avgTradingValue20d"] != 1625:
            raise AssertionError(universe)
        if universe[1]["marketCapKrw"] != 110000:
            raise AssertionError(universe)
    print("ok smoke_tp12_asof_clean_daily_inputs")


if __name__ == "__main__":
    main()
