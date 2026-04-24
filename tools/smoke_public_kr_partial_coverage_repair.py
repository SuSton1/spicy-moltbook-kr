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

        write_jsonl(
            data_dir / "symbol_master.jsonl",
            [
                {"symbol": "000001", "marketCode": "STK", "name": "A", "type": "COMMON", "isListed": True},
                {"symbol": "000002", "marketCode": "KSQ", "name": "B", "type": "COMMON", "isListed": True},
                {"symbol": "000003", "marketCode": "KSQ", "name": "C", "type": "COMMON", "isListed": True},
            ],
        )
        write_jsonl(
            data_dir / "candle_daily.jsonl",
            [
                {"symbol": "000001", "dateKey": "2023-07-10", "open": 100, "high": 110, "low": 99, "close": 105, "volume": 1000},
                {"symbol": "000002", "dateKey": "2023-07-10", "open": 200, "high": 210, "low": 199, "close": 205, "volume": 1000},
                {"symbol": "000003", "dateKey": "2023-07-10", "open": 300, "high": 310, "low": 299, "close": 305, "volume": 1000},
                {"symbol": "000001", "dateKey": "2023-07-11", "open": 101, "high": 111, "low": 100, "close": 106, "volume": 1000},
                {"symbol": "000001", "dateKey": "2023-07-12", "open": 102, "high": 112, "low": 101, "close": 107, "volume": 1000},
                {"symbol": "000002", "dateKey": "2023-07-12", "open": 202, "high": 212, "low": 201, "close": 207, "volume": 1000},
                {"symbol": "000003", "dateKey": "2023-07-12", "open": 302, "high": 312, "low": 301, "close": 307, "volume": 1000},
            ],
        )
        write_jsonl(
            data_dir / "universe_daily.jsonl",
            [
                {"symbol": "000001", "tradingDateKey": "2023-07-10", "avgTradingValue20d": 100, "marketCapKrw": 1000},
                {"symbol": "000002", "tradingDateKey": "2023-07-10", "avgTradingValue20d": 100, "marketCapKrw": 1000},
                {"symbol": "000003", "tradingDateKey": "2023-07-10", "avgTradingValue20d": 100, "marketCapKrw": 1000},
                {"symbol": "000001", "tradingDateKey": "2023-07-11", "avgTradingValue20d": 100, "marketCapKrw": 1000},
                {"symbol": "000001", "tradingDateKey": "2023-07-12", "avgTradingValue20d": 100, "marketCapKrw": 1000},
                {"symbol": "000002", "tradingDateKey": "2023-07-12", "avgTradingValue20d": 100, "marketCapKrw": 1000},
                {"symbol": "000003", "tradingDateKey": "2023-07-12", "avgTradingValue20d": 100, "marketCapKrw": 1000},
            ],
        )
        write_jsonl(data_dir / "nontrading_symbol_daily.jsonl", [])

        manifest_path = root / "manifest.json"
        write_json(
            manifest_path,
            {
                "kind": "public_kr_partial_coverage_anomaly_manifest_v1",
                "anomalyDates": [
                    {
                        "dateKey": "2023-07-11",
                        "severity": "critical",
                        "defaultUniverseMode": "core_threshold",
                        "dominantMissingMarketCode": "KSQ",
                        "repairPriority": 1,
                    }
                ],
                "boundaryDates": [],
            },
        )

        audit_path = root / "audit.json"
        audit_cmd = [
            sys.executable,
            str(ROOT / "tools" / "audit_public_kr_partial_coverage_dates.py"),
            "--data-dir",
            str(data_dir),
            "--manifest-path",
            str(manifest_path),
            "--summary-out",
            str(audit_path),
            "--prev-ratio-threshold",
            "0.80",
            "--local-ratio-threshold",
            "0.80",
        ]
        subprocess.run(audit_cmd, cwd=root, check=True, capture_output=True, text=True)
        audit = load_json(audit_path)
        anomalies = {row["dateKey"]: row for row in audit["severeAnomalyDates"]}
        row = anomalies.get("2023-07-11")
        if row is None:
            raise AssertionError(audit)
        if row["dominantMissingMarketCode"] != "KSQ":
            raise AssertionError(row)

        stage_root = root / "stage" / "shard=0"
        write_json(
            stage_root / "summary.json",
            {
                "kind": "public_kr_historical_stage_summary_v1",
                "status": "completed",
                "expectedSymbolCount": 3,
                "fetchedSymbolCount": 3,
                "candleRowCount": 3,
                "universeRowCount": 3,
                "nonTradingRowCount": 0,
            },
        )
        write_json(
            stage_root / "qc_summary.json",
            {
                "kind": "public_kr_historical_stage_qc_summary_v1",
                "status": "passed",
            },
        )
        write_partitioned_rows(
            stage_root,
            "candle",
            [
                {"symbol": "000001", "dateKey": "2023-07-11", "open": 101, "high": 111, "low": 100, "close": 106, "volume": 1000},
                {"symbol": "000002", "dateKey": "2023-07-11", "open": 201, "high": 211, "low": 200, "close": 206, "volume": 1000},
                {"symbol": "000003", "dateKey": "2023-07-11", "open": 301, "high": 311, "low": 300, "close": 306, "volume": 1000},
            ],
            "dateKey",
        )
        write_partitioned_rows(
            stage_root,
            "universe",
            [
                {"symbol": "000001", "tradingDateKey": "2023-07-11", "avgTradingValue20d": 100, "marketCapKrw": 1000},
                {"symbol": "000002", "tradingDateKey": "2023-07-11", "avgTradingValue20d": 100, "marketCapKrw": 1000},
                {"symbol": "000003", "tradingDateKey": "2023-07-11", "avgTradingValue20d": 100, "marketCapKrw": 1000},
            ],
            "tradingDateKey",
        )
        write_partitioned_rows(stage_root, "nontrading", [], "dateKey")

        validation_path = root / "validation.json"
        validate_cmd = [
            sys.executable,
            str(ROOT / "tools" / "validate_public_kr_targeted_repair_stage.py"),
            "--stage-root",
            str(stage_root),
            "--from",
            "2023-07-11",
            "--to",
            "2023-07-11",
            "--data-dir",
            str(data_dir),
            "--summary-out",
            str(validation_path),
        ]
        subprocess.run(validate_cmd, cwd=root, check=True, capture_output=True, text=True)
        validation = load_json(validation_path)
        if validation["status"] != "passed":
            raise AssertionError(validation)
        if validation["dates"][0]["recoveryRate"] < 1.0:
            raise AssertionError(validation)

        subprocess.run(["bash", "-n", str(ROOT / "tools" / "run_public_kr_historical_stage_only.sh")], cwd=root, check=True)
        subprocess.run(["bash", "-n", str(ROOT / "tools" / "server_run_public_kr_historical_stage_only.sh")], cwd=root, check=True)
        subprocess.run(["bash", "-n", str(ROOT / "tools" / "run_public_kr_targeted_date_repair.sh")], cwd=root, check=True)
        subprocess.run(["bash", "-n", str(ROOT / "tools" / "server_run_public_kr_targeted_date_repair.sh")], cwd=root, check=True)

    print("ok smoke_public_kr_partial_coverage_repair")


if __name__ == "__main__":
    main()
