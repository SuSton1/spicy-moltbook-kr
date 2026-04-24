#!/usr/bin/env python3

import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import backfill_public_kr_historical as historical_stage  # noqa: E402
from fill_public_kr_daily import candidate_yahoo_symbols  # noqa: E402
from public_kr_historical_common import stable_symbol_shard  # noqa: E402


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            fh.write("\n")


def find_count(path):
    if not path.exists():
        return 0
    with open(path, encoding="utf-8") as fh:
        return sum(1 for _ in fh if _.strip())


def build_payload(rows):
    timestamps = []
    opens = []
    highs = []
    lows = []
    closes = []
    volumes = []
    for row in rows:
        timestamps.append(int(row["timestamp"]))
        opens.append(float(row["open"]))
        highs.append(float(row["high"]))
        lows.append(float(row["low"]))
        closes.append(float(row["close"]))
        volumes.append(int(row["volume"]))
    return {
        "meta": {"gmtoffset": 9 * 3600},
        "timestamp": timestamps,
        "indicators": {
            "quote": [
                {
                    "open": opens,
                    "high": highs,
                    "low": lows,
                    "close": closes,
                    "volume": volumes,
                }
            ]
        },
    }


def main():
    with TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        data_dir = root / "data"
        stage_root = root / "stage" / "shard=0"
        data_dir.mkdir(parents=True, exist_ok=True)

        if candidate_yahoo_symbols("000010", "KSQ") != ["000010.KQ", "000010.KS"]:
            raise AssertionError(candidate_yahoo_symbols("000010", "KSQ"))
        shard_sample = ["000010", "000015", "000020", "000025", "000030"]
        if len({stable_symbol_shard(symbol, 5) for symbol in shard_sample}) <= 1:
            raise AssertionError("stable_symbol_shard collapsed sample distribution")

        lifecycle_path = data_dir / "historical_symbol_lifecycle.jsonl"
        shares_path = data_dir / "historical_shares_intervals.jsonl"
        write_jsonl(
            lifecycle_path,
            [
                {
                    "symbol": "000005",
                    "name": "Test A",
                    "marketCode": "STK",
                    "type": "COMMON",
                    "listedFrom": "2016-01-01",
                    "delistedOn": "",
                    "source": "smoke",
                },
                {
                    "symbol": "000010",
                    "name": "Test B",
                    "marketCode": "KSQ",
                    "type": "COMMON",
                    "listedFrom": "2016-01-01",
                    "delistedOn": "",
                    "source": "smoke",
                },
            ],
        )
        write_jsonl(
            shares_path,
            [
                {
                    "symbol": "000005",
                    "effectiveFrom": "2016-01-01",
                    "effectiveTo": "2020-04-19",
                    "sharesOutstanding": 1000000,
                    "source": "smoke",
                },
                {
                    "symbol": "000010",
                    "effectiveFrom": "2016-01-01",
                    "effectiveTo": "2020-04-19",
                    "sharesOutstanding": 2000000,
                    "source": "smoke",
                },
            ],
        )

        fake_payloads = {
            "000005.KS": build_payload(
                [
                    {"timestamp": 1451606400, "open": 1000, "high": 1100, "low": 990, "close": 1050, "volume": 1000},
                    {"timestamp": 1451692800, "open": 1050, "high": 1120, "low": 1020, "close": 1110, "volume": 1200},
                ]
            ),
            "000010.KQ": build_payload(
                [
                    {"timestamp": 1451606400, "open": 2000, "high": 2100, "low": 1980, "close": 2050, "volume": 2000},
                    {"timestamp": 1451692800, "open": 2050, "high": 2150, "low": 2020, "close": 2160, "volume": 2200},
                ]
            ),
            "000010.KS": build_payload(
                [
                    {"timestamp": 1451606400, "open": 2000, "high": 2100, "low": 1980, "close": 2050, "volume": 2000},
                    {"timestamp": 1451692800, "open": 2050, "high": 2150, "low": 2020, "close": 2140, "volume": 2200},
                ]
            ),
        }

        original_fetch = historical_stage.fetch_chart_payload

        def fake_fetch(yahoo_symbol, day_from, day_to, retries, sleep_ms):
            del day_from, day_to, retries, sleep_ms
            payload = fake_payloads.get(yahoo_symbol)
            if payload is None:
                return None
            return payload

        historical_stage.fetch_chart_payload = fake_fetch
        try:
            args = SimpleNamespace(
                date_from="2016-01-01",
                date_to="2016-01-02",
                config=str(ROOT / "config" / "lab.config.server.lite.json"),
                lifecycle_path=str(lifecycle_path),
                shares_path=str(shares_path),
                stage_root=str(stage_root),
                historical_candle_provider="explicit_source_plan",
                security_type="COMMON",
                symbol_shard_index=0,
                symbol_shard_count=1,
                max_workers=2,
                krx_auth_mode="login-required",
                retries=1,
                sleep_ms=1,
                summary_out=str(stage_root / "summary.json"),
                run_id="smoke",
                worker_id="shard-0",
                audit_dir="audit",
                overwrite_stage=True,
                universe_mode="all_common",
            )
            exit_code = historical_stage.execute_stage(args)
            if exit_code != 0:
                raise AssertionError(exit_code)
        finally:
            historical_stage.fetch_chart_payload = original_fetch

        summary_path = stage_root / "summary.json"
        with open(summary_path, encoding="utf-8") as fh:
            summary = json.load(fh)
        if summary["status"] != "completed":
            raise AssertionError(summary)
        if summary["expectedSymbolCount"] != 2 or summary["fetchedSymbolCount"] != 2:
            raise AssertionError(summary)

        qc_cmd = [
            sys.executable,
            str(ROOT / "tools" / "qc_public_kr_historical_stage.py"),
            "--stage-root",
            str(stage_root),
        ]
        subprocess.run(qc_cmd, cwd=root, check=True, capture_output=True, text=True)

        write_jsonl(root / "data" / "symbol_master.jsonl", [])
        write_jsonl(root / "data" / "candle_daily.jsonl", [])
        write_jsonl(root / "data" / "universe_daily.jsonl", [])
        write_jsonl(root / "data" / "nontrading_symbol_daily.jsonl", [])
        pre_merge_inodes = {
            "candle_daily.jsonl": (root / "data" / "candle_daily.jsonl").stat().st_ino,
            "universe_daily.jsonl": (root / "data" / "universe_daily.jsonl").stat().st_ino,
            "nontrading_symbol_daily.jsonl": (root / "data" / "nontrading_symbol_daily.jsonl").stat().st_ino,
            "symbol_master.jsonl": (root / "data" / "symbol_master.jsonl").stat().st_ino,
        }

        merge_cmd = [
            sys.executable,
            str(ROOT / "tools" / "merge_public_kr_historical_stage.py"),
            "--stage-root",
            str(stage_root),
            "--from",
            "2016-01-01",
            "--to",
            "2016-01-02",
            "--data-dir",
            str(root / "data"),
            "--backup-root",
            str(root / "backups"),
            "--lock-path",
            str(root / "merge.lock"),
            "--merge-journal",
            str(root / "merge_journal.jsonl"),
        ]
        subprocess.run(merge_cmd, cwd=root, check=True, capture_output=True, text=True)

        candle_count = find_count(root / "data" / "candle_daily.jsonl")
        universe_count = find_count(root / "data" / "universe_daily.jsonl")
        if candle_count != 4 or universe_count != 4:
            raise AssertionError((candle_count, universe_count))
        backup_dirs = sorted((root / "backups").glob("historical_merge_*"))
        if len(backup_dirs) != 1:
            raise AssertionError(backup_dirs)
        backup_dir = backup_dirs[0]
        for filename, inode in pre_merge_inodes.items():
            backup_path = backup_dir / filename
            if not backup_path.exists():
                raise AssertionError(f"missing backup snapshot: {backup_path}")
            if backup_path.stat().st_ino != inode:
                raise AssertionError(f"expected hardlink snapshot for {filename}")

        server_wrapper = ROOT / "tools" / "server_run_public_kr_historical_backfill.sh"
        local_wrapper = ROOT / "tools" / "run_public_kr_historical_backfill.sh"
        subprocess.run(["bash", "-n", str(local_wrapper)], cwd=root, check=True)
        subprocess.run(["bash", "-n", str(server_wrapper)], cwd=root, check=True)
        sync_script = (ROOT / "scripts" / "sync_to_server.sh").read_text(encoding="utf-8")
        if '--exclude "artifacts/backfill/"' not in sync_script:
            raise AssertionError("sync_to_server.sh must preserve server-only artifacts/backfill outputs")
        if '--exclude "artifacts/tp12_intraday/"' not in sync_script:
            raise AssertionError("sync_to_server.sh must preserve server-only artifacts/tp12_intraday outputs")

    print("ok smoke_public_kr_historical_stage_tools")


if __name__ == "__main__":
    main()
