#!/usr/bin/env python3

import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parent.parent


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            fh.write("\n")


def main():
    with TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        lifecycle_path = root / "historical_symbol_lifecycle.jsonl"
        shares_path = root / "historical_shares_intervals.jsonl"
        passed_summary = root / "passed_summary.json"
        failed_summary = root / "failed_summary.json"

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
                }
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
                }
            ],
        )

        passed = subprocess.run(
            [
                sys.executable,
                str(ROOT / "tools" / "assert_public_kr_historical_shares_coverage.py"),
                "--from=2020-04-19",
                "--to=2020-04-19",
                f"--lifecycle-path={lifecycle_path}",
                f"--shares-path={shares_path}",
                f"--summary-out={passed_summary}",
            ],
            cwd=root,
            capture_output=True,
            text=True,
        )
        if passed.returncode != 0:
            raise AssertionError(passed.stderr or passed.stdout)
        passed_payload = json.loads(passed_summary.read_text(encoding="utf-8"))
        if passed_payload["status"] != "passed":
            raise AssertionError(passed_payload)

        failed = subprocess.run(
            [
                sys.executable,
                str(ROOT / "tools" / "assert_public_kr_historical_shares_coverage.py"),
                "--from=2020-04-20",
                "--to=2020-04-20",
                f"--lifecycle-path={lifecycle_path}",
                f"--shares-path={shares_path}",
                f"--summary-out={failed_summary}",
            ],
            cwd=root,
            capture_output=True,
            text=True,
        )
        if failed.returncode == 0:
            raise AssertionError("expected shares coverage failure for out-of-range date")
        failed_payload = json.loads(failed_summary.read_text(encoding="utf-8"))
        if failed_payload["status"] != "failed":
            raise AssertionError(failed_payload)
        if failed_payload["globalMaxShareEffectiveTo"] != "2020-04-19":
            raise AssertionError(failed_payload)
        if failed_payload["missingShareSymbolCount"] != 1:
            raise AssertionError(failed_payload)
        first_missing = failed_payload["missingShareSymbols"][0]
        if first_missing["symbol"] != "000005" or first_missing["firstMissingDate"] != "2020-04-20":
            raise AssertionError(first_missing)

    print("ok smoke_public_kr_historical_shares_coverage")


if __name__ == "__main__":
    main()
