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

from public_kr_historical_common import write_json, write_jsonl, write_partitioned_rows  # noqa: E402


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    with TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        data_dir = root / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        config_path = root / "config.json"
        write_json(
            config_path,
            {
                "filters": {
                    "minMarketCapKrw": 1000,
                    "minAvgTradingValue20dKrw": 1000,
                }
            },
        )
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
                {"symbol": "000001", "effectiveFrom": "2020-01-01", "effectiveTo": "2025-12-31", "sharesOutstanding": 100},
                {"symbol": "000002", "effectiveFrom": "2020-01-01", "effectiveTo": "2025-12-31", "sharesOutstanding": 100},
            ],
        )
        write_jsonl(
            data_dir / "candle_daily.jsonl",
            [
                {"symbol": "000001", "dateKey": "2025-09-19", "open": 20, "high": 20, "low": 20, "close": 20, "volume": 100},
                {"symbol": "000002", "dateKey": "2025-09-19", "open": 20, "high": 20, "low": 20, "close": 20, "volume": 100},
            ],
        )
        write_jsonl(
            data_dir / "universe_daily.jsonl",
            [
                {"symbol": "000001", "tradingDateKey": "2025-09-19", "avgTradingValue20d": 2000, "marketCapKrw": 2000},
                {"symbol": "000002", "tradingDateKey": "2025-09-19", "avgTradingValue20d": 2000, "marketCapKrw": 2000},
            ],
        )
        write_jsonl(data_dir / "nontrading_symbol_daily.jsonl", [])

        stage_root = root / "stage"
        write_json(
            stage_root / "summary.json",
            {
                "kind": "public_kr_historical_stage_summary_v1",
                "status": "completed",
                "universeMode": "core_threshold",
                "candleRowCount": 2,
                "universeRowCount": 1,
            },
        )
        write_partitioned_rows(
            stage_root,
            "candle",
            [
                {"symbol": "000001", "dateKey": "2025-09-19", "open": 20, "high": 20, "low": 20, "close": 20, "volume": 100},
                {"symbol": "000002", "dateKey": "2025-09-19", "open": 5, "high": 5, "low": 5, "close": 5, "volume": 100},
            ],
            "dateKey",
        )
        write_partitioned_rows(
            stage_root,
            "universe",
            [
                {"symbol": "000001", "tradingDateKey": "2025-09-19", "avgTradingValue20d": 2000, "marketCapKrw": 2000},
            ],
            "tradingDateKey",
        )
        write_partitioned_rows(stage_root, "nontrading", [], "dateKey")

        out_path = root / "diff.json"
        subprocess.run(
            [
                sys.executable,
                str(ROOT / "tools" / "diff_public_kr_universe_membership.py"),
                "--date",
                "2025-09-19",
                "--stage-root",
                str(stage_root),
                "--data-dir",
                str(data_dir),
                "--config",
                str(config_path),
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
        assert payload["status"] == "failed", payload
        assert payload["counts"]["currentOnlyUniverseSymbols"] == 1, payload["counts"]
        assert payload["sets"]["currentOnlyUniverse"]["marketCounts"] == {"KSQ": 1}, payload["sets"]["currentOnlyUniverse"]
        assert payload["stageCandleMissingUniverseApproxRejects"]["reasonCounts"] == {
            "market_cap_below_min+liquidity_below_min": 1
        }, payload["stageCandleMissingUniverseApproxRejects"]

    print("ok smoke_public_kr_universe_membership_diff")


if __name__ == "__main__":
    main()
