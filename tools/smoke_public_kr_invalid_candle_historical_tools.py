#!/usr/bin/env python3

import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parent.parent


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            fh.write("\n")


def find_single_json(dir_path):
    files = sorted(Path(dir_path).glob("*.json"))
    if len(files) != 1:
        raise AssertionError(f"expected 1 json in {dir_path}, got {len(files)}")
    return files[0]


def main():
    with TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        data_dir = root / "data"
        audit_dir = root / "audit"
        data_dir.mkdir(parents=True, exist_ok=True)
        write_jsonl(
            data_dir / "symbol_master.jsonl",
            [
                {"symbol": "000300", "name": "DH오토넥스", "type": "COMMON", "isListed": True},
                {"symbol": "000660", "name": "SK하이닉스", "type": "COMMON", "isListed": True},
            ],
        )
        write_jsonl(
            data_dir / "candle_daily.jsonl",
            [
                {"symbol": "000300", "dateKey": "2026-03-18", "open": 0, "high": 0, "low": 0, "close": 4200, "volume": 0},
                {"symbol": "000660", "dateKey": "2026-03-18", "open": 1000, "high": 1100, "low": 990, "close": 1070, "volume": 1234},
            ],
        )
        write_jsonl(
            data_dir / "universe_daily.jsonl",
            [
                {"symbol": "000300", "tradingDateKey": "2026-03-18", "avgTradingValue20d": 0, "marketCapKrw": 1000},
                {"symbol": "000660", "tradingDateKey": "2026-03-18", "avgTradingValue20d": 10, "marketCapKrw": 2000},
            ],
        )

        audit_cmd = [
            sys.executable,
            str(ROOT / "tools" / "audit_public_kr_invalid_candles.py"),
            "--data-dir",
            str(data_dir),
            "--audit-dir",
            str(audit_dir),
        ]
        audit_run = subprocess.run(audit_cmd, cwd=root, capture_output=True, text=True, check=True)
        if "invalid_symbols=1" not in audit_run.stdout:
            raise AssertionError(audit_run.stdout)
        audit_path = find_single_json(audit_dir)
        with open(audit_path, encoding="utf-8") as fh:
            audit = json.load(fh)
        if audit["invalidRowCount"] != 1 or audit["invalidUniversePairCount"] != 1:
            raise AssertionError(audit)

        scrub_cmd = [
            sys.executable,
            str(ROOT / "tools" / "scrub_public_kr_invalid_candles.py"),
            "--data-dir",
            str(data_dir),
            "--audit-dir",
            str(audit_dir),
            "--backup-root",
            "backups",
        ]
        dry_run = subprocess.run(scrub_cmd, cwd=root, capture_output=True, text=True, check=True)
        if "DRYRUN scrub_public_kr_invalid_candles" not in dry_run.stdout:
            raise AssertionError(dry_run.stdout)

        apply_run = subprocess.run(scrub_cmd + ["--apply"], cwd=root, capture_output=True, text=True, check=True)
        if "DONE scrub_public_kr_invalid_candles" not in apply_run.stdout:
            raise AssertionError(apply_run.stdout)

        with open(data_dir / "candle_daily.jsonl", encoding="utf-8") as fh:
            candle_rows = [json.loads(line) for line in fh]
        with open(data_dir / "universe_daily.jsonl", encoding="utf-8") as fh:
            universe_rows = [json.loads(line) for line in fh]
        if len(candle_rows) != 1 or candle_rows[0]["symbol"] != "000660":
            raise AssertionError(candle_rows)
        if len(universe_rows) != 1 or universe_rows[0]["symbol"] != "000660":
            raise AssertionError(universe_rows)

        backup_root = root / "backups"
        backup_dirs = [path for path in backup_root.iterdir() if path.is_dir()]
        if len(backup_dirs) != 1:
            raise AssertionError(backup_dirs)

    print("ok smoke_public_kr_invalid_candle_historical_tools")


if __name__ == "__main__":
    main()
