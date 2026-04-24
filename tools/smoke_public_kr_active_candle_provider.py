#!/usr/bin/env python3

import json
import sys
from argparse import Namespace
from pathlib import Path
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = ROOT / "tools"
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

import backfill_public_kr_historical as backfill_mod  # noqa: E402
from public_kr_historical_common import iter_jsonl, write_jsonl  # noqa: E402
from public_kr_historical_source_manifest import (  # noqa: E402
    CANDLE_SOURCE_ACTIVE_KRX,
    CANDLE_SOURCE_ACTIVE_YAHOO,
    build_source_manifest_row,
)
from plan_public_kr_historical_shards import main as plan_shards_main  # noqa: E402


class DummyKrxClient:
    def fetch_active_price_range(self, *, full_code, date_from, date_to):
        return [
            {
                "TRD_DD": "2023/07/11",
                "TDD_OPNPRC": "100000",
                "TDD_HGPRC": "110000",
                "TDD_LWPRC": "99000",
                "TDD_CLSPRC": "105000",
                "ACC_TRDVOL": "100000",
            }
        ]


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    active_row = {
        "symbol": "005930",
        "name": "SAMSUNG",
        "fullCode": "KR7005930003",
        "marketCode": "STK",
        "type": "COMMON",
        "listedFrom": "2010-01-04",
        "delistedOn": None,
        "source": "smoke",
    }
    if build_source_manifest_row(active_row)["candleSource"] != CANDLE_SOURCE_ACTIVE_YAHOO:
        raise AssertionError("default active candle source must remain Yahoo")
    if (
        build_source_manifest_row(active_row, active_candle_provider="krx")["candleSource"]
        != CANDLE_SOURCE_ACTIVE_KRX
    ):
        raise AssertionError("explicit KRX active provider must map to ACTIVE_KRX")

    with TemporaryDirectory() as tmp_dir:
        root = Path(tmp_dir)
        lifecycle_path = root / "historical_symbol_lifecycle.jsonl"
        shares_path = root / "historical_shares_intervals.jsonl"
        stage_root = root / "stage"
        shard_plan_path = root / "shard_plan.json"

        write_jsonl(lifecycle_path, [active_row])
        write_jsonl(
            shares_path,
            [
                {
                    "symbol": "005930",
                    "effectiveFrom": "2010-01-04",
                    "effectiveTo": "2026-12-31",
                    "sharesOutstanding": 100000000,
                    "source": "smoke",
                }
            ],
        )

        old_argv = sys.argv[:]
        try:
            sys.argv = [
                "plan_public_kr_historical_shards.py",
                "--from=2023-07-11",
                "--to=2023-07-11",
                f"--lifecycle-path={lifecycle_path}",
                "--shard-count=1",
                "--active-candle-provider=krx",
                f"--summary-out={shard_plan_path}",
            ]
            plan_shards_main()
        finally:
            sys.argv = old_argv

        shard_plan = load_json(shard_plan_path)
        if shard_plan["activeCandleProvider"] != "krx":
            raise AssertionError(shard_plan)
        if shard_plan["sourceCounts"]["activeKrxCandleSymbols"] != 1:
            raise AssertionError(shard_plan)

        original_build_krx_client = backfill_mod.build_krx_client
        try:
            backfill_mod.build_krx_client = lambda **_: DummyKrxClient()
            args = Namespace(
                date_from="2023-07-11",
                date_to="2023-07-11",
                config=str(ROOT / "config" / "lab.config.server.lite.json"),
                lifecycle_path=str(lifecycle_path),
                shares_path=str(shares_path),
                stage_root=str(stage_root),
                historical_candle_provider="explicit_source_plan",
                active_candle_provider="krx",
                security_type="COMMON",
                symbol_shard_index=0,
                symbol_shard_count=1,
                max_workers=1,
                krx_auth_mode="login-required",
                retries=1,
                sleep_ms=0,
                krx_min_interval_ms=0,
                krx_cooldown_ms=0,
                summary_out="",
                run_id="smoke_active_krx_provider",
                worker_id="worker-0",
                audit_dir="audit",
                overwrite_stage=False,
                universe_mode="all_common",
            )
            exit_code = backfill_mod.execute_stage(args)
        finally:
            backfill_mod.build_krx_client = original_build_krx_client

        if exit_code != 0:
            raise AssertionError(f"execute_stage exit_code={exit_code}")

        summary = load_json(stage_root / "summary.json")
        if summary["status"] != "completed":
            raise AssertionError(summary)
        if summary["activeCandleProvider"] != "krx":
            raise AssertionError(summary)
        if summary["fetchedSymbolCount"] != 1 or summary["candleRowCount"] != 1:
            raise AssertionError(summary)

        symbol_results = list(iter_jsonl(stage_root / "symbol_results.jsonl"))
        if len(symbol_results) != 1:
            raise AssertionError(symbol_results)
        result = symbol_results[0]
        if result["status"] != "completed":
            raise AssertionError(result)
        if not str(result["source"] or "").startswith("krx.active_price:"):
            raise AssertionError(result)

    print("ok smoke_public_kr_active_candle_provider")


if __name__ == "__main__":
    main()
